import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

// P3 共识修复回归(第六批): PanelResize 幂等/重置落盘/指针捕获降级/恢复钳制
const { PanelResize } = require("../src/ui/panel-resize.js");
const { Storage } = require("../src/storage");

const src = fs.readFileSync("src/ui/panel-resize.js", "utf8");

const makeEl = () => ({
    style: {},
    offsetWidth: 300,
    offsetHeight: 400,
    children: [],
    appendChild(child) { this.children.push(child); },
});

describe("P3: PanelResize.makeResizable 幂等与重置落盘", () => {
    let originalCreate;

    beforeEach(() => {
        originalCreate = document.createElement;
        document.createElement = () => ({
            className: "",
            style: {},
            attrs: {},
            setAttribute(k, v) { this.attrs[k] = v; },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        window.innerWidth = 1200;
        window.innerHeight = 800;
        PanelResize._resizeTargets = new Map();
    });

    afterEach(() => {
        document.createElement = originalCreate;
    });

    it("同一元素重复调用不叠加手柄", () => {
        const el = makeEl();
        PanelResize.makeResizable(el, { storageKey: "p3-pr-a" });
        const firstCount = el.children.length;
        expect(firstCount).toBe(2);
        PanelResize.makeResizable(el, { storageKey: "p3-pr-a" });
        expect(el.children.length).toBe(firstCount);
    });

    it("resetSize 无参时清除首个面板自身的持久化尺寸", () => {
        Storage.set("p3-pr-reset", JSON.stringify({ width: "500px", maxHeight: "600px" }));
        const el = makeEl();
        PanelResize.makeResizable(el, { storageKey: "p3-pr-reset" });
        expect(el.style.width).toBe("500px");

        PanelResize.resetSize();
        expect(Storage.get("p3-pr-reset", null)).toBeNull();
        expect(el.style.width).toBe("");
        expect(el.style.maxHeight).toBe("");
    });

    it("恢复尺寸应用 min/max 钳制", () => {
        Storage.set("p3-pr-clamp", JSON.stringify({ width: "10px", maxHeight: "5px" }));
        const el = makeEl();
        PanelResize.makeResizable(el, {
            storageKey: "p3-pr-clamp",
            minWidth: 280,
            minHeight: 200,
            maxWidth: 800,
        });
        expect(el.style.width).toBe("280px");
        expect(el.style.maxHeight).toBe("200px");
    });
});

describe("P3: 指针捕获降级", () => {
    it("捕获失败时监听挂到 document 并在结束时清理", () => {
        expect(src).toContain("const moveTarget = captured ? handle : document;");
        expect(src).toMatch(/moveTarget\.addEventListener\("pointermove", onMove\);/);
        expect(src).toMatch(/moveTarget\.removeEventListener\("pointermove", onMove\);/);
        expect(src).toMatch(/if \(captured\) \{/);
    });
});
