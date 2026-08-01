"use strict";

// tools/read-tools.js — 只读查询类工具（Level 0）（TASK-006, P6_agenttools_split）。
// 从 AgentTools.js 程序化提取，逻辑零修改。

const { CONFIG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage } = require("../../storage");
const { TargetState } = require("../../auth");
const { NotionAPI } = require("../../api");
const { OperationGuard } = require("../../security");
const { getAI: AI, getService: svc } = require("../deps");

module.exports = {
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
            return AI()._formatToolResult({
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
                const resolved = await AI()._resolveDatabaseId(reference, null, settings.notionApiKey);
                if (resolved?.error) return `错误: ${resolved.error}`;
                if (!resolved) return `错误: 找不到数据库「${reference}」。`;
                const database = await NotionAPI.fetchDatabase(resolved.id, settings.notionApiKey);
                const title = database.title?.map(t => t.plain_text).join("") || resolved.name || "未命名数据库";
                const propertyNames = Object.keys(database.properties || {});
                return AI()._formatToolResult({
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

            const resolved = await AI()._resolvePageId(reference, null, settings.notionApiKey);
            if (resolved?.error) return `错误: ${resolved.error}`;
            if (!resolved) return `错误: 找不到页面「${reference}」。`;
            const page = await NotionAPI.fetchPage(resolved.id, settings.notionApiKey);
            const title = Utils.getPageTitle(page, resolved.name || "未命名页面");
            const parentType = page.parent?.type || "-";
            const iconText = page.icon?.emoji || page.icon?.external?.url || "-";
            const coverText = page.cover?.external?.url || "-";
            return AI()._formatToolResult({
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
                const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (page?.error) return `错误: ${page.error}`;
                if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;
                rootId = page.id;
                targetName = page.name;
            } else {
                try {
                    const block = await NotionAPI.fetchBlock(rootId, settings.notionApiKey);
                    targetName = block.type || rootId;
                } catch (error) {
                    console.warn("[LD-Notion] 获取块类型失败:", error);
                    targetName = rootId;
                }
            }

            const depth = Math.max(1, Math.min(Number(max_depth) || 2, 5));
            const maxNodes = Math.max(1, Math.min(Number(limit) || 50, 200));
            const blocks = await AI()._collectBlockTree(rootId, settings.notionApiKey, maxNodes, depth);

            if (blocks.length === 0) {
                return `页面或块「${targetName}」没有可读取的子块。`;
            }

            return AI()._formatToolResult({
                title: "块结构",
                fields: [
                    { label: "目标", value: targetName },
                    { label: "块数", value: blocks.length },
                ],
                bullets: blocks.map(block => AI()._formatBlockSummary(block, block._depth || 0).replace(/^- /, ""))
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
            return AI()._formatToolResult({
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
                    } catch (error) {
                        console.warn("[LD-Notion] 按收藏时间排序查询失败，回退到创建时间排序:", error);
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
                try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch (error) {
                    console.warn("[LD-Notion] 工作区页面缓存解析失败:", error);
                    cached = {};
                }
                const databases = cached.databases || [];
                if (databases.length === 0) return "错误: 请先在 AI 设置中点击「🔄」刷新数据库列表。";

                // 校验缓存的 API Key 是否匹配当前配置（非可逆哈希，不泄露密钥）
                const currentKeyHash = settings.notionApiKey ? Utils.apiKeyHash(settings.notionApiKey) : "";
                if (cached.apiKeyHash && cached.apiKeyHash !== currentKeyHash) {
                    return "错误: 数据库列表缓存与当前 API Key 不匹配，请重新点击「🔄」刷新。";
                }

                for (const db of databases) {
                    try {
                        const pages = await queryOneDb(db.id);
                        pages.forEach(p => { p._sourceDb = db.title; });
                        allPages.push(...pages);
                    } catch (error) {
                        console.warn("[LD-Notion] 数据库查询失败，跳过无权限数据库:", error);
                    } // 跳过无权限的数据库
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

            return AI()._formatToolResult({
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

            const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            const content = await AI()._extractPageContent(page.id, settings.notionApiKey, 4000);
            return content.trim()
                ? AI()._formatToolResult({
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

            const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            try {
                const response = await NotionAPI.fetchPageMarkdown(page.id, settings.notionApiKey);
                const markdown = String(response.markdown || "").trim();
                return markdown
                    ? AI()._formatToolResult({
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
                const fallback = await AI()._extractPageContent(page.id, settings.notionApiKey, 6000);
                if (!fallback.trim()) {
                    return `页面「${page.name}」没有可读取的内容。`;
                }
                return AI()._formatToolResult({
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
                const resolved = await AI()._resolveDatabaseId(dbName, null, settings.notionApiKey);
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
            return AI()._formatToolResult({
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
                const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
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

            const shown = comments.slice(0, safeLimit).map(AI()._formatCommentSummary);
            return AI()._formatToolResult({
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
            let users = await AI()._collectWorkspaceUsers(settings.notionApiKey, safeLimit);

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

            return AI()._formatToolResult({
                title: "工作区用户列表",
                fields: [
                    { label: "人数", value: users.length },
                    { label: "筛选", value: keyword || "-" },
                ],
                bullets: users.map(AI()._formatUserSummary)
            });
        }
    },

    get_current_user: {
        description: "获取当前 Notion 集成对应的 bot / 当前用户信息",
        params: "无需参数",
        level: 0,
        execute: async (args, settings) => {
            const user = await NotionAPI.getSelf(settings.notionApiKey);
            return AI()._formatToolResult({
                title: "当前身份",
                fields: [
                    { label: "用户", value: AI()._formatUserSummary(user) }
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

            const user = await AI()._resolveUserIdentity(user_id, query, settings.notionApiKey);
            if (!user) {
                return `没有找到用户「${query || user_id}」。`;
            }

            const details = [
                { label: "用户", value: AI()._formatUserSummary(user) },
                { label: "bot 所有者类型", value: user.bot?.owner?.type || "-" },
                { label: "workspace", value: user.bot?.owner?.workspace_name || "-" },
            ];

            return AI()._formatToolResult({
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
                } catch (error) {
                    console.warn("[LD-Notion] 数据库查询失败:", error);
                    return [];
                }
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

            return AI()._formatToolResult({
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
                } catch (error) {
                    console.warn("[LD-Notion] 数据库查询失败:", error);
                    return [];
                }
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

            return AI()._formatToolResult({
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
                } catch (error) {
                    console.warn("[LD-Notion] 参考页面获取失败:", error);
                    /* page may not exist or be inaccessible */
                }
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
                } catch (error) {
                    console.warn("[LD-Notion] 数据库查询失败:", error);
                    /* database may not be queryable */
                }
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
                const aiResult = await svc().request(prompt, settings);
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
                return AI()._formatToolResult({
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
};
