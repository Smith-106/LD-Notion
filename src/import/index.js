"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { NotionOAuth } = require("../auth");
const { NotionAPI } = require("../api");
const { Exporter, LinuxDoAPI } = require("../export");
const { SyncLock } = require("../sync-lock");

const { UpdateChecker } = require("./UpdateChecker");
const { GitHubAutoImporter } = require("./GitHubAutoImporter");
const { GitHubAPI } = require("./GitHubAPI");
const { GitHubExporter } = require("./GitHubExporter");
const { emit } = require("../coordination/event-bus");

const AutoImporter = {
    isRunning: false,
    timerId: null,
    deferredWhileHidden: false,
    visibilityListenerBound: false,
    lastRunAt: 0,
    minimumRunGapMs: 60 * 1000,

    // 从 Storage 读取导出设置（不依赖 UI DOM）
    // 20260914: 新收藏判定(纯函数, 可单测) —— 远端「链接」索引是 ground truth:
    // 命中 https://linux.do/t/{id} → 库内已存在跳过; 未命中 → 导出(账本残留不阻断, 换库场景);
    // remoteUrls=null(查询失败) → 降级本地账本(旧语义)。allow_duplicates 时不做任何去重过滤。
    resolveNewBookmarks: ({ bookmarks = [], dedupStrict = true, remoteUrls = null } = {}) => {
        if (!dedupStrict) return bookmarks.slice();
        return bookmarks.filter((bookmark) => {
            const topicId = String(bookmark.topic_id || bookmark.bookmarkable_id);
            if (remoteUrls) return !remoteUrls.has(`https://linux.do/t/${topicId}`);
            return !Storage.isTopicExported(topicId);
        });
    },

    buildSettings: () => {
        const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
        return {
            // 与 Bookmark/RSS AutoImporter 对齐：经 getAccessToken 读取，避免绕过 OAuth 语义
            apiKey: NotionOAuth.getAccessToken(""),
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
        const el = document.querySelector("#ldb-auto-import-status");
        if (el) el.textContent = text;
    },

    getWatermark: (bookmarks = []) => SyncState.buildWatermark(
        bookmarks,
        LinuxDoAPI.getBookmarkSyncTime,
        LinuxDoAPI.getBookmarkId
    ),


    startPolling: (intervalMinutes) => {
        // 统一委托给 SyncScheduler (消除双定时器)
        // F-UI-03:显式间隔传入,不再被存储键默认值覆盖
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.start("linuxdo", intervalMinutes);
    },

    ensureVisibilityListener: () => {
        if (AutoImporter.visibilityListenerBound) return;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && AutoImporter.deferredWhileHidden) {
                AutoImporter.deferredWhileHidden = false;
                // P4 收敛(c09 2/3): 排队期间用户可能已关闭自动导入 —— 回调必须复核
                if (!AutoImporter.canStart()) return;
                // P4 收敛(c09): idle 回调可能延迟数秒才执行 —— 执行前再复核一次
                Utils.runWhenBrowserIdle(() => { if (AutoImporter.canStart()) AutoImporter.run(); });
            }
        });
        AutoImporter.visibilityListenerBound = true;
    },

    stopPolling: () => {
        // P4 收敛(c09 2/3): init 的延迟启动定时器必须可取消, 否则禁用后仍会跑一轮导出并复活轮询
        if (AutoImporter._initTimer) {
            clearTimeout(AutoImporter._initTimer);
            AutoImporter._initTimer = null;
        }
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.stop("linuxdo");
    },

    init: () => {
        if (!AutoImporter.canStart()) return;
        AutoImporter.ensureVisibilityListener();
        AutoImporter._initTimer = setTimeout(() => {
            AutoImporter._initTimer = null;
            // P4 收敛(c09 2/3): 3s 窗口内可能已禁用/改配置 —— 执行前复核
            if (!AutoImporter.canStart()) return;
            // P4 收敛(c09): idle 回调延迟期间可能被禁用 —— 回调内再复核
            Utils.runWhenBrowserIdle(() => { if (AutoImporter.canStart()) AutoImporter.run(); });
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

    // v3.14.13 (三模型共识): 直读改走 getAccessToken 清洗——脏值(仅不可见字符)不再假通过闸门
    const apiKey = NotionOAuth.getAccessToken("");
    if (!apiKey) {
        AutoImporter.updateStatus("请先配置 Notion API Key");
        // odyssey-debug 20260913: 配置类故障经 errors 红显(debug-notes-017)
        return { importedCount: 0, failedCount: 0, errors: ["请先配置 Notion API Key"] };
    }
    const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
    if (exportTargetType === "database" && !Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "")) {
        AutoImporter.updateStatus("请先配置 Notion 数据库 ID");
        return { importedCount: 0, failedCount: 0, errors: ["请先配置 Notion 数据库 ID"] };
    }
    if (exportTargetType === "page" && !Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "")) {
        AutoImporter.updateStatus("请先配置父页面 ID");
        return { importedCount: 0, failedCount: 0, errors: ["请先配置父页面 ID"] };
    }

    const now = Date.now();
    if (now - AutoImporter.lastRunAt < AutoImporter.minimumRunGapMs) return;
    AutoImporter.lastRunAt = now;
    AutoImporter.isRunning = true;
    // v3.14.6 (CC-03): 自动导入占用导出互斥, 防手动/AI/自动并发交错; finally 复位
    // P4 收敛(c09): 记录本 run 是否由自己置位 —— 租约失败/被占路径无条件清 false
    // 会误清并发手动导出已置位的互斥(与 GitHubAutoImporter glm P1 同型)
    const exportMutexAcquired = SyncLock.isExporting !== true;
    SyncLock.isExporting = true;
    // P4 收敛(c09): 与 GitHub/Bookmark/RSS 同构 —— 取跨 tab 租约。
    // 仅置进程内 isExporting 无法防两 tab 同时读-标记 isTopicExported 的竞态(重复建页)。
    let lease = null;
    try {
        lease = await SyncLock.acquireLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE);
    } catch (leaseError) {
        AutoImporter.isRunning = false;
        if (exportMutexAcquired) SyncLock.isExporting = false;
        console.error("[LD-Notion] 自动导入获取租约失败:", leaseError);
        AutoImporter.updateStatus("❌ 获取同步租约失败，本轮跳过");
        return;
    }
    if (!lease) {
        AutoImporter.isRunning = false;
        if (exportMutexAcquired) SyncLock.isExporting = false;
        AutoImporter.updateStatus("⏸ 其他标签页正在同步，本轮自动导入跳过");
        return;
    }
    AutoImporter._leaseLost = false;
    const renewTimer = setInterval(() => {
        let renewed;
        try {
            renewed = SyncLock.renewLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);
        } catch (renewError) {
            console.warn("[LD-Notion] 自动导入续约失败:", renewError);
            renewed = false;
        }
        if (!renewed) {
            AutoImporter._leaseLost = true;
            clearInterval(renewTimer);
        }
    }, 30000);
    const attemptAt = Date.now();
    const exportBtn = document.querySelector("#ldb-export");

    try {
        SyncState.updateLinuxDoState({
            lastAttemptAt: attemptAt,
            lastOutcome: "running",
            lastError: "",
            lastStats: {},
        });

        const username = await Utils.getCurrentLinuxDoUsernameAsync();
        if (!username) {
            const errorMessage = "无法获取当前 Linux.do 用户名";
            SyncState.updateLinuxDoState({
                lastAttemptAt: attemptAt,
                lastOutcome: "error",
                lastError: errorMessage,
                lastStats: {},
            });
            AutoImporter.updateStatus(`❌ ${errorMessage}`);
            // odyssey-debug 20260913: errors 契约对齐(debug-notes-017) — 配置类故障红显而非绿「完成 0 条」
            return { importedCount: 0, failedCount: 0, errors: [`${errorMessage}：请刷新 linux.do 页面并确认已登录后重试`] };
        }

        AutoImporter.updateStatus("📧 正在检查新收藏...");
        const syncState = SyncState.getLinuxDoState();
        const bookmarks = await LinuxDoAPI.fetchBookmarksSince(username, syncState.watermark);
        // F4 共识(模式语义一致): allow_duplicates 时跳过本地去重过滤(watermark 照常推进),
        // 与手动导入路径的 allow 语义对齐。
        const dedupStrict = Utils.isLinuxDoDedupStrict();
        // 20260914: Notion 实际状态对账(与 GitHubAutoImporter/_exportViaGitHubExporter 同构) ——
        // 远端「链接」索引是 ground truth; 查询失败降级本地账本(旧语义)。
        const settings = AutoImporter.buildSettings();
        let remoteUrls = null;
        try {
            remoteUrls = await NotionAPI.collectDatabaseUrls(settings.apiKey, settings.databaseId);
        } catch (_) { remoteUrls = null; }
        const newBookmarks = AutoImporter.resolveNewBookmarks({ bookmarks, dedupStrict, remoteUrls });

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
            return { importedCount: 0, failedCount: 0, errors: [] };
        }

        AutoImporter.updateStatus(`📬 发现 ${newBookmarks.length} 个新收藏，正在导入...`);

        if (exportBtn) exportBtn.disabled = true;
        const obsExportBtn = document.querySelector("#ldb-obs-export");
        if (obsExportBtn) obsExportBtn.disabled = true;

        // settings 已在去重对账前构建(远端索引需要 apiKey/databaseId)
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        const concurrency = settings.concurrency || 1;
        let success = 0;
        let failed = 0;
        let autoImportAborted = false; // 认证终态中止标记(v3.14.5)
        const successfulBookmarks = [];
        // 显式任务队列 shift（项目并发安全锁定约束：不可用共享 nextIndex++）。
        // 与 export/index.js:976 对齐，单线程事件循环下 shift 原子取任务。
        const remaining = Array.from({ length: newBookmarks.length }, (_, k) => k);

        const worker = async () => {
            while (true) {
                // P4 收敛(c09): 批量写页可能耗时数分钟 —— 租约丢失/认证终态须逐项中止
                // (并发 worker 不共享中止标记则继续逐项 401, 与 fail-fast 语义相悛)
                if (AutoImporter._leaseLost || autoImportAborted) break;
                const i = remaining.shift();
                if (i === undefined) return;

                const bookmark = newBookmarks[i];
                const topicId = String(bookmark.topic_id || bookmark.bookmarkable_id);
                const title = bookmark.title || bookmark.name || `帖子 ${topicId}`;
                AutoImporter.updateStatus(`📬 导入中 (${i + 1}/${newBookmarks.length}): ${title}`);

                try {
                    // 与手动 exportBookmarks (v3.14.7) 同构：每项开工前重读 Storage 最新 token，
                    // 防止 OAuth 续签后 settings.apiKey 快照遮蔽新 token（upload 分片等旁路亦受益）。
                    settings.apiKey = NotionOAuth.getAccessToken("");
                    await Exporter.exportTopic(bookmark, settings);
                    success++;
                    successfulBookmarks.push(bookmark);
                } catch (error) {
                    console.error(`[LD-Notion] 自动导入失败: ${title}`, error);
                    failed++;
                    // 认证终态 fail-fast(v3.14.5):token 无效时中止批次,
                    // 剩余项留待下次自动同步重试(不逐项重复注定失败的 401)
                    // v3.14.6 (AUD-ARCH-09/CC-02/X-03): 不再 unshift 毒项回插队列 ——
                    // 并发 worker 会立即重新消费同一毒项反复 401; 该项因未落账自然留待下轮
                    if (Exporter.isAuthTerminalError && Exporter.isAuthTerminalError(error)) {
                        // v3.14.13 (三模型共识): 透传 authCode 供状态栏分支文案
                        autoImportAborted = { authCode: error.authCode || "unauthorized" };
                        break;
                    }
                }

                if (delay > 0 && remaining.length > 0) {
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

        const uiRef = null; // 事件总线解耦：不再直接调用 UI.renderBookmarkList
        emit("bookmarks:updated");

        const statePatch = {
            lastAttemptAt: attemptAt,
            lastOutcome: autoImportAborted ? "aborted" : (failed > 0 ? "partial" : "success"),
            lastError: autoImportAborted ? "认证失败，已中止本次自动导入（请检查 Notion API Key / OAuth 授权）" : "",
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

        // v3.14.13 (三模型共识): 按 authCode 分支——用户看到裸 401 文案无法区分场景
        const authCode = String(autoImportAborted?.authCode || "").toLowerCase();
        let abortText = `⛔ 认证失败，已中止自动导入（成功 ${success} 个；剩余项将在下次同步重试。请检查 Notion API Key / OAuth 授权） (${new Date().toLocaleTimeString()})`;
        if (authCode === "empty_token") {
            abortText = `⛔ 未读取到 API Key，已中止自动导入（成功 ${success} 个；请重新保存 API Key 或重新 OAuth 授权） (${new Date().toLocaleTimeString()})`;
        } else if (authCode === "unauthorized" || authCode === "invalid_bearer_token") {
            abortText = `⛔ Notion 拒绝了该 API Key，已中止自动导入（成功 ${success} 个；请重新复制保存或重新 OAuth 授权） (${new Date().toLocaleTimeString()})`;
        }
        AutoImporter.updateStatus(
            autoImportAborted
                ? abortText
                : `✅ 自动导入完成: ${success} 个成功${failed > 0 ? `，${failed} 个失败` : ""} (${new Date().toLocaleTimeString()})`
        );

        if (success > 0 && typeof GM_notification === "function") {
            GM_notification({
                title: "自动导入完成",
                text: `成功导入 ${success} 个新收藏到 Notion`,
                timeout: 5000,
            });
        }
        // odyssey-debug 20260913: errors 契约对齐(debug-notes-017) — 认证中止不再被吞
        return {
            importedCount: success,
            failedCount: failed,
            errors: autoImportAborted
                ? [String(autoImportAborted?.message || "认证失败，已中止自动导入（请检查 Notion API Key / OAuth 授权）")]
                : [],
        };
    } catch (error) {
        console.error("[LD-Notion] 自动导入出错:", error);
        SyncState.updateLinuxDoState({
            lastAttemptAt: attemptAt,
            lastOutcome: "error",
            lastError: error?.message || String(error),
            lastStats: {},
        });
        AutoImporter.updateStatus(`❌ 自动导入出错: ${error.message}`);
        // odyssey-debug 20260913: 吞错面收敛 — catch 后正常返回致调用方误判成功, 经 errors 上抛
        return { importedCount: 0, failedCount: 0, errors: [error?.message || String(error)] };
    } finally {
        clearInterval(renewTimer);
        SyncLock.releaseLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);
        AutoImporter._leaseLost = false;
        AutoImporter.isRunning = false;
        // v3.14.6 (CC-03): 复位互斥(仅当本次由自己置位)
        if (exportMutexAcquired) SyncLock.isExporting = false;
        if (exportBtn) exportBtn.disabled = false;
        const obsExportBtn2 = document.querySelector("#ldb-obs-export");
        if (obsExportBtn2) obsExportBtn2.disabled = false;
        emit("sync:center-summary-updated");
    }
};

module.exports = { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter };
