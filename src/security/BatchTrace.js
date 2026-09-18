"use strict";

const { CONFIG } = require("../config");
const { CredentialVault } = require("../auth");

/**
 * BatchTrace — 业务批量操作结构化追踪持久化（ISS-20260728-018, OBS-002）。
 *
 * 泛化 AgentTrace 模式到非 AI 业务路径: 批量导出(exportBookmarks)与自动同步
 * (BookmarkAutoImporter.run) 每次批量运行产生一条结构化 trace 记录——聚合计数 +
 * per-item 结果摘要 + 耗时 + 状态,替代此前 console 散落 + 单条 OperationLog。
 *
 * 与 OperationLog 分工: OperationLog 记逐项审计事实(谁/何时/何操作/何结果,细粒度),
 * BatchTrace 记一次批量运行的整体结构与 outcome(粗粒度,批级观测)。两者互补不重复。
 *
 * 存储: GM_getValue/GM_setValue + JSON 数组,固定容量 rotate(默认 30 条,超限 FIFO 丢弃最旧)。
 * 参照 AgentTrace(ISS-012) + DedupStore/SyncStateV2 模式,纯客户端架构无服务端。
 *
 * trace 结构:
 * {
 *   id: "batch-<timestamp>-<rand4>",
 *   timestamp: ISO 8601,
 *   operation: string,                    // 批量操作名(如 "exportBookmarks"|"bookmark-auto-sync")
 *   source: string,                       // 触发来源(如 "bookmark-export"|"bookmark-auto-sync")
 *   actor: string,                        // "user"|"system"
 *   counts: {created,updated,archived,unchanged,exported,failed,skipped,denied}, // 聚合计数(按需填)
 *   items: [{ key, action, status, reason? }],   // per-item 结果摘要(reason 截断 200,脱敏)
 *   itemTotal: number,                    // 目标项总数(供比对截断/部分执行)
 *   latencyMs: number,                    // 总耗时
 *   errors: string[],                     // 批级错误收集(截断 300)
 *   status: "completed" | "failed" | "aborted" | "partial"
 * }
 */
const BatchTrace = {
    MAX_TRACES: 30,
    MAX_ITEMS: 200,          // items 摘要上限,防大批量存储膨胀(超出仅计数不逐条)
    MAX_REASON: 200,
    MAX_ERROR: 300,

    _key() {
        return CONFIG.STORAGE_KEYS.BATCH_TRACE_LOG;
    },

    _load() {
        const raw = GM_getValue(this._key(), "[]");
        try {
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    },

    _save(traces) {
        GM_setValue(this._key(), JSON.stringify(traces));
    },

    /**
     * 创建一条新批量 trace（批量运行入口调用）。
     * @param {object} opts — { operation, source, actor, itemTotal }
     * @returns {object} trace 对象(尚未持久化,调 persist 落盘)
     */
    create({ operation, source = "unknown", actor = "system", itemTotal = 0 } = {}) {
        const ts = new Date().toISOString();
        return {
            id: `batch-${ts}-${Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, '0')).join('')}`,
            timestamp: ts,
            operation: String(operation || "unknown"),
            source,
            actor,
            counts: {},
            items: [],
            itemTotal,
            latencyMs: 0,
            errors: [],
            status: "in_progress",
            _startedAt: Date.now(),
        };
    },

    /**
     * 记录一个批内项的结果(摘要,不存大对象)。
     * @param {object} trace
     * @param {object} item — { key(书签ID/URL/页ID), action(create/update/archive/export), status(success/failed/denied/skipped/unchanged), reason? }
     */
    record(trace, item = {}) {
        if (!trace) return;
        // 计数桶: 无对应 count 名时按 action:status 兜底,保证任意 action/status 组合可观测
        const bucket = item.status || "unknown";
        trace.counts[bucket] = (trace.counts[bucket] || 0) + 1;
        if (trace.items.length >= this.MAX_ITEMS) return; // 超出仅计数
        const entry = {
            key: String(item.key ?? "").slice(0, 200),
            action: String(item.action ?? ""),
            status: bucket,
        };
        if (item.reason != null) entry.reason = String(item.reason).slice(0, this.MAX_REASON);
        trace.items.push(entry);
    },

    /**
     * 记录批级错误(整批中止/异常,非单项)。
     */
    recordError(trace, error) {
        if (!trace) return;
        const msg = error?.message ? String(error.message).slice(0, this.MAX_ERROR) : String(error).slice(0, this.MAX_ERROR);
        trace.errors.push(msg);
    },

    /**
     * 持久化 trace（批量运行出口调用），rotate 超限丢弃最旧。
     * @param {object} trace — create() 返回的 trace
     * @param {string} status — "completed" | "failed" | "aborted" | "partial"
     * @param {object} [extraCounts] — 可选合并额外计数(如调用方自维的 created/updated 细分)
     * @returns {object} 持久化后的 trace(去 _startedAt,补 latencyMs)
     */
    persist(trace, status, extraCounts = null) {
        if (!trace) return null;
        if (extraCounts && typeof extraCounts === "object") {
            for (const [k, v] of Object.entries(extraCounts)) {
                trace.counts[k] = (trace.counts[k] || 0) + (Number(v) || 0);
            }
        }
        // 落盘前脱敏(与 AgentTrace.persist 同口径): 批量 trace 可携带 URL/标题/reason 中的凭证片段
        if (Array.isArray(trace.items)) {
            for (const it of trace.items) {
                if (it && typeof it.reason === "string") it.reason = CredentialVault.redactText(it.reason);
                if (it && typeof it.key === "string") it.key = CredentialVault.redactText(it.key);
            }
        }
        if (Array.isArray(trace.errors)) {
            trace.errors = trace.errors.map((e) => CredentialVault.redactText(e));
        }
        trace.status = status || "completed";
        trace.latencyMs = trace._startedAt ? Date.now() - trace._startedAt : 0;
        delete trace._startedAt;

        const traces = this._load();
        traces.push(trace);
        while (traces.length > this.MAX_TRACES) {
            traces.shift();
        }
        this._save(traces);
        return trace;
    },

    /** 读取全部批量 trace（诊断/测试用）。 */
    list() {
        return this._load();
    },

    /** 清空所有批量 trace（测试/重置用）。 */
    clear() {
        this._save([]);
    },
};

module.exports = { BatchTrace };
