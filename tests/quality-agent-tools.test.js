import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3-r5 (AT-021/022/023, L2): ai/tools Agent 工具行为缝隙。
// 负集核实: tools 三件套此前仅 p4conv-round4 源码文本断言(结构) → 行为覆盖为零。
// 契约: ai/index.js 加载时原地包裹全部 AGENT_TOOLS.execute → 返回 assistant_result envelope
//       ({status, summary, text, fields, bullets}); 本文件顶部显式加载以使包裹确定性生效。
// 夹具契约: NotionAPI 属性 stub; Guard/TargetState/AIAssistant 真实链(updatePage level 1 默认通过)。
require("../src/ai");
const { NotionAPI } = require("../src/api");
const { update_page_property } = require("../src/ai/tools/write-tools");
const { search_workspace, query_database } = require("../src/ai/tools/read-tools");

const settings = { notionApiKey: "k", notionDatabaseId: "11111111-2222-3333-4444-555555555555" };
const mkPage = (id, title, cat) => ({
    id,
    properties: {
        标题: { title: [{ plain_text: title }] },
        ...(cat ? { AI分类: { select: { name: cat } } } : {}),
    },
});

describe("AT-021: update_page_property 参数守卫与类型分派", () => {
    const saved = {};
    let updateCalls;
    beforeEach(() => {
        updateCalls = [];
        saved.updatePage = NotionAPI.updatePage;
    });
    afterEach(() => {
        NotionAPI.updatePage = saved.updatePage;
    });
    const okUpdate = () => {
        NotionAPI.updatePage = async (...a) => {
            updateCalls.push(a);
            return {};
        };
    };

    it("缺参守卫: page_id/property/value 缺失 → error envelope 且零调用", async () => {
        okUpdate();
        expect((await update_page_property.execute({}, settings)).status).toBe("error");
        expect((await update_page_property.execute({}, settings)).text).toMatch(/page_id/);
        expect((await update_page_property.execute({ page_id: "p" }, settings)).text).toMatch(/property/);
        expect((await update_page_property.execute({ page_id: "p", property: "x" }, settings)).text).toMatch(/value/);
        expect(updateCalls.length).toBe(0);
    });

    it("保留键拒绝: constructor/__proto__/prototype → 属性名无效且零调用", async () => {
        okUpdate();
        for (const key of ["constructor", "__proto__", "prototype"]) {
            const r = await update_page_property.execute({ page_id: "p", property: key, value: "v" }, settings);
            expect(r.status).toBe("error");
            expect(r.text).toMatch(/属性名无效/);
        }
        expect(updateCalls.length).toBe(0);
    });

    it("类型分派: select/multi_select/date/text 各自 PATCH 形态正确", async () => {
        okUpdate();
        await update_page_property.execute({ page_id: "aabb", property: "状态", value: "Done", type: "select" }, settings);
        expect(updateCalls[0][1]).toEqual({ 状态: { select: { name: "Done" } } });
        await update_page_property.execute({ page_id: "aabb", property: "标签", value: "rust, go，web", type: "multi_select" }, settings);
        expect(updateCalls[1][1]).toEqual({ 标签: { multi_select: [{ name: "rust" }, { name: "go" }, { name: "web" }] } });
        await update_page_property.execute({ page_id: "aabb", property: "截止", value: "2026-09-14", type: "date" }, settings);
        expect(updateCalls[2][1]).toEqual({ 截止: { date: { start: "2026-09-14" } } });
        await update_page_property.execute({ page_id: "aabb", property: "备注", value: "hello" }, settings);
        expect(updateCalls[3][1]).toEqual({ 备注: { rich_text: [{ type: "text", text: { content: "hello" } }] } });
        expect(updateCalls[0][0]).toBe("aabb"); // id 去横线
    });

    it("number: NaN/Infinity 拒绝(NaN 会静默清空属性), 有限值通过", async () => {
        okUpdate();
        const r1 = await update_page_property.execute({ page_id: "p", property: "分", value: "abc", type: "number" }, settings);
        expect(r1.status).toBe("error");
        expect(r1.text).toMatch(/数字值/);
        const r2 = await update_page_property.execute({ page_id: "p", property: "分", value: Infinity, type: "number" }, settings);
        expect(r2.status).toBe("error");
        expect(updateCalls.length).toBe(0);
        await update_page_property.execute({ page_id: "p", property: "分", value: "42", type: "number" }, settings);
        expect(updateCalls[0][1]).toEqual({ 分: { number: 42 } });
    });

    it("成功路径: Guard 真实链 + success envelope 含属性与值", async () => {
        okUpdate();
        const r = await update_page_property.execute({ page_id: "aabb-cc", property: "状态", value: "Done", type: "select" }, settings);
        expect(r.status).toBe("success");
        expect(r.text).toContain("状态");
        expect(r.text).toContain("Done");
        expect(updateCalls.length).toBe(1);
    });
});

