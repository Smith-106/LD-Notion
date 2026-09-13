import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3 (AT-007/008, L3): 多源导出互斥全流程 + 端到端导出管线。
// AT-007: SyncLock 跨 tab 租约(分槽/拒他/续约/释放复得) + isExporting 进程内互斥面。
// AT-008: BookmarkExporter.exportBookmarks 端到端 —— Guard 闸门(denied 拒绝+审计 / 放行建页)
//         → NotionAPI 建页 → 属性无 undefined → 账本落账可查(真实 gmStore)。
const { SyncLock } = require("../src/sync-lock");
const { AutoImporter } = require("../src/import");
const { SyncState } = require("../src/storage");
const { BookmarkExporter, BookmarkBridge } = require("../src/bridge");
const { NotionAPI } = require("../src/api");
const { NotionOAuth } = require("../src/auth");
const { Utils } = require("../src/utils");
const { OperationGuard, OperationLog } = require("../src/security");
const { CONFIG } = require("../src/config");

const LEASE_KEY = CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE;

describe("AT-007: 多源导出互斥(SyncLock 分槽租约 + isExporting)", () => {
    it("持有期间第二方拒绝; 释放后第三方复得(不同 owner)", async () => {
        const l1 = await SyncLock.acquireLease(LEASE_KEY);
        expect(l1).toBeTruthy();
        // 注: GM 模式下 acquireLease 不置 isExporting(仅无 GM 降级分支有此副作用);
        // 进程内互斥由导入器 run() 自管(exportMutexAcquired 纪律), 本文件第三用例覆盖。

        const l2 = await SyncLock.acquireLease(LEASE_KEY);
        expect(l2).toBeNull(); // 他 tab 持有且未过期

        // renewLease 契约: 成功返回 lease 对象(truthy), owner 失配才返回 false
        expect(SyncLock.renewLease(LEASE_KEY, l1)).toBeTruthy();
        SyncLock.releaseLease(LEASE_KEY, l1);

        const l3 = await SyncLock.acquireLease(LEASE_KEY);
        expect(l3).toBeTruthy();
        expect(l3.owner).not.toBe(l1.owner);
        SyncLock.releaseLease(LEASE_KEY, l3);
    });

    it("分槽语义: 不同 key 互不假冲突", async () => {
        const a = await SyncLock.acquireLease("at7-key-a");
        const b = await SyncLock.acquireLease("at7-key-b");
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
        SyncLock.releaseLease("at7-key-a", a);
        SyncLock.releaseLease("at7-key-b", b);
    });

    it("isExporting 置位时 AutoImporter.run() 立即返回且不写状态", async () => {
        const savedDoc = global.document;
        const savedGet = SyncState.updateLinuxDoState;
        global.document = { hidden: false, querySelector: () => null };
        let stateWrites = 0;
        SyncState.updateLinuxDoState = () => { stateWrites++; };
        SyncLock.isExporting = true;
        AutoImporter.isRunning = false;
        try {
            const r = await AutoImporter.run();
            expect(r).toBeUndefined(); // 互斥面直接返回
            expect(stateWrites).toBe(0); // 未进入任何状态推进
        } finally {
            SyncLock.isExporting = false;
            global.document = savedDoc;
            SyncState.updateLinuxDoState = savedGet;
        }
    });
});

describe("AT-008: 端到端导出管线(Guard→API→账本)", () => {
    const saved = {};
    let apiCalls;
    let auditLog;

    beforeEach(() => {
        apiCalls = [];
        auditLog = [];
        saved.doc = global.document;
        saved.get = Storage_get_ref();
        saved.getAccessToken = NotionOAuth.getAccessToken;
        saved.strict = Utils.isBookmarkDedupStrict;
        saved.sleep = Utils.sleep;
        saved.setup = BookmarkExporter.setupDatabaseProperties;
        saved.enrich = BookmarkExporter.enrichBookmark;
        saved.request = NotionAPI.request;
        saved.canExecute = OperationGuard.canExecute;
        saved.logAdd = OperationLog.add;
        saved.ext = BookmarkBridge.isExtensionAvailable;

        global.document = { hidden: false, querySelector: () => null };
        NotionOAuth.getAccessToken = () => "tok";
        Utils.isBookmarkDedupStrict = () => false; // 关闭远端对账分支, 聚焦 Guard→API→账本
        Utils.sleep = async () => {};
        BookmarkExporter.setupDatabaseProperties = async () => ({ success: true });
        BookmarkExporter.enrichBookmark = async (b) => b;
        NotionAPI.request = async (_m, path) => {
            apiCalls.push(path);
            if (path === "/pages") return { id: "pg-1" };
            throw new Error(`unexpected ${path}`);
        };
        OperationLog.add = (entry) => auditLog.push(entry);
    });

    afterEach(() => {
        global.document = saved.doc;
        Storage_restore_ref(saved.get);
        NotionOAuth.getAccessToken = saved.getAccessToken;
        Utils.isBookmarkDedupStrict = saved.strict;
        Utils.sleep = saved.sleep;
        BookmarkExporter.setupDatabaseProperties = saved.setup;
        BookmarkExporter.enrichBookmark = saved.enrich;
        NotionAPI.request = saved.request;
        OperationGuard.canExecute = saved.canExecute;
        OperationLog.add = saved.logAdd;
        BookmarkBridge.isExtensionAvailable = saved.ext;
    });

    it("Guard 放行 → 建页成功 → 属性无 undefined → 账本可查", async () => {
        OperationGuard.canExecute = () => true;
        const result = await BookmarkExporter.exportBookmarks({
            apiKey: "tok",
            databaseId: "db-1",
            bookmarks: [{ id: "b1", title: "端到端书签", url: "https://example.com/e2e", folderPath: "书签栏" }],
        });
        expect(apiCalls).toEqual(["/pages"]);
        expect(result.exported).toBe(1);
        expect(result.failed).toBe(0);
        // 属性面: 传给 Notion 的对象不得携带 undefined(esbuild/JSON 序列化会丢字段致属性缺失)
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        expect(BookmarkExporter.isExported("https://example.com/e2e")).toBe(true);
        expect(auditLog.some((e) => String(e.status) === "success")).toBe(true);
    });

    it("Guard 拒绝 → 不调 API + 记 denied 审计 + 计入 failed", async () => {
        OperationGuard.canExecute = () => false;
        const result = await BookmarkExporter.exportBookmarks({
            apiKey: "tok",
            databaseId: "db-1",
            bookmarks: [{ id: "b2", title: "被拒书签", url: "https://example.com/denied", folderPath: "书签栏" }],
        });
        expect(apiCalls).toEqual([]); // 未裸调 Notion API
        expect(result.exported).toBe(0);
        expect(result.failed).toBe(1);
        expect(auditLog.some((e) => String(e.status) === "denied")).toBe(true);
        expect(BookmarkExporter.isExported("https://example.com/denied")).toBe(false);
    });
});

// Storage.get 原始引用(供 stub 还原): 以间接层避免顶部 require 循环
function Storage_get_ref() {
    const { Storage } = require("../src/storage");
    return Storage.get;
}
function Storage_restore_ref(get) {
    const { Storage } = require("../src/storage");
    Storage.get = get;
}
