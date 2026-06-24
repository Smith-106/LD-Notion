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

            --ldb-ui-badge-teal: #0f766e;
            --ldb-ui-badge-blue: #1d4ed8;

            --ldb-ui-focus-ring: rgba(37, 99, 235, 0.35);
            --ldb-ui-backdrop: rgba(2, 6, 23, 0.35);

            --ldb-ui-white: #fff;

            --ldb-ui-radius-2xs: 6px;
            --ldb-ui-radius-md: 12px;
            --ldb-ui-radius-pill: 999px;

            --ldb-ui-spacing-3xs: 2px;
            --ldb-ui-spacing-xs: 4px;
            --ldb-ui-spacing-sm: 6px;
            --ldb-ui-spacing-md: 8px;
            --ldb-ui-spacing-lg: 10px;
            --ldb-ui-spacing-xl: 12px;
            --ldb-ui-spacing-2xl: 14px;
            --ldb-ui-spacing-3xl: 18px;

            --ldb-ui-font-size-xs: 11px;
            --ldb-ui-font-size-sm: 12px;
            --ldb-ui-font-size-md: 13px;
            --ldb-ui-font-size-lg: 14px;
            --ldb-ui-font-size-xl: 20px;
            --ldb-ui-font-size-2xl: 22px;

            --ldb-ui-z-index-panel: 2147483640;
            --ldb-ui-z-index-panel-top: 2147483641;
            --ldb-ui-z-index-overlay: 2147483646;
            --ldb-ui-z-index-float: 2147483647;

            --ldb-ui-warning-bright: #f59e0b;
            --ldb-ui-success-bright: #10b981;
            --ldb-ui-danger-bright: #ef4444;

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

            --ldb-ui-badge-teal: #2dd4bf;
            --ldb-ui-badge-blue: #93c5fd;

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

                --ldb-ui-badge-teal: #2dd4bf;
                --ldb-ui-badge-blue: #93c5fd;

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
            transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }

        .ldb-btn:hover,
        .gclip-btn:hover {
            filter: brightness(1.08);
            box-shadow: 0 2px 8px rgba(37, 99, 235, 0.18);
        }

        .ldb-btn:active,
        .gclip-btn:active {
            transform: scale(0.97);
            filter: brightness(0.96);
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
            transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }

        .ldb-btn-secondary:hover,
        .gclip-btn-secondary:hover {
            background: rgba(148, 163, 184, 0.18);
        }

        .ldb-btn-secondary:active,
        .gclip-btn-secondary:active {
            background: rgba(148, 163, 184, 0.22);
            transform: scale(0.97);
        }

        .ldb-btn-secondary:disabled,
        .gclip-btn-secondary:disabled {
            opacity: 0.65;
            cursor: not-allowed;
        }

        .ldb-btn-warning {
            border: 1px solid rgba(217, 119, 6, 0.35);
            background: linear-gradient(135deg, #f59e0b 0%, var(--ldb-ui-warning) 100%);
            color: #fff;
            transition: filter 0.15s ease, transform 0.15s ease;
        }

        .ldb-btn-warning:hover {
            filter: brightness(1.08);
        }

        .ldb-btn-warning:active {
            transform: scale(0.97);
        }

        .ldb-btn-warning:disabled {
            opacity: 0.65;
            cursor: not-allowed;
        }

        .ldb-btn-danger {
            border: 1px solid rgba(220, 38, 38, 0.35);
            background: linear-gradient(135deg, #ef4444 0%, var(--ldb-ui-danger) 100%);
            color: #fff;
            transition: filter 0.15s ease, transform 0.15s ease;
        }

        .ldb-btn-danger:hover {
            filter: brightness(1.08);
        }

        .ldb-btn-danger:active {
            transform: scale(0.97);
        }

        .ldb-btn-danger:disabled {
            opacity: 0.65;
            cursor: not-allowed;
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
        .ldb-text-success { color: var(--ldb-ui-success); }
        .ldb-text-danger { color: var(--ldb-ui-danger); }
        .ldb-text-info { color: var(--ldb-ui-accent); }
        .ldb-text-muted { color: var(--ldb-ui-muted); }
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
            .gclip-float-btn,
            .ldb-spin,
            .ldb-btn,
            .ldb-btn-secondary,
            .ldb-btn-warning,
            .ldb-btn-danger,
            .gclip-btn,
            .gclip-btn-secondary,
            .ldb-chat-chip,
            .ldb-source-option,
            .ldb-tab,
            .ldb-toggle-slider,
            .ldb-toggle-slider::before,
            .ldb-progress-fill,
            .ldb-status,
            .ldb-status-close {
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
            transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }

        .ldb-panel .ldb-chat-chip:hover,
        .ldb-notion-panel .ldb-chat-chip:hover {
            background: rgba(37, 99, 235, 0.16);
            border-color: rgba(37, 99, 235, 0.28);
        }

        .ldb-panel .ldb-chat-chip:active,
        .ldb-notion-panel .ldb-chat-chip:active {
            transform: scale(0.96);
            background: rgba(37, 99, 235, 0.22);
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

        @keyframes ldb-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .ldb-spin {
            display: inline-block;
            animation: ldb-spin 0.8s linear infinite;
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

;

module.exports = { DesignSystem };
