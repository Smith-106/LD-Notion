import { describe, it, expect, beforeEach } from "vitest";

// ISS-20260914-001: Clipper(知乎/通用页)远端对账 —— 远端「链接」索引是 ground truth。
// GenericExporter.checkClipperRemote 三态:
//   远端命中 → exported=true + 回写账本; 远端未命中 → exported=false(本地账本 hit 被覆盖);
//   远端不可达 → 降级本地 DedupStore(旧语义)。
const { GenericExporter } = require("../src/export");
const { NotionAPI } = require("../src/api");
const { Storage, DedupStore } = require("../src/storage");
const { Utils } = require("../src/utils");
const { SiteDetector } = require("../src/api");

const META = { url: "https://zhuanlan.zhihu.com/p/12345", source: "知乎" };

const stubDedup = (isDup) => {
    DedupStore.isDuplicate = () => isDup;
    DedupStore.markSeen = () => {};
    DedupStore.beginBatch = () => {};
    DedupStore.endBatch = () => {};
};

describe("GenericExporter.checkClipperRemote 远端对账 (ISS-20260914-001)", () => {
    beforeEach(() => {
        globalThis.window = { location: { hostname: "zhuanlan.zhihu.com", href: META.url } };
        globalThis.location = { href: META.url };
        globalThis.GM_getValue = () => undefined;
        globalThis.GM_setValue = () => {};
        // zhihu 站点检测(不依赖真实 hostname)
        SiteDetector.detect = () => SiteDetector.SITES.ZHIHU;
    });

    it("T1: 远端命中 → exported=true(ground truth)", async () => {
        stubDedup(false); // 本地账本声称未导出
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://zhuanlan.zhihu.com/p/12345"]);
        const r = await GenericExporter.checkClipperRemote("tok", "db-1", META);
        expect(r.remote).not.toBe(null);
        expect(r.exported).toBe(true);
        expect(r.dedupKey).toMatch(/^zhihu:/);
    });

    it("T2: 远端可达但未命中 → exported=false(本地账本 hit 被覆盖, 换库场景)", async () => {
        stubDedup(true); // 本地账本残留声称已导出
        NotionAPI.collectDatabaseUrls = async () => new Set(); // 远端空(重建库)
        const r = await GenericExporter.checkClipperRemote("tok", "db-1", META);
        expect(r.exported).toBe(false); // KEY: 账本残留不阻断
    });

    it("T3: 远端不可达 → 降级本地账本(旧语义)", async () => {
        stubDedup(true);
        NotionAPI.collectDatabaseUrls = async () => { throw new Error("network down"); };
        const r = await GenericExporter.checkClipperRemote("tok", "db-1", META);
        expect(r.remote).toBe(null);
        expect(r.exported).toBe(true); // 降级账本 → 已导出
    });

    it("T4: 远端不可达 + 本地未导出 → exported=false", async () => {
        stubDedup(false);
        NotionAPI.collectDatabaseUrls = async () => { throw new Error("network down"); };
        const r = await GenericExporter.checkClipperRemote("tok", "db-1", META);
        expect(r.exported).toBe(false);
    });

    it("T5: 缺 apiKey/databaseId → 降级本地账本(不发远端查询)", async () => {
        stubDedup(true);
        let called = 0;
        NotionAPI.collectDatabaseUrls = async () => { called++; return new Set(); };
        const r1 = await GenericExporter.checkClipperRemote("", "db-1", META);
        const r2 = await GenericExporter.checkClipperRemote("tok", "", META);
        expect(called).toBe(0); // 无凭证/目标库 → 不查询
        expect(r1.remote).toBe(null);
        expect(r2.remote).toBe(null);
        expect(r1.exported).toBe(true); // 本地账本判定
    });

    it("T6: URL 归一化 — 远端带尾斜杠与本地 dedupKey 对齐", async () => {
        stubDedup(false);
        // 远端「链接」存的是带尾斜杠变体; collectDatabaseUrls 已 norm 去尾斜杠,
        // dedupKey URL 段 norm 后应命中
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://zhuanlan.zhihu.com/p/12345/"]);
        const r = await GenericExporter.checkClipperRemote("tok", "db-1", META);
        expect(r.exported).toBe(true);
    });

    it("T7: generic 源 dedupKey 前缀正确(非 zhihu 站点)", async () => {
        stubDedup(false);
        SiteDetector.detect = () => SiteDetector.SITES.GENERIC;
        const meta = { url: "https://example.com/a", source: "" };
        globalThis.location = { href: meta.url };
        NotionAPI.collectDatabaseUrls = async () => new Set(["https://example.com/a"]);
        const r = await GenericExporter.checkClipperRemote("tok", "db-1", meta);
        expect(r.dedupKey).toMatch(/^generic:/);
        expect(r.exported).toBe(true);
    });
});
