import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3-r4 (AT-017/018/019, L2): ai/handlers 行为缝隙。
// 负集核实: paginate 韧性已由 p4conv-round7 全覆盖(剔除), _textToBlocks 为转发壳已守护(剔除),
//           _fetchSourcePages/_extractPageContent/_ensureAIProperty 此前仅结构断言 → 行为覆盖为零。
// 夹具契约: NotionAPI 属性 stub(同 api/index 对象); AIClassifier/Guard 真实。
const { NotionAPI } = require("../src/api");
const { _fetchSourcePages } = require("../src/ai/handlers/pageCrud");
const { _extractPageContent, _ensureAIProperty } = require("../src/ai/handlers/content");

const mkPage = (id, title) => ({
    id,
    properties: { 标题: { title: [{ plain_text: title }] } },
});

describe("AT-017: _fetchSourcePages 分页累积与标题过滤", () => {
    const saved = {};
    let calls;
    beforeEach(() => {
        calls = [];
        saved.queryDatabase = NotionAPI.queryDatabase;
    });
    afterEach(() => {
        NotionAPI.queryDatabase = saved.queryDatabase;
    });

    it("多页累积: has_more/next_cursor 链接, 第二次调用携带游标", async () => {
        NotionAPI.queryDatabase = async (dbId, a, b, cursor) => {
            calls.push(cursor);
            if (!cursor) return { results: [mkPage("p1", "一")], has_more: true, next_cursor: "c1" };
            return { results: [mkPage("p2", "二")], has_more: false };
        };
        const pages = await _fetchSourcePages("db1", "key", null);
        expect(pages.map((p) => p.id)).toEqual(["p1", "p2"]);
        expect(calls).toEqual([null, "c1"]);
    });

    it("重复游标终止: 恒定 next_cursor → 2 次调用, 不死循环", async () => {
        NotionAPI.queryDatabase = async (dbId, a, b, cursor) => {
            calls.push(cursor);
            return { results: [mkPage(`p${calls.length}`, "x")], has_more: true, next_cursor: "same" };
        };
        const pages = await _fetchSourcePages("db1", "key", null);
        expect(calls.length).toBe(2);
        expect(pages.length).toBe(2);
    });

    it("has_more 为真但游标缺失 → 单次调用即止", async () => {
        NotionAPI.queryDatabase = async () => {
            calls.push(null);
            return { results: [mkPage("p1", "x")], has_more: true, next_cursor: undefined };
        };
        const pages = await _fetchSourcePages("db1", "key", null);
        expect(calls.length).toBe(1);
        expect(pages.length).toBe(1);
    });

    it("标题过滤: includes 语义; null 关键词 → 全量", async () => {
        NotionAPI.queryDatabase = async () => ({
            results: [mkPage("p1", "React 入门"), mkPage("p2", "Vue 入门"), mkPage("p3", "react 进阶")],
            has_more: false,
        });
        const filtered = await _fetchSourcePages("db1", "key", "React");
        expect(filtered.map((p) => p.id)).toEqual(["p1"]); // 区分大小写 includes
        const all = await _fetchSourcePages("db1", "key", null);
        expect(all.length).toBe(3);
    });
});

describe("AT-018: _extractPageContent markdown 优先与 blocks 回退链", () => {
    const saved = {};
    beforeEach(() => {
        saved.fetchPageMarkdown = NotionAPI.fetchPageMarkdown;
        saved.fetchBlocks = NotionAPI.fetchBlocks;
    });
    afterEach(() => {
        NotionAPI.fetchPageMarkdown = saved.fetchPageMarkdown;
        NotionAPI.fetchBlocks = saved.fetchBlocks;
    });

    it("markdown 路径: trim + maxChars 截断, fetchBlocks 零调用", async () => {
        NotionAPI.fetchPageMarkdown = async () => ({ markdown: "  # 标题\n正文  " });
        NotionAPI.fetchBlocks = async () => {
            throw new Error("markdown 路径不得触发 blocks 回退");
        };
        const text = await _extractPageContent("page1", "key", 4000);
        expect(text).toBe("# 标题\n正文");
        const text10 = await _extractPageContent("page1", "key", 2);
        expect(text10).toBe("# ");
    });

    it("回退链: markdown 抛错 → fetchBlocks 分页收集 → extractText 连接", async () => {
        NotionAPI.fetchPageMarkdown = async () => {
            throw new Error("markdown API 不可用");
        };
        const blockCalls = [];
        NotionAPI.fetchBlocks = async (pageId, cursor) => {
            blockCalls.push(cursor);
            if (!cursor) return { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "alpha" }] } }], has_more: true, next_cursor: "b1" };
            return { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "beta" }] } }], has_more: false };
        };
        const text = await _extractPageContent("page1", "key", 4000);
        expect(text).toBe("alpha\nbeta"); // extractText 按块换行连接
        expect(blockCalls).toEqual([null, "b1"]);
    });

    it("blocks 路径同样执行 maxChars 截断", async () => {
        NotionAPI.fetchPageMarkdown = async () => {
            throw new Error("down");
        };
        NotionAPI.fetchBlocks = async () => ({
            results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "x".repeat(50) }] } }],
            has_more: false,
        });
        const text = await _extractPageContent("page1", "key", 5);
        expect(text).toBe("xxxxx");
    });
});

describe("AT-019: _ensureAIProperty 幂等创建与原型链安全", () => {
    const saved = {};
    let updateCalls;
    beforeEach(() => {
        updateCalls = [];
        saved.fetchDatabase = NotionAPI.fetchDatabase;
        saved.updateDatabase = NotionAPI.updateDatabase;
    });
    afterEach(() => {
        NotionAPI.fetchDatabase = saved.fetchDatabase;
        NotionAPI.updateDatabase = saved.updateDatabase;
    });

    it("自有属性已存在 → updateDatabase 零调用(幂等)", async () => {
        NotionAPI.fetchDatabase = async () => ({ properties: { "AI 分类": { rich_text: {} } } });
        NotionAPI.updateDatabase = async (...a) => {
            updateCalls.push(a);
            return {};
        };
        await _ensureAIProperty("db1", "AI 分类", "rich_text", "key");
        expect(updateCalls.length).toBe(0);
    });

    it("propertyName=constructor + 空 properties → 仍 PATCH(原型链安全)", async () => {
        NotionAPI.fetchDatabase = async () => ({ properties: {} });
        NotionAPI.updateDatabase = async (...a) => {
            updateCalls.push(a);
            return {};
        };
        await _ensureAIProperty("db1", "constructor", "rich_text", "key");
        expect(updateCalls.length).toBe(1); // 朴素 properties["constructor"] 检查会误判已存在
    });

    it("multi_select / rich_text 定义分派", async () => {
        NotionAPI.fetchDatabase = async () => ({ properties: {} });
        NotionAPI.updateDatabase = async (dbId, def) => {
            updateCalls.push(def);
            return {};
        };
        await _ensureAIProperty("db1", "标签", "multi_select", "key");
        expect(updateCalls[0]).toEqual({ 标签: { multi_select: { options: [] } } });
        await _ensureAIProperty("db1", "AI 摘要", "rich_text", "key");
        expect(updateCalls[1]).toEqual({ "AI 摘要": { rich_text: {} } });
    });
});
