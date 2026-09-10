import { describe, it, expect, beforeEach, afterEach } from "vitest";

// P4 第二批回归: batch handler 边界(分页可见性/逐页隔离/参数隔离/children 上限/错误计数/库名优先)
const { AIHandlers, AIAssistant, AIService, ChatState } = require("../src/ai/index.js");
const { NotionAPI } = require("../src/api");
const { OperationGuard, ConfirmationDialog } = require("../src/security");
const { GitHubExporter, GitHubAPI } = require("../src/import");
const { Utils } = require("../src/utils");

describe("P4: batch handler 边界", () => {
    const saved = {};

    beforeEach(() => {
        saved.checkConfig = AIAssistant.checkConfig;
        saved.canExecute = OperationGuard.canExecute;
        saved.updateLastMessage = ChatState.updateLastMessage;
        saved.confirm = ConfirmationDialog.show;
        saved.requestChat = AIService.requestChat;
        saved.queryDatabase = NotionAPI.queryDatabase;
        saved.search = NotionAPI.search;
        saved.executeGuardedPageWrite = AIAssistant._executeGuardedPageWrite;
        saved.textToBlocks = AIAssistant._textToBlocks;
        saved.extractPageContent = AIAssistant._extractPageContent;
        saved.isolateContent = AIAssistant.isolateContent;
        saved.createPageInPage = NotionAPI.createPageInPage;
        saved.appendBlocks = NotionAPI.appendBlocks;
        saved.exportAll = GitHubExporter.exportAll;
        saved.getImportTypes = GitHubAPI.getImportTypes;

        AIAssistant.checkConfig = () => ({ valid: true });
        OperationGuard.canExecute = () => true;
        ChatState.updateLastMessage = () => {};
        AIAssistant.isolateContent = (text) => text;
    });

    afterEach(() => {
        AIAssistant.checkConfig = saved.checkConfig;
        OperationGuard.canExecute = saved.canExecute;
        ChatState.updateLastMessage = saved.updateLastMessage;
        ConfirmationDialog.show = saved.confirm;
        AIService.requestChat = saved.requestChat;
        NotionAPI.queryDatabase = saved.queryDatabase;
        NotionAPI.search = saved.search;
        AIAssistant._executeGuardedPageWrite = saved.executeGuardedPageWrite;
        AIAssistant._textToBlocks = saved.textToBlocks;
        AIAssistant._extractPageContent = saved.extractPageContent;
        AIAssistant.isolateContent = saved.isolateContent;
        NotionAPI.createPageInPage = saved.createPageInPage;
        NotionAPI.appendBlocks = saved.appendBlocks;
        GitHubExporter.exportAll = saved.exportAll;
        GitHubAPI.getImportTypes = saved.getImportTypes;
    });

    it("批量翻译在结果截断时于确认框提示", async () => {
        let captured = "";
        ConfirmationDialog.show = async ({ message }) => { captured = message; return false; };
        NotionAPI.queryDatabase = async () => ({
            results: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, archived: false })),
            has_more: true,
            next_cursor: "c1",
        });

        const result = await AIHandlers.handleBatchTranslate({ database_id: "db1" }, { notionApiKey: "k" }, "");
        expect(result).toContain("已取消");
        expect(captured).toContain("仅处理前 20 个页面");
    });

    it("批量分析单页提取失败不中止整批", async () => {
        NotionAPI.queryDatabase = async () => ({
            results: [{ id: "p1", archived: false }, { id: "p2", archived: false }],
            has_more: false,
        });
        AIAssistant._extractPageContent = async (pageId) => {
            if (pageId === "p1") throw new Error("timeout");
            return "内容";
        };
        AIService.requestChat = async () => "报告正文";

        const result = await AIHandlers.handleBatchAnalyze({ database_id: "db1" }, { notionApiKey: "k" }, "");
        expect(result).toContain("批量分析报告");
        expect(result).toContain("共分析 2 个页面");
    });

    it("显式 database_name 优先于默认数据库 ID", async () => {
        const searched = [];
        const queried = [];
        NotionAPI.search = async (name) => {
            searched.push(name);
            return { results: [{ id: "named-db", archived: false }] };
        };
        NotionAPI.queryDatabase = async (dbId) => { queried.push(dbId); return { results: [], has_more: false }; };

        const result = await AIHandlers.handleBatchAnalyze(
            { database_name: "指定库" },
            { notionApiKey: "k", notionDatabaseId: "default-db" },
            ""
        );
        expect(searched).toEqual(["指定库"]);
        expect(queried).toEqual(["named-db"]);
        expect(result).toContain("没有可分析的页面");
    });

    it("handleGeneratePages 超过 20 个子页面时截断并告知", async () => {
        // P4 收敛(c02): 子页面循环新增 REQUEST_DELAY 节流 —— 实际等待无意义,
        // 拦截 sleep 并验证节流确实发生(而非把节流改掉给测试让路)
        const delays = [];
        const origSleep = Utils.sleep;
        Utils.sleep = async (ms) => { delays.push(ms); };
        try {
        const children = Array.from({ length: 25 }, (_, i) => ({ title: `T${i}`, description: "d", icon: "📄" }));
        AIService.requestChat = async (prompt) => (prompt.includes("内容架构师")
            ? JSON.stringify({ parent_title: "P", parent_summary: "s", children })
            : "正文");
        ConfirmationDialog.show = async () => true;
        AIAssistant._executeGuardedPageWrite = async (op, target, fn) => fn();
        AIAssistant._textToBlocks = () => [];
        NotionAPI.createPageInPage = async () => ({ id: "child-1" });
        NotionAPI.appendBlocks = async () => ({});

        const result = await AIHandlers.handleGeneratePages({ page_name: "主题", parent_page_id: "parent-1" }, { notionApiKey: "k" }, "");
        expect(result).toContain("20/20");
        expect(result).toContain("已按上限 20 创建");
        // 19 次子页面之间的节流(上限 20 → 最后一次后不再等待)
        expect(delays.length).toBe(19);
        expect(delays.every((ms) => ms > 0)).toBe(true);
        } finally {
            Utils.sleep = origSleep;
        }
    });

    it("GitHub 导入各类型均报错时不显示已是最新状态", async () => {
        GitHubAPI.getImportTypes = () => ["stars"];
        GitHubExporter.exportAll = async () => ({ stars: { error: "token 无效" } });

        const result = await AIHandlers.handleGitHubImport(
            { username: "u" },
            { notionApiKey: "k", notionDatabaseId: "db" },
            ""
        );
        expect(result).toContain("❌ Stars: token 无效");
        expect(result).not.toContain("已是最新状态");
    });
});
