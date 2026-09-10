"use strict";

const { CONFIG } = require("../config");
const { SyncStateV2 } = require("./SyncState");
const { DedupStore } = require("./DedupStore");
const { on } = require("../coordination/event-bus");

let _credentialVault = null;

// ===========================================
// 存储管理
// ===========================================

const Storage = {
    _exportedTopicsCache: null,

    getRaw: (key, defaultValue = null) => {
        const value = GM_getValue(key, defaultValue);
        return value;
    },

    setRaw: (key, value) => {
        GM_setValue(key, value);
    },

    remove: (key) => {
        if (typeof GM_deleteValue === "function") {
            GM_deleteValue(key);
            return;
        }
        GM_setValue(key, undefined);
    },

    get: (key, defaultValue = null) => {
        if (_credentialVault?.isSensitiveKey?.(key)) {
            return _credentialVault.get(key, defaultValue);
        }
        return Storage.getRaw(key, defaultValue);
    },

    set: (key, value) => {
        Storage.setRaw(key, value);
    },

    // ---- 去重单一账本(F1 共识)----
    // 全部去重记录收敛到 DedupStore 命名空间(ldb_exported_topics:<sourceType>,
    // 90 天 TTL 自动淘汰)。legacy 键 ldb_exported_topics(无 sourceType 后缀)
    // 首次访问时一次性迁移合并,此后双轨消除。
    //
    // F3 共识:GM storage 跨 tab 共享但模块缓存不共享,tab B 看不到 tab A 的
    // mark → 可重复导出。注册 GM_addValueChangeListener 监听本键变化时置空缓存。
    _registerExportedTopicsWatcher: () => {
        if (Storage._exportedTopicsWatcherBound) return;
        Storage._exportedTopicsWatcherBound = true;
        // P4 收敛(c10): batch 结束同 tab 落盘不发 GM 事件 —— 订阅专用事件清缓存,
        // 否则缓存仍指向已脱离的 batch 快照(缺其他 tab 在批窗口内写入的键)。
        // 必须早于 GM 监听器可用性检查 —— 否则无 GM 事件能力的环境会连批内失效一起丢失。
        try {
            on("storage:batch-committed", () => { Storage._exportedTopicsCache = null; });
        } catch (e) {
            // 事件总线不可用不影响功能
        }
        if (typeof GM_addValueChangeListener !== "function") return;
        try {
            GM_addValueChangeListener(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, () => {
                Storage._exportedTopicsCache = null;
            });
            // 派生键族(每个 sourceType 一个桶)同样监听,迁移/清除跨 tab 生效
            for (const sourceType of ["linuxdo", "bookmark", "rss", "github-stars", "github-repos", "github-forks", "github-gists", "zhihu", "generic"]) {
                GM_addValueChangeListener(
                    `${CONFIG.STORAGE_KEYS.EXPORTED_TOPICS}:${sourceType}`,
                    () => { Storage._exportedTopicsCache = null; }
                );
            }
        } catch (e) {
            // 监听失败不影响功能(仅缓存陈旧风险),静默降级
        }
    },

    // 一次性迁移:legacy 键 → DedupStore 命名空间(取 max ts),成功后删除旧键。
    // 幂等:迁移完成后旧键已删,重复调用无效果。
    _migrateLegacyExportedTopics: () => {
        if (Storage._exportedTopicsMigrated) return;
        Storage._exportedTopicsMigrated = true;
        try {
            const raw = Storage.getRaw(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, "{}");
            let legacy = {};
            try { legacy = JSON.parse(raw); } catch { /* 损坏即忽略 */ }
            // P4 收敛(c10): 非纯对象(字符串/数组/null) 会污染去重键(下标键)或抛 TypeError
            if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) legacy = {};
            const legacyKeys = Object.keys(legacy);
            if (legacyKeys.length === 0) return;
            const set = DedupStore.getSeen("linuxdo") || {};
            let changed = false;
            for (const k of legacyKeys) {
                const ts = Number(legacy[k]) || 0;
                if (!Object.prototype.hasOwnProperty.call(set, k) || (set[k] || 0) < ts) {
                    set[k] = ts;
                    changed = true;
                }
            }
            if (changed) {
                // 迁移是数据搬运而非新写入: 绕过 _saveSet 的 TTL 淘汰,
                // 完整保留 legacy 数据(取 max 合并), 后续正常写回再自然淘汰。
                GM_setValue(DedupStore.keyFor("linuxdo"), JSON.stringify(set));
            }
            Storage.remove(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS);
        } catch (e) {
            // 迁移失败不阻塞(下次访问重试)
            Storage._exportedTopicsMigrated = false;
        }
    },

    getExportedTopics: () => {
        Storage._registerExportedTopicsWatcher();
        Storage._migrateLegacyExportedTopics();
        if (Storage._exportedTopicsCache) {
            return Storage._exportedTopicsCache;
        }
        Storage._exportedTopicsCache = DedupStore.getSeen("linuxdo") || {};
        return Storage._exportedTopicsCache;
    },

    markTopicExported: (topicId) => {
        const key = String(topicId);
        const exported = Storage.getExportedTopics();
        exported[key] = Date.now();
        Storage._exportedTopicsCache = exported;
        // DedupStore 内部维护批量缓存:非 batch 模式直接写回;
        // linuxdo 为 id 键源, 走容量上限淘汰(非 90 天 TTL)。
        DedupStore.markSeen("linuxdo", key);
    },

    unmarkTopicExported: (topicId) => {
        const key = String(topicId);
        const exported = Storage.getExportedTopics();
        if (!Object.prototype.hasOwnProperty.call(exported, key)) {
            return false;
        }
        delete exported[key];
        Storage._exportedTopicsCache = exported;
        // 同步到 DedupStore 账本(删除语义,双路径一致)
        DedupStore.unmarkSeen("linuxdo", key);
        return true;
    },

    isTopicExported: (topicId) => {
        const key = String(topicId);
        const exported = Storage.getExportedTopics();
        return Object.prototype.hasOwnProperty.call(exported, key);
    },

    clearExportedTopics: () => {
        Storage._exportedTopicsCache = {};
        DedupStore.clearSeen("linuxdo");
        // 2/3 共识(dsf+qwen): legacy 键未删则后续迁移会把已清除记录重新迁回
        Storage.remove(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS);
    },
};

