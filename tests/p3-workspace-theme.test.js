import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

// P3 共识修复回归(第三批): 工作区刷新请求序号 / 主题监听幂等 / 确认框按钮样式作用域
const { DesignSystem } = require("../src/ui/design-system.js");

const wsSrc = fs.readFileSync("src/ui/workspace-insight.js", "utf8");
const dsSrc = fs.readFileSync("src/ui/design-system.js", "utf8");

describe("P3: DesignSystem.initTheme 幂等", () => {
    let addSpy;

    beforeEach(() => {
        DesignSystem._mediaQuery = null;
        addSpy = vi.fn();
        window.matchMedia = vi.fn(() => ({
            matches: false,
            addEventListener: addSpy,
            removeEventListener: vi.fn(),
        }));
    });

    afterEach(() => {
        DesignSystem._mediaQuery = null;
    });

    it("重复 initTheme 只绑定一次 change 监听", () => {
        DesignSystem.initTheme();
        DesignSystem.initTheme();
        expect(addSpy).toHaveBeenCalledTimes(1);
    });
});

describe("P3: 确认框按钮样式作用域", () => {
    it("按钮规则收窄到 .ldb-confirm-dialog", () => {
        expect(dsSrc).toContain(".ldb-confirm-dialog .ldb-btn {");
        expect(dsSrc).toContain(".ldb-confirm-dialog .ldb-btn-secondary {");
        expect(dsSrc).toContain(".ldb-confirm-dialog .ldb-btn-danger {");
        expect(dsSrc).toContain(".ldb-confirm-dialog .ldb-btn:disabled {");
    });
});

describe("P3: 工作区刷新请求序号", () => {
    it("并发刷新时旧请求被丢弃", () => {
        expect(wsSrc).toContain("UI()._workspaceRefreshEpoch = epoch;");
        expect(wsSrc).toContain("const isStale = () => epoch !== UI()._workspaceRefreshEpoch;");
        // 两个 await 之后各有一道陈旧检查
        const staleGuards = wsSrc.match(/if \(isStale\(\)\) return;/g) || [];
        expect(staleGuards.length).toBeGreaterThanOrEqual(3);
    });

    it("陈旧请求不解除最新请求的扫描中态", () => {
        expect(wsSrc).toMatch(/if \(refreshBtn && !isStale\(\)\)/);
    });
});
