"use strict";

import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;

if (typeof document === "undefined") {
    global.document = { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }) };
}

const { CONFIG } = require("../src/config");
const { Storage, DedupStore } = require("../src/storage");

describe("v3.15.1 ledger-snapshot align", () => {
    let UI;

    beforeEach(() => {
        store.clear();
        DedupStore._batchCaches = {};
        Storage._exportedTopicsCache = null;
        Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, "strict");
        Storage.set(CONFIG.STORAGE_KEYS.EXPORT_STATUS_SOURCE, "local");

        UI = require("../src/ui/main-ui").UI;
        UI.bookmarks = [
            { topic_id: 101, title: "a" },
            { topic_id: 202, title: "b" },
            { topic_id: 303, title: "c" },
        ];
        UI.workspaceVisualSnapshot = { databases: [], pages: [], records: [], scannedAt: 0, maxPages: 0 };
        UI.refs = UI.refs || {};
        UI.renderBookmarkList = () => {};
        UI.updateSelectCount = () => {};
        UI.renderVisualSummary = () => {};
        UI.recomputeExportStats = UI.recomputeExportStats || (() => {});
        UI._workspaceExportUrlSetCache = null;
        UI._bookmarkKeyUrlCache = null;
    });

    it("无快照时 diff 为空且对齐被拒绝", () => {
        Storage.markTopicExported("101");
        const diff = UI.computeLedgerSnapshotDiff();
        expect(diff.hasSnapshot).toBe(false);
        expect(diff.reason).toBe("no-snapshot");
        expect(diff.ledgerOnly).toEqual([]);
        const res = UI.alignLedgerToSnapshot();
        expect(res.ok).toBe(false);
        expect(res.reason).toBe("no-snapshot");
        // 本地账本只读保留
        expect(Storage.isTopicExported("101")).toBe(true);
    });

    it("空快照（0 records）对齐被拒绝，防静默全清", () => {
        Storage.markTopicExported("101");
        UI.workspaceVisualSnapshot = {
            databases: [], pages: [], records: [],
            scannedAt: Date.now(), maxPages: 100,
        };
        const res = UI.alignLedgerToSnapshot();
        expect(res.ok).toBe(false);
        expect(res.reason).toBe("empty-snapshot");
        expect(Storage.isTopicExported("101")).toBe(true);
    });

    it("账本多记项被识别并对齐移除，快照命中项保留", () => {
        Storage.markTopicExported("101"); // 快照缺失 → 残留
        Storage.markTopicExported("202"); // 快照命中 → 保留
        UI.workspaceVisualSnapshot = {
            databases: [], pages: [],
            scannedAt: Date.now(), maxPages: 100,
            records: [{ sourceUrl: "https://linux.do/t/202" }],
        };
        const diff = UI.computeLedgerSnapshotDiff();
        expect(diff.hasSnapshot).toBe(true);
        expect(diff.ledgerOnly.map((x) => x.key)).toEqual(["101"]);
        expect(diff.snapshotOnly).toEqual([]);

        const res = UI.alignLedgerToSnapshot();
        expect(res.ok).toBe(true);
        expect(res.aligned).toBe(1);
        expect(Storage.isTopicExported("101")).toBe(false);
        expect(Storage.isTopicExported("202")).toBe(true);
        // 对齐后 101 回到待导出
        expect(UI.isExportedForUi("101")).toBe(false);
        expect(UI.isExportedForUi("202")).toBe(true);
    });

    it("仅动当前列表交集：未加载键不受影响", () => {
        Storage.markTopicExported("101");
        Storage.markTopicExported("999"); // 不在当前列表
        UI.workspaceVisualSnapshot = {
            databases: [], pages: [],
            scannedAt: Date.now(), maxPages: 100,
            records: [{ sourceUrl: "https://linux.do/t/other" }],
        };
        const res = UI.alignLedgerToSnapshot();
        expect(res.ok).toBe(true);
        expect(res.aligned).toBe(1);
        expect(Storage.isTopicExported("999")).toBe(true);
    });

    it("keys 白名单仅对齐指定项", () => {
        Storage.markTopicExported("101");
        Storage.markTopicExported("303");
        UI.workspaceVisualSnapshot = {
            databases: [], pages: [],
            scannedAt: Date.now(), maxPages: 100,
            records: [{ sourceUrl: "https://linux.do/t/other" }],
        };
        const res = UI.alignLedgerToSnapshot(["101"]);
        expect(res.aligned).toBe(1);
        expect(Storage.isTopicExported("101")).toBe(false);
        expect(Storage.isTopicExported("303")).toBe(true);
    });

    it("recomputeExportStatusFromNotion 透出分歧计数", () => {
        Storage.markTopicExported("101");
        UI.workspaceVisualSnapshot = {
            databases: [], pages: [],
            scannedAt: Date.now(), maxPages: 100,
            records: [{ sourceUrl: "https://linux.do/t/202" }],
        };
        UI.setExportStatusSource("notion");
        const result = UI.recomputeExportStatusFromNotion();
        expect(result.hasSnapshot).toBe(true);
        expect(result.ledgerOnlyCount).toBe(1);
        expect(result.ledgerOnly.map((x) => x.key)).toEqual(["101"]);
    });
});
