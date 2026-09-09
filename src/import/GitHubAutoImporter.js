"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { NotionOAuth } = require("../auth");
const { GitHubAPI } = require("./GitHubAPI");
const { NotionAPI } = require("../api");
const { emit } = require("../coordination/event-bus");
const { SyncLock } = require("../sync-lock");

const GitHubAutoImporter = {
    isRunning: false,
    timerId: null,
    initTimerId: null,
    deferredWhileHidden: false,
    visibilityListenerBound: false,
    lastRunAt: 0,
    minimumRunGapMs: 60 * 1000,

    canStart: () => {
        if (!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, false)) return false;
        const username = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
        const token = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
        if (!username && !token) return false;
        const apiKey = NotionOAuth.getAccessToken("");
        const databaseId = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
        return !!(apiKey && databaseId);
    },

    updateStatus: (text) => {
        const el = document.querySelector("#ldb-auto-import-status");
        if (el) el.textContent = text;
    },

    buildSettings: () => {
        return {
            apiKey: NotionOAuth.getAccessToken(""),
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
                Utils.runWhenBrowserIdle(() => {
                    // 2/3 共识(dsf+qwen): 回调排队期间可能已被禁用, 执行前复核
                    if (!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, false)) return;
                    GitHubAutoImporter.run();
                });
            }
        });
        GitHubAutoImporter.visibilityListenerBound = true;
    },


    startPolling: (intervalMinutes) => {
        // 统一委托给 SyncScheduler (消除双定时器)
        // F-UI-03:显式间隔传入,不再被存储键默认值覆盖
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        const types = GitHubAPI.getImportTypes();
        for (const type of types) {
            SyncScheduler.start(`github-${type}`, intervalMinutes);
        }
    },

    stopPolling: () => {
        // 2/3 共识(dsf+qwen): 清理 init 的 3s 延迟启动, 否则禁用后延迟回调仍 run + 复活轮询
        if (GitHubAutoImporter.initTimerId) {
            clearTimeout(GitHubAutoImporter.initTimerId);
            GitHubAutoImporter.initTimerId = null;
        }
        GitHubAutoImporter.deferredWhileHidden = false;
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        const types = GitHubAPI.getImportTypes();
        for (const type of types) {
            SyncScheduler.stop(`github-${type}`);
        }
    },

    init: () => {
        if (!GitHubAutoImporter.canStart()) return;
        GitHubAutoImporter.ensureVisibilityListener();
        if (GitHubAutoImporter.initTimerId) clearTimeout(GitHubAutoImporter.initTimerId);
        GitHubAutoImporter.initTimerId = setTimeout(() => {
            GitHubAutoImporter.initTimerId = null;
            // 延迟窗口内可能已被禁用
            if (!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, false)) return;
            Utils.runWhenBrowserIdle(() => {
                // 2/3 共识: idle 回调排队期间可能已被禁用(外层检查只覆盖 3s 延迟窗口)
                if (!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, false)) return;
                GitHubAutoImporter.run();
            });
            const interval = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.githubAutoImportInterval);
            if (interval > 0) GitHubAutoImporter.startPolling(interval);
        }, 3000);
    },
};

// ===========================================
// GitHub API 模块
// ===========================================

// 将 GitHub item 映射为统一 bookmark 结构（MNT-001 提取自 run）
GitHubAutoImporter._mapItemsToBookmarks = (incrementalItems, type, meta) => {
    // 事件总线解耦：不再通过 _resolveUI 取 UI.mapGitHubItemsToBookmarks，
    // 统一使用本地映射逻辑（与 UI 层 mapGitHubItemsToBookmarks 等价）。
    return incrementalItems.map((item) => ({
        itemKey: meta.getId(item),
        raw: item,
        title: item.full_name || item.name || "",
        url: item.html_url || "",
        description: item.description || "",
        tags: item.language ? [`lang:${item.language}`] : [],
        source: "github",
        sourceType: type,
    }));
};

