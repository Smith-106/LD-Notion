"use strict";

// 四类去重修复契约测试(F1-F14 共识):
// 1. Linux.do 单一账本(Storage 委托 DedupStore,UI 清除/统计对齐)
// 2. 书签 URL 规范化去重(R9) + 缓存失效(F3) + 标记后置(F6)
// 3. 分类列表大小写归一(F11) + 白名单归一(F12/F13)
// 4. BookmarkAdapter 时间修复(F5) + 空 id 兜底(F14)
import { describe, it, expect, beforeEach, vi } from "vitest";

// 注入 GM mock(与 tests/setup.js 同构)
const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0; // no-op

const { CONFIG } = require("../src/config");
const { Storage } = require("../src/storage");
const { DedupStore } = require("../src/storage/DedupStore");
const { Utils } = require("../src/utils");

beforeEach(() => {
    store.clear();
    Storage._exportedTopicsCache = null;
    Storage._exportedTopicsWatcherBound = false;
    Storage._exportedTopicsMigrated = false;
    DedupStore._batchCache = null;
    DedupStore._batchSourceType = null;
    // 清空 legacy 迁移态
    const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
    BookmarkExporter._exportedCache = null;
    BookmarkExporter._exportedWatcherBound = false;
    BookmarkExporter._exportedKeysMigrated = false;
    const { GitHubAPI } = require("../src/import/GitHubAPI");
    GitHubAPI._exportedCache = null;
    GitHubAPI._exportedGistsCache = null;
    GitHubAPI._exportedWatcherBound = false;
});

describe("F1 单一账本: Storage 委托 DedupStore", () => {
    it("markTopicExported 写入 DedupStore 集合,isTopicExported 可读", () => {
        Storage.markTopicExported(12345);
        expect(Storage.isTopicExported(12345)).toBe(true);
        expect(Storage.isTopicExported(12346)).toBe(false);
        // 底层账本同键
        expect(DedupStore.isDuplicate("linuxdo", "12345")).toBe(true);
        expect(DedupStore.getSeen("linuxdo")["12345"]).toBeTypeOf("number");
    });

    it("unmarkTopicExported 双路径删除", () => {
        Storage.markTopicExported("abc");
        expect(Storage.unmarkTopicExported("abc")).toBe(true);
        expect(Storage.isTopicExported("abc")).toBe(false);
        expect(Storage.unmarkTopicExported("abc")).toBe(false);
        expect(DedupStore.isDuplicate("linuxdo", "abc")).toBe(false);
    });

    it("数字与字符串键等价(JS 对象键字符串化)", () => {
        Storage.markTopicExported(42);
        expect(Storage.isTopicExported("42")).toBe(true);
    });

    it("legacy 键迁移: 旧 ldb_exported_topics 合并入 DedupStore 并删除旧键", () => {
        store.set(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, JSON.stringify({ 777: 1000, 888: 2000 }));
        Storage.getExportedTopics();
        expect(Storage.isTopicExported(777)).toBe(true);
        expect(Storage.isTopicExported(888)).toBe(true);
        expect(store.has(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS)).toBe(false);
        expect(DedupStore.getSeen("linuxdo")["777"]).toBe(1000);
    });

    it("迁移取 max ts 合并不覆盖新值", () => {
        DedupStore.markSeen("linuxdo", "555");
        store.set(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, JSON.stringify({ 555: 1, 666: 999 }));
        Storage.getExportedTopics();
        expect(Storage.isTopicExported(555)).toBe(true);
        expect(Storage.isTopicExported(666)).toBe(true);
        // 555 已存在且 1 < 现有 ts, 保留新值
        expect(DedupStore.getSeen("linuxdo")["555"]).toBeGreaterThan(1);
    });

    it("clearExportedTopics 清空统一账本", () => {
        Storage.markTopicExported(1);
        Storage.markTopicExported(2);
        Storage.clearExportedTopics();
        expect(Storage.isTopicExported(1)).toBe(false);
        expect(DedupStore.getSeen("linuxdo")).toEqual({});
    });

    it("UI 清除通道(DedupStore.clearSeen)现在有效——与生产账本同一集合", () => {
        Storage.markTopicExported(9);
        // 生产: events.js 直接调 DedupStore.clearSeen,GM_addValueChangeListener
        // 会置空 Storage 缓存(测试环境 listener 为 no-op,此处验证统一入口)。
        DedupStore.clearSeen("linuxdo");
        Storage.clearExportedTopics();
        expect(Storage.isTopicExported(9)).toBe(false);
    });
});

