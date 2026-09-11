"use strict";

const { CONFIG } = require("../config");
const { Storage } = require("../storage");
const { sha256HexSync } = require("./sha256");

// Markdown 链接目标需转义字符（百分号编码，不删除字符）
// wave19 共识(w19 qwen): 反斜杠必须一并编码 —— 目标串以 "\" 结尾时, 其后的 ")" 在 CommonMark
// 中被视作转义右括号(不闭合链接), 整个链接退化为字面文本(wave18 已在标签面修掉同类逃逸向量)
const MD_URL_ESCAPE = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E", " ": "%20", "\\": "%5C" };

// ===========================================
// 工具函数
// ===========================================
// 三种引号字符集（ASCII " U+0022、中文左/右双引号 U+201C/U+201D）。
// 用 Unicode 转义显式表达（编辑器中难以区分且易被规范化为同一码点）。
// 提升到模块级常量，避免每次调用 new RegExp 分配。
const QUOTE_CHARS = "[\\u0022\\u201C\\u201D]";
const QUOTE_RE = new RegExp(QUOTE_CHARS + "([^" + QUOTE_CHARS.slice(1) + "+)" + QUOTE_CHARS);
const QUOTE_RE_G = new RegExp(QUOTE_RE.source, "g");

const Utils = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    runWhenBrowserIdle: (task, timeout = 1200) => {
        if (typeof task !== "function") return;
        // 包 try/catch + promise catch：init 异常若被静默吞，main 顶层 try/catch 也捕获不到
        // 独立事件回调（requestIdleCallback/setTimeout）内的异常不冒泡到 main，须在此处兜底（REL-004）。
        const run = () => {
            try {
                const r = task();
                if (r && typeof r.catch === "function") {
                    r.catch((e) => console.error("[LD-Notion] idle task rejected:", e));
                }
            } catch (e) {
                console.error("[LD-Notion] idle task threw:", e);
            }
        };
        if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(run, { timeout });
            return;
        }
        run();
    },

    absoluteUrl: (src) => {
        if (!src) return "";
        // wave17 共识(glm): scheme 前缀判定原为字面量 startsWith(大小写敏感) —— HTML 属性值中
        // "HTTP://host/x" 保留原样且浏览器按大小写不敏感语义正常加载, 此处却落入相对分支被
        // 拼成 "<origin>/HTTP://host/x"(hostname 变成站点自身) → 合法嵌入被静默丢弃。
        // 与同文件 isHttpUrl(:52) 及 DomSpec.safeUrl 的 scheme 正则(带 /i)口径对齐。
        const value = String(src);
        if (/^https?:\/\//i.test(value)) return value;
        if (value.startsWith("//")) return window.location.protocol + value;
        if (value.startsWith("/")) return window.location.origin + value;
        return window.location.origin + "/" + value.replace(/^\.?\//, "");
    },

    isHttpUrl: (value) => /^https?:\/\//i.test(String(value || "").trim()),

    // v3.14.6 (AUD-ARCH-05): userscript 模式判定 —— 扩展垫片 scriptHandler='chrome-extension'
    // 会令旧判定恒真(徽章误标/扩展专属功能跳过), 显式排除
    isUserscriptMode: () =>
        typeof GM_info !== "undefined"
        && !!GM_info.scriptHandler
        && GM_info.scriptHandler !== "chrome-extension",

    extractNotionId: (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";

        if (/^[0-9a-f]{32}$/i.test(raw)) {
            return raw.toLowerCase();
        }
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
            return raw.replace(/-/g, "").toLowerCase();
        }

        try {
            const parsed = new URL(raw);
            const combined = `${parsed.pathname}${parsed.hash || ""}`;
            const matches = combined.match(/[0-9a-f]{32}/ig);
            if (matches && matches.length > 0) {
                return matches[matches.length - 1].toLowerCase();
            }
        } catch (_) { /* URL 解析失败→落入下方通用正则回退 */ }

        const genericMatch = raw.match(/[0-9a-f]{32}/i);
        return genericMatch ? genericMatch[0].toLowerCase() : "";
    },

    // 非可逆的 API Key 指纹：仅供缓存失效比较（apiKeyHash 持久化到 GM 存储，
    // 不可用 slice(-8) 等明文子串——会泄露密钥材料，CWE-312）。
    // 升级为 SHA-256 前 16 位 hex(安全审计 hy3 LOW: djb2 32 位可枚举碰撞;
    // SHA-256 与浏览器/Node 互通, 且保持相等性比较语义不变)。
    apiKeyHash: (apiKey) => {
        if (!apiKey) return "";
        return sha256HexSync(apiKey).slice(0, 16);
    },

    extractQuotedText: (value) => {
        const match = String(value || "").match(QUOTE_RE);
        return match ? match[1].trim() : "";
    },

    extractQuotedTexts: (value) => {
        const matches = [...String(value || "").matchAll(QUOTE_RE_G)];
        return matches.map(match => String(match[1] || "").trim()).filter(Boolean);
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
        } catch (e) {
            // Discourse 全局存在但 .User.current() 抛错时补 warn，便于诊断用户名探测静默失败（L4）
            console.warn("[LD-Notion] Discourse 用户名探测失败:", e);
        }

        return "";
    },

    formatDate: (dateStr) => {
        if (!dateStr) return "";
        return new Date(dateStr).toLocaleString("zh-CN");
    },

    truncateText: (text, maxLen = 100) => {
        // wave18 共识(dsf): 直接 text.length/substring —— 非字符串 truthy 输入(number/对象,
        // 如导入数据/报告条目里的 title 字段)在此抛 TypeError, 且调用点多在 UI 拼接与错误
        // 路径上, 二次抛错会掩盖真实原因 → 统一先字符串化(此前 !text 短路还会原样回传 0/false)。
        const value = String(text ?? "");
        if (value.length <= maxLen) return value;
        // wave18 共识(qwen): 按 UTF-16 码元截断会在代理对中间断开(孤立高代理项 → 替换字符),
        // 与 BlockConverter.splitLongText 的代理对保护同口径。
        const last = value.charCodeAt(maxLen - 1);
        const cut = (last >= 0xd800 && last <= 0xdbff) ? maxLen - 1 : maxLen;
        return value.substring(0, cut) + "...";
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

    base64Encode: (input) => {
        const normalized = String(input ?? "");
        if (typeof btoa === "function") {
            try {
                // P4 收敛(c17): btoa 对 U+0080–U+00FF 不抛错(按 Latin-1 编码), 与
                // base64DecodeUnicode 的 UTF-8 解码不对称 —— 非 ASCII 必须先转 UTF-8 字节
                if (/[\u0080-\uFFFF]/.test(normalized)) throw new Error("non-latin1");
                return btoa(normalized);
            } catch {
                const bytes = new TextEncoder().encode(normalized);
                let binary = "";
                for (const b of bytes) binary += String.fromCharCode(b);
                return btoa(binary);
            }
        }
        if (typeof Buffer !== "undefined") return Buffer.from(normalized, "utf8").toString("base64");
        throw new Error("当前环境不支持 Base64 编码");
    },

    safeJsonParse: (input, fallback = null) => {
        if (input == null || input === "") return fallback;
        try {
            return JSON.parse(input);
        } catch {
            return fallback;
        }
    },

    randomToken: (prefix = "") => {
        const bytes = new Uint8Array(16);
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
            crypto.getRandomValues(bytes);
        } else {
            throw new Error("crypto.getRandomValues 不可用，无法生成安全随机 token");
        }
        const value = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
        return prefix ? `${prefix}_${value}` : value;
    },

    cleanupUrlParams: (paramNames = []) => {
        if (!Array.isArray(paramNames) || paramNames.length === 0) return;
        if (!window?.history?.replaceState) return;
        try {
            const current = new URL(window.location.href);
            let changed = false;
            paramNames.forEach((name) => {
                if (current.searchParams.has(name)) {
                    current.searchParams.delete(name);
                    changed = true;
                }
            });
            if (!changed) return;
            const nextUrl = `${current.pathname}${current.search}${current.hash}`;
            window.history.replaceState({}, document.title, nextUrl);
        } catch (_) { /* 非关键操作：URL 参数清理失败不影响核心功能 */ }
    },

    // HTML 转义，防止 XSS 攻击
    // 纯字符串替换，行为与 document.createElement('div')+textContent+innerHTML
    // 完全一致：转义 & < > " 四个字符，不转义 '（HTML textContent 语义）。
    // 避免每次调用创建一次性 DOM 节点——escapeHtml 在批量渲染热路径
    // （renderBookmarkList/updateLogPanel 等）被调用 60+ 处，DOM 节点创建放大 GC。
    escapeHtml: (text) => {
        // P4 收敛(c17): `!text` 把 0/false 当空串丢弃 —— 仅 null/undefined 为无值
        if (text == null) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    },

    // P4 收敛(c02/c05): Markdown 链接输出净化 —— 不可信标题/URL 含 ]( 等元字符
    // 可破坏链接结构并注入链接目标（标题来自 Notion 页面/搜索结果）。
    // wave12 系统扫描: 链接标签/列表项是单行上下文 —— 标签内换行会拆断 Markdown 行
    // (与标题/表格单元格同类, 一并收敛)
    // wave17 共识(glm): 原实现对 [ ] 直接**删除** —— 链接标签是子树 Markdown(可含内嵌图片
    // ![alt](url)), 删除内层方括号会把 "[![alt](u)](link)" 改写成损坏的 "[!alt(u)](link)"。
    // 改为反斜杠转义: 注入防护等价(]( 不再能逃逸链接语法), 且内容无损。
    // wave18 共识(dsf): 转义字符自身也必须转义 —— 标签以单个 "\" 结尾时(C:\ 一类标题),
    // 产出的 "[C:\](url)" 里 \] 是转义方括号、不闭合标签 → 整串退化为纯文本、链接目标丢失。
    mdText: (text) => String(text ?? "").replace(/([\\\[\]])/g, "\\$1").replace(/\r\n?|\n/g, " "),
    // P4 收敛(c05): 百分号编码替代删除——删除会改写链接目标(Wikipedia 带括号条目→404)
    // wave19 共识(w19 qwen): 补 \\(见 MD_URL_ESCAPE)
    mdUrl: (url) => String(url ?? "").replace(/[\s<>()\\]/g, (ch) => MD_URL_ESCAPE[ch] || encodeURIComponent(ch)),
    mdLink: (text, url) => `[${Utils.mdText(text)}](${Utils.mdUrl(url)})`,

    // GM_xmlhttpRequest onerror 回调参数为对象（如 { error, type }），直接模板串化
    // 会得到 "[object Object]" 吞掉真实原因；按常见字段优先级提取，
    // 普通串原样返回，对象兑底 JSON 序列化（截断）。
    formatRequestError: (error) => {
        if (error == null) return "未知错误";
        if (typeof error === "string") return error;
        if (typeof error === "object") {
            const detail = error.error || error.message || error.type;
            if (detail) return String(detail);
            try {
                return Utils.truncateText(JSON.stringify(error), 200) || "未知错误";
            } catch {
                return "未知错误";
            }
        }
        return String(error);
    },

    // R9 共识(URL 规范化去重键): 同一页面以不同 URL 形态收藏(http/https、尾斜杠、
    // fragment、tracking 参数)此前各算一条 → 重复导入。规范化后读写对称,
    // 存量旧键在 BookmarkExporter.getExported 内一次性迁移。
    normalizeDedupUrl: (url) => {
        const raw = String(url || "").trim();
        if (!raw || !/^https?:\/\//i.test(raw)) return raw;
        try {
            const parsed = new URL(raw);
            parsed.hash = "";
            const trackingParams = [
                "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
                "ref", "fbclid", "gclid", "mc_cid", "mc_eid", "spm", "from", "share_source",
            ];
            for (const p of trackingParams) parsed.searchParams.delete(p);
            let normalized = parsed.toString();
            // 去尾部斜杠(根路径 https://a.com/ → https://a.com)
            // wave18 复核(驳回 qwen 提案): “查询串内的尾斜杠未被编码、会被本正则剥掉”的前提不成立 ——
            // 上面的 searchParams.delete() 一旦执行即触发 query 重新序列化(application/x-www-form-urlencoded),
            // 查询值中的 "/" 会先变成 %2F(实测: ?q=foo/ → 键 https://linux.do/search?q=foo%2F),
            // 故本正则不可能触及查询值内的斜杠, 不存在“不同页面合并为同一去重键”。保持原实现。
            normalized = normalized.replace(/\/+$/, "");
            return normalized;
        } catch {
            return raw;
        }
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

    // 同步 SHA-256 hex(实现见 ./sha256, 零依赖; 与 SyncCrypto.sha256Hex 互通, 去重键跨设备哈希用)
    sha256HexSync,

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
        // F11 共识(大小写归一): 去重键用小写比较、保留首次出现的原样值,
        // 与下游白名单小写匹配语义一致(AI/ai/Ai 不再并存)。
        const seen = new Set();
        return categories.filter((item) => {
            const norm = item.toLowerCase();
            if (seen.has(norm)) return false;
            seen.add(norm);
            return true;
        });
    },
};

module.exports = { Utils };
