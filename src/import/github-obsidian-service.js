"use strict";
// src/import/github-obsidian-service.js — GitHub↔Obsidian/Notion 业务逻辑
//
// 职责分离：从 UI 事件中剥离纯数据转换与服务调用逻辑
// 依赖：api/export/extract 层（不依赖 ui/security/coordination）

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI, HTMLToMarkdown, ObsidianAPI } = require("../api");
const { GitHubExporter } = require("./GitHubExporter");
const { GitHubAPI } = require("./GitHubAPI");
const { OperationGuard } = require("../security");

/**
 * 文件名清理（Obsidian 兼容）
 * @param {string} name
 * @param {string} fallback
 */
const sanitizeObsidianFileName = (name, fallback = "untitled") => {
    const base = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
    return base || fallback;
};

/**
 * 将 GitHub item 映射为统一 bookmark 结构
 * @param {Array} items
 * @param {string} sourceType - stars/repos/forks/gists
 */
const mapGitHubItemsToBookmarks = (items, sourceType) => {
    return (items || []).map((item) => {
        const isGist = sourceType === "gists";
        const itemKey = isGist ? String(item.id || "") : String(item.full_name || item.name || "");
        const title = isGist
            ? (item.description || Object.keys(item.files || {})[0] || `Gist ${item.id || ""}`)
            : (item.full_name || item.name || "未命名仓库");
        return {
            source: "github",
            sourceType,
            itemKey,
            title,
            raw: item,
        };
    }).filter(item => !!item.itemKey);
};

/**
 * 构建 GitHub Gist/Repo 到 Obsidian Markdown
 * @param {Object} item - mapped GitHub item (with .raw, .sourceType, .title, .itemKey)
 * @param {Object} settings - { token, aiApiKey, ... }
 */
