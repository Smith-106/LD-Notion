"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { NotionAPI, DOMToNotion, SiteDetector, InstallHelper } = require("../api");
const { OperationGuard, UndoManager, OperationLog } = require("../security");
const { GenericExtractor } = require("../extract");
const { Exporter, LinuxDoAPI } = require("../export");
const { SyncCoordinator } = require("../adapter/SyncCoordinator");
const { SyncLock } = require("../sync-lock");

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

const UpdateChecker = {
    timerId: null,
    isChecking: false,

    shouldCheckNow: (intervalHours) => {
        const intervalMs = (parseInt(intervalHours, 10) || 0) * 60 * 60 * 1000;
        if (intervalMs <= 0) return true;
        const lastCheckAt = parseInt(Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, 0), 10) || 0;
        return !lastCheckAt || (Date.now() - lastCheckAt >= intervalMs);
    },

    getCurrentVersion: () => {
        if (typeof GM_info !== "undefined" && GM_info?.script?.version) {
            return GM_info.script.version;
        }
        return "3.4.5";
    },

    compareVersions: (a, b) => {
        const parse = (v) => String(v || "0")
            .replace(/^v/i, "")
            .split(".")
            .map((n) => parseInt(n, 10) || 0);
        const va = parse(a);
        const vb = parse(b);
        const len = Math.max(va.length, vb.length);
        for (let i = 0; i < len; i++) {
            const na = va[i] || 0;
            const nb = vb[i] || 0;
            if (na > nb) return 1;
            if (na < nb) return -1;
        }
        return 0;
    },

    fetchLatestVersion: () => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://api.github.com/repos/Smith-106/LD-Notion/releases/latest",
                headers: {
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "LD-Notion-UserScript",
                },
                timeout: 15000,
                onload: (response) => {
                    if (response.status !== 200) {
                        reject(new Error(`更新检查失败: HTTP ${response.status}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(response.responseText || "{}");
                        const version = String(data.tag_name || data.name || "").replace(/^v/i, "").trim();
                        if (!version) {
                            reject(new Error("未获取到版本号"));
                            return;
                        }
                        resolve(version);
                    } catch {
                        reject(new Error("解析更新信息失败"));
                    }
                },
                ontimeout: () => reject(new Error("更新检查超时")),
                onerror: () => reject(new Error("网络错误，无法检查更新")),
            });
        });
    },

    saveResult: (result) => {
        const checkedAt = Date.now();
        Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, checkedAt);
        Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, JSON.stringify({ ...result, checkedAt }));
        if (result.latestVersion) {
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_SEEN_VERSION, result.latestVersion);
        }
    },

    updateStatusText: (text) => {
        const el = (UI.refs && UI.refs.updateCheckStatus) || document.querySelector("#ldb-update-check-status");
        if (el) el.textContent = text;
    },

    renderLastStatus: () => {
        const raw = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, "");
        if (!raw) {
            UpdateChecker.updateStatusText("尚未检查更新");
            return;
        }

        try {
            const result = JSON.parse(raw);
            const checkedAtText = result.checkedAt
                ? new Date(result.checkedAt).toLocaleString("zh-CN")
                : "未知时间";
            const latestText = result.latestVersion ? `，最新 v${result.latestVersion}` : "";
            if (result.status === "update-available") {
                UpdateChecker.updateStatusText(`发现新版本（上次检查：${checkedAtText}${latestText}）`);
            } else if (result.status === "up-to-date") {
                UpdateChecker.updateStatusText(`已是最新（上次检查：${checkedAtText}${latestText}）`);
            } else if (result.status === "error") {
                UpdateChecker.updateStatusText(`上次检查失败：${result.message || "未知错误"}`);
            } else {
                UpdateChecker.updateStatusText(`上次检查：${checkedAtText}`);
            }
        } catch {
            UpdateChecker.updateStatusText("更新状态读取失败");
        }
    },

    check: async ({ manual = false } = {}) => {
        if (UpdateChecker.isChecking) return;
        UpdateChecker.isChecking = true;

        if (manual) {
            UI.showStatus("正在检查更新...", "info");
        }

        try {
            const currentVersion = UpdateChecker.getCurrentVersion();
            const latestVersion = await UpdateChecker.fetchLatestVersion();
            const cmp = UpdateChecker.compareVersions(latestVersion, currentVersion);

            if (cmp > 0) {
                const message = `发现新版本 v${latestVersion}（当前 v${currentVersion}）。脚本可直接更新；ZIP/解压扩展需手动重新安装或在扩展页重新加载。`;
                UpdateChecker.saveResult({
                    status: "update-available",
                    latestVersion,
                    currentVersion,
                    message,
                });
                UpdateChecker.renderLastStatus();
                if (manual) UI.showStatus(message, "info");
            } else {
                const message = `当前已是最新版本 v${currentVersion}`;
                UpdateChecker.saveResult({
                    status: "up-to-date",
                    latestVersion,
                    currentVersion,
                    message,
                });
                UpdateChecker.renderLastStatus();
                if (manual) UI.showStatus(message, "success");
            }
        } catch (error) {
            const message = error?.message || "更新检查失败";
            UpdateChecker.saveResult({ status: "error", message });
            UpdateChecker.renderLastStatus();
            if (manual) UI.showStatus(message, "error");
        } finally {
            UpdateChecker.isChecking = false;
        }
    },

    startPolling: (hours) => {
        UpdateChecker.stopPolling();
        const intervalHours = parseInt(hours, 10) || 0;
        if (intervalHours > 0) {
            UpdateChecker.timerId = setInterval(() => {
                Utils.runWhenBrowserIdle(() => UpdateChecker.check({ manual: false }));
            }, intervalHours * 60 * 60 * 1000);
        }
    },

    stopPolling: () => {
        if (UpdateChecker.timerId) {
            clearInterval(UpdateChecker.timerId);
            UpdateChecker.timerId = null;
        }
    },

    init: () => {
        const enabled = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled);
        const intervalHours = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
        UpdateChecker.stopPolling();
        UpdateChecker.renderLastStatus();
        if (enabled) {
            if (UpdateChecker.shouldCheckNow(intervalHours)) {
                Utils.runWhenBrowserIdle(() => UpdateChecker.check({ manual: false }));
            }
            UpdateChecker.startPolling(intervalHours);
        }
    },
};

const GitHubAutoImporter = {
    isRunning: false,
    timerId: null,
    deferredWhileHidden: false,
    visibilityListenerBound: false,
    lastRunAt: 0,
    minimumRunGapMs: 60 * 1000,

    canStart: () => {
        if (!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, false)) return false;
        const username = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
        const token = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
        if (!username && !token) return false;
        const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
        const databaseId = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
        return !!(apiKey && databaseId);
    },

    updateStatus: (text) => {
        const el = (UI.refs && UI.refs.autoImportStatus) || document.querySelector("#ldb-auto-import-status");
        if (el) el.textContent = text;
    },

    buildSettings: () => {
        return {
            apiKey: Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""),
            databaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
            username: Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, ""),
            token: Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
        };
    },

    getTypeMeta: (type) => {
        const metaMap = {
            stars: {
                label: "Stars",
                getTime: (item) => item?.starred_at || item?.created_at || item?.updated_at || "",
                getId: (item) => String(item?.full_name || item?.name || ""),
            },
            repos: {
                label: "Repos",
                getTime: (item) => item?.pushed_at || item?.updated_at || item?.created_at || "",
                getId: (item) => String(item?.full_name || item?.name || ""),
            },
            forks: {
                label: "Forks",
                getTime: (item) => item?.pushed_at || item?.updated_at || item?.created_at || "",
                getId: (item) => String(item?.full_name || item?.name || ""),
            },
            gists: {
                label: "Gists",
                getTime: (item) => item?.updated_at || item?.created_at || "",
                getId: (item) => String(item?.id || ""),
            },
        };
        return metaMap[type] || metaMap.stars;
    },

    fetchTypeItems: async (type, settings) => {
        if (type === "stars") {
            return await GitHubAPI.fetchStarredRepos(settings.username, settings.token);
        }
        if (type === "repos") {
            const repos = await GitHubAPI.fetchUserRepos(settings.username, settings.token);
            return repos.filter((repo) => !repo.fork);
        }
        if (type === "forks") {
            return await GitHubAPI.fetchForkedRepos(settings.username, settings.token);
        }
        if (type === "gists") {
            return await GitHubAPI.fetchUserGists(settings.username, settings.token);
        }
        return [];
    },

    ensureVisibilityListener: () => {
        if (GitHubAutoImporter.visibilityListenerBound) return;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && GitHubAutoImporter.deferredWhileHidden) {
                GitHubAutoImporter.deferredWhileHidden = false;
                Utils.runWhenBrowserIdle(() => GitHubAutoImporter.run());
            }
        });
        GitHubAutoImporter.visibilityListenerBound = true;
    },


    startPolling: (intervalMinutes) => {
        // 统一委托给 SyncScheduler (消除双定时器)
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        const types = GitHubAPI.getImportTypes();
        for (const type of types) {
            SyncScheduler.start(`github-${type}`);
        }
    },

    stopPolling: () => {
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        const types = GitHubAPI.getImportTypes();
        for (const type of types) {
            SyncScheduler.stop(`github-${type}`);
        }
    },

    init: () => {
        if (!GitHubAutoImporter.canStart()) return;
        GitHubAutoImporter.ensureVisibilityListener();
        setTimeout(() => {
            Utils.runWhenBrowserIdle(() => GitHubAutoImporter.run());
            const interval = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.githubAutoImportInterval);
            if (interval > 0) GitHubAutoImporter.startPolling(interval);
        }, 3000);
    },
};

// ===========================================
// GitHub API 模块
// ===========================================
GitHubAutoImporter.run = async () => {
    if (document.hidden) {
        GitHubAutoImporter.deferredWhileHidden = true;
        return;
    }
    if (GitHubAutoImporter.isRunning) return;

    const settings = GitHubAutoImporter.buildSettings();
    if (!settings.apiKey || !settings.databaseId) {
        GitHubAutoImporter.updateStatus("请先配置 Notion API Key 和数据库 ID");
        return;
    }
    if (!settings.username && !settings.token) {
        GitHubAutoImporter.updateStatus("请先配置 GitHub 用户名或 Token");
        return;
    }

    const now = Date.now();
    if (now - GitHubAutoImporter.lastRunAt < GitHubAutoImporter.minimumRunGapMs) return;
    GitHubAutoImporter.lastRunAt = now;
    GitHubAutoImporter.isRunning = true;
    const attemptAt = Date.now();

    try {
        GitHubAutoImporter.updateStatus("📧 正在检查 GitHub 新收藏...");

        const types = GitHubAPI.getImportTypes();
        SyncState.updateGitHubMeta({
            lastAttemptAt: attemptAt,
            lastOutcome: "running",
            lastError: "",
            lastStats: {
                enabledTypes: types.length,
                exported: 0,
                failed: 0,
                syncErrors: 0,
            },
        });

        let successCount = 0;
        let failedCount = 0;
        let hasPending = false;
        const syncErrors = [];

        for (const type of types) {
            const meta = GitHubAutoImporter.getTypeMeta(type);
            const typeAttemptAt = Date.now();

            try {
                SyncState.updateGitHubState(type, {
                    lastAttemptAt: typeAttemptAt,
                    lastOutcome: "running",
                    lastError: "",
                    lastStats: {},
                });
                GitHubAutoImporter.updateStatus(`📧 正在检查 GitHub ${meta.label}...`);

                const syncState = SyncState.getGitHubState(type);
                const items = await GitHubAutoImporter.fetchTypeItems(type, settings);
                const incrementalItems = SyncState.filterOrderedItems(
                    items,
                    syncState.watermark,
                    meta.getTime,
                    meta.getId
                );

                if (incrementalItems.length === 0) {
                    SyncState.updateGitHubState(type, {
                        lastAttemptAt: typeAttemptAt,
                        lastSuccessAt: Date.now(),
                        lastOutcome: "success",
                        lastError: "",
                        lastStats: {
                            scanned: items.length,
                            pending: 0,
                            exported: 0,
                            failed: 0,
                        },
                    });
                    continue;
                }

                hasPending = true;
                const mappedItems = UI.mapGitHubItemsToBookmarks(incrementalItems, type)
                    .filter((item) => !UI.isBookmarkExported(item));

                if (mappedItems.length === 0) {
                    SyncState.updateGitHubState(type, {
                        watermark: SyncState.buildWatermark(incrementalItems, meta.getTime, meta.getId),
                        lastAttemptAt: typeAttemptAt,
                        lastSuccessAt: Date.now(),
                        lastOutcome: "success",
                        lastError: "",
                        lastStats: {
                            scanned: items.length,
                            pending: incrementalItems.length,
                            exported: 0,
                            failed: 0,
                        },
                    });
                    continue;
                }

                const result = await UI.exportGitHubSelected(mappedItems, {
                    apiKey: settings.apiKey,
                    databaseId: settings.databaseId,
                    token: settings.token,
                }, (current, total, title) => {
                    GitHubAutoImporter.updateStatus(`📬 GitHub ${meta.label} 导入中 (${current}/${total}): ${title}`);
                });

                successCount += result.success.length;
                failedCount += result.failed.length;

                const successKeys = new Set(
                    (result.success || []).map((entry) => String(entry.itemKey || "")).filter(Boolean)
                );
                const successfulItems = mappedItems
                    .filter((item) => successKeys.has(String(item.itemKey || "")))
                    .map((item) => item.raw);

                const typeStatePatch = {
                    lastAttemptAt: typeAttemptAt,
                    lastOutcome: result.failed.length > 0
                        ? (result.success.length > 0 ? "partial" : "error")
                        : "success",
                    lastError: result.success.length === 0 && result.failed.length > 0
                        ? `${meta.label} 导出失败 ${result.failed.length} 项`
                        : "",
                    lastStats: {
                        scanned: items.length,
                        pending: incrementalItems.length,
                        exported: result.success.length,
                        failed: result.failed.length,
                    },
                };

                if (successfulItems.length > 0) {
                    const successfulIds = new Set(successfulItems.map((item) => meta.getId(item)));
                    const leadingSuccessfulItems = SyncState.takeLeadingItems(
                        incrementalItems,
                        (item) => {
                            const itemKey = meta.getId(item);
                            if (successfulIds.has(itemKey)) return true;
                            const mapped = mappedItems.find((entry) => meta.getId(entry.raw) === itemKey);
                            return !mapped;
                        }
                    );
                    if (leadingSuccessfulItems.length > 0) {
                        typeStatePatch.watermark = SyncState.buildWatermark(leadingSuccessfulItems, meta.getTime, meta.getId);
                    }
                    typeStatePatch.lastSuccessAt = Date.now();
                }

                SyncState.updateGitHubState(type, typeStatePatch);
            } catch (error) {
                syncErrors.push(`${meta.label}: ${error.message}`);
                SyncState.updateGitHubState(type, {
                    lastAttemptAt: typeAttemptAt,
                    lastOutcome: "error",
                    lastError: error?.message || String(error),
                    lastStats: {},
                });
                console.error(`[LD-Notion] GitHub ${type} 自动导入失败:`, error);
            }
        }

        if (!hasPending && syncErrors.length === 0) {
            SyncState.updateGitHubMeta({
                lastAttemptAt: attemptAt,
                lastSuccessAt: Date.now(),
                lastOutcome: "success",
                lastError: "",
                lastStats: {
                    enabledTypes: types.length,
                    exported: 0,
                    failed: 0,
                    syncErrors: 0,
                },
            });
            GitHubAutoImporter.updateStatus(`✅ 没有新的 GitHub 收藏 (${new Date().toLocaleTimeString()})`);
            return;
        }

        if (successCount === 0 && failedCount === 0 && syncErrors.length > 0) {
            throw new Error(syncErrors[0]);
        }

        const metaStatePatch = {
            lastAttemptAt: attemptAt,
            lastOutcome: (syncErrors.length > 0 || failedCount > 0)
                ? (successCount > 0 ? "partial" : "error")
                : "success",
            lastError: syncErrors.join("；"),
            lastStats: {
                enabledTypes: types.length,
                exported: successCount,
                failed: failedCount,
                syncErrors: syncErrors.length,
            },
        };
        if (metaStatePatch.lastOutcome === "success" || successCount > 0) {
            metaStatePatch.lastSuccessAt = Date.now();
        }
        SyncState.updateGitHubMeta(metaStatePatch);

        GitHubAutoImporter.updateStatus(
            `✅ GitHub 自动导入完成: 成功 ${successCount} 项`
            + `${failedCount > 0 ? `，失败 ${failedCount} 项` : ""}`
            + `${syncErrors.length > 0 ? `，异常 ${syncErrors.length} 类` : ""}`
            + ` (${new Date().toLocaleTimeString()})`
        );
    } catch (error) {
        console.error("[LD-Notion] GitHub 自动导入出错:", error);
        SyncState.updateGitHubMeta({
            lastAttemptAt: attemptAt,
            lastOutcome: "error",
            lastError: error?.message || String(error),
            lastStats: {
                enabledTypes: (GitHubAPI.getImportTypes() || []).length,
                exported: 0,
                failed: 0,
                syncErrors: 1,
            },
        });
        GitHubAutoImporter.updateStatus(`❌ GitHub 自动导入出错: ${error.message}`);
    } finally {
        GitHubAutoImporter.isRunning = false;
        if (typeof UI !== "undefined" && typeof UI.renderSyncCenterSummary === "function") {
            try { UI.renderSyncCenterSummary(); } catch {}
        }
    }
};

const GitHubAPI = {
    _readmeCache: {},
    _fetchPaginated: (url, token = "", label = "GitHub", options = {}) => {
        return new Promise((resolve, reject) => {
            const allItems = [];
            let page = 1;
            const perPage = 100;

            const fetchPage = () => {
                const separator = url.includes("?") ? "&" : "?";
                const pagedUrl = `${url}${separator}per_page=${perPage}&page=${page}`;

                const headers = {
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "LD-Notion-UserScript",
                };
                if (token) headers["Authorization"] = `Bearer ${token}`;
                if (options.headers && typeof options.headers === "object") {
                    Object.assign(headers, options.headers);
                }

                GM_xmlhttpRequest({
                    method: "GET",
                    url: pagedUrl,
                    headers,
                    onload: (response) => {
                        if (response.status === 200) {
                            try {
                                const items = JSON.parse(response.responseText);
                                if (items.length === 0) return resolve(allItems);
                                allItems.push(...items);
                                if (items.length < perPage) return resolve(allItems);
                                page++;
                                setTimeout(fetchPage, 300);
                            } catch (e) {
                                reject(new Error(`解析 ${label} 响应失败`));
                            }
                        } else if (response.status === 403) {
                            reject(new Error(`${label} API 速率限制，请稍后再试或配置 Token`));
                        } else if (response.status === 404) {
                            reject(new Error(`${label} 资源不存在`));
                        } else {
                            reject(new Error(`${label} API 错误: ${response.status}`));
                        }
                    },
                    onerror: () => reject(new Error(`网络错误，无法连接 ${label}`)),
                    timeout: 30000,
                    ontimeout: () => reject(new Error("GitHub API 请求超时")),
                });
            };

            fetchPage();
        });
    },

    // 获取用户 starred repos（带分页）
    fetchStarredRepos: async (username, token = "") => {
        const url = token
            ? `https://api.github.com/user/starred?sort=created&direction=desc`
            : `https://api.github.com/users/${encodeURIComponent(username)}/starred?sort=created&direction=desc`;
        const items = await GitHubAPI._fetchPaginated(url, token, "GitHub Stars", {
            headers: {
                "Accept": "application/vnd.github.star+json, application/vnd.github+json",
            },
        });
        return items.map((item) => {
            if (item?.repo && item?.starred_at) {
                return {
                    ...item.repo,
                    starred_at: item.starred_at,
                };
            }
            return item;
        });
    },

    // 获取用户自己的仓库
    fetchUserRepos: (username, token = "") => {
        const url = token
            ? `https://api.github.com/user/repos?type=owner&sort=updated`
            : `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated`;
        return GitHubAPI._fetchPaginated(url, token, "GitHub Repos");
    },

    // 获取用户 fork 的仓库
    fetchForkedRepos: async (username, token = "") => {
        const allRepos = await GitHubAPI.fetchUserRepos(username, token);
        return allRepos.filter(r => r.fork);
    },

    // 获取用户的 Gists
    fetchUserGists: (username, token = "") => {
        const url = token
            ? `https://api.github.com/gists`
            : `https://api.github.com/users/${encodeURIComponent(username)}/gists`;
        return GitHubAPI._fetchPaginated(url, token, "GitHub Gists");
    },

    // 获取已导出的 repo 集合
    getExported: () => {
        try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, "{}")); }
        catch { return {}; }
    },

    // 获取已导出的 gist 集合
    getExportedGists: () => {
        try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, "{}")); }
        catch { return {}; }
    },

    markExported: (repoFullName) => {
        const exported = GitHubAPI.getExported();
        exported[repoFullName] = Date.now();
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, JSON.stringify(exported));
    },

    markGistExported: (gistId) => {
        const exported = GitHubAPI.getExportedGists();
        exported[gistId] = Date.now();
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, JSON.stringify(exported));
    },

    isExported: (repoFullName) => {
        return !!GitHubAPI.getExported()[repoFullName];
    },

    isGistExported: (gistId) => {
        return !!GitHubAPI.getExportedGists()[gistId];
    },

    // 获取启用的导入类型
    getImportTypes: () => {
        try {
            return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_IMPORT_TYPES, CONFIG.DEFAULTS.githubImportTypes));
        } catch {
            return ["stars"];
        }
    },

    setImportTypes: (types) => {
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_IMPORT_TYPES, JSON.stringify(types));
    },

    fetchRepoReadme: (repoFullName, token = "") => {
        if (!repoFullName) return Promise.resolve("");
        const cacheKey = `${repoFullName}::${token ? "auth" : "anon"}`;
        if (Object.prototype.hasOwnProperty.call(GitHubAPI._readmeCache, cacheKey)) {
            return Promise.resolve(GitHubAPI._readmeCache[cacheKey]);
        }

        return new Promise((resolve, reject) => {
            const headers = {
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "LD-Notion-UserScript",
            };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: `https://api.github.com/repos/${repoFullName}/readme`,
                headers,
                onload: (response) => {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText || "{}");
                            const decoded = Utils.base64DecodeUnicode(data.content || "");
                            const text = String(decoded || "").replace(/\r\n/g, "\n");
                            GitHubAPI._readmeCache[cacheKey] = text;
                            resolve(text);
                            return;
                        } catch {
                            GitHubAPI._readmeCache[cacheKey] = "";
                            resolve("");
                            return;
                        }
                    }
                    GitHubAPI._readmeCache[cacheKey] = "";
                    resolve("");
                },
                onerror: () => {
                    GitHubAPI._readmeCache[cacheKey] = "";
                    resolve("");
                },
                timeout: 15000,
                ontimeout: () => {
                    GitHubAPI._readmeCache[cacheKey] = "";
                    resolve(""); // 超时降级为空，与其他错误路径一致
                },
            });
        });
    },
};

