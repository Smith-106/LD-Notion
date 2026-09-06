"use strict";

// v3.14.5 认证终态 fail-fast 契约测试:
// 场景: Notion 401(token invalid 且不可续签)时批量导出不应逐项重复失败(464 项全报
// "API token is invalid" 的根因),而应:①NotionAPI.request 抛 isAuthTerminal 标记错误
// ②批量循环立即中止批次 ③剩余项进 skipped ④已成功项的账本不丢
import { describe, it, expect, beforeEach } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;
global.GM_xmlhttpRequest = (opts) => {
    // 默认 401 invalid token(测试注入可覆盖)
    const responder = global.__ldNotionResponder;
    if (responder) return responder(opts);
    opts.onload({
        status: 401,
        responseText: JSON.stringify({ object: "error", status: 401, code: "unauthorized", message: "API token is invalid." }),
        responseHeaders: "",
    });
};
global.GM_notification = () => {};

const { CONFIG } = require("../src/config");
const { Storage } = require("../src/storage");
const { NotionAPI } = require("../src/api");
const { Exporter } = require("../src/export");

beforeEach(() => {
    store.clear();
    global.__ldNotionResponder = null;
});

describe("R-AUTH-01: NotionAPI.request 认证终态标记", () => {
    it("401 API token is invalid → 抛出 isAuthTerminal=true 错误", async () => {
        await expect(NotionAPI.request("POST", "/pages", {}, "secret_invalid", 3)).rejects.toMatchObject({
            message: expect.stringContaining("API token is invalid"),
        });
        try {
            await NotionAPI.request("POST", "/pages", {}, "secret_invalid", 3);
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error.isAuthTerminal).toBe(true);
        }
    });

    it("401 且 OAuth 可续签但续签也失败(invalid_grant 终态) → 续签错误带 isAuthTerminal", async () => {
        // 配置 OAuth ready + connected,但 exchange 返回 invalid_grant
        const { NotionOAuth } = require("../src/auth");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, "cid");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_expired");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "rt-about-to-die");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, "csecret");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI, "https://www.notion.so/");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, "oauth");
        const origExchange = NotionOAuth.exchangeToken;
        NotionOAuth.exchangeToken = async () => {
            const err = new Error("Notion OAuth 授权失败: invalid_grant (refresh_token 已使用或已过期)");
            err.code = "invalid_grant";
            throw err;
        };
        try {
            await expect(NotionAPI.request("POST", "/pages", {}, "", 3)).rejects.toMatchObject({
                isAuthTerminal: true,
                message: expect.stringContaining("续签失败"),
            });
        } finally {
            NotionOAuth.exchangeToken = origExchange;
        }
    });

    it("非认证错误(400 validation) → 不带 isAuthTerminal(保持逐项失败语义)", async () => {
        global.__ldNotionResponder = (opts) => opts.onload({
            status: 400,
            responseText: JSON.stringify({ object: "error", status: 400, code: "validation_error", message: "body failed validation" }),
            responseHeaders: "",
        });
        try {
            await NotionAPI.request("POST", "/pages", {}, "secret_ok", 3);
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error.isAuthTerminal).toBeUndefined();
            expect(error.message).toContain("validation");
        }
    });

    it("429 速率限制仍重试(不受 fail-fast 影响)", async () => {
        let calls = 0;
        global.__ldNotionResponder = (opts) => {
            calls++;
            if (calls <= 2) {
                opts.onload({ status: 429, responseText: "{}", responseHeaders: "retry-after: 0" });
            } else {
                opts.onload({ status: 200, responseText: JSON.stringify({ ok: true }), responseHeaders: "" });
            }
        };
        const result = await NotionAPI.request("POST", "/pages", {}, "secret_ok", 3);
        expect(result.ok).toBe(true);
        expect(calls).toBe(3);
    });
});

