"use strict";

// P2 共识回归第三批: SyncSerializer 设置项 LWW 时间戳 / URL 键折叠 / 超长丢弃告警 /
// 远端 updatedAt 偏斜 + 导出目标四键跨页同步。
import { describe, it, expect, beforeEach, vi } from "vitest";

const { SyncSerializer } = require("../src/sync/SyncSerializer");
const { SyncCrypto } = require("../src/sync/SyncCrypto");
const { UI } = require("../src/ui/main-ui");
const { CONFIG } = require("../src/config");
const { Storage } = require("../src/storage");

const BASE_OPTS = { deviceId: "dev-a", mode: "personal", hashUrls: true };

beforeEach(() => {
    UI._targetWatchersInstalled = false;
    UI.panel = null;
    UI.refs = {};
});

describe("P2 共识: settings LWW 时间戳", () => {
    it("值未变则复用上次时间戳(推送不再刷新未修改设置)", async () => {
        const raw = { settings: { ldb_ai_model: "gpt-4", ldb_ai_service: "openai" } };
        const stamps = {};
        const first = await SyncSerializer.buildPayload(raw, { ...BASE_OPTS, now: 1000, stampsOut: stamps });
        expect(first.settings.ldb_ai_model.updatedAt).toBe(new Date(1000).toISOString());

        const second = await SyncSerializer.buildPayload(
            { ...raw, settingsStamps: stamps }, { ...BASE_OPTS, now: 999999, stampsOut: {} }
        );
        expect(second.settings.ldb_ai_model.updatedAt).toBe(new Date(1000).toISOString());
        expect(second.settings.ldb_ai_service.updatedAt).toBe(new Date(1000).toISOString());
    });

    it("值变更只推进该键时间戳, 未变键保持原时间戳", async () => {
        const stamps = {};
        await SyncSerializer.buildPayload(
            { settings: { ldb_ai_model: "gpt-4", ldb_ai_service: "openai" } },
            { ...BASE_OPTS, now: 1000, stampsOut: stamps }
        );
        const next = await SyncSerializer.buildPayload(
            { settings: { ldb_ai_model: "gpt-5", ldb_ai_service: "openai" }, settingsStamps: stamps },
            { ...BASE_OPTS, now: 2000, stampsOut: {} }
        );
        expect(next.settings.ldb_ai_model.updatedAt).toBe(new Date(2000).toISOString());
        expect(next.settings.ldb_ai_service.updatedAt).toBe(new Date(1000).toISOString());
    });

    it("无 stamps 时全部盖 now(首轮行为不变)", async () => {
        const payload = await SyncSerializer.buildPayload(
            { settings: { ldb_ai_model: "gpt-4" } }, { ...BASE_OPTS, now: 5000 }
        );
        expect(payload.settings.ldb_ai_model.updatedAt).toBe(new Date(5000).toISOString());
    });
});

describe("P2 共识: URL 键折叠与计数", () => {
    it("原文键与 h: 键折叠为同一输出键且取较大 ts", async () => {
        const url = "https://example.com/a";
        const hashed = `h:${await SyncCrypto.sha256Hex(url)}`;
        const now = Date.now();
        const payload = await SyncSerializer.buildPayload({
            dedupSets: { bookmark: { [url]: now - 1000, [hashed]: now } },
        }, BASE_OPTS);
        const set = payload.dedup.bookmark;
        expect(Object.keys(set)).toEqual([hashed]);
        expect(set[hashed]).toBe(now);
    });

    it("后迭代的旧 ts 不得覆盖已折叠的新 ts", async () => {
        const url = "https://example.com/b";
        const hashed = `h:${await SyncCrypto.sha256Hex(url)}`;
        const now = Date.now();
        const payload = await SyncSerializer.buildPayload({
            dedupSets: { bookmark: { [hashed]: now, [url]: now - 1000 } },
        }, BASE_OPTS);
        expect(payload.dedup.bookmark[hashed]).toBe(now);
    });
});

