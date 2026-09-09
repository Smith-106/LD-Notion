"use strict";

// P1 三模型共识(qwen3.8-flash + deepseek-v4-flash)确认的异步/竞态缺陷回归测试。
// 模式: 真实模块 + GM mock(与 update-token-failfast.test.js 一致)。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;
global.GM_notification = () => {};

const { CONFIG } = require("../src/config");
const { Storage } = require("../src/storage");
const { SyncState } = require("../src/storage");
const { SyncLock } = require("../src/sync-lock");
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
const { BookmarkBridge } = require("../src/bridge/index");
const { BookmarkAutoImporter } = require("../src/bridge/BookmarkAutoImporter");
const { NotionAPI } = require("../src/api");
const { SyncScheduler } = require("../src/adapter/SyncScheduler");

beforeEach(() => {
    store.clear();
    BookmarkAutoImporter.isRunning = false;
    BookmarkAutoImporter.lastRunAt = 0;
    vi.restoreAllMocks();
});

describe("P1 共识: 同轮「删除旧书签 + 新增同 URL 书签」不得归档在用页面", () => {
    const SAME_URL = "https://same.example.com/post";
    const newBookmark = { id: "new-2", title: "新标题", url: SAME_URL, folderPath: "", dateAdded: "2026-02-02T00:00:00.000Z" };
    const trackedPage = {
        pageId: "page-P",
        bookmarkId: "old-1",
        url: SAME_URL,
        title: "旧标题",
        folderPath: "",
        dateAdded: "2026-01-01T00:00:00.000Z",
        archived: false,
    };

    const stubRunDeps = () => {
        vi.spyOn(BookmarkBridge, "isExtensionAvailable").mockReturnValue(true);
        vi.spyOn(SyncLock, "acquireLease").mockResolvedValue({ owner: "test", expiresAt: Date.now() + 60000 });
        vi.spyOn(SyncLock, "renewLease").mockReturnValue(true);
        vi.spyOn(SyncLock, "releaseLease").mockReturnValue(undefined);
        vi.spyOn(BookmarkExporter, "setupDatabaseProperties").mockResolvedValue({ success: true });
        vi.spyOn(BookmarkExporter, "enrichBookmark").mockResolvedValue({});
        vi.spyOn(BookmarkExporter, "buildProperties").mockReturnValue({});
        vi.spyOn(BookmarkAutoImporter, "buildMinimalProperties").mockReturnValue({});
        vi.spyOn(BookmarkExporter, "markExported").mockReturnValue(undefined);
        vi.spyOn(BookmarkExporter, "flushExported").mockReturnValue(undefined);
        vi.spyOn(BookmarkAutoImporter, "loadCurrentBookmarks").mockResolvedValue([newBookmark]);
        vi.spyOn(BookmarkAutoImporter, "fetchTrackedPages").mockResolvedValue([trackedPage]);
    };

    it("新书签经 byUrl 接管旧页后, 旧 id 的归档流程不得 deletePage", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_test");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "db1");
        SyncState.updateSourceState("bookmark", {
            snapshot: {
                "old-1": { pageId: "page-P", url: SAME_URL, title: "旧标题", folderPath: "", dateAdded: "2026-01-01T00:00:00.000Z" },
            },
        });
        stubRunDeps();
        const updateSpy = vi.spyOn(NotionAPI, "updatePage").mockResolvedValue({});
        const deleteSpy = vi.spyOn(NotionAPI, "deletePage").mockResolvedValue({});

        await BookmarkAutoImporter.run();

        // 旧页已被新书签接管 → 更新而非归档
        expect(updateSpy).toHaveBeenCalledWith("page-P", expect.anything(), "secret_test");
        expect(deleteSpy).not.toHaveBeenCalled();
        // 快照: 新 id 继续跟踪该页, 旧 id 被移除
        const state = SyncState.getSourceState("bookmark");
        expect(state.snapshot["new-2"]?.pageId).toBe("page-P");
        expect(state.snapshot["old-1"]).toBeUndefined();
    });
});

