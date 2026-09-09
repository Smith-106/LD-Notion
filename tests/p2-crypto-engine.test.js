"use strict";

// P2 共识回归第五批: SyncCrypto Node 兜底 GCM 标签 + SyncEngine 禁用闸门/分片稳定性/行预算/重置
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
const nodeCrypto = require("crypto");

const { SyncCrypto } = require("../src/sync/SyncCrypto");
const { SyncEngine } = require("../src/sync/SyncEngine");
const { SyncConfig } = require("../src/sync/SyncConfig");
const { CONFIG } = require("../src/config");

const stubNodeCryptoEnv = () => {
    vi.stubGlobal("crypto", { getRandomValues: (arr) => nodeCrypto.randomFillSync(arr) });
};

describe("P2 共识: SyncCrypto Node 兜底 GCM", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("无 subtle 时加密/解密往返成功(auth tag 已追加)", async () => {
        stubNodeCryptoEnv();
        const blob = await SyncCrypto.encryptBlob("pass-1", "hello 世界");
        expect(blob.v).toBe(1);
        expect(typeof blob.ct).toBe("string");
        const plain = await SyncCrypto.decryptBlob("pass-1", blob);
        expect(plain).toBe("hello 世界");
    });

    it("subtle 加密的 blob 可被 Node 兜底解密(格式互通)", async () => {
        const blob = await SyncCrypto.encryptBlob("pass-2", "cross-env");
        stubNodeCryptoEnv();
        expect(await SyncCrypto.decryptBlob("pass-2", blob)).toBe("cross-env");
    });

    it("Node 兜底加密的 blob 可被 subtle 解密", async () => {
        stubNodeCryptoEnv();
        const blob = await SyncCrypto.encryptBlob("pass-3", "cross-env-2");
        vi.unstubAllGlobals();
        expect(await SyncCrypto.decryptBlob("pass-3", blob)).toBe("cross-env-2");
    });

    it("错口令抛错(标签校验生效)", async () => {
        stubNodeCryptoEnv();
        const blob = await SyncCrypto.encryptBlob("right", "secret");
        await expect(SyncCrypto.decryptBlob("wrong", blob)).rejects.toThrow();
    });
});

describe("P2 共识: push 禁用闸门", () => {
    beforeEach(() => {
        SyncConfig.setEnabled(false);
        SyncEngine._running = false;
    });
    afterEach(() => SyncConfig.setEnabled(true));

    it("禁用时 push 直接返回 disabled 且不取依赖", async () => {
        const result = await SyncEngine.push({ reason: "test" });
        expect(result).toEqual({ ok: false, outcome: "disabled" });
    });
});

describe("P2 共识: settings 分片键稳定", () => {
    it("同一字段在任何字段集合/值规模下落入同一分片键", () => {
        const small = SyncEngine._splitSettingsRow({
            version: 1, updatedAt: "", deviceId: "d",
            payload: { settings: { ldb_ai_model: { value: "a" }, ldb_ai_service: { value: "b" } } },
        });
        const large = SyncEngine._splitSettingsRow({
            version: 1, updatedAt: "", deviceId: "d",
            payload: {
                settings: {
                    ldb_ai_model: { value: "a" },
                    ldb_ai_service: { value: "b" },
                    ldb_ai_templates: { value: "x".repeat(1000) },
                    ldb_agent_persona_instructions: { value: "y".repeat(1000) },
                },
            },
        });
        const keyOf = (shards, field) => shards.find((s) => field in s.payload.settings)?.key;
        expect(keyOf(large, "ldb_ai_model")).toBe(keyOf(small, "ldb_ai_model"));
        expect(keyOf(large, "ldb_ai_service")).toBe(keyOf(small, "ldb_ai_service"));
        // 分片键不含位置序号语义(0-7 桶 + 可选子片)
        for (const s of large) expect(s.key).toMatch(/^settings#\d(-\d)?$/);
    });

    it("总片数封顶 8", () => {
        const settings = {};
        for (let i = 0; i < 40; i++) settings[`f_${i}`] = { value: "v".repeat(400) };
        const shards = SyncEngine._splitSettingsRow({
            version: 1, updatedAt: "", deviceId: "d", payload: { settings },
        });
        expect(shards.length).toBeLessThanOrEqual(8);
        const merged = Object.assign({}, ...shards.map((s) => s.payload.settings));
        expect(Object.keys(merged).length).toBe(40);
    });
});

describe("P2 共识: 行预算包装开销实测", () => {
    it("dedup + watermark 行截断后不超预算(无 ids 可截)", () => {
        const set = {};
        for (let i = 0; i < 200; i++) set[`linuxdo:${i}`] = Date.now();
        const rows = [{
            kind: "dedup", key: "linuxdo", version: 1, updatedAt: "", deviceId: "d",
            payload: {
                dedup: { linuxdo: set },
                watermarks: { linuxdo: { epoch: 1, time: "2026-01-01T00:00:00.000Z", ids: [] } },
            },
        }];
        const out = SyncEngine._enforceRowBudget(rows, 1900);
        expect(out.length).toBe(1);
        expect(JSON.stringify(out[0].payload).length).toBeLessThanOrEqual(1900);
        expect(Object.keys(out[0].payload.dedup.linuxdo).length).toBeGreaterThan(0);
    });
});

describe("P2 共识: resetRemote 归档数据库", () => {
    const savedDeps = SyncEngine._deps;
    beforeEach(() => SyncConfig.setDatabaseId("11111111111111111111111111111111"));
    afterEach(() => {
        SyncEngine._deps = savedDeps;
        SyncConfig.setDatabaseId("");
    });

    it("成功: PATCH /databases/<id> {archived:true} 并清空本地引用", async () => {
        const request = vi.fn().mockResolvedValue({});
        SyncEngine._deps = {
            NotionAPI: { request },
            OperationGuard: { execute: async (_op, fn) => fn() },
        };
        const result = await SyncEngine.resetRemote({ confirm: true });
        expect(result.ok).toBe(true);
        expect(request).toHaveBeenCalledWith(
            "PATCH", "/databases/11111111111111111111111111111111", { archived: true }, expect.anything()
        );
        expect(SyncConfig.getDatabaseId()).toBe("");
    });

    it("失败: 向上抛错且保留本地 databaseId", async () => {
        const request = vi.fn().mockRejectedValue(new Error("forbidden"));
        SyncEngine._deps = {
            NotionAPI: { request },
            OperationGuard: { execute: async (_op, fn) => fn() },
        };
        await expect(SyncEngine.resetRemote({ confirm: true })).rejects.toThrow("forbidden");
        expect(SyncConfig.getDatabaseId()).toBe("11111111111111111111111111111111");
    });
});
