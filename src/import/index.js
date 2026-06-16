"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { NotionOAuth } = require("../auth");
const { Exporter, LinuxDoAPI } = require("../export");
const { SyncLock } = require("../sync-lock");

const { UpdateChecker } = require("./UpdateChecker");
const { GitHubAutoImporter } = require("./GitHubAutoImporter");
const { GitHubAPI } = require("./GitHubAPI");
const { GitHubExporter } = require("./GitHubExporter");

const AutoImporter = {
    isRunning: false,
    timerId: null,
    deferredWhileHidden: false,
    visibilityListenerBound: false,
    lastRunAt: 0,
    minimumRunGapMs: 60 * 1000,

    // 从 Storage 读取导出设置（不依赖 UI DOM）
    buildSettings: () => {
        const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
        return {
            apiKey: Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""),
            databaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
            parentPageId: Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, ""),
            exportTargetType,
            onlyFirst: Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, false),
            onlyOp: Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, false),
            rangeStart: Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, 1),
            rangeEnd: Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, 999999),
            imgFilter: Storage.get(CONFIG.STORAGE_KEYS.FILTER_IMG, CONFIG.DEFAULTS.imgFilter),
            filterUsers: Storage.get(CONFIG.STORAGE_KEYS.FILTER_USERS, CONFIG.DEFAULTS.filterUsers),
            filterInclude: Storage.get(CONFIG.STORAGE_KEYS.FILTER_INCLUDE, CONFIG.DEFAULTS.filterInclude),
            filterExclude: Storage.get(CONFIG.STORAGE_KEYS.FILTER_EXCLUDE, CONFIG.DEFAULTS.filterExclude),
            filterMinLen: Storage.get(CONFIG.STORAGE_KEYS.FILTER_MINLEN, CONFIG.DEFAULTS.filterMinLen),
            imgMode: Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode),
            concurrency: Storage.get(CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY, CONFIG.DEFAULTS.exportConcurrency),
        };
    },

    // 检查配置是否足够
    canStart: () => {
        if (!Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, false)) return false;
        const apiKey = NotionOAuth.getAccessToken();
        if (!apiKey) return false;
        const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
        if (exportTargetType === "database") {
            return !!Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
        } else {
            return !!Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "");
        }
    },

    // 更新状态栏
    updateStatus: (text) => {
        const el = (UI.refs && UI.refs.autoImportStatus) || document.querySelector("#ldb-auto-import-status");
        if (el) el.textContent = text;
    },

    getWatermark: (bookmarks = []) => SyncState.buildWatermark(
        bookmarks,
        LinuxDoAPI.getBookmarkSyncTime,
        LinuxDoAPI.getBookmarkId
    ),


    startPolling: (intervalMinutes) => {
        // 统一委托给 SyncScheduler (消除双定时器)
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.start("linuxdo");
    },

    ensureVisibilityListener: () => {
        if (AutoImporter.visibilityListenerBound) return;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && AutoImporter.deferredWhileHidden) {
                AutoImporter.deferredWhileHidden = false;
                Utils.runWhenBrowserIdle(() => AutoImporter.run());
            }
        });
        AutoImporter.visibilityListenerBound = true;
    },

    stopPolling: () => {
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.stop("linuxdo");
    },

    init: () => {
        if (!AutoImporter.canStart()) return;
        AutoImporter.ensureVisibilityListener();
        setTimeout(() => {
            Utils.runWhenBrowserIdle(() => AutoImporter.run());
            const interval = Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.autoImportInterval);
            if (interval > 0) AutoImporter.startPolling(interval);
        }, 3000);
    },
};

