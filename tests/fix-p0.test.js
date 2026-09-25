"use strict";

// v3.14.6 P0 修复契约测试 (fix-plan.json batch=P0):
//  AUD-ARCH-02/08 (X-01=CC-01=DC-001): githubDirty ReferenceError + Notion 循环 O(N²)
//  AUD-ARCH-01  (DC-005=X-02): _exportItems 认证终态 fail-fast + finally flush
//  AUD-ARCH-09  (CC-02=X-03): 毒项 unshift 删除 —— 终态中止后失败项同 key 仅尝试一次
//  AUD-ARCH-11: 续签非终态失败不再误标 isAuthTerminal; 60s 冷却内不重放续签
//  CC-13: AUTO_SYNC_STATE 远端监听失效缓存(防陈旧整键覆写)
//  CC-15: _saveTimerId/_savePending 哨兵拆分(forceFlush 不误清真实定时器)
//  CC-04: 跨 tab 租约锁(写后复读校验 + TTL 兜底)
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;
global.GM_notification = () => {};
global.GM_xmlhttpRequest = (opts) => {
    const responder = global.__ldNotionResponder;
    if (responder) return responder(opts);
    opts.onload({
        status: 401,
        responseText: JSON.stringify({ object: "error", status: 401, code: "unauthorized", message: "API token is invalid." }),
        responseHeaders: "",
    });
};
global.__ldNotionResponder = null;

const { CONFIG } = require("../src/config");
const { Storage } = require("../src/storage");

beforeEach(() => {
    store.clear();
    global.__ldNotionResponder = null;
});

// v3.17: GitHub 收藏源已移除,github-obsidian-service/GitHubExporter 已删除。
// AUD-ARCH-02/08 同构语义(认证终态中止/finally 落盘)由 BookmarkExporter.exportBookmarks 承载,见下。
describe("AUD-ARCH-02/08: 书签导出认证终态中止 + finally 落盘(原 GitHub 分支语义)", () => {
    it("认证终态中止: 返回 aborted, 剩余进 skipped", async () => {
        const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
        const { NotionAPI } = require("../src/api");
        const { OperationGuard } = require("../src/security");

        const origSetup = BookmarkExporter.setupDatabaseProperties;
        const origEnrich = BookmarkExporter.enrichBookmark;
        const origProps = BookmarkExporter.buildProperties;
        const origAudit = BookmarkExporter._auditExport;
        const origCanExecute = OperationGuard.canExecute;
        const origCollect = NotionAPI.collectDatabaseUrls;
        BookmarkExporter.setupDatabaseProperties = async () => ({ success: true });
        BookmarkExporter.enrichBookmark = async (bookmark) => bookmark;
        BookmarkExporter.buildProperties = () => ({ title: "x" });
        BookmarkExporter._auditExport = () => {};
        OperationGuard.canExecute = () => true;
        // 远端对账降级为账本路径: 查询抛错 → remoteUrls=null → 走本地账本过滤
        NotionAPI.collectDatabaseUrls = async () => { throw new Error("mock query fail"); };

        let requestCalls = 0;
        const origRequest = NotionAPI.request;
        NotionAPI.request = async () => {
            requestCalls++;
            if (requestCalls === 1) return { id: "page-ok" };
            const err = new Error("Notion OAuth 续签失败: invalid_grant (refresh_token 已使用或已过期)");
            err.isAuthTerminal = true;
            throw err;
        };

        try {
            // CONCURRENCY=3: 首批 3 项并发(仅第 1 次请求成功,其余终态失败),
            // 第 4 项未开工即中止 → skipped。成功项归属与调用次序无关(仅第 1 次调用成功)。
            const result = await BookmarkExporter.exportBookmarks(
                {
                    apiKey: "secret",
                    databaseId: "db-1",
                    bookmarks: [
                        { url: "https://example.com/b1", title: "B1" },
                        { url: "https://example.com/b2", title: "B2" },
                        { url: "https://example.com/b3", title: "B3" },
                        { url: "https://example.com/b4", title: "B4" },
                    ],
                }
            );
            expect(result.aborted).toBe(true);
            expect(result.exported).toBe(1);
            expect(result.failed).toBe(2);
            expect(result.skipped).toBe(1);
        } finally {
            BookmarkExporter.setupDatabaseProperties = origSetup;
            BookmarkExporter.enrichBookmark = origEnrich;
            BookmarkExporter.buildProperties = origProps;
            BookmarkExporter._auditExport = origAudit;
            OperationGuard.canExecute = origCanExecute;
            NotionAPI.request = origRequest;
            NotionAPI.collectDatabaseUrls = origCollect;
        }
    });

    it("成功项账本经 finally 落盘(不丢已导出事实)", async () => {
        const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
        const { NotionAPI } = require("../src/api");
        const { OperationGuard } = require("../src/security");

        const origSetup = BookmarkExporter.setupDatabaseProperties;
        const origEnrich = BookmarkExporter.enrichBookmark;
        const origProps = BookmarkExporter.buildProperties;
        const origAudit = BookmarkExporter._auditExport;
        const origCanExecute = OperationGuard.canExecute;
        const origCollect = NotionAPI.collectDatabaseUrls;
        BookmarkExporter.setupDatabaseProperties = async () => ({ success: true });
        BookmarkExporter.enrichBookmark = async (bookmark) => bookmark;
        BookmarkExporter.buildProperties = () => ({ title: "x" });
        BookmarkExporter._auditExport = () => {};
        OperationGuard.canExecute = () => true;
        NotionAPI.collectDatabaseUrls = async () => { throw new Error("mock query fail"); };
        const origRequest = NotionAPI.request;
        NotionAPI.request = async () => ({ id: "page-ok" });

        try {
            const result = await BookmarkExporter.exportBookmarks(
                {
                    apiKey: "secret",
                    databaseId: "db-1",
                    bookmarks: [{ url: "https://example.com/r1", title: "R1" }],
                }
            );
            expect(result.exported).toBe(1);
            expect(BookmarkExporter.isExported("https://example.com/r1")).toBe(true);
        } finally {
            BookmarkExporter.setupDatabaseProperties = origSetup;
            BookmarkExporter.enrichBookmark = origEnrich;
            BookmarkExporter.buildProperties = origProps;
            BookmarkExporter._auditExport = origAudit;
            OperationGuard.canExecute = origCanExecute;
            NotionAPI.request = origRequest;
            NotionAPI.collectDatabaseUrls = origCollect;
        }
    });
});

