"use strict";

const { CONFIG } = require("../config");
const { Storage } = require("../storage");
const { AdapterRegistry } = require("./AdapterRegistry");
const { SyncCoordinator } = require("./SyncCoordinator");
const { SyncStateV2 } = require("../storage/SyncState");

/**
 * 源类型到配置键的映射
 */
const SOURCE_INTERVAL_KEYS = {
    linuxdo: CONFIG.STORAGE_KEYS.SYNC_INTERVAL_LINUXDO,
    "github-stars": CONFIG.STORAGE_KEYS.SYNC_INTERVAL_GITHUB,
    "github-repos": CONFIG.STORAGE_KEYS.SYNC_INTERVAL_GITHUB,
    "github-forks": CONFIG.STORAGE_KEYS.SYNC_INTERVAL_GITHUB,
    "github-gists": CONFIG.STORAGE_KEYS.SYNC_INTERVAL_GITHUB,
    bookmark: CONFIG.STORAGE_KEYS.SYNC_INTERVAL_BOOKMARKS,
    rss: CONFIG.STORAGE_KEYS.SYNC_INTERVAL_RSS,
};

const SOURCE_INTERVAL_DEFAULTS = {
    linuxdo: CONFIG.DEFAULTS.syncIntervalLinuxdo,
    "github-stars": CONFIG.DEFAULTS.syncIntervalGithub,
    "github-repos": CONFIG.DEFAULTS.syncIntervalGithub,
    "github-forks": CONFIG.DEFAULTS.syncIntervalGithub,
    "github-gists": CONFIG.DEFAULTS.syncIntervalGithub,
    bookmark: CONFIG.DEFAULTS.syncIntervalBookmarks,
    rss: CONFIG.DEFAULTS.syncIntervalRss,
};

// 源类型到自动导入启用键的映射
const SOURCE_ENABLED_KEYS = {
    linuxdo: CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED,
    "github-stars": CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED,
    "github-repos": CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED,
    "github-forks": CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED,
    "github-gists": CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED,
    bookmark: CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED,
    rss: CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED,
};

// 重试退避策略: 初始 5 分钟, 二次 15 分钟, 后续 60 分钟
const RETRY_DELAYS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

/**
 * SyncScheduler — 统一的定时同步调度器
 * 管理每个源的 setInterval 定时器和指数退避重试
 */
const SyncScheduler = {
    _timers: new Map(),    // sourceType → intervalId
    _retries: new Map(),   // sourceType → retryTimeoutId
    _retryCounts: new Map(), // sourceType → retry count

    /**
     * 获取源的同步间隔 (分钟)
     * @param {string} sourceType
     * @returns {number}
     */
    getIntervalMinutes(sourceType) {
        const key = SOURCE_INTERVAL_KEYS[sourceType];
        const def = SOURCE_INTERVAL_DEFAULTS[sourceType] || 30;
        if (!key) return def;
        return Number(Storage.getRaw(key, def)) || def;
    },

    /**
     * 检查源是否启用了自动同步
     * @param {string} sourceType
     * @returns {boolean}
     */
    isEnabled(sourceType) {
        const key = SOURCE_ENABLED_KEYS[sourceType];
        if (!key) return false;
        return !!Storage.getRaw(key, false);
    },

    /**
     * 启动单个源的定时同步
     * @param {string} sourceType
     */
    start(sourceType) {
        this.stop(sourceType);
        const intervalMin = this.getIntervalMinutes(sourceType);
        if (intervalMin <= 0) return; // 0 = 仅手动同步

        const intervalMs = intervalMin * 60 * 1000;
        const runSync = () => {
            if (typeof globalThis.requestIdleCallback === "function") {
                globalThis.requestIdleCallback(() => this._doSync(sourceType));
            } else {
                this._doSync(sourceType);
            }
        };

        const timerId = globalThis.setInterval(runSync, intervalMs);
        this._timers.set(sourceType, timerId);
    },

    /**
     * 停止单个源的定时同步
     * @param {string} sourceType
     */
    stop(sourceType) {
        const timerId = this._timers.get(sourceType);
        if (timerId != null) {
            globalThis.clearInterval(timerId);
            this._timers.delete(sourceType);
        }
        this._cancelRetry(sourceType);
    },

    /**
     * 启动所有已启用源的定时同步
     */
    startAll() {
        for (const sourceType of AdapterRegistry.listAdapters()) {
            if (this.isEnabled(sourceType)) {
                this.start(sourceType);
            }
        }
    },

    /**
     * 停止所有源的定时同步
     */
    stopAll() {
        for (const sourceType of this._timers.keys()) {
            this.stop(sourceType);
        }
    },

    /**
     * 获取源的调度状态
     * @param {string} sourceType
     * @returns {{intervalMinutes: number, lastSyncAt: number, lastOutcome: string, nextSyncAt: number|null}}
     */
    getStatus(sourceType) {
        const state = SyncStateV2.getSourceState(sourceType);
        const intervalMin = this.getIntervalMinutes(sourceType);
        const isRunning = this._timers.has(sourceType);
        return {
            intervalMinutes: intervalMin,
            lastSyncAt: state.lastSuccessAt || 0,
            lastOutcome: state.lastOutcome || "idle",
            nextSyncAt: isRunning && state.lastSuccessAt
                ? state.lastSuccessAt + intervalMin * 60 * 1000
                : null,
        };
    },

    /**
     * 执行一次同步并处理重试
     * @param {string} sourceType
     */
    async _doSync(sourceType) {
        try {
            const result = await SyncCoordinator.sync(sourceType);
            if (result.error) {
                this._scheduleRetry(sourceType);
            } else {
                this._retryCounts.set(sourceType, 0);
            }
        } catch (error) {
            console.warn("[LD-Notion] sync unexpected error:", sourceType, error);
            this._scheduleRetry(sourceType);
        }
    },

    /**
     * 调度错误重试 (指数退避)
     * @param {string} sourceType
     */
    _scheduleRetry(sourceType) {
        this._cancelRetry(sourceType);
        const count = (this._retryCounts.get(sourceType) || 0) + 1;
        this._retryCounts.set(sourceType, count);
        const delay = RETRY_DELAYS[Math.min(count - 1, RETRY_DELAYS.length - 1)];
        const retryId = globalThis.setTimeout(() => this._doSync(sourceType), delay);
        this._retries.set(sourceType, retryId);
    },

    /**
     * 取消重试计时器
     * @param {string} sourceType
     */
    _cancelRetry(sourceType) {
        const retryId = this._retries.get(sourceType);
        if (retryId != null) {
            globalThis.clearTimeout(retryId);
            this._retries.delete(sourceType);
        }
    },
};

module.exports = { SyncScheduler };
