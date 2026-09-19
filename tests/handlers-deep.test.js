// ISS-20260914-003 深度行为测试 —— ai/handlers 正向/边界/异常路径。
// 契约模板( spec:project:coding-conventions-017 ): deps.js getter 注入 stub +
// NotionAPI 模块 vi.spyOn; 断言输出结构 + 副作用(调用次数/参数形状);
// 每 handler ≥ happy path + empty input + error propagation。
//
// 关键 stub 机制:
//  - NotionAPI 是模块对象 → vi.spyOn(NotionAPI, "method")
//  - state()/svc()/AI()/getClassifier() 经 deps.js 返回真实单例 → spyOn 其方法
//  - OperationGuard 级别经 setLevel 写 GM mock(setup.js beforeEach gmStore.clear 复位)
//  - handlers 返回裸字符串(不经 AGENT_TOOLS 归一化), 直接 String(r) 断言

import { describe, it, expect, vi, beforeEach } from "vitest";

const query = require("../src/ai/handlers/query");
const batch = require("../src/ai/handlers/batch");
const pageCrud = require("../src/ai/handlers/pageCrud");
const { NotionAPI } = require("../src/api");
const { OperationGuard } = require("../src/security");
const { getAI, getState, getService, getClassifier } = require("../src/ai/deps");

const CFG = { notionApiKey: "k", aiApiKey: "a", notionDatabaseId: "db1" };

// props 进 properties, rest(如 parent/id) 提升顶层
const page = (props = {}, rest = {}) => ({
    id: "p1",
    url: "https://notion.so/p1",
    object: "page",
    parent: { database_id: "db1" },
    ...rest,
    properties: {
        "标题": { title: [{ plain_text: "T1" }] },
        "作者": { rich_text: [{ plain_text: "A1" }] },
        "AI分类": { select: { name: null } },
        ...props,
    },
});

let st, upSpy;
beforeEach(() => {
    vi.restoreAllMocks();
    st = getState();
    upSpy = vi.spyOn(st, "updateLastMessage").mockImplementation(() => {});
});

// ============ query.handleQuery ============
describe("深度: query.handleQuery", () => {
    it("happy: 查询返回统计/列表(分类关键词走聚合, 否则列表)", async () => {
        vi.spyOn(NotionAPI, "queryDatabase").mockResolvedValue({
            results: [page({ "AI分类": { select: { name: "技术" } } }), page(), page()],
            has_more: false, next_cursor: null,
        });
        const listR = await query.handleQuery({ limit: 5 }, CFG);
        expect(String(listR)).toContain("查询结果");
        expect(String(listR)).toContain("3");

        const statR = await query.handleQuery({ limit: 5, keyword: "统计分类" }, CFG);
        expect(String(statR)).toContain("分类统计");
    });
    it("empty: 无结果 → 📊 没有找到符合条件的帖子", async () => {
        vi.spyOn(NotionAPI, "queryDatabase").mockResolvedValue({ results: [], has_more: false, next_cursor: null });
        const r = await query.handleQuery({}, CFG);
        expect(String(r)).toContain("没有找到符合条件的帖子");
    });
    it("error: NotionAPI 抛错 → ❌ 查询失败", async () => {
        vi.spyOn(NotionAPI, "queryDatabase").mockRejectedValue(new Error("rate limited"));
        const r = await query.handleQuery({}, CFG);
        expect(String(r)).toContain("查询失败");
    });
    it("filter: filter_field+filter_value 构造 select/multi_select/rich_text 过滤器", async () => {
        const spy = vi.spyOn(NotionAPI, "queryDatabase").mockResolvedValue({ results: [], has_more: false, next_cursor: null });
        await query.handleQuery({ filter_field: "AI分类", filter_value: "技术" }, CFG);
        const filter = spy.mock.calls[0][1];
        expect(filter).toEqual({ property: "AI分类", select: { equals: "技术" } });
    });
});