// v3.17: GitHub 收藏源已移除,GitHubExporter 已删除。
// _exportItems 认证终态 fail-fast 同构语义由 Exporter.isAuthTerminalError 承载,见下。
describe("AUD-ARCH-01: Exporter 认证终态 fail-fast(原 GitHub _exportItems 语义)", () => {
    it("isAuthTerminalError 仅信标记: 终态 true, 其余 false", async () => {
        const { Exporter } = require("../src/export");
        const terminal = new Error("Notion OAuth 续签失败: invalid_grant");
        terminal.isAuthTerminal = true;
        expect(Exporter.isAuthTerminalError(terminal)).toBe(true);
        expect(Exporter.isAuthTerminalError(new Error("timeout"))).toBe(false);
        expect(Exporter.isAuthTerminalError(null)).toBe(false);
        expect(Exporter.isAuthTerminalError({ isAuthTerminal: "yes" })).toBe(false);
    });

    it("exportBookmarks 首项终态 → 中止批次: 剩余进 skipped", async () => {
        const { Exporter } = require("../src/export");
        const { NotionAPI } = require("../src/api");
        const { OperationGuard } = require("../src/security");
        const { SyncLock } = require("../src/sync-lock");

        const origCanExecute = OperationGuard.canExecute;
        OperationGuard.canExecute = () => true;
        const origExportTopic = Exporter.exportTopic;
        let calls = 0;
        Exporter.exportTopic = async () => {
            calls++;
            const err = new Error("Notion OAuth 续签失败: invalid_grant (refresh_token 已使用或已过期)");
            err.isAuthTerminal = true;
            throw err;
        };
        const origLease = SyncLock.acquireLease;
        const origRelease = SyncLock.releaseLease;
        const leaseToken = { owner: "test", ts: Date.now() };
        SyncLock.acquireLease = async () => leaseToken;
        SyncLock.releaseLease = () => {};

        try {
            const bookmarks = [
                { id: 1, title: "T1" },
                { id: 2, title: "T2" },
                { id: 3, title: "T3" },
            ];
            const result = await Exporter.exportBookmarks(
                bookmarks,
                { apiKey: "secret", liveApiKey: "secret", concurrency: 1 },
                () => {}
            );
            expect(result.authAborted).toBeTruthy();
            expect(result.success.length).toBe(0);
            expect(result.failed.length).toBe(1);
            expect(result.skipped.length).toBe(2);
            expect(calls).toBe(1);
        } finally {
            OperationGuard.canExecute = origCanExecute;
            Exporter.exportTopic = origExportTopic;
            SyncLock.acquireLease = origLease;
            SyncLock.releaseLease = origRelease;
            SyncLock.isExporting = false;
        }
    });
});

