"use strict";

// handlers/query.js — 查询与搜索类 handler（TASK-005, P5_handler_split）。
// 从 Handlers.js 程序化提取，逻辑零修改。

const { CONFIG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage } = require("../../storage");
const { TargetState } = require("../../auth");
const { NotionAPI } = require("../../api");
const { OperationGuard, ConfirmationDialog, UndoManager } = require("../../security");
const { AISchema } = require("../schema");
const { BlockConverter } = require("../BlockConverter");
const { NameResolver } = require("../NameResolver");
const { AgentTrace } = require("../AgentTrace");
const { getAI: AI, getState: state, getService: svc } = require("../deps");

module.exports = {
handleQuery: async (params, settings, explanation) => {
    // 检查数据库 ID 配置
    if (!settings.notionDatabaseId) {
        return "❌ 请先配置 Notion 数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」来查看工作区中的数据库并获取 ID。";
    }

    state().updateLastMessage(`正在查询数据库...`, "processing");

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
                state().updateLastMessage(`正在查询数据库... (已获取 ${allPages.length} 条)`, "processing");
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

    state().updateLastMessage(`正在搜索...`, "processing");

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
    state().updateLastMessage(`正在搜索整个工作区...`, "processing");

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
};
