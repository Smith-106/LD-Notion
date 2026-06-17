import { describe, it, expect, vi, beforeEach } from "vitest";
const { BookmarkAutoImporter } = require("../src/bridge/BookmarkAutoImporter");

// Mock SyncState.normalizeTime — returns ISO string from date input
vi.mock("../src/storage", () => ({
    SyncState: {
        normalizeTime: (value) => {
            if (!value) return "";
            const date = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            return date.toISOString();
        },
    },
    Storage: {
        get: vi.fn(() => ""),
    },
}));

// Mock BookmarkExporter.normalizeText — passthrough with maxLen truncation
vi.mock("../src/bridge/BookmarkExporter", () => ({
    BookmarkExporter: {
        normalizeText: (text, maxLen = 280) => {
            if (!text) return "";
            return String(text).trim().substring(0, maxLen);
        },
    },
}));

// Mock Utils.getPageTitle — extract from Notion page title property
vi.mock("../src/utils", () => ({
    Utils: {
        getPageTitle: (page, fallback = "无标题") => {
            if (!page?.properties) return fallback;
            const titleProps = ["title", "标题", "Name", "名称"];
            for (const propName of titleProps) {
                const prop = page.properties[propName];
                if (prop?.title?.[0]?.plain_text) return prop.title[0].plain_text;
            }
            return fallback;
        },
    },
}));

