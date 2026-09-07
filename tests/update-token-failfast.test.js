"use strict";

// v3.14.13 更新路径 token invalid 修复回归测试:
// P1-3: Bookmark/RSS 自动导入器循环内重读 token + isAuthTerminal fail-fast
//   (401 风暴根因: buildSettings 快照整轮复用, OAuth 续签后后续项仍带旧 token)
// P1-4: clearConnection 无条件清 OAuth 残留键值(manual 模式下残留 access_token 也清)
// 模式: 真实模块 + GM mock(与 auth-failfast.test.js 一致, 本项目 vi.mock 对 CJS 不生效)
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;
global.GM_notification = () => {};
// 默认 401 unauthorized(测试注入可覆盖)
global.GM_xmlhttpRequest = (opts) => {
    const responder = global.__ldNotionResponder;
    if (responder) return responder(opts);
    opts.onload({
        status: 401,
        responseText: JSON.stringify({ object: "error", status: 401, code: "unauthorized", message: "API token is invalid." }),
        responseHeaders: "",
    });
};

const { CONFIG } = require("../src/config");
const { Storage } = require("../src/storage");
const { NotionOAuth } = require("../src/auth");
const { SyncLock } = require("../src/sync-lock");
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
const { BookmarkBridge } = require("../src/bridge/index");
const { RSSAutoImporter } = require("../src/bridge/RSSAutoImporter");
const { BookmarkAutoImporter } = require("../src/bridge/BookmarkAutoImporter");

beforeEach(() => {
    store.clear();
    global.__ldNotionResponder = null;
    BookmarkAutoImporter.isRunning = false;
    BookmarkAutoImporter.lastRunAt = 0;
    RSSAutoImporter.isRunning = false;
    RSSAutoImporter.lastRunAt = 0;
    vi.restoreAllMocks();
});

describe("R-AUTH-02: RSS 自动导入 isAuthTerminal fail-fast + 逐项重读 token", () => {
    const makeCtx = () => ({
        settings: {
            apiKey: "secret_test",
            databaseId: "db1",
            categories: [],
            aiApiKey: "",
            aiService: "",
            aiModel: "",
            aiBaseUrl: "",
        },
        index: { byUrl: new Map(), byPageId: new Map(), byTitle: new Map() },
        previousSnapshot: {},
        nextSnapshot: {},
        enrichContext: { aiUsedCount: 0, aiMaxItems: 0 },
        position: 1,
        total: 1,
    });
    const item = { itemKey: "k1", title: "标题", url: "https://example.com", summary: "", publishedAt: "" };

    it("401 终态错误 → _syncSingleRssItem 抛原错误(带 isAuthTerminal + authCode)", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_test");
        await expect(RSSAutoImporter._syncSingleRssItem(item, makeCtx())).rejects.toMatchObject({
            isAuthTerminal: true,
            authCode: "unauthorized",
        });
    });

    it("每项开工前重读 token(getAccessToken 被调用, 不依赖快照)", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_test");
        const spy = vi.spyOn(NotionOAuth, "getAccessToken");
        try {
            await RSSAutoImporter._syncSingleRssItem(item, makeCtx());
        } catch (e) { /* 预期抛错 */ }
        expect(spy).toHaveBeenCalled();
    });
});

