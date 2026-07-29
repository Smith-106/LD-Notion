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
