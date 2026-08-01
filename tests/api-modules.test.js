import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    SiteDetector, InstallHelper, EMOJI_MAP, NOTION_LANGUAGES, normalizeLanguage,
    DOMToNotion, NotionTransport, NotionAPI, ObsidianAPI, HTMLToMarkdown,
} from "../src/api/index.js";

// ===== T1.4: 常量/工具函数契约 =====

describe("normalizeLanguage", () => {
    it("returns known languages as-is", () => {
        expect(normalizeLanguage("javascript")).toBe("javascript");
        expect(normalizeLanguage("python")).toBe("python");
        expect(normalizeLanguage("plain text")).toBe("plain text");
    });

    it("maps aliases correctly", () => {
        expect(normalizeLanguage("js")).toBe("javascript");
        expect(normalizeLanguage("ts")).toBe("typescript");
        expect(normalizeLanguage("py")).toBe("python");
        expect(normalizeLanguage("rb")).toBe("ruby");
        expect(normalizeLanguage("sh")).toBe("shell");
        expect(normalizeLanguage("yml")).toBe("yaml");
        expect(normalizeLanguage("md")).toBe("markdown");
        expect(normalizeLanguage("cpp")).toBe("c++");
        expect(normalizeLanguage("csharp")).toBe("c#");
        expect(normalizeLanguage("cs")).toBe("c#");
        expect(normalizeLanguage("golang")).toBe("go");
        expect(normalizeLanguage("rs")).toBe("rust");
    });

    it("returns 'plain text' for unknown/null/empty", () => {
        expect(normalizeLanguage(null)).toBe("plain text");
        expect(normalizeLanguage("")).toBe("plain text");
        expect(normalizeLanguage("unknown_lang_xyz")).toBe("plain text");
    });

    it("is case-insensitive", () => {
        expect(normalizeLanguage("JavaScript")).toBe("javascript");
        expect(normalizeLanguage("JS")).toBe("javascript");
    });
});

describe("EMOJI_MAP", () => {
    it("has expected minimum key count (防遗漏)", () => {
        expect(Object.keys(EMOJI_MAP).length).toBeGreaterThanOrEqual(150);
    });

    it("contains core emoji entries", () => {
        expect(EMOJI_MAP.thumbsup).toBe("👍");
        expect(EMOJI_MAP.heart).toBe("❤️");
        expect(EMOJI_MAP.fire).toBe("🔥");
        expect(EMOJI_MAP.rocket).toBe("🚀");
        expect(EMOJI_MAP["+1"]).toBe("👍");
    });
});

describe("NOTION_LANGUAGES", () => {
    it("is a Set containing core languages", () => {
        expect(NOTION_LANGUAGES).toBeInstanceOf(Set);
        expect(NOTION_LANGUAGES.has("javascript")).toBe(true);
        expect(NOTION_LANGUAGES.has("python")).toBe(true);
        expect(NOTION_LANGUAGES.has("plain text")).toBe(true);
    });
});

describe("SiteDetector", () => {
    it("detects generic site for localhost", () => {
        // setup.js sets window.location.hostname = "localhost"
        expect(SiteDetector.detect()).toBe(SiteDetector.SITES.GENERIC);
        expect(SiteDetector.isGeneric()).toBe(true);
        expect(SiteDetector.isLinuxDo()).toBe(false);
        expect(SiteDetector.isNotion()).toBe(false);
    });

    it("exposes SITES constants", () => {
        expect(SiteDetector.SITES.LINUX_DO).toBe("linux_do");
        expect(SiteDetector.SITES.NOTION).toBe("notion");
        expect(SiteDetector.SITES.GITHUB).toBe("github");
        expect(SiteDetector.SITES.ZHIHU).toBe("zhihu");
        expect(SiteDetector.SITES.GENERIC).toBe("generic");
    });
});

describe("InstallHelper", () => {
    it("returns bookmark extension URL", () => {
        const url = InstallHelper.getBookmarkExtensionUrl();
        expect(url).toContain("github.com");
        expect(url).toContain("releases");
    });

    it("renders install link HTML", () => {
        const html = InstallHelper.renderInstallLink("测试");
        expect(html).toContain("<a");
        expect(html).toContain("测试");
        expect(html).toContain("github.com");
    });
});

// ===== T1.1: DOMToNotion 契约 =====

