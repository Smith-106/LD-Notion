"use strict";
const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth } = require("../auth");
const { NotionAPI, SiteDetector, EMOJI_MAP, DOMToNotion } = require("../api");
const { OperationGuard, OperationLog } = require("../security");
const { GenericExtractor, WorkspaceService } = require("../extract");
const { UndoManager, ConfirmationDialog } = require("../security");

const AIService = {
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

    // OpenAI API 请求
    requestOpenAI: (prompt, model, apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
        const url = normalizedBase
            ? `${normalizedBase}/v1/chat/completions`
            : "https://api.openai.com/v1/chat/completions";

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                data: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: prompt }],
                    max_completion_tokens: 50,
                    temperature: 0,
                }),
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(result.choices?.[0]?.message?.content?.trim() || "");
                        } else {
                            reject(new Error(result.error?.message || `OpenAI 错误: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 30000,
                ontimeout: () => reject(new Error("AI 分类请求超时")),
            });
        });
    },

    // Claude API 请求
    requestClaude: (prompt, model, apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
        const url = normalizedBase
            ? `${normalizedBase}/v1/messages`
            : "https://api.anthropic.com/v1/messages";

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    "x-api-key": apiKey,
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                data: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
                    max_tokens: 50,
                }),
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(result.content?.[0]?.text?.trim() || "");
                        } else {
                            reject(new Error(result.error?.message || `Claude 错误: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 30000,
                ontimeout: () => reject(new Error("AI 分类请求超时")),
            });
        });
    },

    // Gemini API 请求
    requestGemini: (prompt, model, apiKey, baseUrl) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1beta$/, "") : "";
        const url = normalizedBase
            ? `${normalizedBase}/v1beta/models/${model}:generateContent`
            : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                },
                data: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: 50,
                        temperature: 0,
                    },
                }),
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "");
                        } else {
                            reject(new Error(result.error?.message || `Gemini 错误: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 30000,
                ontimeout: () => reject(new Error("AI 分类请求超时")),
            });
        });
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
    requestOpenAIChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
        const url = normalizedBase
            ? `${normalizedBase}/v1/chat/completions`
            : "https://api.openai.com/v1/chat/completions";

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                data: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: prompt }],
                    max_completion_tokens: maxTokens,
                    temperature: 0.7,
                }),
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(result.choices?.[0]?.message?.content?.trim() || "");
                        } else {
                            reject(new Error(result.error?.message || `OpenAI 错误: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 90000,
                ontimeout: () => reject(new Error("AI 对话请求超时")),
            });
        });
    },

    // Claude 对话请求
    requestClaudeChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
        const url = normalizedBase
            ? `${normalizedBase}/v1/messages`
            : "https://api.anthropic.com/v1/messages";

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    "x-api-key": apiKey,
                    "Content-Type": "application/json",
                    "anthropic-version": "2023-06-01",
                },
                data: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
                    max_tokens: maxTokens,
                }),
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(result.content?.[0]?.text?.trim() || "");
                        } else {
                            reject(new Error(result.error?.message || `Claude 错误: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 90000,
                ontimeout: () => reject(new Error("AI 对话请求超时")),
            });
        });
    },

    // Gemini 对话请求
    requestGeminiChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
        // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1beta$/, "") : "";
        const url = normalizedBase
            ? `${normalizedBase}/v1beta/models/${model}:generateContent`
            : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                },
                data: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: maxTokens,
                        temperature: 0.7,
                    },
                }),
                onload: (response) => {
                    try {
                        const result = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "");
                        } else {
                            reject(new Error(result.error?.message || `Gemini 错误: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 90000,
                ontimeout: () => reject(new Error("AI 对话请求超时")),
            });
        });
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
        } catch {
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
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
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
        const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1beta$/, "") : "";
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

    // 更新最后一条消息
    updateLastMessage: (content, status) => {
        if (ChatState.messages.length === 0) return;
        const lastMsg = ChatState.messages[ChatState.messages.length - 1];
        if (content !== undefined) lastMsg.content = content;
        if (status !== undefined) lastMsg.status = status;
        ChatState.save();
        ChatUI.renderMessages();
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
        } catch {
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
const AI_AGENT_TOOLS = {
    // === 读取工具 (Level 0) ===
    search_workspace: {
        description: "搜索 Notion 工作区中的页面或数据库",
        params: "query(搜索词), type(可选:'page'或'database')",
        level: 0,
        execute: async (args, settings) => {
            const { query = "", type } = args;
            let filter = null;
            if (type === "page") filter = { property: "object", value: "page" };
            else if (type === "database") filter = { property: "object", value: "database" };

            // 分页获取结果（最多 10 页，防止大型工作区过多 API 调用）
            let allResults = [];
            let cursor = undefined;
            let pageCount = 0;
            do {
                const response = await NotionAPI.search(query, filter, settings.notionApiKey, cursor);
                allResults = allResults.concat(response.results || []);
                cursor = response.has_more ? response.next_cursor : undefined;
                pageCount++;
            } while (cursor && pageCount < 10);
            const results = allResults;

            if (results.length === 0) {
                return query ? `没有找到包含「${query}」的内容。` : "工作区中没有找到内容。";
            }

            const lines = [];
            for (const item of results.slice(0, 15)) {
                if (item.object === "database") {
                    const title = item.title?.[0]?.plain_text || "无标题数据库";
                    const id = item.id?.replace(/-/g, "") || "";
                    lines.push(`[数据库] ${title} (ID: ${id})`);
                } else {
                    const title = Utils.getPageTitle(item);
                    const id = item.id?.replace(/-/g, "") || "";
                    const url = item.url || "";
                    lines.push(`[页面] ${title} (ID: ${id}, URL: ${url})`);
                }
            }
            return AIAssistant._formatToolResult({
                title: "工作区搜索结果",
                fields: [
                    { label: "总数", value: results.length },
                    { label: "显示", value: Math.min(15, results.length) },
                    { label: "对象类型", value: type || "all" },
                ],
                bullets: lines
            });
        }
    },

    fetch_notion_object: {
        description: "根据页面/数据库名称、URL 或 ID 获取对象详情",
        params: "reference(名称/URL/ID), type(可选:'page'|'database')",
        level: 0,
        execute: async (args, settings) => {
            const { reference, type } = args;
            if (!reference) return "错误: 请提供 reference。";

            if (type === "database") {
                const resolved = await AIAssistant._resolveDatabaseId(reference, null, settings.notionApiKey);
                if (resolved?.error) return `错误: ${resolved.error}`;
                if (!resolved) return `错误: 找不到数据库「${reference}」。`;
                const database = await NotionAPI.fetchDatabase(resolved.id, settings.notionApiKey);
                const title = database.title?.map(t => t.plain_text).join("") || resolved.name || "未命名数据库";
                const propertyNames = Object.keys(database.properties || {});
                return AIAssistant._formatToolResult({
                    title: "Notion 对象详情",
                    fields: [
                        { label: "对象类型", value: "database" },
                        { label: "标题", value: title },
                        { label: "ID", value: database.id?.replace(/-/g, "") || resolved.id },
                        { label: "URL", value: database.url || "-" },
                        { label: "属性数", value: propertyNames.length },
                        { label: "属性", value: propertyNames.join(", ") || "-" },
                    ]
                });
            }

            const resolved = await AIAssistant._resolvePageId(reference, null, settings.notionApiKey);
            if (resolved?.error) return `错误: ${resolved.error}`;
            if (!resolved) return `错误: 找不到页面「${reference}」。`;
            const page = await NotionAPI.fetchPage(resolved.id, settings.notionApiKey);
            const title = Utils.getPageTitle(page, resolved.name || "未命名页面");
            const parentType = page.parent?.type || "-";
            const iconText = page.icon?.emoji || page.icon?.external?.url || "-";
            const coverText = page.cover?.external?.url || "-";
            return AIAssistant._formatToolResult({
                title: "Notion 对象详情",
                fields: [
                    { label: "对象类型", value: "page" },
                    { label: "标题", value: title },
                    { label: "ID", value: page.id?.replace(/-/g, "") || resolved.id },
                    { label: "URL", value: page.url || "-" },
                    { label: "parent", value: parentType },
                    { label: "icon", value: iconText },
                    { label: "cover", value: coverText },
                    { label: "archived", value: page.archived ? "yes" : "no" },
                ]
            });
        }
    },

    fetch_page_blocks: {
        description: "读取页面或块的块级结构，支持有限递归展开子块",
        params: "page_name/page_id(页面,可选), block_id(块ID,可选), max_depth(默认2), limit(默认50)",
        level: 0,
        execute: async (args, settings) => {
            const { page_name, page_id, block_id, max_depth = 2, limit = 50 } = args;
            let rootId = block_id;
            let targetName = block_id || "";

            if (!rootId) {
                const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (page?.error) return `错误: ${page.error}`;
                if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;
                rootId = page.id;
                targetName = page.name;
            } else {
                try {
                    const block = await NotionAPI.fetchBlock(rootId, settings.notionApiKey);
                    targetName = block.type || rootId;
                } catch {
                    targetName = rootId;
                }
            }

            const depth = Math.max(1, Math.min(Number(max_depth) || 2, 5));
            const maxNodes = Math.max(1, Math.min(Number(limit) || 50, 200));
            const blocks = await AIAssistant._collectBlockTree(rootId, settings.notionApiKey, maxNodes, depth);

            if (blocks.length === 0) {
                return `页面或块「${targetName}」没有可读取的子块。`;
            }

            return AIAssistant._formatToolResult({
                title: "块结构",
                fields: [
                    { label: "目标", value: targetName },
                    { label: "块数", value: blocks.length },
                ],
                bullets: blocks.map(block => AIAssistant._formatBlockSummary(block, block._depth || 0).replace(/^- /, ""))
            });
        }
    },

    get_comment: {
        description: "根据评论 ID 获取单条评论详情",
        params: "comment_id(评论ID)",
        level: 0,
        execute: async (args, settings) => {
            const { comment_id } = args;
            if (!comment_id) return "错误: 请提供 comment_id。";

            const comment = await NotionAPI.getComment(comment_id.replace(/-/g, ""), settings.notionApiKey);
            const text = (comment.rich_text || []).map(rt => rt.plain_text || "").join("").trim() || "(空评论)";
            const author = comment.created_by?.name || comment.created_by?.person?.email || comment.created_by?.id || "未知用户";
            const discussionId = comment.discussion_id?.replace(/-/g, "") || "";
            return AIAssistant._formatToolResult({
                title: "评论详情",
                fields: [
                    { label: "评论ID", value: comment.id?.replace(/-/g, "") || comment_id },
                    { label: "讨论ID", value: discussionId || "-" },
                    { label: "作者", value: author },
                    { label: "创建时间", value: comment.created_time || "-" },
                    { label: "内容", value: text },
                ]
            });
        }
    },

    query_database: {
        description: "查询数据库的页面，支持筛选和排序（根据AI设置中的目标数据库决定查询范围）",
        params: "filter_field(筛选字段,可选), filter_value(筛选值,可选), limit(数量,默认10)",
        level: 0,
        execute: async (args, settings) => {
            const aiTargetState = TargetState.getEffectiveAITargetState({
                fallbackDatabaseId: settings.notionDatabaseId,
            });
            const { filter_field, filter_value, limit = 10 } = args;

            // 构建筛选条件
            let filter = null;
            if (filter_field && filter_value) {
                const fieldConfig = {
                    "作者": { name: "作者", type: "rich_text" },
                    "分类": { name: "分类", type: "rich_text" },
                    "标签": { name: "标签", type: "multi_select" },
                    "AI分类": { name: "AI分类", type: "select" }
                };
                const config = fieldConfig[filter_field] || { name: filter_field, type: "rich_text" };
                if (config.type === "select") {
                    filter = { property: config.name, select: { equals: filter_value } };
                } else if (config.type === "multi_select") {
                    filter = { property: config.name, multi_select: { contains: filter_value } };
                } else {
                    filter = { property: config.name, rich_text: { contains: filter_value } };
                }
            }

            // 查询单个数据库的辅助函数
            const queryOneDb = async (dbId) => {
                const pages = [];
                let cursor = null;
                let hasMore = true;
                let pageCount = 0;
                while (hasMore && pageCount < 10) {
                    let response;
                    try {
                        response = await NotionAPI.queryDatabase(dbId, filter,
                            pageCount === 0 ? [{ property: "收藏时间", direction: "descending" }] : null,
                            cursor, settings.notionApiKey);
                    } catch {
                        response = await NotionAPI.queryDatabase(dbId, filter,
                            [{ timestamp: "created_time", direction: "descending" }],
                            cursor, settings.notionApiKey);
                    }
                    pages.push(...(response.results || []));
                    hasMore = response.has_more;
                    cursor = response.next_cursor;
                    pageCount++;
                }
                return pages;
            };

            let allPages = [];

            if (aiTargetState.mode === "all") {
                // 遍历所有工作区数据库
                let cached;
                try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch { cached = {}; }
                const databases = cached.databases || [];
                if (databases.length === 0) return "错误: 请先在 AI 设置中点击「🔄」刷新数据库列表。";

                // 校验缓存的 API Key 是否匹配当前配置
                const currentKeyHash = settings.notionApiKey ? settings.notionApiKey.slice(-8) : "";
                if (cached.apiKeyHash && cached.apiKeyHash !== currentKeyHash) {
                    return "错误: 数据库列表缓存与当前 API Key 不匹配，请重新点击「🔄」刷新。";
                }

                for (const db of databases) {
                    try {
                        const pages = await queryOneDb(db.id);
                        pages.forEach(p => { p._sourceDb = db.title; });
                        allPages.push(...pages);
                    } catch {} // 跳过无权限的数据库
                }
            } else {
                const dbId = TargetState.getEffectiveAIDatabaseId({
                    fallbackDatabaseId: settings.notionDatabaseId,
                    targetValue: aiTargetState.value,
                });
                if (!dbId) return "错误: 未配置数据库 ID。";
                allPages = await queryOneDb(dbId);
            }

            if (allPages.length === 0) {
                return filter ? `没有找到匹配 ${filter_field}="${filter_value}" 的页面。` : "数据库中没有页面。";
            }

            const total = allPages.length;
            const showCount = Math.min(limit, total);

            // 统计分类
            const categoryCount = {};
            allPages.forEach(page => {
                const cat = page.properties["AI分类"]?.select?.name ||
                           page.properties["分类"]?.rich_text?.[0]?.plain_text || "未分类";
                categoryCount[cat] = (categoryCount[cat] || 0) + 1;
            });
            const bullets = allPages.slice(0, showCount).map((page, i) => {
                const title = Utils.getPageTitle(page);
                const id = page.id?.replace(/-/g, "") || "";
                const author = page.properties["作者"]?.rich_text?.[0]?.plain_text || "";
                const sourceDb = page._sourceDb ? ` [来源: ${page._sourceDb}]` : "";
                return `${i + 1}. ${title}${author ? ` (作者: ${author})` : ""}${sourceDb} [ID: ${id}]`;
            });

            return AIAssistant._formatToolResult({
                title: "数据库查询结果",
                fields: [
                    { label: "总数", value: total },
                    { label: "显示", value: showCount },
                    { label: "分类统计", value: Object.entries(categoryCount).map(([k, v]) => `${k}(${v})`).join(", ") },
                ],
                bullets
            });
        }
    },

    get_page_content: {
        description: "读取指定页面的文字内容",
        params: "page_name(页面名) 或 page_id(页面ID)",
        level: 0,
        execute: async (args, settings) => {
            const { page_name, page_id } = args;
            if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";

            const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 4000);
            return content.trim()
                ? AIAssistant._formatToolResult({
                    title: "页面内容",
                    fields: [
                        { label: "目标", value: page.name },
                    ],
                    bullets: content.split("\n").filter(Boolean)
                })
                : `页面「${page.name}」没有文字内容。`;
        }
    },

    fetch_page_markdown: {
        description: "获取指定页面的完整 Markdown 内容",
        params: "page_name(页面名) 或 page_id(页面ID)",
        level: 0,
        execute: async (args, settings) => {
            const { page_name, page_id } = args;
            if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";

            const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            try {
                const response = await NotionAPI.fetchPageMarkdown(page.id, settings.notionApiKey);
                const markdown = String(response.markdown || "").trim();
                return markdown
                    ? AIAssistant._formatToolResult({
                        title: "页面 Markdown",
                        fields: [
                            { label: "目标", value: page.name },
                            { label: "来源", value: "Notion Markdown API" },
                        ],
                        bullets: markdown.length > 2000
                            ? [`内容过长，已截断显示前 2000 字符`, markdown.slice(0, 2000)]
                            : markdown.split("\n").filter(Boolean)
                    })
                    : `页面「${page.name}」当前没有 Markdown 内容。`;
            } catch (error) {
                const fallback = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 6000);
                if (!fallback.trim()) {
                    return `页面「${page.name}」没有可读取的内容。`;
                }
                return AIAssistant._formatToolResult({
                    title: "页面 Markdown",
                    fields: [
                        { label: "目标", value: page.name },
                        { label: "来源", value: "文本回退提取" },
                    ],
                    bullets: fallback.length > 2000
                        ? [`内容过长，已截断显示前 2000 字符`, fallback.slice(0, 2000)]
                        : fallback.split("\n").filter(Boolean)
                });
            }
        }
    },

    get_database_schema: {
        description: "获取数据库的属性结构",
        params: "database_name(数据库名) 或 database_id(数据库ID)",
        level: 0,
        execute: async (args, settings) => {
            let dbId = args.database_id;
            let dbName = args.database_name;

            if (!dbId && !dbName) {
                dbId = settings.notionDatabaseId;
                if (!dbId) return "错误: 请提供 database_name 或 database_id，或先配置数据库 ID。";
                dbName = "已配置的数据库";
            }

            if (!dbId && dbName) {
                const resolved = await AIAssistant._resolveDatabaseId(dbName, null, settings.notionApiKey);
                if (resolved?.error) return `错误: ${resolved.error}`;
                if (!resolved) return `错误: 找不到数据库「${dbName}」。`;
                dbId = resolved.id;
                dbName = resolved.name;
            }

            const database = await NotionAPI.fetchDatabase(dbId, settings.notionApiKey);
            const props = database.properties || {};
            const title = database.title?.[0]?.plain_text || dbName || "未命名";

            const bullets = [];
            for (const [name, prop] of Object.entries(props)) {
                let extra = "";
                if (prop.type === "select" && prop.select?.options?.length) {
                    extra = ` (选项: ${prop.select.options.map(o => o.name).join(", ")})`;
                } else if (prop.type === "multi_select" && prop.multi_select?.options?.length) {
                    extra = ` (选项: ${prop.multi_select.options.map(o => o.name).join(", ")})`;
                }
                bullets.push(`${name}: ${prop.type}${extra}`);
            }
            return AIAssistant._formatToolResult({
                title: "数据库结构",
                fields: [
                    { label: "标题", value: title },
                    { label: "属性数", value: Object.keys(props).length },
                ],
                bullets
            });
        }
    },

    get_comments: {
        description: "获取页面或块上的未解决评论",
        params: "page_name/page_id(页面,可选), block_id(块ID,可选), limit(数量,默认20)",
        level: 0,
        execute: async (args, settings) => {
            const { page_name, page_id, block_id, limit = 20 } = args;

            let blockId = block_id;
            let targetName = block_id || "";
            if (!blockId) {
                const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (page?.error) return `错误: ${page.error}`;
                if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;
                blockId = page.id;
                targetName = page.name;
            }

            const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
            const comments = [];
            let cursor = null;

            while (comments.length < safeLimit) {
                const response = await NotionAPI.listComments(blockId, cursor, Math.min(100, safeLimit), settings.notionApiKey);
                comments.push(...(response.results || []));
                if (!response.has_more || !response.next_cursor) break;
                cursor = response.next_cursor;
            }

            if (comments.length === 0) {
                return `页面或块「${targetName || blockId}」目前没有未解决评论。`;
            }

            const shown = comments.slice(0, safeLimit).map(AIAssistant._formatCommentSummary);
            return AIAssistant._formatToolResult({
                title: "评论列表",
                fields: [
                    { label: "目标", value: targetName || blockId },
                    { label: "总数", value: comments.length },
                    { label: "显示", value: shown.length },
                ],
                bullets: shown.map(line => line.replace(/^- /, ""))
            });
        }
    },

    list_workspace_users: {
        description: "列出当前工作区中集成可见的用户",
        params: "limit(数量,默认20), query(按名称或邮箱过滤,可选)",
        level: 0,
        execute: async (args, settings) => {
            const { limit = 20, query = "" } = args;
            const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
            let users = await AIAssistant._collectWorkspaceUsers(settings.notionApiKey, safeLimit);

            const keyword = String(query || "").trim().toLowerCase();
            if (keyword) {
                users = users.filter((user) => {
                    const name = String(user.name || "").toLowerCase();
                    const email = String(user.person?.email || "").toLowerCase();
                    return name.includes(keyword) || email.includes(keyword);
                });
            }

            if (users.length === 0) {
                return keyword
                    ? `没有找到名称或邮箱包含「${query}」的用户。`
                    : "当前工作区没有可见用户。";
            }

            return AIAssistant._formatToolResult({
                title: "工作区用户列表",
                fields: [
                    { label: "人数", value: users.length },
                    { label: "筛选", value: keyword || "-" },
                ],
                bullets: users.map(AIAssistant._formatUserSummary)
            });
        }
    },

    get_current_user: {
        description: "获取当前 Notion 集成对应的 bot / 当前用户信息",
        params: "无需参数",
        level: 0,
        execute: async (args, settings) => {
            const user = await NotionAPI.getSelf(settings.notionApiKey);
            return AIAssistant._formatToolResult({
                title: "当前身份",
                fields: [
                    { label: "用户", value: AIAssistant._formatUserSummary(user) }
                ]
            });
        }
    },

    get_workspace_user: {
        description: "根据用户 ID、名称或邮箱获取工作区用户详情",
        params: "user_id(用户ID,可选), query(名称或邮箱,可选)",
        level: 0,
        execute: async (args, settings) => {
            const { user_id, query } = args;
            if (!user_id && !query) return "错误: 请提供 user_id 或 query。";

            const user = await AIAssistant._resolveUserIdentity(user_id, query, settings.notionApiKey);
            if (!user) {
                return `没有找到用户「${query || user_id}」。`;
            }

            const details = [
                { label: "用户", value: AIAssistant._formatUserSummary(user) },
                { label: "bot 所有者类型", value: user.bot?.owner?.type || "-" },
                { label: "workspace", value: user.bot?.owner?.workspace_name || "-" },
            ];

            return AIAssistant._formatToolResult({
                title: "工作区用户详情",
                fields: details
            });
        }
    },

    // === 跨源工具 (Level 0) ===
    cross_source_search: {
        description: "跨源搜索：在 Linux.do、GitHub、浏览器书签等多个来源中统一搜索",
        params: "query(搜索词), source(可选:'linux.do'|'github'|'书签'|'all', 默认all), limit(数量,默认10)",
        level: 0,
        execute: async (args, settings) => {
            const { query = "", source = "all", limit = 10 } = args;
            const aiTargetState = TargetState.getEffectiveAITargetState({
                fallbackDatabaseId: settings.notionDatabaseId,
            });

            // 构建来源过滤
            let sourceFilter = null;
            if (source !== "all") {
                const sourceMap = { "linux.do": "Linux.do", "github": "GitHub", "书签": "浏览器书签" };
                const sourceValue = sourceMap[source.toLowerCase()] || source;
                sourceFilter = { property: "来源", rich_text: { contains: sourceValue } };
            }

            // 构建搜索过滤
            const filters = [];
            if (sourceFilter) filters.push(sourceFilter);

            const queryOneDb = async (dbId) => {
                const body = { page_size: Math.min(limit, 100) };
                if (filters.length > 0) {
                    body.filter = filters.length === 1 ? filters[0] : { and: filters };
                }
                try {
                    const response = await NotionAPI.request("POST", `/databases/${dbId}/query`, body, settings.notionApiKey);
                    return response.results || [];
                } catch { return []; }
            };

            let results = [];
            const targetDb = TargetState.getEffectiveAIDatabaseId({
                fallbackDatabaseId: settings.notionDatabaseId,
                targetValue: aiTargetState.value,
            });
            if (aiTargetState.mode !== "all" && targetDb) {
                results = await queryOneDb(targetDb);
            } else {
                // 搜索所有数据库
                const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
                for (const db of (allDbs.results || []).slice(0, 5)) {
                    const dbResults = await queryOneDb(db.id);
                    results.push(...dbResults);
                }
            }

            // 如果有搜索词，在结果中过滤
            if (query) {
                results = results.filter(page => {
                    const title = Utils.getPageTitle(page).toLowerCase();
                    const desc = page.properties?.["描述"]?.rich_text?.[0]?.text?.content?.toLowerCase() || "";
                    return title.includes(query.toLowerCase()) || desc.includes(query.toLowerCase());
                });
            }

            results = results.slice(0, limit);

            if (results.length === 0) {
                return `没有找到${source !== "all" ? `来源为「${source}」的` : ""}包含「${query}」的内容。`;
            }

            const lines = results.map(page => {
                const title = Utils.getPageTitle(page);
                const src = page.properties?.["来源"]?.rich_text?.[0]?.text?.content || "未知";
                const srcType = page.properties?.["来源类型"]?.rich_text?.[0]?.text?.content || "";
                const url = page.properties?.["链接"]?.url || "";
                return `[${src}${srcType ? "/" + srcType : ""}] ${title}${url ? ` (${url})` : ""}`;
            });

            return AIAssistant._formatToolResult({
                title: "跨源搜索结果",
                fields: [
                    { label: "总数", value: results.length },
                    { label: "来源", value: source },
                    { label: "关键词", value: query || "-" },
                ],
                bullets: lines
            });
        }
    },

    unified_stats: {
        description: "跨源统计：统计各来源（Linux.do/GitHub/浏览器书签）的数据量、分类分布",
        params: "无需参数",
        level: 0,
        execute: async (args, settings) => {
            const aiTargetState = TargetState.getEffectiveAITargetState({
                fallbackDatabaseId: settings.notionDatabaseId,
            });

            const queryOneDb = async (dbId) => {
                try {
                    const response = await NotionAPI.request("POST", `/databases/${dbId}/query`, { page_size: 100 }, settings.notionApiKey);
                    return response.results || [];
                } catch { return []; }
            };

            let allPages = [];
            const targetDb = TargetState.getEffectiveAIDatabaseId({
                fallbackDatabaseId: settings.notionDatabaseId,
                targetValue: aiTargetState.value,
            });
            if (aiTargetState.mode !== "all" && targetDb) {
                allPages = await queryOneDb(targetDb);
            } else {
                const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
                for (const db of (allDbs.results || []).slice(0, 5)) {
                    allPages.push(...await queryOneDb(db.id));
                }
            }

            // 按来源统计
            const sourceStats = {};
            const categoryStats = {};
            for (const page of allPages) {
                const src = page.properties?.["来源"]?.rich_text?.[0]?.text?.content || "未标记";
                const cat = page.properties?.["分类"]?.rich_text?.[0]?.text?.content || "未分类";
                sourceStats[src] = (sourceStats[src] || 0) + 1;
                categoryStats[cat] = (categoryStats[cat] || 0) + 1;
            }

            const topCats = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
            const bullets = [];
            for (const [src, count] of Object.entries(sourceStats).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
                bullets.push(`来源 ${src}: ${count} 条`);
            }
            for (const [cat, count] of topCats) {
                bullets.push(`分类 ${cat}: ${count} 条`);
            }

            return AIAssistant._formatToolResult({
                title: "跨源数据统计",
                fields: [
                    { label: "总数", value: allPages.length },
                    { label: "来源种类", value: Object.keys(sourceStats).length },
                    { label: "分类种类", value: Object.keys(categoryStats).length },
                ],
                bullets
            });
        }
    },

    recommend_similar: {
        description: "智能推荐：根据指定页面，从所有来源中找到相似内容",
        params: "page_name/page_id(参考页面)",
        level: 0,
        execute: async (args, settings) => {
            const { page_name, page_id } = args;

            // 先找到参考页面
            let refPage = null;
            if (page_id) {
                try {
                    refPage = await NotionAPI.request("GET", `/pages/${page_id}`, null, settings.notionApiKey);
                } catch { /* page may not exist or be inaccessible */ }
            }
            if (!refPage && page_name) {
                const searchResult = await NotionAPI.search(page_name, null, settings.notionApiKey);
                refPage = (searchResult.results || []).find(r => r.object === "page");
            }

            if (!refPage) {
                return "❌ 未找到参考页面，请提供页面名称或 ID。";
            }

            const refTitle = Utils.getPageTitle(refPage);
            const refDesc = refPage.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";
            const refTags = (refPage.properties?.["标签"]?.multi_select || []).map(t => t.name);

            // 用 AI 分析相似性
            if (!settings.aiApiKey) {
                return "❌ 需要配置 AI API Key 才能使用智能推荐功能。";
            }

            // 搜索所有数据库获取候选
            const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
            let candidates = [];
            for (const db of (allDbs.results || []).slice(0, 5)) {
                try {
                    const res = await NotionAPI.request("POST", `/databases/${db.id}/query`, { page_size: 50 }, settings.notionApiKey);
                    candidates.push(...(res.results || []));
                } catch { /* database may not be queryable */ }
            }

            // 排除自身
            candidates = candidates.filter(p => p.id !== refPage.id);
            if (candidates.length === 0) {
                return "没有找到其他页面进行比较。";
            }

            // 构建候选列表给 AI
            const candidateList = candidates.slice(0, 30).map((p, i) => {
                const t = Utils.getPageTitle(p);
                const d = p.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";
                const tags = (p.properties?.["标签"]?.multi_select || []).map(tag => tag.name).join(", ");
                const src = p.properties?.["来源"]?.rich_text?.[0]?.text?.content || "";
                return `${i + 1}. [${src}] ${t} | ${d} | 标签: ${tags}`;
            }).join("\n");

            const prompt = `参考内容：
标题: ${refTitle}
描述: ${refDesc}
标签: ${refTags.join(", ")}

候选列表:
${candidateList}

请从候选列表中选出最相似的 5 个（按相似度排序），只回复编号，用逗号分隔。`;

            try {
                const aiResult = await AIService.request(prompt, settings);
                const indices = aiResult.match(/\d+/g)?.map(n => parseInt(n) - 1).filter(i => i >= 0 && i < candidates.length) || [];

                if (indices.length === 0) {
                    return "AI 未能识别相似内容。";
                }

                const bullets = [];
                for (const idx of indices.slice(0, 3)) {
                    const p = candidates[idx];
                    const t = Utils.getPageTitle(p);
                    const src = p.properties?.["来源"]?.rich_text?.[0]?.text?.content || "";
                    const url = p.properties?.["链接"]?.url || "";
                    bullets.push(`[${src}] ${t}${url ? ` (${url})` : ""}`);
                }
                return AIAssistant._formatToolResult({
                    title: "相似内容推荐",
                    fields: [
                        { label: "参考页面", value: refTitle },
                        { label: "推荐数", value: bullets.length },
                    ],
                    bullets
                });
            } catch (e) {
                return `❌ 推荐失败: ${e.message}`;
            }
        }
    },

    batch_tag: {
        description: "批量打标签：用 AI 为指定来源的所有未标记页面自动添加标签",
        params: "source(可选:'linux.do'|'github'|'书签'|'all'), tag_count(每页标签数,默认3)",
        level: 1,
        execute: async (args, settings) => {
            if (!OperationGuard.canExecute("updatePage")) {
                return "❌ 权限不足：批量打标签需要「标准」权限级别。";
            }
            if (!settings.aiApiKey) {
                return "❌ 需要配置 AI API Key。";
            }

            const { source = "all", tag_count = 3 } = args;
            const aiTargetState = TargetState.getEffectiveAITargetState({
                fallbackDatabaseId: settings.notionDatabaseId,
            });

            const queryOneDb = async (dbId) => {
                const body = {
                    filter: { property: "标签", multi_select: { is_empty: true } },
                    page_size: 50,
                };
                try {
                    const response = await NotionAPI.request("POST", `/databases/${dbId}/query`, body, settings.notionApiKey);
                    return response.results || [];
                } catch { return []; }
            };

            let pages = [];
            const targetDb = TargetState.getEffectiveAIDatabaseId({
                fallbackDatabaseId: settings.notionDatabaseId,
                targetValue: aiTargetState.value,
            });
            if (aiTargetState.mode !== "all" && targetDb) {
                pages = await queryOneDb(targetDb);
            } else {
                const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
                for (const db of (allDbs.results || []).slice(0, 3)) {
                    pages.push(...await queryOneDb(db.id));
                }
            }

            // 过滤来源
            if (source !== "all") {
                const sourceMap = { "linux.do": "Linux.do", "github": "GitHub", "书签": "浏览器书签" };
                const sourceValue = sourceMap[source.toLowerCase()] || source;
                pages = pages.filter(p => {
                    const s = p.properties?.["来源"]?.rich_text?.[0]?.text?.content || "";
                    return s.includes(sourceValue);
                });
            }

            if (pages.length === 0) {
                return "没有找到需要打标签的页面。";
            }

            let tagged = 0;
            for (const page of pages) {
                const title = Utils.getPageTitle(page);
                const desc = page.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";

                try {
                    const prompt = `为以下内容生成 ${tag_count} 个简短标签（每个标签 2-4 个字），用逗号分隔，只回复标签：
标题: ${title}
描述: ${desc}`;

                    const result = await AIService.request(prompt, settings);
                    const tags = result.split(/[,，]/).map(t => t.trim()).filter(t => t.length > 0 && t.length <= 20).slice(0, tag_count);

                    if (tags.length > 0) {
                        await AIAssistant._executeGuardedPageWrite("updatePage",
                            { id: page.id, name: title || page.id },
                            () => NotionAPI.request("PATCH", `/pages/${page.id}`, {
                                properties: {
                                    "标签": { multi_select: tags.map(t => ({ name: t })) },
                                },
                            }, settings.notionApiKey),
                            settings
                        );
                        tagged++;
                    }
                } catch (e) {
                    console.warn(`[batch_tag] 失败: ${title}`, e);
                }

                await new Promise(r => setTimeout(r, 500));
            }

            return `✅ 批量打标签完成：已为 ${tagged}/${pages.length} 个页面添加标签。`;
        }
    },

    // === 写入工具 (Level 1) ===
    append_content: {
        description: "向页面追加内容（支持 Markdown 格式）",
        params: "page_name/page_id(目标页面), content(Markdown内容)",
        level: 1,
        execute: async (args, settings) => {
            const { page_name, page_id, content } = args;
            if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";
            if (!content) return "错误: 请提供要追加的 content。";

            const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            await AIAssistant._executeGuardedPageWrite("appendBlocks", page,
                async () => {
                    try {
                        await NotionAPI.appendPageMarkdown(page.id, content, settings.notionApiKey);
                    } catch {
                        const blocks = AIAssistant._textToBlocks(content);
                        await NotionAPI.appendBlocks(page.id, blocks, settings.notionApiKey);
                    }
                },
                settings
            );
            return AIAssistant._formatToolResult({
                title: "页面内容追加完成",
                fields: [
                    { label: "目标", value: page.name },
                    { label: "字符数", value: String(content).length },
                ]
            });
        }
    },

    append_block_children: {
        description: "向页面或块插入子块，支持末尾或指定块后插入",
        params: "content(Markdown内容), page_name/page_id(页面,可选), block_id(块ID,可选), insert_position(end/after_block,默认end), after_block_id(当 insert_position=after_block 时必填)",
        level: 1,
        execute: async (args, settings) => {
            const { content, page_name, page_id, block_id, insert_position = "end", after_block_id } = args;
            if (!content) return "错误: 请提供 content。";

            let parentId = block_id;
            let targetName = block_id || "";
            if (!parentId) {
                const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (page?.error) return `错误: ${page.error}`;
                if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;
                parentId = page.id;
                targetName = page.name;
            }

            const blocks = AIAssistant._textToBlocks(String(content));
            if (blocks.length === 0) return "错误: 未能从 content 生成有效块。";

            const options = {};
            if (insert_position === "after_block") {
                if (!after_block_id) return "错误: insert_position=after_block 时必须提供 after_block_id。";
                options.after = String(after_block_id).replace(/-/g, "");
            } else if (insert_position !== "end") {
                return "错误: insert_position 仅支持 end 或 after_block。";
            }

            await AIAssistant._executeGuardedWrite("appendBlocks",
                () => NotionAPI.appendBlockChildren(parentId, blocks, settings.notionApiKey, options),
                { itemName: targetName || parentId, pageId: parentId },
                settings
            );
            return AIAssistant._formatToolResult({
                title: "块插入完成",
                fields: [
                    { label: "目标", value: targetName || parentId },
                    { label: "块数", value: blocks.length },
                    { label: "插入位置", value: insert_position },
                ]
            });
        }
    },

    search_replace_page_markdown: {
        description: "对页面 Markdown 做精确查找替换，适合局部改写",
        params: "page_name/page_id(目标页面), updates([{old_str,new_str,replace_all_matches?}])",
        level: 1,
        execute: async (args, settings) => {
            const { page_name, page_id, updates } = args;
            if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";
            if (!Array.isArray(updates) || updates.length === 0) return "错误: 请提供 updates 数组。";

            const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            await AIAssistant._executeGuardedPageWrite("updatePageMarkdown", page,
                () => NotionAPI.searchReplacePageMarkdown(page.id, updates, settings.notionApiKey),
                settings
            );

            return AIAssistant._formatToolResult({
                title: "Markdown 精确替换完成",
                fields: [
                    { label: "目标", value: page.name },
                    { label: "替换条数", value: updates.length },
                ]
            });
        }
    },

    replace_page_markdown: {
        description: "用新的 Markdown 完整替换页面内容",
        params: "page_name/page_id(目标页面), new_markdown(新的完整 Markdown 内容)",
        level: 2,
        execute: async (args, settings) => {
            const { page_name, page_id, new_markdown } = args;
            if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";
            if (!new_markdown) return "错误: 请提供 new_markdown。";

            const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            await AIAssistant._executeGuardedPageWrite("replacePageMarkdown", page,
                () => NotionAPI.replacePageMarkdown(page.id, new_markdown, settings.notionApiKey, true),
                settings
            );

            return AIAssistant._formatToolResult({
                title: "Markdown 整页替换完成",
                fields: [
                    { label: "目标", value: page.name },
                    { label: "字符数", value: String(new_markdown).length },
                ]
            });
        }
    },

    create_comment: {
        description: "向页面、块或现有讨论添加评论",
        params: "content(评论内容), page_name/page_id(页面,可选), block_id(块ID,可选), discussion_id(讨论ID,可选), comment_id(评论ID,可选，用于回复该评论所属讨论)",
        level: 1,
        execute: async (args, settings) => {
            const { page_name, page_id, block_id, discussion_id, comment_id, content } = args;
            if (!content) return "错误: 请提供评论内容 content。";

            let resolvedDiscussionId = discussion_id;
            if (!resolvedDiscussionId && comment_id) {
                const sourceComment = await NotionAPI.getComment(String(comment_id).replace(/-/g, ""), settings.notionApiKey);
                resolvedDiscussionId = sourceComment?.discussion_id || "";
                if (!resolvedDiscussionId) {
                    return `错误: 评论 ${comment_id} 没有可用的 discussion_id，无法作为回复目标。`;
                }
            }

            const targets = [page_id || page_name ? "page" : null, block_id ? "block" : null, resolvedDiscussionId ? "discussion" : null].filter(Boolean);
            if (targets.length !== 1) {
                return "错误: 请且仅请提供 page_name/page_id、block_id、discussion_id 或 comment_id 其中一种目标。";
            }

            let page = null;
            let targetName = block_id || resolvedDiscussionId || comment_id || "";
            if (!block_id && !resolvedDiscussionId) {
                page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (page?.error) return `错误: ${page.error}`;
                if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;
                targetName = page.name;
            }

            const result = await AIAssistant._executeGuardedWrite("createComment",
                () => NotionAPI.createComment({
                    pageId: page?.id,
                    blockId: block_id,
                    discussionId: resolvedDiscussionId,
                    content,
                }, settings.notionApiKey),
                { itemName: targetName || "评论目标", pageId: page?.id },
                settings
            );

            const newCommentId = result.id?.replace(/-/g, "") || "";
            return AIAssistant._formatToolResult({
                title: "评论已创建",
                fields: [
                    { label: "目标", value: targetName || "评论目标" },
                    { label: "评论ID", value: newCommentId || "-" },
                ]
            });
        }
    },

    update_page_property: {
        description: "更新页面的属性值",
        params: "page_id(页面ID), property(属性名), value(新值), type(属性类型:text/select/multi_select/number/date)",
        level: 1,
        execute: async (args, settings) => {
            const { page_id, property, value, type = "text" } = args;
            if (!page_id) return "错误: 请提供 page_id。";
            if (!property) return "错误: 请提供 property（属性名）。";
            if (value === undefined || value === null) return "错误: 请提供 value（新值）。";

            const updateProps = {};
            switch (type) {
                case "select":
                    updateProps[property] = { select: { name: String(value) } };
                    break;
                case "multi_select":
                    const tags = String(value).split(/[,，]/).map(t => ({ name: t.trim() })).filter(t => t.name);
                    updateProps[property] = { multi_select: tags };
                    break;
                case "number":
                    updateProps[property] = { number: Number(value) };
                    break;
                case "date":
                    updateProps[property] = { date: { start: String(value) } };
                    break;
                default: // text / rich_text
                    updateProps[property] = { rich_text: [{ type: "text", text: { content: String(value) } }] };
                    break;
            }

            await AIAssistant._executeGuardedPageWrite("updatePage",
                { id: page_id.replace(/-/g, ""), name: page_id },
                () => NotionAPI.updatePage(page_id.replace(/-/g, ""), updateProps, settings.notionApiKey),
                settings
            );
            return `已更新页面属性「${property}」为「${value}」。`;
        }
    },

    create_page: {
        description: "创建页面，可创建到数据库或作为子页面，并支持 icon/cover",
        params: "title(标题), database_name/database_id(目标数据库,可选), parent_page_name/parent_page_id(父页面,可选), properties(可选), content(可选Markdown), icon_emoji/icon_url(可选), cover_url(可选)",
        level: 1,
        execute: async (args, settings) => {
            const { database_name, database_id, parent_page_name, parent_page_id, title, content } = args;
            if (!title) return "错误: 请提供 title（页面标题）。";

            let parent = null;
            let parentDesc = "";

            let dbId = database_id;
            if (dbId || database_name) {
                const resolved = await AIAssistant._resolveDatabaseId(database_name, null, settings.notionApiKey);
                const targetDb = dbId ? { id: Utils.extractNotionId(dbId) || String(dbId).replace(/-/g, ""), name: database_name || dbId } : resolved;
                if (!dbId && resolved?.error) return `错误: ${resolved.error}`;
                if (!targetDb) return `错误: 找不到数据库「${database_name || database_id}」。`;
                parent = { database_id: targetDb.id };
                parentDesc = `数据库「${targetDb.name}」`;
            } else if (parent_page_id || parent_page_name) {
                const targetPage = await AIAssistant._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
                if (targetPage?.error) return `错误: ${targetPage.error}`;
                if (!targetPage) return `错误: 找不到父页面「${parent_page_name || parent_page_id}」。`;
                parent = { page_id: targetPage.id };
                parentDesc = `页面「${targetPage.name}」`;
            } else if (settings.notionDatabaseId) {
                parent = { database_id: settings.notionDatabaseId.replace(/-/g, "") };
                parentDesc = "已配置的数据库";
            }
            if (!parent) return "错误: 请提供 database_name/database_id 或 parent_page_name/parent_page_id，或先配置数据库 ID。";

            const properties = AIAssistant._normalizeNotionProperties(args.properties);
            if (parent.database_id) {
                properties["标题"] = { title: [{ text: { content: title } }] };
            } else {
                properties.title = { title: [{ text: { content: title } }] };
            }

            const children = content ? AIAssistant._textToBlocks(String(content)) : [];
            const icon = AIAssistant._buildPageIconPayload(args);
            const cover = AIAssistant._buildPageCoverPayload(args);

            const page = await AIAssistant._executeGuardedWrite("createDatabasePage",
                () => NotionAPI.createPageObject(parent, properties, children, settings.notionApiKey, { icon, cover }),
                { itemName: title },
                settings
            );
            const newId = page.id?.replace(/-/g, "") || "";
            return AIAssistant._formatToolResult({
                title: "页面创建完成",
                fields: [
                    { label: "标题", value: title },
                    { label: "ID", value: newId || "-" },
                    { label: "父级", value: parentDesc },
                ]
            });
        }
    },

    batch_create_pages: {
        description: "批量创建页面，可创建到数据库或某个父页面下",
        params: "pages([{title,properties?,content?,icon_emoji?,icon_url?,cover_url?}]), database_name/database_id(可选), parent_page_name/parent_page_id(可选)",
        level: 1,
        execute: async (args, settings) => {
            const pages = Array.isArray(args.pages) ? args.pages : [];
            if (pages.length === 0) return "错误: 请提供 pages 数组。";

            let parent = null;
            if (args.database_id || args.database_name) {
                const targetDb = args.database_id
                    ? { id: Utils.extractNotionId(args.database_id) || String(args.database_id).replace(/-/g, ""), name: args.database_name || args.database_id }
                    : await AIAssistant._resolveDatabaseId(args.database_name, null, settings.notionApiKey);
                if (targetDb?.error) return `错误: ${targetDb.error}`;
                if (!targetDb) return `错误: 找不到数据库「${args.database_name || args.database_id}」。`;
                parent = { database_id: targetDb.id };
            } else if (args.parent_page_id || args.parent_page_name) {
                const targetPage = await AIAssistant._resolvePageId(args.parent_page_name, args.parent_page_id, settings.notionApiKey);
                if (targetPage?.error) return `错误: ${targetPage.error}`;
                if (!targetPage) return `错误: 找不到父页面「${args.parent_page_name || args.parent_page_id}」。`;
                parent = { page_id: targetPage.id };
            } else if (settings.notionDatabaseId) {
                parent = { database_id: settings.notionDatabaseId.replace(/-/g, "") };
            }

            if (!parent) return "错误: 请提供数据库或父页面目标，或先配置数据库 ID。";

            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            let success = 0;
            let failed = 0;

            for (let i = 0; i < pages.length; i++) {
                const item = pages[i] || {};
                const title = String(item.title || "").trim();
                if (!title) {
                    failed++;
                    continue;
                }

                try {
                    const properties = AIAssistant._normalizeNotionProperties(item.properties);
                    if (parent.database_id) {
                        properties["标题"] = { title: [{ text: { content: title } }] };
                    } else {
                        properties.title = { title: [{ text: { content: title } }] };
                    }

                    const children = item.content ? AIAssistant._textToBlocks(String(item.content)) : [];
                    const icon = AIAssistant._buildPageIconPayload(item);
                    const cover = AIAssistant._buildPageCoverPayload(item);

                    await AIAssistant._executeGuardedWrite("createDatabasePage",
                        () => NotionAPI.createPageObject(parent, properties, children, settings.notionApiKey, { icon, cover }),
                        { itemName: title },
                        settings
                    );
                    success++;
                } catch {
                    failed++;
                }

                if (i < pages.length - 1) {
                    await Utils.sleep(delay);
                }
            }

            return AIAssistant._formatToolResult({
                title: "批量页面创建完成",
                fields: [
                    { label: "成功", value: success },
                    { label: "失败", value: failed },
                    { label: "目标数", value: pages.length },
                ]
            });
        }
    },

    update_page_metadata: {
        description: "更新页面元数据，如 icon / cover / lock",
        params: "page_name/page_id(目标页面), icon_emoji/icon_url(可选), cover_url(可选), clear_icon(可选), clear_cover(可选), is_locked(可选)",
        level: 1,
        execute: async (args, settings) => {
            const { page_name, page_id, is_locked } = args;
            if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";

            const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            const payload = {};
            const icon = AIAssistant._buildPageIconPayload(args);
            const cover = AIAssistant._buildPageCoverPayload(args);
            if (icon !== undefined) payload.icon = icon;
            if (cover !== undefined) payload.cover = cover;
            if (typeof is_locked === "boolean") payload.is_locked = is_locked;

            if (Object.keys(payload).length === 0) {
                return "错误: 请至少提供一个可更新字段，如 icon_emoji、icon_url、cover_url、clear_icon、clear_cover、is_locked。";
            }

            await AIAssistant._executeGuardedPageWrite("updatePage", page,
                () => NotionAPI.updatePageMeta(page.id, payload, settings.notionApiKey),
                settings
            );

            return AIAssistant._formatToolResult({
                title: "页面元数据更新完成",
                fields: [
                    { label: "目标", value: page.name },
                    { label: "字段数", value: Object.keys(payload).length },
                ]
            });
        }
    },

    update_page: {
        description: "统一更新页面属性或元数据",
        params: "page_name/page_id/page_ids, property/value/type(属性), updates(属性对象), icon_emoji/icon_url/cover_url/clear_icon/clear_cover/is_locked",
        level: 1,
        execute: async (args, settings) => {
            const targets = await AIAssistant._resolvePageTargets(args, settings);
            if (targets?.error) return `错误: ${targets.error}`;
            if (!targets || targets.length === 0) {
                return "错误: 没有找到可更新的页面。";
            }
            if (targets.length > 1) {
                return "错误: update_page 仅支持单页面，请改用 batch_update_pages。";
            }

            const result = await AIAssistant._applyPageUpdatesToTargets(targets, args, settings);
            if (result.failed > 0) {
                return `更新页面「${targets[0].name}」失败。`;
            }
            return AIAssistant._formatToolResult({
                title: "页面更新完成",
                fields: [
                    { label: "目标", value: targets[0].name },
                    { label: "属性更新数", value: Object.keys(result.propertyUpdates || {}).length },
                    { label: "元数据更新数", value: Object.keys(result.metaPayload || {}).length },
                ]
            });
        }
    },

    batch_update_pages: {
        description: "批量更新页面属性或元数据，可通过页面列表或数据库+标题筛选定位",
        params: "page_ids(可选), page_title(可选), database_name/database_id(可选), property/value/type(属性更新), updates(属性对象), icon_emoji/icon_url/cover_url/clear_icon/clear_cover/is_locked(元数据), limit(默认20)",
        level: 1,
        execute: async (args, settings) => {
            const targets = await AIAssistant._resolvePageTargets(args, settings);
            if (targets?.error) return `错误: ${targets.error}`;
            if (!targets || targets.length === 0) {
                return "错误: 没有找到可更新的页面。请提供 page_id/page_name/page_ids，或提供 database_name/database_id + page_title。";
            }

            const { success, failed } = await AIAssistant._applyPageUpdatesToTargets(targets, args, settings);

            return AIAssistant._formatToolResult({
                title: "批量页面更新完成",
                fields: [
                    { label: "成功", value: success },
                    { label: "失败", value: failed },
                    { label: "目标数", value: targets.length },
                ]
            });
        }
    },

    update_block_content: {
        description: "更新常见可编辑块的内容，如 paragraph/heading/todo/code/callout/equation/embed/bookmark",
        params: "block_id(块ID), content(新内容/公式/URL), checked(仅to_do,可选), color(可选)",
        level: 1,
        execute: async (args, settings) => {
            const { block_id, content, checked, color } = args;
            if (!block_id) return "错误: 请提供 block_id。";
            if (content === undefined || content === null) return "错误: 请提供 content。";

            const block = await NotionAPI.fetchBlock(block_id, settings.notionApiKey);
            const payload = AIAssistant._buildBlockUpdatePayload(block, content, { checked, color });
            await AIAssistant._executeGuardedWrite("updateBlock",
                () => NotionAPI.updateBlock(block_id.replace(/-/g, ""), payload, settings.notionApiKey),
                { itemName: String(block_id).replace(/-/g, "") },
                settings
            );
            return AIAssistant._formatToolResult({
                title: "块内容更新完成",
                fields: [
                    { label: "块ID", value: String(block_id).replace(/-/g, "") },
                    { label: "块类型", value: block.type },
                ]
            });
        }
    },

    classify_pages: {
        description: "AI 自动分类数据库中未分类的页面",
        params: "limit(最多处理数量,默认全部)",
        level: 1,
        execute: async (args, settings) => {
            const dbId = settings.notionDatabaseId;
            if (!dbId) return "错误: 未配置数据库 ID。";
            if (settings.categories.length < 2) return "错误: 请先配置至少两个分类选项。";

            await AIClassifier.ensureAICategoryProperty(settings);
            const pages = await AIClassifier.fetchAllPages(settings);
            if (pages.length === 0) return "数据库中没有页面。";

            const unclassified = pages.filter(p => !p.properties["AI分类"]?.select?.name);
            if (unclassified.length === 0) return `所有 ${pages.length} 个页面都已分类。`;

            const maxLimit = args.limit ? Math.min(args.limit, unclassified.length) : unclassified.length;
            const toClassify = unclassified.slice(0, maxLimit);
            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            let success = 0, failed = 0;

            for (let i = 0; i < toClassify.length; i++) {
                try {
                    await AIClassifier.classifyPage(toClassify[i], settings);
                    success++;
                } catch {
                    failed++;
                }
                if (i < toClassify.length - 1) await Utils.sleep(delay);
            }

            return `分类完成: 总计 ${pages.length} 个页面，本次分类 ${success} 个${failed > 0 ? `，失败 ${failed} 个` : ""}。`;
        }
    },

    // === 高级工具 (Level 2) ===
    move_page: {
        description: "将页面移动到另一个数据库",
        params: "page_id(页面ID), target_database_name/target_database_id(目标数据库)",
        level: 2,
        execute: async (args, settings) => {
            const { page_id, target_database_name, target_database_id } = args;
            if (!page_id) return "错误: 请提供 page_id。";

            const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
            if (target?.error) return `错误: ${target.error}`;
            if (!target) return `错误: 找不到目标数据库「${target_database_name || target_database_id}」。`;

            await AIAssistant._executeGuardedPageWrite("movePage",
                { id: page_id.replace(/-/g, ""), name: page_id },
                () => NotionAPI.movePage(page_id.replace(/-/g, ""), target.id, "database", settings.notionApiKey),
                settings
            );
            return `已将页面 ${page_id} 移动到数据库「${target.name}」。`;
        }
    },

    copy_page: {
        description: "复制页面到另一个数据库",
        params: "page_id(页面ID), target_database_name/target_database_id(目标数据库)",
        level: 2,
        execute: async (args, settings) => {
            const { page_id, target_database_name, target_database_id } = args;
            if (!page_id) return "错误: 请提供 page_id。";

            const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
            if (target?.error) return `错误: ${target.error}`;
            if (!target) return `错误: 找不到目标数据库「${target_database_name || target_database_id}」。`;

            await AIAssistant._executeGuardedPageWrite("duplicatePage",
                { id: page_id.replace(/-/g, ""), name: page_id },
                () => NotionAPI.duplicatePage(page_id.replace(/-/g, ""), target.id, "database", settings.notionApiKey),
                settings
            );
            return `已将页面 ${page_id} 复制到数据库「${target.name}」。`;
        }
    },

    archive_page: {
        description: "归档页面（软删除，可恢复）",
        params: "page_id/page_name/page_ids(可选), page_title + database_name/database_id(批量归档,可选), limit(默认20)",
        level: 2,
        execute: async (args, settings) => {
            const targets = await AIAssistant._resolvePageTargets(args, settings);
            if (targets?.error) return `错误: ${targets.error}`;
            if (!targets || targets.length === 0) {
                return "错误: 没有找到可归档的页面。";
            }

            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            let success = 0;
            let failed = 0;

            for (let i = 0; i < targets.length; i++) {
                const target = targets[i];
                try {
                    await AIAssistant._executeGuardedPageWrite("deletePage", target,
                        () => NotionAPI.deletePage(target.id, settings.notionApiKey),
                        settings
                    );
                    success++;
                } catch {
                    failed++;
                }

                if (i < targets.length - 1) {
                    await Utils.sleep(delay);
                }
            }

            return AIAssistant._formatToolResult({
                title: "页面归档完成",
                fields: [
                    { label: "成功", value: success },
                    { label: "失败", value: failed },
                    { label: "目标数", value: targets.length },
                ]
            });
        }
    },

    restore_page: {
        description: "恢复已归档页面",
        params: "page_id/page_name/page_ids(可选), page_title + database_name/database_id(批量恢复,可选), limit(默认20)",
        level: 2,
        execute: async (args, settings) => {
            const targets = await AIAssistant._resolvePageTargets(args, settings);
            if (targets?.error) return `错误: ${targets.error}`;
            if (!targets || targets.length === 0) {
                return "错误: 没有找到可恢复的页面。";
            }

            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            let success = 0;
            let failed = 0;

            for (let i = 0; i < targets.length; i++) {
                const target = targets[i];
                try {
                    await AIAssistant._executeGuardedPageWrite("restorePage", target,
                        () => NotionAPI.restorePage(target.id, settings.notionApiKey),
                        settings
                    );
                    success++;
                } catch {
                    failed++;
                }

                if (i < targets.length - 1) {
                    await Utils.sleep(delay);
                }
            }

            return AIAssistant._formatToolResult({
                title: "页面恢复完成",
                fields: [
                    { label: "成功", value: success },
                    { label: "失败", value: failed },
                    { label: "目标数", value: targets.length },
                ]
            });
        }
    },

    create_database: {
        description: "创建新数据库",
        params: "name(数据库名), parent_page_name/parent_page_id(父页面)",
        level: 2,
        execute: async (args, settings) => {
            const { name, parent_page_name, parent_page_id } = args;
            if (!name) return "错误: 请提供 name（数据库名称）。";

            let parentPage = null;
            if (parent_page_id || parent_page_name) {
                parentPage = await AIAssistant._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
                if (parentPage?.error) return `错误: ${parentPage.error}`;
                if (!parentPage) return `错误: 找不到父页面「${parent_page_name || parent_page_id}」。`;
            } else {
                const response = await NotionAPI.search("", { property: "object", value: "page" }, settings.notionApiKey);
                const pages = (response.results || []).filter(p => !p.archived && p.parent?.type === "workspace");
                if (pages.length === 0) return "错误: 工作区中没有可用的页面作为父页面。";
                parentPage = { id: pages[0].id.replace(/-/g, ""), name: Utils.getPageTitle(pages[0]) };
            }

            const properties = {
                "标题": { title: {} },
                "链接": { url: {} },
                "分类": { rich_text: {} },
                "标签": { multi_select: { options: [] } },
                "作者": { rich_text: {} },
            };

            const result = await AIAssistant._executeGuardedWrite("createDatabase",
                () => NotionAPI.createDatabase(parentPage.id, name, properties, settings.notionApiKey),
                { itemName: name },
                settings
            );

            const newDbId = result.id?.replace(/-/g, "") || "";
            return `已创建数据库「${name}」(ID: ${newDbId})，父页面: ${parentPage.name}。`;
        }
    },

    // === 深度研究工具 (Level 0) ===
    research_report: {
        description: "深入研究指定主题，多关键词搜索并生成结构化研究报告",
        params: "research_topic(研究主题), scope(范围:workspace/database,默认workspace)",
        level: 0,
        execute: async (args, settings) => {
            return await AIAssistant.handleDeepResearch(args, settings, "Agent工具调用");
        }
    },

    // === 公式编写辅助 (Level 1) ===
    generate_formula: {
        description: "根据自然语言描述生成 Notion 数据库公式",
        params: "description(功能描述), database_name/database_id(目标数据库,可选), property_name(目标属性名,可选)",
        level: 1,
        execute: async (args, settings) => {
            const { description, database_name, database_id, property_name } = args;
            if (!description) return "错误: 请描述你想要的公式功能。";

            // 获取数据库 schema 作为上下文
            let schemaDesc = "";
            const dbId = database_id || settings.notionDatabaseId;
            if (dbId) {
                try {
                    const database = await NotionAPI.fetchDatabase(dbId, settings.notionApiKey);
                    const props = Object.entries(database.properties || {})
                        .map(([name, prop]) => `${name}(${prop.type})`)
                        .join(", ");
                    schemaDesc = `数据库属性: ${props}`;
                } catch { schemaDesc = ""; }
            }

            const prompt = `你是 Notion 公式专家。根据以下信息生成 Notion 公式。

${schemaDesc ? schemaDesc + "\n" : ""}用户需求: ${description}

请返回以下格式:
公式: <Notion公式表达式>
说明: <公式功能简述>
示例: <公式返回值示例>

注意：使用 Notion 的公式语法（prop(), if(), contains() 等函数）。`;

            const result = await AIService.requestChat(prompt, settings, 500);
            let response = `📐 **Notion 公式生成**\n\n${result}`;
            if (property_name) {
                response += `\n\n💡 请将此公式手动设置到数据库属性「${property_name}」中（Notion API 暂不支持直接写入公式属性）。`;
            }
            return response;
        }
    },
    summarize_page: {
        description: "总结指定页面的内容，生成关键信息摘要",
        params: "page_name/page_id(目标页面), style(摘要风格:brief/detailed/bullet,默认brief)",
        level: 0,
        execute: async (args, settings) => {
            return await AIAssistant.handleSummarize(args, settings, "Agent工具调用");
        }
    },
    brainstorm_ideas: {
        description: "根据主题进行头脑风暴，生成创意列表或方案建议",
        params: "topic(主题), count(生成数量,默认10), style(风格:practical/creative/wild,默认practical)",
        level: 0,
        execute: async (args, settings) => {
            return await AIAssistant.handleBrainstorm(args, settings, "Agent工具调用");
        }
    },
    proofread_content: {
        description: "校对页面内容，纠正拼写、语法和表达问题",
        params: "page_name/page_id(目标页面)",
        level: 0,
        execute: async (args, settings) => {
            return await AIAssistant.handleProofread(args, settings, "Agent工具调用");
        }
    },
    batch_translate_database: {
        description: "批量翻译数据库中所有页面的内容",
        params: "database_name/database_id(目标数据库), target_language(目标语言,如英文/日文)",
        level: 1,
        execute: async (args, settings) => {
            return await AIAssistant.handleBatchTranslate(args, settings, "Agent工具调用");
        }
    },
    extract_to_database: {
        description: "从页面内容中提取结构化信息，创建数据库并填充条目",
        params: "page_name/page_id(源页面), database_name(新数据库名称), extraction_prompt(提取要求描述)",
        level: 2,
        execute: async (args, settings) => {
            return await AIAssistant.handleExtractToDatabase(args, settings, "Agent工具调用");
        }
    },
    generate_structured_pages: {
        description: "根据需求生成多页面结构化内容（如入职指南、竞品分析报告）",
        params: "topic(主题), structure_prompt(结构描述), parent_page_name/parent_page_id(父页面,可选)",
        level: 2,
        execute: async (args, settings) => {
            return await AIAssistant.handleGeneratePages(args, settings, "Agent工具调用");
        }
    },
    batch_analyze_pages: {
        description: "批量分析数据库中的页面，生成跨页面综合分析报告",
        params: "database_name/database_id(目标数据库), analysis_prompt(分析要求), limit(分析页数,默认10)",
        level: 0,
        execute: async (args, settings) => {
            return await AIAssistant.handleBatchAnalyze(args, settings, "Agent工具调用");
        }
    },
};
// ===========================================
// AI Handlers — 意图执行处理器
// ===========================================
const AIHandlers = {
handleQuery: async (params, settings, explanation) => {
    // 检查数据库 ID 配置
    if (!settings.notionDatabaseId) {
        return "❌ 请先配置 Notion 数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」来查看工作区中的数据库并获取 ID。";
    }

    ChatState.updateLastMessage(`正在查询数据库...`, "processing");

    try {
        const { limit = 10, filter_field, filter_value } = params;

        // 构建过滤条件
        let filter = null;
        if (filter_field && filter_value) {
            // 字段名称和类型映射
            const fieldConfig = {
                "作者": { name: "作者", type: "rich_text" },
                "分类": { name: "分类", type: "rich_text" },
                "标签": { name: "标签", type: "multi_select" },
                "AI分类": { name: "AI分类", type: "select" }
            };
            const config = fieldConfig[filter_field] || { name: filter_field, type: "rich_text" };

            // 根据属性类型构建正确的过滤器
            if (config.type === "select") {
                filter = {
                    property: config.name,
                    select: { equals: filter_value }
                };
            } else if (config.type === "multi_select") {
                filter = {
                    property: config.name,
                    multi_select: { contains: filter_value }
                };
            } else {
                filter = {
                    property: config.name,
                    rich_text: { contains: filter_value }
                };
            }
        }

        // 查询数据库（支持分页，获取所有结果）
        const allPages = [];
        let cursor = null;
        let hasMore = true;
        const maxPages = 10; // 最多查询 10 页（1000 条），防止无限循环
        let pageCount = 0;
        let querySorts = [];

        while (hasMore && pageCount < maxPages) {
            // 首次尝试按"收藏时间"排序，失败则按创建时间排序
            let response;
            try {
                response = await NotionAPI.queryDatabase(
                    settings.notionDatabaseId,
                    filter,
                    pageCount === 0 ? [{ property: "收藏时间", direction: "descending" }] : querySorts,
                    cursor,
                    settings.notionApiKey
                );
                if (pageCount === 0) querySorts = [{ property: "收藏时间", direction: "descending" }];
            } catch (sortError) {
                if (pageCount === 0 && sortError.message?.includes("收藏时间")) {
                    // "收藏时间"属性不存在，改用内置创建时间排序
                    querySorts = [{ timestamp: "created_time", direction: "descending" }];
                    response = await NotionAPI.queryDatabase(
                        settings.notionDatabaseId,
                        filter,
                        querySorts,
                        cursor,
                        settings.notionApiKey
                    );
                } else {
                    throw sortError;
                }
            }

            allPages.push(...(response.results || []));
            hasMore = response.has_more;
            cursor = response.next_cursor;
            pageCount++;

            // 更新进度
            if (hasMore) {
                ChatState.updateLastMessage(`正在查询数据库... (已获取 ${allPages.length} 条)`, "processing");
            }
        }

        const pages = allPages;
        const total = pages.length;
        const isTruncated = hasMore; // 如果还有更多，说明被截断了

        if (total === 0) {
            return `📊 数据库中没有找到符合条件的帖子。${filter ? `\n筛选条件：${filter_field} 包含 "${filter_value}"` : ""}`;
        }

        // 构建结果
        let result = `📊 **查询结果**\n\n`;
        result += `共找到 **${total}** 个帖子`;
        if (isTruncated) {
            result += ` (已达查询上限，可能还有更多)`;
        }

        if (params.keyword?.includes("统计") || params.keyword?.includes("分类")) {
            // 统计分类
            const categoryCount = {};
            pages.forEach(page => {
                const cat = page.properties["AI分类"]?.select?.name ||
                           page.properties["分类"]?.rich_text?.[0]?.plain_text || "未分类";
                categoryCount[cat] = (categoryCount[cat] || 0) + 1;
            });

            result += `\n\n**分类统计：**\n`;
            Object.entries(categoryCount)
                .sort((a, b) => b[1] - a[1])
                .forEach(([cat, count]) => {
                    result += `- ${cat}: ${count} 个\n`;
                });
        } else {
            // 显示前几条
            const showLimit = Math.min(limit, total);
            result += `（显示前 ${showLimit} 条）\n\n`;

            pages.slice(0, showLimit).forEach((page, i) => {
                const title = Utils.getPageTitle(page);
                const author = page.properties["作者"]?.rich_text?.[0]?.plain_text || "未知";
                result += `${i + 1}. **${title}**\n   作者: ${author}\n`;
            });
        }

        return result;
    } catch (error) {
        return `❌ 查询失败: ${error.message}`;
    }
},
handleSearch: async (params, settings, explanation) => {
    // 检查数据库 ID 配置
    if (!settings.notionDatabaseId) {
        return "❌ 请先配置 Notion 数据库 ID。\n\n💡 提示：可以使用「在工作区搜索 xxx」来搜索整个工作区，或使用「列出所有数据库」来查看工作区中的数据库并获取 ID。";
    }

    ChatState.updateLastMessage(`正在搜索...`, "processing");

    try {
        const { keyword, limit = 10 } = params;

        if (!keyword) {
            return "请告诉我你想搜索什么关键词？";
        }

        // 使用 Notion 搜索
        const response = await NotionAPI.search(
            keyword,
            { property: "object", value: "page" },
            settings.notionApiKey
        );

        const pages = (response.results || [])
            .filter(p => p.parent?.database_id?.replace(/-/g, "") === settings.notionDatabaseId.replace(/-/g, ""));

        if (pages.length === 0) {
            return `🔍 没有找到包含「${keyword}」的帖子。`;
        }

        let result = `🔍 **搜索结果**\n\n`;
        result += `找到 **${pages.length}** 个包含「${keyword}」的帖子：\n\n`;

        pages.slice(0, limit).forEach((page, i) => {
            const title = Utils.getPageTitle(page);
            const url = page.url || "";
            result += `${i + 1}. [${title}](${url})\n`;
        });

        if (pages.length > limit) {
            result += `\n... 还有 ${pages.length - limit} 条结果`;
        }

        return result;
    } catch (error) {
        return `❌ 搜索失败: ${error.message}`;
    }
},
handleWorkspaceSearch: async (params, settings, explanation) => {
    ChatState.updateLastMessage(`正在搜索整个工作区...`, "processing");

    try {
        const { keyword = "", limit = 10, object_type } = params;

        // 构建过滤器
        let filter = null;
        if (object_type === "page") {
            filter = { property: "object", value: "page" };
        } else if (object_type === "database") {
            filter = { property: "object", value: "database" };
        }

        // 使用 Notion 搜索 API（分页获取结果，最多 10 页）
        let allResults = [];
        let cursor = undefined;
        let searchPageCount = 0;
        do {
            const response = await NotionAPI.search(keyword, filter, settings.notionApiKey, cursor);
            allResults = allResults.concat(response.results || []);
            cursor = response.has_more ? response.next_cursor : undefined;
            searchPageCount++;
        } while (cursor && searchPageCount < 10);

        const results = allResults;

        if (results.length === 0) {
            const typeLabel = object_type === "page" ? "页面" : object_type === "database" ? "数据库" : "内容";
            return keyword
                ? `🌐 在工作区中没有找到包含「${keyword}」的${typeLabel}。`
                : `🌐 工作区中没有找到${typeLabel}。`;
        }

        // 分类结果
        const pages = results.filter(r => r.object === "page");
        const databases = results.filter(r => r.object === "database");

        let result = `🌐 **工作区搜索结果**\n\n`;

        if (keyword) {
            result += `搜索关键词：「${keyword}」\n`;
        }
        result += `共找到 **${results.length}** 个结果`;
        if (pages.length > 0 && databases.length > 0) {
            result += `（${pages.length} 个页面，${databases.length} 个数据库）`;
        }
        result += `\n\n`;

        // 显示数据库
        if (databases.length > 0 && (!object_type || object_type === "database")) {
            result += `📁 **数据库** (${databases.length})\n`;
            databases.slice(0, limit).forEach((db, i) => {
                const title = db.title?.[0]?.plain_text || "无标题数据库";
                const url = db.url || "";
                const id = db.id?.replace(/-/g, "") || "";
                result += `${i + 1}. [${title}](${url})\n`;
                result += `   ID: \`${id}\`\n`;
            });
            if (databases.length > limit) {
                result += `   ... 还有 ${databases.length - limit} 个数据库\n`;
            }
            result += `\n`;
        }

        // 显示页面
        if (pages.length > 0 && (!object_type || object_type === "page")) {
            result += `📄 **页面** (${pages.length})\n`;
            pages.slice(0, limit).forEach((page, i) => {
                const title = Utils.getPageTitle(page);
                const url = page.url || "";
                const parentType = page.parent?.type || "";
                let parentLabel = "";
                if (parentType === "database_id") {
                    parentLabel = "📁 数据库条目";
                } else if (parentType === "page_id") {
                    parentLabel = "📄 子页面";
                } else if (parentType === "workspace") {
                    parentLabel = "🌐 工作区页面";
                }

                result += `${i + 1}. [${title}](${url})`;
                if (parentLabel) {
                    result += ` - ${parentLabel}`;
                }
                result += `\n`;
            });
            if (pages.length > limit) {
                result += `   ... 还有 ${pages.length - limit} 个页面\n`;
            }
        }

        result += `\n💡 提示：复制数据库 ID 可以配置到设置中使用更多功能。`;

        return result;
    } catch (error) {
        return `❌ 工作区搜索失败: ${error.message}`;
    }
},
handleClassify: async (params, settings, explanation) => {
    return "📝 单个分类功能开发中...\n\n目前可以使用「自动分类所有未分类的帖子」来批量分类。";
},
handleBatchClassify: async (params, settings, explanation) => {
    // 检查数据库 ID 配置
    if (!settings.notionDatabaseId) {
        return "❌ 请先配置 Notion 数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」来查看工作区中的数据库并获取 ID。";
    }

    if (settings.categories.length < 2) {
        return "❌ 请先在设置面板中配置至少两个分类选项。";
    }

    ChatState.updateLastMessage(`正在准备批量分类...\n分类选项: ${settings.categories.join(", ")}`, "processing");

    try {
        // 确保数据库有 AI分类 属性
        await AIClassifier.ensureAICategoryProperty(settings);

        // 获取所有页面
        ChatState.updateLastMessage(`正在获取数据库页面...`, "processing");
        const pages = await AIClassifier.fetchAllPages(settings);

        if (pages.length === 0) {
            return "📭 数据库中没有找到任何页面。";
        }

        // 过滤未分类的页面
        const unclassified = pages.filter(p => {
            const aiCategory = p.properties["AI分类"];
            return !aiCategory?.select?.name;
        });

        if (unclassified.length === 0) {
            return `✅ 所有 ${pages.length} 个页面都已分类完成！`;
        }

        // 开始分类
        const results = { success: 0, failed: 0 };
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        for (let i = 0; i < unclassified.length; i++) {
            const page = unclassified[i];
            const title = AIClassifier.getPageTitle(page);

            ChatState.updateLastMessage(
                `🔄 正在分类 (${i + 1}/${unclassified.length})\n\n当前: ${title}`,
                "processing"
            );

            try {
                await AIClassifier.classifyPage(page, settings);
                results.success++;
            } catch (error) {
                console.error(`[LD-Notion] 分类失败: ${title}`, error);
                results.failed++;
            }

            if (i < unclassified.length - 1) {
                await Utils.sleep(delay);
            }
        }

        let resultMsg = `✅ **批量分类完成**\n\n`;
        resultMsg += `- 总计: ${pages.length} 个页面\n`;
        resultMsg += `- 已分类: ${pages.length - unclassified.length} 个\n`;
        resultMsg += `- 本次分类: ${results.success} 个\n`;
        if (results.failed > 0) {
            resultMsg += `- 失败: ${results.failed} 个\n`;
        }

        return resultMsg;
    } catch (error) {
        return `❌ 批量分类失败: ${error.message}`;
    }
},
handleUpdate: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("updatePage")) {
        return "❌ 权限不足：更新页面需要「标准」权限级别。";
    }

    ChatState.updateLastMessage("正在定位目标页面...", "processing");

    try {
        const targets = await AIAssistant._resolvePageTargets({
            ...params,
            page_name: params.page_name || params.keyword,
        }, settings);
        if (targets?.error) return `❌ ${targets.error}`;
        if (!targets || targets.length === 0) {
            return "❌ 没有找到可更新的页面。请提供 page_name/page_id/page_ids，或提供数据库 + page_title。";
        }

        const batchMode = !!params.batch || Array.isArray(params.page_ids) || !!params.page_title || targets.length > 1;
        if (!batchMode && targets.length > 1) {
            const names = targets.map(t => `「${t.name}」`).join("、");
            return `❌ 找到多个页面：${names}。请提供更精确的 page_name 或直接提供 page_id。`;
        }

        const { success, failed } = await AIAssistant._applyPageUpdatesToTargets(targets, params, settings);

        if (!batchMode && success === 1 && failed === 0) {
            return `✅ 已更新页面「${targets[0].name}」。`;
        }

        return `✅ 批量更新完成：成功 ${success} 个，失败 ${failed} 个。`;
    } catch (error) {
        return `❌ 更新页面失败: ${error.message}`;
    }
},
_resolveDatabaseId: async (name, id, apiKey) => {
    // 优先使用直接提供的 ID
    if (id) {
        const parsedId = Utils.extractNotionId(id) || String(id).replace(/-/g, "");
        return { id: parsedId, name: name || id };
    }

    const refId = Utils.extractNotionId(name);
    if (refId) return { id: refId, name: name || refId };

    if (!name) return null;

    // 通过名称搜索数据库
    const response = await NotionAPI.search(
        name,
        { property: "object", value: "database" },
        apiKey
    );

    const databases = response.results || [];
    // 优先精确匹配，再模糊匹配
    let exactMatch = null;
    const partialMatches = [];
    for (const db of databases) {
        const titleProp = db.title || [];
        const dbTitle = titleProp.map(t => t.plain_text).join("");
        if (!dbTitle) continue;
        if (dbTitle === name) {
            exactMatch = { id: db.id.replace(/-/g, ""), name: dbTitle };
            break;
        }
        if (dbTitle.includes(name)) {
            partialMatches.push({ id: db.id.replace(/-/g, ""), name: dbTitle });
        }
    }

    if (exactMatch) return exactMatch;
    if (partialMatches.length === 1) return partialMatches[0];
    if (partialMatches.length > 1) {
        // 多个模糊匹配，返回错误避免误操作
        const names = partialMatches.map(m => `「${m.name}」`).join("、");
        return { error: `找到多个匹配的数据库: ${names}，请使用更精确的名称。` };
    }

    return null;
},
_fetchSourcePages: async (databaseId, apiKey, pageTitle) => {
    const allPages = [];
    let cursor = null;

    do {
        const response = await NotionAPI.queryDatabase(databaseId, null, null, cursor, apiKey);
        allPages.push(...(response.results || []));
        cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);

    // 如果指定了标题关键词，按标题过滤
    if (pageTitle) {
        return allPages.filter(page => {
            const title = Utils.getPageTitle(page);
            return title.includes(pageTitle);
        });
    }

    return allPages;
},
handleMove: async (params, settings, explanation) => {
    // 检查基础配置
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    // 权限检查
    if (!OperationGuard.canExecute("movePage")) {
        return "❌ 权限不足：移动页面需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
    }

    const { source_database_name, source_database_id, target_database_name, target_database_id, page_title } = params;

    ChatState.updateLastMessage("正在解析数据库信息...", "processing");

    try {
        // 解析源数据库（未指定时使用已配置的数据库）
        let source = await AIAssistant._resolveDatabaseId(source_database_name, source_database_id, settings.notionApiKey);
        if (source?.error) return `❌ 源数据库解析失败：${source.error}`;
        if (!source && settings.notionDatabaseId) {
            source = { id: settings.notionDatabaseId.replace(/-/g, ""), name: "已配置的数据库" };
        }
        if (!source) {
            return "❌ 无法确定源数据库。请指定源数据库名称，或先在设置中配置数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。";
        }

        // 解析目标数据库
        const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
        if (target?.error) return `❌ 目标数据库解析失败：${target.error}`;
        if (!target) {
            return `❌ 找不到目标数据库「${target_database_name || target_database_id}」。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。`;
        }

        // 源=目标拦截
        if (source.id === target.id) {
            return "❌ 源数据库和目标数据库相同，无需移动。";
        }

        // 获取源页面
        ChatState.updateLastMessage(`正在从「${source.name}」获取页面...`, "processing");
        const pages = await AIAssistant._fetchSourcePages(source.id, settings.notionApiKey, page_title);

        if (pages.length === 0) {
            return page_title
                ? `📭 在「${source.name}」中没有找到标题包含「${page_title}」的页面。`
                : `📭「${source.name}」中没有页面。`;
        }

        // 批量移动
        const results = { success: 0, failed: 0 };
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const title = Utils.getPageTitle(page);

            ChatState.updateLastMessage(
                `📦 正在移动 (${i + 1}/${pages.length})\n\n当前: ${title}\n→ 目标: ${target.name}`,
                "processing"
            );

            try {
                await AIAssistant._executeGuardedPageWrite("movePage",
                    { id: page.id, name: title },
                    () => NotionAPI.movePage(page.id, target.id, "database", settings.notionApiKey),
                    settings
                );
                results.success++;
            } catch (error) {
                console.error(`[LD-Notion] 移动失败: ${title}`, error);
                results.failed++;
            }

            if (i < pages.length - 1) {
                await Utils.sleep(delay);
            }
        }

        let resultMsg = `✅ **移动完成**\n\n`;
        resultMsg += `- 源数据库: ${source.name}\n`;
        resultMsg += `- 目标数据库: ${target.name}\n`;
        resultMsg += `- 成功: ${results.success} 个\n`;
        if (results.failed > 0) {
            resultMsg += `- 失败: ${results.failed} 个\n`;
        }

        return resultMsg;
    } catch (error) {
        return `❌ 移动失败: ${error.message}`;
    }
},
handleCopy: async (params, settings, explanation) => {
    // 检查基础配置
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    // 权限检查
    if (!OperationGuard.canExecute("duplicatePage")) {
        return "❌ 权限不足：复制页面需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
    }

    const { source_database_name, source_database_id, target_database_name, target_database_id, page_title } = params;

    ChatState.updateLastMessage("正在解析数据库信息...", "processing");

    try {
        // 解析源数据库（未指定时使用已配置的数据库）
        let source = await AIAssistant._resolveDatabaseId(source_database_name, source_database_id, settings.notionApiKey);
        if (source?.error) return `❌ 源数据库解析失败：${source.error}`;
        if (!source && settings.notionDatabaseId) {
            source = { id: settings.notionDatabaseId.replace(/-/g, ""), name: "已配置的数据库" };
        }
        if (!source) {
            return "❌ 无法确定源数据库。请指定源数据库名称，或先在设置中配置数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。";
        }

        // 解析目标数据库
        const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
        if (target?.error) return `❌ 目标数据库解析失败：${target.error}`;
        if (!target) {
            return `❌ 找不到目标数据库「${target_database_name || target_database_id}」。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。`;
        }

        // 源=目标拦截
        if (source.id === target.id) {
            return "❌ 源数据库和目标数据库相同，无需复制。";
        }

        // 获取源页面
        ChatState.updateLastMessage(`正在从「${source.name}」获取页面...`, "processing");
        const pages = await AIAssistant._fetchSourcePages(source.id, settings.notionApiKey, page_title);

        if (pages.length === 0) {
            return page_title
                ? `📭 在「${source.name}」中没有找到标题包含「${page_title}」的页面。`
                : `📭「${source.name}」中没有页面。`;
        }

        // 批量复制
        const results = { success: 0, failed: 0 };
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const title = Utils.getPageTitle(page);

            ChatState.updateLastMessage(
                `📋 正在复制 (${i + 1}/${pages.length})\n\n当前: ${title}\n→ 目标: ${target.name}`,
                "processing"
            );

            try {
                await AIAssistant._executeGuardedPageWrite("duplicatePage",
                    { id: page.id, name: title },
                    () => NotionAPI.duplicatePage(page.id, target.id, "database", settings.notionApiKey),
                    settings
                );
                results.success++;
            } catch (error) {
                console.error(`[LD-Notion] 复制失败: ${title}`, error);
                results.failed++;
            }

            if (i < pages.length - 1) {
                await Utils.sleep(delay);
            }
        }

        let resultMsg = `✅ **复制完成**\n\n`;
        resultMsg += `- 源数据库: ${source.name}\n`;
        resultMsg += `- 目标数据库: ${target.name}\n`;
        resultMsg += `- 成功: ${results.success} 个\n`;
        if (results.failed > 0) {
            resultMsg += `- 失败: ${results.failed} 个\n`;
        }

        return resultMsg;
    } catch (error) {
        return `❌ 复制失败: ${error.message}`;
    }
},
handleCompound: async (intentResult, settings) => {
    const { steps, explanation } = intentResult;

    if (!steps || steps.length === 0) {
        return "❌ 组合指令解析失败：未识别到有效的执行步骤。";
    }

    // 展示执行计划
    let planMsg = `🔗 **组合指令** — ${explanation}\n\n📋 执行计划：\n`;
    steps.forEach((step, i) => {
        planMsg += `${i + 1}. ${step.explanation}\n`;
    });
    ChatState.updateLastMessage(planMsg, "processing");

    const results = [];
    let aborted = false;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        ChatState.updateLastMessage(
            `${planMsg}\n⏳ 步骤 ${i + 1}/${steps.length}: ${step.explanation}`,
            "processing"
        );

        try {
            const stepResult = await AIAssistant.executeIntent(step, settings);
            const normalizedStepResult = AIAssistant._normalizeExecutionResult(stepResult);

            if (AIAssistant._isErrorResult(normalizedStepResult)) {
                results.push({ index: i + 1, explanation: step.explanation, success: false, result: normalizedStepResult });
                aborted = true;
                break;
            }

            results.push({ index: i + 1, explanation: step.explanation, success: true, result: normalizedStepResult });
        } catch (error) {
            results.push({
                index: i + 1,
                explanation: step.explanation,
                success: false,
                result: AIAssistant._normalizeExecutionResult(`❌ ${error.message}`, { status: "error", name: step.intent })
            });
            aborted = true;
            break;
        }
    }

    // 汇总报告
    let report = `🔗 **组合指令执行${aborted ? "中断" : "完成"}**\n\n`;
    for (const r of results) {
        report += `${r.success ? "✅" : "❌"} 步骤 ${r.index}: ${r.explanation}\n`;
    }

    if (aborted) {
        const skipped = steps.slice(results.length);
        if (skipped.length > 0) {
            report += `\n⏭️ 已跳过：\n`;
            skipped.forEach((step, i) => {
                report += `${results.length + i + 1}. ${step.explanation}\n`;
            });
        }
    }

    // 附加各步骤详细结果
    report += `\n---\n`;
    for (const r of results) {
        report += `\n**步骤 ${r.index}**: ${r.explanation}\n${AIAssistant._resultToText(r.result)}\n`;
    }

    return report;
},
handleCreateDatabase: async (params, settings, explanation) => {
    // 检查基础配置（需要 API Key，不需要数据库 ID）
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    // 权限检查
    if (!OperationGuard.canExecute("createDatabase")) {
        return "❌ 权限不足：创建数据库需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
    }

    const { database_name, parent_page_name, parent_page_id } = params;

    // 校验数据库名称必填
    if (!database_name) {
        return "❌ 请指定要创建的数据库名称。\n\n💡 示例：「创建一个叫技术文档的数据库」";
    }

    ChatState.updateLastMessage("正在解析父页面信息...", "processing");

    try {
        let parentPage = null;

        // 使用共享的页面解析器
        if (parent_page_id || parent_page_name) {
            parentPage = await AIAssistant._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
            if (parentPage?.error) return `❌ 父页面解析失败：${parentPage.error}`;
            if (!parentPage) {
                return `❌ 找不到名为「${parent_page_name}」的页面。\n\n💡 提示：可以使用「在工作区搜索所有页面」查看可用页面。`;
            }
        }
        // 未指定父页面，搜索工作区页面供选择
        else {
            ChatState.updateLastMessage("未指定父页面，正在搜索工作区页面...", "processing");
            const response = await NotionAPI.search(
                "",
                { property: "object", value: "page" },
                settings.notionApiKey
            );
            const pages = (response.results || []).filter(p => !p.archived && p.parent?.type === "workspace");

            if (pages.length === 0) {
                return "❌ 工作区中没有找到可用的页面作为父页面。\n\n💡 请先在 Notion 中创建一个页面，或指定父页面名称。\n\n示例：「在 xxx 页面下创建一个叫技术文档的数据库」";
            }

            // 使用第一个工作区顶级页面
            const firstPage = pages[0];
            parentPage = { id: firstPage.id.replace(/-/g, ""), name: Utils.getPageTitle(firstPage) || "未命名页面" };
        }

        // 构建默认属性 schema
        ChatState.updateLastMessage(`正在创建数据库「${database_name}」...`, "processing");

        const properties = {
            "标题": { title: {} },
            "链接": { url: {} },
            "分类": { rich_text: {} },
            "标签": { multi_select: { options: [] } },
            "作者": { rich_text: {} },
            "收藏时间": { date: {} },
            "帖子数": { number: { format: "number" } },
            "浏览数": { number: { format: "number" } },
            "点赞数": { number: { format: "number" } },
        };

        // 调用 API 创建数据库
        const result = await AIAssistant._executeGuardedWrite("createDatabase",
            () => NotionAPI.createDatabase(parentPage.id, database_name, properties, settings.notionApiKey),
            { itemName: database_name },
            settings
        );

        const newDbId = result.id?.replace(/-/g, "") || "";
        let msg = `✅ **数据库创建成功**\n\n`;
        msg += `- 数据库名称: ${database_name}\n`;
        msg += `- 数据库 ID: \`${newDbId}\`\n`;
        msg += `- 父页面: ${parentPage.name}\n`;
        msg += `\n💡 提示：可以将此 ID 填入设置中的「数据库 ID」字段来使用该数据库。`;

        return msg;
    } catch (error) {
        return `❌ 创建数据库失败: ${error.message}`;
    }
},
_resolvePageId: async (name, id, apiKey) => {
    if (id) {
        const parsedId = Utils.extractNotionId(id) || String(id).replace(/-/g, "");
        return { id: parsedId, name: name || id };
    }
    const refId = Utils.extractNotionId(name);
    if (refId) return { id: refId, name: name || refId };
    if (!name) return null;

    const response = await NotionAPI.search(
        name,
        { property: "object", value: "page" },
        apiKey
    );

    const pages = (response.results || []).filter(p => !p.archived);
    let exactMatch = null;
    const partialMatches = [];
    for (const page of pages) {
        const title = Utils.getPageTitle(page);
        if (!title) continue;
        if (title === name) {
            exactMatch = { id: page.id.replace(/-/g, ""), name: title };
            break;
        }
        if (title.includes(name)) {
            partialMatches.push({ id: page.id.replace(/-/g, ""), name: title });
        }
    }

    if (exactMatch) return exactMatch;
    if (partialMatches.length === 1) return partialMatches[0];
    if (partialMatches.length > 1) {
        const names = partialMatches.map(m => `「${m.name}」`).join("、");
        return { error: `找到多个匹配的页面: ${names}，请使用更精确的名称。` };
    }
    return null;
},
_textToBlocks: (text) => {
    const blocks = [];
    const lines = text.split("\n");
    let inCodeBlock = false;
    let codeLines = [];
    let codeLang = "plain text";

    // Notion 接受的代码语言映射（常见缩写 → Notion 标准名）
    const LANG_MAP = {
        js: "javascript", ts: "typescript", py: "python", rb: "ruby",
        sh: "shell", bash: "shell", zsh: "shell", yml: "yaml",
        md: "markdown", cs: "c#", cpp: "c++", objc: "objective-c",
        kt: "kotlin", rs: "rust", go: "go", java: "java",
        html: "html", css: "css", json: "json", xml: "xml",
        sql: "sql", r: "r", swift: "swift", scala: "scala",
        php: "php", perl: "perl", lua: "lua", dart: "dart",
        dockerfile: "docker", makefile: "makefile", toml: "toml",
        graphql: "graphql", protobuf: "protobuf", sass: "sass",
        scss: "scss", less: "less", jsx: "javascript", tsx: "typescript",
    };
    const NOTION_LANGS = new Set([
        "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript",
        "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm",
        "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql",
        "groovy", "haskell", "html", "java", "javascript", "json", "julia",
        "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile",
        "markdown", "markup", "matlab", "mermaid", "nix", "objective-c",
        "ocaml", "pascal", "perl", "php", "plain text", "powershell",
        "prolog", "protobuf", "python", "r", "reason", "ruby", "rust",
        "sass", "scala", "scheme", "scss", "shell", "sql", "swift",
        "typescript", "vb.net", "verilog", "vhdl", "visual basic",
        "webassembly", "xml", "yaml", "java/c/c++/c#",
    ]);
    const normalizeLanguage = (lang) => {
        const lower = (lang || "").toLowerCase().trim();
        if (!lower) return "plain text";
        if (LANG_MAP[lower]) return LANG_MAP[lower];
        if (NOTION_LANGS.has(lower)) return lower;
        return "plain text";
    };

    const splitLongText = (str) => {
        const maxLen = 2000;
        const chunks = [];
        if (str.length <= maxLen) {
            chunks.push({ type: "text", text: { content: str } });
        } else {
            let remaining = str;
            while (remaining.length > 0) {
                chunks.push({ type: "text", text: { content: remaining.substring(0, maxLen) } });
                remaining = remaining.substring(maxLen);
            }
        }
        return chunks;
    };

    for (const line of lines) {
        // 代码块处理
        if (line.startsWith("```")) {
            if (inCodeBlock) {
                const code = codeLines.join("\n");
                blocks.push({
                    type: "code",
                    code: { rich_text: splitLongText(code), language: codeLang }
                });
                codeLines = [];
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
                codeLang = normalizeLanguage(line.slice(3).trim());
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        // 空行跳过
        if (!line.trim()) continue;

        // 标题
        if (line.startsWith("### ")) {
            blocks.push({ type: "heading_3", heading_3: { rich_text: splitLongText(line.slice(4)) } });
        } else if (line.startsWith("## ")) {
            blocks.push({ type: "heading_2", heading_2: { rich_text: splitLongText(line.slice(3)) } });
        } else if (line.startsWith("# ")) {
            blocks.push({ type: "heading_1", heading_1: { rich_text: splitLongText(line.slice(2)) } });
        }
        // 分割线
        else if (line.trim() === "---" || line.trim() === "***") {
            blocks.push({ type: "divider", divider: {} });
        }
        // 引用
        else if (line.startsWith("> ")) {
            blocks.push({ type: "quote", quote: { rich_text: splitLongText(line.slice(2)) } });
        }
        // 无序列表
        else if (/^[-*]\s/.test(line)) {
            blocks.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: splitLongText(line.replace(/^[-*]\s/, "")) } });
        }
        // 有序列表
        else if (/^\d+\.\s/.test(line)) {
            blocks.push({ type: "numbered_list_item", numbered_list_item: { rich_text: splitLongText(line.replace(/^\d+\.\s/, "")) } });
        }
        // 普通段落
        else {
            blocks.push({ type: "paragraph", paragraph: { rich_text: splitLongText(line) } });
        }
    }

    // 处理未闭合的代码块
    if (inCodeBlock && codeLines.length > 0) {
        const code = codeLines.join("\n");
        blocks.push({
            type: "code",
            code: { rich_text: splitLongText(code), language: codeLang }
        });
    }

    return blocks;
},
_extractPageContent: async (pageId, apiKey, maxChars = 4000) => {
    try {
        const markdownResponse = await NotionAPI.fetchPageMarkdown(pageId, apiKey);
        const markdown = String(markdownResponse.markdown || "").trim();
        if (markdown) {
            return markdown.slice(0, maxChars);
        }
    } catch {
        // Markdown API 不可用时回退到 blocks 提取
    }

    const allBlocks = [];
    let cursor = null;
    do {
        const data = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
        allBlocks.push(...(data.results || []));
        cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);
    return AIClassifier.extractText(allBlocks).slice(0, maxChars);
},
handleWriteContent: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：内容生成需要「标准」权限级别。";
    }

    const { content_prompt, page_name, page_id } = params;
    if (!content_prompt) {
        return "❌ 请描述你想生成的内容。\n\n💡 示例：「在 xxx 页面写一段关于 Docker 的介绍」";
    }

    if (!page_name && !page_id) {
        return "❌ 请指定目标页面。\n\n💡 示例：「在 xxx 页面写一段关于 Docker 的介绍」";
    }

    ChatState.updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。\n\n💡 提示：可以使用「在工作区搜索所有页面」查看可用页面。`;

        ChatState.updateLastMessage("正在生成内容...", "processing");

        const prompt = `你是一个内容生成助手。根据用户要求生成内容，使用 Markdown 格式。\n\n用户要求：${content_prompt}`;
        const aiResponse = await AIService.requestChat(prompt, settings, 2000);

        ChatState.updateLastMessage("正在写入页面...", "processing");

        try {
                await AIAssistant._executeGuardedPageWrite("appendBlocks", targetPage,
                    async () => {
                        try {
                            await NotionAPI.appendPageMarkdown(targetPage.id, aiResponse, settings.notionApiKey);
                        } catch {
                            const blocks = AIAssistant._textToBlocks(aiResponse);
                            await NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey);
                        }
                    },
                    settings
                );
            } catch (error) {
                return `❌ 内容生成失败: ${error.message}`;
            }
        return `✅ **内容已生成并追加到页面**\n\n- 目标页面: ${targetPage.name}\n- 生成内容: ${aiResponse.length} 字\n\n💡 内容已追加到页面末尾。`;
    } catch (error) {
        return `❌ 内容生成失败: ${error.message}`;
    }
},
handleEditContent: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：内容编辑需要「标准」权限级别。";
    }

    const { content_prompt, page_name, page_id } = params;
    if (!content_prompt) {
        return "❌ 请描述编辑要求。\n\n💡 示例：「把 xxx 页面的内容改得更简洁」";
    }

    if (!page_name && !page_id) {
        return "❌ 请指定目标页面。\n\n💡 示例：「把 xxx 页面的内容改得更简洁」";
    }

    ChatState.updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        ChatState.updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可编辑的内容。`;
        }

        ChatState.updateLastMessage("正在规划精确编辑...", "processing");

        const editPlanPrompt = `你是一个精确的 Notion Markdown 编辑器。请根据编辑指令，优先给出局部替换方案，而不是重写整页。

输出 JSON，且只能返回 JSON：
{
  "mode": "update_content" | "append_version",
  "content_updates": [
{
  "old_str": "需要被精确替换的原文片段",
  "new_str": "替换后的新内容",
  "replace_all_matches": false
}
  ],
  "append_markdown": "仅当 mode=append_version 时提供，返回完整改写版本"
}

规则：
1. 如果能通过 1-5 条精确替换完成，就用 update_content。
2. old_str 必须逐字出自原文。
3. 只有在需要大幅改写、重组结构或无法稳定定位原文时，才用 append_version。
4. append_markdown 必须是 Markdown。

原文：
${existingContent}

编辑指令：
${content_prompt}`;

        const editPlanRaw = await AIService.requestChat(editPlanPrompt, settings, 2200);
        const jsonMatch = editPlanRaw.match(/\{[\s\S]*\}/);
        let editPlan = null;
        if (jsonMatch) {
            try {
                editPlan = JSON.parse(jsonMatch[0]);
            } catch {}
        }

        let exactUpdateError = null;
        if (editPlan?.mode === "update_content" && Array.isArray(editPlan.content_updates) && editPlan.content_updates.length > 0) {
            ChatState.updateLastMessage("正在执行原位精确编辑...", "processing");

            try {
                await AIAssistant._executeGuardedPageWrite("updatePageMarkdown", targetPage,
                    () => NotionAPI.searchReplacePageMarkdown(
                        targetPage.id,
                        editPlan.content_updates,
                        settings.notionApiKey
                    ),
                    settings
                );

                return `✅ **页面已原位更新**\n\n- 目标页面: ${targetPage.name}\n- 编辑指令: ${content_prompt}\n- 精确替换: ${editPlan.content_updates.length} 处`;
            } catch (error) {
                exactUpdateError = error;
            }
        }

        ChatState.updateLastMessage("正在生成编辑版本...", "processing");

        const fallbackMarkdown = String(editPlan?.append_markdown || "").trim();
        let aiResponse = fallbackMarkdown;
        if (!aiResponse) {
            const prompt = `你是一个内容编辑助手。根据编辑指令改写以下内容，使用 Markdown 格式输出改写后的完整内容。\n\n原文：\n${existingContent}\n\n编辑指令：${content_prompt}`;
            aiResponse = await AIService.requestChat(prompt, settings, 2000);
        }

        ChatState.updateLastMessage("正在写入编辑版本...", "processing");

        const versionMarkdown = `---\n\n## ✏️ AI 编辑版本\n\n${aiResponse}`;
        await AIAssistant._executeGuardedPageWrite("appendBlocks", targetPage,
            async () => {
                try {
                    await NotionAPI.appendPageMarkdown(targetPage.id, versionMarkdown, settings.notionApiKey);
                } catch {
                    const contentBlocks = AIAssistant._textToBlocks(aiResponse);
                    const blocks = [
                        { type: "divider", divider: {} },
                        { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "✏️ AI 编辑版本" } }] } },
                        ...contentBlocks
                    ];
                    await NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey);
                }
            },
            settings
        );

        const fallbackReason = exactUpdateError?.message
            ? `\n\n💡 原位精确替换失败：${exactUpdateError.message}；已自动追加完整编辑版本，原内容保留。`
            : "\n\n💡 本次未执行原位替换，已将完整编辑版本追加到页面末尾（原内容保留）。";

        return `✅ **编辑版本已追加到页面**\n\n- 目标页面: ${targetPage.name}\n- 编辑指令: ${content_prompt}${fallbackReason}`;
    } catch (error) {
        return `❌ 内容编辑失败: ${error.message}`;
    }
},
handleTranslateContent: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：内容翻译需要「标准」权限级别。";
    }

    const { page_name, page_id, target_language } = params;
    const lang = target_language || "英文";

    if (!page_name && !page_id) {
        return "❌ 请指定要翻译的页面。\n\n💡 示例：「把 xxx 页面翻译成英文」";
    }

    ChatState.updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        ChatState.updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可翻译的内容。`;
        }

        ChatState.updateLastMessage(`正在翻译为${lang}...`, "processing");

        const prompt = `你是一个专业翻译。将以下内容翻译为${lang}，使用 Markdown 格式，保持原文结构。\n\n原文：\n${existingContent}`;
        const aiResponse = await AIService.requestChat(prompt, settings, 2000);

        ChatState.updateLastMessage("正在写入翻译版本...", "processing");

        const contentBlocks = AIAssistant._textToBlocks(aiResponse);
        const blocks = [
            { type: "divider", divider: {} },
            { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `🌐 AI 翻译（${lang}）` } }] } },
            ...contentBlocks
        ];
        await AIAssistant._executeGuardedPageWrite("appendBlocks", targetPage,
            () => NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey),
            settings
        );

        return `✅ **翻译已追加到页面**\n\n- 目标页面: ${targetPage.name}\n- 翻译语言: ${lang}\n- 翻译内容: ${aiResponse.length} 字\n\n💡 翻译版本已追加到页面末尾（原内容保留）。`;
    } catch (error) {
        return `❌ 翻译失败: ${error.message}`;
    }
},
_ensureAIProperty: async (databaseId, propertyName, propertyType, apiKey) => {
    const database = await NotionAPI.fetchDatabase(databaseId, apiKey);
    const properties = database.properties || {};

    if (properties[propertyName]) return;

    const propDef = {};
    if (propertyType === "multi_select") {
        propDef[propertyName] = { multi_select: { options: [] } };
    } else {
        propDef[propertyName] = { rich_text: {} };
    }

    await AIAssistant._executeGuardedDatabaseWrite("updateDatabase", databaseId,
        () => NotionAPI.updateDatabase(databaseId, propDef, apiKey),
        apiKey
    );
},
handleAIAutofill: async (params, settings, explanation) => {
    if (!OperationGuard.canExecute("updatePage")) {
        return "❌ 权限不足：AI 属性填充需要「标准」及以上权限。\n\n请在设置中提升权限级别。";
    }

    const configCheck = AIAssistant.checkConfig(settings, true);
    if (!configCheck.valid) return configCheck.error;

    const { autofill_type, property_name } = params;
    if (!autofill_type) {
        return "❌ 请指定填充类型。\n\n💡 支持的类型：\n- 摘要：「给所有帖子生成 AI 摘要」\n- 关键词：「提取所有帖子的关键词」\n- 翻译：「把所有帖子标题翻译成英文」";
    }

    // 根据类型确定属性名和 AI 提示词
    let propName, propType, aiPromptTemplate;
    switch (autofill_type) {
        case "summary":
            propName = "AI摘要";
            propType = "rich_text";
            aiPromptTemplate = "请用2-3句话简洁概括以下内容的要点：\n\n";
            break;
        case "keywords":
            propName = "AI关键词";
            propType = "multi_select";
            aiPromptTemplate = "请从以下内容中提取3-5个关键词，用逗号分隔，只返回关键词：\n\n";
            break;
        case "translation":
            propName = "AI翻译";
            propType = "rich_text";
            aiPromptTemplate = "请将以下标题翻译为英文，只返回翻译结果：\n\n";
            break;
        case "custom":
            propName = property_name || "AI自定义";
            propType = "rich_text";
            aiPromptTemplate = "请根据以下内容生成对应的属性值：\n\n";
            break;
        default:
            return `❌ 不支持的填充类型「${autofill_type}」。支持：summary/keywords/translation/custom`;
    }

    ChatState.updateLastMessage(`正在准备 AI 属性填充（${propName}）...`, "processing");

    try {
        await AIAssistant._ensureAIProperty(settings.notionDatabaseId, propName, propType, settings.notionApiKey);

        ChatState.updateLastMessage("正在获取数据库页面...", "processing");

        const allPages = [];
        let cursor = null;
        do {
            const response = await NotionAPI.queryDatabase(settings.notionDatabaseId, null, null, cursor, settings.notionApiKey);
            allPages.push(...(response.results || []));
            cursor = response.has_more ? response.next_cursor : null;
        } while (cursor);

        if (allPages.length === 0) {
            return "📭 数据库中没有找到任何页面。";
        }

        // 过滤属性为空的页面
        const needFill = allPages.filter(page => {
            const prop = page.properties[propName];
            if (!prop) return true;
            if (propType === "multi_select") {
                return !prop.multi_select || prop.multi_select.length === 0;
            }
            return !prop.rich_text || prop.rich_text.length === 0;
        });

        if (needFill.length === 0) {
            return `✅ 所有 ${allPages.length} 个页面的「${propName}」属性都已填充。`;
        }

        const results = { success: 0, failed: 0 };
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        for (let i = 0; i < needFill.length; i++) {
            const page = needFill[i];
            const title = Utils.getPageTitle(page);

            ChatState.updateLastMessage(
                `🔄 正在填充「${propName}」(${i + 1}/${needFill.length})\n\n当前: ${title}`,
                "processing"
            );

            try {
                // 获取内容：翻译类型只需标题，其他需提取页面内容
                let inputText = title;
                if (autofill_type !== "translation") {
                    try {
                        const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 2000);
                        inputText = content || title;
                    } catch { inputText = title; }
                }

                const aiResult = await AIService.requestChat(
                    aiPromptTemplate + inputText,
                    settings,
                    500
                );

                // 更新页面属性
                const updateProps = {};
                if (propType === "multi_select") {
                    const keywords = aiResult.split(/[,，]/).map(k => k.trim()).filter(Boolean).slice(0, 10);
                    updateProps[propName] = { multi_select: keywords.map(k => ({ name: k })) };
                } else {
                    const trimmed = aiResult.slice(0, 2000);
                    updateProps[propName] = { rich_text: [{ type: "text", text: { content: trimmed } }] };
                }

                await AIAssistant._executeGuardedPageWrite("updatePage",
                    { id: page.id, name: title },
                    () => NotionAPI.request("PATCH", `/pages/${page.id}`, { properties: updateProps }, settings.notionApiKey),
                    settings
                );
                results.success++;
            } catch (error) {
                console.error(`[LD-Notion] AI 填充失败: ${title}`, error);
                results.failed++;
            }

            if (i < needFill.length - 1) {
                await Utils.sleep(delay);
            }
        }

        let resultMsg = `✅ **AI 属性填充完成**\n\n`;
        resultMsg += `- 属性名: ${propName}\n`;
        resultMsg += `- 总计: ${allPages.length} 个页面\n`;
        resultMsg += `- 已填充: ${allPages.length - needFill.length} 个\n`;
        resultMsg += `- 本次填充: ${results.success} 个\n`;
        if (results.failed > 0) {
            resultMsg += `- 失败: ${results.failed} 个\n`;
        }
        return resultMsg;
    } catch (error) {
        return `❌ AI 属性填充失败: ${error.message}`;
    }
},
handleAsk: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { question, keyword } = params;
    const searchTerm = question || keyword;

    if (!searchTerm) {
        return "❌ 请描述你的问题。\n\n💡 示例：「关于 Docker 的帖子都说了什么？」";
    }

    ChatState.updateLastMessage("正在搜索相关内容...", "processing");

    try {
        const response = await NotionAPI.search(searchTerm, null, settings.notionApiKey);
        const results = (response.results || []).filter(r => !r.archived && r.object === "page").slice(0, 5);

        if (results.length === 0) {
            return `📭 在工作区中没有找到与「${searchTerm}」相关的内容。`;
        }

        ChatState.updateLastMessage(`找到 ${results.length} 个相关内容，正在提取...`, "processing");

        // 提取每个页面的内容
        const contextParts = [];
        const sourceList = [];
        for (let i = 0; i < results.length; i++) {
            const item = results[i];
            const title = Utils.getPageTitle(item, item.object === "database" ? "未命名数据库" : "未命名页面");
            const url = item.url || "";
            sourceList.push({ title, url });

            try {
                const content = await AIAssistant._extractPageContent(item.id, settings.notionApiKey, 2000);
                contextParts.push(`[${i + 1}] ${title}:\n${content || "（无文本内容）"}`);
            } catch {
                contextParts.push(`[${i + 1}] ${title}:\n（无法读取内容）`);
            }
        }

        ChatState.updateLastMessage("正在分析并生成回答...", "processing");

        const ragPrompt = `你是一个知识问答助手。根据以下来自 Notion 工作区的内容回答用户的问题。
