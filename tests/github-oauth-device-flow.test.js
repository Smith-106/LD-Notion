"use strict";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 20260914: GitHub OAuth Device Flow 单测。
// 约定: 跨模块 stub 用 require()(ESM import 命名空间不落 CJS 模块内);
// GM_xmlhttpRequest mock 按 URL 路由, access_token 端点按队列顺序返回(模拟 pending→成功)。

const store = new Map();
globalThis.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
globalThis.GM_setValue = (k, v) => { store.set(k, v); };
globalThis.GM_deleteValue = (k) => { store.delete(k); };

const { GitHubOAuth } = require("../src/auth/github-oauth");
const { CONFIG } = require("../src/config");

// urlencoded body 解析
const parseForm = (data = "") => Object.fromEntries(new URLSearchParams(data));

let routeHandlers;

globalThis.GM_xmlhttpRequest = (options) => {
    const handler = routeHandlers && routeHandlers[options.url];
    if (!handler) {
        options.onerror && options.onerror({ error: "no-route" });
        return;
    }
    Promise.resolve().then(() => {
        try {
            const response = handler({ data: parseForm(options.data) });
            options.onload && options.onload(response);
        } catch (error) {
            options.onerror && options.onerror({ error: String(error) });
        }
    });
};

const deviceCodeResponse = () => ({
    status: 200,
    responseText: JSON.stringify({
        device_code: "DEVCODE123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
    }),
});

const tokenResponse = (body, status = 200) => ({
    status,
    responseText: JSON.stringify(body),
});

beforeEach(() => {
    store.clear();
    routeHandlers = {};
    GitHubOAuth._pollCancelled = false;
});

describe("GitHubOAuth device flow", () => {
    it("缺 client_id 快速失败并给行动指引", async () => {
        await expect(GitHubOAuth.startDeviceFlow({})).rejects.toMatchObject({
            code: "missing_client_id",
        });
    });

    it("happy path: pending→成功, token 落库 GITHUB_TOKEN, 回调含用户代码", async () => {
        GitHubOAuth.setClientId("Iv1.testclient");
        const tokenBodies = [
            tokenResponse({ error: "authorization_pending" }),
            tokenResponse({ access_token: "gho_testtoken", token_type: "bearer", scope: "repo,gist" }),
        ];
        routeHandlers = {
            [GitHubOAuth.DEVICE_CODE_URL]: () => deviceCodeResponse(),
            [GitHubOAuth.TOKEN_URL]: () => tokenBodies.shift() || tokenResponse({ error: "authorization_pending" }),
        };
        const seen = { userCode: "", phases: [] };
        const result = await GitHubOAuth.startDeviceFlow({
            intervalMs: 1,
            maxPollMs: 5000,
            onUserCode: ({ userCode, verificationUri }) => {
                seen.userCode = userCode;
                seen.verificationUri = verificationUri;
            },
            onStatus: ({ phase }) => seen.phases.push(phase),
        });
        expect(result.accessToken).toBe("gho_testtoken");
        expect(seen.userCode).toBe("ABCD-1234");
        expect(seen.verificationUri).toBe("https://github.com/login/device");
        expect(seen.phases).toContain("pending");
        // applyTokenResponse 与手动 PAT 同键(GITHUB_TOKEN): GitHubAPI 零改动
        await expect(GitHubOAuth.applyTokenResponse(result)).resolves.toBe("gho_testtoken");
        expect(store.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN)).toBe("gho_testtoken");
    });

    it("slow_down 降速后继续轮询直至成功", async () => {
        GitHubOAuth.setClientId("Iv1.testclient");
        const tokenBodies = [
            tokenResponse({ error: "slow_down" }),
            tokenResponse({ access_token: "gho_slowok", token_type: "bearer", scope: "repo" }),
        ];
        routeHandlers = {
            [GitHubOAuth.DEVICE_CODE_URL]: () => deviceCodeResponse(),
            [GitHubOAuth.TOKEN_URL]: () => tokenBodies.shift() || tokenResponse({ error: "authorization_pending" }),
        };
        const phases = [];
        const result = await GitHubOAuth.startDeviceFlow({
            intervalMs: 1,
            slowDownExtraMs: 1,
            maxPollMs: 5000,
            onStatus: ({ phase }) => phases.push(phase),
        });
        expect(result.accessToken).toBe("gho_slowok");
        expect(phases).toContain("slow_down");
        expect(phases.indexOf("slow_down")).toBeLessThan(phases.indexOf("success"));
    });

    it("expired_token → 拒绝并携带可行动文案", async () => {
        GitHubOAuth.setClientId("Iv1.testclient");
        routeHandlers = {
            [GitHubOAuth.DEVICE_CODE_URL]: () => deviceCodeResponse(),
            [GitHubOAuth.TOKEN_URL]: () => tokenResponse({ error: "expired_token", error_description: "code expired" }),
        };
        await expect(
            GitHubOAuth.startDeviceFlow({ intervalMs: 1, maxPollMs: 5000 })
        ).rejects.toThrow(/重新发起授权/);
    });

    it("device/code 失败(incorrect_client_credentials) 映射为 Client ID 指引", async () => {
        GitHubOAuth.setClientId("Iv1.badclient");
        routeHandlers = {
            [GitHubOAuth.DEVICE_CODE_URL]: () =>
                tokenResponse({ error: "incorrect_client_credentials" }, 404),
        };
        await expect(
            GitHubOAuth.startDeviceFlow({ intervalMs: 1, maxPollMs: 5000 })
        ).rejects.toThrow(/Client ID 无效/);
    });

    it("cancelPolling → 轮询取消(cancelled)", async () => {
        GitHubOAuth.setClientId("Iv1.testclient");
        routeHandlers = {
            [GitHubOAuth.DEVICE_CODE_URL]: () => deviceCodeResponse(),
            [GitHubOAuth.TOKEN_URL]: () => tokenResponse({ error: "authorization_pending" }),
        };
        const pending = GitHubOAuth.startDeviceFlow({ intervalMs: 5, maxPollMs: 60000 });
        setTimeout(() => GitHubOAuth.cancelPolling(), 8);
        await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    });
});

