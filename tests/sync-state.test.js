import { describe, it, expect, beforeEach } from "vitest";
const { SyncStateV2 } = require("../src/storage/SyncState");

describe("SyncStateV2 — normalizeTime", () => {
    it("returns empty string for undefined", () => {
        expect(SyncStateV2.normalizeTime(undefined)).toBe("");
    });

    it("returns empty string for null", () => {
        expect(SyncStateV2.normalizeTime(null)).toBe("");
    });

    it("returns empty string for empty string", () => {
        expect(SyncStateV2.normalizeTime("")).toBe("");
    });

    it("returns empty string for 0", () => {
        expect(SyncStateV2.normalizeTime(0)).toBe("");
    });

    it("returns empty string for invalid date string", () => {
        expect(SyncStateV2.normalizeTime("not-a-date")).toBe("");
    });

    it("returns ISO string for valid Date object", () => {
        const date = new Date("2024-06-15T12:00:00.000Z");
        expect(SyncStateV2.normalizeTime(date)).toBe("2024-06-15T12:00:00.000Z");
    });

    it("returns ISO string for valid ISO string input", () => {
        expect(SyncStateV2.normalizeTime("2024-01-01T00:00:00.000Z")).toBe("2024-01-01T00:00:00.000Z");
    });

    it("returns ISO string for numeric timestamp", () => {
        const ts = Date.parse("2024-03-10T08:30:00.000Z");
        const result = SyncStateV2.normalizeTime(ts);
        expect(result).toBe("2024-03-10T08:30:00.000Z");
    });
});

describe("SyncStateV2 — normalizeWatermark", () => {
    it("returns null for undefined", () => {
        expect(SyncStateV2.normalizeWatermark(undefined)).toBeNull();
    });

    it("returns null for null", () => {
        expect(SyncStateV2.normalizeWatermark(null)).toBeNull();
    });

    it("returns null for non-object primitive", () => {
        expect(SyncStateV2.normalizeWatermark("string")).toBeNull();
        expect(SyncStateV2.normalizeWatermark(42)).toBeNull();
    });

    it("returns null when time is missing", () => {
        expect(SyncStateV2.normalizeWatermark({ ids: ["1"] })).toBeNull();
    });

    it("returns null when time is empty string", () => {
        expect(SyncStateV2.normalizeWatermark({ time: "", ids: ["1"] })).toBeNull();
    });

    it("returns null when time is invalid", () => {
        expect(SyncStateV2.normalizeWatermark({ time: "bad", ids: ["1"] })).toBeNull();
    });

    it("returns normalized watermark with valid time and empty ids array when ids missing", () => {
        const result = SyncStateV2.normalizeWatermark({ time: "2024-01-01T00:00:00.000Z" });
        expect(result).toEqual({ time: "2024-01-01T00:00:00.000Z", ids: [] });
    });

    it("deduplicates ids", () => {
        const result = SyncStateV2.normalizeWatermark({
            time: "2024-01-01T00:00:00.000Z",
            ids: ["a", "b", "a", "c"],
        });
        expect(result.ids).toEqual(["a", "b", "c"]);
    });

    it("filters out empty and falsy ids", () => {
        const result = SyncStateV2.normalizeWatermark({
            time: "2024-01-01T00:00:00.000Z",
            ids: ["a", "", null, "b", undefined, 0],
        });
        expect(result.ids).toEqual(["a", "b"]);
    });

    it("converts numeric ids to strings", () => {
        const result = SyncStateV2.normalizeWatermark({
            time: "2024-01-01T00:00:00.000Z",
            ids: [1, 2, 3],
        });
        expect(result.ids).toEqual(["1", "2", "3"]);
    });
});