describe("DOMToNotion", () => {
    describe("splitLongText", () => {
        it("returns single chunk for short text", () => {
            const result = DOMToNotion.splitLongText("hello");
            expect(result).toHaveLength(1);
            expect(result[0].text.content).toBe("hello");
            expect(result[0].type).toBe("text");
        });

        it("splits text > 2000 chars into multiple chunks", () => {
            const longText = "a".repeat(5000);
            const result = DOMToNotion.splitLongText(longText);
            expect(result.length).toBe(3);
            expect(result[0].text.content).toHaveLength(2000);
            expect(result[1].text.content).toHaveLength(2000);
            expect(result[2].text.content).toHaveLength(1000);
        });

        it("respects 100 item limit", () => {
            const hugeText = "x".repeat(250000);
            const result = DOMToNotion.splitLongText(hugeText);
            expect(result.length).toBeLessThanOrEqual(100);
        });

        it("preserves annotations", () => {
            const result = DOMToNotion.splitLongText("bold", { bold: true });
            expect(result[0].annotations.bold).toBe(true);
        });
    });

    describe("_safeExternalUrl", () => {
        it("rejects empty/null URLs", () => {
            expect(DOMToNotion._safeExternalUrl("")).toBe("");
            expect(DOMToNotion._safeExternalUrl(null)).toBe("");
        });

        it("rejects non-http(s) protocols", () => {
            expect(DOMToNotion._safeExternalUrl("javascript:alert(1)")).toBe("");
            expect(DOMToNotion._safeExternalUrl("data:text/html,<script>")).toBe("");
        });
    });

    describe("method contract (existence)", () => {
        it("exposes all expected methods", () => {
            expect(typeof DOMToNotion.cookedToBlocks).toBe("function");
            expect(typeof DOMToNotion.serializeRichText).toBe("function");
            expect(typeof DOMToNotion.splitLongText).toBe("function");
            expect(typeof DOMToNotion._safeExternalUrl).toBe("function");
            expect(typeof DOMToNotion._cookIframe).toBe("function");
            expect(typeof DOMToNotion._cookLightbox).toBe("function");
            expect(typeof DOMToNotion._cookAttachment).toBe("function");
            expect(typeof DOMToNotion._cookVideo).toBe("function");
            expect(typeof DOMToNotion._cookAudio).toBe("function");
            expect(typeof DOMToNotion._cookAsideQuote).toBe("function");
            expect(typeof DOMToNotion._cookParagraph).toBe("function");
            expect(typeof DOMToNotion._cookCode).toBe("function");
            expect(typeof DOMToNotion._cookBlockquote).toBe("function");
            expect(typeof DOMToNotion._cookHeading).toBe("function");
            expect(typeof DOMToNotion._cookList).toBe("function");
            expect(typeof DOMToNotion._cookTable).toBe("function");
            expect(typeof DOMToNotion._cookImage).toBe("function");
        });
    });
});

// ===== T1.2: Upload 簇契约 =====

describe("NotionAPI Upload cluster", () => {
    let mockTransport;

    beforeEach(() => {
        mockTransport = { request: vi.fn() };
        NotionAPI.configureTransport(mockTransport);
    });

    describe("createFileUpload", () => {
        it("sends single_part mode request", async () => {
            mockTransport.request.mockResolvedValue({
                status: 200,
                responseText: JSON.stringify({ id: "upload-1", upload_url: "https://s3.example.com" }),
                responseHeaders: "",
            });

            const result = await NotionAPI.createFileUpload("test.png", "image/png", "fake-key");
            expect(result.id).toBe("upload-1");
            expect(mockTransport.request).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "POST",
                    endpoint: "/file_uploads",
                    data: expect.objectContaining({
                        mode: "single_part",
                        filename: "test.png",
                        content_type: "image/png",
                    }),
                })
            );
        });
    });

    describe("createMultiPartUpload", () => {
        it("sends multi_part mode with number_of_parts", async () => {
            mockTransport.request.mockResolvedValue({
                status: 200,
                responseText: JSON.stringify({ id: "multi-1" }),
                responseHeaders: "",
            });

            const result = await NotionAPI.createMultiPartUpload("big.mp4", "video/mp4", 50 * 1024 * 1024, "fake-key", 3);
            expect(result.id).toBe("multi-1");
            expect(mockTransport.request).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        mode: "multi_part",
                        number_of_parts: 3,
                        file_size: 50 * 1024 * 1024,
                    }),
                })
            );
        });
    });

    describe("completeFileUpload", () => {
        it("posts to complete endpoint", async () => {
            mockTransport.request.mockResolvedValue({
                status: 200,
                responseText: JSON.stringify({ id: "upload-1", status: "completed" }),
                responseHeaders: "",
            });

            const result = await NotionAPI.completeFileUpload("upload-1", "fake-key");
            expect(mockTransport.request).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "POST",
                    endpoint: "/file_uploads/upload-1/complete",
                })
            );
        });
    });

    describe("getWorkspaceLimits", () => {
        it("returns workspace limit from API", async () => {
            mockTransport.request.mockResolvedValue({
                status: 200,
                responseText: JSON.stringify({ bot: { workspace_limits: { max_file_upload_size_in_bytes: 10485760 } } }),
                responseHeaders: "",
            });

            const limit = await NotionAPI.getWorkspaceLimits("fake-key");
            expect(limit).toBe(10485760);
        });

        it("falls back to 5MB on error", async () => {
            mockTransport.request.mockResolvedValue({
                status: 500,
                responseText: JSON.stringify({ message: "error" }),
                responseHeaders: "",
            });

            const limit = await NotionAPI.getWorkspaceLimits("fake-key");
            expect(limit).toBe(5 * 1024 * 1024);
        });
    });

    describe("method contract (existence)", () => {
        it("exposes all upload methods", () => {
            expect(typeof NotionAPI.createFileUpload).toBe("function");
            expect(typeof NotionAPI.createMultiPartUpload).toBe("function");
            expect(typeof NotionAPI.sendFilePart).toBe("function");
            expect(typeof NotionAPI.completeFileUpload).toBe("function");
            expect(typeof NotionAPI.getWorkspaceLimits).toBe("function");
            expect(typeof NotionAPI.uploadFileContent).toBe("function");
            expect(typeof NotionAPI.uploadFileToNotion).toBe("function");
            expect(typeof NotionAPI.uploadImageToNotion).toBe("function");
        });
    });
});

