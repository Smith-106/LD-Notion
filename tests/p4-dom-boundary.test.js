import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import fs from "fs";

// P4 第三批回归: DOMToNotion 边界(表格补齐/长文本截断/embed 白名单) + pageCrud 分页/歧义守卫
const { DOMToNotion, NotionAPI, HTMLToMarkdown } = require("../src/api");
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
        const row = (count) => ({ closest: () => null, tagName: "TR", children: Array.from({ length: count }, () => ({ tagName: "TD", querySelectorAll: () => [] })) });
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
        const cell = (extra) => ({ tagName: "TD", querySelectorAll: () => [], ...extra });
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
        const cell = () => ({ tagName: "TD", querySelectorAll: () => [] });
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
        const cell = () => ({ tagName: "TD", querySelectorAll: () => [] });
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


    it("独立图片仅 data-src 时仍导出(懒加载回退, 与 lightbox 同口径)", () => {
        const blocks = [];
        const img = { getAttribute: (k) => (k === "data-src" ? "https://cdn.example.com/lazy.png" : null) };
        DOMToNotion._cookImage(img, blocks, "external");
        expect(blocks[0].image.external.url).toBe("https://cdn.example.com/lazy.png");
    });

describe("wave6 共识(qwen): 嵌套表格隔离 + table_width 上限", () => {
    let origSerialize3;
    beforeEach(() => { origSerialize3 = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => RT(); });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize3; });

    it("单元格内嵌套表格的 thead/tbody 不并入外层表(has_column_header 不误置)", () => {
        const cellWithNested = {
            tagName: "TD",
            querySelectorAll: () => [],
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

    it("列数超 100 时保留 99 原列+标记列(截断数不多算)", () => {
        const cells = Array.from({ length: 105 }, () => ({ tagName: "TD", querySelectorAll: () => [], children: [] }));
        const row = { tagName: "TR", closest: () => null, children: cells };
        const table = { tagName: "TABLE", querySelector: () => null, children: [{ tagName: "TBODY", children: [row] }] };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks);
        const t = blocks[0].table;
        expect(t.table_width).toBe(100);
        expect(t.children[0].table_row.cells.length).toBe(100);
        expect(t.children[0].table_row.cells[99][0].text.content).toContain("已截断 6 列");
        // 第 98 列仍是原单元格内容(RT() 桩输出), 未被标记覆盖
        expect(t.children[0].table_row.cells[98][0].text.content).toBe(RT()[0].text.content);
    });
});

describe("wave8 共识(qwen): ext 伪造 + data-src emoji + li 重叠文本", () => {
    let origSerialize4;
    beforeEach(() => { origSerialize4 = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => RT(); });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize4; });

    it("video 扩展名不被锚点伪造(a.mp4#y.exe 仍按 mp4 判定)", () => {
        const blocks = [];
        const video = {
            getAttribute: (k) => (k === "src" ? "https://cdn.example.com/a.mp4#y.exe" : null),
            querySelector: () => null,
        };
        DOMToNotion._cookVideo(video, blocks, "external");
        expect(blocks[0].type).toBe("video");
    });

    it("锚点伪造的 video 扩展名不触发 embed 分支(YouTube 宿主 + 伪 .mp4 锚点)", () => {
        const blocks = [];
        const video = {
            getAttribute: (k) => (k === "src" ? "https://youtube.com/a.exe#y=.mp4" : null),
            querySelector: () => null,
        };
        DOMToNotion._cookVideo(video, blocks, "external");
        // 修复: 剥锚点后 ext=exe → 非媒体类型 → youtube 宿主走 embed; 变异(不剥锚点)
        // ext=mp4 → 误判媒体 → 走 video external 分支
        expect(blocks[0].type).toBe("embed");
        expect(blocks.some((b) => b.type === "video")).toBe(false);
    });

    it("serializeRichText 识别 data-src 懒加载 emoji", () => {
        // 本测试测真实实现 —— 还原 describe 级 RT 桩(其余 video 测试仍用桩)
        DOMToNotion.serializeRichText = origSerialize4;
        const origNode = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8 };
        const img = {
            nodeType: 1,
            tagName: "IMG",
            childNodes: [],
            getAttribute: (k) => (k === "data-src" ? "/images/emoji/twemoji/1f600.png" : null),
        };
        const p = { nodeType: 1, tagName: "P", childNodes: [img], querySelectorAll: () => [] };
        try {
            const rt = DOMToNotion.serializeRichText(p);
            expect(rt[0].text.content).toBe(":1f600:");
        } finally {
            if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        }
    });

    it("li 父项文本与内层列表 markdown 重叠时不再误删父项文本", () => {
        const origNode = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
        const txt = (t) => ({ nodeType: 3, textContent: t });
        const el = (tag, childNodes) => ({
            nodeType: 1,
            tagName: tag.toUpperCase(),
            childNodes,
            children: childNodes.filter((n) => n.nodeType === 1),
            parentElement: null,
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: (sel) => (sel === ":scope > li" ? childNodes.filter((c) => c.tagName === "LI") : []),
        });
        const li = el("li", [txt("- b"), el("ul", [el("li", [txt("b")])])]);
        try {
            expect(HTMLToMarkdown._convertNode(li)).toBe("- - b\n  - b\n");
        } finally {
            if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        }
    });
});

