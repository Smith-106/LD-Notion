"use strict";

// P2 共识回归第七批: SyncFragmenter 行头预算/混合行 + SyncEngine 陈旧 dedup 行清理
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { SyncFragmenter } = require("../src/sync/SyncFragmenter");
const { SyncEngine } = require("../src/sync/SyncEngine");
const { SyncConstants } = require("../src/sync/constants");

describe("P2 共识: SyncFragmenter 分片行头", () => {
    it("每个分片行不超过 chunkChars(含行头)", () => {
        const text = "x".repeat(50000);
        const { rows } = SyncFragmenter.fragment(text, { chunkChars: 2000 });
        expect(rows.length).toBeGreaterThan(1);
        for (const row of rows) expect(row.length).toBeLessThanOrEqual(2000);
    });

    it("多行分片往返一致", () => {
        const text = "中文-".repeat(3000);
        const { rows } = SyncFragmenter.fragment(text);
        const back = SyncFragmenter.defragment(rows);
        expect(back.ok).toBe(true);
        expect(back.text).toBe(text);
    });

    it("分片行与非分片行混入 → 报错(不再静默拼接)", () => {
        const { rows } = SyncFragmenter.fragment("y".repeat(50000));
        const mixed = [rows[0], "plain-row"];
        const result = SyncFragmenter.defragment(mixed);
        expect(result.ok).toBe(false);
        expect(String(result.error)).toContain("格式不一致");
    });

    it("纯非分片多行仍原样拼接", () => {
        const result = SyncFragmenter.defragment(["a", "b"]);
        expect(result).toEqual({ ok: true, text: "ab" });
    });
});

describe("P2 共识: 陈旧 dedup 行清理", () => {
    const savedDeps = SyncEngine._deps;
    const savedEnabled = SyncConfigEnabled();

    function SyncConfigEnabled() {
        const { SyncConfig } = require("../src/sync/SyncConfig");
        return SyncConfig.isEnabled();
    }

    beforeEach(() => {
        const { SyncConfig } = require("../src/sync/SyncConfig");
        SyncConfig.setEnabled(true);
        SyncEngine._running = false;
        SyncEngine._pending = null;
    });

    afterEach(() => {
        SyncEngine._deps = savedDeps;
        const { SyncConfig } = require("../src/sync/SyncConfig");
        SyncConfig.setEnabled(savedEnabled);
        SyncConfig.setDatabaseId("");
    });

    it("源行内条目全部过期且本轮无投影 → 用空集重写该行", async () => {
        const { SyncConfig } = require("../src/sync/SyncConfig");
        SyncConfig.setDatabaseId("22222222222222222222222222222222");
        const expired = Date.now() - SyncConstants.TS_PAST_TTL_MS - 86400000;
        const pushed = [];
        SyncEngine._deps = {
            Storage: { get: () => undefined },
            SyncStateV2: { getSourceState: () => ({ epoch: 0 }), getSettingsStamps: () => ({}), setSettingsStamps: () => {} },
            DedupStore: { getSeen: () => ({}) },
            NotionAPI: {},
            OperationGuard: { canExecute: () => true, execute: async (_op, fn) => fn() },
            OperationLog: { add: () => {} },
            apiKeyProvider: () => "key",
        };
        const { SyncLedger } = require("../src/sync/SyncLedger");
        vi.spyOn(SyncLedger, "pullRows").mockResolvedValue([
            {
                id: "page-old",
                properties: {
                    键: { title: [{ plain_text: "zhihu" }] },
                    类型: { rich_text: [{ plain_text: "dedup" }] },
                    版本: { number: 0 },
                    更新时间: { rich_text: [{ plain_text: "2026-01-01T00:00:00.000Z" }] },
                    设备: { rich_text: [{ plain_text: "dev" }] },
                    数据: { rich_text: [{ plain_text: JSON.stringify({ dedup: { zhihu: { "zhihu:1": expired } } }) }] },
                },
            },
        ]);
        const pushRow = vi.spyOn(SyncLedger, "pushRow").mockImplementation(async (args) => { pushed.push(args); });
        const createRow = vi.spyOn(SyncLedger, "createRow").mockResolvedValue({});
        vi.spyOn(SyncLedger, "pageToRow").mockImplementation((page) => {
            const get = (name) => page.properties[name]?.rich_text?.[0]?.plain_text
                || page.properties[name]?.title?.[0]?.plain_text || "";
            return {
                pageId: page.id,
                kind: get("类型"),
                key: get("键"),
                version: Number(get("版本")) || 0,
                updatedAt: get("更新时间"),
                deviceId: get("设备"),
                payload: JSON.parse(get("数据")),
            };
        });

        const result = await SyncEngine.push({ reason: "test" });
        expect(result.ok).toBe(true);
        const stale = pushed.find((p) => p.pageId === "page-old");
        expect(stale).toBeTruthy();
        expect(stale.row.payload.dedup.zhihu).toEqual({});

        vi.restoreAllMocks();
    });
});