// ============ query.handleSearch ============
describe("深度: query.handleSearch", () => {
    it("happy: 命中当前库页面 → 列出标题", async () => {
        vi.spyOn(NotionAPI, "search").mockResolvedValue({ results: [page()], has_more: false, next_cursor: null });
        const r = await query.handleSearch({ keyword: "技术" }, CFG);
        expect(String(r)).toContain("搜索结果");
        expect(String(r)).toContain("技术");
    });
    it("empty: 无匹配 → 🔍 没有找到", async () => {
        vi.spyOn(NotionAPI, "search").mockResolvedValue({ results: [], has_more: false, next_cursor: null });
        const r = await query.handleSearch({ keyword: "xyz" }, CFG);
        expect(String(r)).toContain("没有找到包含");
    });
    it("empty: 缺 keyword → 提示输入关键词", async () => {
        const r = await query.handleSearch({}, CFG);
        expect(String(r)).toContain("搜索什么关键词");
    });
    it("filter: 仅返回 parent.database_id 匹配的页(跨库结果剔除)", async () => {
        vi.spyOn(NotionAPI, "search").mockResolvedValue({
            results: [page(), page({}, { parent: { database_id: "other-db" } })],
            has_more: false, next_cursor: null,
        });
        const r = await query.handleSearch({ keyword: "k" }, CFG);
        expect(String(r)).toContain("找到 **1** 个");
    });
    it("error: NotionAPI.search 抛错 → ❌ 搜索失败", async () => {
        vi.spyOn(NotionAPI, "search").mockRejectedValue(new Error("net"));
        const r = await query.handleSearch({ keyword: "k" }, CFG);
        expect(String(r)).toContain("搜索失败");
    });
});

// ============ query.handleWorkspaceSearch ============
describe("深度: query.handleWorkspaceSearch", () => {
    it("happy: 分页聚合 + page/database 分类", async () => {
        vi.spyOn(NotionAPI, "search").mockResolvedValue({
            results: [page(), { object: "database", id: "d2", url: "u", title: [{ plain_text: "DB" }] }],
            has_more: false, next_cursor: null,
        });
        const r = await query.handleWorkspaceSearch({ keyword: "x" }, CFG);
        expect(String(r)).toContain("工作区搜索");
    });
    it("empty: 无结果 → 🌐 没有找到", async () => {
        vi.spyOn(NotionAPI, "search").mockResolvedValue({ results: [], has_more: false, next_cursor: null });
        const r = await query.handleWorkspaceSearch({ keyword: "none", object_type: "page" }, CFG);
        expect(String(r)).toContain("没有找到包含");
    });
    it("truncated: has_more+空 cursor → 标记截断提示", async () => {
        vi.spyOn(NotionAPI, "search").mockResolvedValue({ results: [page()], has_more: true, next_cursor: null });
        const r = await query.handleWorkspaceSearch({ keyword: "x" }, CFG);
        expect(String(r)).toContain("分页上限");
    });
});