describe("P1 共识: SyncScheduler 重试计数生命周期", () => {
    afterEach(() => {
        SyncScheduler.stop("linuxdo");
    });

    it("stop 重置失败计数, 重启后首轮失败不会直接命中熔断", () => {
        SyncScheduler.start("linuxdo", 30);
        SyncScheduler._retryCounts.set("linuxdo", 4); // 模拟此前连续失败
        SyncScheduler.stop("linuxdo");
        expect(SyncScheduler._retryCounts.get("linuxdo")).toBe(0);
    });

    it("同源重叠调度只执行一次 runner(调度级在途互斥)", async () => {
        const { AutoImporter } = require("../src/import");
        let release;
        const runSpy = vi.spyOn(AutoImporter, "run").mockImplementation(
            () => new Promise((resolve) => { release = resolve; })
        );
        const first = SyncScheduler._doSync("linuxdo");
        const second = SyncScheduler._doSync("linuxdo");
        release({});
        await Promise.all([first, second]);
        expect(runSpy).toHaveBeenCalledTimes(1);
        expect(SyncScheduler._inFlight.has("linuxdo")).toBe(false);
    });

    it("成功路径取消已排定的重试定时器", async () => {
        SyncScheduler.start("linuxdo", 30);
        SyncScheduler._scheduleRetry("linuxdo");
        expect(SyncScheduler._retries.has("linuxdo")).toBe(true);
        // runner 存在(linuxdo 在 SOURCE_RUNNERS 中) → 走 runner 分支
        const { AutoImporter } = require("../src/import");
        vi.spyOn(AutoImporter, "run").mockResolvedValue({});
        await SyncScheduler._doSync("linuxdo");
        expect(SyncScheduler._retries.has("linuxdo")).toBe(false);
    });
});

describe("P1 共识: acquireLease 二次确认(跨 tab 写入传播延迟)", () => {
    const KEY = "lease:test:two-phase";
    let origGet = null;
    let origSet = null;

    beforeEach(() => {
        origGet = global.GM_getValue;
        origSet = global.GM_setValue;
    });
    afterEach(() => {
        global.GM_getValue = origGet;
        global.GM_setValue = origSet;
    });

    it("首轮复读命中但二次确认发现被后写者覆盖 → 返回 null", async () => {
        let stored = null;
        let reads = 0;
        global.GM_setValue = (k, v) => { if (k === KEY) stored = JSON.parse(v); };
        global.GM_getValue = (k, d) => {
            if (k !== KEY) return d;
            reads += 1;
            if (reads === 1) return "{}"; // 现有租约检查: 空
            if (reads === 2) return JSON.stringify(stored); // 首轮复读: 自己
            return JSON.stringify({ owner: "rival-tab", expiresAt: Date.now() + 60000 }); // 二次确认: 被覆盖
        };
        const lease = await SyncLock.acquireLease(KEY);
        expect(lease).toBeNull();
        expect(reads).toBeGreaterThanOrEqual(3);
    });

    it("两轮确认均为自己 → 获取成功", async () => {
        let stored = null;
        let reads = 0;
        global.GM_setValue = (k, v) => { if (k === KEY) stored = JSON.parse(v); };
        global.GM_getValue = (k, d) => {
            if (k !== KEY) return d;
            reads += 1;
            if (reads === 1) return "{}";
            return JSON.stringify(stored); // 两轮复读均为自己
        };
        const lease = await SyncLock.acquireLease(KEY);
        expect(lease).not.toBeNull();
        expect(lease.owner).toBeTruthy();
    });

    it("renewLease 写后复读发现被他人覆盖 → 返回 false(2/3 共识)", () => {
        let reads = 0;
        global.GM_getValue = (k, d) => {
            if (k !== KEY) return d;
            reads += 1;
            if (reads === 1) return JSON.stringify({ owner: "me", expiresAt: Date.now() + 60000 });
            return JSON.stringify({ owner: "rival-tab", expiresAt: Date.now() + 60000 });
        };
        global.GM_setValue = () => {};
        const lease = { owner: "me", expiresAt: Date.now() + 1000 };
        expect(SyncLock.renewLease(KEY, lease)).toBe(false);
    });

    it("renewLease 写后复读仍为自己 → 续约成功", () => {
        global.GM_getValue = (k, d) => (k === KEY ? JSON.stringify({ owner: "me", expiresAt: Date.now() + 60000 }) : d);
        global.GM_setValue = () => {};
        const lease = { owner: "me", expiresAt: Date.now() + 1000 };
        expect(SyncLock.renewLease(KEY, lease)).toBe(lease);
    });

    it("releaseLease(null) 不得清除他人持有的互斥标志(2/3 共识)", () => {
        SyncLock.isExporting = true;
        SyncLock.releaseLease(KEY, null);
        expect(SyncLock.isExporting).toBe(true);
        SyncLock.isExporting = false;
    });
});
