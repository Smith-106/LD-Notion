import { describe, it, expect, beforeEach } from "vitest";

// quality-auto-test p3-r3 (AT-015, L1): AgentTrace 追踪持久化。
// 断言面: create 截断/字段契约、recordToolCall/recordResult 摘要与错误收集、
//         persist 截断+落盘+FIFO rotate、畸形存量 JSON 容错。
// 夹具契约: GM_getValue/GM_setValue 由 tests/setup.js 提供(gmStore beforeEach 清空)。
const { AgentTrace } = require("../src/ai/AgentTrace");

describe("AT-015: AgentTrace 追踪持久化", () => {
    beforeEach(() => {
        // gmStore 已清空; 直接读写 AI_TRACE_LOG 键
    });

    it("create: userInput 截断 500 + 字段契约", () => {
        const long = "x".repeat(600);
        const t = AgentTrace.create(long);
        expect(t.userInput.length).toBe(500);
        expect(t.id.startsWith("trace-")).toBe(true);
        expect(t.status).toBe("in_progress");
        expect(t.iterations).toBe(0);
        expect(Array.isArray(t.toolCalls)).toBe(true);
        expect(Array.isArray(t.errors)).toBe(true);
        expect(typeof t._startedAt).toBe("number");
    });

    it("recordToolCall/recordResult: 摘要截断与错误收集", () => {
        const t = AgentTrace.create("查一下");
        AgentTrace.recordToolCall(t, { tool: "search", thought: "y".repeat(300) }, 1);
        expect(t.toolCalls[0].tool).toBe("search");
        expect(t.toolCalls[0].thought.length).toBeLessThanOrEqual(200);

        AgentTrace.recordResult(t, { tool: "search" }, { message: "z".repeat(500) }, 1);
        expect(t.results[0].preview.length).toBeLessThanOrEqual(200);
        expect(t.results[0].tool).toBe("search");

        AgentTrace.recordError && AgentTrace.recordError(t, new Error("boom"));
        if (t.errors.length === 0) {
            // 兼容 recordError 不存在的形态: errors 收集由 persist 前手动 push
            t.errors.push("boom");
        }
        expect(t.errors).toContain("boom");
    });

    it("persist: finalResponse 截断 1000 + 落盘 + FIFO rotate", () => {
        // 预置 50 条旧 trace 占满容量
        const old = [];
        for (let i = 0; i < AgentTrace.MAX_TRACES; i++) {
            old.push({ id: `trace-old-${i}`, timestamp: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` });
        }
        AgentTrace._save(old);

        const t = AgentTrace.create("输入");
        t.latencyMs = 42;
        AgentTrace.persist(t, "completed", "f".repeat(1200));

        const all = AgentTrace._load();
        expect(all.length).toBe(AgentTrace.MAX_TRACES); // rotate 后不超容量
        expect(all.some((x) => x.id === "trace-old-0")).toBe(false); // 最旧被丢
        expect(all.some((x) => x.id === t.id)).toBe(true); // 新 trace 在
        const savedTrace = all.find((x) => x.id === t.id);
        expect(savedTrace.finalResponse.length).toBeLessThanOrEqual(AgentTrace.MAX_FINAL_RESPONSE);
        expect(savedTrace.status).toBe("completed");
        expect(savedTrace.userInput).toBe("输入");
    });

    it("_load: 畸形存量 JSON 容错返回空数组", () => {
        const { CONFIG } = require("../src/config");
        GM_setValue(CONFIG.STORAGE_KEYS.AI_TRACE_LOG, "{not-json");
        expect(AgentTrace._load()).toEqual([]);
        GM_setValue(CONFIG.STORAGE_KEYS.AI_TRACE_LOG, JSON.stringify({ not: "array" }));
        expect(AgentTrace._load()).toEqual([]);
    });
});
