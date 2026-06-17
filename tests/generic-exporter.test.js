import { describe, it, expect } from "vitest";
const { GenericExporter } = require("../src/export/index");

describe("AT-010: GenericExporter 纯函数", () => {
    describe("resolveUnifiedSource", () => {
        it("explicit source field → that source", () => {
            const result = GenericExporter.resolveUnifiedSource({ source: "掘金" });
            expect(result).toBe("掘金");
        });

        it("no explicit, siteName='知乎' → '知乎'", () => {
            const result = GenericExporter.resolveUnifiedSource({ siteName: "知乎" });
            expect(result).toBe("知乎");
        });

        it("no explicit, other siteName → '通用页面'", () => {
            const result = GenericExporter.resolveUnifiedSource({ siteName: "掘金" });
            expect(result).toBe("通用页面");
        });

        it("empty meta → '通用页面'", () => {
            const result = GenericExporter.resolveUnifiedSource({});
            expect(result).toBe("通用页面");
        });
    });

    describe("normalizeSourceLabel", () => {
        it("truncates long strings", () => {
            const long = "A".repeat(200);
            const result = GenericExporter.normalizeSourceLabel(long);
            expect(result.length).toBeLessThanOrEqual(100);
        });

        it("trims whitespace", () => {
            const result = GenericExporter.normalizeSourceLabel("  hello world  ");
            expect(result).toBe("hello world");
        });

        it("empty → ''", () => {
            expect(GenericExporter.normalizeSourceLabel("")).toBe("");
            expect(GenericExporter.normalizeSourceLabel(null)).toBe("");
            expect(GenericExporter.normalizeSourceLabel(undefined)).toBe("");
        });
    });

    describe("stripHtml", () => {
        it("removes HTML tags", () => {
            const result = GenericExporter.stripHtml("<p>Hello <b>world</b></p>");
            expect(result).toBe("Hello world");
        });

        it("truncates to max length", () => {
            const html = "<p>" + "x".repeat(600) + "</p>";
            const result = GenericExporter.stripHtml(html);
            expect(result.length).toBeLessThanOrEqual(500);
        });
    });

    describe("extractSummaryText", () => {
        it("from og:description → summary", () => {
            // In the extraction pipeline, og:description is stored as meta.description
            const meta = { description: "这是一篇关于前端的文章摘要" };
            const result = GenericExporter.extractSummaryText(meta);
            expect(result).toBe("这是一篇关于前端的文章摘要");
        });

        it("from description → fallback", () => {
            // When meta.description is absent, falls back to meta.detail
            const meta = { detail: "详细内容作为备选摘要" };
            const result = GenericExporter.extractSummaryText(meta);
            expect(result).toBe("详细内容作为备选摘要");
        });
    });

    describe("inferTags", () => {
        it("from meta data (siteName, keywords)", () => {
            const meta = {
                url: "https://www.zhihu.com/question/123",
                siteName: "知乎",
                sourceType: "回答",
            };
            const result = GenericExporter.inferTags(meta);
            // Should contain hostname, source label, and source type
            expect(result).toContain("zhihu.com");
            expect(result).toContain("知乎");
            expect(result).toContain("回答");
        });

        it("deduplication", () => {
            const meta = {
                url: "https://www.example.com/page",
                source: "Example",
                siteName: "Example",
            };
            const result = GenericExporter.inferTags(meta);
            // "Example" should appear only once despite being in both source and siteName
            const exampleCount = result.filter((t) => t === "Example").length;
            expect(exampleCount).toBe(1);
        });
    });
});
