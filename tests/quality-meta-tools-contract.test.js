import { describe, it, expect } from "vitest";

// quality-auto-test p3-r5 (AT-024, L1): meta-tools 注册表契约。
// 依据: agent-executor 按 tool.level <= permLevel 过滤可用工具 —— 畸形条目(缺 execute/level 越界)
// 会使门控静默失效或运行时崩溃; 注册表是 Agent 能力面, 契约必须显式守护。
const META_TOOLS = require("../src/ai/tools/meta-tools");

describe("AT-024: meta-tools 注册表契约", () => {
    const entries = Object.entries(META_TOOLS);

    it("注册表非空", () => {
        expect(entries.length).toBeGreaterThan(0);
    });

    it("全部条目: description/params 非空字符串", () => {
        for (const [name, tool] of entries) {
            expect(typeof tool.description, `${name}.description`).toBe("string");
            expect(tool.description.length, `${name}.description 非空`).toBeGreaterThan(0);
            expect(typeof tool.params, `${name}.params`).toBe("string");
            expect(tool.params.length, `${name}.params 非空`).toBeGreaterThan(0);
        }
    });

    it("全部条目: level 为 0-3 整数(dispatch 权限过滤前提)", () => {
        for (const [name, tool] of entries) {
            expect(Number.isInteger(tool.level), `${name}.level 整数`).toBe(true);
            expect(tool.level, `${name}.level 范围`).toBeGreaterThanOrEqual(0);
            expect(tool.level, `${name}.level 范围`).toBeLessThanOrEqual(3);
        }
    });

    it("全部条目: execute 为函数", () => {
        for (const [name, tool] of entries) {
            expect(typeof tool.execute, `${name}.execute`).toBe("function");
        }
    });
});
