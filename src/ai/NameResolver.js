"use strict";

// NameResolver — Notion 数据库/页面 名称→ID 解析。
// ISS-20260723-010 W4 (MAINT-009): 从 ai/index.js 提取 _resolveDatabaseId(3014) +
// _resolvePageId(3415) 到独立模块，消除 38 处跨块调用耦合（AI_AGENT_TOOLS +
// AIHandlers 共用）。纯解析逻辑，无 ChatState/外部状态依赖（仅依赖 NotionAPI.search
// 只读查询）。AIAssistant 上保留转发壳 (_resolveDatabaseId/_resolvePageId) 保持
// 38 处调用点零改动。

const { Utils } = require("../utils");
const { NotionAPI } = require("../api");

const NameResolver = {
    // 数据库名称/ID → { id, name } | { error } | null
    resolveDatabaseId: async (name, id, apiKey) => {
        // 优先使用直接提供的 ID
        if (id) {
            const parsedId = Utils.extractNotionId(id) || String(id).replace(/-/g, "");
            return { id: parsedId, name: name || id };
        }

        const refId = Utils.extractNotionId(name);
        if (refId) return { id: refId, name: name || refId };

        if (!name) return null;

        // 通过名称搜索数据库
        const response = await NotionAPI.search(
            name,
            { property: "object", value: "database" },
            apiKey
        );

        const databases = response.results || [];
        // 优先精确匹配，再模糊匹配
        let exactMatch = null;
        const partialMatches = [];
        for (const db of databases) {
            const titleProp = db.title || [];
            const dbTitle = titleProp.map(t => t.plain_text).join("");
            if (!dbTitle) continue;
            if (dbTitle === name) {
                exactMatch = { id: db.id.replace(/-/g, ""), name: dbTitle };
                break;
            }
            if (dbTitle.includes(name)) {
                partialMatches.push({ id: db.id.replace(/-/g, ""), name: dbTitle });
            }
        }

        if (exactMatch) return exactMatch;
        if (partialMatches.length === 1) return partialMatches[0];
        if (partialMatches.length > 1) {
            // 多个模糊匹配，返回错误避免误操作
            const names = partialMatches.map(m => `「${m.name}」`).join("、");
            return { error: `找到多个匹配的数据库: ${names}，请使用更精确的名称。` };
        }

        return null;
    },

    // 页面名称/ID → { id, name } | { error } | null
    resolvePageId: async (name, id, apiKey) => {
        if (id) {
            const parsedId = Utils.extractNotionId(id) || String(id).replace(/-/g, "");
            return { id: parsedId, name: name || id };
        }
        const refId = Utils.extractNotionId(name);
        if (refId) return { id: refId, name: name || refId };
        if (!name) return null;

        const response = await NotionAPI.search(
            name,
            { property: "object", value: "page" },
            apiKey
        );

        const pages = (response.results || []).filter(p => !p.archived);
        let exactMatch = null;
        const partialMatches = [];
        for (const page of pages) {
            const title = Utils.getPageTitle(page);
            if (!title) continue;
            if (title === name) {
                exactMatch = { id: page.id.replace(/-/g, ""), name: title };
                break;
            }
            if (title.includes(name)) {
                partialMatches.push({ id: page.id.replace(/-/g, ""), name: title });
            }
        }

        if (exactMatch) return exactMatch;
        if (partialMatches.length === 1) return partialMatches[0];
        if (partialMatches.length > 1) {
            const names = partialMatches.map(m => `「${m.name}」`).join("、");
            return { error: `找到多个匹配的页面: ${names}，请使用更精确的名称。` };
        }
        return null;
    },
};

module.exports = { NameResolver };
