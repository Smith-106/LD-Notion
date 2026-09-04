"use strict";

// SyncSerializer/SyncCrypto/SyncFragmenter/SyncRateLimiter 契约测试
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
const { SyncSerializer, WHITELIST } = (() => {
    const m = require("../src/sync/SyncSerializer");
    return { SyncSerializer: m.SyncSerializer, WHITELIST: m.SyncSerializer.WHITELIST };
})();
const { SyncCrypto } = require("../src/sync/SyncCrypto");
const { SyncFragmenter } = require("../src/sync/SyncFragmenter");
const { SyncRateLimiter } = require("../src/sync/SyncRateLimiter");

const now = 1750000000000;

describe("SyncSerializer 黑名单硬拒(H-1)", () => {
    it("OAuth 三键在黑名单(不在 SENSITIVE_KEYS 也不能漏)", () => {
        expect(SyncSerializer.BLACKLIST).toContain("ldb_notion_api_key");
        expect(SyncSerializer.BLACKLIST).toContain("ldb_notion_oauth_client_secret");
        expect(SyncSerializer.BLACKLIST).toContain("ldb_notion_oauth_refresh_token");
    });

    it("安全姿态/审计/UI 瞬态在黑名单", () => {
        for (const k of ["ldb_permission_level", "ldb_enable_audit_log", "ldb_operation_log", "ldb_panel_minimized"]) {
            expect(SyncSerializer.BLACKLIST).toContain(k);
        }
    });

    it("RSS_FEED_URLS 硬黑(M-2)", () => {
        expect(SyncSerializer.BLACKLIST).toContain("ldb_rss_feed_urls");
    });

    it("assertNoBlacklisted 拦截黑名单键 payload", () => {
        const payload = {
            schemaVersion: 1,
            settings: { ldb_notion_api_key: { value: "sk-x", updatedAt: now, deviceId: "d" } },
            dedup: {},
            watermarks: {},
        };
        expect(() => SyncSerializer.assertNoBlacklisted(payload)).toThrow(/黑名单拦截/);
    });

    it("危险键 __proto__/constructor 拒收(H-3)", () => {
        // JSON.parse 模拟真实恶意介质(对象字面量 {__proto__:100} 只是原型设置,非自有键)
        const payload = JSON.parse('{"schemaVersion":1,"settings":{},"dedup":{"linuxdo":{"__proto__":100}},"watermarks":{}}');
        expect(() => SyncSerializer.assertNoBlacklisted(payload)).toThrow(/危险键/);
        const p2 = JSON.parse('{"schemaVersion":1,"settings":{},"dedup":{"linuxdo":{"constructor":1}},"watermarks":{}}');
        expect(() => SyncSerializer.assertNoBlacklisted(p2)).toThrow(/危险键/);
    });
});

