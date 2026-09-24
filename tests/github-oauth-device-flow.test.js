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
                const el = { tag, href: '', target: '', rel: '', textContent: '', style: {},
                    setAttribute() {}, select() {}, appendChild() {}, remove() {} };
                created.push(el);
                return el;
            },
            createTextNode: (t) => ({ text: t }),
        };
        return { saved, created };
    };
    const makeRealEl = () => {
        // 接近真实 DOM 的 stub: firstChild/removeChild/children 联动, textContent 可读写
        const kids = [];
        return {
            textContent: '',
            get firstChild() { return kids.length ? kids[0] : null; },
            removeChild(n) { const i = kids.indexOf(n); if (i >= 0) kids.splice(i, 1); return n; },
            appendChild(n) { kids.push(n); return n; },
            get childNodes() { return kids.slice(); },
        };
    };
    it('正常渲染: 代码文本 + 官方直达链接', async () => {
        const { saved, created } = fakeDoc();
        try {
            const el = makeRealEl();
            const ret = GitHubOAuth.renderUserCodeStatus(el, 'ABCD-1234', 'https://github.com/login/device');
            expect(ret).toBe('link');
            expect(JSON.stringify(el.childNodes)).toContain('ABCD-1234');
            const link = created.find((n) => n.tag === 'a');
            expect(link.href).toBe('https://github.com/login/device');
            expect(link.target).toBe('_blank');
        } finally { globalThis.document = saved; }
    });

    it('恶意 user_code 不执行 HTML(纯文本赋值)', async () => {
        const { saved, created } = fakeDoc();
        try {
            const el = makeRealEl();
            GitHubOAuth.renderUserCodeStatus(el, '<img src=x onerror=alert(1)>', 'https://github.com/login/device');
            const dump = JSON.stringify(el.childNodes);
            expect(dump).toContain('<img src=x onerror=alert(1)>');
            // 无注入节点: 只有文本节点 + strong 高亮 + 链接, 无额外元素
            expect(created.every((n) => n.tag === 'strong' || n.tag === 'a')).toBe(true);
        } finally { globalThis.document = saved; }
    });

    it('verification_uri 非官方域时降级纯文本(防劫持)', async () => {
        const { saved, created } = fakeDoc();
        try {
            const el = makeRealEl();
            const ret = GitHubOAuth.renderUserCodeStatus(el, 'ABCD-1234', 'https://evil.example.com/login/device');
            expect(ret).toBe('text-only');
            expect(created.some((n) => n.tag === 'a')).toBe(false);
            expect(JSON.stringify(el.childNodes)).toContain('ABCD-1234');
        } finally { globalThis.document = saved; }
    });

    it('无状态行元素时返回 no-el 不抛错', async () => {
        expect(GitHubOAuth.renderUserCodeStatus(null, 'ABCD-1234', 'https://github.com/login/device')).toBe('no-el');
    });

    // v3.16.6: pending/slow_down 阶段状态行仍保留设备码(根因回归: 轮询回调不再裸覆盖丢码)
    it('pending 阶段保留设备码 + phase 提示', async () => {
        const { saved, created } = fakeDoc();
        try {
            const el = makeRealEl();
            const ret = GitHubOAuth.renderUserCodeStatus(el, 'WXYZ-9999', 'https://github.com/login/device', 'pending');
            expect(ret).toBe('link');
            const dump = JSON.stringify(el.childNodes);
            expect(dump).toContain('WXYZ-9999');
            expect(dump).toContain('等待你在 GitHub 页面确认授权');
            expect(created.some((n) => n.tag === 'strong')).toBe(true);
        } finally { globalThis.document = saved; }
    });

    it('slow_down 阶段保留设备码 + 降速提示', async () => {
        const { saved } = fakeDoc();
        try {
            const el = makeRealEl();
            GitHubOAuth.renderUserCodeStatus(el, 'WXYZ-9999', 'https://github.com/login/device', 'slow_down');
            const dump = JSON.stringify(el.childNodes);
            expect(dump).toContain('WXYZ-9999');
            expect(dump).toContain('已自动降速');
        } finally { globalThis.document = saved; }
    });

    it('重复渲染不堆积旧节点(清空后重建)', async () => {
        const { saved } = fakeDoc();
        try {
            const el = makeRealEl();
            GitHubOAuth.renderUserCodeStatus(el, 'AAAA-1111', 'https://github.com/login/device');
            const first = el.childNodes.length;
            GitHubOAuth.renderUserCodeStatus(el, 'AAAA-1111', 'https://github.com/login/device', 'pending');
            expect(el.childNodes.length).toBeLessThanOrEqual(first + 1);
            expect(JSON.stringify(el.childNodes)).toContain('AAAA-1111');
        } finally { globalThis.document = saved; }
    });

    // v3.16.6: copyUserCode 静默降级
    it('copyUserCode 无剪贴板环境返回 false 不抛错', async () => {
        const savedDoc = globalThis.document;
        const savedNav = globalThis.navigator;
        const savedGM = globalThis.GM_setClipboard;
        try {
            delete globalThis.document;
            delete globalThis.navigator;
            delete globalThis.GM_setClipboard;
            expect(GitHubOAuth.copyUserCode('ABCD-1234')).toBe(false);
            expect(GitHubOAuth.copyUserCode('')).toBe(false);
        } finally {
            globalThis.document = savedDoc;
            globalThis.navigator = savedNav;
            if (savedGM !== undefined) globalThis.GM_setClipboard = savedGM;
        }
    });

    // 审查 P1-2 回归: execCommand 分支 body 缺失不抛错返回 false; 抛错时 textarea 必清理
    it('copyUserCode body缺失时返回false不抛错', async () => {
        const savedDoc = globalThis.document;
        const savedNav = globalThis.navigator;
        const savedGM = globalThis.GM_setClipboard;
        try {
            delete globalThis.GM_setClipboard;
            delete globalThis.navigator;
            globalThis.document = { execCommand: () => true, createElement: () => ({ value: '', style: {}, setAttribute() {}, select() {}, remove() {} }) };
            expect(GitHubOAuth.copyUserCode('ABCD-1234')).toBe(false);
        } finally {
            globalThis.document = savedDoc;
            globalThis.navigator = savedNav;
            if (savedGM !== undefined) globalThis.GM_setClipboard = savedGM;
        }
    });

    it('copyUserCode execCommand抛错时清理textarea并返回false', async () => {
        const savedDoc = globalThis.document;
        const savedNav = globalThis.navigator;
        const savedGM = globalThis.GM_setClipboard;
        try {
            delete globalThis.GM_setClipboard;
            delete globalThis.navigator;
            let removed = 0;
            globalThis.document = {
                execCommand: () => { throw new Error('denied'); },
                createElement: () => ({ value: '', style: {}, setAttribute() {}, select() {}, remove() { removed += 1; } }),
                body: { appendChild() {} },
            };
            expect(GitHubOAuth.copyUserCode('ABCD-1234')).toBe(false);
            expect(removed).toBe(1);
        } finally {
            globalThis.document = savedDoc;
            globalThis.navigator = savedNav;
            if (savedGM !== undefined) globalThis.GM_setClipboard = savedGM;
        }
    });

    // 收敛复审 B1 回归: 同码重复渲染只写一次剪贴板(不覆盖用户后续复制内容)
    it('同码重复渲染仅首次写剪贴板', async () => {
        const { saved } = fakeDoc();
        try {
            GitHubOAuth._lastCopiedCode = undefined;
            let writes = 0;
            const origCopy = GitHubOAuth.copyUserCode;
            const spy = (...a) => { writes += 1; return origCopy(...a); };
            GitHubOAuth.copyUserCode = spy;
            try {
                const el = makeRealEl();
                GitHubOAuth.renderUserCodeStatus(el, 'ONCE-1111', 'https://github.com/login/device');
                GitHubOAuth.renderUserCodeStatus(el, 'ONCE-1111', 'https://github.com/login/device', 'pending');
                GitHubOAuth.renderUserCodeStatus(el, 'ONCE-1111', 'https://github.com/login/device', 'slow_down');
                expect(writes).toBe(1);
                // 新码再次写入一次
                GitHubOAuth.renderUserCodeStatus(el, 'NEW2-2222', 'https://github.com/login/device');
                expect(writes).toBe(2);
            } finally { GitHubOAuth.copyUserCode = origCopy; }
        } finally { globalThis.document = saved; }
    });

    it('copyUserCode 经 GM_setClipboard 复制返回 true', async () => {
        const savedGM = globalThis.GM_setClipboard;
        try {
            let seen = '';
            globalThis.GM_setClipboard = (t) => { seen = String(t); };
            expect(GitHubOAuth.copyUserCode('ABCD-1234')).toBe(true);
            expect(seen).toBe('ABCD-1234');
        } finally {
            if (savedGM === undefined) delete globalThis.GM_setClipboard;
            else globalThis.GM_setClipboard = savedGM;
        }
    });
});
});
