import { describe, it, expect, afterEach } from "vitest";

// P4 收敛轮第一批回归 (chunk c01-c06 全库复审确认修复的锁定用例)。
const { AIAssistant, AIService } = require("../src/ai/index.js");
const { BlockConverter } = require("../src/ai/BlockConverter.js");
const { AgentTrace } = require("../src/ai/AgentTrace.js");
const { BookmarkAdapter } = require("../src/adapter/BookmarkAdapter.js");
const { SyncScheduler } = require("../src/adapter/SyncScheduler.js");
const { NotionAPI } = require("../src/api");
const { Utils } = require("../src/utils");
const payloadBuilders = require("../src/ai/utils/payload-builders.js");

const ok = (body) => ({ status: 200, responseText: JSON.stringify(body), responseHeaders: "" });

describe("P4 收敛: Utils Markdown 输出净化 (c02/c05)", () => {
    it("mdText 转义方括号(内容无损), mdUrl 百分号编码保留链接目标, mdLink 组合", () => {
        // wave17 共识(glm): 删除字符会破坏标签内的嵌套 Markdown(可点击图片 [![alt](u)](link) → 损坏文本);
        // 反斜杠转义同样阻止 ]( 逃逸链接语法, 且内容无损
        expect(Utils.mdText("a](b)")).toBe("a\\](b)");
        // P4 收敛(c05): 删除字符会改写链接目标(Wikipedia 带括号条目→404)
        expect(Utils.mdUrl("https://x.com/a b)")).toBe("https://x.com/a%20b%29");
        expect(Utils.mdUrl("https://en.wikipedia.org/wiki/Python_(programming_language)"))
            .toBe("https://en.wikipedia.org/wiki/Python_%28programming_language%29");
        expect(Utils.mdLink("标题](x", "https://a.com/1")).toBe("[标题\\](x](https://a.com/1)");
    });
});

describe("P4 收敛: BlockConverter 更新路径文本切分 (c01)", () => {
    it("buildBlockUpdatePayload 超 2000 字符切分为多个 rich_text 项", () => {
        const payload = BlockConverter.buildBlockUpdatePayload(
            { id: "b1", type: "paragraph", paragraph: { rich_text: [] } },
            "x".repeat(4500)
        );
        expect(payload.paragraph.rich_text.length).toBe(3);
        expect(payload.paragraph.rich_text[0].text.content.length).toBe(2000);
    });
});

