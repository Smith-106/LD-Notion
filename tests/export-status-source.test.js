"use strict";

import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;

// jsdom-ish minimal document for modules that touch DOM at load
if (typeof document === "undefined") {
    global.document = { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }) };
}

const { CONFIG } = require("../src/config");
const { Storage, DedupStore } = require("../src/storage");

describe("v3.14.16 export status source", () => {
    let UI;

    beforeEach(() => {
        store.clear();
        DedupStore._batchCaches = {};
        Storage._exportedTopicsCache = null;
        Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, "strict");
        Storage.set(CONFIG.STORAGE_KEYS.EXPORT_STATUS_SOURCE, "local");

        // main-ui 在加载时已混入 BookmarkList；直接操作共享 UI 对象
        UI = require("../src/ui/main-ui").UI;
        UI.bookmarks = [
            { topic_id: 101, title: "a" },
            { topic_id: 202, title: "b" },
        ];
        UI.workspaceVisualSnapshot = { databases: [], pages: [], records: [], scannedAt: 0, maxPages: 0 };
        UI.refs = UI.refs || {};
        UI.recomputeExportStats = UI.recomputeExportStats || (() => {});
        UI.renderBookmarkList = () => {};
        UI.updateSelectCount = () => {};
        UI.renderVisualSummary = () => {};
    });

    it("config key defaults to local", () => {
        expect(CONFIG.STORAGE_KEYS.EXPORT_STATUS_SOURCE).toBe("ldb_export_status_source");
        expect(CONFIG.DEFAULTS.exportStatusSource).toBe("local");
        expect(UI.getExportStatusSource()).toBe("local");
    });

    it("local ledger still marks exported; notion without snapshot → all pending", () => {
        Storage.markTopicExported("101");
        expect(Storage.isTopicExported("101")).toBe(true);
        expect(UI.isExportedForUi("101")).toBe(true);
        expect(UI.isExportedForUi("202")).toBe(false);

        UI.setExportStatusSource("notion");
        expect(UI.getExportStatusSource()).toBe("notion");
        expect(UI.hasWorkspaceExportSnapshot()).toBe(false);
        // 无快照：全部待导出（不静默跳过）
        expect(UI.isExportedForUi("101")).toBe(false);
        expect(UI.isExportedForUi("202")).toBe(false);
        // 本地账本只读保留
        expect(Storage.isTopicExported("101")).toBe(true);
    });

    it("notion mode: snapshot URL hit ⇒ exported; empty after wipe ⇒ pending", () => {
        Storage.markTopicExported("202");
        UI.workspaceVisualSnapshot = {
            databases: [],
            pages: [],
            scannedAt: Date.now(),
            maxPages: 100,
            records: [{ sourceUrl: "https://linux.do/t/cool-slug/101" }],
        };
        UI.setExportStatusSource("notion");

        expect(UI.isExportedForUi("101")).toBe(true);
        expect(UI.isExportedForUi("202")).toBe(false); // 快照无 202，忽略本地账本

        UI.workspaceVisualSnapshot = {
            databases: [],
            pages: [],
            scannedAt: Date.now(),
            maxPages: 100,
            records: [],
        };
        expect(UI.isExportedForUi("101")).toBe(false);
        expect(UI.isExportedForUi("202")).toBe(false);
        expect(Storage.isTopicExported("202")).toBe(true);
    });

    it("recomputeExportStatusFromNotion is read-only vs local ledger", () => {
        UI.bookmarks = [{ topic_id: 7, title: "x" }];
        UI.workspaceVisualSnapshot = {
            scannedAt: Date.now(),
            records: [{ sourceUrl: "https://linux.do/t/7" }],
            databases: [],
            pages: [],
            maxPages: 10,
        };
        UI.setExportStatusSource("notion");
        expect(Storage.isTopicExported("7")).toBe(false);
        const result = UI.recomputeExportStatusFromNotion();
        expect(result.hasSnapshot).toBe(true);
        expect(result.urlCount).toBe(1);
        expect(Storage.isTopicExported("7")).toBe(false);
        expect(UI.isExportedForUi("7")).toBe(true);
    });
});
