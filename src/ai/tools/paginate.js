"use strict";

// tools/paginate.js — Notion 查询分页助手(带硬上限)
// P4 收敛(c04): batch_tag/cross_source_search/unified_stats 此前单次查询即当全量,
// 超出 page_size 的条目与第 6 个之后的数据库被静默遗漏。
const { NotionAPI } = require("../../api");

const MAX_QUERY_PAGES = 10;   // 单库最多 10 页(×100 = 1000 条)
const MAX_SEARCH_PAGES = 10;  // 数据库发现最多 10 页

/**
 * 分页查询单个数据库。失败/损坏游标即停止(优雅降级), 返回已取结果。
 * @returns {Promise<{results: Array, truncated: boolean}>}
 */
const queryAllPages = async ({ dbId, apiKey, body = {}, maxPages = MAX_QUERY_PAGES }) => {
    const results = [];
    const seen = new Set();
    let cursor = null;
    let pages = 0;
    let truncated = false;
    do {
        const reqBody = { ...body };
        if (cursor) reqBody.start_cursor = cursor;
        let response;
        try {
            response = await NotionAPI.request("POST", `/databases/${dbId}/query`, reqBody, apiKey);
        } catch (error) {
            console.warn("[LD-Notion] 数据库查询失败:", error);
            break;
        }
        results.push(...(response.results || []));
        pages++;
        const next = response.has_more ? String(response.next_cursor || "") : "";
        if (!next || seen.has(next)) break;
        seen.add(next);
        if (pages >= maxPages) {
            truncated = true;
            break;
        }
        cursor = next;
    } while (cursor);
    return { results, truncated };
};

/**
 * 分页发现工作区中的数据库(避免仅取前 N 个)。
 * @returns {Promise<{results: Array, truncated: boolean}>}
 */
const searchAllDatabases = async ({ apiKey, maxPages = MAX_SEARCH_PAGES }) => {
    const results = [];
    const seen = new Set();
    let cursor = null;
    let pages = 0;
    let truncated = false;
    do {
        let response;
        try {
            response = await NotionAPI.search("", { property: "object", value: "database" }, apiKey, cursor || undefined);
        } catch (error) {
            console.warn("[LD-Notion] 数据库发现失败:", error);
            break;
        }
        results.push(...(response.results || []));
        pages++;
        const next = response.has_more ? String(response.next_cursor || "") : "";
        if (!next || seen.has(next)) break;
        seen.add(next);
        if (pages >= maxPages) {
            truncated = true;
            break;
        }
        cursor = next;
    } while (cursor);
    return { results, truncated };
};

module.exports = { queryAllPages, searchAllDatabases, MAX_QUERY_PAGES, MAX_SEARCH_PAGES };