如果内容中没有相关信息，请如实说明。回答后列出信息来源。

--- 参考内容 ---
${contextParts.join("\n\n")}

--- 用户问题 ---
${searchTerm}`;

        const aiAnswer = await AIService.requestChat(ragPrompt, settings, 2000);

        // 拼接来源列表
        let sourceText = "\n\n📚 **信息来源**：\n";
        sourceList.forEach((s, i) => {
            sourceText += `${i + 1}. ${s.title}${s.url ? ` ([链接](${s.url}))` : ""}\n`;
        });

        return aiAnswer + sourceText;
    } catch (error) {
        return `❌ 问答失败: ${error.message}`;
    }
},
handleDeepResearch: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { research_topic, scope = "workspace" } = params;
    if (!research_topic) {
        return "❌ 请描述你的研究主题。\n\n💡 示例：「深入研究一下关于 Docker 的所有内容」";
    }

    try {
        // Phase 1: 拆分主题为多个搜索关键词
        ChatState.updateLastMessage("🔬 正在拆解研究主题...", "processing");

        const keywordsPrompt = `将以下研究主题拆分为3-5个搜索关键词，每行一个关键词，只返回关键词：\n${research_topic}`;
        const keywordsRaw = await AIService.requestChat(keywordsPrompt, settings, 200);
        const keywords = keywordsRaw.split("\n")
            .map(k => k.trim().replace(/^[-•\d.]+\s*/, ""))
            .filter(Boolean)
            .slice(0, 5);

        if (keywords.length === 0) keywords.push(research_topic);

        // Phase 2: 多关键词搜索
        ChatState.updateLastMessage(`🔍 搜索中... (${keywords.length} 个关键词: ${keywords.join(", ")})`, "processing");

        const allResults = [];
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        const normalizedScope = String(scope || "workspace").toLowerCase();
        const useDatabaseScope = normalizedScope === "database";
        let scopedDatabaseInfo = null;
        let scopedTitleProperty = null;
        let scopedRichTextProperties = [];

        if (useDatabaseScope) {
            const scopedDatabaseId = TargetState.getEffectiveAIDatabaseId({
                fallbackDatabaseId: settings.notionDatabaseId,
            });
            if (!scopedDatabaseId) {
                return "❌ 当前未配置可用于深度研究的数据库。请先在设置中配置默认数据库，或将 AI 目标切换到某个数据库。";
            }

            const scopedDatabase = await NotionAPI.fetchDatabase(scopedDatabaseId, settings.notionApiKey);
            scopedDatabaseInfo = {
                id: scopedDatabaseId,
                title: (scopedDatabase.title || []).map((item) => item.plain_text || "").join("") || "目标数据库",
            };
            scopedTitleProperty = Object.entries(scopedDatabase.properties || {}).find(([_, prop]) => prop?.type === "title")?.[0] || null;
            scopedRichTextProperties = Object.entries(scopedDatabase.properties || {})
                .filter(([_, prop]) => prop?.type === "rich_text")
                .map(([name]) => name)
                .filter((name) => ["描述", "摘要", "总结", "说明", "内容"].includes(name));
        }

        for (let i = 0; i < keywords.length; i++) {
            const keyword = keywords[i];
            let pages = [];

            if (useDatabaseScope) {
                const filterConditions = [];
                if (scopedTitleProperty) {
                    filterConditions.push({
                        property: scopedTitleProperty,
                        title: { contains: keyword }
                    });
                }
                scopedRichTextProperties.forEach((propertyName) => {
                    filterConditions.push({
                        property: propertyName,
                        rich_text: { contains: keyword }
                    });
                });

                const filter = filterConditions.length === 1
                    ? filterConditions[0]
                    : (filterConditions.length > 1 ? { or: filterConditions } : null);
                const response = await NotionAPI.queryDatabase(
                    scopedDatabaseInfo.id,
                    filter,
                    null,
                    null,
                    settings.notionApiKey,
                    25
                );
                pages = (response.results || []).filter((item) => {
                    if (item.archived || item.object !== "page") return false;
                    const loweredKeyword = keyword.toLowerCase();
                    const title = Utils.getPageTitle(item, "").toLowerCase();
                    const richTextMatches = scopedRichTextProperties.some((propertyName) => {
                        const value = item.properties?.[propertyName]?.rich_text
                            ?.map((part) => part.plain_text || part.text?.content || "")
                            .join("")
                            .toLowerCase() || "";
                        return value.includes(loweredKeyword);
                    });
                    return title.includes(loweredKeyword) || richTextMatches;
                });
            } else {
                const response = await NotionAPI.search(keyword, null, settings.notionApiKey);
                pages = (response.results || []).filter(r => !r.archived && r.object === "page");
            }

            allResults.push(...pages);
            if (i < keywords.length - 1) await Utils.sleep(delay);
        }

        // 去重（按 ID）
        const uniquePages = [...new Map(allResults.map(r => [r.id, r])).values()];

        if (uniquePages.length === 0) {
            if (useDatabaseScope) {
                return `📭 在数据库「${scopedDatabaseInfo?.title || "目标数据库"}」中没有找到与「${research_topic}」相关的内容。\n\n尝试用更宽泛的关键词，或确认该数据库中包含相关页面。`;
            }
            return `📭 在工作区中没有找到与「${research_topic}」相关的内容。\n\n尝试用更宽泛的关键词，或确保工作区中有相关页面。`;
        }

        // Phase 3: 提取内容（最多10个页面）
        const maxPages = Math.min(10, uniquePages.length);
        ChatState.updateLastMessage(`📄 提取 ${maxPages}/${uniquePages.length} 个页面内容...`, "processing");

        const contentParts = [];
        const sourceList = [];
        for (let i = 0; i < maxPages; i++) {
            const page = uniquePages[i];
            const title = Utils.getPageTitle(page);
            const url = page.url || "";
            sourceList.push({ title, url });

            try {
                const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 3000);
                contentParts.push(`[${i + 1}] ${title}:\n${content || "（无文本内容）"}`);
            } catch {
                contentParts.push(`[${i + 1}] ${title}:\n（无法读取内容）`);
            }
            if (i < maxPages - 1) await Utils.sleep(delay);
        }

        // Phase 4: AI 生成结构化报告
        ChatState.updateLastMessage("📊 正在生成研究报告...", "processing");

        const reportPrompt = `你是一个研究分析师。根据以下来自 Notion 工作区的内容，针对主题「${research_topic}」生成一份结构化研究报告。

