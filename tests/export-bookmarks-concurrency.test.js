import { describe, it, expect, vi, beforeEach } from "vitest";

// 拦截重度外部依赖，使 exportBookmarks 的并发调度逻辑可被孤立验证
vi.mock("../src/storage", () => ({
    Storage: {
        get: () => 0, // 无请求间隔
        markTopicExported: vi.fn(),
    },
    SyncState: {},
}));

vi.mock("../src/sync-lock", () => ({
    SyncLock: {
        _exporting: false,
        get isExporting() {
            return this._exporting;
        },
        set isExporting(val) {
            this._exporting = Boolean(val);
        },
        // v3.14.18 (D2): 租约三方法内存版(纯函数, 测试用 vi.spyOn 包装打桩), 供租约契约测试
        __leaseStore: {},
        acquireLease: async function (key) {
            const s = this.__leaseStore;
            if (s[key] && s[key].expiresAt > Date.now()) return null;
            s[key] = { owner: `owner-${Math.random().toString(36).slice(2)}`, expiresAt: Date.now() + 60000 };
            return s[key];
        },
        renewLease: function (key, lease) { return lease; },
        releaseLease: function (key, lease) {
            const s = this.__leaseStore;
            if (s[key] && lease && s[key].owner === lease.owner) delete s[key];
        },
    },
}));

const { GenericExporter, Exporter } = require("../src/export/index");

describe("AT-011: exportBookmarks 并发调度 (ISS-017)", () => {
    // 每个用例前重置 Exporter 的内部状态
    beforeEach(() => {
        Exporter.reset();
        Exporter.isPaused = false;
        Exporter.isCancelled = false;
    });

    it("concurrency=N 时不遗漏、不重复任何书签", async () => {
        const N = 10;
        const bookmarks = Array.from({ length: N }, (_, i) => ({
            topic_id: `t${i}`,
            title: `帖子 ${i}`,
        }));

        let calls = 0;
        const seen = new Set();
        Exporter.exportTopic = vi.fn(async (b) => {
            calls++;
            seen.add(b.topic_id);
        });

        const results = await Exporter.exportBookmarks(
            bookmarks,
            { concurrency: 3 },
            undefined,
            0
        );

        expect(calls).toBe(N);
        expect(results.success).toHaveLength(N);
        expect(seen.size).toBe(N); // 无重复
        // 全部成功，无失败/跳过
        expect(results.failed).toHaveLength(0);
        expect(results.skipped).toHaveLength(0);
    });

    it("同时在飞的 exportTopic 数量不超过 concurrency 上限", async () => {
        const N = 12;
        const concurrency = 3;
        const bookmarks = Array.from({ length: N }, (_, i) => ({
            topic_id: `t${i}`,
            title: `帖子 ${i}`,
        }));

        let inflight = 0;
        let maxInflight = 0;
        Exporter.exportTopic = vi.fn(async () => {
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            // 耗时远大于 worker 错开启动间隔(100ms)，确保并发窗口真正重叠
            await new Promise((r) => setTimeout(r, 300));
            inflight--;
        });

        await Exporter.exportBookmarks(
            bookmarks,
            { concurrency },
            undefined,
            0
        );

        expect(maxInflight).toBeGreaterThan(1); // 确实验证到了并发
        expect(maxInflight).toBeLessThanOrEqual(concurrency);
    });

    it("concurrency=1 时严格串行 (maxInflight === 1)", async () => {
        const N = 5;
        const bookmarks = Array.from({ length: N }, (_, i) => ({
            topic_id: `t${i}`,
            title: `帖子 ${i}`,
        }));

        let inflight = 0;
        let maxInflight = 0;
        Exporter.exportTopic = vi.fn(async () => {
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            await new Promise((r) => setTimeout(r, 10));
            inflight--;
        });

        await Exporter.exportBookmarks(
            bookmarks,
            { concurrency: 1 },
            undefined,
            0
        );

        expect(maxInflight).toBe(1);
    });

    it("中途 cancel 后，已完成进入 success，剩余进入 skipped", async () => {
        const N = 8;
        const bookmarks = Array.from({ length: N }, (_, i) => ({
            topic_id: `t${i}`,
            title: `帖子 ${i}`,
        }));

        let count = 0;
        Exporter.exportTopic = vi.fn(async () => {
            count++;
            // 处理第 2 个后触发取消
            if (count === 2) {
                Exporter.cancel();
            }
            await new Promise((r) => setTimeout(r, 5));
        });

        const results = await Exporter.exportBookmarks(
            bookmarks,
            { concurrency: 1 },
            undefined,
            0
        );

        // 已完成的 2 个 success，其余 6 个 skipped
        expect(results.success.length + results.skipped.length).toBe(N);
        expect(results.success.length).toBe(2);
        expect(results.skipped.length).toBe(N - 2);
    });

    it("从 startIndex 续传时只处理后续书签", async () => {
        const N = 6;
        const bookmarks = Array.from({ length: N }, (_, i) => ({
            topic_id: `t${i}`,
            title: `帖子 ${i}`,
        }));

        const seen = [];
        Exporter.exportTopic = vi.fn(async (b) => {
            seen.push(b.topic_id);
        });

        const startIndex = 3;
        const results = await Exporter.exportBookmarks(
            bookmarks,
            { concurrency: 2 },
            undefined,
            startIndex
        );

        expect(seen).toEqual(["t3", "t4", "t5"]);
        expect(results.success).toHaveLength(N - startIndex);
    });
});

