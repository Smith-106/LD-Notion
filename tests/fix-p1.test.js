"use strict";

// Run#3 (execute P1) 契约测试 —— 覆盖 P1 批次纯函数/存储契约层改动:
// CC-06/DedupStore rebase、DC-003 行预算、DC-002 投影裁剪、DC-007 键对齐、
// S-03/S-07 URL 白名单、S-08 脱敏、XN-03/XN-04 URL 校验、AUD-ARCH-05 模式判定
import { describe, it, expect, beforeEach } from "vitest";

const { DedupStore } = require("../src/storage/DedupStore");
const { SyncEngine } = require("../src/sync/SyncEngine");
const { SyncSerializer } = require("../src/sync/SyncSerializer");
const { Utils } = require("../src/utils");
const { CredentialVault } = require("../src/auth");
const { AISchema } = require("../src/ai/schema");
const { BlockConverter } = require("../src/ai/BlockConverter");
const { DOMToNotion } = require("../src/api/DOMToNotion");
const { RSSAutoImporter } = require("../src/bridge/RSSAutoImporter");
const { RSSAdapter } = require("../src/adapter/RSSAdapter");

// 必须与 DedupStore.keyFor 一致(ldb_exported_topics:{source})。
// 旧键 ldb_dedup_* 从未被生产读写 → rebase 用例假绿(写错键、读错键)。
const STORE_KEYS = Object.freeze({
    bookmark: DedupStore.keyFor("bookmark"),
    rss: DedupStore.keyFor("rss"),
});

describe("P1-CC-06: DedupStore beginBatch 幂等 + endBatch rebase", () => {
    beforeEach(() => {
        globalThis.GM_deleteValue(STORE_KEYS.bookmark);
    });

    it("beginBatch 幂等: 同源双 batch 各 mark, 末次 endBatch 后两者都在", () => {
        DedupStore.beginBatch("bookmark");
        DedupStore.beginBatch("bookmark"); // 重复 begin 不覆盖槽
        DedupStore.markSeen("bookmark", "bookmark:1");
        DedupStore.markSeen("bookmark", "bookmark:2");
        DedupStore.endBatch("bookmark");
        expect(DedupStore.isDuplicate("bookmark", "bookmark:1")).toBe(true);
        expect(DedupStore.isDuplicate("bookmark", "bookmark:2")).toBe(true);
    });

    it("endBatch rebase: 预置外部写入键(他 tab), batch 写回后键保留", () => {
        // 模拟他 tab 在 batch 期间直接落盘(ts 须在 TTL 窗内, 否则 urlKeyed 写回会淘汰)
        const externalTs = Date.now() - 1000;
        DedupStore.beginBatch("bookmark");
        // begin 之后再写入, 验证 dirtyKeys-only merge 不会整集覆写丢掉他 tab 键
        globalThis.GM_setValue(STORE_KEYS.bookmark, JSON.stringify({ "bookmark:external": externalTs }));
        DedupStore.markSeen("bookmark", "bookmark:local");
        DedupStore.endBatch("bookmark");
        const raw = JSON.parse(globalThis.GM_getValue(STORE_KEYS.bookmark, "{}"));
        expect(raw["bookmark:external"]).toBe(externalTs); // 他 tab 键保留(此前整集覆写会丢)
        // urlKeyed 源本地双写哈希键 → 用 isDuplicate 断言本项已落账
        expect(DedupStore.isDuplicate("bookmark", "bookmark:local")).toBe(true);
    });
});

describe("P1-DC-003: SyncEngine 行预算逐级截断", () => {
    it("watermark ids 超限 → 稳定序截断且行 ≤1900 字符", () => {
        const wm = { bookmark: { time: Date.now(), ids: Array.from({ length: 500 }, (_, i) => `bm${i}`.padEnd(50, "x")) } };
        const rows = [{
            kind: "dedup", key: "bookmark", version: 1, updatedAt: "", deviceId: "d",
            payload: { dedup: { bookmark: { "bookmark:1": Date.now() } }, watermarks: wm },
        }];
        const out = SyncEngine._enforceRowBudget(rows, 1900);
        expect(out.length).toBe(1);
        const payload = out[0].payload;
        expect(JSON.stringify(payload).length).toBeLessThanOrEqual(1900);
        // 前缀保留(稳定序)
        expect(payload.watermarks.bookmark.ids[0]).toBe("bm0".padEnd(50, "x"));
        expect(payload.watermarks.bookmark.ids.length).toBeLessThan(500);
        // dedup 条目未丢(预算内)
        expect(payload.dedup.bookmark["bookmark:1"]).toBeGreaterThan(0);
    });

    it("settings 超限 → 按字段分片(≤8 片, 每片 ≤1900), 字段全保留", () => {
        const settings = {};
        for (let i = 0; i < 20; i++) {
            settings[`field_${i}`] = { value: "v".repeat(120), updatedAt: 1, deviceId: "d" };
        }
        const rows = [{
            kind: "settings", key: "settings", version: 1, updatedAt: "", deviceId: "d",
            payload: { settings },
        }];
        const out = SyncEngine._enforceRowBudget(rows, 1900);
        expect(out.length).toBeGreaterThan(1);
        expect(out.length).toBeLessThanOrEqual(8);
        for (const row of out) {
            expect(JSON.stringify(row.payload).length).toBeLessThanOrEqual(1900);
        }
        const merged = Object.assign({}, ...out.map((r) => r.payload.settings));
        expect(Object.keys(merged).length).toBe(20);
        expect(merged.field_19.value).toBe("v".repeat(120));
    });
});

