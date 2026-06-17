"use strict";

// 依赖引入
const { CONFIG, MSG, SUPPORTED_FILE_TYPES, MULTI_PART_THRESHOLD, getMimeType, getFileCategory, isSupportedFileType } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionOAuth } = require("../auth");

const SiteDetector = {
    SITES: {
        LINUX_DO: "linux_do",
        NOTION: "notion",
        GITHUB: "github",
        ZHIHU: "zhihu",
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
        if (hostname === "www.zhihu.com" || hostname === "zhuanlan.zhihu.com") {
            return SiteDetector.SITES.ZHIHU;
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
                            _fileType: "image",
                        });
                    }
                }
                return;
            }

            // 处理附件链接 (<a class="attachment">)
            if (tag === "a" && el.classList && el.classList.contains("attachment")) {
                const href = el.getAttribute("href") || "";
                const fileName = el.textContent?.trim() || "attachment";
                const full = Utils.absoluteUrl(href);
                if (full && imgMode !== "skip") {
                    blocks.push({
                        type: "file",
                        file: {
                            type: "external",
                            external: { url: full },
                            caption: [{ type: "text", text: { content: fileName } }],
                        },
                        _needsUpload: imgMode === "upload",
                        _originalUrl: full,
                        _fileType: "file",
                        _fileName: fileName,
                    });
                }
                return;
            }

            // 处理视频元素
            if (tag === "video") {
                const source = el.querySelector("source");
                const src = el.getAttribute("src") || source?.getAttribute("src") || "";
                const full = Utils.absoluteUrl(src);
                if (full && imgMode !== "skip") {
                    const ext = (full.split(".").pop() || "").split("?")[0].toLowerCase();
                    if (isSupportedFileType(ext)) {
                        blocks.push({
                            type: "video",
                            video: { type: "external", external: { url: full } },
                            _needsUpload: imgMode === "upload",
                            _originalUrl: full,
                            _fileType: "video",
                        });
                    } else {
                        blocks.push({
                            type: "embed",
                            embed: { url: full },
                        });
                    }
                }
                return;
            }

            // 处理音频元素
            if (tag === "audio") {
                const source = el.querySelector("source");
                const src = el.getAttribute("src") || source?.getAttribute("src") || "";
                const full = Utils.absoluteUrl(src);
                if (full && imgMode !== "skip") {
                    blocks.push({
                        type: "audio",
                        audio: { type: "external", external: { url: full } },
                        _needsUpload: imgMode === "upload",
                        _originalUrl: full,
                        _fileType: "audio",
                    });
                }
                return;
            }

            // 处理 iframe 嵌入（视频/外部内容）
            if (tag === "iframe") {
                const src = el.getAttribute("src") || "";
                if (src && (src.includes("youtube.com") || src.includes("youtu.be") ||
                    src.includes("vimeo.com") || src.includes("bilibili.com") ||
                    src.includes("player."))) {
                    blocks.push({ type: "embed", embed: { url: src } });
                    return;
                }
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

                // 处理段落中的图片和附件
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
                                _fileType: "image",
                            });
                        }
                    }
                });
                // 处理段落中的附件
                el.querySelectorAll("a.attachment").forEach((a) => {
                    const href = a.getAttribute("href") || "";
                    const fileName = a.textContent?.trim() || "attachment";
                    const full = Utils.absoluteUrl(href);
                    if (full && imgMode !== "skip") {
                        blocks.push({
                            type: "file",
                            file: {
                                type: "external",
                                external: { url: full },
                                caption: [{ type: "text", text: { content: fileName } }],
                            },
                            _needsUpload: imgMode === "upload",
                            _originalUrl: full,
                            _fileType: "file",
                            _fileName: fileName,
                        });
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
                            _fileType: "image",
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


const NotionTransport = Object.freeze({
    buildUrl: (endpoint) => `https://api.notion.com/v1${endpoint}`,

    buildHeaders: ({ token, notionVersion }) => ({
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": notionVersion || CONFIG.API.NOTION_VERSION,
    }),

    request: ({ method, endpoint, data, token, notionVersion }) => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: NotionTransport.buildUrl(endpoint),
                headers: NotionTransport.buildHeaders({ token, notionVersion }),
                data: data ? JSON.stringify(data) : undefined,
                onload: resolve,
                onerror: (error) => {
                    const message = error?.error || error?.message || String(error);
                    reject(new Error(`网络请求失败: ${message}`));
                },
                timeout: 30000,
                ontimeout: () => reject(new Error("Notion API 请求超时")),
            });
        });
    },
});


