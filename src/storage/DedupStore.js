"use strict";

const { CONFIG } = require("../config");
const { sha256HexSync } = require("../utils/sha256");
const { emit } = require("../coordination/event-bus");

// 去重条目存活时间：90 天。超过此时间的条目在批量/单点写回时自动淘汰，
// 防止 GM storage 中单键 JSON 无界增长导致 sync 延迟线性增加（PERF-001）。
const DEDUP_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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
    URL_KEYED_SOURCES,
    _keyFor(sourceType) {
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
        const raw = GM_getValue(this._keyFor(sourceType), "{}");
        try {
            const parsed = JSON.parse(raw);
            // 损坏存储兜底: 非纯对象(数组/null/原始值)时严格模式赋值会抛 TypeError
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    },

    _saveSet(sourceType, set) {
        // 单点写回同样淘汰过期条目(batch 路径由 endBatch 兜底, 双处幂等)
        this._evictExpired(set);
        GM_setValue(this._keyFor(sourceType), JSON.stringify(set));
    },

    // --- batch 模式: 减少 IPC 调用(全盘审计 find 7: 单槽 → 按 sourceType 分槽,
    // 多导入器并发时 A 的缓存被 B 覆盖丢失, 现每源独立缓存) ---
    _batchCaches: {},    // sourceType → { set, dirty }

    /**
     * 开始批量模式 (SyncCoordinator 在 sync 循环前后调用)
     * @param {string} sourceType
     */
    beginBatch(sourceType) {
        this._batchCaches[sourceType] = { set: this._loadSet(sourceType), dirty: false };
    },

    /**
     * 结束批量模式，如有变更则一次写回。
     * 写回前自动淘汰超过 TTL 的过期条目（PERF-001）。
     * @param {string} [sourceType] 指定源; 省略时 flush 全部缓存
     */
    endBatch(sourceType) {
        const targets = sourceType ? [sourceType] : Object.keys(this._batchCaches);
        for (const src of targets) {
            const cache = this._batchCaches[src];
            if (cache && cache.dirty) {
                this._evictExpired(cache.set);
                this._saveSet(src, cache.set);
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
     * @param {string} sourceType
     * @param {string} dedupKey
     */
    markSeen(sourceType, dedupKey) {
        const hashed = this._hashKeyFor(sourceType, dedupKey);
        // batch 模式下在内存缓存中标记
        const batch = this._batchGet(sourceType);
        if (batch) {
            batch.set[dedupKey] = Date.now();
            if (hashed !== dedupKey) batch.set[hashed] = Date.now();
            batch.dirty = true;
            return;
        }
        const set = this._loadSet(sourceType);
        set[dedupKey] = Date.now();
        if (hashed !== dedupKey) set[hashed] = Date.now();
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
        GM_deleteValue(this._keyFor(sourceType));
    },
};

module.exports = { DedupStore };