/**
 * SyncState V1 — 代理层 facade
 * 所有方法委托到 SyncStateV2，消除 V1/V2 双写
 */
const SyncState = {
    VERSION: SyncStateV2.VERSION,
    OUTCOMES: SyncStateV2.OUTCOMES,

    // 通用方法直接委托到 V2
    normalizeTime: (...args) => SyncStateV2.normalizeTime(...args),
    normalizeWatermark: (...args) => SyncStateV2.normalizeWatermark(...args),
    normalizeSyncRecord: (...args) => SyncStateV2.normalizeSyncRecord(...args),
    buildWatermark: (...args) => SyncStateV2.buildWatermark(...args),
    filterOrderedItems: (...args) => SyncStateV2.filterOrderedItems(...args),
    filterItems: (...args) => SyncStateV2.filterItems(...args),
    isItemAfterWatermark: (...args) => SyncStateV2.isItemAfterWatermark(...args),
    takeLeadingItems: (...args) => SyncStateV2.takeLeadingItems(...args),

    // 通用源状态访问（F-UI-31 同步链状态回显依赖，facade 此前缺失导致 renderSyncChainStatus 抛 TypeError）
    getSourceState: (sourceType) => SyncStateV2.getSourceState(sourceType),
    updateSourceState: (sourceType, patch) => SyncStateV2.updateSourceState(sourceType, patch),
    forceFlush: () => SyncStateV2.forceFlush(),
    // 设置项 LWW 时间戳(仅本地持久化; 同步投影复用旧时间戳防止未修改设备覆盖他端修改)
    getSettingsStamps: () => SyncStateV2.getSettingsStamps(),
    setSettingsStamps: (stamps) => SyncStateV2.setSettingsStamps(stamps),

    // V1 兼容 API 代理到 V2
    getLinuxDoState: () => SyncStateV2.getSourceState("linuxdo"),
    updateLinuxDoState: (patch) => SyncStateV2.updateSourceState("linuxdo", patch),

    getGitHubState: (type) => SyncStateV2.getSourceState(`github-${type}`),
    updateGitHubState: (type, patch) => SyncStateV2.updateSourceState(`github-${type}`, patch),
    getGitHubMeta: () => SyncStateV2.getSourceState("github-meta"),
    updateGitHubMeta: (patch) => SyncStateV2.updateSourceState("github-meta", patch),

    getBookmarkState: () => SyncStateV2.getSourceState("bookmark"),
    updateBookmarkState: (patch) => SyncStateV2.updateSourceState("bookmark", patch),

    getRssState: () => SyncStateV2.getSourceState("rss"),
    updateRssState: (patch) => SyncStateV2.updateSourceState("rss", patch),

    // F-04 修复：重置指定源增量基线（下次同步退化为全量）
    resetSourceState: (sourceType) => SyncStateV2.resetSourceState(sourceType),

    // 内部方法代理 (供老代码调用)
    _clone: (value) => SyncStateV2._clone ? SyncStateV2._clone(value) : JSON.parse(JSON.stringify(value)),
    _load: () => SyncStateV2._load(),
    _save: (state) => SyncStateV2._save(state),
};

module.exports = { Storage, SyncState, DedupStore };

// CredentialVault will be set from auth module（main.js 通过 Storage.CredentialVault = CredentialVault 注入）。
// setter 必须定义在 Storage 主对象上（而非 module.exports），这样 main.js 的直接赋值才能触发
// setter 更新内部 _credentialVault 私有变量，Storage.get 对 sensitive key 的透明解密转发才会生效。
Object.defineProperty(Storage, 'CredentialVault', {
    get: () => _credentialVault,
    set: (v) => { _credentialVault = v; },
    enumerable: true,
    configurable: true,
});
