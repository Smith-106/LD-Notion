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
const { SyncLock } = require("../sync-lock");

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
 * v3.14.7 (REV-03 UI-07): Obsidian 写入统一经 OperationGuard 闸门。
 * 此前 4 个裸调点绕过 Guard(权限 0 只读级仍可写零审计), 登记 obsidian.writeNote/writeImage
 * 后, 写入前 must canExecute, 拒绝时记 guard.denied 并抛错(由调用方按普通失败处理)。
 * @param {string} operation - obsidian.writeNote | obsidian.writeImage
 * @param {Object} context - 审计上下文(trigger/target 等)
 */
const assertObsidianWriteAllowed = (operation, context = {}) => {
    if (OperationGuard.canExecute(operation)) return;
    OperationGuard.auditDenied(operation, { ...context, trigger: context.trigger || "user_requested_write" }, {
        phase: "execute",
        reason: `权限不足：Obsidian 写入(${operation})需要 level≥1，可在主面板「权限控制」中调整。`,
    });
    throw new Error(`权限不足：Obsidian 写入需要 level≥1（可在主面板「权限控制」中调整）。`);
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
    // v3.14.4: 循环内仅 mutate 内存缓存, 循环末单次 flush —— 消除逐条全账本序列化的
    // 写侧 O(N²)(AGENTS.md 禁令; 与 GitHubExporter._exportItems PERF-003 模式同构)
    let githubDirty = false;
    // v3.14.5: Obsidian 认证/连接终态中止标记
    let authAbortInfo = null;

    try {
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
            // v3.14.7 (REV-03 UI-07): Obsidian 写入经 OperationGuard 闸门(此前裸调零审计)
            assertObsidianWriteAllowed("obsidian.writeNote", { itemKey: item.itemKey, sourceType: item.sourceType, itemName: item.title || item.itemKey });
            const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${note.fileName}.md`, note.markdown);
            if (!noteResult.ok) throw new Error(noteResult.error);
            // v3.14.3 修复: Obsidian 导出成功同样写入已导出账本(与 Notion 分支同构),
            // 否则 UI 恒显示“待导出”致重复导出。
            if (item.sourceType === "gists") {
                GitHubAPI.markGistExported(item.itemKey);
            } else {
                GitHubAPI.markExported(item.itemKey);
            }
            githubDirty = true;
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
            // 认证/连接终态 fail-fast(v3.14.5):Obsidian HTTP 401/403 或 key 无效是系统性错误,中止剩余项
            const obsErrMsg = String(error?.message || "");
            if (/\bHTTP\s*40[13]\b/.test(obsErrMsg) || obsErrMsg.includes("invalid") || obsErrMsg.includes("Invalid") || obsErrMsg.includes("ECONNREFUSED") || obsErrMsg.includes("refused")) {
                authAbortInfo = { reason: error.message, at: i + 1 };
                break;
            }
        }

        if (!authAbortInfo && i < selectedItems.length - 1 && delay > 0) {
            await Utils.sleep(delay);
        }
    }
    } finally {
        // 循环末单次持久化(成功/失败/取消均 flush, 避免中断丢账本)
        if (githubDirty) {
            GitHubAPI.flushExported();
            GitHubAPI.flushGistsExported();
        }
    }

    return {
        success,
        failed,
        skipped: (authAbortInfo || control.isCancelled) ? selectedItems.slice(success.length + failed.length).map((item) => ({
            title: item.title || item.itemKey || "GitHub",
        })) : [],
        ...(authAbortInfo ? { authAborted: authAbortInfo } : {}),
    };
};

/**
 * 导出 GitHub selected items 到 Notion
 * @param {Array} selectedItems
 * @param {Object} settings - { apiKey, databaseId, token }
 * @param {Function} onProgress
 * @param {Object} control - { isCancelled, isPaused } 取消/暂停控制（与 Obsidian 路径同构）
 */
const exportGitHubSelectedToNotion = async (selectedItems, settings, onProgress, control = {}) => {
    // v3.14.7 (REV-01 UI-05): GitHub 路径补 SyncLock 重入守卫——与 LinuxDo 路径
    // (export/index.js exportBookmarks)同构: AI 写/自动同步/手动导出并发时仅一方执行,
    // 避免双建页与互斥纪律缺口。
    if (SyncLock.isExporting) {
        return {
            success: [],
            failed: [],
            skipped: (selectedItems || []).map((item) => ({ title: item?.title || item?.itemKey || "GitHub" })),
            message: "已有导出进行中，已跳过本次请求",
        };
    }
    // v3.14.18 (D2/CC-04 补全): 跨 tab 租约 —— 与 LinuxDo 手动导出/自动同步共用 AUTO_SYNC_LEASE;
    // 另一 tab 的手动导出/自动同步持有时本轮全量 skipped, TTL 兜底防崩溃锁泄漏
    const lease = await SyncLock.acquireLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE);
    if (!lease) {
        return {
            success: [],
            failed: [],
            skipped: (selectedItems || []).map((item) => ({ title: item?.title || item?.itemKey || "GitHub" })),
            message: "其他标签页正在导出/同步，已跳过本次请求",
        };
    }
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
    // v3.14.6 (AUD-ARCH-02/08): Notion 分支补声明 githubDirty —— 认证终态分支引用它时不再
    // ReferenceError(v3.14.5 缺陷); 循环内仅 mutate 内存缓存 + 末次 flush, 消除逐条全账本
    // 序列化的写侧 O(N²)(与 Obsidian 分支同构)
    let githubDirty = false;
    SyncLock.isExporting = true;
    // 持有期间每 30s 续约(< 60s TTL); 续约失配置 leaseLost 中止(与 exportBookmarks 同构)
    let leaseLost = false;
    const renewTimer = setInterval(() => {
        if (!SyncLock.renewLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease)) {
            leaseLost = true;
            clearInterval(renewTimer);
        }
    }, 30000);

    try {
    for (let i = 0; i < selectedItems.length; i++) {
        if (control.isCancelled) break;
        if (leaseLost) break;
        while (control.isPaused) {
            await Utils.sleep(200);
            if (control.isCancelled) break;
        }
        if (control.isCancelled) break;

        const item = selectedItems[i];
        const bookmark = item.raw;
        const sourceType = item.sourceType;
        const label = item.title || item.itemKey;
        try {
            onProgress?.(i + 1, selectedItems.length, label);
        } catch (progressError) {
            console.warn(`[GitHubObsidianService] onProgress 回调异常 (${label}):`, progressError);
        }

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
                GitHubAPI.markGistExported(item.itemKey);
            } else {
                GitHubAPI.markExported(item.itemKey);
            }
            githubDirty = true;
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
            // 认证终态 fail-fast(v3.14.5):中止剩余 GitHub 项导出,避免逐项重复注定失败的 401
            // v3.14.7: 仅信 isAuthTerminal 标记(与 api 层终态/瞬态区分对齐), 消息子串会误杀瞬态续签失败
            if (error && error.isAuthTerminal === true) {
                const skipped = selectedItems.slice(i + 1).map((skippedItem) => ({
                    title: skippedItem.title || skippedItem.itemKey || "GitHub",
                }));
                // 已成功项的账本先落盘(与循环末 flush 对称, 中止不丢已导出事实)
                if (githubDirty) {
                    GitHubAPI.flushExported();
                    GitHubAPI.flushGistsExported();
                }
                return { success, failed, skipped, authAborted: { reason: error.message, at: i + 1, authCode: error.authCode || "unauthorized" } };
            }
        }

        if (i < selectedItems.length - 1 && delay > 0) {
            await Utils.sleep(delay);
        }
    }
    } finally {
        // 循环末单次持久化(成功/失败/取消/中止均 flush, 不丢已导出事实; flush 幂等)
        if (githubDirty) {
            GitHubAPI.flushExported();
            GitHubAPI.flushGistsExported();
        }
        // v3.14.7 (REV-01): 无论成败释放互斥锁(与 export/index.js finally 同构)
        clearInterval(renewTimer);
        SyncLock.releaseLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);
        SyncLock.isExporting = false;
    }

    return {
        success,
        failed,
        skipped: (control.isCancelled || leaseLost)
            ? selectedItems.slice(success.length + failed.length).map((item) => ({
                title: item.title || item.itemKey || "GitHub",
            }))
            : [],
    };
};

module.exports = {
    sanitizeObsidianFileName,
    mapGitHubItemsToBookmarks,
    buildGitHubObsidianMarkdown,
    exportGitHubSelectedToObsidian,
    exportGitHubSelectedToNotion,
};