const buildGitHubObsidianMarkdown = async (item, settings = {}) => {
    if (!item?.raw) {
        throw new Error("GitHub 条目数据不完整");
    }
    const sourceTypeMap = {
        stars: "Stars",
        repos: "Repos",
        forks: "Forks",
        gists: "Gists",
    };
    const sourceTypeLabel = sourceTypeMap[item.sourceType] || "GitHub";
    const bookmark = item.raw;
    const isGist = item.sourceType === "gists";
    const owner = isGist
        ? String(bookmark.owner?.login || "")
        : String(bookmark.owner?.login || String(bookmark.full_name || "").split("/")[0] || "");
    const inferredTags = Array.isArray(bookmark.inferredTags) ? bookmark.inferredTags : [];
    const topicTags = Array.isArray(bookmark.topics) ? bookmark.topics : [];
    const tags = Array.from(new Set([...topicTags, ...inferredTags].filter(Boolean))).slice(0, 20);

    if (isGist) {
        const files = Object.values(bookmark.files || {});
        const primaryFile = files[0] || {};
        const fileNames = Object.keys(bookmark.files || {});
        const title = item.title || bookmark.description || fileNames[0] || `Gist ${bookmark.id || ""}`;
        const language = primaryFile.language || "";
        const meta = {
            title,
            url: bookmark.html_url || "https://gist.github.com",
            author: owner || "未知",
            owner,
            gistId: String(bookmark.id || item.itemKey || ""),
            source: "GitHub",
            sourceType: sourceTypeLabel,
            category: "Gist",
            language,
            updatedAt: bookmark.updated_at || bookmark.created_at || "",
            tags,
        };
        let md = HTMLToMarkdown.buildFrontmatter(meta);
        md += `> [!info] GitHub Gist\n`;
        md += `> - **原始链接**: [${title}](${meta.url})\n`;
        md += `> - **作者**: ${owner || "未知"}\n`;
        md += `> - **类型**: ${sourceTypeLabel}\n`;
        md += `> - **语言**: ${language || "未知"}\n`;
        md += `> - **文件数**: ${fileNames.length}\n`;
        md += `> - **标签**: ${tags.join(", ") || "无"}\n`;
        md += `> - **更新时间**: ${bookmark.updated_at ? new Date(bookmark.updated_at).toLocaleString("zh-CN") : "未知"}\n`;
        md += `> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;

        if (bookmark.description) {
            md += `## 描述\n\n${bookmark.description}\n\n`;
        }
        if (fileNames.length > 0) {
            md += "## 文件列表\n\n";
            fileNames.forEach((fileName) => {
                const file = bookmark.files?.[fileName] || {};
                md += `- \`${fileName}\``;
                if (file.language) md += ` · ${file.language}`;
                if (Number.isFinite(file.size)) md += ` · ${file.size} bytes`;
                md += "\n";
            });
            md += "\n";
        }
        return {
            title,
            fileName: sanitizeObsidianFileName(title, `gist-${bookmark.id || "untitled"}`),
            markdown: md,
            url: meta.url,
        };
    }

    const enriched = await GitHubExporter.enrichRepo(bookmark, settings, { aiUsedCount: 0, aiMaxItems: 20 });
    const title = enriched.generatedTitle || item.title || enriched.full_name || enriched.name || "未命名仓库";
    const meta = {
        title,
        url: enriched.html_url || "https://github.com",
        author: owner || "未知",
        owner,
        repo: enriched.full_name || enriched.name || item.itemKey || "",
        source: "GitHub",
        sourceType: sourceTypeLabel,
        category: enriched.inferredCategory || "Repo",
        language: enriched.language || "",
        stars: enriched.stargazers_count || 0,
        updatedAt: enriched.pushed_at || enriched.updated_at || "",
        tags,
    };
    let md = HTMLToMarkdown.buildFrontmatter(meta);
    md += `> [!info] GitHub 项目\n`;
    md += `> - **原始链接**: [${enriched.full_name || title}](${meta.url})\n`;
    md += `> - **作者**: ${owner || "未知"}\n`;
    md += `> - **类型**: ${sourceTypeLabel}\n`;
    md += `> - **语言**: ${enriched.language || "未知"}\n`;
    md += `> - **Stars**: ${enriched.stargazers_count || 0}\n`;
    md += `> - **分类**: ${enriched.inferredCategory || "未分类"}\n`;
    md += `> - **标签**: ${tags.join(", ") || "无"}\n`;
    md += `> - **更新时间**: ${(enriched.pushed_at || enriched.updated_at) ? new Date(enriched.pushed_at || enriched.updated_at).toLocaleString("zh-CN") : "未知"}\n`;
    md += `> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;

    if (enriched.description) {
        md += `## 项目描述\n\n${enriched.description}\n\n`;
    }
    if (enriched.readmeSummary) {
        md += `## README 摘要\n\n${enriched.readmeSummary}\n\n`;
    }
    if (Array.isArray(enriched.topics) && enriched.topics.length > 0) {
        md += `## Topics\n\n${enriched.topics.map((topic) => `- ${topic}`).join("\n")}\n\n`;
    }

    return {
        title,
        fileName: sanitizeObsidianFileName(enriched.full_name || title, "github-repo"),
        markdown: md,
        url: meta.url,
    };
};

/**
 * 导出 GitHub selected items 到 Obsidian
 * @param {Array} selectedItems
 * @param {Object} settings - { obsUrl, obsKey, obsDir, ... }
 * @param {Function} onProgress
 * @param {Object} control - { isCancelled, isPaused } 取消/暂停控制
 */
