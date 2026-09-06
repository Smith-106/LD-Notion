"use strict";

// Run#4 (execute P2) 契约测试 —— 覆盖 P2 批次改动:
// DC-010 sha256 孤立代理项对齐 TextEncoder、DC-011 keyFor 公开化、DC-008 markSeen ts 参数、
// S-05/XN-06 guard.denied 语义(denied/cancelled/auditDenied 构造器)、DC-006 RSS snapshot 剪枝
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const { sha256HexSync } = require("../src/utils/sha256");
const { DedupStore } = require("../src/storage/DedupStore");
const { OperationGuard, OperationLog } = require("../src/security");
const { RSSAutoImporter } = require("../src/bridge/RSSAutoImporter");
const { SyncState } = require("../src/storage");
const { UrlValidator } = require("../src/security/UrlValidator");
const { AISchema } = require("../src/ai/schema");

const DEDUP_RSS = "ldb_exported_topics:rss";

// node crypto 参照实现(Buffer.from(str,'utf8') 与 TextEncoder 同为 U+FFFD 替换语义)
const nodeSha256 = (str) => createHash("sha256").update(Buffer.from(str, "utf8")).digest("hex");

describe("P2-DC-010: sha256 孤立代理项对齐 TextEncoder(U+FFFD)", () => {
    const vectors = [
        "孤立高位代理 \\uD800",
        "孤立低位代理 \\uDC00",
        "高位后接非低位 \\uD800x",
        "低位孤项 \\uDC00x",
        "双孤立 \\uD800\\uDC00", // 相邻未配对: 各自替换, 非合成
        "有效代理对 \\uD83D\\uDE00",
        "末尾高位 \\uDBFF",
        "混合: a\\uD800b\\uDC00c\\uD83D\\uDE00d",
    ];
    for (const label of vectors) {
        const [name, raw] = label.split(" ");
        const str = raw
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        it(`与 node crypto 一致: ${name}`, () => {
            expect(sha256HexSync(str)).toBe(nodeSha256(str));
        });
    }

    it("普通 ASCII/中文与 node crypto 一致(回归)", () => {
        expect(sha256HexSync("hello world")).toBe(nodeSha256("hello world"));
        expect(sha256HexSync("LD-Notion 知识中枢")).toBe(nodeSha256("LD-Notion 知识中枢"));
    });
});

describe("P2-DC-011: DedupStore.keyFor 公开化", () => {
    beforeEach(() => {
        globalThis.GM_deleteValue(DEDUP_RSS);
    });

    it("keyFor 暴露导出账本键构造(内部实现公开, 可断言)", () => {
        expect(DedupStore.keyFor("rss")).toBe("ldb_exported_topics:rss");
        expect(DedupStore.keyFor("bookmark")).toBe("ldb_exported_topics:bookmark");
    });

    it("markSeen/isDuplicate 走 keyFor 键空间(roundtrip)", () => {
        DedupStore.markSeen("rss", "item:1");
        expect(DedupStore.isDuplicate("rss", "item:1")).toBe(true);
    });
});

describe("P2-DC-008: DedupStore.markSeen 可选 ts 参数(远端 TTL 起点)", () => {
    beforeEach(() => {
        globalThis.GM_deleteValue(DEDUP_RSS);
    });

    it("显式 ts 写入远端时间戳, 后续 max 合并不回落", () => {
        const t1 = Date.now() - 3600_000; // 1 小时前(远端 TTL 起点)
        const t0 = Date.now() - 7200_000; // 更旧
        const t2 = Date.now() - 600_000; // 更新
        DedupStore.markSeen("rss", "item:ts", t1);
        DedupStore.markSeen("rss", "item:ts", t0); // 更旧 ts 不覆盖
        DedupStore.markSeen("rss", "item:ts", t2); // 更新 ts 覆盖
        const raw = JSON.parse(globalThis.GM_getValue(DEDUP_RSS, "{}"));
        expect(raw["item:ts"]).toBe(t2);
    });

    it("无 ts 时使用 Date.now(兼容旧调用)", () => {
        const before = Date.now();
        DedupStore.markSeen("rss", "item:now");
        const raw = JSON.parse(globalThis.GM_getValue(DEDUP_RSS, "{}"));
        expect(raw["item:now"]).toBeGreaterThanOrEqual(before);
    });

    it("非法 ts 回落 Date.now 不抛错", () => {
        DedupStore.markSeen("rss", "item:bad", "not-a-number");
        const raw = JSON.parse(globalThis.GM_getValue(DEDUP_RSS, "{}"));
        expect(Number.isFinite(raw["item:bad"])).toBe(true);
    });
});

