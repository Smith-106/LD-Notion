"use strict";

const { CONFIG } = require("../config");

// ===========================================
// 工具函数
// ===========================================
const Utils = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

    runWhenBrowserIdle: (task, timeout = 1200) => {
        if (typeof task !== "function") return;
        if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(() => task(), { timeout });
            return;
        }
        task();
    },

    absoluteUrl: (src) => {
        if (!src) return "";
        if (src.startsWith("http://") || src.startsWith("https://")) return src;
        if (src.startsWith("//")) return window.location.protocol + src;
        if (src.startsWith("/")) return window.location.origin + src;
        return window.location.origin + "/" + src.replace(/^\.?\//, "");
    },

    isHttpUrl: (value) => /^https?:\/\//i.test(String(value || "").trim()),

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
        } catch {}

        const genericMatch = raw.match(/[0-9a-f]{32}/i);
        return genericMatch ? genericMatch[0].toLowerCase() : "";
    },

    extractQuotedText: (value) => {
        const raw = String(value || "");
        const match = raw.match(/["""]([^""""]+)["""]/);
        return match ? match[1].trim() : "";
    },

    extractQuotedTexts: (value) => {
        const raw = String(value || "");
        const matches = [...raw.matchAll(/["""]([^""""]+)["""]/g)];
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
        } catch {}
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

module.exports = { Utils };
