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
// v3.14.6 (AUD-ARCH-07): 编译期字面量开关剪枝 sync/ 全模块 —— 实测 esbuild(treeShaking:false)
// 对 define 替换后的条件不触发外层 DCE, 仅源字面量 `false ? require(...)` 在解析期折叠移除
// (1.59MB 包体中 sync/ 全量入包; 启用多端同步时改 true 并重建双形态)。
// 与 CONFIG.MULTI_DEVICE_SYNC_ENABLED 运行期双闸保持一致: 运行时 SyncConfig.isEnabled() 仍为第二道闸。
const syncModule = false ? require("./sync") : null;

// ===========================================
// 模块连接 — 注入跨模块依赖
// ===========================================

// 将 CredentialVault 注入 Storage 模块（Storage.get 方法依赖 CredentialVault）
Storage.CredentialVault = CredentialVault;

// ===========================================
// 桥接初始化
// ===========================================
BookmarkBridge.init();

// Userscript OAuth: capture ?code&state ASAP (paired with @run-at document-start).
// Notion SPA often history.replaceState-clears OAuth query before document-idle inject.
try {
    NotionOAuth.captureCallbackSnapshot();
} catch (_) { /* 快照失败不阻断启动 */ }

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
    // P4 收敛(c09): 原型链键(constructor/toString)会命中继承属性 —— 必须自有属性校验
    const cmd = Object.prototype.hasOwnProperty.call(cmdMap, action) ? cmdMap[action] : undefined;
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
    // 导出/AI 目标四键跨页同步(3/3 共识):防陈旧面板保存覆盖他端新配置
    UI.installTargetCrossPageWatchers();

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
        // v3.14.6 (AUD-ARCH-07): 接线整体移入 sync/index.js boot —— 字面量开关剪枝时
        // require 整体缺席, 接线文本与 sync 模块名不残留于产物
        if (syncModule && syncModule.boot) {
            syncModule.boot({
                Storage,
                SyncState,
                DedupStore: require("./storage/DedupStore").DedupStore,
                NotionAPI,
                OperationGuard,
                OperationLog,
                Utils,
            });
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
            // v3.14.6 (AUD-ARCH-16): UI/GenericUI 为顶部 import, typeof 守卫恒真, 删前缀仅留方法存在性检查
            if (typeof UI.showStatus === "function") {
                UI.showStatus(`LD-Notion 初始化失败: ${e?.message || e}`, "error");
            } else if (typeof GenericUI.showStatus === "function") {
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
