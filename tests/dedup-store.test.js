"use strict";

import { describe, it, expect, beforeEach, vi } from "vitest";
const { DedupStore } = require("../src/storage/DedupStore");

const SOURCE = "test-source";

/**
 * DedupStore 是模块级单例对象，batch 状态 (_batchCache / _batchSourceType)
 * 在测试间可能残留。每个 beforeEach 中重置 batch 状态 + GM mock 调用计数。
 */
function resetDedupStore() {
    // 等效于 endBatch 但不触发 flush
    DedupStore._batchCache = null;
    DedupStore._batchSourceType = null;
}

describe("AT-002: DedupStore 批量模式与单条模式", () => {
    beforeEach(() => {
        resetDedupStore();
        DedupStore.clearSeen(SOURCE);
        vi.clearAllMocks();
    });

    // ---- Non-batch mode ----

    it("Non-batch: isDuplicate for unseen key returns false", () => {
        expect(DedupStore.isDuplicate(SOURCE, "key-1")).toBe(false);
    });

    it("Non-batch: markSeen then isDuplicate returns true", () => {
        DedupStore.markSeen(SOURCE, "key-1");
        expect(DedupStore.isDuplicate(SOURCE, "key-1")).toBe(true);
    });

    it("Non-batch: isDuplicate calls GM_getValue each time", () => {
        const gmGetSpy = vi.spyOn(globalThis, "GM_getValue");
        DedupStore.isDuplicate(SOURCE, "a");
        DedupStore.isDuplicate(SOURCE, "b");
        DedupStore.isDuplicate(SOURCE, "c");
        expect(gmGetSpy).toHaveBeenCalledTimes(3);
        gmGetSpy.mockRestore();
    });

    it("Non-batch: markSeen calls GM_setValue each time", () => {
        const gmSetSpy = vi.spyOn(globalThis, "GM_setValue");
        DedupStore.markSeen(SOURCE, "a");
        DedupStore.markSeen(SOURCE, "b");
        expect(gmSetSpy).toHaveBeenCalledTimes(2);
        gmSetSpy.mockRestore();
    });

    // ---- Batch mode ----

    it("Batch: beginBatch loads existing set from GM_getValue", () => {
        // 预存数据
        const preKey = DedupStore._keyFor(SOURCE);
        globalThis.GM_setValue(preKey, JSON.stringify({ "existing-key": 1000 }));

        DedupStore.beginBatch(SOURCE);
        expect(DedupStore._batchCache).not.toBeNull();
        expect(DedupStore._batchCache.set).toEqual({ "existing-key": 1000 });

        DedupStore.endBatch();
    });

    it("Batch: isDuplicate reads from memory cache, not GM_getValue", () => {
        DedupStore.beginBatch(SOURCE);
        const gmGetSpy = vi.spyOn(globalThis, "GM_getValue");

        DedupStore.isDuplicate(SOURCE, "cached-key");

        // batch 模式下 isDuplicate 不应调用 GM_getValue
        expect(gmGetSpy).not.toHaveBeenCalled();

        gmGetSpy.mockRestore();
        DedupStore.endBatch();
    });

    it("Batch: markSeen writes to memory cache + sets dirty flag", () => {
        DedupStore.beginBatch(SOURCE);
        const gmSetSpy = vi.spyOn(globalThis, "GM_setValue");

        DedupStore.markSeen(SOURCE, "batch-key");

        // 写入内存缓存
        expect("batch-key" in DedupStore._batchCache.set).toBe(true);
        // dirty 标记置位
        expect(DedupStore._batchCache.dirty).toBe(true);
        // 不应调用 GM_setValue
        expect(gmSetSpy).not.toHaveBeenCalled();

        gmSetSpy.mockRestore();
        DedupStore.endBatch();
    });

    it("Batch: endBatch with dirty=true flushes to GM_setValue once", () => {
        DedupStore.beginBatch(SOURCE);
        DedupStore.markSeen(SOURCE, "dirty-key");

        const gmSetSpy = vi.spyOn(globalThis, "GM_setValue");
        DedupStore.endBatch();

        expect(gmSetSpy).toHaveBeenCalledTimes(1);

        gmSetSpy.mockRestore();
    });

    it("Batch: endBatch with dirty=false does NOT call GM_setValue", () => {
        DedupStore.beginBatch(SOURCE);
        // 未调用 markSeen，dirty 仍为 false

        const gmSetSpy = vi.spyOn(globalThis, "GM_setValue");
        DedupStore.endBatch();

        expect(gmSetSpy).not.toHaveBeenCalled();

        gmSetSpy.mockRestore();
    });

    it("Batch: multiple markSeen → single GM_setValue call on endBatch", () => {
        DedupStore.beginBatch(SOURCE);

        DedupStore.markSeen(SOURCE, "k1");
        DedupStore.markSeen(SOURCE, "k2");
        DedupStore.markSeen(SOURCE, "k3");

        const gmSetSpy = vi.spyOn(globalThis, "GM_setValue");
        DedupStore.endBatch();

        // 三次 markSeen 只在 endBatch 时触发一次 GM_setValue
        expect(gmSetSpy).toHaveBeenCalledTimes(1);

        gmSetSpy.mockRestore();
    });

    // ---- clearSeen / getSeen ----

    it("clearSeen: removes dedup set from memory + GM_deleteValue", () => {
        DedupStore.markSeen(SOURCE, "to-clear");

        const gmDeleteSpy = vi.spyOn(globalThis, "GM_deleteValue");
        DedupStore.clearSeen(SOURCE);

        // GM_deleteValue 被调用
        expect(gmDeleteSpy).toHaveBeenCalledTimes(1);
        // 后续 isDuplicate 应返回 false
        expect(DedupStore.isDuplicate(SOURCE, "to-clear")).toBe(false);

        gmDeleteSpy.mockRestore();
    });

    it("getSeen: returns dedup set for source", () => {
        DedupStore.markSeen(SOURCE, "ga");
        DedupStore.markSeen(SOURCE, "gb");

        const seen = DedupStore.getSeen(SOURCE);
        expect("ga" in seen).toBe(true);
        expect("gb" in seen).toBe(true);
        expect(Object.keys(seen).length).toBe(2);
    });

    // ---- Edge cases ----

    it("Edge: calling endBatch without beginBatch works as no-op", () => {
        resetDedupStore(); // 确保没有活跃 batch

        const gmSetSpy = vi.spyOn(globalThis, "GM_setValue");

        // 不应抛错，也不应调用 GM_setValue
        expect(() => DedupStore.endBatch()).not.toThrow();
        expect(gmSetSpy).not.toHaveBeenCalled();

        gmSetSpy.mockRestore();
    });
});