describe("P1-DC-002: SyncSerializer 全源新鲜度投影裁剪", () => {
    it("urlKeyed 源旧 ts(>90d)条目不投影, 新条目投影", async () => {
        const now = Date.now();
        const oldTs = now - 91 * 24 * 60 * 60 * 1000;
        const payload = await SyncSerializer.buildPayload({
            dedupSets: { bookmark: { "https://old.example/a": oldTs, "https://new.example/b": now } },
        }, { now, hashUrls: false });
        const set = payload.dedup.bookmark || {};
        expect(set["https://old.example/a"]).toBeUndefined(); // 全源裁剪(此前 urlKeyed 全量投递)
        expect(set["https://new.example/b"]).toBe(now);
    });
});

describe("P1-DC-007: RSSAdapter 键派生对齐", () => {
    it("normalize id 取 raw.id 优先, getDedupKey 与落账键空间一致", () => {
        const item = RSSAdapter.normalize({ id: "item-1", guid: "guid-1", link: "https://x.com/1" });
        expect(item.id).toBe("item-1");
        expect(RSSAdapter.getDedupKey(item)).toBe("rss:item-1");
    });

    it("无 id 时回退 guid/link", () => {
        expect(RSSAdapter.normalize({ guid: "g", link: "l" }).id).toBe("g");
        expect(RSSAdapter.normalize({ link: "l" }).id).toBe("l");
    });
});

describe("P1-S-03: BlockConverter bookmark/embed 服务端抓取面校验", () => {
    it("bookmark 内网/169.254 URL 拒绝", () => {
        expect(() => BlockConverter.buildBlockUpdatePayload({ type: "bookmark", bookmark: {} }, "https://169.254.169.254/latest/meta-data")).toThrow();
        expect(() => BlockConverter.buildBlockUpdatePayload({ type: "bookmark", bookmark: {} }, "javascript:alert(1)")).toThrow();
    });

    it("bookmark 公网 https 放行", () => {
        const r = BlockConverter.buildBlockUpdatePayload({ type: "bookmark", bookmark: {} }, "https://example.com/page");
        expect(r.bookmark.url).toBe("https://example.com/page");
    });

    it("embed 内网拒绝, 公网放行", () => {
        expect(() => BlockConverter.buildBlockUpdatePayload({ type: "embed", embed: {} }, "http://192.168.1.1/v")).toThrow();
        const r = BlockConverter.buildBlockUpdatePayload({ type: "embed", embed: {} }, "https://example.com/v.mp4");
        expect(r.embed.url).toBe("https://example.com/v.mp4");
    });
});

describe("P1-S-07: AISchema url 属性 scheme 白名单", () => {
    it("javascript:/data:/内网 → null(不写入)", () => {
        expect(AISchema.validatePropertyValue("javascript:alert(1)", "url")).toBeNull();
        expect(AISchema.validatePropertyValue("data:text/html,x", "url")).toBeNull();
        expect(AISchema.validatePropertyValue("http://10.0.0.1/x", "url")).toBeNull();
    });

    it("公网 http(s) 保留", () => {
        expect(AISchema.validatePropertyValue("https://example.com/a?b=1", "url")).toBe("https://example.com/a?b=1");
    });
});

