"use strict";

// page-file.js — 当前页面 → 本地文件导出 + 发布到 linux.do 的页面内容装配层。
// LDStatus Pro 对齐：当前页面可直接存为本地文件（.md/.html/.json），也可发布到
// linux.do；来源站点通用（知乎 / linux.do 话题页 / 任意通用页），不依赖 Notion。
// 职责边界：本模块只做“内容装配”（meta 提取 + markdown/html/json 组装 + 文件名消毒
// + 本地下载触发 + Discourse 发帖参数组装），网络写操作收束到 LinuxDoAPI，
// 权限闸门与确认收束到调用方 UI（OperationGuard.execute("linuxdo.publish")）。
// 本地文件下载沿用 BookmarkOrganizer.backup / workspace 报告先例：纯本地写，
// 不经 OperationGuard（与既有下载先例同口径）。
// 去重账本：与 clipper 同账本（GenericExporter.markClipperExported），文件/发帖成功
// 同样落账，避免“已存文件又在 Notion 重建页”的重复劳动；远端对账逻辑不动。

const { Utils } = require("../utils");
const { SiteDetector, HTMLToMarkdown } = require("../api");
const { ZhihuAPI, GenericExtractor, LinuxDoAPI } = require("../extract");

// 文件名消毒(Windows 非法字符 → 下划线，截断)：
// 此处本地实现避免 export→import
// 新增跨模块依赖边（AGENTS.md 禁止新增循环依赖边）。
const sanitizeFileName = (name, fallback = "page") => {
    const base = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_").substring(0, 80);
    return base || fallback;
};

// Discourse 发帖正文上限：服务端默认 max_post_length 为 32000，linux.do 可能放宽；
// 客户端按 60000 硬拒（超限建议改存本地文件），避免超长正文被 422 整体拒绝。
const MAX_PUBLISH_RAW_LENGTH = 60000;
// 新话题标题下限：服务端 min_topic_title_length 默认 15，各站可配；客户端仅做
// 最小可用校验（≥5），真实下限由服务端 422 原文透出。
const MIN_PUBLISH_TITLE_LENGTH = 5;

