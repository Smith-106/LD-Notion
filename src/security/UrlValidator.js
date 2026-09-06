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

    // v3.14.6 (XN-02): 通配 DNS 后缀黑名单 —— nip.io 等将任意子域解析到内网/127.0.0.1,
    // WHATWG URL 不归一化域名形态, 字面匹配无法拦截(SSRF 已知限制的静态收窄层)。
    // 注: 非规范 IP 字面量(2130706433/0x7f000001/0177.0.0.1/127.1/前导零)已被 WHATWG
    // URL 解析器归一化为点分十进制(实测), 落入 _isPrivateHost 网段校验, 此处为纵深防御。
    WILDCARD_DNS_PATTERN: /\.(nip\.io|sslip\.io|xip\.io|loca\.lt|ssrf\.sh)$/i,

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
        return !UrlValidator._isPrivateHost(parsed.hostname) && !UrlValidator._isSuspiciousHostname(parsed.hostname);
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
        return !UrlValidator._isPrivateHost(parsed.hostname) && !UrlValidator._isSuspiciousHostname(parsed.hostname);
    },

    // v3.14.6 (XN-02): 可疑 hostname 静态判定 —— 通配 DNS 后缀 + 纵深防御非规范 IP 字面量
    _isSuspiciousHostname: (hostname) => {
        const h = String(hostname).replace(/\.$/, "").toLowerCase();
        if (UrlValidator.WILDCARD_DNS_PATTERN.test(h)) return true;
        // 纵深防御: 纯数字整数 / 0x 十六进制整体 / 混合段 0x|0b 前缀(WHATWG 已归一化, 兜底) 
        if (/^\d+$/.test(h)) return true;
        if (/^0x[0-9a-f]+$/i.test(h)) return true;
        const segs = h.split(".");
        if (segs.length === 4 && segs.some((s) => /^0x/i.test(s) || /^0b/i.test(s))) return true;
        // 前导零段(0177 等八进制形态, 段长可超 3 位)——仅当末段为纯数字 IP 字面量形态时判定,
        // 避免误拒 a.b.01.com 类合法域名(WHATWG 仅末段全数字按 IPv4 解析, rev NEW-03)
        if (segs.length === 4 && /^\d+$/.test(segs[3]) && segs.some((s) => /^0\d+$/.test(s))) return true;
        return false;
    },

    // 判断是否为私有/内网主机
    _isPrivateHost: (hostname) => {
        // WHATWG URL 对 IPv4-mapped IPv6 归一化为十六进制(如 ::ffff:7f00:1),
        // 且保留 localhost 尾点(localhost.)——两者均可能绕过字面匹配(安全审计 hy3 HIGH)。
        const normalized = String(hostname).replace(/\.$/, "").toLowerCase();
        if (UrlValidator.LOCAL_HOSTS.has(normalized)) return true;
        // 127.x/8(此前仅 LOCAL_HOSTS 的 localhost/127.0.0.1 字面量)、0.0.0.0、
        // 10.x / 172.16-31.x / 192.168.x / 169.254.x(全盘审计 find 21 补漏网段)
        const m = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (m) {
            const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
            if (a === 127 || (a === 0 && b === 0)) return true;
            if (a === 10) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 192 && b === 168) return true;
            if (a === 169 && b === 254) return true;
        }
        // IPv6 私有段/回环(new URL 可规范化的形式)
        if (normalized.startsWith("[")) {
            const bare = normalized.replace(/^\[|\]$/g, "");
            if (bare === "::1" || bare === "::" || bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd") || bare.startsWith("::ffff:127.")) return true;
            // IPv4-mapped 私有段 ::ffff:a.b.c.d
            const v4m = bare.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
            if (v4m) return UrlValidator._isPrivateHost(v4m.slice(1).join("."));
            // IPv4-mapped 十六进制形态(WHATWG 规范化输出): ::ffff:7f00:1 / ::ffff:a9fe:a9fe
            const v4mHex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
            if (v4mHex) {
                const hi = parseInt(v4mHex[1], 16);
                const lo = parseInt(v4mHex[2], 16);
                return UrlValidator._isPrivateHost(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
            }
        }
        return false;
    },
};

module.exports = { UrlValidator };
