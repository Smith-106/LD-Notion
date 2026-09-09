"use strict";

// P2 共识回归: SyncState 迁移/水位/远端覆盖 + SyncLedger provision/多段文本/游标
import { describe, it, expect, beforeEach } from "vitest";

const { CONFIG } = require("../src/config");
const { SyncStateV2 } = require("../src/storage/SyncState");
const { SyncLedger } = require("../src/sync/SyncLedger");
const { SyncRateLimiter } = require("../src/sync/SyncRateLimiter");

const KEY = CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE;

const resetState = () => {
    GM_deleteValue(KEY);
    SyncStateV2._cache = null;
    SyncStateV2._dirty = false;
    SyncStateV2._savePending = false;
    if (SyncStateV2._saveTimerId) clearTimeout(SyncStateV2._saveTimerId);
    SyncStateV2._saveTimerId = null;
};

beforeEach(resetState);

describe("P2 共识: SyncState V1 迁移", () => {
    it("无 version/无 linuxdo 的 V1 状态也必须迁移(watermark 不丢)", () => {
        const watermark = { time: "2026-01-01T00:00:00.000Z", ids: ["11", "22"] };
        GM_setValue(KEY, JSON.stringify({
            bookmarks: { watermark, lastSuccessAt: 1700000000000, lastOutcome: "success" },
            rss: { watermark: { time: "2026-02-02T00:00:00.000Z", ids: [] } },
        }));
        const bookmarkState = SyncStateV2.getSourceState("bookmark");
        expect(bookmarkState.watermark).toEqual(watermark);
        expect(SyncStateV2.getSourceState("rss").watermark.time).toBe("2026-02-02T00:00:00.000Z");
    });
});

describe("P2 共识: SyncState 远端覆盖与待写状态", () => {
    it("_cache 为 null 时 flush 不得写出 \"null\"", () => {
        GM_setValue(KEY, JSON.stringify({ version: 2, sources: { linuxdo: { watermark: { time: "2026-03-03T00:00:00.000Z", ids: [] } } } }));
        const before = GM_getValue(KEY);
        SyncStateV2._cache = null;
        SyncStateV2._dirty = true;
        SyncStateV2._flushSave();
        expect(GM_getValue(KEY)).toBe(before);
        expect(SyncStateV2._dirty).toBe(false);
    });

    it("updateSourceState 传入 snapshot: undefined 不得清空已有快照", () => {
        SyncStateV2.updateSourceState("bookmark", { snapshot: { a: 1 }, lastOutcome: "success" });
        SyncStateV2.updateSourceState("bookmark", { snapshot: undefined, lastOutcome: "partial" });
        const state = SyncStateV2.getSourceState("bookmark");
        expect(state.snapshot).toEqual({ a: 1 });
        expect(state.lastOutcome).toBe("partial");
    });

    it("buildWatermark 同刻 ids 超上限必须截断(防无界增长)", () => {
        const items = Array.from({ length: 600 }, (_, i) => ({ t: "2026-01-01T00:00:00.000Z", id: `id-${i}` }));
        const wm = SyncStateV2.buildWatermark(items, (i) => i.t, (i) => i.id);
        expect(wm.ids.length).toBe(500);
        expect(wm.time).toBe("2026-01-01T00:00:00.000Z");
    });
});

describe("P2 共识: SyncLedger provision 幂等", () => {
    const makeGuard = () => ({ execute: async (_op, fn) => fn() });
    const makeApi = (searchResults, onCreate) => ({
        search: async () => ({ results: searchResults }),
        createDatabase: async () => {
            onCreate.count += 1;
            return { id: "new-db" };
        },
    });

    it("已存在同名同父库 → 不新建", async () => {
        const created = { count: 0 };
        const api = makeApi([{
            object: "database",
            id: "existing-db",
            title: [{ plain_text: "LD-Notion 多端同步" }],
            parent: { page_id: "parent-1" },
        }], created);
        const result = await SyncLedger.provision({
            NotionAPI: api, OperationGuard: makeGuard(), apiKey: "k", parentPageId: "parent-1",
        });
        expect(result).toEqual({ databaseId: "existing-db", created: false });
        expect(created.count).toBe(0);
    });

    it("标题相同但父页面不同 → 仍需新建", async () => {
        const created = { count: 0 };
        const api = makeApi([{
            object: "database",
            id: "other-db",
            title: [{ plain_text: "LD-Notion 多端同步" }],
            parent: { page_id: "parent-2" },
        }], created);
        const result = await SyncLedger.provision({
            NotionAPI: api, OperationGuard: makeGuard(), apiKey: "k", parentPageId: "parent-1",
        });
        expect(result).toEqual({ databaseId: "new-db", created: true });
        expect(created.count).toBe(1);
    });

    it("搜索无结果 → 新建一次", async () => {
        const created = { count: 0 };
        const api = makeApi([], created);
        const result = await SyncLedger.provision({
            NotionAPI: api, OperationGuard: makeGuard(), apiKey: "k", parentPageId: "parent-1",
        });
        expect(result).toEqual({ databaseId: "new-db", created: true });
        expect(created.count).toBe(1);
    });
});

describe("P2 共识: SyncLedger 行读写", () => {
    it("pageToRow 必须拼接多段 rich_text(否则 JSON 残缺整行丢弃)", () => {
        const payload = JSON.stringify({ dedup: { linuxdo: { a: 1 } } });
        const half = Math.floor(payload.length / 2);
        const row = SyncLedger.pageToRow({
            id: "page-1",
            properties: {
                键: { title: [{ plain_text: "linuxdo" }] },
                类型: { rich_text: [{ plain_text: "dedup" }] },
                版本: { number: 2 },
                更新时间: { rich_text: [{ plain_text: "2026-01-01T00:00:00.000Z" }] },
                设备: { rich_text: [{ plain_text: "dev-1" }] },
                数据: { rich_text: [{ plain_text: payload.slice(0, half) }, { plain_text: payload.slice(half) }] },
            },
        });
        expect(row).not.toBeNull();
        expect(row.payload).toEqual({ dedup: { linuxdo: { a: 1 } } });
    });

    it("pullRows 游标不前进时必须终止(防死循环)", async () => {
        SyncRateLimiter._tokens = 100;
        let calls = 0;
        const api = {
            queryDatabase: async () => {
                calls += 1;
                return { results: [{ id: `r${calls}` }], has_more: true, next_cursor: "same" };
            },
        };
        const rows = await SyncLedger.pullRows({ NotionAPI: api, apiKey: "k", databaseId: "db" });
        expect(calls).toBeLessThanOrEqual(2);
        expect(rows.length).toBe(calls);
    });
});
