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
const { UICommandService } = require("./coordination");
// 多端同步(F-SYNC-11): 编译期 flag 默认 off → require 惰性(打包体积零新增? 否,
// esbuild 仍会打进去; 但 flag off 时 init 不执行 = 零网络/零定时器/零 DOM)。
const syncModule = CONFIG.MULTI_DEVICE_SYNC_ENABLED ? require("./sync") : null;

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
        if (UI.panel && UI.refs) {
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
    if (input && ChatUI.sendMessage) {
        input.value = cmd;
        ChatUI.sendMessage();
    }
});

// ===========================================
// 入口
// ===========================================

function main() {
    // 授权后目标发现(三模型共识):main.js 在启动编排层注册 postAuth handler,
    // 经 UICommandService 执行(只读 search + 决策矩阵),避免 auth→api/extract 循环依赖边
    NotionOAuth.registerPostAuthHandler(async ({ accessToken = "", source = "" } = {}) => {
        if (!accessToken) return;
        await UICommandService.execute("discover_export_target_after_auth", { accessToken, source });
    });

    // 跨页配置刷新(三模型共识):OAuth 三键 GM_addValueChangeListener,其他页面改动本页即时回填
    NotionOAuth.installCrossPageWatchers();

    const initUI = async () => {
      try {
        // 初始化主题系统
        DesignSystem.initTheme();
        await NotionOAuth.handleRedirectCallback();
        NotionOAuth.syncApiKeyInputs();

        const currentSite = SiteDetector.detect();

        if (currentSite === SiteDetector.SITES.LINUX_DO) {
            UI.init();
            Utils.runWhenBrowserIdle(() => UpdateChecker.init());
            // 双图标修复:LinuxDo 已有主面板(📚 收藏批量导出)作为单一浮动入口,
            // 不再初始化 GenericUI(📎 当前页导出浮钮),避免最小化态两浮钮堆叠。
            // GenericUI 仅用于 Zhihu/Generic 站点(见下方分支)。AutoImporter 独立,保留。
            const isBookmarkPage = /\/u\/[^/]+\/activity\/bookmarks/.test(window.location.pathname);
            if (!isBookmarkPage) {
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

        // 多端同步引擎初始化(F-SYNC-11 双重闸: 编译期 flag + 运行期 SyncConfig)
        if (syncModule && syncModule.SyncConfig && syncModule.SyncConfig.isEnabled()) {
            const { SyncEngine, SyncConfig: SC, SyncRateLimiter, SyncSerializer, SyncLedger, SyncPayload, SyncCrypto } = syncModule;
            SyncEngine.init({
                Storage,
                SyncStateV2: SyncState,
                DedupStore: require("./storage/DedupStore").DedupStore,
                NotionAPI,
                OperationGuard,
                OperationLog,
            });
            // 共享请求预算(F-SYNC-04): gate 默认 null; 仅同步启用时注入, 导出路径共享 3 req/s 桶
            NotionAPI.setRequestGate(() => SyncRateLimiter.gateAcquire());
            Utils.runWhenBrowserIdle(() => SyncEngine.pull({ reason: "idle" }));
            // 周期 pull(与自动导入节奏错峰, LOW-3: deviceId 哈希取模)
            const hash = SC.getDeviceId().split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
            const phase = hash % 15; // 0-14 分钟偏移
            setTimeout(() => {
                const loop = () => {
                    // 全盘审计修复(find 6): 禁用后停止周期 pull(不再拉取/应用远端状态)
                    if (!SC.isEnabled()) return;
                    SyncEngine.pull({ reason: "periodic" });
                    setTimeout(loop, 30 * 60 * 1000 + phase * 60000);
                };
                loop();
            }, phase * 60000);
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

        // 授权后目标发现结果消费(三模型共识):跨页结果落存储,目标页 UI 读取回显
        const postAuthTarget = NotionOAuth.consumePostAuthTarget();
        if (postAuthTarget) {
            if (currentSite === SiteDetector.SITES.NOTION && typeof NotionSiteUI.applyPostAuthTarget === "function") {
                NotionSiteUI.applyPostAuthTarget(postAuthTarget);
            } else if (typeof UI.applyPostAuthTarget === "function") {
                UI.applyPostAuthTarget(postAuthTarget);
            }
        }
      } catch (e) {
        // 入口错误边界（REL-001）：initUI 内任一初始化异常（OAuth 回调/主题/UI.init/AutoImporter.init）
        // 原本成 unhandledrejection 被 userscript 容错环境静默吞，用户面板不加载且无报错。
        // 此处 console.error 落诊断 + 尽力向用户展示失败提示（showStatus 自身失败不影响）。
        console.error("[LD-Notion] 初始化失败:", e);
        try {
            if (typeof UI !== "undefined" && typeof UI.showStatus === "function") {
                UI.showStatus(`LD-Notion 初始化失败: ${e?.message || e}`, "error");
            } else if (typeof GenericUI !== "undefined" && typeof GenericUI.showStatus === "function") {
                GenericUI.showStatus(`LD-Notion 初始化失败: ${e?.message || e}`, "error");
            }
        } catch (_) { /* 错误展示自身失败不二次抛出，外层 console.error 已落诊断 */ }
      }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initUI);
    } else {
        initUI();
    }
}

main();
