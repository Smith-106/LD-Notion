import { describe, it, expect, beforeEach } from "vitest";

// ISS-20260728-017 (PERF-002): BookmarkExporter.exportBookmarks 串行 for+await+sleep
// 改为 CONCURRENCY=3 分批并发(对齐 BookmarkAutoImporter.processInBatches)。
// 本文件验证并发窗口、失败隔离、认证终态 fail-fast 与进度回调语义。
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter.js");
const { NotionAPI } = require("../src/api");
const { Storage } = require("../src/storage");
const { OperationGuard, OperationLog } = require("../src/security");
const { Utils } = require("../src/utils");
const { CONFIG } = require("../src/config");

const mkBookmarks = (n) => Array.from({ length: n }, (_, i) => ({
    url: `https://site-${i}.com/p${i}`,
    title: `书签 ${i}`,
}));

// 默认环境桩: 严格去重关(跳过远端对账)、无 AI、无延迟、guard 放行、账本空
const stubEnv = () => {
    Utils.isBookmarkDedupStrict = () => false;
    Storage.get = (key, d) => (key === CONFIG.STORAGE_KEYS.REQUEST_DELAY ? 0 : d);
    Storage.set = () => {};
    BookmarkExporter.setupDatabaseProperties = async () => ({ success: true });
    BookmarkExporter.getExported = () => ({});
    BookmarkExporter.flushExported = () => {};
    BookmarkExporter.enrichBookmark = async (b) => ({ ...b, generatedTitle: b.title });
    BookmarkExporter.buildProperties = (b) => ({ "链接": { url: b.url } });
    OperationGuard.canExecute = () => true;
    OperationLog.add = () => {};
};

describe("BookmarkExporter.exportBookmarks 并发批处理 (ISS-017)", () => {
    beforeEach(() => {
        globalThis.GM_getValue = () => undefined;
        globalThis.GM_setValue = () => {};
        stubEnv();
    });

    it("同时在飞的建页请求不超过 CONCURRENCY=3", async () => {
        let inflight = 0, maxInflight = 0;
        NotionAPI.request = async (_m, path) => {
            if (path !== "/pages") throw new Error(`unexpected ${path}`);
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            await new Promise((r) => setTimeout(r, 30));
            inflight--;
            return { id: "p" };
        };
        const result = await BookmarkExporter.exportBookmarks(
            { apiKey: "tok", databaseId: "db", bookmarks: mkBookmarks(10) }
        );
        expect(maxInflight).toBeGreaterThan(1);          // 确实并发
        expect(maxInflight).toBeLessThanOrEqual(3);      // 上限 3
        expect(result.exported).toBe(10);
        expect(result.failed).toBe(0);
    });

    it("全部书签处理完毕, 无遗漏/重复落账", async () => {
        const seen = new Set();
        NotionAPI.request = async (_m, path) => {
            if (path !== "/pages") throw new Error(`unexpected ${path}`);
            return { id: "p" };
        };
        // 用 pendingExported 捕获每个落账键
        const ledger = {};
        BookmarkExporter.getExported = () => ledger;
        const bookmarks = mkBookmarks(9);
        const result = await BookmarkExporter.exportBookmarks(
            { apiKey: "tok", databaseId: "db", bookmarks }
        );
        for (const b of bookmarks) seen.add(Utils.normalizeDedupUrl(b.url));
        expect(result.exported).toBe(9);
        expect(Object.keys(ledger)).toHaveLength(9);          // 9 项全部落账
        for (const k of seen) expect(ledger[k]).toBeTruthy();
        expect(result.newCount).toBe(9);
    });

    it("失败隔离:单项失败不影响同批与后续项", async () => {
        let i = -1;
        NotionAPI.request = async (_m, path) => {
            if (path !== "/pages") throw new Error(`unexpected ${path}`);
            i++;
            if (i === 1 || i === 4) throw new Error("transient 429"); // 非终态失败
            return { id: `p${i}` };
        };
        const result = await BookmarkExporter.exportBookmarks(
            { apiKey: "tok", databaseId: "db", bookmarks: mkBookmarks(7) }
        );
        expect(result.exported).toBe(5);
        expect(result.failed).toBe(2);
        expect(result.aborted).toBeUndefined();             // 非终态不中止
        expect(result.newCount).toBe(7);
    });

    it("认证终态 fail-fast:中止导出, 未开工项进 skipped", async () => {
        let call = 0;
        NotionAPI.request = async (_m, path) => {
            if (path !== "/pages") throw new Error(`unexpected ${path}`);
            call++;
            const err = new Error("401 unauthorized");
            err.isAuthTerminal = true;                        // 全部项都走终态分支
            throw err;
        };
        const result = await BookmarkExporter.exportBookmarks(
            { apiKey: "tok", databaseId: "db", bookmarks: mkBookmarks(8) }
        );
        // 首批 3 个并发均 hit 终态 → failed=3; 剩余 5 个未开工 → skipped=5
        expect(result.aborted).toBe(true);
        expect(call).toBe(3);                                // 只有首批真正发请求
        expect(result.failed).toBe(3);
        expect(result.skipped).toBe(5);
        expect(result.exported).toBe(0);
        expect(result.message).toContain("认证失败");
    });

    it("进度回调单调递增且覆盖全部条目", async () => {
        const progress = [];
        NotionAPI.request = async () => ({ id: "p" });
        await BookmarkExporter.exportBookmarks(
            { apiKey: "tok", databaseId: "db", bookmarks: mkBookmarks(6) },
            (msg, pct) => progress.push({ msg, pct })
        );
        // 6 项 + 开头 1 条"正在配置数据库结构" = 7 条
        expect(progress.length).toBe(7);
        const pcts = progress.map((p) => p.pct);
        expect(pcts[0]).toBe(0);                             // 配置阶段 0%
        // 其余进度单调不减(5→95 区间)
        for (let i = 1; i < pcts.length; i++) {
            expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
        }
    });

    it("批间节流:REQUEST_DELAY>0 时只在批间 sleep(批内并发不节流)", async () => {
        const sleeps = [];
        Storage.get = (key, d) => (key === CONFIG.STORAGE_KEYS.REQUEST_DELAY ? 100 : d);
        const origSleep = Utils.sleep;
        Utils.sleep = async (ms) => { sleeps.push(ms); };
        try {
            NotionAPI.request = async () => ({ id: "p" });
            await BookmarkExporter.exportBookmarks(
                { apiKey: "tok", databaseId: "db", bookmarks: mkBookmarks(10) }
            );
            // 10 项 / 3 = 4 批,批间 sleep 3 次
            expect(sleeps).toHaveLength(3);
            expect(sleeps.every((ms) => ms === 100)).toBe(true);
        } finally {
            Utils.sleep = origSleep;
        }
    });
});
