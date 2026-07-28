"use strict";

// Handlers — AI 意图执行处理器（26 handle* + helper）。
// ISS-20260723-010 W6-2 (ARCH-001/004): 从 ai/index.js 提取 AIHandlers(942-3189) 到独立模块。
// 块内 79 处 AIAssistant./74 处 ChatState./17 处 AIService. 原是同文件自由变量引用，
// esbuild 闭包间不共享自由变量 (coding-conventions-004)，拆分后改 lazy accessor
// (coding-conventions-005)：require("./index") 在 handler 执行时发生，此时 ai/index.js 已加载完，
// AIAssistant 已 Object.assign mixin 完毕，ChatState/AIService 已赋值。顶部 require 在循环时拿不到
// 还未赋值的 const，必须 lazy。
//
// ARCH-001 mixin 语义：ai/index.js 仍保留 Object.assign(AIAssistant, AIHandlers) —— 本模块
// 只迁定义位置，不拆 mixin 机制（拆了要改 38 调用点 + 模块级初始化顺序，风险高无收益）。
// AIHandlers 仍经 mixin 进 AIAssistant，38 处 AIAssistant.<handler> 调用点零改动。

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { TargetState } = require("../auth");
const { NotionAPI } = require("../api");
const { OperationGuard } = require("../security");
const { ConfirmationDialog } = require("../security");
const { AISchema } = require("./schema");
const { BlockConverter } = require("./BlockConverter");
const { NameResolver } = require("./NameResolver");

// lazy accessor：首次调用时 require，缓存后续查找。handler 执行非热路径，lazy 开销可接受。
let _AI = null;
const AI = () => (_AI || (_AI = require("./index").AIAssistant));
let _state = null;
const state = () => (_state || (_state = require("./index").ChatState));
let _svc = null;
const svc = () => (_svc || (_svc = require("./index").AIService));


