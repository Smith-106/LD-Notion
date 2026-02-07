// ==UserScript==
// @name         Linux.do 收藏帖子导出到 Notion
// @namespace    https://linux.do/
// @version      1.2.1
// @description  批量导出 Linux.do 收藏的帖子到 Notion 数据库，支持自定义筛选、图片上传、权限控制
// @author       基于 flobby 和 JackLiii 的作品改编
// @license      MIT
// @match        https://linux.do/u/*/activity/bookmarks*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.notion.com
// @connect      linux.do
// @connect      *.amazonaws.com
// @connect      s3.amazonaws.com
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

        // 上传文件内容
        uploadFileContent: (uploadUrl, blob, contentType, apiKey, filename) => {
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
                            'Authorization': `Bearer ${apiKey}`,
                            'Notion-Version': CONFIG.API.NOTION_VERSION,
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

                // 上传内容
                await NotionAPI.uploadFileContent(fileUpload.upload_url, blob, contentType, apiKey, filename);

                return fileUpload.id;
            } catch (error) {
                console.error("上传图片失败:", error);
                return null;
            }
        },

        // ========== 搜索和读取操作 (READONLY) ==========

        // 搜索工作区
        search: async (query, filter, apiKey) => {
            const data = { query };
            if (filter) {
                data.filter = filter; // { property: "object", value: "page" | "database" }
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
            if (requiredLevel === undefined) return true; // 未定义的操作默认允许
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
                const confirmed = await ConfirmationDialog.show({
                    title: "危险操作确认",
                    message: `您即将执行危险操作: ${operation}`,
                    itemName: context.itemName || "未知项目",
                    countdown: 5,
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
                if (OperationGuard.isDangerous(operation) && operation === "deletePage") {
                    UndoManager.register({
                        operation,
                        undoAction: () => NotionAPI.restorePage(context.pageId, context.apiKey),
                        description: `恢复页面: ${context.itemName || context.pageId}`,
                    });
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
                    await Utils.sleep(200); // 避免请求过快
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
                    multi_select: (topic.tags || []).map(tag => ({ name: tag }))
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
                        // Notion File Upload API 需要使用 file_id 引用
                        // 参考: https://developers.notion.com/docs/working-with-files-and-media
                        block.image = {
                            type: "file",
                            file: {
                                file_id: fileId, // 使用上传返回的 file_id
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

            // 构建属性
            const properties = Exporter.buildProperties(topic, bookmark);

            // 创建页面
            const page = await NotionAPI.createDatabasePage(
                settings.databaseId,
                properties,
                blocks,
                settings.apiKey
            );

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
                    await Utils.sleep(1000);
                }
            }

            return results;
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
                    padding: 12px;
                    background: rgba(74, 144, 217, 0.1);
                    border: 1px solid rgba(74, 144, 217, 0.3);
                    border-radius: 10px;
                    font-size: 13px;
                    color: #4a90d9;
                    text-align: center;
                    margin-top: 12px;
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
                            <input type="text" class="ldb-input" id="ldb-database-id" placeholder="32位数据库ID">
                            <div class="ldb-tip">
                                从数据库链接复制：notion.so/<b>数据库ID</b>?v=xxx
                            </div>
                        </div>
                        <button class="ldb-btn ldb-btn-secondary" id="ldb-validate-config">验证配置</button>

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

            // 验证配置
            panel.querySelector("#ldb-validate-config").onclick = async () => {
                const apiKey = panel.querySelector("#ldb-api-key").value.trim();
                const databaseId = panel.querySelector("#ldb-database-id").value.trim();

                if (!apiKey || !databaseId) {
                    UI.showStatus("请填写 API Key 和数据库 ID", "error");
                    return;
                }

                UI.showStatus("验证中...", "info");

                const result = await NotionAPI.validateConfig(apiKey, databaseId);
                if (result.valid) {
                    UI.showStatus("配置验证成功！", "success");
                    Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, apiKey);
                    Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, databaseId);
                } else {
                    UI.showStatus(`验证失败: ${result.error}`, "error");
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
                const databaseId = panel.querySelector("#ldb-database-id").value.trim();

                if (!apiKey || !databaseId) {
                    UI.showStatus("请先配置 Notion API Key 和数据库 ID", "error");
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
                    onlyFirst: panel.querySelector("#ldb-only-first").checked,
                    onlyOp: panel.querySelector("#ldb-only-op").checked,
                    rangeStart: parseInt(panel.querySelector("#ldb-range-start").value) || 1,
                    rangeEnd: parseInt(panel.querySelector("#ldb-range-end").value) || 999999,
                    imgMode: panel.querySelector("#ldb-img-mode").value,
                };

                // 保存设置
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, apiKey);
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, databaseId);
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, settings.onlyFirst);
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, settings.onlyOp);
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, settings.rangeStart);
                Storage.set(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, settings.rangeEnd);
                Storage.set(CONFIG.STORAGE_KEYS.IMG_MODE, settings.imgMode);

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

            // 拖拽
            UI.makeDraggable(panel, panel.querySelector(".ldb-header"));
        },

        // 加载配置
        loadConfig: () => {
            const panel = UI.panel;

            panel.querySelector("#ldb-api-key").value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
            panel.querySelector("#ldb-database-id").value = Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, "");
            panel.querySelector("#ldb-only-first").checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, CONFIG.DEFAULTS.onlyFirst);
            panel.querySelector("#ldb-only-op").checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, CONFIG.DEFAULTS.onlyOp);
            panel.querySelector("#ldb-range-start").value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, CONFIG.DEFAULTS.rangeStart);
            panel.querySelector("#ldb-range-end").value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, CONFIG.DEFAULTS.rangeEnd);
            panel.querySelector("#ldb-img-mode").value = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);

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

            // 初始化日志面板
            UI.updateLogPanel();
        },

        // 显示状态
        showStatus: (message, type = "info") => {
            const container = UI.panel.querySelector("#ldb-status-container");
            container.innerHTML = `<div class="ldb-status ${type}">${message}</div>`;
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
        // 等待页面加载完成
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", UI.init);
        } else {
            UI.init();
        }
    }

    main();
})();
