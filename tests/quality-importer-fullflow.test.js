import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3 (AT-003/004/005, L2): 三个自动导入器 run() 全流程集成。
// 断言面: 远端对账落账 → 建页/update → 账本/watermark 推进 → 双 emit → 返回契约。
// 夹具契约: 跨模块 stub 用 require(); 建页 stub 走 NotionAPI.request; afterEach 还原。
const { AutoImporter, GitHubAutoImporter } = require("../src/import");
const { GitHubAPI } = require("../src/import/GitHubAPI.js");
const { NotionAPI } = require("../src/api");
const { Storage, SyncState, DedupStore } = require("../src/storage");
const { NotionOAuth } = require("../src/auth");
const { SyncLock } = require("../src/sync-lock");
const { Utils } = require("../src/utils");
const { OperationGuard, OperationLog } = require("../src/security");
const { BookmarkAutoImporter, BookmarkBridge, BookmarkExporter } = require("../src/bridge");
const { on: subscribe } = require("../src/coordination/event-bus");
const { CONFIG } = require("../src/config");

const mkGithubItem = () => ({
    id: 1,
    full_name: "u/repo-1",
    html_url: "https://github.com/u/repo-1",
    description: "desc",
    language: "JS",
    starred_at: "2026-09-01T00:00:00Z",
});

describe("AT-003: LinuxDo 自动导入 run() 全流程", () => {
    const saved = {};
    const originals = {};
    let emitLog;

    beforeEach(() => {
        emitLog = [];
        saved.acquireLease = SyncLock.acquireLease;
        saved.releaseLease = SyncLock.releaseLease;
        saved.renewLease = SyncLock.renewLease;
        saved.usernameAsync = Utils.getCurrentLinuxDoUsernameAsync;
        saved.strict = Utils.isLinuxDoDedupStrict;
        saved.sleep = Utils.sleep;
        saved.getAccessToken = NotionOAuth.getAccessToken;
        saved.storageGet = Storage.get;
        saved.markTopic = Storage.markTopicExported;
        saved.isTopic = Storage.isTopicExported;
        saved.getLinuxDoState = SyncState.getLinuxDoState;
        saved.updateLinuxDoState = SyncState.updateLinuxDoState;
        saved.exportTopic = ExporterRef.exportTopic;
        saved.collectUrls = NotionAPI.collectDatabaseUrls;
        saved.getBookmarkId = LinuxDoAPI.getBookmarkId;

        originals.document = global.document;
        global.document = { hidden: false, querySelector: () => null };
        SyncLock.isExporting = false;
        AutoImporter.isRunning = false;
        AutoImporter.lastRunAt = 0;
        SyncLock.acquireLease = async () => ({ owner: "t", expiresAt: Date.now() + 60000 });
        SyncLock.renewLease = () => true;
        SyncLock.releaseLease = () => {};
        Utils.getCurrentLinuxDoUsernameAsync = async () => "nemo";
        Utils.isLinuxDoDedupStrict = () => true;
        Utils.sleep = async () => {};
        NotionOAuth.getAccessToken = () => "tok";
        Storage.get = (key, d) => {
            if (key === CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE) return "database";
            if (key === CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID) return "db-1";
            return d;
        };
        SyncState.getLinuxDoState = () => ({ watermark: 0 });
        SyncState.updateLinuxDoState = () => {};
        LinuxDoAPI.getBookmarkId = (b) => String(b.topic_id || "");
        NotionAPI.collectDatabaseUrls = async () => new Set();
        subscribe("bookmarks:updated", () => emitLog.push("bookmarks:updated"));
        subscribe("sync:center-summary-updated", () => emitLog.push("sync:center-summary-updated"));
    });

    afterEach(() => {
        Object.assign(SyncLock, {
            acquireLease: saved.acquireLease, releaseLease: saved.releaseLease, renewLease: saved.renewLease,
        });
        Utils.getCurrentLinuxDoUsernameAsync = saved.usernameAsync;
        Utils.isLinuxDoDedupStrict = saved.strict;
        Utils.sleep = saved.sleep;
        NotionOAuth.getAccessToken = saved.getAccessToken;
        Storage.get = saved.storageGet;
        Storage.markTopicExported = saved.markTopic;
        Storage.isTopicExported = saved.isTopic;
        SyncState.getLinuxDoState = saved.getLinuxDoState;
        SyncState.updateLinuxDoState = saved.updateLinuxDoState;
        ExporterRef.exportTopic = saved.exportTopic;
        NotionAPI.collectDatabaseUrls = saved.collectUrls;
        LinuxDoAPI.getBookmarkId = saved.getBookmarkId;
        if (originals.document === undefined) delete global.document; else global.document = originals.document;
    });

    it("远端命中落账 + 新建导出 + 双 emit + watermark 推进", async () => {
        const marked = [];
        const exported = [];
        let statePatch = null;
        Storage.markTopicExported = (id) => marked.push(String(id));
        Storage.isTopicExported = () => false;
        SyncState.updateLinuxDoState = (patch) => { statePatch = patch; };
        ExporterRef.exportTopic = async (bookmark) => {
            exported.push(String(bookmark.topic_id));
            Storage.markTopicExported(String(bookmark.topic_id));
        };
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://linux.do/t/42"]);
        const realFetch = LinuxDoAPI.fetchBookmarksSince;
        LinuxDoAPI.fetchBookmarksSince = async () => [{ topic_id: "42", title: "A" }, { topic_id: "43", title: "B" }];

        try {
            const result = await AutoImporter.run();
            expect(exported).toEqual(["43"]); // 42 远端命中跳过, 43 新建
            expect(marked.sort()).toEqual(["42", "43"]); // 42 skip 落账, 43 导出落账
            expect(result).toEqual({ importedCount: 1, failedCount: 0, errors: [] });
            expect(statePatch.lastOutcome).toBe("success");
            expect(statePatch.watermark).toBeDefined();
            expect(emitLog).toContain("bookmarks:updated");
            expect(emitLog).toContain("sync:center-summary-updated");
        } finally {
            LinuxDoAPI.fetchBookmarksSince = realFetch;
        }
    });
});