describe("SyncStateV2 — normalizeSyncRecord", () => {
    it("returns default record for undefined input", () => {
        const result = SyncStateV2.normalizeSyncRecord(undefined);
        expect(result).toEqual({
            watermark: null,
            lastSuccessAt: 0,
            lastAttemptAt: 0,
            lastOutcome: "idle",
            lastError: "",
            lastStats: {},
        });
    });

    it("returns default record for null input", () => {
        const result = SyncStateV2.normalizeSyncRecord(null);
        expect(result.watermark).toBeNull();
        expect(result.lastOutcome).toBe("idle");
    });

    it("preserves valid fields from input", () => {
        const result = SyncStateV2.normalizeSyncRecord({
            watermark: { time: "2024-01-01T00:00:00.000Z", ids: ["x"] },
            lastSuccessAt: 1704067200000,
            lastAttemptAt: 1704067300000,
            lastOutcome: "success",
            lastError: "",
            lastStats: { fetched: 10 },
        });
        expect(result.watermark).toEqual({ time: "2024-01-01T00:00:00.000Z", ids: ["x"] });
        expect(result.lastSuccessAt).toBe(1704067200000);
        expect(result.lastOutcome).toBe("success");
        expect(result.lastStats).toEqual({ fetched: 10 });
    });

    it("falls back lastOutcome to idle for invalid value", () => {
        const result = SyncStateV2.normalizeSyncRecord({ lastOutcome: "unknown" });
        expect(result.lastOutcome).toBe("idle");
    });

    it("accepts all valid OUTCOMES", () => {
        for (const outcome of ["idle", "running", "success", "partial", "error"]) {
            const result = SyncStateV2.normalizeSyncRecord({ lastOutcome: outcome });
            expect(result.lastOutcome).toBe(outcome);
        }
    });

    it("does not include snapshot when keepSnapshot is false", () => {
        const result = SyncStateV2.normalizeSyncRecord(
            { snapshot: { key: "val" } },
            { keepSnapshot: false }
        );
        expect(result).not.toHaveProperty("snapshot");
    });

    it("includes snapshot when keepSnapshot is true", () => {
        const result = SyncStateV2.normalizeSyncRecord(
            { snapshot: { key: "val" } },
            { keepSnapshot: true }
        );
        expect(result.snapshot).toEqual({ key: "val" });
    });

    it("sets snapshot to empty object when keepSnapshot is true but snapshot is missing", () => {
        const result = SyncStateV2.normalizeSyncRecord(
            { lastOutcome: "idle" },
            { keepSnapshot: true }
        );
        expect(result.snapshot).toEqual({});
    });

    it("coerces lastSuccessAt and lastAttemptAt to numbers", () => {
        const result = SyncStateV2.normalizeSyncRecord({
            lastSuccessAt: "1704067200000",
            lastAttemptAt: "0",
        });
        expect(result.lastSuccessAt).toBe(1704067200000);
        expect(result.lastAttemptAt).toBe(0);
    });
});

