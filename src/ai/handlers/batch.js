"use strict";

// handlers/batch.js — 批量操作与导入类 handler（TASK-005, P5_handler_split）。
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
    const importTypes = (require("../../import").GitHubAPI).getImportTypes();

    try {
        const allResults = await (require("../../import").GitHubExporter).exportAll({
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
                const classifyResult = await (require("../../import").GitHubExporter).classifyRepos({
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
    if (!(require("../../bridge").BookmarkBridge).isExtensionAvailable()) {
        const installUrl = (require("../../api").InstallHelper).getBookmarkExtensionUrl();
        return `❌ 未检测到 LD-Notion 书签桥接扩展。\n\n💡 请点击安装：${installUrl}\n\n手动安装步骤：\n1. 打开 chrome://extensions/\n2. 开启「开发者模式」\n3. 点击「加载已解压的扩展」\n4. 选择项目中的 chrome-extension 文件夹\n5. 刷新当前页面\n\n🔎 诊断建议：\n- 若你当前使用的是 chrome-extension-full 独立版，请关闭 userscript，避免双模式混用\n- 若你坚持 userscript 模式，请仅安装 chrome-extension（桥接版）`;
    }

    try {
        state().updateLastMessage("📖 正在读取浏览器书签...", "processing");
        const tree = await (require("../../bridge").BookmarkBridge).getBookmarkTree();
        const allBookmarks = (require("../../bridge").BookmarkExporter).flattenTree(tree);

        if (allBookmarks.length === 0) {
            return "📭 没有找到浏览器书签。";
        }

        const dedupStrict = Utils.isBookmarkDedupStrict();
        const newCount = dedupStrict
            ? allBookmarks.filter(b => !(require("../../bridge").BookmarkExporter).isExported(b.url)).length
            : allBookmarks.length;
        state().updateLastMessage(`📖 找到 ${allBookmarks.length} 个书签 (${newCount} 个新书签)，正在导出...`, "processing");

        const result = await (require("../../bridge").BookmarkExporter).exportBookmarks({
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
};
