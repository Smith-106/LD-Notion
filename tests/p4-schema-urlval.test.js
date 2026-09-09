import { describe, it, expect } from "vitest";

// P4 第六批回归: schema emoji/checkbox/parseAIJson 边界 + normalizeLanguage + UrlValidator IPv6/协议
const { AISchema } = require("../src/ai/schema.js");
const { normalizeLanguage } = require("../src/api/constants.js");
const { UrlValidator } = require("../src/security/UrlValidator.js");

describe("P4: AISchema 边界", () => {
    it("validateEmoji 超长且含控制字符时拒绝(不再绕过过滤)", () => {
        expect(AISchema.validateEmoji("a".repeat(40) + "\u0007")).toBe("");
        expect(AISchema.validateEmoji("a".repeat(40))).toBe("a".repeat(AISchema.MAX_EMOJI));
        expect(AISchema.validateEmoji("🎉")).toBe("🎉");
    });

    it("checkbox 字符串假值不再被强转成 true", () => {
        expect(AISchema.validatePropertyValue("false", "checkbox")).toBe(false);
        expect(AISchema.validatePropertyValue("0", "checkbox")).toBe(false);
        expect(AISchema.validatePropertyValue("true", "checkbox")).toBe(true);
        expect(AISchema.validatePropertyValue(true, "checkbox")).toBe(true);
        expect(AISchema.validatePropertyValue(1, "checkbox")).toBe(true);
    });

    it("parseAIJson 非字符串响应返回 {ok:false} 而非抛 TypeError", () => {
        for (const bad of [{ a: 1 }, [1, 2], 42, Buffer.from("{}")]) {
            const result = AISchema.parseAIJson("intent", bad);
            expect(result.ok).toBe(false);
            expect(result.reason).toContain("不是字符串");
        }
    });

    it("parseAIJson 字符串响应仍正常解析", () => {
        const result = AISchema.parseAIJson("intent", '{"intent":"query"}');
        expect(result.ok).toBe(true);
        expect(result.value.intent).toBe("query");
    });
});

describe("P4: normalizeLanguage 边界", () => {
    it("非字符串真值不再抛 TypeError", () => {
        for (const bad of [123, [], {}, true, Symbol.iterator ? undefined : undefined]) {
            expect(normalizeLanguage(bad)).toBe("plain text");
        }
        expect(normalizeLanguage(null)).toBe("plain text");
    });

    it("原型链键不再返回函数/对象", () => {
        for (const key of ["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"]) {
            expect(normalizeLanguage(key)).toBe("plain text");
        }
    });

    it("白名单与别名仍正常归一", () => {
        expect(normalizeLanguage("JS")).toBe("javascript");
        expect(normalizeLanguage(" yml ")).toBe("yaml");
        expect(normalizeLanguage("python")).toBe("python");
        expect(normalizeLanguage("unknown-lang")).toBe("plain text");
    });
});

describe("P4: UrlValidator IPv6/协议边界", () => {
    it("validateObsidianUrl 支持方括号 IPv6 回环", () => {
        expect(UrlValidator.validateObsidianUrl("http://[::1]:27123")).toBe(true);
        expect(UrlValidator.validateObsidianUrl("http://127.0.0.1:27123")).toBe(true);
        expect(UrlValidator.validateObsidianUrl("http://localhost:27123")).toBe(true);
    });

    it("validateObsidianUrl 拒绝非 http(s) 协议与非本地主机", () => {
        expect(UrlValidator.validateObsidianUrl("file://127.0.0.1")).toBe(false);
        expect(UrlValidator.validateObsidianUrl("ftp://localhost")).toBe(false);
        expect(UrlValidator.validateObsidianUrl("http://evil.example")).toBe(false);
    });

    it("_isPrivateHost 拦截 IPv4-compatible/mapped IPv6", () => {
        for (const host of ["[::1]", "[::7f00:1]", "[::a9fe:a9fe]", "[::ffff:7f00:1]", "[fe80::1]", "[fe90::1]", "[febf::1]", "[fc00::1]", "[fd12::1]"]) {
            expect(UrlValidator._isPrivateHost(host), host).toBe(true);
        }
    });

    it("_isPrivateHost 放行公网 IPv6", () => {
        for (const host of ["[2606:4700:4700::1111]", "[::2606:4700]", "[2001:4860:4860::8888]"]) {
            expect(UrlValidator._isPrivateHost(host), host).toBe(false);
        }
    });

    it("validatePageExternalUrl 拒绝 IPv4-compatible 内网/元数据地址", () => {
        expect(UrlValidator.validatePageExternalUrl("http://[::127.0.0.1]/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://[::a9fe:a9fe]/latest/meta-data")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("https://example.com/a.png")).toBe(true);
    });
});
