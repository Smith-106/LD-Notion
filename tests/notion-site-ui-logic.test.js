import { describe, it, expect, vi, beforeEach } from "vitest";

// notion-site-ui 在模块顶层解构 const { TargetState } = require("../auth")，
// 持有的是 TargetState 对象引用，因此 spy 该对象的方法会在运行时生效。
const auth = require("../src/auth");
const { TargetState } = auth;

const { NotionSiteUI } = require("../src/ui/notion-site-ui");

describe("AT-012: NotionSiteUI 纯逻辑 (ISS-014)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("getAITargetPageParentType", () => {
        it("string parent → 原值", () => {
            expect(NotionSiteUI.getAITargetPageParentType({ parent: "database_id" })).toBe("database_id");
        });
        it("object parent.type → 去空格值", () => {
            expect(NotionSiteUI.getAITargetPageParentType({ parent: { type: "  page_id  " } })).toBe("page_id");
        });
        it("缺省 → 空字符串", () => {
            expect(NotionSiteUI.getAITargetPageParentType({})).toBe("");
            expect(NotionSiteUI.getAITargetPageParentType(null)).toBe("");
        });
    });

    describe("getAITargetPageParentLabel", () => {
        const databases = [{ id: "db1", title: "我的数据库" }];
        const pages = [{ id: "pg1", title: "父页面" }];

        it("database_id + 有名字 → 「数据库名」内", () => {
            const label = NotionSiteUI.getAITargetPageParentLabel(
                { parent: "database_id", parentId: "db1" },
                { databases, pages }
            );
            expect(label).toBe("数据库「我的数据库」内");
        });

        it("database_id + 无匹配 → 数据库条目", () => {
            const label = NotionSiteUI.getAITargetPageParentLabel(
                { parent: "database_id", parentId: "unknown" },
                { databases, pages }
            );
            expect(label).toBe("数据库条目");
        });

        it("page_id + 有名字 → 「页面名」下", () => {
            const label = NotionSiteUI.getAITargetPageParentLabel(
                { parent: "page_id", parentId: "pg1" },
                { databases, pages }
            );
            expect(label).toBe("页面「父页面」下");
        });

        it("block_id → 块内页面", () => {
            expect(NotionSiteUI.getAITargetPageParentLabel({ parent: "block_id" }, {})).toBe("块内页面");
        });

        it("workspace → 工作区页面", () => {
            expect(NotionSiteUI.getAITargetPageParentLabel({ parent: "workspace" }, {})).toBe("工作区页面");
        });

        it("未知类型 → 非顶级页面", () => {
            expect(NotionSiteUI.getAITargetPageParentLabel({ parent: "weird" }, {})).toBe("非顶级页面");
        });

        it("无 parent → 空", () => {
            expect(NotionSiteUI.getAITargetPageParentLabel({}, {})).toBe("");
        });
    });

    describe("getAITargetPageOptionLabel", () => {
        const databases = [{ id: "db1", title: "DB" }];
        const pages = [{ id: "pg1", title: "P" }];

        it("缺标题 → 未命名页面", () => {
            expect(NotionSiteUI.getAITargetPageOptionLabel({}, {})).toBe("↳ 未命名页面");
        });

        it("workspace 类型 → 📄 前缀且忽略 parentLabel", () => {
            const page = { title: "首页", parent: "workspace" };
            expect(NotionSiteUI.getAITargetPageOptionLabel(page, { includeParentLabel: true, databases, pages }))
                .toBe("📄 首页");
        });

        it("非 workspace + includeParentLabel → 追加父级标注", () => {
            const page = { title: "子页", parent: "page_id", parentId: "pg1" };
            expect(NotionSiteUI.getAITargetPageOptionLabel(page, { includeParentLabel: true, databases, pages }))
                .toBe("↳ 子页（页面「P」下）");
        });

        it("非 workspace + 不 includeParentLabel → 不追加", () => {
            const page = { title: "子页", parent: "page_id", parentId: "pg1" };
            expect(NotionSiteUI.getAITargetPageOptionLabel(page, { includeParentLabel: false, databases, pages }))
                .toBe("↳ 子页");
        });
    });

    describe("getAITargetDefaultOptionLabel", () => {
        it("未设置导出数据库 → 默认提示", () => {
            vi.spyOn(TargetState, "getEffectiveAITargetState").mockReturnValue({ mode: "none", databaseId: null });
            expect(NotionSiteUI.getAITargetDefaultOptionLabel([])).toBe("默认（未设置导出数据库）");
        });

        it("跟随导出数据库且有匹配 → 显示数据库名", () => {
            vi.spyOn(TargetState, "getEffectiveAITargetState").mockReturnValue({ mode: "database", databaseId: "db-abc123" });
            const label = NotionSiteUI.getAITargetDefaultOptionLabel([{ id: "db-abc123", title: "收藏库" }]);
            expect(label).toBe("默认（跟随导出数据库：收藏库）");
        });

        it("跟随导出数据库但无匹配 → 显示截断 ID", () => {
            vi.spyOn(TargetState, "getEffectiveAITargetState").mockReturnValue({ mode: "database", databaseId: "db-abcdefghij" });
            const label = NotionSiteUI.getAITargetDefaultOptionLabel([]);
            expect(label).toBe("默认（跟随导出数据库：ID: db-abcde...）");
        });
    });

    describe("getAITargetCompatibilityOptionLabel", () => {
        it("空 savedValue → 空", () => {
            expect(NotionSiteUI.getAITargetCompatibilityOptionLabel("", {})).toBe("");
        });

        it("page 模式且列表内有匹配 → 已保存标注", () => {
            vi.spyOn(TargetState, "parseAITarget").mockReturnValue({ mode: "page", pageId: "pg-1" });
            const label = NotionSiteUI.getAITargetCompatibilityOptionLabel(
                "page:pg-1",
                { pages: [{ id: "pg-1", title: "已存页", parent: "workspace" }] }
            );
            expect(label).toContain("已保存");
            expect(label).toContain("已存页");
        });

        it("page 模式且列表外 → 显示截断 ID", () => {
            vi.spyOn(TargetState, "parseAITarget").mockReturnValue({ mode: "page", pageId: "pg-outside99" });
            const label = NotionSiteUI.getAITargetCompatibilityOptionLabel("page:pg-outside99", { pages: [] });
            expect(label).toContain("当前列表之外");
            expect(label).toContain("pg-outsi...");
        });

        it("database 模式且列表内有匹配 → 📁 已保存", () => {
            vi.spyOn(TargetState, "parseAITarget").mockReturnValue({ mode: "database", databaseId: "db-x" });
            const label = NotionSiteUI.getAITargetCompatibilityOptionLabel(
                "db:db-x",
                { databases: [{ id: "db-x", title: "知识库" }] }
            );
            expect(label).toBe("📁 知识库（已保存）");
        });

        it("未知模式 → 通用已保存目标", () => {
            vi.spyOn(TargetState, "parseAITarget").mockReturnValue({ mode: "unknown", pageId: null, databaseId: null });
            const label = NotionSiteUI.getAITargetCompatibilityOptionLabel("garbage-value", {});
            expect(label).toContain("已保存目标");
            expect(label).toContain("garbage-...");
        });
    });
});