describe("SyncStateV2 — buildWatermark", () => {
    it("returns null for empty array", () => {
        expect(SyncStateV2.buildWatermark([], (i) => i.time, (i) => i.id)).toBeNull();
    });

    it("returns null for non-array input", () => {
        expect(SyncStateV2.buildWatermark(null, (i) => i.time, (i) => i.id)).toBeNull();
    });

    it("returns watermark with single item", () => {
        const items = [{ time: "2024-06-01T00:00:00.000Z", id: "1" }];
        const result = SyncStateV2.buildWatermark(items, (i) => i.time, (i) => i.id);
        expect(result).toEqual({ time: "2024-06-01T00:00:00.000Z", ids: ["1"] });
    });

    it("finds the latest time across multiple items", () => {
        const items = [
            { time: "2024-01-01T00:00:00.000Z", id: "a" },
            { time: "2024-06-15T12:00:00.000Z", id: "b" },
            { time: "2024-03-10T08:00:00.000Z", id: "c" },
        ];
        const result = SyncStateV2.buildWatermark(items, (i) => i.time, (i) => i.id);
        expect(result.time).toBe("2024-06-15T12:00:00.000Z");
        expect(result.ids).toEqual(["b"]);
    });

    it("merges ids at the same latest time", () => {
        const items = [
            { time: "2024-06-01T00:00:00.000Z", id: "1" },
            { time: "2024-06-01T00:00:00.000Z", id: "2" },
            { time: "2024-06-01T00:00:00.000Z", id: "3" },
        ];
        const result = SyncStateV2.buildWatermark(items, (i) => i.time, (i) => i.id);
        expect(result.ids).toEqual(["1", "2", "3"]);
    });

    it("resets ids when a newer time is found", () => {
        const items = [
            { time: "2024-01-01T00:00:00.000Z", id: "old1" },
            { time: "2024-01-01T00:00:00.000Z", id: "old2" },
            { time: "2024-06-01T00:00:00.000Z", id: "new1" },
            { time: "2024-06-01T00:00:00.000Z", id: "new2" },
        ];
        const result = SyncStateV2.buildWatermark(items, (i) => i.time, (i) => i.id);
        expect(result.ids).toEqual(["new1", "new2"]);
    });

    it("skips items with invalid time", () => {
        const items = [
            { time: "invalid", id: "bad" },
            { time: "2024-06-01T00:00:00.000Z", id: "good" },
        ];
        const result = SyncStateV2.buildWatermark(items, (i) => i.time, (i) => i.id);
        expect(result.ids).toEqual(["good"]);
    });

    it("skips items with empty id at latest time", () => {
        const items = [
            { time: "2024-06-01T00:00:00.000Z", id: "" },
            { time: "2024-06-01T00:00:00.000Z", id: "valid" },
        ];
        const result = SyncStateV2.buildWatermark(items, (i) => i.time, (i) => i.id);
        expect(result.ids).toEqual(["valid"]);
    });

    it("deduplicates ids at the same latest time", () => {
        const items = [
            { time: "2024-06-01T00:00:00.000Z", id: "dup" },
            { time: "2024-06-01T00:00:00.000Z", id: "dup" },
            { time: "2024-06-01T00:00:00.000Z", id: "unique" },
        ];
        const result = SyncStateV2.buildWatermark(items, (i) => i.time, (i) => i.id);
        expect(result.ids).toEqual(["dup", "unique"]);
    });
});

describe("SyncStateV2 — filterOrderedItems", () => {
    const getTime = (item) => item.time;
    const getId = (item) => item.id;

    it("returns all items when watermark is null", () => {
        const items = [
            { time: "2024-01-01T00:00:00.000Z", id: "1" },
            { time: "2024-02-01T00:00:00.000Z", id: "2" },
        ];
        const result = SyncStateV2.filterOrderedItems(items, null, getTime, getId);
        expect(result).toEqual(items);
    });

    it("returns all items when watermark is empty", () => {
        const items = [{ time: "2024-01-01T00:00:00.000Z", id: "1" }];
        const result = SyncStateV2.filterOrderedItems(items, {}, getTime, getId);
        expect(result).toEqual(items);
    });

    it("includes items with time after watermark", () => {
        const items = [
            { time: "2024-06-01T00:00:00.000Z", id: "2" },
            { time: "2024-01-01T00:00:00.000Z", id: "1" },
        ];
        const watermark = { time: "2024-03-01T00:00:00.000Z", ids: [] };
        const result = SyncStateV2.filterOrderedItems(items, watermark, getTime, getId);
        expect(result).toEqual([{ time: "2024-06-01T00:00:00.000Z", id: "2" }]);
    });

    it("breaks at items with time before watermark", () => {
        const items = [
            { time: "2024-06-01T00:00:00.000Z", id: "2" },
            { time: "2024-01-01T00:00:00.000Z", id: "1" },
            { time: "2024-02-01T00:00:00.000Z", id: "3" },
        ];
        const watermark = { time: "2024-03-01T00:00:00.000Z", ids: [] };
        const result = SyncStateV2.filterOrderedItems(items, watermark, getTime, getId);
        // Item at index 0 > watermark → included; index 1 < watermark → break
        expect(result).toEqual([{ time: "2024-06-01T00:00:00.000Z", id: "2" }]);
    });

    it("includes items at same time with new id", () => {
        const items = [
            { time: "2024-06-01T00:00:00.000Z", id: "new" },
        ];
        const watermark = { time: "2024-06-01T00:00:00.000Z", ids: ["old"] };
        const result = SyncStateV2.filterOrderedItems(items, watermark, getTime, getId);
        expect(result).toEqual([{ time: "2024-06-01T00:00:00.000Z", id: "new" }]);
    });

    it("excludes items at same time with known id", () => {
        const items = [
            { time: "2024-06-01T00:00:00.000Z", id: "known" },
        ];
        const watermark = { time: "2024-06-01T00:00:00.000Z", ids: ["known"] };
        const result = SyncStateV2.filterOrderedItems(items, watermark, getTime, getId);
        expect(result).toEqual([]);
    });

    it("includes items with invalid time (pass through)", () => {
        const items = [
            { time: "", id: "no-time" },
        ];
        const watermark = { time: "2024-06-01T00:00:00.000Z", ids: [] };
        const result = SyncStateV2.filterOrderedItems(items, watermark, getTime, getId);
        expect(result).toEqual([{ time: "", id: "no-time" }]);
    });

    it("returns a copy, not the original array", () => {
        const items = [{ time: "2024-01-01T00:00:00.000Z", id: "1" }];
        const result = SyncStateV2.filterOrderedItems(items, null, getTime, getId);
        expect(result).not.toBe(items);
    });
});

