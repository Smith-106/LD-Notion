"use strict";

/**
 * OAuth resolveRequestToken: AutoImporter / 批量路径把 settings.apiKey 快照传入
 * NotionAPI.request 时，不得遮蔽 Storage 中刚续签的新 token。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;
global.GM_xmlhttpRequest = () => {};

const { CONFIG } = require("../src/config");
const { NotionOAuth } = require("../src/auth");
const { NotionAPI } = require("../src/api");

beforeEach(() => {
    store.clear();
    NotionAPI._refreshCooldownUntil = null;
});

describe("NotionOAuth.resolveRequestToken", () => {
    it("OAuth 可续签时忽略陈旧快照，读 Storage 最新 token", () => {
        store.set(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, "oauth");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "refresh-live");
        store.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "access-new");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, "11111111-1111-1111-1111-111111111111");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, "secret");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI, "https://www.notion.so/");

        expect(NotionOAuth.canAutoRefresh()).toBe(true);
        expect(NotionOAuth.resolveRequestToken("access-stale-snapshot")).toBe("access-new");
        expect(NotionOAuth.getAccessToken("access-stale-snapshot")).toBe("access-stale-snapshot");
    });

    it("手动 Token 模式仍尊重传入的 apiKey（含 UI live 覆盖）", () => {
        store.set(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, "manual");
        store.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "stored-manual");
        expect(NotionOAuth.canAutoRefresh()).toBe(false);
        expect(NotionOAuth.resolveRequestToken("live-override")).toBe("live-override");
        expect(NotionOAuth.resolveRequestToken("")).toBe("stored-manual");
    });
});

describe("NotionAPI.request uses resolveRequestToken", () => {
    it("OAuth 模式下即使传入陈旧 apiKey，Authorization 使用 Storage 新 token", async () => {
        store.set(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, "oauth");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "refresh-live");
        store.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "access-new");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, "11111111-1111-1111-1111-111111111111");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, "secret");
        store.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI, "https://www.notion.so/");

        let seenToken = null;
        const transport = {
            request: async ({ token }) => {
                seenToken = token;
                return {
                    status: 200,
                    responseText: JSON.stringify({ id: "page-1" }),
                    responseHeaders: "",
                };
            },
        };
        const orig = NotionAPI.getTransport;
        NotionAPI.getTransport = () => transport;
        try {
            await NotionAPI.request("GET", "/users/me", null, "access-stale-snapshot");
            expect(seenToken).toBe("access-new");
        } finally {
            NotionAPI.getTransport = orig;
        }
    });
});
