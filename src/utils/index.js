"use strict";

const { CONFIG } = require("../config");
const { Storage } = require("../storage");
const { sha256HexSync } = require("./sha256");

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
        if (src.startsWith("http://") || src.startsWith("https://")) return src;
        if (src.startsWith("//")) return window.location.protocol + src;
        if (src.startsWith("/")) return window.location.origin + src;
        return window.location.origin + "/" + src.replace(/^\.?\//, "");
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

    base64Encode: (input) => {
        const normalized = String(input ?? "");
        if (typeof btoa === "function") return btoa(normalized);
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
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
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
