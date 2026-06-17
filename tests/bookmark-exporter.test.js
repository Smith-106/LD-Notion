"use strict";

import { describe, it, expect } from "vitest";
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");

describe("AT-004: BookmarkExporter 纯函数", () => {
    // ── normalizeText ────────────────────────────────────────────
    describe("normalizeText", () => {
        it("empty string → \"\"", () => {
            expect(BookmarkExporter.normalizeText("")).toBe("");
        });

        it("null/undefined → \"\"", () => {
            expect(BookmarkExporter.normalizeText(null)).toBe("");
            expect(BookmarkExporter.normalizeText(undefined)).toBe("");
        });

        it("truncates to maxLen", () => {
            const long = "a".repeat(500);
            expect(BookmarkExporter.normalizeText(long, 100)).toBe("a".repeat(100));
            expect(BookmarkExporter.normalizeText(long, 100).length).toBe(100);
        });

        it("cleans zero-width characters and multiple spaces", () => {
            // U+FEFF BOM, U+200B zero-width space, U+200C ZWNJ, U+200D ZWJ, U+2060 word joiner
            const dirty = "﻿hello​  ‌  world‍⁠";
            expect(BookmarkExporter.normalizeText(dirty, 280)).toBe("hello world");
        });

        it("default maxLen is 280", () => {
            const long = "x".repeat(500);
            expect(BookmarkExporter.normalizeText(long).length).toBe(280);
        });
    });

    // ── flattenTree ──────────────────────────────────────────────
    describe("flattenTree", () => {
        it("empty array → []", () => {
            expect(BookmarkExporter.flattenTree([])).toEqual([]);
        });

        it("single bookmark node with url → flat list with folderPath", () => {
            const nodes = [{ title: "Google", url: "https://google.com", id: "1" }];
            const result = BookmarkExporter.flattenTree(nodes);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                title: "Google",
                url: "https://google.com",
                folderPath: "",
                dateAdded: null,
                id: "1",
            });
        });

        it("nested children with folder path accumulation", () => {
            const nodes = [
                {
                    title: "Dev",
                    children: [
                        {
                            title: "GitHub",
                            url: "https://github.com",
                            id: "2",
                        },
                    ],
                },
            ];
            const result = BookmarkExporter.flattenTree(nodes);
            expect(result).toHaveLength(1);
            expect(result[0].folderPath).toBe("Dev");
            expect(result[0].title).toBe("GitHub");
        });

        it("node without url but with children → children included", () => {
            const nodes = [
                {
                    title: "Folder",
                    children: [
                        { title: "Link", url: "https://example.com", id: "3" },
                    ],
                },
            ];
            const result = BookmarkExporter.flattenTree(nodes);
            expect(result).toHaveLength(1);
            expect(result[0].url).toBe("https://example.com");
            expect(result[0].folderPath).toBe("Folder");
        });
    });

    // ── composeTitleWithPrefix ───────────────────────────────────
    describe("composeTitleWithPrefix", () => {
        it("prefix only → prefix", () => {
            expect(BookmarkExporter.composeTitleWithPrefix("MyTitle", "")).toBe("MyTitle");
        });

        it("prefix + candidate → \"prefix · candidate\"", () => {
            expect(BookmarkExporter.composeTitleWithPrefix("Site", "Article")).toBe("Site · Article");
        });

        it("candidate starts with \"prefix - \" → return candidate", () => {
            expect(BookmarkExporter.composeTitleWithPrefix("Site", "Site - Detail")).toBe("Site - Detail");
        });

        it("truncates to maxLen", () => {
            const long = "x".repeat(200);
            const result = BookmarkExporter.composeTitleWithPrefix("P", long, 50);
            expect(result.length).toBeLessThanOrEqual(50);
        });
    });

    // ── inferCategoryHeuristic ───────────────────────────────────
    describe("inferCategoryHeuristic", () => {
        it("keyword match returns matching category", () => {
            const bookmark = { folderPath: "", title: "GitHub", url: "https://github.com" };
            const insight = { title: "Repo", summary: "dev" };
            const cats = ["技术", "生活", "其他"];
            // "github" in url triggers rule → hints include "技术" → "技术" is in categories
            const result = BookmarkExporter.inferCategoryHeuristic(bookmark, insight, cats);
            expect(result).toBe("技术");
        });

        it("no match returns last category (fallback)", () => {
            const bookmark = { folderPath: "", title: "Random", url: "https://example.com" };
            const insight = { title: "NoMatch", summary: "Nothing" };
            const cats = ["Alpha", "Beta", "Gamma"];
            // No keyword matches, no "其他" → returns last category
            const result = BookmarkExporter.inferCategoryHeuristic(bookmark, insight, cats);
            expect(result).toBe("Gamma");
        });

        it("empty categories → \"\"", () => {
            const bookmark = { folderPath: "", title: "Test", url: "https://example.com" };
            const insight = { title: "", summary: "" };
            expect(BookmarkExporter.inferCategoryHeuristic(bookmark, insight, [])).toBe("");
            expect(BookmarkExporter.inferCategoryHeuristic(bookmark, insight)).toBe("");
        });
    });

    // ── normalizeCharset ────────────────────────────────────────
    describe("normalizeCharset", () => {
        it("\"utf8\" → \"utf-8\"", () => {
            expect(BookmarkExporter.normalizeCharset("utf8")).toBe("utf-8");
        });

        it("\"gbk\" → \"gb18030\"", () => {
            expect(BookmarkExporter.normalizeCharset("gbk")).toBe("gb18030");
        });

        it("\"UTF-8\" → \"utf-8\" (case insensitive)", () => {
            expect(BookmarkExporter.normalizeCharset("UTF-8")).toBe("utf-8");
        });
    });

    // ── extractCharsetFromHeaders ────────────────────────────────
    describe("extractCharsetFromHeaders", () => {
        it("Content-Type with charset → extracted charset", () => {
            const headers = "content-type: text/html; charset=utf-8\r\nx-custom: foo";
            expect(BookmarkExporter.extractCharsetFromHeaders(headers)).toBe("utf-8");
        });

        it("no charset → \"\"", () => {
            const headers = "content-type: text/html\r\nx-custom: foo";
            expect(BookmarkExporter.extractCharsetFromHeaders(headers)).toBe("");
        });
    });

    // ── isHttpUrl ────────────────────────────────────────────────
    describe("isHttpUrl", () => {
        it("\"https://example.com\" → true", () => {
            expect(BookmarkExporter.isHttpUrl("https://example.com")).toBe(true);
        });

        it("\"ftp://example.com\" → false", () => {
            expect(BookmarkExporter.isHttpUrl("ftp://example.com")).toBe(false);
        });

        it("\"\" → false", () => {
            expect(BookmarkExporter.isHttpUrl("")).toBe(false);
        });
    });
});