describe("D2: 手动导出跨 tab 租约 (CC-04 补全, 与自动同步互斥)", () => {
    const { SyncLock } = require("../src/sync-lock");
    const LEASE_KEY = "ldb_auto_sync_lease";
    const mkBookmarks = (n) => Array.from({ length: n }, (_, i) => ({ topic_id: `t${i}`, title: `P${i}` }));

    beforeEach(() => {
        vi.restoreAllMocks();
        SyncLock.__leaseStore = {};
        Exporter.reset();
        Exporter.isPaused = false;
        Exporter.isCancelled = false;
    });

    it("导出全程持有租约, 结束后释放(另一 tab 可接续)", async () => {
        const acquire = vi.spyOn(SyncLock, "acquireLease");
        const release = vi.spyOn(SyncLock, "releaseLease");
        Exporter.exportTopic = vi.fn(async () => {});
        const results = await Exporter.exportBookmarks(mkBookmarks(3), { concurrency: 1 }, undefined, 0);
        expect(results.success).toHaveLength(3);
        expect(acquire).toHaveBeenCalledWith(LEASE_KEY);
        expect(release).toHaveBeenCalledWith(LEASE_KEY, expect.objectContaining({ owner: expect.any(String) }));
        // 释放后 store 已清空(他 tab 可接续)
        expect(SyncLock.__leaseStore[LEASE_KEY]).toBeUndefined();
    });

    it("租约被他 tab 持有时: 全量 skipped, 不执行任何导出", async () => {
        vi.spyOn(SyncLock, "acquireLease").mockResolvedValue(null);
        Exporter.exportTopic = vi.fn(async () => {});
        const results = await Exporter.exportBookmarks(mkBookmarks(4), { concurrency: 1 }, undefined, 0);
        expect(results.success).toHaveLength(0);
        expect(results.failed).toHaveLength(0);
        expect(results.skipped).toHaveLength(4);
        expect(results.message).toContain("其他标签页");
        expect(Exporter.exportTopic).not.toHaveBeenCalled();
        expect(SyncLock.isExporting).toBe(false);
    });

    it("续约失配(被他 tab 抢占)置 leaseLost 中止批次, 剩余项进 skipped", async () => {
        vi.useFakeTimers();
        try {
            vi.spyOn(SyncLock, "renewLease").mockReturnValue(false); // 续约即失配(模拟他 tab 抢占)
            let count = 0;
            Exporter.exportTopic = vi.fn(async () => {
                count++;
                await new Promise((r) => setTimeout(r, 60000)); // 挂起首项, 留出续约窗口
            });
            const promise = Exporter.exportBookmarks(mkBookmarks(5), { concurrency: 1 }, undefined, 0);
            await vi.advanceTimersByTimeAsync(31000); // 仅 30s 续约器触发 → leaseLost
            await vi.advanceTimersByTimeAsync(31000); // 60s 项目完成 → worker 顶部检查 leaseLost → 中止
            const results = await promise;
            expect(count).toBe(1); // 第 1 项后续约失配中止
            expect(results.leaseLost).toBe(true);
            expect(results.success).toHaveLength(1);
            expect(results.skipped).toHaveLength(4);
            expect(SyncLock.isExporting).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});
