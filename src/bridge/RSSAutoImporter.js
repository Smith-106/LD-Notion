"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { NotionOAuth } = require("../auth");
const { NotionAPI } = require("../api");
const { SyncLock } = require("../sync-lock");
const { SyncCoordinator } = require("../adapter/SyncCoordinator");

const { BookmarkExporter } = require("./BookmarkExporter");
const { BookmarkAutoImporter } = require("./BookmarkAutoImporter");

const RSSAutoImporter = {
    isRunning: false,
    timerId: null,
    deferredWhileHidden: false,
    visibilityListenerBound: false,
    lastRunAt: 0,
    minimumRunGapMs: 60 * 1000,

    updateStatus: (text) => {
        const el = (UI.refs && UI.refs.rssAutoImportStatus) || document.querySelector("#ldb-rss-auto-import-status");
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

    getFeedUrls: (raw = Storage.get(CONFIG.STORAGE_KEYS.RSS_FEED_URLS, CONFIG.DEFAULTS.rssFeedUrls)) => {
        const urls = String(raw || "")
            .split(/[\n,，;；]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .filter((item) => /^https?:\/\//i.test(item));
        return Array.from(new Set(urls));
    },

    getDedupMode: () => {
        const mode = Storage.get(CONFIG.STORAGE_KEYS.RSS_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.rssImportDedupMode);
        return mode === "allow_duplicates" ? "allow_duplicates" : "strict";
    },

    canStart: () => {
        if (!Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, false)) return false;
        const settings = RSSAutoImporter.buildSettings();
        return settings.exportTargetType === "database"
            && !!(settings.apiKey && settings.databaseId)
            && RSSAutoImporter.getFeedUrls().length > 0;
    },

    ensureVisibilityListener: () => {
        if (RSSAutoImporter.visibilityListenerBound) return;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && RSSAutoImporter.deferredWhileHidden) {
                RSSAutoImporter.deferredWhileHidden = false;
                Utils.runWhenBrowserIdle(() => RSSAutoImporter.run());
            }
        });
        RSSAutoImporter.visibilityListenerBound = true;
    },

    stopPolling: () => {
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.stop("rss");
    },

    startPolling: (intervalMinutes) => {
        // 统一委托给 SyncScheduler (消除双定时器)
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.start("rss");
    },

    escapeRegExp: (text) => String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),

    decodeXmlEntities: (text) => String(text || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, "&"),

    stripHtml: (text, maxLen = 1200) => BookmarkExporter.normalizeText(
        RSSAutoImporter.decodeXmlEntities(String(text || "").replace(/<[^>]+>/g, " ")),
        maxLen
    ),

    extractTagText: (block, names = []) => {
        const source = String(block || "");
        for (const name of (names || [])) {
            const escaped = RSSAutoImporter.escapeRegExp(name);
            const match = source.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
            if (match?.[1]) {
                return RSSAutoImporter.decodeXmlEntities(match[1]).trim();
            }
        }
        return "";
    },

    extractTagTexts: (block, names = []) => {
        const source = String(block || "");
        const values = [];
        for (const name of (names || [])) {
            const escaped = RSSAutoImporter.escapeRegExp(name);
            const regex = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "gi");
            let match = null;
            while ((match = regex.exec(source))) {
                const value = RSSAutoImporter.decodeXmlEntities(match[1]).trim();
                if (value) values.push(value);
            }
        }
        return values;
    },

    extractAtomCategoryTerms: (block) => {
        const values = [];
        const regex = /<category\b[^>]*term=["']([^"']+)["'][^>]*\/?>/gi;
        let match = null;
        while ((match = regex.exec(String(block || "")))) {
            const value = RSSAutoImporter.decodeXmlEntities(match[1]).trim();
            if (value) values.push(value);
        }
        return values;
    },

    extractLink: (block, isAtom = false) => {
        const source = String(block || "");
        if (isAtom) {
            const alternateMatch = source.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i);
            if (alternateMatch?.[1]) return RSSAutoImporter.decodeXmlEntities(alternateMatch[1]).trim();
            const hrefMatch = source.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
            if (hrefMatch?.[1]) return RSSAutoImporter.decodeXmlEntities(hrefMatch[1]).trim();
        }
        return RSSAutoImporter.extractTagText(source, ["link"]);
    },

    normalizeItem: (item = {}) => {
        const title = BookmarkExporter.normalizeText(item.title || item.url || "未命名 RSS 条目", 280) || "未命名 RSS 条目";
        const url = String(item.url || "").trim();
        const feedTitle = BookmarkExporter.normalizeText(item.feedTitle || "", 160);
        const summary = BookmarkExporter.normalizeText(item.summary || "", 1900);
        const tags = Array.isArray(item.tags)
            ? Array.from(new Set(item.tags.map((tag) => BookmarkExporter.normalizeText(tag, 100)).filter(Boolean)))
            : [];
        const id = BookmarkExporter.normalizeText(
            String(item.id || url || `${feedTitle || "feed"}::${title}`),
            300
        ) || url || `${feedTitle || "feed"}::${title}`;
        return {
            id,
            title,
            url,
            summary,
            tags,
            feedTitle,
            feedUrl: String(item.feedUrl || "").trim(),
            publishedAt: SyncState.normalizeTime(item.publishedAt || ""),
        };
    },

    buildItemKey: (item, dedupMode = RSSAutoImporter.getDedupMode()) => {
        const normalized = RSSAutoImporter.normalizeItem(item);
        if (dedupMode === "allow_duplicates") {
            return `${normalized.feedUrl || "feed"}::${normalized.id}`;
        }
        return String(normalized.url || normalized.id || "").trim();
    },

    parseFeedXml: (xml, feedUrl = "") => {
        const source = String(xml || "").trim();
        if (!source) return { feedTitle: "", items: [] };

        const isAtom = /<feed[\s>]/i.test(source) && !/<rss[\s>]/i.test(source);
        const header = isAtom
            ? source.split(/<entry\b/i)[0]
            : (() => {
                const channelMatch = source.match(/<channel\b[^>]*>([\s\S]*?)(?:<item\b|<\/channel>)/i);
                return channelMatch?.[1] || source.split(/<item\b/i)[0];
            })();
        const feedTitle = RSSAutoImporter.stripHtml(
            RSSAutoImporter.extractTagText(header, ["title"]),
            160
        );
        const entryRegex = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
        const items = [];
        let match = null;

        while ((match = entryRegex.exec(source))) {
            const block = match[1];
            const title = RSSAutoImporter.stripHtml(
                RSSAutoImporter.extractTagText(block, ["title"]),
                280
            );
            const url = RSSAutoImporter.extractLink(block, isAtom);
            const itemId = RSSAutoImporter.extractTagText(
                block,
                isAtom ? ["id"] : ["guid"]
            ) || url || title;
            const publishedAt = RSSAutoImporter.extractTagText(
                block,
                isAtom ? ["published", "updated"] : ["pubDate", "dc:date", "published", "updated"]
            );
            const summary = RSSAutoImporter.stripHtml(
                RSSAutoImporter.extractTagText(
                    block,
                    isAtom ? ["summary", "content"] : ["description", "content:encoded"]
                ),
                1900
            );
            const tags = [
                ...RSSAutoImporter.extractTagTexts(block, ["category"]),
                ...(isAtom ? RSSAutoImporter.extractAtomCategoryTerms(block) : []),
            ];
            const normalized = RSSAutoImporter.normalizeItem({
                id: itemId,
                title,
                url,
                summary,
                tags,
                feedTitle,
                feedUrl,
                publishedAt,
            });
            if (!normalized.url || !normalized.id) continue;
            items.push(normalized);
        }

        items.sort((a, b) => {
            const aTime = Date.parse(a.publishedAt || "") || 0;
            const bTime = Date.parse(b.publishedAt || "") || 0;
            if (bTime !== aTime) return bTime - aTime;
            return String(a.id).localeCompare(String(b.id));
        });

        return { feedTitle, items };
    },

    fetchFeed: (feedUrl) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: feedUrl,
                timeout: 15000,
                headers: {
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
                },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    try {
                        resolve(RSSAutoImporter.parseFeedXml(response.responseText || "", feedUrl));
                    } catch (error) {
                        reject(error);
                    }
                },
                ontimeout: () => reject(new Error("RSS 拉取超时")),
                onerror: () => reject(new Error("RSS 拉取失败")),
            });
        });
    },

    fetchTrackedPages: async (databaseId, apiKey) => {
        const filter = {
            and: [
                { property: "来源", rich_text: { equals: "RSS" } },
                { property: "来源类型", rich_text: { equals: "Feed" } },
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
            .map((page) => ({
                pageId: String(page?.id || "").trim(),
                url: BookmarkAutoImporter.getPageUrl(page, "链接"),
                title: Utils.getPageTitle(page, "").trim(),
                summary: BookmarkAutoImporter.getPageRichText(page, "描述"),
                publishedAt: BookmarkAutoImporter.getPageDate(page, "收藏时间"),
                archived: !!page?.archived,
            }))
            .filter((page) => page.pageId && !page.archived);
    },

    buildPageIndex: (pages = []) => {
        const byUrl = new Map();
        const byPageId = new Map();
        const byTitle = new Map();
        for (const page of (pages || [])) {
            if (page.pageId) byPageId.set(page.pageId, page);
            if (page.url && !byUrl.has(page.url)) byUrl.set(page.url, page);
            if (page.title && !byTitle.has(page.title)) byTitle.set(page.title, page);
        }
        return { byUrl, byPageId, byTitle };
    },

    buildSnapshotEntry: (item, pageId = "") => {
        const normalized = RSSAutoImporter.normalizeItem(item);
        return {
            ...normalized,
            pageId: String(pageId || "").trim(),
            itemKey: RSSAutoImporter.buildItemKey(normalized),
        };
    },

    buildProperties: (item) => {
        const normalized = RSSAutoImporter.normalizeItem(item);
        const inferredCategory = BookmarkExporter.normalizeText(item?.inferredCategory || "", 300);
        const tags = Array.from(new Set([
            ...(normalized.feedTitle ? [normalized.feedTitle] : []),
            ...(Array.isArray(normalized.tags) ? normalized.tags : []),
        ]));
        const properties = {
            "标题": {
                title: [{ text: { content: normalized.title } }]
            },
            "链接": {
                url: normalized.url
            },
            "来源": {
                rich_text: [{ text: { content: "RSS" } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: "Feed" } }]
            },
        };
        if (normalized.summary) {
            properties["描述"] = {
                rich_text: [{ text: { content: normalized.summary } }]
            };
        }
        if (normalized.publishedAt) {
            properties["收藏时间"] = { date: { start: normalized.publishedAt } };
        }
        if (inferredCategory) {
            properties["分类"] = {
                rich_text: [{ text: { content: inferredCategory } }]
            };
        }
        if (tags.length > 0) {
            properties["标签"] = {
                multi_select: tags
                    .map((tag) => BookmarkExporter.normalizeText(tag, 100))
                    .filter(Boolean)
                    .slice(0, 8)
                    .map((name) => ({ name }))
            };
        }
        return properties;
    },

    enrichItem: async (item, settings, context = {}) => {
        const normalized = RSSAutoImporter.normalizeItem(item);
        const enriched = {
            ...normalized,
            inferredCategory: BookmarkExporter.inferCategoryHeuristic(
                { title: normalized.title, url: normalized.url, folderPath: normalized.feedTitle },
                { title: normalized.title, summary: normalized.summary },
                settings?.categories || []
            ),
        };

        const canUseAI = !!(settings?.aiApiKey && settings?.aiService && Array.isArray(settings?.categories) && settings.categories.length > 0);
        const aiMaxItems = Number.isFinite(context.aiMaxItems) ? context.aiMaxItems : 20;
        if (canUseAI && (context.aiUsedCount || 0) < aiMaxItems) {
            try {
                const aiCategory = await BookmarkExporter.generateAICategory(
                    { title: normalized.title, url: normalized.url },
                    { title: normalized.title, summary: normalized.summary },
                    settings
                );
                if (aiCategory) {
                    enriched.inferredCategory = aiCategory;
                }
                context.aiUsedCount = (context.aiUsedCount || 0) + 1;
            } catch {
                // ignore AI enrichment failures for RSS
            }
        }

        return enriched;
    },

    needsUpdate: (item, snapshotEntry, pageMeta) => {
        if (!pageMeta) return true;
        if (!snapshotEntry) return false;
        if (String(pageMeta.url || "") !== String(item.url || "")) return true;
        if (String(pageMeta.title || "") !== String(item.title || "")) return true;
        if (String(pageMeta.summary || "") !== String(item.summary || "")) return true;
        return SyncState.normalizeTime(pageMeta.publishedAt) !== SyncState.normalizeTime(item.publishedAt);
    },

    loadCurrentItems: async () => {
        const feedUrls = RSSAutoImporter.getFeedUrls();
        const dedupMode = RSSAutoImporter.getDedupMode();
        const itemsByKey = new Map();

        for (const feedUrl of feedUrls) {
            const parsed = await RSSAutoImporter.fetchFeed(feedUrl);
            for (const rawItem of (parsed.items || [])) {
                const normalized = RSSAutoImporter.normalizeItem({
                    ...rawItem,
                    feedTitle: rawItem.feedTitle || parsed.feedTitle || "",
                    feedUrl,
                });
                const itemKey = RSSAutoImporter.buildItemKey(normalized, dedupMode);
                const existing = itemsByKey.get(itemKey);
                if (!existing) {
                    itemsByKey.set(itemKey, { ...normalized, itemKey });
                    continue;
                }
                const nextTime = Date.parse(normalized.publishedAt || "") || 0;
                const currentTime = Date.parse(existing.publishedAt || "") || 0;
                if (nextTime >= currentTime) {
                    itemsByKey.set(itemKey, {
                        ...existing,
                        ...normalized,
                        tags: Array.from(new Set([...(existing.tags || []), ...(normalized.tags || [])])),
                        itemKey,
                    });
                }
            }
        }

        return {
            feedCount: feedUrls.length,
            items: Array.from(itemsByKey.values()).sort((a, b) => {
                const aTime = Date.parse(a.publishedAt || "") || 0;
                const bTime = Date.parse(b.publishedAt || "") || 0;
                if (bTime !== aTime) return bTime - aTime;
                return String(a.id).localeCompare(String(b.id));
            }),
        };
    },

    // 初始化同步上下文：增量同步 + 数据库配置 + 索引构建（MNT-002 提取自 run）
    _initSyncContext: async (settings, attemptAt) => {
        SyncState.updateRssState({
            lastAttemptAt: attemptAt,
            lastOutcome: "running",
            lastError: "",
            lastStats: {},
        });
        RSSAutoImporter.updateStatus("正在同步 RSS Feed...");

        const syncResult = await SyncCoordinator.sync("rss");
        if (syncResult.error) {
            throw new Error(syncResult.error);
        }

        const setupResult = await BookmarkExporter.setupDatabaseProperties(settings.databaseId, settings.apiKey);
        if (!setupResult.success) {
            throw new Error(`数据库配置失败: ${setupResult.error}`);
        }

        const previousState = SyncState.getRssState();
        const previousSnapshot = previousState?.snapshot && typeof previousState.snapshot === "object"
            ? previousState.snapshot
            : {};

        let currentItems = syncResult.newItems || [];
        let feedCount = RSSAutoImporter.getFeedUrls().length;
        if (currentItems.length === 0) {
            const fallback = await RSSAutoImporter.loadCurrentItems();
            currentItems = fallback.items || [];
            feedCount = fallback.feedCount || feedCount;
        }

        const trackedPages = await RSSAutoImporter.fetchTrackedPages(settings.databaseId, settings.apiKey);
        const index = RSSAutoImporter.buildPageIndex(trackedPages);

        return {
            syncResult,
            previousSnapshot,
            currentItems,
            feedCount,
            index,
            nextSnapshot: { ...previousSnapshot },
            delay: Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay),
            enrichContext: { aiUsedCount: 0, aiMaxItems: 20 },
        };
    },

    // 同步单条 RSS 条目（MNT-002 提取自 run 循环体）
    _syncSingleRssItem: async (item, ctx) => {
        const { settings, index, previousSnapshot, nextSnapshot, enrichContext, total } = ctx;
        const snapshotEntry = previousSnapshot[item.itemKey] || null;
        let pageMeta = (item.url ? index.byUrl.get(item.url) : null)
            || (snapshotEntry?.pageId ? index.byPageId.get(snapshotEntry.pageId) : null)
            || (item.title ? index.byTitle.get(item.title) : null);

        let result = { created: 0, updated: 0, unchanged: 0, failed: 0, itemKey: item.itemKey };

        try {
            if (!pageMeta) {
                RSSAutoImporter.updateStatus(`正在新增 RSS 条目 (${ctx.position}/${total}): ${item.title}`);
                const enriched = await RSSAutoImporter.enrichItem(item, settings, enrichContext);
                const page = await NotionAPI.request("POST", "/pages", {
                    parent: { database_id: settings.databaseId },
                    properties: RSSAutoImporter.buildProperties(enriched),
                }, settings.apiKey);
                pageMeta = {
                    pageId: String(page?.id || "").trim(),
                    url: item.url,
                    title: item.title,
                    summary: item.summary,
                    publishedAt: item.publishedAt,
                };
                result.created = 1;
            } else if (RSSAutoImporter.needsUpdate(item, snapshotEntry, pageMeta)) {
                RSSAutoImporter.updateStatus(`正在更新 RSS 条目 (${ctx.position}/${total}): ${item.title}`);
                const enriched = await RSSAutoImporter.enrichItem(item, settings, enrichContext);
                await NotionAPI.updatePage(pageMeta.pageId, RSSAutoImporter.buildProperties(enriched), settings.apiKey);
                result.updated = 1;
            } else {
                result.unchanged = 1;
            }

            const pageId = pageMeta?.pageId || snapshotEntry?.pageId || "";
            const syncedMeta = {
                pageId,
                url: item.url,
                title: item.title,
                summary: item.summary,
                publishedAt: item.publishedAt,
            };
            if (pageId) index.byPageId.set(pageId, syncedMeta);
            if (syncedMeta.url) index.byUrl.set(syncedMeta.url, syncedMeta);
            if (syncedMeta.title) index.byTitle.set(syncedMeta.title, syncedMeta);
            nextSnapshot[item.itemKey] = RSSAutoImporter.buildSnapshotEntry(item, pageId);
            result.success = true;
            return result;
        } catch (error) {
            console.error(`[LD-Notion] RSS 自动同步失败: ${item.title || item.url}`, error);
            result.failed = 1;
            if (snapshotEntry) {
                nextSnapshot[item.itemKey] = snapshotEntry;
            }
            result.success = false;
            return result;
        }
    },

    // 汇总 RSS 同步状态与 watermark（MNT-002 提取自 run）
    _aggregateRssState: (ctx, stats, successfulKeys, attemptAt) => {
        const { currentItems, feedCount, nextSnapshot } = ctx;
        const { created, updated, unchanged, failed } = stats;

        const statePatch = {
            snapshot: nextSnapshot,
            lastAttemptAt: attemptAt,
            lastOutcome: failed > 0 ? "partial" : "success",
            lastError: "",
            lastStats: {
                feeds: feedCount,
                scanned: currentItems.length,
                created,
                updated,
                unchanged,
                failed,
            },
        };
        if (currentItems.length === 0) {
            statePatch.lastSuccessAt = Date.now();
        } else {
            const leadingSuccessfulItems = SyncState.takeLeadingItems(
                currentItems,
                (entry) => successfulKeys.has(entry.itemKey)
            );
            if (leadingSuccessfulItems.length > 0) {
                statePatch.watermark = SyncState.buildWatermark(
                    leadingSuccessfulItems,
                    (entry) => entry.publishedAt,
                    (entry) => entry.id
                );
                statePatch.lastSuccessAt = Date.now();
            } else if (failed === 0) {
                statePatch.lastSuccessAt = Date.now();
            }
        }
        SyncState.updateRssState(statePatch);

        if (created === 0 && updated === 0 && failed === 0) {
            RSSAutoImporter.updateStatus(`RSS 已同步，无新增变更 (${new Date().toLocaleTimeString()})`);
            return;
        }

        RSSAutoImporter.updateStatus(
            `RSS 自动同步完成：新增 ${created}，更新 ${updated}，无变更 ${unchanged}`
            + `${failed > 0 ? `，失败 ${failed}` : ""}`
            + ` (${new Date().toLocaleTimeString()})`
        );
    },

    run: async () => {
        if (document.hidden) {
            RSSAutoImporter.deferredWhileHidden = true;
            return;
        }
        if (RSSAutoImporter.isRunning) return;
        if (SyncLock.isExporting) return;

        const settings = RSSAutoImporter.buildSettings();
        const feedUrls = RSSAutoImporter.getFeedUrls();
        if (settings.exportTargetType !== "database") {
            RSSAutoImporter.updateStatus("RSS 自动同步仅支持导出到 Notion 数据库");
            return;
        }
        if (!settings.apiKey || !settings.databaseId) {
            RSSAutoImporter.updateStatus("请先配置 Notion API Key 和数据库 ID");
            return;
        }
        if (feedUrls.length === 0) {
            RSSAutoImporter.updateStatus("请先配置至少一个 RSS Feed URL");
            return;
        }

        const now = Date.now();
        if (now - RSSAutoImporter.lastRunAt < RSSAutoImporter.minimumRunGapMs) return;
        RSSAutoImporter.lastRunAt = now;
        RSSAutoImporter.isRunning = true;
        const attemptAt = Date.now();

        try {
            const ctx = await RSSAutoImporter._initSyncContext(settings, attemptAt);

            const stats = { created: 0, updated: 0, unchanged: 0, failed: 0 };
            const successfulKeys = new Set();

            for (let i = 0; i < ctx.currentItems.length; i++) {
                const r = await RSSAutoImporter._syncSingleRssItem(ctx.currentItems[i], {
                    settings,
                    index: ctx.index,
                    previousSnapshot: ctx.previousSnapshot,
                    nextSnapshot: ctx.nextSnapshot,
                    enrichContext: ctx.enrichContext,
                    position: i + 1,
                    total: ctx.currentItems.length,
                });
                stats.created += r.created;
                stats.updated += r.updated;
                stats.unchanged += r.unchanged;
                stats.failed += r.failed;
                if (r.success) successfulKeys.add(r.itemKey);

                if (ctx.delay > 0 && i < ctx.currentItems.length - 1) {
                    await Utils.sleep(ctx.delay);
                }
            }

            RSSAutoImporter._aggregateRssState(ctx, stats, successfulKeys, attemptAt);
        } catch (error) {
            console.error("[LD-Notion] RSS 自动同步出错:", error);
            SyncState.updateRssState({
                lastAttemptAt: attemptAt,
                lastOutcome: "error",
                lastError: error?.message || String(error),
                lastStats: {},
            });
            RSSAutoImporter.updateStatus(`RSS 自动同步出错: ${error.message}`);
        } finally {
            RSSAutoImporter.isRunning = false;
            if (typeof UI !== "undefined" && typeof UI.renderSyncCenterSummary === "function") {
                try { UI.renderSyncCenterSummary(); } catch {}
            }
        }
    },

    init: () => {
        if (!RSSAutoImporter.canStart()) return;
        RSSAutoImporter.ensureVisibilityListener();
        setTimeout(() => {
            Utils.runWhenBrowserIdle(() => RSSAutoImporter.run());
            const interval = Storage.get(
                CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL,
                CONFIG.DEFAULTS.rssAutoImportInterval
            );
            if (interval > 0) RSSAutoImporter.startPolling(interval);
        }, 3000);
    },
};

module.exports = { RSSAutoImporter };