describe("P4 收敛: BookmarkAdapter 增量水位 (c01)", () => {
    const savedAccessor = BookmarkAdapter._bridgeAccessor;
    afterEach(() => { BookmarkAdapter._bridgeAccessor = savedAccessor; });

    it("createdAt 为空串的书签不被水位过滤(否则永久不再同步)", async () => {
        BookmarkAdapter._bridgeAccessor = () => ({
            BookmarkBridge: {
                isExtensionAvailable: () => true,
                getBookmarkTree: async () => ({ id: "0", children: [] }),
                flattenTree: () => [
                    { id: "1", url: "https://old.example.com", title: "old", dateAdded: Date.parse("2020-01-01") },
                    { id: "2", url: "https://nodate.example.com", title: "nodate" },
                ],
            },
            BookmarkExporter: { isHttpUrl: (u) => /^https?:\/\//.test(u || "") },
        });
        const items = await BookmarkAdapter.fetchIncremental({ time: "2026-01-01T00:00:00.000Z" });
        expect(items.map((i) => i.id)).toEqual(["2"]);
    });
});

describe("P4 收敛: payload-builders 属性值 (c04)", () => {
    it("checkbox 严格真值: \"false\"/\"0\" 不为真", () => {
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", "false").checkbox).toBe(false);
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", "0").checkbox).toBe(false);
        expect(payloadBuilders._buildPropertyValuePayload("checkbox", true).checkbox).toBe(true);
    });

    it("url 经 UrlValidator: javascript:/内网被拒, 公网放行", () => {
        expect(payloadBuilders._buildPropertyValuePayload("url", "javascript:alert(1)").url).toBeNull();
        expect(payloadBuilders._buildPropertyValuePayload("url", "http://169.254.169.254/latest").url).toBeNull();
        expect(payloadBuilders._buildPropertyValuePayload("url", "https://example.com/x").url)
            .toBe("https://example.com/x");
    });
});

describe("P4 收敛: ai/index 意图/分类/重试 (c03)", () => {
    it("_resolveIntentExecutor 原型链键返回 null(不绕过降级)", () => {
        expect(AIAssistant._resolveIntentExecutor("constructor")).toBeNull();
        expect(AIAssistant._resolveIntentExecutor("toString")).toBeNull();
    });

    it("matchCategory 纯标点响应落到末位默认分类", () => {
        expect(AIService.matchCategory("。！", ["A", "B", "其他"])).toBe("其他");
    });

    it("_retryable 不再把 invalid 子串当不可重试", async () => {
        let calls = 0;
        const result = await AIService._retryable(async () => {
            calls++;
            if (calls === 1) throw new Error("invalid upstream response");
            return "ok";
        }, 1);
        expect(result).toBe("ok");
        expect(calls).toBe(2);
    });

    it("_retryable 401 立即抛出不重试", async () => {
        let calls = 0;
        await expect(AIService._retryable(async () => {
            calls++;
            throw new Error("OpenAI 错误: 401 Unauthorized");
        }, 2)).rejects.toThrow(/401/);
        expect(calls).toBe(1);
    });
});

describe("P4 收敛: duplicatePage 递归子块 (c05)", () => {
    afterEach(() => NotionAPI.resetTransport());

    it("has_children 块递归抓取子块, child_page 被跳过", async () => {
        const posts = [];
        NotionAPI.configureTransport({
            request: async (opts) => {
                if (opts.method === "GET" && opts.endpoint === "/pages/p1") return ok({ properties: {} });
                if (opts.method === "GET" && opts.endpoint.startsWith("/blocks/table1/children")) {
                    return ok({ results: [{ type: "table_row", table_row: { cells: [] } }], has_more: false, next_cursor: null });
                }
                if (opts.method === "GET" && opts.endpoint.startsWith("/blocks/p1/children")) {
                    return ok({
                        results: [
                            { type: "table", id: "table1", has_children: true, table: { table_width: 1, has_column_header: false, has_row_header: false } },
                            { type: "child_page", id: "cp1", child_page: { title: "sub" } },
                        ],
                        has_more: false,
                        next_cursor: null,
                    });
                }
                if (opts.method === "POST" && opts.endpoint === "/pages") {
                    posts.push(opts);
                    return ok({ id: "newpage" });
                }
                return ok({});
            },
        });

        await NotionAPI.duplicatePage("p1", "parentPage", "page", "secret_ok");
        expect(posts).toHaveLength(1);
        expect(posts[0].data.children).toHaveLength(1);
        expect(posts[0].data.children[0].type).toBe("table");
        expect(posts[0].data.children[0].table.children[0].type).toBe("table_row");
    });
});

describe("P4 收敛: 上传分片共享请求 gate (c05)", () => {
    afterEach(() => NotionAPI.setRequestGate(null));

    it("sendFilePart 发起请求前先 await _requestGate", async () => {
        const order = [];
        NotionAPI.setRequestGate(async () => { order.push("gate"); });
        // Node 环境无 FileReader: gate 之后的构造抛错即证明 gate 已先行
        await expect(NotionAPI.sendFilePart("u1", new Blob([]), 1, "secret_ok", "f.bin")).rejects.toBeTruthy();
        expect(order).toEqual(["gate"]);
    });
});

describe("P4 收敛: SyncScheduler 状态精度 (c01)", () => {
    afterEach(() => SyncScheduler.stop("linuxdo"));

    it("getStatus 反映显式传入的间隔并给出下一次同步时间", () => {
        SyncScheduler.start("linuxdo", 7);
        const status = SyncScheduler.getStatus("linuxdo");
        expect(status.intervalMinutes).toBe(7);
        expect(typeof status.nextSyncAt).toBe("number");
        expect(status.nextSyncAt).toBeGreaterThan(Date.now());
    });
});

describe("P4 收敛: AgentTrace 持久化脱敏 (c03)", () => {
    it("toolCalls[].thought 中的凭证被脱敏", () => {
        const trace = AgentTrace.create("输入");
        AgentTrace.recordToolCall(trace, { tool: "t", thought: "使用 sk-abcdefghijklmnopqrstuvwx 调用" }, 1);
        const persisted = AgentTrace.persist(trace, "done", "ok");
        expect(persisted.toolCalls[0].thought).not.toContain("sk-abcdefghijklmnopqrstuvwx");
        expect(persisted.toolCalls[0].thought).toContain("***REDACTED***");
    });
});