报告格式要求（使用 Markdown）:
# 研究报告: ${research_topic}
## 摘要
（2-3句话概括核心发现）
## 主要发现
（3-5个要点，每个要点一句话）
## 详细分析
（按主题分段论述，引用具体来源编号如[1][2]）
## 建议与行动项
（可执行的建议，每条一句话）
## 信息来源
（列出引用的页面）

--- 参考内容 ---
${contentParts.join("\n\n---\n\n")}`;

        const report = await AIService.requestChat(reportPrompt, settings, 4000);

        // 拼接来源列表
        let sourceText = "\n\n📚 **分析基础**：\n";
        sourceList.forEach((s, i) => {
            sourceText += `${i + 1}. ${s.title}${s.url ? ` ([链接](${s.url}))` : ""}\n`;
        });

        const scopeLabel = useDatabaseScope
            ? `数据库「${scopedDatabaseInfo?.title || "目标数据库"}」`
            : "工作区";
        const summary = `🔬 范围：${scopeLabel}。共使用 ${keywords.length} 个关键词，找到 ${uniquePages.length} 个相关页面，深入分析了 ${maxPages} 个。`;

        return `${report}${sourceText}\n---\n${summary}`;
    } catch (error) {
        return `❌ 深度研究失败: ${error.message}`;
    }
},
handleSummarize: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { page_name, page_id, summary_style } = params;
    const style = summary_style || "brief";

    if (!page_name && !page_id) {
        return "❌ 请指定要总结的页面。\n\n💡 示例：「总结一下 xxx 页面的内容」";
    }

    ChatState.updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        ChatState.updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey, 6000);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可总结的内容。`;
        }

        ChatState.updateLastMessage("📝 正在生成摘要...", "processing");

        const styleInstructions = {
            brief: "生成简短摘要（2-3句话），提炼核心要点。",
            detailed: "生成详细摘要，包含：核心主题、主要论点、关键细节和结论。",
            bullet: "以要点列表形式总结，每个要点一行，提炼关键信息。"
        };

        const prompt = `你是一个内容摘要助手。${styleInstructions[style] || styleInstructions.brief}\n\n使用 Markdown 格式输出。\n\n以下是需要总结的内容：\n${existingContent}`;
        const aiResponse = await AIService.requestChat(prompt, settings, 2000);

        return `📝 **页面摘要：${targetPage.name}**\n\n${aiResponse}\n\n---\n📄 摘要风格: ${style === "brief" ? "简短" : style === "detailed" ? "详细" : "要点列表"}`;
    } catch (error) {
        return `❌ 内容总结失败: ${error.message}`;
    }
},
handleBrainstorm: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { brainstorm_topic, page_name, page_id } = params;
    const count = Math.min(Math.max(parseInt(params.brainstorm_count) || 10, 3), 30);
    const topic = brainstorm_topic || page_name || explanation;

    if (!topic) {
        return "❌ 请指定头脑风暴主题。\n\n💡 示例：「围绕远程办公给我一些创意建议」";
    }

    // 如果指定了页面，读取页面内容作为上下文
    let pageContext = "";
    if (page_name || page_id) {
        ChatState.updateLastMessage("正在读取页面内容作为参考...", "processing");
        const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage) {
            pageContext = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey, 3000);
        }
    }

    ChatState.updateLastMessage("💡 正在头脑风暴...", "processing");

    try {
        const contextBlock = pageContext ? `\n\n以下是相关参考内容：\n${pageContext}` : "";
        const prompt = `你是一个创意顾问。围绕主题「${topic}」进行头脑风暴，生成 ${count} 个创意想法或建议。

要求：
- 想法要多样化，涵盖不同角度和维度
- 每个想法包含简短标题和一句话说明
- 从实用到大胆创新，由近及远排列
- 使用 Markdown 编号列表格式输出${contextBlock}`;

        const aiResponse = await AIService.requestChat(prompt, settings, 2000);

        return `💡 **头脑风暴：${topic}**\n\n${aiResponse}\n\n---\n🎯 共生成 ${count} 个创意想法`;
    } catch (error) {
        return `❌ 头脑风暴失败: ${error.message}`;
    }
},
handleProofread: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { page_name, page_id } = params;

    if (!page_name && !page_id) {
        return "❌ 请指定要校对的页面。\n\n💡 示例：「校对一下 xxx 页面的拼写和语法」";
    }

    ChatState.updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        ChatState.updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可校对的内容。`;
        }

        ChatState.updateLastMessage("✅ 正在校对中...", "processing");

        const prompt = `你是一个专业校对编辑。请仔细检查以下内容的拼写、语法和表达问题。

