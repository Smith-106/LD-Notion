"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { NotionOAuth } = require("../auth");
const { NotionAPI } = require("../api");
const { SyncLock } = require("../sync-lock");
const { SyncCoordinator } = require("../adapter/SyncCoordinator");

const { BookmarkExporter } = require("./BookmarkExporter");

const BookmarkAutoImporter = {
    isRunning: false,
    timerId: null,
    deferredWhileHidden: false,
    visibilityListenerBound: false,
    lastRunAt: 0,
    minimumRunGapMs: 60 * 1000,

    updateStatus: (text) => {
        const el = (UI.refs && UI.refs.bookmarkAutoImportStatus) || document.querySelector("#ldb-bookmark-auto-import-status");
        if (el) el.textContent = text;
    },

    buildSettings: () => ({
        apiKey: NotionOAuth.getAccessToken(),
        databaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
        exportTargetType: Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType),
        aiApiKey: Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
        aiService: Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService),
        aiModel: Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, ""),
        aiBaseUrl: Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
        categories: Utils.parseAICategories(
            Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories)
        ),
    }),

    canStart: () => {
        if (!Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, false)) return false;
        if (!require("./index").BookmarkBridge.isExtensionAvailable()) return false;
        const settings = BookmarkAutoImporter.buildSettings();
        return settings.exportTargetType === "database" && !!(settings.apiKey && settings.databaseId);
    },

    ensureVisibilityListener: () => {
        if (BookmarkAutoImporter.visibilityListenerBound) return;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && BookmarkAutoImporter.deferredWhileHidden) {
                BookmarkAutoImporter.deferredWhileHidden = false;
                Utils.runWhenBrowserIdle(() => BookmarkAutoImporter.run());
            }
        });
        BookmarkAutoImporter.visibilityListenerBound = true;
    },

    stopPolling: () => {
        if (BookmarkAutoImporter.timerId) {
            clearInterval(BookmarkAutoImporter.timerId);
            BookmarkAutoImporter.timerId = null;
        }
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.stop("bookmark");
    },

    startPolling: (intervalMinutes) => {
        BookmarkAutoImporter.stopPolling();
        if (intervalMinutes > 0) {
            const { SyncScheduler } = require("../adapter/SyncScheduler");
            SyncScheduler.start("bookmark", intervalMinutes);
        }
    },

    normalizeBookmark: (bookmark = {}) => ({
        id: String(bookmark.id || "").trim(),
        title: String(bookmark.title || bookmark.url || "无标题书签").trim(),
        url: String(bookmark.url || "").trim(),
        folderPath: String(bookmark.folderPath || "").trim(),
        dateAdded: SyncState.normalizeTime(bookmark.dateAdded),
    }),

    buildSnapshotEntry: (bookmark, pageId = "") => {
        const normalized = BookmarkAutoImporter.normalizeBookmark(bookmark);
        return {
            ...normalized,
            pageId: String(pageId || "").trim(),
        };
    },

    getPageRichText: (page, propertyName) => {
        const richText = page?.properties?.[propertyName]?.rich_text;
        if (!Array.isArray(richText)) return "";
        return richText.map((item) => item?.plain_text || item?.text?.content || "").join("").trim();
    },

    getPageUrl: (page, propertyName) => String(page?.properties?.[propertyName]?.url || "").trim(),

    getPageDate: (page, propertyName) => SyncState.normalizeTime(page?.properties?.[propertyName]?.date?.start || ""),

    extractPageMeta: (page) => ({
        pageId: String(page?.id || "").trim(),
        bookmarkId: BookmarkAutoImporter.getPageRichText(page, "书签ID"),
        url: BookmarkAutoImporter.getPageUrl(page, "链接"),
        title: Utils.getPageTitle(page, "").trim(),
        folderPath: BookmarkAutoImporter.getPageRichText(page, "书签路径"),
        dateAdded: BookmarkAutoImporter.getPageDate(page, "收藏时间"),
        archived: !!page?.archived,
    }),

    fetchTrackedPages: async (databaseId, apiKey) => {
        const filter = {
            and: [
                { property: "来源", rich_text: { equals: "浏览器书签" } },
                { property: "来源类型", rich_text: { equals: "书签" } },
            ],
        };
        const pages = [];
        let cursor = null;
        do {
            const response = await NotionAPI.queryDatabase(databaseId, filter, null, cursor, apiKey);
            pages.push(...(response?.results || []));
            cursor = response?.has_more ? response.next_cursor : null;
        } while (cursor);
        return pages
            .map((page) => BookmarkAutoImporter.extractPageMeta(page))
            .filter((page) => page.pageId && !page.archived);
    },

    buildPageIndex: (pages = []) => {
        const byBookmarkId = new Map();
        const byUrl = new Map();
        const byPageId = new Map();
        for (const page of (pages || [])) {
            if (page.pageId) byPageId.set(page.pageId, page);
            if (page.bookmarkId && !byBookmarkId.has(page.bookmarkId)) {
                byBookmarkId.set(page.bookmarkId, page);
            }
            if (page.url && !byUrl.has(page.url)) {
                byUrl.set(page.url, page);
            }
        }
        return { byBookmarkId, byUrl, byPageId };
    },

    buildMinimalProperties: (bookmark) => {
        const normalized = BookmarkAutoImporter.normalizeBookmark(bookmark);
        const title = BookmarkExporter.normalizeText(normalized.title || "无标题书签", 2000) || "无标题书签";
        const bookmarkId = BookmarkExporter.normalizeText(normalized.id, 200);
        const properties = {
            "标题": {
                title: [{ text: { content: title } }]
            },
            "链接": {
                url: normalized.url
            },
            "书签ID": {
                rich_text: bookmarkId ? [{ text: { content: bookmarkId } }] : []
            },
            "来源": {
                rich_text: [{ text: { content: "浏览器书签" } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: "书签" } }]
            },
            "书签路径": {
                rich_text: [{ text: { content: normalized.folderPath.substring(0, 2000) } }]
            },
        };
        if (normalized.dateAdded) {
            properties["收藏时间"] = { date: { start: normalized.dateAdded } };
        }
        return properties;
    },

    needsFullRefresh: (bookmark, snapshotEntry, pageMeta) => {
        if (!pageMeta) return true;
        if (!snapshotEntry) return false;
        return String(snapshotEntry.url || "") !== String(bookmark.url || "");
    },

    needsUpdate: (bookmark, snapshotEntry, pageMeta) => {
        if (!pageMeta) return true;
        if (pageMeta.bookmarkId !== String(bookmark.id || "").trim()) return true;
        if (pageMeta.url !== String(bookmark.url || "").trim()) return true;
        if (!snapshotEntry) return false;
        if (String(snapshotEntry.title || "") !== String(bookmark.title || "").trim()) return true;
        if (String(snapshotEntry.folderPath || "") !== String(bookmark.folderPath || "").trim()) return true;
        return SyncState.normalizeTime(snapshotEntry.dateAdded) !== SyncState.normalizeTime(bookmark.dateAdded);
    },

    loadCurrentBookmarks: async () => {
        const tree = await require("./index").BookmarkBridge.getBookmarkTree();
        const flattened = BookmarkExporter.flattenTree(tree);
        const unique = new Map();
        for (const rawBookmark of (flattened || [])) {
            const normalized = BookmarkAutoImporter.normalizeBookmark(rawBookmark);
            if (!normalized.id || !normalized.url) continue;
            unique.set(normalized.id, {
                ...rawBookmark,
                ...normalized,
                dateAdded: normalized.dateAdded || null,
            });
        }
        return Array.from(unique.values());
    },


    init: () => {
        if (!BookmarkAutoImporter.canStart()) return;
        BookmarkAutoImporter.ensureVisibilityListener();
        setTimeout(() => {
            Utils.runWhenBrowserIdle(() => BookmarkAutoImporter.run());
            const interval = Storage.get(
                CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL,
                CONFIG.DEFAULTS.bookmarkAutoImportInterval
            );
            if (interval > 0) BookmarkAutoImporter.startPolling(interval);
        }, 3000);
    },
};