describe("AT-004: GitHub 自动导入 run() 全流程", () => {
    const saved = {};
    let emitLog;

    beforeEach(() => {
        emitLog = [];
        saved.acquireLease = SyncLock.acquireLease;
        saved.releaseLease = SyncLock.releaseLease;
        saved.renewLease = SyncLock.renewLease;
        saved.sleep = Utils.sleep;
        saved.getAccessToken = NotionOAuth.getAccessToken;
        saved.getGithubState = SyncState.getGitHubState;
        saved.updateGithubState = SyncState.updateGitHubState;
        saved.updateGithubMeta = SyncState.updateGitHubMeta;
        saved.fetchTypeItems = GitHubAutoImporter.fetchTypeItems;
        saved.getImportTypes = GitHubAPI.getImportTypes;
        saved.getExported = GitHubAPI.getExported;
        saved.collectUrls = NotionAPI.collectDatabaseUrls;
        saved.request = NotionAPI.request;
        saved.canExecute = OperationGuard.canExecute;
        saved.logAdd = OperationLog.add;
        saved.enrich = GitHubExporterRef.enrichRepo;
        saved.buildProps = GitHubExporterRef.buildRepoProperties;

        global.document = { hidden: false, querySelector: () => null };
        SyncLock.isExporting = false;
        GitHubAutoImporter.isRunning = false;
        GitHubAutoImporter.lastRunAt = 0;
        SyncLock.acquireLease = async () => ({ owner: "t", expiresAt: Date.now() + 60000 });
        SyncLock.renewLease = () => true;
        SyncLock.releaseLease = () => {};
        Utils.sleep = async () => {};
        NotionOAuth.getAccessToken = () => "tok";
        GitHubAutoImporter.buildSettings = () => ({ apiKey: "tok", databaseId: "db-1", username: "octocat", token: "" });
        GitHubAPI.getImportTypes = () => ["stars"];
        SyncState.getGitHubState = () => ({ watermark: 0 });
        SyncState.updateGitHubState = () => {};
        SyncState.updateGitHubMeta = () => {};
        GitHubAPI.getExported = () => ({});
        OperationGuard.canExecute = () => true;
        OperationLog.add = () => {};
        subscribe("bookmarks:updated", () => emitLog.push("bookmarks:updated"));
        subscribe("sync:center-summary-updated", () => emitLog.push("sync:center-summary-updated"));
    });

    afterEach(() => {
        Object.assign(SyncLock, {
            acquireLease: saved.acquireLease, releaseLease: saved.releaseLease, renewLease: saved.renewLease,
        });
        Utils.sleep = saved.sleep;
        NotionOAuth.getAccessToken = saved.getAccessToken;
        SyncState.getGitHubState = saved.getGithubState;
        SyncState.updateGitHubState = saved.updateGithubState;
        SyncState.updateGitHubMeta = saved.updateGithubMeta;
        GitHubAutoImporter.fetchTypeItems = saved.fetchTypeItems;
        GitHubAPI.getImportTypes = saved.getImportTypes;
        GitHubAPI.getExported = saved.getExported;
        NotionAPI.collectDatabaseUrls = saved.collectUrls;
        NotionAPI.request = saved.request;
        OperationGuard.canExecute = saved.canExecute;
        OperationLog.add = saved.logAdd;
        GitHubExporterRef.enrichRepo = saved.enrich;
        GitHubExporterRef.buildRepoProperties = saved.buildProps;
    });

    it("created 建页落账 + watermark 推进 + 双 emit", async () => {
        let lastStatePatch = null;
        const created = [];
        GitHubAutoImporter.fetchTypeItems = async () => [mkGithubItem()];
        SyncState.updateGitHubState = (_type, patch) => { if (patch.watermark !== undefined || patch.lastStats) lastStatePatch = patch; };
        NotionAPI.collectDatabaseUrls = async () => new Set();
        NotionAPI.request = async (_m, path) => {
            if (path === "/pages") { created.push(path); return { id: `page-${created.length}` }; }
            throw new Error(`unexpected ${path}`);
        };
        GitHubExporterRef.enrichRepo = async (raw) => raw;
        GitHubExporterRef.buildRepoProperties = (r) => ({ "链接": { url: r.html_url } });

        const result = await GitHubAutoImporter.run();
        expect(created).toHaveLength(1);
        expect(result.importedCount).toBe(1);
        expect(result.failedCount).toBe(0);
        expect(result.errors).toEqual([]);
        expect(lastStatePatch.watermark).toBeDefined();
        expect(lastStatePatch.lastStats.exported).toBe(1);
        expect(emitLog).toContain("bookmarks:updated");
        expect(emitLog).toContain("sync:center-summary-updated");
    });

    it("skippedExisting(远端命中)计入 success 推进 watermark 且不建页", async () => {
        let lastStatePatch = null;
        const created = [];
        GitHubAutoImporter.fetchTypeItems = async () => [mkGithubItem()];
        SyncState.updateGitHubState = (_type, patch) => { if (patch.watermark !== undefined || patch.lastStats) lastStatePatch = patch; };
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://github.com/u/repo-1"]);
        NotionAPI.request = async () => { throw new Error("should not create"); };

        const result = await GitHubAutoImporter.run();
        expect(created).toHaveLength(0);
        // 契约: importedCount = 新建数; skippedExisting 不计为导入, 经 lastStats.skippedExisting
        // 单独计数 + watermark 推进(防重复拉取) + 账本落账(计数收敛) —— 三路各自表达
        expect(result.importedCount).toBe(0);
        expect(lastStatePatch.watermark).toBeDefined(); // watermark 仍推进
        expect(lastStatePatch.lastStats.skippedExisting).toBe(1);
        expect(lastStatePatch.lastStats.exported).toBe(0);
    });
});

