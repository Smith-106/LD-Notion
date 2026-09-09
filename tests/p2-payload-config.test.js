"use strict";

// P2 共识回归第四批: SyncPayload merge/diffWinners 收敛性 + SyncConfig 设备身份/口令兼容
import { describe, it, expect, beforeEach } from "vitest";

const { SyncPayload } = require("../src/sync/SyncPayload");
const { SyncConfig } = require("../src/sync/SyncConfig");
const { CONFIG } = require("../src/config");

describe("P2 共识: SyncPayload 容器缺失容错", () => {
    it("merge 对缺失 dedup 容器不抛 TypeError", () => {
        const a = { schemaVersion: 1, deviceId: "a", updatedAt: "", version: 0, watermarks: {}, settings: {} };
        const b = { schemaVersion: 1, deviceId: "b", updatedAt: "", version: 0, dedup: { linuxdo: { k: 5 } } };
        const out = SyncPayload.merge(a, b);
        expect(out.dedup.linuxdo.k).toBe(5);
        expect(SyncPayload.merge(b, a).dedup.linuxdo.k).toBe(5);
    });
});

describe("P2 共识: diffWinners watermark 平局并集", () => {
    const local = (ids) => ({
        schemaVersion: 1, deviceId: "a", updatedAt: "", version: 0,
        dedup: {}, settings: {},
        watermarks: { linuxdo: { epoch: 3, time: "2026-01-01T00:00:00.000Z", ids } },
    });

    it("同 (epoch,time) 但远端多 id → 返回并集胜出", () => {
        const remote = local(["2"]);
        const winners = SyncPayload.diffWinners(local(["1"]), remote);
        expect(winners.watermarkWinners.length).toBe(1);
        expect(winners.watermarkWinners[0].watermark.ids).toEqual(["1", "2"]);
    });

    it("同 (epoch,time) 且 ids 一致 → 无胜出项", () => {
        const winners = SyncPayload.diffWinners(local(["1"]), local(["1"]));
        expect(winners.watermarkWinners.length).toBe(0);
    });

    it("远端严格更大 → 整段胜出(不做并集)", () => {
        const remote = {
            ...local(["9"]),
            watermarks: { linuxdo: { epoch: 4, time: "2026-02-02T00:00:00.000Z", ids: ["9"] } },
        };
        const winners = SyncPayload.diffWinners(local(["1"]), remote);
        expect(winners.watermarkWinners[0].watermark.ids).toEqual(["9"]);
    });
});

describe("P2 共识: settings LWW 交换律", () => {
    const entry = (value) => ({ value, updatedAt: "2026-01-01T00:00:00.000Z", deviceId: "same" });
    const payload = (e) => ({
        schemaVersion: 1, deviceId: "same", updatedAt: "", version: 0,
        dedup: {}, watermarks: {}, settings: { ldb_ai_model: e },
    });

    it("同刻同设备不同值 → 合并结果与入参顺序无关", () => {
        const a = payload(entry("gpt-4"));
        const b = payload(entry("gpt-5"));
        const ab = SyncPayload.merge(a, b).settings.ldb_ai_model.value;
        const ba = SyncPayload.merge(b, a).settings.ldb_ai_model.value;
        expect(ab).toBe(ba);
        expect(["gpt-4", "gpt-5"]).toContain(ab);
    });
});

describe("P2 共识: SyncConfig 设备身份与口令兼容", () => {
    beforeEach(() => {
        SyncConfig._deviceId = null;
        SyncConfig._deviceIdWatcherInstalled = false;
    });

    it("远端 deviceId 变更同步内存缓存(多标签页收敛)", () => {
        const listeners = {};
        global.GM_addValueChangeListener = (key, cb) => { listeners[key] = cb; };
        SyncConfig._installDeviceIdWatcher();
        delete global.GM_addValueChangeListener;

        const key = CONFIG.STORAGE_KEYS.SYNC_DEVICE_ID;
        expect(typeof listeners[key]).toBe("function");
        SyncConfig._deviceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        listeners[key](key, "", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", true);
        expect(SyncConfig._deviceId).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

        // 非法值忽略
        listeners[key](key, "", "not-an-id", true);
        expect(SyncConfig._deviceId).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    });

    it("isPassphraseSet 兼容字符串 \"true\"", () => {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_PASSPHRASE_SET, "true");
        expect(SyncConfig.isPassphraseSet()).toBe(true);
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_PASSPHRASE_SET, false);
        expect(SyncConfig.isPassphraseSet()).toBe(false);
    });
});
