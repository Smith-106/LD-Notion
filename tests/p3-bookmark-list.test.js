import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";

// P3 共识修复回归(第五批): bookmark-list 空引用/陈旧异步绑定/重复渲染/Obsidian 重复导出
const { BookmarkList } = require("../src/ui/bookmark-list.js");
const { UI } = require("../src/ui/main-ui.js");

const blSrc = fs.readFileSync("src/ui/bookmark-list.js", "utf8");
const evSrc = fs.readFileSync("src/ui/events.js", "utf8");
const exportBindSrc = fs.readFileSync("src/ui/events/export-bindings.js", "utf8");

describe("P3: bookmark-list 空引用与陈旧绑定", () => {
    afterEach(() => {
        UI.refs = {};
        UI.bookmarks = [];
        UI.renderJobId = 0;
    });

    it("renderBookmarkList 在 refs 为空时静默返回", () => {
        UI.refs = null;
        expect(() => BookmarkList.renderBookmarkList()).not.toThrow();
    });

    it("空态异步绑定校验渲染代次", () => {
        expect(blSrc).toMatch(/if \(renderJobId !== UI\(\)\.renderJobId\) return;/);
    });

    it("refs.bookmarkList 访问带可选链", () => {
        expect(blSrc).toContain("const list = UI().refs?.bookmarkList;");
        expect(blSrc).not.toMatch(/const list = UI\(\)\.refs\.bookmarkList\n/);
    });
});

describe("P3: 导出状态重算不重复渲染", () => {
    it("recomputeExportStatusFromNotion 不再重复调用 updateSelectCount/renderVisualSummary", () => {
        // 函数体截取以首个同级方法 computeLedgerSnapshotDiff 为界（getSelectedBookmarks 在
        // alignLedgerToSnapshot 之后，旧截断会把 align 体内新增的 updateSelectCount 计入）。
        const fnStart = blSrc.indexOf("recomputeExportStatusFromNotion:");
        const fnEnd = blSrc.indexOf("computeLedgerSnapshotDiff:", fnStart);
        const body = blSrc.slice(fnStart, fnEnd);
        expect(body).toContain("UI().renderBookmarkList?.();");
        expect(body).not.toContain("UI().renderVisualSummary?.();");
        // v3.16.1: renderBookmarkList 内 updateSelectCount 由分块 rAF 驱动的行徽标晚到；
        // recompute 路径（模式切换/刷新快照）显式补一次 updateSelectCount 保计数文案同轮一致，
        // 允许恰一次直接调用（仍禁止 renderVisualSummary 直调，避免同轮双渲染）。
        const directCalls = (body.match(/UI\(\)\.updateSelectCount\?\.\(\);/g) || []).length;
        expect(directCalls).toBe(1);
    });
});

describe("P3: Obsidian 导出过滤已导出项", () => {
    it("与 Notion 导出同款过滤", () => {
        // M3 events 拆分: Obsidian 导出绑定迁 src/ui/events/export-bindings.js
        expect(exportBindSrc).toMatch(
            /const selected = UI\.getSelectedBookmarks\(\)\.filter\(\(b\) => !UI\.isBookmarkKeyExported\(UI\.getBookmarkKey\(b\)\)\);/
        );
    });
});
