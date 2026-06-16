"use strict";

const { CONFIG } = require("../config");

/**
 * DedupStore — 基于 GM_getValue/GM_setValue 的去重存储
 * 每个源维护独立的去重集合
 * 支持 batch 模式减少 IPC 调用次数
 */
const DedupStore = {
    _keyFor(sourceType) {
        return `${CONFIG.STORAGE_KEYS.EXPORTED_TOPICS}:${sourceType}`;
    },

    _loadSet(sourceType) {
        const raw = globalThis.GM_getValue(this._keyFor(sourceType), "{}");
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    },

    _saveSet(sourceType, set) {
        globalThis.GM_setValue(this._keyFor(sourceType), JSON.stringify(set));
    },

    // --- batch 模式: 减少 IPC 调用 ---
    _batchCache: null,       // sourceType → { set, dirty }
    _batchSourceType: null,

    /**
     * 开始批量模式 (SyncCoordinator 在 sync 循环前后调用)
     * @param {string} sourceType
     */
    beginBatch(sourceType) {
        this._batchSourceType = sourceType;
        this._batchCache = { set: this._loadSet(sourceType), dirty: false };
    },

    /**
     * 结束批量模式，如有变更则一次写回
     */
    endBatch() {
        if (this._batchCache && this._batchCache.dirty && this._batchSourceType) {
            this._saveSet(this._batchSourceType, this._batchCache.set);
        }
        this._batchCache = null;
        this._batchSourceType = null;
    },

    /**
     * 检查条目是否已存在
     * @param {string} sourceType - 源类型
     * @param {string} dedupKey - 去重键
     * @returns {boolean}
     */
    isDuplicate(sourceType, dedupKey) {
        // batch 模式下从缓存读取
        if (this._batchCache && this._batchSourceType === sourceType) {
            return Object.prototype.hasOwnProperty.call(this._batchCache.set, dedupKey);
        }
        const set = this._loadSet(sourceType);
        return Object.prototype.hasOwnProperty.call(set, dedupKey);
    },

    /**
     * 标记条目为已见
     * @param {string} sourceType
     * @param {string} dedupKey
     */
    markSeen(sourceType, dedupKey) {
        // batch 模式下在内存缓存中标记
        if (this._batchCache && this._batchSourceType === sourceType) {
            this._batchCache.set[dedupKey] = Date.now();
            this._batchCache.dirty = true;
            return;
        }
        const set = this._loadSet(sourceType);
        set[dedupKey] = Date.now();
        this._saveSet(sourceType, set);
    },

    /**
     * 获取源的完整去重集合
     * @param {string} sourceType
     * @returns {Object}
     */
    getSeen(sourceType) {
        if (this._batchCache && this._batchSourceType === sourceType) {
            return this._batchCache.set;
        }
        return this._loadSet(sourceType);
    },

    /**
     * 清空源的已见集合
     * @param {string} sourceType
     */
    clearSeen(sourceType) {
        if (this._batchCache && this._batchSourceType === sourceType) {
            this._batchCache.set = {};
            this._batchCache.dirty = true;
        }
        globalThis.GM_deleteValue(this._keyFor(sourceType));
    },
};

module.exports = { DedupStore };
