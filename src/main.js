"use strict";

// src/main.js — 入口文件，导入并连接所有模块

// ===========================================
// 模块导入
// ===========================================
const { CONFIG, SUPPORTED_FILE_TYPES, EXT_TO_MIME, FILE_TYPE_CATEGORY, SUPPORTED_IMAGE_TYPES, MULTI_PART_THRESHOLD, isSupportedFileType, getMimeType, getFileCategory, MSG } = require("./config");
const { Utils } = require("./utils");
const { Storage, SyncState } = require("./storage");
const { CredentialVault, TargetState, NotionOAuth } = require("./auth");
const { SiteDetector, InstallHelper, EMOJI_MAP, NOTION_LANGUAGES, normalizeLanguage, DOMToNotion, NotionTransport, NotionAPI, ObsidianAPI, HTMLToMarkdown } = require("./api");
const { AIService, ChatState, QUICK_INTENT_PATTERNS, QUICK_INTENT_RULES, AI_AGENT_TOOLS, AIHandlers, AIAssistant, AIWelcomeUI, ChatUI, AIClassifier } = require("./ai");
const { OperationGuard, OperationLog, ConfirmationDialog, UndoManager } = require("./security");
const { ZhihuAPI, GenericExtractor, WorkspaceService } = require("./extract");
const { GenericExporter, LinuxDoAPI, Exporter } = require("./export");
const { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter } = require("./import");
const { BookmarkBridge, BookmarkExporter, BookmarkAutoImporter, RSSAutoImporter } = require("./bridge");
const { StyleManager, DesignSystem, PanelResize, NotionSiteUI, UI_CSS, UIEvents, UI, GenericUI } = require("./ui");

// ===========================================
// 模块连接 — 注入跨模块依赖
// ===========================================

// 将 CredentialVault 注入 Storage 模块（Storage.get 方法依赖 CredentialVault）
Storage.CredentialVault = CredentialVault;

// ===========================================
// 桥接初始化
// ===========================================
BookmarkBridge.init();

// 监听扩展 Popup 快捷操作（仅在 Chrome 扩展版中生效）
window.addEventListener("ld-notion-popup-action", (event) => {
    const { action } = event.detail || {};

    if (action === "set-bookmark-source") {
        const source = event.detail?.source === "github" ? "github" : "linuxdo";
        Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, source);
        if (typeof UI !== "undefined" && UI.panel && UI.refs) {
            if (typeof UI.switchBookmarkSource === "function") {
                UI.switchBookmarkSource(source);
            } else {
                UI.applyBookmarkSourceUI(source);
            }
            const sourceToggle = UI.refs.sourceSettingsToggle;
            const sourceContent = UI.refs.sourceSettingsContent;
            const sourceArrow = UI.refs.sourceSettingsArrow;
            if (sourceToggle && sourceContent?.classList.contains("collapsed")) {
                sourceToggle.click();
            } else if (sourceContent && sourceArrow) {
                sourceContent.classList.remove("collapsed");
                sourceArrow.textContent = "▼";
            }
        }
        return;
    }

    const cmdMap = {
        "import-bookmarks": "导入浏览器书签",
        "import-github": "导入GitHub收藏",
    };
    const cmd = cmdMap[action];
    if (!cmd) return;

    const input = document.querySelector("#ldb-chat-input");
    if (input && typeof ChatUI !== "undefined" && ChatUI.sendMessage) {
        input.value = cmd;
        ChatUI.sendMessage();
    }
});

// ===========================================
// 入口
// ===========================================

function main() {
    const initUI = async () => {
        // 初始化主题系统
        DesignSystem.initTheme();
        await NotionOAuth.handleRedirectCallback();
        NotionOAuth.syncApiKeyInputs();

        const currentSite = SiteDetector.detect();

        if (currentSite === SiteDetector.SITES.LINUX_DO) {
            UI.init();
            Utils.runWhenBrowserIdle(() => UpdateChecker.init());
            const isBookmarkPage = /\/u\/[^/]+\/activity\/bookmarks/.test(window.location.pathname);
            if (!isBookmarkPage) {
                Utils.runWhenBrowserIdle(() => GenericUI.init());
                Utils.runWhenBrowserIdle(() => AutoImporter.init());
            }
            Utils.runWhenBrowserIdle(() => BookmarkAutoImporter.init());
            Utils.runWhenBrowserIdle(() => RSSAutoImporter.init());
        } else if (currentSite === SiteDetector.SITES.NOTION) {
            NotionSiteUI.init();
            Utils.runWhenBrowserIdle(() => BookmarkAutoImporter.init());
            Utils.runWhenBrowserIdle(() => RSSAutoImporter.init());
        } else if (currentSite === SiteDetector.SITES.GITHUB) {
            UI.init();
            Utils.runWhenBrowserIdle(() => UpdateChecker.init());
            Utils.runWhenBrowserIdle(() => GitHubAutoImporter.init());
            Utils.runWhenBrowserIdle(() => BookmarkAutoImporter.init());
            Utils.runWhenBrowserIdle(() => RSSAutoImporter.init());
        } else if (currentSite === SiteDetector.SITES.ZHIHU) {
            GenericUI.init();
        } else if (currentSite === SiteDetector.SITES.GENERIC) {
            GenericUI.init();
        }

        const notice = NotionOAuth.consumeNotice();
        if (notice?.message) {
            if (currentSite === SiteDetector.SITES.NOTION && typeof NotionSiteUI.showStatus === "function") {
                NotionSiteUI.showStatus(notice.message, notice.type || "info");
            } else if (currentSite === SiteDetector.SITES.GENERIC && typeof GenericUI.showStatus === "function") {
                GenericUI.showStatus(notice.message, notice.type || "info");
            } else if (typeof UI.showStatus === "function") {
                UI.showStatus(notice.message, notice.type || "info");
            }
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initUI);
    } else {
        initUI();
    }
}

main();
