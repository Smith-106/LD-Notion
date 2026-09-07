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
const { GitHubAPI } = require("../src/import/GitHubAPI");
const { GitHubAutoImporter } = require("../src/import/GitHubAutoImporter");

beforeEach(() => {
    store.clear();
    DedupStore._batchCaches = {};
    BookmarkExporter._exportedCache = null;
    BookmarkExporter._exportedKeysMigrated = false;
    GitHubAPI._exportedCache = null;
    GitHubAPI._exportedGistsCache = null;
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

describe("R-DEDUP-SKIP: GitHub auto skips isExported after watermark reset", () => {
    it("_exportViaGitHubExporter does not create page for already-exported keys", async () => {
        GitHubAPI.markExportedAndFlush("owner/already");
        const createSpy = vi.fn();
        // NotionAPI.request 被 GitHubAutoImporter 用于建页; 通过 stub OperationGuard + 拦截 request
        const { NotionAPI } = require("../src/api");
        const reqSpy = vi.spyOn(NotionAPI, "request").mockResolvedValue({ id: "page-new" });
        const { OperationGuard } = require("../src/security");
        vi.spyOn(OperationGuard, "canExecute").mockReturnValue(true);

        const meta = GitHubAutoImporter.getTypeMeta("stars");
        const mapped = [
            {
                itemKey: "owner/already",
                raw: { full_name: "owner/already", html_url: "https://github.com/owner/already", description: "" },
                title: "owner/already",
                sourceType: "stars",
            },
            {
                itemKey: "owner/fresh",
                raw: { full_name: "owner/fresh", html_url: "https://github.com/owner/fresh", description: "" },
                title: "owner/fresh",
                sourceType: "stars",
            },
        ];

        // enrichRepo 可能打网; stub
        const { GitHubExporter } = require("../src/import/GitHubExporter");
        vi.spyOn(GitHubExporter, "enrichRepo").mockImplementation(async (r) => r);

        const result = await GitHubAutoImporter._exportViaGitHubExporter(
            mapped,
            "stars",
            meta,
            { apiKey: "k", databaseId: "db" }
        );

        expect(result.success.map((e) => e.itemKey).sort()).toEqual(["owner/already", "owner/fresh"]);
        expect(result.success.find((e) => e.itemKey === "owner/already").skippedExisting).toBe(true);
        expect(result.created.map((e) => e.itemKey)).toEqual(["owner/fresh"]);
        // 仅 fresh 建页
        expect(reqSpy).toHaveBeenCalledTimes(1);
        expect(reqSpy.mock.calls[0][2].properties["链接"].url).toContain("owner/fresh");

        reqSpy.mockRestore();
        createSpy.mockRestore?.();
    });
});
