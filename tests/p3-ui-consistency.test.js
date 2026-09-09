import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

// P3 共识修复回归: UI/DOM/事件 层(剪贴板静默失败、destroy 后悬挂回调、
// 跨页/工作区选择目标回填、加载竞态、导出按钮就绪判定)
const { UI } = require("../src/ui/main-ui.js");
const eventBus = require("../src/coordination/event-bus.js");

const mainUiSrc = fs.readFileSync("src/ui/main-ui.js", "utf8");
const eventsSrc = fs.readFileSync("src/ui/events.js", "utf8");

describe("P3: main-ui 剪贴板统一入口", () => {
    let originalCreateElement;

    beforeEach(() => {
        originalCreateElement = document.createElement;
        document.createElement = () => ({
            value: "",
            setAttribute() {},
            style: {},
            select() {},
            remove() {},
        });
        document.body.appendChild = vi.fn();
    });

    afterEach(() => {
        document.createElement = originalCreateElement;
        delete document.execCommand;
        delete navigator.clipboard;
    });

    it("优先使用 navigator.clipboard 并返回 true", async () => {
        navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };
        await expect(UI.copyTextToClipboard("hello")).resolves.toBe(true);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
    });

    it("剪贴板拒绝时向上抛出(不再静默)", async () => {
        navigator.clipboard = { writeText: vi.fn(() => Promise.reject(new Error("denied"))) };
        await expect(UI.copyTextToClipboard("x")).rejects.toThrow("denied");
    });

    it("无 clipboard API 时降级 execCommand 成功", async () => {
        document.execCommand = vi.fn(() => true);
        await expect(UI.copyTextToClipboard("y")).resolves.toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith("copy");
    });

    it("execCommand 返回 false 时抛错(不再假报成功)", async () => {
        document.execCommand = vi.fn(() => false);
        await expect(UI.copyTextToClipboard("z")).rejects.toThrow(/复制/);
    });

    it("报告错误复制走统一入口", () => {
        expect(mainUiSrc).toMatch(/await UI\.copyTextToClipboard\(el\.dataset\.err/);
        expect(mainUiSrc).not.toMatch(/navigator\.clipboard\?\.writeText\(el\.dataset\.err/);
    });
});

describe("P3: destroy 后悬挂回调与事件总线注销", () => {
    afterEach(() => {
        eventBus.off("p3:bus-test");
        UI.refs = {};
    });

    it("updateSelectCount 在 refs=null 时静默返回", () => {
        UI.refs = null;
        expect(() => UI.updateSelectCount()).not.toThrow();
    });

    it("showReport 在 refs=null 时静默返回", () => {
        UI.refs = null;
        expect(() => UI.showReport({ success: [], failed: [], skipped: [] })).not.toThrow();
    });

    it("destroy 注销 init 注册的总线 handler", () => {
        const handler = vi.fn();
        UI.panel = null;
        UI.miniBtn = null;
        UI._busHandlers = [["p3:bus-test", handler]];
        eventBus.on("p3:bus-test", handler);

        UI.destroy();
        eventBus.emit("p3:bus-test", "late");

        expect(handler).not.toHaveBeenCalled();
        expect(UI._busHandlers).toBeNull();
    });

    it("main-ui 通过 subscribe 记录 handler 供注销", () => {
        expect(mainUiSrc).toContain("UI._busHandlers.forEach(([event, handler]) => off(event, handler));");
        expect(mainUiSrc).not.toMatch(/\n\s*on\("oplog:changed"/);
    });
});

describe("P3: 跨页/工作区选择目标回填", () => {
    it("跨页同步刷新父页面/手动 DB 区域与就绪判定", () => {
        expect(mainUiSrc).toMatch(/refs\.manualDbWrap\.style\.display = isPage \? "none"/);
        expect(mainUiSrc).toContain("UI.updateExportButtonState?.();");
    });

    it("工作区选择 page 分支复用 handleExportTargetChange", () => {
        expect(eventsSrc).toMatch(
            /handleExportTargetChange\(\{ target: \{ value: CONFIG\.EXPORT_TARGET_TYPES\.PAGE \} \}\)/
        );
    });
});

describe("P3: 收藏加载竞态与导出按钮就绪", () => {
    it("加载期间切换来源时丢弃陈旧结果", () => {
        expect(eventsSrc).toContain("const loadSource = UI.getActiveBookmarkSource();");
        expect(eventsSrc).toContain("if (loadSource !== UI.getActiveBookmarkSource()) return;");
    });

    it("导出结束按配置完整性恢复按钮", () => {
        expect(eventsSrc).toMatch(/updateExportButtonState\(\);\n\s*refs\.exportBtns\.style\.display = "flex";/);
        expect(eventsSrc).toContain("UI.updateExportButtonState = updateExportButtonState;");
    });
});