describe("P2/EN-XN-02: 通配 DNS 后缀 + 非规范 IP 字面量静态拒绝", () => {
    it("通配 DNS 后缀(可解析内网)一律拒绝", () => {
        expect(UrlValidator.validatePageExternalUrl("http://127.0.0.1.nip.io/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("https://foo.sslip.io/")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://10.0.0.1.xip.io/")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://foo.loca.lt/")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://foo.ssrf.sh/")).toBe(false);
        expect(UrlValidator.validateAiBaseUrl("https://my-proxy.nip.io")).toBe(false);
    });

    it("WHATWG 归一化后内网段仍被拒(2130706433/0x 十六进制/八进制/短形态/前导零)", () => {
        expect(UrlValidator.validatePageExternalUrl("http://2130706433/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://0x7f000001/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://0177.0.0.1/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://127.1/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://127.0.000.001/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://0x7f.0.0.1/x")).toBe(false);
    });

    it("纵深防御: 非规范字面量原始形态直接判定 + 正常域名放行", () => {
        expect(UrlValidator._isSuspiciousHostname("2130706433")).toBe(true);
        expect(UrlValidator._isSuspiciousHostname("0x7f000001")).toBe(true);
        expect(UrlValidator._isSuspiciousHostname("0177.0.0.1")).toBe(true);
        expect(UrlValidator._isSuspiciousHostname("127.0.0.0x1")).toBe(true);
        expect(UrlValidator._isSuspiciousHostname("example.com")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("https://example.com/a.png")).toBe(true);
        expect(UrlValidator.validatePageExternalUrl("https://cdn.example.com/x")).toBe(true);
        expect(UrlValidator.validateAiBaseUrl("https://api.openai.com/v1")).toBe(true);
        expect(UrlValidator.validateAiBaseUrl("https://my-proxy.example.com")).toBe(true);
    });

    // Run#8 review 闭环 (NEW-03): 前导零段判定仅当末段为纯数字 IP 形态,
    // a.b.01.com 类合法域名不得误拒; 0177.0.0.1 等八进制 IP 形态仍拒
    it("review NEW-03: 合法 4 段域名前导零段不误拒, 八进制 IP 形态仍拒", () => {
        expect(UrlValidator._isSuspiciousHostname("a.b.01.com")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("https://a.b.01.com/x")).toBe(true);
        expect(UrlValidator.validatePageExternalUrl("https://sub.01.example.com/x")).toBe(true);
        expect(UrlValidator._isSuspiciousHostname("0177.0.0.1")).toBe(true);
        expect(UrlValidator._isSuspiciousHostname("10.0.0.0177")).toBe(true);
    });

    it("AISchema 委托同一原语(单一安全原语成立)", () => {
        expect(AISchema.validatePageExternalUrl("http://foo.xip.io/")).toBe(false);
        expect(AISchema.validatePageExternalUrl("https://example.com/icon.png")).toBe(true);
    });
});

describe("P2-S-05/XN-06: guard.denied 语义 + auditDenied 统一构造器", () => {
    beforeEach(() => {
        globalThis.GM_setValue("ldb_permission_level", 0); // 只读
        globalThis.GM_setValue("ldb_enable_audit_log", true);
        globalThis.GM_setValue("ldb_require_confirm", false);
        globalThis.GM_setValue("ldb_operation_log", JSON.stringify([]));
    });

    it("execute 权限拒绝: status=denied + guard.denied + phase=execute(顶 status 不再 failed)", async () => {
        await expect(
            OperationGuard.execute("appendBlocks", async () => ({ ok: true }), {
                pageId: "page_p2_1",
                itemName: "受限页面",
                trigger: "test",
            })
        ).rejects.toThrow(/权限不足/);
        const logs = OperationLog.getAll();
        const denied = logs.find((e) => e.audit_event === "guard.denied");
        expect(denied).toBeTruthy();
        expect(denied.status).toBe("denied");
        expect(denied.result.status).toBe("denied");
        expect(denied.context.phase).toBe("execute");
        expect(denied.actor).toBe("user");
    });

    it("确认取消: 独立 guard.cancelled 事件 + status=cancelled", async () => {
        globalThis.GM_setValue("ldb_permission_level", 1);
        const { ConfirmationDialog } = require("../src/security");
        const orig = ConfirmationDialog.show;
        ConfirmationDialog.show = () => false; // 用户取消
        try {
            await expect(
                OperationGuard.execute("appendBlocks", async () => ({ ok: true }), {
                    pageId: "page_p2_2",
                    itemName: "取消项",
                    requireConfirm: true, // S-04: 常规写也可经 context 强制确认
                })
            ).rejects.toThrow(/操作已取消/);
        } finally {
            ConfirmationDialog.show = orig;
        }
        const logs = OperationLog.getAll();
        const cancelled = logs.find((e) => e.audit_event === "guard.cancelled");
        expect(cancelled).toBeTruthy();
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.result.status).toBe("cancelled");
        expect(cancelled.context.phase).toBe("cancelled");
        expect(logs.some((e) => e.audit_event === "guard.denied")).toBe(false);
    });

    it("auditDenied precheck 直接构造(非阻塞闸门路径)", () => {
        OperationGuard.auditDenied("updateDatabase", {
            databaseId: "db_p2",
            trigger: "test_precheck",
            actor: "user",
            source: "ui",
        }, { phase: "precheck", reason: "权限不足测试" });
        const logs = OperationLog.getAll();
        const denied = logs.find((e) => e.audit_event === "guard.denied");
        expect(denied.status).toBe("denied");
        expect(denied.context.phase).toBe("precheck");
        expect(denied.result.reason).toBe("权限不足测试");
    });
});

describe("P2-DC-006: RSS nextSnapshot 收尾剪枝(只增不删 → 无界增长)", () => {
    beforeEach(() => {
        globalThis.GM_deleteValue("ldb_auto_sync_state");
    });

    it("feed 移除后旧条目键从 snapshot 剪除, 当前项保留", () => {
        const currentItems = [
            { id: "a1", itemKey: "k1", title: "现存条目" },
            { id: "a2", itemKey: "k2", title: "现存条目2" },
        ];
        const nextSnapshot = {
            k1: { pageId: "p1", title: "现存条目" },   // 当前项 → 保留
            k2: { pageId: "p2", title: "现存条目2" },  // 当前项 → 保留
            stale_removed: { pageId: "p3", title: "已移除feed旧条目" }, // → 剪除
        };
        RSSAutoImporter._aggregateRssState(
            { currentItems, feedCount: 2, nextSnapshot },
            { created: 1, updated: 0, unchanged: 1, failed: 0 },
            new Set(["k1", "k2"]),
            1234567
        );
        const state = SyncState.getSourceState("rss");
        expect(Object.keys(state.snapshot).sort()).toEqual(["k1", "k2"]);
    });

    it("失败项也在 currentItems 中, 剪枝不丢失败重试上下文", () => {
        const currentItems = [
            { id: "a1", itemKey: "k1", title: "失败项" },
        ];
        const nextSnapshot = {
            k1: { pageId: null, title: "失败项" },
            old: { pageId: "p9" },
        };
        RSSAutoImporter._aggregateRssState(
            { currentItems, feedCount: 1, nextSnapshot },
            { created: 0, updated: 0, unchanged: 0, failed: 1 },
            new Set(),
            1234567
        );
        const state = SyncState.getSourceState("rss");
        expect(Object.keys(state.snapshot)).toEqual(["k1"]);
    });
});