// 无 UI 降级路径：直接调用 GitHubExporter 导出（MNT-001 提取自 run）
GitHubAutoImporter._exportViaGitHubExporter = async (mappedItems, type, meta, settings) => {
    const { GitHubExporter } = require("./GitHubExporter");
    const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
    const successEntries = [];
    const failedEntries = [];
    const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };
    // 重置增量基线后 watermark 回退会再次扫到已导出项; 手动路径 GitHubExporter
    // 有 isExported 过滤, 自动路径此前缺失 → 重复建 Notion 页。已导出项计入 success
    // 仅用于推进 watermark(不建页、不计入「新增」语义由调用方用 length 区分时可再拆)。
    const toExport = [];
    for (const item of mappedItems) {
        const itemKey = item.itemKey || (item.raw ? meta.getId(item.raw) : "");
        if (itemKey) {
            const already = type === "gists"
                ? GitHubAPI.isGistExported(itemKey)
                : GitHubAPI.isExported(itemKey);
            if (already) {
                successEntries.push({ itemKey, skippedExisting: true });
                continue;
            }
        }
        toExport.push(item);
    }
    try {
    for (let i = 0; i < toExport.length; i++) {
        const item = toExport[i];
        const itemKey = item.itemKey || (item.raw ? meta.getId(item.raw) : "");
        try {
            const raw = item.raw || item;
            // createDatabasePage level 1，canExecute 非阻塞闸门 + 审计（C1 审计完整性）。
            const { OperationGuard, OperationLog } = require("../security");
            if (!OperationGuard.canExecute("createDatabasePage")) {
                OperationLog.add({
                    audit_event: OperationLog.inferAuditEvent("createDatabasePage", "denied"),
                    actor: "system", source: "github-auto-sync",
                    operationName: "createDatabasePage", status: "denied",
                    context: { itemKey, itemName: meta.getId(raw), reason: "权限不足：GitHub 自动同步建页需 level≥1" },
                });
                failedEntries.push({ itemKey, title: item.title || itemKey });
                continue;
            }
            const enriched = await GitHubExporter.enrichRepo(raw, settings, enrichContext);
            const buildFn = type === "gists"
                ? GitHubExporter.buildGistProperties
                : (r) => GitHubExporter.buildRepoProperties(r, meta.label);
            const properties = buildFn(enriched);
            for (const k of Object.keys(properties)) {
                if (properties[k] === undefined) delete properties[k];
            }
            // 每项开工前重读最新 token（OAuth 续签后快照失效；与 LinuxDo AutoImporter 同构）
            settings.apiKey = NotionOAuth.getAccessToken("");
            const page = await NotionAPI.request("POST", "/pages", {
                parent: { database_id: settings.databaseId },
                properties,
            }, settings.apiKey);
            OperationLog.add({
                audit_event: OperationLog.inferAuditEvent("createDatabasePage", "success"),
                actor: "system", source: "github-auto-sync",
                operationName: "createDatabasePage", status: "success",
                context: { pageId: String(page?.id || "").trim(), itemKey, itemName: meta.getId(raw), databaseId: settings.databaseId },
            });
            if (type === "gists") {
                GitHubAPI.markGistExported(meta.getId(raw));
            } else {
                GitHubAPI.markExported(meta.getId(raw));
            }
            successEntries.push({ itemKey });
        } catch (e) {
            console.warn(`[GitHubAutoImporter] 导出失败: ${itemKey}`, e);
            try {
                const { OperationLog } = require("../security");
                OperationLog.add({
                    audit_event: OperationLog.inferAuditEvent("createDatabasePage", "failed"),
                    actor: "system", source: "github-auto-sync",
                    operationName: "createDatabasePage", status: "failed",
                    context: { itemKey, reason: String(e?.message || e) },
                });
            } catch (_) { /* 审计失败不阻断降级 */ }
            failedEntries.push({ itemKey, title: item.title || itemKey });
        }
        if (i < toExport.length - 1) {
            await Utils.sleep(delay);
        }
    }
    } finally {
    // 批量回写已导出映射（DISCOVER P3 / CC-10）：循环内 markExported 仅 mutate 内存缓存，
    // finally 单次 flush —— 异常/中止路径也不丢已导出事实(与 GitHubExporter._exportItems 同构)。
    GitHubAPI.flushExported();
    GitHubAPI.flushGistsExported();
    }
    const createdEntries = successEntries.filter((e) => !e.skippedExisting);
    return {
        success: successEntries, // 含 skippedExisting, 供 watermark 推进
        created: createdEntries,
        failed: failedEntries,
    };
};

GitHubAutoImporter._exportMappedItems = async (mappedItems, type, meta, settings) => {
    return await GitHubAutoImporter._exportViaGitHubExporter(mappedItems, type, meta, settings);
};