describe("P2 共识: 超长设置项", () => {
    it("超 1000 字符丢弃并告警(不再静默)", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const payload = await SyncSerializer.buildPayload({
            settings: { ldb_ai_templates: "x".repeat(1001), ldb_ai_model: "gpt-4" },
        }, BASE_OPTS);
        expect(payload.settings.ldb_ai_templates).toBeUndefined();
        expect(payload.settings.ldb_ai_model).toBeDefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("恰好 1000 字符保留", async () => {
        const payload = await SyncSerializer.buildPayload({
            settings: { ldb_ai_templates: "x".repeat(1000) },
        }, BASE_OPTS);
        expect(payload.settings.ldb_ai_templates.value.length).toBe(1000);
    });
});

describe("P2 共识: validateRemote settings updatedAt 偏斜", () => {
    const base = () => ({
        schemaVersion: require("../src/sync/constants").SyncConstants.SCHEMA_VERSION,
        deviceId: "d",
        updatedAt: new Date().toISOString(),
        version: 0,
        dedup: {},
        watermarks: {},
        settings: { ldb_ai_model: { value: "gpt-4", updatedAt: new Date().toISOString(), deviceId: "d" } },
    });

    it("越界(远期)updatedAt 被拒", () => {
        const payload = base();
        payload.settings.ldb_ai_model.updatedAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const result = SyncSerializer.validateRemote(payload, { now: Date.now() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("updatedAt");
    });

    it("正常 updatedAt 通过", () => {
        expect(SyncSerializer.validateRemote(base(), { now: Date.now() }).ok).toBe(true);
    });
});

describe("P2 共识: 导出目标四键跨页同步", () => {
    const installWithCapture = () => {
        const listeners = {};
        global.GM_addValueChangeListener = (key, cb) => { listeners[key] = cb; };
        UI.installTargetCrossPageWatchers();
        delete global.GM_addValueChangeListener;
        return listeners;
    };

    it("注册四键监听并在远端变更时回填输入/单选/摘要", () => {
        const listeners = installWithCapture();
        for (const key of [
            CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID,
            CONFIG.STORAGE_KEYS.PARENT_PAGE_ID,
            CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE,
            CONFIG.STORAGE_KEYS.AI_TARGET_DB,
        ]) {
            expect(typeof listeners[key]).toBe("function");
        }

        const summary = vi.fn();
        UI.panel = { querySelector: () => null };
        UI.updateExportTargetSummary = summary;
        const staleId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        const freshId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        UI.refs = {
            databaseIdInput: { value: staleId },
            parentPageIdInput: { value: "" },
            exportTargetPageRadio: { checked: false },
            exportTargetDatabaseRadio: { checked: true },
        };
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, freshId);

        listeners[CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID]("k", staleId, freshId, true);
        expect(UI.refs.databaseIdInput.value).toBe(freshId);
        expect(UI.refs.exportTargetDatabaseRadio.checked).toBe(true);
        expect(summary).toHaveBeenCalled();
    });

    it("remote=false(本页写入)不触发回填", () => {
        const listeners = installWithCapture();
        const summary = vi.fn();
        UI.panel = { querySelector: () => null };
        UI.updateExportTargetSummary = summary;
        UI.refs = { databaseIdInput: { value: "keep" } };
        listeners[CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID]("k", "a", "b", false);
        expect(UI.refs.databaseIdInput.value).toBe("keep");
        expect(summary).not.toHaveBeenCalled();
    });

    it("重复调用只注册一次", () => {
        const calls = [];
        global.GM_addValueChangeListener = (key) => { calls.push(key); };
        UI.installTargetCrossPageWatchers();
        UI.installTargetCrossPageWatchers();
        delete global.GM_addValueChangeListener;
        expect(calls.length).toBe(4);
    });
});