// ============ batch.handleBatchClassify ============
describe("深度: batch.handleBatchClassify", () => {
    const cats = { ...CFG, categories: ["技术", "生活"] };
    it("empty: 数据库无页面 → 📭", async () => {
        const c = getClassifier();
        vi.spyOn(c, "reset").mockImplementation(() => {});
        vi.spyOn(c, "ensureAICategoryProperty").mockResolvedValue(undefined);
        vi.spyOn(c, "fetchAllPages").mockResolvedValue([]);
        const r = await batch.handleBatchClassify({}, cats);
        expect(String(r)).toContain("没有找到任何页面");
    });
    it("all classified: 全部已分类 → ✅ 所有 N 个页面都已分类", async () => {
        const c = getClassifier();
        vi.spyOn(c, "reset").mockImplementation(() => {});
        vi.spyOn(c, "ensureAICategoryProperty").mockResolvedValue(undefined);
        vi.spyOn(c, "fetchAllPages").mockResolvedValue([page({ "AI分类": { select: { name: "技术" } } })]);
        const r = await batch.handleBatchClassify({}, cats);
        expect(String(r)).toContain("都已分类完成");
    });
    it("happy: 未分类页逐条 classifyPage → ✅ 批量分类完成", async () => {
        const c = getClassifier();
        vi.spyOn(c, "reset").mockImplementation(() => {});
        vi.spyOn(c, "ensureAICategoryProperty").mockResolvedValue(undefined);
        vi.spyOn(c, "fetchAllPages").mockResolvedValue([page(), page()]);
        vi.spyOn(c, "getPageTitle").mockReturnValue("T");
        const clsSpy = vi.spyOn(c, "classifyPage").mockResolvedValue(undefined);
        const r = await batch.handleBatchClassify({}, cats);
        expect(clsSpy).toHaveBeenCalledTimes(2);
        expect(String(r)).toContain("批量分类完成");
        expect(String(r)).toContain("本次分类: 2");
    });
    it("partial-fail: classifyPage 抛错 → 计入 failed", async () => {
        const c = getClassifier();
        vi.spyOn(c, "reset").mockImplementation(() => {});
        vi.spyOn(c, "ensureAICategoryProperty").mockResolvedValue(undefined);
        vi.spyOn(c, "fetchAllPages").mockResolvedValue([page(), page()]);
        vi.spyOn(c, "getPageTitle").mockReturnValue("T");
        vi.spyOn(c, "classifyPage").mockRejectedValueOnce(new Error("ai err")).mockResolvedValueOnce(undefined);
        const r = await batch.handleBatchClassify({}, cats);
        expect(String(r)).toContain("失败: 1");
    });
    it("cancelled: isCancelled → ⏹️ 已取消", async () => {
        const c = getClassifier();
        vi.spyOn(c, "reset").mockImplementation(() => {});
        vi.spyOn(c, "ensureAICategoryProperty").mockResolvedValue(undefined);
        vi.spyOn(c, "fetchAllPages").mockResolvedValue([page()]);
        vi.spyOn(c, "getPageTitle").mockReturnValue("T");
        Object.defineProperty(c, "isCancelled", { get: () => true, configurable: true });
        vi.spyOn(c, "classifyPage").mockResolvedValue(undefined);
        const r = await batch.handleBatchClassify({}, cats);
        expect(String(r)).toContain("已取消");
    });
});

// ============ pageCrud.handleUpdate ============
describe("深度: pageCrud.handleUpdate", () => {
    it("empty: _resolvePageTargets 空 → ❌ 没有找到可更新的页面", async () => {
        vi.spyOn(getAI(), "_resolvePageTargets").mockResolvedValue([]);
        const r = await pageCrud.handleUpdate({ page_name: "x" }, CFG);
        expect(String(r)).toContain("没有找到可更新的页面");
    });
    it("ambiguous: 单 page_name 命中多页 → ❌ 找到多个页面", async () => {
        vi.spyOn(getAI(), "_resolvePageTargets").mockResolvedValue([{ id: "p1", name: "A" }, { id: "p2", name: "B" }]);
        const r = await pageCrud.handleUpdate({ page_name: "x" }, CFG);
        expect(String(r)).toContain("找到多个页面");
    });
    it("happy: 单目标成功 → ✅ 已更新页面", async () => {
        vi.spyOn(getAI(), "_resolvePageTargets").mockResolvedValue([{ id: "p1", name: "T1" }]);
        vi.spyOn(getAI(), "_applyPageUpdatesToTargets").mockResolvedValue({ success: 1, failed: 0 });
        const r = await pageCrud.handleUpdate({ page_name: "x" }, CFG);
        expect(String(r)).toContain("已更新页面");
    });
    it("batch: 显式批量 → ✅ 批量更新完成", async () => {
        vi.spyOn(getAI(), "_resolvePageTargets").mockResolvedValue([{ id: "p1", name: "A" }, { id: "p2", name: "B" }]);
        vi.spyOn(getAI(), "_applyPageUpdatesToTargets").mockResolvedValue({ success: 2, failed: 0 });
        const r = await pageCrud.handleUpdate({ page_ids: ["p1", "p2"], batch: true }, CFG);
        expect(String(r)).toContain("批量更新完成");
    });
    it("error: _resolvePageTargets 返回 {error} → ❌", async () => {
        vi.spyOn(getAI(), "_resolvePageTargets").mockResolvedValue({ error: "解析失败" });
        const r = await pageCrud.handleUpdate({ page_name: "x" }, CFG);
        expect(String(r)).toContain("解析失败");
    });
});