describe("SyncSerializer 白名单默认拒绝", () => {
    it("buildPayload 丢弃非白名单设置键", async () => {
        const p = await SyncSerializer.buildPayload(
            { settings: { ldb_ai_api_key: "sk", ldb_ai_categories: "技术", ldb_unknown_new_key: "x" } },
            { deviceId: "d", now, mode: "personal" }
        );
        expect(p.settings["ldb_ai_categories"]).toBeDefined();
        expect(p.settings["ldb_ai_api_key"]).toBeUndefined();
        expect(p.settings["ldb_unknown_new_key"]).toBeUndefined();
    });

    it("shared 模式剔除 personal 项", async () => {
        const p = await SyncSerializer.buildPayload(
            { settings: { ldb_agent_persona_name: "x", ldb_ai_categories: "技术" } },
            { deviceId: "d", now, mode: "shared" }
        );
        expect(p.settings["ldb_agent_persona_name"]).toBeUndefined();
        expect(p.settings["ldb_ai_categories"]).toBeDefined();
    });

    it("类型强校验", async () => {
        const p = await SyncSerializer.buildPayload(
            { settings: { ldb_auto_import_enabled: "yes", ldb_sync_interval_linuxdo: "abc", ldb_workspace_max_pages: 5 } },
            { deviceId: "d", now }
        );
        expect(p.settings["ldb_auto_import_enabled"]).toBeUndefined();
        expect(p.settings["ldb_sync_interval_linuxdo"]).toBeUndefined();
        expect(p.settings["ldb_workspace_max_pages"].value).toBe(5);
    });

    it("dedup 源白名单 + URL 哈希化", async () => {
        const p = await SyncSerializer.buildPayload(
            { dedupSets: { linuxdo: { "123": 100 }, bookmark: { "https://a.com/x": 200 }, evil: { "k": 1 } } },
            { deviceId: "d", now }
        );
        expect(p.dedup.linuxdo["123"]).toBe(100);
        expect(p.dedup.evil).toBeUndefined();
        // bookmark url 键哈希化
        const keys = Object.keys(p.dedup.bookmark);
        expect(keys[0]).toMatch(/^h:[0-9a-f]{64}$/);
        expect(keys[0]).not.toContain("a.com");
    });

    it("URL 哈希确定性(同 URL 同哈希, M-1)", async () => {
        const mk = async () => {
            const p = await SyncSerializer.buildPayload(
                { dedupSets: { bookmark: { "https://a.com/x": 100 } } },
                { deviceId: "d", now }
            );
            return Object.keys(p.dedup.bookmark)[0];
        };
        expect(await mk()).toBe(await mk());
    });

    it("watermark 源白名单 + 结构", async () => {
        const p = await SyncSerializer.buildPayload(
            { watermarks: { linuxdo: { epoch: 1, time: "2026-01-01T00:00:00.000Z", ids: ["1"] }, evil: { epoch: 9, time: "x", ids: [] } } },
            { deviceId: "d", now }
        );
        expect(p.watermarks.linuxdo.epoch).toBe(1);
        expect(p.watermarks.evil).toBeUndefined();
    });
});

describe("SyncSerializer.validateRemote(H-2/H-5)", () => {
    it("schema 不匹配拒绝", () => {
        expect(SyncSerializer.validateRemote({ schemaVersion: 99, dedup: {}, watermarks: {}, settings: {} }, { now }).ok).toBe(false);
    });

    it("ts 未来偏斜拒绝(H-4)", () => {
        const payload = { schemaVersion: 1, dedup: { linuxdo: { "1": now + 10 * 60 * 1000 } }, watermarks: {}, settings: {} };
        expect(SyncSerializer.validateRemote(payload, { now }).ok).toBe(false);
    });

    it("epoch 通胀拒绝(H-5)", () => {
        const payload = {
            schemaVersion: 1,
            dedup: {},
            watermarks: { linuxdo: { epoch: 999999, time: "2026-01-01T00:00:00.000Z", ids: [] } },
            settings: {},
        };
        expect(SyncSerializer.validateRemote(payload, { now, localEpochs: { linuxdo: 0 } }).ok).toBe(false);
        // 本地+1 以内放行
        const ok = { ...payload, watermarks: { linuxdo: { epoch: 1, time: "2026-01-01T00:00:00.000Z", ids: [] } } };
        expect(SyncSerializer.validateRemote(ok, { now, localEpochs: { linuxdo: 0 } }).ok).toBe(true);
    });

    it("危险键/超长键拒绝", () => {
        const p1 = { schemaVersion: 1, dedup: { linuxdo: { constructor: 1 } }, watermarks: {}, settings: {} };
        expect(SyncSerializer.validateRemote(p1, { now }).ok).toBe(false);
        const p2 = { schemaVersion: 1, dedup: { linuxdo: { ["x".repeat(600)]: 1 } }, watermarks: {}, settings: {} };
        expect(SyncSerializer.validateRemote(p2, { now }).ok).toBe(false);
    });
});