describe("R-AUTH-02: Exporter.exportBookmarks 认证中止", () => {
    it("第 1 项 401 终态 → 批次中止:failed=1, skipped=其余, authAborted 存在, 不再发请求", async () => {
        const bookmarks = Array.from({ length: 5 }, (_, idx) => ({ topic_id: 100 + idx, title: `Post ${idx}` }));
        // LinuxDo fetchAllPosts 走 GM_xmlhttpRequest(同样 401 语义, 但 fetch 的是 linux.do——
        // 这里直接让 Notion createDatabasePage 401: 拦 LinuxDoAPI 返回正常数据
        const { LinuxDoAPI } = require("../src/export");
        const origFetch = LinuxDoAPI.fetchAllPosts;
        LinuxDoAPI.fetchAllPosts = async (topicId) => ({ topic: { topic_id: topicId, title: `T${topicId}`, url: `https://linux.do/t/${topicId}` }, posts: [] });
        const origBuild = Exporter.buildContentBlocks;
        Exporter.buildContentBlocks = () => [];
        const origProps = Exporter.buildProperties;
        Exporter.buildProperties = () => ({});

        let notionCalls = 0;
        global.__ldNotionResponder = (opts) => {
            if (String(opts.url || "").includes("api.notion.com")) {
                notionCalls++;
                opts.onload({ status: 401, responseText: JSON.stringify({ message: "API token is invalid." }), responseHeaders: "" });
            } else {
                opts.onload({ status: 200, responseText: "{}", responseHeaders: "" });
            }
        };

        try {
            const results = await Exporter.exportBookmarks(bookmarks, { concurrency: 1, apiKey: "secret_dead", databaseId: "db1", exportTargetType: "database" });
            // 464 项全失败的反模式断言: 修复后 notion 请求次数应为少量(1 项失败即中止),
            // 而非 bookmarks.length 次
            expect(notionCalls).toBe(1);
            expect(results.failed.length).toBe(1);
            expect(results.skipped.length).toBe(4);
            expect(results.authAborted).toBeTruthy();
            expect(results.authAborted.reason).toContain("API token is invalid");
            // 中止后导出锁释放
            const { SyncLock } = require("../src/sync-lock");
            expect(SyncLock.isExporting).toBe(false);
        } finally {
            LinuxDoAPI.fetchAllPosts = origFetch;
            Exporter.buildContentBlocks = origBuild;
            Exporter.buildProperties = origProps;
        }
    });

    it("isAuthTerminalError: 仅识别带 isAuthTerminal 标记的错误(v3.14.7 回归修复)", () => {
        // 瞬态续签失败(网络/超时/429)不带标记, 消息前缀与终态相同——不得误判中止整批
        expect(Exporter.isAuthTerminalError(new Error("Notion OAuth 续签失败: OAuth 网络请求失败"))).toBe(false);
        expect(Exporter.isAuthTerminalError(new Error("Notion OAuth 续签失败: invalid_grant"))).toBe(false);
        // 终态错误必带标记(api 层 isTerminalRefreshError 判定后设置)
        const marked = new Error("Notion API 错误: API token is invalid.");
        marked.isAuthTerminal = true;
        expect(Exporter.isAuthTerminalError(marked)).toBe(true);
        expect(Exporter.isAuthTerminalError(new Error("body failed validation"))).toBe(false);
        expect(Exporter.isAuthTerminalError(null)).toBe(false);
    });

    it("瞬态续签失败(无 isAuthTerminal 标记) → 批次不中止, 仅该项失败(v3.14.7 回归修复)", async () => {
        const bookmarks = Array.from({ length: 3 }, (_, idx) => ({ topic_id: 200 + idx, title: `Post ${idx}` }));
        const { LinuxDoAPI } = require("../src/export");
        const origFetch = LinuxDoAPI.fetchAllPosts;
        LinuxDoAPI.fetchAllPosts = async (topicId) => ({ topic: { topic_id: topicId, title: `T${topicId}`, url: `https://linux.do/t/${topicId}` }, posts: [] });
        const origBuild = Exporter.buildContentBlocks;
        Exporter.buildContentBlocks = () => [];
        const origProps = Exporter.buildProperties;
        Exporter.buildProperties = () => ({});

        let notionCalls = 0;
        global.__ldNotionResponder = (opts) => {
            if (String(opts.url || "").includes("api.notion.com")) {
                notionCalls++;
                // 全部请求 401: 第 1 项触发续签(瞬态失败→冷却), 后续项仍逐项尝试, 批次不得中止
                opts.onload({ status: 401, responseText: JSON.stringify({ message: "API token is invalid." }), responseHeaders: "" });
            } else {
                opts.onload({ status: 200, responseText: "{}", responseHeaders: "" });
            }
        };
        const { NotionOAuth } = require("../src/auth");
        const origCanRefresh = NotionOAuth.canAutoRefresh;
        NotionOAuth.canAutoRefresh = () => false; // 非 OAuth 场景: 401 直达终态标记?
        // 修正: 模拟 OAuth 已连接但续签端点瞬态失败(网络错误)→ 401 触发续签 → 续签抛瞬态错误
        NotionOAuth.canAutoRefresh = () => true;
        const origIsOAuthConnected = NotionOAuth.isOAuthConnected;
        NotionOAuth.isOAuthConnected = () => true;
        const origGetAuthMode = NotionOAuth.getAuthMode;
        NotionOAuth.getAuthMode = () => "oauth";

        try {
            const results = await Exporter.exportBookmarks(bookmarks, { concurrency: 1, apiKey: "", databaseId: "db1", exportTargetType: "database" });
            // 3 项全部失败(401+续签失败), 但批次不中止: 无 authAborted, skipped=0
            expect(results.authAborted).toBeUndefined();
            expect(results.failed.length).toBe(3);
            expect(results.skipped.length).toBe(0);
            expect(notionCalls).toBeGreaterThanOrEqual(3); // 3 项均发出了请求(未在首项中止)
        } finally {
            LinuxDoAPI.fetchAllPosts = origFetch;
            Exporter.buildContentBlocks = origBuild;
            Exporter.buildProperties = origProps;
            NotionOAuth.canAutoRefresh = origCanRefresh;
            NotionOAuth.isOAuthConnected = origIsOAuthConnected;
            NotionOAuth.getAuthMode = origGetAuthMode;
        }
    });
});
