"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { SiteDetector } = require("../api");
const { GitHubAPI } = require("../import");
const { ChatUI } = require("../ai");

// 因这些函数内部引用了 UI 自身方法与状态（如 UI.refs、UI.selectedBookmarks、
// UI.renderBookmarkList 等），需在运行时获取 UI 引用。采用惰性 require 模式避免循环依赖。
let _UI = null;
const UI = () => {
    if (!_UI) _UI = require("./main-ui").UI;
    return _UI;
};

const BookmarkList = {

    isGitHubMode: () => SiteDetector.isGitHub(),

    getActiveBookmarkSource: () => {
        const source = Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, CONFIG.DEFAULTS.bookmarkSource);
        return source === "github" ? "github" : "linuxdo";
    },

    isActiveGitHubSource: () => UI().getActiveBookmarkSource() === "github",

    getAutoImportConfigBySource: () => {
        const isGitHub = UI().isActiveGitHubSource();
        return {
            isGitHub,
            enabledKey: isGitHub ? CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED : CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED,
            intervalKey: isGitHub ? CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_INTERVAL : CONFIG.STORAGE_KEYS.AUTO_IMPORT_INTERVAL,
            enabledDefault: isGitHub ? CONFIG.DEFAULTS.githubAutoImportEnabled : CONFIG.DEFAULTS.autoImportEnabled,
            intervalDefault: isGitHub ? CONFIG.DEFAULTS.githubAutoImportInterval : CONFIG.DEFAULTS.autoImportInterval,
        };
    },

    updateVisualSnapshot: (source, bookmarks) => {
        const key = source === "github" ? "github" : "linuxdo";
        UI().visualSnapshots[key] = Array.isArray(bookmarks) ? bookmarks.slice() : [];
    },

    getCombinedVisualBookmarks: () => {
        return [
            ...(Array.isArray(UI().visualSnapshots.linuxdo) ? UI().visualSnapshots.linuxdo : []),
            ...(Array.isArray(UI().visualSnapshots.github) ? UI().visualSnapshots.github : []),
        ];
    },

    getBookmarkVisualSourceLabel: (bookmark) => {
        return bookmark?.source === "github" ? "GitHub" : "Linux.do";
    },

    getBookmarkVisualTypeLabel: (bookmark) => {
        if (bookmark?.source === "github") {
            const sourceTypeMap = {
                stars: "Stars",
                repos: "Repos",
                forks: "Forks",
                gists: "Gists",
            };
            return sourceTypeMap[bookmark.sourceType] || "GitHub";
        }
        return "帖子";
    },

    getBookmarkVisualDate: (bookmark) => {
        const candidates = bookmark?.source === "github"
            ? [
                bookmark?.raw?.updated_at,
                bookmark?.raw?.created_at,
                bookmark?.raw?.pushed_at,
                bookmark?.updated_at,
                bookmark?.created_at,
            ]
            : [
                bookmark?.created_at,
                bookmark?.bookmarked_at,
                bookmark?.updated_at,
            ];

        for (const candidate of candidates) {
            if (!candidate) continue;
            const date = new Date(candidate);
            if (!Number.isNaN(date.getTime())) {
                return date;
            }
        }
        return null;
    },

    applyBookmarkSourceUI: (source) => {
        const refs = UI().refs || {};
        const isGitHub = source === "github";

        if (refs.bookmarksLabel) {
            refs.bookmarksLabel.textContent = "已加载收藏数量";
        }
        if (refs.autoImportLabel) {
            refs.autoImportLabel.textContent = "启用自动导入新收藏";
        }
        if (refs.autoImportIntervalLabel) {
            refs.autoImportIntervalLabel.textContent = "轮询间隔";
        }

        if (refs.sourceSelectLinuxdo) {
            refs.sourceSelectLinuxdo.classList.toggle("active", !isGitHub);
            // P2:aria-pressed 同步切换状态
            refs.sourceSelectLinuxdo.setAttribute("aria-pressed", String(!isGitHub));
        }
        if (refs.sourceSelectGithub) {
            refs.sourceSelectGithub.classList.toggle("active", isGitHub);
            refs.sourceSelectGithub.setAttribute("aria-pressed", String(isGitHub));
        }

        const autoStatus = refs.autoImportStatus || UI().panel?.querySelector("#ldb-auto-import-status");
        if (autoStatus && autoStatus.textContent && !autoStatus.textContent.includes("⚠️")) {
            autoStatus.textContent = "";
        }
    },

    getBookmarkKey: (bookmark) => {
        if (bookmark?.source === "github") {
            return `gh:${bookmark.sourceType}:${bookmark.itemKey}`;
        }
        return String(bookmark?.topic_id || bookmark?.bookmarkable_id || "");
    },

    // v3.14.16: 导出状态依据（本地账本 | Notion 工作区快照只读覆盖）
    getExportStatusSource: () => {
        const value = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_STATUS_SOURCE, CONFIG.DEFAULTS.exportStatusSource);
        return value === "notion" ? "notion" : "local";
    },

    setExportStatusSource: (source) => {
        Storage.set(
            CONFIG.STORAGE_KEYS.EXPORT_STATUS_SOURCE,
            source === "notion" ? "notion" : "local"
        );
    },

    hasWorkspaceExportSnapshot: () => {
        const snap = UI().workspaceVisualSnapshot;
        return !!(snap && snap.scannedAt);
    },

    getWorkspaceExportedUrlSet: () => {
        const snap = UI().workspaceVisualSnapshot;
        const records = snap?.records;
        if (!Array.isArray(records)) return new Set();
        // P4 收敛(c11 2/3): 收藏列表逐行调用本函数 → 每次重建全量集合(O(N×M))。
        // 快照对象仅在刷新时整体替换(workspace-insight.js:1008), 故按对象+长度记忆安全。
        const cache = UI()._workspaceExportUrlSetCache;
        if (cache && cache.snap === snap && cache.len === records.length) return cache.set;
        const set = new Set();
        records.forEach((record) => {
            const url = UI().normalizeWorkspaceInsightUrl(record?.sourceUrl || record?.url || "");
            if (url) set.add(url);
        });
        UI()._workspaceExportUrlSetCache = { snap, len: records.length, set };
        return set;
    },

    buildBookmarkCanonicalUrl: (bookmark) => {
        if (!bookmark) return "";
        if (bookmark.source === "github") {
            return UI().normalizeWorkspaceInsightUrl(bookmark?.raw?.html_url || "");
        }
        const topicId = String(bookmark?.topic_id || bookmark?.bookmarkable_id || "");
        if (!topicId) return "";
        return UI().normalizeWorkspaceInsightUrl(`https://linux.do/t/${topicId}`);
    },

    buildBookmarkKeyCanonicalUrl: (bookmarkKey) => {
        if (!bookmarkKey) return "";
        if (!String(bookmarkKey).startsWith("gh:")) {
            return UI().normalizeWorkspaceInsightUrl(`https://linux.do/t/${bookmarkKey}`);
        }
        const bookmarks = Array.isArray(UI().bookmarks) ? UI().bookmarks : [];
        // P4 收敛(c11): 本函数随列表逐行调用, 原先每行对全量 bookmarks 线性 find 并重建 key(O(N²));
        // 与上方导出 URL 集合同口径按「数组身份 + 长度」记忆(列表刷新整体替换数组时自动失效)
        const cache = UI()._bookmarkKeyUrlCache;
        if (!cache || cache.arr !== bookmarks || cache.len !== bookmarks.length) {
            const map = new Map();
            for (const b of bookmarks) {
                const k = UI().getBookmarkKey(b);
                if (k && !map.has(k)) map.set(k, UI().buildBookmarkCanonicalUrl(b));
            }
            UI()._bookmarkKeyUrlCache = { arr: bookmarks, len: bookmarks.length, map };
        }
        const hit = UI()._bookmarkKeyUrlCache.map.get(bookmarkKey);
        if (hit) return hit;
        const parts = String(bookmarkKey).split(":");
        const sourceType = parts[1] || "";
        const itemKey = parts.slice(2).join(":");
        if (!itemKey) return "";
        if (sourceType === "gists") {
            return UI().normalizeWorkspaceInsightUrl(`https://gist.github.com/${itemKey}`);
        }
        return UI().normalizeWorkspaceInsightUrl(`https://github.com/${itemKey}`);
    },

    // 只读覆盖：notion 模式查工作区快照；无快照时全部视为待导出（避免静默跳过）
    isExportedForUi: (bookmarkOrKey) => {
        const isKey = typeof bookmarkOrKey === "string" || typeof bookmarkOrKey === "number";
        const bookmarkKey = isKey
            ? String(bookmarkOrKey || "")
            : UI().getBookmarkKey(bookmarkOrKey);
        if (!bookmarkKey) return false;

        if (UI().getExportStatusSource() === "notion") {
            if (!UI().hasWorkspaceExportSnapshot()) return false;
            // allow_duplicates：与本地模式一致，Linux.do 项不按已导出禁用
            if (!bookmarkKey.startsWith("gh:") && !Utils.isLinuxDoDedupStrict()) return false;
            const url = isKey
                ? UI().buildBookmarkKeyCanonicalUrl(bookmarkKey)
                : UI().buildBookmarkCanonicalUrl(bookmarkOrKey);
            if (!url) return false;
            return UI().getWorkspaceExportedUrlSet().has(url);
        }

        return UI().isBookmarkKeyExportedLocal(bookmarkKey);
    },

    isBookmarkKeyExportedLocal: (bookmarkKey) => {
        if (!bookmarkKey) return false;
        const dedupStrict = Utils.isLinuxDoDedupStrict();
        if (!bookmarkKey.startsWith("gh:")) {
            if (!dedupStrict) return false;
            return Storage.isTopicExported(bookmarkKey);
        }
        const parts = bookmarkKey.split(":");
        const sourceType = parts[1] || "";
        const itemKey = parts.slice(2).join(":");
        if (sourceType === "gists") {
            return GitHubAPI.isGistExported(itemKey);
        }
        return GitHubAPI.isExported(itemKey);
    },

    isBookmarkKeyExported: (bookmarkKey) => {
        return UI().isExportedForUi(bookmarkKey);
    },

    isBookmarkExported: (bookmark) => {
        return UI().isExportedForUi(bookmark);
    },

    updateExportStatusTip: () => {
        const tip = UI().refs?.exportStatusTip;
        if (!tip) return;
        const source = UI().getExportStatusSource();
        if (source !== "notion") {
            tip.textContent = "「本地账本」沿用去重/导出记录；切换到「Notion 工作区」后按最近一次工作区快照中的链接判定已导出（只读，不改本地账本）。";
            return;
        }
        if (!UI().hasWorkspaceExportSnapshot()) {
            tip.textContent = "请先刷新工作区：当前无 Notion 快照，已加载项均按待导出显示，避免误跳过导出。";
            return;
        }
        tip.textContent = "导出状态依据 Notion 工作区快照（只读覆盖，不改本地账本）。清空 Notion 后刷新工作区即可全部回到待导出。";
    },

    recomputeExportStatusFromNotion: () => {
        UI().updateExportStatusTip();
        UI().recomputeExportStats?.();
        UI().renderBookmarkList?.();
        // P3 共识(dsf+glm): renderBookmarkList 内部已调 updateSelectCount → renderVisualSummary,
        // 原实现再显式调用造成同轮双渲染。
        return {
            source: UI().getExportStatusSource(),
            hasSnapshot: UI().hasWorkspaceExportSnapshot(),
            urlCount: UI().getWorkspaceExportedUrlSet().size,
        };
    },

    getSelectedBookmarks: () => {
        if (!Array.isArray(UI().bookmarks) || UI().bookmarks.length === 0) return [];
        return UI().bookmarks.filter((bookmark) => {
            const bookmarkKey = UI().getBookmarkKey(bookmark);
            return UI().selectedBookmarks?.has(bookmarkKey);
        });
    },

    buildBookmarkItemHtml: (bookmark, githubMode = false) => {
        const bookmarkKey = UI().getBookmarkKey(bookmark);
        const title = bookmark.title || bookmark.name || `帖子 ${bookmarkKey}`;
        const escapedTitle = Utils.escapeHtml(title);
        const escapedTruncatedTitle = Utils.escapeHtml(Utils.truncateText(title, 35));
        const isExported = UI().isBookmarkKeyExported(bookmarkKey);
        const isSelected = UI().selectedBookmarks?.has(bookmarkKey);
        const sourceTag = githubMode
            ? `<span class="status" style="margin-right: var(--ldb-ui-spacing-sm);">${Utils.escapeHtml((bookmark.sourceType || "stars").toUpperCase())}</span>`
            : "";
        const reexportAction = isExported
            ? `<button type="button" class="ldb-btn ldb-btn-secondary ldb-btn-small" data-bookmark-action="reexport" title="移除该项的导出记录并重新加入待导出列表">重新导出</button>`
            : ``;
                
        // Render re-export action with confirmation dialog
        const escapedBookmarkKey = Utils.escapeHtml(bookmarkKey);
                
        return `
            <div class="ldb-bookmark-item" data-topic-id="${escapedBookmarkKey}">
                <input type="checkbox" ${isSelected ? "checked" : ""} ${isExported ? "disabled" : ""} ${isExported ? 'title="已导出到 Notion，无法重复导入"' : ""}>
                <span class="title" title="${escapedTitle}">${escapedTruncatedTitle}</span>
                ${sourceTag}${isExported ? '<span class="status exported">已导出</span>' : '<span class="status pending">待导出</span>'}
                ${reexportAction}
            </div>
        `;
    },

    // 渲染收藏列表
    renderBookmarkList: () => {
        // P3 3/3 共识(dsf+glm+qwen): refs 未就绪/面板销毁后调用会裸解引用抛错
        const list = UI().refs?.bookmarkList;
        if (!list) return;
        UI().recomputeExportStats();
        UI().renderJobId += 1;
        const renderJobId = UI().renderJobId;
        if (!UI().bookmarks || UI().bookmarks.length === 0) {
            // F-UI-15:空状态按钮按来源区分(GitHub 来源显示加载 GitHub 收藏,避免动作错配)
            const isGitHub = UI().isActiveGitHubSource();
            const emptyLabel = isGitHub ? "📥 加载 GitHub 收藏" : "📥 导入浏览器书签";
            list.innerHTML = `
                <div style="padding: var(--ldb-ui-spacing-xl); text-align: center; color: var(--ldb-ui-muted);">
                    <p>暂无收藏</p>
                    <button id="ldb-import-bookmarks-btn" class="ldb-btn ldb-btn-primary" style="margin-top: var(--ldb-ui-spacing-lg);">${emptyLabel}</button>
                </div>
            `;
            // Bind import button event
            setTimeout(() => {
                // P3 共识(glm+qwen): 晚到绑定须校验渲染代次——否则旧闭包 isGitHub 覆盖新按钮
                if (renderJobId !== UI().renderJobId) return;
                const importBtn = list.querySelector("#ldb-import-bookmarks-btn");
                if (importBtn) {
                    importBtn.onclick = () => {
                        if (isGitHub) {
                            // GitHub 来源:直接触发加载 GitHub 收藏(不依赖 AI)
                            const loadBtn = document.querySelector("#ldb-load-bookmarks");
                            if (loadBtn) {
                                loadBtn.click();
                            } else {
                                UI().showStatus("请先在收藏区点击「加载收藏列表」", "info");
                            }
                            return;
                        }
                        // F-01 修复:sendMessage 忽略入参,须先注入指令文本再发送
                        const chatInput = document.querySelector("#ldb-chat-input");
                        if (chatInput && ChatUI.sendMessage) {
                            UI().showStatus("正在导入浏览器书签，请耐心等待...", "info");
                            chatInput.value = "导入浏览器书签";
                            ChatUI.sendMessage();
                        } else {
                            UI().showStatus("AI 面板未就绪，请稍后重试", "error");
                        }
                    };
                }
            }, 0);
            UI().updateSelectCount();
            return;
        }

        const githubMode = UI().isActiveGitHubSource();
        const bookmarks = UI().bookmarks.slice();
        const chunkSize = bookmarks.length > 150 ? 80 : bookmarks.length;
        let cursor = 0;
        list.innerHTML = "";

        const appendChunk = () => {
            if (UI().renderJobId !== renderJobId) return;
            const chunk = bookmarks.slice(cursor, cursor + chunkSize).map((bookmark) => UI().buildBookmarkItemHtml(bookmark, githubMode)).join("");
            list.insertAdjacentHTML("beforeend", chunk);
            cursor += chunkSize;
            if (cursor < bookmarks.length) {
                if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
                    window.requestAnimationFrame(appendChunk);
                } else {
                    setTimeout(appendChunk, 0);
                }
            }
        };

        appendChunk();
        UI().updateSelectCount();
        // renderVisualSummary 由 updateSelectCount 末尾调用，无需重复（PERF-004）
    },

    requeueLinuxDoBookmark: (bookmarkKey) => {
        if (!bookmarkKey) return false;
        // v3.14.4: GitHub 项(gh: 前缀 key)同样支持重新导出 —— 修复对账误标后无恢复入口的问题
        // (共享账本下"已导出"= Notion 或 Obsidian 任一目标, 误标可通过此入口撤销)。
        if (bookmarkKey.startsWith("gh:")) {
            const parts = bookmarkKey.split(":");
            const sourceType = parts[1] || "";
            const itemKey = parts.slice(2).join(":");
            if (!itemKey) return false;
            let removed = false;
            if (sourceType === "gists") {
                removed = GitHubAPI.unmarkGistExported(itemKey);
            } else {
                removed = GitHubAPI.unmarkExported(itemKey);
            }
            if (!removed) {
                UI().showStatus("该项当前不在已导出记录中。", "info");
                return false;
            }
            UI().selectedBookmarks.add(bookmarkKey);
            UI().recomputeExportStats();
            UI().renderBookmarkList();
            UI().showStatus("已移除该项的导出记录，请重新勾选并导出。", "success");
            return true;
        }
        if (!Utils.isLinuxDoDedupStrict()) {
            UI().showStatus("当前为允许重复模式，无需重新导出；直接勾选并导出即可。", "info");
            return false;
        }

        const removed = Storage.unmarkTopicExported(bookmarkKey);
        if (!removed) {
            UI().showStatus("该帖子当前不在已导出记录中。", "info");
            return false;
        }

        UI().selectedBookmarks.add(bookmarkKey);
        UI().recomputeExportStats();
        UI().renderBookmarkList();
        UI().showStatus("已移除该帖子的导出记录，请重新点击导出。", "success");
        return true;
    },

    syncRenderedSelectionState: () => {
        const list = (UI().refs && UI().refs.bookmarkList) || UI().panel?.querySelector("#ldb-bookmark-list");
        if (!list) return;

        list.querySelectorAll(".ldb-bookmark-item").forEach((item) => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (!checkbox || checkbox.disabled) return;
            const bookmarkKey = String(item.dataset.topicId || "");
            if (!bookmarkKey) return;
            checkbox.checked = UI().selectedBookmarks?.has(bookmarkKey) || false;
        });
    },

};

module.exports = { BookmarkList };
