"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { GitHubAPI } = require("./GitHubAPI");
const { NotionAPI } = require("../api");

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
        if (typeof UI === "undefined" || !UI) return;
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
                let mappedItems;
                if (typeof UI !== "undefined" && UI && typeof UI.mapGitHubItemsToBookmarks === "function") {
                    mappedItems = UI.mapGitHubItemsToBookmarks(incrementalItems, type)
                        .filter((item) => typeof UI !== "undefined" && UI && typeof UI.isBookmarkExported === "function" ? !UI.isBookmarkExported(item) : true);
                } else {
                    mappedItems = incrementalItems.map((item) => ({
                        itemKey: meta.getId(item),
                        raw: item,
                        title: item.full_name || item.name || "",
                        url: item.html_url || "",
                        description: item.description || "",
                        tags: item.language ? [`lang:${item.language}`] : [],
                        source: "github",
                        sourceType: type,
                    }));
                }

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

                let result;
                if (typeof UI !== "undefined" && UI && typeof UI.exportGitHubSelected === "function") {
                    result = await UI.exportGitHubSelected(mappedItems, {
                        apiKey: settings.apiKey,
                        databaseId: settings.databaseId,
                        token: settings.token,
                    }, (current, total, title) => {
                        GitHubAutoImporter.updateStatus(`📬 GitHub ${meta.label} 导入中 (${current}/${total}): ${title}`);
                    });
                } else {
                    // 无 UI 降级路径：直接调用 GitHubExporter 导出
                    const { GitHubExporter } = require("./GitHubExporter");
                    const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
                    let success = 0, failed = 0;
                    const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };
                    for (let i = 0; i < mappedItems.length; i++) {
                        const item = mappedItems[i];
                        try {
                            const raw = item.raw || item;
                            const enriched = await GitHubExporter.enrichRepo(raw, settings, enrichContext);
                            const buildFn = type === "gists"
                                ? GitHubExporter.buildGistProperties
                                : (r) => GitHubExporter.buildRepoProperties(r, meta.label);
                            const properties = buildFn(enriched);
                            for (const k of Object.keys(properties)) {
                                if (properties[k] === undefined) delete properties[k];
                            }
                            await NotionAPI.request("POST", "/pages", {
                                parent: { database_id: settings.databaseId },
                                properties,
                            }, settings.apiKey);
                            if (type === "gists") {
                                GitHubAPI.markGistExported(meta.getId(raw));
                            } else {
                                GitHubAPI.markExported(meta.getId(raw));
                            }
                            success++;
                        } catch (e) {
                            console.warn(`[GitHubAutoImporter] 导出失败: ${item.itemKey || meta.getId(item.raw || item)}`, e);
                            failed++;
                        }
                        if (i < mappedItems.length - 1) {
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                    result = { success: new Array(success).fill({}), failed: new Array(failed).fill({}) };
                }

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

module.exports = { GitHubAutoImporter };
