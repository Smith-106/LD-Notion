import { describe, it, expect, beforeEach, vi } from "vitest";
import { SyncCoordinator } from "../src/adapter/SyncCoordinator.js";
import { AdapterRegistry } from "../src/adapter/AdapterRegistry.js";
import { SyncStateV2 } from "../src/storage/SyncState.js";
import { DedupStore } from "../src/storage/DedupStore.js";

describe("DedupStore", () => {
    beforeEach(() => {
        DedupStore.clearSeen("test-source");
    });

    it("isDuplicate returns false for unseen key", () => {
        expect(DedupStore.isDuplicate("test-source", "item-1")).toBe(false);
    });

    it("markSeen adds key and isDuplicate returns true", () => {
        DedupStore.markSeen("test-source", "item-1");
        expect(DedupStore.isDuplicate("test-source", "item-1")).toBe(true);
    });

    it("getSeen returns the full set", () => {
        DedupStore.markSeen("test-source", "a");
        DedupStore.markSeen("test-source", "b");
        const seen = DedupStore.getSeen("test-source");
        expect("a" in seen).toBe(true);
        expect("b" in seen).toBe(true);
    });

    it("clearSeen empties the set", () => {
        DedupStore.markSeen("test-source", "x");
        DedupStore.clearSeen("test-source");
        expect(DedupStore.isDuplicate("test-source", "x")).toBe(false);
    });
});

describe("SyncCoordinator", () => {
    let mockAdapter;
    let testRegistry;

    beforeEach(() => {
        // Create an isolated test registry
        testRegistry = {
            getAdapter: vi.fn(),
            listAdapters: vi.fn(() => []),
            register: vi.fn(),
            clear: vi.fn(),
        };

        // Inject test registry into SyncCoordinator
        SyncCoordinator.setRegistry(testRegistry);

        // Create mock adapter
        mockAdapter = {
            sourceType: "test-sync",
            fetchIncremental: vi.fn(),
            fetchAll: vi.fn(),
            normalize: (raw) => ({
                source: "test-sync", id: raw.id, title: raw.title, content: "",
                url: raw.url || "", author: "", tags: [], createdAt: raw.time || "", raw,
            }),
            getDedupKey: (item) => `test:${item.id}`,
            getItemTime: (item) => item.createdAt || "",
            getItemId: (item) => item.id || "",
        };
        testRegistry.getAdapter.mockReturnValue(mockAdapter);

        // Reset SyncStateV2 cache
        SyncStateV2._cache = null;

        // Clear dedup
        DedupStore.clearSeen("test-sync");
    });

    it("sync returns new items and skips duplicates", async () => {
        const items = [
            { id: "1", title: "Item 1", time: "2026-06-14T10:00:00Z" },
            { id: "2", title: "Item 2", time: "2026-06-14T11:00:00Z" },
            { id: "3", title: "Item 3", time: "2026-06-14T12:00:00Z" },
        ];
        mockAdapter.fetchIncremental.mockResolvedValue(
            items.map((r) => mockAdapter.normalize(r))
        );

        // Pre-mark item-2 as seen
        DedupStore.markSeen("test-sync", "test:2");

        const result = await SyncCoordinator.sync("test-sync");
        expect(result.newItems).toHaveLength(2);
        expect(result.skippedCount).toBe(1);
        expect(result.newItems[0].id).toBe("1");
        expect(result.newItems[1].id).toBe("3");
    });

    it("sync updates SyncState on success", async () => {
        mockAdapter.fetchIncremental.mockResolvedValue([
            mockAdapter.normalize({ id: "a", title: "A", time: "2026-06-14T10:00:00Z" }),
        ]);

        await SyncCoordinator.sync("test-sync");
        const state = SyncStateV2.getSourceState("test-sync");
        expect(state.lastOutcome).toBe("success");
        expect(state.lastSuccessAt).toBeGreaterThan(0);
    });

    it("sync handles adapter errors and updates SyncState", async () => {
        mockAdapter.fetchIncremental.mockRejectedValue(new Error("Network failure"));

        const result = await SyncCoordinator.sync("test-sync");
        expect(result.newItems).toHaveLength(0);
        expect(result.error).toBe("Network failure");

        const state = SyncStateV2.getSourceState("test-sync");
        expect(state.lastOutcome).toBe("error");
        expect(state.lastError).toBe("Network failure");
    });

    it("sync with fullSync=true calls fetchAll", async () => {
        mockAdapter.fetchAll.mockResolvedValue([
            mockAdapter.normalize({ id: "x", title: "X", time: "2026-06-14T10:00:00Z" }),
        ]);

        const result = await SyncCoordinator.sync("test-sync", { fullSync: true });
        expect(mockAdapter.fetchAll).toHaveBeenCalled();
        expect(result.newItems).toHaveLength(1);
    });

    it("sync returns error for unknown source type", async () => {
        testRegistry.getAdapter.mockReturnValue(null);

        const result = await SyncCoordinator.sync("nonexistent");
        expect(result.error).toContain("未注册适配器");
        expect(result.newItems).toHaveLength(0);
    });
});
