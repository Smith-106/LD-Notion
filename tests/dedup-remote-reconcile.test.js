import { describe, it, expect, beforeEach } from "vitest";

// odyssey-debug 20260914: 自动去重对账 Notion 实际状态(方案 A 对账式)
// —— 远端「链接」索引是 ground truth; 换库/重建库后账本残留不得阻断导出。
// 统一 require() 取模块实例(与 github-404-guidance.test.js 同模式, 保证跨模块 stub 落地)。
const { GitHubAPI, GitHubAutoImporter, AutoImporter } = require("../src/import");
const { NotionAPI } = require("../src/api");
const { Storage } = require("../src/storage");
const { NotionOAuth } = require("../src/auth");
const { BookmarkAutoImporter } = require("../src/bridge/BookmarkAutoImporter.js");
const { GitHubExporter } = require("../src/import/GitHubExporter.js");
const { SyncLock } = require("../src/sync-lock");
const { OperationGuard, OperationLog } = require("../src/security");
const { Utils } = require("../src/utils");
const { CONFIG } = require("../src/config");

const mkRepo = (id, url) => ({
    itemKey: `gh-${id}`,
    title: `repo-${id}`,
    url,
    raw: { id, full_name: `u/repo-${id}`, html_url: url, description: "", language: null },
});
const ghMeta = { getId: (r) => String(r.id), label: "Stars" };
const ghSettings = () => ({ apiKey: "tok", databaseId: "db-1", username: "u", token: "" });

// 建页 POST 走 NotionAPI.request(避开 GM_xmlhttpRequest 挂起), 记录调次
const stubPageCreation = (created) => {
    OperationGuard.canExecute = () => true;
    OperationLog.add = () => {};
    NotionAPI.request = async (_method, path) => {
        if (path === "/pages") {
            created.push(true);
            return { id: `page-${created.length}` };
        }
        throw new Error(`unexpected request: ${path}`);
    };
};
const stubExporterAndEnv = () => {
    GitHubExporter.enrichRepo = async (raw) => raw;
    GitHubExporter.buildRepoProperties = (r) => ({ "链接": { url: r.html_url } });
    GitHubExporter.buildGistProperties = (r) => ({ "链接": { url: r.html_url } });
    Utils.sleep = async () => {};
    Storage.set = () => {};
    Storage.get = (key, d) => (key === CONFIG.STORAGE_KEYS.REQUEST_DELAY ? 0 : d);
    NotionOAuth.getAccessToken = () => "tok";
    SyncLock.acquireLease = async () => ({ owner: "t", expiresAt: Date.now() + 60000 });
    SyncLock.releaseLease = () => {};
    SyncLock.renewLease = () => true;
    GitHubAPI.flushExported = () => {};
    GitHubAPI.flushGistsExported = () => {};
};