describe("wave8 共识(dsf): 引用块/表格单元格内嵌媒体补发", () => {
    let origSerialize5;
    beforeEach(() => { origSerialize5 = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => [{ type: "text", text: { content: "q" } }]; });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize5; });

    const mediaImg = (src) => ({
        tagName: "IMG",
        getAttribute: (k) => (k === "src" ? src : null),
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("blockquote 内嵌 img 补发 image 块(不再静默丢弃)", () => {
        const bq = {
            tagName: "BLOCKQUOTE",
            childNodes: [],
            children: [],
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: (sel) => (sel === "img" ? [mediaImg("https://cdn.example.com/q.png")] : []),
        };
        const blocks = [];
        DOMToNotion._cookBlockquote(bq, blocks, "external");
        expect(blocks[0].type).toBe("quote");
        expect(blocks[1].type).toBe("image");
        expect(blocks[1].image.external.url).toBe("https://cdn.example.com/q.png");
    });

    it("表格单元格内 img 补发兄弟块(Notion table_row 只收 rich_text)", () => {
        const cell = {
            tagName: "TD",
            querySelectorAll: (sel) => (sel === "img, video, audio, a.attachment, iframe" ? [mediaImg("https://cdn.example.com/c.png")] : []),
        };
        const row = { tagName: "TR", closest: () => null, children: [cell] };
        const table = {
            tagName: "TABLE",
            querySelector: () => null,
            children: [{ tagName: "TBODY", children: [row] }],
        };
        const blocks = [];
        DOMToNotion._cookTable(table, blocks, "external");
        expect(blocks[0].type).toBe("table");
        expect(blocks[1].type).toBe("image");
        expect(blocks[1].image.external.url).toBe("https://cdn.example.com/c.png");
    });

    it("aside.quote 内嵌 a.attachment 补发 file 块", () => {
        const att = {
            tagName: "A",
            getAttribute: (k) => (k === "href" ? "https://cdn.example.com/f.pdf" : null),
            textContent: "doc.pdf",
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        const bq = {
            tagName: "BLOCKQUOTE",
            childNodes: [],
            children: [],
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: (sel) => (sel === "a.attachment" ? [att] : []),
        };
        const aside = {
            tagName: "ASIDE",
            classList: { contains: (c) => c === "quote" },
            querySelector: (sel) => (sel === "blockquote" ? bq : null),
        };
        const blocks = [];
        DOMToNotion._cookAsideQuote(aside, blocks, "external");
        expect(blocks[0].type).toBe("quote");
        expect(blocks[1].type).toBe("file");
    });
});

describe("wave9 共识(dsf): 标题内联媒体补发 + br 硬换行", () => {
    let origSerialize6;
    beforeEach(() => { origSerialize6 = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => [{ type: "text", text: { content: "h" } }]; });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize6; });

    it("h2 内嵌 img 补发 image 块(不再静默丢弃)", () => {
        const img = { tagName: "IMG", getAttribute: (k) => (k === "src" ? "https://cdn.example.com/h.png" : null), querySelector: () => null, querySelectorAll: () => [] };
        const h2 = {
            tagName: "H2",
            childNodes: [],
            children: [],
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: (sel) => (sel === "img" ? [img] : []),
        };
        const blocks = [];
        DOMToNotion._cookHeading(h2, blocks, "external");
        expect(blocks[0].type).toBe("heading_2");
        expect(blocks[1].type).toBe("image");
        expect(blocks[1].image.external.url).toBe("https://cdn.example.com/h.png");
    });

    it("serializeRichText 处理 br: 相邻文本不再粘连(硬换行保留)", () => {
        const realSerialize = origSerialize6;
        DOMToNotion.serializeRichText = realSerialize; // 本测试测真实实现
        const origNode = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8 };
        const br = { nodeType: 1, tagName: "BR", childNodes: [], children: [], getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [] };
        const p = {
            nodeType: 1,
            tagName: "P",
            childNodes: [{ nodeType: 3, nodeValue: "line1" }, br, { nodeType: 3, nodeValue: "line2" }],
            children: [br],
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        try {
            const rt = DOMToNotion.serializeRichText(p);
            const content = rt.map((r) => r.text.content).join("");
            const joined = String(content);
            expect(joined).toBe("line1\nline2");
                    } finally {
            if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        }
    });
});

