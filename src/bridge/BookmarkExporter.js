"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");
const { AIService } = require("../ai");

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
        } catch (error) {
            console.warn("[LD-Notion] 字符集检测失败:", error);
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
            } catch (error) {
                console.warn("[LD-Notion] 尝试字符集解码失败:", error);
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
        } catch (error) {
            console.warn("[LD-Notion] 页面洞察 JSON 解析失败:", error);
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
            } catch (error) {
                console.warn("[LD-Notion] 书签 URL 解析失败:", error);
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
        } catch (error) {
            console.warn("[LD-Notion] AI 分类失败:", error);
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
        } catch (error) {
            console.warn("[LD-Notion] 书签增强失败，使用 fallback:", error);
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
        catch (error) {
            console.warn("[LD-Notion] 已导出书签集合解析失败:", error);
            return {};
        }
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

module.exports = { BookmarkExporter };
