"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { NotionAPI, DOMToNotion, SiteDetector, InstallHelper } = require("../api");
const { OperationGuard, UndoManager, OperationLog } = require("../security");
const { GenericExtractor, WorkspaceService } = require("../extract");
const { SyncLock } = require("../sync-lock");
const { SyncCoordinator } = require("../adapter/SyncCoordinator");

var __LD_NOTION_BUILD_BOOKMARK_BRIDGE_START__ = "[LD-NOTION-BUILD:BOOKMARK_BRIDGE_START]";
const BookmarkBridge = {
    _requestId: 0,
    _pendingRequests: {},

    // 检测配套 Chrome 扩展是否已安装
    isExtensionAvailable: () => {
        return !!document.querySelector('meta[name="ld-notion-ext"][content="ready"]');
    },

    // 发起书签请求
    _request: (eventName, detail = {}) => {
        return new Promise((resolve, reject) => {
            if (!BookmarkBridge.isExtensionAvailable()) {
                const installUrl = InstallHelper.getBookmarkExtensionUrl();
                reject(new Error(`未检测到 LD-Notion 书签桥接扩展。请先安装：${installUrl}`));
                return;
            }

            const requestId = `req_${++BookmarkBridge._requestId}_${Date.now()}`;
            const timeout = setTimeout(() => {
                delete BookmarkBridge._pendingRequests[requestId];
                reject(new Error("书签请求超时，请检查扩展是否正常运行。"));
            }, 10000);

            BookmarkBridge._pendingRequests[requestId] = { resolve, reject, timeout };

            window.dispatchEvent(new CustomEvent(eventName, {
                detail: { requestId, ...detail }
            }));
        });
    },

    // 获取书签树
    getBookmarkTree: () => {
        return BookmarkBridge._request("ld-notion-request-bookmarks");
    },

    // 获取指定文件夹的书签
    getBookmarks: (folderId) => {
        return BookmarkBridge._request("ld-notion-request-bookmarks", { folderId });
    },

    // 搜索书签
    searchBookmarks: (query) => {
        return BookmarkBridge._request("ld-notion-search-bookmarks", { query });
    },

    // 初始化响应监听器
    init: () => {
        window.addEventListener("ld-notion-bookmarks-data", (event) => {
            const { requestId, success, data, error } = event.detail || {};
            const pending = BookmarkBridge._pendingRequests[requestId];
            if (!pending) return;

            clearTimeout(pending.timeout);
            delete BookmarkBridge._pendingRequests[requestId];

            if (success) {
                pending.resolve(data);
            } else {
                pending.reject(new Error(error || "书签请求失败"));
            }
        });
    },
};
var __LD_NOTION_BUILD_BOOKMARK_BRIDGE_END__ = "[LD-NOTION-BUILD:BOOKMARK_BRIDGE_END]";

