"use strict";

// ai-service.js — AI 请求服务层 (M3 milestone 拆分: 提取自 ai/index.js AIService ~515 LOC)。
// baseUrl 规范化+白名单校验(UrlValidator.validateAiBaseUrl)、模型路径段编码、
// GM_xmlhttpRequest 封装(15s 超时+退避),OpenAI/Anthropic/Google 三端点。
// 依赖: CONFIG/Utils/Storage/NotionAPI/UrlValidator (无回流边)。

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");
const { UrlValidator } = require("../security/UrlValidator");

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

    // P4 收敛(c03): model 拼入 URL 路径 —— 含 / ? # 等字符会篡改路径/查询
    _modelPathSegment: (model) => encodeURIComponent(String(model ?? "").trim()),

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
<title>${isolateContent(title)}</title>
<body>${isolateContent(content).slice(0, 2000)}</body>
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
        // P4 收敛(c03 2/3 共识 dsf+qwen): model 与其他两处 Gemini 调用点一致做路径段编码，
        // 否则含 /、?、# 的模型名可越出路径段篡改请求
        const modelSeg = AIService._modelPathSegment(model);
        const url = normalizedBase
            ? `${normalizedBase}/v1beta/models/${modelSeg}:generateContent`
            : `https://generativelanguage.googleapis.com/v1beta/models/${modelSeg}:generateContent`;

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
        // P4 收敛(c03): 纯标点响应清洗后为空串 —— cat.includes("") 恒真, 会误命中首个分类
        if (!cleaned) return categories[categories.length - 1];

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
    // 401/400 等不可重试错误直接 reject。对比 NotionAPI 429 重试。
    _retryable: async (requestFn, retries = 2) => {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error;
                const msg = String(error?.message || error);
                // 不可重试：鉴权失败/参数错误（401/403/400），直接抛出
                // P4 收敛(c03): 裸 invalid 子串会误伤瞬时错误(如 "invalid upstream response"/"500 invalid JSON")
                // → 收紧为状态码词边界 + 具体凭证/请求类错误码
                if (/\b(401|403|400)\b|鉴权|授权|unauthorized|forbidden|invalid[_ -]?(api[ _-]?key|token|client|grant|request|param)/i.test(msg)) {
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
    // ISS-20260728-020 (OBS-001): onUsage 可选回调 —— 提取 result.usage token 用量,
    // 此前 extractResponse 只取 content 丢弃 usage(observability 缺口)。调用方(runAgentLoop)
    // 传入记录函数将 per-invocation token 累计落 AgentTrace.usage。
    _chatRequest: (url, headers, body, extractResponse, errorPrefix, timeout = 90000, onUsage = null) => {
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
                            // OBS-001: 先上报 usage 再提取 content —— 用量字段在 provider 原始响应中
                            if (typeof onUsage === "function") {
                                try { onUsage(result?.usage); } catch { /* 用量记录失败不阻断主流程 */ }
                            }
                            resolve(extractResponse(result));
                        } else {
                            reject(new Error(result.error?.message || `${errorPrefix}错误: ${response.status} ${Utils.truncateText(response.responseText || "", 300)}`));
                        }
                    } catch (e) {
                        reject(new Error(`解析响应失败: ${e.message}`));
                    }
                },
                onerror: (error) => reject(new Error(`网络请求失败: ${Utils.formatRequestError(error)}`)),
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
        const modelSeg = AIService._modelPathSegment(model);
        const url = normalizedBase
            ? `${normalizedBase}/v1beta/models/${modelSeg}:generateContent`
            : `https://generativelanguage.googleapis.com/v1beta/models/${modelSeg}:generateContent`;

        return AIService._chatRequest(
            url,
            { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } },
            (result) => result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "",
            "Gemini"
        );
    },

    // Agent 多轮对话请求 —— v3.14.6 (S-02): 系统指令与不可信用户内容角色分离,
    // OpenAI messages[role=system] / Anthropic 顶层 system / Gemini systemInstruction;
    // 不支持通道保留原压平 + 防伪前缀
    // ISS-20260728-020: onUsage 可选 —— runAgentLoop 传入,逐次 AI 调用提取 result.usage 落 trace
    requestAgentChat: async (systemPrompt, messages, settings, maxTokens = 1500, onUsage = null) => {
        const { aiService, aiApiKey, aiModel, aiBaseUrl } = settings;
        const provider = AIService.PROVIDERS[aiService];
        if (!provider) throw new Error(`未知的 AI 服务: ${aiService}`);
        const model = aiModel || provider.defaultModel;
        const normalizedMessages = (messages || []).map((msg) => ({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: String(msg.content ?? ""),
        }));
        const systemText = String(systemPrompt ?? "");

        if (aiService === "openai") {
            const normalizedBase = AIService._normalizeBaseUrl(aiBaseUrl, "v1");
            const url = normalizedBase
                ? `${normalizedBase}/v1/chat/completions`
                : "https://api.openai.com/v1/chat/completions";
            return await AIService._chatRequest(
                url,
                { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
                { model, messages: [{ role: "system", content: systemText }, ...normalizedMessages], max_completion_tokens: maxTokens, temperature: 0.7 },
                (result) => result.choices?.[0]?.message?.content?.trim() || "",
                "OpenAI",
                90000,
                onUsage
            );
        }
        if (aiService === "claude") {
            const normalizedBase = AIService._normalizeBaseUrl(aiBaseUrl, "v1");
            const url = normalizedBase
                ? `${normalizedBase}/v1/messages`
                : "https://api.anthropic.com/v1/messages";
            return await AIService._chatRequest(
                url,
                { "x-api-key": aiApiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
                { model, system: systemText, messages: normalizedMessages.map((m) => ({ role: m.role, content: [{ type: "text", text: m.content }] })), max_tokens: maxTokens },
                (result) => result.content?.[0]?.text?.trim() || "",
                "Claude",
                90000,
                onUsage
            );
        }
        if (aiService === "gemini") {
            const normalizedBase = AIService._normalizeBaseUrl(aiBaseUrl, "v1beta");
            const modelSeg = AIService._modelPathSegment(model);
            const url = normalizedBase
                ? `${normalizedBase}/v1beta/models/${modelSeg}:generateContent`
                : `https://generativelanguage.googleapis.com/v1beta/models/${modelSeg}:generateContent`;
            return await AIService._chatRequest(
                url,
                { "Content-Type": "application/json", "x-goog-api-key": aiApiKey },
                { systemInstruction: { parts: [{ text: systemText }] }, contents: normalizedMessages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } },
                (result) => result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "",
                "Gemini",
                90000,
                onUsage
            );
        }

        // 不支持通道: 保留压平 + 防伪前缀(用户内容仍经调用方 isolateContent 隔离, 纵深防御)
        let prompt = `[系统指令]\n${systemText}\n\n`;
        for (const msg of normalizedMessages) {
            if (msg.role === "user") {
                prompt += `[用户]: ${msg.content}\n\n`;
            } else {
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
        const entry = cache[service];
        if (!Array.isArray(entry?.models)) return [];
        // P4 收敛(c03): 指纹校验——端点/密钥变更后旧缓存不再生效(避免下拉展示旧端点模型)
        if (entry.fingerprint !== AIService.getModelsCacheFingerprint()) return [];
        return entry.models;
    },

    getAvailableModels: (service) => {
        const cachedModels = AIService.getCachedModels(service);
        if (cachedModels.length > 0) return cachedModels;
        return AIService.PROVIDERS[service]?.models || [];
    },

    // 模型缓存指纹: 端点 + 密钥单向哈希(禁止明文子串), 变更即失效
    getModelsCacheFingerprint: () => {
        const baseUrl = String(Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, "") || "");
        const keyHash = Utils.apiKeyHash(String(Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "") || ""));
        return `${baseUrl}|${keyHash}`;
    },

    persistFetchedModels: (service, models) => {
        const normalizedModels = Array.isArray(models) ? models : [];
        const cache = AIService.getFetchedModelsCache();
        const snapshot = {
            models: normalizedModels,
            timestamp: Date.now(),
            fingerprint: AIService.getModelsCacheFingerprint(),
        };
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
                onerror: (error) => reject(new Error(`网络请求失败: ${Utils.formatRequestError(error)}`)),
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
                onerror: (error) => reject(new Error(`网络请求失败: ${Utils.formatRequestError(error)}`)),
                timeout: 15000,
                ontimeout: () => reject(new Error("获取模型列表超时")),
            });
        });
    },
};
module.exports = { AIService };
