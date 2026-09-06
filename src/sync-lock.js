"use strict";

/**
 * SyncLock — 导入/导出互斥标志 + 跨 tab 租约锁
 * 解耦 export ↔ bridge 的循环依赖
 *
 * v3.14.6 (CC-04): acquireLease/releaseLease 提供基于 GM storage 的跨 tab 租约,
 * 防多 tab 同时 run 自动同步导致双建页。原语: 写后复读校验(利用 GM 单线程语义),
 * TTL 兜底防 tab 崩溃锁泄漏。无 GM 环境(测试)降级为进程内布尔。
 */
const { CONFIG } = require("./config");
const { Utils } = require("./utils");

const SyncLock = {
    _exporting: false,

    get isExporting() {
        return this._exporting;
    },

    set isExporting(val) {
        this._exporting = Boolean(val);
    },

    /**
     * 尝试获取跨 tab 租约(owner + expiresAt, TTL 兜底)
     * @param {string} key - 租约存储键(建议 per-source, 如 CONFIG.STORAGE_KEYS.XXX + ":lease")
     * @param {number} ttlMs - 租约有效期(默认 60s)
     * @returns {Promise<{owner: string, expiresAt: number}|null>} 成功返回租约, 失败/被占返回 null
     */
    acquireLease: async (key, ttlMs = 60000) => {
        if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function") {
            // 无 GM 环境: 降级进程内互斥
            if (SyncLock.isExporting) return null;
            SyncLock.isExporting = true;
            return { owner: "local", expiresAt: Date.now() + ttlMs };
        }
        const now = Date.now();
        const existing = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
        if (existing.owner && Number(existing.expiresAt) > now) {
            return null; // 他 tab 持有且未过期
        }
        const lease = { owner: Utils.randomToken(), expiresAt: now + ttlMs };
        GM_setValue(key, JSON.stringify(lease));
        // 写后复读校验: GM 单线程语义下读回若仍为自己, 则获取成功
        await Utils.sleep(150);
        const reread = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
        if (!reread.owner || reread.owner !== lease.owner) {
            return null; // 竞争失败(他 tab 同时写入覆盖)
        }
        return lease;
    },

    /**
     * 续约(持有期间定期调用, 防 TTL 中途过期)
     */
    renewLease: (key, lease, ttlMs = 60000) => {
        if (!lease || typeof GM_setValue !== "function") return lease;
        lease.expiresAt = Date.now() + ttlMs;
        GM_setValue(key, JSON.stringify(lease));
        return lease;
    },

    /**
     * 释放租约(仅 owner 本人删除; finally 中调用)
     */
    releaseLease: (key, lease) => {
        if (!lease || typeof GM_getValue !== "function" || typeof GM_setValue !== "function") {
            SyncLock.isExporting = false;
            return;
        }
        const current = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
        if (current.owner && current.owner === lease.owner) {
            GM_setValue(key, "{}");
        }
    },
};

module.exports = { SyncLock };