输出格式：
1. 先列出发现的所有问题（每个问题标注位置和类型：拼写/语法/标点/表达）
2. 然后给出修正后的完整内容

如果没有发现任何问题，请说明内容无误。

使用 Markdown 格式输出。

以下是需要校对的内容：
${existingContent}`;

        const aiResponse = await AIService.requestChat(prompt, settings, 3000);

        return `✅ **校对结果：${targetPage.name}**\n\n${aiResponse}`;
    } catch (error) {
        return `❌ 校对失败: ${error.message}`;
    }
},
handleBatchTranslate: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：批量翻译需要「标准」权限级别。";
    }

    const { database_name, database_id, target_language } = params;
    const lang = target_language || "英文";

    if (!database_name && !database_id) {
        return "❌ 请指定要翻译的数据库。\n\n💡 示例：「把 xxx 数据库翻译成日文」";
    }

    ChatState.updateLastMessage("正在查找数据库...", "processing");

    try {
        // 查找数据库
        let dbId = database_id;
        if (!dbId && database_name) {
            const searchResp = await NotionAPI.search(database_name, "database", settings.notionApiKey);
            const db = (searchResp.results || []).find(r => !r.archived);
            if (!db) return `❌ 找不到数据库「${database_name}」。`;
            dbId = db.id;
        }

        // 查询数据库中的页面
        ChatState.updateLastMessage("正在获取页面列表...", "processing");
        const queryResp = await NotionAPI.queryDatabase(dbId, null, null, null, settings.notionApiKey, 20);
        const pages = (queryResp.results || []).filter(p => !p.archived);

        if (pages.length === 0) {
            return `❌ 数据库中没有可翻译的页面。`;
        }

        // 确认操作
        const confirmed = await ConfirmationDialog.show({
            title: `🌐 批量翻译确认`,
            message: `即将翻译 ${pages.length} 个页面为${lang}。\n翻译后的内容将追加到每个页面末尾（原内容保留）。`,
            confirmText: "开始翻译",
            cancelText: "取消"
        });
        if (!confirmed) return "❌ 已取消批量翻译。";

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const title = Utils.getPageTitle(page);
            ChatState.updateLastMessage(`🌐 翻译中 (${i + 1}/${pages.length}): ${title}...`, "processing");

            try {
                const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 4000);
                if (!content.trim()) { failCount++; continue; }

                const prompt = `你是一个专业翻译。将以下内容翻译为${lang}，使用 Markdown 格式，保持原文结构。\n\n原文：\n${content}`;
                const translated = await AIService.requestChat(prompt, settings, 2000);

                const blocks = [
                    { type: "divider", divider: {} },
                    { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `🌐 ${lang}翻译` } }] } },
                    ...AIAssistant._textToBlocks(translated)
                ];
                await AIAssistant._executeGuardedPageWrite("appendBlocks", page,
                    () => NotionAPI.appendBlocks(page.id, blocks, settings.notionApiKey),
                    settings,
                    { itemName: title }
                );
                successCount++;
            } catch {
                failCount++;
            }
        }

        return `🌐 **批量翻译完成**\n\n- 目标语言: ${lang}\n- 成功: ${successCount} 页\n- 失败: ${failCount} 页\n- 总计: ${pages.length} 页\n\n💡 翻译内容已追加到每个页面末尾。`;
    } catch (error) {
        return `❌ 批量翻译失败: ${error.message}`;
    }
},
handleExtractToDatabase: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("createDatabase")) {
        return "❌ 权限不足：创建数据库需要「高级」权限级别。";
    }

    const { page_name, page_id, database_name, extraction_prompt } = params;

    if (!page_name && !page_id) {
        return "❌ 请指定源页面。\n\n💡 示例：「把 xxx 页面的笔记提取为任务数据库」";
    }

    ChatState.updateLastMessage("正在读取源页面...", "processing");

    try {
        const sourcePage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (sourcePage?.error) return `❌ 页面解析失败：${sourcePage.error}`;
        if (!sourcePage) return `❌ 找不到页面「${page_name || page_id}」。`;

        const content = await AIAssistant._extractPageContent(sourcePage.id, settings.notionApiKey, 6000);
        if (!content.trim()) {
            return `❌ 页面「${sourcePage.name}」没有可提取的内容。`;
        }

        // AI 分析内容并生成结构化数据
        ChatState.updateLastMessage("🔍 正在分析内容结构...", "processing");

        const dbName = database_name || `${sourcePage.name} - 提取数据`;
        const extractHint = extraction_prompt || explanation || "提取所有结构化条目";

        const analyzePrompt = `你是一个数据提取专家。分析以下页面内容，提取结构化信息。