describe("P1-S-08: CredentialVault.redactText 凭证片段脱敏", () => {
    it("token 形态正则 + 存储键名全部打码", () => {
        const out = CredentialVault.redactText(
            "token=ntn_1234567890abcdefghijklmnop, sk-proj-abcdef1234567890, Bearer abcdef1234567890, github_pat_1234567890abcdefgh, 见 ldb_notion_api_key"
        );
        expect(out).not.toContain("ntn_1234567890abcdefghijklmnop");
        expect(out).not.toContain("sk-proj-abcdef1234567890");
        expect(out).not.toContain("abcdef1234567890");
        expect(out).toContain("***REDACTED***");
        expect(out).not.toContain("ldb_notion_api_key");
    });

    it("普通文本原样保留", () => {
        expect(CredentialVault.redactText("hello world 中文")).toBe("hello world 中文");
    });
});

// Run#8 review 闭环 (NEW-01): persist 接线测试 —— finalResponse 脱敏后不得被原始赋值覆盖
// (此前 redact 后被紧随原始赋值覆盖为空操作, 单测只测 redactText 函数本身未覆盖落盘路径)
describe("P1-S-08b: AgentTrace.persist 落盘脱敏接线", () => {
    const { AgentTrace } = require("../src/ai");

    it("persist 落盘后 finalResponse/userInput/preview/errors 均脱敏", () => {
        const trace = AgentTrace.create("我的 token 是 ntn_1234567890abcdefghijklmnop");
        trace.results.push({ tool: "fetch_page", status: "ok", preview: "sk-proj-abcdef1234567890", iter: 1 });
        trace.errors.push("Err: Bearer abcdef1234567890");
        const persisted = AgentTrace.persist(trace, "completed", "好的, ntn_1234567890abcdefghijklmnop 已保存");
        expect(persisted.status).toBe("completed");
        expect(persisted.finalResponse).toContain("***REDACTED***");
        expect(persisted.finalResponse).not.toContain("ntn_1234567890abcdefghijklmnop");
        expect(persisted.userInput).not.toContain("ntn_1234567890abcdefghijklmnop");
        expect(persisted.results[0].preview).not.toContain("sk-proj-abcdef1234567890");
        expect(persisted.errors[0]).not.toContain("abcdef1234567890");
        expect(persisted.latencyMs).toBeGreaterThanOrEqual(0);
        expect(persisted._startedAt).toBeUndefined();
    });
});

describe("P1-XN-03: RSSAutoImporter.buildProperties 链接安全校验", () => {
    it("内网/169.254 链接属性跳过, 公网写入", () => {
        const bad = RSSAutoImporter.buildProperties({ url: "http://169.254.169.254/latest", title: "t", summary: "" });
        expect(bad["链接"]).toBeUndefined();
        const good = RSSAutoImporter.buildProperties({ url: "https://example.com/rss-item", title: "t", summary: "" });
        expect(good["链接"].url).toBe("https://example.com/rss-item");
    });
});

describe("P1-XN-04: DOMToNotion 链接降级 + iframe 白名单收紧", () => {
    it("_safeExternalUrl 拒非 http(s)/内网", () => {
        expect(DOMToNotion._safeExternalUrl("javascript:alert(1)")).toBe("");
        expect(DOMToNotion._safeExternalUrl("http://169.254.169.254/x")).toBe("");
        expect(DOMToNotion._safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    });

    it("_cookIframe: player. 子串兜底移除 —— player.evil.com 拒绝", () => {
        const blocks = [];
        const el = {
            getAttribute: (name) => (name === "src" ? "https://player.evil.com/video" : null),
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        expect(DOMToNotion._cookIframe(el, blocks)).toBe(false);
        expect(blocks.length).toBe(0);
    });

    it("_cookIframe: 白名单视频宿主放行", () => {
        const blocks = [];
        const el = {
            getAttribute: (name) => (name === "src" ? "https://www.youtube.com/embed/abc123" : null),
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        expect(DOMToNotion._cookIframe(el, blocks)).toBe(true);
        expect(blocks[0].type).toBe("embed");
    });
});

describe("P1-AUD-ARCH-05: Utils.isUserscriptMode 排除扩展垫片", () => {
    it("scriptHandler=chrome-extension → false(扩展模式)", () => {
        globalThis.GM_info = { scriptHandler: "chrome-extension" };
        expect(Utils.isUserscriptMode()).toBe(false);
        delete globalThis.GM_info;
    });

    it("无 GM_info → false", () => {
        delete globalThis.GM_info;
        expect(Utils.isUserscriptMode()).toBe(false);
    });

    it("TM/GM handler → true", () => {
        globalThis.GM_info = { scriptHandler: "Tampermonkey" };
        expect(Utils.isUserscriptMode()).toBe(true);
        delete globalThis.GM_info;
    });
});
