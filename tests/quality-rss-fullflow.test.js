import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3-r2 (AT-009, L2): RSSAutoImporter.run() 全流程集成。
// 断言面: 增量 newItems → 建页/update → markItemSeen 落账 → snapshot 推进 → 双 emit → 返回契约。
// 夹具契约: stub buildSettings/getFeedUrls/SyncCoordinator.sync/fetchTrackedPages/enrichItem;
//           buildPageIndex/_syncSingleRssItem/_aggregateRssState 走真实; afterEach 还原。
const { RSSAutoImporter } = require("../src/bridge");
const { SyncCoordinator } = require("../src/adapter/SyncCoordinator");
const { NotionAPI } = require("../src/api");
const { SyncState } = require("../src/storage");
const { SyncLock } = require("../src/sync-lock");
const { Utils } = require("../src/utils");
const { on: subscribe } = require("../src/coordination/event-bus");

const mkItem = () => ({ title: "文章A", url: "https://a.com/1", itemKey: "rss:a.com/1" });

describe("AT-009: RSSAutoImporter.run() 全流程", () => {
    const saved = {};
    let emitted;
    let patch;
    let pageCalls;

    beforeEach(() => {
        saved.doc = global.document;
        global.document = { hidden: false, querySelector: () => null, querySelectorAll: () => [] };
        emitted = [];
        patch = null;
        pageCalls = [];
        saved.settings = RSSAutoImporter.buildSettings;
        saved.feeds = RSSAutoImporter.getFeedUrls;
        saved.sync = SyncCoordinator.sync;
        saved.tracked = RSSAutoImporter.fetchTrackedPages;
        saved.enrich = RSSAutoImporter.enrichItem;
        saved.getRssState = SyncState.getRssState;
        saved.updateRssState = SyncState.updateRssState;
        saved.request = NotionAPI.request;
        saved.updatePage = NotionAPI.updatePage;
        saved.sleep = Utils.sleep;
        saved.acquireLease = SyncLock.acquireLease;
        saved.releaseLease = SyncLock.releaseLease;

        RSSAutoImporter.lastRunAt = 0;
        RSSAutoImporter.isRunning = false;
        RSSAutoImporter.buildSettings = () => ({ apiKey: "tok", databaseId: "db-1", exportTargetType: "database" });
        RSSAutoImporter.getFeedUrls = () => ["https://example.com/feed"];
        SyncCoordinator.sync = async () => ({ newItems: [mkItem()], skippedCount: 0, watermark: null, pendingKeys: [mkItem().itemKey] });
        RSSAutoImporter.fetchTrackedPages = async () => [];
        RSSAutoImporter.enrichItem = async (item) => ({ ...item });
        SyncState.getRssState = () => ({ snapshot: {} });
        SyncState.updateRssState = (p) => { patch = p; };
        NotionAPI.request = async (method, endpoint, data) => {
            pageCalls.push({ method, endpoint, data });
            return { id: "p-rss-1" };
        };
        Utils.sleep = async () => {};
    });

    afterEach(() => {
        global.document = saved.doc;
        RSSAutoImporter.buildSettings = saved.settings;
        RSSAutoImporter.getFeedUrls = saved.feeds;
        SyncCoordinator.sync = saved.sync;
        RSSAutoImporter.fetchTrackedPages = saved.tracked;
        RSSAutoImporter.enrichItem = saved.enrich;
        SyncState.getRssState = saved.getRssState;
        SyncState.updateRssState = saved.updateRssState;
        NotionAPI.request = saved.request;
        NotionAPI.updatePage = saved.updatePage;
        Utils.sleep = saved.sleep;
        SyncLock.acquireLease = saved.acquireLease;
        SyncLock.releaseLease = saved.releaseLease;
    });

    it("新增条目: 创建→落账→snapshot 推进→双 emit→importedCount=1", async () => {
        ["bookmarks:updated", "sync:center-summary-updated"].forEach((ev) => subscribe(ev, () => emitted.push(ev)));
        const res = await RSSAutoImporter.run();
        expect(res.importedCount).toBe(1);
        expect(res.failedCount).toBe(0);
        // pageCalls 含 setupDatabaseProperties(GET/PATCH /databases) 旁路 → 过滤建页调用
        const creates = pageCalls.filter((c) => c.method === "POST" && c.endpoint === "/pages");
        expect(creates.length).toBe(1);
        expect(creates[0].data.parent).toEqual({ database_id: "db-1" });
        // snapshot 落 itemKey → pageId(成功项)
        expect(patch && patch.snapshot && patch.snapshot["rss:a.com/1"]).toBeTruthy();
        expect(patch.snapshot["rss:a.com/1"].pageId).toBe("p-rss-1");
        expect(emitted).toContain("bookmarks:updated");
        expect(emitted).toContain("sync:center-summary-updated");
    });

    it("已有条目(URL 变更命中): 走 update 不新建, importedCount=1", async () => {
        // needsUpdate 契约: ① snapshotEntry 为空时恒 false → 旧快照须存在;
        // ② byUrl 命中时 pageMeta.url 恒等 item.url → 差异通道是 title(≠ item.title)
        RSSAutoImporter.fetchTrackedPages = async () => [{ pageId: "p-old", url: "https://a.com/1", title: "旧标题" }];
        // needsUpdate 契约: snapshotEntry 为空时恒 false(unchanged) → 旧快照须存在且 URL 已变
        SyncState.getRssState = () => ({ snapshot: { "rss:a.com/1": { pageId: "p-old", url: "https://a.com/stale", title: "文章A" } } });
        const res = await RSSAutoImporter.run();
        expect(res.importedCount).toBe(1); // updated 计入
        const creates = pageCalls.filter((c) => c.method === "POST" && c.endpoint === "/pages");
        expect(creates.length).toBe(0); // 无新建
        expect(pageCalls.some((c) => c.method === "PATCH" && c.endpoint === "/pages/p-old")).toBe(true);
        expect(patch && patch.snapshot && patch.snapshot["rss:a.com/1"]).toBeTruthy();
        expect(patch.snapshot["rss:a.com/1"].pageId).toBe("p-old");
    });
});
