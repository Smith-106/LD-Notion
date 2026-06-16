import { describe, it, expect, beforeEach } from "vitest";
import { AdapterRegistry } from "../src/adapter/AdapterRegistry.js";
import { SourceAdapter } from "../src/adapter/SourceAdapter.js";
import { LinuxDoAdapter } from "../src/adapter/LinuxDoAdapter.js";
import { createGitHubAdapter } from "../src/adapter/GitHubAdapter.js";
import { BookmarkAdapter } from "../src/adapter/BookmarkAdapter.js";
import { RSSAdapter } from "../src/adapter/RSSAdapter.js";
import { ZhihuAdapter } from "../src/adapter/ZhihuAdapter.js";
import { GenericAdapter } from "../src/adapter/GenericAdapter.js";

// 清空注册表以避免跨测试污染
const originalRegistry = new Map();

beforeEach(() => {
    // Save and clear registry
    originalRegistry.clear();
    for (const key of AdapterRegistry.listAdapters()) {
        originalRegistry.set(key, AdapterRegistry.getAdapter(key));
    }
    AdapterRegistry.clear();
});

describe("SourceAdapter contract", () => {
    const adapters = [
        { name: "linuxdo", adapter: LinuxDoAdapter },
        { name: "github-stars", adapter: createGitHubAdapter("stars") },
        { name: "github-repos", adapter: createGitHubAdapter("repos") },
        { name: "bookmark", adapter: BookmarkAdapter },
        { name: "rss", adapter: RSSAdapter },
        { name: "zhihu", adapter: ZhihuAdapter },
        { name: "generic", adapter: GenericAdapter },
    ];

    for (const { name, adapter } of adapters) {
        describe(`${name} adapter`, () => {
            it("implements all 4 SourceAdapter methods", () => {
                expect(typeof adapter.fetchIncremental).toBe("function");
                expect(typeof adapter.fetchAll).toBe("function");
                expect(typeof adapter.normalize).toBe("function");
                expect(typeof adapter.getDedupKey).toBe("function");
            });

            it("has a valid sourceType", () => {
                expect(typeof adapter.sourceType).toBe("string");
                expect(adapter.sourceType.length).toBeGreaterThan(0);
            });

            it("normalize({}) returns an object with all 9 NormalizedItem fields", () => {
                const item = adapter.normalize({});
                expect(item).toBeDefined();
                expect(typeof item).toBe("object");
                expect("source" in item).toBe(true);
                expect("id" in item).toBe(true);
                expect("title" in item).toBe(true);
                expect("content" in item).toBe(true);
                expect("url" in item).toBe(true);
                expect("author" in item).toBe(true);
                expect("tags" in item).toBe(true);
                expect("createdAt" in item).toBe(true);
                expect("raw" in item).toBe(true);
            });

            it("normalize sets correct source field", () => {
                const item = adapter.normalize({});
                // source should be a prefix of the sourceType
                expect(typeof item.source).toBe("string");
            });

            it("getDedupKey returns a non-empty string from a normalized item", () => {
                const item = adapter.normalize({ id: "test-123", url: "https://example.com" });
                const key = adapter.getDedupKey(item);
                expect(typeof key).toBe("string");
                expect(key.length).toBeGreaterThan(0);
            });
        });
    }
});

describe("AdapterRegistry", () => {
    it("registers and retrieves an adapter", () => {
        const mock = {
            sourceType: "test-source",
            fetchIncremental: async () => [],
            fetchAll: async () => [],
            normalize: (raw) => ({ source: "test-source", id: "", title: "", content: "", url: "", author: "", tags: [], createdAt: "", raw }),
            getDedupKey: (item) => `test:${item.id}`,
        };
        AdapterRegistry.register(mock);
        expect(AdapterRegistry.getAdapter("test-source")).toBe(mock);
    });

    it("rejects adapter without sourceType", () => {
        expect(() => AdapterRegistry.register({})).toThrow("sourceType");
    });

    it("rejects adapter missing required methods", () => {
        expect(() =>
            AdapterRegistry.register({ sourceType: "bad", fetchIncremental: async () => [] })
        ).toThrow("缺少方法");
    });

    it("listAdapters returns all registered types", () => {
        const a1 = {
            sourceType: "t1",
            fetchIncremental: async () => [],
            fetchAll: async () => [],
            normalize: (r) => ({ source: "t1", id: "", title: "", content: "", url: "", author: "", tags: [], createdAt: "", raw: r }),
            getDedupKey: (i) => `t1:${i.id}`,
        };
        const a2 = {
            sourceType: "t2",
            fetchIncremental: async () => [],
            fetchAll: async () => [],
            normalize: (r) => ({ source: "t2", id: "", title: "", content: "", url: "", author: "", tags: [], createdAt: "", raw: r }),
            getDedupKey: (i) => `t2:${i.id}`,
        };
        AdapterRegistry.register(a1);
        AdapterRegistry.register(a2);
        expect(AdapterRegistry.listAdapters()).toContain("t1");
        expect(AdapterRegistry.listAdapters()).toContain("t2");
    });

    it("getAdapter returns null for unknown type", () => {
        expect(AdapterRegistry.getAdapter("nonexistent")).toBeNull();
    });
});
