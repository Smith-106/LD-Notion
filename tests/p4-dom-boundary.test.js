import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";

// P4 第三批回归: DOMToNotion 边界(表格补齐/长文本截断/embed 白名单) + pageCrud 分页/歧义守卫
const { DOMToNotion, NotionAPI } = require("../src/api");
const { AIHandlers, AIAssistant } = require("../src/ai/index.js");
const { OperationGuard } = require("../src/security");
const { ChatState } = require("../src/ai/index.js");

const RT = () => [{ type: "text", text: { content: "c" } }];

describe("P4: DOMToNotion 表格与长文本边界", () => {
    let origSerialize;
    beforeEach(() => { origSerialize = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => RT(); });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize; });

    it("短行 cells 补齐到 table_width", () => {
        const row = (count) => ({ closest: () => null, querySelectorAll: () => Array.from({ length: count }, () => ({})) });
        const table = { tagName: "TABLE", querySelector: () => null, querySelectorAll: () => [row(3), row(1)] };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks);

        const t = blocks[0].table;
        expect(t.table_width).toBe(3);
        expect(t.children.map((c) => c.table_row.cells.length)).toEqual([3, 3]);
        expect(t.children[1].table_row.cells[2]).toEqual([{ type: "text", text: { content: "" } }]);
    });

    it("附件 caption 走 splitLongText 切分", () => {
        const blocks = [];
        DOMToNotion._cookAttachment({
            getAttribute: () => "https://example.com/file.pdf",
            textContent: "x".repeat(2500),
        }, blocks, "external");

        const caption = blocks[0].file.caption;
        expect(caption.length).toBe(2);
        expect(caption[0].text.content.length).toBe(2000);
        expect(caption[1].text.content.length).toBe(500);
    });

    it("splitLongText 达 100 项上限时末块带截断标记", () => {
        const result = DOMToNotion.splitLongText("x".repeat(250000));
        expect(result.length).toBe(100);
        expect(result[99].text.content).toContain("已截断 50000 字符");
        expect(result[99].text.content.length).toBeLessThanOrEqual(2000);
    });

    it("_cookVideo 非白名单宿主降级为 video 而非 embed", () => {
        const evil = [];
        DOMToNotion._cookVideo({ getAttribute: () => "https://evil.com/player.html", querySelector: () => null }, evil, "external");
        expect(evil[0].type).toBe("video");

        const yt = [];
        DOMToNotion._cookVideo({ getAttribute: () => "https://www.youtube.com/embed/abc", querySelector: () => null }, yt, "external");
        expect(yt[0].type).toBe("embed");
    });

    it("_cookIframe 仍拒绝非白名单宿主", () => {
        const blocks = [];
        const handled = DOMToNotion._cookIframe({ getAttribute: () => "https://evil.com/player.html" }, blocks);
        expect(handled).toBe(false);
        expect(blocks).toEqual([]);
    });

    it("serializeRichText 超 100 节点告警(源码契约)", () => {
        const src = fs.readFileSync("src/api/DOMToNotion.js", "utf8");
        expect(src).toContain("超 Notion 上限 100, 已截断");
    });
});

describe("P4: pageCrud 分页与歧义守卫", () => {
    const saved = {};

    beforeEach(() => {
        saved.checkConfig = AIAssistant.checkConfig;
        saved.canExecute = OperationGuard.canExecute;
        saved.updateLastMessage = ChatState.updateLastMessage;
        saved.resolveTargets = AIAssistant._resolvePageTargets;
        saved.executeGuardedWrite = AIAssistant._executeGuardedWrite;
        saved.queryDatabase = NotionAPI.queryDatabase;
        saved.search = NotionAPI.search;
        saved.createDatabase = NotionAPI.createDatabase;

        AIAssistant.checkConfig = () => ({ valid: true });
        OperationGuard.canExecute = () => true;
        ChatState.updateLastMessage = () => {};
    });

    afterEach(() => {
        AIAssistant.checkConfig = saved.checkConfig;
        OperationGuard.canExecute = saved.canExecute;
        ChatState.updateLastMessage = saved.updateLastMessage;
        AIAssistant._resolvePageTargets = saved.resolveTargets;
        AIAssistant._executeGuardedWrite = saved.executeGuardedWrite;
        NotionAPI.queryDatabase = saved.queryDatabase;
        NotionAPI.search = saved.search;
        NotionAPI.createDatabase = saved.createDatabase;
    });

    it("_fetchSourcePages 游标重复时终止", async () => {
        let calls = 0;
        NotionAPI.queryDatabase = async () => {
            calls++;
            return { results: [{ id: `p${calls}`, properties: {} }], has_more: true, next_cursor: "same" };
        };
        const pages = await AIHandlers._fetchSourcePages("db1", "k");
        expect(calls).toBe(2);
        expect(pages.length).toBe(2);
    });

    it("单页名匹配多页时返回歧义提示(不再静默批量)", async () => {
        AIAssistant._resolvePageTargets = async () => [{ name: "A", id: "a" }, { name: "B", id: "b" }];
        const result = await AIHandlers.handleUpdate({ page_name: "A" }, { notionApiKey: "k" }, "");
        expect(result).toContain("找到多个页面");
    });

    it("显式批量参数不触发歧义提示", async () => {
        AIAssistant._resolvePageTargets = async () => [{ name: "A", id: "a" }, { name: "B", id: "b" }];
        AIAssistant._applyPageUpdatesToTargets = async () => ({ success: 2, failed: 0 });
        const result = await AIHandlers.handleUpdate({ page_ids: ["a", "b"] }, { notionApiKey: "k" }, "");
        expect(result).toContain("批量更新完成");
    });

    it("工作区搜索跟随 next_cursor 直到找到 workspace 页面", async () => {
        const cursors = [];
        NotionAPI.search = async (q, filter, key, cursor) => {
            cursors.push(cursor);
            if (!cursor) {
                return { results: [{ id: "page-1", archived: false, parent: { type: "page_id" } }], has_more: true, next_cursor: "c1" };
            }
            return { results: [{ id: "ws-1", archived: false, parent: { type: "workspace" } }], has_more: false, next_cursor: null };
        };
        NotionAPI.createDatabase = async () => ({ id: "db-1" });
        AIAssistant._executeGuardedWrite = async (op, fn) => fn();

        const result = await AIHandlers.handleCreateDatabase({ database_name: "测试库" }, { notionApiKey: "k" }, "");
        expect(result).toContain("数据库创建成功");
        expect(cursors).toEqual([null, "c1"]);
    });
});
