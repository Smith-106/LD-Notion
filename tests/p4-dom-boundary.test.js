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
        // P4 收敛(c05): 行列改为只取直属子元素(children), 不再用后代选择器 —— 嵌套表格不窜行
        const row = (count) => ({ closest: () => null, tagName: "TR", children: Array.from({ length: count }, () => ({ tagName: "TD" })) });
        const table = { tagName: "TABLE", querySelector: () => null, children: [row(3), row(1)] };
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

    // ===== P4 收敛(c05): DOMToNotion 四项边界 =====

    it("长文本分块边界落在代理对中间时回退一个码元", () => {
        // "a"×1999 后紧跟 emoji(高代理位 1999, 低代理位 2000) —— 硬切 2000 会切出孤立高代理
        const text = "a".repeat(1999) + "😀" + "b".repeat(10);
        const chunks = DOMToNotion.splitLongText(text);
        expect(chunks[0].text.content).toBe("a".repeat(1999));
        const joined = chunks.map((c) => c.text.content).join("");
        expect(joined).toBe(text);
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(joined)).toBe(false);
        expect(/(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(joined)).toBe(false);
    });

    it("截断标记插入点同样避让代理对", () => {
        const remainingLen = 50;
        const markerLen = `…（内容过长，已截断 ${remainingLen} 字符）`.length;
        const cut = 2000 - markerLen;
        // 第 100 块: 高代理位恰在 cut-1、低代理位在 cut —— 原实现 slice(0, cut) 会切出孤立高代理
        const lastChunk = "a".repeat(cut - 1) + "😀" + "a".repeat(markerLen - 1);
        expect(lastChunk.length).toBe(2000);
        const text = "a".repeat(2000 * 99) + lastChunk + "b".repeat(remainingLen);
        const chunks = DOMToNotion.splitLongText(text);
        expect(chunks.length).toBe(100);
        const last = chunks[99].text.content;
        expect(last).toContain(`已截断 ${remainingLen} 字符`);
        expect(last.length).toBeLessThanOrEqual(2000);
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(last)).toBe(false);
    });

    it("表格行列只取直属子元素, 嵌套表格不并入外层", () => {
        const cell = (extra) => ({ tagName: "TD", ...extra });
        // 内层表格: 1 行 3 格(若用后代选择器会被并入外层 → 列宽 4)
        const nestedCells = [cell(), cell(), cell()];
        const nestedRow = { tagName: "TR", closest: () => null, children: nestedCells, querySelectorAll: () => nestedCells };
        const nestedTable = { tagName: "TABLE", querySelector: () => null, children: [nestedRow], querySelectorAll: () => [] };
        const outerCell = cell({ children: [nestedTable], querySelectorAll: () => nestedCells });
        const row = {
            tagName: "TR",
            closest: () => null,
            children: [outerCell],
            querySelectorAll: () => [outerCell, ...nestedCells],
        };
        const table = {
            tagName: "TABLE",
            querySelector: () => null,
            children: [row],
            querySelectorAll: () => [row, nestedRow],
        };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks);
        expect(blocks[0].table.table_width).toBe(1);
        expect(blocks[0].table.children.length).toBe(1);
    });

    it("language-c# 不再被截为 c(C# 代码块按 C 导出)", () => {
        const blocks = [];
        DOMToNotion._cookCode({ querySelector: () => ({ getAttribute: () => "language-c#", textContent: "var x = 1;" }) }, blocks);
        expect(blocks[0].code.language).toBe("c#");
        const plain = [];
        DOMToNotion._cookCode({ querySelector: () => ({ getAttribute: () => "language-c", textContent: "int x;" }) }, plain);
        expect(plain[0].code.language).toBe("c");
    });

    it("emoji 回退文本走 splitLongText(不过长驳回整页)", () => {
        const src = fs.readFileSync("src/api/DOMToNotion.js", "utf8");
        expect(src).toContain("result.push(...DOMToNotion.splitLongText(emoji, annotations));");
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

describe("P4 收敛(c05a-glm): 段落内嵌媒体 / 表格行上限与多 tbody", () => {
    let origSerialize2;
    beforeEach(() => { origSerialize2 = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => RT(); });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize2; });

    it("段落内嵌 iframe 有消费点(embed 不再静默丢失)", () => {
        const blocks = [];
        const frame = { getAttribute: () => "https://www.youtube.com/embed/abc" };
        const el = {
            querySelectorAll: (sel) => (sel === "iframe" ? [frame] : []),
        };
        DOMToNotion._cookParagraph(el, blocks, "external");
        expect(blocks.some((b) => b.type === "embed")).toBe(true);
    });

    it("表格行数超 100 时截断并留可见标记", () => {
        const cell = () => ({ tagName: "TD" });
        const row = () => ({ closest: () => null, tagName: "TR", children: [cell()] });
        const table = { tagName: "TABLE", querySelector: () => null, children: Array.from({ length: 130 }, row) };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks);
        const t = blocks[0].table;
        expect(t.children.length).toBe(100);
        const lastCell = t.children[99].table_row.cells[0];
        expect(lastCell[0].text.content).toContain("已截断 31 行");
    });

    it("多个 tbody + tfoot 的行全部保留", () => {
        const cell = () => ({ tagName: "TD" });
        const row = () => ({ closest: () => null, tagName: "TR", children: [cell()] });
        const table = {
            tagName: "TABLE",
            querySelector: () => null,
            children: [
                { tagName: "TBODY", children: [row()] },
                { tagName: "TBODY", children: [row(), row()] },
                { tagName: "TFOOT", children: [row()] },
            ],
        };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks);
        expect(blocks[0].table.children.length).toBe(4);
    });
});