const AIHandlers = {
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

    state().updateLastMessage(`正在准备批量分类...\n分类选项: ${settings.categories.join(", ")}`, "processing");

    try {
        // 确保数据库有 AI分类 属性
        await AIClassifier.ensureAICategoryProperty(settings);

        // 获取所有页面
        state().updateLastMessage(`正在获取数据库页面...`, "processing");
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

            state().updateLastMessage(
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
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("updatePage")) {
        return "❌ 权限不足：更新页面需要「标准」权限级别。";
    }

    state().updateLastMessage("正在定位目标页面...", "processing");

    try {
        const targets = await AI()._resolvePageTargets({
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

        const { success, failed } = await AI()._applyPageUpdatesToTargets(targets, params, settings);

        if (!batchMode && success === 1 && failed === 0) {
            return `✅ 已更新页面「${targets[0].name}」。`;
        }

        return `✅ 批量更新完成：成功 ${success} 个，失败 ${failed} 个。`;
    } catch (error) {
        return `❌ 更新页面失败: ${error.message}`;
    }
},
_resolveDatabaseId: async (name, id, apiKey) => {
    // W4 (MAINT-009): 实现已迁移至 src/ai/NameResolver.js，此处为向后兼容转发壳。
    return NameResolver.resolveDatabaseId(name, id, apiKey);
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
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    // 权限检查
    if (!OperationGuard.canExecute("movePage")) {
        return "❌ 权限不足：移动页面需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
    }

    const { source_database_name, source_database_id, target_database_name, target_database_id, page_title } = params;

    state().updateLastMessage("正在解析数据库信息...", "processing");

    try {
        // 解析源数据库（未指定时使用已配置的数据库）
        let source = await AI()._resolveDatabaseId(source_database_name, source_database_id, settings.notionApiKey);
        if (source?.error) return `❌ 源数据库解析失败：${source.error}`;
        if (!source && settings.notionDatabaseId) {
            source = { id: settings.notionDatabaseId.replace(/-/g, ""), name: "已配置的数据库" };
        }
        if (!source) {
            return "❌ 无法确定源数据库。请指定源数据库名称，或先在设置中配置数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。";
        }

        // 解析目标数据库
        const target = await AI()._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
        if (target?.error) return `❌ 目标数据库解析失败：${target.error}`;
        if (!target) {
            return `❌ 找不到目标数据库「${target_database_name || target_database_id}」。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。`;
        }

        // 源=目标拦截
        if (source.id === target.id) {
            return "❌ 源数据库和目标数据库相同，无需移动。";
        }

        // 获取源页面
        state().updateLastMessage(`正在从「${source.name}」获取页面...`, "processing");
        const pages = await AI()._fetchSourcePages(source.id, settings.notionApiKey, page_title);

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

            state().updateLastMessage(
                `📦 正在移动 (${i + 1}/${pages.length})\n\n当前: ${title}\n→ 目标: ${target.name}`,
                "processing"
            );

            try {
                await AI()._executeGuardedPageWrite("movePage",
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
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    // 权限检查
    if (!OperationGuard.canExecute("duplicatePage")) {
        return "❌ 权限不足：复制页面需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
    }

    const { source_database_name, source_database_id, target_database_name, target_database_id, page_title } = params;

    state().updateLastMessage("正在解析数据库信息...", "processing");

    try {
        // 解析源数据库（未指定时使用已配置的数据库）
        let source = await AI()._resolveDatabaseId(source_database_name, source_database_id, settings.notionApiKey);
        if (source?.error) return `❌ 源数据库解析失败：${source.error}`;
        if (!source && settings.notionDatabaseId) {
            source = { id: settings.notionDatabaseId.replace(/-/g, ""), name: "已配置的数据库" };
        }
        if (!source) {
            return "❌ 无法确定源数据库。请指定源数据库名称，或先在设置中配置数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。";
        }

        // 解析目标数据库
        const target = await AI()._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
        if (target?.error) return `❌ 目标数据库解析失败：${target.error}`;
        if (!target) {
            return `❌ 找不到目标数据库「${target_database_name || target_database_id}」。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。`;
        }

        // 源=目标拦截
        if (source.id === target.id) {
            return "❌ 源数据库和目标数据库相同，无需复制。";
        }

        // 获取源页面
        state().updateLastMessage(`正在从「${source.name}」获取页面...`, "processing");
        const pages = await AI()._fetchSourcePages(source.id, settings.notionApiKey, page_title);

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

            state().updateLastMessage(
                `📋 正在复制 (${i + 1}/${pages.length})\n\n当前: ${title}\n→ 目标: ${target.name}`,
                "processing"
            );

            try {
                await AI()._executeGuardedPageWrite("duplicatePage",
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
    state().updateLastMessage(planMsg, "processing");

    const results = [];
    let aborted = false;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];

        state().updateLastMessage(
            `${planMsg}\n⏳ 步骤 ${i + 1}/${steps.length}: ${step.explanation}`,
            "processing"
        );

        try {
            const stepResult = await AI().executeIntent(step, settings);
            const normalizedStepResult = AI()._normalizeExecutionResult(stepResult);

            if (AI()._isErrorResult(normalizedStepResult)) {
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
                result: AI()._normalizeExecutionResult(`❌ ${error.message}`, { status: "error", name: step.intent })
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
        report += `\n**步骤 ${r.index}**: ${r.explanation}\n${AI()._resultToText(r.result)}\n`;
    }

    return report;
},
handleCreateDatabase: async (params, settings, explanation) => {
    // 检查基础配置（需要 API Key，不需要数据库 ID）
    const configCheck = AI().checkConfig(settings, false);
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

    state().updateLastMessage("正在解析父页面信息...", "processing");

    try {
        let parentPage = null;

        // 使用共享的页面解析器
        if (parent_page_id || parent_page_name) {
            parentPage = await AI()._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
            if (parentPage?.error) return `❌ 父页面解析失败：${parentPage.error}`;
            if (!parentPage) {
                return `❌ 找不到名为「${parent_page_name}」的页面。\n\n💡 提示：可以使用「在工作区搜索所有页面」查看可用页面。`;
            }
        }
        // 未指定父页面，搜索工作区页面供选择
        else {
            state().updateLastMessage("未指定父页面，正在搜索工作区页面...", "processing");
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
        state().updateLastMessage(`正在创建数据库「${database_name}」...`, "processing");

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
        const result = await AI()._executeGuardedWrite("createDatabase",
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
    // W4 (MAINT-009): 实现已迁移至 src/ai/NameResolver.js，此处为向后兼容转发壳。
    return NameResolver.resolvePageId(name, id, apiKey);
},
_textToBlocks: (text) => {
    // W4 (MAINT-006): 实现已迁移至 src/ai/BlockConverter.js，此处为向后兼容转发壳。
    // tests/ai-text-to-blocks.test.js 的 27 用例守护此契约（W2 基线）。
    return BlockConverter.textToBlocks(text);
},
_extractPageContent: async (pageId, apiKey, maxChars = 4000) => {
    try {
        const markdownResponse = await NotionAPI.fetchPageMarkdown(pageId, apiKey);
        const markdown = String(markdownResponse.markdown || "").trim();
        if (markdown) {
            return markdown.slice(0, maxChars);
        }
    } catch (error) {
        console.warn("[LD-Notion] Markdown API 不可用，回退到 blocks 提取:", error);
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
    const configCheck = AI().checkConfig(settings, false);
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

    state().updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。\n\n💡 提示：可以使用「在工作区搜索所有页面」查看可用页面。`;

        state().updateLastMessage("正在生成内容...", "processing");

        const prompt = `你是一个内容生成助手。根据用户要求生成内容，使用 Markdown 格式。\n\n用户要求：${content_prompt}`;
        const aiResponse = await svc().requestChat(prompt, settings, 2000);

        state().updateLastMessage("正在写入页面...", "processing");

        try {
                await AI()._executeGuardedPageWrite("appendBlocks", targetPage,
                    async () => {
                        try {
                            await NotionAPI.appendPageMarkdown(targetPage.id, aiResponse, settings.notionApiKey);
                        } catch (error) {
                            console.warn("[LD-Notion] Markdown 追加失败，回退到块追加:", error);
                            const blocks = AI()._textToBlocks(aiResponse);
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
    const configCheck = AI().checkConfig(settings, false);
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

    state().updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        state().updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AI()._extractPageContent(targetPage.id, settings.notionApiKey);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可编辑的内容。`;
        }

        state().updateLastMessage("正在规划精确编辑...", "processing");

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

        const editPlanRaw = await svc().requestChat(editPlanPrompt, settings, 2200);
        // ISS-013: 统一走 parseAIJson 接缝（arch-013），消除手工 jsonMatch+JSON.parse 三段式。
        // 解析失败 editPlan 保持 null → 消费点 hasValidContentUpdates 走空值保护降级全文追加。
        const editPlanResult = AISchema.parseAIJson("editPlan", editPlanRaw);
        let editPlan = null;
        if (editPlanResult.ok) {
            editPlan = editPlanResult.value;
        } else {
            console.warn("[LD-Notion] 编辑计划 JSON 解析失败:", editPlanResult.reason);
        }

        let exactUpdateError = null;
        let inPlaceSkippedReason = null;
        // content_updates 结构校验（ISS-20260723-009 L2）：mode=update_content 但 content_updates
        // 非数组/空/项缺 find/replace 时，记录降级原因让用户知晓，而非静默跳到 fallback。
        const hasValidContentUpdates = editPlan?.mode === "update_content"
            && Array.isArray(editPlan.content_updates)
            && editPlan.content_updates.length > 0
            && editPlan.content_updates.every((u) => u && typeof u.old_str === "string" && typeof u.new_str === "string");
        if (editPlan?.mode === "update_content" && !hasValidContentUpdates) {
            inPlaceSkippedReason = "原位编辑结构校验失败（content_updates 缺失或无效）";
            console.warn("[LD-Notion] editPlan content_updates 结构无效，降级为全文追加:", inPlaceSkippedReason);
        }
        if (hasValidContentUpdates) {
            state().updateLastMessage("正在执行原位精确编辑...", "processing");

            try {
                await AI()._executeGuardedPageWrite("updatePageMarkdown", targetPage,
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

        state().updateLastMessage("正在生成编辑版本...", "processing");

        const fallbackMarkdown = String(editPlan?.append_markdown || "").trim();
        let aiResponse = fallbackMarkdown;
        if (!aiResponse) {
            const prompt = `你是一个内容编辑助手。根据编辑指令改写以下内容，使用 Markdown 格式输出改写后的完整内容。\n\n原文：\n${existingContent}\n\n编辑指令：${content_prompt}`;
            aiResponse = await svc().requestChat(prompt, settings, 2000);
        }

        state().updateLastMessage("正在写入编辑版本...", "processing");

        const versionMarkdown = `---\n\n## ✏️ AI 编辑版本\n\n${aiResponse}`;
        await AI()._executeGuardedPageWrite("appendBlocks", targetPage,
            async () => {
                try {
                    await NotionAPI.appendPageMarkdown(targetPage.id, versionMarkdown, settings.notionApiKey);
                } catch (error) {
                    console.warn("[LD-Notion] Markdown 追加失败，回退到块追加:", error);
                    const contentBlocks = AI()._textToBlocks(aiResponse);
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
            : inPlaceSkippedReason
                ? `\n\n💡 ${inPlaceSkippedReason}；已将完整编辑版本追加到页面末尾（原内容保留）。`
                : "\n\n💡 本次未执行原位替换，已将完整编辑版本追加到页面末尾（原内容保留）。";

        return `✅ **编辑版本已追加到页面**\n\n- 目标页面: ${targetPage.name}\n- 编辑指令: ${content_prompt}${fallbackReason}`;
    } catch (error) {
        return `❌ 内容编辑失败: ${error.message}`;
    }
},
handleTranslateContent: async (params, settings, explanation) => {
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：内容翻译需要「标准」权限级别。";
    }

    const { page_name, page_id, target_language } = params;
    const lang = target_language || "英文";

    if (!page_name && !page_id) {
        return "❌ 请指定要翻译的页面。\n\n💡 示例：「把 xxx 页面翻译成英文」";
    }

    state().updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        state().updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AI()._extractPageContent(targetPage.id, settings.notionApiKey);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可翻译的内容。`;
        }

        state().updateLastMessage(`正在翻译为${lang}...`, "processing");

        const prompt = `你是一个专业翻译。将以下内容翻译为${lang}，使用 Markdown 格式，保持原文结构。\n\n原文：\n${existingContent}`;
        const aiResponse = await svc().requestChat(prompt, settings, 2000);

        state().updateLastMessage("正在写入翻译版本...", "processing");

        const contentBlocks = AI()._textToBlocks(aiResponse);
        const blocks = [
            { type: "divider", divider: {} },
            { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `🌐 AI 翻译（${lang}）` } }] } },
            ...contentBlocks
        ];
        await AI()._executeGuardedPageWrite("appendBlocks", targetPage,
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

    await AI()._executeGuardedDatabaseWrite("updateDatabase", databaseId,
        () => NotionAPI.updateDatabase(databaseId, propDef, apiKey),
        apiKey
    );
},
handleAIAutofill: async (params, settings, explanation) => {
    if (!OperationGuard.canExecute("updatePage")) {
        return "❌ 权限不足：AI 属性填充需要「标准」及以上权限。\n\n请在设置中提升权限级别。";
    }

    const configCheck = AI().checkConfig(settings, true);
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

    state().updateLastMessage(`正在准备 AI 属性填充（${propName}）...`, "processing");

    try {
        await AI()._ensureAIProperty(settings.notionDatabaseId, propName, propType, settings.notionApiKey);

        state().updateLastMessage("正在获取数据库页面...", "processing");

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

            state().updateLastMessage(
                `🔄 正在填充「${propName}」(${i + 1}/${needFill.length})\n\n当前: ${title}`,
                "processing"
            );

            try {
                // 获取内容：翻译类型只需标题，其他需提取页面内容
                let inputText = title;
                if (autofill_type !== "translation") {
                    try {
                        const content = await AI()._extractPageContent(page.id, settings.notionApiKey, 2000);
                        inputText = content || title;
                    } catch (error) {
                        console.warn("[LD-Notion] 页面内容提取失败:", error);
                        inputText = title;
                    }
                }

                const aiResult = await svc().requestChat(
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

                await AI()._executeGuardedPageWrite("updatePage",
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
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { question, keyword } = params;
    const searchTerm = question || keyword;

    if (!searchTerm) {
        return "❌ 请描述你的问题。\n\n💡 示例：「关于 Docker 的帖子都说了什么？」";
    }

    state().updateLastMessage("正在搜索相关内容...", "processing");

    try {
        const response = await NotionAPI.search(searchTerm, null, settings.notionApiKey);
        const results = (response.results || []).filter(r => !r.archived && r.object === "page").slice(0, 5);

        if (results.length === 0) {
            return `📭 在工作区中没有找到与「${searchTerm}」相关的内容。`;
        }

        state().updateLastMessage(`找到 ${results.length} 个相关内容，正在提取...`, "processing");

        // 提取每个页面的内容
        const contextParts = [];
        const sourceList = [];
        for (let i = 0; i < results.length; i++) {
            const item = results[i];
            const title = Utils.getPageTitle(item, item.object === "database" ? "未命名数据库" : "未命名页面");
            const url = item.url || "";
            sourceList.push({ title, url });

            try {
                const content = await AI()._extractPageContent(item.id, settings.notionApiKey, 2000);
                contextParts.push(`[${i + 1}] ${title}:\n${content || "（无文本内容）"}`);
            } catch (error) {
                console.warn(`[LD-Notion] 页面内容提取失败: ${title}`, error);
                contextParts.push(`[${i + 1}] ${title}:\n（无法读取内容）`);
            }
        }

        state().updateLastMessage("正在分析并生成回答...", "processing");

        const ragPrompt = `你是一个知识问答助手。根据以下来自 Notion 工作区的内容回答用户的问题。
如果内容中没有相关信息，请如实说明。回答后列出信息来源。

--- 参考内容 ---
${contextParts.join("\n\n")}

--- 用户问题 ---
${searchTerm}`;

        const aiAnswer = await svc().requestChat(ragPrompt, settings, 2000);

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
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { research_topic, scope = "workspace" } = params;
    if (!research_topic) {
        return "❌ 请描述你的研究主题。\n\n💡 示例：「深入研究一下关于 Docker 的所有内容」";
    }

    try {
        // Phase 1: 拆分主题为多个搜索关键词
        state().updateLastMessage("🔬 正在拆解研究主题...", "processing");

        const keywordsPrompt = `将以下研究主题拆分为3-5个搜索关键词，每行一个关键词，只返回关键词：\n${research_topic}`;
        const keywordsRaw = await svc().requestChat(keywordsPrompt, settings, 200);
        const keywords = keywordsRaw.split("\n")
            .map(k => k.trim().replace(/^[-•\d.]+\s*/, ""))
            .filter(Boolean)
            .slice(0, 5);

        if (keywords.length === 0) keywords.push(research_topic);

        // Phase 2: 多关键词搜索
        state().updateLastMessage(`🔍 搜索中... (${keywords.length} 个关键词: ${keywords.join(", ")})`, "processing");

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
        state().updateLastMessage(`📄 提取 ${maxPages}/${uniquePages.length} 个页面内容...`, "processing");

        const contentParts = [];
        const sourceList = [];
        for (let i = 0; i < maxPages; i++) {
            const page = uniquePages[i];
            const title = Utils.getPageTitle(page);
            const url = page.url || "";
            sourceList.push({ title, url });

            try {
                const content = await AI()._extractPageContent(page.id, settings.notionApiKey, 3000);
                contentParts.push(`[${i + 1}] ${title}:\n${content || "（无文本内容）"}`);
            } catch (error) {
                console.warn(`[LD-Notion] 页面内容提取失败: ${title}`, error);
                contentParts.push(`[${i + 1}] ${title}:\n（无法读取内容）`);
            }
            if (i < maxPages - 1) await Utils.sleep(delay);
        }

        // Phase 4: AI 生成结构化报告
        state().updateLastMessage("📊 正在生成研究报告...", "processing");

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

        const report = await svc().requestChat(reportPrompt, settings, 4000);

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
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { page_name, page_id, summary_style } = params;
    const style = summary_style || "brief";

    if (!page_name && !page_id) {
        return "❌ 请指定要总结的页面。\n\n💡 示例：「总结一下 xxx 页面的内容」";
    }

    state().updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        state().updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AI()._extractPageContent(targetPage.id, settings.notionApiKey, 6000);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可总结的内容。`;
        }

        state().updateLastMessage("📝 正在生成摘要...", "processing");

        const styleInstructions = {
            brief: "生成简短摘要（2-3句话），提炼核心要点。",
            detailed: "生成详细摘要，包含：核心主题、主要论点、关键细节和结论。",
            bullet: "以要点列表形式总结，每个要点一行，提炼关键信息。"
        };

        const prompt = `你是一个内容摘要助手。${styleInstructions[style] || styleInstructions.brief}\n\n使用 Markdown 格式输出。\n\n以下是需要总结的内容：\n${existingContent}`;
        const aiResponse = await svc().requestChat(prompt, settings, 2000);

        return `📝 **页面摘要：${targetPage.name}**\n\n${aiResponse}\n\n---\n📄 摘要风格: ${style === "brief" ? "简短" : style === "detailed" ? "详细" : "要点列表"}`;
    } catch (error) {
        return `❌ 内容总结失败: ${error.message}`;
    }
},
handleBrainstorm: async (params, settings, explanation) => {
    const configCheck = AI().checkConfig(settings, false);
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
        state().updateLastMessage("正在读取页面内容作为参考...", "processing");
        const targetPage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage) {
            pageContext = await AI()._extractPageContent(targetPage.id, settings.notionApiKey, 3000);
        }
    }

    state().updateLastMessage("💡 正在头脑风暴...", "processing");

    try {
        const contextBlock = pageContext ? `\n\n以下是相关参考内容：\n${pageContext}` : "";
        const prompt = `你是一个创意顾问。围绕主题「${topic}」进行头脑风暴，生成 ${count} 个创意想法或建议。

要求：
- 想法要多样化，涵盖不同角度和维度
- 每个想法包含简短标题和一句话说明
- 从实用到大胆创新，由近及远排列
- 使用 Markdown 编号列表格式输出${contextBlock}`;

        const aiResponse = await svc().requestChat(prompt, settings, 2000);

        return `💡 **头脑风暴：${topic}**\n\n${aiResponse}\n\n---\n🎯 共生成 ${count} 个创意想法`;
    } catch (error) {
        return `❌ 头脑风暴失败: ${error.message}`;
    }
},
handleProofread: async (params, settings, explanation) => {
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { page_name, page_id } = params;

    if (!page_name && !page_id) {
        return "❌ 请指定要校对的页面。\n\n💡 示例：「校对一下 xxx 页面的拼写和语法」";
    }

    state().updateLastMessage("正在解析目标页面...", "processing");

    try {
        const targetPage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

        state().updateLastMessage("正在读取页面内容...", "processing");

        const existingContent = await AI()._extractPageContent(targetPage.id, settings.notionApiKey);
        if (!existingContent.trim()) {
            return `❌ 页面「${targetPage.name}」没有可校对的内容。`;
        }

        state().updateLastMessage("✅ 正在校对中...", "processing");

        const prompt = `你是一个专业校对编辑。请仔细检查以下内容的拼写、语法和表达问题。

输出格式：
1. 先列出发现的所有问题（每个问题标注位置和类型：拼写/语法/标点/表达）
2. 然后给出修正后的完整内容

如果没有发现任何问题，请说明内容无误。

使用 Markdown 格式输出。

以下是需要校对的内容：
${existingContent}`;

        const aiResponse = await svc().requestChat(prompt, settings, 3000);

        return `✅ **校对结果：${targetPage.name}**\n\n${aiResponse}`;
    } catch (error) {
        return `❌ 校对失败: ${error.message}`;
    }
},
handleBatchTranslate: async (params, settings, explanation) => {
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：批量翻译需要「标准」权限级别。";
    }

    const { database_name, database_id, target_language } = params;
    const lang = target_language || "英文";

    if (!database_name && !database_id) {
        return "❌ 请指定要翻译的数据库。\n\n💡 示例：「把 xxx 数据库翻译成日文」";
    }

    state().updateLastMessage("正在查找数据库...", "processing");

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
        state().updateLastMessage("正在获取页面列表...", "processing");
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
            state().updateLastMessage(`🌐 翻译中 (${i + 1}/${pages.length}): ${title}...`, "processing");

            try {
                const content = await AI()._extractPageContent(page.id, settings.notionApiKey, 4000);
                if (!content.trim()) { failCount++; continue; }

                const prompt = `你是一个专业翻译。将以下内容翻译为${lang}，使用 Markdown 格式，保持原文结构。\n\n原文：\n${content}`;
                const translated = await svc().requestChat(prompt, settings, 2000);

                const blocks = [
                    { type: "divider", divider: {} },
                    { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `🌐 ${lang}翻译` } }] } },
                    ...AI()._textToBlocks(translated)
                ];
                await AI()._executeGuardedPageWrite("appendBlocks", page,
                    () => NotionAPI.appendBlocks(page.id, blocks, settings.notionApiKey),
                    settings,
                    { itemName: title }
                );
                successCount++;
            } catch (error) {
                console.warn(`[LD-Notion] 页面创建失败: ${title}`, error);
                failCount++;
            }
        }

        return `🌐 **批量翻译完成**\n\n- 目标语言: ${lang}\n- 成功: ${successCount} 页\n- 失败: ${failCount} 页\n- 总计: ${pages.length} 页\n\n💡 翻译内容已追加到每个页面末尾。`;
    } catch (error) {
        return `❌ 批量翻译失败: ${error.message}`;
    }
},
handleExtractToDatabase: async (params, settings, explanation) => {
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("createDatabase")) {
        return "❌ 权限不足：创建数据库需要「高级」权限级别。";
    }

    const { page_name, page_id, database_name, extraction_prompt } = params;

    if (!page_name && !page_id) {
        return "❌ 请指定源页面。\n\n💡 示例：「把 xxx 页面的笔记提取为任务数据库」";
    }

    state().updateLastMessage("正在读取源页面...", "processing");

    try {
        const sourcePage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (sourcePage?.error) return `❌ 页面解析失败：${sourcePage.error}`;
        if (!sourcePage) return `❌ 找不到页面「${page_name || page_id}」。`;

        const content = await AI()._extractPageContent(sourcePage.id, settings.notionApiKey, 6000);
        if (!content.trim()) {
            return `❌ 页面「${sourcePage.name}」没有可提取的内容。`;
        }

        // AI 分析内容并生成结构化数据
        state().updateLastMessage("🔍 正在分析内容结构...", "processing");

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

        const aiResponse = await svc().requestChat(analyzePrompt, settings, 3000);

        // 经 schema 层统一解析入口（正则提取+JSON.parse+结构校验），消除重复三段式
        // 并校验 properties/entries 为数组（ISS-20260723-009 M3：非数组不再被外层 catch 吞成模糊错误）
        const parsedResult = AISchema.parseAIJson("extractToDatabase", aiResponse);
        if (!parsedResult.ok) {
            return `❌ ${parsedResult.reason}`;
        }
        const extractedData = parsedResult.value;

        // 属性名/类型经 schema 校验（M1）：非法名/类型跳过该属性 + 警告，不静默走 rich_text 兜底
        const validProps = extractedData.properties.filter((prop) => {
            const nameOk = AISchema.validatePropertyName(prop.name);
            const typeOk = AISchema.validatePropertyType(prop.type);
            if (!nameOk || !typeOk.valid) {
                console.warn(`[LD-Notion] AI 返回的属性已跳过（name=${prop.name}, type=${prop.type}）`);
                return false;
            }
            prop.name = nameOk;
            prop.type = typeOk.type;
            return true;
        });
        if (validProps.length === 0) {
            return `❌ AI 返回的属性均无效，无法创建数据库。`;
        }
        extractedData.properties = validProps;

        // 确认操作
        const confirmed = await ConfirmationDialog.show({
            title: "📊 创建数据库确认",
            message: `将从「${sourcePage.name}」提取 ${extractedData.entries.length} 个条目。\n数据库名称: ${dbName}\n属性: ${extractedData.properties.map(p => p.name).join(", ")}`,
            confirmText: "创建",
            cancelText: "取消"
        });
        if (!confirmed) return "❌ 已取消。";

        // 创建数据库
        state().updateLastMessage("📊 正在创建数据库...", "processing");

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

        const newDb = await AI()._executeGuardedPageWrite("createDatabase", sourcePage,
            () => NotionAPI.createDatabase(sourcePage.id, dbName, dbProperties, settings.notionApiKey),
            settings,
            { itemName: dbName }
        );

        // 填充条目
        state().updateLastMessage(`📝 正在填充 ${extractedData.entries.length} 个条目...`, "processing");

        let addedCount = 0;
        let failedCount = 0;
        const titleProp = extractedData.properties.find(p => p.type === "title");
        const titleKey = titleProp ? titleProp.name : extractedData.properties[0].name;

        for (const entry of extractedData.entries) {
            try {
                const pageProperties = {};
                for (const prop of extractedData.properties) {
                    const val = entry[prop.name];
                    if (val === undefined || val === null) continue;
                    // 经 _buildPropertyValuePayload（内含 schema 校验+截断，ISS-20260723-009 M1）
                    pageProperties[prop.name] = AI()._buildPropertyValuePayload(val, prop.type);
                }

                const entryName = String(entry[titleKey] || `条目 ${addedCount + 1}`).trim() || `条目 ${addedCount + 1}`;
                await AI()._executeGuardedDatabaseWrite("createDatabasePage", newDb.id,
                    () => NotionAPI.createPage(newDb.id, pageProperties, settings.notionApiKey),
                    settings,
                    { itemName: entryName }
                );
                addedCount++;
            } catch (error) {
                failedCount++;
                console.warn(`[LD-Notion] 条目创建失败 (#${failedCount}):`, error.message);
                /* skip failed entries */
            }
        }

        const failedLine = failedCount > 0 ? `\n- 失败: ${failedCount}（见控制台警告）` : "";
        return `📊 **数据库创建完成**\n\n- 数据库: ${dbName}\n- 来源: ${sourcePage.name}\n- 属性: ${extractedData.properties.map(p => p.name).join(", ")}\n- 条目: ${addedCount}/${extractedData.entries.length}${failedLine}\n\n💡 数据库已创建在源页面下方。`;
    } catch (error) {
        return `❌ 提取失败: ${error.message}`;
    }
},
handleGeneratePages: async (params, settings, explanation) => {
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("createDatabase")) {
        return "❌ 权限不足：多页面生成需要「高级」权限级别。";
    }

    const { page_name, page_id, parent_page_name, parent_page_id, structure_prompt } = params;
    const topic = page_name || structure_prompt || explanation;

    if (!topic) {
        return "❌ 请描述要生成的内容主题。\n\n💡 示例：「为新员工创建入职指南，包含工具清单、团队介绍、常见问题」";
    }

    state().updateLastMessage("📑 正在规划页面结构...", "processing");

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

        const planResponse = await svc().requestChat(planPrompt, settings, 1500);

        // ISS-013: 统一走 parseAIJson 接缝（arch-013），消除手工 jsonMatch+JSON.parse 三段式。
        // ok=false（未找到 JSON / 格式无效 / children 结构无效）→ 返回错误提示，与原逻辑等价。
        const planResult = AISchema.parseAIJson("generatePages", planResponse);
        if (!planResult.ok) {
            console.warn("[LD-Notion] AI 生成结构 JSON 解析失败:", planResult.reason);
            return `❌ AI 生成的结构无效。请换一种方式描述。`;
        }
        const plan = planResult.value;

        // plan.children 经 AISchema 校验（M2，ISS-009 消费点补全：handleGeneratePages 遗漏路径）。
        // title 走 validatePropertyValue 截断 ≤2000、icon 走 validateEmoji、description 截断，防 prompt injection 污染。
        if (!Array.isArray(plan.children) || plan.children.length === 0) {
            return `❌ AI 未能规划出有效的子页面结构。`;
        }
        const MAX_CHILD_DESC = 2000;
        plan.children = plan.children.map((c) => ({
            ...c,
            title: AISchema.validatePropertyValue(c?.title, "title"),
            icon: AISchema.validateEmoji(c?.icon),
            description: AISchema.validatePropertyValue(c?.description, "rich_text").slice(0, MAX_CHILD_DESC),
        })).filter((c) => c.title);
        if (plan.children.length === 0) {
            return `❌ AI 规划的子页面标题无效。`;
        }
        plan.parent_title = AISchema.validatePropertyValue(plan.parent_title, "title");
        plan.parent_summary = AISchema.validatePropertyValue(plan.parent_summary, "rich_text");

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
            const parentPage = await AI()._resolvePageId(parent_page_name, null, settings.notionApiKey);
            if (parentPage) parentPageId = parentPage.id;
        }

        // 创建父页面
        state().updateLastMessage(`📁 正在创建父页面: ${plan.parent_title}...`, "processing");

        const parentProps = {
            title: { title: [{ text: { content: plan.parent_title } }] }
        };

        let parentPage;
        if (parentPageId) {
            parentPage = await AI()._executeGuardedPageWrite("createDatabasePage",
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
        const overviewBlocks = AI()._textToBlocks(`${plan.parent_summary || ""}\n\n## 📋 目录\n\n${plan.children.map((c, i) => `${i + 1}. ${c.icon || "📄"} **${c.title}** - ${c.description}`).join("\n")}`);
        await AI()._executeGuardedPageWrite("appendBlocks", parentPage,
            () => NotionAPI.appendBlocks(parentPage.id, overviewBlocks, settings.notionApiKey),
            settings,
            { itemName: plan.parent_title }
        );

        // 创建子页面并生成内容
        let createdCount = 0;
        for (let i = 0; i < plan.children.length; i++) {
            const child = plan.children[i];
            state().updateLastMessage(`📝 生成子页面 (${i + 1}/${plan.children.length}): ${child.title}...`, "processing");

            try {
                // 创建子页面
                const childProps = {
                    title: { title: [{ text: { content: `${child.icon || ""} ${child.title}`.trim() } }] }
                };
                const childPage = await AI()._executeGuardedPageWrite("createDatabasePage", parentPage,
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

                const content = await svc().requestChat(contentPrompt, settings, 2000);
                const contentBlocks = AI()._textToBlocks(content);
                await AI()._executeGuardedPageWrite("appendBlocks", childPage,
                    () => NotionAPI.appendBlocks(childPage.id, contentBlocks, settings.notionApiKey),
                    settings,
                    { itemName: child.title }
                );
                createdCount++;
            } catch (error) {
                console.warn(`[LD-Notion] 子页面创建失败: ${child.title}`, error);
                /* skip failed pages */
            }
        }

        return `📑 **多页面内容生成完成**\n\n- 父页面: ${plan.parent_title}\n- 子页面: ${createdCount}/${plan.children.length} 创建成功\n\n💡 所有页面已创建并填充内容。`;
    } catch (error) {
        return `❌ 页面生成失败: ${error.message}`;
    }
},
handleBatchAnalyze: async (params, settings, explanation) => {
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    const { database_name, database_id, analysis_prompt } = params;
    const limit = Math.min(Math.max(parseInt(params.limit) || 10, 1), 20);

    if (!database_name && !database_id) {
        // 使用默认配置的数据库
        if (!settings.notionDatabaseId) {
            return "❌ 请指定要分析的数据库，或先配置默认数据库 ID。\n\n💡 示例：「分析 xxx 数据库的所有页面」";
        }
    }

    state().updateLastMessage("正在查找数据库...", "processing");

    try {
        let dbId = database_id || settings.notionDatabaseId;
        if (!dbId && database_name) {
            const searchResp = await NotionAPI.search(database_name, "database", settings.notionApiKey);
            const db = (searchResp.results || []).find(r => !r.archived);
            if (!db) return `❌ 找不到数据库「${database_name}」。`;
            dbId = db.id;
        }

        // 查询页面
        state().updateLastMessage("正在获取页面...", "processing");
        const queryResp = await NotionAPI.queryDatabase(dbId, null, null, null, settings.notionApiKey, limit);
        const pages = (queryResp.results || []).filter(p => !p.archived);

        if (pages.length === 0) {
            return `❌ 数据库中没有可分析的页面。`;
        }

        // 提取内容
        state().updateLastMessage(`🔎 正在提取 ${pages.length} 个页面内容...`, "processing");

        const contentParts = [];
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const title = Utils.getPageTitle(page);
            state().updateLastMessage(`🔎 提取中 (${i + 1}/${pages.length}): ${title}...`, "processing");

            const content = await AI()._extractPageContent(page.id, settings.notionApiKey, 2000);
            contentParts.push(`## ${title}\n${content || "（无内容）"}`);
        }

        // AI 生成综合分析
        state().updateLastMessage("📊 正在生成综合分析...", "processing");

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

        const report = await svc().requestChat(prompt, settings, 4000);

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
            state().updateLastMessage(`🐙 ${msg}`, "processing");
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
            state().updateLastMessage("🏷️ 正在进行 AI 分类...", "processing");
            try {
                const classifyResult = await (require("../import").GitHubExporter).classifyRepos({
                    ...settings,
                    databaseId,
                }, (msg, pct) => {
                    state().updateLastMessage(`🏷️ ${msg}`, "processing");
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
        state().updateLastMessage("📖 正在读取浏览器书签...", "processing");
        const tree = await (require("../bridge").BookmarkBridge).getBookmarkTree();
        const allBookmarks = (require("../bridge").BookmarkExporter).flattenTree(tree);

        if (allBookmarks.length === 0) {
            return "📭 没有找到浏览器书签。";
        }

        const dedupStrict = Utils.isBookmarkDedupStrict();
        const newCount = dedupStrict
            ? allBookmarks.filter(b => !(require("../bridge").BookmarkExporter).isExported(b.url)).length
            : allBookmarks.length;
        state().updateLastMessage(`📖 找到 ${allBookmarks.length} 个书签 (${newCount} 个新书签)，正在导出...`, "processing");

        const result = await (require("../bridge").BookmarkExporter).exportBookmarks({
            apiKey: settings.notionApiKey,
            databaseId,
            bookmarks: allBookmarks,
            aiApiKey: settings.aiApiKey,
            aiService: settings.aiService,
            aiModel: settings.aiModel,
            aiBaseUrl: settings.aiBaseUrl,
        }, (msg, pct) => {
            state().updateLastMessage(`📖 ${msg}`, "processing");
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
    const configCheck = AI().checkConfig(settings, false);
    if (!configCheck.valid) return configCheck.error;

    if (!OperationGuard.canExecute("appendBlocks")) {
        return "❌ 权限不足：模板输出需要「标准」权限级别。";
    }

    const { template_name, page_name, page_id, custom_context } = params;

    // 加载模板列表
    let templates;
    try {
        templates = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.AI_TEMPLATES, CONFIG.DEFAULTS.aiTemplates));
    } catch (error) {
        console.warn("[LD-Notion] AI 模板加载失败，使用默认模板:", error);
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
        state().updateLastMessage("正在读取页面内容...", "processing");
        targetPage = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
        if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
        if (targetPage) {
            pageContext = await AI()._extractPageContent(targetPage.id, settings.notionApiKey, 4000);
        }
    }

    // 组合 prompt
    state().updateLastMessage(`${template.icon} 正在使用「${template.name}」模板生成...`, "processing");

    const contextBlock = pageContext ? `\n\n以下是参考内容：\n${pageContext}` : "";
    const customBlock = custom_context ? `\n\n用户补充说明：${custom_context}` : "";
    const fullPrompt = `${template.prompt}${contextBlock}${customBlock}\n\n请使用 Markdown 格式输出。`;

    const aiResponse = await svc().requestChat(fullPrompt, settings, 3000);

    // 如果有目标页面，写入 Notion
        if (targetPage) {
            state().updateLastMessage("正在写入页面...", "processing");
            const contentBlocks = AI()._textToBlocks(aiResponse);
            const blocks = [
                { type: "divider", divider: {} },
                { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `${template.icon} ${template.name}` } }] } },
                ...contentBlocks
            ];
            await AI()._executeGuardedPageWrite("appendBlocks", targetPage,
                () => NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey),
                settings,
                { itemName: targetPage.name }
            );
            return `✅ **${template.icon} ${template.name}** 已生成并写入页面「${targetPage.name}」\n\n${aiResponse}`;
        }

    return `${template.icon} **${template.name}**\n\n${aiResponse}\n\n💡 如需写入页面，请指定目标页面：「用${template.name}模板处理 xxx 页面」`;
},
};


module.exports = { AIHandlers };
