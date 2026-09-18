"use strict";

// ai-classifier.js — 批量分类器 (M3 波次5: 提取自 ai/index.js AIClassifier ~255 LOC)。
// 依赖 AIAssistant(回边)经 lazy accessor require("./index") 解循环,与 deps.js 同口径;
// 其余依赖 NotionAPI/CONFIG/Storage/Utils (无回流)。

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");

// lazy accessor —— AIAssistant/AIService 为 ai/index 内对象,运行时获取(此时 index 已加载完毕)。
let _a = null; const AIAssistant = () => (_a || (_a = require("./index").AIAssistant));
let _s = null; const AIService = () => (_s || (_s = require("./ai-service").AIService));

const AIClassifier = {
    isPaused: false,
    isCancelled: false,

    // 批量分类
    classifyBatch: async (settings, onProgress) => {
        AIClassifier.reset();

        // 0. 确保数据库有 "AI分类" 属性
        await AIClassifier.ensureAICategoryProperty(settings);

        // 1. 查询数据库获取所有页面
        const pages = await AIClassifier.fetchAllPages(settings);

        if (pages.length === 0) {
            throw new Error("数据库中没有找到任何页面");
        }

        // 2. 过滤未分类的页面
        const unclassified = pages.filter(p => {
            const aiCategory = p.properties["AI分类"];
            return !aiCategory?.select?.name;
        });

        if (unclassified.length === 0) {
            return { total: pages.length, classified: 0, message: "所有页面都已分类" };
        }

        const results = { success: [], failed: [] };
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        // 3. 批量分类
        for (let i = 0; i < unclassified.length; i++) {
            if (AIClassifier.isCancelled) break;

            while (AIClassifier.isPaused) {
                await Utils.sleep(500);
                if (AIClassifier.isCancelled) break;
            }
            if (AIClassifier.isCancelled) break;

            const page = unclassified[i];
            const title = AIClassifier.getPageTitle(page);

            onProgress?.({
                current: i + 1,
                total: unclassified.length,
                title: title,
                isPaused: AIClassifier.isPaused,
            });

            try {
                await AIClassifier.classifyPage(page, settings);
                results.success.push({ title });
            } catch (error) {
                results.failed.push({ title, error: error.message });
            }

            // 请求间隔
            if (i < unclassified.length - 1) {
                await Utils.sleep(delay);
            }
        }

        return {
            total: pages.length,
            classified: results.success.length,
            failed: results.failed.length,
            results,
        };
    },

    // 获取所有页面
    fetchAllPages: async (settings) => {
        const { notionApiKey, notionDatabaseId } = settings;
        const pages = [];
        let cursor = null;
        // P4 收敛(c03): 原循环无游标守卫与页数上限 —— 重复游标会死循环, 超大库无界增长
        const seenCursors = new Set();
        const MAX_PAGES = 100;
        let pageCount = 0;

        do {
            const response = await NotionAPI.queryDatabase(
                notionDatabaseId,
                null,
                null,
                cursor,
                notionApiKey
            );
            pages.push(...(response.results || []));
            pageCount++;
            const nextCursor = response.has_more ? response.next_cursor : null;
            cursor = (nextCursor && !seenCursors.has(nextCursor)) ? nextCursor : null;
            if (cursor) seenCursors.add(cursor);
        } while (cursor && pageCount < MAX_PAGES);
        if (cursor) {
            console.warn(`[LD-Notion] 分页已达上限 ${MAX_PAGES} 页, 剩余页面未加载`);
        }

        return pages;
    },

    // 获取页面标题（复用 Utils.getPageTitle）
    getPageTitle: (page) => {
        return Utils.getPageTitle(page, "未命名");
    },

    // 分类单个页面
    classifyPage: async (page, settings) => {
        const title = AIClassifier.getPageTitle(page);

        // 获取页面内容
        const blocks = await AIClassifier.fetchPageBlocks(page.id, settings.notionApiKey);
        const content = AIClassifier.extractText(blocks);

        // 调用 AI 分类
        const category = await AIService().classify(
            title,
            content,
            settings.categories,
            settings
        );

        // 更新页面属性
        await AIAssistant()._executeGuardedPageWrite("updatePage",
            { id: page.id, name: title },
            () => NotionAPI.updatePage(page.id, {
                "AI分类": { select: { name: category } }
            }, settings.notionApiKey),
            settings
        );

        return category;
    },

    // 获取页面所有块
    fetchPageBlocks: async (pageId, apiKey) => {
        const blocks = [];
        let cursor = null;
        // P4 收敛(c03): 与 fetchAllPages 同口径——重复 next_cursor 会死循环, 超大页面无界增长
        const seenCursors = new Set();
        const MAX_PAGES = 100;
        let pageCount = 0;

        do {
            const response = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
            blocks.push(...(response.results || []));
            pageCount++;
            const nextCursor = response.has_more ? response.next_cursor : null;
            cursor = (nextCursor && !seenCursors.has(nextCursor)) ? nextCursor : null;
            if (cursor) seenCursors.add(nextCursor);
        } while (cursor && pageCount < MAX_PAGES);

        if (cursor) {
            console.warn(`[LD-Notion] 块分页已达上限 ${MAX_PAGES} 页, 剩余子块未加载`);
        }

        return blocks;
    },

    // 提取页面文本
    extractText: (blocks) => {
        const texts = [];

        const extractFromBlock = (block) => {
            const type = block.type;
            const content = block[type];

            if (!content) return;

            // 提取富文本
            if (content.rich_text) {
                const text = content.rich_text.map(rt => rt.plain_text).join("");
                if (text) texts.push(text);
            }

            // 提取标题
            if (content.title) {
                const text = content.title.map(t => t.plain_text).join("");
                if (text) texts.push(text);
            }

            // 提取代码
            if (content.caption) {
                const text = content.caption.map(c => c.plain_text).join("");
                if (text) texts.push(text);
            }
        };

        blocks.forEach(extractFromBlock);
        return texts.join("\n").slice(0, 4000); // 限制长度
    },

    // 确保数据库有 "AI分类" Select 属性
    ensureAICategoryProperty: async (settings) => {
        const { notionApiKey, notionDatabaseId, categories } = settings;

        // 获取数据库 schema
        const database = await NotionAPI.fetchDatabase(notionDatabaseId, notionApiKey);
        const properties = database.properties || {};

        // 检查是否已有 "AI分类" 属性
        if (properties["AI分类"]) {
            // 属性已存在，更新选项列表（添加新分类）
            const existingOptions = properties["AI分类"].select?.options || [];
            const existingNames = new Set(existingOptions.map(o => o.name));

            // 找出需要添加的新分类
            const newOptions = categories.filter(cat => !existingNames.has(cat));

            if (newOptions.length > 0) {
                // 合并现有选项和新选项
                const allOptions = [
                    ...existingOptions,
                    ...newOptions.map(name => ({ name }))
                ];

                await AIAssistant()._executeGuardedDatabaseWrite("updateDatabase", notionDatabaseId,
                    () => NotionAPI.updateDatabase(notionDatabaseId, {
                        "AI分类": {
                            select: { options: allOptions }
                        }
                    }, notionApiKey),
                    notionApiKey
                );
            }
            return;
        }

        // 创建 "AI分类" Select 属性
        const options = categories.map(name => ({ name }));

        await AIAssistant()._executeGuardedDatabaseWrite("updateDatabase", notionDatabaseId,
            () => NotionAPI.updateDatabase(notionDatabaseId, {
                "AI分类": {
                    select: { options }
                }
            }, notionApiKey),
            notionApiKey
        );
    },

    // 控制方法
    pause: () => { AIClassifier.isPaused = true; },
    resume: () => { AIClassifier.isPaused = false; },
    cancel: () => { AIClassifier.isCancelled = true; },
    reset: () => {
        AIClassifier.isPaused = false;
        AIClassifier.isCancelled = false;
        // P3 3/3 共识(dsf+glm+qwen): 按钮文案只在 onclick 内翻转, 批次 reset 只复位标志,
        // 跨批次残留「▶️ 继续分类」与 isPaused=false 相反。
        const pauseBtn = document.querySelector("#ldb-classify-pause");
        if (pauseBtn) pauseBtn.textContent = "⏸️ 暂停分类";
    },
};

module.exports = { AIClassifier };
