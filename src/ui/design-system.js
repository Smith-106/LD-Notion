"use strict";

const { CONFIG } = require("../config");
const { Storage } = require("../storage");
const { StyleManager } = require("./style-manager");

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
        // P3 3/3 共识(dsf+glm+qwen): 幂等——重复调用会累积 change 监听, 且旧 MediaQueryList
        // 引用被覆盖后无法解绑(handler 动态读取 _theme, 无需重新绑定)。
        if (DesignSystem._mediaQuery) return;
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

    // v3.14.7 (REV-05 UI-09): 公开重应用入口——面板/浮动按钮在 initTheme 之后动态创建时
    // 只带 data-ldb-root 不带 data-ldb-theme, 主题偏好被忽略; 创建方在 append 后调用一次。
    applyTheme: () => {
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
        // 同步所有主题切换按钮(F-UI-11:三态 auto→light→dark→auto,按钮图标反映当前偏好)
        document.querySelectorAll(".ldb-theme-btn").forEach(btn => {
            if (DesignSystem._theme === "auto") {
                btn.textContent = "🌗";
                btn.title = "跟随系统(自动)，点击切换亮色";
            } else {
                btn.textContent = effective === "dark" ? "☀️" : "🌙";
                btn.title = effective === "dark" ? "切换亮色模式" : "切换暗色模式";
            }
        });
    },

    toggleTheme: () => {
        // F-UI-11:三态循环 auto → light → dark → auto(auto 是默认值,一经点击不可丢失)
        const next = DesignSystem._theme === "auto"
            ? "light"
            : (DesignSystem._theme === "light" ? "dark" : "auto");
        DesignSystem.setTheme(next);
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
        .ldb-undo-toast,
        .ldb-confirm-dialog {
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
            
            /* Accent alpha variants for borders, hover backgrounds */
            --ldb-ui-accent-alpha-08: rgba(37, 99, 235, 0.08);
            --ldb-ui-accent-alpha-10: rgba(37, 99, 235, 0.10);
            --ldb-ui-accent-alpha-14: rgba(37, 99, 235, 0.14);
            --ldb-ui-accent-alpha-18: rgba(37, 99, 235, 0.18);
            --ldb-ui-accent-alpha-22: rgba(37, 99, 235, 0.22);
            --ldb-ui-accent-alpha-28: rgba(37, 99, 235, 0.28);
            --ldb-ui-accent-alpha-30: rgba(37, 99, 235, 0.30);
            --ldb-ui-accent-alpha-35: rgba(37, 99, 235, 0.35);
            --ldb-ui-accent-alpha-45: rgba(37, 99, 235, 0.45);

            --ldb-ui-success: #16a34a;
            --ldb-ui-warning: #d97706;
            --ldb-ui-danger: #dc2626;

            /* v3.14.7 (REV-21 UI-12): danger/success/warning alpha 变体——消除硬编码 rgba 绕过令牌 */
            --ldb-ui-danger-alpha-06: rgba(220, 38, 38, 0.06);
            --ldb-ui-danger-alpha-12: rgba(239, 68, 68, 0.12);
            --ldb-ui-danger-alpha-12b: rgba(220, 38, 38, 0.12);
            --ldb-ui-danger-alpha-35: rgba(220, 38, 38, 0.35);
            --ldb-ui-success-alpha-06: rgba(22, 163, 74, 0.06);
            --ldb-ui-success-alpha-12: rgba(22, 163, 74, 0.12);
            --ldb-ui-success-alpha-35: rgba(22, 163, 74, 0.35);
            --ldb-ui-warning-alpha-35: rgba(217, 119, 6, 0.35);

            --ldb-ui-badge-teal: #0f766e;
            --ldb-ui-badge-blue: #1d4ed8;

            --ldb-ui-focus-ring: rgba(37, 99, 235, 0.35);
            --ldb-ui-backdrop: rgba(2, 6, 23, 0.35);

            /* Tinted white toward brand hue (light blue) - preserves visual 1:1 */
            --ldb-ui-white: rgb(253, 253, 255);

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

            /* Motion tokens */
            --ldb-ui-ease-out: cubic-bezier(0.25, 1, 0.5, 1);
            --ldb-ui-ease-in: cubic-bezier(0.5, 0, 0.75, 0);
            --ldb-ui-duration-instant: 100ms;
            --ldb-ui-duration-fast: 150ms;
            --ldb-ui-duration-normal: 250ms;
            --ldb-ui-duration-slow: 400ms;
            --ldb-ui-duration-entrance: 500ms;

            /* Neutral overlay token - replaces rgba(148,163,184,α) everywhere (slate-400) */
            --ldb-ui-neutral-overlay: 148, 163, 184;

            --ldb-ui-warning-bright: #f59e0b;
            --ldb-ui-success-bright: #10b981;
            --ldb-ui-danger-bright: #ef4444;

            --ldb-ui-disabled-opacity: 0.5;
            --ldb-ui-disabled-cursor: not-allowed;

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
        [data-ldb-theme="dark"].ldb-confirm-dialog,
        [data-ldb-theme="dark"] .ldb-panel,
        [data-ldb-theme="dark"] .ldb-notion-panel,
        [data-ldb-theme="dark"] .gclip-panel,
        [data-ldb-theme="dark"] .ldb-notion-float-btn,
        [data-ldb-theme="dark"] .ldb-mini-btn,
        [data-ldb-theme="dark"] .gclip-float-btn,
        [data-ldb-theme="dark"] .ldb-undo-toast,
        [data-ldb-theme="dark"] .ldb-confirm-dialog {
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
            /* Tinted near-black toward brand hue for dark backdrop */
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
            .ldb-confirm-dialog:not([data-ldb-theme]),
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
                /* Tinted near-black toward brand hue for dark backdrop */
                --ldb-ui-backdrop: rgba(0, 0, 0, 0.45);
            }
        }

        .ldb-panel,
        .ldb-notion-panel,
        .gclip-panel,
        .ldb-undo-toast {
            color: var(--ldb-ui-text);
        }

        /* UndoManager 撤销 toast — 与 .ldb-confirm-overlay 同型诞生缺陷: 无布局样式时
           裸 block append 到 body 末尾, 长页面下视口外不可见, 用户删错无法撤销 */
        .ldb-undo-toast {
            position: fixed;
            right: 24px;
            bottom: 24px;
            z-index: 2147483641;
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--ldb-ui-surface);
            border: 1px solid var(--ldb-ui-border);
            border-radius: var(--ldb-ui-radius-sm);
            box-shadow: var(--ldb-ui-shadow);
            padding: 10px 14px;
            max-width: min(420px, calc(100vw - 48px));
            overflow: hidden;
        }
        .ldb-undo-message {
            flex: 1;
            font-size: var(--ldb-ui-font-size-sm);
        }
        .ldb-undo-btn {
            flex-shrink: 0;
            padding: 4px 12px;
            border-radius: var(--ldb-ui-radius-xs);
            border: 1px solid transparent;
            background: var(--ldb-ui-accent);
            color: #fff;
            cursor: pointer;
            font-size: var(--ldb-ui-font-size-sm);
        }
        .ldb-undo-progress {
            position: absolute;
            left: 0;
            bottom: 0;
            width: 100%;
            height: 3px;
            background: var(--ldb-ui-accent);
        }
        .ldb-undo-progress-bar {
            height: 100%;
            background: var(--ldb-ui-accent-2);
            /* JS 未驱动宽度: 纯 CSS 动画对齐 CONFIG.API.UNDO_TIMEOUT(5000ms)撤销窗口 */
            animation: ldb-undo-countdown 5s linear forwards;
        }
        @keyframes ldb-undo-countdown {
            from { width: 100%; }
            to { width: 0%; }
        }
        /* UndoManager 依 remove/add .visible 控制淡入淡出(hideToast 后 300ms remove) */
        .ldb-undo-toast {
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 0.25s ease-out, transform 0.25s ease-out;
            pointer-events: none;
        }
        .ldb-undo-toast.visible {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
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

        /* Odyssey Review F5: pointer 拖拽表面禁用浏览器触摸手势,
           防触屏上 pointerdown 后立即 pointercancel 导致拖不动 */
        .ldb-header,
        .ldb-notion-header,
        .ldb-notion-float-btn,
        .gclip-float-btn,
        .ldb-resize-handle {
            touch-action: none;
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
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 90%);
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
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 88%);
            transition: background var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out);
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
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 82%);
        }

        .ldb-btn,
        .gclip-btn {
            border: 1px solid var(--ldb-ui-accent-alpha-35);
            background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
            color: var(--ldb-ui-white);
            border-radius: 12px;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
            font-weight: 650;
            transition: transform var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out), box-shadow var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out), filter var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out);
        }

        .ldb-btn:not(:disabled):hover,
        .gclip-btn:not(:disabled):hover {
            filter: brightness(1.08);
            box-shadow: 0 2px 8px var(--ldb-ui-accent-alpha-18);
        }

        .ldb-btn:not(:disabled):active,
        .gclip-btn:not(:disabled):active {
            transform: scale(0.97);
            filter: brightness(0.96);
        }

        .ldb-btn:disabled,
        .gclip-btn:disabled {
            opacity: var(--ldb-ui-disabled-opacity);
            cursor: var(--ldb-ui-disabled-cursor);
        }

        .ldb-btn-secondary,
        .gclip-btn-secondary {
            border: 1px solid var(--ldb-ui-border);
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 88%);
            color: var(--ldb-ui-text);
            font-weight: 600;
            transition: background var(--ldb-ui-duration-normal) var(--ldb-ui-ease-out), border-color var(--ldb-ui-duration-normal) var(--ldb-ui-ease-out), transform var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out);
        }

        .ldb-btn-secondary:hover,
        .gclip-btn-secondary:hover {
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 82%);
        }

        .ldb-btn-secondary:active,
        .gclip-btn-secondary:active {
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 78%);
            transform: scale(0.97);
        }

        .ldb-btn-secondary:disabled,
        .gclip-btn-secondary:disabled {
            opacity: var(--ldb-ui-disabled-opacity);
            cursor: var(--ldb-ui-disabled-cursor);
        }

        .ldb-btn-warning {
            border: 1px solid rgba(217, 119, 6, 0.35);
            background: linear-gradient(135deg, var(--ldb-ui-warning-bright) 0%, var(--ldb-ui-warning) 100%);
            color: var(--ldb-ui-white);
            transition: filter var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out), transform var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out);
        }

        .ldb-btn-warning:hover {
            filter: brightness(1.08);
        }

        .ldb-btn-warning:active {
            transform: scale(0.97);
        }

        .ldb-btn-warning:disabled {
            opacity: var(--ldb-ui-disabled-opacity);
            cursor: var(--ldb-ui-disabled-cursor);
        }

        .ldb-btn-danger {
            border: 1px solid rgba(220, 38, 38, 0.35);
            background: linear-gradient(135deg, var(--ldb-ui-danger-bright) 0%, var(--ldb-ui-danger) 100%);
            color: var(--ldb-ui-white);
            transition: filter var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out), transform var(--ldb-ui-duration-fast) var(--ldb-ui-ease-out);
        }

        .ldb-btn-danger:hover {
            filter: brightness(1.08);
        }

        .ldb-btn-danger:active {
            transform: scale(0.97);
        }

        .ldb-btn-danger:disabled {
            opacity: var(--ldb-ui-disabled-opacity);
            cursor: var(--ldb-ui-disabled-cursor);
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
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 90%);
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
        .ldb-status.warning {
            border-color: rgba(245, 158, 11, 0.4);
            background: rgba(245, 158, 11, 0.12);
        }
        .ldb-status.info {
            border-color: rgba(37, 99, 235, 0.30);
            background: rgba(37, 99, 235, 0.10);
        }

        /* 就地状态文本 — 替代内联 color 样式，用于测试按钮旁等持久状态显示 */
        .ldb-status-text {
            font-weight: 500;
        }
        .ldb-status-text--danger { color: var(--ldb-ui-danger); }
        .ldb-status-text--success { color: var(--ldb-ui-success); }
        .ldb-status-text--warning { color: var(--ldb-ui-warning); }
        .ldb-status-text--accent { color: var(--ldb-ui-accent); }
        .ldb-status-text--muted { color: var(--ldb-ui-muted); }

        .ldb-status-close {
            width: 26px;
            height: 26px;
            border-radius: 10px;
            border: 1px solid var(--ldb-ui-border);
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 90%);
            color: var(--ldb-ui-text);
            cursor: pointer;
            flex: 0 0 auto;
            line-height: 1;
        }

        .ldb-status-close:hover {
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 82%);
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
            .ldb-status-close,
            .ldb-typing-dots,
            .ldb-typing-dots span {
                transition: none !important;
                animation: none !important;
                scroll-behavior: auto !important;
            }
        }

        /* ConfirmationDialog 全屏遮罩 + 居中卡片 — 诞生缺陷补齐(v2.5.0 起 .ldb-confirm-overlay
           从未有过 CSS, 对话框裸 display:block 流式 append 到 body 末尾, 长页面下视口外不可见,
           清空对话/关闭面板等所有确认类操作对用户表现为「按键失效」) */
        .ldb-confirm-overlay {
            position: fixed;
            inset: 0;
            /* 面板 zIndex 为 2147483640, 遮罩必须更高才能盖住面板自身弹出的确认框 */
            z-index: 2147483641;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(2, 6, 23, 0.45);
        }
        .ldb-confirm-dialog {
            background: var(--ldb-ui-surface-2);
            color: var(--ldb-ui-text);
            border: 1px solid var(--ldb-ui-border);
            border-radius: var(--ldb-ui-radius-md);
            box-shadow: var(--ldb-ui-shadow);
            max-width: 420px;
            width: calc(100vw - 48px);
            max-height: 80vh;
            overflow-y: auto;
            padding: 18px 20px;
            box-sizing: border-box;
        }
        .ldb-confirm-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
        }
        .ldb-confirm-title {
            font-weight: 600;
            font-size: var(--ldb-ui-font-size-md);
        }
        .ldb-confirm-body {
            margin-bottom: 14px;
        }
        .ldb-confirm-message {
            margin: 0 0 6px;
            line-height: 1.5;
        }
        .ldb-confirm-item-name {
            word-break: break-all;
        }
        .ldb-confirm-hint {
            font-size: var(--ldb-ui-font-size-sm);
            opacity: 0.75;
            margin-top: 4px;
        }
        .ldb-confirm-input-group {
            margin-top: 8px;
        }
        .ldb-confirm-input-group label {
            display: block;
            margin-bottom: 4px;
        }
        .ldb-confirm-input {
            width: 100%;
            box-sizing: border-box;
            padding: 6px 8px;
            border: 1px solid var(--ldb-ui-border);
            border-radius: var(--ldb-ui-radius-sm);
            background: var(--ldb-ui-surface-3);
            color: inherit;
        }
        .ldb-confirm-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
        }
        .ldb-confirm-countdown-bar {
            flex: 1;
            height: 3px;
            background: var(--ldb-ui-border);
            border-radius: 2px;
            overflow: hidden;
        }
        .ldb-confirm-countdown-fill {
            height: 100%;
            background: var(--ldb-ui-accent);
            transition: width 1s linear;
        }
        /* P3(glm, 主 agent 按 CSS 层叠复核): 原规则无作用域前缀且位于令牌样式之后,
           同特异性覆盖全局 .ldb-btn-secondary/.ldb-btn-danger 的渐变与边框——收窄到确认框。 */
        .ldb-confirm-dialog .ldb-btn {
            padding: 6px 14px;
            border-radius: var(--ldb-ui-radius-sm);
            border: 1px solid var(--ldb-ui-border);
            cursor: pointer;
            font-size: var(--ldb-ui-font-size-sm);
        }
        .ldb-confirm-dialog .ldb-btn-secondary {
            background: var(--ldb-ui-surface-3);
            color: inherit;
        }
        .ldb-confirm-dialog .ldb-btn-danger {
            background: var(--ldb-ui-danger);
            color: #fff;
            border-color: transparent;
        }
        .ldb-confirm-dialog .ldb-btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
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
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 65%);
            border-radius: 3px;
        }

        @media (prefers-color-scheme: dark) {
            .ldb-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-track,
            .ldb-notion-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.06);
            }
            .ldb-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-thumb,
            .ldb-notion-panel:not([data-ldb-theme]) .ldb-chat-container::-webkit-scrollbar-thumb {
                background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 70%);
            }
        }

        [data-ldb-theme="dark"] .ldb-chat-container::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.06);
        }
        [data-ldb-theme="dark"] .ldb-chat-container::-webkit-scrollbar-thumb {
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 70%);
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
            transition: background var(--ldb-ui-duration-normal) var(--ldb-ui-ease-out), border-color var(--ldb-ui-duration-normal) var(--ldb-ui-ease-out), transform var(--ldb-ui-duration-instant) var(--ldb-ui-ease-out);
        }

        .ldb-panel .ldb-chat-chip:hover,
        .ldb-notion-panel .ldb-chat-chip:hover {
            background: var(--ldb-ui-accent-alpha-18);
            border-color: var(--ldb-ui-accent-alpha-28);
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
            color: var(--ldb-ui-white);
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
            color: var(--ldb-ui-white);
            cursor: pointer;
            user-select: none;
        }

        .ldb-panel .ldb-chat-send-btn:disabled,
        .ldb-notion-panel .ldb-chat-send-btn:disabled {
            opacity: var(--ldb-ui-disabled-opacity);
            cursor: var(--ldb-ui-disabled-cursor);
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
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 88%);
            color: var(--ldb-ui-text);
            cursor: pointer;
            user-select: none;
            font-size: 12px;
        }

        .ldb-panel .ldb-chat-action-btn:hover,
        .ldb-notion-panel .ldb-chat-action-btn:hover {
            background: color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent 82%);
        }
    `,
};

;

module.exports = { DesignSystem };
