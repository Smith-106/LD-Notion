"use strict";

import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map();
globalThis.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
globalThis.GM_setValue = (k, v) => { store.set(k, v); };
globalThis.GM_deleteValue = (k) => { store.delete(k); };
globalThis.GM_addValueChangeListener = () => 0;

const { DedupStore } = require("../src/storage/DedupStore");
const { CONFIG } = require("../src/config");
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
// v3.17: GitHub 收藏源已移除,GitHubAPI/GitHubAutoImporter 已删除。

beforeEach(() => {
    store.clear();
    DedupStore._batchCaches = {};
    BookmarkExporter._exportedCache = null;
    BookmarkExporter._exportedKeysMigrated = false;
});

describe("R-DEDUP-SKIP: bookmark dual-ledger clear", () => {
    it("clearExportedRecords also clears DedupStore(bookmark)", () => {
        DedupStore.markSeen("bookmark", "bookmark:42");
        BookmarkExporter.markExportedAndFlush("https://example.com/x");
        expect(DedupStore.isDuplicate("bookmark", "bookmark:42")).toBe(true);
        expect(BookmarkExporter.isExported("https://example.com/x")).toBe(true);

        BookmarkExporter.clearExportedRecords();

        expect(BookmarkExporter.isExported("https://example.com/x")).toBe(false);
        expect(DedupStore.isDuplicate("bookmark", "bookmark:42")).toBe(false);
    });
});

// v3.17: GitHub 收藏源已移除。等价语义: 书签导出远端查询失败降级本地账本 →
// 已落账 URL 跳过不建页, 未落账 URL 仍建页。
describe("R-DEDUP-SKIP: bookmark export skips ledger-hit on remote fallback", () => {
    it("exportBookmarks does not create page for already-exported urls", async () => {
        const { NotionAPI } = require("../src/api");
        const { Utils } = require("../src/utils");
        const { OperationGuard } = require("../src/security");
        BookmarkExporter.markExportedAndFlush("https://example.com/already");
        const reqSpy = vi.spyOn(NotionAPI, "request").mockResolvedValue({ id: "page-new" });
        const collectSpy = vi.spyOn(NotionAPI, "collectDatabaseUrls")
            .mockRejectedValue(new Error("network down")); // 远端查询失败 → 降级本地账本
        const strictSpy = vi.spyOn(Utils, "isBookmarkDedupStrict").mockReturnValue(true);
        const canSpy = vi.spyOn(OperationGuard, "canExecute").mockReturnValue(true);
        const setupSpy = vi.spyOn(BookmarkExporter, "setupDatabaseProperties")
            .mockResolvedValue({ success: true });
        const enrichSpy = vi.spyOn(BookmarkExporter, "enrichBookmark")
            .mockImplementation(async (b) => b);
        try {
            const result = await BookmarkExporter.exportBookmarks({
                apiKey: "k",
                databaseId: "db",
                bookmarks: [
                    { url: "https://example.com/already", title: "Already" },
                    { url: "https://example.com/fresh", title: "Fresh" },
                ],
            });
            expect(result.exported).toBe(1);
            // 仅 fresh 建页
            expect(reqSpy).toHaveBeenCalledTimes(1);
            expect(reqSpy.mock.calls[0][2].properties["链接"].url).toContain("example.com/fresh");
        } finally {
            reqSpy.mockRestore();
            collectSpy.mockRestore();
            strictSpy.mockRestore();
            canSpy.mockRestore();
            setupSpy.mockRestore();
            enrichSpy.mockRestore();
        }
    });
});