describe("SyncStateV2 — isItemAfterWatermark", () => {
    it("returns true when watermark is null", () => {
        expect(SyncStateV2.isItemAfterWatermark("2024-01-01T00:00:00.000Z", "1", null)).toBe(true);
    });

    it("returns true when watermark is empty object", () => {
        expect(SyncStateV2.isItemAfterWatermark("2024-01-01T00:00:00.000Z", "1", {})).toBe(true);
    });

    it("returns true when item time is after watermark time", () => {
        const wm = { time: "2024-01-01T00:00:00.000Z", ids: [] };
        expect(SyncStateV2.isItemAfterWatermark("2024-06-01T00:00:00.000Z", "1", wm)).toBe(true);
    });

    it("returns false when item time is before watermark time", () => {
        const wm = { time: "2024-06-01T00:00:00.000Z", ids: [] };
        expect(SyncStateV2.isItemAfterWatermark("2024-01-01T00:00:00.000Z", "1", wm)).toBe(false);
    });

    it("returns true when item has same time but new id", () => {
        const wm = { time: "2024-06-01T00:00:00.000Z", ids: ["old"] };
        expect(SyncStateV2.isItemAfterWatermark("2024-06-01T00:00:00.000Z", "new", wm)).toBe(true);
    });

    it("returns false when item has same time and known id", () => {
        const wm = { time: "2024-06-01T00:00:00.000Z", ids: ["known"] };
        expect(SyncStateV2.isItemAfterWatermark("2024-06-01T00:00:00.000Z", "known", wm)).toBe(false);
    });

    it("returns true when item time is invalid (falsy)", () => {
        const wm = { time: "2024-06-01T00:00:00.000Z", ids: [] };
        expect(SyncStateV2.isItemAfterWatermark("", "1", wm)).toBe(true);
    });
});

describe("SyncStateV2 — takeLeadingItems", () => {
    it("returns empty for empty array", () => {
        expect(SyncStateV2.takeLeadingItems([], () => true)).toEqual([]);
    });

    it("takes items while predicate is true", () => {
        const items = [1, 2, 3, 4, 5];
        const result = SyncStateV2.takeLeadingItems(items, (n) => n < 4);
        expect(result).toEqual([1, 2, 3]);
    });

    it("stops at first item that fails predicate", () => {
        const items = [1, 2, 10, 3, 4];
        const result = SyncStateV2.takeLeadingItems(items, (n) => n < 10);
        expect(result).toEqual([1, 2]);
    });

    it("returns all items if all pass predicate", () => {
        const items = [1, 2, 3];
        const result = SyncStateV2.takeLeadingItems(items, () => true);
        expect(result).toEqual([1, 2, 3]);
    });

    it("returns empty if first item fails predicate", () => {
        const items = [10, 1, 2];
        const result = SyncStateV2.takeLeadingItems(items, (n) => n < 5);
        expect(result).toEqual([]);
    });
});

