"use strict";

// 依赖引入
const { CONFIG, MSG, SUPPORTED_FILE_TYPES } = require("../config");
const ErrorModel = require("../errors/ErrorModel");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionOAuth } = require("../auth");
const { UrlValidator } = require("../security/UrlValidator");

const { SiteDetector, InstallHelper, EMOJI_MAP, NOTION_LANGUAGES, normalizeLanguage } = require("./constants");
const { DOMToNotion } = require("./DOMToNotion");
const { ObsidianAPI, HTMLToMarkdown } = require("./obsidian");
const { installUploadMethods } = require("./notion-upload");


// 认证终态错误:401 且无法自动续签(或续签后仍 401)。
// 标记 isAuthTerminal 供批量循环 fail-fast 中止(逐项重试只会重复注定失败的请求,
// 464 项全部报 "API token is invalid" 的根因)。
// 消息关键词表:Notion 官方错误 code(API token is invalid / unauthorized)
// 与 OAuth 终态(invalid_grant / invalid_client)均视为认证终态。
// v3.14.12 (三模型共识): 401 不再无条件终态——仅官方认证类 code 才终态;
// 空 token/格式非法/代理 401 等场景区分处理,避免误中止整批。
const isAuthTerminalStatus = (status, result = {}) => {
    const code = String(result?.code || "").toLowerCase();
    const msg = String(result?.message || "").toLowerCase();
    if (code === "unauthorized" || code === "invalid_bearer_token") return true;
    // P4 共识(dsf): status 参数此前未参与判定——非 401 响应体(网关/代理 4xx-5xx HTML)
    // 含 unauthorized 关键词会被误判认证终态, fail-fast 中止整批丢失可重试项。
    // 关键词启发式仅对 401 生效; 官方 code 判定不限状态(Notion 仅在认证失败时返回)。
    if (status === 401 && (msg.includes("api token is invalid") || msg.includes("unauthorized"))) return true;
    // 401 但无官方认证 code(如代理/网关 401 HTML): 非终态,逐项失败留待下轮
    return false;
};


const NotionTransport = Object.freeze({
    // P4 收敛(c05): endpoint 由调用方拼接 id —— 拒路径穿越/反斜线/片段注入
    // (../ 会被 HTTP 客户端规范化到同域其他端点; ? 合法用于分页游标)
    buildUrl: (endpoint) => {
        const ep = String(endpoint ?? "");
        const pathPart = ep.split("?")[0];
        if (!ep.startsWith("/") || /[\s#\\]/.test(ep) || pathPart.includes("..") || pathPart.includes("//")) {
            throw new Error(`非法 Notion API 端点: ${ep.slice(0, 80)}`);
        }
        return `https://api.notion.com/v1${ep}`;
    },

    buildHeaders: ({ token, notionVersion }) => ({
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": notionVersion || CONFIG.API.NOTION_VERSION,
    }),

    request: ({ method, endpoint, data, token, notionVersion }) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: NotionTransport.buildUrl(endpoint),
                headers: NotionTransport.buildHeaders({ token, notionVersion }),
                data: data ? JSON.stringify(data) : undefined,
                onload: resolve,
                onerror: (error) => {
                    const message = error?.error || error?.message || String(error);
                    reject(new Error(`网络请求失败: ${message}`));
                },
                timeout: 30000,
                ontimeout: () => reject(new Error("Notion API 请求超时")),
            });
        });
    },
});


