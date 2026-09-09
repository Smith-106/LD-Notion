import { describe, it, expect, beforeEach, afterEach } from "vitest";

// P4 第二批(b)/第四批回归: BookmarkExporter SSRF/字节上限/AI 闸门/认证终态透传 + 上传分片预检
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter.js");
const { NotionAPI } = require("../src/api");

describe("P4: BookmarkExporter 边界", () => {
    const saved = {};
    beforeEach(() => {
        saved.fetch = BookmarkExporter.fetchPageInsight;
        saved.summary = BookmarkExporter.generateAISummary;
        saved.category = BookmarkExporter.generateAICategory;
        saved.setup = BookmarkExporter.setupDatabaseProperties;
        saved.gm = global.GM_xmlhttpRequest;
        BookmarkExporter._pageInsightCache = {};
    });
    afterEach(() => {
        BookmarkExporter.fetchPageInsight = saved.fetch;
        BookmarkExporter.generateAISummary = saved.summary;
        BookmarkExporter.generateAICategory = saved.category;
        BookmarkExporter.setupDatabaseProperties = saved.setup;
        global.GM_xmlhttpRequest = saved.gm;
    });

    it("fetchPageInsight 拒绝内网/云元数据地址且不发请求", async () => {
        let requested = 0;
        global.GM_xmlhttpRequest = () => { requested++; };
        for (const url of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/x", "file:///etc/passwd"]) {
            await expect(BookmarkExporter.fetchPageInsight(url)).rejects.toThrow(/安全校验/);
        }
        expect(requested).toBe(0);
    });

    it("decodeHtmlFromResponse 响应字节截断到 2MB", () => {
        const bytes = new Uint8Array(3 * 1024 * 1024).fill(0x61); // 'a'
        const decoded = BookmarkExporter.decodeHtmlFromResponse({ response: bytes.buffer });
        expect(decoded.length).toBeLessThanOrEqual(BookmarkExporter.MAX_INSIGHT_BYTES);
        expect(decoded.length).toBeGreaterThan(BookmarkExporter.MAX_INSIGHT_BYTES - 16);
    });

    it("AI 调用失败也计入 aiUsedCount(闸门不可突破)", async () => {
        BookmarkExporter.fetchPageInsight = async () => ({ title: "t", summary: "s" });
        BookmarkExporter.generateAISummary = async () => { throw new Error("ai down"); };
        const context = { aiUsedCount: 0, aiMaxItems: 20 };

        await BookmarkExporter.enrichBookmark(
            { url: "https://example.com/a", title: "T" },
            { aiApiKey: "k", aiService: "openai", categories: [] },
            context
        );
        expect(context.aiUsedCount).toBe(1);
    });

    it("exportBookmarks 透传数据库配置的认证终态标记", async () => {
        BookmarkExporter.setupDatabaseProperties = async () => ({
            success: false,
            error: "API token is invalid.",
            isAuthTerminal: true,
            authCode: "unauthorized",
        });

        try {
            await BookmarkExporter.exportBookmarks({ apiKey: "k", databaseId: "db", bookmarks: [] });
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error.isAuthTerminal).toBe(true);
            expect(error.authCode).toBe("unauthorized");
        }
    });
});

describe("P4: 上传分片边界", () => {
    const savedGm = global.GM_xmlhttpRequest;
    afterEach(() => { global.GM_xmlhttpRequest = savedGm; });

    it("分片数超过 1000 上限时预检短路", async () => {
        const huge = { size: 21 * 1024 * 1024 * 1024, type: "image/png", slice: () => ({}) };
        global.GM_xmlhttpRequest = (opts) => opts.onload({ status: 200, response: huge, responseText: "" });
        await expect(NotionAPI.uploadFileToNotion("https://example.com/a.png", "secret_ok"))
            .rejects.toThrow(/1000 分片上限/);
    });
});
