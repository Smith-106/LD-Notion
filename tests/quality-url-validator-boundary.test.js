import { describe, it, expect } from "vitest";

// quality-auto-test p3 (AT-001/AT-002, L1): SSRF 边界矩阵 + 导出账本容量淘汰。
// AT-001: UrlValidator 三入口的安全边界(云元数据/内网/通配 DNS/协议面)。
// AT-002: 导出事实账本 10000 容量上限淘汰最旧(AGENTS.md: 禁止对导出账本用时间 TTL)。
const { UrlValidator } = require("../src/security/UrlValidator.js");
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter.js");

describe("AT-001: UrlValidator SSRF/白名单边界矩阵", () => {
    it("validatePageExternalUrl: 云元数据 169.254.169.254 拒绝", () => {
        expect(UrlValidator.validatePageExternalUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    });

    it("validatePageExternalUrl: 内网段(10/172.16-31/192.168/127)拒绝", () => {
        expect(UrlValidator.validatePageExternalUrl("http://10.0.0.5/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://172.20.1.1/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("https://192.168.1.100/icon.png")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("http://127.0.0.1:8080/x")).toBe(false);
    });

    it("validatePageExternalUrl: 通配 DNS 后缀(nip.io/sslip.io)拒绝", () => {
        expect(UrlValidator.validatePageExternalUrl("http://10.0.0.1.nip.io/x")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("https://meta.ssrf.sh/x")).toBe(false);
    });

    it("validatePageExternalUrl: javascript:/data: 协议拒绝", () => {
        expect(UrlValidator.validatePageExternalUrl("javascript:alert(1)")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
        expect(UrlValidator.validatePageExternalUrl("file:///etc/passwd")).toBe(false);
    });

    it("validatePageExternalUrl: 公网 https 放行 + 空值拒绝", () => {
        expect(UrlValidator.validatePageExternalUrl("https://example.com/cover.png")).toBe(true);
        expect(UrlValidator.validatePageExternalUrl("https://gist.github.com/u/1")).toBe(true);
        expect(UrlValidator.validatePageExternalUrl("")).toBe(false);
    });

    it("validateAiBaseUrl: 白名单域放行, 内网反代拒绝, 自定义公网 https 放行, http 拒绝", () => {
        expect(UrlValidator.validateAiBaseUrl("https://api.openai.com/v1")).toBe(true);
        expect(UrlValidator.validateAiBaseUrl("https://api.anthropic.com")).toBe(true);
        expect(UrlValidator.validateAiBaseUrl("https://127.0.0.1/v1")).toBe(false);
        expect(UrlValidator.validateAiBaseUrl("https://169.254.169.254/v1")).toBe(false);
        expect(UrlValidator.validateAiBaseUrl("https://my-proxy.example.com/v1")).toBe(true);
        expect(UrlValidator.validateAiBaseUrl("http://api.openai.com/v1")).toBe(false);
        expect(UrlValidator.validateAiBaseUrl("")).toBe(true); // 非空时才校验
    });

    it("validateObsidianUrl: 仅本地 http(s) 放行, [::1] 形态放行, 远程拒绝", () => {
        expect(UrlValidator.validateObsidianUrl("http://127.0.0.1:27123")).toBe(true);
        expect(UrlValidator.validateObsidianUrl("https://localhost:27124")).toBe(true);
        expect(UrlValidator.validateObsidianUrl("http://[::1]:27123")).toBe(true);
        expect(UrlValidator.validateObsidianUrl("https://example.com")).toBe(false);
        expect(UrlValidator.validateObsidianUrl("file://127.0.0.1:27123")).toBe(false);
        expect(UrlValidator.validateObsidianUrl("")).toBe(false);
    });
});

describe("AT-002: 导出账本容量淘汰 _evictByCapacity", () => {
    it("超限淘汰最旧 ts 项至容量上限", () => {
        const ledger = {};
        for (let i = 0; i < BookmarkExporter._EXPORT_CAPACITY_LIMIT + 5; i++) {
            ledger[`url-${i}`] = 1000 + i; // ts 递增, 最旧在前
        }
        BookmarkExporter._evictByCapacity(ledger);
        const keys = Object.keys(ledger);
        expect(keys).toHaveLength(BookmarkExporter._EXPORT_CAPACITY_LIMIT);
        expect(ledger["url-0"]).toBeUndefined(); // 最旧 5 项被淘汰
        expect(ledger["url-4"]).toBeUndefined();
        expect(ledger["url-5"]).toBeTruthy();
        expect(ledger[`url-${BookmarkExporter._EXPORT_CAPACITY_LIMIT + 4}`]).toBeTruthy(); // 最新保留
    });

    it("未超限零淘汰 + 幂等", () => {
        const ledger = { a: 1, b: 2, c: 3 };
        BookmarkExporter._evictByCapacity(ledger);
        expect(Object.keys(ledger)).toHaveLength(3);
        BookmarkExporter._evictByCapacity(ledger);
        expect(Object.keys(ledger)).toHaveLength(3);
    });

    it("相同 ts 稳定序淘汰(不抛错, 收敛到容量内)", () => {
        const ledger = {};
        const N = BookmarkExporter._EXPORT_CAPACITY_LIMIT + 3;
        for (let i = 0; i < N; i++) ledger[`k-${i}`] = 42; // 全部相同 ts
        expect(() => BookmarkExporter._evictByCapacity(ledger)).not.toThrow();
        expect(Object.keys(ledger)).toHaveLength(BookmarkExporter._EXPORT_CAPACITY_LIMIT);
    });
});
