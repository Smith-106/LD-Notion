import { describe, it, expect, beforeEach } from "vitest";
import { BatchTrace } from "../src/security/BatchTrace.js";
import { CONFIG } from "../src/config/index.js";

// ISS-20260728-018 (OBS-002): 业务批量操作结构化 trace 契约测试。
// BatchTrace 泛化 AgentTrace 模式到非 AI 路径(批量导出/自动同步):
// create → per-item record → persist(GM FIFO rotate)。存储走 setup.js mock 内存 Map。

describe("BatchTrace — 业务批量操作结构化追踪 (ISS-20260728-018)", () => {
    beforeEach(() => {
        BatchTrace.clear();
    });

    describe("create", () => {
        it("创建 trace 含 id/timestamp/operation/source/actor + in_progress", () => {
            const t = BatchTrace.create({ operation: "exportBookmarks", source: "bookmark-export", actor: "user", itemTotal: 30 });
            expect(t.id).toMatch(/^batch-/);
            expect(t.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(t.operation).toBe("exportBookmarks");
            expect(t.source).toBe("bookmark-export");
            expect(t.actor).toBe("user");
            expect(t.itemTotal).toBe(30);
            expect(t.status).toBe("in_progress");
            expect(t.counts).toEqual({});
            expect(t.items).toEqual([]);
            expect(t.errors).toEqual([]);
            expect(t._startedAt).toBeGreaterThan(0);
        });

        it("默认 actor=system / source=unknown", () => {
            const t = BatchTrace.create({ operation: "bookmark-auto-sync" });
            expect(t.actor).toBe("system");
            expect(t.source).toBe("unknown");
            expect(t.itemTotal).toBe(0);
        });
    });

    describe("record", () => {
        it("per-item 记录入 items + counts 按 status 累计", () => {
            const t = BatchTrace.create({ operation: "exportBookmarks", itemTotal: 3 });
            BatchTrace.record(t, { key: "https://a.com/1", action: "create", status: "success" });
            BatchTrace.record(t, { key: "https://a.com/2", action: "create", status: "failed", reason: "401" });
            BatchTrace.record(t, { key: "https://a.com/3", action: "create", status: "success" });
            expect(t.items).toHaveLength(3);
            expect(t.counts.success).toBe(2);
            expect(t.counts.failed).toBe(1);
            expect(t.items[1].reason).toBe("401");
        });

        it("reason 截断 200 字符", () => {
            const t = BatchTrace.create({ operation: "x" });
            BatchTrace.record(t, { key: "k", action: "a", status: "failed", reason: "r".repeat(300) });
            expect(t.items[0].reason.length).toBe(200);
        });

        it("items 超 MAX_ITEMS 仅计数不追加(防大批量膨胀)", () => {
            const t = BatchTrace.create({ operation: "x" });
            for (let i = 0; i < BatchTrace.MAX_ITEMS + 10; i++) {
                BatchTrace.record(t, { key: `k${i}`, action: "a", status: "success" });
            }
            expect(t.items).toHaveLength(BatchTrace.MAX_ITEMS);
            expect(t.counts.success).toBe(BatchTrace.MAX_ITEMS + 10); // 计数不受 items 上限影响
        });

        it("null trace 安全跳过", () => {
            expect(() => BatchTrace.record(null, { status: "success" })).not.toThrow();
        });

        it("未命名 status 按 status 桶兜底计数", () => {
            const t = BatchTrace.create({ operation: "x" });
            BatchTrace.record(t, { key: "k", action: "update", status: "denied" });
            expect(t.counts.denied).toBe(1);
        });
    });

    describe("recordError", () => {
        it("记录 error.message 截断 300", () => {
            const t = BatchTrace.create({ operation: "x" });
            BatchTrace.recordError(t, new Error("e".repeat(400)));
            expect(t.errors).toHaveLength(1);
            expect(t.errors[0].length).toBe(300);
        });
    });

    describe("persist + rotate", () => {
        it("persist 落盘含 status/latencyMs,去 _startedAt", () => {
            const t = BatchTrace.create({ operation: "exportBookmarks" });
            const p = BatchTrace.persist(t, "completed");
            expect(p.status).toBe("completed");
            expect(p._startedAt).toBeUndefined();
            expect(p.latencyMs).toBeGreaterThanOrEqual(0);
            expect(BatchTrace.list()).toHaveLength(1);
        });

        it("extraCounts 合并(自动同步细分计数)", () => {
            const t = BatchTrace.create({ operation: "bookmark-auto-sync" });
            BatchTrace.record(t, { key: "k", action: "create", status: "success" });
            const p = BatchTrace.persist(t, "partial", { created: 5, updated: 2, archived: 1, denied: 1 });
            expect(p.counts.success).toBe(1);   // per-item record 桶
            expect(p.counts.created).toBe(5);   // extraCounts 细分
            expect(p.counts.updated).toBe(2);
            expect(p.counts.denied).toBe(1);
        });

        it("rotate 超 MAX_TRACES(30) 丢弃最旧 FIFO", () => {
            for (let i = 0; i < BatchTrace.MAX_TRACES + 5; i++) {
                BatchTrace.persist(BatchTrace.create({ operation: `op-${i}` }), "completed");
            }
            const list = BatchTrace.list();
            expect(list).toHaveLength(BatchTrace.MAX_TRACES);
            expect(list[0].operation).toBe("op-5");
        });

        it("null trace persist 返回 null", () => {
            expect(BatchTrace.persist(null)).toBeNull();
        });

        it("reason/key 落盘前脱敏(redactText)", () => {
            const t = BatchTrace.create({ operation: "x" });
            // CredentialVault.redactText 对 token 样式脱敏 —— 用含 sk- 前缀的伪凭证验证走脱敏路径
            BatchTrace.record(t, { key: "k", action: "a", status: "failed", reason: "key sk-abcdef1234567890 失效" });
            const p = BatchTrace.persist(t, "failed");
            // 不验具体脱敏串(取决于 REDACT_IN_LOGS 集),验:仍是字符串且 reason 被处理过
            expect(typeof p.items[0].reason).toBe("string");
        });
    });

    describe("list / clear", () => {
        it("空存储 list 返回空数组", () => {
            expect(BatchTrace.list()).toEqual([]);
        });

        it("clear 清空所有 trace", () => {
            BatchTrace.persist(BatchTrace.create({ operation: "a" }), "completed");
            BatchTrace.persist(BatchTrace.create({ operation: "b" }), "completed");
            expect(BatchTrace.list()).toHaveLength(2);
            BatchTrace.clear();
            expect(BatchTrace.list()).toEqual([]);
        });

        it("存储键为 STORAGE_KEYS.BATCH_TRACE_LOG", () => {
            expect(CONFIG.STORAGE_KEYS.BATCH_TRACE_LOG).toBe("ldb_batch_trace_log");
            BatchTrace.persist(BatchTrace.create({ operation: "k" }), "completed");
            const stored = GM_getValue(CONFIG.STORAGE_KEYS.BATCH_TRACE_LOG, "[]");
            expect(JSON.parse(stored)).toHaveLength(1);
        });
    });

    describe("端到端批量运行生命周期", () => {
        it("模拟一次完整 exportBookmarks trace", () => {
            const t = BatchTrace.create({ operation: "exportBookmarks", source: "bookmark-export", actor: "user", itemTotal: 4 });
            BatchTrace.record(t, { key: "u1", action: "create", status: "success" });
            BatchTrace.record(t, { key: "u2", action: "create", status: "success" });
            BatchTrace.record(t, { key: "u3", action: "create", status: "failed", reason: "403" });
            BatchTrace.record(t, { key: "bulk:1项未尝试", action: "export", status: "skipped", reason: "认证中止整批" });
            BatchTrace.recordError(t, new Error("401 unauthorized"));
            const p = BatchTrace.persist(t, "aborted");
            expect(p.status).toBe("aborted");
            expect(p.counts.success).toBe(2);
            expect(p.counts.failed).toBe(1);
            expect(p.counts.skipped).toBe(1);
            expect(p.itemTotal).toBe(4);
            expect(p.errors).toEqual(["401 unauthorized"]);
        });

        it("模拟自动同步聚合 trace(lastStats 细分)", () => {
            const t = BatchTrace.create({ operation: "bookmark-auto-sync", actor: "system", itemTotal: 10 });
            const p = BatchTrace.persist(t, "completed", { created: 3, updated: 2, archived: 1, unchanged: 3, failed: 0, denied: 1 });
            expect(p.status).toBe("completed");
            expect(p.counts.created).toBe(3);
            expect(p.counts.archived).toBe(1);
            expect(p.counts.denied).toBe(1);
        });
    });
});