BookmarkAutoImporter.run = async () => {
    if (document.hidden) {
        BookmarkAutoImporter.deferredWhileHidden = true;
        return;
    }
    if (BookmarkAutoImporter.isRunning) return;
    if (SyncLock.isExporting) return;

    const settings = BookmarkAutoImporter.buildSettings();
    if (!require("./index").BookmarkBridge.isExtensionAvailable()) {
        BookmarkAutoImporter.updateStatus("请先安装并启用书签桥接扩展");
        return;
    }
    if (settings.exportTargetType !== "database") {
        BookmarkAutoImporter.updateStatus("浏览器书签自动同步仅支持导出到 Notion 数据库");
        return;
    }
    if (!settings.apiKey || !settings.databaseId) {
        BookmarkAutoImporter.updateStatus("请先配置 Notion API Key 和数据库 ID");
        return;
    }

    const now = Date.now();
    if (now - BookmarkAutoImporter.lastRunAt < BookmarkAutoImporter.minimumRunGapMs) return;
    BookmarkAutoImporter.lastRunAt = now;
    BookmarkAutoImporter.isRunning = true;
    const attemptAt = Date.now();

    try {
        SyncState.updateBookmarkState({
            lastAttemptAt: attemptAt,
            lastOutcome: "running",
            lastError: "",
            lastStats: {},
        });
        BookmarkAutoImporter.updateStatus("📧 正在同步浏览器书签...");

        // 使用 SyncCoordinator 获取增量同步概要 (统一状态管理)
        await SyncCoordinator.sync("bookmarks");

        const setupResult = await BookmarkExporter.setupDatabaseProperties(settings.databaseId, settings.apiKey);
        if (!setupResult.success) {
            throw new Error(`数据库配置失败: ${setupResult.error}`);
        }

        const previousState = SyncState.getBookmarkState();
        const previousSnapshot = previousState?.snapshot && typeof previousState.snapshot === "object"
            ? previousState.snapshot
            : {};
        const currentBookmarks = await BookmarkAutoImporter.loadCurrentBookmarks();
        const currentMap = new Map(currentBookmarks.map((bookmark) => [String(bookmark.id), bookmark]));
        const trackedPages = await BookmarkAutoImporter.fetchTrackedPages(settings.databaseId, settings.apiKey);
        const index = BookmarkAutoImporter.buildPageIndex(trackedPages);
        const nextSnapshot = {};
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };

        let created = 0;
        let updated = 0;
        let archived = 0;
        let unchanged = 0;
        let failed = 0;

        for (let i = 0; i < currentBookmarks.length; i++) {
            const bookmark = currentBookmarks[i];
            const bookmarkId = String(bookmark.id);
            const snapshotEntry = previousSnapshot[bookmarkId] || null;
            let pageMeta = index.byBookmarkId.get(bookmarkId)
                || index.byUrl.get(bookmark.url)
                || (snapshotEntry?.pageId ? index.byPageId.get(snapshotEntry.pageId) : null);

            try {
                if (!pageMeta) {
                    BookmarkAutoImporter.updateStatus(`📄 正在新增书签 (${i + 1}/${currentBookmarks.length}): ${bookmark.title}`);
                    const enriched = await BookmarkExporter.enrichBookmark(bookmark, settings, enrichContext);
                    const page = await NotionAPI.request("POST", "/pages", {
                        parent: { database_id: settings.databaseId },
                        properties: BookmarkExporter.buildProperties(enriched),
                    }, settings.apiKey);
                    pageMeta = {
                        pageId: String(page?.id || "").trim(),
                        bookmarkId,
                        url: bookmark.url,
                        title: bookmark.title,
                        folderPath: bookmark.folderPath,
                        dateAdded: SyncState.normalizeTime(bookmark.dateAdded),
                    };
                    created++;
                } else if (BookmarkAutoImporter.needsUpdate(bookmark, snapshotEntry, pageMeta)) {
                    BookmarkAutoImporter.updateStatus(`📧 正在更新书签 (${i + 1}/${currentBookmarks.length}): ${bookmark.title}`);
                    const properties = BookmarkAutoImporter.needsFullRefresh(bookmark, snapshotEntry, pageMeta)
                        ? BookmarkExporter.buildProperties(await BookmarkExporter.enrichBookmark(bookmark, settings, enrichContext))
                        : BookmarkAutoImporter.buildMinimalProperties(bookmark);
                    await NotionAPI.updatePage(pageMeta.pageId, properties, settings.apiKey);
                    updated++;
                } else {
                    unchanged++;
                }

                const pageId = pageMeta?.pageId || snapshotEntry?.pageId || "";
                const syncedMeta = {
                    pageId,
                    bookmarkId,
                    url: bookmark.url,
                    title: bookmark.title,
                    folderPath: bookmark.folderPath,
                    dateAdded: SyncState.normalizeTime(bookmark.dateAdded),
                };
                if (pageId) index.byPageId.set(pageId, syncedMeta);
                index.byBookmarkId.set(bookmarkId, syncedMeta);
                if (syncedMeta.url) index.byUrl.set(syncedMeta.url, syncedMeta);
                BookmarkExporter.markExported(bookmark.url);
                nextSnapshot[bookmarkId] = BookmarkAutoImporter.buildSnapshotEntry(bookmark, pageId);
            } catch (error) {
                console.error(`[LD-Notion] 浏览器书签自动同步失败: ${bookmark.title || bookmark.url}`, error);
                failed++;
                if (snapshotEntry) {
                    nextSnapshot[bookmarkId] = snapshotEntry;
                }
            }

            if (delay > 0 && i < currentBookmarks.length - 1) {
                await Utils.sleep(delay);
            }
        }

        const deletedIds = Object.keys(previousSnapshot).filter((bookmarkId) => !currentMap.has(bookmarkId));
        for (let i = 0; i < deletedIds.length; i++) {
            const bookmarkId = deletedIds[i];
            const snapshotEntry = previousSnapshot[bookmarkId];
            const pageMeta = (snapshotEntry?.pageId ? index.byPageId.get(snapshotEntry.pageId) : null)
                || index.byBookmarkId.get(bookmarkId)
                || (snapshotEntry?.url ? index.byUrl.get(snapshotEntry.url) : null);

            if (!pageMeta?.pageId) {
                archived++;
                continue;
            }

            try {
                const itemLabel = snapshotEntry?.title || snapshotEntry?.url || bookmarkId;
                BookmarkAutoImporter.updateStatus(`🗃️ 正在归档已删除书签 (${i + 1}/${deletedIds.length}): ${itemLabel}`);
                await NotionAPI.deletePage(pageMeta.pageId, settings.apiKey);
                archived++;
            } catch (error) {
                console.error(`[LD-Notion] 浏览器书签归档失败: ${snapshotEntry?.title || snapshotEntry?.url || bookmarkId}`, error);
                failed++;
                nextSnapshot[bookmarkId] = snapshotEntry;
            }

            if (delay > 0 && i < deletedIds.length - 1) {
                await Utils.sleep(delay);
            }
        }

        SyncState.updateBookmarkState({
            snapshot: nextSnapshot,
            watermark: SyncState.buildWatermark(currentBookmarks, (bookmark) => bookmark.dateAdded, (bookmark) => bookmark.id),
            lastAttemptAt: attemptAt,
            lastSuccessAt: (created + updated + archived) > 0
                ? Date.now()
                : (failed === 0 ? Date.now() : previousState.lastSuccessAt || 0),
            lastOutcome: failed > 0 ? "partial" : "success",
            lastError: "",
            lastStats: {
                created,
                updated,
                archived,
                unchanged,
                failed,
            },
        });

        if (created === 0 && updated === 0 && archived === 0 && failed === 0) {
            BookmarkAutoImporter.updateStatus(`✅ 浏览器书签已同步，无新增变更 (${new Date().toLocaleTimeString()})`);
            return;
        }

        BookmarkAutoImporter.updateStatus(
            `✅ 浏览器书签自动同步完成: 新增 ${created}，更新 ${updated}，归档 ${archived}，无变更 ${unchanged}`
            + `${failed > 0 ? `，失败 ${failed}` : ""}`
            + ` (${new Date().toLocaleTimeString()})`
        );

        if ((created + updated + archived) > 0 && typeof GM_notification === "function") {
            GM_notification({
                title: "浏览器书签自动同步完成",
                text: `新增 ${created}，更新 ${updated}，归档 ${archived}${failed > 0 ? `，失败 ${failed}` : ""}`,
                timeout: 5000,
            });
        }
    } catch (error) {
        console.error("[LD-Notion] 浏览器书签自动同步出错:", error);
        SyncState.updateBookmarkState({
            lastAttemptAt: attemptAt,
            lastOutcome: "error",
            lastError: error?.message || String(error),
            lastStats: {},
        });
        BookmarkAutoImporter.updateStatus(`❌ 浏览器书签自动同步出错: ${error.message}`);
    } finally {
        BookmarkAutoImporter.isRunning = false;
        if (typeof UI !== "undefined" && typeof UI.renderSyncCenterSummary === "function") {
            try { UI.renderSyncCenterSummary(); } catch {}
        }
    }
};

module.exports = { BookmarkAutoImporter };