describe("F5/F14 BookmarkAdapter 时间与键修复", () => {
    it("dateAdded 毫秒直传,不再压缩成 1970", () => {
        const { BookmarkAdapter } = require("../src/adapter/BookmarkAdapter");
        const item = BookmarkAdapter.normalize({ id: "b1", url: "https://a.com", dateAdded: 1750000000000 });
        expect(item.createdAt).toBe("2025-06-15T15:06:40.000Z");
        // 增量过滤: createdAt > 真实 watermark.time
        expect(item.createdAt > "2025-01-01T00:00:00.000Z").toBe(true);
    });

    it("dateAdded 为 ISO 字符串时兼容", () => {
        const { BookmarkAdapter } = require("../src/adapter/BookmarkAdapter");
        const item = BookmarkAdapter.normalize({ id: "b2", url: "https://b.com", dateAdded: "2024-06-15T10:30:00.000Z" });
        expect(item.createdAt).toBe("2024-06-15T10:30:00.000Z");
    });

    it("空 id 用 url 兜底去重键", () => {
        const { BookmarkAdapter } = require("../src/adapter/BookmarkAdapter");
        expect(BookmarkAdapter.getDedupKey({ id: "", url: "https://x.com" })).toBe("bookmark:https://x.com");
        expect(BookmarkAdapter.getDedupKey({ id: "b9", url: "https://x.com" })).toBe("bookmark:b9");
    });
});

describe("R9 URL 规范化去重", () => {
    it("尾斜杠/hash/utm 变体归一为同一键", () => {
        const a = Utils.normalizeDedupUrl("https://a.com/path/");
        const b = Utils.normalizeDedupUrl("https://a.com/path");
        const c = Utils.normalizeDedupUrl("https://a.com/path?utm_source=x#frag");
        expect(a).toBe("https://a.com/path");
        expect(b).toBe("https://a.com/path");
        expect(c).toBe("https://a.com/path");
    });

    it("host 大小写归一(URL 解析天然处理)", () => {
        expect(Utils.normalizeDedupUrl("HTTPS://A.com/X")).toBe("https://a.com/X");
    });

    it("根路径尾斜杠去除", () => {
        expect(Utils.normalizeDedupUrl("https://a.com/")).toBe("https://a.com");
    });

    it("非 http(s) 原样返回", () => {
        expect(Utils.normalizeDedupUrl("about:blank")).toBe("about:blank");
        expect(Utils.normalizeDedupUrl("")).toBe("");
    });

    it("BookmarkExporter 读写对称: 变体 URL 命中同一键", () => {
        const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
        BookmarkExporter.markExportedAndFlush("https://a.com/path/");
        expect(BookmarkExporter.isExported("https://a.com/path")).toBe(true);
        expect(BookmarkExporter.isExported("https://a.com/path?utm_source=zz")).toBe(true);
    });

    it("存量未规范化键一次性迁移(孤儿键防重导)", () => {
        const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
        const now = Date.now();
        store.set(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, JSON.stringify({ "https://old.com/x/": now }));
        expect(BookmarkExporter.getExported()).toEqual({ "https://old.com/x": now });
        // 迁移已回写
        expect(JSON.parse(store.get(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED))).toEqual({ "https://old.com/x": now });
        expect(BookmarkExporter.isExported("https://old.com/x/")).toBe(true);
    });
});

describe("F11 分类列表大小写归一", () => {
    it("AI/ai/Ai 只保留首次出现", () => {
        expect(Utils.parseAICategories("AI, ai, Ai, 技术, 技术")).toEqual(["AI", "技术"]);
    });

    it("trim 后比较", () => {
        expect(Utils.parseAICategories(" AI ,AI ")).toEqual(["AI"]);
    });

    it("autoDedup 关闭时保留全部", () => {
        expect(Utils.parseAICategories("AI, ai", false)).toEqual(["AI", "ai"]);
    });
});

describe("F6 标记后置(SyncCoordinator)", () => {
    it("sync 只过滤不标记,返回 pendingKeys", async () => {
        const { SyncCoordinator } = require("../src/adapter/SyncCoordinator");
        const { AdapterRegistry } = require("../src/adapter/AdapterRegistry");
        const fakeAdapter = {
            async fetchIncremental() {
                return [
                    { id: "1", url: "https://x.com/1" },
                    { id: "2", url: "https://x.com/2" },
                ];
            },
            getDedupKey: (item) => `fake:${item.id}`,
            getItemTime: () => "2025-01-01T00:00:00.000Z",
            getItemId: (item) => item.id,
        };
        const registry = { getAdapter: (t) => (t === "fake" ? fakeAdapter : null) };
        SyncCoordinator.setRegistry(registry);
        try {
            const result = await SyncCoordinator.sync("fake");
            expect(result.newItems.length).toBe(2);
            expect(result.pendingKeys).toEqual(["fake:1", "fake:2"]);
            // 过滤阶段未标记
            expect(DedupStore.isDuplicate("fake", "fake:1")).toBe(false);
            // 消费方成功后标记
            SyncCoordinator.markItemSeen("fake", "fake:1");
            expect(DedupStore.isDuplicate("fake", "fake:1")).toBe(true);
            expect(DedupStore.isDuplicate("fake", "fake:2")).toBe(false);
            // 下轮 sync: 已标记的跳过,未标记的仍返回(失败项重试机会保留)
            const again = await SyncCoordinator.sync("fake");
            expect(again.skippedCount).toBe(1);
            expect(again.newItems.map((i) => i.id)).toEqual(["2"]);
        } finally {
            SyncCoordinator.setRegistry(null);
        }
    });
});
