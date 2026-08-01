"use strict";

// 依赖引入
const { CONFIG, MSG, SUPPORTED_FILE_TYPES } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionOAuth } = require("../auth");
const { UrlValidator } = require("../security/UrlValidator");

const { SiteDetector, InstallHelper, EMOJI_MAP, NOTION_LANGUAGES, normalizeLanguage } = require("./constants");
const { DOMToNotion } = require("./DOMToNotion");
const { ObsidianAPI, HTMLToMarkdown } = require("./obsidian");
const { installUploadMethods } = require("./notion-upload");


const NotionTransport = Object.freeze({
    buildUrl: (endpoint) => `https://api.notion.com/v1${endpoint}`,

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

    request: async (method, endpoint, data, apiKey, retries = 3, options = {}) => {
        const notionVersion = options.notionVersion || CONFIG.API.NOTION_VERSION;

        const doRequest = async (attempt, token = NotionOAuth.getAccessToken(apiKey), allowRefresh = true) => {
            const response = await NotionAPI.getTransport().request({
                method,
                endpoint,
                data,
                token,
                notionVersion,
            });

            // 处理速率限制
            if (response.status === 429 && attempt < retries) {
                const retryAfter = parseInt(response.responseHeaders?.match(/retry-after:\s*(\d+)/i)?.[1]) || 1;
                console.warn(`Notion API 速率限制，${retryAfter}秒后重试 (${attempt + 1}/${retries})`);
                await Utils.sleep(retryAfter * 1000 + 500);
                return doRequest(attempt + 1, token, allowRefresh);
            }

            const result = Utils.safeJsonParse(response.responseText, {});
            if (response.status >= 200 && response.status < 300) {
                return result;
            }
            if (response.status === 401 && allowRefresh && NotionOAuth.canAutoRefresh()) {
                try {
                    const refreshedToken = await NotionOAuth.refreshAccessToken();
                    return doRequest(attempt, refreshedToken, false);
                } catch (refreshError) {
                    throw new Error(`Notion OAuth 续签失败: ${refreshError.message}`);
                }
            }
            throw new Error(`Notion API 错误: ${result.message || response.status}`);
        };

        try {
            return await doRequest(0);
        } catch (error) {
            if (error instanceof Error) {
                throw error;
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
        const payload = { children: safeChildren };

        if (options.after) {
            payload.after = String(options.after);
        }

        return await NotionAPI.request("PATCH", endpoint, payload, apiKey);
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
        do {
            const blocksData = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
            allBlocks.push(...(blocksData.results || []));
            cursor = blocksData.has_more ? blocksData.next_cursor : null;
        } while (cursor);

        // 准备新页面数据
        const parent = parentType === "database"
            ? { database_id: targetParentId }
            : { page_id: targetParentId };

        // 复制属性（排除系统生成的属性）
        const properties = {};
        for (const [key, value] of Object.entries(originalPage.properties || {})) {
            if (!["created_time", "created_by", "last_edited_time", "last_edited_by"].includes(value.type)) {
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
        const cleanBlocks = allBlocks.map(block => {
            const cleaned = { type: block.type };
            if (block[block.type]) {
                cleaned[block.type] = { ...block[block.type] };
                // 移除子块ID引用，Notion会自动创建新ID
                delete cleaned[block.type].children;
            }
            return cleaned;
        });

        // 创建新页面
        const newPage = await NotionAPI.createDatabasePage(
            targetParentId,
            properties,
            cleanBlocks.slice(0, 100),
            apiKey
        );

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
