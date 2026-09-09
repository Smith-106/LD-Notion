"use strict";

const { CONFIG } = require("../config");
const { emit } = require("../coordination/event-bus");

// 直接使用 GM_* API 打破与 storage/index.js 的循环依赖
const _getRaw = (key, defaultVal) => GM_getValue(key, defaultVal);
const _setRaw = (key, val) => GM_setValue(key, val);

// 2/3 共识(dsf+qwen): watermark.ids 记录同一最新时间戳的全部 id, 大量同刻条目时
// 持久化体积无界增长(AUTO_SYNC_STATE 单键)。超上限截断仅使多余条目下轮被重新拉取,
// 去重账本仍拦截重复导出(安全方向)。
const MAX_WATERMARK_IDS = 500;

/**
 * SyncState V2 — 统一的每源同步状态管理
 * 兼容 V1 旧数据结构的迁移
 */
const SyncStateV2 = {
    VERSION: 2,
    _cache: null,
    _saveTimerId: null,
    _savePending: false,
    _dirty: false,
    OUTCOMES: Object.freeze(["idle", "running", "success", "partial", "error"]),

    /**
     * 生成单个源的默认状态记录
     * @param {boolean} withSnapshot - 是否包含 snapshot 字段
     */
    _makeSourceDefault(withSnapshot = false) {
        const record = {
            watermark: null,
            // F-SYNC-02/F-04 反冲保护: epoch 每重置一次 +1,远端仅接受 ≤ 本地+1,
            // 防旧设备 watermark 覆盖新基线(H-5 epoch 通胀 DoS)。
            epoch: 0,
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
            // LOW-1 共识: epoch 必须进字段白名单,否则 normalizeSyncRecord 每次
            // _load/updateSourceState 后丢弃 → F-04 反冲保护静默失效。
            epoch: Number.isFinite(Number(source.epoch)) && Number(source.epoch) >= 0
                ? Math.floor(Number(source.epoch))
                : 0,
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
        // 2/3 共识(dsf+qwen): 旧条件要求 parsed.linuxdo 存在 —— 仅同步过 bookmark/rss/
        // github 的 V1 状态(无 version、无 linuxdo)被跳过迁移, watermark/snapshot 被默认值
        // 覆盖 → 增量基线丢失、全量重扫与重复投递。改为识别完整 V1 形态。
        const hasV1Shape = !parsed.version
            && (parsed.linuxdo || parsed.github || parsed.bookmarks || parsed.rss);
        if (parsed.version < this.VERSION || hasV1Shape) {
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
        if (this._saveTimerId || this._savePending) return;
        const flush = () => { this._saveTimerId = null; this._savePending = false; this._flushSave(); };
        if (typeof globalThis.queueMicrotask === "function") {
            // v3.14.6 (CC-15): 微任务无真实句柄, 用 _savePending 布尔标记而非数字哨兵
            this._savePending = true;
            globalThis.queueMicrotask(flush);
        } else if (typeof globalThis.setTimeout === "function") {
            this._saveTimerId = globalThis.setTimeout(flush, 0);
        } else {
            // 同步环境直接写入
            this._flushSave();
        }
    },

    _flushSave() {
        this._saveTimerId = null;
        this._savePending = false;
        if (!this._dirty) return;
        this._dirty = false;
        // 3/3 共识(dsf+glm+qwen): 远端变更已将 _cache 置 null 时不得写出 JSON.stringify(null)
        // ("null" 会清空全部源 watermark/epoch)。
        if (!this._cache) return;
        try {
            _setRaw(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE, JSON.stringify(this._cache));
        } catch (error) {
            // glm P2 共识: 写失败不得静默丢弃待写状态 —— 恢复 _dirty 供下次保存重试
            this._dirty = true;
            console.warn("[LD-Notion] 同步状态写入失败, 已保留待写状态:", error);
            return;
        }
        // F-SYNC-11: storage→event-bus 零依赖边(无订阅者时 emit 静默),多端同步引擎
        // 订阅该事件感知本地状态变更(F1 的 DedupStore emit 在 DedupStore.endBatch 侧)。
        emit("storage:state-committed", { kind: "watermark" });
    },

    /**
     * 强制立即写入 (用于 sync 结束后等关键节点)
     */
    forceFlush() {
        // v3.14.6 (CC-15): 仅对真实定时器句柄 clearTimeout, 数字哨兵不再伪装句柄
        if (this._saveTimerId !== null) {
            globalThis.clearTimeout?.(this._saveTimerId);
            this._saveTimerId = null;
        }
        this._savePending = false;
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
        // dsf P2 共识: 过滤值为 undefined 的键 —— {...patch} 中显式 snapshot: undefined
        // 会覆盖已有快照, 随后 normalize 将其重置为空对象(静默丢数据)。
        const cleanPatch = {};
        for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) cleanPatch[k] = v;
        }
        state.sources[sourceType] = this.normalizeSyncRecord({
            ...(state.sources[sourceType] || this._makeSourceDefault(withSnapshot)),
            ...cleanPatch,
            watermark: cleanPatch.watermark === undefined
                ? (state.sources[sourceType]?.watermark || null)
                : cleanPatch.watermark,
        }, { keepSnapshot: withSnapshot });
        if (withSnapshot && cleanPatch.snapshot !== undefined) {
            state.sources[sourceType].snapshot = cleanPatch.snapshot;
        }
        this._save(state);
        return this._clone(state.sources[sourceType]);
    },

    // --- 通用 watermark/filter 方法 (与 V1 兼容) ---

    /**
     * 重置指定源的增量同步基线（F-04：基线不可重置的 UI 缺口）
     * 清空 watermark/lastOutcome 等，使下次同步退化为全量扫描
     * F-SYNC-02: epoch +1,远端旧 watermark 无法覆盖新基线
     * @param {string} sourceType
     * @returns {Object} 重置后的状态
     */
    resetSourceState(sourceType) {
        const state = this._load();
        const withSnapshot = sourceType === "bookmark" || sourceType === "rss";
        const previous = state.sources[sourceType] || {};
        state.sources[sourceType] = this._makeSourceDefault(withSnapshot);
        state.sources[sourceType].epoch = (Number(previous.epoch) || 0) + 1;
        this._save(state);
        return this.getSourceState(sourceType);
    },

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
            if (timeMs === latestMs && id && !idSet.has(id) && ids.length < MAX_WATERMARK_IDS) {
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

// v3.14.6 (CC-13): AUTO_SYNC_STATE 跨上下文监听 —— 远端(tab/扩展/他机)变更时失效内存缓存,
// 防陈旧 _cache 经 _save 整键覆写新 watermark/epoch; 本 tab 自写 remote=false 不触发,
// 残余读写间隙 LWW 窗口由跨 tab 租约(CC-04)进一步压缩
if (typeof GM_addValueChangeListener === "function") {
    try {
        GM_addValueChangeListener(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE, (key, oldValue, newValue, remote) => {
            if (!remote) return;
            // 3/3 共识(dsf+glm+qwen): 仅置空 _cache 不够 —— 已排队的 flush 仍会执行, 若
            // _dirty 为 true 则把 null 序列化写回("null" 清空全部水位/epoch)。远端为新值,
            // 本地待写状态已陈旧(LWW), 直接丢弃。
            SyncStateV2._cache = null;
            SyncStateV2._dirty = false;
            SyncStateV2._savePending = false;
            if (SyncStateV2._saveTimerId !== null && SyncStateV2._saveTimerId !== undefined) {
                globalThis.clearTimeout?.(SyncStateV2._saveTimerId);
                SyncStateV2._saveTimerId = null;
            }
        });
    } catch {
        // 无 GM 环境(测试)下静默
    }
}