提取要求：${extractHint}

请返回 JSON 格式（只返回 JSON）：
{
  "properties": [
{ "name": "属性名", "type": "title|rich_text|select|number|checkbox", "description": "属性说明" }
  ],
  "entries": [
{ "属性名1": "值1", "属性名2": "值2" }
  ]
}

属性类型说明：
- 第一个属性必须是 title 类型
- 分类/状态 → select，数量/金额 → number，是否 → checkbox，其他 → rich_text

页面内容：
${content}`;

        const aiResponse = await AIService.requestChat(analyzePrompt, settings, 3000);

        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return `❌ AI 无法从页面内容中提取结构化数据。请尝试更具体地描述提取要求。`;
        }

        let extractedData;
        try {
            extractedData = JSON.parse(jsonMatch[0]);
        } catch {
            return `❌ AI 提取的数据格式无效。请换一种方式描述提取要求。`;
        }

        if (!extractedData.properties || !extractedData.entries || extractedData.entries.length === 0) {
            return `❌ 未能从页面中提取到有效条目。`;
        }

        // 确认操作
        const confirmed = await ConfirmationDialog.show({
            title: "📊 创建数据库确认",
            message: `将从「${sourcePage.name}」提取 ${extractedData.entries.length} 个条目。\n数据库名称: ${dbName}\n属性: ${extractedData.properties.map(p => p.name).join(", ")}`,
            confirmText: "创建",
            cancelText: "取消"
        });
        if (!confirmed) return "❌ 已取消。";

        // 创建数据库
        ChatState.updateLastMessage("📊 正在创建数据库...", "processing");

        const dbProperties = {};
        for (const prop of extractedData.properties) {
            if (prop.type === "title") {
                dbProperties[prop.name] = { title: {} };
            } else if (prop.type === "select") {
                dbProperties[prop.name] = { select: {} };
            } else if (prop.type === "number") {
                dbProperties[prop.name] = { number: {} };
            } else if (prop.type === "checkbox") {
                dbProperties[prop.name] = { checkbox: {} };
            } else {
                dbProperties[prop.name] = { rich_text: {} };
            }
        }

        const newDb = await AIAssistant._executeGuardedPageWrite("createDatabase", sourcePage,
            () => NotionAPI.createDatabase(sourcePage.id, dbName, dbProperties, settings.notionApiKey),
            settings,
            { itemName: dbName }
        );

        // 填充条目
        ChatState.updateLastMessage(`📝 正在填充 ${extractedData.entries.length} 个条目...`, "processing");

        let addedCount = 0;
        const titleProp = extractedData.properties.find(p => p.type === "title");
        const titleKey = titleProp ? titleProp.name : extractedData.properties[0].name;

        for (const entry of extractedData.entries) {
            try {
                const pageProperties = {};
                for (const prop of extractedData.properties) {
                    const val = entry[prop.name];
                    if (val === undefined || val === null) continue;

                    if (prop.type === "title") {
                        pageProperties[prop.name] = { title: [{ text: { content: String(val) } }] };
                    } else if (prop.type === "select") {
                        pageProperties[prop.name] = { select: { name: String(val) } };
                    } else if (prop.type === "number") {
                        pageProperties[prop.name] = { number: Number(val) || 0 };
                    } else if (prop.type === "checkbox") {
                        pageProperties[prop.name] = { checkbox: Boolean(val) };
                    } else {
                        pageProperties[prop.name] = { rich_text: [{ text: { content: String(val).slice(0, 2000) } }] };
                    }
                }

                const entryName = String(entry[titleKey] || `条目 ${addedCount + 1}`).trim() || `条目 ${addedCount + 1}`;
                await AIAssistant._executeGuardedDatabaseWrite("createDatabasePage", newDb.id,
                    () => NotionAPI.createPage(newDb.id, pageProperties, settings.notionApiKey),
                    settings,
                    { itemName: entryName }
                );
                addedCount++;
            } catch { /* skip failed entries */ }
        }

        return `📊 **数据库创建完成**\n\n- 数据库: ${dbName}\n- 来源: ${sourcePage.name}\n- 属性: ${extractedData.properties.map(p => p.name).join(", ")}\n- 条目: ${addedCount}/${extractedData.entries.length}\n\n💡 数据库已创建在源页面下方。`;
    } catch (error) {
        return `❌ 提取失败: ${error.message}`;
    }
},
handleGeneratePages: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("createDatabase")) {
        return "❌ 权限不足：多页面生成需要「高级」权限级别。";
    }

    const { page_name, page_id, parent_page_name, parent_page_id, structure_prompt } = params;
    const topic = page_name || structure_prompt || explanation;

    if (!topic) {
        return "❌ 请描述要生成的内容主题。\n\n💡 示例：「为新员工创建入职指南，包含工具清单、团队介绍、常见问题」";
    }

    ChatState.updateLastMessage("📑 正在规划页面结构...", "processing");

    try {
        // AI 规划页面结构
        const planPrompt = `你是一个 Notion 内容架构师。根据用户需求规划多页面内容结构。

