import { describe, it, expect, beforeEach, afterEach } from "vitest";

// P4 第一批回归: API 传输层边界/错误处理 + content handler 降级
const { AIHandlers, AIAssistant, AIService, ChatState, AIClassifier } = require("../src/ai/index.js");
const { NotionAPI } = require("../src/api");
const { OperationGuard } = require("../src/security");
const { Storage } = require("../src/storage");
const { CONFIG } = require("../src/config");
const { Utils } = require("../src/utils");

const ok = (body) => ({ status: 200, responseText: JSON.stringify(body), responseHeaders: "" });

describe("P4: NotionAPI 请求边界", () => {
    afterEach(() => NotionAPI.resetTransport());

    it("429 Retry-After 超过 60s 被钳制", async () => {
        const origSleep = Utils.sleep;
        const delays = [];
        Utils.sleep = async (ms) => { delays.push(ms); };
        let calls = 0;
        NotionAPI.configureTransport({
            request: async () => {
                calls++;
                return calls === 1
                    ? { status: 429, responseText: "{}", responseHeaders: "retry-after: 999999" }
                    : ok({ ok: true });
            },
        });
        try {
            const result = await NotionAPI.request("GET", "/pages/x", null, "secret_ok", 3);
            expect(result.ok).toBe(true);
            expect(delays[0]).toBe(60 * 1000 + 500);
        } finally {
            Utils.sleep = origSleep;
        }
    });

    it("2xx 非空但非法 JSON 抛解析错误", async () => {
        NotionAPI.configureTransport({
            request: async () => ({ status: 200, responseText: "<html>gateway</html>", responseHeaders: "" }),
        });
        await expect(NotionAPI.request("GET", "/pages/x", null, "secret_ok", 3))
            .rejects.toThrow(/响应解析失败/);
    });

    it("2xx 空响应体仍容忍返回空对象", async () => {
        NotionAPI.configureTransport({
            request: async () => ({ status: 200, responseText: "", responseHeaders: "" }),
        });
        await expect(NotionAPI.request("GET", "/pages/x", null, "secret_ok", 3)).resolves.toEqual({});
    });

    it("非 401 响应体含 unauthorized 不误判认证终态", async () => {
        NotionAPI.configureTransport({
            request: async () => ({ status: 500, responseText: JSON.stringify({ message: "upstream unauthorized" }), responseHeaders: "" }),
        });
        try {
            await NotionAPI.request("GET", "/pages/x", null, "secret_ok", 3);
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error.isAuthTerminal).toBeUndefined();
        }
    });

    it("401 含 unauthorized 仍判认证终态", async () => {
        NotionAPI.configureTransport({
            request: async () => ({ status: 401, responseText: JSON.stringify({ message: "API token is invalid." }), responseHeaders: "" }),
        });
        try {
            await NotionAPI.request("GET", "/pages/x", null, "secret_ok", 3);
            expect.unreachable("should have thrown");
        } catch (error) {
            expect(error.isAuthTerminal).toBe(true);
        }
    });

    it("appendBlockChildren 超过 100 块分片提交且 after 逐片链接(不倒序/不落到末尾)", async () => {
        const calls = [];
        let seq = 0;
        NotionAPI.configureTransport({
            request: async (opts) => {
                calls.push(opts);
                // 模拟 Notion 返回本片新建块(带 id) —— 下一片须锚定在本片末块之后
                return ok({ results: opts.data.children.map(() => ({ id: `new-${++seq}` })) });
            },
        });
        const children = Array.from({ length: 250 }, (_, i) => ({ type: "paragraph", paragraph: { rich_text: [] } }));
        await NotionAPI.appendBlockChildren("blk1", children, "secret_ok", { after: "anchor" });

        expect(calls.length).toBe(3);
        expect(calls.map((c) => c.data.children.length)).toEqual([100, 100, 50]);
        // 首片锚定调用方给的 anchor; 后续片锚定上一片最后一个新建块
        expect(calls[0].data.after).toBe("anchor");
        expect(calls[1].data.after).toBe("new-100");
        expect(calls[2].data.after).toBe("new-200");
    });

    it("appendBlockChildren 响应无 results 时后续分片退回不带 after(避免倒序插入)", async () => {
        const calls = [];
        NotionAPI.configureTransport({
            request: async (opts) => { calls.push(opts); return ok({}); },
        });
        const children = Array.from({ length: 150 }, (_, i) => ({ type: "paragraph", paragraph: { rich_text: [] } }));
        await NotionAPI.appendBlockChildren("blk1", children, "secret_ok", { after: "anchor" });

        expect(calls[0].data.after).toBe("anchor");
        expect(calls[1].data.after).toBeUndefined();
    });

    it("appendBlockChildren 空数组不发请求(children: [] 会被 Notion 400)", async () => {
        const calls = [];
        NotionAPI.configureTransport({ request: async (opts) => { calls.push(opts); return ok({}); } });
        const result = await NotionAPI.appendBlockChildren("blk1", [], "secret_ok");
        expect(calls.length).toBe(0);
        expect(result).toBeNull();
    });

    it("appendBlockChildren 含嵌套子块也受 1000 块总上限约束", async () => {
        const calls = [];
        NotionAPI.configureTransport({
            request: async (opts) => {
                calls.push(opts);
                return ok({ results: opts.data.children.map((_, i) => ({ id: `n-${calls.length}-${i}` })) });
            },
        });
        // 每个顶层块含 60 个子块(size=61): 16 个 = 976 ≤1000, 第 17 个越界 → 切片
        const container = (i) => ({
            type: "bulleted_list_item",
            bulleted_list_item: {
                rich_text: [{ type: "text", text: { content: `p${i}` } }],
                children: Array.from({ length: 60 }, () => ({ type: "paragraph", paragraph: { rich_text: [] } })),
            },
        });
        await NotionAPI.appendBlockChildren("blk1", Array.from({ length: 20 }, (_, i) => container(i)), "secret_ok");
        expect(calls.length).toBeGreaterThan(1);
        calls.forEach((c) => {
            const total = c.data.children.reduce((acc, b) => acc + 1 + b.bulleted_list_item.children.length, 0);
            expect(total).toBeLessThanOrEqual(1000);
            expect(c.data.children.length).toBeLessThanOrEqual(100);
        });
    });

    it("duplicatePage 游标重复时终止且 parentType=page 使用 page_id 父级", async () => {
        const calls = [];
        let blockCalls = 0;
        NotionAPI.configureTransport({
            request: async (opts) => {
                calls.push(opts);
                if (opts.method === "GET" && opts.endpoint.startsWith("/pages/")) {
                    return ok({ properties: {} });
                }
                if (opts.method === "GET" && opts.endpoint.startsWith("/blocks/")) {
                    blockCalls++;
                    return ok({ results: [{ type: "paragraph", paragraph: {} }], has_more: true, next_cursor: "same" });
                }
                if (opts.method === "POST" && opts.endpoint === "/pages") {
                    return ok({ id: "newpage" });
                }
                return ok({});
            },
        });

        const page = await NotionAPI.duplicatePage("p1", "parentPage", "page", "secret_ok");
        expect(page.id).toBe("newpage");
        expect(blockCalls).toBe(2);

        const create = calls.find((c) => c.method === "POST" && c.endpoint === "/pages");
        expect(create.data.parent).toEqual({ page_id: "parentPage" });
        expect(create.data.properties.title.title[0].text.content).toBe("无标题");
    });
});