const exportGitHubSelectedToObsidian = async (selectedItems, settings, onProgress, control = {}) => {
    const { obsUrl, obsKey, obsDir } = settings;
    if (!obsUrl || !obsKey) {
        throw new Error("请先配置 Obsidian API 地址和 Key");
    }
    if (!selectedItems || selectedItems.length === 0) {
        return { success: [], failed: [], skipped: [] };
    }

    const success = [];
    const failed = [];
    const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

    for (let i = 0; i < selectedItems.length; i++) {
        if (control.isCancelled) break;
        while (control.isPaused) {
            await Utils.sleep(200);
            if (control.isCancelled) break;
        }
        if (control.isCancelled) break;

        const item = selectedItems[i];
        onProgress?.(i + 1, selectedItems.length, item.title || item.itemKey || "GitHub");

        try {
            const note = await buildGitHubObsidianMarkdown(item, settings);
            const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${note.fileName}.md`, note.markdown);
            if (!noteResult.ok) throw new Error(noteResult.error);
            success.push({
                title: note.title,
                url: note.url,
            });
        } catch (error) {
            console.warn(`[GitHubObsidianService] Export failed: ${item.itemKey}`, error);
            failed.push({
                title: item.title || item.itemKey || "GitHub",
                error: error.message,
            });
        }

        if (i < selectedItems.length - 1 && delay > 0) {
            await Utils.sleep(delay);
        }
    }

    return {
        success,
        failed,
        skipped: control.isCancelled ? selectedItems.slice(success.length + failed.length).map((item) => ({
            title: item.title || item.itemKey || "GitHub",
        })) : [],
    };
};

/**
 * 导出 GitHub selected items 到 Notion
 * @param {Array} selectedItems
 * @param {Object} settings - { apiKey, databaseId, token }
 * @param {Function} onProgress
 */
const exportGitHubSelectedToNotion = async (selectedItems, settings, onProgress) => {
    const { apiKey, databaseId } = settings;
    if (!apiKey || !databaseId) {
        throw new Error("请先配置 Notion API Key 和数据库 ID");
    }
    if (!selectedItems || selectedItems.length === 0) {
        return { success: [], failed: [], skipped: [] };
    }

    const setupResult = await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);
    if (!setupResult.success) {
        throw new Error(`数据库配置失败: ${setupResult.error}`);
    }

    const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
    const success = [];
    const failed = [];

    for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const bookmark = item.raw;
        const sourceType = item.sourceType;
        const label = item.title || item.itemKey;
        onProgress?.(i + 1, selectedItems.length, label);

        try {
            let properties;
            if (sourceType === "gists") {
                properties = GitHubExporter.buildGistProperties(bookmark);
            } else {
                const sourceMap = { stars: "Star", repos: "Repo", forks: "Fork" };
                const enriched = await GitHubExporter.enrichRepo(bookmark, settings, { aiUsedCount: 0, aiMaxItems: 20 });
                properties = GitHubExporter.buildRepoProperties(enriched, sourceMap[sourceType] || "Star");
            }
            for (const key of Object.keys(properties)) {
                if (properties[key] === undefined) delete properties[key];
            }
            if (!OperationGuard.canExecute("createDatabasePage")) {
                GitHubExporter._auditExport("createDatabasePage", "denied",
                    { itemKey: item.itemKey, sourceType, itemName: item.title || item.itemKey, reason: "权限不足：手动导出建页需 level≥1" });
                failed.push({ title: item.title, error: "权限不足（需 level≥1）", itemKey: item.itemKey, sourceType });
                continue;
            }
            const page = await NotionAPI.request("POST", "/pages", {
                parent: { database_id: databaseId },
                properties,
            }, apiKey);

            if (sourceType === "gists") {
                GitHubAPI.markGistExportedAndFlush(item.itemKey);
            } else {
                GitHubAPI.markExportedAndFlush(item.itemKey);
            }
            GitHubExporter._auditExport("createDatabasePage", "success",
                { pageId: String(page?.id || ""), itemKey: item.itemKey, sourceType, databaseId });
            success.push({
                title: item.title,
                url: bookmark?.html_url || "https://github.com",
                itemKey: item.itemKey,
                sourceType,
            });
        } catch (error) {
            console.warn(`[GitHubObsidianService] Notion export failed: ${item.itemKey}`, error);
            GitHubExporter._auditExport("createDatabasePage", "failed",
                { itemKey: item.itemKey, sourceType, reason: String(error?.message || error) });
            failed.push({
                title: item.title,
                error: error.message,
                itemKey: item.itemKey,
                sourceType,
            });
        }

        if (i < selectedItems.length - 1 && delay > 0) {
            await Utils.sleep(delay);
        }
    }

    return { success, failed, skipped: [] };
};

module.exports = {
    sanitizeObsidianFileName,
    mapGitHubItemsToBookmarks,
    buildGitHubObsidianMarkdown,
    exportGitHubSelectedToObsidian,
    exportGitHubSelectedToNotion,
};