const NotionAPI = {
    Transport: NotionTransport,
    _transportAdapter: null,

    configureTransport: (transport) => {
        if (!transport || typeof transport.request !== "function") {
            throw new Error("Notion transport 适配器必须提供 request 方法");
        }
        NotionAPI._transportAdapter = transport;
        return NotionAPI.getTransport();
    },

    resetTransport: () => {
        NotionAPI._transportAdapter = null;
        return NotionAPI.Transport;
    },

    getTransport: () => NotionAPI._transportAdapter || NotionAPI.Transport,

    request: async (method, endpoint, data, apiKey, retries = 3, options = {}) => {
        const notionVersion = options.notionVersion || CONFIG.API.NOTION_VERSION;

        const doRequest = async (attempt, token = NotionOAuth.getAccessToken(apiKey), allowRefresh = true) => {
            const response = await NotionAPI.getTransport().request({
                method,
                endpoint,
                data,
                token,
                notionVersion,
            });

            // 处理速率限制
            if (response.status === 429 && attempt < retries) {
                const retryAfter = parseInt(response.responseHeaders?.match(/retry-after:\s*(\d+)/i)?.[1]) || 1;
                console.warn(`Notion API 速率限制，${retryAfter}秒后重试 (${attempt + 1}/${retries})`);
                await Utils.sleep(retryAfter * 1000 + 500);
                return doRequest(attempt + 1, token, allowRefresh);
            }

            const result = Utils.safeJsonParse(response.responseText, {});
            if (response.status >= 200 && response.status < 300) {
                return result;
            }
            if (response.status === 401 && allowRefresh && NotionOAuth.canAutoRefresh()) {
                try {
                    const refreshedToken = await NotionOAuth.refreshAccessToken();
                    return doRequest(attempt, refreshedToken, false);
                } catch (refreshError) {
                    throw new Error(`Notion OAuth 续签失败: ${refreshError.message}`);
                }
            }
            throw new Error(`Notion API 错误: ${result.message || response.status}`);
        };

        try {
            return await doRequest(0);
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`解析响应失败: ${error?.message || String(error)}`);
        }
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

    // 通用页面创建（支持数据库或页面作为父级，并允许设置 icon/cover）
    createPageObject: async (parent, properties, children, apiKey, options = {}) => {
        if (!parent || typeof parent !== "object") {
            throw new Error("parent 不能为空");
        }

        const data = {
            parent,
            properties: properties || {},
            children: Array.isArray(children) ? children.slice(0, 100) : [],
        };

        if (options.icon !== undefined) data.icon = options.icon;
        if (options.cover !== undefined) data.cover = options.cover;

        const page = await NotionAPI.request("POST", "/pages", data, apiKey);

        if (Array.isArray(children) && children.length > 100) {
            await NotionAPI.appendBlocks(page.id, children.slice(100), apiKey);
        }

        return page;
    },

    // 在页面下创建子页面
    createPageInPage: async (parentPageId, properties, apiKey) => {
        return await NotionAPI.createPageObject(
            { page_id: parentPageId },
            properties,
            [],
            apiKey
        );
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

    // 创建文件上传 (single_part ≤ 20MB)
    createFileUpload: async (filename, contentType, apiKey) => {
        return await NotionAPI.request("POST", "/file_uploads", {
            mode: "single_part",
            filename: filename,
            content_type: contentType,
        }, apiKey);
    },

    // 创建多分片上传 (>20MB)
    createMultiPartUpload: async (filename, contentType, fileSize, apiKey) => {
        return await NotionAPI.request("POST", "/file_uploads", {
            mode: "multi_part",
            filename: filename,
            content_type: contentType,
            file_size: fileSize,
        }, apiKey);
    },

    // 发送分片
    sendFilePart: async (uploadId, partData, partNumber, apiKey) => {
        return await NotionAPI.request("POST", `/file_uploads/${uploadId}/send`, {
            data: partData,
            part_number: partNumber,
        }, apiKey);
    },

    // 完成多分片上传
    completeFileUpload: async (uploadId, apiKey) => {
        return await NotionAPI.request("POST", `/file_uploads/${uploadId}/complete`, {}, apiKey);
    },

    // 获取工作区文件大小限制
    getWorkspaceLimits: async (apiKey) => {
        try {
            const user = await NotionAPI.request("GET", "/users/me", null, apiKey);
            return user?.bot?.workspace_limits?.max_file_upload_size_in_bytes || 5 * 1024 * 1024;
        } catch {
            return 5 * 1024 * 1024; // 默认 5MB (Free 计划)
        }
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
                timeout: 60000,
                ontimeout: () => reject(new Error("文件上传超时")),
                });
            };
            reader.onerror = () => reject(new Error("读取文件数据失败"));
            reader.readAsArrayBuffer(blob);
        });
    },

    // 通用文件上传（支持所有类型：图片/视频/音频/附件）
    // 自动判断 single_part / multi_part，自动识别 block 类型
    uploadFileToNotion: async (fileUrl, apiKey, originalFileName = null) => {
        const urlObj = new URL(fileUrl);
        let ext = (urlObj.pathname.split(".").pop() || "").split("?")[0].toLowerCase();

        // 优先使用原始文件名的扩展名
        if (originalFileName) {
            const origExt = originalFileName.split(".").pop()?.toLowerCase();
            if (origExt && origExt.length <= 10 && /^[a-z0-9]+$/i.test(origExt)) {
                ext = origExt;
            }
        }

        // 校验扩展名格式
        if (!ext || ext.length > 10 || !/^[a-z0-9]+$/i.test(ext)) ext = "bin";

        // 校验文件类型是否被 Notion API 支持
        if (!isSupportedFileType(ext)) {
            throw new Error(`不支持的文件类型: .${ext}`);
        }

        // 下载文件（使用 GM_xmlhttpRequest 避免 CORS 限制）
        const blob = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: fileUrl,
                responseType: "blob",
                timeout: 60000,
                onload: (r) => {
                    if (r.status >= 200 && r.status < 300) resolve(r.response);
                    else reject(new Error(`下载失败: ${r.status}`));
                },
                onerror: (e) => reject(new Error(`下载失败: ${e}`)),
                ontimeout: () => reject(new Error("下载超时")),
            });
        });
        const contentType = blob.type || getMimeType(ext);
        const category = getFileCategory(ext);

        // 根据文件类型确定 block 类型和文件名前缀
        let blockType = "image";
        if (category === "video") blockType = "video";
        else if (category === "audio") blockType = "audio";
        else if (category === "file") blockType = "file";

        const filename = originalFileName || `${blockType}-${Date.now()}.${ext}`;

        // 大文件使用 multi_part 模式
        if (blob.size > MULTI_PART_THRESHOLD) {
            const multiUpload = await NotionAPI.createMultiPartUpload(
                filename, contentType, blob.size, apiKey
            );
            if (!multiUpload?.id) throw new Error("创建多分片上传失败");

            const PART_SIZE = 20 * 1024 * 1024; // 每片 20MB
            const totalParts = Math.ceil(blob.size / PART_SIZE);

            for (let i = 0; i < totalParts; i++) {
                const start = i * PART_SIZE;
                const end = Math.min(start + PART_SIZE, blob.size);
                const partBlob = blob.slice(start, end);
                const partBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const dataUrl = reader.result;
                        resolve(dataUrl.split(",")[1]);
                    };
                    reader.readAsDataURL(partBlob);
                });

                await NotionAPI.sendFilePart(multiUpload.id, partBase64, i + 1, apiKey);
            }

            await NotionAPI.completeFileUpload(multiUpload.id, apiKey);
            return { fileId: multiUpload.id, blockType };
        }

        // 普通文件使用 single_part 模式
        const typedBlob = new Blob([blob], { type: contentType });
        const fileUpload = await NotionAPI.createFileUpload(filename, contentType, apiKey);
        if (!fileUpload?.upload_url || !fileUpload?.id) throw new Error("创建上传失败");

        await NotionAPI.uploadFileContent(fileUpload.upload_url, typedBlob, contentType, filename);

        return { fileId: fileUpload.id, blockType };
    },

    // 下载并上传图片到 Notion（保留向后兼容，内部委托给 uploadFileToNotion）
    uploadImageToNotion: async (imageUrl, apiKey, returnDetails = false) => {
        try {
            const result = await NotionAPI.uploadFileToNotion(imageUrl, apiKey);
            if (!returnDetails) return result.fileId;
            return result;
        } catch (error) {
            // 不支持的文件类型或上传失败，尝试按 file block 上传
            if (error.message?.includes("不支持")) {
                console.warn("[LD-Notion] 图片类型不支持，跳过:", imageUrl);
                return null;
            }
            console.warn("[LD-Notion] 图片上传失败:", imageUrl, error.message);
            try {
                // 回退: 按 application/octet-stream 上传为 file block
                const blob = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: imageUrl,
                        responseType: "blob",
                        timeout: 60000,
                        onload: (r) => {
                            if (r.status >= 200 && r.status < 300) resolve(r.response);
                            else reject(new Error(`下载失败: ${r.status}`));
                        },
                        onerror: (e) => reject(new Error(`下载失败: ${e}`)),
                        ontimeout: () => reject(new Error("下载超时")),
                    });
                });
                const filename = `file-${Date.now()}.bin`;
                const fileUpload = await NotionAPI.createFileUpload(filename, "application/octet-stream", apiKey);
                if (!fileUpload?.upload_url || !fileUpload?.id) throw new Error("创建上传失败");
                await NotionAPI.uploadFileContent(fileUpload.upload_url, blob, "application/octet-stream", filename);
                const result = { fileId: fileUpload.id, blockType: "file" };
                if (!returnDetails) return result.fileId;
                return result;
            } catch (fallbackError) {
                console.error("[LD-Notion] 文件回退上传失败:", fallbackError);
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

    // 获取单个块信息
    fetchBlock: async (blockId, apiKey) => {
        return await NotionAPI.request("GET", `/blocks/${blockId}`, null, apiKey);
    },

    // 获取块的子块
    fetchBlocks: async (blockId, cursor, apiKey) => {
        let endpoint = `/blocks/${blockId}/children`;
        if (cursor) endpoint += `?start_cursor=${cursor}`;
        return await NotionAPI.request("GET", endpoint, null, apiKey);
    },

    // 追加子块，支持末尾/开头/某个块之后插入
    appendBlockChildren: async (blockId, children, apiKey, options = {}) => {
        const safeChildren = Array.isArray(children) ? children : [];
        const endpoint = `/blocks/${blockId}/children`;
        const payload = { children: safeChildren };

        if (options.after) {
            payload.after = String(options.after);
        }

        return await NotionAPI.request("PATCH", endpoint, payload, apiKey);
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
    queryDatabase: async (databaseId, filter, sorts, cursor, apiKey, pageSize) => {
        const data = {};
        let normalizedCursor = cursor;
        let normalizedPageSize = pageSize;

        if (typeof normalizedCursor === "number" && typeof normalizedPageSize === "undefined") {
            normalizedPageSize = normalizedCursor;
            normalizedCursor = null;
        }

        if (filter) data.filter = filter;
        if (sorts) data.sorts = sorts;
        if (normalizedCursor) data.start_cursor = normalizedCursor;

        const safePageSize = parseInt(normalizedPageSize, 10);
        if (Number.isFinite(safePageSize) && safePageSize > 0) {
            data.page_size = Math.min(safePageSize, 100);
        }

        return await NotionAPI.request("POST", `/databases/${databaseId}/query`, data, apiKey);
    },

    // ========== 更新操作 (STANDARD) ==========

    // 更新页面属性
    updatePage: async (pageId, properties, apiKey) => {
        return await NotionAPI.request("PATCH", `/pages/${pageId}`, { properties }, apiKey);
    },

    // 更新页面元数据（icon / cover / lock / trash 等）
    updatePageMeta: async (pageId, payload, apiKey) => {
        return await NotionAPI.request("PATCH", `/pages/${pageId}`, payload, apiKey);
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

    // ========== 评论 (COMMENT) ==========

    // 获取单条评论
    getComment: async (commentId, apiKey) => {
        if (!commentId) throw new Error("commentId 不能为空");

        return await NotionAPI.request(
            "GET",
            `/comments/${commentId}`,
            null,
            apiKey,
            3,
            { notionVersion: CONFIG.API.COMMENT_NOTION_VERSION }
        );
    },

    // 获取页面或块的未解决评论
    listComments: async (blockId, cursor, pageSize, apiKey) => {
        if (!blockId) throw new Error("blockId 不能为空");

        const params = [`block_id=${encodeURIComponent(blockId)}`];
        if (cursor) params.push(`start_cursor=${encodeURIComponent(cursor)}`);
        if (pageSize) {
            const safePageSize = Math.max(1, Math.min(Number(pageSize) || 50, 100));
            params.push(`page_size=${safePageSize}`);
        }

        return await NotionAPI.request(
            "GET",
            `/comments?${params.join("&")}`,
            null,
            apiKey,
            3,
            { notionVersion: CONFIG.API.COMMENT_NOTION_VERSION }
        );
    },

    // 在页面、块或现有讨论中创建评论
    createComment: async ({ pageId, blockId, discussionId, content, markdown, attachments, displayName } = {}, apiKey) => {
        const targets = [pageId ? "page" : null, blockId ? "block" : null, discussionId ? "discussion" : null].filter(Boolean);
        if (targets.length !== 1) {
            throw new Error("必须且只能提供 pageId、blockId 或 discussionId 之一");
        }

        const body = {};
        if (discussionId) {
            body.discussion_id = discussionId;
        } else {
            body.parent = pageId ? { page_id: pageId } : { block_id: blockId };
        }

        const commentText = String(content || "").trim();
        const commentMarkdown = String(markdown || "").trim();
        if (!!commentText === !!commentMarkdown) {
            throw new Error("必须且只能提供 content 或 markdown 之一");
        }

        if (commentMarkdown) {
            body.markdown = commentMarkdown;
        } else {
            body.rich_text = [{ type: "text", text: { content: commentText } }];
        }

        if (Array.isArray(attachments) && attachments.length > 0) {
            body.attachments = attachments.slice(0, 3);
        }

        if (displayName && typeof displayName === "object") {
            body.display_name = displayName;
        }

        return await NotionAPI.request(
            "POST",
            "/comments",
            body,
            apiKey,
            3,
            { notionVersion: CONFIG.API.COMMENT_NOTION_VERSION }
        );
    },

    // ========== Markdown 内容 API ==========

    // 获取页面 Markdown 内容
    fetchPageMarkdown: async (pageId, apiKey) => {
        if (!pageId) throw new Error("pageId 不能为空");

        return await NotionAPI.request(
            "GET",
            `/pages/${pageId}/markdown`,
            null,
            apiKey,
            3,
            { notionVersion: CONFIG.API.MARKDOWN_NOTION_VERSION }
        );
    },

    // 直接调用页面 Markdown 更新接口
    updatePageMarkdown: async (pageId, payload, apiKey) => {
        if (!pageId) throw new Error("pageId 不能为空");
        if (!payload || typeof payload !== "object") throw new Error("payload 必须为对象");

        return await NotionAPI.request(
            "PATCH",
            `/pages/${pageId}/markdown`,
            payload,
            apiKey,
            3,
            { notionVersion: CONFIG.API.MARKDOWN_NOTION_VERSION }
        );
    },

    // 在页面尾部或指定锚点后插入 Markdown
    appendPageMarkdown: async (pageId, content, apiKey, after) => {
        const markdown = String(content || "").trim();
        if (!markdown) throw new Error("content 不能为空");

        const payload = {
            type: "insert_content",
            insert_content: {
                content: markdown
            }
        };
        if (after) {
            payload.insert_content.after = String(after);
        }

        return await NotionAPI.updatePageMarkdown(pageId, payload, apiKey);
    },

    // 基于 old_str -> new_str 的精确内容更新
    searchReplacePageMarkdown: async (pageId, contentUpdates, apiKey, allowDeletingContent = false) => {
        if (!Array.isArray(contentUpdates) || contentUpdates.length === 0) {
            throw new Error("contentUpdates 不能为空");
        }

        const normalizedUpdates = contentUpdates.map((item) => {
            const oldStr = String(item.old_str || "").trim();
            const newStr = String(item.new_str || "");
            if (!oldStr) throw new Error("每条 content update 都必须提供 old_str");
            return {
                old_str: oldStr,
                new_str: newStr,
                replace_all_matches: !!item.replace_all_matches,
            };
        });

        return await NotionAPI.updatePageMarkdown(pageId, {
            type: "update_content",
            update_content: {
                content_updates: normalizedUpdates,
                allow_deleting_content: !!allowDeletingContent,
            },
        }, apiKey);
    },

    // 用新的 Markdown 完整替换页面内容
    replacePageMarkdown: async (pageId, newContent, apiKey, allowDeletingContent = false) => {
        const markdown = String(newContent || "");
        if (!markdown.trim()) throw new Error("newContent 不能为空");

        return await NotionAPI.updatePageMarkdown(pageId, {
            type: "replace_content",
            replace_content: {
                new_str: markdown,
                allow_deleting_content: !!allowDeletingContent,
            },
        }, apiKey);
    },
};

// ===========================================

const ObsidianAPI = {
    testConnection: async (apiUrl, apiKey) => {
        const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `${apiUrl}/vault/`,
                headers: { Authorization: `Bearer ${apiKey}` },
                responseType: "json",
                onload: (r) => resolve(r),
                onerror: (e) => reject(e),
            });
        });
        if (resp.status === 200 || resp.status === 204) return { ok: true };
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },

    writeNote: async (apiUrl, apiKey, path, content) => {
        const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "PUT",
                url: `${apiUrl}/vault/${encodeURIComponent(path)}`,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "text/markdown",
                },
                data: content,
                onload: (r) => resolve(r),
                onerror: (e) => reject(e),
            });
        });
        if (resp.status === 200 || resp.status === 204 || resp.status === 201) {
            return { ok: true };
        }
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },

    writeImage: async (apiUrl, apiKey, path, blob, contentType) => {
        const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "PUT",
                url: `${apiUrl}/vault/${encodeURIComponent(path)}`,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": contentType || "application/octet-stream",
                },
                data: blob,
                onload: (r) => resolve(r),
                onerror: (e) => reject(e),
            });
        });
        if (resp.status === 200 || resp.status === 204 || resp.status === 201) {
            return { ok: true };
        }
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },
};