describe("P4: content handler 边界与降级", () => {
    const saved = {};

    beforeEach(() => {
        saved.checkConfig = AIAssistant.checkConfig;
        saved.resolvePageId = AIAssistant._resolvePageId;
        saved.updateLastMessage = ChatState.updateLastMessage;
        saved.requestChat = AIService.requestChat;
        saved.canExecute = OperationGuard.canExecute;
        saved.fetchPageMarkdown = NotionAPI.fetchPageMarkdown;
        saved.fetchBlocks = NotionAPI.fetchBlocks;
        saved.extractText = AIClassifier.extractText;

        AIAssistant.checkConfig = () => ({ valid: true });
        ChatState.updateLastMessage = () => {};
        OperationGuard.canExecute = () => true;
    });

    afterEach(() => {
        AIAssistant.checkConfig = saved.checkConfig;
        AIAssistant._resolvePageId = saved.resolvePageId;
        ChatState.updateLastMessage = saved.updateLastMessage;
        AIService.requestChat = saved.requestChat;
        OperationGuard.canExecute = saved.canExecute;
        NotionAPI.fetchPageMarkdown = saved.fetchPageMarkdown;
        NotionAPI.fetchBlocks = saved.fetchBlocks;
        AIClassifier.extractText = saved.extractText;
        Storage.remove(CONFIG.STORAGE_KEYS.AI_TEMPLATES);
    });

    it("_extractPageContent 游标重复时终止", async () => {
        let calls = 0;
        NotionAPI.fetchPageMarkdown = async () => ({ markdown: "" });
        NotionAPI.fetchBlocks = async () => {
            calls++;
            return { results: [{ type: "paragraph" }], has_more: true, next_cursor: "same" };
        };
        AIClassifier.extractText = (blocks) => `blocks:${blocks.length}`;

        const text = await AIHandlers._extractPageContent("page1", "secret_ok", 100);
        expect(calls).toBe(2);
        expect(text).toBe("blocks:2");
    });

    it("handleBrainstorm 解析返回 error 时给出页面解析失败提示", async () => {
        AIAssistant._resolvePageId = async () => ({ error: "网络失败" });
        const result = await AIHandlers.handleBrainstorm({ brainstorm_topic: "远程办公", page_name: "P" }, { notionApiKey: "k" }, "");
        expect(result).toContain("页面解析失败");
        expect(result).toContain("网络失败");
    });

    it("handleBrainstorm 读取参考页面抛错时降级为可见错误", async () => {
        AIAssistant._resolvePageId = async () => { throw new Error("timeout"); };
        const result = await AIHandlers.handleBrainstorm({ brainstorm_topic: "远程办公", page_name: "P" }, { notionApiKey: "k" }, "");
        expect(result).toContain("读取参考页面失败");
        expect(result).toContain("timeout");
    });

    it("handleTemplateOutput 生成阶段抛错时返回模板输出失败提示", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.AI_TEMPLATES, JSON.stringify([{ icon: "📄", name: "周报", prompt: "生成周报" }]));
        AIService.requestChat = async () => { throw new Error("ai down"); };

        const result = await AIHandlers.handleTemplateOutput({ template_name: "周报" }, { notionApiKey: "k" }, "");
        expect(result).toContain("❌ 模板输出失败");
        expect(result).toContain("ai down");
    });
});