describe("R-AUTH-03: Bookmark 自动导入 isAuthTerminal fail-fast + 逐项重读 token", () => {
    const bookmarks = [
        { id: "b1", title: "书签1", url: "https://a.example.com", folderPath: "", dateAdded: "2026-01-01T00:00:00Z" },
        { id: "b2", title: "书签2", url: "https://b.example.com", folderPath: "", dateAdded: "2026-01-01T00:00:00Z" },
        { id: "b3", title: "书签3", url: "https://c.example.com", folderPath: "", dateAdded: "2026-01-01T00:00:00Z" },
        { id: "b4", title: "书签4", url: "https://d.example.com", folderPath: "", dateAdded: "2026-01-01T00:00:00Z" },
        { id: "b5", title: "书签5", url: "https://e.example.com", folderPath: "", dateAdded: "2026-01-01T00:00:00Z" },
        { id: "b6", title: "书签6", url: "https://f.example.com", folderPath: "", dateAdded: "2026-01-01T00:00:00Z" },
    ];
    const stubRunDeps = () => {
        vi.spyOn(BookmarkBridge, "isExtensionAvailable").mockReturnValue(true);
        vi.spyOn(SyncLock, "acquireLease").mockResolvedValue({ owner: "test", expiresAt: Date.now() + 60000 });
        vi.spyOn(SyncLock, "renewLease").mockResolvedValue(true);
        vi.spyOn(SyncLock, "releaseLease").mockResolvedValue(true);
        vi.spyOn(BookmarkExporter, "setupDatabaseProperties").mockResolvedValue({ success: true });
        vi.spyOn(BookmarkExporter, "enrichBookmark").mockResolvedValue({});
        vi.spyOn(BookmarkExporter, "buildProperties").mockReturnValue({});
        vi.spyOn(BookmarkExporter, "markExported").mockReturnValue(undefined);
        vi.spyOn(BookmarkExporter, "flushExported").mockReturnValue(undefined);
        vi.spyOn(BookmarkAutoImporter, "loadCurrentBookmarks").mockResolvedValue(bookmarks);
        vi.spyOn(BookmarkAutoImporter, "fetchTrackedPages").mockResolvedValue([]);
    };

    it("401 终态错误 → run 记录 error 状态且剩余项不再处理(fail-fast)", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_test");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "db1");
        stubRunDeps();
        const requestSpy = vi.spyOn(require("../src/api").NotionAPI, "request");
        const flushSpy = vi.spyOn(BookmarkExporter, "flushExported");

        await BookmarkAutoImporter.run();
        // fail-fast: 首批(3 项)全发后 rejected 即中止, 第二批不再发起(6 项全打 = 401 风暴复现)
        expect(requestSpy.mock.calls.length).toBeLessThan(bookmarks.length);
        expect(requestSpy.mock.calls.length).toBeLessThanOrEqual(3);
        // H1: 中止前已成功项的导出事实必须先落盘(flush 在 throw 前, 与 BookmarkExporter.js:694 约定对齐)
        expect(flushSpy).toHaveBeenCalled();
        // 用户可见错误状态(run 外层 catch 吞错, 经 SyncState + UI 文案呈现)
        const state = require("../src/storage").SyncState.getBookmarkState();
        expect(state.lastOutcome).toBe("error");
        expect(String(state.lastError)).toContain("API token is invalid");
        // 中止轮 watermark 不推进(失败项保留在增量窗口内下轮重试, F7 共识)
        expect(state.watermark).toBeFalsy();
    });

    it("非终态错误(400)不中止批次, 全部项仍处理", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_test");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "db1");
        stubRunDeps();
        // 400 非认证错误(非终态, 不重试短路)——fail-fast 不得误杀, 每项都应发出请求
        global.__ldNotionResponder = (opts) => opts.onload({
            status: 400,
            responseText: JSON.stringify({ object: "error", status: 400, code: "validation_error", message: "bad request" }),
            responseHeaders: "",
        });
        const requestSpy = vi.spyOn(require("../src/api").NotionAPI, "request");

        await BookmarkAutoImporter.run();

        expect(requestSpy.mock.calls.length).toBe(bookmarks.length);
        const state = require("../src/storage").SyncState.getBookmarkState();
        expect(state.lastOutcome).not.toBe("error");
    });

    it("setup 阶段(GET /databases)401 终态 → authCode 透传, 场景文案可达(M3)", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_test");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "db1");
        stubRunDeps();
        // setup 是 token 失效最常见首触点——错误包装此前丢弃 isAuthTerminal/authCode
        vi.spyOn(BookmarkExporter, "setupDatabaseProperties").mockResolvedValueOnce({
            success: false,
            error: "Notion API 错误: API token is invalid.",
            isAuthTerminal: true,
            authCode: "unauthorized",
        });
        const requestSpy = vi.spyOn(require("../src/api").NotionAPI, "request");

        await BookmarkAutoImporter.run();

        // setup 失败早于循环, 不发任何建页请求
        expect(requestSpy.mock.calls.length).toBe(0);
        const state = require("../src/storage").SyncState.getBookmarkState();
        expect(state.lastOutcome).toBe("error");
        // 透传后原始错误信息保留, 外层 catch 按 authCode 分支给出场景文案
        expect(String(state.lastError)).toContain("API token is invalid");
    });

    it("每项开工前重读 token(getAccessToken 调用次数 ≥ 项数)", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_test");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "db1");
        stubRunDeps();
        const spy = vi.spyOn(NotionOAuth, "getAccessToken");

        try {
            await BookmarkAutoImporter.run();
        } catch (e) { /* 预期抛错 */ }
        // buildSettings 1 次 + 每项开工前重读(≥3 项)
        expect(spy.mock.calls.length).toBeGreaterThanOrEqual(bookmarks.length);
    });
});

describe("R-AUTH-04: clearConnection 无条件清 OAuth 残留键值", () => {
    it("manual 模式下也清 NOTION_API_KEY(残留 access_token 覆盖场景)", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_oauth_residual");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "refresh_residual");
        NotionOAuth.setAuthMode("manual");

        await NotionOAuth.clearConnection();

        expect(Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "sentinel")).toBe("");
        expect(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "sentinel")).toBe("");
        expect(NotionOAuth.getAuthMode()).toBe("manual");
    });

    it("oauth 模式下同样清空(原有行为不回归)", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_oauth");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "refresh_oauth");
        NotionOAuth.setAuthMode("oauth");

        await NotionOAuth.clearConnection();

        expect(Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "sentinel")).toBe("");
        expect(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "sentinel")).toBe("");
    });
});
