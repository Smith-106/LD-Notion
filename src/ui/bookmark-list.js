"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { SiteDetector } = require("../api");
const { GitHubAPI } = require("../import");

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
        }
        if (refs.sourceSelectGithub) {
            refs.sourceSelectGithub.classList.toggle("active", isGitHub);
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

    isBookmarkKeyExported: (bookmarkKey) => {
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

    isBookmarkExported: (bookmark) => {
        return UI().isBookmarkKeyExported(UI().getBookmarkKey(bookmark));
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
        const reexportAction = !githubMode && isExported
            ? `<button type="button" class="ldb-btn ldb-btn-secondary ldb-btn-small" data-bookmark-action="reexport" title="移除该帖子的导出记录并重新加入待导出列表">重新导出</button>`
            : ``;
                
        // Render re-export action with confirmation dialog
        const escapedBookmarkKey = Utils.escapeHtml(bookmarkKey);
                
        return `
            <div class="ldb-bookmark-item" data-topic-id="${escapedBookmarkKey}">
                <input type="checkbox" ${isSelected ? "checked" : ""} ${isExported ? "disabled" : ""} ${isExported ? 'title="已导出到 Notion，无法重复导入"' : ""}>
                <span class="title" title="${escapedTitle}">${escapedTruncatedTitle}</span>
                ${sourceTag}${isExported ? '<span class="status exported">已导出</span>' : '<span class="status pending">待导出</span>'}
                ${reexportAction ? `<button type="button" class="ldb-btn ldb-btn-secondary ldb-btn-small" data-bookmark-action="reexport" onclick="event.stopPropagation(); ConfirmationDialog.show({ title: '确认操作', message: '重新导出将覆盖现有 Notion 页面，是否继续？', confirmText: '重新导出', onConfirm: () => window.location.reload(); });">重新导出</button>` : ''}
            </div>
        `;
    },

    // 渲染收藏列表
    renderBookmarkList: () => {
        const list = UI().refs.bookmarkList
        UI().recomputeExportStats();
        UI().renderJobId += 1;
        const renderJobId = UI().renderJobId;
        if (!UI().bookmarks || UI().bookmarks.length === 0) {
            list.innerHTML = `
                <div style="padding: var(--ldb-ui-spacing-xl); text-align: center; color: var(--ldb-ui-muted);">
                    <p>暂无收藏</p>
                    <button id="ldb-import-bookmarks-btn" class="ldb-btn ldb-btn-primary" style="margin-top: var(--ldb-ui-spacing-lg);">📥 导入浏览器书签</button>
                </div>
            `;
            // Bind import button event
            setTimeout(() => {
                const importBtn = list.querySelector("#ldb-import-bookmarks-btn");
                if (importBtn) {
                    importBtn.onclick = () => {
                        ChatUI.sendMessage("import-bookmarks-from-browser");
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
        if (!bookmarkKey || bookmarkKey.startsWith("gh:")) return false;
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
