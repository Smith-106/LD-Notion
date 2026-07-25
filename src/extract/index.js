"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI, DOMToNotion, HTMLToMarkdown, InstallHelper } = require("../api");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { OperationGuard } = require("../security");
// ISS-20260723-010 W3 (ARCH-005): LinuxDoAPI 从 export 层迁回 extract 层，消除 adapter→export 逆向依赖。
const { LinuxDoAPI } = require("./LinuxDoAPI");

const ZhihuAPI = {
    detectPage: () => {
        const url = location.href;
        if (/zhihu\.com\/question\/\d+\/answer\/\d+/.test(url)) return "answer";
        if (/zhihu\.com\/question\/\d+/.test(url)) return "question";
        if (/zhihu\.com\/p\/\d+/.test(url)) return "article";
        if (/zhihu\.com\/column\/[^/]+\/p\/\d+/.test(url)) return "column_article";
        return null;
    },

    extractContent: () => {
        const pageType = ZhihuAPI.detectPage();
        if (!pageType) return null;

        if (pageType === "answer") return ZhihuAPI._extractAnswer();
        if (pageType === "question") return ZhihuAPI._extractQuestion();
        if (pageType === "article" || pageType === "column_article") return ZhihuAPI._extractArticle();
        return null;
    },

    _extractAnswer: () => {
        const answerEl = document.querySelector(".AnswerItem .RichContent-inner")
            || document.querySelector(".Post-RichTextContainer");
        if (!answerEl) return null;

        const questionEl = document.querySelector(".QuestionHeader-title");
        const authorEl = document.querySelector(".AuthorInfo-name .UserLink-link");
        const voteEl = document.querySelector(".VoteButton--up") || document.querySelector(".TopstoryNumber");

        return {
            type: "answer",
            title: questionEl?.textContent?.trim() || "知乎回答",
            author: authorEl?.textContent?.trim() || "匿名",
            url: location.href,
            html: answerEl.innerHTML,
            voteCount: ZhihuAPI._parseVoteCount(voteEl?.textContent),
        };
    },

    _extractQuestion: () => {
        const questionEl = document.querySelector(".QuestionHeader-title");
        if (!questionEl) return null;

        const detailEl = document.querySelector(".QuestionHeader-detail");
        const answerEls = document.querySelectorAll(".AnswerItem");

        const answers = Array.from(answerEls).slice(0, 20).map((el, i) => {
            const contentEl = el.querySelector(".RichContent-inner");
            const authorEl = el.querySelector(".AuthorInfo-name .UserLink-link");
            const voteEl = el.querySelector(".VoteButton--up");
            return {
                index: i,
                author: authorEl?.textContent?.trim() || "匿名",
                html: contentEl?.innerHTML || "",
                voteCount: ZhihuAPI._parseVoteCount(voteEl?.textContent),
            };
        });

        return {
            type: "question",
            title: questionEl.textContent.trim(),
            url: location.href,
            detail: detailEl?.innerHTML || "",
            answers,
        };
    },

    _extractArticle: () => {
        const articleEl = document.querySelector(".Post-RichTextContainer")
            || document.querySelector(".RichText");
        if (!articleEl) return null;

        const titleEl = document.querySelector(".Post-Title") || document.querySelector(".ArticleHeader-title");
        const authorEl = document.querySelector(".AuthorInfo-name .UserLink-link");

        return {
            type: "article",
            title: titleEl?.textContent?.trim() || "知乎文章",
            author: authorEl?.textContent?.trim() || "未知",
            url: location.href,
            html: articleEl.innerHTML,
        };
    },

    _parseVoteCount: (text) => {
        if (!text) return 0;
        const match = text.match(/(\d[\d,]*)/);
        return match ? parseInt(match[1].replace(/,/g, ""), 10) : 0;
    },

    htmlToBlocks: (html) => {
        return DOMToNotion.cookedToBlocks(html);
    },
};