describe("SyncStateV2 — _migrateV1toV2", () => {
    it("maps linuxdo to sources.linuxdo", () => {
        const v1 = {
            linuxdo: { watermark: null, lastOutcome: "success", lastSuccessAt: 100 },
        };
        const v2 = SyncStateV2._migrateV1toV2(v1);
        expect(v2.version).toBe(2);
        expect(v2.sources.linuxdo.lastOutcome).toBe("success");
        expect(v2.sources.linuxdo.lastSuccessAt).toBe(100);
    });

    it("maps github.stars to sources.github-stars", () => {
        const v1 = {
            github: { stars: { watermark: null, lastOutcome: "success" } },
        };
        const v2 = SyncStateV2._migrateV1toV2(v1);
        expect(v2.sources["github-stars"].lastOutcome).toBe("success");
    });

    it("maps github.repos to sources.github-repos", () => {
        const v1 = {
            github: { repos: { watermark: null, lastOutcome: "partial" } },
        };
        const v2 = SyncStateV2._migrateV1toV2(v1);
        expect(v2.sources["github-repos"].lastOutcome).toBe("partial");
    });

    it("maps github.forks to sources.github-forks", () => {
        const v1 = {
            github: { forks: { watermark: null, lastOutcome: "error", lastError: "fail" } },
        };
        const v2 = SyncStateV2._migrateV1toV2(v1);
        expect(v2.sources["github-forks"].lastOutcome).toBe("error");
        expect(v2.sources["github-forks"].lastError).toBe("fail");
    });

    it("maps github.gists to sources.github-gists", () => {
        const v1 = {
            github: { gists: { watermark: null, lastOutcome: "idle" } },
        };
        const v2 = SyncStateV2._migrateV1toV2(v1);
        expect(v2.sources["github-gists"].lastOutcome).toBe("idle");
    });

    it("maps bookmarks to sources.bookmark (not bookmarks)", () => {
        const v1 = {
            bookmarks: { watermark: null, lastOutcome: "success", snapshot: { page: 3 } },
        };
        const v2 = SyncStateV2._migrateV1toV2(v1);
        expect(v2.sources.bookmark).toBeDefined();
        expect(v2.sources.bookmark.lastOutcome).toBe("success");
        expect(v2.sources.bookmark.snapshot).toEqual({ page: 3 });
        expect(v2.sources.bookmarks).toBeUndefined();
    });

    it("maps rss to sources.rss with snapshot preserved", () => {
        const v1 = {
            rss: { watermark: null, lastOutcome: "running", snapshot: { cursor: "abc" } },
        };
        const v2 = SyncStateV2._migrateV1toV2(v1);
        expect(v2.sources.rss.snapshot).toEqual({ cursor: "abc" });
    });

    it("fills default values for missing source types", () => {
        const v2 = SyncStateV2._migrateV1toV2({});
        // All keys from _defaults() should exist
        for (const key of ["linuxdo", "github-stars", "github-repos", "github-forks", "github-gists", "github-meta", "bookmark", "rss", "zhihu", "generic"]) {
            expect(v2.sources[key]).toBeDefined();
            expect(v2.sources[key].lastOutcome).toBe("idle");
        }
    });

    it("includes snapshot defaults for bookmark and rss but not others", () => {
        const v2 = SyncStateV2._migrateV1toV2({});
        expect(v2.sources.bookmark).toHaveProperty("snapshot");
        expect(v2.sources.rss).toHaveProperty("snapshot");
        expect(v2.sources.linuxdo).not.toHaveProperty("snapshot");
        expect(v2.sources["github-stars"]).not.toHaveProperty("snapshot");
    });
});

describe("SyncStateV2 — _makeSourceDefault", () => {
    it("returns correct default structure without snapshot", () => {
        const result = SyncStateV2._makeSourceDefault(false);
        expect(result).toEqual({
            watermark: null,
            lastSuccessAt: 0,
            lastAttemptAt: 0,
            lastOutcome: "idle",
            lastError: "",
            lastStats: {},
        });
        expect(result).not.toHaveProperty("snapshot");
    });

    it("includes snapshot when withSnapshot is true", () => {
        const result = SyncStateV2._makeSourceDefault(true);
        expect(result).toHaveProperty("snapshot");
        expect(result.snapshot).toEqual({});
    });

    it("snapshot is empty object, not null", () => {
        const result = SyncStateV2._makeSourceDefault(true);
        expect(result.snapshot).toEqual({});
    });
});