describe("SyncCrypto", () => {
    it("encrypt/decrypt round-trip", async () => {
        const blob = await SyncCrypto.encryptBlob("pass123", "hello payload");
        expect(blob.v).toBe(1);
        expect(blob.salt).toBeTruthy();
        const plain = await SyncCrypto.decryptBlob("pass123", blob);
        expect(plain).toBe("hello payload");
    });

    it("错口令 throw", async () => {
        const blob = await SyncCrypto.encryptBlob("correct", "secret");
        await expect(SyncCrypto.decryptBlob("wrong", blob)).rejects.toThrow();
    });

    it("盐/IV 随机(两次加密结果不同)", async () => {
        const a = await SyncCrypto.encryptBlob("p", "same");
        const b = await SyncCrypto.encryptBlob("p", "same");
        expect(a.salt).not.toBe(b.salt);
        expect(a.iv).not.toBe(b.iv);
    });

    it("sha256Hex 确定性 + 非 djb2(64 hex)", async () => {
        const h1 = await SyncCrypto.sha256Hex("https://a.com");
        const h2 = await SyncCrypto.sha256Hex("https://a.com");
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("SyncFragmenter", () => {
    it("短文本单行", () => {
        const { rows } = SyncFragmenter.fragment("short");
        expect(rows).toEqual(["short"]);
        expect(SyncFragmenter.defragment(rows).ok).toBe(true);
    });

    it("长文本分片 round-trip", () => {
        const long = "x".repeat(50000) + "END";
        const { rows } = SyncFragmenter.fragment(long);
        expect(rows.length).toBeGreaterThan(1);
        const result = SyncFragmenter.defragment(rows);
        expect(result.ok).toBe(true);
        expect(result.text).toBe(long);
    });

    it("checksum 篡改 → 损坏且不回写", () => {
        const long = "y".repeat(45000);
        const { rows } = SyncFragmenter.fragment(long);
        rows[0] = rows[0].slice(0, -5) + "XXXXX";
        const result = SyncFragmenter.defragment(rows);
        expect(result.ok).toBe(false);
    });

    it("分片缺失检测", () => {
        const long = "z".repeat(45000);
        const { rows } = SyncFragmenter.fragment(long);
        const result = SyncFragmenter.defragment(rows.slice(0, rows.length - 1));
        expect(result.ok).toBe(false);
    });
});

describe("SyncRateLimiter", () => {
    beforeEach(() => {
        SyncRateLimiter._reset();
        vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());

    it("桶容量 3, 超出排队", async () => {
        SyncRateLimiter._tokens = 3;
        SyncRateLimiter._lastRefill = Date.now();
        const a = SyncRateLimiter.acquire();
        const b = SyncRateLimiter.acquire();
        const c = SyncRateLimiter.acquire();
        const d = SyncRateLimiter.acquire();
        await Promise.all([a, b, c]);
        expect(SyncRateLimiter._tokens).toBe(0);
        let resolved = false;
        d.then(() => { resolved = true; });
        await vi.advanceTimersByTimeAsync(1100);
        expect(resolved).toBe(true);
    });

    it("401/403/400 → fatal", () => {
        expect(SyncRateLimiter.classifyError({ status: 401 }).action).toBe("fatal");
        expect(SyncRateLimiter.classifyError({ status: 403 }).action).toBe("fatal");
        expect(SyncRateLimiter.classifyError({ status: 400 }).action).toBe("fatal");
        expect(SyncRateLimiter.classifyError({ status: 500 }).action).toBe("retry");
        expect(SyncRateLimiter.classifyError({ status: 429 }).action).toBe("retry");
    });

    it("退避封顶 30s", () => {
        expect(SyncRateLimiter.backoffMs(0)).toBe(1000);
        expect(SyncRateLimiter.backoffMs(4)).toBe(16000);
        expect(SyncRateLimiter.backoffMs(10)).toBe(30000);
    });
});
