import { describe, it, expect } from "vitest";

// ISS-20260723-010 W7-2 (MAINT-001 部分): AIHandlers 前置校验契约单测。
// 不追求 27 handler 全覆盖（多数 handler 依赖 NotionAPI/ChatState/AIAssistant 共 130+ 处，
// 单测需 mock 巨量依赖，成本极高收益边际——行为已由 verify:equivalence + 426 vitest 兜底，
// test-conventions-003 也指出端到端集成比单元测试更值）。
// 聚焦"纯逻辑前置校验分支"：缺 notionDatabaseId / categories 不足等，这些在 state()/AI()/NotionAPI
// 调用之前直接 return，无网络依赖，可纯测。handleQuery + handleBatchClassify 两 handler 4 契约。

import { AIHandlers } from "../src/ai/index.js";

describe("AT-008: AIHandlers 前置校验契约（MAINT-001 子集）", () => {
    describe("handleQuery — notionDatabaseId 校验", () => {
        it("缺 notionDatabaseId 返回数据库 ID 配置提示", async () => {
            const result = await AIHandlers.handleQuery({}, {}, "");
            expect(result).toContain("❌");
            expect(result).toContain("请先配置 Notion 数据库 ID");
            expect(result).toContain("列出所有数据库");
        });

        it("notionDatabaseId 为空串也判缺失", async () => {
            const result = await AIHandlers.handleQuery({}, { notionDatabaseId: "" }, "");
            expect(result).toContain("请先配置 Notion 数据库 ID");
        });
    });

    describe("handleBatchClassify — notionDatabaseId + categories 双重校验", () => {
        it("缺 notionDatabaseId 返回数据库 ID 配置提示", async () => {
            const result = await AIHandlers.handleBatchClassify({}, {}, "");
            expect(result).toContain("❌");
            expect(result).toContain("请先配置 Notion 数据库 ID");
        });

        it("有 notionDatabaseId 但 categories < 2 返回分类不足提示", async () => {
            const result = await AIHandlers.handleBatchClassify(
                {},
                { notionDatabaseId: "test-db-id", categories: ["技术"] },
                ""
            );
            expect(result).toContain("❌");
            expect(result).toContain("至少两个分类");
        });

        it("categories 为空数组也判不足", async () => {
            const result = await AIHandlers.handleBatchClassify(
                {},
                { notionDatabaseId: "test-db-id", categories: [] },
                ""
            );
            expect(result).toContain("至少两个分类");
        });

        it("校验顺序：notionDatabaseId 优先于 categories（缺 dbId 时即使 categories 不足也先报 dbId）", async () => {
            const result = await AIHandlers.handleBatchClassify(
                {},
                { notionDatabaseId: "", categories: [] },
                ""
            );
            expect(result).toContain("请先配置 Notion 数据库 ID");
            expect(result).not.toContain("至少两个分类");
        });
    });

    describe("handleClassify — 开发中占位", () => {
        it("handleClassify 返回开发中提示（不依赖任何配置）", async () => {
            const result = await AIHandlers.handleClassify({}, {}, "");
            expect(result).toContain("开发中");
            expect(result).toContain("自动分类所有未分类的帖子");
        });
    });
});

// TASK-001 (P1_baseline): batch_ops 集群前置校验契约测试。
// 覆盖 handleBatchTranslate/handleExtractToDatabase/handleGeneratePages/handleBatchAnalyze
// 4 个 handler 的纯逻辑前置校验分支（checkConfig + OperationGuard + 参数缺失），
// 锁定拆分前行为基线。handleBatchClassify 已在上方覆盖。
describe("AT-008b: batch_ops 集群前置校验契约（TASK-001 基线）", () => {
    // 通过 checkConfig 的最小 settings（notionApiKey + aiApiKey）
    const validSettings = { notionApiKey: "test-key", aiApiKey: "test-ai-key" };

    describe("handleBatchTranslate — checkConfig + 参数校验", () => {
        it("空 settings 返回 API Key 配置提示", async () => {
            const result = await AIHandlers.handleBatchTranslate({}, {}, "");
            expect(result).toContain("请先配置 Notion API Key");
        });

        it("有 notionApiKey 但缺 aiApiKey 返回 AI Key 配置提示", async () => {
            const result = await AIHandlers.handleBatchTranslate({}, { notionApiKey: "k" }, "");
            expect(result).toContain("请先配置 AI API Key");
        });

        it("配置完整但缺 database_name 和 database_id 返回数据库指定提示", async () => {
            const result = await AIHandlers.handleBatchTranslate({}, validSettings, "");
            expect(result).toContain("❌");
            expect(result).toContain("请指定要翻译的数据库");
        });
    });

    describe("handleExtractToDatabase — checkConfig + 权限 + 参数校验", () => {
        it("空 settings 返回 API Key 配置提示", async () => {
            const result = await AIHandlers.handleExtractToDatabase({}, {}, "");
            expect(result).toContain("请先配置 Notion API Key");
        });

        it("配置完整但权限不足（默认 level 1 < createDatabase 所需 level 2）", async () => {
            const result = await AIHandlers.handleExtractToDatabase({}, validSettings, "");
            expect(result).toContain("❌");
            expect(result).toContain("权限不足");
        });
    });

    describe("handleGeneratePages — checkConfig + 权限 + 参数校验", () => {
        it("空 settings 返回 API Key 配置提示", async () => {
            const result = await AIHandlers.handleGeneratePages({}, {}, "");
            expect(result).toContain("请先配置 Notion API Key");
        });

        it("配置完整但权限不足（默认 level 1 < createDatabase 所需 level 2）", async () => {
            const result = await AIHandlers.handleGeneratePages({}, validSettings, "");
            expect(result).toContain("❌");
            expect(result).toContain("权限不足");
        });
    });

    describe("handleBatchAnalyze — checkConfig + 参数校验", () => {
        it("空 settings 返回 API Key 配置提示", async () => {
            const result = await AIHandlers.handleBatchAnalyze({}, {}, "");
            expect(result).toContain("请先配置 Notion API Key");
        });

        it("配置完整但缺 database_name/database_id 且无默认数据库返回指定提示", async () => {
            const result = await AIHandlers.handleBatchAnalyze({}, validSettings, "");
            expect(result).toContain("❌");
            expect(result).toContain("请指定要分析的数据库");
        });

        // 注：有默认 notionDatabaseId 时跳过参数校验进入网络调用阶段，
        // 超出纯前置校验测试范围（GM_xmlhttpRequest mock 不 resolve），
        // 该路径由 verify:equivalence + 集成测试兜底。
    });
});
