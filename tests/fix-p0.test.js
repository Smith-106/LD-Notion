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

describe("AUD-ARCH-02/08: Notion 分支 githubDirty 声明 + O(N²) 消除", () => {
    it("认证终态中止: 不抛 ReferenceError, 返回 authAborted, 剩余进 skipped", async () => {
        const { exportGitHubSelectedToNotion } = require("../src/import/github-obsidian-service");
        const { GitHubExporter } = require("../src/import/GitHubExporter");
        const { NotionAPI } = require("../src/api");
        const { OperationGuard } = require("../src/security");

        const origSetup = GitHubExporter.setupDatabaseProperties;
        const origEnrich = GitHubExporter.enrichRepo;
        const origProps = GitHubExporter.buildRepoProperties;
        const origAudit = GitHubExporter._auditExport;
        const origCanExecute = OperationGuard.canExecute;
        GitHubExporter.setupDatabaseProperties = async () => ({ success: true });
        GitHubExporter.enrichRepo = async (bookmark) => bookmark;
        GitHubExporter.buildRepoProperties = () => ({ title: "x" });
        GitHubExporter._auditExport = () => {};
        OperationGuard.canExecute = () => true;

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
            const result = await exportGitHubSelectedToNotion(
                [
                    { itemKey: "owner/repo1", title: "Repo1", sourceType: "repos", raw: { html_url: "https://github.com/owner/repo1" } },
                    { itemKey: "owner/repo2", title: "Repo2", sourceType: "repos", raw: { html_url: "https://github.com/owner/repo2" } },
                    { itemKey: "owner/repo3", title: "Repo3", sourceType: "repos", raw: { html_url: "https://github.com/owner/repo3" } },
                ],
                { apiKey: "secret", databaseId: "db-1" }
            );
            expect(result.authAborted).toBeTruthy();
            expect(result.success.length).toBe(1);
            expect(result.failed.length).toBe(1);
            expect(result.skipped.length).toBe(1);
            expect(requestCalls).toBe(2); // 第 2 项即中止, 不再逐项 401
        } finally {
            GitHubExporter.setupDatabaseProperties = origSetup;
            GitHubExporter.enrichRepo = origEnrich;
            GitHubExporter.buildRepoProperties = origProps;
            GitHubExporter._auditExport = origAudit;
            OperationGuard.canExecute = origCanExecute;
            NotionAPI.request = origRequest;
        }
    });

    it("成功项账本经 finally 落盘(不丢已导出事实)", async () => {
        const { exportGitHubSelectedToNotion } = require("../src/import/github-obsidian-service");
        const { GitHubExporter } = require("../src/import/GitHubExporter");
        const { NotionAPI } = require("../src/api");
        const { OperationGuard } = require("../src/security");

        const origSetup = GitHubExporter.setupDatabaseProperties;
        const origEnrich = GitHubExporter.enrichRepo;
        const origProps = GitHubExporter.buildRepoProperties;
        const origAudit = GitHubExporter._auditExport;
        const origCanExecute = OperationGuard.canExecute;
        GitHubExporter.setupDatabaseProperties = async () => ({ success: true });
        GitHubExporter.enrichRepo = async (bookmark) => bookmark;
        GitHubExporter.buildRepoProperties = () => ({ title: "x" });
        GitHubExporter._auditExport = () => {};
        OperationGuard.canExecute = () => true;
        const origRequest = NotionAPI.request;
        NotionAPI.request = async () => ({ id: "page-ok" });

        try {
            const result = await exportGitHubSelectedToNotion(
                [{ itemKey: "owner/repo1", title: "R1", sourceType: "repos", raw: { html_url: "https://github.com/o/r1" } }],
                { apiKey: "secret", databaseId: "db-1" }
            );
            expect(result.success.length).toBe(1);
            const ledger = JSON.parse(store.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS) || "{}");
            expect(ledger["owner/repo1"]).toBeTruthy();
        } finally {
            GitHubExporter.setupDatabaseProperties = origSetup;
            GitHubExporter.enrichRepo = origEnrich;
            GitHubExporter.buildRepoProperties = origProps;
            GitHubExporter._auditExport = origAudit;
            OperationGuard.canExecute = origCanExecute;
            NotionAPI.request = origRequest;
        }
    });
});

describe("AUD-ARCH-01: _exportItems 认证终态 fail-fast", () => {
    it("首项 401 终态 → 立即中止: 仅 1 次请求, flushFn 在 finally 被调, skipped 正确", async () => {
        const { GitHubExporter } = require("../src/import/GitHubExporter");
        const { NotionAPI } = require("../src/api");
        const { OperationGuard } = require("../src/security");

        const origCanExecute = OperationGuard.canExecute;
        OperationGuard.canExecute = () => true;
        const origRequest = NotionAPI.request;
        let requestCalls = 0;
        NotionAPI.request = async () => {
            requestCalls++;
            const err = new Error("Notion OAuth 续签失败: invalid_grant (refresh_token 已使用或已过期)");
            err.isAuthTerminal = true;
            throw err;
        };
        const origAudit = GitHubExporter._auditExport;
        GitHubExporter._auditExport = () => {};
        const origEnrich = GitHubExporter.enrichRepo;
        GitHubExporter.enrichRepo = async (item) => item;

        try {
            const flushFn = vi.fn();
            const result = await GitHubExporter._exportItems(
                [{ full_name: "a/1" }, { full_name: "a/2" }, { full_name: "a/3" }],
                { apiKey: "secret", databaseId: "db-1" },
                "Star",
                () => ({}),
                () => false,
                () => {},
                (r) => r.full_name,
                undefined,
                flushFn
            );
            expect(result.authAborted).toBeTruthy();
            expect(result.exported).toBe(0);
            expect(result.failed).toBe(0); // 终态中止不计入 failed
            expect(result.skipped).toBe(3); // newItems - success - failed = 全部剩余项
            expect(requestCalls).toBe(1);
            expect(flushFn).toHaveBeenCalledTimes(1);
        } finally {
            OperationGuard.canExecute = origCanExecute;
            NotionAPI.request = origRequest;
            GitHubExporter._auditExport = origAudit;
            GitHubExporter.enrichRepo = origEnrich;
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
