"use strict";

// handlers/pageCrud.js — 页面 CRUD 与数据库操作类 handler（TASK-005, P5_handler_split）。
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
};
