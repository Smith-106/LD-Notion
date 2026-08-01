"use strict";

// tools/write-tools.js — 写入操作类工具（Level 1-2）（TASK-006, P6_agenttools_split）。
// 从 AgentTools.js 程序化提取，逻辑零修改。

const { CONFIG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage } = require("../../storage");
const { TargetState } = require("../../auth");
const { NotionAPI } = require("../../api");
const { OperationGuard } = require("../../security");
const { getAI: AI, getService: svc } = require("../deps");

module.exports = {
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
                } catch (error) {
                    console.warn("[LD-Notion] 数据库查询失败:", error);
                    return [];
                }
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

                    const result = await svc().request(prompt, settings);
                    const tags = result.split(/[,，]/).map(t => t.trim()).filter(t => t.length > 0 && t.length <= 20).slice(0, tag_count);

                    if (tags.length > 0) {
                        await AI()._executeGuardedPageWrite("updatePage",
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

                await Utils.sleep(500);
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

            const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            await AI()._executeGuardedPageWrite("appendBlocks", page,
                async () => {
                    try {
                        await NotionAPI.appendPageMarkdown(page.id, content, settings.notionApiKey);
                    } catch (error) {
                        console.warn("[LD-Notion] Markdown 追加失败，回退到块追加:", error);
                        const blocks = AI()._textToBlocks(content);
                        await NotionAPI.appendBlocks(page.id, blocks, settings.notionApiKey);
                    }
                },
                settings
            );
            return AI()._formatToolResult({
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
                const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (page?.error) return `错误: ${page.error}`;
                if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;
                parentId = page.id;
                targetName = page.name;
            }

            const blocks = AI()._textToBlocks(String(content));
            if (blocks.length === 0) return "错误: 未能从 content 生成有效块。";

            const options = {};
            if (insert_position === "after_block") {
                if (!after_block_id) return "错误: insert_position=after_block 时必须提供 after_block_id。";
                options.after = String(after_block_id).replace(/-/g, "");
            } else if (insert_position !== "end") {
                return "错误: insert_position 仅支持 end 或 after_block。";
            }

            await AI()._executeGuardedWrite("appendBlocks",
                () => NotionAPI.appendBlockChildren(parentId, blocks, settings.notionApiKey, options),
                { itemName: targetName || parentId, pageId: parentId },
                settings
            );
            return AI()._formatToolResult({
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

            const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            await AI()._executeGuardedPageWrite("updatePageMarkdown", page,
                () => NotionAPI.searchReplacePageMarkdown(page.id, updates, settings.notionApiKey),
                settings
            );

            return AI()._formatToolResult({
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

            const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            await AI()._executeGuardedPageWrite("replacePageMarkdown", page,
                () => NotionAPI.replacePageMarkdown(page.id, new_markdown, settings.notionApiKey, true),
                settings
            );

            return AI()._formatToolResult({
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
                page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (page?.error) return `错误: ${page.error}`;
                if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;
                targetName = page.name;
            }

            const result = await AI()._executeGuardedWrite("createComment",
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
            return AI()._formatToolResult({
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

            await AI()._executeGuardedPageWrite("updatePage",
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
                const resolved = await AI()._resolveDatabaseId(database_name, null, settings.notionApiKey);
                const targetDb = dbId ? { id: Utils.extractNotionId(dbId) || String(dbId).replace(/-/g, ""), name: database_name || dbId } : resolved;
                if (!dbId && resolved?.error) return `错误: ${resolved.error}`;
                if (!targetDb) return `错误: 找不到数据库「${database_name || database_id}」。`;
                parent = { database_id: targetDb.id };
                parentDesc = `数据库「${targetDb.name}」`;
            } else if (parent_page_id || parent_page_name) {
                const targetPage = await AI()._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
                if (targetPage?.error) return `错误: ${targetPage.error}`;
                if (!targetPage) return `错误: 找不到父页面「${parent_page_name || parent_page_id}」。`;
                parent = { page_id: targetPage.id };
                parentDesc = `页面「${targetPage.name}」`;
            } else if (settings.notionDatabaseId) {
                parent = { database_id: settings.notionDatabaseId.replace(/-/g, "") };
                parentDesc = "已配置的数据库";
            }
            if (!parent) return "错误: 请提供 database_name/database_id 或 parent_page_name/parent_page_id，或先配置数据库 ID。";

            const properties = AI()._normalizeNotionProperties(args.properties);
            if (parent.database_id) {
                properties["标题"] = { title: [{ text: { content: title } }] };
            } else {
                properties.title = { title: [{ text: { content: title } }] };
            }

            const children = content ? AI()._textToBlocks(String(content)) : [];
            const icon = AI()._buildPageIconPayload(args);
            const cover = AI()._buildPageCoverPayload(args);

            const page = await AI()._executeGuardedWrite("createDatabasePage",
                () => NotionAPI.createPageObject(parent, properties, children, settings.notionApiKey, { icon, cover }),
                { itemName: title },
                settings
            );
            const newId = page.id?.replace(/-/g, "") || "";
            return AI()._formatToolResult({
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
                    : await AI()._resolveDatabaseId(args.database_name, null, settings.notionApiKey);
                if (targetDb?.error) return `错误: ${targetDb.error}`;
                if (!targetDb) return `错误: 找不到数据库「${args.database_name || args.database_id}」。`;
                parent = { database_id: targetDb.id };
            } else if (args.parent_page_id || args.parent_page_name) {
                const targetPage = await AI()._resolvePageId(args.parent_page_name, args.parent_page_id, settings.notionApiKey);
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
                    const properties = AI()._normalizeNotionProperties(item.properties);
                    if (parent.database_id) {
                        properties["标题"] = { title: [{ text: { content: title } }] };
                    } else {
                        properties.title = { title: [{ text: { content: title } }] };
                    }

                    const children = item.content ? AI()._textToBlocks(String(item.content)) : [];
                    const icon = AI()._buildPageIconPayload(item);
                    const cover = AI()._buildPageCoverPayload(item);

                    await AI()._executeGuardedWrite("createDatabasePage",
                        () => NotionAPI.createPageObject(parent, properties, children, settings.notionApiKey, { icon, cover }),
                        { itemName: title },
                        settings
                    );
                    success++;
                } catch (error) {
                    console.warn("[LD-Notion] 页面创建失败:", error);
                    failed++;
                }

                if (i < pages.length - 1) {
                    await Utils.sleep(delay);
                }
            }

            return AI()._formatToolResult({
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

            const page = await AI()._resolvePageId(page_name, page_id, settings.notionApiKey);
            if (page?.error) return `错误: ${page.error}`;
            if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

            const payload = {};
            const icon = AI()._buildPageIconPayload(args);
            const cover = AI()._buildPageCoverPayload(args);
            if (icon !== undefined) payload.icon = icon;
            if (cover !== undefined) payload.cover = cover;
            if (typeof is_locked === "boolean") payload.is_locked = is_locked;

            if (Object.keys(payload).length === 0) {
                return "错误: 请至少提供一个可更新字段，如 icon_emoji、icon_url、cover_url、clear_icon、clear_cover、is_locked。";
            }

            await AI()._executeGuardedPageWrite("updatePage", page,
                () => NotionAPI.updatePageMeta(page.id, payload, settings.notionApiKey),
                settings
            );

            return AI()._formatToolResult({
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
            const targets = await AI()._resolvePageTargets(args, settings);
            if (targets?.error) return `错误: ${targets.error}`;
            if (!targets || targets.length === 0) {
                return "错误: 没有找到可更新的页面。";
            }
            if (targets.length > 1) {
                return "错误: update_page 仅支持单页面，请改用 batch_update_pages。";
            }

            const result = await AI()._applyPageUpdatesToTargets(targets, args, settings);
            if (result.failed > 0) {
                return `更新页面「${targets[0].name}」失败。`;
            }
            return AI()._formatToolResult({
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
            const targets = await AI()._resolvePageTargets(args, settings);
            if (targets?.error) return `错误: ${targets.error}`;
            if (!targets || targets.length === 0) {
                return "错误: 没有找到可更新的页面。请提供 page_id/page_name/page_ids，或提供 database_name/database_id + page_title。";
            }

            const { success, failed } = await AI()._applyPageUpdatesToTargets(targets, args, settings);

            return AI()._formatToolResult({
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
            const payload = AI()._buildBlockUpdatePayload(block, content, { checked, color });
            await AI()._executeGuardedWrite("updateBlock",
                () => NotionAPI.updateBlock(block_id.replace(/-/g, ""), payload, settings.notionApiKey),
                { itemName: String(block_id).replace(/-/g, "") },
                settings
            );
            return AI()._formatToolResult({
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
                } catch (error) {
                    console.warn("[LD-Notion] 页面分类失败:", error);
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

            const target = await AI()._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
            if (target?.error) return `错误: ${target.error}`;
            if (!target) return `错误: 找不到目标数据库「${target_database_name || target_database_id}」。`;

            await AI()._executeGuardedPageWrite("movePage",
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

            const target = await AI()._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
            if (target?.error) return `错误: ${target.error}`;
            if (!target) return `错误: 找不到目标数据库「${target_database_name || target_database_id}」。`;

            await AI()._executeGuardedPageWrite("duplicatePage",
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
            const targets = await AI()._resolvePageTargets(args, settings);
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
                    await AI()._executeGuardedPageWrite("deletePage", target,
                        () => NotionAPI.deletePage(target.id, settings.notionApiKey),
                        settings
                    );
                    success++;
                } catch (error) {
                    console.warn("[LD-Notion] 页面删除失败:", error);
                    failed++;
                }

                if (i < targets.length - 1) {
                    await Utils.sleep(delay);
                }
            }

            return AI()._formatToolResult({
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
            const targets = await AI()._resolvePageTargets(args, settings);
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
                    await AI()._executeGuardedPageWrite("restorePage", target,
                        () => NotionAPI.restorePage(target.id, settings.notionApiKey),
                        settings
                    );
                    success++;
                } catch (error) {
                    console.warn("[LD-Notion] 页面恢复失败:", error);
                    failed++;
                }

                if (i < targets.length - 1) {
                    await Utils.sleep(delay);
                }
            }

            return AI()._formatToolResult({
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
                parentPage = await AI()._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
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

            const result = await AI()._executeGuardedWrite("createDatabase",
                () => NotionAPI.createDatabase(parentPage.id, name, properties, settings.notionApiKey),
                { itemName: name },
                settings
            );

            const newDbId = result.id?.replace(/-/g, "") || "";
            return `已创建数据库「${name}」(ID: ${newDbId})，父页面: ${parentPage.name}。`;
        }
    },

    // === 深度研究工具 (Level 0) ===
};