// 20260914: odyssey-review 修复回归 — 轮询死线绑定设备码 expires_in。
// 场景: expires_in=1s 远小于 maxPollMs=60s → 死线取小, ~1s 内即报 expired_token,
// 而非空轮询至 maxPollMs 才由服务端裁决。
describe("GitHubOAuth device flow — expires_in 死线绑定(回归)", () => {
    it("expires_in < maxPollMs 时按设备码有效期终止", async () => {
        routeHandlers = {
            [GitHubOAuth.DEVICE_CODE_URL]: () => tokenResponse({
                device_code: "DEVCODE-EXP", user_code: "EXP-1234",
                verification_uri: "https://github.com/login/device", expires_in: 1, interval: 1,
            }),
            [GitHubOAuth.TOKEN_URL]: () => tokenResponse({ error: "authorization_pending" }),
        };
        const startedAt = Date.now();
        await expect(
            GitHubOAuth.startDeviceFlow({ clientId: "cid", intervalMs: 20, maxPollMs: 60000 })
        ).rejects.toMatchObject({ code: "expired_token" });
        expect(Date.now() - startedAt).toBeLessThan(5000);
    });

// 20260924 v3.16.5: 设备码状态行渲染 —— user_code 不可信输入 textContent 防注入;
// href 白名单限定 github.com/login/device 前缀, 劫持降级纯文本。
describe('GitHubOAuth renderUserCodeStatus', () => {
    const makeEl = () => {
        const el = {
            textContent: '',
            children: [],
            style: {},
            appendChild(child) { this.children.push(child); return child; },
        };
        return el;
    };
    const fakeDoc = () => {
        const saved = globalThis.document;
        const created = [];
        globalThis.document = {
            createElement: (tag) => {
                const el = { tag, href: '', target: '', rel: '', textContent: '', style: {} };
                created.push(el);
                return el;
            },
            createTextNode: (t) => ({ text: t }),
        };
        return { saved, created };
    };
    it('正常渲染: 代码文本 + 官方直达链接', async () => {
        const { saved, created } = fakeDoc();
        try {
            const el = makeEl();
            const ret = GitHubOAuth.renderUserCodeStatus(el, 'ABCD-1234', 'https://github.com/login/device');
            expect(el.textContent).toContain('ABCD-1234');
            expect(ret).toBe('link');
            expect(created.length).toBe(1);
            expect(created[0].href).toBe('https://github.com/login/device');
            expect(created[0].target).toBe('_blank');
        } finally { globalThis.document = saved; }
    });

    it('恶意 user_code 不执行 HTML(纯文本赋值)', async () => {
        const { saved } = fakeDoc();
        try {
            const el = makeEl();
            GitHubOAuth.renderUserCodeStatus(el, '<img src=x onerror=alert(1)>', 'https://github.com/login/device');
            expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
            expect(el.children.length).toBe(2); // 仅空格文本 + 链接, 无注入节点
        } finally { globalThis.document = saved; }
    });

    it('verification_uri 非官方域时降级纯文本(防劫持)', async () => {
        const { saved, created } = fakeDoc();
        try {
            const el = makeEl();
            const ret = GitHubOAuth.renderUserCodeStatus(el, 'ABCD-1234', 'https://evil.example.com/login/device');
            expect(ret).toBe('text-only');
            expect(created.length).toBe(0);
            expect(el.textContent).toContain('ABCD-1234');
        } finally { globalThis.document = saved; }
    });

    it('无状态行元素时返回 no-el 不抛错', async () => {
        expect(GitHubOAuth.renderUserCodeStatus(null, 'ABCD-1234', 'https://github.com/login/device')).toBe('no-el');
    });
});
});
