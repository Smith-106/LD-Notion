"use strict";
const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { NotionAPI, SiteDetector, EMOJI_MAP, DOMToNotion } = require("../api");
const { OperationGuard, OperationLog } = require("../security");
const { GenericExtractor, WorkspaceService } = require("../extract");
const { UndoManager, ConfirmationDialog } = require("../security");
const { UrlValidator } = require("../security/UrlValidator");
const { AISchema } = require("./schema");
// ISS-012 MAINT-002: AI Agent 调用链路追踪持久化（observability）。
const { AgentTrace } = require("./AgentTrace");
// ISS-20260723-010 W4 (MAINT-005/006/009): BlockConverter + NameResolver 从本文件提取到独立模块。
// AIAssistant 上保留转发壳（_textToBlocks/_buildBlockUpdatePayload/_resolveDatabaseId/_resolvePageId）
// 保持 38 处调用点零改动；源码层分层已达成，esbuild 工厂内联是打包细节（review spec「分层重构验证」）。
const { BlockConverter } = require("./BlockConverter");
const { NameResolver } = require("./NameResolver");
// ISS-20260723-010 W6-1 (ARCH-002): AI_AGENT_TOOLS 从本文件提取到独立模块。
// 块内 103 处 AIAssistant./3 处 AIService. 改 lazy accessor (AI()/svc()) 解循环引用
// (coding-conventions-005, ISS-007 _bridgeAccessor 同模式)。AI_AGENT_TOOLS 仍由本文件 re-export
// 保持 9 导出契约零改动；AGENT_TOOLS 属性赋值 + 工具分发白名单引用不变。
const { AI_AGENT_TOOLS } = require("./AgentTools");
// ISS-20260723-010 W6-2 (ARCH-001/004): AIHandlers 从本文件提取到独立模块。
// 块内 79 处 AIAssistant./74 处 ChatState./17 处 AIService. 改 lazy accessor (AI()/state()/svc())
// 解跨文件引用 (coding-conventions-005)。Object.assign(AIAssistant, AIHandlers) mixin 机制保留
// (见下方)，32 方法仍经 mixin 进 AIAssistant，38 处调用点零改动。
const { AIHandlers } = require("./Handlers");

