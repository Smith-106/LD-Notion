import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";

// P3 共识修复回归(第四批): generic-ui 转义/警告可见性/目标刷新竞态/导出重入
const { GenericUI } = require("../src/ui/generic-ui.js");

const src = fs.readFileSync("src/ui/generic-ui.js", "utf8");

describe("P3: GenericUI 面板转义与警告可见性", () => {
    afterEach(() => {
        GenericUI.panel = null;
    });

    it("publishDate 经 escapeHtml 插值", () => {
        expect(src).toMatch(/\$\{meta\.publishDate \? ` · \$\{Utils\.escapeHtml\(String\(meta\.publishDate\)\)\}` : ""\}/);
    });

    it("warning 状态有展示样式(基础规则 display:none)", () => {
        expect(src).toContain(".gclip-status.warning {");
        expect(src).toMatch(/\.gclip-status\.warning \{\s*display: block;/);
    });

    it("showStatus 保留 warning 类名", () => {
        const el = {
            textContent: "",
            className: "",
            _statusTimer: null,
            setAttribute: vi.fn(),
        };
        GenericUI.panel = { querySelector: vi.fn(() => el) };
        GenericUI.showStatus("目标已保存，但属性配置失败", "warning");
        expect(el.className).toBe("gclip-status warning");
    });
});

describe("P3: 工作区目标刷新竞态", () => {
    it("晚到响应被请求序号丢弃", () => {
        expect(src).toContain("GenericUI._workspaceTargetsEpoch = epoch;");
        expect(src).toContain("const isStale = () => epoch !== GenericUI._workspaceTargetsEpoch;");
        const guards = src.match(/if \(isStale\(\)\) return;/g) || [];
        expect(guards.length).toBeGreaterThanOrEqual(2);
        expect(src).toMatch(/if \(refreshBtn && !isStale\(\)\)/);
    });
});

describe("P3: 导出重入与浮钮定时器", () => {
    it("isExporting 在确认弹窗之前占位", () => {
        const flagIdx = src.indexOf("GenericUI.isExporting = true;");
        const dialogIdx = src.indexOf("await ConfirmationDialog.show({");
        expect(flagIdx).toBeGreaterThan(-1);
        expect(dialogIdx).toBeGreaterThan(flagIdx);
    });

    it("浮钮恢复定时器句柄可清理", () => {
        expect(src).toContain("clearTimeout(GenericUI._floatResetTimer);");
        expect(src).toContain("GenericUI._floatResetTimer = setTimeout(() => {");
    });
});