// ===== T1.3: ObsidianAPI + HTMLToMarkdown 契约 =====

describe("ObsidianAPI", () => {
    it("exposes expected methods", () => {
        expect(typeof ObsidianAPI.testConnection).toBe("function");
        expect(typeof ObsidianAPI.writeNote).toBe("function");
        expect(typeof ObsidianAPI.writeImage).toBe("function");
    });

    it("testConnection rejects non-local URLs", async () => {
        const result = await ObsidianAPI.testConnection("https://evil.com", "key");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("安全校验失败");
    });
});

describe("HTMLToMarkdown", () => {
    it("exposes expected methods", () => {
        expect(typeof HTMLToMarkdown.convert).toBe("function");
        expect(typeof HTMLToMarkdown.buildFrontmatter).toBe("function");
        expect(typeof HTMLToMarkdown.buildPostCallout).toBe("function");
        expect(typeof HTMLToMarkdown._convertNode).toBe("function");
        expect(typeof HTMLToMarkdown._convertChildren).toBe("function");
        expect(typeof HTMLToMarkdown._convertTable).toBe("function");
    });

    describe("buildFrontmatter", () => {
        it("generates YAML frontmatter with metadata", () => {
            const fm = HTMLToMarkdown.buildFrontmatter({
                title: "Test Post",
                url: "https://linux.do/t/123",
                author: "user1",
                source: "linux.do",
            });
            expect(fm).toContain("---");
            expect(fm).toContain('title: "Test Post"');
            expect(fm).toContain('url: "https://linux.do/t/123"');
            expect(fm).toContain('author: "user1"');
            expect(fm).toContain("export_time:");
        });

        it("handles tags array", () => {
            const fm = HTMLToMarkdown.buildFrontmatter({ title: "T", tags: ["a", "b"] });
            expect(fm).toContain("tags:");
            expect(fm).toContain('  - "a"');
            expect(fm).toContain('  - "b"');
        });
    });

    describe("buildPostCallout", () => {
        // buildPostCallout internally calls HTMLToMarkdown.convert which needs DOMParser
        // In node env without DOM, we verify the function signature and error behavior
        it("is a function accepting (post, index, isOp)", () => {
            expect(HTMLToMarkdown.buildPostCallout.length).toBeGreaterThanOrEqual(2);
        });
    });
});

// ===== module.exports 契约守护 =====

describe("api/index.js module.exports contract", () => {
    it("exports exactly 10 named symbols", () => {
        const api = require("../src/api/index.js");
        const keys = Object.keys(api);
        expect(keys).toContain("SiteDetector");
        expect(keys).toContain("InstallHelper");
        expect(keys).toContain("EMOJI_MAP");
        expect(keys).toContain("NOTION_LANGUAGES");
        expect(keys).toContain("normalizeLanguage");
        expect(keys).toContain("DOMToNotion");
        expect(keys).toContain("NotionTransport");
        expect(keys).toContain("NotionAPI");
        expect(keys).toContain("ObsidianAPI");
        expect(keys).toContain("HTMLToMarkdown");
        expect(keys.length).toBe(10);
    });
});
