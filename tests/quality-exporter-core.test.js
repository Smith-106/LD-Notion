import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3-r2 (AT-011 L3 + AT-012 L1): Exporter 核心导出链路 + AI 降级契约。
// AT-011 断言面: fetchPosts→blocks→Guard(guarded-write)→API→markTopicExported→返回 page;
//                Guard 只读级拒绝时抛权限错误且不落账(认证/授权失败不写入)。
// AT-012 断言面: AI 失败不阻断(AI 失败回退 fallback 字段) + 成本闸门预占语义(aiUsedCount 失败也计 1)。
// 夹具契约: stub LinuxDoAPI.fetchAllPosts/Exporter.buildContentBlocks/NotionAPI.request;
//           filterPosts/GuardedWrite/OperationGuard/Storage 账本走真实; afterEach 还原。
const { Exporter, LinuxDoAPI } = require("../src/export");
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter");
const { NotionAPI } = require("../src/api");
const { OperationGuard } = require("../src/security");
const { Storage } = require("../src/storage");

describe("AT-011: Exporter.exportTopic 手动导出核心链路(Guard→API→落账)", () => {
    const saved = {};
    let pageCalls;

    beforeEach(() => {
        pageCalls = [];
        saved.fetchAllPosts = LinuxDoAPI.fetchAllPosts;
        saved.buildContentBlocks = Exporter.buildContentBlocks;
        saved.request = NotionAPI.request;
        saved.level = OperationGuard.getLevel();
        saved.markTopic = Storage.markTopicExported;
        saved.isTopic = Storage.isTopicExported;
        // Storage 主题账本为模块级缓存, 跨用例残留 → 每用例隔离新鲜账本
        const topicLedger = {};
        Storage.markTopicExported = (id) => { topicLedger[id] = true; };
        Storage.isTopicExported = (id) => !!topicLedger[id];
        LinuxDoAPI.fetchAllPosts = async () => ({
            topic: { id: "77", title: "测试帖", created_at: "2026-01-01T00:00:00.000Z" },
            posts: [{ cooked: "<p>正文</p>", username: "u1", created_at: "2026-01-01T00:01:00.000Z", post_number: 1 }],
        });
        Exporter.buildContentBlocks = () => [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: "正文" } }] } }];
        NotionAPI.request = async (method, endpoint, data) => {
            pageCalls.push({ method, endpoint, data });
            return { id: "p-export-1" };
        };
    });

    afterEach(() => {
        LinuxDoAPI.fetchAllPosts = saved.fetchAllPosts;
        Exporter.buildContentBlocks = saved.buildContentBlocks;
        NotionAPI.request = saved.request;
        OperationGuard.setLevel(saved.level);
        Storage.markTopicExported = saved.markTopic;
        Storage.isTopicExported = saved.isTopic;
    });

    it("database 目标: 创建页面→markTopicExported→返回 page", async () => {
        const settings = { apiKey: "k", databaseId: "db-1", exportTargetType: "database", imgMode: "link" };
        const page = await Exporter.exportTopic({ topic_id: "77", title: "测试帖" }, settings);
        expect(page.id).toBe("p-export-1");
        expect(pageCalls.length).toBe(1);
        expect(pageCalls[0].endpoint).toBe("/pages");
        expect(Storage.isTopicExported("77")).toBe(true);
    });

    it("批量导出带正文: /pages 请求须透传 children blocks(防 null-children 丢正文)", async () => {
        const settings = { apiKey: "k", databaseId: "db-1", exportTargetType: "database", imgMode: "link" };
        await Exporter.exportTopic({ topic_id: "77", title: "测试帖" }, settings);
        expect(pageCalls.length).toBe(1);
        const children = pageCalls[0].data?.children;
        expect(Array.isArray(children)).toBe(true);
        expect(children.length).toBeGreaterThan(0);
        expect(children[0]?.paragraph?.rich_text?.[0]?.text?.content).toBe("正文");
    });

    it("Guard 只读级: 拒绝抛权限错误, 不落账不发请求", async () => {
        OperationGuard.setLevel(0);
        const settings = { apiKey: "k", databaseId: "db-1", exportTargetType: "database", imgMode: "link" };
        await expect(Exporter.exportTopic({ topic_id: "77", title: "测试帖" }, settings)).rejects.toThrow(/权限不足|未定义权限级别/);
        expect(pageCalls.length).toBe(0);
        expect(Storage.isTopicExported("77")).toBe(false);
    });
});

describe("AT-012: enrichBookmark AI 失败降级不阻断", () => {
    const saved = {};

    beforeEach(() => {
        saved.insight = BookmarkExporter.fetchPageInsight;
        saved.aiSummary = BookmarkExporter.generateAISummary;
        saved.aiCategory = BookmarkExporter.generateAICategory;
    });

    afterEach(() => {
        BookmarkExporter.fetchPageInsight = saved.insight;
        BookmarkExporter.generateAISummary = saved.aiSummary;
        BookmarkExporter.generateAICategory = saved.aiCategory;
    });

    it("AI 调用抛错: 回退 prefix 标题/启发式分类, aiUsedCount 预占 1, 不抛出", async () => {
        BookmarkExporter.fetchPageInsight = async () => ({ title: "页面标题", summary: "页面摘要" });
        BookmarkExporter.generateAISummary = async () => { throw new Error("AI down"); };
        const context = { aiUsedCount: 0 };
        const enriched = await BookmarkExporter.enrichBookmark(
            { url: "https://example.com/x", title: "我的书签" },
            { aiApiKey: "sk", aiService: "openai", categories: ["技术"] },
            context
        );
        expect(enriched.generatedTitle).toContain("我的书签");
        expect(enriched.generatedSummary).toBe("");
        expect(enriched.inferredCategory).toBe("技术");
        expect(context.aiUsedCount).toBe(1); // 成本闸门: 请求前预占, 失败不回退
    });

    it("非 http 链接: 跳过页面摘要与 AI, 直接启发式回退", async () => {
        let insightCalls = 0;
        BookmarkExporter.fetchPageInsight = async () => { insightCalls += 1; return {}; };
        const enriched = await BookmarkExporter.enrichBookmark(
            { url: "javascript:alert(1)", title: "书签B" },
            { categories: ["技术"] },
            { aiUsedCount: 0 }
        );
        expect(insightCalls).toBe(0);
        expect(enriched.generatedSummary).toBe("非网页链接，跳过页面摘要");
        expect(enriched.inferredCategory).toBe("技术");
    });
});