// 汇总单类型同步结果与 watermark（MNT-001 提取自 run 的循环体）
GitHubAutoImporter._syncSingleType = async (type, settings, attemptAt) => {
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
            return { pending: false, success: 0, failed: 0 };
        }

        const mappedItems = GitHubAutoImporter._mapItemsToBookmarks(incrementalItems, type, meta);

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
            return { pending: true, success: 0, failed: 0 };
        }

        const result = await GitHubAutoImporter._exportMappedItems(mappedItems, type, meta, settings);

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
                exported: (result.created || result.success.filter((e) => !e.skippedExisting)).length,
                failed: result.failed.length,
                skippedExisting: result.success.filter((e) => e.skippedExisting).length,
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
        const createdCount = (result.created || result.success.filter((e) => !e.skippedExisting)).length;
        return { pending: true, success: createdCount, failed: result.failed.length };
    } catch (error) {
        SyncState.updateGitHubState(type, {
            lastAttemptAt: typeAttemptAt,
            lastOutcome: "error",
            lastError: error?.message || String(error),
            lastStats: {},
        });
        console.error(`[LD-Notion] GitHub ${type} 自动导入失败:`, error);
        return { pending: false, success: 0, failed: 0, syncError: `${meta.label}: ${error.message}` };
    }
};

// 汇总元状态并展示完成提示（MNT-001 提取自 run）
GitHubAutoImporter._aggregateMetaState = (types, successCount, failedCount, syncErrors, attemptAt) => {
    if (!syncErrors.length && successCount === 0 && failedCount === 0) {
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
};

GitHubAutoImporter.run = async () => {
    if (document.hidden) {
        GitHubAutoImporter.deferredWhileHidden = true;
        return;
    }
    if (GitHubAutoImporter.isRunning) return;
    // 全盘审计修复(find 10): 其余三个自动导入器均有 SyncLock.isExporting 互斥,
    // GitHub 手动导出(GitHubExporter 批量写)与自动导入并发打 Notion → 速率竞争+潜在重复写入
    if (SyncLock.isExporting) return;

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

    // 2/3 共识(qwen+dsf): 仅读 isExporting 而不上锁 —— 自动导入进入异步写页后
    // 手动导出可并发启动(检查时仍为 false), 两路竞速写 Notion/互相覆盖导出标记。
    // 与 Bookmark/RSS/export 同构: 取跨 tab 租约 + 占用进程内互斥, finally 释放。
    let lease = null;
    try {
        lease = await SyncLock.acquireLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE);
    } catch (leaseError) {
        GitHubAutoImporter.isRunning = false;
        SyncLock.isExporting = false;
        console.error("[LD-Notion] GitHub 自动导入获取租约失败:", leaseError);
        GitHubAutoImporter.updateStatus("❌ 获取同步租约失败，本轮跳过");
        return;
    }
    if (!lease) {
        GitHubAutoImporter.isRunning = false;
        GitHubAutoImporter.updateStatus("⏸ 其他标签页正在同步，本轮 GitHub 同步跳过");
        return;
    }
    SyncLock.isExporting = true;
    let leaseLost = false;
    const renewTimer = setInterval(() => {
        let renewed;
        try {
            renewed = SyncLock.renewLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);
        } catch (renewError) {
            console.warn("[LD-Notion] GitHub 自动导入续约失败:", renewError);
            renewed = false;
        }
        if (!renewed) {
            leaseLost = true;
            clearInterval(renewTimer);
        }
    }, 30000);

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
        const syncErrors = [];

        for (const type of types) {
            // 租约被他 tab 接管: 不再开工新类型, 避免双持有并发写
            if (leaseLost) break;
            const r = await GitHubAutoImporter._syncSingleType(type, settings, attemptAt);
            successCount += r.success;
            failedCount += r.failed;
            if (r.syncError) syncErrors.push(r.syncError);
        }

        const hasPending = successCount > 0 || failedCount > 0;
        if (!hasPending && syncErrors.length === 0) {
            GitHubAutoImporter._aggregateMetaState(types, 0, 0, [], attemptAt);
            return;
        }

        GitHubAutoImporter._aggregateMetaState(types, successCount, failedCount, syncErrors, attemptAt);
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
        clearInterval(renewTimer);
        SyncLock.releaseLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);
        SyncLock.isExporting = false;
        GitHubAutoImporter.isRunning = false;
        // v3.14.7 (REV-06): 补 emit bookmarks:updated——收藏列表唯一自动重渲染触发是
        // bookmarks:updated(main-ui.js:2638-2642), 此前只 emit sync:center-summary-updated
        // 导致 GitHub 新建页面后 UI 仍显示「待导出」, 严格模式手动导出被静默过滤。
        emit("bookmarks:updated");
        emit("sync:center-summary-updated");
    }
};

module.exports = { GitHubAutoImporter };