// ═══════════════════════════════════════════════════════
// 🤖 AI Service — LLM 客户端（OpenAI / Claude / Gemini）
// ═══════════════════════════════════════════════════════
const AIService = {
    // 标准化 + 安全校验 baseUrl，返回 null 表示非法（调用方应 reject）
    // versionPath: "v1" 或 "v1beta"
    _normalizeBaseUrl: (baseUrl, versionPath) => {
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(new RegExp(`/${versionPath}$`), "") : "";
        if (!normalizedBase) return "";
        if (!UrlValidator.validateAiBaseUrl(normalizedBase)) {
            throw new Error(`AI baseUrl 安全校验失败：${normalizedBase} 不在白名单或非 HTTPS`);
        }
        return normalizedBase;
    },

    // 服务商配置
    PROVIDERS: {
        openai: {
            name: "OpenAI",
            defaultModel: "gpt-4o-mini",
            models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
            endpoint: "https://api.openai.com/v1/chat/completions",
        },
        claude: {
            name: "Claude",
            defaultModel: "claude-3-5-haiku-latest",
            models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
            endpoint: "https://api.anthropic.com/v1/messages",
        },
        gemini: {
            name: "Gemini",
            defaultModel: "gemini-2.0-flash",
            models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
            endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
        }
    },

    // 调用 AI 进行分类
    classify: async (title, content, categories, settings) => {
        // 使用 XML 标签分隔系统指令与用户内容，降低 prompt injection 风险
        const prompt = `请根据以下帖子内容，从给定的分类中选择最合适的一个。
只返回分类名称，不要任何其他内容、解释或标点符号。

可选分类：${categories.join(", ")}

<user_content>
<title>${title}</title>
<body>${content.slice(0, 2000)}</body>
</user_content>

分类：`;

        const response = await AIService.request(prompt, settings);
        return AIService.matchCategory(response, categories);
    },

    // 发送请求（根据不同服务商格式化）
    request: async (prompt, settings) => {
        const { aiService, aiApiKey, aiModel, aiBaseUrl } = settings;
        const provider = AIService.PROVIDERS[aiService];
        if (!provider) throw new Error(`未知的 AI 服务: ${aiService}`);

        const model = aiModel || provider.defaultModel;

        if (aiService === "openai") {
            return await AIService.requestOpenAI(prompt, model, aiApiKey, aiBaseUrl);
        } else if (aiService === "claude") {
            return await AIService.requestClaude(prompt, model, aiApiKey, aiBaseUrl);
        } else if (aiService === "gemini") {
            return await AIService.requestGemini(prompt, model, aiApiKey, aiBaseUrl);
        }
        throw new Error(`不支持的 AI 服务: ${aiService}`);
    },

    // OpenAI 分类请求（DISCOVER P6 同类去重：复用 _chatRequest 骨架，timeout=30000，max_completion_tokens=50）
    requestOpenAI: (prompt, model, apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1");
        const url = normalizedBase
            ? `${normalizedBase}/v1/chat/completions`
            : "https://api.openai.com/v1/chat/completions";

        return AIService._chatRequest(
            url,
            { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            { model, messages: [{ role: "user", content: prompt }], max_completion_tokens: 50, temperature: 0 },
            (result) => result.choices?.[0]?.message?.content?.trim() || "",
            "OpenAI",
            30000
        );
    },

    // Claude 分类请求（DISCOVER P6 同类去重：复用 _chatRequest 骨架，timeout=30000，max_tokens=50）
    requestClaude: (prompt, model, apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1");
        const url = normalizedBase
            ? `${normalizedBase}/v1/messages`
            : "https://api.anthropic.com/v1/messages";

        return AIService._chatRequest(
            url,
            { "x-api-key": apiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
            { model, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], max_tokens: 50 },
            (result) => result.content?.[0]?.text?.trim() || "",
            "Claude",
            30000
        );
    },

    // Gemini 分类请求（DISCOVER P6 同类去重：复用 _chatRequest 骨架，timeout=30000，maxOutputTokens=50）
    requestGemini: (prompt, model, apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1beta");
        const url = normalizedBase
            ? `${normalizedBase}/v1beta/models/${model}:generateContent`
            : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        return AIService._chatRequest(
            url,
            { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 50, temperature: 0 } },
            (result) => result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "",
            "Gemini",
            30000
        );
    },

    // 匹配分类（模糊匹配）
    matchCategory: (response, categories) => {
        if (!response) return categories[categories.length - 1]; // 默认最后一个

        const cleaned = response.trim().replace(/[。，,.!！?？]/g, "");

        // 精确匹配
        for (const cat of categories) {
            if (cleaned === cat || cleaned.toLowerCase() === cat.toLowerCase()) {
                return cat;
            }
        }

        // 包含匹配
        for (const cat of categories) {
            if (cleaned.includes(cat) || cat.includes(cleaned)) {
                return cat;
            }
        }

        // 返回默认分类（最后一个，通常是"其他"）
        return categories[categories.length - 1];
    },

    // 对话式请求（支持更长输出）
    requestChat: async (prompt, settings, maxTokens = 1000) => {
        const { aiService, aiApiKey, aiModel, aiBaseUrl } = settings;
        const provider = AIService.PROVIDERS[aiService];
        if (!provider) throw new Error(`未知的 AI 服务: ${aiService}`);

        const model = aiModel || provider.defaultModel;

        if (aiService === "openai") {
            return await AIService.requestOpenAIChat(prompt, model, aiApiKey, aiBaseUrl, maxTokens);
        } else if (aiService === "claude") {
            return await AIService.requestClaudeChat(prompt, model, aiApiKey, aiBaseUrl, maxTokens);
        } else if (aiService === "gemini") {
            return await AIService.requestGeminiChat(prompt, model, aiApiKey, aiBaseUrl, maxTokens);
        }
        throw new Error(`不支持的 AI 服务: ${aiService}`);
    },

    // OpenAI 对话请求
    // AI 请求重试包装（M1 reliability）：瞬时网络抖动/超时/5xx/429 重试 2 次（1s/2s 指数退避），
    // 401/400 等不可重试错误直接 reject。对比 NotionAPI 429 重试、RSS fetchFeedWithRetry。
    _retryable: async (requestFn, retries = 2) => {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error;
                const msg = String(error?.message || error);
                // 不可重试：鉴权失败/参数错误（401/403/400），直接抛出
                if (/401|403|400|鉴权|授权|invalid|unauthorized|forbidden/i.test(msg)) {
                    throw error;
                }
                if (attempt < retries) {
                    const delay = 1000 * Math.pow(2, attempt); // 1s, 2s
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }
        // M1 observability：AI 请求最终失败留 warn（provider/model 上下文），便于诊断配额/限流/模型不存在。
        console.warn("[LD-Notion] AI 请求最终失败（已重试）:", String(lastError?.message || lastError));
        throw lastError;
    },

    // 公共 AI 对话请求骨架（MAINT-004）：封装 GM_xmlhttpRequest Promise + _retryable +
    // onload/onerror/timeout 模板。三 provider 仅声明差异部分（url/headers/body/extractResponse/errorPrefix）。
    // timeout 默认 90000（长对话）；分类请求（requestOpenAI/Claude/Gemini）传 30000（DISCOVER P6 同类去重）。
    // 90000ms 超时是长对话请求统一值（MAINT-007 已常量化建议，此处暂留内联）。
    _chatRequest: (url, headers, body, extractResponse, errorPrefix, timeout = 90000) => {
        return AIService._retryable(() => new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: headers,
                data: JSON.stringify(body),
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(extractResponse(result));
                        } else {
                            reject(new Error(result.error?.message || `${errorPrefix}错误: ${response.status} ${Utils.truncateText(response.responseText || "", 300)}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: timeout,
                ontimeout: () => reject(new Error("AI 对话请求超时")),
            });
        }));
    },

    requestOpenAIChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1");
        const url = normalizedBase
            ? `${normalizedBase}/v1/chat/completions`
            : "https://api.openai.com/v1/chat/completions";

        return AIService._chatRequest(
            url,
            { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            { model, messages: [{ role: "user", content: prompt }], max_completion_tokens: maxTokens, temperature: 0.7 },
            (result) => result.choices?.[0]?.message?.content?.trim() || "",
            "OpenAI"
        );
    },

    // Claude 对话请求
    requestClaudeChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1");
        const url = normalizedBase
            ? `${normalizedBase}/v1/messages`
            : "https://api.anthropic.com/v1/messages";

        return AIService._chatRequest(
            url,
            { "x-api-key": apiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
            { model, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], max_tokens: maxTokens },
            (result) => result.content?.[0]?.text?.trim() || "",
            "Claude"
        );
    },

    // Gemini 对话请求
    requestGeminiChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1beta");
        const url = normalizedBase
            ? `${normalizedBase}/v1beta/models/${model}:generateContent`
            : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        return AIService._chatRequest(
            url,
            { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } },
            (result) => result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "",
            "Gemini"
        );
    },

    // Agent 多轮对话请求（将 system + messages 拼接为单个 prompt）
    requestAgentChat: async (systemPrompt, messages, settings, maxTokens = 1500) => {
        let prompt = `[系统指令]\n${systemPrompt}\n\n`;
        for (const msg of messages) {
            if (msg.role === "user") {
                prompt += `[用户]: ${msg.content}\n\n`;
            } else if (msg.role === "assistant") {
                prompt += `[助手]: ${msg.content}\n\n`;
            }
        }
        return await AIService.requestChat(prompt, settings, maxTokens);
    },

    // 获取可用模型列表
    getFetchedModelsCache: () => {
        const raw = Storage.get(CONFIG.STORAGE_KEYS.FETCHED_MODELS, "{}");
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            console.warn("[LD-Notion] 获取模型缓存 JSON 解析失败:", error);
            return {};
        }
    },

    getCachedModels: (service) => {
        const cache = AIService.getFetchedModelsCache();
        return Array.isArray(cache[service]?.models) ? cache[service].models : [];
    },

    getAvailableModels: (service) => {
        const cachedModels = AIService.getCachedModels(service);
        if (cachedModels.length > 0) return cachedModels;
        return AIService.PROVIDERS[service]?.models || [];
    },

    persistFetchedModels: (service, models) => {
        const normalizedModels = Array.isArray(models) ? models : [];
        const cache = AIService.getFetchedModelsCache();
        const snapshot = { models: normalizedModels, timestamp: Date.now() };
        cache[service] = snapshot;
        Storage.set(CONFIG.STORAGE_KEYS.FETCHED_MODELS, JSON.stringify(cache));
        return snapshot;
    },

    fetchModelsSnapshot: async (service, apiKey, baseUrl) => {
        const models = await AIService.fetchModels(service, apiKey, baseUrl);
        const snapshot = AIService.persistFetchedModels(service, models);
        return { models: snapshot.models, timestamp: snapshot.timestamp };
    },

    fetchModels: async (service, apiKey, baseUrl) => {
        if (service === "openai") {
            return await AIService.fetchOpenAIModels(apiKey, baseUrl);
        } else if (service === "claude") {
            // Claude 没有公开的模型列表 API，返回预设列表
            return AIService.PROVIDERS.claude.models;
        } else if (service === "gemini") {
            return await AIService.fetchGeminiModels(apiKey, baseUrl);
        }
        throw new Error(`不支持的 AI 服务: ${service}`);
    },

    // 获取 OpenAI 模型列表
    fetchOpenAIModels: (apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1");
        const url = normalizedBase
            ? `${normalizedBase}/v1/models`
            : "https://api.openai.com/v1/models";

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                },
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            // 过滤出聊天模型
                            const chatModels = (result.data || [])
                                .filter(m => m.id.includes("gpt") || m.id.includes("o1") || m.id.includes("o3"))
                                .map(m => m.id)
                                .sort((a, b) => {
                                    // 优先显示常用模型
                                    const priority = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"];
                                    const aIdx = priority.findIndex(p => a.startsWith(p));
                                    const bIdx = priority.findIndex(p => b.startsWith(p));
                                    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                                    if (aIdx !== -1) return -1;
                                    if (bIdx !== -1) return 1;
                                    return a.localeCompare(b);
                                });
                            resolve(chatModels.length > 0 ? chatModels : AIService.PROVIDERS.openai.models);
                        } else {
                            reject(new Error(result.error?.message || `获取模型失败: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 15000,
                ontimeout: () => reject(new Error("获取模型列表超时")),
            });
        });
    },

    // 获取 Gemini 模型列表
    fetchGeminiModels: (apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
        const normalizedBase = AIService._normalizeBaseUrl(baseUrl, "v1beta");
        const url = normalizedBase
            ? `${normalizedBase}/v1beta/models`
            : `https://generativelanguage.googleapis.com/v1beta/models`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                },
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            // 过滤出支持 generateContent 的模型
                            const models = (result.models || [])
                                .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
                                .map(m => m.name.replace("models/", ""))
                                .filter(m => m.includes("gemini"))
                                .sort((a, b) => {
                                    // 优先显示常用模型
                                    const priority = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
                                    const aIdx = priority.findIndex(p => a.startsWith(p));
                                    const bIdx = priority.findIndex(p => b.startsWith(p));
                                    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                                    if (aIdx !== -1) return -1;
                                    if (bIdx !== -1) return 1;
                                    return a.localeCompare(b);
                                });
                            resolve(models.length > 0 ? models : AIService.PROVIDERS.gemini.models);
                        } else {
                            reject(new Error(result.error?.message || `获取模型失败: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 15000,
                ontimeout: () => reject(new Error("获取模型列表超时")),
            });
        });
    },
};
// ═══════════════════════════════════════════════════════
// 💬 Chat State — 对话状态管理
// ═══════════════════════════════════════════════════════
const ChatState = {
    messages: [],
    isProcessing: false,
    context: {},
    MAX_HISTORY: 50,

    // 添加消息
    addMessage: (role, content, status = "complete") => {
        ChatState.messages.push({
            id: Date.now(),
            role,  // "user" | "assistant"
            content,
            status,  // "complete" | "processing" | "error"
            timestamp: new Date().toISOString()
        });
        // 限制历史记录数量
        if (ChatState.messages.length > ChatState.MAX_HISTORY) {
            ChatState.messages = ChatState.messages.slice(-ChatState.MAX_HISTORY);
        }
        ChatState.save();
        ChatUI.renderMessages();
        return ChatState.messages[ChatState.messages.length - 1];
    },

    // 更新最后一条消息（增量 DOM 更新，避免全量重渲染）（PERF-006）
    updateLastMessage: (content, status) => {
        if (ChatState.messages.length === 0) return;
        const lastMsg = ChatState.messages[ChatState.messages.length - 1];
        if (content !== undefined) lastMsg.content = content;
        if (status !== undefined) lastMsg.status = status;
        ChatState.save();
        // 快速路径：仅更新最后一个气泡的 DOM，不重建整棵消息树
        if (!ChatUI._patchLastBubble()) {
            ChatUI.renderMessages();
        }
    },

    // 保存到存储
    save: () => {
        Storage.set(CONFIG.STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(ChatState.messages));
    },

    // 从存储加载
    load: () => {
        try {
            const data = Storage.get(CONFIG.STORAGE_KEYS.CHAT_HISTORY, "[]");
            ChatState.messages = JSON.parse(data);
        } catch (error) {
            console.warn("[LD-Notion] 聊天历史加载失败:", error);
            ChatState.messages = [];
        }
    },

    // 清空对话
    clear: () => {
        ChatState.messages = [];
        ChatState.context = {};
        ChatState.save();
        ChatUI.renderMessages();
    },
};

// ═══════════════════════════════════════════════════════
// 🎯 Intent Patterns & Rules — 意图分类规则
// ═══════════════════════════════════════════════════════
const QUICK_INTENT_PATTERNS = Object.freeze({
    blockId: /\bblock[_:-]?([A-Za-z0-9-]{6,})\b/i,
    commentId: /\bcomment[_:-]?([A-Za-z0-9-]{3,})\b/i,
    notionUrl: /https?:\/\/(?:www\.)?notion\.so\/\S+/i,
    url: /https?:\/\/\S+/i,
    emoji: /[\p{Extended_Pictographic}]/u,
    commentReplyTail: /\bcomment[_:-]?([A-Za-z0-9-]{3,})\b[：:]\s*(.+)$/i,
    replyVerb: /(回复|reply|回覆)/i,
    commentReadVerb: /(查看|读取|显示|详情|comment)/i,
    restoreVerb: /(恢复|还原|取消归档|取消存档|移出归档|从归档恢复)/,
    archiveVerb: /(归档|删除到归档|软删除|移到归档|放到归档|送到归档)/,
    unlockVerb: /(?:解锁|取消锁定|取消上锁|取消锁住|\bunlock\b)/i,
    lockVerb: /(?:锁定|锁住|上锁|\block\b)/i,
    iconKeyword: /(图标|icon)/i,
    coverKeyword: /(封面|cover)/i,
    markdownKeyword: /(markdown|md|原文|全文)/i,
    commentKeyword: /(评论|讨论)/,
    commentReadKeyword: /(查看|读取|列出|显示)/,
    databaseKeyword: /(数据库|db|database)/i,
    schemaKeyword: /(结构|schema|字段|属性|列)/i,
    detailKeyword: /(详情|信息|对象|看看|读取)/,
    blockUpdateVerb: /(改成|修改为|更新为|替换为)/,
    appendVerb: /(插入|追加|添加)/,
    pageKeyword: /(页面|page)/i,
    blockStructurePhrase: /(块结构|子块)/,
    blockKeyword: /block/i,
    objectReadVerb: /(查看|读取|详情|对象|fetch)/i,
    rawIdReadVerb: /(查看|读取|详情|对象|页面|数据库)/,
    afterBlockKeyword: /(后插入|后面插入|后追加|after)/i,
});

const QUICK_INTENT_RULES = Object.freeze([
    {
        id: "comment.reply",
        intent: "create_comment",
        priority: 1000,
        requires: ["commentId", "hasReplyVerb", "commentReplyContent"],
        buildResult: (ctx) => ({
            intent: "create_comment",
            params: {
                comment_id: ctx.commentId,
                content: ctx.commentReplyContent
            },
            explanation: "根据明确的 comment_id 回复已有评论"
        })
    },
    {
        id: "comment.detail",
        intent: "get_comment",
        priority: 990,
        requires: ["commentId", "hasCommentReadVerb"],
        rejects: ["hasReplyVerb"],
        buildResult: (ctx) => ({
            intent: "get_comment",
            params: { comment_id: ctx.commentId },
            explanation: "根据明确的 comment_id 读取评论详情"
        })
    },
    {
        id: "page.restore",
        intent: "restore_page",
        priority: 950,
        requires: ["firstQuoted", "hasRestoreVerb"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "restore_page",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称恢复页面"
        })
    },
    {
        id: "page.archive",
        intent: "archive_page",
        priority: 940,
        requires: ["firstQuoted", "hasArchiveVerb"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "archive_page",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称归档页面"
        })
    },
    {
        id: "page.unlock",
        intent: "update_page",
        priority: 930,
        requires: ["firstQuoted", "hasUnlockVerb"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, is_locked: false },
            explanation: "根据明确的页面名称解锁页面"
        })
    },
    {
        id: "page.lock",
        intent: "update_page",
        priority: 920,
        requires: ["firstQuoted", "hasLockVerb"],
        rejects: ["hasUnlockVerb", "hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, is_locked: true },
            explanation: "根据明确的页面名称锁定页面"
        })
    },
    {
        id: "page.icon",
        intent: "update_page",
        priority: 910,
        requires: ["firstQuoted", "hasIconKeyword", "emoji"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, icon_emoji: ctx.emoji },
            explanation: "根据明确的页面名称更新页面图标"
        })
    },
    {
        id: "page.cover",
        intent: "update_page",
        priority: 900,
        requires: ["firstQuoted", "hasCoverKeyword", "url"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, cover_url: ctx.url },
            explanation: "根据明确的页面名称更新页面封面"
        })
    },
    {
        id: "page.markdown",
        intent: "fetch_page_markdown",
        priority: 890,
        requires: ["firstQuoted", "hasMarkdownKeyword"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "fetch_page_markdown",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称读取页面 Markdown"
        })
    },
    {
        id: "page.comments",
        intent: "get_comments",
        priority: 880,
        requires: ["firstQuoted", "hasPageCommentReadIntent"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "get_comments",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称读取页面评论"
        })
    },
    {
        id: "database.schema",
        intent: "get_database_schema",
        priority: 870,
        requires: ["firstQuoted", "hasDatabaseKeyword", "hasSchemaKeyword"],
        rejects: ["hasPageKeyword", "hasBlockStructurePhrase"],
        buildResult: (ctx) => ({
            intent: "get_database_schema",
            params: { database_name: ctx.firstQuoted },
            explanation: "根据明确的数据库名称读取数据库结构"
        })
    },
    {
        id: "database.detail",
        intent: "fetch_notion_object",
        priority: 860,
        requires: ["firstQuoted", "hasDatabaseKeyword", "hasDetailKeyword"],
        rejects: ["hasPageKeyword", "hasMarkdownKeyword"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.firstQuoted, type: "database" },
            explanation: "根据明确的数据库名称读取对象详情"
        })
    },
    {
        id: "page.append",
        intent: "append_block_children",
        priority: 850,
        requires: ["firstQuoted", "hasAppendVerb", "hasMultipleQuotedTexts", "hasPageKeyword"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "append_block_children",
            params: {
                page_name: ctx.firstQuoted,
                content: ctx.lastQuoted,
                insert_position: "end"
            },
            explanation: "根据明确的页面名称插入内容块"
        })
    },
    {
        id: "block.update",
        intent: "update_block_content",
        priority: 840,
        requires: ["blockId", "hasBlockUpdateVerb", "quoted"],
        buildResult: (ctx) => ({
            intent: "update_block_content",
            params: {
                block_id: ctx.blockId,
                content: ctx.quoted
            },
            explanation: "根据明确的 block_id 更新块内容"
        })
    },
    {
        id: "block.append",
        intent: "append_block_children",
        priority: 830,
        requires: ["blockId", "hasAppendVerb", "quoted"],
        buildResult: (ctx) => {
            const insertPosition = ctx.hasAfterBlockKeyword ? "after_block" : "end";
            return {
                intent: "append_block_children",
                params: {
                    block_id: ctx.blockId,
                    content: ctx.quoted,
                    insert_position: insertPosition,
                    after_block_id: insertPosition === "after_block" ? ctx.blockId : undefined
                },
                explanation: "根据明确的 block_id 插入内容块"
            };
        }
    },
    {
        id: "page.blocks",
        intent: "fetch_page_blocks",
        priority: 820,
        requires: ["firstQuoted", "hasBlockStructurePhrase", "hasPageKeyword"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "fetch_page_blocks",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称查看块结构"
        })
    },
    {
        id: "block.blocks",
        intent: "fetch_page_blocks",
        priority: 810,
        requires: ["hasBlockStructureIntent"],
        rejects: ["hasDatabaseKeyword"],
        when: (ctx) => !!ctx.blockId || !ctx.firstQuoted,
        buildResult: (ctx) => ({
            intent: "fetch_page_blocks",
            params: ctx.blockId ? { block_id: ctx.blockId } : {},
            explanation: "查看块结构"
        })
    },
    {
        id: "notion.url.object",
        intent: "fetch_notion_object",
        priority: 800,
        requires: ["notionUrl", "hasObjectReadVerb"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.notionUrl },
            explanation: "根据明确的 Notion 链接读取对象详情"
        })
    },
    {
        id: "notion.id.object",
        intent: "fetch_notion_object",
        priority: 790,
        requires: ["rawNotionId", "hasRawIdReadVerb"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.rawNotionId },
            explanation: "根据明确的 Notion ID 读取对象详情"
        })
    },
    {
        id: "page.detail",
        intent: "fetch_notion_object",
        priority: 780,
        requires: ["firstQuoted", "hasDetailKeyword"],
        rejects: ["hasDatabaseKeyword", "hasBlockStructurePhrase"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.firstQuoted, type: "page" },
            explanation: "根据明确的页面名称读取对象详情"
        })
    }
]);

// AI 助手模块
// ===========================================
// ===========================================
// AI Agent 工具定义
// ===========================================
// ═══════════════════════════════════════════════════════
// 🔧 Agent Tools — AI Agent 工具定义
// ═══════════════════════════════════════════════════════
// AI_AGENT_TOOLS 已迁移至 src/ai/AgentTools.js（W6-1 ARCH-002）。
// 块内 AIAssistant./AIService. 引用经 lazy accessor 解循环；本文件顶部已 require 并 re-export。
// ===========================================
// AI Handlers — 意图执行处理器
// ===========================================
// ═══════════════════════════════════════════════════════
// 📨 AI Handlers — 消息处理与工具调度
// ═══════════════════════════════════════════════════════
// AIHandlers 已迁移至 src/ai/Handlers.js（W6-2 ARCH-001/004）。
// Object.assign(AIAssistant, AIHandlers) mixin 机制保留——本行下方 4758 行处仍执行，
// 32 方法经 mixin 进 AIAssistant，38 处调用点 + 模块级初始化零改动。
// ═══════════════════════════════════════════════════════
// 🧠 AI Assistant — 对话协调与流程控制
// ═══════════════════════════════════════════════════════
const AIAssistant = {
    // 意图类型
    INTENTS: {
        QUERY: "query",           // 查询/统计
        SEARCH: "search",         // 搜索（数据库内）
        WORKSPACE_SEARCH: "workspace_search",  // 工作区搜索（全局）
        CLASSIFY: "classify",     // 分类单个
        BATCH_CLASSIFY: "batch_classify",  // 批量分类
        UPDATE: "update",         // 更新属性
        MOVE: "move",             // 移动页面
        COPY: "copy",             // 复制页面
        CREATE_DATABASE: "create_database",  // 创建数据库
        WRITE_CONTENT: "write_content",      // AI 生成内容追加到页面
        EDIT_CONTENT: "edit_content",        // AI 改写页面内容
        TRANSLATE_CONTENT: "translate_content", // AI 翻译页面内容
        AI_AUTOFILL: "ai_autofill",          // 批量 AI 属性填充
        ASK: "ask",                          // 全局问答（RAG）
        AGENT_TASK: "agent_task",            // Agent 自主代理
        DEEP_RESEARCH: "deep_research",      // 深度研究
        TEMPLATE_OUTPUT: "template_output",  // AI 模板输出
        SUMMARIZE: "summarize",              // 总结/摘要
        BRAINSTORM: "brainstorm",            // 头脑风暴/创意生成
        PROOFREAD: "proofread",              // 校对/纠错/润色
        BATCH_TRANSLATE: "batch_translate",    // 批量翻译数据库
        EXTRACT_TO_DB: "extract_to_database",  // 内容提取为数据库
        GENERATE_PAGES: "generate_pages",      // 多页面结构化生成
        BATCH_ANALYZE: "batch_analyze",        // 批量页面分析
        BOOKMARK_IMPORT: "bookmark_import",    // 导入浏览器书签
        HELP: "help",             // 帮助
        COMPOUND: "compound",     // 组合指令
        UNKNOWN: "unknown"        // 未知
    },

    _formatUserSummary: (user) => {
        if (!user) return "未知用户";
        const kind = user.type === "bot" ? "bot" : "person";
        const name = user.name || user.bot?.owner?.workspace_name || user.person?.email || "未命名用户";
        const email = user.person?.email ? ` <${user.person.email}>` : "";
        const id = user.id?.replace(/-/g, "") || "";
        return `${name}${email} [${kind}]${id ? ` (ID: ${id})` : ""}`;
    },

    _collectWorkspaceUsers: async (apiKey, limit = 20) => {
        const users = [];
        let cursor = null;

        while (users.length < limit) {
            const response = await NotionAPI.getUsers(cursor, apiKey);
            users.push(...(response.results || []));
            if (!response.has_more || !response.next_cursor) break;
            cursor = response.next_cursor;
        }

        return users.slice(0, limit);
    },

    _resolveUserIdentity: async (userId, query, apiKey, limit = 100) => {
        if (userId) {
            return await NotionAPI.getUser(userId.replace(/-/g, ""), apiKey);
        }

        const keyword = String(query || "").trim().toLowerCase();
        if (!keyword) return null;

        const users = await AIAssistant._collectWorkspaceUsers(apiKey, limit);
        let partial = null;

        for (const user of users) {
            const name = String(user.name || "").trim().toLowerCase();
            const email = String(user.person?.email || "").trim().toLowerCase();

            if (name === keyword || email === keyword) return user;
            if (!partial && (name.includes(keyword) || email.includes(keyword))) {
                partial = user;
            }
        }

        return partial;
    },

    _formatCommentSummary: (comment) => {
        const author = comment.created_by?.name || comment.created_by?.person?.email || comment.created_by?.id || "未知用户";
        const text = (comment.rich_text || []).map(rt => rt.plain_text || "").join("").trim() || "(空评论)";
        const commentId = comment.id?.replace(/-/g, "") || "";
        const discussionId = comment.discussion_id?.replace(/-/g, "") || "";
        const created = comment.created_time || "";
        return `- ${author}: ${text}${created ? ` [${created}]` : ""}${discussionId ? ` (discussion: ${discussionId})` : ""}${commentId ? ` (id: ${commentId})` : ""}`;
    },

    _buildStructuredResultText: ({ title, summary = "", fields = [], bullets = [] } = {}) => {
        const lines = [];
        if (title) lines.push(`**${title}**`);
        if (summary) lines.push(summary);
        if (fields.length > 0) {
            fields.forEach(({ label, value }) => {
                lines.push(`- ${label}: ${value}`);
            });
        }
        if (bullets.length > 0) {
            bullets.forEach((item) => lines.push(`- ${item}`));
        }
        return lines.join("\n").trim();
    },

    _isStructuredResult: (value) => !!(value && typeof value === "object" && value.type === "assistant_result"),

    _inferStructuredResultStatus: (text) => {
        const raw = String(text || "").trim();
        if (!raw) return "success";
        if (/^(❌|错误[:：])/u.test(raw)) return "error";
        if (/^(没有找到|未找到|工作区中没有|数据库中没有|页面或块.+没有|暂无)/u.test(raw)) return "empty";
        return "success";
    },

    _createStructuredResult: ({ status = "success", title = "", summary = "", fields = [], bullets = [], text = "", source = "intent", name = "" } = {}) => {
        const normalizedFields = Array.isArray(fields)
            ? fields.map(({ label, value }) => ({ label: String(label || ""), value }))
            : [];
        const normalizedBullets = Array.isArray(bullets)
            ? bullets.map((item) => String(item))
            : [];
        const normalizedSummary = String(summary || "").trim();
        const finalText = String(text || "").trim() || AIAssistant._buildStructuredResultText({
            title,
            summary: normalizedSummary,
            fields: normalizedFields,
            bullets: normalizedBullets,
        });

        return {
            type: "assistant_result",
            version: 1,
            source,
            name,
            status,
            title: String(title || ""),
            summary: normalizedSummary,
            fields: normalizedFields,
            bullets: normalizedBullets,
            text: finalText,
        };
    },

    _formatToolResult: ({ status = "success", ...payload } = {}) => {
        return AIAssistant._createStructuredResult({
            ...payload,
            status,
            source: "tool",
        });
    },

    _normalizeExecutionResult: (result, { source = "intent", name = "", status } = {}) => {
        if (AIAssistant._isStructuredResult(result)) {
            return AIAssistant._createStructuredResult({
                ...result,
                source: result.source || source,
                name: result.name || name,
                status: result.status || status || "success",
            });
        }

        const text = String(result ?? "").trim();
        return AIAssistant._createStructuredResult({
            status: status || AIAssistant._inferStructuredResultStatus(text),
            source,
            name,
            summary: text,
            text,
        });
    },

    _resultToText: (result) => AIAssistant._normalizeExecutionResult(result).text,

    _resultToAgentPayload: (result) => {
        return JSON.stringify(AIAssistant._normalizeExecutionResult(result), null, 2);
    },

    _isErrorResult: (result) => AIAssistant._normalizeExecutionResult(result).status === "error",

    _buildPageIconPayload: (args = {}) => {
        const iconEmoji = AISchema.validateEmoji(args.icon_emoji || "");
        const iconUrlRaw = String(args.icon_url || "").trim();
        const clearIcon = !!args.clear_icon;

        if (clearIcon) return null;
        if (iconEmoji) return { type: "emoji", emoji: iconEmoji };
        // icon_url 来自 AI 输出（prompt injection 面），必须经 schema 校验：
        // 限定 http(s) + 拒内网/169.254（防 Notion 服务端抓取 SSRF，ISS-20260723-009 H1）。
        // 校验失败跳过该字段（icon 非必需，页面仍可创建），返回 undefined。
        if (iconUrlRaw) {
            if (!AISchema.validatePageExternalUrl(iconUrlRaw)) {
                console.warn("[LD-Notion] AI 返回的 icon_url 未通过安全校验，已跳过:", iconUrlRaw.slice(0, 80));
                return undefined;
            }
            return { type: "external", external: { url: iconUrlRaw } };
        }
        return undefined;
    },

    _buildPageCoverPayload: (args = {}) => {
        const coverUrlRaw = String(args.cover_url || "").trim();
        const clearCover = !!args.clear_cover;

        if (clearCover) return null;
        // cover_url 同 icon_url，经 schema 校验防 SSRF。校验失败跳过。
        if (coverUrlRaw) {
            if (!AISchema.validatePageExternalUrl(coverUrlRaw)) {
                console.warn("[LD-Notion] AI 返回的 cover_url 未通过安全校验，已跳过:", coverUrlRaw.slice(0, 80));
                return undefined;
            }
            return { type: "external", external: { url: coverUrlRaw } };
        }
        return undefined;
    },

    _normalizeNotionProperties: (rawProperties = {}) => {
        const properties = {};
        for (const [rawKey, value] of Object.entries(rawProperties || {})) {
            // key 来自 AI 输出，经 schema 校验（白名单+截断+拒 Notion 保留名），ISS-20260723-009 M1
            const key = AISchema.validatePropertyName(rawKey);
            if (!key || value === undefined) continue;

            if (value && typeof value === "object" && !Array.isArray(value)) {
                // 对象值经白名单清洗：仅允许 title/rich_text/number/select 等，
                // 拒 relation/people/files/created_by/created_time 等系统/关联字段（M2）
                const cleaned = AISchema.sanitizeObjectValue(value);
                if (cleaned) {
                    // M3（ISS-009 消费点补全）：对象值内的标量再按 type 校验/截断，
                    // 与 _buildPropertyValuePayload 一致——url/email/phone_number 走 validatePropertyValue
                    // 截断 + 基本 http(s) 校验（url 类），防 AI 注入 javascript: 等协议污染 Notion url 属性。
                    for (const propType of Object.keys(cleaned)) {
                        const scalar = cleaned[propType];
                        if (propType === "url" || propType === "email" || propType === "phone_number") {
                            const validated = AISchema.validatePropertyValue(scalar, propType);
                            if (validated !== null && validated !== "") {
                                cleaned[propType] = validated;
                            } else {
                                delete cleaned[propType];
                            }
                        }
                    }
                    if (Object.keys(cleaned).length > 0) properties[key] = cleaned;
                }
                continue;
            }

            if (Array.isArray(value)) {
                const options = value.map(v => String(v || "").trim()).filter(Boolean)
                    .map((v) => v.slice(0, 100)).map(name => ({ name }));
                if (options.length > 0) {
                    properties[key] = { multi_select: options };
                }
                continue;
            }

            if (typeof value === "number") {
                // 拒 Infinity/NaN/超大数（M2: Number('Infinity')→Infinity 无 isFinite 闸门）
                if (!isFinite(value) || Math.abs(value) > 1e15) continue;
                properties[key] = { number: value };
                continue;
            }

            if (typeof value === "boolean") {
                properties[key] = { checkbox: value };
                continue;
            }

            properties[key] = {
                rich_text: [{ type: "text", text: { content: String(value).slice(0, 2000) } }]
            };
        }

        return properties;
    },

    _buildPropertyValuePayload: (value, type = "text") => {
        // 经 schema 校验+截断（ISS-20260723-009 M1）：title/rich_text ≤2000、select ≤100、
        // number isFinite+有限范围、date ISO8601。校验返回 null 则回退 rich_text 兜底。
        const v = AISchema.validatePropertyValue(value, type);
        switch (type) {
            case "title":
                return { title: [{ type: "text", text: { content: v !== null ? String(v) : "" } }] };
            case "select":
                return { select: { name: v !== null ? String(v) : "" } };
            case "multi_select": {
                const arr = Array.isArray(v) ? v : (v !== null ? [String(v)] : []);
                return { multi_select: arr.map(name => ({ name })) };
            }
            case "number":
                return { number: v !== null ? v : 0 };
            case "date":
                return { date: { start: v !== null ? String(v) : "" } };
            case "checkbox":
                return { checkbox: !!value };
            default:
                return { rich_text: [{ type: "text", text: { content: String(value).slice(0, 2000) } }] };
        }
    },

    _buildPageMetaPayload: (args = {}) => {
        const payload = {};
        const icon = AIAssistant._buildPageIconPayload(args);
        const cover = AIAssistant._buildPageCoverPayload(args);
        if (icon !== undefined) payload.icon = icon;
        if (cover !== undefined) payload.cover = cover;
        if (typeof args.is_locked === "boolean") payload.is_locked = args.is_locked;
        return payload;
    },

    _buildPageUpdatePayloads: (params = {}) => {
        const propertyUpdates = {};
        if (params.updates && typeof params.updates === "object") {
            Object.assign(propertyUpdates, AIAssistant._normalizeNotionProperties(params.updates));
        }
        if (params.property) {
            if (params.value === undefined || params.value === null) {
                return { error: "更新属性时必须提供 value。" };
            }
            propertyUpdates[params.property] = AIAssistant._buildPropertyValuePayload(params.value, params.type || "text");
        }

        const metaPayload = AIAssistant._buildPageMetaPayload(params);
        if (Object.keys(propertyUpdates).length === 0 && Object.keys(metaPayload).length === 0) {
            return { error: "请提供可更新内容。可更新属性，或传入 icon_emoji/icon_url/cover_url/is_locked 等元数据。" };
        }

        return { propertyUpdates, metaPayload };
    },

    _applyPageUpdatesToTargets: async (targets, params, settings) => {
        const built = AIAssistant._buildPageUpdatePayloads(params);
        if (built.error) {
            throw new Error(built.error);
        }

        const { propertyUpdates, metaPayload } = built;
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        let success = 0;
        let failed = 0;

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            try {
                if (Object.keys(propertyUpdates).length > 0) {
                    await AIAssistant._executeGuardedPageWrite("updatePage", target,
                        () => NotionAPI.updatePage(target.id, propertyUpdates, settings.notionApiKey),
                        settings
                    );
                }
                if (Object.keys(metaPayload).length > 0) {
                    await AIAssistant._executeGuardedPageWrite("updatePage", target,
                        () => NotionAPI.updatePageMeta(target.id, metaPayload, settings.notionApiKey),
                        settings
                    );
                }
                success++;
            } catch (error) {
                console.warn("[LD-Notion] 页面元数据更新失败:", error);
                failed++;
            }

            if (i < targets.length - 1) {
                await Utils.sleep(delay);
            }
        }

        return { success, failed, propertyUpdates, metaPayload };
    },

    _extractBlockPlainText: (block) => {
        if (!block || !block.type) return "";
        const content = block[block.type];
        if (!content || typeof content !== "object") return "";

        const collect = (arr) => Array.isArray(arr) ? arr.map(item => item?.plain_text || item?.text?.content || "").join("") : "";

        const richText = collect(content.rich_text);
        if (richText) return richText;
        const titleText = collect(content.title);
        if (titleText) return titleText;
        const captionText = collect(content.caption);
        if (captionText) return captionText;
        if (typeof content.expression === "string") return content.expression;
        if (typeof content.url === "string") return content.url;
        return "";
    },

    _formatBlockSummary: (block, depth = 0) => {
        const id = block.id?.replace(/-/g, "") || "";
        const type = block.type || "unknown";
        const text = AIAssistant._extractBlockPlainText(block).replace(/\s+/g, " ").trim();
        const indent = "  ".repeat(depth);
        return `${indent}- [${type}] ${text || "(无文本内容)"}${block.has_children ? " [+children]" : ""}${id ? ` (id: ${id})` : ""}`;
    },

    _buildBlockUpdatePayload: (block, content, options = {}) => {
        // W4 (MAINT-005): 实现已迁移至 src/ai/BlockConverter.js，此处为向后兼容转发壳。
        return BlockConverter.buildBlockUpdatePayload(block, content, options);
    },

    _collectBlockTree: async (rootBlockId, apiKey, maxNodes = 50, maxDepth = 2) => {
        const collected = [];

        const walk = async (blockId, depth) => {
            if (collected.length >= maxNodes) return;

            let cursor = null;
            do {
                const response = await NotionAPI.fetchBlocks(blockId, cursor, apiKey);
                const blocks = response.results || [];
                for (const block of blocks) {
                    collected.push({
                        ...block,
                        _depth: depth,
                    });
                    if (collected.length >= maxNodes) return;
                    if (block.has_children && depth + 1 < maxDepth) {
                        await walk(block.id, depth + 1);
                        if (collected.length >= maxNodes) return;
                    }
                }
                cursor = response.has_more ? response.next_cursor : null;
            } while (cursor && collected.length < maxNodes);
        };

        await walk(rootBlockId, 0);
        return collected;
    },

    _resolvePageTargets: async (params, settings) => {
        const {
            page_ids,
            page_id,
            page_name,
            page_title,
            database_name,
            database_id,
            limit = 20,
        } = params || {};

        const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

        if (Array.isArray(page_ids) && page_ids.length > 0) {
            const targets = [];
            for (const rawId of page_ids.slice(0, safeLimit)) {
                const parsedId = Utils.extractNotionId(rawId) || String(rawId).replace(/-/g, "");
                if (!parsedId) continue;
                try {
                    const page = await NotionAPI.fetchPage(parsedId, settings.notionApiKey);
                    targets.push({
                        id: parsedId,
                        name: Utils.getPageTitle(page, parsedId),
                        raw: page,
                    });
                } catch (error) {
                    console.warn(`[LD-Notion] 页面获取失败: ${parsedId}`, error);
                    targets.push({
                        id: parsedId,
                        name: parsedId,
                        raw: null,
                    });
                }
            }
            return targets;
        }

        if (page_id || page_name) {
            const resolved = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (resolved?.error) return resolved;
            if (!resolved) return null;
            return [{ id: resolved.id, name: resolved.name }];
        }

        let source = null;
        if (database_id || database_name) {
            source = await AIAssistant._resolveDatabaseId(database_name, database_id, settings.notionApiKey);
            if (source?.error) return source;
        } else if (settings.notionDatabaseId) {
            source = { id: settings.notionDatabaseId.replace(/-/g, ""), name: "已配置的数据库" };
        }

        if (!source) return null;

        const pages = await AIAssistant._fetchSourcePages(source.id, settings.notionApiKey, page_title);
        return pages.slice(0, safeLimit).map((page) => ({
            id: page.id?.replace(/-/g, "") || "",
            name: Utils.getPageTitle(page),
            raw: page,
        }));
    },

    _buildQuickIntentContext: (userMessage) => {
        const text = String(userMessage || "").trim();
        if (!text) return null;

        const quotedTexts = Utils.extractQuotedTexts(text);
        const blockMatch = text.match(QUICK_INTENT_PATTERNS.blockId);
        const commentMatch = text.match(QUICK_INTENT_PATTERNS.commentId);
        const notionUrlMatch = text.match(QUICK_INTENT_PATTERNS.notionUrl);
        const urlMatch = text.match(QUICK_INTENT_PATTERNS.url);
        const emojiMatch = text.match(QUICK_INTENT_PATTERNS.emoji);
        const commentReplyTail = text.match(QUICK_INTENT_PATTERNS.commentReplyTail);
        const quoted = Utils.extractQuotedText(text);
        const commentReplyContent = quoted || String(commentReplyTail?.[2] || "").trim();

        return {
            text,
            quoted,
            quotedTexts,
            firstQuoted: quotedTexts[0] || "",
            lastQuoted: quotedTexts[quotedTexts.length - 1] || "",
            hasMultipleQuotedTexts: quotedTexts.length >= 2,
            blockId: blockMatch ? blockMatch[1] : "",
            commentId: commentMatch ? commentMatch[1] : "",
            notionUrl: notionUrlMatch ? notionUrlMatch[0] : "",
            rawNotionId: Utils.extractNotionId(text),
            url: urlMatch ? urlMatch[0] : "",
            emoji: emojiMatch ? emojiMatch[0] : "",
            commentReplyContent,
            hasReplyVerb: QUICK_INTENT_PATTERNS.replyVerb.test(text),
            hasCommentReadVerb: QUICK_INTENT_PATTERNS.commentReadVerb.test(text),
            hasRestoreVerb: QUICK_INTENT_PATTERNS.restoreVerb.test(text),
            hasArchiveVerb: QUICK_INTENT_PATTERNS.archiveVerb.test(text),
            hasUnlockVerb: QUICK_INTENT_PATTERNS.unlockVerb.test(text),
            hasLockVerb: QUICK_INTENT_PATTERNS.lockVerb.test(text),
            hasIconKeyword: QUICK_INTENT_PATTERNS.iconKeyword.test(text),
            hasCoverKeyword: QUICK_INTENT_PATTERNS.coverKeyword.test(text),
            hasMarkdownKeyword: QUICK_INTENT_PATTERNS.markdownKeyword.test(text),
            hasDatabaseKeyword: QUICK_INTENT_PATTERNS.databaseKeyword.test(text),
            hasPageKeyword: QUICK_INTENT_PATTERNS.pageKeyword.test(text),
            hasSchemaKeyword: QUICK_INTENT_PATTERNS.schemaKeyword.test(text),
            hasDetailKeyword: QUICK_INTENT_PATTERNS.detailKeyword.test(text),
            hasBlockUpdateVerb: QUICK_INTENT_PATTERNS.blockUpdateVerb.test(text),
            hasAppendVerb: QUICK_INTENT_PATTERNS.appendVerb.test(text),
            hasBlockStructurePhrase: QUICK_INTENT_PATTERNS.blockStructurePhrase.test(text),
            hasBlockKeyword: QUICK_INTENT_PATTERNS.blockKeyword.test(text),
            hasObjectReadVerb: QUICK_INTENT_PATTERNS.objectReadVerb.test(text),
            hasRawIdReadVerb: QUICK_INTENT_PATTERNS.rawIdReadVerb.test(text),
            hasAfterBlockKeyword: QUICK_INTENT_PATTERNS.afterBlockKeyword.test(text),
            hasPageCommentReadIntent: QUICK_INTENT_PATTERNS.commentKeyword.test(text) && QUICK_INTENT_PATTERNS.commentReadKeyword.test(text),
            hasBlockStructureIntent: !!blockMatch || QUICK_INTENT_PATTERNS.blockStructurePhrase.test(text),
        };
    },

    _matchesQuickIntentRule: (rule, ctx) => {
        if ((rule.requires || []).some((key) => !ctx[key])) {
            return false;
        }
        if ((rule.rejects || []).some((key) => !!ctx[key])) {
            return false;
        }
        if (typeof rule.when === "function" && !rule.when(ctx)) {
            return false;
        }
        return true;
    },

    quickParseIntent: (userMessage) => {
        return AIAssistant.IntentMatcher.parse(userMessage);
    },

    // ===========================================
    // Agent 工具注册表
    // ===========================================
    AGENT_TOOLS: AI_AGENT_TOOLS,

    // 获取帮助信息
    getHelpMessage: () => {
        const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        return `🤖 **我是${personaName}**

直接用自然语言告诉我你想做什么。我现在稳定支持这些命令类别：

1. 工作区检索与对象查看
- "搜索关于 Docker 的内容"
- "查看这个 Notion 链接"
- "查看“知识库”数据库结构"
- "查看“项目计划”页面详情"
- "查看“项目计划”页面块结构"
- "读取“项目计划”页面 Markdown"

2. 评论与协作
- "查看“项目计划”页面评论"
- "查看 comment_xxx 这条评论"
- "回复 comment_xxx：收到，我来补充"
- "列出当前工作区可见用户"

3. 页面与块编辑
- "在“项目计划”页面末尾插入一段说明"
- "在 block_xxx 后插入“新增列表”"
- "把 block_xxx 改成“新的段落内容”"
- "把 equation 块 block_xxx 改成 E=mc^2"
- "把 bookmark / embed 块 block_xxx 改成新的 URL"
- "把“项目计划”页面换成 🚀 图标并加封面"

4. 页面整理与批量操作
- "归档“旧版方案”"
- "恢复“项目计划”"
- "创建一个叫“周报”的页面"
- "自动分类所有未分类的帖子"
- "归档标题包含旧版的所有页面"

5. 跨源导入与 AI 工作流
- "关于 Docker 的帖子都说了什么？"
- "深入研究一下关于 AI 的所有内容"
- "总结一下 xxx 页面的内容"
- "校对一下 xxx 页面的拼写和语法"
- "把整个数据库翻译成英文"
- "把这个页面的笔记提取为数据库"
- "为新员工创建入职指南（含子页面）"
- "导入 GitHub 收藏到 Notion"
- "导入浏览器书签"

说明：
- 直达快捷目前重点覆盖页面、块、评论和 Notion 对象；数据库直达短语目前以“结构 / 属性 / 字段 / 详情”为主。
- 我会自动选择合适的工具，并在复杂任务里分步执行。
- 只读 / 标准 / 高级 / 管理员四级权限仍然生效；移动、复制、整页 Markdown 替换、创建数据库等操作需要更高权限。`;
    },

    _SETTINGS_ADAPTERS: {},

    _getDefaultSettings: () => {
        // UI 由 ui 模块定义；ai↔ui 互引用构成循环依赖，运行时延迟 require
        const UI = require("../ui").UI;
        const panel = UI.panel;
        const refs = UI.refs || {};
        const exportState = TargetState.getExportState();
        return {
            notionApiKey: NotionOAuth.getAccessToken((refs.apiKeyInput || panel?.querySelector("#ldb-api-key"))?.value.trim()),
            notionDatabaseId: (refs.databaseIdInput || panel?.querySelector("#ldb-database-id"))?.value.trim() || exportState.databaseId,
            aiApiKey: (refs.aiApiKeyInput || panel?.querySelector("#ldb-ai-api-key"))?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
            aiService: (refs.aiServiceSelect || panel?.querySelector("#ldb-ai-service"))?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService),
            aiModel: (refs.aiModelSelect || panel?.querySelector("#ldb-ai-model"))?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, ""),
            aiBaseUrl: (refs.aiBaseUrlInput || panel?.querySelector("#ldb-ai-base-url"))?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
            categories: Utils.parseAICategories(
                (refs.aiCategoriesInput || panel?.querySelector("#ldb-ai-categories"))?.value.trim()
                    || Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories)
            ),
        };
    },

    registerSettingsAdapter: (name, adapter) => {
        if (!name || !adapter || typeof adapter.getSettings !== "function") {
            throw new Error("设置适配器必须提供名称和 getSettings 方法");
        }
        AIAssistant._SETTINGS_ADAPTERS[name] = {
            isActive: typeof adapter.isActive === "function" ? adapter.isActive : () => true,
            getSettings: adapter.getSettings,
        };
        return AIAssistant._SETTINGS_ADAPTERS[name];
    },

    unregisterSettingsAdapter: (name) => {
        delete AIAssistant._SETTINGS_ADAPTERS[name];
    },

    getActiveSettingsAdapter: () => {
        for (const [name, adapter] of Object.entries(AIAssistant._SETTINGS_ADAPTERS)) {
            try {
                if (adapter.isActive()) {
                    return { name, adapter };
                }
            } catch (error) {
                console.warn(`[LD-Notion] 设置适配器异常: ${name}`, error);
                // 适配器异常时回退到默认设置
            }
        }
        return null;
    },

    // 获取 AI 设置
    getSettings: () => {
        const activeAdapter = AIAssistant.getActiveSettingsAdapter();
        if (activeAdapter) {
            const adaptedSettings = activeAdapter.adapter.getSettings({
                getDefaultSettings: AIAssistant._getDefaultSettings
            });
            if (adaptedSettings) {
                return adaptedSettings;
            }
        }
        return AIAssistant._getDefaultSettings();
    },

    // 检查配置是否完整
    checkConfig: (settings, requireDatabase = true) => {
        if (!settings.notionApiKey) {
            return { valid: false, error: "请先配置 Notion API Key" };
        }
        if (requireDatabase && !settings.notionDatabaseId) {
            return { valid: false, error: "请先配置 Notion 数据库 ID（或使用「工作区搜索」功能）" };
        }
        if (!settings.aiApiKey) {
            return { valid: false, error: "请先配置 AI API Key" };
        }
        return { valid: true };
    },

    // 解析用户意图
    parseIntent: async (userMessage, settings) => {
        const systemPrompt = `你是一个 Notion 全功能助手。分析用户指令，返回 JSON 格式。

用户可能想执行以下操作之一：
1. query - 查询统计（如：有多少帖子、统计分类数量、显示最新帖子）
2. search - 在配置的数据库内搜索（如：搜索关于xxx的帖子、找作者是xxx的）
3. workspace_search - 在整个工作区搜索（如：全局搜索xxx、在工作区搜索、搜索所有页面、列出所有数据库）
4. classify - 分类单个（如：把这个帖子分类为技术）
5. batch_classify - 批量分类（如：自动分类所有未分类的帖子）
6. update - 更新页面属性或元数据（如：把xxx标记为重要、给xxx页面换封面、锁定xxx页面）
7. move - 移动页面到另一个数据库（如：把A数据库的帖子移到B数据库、把标题包含xxx的帖子移到B数据库）
8. copy - 复制页面到另一个数据库（如：把A数据库的帖子复制到B数据库、复制标题包含xxx的帖子到B数据库）
9. create_database - 创建新数据库（如：创建一个叫xxx的数据库、新建数据库、在xxx页面下创建数据库）
10. write_content - AI 生成新内容追加到指定页面（如：在xxx页面写一段关于Docker的介绍、给xxx页面添加内容）
11. edit_content - AI 改写页面现有内容（如：把xxx页面的内容改得更简洁、润色xxx页面）
12. translate_content - AI 翻译页面内容（如：把xxx页面翻译成英文、翻译xxx页面为日文）
13. ai_autofill - 批量 AI 属性填充（如：给所有帖子生成AI摘要、提取所有帖子的关键词、翻译所有帖子标题）
14. ask - 全局问答，AI 综合回答问题（如：关于Docker的帖子都说了什么、总结最近的帖子）
15. agent_task - Agent 自主规划并执行复杂任务（如：帮我整理所有帖子并生成摘要、自动分类后移到不同数据库）
16. deep_research - 深入研究特定主题，多关键词搜索后生成结构化研究报告（如：深入研究一下关于AI的所有内容、帮我调研xxx、综合分析xxx主题）
17. template_output - 使用AI输出模板生成内容（如：用周报模板总结xxx、用SWOT模板分析xxx、用摘要提纲模板整理xxx）
18. summarize - 总结/摘要页面内容（如：总结一下xxx页面、帮我概括xxx的内容、给xxx生成摘要）
19. brainstorm - 头脑风暴/创意生成（如：给我一些关于xxx的创意、围绕xxx做头脑风暴、帮我想10个xxx的方案）
20. proofread - 校对/纠正页面的拼写、语法和表达（如：校对一下xxx页面、帮我检查xxx的拼写和语法、纠正xxx页面的错误）
21. batch_translate - 批量翻译数据库中所有页面（如：把整个数据库翻译成日文、翻译xxx数据库的所有页面为英文）
22. extract_to_database - 从页面内容中提取结构化信息生成数据库（如：把这个页面的笔记转为数据库、从头脑风暴便利贴创建路线图数据库、把待办事项提取为任务数据库）
23. generate_pages - 生成多页面结构化内容（如：创建入职指南含子页面、生成竞品分析报告、创建包含多个部分的项目文档）
24. batch_analyze - 批量分析数据库中的页面并生成综合报告（如：分析团队项目生成周报、分析所有帖子找出趋势、综合分析数据库内容）
25. compound - 用户指令包含两个及以上需按顺序执行的不同操作（如：先分类再移动、分类后移到B数据库）
26. github_import - 导入 GitHub 收藏/Stars/Repos/Gists 到 Notion（如：导入GitHub收藏、同步我的GitHub Stars、把GitHub收藏导入到Notion、导入github星标仓库、导入我的仓库、导入Gists）
27. bookmark_import - 导入浏览器书签到 Notion（如：导入书签、同步浏览器收藏、把Chrome书签导入到Notion、整理我的书签）
28. fetch_notion_object - 按页面/数据库名称、URL 或 ID 读取对象详情（如：查看这个 Notion 链接、读取这个页面对象）
29. fetch_page_blocks - 查看页面或块的块结构（如：查看 xxx 页面的块结构、列出这个 block 的子块）
30. get_comment - 读取单条评论详情（如：查看 comment_xxx 这条评论）
31. create_comment - 创建评论或回复已有评论（如：在 xxx 页面评论“请补充示例”、回复 comment_xxx）
32. append_block_children - 向页面或块插入内容块（如：在 xxx 页面末尾插入一段说明、在 block_xxx 后插入列表）
33. update_block_content - 更新常见可编辑块内容（如：把 block_xxx 改成“新的内容”、把 equation 块改成公式、把 bookmark/embed 块改成新 URL）
34. update_page - 更新单个页面的属性或元数据（如：把 xxx 标记为重要、给 xxx 页面换封面）
35. batch_update_pages - 批量更新多个页面（如：把标题包含旧版的页面全部标记为归档）
36. archive_page - 归档页面（如：归档 xxx 页面、归档标题包含旧版的所有页面）
37. restore_page - 恢复已归档页面（如：恢复 xxx 页面）
38. help - 帮助（如：帮助、你能做什么）
39. unknown - 无法理解

注意区分 search 和 workspace_search：
- search: 用户想在配置的帖子数据库中搜索
- workspace_search: 用户明确提到"工作区"、"全局"、"所有页面"、"所有数据库"等，或者想搜索数据库以外的内容

注意区分 move 和 copy：
- move: 用户想把页面从一个数据库移动到另一个数据库（原数据库的页面会消失）
- copy: 用户想把页面复制到另一个数据库（原数据库的页面保留）
- 关键词提示：移动/移/搬/转移 → move；复制/拷贝/副本/备份到 → copy

注意区分 ask 和 search：
- ask: 用户想让 AI 综合分析并回答问题（如"关于Docker的帖子都说了什么"、"总结一下"）
- search: 用户想列出搜索结果（如"搜索Docker相关的帖子"）

注意区分 agent_task 和 compound：
- agent_task: 用户给出高层目标，让 AI 自己规划步骤（如"帮我整理所有帖子"）
- compound: 用户明确给出了顺序步骤（如"先分类再移动"）

注意区分 write_content 和 edit_content：
- write_content: 生成新内容追加到页面（如"写一段介绍"、"添加内容"）
- edit_content: 改写页面现有内容（如"改写"、"润色"、"让它更简洁"）

注意区分 deep_research 和 ask：
- deep_research: 用户想要深入、系统地研究某个主题（如"深入研究xxx"、"调研xxx"、"综合分析xxx"、"全面了解xxx"）
- ask: 用户想要简单问答（如"关于Docker的帖子说了什么"、"总结一下"）
- 关键词提示：研究/调研/深入/综合分析/全面了解/深度分析 → deep_research

注意区分 template_output 和 write_content：
- template_output: 用户明确提到模板或使用预设格式（如"用周报模板"、"用SWOT模板"、"按提纲模板"）
- write_content: 用户想要自由生成内容（如"写一段介绍"、"添加xxx内容"）

注意区分 summarize 和 ask：
- summarize: 用户想要对特定页面生成结构化摘要（如"总结一下xxx页面"、"概括xxx的内容"、"给xxx生成摘要"）
- ask: 用户想要综合多个页面回答问题（如"关于Docker的帖子都说了什么"）
- 关键词提示：总结/概括/摘要/归纳/提炼 + 指定页面 → summarize

注意区分 brainstorm 和 ask：
- brainstorm: 用户想要围绕某主题进行创意发散（如"给我一些关于xxx的创意"、"帮我想10个方案"）
- ask: 用户想要基于工作区内容回答问题
- 关键词提示：创意/头脑风暴/想法/灵感/方案建议/点子 → brainstorm

注意区分 proofread 和 edit_content：
- proofread: 用户想要校对纠错（如"校对一下xxx页面"、"检查拼写和语法"、"纠正错误"）
- edit_content: 用户想要改写内容（如"改得更简洁"、"润色一下"、"换个风格"）
- 关键词提示：校对/纠错/拼写/语法/错别字/纠正 → proofread；润色/改写/重写/风格调整 → edit_content

注意区分 batch_translate 和 translate_content：
- batch_translate: 用户想翻译整个数据库的所有页面（如"把整个数据库翻译成日文"、"翻译所有页面"）
- translate_content: 用户想翻译单个页面（如"把xxx页面翻译成英文"）
- 关键词提示：整个/所有/批量 + 数据库/页面 + 翻译 → batch_translate

注意区分 extract_to_database 和 create_database：
- extract_to_database: 用户想从现有页面内容中提取结构化信息生成数据库（如"把笔记转为数据库"、"提取待办事项为任务"）
- create_database: 用户想创建一个空数据库或通用数据库（如"创建一个项目数据库"）
- 关键词提示：转换/提取/整理成数据库 + 提到源页面 → extract_to_database

注意区分 generate_pages 和 write_content：
- generate_pages: 用户想生成多页面结构化内容（如"创建入职指南含子页面"、"生成包含多个部分的报告"）
- write_content: 用户想在单个页面写入内容
- 关键词提示：多页面/子页面/包含多个部分/多章节/完整指南 → generate_pages

注意区分 batch_analyze 和 deep_research：
- batch_analyze: 用户想批量分析数据库中的多个页面并生成综合报告（如"分析所有项目页面"、"分析团队任务生成周报"）
- deep_research: 用户想深入研究某个主题（搜索 + 分析）
- 关键词提示：分析数据库/分析所有页面/团队分析/批量分析 → batch_analyze

compound 判断依据：
- 用户指令中含"先...再..."、"...之后..."、"...然后..."、"...后..."等顺序词，且涉及两个不同操作
- 单个操作不算 compound（如"移动帖子"只是 move）
- 同一操作的补充说明不算 compound（如"搜索 Docker 并显示前5条"只是 search）

返回格式（只返回 JSON，不要其他内容）：

单操作格式：
{
  "intent": "query|search|workspace_search|classify|batch_classify|update|move|copy|create_database|write_content|edit_content|translate_content|ai_autofill|ask|agent_task|deep_research|template_output|summarize|brainstorm|proofread|batch_translate|extract_to_database|generate_pages|batch_analyze|github_import|bookmark_import|fetch_notion_object|fetch_page_blocks|get_comment|create_comment|append_block_children|update_block_content|update_page|batch_update_pages|archive_page|restore_page|help|unknown",
  "params": {
"keyword": "搜索关键词（如有）",
"property": "要更新的属性名（如有）",
"value": "新值（如有）",
"type": "属性类型（text/select/multi_select/number/date/checkbox/title）",
"limit": 5,
"filter_field": "筛选字段（如 作者、分类）",
"filter_value": "筛选值",
"object_type": "page 或 database（workspace_search 时使用，默认不限）",
"source_database_name": "源数据库名称（move/copy 时，如用户提到了源数据库名称）",
"source_database_id": "源数据库ID（move/copy 时，如用户直接提供了ID）",
"target_database_name": "目标数据库名称（move/copy 时必填）",
"target_database_id": "目标数据库ID（move/copy 时，如用户直接提供了ID）",
"page_title": "要移动/复制的页面标题关键词（如用户指定了特定页面）",
"database_name": "要创建的数据库名称（create_database 时必填）",
"parent_page_name": "父页面名称（create_database 时可选，如用户提到了父页面）",
"parent_page_id": "父页面ID（create_database 时可选，如用户直接提供了ID）",
"content_prompt": "写作/编辑要求（write_content/edit_content 时使用）",
"page_name": "目标页面名称（write_content/edit_content/translate_content/update 时使用）",
"page_id": "目标页面ID（write_content/edit_content/translate_content/update 时，如用户直接提供了ID）",
"page_ids": ["批量更新/批量操作时的页面 ID 列表"],
"target_language": "翻译目标语言（translate_content 时使用，如英文、日文）",
"autofill_type": "AI属性类型（ai_autofill 时使用：summary/keywords/translation/custom）",
"property_name": "自定义属性名（ai_autofill 且 autofill_type=custom 时使用）",
"question": "问答问题（ask 时使用）",
"task_description": "Agent 任务描述（agent_task 时使用）",
"research_topic": "研究主题（deep_research 时使用）",
"template_name": "模板名称（template_output 时使用，如：周报/摘要提纲/SWOT分析/行动计划）",
"custom_context": "用户补充说明（template_output 时可选）",
"summary_style": "摘要风格（summarize 时使用：brief/detailed/bullet，默认brief）",
"brainstorm_topic": "头脑风暴主题（brainstorm 时使用）",
"brainstorm_count": 10,
"extraction_prompt": "提取要求描述（extract_to_database 时使用，描述要提取什么信息）",
"structure_prompt": "结构描述（generate_pages 时使用，描述需要生成的页面结构）",
"analysis_prompt": "分析要求（batch_analyze 时使用，描述分析目标和维度）",
"username": "GitHub 用户名（github_import 时可选，覆盖已配置的用户名）",
"reference": "页面/数据库名称、URL 或 ID（fetch_notion_object 时使用）",
"block_id": "块 ID（fetch_page_blocks/update_block_content/append_block_children/create_comment 时可选）",
"comment_id": "评论 ID（get_comment/create_comment 时可选）",
"insert_position": "插入位置（append_block_children: end/after_block）",
"after_block_id": "目标块 ID（append_block_children 且 insert_position=after_block 时必填）",
"icon_emoji": "页面图标 emoji（update/create_page 时可选）",
"icon_url": "页面图标外链 URL（update/create_page 时可选）",
"cover_url": "页面封面 URL（update/create_page 时可选）",
"clear_icon": false,
"clear_cover": false,
"is_locked": false,
"classify": false,
"batch": true
  },
  "explanation": "你对用户意图的理解（中文简短说明）"
}

compound 格式（仅当 intent 为 compound 时使用）：
{
  "intent": "compound",
  "steps": [
{ "intent": "第一步的意图", "params": { ... }, "explanation": "第一步说明" },
{ "intent": "第二步的意图", "params": { ... }, "explanation": "第二步说明" }
  ],
  "explanation": "整体意图说明"
}`;

        try {
            const response = await AIService.requestChat(
                `${systemPrompt}\n\n<user_input>\n${userMessage}\n</user_input>`,
                settings,
                800
            );

            // ISS-013: 统一走 parseAIJson 接缝（arch-013），消除手工 jsonMatch+JSON.parse 三段式。
            // validateIntentSchema 校验 intent 为 string（防非对象/非字符串注入）；白名单强校验 +
            // compound steps 截断仍由消费点 _resolveIntentExecutor + slice 做。
            const intentResult = AISchema.parseAIJson("intent", response);
            if (intentResult.ok) {
                const parsed = intentResult.value;
                // intent 白名单校验（ISS-20260723-009 L1）：未知 intent 降级为 unknown，
                // 避免 _resolveIntentExecutor 抛模糊错误。compound steps 加上限防 AI 注入超长循环。
                if (!AIAssistant._resolveIntentExecutor(parsed.intent)) {
                    return { intent: "unknown", explanation: `未识别的意图: ${parsed.intent}` };
                }
                if (parsed.intent === "compound") {
                    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
                    if (steps.length > 20) {
                        console.warn(`[LD-Notion] compound steps 超上限（${steps.length}），截断为 20`);
                        parsed.steps = steps.slice(0, 20);
                    }
                }
                return parsed;
            }
            console.warn("[LD-Notion] 意图 JSON 解析失败:", intentResult.reason);
            return { intent: "unknown", explanation: "无法解析响应" };
        } catch (error) {
            console.error("[LD-Notion] 解析意图失败:", error);
            return { intent: "unknown", explanation: error.message };
        }
    },

    _INTENT_HANDLER_MAP: {
        compound: "handleCompound",
        query: "handleQuery",
        search: "handleSearch",
        workspace_search: "handleWorkspaceSearch",
        classify: "handleClassify",
        batch_classify: "handleBatchClassify",
        update: "handleUpdate",
        move: "handleMove",
        copy: "handleCopy",
        create_database: "handleCreateDatabase",
        write_content: "handleWriteContent",
        edit_content: "handleEditContent",
        translate_content: "handleTranslateContent",
        ai_autofill: "handleAIAutofill",
        deep_research: "handleDeepResearch",
        template_output: "handleTemplateOutput",
        summarize: "handleSummarize",
        brainstorm: "handleBrainstorm",
        proofread: "handleProofread",
        batch_translate: "handleBatchTranslate",
        extract_to_database: "handleExtractToDatabase",
        generate_pages: "handleGeneratePages",
        batch_analyze: "handleBatchAnalyze",
        github_import: "handleGitHubImport",
        bookmark_import: "handleBookmarkImport",
        ask: "handleAsk",
        agent_task: "handleAgentTask",
        help: "getHelpMessage",
    },

    _INTENTS_REQUIRING_AGENT_LOOP: {
        ask: true,
        agent_task: true,
        help: true,
    },

    _resolveIntentExecutor: (intent) => {
        const handlerName = AIAssistant._INTENT_HANDLER_MAP[intent];
        if (handlerName) {
            return {
                source: "intent",
                name: intent,
                execute: async (intentResult, settings) => {
                    if (intent === "compound") {
                        return await AIAssistant.handleCompound(intentResult, settings);
                    }
                    if (handlerName === "getHelpMessage") {
                        return AIAssistant.getHelpMessage();
                    }

                    const handler = AIAssistant[handlerName];
                    if (typeof handler !== "function") {
                        throw new Error(`未实现的意图处理器: ${handlerName}`);
                    }
                    return await handler(intentResult.params || {}, settings, intentResult.explanation);
                }
            };
        }

        const tool = AIAssistant.AGENT_TOOLS[intent];
        if (tool) {
            return {
                source: "tool",
                name: intent,
                execute: async (intentResult, settings) => await tool.execute(intentResult.params || {}, settings),
            };
        }

        return null;
    },

    _canExecuteParsedIntentDirectly: (intent) => {
        if (!AIAssistant._resolveIntentExecutor(intent)) return false;
        return !AIAssistant._INTENTS_REQUIRING_AGENT_LOOP[intent];
    },

    // 处理用户消息
    handleMessage: async (userMessage) => {
        const settings = AIAssistant.getSettings();

        // 简单的帮助关键词检测（无需配置）
        const helpKeywords = ["帮助", "help", "你能做什么", "怎么用", "使用说明"];
        if (helpKeywords.some(k => userMessage.includes(k))) {
            return AIAssistant.getHelpMessage();
        }

        // 问候语检测（无需配置）
        const greetings = ["你好", "您好", "hello", "hi", "hey", "嗨", "早上好", "下午好", "晚上好"];
        if (greetings.some(g => userMessage.toLowerCase().trim() === g || userMessage.trim() === g)) {
            const pName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
            return `你好！👋 我是${pName}。\n\n输入「帮助」查看我能做什么，或者直接告诉我你想执行的操作。`;
        }

        // 检查基础配置（不检查数据库 ID，因为工作区搜索不需要）
        const basicConfigCheck = AIAssistant.checkConfig(settings, false);
        if (!basicConfigCheck.valid) {
            return basicConfigCheck.error;
        }

        // 对高确定性的块/评论/对象指令先走轻量规则解析，避免依赖 LLM 猜测
        const quickIntent = AIAssistant.quickParseIntent(userMessage);
        if (quickIntent) {
            return await AIAssistant.executeIntent(quickIntent, settings);
        }

        // 先尝试意图解析，已知意图直接执行，未知/复杂意图走 Agent Loop
        ChatState.updateLastMessage("🤖 正在理解你的需求...", "processing");
        const intentResult = await AIAssistant.parseIntent(userMessage, settings);

        if (AIAssistant.IntentDispatcher.canExecuteDirectly(intentResult.intent)) {
            return await AIAssistant.executeIntent(intentResult, settings);
        }

        // unknown/ask/agent_task/help → Agent Loop
        ChatState.updateLastMessage("🤖 正在思考...", "processing");
        return await AIAssistant.runAgentLoop(userMessage, settings);
    },

    // 执行意图
    executeIntent: async (intentResult, settings) => {
        return await AIAssistant.IntentDispatcher.execute(intentResult, settings);
    },

    // 处理查询

    // 处理搜索

    // 处理工作区搜索（搜索整个 Notion 工作区）

    // 处理单个分类

    // 处理批量分类

    // 处理更新属性

    // 解析数据库名称到 ID

    // 从源数据库获取页面

    // 处理移动页面

    // 处理复制页面

    // 处理组合指令

    // 处理创建数据库

    // ======= 通用工具方法 =======

    // 解析页面名称到 ID（对称于 _resolveDatabaseId）

    // Markdown 文本转 Notion 块

    // 提取页面内容文本

    // ======= 写作/内容生成 =======


    // ======= 编辑内容 =======


    // ======= 翻译内容 =======


    // ======= AI 数据库属性自动填充 =======



    // ======= 全局问答（RAG） =======


    // ======= 深度研究模式 =======


    // ======= 内容总结 =======


    // ======= 头脑风暴 =======


    // ======= 校对纠错 =======


    // ======= 批量翻译数据库 =======


    // ======= 内容提取为数据库 =======


    // ======= 多页面结构化生成 =======


    // ======= 批量页面分析 =======


    // ======= GitHub 收藏导入 =======


    // ======= 浏览器书签导入 =======


    // ======= AI 输出模板 =======


    // ======= Agent 自主代理 =======

    // 生成 Agent 执行计划并等待用户确认。
    // W5 (MAINT-004/011): 从 handleAgentTask 提取。返回 { plan, planMsg } | 错误字符串。
};
// Mixin handlers for dynamic dispatch (AIAssistant[handlerName])
Object.assign(AIAssistant, AIHandlers);

Object.entries(AIAssistant.AGENT_TOOLS).forEach(([name, tool]) => {
    const execute = tool.execute;
    tool.execute = async (args, settings) => {
        try {
            const rawResult = await execute(args, settings);
            return AIAssistant._normalizeExecutionResult(rawResult, { source: "tool", name });
        } catch (error) {
            return AIAssistant._normalizeExecutionResult(`错误: ${error.message}`, {
                source: "tool",
                name,
                status: "error",
            });
        }
    };
});

AIAssistant.IntentMatcher = Object.freeze({
    patterns: QUICK_INTENT_PATTERNS,
    getRules: () => QUICK_INTENT_RULES.slice(),
    buildContext: (userMessage) => AIAssistant._buildQuickIntentContext(userMessage),
    matchesRule: (rule, ctx) => AIAssistant._matchesQuickIntentRule(rule, ctx),
    parse: (userMessage) => {
        const ctx = AIAssistant._buildQuickIntentContext(userMessage);
        if (!ctx) return null;

        const matchedRules = QUICK_INTENT_RULES
            .filter((rule) => AIAssistant._matchesQuickIntentRule(rule, ctx))
            .sort((a, b) => b.priority - a.priority);

        if (matchedRules.length === 0) return null;

        const [topRule] = matchedRules;
        const hasPriorityConflict = matchedRules.some((rule, index) => index > 0 && rule.priority === topRule.priority && rule.intent !== topRule.intent);
        if (hasPriorityConflict) return null;

        return topRule.buildResult(ctx);
    },
});

AIAssistant.IntentDispatcher = Object.freeze({
    resolveExecutor: (intent) => AIAssistant._resolveIntentExecutor(intent),
    canExecuteDirectly: (intent) => AIAssistant._canExecuteParsedIntentDirectly(intent),
    execute: async (intentResult, settings) => {
        const { intent } = intentResult;
        const executor = AIAssistant.IntentDispatcher.resolveExecutor(intent);

        if (!executor) {
            return AIAssistant._normalizeExecutionResult(
                `抱歉，我没有完全理解你的指令。\n\n${intentResult.explanation ? `我的理解：${intentResult.explanation}` : ""}\n\n试试说「帮助」查看我能做什么，或者换一种方式描述你的需求。`,
                { source: "intent", name: intent, status: "error" }
            );
        }

        try {
            const rawResult = await executor.execute(intentResult, settings);
            return AIAssistant._normalizeExecutionResult(rawResult, {
                source: executor.source,
                name: executor.name,
            });
        } catch (error) {
            return AIAssistant._normalizeExecutionResult(`错误: ${error.message}`, {
                source: executor.source,
                name: executor.name,
                status: "error",
            });
        }
    },
});

// ===========================================
// ═══════════════════════════════════════════════════════
// 🎨 Chat UI — 欢迎界面 / 对话 UI / 意图分类器
// ═══════════════════════════════════════════════════════
const AI_WELCOME_ENTRY_POINTS = Object.freeze({
    subtitle: "稳定支持：数据库 / 页面检索、跨源搜索、批量分类、GitHub / 书签导入、页面摘要；更多能力看「帮助」",
    inputPlaceholder: "输入指令，如「列出所有数据库」或「导入GitHub收藏」...",
    chips: Object.freeze([
        { command: "帮助", label: "💡 帮助" },
        { command: "列出所有数据库", label: "🗂️ 数据库" },
        { command: "在工作区搜索所有页面", label: "📄 页面" },
        { command: "跨源搜索最近收藏的帖子", label: "🔍 跨源搜索" },
        { command: "自动分类所有未分类的帖子", label: "🏷️ 分类" },
        { command: "导入GitHub收藏", label: "🐙 GitHub" },
        { command: "导入浏览器书签", label: "📖 书签" }
    ]),
});

const AIWelcomeUI = {
    render: (personaName) => {
        const chips = AI_WELCOME_ENTRY_POINTS.chips
            .map((chip) => `<button class="ldb-chat-chip" data-cmd="${Utils.escapeHtml(chip.command)}">${Utils.escapeHtml(chip.label)}</button>`)
            .join("");
        return `
            <div class="ldb-chat-welcome">
                <div class="ldb-chat-welcome-icon">🤖</div>
                <div class="ldb-chat-welcome-text">
                    你好！我是 ${Utils.escapeHtml(personaName)}<br>
                    <small>${Utils.escapeHtml(AI_WELCOME_ENTRY_POINTS.subtitle)}</small>
                </div>
                <div class="ldb-chat-chips">
                    ${chips}
                </div>
            </div>
        `;
    },

    getInputPlaceholder: () => AI_WELCOME_ENTRY_POINTS.inputPlaceholder,
};

// ===========================================
const ChatUI = {
    // HTML 转义函数，防止 XSS 攻击
    escapeHtml: (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // 安全的 Markdown 渲染（先转义再处理 Markdown）
    safeMarkdown: (text) => {
        // 先转义 HTML 特殊字符
        let escaped = Utils.escapeHtml(text);
        // 再处理安全的 Markdown 格式
        return escaped
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    },

    // 增量更新最后一个气泡 DOM（PERF-006）。
    // 返回 true 表示已成功 patch，false 表示需要回退到全量 renderMessages。
    _patchLastBubble: () => {
        const container = document.querySelector("#ldb-chat-messages");
        if (!container) return false;
        const bubbles = container.querySelectorAll(".ldb-chat-message");
        if (bubbles.length !== ChatState.messages.length) return false;
        const lastMsg = ChatState.messages[ChatState.messages.length - 1];
        const lastBubble = bubbles[bubbles.length - 1]?.querySelector(".ldb-chat-bubble");
        if (!lastBubble) return false;

        const statusClass = lastMsg.status === "processing" ? "processing" : (lastMsg.status === "error" ? "error" : "");
        const content = lastMsg.status === "processing"
            ? '思考中<span class="ldb-typing-dots"><span></span><span></span><span></span></span>'
            : ChatUI.safeMarkdown(AIAssistant._resultToText(lastMsg.content));

        lastBubble.className = `ldb-chat-bubble ${lastMsg.role === "user" ? "user" : "assistant"} ${statusClass}`.trim();
        lastBubble.innerHTML = content;
        container.scrollTop = container.scrollHeight;
        return true;
    },

    // 渲染消息列表
    renderMessages: () => {
        const container = document.querySelector("#ldb-chat-messages");
        if (!container) return;

        if (ChatState.messages.length === 0) {
            const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
            container.innerHTML = AIWelcomeUI.render(personaName);
            // 绑定 chip 点击
            container.querySelectorAll(".ldb-chat-chip").forEach(chip => {
                chip.onclick = () => {
                    const input = document.querySelector("#ldb-chat-input");
                    if (input) {
                        input.value = chip.getAttribute("data-cmd");
                        ChatUI.sendMessage();
                    }
                };
            });
            return;
        }

        container.innerHTML = ChatState.messages.map(msg => {
            const isUser = msg.role === "user";
            const statusClass = msg.status === "processing" ? "processing" : (msg.status === "error" ? "error" : "");

            // processing 状态使用预设动画，不经过 Markdown 渲染
            const content = msg.status === "processing"
                ? '思考中<span class="ldb-typing-dots"><span></span><span></span><span></span></span>'
                : ChatUI.safeMarkdown(AIAssistant._resultToText(msg.content));

            return `
                <div class="ldb-chat-message ${isUser ? 'user' : 'assistant'}">
                    <div class="ldb-chat-bubble ${isUser ? 'user' : 'assistant'} ${statusClass}">
                        ${content}
                    </div>
                </div>
            `;
        }).join('');

        // 滚动到底部
        container.scrollTop = container.scrollHeight;
    },

    // 发送消息
    sendMessage: async () => {
        const input = document.querySelector("#ldb-chat-input");
        const sendBtn = document.querySelector("#ldb-chat-send");
        if (!input) return;

        const message = input.value.trim();
        if (!message || ChatState.isProcessing) return;

        // 禁用输入区域
        if (input) input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;

        // 清空输入框
        input.value = "";
        input.style.height = "auto";

        // 添加用户消息
        ChatState.addMessage("user", message);

        // 添加 AI 回复占位
        ChatState.isProcessing = true;
        ChatState.addMessage("assistant", "思考中...", "processing");

        try {
            const response = await AIAssistant.handleMessage(message);
            ChatState.updateLastMessage(response, "complete");
        } catch (error) {
            console.error("[LD-Notion] AI 处理失败:", error);
            ChatState.updateLastMessage(`❌ 处理失败: ${error.message}`, "error");
        } finally {
            ChatState.isProcessing = false;
            // 恢复输入区域
            if (input) input.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.focus();
        }
    },

    // 绑定事件
    bindEvents: () => {
        // 发送按钮
        const sendBtn = document.querySelector("#ldb-chat-send");
        if (sendBtn) {
            sendBtn.onclick = ChatUI.sendMessage;
        }

        // Enter 发送
        const input = document.querySelector("#ldb-chat-input");
        if (input) {
            input.onkeydown = (e) => {
                // 阻止事件冒泡到 Notion
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ChatUI.sendMessage();
                }
            };

            // 阻止粘贴、复制、剪切等事件冒泡到 Notion
            input.onpaste = (e) => e.stopPropagation();
            input.oncopy = (e) => e.stopPropagation();
            input.oncut = (e) => e.stopPropagation();
            input.oninput = (e) => {
                e.stopPropagation();
                // textarea 自动增高
                input.style.height = "auto";
                input.style.height = Math.min(input.scrollHeight, 80) + "px";
            };
            input.onkeyup = (e) => e.stopPropagation();
            input.onkeypress = (e) => e.stopPropagation();
        }

        // 清空对话
        const clearBtn = document.querySelector("#ldb-chat-clear");
        if (clearBtn) {
            clearBtn.onclick = () => {
                if (confirm("确定要清空对话历史吗？")) {
                    ChatState.clear();
                }
            };
        }

        // 设置折叠
        const settingsToggle = document.querySelector("#ldb-chat-settings-toggle");
        if (settingsToggle) {
            settingsToggle.onclick = () => {
                const content = document.querySelector("#ldb-chat-settings-content");
                const arrow = document.querySelector("#ldb-chat-settings-arrow");
                if (content && arrow) {
                    content.classList.toggle("collapsed");
                    arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
                }
            };
        }
    },

    // 初始化
    init: () => {
        ChatState.load();
        ChatUI.renderMessages();
        ChatUI.bindEvents();
    },
};

const AIClassifier = {
    isPaused: false,
    isCancelled: false,

    // 批量分类
    classifyBatch: async (settings, onProgress) => {
        AIClassifier.reset();

        // 0. 确保数据库有 "AI分类" 属性
        await AIClassifier.ensureAICategoryProperty(settings);

        // 1. 查询数据库获取所有页面
        const pages = await AIClassifier.fetchAllPages(settings);

        if (pages.length === 0) {
            throw new Error("数据库中没有找到任何页面");
        }

        // 2. 过滤未分类的页面
        const unclassified = pages.filter(p => {
            const aiCategory = p.properties["AI分类"];
            return !aiCategory?.select?.name;
        });

        if (unclassified.length === 0) {
            return { total: pages.length, classified: 0, message: "所有页面都已分类" };
        }

        const results = { success: [], failed: [] };
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        // 3. 批量分类
        for (let i = 0; i < unclassified.length; i++) {
            if (AIClassifier.isCancelled) break;

            while (AIClassifier.isPaused) {
                await Utils.sleep(500);
                if (AIClassifier.isCancelled) break;
            }
            if (AIClassifier.isCancelled) break;

            const page = unclassified[i];
            const title = AIClassifier.getPageTitle(page);

            onProgress?.({
                current: i + 1,
                total: unclassified.length,
                title: title,
                isPaused: AIClassifier.isPaused,
            });

            try {
                await AIClassifier.classifyPage(page, settings);
                results.success.push({ title });
            } catch (error) {
                results.failed.push({ title, error: error.message });
            }

            // 请求间隔
            if (i < unclassified.length - 1) {
                await Utils.sleep(delay);
            }
        }

        return {
            total: pages.length,
            classified: results.success.length,
            failed: results.failed.length,
            results,
        };
    },

    // 获取所有页面
    fetchAllPages: async (settings) => {
        const { notionApiKey, notionDatabaseId } = settings;
        const pages = [];
        let cursor = null;

        do {
            const response = await NotionAPI.queryDatabase(
                notionDatabaseId,
                null,
                null,
                cursor,
                notionApiKey
            );
            pages.push(...(response.results || []));
            cursor = response.has_more ? response.next_cursor : null;
        } while (cursor);

        return pages;
    },

    // 获取页面标题（复用 Utils.getPageTitle）
    getPageTitle: (page) => {
        return Utils.getPageTitle(page, "未命名");
    },

    // 分类单个页面
    classifyPage: async (page, settings) => {
        const title = AIClassifier.getPageTitle(page);

        // 获取页面内容
        const blocks = await AIClassifier.fetchPageBlocks(page.id, settings.notionApiKey);
        const content = AIClassifier.extractText(blocks);

        // 调用 AI 分类
        const category = await AIService.classify(
            title,
            content,
            settings.categories,
            settings
        );

        // 更新页面属性
        await AIAssistant._executeGuardedPageWrite("updatePage",
            { id: page.id, name: title },
            () => NotionAPI.updatePage(page.id, {
                "AI分类": { select: { name: category } }
            }, settings.notionApiKey),
            settings
        );

        return category;
    },

    // 获取页面所有块
    fetchPageBlocks: async (pageId, apiKey) => {
        const blocks = [];
        let cursor = null;

        do {
            const response = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
            blocks.push(...(response.results || []));
            cursor = response.has_more ? response.next_cursor : null;
        } while (cursor);

        return blocks;
    },

    // 提取页面文本
    extractText: (blocks) => {
        const texts = [];

        const extractFromBlock = (block) => {
            const type = block.type;
            const content = block[type];

            if (!content) return;

            // 提取富文本
            if (content.rich_text) {
                const text = content.rich_text.map(rt => rt.plain_text).join("");
                if (text) texts.push(text);
            }

            // 提取标题
            if (content.title) {
                const text = content.title.map(t => t.plain_text).join("");
                if (text) texts.push(text);
            }

            // 提取代码
            if (content.caption) {
                const text = content.caption.map(c => c.plain_text).join("");
                if (text) texts.push(text);
            }
        };

        blocks.forEach(extractFromBlock);
        return texts.join("\n").slice(0, 4000); // 限制长度
    },

    // 确保数据库有 "AI分类" Select 属性
    ensureAICategoryProperty: async (settings) => {
        const { notionApiKey, notionDatabaseId, categories } = settings;

        // 获取数据库 schema
        const database = await NotionAPI.fetchDatabase(notionDatabaseId, notionApiKey);
        const properties = database.properties || {};

        // 检查是否已有 "AI分类" 属性
        if (properties["AI分类"]) {
            // 属性已存在，更新选项列表（添加新分类）
            const existingOptions = properties["AI分类"].select?.options || [];
            const existingNames = new Set(existingOptions.map(o => o.name));

            // 找出需要添加的新分类
            const newOptions = categories.filter(cat => !existingNames.has(cat));

            if (newOptions.length > 0) {
                // 合并现有选项和新选项
                const allOptions = [
                    ...existingOptions,
                    ...newOptions.map(name => ({ name }))
                ];

                await AIAssistant._executeGuardedDatabaseWrite("updateDatabase", notionDatabaseId,
                    () => NotionAPI.updateDatabase(notionDatabaseId, {
                        "AI分类": {
                            select: { options: allOptions }
                        }
                    }, notionApiKey),
                    notionApiKey
                );
            }
            return;
        }

        // 创建 "AI分类" Select 属性
        const options = categories.map(name => ({ name }));

        await AIAssistant._executeGuardedDatabaseWrite("updateDatabase", notionDatabaseId,
            () => NotionAPI.updateDatabase(notionDatabaseId, {
                "AI分类": {
                    select: { options }
                }
            }, notionApiKey),
            notionApiKey
        );
    },

    // 控制方法
    pause: () => { AIClassifier.isPaused = true; },
    resume: () => { AIClassifier.isPaused = false; },
    cancel: () => { AIClassifier.isCancelled = true; },
    reset: () => { AIClassifier.isPaused = false; AIClassifier.isCancelled = false; },
};

Object.assign(AIAssistant, require("./guarded-write").GuardedWrite);

// TASK-003: 独立导出 getAISettings，UI 模块直接解构导入，
// 不再经 AIAssistant.getSettings() 字面调用（为 TASK-007 拆分 settings 簇做准备）。
const getAISettings = () => AIAssistant.getSettings();

module.exports = { AIService, ChatState, QUICK_INTENT_PATTERNS, QUICK_INTENT_RULES, AI_AGENT_TOOLS, AIHandlers, AIAssistant, AIWelcomeUI, ChatUI, AIClassifier, getAISettings };
Object.assign(AIAssistant, require("./agent-executor").AgentExecutor);
