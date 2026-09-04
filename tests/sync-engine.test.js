"use strict";

// SyncEngine 集成测试(双设备收敛模拟 + Guard 接线)
import { describe, it, expect, beforeEach, vi } from "vitest";

// GM mock
const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;

const { CONFIG } = require("../src/config");
const { SyncState } = require("../src/storage");
const { SyncStateV2 } = require("../src/storage/SyncState");
const { DedupStore } = require("../src/storage/DedupStore");
const { SyncEngine } = require("../src/sync/SyncEngine");
const { SyncConfig } = require("../src/sync/SyncConfig");

// 简化 Guard(测试隔离)
const makeGuard = () => ({
    canExecute: () => true,
    execute: async (op, fn) => fn(),
});
const makeLog = () => ({
    add: (entry, opts) => { (globalThis.__auditLog = globalThis.__auditLog || []).push(entry); },
});

// 介质内存模拟(两设备共享)
const medium = { rows: [], createPageIds: 0 };

const fakeNotion = (name) => ({
    queryDatabase: async () => {
        // 模拟分页: 全部行一次返回
        return { results: medium.rows, has_more: false, next_cursor: null };
    },
    createDatabase: async () => ({ id: `db-${name}` }),
    updatePage: async () => ({}),
    request: async (method, endpoint, data, apiKey) => {
        if (method === "POST" && endpoint === "/pages") {
            medium.createPageIds++;
            const row = JSON.parse(data.properties["数据"].rich_text[0].text.content);
            const title = data.properties["键"].title[0].text.content;
            const kind = data.properties["类型"].rich_text[0].text.content;
            const key = title;
            medium.rows.push({
                id: `p-${medium.createPageIds}`,
                properties: {
                    "键": { title: [{ plain_text: key }] },
                    "类型": { rich_text: [{ plain_text: kind }] },
                    "版本": { number: 1 },
                    "更新时间": { rich_text: [{ plain_text: "2026-01-01T00:00:00.000Z" }] },
                    "设备": { rich_text: [{ plain_text: "dev-x" }] },
                    "数据": { rich_text: [{ plain_text: JSON.stringify(JSON.parse(data.properties["数据"].rich_text[0].text.content)) }] },
                },
            });
            return { id: `p-${medium.createPageIds}` };
        }
        return {};
    },
    deletePage: async () => ({}),
});

// 每个测试重置(注意: 模块级 cache 需手动重置)
const resetAll = () => {
    store.clear();
    medium.rows = [];
    medium.createPageIds = 0;
    SyncStateV2._cache = null;
    SyncStateV2._saveTimer = null;
    SyncStateV2._dirty = false;
    DedupStore._batchCache = null;
    DedupStore._batchSourceType = null;
    SyncEngine._deps = null;
    SyncEngine._running = false;
    SyncConfig._deviceId = null;
};

// 设备 B 场景: 清本地状态但保留介质(模拟另一台设备)
const resetLocalOnly = () => {
    store.clear();
    SyncStateV2._cache = null;
    SyncStateV2._saveTimer = null;
    SyncStateV2._dirty = false;
    DedupStore._batchCache = null;
    DedupStore._batchSourceType = null;
    SyncEngine._deps = null;
    SyncEngine._running = false;
    SyncConfig._deviceId = null;
};

const initEngine = (deviceName) => {
    store.set(CONFIG.STORAGE_KEYS.SYNC_ENABLED, true);
    store.set(CONFIG.STORAGE_KEYS.SYNC_MODE, "personal");
    store.set(CONFIG.STORAGE_KEYS.SYNC_DATABASE_ID, `db-${deviceName}`);
    SyncEngine.init({
        Storage: require("../src/storage").Storage,
        SyncStateV2,
        DedupStore,
        NotionAPI: fakeNotion(deviceName),
        OperationGuard: makeGuard(),
        OperationLog: makeLog(),
        apiKeyProvider: () => "test-key",
    });
};