describe("AT-022: search_workspace 过滤构建与分页上限", () => {
    const saved = {};
    let searchCalls;
    beforeEach(() => {
        searchCalls = [];
        saved.search = NotionAPI.search;
    });
    afterEach(() => {
        NotionAPI.search = saved.search;
    });

    it("filter 构建: page/database/无 type", async () => {
        NotionAPI.search = async (query, filter) => {
            searchCalls.push(filter);
            return { results: [{ id: "x" }], has_more: false };
        };
        await search_workspace.execute({ query: "q", type: "page" }, settings);
        expect(searchCalls[0]).toEqual({ property: "object", value: "page" });
        await search_workspace.execute({ query: "q", type: "database" }, settings);
        expect(searchCalls[1]).toEqual({ property: "object", value: "database" });
        await search_workspace.execute({ query: "q" }, settings);
        expect(searchCalls[2]).toBeNull();
    });

    it("分页: 恒 has_more → 恰 10 次调用即止; 两页正常终止拼接", async () => {
        let page = 0;
        NotionAPI.search = async (query, filter, apiKey, cursor) => {
            searchCalls.push(cursor);
            page++;
            return { results: [{ id: `p${page}` }], has_more: true, next_cursor: `c${page}` };
        };
        const r = await search_workspace.execute({ query: "q" }, settings);
        expect(searchCalls.length).toBe(10); // 10 页硬上限
        expect(r.text).toContain("p10");
        searchCalls.length = 0;
        let n = 0;
        NotionAPI.search = async () => {
            n++;
            return { results: [{ id: `q${n}` }], has_more: n < 2, next_cursor: `c${n}` };
        };
        const r2 = await search_workspace.execute({ query: "q" }, settings);
        expect(n).toBe(2);
        expect(r2.text).toContain("q1");
        expect(r2.text).toContain("q2");
    });
});

describe("AT-023: query_database 筛选映射与排序回退", () => {
    const saved = {};
    let queryCalls;
    beforeEach(() => {
        queryCalls = [];
        saved.queryDatabase = NotionAPI.queryDatabase;
    });
    afterEach(() => {
        NotionAPI.queryDatabase = saved.queryDatabase;
    });
    const okQuery = (pages) => {
        NotionAPI.queryDatabase = async (dbId, filter, sorts) => {
            queryCalls.push({ filter, sorts });
            return { results: pages, has_more: false };
        };
    };

    it("筛选映射: 标签→multi_select contains; AI分类→select equals; 未知字段→rich_text contains", async () => {
        okQuery([]);
        await query_database.execute({ filter_field: "标签", filter_value: "rust" }, settings);
        expect(queryCalls[0].filter).toEqual({ property: "标签", multi_select: { contains: "rust" } });
        await query_database.execute({ filter_field: "AI分类", filter_value: "技术" }, settings);
        expect(queryCalls[1].filter).toEqual({ property: "AI分类", select: { equals: "技术" } });
        await query_database.execute({ filter_field: "自定义", filter_value: "x" }, settings);
        expect(queryCalls[2].filter).toEqual({ property: "自定义", rich_text: { contains: "x" } });
    });

    it("排序回退: 收藏时间排序失败 → created_time 降序重查, 结果仍聚合", async () => {
        let attempt = 0;
        NotionAPI.queryDatabase = async (dbId, filter, sorts) => {
            queryCalls.push(sorts);
            attempt++;
            if (attempt === 1) throw new Error("收藏时间属性不存在");
            return { results: [mkPage("aabb-ccdd-1111", "页A", "技术")], has_more: false };
        };
        const r = await query_database.execute({ filter_field: "", filter_value: "", limit: 10 }, settings);
        expect(queryCalls[0]).toEqual([{ property: "收藏时间", direction: "descending" }]);
        expect(queryCalls[1]).toEqual([{ timestamp: "created_time", direction: "descending" }]);
        expect(r.text).toContain("页A");
        expect(r.text).toContain("aabbccdd1111");
    });

    it("safeLimit 与输出契约: 负 limit→显示 0; 非有限→默认 10; 未分类统计", async () => {
        const pages = [mkPage("p1", "一"), mkPage("p2", "二", "技术"), mkPage("p3", "三")];
        okQuery(pages);
        const r0 = await query_database.execute({ limit: -5 }, settings);
        expect(r0.text).toContain("显示: 0");
        const r10 = await query_database.execute({ limit: "abc" }, settings);
        expect(r10.text).toContain("显示: 3");
        expect(r10.text).toContain("技术(1)");
        expect(r10.text).toContain("未分类(2)");
        expect(r10.text).toContain("总数: 3");
    });

    it("空结果: 无筛选 → empty envelope「数据库中没有页面」; 有筛选 → 没有找到匹配", async () => {
        okQuery([]);
        const r = await query_database.execute({}, settings);
        expect(r.status).toBe("empty");
        expect(r.text).toMatch(/没有页面/);
        const rf = await query_database.execute({ filter_field: "标签", filter_value: "rust" }, settings);
        expect(rf.text).toMatch(/没有找到匹配 标签="rust"/);
    });
});
