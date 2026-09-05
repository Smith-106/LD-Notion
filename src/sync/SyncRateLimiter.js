"use strict";

// SyncRateLimiter — 共享令牌桶(capacity=3, refill 1/s) + 同 key 防抖合并 + 5xx 退避
// F-SYNC-04: 全局限流由 NotionAPI._requestGate 注入, 同步路径自限 ≤2/s。
// 401/403/400 短路(fatal 不重试), 5xx 指数退避 1000*2^n cap 30s。

const { SyncConstants } = require("./constants");

const SyncRateLimiter = {
    _tokens: SyncConstants.RATE_CAPACITY,
    _lastRefill: Date.now(),
    _waiters: [],
    _inflight: 0,
    _selfLimitTokens: SyncConstants.SYNC_SELF_LIMIT_PER_SEC,
    _selfLastRefill: Date.now(),

    /** 令牌桶 refresh */
    _refill() {
        const now = Date.now();
        const elapsed = (now - this._lastRefill) / 1000;
        if (elapsed > 0) {
            this._tokens = Math.min(SyncConstants.RATE_CAPACITY, this._tokens + elapsed * SyncConstants.RATE_REFILL_PER_SEC);
            this._lastRefill = now;
        }
    },

    /**
     * 令牌桶 acquire(全局共享预算, gateAcquire 同实现)
     * @returns {Promise<void>}
     */
    acquire() {
        this._refill();
        if (this._tokens >= 1) {
            this._tokens -= 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this._waiters.push(resolve);
            this._drain();
        });
    },

    _drain() {
        if (this._waiters.length === 0) return;
        // 使用 setTimeout 保证排队者按到达顺序拿桶(不忙等)
        this._refill();
        while (this._waiters.length > 0 && this._tokens >= 1) {
            this._tokens -= 1;
            const resolve = this._waiters.shift();
            resolve();
        }
        // 仍有 waiter 未满足: 重新排班。修复 waiter 饥饿(此前一次性 timer 不再 re-arm,
        // 同 tick 多 waiter 排队且桶只回 1 个 token 时, 第二个 waiter 永不 resolve →
        // 对应 Notion 请求永久挂起; 全盘审计修复)。
        if (this._waiters.length > 0) {
            const delay = Math.max(100, Math.ceil((1 - this._tokens) * 1000));
            setTimeout(() => this._drain(), delay);
        }
    },

    /**
     * 同步路径自限(≤2/s, 独立小桶)
     */
    selfAcquire() {
        const now = Date.now();
        const elapsed = (now - this._selfLastRefill) / 1000;
        if (elapsed >= 1) {
            this._selfLimitTokens = SyncConstants.SYNC_SELF_LIMIT_PER_SEC;
            this._selfLastRefill = now;
        }
        if (this._selfLimitTokens >= 1) {
            this._selfLimitTokens -= 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            setTimeout(() => this.selfAcquire().then(resolve), Math.max(100, 1000 - elapsed * 1000));
        });
    },

    /**
     * NotionAPI.setRequestGate 注入形态
     */
    async gateAcquire() {
        await this.acquire();
    },

    /**
     * 同 key 防抖合并: 窗口内对同一 key 的多次调用合并为 1 次(最后一次胜出)
     * @param {string} key
     * @param {Function} fn - 执行体
     * @param {Object} opts { windowMs=5000, maxWaitMs=30000 }
     * @returns {Promise<*>}
     */
    schedule(key, fn, { windowMs = SyncConstants.DEBOUNCE_MS, maxWaitMs = 30000 } = {}) {
        const now = Date.now();
        if (this._pending && this._pending.key === key && now - this._pending.startedAt < windowMs) {
            // 已排队: 替换执行体(最后一次胜出), 延长等待窗口
            this._pending.fn = fn;
            return this._pending.promise;
        }
        if (this._pending && this._pending.key === key) {
            // 超窗: 立即执行
            this._pending = null;
            return fn();
        }
        const p = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this._pending === entry) {
                    this._pending = null;
                    Promise.resolve(entry.fn()).then(resolve, reject);
                }
            }, windowMs);
            const entry = { key, fn, startedAt: now, promise: p, timer };
            this._pending = entry;
        });
        return p;
    },

    /**
     * 错误分类: 401/403/400 → fatal(不重试); 其他 → retry
     */
    classifyError(err) {
        const status = Number(err?.status || err?.statusCode || err?.code);
        if (status === 401 || status === 403 || status === 400) {
            return { action: "fatal", status };
        }
        if (status >= 500 || status === 429) {
            return { action: "retry", status };
        }
        return { action: "retry", status };
    },

    /** 退避: min(30s, 1000*2^attempt) */
    backoffMs(attempt) {
        return Math.min(SyncConstants.BACKOFF_CAP_MS, SyncConstants.BACKOFF_BASE_MS * Math.pow(2, attempt));
    },

    /** 测试辅助 */
    _reset() {
        this._tokens = SyncConstants.RATE_CAPACITY;
        this._lastRefill = Date.now();
        this._waiters = [];
        this._selfLimitTokens = SyncConstants.SYNC_SELF_LIMIT_PER_SEC;
        this._selfLastRefill = Date.now();
    },
};

module.exports = { SyncRateLimiter };