describe("SyncEngine 双设备收敛", () => {
    beforeEach(() => {
        resetAll();
        // 设备 ID 固定
        store.set(CONFIG.STORAGE_KEYS.SYNC_DEVICE_ID, "a".repeat(32));
    });

    it("设备 A 标记去重 → push → 设备 B pull 后可见", async () => {
        initEngine("A");
        DedupStore.markSeen("linuxdo", "12345");
        SyncStateV2.updateSourceState("linuxdo", {
            watermark: { time: "2026-01-01T00:00:00.000Z", ids: ["1"] },
        });

        const pushResult = await SyncEngine.push({ reason: "test" });
        expect(pushResult.ok).toBe(true);
        expect(medium.rows.length).toBeGreaterThan(0);

        // 设备 B(重新 init, 空本地; 保留介质 = 模拟另一台设备)
        resetLocalOnly();
        initEngine("B");

        const pullResult = await SyncEngine.pull({ reason: "test" });
        expect(pullResult.ok).toBe(true);
        // 设备 B 本地账本应含 12345
        expect(DedupStore.isDuplicate("linuxdo", "12345")).toBe(true);
    });

    it("pull 应用 watermark 胜出项", async () => {
        initEngine("A");
        SyncStateV2.updateSourceState("rss", {
            watermark: { time: "2026-01-01T00:00:00.000Z", ids: ["x"] },
            epoch: 0,
        });
        await SyncEngine.push({ reason: "test" });

        store.set(CONFIG.STORAGE_KEYS.SYNC_DATABASE_ID, "db-b");
        resetLocalOnly();
        initEngine("B");
        await SyncEngine.pull({ reason: "test" });
        const st = SyncStateV2.getSourceState("rss");
        expect(st.watermark).toEqual({ time: "2026-01-01T00:00:00.000Z", ids: ["x"] });
    });

    it("本地已有更新的 watermark 不被覆盖(epoch 保护)", async () => {
        initEngine("A");
        SyncStateV2.updateSourceState("linuxdo", {
            watermark: { time: "2025-01-01T00:00:00.000Z", ids: ["old"] },
        });
        await SyncEngine.push({ reason: "test" });

        store.set(CONFIG.STORAGE_KEYS.SYNC_DATABASE_ID, "db-b");
        resetLocalOnly();
        initEngine("B");
        // 设备 B 本地有更新的 watermark
        SyncStateV2.updateSourceState("linuxdo", {
            watermark: { time: "2027-01-01T00:00:00.000Z", ids: ["new"] },
        });
        const before = SyncStateV2.getSourceState("linuxdo").watermark;
        await SyncEngine.pull({ reason: "test" });
        const after = SyncStateV2.getSourceState("linuxdo").watermark;
        expect(after).toEqual(before); // 不被远端旧值覆盖
    });

    it("未配置时 push/pull 返回 not-configured", async () => {
        resetAll();
        store.set(CONFIG.STORAGE_KEYS.SYNC_ENABLED, true);
        SyncEngine.init({
            Storage: require("../src/storage").Storage,
            SyncStateV2,
            DedupStore,
            NotionAPI: fakeNotion("X"),
            OperationGuard: makeGuard(),
            OperationLog: makeLog(),
        });
        const r = await SyncEngine.push({ reason: "test" });
        expect(r.outcome).toBe("not-configured");
    });

    it("Guard denied 时 push 记 guard.denied 审计(force)", async () => {
        resetAll();
        store.set(CONFIG.STORAGE_KEYS.SYNC_ENABLED, true);
        store.set(CONFIG.STORAGE_KEYS.SYNC_DATABASE_ID, "db-X");
        globalThis.__auditLog = [];
        SyncEngine.init({
            Storage: require("../src/storage").Storage,
            SyncStateV2,
            DedupStore,
            NotionAPI: fakeNotion("X"),
            OperationGuard: { canExecute: () => false, execute: async () => { throw new Error("not reached"); } },
            OperationLog: { add: (e) => (globalThis.__auditLog = globalThis.__auditLog || []).push(e) },
            apiKeyProvider: () => "test-key",
        });
        const r = await SyncEngine.push({ reason: "test" });
        expect(r.outcome).toBe("denied");
        expect(globalThis.__auditLog.some((e) => e.audit_event === "guard.denied")).toBe(true);
    });

    it("status 反映配置", () => {
        store.set(CONFIG.STORAGE_KEYS.SYNC_ENABLED, true);
        initEngine("A");
        const st = SyncEngine.getStatus();
        expect(st.enabled).toBe(true);
        expect(st.mode).toBe("personal");
        expect(st.deviceId).toMatch(/^[0-9a-f]{32}$/);
    });
});