用户需求：${topic}
${structure_prompt ? `补充要求：${structure_prompt}` : ""}

返回 JSON 格式（只返回 JSON）：
{
  "parent_title": "父页面标题",
  "parent_summary": "父页面简介（1-2句话）",
  "children": [
{
  "title": "子页面标题",
  "description": "子页面内容描述（用于生成正文）",
  "icon": "emoji图标"
}
  ]
}

要求：
- 子页面数量控制在 3-8 个
- 每个子页面应有明确的主题和边界
- 父页面作为目录/概览页`;

        const planResponse = await AIService.requestChat(planPrompt, settings, 1500);

        const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return `❌ AI 无法规划页面结构。请更具体地描述需求。`;
        }

        let plan;
        try {
            plan = JSON.parse(jsonMatch[0]);
        } catch {
            return `❌ AI 生成的结构无效。请换一种方式描述。`;
        }

        if (!plan.children || plan.children.length === 0) {
            return `❌ AI 未能规划出有效的子页面结构。`;
        }

        // 确认
        const pageList = plan.children.map(c => `${c.icon || "📄"} ${c.title}`).join("\n");
        const confirmed = await ConfirmationDialog.show({
            title: "📑 多页面生成确认",
            message: `将创建以下页面结构：\n\n📁 ${plan.parent_title}\n${pageList}\n\n共 ${plan.children.length + 1} 个页面。`,
            confirmText: "开始生成",
            cancelText: "取消"
        });
        if (!confirmed) return "❌ 已取消。";

        // 确定父页面位置
        let parentPageId = parent_page_id;
        if (!parentPageId && parent_page_name) {
            const parentPage = await AIAssistant._resolvePageId(parent_page_name, null, settings.notionApiKey);
            if (parentPage) parentPageId = parentPage.id;
        }

        // 创建父页面
        ChatState.updateLastMessage(`📁 正在创建父页面: ${plan.parent_title}...`, "processing");

        const parentProps = {
            title: { title: [{ text: { content: plan.parent_title } }] }
        };

        let parentPage;
        if (parentPageId) {
            parentPage = await AIAssistant._executeGuardedPageWrite("createDatabasePage",
                { id: parentPageId, name: parent_page_name || parentPageId },
                () => NotionAPI.createPageInPage(parentPageId, parentProps, settings.notionApiKey),
                settings,
                { itemName: plan.parent_title, pageId: parentPageId }
            );
        } else {
            // Notion API 不支持在工作区根目录创建页面，必须指定父页面
            return `❌ 请指定父页面。Notion API 要求页面必须创建在某个父页面下。\n\n💡 示例：「在 xxx 页面下创建入职指南」`;
        }

        // 写入父页面概览
        const overviewBlocks = AIAssistant._textToBlocks(`${plan.parent_summary || ""}\n\n## 📋 目录\n\n${plan.children.map((c, i) => `${i + 1}. ${c.icon || "📄"} **${c.title}** - ${c.description}`).join("\n")}`);
        await AIAssistant._executeGuardedPageWrite("appendBlocks", parentPage,
            () => NotionAPI.appendBlocks(parentPage.id, overviewBlocks, settings.notionApiKey),
            settings,
            { itemName: plan.parent_title }
        );

        // 创建子页面并生成内容
        let createdCount = 0;
        for (let i = 0; i < plan.children.length; i++) {
            const child = plan.children[i];
            ChatState.updateLastMessage(`📝 生成子页面 (${i + 1}/${plan.children.length}): ${child.title}...`, "processing");

            try {
                // 创建子页面
                const childProps = {
                    title: { title: [{ text: { content: `${child.icon || ""} ${child.title}`.trim() } }] }
                };
                const childPage = await AIAssistant._executeGuardedPageWrite("createDatabasePage", parentPage,
                    () => NotionAPI.createPageInPage(parentPage.id, childProps, settings.notionApiKey),
                    settings,
                    { itemName: child.title }
                );

                // 生成子页面内容
                const contentPrompt = `为以下主题生成详细内容，使用 Markdown 格式。

主题：${child.title}
描述：${child.description}
上下文：这是「${plan.parent_title}」的子页面

请生成实用、具体的内容，包含合适的标题层级和结构化信息。`;

                const content = await AIService.requestChat(contentPrompt, settings, 2000);
                const contentBlocks = AIAssistant._textToBlocks(content);
                await AIAssistant._executeGuardedPageWrite("appendBlocks", childPage,
                    () => NotionAPI.appendBlocks(childPage.id, contentBlocks, settings.notionApiKey),
                    settings,
                    { itemName: child.title }
                );
                createdCount++;
            } catch { /* skip failed pages */ }
        }

        return `📑 **多页面内容生成完成**\n\n- 父页面: ${plan.parent_title}\n- 子页面: ${createdCount}/${plan.children.length} 创建成功\n\n💡 所有页面已创建并填充内容。`;
    } catch (error) {
        return `❌ 页面生成失败: ${error.message}`;
    }
},
handleBatchAnalyze: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { database_name, database_id, analysis_prompt } = params;
    const limit = Math.min(Math.max(parseInt(params.limit) || 10, 1), 20);

    if (!database_name && !database_id) {
        // 使用默认配置的数据库
        if (!settings.notionDatabaseId) {
            return "❌ 请指定要分析的数据库，或先配置默认数据库 ID。\n\n💡 示例：「分析 xxx 数据库的所有页面」";
        }
    }

    ChatState.updateLastMessage("正在查找数据库...", "processing");

    try {
        let dbId = database_id || settings.notionDatabaseId;
        if (!dbId && database_name) {
            const searchResp = await NotionAPI.search(database_name, "database", settings.notionApiKey);
            const db = (searchResp.results || []).find(r => !r.archived);
            if (!db) return `❌ 找不到数据库「${database_name}」。`;
            dbId = db.id;
        }

        // 查询页面
        ChatState.updateLastMessage("正在获取页面...", "processing");
        const queryResp = await NotionAPI.queryDatabase(dbId, null, null, null, settings.notionApiKey, limit);
        const pages = (queryResp.results || []).filter(p => !p.archived);

        if (pages.length === 0) {
            return `❌ 数据库中没有可分析的页面。`;
        }

        // 提取内容
        ChatState.updateLastMessage(`🔎 正在提取 ${pages.length} 个页面内容...`, "processing");

        const contentParts = [];
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const title = Utils.getPageTitle(page);
            ChatState.updateLastMessage(`🔎 提取中 (${i + 1}/${pages.length}): ${title}...`, "processing");

            const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 2000);
            contentParts.push(`## ${title}\n${content || "（无内容）"}`);
        }

        // AI 生成综合分析
        ChatState.updateLastMessage("📊 正在生成综合分析...", "processing");

        const analysisGoal = analysis_prompt || explanation || "综合分析所有页面内容，找出关键主题、趋势和建议";

        const prompt = `你是一个数据分析师。根据以下来自数据库的多个页面内容进行综合分析。

分析要求：${analysisGoal}

请使用 Markdown 格式输出分析报告，包含：
1. 概述（总体情况摘要）
2. 关键发现（主要主题和模式）
3. 详细分析（按主题/类别分组）
4. 趋势与洞察
5. 建议与行动项

--- 以下是 ${pages.length} 个页面的内容 ---

${contentParts.join("\n\n---\n\n")}`;

        const report = await AIService.requestChat(prompt, settings, 4000);

        return `📊 **批量分析报告**\n\n${report}\n\n---\n🔎 共分析 ${pages.length} 个页面`;
    } catch (error) {
        return `❌ 批量分析失败: ${error.message}`;
    }
},
handleGitHubImport: async (params, settings, explanation) => {
    const username = params.username || Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
    const token = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
    const databaseId = settings.notionDatabaseId;

    if (!username) {
        return "❌ 请先在设置中配置 GitHub 用户名。\n\n💡 在 Notion 面板的设置中找到「GitHub 收藏导入」部分填写用户名。";
    }
    if (!settings.notionApiKey) {
        return "❌ 请先配置 Notion API Key。";
    }
    if (!databaseId) {
        return "❌ 请先配置 GitHub 收藏的目标数据库 ID。\n\n💡 可以在设置中专门指定，或使用默认数据库。";
    }

    const classify = params.classify || false;
    const importTypes = (require("../import").GitHubAPI).getImportTypes();

    try {
        const allResults = await (require("../import").GitHubExporter).exportAll({
            apiKey: settings.notionApiKey,
            databaseId,
            username,
            token,
            aiApiKey: settings.aiApiKey,
            aiService: settings.aiService,
            aiModel: settings.aiModel,
            aiBaseUrl: settings.aiBaseUrl,
            categories: settings.categories,
        }, (msg, pct) => {
            ChatState.updateLastMessage(`🐙 ${msg}`, "processing");
        });

        let response = `✅ **GitHub 导入完成**\n\n`;
        let totalExported = 0;
        let totalFailed = 0;

        const typeNames = { stars: "Stars", repos: "Repos", forks: "Forks", gists: "Gists" };
        for (const type of importTypes) {
            const r = allResults[type];
            if (!r) continue;
            if (r.error) {
                response += `❌ ${typeNames[type]}: ${r.error}\n`;
            } else {
                response += `📊 ${typeNames[type]}: 共 ${r.total} 个，导出 ${r.exported} 个`;
                if (r.failed > 0) response += `，失败 ${r.failed} 个`;
                response += `\n`;
                totalExported += r.exported || 0;
                totalFailed += r.failed || 0;
            }
        }

        if (totalExported === 0 && totalFailed === 0) {
            response += `\n所有内容已是最新状态。`;
        }

        // 如果需要分类
        if (classify && totalExported > 0 && settings.aiApiKey) {
            ChatState.updateLastMessage("🏷️ 正在进行 AI 分类...", "processing");
            try {
                const classifyResult = await (require("../import").GitHubExporter).classifyRepos({
                    ...settings,
                    databaseId,
                }, (msg, pct) => {
                    ChatState.updateLastMessage(`🏷️ ${msg}`, "processing");
                });
                response += `\n\n🏷️ **AI 分类完成**: 已分类 ${classifyResult.classified}/${classifyResult.total} 个`;
            } catch (e) {
                response += `\n\n⚠️ AI 分类出错: ${e.message}`;
            }
        } else if (classify && !settings.aiApiKey) {
            response += `\n\n⚠️ 未配置 AI API Key，跳过自动分类。`;
        }

        return response;
    } catch (error) {
        return `❌ GitHub 导入失败: ${error.message}`;
    }
},
handleBookmarkImport: async (params, settings, explanation) => {
    const databaseId = settings.notionDatabaseId;

    if (!settings.notionApiKey) {
        return "❌ 请先配置 Notion API Key。";
    }
    if (!databaseId) {
        return "❌ 请先配置目标数据库 ID。";
    }
    if (!(require("../bridge").BookmarkBridge).isExtensionAvailable()) {
        const installUrl = (require("../api").InstallHelper).getBookmarkExtensionUrl();
        return `❌ 未检测到 LD-Notion 书签桥接扩展。\n\n💡 请点击安装：${installUrl}\n\n手动安装步骤：\n1. 打开 chrome://extensions/\n2. 开启「开发者模式」\n3. 点击「加载已解压的扩展」\n4. 选择项目中的 chrome-extension 文件夹\n5. 刷新当前页面\n\n🔎 诊断建议：\n- 若你当前使用的是 chrome-extension-full 独立版，请关闭 userscript，避免双模式混用\n- 若你坚持 userscript 模式，请仅安装 chrome-extension（桥接版）`;
    }

    try {
        ChatState.updateLastMessage("📖 正在读取浏览器书签...", "processing");
        const tree = await (require("../bridge").BookmarkBridge).getBookmarkTree();
        const allBookmarks = (require("../bridge").BookmarkExporter).flattenTree(tree);

        if (allBookmarks.length === 0) {
            return "📭 没有找到浏览器书签。";
        }

        const dedupStrict = Utils.isBookmarkDedupStrict();
        const newCount = dedupStrict
            ? allBookmarks.filter(b => !(require("../bridge").BookmarkExporter).isExported(b.url)).length
            : allBookmarks.length;
        ChatState.updateLastMessage(`📖 找到 ${allBookmarks.length} 个书签 (${newCount} 个新书签)，正在导出...`, "processing");

        const result = await (require("../bridge").BookmarkExporter).exportBookmarks({
            apiKey: settings.notionApiKey,
            databaseId,
            bookmarks: allBookmarks,
            aiApiKey: settings.aiApiKey,
            aiService: settings.aiService,
            aiModel: settings.aiModel,
            aiBaseUrl: settings.aiBaseUrl,
        }, (msg, pct) => {
            ChatState.updateLastMessage(`📖 ${msg}`, "processing");
        });

        let response = `✅ **浏览器书签导入完成**\n\n`;
        response += `📊 共 ${result.total} 个书签\n`;
        response += `📥 本次导出 ${result.exported} 个\n`;
        if (result.failed > 0) response += `❌ 失败 ${result.failed} 个\n`;
        if (result.exported === 0 && result.failed === 0) response += `\n所有书签已是最新状态。`;

        // 如果有 AI 配置，询问是否分类
        if (result.exported > 0 && settings.aiApiKey) {
            response += `\n\n💡 可以输入「分类书签」让 AI 自动为导入的书签分类。`;
        }

        return response;
    } catch (error) {
        return `❌ 书签导入失败: ${error.message}`;
    }
},
handleTemplateOutput: async (params, settings, explanation) => {
    const configCheck = AIAssistant.checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：模板输出需要「标准」权限级别。";
    }

    const { template_name, page_name, page_id, custom_context } = params;

    // 加载模板列表
    let templates;
    try {
        templates = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.AI_TEMPLATES, CONFIG.DEFAULTS.aiTemplates));
    } catch {
        templates = JSON.parse(CONFIG.DEFAULTS.aiTemplates);
    }

    if (!template_name) {
        // 列出可用模板
        const list = templates.map(t => `${t.icon} **${t.name}**`).join("\n");
        return `📋 **可用的 AI 输出模板**\n\n${list}\n\n💡 使用方式：「用周报模板总结 xxx 页面」或「用摘要提纲模板整理 xxx」`;
    }

    // 查找匹配模板
    const template = templates.find(t =>
        t.name === template_name ||
        t.name.includes(template_name) ||
        template_name.includes(t.name)
    );

    if (!template) {
        const list = templates.map(t => `${t.icon} ${t.name}`).join(", ");
        return `❌ 找不到模板「${template_name}」。\n\n可用模板: ${list}`;
    }

    // 获取页面上下文（如指定了页面）
    let pageContext = "";
    let targetPage = null;
    if (page_name || page_id) {
        ChatState.updateLastMessage("正在读取页面内容...", "processing");
        targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (targetPage) {
            pageContext = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey, 4000);
        }
    }

    // 组合 prompt
    ChatState.updateLastMessage(`${template.icon} 正在使用「${template.name}」模板生成...`, "processing");

    const contextBlock = pageContext ? `\n\n以下是参考内容：\n${pageContext}` : "";
    const customBlock = custom_context ? `\n\n用户补充说明：${custom_context}` : "";
    const fullPrompt = `${template.prompt}${contextBlock}${customBlock}\n\n请使用 Markdown 格式输出。`;

    const aiResponse = await AIService.requestChat(fullPrompt, settings, 3000);

    // 如果有目标页面，写入 Notion
        if (targetPage) {
            ChatState.updateLastMessage("正在写入页面...", "processing");
            const contentBlocks = AIAssistant._textToBlocks(aiResponse);
            const blocks = [
                { type: "divider", divider: {} },
                { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `${template.icon} ${template.name}` } }] } },
                ...contentBlocks
            ];
            await AIAssistant._executeGuardedPageWrite("appendBlocks", targetPage,
                () => NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey),
                settings,
                { itemName: targetPage.name }
            );
            return `✅ **${template.icon} ${template.name}** 已生成并写入页面「${targetPage.name}」\n\n${aiResponse}`;
        }

    return `${template.icon} **${template.name}**\n\n${aiResponse}\n\n💡 如需写入页面，请指定目标页面：「用${template.name}模板处理 xxx 页面」`;
},
};
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
        const iconEmoji = String(args.icon_emoji || "").trim();
        const iconUrl = String(args.icon_url || "").trim();
        const clearIcon = !!args.clear_icon;

        if (clearIcon) return null;
        if (iconEmoji) return { type: "emoji", emoji: iconEmoji };
        if (iconUrl) return { type: "external", external: { url: iconUrl } };
        return undefined;
    },

    _buildPageCoverPayload: (args = {}) => {
        const coverUrl = String(args.cover_url || "").trim();
        const clearCover = !!args.clear_cover;

        if (clearCover) return null;
        if (coverUrl) return { type: "external", external: { url: coverUrl } };
        return undefined;
    },

    _normalizeNotionProperties: (rawProperties = {}) => {
        const properties = {};
        for (const [key, value] of Object.entries(rawProperties || {})) {
            if (!key || value === undefined) continue;

            if (value && typeof value === "object" && !Array.isArray(value)) {
                properties[key] = value;
                continue;
            }

            if (Array.isArray(value)) {
                const options = value.map(v => String(v || "").trim()).filter(Boolean).map(name => ({ name }));
                if (options.length > 0) {
                    properties[key] = { multi_select: options };
                }
                continue;
            }

            if (typeof value === "number") {
                properties[key] = { number: value };
                continue;
            }

            if (typeof value === "boolean") {
                properties[key] = { checkbox: value };
                continue;
            }

            properties[key] = {
                rich_text: [{ type: "text", text: { content: String(value) } }]
            };
        }

        return properties;
    },

    _buildPropertyValuePayload: (value, type = "text") => {
        switch (type) {
            case "title":
                return { title: [{ type: "text", text: { content: String(value) } }] };
            case "select":
                return { select: { name: String(value) } };
            case "multi_select":
                return {
                    multi_select: String(value)
                        .split(/[,，]/)
                        .map(t => t.trim())
                        .filter(Boolean)
                        .map(name => ({ name }))
                };
            case "number":
                return { number: Number(value) };
            case "date":
                return { date: { start: String(value) } };
            case "checkbox":
                return { checkbox: !!value };
            default:
                return { rich_text: [{ type: "text", text: { content: String(value) } }] };
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

    _resolveGuardApiKey: (settingsOrApiKey, fallbackApiKey) => {
        if (typeof settingsOrApiKey === "string" && settingsOrApiKey) {
            return settingsOrApiKey;
        }
        if (settingsOrApiKey?.notionApiKey) {
            return settingsOrApiKey.notionApiKey;
        }
        if (settingsOrApiKey?.apiKey) {
            return settingsOrApiKey.apiKey;
        }
        return fallbackApiKey;
    },

    _buildGuardContext: (context = {}, settingsOrApiKey) => {
        const guardContext = { ...context };
        const apiKey = AIAssistant._resolveGuardApiKey(settingsOrApiKey, guardContext.apiKey);
        if (apiKey) {
            guardContext.apiKey = apiKey;
        }
        if (!guardContext.itemName && guardContext.pageId) {
            guardContext.itemName = guardContext.pageId;
        }
        return guardContext;
    },

    _executeGuardedWrite: async (operation, executor, context = {}, settingsOrApiKey) => {
        return await OperationGuard.execute(
            operation,
            executor,
            AIAssistant._buildGuardContext(context, settingsOrApiKey)
        );
    },

    _executeGuardedPageWrite: async (operation, target, executor, settingsOrApiKey, context = {}) => {
        const pageId = context.pageId || target?.id || "";
        const itemName = context.itemName || target?.name || target?.id || pageId || "未知页面";
        return await AIAssistant._executeGuardedWrite(
            operation,
            executor,
            { ...context, itemName, pageId },
            settingsOrApiKey
        );
    },

    _executeGuardedDatabaseWrite: async (operation, databaseId, executor, settingsOrApiKey, context = {}) => {
        return await AIAssistant._executeGuardedWrite(
            operation,
            executor,
            {
                ...context,
                itemName: context.itemName || databaseId,
                databaseId: context.databaseId || databaseId,
            },
            settingsOrApiKey
        );
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
            } catch {
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
        if (!block || !block.type) {
            throw new Error("无法识别块类型");
        }

        const rawContent = String(content || "");
        const richText = [{ type: "text", text: { content: String(content || "") } }];
        const type = block.type;
        const current = block[type] || {};

        switch (type) {
            case "paragraph":
            case "heading_1":
            case "heading_2":
            case "heading_3":
            case "bulleted_list_item":
            case "numbered_list_item":
            case "quote":
            case "toggle":
                return {
                    [type]: {
                        ...current,
                        rich_text: richText,
                        color: options.color || current.color,
                    }
                };
            case "to_do":
                return {
                    to_do: {
                        ...current,
                        rich_text: richText,
                        checked: typeof options.checked === "boolean" ? options.checked : !!current.checked,
                        color: options.color || current.color,
                    }
                };
            case "callout":
                return {
                    callout: {
                        ...current,
                        rich_text: richText,
                        icon: options.icon || current.icon,
                        color: options.color || current.color,
                    }
                };
            case "code":
                return {
                    code: {
                        ...current,
                        rich_text: richText,
                        caption: Array.isArray(current.caption) ? current.caption : [],
                        language: current.language || "plain text",
                    }
                };
            case "template":
                return {
                    template: {
                        ...current,
                        rich_text: richText,
                    }
                };
            case "equation":
                return {
                    equation: {
                        ...current,
                        expression: rawContent,
                    }
                };
            case "bookmark":
                if (!Utils.isHttpUrl(rawContent)) {
                    throw new Error("bookmark 块仅支持更新为 http/https URL。");
                }
                return {
                    bookmark: {
                        ...current,
                        url: rawContent,
                        caption: Array.isArray(current.caption) ? current.caption : [],
                    }
                };
            case "embed":
                if (!Utils.isHttpUrl(rawContent)) {
                    throw new Error("embed 块仅支持更新为 http/https URL。");
                }
                return {
                    embed: {
                        ...current,
                        url: rawContent,
                        caption: Array.isArray(current.caption) ? current.caption : [],
                    }
                };
            case "link_preview":
                throw new Error("link_preview 块是 Notion API 的只读返回类型，不能直接更新；请改用 bookmark 或 embed 块。");
            case "table_row":
                throw new Error("table_row 块当前无法通过单一 content 参数安全更新单元格；请改用页面 Markdown 编辑或重新插入表格行。");
            default:
                throw new Error(`暂不支持更新块类型「${type}」`);
        }
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
                } catch {
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
            } catch {
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

            // 尝试提取 JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
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

    handleAgentTask: async (params, settings, explanation) => {
        const configCheck = AIAssistant.checkConfig(settings, false);
        if (!configCheck.valid) return configCheck.error;

        if (!OperationGuard.canExecute("agentTask")) {
            return "❌ 权限不足：Agent 自主代理需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
        }

        const { task_description } = params;
        if (!task_description) {
            return "❌ 请描述你想让 Agent 完成的任务。\n\n💡 示例：「帮我整理所有未分类的帖子并生成摘要」";
        }

        ChatState.updateLastMessage("🤖 Agent 正在规划任务...", "processing");

        try {
            const planPrompt = `你是一个 Notion 任务规划器。将用户的高层任务分解为可执行步骤。
每一步必须是以下操作之一：query, search, workspace_search, classify, batch_classify,
update, move, copy, create_database, write_content, edit_content, translate_content,
ai_autofill, ask, deep_research, template_output, summarize, brainstorm, proofread,
batch_translate, extract_to_database, generate_pages, batch_analyze

返回 JSON（只返回 JSON，不要其他内容）：
{
  "plan": [
{ "intent": "操作名", "params": { 对应操作的参数 }, "explanation": "步骤说明" }
  ],
  "explanation": "整体计划说明"
}

用户任务：${task_description}`;

            const planResponse = await AIService.requestChat(planPrompt, settings, 1500);

            // 解析计划 JSON
            const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return "❌ Agent 无法生成有效的执行计划。请尝试更具体地描述任务。";
            }

            let plan;
            try {
                plan = JSON.parse(jsonMatch[0]);
            } catch {
                return "❌ Agent 生成的计划格式无效。请尝试换一种方式描述任务。";
            }

            if (!plan.plan || plan.plan.length === 0) {
                return "❌ Agent 未能分解出有效的执行步骤。请尝试更具体地描述任务。";
            }

            // 展示计划并等待确认
            let planMsg = `🤖 **Agent 执行计划**\n${plan.explanation || ""}\n\n`;
            plan.plan.forEach((step, i) => {
                planMsg += `${i + 1}. ${step.explanation}\n`;
            });

            ChatState.updateLastMessage(planMsg + "\n⏳ 等待确认...", "processing");

            const confirmed = await ConfirmationDialog.show({
                title: "🤖 Agent 执行计划确认",
                message: plan.plan.map((s, i) => `${i + 1}. ${s.explanation}`).join("\n"),
                itemName: task_description,
                countdown: 5,
                requireNameInput: false,
            });

            if (!confirmed) {
                return "🤖 Agent 任务已取消。";
            }

            // 执行计划（复用 compound 的执行模式）
            const results = [];
            let aborted = false;

            for (let i = 0; i < plan.plan.length; i++) {
                const step = plan.plan[i];

                ChatState.updateLastMessage(
                    `${planMsg}\n⏳ 步骤 ${i + 1}/${plan.plan.length}: ${step.explanation}`,
                    "processing"
                );

                try {
                    const stepResult = await AIAssistant.executeIntent(step, settings);
                    const normalizedStepResult = AIAssistant._normalizeExecutionResult(stepResult);

                    if (AIAssistant._isErrorResult(normalizedStepResult)) {
                        results.push({ index: i + 1, explanation: step.explanation, success: false, result: normalizedStepResult });
                        aborted = true;
                        break;
                    }

                    results.push({ index: i + 1, explanation: step.explanation, success: true, result: normalizedStepResult });
                } catch (error) {
                    results.push({
                        index: i + 1,
                        explanation: step.explanation,
                        success: false,
                        result: AIAssistant._normalizeExecutionResult(`❌ ${error.message}`, { status: "error", name: step.intent })
                    });
                    aborted = true;
                    break;
                }
            }

            // 汇总报告
            let report = `🤖 **Agent 任务${aborted ? "中断" : "完成"}**\n\n`;
            for (const r of results) {
                report += `${r.success ? "✅" : "❌"} 步骤 ${r.index}: ${r.explanation}\n`;
            }

            if (aborted) {
                const skipped = plan.plan.slice(results.length);
                if (skipped.length > 0) {
                    report += `\n⏭️ 已跳过：\n`;
                    skipped.forEach((step, i) => {
                        report += `${results.length + i + 1}. ${step.explanation}\n`;
                    });
                }
            }

            report += `\n---\n`;
            for (const r of results) {
                report += `\n**步骤 ${r.index}**: ${r.explanation}\n${AIAssistant._resultToText(r.result)}\n`;
            }

            return report;
        } catch (error) {
            return `❌ Agent 任务失败: ${error.message}`;
        }
    },

    // ======= Agent Loop (ReAct 模式) =======

    // 尝试解析 AI 回复为工具调用 JSON
    _tryParseToolCall: (response) => {
        if (!response) return null;
        const trimmed = response.trim();
        // 尝试直接解析整个响应为 JSON
        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
            if (parsed.tool && typeof parsed.tool === "string") {
                // 白名单校验：tool 必须在 AI_AGENT_TOOLS 中定义
                const toolDef = AI_AGENT_TOOLS[parsed.tool];
                if (!toolDef) {
                    console.warn(`[LD-Notion] _tryParseToolCall: 拒绝未知工具 "${parsed.tool}"`);
                    return null;
                }
                // 参数类型校验：args 必须是对象
                if (parsed.args !== undefined && (typeof parsed.args !== "object" || parsed.args === null || Array.isArray(parsed.args))) {
                    console.warn(`[LD-Notion] _tryParseToolCall: 工具 "${parsed.tool}" 的参数类型无效`);
                    return null;
                }
                return parsed;
            }
        } catch {}
        // 尝试提取嵌入的 JSON
        const jsonMatch = trimmed.match(/\{[\s\S]*"tool"\s*:\s*"[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[0]);
                if (parsed.tool && typeof parsed.tool === "string") {
                    // 白名单校验：tool 必须在 AI_AGENT_TOOLS 中定义
                    const toolDef = AI_AGENT_TOOLS[parsed.tool];
                    if (!toolDef) {
                        console.warn(`[LD-Notion] _tryParseToolCall: 拒绝未知工具 "${parsed.tool}"`);
                        return null;
                    }
                    // 参数类型校验：args 必须是对象
                    if (parsed.args !== undefined && (typeof parsed.args !== "object" || parsed.args === null || Array.isArray(parsed.args))) {
                        console.warn(`[LD-Notion] _tryParseToolCall: 工具 "${parsed.tool}" 的参数类型无效`);
                        return null;
                    }
                    return parsed;
                }
            } catch {}
        }
        return null;
    },

    // 核心 Agent 循环
    runAgentLoop: async (userMessage, settings, maxIterations = Storage.get(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS, CONFIG.DEFAULTS.agentMaxIterations)) => {
        const permLevel = OperationGuard.getLevel();

        // 1. 构建系统提示（含可用工具列表，根据权限过滤）
        const availableTools = Object.entries(AIAssistant.AGENT_TOOLS)
            .filter(([_, tool]) => tool.level <= permLevel)
            .map(([name, tool]) => `- ${name}: ${tool.description} | 参数: ${tool.params}`)
            .join("\n");

        const aiTargetState = TargetState.getDisplayAITargetState();
        let dbInfo;
        if (aiTargetState.mode === "all") {
            let cached;
            try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch { cached = {}; }
            const dbCount = cached.databases?.length || 0;
            dbInfo = `查询模式: 所有工作区数据库 (${dbCount} 个)`;
        } else if (aiTargetState.mode === "database") {
            let cached;
            try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch { cached = {}; }
            const dbName = cached.databases?.find(d => d.id === aiTargetState.databaseId)?.title || aiTargetState.databaseId;
            dbInfo = `已配置的数据库: ${dbName} (ID: ${aiTargetState.databaseId})`;
        } else if (aiTargetState.mode === "page") {
            let cached;
            try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch { cached = {}; }
            const pageName = cached.pages?.find(p => p.id === aiTargetState.pageId)?.title || aiTargetState.pageId;
            dbInfo = `当前 AI 目标页面: ${pageName} (ID: ${aiTargetState.pageId})`;
        } else {
            dbInfo = settings.notionDatabaseId ? `已配置的数据库 ID: ${settings.notionDatabaseId}` : "未配置数据库 ID";
        }

        // 读取 Agent 个性化配置
        const persona = {
            name: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName),
            tone: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone),
            expertise: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise),
            instructions: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions),
        };

        const personaBlock = persona.instructions
            ? `\n个性化指令：${String(persona.instructions).slice(0, 500).replace(/<system|ignore previous|ignore all previous|disregard|you are now|new instructions/gi, "[已过滤]")}`
            : "";

        const systemPrompt = `你是${persona.name}，一个专注于${persona.expertise}的助手。语气风格：${persona.tone}。${personaBlock}
你可以使用以下工具来完成用户的任务。

当前环境：${dbInfo}
当前权限级别：${CONFIG.PERMISSION_NAMES[permLevel] || permLevel}

可用工具：
${availableTools}

使用规则：
1. 每次回复只能做一件事：调用一个工具 OR 给用户最终回复
2. 调用工具时，只返回 JSON（不要包含其他文字）：
   {"tool": "工具名", "args": {参数对象}, "thought": "你的思考过程"}
3. 给用户最终回复时，直接返回文本（不要 JSON 格式）
4. 根据工具返回的结果决定下一步行动
5. 如果任务需要多步，逐步执行，每次一个工具调用
6. 执行写入/修改操作前，先用读取工具确认目标存在
7. 参数值必须是具体的值，不要用占位符`;

        // 2. Agent 循环
        const messages = [{ role: "user", content: `<user_input>\n${userMessage}\n</user_input>` }];
        let iteration = 0;

        while (iteration < maxIterations) {
            iteration++;
            ChatState.updateLastMessage(
                `🤖 Agent 思考中... (${iteration}/${maxIterations})`,
                "processing"
            );

            // 调用 AI
            let response;
            try {
                response = await AIService.requestAgentChat(
                    systemPrompt, messages, settings, 1500
                );
            } catch (error) {
                return `❌ AI 调用失败: ${error.message}`;
            }

            // 尝试解析为工具调用
            const toolCall = AIAssistant._tryParseToolCall(response);

            if (!toolCall) {
                // 不是工具调用 → 最终回复
                return response;
            }

            // 记录 AI 的工具调用
            messages.push({ role: "assistant", content: response });

            // 执行工具
            const thoughtText = toolCall.thought ? `\n💭 ${toolCall.thought}` : "";
            ChatState.updateLastMessage(
                `🤖 正在执行: ${toolCall.tool}...${thoughtText}`,
                "processing"
            );

            const tool = AIAssistant.AGENT_TOOLS[toolCall.tool];
            let result;
            if (!tool) {
                result = AIAssistant._normalizeExecutionResult(
                    `错误: 未知工具 "${toolCall.tool}"。可用工具: ${Object.keys(AIAssistant.AGENT_TOOLS).filter(name => AIAssistant.AGENT_TOOLS[name].level <= permLevel).join(", ")}`,
                    { source: "tool", name: toolCall.tool, status: "error" }
                );
            } else if (tool.level > permLevel) {
                result = AIAssistant._normalizeExecutionResult(
                    `错误: 权限不足，"${toolCall.tool}" 需要「${CONFIG.PERMISSION_NAMES[tool.level]}」权限，当前为「${CONFIG.PERMISSION_NAMES[permLevel]}」`,
                    { source: "tool", name: toolCall.tool, status: "error" }
                );
            } else {
                // Level >= 1 的写入操作需要用户确认
                if (tool.level >= 1) {
                    try {
                        result = await OperationGuard.execute(toolCall.tool, async () => {
                            return await tool.execute(toolCall.args || {}, settings);
                        }, {
                            source: "ai-agent-loop",
                            actor: "ai",
                            itemName: toolCall.tool,
                            trigger: "ai_tool_execution",
                        });
                    } catch (guardError) {
                        if (guardError.message === "操作已取消") {
                            result = AIAssistant._normalizeExecutionResult(
                                `错误: 用户取消了 "${toolCall.tool}" 操作的执行`,
                                { source: "tool", name: toolCall.tool, status: "cancelled" }
                            );
                        } else {
                            result = AIAssistant._normalizeExecutionResult(`错误: ${guardError.message}`, {
                                source: "tool",
                                name: toolCall.tool,
                                status: "error",
                            });
                        }
                    }
                } else {
                    try {
                        result = await tool.execute(toolCall.args || {}, settings);
                    } catch (e) {
                        result = AIAssistant._normalizeExecutionResult(`错误: ${e.message}`, {
                            source: "tool",
                            name: toolCall.tool,
                            status: "error",
                        });
                    }
                }
            }

            // 将工具结果喂回 AI
            messages.push({ role: "user", content: `[工具结果] ${toolCall.tool}:\n${AIAssistant._resultToAgentPayload(result)}` });
        }

        return "🤖 Agent 达到最大执行步数，已停止。如果任务尚未完成，请继续描述你的需求。";
    },
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

module.exports = { AIService, ChatState, QUICK_INTENT_PATTERNS, QUICK_INTENT_RULES, AI_AGENT_TOOLS, AIHandlers, AIAssistant, AIWelcomeUI, ChatUI, AIClassifier };
