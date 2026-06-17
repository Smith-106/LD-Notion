import { describe, it, expect } from "vitest";
import { CONFIG, isSupportedFileType, getMimeType, getFileCategory } from "../src/config/index.js";

describe("AT-003: Config 纯函数", () => {
    describe("isSupportedFileType", () => {
        it("known extension returns true", () => {
            expect(isSupportedFileType("pdf")).toBe(true);
            expect(isSupportedFileType("png")).toBe(true);
            expect(isSupportedFileType("json")).toBe(true);
        });

        it("unknown extension returns false", () => {
            expect(isSupportedFileType("xyz")).toBe(false);
            expect(isSupportedFileType("js")).toBe(false);
            expect(isSupportedFileType("exe")).toBe(false);
        });

        it("is case insensitive", () => {
            expect(isSupportedFileType("PDF")).toBe(true);
            expect(isSupportedFileType("Png")).toBe(true);
            expect(isSupportedFileType("Mp3")).toBe(true);
        });

        it("dot prefix (.pdf) returns false because set stores bare keys", () => {
            expect(isSupportedFileType(".pdf")).toBe(false);
            expect(isSupportedFileType(".png")).toBe(false);
        });
    });

    describe("getMimeType", () => {
        it("known extension returns correct MIME type", () => {
            expect(getMimeType("pdf")).toBe("application/pdf");
            expect(getMimeType("png")).toBe("image/png");
            expect(getMimeType("mp3")).toBe("audio/mpeg");
            expect(getMimeType("mp4")).toBe("video/mp4");
            expect(getMimeType("json")).toBe("application/json");
        });

        it("unknown extension returns default fallback application/octet-stream", () => {
            expect(getMimeType("xyz")).toBe("application/octet-stream");
            expect(getMimeType("unknown")).toBe("application/octet-stream");
        });

        it("custom fallback overrides default", () => {
            expect(getMimeType("xyz", "text/plain")).toBe("text/plain");
        });

        it("is case insensitive", () => {
            expect(getMimeType("PDF")).toBe("application/pdf");
            expect(getMimeType("Png")).toBe("image/png");
        });
    });

    describe("getFileCategory", () => {
        it("image types return image", () => {
            expect(getFileCategory("gif")).toBe("image");
            expect(getFileCategory("png")).toBe("image");
            expect(getFileCategory("jpg")).toBe("image");
            expect(getFileCategory("webp")).toBe("image");
            expect(getFileCategory("svg")).toBe("image");
        });

        it("document types return file", () => {
            expect(getFileCategory("pdf")).toBe("file");
            expect(getFileCategory("docx")).toBe("file");
            expect(getFileCategory("xlsx")).toBe("file");
            expect(getFileCategory("txt")).toBe("file");
        });

        it("unknown type returns file as default", () => {
            expect(getFileCategory("xyz")).toBe("file");
            expect(getFileCategory("")).toBe("file");
        });

        it("audio and video return their own categories", () => {
            expect(getFileCategory("mp3")).toBe("audio");
            expect(getFileCategory("wav")).toBe("audio");
            expect(getFileCategory("mp4")).toBe("video");
            expect(getFileCategory("webm")).toBe("video");
        });
    });

    describe("CONFIG.STORAGE_KEYS", () => {
        it("all values are non-empty strings", () => {
            const values = Object.values(CONFIG.STORAGE_KEYS);
            expect(values.length).toBeGreaterThan(0);
            for (const v of values) {
                expect(typeof v).toBe("string");
                expect(v.length).toBeGreaterThan(0);
            }
        });

        it("keys follow ldb_ prefix convention", () => {
            const values = Object.values(CONFIG.STORAGE_KEYS);
            for (const v of values) {
                expect(v).toMatch(/^ldb_/);
            }
        });
    });

    describe("CONFIG.DEFAULTS", () => {
        it("core defaults exist with correct types", () => {
            expect(typeof CONFIG.DEFAULTS.notionAuthMode).toBe("string");
            expect(typeof CONFIG.DEFAULTS.onlyFirst).toBe("boolean");
            expect(typeof CONFIG.DEFAULTS.rangeStart).toBe("number");
            expect(typeof CONFIG.DEFAULTS.rangeEnd).toBe("number");
            expect(typeof CONFIG.DEFAULTS.imgFilter).toBe("string");
            expect(typeof CONFIG.DEFAULTS.imgMode).toBe("string");
            expect(typeof CONFIG.DEFAULTS.permissionLevel).toBe("number");
            expect(typeof CONFIG.DEFAULTS.requireConfirm).toBe("boolean");
            expect(typeof CONFIG.DEFAULTS.requestDelay).toBe("number");
        });

        it("AI defaults exist with correct types", () => {
            expect(typeof CONFIG.DEFAULTS.aiService).toBe("string");
            expect(typeof CONFIG.DEFAULTS.aiCategories).toBe("string");
            expect(typeof CONFIG.DEFAULTS.aiBaseUrl).toBe("string");
            expect(typeof CONFIG.DEFAULTS.agentMaxIterations).toBe("number");
        });

        it("specific default values are correct", () => {
            expect(CONFIG.DEFAULTS.notionAuthMode).toBe("manual");
            expect(CONFIG.DEFAULTS.imgFilter).toBe("all");
            expect(CONFIG.DEFAULTS.imgMode).toBe("external");
            expect(CONFIG.DEFAULTS.permissionLevel).toBe(1);
            expect(CONFIG.DEFAULTS.requestDelay).toBe(500);
            expect(CONFIG.DEFAULTS.exportTargetType).toBe("database");
            expect(CONFIG.DEFAULTS.exportConcurrency).toBe(1);
        });
    });
});