describe("wave9 共识(qwen): 表格无 section 时媒体补发", () => {
    let origSerialize7;
    beforeEach(() => { origSerialize7 = DOMToNotion.serializeRichText; DOMToNotion.serializeRichText = () => [{ type: "text", text: { content: "c" } }]; });
    afterEach(() => { DOMToNotion.serializeRichText = origSerialize7; });

    it("<table><tr><td><img></td></tr></table> 单元格媒体补发(无 section 回退直属 tr)", () => {
        const img = {
            tagName: "IMG",
            getAttribute: (k) => (k === "src" ? "https://cdn.example.com/d.png" : null),
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        const cell = { tagName: "TD", querySelectorAll: (sel) => (sel === "img, video, audio, a.attachment, iframe" ? [img] : []) };
        const row = { tagName: "TR", closest: () => null, children: [cell] };
        const table = { tagName: "TABLE", querySelector: () => null, children: [row] }; // 无 thead/tbody/tfoot
        const blocks = [];
        DOMToNotion._cookTable(table, blocks, "external");
        expect(blocks[0].type).toBe("table");
        expect(blocks[1].type).toBe("image");
        expect(blocks[1].image.external.url).toBe("https://cdn.example.com/d.png");
    });
});

describe("wave12 共识(dsf/qwen): 列表直嵌/块级边界/emoji set 同口径", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const T = (s) => ({ nodeType: 3, textContent: s, nodeValue: s });
    const E = (tag, kids) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes: kids,
        children: kids.filter((k) => k.nodeType === 1),
        textContent: kids.map((k) => k.textContent || "").join(""),
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("_cookList 直接嵌套的列表不再整支丢弃", () => {
        const blocks = [];
        DOMToNotion._cookList(E("ul", [E("ul", [E("li", [T("内层项")])])]), blocks, "external");
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("bulleted_list_item");
        expect(blocks[0].bulleted_list_item.rich_text[0].text.content).toBe("内层项");
    });

    it("_cookList 非 li 游离子元素的文本不再丢弃", () => {
        const blocks = [];
        DOMToNotion._cookList(E("ul", [E("div", [T("游离文本")]), E("li", [T("正常项")])]), blocks, "external");
        const text = blocks.map((b) => (b.paragraph || b.bulleted_list_item).rich_text[0].text.content);
        expect(text).toEqual(["游离文本", "正常项"]);
    });

    it("blockquote 内多段 <p> 之间补换行(不再粘成一段)", () => {
        const rt = DOMToNotion.serializeRichText(E("blockquote", [E("p", [T("第一段")]), E("p", [T("第二段")])]));
        expect(rt.map((c) => c.text.content).join("")).toBe("第一段\n第二段");
    });

    it("单个 <p> 不产生尾随换行(避免空行噪声)", () => {
        const rt = DOMToNotion.serializeRichText(E("blockquote", [E("p", [T("唯一段")])]));
        expect(rt.map((c) => c.text.content).join("")).toBe("唯一段");
    });

    it("_emojiImageName 覆盖 Discourse 任意 emoji set", () => {
        expect(DOMToNotion._emojiImageName("/images/emoji/win10/1f600.png")).toBe("1f600");
        expect(DOMToNotion._emojiImageName("/images/emoji/emoji_one/heart.png")).toBe("heart");
        expect(DOMToNotion._emojiImageName("https://linux.do/images/emoji/twitter/smile.png?v=1")).toBe("smile");
        expect(DOMToNotion._emojiImageName("https://example.com/pic.png")).toBe(null);
        expect(DOMToNotion._emojiImageName("")).toBe(null);
    });

    it("win10 set 的 emoji 图片: 块级跳过与行内转换同口径(不静默丢失)", () => {
        const src = "https://linux.do/images/emoji/win10/1f600.png";
        const blocks = [];
        DOMToNotion._cookImage({ getAttribute: () => src }, blocks, "external");
        expect(blocks).toEqual([]); // 块级仍跳过(避免与行内 emoji 文本重复)

        const img = {
            nodeType: 1, tagName: "IMG", childNodes: [], textContent: "",
            getAttribute: (n) => (n === "src" ? src : n === "alt" ? "😀" : null),
            querySelector: () => null,
        };
        const rt = DOMToNotion.serializeRichText(img);
        expect(rt.map((c) => c.text.content).join("")).toBe("😀"); // 同一 src 现在会被转成 emoji 文本
    });
});