describe("wave6 共识(dsf): 重试过闸 + retryCount 计数", () => {
    afterEach(() => { NotionAPI.resetTransport(); NotionAPI.setRequestGate(null); });

    it("429 重试同样经过共享 gate(不绕过令牌桶)", async () => {
        const origSleep = Utils.sleep;
        Utils.sleep = async () => {};
        let gateCalls = 0;
        NotionAPI.setRequestGate(async () => { gateCalls++; });
        let calls = 0;
        NotionAPI.configureTransport({
            request: async () => {
                calls++;
                return calls === 1
                    ? { status: 429, responseText: "{}", responseHeaders: "retry-after: 1" }
                    : ok({ ok: true });
            },
        });
        try {
            await NotionAPI.request("GET", "/pages/x", null, "secret_ok", 3);
            expect(calls).toBe(2);
            expect(gateCalls).toBe(2);
        } finally {
            Utils.sleep = origSleep;
        }
    });

    // retryCount 语义 = 已发出的请求尝试次数(含首次), 与 notable 既有契约 notion-api.test.js 一致;
    // wave6 dsf:3 提议改为纯重试次数 → 契约变更且字段无消费点, 裁决 FP(保留原语义)
});

describe("wave6 共识(qwen): appendBlocks 双上限 + 游标编码", () => {
    afterEach(() => NotionAPI.resetTransport());

    it("appendBlocks 含嵌套子块同样受 1000 块总上限约束", async () => {
        const origSleep = Utils.sleep;
        Utils.sleep = async () => {};
        const calls = [];
        NotionAPI.configureTransport({ request: async (opts) => { calls.push(opts); return ok({}); } });
        const container = () => ({
            type: "bulleted_list_item",
            bulleted_list_item: {
                rich_text: [],
                children: Array.from({ length: 60 }, () => ({ type: "paragraph", paragraph: { rich_text: [] } })),
            },
        });
        try {
            await NotionAPI.appendBlocks("page1", Array.from({ length: 20 }, container), "secret_ok");
            expect(calls.length).toBeGreaterThan(1);
            calls.forEach((c) => {
                const total = c.data.children.reduce((acc, b) => acc + 1 + b.bulleted_list_item.children.length, 0);
                expect(total).toBeLessThanOrEqual(1000);
            });
        } finally {
            Utils.sleep = origSleep;
        }
    });

    it("fetchBlocks/getUsers 游标做百分号编码(含保留字符不破坏查询串)", async () => {
        const calls = [];
        NotionAPI.configureTransport({ request: async (opts) => { calls.push(opts); return ok({ results: [] }); } });
        await NotionAPI.fetchBlocks("blk1", "a&b=c d+e", "secret_ok");
        await NotionAPI.getUsers("x&y=z", "secret_ok");
        expect(calls[0].endpoint).toBe("/blocks/blk1/children?start_cursor=a%26b%3Dc%20d%2Be");
        expect(calls[1].endpoint).toBe("/users?start_cursor=x%26y%3Dz");
    });
});

