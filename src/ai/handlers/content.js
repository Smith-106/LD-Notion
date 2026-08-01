"use strict";

// handlers/content.js — 内容读写与 AI 生成类 handler（TASK-005, P5_handler_split）。
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
