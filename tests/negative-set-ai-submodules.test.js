import { describe, it, expect, beforeEach } from "vitest";

// ISS-20260914-003 负集: ai/handlers/content、ai/tools/paginate、ai/utils/payload-builders
// 此前无直接单测文件。覆盖安全关键(payload SSRF 拒绝)与分页契约/转发壳。
const { NotionAPI } = require("../src/api");
const { UrlValidator } = require("../src/security/UrlValidator");
const payloadBuilders = require("../src/ai/utils/payload-builders");
const paginate = require("../src/ai/tools/paginate");
const contentHandlers = require("../src/ai/handlers/content");

describe("负集: ai/utils/payload-builders", () => {
    it("icon emoji → {type:emoji}; external 合法 HTTPS → external", () => {
        expect(payloadBuilders._buildPageIconPayload("emoji", "🔥")).toEqual({ type: "emoji", emoji: "🔥" });
        const r = payloadBuilders._buildPageIconPayload("external", "https://cdn.com/i.png");
        expect(r?.type).toBe("external");
        expect(r.external.url).toBe("https://cdn.com/i.png");
    });

    it("external/cover URL SSRF 拒绝(javascript:/内网/169.254)", () => {
        for (const bad of ["javascript:alert(1)", "http://169.254.169.254/x", "http://127.0.0.1/a", "http://10.0.0.1/a", "notaurl"]) {
            expect(payloadBuilders._buildPageIconPayload("external", bad)).toBe(null);
            expect(payloadBuilders._buildPageCoverPayload(bad)).toBe(null);
        }
    });

    it("icon/cover 空值 → null", () => {
        expect(payloadBuilders._buildPageIconPayload("", "x")).toBe(null);
        expect(payloadBuilders._buildPageIconPayload("emoji", "")).toBe(null);
        expect(payloadBuilders._buildPageCoverPayload("")).toBe(null);
        expect(payloadBuilders._buildPageIconPayload("unknown_type", "v")).toBe(null);
    });

    it("number 非有限值 → null(防 NaN 序列化静默清空)", () => {
        expect(payloadBuilders._buildPropertyValuePayload("number", "abc")).toEqual({ number: null });
        expect(payloadBuilders._buildPropertyValuePayload("number", 5)).toEqual({ number: 5 });
        expect(payloadBuilders._buildPropertyValuePayload("number", null)).toEqual({ number: null });
    });

    it("checkbox 严格真值('false'→false, true/1/'true'→true)", () => {
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", "false")).toEqual({ checkbox: false });
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", true)).toEqual({ checkbox: true });
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", 1)).toEqual({ checkbox: true });
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", "true")).toEqual({ checkbox: true });
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", 0)).toEqual({ checkbox: false });
    });

    it("select 空值→select:null; multi_select 数组化+滤空", () => {
        expect(payloadBuilders._buildPropertyValuePayload("select", "")).toEqual({ select: null });
        expect(payloadBuilders._buildPropertyValuePayload("select", "A")).toEqual({ select: { name: "A" } });
        expect(payloadBuilders._buildPropertyValuePayload("multi_select", ["a", "", "b"]))
            .toEqual({ multi_select: [{ name: "a" }, { name: "b" }] });
        expect(payloadBuilders._buildPropertyValuePayload("multi_select", "single"))
            .toEqual({ multi_select: [{ name: "single" }] });
    });

    it("rich_text/url/date 包装正确", () => {
        expect(payloadBuilders._buildPropertyValuePayload("rich_text", "hi"))
            .toEqual({ rich_text: [{ type: "text", text: { content: "hi" } }] });
        expect(payloadBuilders._buildPropertyValuePayload("date", "")).toEqual({ date: null });
        expect(payloadBuilders._buildPropertyValuePayload("date", "2026-01-01"))
            .toEqual({ date: { start: "2026-01-01" } });
    });
});

describe("负集: ai/tools/paginate", () => {
    beforeEach(() => {
        globalThis.GM_getValue = () => undefined;
        globalThis.GM_setValue = () => {};
    });

    it("queryAllPages 聚合分页结果", async () => {
        const calls = [];
        NotionAPI.request = async (_m, path, body) => {
            calls.push(body);
            if (calls.length === 1) {
                return { results: [{ id: "1" }, { id: "2" }], has_more: true, next_cursor: "c2" };
            }
            return { results: [{ id: "3" }], has_more: false };
        };
        const r = await paginate.queryAllPages({ dbId: "db", apiKey: "k" });
        expect(r.results).toHaveLength(3);
        expect(r.truncated).toBe(false);
        expect(calls[1].start_cursor).toBe("c2");
    });

    it("queryAllPages 损坏响应(results 非数组)优雅降级标记 truncated", async () => {
        NotionAPI.request = async () => ({ results: "corrupt", has_more: true });
        const r = await paginate.queryAllPages({ dbId: "db", apiKey: "k" });
        expect(r.truncated).toBe(true);
    });

    it("queryAllPages 达 maxPages 上限截断", async () => {
        NotionAPI.request = async () => ({ results: [{ id: "x" }], has_more: true, next_cursor: "n" });
        const r = await paginate.queryAllPages({ dbId: "db", apiKey: "k", maxPages: 3 });
        expect(r.results.length).toBeLessThanOrEqual(3);
        expect(r.truncated).toBe(true);
    });

    it("searchAllDatabases 聚合搜索页", async () => {
        let n = 0;
        NotionAPI.request = async () => {
            n++;
            return n === 1
                ? { results: [{ id: "d1", object: "database" }], has_more: true, next_cursor: "s2" }
                : { results: [{ id: "d2", object: "database" }], has_more: false };
        };
        const r = await paginate.searchAllDatabases({ apiKey: "k" });
        expect(r.results.length).toBeGreaterThanOrEqual(1);
        expect(r.truncated).toBe(false);
    });
});

describe("负集: ai/handlers/content (转发壳契约)", () => {
    it("_resolvePageId 转发至 NameResolver", async () => {
        const { NameResolver } = require("../src/ai/NameResolver");
        let called = null;
        const orig = NameResolver.resolvePageId;
        NameResolver.resolvePageId = async (n, i, k) => { called = [n, i, k]; return "resolved-id"; };
        try {
            const r = await contentHandlers._resolvePageId("页名", "id-1", "tok");
            expect(r).toBe("resolved-id");
            expect(called).toEqual(["页名", "id-1", "tok"]);
        } finally {
            NameResolver.resolvePageId = orig;
        }
    });

    it("_textToBlocks 转发至 BlockConverter", () => {
        const { BlockConverter } = require("../src/ai/BlockConverter");
        let called = null;
        const orig = BlockConverter.textToBlocks;
        BlockConverter.textToBlocks = (t) => { called = t; return ["blk"]; };
        try {
            const r = contentHandlers._textToBlocks("hello");
            expect(r).toEqual(["blk"]);
            expect(called).toBe("hello");
        } finally {
            BlockConverter.textToBlocks = orig;
        }
    });
});
