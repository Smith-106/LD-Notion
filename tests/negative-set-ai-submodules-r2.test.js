import { describe, it, expect, beforeEach, vi } from "vitest";

// ISS-20260914-003 负集 第二批: ai/utils/{block,format,result}-helpers、
// ai/tools/{meta,read,write}-tools 输入校验/权限分支、ui/style-manager、
// ai/handlers/{batch,pageCrud,query} 表面契约。此前无直接单测文件。
const blockHelpers = require("../src/ai/utils/block-helpers");
const formatHelpers = require("../src/ai/utils/format-helpers");
const resultHelpers = require("../src/ai/utils/result-helpers");
const { StyleManager } = require("../src/ui/style-manager");
const metaTools = require("../src/ai/tools/meta-tools");
const readTools = require("../src/ai/tools/read-tools");
const writeTools = require("../src/ai/tools/write-tools");

// ============ ai/utils 纯函数 ============
describe("负集 r2: ai/utils/block-helpers", () => {
    it("_extractBlockPlainText 提取 rich_text 纯文本", () => {
        const block = { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Hello" }, { plain_text: " World" }] } };
        expect(blockHelpers._extractBlockPlainText(block)).toBe("Hello World");
    });
    it("_extractBlockPlainText 无 type/无 rich_text → \"\"", () => {
        expect(blockHelpers._extractBlockPlainText(null)).toBe("");
        expect(blockHelpers._extractBlockPlainText({})).toBe("");
        expect(blockHelpers._extractBlockPlainText({ type: "divider", divider: {} })).toBe("");
    });
    it("_collectBlockTree 递归收集 has_children 子块", async () => {
        const blocks = [
            { id: "b1", has_children: true },
            { id: "b2", has_children: false },
        ];
        const fetchChildren = async (id) => (id === "b1" ? [{ id: "b1c1", has_children: false }] : []);
        const tree = await blockHelpers._collectBlockTree(blocks, fetchChildren);
        expect(tree).toHaveLength(2);
        expect(tree[0].children).toHaveLength(1);
        expect(tree[0].children[0].id).toBe("b1c1");
        expect(tree[1].children).toBeUndefined();
    });
});

describe("负集 r2: ai/utils/format-helpers", () => {
    it("_formatUserSummary person 含 name+email+ID", () => {
        const u = { type: "person", name: "张三", id: "a-b-c", person: { email: "z@x.com" } };
        const s = formatHelpers._formatUserSummary(u);
        expect(s).toContain("张三");
        expect(s).toContain("<z@x.com>");
        expect(s).toContain("[person]");
        expect(s).toContain("(ID: abc)");
    });
    it("_formatUserSummary bot / null 安全", () => {
        expect(formatHelpers._formatUserSummary(null)).toBe("未知用户");
        const bot = { type: "bot", bot: { owner: { workspace_name: "WS" } } };
        expect(formatHelpers._formatUserSummary(bot)).toContain("[bot]");
    });
    it("_formatCommentSummary 含 author+time+text", () => {
        const c = { created_by: { name: "李四" }, created_time: "2026-09-18T10:00:00Z", rich_text: [{ plain_text: "好" }] };
        const s = formatHelpers._formatCommentSummary(c);
        expect(s).toContain("李四");
        expect(s).toContain("好");
        expect(formatHelpers._formatCommentSummary(null)).toBe("无评论");
    });
});

describe("负集 r2: ai/utils/result-helpers", () => {
    it("_buildStructuredResultText 拼接 title/summary/details", () => {
        const r = { title: "T", summary: "S", details: "D" };
        expect(resultHelpers._buildStructuredResultText(r)).toBe("**T**\n\nS\n\nD");
        expect(resultHelpers._buildStructuredResultText(null)).toBe("");
        expect(resultHelpers._buildStructuredResultText({ title: "仅标题" })).toBe("**仅标题**");
    });
    it("_isStructuredResult 仅 __structured===true 对象", () => {
        expect(resultHelpers._isStructuredResult({ __structured: true })).toBe(true);
        expect(resultHelpers._isStructuredResult({ __structured: false })).toBe(false);
        expect(resultHelpers._isStructuredResult([])).toBe(false);
        expect(resultHelpers._isStructuredResult(null)).toBeFalsy();
        expect(resultHelpers._isStructuredResult("x")).toBeFalsy();
    });
    it("_inferStructuredResultStatus success/error/unknown 推断", () => {
        expect(resultHelpers._inferStructuredResultStatus({ success: true })).toBe("success");
        expect(resultHelpers._inferStructuredResultStatus({ success: false })).toBe("error");
        expect(resultHelpers._inferStructuredResultStatus({ error: "x" })).toBe("error");
        expect(resultHelpers._inferStructuredResultStatus({})).toBe("success");
        expect(resultHelpers._inferStructuredResultStatus(null)).toBe("unknown");
    });
});

// ============ ui/style-manager ============
describe("负集 r2: ui/style-manager", () => {
    it("injectOnce 注入 style(有 root 时返回元素)", () => {
        // setup.js document 是 vi.fn mock —— injectOnce 经 createElement 创建元素
        const s = StyleManager.injectOnce("ldb-test-style", ".a{color:red}");
        expect(s).not.toBeNull();
        expect(s.id).toBe("ldb-test-style");
        expect(s.textContent).toBe(".a{color:red}");
        expect(document.head.appendChild).toHaveBeenCalledWith(s);
    });
    it("injectOnce 已存在同 id → 返回已有(不重建)", () => {
        const existing = { id: "ldb-dup", setAttribute: vi.fn() };
        document.getElementById.mockReturnValueOnce(existing);
        const callsBefore = document.createElement.mock.calls.length;
        const s = StyleManager.injectOnce("ldb-dup", ".b{}");
        expect(s).toBe(existing);
        expect(document.createElement.mock.calls.length).toBe(callsBefore); // 未新建 style
        document.getElementById.mockReset();
    });
    it("injectOnce 空参数返回 null", () => {
        expect(StyleManager.injectOnce("", ".a{}")).toBeNull();
        expect(StyleManager.injectOnce("id", "")).toBeNull();
        expect(StyleManager.injectOnce(null, null)).toBeNull();
    });
});

// ============ ai/tools 输入校验(无网络,确定性早退) ============
describe("负集 r2: ai/tools 输入校验分支", () => {
    it("read-tools.fetch_notion_object 缺 reference → 错误", async () => {
        const r = await readTools.fetch_notion_object.execute({}, { notionApiKey: "k" });
        expect(String(r)).toContain("错误");
        expect(String(r)).toContain("reference");
    });
    it("read-tools.get_comment 缺 comment_id → 错误", async () => {
        const r = await readTools.get_comment.execute({}, { notionApiKey: "k" });
        expect(String(r)).toContain("错误");
        expect(String(r)).toContain("comment_id");
    });
    it("write-tools.append_content 缺 page+content → 错误", async () => {
        const r = await writeTools.append_content.execute({}, { notionApiKey: "k" });
        expect(String(r)).toContain("错误");
    });
    it("write-tools.append_content 缺 content → 错误", async () => {
        const r = await writeTools.append_content.execute({ page_name: "P" }, { notionApiKey: "k" });
        expect(String(r)).toContain("错误");
        expect(String(r)).toContain("content");
    });
    it("write-tools.append_block_children 缺 content → 错误", async () => {
        const r = await writeTools.append_block_children.execute({}, { notionApiKey: "k" });
        expect(String(r)).toContain("错误");
        expect(String(r)).toContain("content");
    });
    it("write-tools.append_block_children after_block 缺 after_block_id → 错误", async () => {
        const r = await writeTools.append_block_children.execute(
            { content: "x", block_id: "blk1", insert_position: "after_block" },
            { notionApiKey: "k" }
        );
        expect(String(r)).toContain("错误");
        expect(String(r)).toContain("after_block_id");
    });
    it("write-tools.append_block_children 非法 insert_position → 错误", async () => {
        const r = await writeTools.append_block_children.execute(
            { content: "x", block_id: "blk1", insert_position: "middle" },
            { notionApiKey: "k" }
        );
        // 经 AGENT_TOOLS 包装后返回 assistant_result 对象;文本落 .text/.summary
        expect(String(r?.text ?? r)).toContain("错误");
    });
    it("write-tools.replace_page_markdown 缺 new_markdown → 错误", async () => {
        const r = await writeTools.replace_page_markdown.execute({ page_name: "P" }, { notionApiKey: "k" });
        expect(String(r?.text ?? r)).toContain("错误");
        expect(String(r?.text ?? r)).toContain("new_markdown");
    });
});

// ============ ai/tools meta-tools 委托契约 ============
describe("负集 r2: ai/tools/meta-tools 委托与校验", () => {
    it("generate_formula 缺 description → 错误", async () => {
        const r = await metaTools.generate_formula.execute({}, { notionApiKey: "k" });
        expect(String(r?.text ?? r)).toContain("错误");
    });
    it("meta-tools 委托型工具均含 execute 函数 + level 标注", () => {
        for (const name of ["research_report", "summarize_page", "brainstorm_ideas", "proofread_content", "batch_translate_database", "extract_to_database", "generate_structured_pages", "batch_analyze_pages"]) {
            expect(typeof metaTools[name].execute).toBe("function");
            expect(typeof metaTools[name].level).toBe("number");
        }
    });
    it("generate_formula 有 description 时经 svc().requestChat(委托链存在)", async () => {
        // 不触发真实网络: 验证调用链到达 svc().requestChat —— 通过捕获 AIService.requestChat
        const { getService } = require("../src/ai/deps");
        const svc = getService();
        const spy = vi.spyOn(svc, "requestChat").mockResolvedValue("公式: prop(\"x\")");
        try {
            const r = await metaTools.generate_formula.execute(
                { description: "统计已完成任务数" },
                { notionApiKey: "k", notionDatabaseId: "" } // 无 db → schemaDesc 空,直接进 prompt
            );
            expect(spy).toHaveBeenCalled();
            expect(String(r?.text ?? r)).toContain("Notion 公式生成");
        } finally {
            spy.mockRestore();
        }
    });
});

// ============ ui/events* (M3 拆分后 3 文件) 导出与委托契约 ============
describe("负集 r2: ui/events* 拆分后导出与委托", () => {
    const fs = require("fs");
    it("events/ai-bindings 导出 bindAISection 函数", () => {
        const { bindAISection } = require("../src/ui/events/ai-bindings");
        expect(typeof bindAISection).toBe("function");
    });
    it("events/export-bindings 导出 bindExport 函数", () => {
        const { bindExport } = require("../src/ui/events/export-bindings");
        expect(typeof bindExport).toBe("function");
    });
    it("events.js 导出 UIEvents.bindEvents 函数", () => {
        const { UIEvents } = require("../src/ui/events");
        expect(typeof UIEvents.bindEvents).toBe("function");
    });
    it("events.js bindEvents 委托拆分域(bindAISection/bindExport 经 require 注入)", () => {
        const src = fs.readFileSync("src/ui/events.js", "utf8");
        expect(src).toContain('require("./events/ai-bindings").bindAISection');
        expect(src).toContain('require("./events/export-bindings").bindExport');
    });
    it("events 拆分文件均 <1500 LOC", () => {
        for (const f of ["src/ui/events.js", "src/ui/events/ai-bindings.js", "src/ui/events/export-bindings.js"]) {
            const loc = fs.readFileSync(f, "utf8").split("\n").length;
            expect(loc).toBeLessThan(1500);
        }
    });
});

// ============ ai/handlers 表面契约 + 确定性早退 ============
describe("负集 r2: ai/handlers 表面契约", () => {
    it("batch/pageCrud/query handler 导出非空对象含函数成员", () => {
        const batch = require("../src/ai/handlers/batch");
        const pageCrud = require("../src/ai/handlers/pageCrud");
        const query = require("../src/ai/handlers/query");
        for (const mod of [batch, pageCrud, query]) {
            expect(typeof mod).toBe("object");
            expect(Object.keys(mod).length).toBeGreaterThan(0);
            // 至少一个可调用成员(handlers 是方法集)
            expect(Object.values(mod).some((v) => typeof v === "function")).toBe(true);
        }
    });
});

describe("负集 r2: ai/handlers 确定性早退(无网络)", () => {
    const query = require("../src/ai/handlers/query");
    const batch = require("../src/ai/handlers/batch");
    const pageCrud = require("../src/ai/handlers/pageCrud");

    it("query.handleQuery 缺 notionDatabaseId → 配置指引", async () => {
        const r = await query.handleQuery({}, {});
        expect(String(r)).toContain("请先配置 Notion 数据库 ID");
    });
    it("batch.handleBatchClassify 缺 notionDatabaseId → 配置指引", async () => {
        const r = await batch.handleBatchClassify({}, {});
        expect(String(r)).toContain("请先配置 Notion 数据库 ID");
    });
    it("batch.handleBatchClassify 缺分类选项 → 提示配置", async () => {
        const r = await batch.handleBatchClassify({}, { notionDatabaseId: "db1", categories: [] });
        expect(String(r)).toContain("分类选项");
    });
    // 权限分支需 checkConfig 先过(notionApiKey+aiApiKey), 再触 OperationGuard 级别判定
    const validCfg = { notionApiKey: "k", aiApiKey: "a", notionDatabaseId: "db" };
    it("pageCrud.handleMove 权限不足(默认 level 1) → 拒绝文案", async () => {
        const r = await pageCrud.handleMove({}, validCfg);
        expect(String(r)).toContain("权限不足");
    });
    it("pageCrud.handleCopy 权限不足(默认 level 1) → 拒绝文案", async () => {
        const r = await pageCrud.handleCopy({}, validCfg);
        expect(String(r)).toContain("权限不足");
    });
    it("pageCrud.handleCreateDatabase 权限不足(默认 level 1) → 拒绝文案", async () => {
        const r = await pageCrud.handleCreateDatabase({}, validCfg);
        expect(String(r)).toContain("权限不足");
    });
});