describe("wave6 共识(dsf): li 内嵌媒体 + 链接 emoji 文本", () => {
    it("li 内嵌 video/iframe 有消费点(不再静默丢失)", () => {
        const blocks = [];
        const li = {
            tagName: "LI",
            querySelectorAll: (sel) => {
                if (sel === "iframe") return [{ getAttribute: () => "https://www.youtube.com/embed/z" }];
                if (sel === "video") return [{ getAttribute: () => "https://cdn.example.com/v.mp4", querySelector: () => null }];
                return [];
            },
        };
        const el = { tagName: "UL", children: [li] };
        const origSerialize = DOMToNotion.serializeRichText;
        DOMToNotion.serializeRichText = () => [{ type: "text", text: { content: "文本" } }];
        try {
            DOMToNotion._cookList(el, blocks, "external");
        } finally {
            DOMToNotion.serializeRichText = origSerialize;
        }
        expect(blocks.some((b) => b.type === "video")).toBe(true);
        expect(blocks.some((b) => b.type === "embed")).toBe(true);
    });

    it("链接内只有 emoji 图片时用 alt 作链接文本(不回退裸 URL)", () => {
        const origNode = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8 };
        const anchor = {
            nodeType: 1,
            tagName: "A",
            textContent: "",
            childNodes: [],
            getAttribute: (k) => (k === "href" ? "https://linux.do/u/foo" : null),
            querySelector: (sel) => (sel === "img" ? { getAttribute: () => "😀" } : null),
        };
        const p = { nodeType: 1, tagName: "P", childNodes: [anchor], querySelectorAll: () => [] };
        const rt = DOMToNotion.serializeRichText(p);
        if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        expect(rt[0].text.content).toBe("😀");
        expect(rt[0].text.link.url).toBe("https://linux.do/u/foo");
    });
});

describe("wave6 共识(qwen): 嵌套表格隔离 + table_width 上限", () => {
    let origSerialize3;
    beforeEach(() => { origSerialize3 = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => RT(); });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize3; });

    it("单元格内嵌套表格的 thead/tbody 不并入外层表(has_column_header 不误置)", () => {
        const cellWithNested = {
            tagName: "TD",
            children: [{ tagName: "TABLE", querySelector: () => null, children: [] }],
        };
        const outerRow = { tagName: "TR", closest: () => null, children: [cellWithNested] };
        const table = {
            tagName: "TABLE",
            // 后代选择器会命中内层嵌套表格的 thead; 直属子元素没有 thead
            querySelector: (sel) => (sel === "thead" ? { tagName: "THEAD", children: [{ tagName: "TR", children: [] }] } : null),
            children: [{ tagName: "TBODY", children: [outerRow] }],
        };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks);
        expect(blocks[0].table.children.length).toBe(1);
        expect(blocks[0].table.has_column_header).toBe(false);
    });

    it("列数超 100 时截断到 100 并在末列留标记", () => {
        const cells = Array.from({ length: 105 }, () => ({ tagName: "TD", children: [] }));
        const row = { tagName: "TR", closest: () => null, children: cells };
        const table = { tagName: "TABLE", querySelector: () => null, children: [{ tagName: "TBODY", children: [row] }] };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks);
        const t = blocks[0].table;
        expect(t.table_width).toBe(100);
        expect(t.children[0].table_row.cells.length).toBe(100);
        expect(t.children[0].table_row.cells[99][0].text.content).toContain("已截断 5 列");
    });
});