describe("AUD-ARCH-11: 续签失败分类 + 冷却", () => {
    const terminal401 = (opts) => opts.onload({
        status: 401,
        responseText: JSON.stringify({ code: "unauthorized", message: "API token is invalid." }),
        responseHeaders: "",
    });

    it("续签网络错误(非终态) → 不标记 isAuthTerminal", async () => {
        const { NotionAPI } = require("../src/api");
        const { NotionOAuth } = require("../src/auth");
        const origRefresh = NotionOAuth.refreshAccessToken;
        const origCanAutoRefresh = NotionOAuth.canAutoRefresh;
        const origResponder = global.__ldNotionResponder;
        NotionOAuth.canAutoRefresh = () => true;
        NotionOAuth.refreshAccessToken = async () => { throw new Error("NetworkError: fetch failed (timeout)"); };
        NotionAPI._refreshCooldownUntil = null;
        global.__ldNotionResponder = terminal401;
        // v3.14.12 空 token 预检: OAuth 模式 resolveRequestToken 读 Storage, 须预置 key
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_oauth_expired");
        try {
            let thrown = null;
            try {
                await NotionAPI.request("POST", "/pages", {}, "secret", 3, {});
            } catch (e) { thrown = e; }
            expect(thrown).toBeTruthy();
            expect(thrown.isAuthTerminal).toBeUndefined();
            expect(thrown.message).toContain("续签失败");
        } finally {
            NotionOAuth.refreshAccessToken = origRefresh;
            NotionOAuth.canAutoRefresh = origCanAutoRefresh;
            global.__ldNotionResponder = origResponder;
        }
    });

    it("续签终态(invalid_grant) → 仍标记 isAuthTerminal", async () => {
        const { NotionAPI } = require("../src/api");
        const { NotionOAuth } = require("../src/auth");
        const origRefresh = NotionOAuth.refreshAccessToken;
        const origCanAutoRefresh = NotionOAuth.canAutoRefresh;
        const origResponder = global.__ldNotionResponder;
        NotionOAuth.canAutoRefresh = () => true;
        NotionOAuth.refreshAccessToken = async () => {
            const err = new Error("Notion OAuth 授权失败: invalid_grant (refresh_token 已使用或已过期)");
            err.code = "invalid_grant";
            throw err;
        };
        NotionAPI._refreshCooldownUntil = null;
        global.__ldNotionResponder = terminal401;
        // v3.14.12 空 token 预检: 须预置 Storage key 才能走到 401 续签路径
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_oauth_expired");
        try {
            let thrown = null;
            try {
                await NotionAPI.request("POST", "/pages", {}, "secret", 3, {});
            } catch (e) { thrown = e; }
            expect(thrown.isAuthTerminal).toBe(true);
        } finally {
            NotionOAuth.refreshAccessToken = origRefresh;
            NotionOAuth.canAutoRefresh = origCanAutoRefresh;
            global.__ldNotionResponder = origResponder;
        }
    });

    it("冷却期内第二次 401 不再触发续签请求", async () => {
        const { NotionAPI } = require("../src/api");
        const { NotionOAuth } = require("../src/auth");
        const origRefresh = NotionOAuth.refreshAccessToken;
        const origCanAutoRefresh = NotionOAuth.canAutoRefresh;
        const origResponder = global.__ldNotionResponder;
        let refreshCalls = 0;
        NotionOAuth.canAutoRefresh = () => true;
        NotionOAuth.refreshAccessToken = async () => {
            refreshCalls++;
            throw new Error("NetworkError: fetch failed");
        };
        NotionAPI._refreshCooldownUntil = null;
        global.__ldNotionResponder = terminal401;
        // v3.14.12 空 token 预检: 须预置 Storage key 才能走到 401 续签路径
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_oauth_expired");
        try {
            for (let i = 0; i < 2; i++) {
                try {
                    await NotionAPI.request("POST", "/pages", {}, "secret", 3, {});
                } catch { /* expected */ }
            }
            expect(refreshCalls).toBe(1);
        } finally {
            NotionOAuth.refreshAccessToken = origRefresh;
            NotionOAuth.canAutoRefresh = origCanAutoRefresh;
            global.__ldNotionResponder = origResponder;
        }
    });
});

