// ==UserScript==
// @name         Linux.do 收藏帖子导出到 Notion
// @namespace    https://linux.do/
// @version      1.7.0
// @description  批量导出 Linux.do 收藏的帖子到 Notion 数据库或页面，支持自定义筛选、图片上传、权限控制、AI 对话式助手，在 Notion 站点显示 AI 助手面板
// @author       基于 flobby 和 JackLiii 的作品改编
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js
// @downloadURL  https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js
// @match        https://linux.do/u/*/activity/bookmarks*
// @match        https://www.notion.so/*
// @match        https://notion.so/*
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
            // 模型缓存
            FETCHED_MODELS: "ldb_fetched_models",
            // 工作区页面缓存
            WORKSPACE_PAGES: "ldb_workspace_pages",
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

        formatDate: (dateStr) => {
            if (!dateStr) return "";
            return new Date(dateStr).toLocaleString("zh-CN");
        },

        truncateText: (text, maxLen = 100) => {
            if (!text || text.length <= maxLen) return text;
            return text.substring(0, maxLen) + "...";
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
    };

    // ===========================================
    // 存储管理
    // ===========================================
    const Storage = {
        get: (key, defaultValue = null) => {
            const value = GM_getValue(key, defaultValue);
            return value;
        },

        set: (key, value) => {
            GM_setValue(key, value);
        },

        getExportedTopics: () => {
            const data = GM_getValue(CONFIG.STORAGE_KEYS.EXPORTED_TOPICS, "{}");
            try {
                return JSON.parse(data);
            } catch {
                return {};
            }
        },

        markTopicExported: (topicId) => {
            const exported = Storage.getExportedTopics();
            exported[topicId] = Date.now();
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
        },

        // 检测当前站点
        detect: () => {
            const hostname = window.location.hostname;
            if (hostname.includes("linux.do")) {
                return SiteDetector.SITES.LINUX_DO;
            }
            if (hostname.includes("notion.so")) {
                return SiteDetector.SITES.NOTION;
            }
            return null;
        },

        // 判断是否在 Linux.do 站点
        isLinuxDo: () => {
            return SiteDetector.detect() === SiteDetector.SITES.LINUX_DO;
        },

        // 判断是否在 Notion 站点
        isNotion: () => {
            return SiteDetector.detect() === SiteDetector.SITES.NOTION;
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
            const chunks = [];
            if (text.length <= maxLength) {
                chunks.push({ type: "text", text: { content: text }, annotations: { ...annotations } });
            } else {
                let remaining = text;
                while (remaining.length > 0) {
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
            return result;
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

        // 下载并上传图片到 Notion
        uploadImageToNotion: async (imageUrl, apiKey) => {
            try {
                // 下载图片
                const response = await fetch(imageUrl);
                if (!response.ok) throw new Error(`下载失败: ${response.status}`);

                const blob = await response.blob();
                const urlObj = new URL(imageUrl);
                let ext = urlObj.pathname.split(".").pop()?.toLowerCase() || "png";
                if (!["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) ext = "png";

                const contentType = blob.type || `image/${ext}`;
                const filename = `image-${Date.now()}.${ext}`;

                // 创建上传
                const fileUpload = await NotionAPI.createFileUpload(filename, contentType, apiKey);
                if (!fileUpload?.upload_url) throw new Error("创建上传失败");

                // 上传内容到预签名 URL (不需要 API Key)
                await NotionAPI.uploadFileContent(fileUpload.upload_url, blob, contentType, filename);

                return fileUpload.id;
            } catch (error) {
                console.error("上传图片失败:", error);
                return null;
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
            HELP: "help",             // 帮助
            COMPOUND: "compound",     // 组合指令
            UNKNOWN: "unknown"        // 未知
        },

        // 获取帮助信息
        getHelpMessage: () => {
            return `你好！我是你的 Notion 数据库助手。以下是我能帮你做的事情：

📊 **查询统计**
- "有多少个帖子？"
- "统计各分类的帖子数量"
- "显示最新的 5 个帖子"

🔍 **搜索帖子**（在配置的数据库内）
- "搜索关于 Docker 的帖子"
- "找一下作者是 xxx 的帖子"

🌐 **工作区搜索**（搜索整个 Notion 工作区）
- "在整个工作区搜索 Docker"
- "全局搜索 xxx"
- "列出所有数据库"
- "搜索所有页面"

🏷️ **智能分类**
- "自动分类所有未分类的帖子"
- "把最近的帖子分类一下"

✏️ **更新属性**
- "把作者是 xxx 的帖子标记为重要"

📦 **移动页面**（需要高级权限）
- "把标题包含 Docker 的帖子移到 B 数据库"
- "把 A 数据库的帖子移到 B 数据库"

📋 **复制页面**（需要高级权限）
- "复制标题包含 xxx 的帖子到 B 数据库"
- "把 A 数据库的帖子复制到 B 数据库"

🔗 **组合指令**
- "把帖子分类后移动到 B 数据库"
- "先分类所有帖子，再把技术类的移到技术库"

💡 **提示**：直接用自然语言告诉我你想做什么就行！
⚠️ 移动和复制操作需要「高级」权限级别。`;
        },

        // 获取 AI 设置
        getSettings: () => {
            const panel = UI.panel;
            return {
                notionApiKey: panel.querySelector("#ldb-api-key")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""),
                notionDatabaseId: panel.querySelector("#ldb-database-id")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                aiApiKey: panel.querySelector("#ldb-ai-api-key")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: panel.querySelector("#ldb-ai-service")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService),
                aiModel: panel.querySelector("#ldb-ai-model")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, ""),
                aiBaseUrl: panel.querySelector("#ldb-ai-base-url")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
                categories: (panel.querySelector("#ldb-ai-categories")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories))
                    .split(/[,，]/).map(c => c.trim()).filter(Boolean),
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
            const systemPrompt = `你是一个 Notion 数据库助手。分析用户指令，返回 JSON 格式。

用户可能想执行以下操作之一：
1. query - 查询统计（如：有多少帖子、统计分类数量、显示最新帖子）
2. search - 在配置的数据库内搜索（如：搜索关于xxx的帖子、找作者是xxx的）
3. workspace_search - 在整个工作区搜索（如：全局搜索xxx、在工作区搜索、搜索所有页面、列出所有数据库）
4. classify - 分类单个（如：把这个帖子分类为技术）
5. batch_classify - 批量分类（如：自动分类所有未分类的帖子）
6. update - 更新属性（如：把xxx标记为重要）
7. move - 移动页面到另一个数据库（如：把A数据库的帖子移到B数据库、把标题包含xxx的帖子移到B数据库）
8. copy - 复制页面到另一个数据库（如：把A数据库的帖子复制到B数据库、复制标题包含xxx的帖子到B数据库）
9. compound - 用户指令包含两个及以上需按顺序执行的不同操作（如：先分类再移动、分类后移到B数据库）
10. help - 帮助（如：帮助、你能做什么）
11. unknown - 无法理解

注意区分 search 和 workspace_search：
- search: 用户想在配置的帖子数据库中搜索
- workspace_search: 用户明确提到"工作区"、"全局"、"所有页面"、"所有数据库"等，或者想搜索数据库以外的内容

注意区分 move 和 copy：
- move: 用户想把页面从一个数据库移动到另一个数据库（原数据库的页面会消失）
- copy: 用户想把页面复制到另一个数据库（原数据库的页面保留）
- 关键词提示：移动/移/搬/转移 → move；复制/拷贝/副本/备份到 → copy

compound 判断依据：
- 用户指令中含"先...再..."、"...之后..."、"...然后..."、"...后..."等顺序词，且涉及两个不同操作
- 单个操作不算 compound（如"移动帖子"只是 move）
- 同一操作的补充说明不算 compound（如"搜索 Docker 并显示前5条"只是 search）

返回格式（只返回 JSON，不要其他内容）：

单操作格式：
{
  "intent": "query|search|workspace_search|classify|batch_classify|update|move|copy|help|unknown",
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

            // 检查基础配置（不检查数据库 ID，因为工作区搜索不需要）
            const basicConfigCheck = AIAssistant.checkConfig(settings, false);
            if (!basicConfigCheck.valid) {
                return basicConfigCheck.error;
            }

            // 解析意图
            ChatState.updateLastMessage("正在理解你的指令...", "processing");

            const intentResult = await AIAssistant.parseIntent(userMessage, settings);

            // 执行意图（各个 handler 会检查自己需要的配置）
            return await AIAssistant.executeIntent(intentResult, settings);
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

                // 使用 Notion 搜索 API
                const response = await NotionAPI.search(
                    keyword,
                    filter,
                    settings.notionApiKey
                );

                const results = response.results || [];

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
    };

    // ===========================================
    // 对话 UI 模块
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
                container.innerHTML = `
                    <div class="ldb-chat-welcome">
                        <div class="ldb-chat-welcome-icon">🤖</div>
                        <div class="ldb-chat-welcome-text">
                            你好！我是 AI 助手<br>
                            <small>试试输入「帮助」查看我能做什么</small>
                        </div>
                    </div>
                `;
                return;
            }

            container.innerHTML = ChatState.messages.map(msg => {
                const isUser = msg.role === "user";
                const statusClass = msg.status === "processing" ? "processing" : (msg.status === "error" ? "error" : "");

                // 使用安全的 Markdown 渲染（防止 XSS）
                const content = ChatUI.safeMarkdown(msg.content);

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
                input.oninput = (e) => e.stopPropagation();
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
            deletePage: 2,
            restorePage: 2,
            deleteBlock: 2,
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
                    const fileId = await NotionAPI.uploadImageToNotion(block._originalUrl, apiKey);
                    if (fileId) {
                        // Notion File Upload API 需要使用 file_upload 类型引用上传的文件
                        // 参考: https://developers.notion.com/docs/working-with-files-and-media
                        block.image = {
                            type: "file_upload",
                            file_upload: {
                                id: fileId, // 使用上传返回的 file_id
                            },
                        };
                        block._uploaded = true;
                    } else {
                        // 上传失败，回退到外链模式
                        block.image = {
                            type: "external",
                            external: { url: block._originalUrl },
                        };
                    }
                } catch (e) {
                    console.warn("图片上传失败，保留外链:", block._originalUrl, e.message);
                    // 保留外链模式
                    block.image = {
                        type: "external",
                        external: { url: block._originalUrl },
                    };
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
            Exporter.currentIndex = startIndex;

            for (let i = startIndex; i < bookmarks.length; i++) {
                // 检查暂停
                while (Exporter.isPaused) {
                    await Utils.sleep(200);
                    if (Exporter.isCancelled) break;
                }

                // 检查取消
                if (Exporter.isCancelled) {
                    results.skipped = bookmarks.slice(i).map(b => ({
                        topicId: b.topic_id || b.bookmarkable_id,
                        title: b.title || b.name || `帖子 ${b.topic_id || b.bookmarkable_id}`,
                    }));
                    break;
                }

                Exporter.currentIndex = i;
                const bookmark = bookmarks[i];
                const topicId = bookmark.topic_id || bookmark.bookmarkable_id;
                const title = bookmark.title || bookmark.name || `帖子 ${topicId}`;

                onProgress?.({
                    current: i + 1,
                    total: bookmarks.length,
                    title: title,
                    stage: "start",
                    isPaused: Exporter.isPaused,
                });

                try {
                    await Exporter.exportTopic(bookmark, settings, (detail) => {
                        onProgress?.({
                            current: i + 1,
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

                // 避免请求过快
                if (i < bookmarks.length - 1 && !Exporter.isCancelled) {
                    const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
                    await Utils.sleep(delay);
                }
            }

            return results;
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
            const style = document.createElement("style");
            style.textContent = `
                /* Notion 站点浮动按钮 */
                .ldb-notion-float-btn {
                    position: fixed;
                    right: 24px;
                    bottom: 24px;
                    width: 56px;
                    height: 56px;
                    background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
                    border: none;
                    border-radius: 28px;
                    color: #fff;
                    font-size: 24px;
                    cursor: pointer;
                    box-shadow: 0 4px 16px rgba(74, 144, 217, 0.4);
                    z-index: 99999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: transform 0.2s, box-shadow 0.2s;
                }

                .ldb-notion-float-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 20px rgba(74, 144, 217, 0.5);
                }

                /* Notion 站点浮动面板 */
                .ldb-notion-panel {
                    position: fixed;
                    right: 24px;
                    bottom: 96px;
                    width: 380px;
                    max-height: 70vh;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 1px solid #0f3460;
                    border-radius: 16px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    z-index: 99999;
                    color: #e0e0e0;
                    overflow: hidden;
                    display: none;
                }

                .ldb-notion-panel.visible {
                    display: block;
                    animation: ldb-notion-slide-up 0.3s ease;
                }

                @keyframes ldb-notion-slide-up {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }

                .ldb-notion-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 14px 16px;
                    background: linear-gradient(90deg, #0f3460 0%, #1a1a2e 100%);
                    cursor: move;
                }

                .ldb-notion-header h3 {
                    margin: 0;
                    font-size: 15px;
                    font-weight: 600;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .ldb-notion-header-btns {
                    display: flex;
                    gap: 8px;
                }

                .ldb-notion-header-btn {
                    background: rgba(255, 255, 255, 0.1);
                    border: none;
                    color: #fff;
                    width: 26px;
                    height: 26px;
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s;
                    font-size: 14px;
                }

                .ldb-notion-header-btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                }

                .ldb-notion-body {
                    padding: 16px;
                    max-height: calc(70vh - 60px);
                    overflow-y: auto;
                }

                .ldb-notion-body::-webkit-scrollbar {
                    width: 6px;
                }

                .ldb-notion-body::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.05);
                }

                .ldb-notion-body::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 3px;
                }

                /* 复用聊天样式 */
                .ldb-notion-panel .ldb-chat-container {
                    height: 260px;
                }

                .ldb-notion-panel .ldb-input-group {
                    margin-bottom: 12px;
                }

                .ldb-notion-panel .ldb-label {
                    display: block;
                    font-size: 13px;
                    color: #b0b0b0;
                    margin-bottom: 6px;
                }

                .ldb-notion-panel .ldb-input {
                    width: 100%;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    color: #fff;
                    font-size: 14px;
                    box-sizing: border-box;
                    transition: border-color 0.2s;
                }

                .ldb-notion-panel .ldb-input:focus {
                    outline: none;
                    border-color: #4a90d9;
                }

                .ldb-notion-panel .ldb-input::placeholder {
                    color: #666;
                }

                .ldb-notion-panel .ldb-select {
                    width: 100%;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    color: #fff;
                    font-size: 14px;
                    cursor: pointer;
                }

                .ldb-notion-panel .ldb-select option {
                    background: #1a1a2e;
                    color: #fff;
                }

                .ldb-notion-panel .ldb-btn {
                    width: 100%;
                    padding: 10px;
                    border: none;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                }

                .ldb-notion-panel .ldb-btn-secondary {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }

                .ldb-notion-panel .ldb-btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.15);
                }

                .ldb-notion-panel .ldb-tip {
                    font-size: 11px;
                    color: #666;
                    margin-top: 6px;
                }

                .ldb-notion-panel .ldb-divider {
                    height: 1px;
                    background: rgba(255, 255, 255, 0.1);
                    margin: 16px 0;
                }

                .ldb-notion-panel .ldb-section-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: #a0a0a0;
                    margin-bottom: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .ldb-notion-panel .ldb-status {
                    position: relative;
                    padding: 10px 28px 10px 10px;
                    background: rgba(74, 144, 217, 0.1);
                    border: 1px solid rgba(74, 144, 217, 0.3);
                    border-radius: 8px;
                    font-size: 12px;
                    color: #4a90d9;
                    text-align: center;
                    margin-top: 12px;
                }

                .ldb-notion-panel .ldb-status.success {
                    background: rgba(52, 211, 153, 0.1);
                    border-color: rgba(52, 211, 153, 0.3);
                    color: #34d399;
                }

                .ldb-notion-panel .ldb-status.error {
                    background: rgba(239, 68, 68, 0.1);
                    border-color: rgba(239, 68, 68, 0.3);
                    color: #ef4444;
                }

                .ldb-notion-toggle-section {
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 0;
                    color: #888;
                    font-size: 12px;
                }

                .ldb-notion-toggle-section:hover {
                    color: #fff;
                }

                .ldb-notion-toggle-content {
                    overflow: hidden;
                    transition: max-height 0.3s ease;
                    max-height: 800px;
                }

                .ldb-notion-toggle-content.collapsed {
                    max-height: 0;
                }

                /* ===== ChatUI 样式 (Notion 站点) ===== */
                .ldb-chat-container {
                    height: 260px;
                    overflow-y: auto;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 12px;
                }

                .ldb-chat-container::-webkit-scrollbar {
                    width: 6px;
                }

                .ldb-chat-container::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 3px;
                }

                .ldb-chat-container::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 3px;
                }

                .ldb-chat-welcome {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    color: #888;
                }

                .ldb-chat-welcome-icon {
                    font-size: 48px;
                    margin-bottom: 12px;
                }

                .ldb-chat-welcome-text {
                    font-size: 14px;
                    line-height: 1.6;
                }

                .ldb-chat-welcome-text small {
                    color: #666;
                }

                .ldb-chat-message {
                    margin-bottom: 12px;
                    display: flex;
                    flex-direction: column;
                }

                .ldb-chat-message.user {
                    align-items: flex-end;
                }

                .ldb-chat-message.assistant {
                    align-items: flex-start;
                }

                .ldb-chat-bubble {
                    max-width: 85%;
                    padding: 10px 14px;
                    border-radius: 12px;
                    font-size: 13px;
                    line-height: 1.6;
                    word-break: break-word;
                }

                .ldb-chat-bubble.user {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-bottom-right-radius: 4px;
                }

                .ldb-chat-bubble.assistant {
                    background: rgba(255, 255, 255, 0.1);
                    color: #e0e0e0;
                    border-bottom-left-radius: 4px;
                }

                .ldb-chat-bubble.processing {
                    opacity: 0.8;
                }

                .ldb-chat-bubble.processing::after {
                    content: "";
                    display: inline-block;
                    width: 12px;
                    animation: ldb-dots 1.5s infinite;
                }

                @keyframes ldb-dots {
                    0%, 20% { content: "."; }
                    40% { content: ".."; }
                    60%, 100% { content: "..."; }
                }

                .ldb-chat-bubble.error {
                    border: 1px solid rgba(248, 113, 113, 0.5);
                }

                .ldb-chat-input-container {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .ldb-chat-input {
                    flex: 1;
                    padding: 10px 14px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    color: #fff;
                    font-size: 14px;
                    resize: none;
                    min-height: 40px;
                    max-height: 80px;
                }

                .ldb-chat-input:focus {
                    outline: none;
                    border-color: #4a90d9;
                }

                .ldb-chat-input::placeholder {
                    color: #666;
                }

                .ldb-chat-send-btn {
                    padding: 10px 16px;
                    background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
                    border: none;
                    border-radius: 12px;
                    color: white;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }

                .ldb-chat-send-btn:hover:not(:disabled) {
                    transform: scale(1.05);
                }

                .ldb-chat-send-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .ldb-chat-actions {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 8px;
                }

                .ldb-chat-action-btn {
                    padding: 6px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 6px;
                    color: #b0b0b0;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .ldb-chat-action-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }
            `;
            document.head.appendChild(style);
        },

        // 创建浮动按钮
        createFloatButton: () => {
            const btn = document.createElement("button");
            btn.className = "ldb-notion-float-btn";
            btn.innerHTML = "🤖";
            btn.title = "AI 助手";

            btn.onclick = () => {
                NotionSiteUI.togglePanel();
            };

            document.body.appendChild(btn);
            NotionSiteUI.floatBtn = btn;
            return btn;
        },

        // 创建面板
        createPanel: () => {
            const panel = document.createElement("div");
            panel.className = "ldb-notion-panel";
            panel.innerHTML = `
                <div class="ldb-notion-header">
                    <h3>🤖 AI 助手</h3>
                    <div class="ldb-notion-header-btns">
                        <button class="ldb-notion-header-btn" id="ldb-notion-close" title="关闭">×</button>
                    </div>
                </div>
                <div class="ldb-notion-body">
                    <!-- 对话区域 -->
                    <div class="ldb-chat-container" id="ldb-chat-messages">
                        <div class="ldb-chat-welcome">
                            <div class="ldb-chat-welcome-icon">🤖</div>
                            <div class="ldb-chat-welcome-text">
                                你好！我是 AI 助手<br>
                                <small>试试输入「帮助」查看我能做什么</small>
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
                            <label class="ldb-label">数据库 ID</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" class="ldb-input" id="ldb-notion-database-id" placeholder="32位数据库ID" style="flex: 1;">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-refresh-workspace" style="padding: 6px 12px; white-space: nowrap;" title="刷新工作区页面列表">🔄</button>
                            </div>
                            <select class="ldb-select" id="ldb-notion-workspace-select" style="margin-top: 6px; display: none;">
                                <option value="">-- 从工作区选择 --</option>
                            </select>
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

            // 关闭按钮
            panel.querySelector("#ldb-notion-close").onclick = () => {
                NotionSiteUI.togglePanel();
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
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, panel.querySelector("#ldb-notion-database-id").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, panel.querySelector("#ldb-notion-ai-service").value);
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, panel.querySelector("#ldb-notion-ai-model").value);
                Storage.set(CONFIG.STORAGE_KEYS.AI_API_KEY, panel.querySelector("#ldb-notion-ai-api-key").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.AI_BASE_URL, panel.querySelector("#ldb-notion-ai-base-url").value.trim());
                Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORIES, panel.querySelector("#ldb-notion-ai-categories").value.trim());

                NotionSiteUI.showStatus("设置已保存", "success");
            };

            // 刷新工作区页面列表
            panel.querySelector("#ldb-notion-refresh-workspace").onclick = async () => {
                const apiKey = panel.querySelector("#ldb-notion-api-key").value.trim();
                const refreshBtn = panel.querySelector("#ldb-notion-refresh-workspace");
                const workspaceTip = panel.querySelector("#ldb-notion-workspace-tip");
                const workspaceSelect = panel.querySelector("#ldb-notion-workspace-select");

                if (!apiKey) {
                    NotionSiteUI.showStatus("请先填写 Notion API Key", "error");
                    return;
                }

                refreshBtn.disabled = true;
                refreshBtn.innerHTML = "⏳";
                workspaceTip.textContent = "正在获取工作区页面...";

                try {
                    // 分页获取所有数据库
                    let allDbResults = [];
                    let dbCursor = undefined;
                    do {
                        const dbResponse = await NotionAPI.search("", { property: "object", value: "database" }, apiKey, dbCursor);
                        allDbResults = allDbResults.concat(dbResponse.results || []);
                        dbCursor = dbResponse.has_more ? dbResponse.next_cursor : undefined;
                    } while (dbCursor);

                    const databases = allDbResults.map(db => ({
                        id: db.id?.replace(/-/g, "") || "",
                        title: db.title?.[0]?.plain_text || "无标题数据库",
                        type: "database",
                        url: db.url || ""
                    }));

                    // 分页获取所有页面
                    let allPageResults = [];
                    let pageCursor = undefined;
                    do {
                        const pageResponse = await NotionAPI.search("", { property: "object", value: "page" }, apiKey, pageCursor);
                        allPageResults = allPageResults.concat(pageResponse.results || []);
                        pageCursor = pageResponse.has_more ? pageResponse.next_cursor : undefined;
                    } while (pageCursor);

                    const pages = allPageResults.map(page => ({
                        id: page.id?.replace(/-/g, "") || "",
                        title: Utils.getPageTitle(page),
                        type: "page",
                        url: page.url || "",
                        parent: page.parent?.type || ""
                    }));

                    // 合并并缓存（包含 API Key 标识）
                    const apiKeyHash = apiKey.slice(-8);
                    const workspaceData = {
                        apiKeyHash,
                        databases,
                        pages,
                        timestamp: Date.now()
                    };
                    Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));

                    // 更新下拉框
                    NotionSiteUI.updateWorkspaceSelect(workspaceData);
                    workspaceSelect.style.display = "block";
                    workspaceTip.textContent = `✅ 获取到 ${databases.length} 个数据库，${pages.length} 个页面`;
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
            panel.querySelector("#ldb-notion-workspace-select").onchange = (e) => {
                const selected = e.target.value;
                if (selected) {
                    const [type, id] = selected.split(":");
                    if (type === "database") {
                        panel.querySelector("#ldb-notion-database-id").value = id;
                        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, id);
                    } else if (type === "page") {
                        // 页面类型：提示用户这是页面 ID，不是数据库 ID
                        NotionSiteUI.showStatus("已选择页面 ID，可用于页面模式导出", "info");
                        panel.querySelector("#ldb-notion-database-id").value = id;
                        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, id);
                    }
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
            panel.querySelector("#ldb-notion-database-id").value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            panel.querySelector("#ldb-notion-ai-service").value = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
            panel.querySelector("#ldb-notion-ai-api-key").value = Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "");
            panel.querySelector("#ldb-notion-ai-base-url").value = Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, "");
            panel.querySelector("#ldb-notion-ai-categories").value = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories);

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

            // 预加载缓存的工作区数据（不自动显示下拉框，点击刷新时再显示）
            const cachedWorkspace = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
            try {
                const workspaceData = JSON.parse(cachedWorkspace);
                const currentApiKey = panel.querySelector("#ldb-notion-api-key").value.trim();
                const currentKeyHash = currentApiKey ? currentApiKey.slice(-8) : "";
                if (workspaceData.apiKeyHash === currentKeyHash &&
                    (workspaceData.databases?.length > 0 || workspaceData.pages?.length > 0)) {
                    NotionSiteUI.updateWorkspaceSelect(workspaceData);
                }
            } catch {}
        },

        // 更新工作区选择下拉框
        updateWorkspaceSelect: (workspaceData) => {
            const select = NotionSiteUI.panel.querySelector("#ldb-notion-workspace-select");
            if (!select) return;

            const { databases = [], pages = [] } = workspaceData;
            let options = '<option value="">-- 从工作区选择 --</option>';

            // 数据库组
            if (databases.length > 0) {
                options += '<optgroup label="📁 数据库">';
                databases.forEach(db => {
                    options += `<option value="database:${db.id}">📁 ${Utils.escapeHtml(db.title)}</option>`;
                });
                options += '</optgroup>';
            }

            // 页面组（只显示工作区顶级页面）
            const workspacePages = pages.filter(p => p.parent === "workspace");
            if (workspacePages.length > 0) {
                options += '<optgroup label="📄 工作区页面">';
                workspacePages.forEach(page => {
                    options += `<option value="page:${page.id}">📄 ${Utils.escapeHtml(page.title)}</option>`;
                });
                options += '</optgroup>';
            }

            select.innerHTML = options;
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
                        notionDatabaseId: notionPanel.querySelector("#ldb-notion-database-id")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                        aiApiKey: notionPanel.querySelector("#ldb-notion-ai-api-key")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                        aiService: aiService,
                        aiModel: aiModel,
                        aiBaseUrl: notionPanel.querySelector("#ldb-notion-ai-base-url")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
                        categories: (notionPanel.querySelector("#ldb-notion-ai-categories")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories))
                            .split(/[,，]/).map(c => c.trim()).filter(Boolean),
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

        // 样式
        injectStyles: () => {
            const style = document.createElement("style");
            style.textContent = `
                .ldb-panel {
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    width: 380px;
                    max-height: 80vh;
                    overflow-y: auto;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 1px solid #0f3460;
                    border-radius: 16px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    z-index: 99999;
                    color: #e0e0e0;
                    transition: all 0.3s ease;
                }

                .ldb-panel.minimized {
                    width: auto;
                    max-height: none;
                    overflow: visible;
                }

                .ldb-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 16px;
                    background: linear-gradient(90deg, #0f3460 0%, #1a1a2e 100%);
                    border-radius: 16px 16px 0 0;
                    cursor: move;
                }

                .ldb-header h3 {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 600;
                    color: #fff;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .ldb-header-btns {
                    display: flex;
                    gap: 8px;
                }

                .ldb-header-btn {
                    background: rgba(255, 255, 255, 0.1);
                    border: none;
                    color: #fff;
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s;
                }

                .ldb-header-btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                }

                .ldb-body {
                    padding: 16px;
                }

                .ldb-section {
                    margin-bottom: 16px;
                }

                .ldb-section-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: #a0a0a0;
                    margin-bottom: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                .ldb-input-group {
                    margin-bottom: 12px;
                }

                .ldb-label {
                    display: block;
                    font-size: 13px;
                    color: #b0b0b0;
                    margin-bottom: 6px;
                }

                .ldb-input {
                    width: 100%;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    color: #fff;
                    font-size: 14px;
                    box-sizing: border-box;
                    transition: border-color 0.2s;
                }

                .ldb-input:focus {
                    outline: none;
                    border-color: #4a90d9;
                }

                .ldb-input::placeholder {
                    color: #666;
                }

                .ldb-checkbox-group {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                }

                .ldb-checkbox-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    cursor: pointer;
                }

                .ldb-checkbox-item input {
                    width: 16px;
                    height: 16px;
                    cursor: pointer;
                }

                .ldb-checkbox-item span {
                    font-size: 13px;
                    color: #b0b0b0;
                }

                .ldb-select {
                    width: 100%;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    color: #fff;
                    font-size: 14px;
                    cursor: pointer;
                }

                .ldb-select option {
                    background: #1a1a2e;
                    color: #fff;
                }

                .ldb-range-group {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                }

                .ldb-range-group input {
                    flex: 1;
                    padding: 8px 10px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    color: #fff;
                    font-size: 13px;
                    text-align: center;
                    box-sizing: border-box;
                    min-width: 0;
                }

                .ldb-range-group span {
                    color: #666;
                }

                .ldb-btn {
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 10px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }

                .ldb-btn-primary {
                    background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
                    color: #fff;
                }

                .ldb-btn-primary:hover:not(:disabled) {
                    background: linear-gradient(135deg, #5a9fe9 0%, #458acd 100%);
                    transform: translateY(-1px);
                }

                .ldb-btn-secondary {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }

                .ldb-btn-secondary:hover:not(:disabled) {
                    background: rgba(255, 255, 255, 0.15);
                }

                .ldb-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .ldb-btn-group {
                    display: flex;
                    gap: 10px;
                    margin-top: 8px;
                }

                .ldb-btn-group .ldb-btn {
                    flex: 1;
                }

                .ldb-status {
                    position: relative;
                    padding: 12px 32px 12px 12px;
                    background: rgba(74, 144, 217, 0.1);
                    border: 1px solid rgba(74, 144, 217, 0.3);
                    border-radius: 10px;
                    font-size: 13px;
                    color: #4a90d9;
                    text-align: center;
                    margin-top: 12px;
                }

                .ldb-status-close {
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    color: inherit;
                    font-size: 16px;
                    cursor: pointer;
                    opacity: 0.6;
                    padding: 4px;
                    line-height: 1;
                }

                .ldb-status-close:hover {
                    opacity: 1;
                }

                .ldb-status.success {
                    background: rgba(52, 211, 153, 0.1);
                    border-color: rgba(52, 211, 153, 0.3);
                    color: #34d399;
                }

                .ldb-status.error {
                    background: rgba(239, 68, 68, 0.1);
                    border-color: rgba(239, 68, 68, 0.3);
                    color: #ef4444;
                }

                .ldb-progress {
                    margin-top: 12px;
                }

                .ldb-progress-bar {
                    height: 6px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 3px;
                    overflow: hidden;
                    margin-bottom: 8px;
                }

                .ldb-progress-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #4a90d9 0%, #34d399 100%);
                    border-radius: 3px;
                    transition: width 0.3s ease;
                }

                .ldb-progress-text {
                    font-size: 12px;
                    color: #888;
                    text-align: center;
                }

                .ldb-bookmarks-info {
                    padding: 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 10px;
                    margin-bottom: 16px;
                }

                .ldb-bookmarks-count {
                    font-size: 24px;
                    font-weight: 700;
                    color: #4a90d9;
                    text-align: center;
                }

                .ldb-bookmarks-label {
                    font-size: 12px;
                    color: #888;
                    text-align: center;
                    margin-top: 4px;
                }

                .ldb-mini-btn {
                    position: fixed;
                    right: 20px;
                    bottom: 80px;
                    width: 56px;
                    height: 56px;
                    background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
                    border: none;
                    border-radius: 28px;
                    color: #fff;
                    font-size: 24px;
                    cursor: pointer;
                    box-shadow: 0 4px 16px rgba(74, 144, 217, 0.4);
                    z-index: 99998;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: transform 0.2s, box-shadow 0.2s;
                }

                .ldb-mini-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 20px rgba(74, 144, 217, 0.5);
                }

                /* ===== AI 对话界面样式 ===== */
                .ldb-chat-container {
                    height: 280px;
                    overflow-y: auto;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 8px;
                    padding: 12px;
                    margin-bottom: 12px;
                }

                .ldb-chat-container::-webkit-scrollbar {
                    width: 6px;
                }

                .ldb-chat-container::-webkit-scrollbar-track {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 3px;
                }

                .ldb-chat-container::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 3px;
                }

                .ldb-chat-welcome {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    color: #888;
                }

                .ldb-chat-welcome-icon {
                    font-size: 48px;
                    margin-bottom: 12px;
                }

                .ldb-chat-welcome-text {
                    font-size: 14px;
                    line-height: 1.6;
                }

                .ldb-chat-welcome-text small {
                    color: #666;
                }

                .ldb-chat-message {
                    margin-bottom: 12px;
                    display: flex;
                    flex-direction: column;
                }

                .ldb-chat-message.user {
                    align-items: flex-end;
                }

                .ldb-chat-message.assistant {
                    align-items: flex-start;
                }

                .ldb-chat-bubble {
                    max-width: 85%;
                    padding: 10px 14px;
                    border-radius: 12px;
                    font-size: 13px;
                    line-height: 1.6;
                    word-break: break-word;
                }

                .ldb-chat-bubble.user {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-bottom-right-radius: 4px;
                }

                .ldb-chat-bubble.assistant {
                    background: rgba(255, 255, 255, 0.1);
                    color: #e0e0e0;
                    border-bottom-left-radius: 4px;
                }

                .ldb-chat-bubble.processing {
                    opacity: 0.8;
                }

                .ldb-chat-bubble.processing::after {
                    content: "";
                    display: inline-block;
                    width: 12px;
                    animation: ldb-dots 1.5s infinite;
                }

                @keyframes ldb-dots {
                    0%, 20% { content: "."; }
                    40% { content: ".."; }
                    60%, 100% { content: "..."; }
                }

                .ldb-chat-bubble.error {
                    border: 1px solid rgba(248, 113, 113, 0.5);
                }

                .ldb-chat-input-container {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 12px;
                }

                .ldb-chat-input {
                    flex: 1;
                    padding: 10px 14px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    color: #fff;
                    font-size: 14px;
                    resize: none;
                    min-height: 40px;
                    max-height: 80px;
                }

                .ldb-chat-input:focus {
                    outline: none;
                    border-color: #4a90d9;
                }

                .ldb-chat-input::placeholder {
                    color: #666;
                }

                .ldb-chat-send-btn {
                    padding: 10px 16px;
                    background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
                    border: none;
                    border-radius: 12px;
                    color: white;
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                }

                .ldb-chat-send-btn:hover:not(:disabled) {
                    transform: scale(1.05);
                }

                .ldb-chat-send-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .ldb-chat-actions {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 8px;
                }

                .ldb-chat-action-btn {
                    padding: 6px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 6px;
                    color: #b0b0b0;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .ldb-chat-action-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }

                .ldb-chat-settings-toggle {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 0;
                    cursor: pointer;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    margin-top: 8px;
                }

                .ldb-chat-settings-toggle:hover {
                    color: #fff;
                }

                .ldb-chat-settings-content {
                    overflow: hidden;
                    transition: max-height 0.3s ease;
                    max-height: 600px;
                }

                .ldb-chat-settings-content.collapsed {
                    max-height: 0;
                }

                .ldb-divider {
                    height: 1px;
                    background: rgba(255, 255, 255, 0.1);
                    margin: 16px 0;
                }

                .ldb-tip {
                    font-size: 11px;
                    color: #666;
                    margin-top: 6px;
                }

                .ldb-link {
                    color: #4a90d9;
                    text-decoration: none;
                }

                .ldb-link:hover {
                    text-decoration: underline;
                }

                @keyframes ldb-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                .ldb-spin {
                    animation: ldb-spin 1s linear infinite;
                }

                .ldb-toggle-section {
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 0;
                }

                .ldb-toggle-section:hover {
                    color: #fff;
                }

                .ldb-toggle-content {
                    overflow: hidden;
                    transition: max-height 0.3s ease;
                }

                .ldb-toggle-content.collapsed {
                    max-height: 0;
                }

                /* 收藏列表样式 */
                .ldb-bookmark-list {
                    max-height: 200px;
                    overflow-y: auto;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 8px;
                    margin-bottom: 12px;
                }

                .ldb-bookmark-item {
                    display: flex;
                    align-items: center;
                    padding: 8px 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .ldb-bookmark-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }

                .ldb-bookmark-item:last-child {
                    border-bottom: none;
                }

                .ldb-bookmark-item input[type="checkbox"] {
                    margin-right: 10px;
                    cursor: pointer;
                }

                .ldb-bookmark-item .title {
                    flex: 1;
                    font-size: 13px;
                    color: #ccc;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .ldb-bookmark-item .status {
                    font-size: 11px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    margin-left: 8px;
                }

                .ldb-bookmark-item .status.exported {
                    background: rgba(52, 211, 153, 0.2);
                    color: #34d399;
                }

                .ldb-bookmark-item .status.pending {
                    background: rgba(251, 191, 36, 0.2);
                    color: #fbbf24;
                }

                .ldb-select-all {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 0;
                    margin-bottom: 8px;
                }

                .ldb-select-all label {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: #888;
                    cursor: pointer;
                }

                .ldb-select-count {
                    font-size: 12px;
                    color: #4a90d9;
                }

                /* 控制按钮样式 */
                .ldb-control-btns {
                    display: flex;
                    gap: 8px;
                    margin-top: 8px;
                }

                .ldb-btn-warning {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    color: #fff;
                }

                .ldb-btn-warning:hover:not(:disabled) {
                    background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                }

                .ldb-btn-danger {
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    color: #fff;
                }

                .ldb-btn-danger:hover:not(:disabled) {
                    background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
                }

                .ldb-btn-small {
                    padding: 8px 12px;
                    font-size: 12px;
                }

                /* 导出报告样式 */
                .ldb-report {
                    margin-top: 12px;
                    padding: 12px;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 10px;
                    max-height: 200px;
                    overflow-y: auto;
                }

                .ldb-report-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 10px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .ldb-report-section {
                    margin-bottom: 10px;
                }

                .ldb-report-section-title {
                    font-size: 12px;
                    color: #888;
                    margin-bottom: 4px;
                }

                .ldb-report-item {
                    font-size: 12px;
                    padding: 4px 0;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .ldb-report-item.success {
                    color: #34d399;
                }

                .ldb-report-item.failed {
                    color: #ef4444;
                }

                .ldb-report-item a {
                    color: inherit;
                    text-decoration: none;
                }

                .ldb-report-item a:hover {
                    text-decoration: underline;
                }

                .ldb-report-error {
                    font-size: 11px;
                    color: #888;
                    margin-left: 16px;
                }

                /* 权限设置面板样式 */
                .ldb-permission-panel {
                    margin-top: 8px;
                    padding: 12px;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 10px;
                }

                .ldb-permission-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 10px;
                }

                .ldb-permission-row:last-child {
                    margin-bottom: 0;
                }

                .ldb-permission-label {
                    font-size: 13px;
                    color: #b0b0b0;
                }

                .ldb-permission-select {
                    width: 120px;
                    padding: 6px 10px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 6px;
                    color: #fff;
                    font-size: 13px;
                    cursor: pointer;
                }

                .ldb-permission-select option {
                    background: #1a1a2e;
                    color: #fff;
                }

                .ldb-toggle-switch {
                    position: relative;
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
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: rgba(255, 255, 255, 0.1);
                    transition: 0.3s;
                    border-radius: 24px;
                }

                .ldb-toggle-slider:before {
                    position: absolute;
                    content: "";
                    height: 18px;
                    width: 18px;
                    left: 3px;
                    bottom: 3px;
                    background-color: #fff;
                    transition: 0.3s;
                    border-radius: 50%;
                }

                .ldb-toggle-switch input:checked + .ldb-toggle-slider {
                    background-color: #4a90d9;
                }

                .ldb-toggle-switch input:checked + .ldb-toggle-slider:before {
                    transform: translateX(20px);
                }

                /* 操作日志面板样式 */
                .ldb-log-panel {
                    margin-top: 12px;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 10px;
                    overflow: hidden;
                }

                .ldb-log-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    background: rgba(0, 0, 0, 0.2);
                    cursor: pointer;
                }

                .ldb-log-header:hover {
                    background: rgba(255, 255, 255, 0.05);
                }

                .ldb-log-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: #a0a0a0;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .ldb-log-badge {
                    background: #4a90d9;
                    color: #fff;
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-weight: 600;
                }

                .ldb-log-content {
                    max-height: 200px;
                    overflow-y: auto;
                    transition: max-height 0.3s ease;
                }

                .ldb-log-content.collapsed {
                    max-height: 0;
                    overflow: hidden;
                }

                .ldb-log-item {
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    padding: 8px 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    font-size: 12px;
                }

                .ldb-log-item:last-child {
                    border-bottom: none;
                }

                .ldb-log-item .icon {
                    flex-shrink: 0;
                    font-size: 14px;
                }

                .ldb-log-item .content {
                    flex: 1;
                    min-width: 0;
                }

                .ldb-log-item .operation {
                    color: #fff;
                    font-weight: 500;
                }

                .ldb-log-item .time {
                    color: #666;
                    font-size: 11px;
                }

                .ldb-log-item .duration {
                    color: #888;
                    font-size: 11px;
                }

                .ldb-log-item .error {
                    color: #ef4444;
                    font-size: 11px;
                    margin-top: 2px;
                }

                .ldb-log-empty {
                    padding: 16px;
                    text-align: center;
                    color: #666;
                    font-size: 12px;
                }

                .ldb-log-actions {
                    padding: 8px 12px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    display: flex;
                    justify-content: flex-end;
                }

                .ldb-log-clear-btn {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 11px;
                    cursor: pointer;
                    padding: 4px 8px;
                    border-radius: 4px;
                }

                .ldb-log-clear-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }

                /* 确认对话框样式 */
                .ldb-confirm-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100000;
                    animation: ldb-fade-in 0.2s ease;
                }

                @keyframes ldb-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .ldb-confirm-dialog {
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 1px solid #ef4444;
                    border-radius: 16px;
                    width: 400px;
                    max-width: 90%;
                    box-shadow: 0 8px 32px rgba(239, 68, 68, 0.3);
                    animation: ldb-slide-up 0.3s ease;
                }

                @keyframes ldb-slide-up {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }

                .ldb-confirm-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 16px;
                    background: rgba(239, 68, 68, 0.1);
                    border-radius: 16px 16px 0 0;
                    border-bottom: 1px solid rgba(239, 68, 68, 0.2);
                }

                .ldb-confirm-icon {
                    font-size: 24px;
                }

                .ldb-confirm-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #ef4444;
                }

                .ldb-confirm-body {
                    padding: 16px;
                }

                .ldb-confirm-message {
                    font-size: 14px;
                    color: #e0e0e0;
                    margin: 0 0 12px 0;
                    line-height: 1.5;
                }

                .ldb-confirm-item {
                    font-size: 13px;
                    color: #a0a0a0;
                    margin: 0 0 12px 0;
                    padding: 10px;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 8px;
                }

                .ldb-confirm-item strong {
                    color: #fff;
                }

                .ldb-confirm-input-group {
                    margin-top: 12px;
                }

                .ldb-confirm-input-group label {
                    display: block;
                    font-size: 12px;
                    color: #888;
                    margin-bottom: 6px;
                }

                .ldb-confirm-input {
                    width: 100%;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(239, 68, 68, 0.3);
                    border-radius: 8px;
                    color: #fff;
                    font-size: 14px;
                    box-sizing: border-box;
                }

                .ldb-confirm-input:focus {
                    outline: none;
                    border-color: #ef4444;
                }

                .ldb-confirm-hint {
                    font-size: 11px;
                    color: #666;
                    margin-top: 6px;
                }

                .ldb-confirm-footer {
                    display: flex;
                    gap: 10px;
                    padding: 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                }

                .ldb-confirm-footer .ldb-btn {
                    flex: 1;
                }

                /* 撤销提示 toast 样式 */
                .ldb-undo-toast {
                    position: fixed;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%) translateY(100px);
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    border: 1px solid #4a90d9;
                    border-radius: 12px;
                    padding: 12px 16px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                    z-index: 100001;
                    opacity: 0;
                    transition: transform 0.3s ease, opacity 0.3s ease;
                }

                .ldb-undo-toast.visible {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }

                .ldb-undo-message {
                    font-size: 13px;
                    color: #e0e0e0;
                }

                .ldb-undo-btn {
                    background: linear-gradient(135deg, #4a90d9 0%, #357abd 100%);
                    border: none;
                    color: #fff;
                    padding: 6px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .ldb-undo-btn:hover {
                    background: linear-gradient(135deg, #5a9fe9 0%, #458acd 100%);
                }

                .ldb-undo-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 3px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 0 0 12px 12px;
                    overflow: hidden;
                }

                .ldb-undo-progress-bar {
                    height: 100%;
                    background: linear-gradient(90deg, #4a90d9, #34d399);
                    animation: ldb-undo-countdown 5s linear forwards;
                }

                @keyframes ldb-undo-countdown {
                    from { width: 100%; }
                    to { width: 0%; }
                }
            `;
            document.head.appendChild(style);
        },

        // 创建面板
        createPanel: () => {
            const panel = document.createElement("div");
            panel.className = "ldb-panel";
            panel.innerHTML = `
                <div class="ldb-header">
                    <h3>📚 收藏导出到 Notion</h3>
                    <div class="ldb-header-btns">
                        <button class="ldb-header-btn" id="ldb-minimize" title="最小化">−</button>
                        <button class="ldb-header-btn" id="ldb-close" title="关闭">×</button>
                    </div>
                </div>
                <div class="ldb-body">
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
                            <label class="ldb-label">数据库 ID</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" class="ldb-input" id="ldb-database-id" placeholder="32位数据库ID" style="flex: 1;">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-refresh-workspace" style="padding: 6px 12px; white-space: nowrap;" title="刷新工作区页面列表">🔄</button>
                            </div>
                            <select class="ldb-select" id="ldb-workspace-select" style="margin-top: 6px; display: none;">
                                <option value="">-- 从工作区选择 --</option>
                            </select>
                            <div class="ldb-tip" id="ldb-workspace-tip">
                                从数据库链接复制：notion.so/<b>数据库ID</b>?v=xxx
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
                        <div class="ldb-permission-panel">
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
                            <span id="ldb-filter-arrow">▼</span>
                        </div>
                        <div class="ldb-toggle-content" id="ldb-filter-content">
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
                            </div>
                            <div class="ldb-form-group">
                                <label>请求间隔 (防封)</label>
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
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- AI 助手对话界面 -->
                    <div class="ldb-section">
                        <div class="ldb-section-title">🤖 AI 助手</div>

                        <!-- 对话区域 -->
                        <div class="ldb-chat-container" id="ldb-chat-messages">
                            <div class="ldb-chat-welcome">
                                <div class="ldb-chat-welcome-icon">🤖</div>
                                <div class="ldb-chat-welcome-text">
                                    你好！我是 AI 助手<br>
                                    <small>试试输入「帮助」查看我能做什么</small>
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

                        <!-- 设置折叠区 -->
                        <div class="ldb-chat-settings-toggle" id="ldb-chat-settings-toggle">
                            <span style="font-size: 12px; color: #888;">⚙️ AI 设置</span>
                            <span id="ldb-chat-settings-arrow">▶</span>
                        </div>
                        <div class="ldb-chat-settings-content collapsed" id="ldb-chat-settings-content">
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
                            <div class="ldb-btn-group" style="display: flex; align-items: center; gap: 8px;">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-test">测试连接</button>
                                <span id="ldb-ai-test-status" style="font-size: 12px;"></span>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 收藏信息 -->
                    <div class="ldb-section">
                        <div class="ldb-section-title">收藏列表</div>
                        <div class="ldb-bookmarks-info">
                            <div class="ldb-bookmarks-count" id="ldb-bookmark-count">-</div>
                            <div class="ldb-bookmarks-label">已加载收藏数量</div>
                        </div>
                        <button class="ldb-btn ldb-btn-secondary" id="ldb-load-bookmarks" style="margin-bottom: 12px;">
                            🔄 加载收藏列表
                        </button>

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
            `;

            document.body.appendChild(panel);
            UI.panel = panel;

            // 绑定事件
            UI.bindEvents();

            // 加载保存的配置
            UI.loadConfig();
        },

        // 创建最小化按钮
        createMiniButton: () => {
            const btn = document.createElement("button");
            btn.className = "ldb-mini-btn";
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

            // 最小化
            panel.querySelector("#ldb-minimize").onclick = () => {
                panel.style.display = "none";
                UI.miniBtn.style.display = "flex";
                Storage.set(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, true);
            };

            // 关闭
            panel.querySelector("#ldb-close").onclick = () => {
                panel.remove();
                UI.miniBtn.remove();
            };

            // 折叠筛选设置
            panel.querySelector("#ldb-filter-toggle").onclick = () => {
                const content = panel.querySelector("#ldb-filter-content");
                const arrow = panel.querySelector("#ldb-filter-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            };

            // 导出目标类型切换
            const handleExportTargetChange = (e) => {
                const targetType = e.target.value;
                const parentPageGroup = panel.querySelector("#ldb-parent-page-group");
                const databaseIdGroup = panel.querySelector("#ldb-database-id").parentElement;
                const exportTargetTip = panel.querySelector("#ldb-export-target-tip");

                if (targetType === "page") {
                    parentPageGroup.style.display = "block";
                    databaseIdGroup.style.display = "none";
                    exportTargetTip.textContent = "导出为子页面，包含完整内容";
                } else {
                    parentPageGroup.style.display = "none";
                    databaseIdGroup.style.display = "block";
                    exportTargetTip.textContent = "导出为数据库条目，支持筛选和排序";
                }

                Storage.set(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, targetType);
            };

            panel.querySelector("#ldb-export-target-database").onchange = handleExportTargetChange;
            panel.querySelector("#ldb-export-target-page").onchange = handleExportTargetChange;

            // 父页面 ID 自动保存
            panel.querySelector("#ldb-parent-page-id").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, e.target.value.trim());
            };

            // 验证配置
            panel.querySelector("#ldb-validate-config").onclick = async () => {
                const btn = panel.querySelector("#ldb-validate-config");
                const statusSpan = panel.querySelector("#ldb-config-status");
                const apiKey = panel.querySelector("#ldb-api-key").value.trim();
                const exportTargetType = panel.querySelector("#ldb-export-target-page").checked ? "page" : "database";
                const databaseId = panel.querySelector("#ldb-database-id").value.trim();
                const parentPageId = panel.querySelector("#ldb-parent-page-id").value.trim();

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
            panel.querySelector("#ldb-setup-database").onclick = async () => {
                const apiKey = panel.querySelector("#ldb-api-key").value.trim();
                const databaseId = panel.querySelector("#ldb-database-id").value.trim();
                const statusSpan = panel.querySelector("#ldb-config-status");

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

                const btn = panel.querySelector("#ldb-setup-database");
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

            // 加载收藏
            panel.querySelector("#ldb-load-bookmarks").onclick = async () => {
                const username = Utils.getUsernameFromUrl();
                if (!username) {
                    UI.showStatus("无法获取用户名", "error");
                    return;
                }

                const btn = panel.querySelector("#ldb-load-bookmarks");
                btn.disabled = true;
                btn.innerHTML = '<span class="ldb-spin">🔄</span> 加载中...';

                try {
                    const bookmarks = await LinuxDoAPI.fetchAllBookmarks(username, (count) => {
                        panel.querySelector("#ldb-bookmark-count").textContent = count;
                    });

                    UI.bookmarks = bookmarks;
                    UI.selectedBookmarks = new Set(bookmarks.map(b => String(b.topic_id || b.bookmarkable_id)));
                    panel.querySelector("#ldb-bookmark-count").textContent = bookmarks.length;
                    panel.querySelector("#ldb-export").disabled = false;

                    // 渲染收藏列表
                    UI.renderBookmarkList();
                    panel.querySelector("#ldb-bookmark-list-container").style.display = "block";

                    UI.showStatus(`成功加载 ${bookmarks.length} 个收藏`, "success");
                } catch (error) {
                    UI.showStatus(`加载失败: ${error.message}`, "error");
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = "🔄 加载收藏列表";
                }
            };

            // 全选/取消
            panel.querySelector("#ldb-select-all").onchange = (e) => {
                const checked = e.target.checked;
                if (checked) {
                    UI.selectedBookmarks = new Set(UI.bookmarks.map(b => String(b.topic_id || b.bookmarkable_id)));
                } else {
                    UI.selectedBookmarks = new Set();
                }
                UI.renderBookmarkList();
                UI.updateSelectCount();
            };

            // 暂停按钮
            panel.querySelector("#ldb-pause").onclick = () => {
                const pauseBtn = panel.querySelector("#ldb-pause");
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
            panel.querySelector("#ldb-cancel").onclick = () => {
                if (confirm("确定要取消导出吗？已导出的内容不会被删除。")) {
                    Exporter.cancel();
                }
            };

            // 开始导出
            panel.querySelector("#ldb-export").onclick = async () => {
                const apiKey = panel.querySelector("#ldb-api-key").value.trim();
                const exportTargetType = panel.querySelector("#ldb-export-target-page").checked ? "page" : "database";
                const databaseId = panel.querySelector("#ldb-database-id").value.trim();
                const parentPageId = panel.querySelector("#ldb-parent-page-id").value.trim();

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

                // 获取选中的收藏 (过滤已导出的)
                const toExport = UI.bookmarks.filter(b => {
                    const topicId = String(b.topic_id || b.bookmarkable_id);
                    return UI.selectedBookmarks.has(topicId) && !Storage.isTopicExported(topicId);
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
                    onlyFirst: panel.querySelector("#ldb-only-first").checked,
                    onlyOp: panel.querySelector("#ldb-only-op").checked,
                    rangeStart: parseInt(panel.querySelector("#ldb-range-start").value) || 1,
                    rangeEnd: parseInt(panel.querySelector("#ldb-range-end").value) || 999999,
                    imgMode: panel.querySelector("#ldb-img-mode").value,
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
                Storage.set(CONFIG.STORAGE_KEYS.REQUEST_DELAY, parseInt(panel.querySelector("#ldb-request-delay").value));

                // 显示控制按钮，隐藏导出按钮
                panel.querySelector("#ldb-export-btns").style.display = "none";
                panel.querySelector("#ldb-control-btns").style.display = "flex";
                panel.querySelector("#ldb-pause").innerHTML = "⏸️ 暂停";
                panel.querySelector("#ldb-pause").classList.add("ldb-btn-warning");
                panel.querySelector("#ldb-pause").classList.remove("ldb-btn-primary");

                // 清空之前的报告
                panel.querySelector("#ldb-report-container").innerHTML = "";

                try {
                    const results = await Exporter.exportBookmarks(toExport, settings, (progress) => {
                        UI.showProgress(
                            progress.current,
                            progress.total,
                            `${progress.title}\n${progress.message || progress.stage}${progress.isPaused ? " (已暂停)" : ""}`
                        );
                    });

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
                    panel.querySelector("#ldb-export-btns").style.display = "flex";
                    panel.querySelector("#ldb-control-btns").style.display = "none";
                    Exporter.reset();
                }
            };

            // 权限设置事件
            panel.querySelector("#ldb-permission-level").onchange = (e) => {
                const level = parseInt(e.target.value);
                OperationGuard.setLevel(level);
                UI.showStatus(`权限级别已设置为: ${CONFIG.PERMISSION_NAMES[level]}`, "success");
            };

            panel.querySelector("#ldb-require-confirm").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, e.target.checked);
            };

            panel.querySelector("#ldb-enable-audit-log").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, e.target.checked);
                // 更新日志面板可见性
                const logPanel = panel.querySelector("#ldb-log-panel");
                if (logPanel) {
                    logPanel.style.display = e.target.checked ? "block" : "none";
                }
            };

            // 日志面板事件
            panel.querySelector("#ldb-log-toggle").onclick = () => {
                const content = panel.querySelector("#ldb-log-content");
                const arrow = panel.querySelector("#ldb-log-arrow");
                content.classList.toggle("collapsed");
                arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";

                // 展开时更新日志内容
                if (!content.classList.contains("collapsed")) {
                    UI.updateLogPanel();
                }
            };

            panel.querySelector("#ldb-log-clear").onclick = () => {
                if (confirm("确定要清除所有操作日志吗？")) {
                    OperationLog.clear();
                    UI.showStatus("日志已清除", "success");
                }
            };

            // 输入框自动保存
            panel.querySelector("#ldb-api-key").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, e.target.value.trim());
            };
            panel.querySelector("#ldb-database-id").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, e.target.value.trim());
            };

            // 刷新工作区页面列表
            panel.querySelector("#ldb-refresh-workspace").onclick = async () => {
                const apiKey = panel.querySelector("#ldb-api-key").value.trim();
                const refreshBtn = panel.querySelector("#ldb-refresh-workspace");
                const workspaceTip = panel.querySelector("#ldb-workspace-tip");
                const workspaceSelect = panel.querySelector("#ldb-workspace-select");

                if (!apiKey) {
                    UI.showStatus("请先填写 Notion API Key", "error");
                    return;
                }

                refreshBtn.disabled = true;
                refreshBtn.innerHTML = "⏳";
                workspaceTip.innerHTML = "正在获取工作区页面...";

                try {
                    // 分页获取所有数据库
                    let allDbResults = [];
                    let dbCursor = undefined;
                    do {
                        const dbResponse = await NotionAPI.search("", { property: "object", value: "database" }, apiKey, dbCursor);
                        allDbResults = allDbResults.concat(dbResponse.results || []);
                        dbCursor = dbResponse.has_more ? dbResponse.next_cursor : undefined;
                    } while (dbCursor);

                    const databases = allDbResults.map(db => ({
                        id: db.id?.replace(/-/g, "") || "",
                        title: db.title?.[0]?.plain_text || "无标题数据库",
                        type: "database",
                        url: db.url || ""
                    }));

                    // 分页获取所有页面
                    let allPageResults = [];
                    let pageCursor = undefined;
                    do {
                        const pageResponse = await NotionAPI.search("", { property: "object", value: "page" }, apiKey, pageCursor);
                        allPageResults = allPageResults.concat(pageResponse.results || []);
                        pageCursor = pageResponse.has_more ? pageResponse.next_cursor : undefined;
                    } while (pageCursor);

                    const pages = allPageResults.map(page => ({
                        id: page.id?.replace(/-/g, "") || "",
                        title: Utils.getPageTitle(page),
                        type: "page",
                        url: page.url || "",
                        parent: page.parent?.type || ""
                    }));

                    // 合并并缓存（包含 API Key 标识）
                    const apiKeyHash = apiKey.slice(-8);
                    const workspaceData = {
                        apiKeyHash,
                        databases,
                        pages,
                        timestamp: Date.now()
                    };
                    Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, JSON.stringify(workspaceData));

                    // 更新下拉框
                    UI.updateWorkspaceSelect(workspaceData);
                    workspaceSelect.style.display = "block";
                    workspaceTip.innerHTML = `✅ 获取到 ${databases.length} 个数据库，${pages.length} 个页面`;
                    workspaceTip.style.color = "#34d399";
                } catch (error) {
                    workspaceTip.innerHTML = `❌ ${error.message}`;
                    workspaceTip.style.color = "#f87171";
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = "🔄";
                }
            };

            // 从工作区选择页面/数据库
            panel.querySelector("#ldb-workspace-select").onchange = (e) => {
                const selected = e.target.value;
                if (selected) {
                    const [type, id] = selected.split(":");
                    if (type === "database") {
                        panel.querySelector("#ldb-database-id").value = id;
                        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, id);
                    } else if (type === "page") {
                        // 页面类型：填入父页面 ID 字段
                        panel.querySelector("#ldb-parent-page-id").value = id;
                        Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, id);
                        // 自动切换到页面导出模式
                        panel.querySelector("#ldb-export-target-page").checked = true;
                        panel.querySelector("#ldb-parent-page-group").style.display = "block";
                        panel.querySelector("#ldb-database-id").parentElement.style.display = "none";
                        panel.querySelector("#ldb-export-target-tip").textContent = "导出为子页面，包含完整内容";
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
            panel.querySelector("#ldb-ai-service").onchange = (e) => {
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
            panel.querySelector("#ldb-ai-api-key").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_API_KEY, e.target.value.trim());
            };
            panel.querySelector("#ldb-ai-base-url").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_BASE_URL, e.target.value.trim());
            };
            panel.querySelector("#ldb-ai-categories").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORIES, e.target.value.trim());
            };
            panel.querySelector("#ldb-ai-model").onchange = (e) => {
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, e.target.value);
            };

            // 获取模型列表
            panel.querySelector("#ldb-ai-fetch-models").onclick = async () => {
                const aiApiKey = panel.querySelector("#ldb-ai-api-key").value.trim();
                const aiService = panel.querySelector("#ldb-ai-service").value;
                const aiBaseUrl = panel.querySelector("#ldb-ai-base-url").value.trim();
                const fetchBtn = panel.querySelector("#ldb-ai-fetch-models");
                const modelTip = panel.querySelector("#ldb-ai-model-tip");

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
            panel.querySelector("#ldb-ai-test").onclick = async () => {
                const btn = panel.querySelector("#ldb-ai-test");
                const statusSpan = panel.querySelector("#ldb-ai-test-status");
                const aiApiKey = panel.querySelector("#ldb-ai-api-key").value.trim();
                const aiService = panel.querySelector("#ldb-ai-service").value;
                const aiModel = panel.querySelector("#ldb-ai-model").value;
                const aiBaseUrl = panel.querySelector("#ldb-ai-base-url").value.trim();

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

            panel.querySelector("#ldb-api-key").value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            panel.querySelector("#ldb-database-id").value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            panel.querySelector("#ldb-parent-page-id").value = Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, "");
            panel.querySelector("#ldb-only-first").checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, CONFIG.DEFAULTS.onlyFirst);
            panel.querySelector("#ldb-only-op").checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, CONFIG.DEFAULTS.onlyOp);
            panel.querySelector("#ldb-range-start").value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, CONFIG.DEFAULTS.rangeStart);
            panel.querySelector("#ldb-range-end").value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, CONFIG.DEFAULTS.rangeEnd);
            panel.querySelector("#ldb-img-mode").value = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
            panel.querySelector("#ldb-request-delay").value = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

            // 加载导出目标类型设置
            const exportTargetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType);
            if (exportTargetType === "page") {
                panel.querySelector("#ldb-export-target-page").checked = true;
                panel.querySelector("#ldb-parent-page-group").style.display = "block";
                panel.querySelector("#ldb-database-id").parentElement.style.display = "none";
                panel.querySelector("#ldb-export-target-tip").textContent = "导出为子页面，包含完整内容";
            } else {
                panel.querySelector("#ldb-export-target-database").checked = true;
                panel.querySelector("#ldb-parent-page-group").style.display = "none";
                panel.querySelector("#ldb-database-id").parentElement.style.display = "block";
                panel.querySelector("#ldb-export-target-tip").textContent = "导出为数据库条目，支持筛选和排序";
            }

            // 加载权限设置
            panel.querySelector("#ldb-permission-level").value = Storage.get(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, CONFIG.DEFAULTS.permissionLevel);
            panel.querySelector("#ldb-require-confirm").checked = Storage.get(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, CONFIG.DEFAULTS.requireConfirm);
            panel.querySelector("#ldb-enable-audit-log").checked = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);

            // 根据审计日志设置更新面板可见性
            const enableAuditLog = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
            const logPanel = panel.querySelector("#ldb-log-panel");
            if (logPanel) {
                logPanel.style.display = enableAuditLog ? "block" : "none";
            }

            // 加载 AI 分类设置
            const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
            panel.querySelector("#ldb-ai-service").value = aiService;

            // 验证并加载 AI 模型（优先使用缓存的模型列表）
            const savedModel = Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
            const provider = AIService.PROVIDERS[aiService];
            const modelSelect = panel.querySelector("#ldb-ai-model");

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

            panel.querySelector("#ldb-ai-api-key").value = Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "");
            panel.querySelector("#ldb-ai-base-url").value = Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, CONFIG.DEFAULTS.aiBaseUrl);
            panel.querySelector("#ldb-ai-categories").value = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories);

            // 初始化日志面板
            UI.updateLogPanel();

            // 加载缓存的工作区页面列表（校验 API Key）
            const cachedWorkspace = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
            try {
                const workspaceData = JSON.parse(cachedWorkspace);
                const currentApiKey = panel.querySelector("#ldb-api-key").value.trim();
                const currentKeyHash = currentApiKey ? currentApiKey.slice(-8) : "";
                // 仅当 API Key 匹配时才显示缓存
                if (workspaceData.apiKeyHash === currentKeyHash &&
                    (workspaceData.databases?.length > 0 || workspaceData.pages?.length > 0)) {
                    UI.updateWorkspaceSelect(workspaceData);
                    panel.querySelector("#ldb-workspace-select").style.display = "block";
                }
            } catch {}
        },

        // 显示状态
        showStatus: (message, type = "info") => {
            const container = UI.panel.querySelector("#ldb-status-container");
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
            const container = UI.panel.querySelector("#ldb-status-container");
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
            UI.panel.querySelector("#ldb-status-container").innerHTML = "";
        },

        // 更新 AI 模型选项
        updateAIModelOptions: (service, customModels = null, preserveSelection = false) => {
            const modelSelect = UI.panel.querySelector("#ldb-ai-model");
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
            const select = UI.panel.querySelector("#ldb-workspace-select");
            if (!select) return;

            const { databases = [], pages = [] } = workspaceData;
            let options = '<option value="">-- 从工作区选择 --</option>';

            // 数据库组
            if (databases.length > 0) {
                options += '<optgroup label="📁 数据库">';
                databases.forEach(db => {
                    options += `<option value="database:${db.id}">📁 ${Utils.escapeHtml(db.title)}</option>`;
                });
                options += '</optgroup>';
            }

            // 页面组（只显示工作区顶级页面）
            const workspacePages = pages.filter(p => p.parent === "workspace");
            if (workspacePages.length > 0) {
                options += '<optgroup label="📄 工作区页面">';
                workspacePages.forEach(page => {
                    options += `<option value="page:${page.id}">📄 ${Utils.escapeHtml(page.title)}</option>`;
                });
                options += '</optgroup>';
            }

            select.innerHTML = options;
        },

        // 渲染收藏列表
        renderBookmarkList: () => {
            const list = UI.panel.querySelector("#ldb-bookmark-list");
            if (!UI.bookmarks || UI.bookmarks.length === 0) {
                list.innerHTML = '<div style="padding: 12px; text-align: center; color: #666;">暂无收藏</div>';
                return;
            }

            list.innerHTML = UI.bookmarks.map(b => {
                const topicId = b.topic_id || b.bookmarkable_id;
                const title = b.title || b.name || `帖子 ${topicId}`;
                const isExported = Storage.isTopicExported(topicId);
                const isSelected = UI.selectedBookmarks?.has(topicId);

                return `
                    <div class="ldb-bookmark-item" data-topic-id="${topicId}">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} ${isExported ? 'disabled' : ''}>
                        <span class="title" title="${title}">${Utils.truncateText(title, 35)}</span>
                        ${isExported ? '<span class="status exported">已导出</span>' : '<span class="status pending">待导出</span>'}
                    </div>
                `;
            }).join('');

            // 绑定点击事件
            list.querySelectorAll(".ldb-bookmark-item").forEach(item => {
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox.disabled) return;

                item.onclick = (e) => {
                    if (e.target.tagName === 'INPUT') return;
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                };

                checkbox.onchange = () => {
                    const topicId = String(item.dataset.topicId);
                    if (checkbox.checked) {
                        UI.selectedBookmarks.add(topicId);
                    } else {
                        UI.selectedBookmarks.delete(topicId);
                    }
                    UI.updateSelectCount();
                };
            });

            UI.updateSelectCount();
        },

        // 更新选中数量
        updateSelectCount: () => {
            const count = UI.selectedBookmarks?.size || 0;
            const exportedCount = UI.bookmarks?.filter(b => Storage.isTopicExported(b.topic_id || b.bookmarkable_id)).length || 0;
            const pendingCount = count - exportedCount;

            UI.panel.querySelector("#ldb-select-count").textContent = `已选 ${count} 个，待导出 ${Math.max(0, pendingCount)} 个`;

            // 更新全选框状态
            const selectAll = UI.panel.querySelector("#ldb-select-all");
            if (UI.bookmarks && count === UI.bookmarks.length) {
                selectAll.checked = true;
                selectAll.indeterminate = false;
            } else if (count === 0) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
            } else {
                selectAll.indeterminate = true;
            }
        },

        // 显示导出报告
        showReport: (results) => {
            const container = UI.panel.querySelector("#ldb-report-container");
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
                            <div class="operation">${formatted.operation}</div>
                            <div class="time">${formatted.time} · ${formatted.duration}</div>
                            ${formatted.error ? `<div class="error">${formatted.error}</div>` : ''}
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

        // 初始化
        init: () => {
            UI.injectStyles();
            UI.createPanel();
            UI.miniBtn = UI.createMiniButton();

            // 检查是否需要最小化启动
            if (Storage.get(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, false)) {
                UI.panel.style.display = "none";
                UI.miniBtn.style.display = "flex";
            }
        },
    };

    // ===========================================
    // 入口
    // ===========================================
    function main() {
        const initUI = () => {
            const currentSite = SiteDetector.detect();

            if (currentSite === SiteDetector.SITES.LINUX_DO) {
                // Linux.do 站点：初始化完整 UI
                UI.init();
            } else if (currentSite === SiteDetector.SITES.NOTION) {
                // Notion 站点：初始化浮动 AI 助手
                NotionSiteUI.init();
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
