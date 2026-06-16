"use strict";

const { CONFIG } = require("../config");
const { SyncStateV2 } = require("./SyncState");

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

    getExportedTopics: () => {
        if (Storage._exportedTopicsCache) {
            return Storage._exportedTopicsCache;
        }

        const data = Storage.getRaw(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, "{}");
        try {
            Storage._exportedTopicsCache = JSON.parse(data);
        } catch {
            Storage._exportedTopicsCache = {};
        }
        return Storage._exportedTopicsCache;
    },

    markTopicExported: (topicId) => {
        const exported = Storage.getExportedTopics();
        exported[topicId] = Date.now();
        Storage._exportedTopicsCache = exported;
        Storage.setRaw(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, JSON.stringify(exported));
    },

    unmarkTopicExported: (topicId) => {
        const exported = Storage.getExportedTopics();
        if (!Object.prototype.hasOwnProperty.call(exported, topicId)) {
            return false;
        }

        delete exported[topicId];
        Storage._exportedTopicsCache = exported;
        Storage.setRaw(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, JSON.stringify(exported));
        return true;
    },

    isTopicExported: (topicId) => {
        const exported = Storage.getExportedTopics();
        return !!exported[topicId];
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

    // 内部方法代理 (供老代码调用)
    _clone: (value) => SyncStateV2._clone ? SyncStateV2._clone(value) : JSON.parse(JSON.stringify(value)),
    _load: () => SyncStateV2._load(),
    _save: (state) => SyncStateV2._save(state),
};

module.exports = { Storage, SyncState };

// CredentialVault will be set from auth module
Object.defineProperty(module.exports, 'CredentialVault', {
    get: () => _credentialVault,
    set: (v) => { _credentialVault = v; },
    enumerable: true,
    configurable: true,
});