describe("odyssey-debug 20260914: 去重对账 Notion 实际状态", () => {
    beforeEach(() => {
        globalThis.GM_getValue = () => undefined;
        globalThis.GM_setValue = () => {};
        GitHubAutoImporter._leaseLost = false;
    });

    it("T1: collectDatabaseUrls 分页聚合 + 尾斜杠归一", async () => {
        const calls = [];
        NotionAPI.queryDatabase = async (db, _f, _s, cursor, _k, pageSize) => {
            calls.push({ db, cursor, pageSize });
            if (!cursor) {
                return { results: [{ properties: { "链接": { url: "https://github.com/u/a/" } } }], has_more: true, next_cursor: "c2" };
            }
            return { results: [{ properties: { "链接": { url: "https://linux.do/t/42" } } }, { properties: {} }], has_more: false };
        };
        const urls = await NotionAPI.collectDatabaseUrls("tok", "db-1");
        expect(calls).toHaveLength(2);
        expect(calls[0].pageSize).toBe(100);
        expect(urls.has("https://github.com/u/a")).toBe(true);
        expect(urls.has("https://linux.do/t/42")).toBe(true);
        expect(urls.size).toBe(2);
    });

    it("T2: GitHub 远端命中 → 跳过不建页", async () => {
        const created = [];
        stubPageCreation(created);
        stubExporterAndEnv();
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://github.com/u/repo-1"]);
        const result = await GitHubAutoImporter._exportViaGitHubExporter(
            [mkRepo("r1", "https://github.com/u/repo-1"), mkRepo("r2", "https://github.com/u/repo-2")],
            "stars", ghMeta, ghSettings()
        );
        expect(created).toHaveLength(1);
        expect(result.success.some((e) => e.itemKey === "gh-r1" && e.skippedExisting)).toBe(true);
        expect(result.created).toHaveLength(1);
    });

    it("T3: GitHub 远端未命中 + 账本命中 → 仍导出(账本残留不阻断, 换库场景)", async () => {
        const created = [];
        stubPageCreation(created);
        stubExporterAndEnv();
        NotionAPI.collectDatabaseUrls = async () => new Set();
        GitHubAPI.isExported = () => true; // 账本声称已导出(旧库残留)
        const result = await GitHubAutoImporter._exportViaGitHubExporter(
            [mkRepo("r1", "https://github.com/u/repo-1")],
            "stars", ghMeta, ghSettings()
        );
        expect(created).toHaveLength(1); // KEY: 账本 hit 被远端 ground truth 覆盖
        expect(result.created).toHaveLength(1);
    });

    it("T4: GitHub 远端查询失败 → 降级本地账本(旧语义)", async () => {
        const created = [];
        stubPageCreation(created);
        stubExporterAndEnv();
        NotionAPI.collectDatabaseUrls = async () => { throw new Error("network down"); };
        GitHubAPI.isExported = () => true;
        const result = await GitHubAutoImporter._exportViaGitHubExporter(
            [mkRepo("r1", "https://github.com/u/repo-1")],
            "stars", ghMeta, ghSettings()
        );
        expect(created).toHaveLength(0); // 降级账本 → 跳过
        expect(result.success[0].skippedExisting).toBe(true);
    });

    it("T5: LinuxDo resolveNewBookmarks 三分支(远端命中/未命中覆盖账本/降级账本)", () => {
        const bookmarks = [{ topic_id: "42" }, { topic_id: "43" }];
        Storage.isTopicExported = () => true;
        // 远端命中 42 → 只留 43
        expect(AutoImporter.resolveNewBookmarks({ bookmarks, dedupStrict: true, remoteUrls: new Set(["https://linux.do/t/42"]) }).map((b) => b.topic_id)).toEqual(["43"]);
        // 远端空 + 账本全 hit → 仍全导(账本残留不阻断)
        expect(AutoImporter.resolveNewBookmarks({ bookmarks, dedupStrict: true, remoteUrls: new Set() })).toHaveLength(2);
        // remoteUrls=null → 降级账本 → 全 skip
        expect(AutoImporter.resolveNewBookmarks({ bookmarks, dedupStrict: true, remoteUrls: null })).toHaveLength(0);
        // allow_duplicates → 不过滤
        expect(AutoImporter.resolveNewBookmarks({ bookmarks, dedupStrict: false, remoteUrls: null })).toHaveLength(2);
    });

    it("T6: Bookmark fetchTrackedPages 属性缺失 400 → 空索引自举(不硬失败)", async () => {
        NotionAPI.queryDatabase = async () => { throw new Error("Could not find property with name or id: 来源"); };
        const pages = await BookmarkAutoImporter.fetchTrackedPages("db-1", "tok");
        expect(pages).toEqual([]);
        // 非属性类错误原样上抛
        NotionAPI.queryDatabase = async () => { throw new Error("network unreachable"); };
        await expect(BookmarkAutoImporter.fetchTrackedPages("db-1", "tok")).rejects.toThrow("network unreachable");
    });

    // odyssey-debug 20260914(export-counter): 远端命中 skip 路径必须回写本地账本 ——
    // 否则账本缺失项每轮 skip 而永不落账, 待导出计数恒冻结(用户报「不能自动更新」根因)。
    it("T7: GitHub 远端命中 skip → 账本落账(gists/repos 两型)", async () => {
        const created = [];
        stubPageCreation(created);
        stubExporterAndEnv();
        const repoLedger = {};
        const gistLedger = {};
        GitHubAPI.getExported = () => repoLedger;
        GitHubAPI.getExportedGists = () => gistLedger;
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://github.com/u/repo-1", "https://gist.github.com/g9"]);
        await GitHubAutoImporter._exportViaGitHubExporter(
            [mkRepo("r1", "https://github.com/u/repo-1")],
            "stars", ghMeta, ghSettings()
        );
        expect(repoLedger["gh-r1"]).toBeTruthy();
        await GitHubAutoImporter._exportViaGitHubExporter(
            [mkRepo("g9", "https://gist.github.com/g9")],
            "gists", ghMeta, ghSettings()
        );
        expect(gistLedger["gh-g9"]).toBeTruthy();
    });

    it("T8: LinuxDo markRemoteExistingTopics 仅 strict 落账 + batch 纪律", () => {
        const { DedupStore } = require("../src/storage");
        const marked = [];
        Storage.markTopicExported = (id) => marked.push(id);
        let batchOpen = 0, batchClose = 0;
        DedupStore.beginBatch = () => { batchOpen++; };
        DedupStore.endBatch = () => { batchClose++; };
        const bookmarks = [{ topic_id: "42" }, { topic_id: "43" }, { topic_id: "44" }];
        const remoteUrls = new Set(["https://linux.do/t/42", "https://linux.do/t/44"]);
        const newBookmarks = AutoImporter.resolveNewBookmarks({ bookmarks, dedupStrict: true, remoteUrls });
        // 42/44 远端命中被滤除, 43 未命中留下
        expect(newBookmarks.map((b) => b.topic_id)).toEqual(["43"]);
        Storage._exportedTopicsCache = { stale: true };
        const n = AutoImporter.markRemoteExistingTopics({ bookmarks, newBookmarks, remoteUrls, dedupStrict: true });
        expect(n).toBe(2);
        expect(marked).toEqual(["42", "44"]);
        expect(batchOpen).toBe(1);
        expect(batchClose).toBe(1);
        expect(Storage._exportedTopicsCache).toBe(null); // endBatch 后缓存失效
        // allow_duplicates / 无 remoteUrls → 不落账不开 batch
        expect(AutoImporter.markRemoteExistingTopics({ bookmarks, newBookmarks, remoteUrls, dedupStrict: false })).toBe(0);
        expect(AutoImporter.markRemoteExistingTopics({ bookmarks, newBookmarks, remoteUrls: null, dedupStrict: true })).toBe(0);
        expect(batchOpen).toBe(1);
    });

    it("T9: BookmarkExporter 全部远端命中 → 落账 + 早退前 flush", async () => {
        const { BookmarkExporter } = require("../src/bridge/BookmarkExporter.js");
        const ledger = {};
        let flushed = null;
        BookmarkExporter.getExported = () => ledger;
        BookmarkExporter.flushExported = (obj) => { flushed = { ...obj }; };
        BookmarkExporter.setupDatabaseProperties = async () => ({ success: true });
        Utils.isBookmarkDedupStrict = () => true;
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://a.com/x", "https://b.com/y"]);
        const result = await BookmarkExporter.exportBookmarks({
            apiKey: "tok", databaseId: "db-1",
            bookmarks: [{ url: "https://a.com/x/", title: "A" }, { url: "https://b.com/y", title: "B" }],
        });
        expect(result.message).toBe("没有新的书签需要导出"); // 两项均远端命中 → 早退路径
        expect(flushed[Utils.normalizeDedupUrl("https://a.com/x/")]).toBeTruthy();
        expect(flushed[Utils.normalizeDedupUrl("https://b.com/y")]).toBeTruthy();
    });

    it("T10: reconcile 回填空快照回退主列表(不再静默 0 命中)", () => {
        const { WorkspaceInsight } = require("../src/ui/workspace-insight.js");
        const UIObj = require("../src/ui/main-ui").UI;
        // 空快照 + 主列表含 linuxdo/github 项; normalize/getCombined 为主js混入方法, 测试内同实现补齐
        UIObj.visualSnapshots = { linuxdo: [], github: [] };
        UIObj.bookmarks = [
            { source: "linuxdo", topic_id: "42" },
            { source: "github", itemKey: "u/repo-1", sourceType: "stars", raw: { html_url: "https://github.com/u/repo-1" } },
        ];
        UIObj.normalizeWorkspaceInsightUrl = (u) => String(u || "").trim().replace(/\/+$/, "");
        UIObj.getCombinedVisualBookmarks = () => [
            ...(Array.isArray(UIObj.visualSnapshots.linuxdo) ? UIObj.visualSnapshots.linuxdo : []),
            ...(Array.isArray(UIObj.visualSnapshots.github) ? UIObj.visualSnapshots.github : []),
        ];
        UIObj.recomputeExportStats = () => {};
        UIObj.updateSelectCount = () => {};
        UIObj.renderBookmarkList = () => {};
        const markedTopics = [];
        const markedGh = [];
        Storage.isTopicExported = () => false;
        Storage.markTopicExported = (id) => markedTopics.push(id);
        GitHubAPI.isExported = () => false;
        GitHubAPI.markExported = (k) => markedGh.push(k);
        GitHubAPI.flushExported = () => {};
        GitHubAPI.flushGistsExported = () => {};
        Utils.isLinuxDoDedupStrict = () => true;
        const matched = WorkspaceInsight.reconcileExportedFromWorkspace([
            { sourceUrl: "https://linux.do/t/42" },
            { sourceUrl: "https://github.com/u/repo-1" },
        ]);
        expect(matched).toBe(2);
        expect(markedTopics).toEqual(["42"]);
        expect(markedGh).toEqual(["u/repo-1"]);
    });
});
