import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3 (AT-006, L2): 对账回填 → 本地账本 → 计数链 全传播验证。
// 命中回填后 recomputeExportStats 必须从账本重算出下降的待导出数(计数链闭合);
// 零命中必须幂等(计数不变)。真实账本走 tests/setup.js 的 gmStore。
const { WorkspaceInsight } = require("../src/ui/workspace-insight.js");
const { UI } = require("../src/ui/main-ui");
const { Storage, DedupStore } = require("../src/storage");
// v3.17: GitHub 收藏源已移除, GitHubAPI 已删除。对账回填仅覆盖 linuxdo。
const { Utils } = require("../src/utils");

describe("AT-006: 对账回填→账本→计数链传播", () => {
    const saved = {};

    beforeEach(() => {
        saved.strict = Utils.isLinuxDoDedupStrict;
        Utils.isLinuxDoDedupStrict = () => true;
        // 内存快照 + 主列表同步数据(真实 getCombinedVisualBookmarks/getBookmarkKey/isExportedForUi/recomputeExportStats)
        UI.visualSnapshots = {
            linuxdo: [
                { source: "linuxdo", topic_id: "42", title: "A" },
                { source: "linuxdo", topic_id: "43", title: "B" },
            ],
        };
        UI.bookmarks = UI.getCombinedVisualBookmarks();
        UI.selectedBookmarks = new Set(UI.bookmarks.map((b) => UI.getBookmarkKey(b)));
        UI.updateSelectCount = () => {};
        UI.renderBookmarkList = () => {};
    });

    afterEach(() => {
        Utils.isLinuxDoDedupStrict = saved.strict;
    });

    it("回填命中 → 账本落账 → recompute 后待导出数下降至 0", () => {
        UI.recomputeExportStats();
        expect(UI.selectedUnexportedCount).toBe(2); // 初始: 两 linuxdo 项均待导出

        const matched = WorkspaceInsight.reconcileExportedFromWorkspace([
            { sourceUrl: "https://linux.do/t/42" },
            { sourceUrl: "https://linux.do/t/43/" }, // 尾斜杠由归一化处理
        ]);
        expect(matched).toBe(2);

        // 账本真实落账(Storage→DedupStore linuxdo batch)
        expect(Storage.isTopicExported("42")).toBe(true);
        expect(Storage.isTopicExported("43")).toBe(true);

        UI.recomputeExportStats();
        expect(UI.selectedUnexportedCount).toBe(0);
        expect(UI.totalUnexportedCount).toBe(0);
    });

    it("零命中幂等: 计数与账本均不变", () => {
        UI.recomputeExportStats();
        const matched = WorkspaceInsight.reconcileExportedFromWorkspace([
            { sourceUrl: "https://linux.do/t/999" },
        ]);
        expect(matched).toBe(0);
        UI.recomputeExportStats();
        expect(UI.selectedUnexportedCount).toBe(2);
        expect(Storage.isTopicExported("42")).toBe(false);
        expect(Storage.isTopicExported("43")).toBe(false);
    });
});
