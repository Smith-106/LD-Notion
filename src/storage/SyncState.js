"use strict";

const { CONFIG } = require("../config");

// 直接使用 GM_* API 打破与 storage/index.js 的循环依赖
const _getRaw = (key, defaultVal) => globalThis.GM_getValue(key, defaultVal);
const _setRaw = (key, val) => globalThis.GM_setValue(key, val);

/**
 * SyncState V2 — 统一的每源同步状态管理
 * 兼容 V1 旧数据结构的迁移
 */
const SyncStateV2 = {
    VERSION: 2,
    _cache: null,
    _saveTimer: null,
    _dirty: false,
    OUTCOMES: Object.freeze(["idle", "running", "success", "partial", "error"]),

    /**
     * 生成单个源的默认状态记录
     * @param {boolean} withSnapshot - 是否包含 snapshot 字段
     */
    _makeSourceDefault(withSnapshot = false) {
        const record = {
            watermark: null,
            lastSuccessAt: 0,
            lastAttemptAt: 0,
            lastOutcome: "idle",
            lastError: "",
            lastStats: {},
        };
        if (withSnapshot) record.snapshot = {};
        return record;
    },

    /**
     * V2 默认结构: 所有源扁平存放在 sources 下
     */
    _defaults() {
        return {
            version: SyncStateV2.VERSION,
            sources: {
                linuxdo: this._makeSourceDefault(),
                "github-stars": this._makeSourceDefault(),
                "github-repos": this._makeSourceDefault(),
                "github-forks": this._makeSourceDefault(),
                "github-gists": this._makeSourceDefault(),
                "github-meta": this._makeSourceDefault(),
                bookmark: this._makeSourceDefault(true),
                rss: this._makeSourceDefault(true),
                zhihu: this._makeSourceDefault(),
                generic: this._makeSourceDefault(),
            },
        };
    },

    _clone(value) {
        if (typeof structuredClone === "function") return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    },

    normalizeTime(value) {
        if (!value) return "";
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toISOString();
    },

    normalizeWatermark(watermark) {
        if (!watermark || typeof watermark !== "object") return null;
        const time = this.normalizeTime(watermark.time);
        if (!time) return null;
        const ids = Array.isArray(watermark.ids)
            ? Array.from(new Set(watermark.ids.map((id) => String(id || "")).filter(Boolean)))
            : [];
        return { time, ids };
    },

    normalizeSyncRecord(record, { keepSnapshot = false } = {}) {
        const source = record && typeof record === "object" ? record : {};
        const normalized = {
            watermark: this.normalizeWatermark(source.watermark),
            lastSuccessAt: Number.isFinite(Number(source.lastSuccessAt)) ? Number(source.lastSuccessAt) : 0,
            lastAttemptAt: Number.isFinite(Number(source.lastAttemptAt)) ? Number(source.lastAttemptAt) : 0,
            lastOutcome: this.OUTCOMES.includes(source.lastOutcome) ? source.lastOutcome : "idle",
            lastError: String(source.lastError || ""),
            lastStats: source.lastStats && typeof source.lastStats === "object"
                ? this._clone(source.lastStats)
                : {},
        };
        if (keepSnapshot) {
            normalized.snapshot = source.snapshot && typeof source.snapshot === "object"
                ? source.snapshot
                : {};
        }
        return normalized;
    },

    /**
     * 从 V1 迁移到 V2 扁平结构
     * V1: { linuxdo: {...}, github: { meta, stars, repos, forks, gists }, bookmarks, rss }
     * V2: { version: 2, sources: { linuxdo, github-stars, github-repos, ... } }
     */
    _migrateV1toV2(v1State) {
        const defaults = this._defaults();
        const sources = { ...defaults.sources };

        // linuxdo
        if (v1State.linuxdo) {
            sources.linuxdo = this.normalizeSyncRecord(v1State.linuxdo);
        }

        // github: meta → 废弃, 子类型扁平化
        if (v1State.github) {
            for (const type of ["stars", "repos", "forks", "gists"]) {
                if (v1State.github[type]) {
                    sources[`github-${type}`] = this.normalizeSyncRecord(v1State.github[type]);
                }
            }
        }

        // bookmarks
        if (v1State.bookmarks) {
            sources.bookmark = this.normalizeSyncRecord(v1State.bookmarks, { keepSnapshot: true });
        }

        // rss
        if (v1State.rss) {
            sources.rss = this.normalizeSyncRecord(v1State.rss, { keepSnapshot: true });
        }

        return { version: this.VERSION, sources };
    },

    _load() {
        if (this._cache) return this._cache;

        const defaults = this._defaults();
        let parsed = {};
        try {
            parsed = JSON.parse(_getRaw(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE, "{}")) || {};
        } catch {
            parsed = {};
        }

        // 检测并迁移 V1 结构
        if (parsed.version < this.VERSION || (!parsed.version && parsed.linuxdo)) {
            parsed = this._migrateV1toV2(parsed);
        }

        // 迁移旧 V2 数据中的 "bookmarks" 键为 "bookmark"
        if (parsed.sources && parsed.sources.bookmarks && !parsed.sources.bookmark) {
            parsed.sources.bookmark = parsed.sources.bookmarks;
            delete parsed.sources.bookmarks;
        }

        // 确保 sources 存在且每个 key 都有默认值
        if (!parsed.sources) parsed.sources = {};
        for (const key of Object.keys(defaults.sources)) {
            if (!parsed.sources[key]) {
                parsed.sources[key] = this._makeSourceDefault(key === "bookmark" || key === "rss");
            } else {
                parsed.sources[key] = this.normalizeSyncRecord(parsed.sources[key], {
                    keepSnapshot: key === "bookmark" || key === "rss",
                });
            }
        }

        parsed.version = this.VERSION;
        this._cache = parsed;
        return parsed;
    },

    _save(state) {
        this._cache = state;
        this._dirty = true;
        // 使用 queueMicrotask 合并同一事件循环中的多次写入
        // 在测试环境 (无 setTimeout) 中也能正常工作
        if (this._saveTimer) return;
        const flush = () => { this._saveTimer = null; this._flushSave(); };
        if (typeof globalThis.queueMicrotask === "function") {
            this._saveTimer = 1; // sentinel, non-null
            globalThis.queueMicrotask(flush);
        } else if (typeof globalThis.setTimeout === "function") {
            this._saveTimer = globalThis.setTimeout(flush, 0);
        } else {
            // 同步环境直接写入
            this._flushSave();
        }
    },

    _flushSave() {
        this._saveTimer = null;
        if (!this._dirty) return;
        this._dirty = false;
        _setRaw(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE, JSON.stringify(this._cache));
    },

    /**
     * 强制立即写入 (用于 sync 结束后等关键节点)
     */
    forceFlush() {
        if (this._saveTimer) {
            globalThis.clearTimeout?.(this._saveTimer);
            this._saveTimer = null;
        }
        this._flushSave();
    },

    /**
     * 获取指定源的同步状态
     * @param {string} sourceType
     * @returns {Object}
     */
    getSourceState(sourceType) {
        const state = this._load();
        return this._clone(state.sources[sourceType] || this._makeSourceDefault(
            sourceType === "bookmark" || sourceType === "rss"
        ));
    },

    /**
     * 更新指定源的同步状态
     * @param {string} sourceType
     * @param {Object} patch - 要合并的字段
     * @returns {Object} 更新后的状态
     */
    updateSourceState(sourceType, patch = {}) {
        const state = this._load();
        const withSnapshot = sourceType === "bookmark" || sourceType === "rss";
        state.sources[sourceType] = this.normalizeSyncRecord({
            ...(state.sources[sourceType] || this._makeSourceDefault(withSnapshot)),
            ...patch,
            watermark: patch.watermark === undefined
                ? (state.sources[sourceType]?.watermark || null)
                : patch.watermark,
        }, { keepSnapshot: withSnapshot });
        if (withSnapshot && patch.snapshot !== undefined) {
            state.sources[sourceType].snapshot = patch.snapshot;
        }
        this._save(state);
        return this._clone(state.sources[sourceType]);
    },

    // --- 通用 watermark/filter 方法 (与 V1 兼容) ---

    buildWatermark(items = [], getTime, getId) {
        if (!Array.isArray(items) || items.length === 0) return null;
        let latestTime = "";
        let latestMs = -Infinity;
        const ids = [];
        const idSet = new Set();

        items.forEach((item) => {
            const time = this.normalizeTime(getTime(item));
            if (!time) return;
            const timeMs = Date.parse(time);
            if (!Number.isFinite(timeMs)) return;
            const id = String(getId(item) || "");
            if (timeMs > latestMs) {
                latestMs = timeMs;
                latestTime = time;
                ids.length = 0;
                idSet.clear();
                if (id) { ids.push(id); idSet.add(id); }
                return;
            }
            if (timeMs === latestMs && id && !idSet.has(id)) {
                ids.push(id);
                idSet.add(id);
            }
        });

        return latestTime ? { time: latestTime, ids } : null;
    },

    filterOrderedItems(items = [], watermark, getTime, getId) {
        const result = [];
        const normalized = this.normalizeWatermark(watermark);
        if (!normalized?.time) return Array.isArray(items) ? items.slice() : [];

        const watermarkMs = Date.parse(normalized.time);
        for (const item of (items || [])) {
            const itemTime = this.normalizeTime(getTime(item));
            if (!itemTime) { result.push(item); continue; }
            const itemMs = Date.parse(itemTime);
            if (!Number.isFinite(itemMs)) { result.push(item); continue; }
            if (itemMs > watermarkMs) { result.push(item); continue; }
            if (itemMs < watermarkMs) break;
            const itemId = String(getId(item) || "");
            if (!normalized.ids.includes(itemId)) result.push(item);
        }
        return result;
    },

    filterItems(items = [], watermark, getTime, getId) {
        return (items || []).filter((item) => this.isItemAfterWatermark(getTime(item), getId(item), watermark));
    },

    isItemAfterWatermark(timeValue, idValue, watermark) {
        const normalized = this.normalizeWatermark(watermark);
        if (!normalized?.time) return true;
        const itemTime = this.normalizeTime(timeValue);
        if (!itemTime) return true;
        const itemMs = Date.parse(itemTime);
        const watermarkMs = Date.parse(normalized.time);
        if (itemMs > watermarkMs) return true;
        if (itemMs < watermarkMs) return false;
        return !normalized.ids.includes(String(idValue || ""));
    },

    takeLeadingItems(items = [], predicate) {
        const result = [];
        for (const item of (items || [])) {
            if (!predicate(item)) break;
            result.push(item);
        }
        return result;
    },
};

module.exports = { SyncStateV2 };
