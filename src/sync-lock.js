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
    // 无 GM 环境的按 key 租约槽(浏览器/GM 环境不参与)
    _localLeases: new Map(),

    get isExporting() {
        return this._exporting;
    },

    set isExporting(val) {
        this._exporting = Boolean(val);
    },

    /**
     * 尝试获取跨 tab 租约(owner + expiresAt, TTL 兜底)
     * @param {string} key - 租约存储键(建议 per-source, 如 CONFIG.STORAGE_KEYS.XXX + ":lease")
     * @param {number} ttlMs - 租约有效期(默认 180s: 续约 30s 一次, 隐藏标签页定时器
     *   节流后最多 ~60s 一次, 3× 余量确保节流下不会中途过期被抢占)
     * @returns {Promise<{owner: string, expiresAt: number}|null>} 成功返回租约, 失败/被占返回 null
     */
    acquireLease: async (key, ttlMs = 180000) => {
        if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function") {
            // 无 GM 环境: 降级为进程内互斥。2/3 共识(dsf+qwen): 原实现忽略 key 共用
            // 全局 isExporting 位 → 不同源的租约互相假冲突且释放会误清他人标志。
            // 改为按 key 分槽(保留 isExporting 副作用向后兼容)。
            const held = SyncLock._localLeases.get(key);
            if (held && Number(held.expiresAt) > Date.now()) return null;
            const lease = { owner: Utils.randomToken(), expiresAt: Date.now() + ttlMs };
            SyncLock._localLeases.set(key, lease);
            SyncLock.isExporting = true;
            return lease;
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
        // 三模型共识(P1): 单轮复读只能挡住窗口内竞争 —— 跨 tab 写入传播延迟可超过 150ms,
        // 后写者在其后覆盖仍会双方均“复读到自己” → 双持有。二次确认把窗口翻倍(双持有
        // 需传播延迟 > 300ms), 与 renewLease 的 owner 复核共同构成防线。
        await Utils.sleep(150);
        const confirm = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
        if (!confirm.owner || confirm.owner !== lease.owner) {
            return null; // 竞争失败(二次确认发现被后写者覆盖)
        }
        // glm P1 共识: 后台 tab 定时器节流可把 sleep 拉长到 ≥ TTL, 此时租约已过期,
        // 仅比对 owner 会把「已过期租约」当成获取成功 → 他 tab 可立即抢占 → 双持有。
        // 过期则刷新有效期后重写并再次校验(校验失败说明已被抢占)。
        if (lease.expiresAt <= Date.now()) {
            lease.expiresAt = Date.now() + ttlMs;
            GM_setValue(key, JSON.stringify(lease));
            // 2/3 共识(dsf+glm): 此分支原为立即复读(必然读到自己刚写的值, 判别恒真)。
            // 与主路径对称补 150ms 稳态等待, 让并发写入得以传播/暴露。
            await Utils.sleep(150);
            const refreshed = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
            if (!refreshed.owner || refreshed.owner !== lease.owner) {
                return null;
            }
        }
        return lease;
    },

    /**
     * 续约(持有期间定期调用, 防 TTL 中途过期)
     * S1: 续约前复核 owner —— 后台节流可致续约延迟超 TTL, 期间租约可被其他 tab 抢占;
     * 盲写续约会覆写新持有者的租约 → 双持有并发同步。owner 失配时返回 false 供调用方中止,
     * 绝不触碰他方租约。
     */
    renewLease: (key, lease, ttlMs = 180000) => {
        // 降级模式(无 GM)下槽位与 lease 为同一对象引用, 原地更新 expiresAt 即可见;
        // acquireLease 读的就是该对象的 expiresAt(实测语义等价, 无需重写槽位)
        if (!lease || typeof GM_setValue !== "function") return lease;
        if (typeof GM_getValue === "function") {
            const current = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
            if (!current.owner || current.owner !== lease.owner) {
                return false; // 租约已被其他 tab 抢占, 不覆写
            }
        }
        lease.expiresAt = Date.now() + ttlMs;
        GM_setValue(key, JSON.stringify(lease));
        // 2/3 共识(dsf+glm): 写后复读校验与 acquireLease 对称 —— 读-写间隙他 tab
        // 可能已写入新租约; 本写覆盖它则复读看到自己(抢占方复读也会看到本写而退出),
        // 若复读看到他方 owner 则说明本写被后写覆盖, 返回 false 中止本轮。
        if (typeof GM_getValue === "function") {
            const after = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
            if (!after.owner || after.owner !== lease.owner) {
                return false;
            }
        }
        return lease;
    },

    /**
     * 释放租约(仅 owner 本人删除; finally 中调用)
     */
    releaseLease: (key, lease) => {
        // 2/3 共识(dsf+glm): 未持租约者(lease 为 null)不得解除互斥标志 ——
        // 原实现在此分支无条件清 isExporting, 会误清他人持有的锁。
        if (!lease) return;
        if (typeof GM_getValue !== "function" || typeof GM_setValue !== "function") {
            const held = SyncLock._localLeases.get(key);
            if (held && held.owner === lease.owner) SyncLock._localLeases.delete(key);
            // P4 收敛(c10): 仅当本进程再无任何 slot 持租时才能清全局标志 ——
            // 多 key 场景释放其中一个会把仍在持有的互斥一起清掉
            SyncLock.isExporting = SyncLock._localLeases.size > 0;
            return;
        }
        const current = Utils.safeJsonParse(GM_getValue(key, "{}"), {}) || {};
        if (current.owner && current.owner === lease.owner) {
            GM_setValue(key, "{}");
        }
    },
};

module.exports = { SyncLock };
