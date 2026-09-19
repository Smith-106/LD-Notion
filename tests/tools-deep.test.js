// ISS-20260914-003 深度行为测试 —— ai/tools 写入路径编排。
// 覆盖 write-tools 的 resolve → _executeGuardedPageWrite( Guard 边界) → _formatToolResult
// 正向编排, 以及 Markdown 追加失败回退块追加的分支; 不经真实网络。
// 工具经 AGENT_TOOLS 包装返回 assistant_result({type,status,title,fields,text})。

import { describe, it, expect, vi, beforeEach } from "vitest";

const writeTools = require("../src/ai/tools/write-tools");
const readTools = require("../src/ai/tools/read-tools");
const { NotionAPI } = require("../src/api");
const { OperationGuard } = require("../src/security");
const { getAI, getState } = require("../src/ai/deps");

const CFG = { notionApiKey: "k", aiApiKey: "a", notionDatabaseId: "db1" };

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(getState(), "updateLastMessage").mockImplementation(() => {});
    // _executeGuardedPageWrite / _executeGuardedWrite 透传执行(测编排不重复测 Guard)
    vi.spyOn(getAI(), "_executeGuardedPageWrite").mockImplementation(async (op, target, executor) => executor());
    vi.spyOn(getAI(), "_executeGuardedWrite").mockImplementation(async (op, executor) => executor());
});

// ============ write-tools.append_content ============
describe("深度: write-tools.append_content", () => {
    it("happy: resolvePage → appendPageMarkdown → assistant_result", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ id: "p1", name: "T1" });
        const apiSpy = vi.spyOn(NotionAPI, "appendPageMarkdown").mockResolvedValue({});
        const r = await writeTools.append_content.execute({ page_name: "T1", content: "# hi" }, CFG);
        expect(apiSpy).toHaveBeenCalledWith("p1", "# hi", "k");
        expect(r.type).toBe("assistant_result");
        expect(String(r?.text ?? r)).toContain("页面内容追加完成");
    });
    it("fallback: appendPageMarkdown 失败 → 回退 _textToBlocks+appendBlocks", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ id: "p1", name: "T1" });
        vi.spyOn(NotionAPI, "appendPageMarkdown").mockRejectedValue(new Error("md fail"));
        const tbSpy = vi.spyOn(getAI(), "_textToBlocks").mockReturnValue([{ type: "paragraph" }]);
        const abSpy = vi.spyOn(NotionAPI, "appendBlocks").mockResolvedValue({});
        const r = await writeTools.append_content.execute({ page_name: "T1", content: "x" }, CFG);
        expect(tbSpy).toHaveBeenCalledWith("x");
        expect(abSpy).toHaveBeenCalledWith("p1", [{ type: "paragraph" }], "k");
        expect(String(r?.text ?? r)).toContain("追加完成");
    });
    it("error: _resolvePageId 返回 {error} → 透传错误", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ error: "解析失败" });
        const r = await writeTools.append_content.execute({ page_name: "x", content: "c" }, CFG);
        expect(String(r?.text ?? r)).toContain("解析失败");
    });
    it("error: 页面不存在 → 找不到页面", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue(null);
        const r = await writeTools.append_content.execute({ page_name: "无", content: "c" }, CFG);
        expect(String(r?.text ?? r)).toContain("找不到页面");
    });
});

// ============ write-tools.append_block_children ============
describe("深度: write-tools.append_block_children", () => {
    it("happy: block_id 直给 → appendBlockChildren 末尾插入", async () => {
        const tbSpy = vi.spyOn(getAI(), "_textToBlocks").mockReturnValue([{ type: "paragraph" }]);
        const apiSpy = vi.spyOn(NotionAPI, "appendBlockChildren").mockResolvedValue({});
        const r = await writeTools.append_block_children.execute({ content: "x", block_id: "b1" }, CFG);
        expect(apiSpy).toHaveBeenCalled();
        expect(String(r?.text ?? r)).toContain("块插入完成");
    });
    it("resolve-error: page_name 解析失败 → 透传", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ error: "页错" });
        const r = await writeTools.append_block_children.execute({ content: "x", page_name: "P" }, CFG);
        expect(String(r?.text ?? r)).toContain("页错");
    });
});

// ============ write-tools.replace_page_markdown ============
describe("深度: write-tools.replace_page_markdown", () => {
    it("happy: resolvePage + replacePageMarkdown → assistant_result", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ id: "p1", name: "T1" });
        const apiSpy = vi.spyOn(NotionAPI, "replacePageMarkdown").mockResolvedValue({});
        const r = await writeTools.replace_page_markdown.execute({ page_name: "T1", new_markdown: "# n" }, CFG);
        expect(apiSpy).toHaveBeenCalled();
        expect(r.type).toBe("assistant_result");
    });
    it("error: _resolvePageId {error} → 透传", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ error: "错" });
        const r = await writeTools.replace_page_markdown.execute({ page_name: "x", new_markdown: "m" }, CFG);
        expect(String(r?.text ?? r)).toContain("错");
    });
});

// ============ read-tools.fetch_page_blocks / get_comment ============
describe("深度: read-tools", () => {
    it("fetch_page_blocks happy: resolvePage → _collectBlockTree → _formatBlockSummary", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ id: "p1", name: "T1" });
        vi.spyOn(getAI(), "_collectBlockTree").mockResolvedValue([{ type: "paragraph" }]);
        vi.spyOn(getAI(), "_formatBlockSummary").mockReturnValue("块摘要");
        const r = await readTools.fetch_page_blocks.execute({ page_name: "T1" }, CFG);
        expect(String(r?.text ?? r)).toContain("块摘要");
    });
    it("fetch_page_blocks resolve-error → 透传", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ error: "页错" });
        const r = await readTools.fetch_page_blocks.execute({ page_name: "x" }, CFG);
        expect(String(r?.text ?? r)).toContain("页错");
    });
    it("get_comment happy: getComment → _formatCommentSummary/_formatUserSummary", async () => {
        vi.spyOn(NotionAPI, "getComment").mockResolvedValue({ id: "c1", created_time: "t", rich_text: [{ plain_text: "评论" }], created_by: { name: "U" } });
        const r = await readTools.get_comment.execute({ comment_id: "c1" }, CFG);
        expect(String(r?.text ?? r)).toBeTruthy();
    });
});