describe("wave7 共识(glm+qwen): create 路径双上限首片 + movePage 预检 + 续签重放过闸", () => {
    afterEach(() => { NotionAPI.resetTransport(); NotionAPI.setRequestGate(null); });

    it("createDatabasePage 首片嵌套总数 ≤1000, 其余走 appendBlocks 追加", async () => {
        const origSleep = Utils.sleep;
        Utils.sleep = async () => {};
        const calls = [];
        NotionAPI.configureTransport({ request: async (opts) => { calls.push(opts); return ok({ id: "page-1", object: "page" }); } });
        const container = () => ({
            type: "bulleted_list_item",
            bulleted_list_item: {
                rich_text: [],
                children: Array.from({ length: 60 }, () => ({ type: "paragraph", paragraph: { rich_text: [] } })),
            },
        });
        try {
            await NotionAPI.createDatabasePage("db1", { title: { title: [] } }, Array.from({ length: 20 }, container), "secret_ok");
            const creates = calls.filter((c) => c.endpoint === "/pages");
            const appends = calls.filter((c) => c.endpoint === "/blocks/page-1/children");
            expect(creates.length).toBe(1);
            expect(appends.length).toBeGreaterThan(0);
            const total = creates[0].data.children.reduce((acc, b) => acc + 1 + b.bulleted_list_item.children.length, 0);
            expect(total).toBeLessThanOrEqual(1000);
            expect(creates[0].data.children.length).toBeLessThanOrEqual(100);
        } finally {
            Utils.sleep = origSleep;
        }
    });

    it("movePage 预检短路: 不发请求, 抛明确错误(Notion 不支持改 parent)", async () => {
        const calls = [];
        NotionAPI.configureTransport({ request: async (opts) => { calls.push(opts); return ok({}); } });
        await expect(NotionAPI.movePage("p1", "p2", "page", "secret_ok"))
            .rejects.toThrow(/不支持移动页面/);
        expect(calls.length).toBe(0);
    });

    it("401 续签重放同样过闸(与 429 重试同口径)", async () => {
        const origSleep = Utils.sleep;
        Utils.sleep = async () => {};
        const { NotionOAuth } = require("../src/auth");
        const { Storage } = require("../src/storage");
        const { CONFIG } = require("../src/config");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, "cid");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, "csecret");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "rt-ok");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI, "https://smith-106.github.io/LD-Notion/oauth-callback");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, "oauth");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_expired");
        const origExchange = NotionOAuth.exchangeToken;
        NotionOAuth.exchangeToken = async () => ({ access_token: "secret_fresh", refresh_token: "rt2" });
        let gateCalls = 0;
        NotionAPI.setRequestGate(async () => { gateCalls++; });
        let calls = 0;
        NotionAPI.configureTransport({
            request: async () => {
                calls++;
                return calls === 1
                    ? { status: 401, responseText: JSON.stringify({ object: "error", code: "unauthorized", message: "API token is invalid." }), responseHeaders: "" }
                    : ok({ ok: true });
            },
        });
        try {
            const result = await NotionAPI.request("GET", "/pages/x", null, "secret_expired", 3);
            expect(result.ok).toBe(true);
            expect(gateCalls).toBe(2); // 首发 1 次 + 续签重放 1 次
        } finally {
            NotionOAuth.exchangeToken = origExchange;
            Utils.sleep = origSleep;
        }
    });
});
