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
// 最大重试次数熔断（REL-003）：超过上限后放弃重试，避免源持续失败时每 60min 永不停止重试。
// 上限取 RETRY_DELAYS 长度 + 2（约 5 次），达上限后归零计数，待下次正常 interval 周期再试。
const MAX_RETRIES = RETRY_DELAYS.length + 2;

// 源类型到完整同步 runner 的映射(F-UI-02 修复):
// 定时路径必须走各 AutoImporter.run()(fetch + 写 Notion + 推进水位),
// 而非 SyncCoordinator.sync(仅拉取+去重+推进水位,不写 Notion → 增量永久丢失)。
// lazy require 避免加载期耦合(import/bridge 不顶层 require adapter)。
const SOURCE_RUNNERS = {
    linuxdo: () => require("../import").AutoImporter.run(),
    "github-stars": () => require("../import").GitHubAutoImporter.run(),
    "github-repos": () => require("../import").GitHubAutoImporter.run(),
    "github-forks": () => require("../import").GitHubAutoImporter.run(),
    "github-gists": () => require("../import").GitHubAutoImporter.run(),
    bookmark: () => require("../bridge").BookmarkAutoImporter.run(),
    rss: () => require("../bridge").RSSAutoImporter.run(),
};

/**
 * SyncScheduler — 统一的定时同步调度器
 * 管理每个源的 setInterval 定时器和指数退避重试
 */
const SyncScheduler = {
    _timers: new Map(),    // sourceType → intervalId
    _retries: new Map(),   // sourceType → retryTimeoutId
    _retryCounts: new Map(), // sourceType → retry count
    _epochs: new Map(),    // sourceType → epoch (v3.14.6 CC-07: 取消在途)

    /**
     * 获取源的同步间隔 (分钟)
     * @param {string} sourceType
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
     * @param {number} [intervalMinutes] 显式间隔(分钟),优先于存储键(F-UI-03 修复:
     *   UI 写入的 *_AUTO_IMPORT_INTERVAL 经 startPolling 传入,不再被默认值覆盖)
     */
    start(sourceType, intervalMinutes) {
        this.stop(sourceType);
        // v3.14.6 (CC-07): 递增 epoch, 使此前在途 _doSync 完成时判旧丢弃
        this._epochs.set(sourceType, (this._epochs.get(sourceType) || 0) + 1);
        const intervalMin = Number.isFinite(intervalMinutes) && intervalMinutes > 0
            ? intervalMinutes
            : this.getIntervalMinutes(sourceType);
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
        // v3.14.6 (CC-07): 递增 epoch 使在途 _doSync 完成时判旧丢弃结果/不调度重试
        this._epochs.set(sourceType, (this._epochs.get(sourceType) || 0) + 1);
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
        // v3.14.6 (CC-07): 捕获启动 epoch, 完成时与当前不符则丢弃(停止后不再调度重试/复位计数)
        const epoch = this._epochs.get(sourceType) || 0;
        try {
            // F-UI-02 修复:定时路径走完整同步 runner(写 Notion + 推进水位),
            // 与手动路径一致;SyncCoordinator 保留给手动全量同步。
            const runner = SOURCE_RUNNERS[sourceType];
            if (typeof runner === "function") {
                await runner();
                if (epoch !== (this._epochs.get(sourceType) || 0)) return; // 已停止: 丢弃
                this._retryCounts.set(sourceType, 0);
                return;
            }
            const result = await SyncCoordinator.sync(sourceType);
            if (epoch !== (this._epochs.get(sourceType) || 0)) return; // 已停止: 丢弃
            if (result.error) {
                this._scheduleRetry(sourceType);
            } else {
                this._retryCounts.set(sourceType, 0);
            }
        } catch (error) {
            console.warn("[LD-Notion] sync unexpected error:", sourceType, error);
            if (epoch !== (this._epochs.get(sourceType) || 0)) return; // 已停止: 丢弃
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
        // 熔断（REL-003）：达上限放弃重试，归零计数，源持续失败不再每 60min 无限重试。
        if (count > MAX_RETRIES) {
            console.warn(`[LD-Notion] sync 放弃重试 (已达上限 ${MAX_RETRIES} 次):`, sourceType);
            this._retryCounts.set(sourceType, 0);
            return;
        }
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