describe("CC-13: AUTO_SYNC_STATE 远端监听", () => {
    it("远端变更 → 内存缓存失效(重读新 watermark)", async () => {
        // 预热缓存
        const firstLoad = require("../src/storage/SyncState");
        firstLoad.SyncStateV2.getSourceState("linuxdo");
        expect(firstLoad.SyncStateV2._cache).toBeTruthy();
        // 模拟远端写入新 watermark
        const state = JSON.parse(store.get(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE) || "{}");
        if (!state.sources) state.sources = {};
        if (!state.sources.linuxdo) {
            state.sources.linuxdo = { watermark: null, epoch: 0, lastOutcome: "idle", lastError: "", lastStats: {}, lastSuccessAt: 0, lastAttemptAt: 0 };
        }
        state.sources.linuxdo.watermark = { time: "2026-09-06T00:00:00.000Z", ids: ["t-1"] };
        store.set(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE, JSON.stringify(state));
        // 触发监听回调(remote=true): 重载模块收集 listener
        const listeners = [];
        global.GM_addValueChangeListener = (key, cb) => { listeners.push(cb); return 0; };
        delete require.cache[require.resolve("../src/storage/SyncState")];
        const { SyncStateV2: Reloaded } = require("../src/storage/SyncState");
        try {
            listeners.forEach((cb) => cb(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE, "{}", JSON.stringify(state), true));
            expect(Reloaded._cache).toBeNull();
            const fresh = Reloaded.getSourceState("linuxdo");
            expect(fresh.watermark.time).toBe("2026-09-06T00:00:00.000Z");
            expect(fresh.watermark.ids).toEqual(["t-1"]);
        } finally {
            global.GM_addValueChangeListener = () => 0;
        }
    });
});

describe("CC-15: _saveTimer 哨兵拆分", () => {
    it("微任务路径 forceFlush 幂等且不误清真实定时器", async () => {
        const { SyncStateV2 } = require("../src/storage/SyncState");
        SyncStateV2._cache = null;
        SyncStateV2._dirty = false;
        SyncStateV2.updateSourceState("linuxdo", { watermark: { time: "2026-09-06T00:00:00.000Z", ids: [] } });
        expect(SyncStateV2._savePending).toBe(true);
        expect(SyncStateV2._saveTimerId).toBeNull();
        SyncStateV2.forceFlush();
        expect(SyncStateV2._savePending).toBe(false);
        expect(SyncStateV2._saveTimerId).toBeNull();
        const raw = JSON.parse(store.get(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE) || "{}");
        expect(raw.sources.linuxdo.watermark.time).toBe("2026-09-06T00:00:00.000Z");
    });
});

