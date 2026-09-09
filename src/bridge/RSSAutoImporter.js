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
const { emit } = require("../coordination/event-bus");

const RSSAutoImporter = {
    isRunning: false,
    timerId: null,
    initTimerId: null,
    deferredWhileHidden: false,
    visibilityListenerBound: false,
    lastRunAt: 0,
    minimumRunGapMs: 60 * 1000,

    updateStatus: (text) => {
        const el = document.querySelector("#ldb-rss-auto-import-status");
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
        // P4 收敛(c07): feed 地址为出站请求目标 —— 与 _safeUrl 同口径拒内网/169.254/可疑域名
        // (设置可跨设备同步, 脏值不得把用户浏览器当 SSRF 代理)
        const { UrlValidator } = require("../security/UrlValidator");
        const safe = urls.filter((item) => {
            const ok = UrlValidator.validatePageExternalUrl(item);
            if (!ok) console.warn("[LD-Notion] RSS feed 地址被拒(非公网 http(s)):", item);
            return ok;
        });
        return Array.from(new Set(safe));
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
                Utils.runWhenBrowserIdle(() => {
                    // dsf P1 共识: 回调排队期间可能已被禁用, 执行前复核
                    if (!Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, false)) return;
                    RSSAutoImporter.run();
                });
            }
        });
        RSSAutoImporter.visibilityListenerBound = true;
    },

    stopPolling: () => {
        // 清理 init 的 3s 延迟启动: 否则禁用后延迟回调仍会 run + 复活轮询(qwen P1 共识发现)
        if (RSSAutoImporter.initTimerId) {
            clearTimeout(RSSAutoImporter.initTimerId);
            RSSAutoImporter.initTimerId = null;
        }
        // 重置 hidden 推迟标记: 否则禁用后切回可见仍会经 visibilitychange 补跑同步
        RSSAutoImporter.deferredWhileHidden = false;
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.stop("rss");
    },

    startPolling: (intervalMinutes) => {
        // 统一委托给 SyncScheduler (消除双定时器)
        // F-UI-03:显式间隔传入,不再被存储键默认值覆盖
        const { SyncScheduler } = require("../adapter/SyncScheduler");
        SyncScheduler.start("rss", intervalMinutes);
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
            // P4 收敛(c07): 逐个 <link> 标签按属性判定, 不假定 rel 先于 href ——
            // 原回退正则会取第一个带 href 的 link(可能是 rel="self" 的 feed 自身地址)
            const linkTags = source.match(/<link\b[^>]*\/?>/gi) || [];
            let firstHref = "";
            for (const tag of linkTags) {
                const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
                if (!href) continue;
                const rel = tag.match(/rel=["']([^"']*)["']/i)?.[1]?.toLowerCase();
                if (rel === "alternate") return RSSAutoImporter.decodeXmlEntities(href).trim();
                if (!rel && !firstHref) firstHref = href;
            }
            if (firstHref) return RSSAutoImporter.decodeXmlEntities(firstHref).trim();
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

    // DedupStore / SyncCoordinator 过滤键(与 RSSAdapter.getDedupKey 同构)。
    // allow_duplicates: rss:{feedUrl}::{id}; strict: rss:{id}。
    // 与 snapshot 用的 buildItemKey(URL 或 feed::id 无 rss: 前缀)刻意分轨。
    buildDedupStoreKey: (item, dedupMode = RSSAutoImporter.getDedupMode()) => {
        const id = String(item?.id || item?.raw?.id || item?.guid || item?.link || "").trim();
        if (dedupMode === "allow_duplicates") {
            const feedUrl = String(item?.feedUrl || item?.raw?.feedUrl || "feed").trim() || "feed";
            return `rss:${feedUrl}::${id}`;
        }
        return `rss:${id}`;
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

    // 带重试的 fetchFeed：RSS feed 公网稳定性差，单次抖动不应阻断整次同步。
    // 最多重试 2 次（共 3 次尝试），指数退避 1s/2s。
    fetchFeedWithRetry: async (feedUrl, retries = 2) => {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await RSSAutoImporter.fetchFeed(feedUrl);
            } catch (error) {
                lastError = error;
                // 400/401/403 为客户端错误，退避重试无意义，立即短路
                const msg = String(error && error.message || error || "");
                if (/\bHTTP\s+40[013]\b/.test(msg)) throw error;
                if (attempt < retries) {
                    await Utils.sleep(1000 * Math.pow(2, attempt));
                }
            }
        }
        throw lastError;
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

    // 自动同步写入审计（C1 审计完整性，CWE-862）。与 BookmarkAutoImporter._auditAutoSync 同模式：
    // canExecute 非阻塞闸门 + OperationLog 成功/失败审计，批量场景不弹 dialog。
    // actor/source 经 context 注入（与 BookmarkAutoImporter._auditAutoSync 参数化保持一致，
    // ISS-20260724-011）；未传时保持 RSS 自动同步默认值，向后兼容。
    _auditAutoSync: (operation, status, context = {}) => {
        try {
            const { OperationLog } = require("../security");
            OperationLog.add({
                audit_event: OperationLog.inferAuditEvent(operation, status),
                actor: context.actor || "system",
                source: context.source || "rss-auto-sync",
                operationName: operation,
                status,
                context,
            });
        } catch (e) {
            console.warn("[LD-Notion] RSS 自动同步审计写入失败:", e);
        }
    },

    // v3.14.6 (XN-03): 链接属性安全校验 —— 仅 http(s) 公网(拒内网/169.254/非 http 协议)
    _safeUrl: (url) => {
        if (!url) return "";
        const { UrlValidator } = require("../security/UrlValidator");
        return UrlValidator.validatePageExternalUrl(String(url).trim())
            ? String(url).trim().slice(0, 2000)
            : "";
    },

    buildProperties: (item) => {
        const normalized = RSSAutoImporter.normalizeItem(item);
        const inferredCategory = BookmarkExporter.normalizeText(item?.inferredCategory || "", 300);
        const tags = Array.from(new Set([
            ...(normalized.feedTitle ? [normalized.feedTitle] : []),
            ...(Array.isArray(normalized.tags) ? normalized.tags : []),
        ]));
        // v3.14.6 (XN-03): feed 链接零校验直写(RSS 源不可信) —— 仅 http(s) 公网才写,
        // 否则跳过该属性(对称 BookmarkExporter 模式)
        const safeUrl = RSSAutoImporter._safeUrl(normalized.url);
        const properties = {
            "标题": {
                title: [{ text: { content: normalized.title } }]
            },
            "来源": {
                rich_text: [{ text: { content: "RSS" } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: "Feed" } }]
            },
        };
        if (safeUrl) {
            properties["链接"] = { url: safeUrl };
        }
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
            // P4 收敛(c07): 配额在 await 前预占 —— 并发 worker 各自读到旧计数会超发 AI 调用
            context.aiUsedCount = (context.aiUsedCount || 0) + 1;
            try {
                const aiCategory = await BookmarkExporter.generateAICategory(
                    { title: normalized.title, url: normalized.url },
                    { title: normalized.title, summary: normalized.summary },
                    settings
                );
                if (aiCategory) {
                    // F13 共识(RSS 白名单校验缺失): 与 BookmarkExporter SEC-008 同款,
                    // AI 返回的分类必须命中用户配置白名单(大小写归一)才采用,否则保留启发式。
                    const whitelisted = (settings?.categories || []).some(
                        (c) => String(c).trim().toLowerCase() === String(aiCategory).trim().toLowerCase()
                    );
                    if (whitelisted) {
                        enriched.inferredCategory = aiCategory;
                    } else {
                        console.warn(`[LD-Notion] RSS AI 分类不在白名单，使用启发式 fallback: ${aiCategory}`);
                    }
                }
            } catch (e) {
                // AI 分类失败降级到启发式，但留 warn + 计数保证可观测（H1，与 BookmarkExporter:288 一致）。
                console.warn("[LD-Notion] RSS AI 分类失败，使用启发式 fallback:", e);
                context.aiFailureCount = (context.aiFailureCount || 0) + 1;
            }
        }

        return enriched;
    },

    needsUpdate: (item, snapshotEntry, pageMeta) => {
        if (!pageMeta) return true;
        if (!snapshotEntry) return false;
        // P4 收敛(c07): 与写入侧同口径——_safeUrl 拒绝的链接不写入「链接」属性,
        // 直接比对 item.url 会每轮误判需更新(永不收敛)
        if (String(pageMeta.url || "") !== RSSAutoImporter._safeUrl(item.url)) return true;
        if (String(pageMeta.title || "") !== String(item.title || "")) return true;
        if (String(pageMeta.summary || "") !== String(item.summary || "")) return true;
        return SyncState.normalizeTime(pageMeta.publishedAt) !== SyncState.normalizeTime(item.publishedAt);
    },

    loadCurrentItems: async () => {
        const feedUrls = RSSAutoImporter.getFeedUrls();
        const dedupMode = RSSAutoImporter.getDedupMode();
        const itemsByKey = new Map();

        for (const feedUrl of feedUrls) {
            // 单 feed 失败不应阻断整次 RSS 同步（优雅降级）：重试用尽后 catch 记录并 continue。
            let parsed;
            try {
                parsed = await RSSAutoImporter.fetchFeedWithRetry(feedUrl);
            } catch (error) {
                console.error(`[LD-Notion] RSS feed 拉取失败（已重试），跳过: ${feedUrl}`, error);
                continue;
            }
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

        const syncResult = await SyncCoordinator.sync("rss", { commitWatermark: false });
        if (syncResult.error) {
            throw new Error(syncResult.error);
        }

        const setupResult = await BookmarkExporter.setupDatabaseProperties(settings.databaseId, settings.apiKey);
        if (!setupResult.success) {
            // v3.14.13 (M3): 透传认证终态标记 + authCode(与 BookmarkAutoImporter 同款), 场景文案分支可达。
            const setupError = new Error(`数据库配置失败: ${setupResult.error}`);
            if (setupResult.isAuthTerminal === true) {
                setupError.isAuthTerminal = true;
                setupError.authCode = setupResult.authCode || "unauthorized";
            }
            throw setupError;
        }

        const previousState = SyncState.getRssState();
        const previousSnapshot = previousState?.snapshot && typeof previousState.snapshot === "object"
            ? previousState.snapshot
            : {};

        let currentItems = syncResult.newItems || [];
        // F6 配套(RSS 派生缺陷⑤'): SyncCoordinator 增量路径的 newItems 无 itemKey 字段,
        // 须按当前去重模式补齐,否则成功标记与 snapshot 写"undefined"垃圾键。
        if (currentItems.length > 0) {
            const dedupMode = RSSAutoImporter.getDedupMode();
            currentItems = currentItems.map((item) => ({
                ...item,
                itemKey: item.itemKey || RSSAutoImporter.buildItemKey(item, dedupMode),
            }));
        }
        let feedCount = RSSAutoImporter.getFeedUrls().length;
        // P4 收敛(c07 2/3): 标记 currentItems 是否为完整 feed 条目集 —— 增量路径只含本轮新增项,
        // 不得据此剪枝历史快照(剪枝仅在全量回填路径生效)
        let hasFullItemSet = false;
        if (currentItems.length === 0) {
            const fallback = await RSSAutoImporter.loadCurrentItems();
            currentItems = fallback.items || [];
            feedCount = fallback.feedCount || feedCount;
            hasFullItemSet = true;
        }

        const trackedPages = await RSSAutoImporter.fetchTrackedPages(settings.databaseId, settings.apiKey);
        const index = RSSAutoImporter.buildPageIndex(trackedPages);

        return {
            syncResult,
            previousSnapshot,
            currentItems,
            feedCount,
            hasFullItemSet,
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
        // P4 收敛(c07): 标题非唯一键 —— byTitle 兑底仅在页面 URL 缺失或与条目一致时生效,
        // 否则同标题不同 URL 的条目会被绑定到同一页面并覆盖其内容
        const titleMatch = item.title ? index.byTitle.get(item.title) : null;
        const safeTitleMatch = titleMatch && (!titleMatch.url || !item.url || titleMatch.url === item.url)
            ? titleMatch
            : null;
        let pageMeta = (item.url ? index.byUrl.get(item.url) : null)
            || (snapshotEntry?.pageId ? index.byPageId.get(snapshotEntry.pageId) : null)
            || safeTitleMatch;

        let result = { created: 0, updated: 0, unchanged: 0, failed: 0, denied: 0, itemKey: item.itemKey };

        try {
            // v3.14.13 (P1-3): 每项开工前重读 token——buildSettings 快照在 OAuth 续签后
            // 失效, 快照整轮复用导致后续项 401+续签风暴(对齐 export/index.js:886 模式)。
            settings.apiKey = NotionOAuth.getAccessToken("");
            if (!pageMeta) {
                RSSAutoImporter.updateStatus(`正在新增 RSS 条目 (${ctx.position}/${total}): ${item.title}`);
                // createDatabasePage level 1，canExecute 非阻塞闸门 + 审计（C1）。
                const { OperationGuard } = require("../security");
                if (!OperationGuard.canExecute("createDatabasePage")) {
                    RSSAutoImporter._auditAutoSync("createDatabasePage", "denied",
                        { itemKey: item.itemKey, itemName: item.title, reason: "权限不足：RSS 自动同步建页需 level≥1" });
                    result.denied = 1;
                    if (snapshotEntry) nextSnapshot[item.itemKey] = snapshotEntry;
                    result.success = false;
                    return result;
                }
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
                RSSAutoImporter._auditAutoSync("createDatabasePage", "success",
                    { pageId: pageMeta.pageId, itemKey: item.itemKey, itemName: item.title, databaseId: settings.databaseId });
                result.created = 1;
            } else if (RSSAutoImporter.needsUpdate(item, snapshotEntry, pageMeta)) {
                RSSAutoImporter.updateStatus(`正在更新 RSS 条目 (${ctx.position}/${total}): ${item.title}`);
                const { OperationGuard } = require("../security");
                if (!OperationGuard.canExecute("updatePage")) {
                    RSSAutoImporter._auditAutoSync("updatePage", "denied",
                        { pageId: pageMeta.pageId, itemKey: item.itemKey, itemName: item.title, reason: "权限不足：RSS 自动同步更新需 level≥1" });
                    result.denied = 1;
                    // P4 收敛(c07): 不得为拒绝的更新伪造新快照(否则下轮被判 unchanged,
                    // 页面永远停在旧内容); 仅保留已有快照
                    if (snapshotEntry) nextSnapshot[item.itemKey] = snapshotEntry;
                    result.success = false;
                    return result;
                }
                const enriched = await RSSAutoImporter.enrichItem(item, settings, enrichContext);
                await NotionAPI.updatePage(pageMeta.pageId, RSSAutoImporter.buildProperties(enriched), settings.apiKey);
                RSSAutoImporter._auditAutoSync("updatePage", "success",
                    { pageId: pageMeta.pageId, itemKey: item.itemKey, itemName: item.title });
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
            // F6 共识(标记后置): Notion 写入成功后条目才进去重账本,失败项不落账、下轮重试。
            // unchanged 也须落账: 工作区已有页但对账未写入 DedupStore 时, 无 publishedAt 的条目
            // 会因 watermark 过滤 `!itemTime → 保留` 每轮进入 newItems, 反复打 Notion 查询。
            // 键空间与 RSSAdapter.getDedupKey / buildDedupStoreKey 对齐(含 allow_duplicates)。
            if (result.created || result.updated || result.unchanged) {
                SyncCoordinator.markItemSeen("rss", RSSAutoImporter.buildDedupStoreKey(item));
            }
            nextSnapshot[item.itemKey] = RSSAutoImporter.buildSnapshotEntry(item, pageId);
            result.success = true;
            return result;
        } catch (error) {
            // v3.14.13 (P1-3): 认证终态错误(401/403)不吞——抛原 error 中止整轮循环,
            // 避免剩余项重复注定失败的请求; 原 error 携带 authCode 供外层 catch 分支文案。
            if (error && error.isAuthTerminal === true) {
                throw error;
            }
            console.error(`[LD-Notion] RSS 自动同步失败: ${item.title || item.url}`, error);
            RSSAutoImporter._auditAutoSync("createDatabasePage", "failed",
                { itemKey: item.itemKey, itemName: item.title || item.url, reason: String(error?.message || error) });
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
        const { currentItems, feedCount, nextSnapshot, hasFullItemSet } = ctx;
        const { created, updated, unchanged, failed } = stats;

        // v3.14.6 (DC-006): nextSnapshot 从 {...previousSnapshot} 起步只增不删 →
        // feed 移除条目永驻, 无界增长违容量约束; 收尾按当前项键集剪枝
        // (失败项也在 currentItems 中, snapshot 保留语义不变)
        // P4 收敛(c07 2/3): 仅当 currentItems 为完整 feed 条目集(全量路径)且非空时剪枝 ——
        // 无信息不等于条目已消失(全部 feed 拉取失败/增量路径均不得清空 pageId 快照)
        if (hasFullItemSet && currentItems.length > 0) {
            const keptKeys = new Set(currentItems.map((item) => item.itemKey));
            for (const key of Object.keys(nextSnapshot)) {
                if (!keptKeys.has(key)) delete nextSnapshot[key];
            }
        }

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
                // R2: P0-4 的 stats.denied 须同落持久化, 否则同步中心读态丢失 denied 计数
                denied: stats.denied || 0,
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

        if (created === 0 && updated === 0 && failed === 0 && (stats.denied || 0) === 0) {
            RSSAutoImporter.updateStatus(`RSS 已同步，无新增变更 (${new Date().toLocaleTimeString()})`);
            return;
        }

        // v3.14.17 (P0-4): 权限不足聚合提示——不再静默丢弃
        const deniedMsg = (stats.denied || 0) > 0 ? `，${stats.denied} 项因权限不足跳过（可在设置中提升权限级别）` : "";
        RSSAutoImporter.updateStatus(
            `RSS 自动同步完成：新增 ${created}，更新 ${updated}，无变更 ${unchanged}`
            + `${failed > 0 ? `，失败 ${failed}` : ""}${deniedMsg}`
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
        // v3.14.6 (CC-03): 占用导出互斥, 防并发交错; finally 复位
        SyncLock.isExporting = true;
        // F8: 跨 tab 租约(CC-04 书签侧同款) —— 仅进程内 isExporting 防不住双 tab 并发建页竞态;
        // 与书签共用 AUTO_SYNC_LEASE(全局自动同步互斥, 跨 tab RSS×书签也串行)
        // 三模型共识(P1): acquireLease 抛错必须复位 isRunning/isExporting, 否则永久瘫痪
        let lease = null;
        try {
            lease = await SyncLock.acquireLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE);
        } catch (error) {
            RSSAutoImporter.isRunning = false;
            SyncLock.isExporting = false;
            console.error("[LD-Notion] RSS 自动同步获取租约失败:", error);
            RSSAutoImporter.updateStatus("❌ 获取同步租约失败，本轮跳过");
            return;
        }
        if (!lease) {
            RSSAutoImporter.isRunning = false;
            SyncLock.isExporting = false;
            RSSAutoImporter.updateStatus("⏸ 其他标签页正在同步，本轮 RSS 同步跳过");
            return;
        }
        // S1: 持有期间每 30s 续约; 续约失配(租约被其他 tab 抢占)置 leaseLost 中止本轮
        let leaseLost = false;
        const renewTimer = setInterval(() => {
            // dsf P1 共识: 续约抛错必须视为失租, 否则异常逃逸且 leaseLost 永不置位
            let renewed;
            try {
                renewed = SyncLock.renewLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);
            } catch (renewError) {
                console.warn("[LD-Notion] RSS 自动同步续约失败:", renewError);
                renewed = false;
            }
            if (!renewed) {
                leaseLost = true;
                clearInterval(renewTimer);
            }
        }, 30000);
        const attemptAt = Date.now();

        try {
            const ctx = await RSSAutoImporter._initSyncContext(settings, attemptAt);

            const stats = { created: 0, updated: 0, unchanged: 0, failed: 0, denied: 0 };
            const successfulKeys = new Set();
            // v3.14.6 (DC-004): run 级 batch —— markItemSeen 落账缓存化, 单次 flush; finally 兜底
            const { DedupStore } = require("../storage");
            DedupStore.beginBatch("rss");
            try {

            for (let i = 0; i < ctx.currentItems.length && !leaseLost; i++) {
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
                stats.denied += r.denied || 0;
                if (r.success) successfulKeys.add(r.itemKey);

                if (ctx.delay > 0 && i < ctx.currentItems.length - 1) {
                    await Utils.sleep(ctx.delay);
                }
            }

            RSSAutoImporter._aggregateRssState(ctx, stats, successfulKeys, attemptAt);
            // S1: 中止轮在持久化(聚合已落盘)后覆写状态文案, 已处理部分记录不丢
            if (leaseLost) {
                RSSAutoImporter.updateStatus("⏸ 同步租约已被其他标签页接管，本轮 RSS 同步中止（已处理部分已记录）");
            }
            } finally {
                // v3.14.6 (DC-004): 结束 batch —— 异常路径也单次 flush
                DedupStore.endBatch("rss");
            }
        } catch (error) {
            console.error("[LD-Notion] RSS 自动同步出错:", error);
            SyncState.updateRssState({
                lastAttemptAt: attemptAt,
                lastOutcome: "error",
                lastError: error?.message || String(error),
                lastStats: {},
            });
            // v3.14.13 (三模型共识): 按 authCode 分支
            const authCode = String(error?.authCode || "").toLowerCase();
            let statusText = `RSS 自动同步出错: ${error.message}`;
            if (authCode === "empty_token") {
                statusText = "RSS 自动同步出错: 未读取到已保存的 API Key，请重新保存（或重新 OAuth 一键授权）";
            } else if (authCode === "unauthorized" || authCode === "invalid_bearer_token") {
                statusText = "RSS 自动同步出错: Notion 拒绝了该 API Key（可能已失效或复制不完整），请重新复制保存或重新 OAuth 授权";
            }
            RSSAutoImporter.updateStatus(statusText);
        } finally {
            clearInterval(renewTimer);
            SyncLock.releaseLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);
            RSSAutoImporter.isRunning = false;
            // v3.14.6 (CC-03): 复位互斥
            SyncLock.isExporting = false;
            emit("sync:center-summary-updated");
        }
    },

    init: () => {
        if (!RSSAutoImporter.canStart()) return;
        RSSAutoImporter.ensureVisibilityListener();
        if (RSSAutoImporter.initTimerId) clearTimeout(RSSAutoImporter.initTimerId);
        RSSAutoImporter.initTimerId = setTimeout(() => {
            RSSAutoImporter.initTimerId = null;
            // 延迟窗口内可能已被禁用(stopPolling 已清理时此路不达; 双保险防竞态)
            if (!Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, false)) return;
            Utils.runWhenBrowserIdle(() => {
                // glm P1 共识: idle 回调排队期间可能已被禁用(外层检查只覆盖 3s 延迟窗口)
                if (!Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, false)) return;
                RSSAutoImporter.run();
            });
            const interval = Storage.get(
                CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL,
                CONFIG.DEFAULTS.rssAutoImportInterval
            );
            if (interval > 0) RSSAutoImporter.startPolling(interval);
        }, 3000);
    },
};

module.exports = { RSSAutoImporter };
