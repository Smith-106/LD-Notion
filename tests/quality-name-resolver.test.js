import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3-r3 (AT-014, L2): NameResolver 名称→ID 解析(三段优先级)。
// 断言面: id 直传(不发请求) / refId 提取 / 搜索精确/单一模糊/多模糊 error/零命中 null /
//         page 分支 archived 过滤。
// 夹具契约: stub NotionAPI.search; afterEach 还原。
const { NameResolver } = require("../src/ai/NameResolver");
const { NotionAPI } = require("../src/api");

const db = (id, title) => ({ id, title: title ? [{ plain_text: title }] : [] });
const page = (id, title, archived = false) => ({
    id,
    archived,
    properties: { 标题: { title: [{ plain_text: title }] } },
});

describe("AT-014: NameResolver 名称→ID 解析", () => {
    const saved = {};
    let searchCalls;

    beforeEach(() => {
        searchCalls = [];
        saved.search = NotionAPI.search;
        saved.getPageTitle = require("../src/utils").Utils.getPageTitle;
        NotionAPI.search = async (query, filter, apiKey) => {
            searchCalls.push({ query, filter });
            return { results: [] };
        };
    });

    afterEach(() => {
        NotionAPI.search = saved.search;
        require("../src/utils").Utils.getPageTitle = saved.getPageTitle;
    });

    it("id 直传: 归一化且不发请求", async () => {
        const r = await NameResolver.resolveDatabaseId("我的库", "12345678-1234-1234-1234-123456789abc", "k");
        expect(r.id).toBe("12345678123412341234123456789abc");
        expect(r.name).toBe("我的库");
        expect(searchCalls.length).toBe(0);
    });

    it("name 含 Notion URL/ID: refId 提取不发请求", async () => {
        const r = await NameResolver.resolveDatabaseId(
            "https://www.notion.so/abcdef01abcdef01abcdef01abcdef01",
            undefined,
            "k"
        );
        expect(r.id).toBe("abcdef01abcdef01abcdef01abcdef01");
        expect(searchCalls.length).toBe(0);
    });

    it("无 name 无 id: null", async () => {
        expect(await NameResolver.resolveDatabaseId(undefined, undefined, "k")).toBeNull();
        expect(searchCalls.length).toBe(0);
    });

    it("搜索: 精确命中优先, id 去横线", async () => {
        NotionAPI.search = async (query, filter) => {
            searchCalls.push({ query, filter });
            return { results: [db("11111111-2222-3333-4444-555555555555", "我的库"), db("99999999-9999-9999-9999-999999999999", "我的库备用")] };
        };
        const r = await NameResolver.resolveDatabaseId("我的库", undefined, "k");
        expect(r).toEqual({ id: "11111111222233334444555555555555", name: "我的库" });
        expect(searchCalls[0].filter).toEqual({ property: "object", value: "database" });
    });

    it("搜索: 单一模糊命中采纳", async () => {
        NotionAPI.search = async () => ({ results: [db("12121212-1212-1212-1212-121212121212", "我的工作库")] });
        const r = await NameResolver.resolveDatabaseId("工作库", undefined, "k");
        expect(r.id).toBe("12121212121212121212121212121212");
    });

    it("搜索: 多模糊命中返回 error 防误操作", async () => {
        NotionAPI.search = async () => ({
            results: [db("11111111-1111-1111-1111-111111111111", "工作库A"), db("22222222-2222-2222-2222-222222222222", "工作库B")],
        });
        const r = await NameResolver.resolveDatabaseId("工作库", undefined, "k");
        expect(r.error).toContain("找到多个匹配的数据库");
        expect(r.error).toContain("工作库A");
    });

    it("搜索: 零命中返回 null", async () => {
        const r = await NameResolver.resolveDatabaseId("不存在的库", undefined, "k");
        expect(r).toBeNull();
    });

    it("page 分支: archived 过滤 + 精确匹配", async () => {
        NotionAPI.search = async (query, filter) => {
            searchCalls.push({ query, filter });
            return { results: [
                page("aaaaaaaa-1111-1111-1111-111111111111", "目标页", true),
                page("bbbbbbbb-2222-2222-2222-222222222222", "目标页"),
            ] };
        };
        const r = await NameResolver.resolvePageId("目标页", undefined, "k");
        expect(r.id).toBe("bbbbbbbb222222222222222222222222");
        expect(searchCalls[0].filter).toEqual({ property: "object", value: "page" });
    });

    it("page 分支: 多模糊命中 error", async () => {
        NotionAPI.search = async () => ({
            results: [page("aaaaaaaa-1111-1111-1111-111111111111", "目标页A"), page("bbbbbbbb-2222-2222-2222-222222222222", "目标页B")],
        });
        const r = await NameResolver.resolvePageId("目标页", undefined, "k");
        expect(r.error).toContain("找到多个匹配的页面");
    });
});
