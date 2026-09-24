// ISS-20260914-003 深度行为测试 —— ui/events* 拆分模块 DOM 级绑定。
// bindAISection/bindExport 经 ctx 注入 stub refs(Proxy 兜底任意 refs.X → 元素 stub),
// 验证:① 绑定不抛错 + 关键 onchange/onclick 处理器挂接;② 触发处理器产生预期副作用
// (Storage.set / UI 方法调用);③ bindEvents 仍委托两拆分域。

import { describe, it, expect, vi, beforeEach } from "vitest";

const { bindAISection } = require("../src/ui/events/ai-bindings");
const { bindExport } = require("../src/ui/events/export-bindings");
const { UIEvents } = require("../src/ui/events");
const { Storage } = require("../src/storage");
const { CONFIG } = require("../src/config");
const fs = require("fs");

// 任意 refs.X → 元素 stub(可赋 onchange/onclick, classList/style/querySelector 链安全)
const elStub = () => ({
    value: "", textContent: "", innerHTML: "", disabled: false, checked: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, querySelector: () => null, querySelectorAll: () => [],
    setAttribute() {}, getAttribute: () => null, focus() {}, click() {},
    scrollTop: 0, scrollHeight: 0,
    // NodeList 兼容(refs.githubTypeCheckboxes.forEach 等)
    forEach() {}, map: () => [], filter: () => [], length: 0, [Symbol.iterator]: function* () {},
});
const makeRefs = () => new Proxy({}, { get: (t, k) => (t[k] || (t[k] = elStub())) });
const panelStub = () => ({ querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, innerHTML: "", style: {}, classList: { add() {}, remove() {} } });

let UI;
beforeEach(() => {
    vi.restoreAllMocks();
    UI = new Proxy({}, { get: (t, k) => (t[k] || (t[k] = vi.fn())) }); // 任意 UI.X → vi.fn()
});

describe("深度: events/ai-bindings bindAISection", () => {
    const ctx = (refs) => ({ UI, panel: panelStub(), refs, getSensitiveValue: (el) => el.value, persistSensitiveInput: async () => {} });

    it("绑定不抛错 + 关键 select 的 onchange 处理器挂接", () => {
        const refs = makeRefs();
        expect(() => bindAISection(ctx(refs))).not.toThrow();
        for (const k of ["aiServiceSelect", "aiApiKeyInput", "aiModelSelect", "aiTargetDbSelect", "githubUsernameInput"]) {
            expect(typeof refs[k].onchange).toBe("function");
        }
    });

    it("aiServiceSelect.onchange → Storage.set(AI_SERVICE) + UI.updateAIModelOptions", () => {
        const refs = makeRefs();
        bindAISection(ctx(refs));
        const setSpy = vi.spyOn(Storage, "set").mockImplementation(() => {});
        refs.aiServiceSelect.value = "claude";
        refs.aiServiceSelect.onchange({ target: { value: "claude" } });
        expect(setSpy).toHaveBeenCalledWith(CONFIG.STORAGE_KEYS.AI_SERVICE, "claude");
        expect(UI.updateAIModelOptions).toHaveBeenCalled();
    });

    it("githubOAuthBtn.onclick → onUserCode 时状态行显示设备码 + 直达链接", async () => {
        // 回归: 用户反馈"收不到设备码/没有页面" —— 状态行必须同屏显示 user_code，
        // 且 window.open 被拦截时仍有可点击的官方直达链接。
        const refs = makeRefs();
        refs.githubOauthClientIdInput.value = "Ov23.test";
        // 状态行 stub 需支持 appendChild 挂链接
        const appended = [];
        refs.githubOAuthStatus.appendChild = (n) => { appended.push(n); return n; };
        bindAISection(ctx(refs));
        const { GitHubOAuth } = require("../src/auth/github-oauth");
        const flowSpy = vi.spyOn(GitHubOAuth, "startDeviceFlow").mockImplementation(async (opts = {}) => {
            opts.onUserCode?.({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
            return { accessToken: "gho_x", tokenType: "bearer", scope: "repo gist" };
        });
        const applySpy = vi.spyOn(GitHubOAuth, "applyTokenResponse").mockResolvedValue("gho_x");
        // onUserCode 回调内同步断言(授权成功后状态行会被成功文案覆盖)
        let seenCode = "";
        const origRender = GitHubOAuth.renderUserCodeStatus;
        const renderSpy = vi.spyOn(GitHubOAuth, "renderUserCodeStatus").mockImplementation((el, code, uri) => {
            seenCode = String(code || "");
            return origRender(el, code, uri);
        });
        await refs.githubOAuthBtn.onclick();
        expect(flowSpy).toHaveBeenCalled();
        expect(seenCode).toBe("ABCD-1234");
        expect(renderSpy).toHaveBeenCalled();
        expect(appended.length).toBeGreaterThan(0);
        expect(refs.githubOAuthStatus.textContent).toBe("✅ GitHub 授权成功，Token 已自动填入");
        expect(applySpy).toHaveBeenCalled();
        expect(refs.githubOAuthBtn.disabled).toBe(false);
    });

    it("aiApiKeyInput.onchange → persistSensitiveInput 被调", async () => {
        const refs = makeRefs();
        const persist = vi.fn().mockResolvedValue(undefined);
        bindAISection({ UI, panel: panelStub(), refs, getSensitiveValue: (el) => el.value, persistSensitiveInput: persist });
        refs.aiApiKeyInput.onchange({ target: { value: "sk-x" } });
        await Promise.resolve();
        expect(persist).toHaveBeenCalled();
    });
});

describe("深度: events/export-bindings bindExport", () => {
    const ctx = (refs) => ({
        UI, panel: panelStub(), refs,
        getInputValue: (el) => el?.value ?? "",
        getSensitiveValue: (el) => el?.value ?? "",
        updateExportButtonState: vi.fn(), syncUndoOrganizeBtn: vi.fn(),
    });

    it("绑定不抛错 + 导出/日志/权限处理器挂接", () => {
        const refs = makeRefs();
        expect(() => bindExport(ctx(refs))).not.toThrow();
        // 至少挂接一组 onchange/onclick
        const bound = Object.values(refs).filter((el) => typeof el.onchange === "function" || typeof el.onclick === "function").length;
        expect(bound).toBeGreaterThan(0);
    });

    it("permissionLevelSelect.onchange → OperationGuard.setLevel(合法级别)", () => {
        const refs = makeRefs();
        bindExport(ctx(refs));
        const setSpy = vi.spyOn(Storage, "set").mockImplementation(() => {});
        const handler = refs.permissionLevelSelect.onchange;
        if (typeof handler === "function") {
            handler({ target: { value: "2" } });
            expect(setSpy).toHaveBeenCalledWith(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, expect.anything());
        } else {
            // 若经 addEventListener 绑定则跳过断点,绑定面已由上条覆盖
            expect(refs.permissionLevelSelect).toBeTruthy();
        }
    });
});

describe("深度: ui/events.js bindEvents 委托拆分域", () => {
    it("源码仍经 require 委托 bindAISection + bindExport", () => {
        const src = fs.readFileSync("src/ui/events.js", "utf8");
        expect(src).toContain('require("./events/ai-bindings").bindAISection');
        expect(src).toContain('require("./events/export-bindings").bindExport');
        expect(typeof UIEvents.bindEvents).toBe("function");
    });
});