AutoImporter.run = async () => {
    if (document.hidden) {
        AutoImporter.deferredWhileHidden = true;
        return;
    }
    if (AutoImporter.isRunning) return;
    if (SyncLock.isExporting) return;

    const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
    if (!apiKey) {
        AutoImporter.updateStatus("请先配置 Notion API Key");
        return;
    }
    const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
    if (exportTargetType === "database" && !Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "")) {
        AutoImporter.updateStatus("请先配置 Notion 数据库 ID");
        return;
    }
    if (exportTargetType === "page" && !Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "")) {
        AutoImporter.updateStatus("请先配置父页面 ID");
        return;
    }

    const now = Date.now();
    if (now - AutoImporter.lastRunAt < AutoImporter.minimumRunGapMs) return;
    AutoImporter.lastRunAt = now;
    AutoImporter.isRunning = true;
    const attemptAt = Date.now();
    const exportBtn = document.querySelector("#ldb-export");

    try {
        SyncState.updateLinuxDoState({
            lastAttemptAt: attemptAt,
            lastOutcome: "running",
            lastError: "",
            lastStats: {},
        });

        const username = Utils.getCurrentLinuxDoUsername();
        if (!username) {
            const errorMessage = "无法获取当前 Linux.do 用户名";
            SyncState.updateLinuxDoState({
                lastAttemptAt: attemptAt,
                lastOutcome: "error",
                lastError: errorMessage,
                lastStats: {},
            });
            AutoImporter.updateStatus(`❌ ${errorMessage}`);
            return;
        }

        AutoImporter.updateStatus("📧 正在检查新收藏...");
        const syncState = SyncState.getLinuxDoState();
        const bookmarks = await LinuxDoAPI.fetchBookmarksSince(username, syncState.watermark);
        const newBookmarks = bookmarks.filter((bookmark) => {
            const topicId = String(bookmark.topic_id || bookmark.bookmarkable_id);
            return !Storage.isTopicExported(topicId);
        });

        if (newBookmarks.length === 0) {
            const statePatch = {
                lastAttemptAt: attemptAt,
                lastSuccessAt: Date.now(),
                lastOutcome: "success",
                lastError: "",
                lastStats: {
                    scanned: bookmarks.length,
                    pending: 0,
                    success: 0,
                    failed: 0,
                },
            };
            if (bookmarks.length > 0) {
                statePatch.watermark = AutoImporter.getWatermark(bookmarks);
            }
            SyncState.updateLinuxDoState(statePatch);
            AutoImporter.updateStatus(`✅ 没有新收藏 (${new Date().toLocaleTimeString()})`);
            return;
        }

        AutoImporter.updateStatus(`📬 发现 ${newBookmarks.length} 个新收藏，正在导入...`);

        if (exportBtn) exportBtn.disabled = true;
        const obsExportBtn = document.querySelector("#ldb-obs-export");
        if (obsExportBtn) obsExportBtn.disabled = true;

        const settings = AutoImporter.buildSettings();
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        const concurrency = settings.concurrency || 1;
        let success = 0;
        let failed = 0;
        const successfulBookmarks = [];
        let nextIndex = 0;

        const worker = async () => {
            while (true) {
                const i = nextIndex;
                if (i >= newBookmarks.length) return;
                nextIndex++;

                const bookmark = newBookmarks[i];
                const topicId = String(bookmark.topic_id || bookmark.bookmarkable_id);
                const title = bookmark.title || bookmark.name || `帖子 ${topicId}`;
                AutoImporter.updateStatus(`📬 导入中 (${i + 1}/${newBookmarks.length}): ${title}`);

                try {
                    await Exporter.exportTopic(bookmark, settings);
                    success++;
                    successfulBookmarks.push(bookmark);
                } catch (error) {
                    console.error(`[LD-Notion] 自动导入失败: ${title}`, error);
                    failed++;
                }

                if (delay > 0 && nextIndex < newBookmarks.length) {
                    await Utils.sleep(delay);
                }
            }
        };

        const workerCount = Math.min(concurrency, newBookmarks.length);
        const workers = [];
        for (let w = 0; w < workerCount; w++) {
            workers.push(worker());
            if (w < workerCount - 1) await Utils.sleep(100);
        }
        await Promise.all(workers);

        if (typeof UI !== "undefined" && UI.renderBookmarkList) {
            try { UI.renderBookmarkList(); } catch {}
        }

        const statePatch = {
            lastAttemptAt: attemptAt,
            lastOutcome: failed > 0 ? "partial" : "success",
            lastError: "",
            lastStats: {
                scanned: bookmarks.length,
                pending: newBookmarks.length,
                success,
                failed,
            },
        };
        if (successfulBookmarks.length > 0) {
            const successIds = new Set(successfulBookmarks.map((bookmark) => LinuxDoAPI.getBookmarkId(bookmark)));
            const leadingSuccessfulBookmarks = SyncState.takeLeadingItems(
                newBookmarks,
                (bookmark) => successIds.has(LinuxDoAPI.getBookmarkId(bookmark))
            );
            if (leadingSuccessfulBookmarks.length > 0) {
                statePatch.watermark = AutoImporter.getWatermark(leadingSuccessfulBookmarks);
            }
            statePatch.lastSuccessAt = Date.now();
        }
        SyncState.updateLinuxDoState(statePatch);

        AutoImporter.updateStatus(`✅ 自动导入完成: ${success} 个成功${failed > 0 ? `，${failed} 个失败` : ""} (${new Date().toLocaleTimeString()})`);

        if (success > 0 && typeof GM_notification === "function") {
            GM_notification({
                title: "自动导入完成",
                text: `成功导入 ${success} 个新收藏到 Notion`,
                timeout: 5000,
            });
        }
    } catch (error) {
        console.error("[LD-Notion] 自动导入出错:", error);
        SyncState.updateLinuxDoState({
            lastAttemptAt: attemptAt,
            lastOutcome: "error",
            lastError: error?.message || String(error),
            lastStats: {},
        });
        AutoImporter.updateStatus(`❌ 自动导入出错: ${error.message}`);
    } finally {
        AutoImporter.isRunning = false;
        if (exportBtn) exportBtn.disabled = false;
        const obsExportBtn2 = document.querySelector("#ldb-obs-export");
        if (obsExportBtn2) obsExportBtn2.disabled = false;
        if (typeof UI !== "undefined" && typeof UI.renderSyncCenterSummary === "function") {
            try { UI.renderSyncCenterSummary(); } catch {}
        }
    }
};

module.exports = { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter };
