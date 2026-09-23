import { describe, it, expect, beforeEach, afterEach } from "vitest";

// odyssey-debug 20260913: 两导入器 errors 契约对齐(debug-notes-017) + LinuxDo 用户名
// API 第 5 探测(/session/current.json, cookie 认证与 DOM 无关) + UpdateChecker 语义审计回归
const { AutoImporter, UpdateChecker } = require("../src/import");
const { BookmarkAutoImporter, BookmarkBridge } = require("../src/bridge");
const { NotionOAuth } = require("../src/auth");
const { Storage, SyncState } = require("../src/storage");
const { SyncLock } = require("../src/sync-lock");
const { Utils } = require("../src/utils");
const { CONFIG } = require("../src/config");

describe("odyssey-debug 20260913: 导入器 errors 契约 + LinuxDo 用户名 API 探测", () => {
    const saved = {};
    const originals = {};

    beforeEach(() => {
        saved.acquireLease = SyncLock.acquireLease;
        saved.releaseLease = SyncLock.releaseLease;
        saved.renewLease = SyncLock.renewLease;
        saved.updateLinuxDoState = SyncState.updateLinuxDoState;
        saved.getAccessToken = NotionOAuth.getAccessToken;
        saved.storageGet = Storage.get;
        saved.extAvailable = BookmarkBridge.isExtensionAvailable;
        saved.usernameAsync = Utils.getCurrentLinuxDoUsernameAsync;

        originals.document = global.document;
        originals.window = global.window;
        originals.fetch = global.fetch;
        originals.gmRequest = global.GM_xmlhttpRequest;

        global.document = { hidden: false, querySelector: () => null };
        global.window = { location: { origin: "https://linux.do", pathname: "/" } };
        SyncLock.isExporting = false;
        AutoImporter.isRunning = false;
        AutoImporter.lastRunAt = 0;
        BookmarkAutoImporter.isRunning = false;
    });

    afterEach(() => {
        SyncLock.acquireLease = saved.acquireLease;
        SyncLock.releaseLease = saved.releaseLease;
        SyncLock.renewLease = saved.renewLease;
        SyncState.updateLinuxDoState = saved.updateLinuxDoState;
        NotionOAuth.getAccessToken = saved.getAccessToken;
        Storage.get = saved.storageGet;
        BookmarkBridge.isExtensionAvailable = saved.extAvailable;
        Utils.getCurrentLinuxDoUsernameAsync = saved.usernameAsync;

        if (originals.document === undefined) delete global.document; else global.document = originals.document;
        if (originals.window === undefined) delete global.window; else global.window = originals.window;
        if (originals.fetch === undefined) delete global.fetch; else global.fetch = originals.fetch;
        if (originals.gmRequest === undefined) delete global.GM_xmlhttpRequest; else global.GM_xmlhttpRequest = originals.gmRequest;
    });

    it("T1: DOM 探测全空 → API 第 5 探测返回用户名(去空白)", async () => {
        global.fetch = async () => ({ ok: true, json: async () => ({ current_user: { username: " nemo " } }) });
        await expect(Utils.getCurrentLinuxDoUsernameAsync()).resolves.toBe("nemo");
    });

    it("T2: API 非 200 → 返回空串(不抛错, 走既有错误链)", async () => {
        global.fetch = async () => ({ ok: false, json: async () => ({}) });
        await expect(Utils.getCurrentLinuxDoUsernameAsync()).resolves.toBe("");
    });

    it("T3: AutoImporter 用户名守卫经 errors 上抛(不再吞错)", async () => {
        SyncLock.acquireLease = async () => ({ owner: "t", expiresAt: Date.now() + 60000 });
        SyncLock.releaseLease = () => {};
        SyncLock.renewLease = () => true;
        SyncState.updateLinuxDoState = () => {};
        NotionOAuth.getAccessToken = () => "tok";
        Storage.get = (key, d) => (key === CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID ? "db-id" : d);
        Utils.getCurrentLinuxDoUsernameAsync = async () => "";

        const result = await AutoImporter.run();
        expect(result).toBeDefined();
        expect(result.importedCount).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/无法获取当前 Linux\.do 用户名/);
        expect(result.errors[0]).toMatch(/刷新|登录/);
        expect(AutoImporter.isRunning).toBe(false);
    });

    it("T4: Bookmark 守卫(桥接扩展缺失)经 errors 上抛", async () => {
        BookmarkBridge.isExtensionAvailable = () => false;
        NotionOAuth.getAccessToken = () => "tok";
        Storage.get = (key, d) => d;

        const result = await BookmarkAutoImporter.run();
        expect(result).toBeDefined();
        expect(result.importedCount).toBe(0);
        expect(result.errors).toEqual(["请先安装并启用书签桥接扩展"]);
    });

    it("T5: Bookmark 自动导入配置守卫(apiKey/dbId 缺失)经 errors 上抛", async () => {
        BookmarkBridge.isExtensionAvailable = () => true;
        NotionOAuth.getAccessToken = () => "tok";
        // 桥接扩展可用 + 数据库目标, 仅缺 apiKey/dbId → 命中配置守卫
        Storage.get = (key, d) => (
            key === CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE ? "database" : d
        );

        const result = await BookmarkAutoImporter.run();
        expect(result).toBeDefined();
        expect(result.importedCount).toBe(0);
        expect(result.errors).toEqual(["请先配置 Notion API Key 和数据库 ID"]);
    });

    it("T6: UpdateChecker 语义 — 失败有专文案且可比较版本(审计回归)", async () => {
        expect(UpdateChecker.compareVersions("3.14.9", "3.14.24")).toBe(-1);
        expect(UpdateChecker.compareVersions("3.14.24", "3.14.24")).toBe(0);
        global.GM_xmlhttpRequest = (opts) => {
            setTimeout(() => opts.onload({ status: 404, responseText: "" }), 0);
        };
        await expect(UpdateChecker.fetchLatestVersion()).rejects.toThrow(/HTTP 404/);
    });
});
