"use strict";

// P2 存储/状态一致性 三模型共识回归:
// ①非 batch 去重写回必须通知同步引擎(否则手动导出账本永不推送他端 → 跨设备重复导出)
// ②batch 墓碑带时间戳, 不得抹除他 tab 在删除之后的新标记
// ③clearExportedTopics 必须同时删除 legacy 键(否则后续迁移复活已清除记录)
import { describe, it, expect, beforeEach } from "vitest";

const { CONFIG } = require("../src/config");
const { Storage, DedupStore } = require("../src/storage");
const { on, off } = require("../src/coordination/event-bus");

beforeEach(() => {
    GM_deleteValue(DedupStore.keyFor("linuxdo"));
    GM_deleteValue(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS);
    Storage._exportedTopicsCache = null;
    Storage._exportedTopicsMigrated = false;
});

describe("P2 共识: 去重账本变更通知", () => {
    it("非 batch markSeen 必须发 storage:state-committed", () => {
        const hits = [];
        const handler = (e) => hits.push(e);
        on("storage:state-committed", handler);
        try {
            DedupStore.markSeen("linuxdo", "topic-1");
        } finally {
            off("storage:state-committed", handler);
        }
        expect(hits.length).toBe(1);
        expect(hits[0]).toMatchObject({ sourceType: "linuxdo", kind: "dedup" });
    });

    it("非 batch clearSeen 必须发 storage:state-committed", () => {
        const hits = [];
        const handler = (e) => hits.push(e);
        on("storage:state-committed", handler);
        try {
            DedupStore.markSeen("bookmark", "bookmark:1");
            hits.length = 0;
            DedupStore.clearSeen("bookmark");
        } finally {
            off("storage:state-committed", handler);
        }
        expect(hits.length).toBe(1);
    });

    it("batch endBatch 只发一次(事件已下沉到 _saveSet)", () => {
        const hits = [];
        const handler = (e) => hits.push(e);
        on("storage:state-committed", handler);
        try {
            DedupStore.beginBatch("rss");
            DedupStore.markSeen("rss", "rss:1");
            DedupStore.endBatch("rss");
        } finally {
            off("storage:state-committed", handler);
        }
        expect(hits.length).toBe(1);
    });
});

describe("P2 共识: batch 墓碑时间戳", () => {
    it("他 tab 在墓碑之后的重新标记不得被 endBatch 抹除", () => {
        const key = DedupStore.keyFor("linuxdo");
        DedupStore.markSeen("linuxdo", "K");
        DedupStore.beginBatch("linuxdo");
        DedupStore.unmarkSeen("linuxdo", "K");
        // 模拟他 tab 在删除之后重新标记(直接落盘, 时间戳更新)
        const newer = Date.now() + 60000;
        GM_setValue(key, JSON.stringify({ K: newer }));
        DedupStore.endBatch("linuxdo");
        const set = JSON.parse(GM_getValue(key, "{}"));
        expect(set.K).toBe(newer);
    });

    it("盘上无更新时墓碑仍然生效(删除不被 rebase 复活)", () => {
        const key = DedupStore.keyFor("linuxdo");
        DedupStore.markSeen("linuxdo", "K");
        DedupStore.beginBatch("linuxdo");
        DedupStore.unmarkSeen("linuxdo", "K");
        DedupStore.endBatch("linuxdo");
        const set = JSON.parse(GM_getValue(key, "{}"));
        expect(Object.prototype.hasOwnProperty.call(set, "K")).toBe(false);
    });
});

describe("P2 共识: clearExportedTopics 清理 legacy 键", () => {
    it("清除后 legacy 键必须消失, 迁移不得复活记录", () => {
        Storage.setRaw(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, JSON.stringify({ "42": Date.now() }));
        Storage.clearExportedTopics();
        expect(GM_getValue(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, null)).toBeNull();
        // 后续访问触发迁移: 不得把 legacy 记录迁回
        expect(Storage.isTopicExported("42")).toBe(false);
    });
});