describe("wave13 共识(dsf/qwen): 评论载荷原样 + script 跳过 + 直属文本不丢", () => {
    const origNode = globalThis.Node;
    const origParser = globalThis.DOMParser;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
        // node 环境无 DOMParser —— 极简桩(仅支持本组用例的 <tag>text</tag> 与裸文本)
        globalThis.DOMParser = function () {
            return {
                parseFromString: (html) => {
                    const body = { nodeType: 1, tagName: "BODY", childNodes: [], children: [] };
                    const re = /<(\w+)>([^<]*)<\/\1>|([^<]+)/g;
                    let m;
                    while ((m = re.exec(html))) {
                        if (m[1]) {
                            const child = E(m[1], [T(m[2])]);
                            body.childNodes.push(child);
                            body.children.push(child);
                        } else if (m[3] && m[3].trim()) {
                            body.childNodes.push(T(m[3]));
                        }
                    }
                    return { body };
                },
            };
        };
    });
    afterAll(() => {
        if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        if (origParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = origParser;
    });

    const T = (s) => ({ nodeType: 3, textContent: s, nodeValue: s });
    const E = (tag, kids, attrs = {}) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes: kids,
        children: kids.filter((k) => k.nodeType === 1),
        textContent: kids.map((k) => k.textContent || "").join(""),
        className: attrs.className || "",
        getAttribute: (n) => attrs[n] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("serializeRichText 跳过 script/style/noscript 文本", () => {
        const div = E("div", [T("正文"), E("script", [T("window.x=1;")]), E("style", [T(".a{}")]), T("尾")]);
        const text = DOMToNotion.serializeRichText(div).map((c) => c.text.content).join("");
        expect(text).toBe("正文尾");
    });

    it("未匹配元素(顶层 div/span)的直属文本落段落块", () => {
        const blocks = DOMToNotion.cookedToBlocks('<div>顶层裸文本</div>', "external");
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("paragraph");
        expect(blocks[0].paragraph.rich_text[0].text.content).toBe("顶层裸文本");
    });

    it("纯文本 cookedHtml(无标签)不再整篇丢失", () => {
        const blocks = DOMToNotion.cookedToBlocks("只有一段纯文本", "external");
        expect(blocks.length).toBe(1);
        expect(blocks[0].paragraph.rich_text[0].text.content).toBe("只有一段纯文本");
    });

    it("已知容器仍走原路径(不产生重复段落)", () => {
        const blocks = DOMToNotion.cookedToBlocks("<p>段落</p><blockquote>引用</blockquote>", "external");
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "quote"]);
    });
});

