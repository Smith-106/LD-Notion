// ==UserScript==
// @name         LD-Notion Hub — AI 多源知识中枢
// @namespace    https://linux.do/
// @version      3.4.3
// @description  将 Linux.do 与 Notion 深度连接：AI 对话式助手自然语言管理 Notion 工作区，批量导出收藏帖子到 Notion，GitHub 全类型导入（Stars/Repos/Forks/Gists），浏览器书签导入，跨源智能搜索与推荐，AI 自动分类与批量打标签
// @author       基于 flobby 和 JackLiii 的作品改编
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js
// @downloadURL  https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js
// @match        https://linux.do/*
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://github.com/*
// @match        https://www.github.com/*
// @match        *://*/*
// @exclude      https://www.google.com/*
// @exclude      https://www.google.com.hk/*
// @exclude      https://www.baidu.com/*
// @exclude      https://www.bing.com/*
// @exclude      https://duckduckgo.com/*
// @exclude      https://mail.google.com/*
// @exclude      https://outlook.live.com/*
// @exclude      *://localhost/*
// @exclude      *://localhost:*/*
// @exclude      *://127.0.0.1/*
// @exclude      *://127.0.0.1:*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.notion.com
// @connect      linux.do
// @connect      *.amazonaws.com
// @connect      s3.amazonaws.com
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.github.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    // ===========================================
    // 配置常量
    // ===========================================
    const CONFIG = {
        // 存储键
        STORAGE_KEYS: {
            NOTION_API_KEY: "ldb_notion_api_key",
            NOTION_DATABASE_ID: "ldb_notion_database_id",
            FILTER_ONLY_FIRST: "ldb_filter_only_first",
            FILTER_ONLY_OP: "ldb_filter_only_op",
            FILTER_RANGE_START: "ldb_filter_range_start",
            FILTER_RANGE_END: "ldb_filter_range_end",
            IMG_MODE: "ldb_img_mode",
            PANEL_MINIMIZED: "ldb_panel_minimized",
            EXPORTED_TOPICS: "ldb_exported_topics",
            // 权限控制
            PERMISSION_LEVEL: "ldb_permission_level",
            REQUIRE_CONFIRM: "ldb_require_confirm",
            ENABLE_AUDIT_LOG: "ldb_enable_audit_log",
            OPERATION_LOG: "ldb_operation_log",
            REQUEST_DELAY: "ldb_request_delay",
            // AI 分类
            AI_SERVICE: "ldb_ai_service",
            AI_API_KEY: "ldb_ai_api_key",
            AI_MODEL: "ldb_ai_model",
            AI_CATEGORIES: "ldb_ai_categories",
            AI_BASE_URL: "ldb_ai_base_url",
            // AI 对话历史
            CHAT_HISTORY: "ldb_chat_history",
            // 导出目标配置
            EXPORT_TARGET_TYPE: "ldb_export_target_type",
            PARENT_PAGE_ID: "ldb_parent_page_id",
            // Notion 站点 UI
            NOTION_PANEL_POSITION: "ldb_notion_panel_position",
            NOTION_PANEL_MINIMIZED: "ldb_notion_panel_minimized",
            FLOAT_BTN_POSITION: "ldb_float_btn_position",
            // 模型缓存
            FETCHED_MODELS: "ldb_fetched_models",
            // 工作区页面缓存
            WORKSPACE_PAGES: "ldb_workspace_pages",
            // 自动导入
            AUTO_IMPORT_ENABLED: "ldb_auto_import_enabled",
            AUTO_IMPORT_INTERVAL: "ldb_auto_import_interval",
            EXPORT_CONCURRENCY: "ldb_export_concurrency",
            // AI 查询目标数据库
            AI_TARGET_DB: "ldb_ai_target_db",
            // 工作区获取页数上限
            WORKSPACE_MAX_PAGES: "ldb_workspace_max_pages",
            // Agent 个性化
            AGENT_PERSONA_NAME: "ldb_agent_persona_name",
            AGENT_PERSONA_TONE: "ldb_agent_persona_tone",
            AGENT_PERSONA_EXPERTISE: "ldb_agent_persona_expertise",
            AGENT_PERSONA_INSTRUCTIONS: "ldb_agent_persona_instructions",
            // AI 输出模板
            AI_TEMPLATES: "ldb_ai_templates",
            // GitHub 收藏导入
            GITHUB_USERNAME: "ldb_github_username",
            GITHUB_TOKEN: "ldb_github_token",
            GITHUB_EXPORTED_REPOS: "ldb_github_exported_repos",
            GITHUB_IMPORT_TYPES: "ldb_github_import_types",
            GITHUB_EXPORTED_GISTS: "ldb_github_exported_gists",
            GITHUB_AUTO_IMPORT_ENABLED: "ldb_github_auto_import_enabled",
            GITHUB_AUTO_IMPORT_INTERVAL: "ldb_github_auto_import_interval",
            BOOKMARK_SOURCE: "ldb_bookmark_source",
            LINUXDO_IMPORT_DEDUP_MODE: "ldb_linuxdo_import_dedup_mode",
            BOOKMARK_IMPORT_DEDUP_MODE: "ldb_bookmark_import_dedup_mode",
            AI_CATEGORY_AUTO_DEDUP: "ldb_ai_category_auto_dedup",
            // 更新检查
            UPDATE_AUTO_CHECK_ENABLED: "ldb_update_auto_check_enabled",
            UPDATE_CHECK_INTERVAL_HOURS: "ldb_update_check_interval_hours",
            UPDATE_LAST_CHECK_AT: "ldb_update_last_check_at",
            UPDATE_LAST_SEEN_VERSION: "ldb_update_last_seen_version",
            UPDATE_LAST_RESULT: "ldb_update_last_result",
            // 浏览器书签导入
            BOOKMARK_EXPORTED: "ldb_bookmark_exported",
            BOOKMARK_IMPORT_FOLDERS: "ldb_bookmark_import_folders",
            EXT_INSTALL_PROMPT_SHOWN: "ldb_ext_install_prompt_shown",
            MODE_CONFLICT_TIP_SHOWN: "ldb_mode_conflict_tip_shown",
            // 跨源设置
            CROSS_SOURCE_MODE: "ldb_cross_source_mode",
            // 面板尺寸记忆
            PANEL_SIZE_NOTION: "ldb_panel_size_notion",
            PANEL_SIZE_MAIN: "ldb_panel_size_main",
            PANEL_SIZE_GENERIC: "ldb_panel_size_generic",
            // UI 主题
            THEME_PREFERENCE: "ldb_theme_preference",
            // 面板 Tab 状态
            ACTIVE_TAB: "ldb_active_tab",
        },
        // 默认值
        DEFAULTS: {
            onlyFirst: false,
            onlyOp: false,
            rangeStart: 1,
            rangeEnd: 999999,
            imgMode: "upload", // upload, external, skip
            permissionLevel: 1, // 默认标准权限
            requireConfirm: true, // 默认需要确认
            enableAuditLog: true, // 默认开启审计日志
            requestDelay: 500, // 请求间隔（毫秒），防止被封
            // AI 分类默认值
            aiService: "openai",
            aiModel: "",
            aiCategories: "技术, 生活, 问答, 分享, 资源, 其他",
            aiBaseUrl: "",
            // 导出目标默认值
            exportTargetType: "database", // database 或 page
            // 自动导入默认值
            autoImportEnabled: false,
            autoImportInterval: 5, // 分钟，0=仅页面加载时
            githubAutoImportEnabled: false,
            githubAutoImportInterval: 5,
            bookmarkSource: "linuxdo",
            linuxdoImportDedupMode: "strict",
            bookmarkImportDedupMode: "strict",
            aiCategoryAutoDedup: true,
            updateAutoCheckEnabled: true,
            updateCheckIntervalHours: 24,
            exportConcurrency: 1, // 并发导出数量
            workspaceMaxPages: 10, // 刷新工作区时的分页上限
            // Agent 个性化默认值
            agentPersonaName: "AI 助手",
            agentPersonaTone: "友好",
            agentPersonaExpertise: "Notion 工作区管理",
            agentPersonaInstructions: "",
            // AI 输出模板默认值
            aiTemplates: JSON.stringify([
                { name: "周报", prompt: "根据以下内容生成一份工作周报，包含：本周完成、下周计划、问题与风险。使用 Markdown 格式。", icon: "📋" },
                { name: "摘要提纲", prompt: "为以下内容生成一份详细的结构化提纲，使用层级编号。使用 Markdown 格式。", icon: "📝" },
                { name: "SWOT 分析", prompt: "对以下内容进行 SWOT 分析（优势、劣势、机会、威胁），使用 Markdown 表格格式。", icon: "📊" },
                { name: "行动计划", prompt: "根据以下内容提炼出具体的行动计划，包含：目标、步骤、负责人、截止时间。使用 Markdown 格式。", icon: "🎯" },
            ]),
            // GitHub 导入类型默认值
            githubImportTypes: JSON.stringify(["stars"]),
            // 跨源模式默认值
            crossSourceMode: "separate",  // separate(分库) 或 unified(统一库)
        },
        // 导出目标类型
        EXPORT_TARGET_TYPES: {
            DATABASE: "database",
            PAGE: "page",
        },
        // 权限级别
        PERMISSION_LEVELS: {
            READONLY: 0,   // 只读: 搜索、查看
            STANDARD: 1,   // 标准: + 创建/更新页面
            ADVANCED: 2,   // 高级: + 移动、复制、删除
            ADMIN: 3,      // 管理员: + 完整用户管理
        },
        // 权限级别名称
        PERMISSION_NAMES: {
            0: "只读",
            1: "标准",
            2: "高级",
            3: "管理员",
        },
        // API
        API: {
            NOTION_VERSION: "2022-06-28",
            BATCH_SIZE: 20, // 每次加载的收藏数量
            UNDO_TIMEOUT: 5000, // 撤销窗口时间 (ms)
            MAX_LOG_ENTRIES: 100, // 最大日志条目数
        },
    };

    // ===========================================
    // 工具函数
    // ===========================================
    const Utils = {
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

        absoluteUrl: (src) => {
            if (!src) return "";
            if (src.startsWith("http://") || src.startsWith("https://")) return src;
            if (src.startsWith("//")) return window.location.protocol + src;
            if (src.startsWith("/")) return window.location.origin + src;
            return window.location.origin + "/" + src.replace(/^\.?\//, "");
        },

        getUsernameFromUrl: () => {
            const match = window.location.pathname.match(/\/u\/([^/]+)/);
            return match ? match[1] : null;
        },

        getCurrentLinuxDoUsername: () => {
            let username = Utils.getUsernameFromUrl();
            if (username) return username;

            const meta = document.querySelector('meta[name="current-user-username"]');
            username = (meta?.content || "").trim();
            if (username) return username;

            const headerAvatar = document.querySelector(".header-dropdown-toggle .avatar");
            username = (headerAvatar?.getAttribute("title") || headerAvatar?.getAttribute("alt") || "").trim();
            if (username) return username;

            try {
                const discourseUser = window.Discourse?.User?.current?.();
                username = (discourseUser?.username || "").trim();
                if (username) return username;
            } catch {}

            return "";
        },

        formatDate: (dateStr) => {
            if (!dateStr) return "";
            return new Date(dateStr).toLocaleString("zh-CN");
        },

        truncateText: (text, maxLen = 100) => {
            if (!text || text.length <= maxLen) return text;
            return text.substring(0, maxLen) + "...";
        },

        base64DecodeUnicode: (input) => {
            if (!input) return "";
            try {
                const normalized = String(input).replace(/\s+/g, "");
                const binary = atob(normalized);
                const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
                return new TextDecoder("utf-8").decode(bytes);
            } catch {
                return "";
            }
        },

        // HTML 转义，防止 XSS 攻击
        escapeHtml: (text) => {
            if (!text) return "";
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        // 从 Notion 页面对象提取标题
        getPageTitle: (page, fallback = "无标题") => {
            if (!page?.properties) return fallback;
            // 常见标题属性名
            const titleProps = ["title", "标题", "Name", "名称"];
            for (const propName of titleProps) {
                const prop = page.properties[propName];
                if (prop?.title?.[0]?.plain_text) {
                    return prop.title[0].plain_text;
                }
            }
            // 遍历所有属性找 title 类型
            for (const prop of Object.values(page.properties)) {
                if (prop.type === "title" && prop.title?.[0]?.plain_text) {
                    return prop.title[0].plain_text;
                }
            }
            return fallback;
        },

        getLinuxDoImportDedupMode: () => {
            const mode = Storage.get(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.linuxdoImportDedupMode);
            return mode === "allow_duplicates" ? "allow_duplicates" : "strict";
        },

        isLinuxDoDedupStrict: () => Utils.getLinuxDoImportDedupMode() === "strict",

        getBookmarkImportDedupMode: () => {
            const mode = Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.bookmarkImportDedupMode);
            return mode === "allow_duplicates" ? "allow_duplicates" : "strict";
        },

        isBookmarkDedupStrict: () => Utils.getBookmarkImportDedupMode() === "strict",

        parseAICategories: (raw, autoDedupEnabled = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORY_AUTO_DEDUP, CONFIG.DEFAULTS.aiCategoryAutoDedup)) => {
            const categories = String(raw || "")
                .split(/[,，]/)
                .map(c => c.trim())
                .filter(Boolean);
            if (!autoDedupEnabled) return categories;
            const seen = new Set();
            return categories.filter((item) => {
                if (seen.has(item)) return false;
                seen.add(item);
                return true;
            });
        },
    };

    // ===========================================
    // 存储管理
    // ===========================================
    const Storage = {
        _exportedTopicsCache: null,

        get: (key, defaultValue = null) => {
            const value = GM_getValue(key, defaultValue);
            return value;
        },

        set: (key, value) => {
            GM_setValue(key, value);
        },

        getExportedTopics: () => {
            if (Storage._exportedTopicsCache) {
                return Storage._exportedTopicsCache;
            }

            const data = GM_getValue(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, "{}");
            try {
                Storage._exportedTopicsCache = JSON.parse(data);
            } catch {
                Storage._exportedTopicsCache = {};
            }
            return Storage._exportedTopicsCache;
        },

        markTopicExported: (topicId) => {
            const exported = Storage.getExportedTopics();
            exported[topicId] = Date.now();
            Storage._exportedTopicsCache = exported;
            GM_setValue(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, JSON.stringify(exported));
        },

        isTopicExported: (topicId) => {
            const exported = Storage.getExportedTopics();
            return !!exported[topicId];
        },
    };

    // ===========================================
    // 站点检测模块
    // ===========================================
    const SiteDetector = {
        SITES: {
            LINUX_DO: "linux_do",
            NOTION: "notion",
            GITHUB: "github",
            GENERIC: "generic",
        },

        // 检测当前站点（精确匹配，防止域名仿冒）
        detect: () => {
            const hostname = window.location.hostname;
            if (hostname === "linux.do" || hostname.endsWith(".linux.do")) {
                return SiteDetector.SITES.LINUX_DO;
            }
            if (hostname === "notion.so" || hostname === "www.notion.so" || hostname.endsWith(".notion.so")) {
                return SiteDetector.SITES.NOTION;
            }
            if (hostname === "github.com" || hostname === "www.github.com") {
                return SiteDetector.SITES.GITHUB;
            }
            return SiteDetector.SITES.GENERIC;
        },

        // 判断是否在 Linux.do 站点
        isLinuxDo: () => {
            return SiteDetector.detect() === SiteDetector.SITES.LINUX_DO;
        },

        // 判断是否在 Notion 站点
        isNotion: () => {
            return SiteDetector.detect() === SiteDetector.SITES.NOTION;
        },

        // 判断是否在 GitHub 站点
        isGitHub: () => {
            return SiteDetector.detect() === SiteDetector.SITES.GITHUB;
        },

        // 判断是否在通用网页
        isGeneric: () => {
            return SiteDetector.detect() === SiteDetector.SITES.GENERIC;
        },
    };

    const InstallHelper = {
        BOOKMARK_EXTENSION_URL: "https://github.com/Smith-106/LD-Notion/releases/latest",

        getBookmarkExtensionUrl: () => InstallHelper.BOOKMARK_EXTENSION_URL,

        renderInstallLink: (label = "一键安装浏览器扩展") => {
            const url = InstallHelper.getBookmarkExtensionUrl();
            return `<a href="${url}" target="_blank" class="ldb-link">${label}</a>`;
        },

        openBookmarkExtensionInstall: () => {
            window.open(InstallHelper.getBookmarkExtensionUrl(), "_blank", "noopener,noreferrer");
        },
    };

    // ===========================================
    // Emoji 映射表 (扩展版)
    // ===========================================
    const EMOJI_MAP = {
        // 笑脸表情
        grinning_face: "😀", smiley: "😃", grin: "😁", joy: "😂", rofl: "🤣",
        smile: "😊", blush: "😊", wink: "😉", heart_eyes: "😍", kissing_heart: "😘",
        thinking: "🤔", face_with_raised_eyebrow: "🤨", neutral_face: "😐", expressionless: "😑",
        unamused: "😒", roll_eyes: "🙄", grimacing: "😬", lying_face: "🤥",
        relieved: "😌", pensive: "😔", sleepy: "😪", drooling_face: "🤤", sleeping: "😴",
        mask: "😷", face_with_thermometer: "🤒", nauseated_face: "🤢", sneezing_face: "🤧",
        cold_face: "🥶", hot_face: "🥵", woozy_face: "🥴", exploding_head: "🤯",
        cowboy_hat_face: "🤠", partying_face: "🥳", sunglasses: "😎", nerd_face: "🤓",
        confused: "😕", worried: "😟", frowning: "☹️", open_mouth: "😮", hushed: "😯",
        astonished: "😲", flushed: "😳", pleading_face: "🥺", cry: "😢", sob: "😭",
        scream: "😱", angry: "😠", rage: "😡", skull: "💀", poop: "💩",
        clown_face: "🤡", ghost: "👻", alien: "👽", robot: "🤖",
        // 手势
        thumbsup: "👍", thumbsdown: "👎", "+1": "👍", "-1": "👎",
        ok_hand: "👌", pinched_fingers: "🤌", pinching_hand: "🤏",
        victory_hand: "✌️", v: "✌️", crossed_fingers: "🤞", love_you_gesture: "🤟",
        metal: "🤘", call_me_hand: "🤙", point_left: "👈", point_right: "👉",
        point_up: "👆", point_down: "👇", raised_hand: "✋", wave: "👋",
        clap: "👏", raised_hands: "🙌", open_hands: "👐", palms_up_together: "🤲",
        handshake: "🤝", pray: "🙏", muscle: "💪", punch: "👊", fist: "✊",
        // 心形
        heart: "❤️", orange_heart: "🧡", yellow_heart: "💛", green_heart: "💚",
        blue_heart: "💙", purple_heart: "💜", black_heart: "🖤", white_heart: "🤍",
        broken_heart: "💔", sparkling_heart: "💖", heartpulse: "💗", heartbeat: "💓",
        revolving_hearts: "💞", two_hearts: "💕", heart_exclamation: "❣️",
        // 符号
        fire: "🔥", star: "⭐", star2: "🌟", sparkles: "✨", zap: "⚡",
        check: "✅", white_check_mark: "✅", x: "❌", cross_mark: "❌",
        warning: "⚠️", question: "❓", exclamation: "❗", no_entry: "⛔",
        rocket: "🚀", bulb: "💡", book: "📖", bookmark: "🔖",
        "100": "💯", boom: "💥", collision: "💥", dizzy: "💫",
        speech_balloon: "💬", thought_balloon: "💭", zzz: "💤",
        // 动物
        dog: "🐕", cat: "🐱", mouse: "🐭", rabbit: "🐰", fox: "🦊",
        bear: "🐻", panda: "🐼", koala: "🐨", tiger: "🐯", lion: "🦁",
        cow: "🐮", pig: "🐷", frog: "🐸", monkey: "🐒", chicken: "🐔",
        penguin: "🐧", bird: "🐦", eagle: "🦅", owl: "🦉", bat: "🦇",
        // 食物
        apple: "🍎", banana: "🍌", orange: "🍊", lemon: "🍋", grapes: "🍇",
        watermelon: "🍉", strawberry: "🍓", peach: "🍑", pizza: "🍕", hamburger: "🍔",
        coffee: "☕", tea: "🍵", beer: "🍺", wine_glass: "🍷", cake: "🍰",
        // 物品
        gift: "🎁", balloon: "🎈", tada: "🎉", trophy: "🏆", medal_sports: "🏅",
        first_place_medal: "🥇", second_place_medal: "🥈", third_place_medal: "🥉",
        computer: "💻", keyboard: "⌨️", phone: "📱", email: "📧", memo: "📝",
        lock: "🔒", unlock: "🔓", key: "🔑", gear: "⚙️", hammer: "🔨",
        // 交通与天气
        car: "🚗", airplane: "✈️", sun: "☀️", cloud: "☁️", umbrella: "☂️",
        rainbow: "🌈", snowflake: "❄️", globe_showing_asia_australia: "🌏",
        // 杂项
        eyes: "👀", eye: "👁️", brain: "🧠", tongue: "👅", lips: "👄",
        baby: "👶", man: "👨", woman: "👩", family: "👪",
        clock: "🕐", hourglass: "⌛", stopwatch: "⏱️",
    };

    // ===========================================
    // Notion 语言映射
    // ===========================================
    const NOTION_LANGUAGES = new Set([
        "javascript", "typescript", "python", "java", "c", "c++", "c#", "go", "rust",
        "ruby", "php", "swift", "kotlin", "scala", "html", "css", "sql", "shell",
        "bash", "powershell", "json", "yaml", "xml", "markdown", "plain text"
    ]);

    const normalizeLanguage = (lang) => {
        if (!lang) return "plain text";
        const lower = lang.toLowerCase().trim();
        if (NOTION_LANGUAGES.has(lower)) return lower;

        const aliases = {
            js: "javascript", ts: "typescript", py: "python",
            rb: "ruby", sh: "shell", yml: "yaml", md: "markdown",
            cpp: "c++", csharp: "c#", cs: "c#", golang: "go", rs: "rust",
        };
        return aliases[lower] || "plain text";
    };

    // ===========================================
    // DOM 转 Notion Blocks
    // ===========================================
    const DOMToNotion = {
        splitLongText: (text, annotations = {}) => {
            const maxLength = 2000;
            const maxItems = 100; // Notion API 限制
            const chunks = [];
            if (text.length <= maxLength) {
                chunks.push({ type: "text", text: { content: text }, annotations: { ...annotations } });
            } else {
                let remaining = text;
                while (remaining.length > 0 && chunks.length < maxItems) {
                    const chunk = remaining.substring(0, maxLength);
                    chunks.push({ type: "text", text: { content: chunk }, annotations: { ...annotations } });
                    remaining = remaining.substring(maxLength);
                }
            }
            return chunks;
        },

        serializeRichText: (node) => {
            const result = [];

            const processNode = (n, annotations = {}) => {
                if (!n) return;

                if (n.nodeType === Node.TEXT_NODE) {
                    const text = n.nodeValue || "";
                    if (text) result.push(...DOMToNotion.splitLongText(text, annotations));
                    return;
                }

                if (n.nodeType !== Node.ELEMENT_NODE) return;

                const el = n;
                const tag = el.tagName.toLowerCase();

                // 处理 emoji 图片
                if (tag === "img") {
                    const src = el.getAttribute("src") || "";
                    const emojiMatch = src.match(/\/images\/emoji\/(?:twemoji|apple|google|twitter)\/([^/.]+)\.png/i);
                    if (emojiMatch) {
                        const emojiName = emojiMatch[1];
                        const emoji = EMOJI_MAP[emojiName] || el.getAttribute("alt") || `:${emojiName}:`;
                        if (emoji) result.push({ type: "text", text: { content: emoji }, annotations: { ...annotations } });
                    }
                    return;
                }

                // 处理链接
                if (tag === "a") {
                    const href = el.getAttribute("href") || "";
                    if (href.startsWith("#")) {
                        Array.from(el.childNodes).forEach((c) => processNode(c, annotations));
                        return;
                    }
                    const link = Utils.absoluteUrl(href);
                    const linkText = el.textContent || link;
                    if (link && linkText) {
                        const chunks = DOMToNotion.splitLongText(linkText, annotations);
                        chunks.forEach(chunk => { chunk.text.link = { url: link }; });
                        result.push(...chunks);
                    }
                    return;
                }

                // 处理格式标签
                if (tag === "strong" || tag === "b") {
                    Array.from(el.childNodes).forEach((c) => processNode(c, { ...annotations, bold: true }));
                    return;
                }
                if (tag === "em" || tag === "i") {
                    Array.from(el.childNodes).forEach((c) => processNode(c, { ...annotations, italic: true }));
                    return;
                }
                if (tag === "s" || tag === "del") {
                    Array.from(el.childNodes).forEach((c) => processNode(c, { ...annotations, strikethrough: true }));
                    return;
                }
                if (tag === "code") {
                    const text = el.textContent || "";
                    if (text) result.push(...DOMToNotion.splitLongText(text, { ...annotations, code: true }));
                    return;
                }

                // 其他元素递归处理
                Array.from(el.childNodes).forEach((c) => processNode(c, annotations));
            };

            processNode(node);
            // Notion API 限制 rich_text 数组最多 100 个元素
            return result.slice(0, 100);
        },

        cookedToBlocks: (cookedHtml, imgMode = "upload") => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(cookedHtml || "", "text/html");
            const root = doc.body;
            const blocks = [];

            const processElement = (el) => {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

                const tag = el.tagName.toLowerCase();

                // 跳过元信息容器
                if (el.classList && el.classList.contains('meta')) return;

                // 处理图片容器
                if (el.classList && (el.classList.contains('lightbox-wrapper') || el.classList.contains('image-wrapper'))) {
                    const img = el.querySelector("img");
                    if (img) {
                        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
                        const full = Utils.absoluteUrl(src);
                        if (full && !src.includes("/images/emoji/")) {
                            if (imgMode === "skip") return;
                            blocks.push({
                                type: "image",
                                image: { type: "external", external: { url: full } },
                                _needsUpload: imgMode === "upload",
                                _originalUrl: full,
                            });
                        }
                    }
                    return;
                }

                // 处理引用块
                if (tag === "aside" && el.classList.contains("quote")) {
                    const blockquote = el.querySelector("blockquote");
                    if (blockquote) {
                        const richText = DOMToNotion.serializeRichText(blockquote);
                        if (richText.length > 0) {
                            blocks.push({ type: "quote", quote: { rich_text: richText } });
                        }
                    }
                    return;
                }

                // 处理段落
                if (tag === "p") {
                    const richText = DOMToNotion.serializeRichText(el);
                    if (richText.length > 0) {
                        blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
                    }

                    // 处理段落中的图片
                    el.querySelectorAll("img").forEach((img) => {
                        const src = img.getAttribute("src") || "";
                        const full = Utils.absoluteUrl(src);
                        if (full && !src.includes("/images/emoji/")) {
                            if (imgMode !== "skip") {
                                blocks.push({
                                    type: "image",
                                    image: { type: "external", external: { url: full } },
                                    _needsUpload: imgMode === "upload",
                                    _originalUrl: full,
                                });
                            }
                        }
                    });
                    return;
                }

                // 处理代码块
                if (tag === "pre") {
                    const codeEl = el.querySelector("code");
                    const langClass = codeEl?.getAttribute("class") || "";
                    const rawLang = (langClass.match(/lang(?:uage)?-([a-z0-9_+-]+)/i) || [])[1] || "plain text";
                    const code = (codeEl ? codeEl.textContent : el.textContent) || "";

                    const richTextArray = DOMToNotion.splitLongText(code);
                    blocks.push({
                        type: "code",
                        code: { rich_text: richTextArray, language: normalizeLanguage(rawLang) },
                    });
                    return;
                }

                // 处理引用
                if (tag === "blockquote") {
                    const richText = DOMToNotion.serializeRichText(el);
                    if (richText.length > 0) {
                        blocks.push({ type: "quote", quote: { rich_text: richText } });
                    }
                    return;
                }

                // 处理标题 (h1-h6, h4-h6 降级为 h3)
                if (/^h[1-6]$/.test(tag)) {
                    let level = parseInt(tag.substring(1));
                    if (level > 3) level = 3; // Notion 只支持 h1-h3
                    const richText = DOMToNotion.serializeRichText(el);
                    if (richText.length > 0) {
                        blocks.push({ type: `heading_${level}`, [`heading_${level}`]: { rich_text: richText } });
                    }
                    return;
                }

                // 处理列表
                if (tag === "ul" || tag === "ol") {
                    const listType = tag === "ul" ? "bulleted_list_item" : "numbered_list_item";
                    Array.from(el.children).forEach((li) => {
                        if (li.tagName.toLowerCase() === "li") {
                            const richText = DOMToNotion.serializeRichText(li);
                            if (richText.length > 0) {
                                blocks.push({ type: listType, [listType]: { rich_text: richText } });
                            }
                        }
                    });
                    return;
                }

                // 处理表格
                if (tag === "table" || (el.classList && el.classList.contains('md-table'))) {
                    const table = tag === "table" ? el : el.querySelector("table");
                    if (!table) return;

                    const rows = [];
                    let hasHeader = false;

                    // 处理表头
                    const thead = table.querySelector("thead");
                    if (thead) {
                        hasHeader = true;
                        thead.querySelectorAll("tr").forEach((tr) => {
                            const cells = [];
                            tr.querySelectorAll("th, td").forEach((cell) => {
                                const richText = DOMToNotion.serializeRichText(cell);
                                cells.push(richText.length > 0 ? richText : [{ type: "text", text: { content: "" } }]);
                            });
                            if (cells.length > 0) rows.push(cells);
                        });
                    }

                    // 处理表体
                    const tbody = table.querySelector("tbody") || table;
                    tbody.querySelectorAll("tr").forEach((tr) => {
                        // 跳过 thead 中的行
                        if (tr.closest("thead")) return;
                        const cells = [];
                        tr.querySelectorAll("td, th").forEach((cell) => {
                            const richText = DOMToNotion.serializeRichText(cell);
                            cells.push(richText.length > 0 ? richText : [{ type: "text", text: { content: "" } }]);
                        });
                        if (cells.length > 0) rows.push(cells);
                    });

                    if (rows.length > 0) {
                        const tableWidth = Math.max(...rows.map(r => r.length));
                        blocks.push({
                            type: "table",
                            table: {
                                table_width: tableWidth,
                                has_column_header: hasHeader,
                                has_row_header: false,
                                children: rows.map(cells => ({
                                    type: "table_row",
                                    table_row: { cells }
                                }))
                            }
                        });
                    }
                    return;
                }

                // 处理独立图片
                if (tag === "img") {
                    const src = el.getAttribute("src") || "";
                    const full = Utils.absoluteUrl(src);
                    if (full && !src.includes("/images/emoji/")) {
                        if (imgMode !== "skip") {
                            blocks.push({
                                type: "image",
                                image: { type: "external", external: { url: full } },
                                _needsUpload: imgMode === "upload",
                                _originalUrl: full,
                            });
                        }
                    }
                    return;
                }

                // 递归处理子元素
                Array.from(el.children).forEach(processElement);
            };

            Array.from(root.children).forEach(processElement);
            return blocks;
        },
    };

    // ===========================================
    // Notion API 封装
    // ===========================================
    const NotionAPI = {
        request: (method, endpoint, data, apiKey, retries = 3) => {
            return new Promise((resolve, reject) => {
                const doRequest = (attempt) => {
                    GM_xmlhttpRequest({
                        method: method,
                        url: `https://api.notion.com/v1${endpoint}`,
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Content-Type": "application/json",
                            "Notion-Version": CONFIG.API.NOTION_VERSION,
                        },
                        data: data ? JSON.stringify(data) : undefined,
                        onload: async (response) => {
                            try {
                                // 处理速率限制
                                if (response.status === 429) {
                                    if (attempt < retries) {
                                        const retryAfter = parseInt(response.responseHeaders?.match(/retry-after:\s*(\d+)/i)?.[1]) || 1;
                                        console.warn(`Notion API 速率限制，${retryAfter}秒后重试 (${attempt + 1}/${retries})`);
                                        await Utils.sleep(retryAfter * 1000 + 500);
                                        doRequest(attempt + 1);
                                        return;
                                    }
                                }

                                const result = JSON.parse(response.responseText);
                                if (response.status >= 200 && response.status < 300) {
                                    resolve(result);
                                } else {
                                    reject(new Error(`Notion API 错误: ${result.message || response.status}`));
                                }
                            } catch (e) {
                                reject(new Error(`解析响应失败: ${e.message}`));
                            }
                        },
                        onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                    });
                };
                doRequest(0);
            });
        },

        // 验证 API Key 和 Database
        validateConfig: async (apiKey, databaseId) => {
            try {
                await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
                return { valid: true };
            } catch (error) {
                return { valid: false, error: error.message };
            }
        },

        // 自动设置数据库属性
        setupDatabaseProperties: async (databaseId, apiKey) => {
            // 定义所需的属性结构（名称 -> { 类型名, schema }）
            const requiredProperties = {
                "标题": { typeName: "title", schema: { title: {} } },
                "链接": { typeName: "url", schema: { url: {} } },
                "分类": { typeName: "rich_text", schema: { rich_text: {} } },
                "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
                "作者": { typeName: "rich_text", schema: { rich_text: {} } },
                "收藏时间": { typeName: "date", schema: { date: {} } },
                "帖子数": { typeName: "number", schema: { number: { format: "number" } } },
                "浏览数": { typeName: "number", schema: { number: { format: "number" } } },
                "点赞数": { typeName: "number", schema: { number: { format: "number" } } },
            };

            try {
                // 获取当前数据库结构
                const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
                const existingProps = database.properties || {};

                // 分析属性状态
                const propsToAdd = {};
                const propsToUpdate = {};
                const typeConflicts = [];

                for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                    const existingProp = existingProps[name];

                    if (!existingProp) {
                        // 属性不存在
                        if (typeName === "title") {
                            // 特殊处理：title 属性需要重命名现有的
                            const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                            if (existingTitle && existingTitle[0] !== name) {
                                propsToUpdate[existingTitle[0]] = { name: name };
                            }
                        } else {
                            propsToAdd[name] = schema;
                        }
                    } else if (existingProp.type !== typeName) {
                        // 属性存在但类型不匹配
                        typeConflicts.push({
                            name,
                            expected: typeName,
                            actual: existingProp.type
                        });
                    }
                    // 如果属性存在且类型匹配，无需处理
                }

                // 如果有类型冲突，返回错误信息
                if (typeConflicts.length > 0) {
                    const conflictDetails = typeConflicts.map(c =>
                        `"${c.name}": 期望 ${c.expected}，实际 ${c.actual}`
                    ).join("; ");
                    return {
                        success: false,
                        error: `属性类型不匹配: ${conflictDetails}。请手动修改这些属性的类型，或删除后重新运行自动设置。`
                    };
                }

                const allChanges = { ...propsToAdd, ...propsToUpdate };

                if (Object.keys(allChanges).length === 0) {
                    return { success: true, message: "所有属性已正确配置，无需更新" };
                }

                // 更新数据库
                await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                    properties: allChanges
                }, apiKey);

                const addedCount = Object.keys(propsToAdd).length;
                const renamedCount = Object.keys(propsToUpdate).length;
                let message = "";
                if (addedCount > 0) message += `已添加 ${addedCount} 个属性`;
                if (renamedCount > 0) message += `${addedCount > 0 ? "，" : ""}已重命名 ${renamedCount} 个属性`;

                return {
                    success: true,
                    message: message,
                    added: Object.keys(propsToAdd),
                    renamed: Object.keys(propsToUpdate)
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },

        // 创建数据库页面（帖子记录）
        createDatabasePage: async (databaseId, properties, children, apiKey) => {
            const data = {
                parent: { database_id: databaseId },
                properties: properties,
                children: children.slice(0, 100), // Notion 限制
            };

            const page = await NotionAPI.request("POST", "/pages", data, apiKey);

            // 如果有剩余的 blocks，追加
            if (children.length > 100) {
                await NotionAPI.appendBlocks(page.id, children.slice(100), apiKey);
            }

            return page;
        },

        // 在页面下创建子页面
        createPageInPage: async (parentPageId, properties, apiKey) => {
            const data = {
                parent: { page_id: parentPageId },
                properties: properties,
            };
            return await NotionAPI.request("POST", "/pages", data, apiKey);
        },

        // createPageInWorkspace 已移除：Notion API 不支持 parent: { workspace: true }
        // 创建页面必须指定 parent.page_id 或 parent.database_id

        // 在数据库中创建页面（简化版，无 children）
        createPage: async (databaseId, properties, apiKey) => {
            return await NotionAPI.createDatabasePage(databaseId, properties, [], apiKey);
        },

        // 追加 blocks
        appendBlocks: async (pageId, blocks, apiKey) => {
            for (let i = 0; i < blocks.length; i += 100) {
                const chunk = blocks.slice(i, i + 100);
                await NotionAPI.request("PATCH", `/blocks/${pageId}/children`, { children: chunk }, apiKey);
                await Utils.sleep(300); // 避免速率限制
            }
        },

        // 创建文件上传
        createFileUpload: async (filename, contentType, apiKey) => {
            return await NotionAPI.request("POST", "/file_uploads", {
                mode: "single_part",
                filename: filename,
                content_type: contentType,
            }, apiKey);
        },

        // 上传文件内容到预签名 URL
        uploadFileContent: (uploadUrl, blob, contentType, filename) => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
                    const uint8Array = new Uint8Array(reader.result);

                    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
                    const headerBytes = new TextEncoder().encode(header);
                    const footerBytes = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);

                    const body = new Uint8Array(headerBytes.length + uint8Array.length + footerBytes.length);
                    body.set(headerBytes, 0);
                    body.set(uint8Array, headerBytes.length);
                    body.set(footerBytes, headerBytes.length + uint8Array.length);

                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: uploadUrl,
                        headers: {
                            // 注意: 不要向 S3 预签名 URL 发送 Authorization 头
                            // 预签名 URL 已包含授权信息，发送 API Key 会造成安全泄露
                            'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        },
                        data: body.buffer,
                        binary: true,
                        onload: (response) => {
                            if (response.status === 200 || response.status === 204) {
                                resolve();
                            } else {
                                reject(new Error(`上传文件失败: ${response.status}`));
                            }
                        },
                        onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                    });
                };
                reader.onerror = () => reject(new Error("读取文件数据失败"));
                reader.readAsArrayBuffer(blob);
            });
        },

        // 下载并上传图片到 Notion（失败时回退为文件上传）
        uploadImageToNotion: async (imageUrl, apiKey, returnDetails = false) => {
            const uploadRemote = async (forceFileBlock = false) => {
                // 下载图片
                const response = await fetch(imageUrl);
                if (!response.ok) throw new Error(`下载失败: ${response.status}`);

                const blob = await response.blob();
                const urlObj = new URL(imageUrl);
                let ext = (urlObj.pathname.split(".").pop() || "").toLowerCase();
                const extToMime = {
                    jpg: "image/jpeg",
                    jpeg: "image/jpeg",
                    png: "image/png",
                    gif: "image/gif",
                    webp: "image/webp",
                    svg: "image/svg+xml",
                    bmp: "image/bmp",
                    ico: "image/x-icon",
                    avif: "image/avif",
                };
                if (!extToMime[ext]) ext = "png";

                const defaultImageMime = extToMime[ext] || "image/png";
                const contentType = forceFileBlock
                    ? "application/octet-stream"
                    : (blob.type || defaultImageMime);
                const filenamePrefix = forceFileBlock ? "file" : "image";
                const filename = `${filenamePrefix}-${Date.now()}.${ext}`;

                const fileUpload = await NotionAPI.createFileUpload(filename, contentType, apiKey);
                if (!fileUpload?.upload_url || !fileUpload?.id) throw new Error("创建上传失败");

                // 上传内容到预签名 URL (不需要 API Key)
                await NotionAPI.uploadFileContent(fileUpload.upload_url, blob, contentType, filename);

                if (!returnDetails) {
                    return fileUpload.id;
                }

                return {
                    fileId: fileUpload.id,
                    blockType: forceFileBlock ? "file" : "image",
                };
            };

            try {
                return await uploadRemote(false);
            } catch (error) {
                // Notion 付费套餐中图片通常受 5MB 限制，失败后回退为文件块上传
                console.warn("图片上传失败，尝试按文件上传:", imageUrl, error.message);
                try {
                    return await uploadRemote(true);
                } catch (fallbackError) {
                    console.error("文件回退上传失败:", fallbackError);
                    return null;
                }
            }
        },

        // ========== 搜索和读取操作 (READONLY) ==========

        // 搜索工作区
        search: async (query, filter, apiKey, startCursor = undefined) => {
            const data = { query };
            if (filter) {
                data.filter = filter; // { property: "object", value: "page" | "database" }
            }
            if (startCursor) {
                data.start_cursor = startCursor;
            }
            return await NotionAPI.request("POST", "/search", data, apiKey);
        },

        // 获取页面信息
        fetchPage: async (pageId, apiKey) => {
            return await NotionAPI.request("GET", `/pages/${pageId}`, null, apiKey);
        },

        // 获取块的子块
        fetchBlocks: async (blockId, cursor, apiKey) => {
            let endpoint = `/blocks/${blockId}/children`;
            if (cursor) endpoint += `?start_cursor=${cursor}`;
            return await NotionAPI.request("GET", endpoint, null, apiKey);
        },

        // 获取数据库信息
        fetchDatabase: async (databaseId, apiKey) => {
            return await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
        },

        // 更新数据库 Schema（添加/修改属性）
        updateDatabase: async (databaseId, properties, apiKey) => {
            return await NotionAPI.request("PATCH", `/databases/${databaseId}`, { properties }, apiKey);
        },

        // 查询数据库
        queryDatabase: async (databaseId, filter, sorts, cursor, apiKey) => {
            const data = {};
            if (filter) data.filter = filter;
            if (sorts) data.sorts = sorts;
            if (cursor) data.start_cursor = cursor;
            return await NotionAPI.request("POST", `/databases/${databaseId}/query`, data, apiKey);
        },

        // ========== 更新操作 (STANDARD) ==========

        // 更新页面属性
        updatePage: async (pageId, properties, apiKey) => {
            return await NotionAPI.request("PATCH", `/pages/${pageId}`, { properties }, apiKey);
        },

        // 更新块内容
        updateBlock: async (blockId, blockData, apiKey) => {
            return await NotionAPI.request("PATCH", `/blocks/${blockId}`, blockData, apiKey);
        },

        // ========== 高级操作 (ADVANCED) ==========

        // 移动页面到新父级
        movePage: async (pageId, newParentId, parentType, apiKey) => {
            const parent = parentType === "database"
                ? { database_id: newParentId }
                : { page_id: newParentId };
            return await NotionAPI.request("PATCH", `/pages/${pageId}`, { parent }, apiKey);
        },

        // 创建数据库
        createDatabase: async (parentPageId, title, properties, apiKey) => {
            const data = {
                parent: { type: "page_id", page_id: parentPageId },
                title: [{ type: "text", text: { content: title } }],
                properties: properties,
            };
            return await NotionAPI.request("POST", "/databases", data, apiKey);
        },

        // 复制页面 (获取内容后创建新页面)
        duplicatePage: async (pageId, targetParentId, parentType, apiKey) => {
            // 获取原页面信息
            const originalPage = await NotionAPI.fetchPage(pageId, apiKey);

            // 获取原页面的所有块
            const allBlocks = [];
            let cursor = null;
            do {
                const blocksData = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
                allBlocks.push(...(blocksData.results || []));
                cursor = blocksData.has_more ? blocksData.next_cursor : null;
            } while (cursor);

            // 准备新页面数据
            const parent = parentType === "database"
                ? { database_id: targetParentId }
                : { page_id: targetParentId };

            // 复制属性（排除系统生成的属性）
            const properties = {};
            for (const [key, value] of Object.entries(originalPage.properties || {})) {
                if (!["created_time", "created_by", "last_edited_time", "last_edited_by"].includes(value.type)) {
                    properties[key] = value;
                }
            }

            // 修改标题添加"副本"标记
            if (properties["标题"]?.title) {
                const originalTitle = properties["标题"].title.map(t => t.plain_text).join("");
                properties["标题"] = {
                    title: [{ text: { content: `${originalTitle} (副本)` } }]
                };
            }

            // 清理块数据（移除不可复制的属性）
            const cleanBlocks = allBlocks.map(block => {
                const cleaned = { type: block.type };
                if (block[block.type]) {
                    cleaned[block.type] = { ...block[block.type] };
                    // 移除子块ID引用，Notion会自动创建新ID
                    delete cleaned[block.type].children;
                }
                return cleaned;
            });

            // 创建新页面
            const newPage = await NotionAPI.createDatabasePage(
                targetParentId,
                properties,
                cleanBlocks.slice(0, 100),
                apiKey
            );

            // 如果有更多块，追加
            if (cleanBlocks.length > 100) {
                await NotionAPI.appendBlocks(newPage.id, cleanBlocks.slice(100), apiKey);
            }

            return newPage;
        },

        // ========== 子页面操作 ==========

        // 验证页面 ID 是否有效
        validatePage: async (pageId, apiKey) => {
            try {
                await NotionAPI.request("GET", `/pages/${pageId}`, null, apiKey);
                return { valid: true };
            } catch (error) {
                return { valid: false, error: error.message };
            }
        },

        // 创建子页面（导出为页面而不是数据库条目）
        createChildPage: async (parentPageId, title, children, apiKey) => {
            const data = {
                parent: { page_id: parentPageId },
                properties: {
                    title: {
                        title: [{ text: { content: title || "无标题" } }]
                    }
                },
                children: children.slice(0, 100), // Notion 限制
            };

            const page = await NotionAPI.request("POST", "/pages", data, apiKey);

            // 如果有剩余的 blocks，追加
            if (children.length > 100) {
                await NotionAPI.appendBlocks(page.id, children.slice(100), apiKey);
            }

            return page;
        },

        // 软删除页面 (归档)
        deletePage: async (pageId, apiKey) => {
            return await NotionAPI.request("PATCH", `/pages/${pageId}`, { archived: true }, apiKey);
        },

        // 恢复页面 (取消归档)
        restorePage: async (pageId, apiKey) => {
            return await NotionAPI.request("PATCH", `/pages/${pageId}`, { archived: false }, apiKey);
        },

        // 删除块
        deleteBlock: async (blockId, apiKey) => {
            return await NotionAPI.request("DELETE", `/blocks/${blockId}`, null, apiKey);
        },

        // ========== 用户管理 (ADMIN) ==========

        // 获取用户列表
        getUsers: async (cursor, apiKey) => {
            let endpoint = "/users";
            if (cursor) endpoint += `?start_cursor=${cursor}`;
            return await NotionAPI.request("GET", endpoint, null, apiKey);
        },

        // 获取当前用户信息
        getSelf: async (apiKey) => {
            return await NotionAPI.request("GET", "/users/me", null, apiKey);
        },

        // 获取特定用户信息
        getUser: async (userId, apiKey) => {
            return await NotionAPI.request("GET", `/users/${userId}`, null, apiKey);
        },
    };

    // ===========================================
    // AI 服务模块
    // ===========================================
    const AIService = {
        // 服务商配置
        PROVIDERS: {
            openai: {
                name: "OpenAI",
                defaultModel: "gpt-4o-mini",
                models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
                endpoint: "https://api.openai.com/v1/chat/completions",
            },
            claude: {
                name: "Claude",
                defaultModel: "claude-3-5-haiku-latest",
                models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
                endpoint: "https://api.anthropic.com/v1/messages",
            },
            gemini: {
                name: "Gemini",
                defaultModel: "gemini-2.0-flash",
                models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
                endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
            }
        },

        // 调用 AI 进行分类
        classify: async (title, content, categories, settings) => {
            const prompt = `请根据以下帖子内容，从给定的分类中选择最合适的一个。
只返回分类名称，不要任何其他内容、解释或标点符号。

可选分类：${categories.join(", ")}

帖子标题：${title}
帖子内容：${content.slice(0, 2000)}

分类：`;

            const response = await AIService.request(prompt, settings);
            return AIService.matchCategory(response, categories);
        },

        // 发送请求（根据不同服务商格式化）
        request: async (prompt, settings) => {
            const { aiService, aiApiKey, aiModel, aiBaseUrl } = settings;
            const provider = AIService.PROVIDERS[aiService];
            if (!provider) throw new Error(`未知的 AI 服务: ${aiService}`);

            const model = aiModel || provider.defaultModel;

            if (aiService === "openai") {
                return await AIService.requestOpenAI(prompt, model, aiApiKey, aiBaseUrl);
            } else if (aiService === "claude") {
                return await AIService.requestClaude(prompt, model, aiApiKey, aiBaseUrl);
            } else if (aiService === "gemini") {
                return await AIService.requestGemini(prompt, model, aiApiKey, aiBaseUrl);
            }
            throw new Error(`不支持的 AI 服务: ${aiService}`);
        },

        // OpenAI API 请求
        requestOpenAI: (prompt, model, apiKey, baseUrl) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1/chat/completions`
                : "https://api.openai.com/v1/chat/completions";

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: prompt }],
                        max_completion_tokens: 50,
                        temperature: 0,
                    }),
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(result.choices?.[0]?.message?.content?.trim() || "");
                            } else {
                                reject(new Error(result.error?.message || `OpenAI 错误: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },

        // Claude API 请求
        requestClaude: (prompt, model, apiKey, baseUrl) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1/messages`
                : "https://api.anthropic.com/v1/messages";

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: {
                        "x-api-key": apiKey,
                        "Content-Type": "application/json",
                        "anthropic-version": "2023-06-01",
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
                        max_tokens: 50,
                    }),
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(result.content?.[0]?.text?.trim() || "");
                            } else {
                                reject(new Error(result.error?.message || `Claude 错误: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },

        // Gemini API 请求
        requestGemini: (prompt, model, apiKey, baseUrl) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1beta$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1beta/models/${model}:generateContent?key=${apiKey}`
                : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: {
                        "Content-Type": "application/json",
                    },
                    data: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            maxOutputTokens: 50,
                            temperature: 0,
                        },
                    }),
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "");
                            } else {
                                reject(new Error(result.error?.message || `Gemini 错误: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },

        // 匹配分类（模糊匹配）
        matchCategory: (response, categories) => {
            if (!response) return categories[categories.length - 1]; // 默认最后一个

            const cleaned = response.trim().replace(/[。，,.!！?？]/g, "");

            // 精确匹配
            for (const cat of categories) {
                if (cleaned === cat || cleaned.toLowerCase() === cat.toLowerCase()) {
                    return cat;
                }
            }

            // 包含匹配
            for (const cat of categories) {
                if (cleaned.includes(cat) || cat.includes(cleaned)) {
                    return cat;
                }
            }

            // 返回默认分类（最后一个，通常是"其他"）
            return categories[categories.length - 1];
        },

        // 对话式请求（支持更长输出）
        requestChat: async (prompt, settings, maxTokens = 1000) => {
            const { aiService, aiApiKey, aiModel, aiBaseUrl } = settings;
            const provider = AIService.PROVIDERS[aiService];
            if (!provider) throw new Error(`未知的 AI 服务: ${aiService}`);

            const model = aiModel || provider.defaultModel;

            if (aiService === "openai") {
                return await AIService.requestOpenAIChat(prompt, model, aiApiKey, aiBaseUrl, maxTokens);
            } else if (aiService === "claude") {
                return await AIService.requestClaudeChat(prompt, model, aiApiKey, aiBaseUrl, maxTokens);
            } else if (aiService === "gemini") {
                return await AIService.requestGeminiChat(prompt, model, aiApiKey, aiBaseUrl, maxTokens);
            }
            throw new Error(`不支持的 AI 服务: ${aiService}`);
        },

        // OpenAI 对话请求
        requestOpenAIChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1/chat/completions`
                : "https://api.openai.com/v1/chat/completions";

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: prompt }],
                        max_completion_tokens: maxTokens,
                        temperature: 0.7,
                    }),
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(result.choices?.[0]?.message?.content?.trim() || "");
                            } else {
                                reject(new Error(result.error?.message || `OpenAI 错误: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },

        // Claude 对话请求
        requestClaudeChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1/messages`
                : "https://api.anthropic.com/v1/messages";

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: {
                        "x-api-key": apiKey,
                        "Content-Type": "application/json",
                        "anthropic-version": "2023-06-01",
                    },
                    data: JSON.stringify({
                        model: model,
                        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
                        max_tokens: maxTokens,
                    }),
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(result.content?.[0]?.text?.trim() || "");
                            } else {
                                reject(new Error(result.error?.message || `Claude 错误: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },

        // Gemini 对话请求
        requestGeminiChat: (prompt, model, apiKey, baseUrl, maxTokens) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1beta$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1beta/models/${model}:generateContent?key=${apiKey}`
                : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: {
                        "Content-Type": "application/json",
                    },
                    data: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            maxOutputTokens: maxTokens,
                            temperature: 0.7,
                        },
                    }),
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "");
                            } else {
                                reject(new Error(result.error?.message || `Gemini 错误: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },

        // Agent 多轮对话请求（将 system + messages 拼接为单个 prompt）
        requestAgentChat: async (systemPrompt, messages, settings, maxTokens = 1500) => {
            let prompt = `[系统指令]\n${systemPrompt}\n\n`;
            for (const msg of messages) {
                if (msg.role === "user") {
                    prompt += `[用户]: ${msg.content}\n\n`;
                } else if (msg.role === "assistant") {
                    prompt += `[助手]: ${msg.content}\n\n`;
                }
            }
            return await AIService.requestChat(prompt, settings, maxTokens);
        },

        // 获取可用模型列表
        fetchModels: async (service, apiKey, baseUrl) => {
            if (service === "openai") {
                return await AIService.fetchOpenAIModels(apiKey, baseUrl);
            } else if (service === "claude") {
                // Claude 没有公开的模型列表 API，返回预设列表
                return AIService.PROVIDERS.claude.models;
            } else if (service === "gemini") {
                return await AIService.fetchGeminiModels(apiKey, baseUrl);
            }
            throw new Error(`不支持的 AI 服务: ${service}`);
        },

        // 获取 OpenAI 模型列表
        fetchOpenAIModels: (apiKey, baseUrl) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1/models`
                : "https://api.openai.com/v1/models";

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                    },
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                // 过滤出聊天模型
                                const chatModels = (result.data || [])
                                    .filter(m => m.id.includes("gpt") || m.id.includes("o1") || m.id.includes("o3"))
                                    .map(m => m.id)
                                    .sort((a, b) => {
                                        // 优先显示常用模型
                                        const priority = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"];
                                        const aIdx = priority.findIndex(p => a.startsWith(p));
                                        const bIdx = priority.findIndex(p => b.startsWith(p));
                                        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                                        if (aIdx !== -1) return -1;
                                        if (bIdx !== -1) return 1;
                                        return a.localeCompare(b);
                                    });
                                resolve(chatModels.length > 0 ? chatModels : AIService.PROVIDERS.openai.models);
                            } else {
                                reject(new Error(result.error?.message || `获取模型失败: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },

        // 获取 Gemini 模型列表
        fetchGeminiModels: (apiKey, baseUrl) => {
            // 标准化 baseUrl：移除末尾的 / 和 /v1beta，避免重复路径
            const normalizedBase = baseUrl ? baseUrl.replace(/\/$/, "").replace(/\/v1beta$/, "") : "";
            const url = normalizedBase
                ? `${normalizedBase}/v1beta/models?key=${apiKey}`
                : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    headers: {
                        "Content-Type": "application/json",
                    },
                    onload: (response) => {
                        try {
                            const result = JSON.parse(response.responseText);
                            if (response.status >= 200 && response.status < 300) {
                                // 过滤出支持 generateContent 的模型
                                const models = (result.models || [])
                                    .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
                                    .map(m => m.name.replace("models/", ""))
                                    .filter(m => m.includes("gemini"))
                                    .sort((a, b) => {
                                        // 优先显示常用模型
                                        const priority = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"];
                                        const aIdx = priority.findIndex(p => a.startsWith(p));
                                        const bIdx = priority.findIndex(p => b.startsWith(p));
                                        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                                        if (aIdx !== -1) return -1;
                                        if (bIdx !== -1) return 1;
                                        return a.localeCompare(b);
                                    });
                                resolve(models.length > 0 ? models : AIService.PROVIDERS.gemini.models);
                            } else {
                                reject(new Error(result.error?.message || `获取模型失败: ${response.status}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                });
            });
        },
    };

    // ===========================================
    // 对话状态管理模块
    // ===========================================
    const ChatState = {
        messages: [],
        isProcessing: false,
        context: {},
        MAX_HISTORY: 50,

        // 添加消息
        addMessage: (role, content, status = "complete") => {
            ChatState.messages.push({
                id: Date.now(),
                role,  // "user" | "assistant"
                content,
                status,  // "complete" | "processing" | "error"
                timestamp: new Date().toISOString()
            });
            // 限制历史记录数量
            if (ChatState.messages.length > ChatState.MAX_HISTORY) {
                ChatState.messages = ChatState.messages.slice(-ChatState.MAX_HISTORY);
            }
            ChatState.save();
            ChatUI.renderMessages();
            return ChatState.messages[ChatState.messages.length - 1];
        },

        // 更新最后一条消息
        updateLastMessage: (content, status) => {
            if (ChatState.messages.length === 0) return;
            const lastMsg = ChatState.messages[ChatState.messages.length - 1];
            if (content !== undefined) lastMsg.content = content;
            if (status !== undefined) lastMsg.status = status;
            ChatState.save();
            ChatUI.renderMessages();
        },

        // 保存到存储
        save: () => {
            Storage.set(CONFIG.STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(ChatState.messages));
        },

        // 从存储加载
        load: () => {
            try {
                const data = Storage.get(CONFIG.STORAGE_KEYS.CHAT_HISTORY, "[]");
                ChatState.messages = JSON.parse(data);
            } catch {
                ChatState.messages = [];
            }
        },

        // 清空对话
        clear: () => {
            ChatState.messages = [];
            ChatState.context = {};
            ChatState.save();
            ChatUI.renderMessages();
        },
    };

    // ===========================================
    // AI 助手模块
    // ===========================================
    const AIAssistant = {
        // 意图类型
        INTENTS: {
            QUERY: "query",           // 查询/统计
            SEARCH: "search",         // 搜索（数据库内）
            WORKSPACE_SEARCH: "workspace_search",  // 工作区搜索（全局）
            CLASSIFY: "classify",     // 分类单个
            BATCH_CLASSIFY: "batch_classify",  // 批量分类
            UPDATE: "update",         // 更新属性
            MOVE: "move",             // 移动页面
            COPY: "copy",             // 复制页面
            CREATE_DATABASE: "create_database",  // 创建数据库
            WRITE_CONTENT: "write_content",      // AI 生成内容追加到页面
            EDIT_CONTENT: "edit_content",        // AI 改写页面内容
            TRANSLATE_CONTENT: "translate_content", // AI 翻译页面内容
            AI_AUTOFILL: "ai_autofill",          // 批量 AI 属性填充
            ASK: "ask",                          // 全局问答（RAG）
            AGENT_TASK: "agent_task",            // Agent 自主代理
            DEEP_RESEARCH: "deep_research",      // 深度研究
            TEMPLATE_OUTPUT: "template_output",  // AI 模板输出
            SUMMARIZE: "summarize",              // 总结/摘要
            BRAINSTORM: "brainstorm",            // 头脑风暴/创意生成
            PROOFREAD: "proofread",              // 校对/纠错/润色
            BATCH_TRANSLATE: "batch_translate",    // 批量翻译数据库
            EXTRACT_TO_DB: "extract_to_database",  // 内容提取为数据库
            GENERATE_PAGES: "generate_pages",      // 多页面结构化生成
            BATCH_ANALYZE: "batch_analyze",        // 批量页面分析
            BOOKMARK_IMPORT: "bookmark_import",    // 导入浏览器书签
            HELP: "help",             // 帮助
            COMPOUND: "compound",     // 组合指令
            UNKNOWN: "unknown"        // 未知
        },

        // ===========================================
        // Agent 工具注册表
        // ===========================================
        AGENT_TOOLS: {
            // === 读取工具 (Level 0) ===
            search_workspace: {
                description: "搜索 Notion 工作区中的页面或数据库",
                params: "query(搜索词), type(可选:'page'或'database')",
                level: 0,
                execute: async (args, settings) => {
                    const { query = "", type } = args;
                    let filter = null;
                    if (type === "page") filter = { property: "object", value: "page" };
                    else if (type === "database") filter = { property: "object", value: "database" };

                    // 分页获取结果（最多 10 页，防止大型工作区过多 API 调用）
                    let allResults = [];
                    let cursor = undefined;
                    let pageCount = 0;
                    do {
                        const response = await NotionAPI.search(query, filter, settings.notionApiKey, cursor);
                        allResults = allResults.concat(response.results || []);
                        cursor = response.has_more ? response.next_cursor : undefined;
                        pageCount++;
                    } while (cursor && pageCount < 10);
                    const results = allResults;

                    if (results.length === 0) {
                        return query ? `没有找到包含「${query}」的内容。` : "工作区中没有找到内容。";
                    }

                    const lines = [];
                    for (const item of results.slice(0, 15)) {
                        if (item.object === "database") {
                            const title = item.title?.[0]?.plain_text || "无标题数据库";
                            const id = item.id?.replace(/-/g, "") || "";
                            lines.push(`[数据库] ${title} (ID: ${id})`);
                        } else {
                            const title = Utils.getPageTitle(item);
                            const id = item.id?.replace(/-/g, "") || "";
                            const url = item.url || "";
                            lines.push(`[页面] ${title} (ID: ${id}, URL: ${url})`);
                        }
                    }
                    return `找到 ${results.length} 个结果（显示前 ${Math.min(15, results.length)} 条）：\n${lines.join("\n")}`;
                }
            },

            query_database: {
                description: "查询数据库的页面，支持筛选和排序（根据AI设置中的目标数据库决定查询范围）",
                params: "filter_field(筛选字段,可选), filter_value(筛选值,可选), limit(数量,默认10)",
                level: 0,
                execute: async (args, settings) => {
                    const targetDb = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");
                    const { filter_field, filter_value, limit = 10 } = args;

                    // 构建筛选条件
                    let filter = null;
                    if (filter_field && filter_value) {
                        const fieldConfig = {
                            "作者": { name: "作者", type: "rich_text" },
                            "分类": { name: "分类", type: "rich_text" },
                            "标签": { name: "标签", type: "multi_select" },
                            "AI分类": { name: "AI分类", type: "select" }
                        };
                        const config = fieldConfig[filter_field] || { name: filter_field, type: "rich_text" };
                        if (config.type === "select") {
                            filter = { property: config.name, select: { equals: filter_value } };
                        } else if (config.type === "multi_select") {
                            filter = { property: config.name, multi_select: { contains: filter_value } };
                        } else {
                            filter = { property: config.name, rich_text: { contains: filter_value } };
                        }
                    }

                    // 查询单个数据库的辅助函数
                    const queryOneDb = async (dbId) => {
                        const pages = [];
                        let cursor = null;
                        let hasMore = true;
                        let pageCount = 0;
                        while (hasMore && pageCount < 10) {
                            let response;
                            try {
                                response = await NotionAPI.queryDatabase(dbId, filter,
                                    pageCount === 0 ? [{ property: "收藏时间", direction: "descending" }] : null,
                                    cursor, settings.notionApiKey);
                            } catch {
                                response = await NotionAPI.queryDatabase(dbId, filter,
                                    [{ timestamp: "created_time", direction: "descending" }],
                                    cursor, settings.notionApiKey);
                            }
                            pages.push(...(response.results || []));
                            hasMore = response.has_more;
                            cursor = response.next_cursor;
                            pageCount++;
                        }
                        return pages;
                    };

                    let allPages = [];

                    if (targetDb === "__all__") {
                        // 遍历所有工作区数据库
                        let cached;
                        try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch { cached = {}; }
                        const databases = cached.databases || [];
                        if (databases.length === 0) return "错误: 请先在 AI 设置中点击「🔄」刷新数据库列表。";

                        // 校验缓存的 API Key 是否匹配当前配置
                        const currentKeyHash = settings.notionApiKey ? settings.notionApiKey.slice(-8) : "";
                        if (cached.apiKeyHash && cached.apiKeyHash !== currentKeyHash) {
                            return "错误: 数据库列表缓存与当前 API Key 不匹配，请重新点击「🔄」刷新。";
                        }

                        for (const db of databases) {
                            try {
                                const pages = await queryOneDb(db.id);
                                pages.forEach(p => { p._sourceDb = db.title; });
                                allPages.push(...pages);
                            } catch {} // 跳过无权限的数据库
                        }
                    } else {
                        const dbId = targetDb || settings.notionDatabaseId;
                        if (!dbId) return "错误: 未配置数据库 ID。";
                        allPages = await queryOneDb(dbId);
                    }

                    if (allPages.length === 0) {
                        return filter ? `没有找到匹配 ${filter_field}="${filter_value}" 的页面。` : "数据库中没有页面。";
                    }

                    const total = allPages.length;
                    const showCount = Math.min(limit, total);
                    const lines = [`共 ${total} 个页面（显示前 ${showCount} 条）：`];

                    // 统计分类
                    const categoryCount = {};
                    allPages.forEach(page => {
                        const cat = page.properties["AI分类"]?.select?.name ||
                                   page.properties["分类"]?.rich_text?.[0]?.plain_text || "未分类";
                        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
                    });
                    lines.push(`分类统计: ${Object.entries(categoryCount).map(([k, v]) => `${k}(${v})`).join(", ")}`);

                    allPages.slice(0, showCount).forEach((page, i) => {
                        const title = Utils.getPageTitle(page);
                        const id = page.id?.replace(/-/g, "") || "";
                        const author = page.properties["作者"]?.rich_text?.[0]?.plain_text || "";
                        const sourceDb = page._sourceDb ? ` [来源: ${page._sourceDb}]` : "";
                        lines.push(`${i + 1}. ${title}${author ? ` (作者: ${author})` : ""}${sourceDb} [ID: ${id}]`);
                    });

                    return lines.join("\n");
                }
            },

            get_page_content: {
                description: "读取指定页面的文字内容",
                params: "page_name(页面名) 或 page_id(页面ID)",
                level: 0,
                execute: async (args, settings) => {
                    const { page_name, page_id } = args;
                    if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";

                    const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                    if (page?.error) return `错误: ${page.error}`;
                    if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

                    const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 4000);
                    return content.trim() ? `页面「${page.name}」的内容：\n${content}` : `页面「${page.name}」没有文字内容。`;
                }
            },

            get_database_schema: {
                description: "获取数据库的属性结构",
                params: "database_name(数据库名) 或 database_id(数据库ID)",
                level: 0,
                execute: async (args, settings) => {
                    let dbId = args.database_id;
                    let dbName = args.database_name;

                    if (!dbId && !dbName) {
                        dbId = settings.notionDatabaseId;
                        if (!dbId) return "错误: 请提供 database_name 或 database_id，或先配置数据库 ID。";
                        dbName = "已配置的数据库";
                    }

                    if (!dbId && dbName) {
                        const resolved = await AIAssistant._resolveDatabaseId(dbName, null, settings.notionApiKey);
                        if (resolved?.error) return `错误: ${resolved.error}`;
                        if (!resolved) return `错误: 找不到数据库「${dbName}」。`;
                        dbId = resolved.id;
                        dbName = resolved.name;
                    }

                    const database = await NotionAPI.fetchDatabase(dbId, settings.notionApiKey);
                    const props = database.properties || {};
                    const title = database.title?.[0]?.plain_text || dbName || "未命名";

                    const lines = [`数据库「${title}」的属性结构：`];
                    for (const [name, prop] of Object.entries(props)) {
                        let extra = "";
                        if (prop.type === "select" && prop.select?.options?.length) {
                            extra = ` (选项: ${prop.select.options.map(o => o.name).join(", ")})`;
                        } else if (prop.type === "multi_select" && prop.multi_select?.options?.length) {
                            extra = ` (选项: ${prop.multi_select.options.map(o => o.name).join(", ")})`;
                        }
                        lines.push(`- ${name}: ${prop.type}${extra}`);
                    }
                    return lines.join("\n");
                }
            },

            // === 跨源工具 (Level 0) ===
            cross_source_search: {
                description: "跨源搜索：在 Linux.do、GitHub、浏览器书签等多个来源中统一搜索",
                params: "query(搜索词), source(可选:'linux.do'|'github'|'书签'|'all', 默认all), limit(数量,默认10)",
                level: 0,
                execute: async (args, settings) => {
                    const { query = "", source = "all", limit = 10 } = args;
                    const targetDb = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");

                    // 构建来源过滤
                    let sourceFilter = null;
                    if (source !== "all") {
                        const sourceMap = { "linux.do": "Linux.do", "github": "GitHub", "书签": "浏览器书签" };
                        const sourceValue = sourceMap[source.toLowerCase()] || source;
                        sourceFilter = { property: "来源", rich_text: { contains: sourceValue } };
                    }

                    // 构建搜索过滤
                    const filters = [];
                    if (sourceFilter) filters.push(sourceFilter);

                    const queryOneDb = async (dbId) => {
                        const body = { page_size: Math.min(limit, 100) };
                        if (filters.length > 0) {
                            body.filter = filters.length === 1 ? filters[0] : { and: filters };
                        }
                        try {
                            const response = await NotionAPI.request("POST", `/databases/${dbId}/query`, body, settings.notionApiKey);
                            return response.results || [];
                        } catch { return []; }
                    };

                    let results = [];
                    if (targetDb && targetDb !== "__all__" && !targetDb.startsWith("page:")) {
                        results = await queryOneDb(targetDb);
                    } else {
                        // 搜索所有数据库
                        const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
                        for (const db of (allDbs.results || []).slice(0, 5)) {
                            const dbResults = await queryOneDb(db.id);
                            results.push(...dbResults);
                        }
                    }

                    // 如果有搜索词，在结果中过滤
                    if (query) {
                        results = results.filter(page => {
                            const title = Utils.getPageTitle(page).toLowerCase();
                            const desc = page.properties?.["描述"]?.rich_text?.[0]?.text?.content?.toLowerCase() || "";
                            return title.includes(query.toLowerCase()) || desc.includes(query.toLowerCase());
                        });
                    }

                    results = results.slice(0, limit);

                    if (results.length === 0) {
                        return `没有找到${source !== "all" ? `来源为「${source}」的` : ""}包含「${query}」的内容。`;
                    }

                    const lines = results.map(page => {
                        const title = Utils.getPageTitle(page);
                        const src = page.properties?.["来源"]?.rich_text?.[0]?.text?.content || "未知";
                        const srcType = page.properties?.["来源类型"]?.rich_text?.[0]?.text?.content || "";
                        const url = page.properties?.["链接"]?.url || "";
                        return `[${src}${srcType ? "/" + srcType : ""}] ${title}${url ? ` (${url})` : ""}`;
                    });

                    return `跨源搜索结果 (${results.length} 条)：\n${lines.join("\n")}`;
                }
            },

            unified_stats: {
                description: "跨源统计：统计各来源（Linux.do/GitHub/浏览器书签）的数据量、分类分布",
                params: "无需参数",
                level: 0,
                execute: async (args, settings) => {
                    const targetDb = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");

                    const queryOneDb = async (dbId) => {
                        try {
                            const response = await NotionAPI.request("POST", `/databases/${dbId}/query`, { page_size: 100 }, settings.notionApiKey);
                            return response.results || [];
                        } catch { return []; }
                    };

                    let allPages = [];
                    if (targetDb && targetDb !== "__all__" && !targetDb.startsWith("page:")) {
                        allPages = await queryOneDb(targetDb);
                    } else {
                        const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
                        for (const db of (allDbs.results || []).slice(0, 5)) {
                            allPages.push(...await queryOneDb(db.id));
                        }
                    }

                    // 按来源统计
                    const sourceStats = {};
                    const categoryStats = {};
                    for (const page of allPages) {
                        const src = page.properties?.["来源"]?.rich_text?.[0]?.text?.content || "未标记";
                        const cat = page.properties?.["分类"]?.rich_text?.[0]?.text?.content || "未分类";
                        sourceStats[src] = (sourceStats[src] || 0) + 1;
                        categoryStats[cat] = (categoryStats[cat] || 0) + 1;
                    }

                    let report = `📊 **跨源数据统计** (共 ${allPages.length} 条)\n\n`;
                    report += `**按来源分布：**\n`;
                    for (const [src, count] of Object.entries(sourceStats).sort((a, b) => b[1] - a[1])) {
                        report += `- ${src}: ${count} 条\n`;
                    }
                    report += `\n**按分类分布 (前 10)：**\n`;
                    const topCats = Object.entries(categoryStats).sort((a, b) => b[1] - a[1]).slice(0, 10);
                    for (const [cat, count] of topCats) {
                        report += `- ${cat}: ${count} 条\n`;
                    }

                    return report;
                }
            },

            recommend_similar: {
                description: "智能推荐：根据指定页面，从所有来源中找到相似内容",
                params: "page_name/page_id(参考页面)",
                level: 0,
                execute: async (args, settings) => {
                    const { page_name, page_id } = args;

                    // 先找到参考页面
                    let refPage = null;
                    if (page_id) {
                        try {
                            refPage = await NotionAPI.request("GET", `/pages/${page_id}`, null, settings.notionApiKey);
                        } catch {}
                    }
                    if (!refPage && page_name) {
                        const searchResult = await NotionAPI.search(page_name, null, settings.notionApiKey);
                        refPage = (searchResult.results || []).find(r => r.object === "page");
                    }

                    if (!refPage) {
                        return "❌ 未找到参考页面，请提供页面名称或 ID。";
                    }

                    const refTitle = Utils.getPageTitle(refPage);
                    const refDesc = refPage.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";
                    const refTags = (refPage.properties?.["标签"]?.multi_select || []).map(t => t.name);

                    // 用 AI 分析相似性
                    if (!settings.aiApiKey) {
                        return "❌ 需要配置 AI API Key 才能使用智能推荐功能。";
                    }

                    // 搜索所有数据库获取候选
                    const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
                    let candidates = [];
                    for (const db of (allDbs.results || []).slice(0, 5)) {
                        try {
                            const res = await NotionAPI.request("POST", `/databases/${db.id}/query`, { page_size: 50 }, settings.notionApiKey);
                            candidates.push(...(res.results || []));
                        } catch {}
                    }

                    // 排除自身
                    candidates = candidates.filter(p => p.id !== refPage.id);
                    if (candidates.length === 0) {
                        return "没有找到其他页面进行比较。";
                    }

                    // 构建候选列表给 AI
                    const candidateList = candidates.slice(0, 30).map((p, i) => {
                        const t = Utils.getPageTitle(p);
                        const d = p.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";
                        const tags = (p.properties?.["标签"]?.multi_select || []).map(tag => tag.name).join(", ");
                        const src = p.properties?.["来源"]?.rich_text?.[0]?.text?.content || "";
                        return `${i + 1}. [${src}] ${t} | ${d} | 标签: ${tags}`;
                    }).join("\n");

                    const prompt = `参考内容：
标题: ${refTitle}
描述: ${refDesc}
标签: ${refTags.join(", ")}

候选列表:
${candidateList}

请从候选列表中选出最相似的 5 个（按相似度排序），只回复编号，用逗号分隔。`;

                    try {
                        const aiResult = await AIService.request(prompt, settings);
                        const indices = aiResult.match(/\d+/g)?.map(n => parseInt(n) - 1).filter(i => i >= 0 && i < candidates.length) || [];

                        if (indices.length === 0) {
                            return "AI 未能识别相似内容。";
                        }

                        let response = `🔍 **与「${refTitle}」相似的内容：**\n\n`;
                        for (const idx of indices.slice(0, 5)) {
                            const p = candidates[idx];
                            const t = Utils.getPageTitle(p);
                            const src = p.properties?.["来源"]?.rich_text?.[0]?.text?.content || "";
                            const url = p.properties?.["链接"]?.url || "";
                            response += `- [${src}] ${t}${url ? ` (${url})` : ""}\n`;
                        }
                        return response;
                    } catch (e) {
                        return `❌ 推荐失败: ${e.message}`;
                    }
                }
            },

            batch_tag: {
                description: "批量打标签：用 AI 为指定来源的所有未标记页面自动添加标签",
                params: "source(可选:'linux.do'|'github'|'书签'|'all'), tag_count(每页标签数,默认3)",
                level: 1,
                execute: async (args, settings) => {
                    if (!OperationGuard.canExecute("updatePage")) {
                        return "❌ 权限不足：批量打标签需要「标准」权限级别。";
                    }
                    if (!settings.aiApiKey) {
                        return "❌ 需要配置 AI API Key。";
                    }

                    const { source = "all", tag_count = 3 } = args;
                    const targetDb = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");

                    const queryOneDb = async (dbId) => {
                        const body = {
                            filter: { property: "标签", multi_select: { is_empty: true } },
                            page_size: 50,
                        };
                        try {
                            const response = await NotionAPI.request("POST", `/databases/${dbId}/query`, body, settings.notionApiKey);
                            return response.results || [];
                        } catch { return []; }
                    };

                    let pages = [];
                    if (targetDb && targetDb !== "__all__" && !targetDb.startsWith("page:")) {
                        pages = await queryOneDb(targetDb);
                    } else {
                        const allDbs = await NotionAPI.search("", { property: "object", value: "database" }, settings.notionApiKey);
                        for (const db of (allDbs.results || []).slice(0, 3)) {
                            pages.push(...await queryOneDb(db.id));
                        }
                    }

                    // 过滤来源
                    if (source !== "all") {
                        const sourceMap = { "linux.do": "Linux.do", "github": "GitHub", "书签": "浏览器书签" };
                        const sourceValue = sourceMap[source.toLowerCase()] || source;
                        pages = pages.filter(p => {
                            const s = p.properties?.["来源"]?.rich_text?.[0]?.text?.content || "";
                            return s.includes(sourceValue);
                        });
                    }

                    if (pages.length === 0) {
                        return "没有找到需要打标签的页面。";
                    }

                    let tagged = 0;
                    for (const page of pages) {
                        const title = Utils.getPageTitle(page);
                        const desc = page.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";

                        try {
                            const prompt = `为以下内容生成 ${tag_count} 个简短标签（每个标签 2-4 个字），用逗号分隔，只回复标签：
标题: ${title}
描述: ${desc}`;

                            const result = await AIService.request(prompt, settings);
                            const tags = result.split(/[,，]/).map(t => t.trim()).filter(t => t.length > 0 && t.length <= 20).slice(0, tag_count);

                            if (tags.length > 0) {
                                await NotionAPI.request("PATCH", `/pages/${page.id}`, {
                                    properties: {
                                        "标签": { multi_select: tags.map(t => ({ name: t })) },
                                    },
                                }, settings.notionApiKey);
                                tagged++;
                            }
                        } catch (e) {
                            console.warn(`[batch_tag] 失败: ${title}`, e);
                        }

                        await new Promise(r => setTimeout(r, 500));
                    }

                    return `✅ 批量打标签完成：已为 ${tagged}/${pages.length} 个页面添加标签。`;
                }
            },

            // === 写入工具 (Level 1) ===
            append_content: {
                description: "向页面追加内容（支持 Markdown 格式）",
                params: "page_name/page_id(目标页面), content(Markdown内容)",
                level: 1,
                execute: async (args, settings) => {
                    const { page_name, page_id, content } = args;
                    if (!page_name && !page_id) return "错误: 请提供 page_name 或 page_id。";
                    if (!content) return "错误: 请提供要追加的 content。";

                    const page = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                    if (page?.error) return `错误: ${page.error}`;
                    if (!page) return `错误: 找不到页面「${page_name || page_id}」。`;

                    const blocks = AIAssistant._textToBlocks(content);
                    await NotionAPI.appendBlocks(page.id, blocks, settings.notionApiKey);
                    return `已成功向页面「${page.name}」追加内容（${content.length} 字）。`;
                }
            },

            update_page_property: {
                description: "更新页面的属性值",
                params: "page_id(页面ID), property(属性名), value(新值), type(属性类型:text/select/multi_select/number/date)",
                level: 1,
                execute: async (args, settings) => {
                    const { page_id, property, value, type = "text" } = args;
                    if (!page_id) return "错误: 请提供 page_id。";
                    if (!property) return "错误: 请提供 property（属性名）。";
                    if (value === undefined || value === null) return "错误: 请提供 value（新值）。";

                    const updateProps = {};
                    switch (type) {
                        case "select":
                            updateProps[property] = { select: { name: String(value) } };
                            break;
                        case "multi_select":
                            const tags = String(value).split(/[,，]/).map(t => ({ name: t.trim() })).filter(t => t.name);
                            updateProps[property] = { multi_select: tags };
                            break;
                        case "number":
                            updateProps[property] = { number: Number(value) };
                            break;
                        case "date":
                            updateProps[property] = { date: { start: String(value) } };
                            break;
                        default: // text / rich_text
                            updateProps[property] = { rich_text: [{ type: "text", text: { content: String(value) } }] };
                            break;
                    }

                    await NotionAPI.updatePage(page_id.replace(/-/g, ""), updateProps, settings.notionApiKey);
                    return `已更新页面属性「${property}」为「${value}」。`;
                }
            },

            create_page: {
                description: "在数据库中创建新页面",
                params: "database_name/database_id(目标数据库), title(标题), properties(可选,属性对象)",
                level: 1,
                execute: async (args, settings) => {
                    const { database_name, database_id, title } = args;
                    if (!title) return "错误: 请提供 title（页面标题）。";

                    let dbId = database_id;
                    if (!dbId && database_name) {
                        const resolved = await AIAssistant._resolveDatabaseId(database_name, null, settings.notionApiKey);
                        if (resolved?.error) return `错误: ${resolved.error}`;
                        if (!resolved) return `错误: 找不到数据库「${database_name}」。`;
                        dbId = resolved.id;
                    }
                    if (!dbId) dbId = settings.notionDatabaseId;
                    if (!dbId) return "错误: 请提供 database_name 或 database_id，或先配置数据库 ID。";

                    const properties = {
                        "标题": { title: [{ text: { content: title } }] }
                    };

                    // 合并额外属性
                    if (args.properties && typeof args.properties === "object") {
                        for (const [key, val] of Object.entries(args.properties)) {
                            if (key === "标题") continue;
                            if (typeof val === "string") {
                                properties[key] = { rich_text: [{ type: "text", text: { content: val } }] };
                            }
                        }
                    }

                    const page = await NotionAPI.createDatabasePage(dbId, properties, [], settings.notionApiKey);
                    const newId = page.id?.replace(/-/g, "") || "";
                    return `已在数据库中创建页面「${title}」(ID: ${newId})。`;
                }
            },

            classify_pages: {
                description: "AI 自动分类数据库中未分类的页面",
                params: "limit(最多处理数量,默认全部)",
                level: 1,
                execute: async (args, settings) => {
                    const dbId = settings.notionDatabaseId;
                    if (!dbId) return "错误: 未配置数据库 ID。";
                    if (settings.categories.length < 2) return "错误: 请先配置至少两个分类选项。";

                    await AIClassifier.ensureAICategoryProperty(settings);
                    const pages = await AIClassifier.fetchAllPages(settings);
                    if (pages.length === 0) return "数据库中没有页面。";

                    const unclassified = pages.filter(p => !p.properties["AI分类"]?.select?.name);
                    if (unclassified.length === 0) return `所有 ${pages.length} 个页面都已分类。`;

                    const maxLimit = args.limit ? Math.min(args.limit, unclassified.length) : unclassified.length;
                    const toClassify = unclassified.slice(0, maxLimit);
                    const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
                    let success = 0, failed = 0;

                    for (let i = 0; i < toClassify.length; i++) {
                        try {
                            await AIClassifier.classifyPage(toClassify[i], settings);
                            success++;
                        } catch {
                            failed++;
                        }
                        if (i < toClassify.length - 1) await Utils.sleep(delay);
                    }

                    return `分类完成: 总计 ${pages.length} 个页面，本次分类 ${success} 个${failed > 0 ? `，失败 ${failed} 个` : ""}。`;
                }
            },

            // === 高级工具 (Level 2) ===
            move_page: {
                description: "将页面移动到另一个数据库",
                params: "page_id(页面ID), target_database_name/target_database_id(目标数据库)",
                level: 2,
                execute: async (args, settings) => {
                    const { page_id, target_database_name, target_database_id } = args;
                    if (!page_id) return "错误: 请提供 page_id。";

                    const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
                    if (target?.error) return `错误: ${target.error}`;
                    if (!target) return `错误: 找不到目标数据库「${target_database_name || target_database_id}」。`;

                    await OperationGuard.execute("movePage",
                        () => NotionAPI.movePage(page_id.replace(/-/g, ""), target.id, "database", settings.notionApiKey),
                        { itemName: page_id, pageId: page_id, apiKey: settings.notionApiKey }
                    );
                    return `已将页面 ${page_id} 移动到数据库「${target.name}」。`;
                }
            },

            copy_page: {
                description: "复制页面到另一个数据库",
                params: "page_id(页面ID), target_database_name/target_database_id(目标数据库)",
                level: 2,
                execute: async (args, settings) => {
                    const { page_id, target_database_name, target_database_id } = args;
                    if (!page_id) return "错误: 请提供 page_id。";

                    const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
                    if (target?.error) return `错误: ${target.error}`;
                    if (!target) return `错误: 找不到目标数据库「${target_database_name || target_database_id}」。`;

                    await OperationGuard.execute("duplicatePage",
                        () => NotionAPI.duplicatePage(page_id.replace(/-/g, ""), target.id, "database", settings.notionApiKey),
                        { itemName: page_id, pageId: page_id, apiKey: settings.notionApiKey }
                    );
                    return `已将页面 ${page_id} 复制到数据库「${target.name}」。`;
                }
            },

            create_database: {
                description: "创建新数据库",
                params: "name(数据库名), parent_page_name/parent_page_id(父页面)",
                level: 2,
                execute: async (args, settings) => {
                    const { name, parent_page_name, parent_page_id } = args;
                    if (!name) return "错误: 请提供 name（数据库名称）。";

                    let parentPage = null;
                    if (parent_page_id || parent_page_name) {
                        parentPage = await AIAssistant._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
                        if (parentPage?.error) return `错误: ${parentPage.error}`;
                        if (!parentPage) return `错误: 找不到父页面「${parent_page_name || parent_page_id}」。`;
                    } else {
                        const response = await NotionAPI.search("", { property: "object", value: "page" }, settings.notionApiKey);
                        const pages = (response.results || []).filter(p => !p.archived && p.parent?.type === "workspace");
                        if (pages.length === 0) return "错误: 工作区中没有可用的页面作为父页面。";
                        parentPage = { id: pages[0].id.replace(/-/g, ""), name: Utils.getPageTitle(pages[0]) };
                    }

                    const properties = {
                        "标题": { title: {} },
                        "链接": { url: {} },
                        "分类": { rich_text: {} },
                        "标签": { multi_select: { options: [] } },
                        "作者": { rich_text: {} },
                    };

                    const result = await OperationGuard.execute("createDatabase",
                        () => NotionAPI.createDatabase(parentPage.id, name, properties, settings.notionApiKey),
                        { itemName: name, apiKey: settings.notionApiKey }
                    );

                    const newDbId = result.id?.replace(/-/g, "") || "";
                    return `已创建数据库「${name}」(ID: ${newDbId})，父页面: ${parentPage.name}。`;
                }
            },

            // === 深度研究工具 (Level 0) ===
            research_report: {
                description: "深入研究指定主题，多关键词搜索并生成结构化研究报告",
                params: "research_topic(研究主题), scope(范围:workspace/database,默认workspace)",
                level: 0,
                execute: async (args, settings) => {
                    return await AIAssistant.handleDeepResearch(args, settings, "Agent工具调用");
                }
            },

            // === 公式编写辅助 (Level 1) ===
            generate_formula: {
                description: "根据自然语言描述生成 Notion 数据库公式",
                params: "description(功能描述), database_name/database_id(目标数据库,可选), property_name(目标属性名,可选)",
                level: 1,
                execute: async (args, settings) => {
                    const { description, database_name, database_id, property_name } = args;
                    if (!description) return "错误: 请描述你想要的公式功能。";

                    // 获取数据库 schema 作为上下文
                    let schemaDesc = "";
                    const dbId = database_id || settings.notionDatabaseId;
                    if (dbId) {
                        try {
                            const database = await NotionAPI.fetchDatabase(dbId, settings.notionApiKey);
                            const props = Object.entries(database.properties || {})
                                .map(([name, prop]) => `${name}(${prop.type})`)
                                .join(", ");
                            schemaDesc = `数据库属性: ${props}`;
                        } catch { schemaDesc = ""; }
                    }

                    const prompt = `你是 Notion 公式专家。根据以下信息生成 Notion 公式。

${schemaDesc ? schemaDesc + "\n" : ""}用户需求: ${description}

请返回以下格式:
公式: <Notion公式表达式>
说明: <公式功能简述>
示例: <公式返回值示例>

注意：使用 Notion 的公式语法（prop(), if(), contains() 等函数）。`;

                    const result = await AIService.requestChat(prompt, settings, 500);
                    let response = `📐 **Notion 公式生成**\n\n${result}`;
                    if (property_name) {
                        response += `\n\n💡 请将此公式手动设置到数据库属性「${property_name}」中（Notion API 暂不支持直接写入公式属性）。`;
                    }
                    return response;
                }
            },
            summarize_page: {
                description: "总结指定页面的内容，生成关键信息摘要",
                params: "page_name/page_id(目标页面), style(摘要风格:brief/detailed/bullet,默认brief)",
                level: 0,
                execute: async (args, settings) => {
                    return await AIAssistant.handleSummarize(args, settings, "Agent工具调用");
                }
            },
            brainstorm_ideas: {
                description: "根据主题进行头脑风暴，生成创意列表或方案建议",
                params: "topic(主题), count(生成数量,默认10), style(风格:practical/creative/wild,默认practical)",
                level: 0,
                execute: async (args, settings) => {
                    return await AIAssistant.handleBrainstorm(args, settings, "Agent工具调用");
                }
            },
            proofread_content: {
                description: "校对页面内容，纠正拼写、语法和表达问题",
                params: "page_name/page_id(目标页面)",
                level: 0,
                execute: async (args, settings) => {
                    return await AIAssistant.handleProofread(args, settings, "Agent工具调用");
                }
            },
            batch_translate_database: {
                description: "批量翻译数据库中所有页面的内容",
                params: "database_name/database_id(目标数据库), target_language(目标语言,如英文/日文)",
                level: 1,
                execute: async (args, settings) => {
                    return await AIAssistant.handleBatchTranslate(args, settings, "Agent工具调用");
                }
            },
            extract_to_database: {
                description: "从页面内容中提取结构化信息，创建数据库并填充条目",
                params: "page_name/page_id(源页面), database_name(新数据库名称), extraction_prompt(提取要求描述)",
                level: 2,
                execute: async (args, settings) => {
                    return await AIAssistant.handleExtractToDatabase(args, settings, "Agent工具调用");
                }
            },
            generate_structured_pages: {
                description: "根据需求生成多页面结构化内容（如入职指南、竞品分析报告）",
                params: "topic(主题), structure_prompt(结构描述), parent_page_name/parent_page_id(父页面,可选)",
                level: 2,
                execute: async (args, settings) => {
                    return await AIAssistant.handleGeneratePages(args, settings, "Agent工具调用");
                }
            },
            batch_analyze_pages: {
                description: "批量分析数据库中的页面，生成跨页面综合分析报告",
                params: "database_name/database_id(目标数据库), analysis_prompt(分析要求), limit(分析页数,默认10)",
                level: 0,
                execute: async (args, settings) => {
                    return await AIAssistant.handleBatchAnalyze(args, settings, "Agent工具调用");
                }
            },
        },

        // 获取帮助信息
        getHelpMessage: () => {
            const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
            return `🤖 **我是${personaName}**

直接用自然语言告诉我你想做什么，我会自动规划并执行。例如：

📊 "数据库里有多少帖子？"
🔍 "搜索关于 Docker 的内容"
✍️ "在 xxx 页面写一段关于 Docker 的介绍"
🏷️ "自动分类所有未分类的帖子"
📦 "把技术类帖子移到技术库"
💬 "关于 Docker 的帖子都说了什么？"
🔬 "深入研究一下关于 AI 的所有内容"
📋 "用周报模板总结本周内容"
📐 "生成一个计算天数差的公式"
📝 "总结一下 xxx 页面的内容"
💡 "围绕远程办公给我一些创意建议"
✅ "校对一下 xxx 页面的拼写和语法"
🌐 "把整个数据库翻译成英文"
📊 "把这个页面的笔记提取为数据库"
📑 "为新员工创建入职指南（含子页面）"
🔎 "分析数据库里所有页面，生成综合报告"
🔮 "给所有帖子生成 AI 摘要"
🐙 "导入 GitHub 收藏到 Notion"（支持 Stars/Repos/Forks/Gists）
📖 "导入浏览器书签"（需安装配套 Chrome 扩展）
🤖 "帮我整理所有帖子，分类后生成摘要"

我会自动调用需要的工具，逐步完成任务。复杂任务我会分步执行。
⚠️ 移动、复制等高级操作需要「高级」权限级别。`;
        },

        // 获取 AI 设置
        getSettings: () => {
            const panel = UI.panel;
            const refs = UI.refs || {};
            return {
                notionApiKey: (refs.apiKeyInput || panel?.querySelector("#ldb-api-key"))?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""),
                notionDatabaseId: (refs.databaseIdInput || panel?.querySelector("#ldb-database-id"))?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                aiApiKey: (refs.aiApiKeyInput || panel?.querySelector("#ldb-ai-api-key"))?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: (refs.aiServiceSelect || panel?.querySelector("#ldb-ai-service"))?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService),
                aiModel: (refs.aiModelSelect || panel?.querySelector("#ldb-ai-model"))?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, ""),
                aiBaseUrl: (refs.aiBaseUrlInput || panel?.querySelector("#ldb-ai-base-url"))?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
                categories: Utils.parseAICategories(
                    (refs.aiCategoriesInput || panel?.querySelector("#ldb-ai-categories"))?.value.trim()
                        || Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories)
                ),
            };
        },

        // 检查配置是否完整
        checkConfig: (settings, requireDatabase = true) => {
            if (!settings.notionApiKey) {
                return { valid: false, error: "请先配置 Notion API Key" };
            }
            if (requireDatabase && !settings.notionDatabaseId) {
                return { valid: false, error: "请先配置 Notion 数据库 ID（或使用「工作区搜索」功能）" };
            }
            if (!settings.aiApiKey) {
                return { valid: false, error: "请先配置 AI API Key" };
            }
            return { valid: true };
        },

        // 解析用户意图
        parseIntent: async (userMessage, settings) => {
            const systemPrompt = `你是一个 Notion 全功能助手。分析用户指令，返回 JSON 格式。

用户可能想执行以下操作之一：
1. query - 查询统计（如：有多少帖子、统计分类数量、显示最新帖子）
2. search - 在配置的数据库内搜索（如：搜索关于xxx的帖子、找作者是xxx的）
3. workspace_search - 在整个工作区搜索（如：全局搜索xxx、在工作区搜索、搜索所有页面、列出所有数据库）
4. classify - 分类单个（如：把这个帖子分类为技术）
5. batch_classify - 批量分类（如：自动分类所有未分类的帖子）
6. update - 更新属性（如：把xxx标记为重要）
7. move - 移动页面到另一个数据库（如：把A数据库的帖子移到B数据库、把标题包含xxx的帖子移到B数据库）
8. copy - 复制页面到另一个数据库（如：把A数据库的帖子复制到B数据库、复制标题包含xxx的帖子到B数据库）
9. create_database - 创建新数据库（如：创建一个叫xxx的数据库、新建数据库、在xxx页面下创建数据库）
10. write_content - AI 生成新内容追加到指定页面（如：在xxx页面写一段关于Docker的介绍、给xxx页面添加内容）
11. edit_content - AI 改写页面现有内容（如：把xxx页面的内容改得更简洁、润色xxx页面）
12. translate_content - AI 翻译页面内容（如：把xxx页面翻译成英文、翻译xxx页面为日文）
13. ai_autofill - 批量 AI 属性填充（如：给所有帖子生成AI摘要、提取所有帖子的关键词、翻译所有帖子标题）
14. ask - 全局问答，AI 综合回答问题（如：关于Docker的帖子都说了什么、总结最近的帖子）
15. agent_task - Agent 自主规划并执行复杂任务（如：帮我整理所有帖子并生成摘要、自动分类后移到不同数据库）
16. deep_research - 深入研究特定主题，多关键词搜索后生成结构化研究报告（如：深入研究一下关于AI的所有内容、帮我调研xxx、综合分析xxx主题）
17. template_output - 使用AI输出模板生成内容（如：用周报模板总结xxx、用SWOT模板分析xxx、用摘要提纲模板整理xxx）
18. summarize - 总结/摘要页面内容（如：总结一下xxx页面、帮我概括xxx的内容、给xxx生成摘要）
19. brainstorm - 头脑风暴/创意生成（如：给我一些关于xxx的创意、围绕xxx做头脑风暴、帮我想10个xxx的方案）
20. proofread - 校对/纠正页面的拼写、语法和表达（如：校对一下xxx页面、帮我检查xxx的拼写和语法、纠正xxx页面的错误）
21. batch_translate - 批量翻译数据库中所有页面（如：把整个数据库翻译成日文、翻译xxx数据库的所有页面为英文）
22. extract_to_database - 从页面内容中提取结构化信息生成数据库（如：把这个页面的笔记转为数据库、从头脑风暴便利贴创建路线图数据库、把待办事项提取为任务数据库）
23. generate_pages - 生成多页面结构化内容（如：创建入职指南含子页面、生成竞品分析报告、创建包含多个部分的项目文档）
24. batch_analyze - 批量分析数据库中的页面并生成综合报告（如：分析团队项目生成周报、分析所有帖子找出趋势、综合分析数据库内容）
25. compound - 用户指令包含两个及以上需按顺序执行的不同操作（如：先分类再移动、分类后移到B数据库）
26. github_import - 导入 GitHub 收藏/Stars/Repos/Gists 到 Notion（如：导入GitHub收藏、同步我的GitHub Stars、把GitHub收藏导入到Notion、导入github星标仓库、导入我的仓库、导入Gists）
27. bookmark_import - 导入浏览器书签到 Notion（如：导入书签、同步浏览器收藏、把Chrome书签导入到Notion、整理我的书签）
27. help - 帮助（如：帮助、你能做什么）
28. unknown - 无法理解

注意区分 search 和 workspace_search：
- search: 用户想在配置的帖子数据库中搜索
- workspace_search: 用户明确提到"工作区"、"全局"、"所有页面"、"所有数据库"等，或者想搜索数据库以外的内容

注意区分 move 和 copy：
- move: 用户想把页面从一个数据库移动到另一个数据库（原数据库的页面会消失）
- copy: 用户想把页面复制到另一个数据库（原数据库的页面保留）
- 关键词提示：移动/移/搬/转移 → move；复制/拷贝/副本/备份到 → copy

注意区分 ask 和 search：
- ask: 用户想让 AI 综合分析并回答问题（如"关于Docker的帖子都说了什么"、"总结一下"）
- search: 用户想列出搜索结果（如"搜索Docker相关的帖子"）

注意区分 agent_task 和 compound：
- agent_task: 用户给出高层目标，让 AI 自己规划步骤（如"帮我整理所有帖子"）
- compound: 用户明确给出了顺序步骤（如"先分类再移动"）

注意区分 write_content 和 edit_content：
- write_content: 生成新内容追加到页面（如"写一段介绍"、"添加内容"）
- edit_content: 改写页面现有内容（如"改写"、"润色"、"让它更简洁"）

注意区分 deep_research 和 ask：
- deep_research: 用户想要深入、系统地研究某个主题（如"深入研究xxx"、"调研xxx"、"综合分析xxx"、"全面了解xxx"）
- ask: 用户想要简单问答（如"关于Docker的帖子说了什么"、"总结一下"）
- 关键词提示：研究/调研/深入/综合分析/全面了解/深度分析 → deep_research

注意区分 template_output 和 write_content：
- template_output: 用户明确提到模板或使用预设格式（如"用周报模板"、"用SWOT模板"、"按提纲模板"）
- write_content: 用户想要自由生成内容（如"写一段介绍"、"添加xxx内容"）

注意区分 summarize 和 ask：
- summarize: 用户想要对特定页面生成结构化摘要（如"总结一下xxx页面"、"概括xxx的内容"、"给xxx生成摘要"）
- ask: 用户想要综合多个页面回答问题（如"关于Docker的帖子都说了什么"）
- 关键词提示：总结/概括/摘要/归纳/提炼 + 指定页面 → summarize

注意区分 brainstorm 和 ask：
- brainstorm: 用户想要围绕某主题进行创意发散（如"给我一些关于xxx的创意"、"帮我想10个方案"）
- ask: 用户想要基于工作区内容回答问题
- 关键词提示：创意/头脑风暴/想法/灵感/方案建议/点子 → brainstorm

注意区分 proofread 和 edit_content：
- proofread: 用户想要校对纠错（如"校对一下xxx页面"、"检查拼写和语法"、"纠正错误"）
- edit_content: 用户想要改写内容（如"改得更简洁"、"润色一下"、"换个风格"）
- 关键词提示：校对/纠错/拼写/语法/错别字/纠正 → proofread；润色/改写/重写/风格调整 → edit_content

注意区分 batch_translate 和 translate_content：
- batch_translate: 用户想翻译整个数据库的所有页面（如"把整个数据库翻译成日文"、"翻译所有页面"）
- translate_content: 用户想翻译单个页面（如"把xxx页面翻译成英文"）
- 关键词提示：整个/所有/批量 + 数据库/页面 + 翻译 → batch_translate

注意区分 extract_to_database 和 create_database：
- extract_to_database: 用户想从现有页面内容中提取结构化信息生成数据库（如"把笔记转为数据库"、"提取待办事项为任务"）
- create_database: 用户想创建一个空数据库或通用数据库（如"创建一个项目数据库"）
- 关键词提示：转换/提取/整理成数据库 + 提到源页面 → extract_to_database

注意区分 generate_pages 和 write_content：
- generate_pages: 用户想生成多页面结构化内容（如"创建入职指南含子页面"、"生成包含多个部分的报告"）
- write_content: 用户想在单个页面写入内容
- 关键词提示：多页面/子页面/包含多个部分/多章节/完整指南 → generate_pages

注意区分 batch_analyze 和 deep_research：
- batch_analyze: 用户想批量分析数据库中的多个页面并生成综合报告（如"分析所有项目页面"、"分析团队任务生成周报"）
- deep_research: 用户想深入研究某个主题（搜索 + 分析）
- 关键词提示：分析数据库/分析所有页面/团队分析/批量分析 → batch_analyze

compound 判断依据：
- 用户指令中含"先...再..."、"...之后..."、"...然后..."、"...后..."等顺序词，且涉及两个不同操作
- 单个操作不算 compound（如"移动帖子"只是 move）
- 同一操作的补充说明不算 compound（如"搜索 Docker 并显示前5条"只是 search）

返回格式（只返回 JSON，不要其他内容）：

单操作格式：
{
  "intent": "query|search|workspace_search|classify|batch_classify|update|move|copy|create_database|write_content|edit_content|translate_content|ai_autofill|ask|agent_task|deep_research|template_output|summarize|brainstorm|proofread|batch_translate|extract_to_database|generate_pages|batch_analyze|github_import|bookmark_import|help|unknown",
  "params": {
    "keyword": "搜索关键词（如有）",
    "property": "要更新的属性名（如有）",
    "value": "新值（如有）",
    "limit": 5,
    "filter_field": "筛选字段（如 作者、分类）",
    "filter_value": "筛选值",
    "object_type": "page 或 database（workspace_search 时使用，默认不限）",
    "source_database_name": "源数据库名称（move/copy 时，如用户提到了源数据库名称）",
    "source_database_id": "源数据库ID（move/copy 时，如用户直接提供了ID）",
    "target_database_name": "目标数据库名称（move/copy 时必填）",
    "target_database_id": "目标数据库ID（move/copy 时，如用户直接提供了ID）",
    "page_title": "要移动/复制的页面标题关键词（如用户指定了特定页面）",
    "database_name": "要创建的数据库名称（create_database 时必填）",
    "parent_page_name": "父页面名称（create_database 时可选，如用户提到了父页面）",
    "parent_page_id": "父页面ID（create_database 时可选，如用户直接提供了ID）",
    "content_prompt": "写作/编辑要求（write_content/edit_content 时使用）",
    "page_name": "目标页面名称（write_content/edit_content/translate_content 时使用）",
    "page_id": "目标页面ID（write_content/edit_content/translate_content 时，如用户直接提供了ID）",
    "target_language": "翻译目标语言（translate_content 时使用，如英文、日文）",
    "autofill_type": "AI属性类型（ai_autofill 时使用：summary/keywords/translation/custom）",
    "property_name": "自定义属性名（ai_autofill 且 autofill_type=custom 时使用）",
    "question": "问答问题（ask 时使用）",
    "task_description": "Agent 任务描述（agent_task 时使用）",
    "research_topic": "研究主题（deep_research 时使用）",
    "template_name": "模板名称（template_output 时使用，如：周报/摘要提纲/SWOT分析/行动计划）",
    "custom_context": "用户补充说明（template_output 时可选）",
    "summary_style": "摘要风格（summarize 时使用：brief/detailed/bullet，默认brief）",
    "brainstorm_topic": "头脑风暴主题（brainstorm 时使用）",
    "brainstorm_count": 10,
    "extraction_prompt": "提取要求描述（extract_to_database 时使用，描述要提取什么信息）",
    "structure_prompt": "结构描述（generate_pages 时使用，描述需要生成的页面结构）",
    "analysis_prompt": "分析要求（batch_analyze 时使用，描述分析目标和维度）",
    "username": "GitHub 用户名（github_import 时可选，覆盖已配置的用户名）",
    "classify": false,
    "batch": true
  },
  "explanation": "你对用户意图的理解（中文简短说明）"
}

compound 格式（仅当 intent 为 compound 时使用）：
{
  "intent": "compound",
  "steps": [
    { "intent": "第一步的意图", "params": { ... }, "explanation": "第一步说明" },
    { "intent": "第二步的意图", "params": { ... }, "explanation": "第二步说明" }
  ],
  "explanation": "整体意图说明"
}`;

            try {
                const response = await AIService.requestChat(
                    `${systemPrompt}\n\n用户指令：${userMessage}`,
                    settings,
                    800
                );

                // 尝试提取 JSON
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return { intent: "unknown", explanation: "无法解析响应" };
            } catch (error) {
                console.error("解析意图失败:", error);
                return { intent: "unknown", explanation: error.message };
            }
        },

        // 处理用户消息
        handleMessage: async (userMessage) => {
            const settings = AIAssistant.getSettings();

            // 简单的帮助关键词检测（无需配置）
            const helpKeywords = ["帮助", "help", "你能做什么", "怎么用", "使用说明"];
            if (helpKeywords.some(k => userMessage.includes(k))) {
                return AIAssistant.getHelpMessage();
            }

            // 问候语检测（无需配置）
            const greetings = ["你好", "您好", "hello", "hi", "hey", "嗨", "早上好", "下午好", "晚上好"];
            if (greetings.some(g => userMessage.toLowerCase().trim() === g || userMessage.trim() === g)) {
                const pName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
                return `你好！👋 我是${pName}。\n\n输入「帮助」查看我能做什么，或者直接告诉我你想执行的操作。`;
            }

            // 检查基础配置（不检查数据库 ID，因为工作区搜索不需要）
            const basicConfigCheck = AIAssistant.checkConfig(settings, false);
            if (!basicConfigCheck.valid) {
                return basicConfigCheck.error;
            }

            // 先尝试意图解析，已知意图直接执行，未知/复杂意图走 Agent Loop
            ChatState.updateLastMessage("🤖 正在理解你的需求...", "processing");
            const intentResult = await AIAssistant.parseIntent(userMessage, settings);

            // 可直接执行的意图（有专用 handler 且不在 Agent Tools 中的）
            const directIntents = [
                "query", "search", "workspace_search",
                "classify", "batch_classify",
                "update", "move", "copy", "create_database",
                "write_content", "edit_content", "translate_content",
                "ai_autofill", "deep_research", "template_output",
                "summarize", "brainstorm", "proofread",
                "batch_translate", "extract_to_database",
                "generate_pages", "batch_analyze",
                "github_import", "bookmark_import", "compound"
            ];

            if (directIntents.includes(intentResult.intent)) {
                return await AIAssistant.executeIntent(intentResult, settings);
            }

            // unknown/ask/agent_task/help → Agent Loop
            ChatState.updateLastMessage("🤖 正在思考...", "processing");
            return await AIAssistant.runAgentLoop(userMessage, settings);
        },

        // 执行意图
        executeIntent: async (intentResult, settings) => {
            const { intent, params = {}, explanation } = intentResult;

            // compound 组合指令早期拦截
            if (intent === "compound") {
                return await AIAssistant.handleCompound(intentResult, settings);
            }

            switch (intent) {
                case "query":
                    return await AIAssistant.handleQuery(params, settings, explanation);
                case "search":
                    return await AIAssistant.handleSearch(params, settings, explanation);
                case "workspace_search":
                    return await AIAssistant.handleWorkspaceSearch(params, settings, explanation);
                case "classify":
                    return await AIAssistant.handleClassify(params, settings, explanation);
                case "batch_classify":
                    return await AIAssistant.handleBatchClassify(params, settings, explanation);
                case "update":
                    return await AIAssistant.handleUpdate(params, settings, explanation);
                case "move":
                    return await AIAssistant.handleMove(params, settings, explanation);
                case "copy":
                    return await AIAssistant.handleCopy(params, settings, explanation);
                case "create_database":
                    return await AIAssistant.handleCreateDatabase(params, settings, explanation);
                case "write_content":
                    return await AIAssistant.handleWriteContent(params, settings, explanation);
                case "edit_content":
                    return await AIAssistant.handleEditContent(params, settings, explanation);
                case "translate_content":
                    return await AIAssistant.handleTranslateContent(params, settings, explanation);
                case "ai_autofill":
                    return await AIAssistant.handleAIAutofill(params, settings, explanation);
                case "deep_research":
                    return await AIAssistant.handleDeepResearch(params, settings, explanation);
                case "template_output":
                    return await AIAssistant.handleTemplateOutput(params, settings, explanation);
                case "summarize":
                    return await AIAssistant.handleSummarize(params, settings, explanation);
                case "brainstorm":
                    return await AIAssistant.handleBrainstorm(params, settings, explanation);
                case "proofread":
                    return await AIAssistant.handleProofread(params, settings, explanation);
                case "batch_translate":
                    return await AIAssistant.handleBatchTranslate(params, settings, explanation);
                case "extract_to_database":
                    return await AIAssistant.handleExtractToDatabase(params, settings, explanation);
                case "generate_pages":
                    return await AIAssistant.handleGeneratePages(params, settings, explanation);
                case "batch_analyze":
                    return await AIAssistant.handleBatchAnalyze(params, settings, explanation);
                case "github_import":
                    return await AIAssistant.handleGitHubImport(params, settings, explanation);
                case "bookmark_import":
                    return await AIAssistant.handleBookmarkImport(params, settings, explanation);
                case "ask":
                    return await AIAssistant.handleAsk(params, settings, explanation);
                case "agent_task":
                    return await AIAssistant.handleAgentTask(params, settings, explanation);
                case "help":
                    return AIAssistant.getHelpMessage();
                default:
                    return `抱歉，我没有完全理解你的指令。

${explanation ? `我的理解：${explanation}` : ""}

试试说「帮助」查看我能做什么，或者换一种方式描述你的需求。`;
            }
        },

        // 处理查询
        handleQuery: async (params, settings, explanation) => {
            // 检查数据库 ID 配置
            if (!settings.notionDatabaseId) {
                return "❌ 请先配置 Notion 数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」来查看工作区中的数据库并获取 ID。";
            }

            ChatState.updateLastMessage(`正在查询数据库...`, "processing");

            try {
                const { limit = 10, filter_field, filter_value } = params;

                // 构建过滤条件
                let filter = null;
                if (filter_field && filter_value) {
                    // 字段名称和类型映射
                    const fieldConfig = {
                        "作者": { name: "作者", type: "rich_text" },
                        "分类": { name: "分类", type: "rich_text" },
                        "标签": { name: "标签", type: "multi_select" },
                        "AI分类": { name: "AI分类", type: "select" }
                    };
                    const config = fieldConfig[filter_field] || { name: filter_field, type: "rich_text" };

                    // 根据属性类型构建正确的过滤器
                    if (config.type === "select") {
                        filter = {
                            property: config.name,
                            select: { equals: filter_value }
                        };
                    } else if (config.type === "multi_select") {
                        filter = {
                            property: config.name,
                            multi_select: { contains: filter_value }
                        };
                    } else {
                        filter = {
                            property: config.name,
                            rich_text: { contains: filter_value }
                        };
                    }
                }

                // 查询数据库（支持分页，获取所有结果）
                const allPages = [];
                let cursor = null;
                let hasMore = true;
                const maxPages = 10; // 最多查询 10 页（1000 条），防止无限循环
                let pageCount = 0;
                let querySorts = [];

                while (hasMore && pageCount < maxPages) {
                    // 首次尝试按"收藏时间"排序，失败则按创建时间排序
                    let response;
                    try {
                        response = await NotionAPI.queryDatabase(
                            settings.notionDatabaseId,
                            filter,
                            pageCount === 0 ? [{ property: "收藏时间", direction: "descending" }] : querySorts,
                            cursor,
                            settings.notionApiKey
                        );
                        if (pageCount === 0) querySorts = [{ property: "收藏时间", direction: "descending" }];
                    } catch (sortError) {
                        if (pageCount === 0 && sortError.message?.includes("收藏时间")) {
                            // "收藏时间"属性不存在，改用内置创建时间排序
                            querySorts = [{ timestamp: "created_time", direction: "descending" }];
                            response = await NotionAPI.queryDatabase(
                                settings.notionDatabaseId,
                                filter,
                                querySorts,
                                cursor,
                                settings.notionApiKey
                            );
                        } else {
                            throw sortError;
                        }
                    }

                    allPages.push(...(response.results || []));
                    hasMore = response.has_more;
                    cursor = response.next_cursor;
                    pageCount++;

                    // 更新进度
                    if (hasMore) {
                        ChatState.updateLastMessage(`正在查询数据库... (已获取 ${allPages.length} 条)`, "processing");
                    }
                }

                const pages = allPages;
                const total = pages.length;
                const isTruncated = hasMore; // 如果还有更多，说明被截断了

                if (total === 0) {
                    return `📊 数据库中没有找到符合条件的帖子。${filter ? `\n筛选条件：${filter_field} 包含 "${filter_value}"` : ""}`;
                }

                // 构建结果
                let result = `📊 **查询结果**\n\n`;
                result += `共找到 **${total}** 个帖子`;
                if (isTruncated) {
                    result += ` (已达查询上限，可能还有更多)`;
                }

                if (params.keyword?.includes("统计") || params.keyword?.includes("分类")) {
                    // 统计分类
                    const categoryCount = {};
                    pages.forEach(page => {
                        const cat = page.properties["AI分类"]?.select?.name ||
                                   page.properties["分类"]?.rich_text?.[0]?.plain_text || "未分类";
                        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
                    });

                    result += `\n\n**分类统计：**\n`;
                    Object.entries(categoryCount)
                        .sort((a, b) => b[1] - a[1])
                        .forEach(([cat, count]) => {
                            result += `- ${cat}: ${count} 个\n`;
                        });
                } else {
                    // 显示前几条
                    const showLimit = Math.min(limit, total);
                    result += `（显示前 ${showLimit} 条）\n\n`;

                    pages.slice(0, showLimit).forEach((page, i) => {
                        const title = Utils.getPageTitle(page);
                        const author = page.properties["作者"]?.rich_text?.[0]?.plain_text || "未知";
                        result += `${i + 1}. **${title}**\n   作者: ${author}\n`;
                    });
                }

                return result;
            } catch (error) {
                return `❌ 查询失败: ${error.message}`;
            }
        },

        // 处理搜索
        handleSearch: async (params, settings, explanation) => {
            // 检查数据库 ID 配置
            if (!settings.notionDatabaseId) {
                return "❌ 请先配置 Notion 数据库 ID。\n\n💡 提示：可以使用「在工作区搜索 xxx」来搜索整个工作区，或使用「列出所有数据库」来查看工作区中的数据库并获取 ID。";
            }

            ChatState.updateLastMessage(`正在搜索...`, "processing");

            try {
                const { keyword, limit = 10 } = params;

                if (!keyword) {
                    return "请告诉我你想搜索什么关键词？";
                }

                // 使用 Notion 搜索
                const response = await NotionAPI.search(
                    keyword,
                    { property: "object", value: "page" },
                    settings.notionApiKey
                );

                const pages = (response.results || [])
                    .filter(p => p.parent?.database_id?.replace(/-/g, "") === settings.notionDatabaseId.replace(/-/g, ""));

                if (pages.length === 0) {
                    return `🔍 没有找到包含「${keyword}」的帖子。`;
                }

                let result = `🔍 **搜索结果**\n\n`;
                result += `找到 **${pages.length}** 个包含「${keyword}」的帖子：\n\n`;

                pages.slice(0, limit).forEach((page, i) => {
                    const title = Utils.getPageTitle(page);
                    const url = page.url || "";
                    result += `${i + 1}. [${title}](${url})\n`;
                });

                if (pages.length > limit) {
                    result += `\n... 还有 ${pages.length - limit} 条结果`;
                }

                return result;
            } catch (error) {
                return `❌ 搜索失败: ${error.message}`;
            }
        },

        // 处理工作区搜索（搜索整个 Notion 工作区）
        handleWorkspaceSearch: async (params, settings, explanation) => {
            ChatState.updateLastMessage(`正在搜索整个工作区...`, "processing");

            try {
                const { keyword = "", limit = 10, object_type } = params;

                // 构建过滤器
                let filter = null;
                if (object_type === "page") {
                    filter = { property: "object", value: "page" };
                } else if (object_type === "database") {
                    filter = { property: "object", value: "database" };
                }

                // 使用 Notion 搜索 API（分页获取结果，最多 10 页）
                let allResults = [];
                let cursor = undefined;
                let searchPageCount = 0;
                do {
                    const response = await NotionAPI.search(keyword, filter, settings.notionApiKey, cursor);
                    allResults = allResults.concat(response.results || []);
                    cursor = response.has_more ? response.next_cursor : undefined;
                    searchPageCount++;
                } while (cursor && searchPageCount < 10);

                const results = allResults;

                if (results.length === 0) {
                    const typeLabel = object_type === "page" ? "页面" : object_type === "database" ? "数据库" : "内容";
                    return keyword
                        ? `🌐 在工作区中没有找到包含「${keyword}」的${typeLabel}。`
                        : `🌐 工作区中没有找到${typeLabel}。`;
                }

                // 分类结果
                const pages = results.filter(r => r.object === "page");
                const databases = results.filter(r => r.object === "database");

                let result = `🌐 **工作区搜索结果**\n\n`;

                if (keyword) {
                    result += `搜索关键词：「${keyword}」\n`;
                }
                result += `共找到 **${results.length}** 个结果`;
                if (pages.length > 0 && databases.length > 0) {
                    result += `（${pages.length} 个页面，${databases.length} 个数据库）`;
                }
                result += `\n\n`;

                // 显示数据库
                if (databases.length > 0 && (!object_type || object_type === "database")) {
                    result += `📁 **数据库** (${databases.length})\n`;
                    databases.slice(0, limit).forEach((db, i) => {
                        const title = db.title?.[0]?.plain_text || "无标题数据库";
                        const url = db.url || "";
                        const id = db.id?.replace(/-/g, "") || "";
                        result += `${i + 1}. [${title}](${url})\n`;
                        result += `   ID: \`${id}\`\n`;
                    });
                    if (databases.length > limit) {
                        result += `   ... 还有 ${databases.length - limit} 个数据库\n`;
                    }
                    result += `\n`;
                }

                // 显示页面
                if (pages.length > 0 && (!object_type || object_type === "page")) {
                    result += `📄 **页面** (${pages.length})\n`;
                    pages.slice(0, limit).forEach((page, i) => {
                        const title = Utils.getPageTitle(page);
                        const url = page.url || "";
                        const parentType = page.parent?.type || "";
                        let parentLabel = "";
                        if (parentType === "database_id") {
                            parentLabel = "📁 数据库条目";
                        } else if (parentType === "page_id") {
                            parentLabel = "📄 子页面";
                        } else if (parentType === "workspace") {
                            parentLabel = "🌐 工作区页面";
                        }

                        result += `${i + 1}. [${title}](${url})`;
                        if (parentLabel) {
                            result += ` - ${parentLabel}`;
                        }
                        result += `\n`;
                    });
                    if (pages.length > limit) {
                        result += `   ... 还有 ${pages.length - limit} 个页面\n`;
                    }
                }

                result += `\n💡 提示：复制数据库 ID 可以配置到设置中使用更多功能。`;

                return result;
            } catch (error) {
                return `❌ 工作区搜索失败: ${error.message}`;
            }
        },

        // 处理单个分类
        handleClassify: async (params, settings, explanation) => {
            return "📝 单个分类功能开发中...\n\n目前可以使用「自动分类所有未分类的帖子」来批量分类。";
        },

        // 处理批量分类
        handleBatchClassify: async (params, settings, explanation) => {
            // 检查数据库 ID 配置
            if (!settings.notionDatabaseId) {
                return "❌ 请先配置 Notion 数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」来查看工作区中的数据库并获取 ID。";
            }

            if (settings.categories.length < 2) {
                return "❌ 请先在设置面板中配置至少两个分类选项。";
            }

            ChatState.updateLastMessage(`正在准备批量分类...\n分类选项: ${settings.categories.join(", ")}`, "processing");

            try {
                // 确保数据库有 AI分类 属性
                await AIClassifier.ensureAICategoryProperty(settings);

                // 获取所有页面
                ChatState.updateLastMessage(`正在获取数据库页面...`, "processing");
                const pages = await AIClassifier.fetchAllPages(settings);

                if (pages.length === 0) {
                    return "📭 数据库中没有找到任何页面。";
                }

                // 过滤未分类的页面
                const unclassified = pages.filter(p => {
                    const aiCategory = p.properties["AI分类"];
                    return !aiCategory?.select?.name;
                });

                if (unclassified.length === 0) {
                    return `✅ 所有 ${pages.length} 个页面都已分类完成！`;
                }

                // 开始分类
                const results = { success: 0, failed: 0 };
                const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

                for (let i = 0; i < unclassified.length; i++) {
                    const page = unclassified[i];
                    const title = AIClassifier.getPageTitle(page);

                    ChatState.updateLastMessage(
                        `🔄 正在分类 (${i + 1}/${unclassified.length})\n\n当前: ${title}`,
                        "processing"
                    );

                    try {
                        await AIClassifier.classifyPage(page, settings);
                        results.success++;
                    } catch (error) {
                        console.error(`分类失败: ${title}`, error);
                        results.failed++;
                    }

                    if (i < unclassified.length - 1) {
                        await Utils.sleep(delay);
                    }
                }

                let resultMsg = `✅ **批量分类完成**\n\n`;
                resultMsg += `- 总计: ${pages.length} 个页面\n`;
                resultMsg += `- 已分类: ${pages.length - unclassified.length} 个\n`;
                resultMsg += `- 本次分类: ${results.success} 个\n`;
                if (results.failed > 0) {
                    resultMsg += `- 失败: ${results.failed} 个\n`;
                }

                return resultMsg;
            } catch (error) {
                return `❌ 批量分类失败: ${error.message}`;
            }
        },

        // 处理更新属性
        handleUpdate: async (params, settings, explanation) => {
            return "✏️ 属性更新功能开发中...\n\n目前可以使用查询和分类功能。";
        },

        // 解析数据库名称到 ID
        _resolveDatabaseId: async (name, id, apiKey) => {
            // 优先使用直接提供的 ID
            if (id) return { id: id.replace(/-/g, ""), name: name || id };

            if (!name) return null;

            // 通过名称搜索数据库
            const response = await NotionAPI.search(
                name,
                { property: "object", value: "database" },
                apiKey
            );

            const databases = response.results || [];
            // 优先精确匹配，再模糊匹配
            let exactMatch = null;
            const partialMatches = [];
            for (const db of databases) {
                const titleProp = db.title || [];
                const dbTitle = titleProp.map(t => t.plain_text).join("");
                if (!dbTitle) continue;
                if (dbTitle === name) {
                    exactMatch = { id: db.id.replace(/-/g, ""), name: dbTitle };
                    break;
                }
                if (dbTitle.includes(name)) {
                    partialMatches.push({ id: db.id.replace(/-/g, ""), name: dbTitle });
                }
            }

            if (exactMatch) return exactMatch;
            if (partialMatches.length === 1) return partialMatches[0];
            if (partialMatches.length > 1) {
                // 多个模糊匹配，返回错误避免误操作
                const names = partialMatches.map(m => `「${m.name}」`).join("、");
                return { error: `找到多个匹配的数据库: ${names}，请使用更精确的名称。` };
            }

            return null;
        },

        // 从源数据库获取页面
        _fetchSourcePages: async (databaseId, apiKey, pageTitle) => {
            const allPages = [];
            let cursor = null;

            do {
                const response = await NotionAPI.queryDatabase(databaseId, null, null, cursor, apiKey);
                allPages.push(...(response.results || []));
                cursor = response.has_more ? response.next_cursor : null;
            } while (cursor);

            // 如果指定了标题关键词，按标题过滤
            if (pageTitle) {
                return allPages.filter(page => {
                    const title = Utils.getPageTitle(page);
                    return title.includes(pageTitle);
                });
            }

            return allPages;
        },

        // 处理移动页面
        handleMove: async (params, settings, explanation) => {
            // 检查基础配置
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            // 权限检查
            if (!OperationGuard.canExecute("movePage")) {
                return "❌ 权限不足：移动页面需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
            }

            const { source_database_name, source_database_id, target_database_name, target_database_id, page_title } = params;

            ChatState.updateLastMessage("正在解析数据库信息...", "processing");

            try {
                // 解析源数据库（未指定时使用已配置的数据库）
                let source = await AIAssistant._resolveDatabaseId(source_database_name, source_database_id, settings.notionApiKey);
                if (source?.error) return `❌ 源数据库解析失败：${source.error}`;
                if (!source && settings.notionDatabaseId) {
                    source = { id: settings.notionDatabaseId.replace(/-/g, ""), name: "已配置的数据库" };
                }
                if (!source) {
                    return "❌ 无法确定源数据库。请指定源数据库名称，或先在设置中配置数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。";
                }

                // 解析目标数据库
                const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
                if (target?.error) return `❌ 目标数据库解析失败：${target.error}`;
                if (!target) {
                    return `❌ 找不到目标数据库「${target_database_name || target_database_id}」。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。`;
                }

                // 源=目标拦截
                if (source.id === target.id) {
                    return "❌ 源数据库和目标数据库相同，无需移动。";
                }

                // 获取源页面
                ChatState.updateLastMessage(`正在从「${source.name}」获取页面...`, "processing");
                const pages = await AIAssistant._fetchSourcePages(source.id, settings.notionApiKey, page_title);

                if (pages.length === 0) {
                    return page_title
                        ? `📭 在「${source.name}」中没有找到标题包含「${page_title}」的页面。`
                        : `📭「${source.name}」中没有页面。`;
                }

                // 批量移动
                const results = { success: 0, failed: 0 };
                const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

                for (let i = 0; i < pages.length; i++) {
                    const page = pages[i];
                    const title = Utils.getPageTitle(page);

                    ChatState.updateLastMessage(
                        `📦 正在移动 (${i + 1}/${pages.length})\n\n当前: ${title}\n→ 目标: ${target.name}`,
                        "processing"
                    );

                    try {
                        await OperationGuard.execute("movePage",
                            () => NotionAPI.movePage(page.id, target.id, "database", settings.notionApiKey),
                            { itemName: title, pageId: page.id, apiKey: settings.notionApiKey }
                        );
                        results.success++;
                    } catch (error) {
                        console.error(`移动失败: ${title}`, error);
                        results.failed++;
                    }

                    if (i < pages.length - 1) {
                        await Utils.sleep(delay);
                    }
                }

                let resultMsg = `✅ **移动完成**\n\n`;
                resultMsg += `- 源数据库: ${source.name}\n`;
                resultMsg += `- 目标数据库: ${target.name}\n`;
                resultMsg += `- 成功: ${results.success} 个\n`;
                if (results.failed > 0) {
                    resultMsg += `- 失败: ${results.failed} 个\n`;
                }

                return resultMsg;
            } catch (error) {
                return `❌ 移动失败: ${error.message}`;
            }
        },

        // 处理复制页面
        handleCopy: async (params, settings, explanation) => {
            // 检查基础配置
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            // 权限检查
            if (!OperationGuard.canExecute("duplicatePage")) {
                return "❌ 权限不足：复制页面需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
            }

            const { source_database_name, source_database_id, target_database_name, target_database_id, page_title } = params;

            ChatState.updateLastMessage("正在解析数据库信息...", "processing");

            try {
                // 解析源数据库（未指定时使用已配置的数据库）
                let source = await AIAssistant._resolveDatabaseId(source_database_name, source_database_id, settings.notionApiKey);
                if (source?.error) return `❌ 源数据库解析失败：${source.error}`;
                if (!source && settings.notionDatabaseId) {
                    source = { id: settings.notionDatabaseId.replace(/-/g, ""), name: "已配置的数据库" };
                }
                if (!source) {
                    return "❌ 无法确定源数据库。请指定源数据库名称，或先在设置中配置数据库 ID。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。";
                }

                // 解析目标数据库
                const target = await AIAssistant._resolveDatabaseId(target_database_name, target_database_id, settings.notionApiKey);
                if (target?.error) return `❌ 目标数据库解析失败：${target.error}`;
                if (!target) {
                    return `❌ 找不到目标数据库「${target_database_name || target_database_id}」。\n\n💡 提示：可以使用「列出所有数据库」查看工作区中的数据库。`;
                }

                // 源=目标拦截
                if (source.id === target.id) {
                    return "❌ 源数据库和目标数据库相同，无需复制。";
                }

                // 获取源页面
                ChatState.updateLastMessage(`正在从「${source.name}」获取页面...`, "processing");
                const pages = await AIAssistant._fetchSourcePages(source.id, settings.notionApiKey, page_title);

                if (pages.length === 0) {
                    return page_title
                        ? `📭 在「${source.name}」中没有找到标题包含「${page_title}」的页面。`
                        : `📭「${source.name}」中没有页面。`;
                }

                // 批量复制
                const results = { success: 0, failed: 0 };
                const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

                for (let i = 0; i < pages.length; i++) {
                    const page = pages[i];
                    const title = Utils.getPageTitle(page);

                    ChatState.updateLastMessage(
                        `📋 正在复制 (${i + 1}/${pages.length})\n\n当前: ${title}\n→ 目标: ${target.name}`,
                        "processing"
                    );

                    try {
                        await OperationGuard.execute("duplicatePage",
                            () => NotionAPI.duplicatePage(page.id, target.id, "database", settings.notionApiKey),
                            { itemName: title, pageId: page.id, apiKey: settings.notionApiKey }
                        );
                        results.success++;
                    } catch (error) {
                        console.error(`复制失败: ${title}`, error);
                        results.failed++;
                    }

                    if (i < pages.length - 1) {
                        await Utils.sleep(delay);
                    }
                }

                let resultMsg = `✅ **复制完成**\n\n`;
                resultMsg += `- 源数据库: ${source.name}\n`;
                resultMsg += `- 目标数据库: ${target.name}\n`;
                resultMsg += `- 成功: ${results.success} 个\n`;
                if (results.failed > 0) {
                    resultMsg += `- 失败: ${results.failed} 个\n`;
                }

                return resultMsg;
            } catch (error) {
                return `❌ 复制失败: ${error.message}`;
            }
        },

        // 处理组合指令
        handleCompound: async (intentResult, settings) => {
            const { steps, explanation } = intentResult;

            if (!steps || steps.length === 0) {
                return "❌ 组合指令解析失败：未识别到有效的执行步骤。";
            }

            // 展示执行计划
            let planMsg = `🔗 **组合指令** — ${explanation}\n\n📋 执行计划：\n`;
            steps.forEach((step, i) => {
                planMsg += `${i + 1}. ${step.explanation}\n`;
            });
            ChatState.updateLastMessage(planMsg, "processing");

            const results = [];
            let aborted = false;

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];

                ChatState.updateLastMessage(
                    `${planMsg}\n⏳ 步骤 ${i + 1}/${steps.length}: ${step.explanation}`,
                    "processing"
                );

                try {
                    const stepResult = await AIAssistant.executeIntent(step, settings);

                    // 检测 handler 返回的错误（以 ❌ 开头的字符串）
                    if (typeof stepResult === "string" && stepResult.startsWith("❌")) {
                        results.push({ index: i + 1, explanation: step.explanation, success: false, result: stepResult });
                        aborted = true;
                        break;
                    }

                    results.push({ index: i + 1, explanation: step.explanation, success: true, result: stepResult });
                } catch (error) {
                    results.push({ index: i + 1, explanation: step.explanation, success: false, result: `❌ ${error.message}` });
                    aborted = true;
                    break;
                }
            }

            // 汇总报告
            let report = `🔗 **组合指令执行${aborted ? "中断" : "完成"}**\n\n`;
            for (const r of results) {
                report += `${r.success ? "✅" : "❌"} 步骤 ${r.index}: ${r.explanation}\n`;
            }

            if (aborted) {
                const skipped = steps.slice(results.length);
                if (skipped.length > 0) {
                    report += `\n⏭️ 已跳过：\n`;
                    skipped.forEach((step, i) => {
                        report += `${results.length + i + 1}. ${step.explanation}\n`;
                    });
                }
            }

            // 附加各步骤详细结果
            report += `\n---\n`;
            for (const r of results) {
                report += `\n**步骤 ${r.index}**: ${r.explanation}\n${r.result}\n`;
            }

            return report;
        },

        // 处理创建数据库
        handleCreateDatabase: async (params, settings, explanation) => {
            // 检查基础配置（需要 API Key，不需要数据库 ID）
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            // 权限检查
            if (!OperationGuard.canExecute("createDatabase")) {
                return "❌ 权限不足：创建数据库需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
            }

            const { database_name, parent_page_name, parent_page_id } = params;

            // 校验数据库名称必填
            if (!database_name) {
                return "❌ 请指定要创建的数据库名称。\n\n💡 示例：「创建一个叫技术文档的数据库」";
            }

            ChatState.updateLastMessage("正在解析父页面信息...", "processing");

            try {
                let parentPage = null;

                // 使用共享的页面解析器
                if (parent_page_id || parent_page_name) {
                    parentPage = await AIAssistant._resolvePageId(parent_page_name, parent_page_id, settings.notionApiKey);
                    if (parentPage?.error) return `❌ 父页面解析失败：${parentPage.error}`;
                    if (!parentPage) {
                        return `❌ 找不到名为「${parent_page_name}」的页面。\n\n💡 提示：可以使用「在工作区搜索所有页面」查看可用页面。`;
                    }
                }
                // 未指定父页面，搜索工作区页面供选择
                else {
                    ChatState.updateLastMessage("未指定父页面，正在搜索工作区页面...", "processing");
                    const response = await NotionAPI.search(
                        "",
                        { property: "object", value: "page" },
                        settings.notionApiKey
                    );
                    const pages = (response.results || []).filter(p => !p.archived && p.parent?.type === "workspace");

                    if (pages.length === 0) {
                        return "❌ 工作区中没有找到可用的页面作为父页面。\n\n💡 请先在 Notion 中创建一个页面，或指定父页面名称。\n\n示例：「在 xxx 页面下创建一个叫技术文档的数据库」";
                    }

                    // 使用第一个工作区顶级页面
                    const firstPage = pages[0];
                    parentPage = { id: firstPage.id.replace(/-/g, ""), name: Utils.getPageTitle(firstPage) || "未命名页面" };
                }

                // 构建默认属性 schema
                ChatState.updateLastMessage(`正在创建数据库「${database_name}」...`, "processing");

                const properties = {
                    "标题": { title: {} },
                    "链接": { url: {} },
                    "分类": { rich_text: {} },
                    "标签": { multi_select: { options: [] } },
                    "作者": { rich_text: {} },
                    "收藏时间": { date: {} },
                    "帖子数": { number: { format: "number" } },
                    "浏览数": { number: { format: "number" } },
                    "点赞数": { number: { format: "number" } },
                };

                // 调用 API 创建数据库
                const result = await OperationGuard.execute("createDatabase",
                    () => NotionAPI.createDatabase(parentPage.id, database_name, properties, settings.notionApiKey),
                    { itemName: database_name, apiKey: settings.notionApiKey }
                );

                const newDbId = result.id?.replace(/-/g, "") || "";
                let msg = `✅ **数据库创建成功**\n\n`;
                msg += `- 数据库名称: ${database_name}\n`;
                msg += `- 数据库 ID: \`${newDbId}\`\n`;
                msg += `- 父页面: ${parentPage.name}\n`;
                msg += `\n💡 提示：可以将此 ID 填入设置中的「数据库 ID」字段来使用该数据库。`;

                return msg;
            } catch (error) {
                return `❌ 创建数据库失败: ${error.message}`;
            }
        },

        // ======= 通用工具方法 =======

        // 解析页面名称到 ID（对称于 _resolveDatabaseId）
        _resolvePageId: async (name, id, apiKey) => {
            if (id) return { id: id.replace(/-/g, ""), name: name || id };
            if (!name) return null;

            const response = await NotionAPI.search(
                name,
                { property: "object", value: "page" },
                apiKey
            );

            const pages = (response.results || []).filter(p => !p.archived);
            let exactMatch = null;
            const partialMatches = [];
            for (const page of pages) {
                const title = Utils.getPageTitle(page);
                if (!title) continue;
                if (title === name) {
                    exactMatch = { id: page.id.replace(/-/g, ""), name: title };
                    break;
                }
                if (title.includes(name)) {
                    partialMatches.push({ id: page.id.replace(/-/g, ""), name: title });
                }
            }

            if (exactMatch) return exactMatch;
            if (partialMatches.length === 1) return partialMatches[0];
            if (partialMatches.length > 1) {
                const names = partialMatches.map(m => `「${m.name}」`).join("、");
                return { error: `找到多个匹配的页面: ${names}，请使用更精确的名称。` };
            }
            return null;
        },

        // Markdown 文本转 Notion 块
        _textToBlocks: (text) => {
            const blocks = [];
            const lines = text.split("\n");
            let inCodeBlock = false;
            let codeLines = [];
            let codeLang = "plain text";

            // Notion 接受的代码语言映射（常见缩写 → Notion 标准名）
            const LANG_MAP = {
                js: "javascript", ts: "typescript", py: "python", rb: "ruby",
                sh: "shell", bash: "shell", zsh: "shell", yml: "yaml",
                md: "markdown", cs: "c#", cpp: "c++", objc: "objective-c",
                kt: "kotlin", rs: "rust", go: "go", java: "java",
                html: "html", css: "css", json: "json", xml: "xml",
                sql: "sql", r: "r", swift: "swift", scala: "scala",
                php: "php", perl: "perl", lua: "lua", dart: "dart",
                dockerfile: "docker", makefile: "makefile", toml: "toml",
                graphql: "graphql", protobuf: "protobuf", sass: "sass",
                scss: "scss", less: "less", jsx: "javascript", tsx: "typescript",
            };
            const NOTION_LANGS = new Set([
                "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript",
                "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm",
                "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql",
                "groovy", "haskell", "html", "java", "javascript", "json", "julia",
                "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile",
                "markdown", "markup", "matlab", "mermaid", "nix", "objective-c",
                "ocaml", "pascal", "perl", "php", "plain text", "powershell",
                "prolog", "protobuf", "python", "r", "reason", "ruby", "rust",
                "sass", "scala", "scheme", "scss", "shell", "sql", "swift",
                "typescript", "vb.net", "verilog", "vhdl", "visual basic",
                "webassembly", "xml", "yaml", "java/c/c++/c#",
            ]);
            const normalizeLanguage = (lang) => {
                const lower = (lang || "").toLowerCase().trim();
                if (!lower) return "plain text";
                if (LANG_MAP[lower]) return LANG_MAP[lower];
                if (NOTION_LANGS.has(lower)) return lower;
                return "plain text";
            };

            const splitLongText = (str) => {
                const maxLen = 2000;
                const chunks = [];
                if (str.length <= maxLen) {
                    chunks.push({ type: "text", text: { content: str } });
                } else {
                    let remaining = str;
                    while (remaining.length > 0) {
                        chunks.push({ type: "text", text: { content: remaining.substring(0, maxLen) } });
                        remaining = remaining.substring(maxLen);
                    }
                }
                return chunks;
            };

            for (const line of lines) {
                // 代码块处理
                if (line.startsWith("```")) {
                    if (inCodeBlock) {
                        const code = codeLines.join("\n");
                        blocks.push({
                            type: "code",
                            code: { rich_text: splitLongText(code), language: codeLang }
                        });
                        codeLines = [];
                        inCodeBlock = false;
                    } else {
                        inCodeBlock = true;
                        codeLang = normalizeLanguage(line.slice(3).trim());
                    }
                    continue;
                }

                if (inCodeBlock) {
                    codeLines.push(line);
                    continue;
                }

                // 空行跳过
                if (!line.trim()) continue;

                // 标题
                if (line.startsWith("### ")) {
                    blocks.push({ type: "heading_3", heading_3: { rich_text: splitLongText(line.slice(4)) } });
                } else if (line.startsWith("## ")) {
                    blocks.push({ type: "heading_2", heading_2: { rich_text: splitLongText(line.slice(3)) } });
                } else if (line.startsWith("# ")) {
                    blocks.push({ type: "heading_1", heading_1: { rich_text: splitLongText(line.slice(2)) } });
                }
                // 分割线
                else if (line.trim() === "---" || line.trim() === "***") {
                    blocks.push({ type: "divider", divider: {} });
                }
                // 引用
                else if (line.startsWith("> ")) {
                    blocks.push({ type: "quote", quote: { rich_text: splitLongText(line.slice(2)) } });
                }
                // 无序列表
                else if (/^[-*]\s/.test(line)) {
                    blocks.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: splitLongText(line.replace(/^[-*]\s/, "")) } });
                }
                // 有序列表
                else if (/^\d+\.\s/.test(line)) {
                    blocks.push({ type: "numbered_list_item", numbered_list_item: { rich_text: splitLongText(line.replace(/^\d+\.\s/, "")) } });
                }
                // 普通段落
                else {
                    blocks.push({ type: "paragraph", paragraph: { rich_text: splitLongText(line) } });
                }
            }

            // 处理未闭合的代码块
            if (inCodeBlock && codeLines.length > 0) {
                const code = codeLines.join("\n");
                blocks.push({
                    type: "code",
                    code: { rich_text: splitLongText(code), language: codeLang }
                });
            }

            return blocks;
        },

        // 提取页面内容文本
        _extractPageContent: async (pageId, apiKey, maxChars = 4000) => {
            const allBlocks = [];
            let cursor = null;
            do {
                const data = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
                allBlocks.push(...(data.results || []));
                cursor = data.has_more ? data.next_cursor : null;
            } while (cursor);
            return AIClassifier.extractText(allBlocks).slice(0, maxChars);
        },

        // ======= 写作/内容生成 =======

        handleWriteContent: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("appendBlocks")) {
                return "❌ 权限不足：内容生成需要「标准」权限级别。";
            }

            const { content_prompt, page_name, page_id } = params;
            if (!content_prompt) {
                return "❌ 请描述你想生成的内容。\n\n💡 示例：「在 xxx 页面写一段关于 Docker 的介绍」";
            }

            if (!page_name && !page_id) {
                return "❌ 请指定目标页面。\n\n💡 示例：「在 xxx 页面写一段关于 Docker 的介绍」";
            }

            ChatState.updateLastMessage("正在解析目标页面...", "processing");

            try {
                const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
                if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。\n\n💡 提示：可以使用「在工作区搜索所有页面」查看可用页面。`;

                ChatState.updateLastMessage("正在生成内容...", "processing");

                const prompt = `你是一个内容生成助手。根据用户要求生成内容，使用 Markdown 格式。\n\n用户要求：${content_prompt}`;
                const aiResponse = await AIService.requestChat(prompt, settings, 2000);

                ChatState.updateLastMessage("正在写入页面...", "processing");

                const blocks = AIAssistant._textToBlocks(aiResponse);
                await NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey);

                return `✅ **内容已生成并追加到页面**\n\n- 目标页面: ${targetPage.name}\n- 生成内容: ${aiResponse.length} 字\n\n💡 内容已追加到页面末尾。`;
            } catch (error) {
                return `❌ 内容生成失败: ${error.message}`;
            }
        },

        // ======= 编辑内容 =======

        handleEditContent: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("appendBlocks")) {
                return "❌ 权限不足：内容编辑需要「标准」权限级别。";
            }

            const { content_prompt, page_name, page_id } = params;
            if (!content_prompt) {
                return "❌ 请描述编辑要求。\n\n💡 示例：「把 xxx 页面的内容改得更简洁」";
            }

            if (!page_name && !page_id) {
                return "❌ 请指定目标页面。\n\n💡 示例：「把 xxx 页面的内容改得更简洁」";
            }

            ChatState.updateLastMessage("正在解析目标页面...", "processing");

            try {
                const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
                if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

                ChatState.updateLastMessage("正在读取页面内容...", "processing");

                const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey);
                if (!existingContent.trim()) {
                    return `❌ 页面「${targetPage.name}」没有可编辑的内容。`;
                }

                ChatState.updateLastMessage("正在改写内容...", "processing");

                const prompt = `你是一个内容编辑助手。根据编辑指令改写以下内容，使用 Markdown 格式输出改写后的完整内容。\n\n原文：\n${existingContent}\n\n编辑指令：${content_prompt}`;
                const aiResponse = await AIService.requestChat(prompt, settings, 2000);

                ChatState.updateLastMessage("正在写入编辑版本...", "processing");

                const contentBlocks = AIAssistant._textToBlocks(aiResponse);
                const blocks = [
                    { type: "divider", divider: {} },
                    { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "✏️ AI 编辑版本" } }] } },
                    ...contentBlocks
                ];
                await NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey);

                return `✅ **编辑版本已追加到页面**\n\n- 目标页面: ${targetPage.name}\n- 编辑指令: ${content_prompt}\n\n💡 编辑后的版本已追加到页面末尾（原内容保留）。`;
            } catch (error) {
                return `❌ 内容编辑失败: ${error.message}`;
            }
        },

        // ======= 翻译内容 =======

        handleTranslateContent: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("appendBlocks")) {
                return "❌ 权限不足：内容翻译需要「标准」权限级别。";
            }

            const { page_name, page_id, target_language } = params;
            const lang = target_language || "英文";

            if (!page_name && !page_id) {
                return "❌ 请指定要翻译的页面。\n\n💡 示例：「把 xxx 页面翻译成英文」";
            }

            ChatState.updateLastMessage("正在解析目标页面...", "processing");

            try {
                const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
                if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

                ChatState.updateLastMessage("正在读取页面内容...", "processing");

                const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey);
                if (!existingContent.trim()) {
                    return `❌ 页面「${targetPage.name}」没有可翻译的内容。`;
                }

                ChatState.updateLastMessage(`正在翻译为${lang}...`, "processing");

                const prompt = `你是一个专业翻译。将以下内容翻译为${lang}，使用 Markdown 格式，保持原文结构。\n\n原文：\n${existingContent}`;
                const aiResponse = await AIService.requestChat(prompt, settings, 2000);

                ChatState.updateLastMessage("正在写入翻译版本...", "processing");

                const contentBlocks = AIAssistant._textToBlocks(aiResponse);
                const blocks = [
                    { type: "divider", divider: {} },
                    { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `🌐 AI 翻译（${lang}）` } }] } },
                    ...contentBlocks
                ];
                await NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey);

                return `✅ **翻译已追加到页面**\n\n- 目标页面: ${targetPage.name}\n- 翻译语言: ${lang}\n- 翻译内容: ${aiResponse.length} 字\n\n💡 翻译版本已追加到页面末尾（原内容保留）。`;
            } catch (error) {
                return `❌ 翻译失败: ${error.message}`;
            }
        },

        // ======= AI 数据库属性自动填充 =======

        _ensureAIProperty: async (databaseId, propertyName, propertyType, apiKey) => {
            const database = await NotionAPI.fetchDatabase(databaseId, apiKey);
            const properties = database.properties || {};

            if (properties[propertyName]) return;

            const propDef = {};
            if (propertyType === "multi_select") {
                propDef[propertyName] = { multi_select: { options: [] } };
            } else {
                propDef[propertyName] = { rich_text: {} };
            }

            await NotionAPI.updateDatabase(databaseId, propDef, apiKey);
            console.log(`已创建属性「${propertyName}」`);
        },

        handleAIAutofill: async (params, settings, explanation) => {
            if (!OperationGuard.canExecute("updatePage")) {
                return "❌ 权限不足：AI 属性填充需要「标准」及以上权限。\n\n请在设置中提升权限级别。";
            }

            const configCheck = AIAssistant.checkConfig(settings, true);
            if (!configCheck.valid) return configCheck.error;

            const { autofill_type, property_name } = params;
            if (!autofill_type) {
                return "❌ 请指定填充类型。\n\n💡 支持的类型：\n- 摘要：「给所有帖子生成 AI 摘要」\n- 关键词：「提取所有帖子的关键词」\n- 翻译：「把所有帖子标题翻译成英文」";
            }

            // 根据类型确定属性名和 AI 提示词
            let propName, propType, aiPromptTemplate;
            switch (autofill_type) {
                case "summary":
                    propName = "AI摘要";
                    propType = "rich_text";
                    aiPromptTemplate = "请用2-3句话简洁概括以下内容的要点：\n\n";
                    break;
                case "keywords":
                    propName = "AI关键词";
                    propType = "multi_select";
                    aiPromptTemplate = "请从以下内容中提取3-5个关键词，用逗号分隔，只返回关键词：\n\n";
                    break;
                case "translation":
                    propName = "AI翻译";
                    propType = "rich_text";
                    aiPromptTemplate = "请将以下标题翻译为英文，只返回翻译结果：\n\n";
                    break;
                case "custom":
                    propName = property_name || "AI自定义";
                    propType = "rich_text";
                    aiPromptTemplate = "请根据以下内容生成对应的属性值：\n\n";
                    break;
                default:
                    return `❌ 不支持的填充类型「${autofill_type}」。支持：summary/keywords/translation/custom`;
            }

            ChatState.updateLastMessage(`正在准备 AI 属性填充（${propName}）...`, "processing");

            try {
                await AIAssistant._ensureAIProperty(settings.notionDatabaseId, propName, propType, settings.notionApiKey);

                ChatState.updateLastMessage("正在获取数据库页面...", "processing");

                const allPages = [];
                let cursor = null;
                do {
                    const response = await NotionAPI.queryDatabase(settings.notionDatabaseId, null, null, cursor, settings.notionApiKey);
                    allPages.push(...(response.results || []));
                    cursor = response.has_more ? response.next_cursor : null;
                } while (cursor);

                if (allPages.length === 0) {
                    return "📭 数据库中没有找到任何页面。";
                }

                // 过滤属性为空的页面
                const needFill = allPages.filter(page => {
                    const prop = page.properties[propName];
                    if (!prop) return true;
                    if (propType === "multi_select") {
                        return !prop.multi_select || prop.multi_select.length === 0;
                    }
                    return !prop.rich_text || prop.rich_text.length === 0;
                });

                if (needFill.length === 0) {
                    return `✅ 所有 ${allPages.length} 个页面的「${propName}」属性都已填充。`;
                }

                const results = { success: 0, failed: 0 };
                const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

                for (let i = 0; i < needFill.length; i++) {
                    const page = needFill[i];
                    const title = Utils.getPageTitle(page);

                    ChatState.updateLastMessage(
                        `🔄 正在填充「${propName}」(${i + 1}/${needFill.length})\n\n当前: ${title}`,
                        "processing"
                    );

                    try {
                        // 获取内容：翻译类型只需标题，其他需提取页面内容
                        let inputText = title;
                        if (autofill_type !== "translation") {
                            try {
                                const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 2000);
                                inputText = content || title;
                            } catch { inputText = title; }
                        }

                        const aiResult = await AIService.requestChat(
                            aiPromptTemplate + inputText,
                            settings,
                            500
                        );

                        // 更新页面属性
                        const updateProps = {};
                        if (propType === "multi_select") {
                            const keywords = aiResult.split(/[,，]/).map(k => k.trim()).filter(Boolean).slice(0, 10);
                            updateProps[propName] = { multi_select: keywords.map(k => ({ name: k })) };
                        } else {
                            const trimmed = aiResult.slice(0, 2000);
                            updateProps[propName] = { rich_text: [{ type: "text", text: { content: trimmed } }] };
                        }

                        await NotionAPI.request("PATCH", `/pages/${page.id}`, { properties: updateProps }, settings.notionApiKey);
                        results.success++;
                    } catch (error) {
                        console.error(`AI 填充失败: ${title}`, error);
                        results.failed++;
                    }

                    if (i < needFill.length - 1) {
                        await Utils.sleep(delay);
                    }
                }

                let resultMsg = `✅ **AI 属性填充完成**\n\n`;
                resultMsg += `- 属性名: ${propName}\n`;
                resultMsg += `- 总计: ${allPages.length} 个页面\n`;
                resultMsg += `- 已填充: ${allPages.length - needFill.length} 个\n`;
                resultMsg += `- 本次填充: ${results.success} 个\n`;
                if (results.failed > 0) {
                    resultMsg += `- 失败: ${results.failed} 个\n`;
                }
                return resultMsg;
            } catch (error) {
                return `❌ AI 属性填充失败: ${error.message}`;
            }
        },

        // ======= 全局问答（RAG） =======

        handleAsk: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            const { question, keyword } = params;
            const searchTerm = question || keyword;

            if (!searchTerm) {
                return "❌ 请描述你的问题。\n\n💡 示例：「关于 Docker 的帖子都说了什么？」";
            }

            ChatState.updateLastMessage("正在搜索相关内容...", "processing");

            try {
                const response = await NotionAPI.search(searchTerm, null, settings.notionApiKey);
                const results = (response.results || []).filter(r => !r.archived && r.object === "page").slice(0, 5);

                if (results.length === 0) {
                    return `📭 在工作区中没有找到与「${searchTerm}」相关的内容。`;
                }

                ChatState.updateLastMessage(`找到 ${results.length} 个相关内容，正在提取...`, "processing");

                // 提取每个页面的内容
                const contextParts = [];
                const sourceList = [];
                for (let i = 0; i < results.length; i++) {
                    const item = results[i];
                    const title = Utils.getPageTitle(item, item.object === "database" ? "未命名数据库" : "未命名页面");
                    const url = item.url || "";
                    sourceList.push({ title, url });

                    try {
                        const content = await AIAssistant._extractPageContent(item.id, settings.notionApiKey, 2000);
                        contextParts.push(`[${i + 1}] ${title}:\n${content || "（无文本内容）"}`);
                    } catch {
                        contextParts.push(`[${i + 1}] ${title}:\n（无法读取内容）`);
                    }
                }

                ChatState.updateLastMessage("正在分析并生成回答...", "processing");

                const ragPrompt = `你是一个知识问答助手。根据以下来自 Notion 工作区的内容回答用户的问题。
如果内容中没有相关信息，请如实说明。回答后列出信息来源。

--- 参考内容 ---
${contextParts.join("\n\n")}

--- 用户问题 ---
${searchTerm}`;

                const aiAnswer = await AIService.requestChat(ragPrompt, settings, 2000);

                // 拼接来源列表
                let sourceText = "\n\n📚 **信息来源**：\n";
                sourceList.forEach((s, i) => {
                    sourceText += `${i + 1}. ${s.title}${s.url ? ` ([链接](${s.url}))` : ""}\n`;
                });

                return aiAnswer + sourceText;
            } catch (error) {
                return `❌ 问答失败: ${error.message}`;
            }
        },

        // ======= 深度研究模式 =======

        handleDeepResearch: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            const { research_topic, scope = "workspace" } = params;
            if (!research_topic) {
                return "❌ 请描述你的研究主题。\n\n💡 示例：「深入研究一下关于 Docker 的所有内容」";
            }

            try {
                // Phase 1: 拆分主题为多个搜索关键词
                ChatState.updateLastMessage("🔬 正在拆解研究主题...", "processing");

                const keywordsPrompt = `将以下研究主题拆分为3-5个搜索关键词，每行一个关键词，只返回关键词：\n${research_topic}`;
                const keywordsRaw = await AIService.requestChat(keywordsPrompt, settings, 200);
                const keywords = keywordsRaw.split("\n")
                    .map(k => k.trim().replace(/^[-•\d.]+\s*/, ""))
                    .filter(Boolean)
                    .slice(0, 5);

                if (keywords.length === 0) keywords.push(research_topic);

                // Phase 2: 多关键词搜索
                ChatState.updateLastMessage(`🔍 搜索中... (${keywords.length} 个关键词: ${keywords.join(", ")})`, "processing");

                const allResults = [];
                const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

                for (let i = 0; i < keywords.length; i++) {
                    const response = await NotionAPI.search(keywords[i], null, settings.notionApiKey);
                    const pages = (response.results || []).filter(r => !r.archived && r.object === "page");
                    allResults.push(...pages);
                    if (i < keywords.length - 1) await Utils.sleep(delay);
                }

                // 去重（按 ID）
                const uniquePages = [...new Map(allResults.map(r => [r.id, r])).values()];

                if (uniquePages.length === 0) {
                    return `📭 在工作区中没有找到与「${research_topic}」相关的内容。\n\n尝试用更宽泛的关键词，或确保工作区中有相关页面。`;
                }

                // Phase 3: 提取内容（最多10个页面）
                const maxPages = Math.min(10, uniquePages.length);
                ChatState.updateLastMessage(`📄 提取 ${maxPages}/${uniquePages.length} 个页面内容...`, "processing");

                const contentParts = [];
                const sourceList = [];
                for (let i = 0; i < maxPages; i++) {
                    const page = uniquePages[i];
                    const title = Utils.getPageTitle(page);
                    const url = page.url || "";
                    sourceList.push({ title, url });

                    try {
                        const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 3000);
                        contentParts.push(`[${i + 1}] ${title}:\n${content || "（无文本内容）"}`);
                    } catch {
                        contentParts.push(`[${i + 1}] ${title}:\n（无法读取内容）`);
                    }
                    if (i < maxPages - 1) await Utils.sleep(delay);
                }

                // Phase 4: AI 生成结构化报告
                ChatState.updateLastMessage("📊 正在生成研究报告...", "processing");

                const reportPrompt = `你是一个研究分析师。根据以下来自 Notion 工作区的内容，针对主题「${research_topic}」生成一份结构化研究报告。

报告格式要求（使用 Markdown）:
# 研究报告: ${research_topic}
## 摘要
（2-3句话概括核心发现）
## 主要发现
（3-5个要点，每个要点一句话）
## 详细分析
（按主题分段论述，引用具体来源编号如[1][2]）
## 建议与行动项
（可执行的建议，每条一句话）
## 信息来源
（列出引用的页面）

--- 参考内容 ---
${contentParts.join("\n\n---\n\n")}`;

                const report = await AIService.requestChat(reportPrompt, settings, 4000);

                // 拼接来源列表
                let sourceText = "\n\n📚 **分析基础**：\n";
                sourceList.forEach((s, i) => {
                    sourceText += `${i + 1}. ${s.title}${s.url ? ` ([链接](${s.url}))` : ""}\n`;
                });

                const summary = `🔬 共使用 ${keywords.length} 个关键词，找到 ${uniquePages.length} 个相关页面，深入分析了 ${maxPages} 个。`;

                return `${report}${sourceText}\n---\n${summary}`;
            } catch (error) {
                return `❌ 深度研究失败: ${error.message}`;
            }
        },

        // ======= 内容总结 =======

        handleSummarize: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            const { page_name, page_id, summary_style } = params;
            const style = summary_style || "brief";

            if (!page_name && !page_id) {
                return "❌ 请指定要总结的页面。\n\n💡 示例：「总结一下 xxx 页面的内容」";
            }

            ChatState.updateLastMessage("正在解析目标页面...", "processing");

            try {
                const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
                if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

                ChatState.updateLastMessage("正在读取页面内容...", "processing");

                const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey, 6000);
                if (!existingContent.trim()) {
                    return `❌ 页面「${targetPage.name}」没有可总结的内容。`;
                }

                ChatState.updateLastMessage("📝 正在生成摘要...", "processing");

                const styleInstructions = {
                    brief: "生成简短摘要（2-3句话），提炼核心要点。",
                    detailed: "生成详细摘要，包含：核心主题、主要论点、关键细节和结论。",
                    bullet: "以要点列表形式总结，每个要点一行，提炼关键信息。"
                };

                const prompt = `你是一个内容摘要助手。${styleInstructions[style] || styleInstructions.brief}\n\n使用 Markdown 格式输出。\n\n以下是需要总结的内容：\n${existingContent}`;
                const aiResponse = await AIService.requestChat(prompt, settings, 2000);

                return `📝 **页面摘要：${targetPage.name}**\n\n${aiResponse}\n\n---\n📄 摘要风格: ${style === "brief" ? "简短" : style === "detailed" ? "详细" : "要点列表"}`;
            } catch (error) {
                return `❌ 内容总结失败: ${error.message}`;
            }
        },

        // ======= 头脑风暴 =======

        handleBrainstorm: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            const { brainstorm_topic, page_name, page_id } = params;
            const count = Math.min(Math.max(parseInt(params.brainstorm_count) || 10, 3), 30);
            const topic = brainstorm_topic || page_name || explanation;

            if (!topic) {
                return "❌ 请指定头脑风暴主题。\n\n💡 示例：「围绕远程办公给我一些创意建议」";
            }

            // 如果指定了页面，读取页面内容作为上下文
            let pageContext = "";
            if (page_name || page_id) {
                ChatState.updateLastMessage("正在读取页面内容作为参考...", "processing");
                const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (targetPage) {
                    pageContext = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey, 3000);
                }
            }

            ChatState.updateLastMessage("💡 正在头脑风暴...", "processing");

            try {
                const contextBlock = pageContext ? `\n\n以下是相关参考内容：\n${pageContext}` : "";
                const prompt = `你是一个创意顾问。围绕主题「${topic}」进行头脑风暴，生成 ${count} 个创意想法或建议。

要求：
- 想法要多样化，涵盖不同角度和维度
- 每个想法包含简短标题和一句话说明
- 从实用到大胆创新，由近及远排列
- 使用 Markdown 编号列表格式输出${contextBlock}`;

                const aiResponse = await AIService.requestChat(prompt, settings, 2000);

                return `💡 **头脑风暴：${topic}**\n\n${aiResponse}\n\n---\n🎯 共生成 ${count} 个创意想法`;
            } catch (error) {
                return `❌ 头脑风暴失败: ${error.message}`;
            }
        },

        // ======= 校对纠错 =======

        handleProofread: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            const { page_name, page_id } = params;

            if (!page_name && !page_id) {
                return "❌ 请指定要校对的页面。\n\n💡 示例：「校对一下 xxx 页面的拼写和语法」";
            }

            ChatState.updateLastMessage("正在解析目标页面...", "processing");

            try {
                const targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
                if (!targetPage) return `❌ 找不到页面「${page_name || page_id}」。`;

                ChatState.updateLastMessage("正在读取页面内容...", "processing");

                const existingContent = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey);
                if (!existingContent.trim()) {
                    return `❌ 页面「${targetPage.name}」没有可校对的内容。`;
                }

                ChatState.updateLastMessage("✅ 正在校对中...", "processing");

                const prompt = `你是一个专业校对编辑。请仔细检查以下内容的拼写、语法和表达问题。

输出格式：
1. 先列出发现的所有问题（每个问题标注位置和类型：拼写/语法/标点/表达）
2. 然后给出修正后的完整内容

如果没有发现任何问题，请说明内容无误。

使用 Markdown 格式输出。

以下是需要校对的内容：
${existingContent}`;

                const aiResponse = await AIService.requestChat(prompt, settings, 3000);

                return `✅ **校对结果：${targetPage.name}**\n\n${aiResponse}`;
            } catch (error) {
                return `❌ 校对失败: ${error.message}`;
            }
        },

        // ======= 批量翻译数据库 =======

        handleBatchTranslate: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("appendBlocks")) {
                return "❌ 权限不足：批量翻译需要「标准」权限级别。";
            }

            const { database_name, database_id, target_language } = params;
            const lang = target_language || "英文";

            if (!database_name && !database_id) {
                return "❌ 请指定要翻译的数据库。\n\n💡 示例：「把 xxx 数据库翻译成日文」";
            }

            ChatState.updateLastMessage("正在查找数据库...", "processing");

            try {
                // 查找数据库
                let dbId = database_id;
                if (!dbId && database_name) {
                    const searchResp = await NotionAPI.search(database_name, "database", settings.notionApiKey);
                    const db = (searchResp.results || []).find(r => !r.archived);
                    if (!db) return `❌ 找不到数据库「${database_name}」。`;
                    dbId = db.id;
                }

                // 查询数据库中的页面
                ChatState.updateLastMessage("正在获取页面列表...", "processing");
                const queryResp = await NotionAPI.queryDatabase(dbId, null, null, 20, settings.notionApiKey);
                const pages = (queryResp.results || []).filter(p => !p.archived);

                if (pages.length === 0) {
                    return `❌ 数据库中没有可翻译的页面。`;
                }

                // 确认操作
                const confirmed = await ConfirmationDialog.show({
                    title: `🌐 批量翻译确认`,
                    message: `即将翻译 ${pages.length} 个页面为${lang}。\n翻译后的内容将追加到每个页面末尾（原内容保留）。`,
                    confirmText: "开始翻译",
                    cancelText: "取消"
                });
                if (!confirmed) return "❌ 已取消批量翻译。";

                let successCount = 0;
                let failCount = 0;

                for (let i = 0; i < pages.length; i++) {
                    const page = pages[i];
                    const title = Utils.getPageTitle(page);
                    ChatState.updateLastMessage(`🌐 翻译中 (${i + 1}/${pages.length}): ${title}...`, "processing");

                    try {
                        const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 4000);
                        if (!content.trim()) { failCount++; continue; }

                        const prompt = `你是一个专业翻译。将以下内容翻译为${lang}，使用 Markdown 格式，保持原文结构。\n\n原文：\n${content}`;
                        const translated = await AIService.requestChat(prompt, settings, 2000);

                        const blocks = [
                            { type: "divider", divider: {} },
                            { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `🌐 ${lang}翻译` } }] } },
                            ...AIAssistant._textToBlocks(translated)
                        ];
                        await NotionAPI.appendBlocks(page.id, blocks, settings.notionApiKey);
                        successCount++;
                    } catch {
                        failCount++;
                    }
                }

                return `🌐 **批量翻译完成**\n\n- 目标语言: ${lang}\n- 成功: ${successCount} 页\n- 失败: ${failCount} 页\n- 总计: ${pages.length} 页\n\n💡 翻译内容已追加到每个页面末尾。`;
            } catch (error) {
                return `❌ 批量翻译失败: ${error.message}`;
            }
        },

        // ======= 内容提取为数据库 =======

        handleExtractToDatabase: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("createDatabase")) {
                return "❌ 权限不足：创建数据库需要「高级」权限级别。";
            }

            const { page_name, page_id, database_name, extraction_prompt } = params;

            if (!page_name && !page_id) {
                return "❌ 请指定源页面。\n\n💡 示例：「把 xxx 页面的笔记提取为任务数据库」";
            }

            ChatState.updateLastMessage("正在读取源页面...", "processing");

            try {
                const sourcePage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (sourcePage?.error) return `❌ 页面解析失败：${sourcePage.error}`;
                if (!sourcePage) return `❌ 找不到页面「${page_name || page_id}」。`;

                const content = await AIAssistant._extractPageContent(sourcePage.id, settings.notionApiKey, 6000);
                if (!content.trim()) {
                    return `❌ 页面「${sourcePage.name}」没有可提取的内容。`;
                }

                // AI 分析内容并生成结构化数据
                ChatState.updateLastMessage("🔍 正在分析内容结构...", "processing");

                const dbName = database_name || `${sourcePage.name} - 提取数据`;
                const extractHint = extraction_prompt || explanation || "提取所有结构化条目";

                const analyzePrompt = `你是一个数据提取专家。分析以下页面内容，提取结构化信息。

提取要求：${extractHint}

请返回 JSON 格式（只返回 JSON）：
{
  "properties": [
    { "name": "属性名", "type": "title|rich_text|select|number|checkbox", "description": "属性说明" }
  ],
  "entries": [
    { "属性名1": "值1", "属性名2": "值2" }
  ]
}

属性类型说明：
- 第一个属性必须是 title 类型
- 分类/状态 → select，数量/金额 → number，是否 → checkbox，其他 → rich_text

页面内容：
${content}`;

                const aiResponse = await AIService.requestChat(analyzePrompt, settings, 3000);

                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    return `❌ AI 无法从页面内容中提取结构化数据。请尝试更具体地描述提取要求。`;
                }

                let extractedData;
                try {
                    extractedData = JSON.parse(jsonMatch[0]);
                } catch {
                    return `❌ AI 提取的数据格式无效。请换一种方式描述提取要求。`;
                }

                if (!extractedData.properties || !extractedData.entries || extractedData.entries.length === 0) {
                    return `❌ 未能从页面中提取到有效条目。`;
                }

                // 确认操作
                const confirmed = await ConfirmationDialog.show({
                    title: "📊 创建数据库确认",
                    message: `将从「${sourcePage.name}」提取 ${extractedData.entries.length} 个条目。\n数据库名称: ${dbName}\n属性: ${extractedData.properties.map(p => p.name).join(", ")}`,
                    confirmText: "创建",
                    cancelText: "取消"
                });
                if (!confirmed) return "❌ 已取消。";

                // 创建数据库
                ChatState.updateLastMessage("📊 正在创建数据库...", "processing");

                const dbProperties = {};
                for (const prop of extractedData.properties) {
                    if (prop.type === "title") {
                        dbProperties[prop.name] = { title: {} };
                    } else if (prop.type === "select") {
                        dbProperties[prop.name] = { select: {} };
                    } else if (prop.type === "number") {
                        dbProperties[prop.name] = { number: {} };
                    } else if (prop.type === "checkbox") {
                        dbProperties[prop.name] = { checkbox: {} };
                    } else {
                        dbProperties[prop.name] = { rich_text: {} };
                    }
                }

                const newDb = await NotionAPI.createDatabase(sourcePage.id, dbName, dbProperties, settings.notionApiKey);

                // 填充条目
                ChatState.updateLastMessage(`📝 正在填充 ${extractedData.entries.length} 个条目...`, "processing");

                let addedCount = 0;
                const titleProp = extractedData.properties.find(p => p.type === "title");
                const titleKey = titleProp ? titleProp.name : extractedData.properties[0].name;

                for (const entry of extractedData.entries) {
                    try {
                        const pageProperties = {};
                        for (const prop of extractedData.properties) {
                            const val = entry[prop.name];
                            if (val === undefined || val === null) continue;

                            if (prop.type === "title") {
                                pageProperties[prop.name] = { title: [{ text: { content: String(val) } }] };
                            } else if (prop.type === "select") {
                                pageProperties[prop.name] = { select: { name: String(val) } };
                            } else if (prop.type === "number") {
                                pageProperties[prop.name] = { number: Number(val) || 0 };
                            } else if (prop.type === "checkbox") {
                                pageProperties[prop.name] = { checkbox: Boolean(val) };
                            } else {
                                pageProperties[prop.name] = { rich_text: [{ text: { content: String(val).slice(0, 2000) } }] };
                            }
                        }

                        await NotionAPI.createPage(newDb.id, pageProperties, settings.notionApiKey);
                        addedCount++;
                    } catch { /* skip failed entries */ }
                }

                return `📊 **数据库创建完成**\n\n- 数据库: ${dbName}\n- 来源: ${sourcePage.name}\n- 属性: ${extractedData.properties.map(p => p.name).join(", ")}\n- 条目: ${addedCount}/${extractedData.entries.length}\n\n💡 数据库已创建在源页面下方。`;
            } catch (error) {
                return `❌ 提取失败: ${error.message}`;
            }
        },

        // ======= 多页面结构化生成 =======

        handleGeneratePages: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("createDatabase")) {
                return "❌ 权限不足：多页面生成需要「高级」权限级别。";
            }

            const { page_name, page_id, parent_page_name, parent_page_id, structure_prompt } = params;
            const topic = page_name || structure_prompt || explanation;

            if (!topic) {
                return "❌ 请描述要生成的内容主题。\n\n💡 示例：「为新员工创建入职指南，包含工具清单、团队介绍、常见问题」";
            }

            ChatState.updateLastMessage("📑 正在规划页面结构...", "processing");

            try {
                // AI 规划页面结构
                const planPrompt = `你是一个 Notion 内容架构师。根据用户需求规划多页面内容结构。

用户需求：${topic}
${structure_prompt ? `补充要求：${structure_prompt}` : ""}

返回 JSON 格式（只返回 JSON）：
{
  "parent_title": "父页面标题",
  "parent_summary": "父页面简介（1-2句话）",
  "children": [
    {
      "title": "子页面标题",
      "description": "子页面内容描述（用于生成正文）",
      "icon": "emoji图标"
    }
  ]
}

要求：
- 子页面数量控制在 3-8 个
- 每个子页面应有明确的主题和边界
- 父页面作为目录/概览页`;

                const planResponse = await AIService.requestChat(planPrompt, settings, 1500);

                const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    return `❌ AI 无法规划页面结构。请更具体地描述需求。`;
                }

                let plan;
                try {
                    plan = JSON.parse(jsonMatch[0]);
                } catch {
                    return `❌ AI 生成的结构无效。请换一种方式描述。`;
                }

                if (!plan.children || plan.children.length === 0) {
                    return `❌ AI 未能规划出有效的子页面结构。`;
                }

                // 确认
                const pageList = plan.children.map(c => `${c.icon || "📄"} ${c.title}`).join("\n");
                const confirmed = await ConfirmationDialog.show({
                    title: "📑 多页面生成确认",
                    message: `将创建以下页面结构：\n\n📁 ${plan.parent_title}\n${pageList}\n\n共 ${plan.children.length + 1} 个页面。`,
                    confirmText: "开始生成",
                    cancelText: "取消"
                });
                if (!confirmed) return "❌ 已取消。";

                // 确定父页面位置
                let parentPageId = parent_page_id;
                if (!parentPageId && parent_page_name) {
                    const parentPage = await AIAssistant._resolvePageId(parent_page_name, null, settings.notionApiKey);
                    if (parentPage) parentPageId = parentPage.id;
                }

                // 创建父页面
                ChatState.updateLastMessage(`📁 正在创建父页面: ${plan.parent_title}...`, "processing");

                const parentProps = {
                    title: { title: [{ text: { content: plan.parent_title } }] }
                };

                let parentPage;
                if (parentPageId) {
                    parentPage = await NotionAPI.createPageInPage(parentPageId, parentProps, settings.notionApiKey);
                } else {
                    // Notion API 不支持在工作区根目录创建页面，必须指定父页面
                    return `❌ 请指定父页面。Notion API 要求页面必须创建在某个父页面下。\n\n💡 示例：「在 xxx 页面下创建入职指南」`;
                }

                // 写入父页面概览
                const overviewBlocks = AIAssistant._textToBlocks(`${plan.parent_summary || ""}\n\n## 📋 目录\n\n${plan.children.map((c, i) => `${i + 1}. ${c.icon || "📄"} **${c.title}** - ${c.description}`).join("\n")}`);
                await NotionAPI.appendBlocks(parentPage.id, overviewBlocks, settings.notionApiKey);

                // 创建子页面并生成内容
                let createdCount = 0;
                for (let i = 0; i < plan.children.length; i++) {
                    const child = plan.children[i];
                    ChatState.updateLastMessage(`📝 生成子页面 (${i + 1}/${plan.children.length}): ${child.title}...`, "processing");

                    try {
                        // 创建子页面
                        const childProps = {
                            title: { title: [{ text: { content: `${child.icon || ""} ${child.title}`.trim() } }] }
                        };
                        const childPage = await NotionAPI.createPageInPage(parentPage.id, childProps, settings.notionApiKey);

                        // 生成子页面内容
                        const contentPrompt = `为以下主题生成详细内容，使用 Markdown 格式。

主题：${child.title}
描述：${child.description}
上下文：这是「${plan.parent_title}」的子页面

请生成实用、具体的内容，包含合适的标题层级和结构化信息。`;

                        const content = await AIService.requestChat(contentPrompt, settings, 2000);
                        const contentBlocks = AIAssistant._textToBlocks(content);
                        await NotionAPI.appendBlocks(childPage.id, contentBlocks, settings.notionApiKey);
                        createdCount++;
                    } catch { /* skip failed pages */ }
                }

                return `📑 **多页面内容生成完成**\n\n- 父页面: ${plan.parent_title}\n- 子页面: ${createdCount}/${plan.children.length} 创建成功\n\n💡 所有页面已创建并填充内容。`;
            } catch (error) {
                return `❌ 页面生成失败: ${error.message}`;
            }
        },

        // ======= 批量页面分析 =======

        handleBatchAnalyze: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            const { database_name, database_id, analysis_prompt } = params;
            const limit = Math.min(Math.max(parseInt(params.limit) || 10, 1), 20);

            if (!database_name && !database_id) {
                // 使用默认配置的数据库
                if (!settings.notionDatabaseId) {
                    return "❌ 请指定要分析的数据库，或先配置默认数据库 ID。\n\n💡 示例：「分析 xxx 数据库的所有页面」";
                }
            }

            ChatState.updateLastMessage("正在查找数据库...", "processing");

            try {
                let dbId = database_id || settings.notionDatabaseId;
                if (!dbId && database_name) {
                    const searchResp = await NotionAPI.search(database_name, "database", settings.notionApiKey);
                    const db = (searchResp.results || []).find(r => !r.archived);
                    if (!db) return `❌ 找不到数据库「${database_name}」。`;
                    dbId = db.id;
                }

                // 查询页面
                ChatState.updateLastMessage("正在获取页面...", "processing");
                const queryResp = await NotionAPI.queryDatabase(dbId, null, null, limit, settings.notionApiKey);
                const pages = (queryResp.results || []).filter(p => !p.archived);

                if (pages.length === 0) {
                    return `❌ 数据库中没有可分析的页面。`;
                }

                // 提取内容
                ChatState.updateLastMessage(`🔎 正在提取 ${pages.length} 个页面内容...`, "processing");

                const contentParts = [];
                for (let i = 0; i < pages.length; i++) {
                    const page = pages[i];
                    const title = Utils.getPageTitle(page);
                    ChatState.updateLastMessage(`🔎 提取中 (${i + 1}/${pages.length}): ${title}...`, "processing");

                    const content = await AIAssistant._extractPageContent(page.id, settings.notionApiKey, 2000);
                    contentParts.push(`## ${title}\n${content || "（无内容）"}`);
                }

                // AI 生成综合分析
                ChatState.updateLastMessage("📊 正在生成综合分析...", "processing");

                const analysisGoal = analysis_prompt || explanation || "综合分析所有页面内容，找出关键主题、趋势和建议";

                const prompt = `你是一个数据分析师。根据以下来自数据库的多个页面内容进行综合分析。

分析要求：${analysisGoal}

请使用 Markdown 格式输出分析报告，包含：
1. 概述（总体情况摘要）
2. 关键发现（主要主题和模式）
3. 详细分析（按主题/类别分组）
4. 趋势与洞察
5. 建议与行动项

--- 以下是 ${pages.length} 个页面的内容 ---

${contentParts.join("\n\n---\n\n")}`;

                const report = await AIService.requestChat(prompt, settings, 4000);

                return `📊 **批量分析报告**\n\n${report}\n\n---\n🔎 共分析 ${pages.length} 个页面`;
            } catch (error) {
                return `❌ 批量分析失败: ${error.message}`;
            }
        },

        // ======= GitHub 收藏导入 =======

        handleGitHubImport: async (params, settings, explanation) => {
            const username = params.username || Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
            const token = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
            const databaseId = settings.notionDatabaseId;

            if (!username) {
                return "❌ 请先在设置中配置 GitHub 用户名。\n\n💡 在 Notion 面板的设置中找到「GitHub 收藏导入」部分填写用户名。";
            }
            if (!settings.notionApiKey) {
                return "❌ 请先配置 Notion API Key。";
            }
            if (!databaseId) {
                return "❌ 请先配置 GitHub 收藏的目标数据库 ID。\n\n💡 可以在设置中专门指定，或使用默认数据库。";
            }

            const classify = params.classify || false;
            const importTypes = GitHubAPI.getImportTypes();

            try {
                const allResults = await GitHubExporter.exportAll({
                    apiKey: settings.notionApiKey,
                    databaseId,
                    username,
                    token,
                    aiApiKey: settings.aiApiKey,
                    aiService: settings.aiService,
                    aiModel: settings.aiModel,
                    aiBaseUrl: settings.aiBaseUrl,
                    categories: settings.categories,
                }, (msg, pct) => {
                    ChatState.updateLastMessage(`🐙 ${msg}`, "processing");
                });

                let response = `✅ **GitHub 导入完成**\n\n`;
                let totalExported = 0;
                let totalFailed = 0;

                const typeNames = { stars: "Stars", repos: "Repos", forks: "Forks", gists: "Gists" };
                for (const type of importTypes) {
                    const r = allResults[type];
                    if (!r) continue;
                    if (r.error) {
                        response += `❌ ${typeNames[type]}: ${r.error}\n`;
                    } else {
                        response += `📊 ${typeNames[type]}: 共 ${r.total} 个，导出 ${r.exported} 个`;
                        if (r.failed > 0) response += `，失败 ${r.failed} 个`;
                        response += `\n`;
                        totalExported += r.exported || 0;
                        totalFailed += r.failed || 0;
                    }
                }

                if (totalExported === 0 && totalFailed === 0) {
                    response += `\n所有内容已是最新状态。`;
                }

                // 如果需要分类
                if (classify && totalExported > 0 && settings.aiApiKey) {
                    ChatState.updateLastMessage("🏷️ 正在进行 AI 分类...", "processing");
                    try {
                        const classifyResult = await GitHubExporter.classifyRepos({
                            ...settings,
                            databaseId,
                        }, (msg, pct) => {
                            ChatState.updateLastMessage(`🏷️ ${msg}`, "processing");
                        });
                        response += `\n\n🏷️ **AI 分类完成**: 已分类 ${classifyResult.classified}/${classifyResult.total} 个`;
                    } catch (e) {
                        response += `\n\n⚠️ AI 分类出错: ${e.message}`;
                    }
                } else if (classify && !settings.aiApiKey) {
                    response += `\n\n⚠️ 未配置 AI API Key，跳过自动分类。`;
                }

                return response;
            } catch (error) {
                return `❌ GitHub 导入失败: ${error.message}`;
            }
        },

        // ======= 浏览器书签导入 =======

        handleBookmarkImport: async (params, settings, explanation) => {
            const databaseId = settings.notionDatabaseId;

            if (!settings.notionApiKey) {
                return "❌ 请先配置 Notion API Key。";
            }
            if (!databaseId) {
                return "❌ 请先配置目标数据库 ID。";
            }
            if (!BookmarkBridge.isExtensionAvailable()) {
                const installUrl = InstallHelper.getBookmarkExtensionUrl();
                return `❌ 未检测到 LD-Notion 书签桥接扩展。\n\n💡 请点击安装：${installUrl}\n\n手动安装步骤：\n1. 打开 chrome://extensions/\n2. 开启「开发者模式」\n3. 点击「加载已解压的扩展」\n4. 选择项目中的 chrome-extension 文件夹\n5. 刷新当前页面\n\n🔎 诊断建议：\n- 若你当前使用的是 chrome-extension-full 独立版，请关闭 userscript，避免双模式混用\n- 若你坚持 userscript 模式，请仅安装 chrome-extension（桥接版）`;
            }

            try {
                ChatState.updateLastMessage("📖 正在读取浏览器书签...", "processing");
                const tree = await BookmarkBridge.getBookmarkTree();
                const allBookmarks = BookmarkExporter.flattenTree(tree);

                if (allBookmarks.length === 0) {
                    return "📭 没有找到浏览器书签。";
                }

                const dedupStrict = Utils.isBookmarkDedupStrict();
                const newCount = dedupStrict
                    ? allBookmarks.filter(b => !BookmarkExporter.isExported(b.url)).length
                    : allBookmarks.length;
                ChatState.updateLastMessage(`📖 找到 ${allBookmarks.length} 个书签 (${newCount} 个新书签)，正在导出...`, "processing");

                const result = await BookmarkExporter.exportBookmarks({
                    apiKey: settings.notionApiKey,
                    databaseId,
                    bookmarks: allBookmarks,
                    aiApiKey: settings.aiApiKey,
                    aiService: settings.aiService,
                    aiModel: settings.aiModel,
                    aiBaseUrl: settings.aiBaseUrl,
                }, (msg, pct) => {
                    ChatState.updateLastMessage(`📖 ${msg}`, "processing");
                });

                let response = `✅ **浏览器书签导入完成**\n\n`;
                response += `📊 共 ${result.total} 个书签\n`;
                response += `📥 本次导出 ${result.exported} 个\n`;
                if (result.failed > 0) response += `❌ 失败 ${result.failed} 个\n`;
                if (result.exported === 0 && result.failed === 0) response += `\n所有书签已是最新状态。`;

                // 如果有 AI 配置，询问是否分类
                if (result.exported > 0 && settings.aiApiKey) {
                    response += `\n\n💡 可以输入「分类书签」让 AI 自动为导入的书签分类。`;
                }

                return response;
            } catch (error) {
                return `❌ 书签导入失败: ${error.message}`;
            }
        },

        // ======= AI 输出模板 =======

        handleTemplateOutput: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("appendBlocks")) {
                return "❌ 权限不足：模板输出需要「标准」权限级别。";
            }

            const { template_name, page_name, page_id, custom_context } = params;

            // 加载模板列表
            let templates;
            try {
                templates = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.AI_TEMPLATES, CONFIG.DEFAULTS.aiTemplates));
            } catch {
                templates = JSON.parse(CONFIG.DEFAULTS.aiTemplates);
            }

            if (!template_name) {
                // 列出可用模板
                const list = templates.map(t => `${t.icon} **${t.name}**`).join("\n");
                return `📋 **可用的 AI 输出模板**\n\n${list}\n\n💡 使用方式：「用周报模板总结 xxx 页面」或「用摘要提纲模板整理 xxx」`;
            }

            // 查找匹配模板
            const template = templates.find(t =>
                t.name === template_name ||
                t.name.includes(template_name) ||
                template_name.includes(t.name)
            );

            if (!template) {
                const list = templates.map(t => `${t.icon} ${t.name}`).join(", ");
                return `❌ 找不到模板「${template_name}」。\n\n可用模板: ${list}`;
            }

            // 获取页面上下文（如指定了页面）
            let pageContext = "";
            let targetPage = null;
            if (page_name || page_id) {
                ChatState.updateLastMessage("正在读取页面内容...", "processing");
                targetPage = await AIAssistant._resolvePageId(page_name, page_id, settings.notionApiKey);
                if (targetPage?.error) return `❌ 页面解析失败：${targetPage.error}`;
                if (targetPage) {
                    pageContext = await AIAssistant._extractPageContent(targetPage.id, settings.notionApiKey, 4000);
                }
            }

            // 组合 prompt
            ChatState.updateLastMessage(`${template.icon} 正在使用「${template.name}」模板生成...`, "processing");

            const contextBlock = pageContext ? `\n\n以下是参考内容：\n${pageContext}` : "";
            const customBlock = custom_context ? `\n\n用户补充说明：${custom_context}` : "";
            const fullPrompt = `${template.prompt}${contextBlock}${customBlock}\n\n请使用 Markdown 格式输出。`;

            const aiResponse = await AIService.requestChat(fullPrompt, settings, 3000);

            // 如果有目标页面，写入 Notion
            if (targetPage) {
                ChatState.updateLastMessage("正在写入页面...", "processing");
                const contentBlocks = AIAssistant._textToBlocks(aiResponse);
                const blocks = [
                    { type: "divider", divider: {} },
                    { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: `${template.icon} ${template.name}` } }] } },
                    ...contentBlocks
                ];
                await NotionAPI.appendBlocks(targetPage.id, blocks, settings.notionApiKey);
                return `✅ **${template.icon} ${template.name}** 已生成并写入页面「${targetPage.name}」\n\n${aiResponse}`;
            }

            return `${template.icon} **${template.name}**\n\n${aiResponse}\n\n💡 如需写入页面，请指定目标页面：「用${template.name}模板处理 xxx 页面」`;
        },

        // ======= Agent 自主代理 =======

        handleAgentTask: async (params, settings, explanation) => {
            const configCheck = AIAssistant.checkConfig(settings, false);
            if (!configCheck.valid) return configCheck.error;

            if (!OperationGuard.canExecute("agentTask")) {
                return "❌ 权限不足：Agent 自主代理需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
            }

            const { task_description } = params;
            if (!task_description) {
                return "❌ 请描述你想让 Agent 完成的任务。\n\n💡 示例：「帮我整理所有未分类的帖子并生成摘要」";
            }

            ChatState.updateLastMessage("🤖 Agent 正在规划任务...", "processing");

            try {
                const planPrompt = `你是一个 Notion 任务规划器。将用户的高层任务分解为可执行步骤。
每一步必须是以下操作之一：query, search, workspace_search, classify, batch_classify,
update, move, copy, create_database, write_content, edit_content, translate_content,
ai_autofill, ask, deep_research, template_output, summarize, brainstorm, proofread,
batch_translate, extract_to_database, generate_pages, batch_analyze

返回 JSON（只返回 JSON，不要其他内容）：
{
  "plan": [
    { "intent": "操作名", "params": { 对应操作的参数 }, "explanation": "步骤说明" }
  ],
  "explanation": "整体计划说明"
}

用户任务：${task_description}`;

                const planResponse = await AIService.requestChat(planPrompt, settings, 1500);

                // 解析计划 JSON
                const jsonMatch = planResponse.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    return "❌ Agent 无法生成有效的执行计划。请尝试更具体地描述任务。";
                }

                let plan;
                try {
                    plan = JSON.parse(jsonMatch[0]);
                } catch {
                    return "❌ Agent 生成的计划格式无效。请尝试换一种方式描述任务。";
                }

                if (!plan.plan || plan.plan.length === 0) {
                    return "❌ Agent 未能分解出有效的执行步骤。请尝试更具体地描述任务。";
                }

                // 展示计划并等待确认
                let planMsg = `🤖 **Agent 执行计划**\n${plan.explanation || ""}\n\n`;
                plan.plan.forEach((step, i) => {
                    planMsg += `${i + 1}. ${step.explanation}\n`;
                });

                ChatState.updateLastMessage(planMsg + "\n⏳ 等待确认...", "processing");

                const confirmed = await ConfirmationDialog.show({
                    title: "🤖 Agent 执行计划确认",
                    message: plan.plan.map((s, i) => `${i + 1}. ${s.explanation}`).join("\n"),
                    itemName: task_description,
                    countdown: 5,
                    requireNameInput: false,
                });

                if (!confirmed) {
                    return "🤖 Agent 任务已取消。";
                }

                // 执行计划（复用 compound 的执行模式）
                const results = [];
                let aborted = false;

                for (let i = 0; i < plan.plan.length; i++) {
                    const step = plan.plan[i];

                    ChatState.updateLastMessage(
                        `${planMsg}\n⏳ 步骤 ${i + 1}/${plan.plan.length}: ${step.explanation}`,
                        "processing"
                    );

                    try {
                        const stepResult = await AIAssistant.executeIntent(step, settings);

                        if (typeof stepResult === "string" && stepResult.startsWith("❌")) {
                            results.push({ index: i + 1, explanation: step.explanation, success: false, result: stepResult });
                            aborted = true;
                            break;
                        }

                        results.push({ index: i + 1, explanation: step.explanation, success: true, result: stepResult });
                    } catch (error) {
                        results.push({ index: i + 1, explanation: step.explanation, success: false, result: `❌ ${error.message}` });
                        aborted = true;
                        break;
                    }
                }

                // 汇总报告
                let report = `🤖 **Agent 任务${aborted ? "中断" : "完成"}**\n\n`;
                for (const r of results) {
                    report += `${r.success ? "✅" : "❌"} 步骤 ${r.index}: ${r.explanation}\n`;
                }

                if (aborted) {
                    const skipped = plan.plan.slice(results.length);
                    if (skipped.length > 0) {
                        report += `\n⏭️ 已跳过：\n`;
                        skipped.forEach((step, i) => {
                            report += `${results.length + i + 1}. ${step.explanation}\n`;
                        });
                    }
                }

                report += `\n---\n`;
                for (const r of results) {
                    report += `\n**步骤 ${r.index}**: ${r.explanation}\n${r.result}\n`;
                }

                return report;
            } catch (error) {
                return `❌ Agent 任务失败: ${error.message}`;
            }
        },

        // ======= Agent Loop (ReAct 模式) =======

        // 尝试解析 AI 回复为工具调用 JSON
        _tryParseToolCall: (response) => {
            if (!response) return null;
            const trimmed = response.trim();
            // 尝试直接解析整个响应为 JSON
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed.tool && typeof parsed.tool === "string") {
                    return parsed;
                }
            } catch {}
            // 尝试提取嵌入的 JSON
            const jsonMatch = trimmed.match(/\{[\s\S]*"tool"\s*:\s*"[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.tool && typeof parsed.tool === "string") {
                        return parsed;
                    }
                } catch {}
            }
            return null;
        },

        // 核心 Agent 循环
        runAgentLoop: async (userMessage, settings, maxIterations = 8) => {
            const permLevel = OperationGuard.getLevel();

            // 1. 构建系统提示（含可用工具列表，根据权限过滤）
            const availableTools = Object.entries(AIAssistant.AGENT_TOOLS)
                .filter(([_, tool]) => tool.level <= permLevel)
                .map(([name, tool]) => `- ${name}: ${tool.description} | 参数: ${tool.params}`)
                .join("\n");

            const targetDb = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");
            let dbInfo;
            if (targetDb === "__all__") {
                let cached;
                try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch { cached = {}; }
                const dbCount = cached.databases?.length || 0;
                dbInfo = `查询模式: 所有工作区数据库 (${dbCount} 个)`;
            } else if (targetDb) {
                let cached;
                try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch { cached = {}; }
                const dbName = cached.databases?.find(d => d.id === targetDb)?.title || targetDb;
                dbInfo = `已配置的数据库: ${dbName} (ID: ${targetDb})`;
            } else {
                dbInfo = settings.notionDatabaseId ? `已配置的数据库 ID: ${settings.notionDatabaseId}` : "未配置数据库 ID";
            }

            // 读取 Agent 个性化配置
            const persona = {
                name: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName),
                tone: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone),
                expertise: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise),
                instructions: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions),
            };

            const personaBlock = persona.instructions
                ? `\n个性化指令：${persona.instructions}`
                : "";

            const systemPrompt = `你是${persona.name}，一个专注于${persona.expertise}的助手。语气风格：${persona.tone}。${personaBlock}
你可以使用以下工具来完成用户的任务。

当前环境：${dbInfo}
当前权限级别：${CONFIG.PERMISSION_NAMES[permLevel] || permLevel}

可用工具：
${availableTools}

使用规则：
1. 每次回复只能做一件事：调用一个工具 OR 给用户最终回复
2. 调用工具时，只返回 JSON（不要包含其他文字）：
   {"tool": "工具名", "args": {参数对象}, "thought": "你的思考过程"}
3. 给用户最终回复时，直接返回文本（不要 JSON 格式）
4. 根据工具返回的结果决定下一步行动
5. 如果任务需要多步，逐步执行，每次一个工具调用
6. 执行写入/修改操作前，先用读取工具确认目标存在
7. 参数值必须是具体的值，不要用占位符`;

            // 2. Agent 循环
            const messages = [{ role: "user", content: userMessage }];
            let iteration = 0;

            while (iteration < maxIterations) {
                iteration++;
                ChatState.updateLastMessage(
                    `🤖 Agent 思考中... (${iteration}/${maxIterations})`,
                    "processing"
                );

                // 调用 AI
                let response;
                try {
                    response = await AIService.requestAgentChat(
                        systemPrompt, messages, settings, 1500
                    );
                } catch (error) {
                    return `❌ AI 调用失败: ${error.message}`;
                }

                // 尝试解析为工具调用
                const toolCall = AIAssistant._tryParseToolCall(response);

                if (!toolCall) {
                    // 不是工具调用 → 最终回复
                    return response;
                }

                // 记录 AI 的工具调用
                messages.push({ role: "assistant", content: response });

                // 执行工具
                const thoughtText = toolCall.thought ? `\n💭 ${toolCall.thought}` : "";
                ChatState.updateLastMessage(
                    `🤖 正在执行: ${toolCall.tool}...${thoughtText}`,
                    "processing"
                );

                const tool = AIAssistant.AGENT_TOOLS[toolCall.tool];
                let result;
                if (!tool) {
                    result = `错误: 未知工具 "${toolCall.tool}"。可用工具: ${Object.keys(AIAssistant.AGENT_TOOLS).filter(name => AIAssistant.AGENT_TOOLS[name].level <= permLevel).join(", ")}`;
                } else if (tool.level > permLevel) {
                    result = `错误: 权限不足，"${toolCall.tool}" 需要「${CONFIG.PERMISSION_NAMES[tool.level]}」权限，当前为「${CONFIG.PERMISSION_NAMES[permLevel]}」`;
                } else {
                    try {
                        result = await tool.execute(toolCall.args || {}, settings);
                    } catch (e) {
                        result = `错误: ${e.message}`;
                    }
                }

                // 将工具结果喂回 AI
                messages.push({ role: "user", content: `[工具结果] ${toolCall.tool}:\n${result}` });
            }

            return "🤖 Agent 达到最大执行步数，已停止。如果任务尚未完成，请继续描述你的需求。";
        },
    };
    // ===========================================
    const ChatUI = {
        // HTML 转义函数，防止 XSS 攻击
        escapeHtml: (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        // 安全的 Markdown 渲染（先转义再处理 Markdown）
        safeMarkdown: (text) => {
            // 先转义 HTML 特殊字符
            let escaped = Utils.escapeHtml(text);
            // 再处理安全的 Markdown 格式
            return escaped
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
        },

        // 渲染消息列表
        renderMessages: () => {
            const container = document.querySelector("#ldb-chat-messages");
            if (!container) return;

            if (ChatState.messages.length === 0) {
                const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
                container.innerHTML = `
                    <div class="ldb-chat-welcome">
                        <div class="ldb-chat-welcome-icon">🤖</div>
                        <div class="ldb-chat-welcome-text">
                            你好！我是 ${Utils.escapeHtml(personaName)}<br>
                            <small>试试下面的快捷命令</small>
                        </div>
                        <div class="ldb-chat-chips">
                            <button class="ldb-chat-chip" data-cmd="帮助">💡 帮助</button>
                            <button class="ldb-chat-chip" data-cmd="搜索">🔍 搜索</button>
                            <button class="ldb-chat-chip" data-cmd="自动分类">📂 自动分类</button>
                            <button class="ldb-chat-chip" data-cmd="总结">📝 总结</button>
                            <button class="ldb-chat-chip" data-cmd="导入GitHub收藏">🐙 GitHub</button>
                            <button class="ldb-chat-chip" data-cmd="导入浏览器书签">📖 书签</button>
                        </div>
                    </div>
                `;
                // 绑定 chip 点击
                container.querySelectorAll(".ldb-chat-chip").forEach(chip => {
                    chip.onclick = () => {
                        const input = document.querySelector("#ldb-chat-input");
                        if (input) {
                            input.value = chip.getAttribute("data-cmd");
                            ChatUI.sendMessage();
                        }
                    };
                });
                return;
            }

            container.innerHTML = ChatState.messages.map(msg => {
                const isUser = msg.role === "user";
                const statusClass = msg.status === "processing" ? "processing" : (msg.status === "error" ? "error" : "");

                // processing 状态使用预设动画，不经过 Markdown 渲染
                const content = msg.status === "processing"
                    ? '思考中<span class="ldb-typing-dots"><span></span><span></span><span></span></span>'
                    : ChatUI.safeMarkdown(msg.content);

                return `
                    <div class="ldb-chat-message ${isUser ? 'user' : 'assistant'}">
                        <div class="ldb-chat-bubble ${isUser ? 'user' : 'assistant'} ${statusClass}">
                            ${content}
                        </div>
                    </div>
                `;
            }).join('');

            // 滚动到底部
            container.scrollTop = container.scrollHeight;
        },

        // 发送消息
        sendMessage: async () => {
            const input = document.querySelector("#ldb-chat-input");
            const sendBtn = document.querySelector("#ldb-chat-send");
            if (!input) return;

            const message = input.value.trim();
            if (!message || ChatState.isProcessing) return;

            // 禁用输入区域
            if (input) input.disabled = true;
            if (sendBtn) sendBtn.disabled = true;

            // 清空输入框
            input.value = "";
            input.style.height = "auto";

            // 添加用户消息
            ChatState.addMessage("user", message);

            // 添加 AI 回复占位
            ChatState.isProcessing = true;
            ChatState.addMessage("assistant", "思考中...", "processing");

            try {
                const response = await AIAssistant.handleMessage(message);
                ChatState.updateLastMessage(response, "complete");
            } catch (error) {
                console.error("AI 处理失败:", error);
                ChatState.updateLastMessage(`❌ 处理失败: ${error.message}`, "error");
            } finally {
                ChatState.isProcessing = false;
                // 恢复输入区域
                if (input) input.disabled = false;
                if (sendBtn) sendBtn.disabled = false;
                if (input) input.focus();
            }
        },

        // 绑定事件
        bindEvents: () => {
            // 发送按钮
            const sendBtn = document.querySelector("#ldb-chat-send");
            if (sendBtn) {
                sendBtn.onclick = ChatUI.sendMessage;
            }

            // Enter 发送
            const input = document.querySelector("#ldb-chat-input");
            if (input) {
                input.onkeydown = (e) => {
                    // 阻止事件冒泡到 Notion
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        ChatUI.sendMessage();
                    }
                };

                // 阻止粘贴、复制、剪切等事件冒泡到 Notion
                input.onpaste = (e) => e.stopPropagation();
                input.oncopy = (e) => e.stopPropagation();
                input.oncut = (e) => e.stopPropagation();
                input.oninput = (e) => {
                    e.stopPropagation();
                    // textarea 自动增高
                    input.style.height = "auto";
                    input.style.height = Math.min(input.scrollHeight, 80) + "px";
                };
                input.onkeyup = (e) => e.stopPropagation();
                input.onkeypress = (e) => e.stopPropagation();
            }

            // 清空对话
            const clearBtn = document.querySelector("#ldb-chat-clear");
            if (clearBtn) {
                clearBtn.onclick = () => {
                    if (confirm("确定要清空对话历史吗？")) {
                        ChatState.clear();
                    }
                };
            }

            // 设置折叠
            const settingsToggle = document.querySelector("#ldb-chat-settings-toggle");
            if (settingsToggle) {
                settingsToggle.onclick = () => {
                    const content = document.querySelector("#ldb-chat-settings-content");
                    const arrow = document.querySelector("#ldb-chat-settings-arrow");
                    if (content && arrow) {
                        content.classList.toggle("collapsed");
                        arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
                    }
                };
            }
        },

        // 初始化
        init: () => {
            ChatState.load();
            ChatUI.renderMessages();
            ChatUI.bindEvents();
        },
    };

    // ===========================================
    // AI 批量分类模块
    // ===========================================
    const AIClassifier = {
        isPaused: false,
        isCancelled: false,

        // 批量分类
        classifyBatch: async (settings, onProgress) => {
            AIClassifier.reset();

            // 0. 确保数据库有 "AI分类" 属性
            await AIClassifier.ensureAICategoryProperty(settings);

            // 1. 查询数据库获取所有页面
            const pages = await AIClassifier.fetchAllPages(settings);

            if (pages.length === 0) {
                throw new Error("数据库中没有找到任何页面");
            }

            // 2. 过滤未分类的页面
            const unclassified = pages.filter(p => {
                const aiCategory = p.properties["AI分类"];
                return !aiCategory?.select?.name;
            });

            if (unclassified.length === 0) {
                return { total: pages.length, classified: 0, message: "所有页面都已分类" };
            }

            const results = { success: [], failed: [] };
            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

            // 3. 批量分类
            for (let i = 0; i < unclassified.length; i++) {
                if (AIClassifier.isCancelled) break;

                while (AIClassifier.isPaused) {
                    await Utils.sleep(500);
                    if (AIClassifier.isCancelled) break;
                }
                if (AIClassifier.isCancelled) break;

                const page = unclassified[i];
                const title = AIClassifier.getPageTitle(page);

                onProgress?.({
                    current: i + 1,
                    total: unclassified.length,
                    title: title,
                    isPaused: AIClassifier.isPaused,
                });

                try {
                    await AIClassifier.classifyPage(page, settings);
                    results.success.push({ title });
                } catch (error) {
                    results.failed.push({ title, error: error.message });
                }

                // 请求间隔
                if (i < unclassified.length - 1) {
                    await Utils.sleep(delay);
                }
            }

            return {
                total: pages.length,
                classified: results.success.length,
                failed: results.failed.length,
                results,
            };
        },

        // 获取所有页面
        fetchAllPages: async (settings) => {
            const { notionApiKey, notionDatabaseId } = settings;
            const pages = [];
            let cursor = null;

            do {
                const response = await NotionAPI.queryDatabase(
                    notionDatabaseId,
                    null,
                    null,
                    cursor,
                    notionApiKey
                );
                pages.push(...(response.results || []));
                cursor = response.has_more ? response.next_cursor : null;
            } while (cursor);

            return pages;
        },

        // 获取页面标题（复用 Utils.getPageTitle）
        getPageTitle: (page) => {
            return Utils.getPageTitle(page, "未命名");
        },

        // 分类单个页面
        classifyPage: async (page, settings) => {
            const title = AIClassifier.getPageTitle(page);

            // 获取页面内容
            const blocks = await AIClassifier.fetchPageBlocks(page.id, settings.notionApiKey);
            const content = AIClassifier.extractText(blocks);

            // 调用 AI 分类
            const category = await AIService.classify(
                title,
                content,
                settings.categories,
                settings
            );

            // 更新页面属性
            await NotionAPI.updatePage(page.id, {
                "AI分类": { select: { name: category } }
            }, settings.notionApiKey);

            return category;
        },

        // 获取页面所有块
        fetchPageBlocks: async (pageId, apiKey) => {
            const blocks = [];
            let cursor = null;

            do {
                const response = await NotionAPI.fetchBlocks(pageId, cursor, apiKey);
                blocks.push(...(response.results || []));
                cursor = response.has_more ? response.next_cursor : null;
            } while (cursor);

            return blocks;
        },

        // 提取页面文本
        extractText: (blocks) => {
            const texts = [];

            const extractFromBlock = (block) => {
                const type = block.type;
                const content = block[type];

                if (!content) return;

                // 提取富文本
                if (content.rich_text) {
                    const text = content.rich_text.map(rt => rt.plain_text).join("");
                    if (text) texts.push(text);
                }

                // 提取标题
                if (content.title) {
                    const text = content.title.map(t => t.plain_text).join("");
                    if (text) texts.push(text);
                }

                // 提取代码
                if (content.caption) {
                    const text = content.caption.map(c => c.plain_text).join("");
                    if (text) texts.push(text);
                }
            };

            blocks.forEach(extractFromBlock);
            return texts.join("\n").slice(0, 4000); // 限制长度
        },

        // 确保数据库有 "AI分类" Select 属性
        ensureAICategoryProperty: async (settings) => {
            const { notionApiKey, notionDatabaseId, categories } = settings;

            // 获取数据库 schema
            const database = await NotionAPI.fetchDatabase(notionDatabaseId, notionApiKey);
            const properties = database.properties || {};

            // 检查是否已有 "AI分类" 属性
            if (properties["AI分类"]) {
                // 属性已存在，更新选项列表（添加新分类）
                const existingOptions = properties["AI分类"].select?.options || [];
                const existingNames = new Set(existingOptions.map(o => o.name));

                // 找出需要添加的新分类
                const newOptions = categories.filter(cat => !existingNames.has(cat));

                if (newOptions.length > 0) {
                    // 合并现有选项和新选项
                    const allOptions = [
                        ...existingOptions,
                        ...newOptions.map(name => ({ name }))
                    ];

                    await NotionAPI.updateDatabase(notionDatabaseId, {
                        "AI分类": {
                            select: { options: allOptions }
                        }
                    }, notionApiKey);

                    console.log(`AI分类属性已更新，新增 ${newOptions.length} 个选项`);
                }
                return;
            }

            // 创建 "AI分类" Select 属性
            const options = categories.map(name => ({ name }));

            await NotionAPI.updateDatabase(notionDatabaseId, {
                "AI分类": {
                    select: { options }
                }
            }, notionApiKey);

            console.log("已创建 AI分类 属性");
        },

        // 控制方法
        pause: () => { AIClassifier.isPaused = true; },
        resume: () => { AIClassifier.isPaused = false; },
        cancel: () => { AIClassifier.isCancelled = true; },
        reset: () => { AIClassifier.isPaused = false; AIClassifier.isCancelled = false; },
    };

    // ===========================================
    // 权限保护模块
    // ===========================================
    const OperationGuard = {
        // 获取当前权限级别
        getLevel: () => {
            return Storage.get(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, CONFIG.DEFAULTS.permissionLevel);
        },

        // 设置权限级别
        setLevel: (level) => {
            Storage.set(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, level);
        },

        // 是否需要确认
        requiresConfirm: () => {
            return Storage.get(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, CONFIG.DEFAULTS.requireConfirm);
        },

        // 操作所需的最低权限级别
        OPERATION_LEVELS: {
            // 只读操作
            search: 0,
            fetchPage: 0,
            fetchBlocks: 0,
            fetchDatabase: 0,
            queryDatabase: 0,
            getUsers: 0,
            getSelf: 0,
            getUser: 0,
            // 标准操作
            createDatabasePage: 1,
            updatePage: 1,
            updateBlock: 1,
            appendBlocks: 1,
            // 高级操作
            movePage: 2,
            duplicatePage: 2,
            createDatabase: 2,
            deletePage: 2,
            restorePage: 2,
            deleteBlock: 2,
            agentTask: 2,
        },

        // 危险操作列表（需要额外确认）
        DANGEROUS_OPERATIONS: ["deletePage", "deleteBlock"],

        // 检查是否有权限执行操作
        canExecute: (operation) => {
            const currentLevel = OperationGuard.getLevel();
            const requiredLevel = OperationGuard.OPERATION_LEVELS[operation];
            if (requiredLevel === undefined) {
                // 安全原则: 未定义的操作默认拒绝
                console.warn(`OperationGuard: 操作 "${operation}" 未定义权限级别，默认拒绝`);
                return false;
            }
            return currentLevel >= requiredLevel;
        },

        // 检查是否为危险操作
        isDangerous: (operation) => {
            return OperationGuard.DANGEROUS_OPERATIONS.includes(operation);
        },

        // 执行受保护的操作
        execute: async (operation, executor, context = {}) => {
            // 检查权限
            if (!OperationGuard.canExecute(operation)) {
                const requiredLevel = OperationGuard.OPERATION_LEVELS[operation];
                const requiredName = CONFIG.PERMISSION_NAMES[requiredLevel];
                throw new Error(`权限不足：需要"${requiredName}"及以上权限才能执行此操作`);
            }

            // 危险操作需要确认
            if (OperationGuard.isDangerous(operation) && OperationGuard.requiresConfirm()) {
                const isPermanent = operation === "deleteBlock";
                const confirmed = await ConfirmationDialog.show({
                    title: isPermanent ? "⚠️ 永久删除确认" : "危险操作确认",
                    message: isPermanent
                        ? `您即将永久删除块，此操作无法撤销！`
                        : `您即将执行危险操作: ${operation}`,
                    itemName: context.itemName || "未知项目",
                    countdown: isPermanent ? 8 : 5, // 永久删除需要更长倒计时
                    requireNameInput: true,
                });

                if (!confirmed) {
                    throw new Error("操作已取消");
                }
            }

            // 记录操作开始
            const logEntry = {
                operation,
                context,
                startTime: Date.now(),
                status: "pending",
            };

            try {
                const result = await executor();
                logEntry.status = "success";
                logEntry.endTime = Date.now();

                // 记录日志
                OperationLog.add(logEntry);

                // 危险操作提供撤销选项
                if (OperationGuard.isDangerous(operation)) {
                    if (operation === "deletePage") {
                        // deletePage 使用软删除（归档），可以恢复
                        UndoManager.register({
                            operation,
                            undoAction: () => NotionAPI.restorePage(context.pageId, context.apiKey),
                            description: `恢复页面: ${context.itemName || context.pageId}`,
                        });
                    } else if (operation === "deleteBlock") {
                        // deleteBlock 是永久删除，无法通过 API 恢复
                        // 仅记录警告日志，不提供撤销选项
                        console.warn(`OperationGuard: deleteBlock 是永久操作，无法撤销`);
                    }
                }

                return result;
            } catch (error) {
                logEntry.status = "failed";
                logEntry.error = error.message;
                logEntry.endTime = Date.now();
                OperationLog.add(logEntry);
                throw error;
            }
        },
    };

    // ===========================================
    // 操作日志模块
    // ===========================================
    const OperationLog = {
        // 获取是否启用日志
        isEnabled: () => {
            return Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
        },

        // 获取所有日志
        getAll: () => {
            const data = Storage.get(CONFIG.STORAGE_KEYS.OPERATION_LOG, "[]");
            try {
                return JSON.parse(data);
            } catch {
                return [];
            }
        },

        // 添加日志条目
        add: (entry) => {
            if (!OperationLog.isEnabled()) return;

            const logs = OperationLog.getAll();
            const logEntry = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                timestamp: new Date().toISOString(),
                ...entry,
            };

            logs.unshift(logEntry);

            // 限制日志数量
            if (logs.length > CONFIG.API.MAX_LOG_ENTRIES) {
                logs.length = CONFIG.API.MAX_LOG_ENTRIES;
            }

            Storage.set(CONFIG.STORAGE_KEYS.OPERATION_LOG, JSON.stringify(logs));

            // 触发UI更新
            if (typeof UI !== "undefined" && UI.updateLogPanel) {
                UI.updateLogPanel();
            }

            return logEntry;
        },

        // 清空日志
        clear: () => {
            Storage.set(CONFIG.STORAGE_KEYS.OPERATION_LOG, "[]");
            if (typeof UI !== "undefined" && UI.updateLogPanel) {
                UI.updateLogPanel();
            }
        },

        // 获取最近N条日志
        getRecent: (count = 10) => {
            return OperationLog.getAll().slice(0, count);
        },

        // 格式化日志条目用于显示
        formatEntry: (entry) => {
            const time = new Date(entry.timestamp).toLocaleString("zh-CN");
            const statusIcon = entry.status === "success" ? "✅" : entry.status === "failed" ? "❌" : "⏳";
            const duration = entry.endTime ? `${entry.endTime - entry.startTime}ms` : "-";
            return {
                time,
                statusIcon,
                operation: entry.operation,
                status: entry.status,
                duration,
                error: entry.error,
                context: entry.context,
            };
        },
    };

    // ===========================================
    // 确认对话框模块
    // ===========================================
    const ConfirmationDialog = {
        dialogElement: null,

        // 显示确认对话框
        show: (options) => {
            return new Promise((resolve) => {
                const {
                    title = "确认操作",
                    message = "确定要执行此操作吗？",
                    itemName = "",
                    countdown = 5,
                    requireNameInput = false,
                } = options;

                // 创建对话框
                const dialog = document.createElement("div");
                dialog.className = "ldb-confirm-overlay";
                dialog.innerHTML = `
                    <div class="ldb-confirm-dialog">
                        <div class="ldb-confirm-header">
                            <span class="ldb-confirm-icon">⚠️</span>
                            <span class="ldb-confirm-title">${title}</span>
                        </div>
                        <div class="ldb-confirm-body">
                            <p class="ldb-confirm-message">${message}</p>
                            ${itemName ? `<p class="ldb-confirm-item">目标: <strong>${itemName}</strong></p>` : ""}
                            ${requireNameInput ? `
                                <div class="ldb-confirm-input-group">
                                    <label>请输入名称确认:</label>
                                    <input type="text" class="ldb-confirm-input" placeholder="${itemName}" id="ldb-confirm-name-input">
                                    <div class="ldb-confirm-hint">请输入 "${itemName}" 以确认操作</div>
                                </div>
                            ` : ""}
                        </div>
                        <div class="ldb-confirm-footer">
                            <div class="ldb-confirm-countdown-bar" id="ldb-confirm-countdown-bar">
                                <div class="ldb-confirm-countdown-fill" id="ldb-confirm-countdown-fill"></div>
                            </div>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-confirm-cancel">取消</button>
                            <button class="ldb-btn ldb-btn-danger" id="ldb-confirm-ok" disabled>
                                确认 (<span id="ldb-confirm-countdown">${countdown}</span>)
                            </button>
                        </div>
                    </div>
                `;

                document.body.appendChild(dialog);
                ConfirmationDialog.dialogElement = dialog;

                const okBtn = dialog.querySelector("#ldb-confirm-ok");
                const cancelBtn = dialog.querySelector("#ldb-confirm-cancel");
                const countdownEl = dialog.querySelector("#ldb-confirm-countdown");
                const nameInput = dialog.querySelector("#ldb-confirm-name-input");

                let remaining = countdown;
                let canConfirm = !requireNameInput;

                // 倒计时进度条
                const countdownFill = dialog.querySelector("#ldb-confirm-countdown-fill");
                if (countdownFill) {
                    // 启动动画（下一帧开始，确保 transition 生效）
                    requestAnimationFrame(() => {
                        countdownFill.style.width = "0%";
                        countdownFill.style.transition = `width ${countdown}s linear`;
                    });
                }

                // 倒计时
                const timer = setInterval(() => {
                    remaining--;
                    countdownEl.textContent = remaining;
                    if (remaining <= 0) {
                        clearInterval(timer);
                        countdownEl.parentElement.textContent = "确认";
                        if (canConfirm) {
                            okBtn.disabled = false;
                        }
                    }
                }, 1000);

                // 名称输入验证
                if (nameInput) {
                    nameInput.oninput = () => {
                        canConfirm = nameInput.value.trim() === itemName;
                        if (remaining <= 0 && canConfirm) {
                            okBtn.disabled = false;
                        } else {
                            okBtn.disabled = true;
                        }
                    };
                    nameInput.focus();
                }

                // 取消按钮
                cancelBtn.onclick = () => {
                    clearInterval(timer);
                    dialog.remove();
                    ConfirmationDialog.dialogElement = null;
                    resolve(false);
                };

                // 确认按钮
                okBtn.onclick = () => {
                    if (okBtn.disabled) return;
                    clearInterval(timer);
                    dialog.remove();
                    ConfirmationDialog.dialogElement = null;
                    resolve(true);
                };

                // ESC 关闭
                const escHandler = (e) => {
                    if (e.key === "Escape") {
                        clearInterval(timer);
                        dialog.remove();
                        ConfirmationDialog.dialogElement = null;
                        document.removeEventListener("keydown", escHandler);
                        resolve(false);
                    }
                };
                document.addEventListener("keydown", escHandler);
            });
        },

        // 关闭对话框
        close: () => {
            if (ConfirmationDialog.dialogElement) {
                ConfirmationDialog.dialogElement.remove();
                ConfirmationDialog.dialogElement = null;
            }
        },
    };

    // ===========================================
    // 撤销管理模块
    // ===========================================
    const UndoManager = {
        pendingUndo: null,
        toastElement: null,
        timeoutId: null,

        // 注册可撤销的操作
        register: (undoAction) => {
            // 清除之前的撤销
            UndoManager.clear();

            UndoManager.pendingUndo = {
                ...undoAction,
                registeredAt: Date.now(),
            };

            // 显示撤销提示
            UndoManager.showToast(undoAction.description);

            // 设置超时
            UndoManager.timeoutId = setTimeout(() => {
                UndoManager.clear();
            }, CONFIG.API.UNDO_TIMEOUT);
        },

        // 执行撤销
        execute: async () => {
            if (!UndoManager.pendingUndo) return false;

            try {
                await UndoManager.pendingUndo.undoAction();
                UndoManager.hideToast();
                UndoManager.clear();

                // 记录撤销操作
                OperationLog.add({
                    operation: "undo",
                    context: { description: UndoManager.pendingUndo?.description },
                    startTime: Date.now(),
                    endTime: Date.now(),
                    status: "success",
                });

                return true;
            } catch (error) {
                console.error("撤销失败:", error);
                OperationLog.add({
                    operation: "undo",
                    context: { description: UndoManager.pendingUndo?.description },
                    startTime: Date.now(),
                    endTime: Date.now(),
                    status: "failed",
                    error: error.message,
                });
                return false;
            }
        },

        // 清除待撤销操作
        clear: () => {
            if (UndoManager.timeoutId) {
                clearTimeout(UndoManager.timeoutId);
                UndoManager.timeoutId = null;
            }
            UndoManager.pendingUndo = null;
            UndoManager.hideToast();
        },

        // 显示撤销提示 toast
        showToast: (message) => {
            UndoManager.hideToast();

            const toast = document.createElement("div");
            toast.className = "ldb-undo-toast";
            toast.innerHTML = `
                <span class="ldb-undo-message">${message}</span>
                <button class="ldb-undo-btn" id="ldb-undo-action">撤销</button>
                <div class="ldb-undo-progress">
                    <div class="ldb-undo-progress-bar"></div>
                </div>
            `;

            document.body.appendChild(toast);
            UndoManager.toastElement = toast;

            // 绑定撤销按钮
            toast.querySelector("#ldb-undo-action").onclick = async () => {
                const success = await UndoManager.execute();
                if (success) {
                    UI.showStatus("撤销成功", "success");
                } else {
                    UI.showStatus("撤销失败", "error");
                }
            };

            // 动画显示
            requestAnimationFrame(() => {
                toast.classList.add("visible");
            });
        },

        // 隐藏撤销提示
        hideToast: () => {
            if (UndoManager.toastElement) {
                UndoManager.toastElement.classList.remove("visible");
                setTimeout(() => {
                    if (UndoManager.toastElement) {
                        UndoManager.toastElement.remove();
                        UndoManager.toastElement = null;
                    }
                }, 300);
            }
        },

        // 检查是否有待撤销操作
        hasPending: () => {
            return UndoManager.pendingUndo !== null;
        },

        // 获取剩余撤销时间
        getRemainingTime: () => {
            if (!UndoManager.pendingUndo) return 0;
            const elapsed = Date.now() - UndoManager.pendingUndo.registeredAt;
            return Math.max(0, CONFIG.API.UNDO_TIMEOUT - elapsed);
        },
    };

    // ===========================================
    // 通用网页内容提取器
    // ===========================================
    const GenericExtractor = {
        // 提取页面元数据
        extractMeta: () => {
            const getMeta = (name) => {
                const el = document.querySelector(
                    `meta[property="${name}"], meta[name="${name}"]`
                );
                return el?.getAttribute("content") || "";
            };

            // 标题：og:title > document.title > h1
            const title =
                getMeta("og:title") ||
                document.title ||
                document.querySelector("h1")?.textContent?.trim() ||
                "无标题";

            // 作者
            const author =
                getMeta("author") ||
                getMeta("article:author") ||
                document.querySelector('[rel="author"], .author, .byline, [itemprop="author"]')?.textContent?.trim() ||
                "";

            // 发布日期
            const rawDate =
                getMeta("article:published_time") ||
                getMeta("datePublished") ||
                document.querySelector("time[datetime]")?.getAttribute("datetime") ||
                getMeta("date") ||
                "";
            let publishDate = "";
            if (rawDate) {
                try {
                    publishDate = new Date(rawDate).toISOString().split("T")[0];
                } catch (e) {}
            }

            // 站点名称
            const siteName =
                getMeta("og:site_name") ||
                window.location.hostname.replace(/^www\./, "");

            // 摘要
            const description =
                getMeta("og:description") ||
                getMeta("description") ||
                "";

            return {
                title: title.substring(0, 200),
                url: window.location.href,
                author: author.substring(0, 100),
                publishDate,
                siteName: siteName.substring(0, 100),
                description: description.substring(0, 500),
            };
        },

        // 智能提取正文内容 DOM 节点
        extractContent: () => {
            // 策略 1：<article> 标签
            const article = document.querySelector("article");
            if (article) return article;

            // 策略 2：role="main" 或 <main>
            const main = document.querySelector('[role="main"], main');
            if (main) return main;

            // 策略 3：常见正文容器 class/id
            const selectors = [
                ".post-content", ".article-content", ".entry-content",
                ".content", ".post-body", ".article-body",
                "#content", "#article", "#post-content",
                ".markdown-body", ".prose", ".rich-text",
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim().length > 200) return el;
            }

            // 策略 4：启发式 — 找文本密度最高的容器
            const candidates = document.querySelectorAll("div, section");
            let best = null;
            let bestScore = 0;
            for (const el of candidates) {
                // 跳过导航、侧边栏、页脚等
                const tag = el.tagName.toLowerCase();
                const id = (el.id || "").toLowerCase();
                const cls = (el.className || "").toLowerCase();
                const skip = /(nav|sidebar|footer|header|menu|comment|widget|ad|banner)/;
                if (skip.test(id) || skip.test(cls) || skip.test(tag)) continue;

                const text = el.textContent || "";
                const pCount = el.querySelectorAll("p").length;
                const score = text.length * 0.3 + pCount * 100;
                if (score > bestScore) {
                    bestScore = score;
                    best = el;
                }
            }
            if (best && best.textContent.trim().length > 100) return best;

            // 兜底：克隆 body 并移除脚本注入的 UI 元素，避免导出内容混入剪藏面板
            const clone = document.body.cloneNode(true);
            clone.querySelectorAll('[class*="gclip-"], [class*="ldb-"], [id*="ldb-"]').forEach(el => el.remove());
            return clone;
        },

        // 将提取的 DOM 转为 Notion blocks（复用 DOMToNotion）
        toNotionBlocks: (contentEl, imgMode) => {
            return DOMToNotion.cookedToBlocks(contentEl.innerHTML, imgMode);
        },
    };

    // ===========================================
    // 工作区数据服务（带并发去重）
    // ===========================================
    const WorkspaceService = {
        _inflightRequests: new Map(),

        _requestSearchItems: async (apiKey, objectType, maxPages = 0, onProgress = null, phase = "") => {
            let results = [];
            let cursor = undefined;
            let pageCount = 0;
            do {
                const response = await NotionAPI.search("", { property: "object", value: objectType }, apiKey, cursor);
                const batch = response.results || [];
                results = results.concat(batch);
                cursor = response.has_more ? response.next_cursor : undefined;
                pageCount++;
                if (onProgress) {
                    onProgress({
                        phase,
                        loaded: results.length,
                        hasMore: !!cursor,
                        pageCount,
                    });
                }
            } while (cursor && (maxPages === 0 || pageCount < maxPages));
            return results;
        },

        fetchWorkspace: async (apiKey, options = {}) => {
            if (!apiKey) {
                return { databases: [], pages: [] };
            }

            const includePages = options.includePages !== false;
            const maxPages = Number.isFinite(options.maxPages)
                ? options.maxPages
                : (parseInt(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages), 10) || 0);
            const requestKey = `${apiKey.slice(-8)}:${maxPages}:${includePages ? "all" : "db"}`;

            if (WorkspaceService._inflightRequests.has(requestKey)) {
                return WorkspaceService._inflightRequests.get(requestKey);
            }

            const requestPromise = (async () => {
                const dbResults = await WorkspaceService._requestSearchItems(
                    apiKey,
                    "database",
                    maxPages,
                    options.onProgress,
                    "databases"
                );
                const databases = dbResults.map(db => ({
                    id: db.id?.replace(/-/g, "") || "",
                    title: db.title?.[0]?.plain_text || "无标题数据库",
                    type: "database",
                    url: db.url || "",
                })).filter(item => item.id);

                if (!includePages) {
                    return { databases, pages: [] };
                }

                const pageResults = await WorkspaceService._requestSearchItems(
                    apiKey,
                    "page",
                    maxPages,
                    options.onProgress,
                    "pages"
                );
                const pages = pageResults.map(page => ({
                    id: page.id?.replace(/-/g, "") || "",
                    title: Utils.getPageTitle(page),
                    type: "page",
                    url: page.url || "",
                    parent: page.parent?.type || "",
                })).filter(item => item.id);

                return { databases, pages };
            })();

            WorkspaceService._inflightRequests.set(requestKey, requestPromise);
            try {
                return await requestPromise;
            } finally {
                WorkspaceService._inflightRequests.delete(requestKey);
            }
        },

        fetchWorkspaceStaged: async (apiKey, options = {}) => {
            if (!apiKey) {
                return { databases: [], pages: [] };
            }

            const includePages = options.includePages !== false;
            const maxPages = Number.isFinite(options.maxPages)
                ? options.maxPages
                : (parseInt(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages), 10) || 0);

            const databasesRaw = await WorkspaceService._requestSearchItems(
                apiKey,
                "database",
                maxPages,
                options.onProgress,
                "databases"
            );
            const databases = databasesRaw.map(db => ({
                id: db.id?.replace(/-/g, "") || "",
                title: db.title?.[0]?.plain_text || "无标题数据库",
                type: "database",
                url: db.url || "",
            })).filter(item => item.id);

            options.onPhaseComplete?.("databases", { databases, pages: [] });

            if (!includePages) {
                return { databases, pages: [] };
            }

            const pagesRaw = await WorkspaceService._requestSearchItems(
                apiKey,
                "page",
                maxPages,
                options.onProgress,
                "pages"
            );
            const pages = pagesRaw.map(page => ({
                id: page.id?.replace(/-/g, "") || "",
                title: Utils.getPageTitle(page),
                type: "page",
                url: page.url || "",
                parent: page.parent?.type || "",
            })).filter(item => item.id);

            const finalWorkspace = { databases, pages };
            options.onPhaseComplete?.("pages", finalWorkspace);
            return finalWorkspace;
        },
    };

    // ===========================================
    // 通用网页导出器
    // ===========================================
    const GenericExporter = {
        // 构建通用网页的 Notion 属性
        buildProperties: (meta) => {
            const props = {
                "标题": {
                    title: [{ text: { content: meta.title || "无标题" } }]
                },
                "链接": {
                    url: meta.url
                },
                "来源": {
                    rich_text: [{ text: { content: meta.siteName || "" } }]
                },
                "作者": {
                    rich_text: [{ text: { content: meta.author || "" } }]
                },
            };
            if (meta.publishDate) {
                props["发布日期"] = { date: { start: meta.publishDate } };
            }
            if (meta.description) {
                props["摘要"] = {
                    rich_text: [{ text: { content: meta.description.substring(0, 2000) } }]
                };
            }
            return props;
        },

        // 导出当前页面
        exportCurrentPage: async (settings) => {
            const meta = GenericExtractor.extractMeta();
            const contentEl = GenericExtractor.extractContent();
            const blocks = GenericExtractor.toNotionBlocks(contentEl, settings.imgMode || "external");

            // 添加来源信息头
            blocks.unshift({
                type: "callout",
                callout: {
                    icon: { type: "emoji", emoji: "🔗" },
                    rich_text: [{ type: "text", text: { content: `来源: ${meta.url}` } }],
                },
            });

            // 处理图片上传
            if (settings.imgMode === "upload") {
                await Exporter.processImageUploads(blocks, settings.apiKey, null);
            }

            let page;
            if (settings.exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
                page = await NotionAPI.createChildPage(
                    settings.parentPageId,
                    meta.title,
                    blocks,
                    settings.apiKey
                );
            } else {
                const properties = GenericExporter.buildProperties(meta);
                page = await NotionAPI.createDatabasePage(
                    settings.databaseId,
                    properties,
                    blocks,
                    settings.apiKey
                );
            }

            return { page, meta };
        },

        // 自动设置通用数据库属性
        setupDatabaseProperties: async (databaseId, apiKey) => {
            const requiredProperties = {
                "标题": { typeName: "title", schema: { title: {} } },
                "链接": { typeName: "url", schema: { url: {} } },
                "来源": { typeName: "rich_text", schema: { rich_text: {} } },
                "作者": { typeName: "rich_text", schema: { rich_text: {} } },
                "发布日期": { typeName: "date", schema: { date: {} } },
                "摘要": { typeName: "rich_text", schema: { rich_text: {} } },
            };

            try {
                const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
                const existingProps = database.properties || {};
                const propsToAdd = {};
                const propsToUpdate = {};

                const typeConflicts = [];
                for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                    const existingProp = existingProps[name];
                    if (!existingProp) {
                        if (typeName === "title") {
                            const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                            if (existingTitle && existingTitle[0] !== name) {
                                propsToUpdate[existingTitle[0]] = { name: name };
                            }
                        } else {
                            propsToAdd[name] = schema;
                        }
                    } else if (existingProp.type !== typeName) {
                        typeConflicts.push(`「${name}」期望 ${typeName}，实际 ${existingProp.type}`);
                    }
                }

                if (typeConflicts.length > 0) {
                    return {
                        success: false,
                        message: `属性类型冲突: ${typeConflicts.join("；")}，请手动修改数据库属性后重试`
                    };
                }

                const allChanges = { ...propsToAdd, ...propsToUpdate };
                if (Object.keys(allChanges).length === 0) {
                    return { success: true, message: "属性已正确配置" };
                }

                await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                    properties: allChanges
                }, apiKey);

                return { success: true, message: `已添加 ${Object.keys(propsToAdd).length} 个属性` };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },
    };

    // ===========================================
    // Linux.do API 封装
    // ===========================================
    const LinuxDoAPI = {
        getRequestOpts: () => {
            const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
            const headers = { "x-requested-with": "XMLHttpRequest" };
            if (csrf) headers["x-csrf-token"] = csrf;
            return { headers };
        },

        fetchJson: async (url, retries = 2) => {
            let lastErr = null;
            const opts = LinuxDoAPI.getRequestOpts();

            for (let i = 0; i <= retries; i++) {
                try {
                    const res = await fetch(url, opts);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return await res.json();
                } catch (e) {
                    lastErr = e;
                    if (i < retries) await Utils.sleep(250 * (i + 1));
                }
            }
            throw lastErr || new Error("fetchJson failed");
        },

        // 获取收藏列表
        fetchBookmarks: async (username, page = 0) => {
            const url = `${window.location.origin}/u/${username}/bookmarks.json?page=${page}`;
            const data = await LinuxDoAPI.fetchJson(url);
            return data;
        },

        // 获取所有收藏
        fetchAllBookmarks: async (username, onProgress) => {
            const allBookmarks = [];
            let page = 0;
            let hasMore = true;

            while (hasMore) {
                const data = await LinuxDoAPI.fetchBookmarks(username, page);
                const bookmarks = data.user_bookmark_list?.bookmarks || [];

                if (bookmarks.length === 0) {
                    hasMore = false;
                } else {
                    allBookmarks.push(...bookmarks);
                    page++;
                    if (onProgress) onProgress(allBookmarks.length);

                    // 检查是否还有更多
                    hasMore = data.user_bookmark_list?.more_bookmarks_url != null;
                    const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
                    await Utils.sleep(delay); // 避免请求过快
                }
            }

            return allBookmarks;
        },

        // 获取帖子详情
        fetchTopicDetail: async (topicId) => {
            const url = `${window.location.origin}/t/${topicId}.json`;
            return await LinuxDoAPI.fetchJson(url);
        },

        // 获取帖子所有楼层
        fetchAllPosts: async (topicId, onProgress) => {
            const opts = LinuxDoAPI.getRequestOpts();

            // 获取所有帖子 ID
            const idData = await LinuxDoAPI.fetchJson(
                `${window.location.origin}/t/${topicId}/post_ids.json?post_number=0&limit=99999`
            );
            let postIds = idData.post_ids || [];

            // 获取主题详情
            const mainData = await LinuxDoAPI.fetchJson(`${window.location.origin}/t/${topicId}.json`);
            const mainFirstPost = mainData.post_stream?.posts?.[0];
            if (mainFirstPost && !postIds.includes(mainFirstPost.id)) {
                postIds.unshift(mainFirstPost.id);
            }

            const opUsername = mainData?.details?.created_by?.username || mainData?.post_stream?.posts?.[0]?.username || "";

            const topic = {
                topicId: String(topicId),
                title: mainData?.title || "",
                category: mainData?.category_id ? `分类ID: ${mainData.category_id}` : "",
                categoryName: "",
                tags: mainData?.tags || [],
                url: `${window.location.origin}/t/${topicId}`,
                opUsername: opUsername,
                createdAt: mainData?.created_at || "",
                postsCount: mainData?.posts_count || 0,
                likeCount: mainData?.like_count || 0,
                views: mainData?.views || 0,
            };

            // 尝试获取分类名称
            try {
                const categoryBadge = document.querySelector(`.badge-category[data-category-id="${mainData.category_id}"]`);
                if (categoryBadge) {
                    topic.categoryName = categoryBadge.textContent.trim();
                }
            } catch (e) {}

            // 分批获取帖子详情
            let allPosts = [];
            for (let i = 0; i < postIds.length; i += 200) {
                const chunk = postIds.slice(i, i + 200);
                const q = chunk.map((id) => `post_ids[]=${encodeURIComponent(id)}`).join("&");
                const data = await LinuxDoAPI.fetchJson(
                    `${window.location.origin}/t/${topicId}/posts.json?${q}&include_suggested=false`
                );
                const posts = data.post_stream?.posts || [];
                allPosts = allPosts.concat(posts);

                if (onProgress) onProgress(Math.min(i + 200, postIds.length), postIds.length);
            }

            allPosts.sort((a, b) => a.post_number - b.post_number);
            return { topic, posts: allPosts };
        },
    };

    // ===========================================
    // 导出器
    // ===========================================
    const Exporter = {
        isExporting: false, // 标记是否正在导出（用于与自动导入互斥）

        // 筛选帖子
        filterPosts: (posts, topic, settings) => {
            return posts.filter((post) => {
                const postNum = post.post_number;

                // 楼层范围
                if (postNum < settings.rangeStart || postNum > settings.rangeEnd) {
                    return false;
                }

                // 只要第一楼
                if (settings.onlyFirst && postNum !== 1) {
                    return false;
                }

                // 只要楼主
                if (settings.onlyOp && post.username !== topic.opUsername) {
                    return false;
                }

                return true;
            });
        },

        // 构建 Notion 页面属性
        buildProperties: (topic, bookmark) => {
            return {
                "标题": {
                    title: [{ text: { content: topic.title || "无标题" } }]
                },
                "链接": {
                    url: topic.url
                },
                "分类": {
                    rich_text: [{ text: { content: topic.categoryName || topic.category || "" } }]
                },
                "标签": {
                    multi_select: (topic.tags || []).map(tag => ({
                        name: typeof tag === 'string' ? tag : (tag.name || '')
                    })).filter(t => t.name)
                },
                "作者": {
                    rich_text: [{ text: { content: topic.opUsername || "" } }]
                },
                "收藏时间": bookmark?.created_at ? {
                    date: { start: bookmark.created_at.split("T")[0] }
                } : undefined,
                "帖子数": {
                    number: topic.postsCount || 0
                },
                "浏览数": {
                    number: topic.views || 0
                },
                "点赞数": {
                    number: topic.likeCount || 0
                },
            };
        },

        // 构建帖子内容 blocks
        buildContentBlocks: (posts, topic, settings) => {
            const blocks = [];

            // 添加帖子信息头
            blocks.push({
                type: "callout",
                callout: {
                    icon: { type: "emoji", emoji: "📌" },
                    rich_text: [{ type: "text", text: { content: `帖子来源: ${topic.url}` } }],
                },
            });

            // 处理每个楼层
            for (const post of posts) {
                const isOp = post.username === topic.opUsername;
                const dateStr = Utils.formatDate(post.created_at);
                const emoji = isOp ? "🏠" : "💬";

                let title = `#${post.post_number} ${post.name || post.username || "匿名"}`;
                if (isOp) title += " 楼主";
                if (dateStr) title += ` · ${dateStr}`;

                // 转换帖子内容
                const contentBlocks = DOMToNotion.cookedToBlocks(post.cooked, settings.imgMode);

                // 创建 callout 包裹
                const children = [];

                // 添加回复信息
                if (post.reply_to_post_number) {
                    children.push({
                        type: "paragraph",
                        paragraph: {
                            rich_text: [{ type: "text", text: { content: `↩️ 回复 #${post.reply_to_post_number}楼` } }],
                        },
                    });
                }

                children.push(...contentBlocks);

                // 跳过空楼层
                if (children.length === 0) {
                    children.push({
                        type: "paragraph",
                        paragraph: {
                            rich_text: [{ type: "text", text: { content: "（内容为空或无法解析）" } }],
                        },
                    });
                }

                // 拆分超过 100 个子 block 的内容
                const maxChildren = 100;
                for (let i = 0; i < children.length; i += maxChildren) {
                    const chunk = children.slice(i, i + maxChildren);
                    const isFirst = i === 0;
                    const partNum = Math.floor(i / maxChildren) + 1;
                    const totalParts = Math.ceil(children.length / maxChildren);

                    blocks.push({
                        type: "callout",
                        callout: {
                            icon: { type: "emoji", emoji: isFirst ? emoji : "📎" },
                            rich_text: [{
                                type: "text",
                                text: {
                                    content: isFirst ? title : `#${post.post_number}楼 续（${partNum}/${totalParts}）`
                                }
                            }],
                            children: chunk,
                        },
                    });
                }
            }

            return blocks;
        },

        // 处理图片上传
        // 注意: Notion File Upload API 返回的 file_id 需要在创建页面时使用特定格式
        // 由于 API 限制，目前采用外链模式作为后备方案
        processImageUploads: async (blocks, apiKey, onProgress) => {
            const imageBlocks = blocks.filter(b => b._needsUpload && b.type === "image");
            let processed = 0;

            for (const block of imageBlocks) {
                try {
                    const uploadResult = await NotionAPI.uploadImageToNotion(block._originalUrl, apiKey, true);
                    if (uploadResult?.fileId) {
                        // Notion File Upload API 需要使用 file_upload 类型引用上传的文件
                        // 参考: https://developers.notion.com/docs/working-with-files-and-media
                        const blockKey = uploadResult.blockType === "file" ? "file" : "image";
                        block[blockKey] = {
                            type: "file_upload",
                            file_upload: {
                                id: uploadResult.fileId,
                            },
                        };
                        if (blockKey !== "image") delete block.image;
                        if (blockKey !== "file") delete block.file;
                        block.type = blockKey;
                        block._uploaded = true;
                    } else {
                        // 上传失败，回退到外链模式
                        block.image = {
                            type: "external",
                            external: { url: block._originalUrl },
                        };
                        delete block.file;
                        block.type = "image";
                    }
                } catch (e) {
                    console.warn("图片上传失败，保留外链:", block._originalUrl, e.message);
                    // 保留外链模式
                    block.image = {
                        type: "external",
                        external: { url: block._originalUrl },
                    };
                    delete block.file;
                    block.type = "image";
                }

                processed++;
                if (onProgress) onProgress(processed, imageBlocks.length);
                await Utils.sleep(500); // 避免请求过快
            }

            // 清理临时属性
            for (const block of blocks) {
                delete block._needsUpload;
                delete block._originalUrl;
                delete block._uploaded;
            }

            // 递归处理子 blocks
            for (const block of blocks) {
                if (block.callout?.children) {
                    await Exporter.processImageUploads(block.callout.children, apiKey, null);
                }
            }
        },

        // 导出单个帖子
        exportTopic: async (bookmark, settings, onProgress) => {
            const topicId = bookmark.topic_id || bookmark.bookmarkable_id;

            onProgress?.({ stage: "fetch", message: "获取帖子数据..." });

            // 获取帖子详情
            const { topic, posts } = await LinuxDoAPI.fetchAllPosts(topicId, (current, total) => {
                onProgress?.({ stage: "fetch", message: `获取楼层 ${current}/${total}` });
            });

            // 筛选帖子
            const filteredPosts = Exporter.filterPosts(posts, topic, settings);

            onProgress?.({ stage: "convert", message: "转换内容格式..." });

            // 构建内容
            const blocks = Exporter.buildContentBlocks(filteredPosts, topic, settings);

            // 处理图片上传
            if (settings.imgMode === "upload") {
                onProgress?.({ stage: "upload", message: "上传图片..." });
                await Exporter.processImageUploads(blocks, settings.apiKey, (current, total) => {
                    onProgress?.({ stage: "upload", message: `上传图片 ${current}/${total}` });
                });
            }

            onProgress?.({ stage: "create", message: "创建 Notion 页面..." });

            let page;

            // 根据导出目标类型创建页面
            if (settings.exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
                // 创建为子页面
                page = await NotionAPI.createChildPage(
                    settings.parentPageId,
                    topic.title,
                    blocks,
                    settings.apiKey
                );
            } else {
                // 创建为数据库条目（默认行为）
                const properties = Exporter.buildProperties(topic, bookmark);
                page = await NotionAPI.createDatabasePage(
                    settings.databaseId,
                    properties,
                    blocks,
                    settings.apiKey
                );
            }

            // 标记为已导出
            Storage.markTopicExported(topicId);

            return page;
        },

        // 批量导出 (支持暂停/继续)
        isPaused: false,
        isCancelled: false,
        currentIndex: 0,

        pause: () => { Exporter.isPaused = true; },
        resume: () => { Exporter.isPaused = false; },
        cancel: () => { Exporter.isCancelled = true; Exporter.isPaused = false; },
        reset: () => { Exporter.isPaused = false; Exporter.isCancelled = false; Exporter.currentIndex = 0; },

        exportBookmarks: async (bookmarks, settings, onProgress, startIndex = 0) => {
            const results = { success: [], failed: [], skipped: [] };
            Exporter.reset();
            Exporter.isExporting = true;
            Exporter.currentIndex = startIndex;
            const concurrency = settings.concurrency || 1;
            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

            // 共享队列索引
            let nextIndex = startIndex;
            let completedCount = 0;

            const worker = async () => {
                while (true) {
                    // 检查暂停
                    while (Exporter.isPaused) {
                        await Utils.sleep(200);
                        if (Exporter.isCancelled) return;
                    }
                    if (Exporter.isCancelled) return;

                    // 取任务
                    const i = nextIndex;
                    if (i >= bookmarks.length) return;
                    nextIndex++;

                    const bookmark = bookmarks[i];
                    const topicId = bookmark.topic_id || bookmark.bookmarkable_id;
                    const title = bookmark.title || bookmark.name || `帖子 ${topicId}`;
                    const taskNum = i - startIndex + 1;

                    onProgress?.({
                        current: taskNum,
                        total: bookmarks.length,
                        title: title,
                        stage: "start",
                        isPaused: Exporter.isPaused,
                    });

                    try {
                        await Exporter.exportTopic(bookmark, settings, (detail) => {
                            onProgress?.({
                                current: taskNum,
                                total: bookmarks.length,
                                title: title,
                                isPaused: Exporter.isPaused,
                                ...detail,
                            });
                        });
                        results.success.push({ topicId, title, url: `https://linux.do/t/${topicId}` });
                    } catch (error) {
                        console.error(`导出失败: ${title}`, error);
                        results.failed.push({ topicId, title, error: error.message });
                    }

                    completedCount++;
                    Exporter.currentIndex = completedCount + startIndex;

                    // 请求间隔
                    if (delay > 0 && nextIndex < bookmarks.length && !Exporter.isCancelled) {
                        await Utils.sleep(delay);
                    }
                }
            };

            // 启动 N 个 worker
            const workerCount = Math.min(concurrency, bookmarks.length - startIndex);
            const workers = [];
            for (let w = 0; w < workerCount; w++) {
                workers.push(worker());
                // 错开启动避免同时请求
                if (w < workerCount - 1) await Utils.sleep(100);
            }
            await Promise.all(workers);

            // 取消时收集剩余为 skipped
            if (Exporter.isCancelled && nextIndex < bookmarks.length) {
                for (let i = nextIndex; i < bookmarks.length; i++) {
                    const b = bookmarks[i];
                    results.skipped.push({
                        topicId: b.topic_id || b.bookmarkable_id,
                        title: b.title || b.name || `帖子 ${b.topic_id || b.bookmarkable_id}`,
                    });
                }
            }

            Exporter.isExporting = false;
            return results;
        },
    };

    // ===========================================
    // 自动导入模块
    // ===========================================
    const AutoImporter = {
        isRunning: false,
        timerId: null,
        deferredWhileHidden: false,
        visibilityListenerBound: false,

        // 从 Storage 读取导出设置（不依赖 UI DOM）
        buildSettings: () => {
            const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, "database");
            return {
                apiKey: Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""),
                databaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                parentPageId: Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, ""),
                exportTargetType,
                onlyFirst: Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, false),
                onlyOp: Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, false),
                rangeStart: Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, 1),
                rangeEnd: Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, 999999),
                imgMode: Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, "external"),
                concurrency: Storage.get(CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY, CONFIG.DEFAULTS.exportConcurrency),
            };
        },

        // 检查配置是否足够
        canStart: () => {
            if (!Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, false)) return false;
            const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            if (!apiKey) return false;
            const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, "database");
            if (exportTargetType === "database") {
                return !!Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            } else {
                return !!Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "");
            }
        },

        // 更新状态栏
        updateStatus: (text) => {
            const el = (UI.refs && UI.refs.autoImportStatus) || document.querySelector("#ldb-auto-import-status");
            if (el) el.textContent = text;
        },

        // 执行一次自动导入
        run: async () => {
            if (document.hidden) {
                AutoImporter.deferredWhileHidden = true;
                return;
            }

            if (AutoImporter.isRunning) return;
            if (Exporter.isExporting) return; // 手动导出进行中，跳过

            // 检查配置是否足够（不依赖 AUTO_IMPORT_ENABLED，由调用方判断）
            const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            if (!apiKey) {
                AutoImporter.updateStatus("⚠️ 请先配置 Notion API Key");
                return;
            }
            const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, "database");
            if (exportTargetType === "database" && !Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "")) {
                AutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                return;
            }
            if (exportTargetType === "page" && !Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "")) {
                AutoImporter.updateStatus("⚠️ 请先配置父页面 ID");
                return;
            }

            AutoImporter.isRunning = true;
            const exportBtn = document.querySelector("#ldb-export");

            try {
                const username = Utils.getCurrentLinuxDoUsername();
                if (!username) return;

                AutoImporter.updateStatus("🔄 正在检查新收藏...");

                const bookmarks = await LinuxDoAPI.fetchAllBookmarks(username);

                // 自动导入始终按“新收藏”语义执行，避免轮询时重复全量导入
                const newBookmarks = bookmarks.filter(b => {
                    const topicId = String(b.topic_id || b.bookmarkable_id);
                    return !Storage.isTopicExported(topicId);
                });

                if (newBookmarks.length === 0) {
                    AutoImporter.updateStatus(`✅ 没有新收藏 (${new Date().toLocaleTimeString()})`);
                    return;
                }

                AutoImporter.updateStatus(`📥 发现 ${newBookmarks.length} 个新收藏，正在导入...`);

                if (exportBtn) exportBtn.disabled = true;

                const settings = AutoImporter.buildSettings();
                const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
                const concurrency = settings.concurrency || 1;
                let success = 0, failed = 0;

                // 共享队列索引
                let nextIndex = 0;

                const worker = async () => {
                    while (true) {
                        const i = nextIndex;
                        if (i >= newBookmarks.length) return;
                        nextIndex++;

                        const bookmark = newBookmarks[i];
                        const topicId = String(bookmark.topic_id || bookmark.bookmarkable_id);
                        const title = bookmark.title || bookmark.name || `帖子 ${topicId}`;

                        AutoImporter.updateStatus(`📥 导入中 (${i + 1}/${newBookmarks.length}): ${title}`);

                        try {
                            await Exporter.exportTopic(bookmark, settings);
                            success++;
                        } catch (e) {
                            console.error(`自动导入失败: ${title}`, e);
                            failed++;
                        }

                        if (delay > 0 && nextIndex < newBookmarks.length) await Utils.sleep(delay);
                    }
                };

                const workerCount = Math.min(concurrency, newBookmarks.length);
                const workers = [];
                for (let w = 0; w < workerCount; w++) {
                    workers.push(worker());
                    if (w < workerCount - 1) await Utils.sleep(100);
                }
                await Promise.all(workers);

                if (typeof UI !== "undefined" && UI.renderBookmarkList) {
                    try { UI.renderBookmarkList(); } catch {}
                }

                const statusText = `✅ 自动导入完成: ${success} 个成功${failed > 0 ? `，${failed} 个失败` : ""} (${new Date().toLocaleTimeString()})`;
                AutoImporter.updateStatus(statusText);

                if (success > 0 && typeof GM_notification === "function") {
                    GM_notification({
                        title: "自动导入完成",
                        text: `成功导入 ${success} 个新收藏到 Notion`,
                        timeout: 5000,
                    });
                }
            } catch (e) {
                console.error("自动导入出错:", e);
                AutoImporter.updateStatus(`❌ 自动导入出错: ${e.message}`);
            } finally {
                AutoImporter.isRunning = false;
                if (exportBtn) exportBtn.disabled = false;
            }
        },

        startPolling: (intervalMinutes) => {
            AutoImporter.stopPolling();
            if (intervalMinutes > 0) {
                AutoImporter.timerId = setInterval(() => AutoImporter.run(), intervalMinutes * 60 * 1000);
            }
        },

        ensureVisibilityListener: () => {
            if (AutoImporter.visibilityListenerBound) return;
            document.addEventListener("visibilitychange", () => {
                if (!document.hidden && AutoImporter.deferredWhileHidden) {
                    AutoImporter.deferredWhileHidden = false;
                    AutoImporter.run();
                }
            });
            AutoImporter.visibilityListenerBound = true;
        },

        stopPolling: () => {
            if (AutoImporter.timerId) {
                clearInterval(AutoImporter.timerId);
                AutoImporter.timerId = null;
            }
        },

        init: () => {
            if (!AutoImporter.canStart()) return;
            AutoImporter.ensureVisibilityListener();
            setTimeout(() => {
                AutoImporter.run();
                const interval = Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.autoImportInterval);
                if (interval > 0) AutoImporter.startPolling(interval);
            }, 3000);
        },
    };

    const UpdateChecker = {
        timerId: null,
        isChecking: false,

        getCurrentVersion: () => {
            if (typeof GM_info !== "undefined" && GM_info?.script?.version) {
                return GM_info.script.version;
            }
            return "3.4.3";
        },

        compareVersions: (a, b) => {
            const parse = (v) => String(v || "0")
                .replace(/^v/i, "")
                .split(".")
                .map((n) => parseInt(n, 10) || 0);
            const va = parse(a);
            const vb = parse(b);
            const len = Math.max(va.length, vb.length);
            for (let i = 0; i < len; i++) {
                const na = va[i] || 0;
                const nb = vb[i] || 0;
                if (na > nb) return 1;
                if (na < nb) return -1;
            }
            return 0;
        },

        fetchLatestVersion: () => {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: "https://api.github.com/repos/Smith-106/LD-Notion/releases/latest",
                    headers: {
                        "Accept": "application/vnd.github+json",
                        "User-Agent": "LD-Notion-UserScript",
                    },
                    timeout: 15000,
                    onload: (response) => {
                        if (response.status !== 200) {
                            reject(new Error(`更新检查失败: HTTP ${response.status}`));
                            return;
                        }
                        try {
                            const data = JSON.parse(response.responseText || "{}");
                            const version = String(data.tag_name || data.name || "").replace(/^v/i, "").trim();
                            if (!version) {
                                reject(new Error("未获取到版本号"));
                                return;
                            }
                            resolve(version);
                        } catch {
                            reject(new Error("解析更新信息失败"));
                        }
                    },
                    ontimeout: () => reject(new Error("更新检查超时")),
                    onerror: () => reject(new Error("网络错误，无法检查更新")),
                });
            });
        },

        saveResult: (result) => {
            const checkedAt = Date.now();
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, checkedAt);
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, JSON.stringify({ ...result, checkedAt }));
            if (result.latestVersion) {
                Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_SEEN_VERSION, result.latestVersion);
            }
        },

        updateStatusText: (text) => {
            const el = (UI.refs && UI.refs.updateCheckStatus) || document.querySelector("#ldb-update-check-status");
            if (el) el.textContent = text;
        },

        renderLastStatus: () => {
            const raw = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, "");
            if (!raw) {
                UpdateChecker.updateStatusText("尚未检查更新");
                return;
            }

            try {
                const result = JSON.parse(raw);
                const checkedAtText = result.checkedAt
                    ? new Date(result.checkedAt).toLocaleString("zh-CN")
                    : "未知时间";
                const latestText = result.latestVersion ? `，最新 v${result.latestVersion}` : "";
                if (result.status === "update-available") {
                    UpdateChecker.updateStatusText(`发现新版本（上次检查：${checkedAtText}${latestText}）`);
                } else if (result.status === "up-to-date") {
                    UpdateChecker.updateStatusText(`已是最新（上次检查：${checkedAtText}${latestText}）`);
                } else if (result.status === "error") {
                    UpdateChecker.updateStatusText(`上次检查失败：${result.message || "未知错误"}`);
                } else {
                    UpdateChecker.updateStatusText(`上次检查：${checkedAtText}`);
                }
            } catch {
                UpdateChecker.updateStatusText("更新状态读取失败");
            }
        },

        check: async ({ manual = false } = {}) => {
            if (UpdateChecker.isChecking) return;
            UpdateChecker.isChecking = true;

            if (manual) {
                UI.showStatus("正在检查更新...", "info");
            }

            try {
                const currentVersion = UpdateChecker.getCurrentVersion();
                const latestVersion = await UpdateChecker.fetchLatestVersion();
                const cmp = UpdateChecker.compareVersions(latestVersion, currentVersion);

                if (cmp > 0) {
                    const message = `发现新版本 v${latestVersion}（当前 v${currentVersion}）。脚本可直接更新；ZIP/解压扩展需手动重新安装或在扩展页重新加载。`;
                    UpdateChecker.saveResult({
                        status: "update-available",
                        latestVersion,
                        currentVersion,
                        message,
                    });
                    UpdateChecker.renderLastStatus();
                    if (manual) UI.showStatus(message, "info");
                } else {
                    const message = `当前已是最新版本 v${currentVersion}`;
                    UpdateChecker.saveResult({
                        status: "up-to-date",
                        latestVersion,
                        currentVersion,
                        message,
                    });
                    UpdateChecker.renderLastStatus();
                    if (manual) UI.showStatus(message, "success");
                }
            } catch (error) {
                const message = error?.message || "更新检查失败";
                UpdateChecker.saveResult({ status: "error", message });
                UpdateChecker.renderLastStatus();
                if (manual) UI.showStatus(message, "error");
            } finally {
                UpdateChecker.isChecking = false;
            }
        },

        startPolling: (hours) => {
            UpdateChecker.stopPolling();
            const intervalHours = parseInt(hours, 10) || 0;
            if (intervalHours > 0) {
                UpdateChecker.timerId = setInterval(() => {
                    UpdateChecker.check({ manual: false });
                }, intervalHours * 60 * 60 * 1000);
            }
        },

        stopPolling: () => {
            if (UpdateChecker.timerId) {
                clearInterval(UpdateChecker.timerId);
                UpdateChecker.timerId = null;
            }
        },

        init: () => {
            const enabled = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled);
            const intervalHours = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
            UpdateChecker.stopPolling();
            UpdateChecker.renderLastStatus();
            if (enabled) {
                UpdateChecker.check({ manual: false });
                UpdateChecker.startPolling(intervalHours);
            }
        },
    };

    const GitHubAutoImporter = {
        isRunning: false,
        timerId: null,
        deferredWhileHidden: false,
        visibilityListenerBound: false,

        canStart: () => {
            if (!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, false)) return false;
            const username = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
            const token = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
            if (!username && !token) return false;
            const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            const databaseId = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            return !!(apiKey && databaseId);
        },

        updateStatus: (text) => {
            const el = (UI.refs && UI.refs.autoImportStatus) || document.querySelector("#ldb-auto-import-status");
            if (el) el.textContent = text;
        },

        buildSettings: () => {
            return {
                apiKey: Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""),
                databaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                username: Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, ""),
                token: Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
            };
        },

        ensureVisibilityListener: () => {
            if (GitHubAutoImporter.visibilityListenerBound) return;
            document.addEventListener("visibilitychange", () => {
                if (!document.hidden && GitHubAutoImporter.deferredWhileHidden) {
                    GitHubAutoImporter.deferredWhileHidden = false;
                    GitHubAutoImporter.run();
                }
            });
            GitHubAutoImporter.visibilityListenerBound = true;
        },

        run: async () => {
            if (document.hidden) {
                GitHubAutoImporter.deferredWhileHidden = true;
                return;
            }
            if (GitHubAutoImporter.isRunning) return;

            const settings = GitHubAutoImporter.buildSettings();
            if (!settings.apiKey || !settings.databaseId) {
                GitHubAutoImporter.updateStatus("⚠️ 请先配置 Notion API Key 和数据库 ID");
                return;
            }
            if (!settings.username && !settings.token) {
                GitHubAutoImporter.updateStatus("⚠️ 请先配置 GitHub 用户名或 Token");
                return;
            }

            GitHubAutoImporter.isRunning = true;
            try {
                GitHubAutoImporter.updateStatus("🔄 正在检查 GitHub 新收藏...");

                const types = GitHubAPI.getImportTypes();
                const candidates = [];
                for (const type of types) {
                    if (type === "stars") {
                        const repos = await GitHubAPI.fetchStarredRepos(settings.username, settings.token);
                        candidates.push(...UI.mapGitHubItemsToBookmarks(repos, "stars"));
                    } else if (type === "repos") {
                        const repos = await GitHubAPI.fetchUserRepos(settings.username, settings.token);
                        const ownRepos = repos.filter(r => !r.fork);
                        candidates.push(...UI.mapGitHubItemsToBookmarks(ownRepos, "repos"));
                    } else if (type === "forks") {
                        const forks = await GitHubAPI.fetchForkedRepos(settings.username, settings.token);
                        candidates.push(...UI.mapGitHubItemsToBookmarks(forks, "forks"));
                    } else if (type === "gists") {
                        const gists = await GitHubAPI.fetchUserGists(settings.username, settings.token);
                        candidates.push(...UI.mapGitHubItemsToBookmarks(gists, "gists"));
                    }
                }

                const newItems = candidates.filter(item => !UI.isBookmarkExported(item));
                if (newItems.length === 0) {
                    GitHubAutoImporter.updateStatus(`✅ 没有新的 GitHub 收藏 (${new Date().toLocaleTimeString()})`);
                    return;
                }

                const result = await UI.exportGitHubSelected(newItems, {
                    apiKey: settings.apiKey,
                    databaseId: settings.databaseId,
                }, (current, total, title) => {
                    GitHubAutoImporter.updateStatus(`📥 GitHub 自动导入中 (${current}/${total}): ${title}`);
                });

                GitHubAutoImporter.updateStatus(`✅ GitHub 自动导入完成: 成功 ${result.success.length} 个${result.failed.length > 0 ? `，失败 ${result.failed.length} 个` : ""} (${new Date().toLocaleTimeString()})`);
            } catch (error) {
                console.error("GitHub 自动导入出错:", error);
                GitHubAutoImporter.updateStatus(`❌ GitHub 自动导入出错: ${error.message}`);
            } finally {
                GitHubAutoImporter.isRunning = false;
            }
        },

        startPolling: (intervalMinutes) => {
            GitHubAutoImporter.stopPolling();
            if (intervalMinutes > 0) {
                GitHubAutoImporter.timerId = setInterval(() => GitHubAutoImporter.run(), intervalMinutes * 60 * 1000);
            }
        },

        stopPolling: () => {
            if (GitHubAutoImporter.timerId) {
                clearInterval(GitHubAutoImporter.timerId);
                GitHubAutoImporter.timerId = null;
            }
        },

        init: () => {
            if (!GitHubAutoImporter.canStart()) return;
            GitHubAutoImporter.ensureVisibilityListener();
            setTimeout(() => {
                GitHubAutoImporter.run();
                const interval = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.githubAutoImportInterval);
                if (interval > 0) GitHubAutoImporter.startPolling(interval);
            }, 3000);
        },
    };

    // ===========================================
    // GitHub API 模块
    // ===========================================
    const GitHubAPI = {
        _readmeCache: {},
        _fetchPaginated: (url, token = "", label = "GitHub") => {
            return new Promise((resolve, reject) => {
                const allItems = [];
                let page = 1;
                const perPage = 100;

                const fetchPage = () => {
                    const separator = url.includes("?") ? "&" : "?";
                    const pagedUrl = `${url}${separator}per_page=${perPage}&page=${page}`;

                    const headers = {
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "LD-Notion-UserScript",
                    };
                    if (token) headers["Authorization"] = `Bearer ${token}`;

                    GM_xmlhttpRequest({
                        method: "GET",
                        url: pagedUrl,
                        headers,
                        onload: (response) => {
                            if (response.status === 200) {
                                try {
                                    const items = JSON.parse(response.responseText);
                                    if (items.length === 0) return resolve(allItems);
                                    allItems.push(...items);
                                    if (items.length < perPage) return resolve(allItems);
                                    page++;
                                    setTimeout(fetchPage, 300);
                                } catch (e) {
                                    reject(new Error(`解析 ${label} 响应失败`));
                                }
                            } else if (response.status === 403) {
                                reject(new Error(`${label} API 速率限制，请稍后再试或配置 Token`));
                            } else if (response.status === 404) {
                                reject(new Error(`${label} 资源不存在`));
                            } else {
                                reject(new Error(`${label} API 错误: ${response.status}`));
                            }
                        },
                        onerror: () => reject(new Error(`网络错误，无法连接 ${label}`)),
                    });
                };

                fetchPage();
            });
        },

        // 获取用户 starred repos（带分页）
        fetchStarredRepos: (username, token = "") => {
            const url = token
                ? `https://api.github.com/user/starred`
                : `https://api.github.com/users/${encodeURIComponent(username)}/starred`;
            return GitHubAPI._fetchPaginated(url, token, "GitHub Stars");
        },

        // 获取用户自己的仓库
        fetchUserRepos: (username, token = "") => {
            const url = token
                ? `https://api.github.com/user/repos?type=owner&sort=updated`
                : `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated`;
            return GitHubAPI._fetchPaginated(url, token, "GitHub Repos");
        },

        // 获取用户 fork 的仓库
        fetchForkedRepos: async (username, token = "") => {
            const allRepos = await GitHubAPI.fetchUserRepos(username, token);
            return allRepos.filter(r => r.fork);
        },

        // 获取用户的 Gists
        fetchUserGists: (username, token = "") => {
            const url = token
                ? `https://api.github.com/gists`
                : `https://api.github.com/users/${encodeURIComponent(username)}/gists`;
            return GitHubAPI._fetchPaginated(url, token, "GitHub Gists");
        },

        // 获取已导出的 repo 集合
        getExported: () => {
            try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, "{}")); }
            catch { return {}; }
        },

        // 获取已导出的 gist 集合
        getExportedGists: () => {
            try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, "{}")); }
            catch { return {}; }
        },

        markExported: (repoFullName) => {
            const exported = GitHubAPI.getExported();
            exported[repoFullName] = Date.now();
            Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, JSON.stringify(exported));
        },

        markGistExported: (gistId) => {
            const exported = GitHubAPI.getExportedGists();
            exported[gistId] = Date.now();
            Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, JSON.stringify(exported));
        },

        isExported: (repoFullName) => {
            return !!GitHubAPI.getExported()[repoFullName];
        },

        isGistExported: (gistId) => {
            return !!GitHubAPI.getExportedGists()[gistId];
        },

        // 获取启用的导入类型
        getImportTypes: () => {
            try {
                return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_IMPORT_TYPES, CONFIG.DEFAULTS.githubImportTypes));
            } catch {
                return ["stars"];
            }
        },

        setImportTypes: (types) => {
            Storage.set(CONFIG.STORAGE_KEYS.GITHUB_IMPORT_TYPES, JSON.stringify(types));
        },

        fetchRepoReadme: (repoFullName, token = "") => {
            if (!repoFullName) return Promise.resolve("");
            const cacheKey = `${repoFullName}::${token ? "auth" : "anon"}`;
            if (Object.prototype.hasOwnProperty.call(GitHubAPI._readmeCache, cacheKey)) {
                return Promise.resolve(GitHubAPI._readmeCache[cacheKey]);
            }

            return new Promise((resolve) => {
                const headers = {
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "LD-Notion-UserScript",
                };
                if (token) headers["Authorization"] = `Bearer ${token}`;

                GM_xmlhttpRequest({
                    method: "GET",
                    url: `https://api.github.com/repos/${repoFullName}/readme`,
                    headers,
                    onload: (response) => {
                        if (response.status === 200) {
                            try {
                                const data = JSON.parse(response.responseText || "{}");
                                const decoded = Utils.base64DecodeUnicode(data.content || "");
                                const text = String(decoded || "").replace(/\r\n/g, "\n");
                                GitHubAPI._readmeCache[cacheKey] = text;
                                resolve(text);
                                return;
                            } catch {
                                GitHubAPI._readmeCache[cacheKey] = "";
                                resolve("");
                                return;
                            }
                        }
                        GitHubAPI._readmeCache[cacheKey] = "";
                        resolve("");
                    },
                    onerror: () => {
                        GitHubAPI._readmeCache[cacheKey] = "";
                        resolve("");
                    },
                });
            });
        },
    };

    // ===========================================
    // GitHub 导出到 Notion 模块
    // ===========================================
    const GitHubExporter = {
        normalizeText: (text, maxLen = 280) => {
            if (!text) return "";
            const normalized = String(text).replace(/\s+/g, " ").trim();
            return normalized.substring(0, maxLen);
        },

        composeTitleWithPrefix: (prefix, candidate, maxLen = 180) => {
            const safePrefix = GitHubExporter.normalizeText(prefix, maxLen);
            const safeCandidate = GitHubExporter.normalizeText(candidate, maxLen);
            if (!safePrefix) return safeCandidate || "无标题";
            if (!safeCandidate || safeCandidate === safePrefix) return safePrefix;
            if (safeCandidate.startsWith(`${safePrefix} - `) || safeCandidate.startsWith(`${safePrefix} · `)) {
                return safeCandidate.substring(0, maxLen);
            }
            return `${safePrefix} · ${safeCandidate}`.substring(0, maxLen);
        },

        extractReadmeInsight: (readmeText = "") => {
            const text = String(readmeText || "").replace(/\r\n/g, "\n");
            if (!text) return { title: "", summary: "" };

            const headingMatch = text.match(/^#{1,3}\s+(.+)$/m);
            const title = GitHubExporter.normalizeText(headingMatch?.[1] || "", 120);

            const lines = text
                .split("\n")
                .map(line => line.trim())
                .filter(line => line && !line.startsWith("#") && !line.startsWith("```"));
            const summary = GitHubExporter.normalizeText(lines.slice(0, 8).join(" "), 320);

            return { title, summary };
        },

        inferRepoCategoryHeuristic: (repo, insight, categories = []) => {
            const available = (categories || []).map(c => String(c || "").trim()).filter(Boolean);
            if (available.length === 0) return "";

            const text = `${repo.full_name || ""} ${repo.name || ""} ${repo.description || ""} ${(repo.topics || []).join(" ")} ${repo.language || ""} ${insight.title || ""} ${insight.summary || ""}`.toLowerCase();
            for (const cat of available) {
                if (text.includes(cat.toLowerCase())) return cat;
            }

            const rules = [
                { keys: ["llm", "openai", "anthropic", "prompt", "rag", "ai", "agent"], hints: ["ai", "人工智能"] },
                { keys: ["react", "vue", "next", "svelte", "frontend", "ui", "css", "tailwind"], hints: ["前端", "ui"] },
                { keys: ["node", "express", "fastapi", "backend", "server", "api", "spring"], hints: ["后端", "服务端", "api"] },
                { keys: ["devops", "docker", "kubernetes", "k8s", "terraform", "ci", "cd"], hints: ["运维", "devops"] },
                { keys: ["docs", "guide", "tutorial", "awesome", "resource", "学习", "教程"], hints: ["文档", "资源", "学习"] },
            ];

            for (const rule of rules) {
                if (!rule.keys.some(k => text.includes(k))) continue;
                const matched = available.find(cat => rule.hints.some(h => cat.toLowerCase().includes(h.toLowerCase())));
                if (matched) return matched;
            }

            const fallback = available.find(cat => cat.includes("其他"));
            return fallback || available[available.length - 1];
        },

        inferRepoTags: (repo, insight) => {
            const tags = [];
            const pushTag = (value) => {
                const clean = GitHubExporter.normalizeText(value, 80);
                if (!clean) return;
                if (tags.includes(clean)) return;
                tags.push(clean);
            };

            (repo.topics || []).forEach(pushTag);
            pushTag(repo.language || "");

            const owner = String(repo.full_name || "").split("/")[0] || "";
            pushTag(owner);

            const lowerText = `${insight.title || ""} ${insight.summary || ""}`.toLowerCase();
            const keywordTags = ["ai", "llm", "rag", "agent", "react", "vue", "nextjs", "nodejs", "python", "rust", "go", "docker", "kubernetes", "notion", "github", "automation"];
            keywordTags.forEach((kw) => {
                if (lowerText.includes(kw)) pushTag(kw);
            });

            return tags.slice(0, 20);
        },

        generateAIRepoCategory: async (repo, insight, settings) => {
            const categories = Array.isArray(settings?.categories) ? settings.categories.filter(Boolean) : [];
            if (!settings?.aiApiKey || !settings?.aiService || categories.length === 0) return "";

            try {
                return await AIService.classify(
                    `${repo.full_name || repo.name || ""} ${insight.title || ""}`,
                    `${repo.description || ""}\n${insight.summary || ""}`,
                    categories,
                    settings
                );
            } catch {
                return "";
            }
        },

        enrichRepo: async (repo, settings, context = {}) => {
            const enriched = { ...repo };
            const prefix = GitHubExporter.normalizeText(repo.full_name || repo.name || "", 120) || "无标题";
            let insight = { title: "", summary: "" };

            try {
                const readme = await GitHubAPI.fetchRepoReadme(repo.full_name, settings?.token || "");
                insight = GitHubExporter.extractReadmeInsight(readme);
            } catch {
                insight = { title: "", summary: "" };
            }

            const defaultSuffix = insight.title || GitHubExporter.normalizeText(repo.description || "", 80);
            enriched.generatedTitle = GitHubExporter.composeTitleWithPrefix(prefix, defaultSuffix, 180);

            let inferredCategory = GitHubExporter.inferRepoCategoryHeuristic(repo, insight, settings?.categories || []);
            const canUseAI = !!(settings?.aiApiKey && settings?.aiService);
            const aiMaxItems = Number.isFinite(context.aiMaxItems) ? context.aiMaxItems : 20;
            if (canUseAI && (context.aiUsedCount || 0) < aiMaxItems) {
                const aiCategory = await GitHubExporter.generateAIRepoCategory(repo, insight, settings);
                if (aiCategory) inferredCategory = aiCategory;
                context.aiUsedCount = (context.aiUsedCount || 0) + 1;
            }

            enriched.inferredCategory = inferredCategory;
            enriched.inferredTags = GitHubExporter.inferRepoTags(repo, insight);
            enriched.readmeSummary = GitHubExporter.normalizeText(insight.summary || "", 1000);
            return enriched;
        },

        // 构建 Notion 数据库属性 (repos/stars/forks)
        buildRepoProperties: (repo, sourceType = "Star") => {
            const titlePrefix = GitHubExporter.normalizeText(repo.full_name || repo.name || "无标题", 120) || "无标题";
            const titleContent = GitHubExporter.composeTitleWithPrefix(titlePrefix, repo.generatedTitle || "", 2000);
            const summaryText = GitHubExporter.normalizeText(repo.readmeSummary || "", 1600);
            const descCandidate = GitHubExporter.normalizeText(repo.description || "", 1200);
            const description = [descCandidate, summaryText].filter(Boolean).join("\n\n").substring(0, 2000);
            const props = {
                "标题": {
                    title: [{ text: { content: titleContent } }]
                },
                "链接": {
                    url: repo.html_url
                },
                "描述": {
                    rich_text: [{ text: { content: description } }]
                },
                "语言": {
                    rich_text: [{ text: { content: repo.language || "" } }]
                },
                "Stars": {
                    number: repo.stargazers_count || 0
                },
                "来源": {
                    rich_text: [{ text: { content: "GitHub" } }]
                },
                "来源类型": {
                    rich_text: [{ text: { content: sourceType } }]
                },
            };
            const topicTags = Array.isArray(repo.topics) ? repo.topics.slice(0, 20) : [];
            const inferredTags = Array.isArray(repo.inferredTags) ? repo.inferredTags : [];
            const mergedTags = [];
            [...topicTags, ...inferredTags].forEach((tag) => {
                const clean = GitHubExporter.normalizeText(tag, 100);
                if (!clean) return;
                if (mergedTags.includes(clean)) return;
                mergedTags.push(clean);
            });
            if (mergedTags.length > 0) {
                props["标签"] = {
                    multi_select: mergedTags.slice(0, 20).map(t => ({ name: t }))
                };
            }
            if (repo.inferredCategory) {
                props["分类"] = {
                    rich_text: [{ text: { content: GitHubExporter.normalizeText(repo.inferredCategory, 300) } }]
                };
            }
            if (repo.pushed_at) {
                props["更新时间"] = { date: { start: repo.pushed_at } };
            }
            return props;
        },

        // 构建 Gist 属性
        buildGistProperties: (gist) => {
            const files = Object.keys(gist.files || {});
            const title = gist.description || files[0] || "无标题 Gist";
            const language = gist.files?.[files[0]]?.language || "";
            return {
                "标题": {
                    title: [{ text: { content: title.substring(0, 2000) } }]
                },
                "链接": {
                    url: gist.html_url
                },
                "描述": {
                    rich_text: [{ text: { content: `文件: ${files.join(", ")}`.substring(0, 2000) } }]
                },
                "语言": {
                    rich_text: [{ text: { content: language } }]
                },
                "Stars": {
                    number: 0
                },
                "来源": {
                    rich_text: [{ text: { content: "GitHub" } }]
                },
                "来源类型": {
                    rich_text: [{ text: { content: "Gist" } }]
                },
                "更新时间": gist.updated_at ? { date: { start: gist.updated_at } } : undefined,
            };
        },

        // 向后兼容：原 buildProperties 映射到 buildRepoProperties
        buildProperties: (repo) => GitHubExporter.buildRepoProperties(repo, "Star"),

        // 配置数据库属性结构
        setupDatabaseProperties: async (databaseId, apiKey) => {
            const requiredProperties = {
                "标题": { typeName: "title", schema: { title: {} } },
                "链接": { typeName: "url", schema: { url: {} } },
                "描述": { typeName: "rich_text", schema: { rich_text: {} } },
                "语言": { typeName: "rich_text", schema: { rich_text: {} } },
                "Stars": { typeName: "number", schema: { number: { format: "number" } } },
                "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
                "来源": { typeName: "rich_text", schema: { rich_text: {} } },
                "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
                "更新时间": { typeName: "date", schema: { date: {} } },
                "分类": { typeName: "rich_text", schema: { rich_text: {} } },
            };

            try {
                const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
                const existingProps = database.properties || {};
                const propsToAdd = {};
                const propsToUpdate = {};
                const typeConflicts = [];

                for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                    const existingProp = existingProps[name];
                    if (!existingProp) {
                        if (typeName === "title") {
                            // 特殊处理：title 属性需要重命名现有的
                            const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                            if (existingTitle && existingTitle[0] !== name) {
                                propsToUpdate[existingTitle[0]] = { name: name };
                            }
                        } else {
                            propsToAdd[name] = schema;
                        }
                    } else if (existingProp.type !== typeName) {
                        typeConflicts.push({ name, expected: typeName, actual: existingProp.type });
                    }
                }

                if (typeConflicts.length > 0) {
                    const details = typeConflicts.map(c => `"${c.name}": 期望 ${c.expected}，实际 ${c.actual}`).join("; ");
                    return { success: false, error: `属性类型不匹配: ${details}。请手动修改这些属性的类型。` };
                }

                const allChanges = { ...propsToAdd, ...propsToUpdate };
                if (Object.keys(allChanges).length > 0) {
                    await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                        properties: allChanges,
                    }, apiKey);
                }

                return { success: true, added: Object.keys(propsToAdd), renamed: Object.keys(propsToUpdate) };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },

        // 通用导出方法
        _exportItems: async (items, settings, sourceType, buildFn, isExportedFn, markExportedFn, getKeyFn, onProgress) => {
            const { apiKey, databaseId } = settings;
            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

            const newItems = items.filter(item => !isExportedFn(getKeyFn(item)));
            if (newItems.length === 0) {
                return { total: items.length, exported: 0, failed: 0, message: `没有新的 ${sourceType} 需要导出` };
            }

            let success = 0, failed = 0;
            const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };
            for (let i = 0; i < newItems.length; i++) {
                const item = newItems[i];
                const key = getKeyFn(item);
                const pct = Math.round(10 + (i / newItems.length) * 85);
                if (onProgress) onProgress(`正在导出 ${sourceType} (${i + 1}/${newItems.length}): ${key}`, pct);

                try {
                    const enriched = sourceType === "Gist" ? item : await GitHubExporter.enrichRepo(item, settings, enrichContext);
                    const properties = buildFn(enriched);
                    // 清理 undefined 属性
                    for (const k of Object.keys(properties)) {
                        if (properties[k] === undefined) delete properties[k];
                    }
                    await NotionAPI.request("POST", "/pages", {
                        parent: { database_id: databaseId },
                        properties,
                    }, apiKey);
                    markExportedFn(key);
                    success++;
                } catch (e) {
                    console.warn(`[GitHubExporter] 导出失败: ${key}`, e);
                    failed++;
                }

                if (i < newItems.length - 1) {
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            return { total: items.length, exported: success, failed, newCount: newItems.length };
        },

        // 导出 stars 到 Notion
        exportStars: async (settings, onProgress) => {
            const { apiKey, databaseId, username, token } = settings;

            if (!apiKey || !databaseId || !username) {
                throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
            }

            if (onProgress) onProgress("正在配置数据库结构...", 0);
            const setupResult = await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);
            if (!setupResult.success) {
                throw new Error(`数据库配置失败: ${setupResult.error}`);
            }

            if (onProgress) onProgress("正在获取 GitHub Stars...", 5);
            const repos = await GitHubAPI.fetchStarredRepos(username, token);

            return GitHubExporter._exportItems(
                repos, settings, "Star",
                (r) => GitHubExporter.buildRepoProperties(r, "Star"),
                GitHubAPI.isExported, GitHubAPI.markExported,
                (r) => r.full_name, onProgress
            );
        },

        // 导出用户仓库到 Notion
        exportRepos: async (settings, onProgress) => {
            const { apiKey, databaseId, username, token } = settings;

            if (!apiKey || !databaseId || !username) {
                throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
            }

            if (onProgress) onProgress("正在配置数据库结构...", 0);
            await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

            if (onProgress) onProgress("正在获取 GitHub Repos...", 5);
            const repos = await GitHubAPI.fetchUserRepos(username, token);
            const ownRepos = repos.filter(r => !r.fork);

            return GitHubExporter._exportItems(
                ownRepos, settings, "Repo",
                (r) => GitHubExporter.buildRepoProperties(r, "Repo"),
                GitHubAPI.isExported, GitHubAPI.markExported,
                (r) => r.full_name, onProgress
            );
        },

        // 导出 fork 的仓库到 Notion
        exportForks: async (settings, onProgress) => {
            const { apiKey, databaseId, username, token } = settings;

            if (!apiKey || !databaseId || !username) {
                throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
            }

            if (onProgress) onProgress("正在配置数据库结构...", 0);
            await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

            if (onProgress) onProgress("正在获取 GitHub Forks...", 5);
            const forks = await GitHubAPI.fetchForkedRepos(username, token);

            return GitHubExporter._exportItems(
                forks, settings, "Fork",
                (r) => GitHubExporter.buildRepoProperties(r, "Fork"),
                GitHubAPI.isExported, GitHubAPI.markExported,
                (r) => r.full_name, onProgress
            );
        },

        // 导出 Gists 到 Notion
        exportGists: async (settings, onProgress) => {
            const { apiKey, databaseId, username, token } = settings;

            if (!apiKey || !databaseId || !username) {
                throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
            }

            if (onProgress) onProgress("正在配置数据库结构...", 0);
            await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

            if (onProgress) onProgress("正在获取 GitHub Gists...", 5);
            const gists = await GitHubAPI.fetchUserGists(username, token);

            return GitHubExporter._exportItems(
                gists, settings, "Gist",
                GitHubExporter.buildGistProperties,
                GitHubAPI.isGistExported, GitHubAPI.markGistExported,
                (g) => g.id, onProgress
            );
        },

        // 按用户选择的类型批量导出
        exportAll: async (settings, onProgress) => {
            const types = GitHubAPI.getImportTypes();
            const results = {};
            const totalTypes = types.length;
            let typeIndex = 0;

            for (const type of types) {
                const typeProgress = (msg, pct) => {
                    const overallPct = Math.round((typeIndex / totalTypes) * 100 + pct / totalTypes);
                    if (onProgress) onProgress(`[${type}] ${msg}`, overallPct);
                };

                try {
                    switch (type) {
                        case "stars":
                            results.stars = await GitHubExporter.exportStars(settings, typeProgress);
                            break;
                        case "repos":
                            results.repos = await GitHubExporter.exportRepos(settings, typeProgress);
                            break;
                        case "forks":
                            results.forks = await GitHubExporter.exportForks(settings, typeProgress);
                            break;
                        case "gists":
                            results.gists = await GitHubExporter.exportGists(settings, typeProgress);
                            break;
                    }
                } catch (e) {
                    results[type] = { error: e.message };
                }
                typeIndex++;
            }

            return results;
        },

        // AI 分类已导出的 GitHub repos
        classifyRepos: async (settings, onProgress) => {
            const { apiKey, databaseId, aiApiKey, aiService, aiModel, aiBaseUrl, categories } = settings;

            if (!apiKey || !databaseId) throw new Error("请先配置 Notion 数据库");
            if (!aiApiKey) throw new Error("请先配置 AI API Key");

            if (onProgress) onProgress("正在获取待分类的仓库...", 0);

            // 查询数据库中未分类的条目
            const response = await NotionAPI.request("POST", `/databases/${databaseId}/query`, {
                filter: {
                    or: [
                        { property: "分类", rich_text: { is_empty: true } },
                        { property: "分类", rich_text: { equals: "" } },
                    ]
                },
                page_size: 100,
            }, apiKey);

            const pages = response.results || [];
            if (pages.length === 0) {
                return { classified: 0, message: "没有待分类的仓库" };
            }

            let classified = 0;
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                const pct = Math.round((i / pages.length) * 100);
                const title = page.properties?.["标题"]?.title?.[0]?.text?.content || "";
                const desc = page.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";
                const lang = page.properties?.["语言"]?.rich_text?.[0]?.text?.content || "";
                const tags = (page.properties?.["标签"]?.multi_select || []).map(t => t.name).join(", ");

                if (onProgress) onProgress(`正在分类 (${i + 1}/${pages.length}): ${title}`, pct);

                try {
                    const prompt = `请根据以下 GitHub 仓库信息，从这些分类中选择最合适的一个: [${categories.join(", ")}]

仓库名: ${title}
描述: ${desc}
语言: ${lang}
标签: ${tags}

只回复分类名，不要其他内容。`;

                    const category = await AIService.request(prompt, {
                        aiService, aiApiKey, aiModel: aiModel, aiBaseUrl,
                    });

                    const matched = categories.find(c => category.trim().includes(c)) || category.trim();

                    await NotionAPI.request("PATCH", `/pages/${page.id}`, {
                        properties: {
                            "分类": { rich_text: [{ text: { content: matched } }] },
                        },
                    }, apiKey);
                    classified++;
                } catch (e) {
                    console.warn(`[GitHubExporter] 分类失败: ${title}`, e);
                }

                await new Promise(r => setTimeout(r, 500));
            }

            return { classified, total: pages.length };
        },
    };

    // ===========================================
    // 浏览器书签桥接模块
    // ===========================================
    const BookmarkBridge = {
        _requestId: 0,
        _pendingRequests: {},

        // 检测配套 Chrome 扩展是否已安装
        isExtensionAvailable: () => {
            return !!document.querySelector('meta[name="ld-notion-ext"][content="ready"]');
        },

        // 发起书签请求
        _request: (eventName, detail = {}) => {
            return new Promise((resolve, reject) => {
                if (!BookmarkBridge.isExtensionAvailable()) {
                    const installUrl = InstallHelper.getBookmarkExtensionUrl();
                    reject(new Error(`未检测到 LD-Notion 书签桥接扩展。请先安装：${installUrl}`));
                    return;
                }

                const requestId = `req_${++BookmarkBridge._requestId}_${Date.now()}`;
                const timeout = setTimeout(() => {
                    delete BookmarkBridge._pendingRequests[requestId];
                    reject(new Error("书签请求超时，请检查扩展是否正常运行。"));
                }, 10000);

                BookmarkBridge._pendingRequests[requestId] = { resolve, reject, timeout };

                window.dispatchEvent(new CustomEvent(eventName, {
                    detail: { requestId, ...detail }
                }));
            });
        },

        // 获取书签树
        getBookmarkTree: () => {
            return BookmarkBridge._request("ld-notion-request-bookmarks");
        },

        // 获取指定文件夹的书签
        getBookmarks: (folderId) => {
            return BookmarkBridge._request("ld-notion-request-bookmarks", { folderId });
        },

        // 搜索书签
        searchBookmarks: (query) => {
            return BookmarkBridge._request("ld-notion-search-bookmarks", { query });
        },

        // 初始化响应监听器
        init: () => {
            window.addEventListener("ld-notion-bookmarks-data", (event) => {
                const { requestId, success, data, error } = event.detail || {};
                const pending = BookmarkBridge._pendingRequests[requestId];
                if (!pending) return;

                clearTimeout(pending.timeout);
                delete BookmarkBridge._pendingRequests[requestId];

                if (success) {
                    pending.resolve(data);
                } else {
                    pending.reject(new Error(error || "书签请求失败"));
                }
            });
        },
    };

    // ===========================================
    // 浏览器书签导出到 Notion 模块
    // ===========================================
    const BookmarkExporter = {
        _pageInsightCache: {},

        // 展平书签树为列表，记录文件夹路径
        flattenTree: (nodes, parentPath = "") => {
            const result = [];
            for (const node of nodes) {
                const currentPath = parentPath ? `${parentPath} / ${node.title}` : node.title;
                if (node.url) {
                    // 书签项
                    result.push({
                        title: node.title || node.url,
                        url: node.url,
                        folderPath: parentPath,
                        dateAdded: node.dateAdded ? new Date(node.dateAdded).toISOString() : null,
                        id: node.id,
                    });
                }
                if (node.children) {
                    result.push(...BookmarkExporter.flattenTree(node.children, currentPath));
                }
            }
            return result;
        },

        isHttpUrl: (url) => /^https?:\/\//i.test(url || ""),

        normalizeText: (text, maxLen = 280) => {
            if (!text) return "";
            const normalized = String(text)
                .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
                .replace(/\s+/g, " ")
                .trim();
            return normalized.substring(0, maxLen);
        },

        normalizeCharset: (charset) => {
            const value = String(charset || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();
            if (!value) return "";
            if (value === "utf8") return "utf-8";
            if (value === "gbk" || value === "gb2312") return "gb18030";
            if (value === "big-5") return "big5";
            if (value === "shift-jis" || value === "sjis") return "shift_jis";
            return value;
        },

        extractCharsetFromHeaders: (responseHeaders) => {
            const headers = String(responseHeaders || "");
            if (!headers) return "";
            const match = headers.match(/content-type\s*:\s*[^\r\n]*charset\s*=\s*([^\s;"']+)/i);
            return BookmarkExporter.normalizeCharset(match?.[1] || "");
        },

        extractCharsetFromHtmlHead: (bytes) => {
            if (!(bytes instanceof Uint8Array) || bytes.length === 0) return "";
            try {
                const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
                const charsetMatch = head.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'>/]+)/i);
                if (charsetMatch?.[1]) {
                    return BookmarkExporter.normalizeCharset(charsetMatch[1]);
                }
                const httpEquivMatch = head.match(/<meta[^>]+http-equiv\s*=\s*["']content-type["'][^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i);
                return BookmarkExporter.normalizeCharset(httpEquivMatch?.[1] || "");
            } catch {
                return "";
            }
        },

        getResponseBytes: (response) => {
            const raw = response?.response;
            if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
            if (raw instanceof Uint8Array) return raw;
            return null;
        },

        decodeHtmlFromResponse: (response) => {
            const fallbackText = String(response?.responseText || "");
            const bytes = BookmarkExporter.getResponseBytes(response);
            if (!bytes || bytes.length === 0) return fallbackText;

            const headerCharset = BookmarkExporter.extractCharsetFromHeaders(response?.responseHeaders || "");
            const htmlCharset = BookmarkExporter.extractCharsetFromHtmlHead(bytes);
            const candidates = [headerCharset, htmlCharset, "utf-8", "gb18030", "big5", "shift_jis"];
            const tried = new Set();
            let firstDecoded = "";

            for (const candidate of candidates) {
                const charset = BookmarkExporter.normalizeCharset(candidate);
                if (!charset || tried.has(charset)) continue;
                tried.add(charset);
                try {
                    const decoded = new TextDecoder(charset).decode(bytes);
                    if (!decoded) continue;
                    if (!firstDecoded) firstDecoded = decoded;
                    if (!decoded.includes("\uFFFD")) return decoded;
                } catch {
                    // ignore and continue trying next charset
                }
            }

            return firstDecoded || fallbackText;
        },

        composeTitleWithPrefix: (prefix, candidate, maxLen = 180) => {
            const safePrefix = BookmarkExporter.normalizeText(prefix, maxLen);
            const safeCandidate = BookmarkExporter.normalizeText(candidate, maxLen);
            if (!safePrefix) return safeCandidate || "无标题书签";
            if (!safeCandidate || safeCandidate === safePrefix) return safePrefix;
            if (safeCandidate.startsWith(`${safePrefix} - `) || safeCandidate.startsWith(`${safePrefix} · `)) {
                return safeCandidate.substring(0, maxLen);
            }
            return `${safePrefix} · ${safeCandidate}`.substring(0, maxLen);
        },

        extractPageInsightFromHtml: (html, url) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html || "", "text/html");
            const meta = (name) => {
                const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                return el?.getAttribute("content") || "";
            };

            doc.querySelectorAll("script, style, noscript, template").forEach((node) => node.remove());

            const title = BookmarkExporter.normalizeText(
                meta("og:title") ||
                doc.querySelector("title")?.textContent ||
                doc.querySelector("h1")?.textContent ||
                meta("twitter:title") ||
                ""
            , 180);

            const description = BookmarkExporter.normalizeText(
                meta("og:description") ||
                meta("description") ||
                meta("twitter:description") ||
                ""
            , 260);

            const bodyText = BookmarkExporter.normalizeText(doc.body?.textContent || "", 600);
            const summary = description || bodyText;

            return {
                title,
                summary,
                siteName: BookmarkExporter.normalizeText(meta("og:site_name") || "", 80),
                sourceUrl: url,
            };
        },

        fetchPageInsight: (url) => {
            const cached = BookmarkExporter._pageInsightCache[url];
            if (cached) return Promise.resolve(cached);

            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url,
                    timeout: 12000,
                    responseType: "arraybuffer",
                    headers: {
                        "Accept": "text/html,application/xhtml+xml",
                    },
                    onload: (response) => {
                        if (response.status < 200 || response.status >= 300) {
                            reject(new Error(`HTTP ${response.status}`));
                            return;
                        }
                        try {
                            const html = BookmarkExporter.decodeHtmlFromResponse(response);
                            const insight = BookmarkExporter.extractPageInsightFromHtml(html, url);
                            BookmarkExporter._pageInsightCache[url] = insight;
                            resolve(insight);
                        } catch (e) {
                            reject(e);
                        }
                    },
                    ontimeout: () => reject(new Error("页面读取超时")),
                    onerror: () => reject(new Error("页面读取失败")),
                });
            });
        },

        generateAISummary: async (bookmark, insight, settings) => {
            if (!settings?.aiApiKey || !settings?.aiService) return null;

            const prompt = `请根据以下网页信息生成书签标题和摘要，要求：\n1) 标题 30 字以内\n2) 摘要 90 字以内\n3) 使用中文\n4) 仅返回 JSON，不要其他内容\n\nJSON 格式：{"title":"...","summary":"..."}\n\n网页 URL：${bookmark.url}\n原始标题：${bookmark.title || ""}\n页面标题：${insight.title || ""}\n页面摘要：${insight.summary || ""}`;

            try {
                const response = await AIService.requestChat(prompt, settings, 220);
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (!jsonMatch) return null;
                const data = JSON.parse(jsonMatch[0]);
                return {
                    title: BookmarkExporter.normalizeText(data.title || "", 120),
                    summary: BookmarkExporter.normalizeText(data.summary || "", 180),
                };
            } catch {
                return null;
            }
        },

        inferCategoryHeuristic: (bookmark, insight, categories = []) => {
            const available = (categories || []).map(c => String(c || "").trim()).filter(Boolean);
            if (available.length === 0) return "";

            const text = `${bookmark.folderPath || ""} ${bookmark.title || ""} ${insight.title || ""} ${insight.summary || ""} ${bookmark.url || ""}`.toLowerCase();

            for (const cat of available) {
                if (text.includes(cat.toLowerCase())) {
                    return cat;
                }
            }

            const rules = [
                { keys: ["github", "gitlab", "repo", "docker", "k8s", "linux", "dev", "code", "programming", "技术", "开发", "编程"], hints: ["技术", "开发", "编程"] },
                { keys: ["news", "blog", "article", "文章", "博客", "资讯"], hints: ["分享", "资源"] },
                { keys: ["stack", "stackoverflow", "ask", "question", "qa", "问答", "问题"], hints: ["问答"] },
                { keys: ["life", "travel", "food", "movie", "music", "生活", "日常", "旅游", "美食"], hints: ["生活"] },
                { keys: ["resource", "docs", "tutorial", "guide", "文档", "教程", "手册", "资源"], hints: ["资源"] },
            ];

            for (const rule of rules) {
                if (!rule.keys.some(k => text.includes(k))) continue;
                const matched = available.find(cat => rule.hints.some(h => cat.includes(h)));
                if (matched) return matched;
            }

            const fallback = available.find(cat => cat.includes("其他"));
            return fallback || available[available.length - 1];
        },

        inferTags: (bookmark, insight) => {
            const tags = [];
            const host = (() => {
                try {
                    return new URL(bookmark.url).hostname.replace(/^www\./, "");
                } catch {
                    return "";
                }
            })();
            if (host) tags.push(host);

            if (bookmark.folderPath) {
                const firstFolder = BookmarkExporter.normalizeText(String(bookmark.folderPath).split("/")[0] || "", 40);
                if (firstFolder) tags.push(firstFolder);
            }

            if (insight.siteName) {
                tags.push(BookmarkExporter.normalizeText(insight.siteName, 40));
            }

            const uniq = [];
            for (const t of tags) {
                const clean = BookmarkExporter.normalizeText(t, 80);
                if (!clean) continue;
                if (uniq.includes(clean)) continue;
                uniq.push(clean);
                if (uniq.length >= 5) break;
            }
            return uniq;
        },

        generateAICategory: async (bookmark, insight, settings) => {
            const categories = Array.isArray(settings?.categories) ? settings.categories.filter(Boolean) : [];
            if (!settings?.aiApiKey || !settings?.aiService || categories.length === 0) return "";

            try {
                return await AIService.classify(
                    insight.title || bookmark.title || "",
                    insight.summary || "",
                    categories,
                    settings
                );
            } catch {
                return "";
            }
        },

        enrichBookmark: async (bookmark, settings, context = {}) => {
            const enriched = { ...bookmark };
            const prefix = BookmarkExporter.normalizeText(bookmark.title || "无标题书签", 120) || "无标题书签";
            const fallbackTitle = BookmarkExporter.composeTitleWithPrefix(prefix, "", 180);

            if (!BookmarkExporter.isHttpUrl(bookmark.url)) {
                enriched.generatedTitle = fallbackTitle;
                enriched.generatedSummary = "非网页链接，跳过页面摘要";
                enriched.inferredCategory = BookmarkExporter.inferCategoryHeuristic(bookmark, { title: "", summary: "" }, settings?.categories || []);
                enriched.inferredTags = BookmarkExporter.inferTags(bookmark, { siteName: "" });
                return enriched;
            }

            try {
                const insight = await BookmarkExporter.fetchPageInsight(bookmark.url);
                enriched.generatedTitle = BookmarkExporter.composeTitleWithPrefix(prefix, insight.title || "", 180);
                enriched.generatedSummary = insight.summary || "";

                let inferredCategory = BookmarkExporter.inferCategoryHeuristic(bookmark, insight, settings?.categories || []);
                enriched.inferredTags = BookmarkExporter.inferTags(bookmark, insight);

                const canUseAI = !!(settings?.aiApiKey && settings?.aiService);
                const aiMaxItems = Number.isFinite(context.aiMaxItems) ? context.aiMaxItems : 20;
                if (canUseAI && (context.aiUsedCount || 0) < aiMaxItems) {
                    const aiResult = await BookmarkExporter.generateAISummary(bookmark, insight, settings);
                    if (aiResult?.title) {
                        enriched.generatedTitle = BookmarkExporter.composeTitleWithPrefix(prefix, aiResult.title, 180);
                    }
                    if (aiResult?.summary) {
                        enriched.generatedSummary = aiResult.summary;
                    }
                    const aiCategory = await BookmarkExporter.generateAICategory(bookmark, insight, settings);
                    if (aiCategory) {
                        inferredCategory = aiCategory;
                    }
                    context.aiUsedCount = (context.aiUsedCount || 0) + 1;
                }
                enriched.inferredCategory = inferredCategory;
            } catch {
                enriched.generatedTitle = fallbackTitle;
                enriched.generatedSummary = "";
                enriched.inferredCategory = BookmarkExporter.inferCategoryHeuristic(bookmark, { title: "", summary: "" }, settings?.categories || []);
                enriched.inferredTags = BookmarkExporter.inferTags(bookmark, { siteName: "" });
            }

            return enriched;
        },

        // 构建 Notion 属性
        buildProperties: (bookmark) => {
            const title = BookmarkExporter.normalizeText(bookmark.generatedTitle || bookmark.title || "无标题书签", 2000) || "无标题书签";
            const summary = BookmarkExporter.normalizeText(bookmark.generatedSummary || "", 1900);

            const props = {
                "标题": {
                    title: [{ text: { content: title } }]
                },
                "链接": {
                    url: bookmark.url
                },
                "来源": {
                    rich_text: [{ text: { content: "浏览器书签" } }]
                },
                "来源类型": {
                    rich_text: [{ text: { content: "书签" } }]
                },
                "书签路径": {
                    rich_text: [{ text: { content: (bookmark.folderPath || "").substring(0, 2000) } }]
                },
            };
            if (summary) {
                props["描述"] = { rich_text: [{ text: { content: summary } }] };
            }
            if (bookmark.inferredCategory) {
                props["分类"] = {
                    rich_text: [{ text: { content: BookmarkExporter.normalizeText(bookmark.inferredCategory, 300) } }]
                };
            }
            const tags = Array.isArray(bookmark.inferredTags) ? bookmark.inferredTags : [];
            if (tags.length > 0) {
                props["标签"] = {
                    multi_select: tags
                        .map(tag => BookmarkExporter.normalizeText(tag, 100))
                        .filter(Boolean)
                        .map(name => ({ name }))
                        .slice(0, 8)
                };
            }
            if (bookmark.dateAdded) {
                props["收藏时间"] = { date: { start: bookmark.dateAdded } };
            }
            return props;
        },

        // 配置数据库属性
        setupDatabaseProperties: async (databaseId, apiKey) => {
            const requiredProperties = {
                "标题": { typeName: "title", schema: { title: {} } },
                "链接": { typeName: "url", schema: { url: {} } },
                "来源": { typeName: "rich_text", schema: { rich_text: {} } },
                "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
                "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
                "书签路径": { typeName: "rich_text", schema: { rich_text: {} } },
                "收藏时间": { typeName: "date", schema: { date: {} } },
                "分类": { typeName: "rich_text", schema: { rich_text: {} } },
                "描述": { typeName: "rich_text", schema: { rich_text: {} } },
            };

            try {
                const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
                const existingProps = database.properties || {};
                const propsToAdd = {};
                const propsToUpdate = {};

                for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                    const existingProp = existingProps[name];
                    if (!existingProp) {
                        if (typeName === "title") {
                            const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                            if (existingTitle && existingTitle[0] !== name) {
                                propsToUpdate[existingTitle[0]] = { name: name };
                            }
                        } else {
                            propsToAdd[name] = schema;
                        }
                    }
                }

                const allChanges = { ...propsToAdd, ...propsToUpdate };
                if (Object.keys(allChanges).length > 0) {
                    await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                        properties: allChanges,
                    }, apiKey);
                }

                return { success: true, added: Object.keys(propsToAdd) };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },

        // 获取已导出的书签集合
        getExported: () => {
            try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, "{}")); }
            catch { return {}; }
        },

        markExported: (bookmarkUrl) => {
            const exported = BookmarkExporter.getExported();
            exported[bookmarkUrl] = Date.now();
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_EXPORTED, JSON.stringify(exported));
        },

        isExported: (bookmarkUrl) => {
            return !!BookmarkExporter.getExported()[bookmarkUrl];
        },

        // 导出书签到 Notion
        exportBookmarks: async (settings, onProgress) => {
            const { apiKey, databaseId, bookmarks } = settings;

            if (!apiKey || !databaseId) {
                throw new Error("请先配置 Notion API Key 和数据库");
            }

            if (onProgress) onProgress("正在配置数据库结构...", 0);
            const setupResult = await BookmarkExporter.setupDatabaseProperties(databaseId, apiKey);
            if (!setupResult.success) {
                throw new Error(`数据库配置失败: ${setupResult.error}`);
            }

            // 过滤已导出的
            const dedupStrict = Utils.isBookmarkDedupStrict();
            const newBookmarks = dedupStrict
                ? bookmarks.filter(b => !BookmarkExporter.isExported(b.url))
                : bookmarks.slice();
            if (newBookmarks.length === 0) {
                return { total: bookmarks.length, exported: 0, message: "没有新的书签需要导出" };
            }

            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            let success = 0, failed = 0;
            const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };

            for (let i = 0; i < newBookmarks.length; i++) {
                const bm = newBookmarks[i];
                const pct = Math.round(5 + (i / newBookmarks.length) * 90);
                if (onProgress) onProgress(`正在导出 (${i + 1}/${newBookmarks.length}): ${bm.title}`, pct);

                try {
                    const enriched = await BookmarkExporter.enrichBookmark(bm, settings, enrichContext);
                    const properties = BookmarkExporter.buildProperties(enriched);
                    await NotionAPI.request("POST", "/pages", {
                        parent: { database_id: databaseId },
                        properties,
                    }, apiKey);
                    BookmarkExporter.markExported(bm.url);
                    success++;
                } catch (e) {
                    console.warn(`[BookmarkExporter] 导出失败: ${bm.url}`, e);
                    failed++;
                }

                if (i < newBookmarks.length - 1) {
                    await new Promise(r => setTimeout(r, delay));
                }
            }

            return { total: bookmarks.length, exported: success, failed, newCount: newBookmarks.length };
        },
    };

    // 初始化书签桥接
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
                const sourceToggle = UI.refs.sourceSettingsToggle || UI.panel.querySelector("#ldb-source-settings-toggle");
                const sourceContent = UI.refs.sourceSettingsContent || UI.panel.querySelector("#ldb-source-settings-content");
                const sourceArrow = UI.refs.sourceSettingsArrow || UI.panel.querySelector("#ldb-source-settings-arrow");
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
    // UI 设计系统（Design Tokens + 一次性样式注入）
    // ===========================================
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
            DesignSystem._theme = Storage.get(CONFIG.STORAGE_KEYS.THEME_PREFERENCE, "auto");
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

    // ===========================================
    // 面板拉伸工具
    // ===========================================
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
                    } catch (e) {}
                }
            }
        },
    };

    // ===========================================
    // Notion 站点 UI 模块
    // ===========================================
    const NotionSiteUI = {
        panel: null,
        floatBtn: null,
        isMinimized: true,

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

            document.addEventListener("mousemove", (e) => {
                if (!isDragging) return;
                hasMoved = true;
                const x = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, e.clientX - offsetX));
                const y = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, e.clientY - offsetY));
                btn.style.left = x + "px";
                btn.style.top = y + "px";
                btn.style.right = "auto";
                btn.style.bottom = "auto";
            });

            document.addEventListener("mouseup", () => {
                if (!isDragging) return;
                isDragging = false;
                btn.classList.remove("dragging");
                document.body.style.userSelect = "";
                if (hasMoved) {
                    // 保存位置
                    const rect = btn.getBoundingClientRect();
                    const right = window.innerWidth - rect.right;
                    const bottom = window.innerHeight - rect.bottom;
                    Storage.set(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION, JSON.stringify({ right: right + "px", bottom: bottom + "px" }));
                }
            });

            btn.addEventListener("click", (e) => {
                if (hasMoved) {
                    // 拖拽结束，不触发点击
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                NotionSiteUI.togglePanel();
            });

            // 恢复保存的位置
            const savedPosition = Storage.get(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION, null);
            if (savedPosition) {
                try {
                    const pos = JSON.parse(savedPosition);
                    btn.style.right = pos.right || "24px";
                    btn.style.bottom = pos.bottom || "24px";
                } catch (e) {}
            }

            document.body.appendChild(btn);
            NotionSiteUI.floatBtn = btn;
            return btn;
        },

        // 创建面板
        createPanel: () => {
            const panel = document.createElement("div");
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
                        <div class="ldb-chat-welcome">
                            <div class="ldb-chat-welcome-icon">🤖</div>
                            <div class="ldb-chat-welcome-text">
                                你好！我是 ${Utils.escapeHtml(Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName))}<br>
                                <small>试试下面的快捷命令</small>
                            </div>
                            <div class="ldb-chat-chips">
                                <button class="ldb-chat-chip" data-cmd="帮助">💡 帮助</button>
                                <button class="ldb-chat-chip" data-cmd="搜索">🔍 搜索</button>
                                <button class="ldb-chat-chip" data-cmd="自动分类">📂 自动分类</button>
                                <button class="ldb-chat-chip" data-cmd="总结">📝 总结</button>
                                <button class="ldb-chat-chip" data-cmd="导入GitHub收藏">🐙 GitHub</button>
                            <button class="ldb-chat-chip" data-cmd="导入浏览器书签">📖 书签</button>
                            </div>
                        </div>
                    </div>

                    <!-- 输入区域 -->
                    <div class="ldb-chat-input-container">
                        <textarea
                            id="ldb-chat-input"
                            class="ldb-chat-input"
                            placeholder="输入指令，如「搜索 Docker」或「自动分类」..."
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
                        <div class="ldb-input-group" style="margin-top: 12px;">
                            <label class="ldb-label">Notion API Key</label>
                            <input type="password" class="ldb-input" id="ldb-notion-api-key" placeholder="secret_xxx...">
                        </div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">数据库 / 页面</label>
                            <div style="display: flex; gap: 8px;">
                                <select class="ldb-select" id="ldb-notion-ai-target-db" style="flex: 1;">
                                    <option value="">未选择</option>
                                    <option value="__all__">所有工作区数据库</option>
                                </select>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-refresh-workspace" style="padding: 6px 12px; white-space: nowrap;" title="刷新工作区列表">🔄</button>
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
                            <div style="display: flex; gap: 8px;">
                                <select class="ldb-select" id="ldb-notion-ai-model" style="flex: 1;"></select>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-ai-fetch-models" style="padding: 6px 12px; white-space: nowrap;">🔄 获取</button>
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
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ldb-ui-border);">
                            <span style="font-size: 12px; color: var(--ldb-ui-muted);">🤖 Agent 个性化</span>
                        </div>
                        <div class="ldb-input-group" style="margin-top: 8px;">
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
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ldb-ui-border);">
                            <span style="font-size: 12px; color: var(--ldb-ui-muted);">🐙 GitHub 收藏导入</span>
                        </div>
                        <div class="ldb-input-group" style="margin-top: 8px;">
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
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ldb-ui-border);">
                            <span style="font-size: 12px; color: var(--ldb-ui-muted);">📖 浏览器书签导入</span>
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

        // 切换面板显示
        togglePanel: () => {
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
            panel.querySelector("#ldb-notion-save-settings").onclick = () => {
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, panel.querySelector("#ldb-notion-api-key").value.trim());
                const targetDbValue = panel.querySelector("#ldb-notion-ai-target-db").value;
                Storage.set(CONFIG.STORAGE_KEYS.AI_TARGET_DB, targetDbValue);
                if (targetDbValue && targetDbValue !== "__all__" && !targetDbValue.startsWith("page:")) {
                    Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, targetDbValue);
                }
                Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, panel.querySelector("#ldb-notion-ai-service").value);
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, panel.querySelector("#ldb-notion-ai-model").value);
                Storage.set(CONFIG.STORAGE_KEYS.AI_API_KEY, panel.querySelector("#ldb-notion-ai-api-key").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.AI_BASE_URL, panel.querySelector("#ldb-notion-ai-base-url").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORIES, panel.querySelector("#ldb-notion-ai-categories").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, parseInt(panel.querySelector("#ldb-notion-workspace-max-pages").value) || 0);
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, panel.querySelector("#ldb-notion-persona-name").value.trim() || CONFIG.DEFAULTS.agentPersonaName);
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, panel.querySelector("#ldb-notion-persona-tone").value);
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, panel.querySelector("#ldb-notion-persona-expertise").value.trim() || CONFIG.DEFAULTS.agentPersonaExpertise);
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, panel.querySelector("#ldb-notion-persona-instructions").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, panel.querySelector("#ldb-notion-github-username").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, panel.querySelector("#ldb-notion-github-token").value.trim());
                // 保存 GitHub 导入类型
                const githubTypes = [...panel.querySelectorAll(".ldb-notion-github-type:checked")].map(cb => cb.value);
                GitHubAPI.setImportTypes(githubTypes.length > 0 ? githubTypes : ["stars"]);

                NotionSiteUI.showStatus("设置已保存", "success");
            };

            // 刷新数据库列表（合并后的唯一刷新按钮）
            panel.querySelector("#ldb-notion-refresh-workspace").onclick = async () => {
                const apiKey = panel.querySelector("#ldb-notion-api-key").value.trim();
                const refreshBtn = panel.querySelector("#ldb-notion-refresh-workspace");
                const workspaceTip = panel.querySelector("#ldb-notion-workspace-tip");

                if (!apiKey) {
                    NotionSiteUI.showStatus("请先填写 Notion API Key", "error");
                    return;
                }

                refreshBtn.disabled = true;
                refreshBtn.innerHTML = "⏳";
                workspaceTip.style.color = "";
                workspaceTip.textContent = "正在获取数据库列表...";

                try {
                    const workspace = await WorkspaceService.fetchWorkspaceStaged(apiKey, {
                        includePages: true,
                        onProgress: (progress) => {
                            if (progress.phase === "databases") {
                                workspaceTip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                            } else if (progress.phase === "pages") {
                                workspaceTip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                            }
                        },
                        onPhaseComplete: (phase, partialWorkspace) => {
                            const workspaceData = {
                                apiKeyHash: apiKey.slice(-8),
                                databases: partialWorkspace.databases || [],
                                pages: partialWorkspace.pages || [],
                                timestamp: Date.now(),
                            };
                            Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));
                            NotionSiteUI.updateAITargetDbOptions(workspaceData.databases, workspaceData.pages);

                            if (phase === "databases") {
                                workspaceTip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                                workspaceTip.style.color = "#34d399";
                            }
                        },
                    });

                    const workspaceData = {
                        apiKeyHash: apiKey.slice(-8),
                        databases: workspace.databases,
                        pages: workspace.pages,
                        timestamp: Date.now(),
                    };
                    Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));

                    NotionSiteUI.updateAITargetDbOptions(workspace.databases, workspace.pages);
                    workspaceTip.textContent = `✅ 获取到 ${workspace.databases.length} 个数据库，${workspace.pages.length} 个页面`;
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
                const value = e.target.value;
                if (value && value !== "__all__") {
                    Storage.set(CONFIG.STORAGE_KEYS.AI_TARGET_DB, value);
                    // 选中数据库 → 同时保存 NOTION_DATABASE_ID；选中页面 → 不覆盖
                    if (!value.startsWith("page:")) {
                        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, value);
                    }
                } else if (value === "__all__") {
                    Storage.set(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "__all__");
                } else {
                    Storage.set(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");
                }
            };

            // AI 服务切换 - 更新模型列表并保存（优先使用缓存）
            panel.querySelector("#ldb-notion-ai-service").onchange = (e) => {
                const newService = e.target.value;
                Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, newService);
                // 优先使用缓存的模型列表
                const cachedModels = Storage.get(CONFIG.STORAGE_KEYS.FETCHED_MODELS, "{}");
                try {
                    const modelsData = JSON.parse(cachedModels);
                    if (modelsData[newService]?.models?.length > 0) {
                        NotionSiteUI.updateAIModelOptions(newService, modelsData[newService].models);
                    } else {
                        NotionSiteUI.updateAIModelOptions(newService);
                    }
                } catch {
                    NotionSiteUI.updateAIModelOptions(newService);
                }
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
                const aiApiKey = panel.querySelector("#ldb-notion-ai-api-key").value.trim();
                const aiService = panel.querySelector("#ldb-notion-ai-service").value;
                const aiBaseUrl = panel.querySelector("#ldb-notion-ai-base-url").value.trim();
                const fetchBtn = panel.querySelector("#ldb-notion-ai-fetch-models");
                const modelTip = panel.querySelector("#ldb-notion-ai-model-tip");

                if (!aiApiKey) {
                    NotionSiteUI.showStatus("请先填写 AI API Key", "error");
                    return;
                }

                fetchBtn.disabled = true;
                fetchBtn.innerHTML = "⏳ 获取中...";
                modelTip.textContent = "";

                try {
                    const models = await AIService.fetchModels(aiService, aiApiKey, aiBaseUrl);
                    NotionSiteUI.updateAIModelOptions(aiService, models, true);
                    // 持久化保存获取的模型列表
                    const cachedModels = Storage.get(CONFIG.STORAGE_KEYS.FETCHED_MODELS, "{}");
                    const modelsData = JSON.parse(cachedModels);
                    modelsData[aiService] = { models, timestamp: Date.now() };
                    Storage.set(CONFIG.STORAGE_KEYS.FETCHED_MODELS, JSON.stringify(modelsData));
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
        },

        // 加载配置
        loadConfig: () => {
            const panel = NotionSiteUI.panel;

            panel.querySelector("#ldb-notion-api-key").value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            panel.querySelector("#ldb-notion-ai-service").value = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
            panel.querySelector("#ldb-notion-ai-api-key").value = Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "");
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
            panel.querySelector("#ldb-notion-github-token").value = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
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
            } catch {}
            NotionSiteUI.updateAITargetDbOptions(cachedDatabases, cachedPages);

            // 加载 AI 模型选项（优先使用缓存的模型列表）
            const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
            const cachedModels = Storage.get(CONFIG.STORAGE_KEYS.FETCHED_MODELS, "{}");
            try {
                const modelsData = JSON.parse(cachedModels);
                if (modelsData[aiService]?.models?.length > 0) {
                    NotionSiteUI.updateAIModelOptions(aiService, modelsData[aiService].models);
                } else {
                    NotionSiteUI.updateAIModelOptions(aiService);
                }
            } catch {
                NotionSiteUI.updateAIModelOptions(aiService);
            }

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
                } catch (e) {}
            }

        },

        // 更新数据库/页面下拉框
        updateAITargetDbOptions: (databases, pages = []) => {
            const select = NotionSiteUI.panel.querySelector("#ldb-notion-ai-target-db");
            if (!select) return;

            const savedValue = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");
            const savedDbId = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");

            let options = '<option value="">未选择</option>';
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
                    options += `<option value="${val}">📄 ${Utils.escapeHtml(page.title)}</option>`;
                });
                options += '</optgroup>';
            }

            // 如果已保存的值不在列表中，添加一个兼容选项
            const activeId = savedValue || savedDbId;
            if (activeId && activeId !== "__all__" && !knownIds.has(activeId)) {
                options += `<option value="${activeId}">已配置 (ID: ${activeId.slice(0, 8)}...)</option>`;
            }

            select.innerHTML = options;

            // 恢复选中值：优先 AI_TARGET_DB，其次兼容 NOTION_DATABASE_ID
            const restoreId = savedValue || savedDbId;
            if (restoreId) {
                select.value = restoreId;
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

        // 初始化 AI 助手模块（复用 AIAssistant）
        initAIAssistant: () => {
            // 重写 getSettings 以适配 Notion 站点 UI
            const originalGetSettings = AIAssistant.getSettings;
            AIAssistant.getSettings = () => {
                // 优先使用 Notion 站点 UI 的输入框（如果存在）
                const notionPanel = NotionSiteUI.panel;
                if (notionPanel) {
                    const aiService = notionPanel.querySelector("#ldb-notion-ai-service")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
                    const selectedModel = notionPanel.querySelector("#ldb-notion-ai-model")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");

                    // 如果没有选择模型，使用默认模型
                    const provider = AIService.PROVIDERS[aiService];
                    const aiModel = selectedModel || provider?.defaultModel || "";

                    return {
                        notionApiKey: notionPanel.querySelector("#ldb-notion-api-key")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""),
                        notionDatabaseId: (() => {
                            const targetDb = notionPanel.querySelector("#ldb-notion-ai-target-db")?.value || "";
                            if (targetDb && targetDb !== "__all__" && !targetDb.startsWith("page:")) return targetDb;
                            return Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
                        })(),
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
                return originalGetSettings();
            };
        },

        // 初始化
        init: () => {
            NotionSiteUI.injectStyles();
            NotionSiteUI.createFloatButton();
            NotionSiteUI.createPanel();
            NotionSiteUI.bindEvents();
            NotionSiteUI.loadConfig();
            NotionSiteUI.initAIAssistant();

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

            // 检查是否需要展开
            if (!Storage.get(CONFIG.STORAGE_KEYS.NOTION_PANEL_MINIMIZED, true)) {
                NotionSiteUI.isMinimized = false;
                NotionSiteUI.panel.classList.add("visible");
            }
        },
    };

    // ===========================================
    // UI 组件
    // ===========================================
    const UI = {
        panel: null,
        miniBtn: null,
        isMinimized: false,
        bookmarks: [],
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
                bookmarkListContainer: panel.querySelector("#ldb-bookmark-list-container"),
                reportContainer: panel.querySelector("#ldb-report-container"),
                autoImportStatus: panel.querySelector("#ldb-auto-import-status"),
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
                validateConfigBtn: panel.querySelector("#ldb-validate-config"),
                setupDatabaseBtn: panel.querySelector("#ldb-setup-database"),
                cancelBtn: panel.querySelector("#ldb-cancel"),
                agentPersonaNameInput: panel.querySelector("#ldb-agent-persona-name"),
                agentPersonaToneSelect: panel.querySelector("#ldb-agent-persona-tone"),
                agentPersonaExpertiseInput: panel.querySelector("#ldb-agent-persona-expertise"),
                agentPersonaInstructionsInput: panel.querySelector("#ldb-agent-persona-instructions"),
                githubUsernameInput: panel.querySelector("#ldb-github-username"),
                githubTokenInput: panel.querySelector("#ldb-github-token"),
                githubTypeCheckboxes: panel.querySelectorAll(".ldb-github-type"),
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
            };
        },

        // 样式
        injectStyles: () => {
            DesignSystem.ensureBase();
            DesignSystem.ensureChat();
            StyleManager.injectOnce(DesignSystem.STYLE_IDS.LINUX_DO, `
                /* LDB_UI_LINUX_DO */
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
                }
            `);
        },

        // 创建面板
        createPanel: () => {
            const panel = document.createElement("div");
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
                            <div class="ldb-toggle-content collapsed" id="ldb-source-partitions-content" style="margin-bottom: 8px;">
                                <div class="ldb-source-option-group">
                                    <button class="ldb-source-option" id="ldb-source-select-linuxdo" type="button">Linux.do 收藏分区</button>
                                    <button class="ldb-source-option" id="ldb-source-select-github" type="button">GitHub 收藏分区</button>
                                </div>
                            </div>

                            <div class="ldb-toggle-section" id="ldb-source-settings-toggle" style="margin-bottom: 8px;">
                                <span>来源自动化设置</span>
                                <span class="ldb-arrow" id="ldb-source-settings-arrow">▶</span>
                            </div>
                            <div class="ldb-toggle-content collapsed" id="ldb-source-settings-content" style="margin-bottom: 8px;">
                                <div class="ldb-setting-row" style="margin-bottom: 8px;">
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                        <input type="checkbox" id="ldb-auto-import-enabled">
                                        <span id="ldb-auto-import-label">启用自动导入新收藏</span>
                                    </label>
                                </div>
                                <div id="ldb-auto-import-options" style="display: none; margin-bottom: 8px;">
                                    <div class="ldb-setting-row" style="display: flex; align-items: center; gap: 8px;">
                                        <label id="ldb-auto-import-interval-label" style="white-space: nowrap;">轮询间隔</label>
                                        <select id="ldb-auto-import-interval" class="ldb-input" style="flex: 1;">
                                            <option value="0">仅页面加载时</option>
                                            <option value="3">每 3 分钟</option>
                                            <option value="5" selected>每 5 分钟</option>
                                            <option value="10">每 10 分钟</option>
                                            <option value="30">每 30 分钟</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="ldb-setting-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <label for="ldb-linuxdo-dedup-mode" style="white-space: nowrap;">Linux.do 导入去重</label>
                                    <select id="ldb-linuxdo-dedup-mode" class="ldb-input" style="flex: 1;">
                                        <option value="strict">自动去重</option>
                                        <option value="allow_duplicates">允许重复（手动勾选）</option>
                                    </select>
                                </div>
                                <div class="ldb-setting-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <label for="ldb-bookmark-dedup-mode" style="white-space: nowrap;">书签导入去重</label>
                                    <select id="ldb-bookmark-dedup-mode" class="ldb-input" style="flex: 1;">
                                        <option value="strict">自动去重</option>
                                        <option value="allow_duplicates">允许重复（手动勾选）</option>
                                    </select>
                                </div>
                                <div class="ldb-setting-row" style="margin-bottom: 8px;">
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                        <input type="checkbox" id="ldb-ai-category-auto-dedup" checked>
                                        <span>分类列表自动去重</span>
                                    </label>
                                </div>
                                <div id="ldb-auto-import-status" style="font-size: 12px; color: #666; margin-bottom: 8px;"></div>

                                <div class="ldb-setting-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <button class="ldb-btn ldb-btn-secondary" id="ldb-update-check-btn" style="padding: 6px 10px;">检查更新</button>
                                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
                                        <input type="checkbox" id="ldb-update-auto-enabled">
                                        <span>自动检查更新</span>
                                    </label>
                                </div>
                                <div id="ldb-update-auto-options" style="display: none; margin-bottom: 8px;">
                                    <div class="ldb-setting-row" style="display: flex; align-items: center; gap: 8px;">
                                        <label for="ldb-update-interval-hours" style="white-space: nowrap;">检查间隔</label>
                                        <select id="ldb-update-interval-hours" class="ldb-input" style="flex: 1;">
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

                    <!-- ============ Tab 2: AI 助手 ============ -->
                    <div class="ldb-tab-content" data-tab-content="ai">
                        <div class="ldb-section">
                            <!-- 对话区域 -->
                            <div class="ldb-chat-container" id="ldb-chat-messages">
                                <div class="ldb-chat-welcome">
                                    <div class="ldb-chat-welcome-icon">🤖</div>
                                    <div class="ldb-chat-welcome-text">
                                        你好！我是 ${Utils.escapeHtml(Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName))}<br>
                                        <small>试试输入「帮助」查看我能做什么</small>
                                    </div>
                                    <div class="ldb-chat-chips">
                                        <button class="ldb-chat-chip" data-cmd="帮助">💡 帮助</button>
                                        <button class="ldb-chat-chip" data-cmd="搜索">🔍 搜索</button>
                                        <button class="ldb-chat-chip" data-cmd="自动分类">📂 分类</button>
                                        <button class="ldb-chat-chip" data-cmd="总结">📝 总结</button>
                                        <button class="ldb-chat-chip" data-cmd="导入GitHub收藏">🐙 GitHub</button>
                                        <button class="ldb-chat-chip" data-cmd="导入浏览器书签">📖 书签</button>
                                    </div>
                                </div>
                            </div>

                            <!-- 输入区域 -->
                            <div class="ldb-chat-input-container">
                                <textarea
                                    id="ldb-chat-input"
                                    class="ldb-chat-input"
                                    placeholder="输入指令，如「搜索 Docker」或「自动分类」..."
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

                    <!-- ============ Tab 3: 设置 ============ -->
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
                                <label class="ldb-label">数据库 / 页面</label>
                                <div style="display: flex; gap: 8px;">
                                    <select class="ldb-select" id="ldb-workspace-select" style="flex: 1;">
                                        <option value="">-- 从工作区选择 --</option>
                                    </select>
                                    <button class="ldb-btn ldb-btn-secondary" id="ldb-refresh-workspace" style="padding: 6px 12px; white-space: nowrap;" title="刷新工作区页面列表">🔄</button>
                                </div>
                                <div class="ldb-input-group" id="ldb-manual-db-wrap" style="display: none; margin-top: 8px;">
                                    <input type="text" class="ldb-input" id="ldb-database-id" placeholder="手动输入 32 位数据库 ID（高级）" style="flex: 1;">
                                </div>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-toggle-manual-db" style="margin-top: 6px; padding: 4px 10px; font-size: 12px;">高级：手动输入数据库 ID</button>
                                <div class="ldb-tip" id="ldb-workspace-tip">
                                    优先从工作区列表选择，无法加载时再手动输入
                                </div>
                            </div>

                            <!-- 导出目标类型选择 -->
                            <div class="ldb-input-group">
                                <label class="ldb-label">导出目标</label>
                                <div class="ldb-checkbox-group" style="margin-bottom: 8px;">
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
                            <div class="ldb-permission-panel" style="margin-top: 12px;">
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
                                <div class="ldb-input-group" style="margin-top: 12px;">
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
                                <div class="ldb-input-group" style="margin-top: 12px;">
                                    <label class="ldb-label">AI 服务</label>
                                    <select class="ldb-select" id="ldb-ai-service">
                                        <option value="openai">OpenAI</option>
                                        <option value="claude">Claude</option>
                                        <option value="gemini">Gemini</option>
                                    </select>
                                </div>
                                <div class="ldb-input-group">
                                    <label class="ldb-label">模型</label>
                                    <div style="display: flex; gap: 8px;">
                                        <select class="ldb-select" id="ldb-ai-model" style="flex: 1;"></select>
                                        <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-fetch-models" style="padding: 6px 12px; white-space: nowrap;">🔄 获取</button>
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
                                    <div style="display: flex; gap: 8px;">
                                        <select class="ldb-select" id="ldb-ai-target-db" style="flex: 1;">
                                            <option value="">当前配置的数据库</option>
                                            <option value="__all__">所有工作区数据库</option>
                                        </select>
                                        <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-refresh-dbs" style="padding: 6px 12px; white-space: nowrap;">🔄</button>
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
                                <div class="ldb-btn-group" style="display: flex; align-items: center; gap: 8px;">
                                    <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-test">测试连接</button>
                                    <span id="ldb-ai-test-status" style="font-size: 12px;"></span>
                                </div>

                                <!-- Agent 个性化设置 -->
                                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ldb-ui-border);">
                                    <span style="font-size: 12px; color: var(--ldb-ui-muted);">🤖 Agent 个性化</span>
                                </div>
                                <div class="ldb-input-group" style="margin-top: 8px;">
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
                                <div class="ldb-input-group" style="margin-top: 12px;">
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
                            <div id="ldb-self-check-result" style="font-size: 12px; color: var(--ldb-ui-muted);"></div>
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
        bindEvents: () => {
            const panel = UI.panel;
            const refs = UI.refs || {};
            const body = panel.querySelector(".ldb-body");

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
            (refs.minimizeBtn || panel.querySelector("#ldb-minimize")).onclick = () => {
                panel.style.display = "none";
                UI.miniBtn.style.display = "flex";
                Storage.set(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, true);
            };

            // 关闭
            (refs.closeBtn || panel.querySelector("#ldb-close")).onclick = () => {
                panel.remove();
                UI.miniBtn.remove();
            };

            // 主题切换
            (refs.themeToggleBtn || panel.querySelector("#ldb-theme-toggle")).onclick = () => {
                DesignSystem.toggleTheme();
            };

            // Tab 切换
            (refs.tabs || panel.querySelectorAll(".ldb-tab")).forEach(tab => {
                tab.onclick = () => {
                    const tabName = tab.getAttribute("data-tab");
                    // 更新 tab 按钮状态
                    (refs.tabs || panel.querySelectorAll(".ldb-tab")).forEach(t => t.classList.remove("active"));
                    tab.classList.add("active");
                    // 更新 tab 内容显示
                    (refs.tabContents || panel.querySelectorAll(".ldb-tab-content")).forEach(c => c.classList.remove("active"));
                    const content = panel.querySelector(`[data-tab-content="${tabName}"]`);
                    if (content) content.classList.add("active");
                    // 持久化
                    Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_TAB, tabName);
                };
            });

            // 恢复上次选择的 tab
            const savedTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, "bookmarks");
            const tabBtn = panel.querySelector(`.ldb-tab[data-tab="${savedTab}"]`);
            if (tabBtn) tabBtn.click();

            // 折叠筛选设置
            (refs.filterToggle || panel.querySelector("#ldb-filter-toggle")).onclick = () => {
                const content = refs.filterContent || panel.querySelector("#ldb-filter-content");
                const arrow = refs.filterArrow || panel.querySelector("#ldb-filter-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            };

            // 折叠 AI 设置
            (refs.aiSettingsToggle || panel.querySelector("#ldb-ai-settings-toggle")).onclick = () => {
                const content = refs.aiSettingsContent || panel.querySelector("#ldb-ai-settings-content");
                const arrow = refs.aiSettingsArrow || panel.querySelector("#ldb-ai-settings-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            };

            // 折叠 GitHub 设置
            (refs.githubSettingsToggle || panel.querySelector("#ldb-github-settings-toggle")).onclick = () => {
                const content = refs.githubSettingsContent || panel.querySelector("#ldb-github-settings-content");
                const arrow = refs.githubSettingsArrow || panel.querySelector("#ldb-github-settings-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            };

            (refs.sourceSettingsToggle || panel.querySelector("#ldb-source-settings-toggle")).onclick = () => {
                const content = refs.sourceSettingsContent || panel.querySelector("#ldb-source-settings-content");
                const arrow = refs.sourceSettingsArrow || panel.querySelector("#ldb-source-settings-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            };

            (refs.sourcePartitionsToggle || panel.querySelector("#ldb-source-partitions-toggle")).onclick = () => {
                const content = refs.sourcePartitionsContent || panel.querySelector("#ldb-source-partitions-content");
                const arrow = refs.sourcePartitionsArrow || panel.querySelector("#ldb-source-partitions-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            };

            (refs.sourceSelectLinuxdo || panel.querySelector("#ldb-source-select-linuxdo")).onclick = () => {
                UI.switchBookmarkSource("linuxdo");
            };

            (refs.sourceSelectGithub || panel.querySelector("#ldb-source-select-github")).onclick = () => {
                UI.switchBookmarkSource("github");
            };

            (refs.openGithubSettingsBtn || panel.querySelector("#ldb-open-github-settings")).onclick = () => {
                const settingsTab = panel.querySelector('.ldb-tab[data-tab="settings"]');
                if (settingsTab && !settingsTab.classList.contains("active")) {
                    settingsTab.click();
                }
                const content = refs.githubSettingsContent || panel.querySelector("#ldb-github-settings-content");
                const arrow = refs.githubSettingsArrow || panel.querySelector("#ldb-github-settings-arrow");
                const tokenInput = refs.githubTokenInput || panel.querySelector("#ldb-github-token");
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

            (refs.selfCheckBtn || panel.querySelector("#ldb-self-check-btn")).onclick = () => {
                UI.renderSelfCheckResult();
                UI.showStatus("自检已完成", "info");
            };

            (refs.copyDiagBtn || panel.querySelector("#ldb-copy-diagnostics-btn")).onclick = async () => {
                await UI.copyDiagnostics();
            };

            // 导出目标类型切换
            const handleExportTargetChange = (e) => {
                const targetType = e.target.value;
                const parentPageGroup = refs.parentPageGroup || panel.querySelector("#ldb-parent-page-group");
                const manualDbWrap = refs.manualDbWrap || panel.querySelector("#ldb-manual-db-wrap");
                const exportTargetTip = refs.exportTargetTip || panel.querySelector("#ldb-export-target-tip");

                if (targetType === "page") {
                    parentPageGroup.style.display = "block";
                    manualDbWrap.style.display = "none";
                    exportTargetTip.textContent = "导出为子页面，包含完整内容";
                } else {
                    parentPageGroup.style.display = "none";
                    exportTargetTip.textContent = "导出为数据库条目，支持筛选和排序";
                }

                Storage.set(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, targetType);
            };

            (refs.exportTargetDatabaseRadio || panel.querySelector("#ldb-export-target-database")).onchange = handleExportTargetChange;
            (refs.exportTargetPageRadio || panel.querySelector("#ldb-export-target-page")).onchange = handleExportTargetChange;

            // 父页面 ID 自动保存
            (refs.parentPageIdInput || panel.querySelector("#ldb-parent-page-id")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, e.target.value.trim());
            };

            // 验证配置
            (refs.validateConfigBtn || panel.querySelector("#ldb-validate-config")).onclick = async () => {
                const btn = refs.validateConfigBtn || panel.querySelector("#ldb-validate-config");
                const statusSpan = refs.configStatus || panel.querySelector("#ldb-config-status");
                const apiKey = (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value.trim();
                const exportTargetType = (refs.exportTargetPageRadio || panel.querySelector("#ldb-export-target-page")).checked ? "page" : "database";
                const databaseId = (refs.databaseIdInput || panel.querySelector("#ldb-database-id")).value.trim();
                const parentPageId = (refs.parentPageIdInput || panel.querySelector("#ldb-parent-page-id")).value.trim();

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
                    let result;
                    if (exportTargetType === "database") {
                        result = await NotionAPI.validateConfig(apiKey, databaseId);
                        if (result.valid) {
                            statusSpan.textContent = "✅ 验证成功";
                            statusSpan.style.color = "#34d399";
                            Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, apiKey);
                            Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, databaseId);
                        }
                    } else {
                        result = await NotionAPI.validatePage(parentPageId, apiKey);
                        if (result.valid) {
                            statusSpan.textContent = "✅ 验证成功";
                            statusSpan.style.color = "#34d399";
                            Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, apiKey);
                            Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, parentPageId);
                        }
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
            (refs.setupDatabaseBtn || panel.querySelector("#ldb-setup-database")).onclick = async () => {
                const apiKey = (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value.trim();
                const databaseId = (refs.databaseIdInput || panel.querySelector("#ldb-database-id")).value.trim();
                const statusSpan = refs.configStatus || panel.querySelector("#ldb-config-status");

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

                const btn = refs.setupDatabaseBtn || panel.querySelector("#ldb-setup-database");
                btn.disabled = true;
                btn.innerHTML = '<span class="ldb-spin">🔄</span> 设置中...';

                try {
                    const result = await NotionAPI.setupDatabaseProperties(databaseId, apiKey);
                    if (result.success) {
                        statusSpan.textContent = `✅ ${result.message}`;
                        statusSpan.style.color = "#34d399";
                        // 保存配置
                        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, apiKey);
                        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, databaseId);
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
            (refs.autoImportEnabled || panel.querySelector("#ldb-auto-import-enabled")).onchange = (e) => {
                const enabled = e.target.checked;
                const cfg = UI.getAutoImportConfigBySource();
                Storage.set(cfg.enabledKey, enabled);
                (refs.autoImportOptions || panel.querySelector("#ldb-auto-import-options")).style.display = enabled ? "block" : "none";
                if (enabled) {
                    if (cfg.isGitHub) {
                        GitHubAutoImporter.run();
                        const interval = parseInt((refs.autoImportInterval || panel.querySelector("#ldb-auto-import-interval")).value) || 0;
                        Storage.set(cfg.intervalKey, interval);
                        if (interval > 0) GitHubAutoImporter.startPolling(interval);
                        return;
                    }

                    // 检查 Notion 配置是否完整
                    const apiKey = (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value.trim();
                    if (!apiKey) {
                        AutoImporter.updateStatus("⚠️ 请先配置 Notion API Key");
                        return;
                    }
                    const exportTargetType = (refs.exportTargetPageRadio || panel.querySelector("#ldb-export-target-page")).checked ? "page" : "database";
                    if (exportTargetType === "database" && !(refs.databaseIdInput || panel.querySelector("#ldb-database-id")).value.trim()) {
                        AutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                        return;
                    }
                    if (exportTargetType === "page" && !(refs.parentPageIdInput || panel.querySelector("#ldb-parent-page-id")).value.trim()) {
                        AutoImporter.updateStatus("⚠️ 请先配置父页面 ID");
                        return;
                    }
                    AutoImporter.run();
                    const interval = parseInt((refs.autoImportInterval || panel.querySelector("#ldb-auto-import-interval")).value) || 0;
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

            (refs.autoImportInterval || panel.querySelector("#ldb-auto-import-interval")).onchange = (e) => {
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

            (refs.linuxdoDedupModeSelect || panel.querySelector("#ldb-linuxdo-dedup-mode")).onchange = (e) => {
                const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
                Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, mode);
                UI.recomputeExportStats();
                UI.renderBookmarkList();
            };

            (refs.bookmarkDedupModeSelect || panel.querySelector("#ldb-bookmark-dedup-mode")).onchange = (e) => {
                const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
                Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_IMPORT_DEDUP_MODE, mode);
            };

            (refs.aiCategoryAutoDedupCheckbox || panel.querySelector("#ldb-ai-category-auto-dedup")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORY_AUTO_DEDUP, !!e.target.checked);
            };

            (refs.updateCheckBtn || panel.querySelector("#ldb-update-check-btn")).onclick = async () => {
                await UpdateChecker.check({ manual: true });
            };

            (refs.updateAutoEnabled || panel.querySelector("#ldb-update-auto-enabled")).onchange = (e) => {
                const enabled = e.target.checked;
                const optionsEl = refs.updateAutoOptions || panel.querySelector("#ldb-update-auto-options");
                optionsEl.style.display = enabled ? "block" : "none";
                Storage.set(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, enabled);

                if (enabled) {
                    const hours = parseInt((refs.updateIntervalHours || panel.querySelector("#ldb-update-interval-hours")).value, 10)
                        || CONFIG.DEFAULTS.updateCheckIntervalHours;
                    Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, hours);
                    UpdateChecker.check({ manual: false });
                    UpdateChecker.startPolling(hours);
                } else {
                    UpdateChecker.stopPolling();
                }
            };

            (refs.updateIntervalHours || panel.querySelector("#ldb-update-interval-hours")).onchange = (e) => {
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
                ((UI.refs && UI.refs.bookmarkCount) || panel.querySelector("#ldb-bookmark-count")).textContent = "-";
                ((UI.refs && UI.refs.exportBtn) || panel.querySelector("#ldb-export")).disabled = true;
                ((UI.refs && UI.refs.bookmarkListContainer) || panel.querySelector("#ldb-bookmark-list-container")).style.display = "none";
                UI.renderBookmarkList();

                const cfg = UI.getAutoImportConfigBySource();
                const autoImportEnabled = Storage.get(cfg.enabledKey, cfg.enabledDefault);
                const autoImportEnabledEl = refs.autoImportEnabled || panel.querySelector("#ldb-auto-import-enabled");
                const autoImportOptionsEl = refs.autoImportOptions || panel.querySelector("#ldb-auto-import-options");
                const intervalEl = refs.autoImportInterval || panel.querySelector("#ldb-auto-import-interval");
                autoImportEnabledEl.checked = autoImportEnabled;
                autoImportOptionsEl.style.display = autoImportEnabled ? "block" : "none";
                intervalEl.value = String(Storage.get(cfg.intervalKey, cfg.intervalDefault));
                if (intervalEl.selectedIndex === -1) {
                    intervalEl.value = String(cfg.intervalDefault);
                    Storage.set(cfg.intervalKey, cfg.intervalDefault);
                }
            };

            // 收藏列表事件委托（避免每次重渲染重复绑定）
            if (!UI.bookmarkListBound) {
                const bookmarkList = (UI.refs && UI.refs.bookmarkList) || panel.querySelector("#ldb-bookmark-list");
                bookmarkList.addEventListener("click", (e) => {
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
            (refs.loadBookmarksBtn || panel.querySelector("#ldb-load-bookmarks")).onclick = async () => {
                const btn = refs.loadBookmarksBtn || panel.querySelector("#ldb-load-bookmarks");
                btn.disabled = true;
                btn.innerHTML = '<span class="ldb-spin">🔄</span> 加载中...';

                try {
                    let bookmarks = [];

                    if (UI.isActiveGitHubSource()) {
                        const username = (refs.githubUsernameInput || panel.querySelector("#ldb-github-username")).value.trim()
                            || Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
                        const token = (refs.githubTokenInput || panel.querySelector("#ldb-github-token")).value.trim()
                            || Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
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
                            ((UI.refs && UI.refs.bookmarkCount) || panel.querySelector("#ldb-bookmark-count")).textContent = allItems.length;
                        }
                        bookmarks = allItems;
                    } else {
                        const username = Utils.getCurrentLinuxDoUsername();
                        if (!username) {
                            UI.showStatus("无法获取当前 Linux.do 用户名，请先登录后重试", "error");
                            return;
                        }
                        bookmarks = await LinuxDoAPI.fetchAllBookmarks(username, (count) => {
                            ((UI.refs && UI.refs.bookmarkCount) || panel.querySelector("#ldb-bookmark-count")).textContent = count;
                        });
                    }

                    UI.bookmarks = bookmarks;
                    UI.selectedBookmarks = new Set(bookmarks.map(b => UI.getBookmarkKey(b)));
                    UI.recomputeExportStats();
                    ((UI.refs && UI.refs.bookmarkCount) || panel.querySelector("#ldb-bookmark-count")).textContent = bookmarks.length;
                    ((UI.refs && UI.refs.exportBtn) || panel.querySelector("#ldb-export")).disabled = false;

                    // 渲染收藏列表
                    UI.renderBookmarkList();
                    ((UI.refs && UI.refs.bookmarkListContainer) || panel.querySelector("#ldb-bookmark-list-container")).style.display = "block";

                    const sourceText = UI.isActiveGitHubSource() ? "GitHub 收藏" : "Linux.do 收藏";
                    UI.showStatus(`成功加载 ${bookmarks.length} 个${sourceText}`, "success");
                } catch (error) {
                    UI.showStatus(`加载失败: ${error.message}`, "error");
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = "🔄 加载收藏列表";
                }
            };

            (refs.importBrowserBookmarksBtn || panel.querySelector("#ldb-import-browser-bookmarks")).onclick = async () => {
                const btn = refs.importBrowserBookmarksBtn || panel.querySelector("#ldb-import-browser-bookmarks");
                const source = UI.getActiveBookmarkSource();
                if (source !== "linuxdo") {
                    UI.switchBookmarkSource("linuxdo");
                    const toggle = refs.sourceSettingsToggle || panel.querySelector("#ldb-source-settings-toggle");
                    const content = refs.sourceSettingsContent || panel.querySelector("#ldb-source-settings-content");
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
            (refs.selectAll || panel.querySelector("#ldb-select-all")).onchange = (e) => {
                const checked = e.target.checked;
                if (checked) {
                    UI.selectedBookmarks = new Set(UI.bookmarks.map(b => UI.getBookmarkKey(b)));
                } else {
                    UI.selectedBookmarks = new Set();
                }
                UI.recomputeExportStats();
                UI.renderBookmarkList();
                UI.updateSelectCount();
            };

            // 暂停按钮
            (refs.pauseBtn || panel.querySelector("#ldb-pause")).onclick = () => {
                const pauseBtn = refs.pauseBtn || panel.querySelector("#ldb-pause");
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
            (refs.cancelBtn || panel.querySelector("#ldb-cancel")).onclick = () => {
                if (confirm("确定要取消导出吗？已导出的内容不会被删除。")) {
                    Exporter.cancel();
                }
            };

            // 开始导出
            (refs.exportBtn || panel.querySelector("#ldb-export")).onclick = async () => {
                const apiKey = (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value.trim();
                const exportTargetType = (refs.exportTargetPageRadio || panel.querySelector("#ldb-export-target-page")).checked ? "page" : "database";
                const databaseId = (refs.databaseIdInput || panel.querySelector("#ldb-database-id")).value.trim();
                const parentPageId = (refs.parentPageIdInput || panel.querySelector("#ldb-parent-page-id")).value.trim();

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
                    onlyFirst: (refs.onlyFirstCheckbox || panel.querySelector("#ldb-only-first")).checked,
                    onlyOp: (refs.onlyOpCheckbox || panel.querySelector("#ldb-only-op")).checked,
                    rangeStart: parseInt((refs.rangeStartInput || panel.querySelector("#ldb-range-start")).value) || 1,
                    rangeEnd: parseInt((refs.rangeEndInput || panel.querySelector("#ldb-range-end")).value) || 999999,
                    imgMode: (refs.imgModeSelect || panel.querySelector("#ldb-img-mode")).value,
                    concurrency: parseInt((refs.exportConcurrencySelect || panel.querySelector("#ldb-export-concurrency")).value) || 1,
                    aiApiKey: (refs.aiApiKeyInput || panel.querySelector("#ldb-ai-api-key")).value.trim(),
                    aiService: (refs.aiServiceSelect || panel.querySelector("#ldb-ai-service")).value,
                    aiModel: (refs.aiModelSelect || panel.querySelector("#ldb-ai-model")).value,
                    aiBaseUrl: (refs.aiBaseUrlInput || panel.querySelector("#ldb-ai-base-url")).value.trim(),
                    categories: Utils.parseAICategories(
                        (refs.aiCategoriesInput || panel.querySelector("#ldb-ai-categories")).value.trim() || ""
                    ),
                    githubUsername: (refs.githubUsernameInput || panel.querySelector("#ldb-github-username")).value.trim(),
                    token: (refs.githubTokenInput || panel.querySelector("#ldb-github-token")).value.trim(),
                };

                // 保存设置
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, apiKey);
                Storage.set(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, exportTargetType);
                if (exportTargetType === "database") {
                    Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, databaseId);
                } else {
                    Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, parentPageId);
                }
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, settings.onlyFirst);
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, settings.onlyOp);
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, settings.rangeStart);
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, settings.rangeEnd);
                Storage.set(CONFIG.STORAGE_KEYS.IMG_MODE, settings.imgMode);
                Storage.set(CONFIG.STORAGE_KEYS.REQUEST_DELAY, parseInt((refs.requestDelaySelect || panel.querySelector("#ldb-request-delay")).value));
                Storage.set(CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY, settings.concurrency);

                // 显示控制按钮，隐藏导出按钮
                (refs.exportBtns || panel.querySelector("#ldb-export-btns")).style.display = "none";
                (refs.controlBtns || panel.querySelector("#ldb-control-btns")).style.display = "flex";
                (refs.pauseBtn || panel.querySelector("#ldb-pause")).innerHTML = "⏸️ 暂停";
                (refs.pauseBtn || panel.querySelector("#ldb-pause")).classList.add("ldb-btn-warning");
                (refs.pauseBtn || panel.querySelector("#ldb-pause")).classList.remove("ldb-btn-primary");

                // 清空之前的报告
                ((UI.refs && UI.refs.reportContainer) || panel.querySelector("#ldb-report-container")).innerHTML = "";

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
                    (refs.exportBtns || panel.querySelector("#ldb-export-btns")).style.display = "flex";
                    (refs.controlBtns || panel.querySelector("#ldb-control-btns")).style.display = "none";
                    Exporter.reset();
                }
            };

            // 权限设置事件
            (refs.permissionLevelSelect || panel.querySelector("#ldb-permission-level")).onchange = (e) => {
                const level = parseInt(e.target.value);
                OperationGuard.setLevel(level);
                UI.showStatus(`权限级别已设置为: ${CONFIG.PERMISSION_NAMES[level]}`, "success");
            };

            (refs.requireConfirmCheckbox || panel.querySelector("#ldb-require-confirm")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, e.target.checked);
            };

            (refs.enableAuditLogCheckbox || panel.querySelector("#ldb-enable-audit-log")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, e.target.checked);
                // 更新日志面板可见性
                const logPanel = refs.logPanel || panel.querySelector("#ldb-log-panel");
                if (logPanel) {
                    logPanel.style.display = e.target.checked ? "block" : "none";
                }
            };

            // 日志面板事件
            (refs.logToggleBtn || panel.querySelector("#ldb-log-toggle")).onclick = () => {
                const content = refs.logContent || panel.querySelector("#ldb-log-content");
                const arrow = refs.logArrow || panel.querySelector("#ldb-log-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";

                // 展开时更新日志内容
                if (!content.classList.contains("collapsed")) {
                    UI.updateLogPanel();
                }
            };

            (refs.logClearBtn || panel.querySelector("#ldb-log-clear")).onclick = () => {
                if (confirm("确定要清除所有操作日志吗？")) {
                    OperationLog.clear();
                    UI.showStatus("日志已清除", "success");
                }
            };

            // 输入框自动保存
            (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, e.target.value.trim());
            };
            (refs.databaseIdInput || panel.querySelector("#ldb-database-id")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, e.target.value.trim());
            };

            // 手动输入数据库 ID 开关
            (refs.toggleManualDbBtn || panel.querySelector("#ldb-toggle-manual-db")).onclick = () => {
                const wrap = refs.manualDbWrap || panel.querySelector("#ldb-manual-db-wrap");
                const visible = wrap.style.display !== "none";
                wrap.style.display = visible ? "none" : "block";
            };

            // 刷新工作区页面列表
            (refs.refreshWorkspaceBtn || panel.querySelector("#ldb-refresh-workspace")).onclick = async () => {
                const apiKey = (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value.trim();
                const refreshBtn = refs.refreshWorkspaceBtn || panel.querySelector("#ldb-refresh-workspace");
                const workspaceTip = refs.workspaceTip || panel.querySelector("#ldb-workspace-tip");

                if (!apiKey) {
                    UI.showStatus("请先填写 Notion API Key", "error");
                    return;
                }

                refreshBtn.disabled = true;
                refreshBtn.innerHTML = "⏳";
                workspaceTip.style.color = "";
                workspaceTip.textContent = "正在获取数据库列表...";

                try {
                    const workspace = await WorkspaceService.fetchWorkspaceStaged(apiKey, {
                        includePages: true,
                        onProgress: (progress) => {
                            if (progress.phase === "databases") {
                                workspaceTip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                            } else if (progress.phase === "pages") {
                                workspaceTip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                            }
                        },
                        onPhaseComplete: (phase, partialWorkspace) => {
                            const workspaceData = {
                                apiKeyHash: apiKey.slice(-8),
                                databases: partialWorkspace.databases || [],
                                pages: partialWorkspace.pages || [],
                                timestamp: Date.now(),
                            };
                            Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));
                            UI.updateWorkspaceSelect(workspaceData);

                            if (phase === "databases") {
                                workspaceTip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                                workspaceTip.style.color = "#34d399";
                            }
                        },
                    });

                    const workspaceData = {
                        apiKeyHash: apiKey.slice(-8),
                        databases: workspace.databases,
                        pages: workspace.pages,
                        timestamp: Date.now(),
                    };
                    Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));
                    UI.updateWorkspaceSelect(workspaceData);
                    workspaceTip.textContent = `✅ 获取到 ${workspace.databases.length} 个数据库，${workspace.pages.length} 个页面`;
                    workspaceTip.style.color = "#34d399";
                } catch (error) {
                    workspaceTip.textContent = `❌ ${error.message}`;
                    workspaceTip.style.color = "#f87171";
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = "🔄";
                }
            };

            // 从工作区选择页面/数据库
            (refs.workspaceSelect || panel.querySelector("#ldb-workspace-select")).onchange = (e) => {
                const selected = e.target.value;
                if (selected) {
                    const [type, id] = selected.split(":");
                    if (type === "database") {
                        (refs.databaseIdInput || panel.querySelector("#ldb-database-id")).value = id;
                        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, id);
                    } else if (type === "page") {
                        // 页面类型：填入父页面 ID 字段
                        (refs.parentPageIdInput || panel.querySelector("#ldb-parent-page-id")).value = id;
                        Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, id);
                        // 自动切换到页面导出模式
                        (refs.exportTargetPageRadio || panel.querySelector("#ldb-export-target-page")).checked = true;
                        (refs.parentPageGroup || panel.querySelector("#ldb-parent-page-group")).style.display = "block";
                        (refs.manualDbWrap || panel.querySelector("#ldb-manual-db-wrap")).style.display = "none";
                        (refs.exportTargetTip || panel.querySelector("#ldb-export-target-tip")).textContent = "导出为子页面，包含完整内容";
                        Storage.set(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, "page");
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
            (refs.aiServiceSelect || panel.querySelector("#ldb-ai-service")).onchange = (e) => {
                const newService = e.target.value;
                // 优先使用缓存的模型列表
                const cachedModels = Storage.get(CONFIG.STORAGE_KEYS.FETCHED_MODELS, "{}");
                try {
                    const modelsData = JSON.parse(cachedModels);
                    if (modelsData[newService]?.models?.length > 0) {
                        UI.updateAIModelOptions(newService, modelsData[newService].models);
                    } else {
                        UI.updateAIModelOptions(newService);
                    }
                } catch {
                    UI.updateAIModelOptions(newService);
                }
                Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, newService);
            };

            // 保存 AI 配置
            (refs.aiApiKeyInput || panel.querySelector("#ldb-ai-api-key")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_API_KEY, e.target.value.trim());
            };
            (refs.aiBaseUrlInput || panel.querySelector("#ldb-ai-base-url")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_BASE_URL, e.target.value.trim());
            };
            (refs.aiCategoriesInput || panel.querySelector("#ldb-ai-categories")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORIES, e.target.value.trim());
            };
            (refs.aiModelSelect || panel.querySelector("#ldb-ai-model")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, e.target.value);
            };

            // AI 查询目标数据库选择
            (refs.aiTargetDbSelect || panel.querySelector("#ldb-ai-target-db")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_TARGET_DB, e.target.value);
            };

            (refs.workspaceMaxPagesSelect || panel.querySelector("#ldb-workspace-max-pages")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, parseInt(e.target.value) || 0);
            };

            // Agent 个性化设置
            (refs.agentPersonaNameInput || panel.querySelector("#ldb-agent-persona-name")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, e.target.value.trim() || CONFIG.DEFAULTS.agentPersonaName);
            };
            (refs.agentPersonaToneSelect || panel.querySelector("#ldb-agent-persona-tone")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, e.target.value);
            };
            (refs.agentPersonaExpertiseInput || panel.querySelector("#ldb-agent-persona-expertise")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, e.target.value.trim() || CONFIG.DEFAULTS.agentPersonaExpertise);
            };
            (refs.agentPersonaInstructionsInput || panel.querySelector("#ldb-agent-persona-instructions")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, e.target.value.trim());
            };
            (refs.githubUsernameInput || panel.querySelector("#ldb-github-username")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, e.target.value.trim());
            };
            (refs.githubTokenInput || panel.querySelector("#ldb-github-token")).onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, e.target.value.trim());
            };
            // GitHub 导入类型
            (refs.githubTypeCheckboxes || panel.querySelectorAll(".ldb-github-type")).forEach(cb => {
                cb.onchange = () => {
                    const source = refs.githubTypeCheckboxes || panel.querySelectorAll(".ldb-github-type:checked");
                    const types = [...source].filter(c => c.checked).map(c => c.value);
                    GitHubAPI.setImportTypes(types.length > 0 ? types : ["stars"]);
                };
            });

            // 刷新 AI 数据库列表
            (refs.aiRefreshDbsBtn || panel.querySelector("#ldb-ai-refresh-dbs")).onclick = async () => {
                const apiKey = (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value.trim();
                const refreshBtn = refs.aiRefreshDbsBtn || panel.querySelector("#ldb-ai-refresh-dbs");

                if (!apiKey) {
                    UI.showStatus("请先填写 Notion API Key", "error");
                    return;
                }

                refreshBtn.disabled = true;
                refreshBtn.innerHTML = "⏳";

                try {
                    const workspace = await WorkspaceService.fetchWorkspace(apiKey, { includePages: false });

                    const apiKeyHash = apiKey.slice(-8);
                    const cachedWorkspace = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
                    let workspaceData;
                    try { workspaceData = JSON.parse(cachedWorkspace); } catch { workspaceData = {}; }
                    workspaceData.apiKeyHash = apiKeyHash;
                    workspaceData.databases = workspace.databases;
                    workspaceData.timestamp = Date.now();
                    Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));

                    UI.updateAITargetDbOptions(workspace.databases);
                    UI.showStatus(`获取到 ${workspace.databases.length} 个数据库`, "success");
                } catch (error) {
                    UI.showStatus(`获取数据库列表失败: ${error.message}`, "error");
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = "🔄";
                }
            };

            // 获取模型列表
            (refs.aiFetchModelsBtn || panel.querySelector("#ldb-ai-fetch-models")).onclick = async () => {
                const aiApiKey = (refs.aiApiKeyInput || panel.querySelector("#ldb-ai-api-key")).value.trim();
                const aiService = (refs.aiServiceSelect || panel.querySelector("#ldb-ai-service")).value;
                const aiBaseUrl = (refs.aiBaseUrlInput || panel.querySelector("#ldb-ai-base-url")).value.trim();
                const fetchBtn = refs.aiFetchModelsBtn || panel.querySelector("#ldb-ai-fetch-models");
                const modelTip = refs.aiModelTip || panel.querySelector("#ldb-ai-model-tip");

                if (!aiApiKey) {
                    UI.showStatus("请先填写 AI API Key", "error");
                    return;
                }

                fetchBtn.disabled = true;
                fetchBtn.innerHTML = "⏳ 获取中...";
                modelTip.textContent = "";

                try {
                    const models = await AIService.fetchModels(aiService, aiApiKey, aiBaseUrl);
                    UI.updateAIModelOptions(aiService, models, true); // 保留当前选择
                    // 持久化保存获取的模型列表
                    const cachedModels = Storage.get(CONFIG.STORAGE_KEYS.FETCHED_MODELS, "{}");
                    const modelsData = JSON.parse(cachedModels);
                    modelsData[aiService] = { models, timestamp: Date.now() };
                    Storage.set(CONFIG.STORAGE_KEYS.FETCHED_MODELS, JSON.stringify(modelsData));
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
            (refs.aiTestBtn || panel.querySelector("#ldb-ai-test")).onclick = async () => {
                const btn = refs.aiTestBtn || panel.querySelector("#ldb-ai-test");
                const statusSpan = refs.aiTestStatus || panel.querySelector("#ldb-ai-test-status");
                const aiApiKey = (refs.aiApiKeyInput || panel.querySelector("#ldb-ai-api-key")).value.trim();
                const aiService = (refs.aiServiceSelect || panel.querySelector("#ldb-ai-service")).value;
                const aiModel = (refs.aiModelSelect || panel.querySelector("#ldb-ai-model")).value;
                const aiBaseUrl = (refs.aiBaseUrlInput || panel.querySelector("#ldb-ai-base-url")).value.trim();

                // 清除之前的状态
                statusSpan.textContent = "";
                statusSpan.style.color = "";

                if (!aiApiKey) {
                    UI.showStatus("请先填写 AI API Key", "error");
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

            // 拖拽
            UI.makeDraggable(panel, panel.querySelector(".ldb-header"));
        },

        // 加载配置
        loadConfig: () => {
            const panel = UI.panel;
            const refs = UI.refs || {};

            (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            (refs.databaseIdInput || panel.querySelector("#ldb-database-id")).value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            (refs.parentPageIdInput || panel.querySelector("#ldb-parent-page-id")).value = Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "");
            (refs.onlyFirstCheckbox || panel.querySelector("#ldb-only-first")).checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, CONFIG.DEFAULTS.onlyFirst);
            (refs.onlyOpCheckbox || panel.querySelector("#ldb-only-op")).checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, CONFIG.DEFAULTS.onlyOp);
            (refs.rangeStartInput || panel.querySelector("#ldb-range-start")).value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, CONFIG.DEFAULTS.rangeStart);
            (refs.rangeEndInput || panel.querySelector("#ldb-range-end")).value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, CONFIG.DEFAULTS.rangeEnd);
            (refs.imgModeSelect || panel.querySelector("#ldb-img-mode")).value = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
            (refs.requestDelaySelect || panel.querySelector("#ldb-request-delay")).value = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            (refs.exportConcurrencySelect || panel.querySelector("#ldb-export-concurrency")).value = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY, CONFIG.DEFAULTS.exportConcurrency);

            // 加载导出目标类型设置
            const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
            if (exportTargetType === "page") {
                (refs.exportTargetPageRadio || panel.querySelector("#ldb-export-target-page")).checked = true;
                (refs.parentPageGroup || panel.querySelector("#ldb-parent-page-group")).style.display = "block";
                (refs.manualDbWrap || panel.querySelector("#ldb-manual-db-wrap")).style.display = "none";
                (refs.exportTargetTip || panel.querySelector("#ldb-export-target-tip")).textContent = "导出为子页面，包含完整内容";
            } else {
                (refs.exportTargetDatabaseRadio || panel.querySelector("#ldb-export-target-database")).checked = true;
                (refs.parentPageGroup || panel.querySelector("#ldb-parent-page-group")).style.display = "none";
                (refs.exportTargetTip || panel.querySelector("#ldb-export-target-tip")).textContent = "导出为数据库条目，支持筛选和排序";
            }

            // 加载权限设置
            (refs.permissionLevelSelect || panel.querySelector("#ldb-permission-level")).value = Storage.get(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, CONFIG.DEFAULTS.permissionLevel);
            (refs.requireConfirmCheckbox || panel.querySelector("#ldb-require-confirm")).checked = Storage.get(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, CONFIG.DEFAULTS.requireConfirm);
            (refs.enableAuditLogCheckbox || panel.querySelector("#ldb-enable-audit-log")).checked = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);

            // 根据审计日志设置更新面板可见性
            const enableAuditLog = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
            const logPanel = refs.logPanel || panel.querySelector("#ldb-log-panel");
            if (logPanel) {
                logPanel.style.display = enableAuditLog ? "block" : "none";
            }

            // 加载 AI 分类设置
            const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
            (refs.aiServiceSelect || panel.querySelector("#ldb-ai-service")).value = aiService;

            // 验证并加载 AI 模型（优先使用缓存的模型列表）
            const savedModel = Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
            const provider = AIService.PROVIDERS[aiService];
            const modelSelect = refs.aiModelSelect || panel.querySelector("#ldb-ai-model");

            // 先尝试从缓存加载模型列表
            const cachedModels = Storage.get(CONFIG.STORAGE_KEYS.FETCHED_MODELS, "{}");
            let validModels = provider?.models || [];
            try {
                const modelsData = JSON.parse(cachedModels);
                if (modelsData[aiService]?.models?.length > 0) {
                    validModels = modelsData[aiService].models;
                    UI.updateAIModelOptions(aiService, validModels);
                } else {
                    UI.updateAIModelOptions(aiService);
                }
            } catch {
                UI.updateAIModelOptions(aiService);
            }

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
                    console.warn(`AI 模型 "${savedModel}" 与当前服务 "${aiService}" 不兼容，已重置为默认模型`);
                }
            }

            (refs.aiApiKeyInput || panel.querySelector("#ldb-ai-api-key")).value = Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "");
            (refs.aiBaseUrlInput || panel.querySelector("#ldb-ai-base-url")).value = Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, CONFIG.DEFAULTS.aiBaseUrl);
            (refs.aiCategoriesInput || panel.querySelector("#ldb-ai-categories")).value = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories);
            (refs.workspaceMaxPagesSelect || panel.querySelector("#ldb-workspace-max-pages")).value = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages);

            // 加载 Agent 个性化设置
            (refs.agentPersonaNameInput || panel.querySelector("#ldb-agent-persona-name")).value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
            (refs.agentPersonaToneSelect || panel.querySelector("#ldb-agent-persona-tone")).value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone);
            (refs.agentPersonaExpertiseInput || panel.querySelector("#ldb-agent-persona-expertise")).value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise);
            (refs.agentPersonaInstructionsInput || panel.querySelector("#ldb-agent-persona-instructions")).value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions);

            // 加载 GitHub 设置
            (refs.githubUsernameInput || panel.querySelector("#ldb-github-username")).value = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
            (refs.githubTokenInput || panel.querySelector("#ldb-github-token")).value = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
            // 加载 GitHub 导入类型
            const savedGHTypesMain = GitHubAPI.getImportTypes();
            (refs.githubTypeCheckboxes || panel.querySelectorAll(".ldb-github-type")).forEach(cb => {
                cb.checked = savedGHTypesMain.includes(cb.value);
            });

            const source = UI.getActiveBookmarkSource();
            UI.applyBookmarkSourceUI(source);

            // 书签扩展状态
            const bmStatusMain = refs.bookmarkExtStatus || panel.querySelector("#ldb-bookmark-ext-status");
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
                if (wsData.databases?.length > 0) {
                    UI.updateAITargetDbOptions(wsData.databases);
                }
            } catch {}
            const savedTargetDb = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");
            if (savedTargetDb) {
                (refs.aiTargetDbSelect || panel.querySelector("#ldb-ai-target-db")).value = savedTargetDb;
            }

            // 初始化日志面板
            UI.updateLogPanel();

            // 加载缓存的工作区页面列表（校验 API Key）
            const cachedWorkspace = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
            try {
                const workspaceData = JSON.parse(cachedWorkspace);
                const currentApiKey = (refs.apiKeyInput || panel.querySelector("#ldb-api-key")).value.trim();
                const currentKeyHash = currentApiKey ? currentApiKey.slice(-8) : "";
                // 仅当 API Key 匹配时才显示缓存
                if (workspaceData.apiKeyHash === currentKeyHash &&
                    (workspaceData.databases?.length > 0 || workspaceData.pages?.length > 0)) {
                    UI.updateWorkspaceSelect(workspaceData);
                }
            } catch {}

            // 加载自动导入设置
            const savedSource = Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, CONFIG.DEFAULTS.bookmarkSource);
            const resolvedSource = savedSource === "github" ? "github" : "linuxdo";
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, resolvedSource);
            UI.applyBookmarkSourceUI(resolvedSource);

            const autoConfig = UI.getAutoImportConfigBySource();
            const autoImportEnabled = Storage.get(autoConfig.enabledKey, autoConfig.enabledDefault);
            (refs.autoImportEnabled || panel.querySelector("#ldb-auto-import-enabled")).checked = autoImportEnabled;
            (refs.autoImportOptions || panel.querySelector("#ldb-auto-import-options")).style.display = autoImportEnabled ? "block" : "none";
            const autoImportInterval = Storage.get(autoConfig.intervalKey, autoConfig.intervalDefault);
            const intervalSelect = refs.autoImportInterval || panel.querySelector("#ldb-auto-import-interval");
            intervalSelect.value = autoImportInterval;
            // 如果存储的值不在选项中，回退到默认值
            if (intervalSelect.selectedIndex === -1) {
                intervalSelect.value = autoConfig.intervalDefault;
                Storage.set(autoConfig.intervalKey, autoConfig.intervalDefault);
            }

            const linuxdoDedupMode = Utils.getLinuxDoImportDedupMode();
            const linuxdoDedupSelect = refs.linuxdoDedupModeSelect || panel.querySelector("#ldb-linuxdo-dedup-mode");
            linuxdoDedupSelect.value = linuxdoDedupMode;
            if (linuxdoDedupSelect.selectedIndex === -1) {
                linuxdoDedupSelect.value = CONFIG.DEFAULTS.linuxdoImportDedupMode;
                Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.linuxdoImportDedupMode);
            }

            const bookmarkDedupMode = Utils.getBookmarkImportDedupMode();
            const bookmarkDedupSelect = refs.bookmarkDedupModeSelect || panel.querySelector("#ldb-bookmark-dedup-mode");
            bookmarkDedupSelect.value = bookmarkDedupMode;
            if (bookmarkDedupSelect.selectedIndex === -1) {
                bookmarkDedupSelect.value = CONFIG.DEFAULTS.bookmarkImportDedupMode;
                Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.bookmarkImportDedupMode);
            }

            (refs.aiCategoryAutoDedupCheckbox || panel.querySelector("#ldb-ai-category-auto-dedup")).checked = Storage.get(
                CONFIG.STORAGE_KEYS.AI_CATEGORY_AUTO_DEDUP,
                CONFIG.DEFAULTS.aiCategoryAutoDedup
            );

            const updateAutoEnabled = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled);
            const updateIntervalHours = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
            const updateAutoEnabledEl = refs.updateAutoEnabled || panel.querySelector("#ldb-update-auto-enabled");
            const updateAutoOptionsEl = refs.updateAutoOptions || panel.querySelector("#ldb-update-auto-options");
            const updateIntervalEl = refs.updateIntervalHours || panel.querySelector("#ldb-update-interval-hours");
            updateAutoEnabledEl.checked = updateAutoEnabled;
            updateAutoOptionsEl.style.display = updateAutoEnabled ? "block" : "none";
            updateIntervalEl.value = String(updateIntervalHours);
            if (updateIntervalEl.selectedIndex === -1) {
                updateIntervalEl.value = String(CONFIG.DEFAULTS.updateCheckIntervalHours);
                Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
            }
            UpdateChecker.renderLastStatus();
        },

        renderSelfCheckResult: () => {
            const panel = UI.panel;
            if (!panel) return;

            const refs = UI.refs || {};
            const resultEl = refs.selfCheckResult || panel.querySelector("#ldb-self-check-result");
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
            const activeTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, "bookmarks");
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
            const container = (UI.refs && UI.refs.statusContainer) || UI.panel.querySelector("#ldb-status-container");
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
            const container = (UI.refs && UI.refs.statusContainer) || UI.panel.querySelector("#ldb-status-container");
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
            ((UI.refs && UI.refs.statusContainer) || UI.panel.querySelector("#ldb-status-container")).innerHTML = "";
        },

        // 更新 AI 模型选项
        updateAIModelOptions: (service, customModels = null, preserveSelection = false) => {
            const refs = UI.refs || {};
            const modelSelect = refs.aiModelSelect || UI.panel.querySelector("#ldb-ai-model");
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
            const select = refs.workspaceSelect || UI.panel.querySelector("#ldb-workspace-select");
            if (!select) return;

            const { databases = [], pages = [] } = workspaceData;
            const savedDatabaseId = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            const savedPageId = Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "");
            const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
            const restoreValue = exportTargetType === "page"
                ? (savedPageId ? `page:${savedPageId}` : "")
                : (savedDatabaseId ? `database:${savedDatabaseId}` : "");

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
            const select = refs.aiTargetDbSelect || UI.panel.querySelector("#ldb-ai-target-db");
            if (!select) return;

            const savedValue = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, "");

            // 保留固定选项，添加数据库列表
            let options = '<option value="">当前配置的数据库</option>';
            options += '<option value="__all__">所有工作区数据库</option>';

            if (databases.length > 0) {
                options += '<optgroup label="📁 指定数据库">';
                databases.forEach(db => {
                    options += `<option value="${db.id}">📁 ${Utils.escapeHtml(db.title)}</option>`;
                });
                options += '</optgroup>';
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
                    });
                } catch (error) {
                    console.warn(`[UI] GitHub 手动导出失败: ${item.itemKey}`, error);
                    failed.push({
                        title: item.title,
                        error: error.message,
                    });
                }

                if (i < selectedItems.length - 1 && delay > 0) {
                    await Utils.sleep(delay);
                }
            }

            return { success, failed, skipped: [] };
        },

        // 渲染收藏列表
        renderBookmarkList: () => {
            const list = (UI.refs && UI.refs.bookmarkList) || UI.panel.querySelector("#ldb-bookmark-list");
            UI.recomputeExportStats();
            if (!UI.bookmarks || UI.bookmarks.length === 0) {
                list.innerHTML = '<div style="padding: 12px; text-align: center; color: #666;">暂无收藏</div>';
                UI.updateSelectCount();
                return;
            }

            const githubMode = UI.isActiveGitHubSource();
            list.innerHTML = UI.bookmarks.map((b) => {
                const bookmarkKey = UI.getBookmarkKey(b);
                const title = b.title || b.name || `帖子 ${bookmarkKey}`;
                const isExported = UI.isBookmarkKeyExported(bookmarkKey);
                const isSelected = UI.selectedBookmarks?.has(bookmarkKey);
                const sourceTag = githubMode
                    ? `<span class="status" style="margin-right: 6px;">${(b.sourceType || "stars").toUpperCase()}</span>`
                    : "";

                return `
                    <div class="ldb-bookmark-item" data-topic-id="${bookmarkKey}">
                        <input type="checkbox" ${isSelected ? "checked" : ""} ${isExported ? "disabled" : ""}>
                        <span class="title" title="${title}">${Utils.truncateText(title, 35)}</span>
                        ${sourceTag}${isExported ? '<span class="status exported">已导出</span>' : '<span class="status pending">待导出</span>'}
                    </div>
                `;
            }).join("");

            UI.updateSelectCount();
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

            ((UI.refs && UI.refs.selectCount) || UI.panel.querySelector("#ldb-select-count")).textContent = `已选 ${count} 个，待导出 ${Math.max(0, pendingCount)} 个`;

            // 更新全选框状态
            const selectAll = (UI.refs && UI.refs.selectAll) || UI.panel.querySelector("#ldb-select-all");
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
        },

        // 显示导出报告
        showReport: (results) => {
            const container = (UI.refs && UI.refs.reportContainer) || UI.panel.querySelector("#ldb-report-container");
            const { success, failed, skipped } = results;

            let html = '<div class="ldb-report">';
            html += '<div class="ldb-report-title">📊 导出报告</div>';

            if (success.length > 0) {
                html += '<div class="ldb-report-section">';
                html += `<div class="ldb-report-section-title">✅ 成功 (${success.length})</div>`;
                success.slice(0, 10).forEach(item => {
                    html += `<div class="ldb-report-item success">
                        <span>✓</span>
                        <a href="${item.url}" target="_blank">${Utils.truncateText(item.title, 40)}</a>
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
                        <span>${Utils.truncateText(item.title, 35)}</span>
                    </div>`;
                    html += `<div class="ldb-report-error">${item.error}</div>`;
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
    };

    // ===========================================
    // 通用网页剪藏 UI
    // ===========================================
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

            const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            const dbId = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            const parentPageId = Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "");
            const exportType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, "database");
            const imgMode = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, "external");
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
                                <input type="password" id="gclip-api-key-input" class="gclip-input" placeholder="${Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY) ? '已配置 (点击保存可更新)' : 'secret_...'}" value="" style="flex:1;font-size:12px;" autocomplete="off" />
                                <button class="gclip-btn" id="gclip-save-api-key" style="padding:4px 12px;font-size:12px;">保存</button>
                            </div>
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

            const apiKeyForInit = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            GenericUI.loadTargetOptionsFromCache(apiKeyForInit);
            if (apiKeyForInit) {
                GenericUI.refreshWorkspaceTargets(apiKeyForInit, true);
            }
            return panel;
        },

        updateTargetSelectOptions: (databases = [], pages = []) => {
            const panel = GenericUI.panel;
            if (!panel) return;

            const select = panel.querySelector("#gclip-target-select");
            const exportType = panel.querySelector("#gclip-export-type")?.value || "database";
            if (!select) return;

            const savedDatabaseId = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            const savedPageId = Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "");
            const restoreValue = exportType === "page"
                ? (savedPageId ? `page:${savedPageId}` : "")
                : savedDatabaseId;

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
                if (!silent) GenericUI.showStatus("请先设置 Notion API Key", "error");
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
                const workspace = await WorkspaceService.fetchWorkspaceStaged(apiKey, {
                    includePages: true,
                    onProgress: (progress) => {
                        if (!tip) return;
                        if (progress.phase === "databases") {
                            tip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                        } else if (progress.phase === "pages") {
                            tip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                        }
                    },
                    onPhaseComplete: (phase, partialWorkspace) => {
                        const workspaceData = {
                            apiKeyHash: apiKey.slice(-8),
                            databases: partialWorkspace.databases || [],
                            pages: partialWorkspace.pages || [],
                            timestamp: Date.now(),
                        };
                        Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));
                        GenericUI.updateTargetSelectOptions(workspaceData.databases, workspaceData.pages);
                        if (tip && phase === "databases") {
                            tip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                        }
                    },
                });

                const workspaceData = {
                    apiKeyHash: apiKey.slice(-8),
                    databases: workspace.databases,
                    pages: workspace.pages,
                    timestamp: Date.now(),
                };
                Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));

                GenericUI.updateTargetSelectOptions(workspace.databases, workspace.pages);
                if (tip) {
                    tip.textContent = `已加载 ${workspace.databases.length} 个数据库，${workspace.pages.filter(p => p.parent === "workspace").length} 个页面`;
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
            } catch {}

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
                GenericUI.loadTargetOptionsFromCache(Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""));
            });

            // 刷新工作区目标列表
            panel.querySelector("#gclip-refresh-workspace").addEventListener("click", async () => {
                const keyInput = panel.querySelector("#gclip-api-key-input").value.trim();
                const apiKey = keyInput || Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
                await GenericUI.refreshWorkspaceTargets(apiKey);
            });

            // 手动输入开关
            panel.querySelector("#gclip-toggle-manual-target").addEventListener("click", () => {
                const wrap = panel.querySelector("#gclip-manual-target-wrap");
                const visible = wrap.style.display !== "none";
                wrap.style.display = visible ? "none" : "block";
            });

            // 保存 API Key（从面板内密码输入框读取，避免使用可被宿主页面拦截的 prompt()）
            panel.querySelector("#gclip-save-api-key").addEventListener("click", () => {
                const key = panel.querySelector("#gclip-api-key-input").value.trim();
                if (key) {
                    Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, key);
                    panel.querySelector("#gclip-api-key-input").value = "";
                    panel.querySelector("#gclip-api-key-input").placeholder = "已配置 (点击保存可更新)";
                    GenericUI.showStatus("API Key 已保存", "success");
                } else {
                    GenericUI.showStatus("请输入 API Key", "error");
                }
            });

            // 保存配置
            panel.querySelector("#gclip-save-settings").addEventListener("click", async () => {
                // 仅当用户主动输入了新 key 时才更新（不从 DOM 预填，防止泄漏）
                const liveKey = panel.querySelector("#gclip-api-key-input").value.trim();
                if (liveKey) {
                    Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, liveKey);
                    panel.querySelector("#gclip-api-key-input").value = "";
                    panel.querySelector("#gclip-api-key-input").placeholder = "已配置 (点击保存可更新)";
                }
                const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY);
                const exportType = panel.querySelector("#gclip-export-type").value;
                const selectValue = panel.querySelector("#gclip-target-select")?.value || "";
                const manualTargetId = panel.querySelector("#gclip-target-id").value.trim().replace(/-/g, "");
                const selectedTargetId = selectValue.startsWith("page:") ? selectValue.slice(5) : selectValue;
                const targetId = (selectedTargetId || manualTargetId).replace(/-/g, "");
                const imgMode = panel.querySelector("#gclip-img-mode").value;

                if (!apiKey) return GenericUI.showStatus("请先设置 Notion API Key", "error");
                if (!targetId) return GenericUI.showStatus("请先选择目标，或手动输入 ID", "error");

                Storage.set(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, exportType);
                Storage.set(CONFIG.STORAGE_KEYS.IMG_MODE, imgMode);

                if (exportType === "page") {
                    Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, targetId);
                } else {
                    Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, targetId);
                    // 自动设置数据库属性
                    GenericUI.showStatus("正在配置数据库属性...", "info");
                    const result = await GenericExporter.setupDatabaseProperties(targetId, apiKey);
                    if (!result.success) {
                        return GenericUI.showStatus(`配置失败: ${result.message || result.error}`, "error");
                    }
                }

                GenericUI.loadTargetOptionsFromCache(apiKey);

                GenericUI.showStatus("配置已保存", "success");
                panel.querySelector("#gclip-settings").style.display = "none";
                panel.querySelector("#gclip-export").style.display = "block";
                panel.querySelector("#gclip-show-settings").style.display = "block";
            });

            // 显示设置（不在 DOM 中预填 API Key，防止第三方页面读取）
            panel.querySelector("#gclip-show-settings").addEventListener("click", () => {
                const settings = panel.querySelector("#gclip-settings");
                const showing = settings.style.display === "none";
                if (showing) {
                    const exportType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, "database");
                    panel.querySelector("#gclip-export-type").value = exportType;
                    panel.querySelector("#gclip-target-label").textContent = exportType === "page" ? "父页面" : "数据库";

                    const tid = exportType === "page"
                        ? Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "")
                        : Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
                    panel.querySelector("#gclip-target-id").value = tid;

                    const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
                    GenericUI.loadTargetOptionsFromCache(apiKey);
                    if (apiKey) {
                        GenericUI.refreshWorkspaceTargets(apiKey, true);
                    }
                    // API Key 不预填到 DOM，用户需手动输入或留空使用已保存配置
                }
                settings.style.display = showing ? "block" : "none";
            });

            // 导出按钮
            panel.querySelector("#gclip-export").addEventListener("click", () => {
                GenericUI.doExport();
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
                const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
                const exportType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, "database");
                const imgMode = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, "external");

                const settings = {
                    apiKey,
                    exportTargetType: exportType,
                    databaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                    parentPageId: Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, ""),
                    imgMode,
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

    // ===========================================
    // 入口
    // ===========================================
    function main() {
        const initUI = () => {
            // 初始化主题系统
            DesignSystem.initTheme();

            const currentSite = SiteDetector.detect();

            if (currentSite === SiteDetector.SITES.LINUX_DO) {
                // 所有 Linux.do 页面均显示面板（导出/AI 助手/设置）
                UI.init();
                UpdateChecker.init();
                // 非收藏页面额外启动后台自动导入
                const isBookmarkPage = /\/u\/[^/]+\/activity\/bookmarks/.test(window.location.pathname);
                if (!isBookmarkPage) {
                    AutoImporter.init();
                }
            } else if (currentSite === SiteDetector.SITES.NOTION) {
                // Notion 站点：初始化浮动 AI 助手
                NotionSiteUI.init();
            } else if (currentSite === SiteDetector.SITES.GITHUB) {
                // GitHub 站点：使用与 Linux.do 同步的完整面板
                UI.init();
                UpdateChecker.init();
                GitHubAutoImporter.init();
            } else if (currentSite === SiteDetector.SITES.GENERIC) {
                // 通用网页：初始化剪藏按钮
                GenericUI.init();
            }
        };

        // 等待页面加载完成
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initUI);
        } else {
            initUI();
        }
    }

    main();
})();