const HTMLToMarkdown = {
    convert: (html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return HTMLToMarkdown._convertNode(doc.body);
    },

    _convertNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || "";
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const tag = node.tagName.toLowerCase();
        const children = HTMLToMarkdown._convertChildren(node);

        switch (tag) {
            case "h1": return `# ${children}\n\n`;
            case "h2": return `## ${children}\n\n`;
            case "h3": return `### ${children}\n\n`;
            case "h4": return `#### ${children}\n\n`;
            case "h5": return `##### ${children}\n\n`;
            case "h6": return `###### ${children}\n\n`;
            case "p": return `${children}\n\n`;
            case "br": return "\n";
            case "hr": return "---\n\n";
            case "strong": case "b": return `**${children}**`;
            case "em": case "i": return `*${children}*`;
            case "del": case "s": return `~~${children}~~`;
            case "code": {
                const parent = node.parentElement;
                if (parent && parent.tagName.toLowerCase() === "pre") return children;
                return `\`${children}\``;
            }
            case "pre": {
                const codeEl = node.querySelector("code");
                const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || "";
                const text = codeEl ? codeEl.textContent : node.textContent;
                return `\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
            }
            case "blockquote": {
                const lines = children.trim().split("\n");
                return lines.map((l) => `> ${l}`).join("\n") + "\n\n";
            }
            case "a": {
                const href = node.getAttribute("href") || "";
                if (href.startsWith("http")) return `[${children}](${href})`;
                return children;
            }
            case "img": {
                const src = node.getAttribute("src") || "";
                const alt = node.getAttribute("alt") || "";
                return `![${alt}](${src})`;
            }
            case "ul": return children;
            case "ol": {
                const items = node.querySelectorAll(":scope > li");
                let idx = 1;
                return Array.from(items).map((li) => {
                    const md = HTMLToMarkdown._convertNode(li).trim();
                    const result = `${idx}. ${md}\n`;
                    idx++;
                    return result;
                }).join("") + "\n";
            }
            case "li": return `- ${children}\n`;
            case "table": return HTMLToMarkdown._convertTable(node) + "\n\n";
            case "iframe": {
                const src = node.getAttribute("src") || "";
                return `[嵌入内容](${src})\n\n`;
            }
            case "video": {
                const src = node.getAttribute("src") || node.querySelector("source")?.getAttribute("src") || "";
                return `[视频](${src})\n\n`;
            }
            case "audio": {
                const src = node.getAttribute("src") || "";
                return `[音频](${src})\n\n`;
            }
            case "div": {
                const cls = node.className || "";
                if (cls.includes("onebox")) {
                    return `> [!quote]\n> ${children.trim()}\n\n`;
                }
                return children;
            }
            default: return children;
        }
    },

    _convertChildren: (node) => {
        return Array.from(node.childNodes).map(HTMLToMarkdown._convertNode).join("");
    },

    _convertTable: (table) => {
        const rows = table.querySelectorAll("tr");
        if (rows.length === 0) return "";
        const result = [];
        rows.forEach((row, i) => {
            const cells = Array.from(row.querySelectorAll("th, td")).map((c) => {
                return HTMLToMarkdown._convertChildren(c).replace(/\n/g, " ").trim();
            });
            result.push(`| ${cells.join(" | ")} |`);
            if (i === 0) {
                result.push(`| ${cells.map(() => "---").join(" | ")} |`);
            }
        });
        return result.join("\n");
    },

    buildFrontmatter: (meta) => {
        const lines = ["---"];
        const esc = (s) => String(s || "").replace(/"/g, '\\"');
        if (meta.title) lines.push(`title: "${esc(meta.title)}"`);
        if (meta.url) lines.push(`url: "${esc(meta.url)}"`);
        if (meta.author) lines.push(`author: "${esc(meta.author)}"`);
        if (meta.source) lines.push(`source: "${esc(meta.source)}"`);
        if (meta.sourceType) lines.push(`source_type: "${esc(meta.sourceType)}"`);
        if (meta.topicId) lines.push(`topic_id: ${meta.topicId}`);
        if (meta.owner) lines.push(`owner: "${esc(meta.owner)}"`);
        if (meta.repo) lines.push(`repo: "${esc(meta.repo)}"`);
        if (meta.gistId) lines.push(`gist_id: "${esc(meta.gistId)}"`);
        if (meta.category) lines.push(`category: "${esc(meta.category)}"`);
        if (meta.language) lines.push(`language: "${esc(meta.language)}"`);
        if (Number.isFinite(Number(meta.stars))) lines.push(`stars: ${Number(meta.stars)}`);
        if (meta.updatedAt) lines.push(`updated_at: "${esc(meta.updatedAt)}"`);
        if (meta.tags && meta.tags.length > 0) {
            lines.push("tags:");
            meta.tags.forEach((t) => lines.push(`  - "${esc(t)}"`));
        }
        lines.push(`export_time: "${new Date().toISOString()}"`);
        if (meta.floors !== undefined) lines.push(`floors: ${meta.floors}`);
        lines.push("---");
        return lines.join("\n") + "\n\n";
    },

    buildPostCallout: (post, index, isOp) => {
        const type = isOp ? "success" : "note";
        const collapsed = index > 0 ? "+" : "";
        const username = post.username || "未知";
        const postNum = post.post_number || (index + 1);
        const date = post.created_at
            ? new Date(post.created_at).toLocaleString("zh-CN")
            : "未知时间";
        const header = `#${postNum} ${username}${post.username ? ` (@${post.username})` : ""}${isOp ? " 楼主" : ""} · ${date}`;
        const content = HTMLToMarkdown.convert(post.cooked || "");
        const lines = content.trim().split("\n");
        const quoted = lines.map((l) => `> ${l}`).join("\n");
        return `> [!${type}]${collapsed} ${header}\n${quoted}\n> ^floor-${postNum}\n\n`;
    },
};

module.exports = { SiteDetector, InstallHelper, EMOJI_MAP, NOTION_LANGUAGES, normalizeLanguage, DOMToNotion, NotionTransport, NotionAPI, ObsidianAPI, HTMLToMarkdown };
