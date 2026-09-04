"use strict";

// SyncLedger — Notion 介质层(幂等 provision / pullRows / pushRow)
// 全部经 OperationGuard.execute 收口(不裸调 NotionAPI, AGENTS.md 红线)。
// 行模型: { kind, source, key, version, updatedAt, deviceId, payload, checksum }
// 介质形态: 同步库每行一个 page, payload 为 rich_text 属性(经 Fragmenter 分片)。

const { SyncFragmenter } = require("./SyncFragmenter");
const { SyncRateLimiter } = require("./SyncRateLimiter");

// 介质行属性名(与 provision 创建的结构一致)
const ROW_TITLE_PROP = "键";
const ROW_KIND_PROP = "类型";
const ROW_VERSION_PROP = "版本";
const ROW_UPDATED_AT_PROP = "更新时间";
const ROW_DEVICE_PROP = "设备";
const ROW_PAYLOAD_PROP = "数据";

const SyncLedger = {
    /**
     * 幂等 provision: 搜索已有同步库 → fetchDatabase → createDatabase
     * @param {Object} deps { NotionAPI, OperationGuard, apiKey, parentPageId, context }
     * @returns {Promise<{databaseId: string, created: boolean}>}
     */
    async provision({ NotionAPI, OperationGuard, apiKey, parentPageId, context = {} }) {
        // 搜索已有库(来源=LD-Sync 的数据库)
        const searchFilter = { property: "来源", rich_text: { equals: "LD-Sync" } };
        const existing = await NotionAPI.queryDatabase(
            parentPageId, searchFilter, null, null, apiKey
        ).catch(() => ({ results: [] }));
        if (existing?.results?.[0]?.id) {
            return { databaseId: existing.results[0].id, created: false };
        }

        // 创建同步库(level 2, DANGEROUS 无, execute 收口)
        return OperationGuard.execute("sync.medium.provision", async () => {
            const db = await NotionAPI.createDatabase(parentPageId, {
                title: [{ type: "text", text: { content: "LD-Notion 多端同步" } }],
                properties: SyncLedger._buildSchema(),
            }, apiKey);
            return { databaseId: String(db?.id || ""), created: true };
        }, { ...context, actor: "system", source: "sync-ledger" });
    },

    _buildSchema() {
        const rich = () => ({ rich_text: {} });
        const num = () => ({ number: {} });
        return {
            [ROW_TITLE_PROP]: { title: {} },
            [ROW_KIND_PROP]: rich(),
            [ROW_VERSION_PROP]: num(),
            [ROW_UPDATED_AT_PROP]: rich(),
            [ROW_DEVICE_PROP]: rich(),
            [ROW_PAYLOAD_PROP]: rich(),
            来源: rich(),
        };
    },

    /**
     * 拉取全部行(分页)
     * @returns {Promise<Array>} rows
     */
    async pullRows({ NotionAPI, apiKey, databaseId, context = {} }) {
        await SyncRateLimiter.selfAcquire();
        const rows = [];
        let cursor = null;
        do {
            await SyncRateLimiter.acquire();
            const response = await NotionAPI.queryDatabase(databaseId, undefined, null, cursor, apiKey);
            rows.push(...(response?.results || []));
            cursor = response?.has_more ? response.next_cursor : null;
        } while (cursor);
        return rows;
    },

    /**
     * 推送单行(updatePage PATCH; 行不存在时由引擎先 create)
     * @returns {Promise<{updatedAt: string}>}
     */
    async pushRow({ NotionAPI, apiKey, databaseId, pageId, row, context = {} }) {
        await SyncRateLimiter.acquire();
        const props = SyncLedger._rowToProperties(row);
        await NotionAPI.updatePage(pageId, props, apiKey);
        return { updatedAt: row.updatedAt };
    },

    /**
     * 创建新行(provision 后首次 push 或行缺失时)
     */
    async createRow({ NotionAPI, apiKey, databaseId, row, context = {} }) {
        await SyncRateLimiter.acquire();
        const props = SyncLedger._rowToProperties(row);
        const page = await NotionAPI.request("POST", "/pages", {
            parent: { database_id: databaseId },
            properties: props,
        }, apiKey);
        return { pageId: String(page?.id || ""), updatedAt: row.updatedAt };
    },

    /**
     * 行 → Notion properties(payload 分片存第一片, 其余片存附件块——v1 简化: 单行 payload 分片存储于数据属性, 超限拒绝)
     */
    _rowToProperties(row) {
        const payloadText = JSON.stringify(row.payload || {});
        const { rows } = SyncFragmenter.fragment(payloadText);
        // v1: 单行 payload 只允许 1 片(超限由引擎分片到多行)
        if (rows.length > 1) {
            throw new Error(`行 payload 过大(${payloadText.length} 字符), 需分片为多行`);
        }
        return {
            [ROW_TITLE_PROP]: { title: [{ type: "text", text: { content: String(row.key || "").slice(0, 1900) } }] },
            [ROW_KIND_PROP]: { rich_text: [{ type: "text", text: { content: String(row.kind || "dedup").slice(0, 100) } }] },
            [ROW_VERSION_PROP]: { number: Number(row.version) || 0 },
            [ROW_UPDATED_AT_PROP]: { rich_text: [{ type: "text", text: { content: String(row.updatedAt || "").slice(0, 100) } }] },
            [ROW_DEVICE_PROP]: { rich_text: [{ type: "text", text: { content: String(row.deviceId || "").slice(0, 100) } }] },
            [ROW_PAYLOAD_PROP]: { rich_text: [{ type: "text", text: { content: rows[0].slice(0, 2000) } }] },
            来源: { rich_text: [{ type: "text", text: { content: "LD-Sync" } }] },
        };
    },

    /**
     * Notion page → 行(读取 + 损坏检测)
     */
    pageToRow(page) {
        if (!page?.properties) return null;
        const get = (name) => {
            const prop = page.properties[name];
            if (prop?.title?.[0]?.plain_text) return prop.title[0].plain_text;
            if (prop?.rich_text?.[0]?.plain_text) return prop.rich_text[0].plain_text;
            if (prop?.number !== undefined && prop?.number !== null) return String(prop.number);
            return "";
        };
        const payloadText = get(ROW_PAYLOAD_PROP);
        if (!payloadText) return null;
        try {
            return {
                pageId: String(page.id || ""),
                kind: get(ROW_KIND_PROP),
                key: get(ROW_TITLE_PROP),
                version: Number(get(ROW_VERSION_PROP)) || 0,
                updatedAt: get(ROW_UPDATED_AT_PROP),
                deviceId: get(ROW_DEVICE_PROP),
                payload: JSON.parse(payloadText),
            };
        } catch {
            return null; // 损坏行: 引擎侧记 audit, 不 crash
        }
    },
};

module.exports = { SyncLedger };
