"use strict";

const { CONFIG } = require("../config");
const { sha256HexSync } = require("../utils/sha256");
const { emit } = require("../coordination/event-bus");

// 去重条目存活时间：90 天。超过此时间的条目在批量/单点写回时自动淘汰，
// 防止 GM storage 中单键 JSON 无界增长导致 sync 延迟线性增加（PERF-001）。
// v3.14.3 修复：时间 TTL 只用于 URL 键源（bookmark/rss/zhihu/generic，无界）；
// id 键源（linuxdo/github-*，导出账本，天然有界）改容量上限淘汰，
// 避免 90 天后已导出记录被静默遗忘、UI 误判“待导出”。
const DEDUP_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// id 键源容量上限：超过后淘汰最旧条目（导出账本防误删的时间 TTL 替代）
const DEDUP_CAPACITY_LIMIT = 10000;

// URL 键源：跨设备同步时 payload 哈希化(h:sha256)。本地账本同时保留原文键与
// 哈希键双条目(双写), 保证同步 pull 应用后的哈希键可被原文键查询命中
// (全盘审计交叉回归修复: 双设备去重失效 + 淘汰不落盘)。
// 与 src/sync/SyncSerializer.js WHITELIST.dedupSources 的 urlKeyed 元数据一致。
const URL_KEYED_SOURCES = Object.freeze(["bookmark", "rss", "zhihu", "generic"]);
const HASH_PREFIX = "h:";

/**
 * DedupStore — 基于 GM_getValue/GM_setValue 的去重存储
 * 每个源维护独立的去重集合
 * 支持 batch 模式减少 IPC 调用次数
 * 支持 TTL 淘汰防止无界增长
 */