const NotionAPI = {
    Transport: NotionTransport,
    _transportAdapter: null,
    // F-SYNC-04: 共享请求预算 gate(默认 null = 行为与旧版一致)。
    // 由 SyncEngine 注入 SyncRateLimiter.gateAcquire;多端同步开启时所有
    // Notion 请求(含导出)共享 3 req/s 令牌桶。
    _requestGate: null,
    // v3.14.6 (AUD-ARCH-11): 续签冷却截止时间戳, 非终态续签失败后 60s 内不再重放续签
    _refreshCooldownUntil: null,

    configureTransport: (transport) => {
        if (!transport || typeof transport.request !== "function") {
            throw new Error("Notion transport 适配器必须提供 request 方法");
        }
        NotionAPI._transportAdapter = transport;
        return NotionAPI.getTransport();
    },

    resetTransport: () => {
        NotionAPI._transportAdapter = null;
        return NotionAPI.Transport;
    },

    getTransport: () => NotionAPI._transportAdapter || NotionAPI.Transport,

    /**
     * 注入/移除请求 gate(校验必须是函数)
     * @param {Function|null} gate - async () => void,进入 request 前 await
     */
    setRequestGate: (gate) => {
        if (gate !== null && typeof gate !== "function") {
            throw new Error("request gate 必须是函数或 null");
        }
        NotionAPI._requestGate = gate;
    },

    request: async (method, endpoint, data, apiKey, retries = 3, options = {}) => {
        const notionVersion = options.notionVersion || CONFIG.API.NOTION_VERSION;

        // F-SYNC-04: gate 为 null 时与旧版字节级一致
        if (NotionAPI._requestGate) {
            await NotionAPI._requestGate();
        }

        const doRequest = async (attempt, token = NotionOAuth.resolveRequestToken(apiKey), allowRefresh = true) => {
            // v3.14.12 (三模型共识): 空 token 预检——不发请求,本地抛配置错误,
            // 避免空 Bearer 头得到同款 401 被误判认证终态中止整批。
            // v3.14.12 复核(三模型): 空 token 对整批是确定性失败,标记终态 fail-fast,
            // 否则 464 项逐项本地抛错进 failed 且 authAborted 不产生(empty_token UI 分支不可达)
            if (!token) {
                const emptyError = new Error("Notion API Key 为空: 未读取到已保存的 API Key,请重新保存(或重新 OAuth 一键授权)");
                emptyError.authCode = "EMPTY_TOKEN";
                emptyError.isAuthTerminal = true;
                emptyError.statusCode = 0;
                throw emptyError;
            }
            const response = await NotionAPI.getTransport().request({
                method,
                endpoint,
                data,
                token,
                notionVersion,
            });

            // 处理速率限制
            if (response.status === 429 && attempt < retries) {
                // P4 共识(qwen): Retry-After 上限 60s——异常/恶意响应头可导致长时间挂起与队列饥饿
                const retryAfter = Math.min(parseInt(response.responseHeaders?.match(/retry-after:\s*(\d+)/i)?.[1]) || 1, 60);
                console.warn(`Notion API 速率限制，${retryAfter}秒后重试 (${attempt + 1}/${retries})`);
                await Utils.sleep(retryAfter * 1000 + 500);
                // wave6 共识(dsf): 重试递归此前绕过共享 gate(token 桶) —— 重试同样须过闸,
                // 否则 429 重试洪峰可突破调用方限流预算
                if (NotionAPI._requestGate) await NotionAPI._requestGate();
                return doRequest(attempt + 1, token, allowRefresh);
            }

            // P4 共识(glm): 区分“空响应体”(容忍, 回退 {})与“非空但非法 JSON”(代理/网关 HTML)——
            // 后者当成功返回会让下游拿到 result.id=undefined 并发起误导性请求
            const parsedBody = Utils.safeJsonParse(response.responseText, null);
            const result = parsedBody === null ? {} : parsedBody;

            // v3.14.17 (P0-2): 重试耗尽后的 429 携带 retryCount,供 UI 展示"已自动重试 N 次仍被限流"
            // (H2: 该分支此前在 result 声明之前引用 result → TDZ ReferenceError,已移至声明后)
            if (response.status === 429) {
                const rateError = new Error(`Notion API 速率限制: ${result.message || response.status}`);
                rateError.statusCode = response.status;
                rateError.retryCount = attempt + 1;
                throw ErrorModel.annotateError(rateError);
            }
            if (response.status >= 200 && response.status < 300) {
                // P4 共识(glm): 2xx 但响应体非空且无法解析为 JSON 不可当成功
                if (parsedBody === null && String(response.responseText || "").trim()) {
                    const parseError = new Error(`Notion API 响应解析失败: HTTP ${response.status} 返回非 JSON 内容`);
                    parseError.statusCode = response.status;
                    throw ErrorModel.annotateError(parseError);
                }
                return result;
            }
            if (response.status === 401 && allowRefresh && NotionOAuth.canAutoRefresh()) {
                // v3.14.6 (AUD-ARCH-11): 续签冷却 60s —— 批量循环 464 项逐个 401 时,
                // 冷却期内跳过续签重放直接按非终态 401 抛(逐项失败留待下轮)
                if (NotionAPI._refreshCooldownUntil && Date.now() < NotionAPI._refreshCooldownUntil) {
                    const cooldownError = new Error(`Notion API 错误: ${result.message || response.status}(续签冷却中)`);
                    cooldownError.statusCode = response.status;
                    throw cooldownError;
                }
                try {
                    const refreshedToken = await NotionOAuth.refreshAccessToken();
                    return doRequest(attempt, refreshedToken, false);
                } catch (refreshError) {
                    const error = new Error(`Notion OAuth 续签失败: ${refreshError.message}`);
                    // v3.14.6 (AUD-ARCH-11): 仅认证终态(invalid_grant/invalid_client/凭证类关键词)
                    // 才标记 isAuthTerminal 中止整批; 网络抖动/超时/5xx 为可恢复瞬态, 抛非终态
                    // 让批量循环逐项失败重试(60s 冷却压顶, 不重放续签)
                    if (NotionOAuth.isTerminalRefreshError(refreshError)) {
                        error.isAuthTerminal = true;
                    } else {
                        NotionAPI._refreshCooldownUntil = Date.now() + 60 * 1000;
                    }
                    throw error;
                }
            }
            // 认证终态(401 不可续签/续签后仍 401/官方 unauthorized code):携带标记抛出,
            // 供批量导出循环 fail-fast 中止批次(v3.14.5)
            if (isAuthTerminalStatus(response.status, result)) {
                const authError = new Error(`Notion API 错误: ${result.message || response.status}`);
                authError.isAuthTerminal = true;
                authError.statusCode = response.status;
                // v3.14.12 (三模型共识): 透传官方 code 供 UI 按场景分支文案
                authError.authCode = String(result?.code || "").toLowerCase() || "unauthorized";
                throw ErrorModel.annotateError(authError);
            }
            // bug2: 404「Could not find」= 资源未共享给当前集成/已删除/跨工作区 ——
            // OAuth 用户最常见原因是授权时未勾选该资源所在页面, 原样透传英文原文无行动指引,
            // 此处追加可行动中文提示(所有消费端 statusSpan/报告同步受益)
            const notFoundHint = response.status === 404
                ? "。该资源对当前集成不可见：OAuth 用户请重新授权并勾选其所在页面（或在该资源页 ••• → 连接 → 勾选本集成）；也可从工作区下拉选择集成可见的资源；并确认未删除、同一工作区"
                : "";
            throw ErrorModel.annotateError(new Error(`Notion API 错误: ${result.message || response.status}${notFoundHint}`));
        };

        try {
            return await doRequest(0);
        } catch (error) {
            if (error instanceof Error) {
                // v3.14.17 (P0-1): 兜底统一标注分类(已有 ux 的幂等跳过)——所有 Notion API 错误
                // 均带可行动文案供 UI 呈现,不再出现无指引的裸错误
                return Promise.reject(ErrorModel.annotateError(error));
            }
            throw new Error(`解析响应失败: ${error?.message || String(error)}`);
        }
    },

    // 验证 API Key 和 Database
    validateConfig: async (apiKey, databaseId) => {
        try {
            await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
            return { valid: true };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    },

    // 自动设置数据库属性
    setupDatabaseProperties: async (databaseId, apiKey) => {
        // 定义所需的属性结构（名称 -> { 类型名, schema }）
        const requiredProperties = {
            "标题": { typeName: "title", schema: { title: {} } },
            "链接": { typeName: "url", schema: { url: {} } },
            "分类": { typeName: "rich_text", schema: { rich_text: {} } },
            "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
            "作者": { typeName: "rich_text", schema: { rich_text: {} } },
            "收藏时间": { typeName: "date", schema: { date: {} } },
            "帖子数": { typeName: "number", schema: { number: { format: "number" } } },
            "浏览数": { typeName: "number", schema: { number: { format: "number" } } },
            "点赞数": { typeName: "number", schema: { number: { format: "number" } } },
        };

        try {
            // 获取当前数据库结构
            const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
            const existingProps = database.properties || {};

            // 分析属性状态
            const propsToAdd = {};
            const propsToUpdate = {};
            const typeConflicts = [];

            for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                const existingProp = existingProps[name];

                if (!existingProp) {
                    // 属性不存在
                    if (typeName === "title") {
                        // 特殊处理：title 属性需要重命名现有的
                        const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                        if (existingTitle && existingTitle[0] !== name) {
                            propsToUpdate[existingTitle[0]] = { name: name };
                        }
                    } else {
                        propsToAdd[name] = schema;
                    }
                } else if (existingProp.type !== typeName) {
                    // 属性存在但类型不匹配
                    typeConflicts.push({
                        name,
                        expected: typeName,
                        actual: existingProp.type
                    });
                }
                // 如果属性存在且类型匹配，无需处理
            }

            // 如果有类型冲突，返回错误信息
            if (typeConflicts.length > 0) {
                const conflictDetails = typeConflicts.map(c =>
                    `"${c.name}": 期望 ${c.expected}，实际 ${c.actual}`
                ).join("; ");
                return {
                    success: false,
                    error: `属性类型不匹配: ${conflictDetails}。请手动修改这些属性的类型，或删除后重新运行自动设置。`
                };
            }

            const allChanges = { ...propsToAdd, ...propsToUpdate };

            if (Object.keys(allChanges).length === 0) {
                return { success: true, message: "所有属性已正确配置，无需更新" };
            }

            // 更新数据库
            await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                properties: allChanges
            }, apiKey);

            const addedCount = Object.keys(propsToAdd).length;
            const renamedCount = Object.keys(propsToUpdate).length;
            let message = "";
            if (addedCount > 0) message += `已添加 ${addedCount} 个属性`;
            if (renamedCount > 0) message += `${addedCount > 0 ? "，" : ""}已重命名 ${renamedCount} 个属性`;

            return {
                success: true,
                message: message,
                added: Object.keys(propsToAdd),
                renamed: Object.keys(propsToUpdate)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // 创建数据库页面（帖子记录）
    createDatabasePage: async (databaseId, properties, children, apiKey) => {
        const data = {
            parent: { database_id: databaseId },
            properties: properties,
            children: children.slice(0, 100), // Notion 限制
        };

        const page = await NotionAPI.request("POST", "/pages", data, apiKey);

        // 如果有剩余的 blocks，追加
        if (children.length > 100) {
            await NotionAPI.appendBlocks(page.id, children.slice(100), apiKey);
        }

        return page;
    },

    // 通用页面创建（支持数据库或页面作为父级，并允许设置 icon/cover）
    createPageObject: async (parent, properties, children, apiKey, options = {}) => {
        if (!parent || typeof parent !== "object") {
            throw new Error("parent 不能为空");
        }

        const data = {
            parent,
            properties: properties || {},
            children: Array.isArray(children) ? children.slice(0, 100) : [],
        };

        if (options.icon !== undefined) data.icon = options.icon;
        if (options.cover !== undefined) data.cover = options.cover;

        const page = await NotionAPI.request("POST", "/pages", data, apiKey);

        if (Array.isArray(children) && children.length > 100) {
            await NotionAPI.appendBlocks(page.id, children.slice(100), apiKey);
        }

        return page;
    },

    // 在页面下创建子页面
    createPageInPage: async (parentPageId, properties, apiKey) => {
        return await NotionAPI.createPageObject(
            { page_id: parentPageId },
            properties,
            [],
            apiKey
        );
    },

    // createPageInWorkspace 已移除：Notion API 不支持 parent: { workspace: true }
    // 创建页面必须指定 parent.page_id 或 parent.database_id

    // 在数据库中创建页面（简化版，无 children）
    createPage: async (databaseId, properties, apiKey) => {
        return await NotionAPI.createDatabasePage(databaseId, properties, [], apiKey);
    },

    // 追加 blocks
    appendBlocks: async (pageId, blocks, apiKey) => {
        for (let i = 0; i < blocks.length; i += 100) {
            const chunk = blocks.slice(i, i + 100);
            await NotionAPI.request("PATCH", `/blocks/${pageId}/children`, { children: chunk }, apiKey);
            await Utils.sleep(300); // 避免速率限制
        }
    },

    // ========== 搜索和读取操作 (READONLY) ==========

    // 搜索工作区
    search: async (query, filter, apiKey, startCursor = undefined) => {
        const data = { query };
        if (filter) {
            data.filter = filter; // { property: "object", value: "page" | "database" }
        }
        if (startCursor) {
            data.start_cursor = startCursor;
        }
        return await NotionAPI.request("POST", "/search", data, apiKey);
    },

    // 获取页面信息
    fetchPage: async (pageId, apiKey) => {
        return await NotionAPI.request("GET", `/pages/${pageId}`, null, apiKey);
    },

    // 获取单个块信息
    fetchBlock: async (blockId, apiKey) => {
        return await NotionAPI.request("GET", `/blocks/${blockId}`, null, apiKey);
    },

    // 获取块的子块
    fetchBlocks: async (blockId, cursor, apiKey) => {
        let endpoint = `/blocks/${blockId}/children`;
        if (cursor) endpoint += `?start_cursor=${cursor}`;
        return await NotionAPI.request("GET", endpoint, null, apiKey);
    },

    // 追加子块，支持末尾/开头/某个块之后插入
    appendBlockChildren: async (blockId, children, apiKey, options = {}) => {
        const safeChildren = Array.isArray(children) ? children : [];
        const endpoint = `/blocks/${blockId}/children`;

        // P4 共识(glm): Notion 单次追加上限 100 块, 超限整包 400 导致全部丢失。
        // wave6 共识(dsf): 另有含嵌套子块的 1000 块总上限 —— 仅按顶层切分时 100 个各含
        // 多子块的容器仍会被整包 400。两上限同时遵守, 超限即切片。
        // 空数组不再发请求: children: [] 会被 Notion 400, 属无效调用。
        if (safeChildren.length === 0) return null;
        const countNested = (block) => {
            const container = block && block[block.type];
            const kids = Array.isArray(container?.children) ? container.children : [];
            let total = 1;
            for (const kid of kids) total += countNested(kid);
            return total;
        };
        const chunks = [];
        let current = [];
        let currentCount = 0;
        for (const block of safeChildren) {
            const blockSize = countNested(block);
            if (current.length > 0 && (current.length >= 100 || currentCount + blockSize > 1000)) {
                chunks.push(current);
                current = [];
                currentCount = 0;
            }
            current.push(block);
            currentCount += blockSize;
        }
        if (current.length > 0) chunks.push(current);
        if (chunks.length === 0) chunks.push([]);

        let lastResult = null;
        // P4 收敛(c05b1-glm): 不带 after 的追加一律落到父块子列表末尾 —— 多片提交时第 2 片起
        // 必须锚定在上一片最后新建块之后, 否则内容追加到列表末尾与既有块交错(静默乱序)。
        // 响应未返回 results 时退回不带 after(固定锚点会让后续分片倒序插入, 比落到末尾更糟)
        let anchor = options.after ? String(options.after) : null;
        for (let i = 0; i < chunks.length; i++) {
            const payload = { children: chunks[i] };
            if (anchor) {
                payload.after = anchor;
            }
            lastResult = await NotionAPI.request("PATCH", endpoint, payload, apiKey);
            const created = Array.isArray(lastResult?.results) ? lastResult.results : [];
            anchor = created.length > 0 ? String(created[created.length - 1].id) : null;
        }
        return lastResult;
    },

    // 获取数据库信息
    fetchDatabase: async (databaseId, apiKey) => {
        return await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
    },

    // 更新数据库 Schema（添加/修改属性）
    updateDatabase: async (databaseId, properties, apiKey) => {
        return await NotionAPI.request("PATCH", `/databases/${databaseId}`, { properties }, apiKey);
    },

    // 查询数据库
    queryDatabase: async (databaseId, filter, sorts, cursor, apiKey, pageSize) => {
        const data = {};
        let normalizedCursor = cursor;
        let normalizedPageSize = pageSize;

        if (typeof normalizedCursor === "number" && typeof normalizedPageSize === "undefined") {
            normalizedPageSize = normalizedCursor;
            normalizedCursor = null;
        }

        if (filter) data.filter = filter;
        if (sorts) data.sorts = sorts;
        if (normalizedCursor) data.start_cursor = normalizedCursor;

        const safePageSize = parseInt(normalizedPageSize, 10);
        if (Number.isFinite(safePageSize) && safePageSize > 0) {
            data.page_size = Math.min(safePageSize, 100);
        }

        return await NotionAPI.request("POST", `/databases/${databaseId}/query`, data, apiKey);
    },

    // ========== 更新操作 (STANDARD) ==========

    // 更新页面属性
    updatePage: async (pageId, properties, apiKey) => {
        return await NotionAPI.request("PATCH", `/pages/${pageId}`, { properties }, apiKey);
    },

    // 更新页面元数据（icon / cover / lock / trash 等）
    updatePageMeta: async (pageId, payload, apiKey) => {
        return await NotionAPI.request("PATCH", `/pages/${pageId}`, payload, apiKey);
    },

    // 更新块内容
    updateBlock: async (blockId, blockData, apiKey) => {
        return await NotionAPI.request("PATCH", `/blocks/${blockId}`, blockData, apiKey);
    },

    // ========== 高级操作 (ADVANCED) ==========

    // 移动页面到新父级
    movePage: async (pageId, newParentId, parentType, apiKey) => {
        const parent = parentType === "database"
            ? { database_id: newParentId }
            : { page_id: newParentId };
        return await NotionAPI.request("PATCH", `/pages/${pageId}`, { parent }, apiKey);
    },

    // 创建数据库
    createDatabase: async (parentPageId, title, properties, apiKey) => {
        const data = {
            parent: { type: "page_id", page_id: parentPageId },
            title: [{ type: "text", text: { content: title } }],
            properties: properties,
        };
        return await NotionAPI.request("POST", "/databases", data, apiKey);
    },

    // 复制页面 (获取内容后创建新页面)
    duplicatePage: async (pageId, targetParentId, parentType, apiKey) => {
        // 获取原页面信息
        const originalPage = await NotionAPI.fetchPage(pageId, apiKey);

        // 获取原页面的所有块
        const allBlocks = [];
        let cursor = null;
        const seenCursors = new Set();
        do {
            const blocksData = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
            allBlocks.push(...(blocksData.results || []));
            const nextCursor = blocksData.has_more ? blocksData.next_cursor : null;
            // P4 共识(dsf+qwen): 游标为空/重复时终止, 防 has_more=true 却静默丢块或死循环
            cursor = (nextCursor && !seenCursors.has(nextCursor)) ? nextCursor : null;
            if (cursor) seenCursors.add(cursor);
        } while (cursor);

        // 准备新页面数据
        const parent = parentType === "database"
            ? { database_id: targetParentId }
            : { page_id: targetParentId };

        // 复制属性（排除系统生成/只读属性）
        // P4 收敛(c05): 只读属性不止 4 种——formula/rollup/unique_id 原样回写会被 Notion 400 拒统
        const READONLY_PROPERTY_TYPES = new Set([
            "created_time", "created_by", "last_edited_time", "last_edited_by",
            "formula", "rollup", "unique_id", "button",
        ]);
        const properties = {};
        for (const [key, value] of Object.entries(originalPage.properties || {})) {
            if (!READONLY_PROPERTY_TYPES.has(value?.type)) {
                properties[key] = value;
            }
        }

        // 修改标题添加"副本"标记
        if (properties["标题"]?.title) {
            const originalTitle = properties["标题"].title.map(t => t.plain_text).join("");
            properties["标题"] = {
                title: [{ text: { content: `${originalTitle} (副本)` } }]
            };
        }

        // 清理块数据（移除不可复制的属性）
        // P4 收敛(c05): child_page/child_database 块无法经 children 数组创建(Notion 400) —— 跳过
        const NON_CREATABLE_TYPES = new Set(["child_page", "child_database", "unsupported"]);
        const cleanBlock = (block) => {
            const cleaned = { type: block.type };
            if (block[block.type]) {
                cleaned[block.type] = { ...block[block.type] };
                // 移除子块ID引用，Notion会自动创建新ID
                delete cleaned[block.type].children;
            }
            return cleaned;
        };
        // P4 收敛(c05): 递归抓取子块 —— 原先只取顶层块: table 缺 table_row 被 Notion 400 拒绝
        // (整页复制失败), 嵌套列表内容静默丢失。Notion 单次 children 最多 2 层嵌套,
        // 更深层级仍由后续 append 补齐(超出本轮修复范围, 行为与旧版一致)。
        const fetchChildren = async (blockId, level) => {
            if (level > 2) return [];
            const children = [];
            let childCursor = null;
            const seen = new Set();
            do {
                const data = await NotionAPI.fetchBlocks(blockId, childCursor, apiKey);
                for (const child of data.results || []) {
                    if (NON_CREATABLE_TYPES.has(child.type)) continue;
                    const cleaned = cleanBlock(child);
                    if (child.has_children && level < 2) {
                        cleaned[child.type].children = await fetchChildren(child.id, level + 1);
                    }
                    children.push(cleaned);
                }
                const next = data.has_more ? data.next_cursor : null;
                childCursor = (next && !seen.has(next)) ? next : null;
                if (childCursor) seen.add(next);
            } while (childCursor);
            return children;
        };

        const cleanBlocks = [];
        for (const block of allBlocks) {
            if (NON_CREATABLE_TYPES.has(block.type)) continue;
            const cleaned = cleanBlock(block);
            if (block.has_children) {
                cleaned[block.type].children = await fetchChildren(block.id, 1);
            }
            cleanBlocks.push(cleaned);
        }

        // 创建新页面
        // P4 共识(glm): 此前 parent 变量计算后未使用, parentType="page" 仍按 database_id 创建
        // → Notion 400 Could not find database。数据库父级走原路径(字节级不变), 页面父级用 parent。
        let newPage;
        if (parentType === "database") {
            newPage = await NotionAPI.createDatabasePage(
                targetParentId,
                properties,
                cleanBlocks.slice(0, 100),
                apiKey
            );
        } else {
            const titleProp = Object.values(properties || {}).find((prop) => prop?.type === "title");
            const titleText = titleProp?.title?.map((t) => t?.plain_text ?? t?.text?.content ?? "").join("") || "无标题";
            newPage = await NotionAPI.request("POST", "/pages", {
                parent,
                properties: { title: { title: [{ text: { content: titleText } }] } },
                children: cleanBlocks.slice(0, 100),
            }, apiKey);
        }

        // 如果有更多块，追加
        if (cleanBlocks.length > 100) {
            await NotionAPI.appendBlocks(newPage.id, cleanBlocks.slice(100), apiKey);
        }

        return newPage;
    },

    // ========== 子页面操作 ==========

    // 验证页面 ID 是否有效
    validatePage: async (pageId, apiKey) => {
        try {
            await NotionAPI.request("GET", `/pages/${pageId}`, null, apiKey);
            return { valid: true };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    },

    // 创建子页面（导出为页面而不是数据库条目）
    createChildPage: async (parentPageId, title, children, apiKey) => {
        const data = {
            parent: { page_id: parentPageId },
            properties: {
                title: {
                    title: [{ text: { content: title || "无标题" } }]
                }
            },
            children: children.slice(0, 100), // Notion 限制
        };

        const page = await NotionAPI.request("POST", "/pages", data, apiKey);

        // 如果有剩余的 blocks，追加
        if (children.length > 100) {
            await NotionAPI.appendBlocks(page.id, children.slice(100), apiKey);
        }

        return page;
    },

    // 软删除页面 (归档)
    deletePage: async (pageId, apiKey) => {
        return await NotionAPI.request("PATCH", `/pages/${pageId}`, { archived: true }, apiKey);
    },

    // 恢复页面 (取消归档)
    restorePage: async (pageId, apiKey) => {
        return await NotionAPI.request("PATCH", `/pages/${pageId}`, { archived: false }, apiKey);
    },

    // 删除块
    deleteBlock: async (blockId, apiKey) => {
        return await NotionAPI.request("DELETE", `/blocks/${blockId}`, null, apiKey);
    },

    // ========== 用户管理 (ADMIN) ==========

    // 获取用户列表
    getUsers: async (cursor, apiKey) => {
        let endpoint = "/users";
        if (cursor) endpoint += `?start_cursor=${cursor}`;
        return await NotionAPI.request("GET", endpoint, null, apiKey);
    },

    // 获取当前用户信息
    getSelf: async (apiKey) => {
        return await NotionAPI.request("GET", "/users/me", null, apiKey);
    },

    // 获取特定用户信息
    getUser: async (userId, apiKey) => {
        return await NotionAPI.request("GET", `/users/${userId}`, null, apiKey);
    },

    // ========== 评论 (COMMENT) ==========

    // 获取单条评论
    getComment: async (commentId, apiKey) => {
        if (!commentId) throw new Error("commentId 不能为空");

        return await NotionAPI.request(
            "GET",
            `/comments/${commentId}`,
            null,
            apiKey,
            3,
            { notionVersion: CONFIG.API.COMMENT_NOTION_VERSION }
        );
    },

    // 获取页面或块的未解决评论
    listComments: async (blockId, cursor, pageSize, apiKey) => {
        if (!blockId) throw new Error("blockId 不能为空");

        const params = [`block_id=${encodeURIComponent(blockId)}`];
        if (cursor) params.push(`start_cursor=${encodeURIComponent(cursor)}`);
        if (pageSize) {
            const safePageSize = Math.max(1, Math.min(Number(pageSize) || 50, 100));
            params.push(`page_size=${safePageSize}`);
        }

        return await NotionAPI.request(
            "GET",
            `/comments?${params.join("&")}`,
            null,
            apiKey,
            3,
            { notionVersion: CONFIG.API.COMMENT_NOTION_VERSION }
        );
    },

    // 在页面、块或现有讨论中创建评论
    createComment: async ({ pageId, blockId, discussionId, content, markdown, attachments, displayName } = {}, apiKey) => {
        const targets = [pageId ? "page" : null, blockId ? "block" : null, discussionId ? "discussion" : null].filter(Boolean);
        if (targets.length !== 1) {
            throw new Error("必须且只能提供 pageId、blockId 或 discussionId 之一");
        }

        const body = {};
        if (discussionId) {
            body.discussion_id = discussionId;
        } else {
            body.parent = pageId ? { page_id: pageId } : { block_id: blockId };
        }

        const commentText = String(content || "").trim();
        const commentMarkdown = String(markdown || "").trim();
        if (!!commentText === !!commentMarkdown) {
            throw new Error("必须且只能提供 content 或 markdown 之一");
        }

        if (commentMarkdown) {
            body.markdown = commentMarkdown;
        } else {
            body.rich_text = [{ type: "text", text: { content: commentText } }];
        }

        if (Array.isArray(attachments) && attachments.length > 0) {
            body.attachments = attachments.slice(0, 3);
        }

        if (displayName && typeof displayName === "object") {
            body.display_name = displayName;
        }

        return await NotionAPI.request(
            "POST",
            "/comments",
            body,
            apiKey,
            3,
            { notionVersion: CONFIG.API.COMMENT_NOTION_VERSION }
        );
    },

    // ========== Markdown 内容 API ==========

    // 获取页面 Markdown 内容
    fetchPageMarkdown: async (pageId, apiKey) => {
        if (!pageId) throw new Error("pageId 不能为空");

        return await NotionAPI.request(
            "GET",
            `/pages/${pageId}/markdown`,
            null,
            apiKey,
            3,
            { notionVersion: CONFIG.API.MARKDOWN_NOTION_VERSION }
        );
    },

    // 直接调用页面 Markdown 更新接口
    updatePageMarkdown: async (pageId, payload, apiKey) => {
        if (!pageId) throw new Error("pageId 不能为空");
        if (!payload || typeof payload !== "object") throw new Error("payload 必须为对象");

        return await NotionAPI.request(
            "PATCH",
            `/pages/${pageId}/markdown`,
            payload,
            apiKey,
            3,
            { notionVersion: CONFIG.API.MARKDOWN_NOTION_VERSION }
        );
    },

    // 在页面尾部或指定锚点后插入 Markdown
    appendPageMarkdown: async (pageId, content, apiKey, after) => {
        const markdown = String(content || "").trim();
        if (!markdown) throw new Error("content 不能为空");

        const payload = {
            type: "insert_content",
            insert_content: {
                content: markdown
            }
        };
        if (after) {
            payload.insert_content.after = String(after);
        }

        return await NotionAPI.updatePageMarkdown(pageId, payload, apiKey);
    },

    // 基于 old_str -> new_str 的精确内容更新
    searchReplacePageMarkdown: async (pageId, contentUpdates, apiKey, allowDeletingContent = false) => {
        if (!Array.isArray(contentUpdates) || contentUpdates.length === 0) {
            throw new Error("contentUpdates 不能为空");
        }

        const normalizedUpdates = contentUpdates.map((item) => {
            const oldStr = String(item.old_str || "").trim();
            const newStr = String(item.new_str || "");
            if (!oldStr) throw new Error("每条 content update 都必须提供 old_str");
            return {
                old_str: oldStr,
                new_str: newStr,
                replace_all_matches: !!item.replace_all_matches,
            };
        });

        return await NotionAPI.updatePageMarkdown(pageId, {
            type: "update_content",
            update_content: {
                content_updates: normalizedUpdates,
                allow_deleting_content: !!allowDeletingContent,
            },
        }, apiKey);
    },

    // 用新的 Markdown 完整替换页面内容
    replacePageMarkdown: async (pageId, newContent, apiKey, allowDeletingContent = false) => {
        const markdown = String(newContent || "");
        if (!markdown.trim()) throw new Error("newContent 不能为空");

        return await NotionAPI.updatePageMarkdown(pageId, {
            type: "replace_content",
            replace_content: {
                new_str: markdown,
                allow_deleting_content: !!allowDeletingContent,
            },
        }, apiKey);
    },
};

// 注入上传方法（T4: notion-upload.js 提取）
installUploadMethods(NotionAPI);

module.exports = { SiteDetector, InstallHelper, EMOJI_MAP, NOTION_LANGUAGES, normalizeLanguage, DOMToNotion, NotionTransport, NotionAPI, ObsidianAPI, HTMLToMarkdown };