const GenericExtractor = {
    // 提取页面元数据
    extractMeta: () => {
        const getMeta = (name) => {
            const el = document.querySelector(
                `meta[property="${name}"], meta[name="${name}"]`
            );
            return el?.getAttribute("content") || "";
        };

        // 标题：og:title > document.title > h1
        const title =
            getMeta("og:title") ||
            document.title ||
            document.querySelector("h1")?.textContent?.trim() ||
            "无标题";

        // 作者
        const author =
            getMeta("author") ||
            getMeta("article:author") ||
            document.querySelector('[rel="author"], .author, .byline, [itemprop="author"]')?.textContent?.trim() ||
            "";

        // 发布日期
        const rawDate =
            getMeta("article:published_time") ||
            getMeta("datePublished") ||
            document.querySelector("time[datetime]")?.getAttribute("datetime") ||
            getMeta("date") ||
            "";
        let publishDate = "";
        if (rawDate) {
            const d = new Date(rawDate);
            if (!isNaN(d.getTime())) publishDate = d.toISOString().split("T")[0];
        }

        // 站点名称
        const siteName =
            getMeta("og:site_name") ||
            window.location.hostname.replace(/^www\./, "");

        // 摘要
        const description =
            getMeta("og:description") ||
            getMeta("description") ||
            "";

        return {
            title: title.substring(0, 200),
            url: window.location.href,
            author: author.substring(0, 100),
            publishDate,
            siteName: siteName.substring(0, 100),
            description: description.substring(0, 500),
        };
    },

    // 智能提取正文内容 DOM 节点
    extractContent: () => {
        // 策略 1：<article> 标签
        const article = document.querySelector("article");
        if (article) return article;

        // 策略 2：role="main" 或 <main>
        const main = document.querySelector('[role="main"], main');
        if (main) return main;

        // 策略 3：常见正文容器 class/id
        const selectors = [
            ".post-content", ".article-content", ".entry-content",
            ".content", ".post-body", ".article-body",
            "#content", "#article", "#post-content",
            ".markdown-body", ".prose", ".rich-text",
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 200) return el;
        }

        // 策略 4：启发式 — 找文本密度最高的容器
        const candidates = document.querySelectorAll("div, section");
        let best = null;
        let bestScore = 0;
        for (const el of candidates) {
            // 跳过导航、侧边栏、页脚等
            const tag = el.tagName.toLowerCase();
            const id = (el.id || "").toLowerCase();
            const cls = (el.className || "").toLowerCase();
            const skip = /(nav|sidebar|footer|header|menu|comment|widget|ad|banner)/;
            if (skip.test(id) || skip.test(cls) || skip.test(tag)) continue;

            const text = el.textContent || "";
            const pCount = el.querySelectorAll("p").length;
            const score = text.length * 0.3 + pCount * 100;
            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }
        if (best && best.textContent.trim().length > 100) return best;

        // 兜底：克隆 body 并移除脚本注入的 UI 元素，避免导出内容混入剪藏面板
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('[class*="gclip-"], [class*="ldb-"], [id*="ldb-"]').forEach(el => el.remove());
        return clone;
    },

    // 将提取的 DOM 转为 Notion blocks（复用 DOMToNotion）
    toNotionBlocks: (contentEl, imgMode) => {
        return DOMToNotion.cookedToBlocks(contentEl.innerHTML, imgMode);
    },
};