const DedupStore = {
    DEDUP_TTL_MS,
    DEDUP_CAPACITY_LIMIT,
    URL_KEYED_SOURCES,
    keyFor(sourceType) {
        return `${CONFIG.STORAGE_KEYS.EXPORTED_TOPICS}:${sourceType}`;
    },

    /**
     * 哈希化判定: urlKeyed 源且键非 h: 前缀 → 返回哈希变体键; 其余原样返回。
     * (h: 前缀键来自同步 pull 应用, 防二次哈希)
     */
    _hashKeyFor(sourceType, dedupKey) {
        if (!URL_KEYED_SOURCES.includes(sourceType)) return dedupKey;
        if (String(dedupKey).startsWith(HASH_PREFIX)) return dedupKey;
        return HASH_PREFIX + sha256HexSync(dedupKey);
    },

    _loadSet(sourceType) {
        const raw = GM_getValue(this.keyFor(sourceType), "{}");
        try {
            const parsed = JSON.parse(raw);
            // 损坏存储兜底: 非纯对象(数组/null/原始值)时严格模式赋值会抛 TypeError
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    },

    _saveSet(sourceType, set) {
        // 单点写回同样淘汰过期条目(batch 路径由 endBatch 兜底, 双处幂等)。
        // v3.14.3: URL 键源按时间 TTL 淘汰; id 键源(导出账本)按容量上限淘汰,
        // 防止 90 天时间窗误删导出事实导致 UI 误判“待导出”。
        if (URL_KEYED_SOURCES.includes(sourceType)) {
            this._evictExpired(set);
        } else {
            this._evictByCapacity(set);
        }
        GM_setValue(this.keyFor(sourceType), JSON.stringify(set));
    },

    // --- batch 模式: 减少 IPC 调用(全盘审计 find 7: 单槽 → 按 sourceType 分槽,
    // 多导入器并发时 A 的缓存被 B 覆盖丢失, 现每源独立缓存) ---
    _batchCaches: {},    // sourceType → { set, dirty }

    /**
     * 开始批量模式 (SyncCoordinator 在 sync 循环前后调用)
     * @param {string} sourceType
     */
    beginBatch(sourceType) {
        // v3.14.6 (CC-06): 幂等 —— 槽已存在则复用(同源并发 batch 后开者不再覆盖先开者内存累积)
        if (this._batchCaches[sourceType]) return;
        this._batchCaches[sourceType] = { set: this._loadSet(sourceType), dirty: false };
    },

    /**
     * 结束批量模式，如有变更则一次写回。
     * 写回前自动淘汰超过 TTL 的过期条目（PERF-001）。
     * v3.14.6 (CC-06): 写回前 rebase —— 重读 fresh set 并集, 同键 max ts,
     * 防跨 batch 并发时后写者以陈旧内存快照覆盖先写者已落盘条目。
     * @param {string} [sourceType] 指定源; 省略时 flush 全部缓存
     */
    endBatch(sourceType) {
        const targets = sourceType ? [sourceType] : Object.keys(this._batchCaches);
        for (const src of targets) {
            const cache = this._batchCaches[src];
            if (cache && cache.dirty) {
                const fresh = this._loadSet(src);
                for (const [k, ts] of Object.entries(cache.set)) {
                    const prev = fresh[k];
                    if (prev === undefined || Number(ts) > Number(prev)) fresh[k] = ts;
                }
                // v3.14.3: 与 _saveSet 同规则——URL 键源时间 TTL, id 键源容量上限
                if (URL_KEYED_SOURCES.includes(src)) {
                    this._evictExpired(fresh);
                } else {
                    this._evictByCapacity(fresh);
                }
                this._saveSet(src, fresh);
                cache.set = fresh;
                // F-SYNC-11: 去重账本变更事件(零订阅者静默),多端同步引擎据此触发 push。
                emit("storage:state-committed", { sourceType: src, kind: "dedup" });
            }
        }
        if (sourceType) {
            delete this._batchCaches[sourceType];
        } else {
            this._batchCaches = {};
        }
    },

    _batchGet(sourceType) {
        return this._batchCaches[sourceType] || null;
    },

    /**
     * 淘汰超过 TTL 的过期条目（就地修改）
     * @param {Object} set - dedup 集合 {key: timestamp}
     * @returns {number} 淘汰的条目数
     */
    _evictExpired(set) {
        const cutoff = Date.now() - DEDUP_TTL_MS;
        let evicted = 0;
        for (const key of Object.keys(set)) {
            if (set[key] < cutoff) {
                delete set[key];
                evicted++;
            }
        }
        return evicted;
    },

    /**
     * 容量上限淘汰（v3.14.3，id 键源导出账本专用）：
     * 仅当集合超过 DEDUP_CAPACITY_LIMIT 时淘汰最旧条目，
     * 防止导出账本无界增长，同时不因 90 天时间窗误删导出事实。
     * @param {Object} set - dedup 集合 {key: timestamp}
     * @returns {number} 淘汰的条目数
     */
    _evictByCapacity(set) {
        const keys = Object.keys(set);
        const excess = keys.length - DEDUP_CAPACITY_LIMIT;
        if (excess <= 0) return 0;
        keys.sort((a, b) => Number(set[a] || 0) - Number(set[b] || 0));
        let evicted = 0;
        for (let i = 0; i < excess && i < keys.length; i++) {
            delete set[keys[i]];
            evicted++;
        }
        return evicted;
    },

    /**
     * 检查条目是否已存在
     * @param {string} sourceType - 源类型
     * @param {string} dedupKey - 去重键
     * @returns {boolean}
     */
    isDuplicate(sourceType, dedupKey) {
        // batch 模式下从缓存读取
        const batch = this._batchGet(sourceType);
        if (batch) {
            const set = batch.set;
            if (Object.prototype.hasOwnProperty.call(set, dedupKey)) return true;
            // urlKeyed 源: 同步 pull 应用的哈希键也命中(跨设备去重)
            const hashed = this._hashKeyFor(sourceType, dedupKey);
            return hashed !== dedupKey && Object.prototype.hasOwnProperty.call(set, hashed);
        }
        const set = this._loadSet(sourceType);
        if (Object.prototype.hasOwnProperty.call(set, dedupKey)) return true;
        const hashed = this._hashKeyFor(sourceType, dedupKey);
        return hashed !== dedupKey && Object.prototype.hasOwnProperty.call(set, hashed);
    },

    /**
     * 标记条目为已见(urlKeyed 源双写哈希键, 与同步 payload 键空间一致)
     * v3.14.6 (DC-008): 可选 ts 参数(远端 TTL 起点失真修复), 显式取 max
     * @param {string} sourceType
     * @param {string} dedupKey
     * @param {number} [ts] - 条目时间戳, 默认 Date.now()
     */
    markSeen(sourceType, dedupKey, ts) {
        const now = ts === undefined ? Date.now() : Number(ts);
        const stamp = Number.isFinite(now) && now > 0 ? now : Date.now();
        const hashed = this._hashKeyFor(sourceType, dedupKey);
        // batch 模式下在内存缓存中标记
        const batch = this._batchGet(sourceType);
        if (batch) {
            if (!batch.set[dedupKey] || batch.set[dedupKey] < stamp) batch.set[dedupKey] = stamp;
            if (hashed !== dedupKey && (!batch.set[hashed] || batch.set[hashed] < stamp)) batch.set[hashed] = stamp;
            batch.dirty = true;
            return;
        }
        const set = this._loadSet(sourceType);
        if (!set[dedupKey] || set[dedupKey] < stamp) set[dedupKey] = stamp;
        if (hashed !== dedupKey && (!set[hashed] || set[hashed] < stamp)) set[hashed] = stamp;
        this._saveSet(sourceType, set);
    },

    /**
     * 清除单个去重键(batch/非 batch 双路径,与 markSeen 对称; urlKeyed 源双删哈希键)
     * @param {string} sourceType
     * @param {string} dedupKey
     */
    unmarkSeen(sourceType, dedupKey) {
        const hashed = this._hashKeyFor(sourceType, dedupKey);
        const batch = this._batchGet(sourceType);
        if (batch) {
            if (Object.prototype.hasOwnProperty.call(batch.set, dedupKey)) {
                delete batch.set[dedupKey];
                batch.dirty = true;
            }
            if (hashed !== dedupKey && Object.prototype.hasOwnProperty.call(batch.set, hashed)) {
                delete batch.set[hashed];
                batch.dirty = true;
            }
            return;
        }
        const set = this._loadSet(sourceType);
        let changed = false;
        if (Object.prototype.hasOwnProperty.call(set, dedupKey)) {
            delete set[dedupKey];
            changed = true;
        }
        if (hashed !== dedupKey && Object.prototype.hasOwnProperty.call(set, hashed)) {
            delete set[hashed];
            changed = true;
        }
        if (changed) this._saveSet(sourceType, set);
    },

    /**
     * 获取源的完整去重集合
     * @param {string} sourceType
     * @returns {Object}
     */
    getSeen(sourceType) {
        const batch = this._batchGet(sourceType);
        if (batch) {
            return batch.set;
        }
        return this._loadSet(sourceType);
    },

    /**
     * 清空源的已见集合
     * @param {string} sourceType
     */
    clearSeen(sourceType) {
        const batch = this._batchGet(sourceType);
        if (batch) {
            batch.set = {};
            batch.dirty = true;
            return;
        }
        GM_deleteValue(this.keyFor(sourceType));
    },
};

module.exports = { DedupStore };