const PageFileExporter = {
    MAX_PUBLISH_RAW_LENGTH,
    MIN_PUBLISH_TITLE_LENGTH,
    sanitizeFileName,

    // —— Markdown 装配（三种来源） ——

    // 通用页：meta + 正文 HTML → markdown
    buildMarkdownFromGeneric: (meta = {}, bodyHtml = "") => {
        const safeMeta = {
            title: meta.title || "无标题",
            url: meta.url || (typeof location !== "undefined" ? location.href : ""),
            author: meta.author || "",
            source: meta.source || meta.siteName || "通用页面",
            sourceType: meta.sourceType || "网页",
        };
        let md = HTMLToMarkdown.buildFrontmatter(safeMeta);
        md += `> [!info] 页面信息\n> - **来源**: ${Utils.mdText(safeMeta.source)}\n> - **链接**: ${Utils.mdLink(safeMeta.title, safeMeta.url)}\n`;
        if (safeMeta.author) md += `> - **作者**: ${Utils.mdText(safeMeta.author)}\n`;
        md += `> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;
        if (bodyHtml) md += `${HTMLToMarkdown.convert(bodyHtml)}\n`;
        return { meta: safeMeta, markdown: md };
    },

    // 知乎内容对象（ZhihuAPI.extractContent 形态）→ markdown（与 generic-ui Obsidian 分支同构）
    buildMarkdownFromZhihu: (content = {}) => {
        const title = content.title || "无标题";
        const safeMeta = {
            title,
            url: content.url || (typeof location !== "undefined" ? location.href : ""),
            author: content.author || "",
            source: "知乎",
            sourceType: content.type === "answer" ? "回答" : (content.type === "question" ? "问题" : "文章"),
        };
        let md = HTMLToMarkdown.buildFrontmatter(safeMeta);
        md += `> [!info] 页面信息\n> - **来源**: 知乎\n> - **链接**: ${Utils.mdLink(title, safeMeta.url)}\n> - **作者**: ${Utils.mdText(content.author || "未知")}\n> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;
        if (content.detail && content.type === "question") md += `${HTMLToMarkdown.convert(content.detail)}\n\n`;
        if (content.html) md += `${HTMLToMarkdown.convert(content.html)}\n\n`;
        if (Array.isArray(content.answers)) {
            content.answers.forEach((ans, i) => {
                md += `> [!note]+ #${i + 1} ${Utils.mdText(ans.author || "匿名")} · 👍 ${ans.voteCount || 0}\n`;
                const lines = HTMLToMarkdown.convert(ans.html || "").trim().split("\n");
                md += lines.map((l) => `> ${l}`).join("\n") + "\n\n";
            });
        }
        return { meta: safeMeta, markdown: md };
    },

    // linux.do 话题（fetchAllPosts 形态）→ markdown（与 Obsidian 批量导出同构）
    buildMarkdownFromPosts: (topic = {}, posts = []) => {
        const safeMeta = {
            title: topic.title || "无标题",
            url: topic.url || "",
            author: topic.opUsername || "",
            source: "Linux.do",
            sourceType: "帖子",
            topicId: topic.topicId || topic.topic_id || "",
            category: topic.categoryName || topic.category || "",
            tags: topic.tags || [],
            floors: posts.length,
        };
        let md = HTMLToMarkdown.buildFrontmatter(safeMeta);
        md += `> [!info] 帖子信息\n`;
        md += `> - **原始链接**: ${Utils.mdLink(safeMeta.title, safeMeta.url)}\n`;
        md += `> - **楼主**: @${Utils.mdText(safeMeta.author || "未知")}\n`;
        md += `> - **分类**: ${Utils.mdText(safeMeta.category || "无")}\n`;
        md += `> - **标签**: ${Utils.mdText((safeMeta.tags || []).join(", ") || "无")}\n`;
        md += `> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;
        posts.forEach((post, idx) => {
            const isOp = post.username === topic.opUsername;
            md += HTMLToMarkdown.buildPostCallout(post, idx, isOp);
        });
        return { meta: safeMeta, markdown: md };
    },

    // —— 当前页面统一装配（来源路由与 GenericExporter.exportCurrentPage 同口径） ——
    buildCurrentPage: async () => {
        const site = SiteDetector.detect();
        if (site === SiteDetector.SITES.ZHIHU) {
            const content = ZhihuAPI.extractContent();
            if (content) return PageFileExporter.buildMarkdownFromZhihu(content);
        }
        if (site === SiteDetector.SITES.LINUX_DO) {
            const pathSegments = window.location.pathname.split("/").filter(Boolean);
            const tIndex = pathSegments.indexOf("t");
            const numericTopicId = tIndex >= 0
                ? pathSegments.slice(tIndex + 1).find((seg) => /^\d+$/.test(seg))
                : null;
            const topicId = numericTopicId || window.location.pathname.match(/\/t\/([^/]+)/)?.[1] || "";
            if (topicId) {
                const { topic, posts } = await LinuxDoAPI.fetchAllPosts(topicId);
                return PageFileExporter.buildMarkdownFromPosts(topic, posts);
            }
        }
        const meta = GenericExtractor.extractMeta();
        const contentEl = GenericExtractor.extractContent();
        return PageFileExporter.buildMarkdownFromGeneric(meta, contentEl ? contentEl.innerHTML : "");
    },

    // —— 文件载荷 ——

    // 独立 HTML：标题/链接头 + 正文原 HTML（本地存档可直接打开）
    buildStandaloneHtml: (meta = {}, bodyHtml = "") => {
        const title = Utils.escapeHtml(meta.title || "无标题");
        const url = Utils.escapeHtml(meta.url || "");
        return `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n<h1>${title}</h1>\n<p>来源：<a href="${url}">${title}</a></p>\n<article>\n${bodyHtml || ""}\n</article>\n</body>\n</html>\n`;
    },

    // JSON 载荷：meta + markdown（可再生，机器可读）
    buildJsonPayload: (meta = {}, markdown = "") => {
        return JSON.stringify({
            kind: "ld-notion-page-file",
            version: 1,
            exportedAt: new Date().toISOString(),
            meta,
            markdown,
        }, null, 2);
    },

    // format: md | html | json → { filename, content, mime }
    buildFilePayload: (built = {}, format = "md", bodyHtml = "") => {
        const { meta = {}, markdown = "" } = built;
        const base = PageFileExporter.sanitizeFileName(meta.title, "page");
        if (format === "html") {
            return {
                filename: `${base}.html`,
                content: PageFileExporter.buildStandaloneHtml(meta, bodyHtml),
                mime: "text/html;charset=utf-8",
            };
        }
        if (format === "json") {
            return {
                filename: `${base}.json`,
                content: PageFileExporter.buildJsonPayload(meta, markdown),
                mime: "application/json;charset=utf-8",
            };
        }
        return {
            filename: `${base}.md`,
            content: markdown,
            mime: "text/markdown;charset=utf-8",
        };
    },

    // 本地下载触发（BookmarkOrganizer.backup / workspace 报告先例：Blob + a.click）
    downloadFile: (filename, content, mime) => {
        if (typeof document === "undefined" || typeof Blob === "undefined") {
            throw new Error("当前环境不支持文件下载");
        }
        const objectUrlApi = (typeof window !== "undefined" && window.URL && typeof window.URL.createObjectURL === "function")
            ? window.URL
            : (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null);
        if (!objectUrlApi) throw new Error("当前环境不支持文件下载");
        const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
        const href = objectUrlApi.createObjectURL(blob);
        try {
            const link = document.createElement("a");
            link.href = href;
            link.download = filename;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            if (typeof link.remove === "function") link.remove();
        } finally {
            if (typeof objectUrlApi.revokeObjectURL === "function") {
                setTimeout(() => objectUrlApi.revokeObjectURL(href), 5000);
            }
        }
        return filename;
    },

    // —— 发往 linux.do 的参数组装（纯函数，可单测） ——
    // mode: "topic" | "reply"
    buildPublishParams: ({ mode = "topic", title = "", raw = "", category = "", topicId = "" } = {}) => {
        const cleanTitle = String(title || "").trim();
        const cleanRaw = String(raw || "").trim();
        if (mode === "reply") {
            const tid = String(topicId || "").trim();
            if (!/^\d+$/.test(tid)) throw new Error("回复模式需填写数字话题 ID");
            if (cleanRaw.length < 10) throw new Error("正文过短（至少 10 个字符）");
            if (cleanRaw.length > MAX_PUBLISH_RAW_LENGTH) {
                throw new Error(`正文超长（${cleanRaw.length} > ${MAX_PUBLISH_RAW_LENGTH}），请改存本地文件`);
            }
            return { mode, topic_id: tid, raw: cleanRaw };
        }
        if (cleanTitle.length < MIN_PUBLISH_TITLE_LENGTH) {
            throw new Error(`标题过短（至少 ${MIN_PUBLISH_TITLE_LENGTH} 个字符）`);
        }
        if (cleanRaw.length < 10) throw new Error("正文过短（至少 10 个字符）");
        if (cleanRaw.length > MAX_PUBLISH_RAW_LENGTH) {
            throw new Error(`正文超长（${cleanRaw.length} > ${MAX_PUBLISH_RAW_LENGTH}），请改存本地文件`);
        }
        const params = { mode, title: cleanTitle.slice(0, 255), raw: cleanRaw, archetype: "regular" };
        const cat = String(category || "").trim();
        if (cat !== "") {
            if (!/^\d+$/.test(cat)) throw new Error("分类需填写数字 ID（留空则由站点默认）");
            params.category = cat;
        }
        return params;
    },
};

module.exports = { PageFileExporter };