const BookmarkExporter = {
    _pageInsightCache: {},

    // 展平书签树为列表，记录文件夹路径
    flattenTree: (nodes, parentPath = "") => {
        const result = [];
        for (const node of nodes) {
            const currentPath = parentPath ? `${parentPath} / ${node.title}` : node.title;
            if (node.url) {
                // 书签项
                result.push({
                    title: node.title || node.url,
                    url: node.url,
                    folderPath: parentPath,
                    dateAdded: node.dateAdded ? new Date(node.dateAdded).toISOString() : null,
                    id: node.id,
                });
            }
            if (node.children) {
                result.push(...BookmarkExporter.flattenTree(node.children, currentPath));
            }
        }
        return result;
    },

    isHttpUrl: (url) => /^https?:\/\//i.test(url || ""),

    normalizeText: (text, maxLen = 280) => {
        if (!text) return "";
        const normalized = String(text)
            .replace(/[﻿​-‍⁠]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        return normalized.substring(0, maxLen);
    },

    normalizeCharset: (charset) => {
        const value = String(charset || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();
        if (!value) return "";
        if (value === "utf8") return "utf-8";
        if (value === "gbk" || value === "gb2312") return "gb18030";
        if (value === "big-5") return "big5";
        if (value === "shift-jis" || value === "sjis") return "shift_jis";
        return value;
    },

    extractCharsetFromHeaders: (responseHeaders) => {
        const headers = String(responseHeaders || "");
        if (!headers) return "";
        const match = headers.match(/content-type\s*:\s*[^\r\n]*charset\s*=\s*([^\s;"']+)/i);
        return BookmarkExporter.normalizeCharset(match?.[1] || "");
    },

    extractCharsetFromHtmlHead: (bytes) => {
        if (!(bytes instanceof Uint8Array) || bytes.length === 0) return "";
        try {
            const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
            const charsetMatch = head.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'>/]+)/i);
            if (charsetMatch?.[1]) {
                return BookmarkExporter.normalizeCharset(charsetMatch[1]);
            }
            const httpEquivMatch = head.match(/<meta[^>]+http-equiv\s*=\s*["']content-type["'][^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i);
            return BookmarkExporter.normalizeCharset(httpEquivMatch?.[1] || "");
        } catch {
            return "";
        }
    },

    getResponseBytes: (response) => {
        const raw = response?.response;
        if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
        if (raw instanceof Uint8Array) return raw;
        return null;
    },

    decodeHtmlFromResponse: (response) => {
        const fallbackText = String(response?.responseText || "");
        const bytes = BookmarkExporter.getResponseBytes(response);
        if (!bytes || bytes.length === 0) return fallbackText;

        const headerCharset = BookmarkExporter.extractCharsetFromHeaders(response?.responseHeaders || "");
        const htmlCharset = BookmarkExporter.extractCharsetFromHtmlHead(bytes);
        const candidates = [headerCharset, htmlCharset, "utf-8", "gb18030", "big5", "shift_jis"];
        const tried = new Set();
        let firstDecoded = "";

        for (const candidate of candidates) {
            const charset = BookmarkExporter.normalizeCharset(candidate);
            if (!charset || tried.has(charset)) continue;
            tried.add(charset);
            try {
                const decoded = new TextDecoder(charset).decode(bytes);
                if (!decoded) continue;
                if (!firstDecoded) firstDecoded = decoded;
                if (!decoded.includes("�")) return decoded;
            } catch {
                // ignore and continue trying next charset
            }
        }

        return firstDecoded || fallbackText;
    },

    composeTitleWithPrefix: (prefix, candidate, maxLen = 180) => {
        const safePrefix = BookmarkExporter.normalizeText(prefix, maxLen);
        const safeCandidate = BookmarkExporter.normalizeText(candidate, maxLen);
        if (!safePrefix) return safeCandidate || "无标题书签";
        if (!safeCandidate || safeCandidate === safePrefix) return safePrefix;
        if (safeCandidate.startsWith(`${safePrefix} - `) || safeCandidate.startsWith(`${safePrefix} · `)) {
            return safeCandidate.substring(0, maxLen);
        }
        return `${safePrefix} · ${safeCandidate}`.substring(0, maxLen);
    },

    extractPageInsightFromHtml: (html, url) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html || "", "text/html");
        const meta = (name) => {
            const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
            return el?.getAttribute("content") || "";
        };

        doc.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());

        const title = BookmarkExporter.normalizeText(
            meta("og:title") ||
            doc.querySelector("title")?.textContent ||
            doc.querySelector("h1")?.textContent ||
            meta("twitter:title") ||
            ""
        , 180);

        const description = BookmarkExporter.normalizeText(
            meta("og:description") ||
            meta("description") ||
            meta("twitter:description") ||
            ""
        , 260);

        const bodyText = BookmarkExporter.normalizeText(doc.body?.textContent || "", 600);
        const summary = description || bodyText;

        return {
            title,
            summary,
            siteName: BookmarkExporter.normalizeText(meta("og:site_name") || "", 80),
            sourceUrl: url,
        };
    },

    fetchPageInsight: (url) => {
        const cached = BookmarkExporter._pageInsightCache[url];
        if (cached) return Promise.resolve(cached);

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                timeout: 12000,
                responseType: "arraybuffer",
                headers: {
                    "Accept": "text/html,application/xhtml+xml",
                },
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    try {
                        const html = BookmarkExporter.decodeHtmlFromResponse(response);
                        const insight = BookmarkExporter.extractPageInsightFromHtml(html, url);
                        BookmarkExporter._pageInsightCache[url] = insight;
                        resolve(insight);
                    } catch (e) {
                        reject(e);
                    }
                },
                ontimeout: () => reject(new Error("页面读取超时")),
                onerror: () => reject(new Error("页面读取失败")),
            });
        });
    },

    generateAISummary: async (bookmark, insight, settings) => {
        if (!settings?.aiApiKey || !settings?.aiService) return null;

        const prompt = `请根据以下网页信息生成书签标题和摘要，要求：\n1) 标题 30 字以内\n2) 摘要 90 字以内\n3) 使用中文\n4) 仅返回 JSON，不要其他内容\n\nJSON 格式：{"title":"...","summary":"..."}\n\n网页 URL：${bookmark.url}\n原始标题：${bookmark.title || ""}\n页面标题：${insight.title || ""}\n页面摘要：${insight.summary || ""}`;

        try {
            const response = await AIService.requestChat(prompt, settings, 220);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;
            const data = JSON.parse(jsonMatch[0]);
            return {
                title: BookmarkExporter.normalizeText(data.title || "", 120),
                summary: BookmarkExporter.normalizeText(data.summary || "", 180),
            };
        } catch {
            return null;
        }
    },

    inferCategoryHeuristic: (bookmark, insight, categories = []) => {
        const available = (categories || []).map(c => String(c || "").trim()).filter(Boolean);
        if (available.length === 0) return "";

        const text = `${bookmark.folderPath || ""} ${bookmark.title || ""} ${insight.title || ""} ${insight.summary || ""} ${bookmark.url || ""}`.toLowerCase();

        for (const cat of available) {
            if (text.includes(cat.toLowerCase())) {
                return cat;
            }
        }

        const rules = [
            { keys: ["github", "gitlab", "repo", "docker", "k8s", "linux", "dev", "code", "programming", "技术", "开发", "编程"], hints: ["技术", "开发", "编程"] },
            { keys: ["news", "blog", "article", "文章", "博客", "资讯"], hints: ["分享", "资源"] },
            { keys: ["stack", "stackoverflow", "ask", "question", "qa", "问答", "问题"], hints: ["问答"] },
            { keys: ["life", "travel", "food", "movie", "music", "生活", "日常", "旅游", "美食"], hints: ["生活"] },
            { keys: ["resource", "docs", "tutorial", "guide", "文档", "教程", "手册", "资源"], hints: ["资源"] },
        ];

        for (const rule of rules) {
            if (!rule.keys.some(k => text.includes(k))) continue;
            const matched = available.find(cat => rule.hints.some(h => cat.includes(h)));
            if (matched) return matched;
        }

        const fallback = available.find(cat => cat.includes("其他"));
        return fallback || available[available.length - 1];
    },

    inferTags: (bookmark, insight) => {
        const tags = [];
        const host = (() => {
            try {
                return new URL(bookmark.url).hostname.replace(/^www\./, "");
            } catch {
                return "";
            }
        })();
        if (host) tags.push(host);

        if (bookmark.folderPath) {
            const firstFolder = BookmarkExporter.normalizeText(String(bookmark.folderPath).split("/")[0] || "", 40);
            if (firstFolder) tags.push(firstFolder);
        }

        if (insight.siteName) {
            tags.push(BookmarkExporter.normalizeText(insight.siteName, 40));
        }

        const uniq = [];
        for (const t of tags) {
            const clean = BookmarkExporter.normalizeText(t, 80);
            if (!clean) continue;
            if (uniq.includes(clean)) continue;
            uniq.push(clean);
            if (uniq.length >= 5) break;
        }
        return uniq;
    },

    generateAICategory: async (bookmark, insight, settings) => {
        const categories = Array.isArray(settings?.categories) ? settings.categories.filter(Boolean) : [];
        if (!settings?.aiApiKey || !settings?.aiService || categories.length === 0) return "";

        try {
            return await AIService.classify(
                insight.title || bookmark.title || "",
                insight.summary || "",
                categories,
                settings
            );
        } catch {
            return "";
        }
    },

    enrichBookmark: async (bookmark, settings, context = {}) => {
        const enriched = { ...bookmark };
        const prefix = BookmarkExporter.normalizeText(bookmark.title || "无标题书签", 120) || "无标题书签";
        const fallbackTitle = BookmarkExporter.composeTitleWithPrefix(prefix, "", 180);

        if (!BookmarkExporter.isHttpUrl(bookmark.url)) {
            enriched.generatedTitle = fallbackTitle;
            enriched.generatedSummary = "非网页链接，跳过页面摘要";
            enriched.inferredCategory = BookmarkExporter.inferCategoryHeuristic(bookmark, { title: "", summary: "" }, settings?.categories || []);
            enriched.inferredTags = BookmarkExporter.inferTags(bookmark, { siteName: "" });
            return enriched;
        }

        try {
            const insight = await BookmarkExporter.fetchPageInsight(bookmark.url);
            enriched.generatedTitle = BookmarkExporter.composeTitleWithPrefix(prefix, insight.title || "", 180);
            enriched.generatedSummary = insight.summary || "";

            let inferredCategory = BookmarkExporter.inferCategoryHeuristic(bookmark, insight, settings?.categories || []);
            enriched.inferredTags = BookmarkExporter.inferTags(bookmark, insight);

            const canUseAI = !!(settings?.aiApiKey && settings?.aiService);
            const aiMaxItems = Number.isFinite(context.aiMaxItems) ? context.aiMaxItems : 20;
            if (canUseAI && (context.aiUsedCount || 0) < aiMaxItems) {
                const aiResult = await BookmarkExporter.generateAISummary(bookmark, insight, settings);
                if (aiResult?.title) {
                    enriched.generatedTitle = BookmarkExporter.composeTitleWithPrefix(prefix, aiResult.title, 180);
                }
                if (aiResult?.summary) {
                    enriched.generatedSummary = aiResult.summary;
                }
                const aiCategory = await BookmarkExporter.generateAICategory(bookmark, insight, settings);
                if (aiCategory) {
                    inferredCategory = aiCategory;
                }
                context.aiUsedCount = (context.aiUsedCount || 0) + 1;
            }
            enriched.inferredCategory = inferredCategory;
        } catch {
            enriched.generatedTitle = fallbackTitle;
            enriched.generatedSummary = "";
            enriched.inferredCategory = BookmarkExporter.inferCategoryHeuristic(bookmark, { title: "", summary: "" }, settings?.categories || []);
            enriched.inferredTags = BookmarkExporter.inferTags(bookmark, { siteName: "" });
        }

        return enriched;
    },

    // 构建 Notion 属性
    buildProperties: (bookmark) => {
        const title = BookmarkExporter.normalizeText(bookmark.generatedTitle || bookmark.title || "无标题书签", 2000) || "无标题书签";
        const summary = BookmarkExporter.normalizeText(bookmark.generatedSummary || "", 1900);
        const bookmarkId = BookmarkExporter.normalizeText(String(bookmark.id || ""), 200);

        const props = {
            "标题": {
                title: [{ text: { content: title } }]
            },
            "链接": {
                url: bookmark.url
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
                rich_text: [{ text: { content: (bookmark.folderPath || "").substring(0, 2000) } }]
            },
        };
        if (summary) {
            props["描述"] = { rich_text: [{ text: { content: summary } }] };
        }
        if (bookmark.inferredCategory) {
            props["分类"] = {
                rich_text: [{ text: { content: BookmarkExporter.normalizeText(bookmark.inferredCategory, 300) } }]
            };
        }
        const tags = Array.isArray(bookmark.inferredTags) ? bookmark.inferredTags : [];
        if (tags.length > 0) {
            props["标签"] = {
                multi_select: tags
                    .map(tag => BookmarkExporter.normalizeText(tag, 100))
                    .filter(Boolean)
                    .map(name => ({ name }))
                    .slice(0, 8)
            };
        }
        if (bookmark.dateAdded) {
            props["收藏时间"] = { date: { start: bookmark.dateAdded } };
        }
        return props;
    },

    // 配置数据库属性
    setupDatabaseProperties: async (databaseId, apiKey) => {
        const requiredProperties = {
            "标题": { typeName: "title", schema: { title: {} } },
            "链接": { typeName: "url", schema: { url: {} } },
            "书签ID": { typeName: "rich_text", schema: { rich_text: {} } },
            "来源": { typeName: "rich_text", schema: { rich_text: {} } },
            "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
            "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
            "书签路径": { typeName: "rich_text", schema: { rich_text: {} } },
            "收藏时间": { typeName: "date", schema: { date: {} } },
            "分类": { typeName: "rich_text", schema: { rich_text: {} } },
            "描述": { typeName: "rich_text", schema: { rich_text: {} } },
        };

        try {
            const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
            const existingProps = database.properties || {};
            const propsToAdd = {};
            const propsToUpdate = {};

            for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                const existingProp = existingProps[name];
                if (!existingProp) {
                    if (typeName === "title") {
                        const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                        if (existingTitle && existingTitle[0] !== name) {
                            propsToUpdate[existingTitle[0]] = { name: name };
                        }
                    } else {
                        propsToAdd[name] = schema;
                    }
                }
            }

            const allChanges = { ...propsToAdd, ...propsToUpdate };
            if (Object.keys(allChanges).length > 0) {
                await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                    properties: allChanges,
                }, apiKey);
            }

            return { success: true, added: Object.keys(propsToAdd) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // 获取已导出的书签集合
    getExported: () => {
        try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, "{}")); }
        catch { return {}; }
    },

    markExported: (bookmarkUrl) => {
        const exported = BookmarkExporter.getExported();
        exported[bookmarkUrl] = Date.now();
        Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, JSON.stringify(exported));
    },

    isExported: (bookmarkUrl) => {
        return !!BookmarkExporter.getExported()[bookmarkUrl];
    },

    // 导出书签到 Notion
    exportBookmarks: async (settings, onProgress) => {
        const { apiKey, databaseId, bookmarks } = settings;

        if (!apiKey || !databaseId) {
            throw new Error("请先配置 Notion API Key 和数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        const setupResult = await BookmarkExporter.setupDatabaseProperties(databaseId, apiKey);
        if (!setupResult.success) {
            throw new Error(`数据库配置失败: ${setupResult.error}`);
        }

        // 过滤已导出的
        const dedupStrict = Utils.isBookmarkDedupStrict();
        const newBookmarks = dedupStrict
            ? bookmarks.filter(b => !BookmarkExporter.isExported(b.url))
            : bookmarks.slice();
        if (newBookmarks.length === 0) {
            return { total: bookmarks.length, exported: 0, message: "没有新的书签需要导出" };
        }

        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        let success = 0, failed = 0;
        const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };

        for (let i = 0; i < newBookmarks.length; i++) {
            const bm = newBookmarks[i];
            const pct = Math.round(5 + (i / newBookmarks.length) * 90);
            if (onProgress) onProgress(`正在导出 (${i + 1}/${newBookmarks.length}): ${bm.title}`, pct);

            try {
                const enriched = await BookmarkExporter.enrichBookmark(bm, settings, enrichContext);
                const properties = BookmarkExporter.buildProperties(enriched);
                await NotionAPI.request("POST", "/pages", {
                    parent: { database_id: databaseId },
                    properties,
                }, apiKey);
                BookmarkExporter.markExported(bm.url);
                success++;
            } catch (e) {
                console.warn(`[BookmarkExporter] 导出失败: ${bm.url}`, e);
                failed++;
            }

            if (i < newBookmarks.length - 1) {
                await new Promise(r => setTimeout(r, delay));
            }
        }

        return { total: bookmarks.length, exported: success, failed, newCount: newBookmarks.length };
    },
};

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
        if (!BookmarkBridge.isExtensionAvailable()) return false;
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
    },

    startPolling: (intervalMinutes) => {
        BookmarkAutoImporter.stopPolling();
        if (intervalMinutes > 0) {
            BookmarkAutoImporter.timerId = setInterval(
                () => Utils.runWhenBrowserIdle(() => BookmarkAutoImporter.run()),
                intervalMinutes * 60 * 1000
            );
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
        const tree = await BookmarkBridge.getBookmarkTree();
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
    if (!BookmarkBridge.isExtensionAvailable()) {
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
            SyncState.updateRssState({
                lastAttemptAt: attemptAt,
                lastOutcome: "running",
                lastError: "",
                lastStats: {},
            });
            RSSAutoImporter.updateStatus("正在同步 RSS Feed...");

            // 使用 SyncCoordinator 获取增量同步概要 (统一状态管理)
            await SyncCoordinator.sync("rss");

            const setupResult = await BookmarkExporter.setupDatabaseProperties(settings.databaseId, settings.apiKey);
            if (!setupResult.success) {
                throw new Error(`数据库配置失败: ${setupResult.error}`);
            }

            const previousState = SyncState.getRssState();
            const previousSnapshot = previousState?.snapshot && typeof previousState.snapshot === "object"
                ? previousState.snapshot
                : {};
            const { items: currentItems, feedCount } = await RSSAutoImporter.loadCurrentItems();
            const trackedPages = await RSSAutoImporter.fetchTrackedPages(settings.databaseId, settings.apiKey);
            const index = RSSAutoImporter.buildPageIndex(trackedPages);
            const nextSnapshot = {
                ...previousSnapshot,
            };
            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };
            const successfulKeys = new Set();

            let created = 0;
            let updated = 0;
            let unchanged = 0;
            let failed = 0;

            for (let i = 0; i < currentItems.length; i++) {
                const item = currentItems[i];
                const snapshotEntry = previousSnapshot[item.itemKey] || null;
                let pageMeta = (item.url ? index.byUrl.get(item.url) : null)
                    || (snapshotEntry?.pageId ? index.byPageId.get(snapshotEntry.pageId) : null)
                    || (item.title ? index.byTitle.get(item.title) : null);

                try {
                    if (!pageMeta) {
                        RSSAutoImporter.updateStatus(`正在新增 RSS 条目 (${i + 1}/${currentItems.length}): ${item.title}`);
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
                        created++;
                    } else if (RSSAutoImporter.needsUpdate(item, snapshotEntry, pageMeta)) {
                        RSSAutoImporter.updateStatus(`正在更新 RSS 条目 (${i + 1}/${currentItems.length}): ${item.title}`);
                        const enriched = await RSSAutoImporter.enrichItem(item, settings, enrichContext);
                        await NotionAPI.updatePage(pageMeta.pageId, RSSAutoImporter.buildProperties(enriched), settings.apiKey);
                        updated++;
                    } else {
                        unchanged++;
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
                    successfulKeys.add(item.itemKey);
                } catch (error) {
                    console.error(`[LD-Notion] RSS 自动同步失败: ${item.title || item.url}`, error);
                    failed++;
                    if (snapshotEntry) {
                        nextSnapshot[item.itemKey] = snapshotEntry;
                    }
                }

                if (delay > 0 && i < currentItems.length - 1) {
                    await Utils.sleep(delay);
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

module.exports = { BookmarkBridge, BookmarkExporter, BookmarkAutoImporter, RSSAutoImporter };