describe("wave14 共识(dsf): 块级边界 + 顺序化遍历(顺序不被破坏)", () => {
    const origNode = globalThis.Node;
    const origParser = globalThis.DOMParser;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
        globalThis.DOMParser = function () {
            return {
                parseFromString: (html) => {
                    const body = { nodeType: 1, tagName: "BODY", childNodes: [], children: [] };
                    const re = /<(\w+)>([^<]*)<\/\1>|([^<]+)/g;
                    let m;
                    while ((m = re.exec(html))) {
                        if (m[1]) {
                            const child = E(m[1], [T(m[2])]);
                            body.childNodes.push(child);
                            body.children.push(child);
                        } else if (m[3] && m[3].trim()) {
                            body.childNodes.push(T(m[3]));
                        }
                    }
                    return { body };
                },
            };
        };
    });
    afterAll(() => {
        if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        if (origParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = origParser;
    });

    const T = (s) => ({ nodeType: 3, textContent: s, nodeValue: s });
    const E = (tag, kids, attrs = {}) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes: kids,
        children: kids.filter((k) => k.nodeType === 1),
        textContent: kids.map((k) => k.textContent || "").join(""),
        className: attrs.className || "",
        getAttribute: (n) => attrs[n] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("块级元素后的裸文本不粘连(<blockquote><p>a</p>b</blockquote>)", () => {
        const bq = E("blockquote", [E("p", [T("Line1")]), T("Line2")]);
        const text = DOMToNotion.serializeRichText(bq).map((c) => c.text.content).join("");
        expect(text).toBe("Line1\nLine2");
    });

    it("块级元素前后的裸文本都不粘连", () => {
        const bq = E("blockquote", [T("前"), E("p", [T("中")]), T("后")]);
        const text = DOMToNotion.serializeRichText(bq).map((c) => c.text.content).join("");
        expect(text).toBe("前\n中\n后");
    });

    it("内联包装元素不打断文本连续性(<div>Hello <span>world</span> again</div>)", () => {
        const blocks = DOMToNotion.cookedToBlocks("<div>Hello world again</div>", "external");
        expect(blocks.length).toBe(1);
        expect(blocks[0].paragraph.rich_text[0].text.content).toBe("Hello world again");
    });

    it("根节点裸文本不与后续块级元素顺序颠倒", () => {
        const blocks = DOMToNotion.cookedToBlocks("Text", "external");
        expect(blocks.map((b) => (b.paragraph || b.quote).rich_text[0].text.content)).toEqual(["Text"]);
    });

    it("块级元素与裸文本保持文档顺序", () => {
        const bq = E("blockquote", [E("p", [T("First")]), T("Second")]);
        const text = DOMToNotion.serializeRichText(bq).map((c) => c.text.content).join("");
        expect(text).toBe("First\nSecond");
    });
});

describe("wave14 共识(glm): 直属媒体消费 + 嵌套块边界 + hr 分隔线", () => {
    const origNode = globalThis.Node;
    const origParser = globalThis.DOMParser;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
        globalThis.DOMParser = function () {
            return {
                parseFromString: (html) => {
                    const body = { nodeType: 1, tagName: "BODY", childNodes: [], children: [] };
                    const re = /<hr>|<(\w+)>([^<]*)<\/\1>|([^<]+)/g;
                    let m;
                    while ((m = re.exec(html))) {
                        if (m[0] === "<hr>") {
                            const child = E("hr", []);
                            body.childNodes.push(child);
                            body.children.push(child);
                        } else if (m[1]) {
                            const child = E(m[1], [T(m[2])]);
                            body.childNodes.push(child);
                            body.children.push(child);
                        } else if (m[3] && m[3].trim()) {
                            body.childNodes.push(T(m[3]));
                        }
                    }
                    return { body };
                },
            };
        };
    });
    afterAll(() => {
        if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        if (origParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = origParser;
    });

    const T = (s) => ({ nodeType: 3, textContent: s, nodeValue: s });
    const E = (tag, kids, attrs = {}) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes: kids,
        children: kids.filter((k) => k.nodeType === 1),
        textContent: kids.map((k) => k.textContent || "").join(""),
        className: attrs.className || "",
        getAttribute: (n) => (n in attrs ? attrs[n] : null),
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("ul 的直属媒体子元素(非 li 包裹)不静默丢弃", () => {
        const blocks = [];
        const img = E("img", [], { src: "https://pub.example.com/x.png" });
        DOMToNotion._cookList(E("ul", [img]), blocks, "external");
        expect(blocks.map((b) => b.type)).toContain("image");
    });

    it("_consumeInlineMedia 自身即媒体时同样产出块", () => {
        const blocks = [];
        DOMToNotion._consumeInlineMedia(E("img", [], { src: "https://pub.example.com/y.png" }), blocks, "external");
        expect(blocks.map((b) => b.type)).toEqual(["image"]);
    });

    it("嵌套块级元素只补一次边界(不产生空行)", () => {
        const bq = E("blockquote", [E("p", [T("a")]), E("div", [E("p", [T("b")])])]);
        const text = DOMToNotion.serializeRichText(bq).map((c) => c.text.content).join("");
        expect(text).toBe("a\nb");
    });

    it("<hr> 产出 divider 块而非静默丢弃", () => {
        const blocks = DOMToNotion.cookedToBlocks("<hr>", "external");
        expect(blocks).toEqual([{ type: "divider", divider: {} }]);
    });
});