describe("CC-04: 跨 tab 租约锁", () => {
    it("无 GM 环境降级进程内互斥", async () => {
        const { SyncLock } = require("../src/sync-lock");
        const origGet = global.GM_getValue;
        const origSet = global.GM_setValue;
        global.GM_getValue = undefined;
        global.GM_setValue = undefined;
        try {
            SyncLock.isExporting = false;
            const lease = await SyncLock.acquireLease("ldb_test_lease");
            expect(lease).toBeTruthy();
            const second = await SyncLock.acquireLease("ldb_test_lease");
            expect(second).toBeNull();
            SyncLock.releaseLease("ldb_test_lease", lease);
            expect(SyncLock.isExporting).toBe(false);
        } finally {
            global.GM_getValue = origGet;
            global.GM_setValue = origSet;
        }
    });

    it("GM 环境: 双实例仅一方获租约; 释放后可再获取; 过期可抢占", async () => {
        const { SyncLock } = require("../src/sync-lock");
        const leaseA = await SyncLock.acquireLease("ldb_test_lease");
        expect(leaseA).toBeTruthy();
        const leaseB = await SyncLock.acquireLease("ldb_test_lease");
        expect(leaseB).toBeNull();
        SyncLock.releaseLease("ldb_test_lease", leaseA);
        const leaseC = await SyncLock.acquireLease("ldb_test_lease");
        expect(leaseC).toBeTruthy();
        // 过期租约可抢占
        store.set("ldb_test_lease2", JSON.stringify({ owner: "stale-owner", expiresAt: Date.now() - 1000 }));
        const leaseD = await SyncLock.acquireLease("ldb_test_lease2");
        expect(leaseD).toBeTruthy();
        SyncLock.releaseLease("ldb_test_lease", leaseC);
        SyncLock.releaseLease("ldb_test_lease2", leaseD);
    });

    it("S1: 续约 owner 复核 —— 本人可续约; 被抢占后失配不覆写并返回 false", async () => {
        const { SyncLock } = require("../src/sync-lock");
        const key = "ldb_test_lease_s1";
        const leaseA = await SyncLock.acquireLease(key);
        expect(leaseA).toBeTruthy();
        // 本人续约: 成功且延长 expiresAt
        const renewed = SyncLock.renewLease(key, leaseA);
        expect(renewed).toBeTruthy();
        expect(renewed.expiresAt).toBeGreaterThan(Date.now());
        const stored = JSON.parse(store.get(key));
        expect(stored.owner).toBe(leaseA.owner);
        // 模拟后台节流超 TTL: 租约过期被 tab B 抢占
        store.set(key, JSON.stringify({ owner: "tab-b", expiresAt: Date.now() + 60000 }));
        // A 的续约定时器晚到: owner 失配 → 返回 false, 绝不覆写 B 的租约
        const staleRenew = SyncLock.renewLease(key, leaseA);
        expect(staleRenew).toBe(false);
        const after = JSON.parse(store.get(key));
        expect(after.owner).toBe("tab-b");
        // A 释放被抢占的租约: owner 复核同样不误清 B 的租约
        SyncLock.releaseLease(key, leaseA);
        expect(JSON.parse(store.get(key)).owner).toBe("tab-b");
    });
});

describe("AUD-ARCH-09: 终态中止不重插毒项", () => {
    it("AutoImporter.run 认证中止: 毒项同 key 仅尝试一次, 剩余项本批不处理", async () => {
        const { AutoImporter } = require("../src/import");
        const { Exporter } = require("../src/export");
        const { LinuxDoAPI } = require("../src/export");
        const { SyncLock } = require("../src/sync-lock");

        Storage.set(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, true);
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "db-1");
        SyncLock.isExporting = false;

        const origFetch = LinuxDoAPI.fetchBookmarksSince;
        LinuxDoAPI.fetchBookmarksSince = async () => [
            { topic_id: 201, title: "A", url: "https://linux.do/t/201" },
            { topic_id: 202, title: "B", url: "https://linux.do/t/202" },
            { topic_id: 203, title: "C", url: "https://linux.do/t/203" },
        ];
        const origExport = Exporter.exportTopic;
        const callCounts = {};
        Exporter.exportTopic = async (bookmark) => {
            const key = String(bookmark.topic_id);
            callCounts[key] = (callCounts[key] || 0) + 1;
            if (key === "202") {
                const err = new Error("Notion OAuth 续签失败: invalid_grant");
                err.isAuthTerminal = true;
                throw err;
            }
            return { ok: true };
        };
        const origIsExported = Storage.isTopicExported;
        Storage.isTopicExported = () => false;
        const origUpdateStatus = AutoImporter.updateStatus;
        AutoImporter.updateStatus = () => {};
        // 用户名探测: 页面 URL 无 /u/ 路径 → 回退 meta 注入
        const origQuerySelector = global.document.querySelector;
        global.document.querySelector = (selector) =>
            selector === 'meta[name="current-user-username"]' ? { content: "tester" } : null;
        const origAvatar = global.document.querySelector;
        void origAvatar;

        try {
            AutoImporter.isRunning = false;
            AutoImporter.lastRunAt = 0;
            await AutoImporter.run();
            expect(callCounts["202"]).toBe(1); // 毒项不重试
            expect(callCounts["201"]).toBe(1);
            expect(callCounts["203"]).toBeUndefined(); // 中止后剩余项留待下轮
        } finally {
            LinuxDoAPI.fetchBookmarksSince = origFetch;
            Exporter.exportTopic = origExport;
            Storage.isTopicExported = origIsExported;
            AutoImporter.updateStatus = origUpdateStatus;
            global.document.querySelector = origQuerySelector;
            AutoImporter.isRunning = false;
        }
    });
});

