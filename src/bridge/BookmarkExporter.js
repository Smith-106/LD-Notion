"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");
const { AIService } = require("../ai");
// ISS-20260723-010 W8 (SEC-009): generateAISummary 改用 AISchema.parseAIJson 统一接缝，
// 不再手工 jsonMatch + JSON.parse（arch-013 第 8 消费点收敛）。schema.js 纯函数无循环依赖。
const { AISchema } = require("../ai/schema");

const BookmarkExporter = {
    _pageInsightCache: {},
    // FIFO 上限（PERF-005）：_pageInsightCache 原为无界普通对象，长会话累积内存泄漏。
    // 超 MAX_INSIGHT_CACHE 时删最旧 key（Object.keys 保插入顺序），仿 AgentTrace.MAX_TRACES=50 的 FIFO rotate 模式。
    MAX_INSIGHT_CACHE: 50,
    // P4 共识(glm+qwen): 页面洞察只取 <head> 元信息, 响应字节上限 2MB 防超大页面内存耗尽/多次全量解码卡死
    MAX_INSIGHT_BYTES: 2 * 1024 * 1024,
    // 已导出书签映射缓存（H5：消除循环内逐条 JSON.parse+stringify 的 O(N²)）。
    // getExported 命中缓存返对象引用，markExported 就地 mutate 缓存 + 单次 stringify 写回。
    _exportedCache: null,

    // 用户触发导出的写入审计（ISS-20260724-011，CWE-862/778）。与 BookmarkAutoImporter._auditAutoSync
    // 同模式但信任边界不同：用户主动触发（actor="user"）而非系统自动同步（actor="system"）。
    // canExecute 非阻塞闸门管权限，审计管可观测性——谁在何时建/改了哪些页面可事后追溯。
    _auditExport: (operation, status, context = {}) => {
        try {
            const { OperationLog } = require("../security");
            OperationLog.add({
                audit_event: OperationLog.inferAuditEvent(operation, status),
                actor: "user",
                source: "bookmark-export",
                operationName: operation,
                status,
                context,
            });
        } catch (e) {
            console.warn("[LD-Notion] 书签导出审计写入失败:", e);
        }
    },

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
                    dateAdded: (() => {
                        if (!node.dateAdded) return null;
                        const d = new Date(node.dateAdded);
                        return Number.isNaN(d.getTime()) ? null : d.toISOString();
                    })(),
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
        const rawBytes = BookmarkExporter.getResponseBytes(response);
        if (!rawBytes || rawBytes.length === 0) return fallbackText;
        // P4 共识(glm+qwen): 无字节上限 —— 超大响应会内存耗尽/多次全量解码卡死。
        const bytes = rawBytes.length > BookmarkExporter.MAX_INSIGHT_BYTES
            ? rawBytes.subarray(0, BookmarkExporter.MAX_INSIGHT_BYTES)
            : rawBytes;

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
        // P4 共识(glm): 书签 URL 可指向内网/云元数据(127.0.0.1/10.x/169.254.169.254),
        // GM_xmlhttpRequest 会以用户会话抓取 → 标题摘要入 Notion 造成内网数据外泄。
        // 复用 UrlValidator(http(s) 且非内网/可疑宿主), 与 DOMToNotion._safeExternalUrl 同源。
        const { UrlValidator } = require("../security/UrlValidator");
        if (!UrlValidator.validatePageExternalUrl(url)) {
            return Promise.reject(new Error("URL 未通过安全校验(非 http(s) 或内网地址)"));
        }
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
                        // FIFO 淘汰（PERF-005）：超上限删最旧 key 防无界内存泄漏
                        const keys = Object.keys(BookmarkExporter._pageInsightCache);
                        if (keys.length >= BookmarkExporter.MAX_INSIGHT_CACHE) {
                            delete BookmarkExporter._pageInsightCache[keys[0]];
                        }
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

        const prompt = `请根据以下网页信息生成书签标题和摘要，要求：\n1) 标题 30 字以内\n2) 摘要 90 字以内\n3) 使用中文\n4) 仅返回 JSON，不要其他内容\n\nJSON 格式：{"title":"...","summary":"..."}\n\n网页 URL：${AIService.isolateContent(bookmark.url)}\n原始标题：${AIService.isolateContent(bookmark.title || "")}\n页面标题：${AIService.isolateContent(insight.title || "")}\n页面摘要：${AIService.isolateContent(insight.summary || "")}`;

        try {
            const response = await AIService.requestChat(prompt, settings, 220);
            // SEC-009: 走 AISchema.parseAIJson 统一接缝（arch-013），含 bookmarkSummary 结构校验
            // （title/summary 必须为 string，防 AI 返回非字符串注入 CWE-94）。校验失败降级返回 null。
            const parsed = AISchema.parseAIJson("bookmarkSummary", response);
            if (!parsed.ok) return null;
            const data = parsed.value;
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
                // P4 共识(dsf): 计数此前在两次 await 之后 —— 失败路径不计入, 上限可被突破。
                // 改为请求前预占(成本闸门语义: 计入已发起的调用)。
                context.aiUsedCount = (context.aiUsedCount || 0) + 1;
                const aiResult = await BookmarkExporter.generateAISummary(bookmark, insight, settings);
                if (aiResult?.title) {
                    enriched.generatedTitle = BookmarkExporter.composeTitleWithPrefix(prefix, aiResult.title, 180);
                }
                if (aiResult?.summary) {
                    enriched.generatedSummary = aiResult.summary;
                }
                const aiCategory = await BookmarkExporter.generateAICategory(bookmark, insight, settings);
                // SEC-008: AI 返回的 category 必须在用户配置白名单内才采用，否则保留 heuristic
                // 的 inferredCategory（inferCategoryHeuristic 始终返回白名单项）。防 AI 自由文本
                // 注入恶意字符串写入 Notion 分类字段（CWE-94）。
                if (aiCategory && (settings?.categories || []).some(c => String(c).trim().toLowerCase() === String(aiCategory).trim().toLowerCase())) {
                    inferredCategory = aiCategory;
                }
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
                // 仅 http(s) 才写入 url 属性; javascript:/data: 等危险 scheme 置空
                // (安全审计 hy3 LOW: 导出报告 UI 已过滤, 写入侧需对称处理)
                url: /^https?:\/\//i.test(String(bookmark.url || "")) ? bookmark.url : null
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
                // updateDatabase 是 level 1 写操作（schema 变更），用户触发的导出前置不可裸调（ISS-20260724-011）。
                // 自动同步路径调用 setup 时夹在 _auditAutoSync 的 system 审计范围内（间接可观测），
                // 此处补 user 审计 + canExecute 闸门覆盖用户触发导出路径的可观测性缺口。
                const { OperationGuard } = require("../security");
                if (!OperationGuard.canExecute("updateDatabase")) {
                    BookmarkExporter._auditExport("updateDatabase", "denied",
                        { databaseId, reason: "权限不足：导出配置数据库结构需 level≥1", changes: Object.keys(allChanges) });
                    return { success: false, error: "权限不足：无法修改数据库结构（需 level≥1）" };
                }
                await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                    properties: allChanges,
                }, apiKey);
                BookmarkExporter._auditExport("updateDatabase", "success",
                    { databaseId, added: Object.keys(propsToAdd), renamed: Object.keys(propsToUpdate) });
            }

            return { success: true, added: Object.keys(propsToAdd) };
        } catch (error) {
            // v3.14.13 (M3): 透传认证终态标记 + authCode——自动导入器据此 fail-fast 与场景文案分支
            // (token 失效最常见首触点: GET /databases 401)。
            return {
                success: false,
                error: error && error.message ? error.message : String(error),
                isAuthTerminal: !!(error && error.isAuthTerminal === true),
                authCode: (error && error.authCode) || undefined,
            };
        }
    },

    // 获取已导出的书签集合
    // F3 共识(缓存失效): 跨 tab GM storage 变更(清除/迁移/其他 tab 导出)
    // 必须置空内存缓存,否则双 tab 并发误判 → 重复导入。
    _registerExportedWatcher: () => {
        if (BookmarkExporter._exportedWatcherBound) return;
        BookmarkExporter._exportedWatcherBound = true;
        if (typeof GM_addValueChangeListener !== "function") return;
        try {
            GM_addValueChangeListener(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, () => {
                BookmarkExporter._exportedCache = null;
            });
        } catch (e) { /* 监听失败仅缓存陈旧风险 */ }
    },

    // R9 共识(存量键迁移): 旧键为未规范化 URL,新键规约归一后旧键成孤儿 →
    // 已导出书签被重新导入。首次加载时重写旧键(同规范键取 max ts),写回并清理。
    _migrateExportedKeys: () => {
        if (BookmarkExporter._exportedKeysMigrated) return;
        BookmarkExporter._exportedKeysMigrated = true;
        const exported = BookmarkExporter._exportedCache;
        if (!exported) return;
        let changed = false;
        const merged = {};
        for (const key of Object.keys(exported)) {
            const norm = Utils.normalizeDedupUrl(key);
            const ts = Number(exported[key]) || Date.now();
            if (norm !== key) {
                changed = true;
                if (!merged[norm] || (merged[norm] || 0) < ts) merged[norm] = ts;
            } else {
                merged[key] = ts;
            }
        }
        if (changed) {
            BookmarkExporter._exportedCache = merged;
            BookmarkExporter.flushExported();
        }
    },

    getExported: () => {
        if (BookmarkExporter._exportedCache) return BookmarkExporter._exportedCache;
        BookmarkExporter._registerExportedWatcher();
        try {
            const parsed = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, "{}"));
            // 损坏存储兜底: 非纯对象时 markExported 严格模式赋值会抛 TypeError(全盘审计修复)
            BookmarkExporter._exportedCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        }
        catch (error) {
            console.warn("[LD-Notion] 已导出书签集合解析失败:", error);
            BookmarkExporter._exportedCache = {};
        }
        BookmarkExporter._migrateExportedKeys();
        return BookmarkExporter._exportedCache;
    },

    // 仅 mutate 内存缓存，不写存储（DISCOVER P3 同类修复）：循环内逐条调用避免写侧 O(N²)。
    // 单次调用场景须紧跟 flushExported() 持久化，或用 markExportedAndFlush。与 GitHubAPI.markExported 同构。
    markExported: (bookmarkUrl) => {
        const exported = BookmarkExporter.getExported();
        exported[Utils.normalizeDedupUrl(bookmarkUrl)] = Date.now();
    },

    markExportedAndFlush: (bookmarkUrl) => {
        BookmarkExporter.markExported(bookmarkUrl);
        BookmarkExporter.flushExported();
    },

    // 批量导出循环末尾单次回写已导出映射（PERF-003）：循环内仅 mutate 内存缓存，
    // 避免逐条 JSON.stringify 整个不断增长映射的写侧 O(N²)。语义与逐条 markExported 等价。
    // v3.14.3: 改容量上限淘汰（用户书签数天然有界），不再按 90 天时间 TTL 误删导出事实。
    // v3.14.6 (CC-05): 写前 rebase(重读-并集-max ts) —— 跨 tab 他端新增键不可丢(导出账本不可再生)
    // P4 收敛(c07): 可选 pending —— 跨 tab watcher 会把 _exportedCache 置 null,
    // 调用方持有的本轮引用须一并并集落盘, 否则本轮已标记的导出事实丢失(下轮重复建页)
    flushExported: (pending = null) => {
        if (BookmarkExporter._exportedCache) {
            BookmarkExporter._evictByCapacity(BookmarkExporter._exportedCache);
        }
        if (pending && pending !== BookmarkExporter._exportedCache) {
            BookmarkExporter._evictByCapacity(pending);
        }
        if (!BookmarkExporter._exportedCache && !pending) return;
        {
            let remote = {};
            try {
                remote = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, "{}")) || {};
            } catch { remote = {}; }
            // v3.14.6 (CC-05): rebase —— 远端键并入(同键 max ts)防他 tab 新增键丢失;
            // 并入前做 URL 规范化(与 _migrateExportedKeys 不变量一致, 防 raw 键复活)
            const merged = {};
            for (const [key, ts] of Object.entries(remote)) {
                const norm = Utils.normalizeDedupUrl(key);
                if (merged[norm] === undefined || Number(merged[norm]) < Number(ts)) merged[norm] = ts;
            }
            for (const [key, ts] of Object.entries(BookmarkExporter._exportedCache || {})) {
                const norm = Utils.normalizeDedupUrl(key);
                if (merged[norm] === undefined || Number(merged[norm]) < Number(ts)) merged[norm] = ts;
            }
            for (const [key, ts] of Object.entries(pending || {})) {
                const norm = Utils.normalizeDedupUrl(key);
                if (merged[norm] === undefined || Number(merged[norm]) < Number(ts)) merged[norm] = ts;
            }
            BookmarkExporter._exportedCache = merged;
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, JSON.stringify(merged));
        }
    },

    // F-05 修复：清除书签已导出记录（清键 + 失效内存缓存，供数据管理 UI 调用）
    // 双账本: BOOKMARK_EXPORTED(URL, 手动导出) + DedupStore("bookmark")(bookmark:id, 自动同步落账)。
    // 只清前者会导致 SyncCoordinator/自动去重仍命中旧键,「清除后可再导出」失效。
    clearExportedRecords: () => {
        BookmarkExporter._exportedCache = null;
        Storage.remove(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED);
        try {
            const { DedupStore } = require("../storage");
            DedupStore.clearSeen("bookmark");
        } catch { /* DedupStore 不可用时仅清手动账本 */ }
    },

    // v3.14.3: 导出账本容量上限（书签 URL 数天然有界）——
    // 仅在超过上限时淘汰最旧条目，避免 90 天时间窗误删导出事实致 UI 误判“待导出”。
    _EXPORT_CAPACITY_LIMIT: 10000,
    _evictByCapacity: (set) => {
        const keys = Object.keys(set);
        const excess = keys.length - BookmarkExporter._EXPORT_CAPACITY_LIMIT;
        if (excess <= 0) return;
        keys.sort((a, b) => Number(set[a] || 0) - Number(set[b] || 0));
        for (let i = 0; i < excess && i < keys.length; i++) {
            delete set[keys[i]];
        }
    },

    isExported: (bookmarkUrl) => {
        return !!BookmarkExporter.getExported()[Utils.normalizeDedupUrl(bookmarkUrl)];
    },

    // 导出书签到 Notion
    exportBookmarks: async (settings, onProgress) => {
        const { apiKey, databaseId, bookmarks } = settings;

        if (!apiKey || !databaseId) {
            throw new Error("请先配置 Notion API Key 和数据库");
        }

        if (onProgress) {
            try {
                onProgress("正在配置数据库结构...", 0);
            } catch (progressError) {
                console.warn("[BookmarkExporter] onProgress 回调异常:", progressError);
            }
        }
        const setupResult = await BookmarkExporter.setupDatabaseProperties(databaseId, apiKey);
        if (!setupResult.success) {
            const setupError = new Error(`数据库配置失败: ${setupResult.error}`);
            // P4 共识(glm): 透传认证终态标记 —— 否则死 token 下调用方无法 fail-fast/走重授权分支
            if (setupResult.isAuthTerminal) {
                setupError.isAuthTerminal = true;
                setupError.authCode = setupResult.authCode;
            }
            throw setupError;
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
        // P4 收敛(c07): 持有本轮缓存引用 —— 跨 tab watcher 可能把模块字段置 null,
        // 循环内直接读写模块字段会丢掉此前已标记的导出事实
        const pendingExported = BookmarkExporter.getExported();

        // v3.14.6 (CC-10): 循环包 try/finally flush —— onProgress 抛错/异常路径也不丢导出账本
        try {
        for (let i = 0; i < newBookmarks.length; i++) {
            const bm = newBookmarks[i];
            const pct = Math.round(5 + (i / newBookmarks.length) * 90);
            try {
                if (onProgress) onProgress(`正在导出 (${i + 1}/${newBookmarks.length}): ${bm.title}`, pct);
            } catch (progressError) {
                console.warn("[BookmarkExporter] onProgress 回调异常:", progressError);
            }

            try {
                const enriched = await BookmarkExporter.enrichBookmark(bm, settings, enrichContext);
                const properties = BookmarkExporter.buildProperties(enriched);
                // createDatabasePage 是 level 1 写操作，用户触发的批量导出不可裸调 NotionAPI（ISS-20260724-011）。
                // canExecute 非阻塞（只查 permissionLevel），权限不足跳过并记审计，与自动同步 C1 模式对称。
                const { OperationGuard } = require("../security");
                if (!OperationGuard.canExecute("createDatabasePage")) {
                    BookmarkExporter._auditExport("createDatabasePage", "denied",
                        { bookmarkUrl: bm.url, itemName: bm.title, reason: "权限不足：导出建页需 level≥1" });
                    failed++;
                    continue;
                }
                const page = await NotionAPI.request("POST", "/pages", {
                    parent: { database_id: databaseId },
                    properties,
                }, apiKey);
                // 循环内仅 mutate 本轮缓存引用（避免逐条 JSON.stringify 写侧 O(N²)，PERF-003）。
                // 循环末尾 BookmarkExporter.flushExported(pendingExported) 单次回写。
                pendingExported[Utils.normalizeDedupUrl(bm.url)] = Date.now();
                BookmarkExporter._auditExport("createDatabasePage", "success",
                    { pageId: String(page?.id || ""), bookmarkUrl: bm.url, itemName: bm.title, databaseId });
                success++;
            } catch (e) {
                console.warn(`[BookmarkExporter] 导出失败: ${bm.url}`, e);
                BookmarkExporter._auditExport("createDatabasePage", "failed",
                    { bookmarkUrl: bm.url, itemName: bm.title, reason: String(e?.message || e) });
                failed++;
                // 认证终态 fail-fast(v3.14.5):中止剩余书签导出,返回部分结果供重试
                // v3.14.7: 仅信 isAuthTerminal 标记(与 api 层终态/瞬态区分对齐), 消息子串会误杀瞬态续签失败
                if (e && e.isAuthTerminal === true) {
                    // 已成功项的导出事实必须先落盘(flushExported 幂等,与正常路径末次 flush 对称)
                    BookmarkExporter.flushExported(pendingExported);
                    const remainingCount = newBookmarks.length - i - 1;
                    return {
                        total: bookmarks.length,
                        exported: success,
                        failed,
                        skipped: remainingCount,
                        aborted: true,
                        message: `认证失败，已中止导出（成功 ${success} 个，剩余 ${remainingCount} 个未尝试）。请检查 Notion API Key / OAuth 授权后重试。`,
                    };
                }
            }

            if (i < newBookmarks.length - 1) {
                await Utils.sleep(delay);
            }
        }
        } finally {
            // 批量回写已导出映射（PERF-003）：无论 success/failed/异常，循环结束单次 flush，
            // 写侧从 O(N²)→O(N)。v3.14.6 (CC-10): finally 保证 onProgress 抛错也不丢账本
            BookmarkExporter.flushExported(pendingExported);
        }

        return { total: bookmarks.length, exported: success, failed, newCount: newBookmarks.length };
    },
};

module.exports = { BookmarkExporter };
