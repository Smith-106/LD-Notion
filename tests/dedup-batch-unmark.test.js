"use strict";

import { describe, it, expect, beforeEach } from "vitest";
const { DedupStore } = require("../src/storage/DedupStore");

/**
 * Batch unmarkSeen + endBatch rebase 契约:
 * 旧实现只从 cache.set 删键, endBatch 全量并集 fresh∪cache → 盘上旧键复活
 * (「重新导出」后刷新仍显示已导出 / 自动去重跳过)。
 */
describe("DedupStore batch unmarkSeen 墓碑 (beyond #17/#18 clearSeen wiped)", () => {
    const SRC = "linuxdo";

    beforeEach(() => {
        DedupStore._batchCaches = {};
        DedupStore.clearSeen(SRC);
    });

    it("batch 内 unmarkSeen 后 endBatch 不得复活盘上键", () => {
        DedupStore.markSeen(SRC, "topic-42");
        expect(DedupStore.isDuplicate(SRC, "topic-42")).toBe(true);

        DedupStore.beginBatch(SRC);
        DedupStore.unmarkSeen(SRC, "topic-42");
        // 同批另有 mark(制造 dirty), 模拟对账回填/自动同步边写边删
        DedupStore.markSeen(SRC, "topic-99");
        DedupStore.endBatch(SRC);

        expect(DedupStore.isDuplicate(SRC, "topic-42")).toBe(false);
        expect(DedupStore.isDuplicate(SRC, "topic-99")).toBe(true);
        const raw = JSON.parse(globalThis.GM_getValue(DedupStore.keyFor(SRC), "{}"));
        expect(raw["topic-42"]).toBeUndefined();
        expect(raw["topic-99"]).toBeGreaterThan(0);
    });

    it("batch 快照外的键也可经墓碑删除(unmark 时键不在 cache.set)", () => {
        DedupStore.beginBatch(SRC);
        // 模拟他处/先前落盘: 直接写 GM, 不在本批 set 里… 但 begin 已加载。
        // 更强场景: begin 后外部写入, 再 unmark 该新键
        const key = DedupStore.keyFor(SRC);
        const fresh = JSON.parse(globalThis.GM_getValue(key, "{}"));
        fresh["external-only"] = 1000;
        globalThis.GM_setValue(key, JSON.stringify(fresh));

        DedupStore.unmarkSeen(SRC, "external-only");
        DedupStore.markSeen(SRC, "local-new");
        DedupStore.endBatch(SRC);

        expect(DedupStore.isDuplicate(SRC, "external-only")).toBe(false);
        expect(DedupStore.isDuplicate(SRC, "local-new")).toBe(true);
    });

    it("markSeen 在同批 unmark 之后可再次落账(墓碑撤销)", () => {
        DedupStore.markSeen(SRC, "topic-7");
        DedupStore.beginBatch(SRC);
        DedupStore.unmarkSeen(SRC, "topic-7");
        DedupStore.markSeen(SRC, "topic-7");
        DedupStore.endBatch(SRC);
        expect(DedupStore.isDuplicate(SRC, "topic-7")).toBe(true);
    });

    it("urlKeyed 源 unmark 同时清除哈希键", () => {
        const urlSrc = "bookmark";
        DedupStore._batchCaches = {};
        DedupStore.clearSeen(urlSrc);
        DedupStore.markSeen(urlSrc, "bookmark:abc");
        DedupStore.beginBatch(urlSrc);
        DedupStore.unmarkSeen(urlSrc, "bookmark:abc");
        DedupStore.markSeen(urlSrc, "bookmark:other");
        DedupStore.endBatch(urlSrc);
        expect(DedupStore.isDuplicate(urlSrc, "bookmark:abc")).toBe(false);
        expect(DedupStore.isDuplicate(urlSrc, "bookmark:other")).toBe(true);
    });
});
