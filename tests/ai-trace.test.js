import { describe, it, expect, beforeEach } from "vitest";
import { AgentTrace } from "../src/ai/AgentTrace.js";
import { CONFIG } from "../src/config/index.js";

// ISS-012 MAINT-002: AI trace 全量持久化契约测试（observability 维度）。
// AgentTrace 负责 per-invocation trace 的 create/recordToolCall/recordResult/
// recordError/persist/list/clear + rotate 上限。存储走 GM_getValue/GM_setValue
// （setup.js mock 内存 Map），参照 DedupStore/SyncStateV2 模式。

describe("AgentTrace — AI Agent 调用链路追踪 (ISS-012)", () => {
    beforeEach(() => {
        AgentTrace.clear();
    });

    describe("create", () => {
        it("创建 trace 含 id/timestamp/userInput 截断 + in_progress 状态", () => {
            const t = AgentTrace.create("帮我分类这些帖子");
            expect(t.id).toMatch(/^trace-/);
            expect(t.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(t.userInput).toBe("帮我分类这些帖子");
            expect(t.status).toBe("in_progress");
            expect(t.iterations).toBe(0);
            expect(t.toolCalls).toEqual([]);
            expect(t.results).toEqual([]);
            expect(t.errors).toEqual([]);
            expect(t._startedAt).toBeGreaterThan(0);
        });

        it("userInput 超 500 字符截断", () => {
            const long = "x".repeat(600);
            const t = AgentTrace.create(long);
            expect(t.userInput.length).toBe(500);
        });

        it("空/非字符串 userInput 安全处理", () => {
            const t = AgentTrace.create(null);
            expect(t.userInput).toBe("");
        });
    });

    describe("recordToolCall / recordResult", () => {
        it("记录工具调用含 tool/thought/iter", () => {
            const t = AgentTrace.create("test");
            AgentTrace.recordToolCall(t, { tool: "search", thought: "搜索帖子" }, 1);
            expect(t.toolCalls).toHaveLength(1);
            expect(t.toolCalls[0].tool).toBe("search");
            expect(t.toolCalls[0].thought).toBe("搜索帖子");
            expect(t.toolCalls[0].iter).toBe(1);
        });

        it("recordResult 截断 message 预览到 200 字符", () => {
            const t = AgentTrace.create("test");
            const longMsg = "y".repeat(300);
            AgentTrace.recordResult(t, { tool: "search" }, { message: longMsg, status: "ok" }, 1);
            expect(t.results).toHaveLength(1);
            expect(t.results[0].preview.length).toBe(200);
            expect(t.results[0].status).toBe("ok");
        });

        it("recordResult 处理字符串 result", () => {
            const t = AgentTrace.create("test");
            AgentTrace.recordResult(t, { tool: "search" }, "纯字符串结果", 1);
            expect(t.results[0].preview).toBe("纯字符串结果");
        });

        it("thought 缺失时 undefined", () => {
            const t = AgentTrace.create("test");
            AgentTrace.recordToolCall(t, { tool: "search" }, 1);
            expect(t.toolCalls[0].thought).toBeUndefined();
        });

        it("null trace 安全跳过", () => {
            expect(() => AgentTrace.recordToolCall(null, {}, 1)).not.toThrow();
            expect(() => AgentTrace.recordResult(null, {}, {}, 1)).not.toThrow();
        });
    });

    describe("recordError", () => {
        it("记录 error.message 截断 300", () => {
            const t = AgentTrace.create("test");
            const longMsg = "e".repeat(400);
            AgentTrace.recordError(t, new Error(longMsg));
            expect(t.errors).toHaveLength(1);
            expect(t.errors[0].length).toBe(300);
        });

        it("非 Error 对象转字符串", () => {
            const t = AgentTrace.create("test");
            AgentTrace.recordError(t, "字符串错误");
            expect(t.errors[0]).toBe("字符串错误");
        });
    });

    describe("persist + rotate", () => {
        it("persist 落盘后 trace 出现在 list", () => {
            const t = AgentTrace.create("test");
            AgentTrace.recordToolCall(t, { tool: "search" }, 1);
            const persisted = AgentTrace.persist(t, "completed", "完成回复");
            expect(persisted.status).toBe("completed");
            expect(persisted.finalResponse).toBe("完成回复");
            expect(persisted._startedAt).toBeUndefined();
            expect(persisted.latencyMs).toBeGreaterThanOrEqual(0);
            const list = AgentTrace.list();
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe(t.id);
        });

        it("rotate 超过 MAX_TRACES(50) 丢弃最旧 FIFO", () => {
            for (let i = 0; i < AgentTrace.MAX_TRACES + 5; i++) {
                const t = AgentTrace.create(`input-${i}`);
                AgentTrace.persist(t, "completed", `resp-${i}`);
            }
            const list = AgentTrace.list();
            expect(list).toHaveLength(AgentTrace.MAX_TRACES);
            // 最旧 5 条被丢弃，首条应是 input-5
            expect(list[0].userInput).toBe("input-5");
            // 最新在末尾
            expect(list[list.length - 1].userInput).toBe(`input-${AgentTrace.MAX_TRACES + 4}`);
        });

        it("finalResponse 截断 1000 字符", () => {
            const t = AgentTrace.create("test");
            const long = "z".repeat(1500);
            const persisted = AgentTrace.persist(t, "completed", long);
            expect(persisted.finalResponse.length).toBe(1000);
        });

        it("status 默认 completed", () => {
            const t = AgentTrace.create("test");
            const persisted = AgentTrace.persist(t);
            expect(persisted.status).toBe("completed");
        });

        it("null trace persist 返回 null", () => {
            expect(AgentTrace.persist(null)).toBeNull();
        });
    });

    describe("list / clear", () => {
        it("空存储 list 返回空数组", () => {
            expect(AgentTrace.list()).toEqual([]);
        });

        it("clear 清空所有 trace", () => {
            AgentTrace.persist(AgentTrace.create("a"), "completed", "ra");
            AgentTrace.persist(AgentTrace.create("b"), "completed", "rb");
            expect(AgentTrace.list()).toHaveLength(2);
            AgentTrace.clear();
            expect(AgentTrace.list()).toEqual([]);
        });

        it("存储键为 STORAGE_KEYS.AI_TRACE_LOG", () => {
            // 确认走配置的单一存储键（verify-bundle-equivalence 校验存储键字面量）
            expect(CONFIG.STORAGE_KEYS.AI_TRACE_LOG).toBe("ldb_ai_trace_log");
            AgentTrace.persist(AgentTrace.create("k"), "completed", "r");
            // GM_setValue 写入的 key 应与配置一致
            // （setup.js gmStore 是内存 Map，直接读）
            const stored = GM_getValue(CONFIG.STORAGE_KEYS.AI_TRACE_LOG, "[]");
            expect(JSON.parse(stored)).toHaveLength(1);
        });
    });

    describe("端到端 trace 生命周期", () => {
        it("模拟一次完整 runAgentLoop trace 流程", () => {
            const trace = AgentTrace.create("帮我创建数据库");
            // 2 次工具调用
            AgentTrace.recordToolCall(trace, { tool: "create_database", thought: "创建数据库" }, 1);
            AgentTrace.recordResult(trace, { tool: "create_database" }, { status: "ok", message: "数据库已创建" }, 1);
            trace.iterations = 1;
            AgentTrace.recordToolCall(trace, { tool: "query", thought: "查询验证" }, 2);
            AgentTrace.recordResult(trace, { tool: "query" }, { status: "ok", message: "查询成功" }, 2);
            trace.iterations = 2;

            const persisted = AgentTrace.persist(trace, "completed", "✅ 数据库已创建并验证");
            expect(persisted.status).toBe("completed");
            expect(persisted.iterations).toBe(2);
            expect(persisted.toolCalls).toHaveLength(2);
            expect(persisted.results).toHaveLength(2);
            expect(persisted.finalResponse).toBe("✅ 数据库已创建并验证");
            expect(persisted.errors).toEqual([]);

            const list = AgentTrace.list();
            expect(list).toHaveLength(1);
            expect(list[0]).toEqual(persisted);
        });

        it("模拟失败 trace（AI 调用失败）", () => {
            const trace = AgentTrace.create("测试失败");
            const err = new Error("AI 超时");
            AgentTrace.recordError(trace, err);
            const persisted = AgentTrace.persist(trace, "failed", `❌ AI 调用失败: ${err.message}`);
            expect(persisted.status).toBe("failed");
            expect(persisted.errors).toEqual(["AI 超时"]);
            expect(persisted.finalResponse).toContain("AI 调用失败");
        });

        it("模拟 max_iterations trace", () => {
            const trace = AgentTrace.create("死循环任务");
            trace.iterations = 10;
            for (let i = 1; i <= 10; i++) {
                AgentTrace.recordToolCall(trace, { tool: "search" }, i);
                AgentTrace.recordResult(trace, { tool: "search" }, { status: "ok" }, i);
            }
            const maxMsg = "🤖 Agent 达到最大执行步数，已停止。";
            const persisted = AgentTrace.persist(trace, "max_iterations", maxMsg);
            expect(persisted.status).toBe("max_iterations");
            expect(persisted.iterations).toBe(10);
            expect(persisted.toolCalls).toHaveLength(10);
        });
    });
});