// ===========================================
// GitHub 导出到 Notion 模块
// ===========================================
const GitHubExporter = {
    normalizeText: (text, maxLen = 280) => {
        if (!text) return "";
        const normalized = String(text).replace(/\s+/g, " ").trim();
        return normalized.substring(0, maxLen);
    },

    composeTitleWithPrefix: (prefix, candidate, maxLen = 180) => {
        const safePrefix = GitHubExporter.normalizeText(prefix, maxLen);
        const safeCandidate = GitHubExporter.normalizeText(candidate, maxLen);
        if (!safePrefix) return safeCandidate || "无标题";
        if (!safeCandidate || safeCandidate === safePrefix) return safePrefix;
        if (safeCandidate.startsWith(`${safePrefix} - `) || safeCandidate.startsWith(`${safePrefix} · `)) {
            return safeCandidate.substring(0, maxLen);
        }
        return `${safePrefix} · ${safeCandidate}`.substring(0, maxLen);
    },

    extractReadmeInsight: (readmeText = "") => {
        const text = String(readmeText || "").replace(/\r\n/g, "\n");
        if (!text) return { title: "", summary: "" };

        const headingMatch = text.match(/^#{1,3}\s+(.+)$/m);
        const title = GitHubExporter.normalizeText(headingMatch?.[1] || "", 120);

        const lines = text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("#") && !line.startsWith("```"));
        const summary = GitHubExporter.normalizeText(lines.slice(0, 8).join(" "), 320);

        return { title, summary };
    },

    inferRepoCategoryHeuristic: (repo, insight, categories = []) => {
        const available = (categories || []).map(c => String(c || "").trim()).filter(Boolean);
        if (available.length === 0) return "";

        const text = `${repo.full_name || ""} ${repo.name || ""} ${repo.description || ""} ${(repo.topics || []).join(" ")} ${repo.language || ""} ${insight.title || ""} ${insight.summary || ""}`.toLowerCase();
        for (const cat of available) {
            if (text.includes(cat.toLowerCase())) return cat;
        }

        const rules = [
            { keys: ["llm", "openai", "anthropic", "prompt", "rag", "ai", "agent"], hints: ["ai", "人工智能"] },
            { keys: ["react", "vue", "next", "svelte", "frontend", "ui", "css", "tailwind"], hints: ["前端", "ui"] },
            { keys: ["node", "express", "fastapi", "backend", "server", "api", "spring"], hints: ["后端", "服务端", "api"] },
            { keys: ["devops", "docker", "kubernetes", "k8s", "terraform", "ci", "cd"], hints: ["运维", "devops"] },
            { keys: ["docs", "guide", "tutorial", "awesome", "resource", "学习", "教程"], hints: ["文档", "资源", "学习"] },
        ];

        for (const rule of rules) {
            if (!rule.keys.some(k => text.includes(k))) continue;
            const matched = available.find(cat => rule.hints.some(h => cat.toLowerCase().includes(h.toLowerCase())));
            if (matched) return matched;
        }

        const fallback = available.find(cat => cat.includes("其他"));
        return fallback || available[available.length - 1];
    },

    inferRepoTags: (repo, insight) => {
        const tags = [];
        const pushTag = (value) => {
            const clean = GitHubExporter.normalizeText(value, 80);
            if (!clean) return;
            if (tags.includes(clean)) return;
            tags.push(clean);
        };

        (repo.topics || []).forEach(pushTag);
        pushTag(repo.language || "");

        const owner = String(repo.full_name || "").split("/")[0] || "";
        pushTag(owner);

        const lowerText = `${insight.title || ""} ${insight.summary || ""}`.toLowerCase();
        const keywordTags = ["ai", "llm", "rag", "agent", "react", "vue", "nextjs", "nodejs", "python", "rust", "go", "docker", "kubernetes", "notion", "github", "automation"];
        keywordTags.forEach((kw) => {
            if (lowerText.includes(kw)) pushTag(kw);
        });

        return tags.slice(0, 20);
    },

    generateAIRepoCategory: async (repo, insight, settings) => {
        const categories = Array.isArray(settings?.categories) ? settings.categories.filter(Boolean) : [];
        if (!settings?.aiApiKey || !settings?.aiService || categories.length === 0) return "";

        try {
            return await AIService.classify(
                `${repo.full_name || repo.name || ""} ${insight.title || ""}`,
                `${repo.description || ""}\n${insight.summary || ""}`,
                categories,
                settings
            );
        } catch {
            return "";
        }
    },

    enrichRepo: async (repo, settings, context = {}) => {
        const enriched = { ...repo };
        const prefix = GitHubExporter.normalizeText(repo.full_name || repo.name || "", 120) || "无标题";
        let insight = { title: "", summary: "" };

        try {
            const readme = await GitHubAPI.fetchRepoReadme(repo.full_name, settings?.token || "");
            insight = GitHubExporter.extractReadmeInsight(readme);
        } catch {
            insight = { title: "", summary: "" };
        }

        const defaultSuffix = insight.title || GitHubExporter.normalizeText(repo.description || "", 80);
        enriched.generatedTitle = GitHubExporter.composeTitleWithPrefix(prefix, defaultSuffix, 180);

        let inferredCategory = GitHubExporter.inferRepoCategoryHeuristic(repo, insight, settings?.categories || []);
        const canUseAI = !!(settings?.aiApiKey && settings?.aiService);
        const aiMaxItems = Number.isFinite(context.aiMaxItems) ? context.aiMaxItems : 20;
        if (canUseAI && (context.aiUsedCount || 0) < aiMaxItems) {
            const aiCategory = await GitHubExporter.generateAIRepoCategory(repo, insight, settings);
            if (aiCategory) inferredCategory = aiCategory;
            context.aiUsedCount = (context.aiUsedCount || 0) + 1;
        }

        enriched.inferredCategory = inferredCategory;
        enriched.inferredTags = GitHubExporter.inferRepoTags(repo, insight);
        enriched.readmeSummary = GitHubExporter.normalizeText(insight.summary || "", 1000);
        return enriched;
    },

    // 构建 Notion 数据库属性 (repos/stars/forks)
    buildRepoProperties: (repo, sourceType = "Star") => {
        const titlePrefix = GitHubExporter.normalizeText(repo.full_name || repo.name || "无标题", 120) || "无标题";
        const titleContent = GitHubExporter.composeTitleWithPrefix(titlePrefix, repo.generatedTitle || "", 2000);
        const summaryText = GitHubExporter.normalizeText(repo.readmeSummary || "", 1600);
        const descCandidate = GitHubExporter.normalizeText(repo.description || "", 1200);
        const description = [descCandidate, summaryText].filter(Boolean).join("\n\n").substring(0, 2000);
        const props = {
            "标题": {
                title: [{ text: { content: titleContent } }]
            },
            "链接": {
                url: repo.html_url
            },
            "描述": {
                rich_text: [{ text: { content: description } }]
            },
            "语言": {
                rich_text: [{ text: { content: repo.language || "" } }]
            },
            "Stars": {
                number: repo.stargazers_count || 0
            },
            "来源": {
                rich_text: [{ text: { content: "GitHub" } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: sourceType } }]
            },
        };
        const topicTags = Array.isArray(repo.topics) ? repo.topics.slice(0, 20) : [];
        const inferredTags = Array.isArray(repo.inferredTags) ? repo.inferredTags : [];
        const mergedTags = [];
        [...topicTags, ...inferredTags].forEach((tag) => {
            const clean = GitHubExporter.normalizeText(tag, 100);
            if (!clean) return;
            if (mergedTags.includes(clean)) return;
            mergedTags.push(clean);
        });
        if (mergedTags.length > 0) {
            props["标签"] = {
                multi_select: mergedTags.slice(0, 20).map(t => ({ name: t }))
            };
        }
        if (repo.inferredCategory) {
            props["分类"] = {
                rich_text: [{ text: { content: GitHubExporter.normalizeText(repo.inferredCategory, 300) } }]
            };
        }
        if (repo.pushed_at) {
            props["更新时间"] = { date: { start: repo.pushed_at } };
        }
        return props;
    },

    // 构建 Gist 属性
    buildGistProperties: (gist) => {
        const files = Object.keys(gist.files || {});
        const title = gist.description || files[0] || "无标题 Gist";
        const language = gist.files?.[files[0]]?.language || "";
        return {
            "标题": {
                title: [{ text: { content: title.substring(0, 2000) } }]
            },
            "链接": {
                url: gist.html_url
            },
            "描述": {
                rich_text: [{ text: { content: `文件: ${files.join(", ")}`.substring(0, 2000) } }]
            },
            "语言": {
                rich_text: [{ text: { content: language } }]
            },
            "Stars": {
                number: 0
            },
            "来源": {
                rich_text: [{ text: { content: "GitHub" } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: "Gist" } }]
            },
            "更新时间": gist.updated_at ? { date: { start: gist.updated_at } } : undefined,
        };
    },

    // 向后兼容：原 buildProperties 映射到 buildRepoProperties
    buildProperties: (repo) => GitHubExporter.buildRepoProperties(repo, "Star"),

    // 配置数据库属性结构
    setupDatabaseProperties: async (databaseId, apiKey) => {
        const requiredProperties = {
            "标题": { typeName: "title", schema: { title: {} } },
            "链接": { typeName: "url", schema: { url: {} } },
            "描述": { typeName: "rich_text", schema: { rich_text: {} } },
            "语言": { typeName: "rich_text", schema: { rich_text: {} } },
            "Stars": { typeName: "number", schema: { number: { format: "number" } } },
            "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
            "来源": { typeName: "rich_text", schema: { rich_text: {} } },
            "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
            "更新时间": { typeName: "date", schema: { date: {} } },
            "分类": { typeName: "rich_text", schema: { rich_text: {} } },
        };

        try {
            const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
            const existingProps = database.properties || {};
            const propsToAdd = {};
            const propsToUpdate = {};
            const typeConflicts = [];

            for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                const existingProp = existingProps[name];
                if (!existingProp) {
                    if (typeName === "title") {
                        // 特殊处理：title 属性需要重命名现有的
                        const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                        if (existingTitle && existingTitle[0] !== name) {
                            propsToUpdate[existingTitle[0]] = { name: name };
                        }
                    } else {
                        propsToAdd[name] = schema;
                    }
                } else if (existingProp.type !== typeName) {
                    typeConflicts.push({ name, expected: typeName, actual: existingProp.type });
                }
            }

            if (typeConflicts.length > 0) {
                const details = typeConflicts.map(c => `"${c.name}": 期望 ${c.expected}，实际 ${c.actual}`).join("; ");
                return { success: false, error: `属性类型不匹配: ${details}。请手动修改这些属性的类型。` };
            }

            const allChanges = { ...propsToAdd, ...propsToUpdate };
            if (Object.keys(allChanges).length > 0) {
                await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                    properties: allChanges,
                }, apiKey);
            }

            return { success: true, added: Object.keys(propsToAdd), renamed: Object.keys(propsToUpdate) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // 通用导出方法
    _exportItems: async (items, settings, sourceType, buildFn, isExportedFn, markExportedFn, getKeyFn, onProgress) => {
        const { apiKey, databaseId } = settings;
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        const newItems = items.filter(item => !isExportedFn(getKeyFn(item)));
        if (newItems.length === 0) {
            return { total: items.length, exported: 0, failed: 0, message: `没有新的 ${sourceType} 需要导出` };
        }

        let success = 0, failed = 0;
        const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };
        for (let i = 0; i < newItems.length; i++) {
            const item = newItems[i];
            const key = getKeyFn(item);
            const pct = Math.round(10 + (i / newItems.length) * 85);
            if (onProgress) onProgress(`正在导出 ${sourceType} (${i + 1}/${newItems.length}): ${key}`, pct);

            try {
                const enriched = sourceType === "Gist" ? item : await GitHubExporter.enrichRepo(item, settings, enrichContext);
                const properties = buildFn(enriched);
                // 清理 undefined 属性
                for (const k of Object.keys(properties)) {
                    if (properties[k] === undefined) delete properties[k];
                }
                await NotionAPI.request("POST", "/pages", {
                    parent: { database_id: databaseId },
                    properties,
                }, apiKey);
                markExportedFn(key);
                success++;
            } catch (e) {
                console.warn(`[GitHubExporter] 导出失败: ${key}`, e);
                failed++;
            }

            if (i < newItems.length - 1) {
                await new Promise(r => setTimeout(r, delay));
            }
        }

        return { total: items.length, exported: success, failed, newCount: newItems.length };
    },

    // 导出 stars 到 Notion
    exportStars: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        const setupResult = await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);
        if (!setupResult.success) {
            throw new Error(`数据库配置失败: ${setupResult.error}`);
        }

        if (onProgress) onProgress("正在获取 GitHub Stars...", 5);
        const repos = await GitHubAPI.fetchStarredRepos(username, token);

        return GitHubExporter._exportItems(
            repos, settings, "Star",
            (r) => GitHubExporter.buildRepoProperties(r, "Star"),
            GitHubAPI.isExported, GitHubAPI.markExported,
            (r) => r.full_name, onProgress
        );
    },

    // 导出用户仓库到 Notion
    exportRepos: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

        if (onProgress) onProgress("正在获取 GitHub Repos...", 5);
        const repos = await GitHubAPI.fetchUserRepos(username, token);
        const ownRepos = repos.filter(r => !r.fork);

        return GitHubExporter._exportItems(
            ownRepos, settings, "Repo",
            (r) => GitHubExporter.buildRepoProperties(r, "Repo"),
            GitHubAPI.isExported, GitHubAPI.markExported,
            (r) => r.full_name, onProgress
        );
    },

    // 导出 fork 的仓库到 Notion
    exportForks: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

        if (onProgress) onProgress("正在获取 GitHub Forks...", 5);
        const forks = await GitHubAPI.fetchForkedRepos(username, token);

        return GitHubExporter._exportItems(
            forks, settings, "Fork",
            (r) => GitHubExporter.buildRepoProperties(r, "Fork"),
            GitHubAPI.isExported, GitHubAPI.markExported,
            (r) => r.full_name, onProgress
        );
    },

    // 导出 Gists 到 Notion
    exportGists: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

        if (onProgress) onProgress("正在获取 GitHub Gists...", 5);
        const gists = await GitHubAPI.fetchUserGists(username, token);

        return GitHubExporter._exportItems(
            gists, settings, "Gist",
            GitHubExporter.buildGistProperties,
            GitHubAPI.isGistExported, GitHubAPI.markGistExported,
            (g) => g.id, onProgress
        );
    },

    // 按用户选择的类型批量导出
    exportAll: async (settings, onProgress) => {
        const types = GitHubAPI.getImportTypes();
        const results = {};
        const totalTypes = types.length;
        let typeIndex = 0;

        for (const type of types) {
            const typeProgress = (msg, pct) => {
                const overallPct = Math.round((typeIndex / totalTypes) * 100 + pct / totalTypes);
                if (onProgress) onProgress(`[${type}] ${msg}`, overallPct);
            };

            try {
                switch (type) {
                    case "stars":
                        results.stars = await GitHubExporter.exportStars(settings, typeProgress);
                        break;
                    case "repos":
                        results.repos = await GitHubExporter.exportRepos(settings, typeProgress);
                        break;
                    case "forks":
                        results.forks = await GitHubExporter.exportForks(settings, typeProgress);
                        break;
                    case "gists":
                        results.gists = await GitHubExporter.exportGists(settings, typeProgress);
                        break;
                }
            } catch (e) {
                results[type] = { error: e.message };
            }
            typeIndex++;
        }

        return results;
    },

    // AI 分类已导出的 GitHub repos
    classifyRepos: async (settings, onProgress) => {
        const { apiKey, databaseId, aiApiKey, aiService, aiModel, aiBaseUrl, categories } = settings;

        if (!apiKey || !databaseId) throw new Error("请先配置 Notion 数据库");
        if (!aiApiKey) throw new Error("请先配置 AI API Key");

        if (onProgress) onProgress("正在获取待分类的仓库...", 0);

        // 查询数据库中未分类的条目
        const response = await NotionAPI.request("POST", `/databases/${databaseId}/query`, {
            filter: {
                or: [
                    { property: "分类", rich_text: { is_empty: true } },
                    { property: "分类", rich_text: { equals: "" } },
                ]
            },
            page_size: 100,
        }, apiKey);

        const pages = response.results || [];
        if (pages.length === 0) {
            return { classified: 0, message: "没有待分类的仓库" };
        }

        let classified = 0;
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const pct = Math.round((i / pages.length) * 100);
            const title = page.properties?.["标题"]?.title?.[0]?.text?.content || "";
            const desc = page.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";
            const lang = page.properties?.["语言"]?.rich_text?.[0]?.text?.content || "";
            const tags = (page.properties?.["标签"]?.multi_select || []).map(t => t.name).join(", ");

            if (onProgress) onProgress(`正在分类 (${i + 1}/${pages.length}): ${title}`, pct);

            try {
                const prompt = `请根据以下 GitHub 仓库信息，从这些分类中选择最合适的一个: [${categories.join(", ")}]

仓库名: ${title}
描述: ${desc}
语言: ${lang}
标签: ${tags}

只回复分类名，不要其他内容。`;

                const category = await AIService.request(prompt, {
                    aiService, aiApiKey, aiModel: aiModel, aiBaseUrl,
                });

                const matched = categories.find(c => category.trim().includes(c)) || category.trim();

                await NotionAPI.request("PATCH", `/pages/${page.id}`, {
                    properties: {
                        "分类": { rich_text: [{ text: { content: matched } }] },
                    },
                }, apiKey);
                classified++;
            } catch (e) {
                console.warn(`[GitHubExporter] 分类失败: ${title}`, e);
            }

            await new Promise(r => setTimeout(r, 500));
        }

        return { classified, total: pages.length };
    },
};

module.exports = { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter };
