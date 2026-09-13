import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3-r2 (AT-010, L2): NotionAPI 传输层网络边界。
// 断言面: 429 退避重试 / 重试耗尽 retryCount / 认证终态短路 / 500 不重试 /
//         畸形 JSON 解析错误 / buildUrl 路径穿越拒绝。
// 夹具契约: configureTransport 注入假 transport; afterEach 还原。
const { NotionAPI, NotionTransport } = require("../src/api");
const { NotionOAuth } = require("../src/auth");
const { Utils } = require("../src/utils");

describe("AT-010: NotionAPI 传输层网络边界(重试/短路/解析)", () => {
    const saved = {};
    let calls;
    let responses;
    let sleeps;

    const ok = (body) => ({ status: 200, responseText: JSON.stringify(body), responseHeaders: "" });
    const withStatus = (n, body = {}) => ({
        status: n,
        responseText: JSON.stringify(body),
        responseHeaders: n === 429 ? "retry-after: 0" : "",
    });

    beforeEach(() => {
        calls = 0;
        responses = [];
        sleeps = [];
        saved.token = NotionOAuth.resolveRequestToken;
        saved.canAutoRefresh = NotionOAuth.canAutoRefresh;
        saved.sleep = Utils.sleep;
        saved.adapter = NotionAPI._transportAdapter;
        NotionAPI.configureTransport({
            request: async () => {
                calls += 1;
                return responses.shift() || withStatus(500);
            },
        });
        NotionOAuth.resolveRequestToken = () => "tok";
        NotionOAuth.canAutoRefresh = () => false;
        Utils.sleep = async (ms) => { sleeps.push(ms); };
    });

    afterEach(() => {
        NotionOAuth.resolveRequestToken = saved.token;
        NotionOAuth.canAutoRefresh = saved.canAutoRefresh;
        Utils.sleep = saved.sleep;
        NotionAPI._transportAdapter = saved.adapter;
    });

    it("空 token: 不发请求即抛 isAuthTerminal(empty_token)", async () => {
        NotionOAuth.resolveRequestToken = () => null;
        await expect(NotionAPI.request("POST", "/pages", {}, "k")).rejects.toMatchObject({ isAuthTerminal: true });
        expect(calls).toBe(0);
    });

    it("429 退避重试: 两次限流后成功, 共 3 次请求 2 次 sleep", async () => {
        responses.push(withStatus(429), withStatus(429), ok({ id: "p-ok" }));
        const page = await NotionAPI.request("POST", "/pages", {}, "k");
        expect(page.id).toBe("p-ok");
        expect(calls).toBe(3);
        expect(sleeps.length).toBe(2);
        expect(sleeps[0]).toBeGreaterThan(0);
    });

    it("429 重试耗尽: 抛出并携带 retryCount=4(默认 retries=3 → 4 次请求)", async () => {
        for (let i = 0; i < 6; i++) responses.push(withStatus(429));
        await expect(NotionAPI.request("POST", "/pages", {}, "k")).rejects.toMatchObject({ retryCount: 4 });
        expect(calls).toBe(4);
    });

    it("401 code=unauthorized: 认证终态短路, 不重试", async () => {
        responses.push(withStatus(401, { code: "unauthorized", message: "API token is invalid" }));
        await expect(NotionAPI.request("POST", "/pages", {}, "k")).rejects.toMatchObject({
            isAuthTerminal: true,
            authCode: "unauthorized",
        });
        expect(calls).toBe(1);
    });

    it("500 瞬态: 直接抛出不重试(仅 429 走重试)", async () => {
        responses.push(withStatus(500, { message: "Internal Server Error" }));
        await expect(NotionAPI.request("POST", "/pages", {}, "k")).rejects.toThrow();
        expect(calls).toBe(1);
    });

    it("2xx 畸形 JSON: 解析错误抛出", async () => {
        responses.push({ status: 200, responseText: "{not-json", responseHeaders: "" });
        await expect(NotionAPI.request("POST", "/pages", {}, "k")).rejects.toThrow();
    });

    it("NotionTransport.buildUrl: 路径穿越/反斜线/百分号编码绕过拒绝, 合法查询串放行", () => {
        expect(() => NotionTransport.buildUrl("../../evil")).toThrow();
        expect(() => NotionTransport.buildUrl("/pages//drafts")).toThrow();
        expect(() => NotionTransport.buildUrl("/pages/a%2fb")).toThrow();
        expect(() => NotionTransport.buildUrl("/databases/db-1/query?start_cursor=abc")).not.toThrow();
    });
});