// ============ pageCrud.handleCopy ============
describe("深度: pageCrud.handleCopy", () => {
    beforeEach(() => OperationGuard.setLevel(2)); // duplicatePage 需高级
    it("empty: 无目标库 → ❌ 找不到目标数据库", async () => {
        vi.spyOn(getAI(), "_resolveDatabaseId")
            .mockResolvedValueOnce({ id: "src1", name: "源" })
            .mockResolvedValueOnce(null);
        const r = await pageCrud.handleCopy({ source_database_id: "src1", target_database_name: "无" }, CFG);
        expect(String(r)).toContain("找不到目标数据库");
    });
    it("same-db: 源=目标 → ❌ 无需复制", async () => {
        vi.spyOn(getAI(), "_resolveDatabaseId").mockResolvedValue({ id: "same", name: "S" });
        const r = await pageCrud.handleCopy({ source_database_id: "same", target_database_id: "same" }, CFG);
        expect(String(r)).toContain("源数据库和目标数据库相同");
    });
    it("empty: 源库无页面 → 📭", async () => {
        vi.spyOn(getAI(), "_resolveDatabaseId")
            .mockResolvedValueOnce({ id: "src1", name: "源" })
            .mockResolvedValueOnce({ id: "dst1", name: "目" });
        vi.spyOn(getAI(), "_fetchSourcePages").mockResolvedValue([]);
        const r = await pageCrud.handleCopy({ source_database_id: "src1", target_database_id: "dst1" }, CFG);
        expect(String(r)).toContain("没有页面");
    });
    it("happy: 逐页 duplicatePage → ✅ 复制完成", async () => {
        vi.spyOn(getAI(), "_resolveDatabaseId")
            .mockResolvedValueOnce({ id: "src1", name: "源" })
            .mockResolvedValueOnce({ id: "dst1", name: "目" });
        vi.spyOn(getAI(), "_fetchSourcePages").mockResolvedValue([page(), page()]);
        const wSpy = vi.spyOn(getAI(), "_executeGuardedPageWrite").mockResolvedValue({});
        const r = await pageCrud.handleCopy({ source_database_id: "src1", target_database_id: "dst1" }, CFG);
        expect(wSpy).toHaveBeenCalledTimes(2);
        expect(String(r)).toContain("复制完成");
        expect(String(r)).toContain("成功: 2");
    });
});

// ============ pageCrud.handleCreateDatabase ============
describe("深度: pageCrud.handleCreateDatabase", () => {
    beforeEach(() => OperationGuard.setLevel(2)); // createDatabase 需高级
    it("empty: 缺 database_name → ❌ 请指定", async () => {
        const r = await pageCrud.handleCreateDatabase({}, CFG);
        expect(String(r)).toContain("请指定要创建的数据库名称");
    });
    it("empty: 未指定父页面且工作区无页面 → ❌ 没有可用父页面", async () => {
        vi.spyOn(NotionAPI, "search").mockResolvedValue({ results: [], has_more: false, next_cursor: null });
        const r = await pageCrud.handleCreateDatabase({ database_name: "DB" }, CFG);
        expect(String(r)).toContain("没有找到可用的页面作为父页面");
    });
    it("happy: 指定父页面 + createDatabase → ✅ 数据库创建成功", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ id: "pp1", name: "父页" });
        vi.spyOn(getAI(), "_executeGuardedWrite").mockResolvedValue({ id: "newdb123" });
        const r = await pageCrud.handleCreateDatabase({ database_name: "DB", parent_page_id: "pp1" }, CFG);
        expect(String(r)).toContain("数据库创建成功");
        expect(String(r)).toContain("DB");
    });
    it("error: _executeGuardedWrite 抛错 → ❌ 创建数据库失败", async () => {
        vi.spyOn(getAI(), "_resolvePageId").mockResolvedValue({ id: "pp1", name: "父页" });
        vi.spyOn(getAI(), "_executeGuardedWrite").mockRejectedValue(new Error("forbidden"));
        const r = await pageCrud.handleCreateDatabase({ database_name: "DB", parent_page_id: "pp1" }, CFG);
        expect(String(r)).toContain("创建数据库失败");
    });
});
