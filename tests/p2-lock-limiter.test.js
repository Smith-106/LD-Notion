"use strict";

// P2 共识回归第六批: SyncRateLimiter.schedule 分槽/异常 settle + SyncLock 无 GM 降级按 key
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { SyncRateLimiter } = require("../src/sync/SyncRateLimiter");
const { SyncLock } = require("../src/sync-lock");

describe("P2 共识: SyncRateLimiter.schedule", () => {
    beforeEach(() => SyncRateLimiter._reset());
    afterEach(() => SyncRateLimiter._reset());

    it("不同 key 互不覆盖, 两个 promise 都 settle", async () => {
        const a = SyncRateLimiter.schedule("keyA", async () => "A", { windowMs: 10 });
        const b = SyncRateLimiter.schedule("keyB", async () => "B", { windowMs: 10 });
        await expect(a).resolves.toBe("A");
        await expect(b).resolves.toBe("B");
    });

    it("同 key 窗口内合并为最后一次执行体, 共享同一 promise", async () => {
        const first = SyncRateLimiter.schedule("k", async () => "first", { windowMs: 20 });
        const second = SyncRateLimiter.schedule("k", async () => "second", { windowMs: 20 });
        expect(second).toBe(first);
        await expect(first).resolves.toBe("second");
    });

    it("fn 同步抛错 → promise reject(不永久挂起)", async () => {
        const p = SyncRateLimiter.schedule("boom", () => { throw new Error("sync-throw"); }, { windowMs: 10 });
        await expect(p).rejects.toThrow("sync-throw");
    });

    it("超过 maxWaitMs 立即冲刷, 不再等满窗口", async () => {
        const start = Date.now();
        const p = SyncRateLimiter.schedule("k2", async () => "ok", { windowMs: 60000, maxWaitMs: 0 });
        await expect(p).resolves.toBe("ok");
        expect(Date.now() - start).toBeLessThan(1000);
    });

    it("_reset 清空防抖槽且旧定时器不再执行", async () => {
        const fn = vi.fn(async () => "x");
        SyncRateLimiter.schedule("k3", fn, { windowMs: 10 });
        SyncRateLimiter._reset();
        await new Promise((r) => setTimeout(r, 40));
        expect(fn).not.toHaveBeenCalled();
    });
});

describe("P2 共识: SyncLock 无 GM 降级按 key 互斥", () => {
    const saved = { get: global.GM_getValue, set: global.GM_setValue };

    beforeEach(() => {
        delete global.GM_getValue;
        delete global.GM_setValue;
        SyncLock._localLeases = new Map();
        SyncLock.isExporting = false;
    });
    afterEach(() => {
        global.GM_getValue = saved.get;
        global.GM_setValue = saved.set;
        SyncLock._localLeases = new Map();
        SyncLock.isExporting = false;
    });

    it("不同 key 可同时持有; 同 key 第二者被拒", async () => {
        const a = await SyncLock.acquireLease("lease:a");
        const b = await SyncLock.acquireLease("lease:b");
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(await SyncLock.acquireLease("lease:a")).toBeNull();
    });

    it("释放只影响自己的 key", async () => {
        const a = await SyncLock.acquireLease("lease:a");
        const b = await SyncLock.acquireLease("lease:b");
        SyncLock.releaseLease("lease:a", a);
        expect(await SyncLock.acquireLease("lease:a")).not.toBeNull();
        expect(SyncLock._localLeases.has("lease:b")).toBe(true);
        SyncLock.releaseLease("lease:b", b);
        expect(SyncLock._localLeases.has("lease:b")).toBe(false);
    });

    it("非持有者释放不删除他人租约", async () => {
        const a = await SyncLock.acquireLease("lease:c");
        SyncLock.releaseLease("lease:c", { owner: "other" });
        expect(SyncLock._localLeases.get("lease:c")).toBe(a);
    });
});