describe("odyssey-review(codebase): F1/F2/F3 修复契约", () => {
    it("F3: setup 失败路径不泄漏租约(未持有 AUTO_SYNC_LEASE)", async () => {
        // v3.17: GitHub 导出器已删除,同构语义由 BookmarkExporter.exportBookmarks 承载
        // (setup 失败抛错路径: setup 在取任何租约之前, 无租约可泄漏)。
        const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
        const origSetup = BookmarkExporter.setupDatabaseProperties;
        BookmarkExporter.setupDatabaseProperties = async () => ({ success: false, error: "mock 404" });
        try {
            await expect(BookmarkExporter.exportBookmarks(
                { apiKey: "secret", databaseId: "db-1", bookmarks: [{ url: "https://example.com/x", title: "X" }] }
            )).rejects.toThrow("数据库配置失败");
            // 修复前: 租约在 setup 前获取且无释放路径 → 60s 泄漏; 修复后: 根本不取
            expect(store.get(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE) || "{}").toBe("{}");
        } finally {
            BookmarkExporter.setupDatabaseProperties = origSetup;
        }
    });

    it("F3b: apiKey 缺失抛错路径同样不取租约", async () => {
        // v3.17: GitHub 导出器已删除,同构语义由 BookmarkExporter.exportBookmarks 承载。
        const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
        await expect(BookmarkExporter.exportBookmarks(
            { apiKey: "", databaseId: "db-1", bookmarks: [{ url: "https://example.com/x", title: "X" }] }
        )).rejects.toThrow("请先配置");
        expect(store.get(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE) || "{}").toBe("{}");
    });

    it("F1: crypto 不可用时 uploadFileContent 走 reject 不永挂", async () => {
        const { NotionAPI } = require("../src/api");
        const origDesc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
        const origFR = global.FileReader;
        // Node24 crypto 为 getter-only, defineProperty 暂替为无 getRandomValues 的空对象
        Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true, writable: true });
        global.FileReader = class { readAsArrayBuffer() { this.onload(); } };
        try {
            await expect(NotionAPI.uploadFileContent("https://presigned.example", {}, "text/plain", "f.bin"))
                .rejects.toThrow("crypto.getRandomValues");
        } finally {
            if (origDesc && origDesc.get) Object.defineProperty(globalThis, "crypto", origDesc);
            else Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
            if (origFR === undefined) delete global.FileReader; else global.FileReader = origFR;
        }
    });

    it("F2: multipart filename 剥离双引号与 CRLF(头注入防护)", async () => {
        const { NotionAPI } = require("../src/api");
        const origFR = global.FileReader;
        global.FileReader = class {
            readAsArrayBuffer() {
                Blob.prototype.arrayBuffer.call(this._blob || new Blob()).then(() => {});
                this.result = new TextEncoder().encode("x").buffer;
                this.onload();
            }
        };
        let captured = null;
        global.__ldNotionResponder = (opts) => { captured = opts; opts.onload({ status: 200, responseText: "{}" }); };
        try {
            const evil = 'a"b' + String.fromCharCode(13, 10) + 'X-Injected: 1.bin';
            await NotionAPI.sendFilePart("upload-1", new Blob(["part"]), 1, "secret", evil);
            expect(captured).toBeTruthy();
            const decoded = new TextDecoder().decode(new Uint8Array(captured.data));
            expect(decoded).not.toContain('a"b');
            expect(decoded).toContain("abX-Injected: 1.bin");
        } finally {
            if (origFR === undefined) delete global.FileReader; else global.FileReader = origFR;
            global.__ldNotionResponder = null;
        }
    });
});
