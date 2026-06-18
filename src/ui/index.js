"use strict";

// 依赖引入
const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { NotionAPI, DOMToNotion, SiteDetector, InstallHelper, HTMLToMarkdown, ObsidianAPI, EMOJI_MAP } = require("../api");
const { OperationGuard, UndoManager, OperationLog, ConfirmationDialog } = require("../security");
const { ZhihuAPI, GenericExtractor, WorkspaceService } = require("../extract");
const { Exporter, LinuxDoAPI, GenericExporter } = require("../export");
const { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter } = require("../import");
const { BookmarkBridge, BookmarkExporter, BookmarkAutoImporter, RSSAutoImporter } = require("../bridge");
const { AIService, ChatState, AIAssistant, AIClassifier, AIWelcomeUI, ChatUI } = require("../ai");

const StyleManager = {
    injectOnce: (styleId, cssText) => {
        if (!styleId || !cssText) return null;
        const root = document.head || document.documentElement;
        if (!root) return null;

        const existing = document.getElementById(styleId);
        if (existing) return existing;

        const style = document.createElement("style");
        style.id = styleId;
        style.setAttribute("data-ldb-style", styleId);
        style.textContent = cssText;
        root.appendChild(style);
        return style;
    },
};

const DesignSystem = {
    STYLE_IDS: {
        BASE: "ldb-ui-base",
        CHAT: "ldb-ui-chat",
        NOTION: "ldb-ui-notion",
        LINUX_DO: "ldb-ui-linux-do",
        GENERIC: "ldb-ui-generic",
    },

    // 主题管理
    _theme: "auto",
    _mediaQuery: null,

    initTheme: () => {
        DesignSystem._theme = Storage.get(CONFIG.STORAGE_KEYS.THEME_PREFERENCE, CONFIG.DEFAULTS.themePreference);
        DesignSystem._applyTheme();
        // 监听系统主题变化（auto 模式下自动跟随）
        DesignSystem._mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        DesignSystem._mediaQuery.addEventListener("change", () => {
            if (DesignSystem._theme === "auto") DesignSystem._applyTheme();
        });
    },

    setTheme: (theme) => {
        DesignSystem._theme = theme;
        Storage.set(CONFIG.STORAGE_KEYS.THEME_PREFERENCE, theme);
        DesignSystem._applyTheme();
    },

    getEffectiveTheme: () => {
        if (DesignSystem._theme === "auto") {
            return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        return DesignSystem._theme;
    },

    _applyTheme: () => {
        const effective = DesignSystem.getEffectiveTheme();
        document.querySelectorAll("[data-ldb-root]").forEach(el => {
            el.setAttribute("data-ldb-theme", effective);
        });
        // 同步所有主题切换按钮
        document.querySelectorAll(".ldb-theme-btn").forEach(btn => {
            btn.textContent = effective === "dark" ? "☀️" : "🌙";
            btn.title = effective === "dark" ? "切换亮色模式" : "切换暗色模式";
        });
    },

    toggleTheme: () => {
        const effective = DesignSystem.getEffectiveTheme();
        DesignSystem.setTheme(effective === "dark" ? "light" : "dark");
    },

    ensureBase: () => {
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.BASE, DesignSystem.getBaseCSS());
    },
    ensureChat: () => {
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.CHAT, DesignSystem.getChatCSS());
    },

    getBaseCSS: () => `
        /* LDB_UI_TOKENS */
        .ldb-panel,
        .ldb-notion-panel,
        .gclip-panel,
        .ldb-notion-float-btn,
        .ldb-mini-btn,
        .gclip-float-btn,
        .ldb-undo-toast {
            --ldb-ui-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

            --ldb-ui-radius: 14px;
            --ldb-ui-radius-sm: 10px;
            --ldb-ui-radius-xs: 8px;

            --ldb-ui-shadow: 0 18px 55px rgba(2, 6, 23, 0.22);
            --ldb-ui-shadow-sm: 0 10px 26px rgba(2, 6, 23, 0.16);

            --ldb-ui-text: #0f172a;
            --ldb-ui-muted: #64748b;
            --ldb-ui-border: rgba(15, 23, 42, 0.14);

            --ldb-ui-surface: rgba(255, 255, 255, 0.94);
            --ldb-ui-surface-2: rgba(248, 250, 252, 0.94);
            --ldb-ui-surface-3: rgba(241, 245, 249, 0.94);

            --ldb-ui-accent: #2563eb;
            --ldb-ui-accent-2: #7c3aed;

            --ldb-ui-success: #16a34a;
            --ldb-ui-warning: #d97706;
            --ldb-ui-danger: #dc2626;

            --ldb-ui-focus-ring: rgba(37, 99, 235, 0.35);
            --ldb-ui-backdrop: rgba(2, 6, 23, 0.35);

            font-family: var(--ldb-ui-font);
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        /* 暗色主题 — 通过 data-ldb-theme 属性触发 */
        [data-ldb-theme="dark"].ldb-panel,
        [data-ldb-theme="dark"].ldb-notion-panel,
        [data-ldb-theme="dark"].gclip-panel,
        [data-ldb-theme="dark"].ldb-notion-float-btn,
        [data-ldb-theme="dark"].ldb-mini-btn,
        [data-ldb-theme="dark"].gclip-float-btn,
        [data-ldb-theme="dark"].ldb-undo-toast,
        [data-ldb-theme="dark"] .ldb-panel,
        [data-ldb-theme="dark"] .ldb-notion-panel,
        [data-ldb-theme="dark"] .gclip-panel,
        [data-ldb-theme="dark"] .ldb-notion-float-btn,
        [data-ldb-theme="dark"] .ldb-mini-btn,
        [data-ldb-theme="dark"] .gclip-float-btn,
        [data-ldb-theme="dark"] .ldb-undo-toast {
            --ldb-ui-text: #e5e7eb;
            --ldb-ui-muted: #9ca3af;
            --ldb-ui-border: rgba(148, 163, 184, 0.22);

            --ldb-ui-surface: rgba(17, 24, 39, 0.92);
            --ldb-ui-surface-2: rgba(15, 23, 42, 0.92);
            --ldb-ui-surface-3: rgba(2, 6, 23, 0.60);

            --ldb-ui-accent: #60a5fa;
            --ldb-ui-accent-2: #c4b5fd;

            --ldb-ui-focus-ring: rgba(96, 165, 250, 0.35);
            --ldb-ui-backdrop: rgba(0, 0, 0, 0.45);
        }

        /* 保留 prefers-color-scheme 作为 auto 模式的回退 */
        @media (prefers-color-scheme: dark) {
            .ldb-panel:not([data-ldb-theme]),
            .ldb-notion-panel:not([data-ldb-theme]),
            .gclip-panel:not([data-ldb-theme]),
            .ldb-notion-float-btn:not([data-ldb-theme]),
            .ldb-mini-btn:not([data-ldb-theme]),
            .gclip-float-btn:not([data-ldb-theme]),
            .ldb-undo-toast:not([data-ldb-theme]) {
                --ldb-ui-text: #e5e7eb;
                --ldb-ui-muted: #9ca3af;
                --ldb-ui-border: rgba(148, 163, 184, 0.22);

                --ldb-ui-surface: rgba(17, 24, 39, 0.92);
                --ldb-ui-surface-2: rgba(15, 23, 42, 0.92);
                --ldb-ui-surface-3: rgba(2, 6, 23, 0.60);

                --ldb-ui-accent: #60a5fa;
                --ldb-ui-accent-2: #c4b5fd;

                --ldb-ui-focus-ring: rgba(96, 165, 250, 0.35);
                --ldb-ui-backdrop: rgba(0, 0, 0, 0.45);
            }
        }

        .ldb-panel,
        .ldb-notion-panel,
        .gclip-panel,
        .ldb-undo-toast {
            color: var(--ldb-ui-text);
        }

        .ldb-panel *,
        .ldb-notion-panel *,
        .gclip-panel *,
        .ldb-undo-toast * {
            box-sizing: border-box;
        }

        .ldb-panel a,
        .ldb-notion-panel a,
        .gclip-panel a {
            color: var(--ldb-ui-accent);
            text-decoration: none;
        }
        .ldb-panel a:hover,
        .ldb-notion-panel a:hover,
        .gclip-panel a:hover {
            text-decoration: underline;
        }

        .ldb-panel button,
        .ldb-notion-panel button,
        .gclip-panel button,
        .ldb-notion-float-btn,
        .ldb-mini-btn,
        .gclip-float-btn {
            font-family: inherit;
        }

        .ldb-panel input,
        .ldb-panel select,
        .ldb-panel textarea,
        .ldb-notion-panel input,
        .ldb-notion-panel select,
        .ldb-notion-panel textarea,
        .gclip-panel input,
        .gclip-panel select,
        .gclip-panel textarea {
            font-family: inherit;
            color: var(--ldb-ui-text);
            background: var(--ldb-ui-surface-2);
            border: 1px solid var(--ldb-ui-border);
            border-radius: var(--ldb-ui-radius-xs);
            padding: 8px 10px;
            outline: none;
        }

        .ldb-panel input::placeholder,
        .ldb-panel textarea::placeholder,
        .ldb-notion-panel input::placeholder,
        .ldb-notion-panel textarea::placeholder,
        .gclip-panel input::placeholder,
        .gclip-panel textarea::placeholder {
            color: var(--ldb-ui-muted);
        }

        .ldb-panel button:focus-visible,
        .ldb-panel input:focus-visible,
        .ldb-panel select:focus-visible,
        .ldb-panel textarea:focus-visible,
        .ldb-notion-panel button:focus-visible,
        .ldb-notion-panel input:focus-visible,
        .ldb-notion-panel select:focus-visible,
        .ldb-notion-panel textarea:focus-visible,
        .gclip-panel button:focus-visible,
        .gclip-panel input:focus-visible,
        .gclip-panel select:focus-visible,
        .gclip-panel textarea:focus-visible,
        .ldb-notion-float-btn:focus-visible,
        .ldb-mini-btn:focus-visible,
        .gclip-float-btn:focus-visible {
            outline: none;
            box-shadow: 0 0 0 3px var(--ldb-ui-focus-ring);
        }

        .ldb-panel,
        .ldb-notion-panel,
        .gclip-panel {
            background: var(--ldb-ui-surface);
            border: 1px solid var(--ldb-ui-border);
            border-radius: var(--ldb-ui-radius);
            box-shadow: var(--ldb-ui-shadow);
            backdrop-filter: blur(10px);
        }

        .ldb-header,
        .ldb-notion-header,
        .gclip-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 12px 14px;
            background: rgba(148, 163, 184, 0.10);
            border-bottom: 1px solid var(--ldb-ui-border);
        }

        .ldb-header h3,
        .ldb-notion-header h3 {
            margin: 0;
            font-size: 14px;
            font-weight: 700;
            color: var(--ldb-ui-text);
            letter-spacing: 0.2px;
        }

        .ldb-header-btn,
        .ldb-notion-header-btn,
        .gclip-panel-header .close-btn {
            width: 30px;
            height: 30px;
            border-radius: 10px;
            border: 1px solid var(--ldb-ui-border);
            background: rgba(148, 163, 184, 0.12);
            color: var(--ldb-ui-text);
            cursor: pointer;
            user-select: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            line-height: 1;
        }

        .ldb-header-btn:hover,
        .ldb-notion-header-btn:hover,
        .gclip-panel-header .close-btn:hover {
            background: rgba(148, 163, 184, 0.18);
        }

        .ldb-btn,
        .gclip-btn {
            border: 1px solid rgba(37, 99, 235, 0.35);
            background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
            color: #fff;
            border-radius: 12px;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            font-weight: 650;
        }

        .ldb-btn:disabled,
        .gclip-btn:disabled {
            opacity: 0.65;
            cursor: not-allowed;
        }

        .ldb-btn-secondary,
        .gclip-btn-secondary {
            border: 1px solid var(--ldb-ui-border);
            background: rgba(148, 163, 184, 0.12);
            color: var(--ldb-ui-text);
            font-weight: 600;
        }

        .ldb-btn-warning {
            border: 1px solid rgba(217, 119, 6, 0.35);
            background: linear-gradient(135deg, #f59e0b 0%, var(--ldb-ui-warning) 100%);
            color: #fff;
        }

        .ldb-btn-danger {
            border: 1px solid rgba(220, 38, 38, 0.35);
            background: linear-gradient(135deg, #ef4444 0%, var(--ldb-ui-danger) 100%);
            color: #fff;
        }

        .ldb-section-title {
            font-size: 13px;
            font-weight: 700;
            margin-bottom: 10px;
            color: var(--ldb-ui-text);
        }

        .ldb-flex-1 { flex: 1; }
        .ldb-mt-8 { margin-top: 8px; }
        .ldb-mt-12 { margin-top: 12px; }
        .ldb-mb-8 { margin-bottom: 8px; }
        .ldb-flex-gap { display: flex; gap: 8px; }
        .ldb-nowrap-badge { padding: 6px 12px; white-space: nowrap; }
        .ldb-hint { font-size: 12px; color: var(--ldb-ui-muted); }
        .ldb-section-divider { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ldb-ui-border); }
        .ldb-flex-center-gap { display: flex; align-items: center; gap: 8px; }

        .ldb-section {
            padding: 12px 0;
        }

        .ldb-body,
        .ldb-notion-body,
        .gclip-panel-body {
            padding: 14px;
        }

        .ldb-input-group,
        .gclip-field,
        .ldb-form-group {
            margin-bottom: 12px;
        }

        .ldb-label,
        .gclip-field label,
        .ldb-form-group label {
            display: block;
            margin-bottom: 6px;
            font-size: 12px;
            font-weight: 650;
            color: var(--ldb-ui-muted);
        }

        .ldb-input,
        .ldb-select {
            width: 100%;
        }

        .ldb-tip {
            margin-top: 6px;
            font-size: 12px;
            color: var(--ldb-ui-muted);
        }

        .ldb-divider {
            height: 1px;
            background: var(--ldb-ui-border);
            margin: 12px 0;
        }

        .ldb-status {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 10px;
            padding: 10px 12px;
            border-radius: 12px;
            border: 1px solid var(--ldb-ui-border);
            background: rgba(148, 163, 184, 0.10);
            color: var(--ldb-ui-text);
            font-size: 12px;
            line-height: 1.5;
        }

        .ldb-status.success {
            border-color: rgba(22, 163, 74, 0.35);
            background: rgba(22, 163, 74, 0.12);
        }
        .ldb-status.error {
            border-color: rgba(220, 38, 38, 0.35);
            background: rgba(220, 38, 38, 0.12);
        }
        .ldb-status.info {
            border-color: rgba(37, 99, 235, 0.30);
            background: rgba(37, 99, 235, 0.10);
        }

        .ldb-status-close {
            width: 26px;
            height: 26px;
            border-radius: 10px;
            border: 1px solid var(--ldb-ui-border);
            background: rgba(148, 163, 184, 0.10);
            color: var(--ldb-ui-text);
            cursor: pointer;
            flex: 0 0 auto;
            line-height: 1;
        }

        .ldb-status-close:hover {
            background: rgba(148, 163, 184, 0.18);
        }

        @media (prefers-reduced-motion: reduce) {
            .ldb-panel,
            .ldb-notion-panel,
            .gclip-panel,
            .ldb-undo-toast,
            .ldb-panel *,
            .ldb-notion-panel *,
            .gclip-panel *,
            .ldb-notion-float-btn,
            .ldb-mini-btn,
            .gclip-float-btn {
                transition: none !important;
                animation: none !important;
                scroll-behavior: auto !important;
            }
        }
    `,

    getChatCSS: () => `
        /* LDB_UI_CHAT */
        .ldb-panel .ldb-chat-container,
        .ldb-notion-panel .ldb-chat-container {
            height: 280px;
            overflow-y: auto;
            background: var(--ldb-ui-surface-3);
            border: 1px solid var(--ldb-ui-border);
            border-radius: var(--ldb-ui-radius-sm);
            padding: 12px;
            margin-bottom: 12px;
        }

        .ldb-panel .ldb-chat-container::-webkit-scrollbar,
        .ldb-notion-panel .ldb-chat-container::-webkit-scrollbar {
            width: 6px;
        }
        .ldb-panel .ldb-chat-container::-webkit-scrollbar-track,
        .ldb-notion-panel .ldb-chat-container::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.06);
            border-radius: 3px;
        }
        .ldb-panel .ldb-chat-container::-webkit-scrollbar-thumb,
        .ldb-notion-panel .ldb-chat-container::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.35);
            border-radius: 3px;
        }

        @media (prefers-color-scheme: dark) {
            .ldb-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-track,
            .ldb-notion-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.06);
            }
            .ldb-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-thumb,
            .ldb-notion-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.30);
            }
        }

        [data-ldb-theme="dark"] .ldb-chat-container::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.06);
        }
        [data-ldb-theme="dark"] .ldb-chat-container::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.30);
        }

        .ldb-panel .ldb-chat-welcome,
        .ldb-notion-panel .ldb-chat-welcome {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
            color: var(--ldb-ui-muted);
            gap: 10px;
        }

        .ldb-panel .ldb-chat-welcome-icon,
        .ldb-notion-panel .ldb-chat-welcome-icon {
            font-size: 44px;
            line-height: 1;
        }

        .ldb-panel .ldb-chat-welcome-text,
        .ldb-notion-panel .ldb-chat-welcome-text {
            font-size: 13px;
            line-height: 1.6;
        }

        .ldb-panel .ldb-chat-welcome-text small,
        .ldb-notion-panel .ldb-chat-welcome-text small {
            color: var(--ldb-ui-muted);
            opacity: 0.9;
        }

        .ldb-panel .ldb-chat-chips,
        .ldb-notion-panel .ldb-chat-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 4px;
            justify-content: center;
        }

        .ldb-panel .ldb-chat-chip,
        .ldb-notion-panel .ldb-chat-chip {
            padding: 6px 12px;
            background: rgba(148, 163, 184, 0.14);
            border: 1px solid var(--ldb-ui-border);
            border-radius: 999px;
            color: var(--ldb-ui-text);
            font-size: 12px;
            cursor: pointer;
        }

        .ldb-panel .ldb-chat-chip:hover,
        .ldb-notion-panel .ldb-chat-chip:hover {
            background: rgba(37, 99, 235, 0.16);
            border-color: rgba(37, 99, 235, 0.28);
        }

        .ldb-panel .ldb-chat-message,
        .ldb-notion-panel .ldb-chat-message {
            margin-bottom: 12px;
            display: flex;
            flex-direction: column;
        }

        .ldb-panel .ldb-chat-message.user,
        .ldb-notion-panel .ldb-chat-message.user {
            align-items: flex-end;
        }

        .ldb-panel .ldb-chat-message.assistant,
        .ldb-notion-panel .ldb-chat-message.assistant {
            align-items: flex-start;
        }

        .ldb-panel .ldb-chat-bubble,
        .ldb-notion-panel .ldb-chat-bubble {
            max-width: 85%;
            padding: 10px 12px;
            border-radius: 12px;
            font-size: 13px;
            line-height: 1.6;
            word-break: break-word;
            border: 1px solid transparent;
        }

        .ldb-panel .ldb-chat-bubble.user,
        .ldb-notion-panel .ldb-chat-bubble.user {
            background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
            color: #fff;
            border-bottom-right-radius: 6px;
        }

        .ldb-panel .ldb-chat-bubble.assistant,
        .ldb-notion-panel .ldb-chat-bubble.assistant {
            background: var(--ldb-ui-surface-2);
            color: var(--ldb-ui-text);
            border: 1px solid var(--ldb-ui-border);
            border-bottom-left-radius: 6px;
        }

        .ldb-panel .ldb-chat-bubble.processing,
        .ldb-notion-panel .ldb-chat-bubble.processing {
            opacity: 0.85;
        }

        .ldb-panel .ldb-chat-bubble.processing .ldb-typing-dots,
        .ldb-notion-panel .ldb-chat-bubble.processing .ldb-typing-dots {
            display: inline-flex;
            gap: 4px;
            margin-left: 6px;
            vertical-align: middle;
        }

        .ldb-panel .ldb-chat-bubble.processing .ldb-typing-dots span,
        .ldb-notion-panel .ldb-chat-bubble.processing .ldb-typing-dots span {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: rgba(148, 163, 184, 0.9);
            display: inline-block;
            animation: ldb-typing 1.1s infinite ease-in-out;
        }

        .ldb-panel .ldb-chat-bubble.processing .ldb-typing-dots span:nth-child(2),
        .ldb-notion-panel .ldb-chat-bubble.processing .ldb-typing-dots span:nth-child(2) {
            animation-delay: 0.2s;
        }
        .ldb-panel .ldb-chat-bubble.processing .ldb-typing-dots span:nth-child(3),
        .ldb-notion-panel .ldb-chat-bubble.processing .ldb-typing-dots span:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes ldb-typing {
            0%, 80%, 100% { transform: translateY(0); opacity: 0.6; }
            40% { transform: translateY(-3px); opacity: 1; }
        }

        .ldb-panel .ldb-chat-input-container,
        .ldb-notion-panel .ldb-chat-input-container {
            display: flex;
            gap: 8px;
            align-items: flex-end;
            margin-top: 10px;
        }

        .ldb-panel .ldb-chat-input,
        .ldb-notion-panel .ldb-chat-input {
            flex: 1;
            resize: none;
            min-height: 36px;
            max-height: 80px;
            line-height: 1.5;
        }

        .ldb-panel .ldb-chat-send-btn,
        .ldb-notion-panel .ldb-chat-send-btn {
            padding: 8px 12px;
            border-radius: 10px;
            border: 1px solid rgba(37, 99, 235, 0.35);
            background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
            color: #fff;
            cursor: pointer;
            user-select: none;
        }

        .ldb-panel .ldb-chat-send-btn:disabled,
        .ldb-notion-panel .ldb-chat-send-btn:disabled {
            opacity: 0.65;
            cursor: not-allowed;
        }

        .ldb-panel .ldb-chat-actions,
        .ldb-notion-panel .ldb-chat-actions {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }

        .ldb-panel .ldb-chat-action-btn,
        .ldb-notion-panel .ldb-chat-action-btn {
            padding: 6px 10px;
            border-radius: 10px;
            border: 1px solid var(--ldb-ui-border);
            background: rgba(148, 163, 184, 0.12);
            color: var(--ldb-ui-text);
            cursor: pointer;
            user-select: none;
            font-size: 12px;
        }

        .ldb-panel .ldb-chat-action-btn:hover,
        .ldb-notion-panel .ldb-chat-action-btn:hover {
            background: rgba(148, 163, 184, 0.18);
        }

        .ldb-panel .ldb-chat-settings-toggle,
        .ldb-notion-panel .ldb-chat-settings-toggle {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            user-select: none;
            margin-top: 10px;
            padding: 8px 10px;
            border-radius: 10px;
            border: 1px solid var(--ldb-ui-border);
            background: rgba(148, 163, 184, 0.10);
        }

        .ldb-panel .ldb-chat-settings-content.collapsed,
        .ldb-notion-panel .ldb-chat-settings-content.collapsed {
            display: none;
        }
    `,
};


const PanelResize = {
    _stylesInjected: false,

    injectStyles: () => {
        if (PanelResize._stylesInjected) return;
        PanelResize._stylesInjected = true;
        const style = document.createElement("style");
        style.textContent = `
            .ldb-resize-handle {
                position: absolute;
                z-index: 10;
            }
            .ldb-resize-handle-l {
                left: -3px; top: 0; width: 6px; height: 100%;
                cursor: ew-resize;
            }
            .ldb-resize-handle-t {
                left: 0; top: -3px; width: 100%; height: 6px;
                cursor: ns-resize;
            }
            .ldb-resize-handle-b {
                left: 0; bottom: -3px; width: 100%; height: 6px;
                cursor: ns-resize;
            }
            .ldb-resize-handle-tl {
                left: -3px; top: -3px; width: 12px; height: 12px;
                cursor: nwse-resize;
            }
            .ldb-resize-handle-bl {
                left: -3px; bottom: -3px; width: 12px; height: 12px;
                cursor: nesw-resize;
            }
        `;
        document.head.appendChild(style);
    },

    makeResizable: (element, options = {}) => {
        const {
            edges = ["l", "t"],
            storageKey = null,
            minWidth = 280,
            minHeight = 200,
            maxWidth = 800,
        } = options;

        PanelResize.injectStyles();

        edges.forEach(edge => {
            const handle = document.createElement("div");
            handle.className = `ldb-resize-handle ldb-resize-handle-${edge}`;
            element.appendChild(handle);

            handle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                const startWidth = element.offsetWidth;
                const startHeight = element.offsetHeight;
                document.body.style.userSelect = "none";
                element.style.transition = "none";

                const onMove = (ev) => {
                    if (edge.includes("l")) {
                        const dx = startX - ev.clientX;
                        element.style.width = Math.max(minWidth, Math.min(maxWidth, startWidth + dx)) + "px";
                    }
                    if (edge.includes("t")) {
                        const dy = startY - ev.clientY;
                        const maxH = window.innerHeight * 0.9;
                        element.style.maxHeight = Math.max(minHeight, Math.min(maxH, startHeight + dy)) + "px";
                    }
                    if (edge.includes("b")) {
                        const dy = ev.clientY - startY;
                        const maxH = window.innerHeight * 0.9;
                        element.style.maxHeight = Math.max(minHeight, Math.min(maxH, startHeight + dy)) + "px";
                    }
                };

                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    document.body.style.userSelect = "";
                    element.style.transition = "";
                    if (storageKey) {
                        Storage.set(storageKey, JSON.stringify({
                            width: element.style.width,
                            maxHeight: element.style.maxHeight,
                        }));
                    }
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });
        });

        // 恢复已保存的尺寸
        if (storageKey) {
            const saved = Storage.get(storageKey, null);
            if (saved) {
                try {
                    const size = JSON.parse(saved);
                    if (size.width) element.style.width = size.width;
                    if (size.maxHeight) element.style.maxHeight = size.maxHeight;
                } catch (e) {
                    console.warn("[LD-Notion] corrupted panel size, resetting:", storageKey);
                    Storage.remove(storageKey);
                }
            }
        }
    },
};


const NotionSiteUI = {
    panel: null,
    floatBtn: null,
    isMinimized: true,
    isPanelReady: false,

    // 注入样式
    injectStyles: () => {
        DesignSystem.ensureBase();
        DesignSystem.ensureChat();
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.NOTION, `
            /* LDB_UI_NOTION */
            .ldb-notion-float-btn {
                position: fixed;
                right: 24px;
                bottom: 24px;
                width: 52px;
                height: 52px;
                border-radius: 999px;
                border: 1px solid rgba(37, 99, 235, 0.35);
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: #fff;
                font-size: 22px;
                cursor: pointer;
                box-shadow: var(--ldb-ui-shadow-sm);
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: transform 0.18s ease, box-shadow 0.18s ease;
            }

            .ldb-notion-float-btn:hover {
                transform: translateY(-1px) scale(1.03);
                box-shadow: var(--ldb-ui-shadow);
            }

            .ldb-notion-float-btn.dragging {
                transform: none;
                opacity: 0.85;
                cursor: grabbing;
            }

            .ldb-notion-panel {
                position: fixed;
                right: 24px;
                bottom: 96px;
                width: 380px;
                max-height: 70vh;
                z-index: 2147483646;
                overflow: hidden;
                display: none;
            }

            .ldb-notion-panel.visible {
                display: block;
            }

            .ldb-notion-header-btns {
                display: flex;
                gap: 8px;
            }

            .ldb-notion-body {
                max-height: calc(70vh - 56px);
                overflow-y: auto;
            }

            .ldb-notion-toggle-section {
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                user-select: none;
                margin-top: 10px;
                padding: 8px 10px;
                border-radius: 10px;
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                color: var(--ldb-ui-text);
            }

            .ldb-notion-toggle-content.collapsed {
                display: none;
            }

            #ldb-notion-status-container {
                margin-top: 12px;
            }
        `);
    },

    // 创建浮动按钮（可拖拽）
    createFloatButton: () => {
        const btn = document.createElement("button");
        btn.className = "ldb-notion-float-btn";
        btn.setAttribute("data-ldb-root", "");
        btn.innerHTML = "🤖";
        btn.title = "AI 助手";

        // 拖拽状态
        let isDragging = false;
        let hasMoved = false;
        let offsetX, offsetY;

        btn.addEventListener("mousedown", (e) => {
            isDragging = true;
            hasMoved = false;
            offsetX = e.clientX - btn.getBoundingClientRect().left;
            offsetY = e.clientY - btn.getBoundingClientRect().top;
            btn.classList.add("dragging");
            document.body.style.userSelect = "none";
            e.preventDefault();
        });

        NotionSiteUI._floatDragMove = (e) => {                if (!isDragging) return;
            hasMoved = true;
            const x = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, e.clientX - offsetX));
            const y = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, e.clientY - offsetY));
            btn.style.left = x + "px";
            btn.style.top = y + "px";
            btn.style.right = "auto";
            btn.style.bottom = "auto";            };            document.addEventListener("mousemove", NotionSiteUI._floatDragMove);
        NotionSiteUI._floatDragEnd = () => {                if (!isDragging) return;
            isDragging = false;
            btn.classList.remove("dragging");
            document.body.style.userSelect = "";
            if (hasMoved) {
                const rect = btn.getBoundingClientRect();
                const right = window.innerWidth - rect.right;
                const bottom = window.innerHeight - rect.bottom;
                Storage.set(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION, JSON.stringify({ right: right + "px", bottom: bottom + "px" }));
            }            };            document.addEventListener("mouseup", NotionSiteUI._floatDragEnd);
        btn.addEventListener("click", (e) => {
            if (hasMoved) {
                // 拖拽结束，不触发点击
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            NotionSiteUI.ensurePanelReady();
            NotionSiteUI.togglePanel();
        });

        // 恢复保存的位置
        const savedPosition = Storage.get(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION, null);
        if (savedPosition) {
            try {
                const pos = JSON.parse(savedPosition);
                btn.style.right = pos.right || "24px";
                btn.style.bottom = pos.bottom || "24px";
            } catch (e) {
                console.warn("[LD-Notion] corrupted float btn position, resetting");
                Storage.remove(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION);
            }
        }

        document.body.appendChild(btn);
        NotionSiteUI.floatBtn = btn;
        return btn;
    },

    // 创建面板
    createPanel: () => {
        const panel = document.createElement("div");
        const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        panel.className = "ldb-notion-panel";
        panel.setAttribute("data-ldb-root", "");
        panel.innerHTML = `
            <div class="ldb-notion-header">
                <h3>🤖 AI 助手</h3>
                <div class="ldb-notion-header-btns">
                    <button class="ldb-theme-btn" id="ldb-notion-theme-toggle" title="切换主题" style="width:26px;height:26px;border-radius:8px;font-size:13px;">🌙</button>
                    <button class="ldb-notion-header-btn" id="ldb-notion-close" title="关闭">×</button>
                </div>
            </div>
            <div class="ldb-notion-body">
                <!-- 对话区域 -->
                <div class="ldb-chat-container" id="ldb-chat-messages">
                    ${AIWelcomeUI.render(personaName)}
                </div>

                <!-- 输入区域 -->
                <div class="ldb-chat-input-container">
                    <textarea
                        id="ldb-chat-input"
                        class="ldb-chat-input"
                        placeholder="${Utils.escapeHtml(AIWelcomeUI.getInputPlaceholder())}"
                        rows="1"
                    ></textarea>
                    <button id="ldb-chat-send" class="ldb-chat-send-btn">发送</button>
                </div>

                <!-- 快捷操作 -->
                <div class="ldb-chat-actions">
                    <button class="ldb-chat-action-btn" id="ldb-chat-clear">🗑️ 清空</button>
                </div>

                <div class="ldb-divider"></div>

                <!-- 设置折叠区 -->
                <div class="ldb-notion-toggle-section" id="ldb-notion-settings-toggle">
                    <span>⚙️ 设置</span>
                    <span id="ldb-notion-settings-arrow">▶</span>
                </div>
                <div class="ldb-notion-toggle-content collapsed" id="ldb-notion-settings-content">
                    <div class="ldb-input-group" class="ldb-mt-12">
                        <label class="ldb-label">Notion API Key</label>
                        <input type="password" class="ldb-input" id="ldb-notion-api-key" placeholder="secret_xxx...">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">Notion OAuth（公开集成）</label>
                        <input type="text" class="ldb-input" id="ldb-notion-oauth-client-id" placeholder="Client ID">
                        <input type="password" class="ldb-input" id="ldb-notion-oauth-client-secret" placeholder="Client Secret" class="ldb-mt-8">
                        <input type="text" class="ldb-input" id="ldb-notion-oauth-redirect-uri" placeholder="Redirect URI" class="ldb-mt-8">
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                            <button class="ldb-btn ldb-btn-primary" id="ldb-notion-oauth-authorize" style="padding: 6px 12px;">🔐 一键授权</button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-oauth-clear" style="padding: 6px 12px;">断开授权</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-oauth-status" style="margin-top: 6px;"></div>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-vault-unlock" style="padding: 6px 12px;">解锁保险箱</button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-vault-lock" style="padding: 6px 12px;">锁定</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-vault-status" style="margin-top: 6px;"></div>
                        <div class="ldb-tip">适用于 Notion 公开集成。敏感凭证会保存在本地加密保险箱中，仅在解锁后的当前会话内可用。</div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">数据库 / 页面</label>
                        <div class="ldb-flex-gap">
                            <select class="ldb-select" id="ldb-notion-ai-target-db" class="ldb-flex-1">
                                <option value="">默认（跟随导出数据库）</option>
                                <option value="__all__">所有工作区数据库</option>
                            </select>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-refresh-workspace" class="ldb-nowrap-badge" title="刷新工作区列表">🔄</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-workspace-tip"></div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">AI 服务</label>
                        <select class="ldb-select" id="ldb-notion-ai-service">
                            <option value="openai">OpenAI</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                        </select>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">模型</label>
                        <div class="ldb-flex-gap">
                            <select class="ldb-select" id="ldb-notion-ai-model" class="ldb-flex-1"></select>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-ai-fetch-models" class="ldb-nowrap-badge">🔄 获取</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-ai-model-tip"></div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">AI API Key</label>
                        <input type="password" class="ldb-input" id="ldb-notion-ai-api-key" placeholder="AI 服务的 API Key">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">自定义端点 (可选)</label>
                        <input type="text" class="ldb-input" id="ldb-notion-ai-base-url" placeholder="留空使用官方 API">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">分类列表</label>
                        <input type="text" class="ldb-input" id="ldb-notion-ai-categories" placeholder="技术, 生活, 问答, 分享, 资源, 其他">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">刷新页数上限</label>
                        <select class="ldb-select" id="ldb-notion-workspace-max-pages">
                            <option value="5">5 页 (500 条)</option>
                            <option value="10">10 页 (1000 条)</option>
                            <option value="20">20 页 (2000 条)</option>
                            <option value="50">50 页 (5000 条)</option>
                            <option value="0">无限制</option>
                        </select>
                        <div class="ldb-tip">刷新工作区列表时每类的最大分页数</div>
                    </div>
                    <div class="ldb-section-divider">
                        <span class="ldb-hint">🤖 Agent 个性化</span>
                    </div>
                    <div class="ldb-input-group" class="ldb-mt-8">
                        <label class="ldb-label">助手名字</label>
                        <input type="text" class="ldb-input" id="ldb-notion-persona-name" placeholder="AI 助手">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">语气风格</label>
                        <select class="ldb-select" id="ldb-notion-persona-tone">
                            <option value="友好">友好</option>
                            <option value="专业">专业</option>
                            <option value="幽默">幽默</option>
                            <option value="简洁">简洁</option>
                            <option value="热情">热情</option>
                        </select>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">专业领域</label>
                        <input type="text" class="ldb-input" id="ldb-notion-persona-expertise" placeholder="Notion 工作区管理">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">自定义指令 (可选)</label>
                        <textarea class="ldb-input" id="ldb-notion-persona-instructions" rows="2" placeholder="额外的行为指令..." style="resize: vertical;"></textarea>
                    </div>
                    <div class="ldb-section-divider">
                        <span class="ldb-hint">🐙 GitHub 收藏导入</span>
                    </div>
                    <div class="ldb-input-group" class="ldb-mt-8">
                        <label class="ldb-label">GitHub 用户名</label>
                        <input type="text" class="ldb-input" id="ldb-notion-github-username" placeholder="your-username">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">GitHub Token (可选，提高速率限制)</label>
                        <input type="password" class="ldb-input" id="ldb-notion-github-token" placeholder="ghp_xxx...">
                        <div class="ldb-tip">不填写也可使用，但有 60 次/小时限制</div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">导入类型</label>
                        <div class="ldb-checkbox-group" style="margin-top: 4px;">
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="stars" checked> ⭐ Stars
                            </label>
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="repos"> 📦 Repos
                            </label>
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="forks"> 🍴 Forks
                            </label>
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="gists"> 📝 Gists
                            </label>
                        </div>
                    </div>
                    <div class="ldb-section-divider">
                        <span class="ldb-hint">📖 浏览器书签导入</span>
                        <div id="ldb-notion-bookmark-status" style="font-size: 11px; margin-top: 4px;"></div>
                    </div>
                    <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-save-settings">💾 保存设置</button>
                </div>

                <!-- 状态显示 -->
                <div id="ldb-notion-status-container"></div>
            </div>
        `;

        document.body.appendChild(panel);
        NotionSiteUI.panel = panel;
        NotionSiteUI._abortController = new AbortController();

        // 阻止面板内的键盘和剪贴板事件冒泡到 Notion
        const stopPropagation = (e) => e.stopPropagation();
        panel.addEventListener("copy", stopPropagation);
        panel.addEventListener("paste", stopPropagation);
        panel.addEventListener("cut", stopPropagation);
        panel.addEventListener("keydown", stopPropagation);
        panel.addEventListener("keyup", stopPropagation);
        panel.addEventListener("keypress", stopPropagation);

        return panel;
    },

    ensurePanelReady: () => {
        if (NotionSiteUI.isPanelReady && NotionSiteUI.panel) return;
        NotionSiteUI.createPanel();
        NotionSiteUI.bindEvents();
        NotionSiteUI.loadConfig();

        // 面板可拉伸（左边+上边+左上角）
        PanelResize.makeResizable(NotionSiteUI.panel, {
            edges: ["l", "t", "tl"],
            storageKey: CONFIG.STORAGE_KEYS.PANEL_SIZE_NOTION,
            minWidth: 300,
            minHeight: 250,
        });

        // 初始化对话 UI
        ChatState.load();
        ChatUI.renderMessages();
        ChatUI.bindEvents();
        NotionSiteUI.isPanelReady = true;
    },

    // 切换面板显示
    togglePanel: () => {
        NotionSiteUI.ensurePanelReady();
        if (!NotionSiteUI.panel) return;

        NotionSiteUI.isMinimized = !NotionSiteUI.isMinimized;

        if (NotionSiteUI.isMinimized) {
            NotionSiteUI.panel.classList.remove("visible");
        } else {
            NotionSiteUI.panel.classList.add("visible");
        }

        Storage.set(CONFIG.STORAGE_KEYS.NOTION_PANEL_MINIMIZED, NotionSiteUI.isMinimized);
    },

    // 绑定事件
    bindEvents: () => {
        const panel = NotionSiteUI.panel;

        // 快捷命令 chips
        panel.querySelectorAll(".ldb-chat-chip").forEach(chip => {
            chip.onclick = () => {
                const cmd = chip.getAttribute("data-cmd");
                const input = panel.querySelector("#ldb-chat-input");
                if (input && cmd) {
                    input.value = cmd;
                    ChatUI.sendMessage();
                }
            };
        });

        // 关闭按钮
        panel.querySelector("#ldb-notion-close").onclick = () => {
            NotionSiteUI.togglePanel();
        };

        // 主题切换
        panel.querySelector("#ldb-notion-theme-toggle").onclick = () => {
            DesignSystem.toggleTheme();
        };

        // 设置折叠
        panel.querySelector("#ldb-notion-settings-toggle").onclick = () => {
            const content = panel.querySelector("#ldb-notion-settings-content");
            const arrow = panel.querySelector("#ldb-notion-settings-arrow");
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        // 保存设置
        panel.querySelector("#ldb-notion-save-settings").onclick = async () => {
            try {
                await UICommandService.execute("save_command_boundary_settings", {
                    scope: "notion-site",
                    liveApiKey: panel.querySelector("#ldb-notion-api-key").value.trim(),
                    clearManualApiKey: true,
                    aiTargetValue: panel.querySelector("#ldb-notion-ai-target-db").value,
                    aiService: panel.querySelector("#ldb-notion-ai-service").value,
                    aiModel: panel.querySelector("#ldb-notion-ai-model").value,
                    aiApiKey: panel.querySelector("#ldb-notion-ai-api-key").value.trim(),
                    aiBaseUrl: panel.querySelector("#ldb-notion-ai-base-url").value.trim(),
                    aiCategories: panel.querySelector("#ldb-notion-ai-categories").value.trim(),
                    workspaceMaxPages: parseInt(panel.querySelector("#ldb-notion-workspace-max-pages").value) || 0,
                    personaName: panel.querySelector("#ldb-notion-persona-name").value.trim() || CONFIG.DEFAULTS.agentPersonaName,
                    personaTone: panel.querySelector("#ldb-notion-persona-tone").value,
                    personaExpertise: panel.querySelector("#ldb-notion-persona-expertise").value.trim() || CONFIG.DEFAULTS.agentPersonaExpertise,
                    personaInstructions: panel.querySelector("#ldb-notion-persona-instructions").value.trim(),
                    githubUsername: panel.querySelector("#ldb-notion-github-username").value.trim(),
                    githubToken: panel.querySelector("#ldb-notion-github-token").value.trim(),
                    githubImportTypes: [...panel.querySelectorAll(".ldb-notion-github-type:checked")].map(cb => cb.value),
                });
                NotionOAuth.syncApiKeyInputs();
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-ai-api-key"), CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-github-token"), CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
                NotionSiteUI.showStatus("设置已保存", "success");
            } catch (error) {
                NotionSiteUI.showStatus(`设置保存失败: ${error.message}`, "error");
            }
        };

        // 刷新数据库列表（合并后的唯一刷新按钮）
        panel.querySelector("#ldb-notion-refresh-workspace").onclick = async () => {
            const liveApiKey = panel.querySelector("#ldb-notion-api-key").value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const refreshBtn = panel.querySelector("#ldb-notion-refresh-workspace");
            const workspaceTip = panel.querySelector("#ldb-notion-workspace-tip");

            if (!apiKey) {
                NotionSiteUI.showStatus(MSG.NO_NOTION_KEY, "error");
                return;
            }

            refreshBtn.disabled = true;
            refreshBtn.innerHTML = "⏳";
            workspaceTip.style.color = "";
            workspaceTip.textContent = "正在获取数据库列表...";

            try {
                const { workspaceData } = await UICommandService.execute("refresh_workspace_targets", {
                    apiKey,
                    includePages: true,
                    onProgress: (progress) => {
                        if (progress.phase === "databases") {
                            workspaceTip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                        } else if (progress.phase === "pages") {
                            workspaceTip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                        }
                    },
                    onWorkspaceData: (workspaceData, meta) => {
                        NotionSiteUI.updateAITargetDbOptions(workspaceData.databases, workspaceData.pages);

                        if (meta.phase === "databases") {
                            workspaceTip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                            workspaceTip.style.color = "#34d399";
                        }
                    },
                });

                NotionSiteUI.updateAITargetDbOptions(workspaceData.databases, workspaceData.pages);
                workspaceTip.textContent = `✅ 获取到 ${workspaceData.databases.length} 个数据库，${workspaceData.pages.length} 个页面`;
                workspaceTip.style.color = "#34d399";
            } catch (error) {
                workspaceTip.textContent = `❌ ${error.message}`;
                workspaceTip.style.color = "#f87171";
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = "🔄";
            }
        };

        // 数据库/页面下拉框选择变更
        panel.querySelector("#ldb-notion-ai-target-db").onchange = (e) => {
            void UICommandService.execute("select_ai_target", { targetValue: e.target.value });
        };

        // AI 服务切换 - 更新模型列表并保存（优先使用缓存）
        panel.querySelector("#ldb-notion-ai-service").onchange = (e) => {
            const newService = e.target.value;
            Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, newService);
                const availableModels = AIService.getAvailableModels(newService);
                NotionSiteUI.updateAIModelOptions(newService, availableModels.length > 0 ? availableModels : undefined);
            // 重置模型为新服务的默认模型
            const provider = AIService.PROVIDERS[newService];
            if (provider?.defaultModel) {
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, provider.defaultModel);
            }
        };

        // AI 模型切换 - 保存选择
        panel.querySelector("#ldb-notion-ai-model").onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, e.target.value);
        };

        // 获取模型列表
        panel.querySelector("#ldb-notion-ai-fetch-models").onclick = async () => {
            const aiApiKey = panel.querySelector("#ldb-notion-ai-api-key").value.trim()
                || String(Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "") || "").trim();
            const aiService = panel.querySelector("#ldb-notion-ai-service").value;
            const aiBaseUrl = panel.querySelector("#ldb-notion-ai-base-url").value.trim();
            const fetchBtn = panel.querySelector("#ldb-notion-ai-fetch-models");
            const modelTip = panel.querySelector("#ldb-notion-ai-model-tip");

            if (!aiApiKey) {
                NotionSiteUI.showStatus(MSG.NO_AI_KEY, "error");
                return;
            }

            fetchBtn.disabled = true;
            fetchBtn.innerHTML = "⏳ 获取中...";
            modelTip.textContent = "";

            try {
                const { models } = await UICommandService.execute("fetch_ai_models", {
                    aiService,
                    aiApiKey,
                    aiBaseUrl,
                });
                NotionSiteUI.updateAIModelOptions(aiService, models, true);
                modelTip.textContent = `✅ 获取到 ${models.length} 个可用模型`;
                modelTip.style.color = "#34d399";
            } catch (error) {
                modelTip.textContent = `❌ ${error.message}`;
                modelTip.style.color = "#f87171";
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = "🔄 获取";
            }
        };

        // 拖拽面板
        NotionSiteUI.makeDraggable(panel, panel.querySelector(".ldb-notion-header"));

        NotionOAuth.attachControls({
            root: panel,
            selectors: {
                clientIdInput: "#ldb-notion-oauth-client-id",
                clientSecretInput: "#ldb-notion-oauth-client-secret",
                redirectUriInput: "#ldb-notion-oauth-redirect-uri",
                authorizeBtn: "#ldb-notion-oauth-authorize",
                clearBtn: "#ldb-notion-oauth-clear",
                statusEl: "#ldb-notion-oauth-status",
            },
            notify: (message, type) => NotionSiteUI.showStatus(message, type),
        });
        CredentialVault.attachControls({
            root: panel,
            selectors: {
                statusEl: "#ldb-notion-vault-status",
                unlockBtn: "#ldb-notion-vault-unlock",
                lockBtn: "#ldb-notion-vault-lock",
            },
            notify: (message, type) => NotionSiteUI.showStatus(message, type),
            onAfterSync: () => {
                NotionOAuth.syncApiKeyInputs();
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-ai-api-key"), CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-github-token"), CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
            },
        });
    },

    // 加载配置
    loadConfig: () => {
        const panel = NotionSiteUI.panel;

        panel.querySelector("#ldb-notion-api-key").value = "";
        panel.querySelector("#ldb-notion-ai-service").value = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
        panel.querySelector("#ldb-notion-ai-api-key").value = "";
        panel.querySelector("#ldb-notion-ai-base-url").value = Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, "");
        panel.querySelector("#ldb-notion-ai-categories").value = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories);
        panel.querySelector("#ldb-notion-workspace-max-pages").value = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages);

        // 加载 Agent 个性化设置
        panel.querySelector("#ldb-notion-persona-name").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        panel.querySelector("#ldb-notion-persona-tone").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone);
        panel.querySelector("#ldb-notion-persona-expertise").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise);
        panel.querySelector("#ldb-notion-persona-instructions").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions);

        // 加载 GitHub 设置
        panel.querySelector("#ldb-notion-github-username").value = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
        panel.querySelector("#ldb-notion-github-token").value = "";
        // 加载 GitHub 导入类型
        const savedGHTypes = GitHubAPI.getImportTypes();
        panel.querySelectorAll(".ldb-notion-github-type").forEach(cb => {
            cb.checked = savedGHTypes.includes(cb.value);
        });

        // 书签扩展状态
        const bmStatus = panel.querySelector("#ldb-notion-bookmark-status");
        if (bmStatus) {
            if (BookmarkBridge.isExtensionAvailable()) {
                bmStatus.innerHTML = '<span style="color: #4ade80;">✅ 扩展已安装</span> — 在 AI 对话中输入「导入书签」即可';
            } else {
                bmStatus.innerHTML = `<span style="color: #f87171;">❌ 扩展未安装</span> — ${InstallHelper.renderInstallLink("一键安装浏览器扩展")}`;
            }
        }

        // 加载数据库/页面下拉框（始终调用以确保兼容选项被添加）
        const cachedWsForDb = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
        let cachedDatabases = [];
        let cachedPages = [];
        try {
            const wsData = JSON.parse(cachedWsForDb);
            cachedDatabases = wsData.databases || [];
            cachedPages = wsData.pages || [];
        } catch { cachedDatabases = []; cachedPages = []; }
        NotionSiteUI.updateAITargetDbOptions(cachedDatabases, cachedPages);

        // 加载 AI 模型选项（优先使用缓存的模型列表）
        const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
        const notionSiteModels = AIService.getAvailableModels(aiService);
        NotionSiteUI.updateAIModelOptions(aiService, notionSiteModels.length > 0 ? notionSiteModels : undefined);

        // 设置保存的模型
        const savedModel = Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
        if (savedModel) {
            const modelSelect = panel.querySelector("#ldb-notion-ai-model");
            const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
            if (optionExists) {
                modelSelect.value = savedModel;
            }
        }

        // 恢复面板位置
        const savedPosition = Storage.get(CONFIG.STORAGE_KEYS.NOTION_PANEL_POSITION, null);
        if (savedPosition) {
            try {
                const pos = JSON.parse(savedPosition);
                panel.style.right = pos.right || "24px";
                panel.style.bottom = pos.bottom || "96px";
            } catch (e) {
                console.warn("[LD-Notion] corrupted panel position, resetting");
                Storage.remove(CONFIG.STORAGE_KEYS.NOTION_PANEL_POSITION);
            }
        }

        NotionOAuth.syncApiKeyInputs();
        CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-ai-api-key"), CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
        CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-github-token"), CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");

    },

    getAITargetDefaultOptionLabel: (databases = []) => {
        const effectiveState = TargetState.getEffectiveAITargetState();
        if (effectiveState.mode !== "database" || !effectiveState.databaseId) {
            return "默认（未设置导出数据库）";
        }

        const fallbackDb = databases.find(db => db.id === effectiveState.databaseId);
        const fallbackName = fallbackDb?.title || `ID: ${effectiveState.databaseId.slice(0, 8)}...`;
        return `默认（跟随导出数据库：${fallbackName}）`;
    },

    getAITargetPageParentType: (page) => {
        if (typeof page?.parent === "string") return page.parent;
        return String(page?.parent?.type || "").trim();
    },

    getAITargetPageParentLabel: (page, { databases = [], pages: allPages = [] } = {}) => {
        const parentType = NotionSiteUI.getAITargetPageParentType(page);
        const parentId = page?.parentId;
        let parentName = "";
        if (parentId) {
            const parentDb = databases.find(db => db.id === parentId);
            if (parentDb) parentName = parentDb.title;
            else {
                const parentPage = allPages.find(p => p.id === parentId);
                if (parentPage) parentName = parentPage.title;
            }
        }
        if (parentType === "database_id") {
            return parentName ? "数据库「" + parentName + "」内" : "数据库条目";
        }
        if (parentType === "page_id") {
            return parentName ? "页面「" + parentName + "」下" : "子页面";
        }
        if (parentType === "block_id") return "块内页面";
        if (parentType === "workspace") return "工作区页面";
        return parentType ? "非顶级页面" : "";
    },

    getAITargetPageOptionLabel: (page, { includeParentLabel = false, databases = [], pages: allPages = [] } = {}) => {
        const title = String(page?.title || "").trim() || "未命名页面";
        const parentType = NotionSiteUI.getAITargetPageParentType(page);
        const parentLabel = NotionSiteUI.getAITargetPageParentLabel(page, { databases, pages: allPages });
        const prefix = parentType === "workspace" ? "📄" : "↳";

        if (!includeParentLabel || !parentLabel || parentType === "workspace") {
            return prefix + " " + title;
        }
        return prefix + " " + title + "（" + parentLabel + "）";
    },

    getAITargetCompatibilityOptionLabel: (savedValue, { storedTarget, databases = [], pages = [] } = {}) => {
        if (!savedValue) return "";

        const effectiveState = TargetState.getEffectiveAITargetState();
        if (
            !storedTarget?.exists
            && effectiveState.mode === "database"
            && effectiveState.databaseId === savedValue
        ) {
            return NotionSiteUI.getAITargetDefaultOptionLabel(databases);
        }

        const parsedTarget = TargetState.parseAITarget(savedValue);
        if (parsedTarget.mode === "page" && parsedTarget.pageId) {
            const matchedPage = pages.find(page => page.id === parsedTarget.pageId);
            if (matchedPage) {
                return `${NotionSiteUI.getAITargetPageOptionLabel(matchedPage, {
                    includeParentLabel: NotionSiteUI.getAITargetPageParentType(matchedPage) !== "workspace",
                    databases, pages,
                })}（已保存）`;
            }
            return `已保存页面（当前列表之外，ID: ${parsedTarget.pageId.slice(0, 8)}...）`;
        }

        if (parsedTarget.mode === "database" && parsedTarget.databaseId) {
            const matchedDb = databases.find(db => db.id === parsedTarget.databaseId);
            if (matchedDb) {
                return `📁 ${matchedDb.title}（已保存）`;
            }
            return `已保存数据库（当前列表之外，ID: ${parsedTarget.databaseId.slice(0, 8)}...）`;
        }

        const displayId = savedValue.replace(/^page:/, "");
        return `已保存目标（ID: ${displayId.slice(0, 8)}...）`;
    },

    // 更新数据库/页面下拉框
    updateAITargetDbOptions: (databases, pages = []) => {
        const select = NotionSiteUI.panel.querySelector("#ldb-notion-ai-target-db");
        if (!select) return;

        const storedTarget = TargetState.getStoredAITarget();
        const savedValue = storedTarget.exists ? storedTarget.state.value : "";

        let options = `<option value="">${Utils.escapeHtml(NotionSiteUI.getAITargetDefaultOptionLabel(databases))}</option>`;
        options += '<option value="__all__">所有工作区数据库</option>';

        const knownIds = new Set();
        if (databases.length > 0) {
            options += '<optgroup label="📁 数据库">';
            databases.forEach(db => {
                knownIds.add(db.id);
                options += `<option value="${db.id}">📁 ${Utils.escapeHtml(db.title)}</option>`;
            });
            options += '</optgroup>';
        }

        // 只显示工作区顶级页面（value 带 page: 前缀以区分类型）
        const workspacePages = pages.filter(p => p.parent === "workspace");
        if (workspacePages.length > 0) {
            options += '<optgroup label="📄 页面">';
            workspacePages.forEach(page => {
                const val = `page:${page.id}`;
                knownIds.add(val);
                options += `<option value="${val}">${Utils.escapeHtml(
                    NotionSiteUI.getAITargetPageOptionLabel(page)
                )}</option>`;
            });
            options += '</optgroup>';
        }

        const nestedPages = pages.filter(page => NotionSiteUI.getAITargetPageParentType(page) !== "workspace");
        if (nestedPages.length > 0) {
            options += '<optgroup label="📄 嵌套页面（数据库内/子页面）">';
            nestedPages.forEach(page => {
                const val = `page:${page.id}`;
                knownIds.add(val);
                options += `<option value="${val}">${Utils.escapeHtml(
                    NotionSiteUI.getAITargetPageOptionLabel(page, { includeParentLabel: true, databases, pages })
                )}</option>`;
            });
            options += '</optgroup>';
        }

        // 如果已保存的值不在列表中，添加一个兼容选项
        if (savedValue && savedValue !== "__all__" && !knownIds.has(savedValue)) {
            options += `<option value="${savedValue}">${Utils.escapeHtml(
                NotionSiteUI.getAITargetCompatibilityOptionLabel(savedValue, {
                    storedTarget,
                    databases,
                    pages,
                })
            )}</option>`;
        }

        select.innerHTML = options;

        if (savedValue) {
            select.value = savedValue;
        }
    },

    // 更新 AI 模型选项
    updateAIModelOptions: (service, customModels = null, preserveSelection = false) => {
        const modelSelect = NotionSiteUI.panel.querySelector("#ldb-notion-ai-model");
        const provider = AIService.PROVIDERS[service];

        if (!provider || !modelSelect) return;

        const models = customModels || provider.models;
        const defaultModel = provider.defaultModel;

        // 保留当前选择的模型（如果需要且存在于新列表中）
        const currentValue = modelSelect.value;
        const shouldPreserve = preserveSelection && currentValue && models.includes(currentValue);

        modelSelect.innerHTML = models.map(model => {
            const isSelected = shouldPreserve
                ? model === currentValue
                : model === defaultModel;
            return `<option value="${model}" ${isSelected ? 'selected' : ''}>${model}</option>`;
        }).join("");
    },

    // 显示状态
    showStatus: (message, type = "info") => {
        const container = NotionSiteUI.panel.querySelector("#ldb-notion-status-container");
        container.innerHTML = `
            <div class="ldb-status ${type}">
                ${message}
                <button class="ldb-status-close" title="关闭">×</button>
            </div>
        `;

        // 添加关闭按钮事件
        const closeBtn = container.querySelector(".ldb-status-close");
        if (closeBtn) {
            closeBtn.onclick = () => { container.innerHTML = ""; };
        }

        // 错误消息延长显示时间（10秒），其他类型3秒
        const timeout = type === "error" ? 10000 : 3000;
        setTimeout(() => {
            container.innerHTML = "";
        }, timeout);
    },

    // 拖拽功能
    makeDraggable: (element, handle) => {
        let offsetX, offsetY, isDragging = false;

        handle.onmousedown = (e) => {
            if (e.target.tagName === "BUTTON") return;
            isDragging = true;
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
            document.body.style.userSelect = "none";
        };

        document.onmousemove = (e) => {
            if (!isDragging) return;
            const x = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, e.clientX - offsetX));
            const y = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, e.clientY - offsetY));
            element.style.left = x + "px";
            element.style.top = y + "px";
            element.style.right = "auto";
            element.style.bottom = "auto";
        };

        document.onmouseup = () => {
            if (isDragging) {
                // 保存位置（使用 right 和 bottom）
                const rect = element.getBoundingClientRect();
                const right = window.innerWidth - rect.right;
                const bottom = window.innerHeight - rect.bottom;
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_PANEL_POSITION, JSON.stringify({ right: right + "px", bottom: bottom + "px" }));
            }
            isDragging = false;
            document.body.style.userSelect = "";
        };
    },

    createAIAssistantSettingsAdapter: () => ({
        isActive: () => !!NotionSiteUI.panel,
        getSettings: ({ getDefaultSettings }) => {
            const notionPanel = NotionSiteUI.panel;
            if (!notionPanel) {
                return getDefaultSettings();
            }

            const aiService = notionPanel.querySelector("#ldb-notion-ai-service")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
            const selectedModel = notionPanel.querySelector("#ldb-notion-ai-model")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
            const provider = AIService.PROVIDERS[aiService];
            const aiModel = selectedModel || provider?.defaultModel || "";

            return {
                notionApiKey: NotionOAuth.getAccessToken(notionPanel.querySelector("#ldb-notion-api-key")?.value.trim()),
                notionDatabaseId: TargetState.getEffectiveAIDatabaseId({
                    fallbackDatabaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                    targetValue: notionPanel.querySelector("#ldb-notion-ai-target-db")?.value || "",
                }),
                aiApiKey: notionPanel.querySelector("#ldb-notion-ai-api-key")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: aiService,
                aiModel: aiModel,
                aiBaseUrl: notionPanel.querySelector("#ldb-notion-ai-base-url")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
                categories: Utils.parseAICategories(
                    notionPanel.querySelector("#ldb-notion-ai-categories")?.value.trim()
                        || Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories)
                ),
            };
        }
    }),

    // 初始化 AI 助手模块（复用 AIAssistant）
    initAIAssistant: () => {
        AIAssistant.registerSettingsAdapter("notion-site", NotionSiteUI.createAIAssistantSettingsAdapter());
    },

    // 初始化
    init: () => {
        NotionSiteUI.injectStyles();
        NotionSiteUI.createFloatButton();
        NotionSiteUI.initAIAssistant();

        // 检查是否需要展开
        if (!Storage.get(CONFIG.STORAGE_KEYS.NOTION_PANEL_MINIMIZED, true)) {
            Utils.runWhenBrowserIdle(() => {
                NotionSiteUI.ensurePanelReady();
                NotionSiteUI.isMinimized = false;
                NotionSiteUI.panel.classList.add("visible");
            });
        }
    },

    destroy: () => {
        if (NotionSiteUI._floatDragMove) document.removeEventListener("mousemove", NotionSiteUI._floatDragMove);
        if (NotionSiteUI._floatDragEnd) document.removeEventListener("mouseup", NotionSiteUI._floatDragEnd);
        NotionSiteUI._abortController?.abort();
        NotionSiteUI._abortController = null;
        NotionSiteUI.panel?.remove();
        NotionSiteUI.panel = null;
        NotionSiteUI.floatBtn?.remove();
        NotionSiteUI.floatBtn = null;
        NotionSiteUI.isPanelReady = false;
    },
};


const UI_CSS = `
            .ldb-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 380px;
                max-height: 90vh;
                z-index: 2147483640;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .ldb-panel.minimized {
                width: auto;
                max-height: none;
                overflow: visible;
            }

            .ldb-header {
                cursor: move;
                border-top-left-radius: var(--ldb-ui-radius);
                border-top-right-radius: var(--ldb-ui-radius);
            }

            .ldb-header-btns {
                display: flex;
                gap: 8px;
            }

            .ldb-runtime-badge {
                margin-left: 8px;
                padding: 2px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 700;
                line-height: 1.8;
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                color: var(--ldb-ui-muted);
                vertical-align: middle;
            }

            .ldb-runtime-badge.mode-userscript {
                color: #0f766e;
                border-color: rgba(13, 148, 136, 0.35);
                background: rgba(20, 184, 166, 0.14);
            }

            .ldb-runtime-badge.mode-extension {
                color: #1d4ed8;
                border-color: rgba(37, 99, 235, 0.35);
                background: rgba(59, 130, 246, 0.14);
            }

            .ldb-body {
                overflow-y: auto;
                padding: 14px;
            }

            .ldb-body::-webkit-scrollbar {
                width: 8px;
            }

            .ldb-body::-webkit-scrollbar-track {
                background: transparent;
            }

            .ldb-body::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.25);
                border-radius: 999px;
            }

            .ldb-mini-btn {
                position: fixed;
                right: 20px;
                bottom: 80px;
                width: 52px;
                height: 52px;
                border-radius: 999px;
                border: 1px solid rgba(37, 99, 235, 0.35);
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: #fff;
                font-size: 22px;
                cursor: pointer;
                box-shadow: var(--ldb-ui-shadow-sm);
                z-index: 2147483641;
                display: none;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: transform 0.18s ease, box-shadow 0.18s ease;
            }

            .ldb-mini-btn:hover {
                transform: translateY(-1px) scale(1.03);
                box-shadow: var(--ldb-ui-shadow);
            }

            .ldb-section {
                padding: 10px 0;
            }

            .ldb-btn-group {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
            }

            .ldb-btn-primary {
                /* alias for .ldb-btn */
            }

            .ldb-btn-small {
                padding: 6px 10px;
                border-radius: 10px;
                font-size: 12px;
            }

            .ldb-link {
                color: var(--ldb-ui-accent);
            }

            .ldb-checkbox-group {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                align-items: center;
            }

            .ldb-checkbox-item {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: var(--ldb-ui-text);
                user-select: none;
            }

            .ldb-checkbox-item input[type="checkbox"],
            .ldb-checkbox-item input[type="radio"] {
                accent-color: var(--ldb-ui-accent);
            }

            .ldb-toggle-section {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-source-option-group {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-bottom: 8px;
            }

            .ldb-source-option {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                color: var(--ldb-ui-text);
                font-size: 12px;
                font-weight: 600;
                border-radius: 10px;
                padding: 8px 10px;
                cursor: pointer;
                transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
                text-align: center;
                font-family: inherit;
            }

            .ldb-source-option:hover {
                border-color: rgba(37, 99, 235, 0.45);
                background: rgba(37, 99, 235, 0.14);
            }

            .ldb-source-option.active {
                border-color: var(--ldb-ui-accent);
                background: rgba(37, 99, 235, 0.18);
                color: var(--ldb-ui-accent);
            }

            .ldb-toggle-switch {
                position: relative;
                display: inline-block;
                width: 44px;
                height: 24px;
            }

            .ldb-toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .ldb-toggle-slider {
                position: absolute;
                cursor: pointer;
                inset: 0;
                background: rgba(148, 163, 184, 0.28);
                border: 1px solid var(--ldb-ui-border);
                transition: background 0.2s ease, border-color 0.2s ease;
                border-radius: 999px;
            }

            .ldb-toggle-slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                top: 50%;
                transform: translateY(-50%);
                background: #fff;
                transition: transform 0.2s ease;
                border-radius: 50%;
                box-shadow: 0 6px 16px rgba(2, 6, 23, 0.18);
            }

            .ldb-toggle-switch input:checked + .ldb-toggle-slider {
                background: rgba(37, 99, 235, 0.45);
                border-color: rgba(37, 99, 235, 0.35);
            }

            .ldb-toggle-switch input:checked + .ldb-toggle-slider:before {
                transform: translateY(-50%) translateX(20px);
            }

            .ldb-toggle-content.collapsed {
                display: none;
            }

            .ldb-progress {
                padding: 10px 12px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-progress-bar {
                height: 10px;
                background: rgba(148, 163, 184, 0.20);
                border-radius: 999px;
                overflow: hidden;
            }

            .ldb-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--ldb-ui-accent), var(--ldb-ui-accent-2));
                border-radius: 999px;
            }

            .ldb-progress-text {
                margin-top: 8px;
                font-size: 12px;
                color: var(--ldb-ui-muted);
                display: flex;
                justify-content: space-between;
                gap: 10px;
            }

            .ldb-bookmarks-info {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 12px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-bookmarks-count {
                font-size: 20px;
                font-weight: 800;
                letter-spacing: 0.2px;
                color: var(--ldb-ui-text);
            }

            .ldb-bookmarks-label {
                font-size: 12px;
                color: var(--ldb-ui-muted);
                text-align: right;
            }

            .ldb-view-header {
                margin-bottom: 10px;
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
            }

            .ldb-view-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                flex-wrap: wrap;
            }

            .ldb-view-action-btn {
                padding: 6px 10px;
                font-size: 12px;
                white-space: nowrap;
            }

            .ldb-view-status {
                margin-bottom: 10px;
                font-size: 12px;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-status[data-tone="success"] {
                color: var(--ldb-ui-success);
            }

            .ldb-view-status[data-tone="error"] {
                color: var(--ldb-ui-danger);
            }

            .ldb-view-summary {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .ldb-view-subsection {
                margin-top: 14px;
                padding-top: 14px;
                border-top: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-view-section-title {
                margin-bottom: 8px;
                font-size: 12px;
                font-weight: 700;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
            }

            .ldb-view-card {
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                padding: 12px;
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-view-card.full {
                grid-column: 1 / -1;
            }

            .ldb-view-card-title {
                font-size: 12px;
                font-weight: 700;
                color: var(--ldb-ui-muted);
                margin-bottom: 8px;
            }

            .ldb-view-metric-value {
                font-size: 22px;
                font-weight: 800;
                color: var(--ldb-ui-text);
                line-height: 1.1;
            }

            .ldb-view-metric-meta {
                margin-top: 6px;
                font-size: 12px;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-bars,
            .ldb-view-timeline {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .ldb-view-bar-row {
                display: grid;
                grid-template-columns: minmax(0, 88px) 1fr auto;
                gap: 8px;
                align-items: center;
            }

            .ldb-view-bar-label,
            .ldb-view-timeline-label {
                font-size: 12px;
                color: var(--ldb-ui-text);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .ldb-view-bar-track {
                height: 8px;
                border-radius: 999px;
                overflow: hidden;
                background: rgba(148, 163, 184, 0.20);
            }

            .ldb-view-bar-fill {
                height: 100%;
                border-radius: 999px;
                background: linear-gradient(90deg, var(--ldb-ui-accent), var(--ldb-ui-accent-2));
            }

            .ldb-view-bar-value,
            .ldb-view-timeline-value {
                font-size: 12px;
                color: var(--ldb-ui-muted);
                white-space: nowrap;
            }

            .ldb-view-timeline-item {
                display: grid;
                grid-template-columns: minmax(0, 72px) 1fr auto;
                gap: 8px;
                align-items: center;
            }

            .ldb-view-link-graph,
            .ldb-view-funnel {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .ldb-view-link-row,
            .ldb-view-funnel-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 8px;
                align-items: center;
            }

            .ldb-view-link-path,
            .ldb-view-funnel-label {
                font-size: 12px;
                color: var(--ldb-ui-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .ldb-view-link-count,
            .ldb-view-funnel-value {
                font-size: 12px;
                color: var(--ldb-ui-muted);
                white-space: nowrap;
            }

            .ldb-view-empty {
                border: 1px dashed rgba(148, 163, 184, 0.35);
                border-radius: 12px;
                padding: 18px 14px;
                background: rgba(148, 163, 184, 0.05);
            }

            .ldb-view-empty-title {
                font-size: 13px;
                font-weight: 700;
                color: var(--ldb-ui-text);
                margin-bottom: 6px;
            }

            .ldb-view-empty-text {
                font-size: 12px;
                line-height: 1.5;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-highlight {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }

            .ldb-view-pill {
                padding: 4px 8px;
                border-radius: 999px;
                border: 1px solid rgba(148, 163, 184, 0.25);
                background: rgba(148, 163, 184, 0.08);
                font-size: 11px;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-report-preview {
                white-space: pre-wrap;
                word-break: break-word;
                font-size: 12px;
                line-height: 1.6;
                color: var(--ldb-ui-text);
                border-radius: 10px;
                border: 1px dashed rgba(148, 163, 184, 0.25);
                background: rgba(15, 23, 42, 0.04);
                padding: 12px;
                max-height: 280px;
                overflow: auto;
            }

            .ldb-bookmark-list {
                margin-top: 10px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                overflow: hidden;
                background: rgba(148, 163, 184, 0.06);
                max-height: 260px;
                overflow-y: auto;
            }

            .ldb-bookmark-item {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
                cursor: pointer;
            }

            .ldb-bookmark-item:hover {
                background: rgba(37, 99, 235, 0.08);
            }

            .ldb-bookmark-item:last-child {
                border-bottom: none;
            }

            .ldb-bookmark-item input[type="checkbox"] {
                margin-top: 2px;
            }

            .ldb-bookmark-item .title {
                font-size: 13px;
                font-weight: 650;
                line-height: 1.45;
                color: var(--ldb-ui-text);
            }

            .ldb-bookmark-item .status {
                font-size: 11px;
                margin-top: 4px;
                color: var(--ldb-ui-muted);
            }

            .ldb-bookmark-item .status.exported {
                color: var(--ldb-ui-success);
            }

            .ldb-bookmark-item .status.pending {
                color: var(--ldb-ui-warning);
            }

            .ldb-permission-panel {
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
                overflow: hidden;
            }

            .ldb-permission-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-permission-row:last-child {
                border-bottom: none;
            }

            .ldb-permission-label {
                font-size: 12px;
                color: var(--ldb-ui-muted);
            }

            .ldb-permission-select {
                min-width: 160px;
            }

            .ldb-log-panel {
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                overflow: hidden;
                background: rgba(148, 163, 184, 0.06);
            }

            .ldb-log-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
                cursor: pointer;
                user-select: none;
                background: rgba(148, 163, 184, 0.10);
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-log-title {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: var(--ldb-ui-text);
                font-weight: 700;
            }

            .ldb-log-badge {
                padding: 1px 8px;
                border-radius: 999px;
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                font-size: 11px;
                color: var(--ldb-ui-muted);
            }

            .ldb-log-content {
                padding: 10px 12px;
            }

            .ldb-log-content.collapsed {
                display: none;
            }

            .ldb-log-item {
                display: grid;
                grid-template-columns: 18px 1fr;
                gap: 10px;
                padding: 8px 0;
                border-bottom: 1px solid rgba(148, 163, 184, 0.14);
            }

            .ldb-log-item:last-child {
                border-bottom: none;
            }

            .ldb-log-item .icon {
                font-size: 14px;
                line-height: 1.2;
                opacity: 0.9;
            }

            .ldb-log-item .content {
                font-size: 12px;
                color: var(--ldb-ui-text);
                line-height: 1.5;
            }

            .ldb-log-item .operation {
                font-weight: 650;
            }

            .ldb-log-item .time,
            .ldb-log-item .duration {
                margin-top: 2px;
                font-size: 11px;
                color: var(--ldb-ui-muted);
            }

            .ldb-log-item .error {
                margin-top: 4px;
                color: var(--ldb-ui-danger);
                font-size: 11px;
            }

            .ldb-log-empty {
                padding: 10px 0;
                color: var(--ldb-ui-muted);
                font-size: 12px;
                text-align: center;
            }

            .ldb-log-actions {
                margin-top: 10px;
                display: flex;
                justify-content: flex-end;
            }

            .ldb-log-clear-btn {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                color: var(--ldb-ui-text);
                border-radius: 10px;
                padding: 6px 10px;
                cursor: pointer;
                font-size: 12px;
            }

            .ldb-log-clear-btn:hover {
                background: rgba(148, 163, 184, 0.16);
            }

            .ldb-control-btns {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            }

            /* Tab 导航 */
            .ldb-tabs {
                display: flex;
                border-bottom: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.06);
                padding: 0 4px;
            }

            .ldb-tab {
                flex: 1;
                padding: 10px 6px;
                border: none;
                background: transparent;
                color: var(--ldb-ui-muted);
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                text-align: center;
                border-bottom: 2px solid transparent;
                transition: color 0.2s ease, border-color 0.2s ease;
                user-select: none;
                font-family: inherit;
                white-space: nowrap;
            }

            .ldb-tab:hover {
                color: var(--ldb-ui-text);
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-tab.active {
                color: var(--ldb-ui-accent);
                border-bottom-color: var(--ldb-ui-accent);
            }

            .ldb-tab-content {
                display: none;
            }

            .ldb-tab-content.active {
                display: block;
            }

            /* 主题切换按钮 */
            .ldb-theme-btn {
                width: 30px;
                height: 30px;
                border-radius: 10px;
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                cursor: pointer;
                user-select: none;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                line-height: 1;
                font-size: 14px;
                transition: background 0.2s ease;
            }

            .ldb-theme-btn:hover {
                background: rgba(148, 163, 184, 0.22);
            }

            /* 响应式 */
            @media (max-width: 480px) {
                .ldb-panel {
                    right: 0 !important;
                    left: 0 !important;
                    top: auto !important;
                    bottom: 0 !important;
                    width: 100% !important;
                    max-height: 70vh;
                    border-radius: var(--ldb-ui-radius) var(--ldb-ui-radius) 0 0;
                }
                .ldb-mini-btn {
                    right: 12px;
                    bottom: 12px;
                }
                .ldb-view-grid {
                    grid-template-columns: 1fr;
                }
                .ldb-view-card.full {
                    grid-column: auto;
                }
            }
`;


const UIEvents = {
    bindEvents: () => {
        const panel = UI.panel;
        const refs = UI.refs || {};
        const body = panel.querySelector(".ldb-body");
        const getInputValue = (input) => String(input?.value || "").trim();
        const getSensitiveValue = (input, key, defaultValue = "") => {
            const liveValue = getInputValue(input);
            if (liveValue) return liveValue;
            return String(Storage.get(key, defaultValue) || "").trim();
        };
        const persistSensitiveInput = async (input, key, { allowClear = true } = {}) => {
            const value = getInputValue(input);
            if (value) {
                await CredentialVault.set(key, value);
            } else if (allowClear) {
                await CredentialVault.clear(key);
            }
            syncSensitiveInputs();
            return value;
        };
        const syncSensitiveInputs = () => {
            NotionOAuth.syncApiKeyInputs();
            CredentialVault.syncSensitiveInput(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
            CredentialVault.syncSensitiveInput(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
            CredentialVault.syncSensitiveInput(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, "Obsidian Local REST API Key");
        };

        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        if (refs.runtimeBadge) {
            refs.runtimeBadge.textContent = isUserscriptMode ? "Userscript" : "Extension";
            refs.runtimeBadge.classList.toggle("mode-userscript", isUserscriptMode);
            refs.runtimeBadge.classList.toggle("mode-extension", !isUserscriptMode);
            refs.runtimeBadge.title = isUserscriptMode
                ? "当前运行模式：Userscript（建议搭配 chrome-extension 书签桥接）"
                : "当前运行模式：Extension（独立扩展）";
        }

        if (isUserscriptMode && hasBridgeMarker && !Storage.get(CONFIG.STORAGE_KEYS.MODE_CONFLICT_TIP_SHOWN, false)) {
            Storage.set(CONFIG.STORAGE_KEYS.MODE_CONFLICT_TIP_SHOWN, true);
            UI.showStatus("检测到桥接扩展已注入。若你也安装了独立版 chrome-extension-full，请关闭其一以避免模式混用。", "info");
        }

        panel.addEventListener("wheel", (e) => {
            if (!body) return;
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.closest(".ldb-body")) return;
            if (target.closest("input, textarea, select, [contenteditable=\"true\"]")) return;
            if (e.deltaY === 0) return;
            body.scrollTop += e.deltaY;
            e.preventDefault();
        }, { passive: false });

        // 最小化
        refs.minimizeBtn.onclick = () => {
            panel.style.display = "none";
            UI.miniBtn.style.display = "flex";
            Storage.set(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, true);
        };

        // 关闭
        refs.closeBtn.onclick = () => {
            panel.remove();
            UI.miniBtn.remove();
        };

        // 主题切换
        refs.themeToggleBtn.onclick = () => {
            DesignSystem.toggleTheme();
        };

        // Tab 切换
        refs.tabs.forEach(tab => {
            tab.onclick = () => {
                const tabName = tab.getAttribute("data-tab");
                // 更新 tab 按钮状态
                refs.tabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                // 更新 tab 内容显示
                refs.tabContents.forEach(c => c.classList.remove("active"));
                const content = panel.querySelector(`[data-tab-content="${tabName}"]`);
                if (content) content.classList.add("active");
                // 持久化
                Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_TAB, tabName);
            };
        });

        // 恢复上次选择的 tab
        const savedTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, CONFIG.DEFAULTS.activeTab);
        const tabBtn = panel.querySelector(`.ldb-tab[data-tab="${savedTab}"]`);
        if (tabBtn) tabBtn.click();

        // 折叠筛选设置
        refs.filterToggle.onclick = () => {
            const content = refs.filterContent
            const arrow = refs.filterArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        // 折叠 AI 设置
        refs.aiSettingsToggle.onclick = () => {
            const content = refs.aiSettingsContent
            const arrow = refs.aiSettingsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        // 折叠 GitHub 设置
        refs.githubSettingsToggle.onclick = () => {
            const content = refs.githubSettingsContent
            const arrow = refs.githubSettingsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        // 折叠 Obsidian 设置
        refs.obsSettingsToggle.onclick = () => {
            const content = refs.obsSettingsContent;
            const arrow = refs.obsSettingsArrow;
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        // Obsidian 测试连接
        refs.obsTestBtn.onclick = async () => {
            const url = refs.obsApiUrlInput.value.trim();
            const key = getSensitiveValue(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            if (!url || !key) {
                refs.obsTestStatus.innerHTML = '<span style="color: #f87171;">请填写 API 地址和 Key</span>';
                return;
            }
            refs.obsTestStatus.innerHTML = '<span style="color: #60a5fa;">连接中...</span>';
            try {
                const result = await ObsidianAPI.testConnection(url, key);
                if (result.ok) {
                    refs.obsTestStatus.innerHTML = '<span style="color: #4ade80;">✅ 连接成功</span>';
                } else {
                    refs.obsTestStatus.innerHTML = `<span style="color: #f87171;">❌ ${result.error}</span>`;
                }
            } catch (e) {
                refs.obsTestStatus.innerHTML = `<span style="color: #f87171;">❌ ${e.message}</span>`;
            }
        };

        refs.sourceSettingsToggle.onclick = () => {
            const content = refs.sourceSettingsContent
            const arrow = refs.sourceSettingsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        refs.sourcePartitionsToggle.onclick = () => {
            const content = refs.sourcePartitionsContent
            const arrow = refs.sourcePartitionsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        refs.sourceSelectLinuxdo.onclick = () => {
            UI.switchBookmarkSource("linuxdo");
        };

        refs.sourceSelectGithub.onclick = () => {
            UI.switchBookmarkSource("github");
        };

        refs.openGithubSettingsBtn.onclick = () => {
            const settingsTab = panel.querySelector('.ldb-tab[data-tab="settings"]');
            if (settingsTab && !settingsTab.classList.contains("active")) {
                settingsTab.click();
            }
            const content = refs.githubSettingsContent
            const arrow = refs.githubSettingsArrow
            const tokenInput = refs.githubTokenInput
            if (content?.classList.contains("collapsed")) {
                content.classList.remove("collapsed");
                if (arrow) arrow.textContent = "▼";
            }
            if (tokenInput) {
                tokenInput.scrollIntoView({ block: "center", behavior: "smooth" });
                tokenInput.focus();
            }
            UI.showStatus("已定位到 GitHub Token 设置", "info");
        };

        refs.selfCheckBtn.onclick = () => {
            UI.renderSelfCheckResult();
            UI.showStatus("自检已完成", "info");
        };

        refs.copyDiagBtn.onclick = async () => {
            await UI.copyDiagnostics();
        };

        // 导出目标类型切换
        const handleExportTargetChange = (e) => {
            const targetType = e.target.value;
            const parentPageGroup = refs.parentPageGroup
            const manualDbWrap = refs.manualDbWrap
            const exportTargetTip = refs.exportTargetTip

            if (targetType === "page") {
                parentPageGroup.style.display = "block";
                manualDbWrap.style.display = "none";
                exportTargetTip.textContent = "导出为子页面，包含完整内容";
            } else {
                parentPageGroup.style.display = "none";
                manualDbWrap.style.display = "none";
                exportTargetTip.textContent = "导出为数据库条目，支持筛选和排序";
            }

            void UICommandService.execute("set_export_target_state", { targetType });
        };

        refs.exportTargetDatabaseRadio.onchange = handleExportTargetChange;
        refs.exportTargetPageRadio.onchange = handleExportTargetChange;

        // 父页面 ID 自动保存
        refs.parentPageIdInput.onchange = (e) => {
            void UICommandService.execute("set_export_target_state", {
                targetType: CONFIG.EXPORT_TARGET_TYPES.PAGE,
                parentPageId: e.target.value.trim(),
            });
        };

        // 验证配置
        refs.validateConfigBtn.onclick = async () => {
            const btn = refs.validateConfigBtn
            const statusSpan = refs.configStatus
            const liveApiKey = refs.apiKeyInput.value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
            const databaseId = refs.databaseIdInput.value.trim();
            const parentPageId = refs.parentPageIdInput.value.trim();

            // 清除之前的状态
            statusSpan.textContent = "";
            statusSpan.style.color = "";

            if (!apiKey) {
                UI.showStatus("请填写 API Key", "error");
                return;
            }

            if (exportTargetType === "database" && !databaseId) {
                UI.showStatus("请填写数据库 ID", "error");
                return;
            }

            if (exportTargetType === "page" && !parentPageId) {
                UI.showStatus("请填写父页面 ID", "error");
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 验证中...';

            try {
                const result = await UICommandService.execute("validate_export_target", {
                    apiKey,
                    liveApiKey,
                    exportTargetType,
                    databaseId,
                    parentPageId,
                });

                if (result.valid) {
                    statusSpan.textContent = "✅ 验证成功";
                    statusSpan.style.color = "#34d399";
                }

                if (!result.valid) {
                    statusSpan.textContent = `❌ ${result.error}`;
                    statusSpan.style.color = "#f87171";
                }
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "#f87171";
            } finally {
                btn.disabled = false;
                btn.innerHTML = "验证配置";
            }
        };

        // 自动设置数据库属性
        refs.setupDatabaseBtn.onclick = async () => {
            const liveApiKey = refs.apiKeyInput.value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const databaseId = refs.databaseIdInput.value.trim();
            const statusSpan = refs.configStatus

            // 清除之前的状态
            statusSpan.textContent = "";
            statusSpan.style.color = "";

            if (!apiKey) {
                UI.showStatus("请先填写 API Key", "error");
                return;
            }

            if (!databaseId) {
                UI.showStatus("请先填写数据库 ID", "error");
                return;
            }

            const btn = refs.setupDatabaseBtn
            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 设置中...';

            try {
                const result = await UICommandService.execute("setup_export_database_properties", {
                    apiKey,
                    liveApiKey,
                    databaseId,
                });
                if (result.success) {
                    statusSpan.textContent = `✅ ${result.message}`;
                    statusSpan.style.color = "#34d399";
                } else {
                    statusSpan.textContent = `❌ ${result.error}`;
                    statusSpan.style.color = "#f87171";
                }
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "#f87171";
            } finally {
                btn.disabled = false;
                btn.innerHTML = "自动设置数据库";
            }
        };

        // 自动导入设置
        refs.autoImportEnabled.onchange = (e) => {
            const enabled = e.target.checked;
            const cfg = UI.getAutoImportConfigBySource();
            Storage.set(cfg.enabledKey, enabled);
            refs.autoImportOptions.style.display = enabled ? "block" : "none";
            if (enabled) {
                if (cfg.isGitHub) {
                    GitHubAutoImporter.run();
                    const interval = parseInt(refs.autoImportInterval.value) || 0;
                    Storage.set(cfg.intervalKey, interval);
                    if (interval > 0) GitHubAutoImporter.startPolling(interval);
                    return;
                }

                // 检查 Notion 配置是否完整
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                if (!apiKey) {
                    AutoImporter.updateStatus("⚠️ 请先配置 Notion API Key");
                    return;
                }
                const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
                if (exportTargetType === "database" && !refs.databaseIdInput.value.trim()) {
                    AutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                    return;
                }
                if (exportTargetType === "page" && !refs.parentPageIdInput.value.trim()) {
                    AutoImporter.updateStatus("⚠️ 请先配置父页面 ID");
                    return;
                }
                AutoImporter.run();
                const interval = parseInt(refs.autoImportInterval.value) || 0;
                Storage.set(cfg.intervalKey, interval);
                if (interval > 0) AutoImporter.startPolling(interval);
            } else {
                if (cfg.isGitHub) {
                    GitHubAutoImporter.stopPolling();
                    GitHubAutoImporter.updateStatus("");
                } else {
                    AutoImporter.stopPolling();
                    AutoImporter.updateStatus("");
                }
            }
        };

        refs.autoImportInterval.onchange = (e) => {
            const interval = parseInt(e.target.value) || 0;
            const cfg = UI.getAutoImportConfigBySource();

            Storage.set(cfg.intervalKey, interval);
            if (cfg.isGitHub) {
                GitHubAutoImporter.stopPolling();
                if (interval > 0 && Storage.get(cfg.enabledKey, false)) {
                    GitHubAutoImporter.startPolling(interval);
                }
            } else {
                AutoImporter.stopPolling();
                if (interval > 0 && Storage.get(cfg.enabledKey, false)) {
                    AutoImporter.startPolling(interval);
                }
            }
        };

        refs.bookmarkAutoImportEnabled.onchange = (e) => {
            const enabled = !!e.target.checked;
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, enabled);
            refs.bookmarkAutoImportOptions.style.display = enabled ? "block" : "none";

            if (enabled) {
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
                if (!BookmarkBridge.isExtensionAvailable()) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先安装并启用书签桥接扩展");
                    return;
                }
                if (!apiKey) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先配置 Notion API Key");
                    return;
                }
                if (exportTargetType !== "database") {
                    BookmarkAutoImporter.updateStatus("⚠️ 浏览器书签自动同步仅支持导出到 Notion 数据库");
                    return;
                }
                if (!refs.databaseIdInput.value.trim()) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                    return;
                }

                const interval = parseInt(refs.bookmarkAutoImportInterval.value, 10) || 0;
                Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, interval);
                BookmarkAutoImporter.run();
                if (interval > 0) BookmarkAutoImporter.startPolling(interval);
            } else {
                BookmarkAutoImporter.stopPolling();
                BookmarkAutoImporter.updateStatus("");
            }
        };

        refs.bookmarkAutoImportInterval.onchange = (e) => {
            const interval = parseInt(e.target.value, 10) || 0;
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, interval);
            BookmarkAutoImporter.stopPolling();
            if (interval > 0 && Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, false)) {
                BookmarkAutoImporter.startPolling(interval);
            }
        };

        refs.rssFeedUrlsInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.RSS_FEED_URLS, e.target.value.trim());
        };

        refs.rssAutoImportEnabled.onchange = (e) => {
            const enabled = !!e.target.checked;
            Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, enabled);
            refs.rssAutoImportOptions.style.display = enabled ? "block" : "none";

            if (enabled) {
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
                if (!apiKey) {
                    RSSAutoImporter.updateStatus("❌ 请先配置 Notion API Key");
                    return;
                }
                if (exportTargetType !== "database") {
                    RSSAutoImporter.updateStatus("❌ RSS 自动同步仅支持导出到 Notion 数据库");
                    return;
                }
                if (!refs.databaseIdInput.value.trim()) {
                    RSSAutoImporter.updateStatus("❌ 请先配置 Notion 数据库 ID");
                    return;
                }
                if (RSSAutoImporter.getFeedUrls(refs.rssFeedUrlsInput.value).length === 0) {
                    RSSAutoImporter.updateStatus("❌ 请先配置至少一个 RSS Feed URL");
                    return;
                }

                const interval = parseInt(refs.rssAutoImportInterval.value, 10) || 0;
                Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, interval);
                RSSAutoImporter.run();
                if (interval > 0) RSSAutoImporter.startPolling(interval);
            } else {
                RSSAutoImporter.stopPolling();
                RSSAutoImporter.updateStatus("");
            }
        };

        refs.rssAutoImportInterval.onchange = (e) => {
            const interval = parseInt(e.target.value, 10) || 0;
            Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, interval);
            RSSAutoImporter.stopPolling();
            if (interval > 0 && Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, false)) {
                RSSAutoImporter.startPolling(interval);
            }
        };

        refs.rssDedupModeSelect.onchange = (e) => {
            const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
            Storage.set(CONFIG.STORAGE_KEYS.RSS_IMPORT_DEDUP_MODE, mode);
        };

        refs.linuxdoDedupModeSelect.onchange = (e) => {
            const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
            Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, mode);
            UI.recomputeExportStats();
            UI.renderBookmarkList();
        };

        refs.bookmarkDedupModeSelect.onchange = (e) => {
            const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_IMPORT_DEDUP_MODE, mode);
        };

        refs.aiCategoryAutoDedupCheckbox.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORY_AUTO_DEDUP, !!e.target.checked);
        };

        refs.crossSourceModeSelect.onchange = (e) => {
            const mode = e.target.value === "unified" ? "unified" : "separate";
            Storage.set(CONFIG.STORAGE_KEYS.CROSS_SOURCE_MODE, mode);
        };

        refs.updateCheckBtn.onclick = async () => {
            await UpdateChecker.check({ manual: true });
        };

        refs.updateAutoEnabled.onchange = (e) => {
            const enabled = e.target.checked;
            const optionsEl = refs.updateAutoOptions
            optionsEl.style.display = enabled ? "block" : "none";
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, enabled);

            if (enabled) {
                const hours = parseInt(refs.updateIntervalHours.value, 10)
                    || CONFIG.DEFAULTS.updateCheckIntervalHours;
                Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, hours);
                UpdateChecker.check({ manual: false });
                UpdateChecker.startPolling(hours);
            } else {
                UpdateChecker.stopPolling();
            }
        };

        refs.updateIntervalHours.onchange = (e) => {
            const hours = parseInt(e.target.value, 10) || CONFIG.DEFAULTS.updateCheckIntervalHours;
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, hours);
            if (Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled)) {
                UpdateChecker.startPolling(hours);
            }
        };

        UI.switchBookmarkSource = (source) => {
            const resolvedSource = source === "github" ? "github" : "linuxdo";
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, resolvedSource);
            UI.applyBookmarkSourceUI(resolvedSource);
            UI.renderSelfCheckResult();
            UI.bookmarks = [];
            UI.selectedBookmarks = new Set();
            UI.recomputeExportStats();
            UI.refs.bookmarkCount.textContent = "-";
            UI.refs.exportBtn.disabled = true;
            UI.refs.obsExportBtn.disabled = true;
            UI.refs.bookmarkListContainer.style.display = "none";
            UI.renderBookmarkList();

            const cfg = UI.getAutoImportConfigBySource();
            const autoImportEnabled = Storage.get(cfg.enabledKey, cfg.enabledDefault);
            const autoImportEnabledEl = refs.autoImportEnabled
            const autoImportOptionsEl = refs.autoImportOptions
            const intervalEl = refs.autoImportInterval
            autoImportEnabledEl.checked = autoImportEnabled;
            autoImportOptionsEl.style.display = autoImportEnabled ? "block" : "none";
            intervalEl.value = String(Storage.get(cfg.intervalKey, cfg.intervalDefault));
            if (intervalEl.selectedIndex === -1) {
                intervalEl.value = String(cfg.intervalDefault);
                Storage.set(cfg.intervalKey, cfg.intervalDefault);
            }
            UI.renderVisualSummary();
        };

        // 收藏列表事件委托（避免每次重渲染重复绑定）
        if (!UI.bookmarkListBound) {
            const bookmarkList = UI.refs.bookmarkList;
            bookmarkList.addEventListener("click", (e) => {
                const reexportBtn = e.target.closest("[data-bookmark-action=\"reexport\"]");
                if (reexportBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = reexportBtn.closest(".ldb-bookmark-item");
                    const bookmarkKey = String(item?.dataset.topicId || "");
                    if (bookmarkKey) {
                        UI.requeueLinuxDoBookmark(bookmarkKey);
                    }
                    return;
                }

                const item = e.target.closest(".ldb-bookmark-item");
                if (!item) return;
                if (e.target.tagName === "INPUT") return;

                const checkbox = item.querySelector('input[type="checkbox"]');
                if (!checkbox || checkbox.disabled) return;

                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            });

            bookmarkList.addEventListener("change", (e) => {
                const checkbox = e.target;
                if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox") return;

                const item = checkbox.closest(".ldb-bookmark-item");
                if (!item) return;

                const bookmarkKey = String(item.dataset.topicId || "");
                if (!bookmarkKey) return;

                const isUnexported = !UI.isBookmarkKeyExported(bookmarkKey);

                if (checkbox.checked) {
                    UI.selectedBookmarks.add(bookmarkKey);
                    if (isUnexported) UI.selectedUnexportedCount++;
                } else {
                    UI.selectedBookmarks.delete(bookmarkKey);
                    if (isUnexported) UI.selectedUnexportedCount = Math.max(0, UI.selectedUnexportedCount - 1);
                }
                UI.updateSelectCount();
            });

            UI.bookmarkListBound = true;
        }

        // 加载收藏
        refs.loadBookmarksBtn.onclick = async () => {
            const btn = refs.loadBookmarksBtn
            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 加载中...';

            try {
                let bookmarks = [];

                if (UI.isActiveGitHubSource()) {
                    const username = refs.githubUsernameInput.value.trim()
                        || Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
                    const token = getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
                    const types = GitHubAPI.getImportTypes();

                    if (!username && !token) {
                        UI.showStatus("请先在设置中填写 GitHub 用户名（或配置 Token）", "error");
                        return;
                    }

                    const allItems = [];
                    for (const type of types) {
                        if (type === "stars") {
                            const items = await GitHubAPI.fetchStarredRepos(username, token);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(items, "stars"));
                        } else if (type === "repos") {
                            const items = await GitHubAPI.fetchUserRepos(username, token);
                            const ownRepos = items.filter(r => !r.fork);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(ownRepos, "repos"));
                        } else if (type === "forks") {
                            const items = await GitHubAPI.fetchForkedRepos(username, token);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(items, "forks"));
                        } else if (type === "gists") {
                            const items = await GitHubAPI.fetchUserGists(username, token);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(items, "gists"));
                        }
                        UI.refs.bookmarkCount.textContent = allItems.length;
                    }
                    bookmarks = allItems;
                } else {
                    const username = Utils.getCurrentLinuxDoUsername();
                    if (!username) {
                        UI.showStatus("无法获取当前 Linux.do 用户名，请先登录后重试", "error");
                        return;
                    }
                    bookmarks = await LinuxDoAPI.fetchAllBookmarks(username, (count) => {
                        UI.refs.bookmarkCount.textContent = count;
                    });
                }

                UI.bookmarks = bookmarks;
                UI.updateVisualSnapshot(UI.getActiveBookmarkSource(), bookmarks);
                UI.selectedBookmarks = new Set(bookmarks.map(b => UI.getBookmarkKey(b)));
                UI.recomputeExportStats();
                UI.refs.bookmarkCount.textContent = bookmarks.length;
                UI.refs.exportBtn.disabled = false;
                UI.refs.obsExportBtn.disabled = false;

                // 渲染收藏列表
                UI.renderBookmarkList();
                UI.refs.bookmarkListContainer.style.display = "block";

                const sourceText = UI.isActiveGitHubSource() ? "GitHub 收藏" : "Linux.do 收藏";
                UI.showStatus(`成功加载 ${bookmarks.length} 个${sourceText}`, "success");
            } catch (error) {
                UI.showStatus(`加载失败: ${error.message}`, "error");
            } finally {
                btn.disabled = false;
                btn.innerHTML = "🔄 加载收藏列表";
            }
        };

        refs.importBrowserBookmarksBtn.onclick = async () => {
            const btn = refs.importBrowserBookmarksBtn
            const source = UI.getActiveBookmarkSource();
            if (source !== "linuxdo") {
                UI.switchBookmarkSource("linuxdo");
                const toggle = refs.sourceSettingsToggle
                const content = refs.sourceSettingsContent
                if (toggle && content?.classList.contains("collapsed")) {
                    toggle.click();
                }
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 导入中...';
            try {
                const chatInput = panel.querySelector("#ldb-chat-input");
                if (chatInput && typeof ChatUI !== "undefined" && ChatUI.sendMessage) {
                    chatInput.value = "导入浏览器书签";
                    ChatUI.sendMessage();
                } else {
                    UI.showStatus("AI 面板未就绪，请稍后重试", "error");
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = "📖 导入浏览器书签";
            }
        };

        // 全选/取消
        refs.selectAll.onchange = (e) => {
            const checked = e.target.checked;
            if (checked) {
                UI.selectedBookmarks = new Set(UI.bookmarks.map(b => UI.getBookmarkKey(b)));
            } else {
                UI.selectedBookmarks = new Set();
            }
            UI.recomputeExportStats();
            UI.syncRenderedSelectionState();
            UI.updateSelectCount();
        };

        // 暂停按钮
        refs.pauseBtn.onclick = () => {
            const pauseBtn = refs.pauseBtn
            if (Exporter.isPaused) {
                Exporter.resume();
                pauseBtn.innerHTML = "⏸️ 暂停";
                pauseBtn.classList.remove("ldb-btn-primary");
                pauseBtn.classList.add("ldb-btn-warning");
            } else {
                Exporter.pause();
                pauseBtn.innerHTML = "▶️ 继续";
                pauseBtn.classList.remove("ldb-btn-warning");
                pauseBtn.classList.add("ldb-btn-primary");
            }
        };

        // 取消按钮
        refs.cancelBtn.onclick = () => {
            if (confirm("确定要取消导出吗？已导出的内容不会被删除。")) {
                Exporter.cancel();
            }
        };

        // 开始导出
        refs.exportBtn.onclick = async () => {
            const liveApiKey = refs.apiKeyInput.value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
            const databaseId = refs.databaseIdInput.value.trim();
            const parentPageId = refs.parentPageIdInput.value.trim();

            if (!apiKey) {
                UI.showStatus("请先配置 Notion API Key", "error");
                return;
            }

            if (exportTargetType === "database" && !databaseId) {
                UI.showStatus("请先配置数据库 ID", "error");
                return;
            }

            if (exportTargetType === "page" && !parentPageId) {
                UI.showStatus("请先配置父页面 ID", "error");
                return;
            }

            if (!UI.bookmarks || UI.bookmarks.length === 0) {
                UI.showStatus("请先加载收藏列表", "error");
                return;
            }

            // 获取选中的收藏（严格模式过滤已导出，允许重复模式仅按勾选）
            const toExport = UI.bookmarks.filter((b) => {
                const bookmarkKey = UI.getBookmarkKey(b);
                return UI.selectedBookmarks.has(bookmarkKey) && !UI.isBookmarkKeyExported(bookmarkKey);
            });

            if (toExport.length === 0) {
                UI.showStatus("没有可导出的收藏（可能都已导出过或未选中）", "info");
                return;
            }

            const settings = {
                apiKey,
                databaseId,
                parentPageId,
                exportTargetType,
                onlyFirst: refs.onlyFirstCheckbox.checked,
                onlyOp: refs.onlyOpCheckbox.checked,
                rangeStart: parseInt(refs.rangeStartInput.value) || 1,
                rangeEnd: parseInt(refs.rangeEndInput.value) || 999999,
                imgMode: refs.imgModeSelect.value,
                concurrency: parseInt(refs.exportConcurrencySelect.value) || 1,
                aiApiKey: getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: refs.aiServiceSelect.value,
                aiModel: refs.aiModelSelect.value,
                aiBaseUrl: refs.aiBaseUrlInput.value.trim(),
                categories: Utils.parseAICategories(
                    refs.aiCategoriesInput.value.trim() || ""
                ),
                githubUsername: refs.githubUsernameInput.value.trim(),
                token: getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
                imgFilter: refs.filterImgSelect.value,
                filterUsers: refs.filterUsersInput.value.trim(),
                filterInclude: refs.filterIncludeInput.value.trim(),
                filterExclude: refs.filterExcludeInput.value.trim(),
                filterMinLen: parseInt(refs.filterMinLenInput.value) || 0,
            };

            // 保存设置
            await UICommandService.execute("save_command_boundary_settings", {
                scope: "main-export-session",
                liveApiKey,
                exportState: {
                    targetType: exportTargetType,
                    databaseId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.DATABASE ? databaseId : undefined,
                    parentPageId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? parentPageId : undefined,
                },
                storageValues: {
                    [CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST]: settings.onlyFirst,
                    [CONFIG.STORAGE_KEYS.FILTER_ONLY_OP]: settings.onlyOp,
                    [CONFIG.STORAGE_KEYS.FILTER_RANGE_START]: settings.rangeStart,
                    [CONFIG.STORAGE_KEYS.FILTER_RANGE_END]: settings.rangeEnd,
                    [CONFIG.STORAGE_KEYS.FILTER_IMG]: settings.imgFilter,
                    [CONFIG.STORAGE_KEYS.FILTER_USERS]: settings.filterUsers,
                    [CONFIG.STORAGE_KEYS.FILTER_INCLUDE]: settings.filterInclude,
                    [CONFIG.STORAGE_KEYS.FILTER_EXCLUDE]: settings.filterExclude,
                    [CONFIG.STORAGE_KEYS.FILTER_MINLEN]: settings.filterMinLen,
                    [CONFIG.STORAGE_KEYS.IMG_MODE]: settings.imgMode,
                    [CONFIG.STORAGE_KEYS.REQUEST_DELAY]: parseInt(refs.requestDelaySelect.value),
                    [CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY]: settings.concurrency,
                },
                sensitiveEntries: {
                    [CONFIG.STORAGE_KEYS.AI_API_KEY]: getInputValue(refs.aiApiKeyInput),
                    [CONFIG.STORAGE_KEYS.GITHUB_TOKEN]: getInputValue(refs.githubTokenInput),
                },
            });

            // 显示控制按钮，隐藏导出按钮
            refs.exportBtns.style.display = "none";
            refs.controlBtns.style.display = "flex";
            refs.pauseBtn.innerHTML = "⏸️ 暂停";
            refs.pauseBtn.classList.add("ldb-btn-warning");
            refs.pauseBtn.classList.remove("ldb-btn-primary");

            // 清空之前的报告
            UI.refs.reportContainer.innerHTML = "";

            try {
                let results;
                if (UI.isActiveGitHubSource()) {
                    results = await UI.exportGitHubSelected(toExport, settings, (current, total, title) => {
                        UI.showProgress(current, total, `${title}\n导出中`);
                    });
                } else {
                    results = await Exporter.exportBookmarks(toExport, settings, (progress) => {
                        UI.showProgress(
                            progress.current,
                            progress.total,
                            `${progress.title}\n${progress.message || progress.stage}${progress.isPaused ? " (已暂停)" : ""}`
                        );
                    });
                }

                UI.hideProgress();

                // 显示导出报告
                UI.showReport(results);

                // 刷新列表状态
                UI.renderBookmarkList();

                const successCount = results.success.length;
                const failCount = results.failed.length;
                const skippedCount = results.skipped?.length || 0;

                let statusMsg = `导出完成：成功 ${successCount} 个`;
                if (failCount > 0) statusMsg += `，失败 ${failCount} 个`;
                if (skippedCount > 0) statusMsg += `，跳过 ${skippedCount} 个`;

                UI.showStatus(statusMsg, failCount > successCount ? "error" : "success");

                // 通知
                if (typeof GM_notification === "function") {
                    GM_notification({
                        title: "导出完成",
                        text: statusMsg,
                        timeout: 5000,
                    });
                }
            } catch (error) {
                UI.showStatus(`导出出错: ${error.message}`, "error");
            } finally {
                // 恢复按钮状态
                refs.exportBtns.style.display = "flex";
                refs.controlBtns.style.display = "none";
                Exporter.reset();
            }
        };

        // 导出到 Obsidian
        refs.obsExportBtn.onclick = async () => {
            const obsUrl = refs.obsApiUrlInput.value.trim();
            const obsKey = getSensitiveValue(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            const obsDir = refs.obsDirInput.value.trim() || "Linux.do";
            const obsImgMode = refs.obsImgModeSelect.value;
            const obsImgDir = refs.obsImgDirInput.value.trim() || "Linux.do/attachments";

            if (!obsUrl || !obsKey) {
                UI.showStatus("请先在设置中配置 Obsidian API 地址和 Key", "error");
                return;
            }

            const selected = UI.getSelectedBookmarks();
            if (selected.length === 0) {
                UI.showStatus("请先选择要导出的帖子", "error");
                return;
            }

            refs.exportBtns.style.display = "none";
            refs.controlBtns.style.display = "flex";
            UI.refs.reportContainer.innerHTML = "";

            const results = { success: [], failed: [], skipped: [] };

            try {
                if (UI.isActiveGitHubSource()) {
                    const githubResults = await UI.exportGitHubSelectedToObsidian(selected, {
                        obsUrl,
                        obsKey,
                        obsDir,
                        aiApiKey: getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                        aiService: refs.aiServiceSelect.value,
                        aiModel: refs.aiModelSelect.value,
                        aiBaseUrl: refs.aiBaseUrlInput.value.trim(),
                        categories: Utils.parseAICategories(refs.aiCategoriesInput.value.trim() || ""),
                        token: getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
                    }, (current, total, title) => {
                        UI.showProgress(current, total, `${title}\n导出到 Obsidian...`);
                    });
                    results.success.push(...githubResults.success);
                    results.failed.push(...githubResults.failed);
                    results.skipped.push(...(githubResults.skipped || []));
                } else {
                    for (let i = 0; i < selected.length; i++) {
                        if (Exporter.isCancelled) break;
                        while (Exporter.isPaused) {
                            await Utils.sleep(200);
                            if (Exporter.isCancelled) break;
                        }
                        if (Exporter.isCancelled) break;

                        const bookmark = selected[i];
                        const topicId = bookmark.topic_id || bookmark.bookmarkable_id;
                        UI.showProgress(i + 1, selected.length, "导出帖子到 Obsidian...");

                        try {
                            const { topic, posts } = await LinuxDoAPI.fetchAllPosts(topicId);
                            const filteredPosts = Exporter.filterPosts(posts, topic, {
                                onlyFirst: refs.onlyFirstCheckbox.checked,
                                onlyOp: refs.onlyOpCheckbox.checked,
                                rangeStart: parseInt(refs.rangeStartInput.value) || 1,
                                rangeEnd: parseInt(refs.rangeEndInput.value) || 999999,
                                imgFilter: refs.filterImgSelect.value,
                                filterUsers: refs.filterUsersInput.value.trim(),
                                filterInclude: refs.filterIncludeInput.value.trim(),
                                filterExclude: refs.filterExcludeInput.value.trim(),
                                filterMinLen: parseInt(refs.filterMinLenInput.value) || 0,
                            });

                            const meta = {
                                title: topic.title,
                                url: topic.url,
                                author: topic.opUsername,
                                topicId: topic.topicId || topic.topic_id,
                                category: topic.categoryName || topic.category,
                                tags: topic.tags || [],
                                floors: filteredPosts.length,
                            };
                            let md = HTMLToMarkdown.buildFrontmatter(meta);

                            md += `> [!info] 帖子信息\n`;
                            md += `> - **原始链接**: [${topic.title}](${topic.url})\n`;
                            md += `> - **楼主**: @${topic.opUsername || "未知"}\n`;
                            md += `> - **分类**: ${meta.category || "无"}\n`;
                            md += `> - **标签**: ${(topic.tags || []).join(", ") || "无"}\n`;
                            md += `> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;

                            filteredPosts.forEach((post, idx) => {
                                const isOp = post.username === topic.opUsername;
                                md += HTMLToMarkdown.buildPostCallout(post, idx, isOp);
                            });

                            if (obsImgMode === "file") {
                                const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                                let match;
                                const imgDownloads = [];
                                while ((match = imgRegex.exec(md)) !== null) {
                                    imgDownloads.push({ full: match[0], alt: match[1], url: match[2] });
                                }
                                for (const img of imgDownloads) {
                                    try {
                                        const ext = img.url.split(".").pop().split("?")[0] || "png";
                                        const safeName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
                                        const imgPath = `${obsImgDir}/${safeName}`;
                                        const blob = await new Promise((resolve, reject) => {
                                            GM_xmlhttpRequest({
                                                method: "GET",
                                                url: img.url,
                                                responseType: "blob",
                                                timeout: 30000,
                                                onload: (r) => resolve(r.response),
                                                onerror: (e) => reject(e),
                                                ontimeout: () => reject(new Error("图片下载超时")),
                                            });
                                        });
                                        const imgResult = await ObsidianAPI.writeImage(obsUrl, obsKey, imgPath, blob, getMimeType(ext));
                                        if (!imgResult.ok) throw new Error(imgResult.error);
                                        md = md.replace(img.full, `![${img.alt}](${encodeURI(imgPath)})`);
                                    } catch {
                                        // 图片下载失败，保留原始链接
                                    }
                                }
                            } else if (obsImgMode === "base64") {
                                const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                                const matches = [];
                                let m;
                                while ((m = imgRegex.exec(md)) !== null) matches.push(m);
                                for (const match of matches.reverse()) {
                                    try {
                                        const resp = await new Promise((resolve, reject) => {
                                            GM_xmlhttpRequest({
                                                method: "GET",
                                                url: match[2],
                                                responseType: "blob",
                                                timeout: 30000,
                                                onload: (r) => resolve(r),
                                                onerror: (e) => reject(e),
                                                ontimeout: () => reject(new Error("图片下载超时")),
                                            });
                                        });
                                        const b64 = await new Promise((resolve) => {
                                            const reader = new FileReader();
                                            reader.onloadend = () => resolve(reader.result);
                                            reader.readAsDataURL(resp.response);
                                        });
                                        md = md.replace(match[0], `![${match[1]}](${b64})`);
                                    } catch {
                                        // 跳过失败的图片
                                    }
                                }
                            }

                            const fileName = UI.sanitizeObsidianFileName(topic.title, `topic-${topicId}`);
                            const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${fileName}.md`, md);
                            if (!noteResult.ok) throw new Error(noteResult.error);
                            results.success.push({
                                title: topic.title,
                                url: topic.url,
                            });
                        } catch (error) {
                            results.failed.push({
                                title: bookmark.title || `帖子 ${topicId}`,
                                error: error.message,
                            });
                        }

                        if (i < selected.length - 1) {
                            await Utils.sleep(300);
                        }
                    }
                }

                UI.hideProgress();
                UI.showReport(results);
                UI.renderBookmarkList();

                const msg = `Obsidian 导出完成：成功 ${results.success.length} 个${results.failed.length ? `，失败 ${results.failed.length} 个` : ""}`;
                UI.showStatus(msg, results.failed.length > 0 ? "warning" : "success");
            } catch (error) {
                UI.showStatus(`Obsidian 导出出错: ${error.message}`, "error");
            } finally {
                refs.exportBtns.style.display = "flex";
                refs.controlBtns.style.display = "none";
                Exporter.reset();
            }
        };

        // 权限设置事件
        refs.permissionLevelSelect.onchange = (e) => {
            const level = parseInt(e.target.value);
            OperationGuard.setLevel(level);
            UI.showStatus(`权限级别已设置为: ${CONFIG.PERMISSION_NAMES[level]}`, "success");
        };

        refs.requireConfirmCheckbox.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, e.target.checked);
        };

        refs.enableAuditLogCheckbox.onchange = (e) => {
            const previousState = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
            const nextState = !!e.target.checked;
            OperationLog.add({
                audit_event: nextState ? "audit.enabled" : "audit.disabled",
                actor: "user",
                source: "linuxdo-panel",
                operation: {
                    name: "toggleAuditLog",
                    risk: "standard",
                    trigger: "user_settings_change",
                },
                payload: {
                    previousState,
                    newState: nextState,
                },
                result: {
                    status: "success",
                    reason: nextState ? "audit_enabled" : "audit_disabled",
                },
                redaction: [],
                operationName: "toggleAuditLog",
                context: {
                    previousState,
                    newState: nextState,
                },
                startTime: Date.now(),
                endTime: Date.now(),
                status: "success",
            }, { force: true });
            Storage.set(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, nextState);
            // 更新日志面板可见性
            const logPanel = refs.logPanel
            if (logPanel) {
                logPanel.style.display = nextState ? "block" : "none";
            }
        };

        // 日志面板事件
        refs.logToggleBtn.onclick = () => {
            const content = refs.logContent
            const arrow = refs.logArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";

            // 展开时更新日志内容
            if (!content.classList.contains("collapsed")) {
                UI.updateLogPanel();
            }
        };

        refs.logClearBtn.onclick = () => {
            if (confirm("确定要清除所有操作日志吗？")) {
                OperationLog.clear();
                UI.showStatus("日志已清除", "success");
            }
        };

        // 输入框自动保存
        refs.apiKeyInput.onchange = async (e) => {
            const value = e.target.value.trim();
            try {
                if (value) {
                    await NotionOAuth.setManualApiKey(value);
                } else if (NotionOAuth.getAuthMode() !== "oauth") {
                    await NotionOAuth.setManualApiKey("");
                }
            } catch (error) {
                UI.showStatus(error.message || String(error), "error");
            }
        };
        refs.databaseIdInput.onchange = (e) => {
            void UICommandService.execute("apply_workspace_selection", { selectedValue: `database:${e.target.value.trim()}` });
        };

        // 手动输入数据库 ID 开关
        refs.toggleManualDbBtn.onclick = () => {
            const wrap = refs.manualDbWrap
            const visible = wrap.style.display !== "none";
            wrap.style.display = visible ? "none" : "block";
        };

        // 刷新工作区页面列表
        refs.refreshWorkspaceBtn.onclick = async () => {
            const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
            const refreshBtn = refs.refreshWorkspaceBtn
            const workspaceTip = refs.workspaceTip

            if (!apiKey) {
                UI.showStatus(MSG.NO_NOTION_KEY, "error");
                return;
            }

            refreshBtn.disabled = true;
            refreshBtn.innerHTML = "⏳";
            workspaceTip.style.color = "";
            workspaceTip.textContent = "正在获取数据库列表...";

            try {
                const { workspaceData } = await WorkspaceService.refreshWorkspaceSnapshot(apiKey, {
                    includePages: true,
                    onProgress: (progress) => {
                        if (progress.phase === "databases") {
                            workspaceTip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                        } else if (progress.phase === "pages") {
                            workspaceTip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                        }
                    },
                    onWorkspaceData: (workspaceData, meta) => {
                        UI.updateWorkspaceSelect(workspaceData);

                        if (meta.phase === "databases") {
                            workspaceTip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                            workspaceTip.style.color = "#34d399";
                        }
                    },
                });
                UI.updateWorkspaceSelect(workspaceData);
                workspaceTip.textContent = `✅ 获取到 ${workspaceData.databases.length} 个数据库，${workspaceData.pages.length} 个页面`;
                workspaceTip.style.color = "#34d399";
            } catch (error) {
                workspaceTip.textContent = `❌ ${error.message}`;
                workspaceTip.style.color = "#f87171";
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = "🔄";
            }
        };

        if (refs.viewRefreshWorkspaceBtn) {
            refs.viewRefreshWorkspaceBtn.onclick = async () => {
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                if (!apiKey) {
                    UI.showStatus(MSG.NO_NOTION_KEY, "error");
                    UI.setWorkspaceVisualStatus(MSG.NO_NOTION_KEY, "error");
                    return;
                }

                try {
                    await UI.refreshWorkspaceVisualization(apiKey);
                } catch (error) {
                    UI.showStatus(`工作区视图刷新失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewGenerateWorkspaceInsightBtn) {
            refs.viewGenerateWorkspaceInsightBtn.onclick = async () => {
                try {
                    await UI.generateWorkspaceInsight();
                } catch (error) {
                    UI.showStatus(`生成工作区洞察失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewCopyWorkspaceReportBtn) {
            refs.viewCopyWorkspaceReportBtn.onclick = async () => {
                try {
                    await UI.copyWorkspaceInsightReport();
                } catch (error) {
                    UI.showStatus(`复制工作区报告失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewDownloadWorkspaceReportBtn) {
            refs.viewDownloadWorkspaceReportBtn.onclick = async () => {
                try {
                    await UI.downloadWorkspaceInsightReport();
                } catch (error) {
                    UI.showStatus(`涓嬭浇宸ヤ綔鍖烘姤鍛婂け璐ワ細${error.message}`, "error");
                }
            };
        }

        if (refs.viewDownloadWorkspacePackageBtn) {
            refs.viewDownloadWorkspacePackageBtn.onclick = async () => {
                try {
                    await UI.downloadWorkspaceCollaborationPackage();
                } catch (error) {
                    UI.showStatus(`下载工作区协作包失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSaveWorkspacePackageBtn) {
            refs.viewSaveWorkspacePackageBtn.onclick = async () => {
                try {
                    await UI.saveWorkspaceCollaborationPackageToNotion();
                } catch (error) {
                    UI.showStatus(`保存工作区协作包失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSaveWorkspaceReportBtn) {
            refs.viewSaveWorkspaceReportBtn.onclick = async () => {
                try {
                    await UI.saveWorkspaceInsightReportToNotion();
                } catch (error) {
                    UI.showStatus(`保存工作区报告失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSaveWorkspaceCandidatesBtn) {
            refs.viewSaveWorkspaceCandidatesBtn.onclick = async () => {
                try {
                    await UI.saveWorkspaceConnectionCandidatesToNotion();
                } catch (error) {
                    UI.showStatus(`保存统一候选失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSyncNowBtn) {
            refs.viewSyncNowBtn.onclick = async () => {
                try {
                    await UI.runUnifiedSyncNow();
                } catch (error) {
                    UI.showStatus(`统一同步失败：${error.message}`, "error");
                }
            };
        }

        // 从工作区选择页面/数据库
        refs.workspaceSelect.onchange = (e) => {
            const selected = e.target.value;
            if (selected) {
                const [type, id] = selected.split(":");
                if (type === "database") {
                    refs.databaseIdInput.value = id;
                    refs.exportTargetDatabaseRadio.checked = true;
                    handleExportTargetChange({ target: { value: CONFIG.EXPORT_TARGET_TYPES.DATABASE } });
                    void UICommandService.execute("apply_workspace_selection", { selectedValue: `database:${id}` });
                    UI.showStatus("已选择数据库，自动切换为数据库导出模式", "info");
                } else if (type === "page") {
                    // 页面类型：填入父页面 ID 字段
                    refs.parentPageIdInput.value = id;
                    // 自动切换到页面导出模式
                    refs.exportTargetPageRadio.checked = true;
                    refs.parentPageGroup.style.display = "block";
                    refs.manualDbWrap.style.display = "none";
                    refs.exportTargetTip.textContent = "导出为子页面，包含完整内容";
                    void UICommandService.execute("apply_workspace_selection", { selectedValue: `page:${id}` });
                    UI.showStatus("已选择页面，自动切换为页面导出模式", "info");
                }
            }
        };

        // ===========================================
        // AI 对话事件绑定
        // ===========================================

        // 初始化对话 UI
        ChatUI.init();

        // AI 服务切换 - 更新模型列表（优先使用缓存）
        refs.aiServiceSelect.onchange = (e) => {
            const newService = e.target.value;
            const availableModels = AIService.getAvailableModels(newService);
            UI.updateAIModelOptions(newService, availableModels.length > 0 ? availableModels : undefined);
            Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, newService);
        };

        // 保存 AI 配置
        refs.aiApiKeyInput.onchange = (e) => {
            persistSensitiveInput(e.target, CONFIG.STORAGE_KEYS.AI_API_KEY).catch((error) => {
                UI.showStatus(error.message || String(error), "error");
            });
        };
        refs.aiBaseUrlInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_BASE_URL, e.target.value.trim());
        };
        refs.aiCategoriesInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORIES, e.target.value.trim());
        };
        refs.aiModelSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, e.target.value);
        };

        // AI 查询目标数据库选择
        refs.aiTargetDbSelect.onchange = (e) => {
            void UICommandService.execute("select_ai_target", { targetValue: e.target.value });
        };

        refs.workspaceMaxPagesSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, parseInt(e.target.value) || 0);
        };

        // Agent 个性化设置
        refs.agentPersonaNameInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, e.target.value.trim() || CONFIG.DEFAULTS.agentPersonaName);
        };
        refs.agentPersonaToneSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, e.target.value);
        };
        refs.agentPersonaExpertiseInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, e.target.value.trim() || CONFIG.DEFAULTS.agentPersonaExpertise);
        };
        refs.agentPersonaInstructionsInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, e.target.value.trim());
        };
        refs.agentMaxIterationsSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS, parseInt(e.target.value) || 8);
        };
        refs.githubUsernameInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, e.target.value.trim());
        };
        refs.githubTokenInput.onchange = (e) => {
            persistSensitiveInput(e.target, CONFIG.STORAGE_KEYS.GITHUB_TOKEN).catch((error) => {
                UI.showStatus(error.message || String(error), "error");
            });
        };
        // Obsidian 设置变更保存
        refs.obsApiUrlInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_API_URL, e.target.value.trim());
        };
        refs.obsApiKeyInput.onchange = (e) => {
            persistSensitiveInput(e.target, CONFIG.STORAGE_KEYS.OBS_API_KEY).catch((error) => {
                UI.showStatus(error.message || String(error), "error");
            });
        };
        refs.obsDirInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_DIR, e.target.value.trim());
        };
        refs.obsImgModeSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_IMG_MODE, e.target.value);
        };
        refs.obsImgDirInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_IMG_DIR, e.target.value.trim());
        };
        // GitHub 导入类型
        refs.githubTypeCheckboxes.forEach(cb => {
            cb.onchange = () => {
                const source = [...refs.githubTypeCheckboxes].filter(c => c.checked);
                const types = [...source].filter(c => c.checked).map(c => c.value);
                GitHubAPI.setImportTypes(types.length > 0 ? types : ["stars"]);
            };
        });

        // 刷新 AI 数据库列表
        refs.aiRefreshDbsBtn.onclick = async () => {
            const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
            const refreshBtn = refs.aiRefreshDbsBtn

            if (!apiKey) {
                UI.showStatus(MSG.NO_NOTION_KEY, "error");
                return;
            }

            refreshBtn.disabled = true;
            refreshBtn.innerHTML = "⏳";

            try {
                const { workspaceData } = await UICommandService.execute("refresh_workspace_targets", {
                    apiKey,
                    includePages: false,
                    onWorkspaceData: (workspaceData) => {
                        UI.updateAITargetDbOptions(workspaceData.databases);
                    },
                });

                UI.updateAITargetDbOptions(workspaceData.databases);
                UI.showStatus(`获取到 ${workspaceData.databases.length} 个数据库`, "success");
            } catch (error) {
                UI.showStatus(`获取数据库列表失败: ${error.message}`, "error");
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = "🔄";
            }
        };

        // 获取模型列表
        refs.aiFetchModelsBtn.onclick = async () => {
            const aiApiKey = getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "");
            const aiService = refs.aiServiceSelect.value;
            const aiBaseUrl = refs.aiBaseUrlInput.value.trim();
            const fetchBtn = refs.aiFetchModelsBtn
            const modelTip = refs.aiModelTip

            if (!aiApiKey) {
                UI.showStatus(MSG.NO_AI_KEY, "error");
                return;
            }

            fetchBtn.disabled = true;
            fetchBtn.innerHTML = "⏳ 获取中...";
            modelTip.textContent = "";

            try {
                const { models } = await UICommandService.execute("fetch_ai_models", {
                    aiService,
                    aiApiKey,
                    aiBaseUrl,
                });
                UI.updateAIModelOptions(aiService, models, true); // 保留当前选择
                modelTip.textContent = `✅ 获取到 ${models.length} 个可用模型`;
                modelTip.style.color = "#34d399";
                UI.showStatus(`成功获取 ${models.length} 个模型`, "success");
            } catch (error) {
                modelTip.textContent = `❌ ${error.message}`;
                modelTip.style.color = "#f87171";
                UI.showStatus(`获取模型失败: ${error.message}`, "error");
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = "🔄 获取";
            }
        };

        // 测试 AI 连接
        refs.aiTestBtn.onclick = async () => {
            const btn = refs.aiTestBtn
            const statusSpan = refs.aiTestStatus
            const aiApiKey = getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "");
            const aiService = refs.aiServiceSelect.value;
            const aiModel = refs.aiModelSelect.value;
            const aiBaseUrl = refs.aiBaseUrlInput.value.trim();

            // 清除之前的状态
            statusSpan.textContent = "";
            statusSpan.style.color = "";

            if (!aiApiKey) {
                UI.showStatus(MSG.NO_AI_KEY, "error");
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 测试中...';

            try {
                const response = await AIService.request(
                    "请回复：连接成功",
                    { aiService, aiApiKey, aiModel, aiBaseUrl }
                );
                statusSpan.textContent = `✅ ${response}`;
                statusSpan.style.color = "#34d399";
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "#f87171";
            } finally {
                btn.disabled = false;
                btn.innerHTML = "🧪 测试";
            }
        };

        // AI 模板管理
        UI._loadTemplates = () => {
            try {
                return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.AI_TEMPLATES, CONFIG.DEFAULTS.aiTemplates));
            } catch {
                return JSON.parse(CONFIG.DEFAULTS.aiTemplates);
            }
        };

        UI._saveTemplates = (templates) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_TEMPLATES, JSON.stringify(templates));
        };

        UI.renderTemplateList = () => {
            const list = refs.templateList;
            if (!list) return;
            const templates = UI._loadTemplates();
            if (templates.length === 0) {
                list.innerHTML = '<div class="ldb-tip">暂无模板，请添加</div>';
                return;
            }
            list.innerHTML = templates.map((t, i) => {
                const icon = t.icon || "📝";
                const name = Utils.escapeHtml(t.name || "未命名");
                const prompt = Utils.escapeHtml((t.prompt || "").substring(0, 50));
                return `<div class="ldb-setting-row" style="justify-content: space-between; padding: 4px 0;">
                    <span style="font-size: 12px;">${icon} <strong>${name}</strong> <span style="color: var(--ldb-ui-muted);">${prompt}${t.prompt && t.prompt.length > 50 ? "..." : ""}</span></span>
                    <button class="ldb-btn ldb-btn-secondary" data-template-delete="${i}" style="padding: 2px 6px; font-size: 11px;">删除</button>
                </div>`;
            }).join("");

            list.querySelectorAll("[data-template-delete]").forEach(btn => {
                btn.onclick = () => {
                    const idx = parseInt(btn.dataset.templateDelete);
                    const ts = UI._loadTemplates();
                    ts.splice(idx, 1);
                    UI._saveTemplates(ts);
                    UI.renderTemplateList();
                    UI.showStatus("模板已删除", "success");
                };
            });
        };

        refs.templateAddBtn.onclick = () => {
            const name = refs.templateNameInput.value.trim();
            const icon = refs.templateIconInput.value.trim() || "📝";
            const prompt = refs.templatePromptInput.value.trim();
            if (!name || !prompt) {
                UI.showStatus("请填写模板名称和 prompt", "error");
                return;
            }
            const templates = UI._loadTemplates();
            templates.push({ name, icon, prompt });
            UI._saveTemplates(templates);
            refs.templateNameInput.value = "";
            refs.templateIconInput.value = "";
            refs.templatePromptInput.value = "";
            UI.renderTemplateList();
            UI.showStatus(`模板「${name}」已添加`, "success");
        };

        UI.renderTemplateList();

        NotionOAuth.attachControls({
            root: panel,
            selectors: {
                clientIdInput: "#ldb-oauth-client-id",
                clientSecretInput: "#ldb-oauth-client-secret",
                redirectUriInput: "#ldb-oauth-redirect-uri",
                authorizeBtn: "#ldb-oauth-authorize",
                clearBtn: "#ldb-oauth-clear",
                statusEl: "#ldb-oauth-status",
            },
            notify: (message, type) => UI.showStatus(message, type),
        });
        CredentialVault.attachControls({
            root: panel,
            selectors: {
                statusEl: "#ldb-vault-status",
                unlockBtn: "#ldb-vault-unlock",
                lockBtn: "#ldb-vault-lock",
            },
            notify: (message, type) => UI.showStatus(message, type),
            onAfterSync: () => {
                syncSensitiveInputs();
            },
        });
        syncSensitiveInputs();

        // 拖拽
        UI.makeDraggable(panel, panel.querySelector(".ldb-header"));
    }
};


const UI = {
    panel: null,
    miniBtn: null,
    isMinimized: false,
    bookmarks: [],
    visualSnapshots: { linuxdo: [], github: [] },
    workspaceVisualSnapshot: { databases: [], pages: [], records: [], scannedAt: 0, maxPages: 0 },
    workspaceInsightMarkdown: "",
    workspaceInsightSummary: "",
    workspaceInsightUpdatedAt: 0,
    renderJobId: 0,
    selectedBookmarks: new Set(),
    selectedUnexportedCount: 0,
    totalUnexportedCount: 0,
    bookmarkListBound: false,
    refs: null,

    // 缓存高频节点引用
    cacheRefs: () => {
        const panel = UI.panel;
        if (!panel) {
            UI.refs = null;
            return;
        }

        UI.refs = {
            statusContainer: panel.querySelector("#ldb-status-container"),
            bookmarkList: panel.querySelector("#ldb-bookmark-list"),
            selectCount: panel.querySelector("#ldb-select-count"),
            selectAll: panel.querySelector("#ldb-select-all"),
            bookmarkCount: panel.querySelector("#ldb-bookmark-count"),
            bookmarksLabel: panel.querySelector("#ldb-bookmarks-label"),
            autoImportLabel: panel.querySelector("#ldb-auto-import-label"),
            autoImportIntervalLabel: panel.querySelector("#ldb-auto-import-interval-label"),
            exportBtn: panel.querySelector("#ldb-export"),
            obsExportBtn: panel.querySelector("#ldb-obs-export"),
            bookmarkListContainer: panel.querySelector("#ldb-bookmark-list-container"),
            reportContainer: panel.querySelector("#ldb-report-container"),
            viewSummary: panel.querySelector("#ldb-view-summary"),
            viewSubtitle: panel.querySelector("#ldb-view-subtitle"),
            viewWorkspaceSummary: panel.querySelector("#ldb-view-workspace-summary"),
            viewWorkspaceStatus: panel.querySelector("#ldb-view-workspace-status"),
            viewRefreshWorkspaceBtn: panel.querySelector("#ldb-view-refresh-workspace"),
            viewCopyWorkspaceReportBtn: panel.querySelector("#ldb-view-copy-workspace-report"),
            viewDownloadWorkspaceReportBtn: panel.querySelector("#ldb-view-download-workspace-report"),
            viewDownloadWorkspacePackageBtn: panel.querySelector("#ldb-view-download-workspace-package"),
            viewSaveWorkspacePackageBtn: panel.querySelector("#ldb-view-save-workspace-package"),
            viewSaveWorkspaceReportBtn: panel.querySelector("#ldb-view-save-workspace-report"),
            viewSaveWorkspaceCandidatesBtn: panel.querySelector("#ldb-view-save-workspace-candidates"),
            viewGenerateWorkspaceInsightBtn: panel.querySelector("#ldb-view-generate-insight"),
            viewSyncSummary: panel.querySelector("#ldb-view-sync-summary"),
            viewSyncNowBtn: panel.querySelector("#ldb-view-sync-now"),
            autoImportStatus: panel.querySelector("#ldb-auto-import-status"),
            rssFeedUrlsInput: panel.querySelector("#ldb-rss-feed-urls"),
            rssAutoImportEnabled: panel.querySelector("#ldb-rss-auto-import-enabled"),
            rssAutoImportOptions: panel.querySelector("#ldb-rss-auto-import-options"),
            rssAutoImportInterval: panel.querySelector("#ldb-rss-auto-import-interval"),
            rssAutoImportStatus: panel.querySelector("#ldb-rss-auto-import-status"),
            rssDedupModeSelect: panel.querySelector("#ldb-rss-dedup-mode"),
            bookmarkAutoImportEnabled: panel.querySelector("#ldb-bookmark-auto-import-enabled"),
            bookmarkAutoImportOptions: panel.querySelector("#ldb-bookmark-auto-import-options"),
            bookmarkAutoImportInterval: panel.querySelector("#ldb-bookmark-auto-import-interval"),
            bookmarkAutoImportStatus: panel.querySelector("#ldb-bookmark-auto-import-status"),
            sourcePartitionsToggle: panel.querySelector("#ldb-source-partitions-toggle"),
            sourcePartitionsContent: panel.querySelector("#ldb-source-partitions-content"),
            sourcePartitionsArrow: panel.querySelector("#ldb-source-partitions-arrow"),
            sourceSelectLinuxdo: panel.querySelector("#ldb-source-select-linuxdo"),
            sourceSelectGithub: panel.querySelector("#ldb-source-select-github"),
            updateCheckBtn: panel.querySelector("#ldb-update-check-btn"),
            updateAutoEnabled: panel.querySelector("#ldb-update-auto-enabled"),
            updateAutoOptions: panel.querySelector("#ldb-update-auto-options"),
            updateIntervalHours: panel.querySelector("#ldb-update-interval-hours"),
            updateCheckStatus: panel.querySelector("#ldb-update-check-status"),
            minimizeBtn: panel.querySelector("#ldb-minimize"),
            closeBtn: panel.querySelector("#ldb-close"),
            themeToggleBtn: panel.querySelector("#ldb-theme-toggle"),
            runtimeBadge: panel.querySelector("#ldb-runtime-badge"),
            tabs: panel.querySelectorAll(".ldb-tab"),
            tabContents: panel.querySelectorAll(".ldb-tab-content"),
            filterToggle: panel.querySelector("#ldb-filter-toggle"),
            filterContent: panel.querySelector("#ldb-filter-content"),
            filterArrow: panel.querySelector("#ldb-filter-arrow"),
            aiSettingsToggle: panel.querySelector("#ldb-ai-settings-toggle"),
            aiSettingsContent: panel.querySelector("#ldb-ai-settings-content"),
            aiSettingsArrow: panel.querySelector("#ldb-ai-settings-arrow"),
            githubSettingsToggle: panel.querySelector("#ldb-github-settings-toggle"),
            githubSettingsContent: panel.querySelector("#ldb-github-settings-content"),
            githubSettingsArrow: panel.querySelector("#ldb-github-settings-arrow"),
            openGithubSettingsBtn: panel.querySelector("#ldb-open-github-settings"),
            sourceSettingsToggle: panel.querySelector("#ldb-source-settings-toggle"),
            sourceSettingsContent: panel.querySelector("#ldb-source-settings-content"),
            sourceSettingsArrow: panel.querySelector("#ldb-source-settings-arrow"),
            apiKeyInput: panel.querySelector("#ldb-api-key"),
            databaseIdInput: panel.querySelector("#ldb-database-id"),
            parentPageIdInput: panel.querySelector("#ldb-parent-page-id"),
            exportTargetPageRadio: panel.querySelector("#ldb-export-target-page"),
            exportTargetDatabaseRadio: panel.querySelector("#ldb-export-target-database"),
            parentPageGroup: panel.querySelector("#ldb-parent-page-group"),
            manualDbWrap: panel.querySelector("#ldb-manual-db-wrap"),
            exportTargetTip: panel.querySelector("#ldb-export-target-tip"),
            configStatus: panel.querySelector("#ldb-config-status"),
            loadBookmarksBtn: panel.querySelector("#ldb-load-bookmarks"),
            importBrowserBookmarksBtn: panel.querySelector("#ldb-import-browser-bookmarks"),
            exportBtns: panel.querySelector("#ldb-export-btns"),
            controlBtns: panel.querySelector("#ldb-control-btns"),
            pauseBtn: panel.querySelector("#ldb-pause"),
            autoImportEnabled: panel.querySelector("#ldb-auto-import-enabled"),
            autoImportOptions: panel.querySelector("#ldb-auto-import-options"),
            autoImportInterval: panel.querySelector("#ldb-auto-import-interval"),
            linuxdoDedupModeSelect: panel.querySelector("#ldb-linuxdo-dedup-mode"),
            bookmarkDedupModeSelect: panel.querySelector("#ldb-bookmark-dedup-mode"),
            aiCategoryAutoDedupCheckbox: panel.querySelector("#ldb-ai-category-auto-dedup"),
            crossSourceModeSelect: panel.querySelector("#ldb-cross-source-mode"),
            aiServiceSelect: panel.querySelector("#ldb-ai-service"),
            aiModelSelect: panel.querySelector("#ldb-ai-model"),
            aiApiKeyInput: panel.querySelector("#ldb-ai-api-key"),
            aiBaseUrlInput: panel.querySelector("#ldb-ai-base-url"),
            aiCategoriesInput: panel.querySelector("#ldb-ai-categories"),
            workspaceMaxPagesSelect: panel.querySelector("#ldb-workspace-max-pages"),
            aiTargetDbSelect: panel.querySelector("#ldb-ai-target-db"),
            permissionLevelSelect: panel.querySelector("#ldb-permission-level"),
            requireConfirmCheckbox: panel.querySelector("#ldb-require-confirm"),
            enableAuditLogCheckbox: panel.querySelector("#ldb-enable-audit-log"),
            logPanel: panel.querySelector("#ldb-log-panel"),
            workspaceSelect: panel.querySelector("#ldb-workspace-select"),
            bookmarkExtStatus: panel.querySelector("#ldb-bookmark-ext-status"),
            selfCheckBtn: panel.querySelector("#ldb-self-check-btn"),
            copyDiagBtn: panel.querySelector("#ldb-copy-diagnostics-btn"),
            selfCheckResult: panel.querySelector("#ldb-self-check-result"),
            onlyFirstCheckbox: panel.querySelector("#ldb-only-first"),
            onlyOpCheckbox: panel.querySelector("#ldb-only-op"),
            rangeStartInput: panel.querySelector("#ldb-range-start"),
            rangeEndInput: panel.querySelector("#ldb-range-end"),
            imgModeSelect: panel.querySelector("#ldb-img-mode"),
            requestDelaySelect: panel.querySelector("#ldb-request-delay"),
            exportConcurrencySelect: panel.querySelector("#ldb-export-concurrency"),
            filterImgSelect: panel.querySelector("#ldb-filter-img"),
            filterUsersInput: panel.querySelector("#ldb-filter-users"),
            filterIncludeInput: panel.querySelector("#ldb-filter-include"),
            filterExcludeInput: panel.querySelector("#ldb-filter-exclude"),
            filterMinLenInput: panel.querySelector("#ldb-filter-minlen"),
            validateConfigBtn: panel.querySelector("#ldb-validate-config"),
            setupDatabaseBtn: panel.querySelector("#ldb-setup-database"),
            cancelBtn: panel.querySelector("#ldb-cancel"),
            agentPersonaNameInput: panel.querySelector("#ldb-agent-persona-name"),
            agentPersonaToneSelect: panel.querySelector("#ldb-agent-persona-tone"),
            agentPersonaExpertiseInput: panel.querySelector("#ldb-agent-persona-expertise"),
            agentPersonaInstructionsInput: panel.querySelector("#ldb-agent-persona-instructions"),
            agentMaxIterationsSelect: panel.querySelector("#ldb-agent-max-iterations"),
            githubUsernameInput: panel.querySelector("#ldb-github-username"),
            githubTokenInput: panel.querySelector("#ldb-github-token"),
            githubTypeCheckboxes: panel.querySelectorAll(".ldb-github-type"),
            obsSettingsToggle: panel.querySelector("#ldb-obs-settings-toggle"),
            obsSettingsContent: panel.querySelector("#ldb-obs-settings-content"),
            obsSettingsArrow: panel.querySelector("#ldb-obs-settings-arrow"),
            obsApiUrlInput: panel.querySelector("#ldb-obs-api-url"),
            obsApiKeyInput: panel.querySelector("#ldb-obs-api-key"),
            obsDirInput: panel.querySelector("#ldb-obs-dir"),
            obsImgModeSelect: panel.querySelector("#ldb-obs-img-mode"),
            obsImgDirInput: panel.querySelector("#ldb-obs-img-dir"),
            obsTestBtn: panel.querySelector("#ldb-obs-test-btn"),
            obsTestStatus: panel.querySelector("#ldb-obs-test-status"),
            toggleManualDbBtn: panel.querySelector("#ldb-toggle-manual-db"),
            refreshWorkspaceBtn: panel.querySelector("#ldb-refresh-workspace"),
            workspaceTip: panel.querySelector("#ldb-workspace-tip"),
            logToggleBtn: panel.querySelector("#ldb-log-toggle"),
            logContent: panel.querySelector("#ldb-log-content"),
            logArrow: panel.querySelector("#ldb-log-arrow"),
            logClearBtn: panel.querySelector("#ldb-log-clear"),
            aiRefreshDbsBtn: panel.querySelector("#ldb-ai-refresh-dbs"),
            aiFetchModelsBtn: panel.querySelector("#ldb-ai-fetch-models"),
            aiModelTip: panel.querySelector("#ldb-ai-model-tip"),
            aiTestBtn: panel.querySelector("#ldb-ai-test"),
            aiTestStatus: panel.querySelector("#ldb-ai-test-status"),
            templateList: panel.querySelector("#ldb-template-list"),
            templateNameInput: panel.querySelector("#ldb-template-name"),
            templateIconInput: panel.querySelector("#ldb-template-icon"),
            templatePromptInput: panel.querySelector("#ldb-template-prompt"),
            templateAddBtn: panel.querySelector("#ldb-template-add"),
        };
    },

    // 样式
    injectStyles: () => {
        DesignSystem.ensureBase();
        DesignSystem.ensureChat();
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.LINUX_DO, UI_CSS);
    },

    // 创建面板
    createPanel: () => {
        const panel = document.createElement("div");
        const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        panel.className = "ldb-panel";
        panel.setAttribute("data-ldb-root", "");
        panel.innerHTML = `
            <div class="ldb-header">
                <h3>📚 LD-Notion <span class="ldb-runtime-badge" id="ldb-runtime-badge">检测中...</span></h3>
                <div class="ldb-header-btns">
                    <button class="ldb-theme-btn" id="ldb-theme-toggle" title="切换主题">🌙</button>
                    <button class="ldb-header-btn" id="ldb-minimize" title="最小化">−</button>
                    <button class="ldb-header-btn" id="ldb-close" title="关闭">×</button>
                </div>
            </div>
            <div class="ldb-tabs">
                <button class="ldb-tab active" data-tab="bookmarks">📚 收藏</button>
                <button class="ldb-tab" data-tab="visuals">📊 视图</button>
                <button class="ldb-tab" data-tab="ai">🤖 AI</button>
                <button class="ldb-tab" data-tab="settings">⚙️ 设置</button>
            </div>
            <div class="ldb-body">
                <!-- ============ Tab 1: 收藏 ============ -->
                <div class="ldb-tab-content active" data-tab-content="bookmarks">
                    <!-- 收藏信息 -->
                    <div class="ldb-section">
                        <div class="ldb-bookmarks-info">
                            <div class="ldb-bookmarks-count" id="ldb-bookmark-count">-</div>
                            <div class="ldb-bookmarks-label" id="ldb-bookmarks-label">已加载收藏数量</div>
                        </div>

                        <div class="ldb-toggle-section" id="ldb-source-partitions-toggle" style="margin-top: 10px; margin-bottom: 8px;">
                            <span>收藏来源分区</span>
                            <span class="ldb-arrow" id="ldb-source-partitions-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-source-partitions-content" class="ldb-mb-8">
                            <div class="ldb-source-option-group">
                                <button class="ldb-source-option" id="ldb-source-select-linuxdo" type="button">Linux.do 收藏分区</button>
                                <button class="ldb-source-option" id="ldb-source-select-github" type="button">GitHub 收藏分区</button>
                            </div>
                        </div>

                        <div class="ldb-toggle-section" id="ldb-source-settings-toggle" class="ldb-mb-8">
                            <span>来源自动化设置</span>
                            <span class="ldb-arrow" id="ldb-source-settings-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-source-settings-content" class="ldb-mb-8">
                            <div class="ldb-setting-row" class="ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="checkbox" id="ldb-auto-import-enabled">
                                    <span id="ldb-auto-import-label">启用自动导入新收藏</span>
                                </label>
                            </div>
                            <div id="ldb-auto-import-options" style="display: none; margin-bottom: 8px;">
                                <div class="ldb-setting-row" class="ldb-flex-center-gap">
                                    <label id="ldb-auto-import-interval-label" style="white-space: nowrap;">轮询间隔</label>
                                    <select id="ldb-auto-import-interval" class="ldb-input" class="ldb-flex-1">
                                        <option value="0">仅页面加载时</option>
                                        <option value="3">每 3 分钟</option>
                                        <option value="5" selected>每 5 分钟</option>
                                        <option value="10">每 10 分钟</option>
                                        <option value="30">每 30 分钟</option>
                                    </select>
                                </div>
                            </div>
                            <div class="ldb-setting-row" class="ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="checkbox" id="ldb-bookmark-auto-import-enabled">
                                    <span>启用浏览器书签自动同步</span>
                                </label>
                            </div>
                            <div id="ldb-bookmark-auto-import-options" style="display: none; margin-bottom: 8px;">
                                <div class="ldb-setting-row" class="ldb-flex-center-gap">
                                    <label for="ldb-bookmark-auto-import-interval" style="white-space: nowrap;">书签同步间隔</label>
                                    <select id="ldb-bookmark-auto-import-interval" class="ldb-input" class="ldb-flex-1">
                                        <option value="0">仅页面加载时</option>
                                        <option value="3">每 3 分钟</option>
                                        <option value="5" selected>每 5 分钟</option>
                                        <option value="10">每 10 分钟</option>
                                        <option value="30">每 30 分钟</option>
                                    </select>
                                </div>
                            </div>
                            <div id="ldb-bookmark-auto-import-status" style="font-size: 12px; color: #666; margin-bottom: 8px;"></div>
                            <div class="ldb-setting-row" class="ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="checkbox" id="ldb-rss-auto-import-enabled">
                                    <span>启用 RSS 自动同步</span>
                                </label>
                            </div>
                            <div id="ldb-rss-auto-import-options" style="display: none; margin-bottom: 8px;">
                                <div class="ldb-setting-row" style="margin-bottom: 8px;">
                                    <label for="ldb-rss-feed-urls" style="display: block; margin-bottom: 6px;">RSS Feed URL</label>
                                    <textarea id="ldb-rss-feed-urls" class="ldb-input" rows="3" placeholder="每行一个 RSS / Atom 地址，或用逗号分隔"></textarea>
                                </div>
                                <div class="ldb-setting-row" class="ldb-flex-center-gap ldb-mb-8">
                                    <label for="ldb-rss-auto-import-interval" style="white-space: nowrap;">RSS 同步间隔</label>
                                    <select id="ldb-rss-auto-import-interval" class="ldb-input" class="ldb-flex-1">
                                        <option value="0">仅页面加载时</option>
                                        <option value="3">每 3 分钟</option>
                                        <option value="5" selected>每 5 分钟</option>
                                        <option value="10">每 10 分钟</option>
                                        <option value="30">每 30 分钟</option>
                                    </select>
                                </div>
                                <div class="ldb-setting-row" class="ldb-flex-center-gap ldb-mb-8">
                                    <label for="ldb-rss-dedup-mode" style="white-space: nowrap;">RSS 导入去重</label>
                                    <select id="ldb-rss-dedup-mode" class="ldb-input" class="ldb-flex-1">
                                        <option value="strict">按链接去重</option>
                                        <option value="allow_duplicates">按 Feed + ID 保留重复</option>
                                    </select>
                                </div>
                            </div>
                            <div id="ldb-rss-auto-import-status" style="font-size: 12px; color: #666; margin-bottom: 8px;"></div>
                            <div class="ldb-setting-row" class="ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-linuxdo-dedup-mode" style="white-space: nowrap;">Linux.do 导入去重</label>
                                <select id="ldb-linuxdo-dedup-mode" class="ldb-input" class="ldb-flex-1">
                                    <option value="strict">自动去重</option>
                                    <option value="allow_duplicates">允许重复（手动勾选）</option>
                                </select>
                            </div>
                            <div class="ldb-setting-row" class="ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-bookmark-dedup-mode" style="white-space: nowrap;">书签导入去重</label>
                                <select id="ldb-bookmark-dedup-mode" class="ldb-input" class="ldb-flex-1">
                                    <option value="strict">自动去重</option>
                                    <option value="allow_duplicates">允许重复（手动勾选）</option>
                                </select>
                            </div>
                            <div class="ldb-setting-row" class="ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                    <input type="checkbox" id="ldb-ai-category-auto-dedup" checked>
                                    <span>分类列表自动去重</span>
                                </label>
                            </div>
                            <div class="ldb-setting-row" class="ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-cross-source-mode" style="white-space: nowrap;">跨源存储模式</label>
                                <select id="ldb-cross-source-mode" class="ldb-input" class="ldb-flex-1">
                                    <option value="separate">分库（各来源独立数据库）</option>
                                    <option value="unified">统一库（所有来源同一数据库）</option>
                                </select>
                            </div>
                            <div id="ldb-auto-import-status" style="font-size: 12px; color: #666; margin-bottom: 8px;"></div>

                            <div class="ldb-setting-row" class="ldb-flex-center-gap ldb-mb-8">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-update-check-btn" style="padding: 6px 10px;">检查更新</button>
                                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
                                    <input type="checkbox" id="ldb-update-auto-enabled">
                                    <span>自动检查更新</span>
                                </label>
                            </div>
                            <div id="ldb-update-auto-options" style="display: none; margin-bottom: 8px;">
                                <div class="ldb-setting-row" class="ldb-flex-center-gap">
                                    <label for="ldb-update-interval-hours" style="white-space: nowrap;">检查间隔</label>
                                    <select id="ldb-update-interval-hours" class="ldb-input" class="ldb-flex-1">
                                        <option value="24">每 24 小时</option>
                                        <option value="72">每 72 小时</option>
                                        <option value="168">每 168 小时</option>
                                    </select>
                                </div>
                            </div>
                            <div id="ldb-update-check-status" style="font-size: 12px; color: #666; margin-bottom: 4px;"></div>
                        </div>

                        <div class="ldb-btn-group" style="margin-bottom: 12px;">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-load-bookmarks">
                                🔄 加载收藏列表
                            </button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-import-browser-bookmarks">
                                📖 导入浏览器书签
                            </button>
                        </div>

                        <!-- 收藏列表 (加载后显示) -->
                        <div id="ldb-bookmark-list-container" style="display: none;">
                            <div class="ldb-select-all">
                                <label>
                                    <input type="checkbox" id="ldb-select-all" checked>
                                    <span>全选/取消</span>
                                </label>
                                <span class="ldb-select-count" id="ldb-select-count">已选 0 个</span>
                            </div>
                            <div class="ldb-bookmark-list" id="ldb-bookmark-list"></div>
                        </div>

                        <!-- 导出按钮组 -->
                        <div class="ldb-btn-group" id="ldb-export-btns">
                            <button class="ldb-btn ldb-btn-primary" id="ldb-export" disabled>
                                📤 开始导出
                            </button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-obs-export" disabled>
                                📝 导出到 Obsidian
                            </button>
                        </div>

                        <!-- 控制按钮 (导出时显示) -->
                        <div class="ldb-control-btns" id="ldb-control-btns" style="display: none;">
                            <button class="ldb-btn ldb-btn-warning ldb-btn-small" id="ldb-pause">
                                ⏸️ 暂停
                            </button>
                            <button class="ldb-btn ldb-btn-danger ldb-btn-small" id="ldb-cancel">
                                ⏹️ 取消
                            </button>
                        </div>
                    </div>

                    <!-- 状态显示 -->
                    <div id="ldb-status-container"></div>

                    <!-- 导出报告 -->
                    <div id="ldb-report-container"></div>
                </div>

                <!-- ============ Tab 2: 视图 ============ -->
                <div class="ldb-tab-content" data-tab-content="visuals">
                    <div class="ldb-section">
                        <div class="ldb-view-header">
                            <div>
                                <div class="ldb-section-title" style="margin-bottom: 4px;">工作区视图</div>
                                <div class="ldb-tip" id="ldb-view-subtitle">刷新后会基于当前 Notion 工作区数据库生成全局时间线、来源关系图和导出漏斗；下方继续保留本轮已加载摘要。</div>
                            </div>
                            <div class="ldb-view-actions">
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-refresh-workspace" type="button">刷新工作区视图</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-generate-insight" type="button">生成洞察</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-save-workspace-candidates" type="button">保存候选</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-save-workspace-package" type="button">保存协作包</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-save-workspace-report" type="button">保存到 Notion</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-copy-workspace-report" type="button">复制报告</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-download-workspace-report" type="button">下载报告</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-download-workspace-package" type="button">下载协作包</button>
                            </div>
                        </div>
                        <div class="ldb-view-status" id="ldb-view-workspace-status">尚未刷新工作区视图。</div>
                        <div class="ldb-view-summary" id="ldb-view-workspace-summary">
                            <div class="ldb-view-empty">
                                <div class="ldb-view-empty-title">工作区总览还没有数据</div>
                                <div class="ldb-view-empty-text">点击上方按钮后，会扫描当前工作区数据库里的页面属性，生成全局时间线、来源关系图和导出漏斗。</div>
                            </div>
                        </div>
                        <div class="ldb-view-subsection">
                            <div class="ldb-view-header">
                                <div>
                                    <div class="ldb-view-section-title">统一同步中心</div>
                                    <div class="ldb-tip">统一查看 Linux.do、GitHub 与浏览器书签三条增量同步链的启用状态、增量基线和最近一次成功结果。</div>
                                </div>
                                <div class="ldb-view-actions">
                                    <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-sync-now" type="button">立即同步全部</button>
                                </div>
                            </div>
                            <div class="ldb-view-summary" id="ldb-view-sync-summary">
                                <div class="ldb-view-empty">
                                    <div class="ldb-view-empty-title">统一同步中心还没有摘要</div>
                                    <div class="ldb-view-empty-text">启用任一自动同步来源后，这里会展示轮询策略、增量水位线和最近成功时间。</div>
                                </div>
                            </div>
                        </div>
                        <div class="ldb-view-subsection">
                            <div class="ldb-view-section-title">本轮已加载摘要</div>
                            <div class="ldb-view-summary" id="ldb-view-summary">
                                <div class="ldb-view-empty">
                                    <div class="ldb-view-empty-title">视图还没有数据</div>
                                    <div class="ldb-view-empty-text">先加载 Linux.do 或 GitHub 收藏，这里会展示来源分布、导出状态和时间线摘要。</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ============ Tab 3: AI 助手 ============ -->
                <div class="ldb-tab-content" data-tab-content="ai">
                    <div class="ldb-section">
                        <!-- 对话区域 -->
                        <div class="ldb-chat-container" id="ldb-chat-messages">
                            ${AIWelcomeUI.render(personaName)}
                        </div>

                        <!-- 输入区域 -->
                        <div class="ldb-chat-input-container">
                            <textarea
                                id="ldb-chat-input"
                                class="ldb-chat-input"
                                placeholder="${Utils.escapeHtml(AIWelcomeUI.getInputPlaceholder())}"
                                rows="1"
                            ></textarea>
                            <button id="ldb-chat-send" class="ldb-chat-send-btn">发送</button>
                        </div>

                        <!-- 快捷操作 -->
                        <div class="ldb-chat-actions">
                            <button class="ldb-chat-action-btn" id="ldb-chat-clear">🗑️ 清空</button>
                        </div>
                    </div>
                </div>

                <!-- ============ Tab 4: 设置 ============ -->
                <div class="ldb-tab-content" data-tab-content="settings">
                    <!-- Notion 配置 -->
                    <div class="ldb-section">
                        <div class="ldb-section-title">Notion 配置</div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">API Key</label>
                            <input type="password" class="ldb-input" id="ldb-api-key" placeholder="secret_xxx...">
                            <div class="ldb-tip">
                                在 <a href="https://www.notion.so/my-integrations" target="_blank" class="ldb-link">Notion Integrations</a> 创建
                            </div>
                        </div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">公开 OAuth 授权（可选）</label>
                            <input type="text" class="ldb-input" id="ldb-oauth-client-id" placeholder="Client ID">
                            <input type="password" class="ldb-input" id="ldb-oauth-client-secret" placeholder="Client Secret" class="ldb-mt-8">
                            <input type="text" class="ldb-input" id="ldb-oauth-redirect-uri" placeholder="Redirect URI" class="ldb-mt-8">
                            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                <button class="ldb-btn ldb-btn-primary" id="ldb-oauth-authorize">🔐 一键授权</button>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-oauth-clear">断开授权</button>
                            </div>
                            <div class="ldb-tip" id="ldb-oauth-status" style="margin-top: 6px;"></div>
                            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-vault-unlock">解锁保险箱</button>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-vault-lock">锁定</button>
                            </div>
                            <div class="ldb-tip" id="ldb-vault-status" style="margin-top: 6px;"></div>
                            <div class="ldb-tip">如果你使用 Notion 公开集成，请先把 Redirect URI 加到集成配置里，再点击一键授权。敏感凭证会保存在本地加密保险箱中。</div>
                        </div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">数据库 / 页面</label>
                            <div class="ldb-flex-gap">
                                <select class="ldb-select" id="ldb-workspace-select" class="ldb-flex-1">
                                    <option value="">-- 从工作区选择 --</option>
                                </select>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-refresh-workspace" class="ldb-nowrap-badge" title="刷新工作区页面列表">🔄</button>
                            </div>
                            <div class="ldb-input-group" id="ldb-manual-db-wrap" style="display: none; margin-top: 8px;">
                                <input type="text" class="ldb-input" id="ldb-database-id" placeholder="手动输入 32 位数据库 ID（高级）" class="ldb-flex-1">
                            </div>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-toggle-manual-db" style="margin-top: 6px; padding: 4px 10px; font-size: 12px;">高级：手动输入数据库 ID</button>
                            <div class="ldb-tip" id="ldb-workspace-tip">
                                优先从工作区列表选择，无法加载时再手动输入
                            </div>
                        </div>

                        <!-- 导出目标类型选择 -->
                        <div class="ldb-input-group">
                            <label class="ldb-label">导出目标</label>
                            <div class="ldb-checkbox-group" class="ldb-mb-8">
                                <label class="ldb-checkbox-item">
                                    <input type="radio" name="ldb-export-target" id="ldb-export-target-database" value="database" checked>
                                    <span>数据库（推荐）</span>
                                </label>
                                <label class="ldb-checkbox-item">
                                    <input type="radio" name="ldb-export-target" id="ldb-export-target-page" value="page">
                                    <span>页面（子页面）</span>
                                </label>
                            </div>
                            <div class="ldb-tip" id="ldb-export-target-tip">
                                导出为数据库条目，支持筛选和排序
                            </div>
                        </div>

                        <!-- 父页面 ID（页面模式时显示） -->
                        <div class="ldb-input-group" id="ldb-parent-page-group" style="display: none;">
                            <label class="ldb-label">父页面 ID</label>
                            <input type="text" class="ldb-input" id="ldb-parent-page-id" placeholder="32位页面ID">
                            <div class="ldb-tip">
                                帖子将作为子页面创建在此页面下
                            </div>
                        </div>

                        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-validate-config">验证配置</button>
                            <button class="ldb-btn ldb-btn-primary" id="ldb-setup-database" title="自动在数据库中创建所需属性">自动设置数据库</button>
                            <span id="ldb-config-status" style="font-size: 12px; margin-left: 4px;"></span>
                        </div>

                        <!-- 权限设置 -->
                        <div class="ldb-permission-panel" class="ldb-mt-12">
                            <div class="ldb-permission-row">
                                <span class="ldb-permission-label">权限级别</span>
                                <select class="ldb-permission-select" id="ldb-permission-level">
                                    <option value="0">只读</option>
                                    <option value="1">标准</option>
                                    <option value="2">高级</option>
                                    <option value="3">管理员</option>
                                </select>
                            </div>
                            <div class="ldb-permission-row">
                                <span class="ldb-permission-label">危险操作确认</span>
                                <label class="ldb-toggle-switch">
                                    <input type="checkbox" id="ldb-require-confirm" checked>
                                    <span class="ldb-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="ldb-permission-row">
                                <span class="ldb-permission-label">审计日志</span>
                                <label class="ldb-toggle-switch">
                                    <input type="checkbox" id="ldb-enable-audit-log" checked>
                                    <span class="ldb-toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 筛选设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-filter-toggle">
                            <span class="ldb-section-title" style="margin-bottom: 0;">筛选设置</span>
                            <span id="ldb-filter-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-filter-content">
                            <div class="ldb-input-group" class="ldb-mt-12">
                                <div class="ldb-checkbox-group">
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" id="ldb-only-first">
                                        <span>仅主楼</span>
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" id="ldb-only-op">
                                        <span>仅楼主</span>
                                    </label>
                                </div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">楼层范围</label>
                                <div class="ldb-range-group">
                                    <input type="number" id="ldb-range-start" value="1" min="1">
                                    <span>至</span>
                                    <input type="number" id="ldb-range-end" value="999999" min="1">
                                </div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片处理</label>
                                <select class="ldb-select" id="ldb-img-mode">
                                    <option value="upload">上传到 Notion</option>
                                    <option value="external">外链引用</option>
                                    <option value="skip">跳过图片</option>
                                </select>
                                <div class="ldb-tip">Notion 免费套餐文件需小于 5MB；付费套餐 PDF 小于 20MB、图片小于 5MB。若图片上传报错，脚本会自动尝试按文件上传。</div>
                            </div>
                            <div class="ldb-form-group">
                                <label>请求间隔</label>
                                <select class="ldb-select" id="ldb-request-delay">
                                    <option value="200">快速 (200ms)</option>
                                    <option value="500">正常 (500ms)</option>
                                    <option value="1000">慢速 (1秒)</option>
                                    <option value="2000">较慢 (2秒)</option>
                                    <option value="3000">很慢 (3秒)</option>
                                    <option value="5000">超慢 (5秒)</option>
                                    <option value="10000">极慢 (10秒)</option>
                                    <option value="30000">龟速 (30秒)</option>
                                </select>
                            </div>
                            <div class="ldb-form-group">
                                <label>并发数</label>
                                <select class="ldb-select" id="ldb-export-concurrency">
                                    <option value="1">串行 (1个)</option>
                                    <option value="2">2 个并发</option>
                                    <option value="3">3 个并发</option>
                                    <option value="5">5 个并发</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片筛选</label>
                                <select class="ldb-select" id="ldb-filter-img">
                                    <option value="all">全部</option>
                                    <option value="only_img">仅含图楼层</option>
                                    <option value="no_img">仅无图楼层</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">指定用户</label>
                                <input type="text" class="ldb-input" id="ldb-filter-users" placeholder="user1, user2">
                                <div class="ldb-tip">逗号分隔，仅导出这些用户的回复</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">包含关键词</label>
                                <input type="text" class="ldb-input" id="ldb-filter-include" placeholder="教程, 指南">
                                <div class="ldb-tip">逗号分隔，必须包含任一关键词</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">排除关键词</label>
                                <input type="text" class="ldb-input" id="ldb-filter-exclude" placeholder="广告, 水贴">
                                <div class="ldb-tip">逗号分隔，排除包含关键词的楼层</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">最少字数</label>
                                <input type="number" class="ldb-input" id="ldb-filter-minlen" value="0" min="0" placeholder="0">
                                <div class="ldb-tip">过滤字数不足的楼层</div>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- AI 设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-ai-settings-toggle">
                            <span class="ldb-section-title" style="margin-bottom: 0;">AI 设置</span>
                            <span id="ldb-ai-settings-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-ai-settings-content">
                            <div class="ldb-input-group" class="ldb-mt-12">
                                <label class="ldb-label">AI 服务</label>
                                <select class="ldb-select" id="ldb-ai-service">
                                    <option value="openai">OpenAI</option>
                                    <option value="claude">Claude</option>
                                    <option value="gemini">Gemini</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">模型</label>
                                <div class="ldb-flex-gap">
                                    <select class="ldb-select" id="ldb-ai-model" class="ldb-flex-1"></select>
                                    <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-fetch-models" class="ldb-nowrap-badge">🔄 获取</button>
                                </div>
                                <div class="ldb-tip" id="ldb-ai-model-tip"></div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">API Key</label>
                                <input type="password" class="ldb-input" id="ldb-ai-api-key" placeholder="AI 服务的 API Key">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">自定义端点 (可选)</label>
                                <input type="text" class="ldb-input" id="ldb-ai-base-url" placeholder="留空使用官方 API">
                                <div class="ldb-tip">支持第三方 OpenAI 兼容 API</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">分类列表</label>
                                <input type="text" class="ldb-input" id="ldb-ai-categories" placeholder="技术, 生活, 问答, 分享, 资源, 其他">
                                <div class="ldb-tip">逗号分隔，用于自动分类功能</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">查询数据库</label>
                                <div class="ldb-flex-gap">
                                    <select class="ldb-select" id="ldb-ai-target-db" class="ldb-flex-1">
                                        <option value="">当前配置的数据库</option>
                                        <option value="__all__">所有工作区数据库</option>
                                    </select>
                                    <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-refresh-dbs" class="ldb-nowrap-badge">🔄</button>
                                </div>
                                <div class="ldb-tip">AI 查询数据库时的目标范围</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">刷新页数上限</label>
                                <select class="ldb-select" id="ldb-workspace-max-pages">
                                    <option value="5">5 页 (500 条)</option>
                                    <option value="10">10 页 (1000 条)</option>
                                    <option value="20">20 页 (2000 条)</option>
                                    <option value="50">50 页 (5000 条)</option>
                                    <option value="0">无限制</option>
                                </select>
                                <div class="ldb-tip">刷新工作区列表时每类的最大分页数</div>
                            </div>
                            <div class="ldb-btn-group" class="ldb-flex-center-gap">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-test">测试连接</button>
                                <span id="ldb-ai-test-status" style="font-size: 12px;"></span>
                            </div>

                            <!-- AI 输出模板管理 -->
                            <div class="ldb-section-divider">
                                <span class="ldb-hint">📋 AI 输出模板</span>
                            </div>
                            <div id="ldb-template-list" style="margin-bottom: 8px;"></div>
                            <div class="ldb-setting-row" class="ldb-flex-center-gap ldb-mb-8">
                                <input type="text" class="ldb-input" id="ldb-template-name" placeholder="模板名称" style="width: 80px;">
                                <input type="text" class="ldb-input" id="ldb-template-icon" placeholder="图标" style="width: 50px;">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-template-add" style="padding: 4px 8px; font-size: 12px;">添加</button>
                            </div>
                            <div class="ldb-input-group" style="margin-bottom: 4px;">
                                <textarea class="ldb-input" id="ldb-template-prompt" rows="2" placeholder="模板 prompt，用于 AI 生成内容" style="resize: vertical;"></textarea>
                            </div>
                            <div class="ldb-tip">添加后可在 AI 对话中使用「用xx模板总结xxx页面」</div>

                            <!-- Agent 个性化设置 -->
                            <div class="ldb-section-divider">
                                <span class="ldb-hint">🤖 Agent 个性化</span>
                            </div>
                            <div class="ldb-input-group" class="ldb-mt-8">
                                <label class="ldb-label">助手名字</label>
                                <input type="text" class="ldb-input" id="ldb-agent-persona-name" placeholder="AI 助手">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">语气风格</label>
                                <select class="ldb-select" id="ldb-agent-persona-tone">
                                    <option value="友好">友好</option>
                                    <option value="专业">专业</option>
                                    <option value="幽默">幽默</option>
                                    <option value="简洁">简洁</option>
                                    <option value="热情">热情</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">专业领域</label>
                                <input type="text" class="ldb-input" id="ldb-agent-persona-expertise" placeholder="Notion 工作区管理">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">自定义指令 (可选)</label>
                                <textarea class="ldb-input" id="ldb-agent-persona-instructions" rows="2" placeholder="额外的行为指令，如：总是用列表格式回复" style="resize: vertical;"></textarea>
                                <div class="ldb-tip">Agent 每次对话都会遵循的个性化指令</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">Agent 最大执行步数</label>
                                <select class="ldb-select" id="ldb-agent-max-iterations">
                                    <option value="4">4 步 (快速)</option>
                                    <option value="8" selected>8 步 (默认)</option>
                                    <option value="12">12 步 (深入)</option>
                                    <option value="16">16 步 (复杂任务)</option>
                                    <option value="24">24 步 (极限)</option>
                                </select>
                                <div class="ldb-tip">Agent 循环的最大工具调用次数</div>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- GitHub 收藏导入设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-github-settings-toggle">
                            <span class="ldb-section-title" style="margin-bottom: 0;">🐙 GitHub 导入</span>
                            <span id="ldb-github-settings-arrow">▶</span>
                        </div>
                        <div style="margin-top: 8px; margin-bottom: 6px;">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-open-github-settings" style="padding: 6px 10px; font-size: 12px;">
                                🎯 一键定位 GitHub Token
                            </button>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-github-settings-content">
                            <div class="ldb-input-group" class="ldb-mt-12">
                                <label class="ldb-label">GitHub 用户名</label>
                                <input type="text" class="ldb-input" id="ldb-github-username" placeholder="your-username">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">GitHub Token (可选)</label>
                                <input type="password" class="ldb-input" id="ldb-github-token" placeholder="ghp_xxx...">
                                <div class="ldb-tip">不填写也可使用，但有速率限制</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">导入类型</label>
                                <div class="ldb-checkbox-group" style="margin-top: 4px;">
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="stars" checked> ⭐ Stars
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="repos"> 📦 Repos
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="forks"> 🍴 Forks
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="gists"> 📝 Gists
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- Obsidian 导出设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-obs-settings-toggle">
                            <span class="ldb-section-title" style="margin-bottom: 0;">📝 Obsidian 导出</span>
                            <span id="ldb-obs-settings-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-obs-settings-content">
                            <div class="ldb-input-group" class="ldb-mt-12">
                                <label class="ldb-label">API 地址</label>
                                <input type="text" class="ldb-input" id="ldb-obs-api-url" placeholder="https://127.0.0.1:27124">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">API Key</label>
                                <input type="password" class="ldb-input" id="ldb-obs-api-key" placeholder="Obsidian Local REST API Key">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">导出目录</label>
                                <input type="text" class="ldb-input" id="ldb-obs-dir" placeholder="Linux.do">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片模式</label>
                                <select class="ldb-select" id="ldb-obs-img-mode">
                                    <option value="file">保存图片并引用</option>
                                    <option value="base64">Base64 内嵌</option>
                                    <option value="skip">不导出图片</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片目录</label>
                                <input type="text" class="ldb-input" id="ldb-obs-img-dir" placeholder="Linux.do/attachments">
                                <div class="ldb-tip">仅"保存图片并引用"模式有效</div>
                            </div>
                            <div style="margin-top: 8px;">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-obs-test-btn" style="padding: 6px 10px; font-size: 12px;">🔗 测试连接</button>
                                <span id="ldb-obs-test-status" style="font-size: 12px; margin-left: 8px;"></span>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 浏览器书签导入 -->
                    <div class="ldb-section">
                        <div style="font-size: 13px; font-weight: 700; color: var(--ldb-ui-text);">📖 浏览器书签</div>
                        <div id="ldb-bookmark-ext-status" style="font-size: 11px; margin-top: 4px; color: var(--ldb-ui-muted);"></div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 运行自检 -->
                    <div class="ldb-section">
                        <div style="font-size: 13px; font-weight: 700; color: var(--ldb-ui-text);">🩺 运行自检</div>
                        <div class="ldb-btn-group" style="margin-top: 8px; margin-bottom: 8px;">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-self-check-btn" style="padding: 6px 10px; font-size: 12px;">执行自检</button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-copy-diagnostics-btn" style="padding: 6px 10px; font-size: 12px;">复制诊断信息</button>
                        </div>
                        <div id="ldb-self-check-result" class="ldb-hint"></div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 操作日志面板 -->
                    <div class="ldb-log-panel" id="ldb-log-panel">
                        <div class="ldb-log-header" id="ldb-log-toggle">
                            <span class="ldb-log-title">
                                📋 操作日志
                                <span class="ldb-log-badge" id="ldb-log-count">0</span>
                            </span>
                            <span id="ldb-log-arrow">▶</span>
                        </div>
                        <div class="ldb-log-content collapsed" id="ldb-log-content">
                            <div id="ldb-log-list"></div>
                            <div class="ldb-log-actions">
                                <button class="ldb-log-clear-btn" id="ldb-log-clear">清除日志</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        UI.panel = panel;
        UI.cacheRefs();

        // 绑定事件
        UI.bindEvents();

        // 加载保存的配置
        UI.loadConfig();
    },

    // 创建最小化按钮
    createMiniButton: () => {
        const btn = document.createElement("button");
        btn.className = "ldb-mini-btn";
        btn.setAttribute("data-ldb-root", "");
        btn.innerHTML = "📚";
        btn.title = "打开收藏导出工具";
        btn.style.display = "none";

        btn.onclick = () => {
            UI.panel.style.display = "block";
            btn.style.display = "none";
            Storage.set(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, false);
        };

        document.body.appendChild(btn);
        return btn;
    },


    // 绑定事件
    bindEvents: UIEvents.bindEvents,

    // 加载配置
    loadConfig: () => {
        const panel = UI.panel;
        const refs = UI.refs || {};
        const exportState = TargetState.getExportState();

        refs.apiKeyInput.value = "";
        refs.databaseIdInput.value = exportState.databaseId;
        refs.parentPageIdInput.value = exportState.parentPageId;
        refs.onlyFirstCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, CONFIG.DEFAULTS.onlyFirst);
        refs.onlyOpCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, CONFIG.DEFAULTS.onlyOp);
        refs.rangeStartInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, CONFIG.DEFAULTS.rangeStart);
        refs.rangeEndInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, CONFIG.DEFAULTS.rangeEnd);
        refs.imgModeSelect.value = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
        refs.requestDelaySelect.value = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        refs.exportConcurrencySelect.value = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY, CONFIG.DEFAULTS.exportConcurrency);
        refs.filterImgSelect.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_IMG, CONFIG.DEFAULTS.imgFilter);
        refs.filterUsersInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_USERS, CONFIG.DEFAULTS.filterUsers);
        refs.filterIncludeInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_INCLUDE, CONFIG.DEFAULTS.filterInclude);
        refs.filterExcludeInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_EXCLUDE, CONFIG.DEFAULTS.filterExclude);
        refs.filterMinLenInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_MINLEN, CONFIG.DEFAULTS.filterMinLen);

        // 加载导出目标类型设置
        const exportTargetType = exportState.targetType;
        if (exportTargetType === "page") {
            refs.exportTargetPageRadio.checked = true;
            refs.parentPageGroup.style.display = "block";
            refs.manualDbWrap.style.display = "none";
            refs.exportTargetTip.textContent = "导出为子页面，包含完整内容";
        } else {
            refs.exportTargetDatabaseRadio.checked = true;
            refs.parentPageGroup.style.display = "none";
            refs.exportTargetTip.textContent = "导出为数据库条目，支持筛选和排序";
        }

        // 加载权限设置
        refs.permissionLevelSelect.value = Storage.get(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, CONFIG.DEFAULTS.permissionLevel);
        refs.requireConfirmCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, CONFIG.DEFAULTS.requireConfirm);
        refs.enableAuditLogCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);

        // 根据审计日志设置更新面板可见性
        const enableAuditLog = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
        const logPanel = refs.logPanel
        if (logPanel) {
            logPanel.style.display = enableAuditLog ? "block" : "none";
        }

        // 加载 AI 分类设置
        const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
        refs.aiServiceSelect.value = aiService;

        // 验证并加载 AI 模型（优先使用缓存的模型列表）
        const savedModel = Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
        const modelSelect = refs.aiModelSelect

        const validModels = AIService.getAvailableModels(aiService);
        UI.updateAIModelOptions(aiService, validModels.length > 0 ? validModels : undefined);

        if (savedModel) {
            // 检查保存的模型是否在下拉框选项中存在
            const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
            if (optionExists || validModels.includes(savedModel)) {
                // 存储的模型可用，直接设置
                modelSelect.value = savedModel;
            } else {
                // 存储的模型不兼容当前服务，重置为默认模型
                const defaultModel = provider?.defaultModel || "";
                modelSelect.value = defaultModel;
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, defaultModel);
                console.warn(`[LD-Notion] AI 模型 "${savedModel}" 与当前服务 "${aiService}" 不兼容，已重置为默认模型`);
            }
        }

        refs.aiApiKeyInput.value = "";
        refs.aiBaseUrlInput.value = Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, CONFIG.DEFAULTS.aiBaseUrl);
        refs.aiCategoriesInput.value = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories);
        refs.workspaceMaxPagesSelect.value = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages);

        // 加载 Agent 个性化设置
        refs.agentPersonaNameInput.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        refs.agentPersonaToneSelect.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone);
        refs.agentPersonaExpertiseInput.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise);
        refs.agentPersonaInstructionsInput.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions);
        refs.agentMaxIterationsSelect.value = String(Storage.get(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS, CONFIG.DEFAULTS.agentMaxIterations));

        // 加载 GitHub 设置
        refs.githubUsernameInput.value = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
        refs.githubTokenInput.value = "";
        // 加载 GitHub 导入类型
        const savedGHTypesMain = GitHubAPI.getImportTypes();
        refs.githubTypeCheckboxes.forEach(cb => {
            cb.checked = savedGHTypesMain.includes(cb.value);
        });

        // 加载 Obsidian 设置
        refs.obsApiUrlInput.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_API_URL, CONFIG.DEFAULTS.obsApiUrl);
        refs.obsApiKeyInput.value = "";
        refs.obsDirInput.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_DIR, CONFIG.DEFAULTS.obsDir);
        refs.obsImgModeSelect.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_IMG_MODE, CONFIG.DEFAULTS.obsImgMode);
        refs.obsImgDirInput.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_IMG_DIR, CONFIG.DEFAULTS.obsImgDir);

        const source = UI.getActiveBookmarkSource();
        UI.applyBookmarkSourceUI(source);

        // 书签扩展状态
        const bmStatusMain = refs.bookmarkExtStatus
        if (bmStatusMain) {
            if (BookmarkBridge.isExtensionAvailable()) {
                const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
                if (isUserscriptMode) {
                    bmStatusMain.innerHTML = '<span style="color: #4ade80;">✅ 桥接已就绪（Userscript 模式）</span> — 可用「📖 导入浏览器书签」按钮';
                } else {
                    bmStatusMain.innerHTML = '<span style="color: #4ade80;">✅ 书签能力已就绪（Extension 模式）</span> — 可用「📖 导入浏览器书签」按钮';
                }
            } else {
                bmStatusMain.innerHTML = `<span style="color: #f87171;">❌ 扩展未安装</span> — ${InstallHelper.renderInstallLink("一键安装浏览器扩展")}`;
            }
        }
        UI.renderSelfCheckResult();

        // 加载 AI 查询目标数据库设置
        const cachedWorkspaceForDb = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
        try {
            const wsData = JSON.parse(cachedWorkspaceForDb);
            UI.updateAITargetDbOptions(wsData.databases || []);
        } catch {
            UI.updateAITargetDbOptions([]);
        }

        // 初始化日志面板
        UI.updateLogPanel();

        // 加载缓存的工作区页面列表（校验 API Key）
        const cachedWorkspace = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
        try {
            const workspaceData = JSON.parse(cachedWorkspace);
            const currentApiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
            const currentKeyHash = currentApiKey ? currentApiKey.slice(-8) : "";
            // 仅当 API Key 匹配时才显示缓存
            if (workspaceData.apiKeyHash === currentKeyHash &&
                (workspaceData.databases?.length > 0 || workspaceData.pages?.length > 0)) {
                UI.updateWorkspaceSelect(workspaceData);
            }
        } catch { /* workspace cache invalid, will refresh */ }

        // 加载自动导入设置
        const savedSource = Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, CONFIG.DEFAULTS.bookmarkSource);
        const resolvedSource = savedSource === "github" ? "github" : "linuxdo";
        Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, resolvedSource);
        UI.applyBookmarkSourceUI(resolvedSource);

        const autoConfig = UI.getAutoImportConfigBySource();
        const autoImportEnabled = Storage.get(autoConfig.enabledKey, autoConfig.enabledDefault);
        refs.autoImportEnabled.checked = autoImportEnabled;
        refs.autoImportOptions.style.display = autoImportEnabled ? "block" : "none";
        const autoImportInterval = Storage.get(autoConfig.intervalKey, autoConfig.intervalDefault);
        const intervalSelect = refs.autoImportInterval
        intervalSelect.value = autoImportInterval;
        // 如果存储的值不在选项中，回退到默认值
        if (intervalSelect.selectedIndex === -1) {
            intervalSelect.value = autoConfig.intervalDefault;
            Storage.set(autoConfig.intervalKey, autoConfig.intervalDefault);
        }

        const bookmarkAutoImportEnabled = Storage.get(
            CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED,
            CONFIG.DEFAULTS.bookmarkAutoImportEnabled
        );
        refs.bookmarkAutoImportEnabled.checked = bookmarkAutoImportEnabled;
        refs.bookmarkAutoImportOptions.style.display = bookmarkAutoImportEnabled ? "block" : "none";
        const bookmarkAutoInterval = Storage.get(
            CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL,
            CONFIG.DEFAULTS.bookmarkAutoImportInterval
        );
        const bookmarkIntervalSelect = refs.bookmarkAutoImportInterval
        bookmarkIntervalSelect.value = String(bookmarkAutoInterval);
        if (bookmarkIntervalSelect.selectedIndex === -1) {
            bookmarkIntervalSelect.value = String(CONFIG.DEFAULTS.bookmarkAutoImportInterval);
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.bookmarkAutoImportInterval);
        }

        refs.rssFeedUrlsInput.value = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_FEED_URLS,
            CONFIG.DEFAULTS.rssFeedUrls
        );
        const rssAutoImportEnabled = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED,
            CONFIG.DEFAULTS.rssAutoImportEnabled
        );
        refs.rssAutoImportEnabled.checked = rssAutoImportEnabled;
        refs.rssAutoImportOptions.style.display = rssAutoImportEnabled ? "block" : "none";
        const rssAutoInterval = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL,
            CONFIG.DEFAULTS.rssAutoImportInterval
        );
        const rssIntervalSelect = refs.rssAutoImportInterval;
        rssIntervalSelect.value = String(rssAutoInterval);
        if (rssIntervalSelect.selectedIndex === -1) {
            rssIntervalSelect.value = String(CONFIG.DEFAULTS.rssAutoImportInterval);
            Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.rssAutoImportInterval);
        }
        const rssDedupMode = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_IMPORT_DEDUP_MODE,
            CONFIG.DEFAULTS.rssImportDedupMode
        );
        const rssDedupSelect = refs.rssDedupModeSelect;
        rssDedupSelect.value = rssDedupMode;
        if (rssDedupSelect.selectedIndex === -1) {
            rssDedupSelect.value = CONFIG.DEFAULTS.rssImportDedupMode;
            Storage.set(CONFIG.STORAGE_KEYS.RSS_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.rssImportDedupMode);
        }

        const linuxdoDedupMode = Utils.getLinuxDoImportDedupMode();
        const linuxdoDedupSelect = refs.linuxdoDedupModeSelect
        linuxdoDedupSelect.value = linuxdoDedupMode;
        if (linuxdoDedupSelect.selectedIndex === -1) {
            linuxdoDedupSelect.value = CONFIG.DEFAULTS.linuxdoImportDedupMode;
            Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.linuxdoImportDedupMode);
        }

        const bookmarkDedupMode = Utils.getBookmarkImportDedupMode();
        const bookmarkDedupSelect = refs.bookmarkDedupModeSelect
        bookmarkDedupSelect.value = bookmarkDedupMode;
        if (bookmarkDedupSelect.selectedIndex === -1) {
            bookmarkDedupSelect.value = CONFIG.DEFAULTS.bookmarkImportDedupMode;
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.bookmarkImportDedupMode);
        }

        refs.aiCategoryAutoDedupCheckbox.checked = Storage.get(
            CONFIG.STORAGE_KEYS.AI_CATEGORY_AUTO_DEDUP,
            CONFIG.DEFAULTS.aiCategoryAutoDedup
        );

        const crossSourceMode = Storage.get(
            CONFIG.STORAGE_KEYS.CROSS_SOURCE_MODE,
            CONFIG.DEFAULTS.crossSourceMode
        );
        refs.crossSourceModeSelect.value = crossSourceMode;

        const updateAutoEnabled = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled);
        const updateIntervalHours = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
        const updateAutoEnabledEl = refs.updateAutoEnabled
        const updateAutoOptionsEl = refs.updateAutoOptions
        const updateIntervalEl = refs.updateIntervalHours
        updateAutoEnabledEl.checked = updateAutoEnabled;
        updateAutoOptionsEl.style.display = updateAutoEnabled ? "block" : "none";
        updateIntervalEl.value = String(updateIntervalHours);
        if (updateIntervalEl.selectedIndex === -1) {
            updateIntervalEl.value = String(CONFIG.DEFAULTS.updateCheckIntervalHours);
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
        }
        NotionOAuth.syncApiKeyInputs();
        CredentialVault.syncSensitiveInput(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
        CredentialVault.syncSensitiveInput(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
        CredentialVault.syncSensitiveInput(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, "Obsidian Local REST API Key");
        UI.renderSyncCenterSummary();
        UI.renderWorkspaceVisualSummary();
        UI.renderVisualSummary();
        UpdateChecker.renderLastStatus();
    },

    renderSelfCheckResult: () => {
        const panel = UI.panel;
        if (!panel) return;

        const refs = UI.refs || {};
        const resultEl = refs.selfCheckResult
        if (!resultEl) return;

        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        const bookmarkSource = UI.getActiveBookmarkSource();
        const hasGitHubUsername = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "").trim();
        const hasGitHubToken = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "").trim();

        const checks = [
            {
                ok: true,
                label: "运行模式",
                value: isUserscriptMode ? "Userscript" : "Extension",
            },
            {
                ok: hasBridgeMarker,
                label: "书签桥接",
                value: hasBridgeMarker ? "已检测" : "未检测",
            },
            {
                ok: true,
                label: "当前来源",
                value: bookmarkSource === "github" ? "GitHub" : "Linux.do",
            },
            {
                ok: hasGitHubUsername,
                label: "GitHub 用户名",
                value: hasGitHubUsername ? "已配置" : "未配置",
            },
            {
                ok: hasGitHubToken,
                label: "GitHub Token",
                value: hasGitHubToken ? "已配置" : "未配置",
            },
        ];

        const tips = [];
        if (!hasBridgeMarker) {
            tips.push("• 未检测到书签桥接：请安装/启用 chrome-extension（Userscript）或确认扩展权限。");
        }
        if (bookmarkSource === "github" && !hasGitHubUsername && !hasGitHubToken) {
            tips.push("• 当前来源为 GitHub：请至少配置 GitHub 用户名，建议同时配置 Token。");
        }
        if (isUserscriptMode && hasBridgeMarker) {
            tips.push("• 当前为 Userscript + 桥接可用，建议仅保留一种运行模式避免混用。");
        }
        if (tips.length === 0) {
            tips.push("• 当前自检通过：可直接执行加载与导入。", "• 如导入失败，请点击“复制诊断信息”并反馈。");
        }

        const lines = [
            ...checks.map(item => `${item.ok ? "✅" : "⚠️"} ${item.label}：${item.value}`),
            "",
            "建议：",
            ...tips,
        ];

        resultEl.style.whiteSpace = "pre-line";
        resultEl.textContent = lines.join("\n");
    },

    copyDiagnostics: async () => {
        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        const bookmarkSource = UI.getActiveBookmarkSource();
        const hasGitHubUsername = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "").trim();
        const hasGitHubToken = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "").trim();
        const activeTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, CONFIG.DEFAULTS.activeTab);
        const updateLastResultRaw = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, "");
        const updateLastSeenVersion = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_SEEN_VERSION, "");
        const updateLastCheckAt = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, "");
        const modeConflictTipShown = Storage.get(CONFIG.STORAGE_KEYS.MODE_CONFLICT_TIP_SHOWN, false);

        const autoCfg = UI.getAutoImportConfigBySource();
        const autoImportEnabled = Storage.get(autoCfg.enabledKey, autoCfg.enabledDefault);
        const autoImportInterval = Storage.get(autoCfg.intervalKey, autoCfg.intervalDefault);

        const issues = [];
        if (!hasBridgeMarker) {
            issues.push("missing_bookmark_bridge");
        }
        if (bookmarkSource === "github" && !hasGitHubUsername && !hasGitHubToken) {
            issues.push("github_credentials_missing");
        }

        let updateLastResult = "";
        if (typeof updateLastResultRaw === "string") {
            updateLastResult = updateLastResultRaw;
        } else if (updateLastResultRaw && typeof updateLastResultRaw === "object") {
            try {
                updateLastResult = JSON.stringify(updateLastResultRaw);
            } catch {
                updateLastResult = String(updateLastResultRaw);
            }
        }

        const diagnostics = [
            "[LD-Notion Diagnostics v2]",
            "",
            "[runtime]",
            `url=${location.href}`,
            `mode=${isUserscriptMode ? "userscript" : "extension"}`,
            `bridge=${hasBridgeMarker ? "ready" : "missing"}`,
            `source=${bookmarkSource}`,
            `active_tab=${activeTab}`,
            `bookmark_count=${Array.isArray(UI.bookmarks) ? UI.bookmarks.length : 0}`,
            "",
            "[config]",
            `github_username=${hasGitHubUsername ? "set" : "unset"}`,
            `github_token=${hasGitHubToken ? "set" : "unset"}`,
            `auto_import_enabled=${autoImportEnabled ? "true" : "false"}`,
            `auto_import_interval=${String(autoImportInterval)}`,
            `mode_conflict_tip_shown=${modeConflictTipShown ? "true" : "false"}`,
            "",
            "[update_checker]",
            `last_check_at=${updateLastCheckAt || ""}`,
            `last_seen_version=${updateLastSeenVersion || ""}`,
            `last_result=${(updateLastResult || "").slice(0, 500)}`,
            "",
            "[issues]",
            `count=${issues.length}`,
            `items=${issues.join(",")}`,
            "",
            "[env]",
            `user_agent=${navigator.userAgent}`,
            `time=${new Date().toISOString()}`,
        ].join("\n");

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(diagnostics);
            } else {
                const textarea = document.createElement("textarea");
                textarea.value = diagnostics;
                textarea.setAttribute("readonly", "readonly");
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                textarea.remove();
            }
            UI.showStatus("诊断信息已复制（v2）", "success");
        } catch (error) {
            UI.showStatus(`复制失败: ${error.message || error}`, "error");
        }
    },

    // 显示状态
    showStatus: (message, type = "info") => {
        const container = UI.refs.statusContainer
        container.innerHTML = `
            <div class="ldb-status ${type}">
                ${message}
                <button class="ldb-status-close" title="关闭">×</button>
            </div>
        `;

        // 添加关闭按钮事件
        const closeBtn = container.querySelector(".ldb-status-close");
        if (closeBtn) {
            closeBtn.onclick = () => { container.innerHTML = ""; };
        }

        // 错误消息延长显示时间（10秒），其他类型3秒
        const timeout = type === "error" ? 10000 : 3000;
        setTimeout(() => {
            container.innerHTML = "";
        }, timeout);
    },

    // 显示进度
    showProgress: (current, total, message) => {
        const container = UI.refs.statusContainer
        const percent = Math.round((current / total) * 100);

        container.innerHTML = `
            <div class="ldb-progress">
                <div class="ldb-progress-bar">
                    <div class="ldb-progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="ldb-progress-text">
                    ${current}/${total} (${percent}%)<br>
                    <small>${message}</small>
                </div>
            </div>
        `;
    },

    // 隐藏进度
    hideProgress: () => {
        UI.refs.statusContainer.innerHTML = "";
    },

    // 更新 AI 模型选项
    updateAIModelOptions: (service, customModels = null, preserveSelection = false) => {
        const refs = UI.refs || {};
        const modelSelect = refs.aiModelSelect;
        const provider = AIService.PROVIDERS[service];

        if (!provider || !modelSelect) return;

        const models = customModels || provider.models;
        const defaultModel = provider.defaultModel;

        // 保留当前选择的模型（如果需要且存在于新列表中）
        const currentValue = modelSelect.value;
        const shouldPreserve = preserveSelection && currentValue && models.includes(currentValue);

        modelSelect.innerHTML = models.map(model => {
            const isSelected = shouldPreserve
                ? model === currentValue
                : model === defaultModel;
            return `<option value="${model}" ${isSelected ? 'selected' : ''}>${model}</option>`;
        }).join("");
    },

    // 更新工作区选择下拉框
    updateWorkspaceSelect: (workspaceData) => {
        const refs = UI.refs || {};
        const select = refs.workspaceSelect;
        if (!select) return;

        const { databases = [], pages = [] } = workspaceData;
        const exportState = TargetState.getExportState();
        const restoreValue = exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE
            ? (exportState.parentPageId ? `page:${exportState.parentPageId}` : "")
            : (exportState.databaseId ? `database:${exportState.databaseId}` : "");

        let options = '<option value="">-- 从工作区选择 --</option>';
        const knownValues = new Set();

        // 数据库组
        if (databases.length > 0) {
            options += '<optgroup label="📁 数据库">';
            databases.forEach(db => {
                const value = `database:${db.id}`;
                knownValues.add(value);
                options += `<option value="${value}">📁 ${Utils.escapeHtml(db.title)}</option>`;
            });
            options += '</optgroup>';
        }

        // 页面组（只显示工作区顶级页面）
        const workspacePages = pages.filter(p => p.parent === "workspace");
        if (workspacePages.length > 0) {
            options += '<optgroup label="📄 工作区页面">';
            workspacePages.forEach(page => {
                const value = `page:${page.id}`;
                knownValues.add(value);
                options += `<option value="${value}">📄 ${Utils.escapeHtml(page.title)}</option>`;
            });
            options += '</optgroup>';
        }

        if (restoreValue && !knownValues.has(restoreValue)) {
            const shortId = restoreValue.split(":")[1] || "";
            options += `<option value="${restoreValue}">已配置 (ID: ${shortId.slice(0, 8)}...)</option>`;
        }

        select.innerHTML = options;
        if (restoreValue) {
            select.value = restoreValue;
        }
    },

    // 更新 AI 查询目标数据库下拉框
    updateAITargetDbOptions: (databases) => {
        const refs = UI.refs || {};
        const select = refs.aiTargetDbSelect;
        if (!select) return;

        const savedValue = TargetState.getDisplayAITargetState().value;

        // 保留固定选项，添加数据库列表
        let options = '<option value="">当前配置的数据库</option>';
        options += '<option value="__all__">所有工作区数据库</option>';
        const knownIds = new Set();

        if (databases.length > 0) {
            options += '<optgroup label="📁 指定数据库">';
            databases.forEach(db => {
                knownIds.add(db.id);
                options += `<option value="${db.id}">📁 ${Utils.escapeHtml(db.title)}</option>`;
            });
            options += '</optgroup>';
        }

        if (savedValue && savedValue !== "__all__" && !knownIds.has(savedValue)) {
            const displayId = savedValue.replace(/^page:/, "");
            options += `<option value="${savedValue}">已配置 (ID: ${displayId.slice(0, 8)}...)</option>`;
        }

        select.innerHTML = options;

        // 恢复之前的选择
        if (savedValue) {
            select.value = savedValue;
        }
    },

    isGitHubMode: () => SiteDetector.isGitHub(),

    getActiveBookmarkSource: () => {
        const source = Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, CONFIG.DEFAULTS.bookmarkSource);
        return source === "github" ? "github" : "linuxdo";
    },

    isActiveGitHubSource: () => UI.getActiveBookmarkSource() === "github",

    getAutoImportConfigBySource: () => {
        const isGitHub = UI.isActiveGitHubSource();
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
        UI.visualSnapshots[key] = Array.isArray(bookmarks) ? bookmarks.slice() : [];
    },

    getCombinedVisualBookmarks: () => {
        return [
            ...(Array.isArray(UI.visualSnapshots.linuxdo) ? UI.visualSnapshots.linuxdo : []),
            ...(Array.isArray(UI.visualSnapshots.github) ? UI.visualSnapshots.github : []),
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

    getViewPct: (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0),

    buildViewDateBucket: (date) => ({
        key: [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
        ].join("-"),
        label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
    }),

    collectWorkspacePlainText: (items = []) => {
        return Array.isArray(items)
            ? items.map((item) => item?.plain_text || item?.text?.content || "").join("").trim()
            : "";
    },

    getWorkspacePageProperty: (page, names = []) => {
        const properties = page?.properties || {};
        for (const name of names) {
            if (name && Object.prototype.hasOwnProperty.call(properties, name)) {
                return properties[name];
            }
        }
        return null;
    },

    getWorkspacePagePropertyText: (page, names = []) => {
        const prop = UI.getWorkspacePageProperty(page, names);
        if (!prop) return "";
        switch (prop.type) {
            case "title":
                return UI.collectWorkspacePlainText(prop.title);
            case "rich_text":
                return UI.collectWorkspacePlainText(prop.rich_text);
            case "select":
                return String(prop.select?.name || "").trim();
            case "multi_select":
                return Array.isArray(prop.multi_select)
                    ? prop.multi_select.map((item) => item?.name || "").filter(Boolean).join(", ")
                    : "";
            case "url":
                return String(prop.url || "").trim();
            case "number":
                return prop.number === 0 || Number.isFinite(prop.number) ? String(prop.number) : "";
            case "checkbox":
                return prop.checkbox ? "true" : "";
            case "created_time":
                return String(prop.created_time || "").trim();
            case "last_edited_time":
                return String(prop.last_edited_time || "").trim();
            default:
                return "";
        }
    },

    getWorkspacePagePropertyDateValue: (page, names = []) => {
        const prop = UI.getWorkspacePageProperty(page, names);
        if (!prop) return "";
        if (prop.type === "date") return String(prop.date?.start || "").trim();
        if (prop.type === "created_time") return String(prop.created_time || "").trim();
        if (prop.type === "last_edited_time") return String(prop.last_edited_time || "").trim();
        return "";
    },

    getWorkspaceVisualSourceUrl: (pageOrRecord) => {
        if (pageOrRecord?.sourceUrl) return String(pageOrRecord.sourceUrl || "").trim();
        const explicitUrl = UI.getWorkspacePagePropertyText(pageOrRecord, ["链接", "URL", "网址", "链接地址"]);
        if (explicitUrl) return explicitUrl;
        return String(pageOrRecord?.url || "").trim();
    },

    normalizeWorkspaceSourceLabel: (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const lower = raw.toLowerCase();
        if (lower.includes("linux.do") || lower.includes("linuxdo")) return "Linux.do";
        if (lower.includes("github") || ["repo", "repos", "star", "stars", "fork", "forks", "gist", "gists"].includes(lower)) return "GitHub";
        if (lower.includes("rss") || lower.includes("feed")) return "RSS";
        if (lower.includes("candidate") || raw.includes("统一候选")) return "统一候选";
        if (lower.includes("zhihu") || raw.includes("知乎")) return "知乎";
        if (lower.includes("bookmark") || lower.includes("书签")) return "浏览器书签";
        if (lower.includes("generic") || lower.includes("通用页面")) return "通用页面";
        if (lower.includes("unknown") || lower.includes("未标记")) return "未标记";
        return raw;
    },

    normalizeWorkspaceSourceTypeLabel: (value, source = "") => {
        const raw = String(value || "").trim();
        if (!raw) {
            if (source === "GitHub") return "GitHub";
            if (source === "Linux.do") return "帖子";
            if (source === "RSS") return "Feed";
            if (source === "浏览器书签") return "书签";
            if (source === "知乎") return "网页";
            return "";
        }
        const lower = raw.toLowerCase();
        if (["star", "stars"].includes(lower)) return "Stars";
        if (["repo", "repos"].includes(lower)) return "Repos";
        if (["fork", "forks"].includes(lower)) return "Forks";
        if (["gist", "gists"].includes(lower)) return "Gists";
        if (lower.includes("rss") || lower.includes("feed")) return "Feed";
        if (lower.includes("bookmark") || lower.includes("书签")) return "书签";
        if (lower.includes("post") || lower.includes("topic") || lower.includes("帖子")) return "帖子";
        if (lower.includes("candidate") || raw.includes("候选")) return "跨源关联候选";
        if (["answer", "回答"].includes(lower) || raw.includes("回答")) return "回答";
        if (["question", "问题", "问答"].includes(lower) || raw.includes("问题") || raw.includes("问答")) return "问题";
        if (["article", "column_article", "文章", "专栏文章"].includes(lower) || raw.includes("文章")) return "文章";
        if (["web", "webpage", "web page", "page", "网页"].includes(lower) || raw.includes("网页")) return "网页";
        return raw;
    },

    getWorkspaceVisualDate: (pageOrRecord) => {
        if (pageOrRecord?.date instanceof Date && pageOrRecord?.dateKey) {
            return {
                date: pageOrRecord.date,
                key: pageOrRecord.dateKey,
                label: pageOrRecord.dateLabel || UI.buildViewDateBucket(pageOrRecord.date).label,
                field: pageOrRecord.dateField || "",
            };
        }

        const candidates = [
            { field: "收藏时间", value: UI.getWorkspacePagePropertyDateValue(pageOrRecord, ["收藏时间"]) },
            { field: "更新时间", value: UI.getWorkspacePagePropertyDateValue(pageOrRecord, ["更新时间"]) },
            { field: "发布日期", value: UI.getWorkspacePagePropertyDateValue(pageOrRecord, ["发布日期"]) },
            { field: "created_time", value: String(pageOrRecord?.created_time || "").trim() },
            { field: "last_edited_time", value: String(pageOrRecord?.last_edited_time || "").trim() },
        ];

        for (const candidate of candidates) {
            if (!candidate.value) continue;
            const date = new Date(candidate.value);
            if (Number.isNaN(date.getTime())) continue;
            const bucket = UI.buildViewDateBucket(date);
            return {
                date,
                key: bucket.key,
                label: bucket.label,
                field: candidate.field,
            };
        }
        return null;
    },

    inferWorkspaceVisualSource: (page, databases = []) => {
        const explicitSource = UI.normalizeWorkspaceSourceLabel(UI.getWorkspacePagePropertyText(page, ["来源"]));
        const explicitTypeRaw = UI.getWorkspacePagePropertyText(page, ["来源类型"]);
        const properties = page?.properties || {};
        const propertyNames = Object.keys(properties);
        const parentDatabaseId = String(page?.parent?.database_id || "").replace(/-/g, "");
        const parentDatabaseTitle = databases.find((db) => db.id === parentDatabaseId)?.title || "";
        const pageTitle = Utils.getPageTitle(page);
        const hintText = [explicitSource, explicitTypeRaw, parentDatabaseTitle, pageTitle].join(" ").toLowerCase();
        const hasProp = (...names) => names.some((name) => propertyNames.includes(name));

        let source = explicitSource;
        let sourceType = UI.normalizeWorkspaceSourceTypeLabel(explicitTypeRaw, explicitSource);

        if (!source && sourceType) {
            if (sourceType === "书签") source = "浏览器书签";
            else if (["Stars", "Repos", "Forks", "Gists", "GitHub"].includes(sourceType)) source = "GitHub";
            else if (sourceType === "Feed") source = "RSS";
            else if (sourceType === "帖子") source = "Linux.do";
            else if (["回答", "问题", "文章", "网页"].includes(sourceType)) source = hintText.includes("zhihu") ? "知乎" : "通用页面";
        }

        if (!source && (hasProp("帖子数", "浏览数", "点赞数") || hintText.includes("linux.do") || hintText.includes("linuxdo"))) {
            source = "Linux.do";
            if (!sourceType) sourceType = "帖子";
        }

        if (!source && (hasProp("Stars", "语言", "更新时间") || hintText.includes("github"))) {
            source = "GitHub";
            if (!sourceType) sourceType = hasProp("Stars") ? "Repos" : "GitHub";
        }

        if (!source && (hasProp("书签路径") || hintText.includes("bookmark") || hintText.includes("书签"))) {
            source = "浏览器书签";
            if (!sourceType) sourceType = "书签";
        }

        if (!source && (hintText.includes("rss") || hintText.includes("feed"))) {
            source = "RSS";
            if (!sourceType) sourceType = "Feed";
        }

        if (!source && (hintText.includes("统一候选") || hintText.includes("candidate"))) {
            source = "统一候选";
            if (!sourceType) sourceType = "跨源关联候选";
        }

        if (!source && (hintText.includes("zhihu") || hasProp("作者", "发布日期", "摘要") && ["回答", "问题", "文章"].includes(sourceType))) {
            source = "知乎";
            if (!sourceType) sourceType = "网页";
        }

        if (!source && (hasProp("发布日期") || hasProp("摘要", "描述"))) {
            source = explicitSource || "通用页面";
        }

        if (source && !["Linux.do", "GitHub", "RSS", "浏览器书签", "知乎", "通用页面", "未标记"].includes(source)) {
            if (["回答", "问题", "文章", "网页"].includes(sourceType)) {
                source = source === "知乎" ? "知乎" : "通用页面";
            }
        }

        if (!source) source = explicitSource || "未标记";
        if (!sourceType) sourceType = UI.normalizeWorkspaceSourceTypeLabel(explicitTypeRaw, source);

        return { source, sourceType };
    },

    getWorkspaceVisualCategory: (pageOrRecord) => {
        if (pageOrRecord?.category) return String(pageOrRecord.category).trim();
        return String(
            UI.getWorkspacePagePropertyText(pageOrRecord, ["AI分类"])
            || UI.getWorkspacePagePropertyText(pageOrRecord, ["分类"])
            || ""
        ).trim();
    },

    getWorkspaceVisualParentLabel: (record) => {
        if (record?.parentDatabaseTitle) return record.parentDatabaseTitle;
        if (record?.parentType === "workspace") return "工作区页面";
        if (record?.parentType === "page_id") return "子页面";
        if (record?.parentType === "block_id") return "块内页面";
        if (record?.parentType === "database_id") return "未命名数据库";
        return "未归档页面";
    },

    mapWorkspacePageSummary: (page) => ({
        id: page?.id?.replace(/-/g, "") || "",
        title: Utils.getPageTitle(page),
        type: "page",
        url: page?.url || "",
        parent: page?.parent?.type || "",
        parentId: String(page?.parent?.database_id || page?.parent?.page_id || "").replace(/-/g, ""),
    }),

    extractWorkspaceVisualRecord: (page, databasesMap = new Map()) => {
        const summary = UI.mapWorkspacePageSummary(page);
        const dateInfo = UI.getWorkspaceVisualDate(page);
        const category = UI.getWorkspaceVisualCategory(page);
        const sourceInfo = UI.inferWorkspaceVisualSource(page, Array.from(databasesMap.values()));
        const sourceUrl = UI.getWorkspaceVisualSourceUrl(page);
        const hasSource = sourceInfo.source && sourceInfo.source !== "未标记";
        const hasDate = !!dateInfo;
        const hasCategory = !!category;

        return {
            id: summary.id,
            title: summary.title,
            url: sourceUrl || summary.url,
            sourceUrl,
            notionUrl: summary.url,
            parentType: summary.parent,
            parentDatabaseId: summary.parent === "database_id" ? summary.parentId : "",
            parentPageId: summary.parent === "page_id" ? summary.parentId : "",
            parentDatabaseTitle: databasesMap.get(summary.parentId)?.title || "",
            source: sourceInfo.source,
            sourceType: sourceInfo.sourceType,
            category,
            date: dateInfo?.date || null,
            dateKey: dateInfo?.key || "",
            dateLabel: dateInfo?.label || "",
            dateField: dateInfo?.field || "",
            hasSource,
            hasDate,
            hasCategory,
            isFullyStructured: hasSource && hasDate && hasCategory,
        };
    },

    buildVisualizationModel: (bookmarks = UI.getCombinedVisualBookmarks()) => {
        const items = Array.isArray(bookmarks) ? bookmarks : [];
        const sourceCounts = new Map();
        const typeCounts = new Map();
        const timelineCounts = new Map();
        let exported = 0;
        let pending = 0;

        items.forEach((bookmark) => {
            const bookmarkKey = UI.getBookmarkKey(bookmark);
            const isExported = UI.isBookmarkKeyExported(bookmarkKey);
            if (isExported) {
                exported += 1;
            } else {
                pending += 1;
            }

            const sourceLabel = UI.getBookmarkVisualSourceLabel(bookmark);
            sourceCounts.set(sourceLabel, (sourceCounts.get(sourceLabel) || 0) + 1);

            const typeLabel = UI.getBookmarkVisualTypeLabel(bookmark);
            typeCounts.set(typeLabel, (typeCounts.get(typeLabel) || 0) + 1);

            const dateInfo = UI.getBookmarkVisualDate(bookmark);
            if (!dateInfo) return;
            const bucket = UI.buildViewDateBucket(dateInfo);
            const existing = timelineCounts.get(bucket.key) || {
                key: bucket.key,
                label: bucket.label,
                count: 0,
                exported: 0,
            };
            existing.count += 1;
            if (isExported) existing.exported += 1;
            timelineCounts.set(bucket.key, existing);
        });

        const total = items.length;
        const toBreakdown = (map) => Array.from(map.entries())
            .map(([label, count]) => ({
                label,
                count,
                pct: UI.getViewPct(count, total),
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

        const timeline = Array.from(timelineCounts.values())
            .sort((a, b) => b.key.localeCompare(a.key))
            .slice(0, 6);

        const loadedSources = Object.entries(UI.visualSnapshots)
            .filter(([, snapshot]) => Array.isArray(snapshot) && snapshot.length > 0)
            .map(([source]) => source === "github" ? "GitHub" : "Linux.do");

        return {
            total,
            exported,
            pending,
            selected: UI.selectedBookmarks?.size || 0,
            loadedSources,
            sourceBreakdown: toBreakdown(sourceCounts),
            typeBreakdown: toBreakdown(typeCounts),
            timeline,
        };
    },

    buildWorkspaceVisualizationModel: (snapshot = UI.workspaceVisualSnapshot) => {
        const databases = Array.isArray(snapshot?.databases) ? snapshot.databases : [];
        const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
        const totalPages = records.length;
        const sourceCounts = new Map();
        const categoryCounts = new Map();
        const timelineCounts = new Map();
        const relationshipCounts = new Map();
        const recognizedSources = new Set();
        const duplicateGroups = new Map();
        const linkGroups = new Map();
        let sourcedPages = 0;
        let datedPages = 0;
        let categorizedPages = 0;
        let structuredPages = 0;

        records.forEach((record) => {
            const sourceLabel = record?.source || "未标记";
            sourceCounts.set(sourceLabel, (sourceCounts.get(sourceLabel) || 0) + 1);
            if (record?.hasSource) {
                sourcedPages += 1;
                recognizedSources.add(sourceLabel);
            }

            if (record?.hasCategory) {
                const categoryLabel = record.category;
                categoryCounts.set(categoryLabel, (categoryCounts.get(categoryLabel) || 0) + 1);
                categorizedPages += 1;
            }

            if (record?.hasDate && record?.dateKey) {
                datedPages += 1;
                const existingTimeline = timelineCounts.get(record.dateKey) || {
                    key: record.dateKey,
                    label: record.dateLabel || record.dateKey,
                    count: 0,
                };
                existingTimeline.count += 1;
                timelineCounts.set(record.dateKey, existingTimeline);
            }

            if (record?.isFullyStructured) {
                structuredPages += 1;
            }

            const parentLabel = UI.getWorkspaceVisualParentLabel(record);
            const linkLabel = `${parentLabel} → ${sourceLabel}`;
            const existingRelationship = relationshipCounts.get(linkLabel) || {
                label: linkLabel,
                parentLabel,
                sourceLabel,
                count: 0,
            };
            existingRelationship.count += 1;
            relationshipCounts.set(linkLabel, existingRelationship);

            const duplicateKey = UI.normalizeWorkspaceInsightKey(record?.title);
            if (duplicateKey) {
                const existingDuplicate = duplicateGroups.get(duplicateKey) || {
                    key: duplicateKey,
                    title: String(record?.title || "").trim() || "未命名页面",
                    items: [],
                    sources: new Set(),
                };
                existingDuplicate.items.push({
                    id: record?.id || "",
                    title: String(record?.title || "").trim() || "未命名页面",
                    source: sourceLabel,
                    parentLabel,
                    url: record?.url || "",
                });
                if (record?.hasSource) existingDuplicate.sources.add(sourceLabel);
                duplicateGroups.set(duplicateKey, existingDuplicate);
            }

            const linkKey = UI.normalizeWorkspaceInsightUrl(record?.url);
            if (linkKey) {
                const existingGroup = linkGroups.get(linkKey) || {
                    key: linkKey,
                    title: String(record?.title || "").trim() || String(record?.url || "").trim() || "未命名页面",
                    url: String(record?.url || "").trim(),
                    items: [],
                    sources: new Set(),
                };
                existingGroup.items.push({
                    id: record?.id || "",
                    title: String(record?.title || "").trim() || "未命名页面",
                    source: sourceLabel,
                    parentLabel,
                    url: record?.url || "",
                });
                if (record?.hasSource) existingGroup.sources.add(sourceLabel);
                linkGroups.set(linkKey, existingGroup);
            }
        });

        const toBreakdown = (map) => Array.from(map.entries())
            .map(([label, count]) => ({
                label,
                count,
                pct: UI.getViewPct(count, totalPages),
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

        const timeline = Array.from(timelineCounts.values())
            .sort((a, b) => b.key.localeCompare(a.key))
            .slice(0, 8);

        const relationships = Array.from(relationshipCounts.values())
            .map((item) => ({
                ...item,
                pct: UI.getViewPct(item.count, totalPages),
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .slice(0, 10);

        const duplicateCandidates = Array.from(duplicateGroups.values())
            .filter((group) => group.items.length > 1)
            .map((group) => {
                const sourceList = Array.from(group.sources).sort((a, b) => a.localeCompare(b));
                return {
                    key: group.key,
                    label: group.title,
                    count: group.items.length,
                    sourceCount: sourceList.length,
                    sources: sourceList,
                    items: group.items,
                };
            })
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .slice(0, 8);

        const linkConnectionCandidates = Array.from(linkGroups.values())
            .filter((group) => group.items.length > 1 && group.sources.size > 1)
            .map((group) => ({
                key: `url:${group.key}`,
                label: `${group.title} · ${Array.from(group.sources).sort((a, b) => a.localeCompare(b)).join(" + ")}`,
                count: group.items.length,
                sources: Array.from(group.sources).sort((a, b) => a.localeCompare(b)),
                reason: "同链接跨源候选",
                items: group.items,
                url: group.url,
            }));

        const connectionCandidates = Array.from(new Map([
            ...duplicateCandidates
                .filter((group) => group.sourceCount > 1)
                .map((group) => [group.key, {
                    key: `title:${group.key}`,
                    label: `${group.label} · ${group.sources.join(" + ")}`,
                    count: group.count,
                    sources: group.sources,
                    reason: "同标题跨源候选",
                    items: group.items,
                }]),
            ...linkConnectionCandidates.map((group) => [group.key, group]),
        ]).values()).slice(0, 8);

        const funnel = [
            { label: "已扫描页面", count: totalPages, pct: UI.getViewPct(totalPages, totalPages) },
            { label: "识别来源", count: sourcedPages, pct: UI.getViewPct(sourcedPages, totalPages) },
            { label: "有时间字段", count: datedPages, pct: UI.getViewPct(datedPages, totalPages) },
            { label: "已分类", count: categorizedPages, pct: UI.getViewPct(categorizedPages, totalPages) },
            { label: "结构完整", count: structuredPages, pct: UI.getViewPct(structuredPages, totalPages) },
        ];

        return {
            totalPages,
            totalDatabases: databases.length,
            scannedAt: Number(snapshot?.scannedAt || 0),
            maxPages: Number(snapshot?.maxPages || 0),
            recognizedSources: Array.from(recognizedSources).sort((a, b) => a.localeCompare(b)),
            sourceBreakdown: toBreakdown(sourceCounts),
            categoryBreakdown: toBreakdown(categoryCounts),
            timeline,
            relationships,
            duplicateCandidates,
            connectionCandidates,
            funnel,
            sourcedPages,
            datedPages,
            categorizedPages,
            structuredPages,
            missingSourcePages: Math.max(0, totalPages - sourcedPages),
            missingDatePages: Math.max(0, totalPages - datedPages),
            missingCategoryPages: Math.max(0, totalPages - categorizedPages),
        };
    },

    normalizeWorkspaceInsightKey: (value) => {
        const raw = String(value || "")
            .toLowerCase()
            .replace(/[\s\u3000]+/g, " ")
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim();
        if (!raw) return "";
        return raw.replace(/\s+/g, " ");
    },

    normalizeWorkspaceInsightUrl: (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        try {
            const parsed = new URL(raw);
            const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
            const search = parsed.search || "";
            return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${search}`;
        } catch {
            return raw
                .toLowerCase()
                .replace(/#.*$/, "")
                .replace(/\/+$/, "");
        }
    },

    buildWorkspaceInsightFallbackSummary: (model) => {
        const lines = [];
        if (model.connectionCandidates.length > 0) {
            lines.push(`- 检测到 ${model.connectionCandidates.length} 组跨源关联候选，优先适合作为统一知识条目的合并入口。`);
        } else {
            lines.push("- 当前还没有明显的跨源同标题或同链接候选，统一知识层更多依赖来源字段与分类字段补齐。");
        }
        if (model.missingSourcePages > 0 || model.missingDatePages > 0 || model.missingCategoryPages > 0) {
            lines.push(`- 结构缺口仍然存在：未标记 ${model.missingSourcePages}，缺时间 ${model.missingDatePages}，未分类 ${model.missingCategoryPages}。`);
        } else {
            lines.push("- 当前扫描范围内的来源、时间和分类字段已经全部齐备。");
        }
        const topSource = model.sourceBreakdown[0];
        if (topSource) {
            lines.push(`- 当前工作区以「${topSource.label}」为主，占 ${topSource.pct}%（${topSource.count} 页）。`);
        }
        lines.push("- 下一步建议优先把关联候选收敛成统一条目，再对缺字段页面跑 AI 摘要与分类补齐。");
        return lines.join("\n");
    },

    buildWorkspaceInsightMarkdown: (model = UI.buildWorkspaceVisualizationModel(), aiSummary = UI.workspaceInsightSummary || "") => {
        if (!model?.scannedAt) {
            return "# 工作区洞察报告\n\n尚未刷新工作区视图，暂无可分享的数据。";
        }

        const scannedAt = new Date(model.scannedAt).toLocaleString("zh-CN", { hour12: false });
        const structuredPct = UI.getViewPct(model.structuredPages, model.totalPages);
        const sourceLines = model.sourceBreakdown.length > 0
            ? model.sourceBreakdown.map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无来源分布数据"];
        const categoryLines = model.categoryBreakdown.length > 0
            ? model.categoryBreakdown.slice(0, 8).map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无分类统计"];
        const timelineLines = model.timeline.length > 0
            ? model.timeline.map((item) => `- ${item.label}：${item.count} 页`)
            : ["- 暂无时间线数据"];
        const relationshipLines = model.relationships.length > 0
            ? model.relationships.slice(0, 8).map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无来源关系数据"];
        const funnelLines = model.funnel.length > 0
            ? model.funnel.map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无漏斗数据"];
        const duplicateLines = model.duplicateCandidates.length > 0
            ? model.duplicateCandidates.map((item) => `- ${item.label}：${item.count} 页，来源 ${item.sources.join(" + ") || "未标记"}`)
            : ["- 暂无同标题重复候选"];
        const connectionLines = model.connectionCandidates.length > 0
            ? model.connectionCandidates.map((item) => `- ${item.label}：${item.count} 页，原因：${item.reason}`)
            : ["- 暂无跨源关联候选"];
        const summaryBlock = String(aiSummary || "").trim() || UI.buildWorkspaceInsightFallbackSummary(model);

        return [
            "# 工作区洞察报告",
            "",
            `- 扫描时间：${scannedAt}`,
            `- 页面总数：${model.totalPages}`,
            `- 覆盖数据库：${model.totalDatabases}`,
            `- 已识别来源：${model.sourcedPages}`,
            `- 结构完整率：${structuredPct}%`,
            "",
            "## 洞察摘要",
            summaryBlock,
            "",
            "## 导出漏斗",
            ...funnelLines,
            "",
            "## 来源分布",
            ...sourceLines,
            "",
            "## 分类分布",
            ...categoryLines,
            "",
            "## 全局时间线",
            ...timelineLines,
            "",
            "## 来源关系图",
            ...relationshipLines,
            "",
            "## 重复候选",
            ...duplicateLines,
            "",
            "## 跨源关联候选",
            ...connectionLines,
            "",
            "## 待补齐缺口",
            `- 未标记来源：${model.missingSourcePages}`,
            `- 缺少时间字段：${model.missingDatePages}`,
            `- 未完成分类：${model.missingCategoryPages}`,
        ].join("\n");
    },

    buildWorkspaceConnectionCandidateActionLabel: (action) => {
        const normalized = String(action || "").trim().toLowerCase();
        if (normalized === "merge") return "合并整理";
        if (normalized === "enrich") return "补充信息";
        if (normalized === "archive") return "暂缓归档";
        return "人工复核";
    },

    buildWorkspaceConnectionCandidateWorkflow: (candidate, aiDraft = null) => {
        const normalized = String(aiDraft?.recommendedAction || "review").trim().toLowerCase();
        const presets = {
            merge: {
                actionLabel: "合并整理",
                actionNames: ["合并整理", "合并", "Merge"],
                statusLabel: "待处理",
                statusNames: ["待处理", "待合并", "待办", "未开始", "Not started", "Backlog", "Inbox", "To do"],
                defaultNextStep: "确认主条目后合并重复来源，并补充统一摘要。",
            },
            review: {
                actionLabel: "人工复核",
                actionNames: ["人工复核", "复核", "Review"],
                statusLabel: "待复核",
                statusNames: ["待复核", "待处理", "待办", "未开始", "Not started", "Backlog", "Inbox", "To do"],
                defaultNextStep: "人工确认这些来源是否属于同一知识条目。",
            },
            enrich: {
                actionLabel: "补充信息",
                actionNames: ["补充信息", "补充", "Enrich"],
                statusLabel: "待补充",
                statusNames: ["待补充", "待处理", "待办", "未开始", "Not started", "Backlog", "Inbox", "To do"],
                defaultNextStep: "先补充缺失来源上下文，再决定是否合并。",
            },
            archive: {
                actionLabel: "暂缓归档",
                actionNames: ["暂缓归档", "归档", "Archive"],
                statusLabel: "已搁置",
                statusNames: ["已搁置", "暂缓", "归档", "Not started", "Backlog"],
                defaultNextStep: "暂缓处理，保留候选以备后续复核。",
            },
        };

        const preset = presets[normalized] || presets.review;
        return {
            recommendedAction: normalized || "review",
            actionLabel: preset.actionLabel,
            actionNames: preset.actionNames,
            statusLabel: preset.statusLabel,
            statusNames: preset.statusNames,
            nextStep: String(aiDraft?.nextStep || preset.defaultNextStep).trim().slice(0, 200),
            mergeReason: String(aiDraft?.mergeReason || `${candidate?.reason || "跨源候选"}，建议保留为统一知识条目的整理入口。`).trim().slice(0, 200),
        };
    },

    buildWorkspaceConnectionCandidateAIPrompt: (candidate) => {
        const items = Array.isArray(candidate?.items) ? candidate.items : [];
        return [
            "你是知识整理助手。请基于以下跨源关联候选，输出一个适合写回 Notion 的统一知识条目整理建议。",
            "要求：",
            "1. 只返回 JSON，不要包含任何额外说明。",
            "2. canonicalTitle 使用中文，20 字以内，适合作为统一知识条目标题。",
            "3. summary 使用中文，80 字以内，概括这些候选的共同主题与价值。",
            "4. recommendedAction 只能是 merge、review、enrich、archive 之一。",
            "5. nextStep 使用一句中文，给出下一步整理动作。",
            "6. mergeReason 使用一句中文，说明为什么它们应该合并或关联。",
            "7. tags 返回 1-5 个短标签。",
            "",
            "JSON Schema:",
            "{\"canonicalTitle\":\"\",\"summary\":\"\",\"recommendedAction\":\"merge|review|enrich|archive\",\"nextStep\":\"\",\"mergeReason\":\"\",\"tags\":[\"\"]}",
            "",
            JSON.stringify({
                label: candidate?.label || "",
                reason: candidate?.reason || "",
                count: Number(candidate?.count || items.length || 0),
                sources: Array.isArray(candidate?.sources) ? candidate.sources : [],
                url: candidate?.url || "",
                items: items.map((item) => ({
                    title: item?.title || "",
                    source: item?.source || "",
                    parentLabel: item?.parentLabel || "",
                    url: item?.url || "",
                })),
            }, null, 2),
        ].join("\n");
    },

    buildWorkspaceConnectionCandidateAIDraft: async (candidate, settings) => {
        if (!settings?.aiApiKey || !settings?.aiService) return null;

        try {
            const prompt = UI.buildWorkspaceConnectionCandidateAIPrompt(candidate);
            const raw = String(await AIService.requestChat(prompt, settings, 700) || "").trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("AI 未返回有效 JSON。");
            }

            const parsed = JSON.parse(jsonMatch[0]);
            const canonicalTitle = String(parsed?.canonicalTitle || parsed?.title || "").trim();
            const summary = String(parsed?.summary || "").trim();
            const recommendedAction = String(parsed?.recommendedAction || "review").trim().toLowerCase();
            const nextStep = String(parsed?.nextStep || "").trim();
            const mergeReason = String(parsed?.mergeReason || "").trim();
            const tags = Array.from(new Set(
                (Array.isArray(parsed?.tags) ? parsed.tags : [])
                    .map((item) => String(item || "").trim())
                    .filter(Boolean)
            )).slice(0, 5);

            return {
                canonicalTitle: canonicalTitle.slice(0, 80),
                summary: summary.slice(0, 200),
                recommendedAction,
                actionLabel: UI.buildWorkspaceConnectionCandidateActionLabel(recommendedAction),
                nextStep: nextStep.slice(0, 200),
                mergeReason: mergeReason.slice(0, 200),
                tags,
            };
        } catch (error) {
            console.warn("[LD-Notion] 统一候选 AI 整理失败，已回退规则版：", error);
            return null;
        }
    },

    buildWorkspaceConnectionCandidateTitle: (candidate, index = 0, aiDraft = null) => {
        const firstTitle = String(candidate?.items?.[0]?.title || "").trim();
        const fallbackLabel = String(candidate?.label || "").trim();
        const aiTitle = String(aiDraft?.canonicalTitle || "").trim();
        const baseTitle = aiTitle || firstTitle || fallbackLabel || `候选 ${index + 1}`;
        const reason = String(candidate?.reason || "").trim();
        const fullTitle = reason ? `统一候选 · ${baseTitle} · ${reason}` : `统一候选 · ${baseTitle}`;
        return fullTitle.slice(0, 200);
    },

    buildWorkspaceConnectionCandidateMarkdown: (candidate, savedAt = Date.now(), aiDraft = null) => {
        const items = Array.isArray(candidate?.items) ? candidate.items : [];
        const sourceList = Array.isArray(candidate?.sources) ? candidate.sources.filter(Boolean) : [];
        const exportedAt = new Date(savedAt).toLocaleString("zh-CN", { hour12: false });
        const workflow = UI.buildWorkspaceConnectionCandidateWorkflow(candidate, aiDraft);
        const lines = [
            "# 统一候选条目",
            "",
            `- 候选标签：${candidate?.label || "未命名候选"}`,
            `- 原因：${candidate?.reason || "未标记"}`,
            `- 来源组合：${sourceList.join(" + ") || "未标记"}`,
            `- 候选数量：${items.length}`,
            `- 导出时间：${exportedAt}`,
        ];

        if (candidate?.url) {
            lines.push(`- 候选链接：${candidate.url}`);
        }

        if (candidate?.key) {
            lines.push(`- 候选键：${candidate.key}`);
        }

        lines.push("", "## 处理状态");
        lines.push(`- 当前状态：${workflow.statusLabel}`);
        lines.push(`- 建议动作：${workflow.actionLabel}`);
        lines.push(`- 下一步：${workflow.nextStep}`);
        lines.push(`- 合并理由：${workflow.mergeReason}`);

        if (aiDraft) {
            lines.push("", "## AI 整理建议");
            if (aiDraft.canonicalTitle) {
                lines.push(`- 统一标题：${aiDraft.canonicalTitle}`);
            }
            if (aiDraft.summary) {
                lines.push(`- 摘要：${aiDraft.summary}`);
            }
            if (Array.isArray(aiDraft.tags) && aiDraft.tags.length > 0) {
                lines.push(`- AI 标签：${aiDraft.tags.join(" / ")}`);
            }
        }

        lines.push("", "## 候选条目明细");

        if (items.length === 0) {
            lines.push("- 当前候选没有可写入的条目明细。");
        } else {
            items.forEach((item, index) => {
                lines.push(`### 条目 ${index + 1}`);
                lines.push(`- 标题：${item?.title || "未命名页面"}`);
                lines.push(`- 来源：${item?.source || "未标记"}`);
                lines.push(`- 上级归属：${item?.parentLabel || "未标记"}`);
                lines.push(`- 页面 ID：${item?.id || ""}`);
                if (item?.url) {
                    lines.push(`- URL：${item.url}`);
                }
                lines.push("");
            });
        }

        return lines.join("\n").trim();
    },

    buildWorkspaceConnectionCandidateDatabaseProperties: (database, titlePropertyName, candidate, candidateTitle, aiDraft = null) => {
        const databaseProperties = database?.properties || {};
        const workflow = UI.buildWorkspaceConnectionCandidateWorkflow(candidate, aiDraft);
        const properties = {
            [titlePropertyName]: {
                title: [{ text: { content: String(candidateTitle || "统一候选").slice(0, 2000) } }]
            }
        };

        const addTextProperty = (propertyName, value) => {
            const property = databaseProperties[propertyName];
            const text = String(value || "").trim();
            if (!property || !text) return;

            if (property.type === "rich_text") {
                properties[propertyName] = {
                    rich_text: [{ text: { content: text.slice(0, 2000) } }]
                };
                return;
            }

            if (property.type === "select") {
                const options = Array.isArray(property.select?.options) ? property.select.options : [];
                if (options.some((option) => option?.name === text)) {
                    properties[propertyName] = { select: { name: text } };
                }
                return;
            }

            if (property.type === "url" && /^https?:\/\//i.test(text)) {
                properties[propertyName] = { url: text };
            }
        };

        const addChoiceProperty = (propertyName, preferredNames, fallbackText = "") => {
            const property = databaseProperties[propertyName];
            if (!property) return;

            const names = Array.isArray(preferredNames)
                ? preferredNames.map((item) => String(item || "").trim()).filter(Boolean)
                : [];
            const fallback = String(fallbackText || "").trim();

            if (property.type === "status") {
                const options = Array.isArray(property.status?.options) ? property.status.options : [];
                const matched = names.find((name) => options.some((option) => option?.name === name));
                if (matched) {
                    properties[propertyName] = { status: { name: matched } };
                }
                return;
            }

            if (property.type === "select") {
                const options = Array.isArray(property.select?.options) ? property.select.options : [];
                const matched = names.find((name) => options.some((option) => option?.name === name));
                if (matched) {
                    properties[propertyName] = { select: { name: matched } };
                }
                return;
            }

            if (property.type === "rich_text") {
                const content = fallback || names[0] || "";
                if (content) {
                    properties[propertyName] = {
                        rich_text: [{ text: { content: content.slice(0, 2000) } }]
                    };
                }
            }
        };

        const addTagProperty = (propertyName, values) => {
            const property = databaseProperties[propertyName];
            const tags = Array.from(new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 20);
            if (!property || tags.length === 0) return;

            if (property.type === "multi_select") {
                const options = Array.isArray(property.multi_select?.options) ? property.multi_select.options : [];
                const optionNames = new Set(options.map((option) => option?.name).filter(Boolean));
                const matchedTags = tags.filter((tag) => optionNames.has(tag));
                if (matchedTags.length > 0) {
                    properties[propertyName] = {
                        multi_select: matchedTags.map((tag) => ({ name: tag }))
                    };
                }
                return;
            }

            if (property.type === "rich_text") {
                properties[propertyName] = {
                    rich_text: [{ text: { content: tags.join(", ").slice(0, 2000) } }]
                };
            }
        };

        const sourceList = Array.isArray(candidate?.sources) ? candidate.sources : [];
        const aiTags = Array.isArray(aiDraft?.tags) ? aiDraft.tags : [];
        const summaryText = String(aiDraft?.summary || `${candidate?.reason || "跨源候选"}：${sourceList.join(" + ") || "未标记"}`).trim();
        addTextProperty("来源", "统一候选");
        addTextProperty("来源类型", "跨源关联候选");
        addTextProperty("分类", "统一候选");
        addChoiceProperty("状态", workflow.statusNames, workflow.statusLabel);
        addChoiceProperty("处理状态", workflow.statusNames, workflow.statusLabel);
        addChoiceProperty("候选状态", workflow.statusNames, workflow.statusLabel);
        addChoiceProperty("建议动作", workflow.actionNames, workflow.actionLabel);
        addChoiceProperty("处理动作", workflow.actionNames, workflow.actionLabel);
        addTagProperty("标签", ["候选", candidate?.reason, ...sourceList, ...aiTags]);
        addTextProperty("链接", candidate?.url || "");
        addTextProperty("描述", summaryText);
        addTextProperty("摘要", summaryText);
        addTextProperty("AI摘要", summaryText);
        addTextProperty("下一步", workflow.nextStep);
        addTextProperty("合并理由", workflow.mergeReason);
        addTextProperty("统一标题", String(aiDraft?.canonicalTitle || "").trim());

        return properties;
    },

    getWorkspaceConnectionCandidateSchemaDefinition: () => {
        const statusOptions = [
            "待处理",
            "待复核",
            "待补充",
            "待合并",
            "待办",
            "未开始",
            "已搁置",
            "暂缓",
            "归档",
        ].map((name) => ({ name }));
        const actionOptions = [
            "合并整理",
            "人工复核",
            "补充信息",
            "暂缓归档",
            "合并",
            "复核",
            "补充",
            "归档",
        ].map((name) => ({ name }));

        return {
            "来源": { typeName: "rich_text", schema: { rich_text: {} } },
            "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
            "分类": { typeName: "rich_text", schema: { rich_text: {} } },
            "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
            "链接": { typeName: "url", schema: { url: {} } },
            "描述": { typeName: "rich_text", schema: { rich_text: {} } },
            "摘要": { typeName: "rich_text", schema: { rich_text: {} } },
            "AI摘要": { typeName: "rich_text", schema: { rich_text: {} } },
            "状态": { typeName: "select", schema: { select: { options: statusOptions } } },
            "处理状态": { typeName: "select", schema: { select: { options: statusOptions } } },
            "候选状态": { typeName: "select", schema: { select: { options: statusOptions } } },
            "建议动作": { typeName: "select", schema: { select: { options: actionOptions } } },
            "处理动作": { typeName: "select", schema: { select: { options: actionOptions } } },
            "下一步": { typeName: "rich_text", schema: { rich_text: {} } },
            "合并理由": { typeName: "rich_text", schema: { rich_text: {} } },
            "统一标题": { typeName: "rich_text", schema: { rich_text: {} } },
        };
    },

    ensureWorkspaceConnectionCandidateDatabaseSchema: async (databaseId, apiKey, database = null) => {
        const currentDatabase = database || await NotionAPI.fetchDatabase(databaseId, apiKey);
        const existingProps = currentDatabase?.properties || {};
        const requiredProperties = UI.getWorkspaceConnectionCandidateSchemaDefinition();
        const propsToAdd = {};
        const typeConflicts = [];

        for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
            const existingProp = existingProps[name];
            if (!existingProp) {
                propsToAdd[name] = schema;
                continue;
            }
            if (existingProp.type !== typeName) {
                typeConflicts.push({
                    name,
                    expected: typeName,
                    actual: existingProp.type,
                });
            }
        }

        if (typeConflicts.length > 0) {
            const detail = typeConflicts
                .map((item) => `「${item.name}」期望 ${item.expected}，当前为 ${item.actual}`)
                .join("；");
            throw new Error(`统一候选目标数据库属性类型不匹配：${detail}`);
        }

        if (Object.keys(propsToAdd).length === 0) {
            return currentDatabase;
        }

        await AIAssistant._executeGuardedDatabaseWrite(
            "updateDatabase",
            databaseId,
            () => NotionAPI.updateDatabase(databaseId, propsToAdd, apiKey),
            apiKey,
            {
                itemName: "统一候选 schema",
                databaseId,
                source: "ui",
                surface: "workspace-visualization",
                propertyNames: Object.keys(propsToAdd),
            }
        );

        return {
            ...currentDatabase,
            properties: {
                ...existingProps,
                ...Object.fromEntries(
                    Object.entries(requiredProperties)
                        .filter(([name]) => propsToAdd[name])
                        .map(([name, { typeName, schema }]) => ([
                            name,
                            { type: typeName, ...schema },
                        ]))
                ),
            },
        };
    },

    formatSyncDateTime: (timestamp, emptyText = "未记录") => {
        const numeric = Number(timestamp);
        if (!Number.isFinite(numeric) || numeric <= 0) return emptyText;
        return new Date(numeric).toLocaleString("zh-CN", { hour12: false });
    },

    formatSyncWatermarkLabel: (watermark, emptyText = "未建立") => {
        if (!watermark?.time) return emptyText;
        const timeLabel = new Date(watermark.time).toLocaleString("zh-CN", { hour12: false });
        const boundaryCount = Array.isArray(watermark.ids) ? watermark.ids.length : 0;
        return boundaryCount > 0 ? `${timeLabel} · ${boundaryCount} 个边界 ID` : timeLabel;
    },

    getSyncOutcomeMeta: (outcome) => {
        const normalized = String(outcome || "idle");
        if (normalized === "running") return { label: "同步中", tone: "running" };
        if (normalized === "success") return { label: "正常", tone: "success" };
        if (normalized === "partial") return { label: "部分成功", tone: "partial" };
        if (normalized === "error") return { label: "失败", tone: "error" };
        return { label: "待机", tone: "idle" };
    },

    buildSyncStatsText: (sourceKey, stats = {}) => {
        if (!stats || typeof stats !== "object") return "暂无统计";
        if (sourceKey === "linuxdo") {
            if (!stats.scanned && !stats.pending && !stats.success && !stats.failed) return "暂无统计";
            return `扫描 ${stats.scanned || 0}，待处理 ${stats.pending || 0}，成功 ${stats.success || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}`;
        }
        if (sourceKey === "github") {
            if (!stats.enabledTypes && !stats.exported && !stats.failed && !stats.syncErrors) return "暂无统计";
            return `启用 ${stats.enabledTypes || 0} 类，成功 ${stats.exported || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}${stats.syncErrors ? `，异常 ${stats.syncErrors}` : ""}`;
        }
        if (sourceKey === "bookmarks") {
            if (!stats.created && !stats.updated && !stats.archived && !stats.failed && !stats.unchanged) return "暂无统计";
            return `新增 ${stats.created || 0}，更新 ${stats.updated || 0}，归档 ${stats.archived || 0}，无变更 ${stats.unchanged || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}`;
        }
        if (sourceKey === "rss") {
            if (!stats.feeds && !stats.scanned && !stats.created && !stats.updated && !stats.failed && !stats.unchanged) return "暂无统计";
            return `Feed ${stats.feeds || 0}，扫描 ${stats.scanned || 0}，新增 ${stats.created || 0}，更新 ${stats.updated || 0}，无变更 ${stats.unchanged || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}`;
        }
        return "暂无统计";
    },

    buildUnifiedSyncModel: () => {
        const githubTypeLabelMap = {
            stars: "Stars",
            repos: "Repos",
            forks: "Forks",
            gists: "Gists",
        };
        const linuxdoState = SyncState.getLinuxDoState();
        const githubMeta = SyncState.getGitHubMeta();
        const githubTypes = Array.from(new Set((GitHubAPI.getImportTypes() || []).filter(Boolean)));
        const githubStates = githubTypes.map((type) => ({
            type,
            label: githubTypeLabelMap[type] || type,
            state: SyncState.getGitHubState(type),
        }));
        const bookmarkState = SyncState.getBookmarkState();
        const rssState = SyncState.getRssState();
        const rssFeedCount = RSSAutoImporter.getFeedUrls().length;

        const sourceRows = [
            {
                key: "linuxdo",
                label: "Linux.do",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.autoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.autoImportInterval), 10) || 0,
                outcome: linuxdoState.lastOutcome,
                lastSuccessAt: linuxdoState.lastSuccessAt || 0,
                lastAttemptAt: linuxdoState.lastAttemptAt || 0,
                lastError: linuxdoState.lastError || "",
                watermarkLabel: UI.formatSyncWatermarkLabel(linuxdoState.watermark),
                statsLabel: UI.buildSyncStatsText("linuxdo", linuxdoState.lastStats),
                scheduleLabel: "定时轮询导入 Linux.do 新收藏",
                detailLabel: "增量基线来自最近收藏时间 + 边界 ID",
            },
            {
                key: "github",
                label: "GitHub",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.githubAutoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.githubAutoImportInterval), 10) || 0,
                outcome: githubMeta.lastOutcome,
                lastSuccessAt: githubMeta.lastSuccessAt || 0,
                lastAttemptAt: githubMeta.lastAttemptAt || 0,
                lastError: githubMeta.lastError || "",
                watermarkLabel: githubStates.length > 0
                    ? githubStates.map((item) => `${item.label}：${UI.formatSyncWatermarkLabel(item.state.watermark)}`).join("；")
                    : "未选择导入类型",
                statsLabel: UI.buildSyncStatsText("github", githubMeta.lastStats),
                scheduleLabel: githubTypes.length > 0 ? `启用类型：${githubTypes.map((type) => githubTypeLabelMap[type] || type).join(" / ")}` : "未选择导入类型",
                detailLabel: "每种 GitHub 类型都维护独立增量基线",
            },
            {
                key: "bookmarks",
                label: "浏览器书签",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.bookmarkAutoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.bookmarkAutoImportInterval), 10) || 0,
                outcome: bookmarkState.lastOutcome,
                lastSuccessAt: bookmarkState.lastSuccessAt || 0,
                lastAttemptAt: bookmarkState.lastAttemptAt || 0,
                lastError: bookmarkState.lastError || "",
                watermarkLabel: UI.formatSyncWatermarkLabel(bookmarkState.watermark),
                statsLabel: UI.buildSyncStatsText("bookmarks", bookmarkState.lastStats),
                scheduleLabel: `跟踪 ${Object.keys(bookmarkState.snapshot || {}).length} 个已知书签映射`,
                detailLabel: "增量基线来自书签时间 + 当前快照映射",
            },
            {
                key: "rss",
                label: "RSS",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.rssAutoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.rssAutoImportInterval), 10) || 0,
                outcome: rssState.lastOutcome,
                lastSuccessAt: rssState.lastSuccessAt || 0,
                lastAttemptAt: rssState.lastAttemptAt || 0,
                lastError: rssState.lastError || "",
                watermarkLabel: UI.formatSyncWatermarkLabel(rssState.watermark),
                statsLabel: UI.buildSyncStatsText("rss", rssState.lastStats),
                scheduleLabel: rssFeedCount > 0 ? `监控 ${rssFeedCount} 个 Feed` : "未配置 Feed URL",
                detailLabel: "增量基线来自 Feed 发布时间 + 当前快照映射",
            },
        ].map((row) => {
            const outcomeMeta = UI.getSyncOutcomeMeta(row.outcome);
            const intervalLabel = row.enabled
                ? (row.intervalMinutes > 0 ? `${row.intervalMinutes} 分钟轮询` : "仅页面打开时补跑")
                : "未启用";
            return {
                ...row,
                outcomeLabel: outcomeMeta.label,
                outcomeTone: outcomeMeta.tone,
                intervalLabel,
                lastSuccessLabel: UI.formatSyncDateTime(row.lastSuccessAt, "未成功同步"),
                lastAttemptLabel: UI.formatSyncDateTime(row.lastAttemptAt, "未尝试"),
            };
        });

        const latestSuccessRow = sourceRows
            .filter((row) => row.lastSuccessAt > 0)
            .sort((a, b) => b.lastSuccessAt - a.lastSuccessAt)[0] || null;

        return {
            sourceRows,
            enabledCount: sourceRows.filter((row) => row.enabled).length,
            runningCount: sourceRows.filter((row) => row.outcome === "running").length,
            issueCount: sourceRows.filter((row) => row.enabled && (row.outcome === "error" || row.outcome === "partial")).length,
            latestSuccessSource: latestSuccessRow ? latestSuccessRow.label : "尚未建立",
            latestSuccessLabel: latestSuccessRow ? latestSuccessRow.lastSuccessLabel : "暂无成功记录",
        };
    },

    renderSyncCenterSummary: () => {
        const container = UI.refs?.viewSyncSummary;
        if (!container) return;

        const model = UI.buildUnifiedSyncModel();
        if (!model.sourceRows.length) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">统一同步中心还没有来源</div>
                    <div class="ldb-view-empty-text">启用自动同步后，这里会聚合展示各来源的轮询状态和增量基线。</div>
                </div>
            `;
            return;
        }

        const sourceCards = model.sourceRows.map((row) => {
            const highlights = [
                `<span class="ldb-view-pill">${Utils.escapeHtml(row.intervalLabel)}</span>`,
                `<span class="ldb-view-pill">${Utils.escapeHtml(row.outcomeLabel)}</span>`,
            ].join("");
            const errorMarkup = row.lastError
                ? `<div class="ldb-view-empty-text" style="margin-top: 8px; color: #dc2626;">最近异常：${Utils.escapeHtml(row.lastError)}</div>`
                : "";
            return `
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">${Utils.escapeHtml(row.label)}</div>
                    <div class="ldb-view-metric-value">${Utils.escapeHtml(row.outcomeLabel)}</div>
                    <div class="ldb-view-metric-meta">${Utils.escapeHtml(row.scheduleLabel)}</div>
                    <div class="ldb-view-highlight">${highlights}</div>
                    <div class="ldb-view-link-graph">
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">最近成功</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.lastSuccessLabel)}</div>
                        </div>
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">最近尝试</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.lastAttemptLabel)}</div>
                        </div>
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">增量基线</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.watermarkLabel)}</div>
                        </div>
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">最近统计</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.statsLabel)}</div>
                        </div>
                    </div>
                    <div class="ldb-view-empty-text" style="margin-top: 8px;">${Utils.escapeHtml(row.detailLabel)}</div>
                    ${errorMarkup}
                </div>
            `;
        }).join("");

        container.innerHTML = `
            <div class="ldb-view-grid">
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">已启用来源</div>
                    <div class="ldb-view-metric-value">${model.enabledCount}</div>
                    <div class="ldb-view-metric-meta">共 ${model.sourceRows.length} 条多源同步链</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">最近成功</div>
                    <div class="ldb-view-metric-value">${Utils.escapeHtml(model.latestSuccessSource)}</div>
                    <div class="ldb-view-metric-meta">${Utils.escapeHtml(model.latestSuccessLabel)}</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">运行中 / 需关注</div>
                    <div class="ldb-view-metric-value">${model.runningCount} / ${model.issueCount}</div>
                    <div class="ldb-view-metric-meta">运行中来源 / 部分成功或失败来源</div>
                </div>
                ${sourceCards}
            </div>
        `;
    },

    runUnifiedSyncNow: async () => {
        const refs = UI.refs || {};
        const btn = refs.viewSyncNowBtn;
        const tasks = [];

        if (Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.autoImportEnabled)) {
            tasks.push({ label: "Linux.do", run: () => AutoImporter.run() });
        }
        if (Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.githubAutoImportEnabled)) {
            tasks.push({ label: "GitHub", run: () => GitHubAutoImporter.run() });
        }
        if (Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.bookmarkAutoImportEnabled)) {
            tasks.push({ label: "浏览器书签", run: () => BookmarkAutoImporter.run() });
        }
        if (Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.rssAutoImportEnabled)) {
            tasks.push({ label: "RSS", run: () => RSSAutoImporter.run() });
        }

        if (tasks.length === 0) {
            throw new Error("至少先启用一个自动同步来源。");
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = "同步中...";
        }

        try {
            for (const task of tasks) {
                await task.run();
            }
            UI.renderSyncCenterSummary();
            const model = UI.buildUnifiedSyncModel();
            UI.showStatus(
                `统一同步完成：已执行 ${tasks.map((task) => task.label).join("、")}，当前需关注来源 ${model.issueCount} 个。`,
                model.issueCount > 0 ? "error" : "success"
            );
            return model;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "立即同步全部";
            }
        }
    },

    buildWorkspaceCollaborationPackage: (
        model = UI.buildWorkspaceVisualizationModel(),
        syncModel = UI.buildUnifiedSyncModel()
    ) => {
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const cloneJson = (value, fallback) => {
            try {
                return JSON.parse(JSON.stringify(value));
            } catch {
                return fallback;
            }
        };

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model, UI.workspaceInsightSummary || "");
        const generatedAt = UI.workspaceInsightUpdatedAt || Date.now();
        const summaryText = String(UI.workspaceInsightSummary || "").trim() || UI.buildWorkspaceInsightFallbackSummary(model);

        return {
            packageType: "ld-notion-workspace-collaboration",
            packageVersion: 1,
            generatedAt: new Date(generatedAt).toISOString(),
            workspace: {
                scannedAt: new Date(Number(model.scannedAt || generatedAt)).toISOString(),
                maxPages: Number(model.maxPages || 0),
                totalPages: Number(model.totalPages || 0),
                totalDatabases: Number(model.totalDatabases || 0),
                sourcedPages: Number(model.sourcedPages || 0),
                datedPages: Number(model.datedPages || 0),
                categorizedPages: Number(model.categorizedPages || 0),
                structuredPages: Number(model.structuredPages || 0),
                missingSourcePages: Number(model.missingSourcePages || 0),
                missingDatePages: Number(model.missingDatePages || 0),
                missingCategoryPages: Number(model.missingCategoryPages || 0),
                recognizedSources: cloneJson(model.recognizedSources || [], []),
                sourceBreakdown: cloneJson(model.sourceBreakdown || [], []),
                categoryBreakdown: cloneJson(model.categoryBreakdown || [], []),
                timeline: cloneJson(model.timeline || [], []),
                relationships: cloneJson(model.relationships || [], []),
                funnel: cloneJson(model.funnel || [], []),
                duplicateCandidates: cloneJson(model.duplicateCandidates || [], []),
                connectionCandidates: cloneJson(model.connectionCandidates || [], []),
            },
            insight: {
                summary: summaryText,
                markdown,
                updatedAt: new Date(generatedAt).toISOString(),
            },
            syncCenter: {
                enabledCount: Number(syncModel?.enabledCount || 0),
                runningCount: Number(syncModel?.runningCount || 0),
                issueCount: Number(syncModel?.issueCount || 0),
                latestSuccessSource: String(syncModel?.latestSuccessSource || "尚未建立"),
                latestSuccessLabel: String(syncModel?.latestSuccessLabel || "暂无成功记录"),
                sourceRows: cloneJson(syncModel?.sourceRows || [], []),
            },
        };
    },

    buildWorkspaceCollaborationPackageMarkdown: (collabPackage = UI.buildWorkspaceCollaborationPackage()) => {
        const candidateLines = Array.isArray(collabPackage?.workspace?.connectionCandidates) && collabPackage.workspace.connectionCandidates.length > 0
            ? collabPackage.workspace.connectionCandidates.map((item) => `- ${item.label}：${item.count} 条，原因 ${item.reason}`)
            : ["- 暂无跨源关联候选"];
        const duplicateLines = Array.isArray(collabPackage?.workspace?.duplicateCandidates) && collabPackage.workspace.duplicateCandidates.length > 0
            ? collabPackage.workspace.duplicateCandidates.map((item) => `- ${item.label}：${item.count} 条，来源 ${Array.isArray(item.sources) ? item.sources.join(" + ") : ""}`)
            : ["- 暂无重复候选"];
        const syncLines = Array.isArray(collabPackage?.syncCenter?.sourceRows) && collabPackage.syncCenter.sourceRows.length > 0
            ? collabPackage.syncCenter.sourceRows.map((row) => `- ${row.label}：${row.outcomeLabel}，最近成功 ${row.lastSuccessLabel}，基线 ${row.watermarkLabel}`)
            : ["- 暂无同步中心摘要"];
        const payload = JSON.stringify(collabPackage, null, 2);

        return [
            "# 工作区协作包",
            "",
            `- 生成时间：${collabPackage?.generatedAt || ""}`,
            `- 页面总数：${collabPackage?.workspace?.totalPages || 0}`,
            `- 数据库总数：${collabPackage?.workspace?.totalDatabases || 0}`,
            `- 已启用同步来源：${collabPackage?.syncCenter?.enabledCount || 0}`,
            "",
            "## 协作摘要",
            collabPackage?.insight?.summary || "暂无协作摘要",
            "",
            "## 工作区洞察",
            collabPackage?.insight?.markdown || "暂无洞察内容",
            "",
            "## 统一候选概览",
            ...candidateLines,
            "",
            "## 重复候选概览",
            ...duplicateLines,
            "",
            "## 同步中心摘要",
            ...syncLines,
            "",
            "## 结构化协作包 JSON",
            "```json",
            payload,
            "```",
        ].join("\n");
    },

    copyWorkspaceInsightReport: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model);
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(markdown);
            } else {
                const textarea = document.createElement("textarea");
                textarea.value = markdown;
                textarea.setAttribute("readonly", "readonly");
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                textarea.remove();
            }
            UI.workspaceInsightMarkdown = markdown;
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.showStatus("工作区洞察报告已复制。", "success");
        } catch (error) {
            throw new Error(error?.message || String(error));
        }
    },

    downloadWorkspaceInsightReport: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model);
        const objectUrlApi = (typeof window !== "undefined" && window.URL && typeof window.URL.createObjectURL === "function")
            ? window.URL
            : (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null);
        if (!objectUrlApi) {
            throw new Error("当前环境不支持报告下载。");
        }

        const stampSource = UI.workspaceInsightUpdatedAt || Date.now();
        const stamp = new Date(stampSource).toISOString().replace(/[:.]/g, "-");
        const filename = `ld-notion-workspace-insight-${stamp}.md`;
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const href = objectUrlApi.createObjectURL(blob);

        try {
            const link = document.createElement("a");
            link.href = href;
            link.download = filename;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            if (typeof link.remove === "function") {
                link.remove();
            }
            UI.workspaceInsightMarkdown = markdown;
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.showStatus("工作区洞察报告已开始下载。", "success");
            return { filename, markdown };
        } catch (error) {
            throw new Error(error?.message || String(error));
        } finally {
            if (typeof objectUrlApi.revokeObjectURL === "function") {
                setTimeout(() => objectUrlApi.revokeObjectURL(href), 0);
            }
        }
    },

    downloadWorkspaceCollaborationPackage: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        const syncModel = UI.buildUnifiedSyncModel();
        const collabPackage = UI.buildWorkspaceCollaborationPackage(model, syncModel);
        const objectUrlApi = (typeof window !== "undefined" && window.URL && typeof window.URL.createObjectURL === "function")
            ? window.URL
            : (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null);
        if (!objectUrlApi) {
            throw new Error("当前环境不支持协作包下载。");
        }

        const stampSource = UI.workspaceInsightUpdatedAt || Date.now();
        const stamp = new Date(stampSource).toISOString().replace(/[:.]/g, "-");
        const filename = `ld-notion-workspace-collaboration-${stamp}.json`;
        const payload = JSON.stringify(collabPackage, null, 2);
        const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
        const href = objectUrlApi.createObjectURL(blob);

        try {
            const link = document.createElement("a");
            link.href = href;
            link.download = filename;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            if (typeof link.remove === "function") {
                link.remove();
            }
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.showStatus("工作区协作包已开始下载。", "success");
            return { filename, payload, collabPackage };
        } catch (error) {
            throw new Error(error?.message || String(error));
        } finally {
            if (typeof objectUrlApi.revokeObjectURL === "function") {
                setTimeout(() => objectUrlApi.revokeObjectURL(href), 0);
            }
        }
    },

    saveWorkspaceCollaborationPackageToNotion: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI.refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const collabPackage = UI.buildWorkspaceCollaborationPackage(model, UI.buildUnifiedSyncModel());
        const markdown = UI.buildWorkspaceCollaborationPackageMarkdown(collabPackage);
        const packageTime = UI.workspaceInsightUpdatedAt || Date.now();
        const packageTitle = `工作区协作包 ${new Date(packageTime).toLocaleString("zh-CN", { hour12: false })}`;
        const contentBlocks = AIAssistant._textToBlocks(markdown);
        let page = null;

        if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
            const parentPageId = exportState.parentPageId;
            page = await AIAssistant._executeGuardedPageWrite(
                "createDatabasePage",
                { id: parentPageId, name: packageTitle },
                () => NotionAPI.createChildPage(parentPageId, packageTitle, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: packageTitle,
                    pageId: parentPageId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        } else {
            const databaseId = exportState.databaseId;
            const database = await NotionAPI.fetchDatabase(databaseId, apiKey);
            const titlePropertyName = Object.entries(database.properties || {}).find(([_, prop]) => prop?.type === "title")?.[0] || null;
            if (!titlePropertyName) {
                throw new Error("当前目标数据库缺少标题属性，无法保存协作包。");
            }
            const properties = {
                [titlePropertyName]: {
                    title: [{ text: { content: packageTitle } }]
                }
            };
            page = await AIAssistant._executeGuardedDatabaseWrite(
                "createDatabasePage",
                databaseId,
                () => NotionAPI.createPageObject({ database_id: databaseId }, properties, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: packageTitle,
                    databaseId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        }

        const pageId = Utils.extractNotionId(page?.id) || String(page?.id || "").replace(/-/g, "");
        UI.workspaceInsightUpdatedAt = Date.now();
        UI.setWorkspaceVisualStatus(
            `工作区协作包已保存到 Notion（${exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库"}）。`,
            "success"
        );
        UI.showStatus("工作区协作包已保存到 Notion。", "success");
        return {
            pageId,
            title: packageTitle,
            targetId: exportState.targetId,
            targetType: exportState.targetType,
            markdown,
            collabPackage,
        };
    },

    saveWorkspaceInsightReportToNotion: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI.refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model);
        const reportTime = UI.workspaceInsightUpdatedAt || Date.now();
        const reportTitle = `工作区洞察报告 ${new Date(reportTime).toLocaleString("zh-CN", { hour12: false })}`;
        const contentBlocks = AIAssistant._textToBlocks(markdown);
        let page = null;

        if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
            const parentPageId = exportState.parentPageId;
            page = await AIAssistant._executeGuardedPageWrite(
                "createDatabasePage",
                { id: parentPageId, name: reportTitle },
                () => NotionAPI.createChildPage(parentPageId, reportTitle, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: reportTitle,
                    pageId: parentPageId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        } else {
            const databaseId = exportState.databaseId;
            const database = await NotionAPI.fetchDatabase(databaseId, apiKey);
            const titlePropertyName = Object.entries(database.properties || {}).find(([_, prop]) => prop?.type === "title")?.[0] || null;
            if (!titlePropertyName) {
                throw new Error("当前目标数据库缺少标题属性，无法保存报告。");
            }
            const properties = {
                [titlePropertyName]: {
                    title: [{ text: { content: reportTitle } }]
                }
            };
            page = await AIAssistant._executeGuardedDatabaseWrite(
                "createDatabasePage",
                databaseId,
                () => NotionAPI.createPageObject({ database_id: databaseId }, properties, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: reportTitle,
                    databaseId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        }

        const pageId = Utils.extractNotionId(page?.id) || String(page?.id || "").replace(/-/g, "");
        UI.workspaceInsightMarkdown = markdown;
        UI.workspaceInsightUpdatedAt = Date.now();
        UI.setWorkspaceVisualStatus(
            `工作区洞察报告已保存到 Notion（${exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库"}）。`,
            "success"
        );
        UI.showStatus("工作区洞察报告已保存到 Notion。", "success");
        return {
            pageId,
            title: reportTitle,
            targetId: exportState.targetId,
            targetType: exportState.targetType,
            markdown,
        };
    },

    saveWorkspaceConnectionCandidatesToNotion: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }
        if (!Array.isArray(model.connectionCandidates) || model.connectionCandidates.length === 0) {
            throw new Error("当前没有可保存的跨源关联候选。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI.refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const savedAt = Date.now();
        const createdPages = [];
        const failedCandidates = [];
        const aiSettings = AIAssistant.getSettings();
        let database = null;
        let titlePropertyName = null;

        if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.DATABASE) {
            database = await NotionAPI.fetchDatabase(exportState.databaseId, apiKey);
            titlePropertyName = Object.entries(database.properties || {}).find(([_, prop]) => prop?.type === "title")?.[0] || null;
            if (!titlePropertyName) {
                throw new Error("当前目标数据库缺少标题属性，无法保存统一候选。");
            }
            database = await UI.ensureWorkspaceConnectionCandidateDatabaseSchema(exportState.databaseId, apiKey, database);
        }

        for (let index = 0; index < model.connectionCandidates.length; index++) {
            const candidate = model.connectionCandidates[index];
            const aiDraft = await UI.buildWorkspaceConnectionCandidateAIDraft(candidate, aiSettings);
            const candidateTitle = UI.buildWorkspaceConnectionCandidateTitle(candidate, index, aiDraft);
            const markdown = UI.buildWorkspaceConnectionCandidateMarkdown(candidate, savedAt, aiDraft);
            const contentBlocks = AIAssistant._textToBlocks(markdown);

            try {
                let page = null;
                if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
                    const parentPageId = exportState.parentPageId;
                    page = await AIAssistant._executeGuardedPageWrite(
                        "createDatabasePage",
                        { id: parentPageId, name: candidateTitle },
                        () => NotionAPI.createChildPage(parentPageId, candidateTitle, contentBlocks, apiKey),
                        apiKey,
                        {
                            itemName: candidateTitle,
                            pageId: parentPageId,
                            source: "ui",
                            surface: "workspace-visualization",
                        }
                    );
                } else {
                    const properties = UI.buildWorkspaceConnectionCandidateDatabaseProperties(
                        database,
                        titlePropertyName,
                        candidate,
                        candidateTitle,
                        aiDraft
                    );
                    page = await AIAssistant._executeGuardedDatabaseWrite(
                        "createDatabasePage",
                        exportState.databaseId,
                        () => NotionAPI.createPageObject({ database_id: exportState.databaseId }, properties, contentBlocks, apiKey),
                        apiKey,
                        {
                            itemName: candidateTitle,
                            databaseId: exportState.databaseId,
                            source: "ui",
                            surface: "workspace-visualization",
                        }
                    );
                }

                createdPages.push({
                    id: Utils.extractNotionId(page?.id) || String(page?.id || "").replace(/-/g, ""),
                    title: candidateTitle,
                    markdown,
                    candidateKey: candidate?.key || "",
                    aiDraft,
                });
            } catch (error) {
                failedCandidates.push({
                    title: candidateTitle,
                    error: error?.message || String(error),
                });
            }
        }

        if (createdPages.length === 0) {
            throw new Error(failedCandidates[0]?.error || "保存统一候选失败。");
        }

        const targetLabel = exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库";
        const statusMessage = failedCandidates.length > 0
            ? `统一候选已部分保存到 Notion（${targetLabel}）：成功 ${createdPages.length} 条，失败 ${failedCandidates.length} 条。`
            : `统一候选已保存到 Notion（${targetLabel}）：共 ${createdPages.length} 条。`;
        const tone = failedCandidates.length > 0 ? "error" : "success";

        UI.setWorkspaceVisualStatus(statusMessage, tone);
        UI.showStatus(statusMessage, tone);

        return {
            createdCount: createdPages.length,
            failedCount: failedCandidates.length,
            candidateCount: model.connectionCandidates.length,
            targetId: exportState.targetId,
            targetType: exportState.targetType,
            pageIds: createdPages.map((page) => page.id),
            pages: createdPages,
            failures: failedCandidates,
        };
    },

    generateWorkspaceInsight: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const btn = UI.refs?.viewGenerateWorkspaceInsightBtn;
        if (btn) {
            btn.disabled = true;
            btn.textContent = "生成中...";
        }

        try {
            let aiSummary = "";
            const settings = AIAssistant.getSettings();
            if (settings?.aiApiKey) {
                const prompt = [
                    "你是知识工作区分析师。请基于以下工作区快照输出一段简洁的 Markdown 洞察摘要。",
                    "要求：",
                    "1. 只输出 4-6 条 bullet。",
                    "2. 依次覆盖整体判断、结构缺口、跨源关联机会、下一步动作。",
                    "3. 不要重复原始数字表格，重点做结论与建议。",
                    "",
                    JSON.stringify({
                        totalPages: model.totalPages,
                        totalDatabases: model.totalDatabases,
                        sourceBreakdown: model.sourceBreakdown,
                        categoryBreakdown: model.categoryBreakdown,
                        funnel: model.funnel,
                        duplicateCandidates: model.duplicateCandidates.map((item) => ({
                            label: item.label,
                            count: item.count,
                            sources: item.sources,
                        })),
                        connectionCandidates: model.connectionCandidates.map((item) => ({
                            label: item.label,
                            count: item.count,
                            reason: item.reason,
                        })),
                        missingSourcePages: model.missingSourcePages,
                        missingDatePages: model.missingDatePages,
                        missingCategoryPages: model.missingCategoryPages,
                    }, null, 2),
                ].join("\n");
                aiSummary = String(await AIService.requestChat(prompt, settings, 900) || "").trim();
            }

            UI.workspaceInsightSummary = aiSummary;
            UI.workspaceInsightMarkdown = UI.buildWorkspaceInsightMarkdown(model, aiSummary);
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.renderWorkspaceVisualSummary();
            UI.setWorkspaceVisualStatus("已生成工作区洞察报告，可直接复制分享。", "success");
            return UI.workspaceInsightMarkdown;
        } catch (error) {
            UI.workspaceInsightSummary = "";
            UI.workspaceInsightMarkdown = UI.buildWorkspaceInsightMarkdown(model, "");
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.renderWorkspaceVisualSummary();
            UI.setWorkspaceVisualStatus(`洞察生成失败，已回退为规则报告：${error.message}`, "error");
            throw error;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "生成洞察";
            }
        }
    },

    setWorkspaceVisualStatus: (message, tone = "") => {
        const statusEl = UI.refs?.viewWorkspaceStatus;
        if (!statusEl) return;
        statusEl.textContent = message || "尚未刷新工作区视图。";
        if (statusEl.dataset) {
            if (tone) statusEl.dataset.tone = tone;
            else delete statusEl.dataset.tone;
        }
    },

    refreshWorkspaceVisualization: async (apiKey = NotionOAuth.getAccessToken(UI.refs?.apiKeyInput?.value.trim())) => {
        if (!apiKey) {
            UI.setWorkspaceVisualStatus(MSG.NO_NOTION_KEY, "error");
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const maxPages = parseInt(UI.refs?.workspaceMaxPagesSelect?.value, 10)
            || parseInt(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages), 10)
            || 0;
        const refreshBtn = UI.refs?.viewRefreshWorkspaceBtn;

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = "扫描中...";
        }

        UI.setWorkspaceVisualStatus("正在扫描工作区数据库...", "");

        try {
            const { databases, workspaceData } = await WorkspaceService.refreshWorkspaceSnapshot(apiKey, {
                includePages: false,
                maxPages,
                onProgress: (progress) => {
                    if (progress.phase === "databases") {
                        UI.setWorkspaceVisualStatus(`正在扫描工作区数据库... 已加载 ${progress.loaded} 个数据库`, "");
                    }
                },
                onWorkspaceData: (partialData) => {
                    UI.updateWorkspaceSelect(partialData);
                    UI.updateAITargetDbOptions(partialData.databases || []);
                },
            });

            UI.setWorkspaceVisualStatus("数据库已就绪，正在分析页面属性...", "");

            const pageObjects = await WorkspaceService.fetchWorkspacePageObjects(apiKey, {
                maxPages,
                phase: "workspace_visual_pages",
                onProgress: (progress) => {
                    UI.setWorkspaceVisualStatus(`正在分析页面属性... 已扫描 ${progress.loaded} 个页面`, "");
                },
            });

            const databasesMap = new Map(databases.map((d) => [d.id, d]));
            const pages = [];
            const records = [];
            pageObjects.forEach((page) => {
                const summary = UI.mapWorkspacePageSummary(page);
                if (summary.id) {
                    pages.push(summary);
                    records.push(UI.extractWorkspaceVisualRecord(page, databasesMap));
                }
            });
            const finalWorkspaceData = WorkspaceService.persistWorkspaceData(apiKey, {
                databases,
                pages,
            });

            UI.updateWorkspaceSelect(finalWorkspaceData);
            UI.updateAITargetDbOptions(finalWorkspaceData.databases || []);
            UI.workspaceVisualSnapshot = {
                databases,
                pages,
                records,
                scannedAt: Date.now(),
                maxPages,
            };
            UI.workspaceInsightSummary = "";
            UI.workspaceInsightMarkdown = UI.buildWorkspaceInsightMarkdown(UI.buildWorkspaceVisualizationModel(UI.workspaceVisualSnapshot), "");
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.renderWorkspaceVisualSummary();

            const model = UI.buildWorkspaceVisualizationModel();
            UI.setWorkspaceVisualStatus(
                `已扫描 ${model.totalPages} 个页面，覆盖 ${model.totalDatabases} 个数据库。`,
                "success"
            );
            return model;
        } catch (error) {
            UI.setWorkspaceVisualStatus(`工作区视图刷新失败：${error.message}`, "error");
            throw error;
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = "刷新工作区视图";
            }
        }
    },

    renderWorkspaceVisualSummary: () => {
        const container = UI.refs?.viewWorkspaceSummary;
        if (!container) return;

        const model = UI.buildWorkspaceVisualizationModel();
        if (!model.scannedAt) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">工作区总览还没有数据</div>
                    <div class="ldb-view-empty-text">点击上方按钮后，会扫描当前工作区数据库里的页面属性，生成全局时间线、来源关系图和导出漏斗。</div>
                </div>
            `;
            return;
        }

        if (model.totalPages === 0) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">本次扫描没有可统计页面</div>
                    <div class="ldb-view-empty-text">已完成工作区扫描，但当前范围内没有可用于聚合的页面属性。</div>
                </div>
            `;
            return;
        }

        const timelineMarkup = model.timeline.length > 0
            ? `<div class="ldb-view-timeline">${model.timeline.map((item) => `
                <div class="ldb-view-timeline-item">
                    <div class="ldb-view-timeline-label">${item.label}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${Math.max(8, item.pct || UI.getViewPct(item.count, model.totalPages))}%;"></div></div>
                    <div class="ldb-view-timeline-value">${item.count} 页</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前工作区页面里还没有可解析的时间字段。</div>`;

        const relationshipMarkup = model.relationships.length > 0
            ? `<div class="ldb-view-link-graph">${model.relationships.map((item) => `
                <div class="ldb-view-link-row">
                    <div class="ldb-view-link-path">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-link-count">${item.count} 页 · ${item.pct}%</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前工作区页面里还没有可展示的来源关系。</div>`;

        const funnelMarkup = model.funnel.length > 0
            ? `<div class="ldb-view-funnel">${model.funnel.map((item) => `
                <div class="ldb-view-funnel-row">
                    <div class="ldb-view-funnel-label">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-funnel-value">${item.count} 页 · ${item.pct}%</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前没有可展示的漏斗数据。</div>`;

        const highlights = [
            `未标记 ${model.missingSourcePages}`,
            `缺时间 ${model.missingDatePages}`,
            `未分类 ${model.missingCategoryPages}`,
        ].map((text) => `<span class="ldb-view-pill">${Utils.escapeHtml(text)}</span>`).join("");
        const duplicateMarkup = model.duplicateCandidates.length > 0
            ? `<div class="ldb-view-link-graph">${model.duplicateCandidates.map((item) => `
                <div class="ldb-view-link-row">
                    <div class="ldb-view-link-path">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-link-count">${item.count} 页 · ${Utils.escapeHtml(item.sources.join(" + ") || "未标记")}</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前还没有识别到明显的同标题重复候选。</div>`;
        const connectionMarkup = model.connectionCandidates.length > 0
            ? `<div class="ldb-view-link-graph">${model.connectionCandidates.map((item) => `
                <div class="ldb-view-link-row">
                    <div class="ldb-view-link-path">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-link-count">${item.count} 页 · ${Utils.escapeHtml(item.reason)}</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前还没有跨源关联候选，继续补齐来源字段后会更容易发现统一条目。</div>`;
        const insightSummary = String(UI.workspaceInsightSummary || "").trim();
        const reportPreview = Utils.escapeHtml(
            UI.workspaceInsightMarkdown
            || UI.buildWorkspaceInsightMarkdown(model, insightSummary)
        );

        container.innerHTML = `
            <div class="ldb-view-grid">
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">已扫描页面</div>
                    <div class="ldb-view-metric-value">${model.totalPages}</div>
                    <div class="ldb-view-metric-meta">覆盖 ${model.totalDatabases} 个数据库</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">结构完整</div>
                    <div class="ldb-view-metric-value">${model.structuredPages}</div>
                    <div class="ldb-view-metric-meta">来源、时间、分类三项齐备</div>
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">全局时间线</div>
                    ${timelineMarkup}
                    ${highlights ? `<div class="ldb-view-highlight">${highlights}</div>` : ""}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">来源关系图</div>
                    ${relationshipMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">导出漏斗</div>
                    ${funnelMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">重复候选</div>
                    ${duplicateMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">跨源关联候选</div>
                    ${connectionMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">洞察摘要</div>
                    <div class="ldb-view-empty-text">${ChatUI.safeMarkdown(insightSummary || UI.buildWorkspaceInsightFallbackSummary(model))}</div>
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">Markdown 报告预览</div>
                    <div class="ldb-view-report-preview">${reportPreview}</div>
                </div>
            </div>
        `;
    },

    renderVisualSummary: () => {
        const container = UI.refs?.viewSummary;
        if (!container) return;

        const subtitle = UI.refs?.viewSubtitle;
        const model = UI.buildVisualizationModel();

        if (subtitle) {
            subtitle.textContent = model.loadedSources.length > 0
                ? `这里继续展示本轮已加载的 ${model.loadedSources.join(" + ")} 列表摘要；工作区总览需要点击上方按钮单独刷新。`
                : "这里继续展示当前已加载的 Linux.do / GitHub 列表摘要，不会主动读取 Notion 工作区。";
        }

        if (model.total === 0) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">视图还没有数据</div>
                    <div class="ldb-view-empty-text">先加载 Linux.do 或 GitHub 收藏，这里会展示来源分布、导出状态和时间线摘要。</div>
                </div>
            `;
            return;
        }

        const renderBarRows = (rows) => rows.length > 0
            ? `<div class="ldb-view-bars">${rows.map((row) => `
                <div class="ldb-view-bar-row">
                    <div class="ldb-view-bar-label">${Utils.escapeHtml(row.label)}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${Math.max(8, row.pct)}%;"></div></div>
                    <div class="ldb-view-bar-value">${row.count} · ${row.pct}%</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">暂无可展示的数据。</div>`;

        const statusRows = [
            { label: "已导出", count: model.exported, pct: UI.getViewPct(model.exported, model.total) },
            { label: "待导出", count: model.pending, pct: UI.getViewPct(model.pending, model.total) },
            { label: "当前已选", count: model.selected, pct: UI.getViewPct(model.selected, model.total) },
        ];

        const timelineMarkup = model.timeline.length > 0
            ? `<div class="ldb-view-timeline">${model.timeline.map((item) => `
                <div class="ldb-view-timeline-item">
                    <div class="ldb-view-timeline-label">${item.label}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${Math.max(8, UI.getViewPct(item.count, model.total))}%;"></div></div>
                    <div class="ldb-view-timeline-value">${item.count} 项 / 已导出 ${item.exported}</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前数据里没有可解析的时间字段。</div>`;

        const typeHighlights = model.typeBreakdown.slice(0, 4).map((item) => {
            return `<span class="ldb-view-pill">${Utils.escapeHtml(item.label)} ${item.count}</span>`;
        }).join("");

        container.innerHTML = `
            <div class="ldb-view-grid">
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">已加载条目</div>
                    <div class="ldb-view-metric-value">${model.total}</div>
                    <div class="ldb-view-metric-meta">来自 ${Math.max(1, model.loadedSources.length)} 个已加载来源</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">当前选择</div>
                    <div class="ldb-view-metric-value">${model.selected}</div>
                    <div class="ldb-view-metric-meta">用于当前面板的批量导出选择</div>
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">来源分布</div>
                    ${renderBarRows(model.sourceBreakdown)}
                    ${typeHighlights ? `<div class="ldb-view-highlight">${typeHighlights}</div>` : ""}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">导出状态</div>
                    ${renderBarRows(statusRows)}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">时间线</div>
                    ${timelineMarkup}
                </div>
            </div>
        `;
    },

    applyBookmarkSourceUI: (source) => {
        const refs = UI.refs || {};
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

        const autoStatus = refs.autoImportStatus || UI.panel?.querySelector("#ldb-auto-import-status");
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
        return UI.isBookmarkKeyExported(UI.getBookmarkKey(bookmark));
    },

    getSelectedBookmarks: () => {
        if (!Array.isArray(UI.bookmarks) || UI.bookmarks.length === 0) return [];
        return UI.bookmarks.filter((bookmark) => {
            const bookmarkKey = UI.getBookmarkKey(bookmark);
            return UI.selectedBookmarks?.has(bookmarkKey);
        });
    },

    sanitizeObsidianFileName: (name, fallback = "untitled") => {
        const base = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
        return base || fallback;
    },

    buildGitHubObsidianMarkdown: async (item, settings = {}) => {
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
                fileName: UI.sanitizeObsidianFileName(title, `gist-${bookmark.id || "untitled"}`),
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
            fileName: UI.sanitizeObsidianFileName(enriched.full_name || title, "github-repo"),
            markdown: md,
            url: meta.url,
        };
    },

    exportGitHubSelectedToObsidian: async (selectedItems, settings, onProgress) => {
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
            if (Exporter.isCancelled) break;
            while (Exporter.isPaused) {
                await Utils.sleep(200);
                if (Exporter.isCancelled) break;
            }
            if (Exporter.isCancelled) break;

            const item = selectedItems[i];
            onProgress?.(i + 1, selectedItems.length, item.title || item.itemKey || "GitHub");

            try {
                const note = await UI.buildGitHubObsidianMarkdown(item, settings);
                const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${note.fileName}.md`, note.markdown);
                if (!noteResult.ok) throw new Error(noteResult.error);
                success.push({
                    title: note.title,
                    url: note.url,
                });
            } catch (error) {
                console.warn(`[UI] GitHub -> Obsidian 导出失败: ${item.itemKey}`, error);
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
            skipped: Exporter.isCancelled ? selectedItems.slice(success.length + failed.length).map((item) => ({
                title: item.title || item.itemKey || "GitHub",
            })) : [],
        };
    },

    mapGitHubItemsToBookmarks: (items, sourceType) => {
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
    },

    exportGitHubSelected: async (selectedItems, settings, onProgress) => {
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
                await NotionAPI.request("POST", "/pages", {
                    parent: { database_id: databaseId },
                    properties,
                }, apiKey);

                if (sourceType === "gists") {
                    GitHubAPI.markGistExported(item.itemKey);
                } else {
                    GitHubAPI.markExported(item.itemKey);
                }
                success.push({
                    title: item.title,
                    url: bookmark?.html_url || "https://github.com",
                    itemKey: item.itemKey,
                    sourceType,
                });
            } catch (error) {
                console.warn(`[UI] GitHub 手动导出失败: ${item.itemKey}`, error);
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
    },

    buildBookmarkItemHtml: (bookmark, githubMode = false) => {
        const bookmarkKey = UI.getBookmarkKey(bookmark);
        const title = bookmark.title || bookmark.name || `帖子 ${bookmarkKey}`;
        const escapedTitle = Utils.escapeHtml(title);
        const escapedTruncatedTitle = Utils.escapeHtml(Utils.truncateText(title, 35));
        const isExported = UI.isBookmarkKeyExported(bookmarkKey);
        const isSelected = UI.selectedBookmarks?.has(bookmarkKey);
        const sourceTag = githubMode
            ? `<span class="status" style="margin-right: 6px;">${(bookmark.sourceType || "stars").toUpperCase()}</span>`
            : "";
        const reexportAction = !githubMode && isExported
            ? `<button type="button" class="ldb-btn ldb-btn-secondary ldb-btn-small" data-bookmark-action="reexport" title="移除该帖子的导出记录并重新加入待导出列表">重新导出</button>`
            : "";

        return `
            <div class="ldb-bookmark-item" data-topic-id="${bookmarkKey}">
                <input type="checkbox" ${isSelected ? "checked" : ""} ${isExported ? "disabled" : ""}>
                <span class="title" title="${escapedTitle}">${escapedTruncatedTitle}</span>
                ${sourceTag}${isExported ? '<span class="status exported">已导出</span>' : '<span class="status pending">待导出</span>'}
                ${reexportAction}
            </div>
        `;
    },

    // 渲染收藏列表
    renderBookmarkList: () => {
        const list = UI.refs.bookmarkList
        UI.recomputeExportStats();
        UI.renderJobId += 1;
        const renderJobId = UI.renderJobId;
        if (!UI.bookmarks || UI.bookmarks.length === 0) {
            list.innerHTML = '<div style="padding: 12px; text-align: center; color: #666;">暂无收藏</div>';
            UI.updateSelectCount();
            UI.renderVisualSummary();
            return;
        }

        const githubMode = UI.isActiveGitHubSource();
        const bookmarks = UI.bookmarks.slice();
        const chunkSize = bookmarks.length > 150 ? 80 : bookmarks.length;
        let cursor = 0;
        list.innerHTML = "";

        const appendChunk = () => {
            if (UI.renderJobId !== renderJobId) return;
            const chunk = bookmarks.slice(cursor, cursor + chunkSize).map((bookmark) => UI.buildBookmarkItemHtml(bookmark, githubMode)).join("");
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
        UI.updateSelectCount();
        UI.renderVisualSummary();
    },

    // 重算导出统计（在列表变更后调用）
    recomputeExportStats: () => {
        if (!UI.bookmarks || UI.bookmarks.length === 0) {
            UI.totalUnexportedCount = 0;
            UI.selectedUnexportedCount = 0;
            return;
        }

        let totalUnexported = 0;
        let selectedUnexported = 0;

        UI.bookmarks.forEach((b) => {
            const bookmarkKey = UI.getBookmarkKey(b);
            const isUnexported = !UI.isBookmarkKeyExported(bookmarkKey);
            if (isUnexported) {
                totalUnexported++;
                if (UI.selectedBookmarks?.has(bookmarkKey)) {
                    selectedUnexported++;
                }
            }
        });

        UI.totalUnexportedCount = totalUnexported;
        UI.selectedUnexportedCount = selectedUnexported;
    },

    // 更新选中数量
    updateSelectCount: () => {
        const count = UI.selectedBookmarks?.size || 0;
        const pendingCount = UI.selectedUnexportedCount || 0;

        UI.refs.selectCount.textContent = `已选 ${count} 个，待导出 ${Math.max(0, pendingCount)} 个`;

        // 更新全选框状态
        const selectAll = UI.refs.selectAll
        if (count === 0) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
        } else if (UI.totalUnexportedCount > 0 && pendingCount === UI.totalUnexportedCount) {
            selectAll.checked = true;
            selectAll.indeterminate = false;
        } else {
            selectAll.checked = false;
            selectAll.indeterminate = true;
        }
        UI.renderVisualSummary();
    },

    requeueLinuxDoBookmark: (bookmarkKey) => {
        if (!bookmarkKey || bookmarkKey.startsWith("gh:")) return false;
        if (!Utils.isLinuxDoDedupStrict()) {
            UI.showStatus("当前为允许重复模式，无需重新导出；直接勾选并导出即可。", "info");
            return false;
        }

        const removed = Storage.unmarkTopicExported(bookmarkKey);
        if (!removed) {
            UI.showStatus("该帖子当前不在已导出记录中。", "info");
            return false;
        }

        UI.selectedBookmarks.add(bookmarkKey);
        UI.recomputeExportStats();
        UI.renderBookmarkList();
        UI.showStatus("已移除该帖子的导出记录，请重新点击导出。", "success");
        return true;
    },

    syncRenderedSelectionState: () => {
        const list = (UI.refs && UI.refs.bookmarkList) || UI.panel?.querySelector("#ldb-bookmark-list");
        if (!list) return;

        list.querySelectorAll(".ldb-bookmark-item").forEach((item) => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (!checkbox || checkbox.disabled) return;
            const bookmarkKey = String(item.dataset.topicId || "");
            if (!bookmarkKey) return;
            checkbox.checked = UI.selectedBookmarks?.has(bookmarkKey) || false;
        });
    },

    // 显示导出报告
    showReport: (results) => {
        const container = UI.refs.reportContainer
        const { success, failed, skipped } = results;

        let html = '<div class="ldb-report">';
        html += '<div class="ldb-report-title">📊 导出报告</div>';

        if (success.length > 0) {
            html += '<div class="ldb-report-section">';
            html += `<div class="ldb-report-section-title">✅ 成功 (${success.length})</div>`;
            success.slice(0, 10).forEach(item => {
                html += `<div class="ldb-report-item success">
                    <span>✓</span>
                    <a href="${Utils.escapeHtml(item.url)}" target="_blank">${Utils.escapeHtml(Utils.truncateText(item.title, 40))}</a>
                </div>`;
            });
            if (success.length > 10) {
                html += `<div class="ldb-report-item success"><span>...</span> 还有 ${success.length - 10} 个</div>`;
            }
            html += '</div>';
        }

        if (failed.length > 0) {
            html += '<div class="ldb-report-section">';
            html += `<div class="ldb-report-section-title">❌ 失败 (${failed.length})</div>`;
            failed.forEach(item => {
                html += `<div class="ldb-report-item failed">
                    <span>✗</span>
                    <span>${Utils.escapeHtml(Utils.truncateText(item.title, 35))}</span>
                </div>`;
                html += `<div class="ldb-report-error">${Utils.escapeHtml(item.error)}</div>`;
            });
            html += '</div>';
        }

        if (skipped && skipped.length > 0) {
            html += '<div class="ldb-report-section">';
            html += `<div class="ldb-report-section-title">⏭️ 已跳过 (${skipped.length})</div>`;
            html += `<div class="ldb-report-item" style="color: #888;">
                <span>由于取消操作，${skipped.length} 个收藏未导出</span>
            </div>`;
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
    },

    // 更新操作日志面板
    updateLogPanel: () => {
        if (!UI.panel) return;

        const listContainer = UI.panel.querySelector("#ldb-log-list");
        const countBadge = UI.panel.querySelector("#ldb-log-count");

        if (!listContainer || !countBadge) return;

        const logs = OperationLog.getRecent(20);
        countBadge.textContent = logs.length;

        if (logs.length === 0) {
            listContainer.innerHTML = '<div class="ldb-log-empty">暂无操作记录</div>';
            return;
        }

        let html = '';
        logs.forEach(entry => {
            const formatted = OperationLog.formatEntry(entry);
            html += `
                <div class="ldb-log-item">
                    <span class="icon">${formatted.statusIcon}</span>
                    <div class="content">
                        <div class="operation">${Utils.escapeHtml(formatted.operation)}</div>
                        <div class="time">${formatted.time} · ${formatted.duration}</div>
                        ${formatted.error ? `<div class="error">${Utils.escapeHtml(formatted.error)}</div>` : ''}
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    },

    // 拖拽功能
    makeDraggable: (element, handle) => {
        let offsetX, offsetY, isDragging = false;

        handle.onmousedown = (e) => {
            if (e.target.tagName === "BUTTON") return;
            isDragging = true;
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
            document.body.style.userSelect = "none";
        };

        document.onmousemove = (e) => {
            if (!isDragging) return;
            const x = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, e.clientX - offsetX));
            const y = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, e.clientY - offsetY));
            element.style.left = x + "px";
            element.style.top = y + "px";
            element.style.right = "auto";
        };

        document.onmouseup = () => {
            isDragging = false;
            document.body.style.userSelect = "";
        };
    },

    maybePromptBookmarkExtensionInstall: () => {
        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        if (!isUserscriptMode) return;
        if (BookmarkBridge.isExtensionAvailable()) return;
        if (Storage.get(CONFIG.STORAGE_KEYS.EXT_INSTALL_PROMPT_SHOWN, false)) return;

        Storage.set(CONFIG.STORAGE_KEYS.EXT_INSTALL_PROMPT_SHOWN, true);
        const shouldInstallNow = window.confirm("检测到你尚未安装书签桥接扩展。\n\n是否现在打开安装页面？");
        if (shouldInstallNow) {
            InstallHelper.openBookmarkExtensionInstall();
        }
    },

    // 初始化
    init: () => {
        UI.injectStyles();
        UI.createPanel();
        UI.miniBtn = UI.createMiniButton();

        // 面板可拉伸（左边+上边+下边+左上角+左下角）
        PanelResize.makeResizable(UI.panel, {
            edges: ["l", "t", "b", "tl", "bl"],
            storageKey: CONFIG.STORAGE_KEYS.PANEL_SIZE_MAIN,
            minWidth: 300,
            minHeight: 300,
        });

        // 检查是否需要最小化启动
        if (Storage.get(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, false)) {
            UI.panel.style.display = "none";
            UI.miniBtn.style.display = "flex";
        }

        UI.maybePromptBookmarkExtensionInstall();
    },

    destroy: () => {
        UI._abortController?.abort();
        UI._abortController = null;
        UI.panel?.remove();
        UI.panel = null;
        UI.miniBtn?.remove();
        UI.miniBtn = null;
        UI.refs = null;
        UI.isMinimized = true;
    },
};


const GenericUI = {
    panel: null,
    floatBtn: null,
    isExporting: false,

    // 注入样式
    injectStyles: () => {
        DesignSystem.ensureBase();
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.GENERIC, `
            /* LDB_UI_GENERIC */
            .gclip-float-btn {
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 48px;
                height: 48px;
                border-radius: 999px;
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: #fff;
                border: 1px solid rgba(37, 99, 235, 0.35);
                cursor: pointer;
                box-shadow: var(--ldb-ui-shadow-sm);
                z-index: 2147483647;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 22px;
                transition: transform 0.18s ease, box-shadow 0.18s ease;
                user-select: none;
            }

            .gclip-float-btn:hover {
                transform: translateY(-1px) scale(1.03);
                box-shadow: var(--ldb-ui-shadow);
            }

            .gclip-float-btn.exporting {
                background: linear-gradient(135deg, #f59e0b, var(--ldb-ui-warning));
                border-color: rgba(217, 119, 6, 0.35);
                animation: gclip-pulse 1.2s infinite;
            }

            .gclip-float-btn.success {
                background: linear-gradient(135deg, #10b981, var(--ldb-ui-success));
                border-color: rgba(22, 163, 74, 0.35);
            }

            .gclip-float-btn.error {
                background: linear-gradient(135deg, #ef4444, var(--ldb-ui-danger));
                border-color: rgba(220, 38, 38, 0.35);
            }

            @keyframes gclip-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }

            .gclip-panel {
                position: fixed;
                bottom: 84px;
                right: 24px;
                width: 320px;
                z-index: 2147483646;
                display: none;
                overflow: hidden;
                transform: translateY(12px);
                opacity: 0;
                transition: transform 0.22s ease, opacity 0.22s ease;
            }

            .gclip-panel.visible {
                display: block;
                transform: translateY(0);
                opacity: 1;
            }

            .gclip-panel-header {
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: #fff;
            }

            .gclip-panel-header .close-btn {
                border-color: rgba(255, 255, 255, 0.22);
                background: rgba(255, 255, 255, 0.14);
                color: #fff;
            }

            .gclip-panel-header .close-btn:hover {
                background: rgba(255, 255, 255, 0.22);
            }

            .gclip-preview {
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                padding: 10px 12px;
                background: rgba(148, 163, 184, 0.08);
                margin-bottom: 12px;
            }

            .gclip-preview .title {
                font-size: 13px;
                font-weight: 700;
                line-height: 1.45;
                color: var(--ldb-ui-text);
            }

            .gclip-preview .meta {
                margin-top: 4px;
                font-size: 12px;
                color: var(--ldb-ui-muted);
            }

            .gclip-status {
                margin-top: 10px;
                padding: 10px 12px;
                border-radius: 12px;
                border: 1px solid var(--ldb-ui-border);
                font-size: 12px;
                display: none;
            }

            .gclip-status.info {
                display: block;
                border-color: rgba(37, 99, 235, 0.30);
                background: rgba(37, 99, 235, 0.10);
                color: var(--ldb-ui-text);
            }

            .gclip-status.success {
                display: block;
                border-color: rgba(22, 163, 74, 0.35);
                background: rgba(22, 163, 74, 0.12);
                color: var(--ldb-ui-text);
            }

            .gclip-status.error {
                display: block;
                border-color: rgba(220, 38, 38, 0.35);
                background: rgba(220, 38, 38, 0.12);
                color: var(--ldb-ui-text);
            }

            .gclip-btn-primary {
                /* alias for .gclip-btn */
            }

            .gclip-btn-setup {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                color: var(--ldb-ui-text);
                font-weight: 650;
            }
        `);
    },

    // 创建浮动按钮
    createFloatButton: () => {
        const btn = document.createElement("button");
        btn.className = "gclip-float-btn";
        btn.setAttribute("data-ldb-root", "");
        btn.innerHTML = "📎";
        btn.title = "导出到 Notion";
        btn.addEventListener("click", () => {
            if (GenericUI.isExporting) return;
            GenericUI.togglePanel();
        });
        document.body.appendChild(btn);
        GenericUI.floatBtn = btn;
        return btn;
    },

    // 创建设置面板
    createPanel: () => {
        const panel = document.createElement("div");
        panel.className = "gclip-panel";
        panel.setAttribute("data-ldb-root", "");

        const exportState = TargetState.getExportState();
        const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
        const dbId = exportState.databaseId;
        const parentPageId = exportState.parentPageId;
        const exportType = exportState.targetType;
        const imgMode = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
        const meta = GenericExtractor.extractMeta();

        // 根据导出类型判断是否已配置完成
        const targetId = exportType === "page" ? parentPageId : dbId;
        const isConfigured = !!(apiKey && targetId);

        panel.innerHTML = `
            <div class="gclip-panel-header">
                <span>📎 导出到 Notion</span>
                <button class="close-btn" id="gclip-close">✕</button>
            </div>
            <div class="gclip-panel-body">
                <div class="gclip-preview">
                    <div class="title">${Utils.escapeHtml(meta.title)}</div>
                    <div class="meta">
                        ${meta.author ? `作者: ${Utils.escapeHtml(meta.author)}<br>` : ""}
                        ${meta.siteName ? `来源: ${Utils.escapeHtml(meta.siteName)}` : ""}
                        ${meta.publishDate ? ` · ${meta.publishDate}` : ""}
                    </div>
                </div>

                <div id="gclip-settings" style="display: ${isConfigured ? 'none' : 'block'};">
                    <div class="gclip-field">
                        <label>Notion API Key</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <input type="password" id="gclip-api-key-input" class="gclip-input" placeholder="${CredentialVault.getFieldPlaceholder(CONFIG.STORAGE_KEYS.NOTION_API_KEY, 'secret_...')}" value="" style="flex:1;font-size:12px;" autocomplete="off" />
                            <button class="gclip-btn" id="gclip-save-api-key" style="padding:4px 12px;font-size:12px;">保存</button>
                        </div>
                    </div>
                    <div class="gclip-field">
                        <label>Notion OAuth（公开集成）</label>
                        <input type="text" id="gclip-oauth-client-id" class="gclip-input" placeholder="Client ID">
                        <input type="password" id="gclip-oauth-client-secret" class="gclip-input" placeholder="Client Secret" style="margin-top:8px;">
                        <input type="text" id="gclip-oauth-redirect-uri" class="gclip-input" placeholder="Redirect URI" style="margin-top:8px;">
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                            <button class="gclip-btn gclip-btn-primary" id="gclip-oauth-authorize" style="padding:4px 12px;font-size:12px;">🔐 一键授权</button>
                            <button class="gclip-btn gclip-btn-secondary" id="gclip-oauth-clear" style="padding:4px 12px;font-size:12px;">断开授权</button>
                        </div>
                        <div id="gclip-oauth-status" style="font-size:11px;color:var(--ldb-ui-muted);margin-top:6px;"></div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                            <button class="gclip-btn gclip-btn-secondary" id="gclip-vault-unlock" style="padding:4px 12px;font-size:12px;">解锁保险箱</button>
                            <button class="gclip-btn gclip-btn-secondary" id="gclip-vault-lock" style="padding:4px 12px;font-size:12px;">锁定</button>
                        </div>
                        <div id="gclip-vault-status" style="font-size:11px;color:var(--ldb-ui-muted);margin-top:6px;"></div>
                        <div style="font-size:11px;color:var(--ldb-ui-muted);margin-top:4px;">公开 OAuth 适合个人自建集成；敏感凭证会保存在本地加密保险箱中。</div>
                    </div>
                    <div class="gclip-field">
                        <label>导出目标类型</label>
                        <select id="gclip-export-type">
                            <option value="database" ${exportType === "database" ? "selected" : ""}>数据库</option>
                            <option value="page" ${exportType === "page" ? "selected" : ""}>页面（子页面）</option>
                        </select>
                    </div>
                    <div class="gclip-field">
                        <label id="gclip-target-label">${exportType === "page" ? "父页面" : "数据库"}</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <select id="gclip-target-select" class="gclip-input" style="flex:1;">
                                <option value="">未选择</option>
                            </select>
                            <button class="gclip-btn" id="gclip-refresh-workspace" style="padding:4px 12px;font-size:12px;white-space:nowrap;">刷新</button>
                        </div>
                        <div id="gclip-target-tip" style="font-size:11px;color:var(--ldb-ui-muted);margin-top:4px;">优先从工作区列表选择，失败时可手动输入 ID</div>
                    </div>
                    <div class="gclip-field" id="gclip-manual-target-wrap" style="display:none;">
                        <label>手动输入 ID（高级）</label>
                        <input type="text" id="gclip-target-id" value="" placeholder="32位ID">
                    </div>
                    <div class="gclip-field" style="margin-top:-4px;">
                        <button class="gclip-btn gclip-btn-secondary" id="gclip-toggle-manual-target" style="padding:4px 10px;font-size:12px;">高级：手动输入 ID</button>
                    </div>
                    <div class="gclip-field">
                        <label>图片处理</label>
                        <select id="gclip-img-mode">
                            <option value="external" ${imgMode === "external" ? "selected" : ""}>外链引用</option>
                            <option value="upload" ${imgMode === "upload" ? "selected" : ""}>上传到 Notion</option>
                            <option value="skip" ${imgMode === "skip" ? "selected" : ""}>跳过图片</option>
                        </select>
                    </div>
                    <button class="gclip-btn gclip-btn-primary" id="gclip-save-settings">保存配置</button>
                </div>

                <button class="gclip-btn gclip-btn-primary" id="gclip-export" style="display: ${isConfigured ? 'block' : 'none'};">
                    导出当前页面
                </button>
                <button class="gclip-btn gclip-btn-secondary" id="gclip-obs-export" style="display: block;">
                    导出到 Obsidian
                </button>
                <button class="gclip-btn gclip-btn-setup" id="gclip-show-settings" style="display: ${isConfigured ? 'block' : 'none'};">
                    修改配置
                </button>

                <div class="gclip-status" id="gclip-status"></div>
            </div>
        `;

        document.body.appendChild(panel);
        GenericUI.panel = panel;

        // 绑定事件
        GenericUI.bindEvents();

        // 初始化导出目标 UI
        panel.querySelector("#gclip-export-type").value = exportType;
        panel.querySelector("#gclip-target-label").textContent = exportType === "page" ? "父页面" : "数据库";
        panel.querySelector("#gclip-target-id").value = targetId;

        const apiKeyForInit = NotionOAuth.getAccessToken();
        GenericUI.loadTargetOptionsFromCache(apiKeyForInit);
        if (apiKeyForInit) {
            GenericUI.refreshWorkspaceTargets(apiKeyForInit, true);
        }
        NotionOAuth.syncApiKeyInputs();
        return panel;
    },

    updateTargetSelectOptions: (databases = [], pages = []) => {
        const panel = GenericUI.panel;
        if (!panel) return;

        const select = panel.querySelector("#gclip-target-select");
        const exportType = panel.querySelector("#gclip-export-type")?.value || "database";
        if (!select) return;

        const exportState = TargetState.getExportState();
        const restoreValue = exportType === CONFIG.EXPORT_TARGET_TYPES.PAGE
            ? (exportState.parentPageId ? `page:${exportState.parentPageId}` : "")
            : exportState.databaseId;

        let options = '<option value="">未选择</option>';
        const known = new Set();

        if (exportType === "page") {
            const workspacePages = pages.filter(p => p.parent === "workspace");
            workspacePages.forEach(page => {
                const value = `page:${page.id}`;
                known.add(value);
                options += `<option value="${value}">📄 ${Utils.escapeHtml(page.title || "未命名页面")}</option>`;
            });
        } else {
            databases.forEach(db => {
                known.add(db.id);
                options += `<option value="${db.id}">📁 ${Utils.escapeHtml(db.title || "未命名数据库")}</option>`;
            });
        }

        if (restoreValue && !known.has(restoreValue)) {
            const shortId = restoreValue.replace(/^page:/, "");
            options += `<option value="${restoreValue}">已配置 (ID: ${shortId.slice(0, 8)}...)</option>`;
        }

        select.innerHTML = options;
        if (restoreValue) {
            select.value = restoreValue;
        }
    },

    refreshWorkspaceTargets: async (apiKey, silent = false) => {
        const panel = GenericUI.panel;
        if (!panel) return;

        const refreshBtn = panel.querySelector("#gclip-refresh-workspace");
        const tip = panel.querySelector("#gclip-target-tip");

        if (!apiKey) {
            if (!silent) GenericUI.showStatus(MSG.SETUP_NOTION_KEY, "error");
            return;
        }

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = "刷新中";
        }
        if (tip) {
            tip.textContent = "正在获取数据库列表...";
        }

        try {
            const { workspaceData } = await UICommandService.execute("refresh_workspace_targets", {
                apiKey,
                includePages: true,
                onProgress: (progress) => {
                    if (!tip) return;
                    if (progress.phase === "databases") {
                        tip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                    } else if (progress.phase === "pages") {
                        tip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                    }
                },
                onWorkspaceData: (workspaceData, meta) => {
                    GenericUI.updateTargetSelectOptions(workspaceData.databases, workspaceData.pages);
                    if (tip && meta.phase === "databases") {
                        tip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                    }
                },
            });

            GenericUI.updateTargetSelectOptions(workspaceData.databases, workspaceData.pages);
            if (tip) {
                tip.textContent = `已加载 ${workspaceData.databases.length} 个数据库，${workspaceData.pages.filter(p => p.parent === "workspace").length} 个页面`;
            }
        } catch (error) {
            if (tip) {
                tip.textContent = `加载失败：${error.message}`;
            }
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = "刷新";
            }
        }
    },

    loadTargetOptionsFromCache: (apiKey) => {
        const panel = GenericUI.panel;
        if (!panel) return;

        const tip = panel.querySelector("#gclip-target-tip");
        let databases = [];
        let pages = [];

        const raw = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
        try {
            const wsData = JSON.parse(raw);
            const keyHash = apiKey ? apiKey.slice(-8) : "";
            const cacheValid = !apiKey || !wsData.apiKeyHash || wsData.apiKeyHash === keyHash;
            if (cacheValid) {
                databases = wsData.databases || [];
                pages = wsData.pages || [];
            }
        } catch { /* workspace cache invalid */ }

        GenericUI.updateTargetSelectOptions(databases, pages);

        if (tip) {
            if (databases.length > 0 || pages.length > 0) {
                tip.textContent = "已加载缓存工作区列表，可点击刷新更新";
            } else {
                tip.textContent = "优先从工作区列表选择，失败时可手动输入 ID";
            }
        }
    },

    // 绑定面板事件
    bindEvents: () => {
        const panel = GenericUI.panel;

        // 关闭按钮
        panel.querySelector("#gclip-close").addEventListener("click", () => {
            GenericUI.togglePanel(false);
        });

        // 导出类型切换
        panel.querySelector("#gclip-export-type").addEventListener("change", () => {
            const isPage = panel.querySelector("#gclip-export-type").value === "page";
            panel.querySelector("#gclip-target-label").textContent = isPage ? "父页面" : "数据库";
            GenericUI.loadTargetOptionsFromCache(NotionOAuth.getAccessToken(panel.querySelector("#gclip-api-key-input").value.trim()));
        });

        // 刷新工作区目标列表
        panel.querySelector("#gclip-refresh-workspace").addEventListener("click", async () => {
            const keyInput = panel.querySelector("#gclip-api-key-input").value.trim();
            const apiKey = NotionOAuth.getAccessToken(keyInput);
            await GenericUI.refreshWorkspaceTargets(apiKey);
        });

        // 手动输入开关
        panel.querySelector("#gclip-toggle-manual-target").addEventListener("click", () => {
            const wrap = panel.querySelector("#gclip-manual-target-wrap");
            const visible = wrap.style.display !== "none";
            wrap.style.display = visible ? "none" : "block";
        });

        // 保存 API Key（从面板内密码输入框读取，避免使用可被宿主页面拦截的 prompt()）
        panel.querySelector("#gclip-save-api-key").addEventListener("click", async () => {
            const key = panel.querySelector("#gclip-api-key-input").value.trim();
            if (key) {
                try {
                    await NotionOAuth.setManualApiKey(key);
                    panel.querySelector("#gclip-api-key-input").value = "";
                    NotionOAuth.syncApiKeyInputs();
                    GenericUI.showStatus("API Key 已保存", "success");
                } catch (error) {
                    GenericUI.showStatus(`API Key 保存失败: ${error.message}`, "error");
                }
            } else {
                GenericUI.showStatus("请输入 API Key", "error");
            }
        });

        // 保存配置
        panel.querySelector("#gclip-save-settings").addEventListener("click", async () => {
            // 仅当用户主动输入了新 key 时才更新（不从 DOM 预填，防止泄漏）
            const liveKey = panel.querySelector("#gclip-api-key-input").value.trim();
            if (liveKey) {
                await NotionOAuth.setManualApiKey(liveKey);
                panel.querySelector("#gclip-api-key-input").value = "";
                NotionOAuth.syncApiKeyInputs();
            }
            const apiKey = NotionOAuth.getAccessToken();
            const exportType = panel.querySelector("#gclip-export-type").value;
            const selectValue = panel.querySelector("#gclip-target-select")?.value || "";
            const manualTargetId = panel.querySelector("#gclip-target-id").value.trim().replace(/-/g, "");
            const selectedTargetId = selectValue.startsWith("page:") ? selectValue.slice(5) : selectValue;
            const targetId = (selectedTargetId || manualTargetId).replace(/-/g, "");
            const imgMode = panel.querySelector("#gclip-img-mode").value;

            if (!apiKey) return GenericUI.showStatus(MSG.SETUP_NOTION_KEY, "error");
            if (!targetId) return GenericUI.showStatus("请先选择目标，或手动输入 ID", "error");

            if (exportType === "database") {
                GenericUI.showStatus("正在配置数据库属性...", "info");
            }
            const { setupResult } = await UICommandService.execute("save_command_boundary_settings", {
                scope: "generic-export-target",
                liveApiKey: liveKey,
                apiKey,
                exportType,
                targetId,
                imgMode,
                autoSetupDatabaseProperties: exportType === "database",
            });
            if (setupResult && !setupResult.success) {
                return GenericUI.showStatus(`配置失败: ${setupResult.message || setupResult.error}`, "error");
            }

            GenericUI.loadTargetOptionsFromCache(apiKey);

            GenericUI.showStatus("配置已保存", "success");
            panel.querySelector("#gclip-settings").style.display = "none";
            panel.querySelector("#gclip-export").style.display = "block";
            panel.querySelector("#gclip-show-settings").style.display = "block";
        });

        NotionOAuth.attachControls({
            root: panel,
            selectors: {
                clientIdInput: "#gclip-oauth-client-id",
                clientSecretInput: "#gclip-oauth-client-secret",
                redirectUriInput: "#gclip-oauth-redirect-uri",
                authorizeBtn: "#gclip-oauth-authorize",
                clearBtn: "#gclip-oauth-clear",
                statusEl: "#gclip-oauth-status",
            },
            notify: (message, type) => GenericUI.showStatus(message, type),
        });
        CredentialVault.attachControls({
            root: panel,
            selectors: {
                statusEl: "#gclip-vault-status",
                unlockBtn: "#gclip-vault-unlock",
                lockBtn: "#gclip-vault-lock",
            },
            notify: (message, type) => GenericUI.showStatus(message, type),
            onAfterSync: () => {
                NotionOAuth.syncApiKeyInputs();
            },
        });
        NotionOAuth.syncApiKeyInputs();

        // 显示设置（不在 DOM 中预填 API Key，防止第三方页面读取）
        panel.querySelector("#gclip-show-settings").addEventListener("click", () => {
            const settings = panel.querySelector("#gclip-settings");
            const showing = settings.style.display === "none";
            if (showing) {
                const exportState = TargetState.getExportState();
                const exportType = exportState.targetType;
                panel.querySelector("#gclip-export-type").value = exportType;
                panel.querySelector("#gclip-target-label").textContent = exportType === "page" ? "父页面" : "数据库";

                panel.querySelector("#gclip-target-id").value = exportState.targetId;

                const apiKey = NotionOAuth.getAccessToken();
                GenericUI.loadTargetOptionsFromCache(apiKey);
                if (apiKey) {
                    GenericUI.refreshWorkspaceTargets(apiKey, true);
                }
                NotionOAuth.syncApiKeyInputs();
                // API Key 不预填到 DOM，用户需手动输入或留空使用已保存配置
            }
            settings.style.display = showing ? "block" : "none";
        });

        // 导出按钮
        panel.querySelector("#gclip-export").addEventListener("click", () => {
            GenericUI.doExport();
        });

        // 导出到 Obsidian
        panel.querySelector("#gclip-obs-export").addEventListener("click", async () => {
            if (GenericUI.isExporting) return;
            GenericUI.isExporting = true;

            const obsUrl = Storage.get(CONFIG.STORAGE_KEYS.OBS_API_URL, CONFIG.DEFAULTS.obsApiUrl);
            const obsKey = Storage.get(CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            const obsDir = Storage.get(CONFIG.STORAGE_KEYS.OBS_DIR, CONFIG.DEFAULTS.obsDir);

            if (!obsUrl || !obsKey) {
                GenericUI.showStatus("请先配置 Obsidian API（在 LinuxDo 页面设置面板中）", "error");
                GenericUI.isExporting = false;
                return;
            }

            const btn = GenericUI.panel.querySelector("#gclip-obs-export");
            btn.disabled = true;
            btn.textContent = "导出中...";
            GenericUI.showStatus("正在提取页面内容...", "info");

            try {
                const content = SiteDetector.detect() === SiteDetector.SITES.ZHIHU
                    ? ZhihuAPI.extractContent()
                    : null;

                let md = "";
                let title = document.title || "未命名页面";

                if (content) {
                    title = content.title || title;
                    const meta = { title, url: location.href, author: content.author };
                    md = HTMLToMarkdown.buildFrontmatter(meta);
                    md += `> [!info] 页面信息\n> - **来源**: 知乎\n> - **链接**: [${title}](${location.href})\n> - **作者**: ${content.author || "未知"}\n> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;

                    if (content.detail) md += HTMLToMarkdown.convert(content.detail) + "\n\n";
                    if (content.html) md += HTMLToMarkdown.convert(content.html) + "\n\n";
                    if (content.answers) {
                        content.answers.forEach((ans, i) => {
                            md += `> [!note]+ #${i + 1} ${ans.author} · 👍 ${ans.voteCount}\n`;
                            const lines = HTMLToMarkdown.convert(ans.html || "").trim().split("\n");
                            md += lines.map(l => `> ${l}`).join("\n") + "\n\n";
                        });
                    }
                } else {
                    const meta = { title, url: location.href };
                    md = HTMLToMarkdown.buildFrontmatter(meta);
                    md += `> [!info] 页面信息\n> - **链接**: [${title}](${location.href})\n> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;
                    const body = document.querySelector("article") || document.querySelector("main") || document.body;
                    md += HTMLToMarkdown.convert(body.innerHTML) + "\n";
                }

                const fileName = title.replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
                const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${fileName}.md`, md);
                if (!noteResult.ok) throw new Error(noteResult.error);

                GenericUI.showStatus(`导出到 Obsidian 成功: ${title}`, "success");
            } catch (error) {
                GenericUI.showStatus(`Obsidian 导出失败: ${error.message}`, "error");
            } finally {
                GenericUI.isExporting = false;
                btn.disabled = false;
                btn.textContent = " 导出到 Obsidian";
            }
        });
    },

    // 执行导出
    doExport: async () => {
        if (GenericUI.isExporting) return;
        GenericUI.isExporting = true;

        const btn = GenericUI.panel.querySelector("#gclip-export");
        const floatBtn = GenericUI.floatBtn;
        btn.disabled = true;
        btn.textContent = "导出中...";
        floatBtn.className = "gclip-float-btn exporting";
        GenericUI.showStatus("正在提取页面内容...", "info");

        try {
            const apiKey = NotionOAuth.getAccessToken();
            const exportState = TargetState.getExportState();
            const imgMode = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
            const aiSettings = AIAssistant.getSettings();

            const settings = {
                apiKey,
                exportTargetType: exportState.targetType,
                databaseId: exportState.databaseId,
                parentPageId: exportState.parentPageId,
                imgMode,
                aiApiKey: aiSettings?.aiApiKey || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: aiSettings?.aiService || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService),
                aiModel: aiSettings?.aiModel || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, ""),
                aiBaseUrl: aiSettings?.aiBaseUrl || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
                categories: aiSettings?.categories || Utils.parseAICategories(Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories)),
            };

            GenericUI.showStatus("正在导出到 Notion...", "info");
            const { page, meta } = await GenericExporter.exportCurrentPage(settings);

            floatBtn.className = "gclip-float-btn success";
            GenericUI.showStatus(`导出成功: ${meta.title}`, "success");

            // 3 秒后恢复按钮状态
            setTimeout(() => {
                floatBtn.className = "gclip-float-btn";
            }, 3000);
        } catch (error) {
            floatBtn.className = "gclip-float-btn error";
            GenericUI.showStatus(`导出失败: ${error.message}`, "error");
            setTimeout(() => {
                floatBtn.className = "gclip-float-btn";
            }, 3000);
        } finally {
            GenericUI.isExporting = false;
            btn.disabled = false;
            btn.textContent = "导出当前页面";
        }
    },

    // 显示状态
    showStatus: (message, type = "info") => {
        const el = GenericUI.panel.querySelector("#gclip-status");
        el.textContent = message;
        el.className = `gclip-status ${type}`;
    },

    // 切换面板显示
    togglePanel: (show) => {
        if (!GenericUI.panel) return;
        const isVisible = GenericUI.panel.classList.contains("visible");
        const shouldShow = show !== undefined ? show : !isVisible;
        if (shouldShow) {
            GenericUI.panel.style.display = "block";
            // 触发 reflow 使 transition 生效
            GenericUI.panel.offsetHeight;
            GenericUI.panel.classList.add("visible");
        } else {
            GenericUI.panel.classList.remove("visible");
            GenericUI.panel.addEventListener("transitionend", function handler() {
                if (!GenericUI.panel.classList.contains("visible")) {
                    GenericUI.panel.style.display = "none";
                }
                GenericUI.panel.removeEventListener("transitionend", handler);
            });
        }
    },

    // 初始化
    init: () => {
        // 非 HTML 文档（如 XML/RSS）无 body，跳过 UI 注入
        if (!document.body) return;
        GenericUI.injectStyles();
        GenericUI.createFloatButton();
        GenericUI.createPanel();

        // 面板可拉伸（左边+上边+左上角）
        PanelResize.makeResizable(GenericUI.panel, {
            edges: ["l", "t", "tl"],
            storageKey: CONFIG.STORAGE_KEYS.PANEL_SIZE_GENERIC,
            minWidth: 260,
            minHeight: 200,
        });
    },
};


module.exports = { StyleManager, DesignSystem, PanelResize, NotionSiteUI, UI_CSS, UIEvents, UI, GenericUI };
