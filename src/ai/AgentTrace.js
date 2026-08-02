"use strict";

const { CONFIG } = require("../config");

/**
 * AgentTrace — AI Agent 调用链路追踪持久化（ISS-012, MAINT-002）。
 *
 * 每个 runAgentLoop 调用产生一条 trace 记录，包含 timestamp/userInput/toolCalls[]/
 * results[]/latency/errors，用于 observability 维度的问题诊断与回归分析。
 *
 * 存储：GM_getValue/GM_setValue + JSON 数组，固定容量 rotate（默认 50 条，超限 FIFO 丢弃最旧）。
 * 设计参照 DedupStore（GM 封装）+ SyncStateV2（rotate）模式，纯客户端架构无服务端。
 *
 * trace 结构：
 * {
 *   id: "trace-<timestamp>-<rand4>",
 *   timestamp: ISO 8601,
 *   userInput: string,                    // 用户原始输入（截断 500 字符，防 prompt injection 污染存储）
 *   iterations: number,                   // 实际迭代次数
 *   toolCalls: [{ tool, thought?, iter }], // 每次工具调用
 *   results: [{ tool, status, preview?, iter }], // 每次工具结果摘要（不存原始大对象，截断 200 字符）
 *   finalResponse: string,               // 最终 AI 回复（截断 1000 字符）
 *   latencyMs: number,                   // 总耗时
 *   errors: string[],                     // 错误收集（AI 调用失败/工具异常）
 *   status: "completed" | "failed" | "max_iterations"
 * }
 */
const AgentTrace = {
    MAX_TRACES: 50,
    MAX_USER_INPUT: 500,
    MAX_RESULT_PREVIEW: 200,
    MAX_FINAL_RESPONSE: 1000,

    _key() {
        return CONFIG.STORAGE_KEYS.AI_TRACE_LOG;
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
     * 创建一条新 trace（runAgentLoop 入口调用）。
     * @param {string} userInput
     * @returns {object} trace 对象（尚未持久化，调 persist 落盘）
     */
    create(userInput) {
        const ts = new Date().toISOString();
        const trimmedInput = String(userInput || "").slice(0, this.MAX_USER_INPUT);
        return {
            id: `trace-${ts}-${Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, '0')).join('')}`,
            timestamp: ts,
            userInput: trimmedInput,
            iterations: 0,
            toolCalls: [],
            results: [],
            finalResponse: "",
            latencyMs: 0,
            errors: [],
            status: "in_progress",
            _startedAt: Date.now(),
        };
    },

    /**
     * 记录一次工具调用（_executeAgentToolCall 前后调用）。
     */
    recordToolCall(trace, toolCall, iter) {
        if (!trace) return;
        trace.toolCalls.push({
            tool: toolCall?.tool || "unknown",
            thought: toolCall?.thought ? String(toolCall.thought).slice(0, 200) : undefined,
            iter,
        });
    },

    /**
     * 记录一次工具结果（截断预览，不存原始大对象防存储膨胀）。
     */
    recordResult(trace, toolCall, result, iter) {
        if (!trace) return;
        const status = (result && result.status) || "ok";
        let preview = "";
        if (result && result.message != null) {
            preview = String(result.message).slice(0, this.MAX_RESULT_PREVIEW);
        } else if (typeof result === "string") {
            preview = result.slice(0, this.MAX_RESULT_PREVIEW);
        }
        trace.results.push({ tool: toolCall?.tool || "unknown", status, preview, iter });
    },

    /**
     * 记录错误（AI 调用失败/工具异常）。
     */
    recordError(trace, error) {
        if (!trace) return;
        const msg = error?.message ? String(error.message).slice(0, 300) : String(error).slice(0, 300);
        trace.errors.push(msg);
    },

    /**
     * 持久化 trace（runAgentLoop 出口调用），rotate 超限丢弃最旧。
     * @param {object} trace — create() 返回的 trace，已填充 toolCalls/results/finalResponse/status
     * @param {string} status — "completed" | "failed" | "max_iterations"
     * @param {string} finalResponse — 最终 AI 回复
     * @returns {object} 持久化后的 trace（去 _startedAt，补 latencyMs）
     */
    persist(trace, status, finalResponse) {
        if (!trace) return null;
        trace.status = status || "completed";
        trace.finalResponse = String(finalResponse || "").slice(0, this.MAX_FINAL_RESPONSE);
        trace.latencyMs = trace._startedAt ? Date.now() - trace._startedAt : 0;
        delete trace._startedAt;

        const traces = this._load();
        traces.push(trace);
        // rotate: 超过 MAX_TRACES 丢弃最旧（FIFO）
        while (traces.length > this.MAX_TRACES) {
            traces.shift();
        }
        this._save(traces);
        return trace;
    },

    /**
     * 读取全部 trace（诊断/测试用）。
     */
    list() {
        return this._load();
    },

    /**
     * 清空所有 trace（测试/重置用）。
     */
    clear() {
        this._save([]);
    },
};

module.exports = { AgentTrace };
