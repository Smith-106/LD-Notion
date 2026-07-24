"use strict";

// URL 安全校验：防止自定义 baseUrl 将 API key 泄露到攻击者服务器
const UrlValidator = {
    // 已知 AI 服务商域名白名单
    AI_ALLOWED_HOSTS: new Set([
        "api.openai.com",
        "api.anthropic.com",
        "generativelanguage.googleapis.com",
    ]),

    // 本地/私有地址（Obsidian Local REST API 仅运行在本地）
    LOCAL_HOSTS: new Set(["127.0.0.1", "localhost", "::1"]),

    // 校验 AI 请求 baseUrl：白名单或 HTTPS（非空时）
    validateAiBaseUrl: (baseUrl) => {
        if (!baseUrl) return true;
        let parsed;
        try {
            parsed = new URL(baseUrl);
        } catch {
            return false;
        }
        if (parsed.protocol !== "https:") return false;
        if (UrlValidator.AI_ALLOWED_HOSTS.has(parsed.hostname)) return true;
        // 允许自定义 HTTPS 域名（用户自建反代），但拒绝 localhost/内网
        return !UrlValidator._isPrivateHost(parsed.hostname);
    },

    // 校验 Obsidian API URL：仅允许本地地址
    validateObsidianUrl: (apiUrl) => {
        if (!apiUrl) return false;
        let parsed;
        try {
            parsed = new URL(apiUrl);
        } catch {
            return false;
        }
        return UrlValidator.LOCAL_HOSTS.has(parsed.hostname);
    },

    // 校验 AI 返回的页面外部 URL（icon/cover external.url）。
    // 与 validateAiBaseUrl 语义不同：这是 Notion 页面属性的外部资源 URL，
    // Notion 服务端会抓取 external.url → SSRF 触发点。必须限定 http(s) 协议
    // （拒 javascript:/data:/file:）且拒绝内网/私有/链路本地地址（防云元数据 169.254.169.254 等）。
    // 复用 _isPrivateHost 保持 URL 安全原语单一来源（ISS-20260723-009 CWE-94）。
    validatePageExternalUrl: (url) => {
        if (!url) return false;
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return false;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
        return !UrlValidator._isPrivateHost(parsed.hostname);
    },

    // 判断是否为私有/内网主机
    _isPrivateHost: (hostname) => {
        if (UrlValidator.LOCAL_HOSTS.has(hostname)) return true;
        // 10.x / 172.16-31.x / 192.168.x / 169.254.x
        const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (m) {
            const [a, b] = [parseInt(m[1]), parseInt(m[2])];
            if (a === 10) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 192 && b === 168) return true;
            if (a === 169 && b === 254) return true;
        }
        return false;
    },
};

module.exports = { UrlValidator };