describe("AT-011: BookmarkAutoImporter 纯函数", () => {
    describe("normalizeBookmark", () => {
        it("converts raw bookmark to normalized structure", () => {
            const raw = {
                id: "bm-001",
                title: "Example Site",
                url: "https://example.com",
                folderPath: "书签栏/技术",
                dateAdded: "2024-06-15T10:30:00.000Z",
            };
            const result = BookmarkAutoImporter.normalizeBookmark(raw);

            expect(result).toEqual({
                id: "bm-001",
                title: "Example Site",
                url: "https://example.com",
                folderPath: "书签栏/技术",
                dateAdded: "2024-06-15T10:30:00.000Z",
            });
        });

        it("trims string fields", () => {
            const raw = {
                id: "  bm-002  ",
                title: "  Spaced Title  ",
                url: "  https://example.com  ",
                folderPath: "  /foo/  ",
                dateAdded: "2024-01-01T00:00:00.000Z",
            };
            const result = BookmarkAutoImporter.normalizeBookmark(raw);

            expect(result.id).toBe("bm-002");
            expect(result.title).toBe("Spaced Title");
            expect(result.url).toBe("https://example.com");
            expect(result.folderPath).toBe("/foo/");
        });

        it("dateAdded format normalized", () => {
            // Timestamp number input should be converted to ISO string
            const timestamp = 1718452200000; // 2024-06-15T10:30:00.000Z
            const result = BookmarkAutoImporter.normalizeBookmark({ id: "1", dateAdded: timestamp });

            expect(result.dateAdded).toBe(new Date(timestamp).toISOString());
        });
    });

    describe("buildSnapshotEntry", () => {
        it("includes pageId field", () => {
            const bookmark = {
                id: "bm-010",
                title: "Test",
                url: "https://test.com",
                folderPath: "",
                dateAdded: "2024-03-01T00:00:00.000Z",
            };
            const entry = BookmarkAutoImporter.buildSnapshotEntry(bookmark, "page-abc");

            expect(entry).toHaveProperty("pageId", "page-abc");
            expect(entry.id).toBe("bm-010");
            expect(entry.title).toBe("Test");
            expect(entry.url).toBe("https://test.com");
        });
    });

    describe("buildPageIndex", () => {
        it("creates byBookmarkId, byUrl, byPageId maps", () => {
            const pages = [
                {
                    pageId: "pg-1",
                    bookmarkId: "bm-100",
                    url: "https://a.com",
                    title: "A",
                    folderPath: "",
                    dateAdded: "",
                    archived: false,
                },
                {
                    pageId: "pg-2",
                    bookmarkId: "bm-200",
                    url: "https://b.com",
                    title: "B",
                    folderPath: "",
                    dateAdded: "",
                    archived: false,
                },
            ];
            const index = BookmarkAutoImporter.buildPageIndex(pages);

            expect(index.byBookmarkId.size).toBe(2);
            expect(index.byUrl.size).toBe(2);
            expect(index.byPageId.size).toBe(2);
            expect(index.byBookmarkId.get("bm-100")).toEqual(pages[0]);
            expect(index.byUrl.get("https://a.com")).toEqual(pages[0]);
            expect(index.byPageId.get("pg-2")).toEqual(pages[1]);
        });

        it("empty pages returns empty maps", () => {
            const index = BookmarkAutoImporter.buildPageIndex([]);

            expect(index.byBookmarkId.size).toBe(0);
            expect(index.byUrl.size).toBe(0);
            expect(index.byPageId.size).toBe(0);
        });

        it("duplicate bookmarkId first wins", () => {
            const first = {
                pageId: "pg-first",
                bookmarkId: "bm-dup",
                url: "https://first.com",
                title: "First",
                folderPath: "",
                dateAdded: "",
                archived: false,
            };
            const second = {
                pageId: "pg-second",
                bookmarkId: "bm-dup",
                url: "https://second.com",
                title: "Second",
                folderPath: "",
                dateAdded: "",
                archived: false,
            };
            const index = BookmarkAutoImporter.buildPageIndex([first, second]);

            // byBookmarkId: first wins (has check in source)
            expect(index.byBookmarkId.get("bm-dup")).toEqual(first);
            // byUrl: both URLs distinct, each gets its own entry
            expect(index.byUrl.get("https://first.com")).toEqual(first);
            expect(index.byUrl.get("https://second.com")).toEqual(second);
            // byPageId: both distinct
            expect(index.byPageId.get("pg-first")).toEqual(first);
            expect(index.byPageId.get("pg-second")).toEqual(second);
        });
    });

    describe("buildMinimalProperties", () => {
        it("builds correct Notion property structure", () => {
            const bookmark = {
                id: "bm-300",
                title: "My Page",
                url: "https://mypage.com",
                folderPath: "书签栏/开发",
            };
            const props = BookmarkAutoImporter.buildMinimalProperties(bookmark);

            expect(props["标题"]).toEqual({
                title: [{ text: { content: "My Page" } }],
            });
            expect(props["链接"]).toEqual({ url: "https://mypage.com" });
            expect(props["书签ID"]).toEqual({
                rich_text: [{ text: { content: "bm-300" } }],
            });
            expect(props["来源"]).toEqual({
                rich_text: [{ text: { content: "浏览器书签" } }],
            });
            expect(props["来源类型"]).toEqual({
                rich_text: [{ text: { content: "书签" } }],
            });
            expect(props["书签路径"]).toEqual({
                rich_text: [{ text: { content: "书签栏/开发" } }],
            });
        });

        it("includes date if dateAdded present", () => {
            const bookmark = {
                id: "bm-301",
                title: "Dated",
                url: "https://dated.com",
                folderPath: "",
                dateAdded: "2024-12-25T08:00:00.000Z",
            };
            const props = BookmarkAutoImporter.buildMinimalProperties(bookmark);

            expect(props["收藏时间"]).toEqual({
                date: { start: "2024-12-25T08:00:00.000Z" },
            });
        });
    });

    describe("needsFullRefresh", () => {
        it("URL changed returns true", () => {
            const bookmark = { id: "bm-1", url: "https://new.com" };
            const snapshotEntry = { url: "https://old.com" };
            const pageMeta = { pageId: "pg-1", bookmarkId: "bm-1", url: "https://old.com" };

            expect(BookmarkAutoImporter.needsFullRefresh(bookmark, snapshotEntry, pageMeta)).toBe(true);
        });

        it("same URL with pageMeta returns false", () => {
            const bookmark = { id: "bm-1", url: "https://same.com" };
            const snapshotEntry = { url: "https://same.com" };
            const pageMeta = { pageId: "pg-1", bookmarkId: "bm-1", url: "https://same.com" };

            expect(BookmarkAutoImporter.needsFullRefresh(bookmark, snapshotEntry, pageMeta)).toBe(false);
        });

        it("no pageMeta returns true", () => {
            const bookmark = { id: "bm-1", url: "https://any.com" };

            expect(BookmarkAutoImporter.needsFullRefresh(bookmark, {}, null)).toBe(true);
        });
    });

    describe("needsUpdate", () => {
        it("no pageMeta returns true", () => {
            const bookmark = { id: "bm-1", url: "https://x.com" };

            expect(BookmarkAutoImporter.needsUpdate(bookmark, {}, null)).toBe(true);
        });

        it("bookmarkId mismatch returns true", () => {
            const bookmark = { id: "bm-wrong", url: "https://x.com" };
            const pageMeta = { bookmarkId: "bm-correct", url: "https://x.com" };

            expect(BookmarkAutoImporter.needsUpdate(bookmark, {}, pageMeta)).toBe(true);
        });

        it("URL mismatch returns true", () => {
            const bookmark = { id: "bm-1", url: "https://changed.com" };
            const pageMeta = { bookmarkId: "bm-1", url: "https://original.com" };

            expect(BookmarkAutoImporter.needsUpdate(bookmark, {}, pageMeta)).toBe(true);
        });

        it("title changed returns true", () => {
            const bookmark = { id: "bm-1", url: "https://x.com", title: "New Title", folderPath: "" };
            const snapshotEntry = { title: "Old Title", folderPath: "", dateAdded: "" };
            const pageMeta = { bookmarkId: "bm-1", url: "https://x.com" };

            expect(BookmarkAutoImporter.needsUpdate(bookmark, snapshotEntry, pageMeta)).toBe(true);
        });

        it("all fields same returns false", () => {
            const bookmark = {
                id: "bm-1",
                url: "https://x.com",
                title: "Same Title",
                folderPath: "书签栏",
                dateAdded: "2024-01-01T00:00:00.000Z",
            };
            const snapshotEntry = {
                title: "Same Title",
                folderPath: "书签栏",
                dateAdded: "2024-01-01T00:00:00.000Z",
            };
            const pageMeta = { bookmarkId: "bm-1", url: "https://x.com" };

            expect(BookmarkAutoImporter.needsUpdate(bookmark, snapshotEntry, pageMeta)).toBe(false);
        });
    });

    describe("extractPageMeta", () => {
        it("extracts from Notion page object", () => {
            const page = {
                id: "pg-extract",
                archived: false,
                properties: {
                    "标题": {
                        title: [{ plain_text: "Extracted Title" }],
                    },
                    "书签ID": {
                        rich_text: [{ plain_text: "bm-ext" }],
                    },
                    "链接": {
                        url: "https://extracted.com",
                    },
                    "书签路径": {
                        rich_text: [{ plain_text: "书签栏/子目录" }],
                    },
                    "收藏时间": {
                        date: { start: "2024-05-20T12:00:00.000Z" },
                    },
                },
            };

            const meta = BookmarkAutoImporter.extractPageMeta(page);

            expect(meta).toEqual({
                pageId: "pg-extract",
                bookmarkId: "bm-ext",
                url: "https://extracted.com",
                title: "Extracted Title",
                folderPath: "书签栏/子目录",
                dateAdded: "2024-05-20T12:00:00.000Z",
                archived: false,
            });
        });
    });
});