describe("AT-005: Bookmark 自动同步快照式 run() 流", () => {
    const saved = {};
    let emitLog;

    beforeEach(() => {
        emitLog = [];
        saved.acquireLease = SyncLock.acquireLease;
        saved.releaseLease = SyncLock.releaseLease;
        saved.renewLease = SyncLock.renewLease;
        saved.sleep = Utils.sleep;
        saved.getAccessToken = NotionOAuth.getAccessToken;
        saved.getBookmarkState = SyncState.getBookmarkState;
        saved.updateBookmarkState = SyncState.updateBookmarkState;
        saved.loadCurrent = BookmarkAutoImporter.loadCurrentBookmarks;
        saved.fetchTracked = BookmarkAutoImporter.fetchTrackedPages;
        saved.setup = BookmarkExporter.setupDatabaseProperties;
        saved.enrich = BookmarkExporter.enrichBookmark;
        saved.buildProps = BookmarkExporter.buildProperties;
        saved.canExecute = OperationGuard.canExecute;
        saved.logAdd = OperationLog.add;
        saved.request = NotionAPI.request;
        saved.updatePage = NotionAPI.updatePage;

        global.document = { hidden: false, querySelector: () => null };
        SyncLock.isExporting = false;
        BookmarkAutoImporter.isRunning = false;
        BookmarkAutoImporter.lastRunAt = 0;
        SyncLock.acquireLease = async () => ({ owner: "t", expiresAt: Date.now() + 60000 });
        SyncLock.renewLease = () => true;
        SyncLock.releaseLease = () => {};
        Utils.sleep = async () => {};
        NotionOAuth.getAccessToken = () => "tok";
        BookmarkAutoImporter.buildSettings = () => ({ apiKey: "tok", databaseId: "db-1", exportTargetType: "database" });
        BookmarkBridge.isExtensionAvailable = () => true;
        BookmarkAutoImporter.loadCurrentBookmarks = async () => [
            { id: "b1", title: "书签A", url: "https://a.com/x", folderPath: "书签栏", dateAdded: 1000 },
        ];
        BookmarkExporter.setupDatabaseProperties = async () => ({ success: true });
        BookmarkExporter.enrichBookmark = async (b) => b;
        BookmarkExporter.buildProperties = (b) => ({ "标题": { title: [{ text: { content: b.title || "x" } }] } });
        OperationGuard.canExecute = () => true;
        OperationLog.add = () => {};
        SyncState.getBookmarkState = () => ({ snapshot: {} });
        SyncState.updateBookmarkState = () => {};
        subscribe("bookmarks:updated", () => emitLog.push("bookmarks:updated"));
        subscribe("sync:center-summary-updated", () => emitLog.push("sync:center-summary-updated"));
    });

    afterEach(() => {
        Object.assign(SyncLock, {
            acquireLease: saved.acquireLease, releaseLease: saved.releaseLease, renewLease: saved.renewLease,
        });
        Utils.sleep = saved.sleep;
        NotionOAuth.getAccessToken = saved.getAccessToken;
        SyncState.getBookmarkState = saved.getBookmarkState;
        SyncState.updateBookmarkState = saved.updateBookmarkState;
        BookmarkAutoImporter.loadCurrentBookmarks = saved.loadCurrent;
        BookmarkAutoImporter.fetchTrackedPages = saved.fetchTracked;
        BookmarkExporter.setupDatabaseProperties = saved.setup;
        BookmarkExporter.enrichBookmark = saved.enrich;
        BookmarkExporter.buildProperties = saved.buildProps;
        OperationGuard.canExecute = saved.canExecute;
        OperationLog.add = saved.logAdd;
        NotionAPI.request = saved.request;
        NotionAPI.updatePage = saved.updatePage;
    });

    it("新页 create → 落账 + snapshot 推进 + 双 emit", async () => {
        let lastSnapshotPatch = null;
        const created = [];
        BookmarkAutoImporter.fetchTrackedPages = async () => [];
        SyncState.updateBookmarkState = (patch) => { if (patch.snapshot) lastSnapshotPatch = patch; };
        NotionAPI.request = async (_m, path) => {
            if (path === "/pages") { created.push(path); return { id: "p-new" }; }
            throw new Error(`unexpected ${path}`);
        };

        const result = await BookmarkAutoImporter.run();
        expect(created).toHaveLength(1);
        expect(result.importedCount).toBe(1);
        expect(result.errors).toEqual([]);
        expect(lastSnapshotPatch.snapshot.b1.pageId).toBe("p-new");
        expect(emitLog).toContain("bookmarks:updated");
        expect(emitLog).toContain("sync:center-summary-updated");
    });

    it("已存在页(内容漂移)走 update 不重建", async () => {
        let lastSnapshotPatch = null;
        const created = [];
        const updated = [];
        BookmarkAutoImporter.fetchTrackedPages = async () => [
            { pageId: "p1", url: "https://a.com/x", bookmarkId: "b1" },
        ];
        SyncState.getBookmarkState = () => ({ snapshot: { b1: { title: "旧标题", pageId: "p1" } } });
        SyncState.updateBookmarkState = (patch) => { if (patch.snapshot) lastSnapshotPatch = patch; };
        NotionAPI.request = async () => { throw new Error("should not create"); };
        NotionAPI.updatePage = async (pageId) => { updated.push(pageId); return { id: pageId }; };

        const result = await BookmarkAutoImporter.run();
        expect(created).toHaveLength(0);
        expect(updated).toEqual(["p1"]);
        expect(result.importedCount).toBe(1);
        expect(lastSnapshotPatch.snapshot.b1.pageId).toBe("p1");
    });
});

const { Exporter: ExporterRef, LinuxDoAPI } = require("../src/export");
const { GitHubExporter: GitHubExporterRef } = require("../src/import/GitHubExporter.js");