const WorkspaceService = {
    _inflightRequests: new Map(),

    _requestSearchItems: async (apiKey, objectType, maxPages = 0, onProgress = null, phase = "") => {
        let results = [];
        let cursor = undefined;
        let pageCount = 0;
        do {
            const response = await NotionAPI.search("", { property: "object", value: objectType }, apiKey, cursor);
            const batch = response.results || [];
            results = results.concat(batch);
            cursor = response.has_more ? response.next_cursor : undefined;
            pageCount++;
            if (onProgress) {
                onProgress({
                    phase,
                    loaded: results.length,
                    hasMore: !!cursor,
                    pageCount,
                });
            }
        } while (cursor && (maxPages === 0 || pageCount < maxPages));
        return results;
    },

    fetchWorkspace: async (apiKey, options = {}) => {
        if (!apiKey) {
            return { databases: [], pages: [] };
        }

        const includePages = options.includePages !== false;
        const maxPages = Number.isFinite(options.maxPages)
            ? options.maxPages
            : (parseInt(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages), 10) || 0);
        const requestKey = `${Utils.apiKeyHash(apiKey)}:${maxPages}:${includePages ? "all" : "db"}`;

        if (WorkspaceService._inflightRequests.has(requestKey)) {
            return WorkspaceService._inflightRequests.get(requestKey);
        }

        const requestPromise = (async () => {
            const dbResults = await WorkspaceService._requestSearchItems(
                apiKey,
                "database",
                maxPages,
                options.onProgress,
                "databases"
            );
            const databases = dbResults.map(db => ({
                id: db.id?.replace(/-/g, "") || "",
                title: db.title?.[0]?.plain_text || "无标题数据库",
                type: "database",
                url: db.url || "",
            })).filter(item => item.id);

            if (!includePages) {
                return { databases, pages: [] };
            }

            const pageResults = await WorkspaceService._requestSearchItems(
                apiKey,
                "page",
                maxPages,
                options.onProgress,
                "pages"
            );
            const pages = pageResults.map(page => ({
                id: page.id?.replace(/-/g, "") || "",
                title: Utils.getPageTitle(page),
                type: "page",
                url: page.url || "",
                parent: page.parent?.type || "",
                parentId: (page.parent?.database_id || page.parent?.page_id || "").replace(/-/g, ""),
            })).filter(item => item.id);

            return { databases, pages };
        })();

        WorkspaceService._inflightRequests.set(requestKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            WorkspaceService._inflightRequests.delete(requestKey);
        }
    },

    fetchWorkspaceStaged: async (apiKey, options = {}) => {
        if (!apiKey) {
            return { databases: [], pages: [] };
        }

        const includePages = options.includePages !== false;
        const maxPages = Number.isFinite(options.maxPages)
            ? options.maxPages
            : (parseInt(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages), 10) || 0);

        const databasesRaw = await WorkspaceService._requestSearchItems(
            apiKey,
            "database",
            maxPages,
            options.onProgress,
            "databases"
        );
        const databases = databasesRaw.map(db => ({
            id: db.id?.replace(/-/g, "") || "",
            title: db.title?.[0]?.plain_text || "无标题数据库",
            type: "database",
            url: db.url || "",
        })).filter(item => item.id);

        options.onPhaseComplete?.("databases", { databases, pages: [] });

        if (!includePages) {
            return { databases, pages: [] };
        }

        const pagesRaw = await WorkspaceService._requestSearchItems(
            apiKey,
            "page",
            maxPages,
            options.onProgress,
            "pages"
        );
        const pages = pagesRaw.map(page => ({
            id: page.id?.replace(/-/g, "") || "",
            title: Utils.getPageTitle(page),
            type: "page",
            url: page.url || "",
            parent: page.parent?.type || "",
            parentId: (page.parent?.database_id || page.parent?.page_id || "").replace(/-/g, ""),
        })).filter(item => item.id);

        const finalWorkspace = { databases, pages };
        options.onPhaseComplete?.("pages", finalWorkspace);
        return finalWorkspace;
    },

    fetchWorkspacePageObjects: async (apiKey, options = {}) => {
        if (!apiKey) {
            return [];
        }

        const maxPages = Number.isFinite(options.maxPages)
            ? options.maxPages
            : (parseInt(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages), 10) || 0);

        return await WorkspaceService._requestSearchItems(
            apiKey,
            "page",
            maxPages,
            options.onProgress,
            options.phase || "workspace_visual_pages"
        );
    },

    buildWorkspaceData: (apiKey, workspace = {}) => ({
        apiKeyHash: apiKey ? Utils.apiKeyHash(apiKey) : "",
        databases: Array.isArray(workspace.databases) ? workspace.databases : [],
        pages: Array.isArray(workspace.pages) ? workspace.pages : [],
        timestamp: Date.now(),
    }),

    persistWorkspaceData: (apiKey, workspace = {}) => {
        const workspaceData = WorkspaceService.buildWorkspaceData(apiKey, workspace);
        Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));
        return workspaceData;
    },

    // 统一工作区刷新边界，负责后端读取、缓存持久化与 staged 回调。
    refreshWorkspaceSnapshot: async (apiKey, options = {}) => {
        if (!apiKey) {
            return { databases: [], pages: [], workspaceData: WorkspaceService.buildWorkspaceData("", {}) };
        }

        const includePages = options.includePages !== false;
        const notifyWorkspaceData = typeof options.onWorkspaceData === "function"
            ? options.onWorkspaceData
            : null;
        let finalPhaseHandled = false;
        let lastWorkspaceData = null;

        const workspace = await WorkspaceService.fetchWorkspaceStaged(apiKey, {
            includePages,
            maxPages: options.maxPages,
            onProgress: options.onProgress,
            onPhaseComplete: (phase, partialWorkspace) => {
                lastWorkspaceData = WorkspaceService.persistWorkspaceData(apiKey, partialWorkspace);
                finalPhaseHandled = phase === "pages" || (!includePages && phase === "databases");
                notifyWorkspaceData?.(lastWorkspaceData, { phase, isFinal: finalPhaseHandled });
                options.onPhaseComplete?.(phase, partialWorkspace, lastWorkspaceData);
            },
        });

        if (!finalPhaseHandled) {
            lastWorkspaceData = WorkspaceService.persistWorkspaceData(apiKey, workspace);
            const finalPhase = includePages ? "pages" : "databases";
            notifyWorkspaceData?.(lastWorkspaceData, { phase: finalPhase, isFinal: true });
            options.onPhaseComplete?.(finalPhase, workspace, lastWorkspaceData);
        }

        return {
            databases: workspace.databases || [],
            pages: workspace.pages || [],
            workspaceData: lastWorkspaceData || WorkspaceService.buildWorkspaceData(apiKey, workspace),
        };
    },
};

module.exports = { ZhihuAPI, GenericExtractor, WorkspaceService, LinuxDoAPI };
// UICommandService 已迁至 src/coordination/UICommandService.js（ISS-20260718-008），
// extract 层不再承担 UI 命令分发协调职责。

