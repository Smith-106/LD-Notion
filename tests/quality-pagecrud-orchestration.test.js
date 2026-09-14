"use strict";

// 20260914: AT-025/026/027 — pageCrud 编排层行为缝隙 (quality-auto-test p3 r6)。
// handleMove/handleCopy/handleCompound 此前零测试引用; 底层 movePage/duplicatePage API
// 已有 operation-guard/p4-api-boundary 覆盖, 本文件聚焦编排守卫链:
// checkConfig → Guard.canExecute → 数据库解析(回退链) → 源=目标拦截 → 分页获取 →
// _executeGuardedPageWrite 批量聚合 → 结果报文; compound 多步中断+跳过语义。
// 契约: AIHandlers 直调返回裸字符串(AGENT_TOOLS envelope 包裹不适用于 handlers)。

import { describe, it, expect, beforeEach, afterEach } from "vitest";


const { AIHandlers } = require("../src/ai/index.js");
const { getAI } = require("../src/ai/deps.js");
const { NotionAPI } = require("../src/api");
const { OperationGuard } = require("../src/security");
const { Utils } = require("../src/utils");

const ai = getAI();

const SETTINGS = {
    notionApiKey: "secret_test",
    aiApiKey: "sk-ai-test",
    notionDatabaseId: "cfgdb123",
};

const page = (id, title) => ({
    id,
    properties: { 标题: { title: [{ plain_text: title }] } },
});

const origMovePage = NotionAPI.movePage;
const origDuplicatePage = NotionAPI.duplicatePage;
const origSleep = Utils.sleep;
const origResolveDb = ai._resolveDatabaseId;
const origFetchPages = ai._fetchSourcePages;
const origExecuteIntent = ai.executeIntent;

beforeEach(() => {
    Utils.sleep = async () => {};
});

afterEach(() => {
    NotionAPI.movePage = origMovePage;
    NotionAPI.duplicatePage = origDuplicatePage;
    Utils.sleep = origSleep;
    ai._resolveDatabaseId = origResolveDb;
    ai._fetchSourcePages = origFetchPages;
    ai.executeIntent = origExecuteIntent;
    OperationGuard.setLevel(1);
});

describe("AT-025: handleMove 编排守卫链", () => {
    it("权限级别 1 拒绝 movePage(level 2) 并提示升级到「高级」", async () => {
        OperationGuard.setLevel(1);
        const result = await AIHandlers.handleMove({}, SETTINGS, "");
        expect(result).toContain("❌ 权限不足");
        expect(result).toContain("移动页面");
        expect(result).toContain("高级");
    });

    it("源数据库解析失败透传错误", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id, key) => ({ error: "boom" });
        const result = await AIHandlers.handleMove(
            { source_database_name: "源库", target_database_id: "t1" },
            SETTINGS,
            ""
        );
        expect(result).toContain("❌ 源数据库解析失败：boom");
    });

    it("无源库解析且无配置回退时报「无法确定源数据库」", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async () => null;
        const result = await AIHandlers.handleMove(
            { target_database_id: "t1" },
            { ...SETTINGS, notionDatabaseId: "" },
            ""
        );
        expect(result).toContain("❌ 无法确定源数据库");
        expect(result).toContain("列出所有数据库");
    });

    it("settings.notionDatabaseId 回退为源库并继续流程(空页面消息验证回退生效)", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id) =>
            name || id ? { id: id || "t1", name: "目标库" } : null;
        ai._fetchSourcePages = async () => [];
        const result = await AIHandlers.handleMove(
            { target_database_id: "t1", page_title: "" },
            SETTINGS,
            ""
        );
        expect(result).toContain("📭");
        expect(result).toContain("已配置的数据库");
    });

    it("源=目标拦截", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id) =>
            id === "s1" ? { id: "s1", name: "源库" } : { id: "s1", name: "目标库" };
        const result = await AIHandlers.handleMove(
            { source_database_id: "s1", target_database_id: "s1" },
            SETTINGS,
            ""
        );
        expect(result).toBe("❌ 源数据库和目标数据库相同，无需移动。");
    });

    it("page_title 空结果返回📭包含标题关键词", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id) => ({ id: id || "s1", name: "源库" });
        ai._fetchSourcePages = async (dbId, key, title) => [];
        const result = await AIHandlers.handleMove(
            { source_database_id: "s1", target_database_id: "t1", page_title: "不存在" },
            SETTINGS,
            ""
        );
        expect(result).toContain("📭");
        expect(result).toContain("不存在");
        expect(result).toContain("源库");
    });

    it("happy path: 逐页 movePage 契约调用并聚合成功报文", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id) =>
            id === "t1" ? { id: "t1", name: "目标库" } : { id: "s1", name: "源库" };
        ai._fetchSourcePages = async () => [page("p1", "甲"), page("p2", "乙")];
        const calls = [];
        NotionAPI.movePage = async (pageId, targetId, type, key) => {
            calls.push({ pageId, targetId, type, key });
            return { id: pageId };
        };
        const result = await AIHandlers.handleMove(
            { source_database_id: "s1", target_database_id: "t1" },
            SETTINGS,
            ""
        );
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({
            pageId: "p1",
            targetId: "t1",
            type: "database",
            key: "secret_test",
        });
        expect(calls[1].pageId).toBe("p2");
        expect(result).toContain("✅ **移动完成**");
        expect(result).toContain("成功: 2 个");
        expect(result).not.toContain("失败:");
    });

    it("部分失败聚合: 成功 1 + 失败 1", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id) =>
            id === "t1" ? { id: "t1", name: "目标库" } : { id: "s1", name: "源库" };
        ai._fetchSourcePages = async () => [page("p1", "甲"), page("p2", "乙")];
        NotionAPI.movePage = async (pageId) => {
            if (pageId === "p2") throw new Error("rate limited");
            return { id: pageId };
        };
        const result = await AIHandlers.handleMove(
            { source_database_id: "s1", target_database_id: "t1" },
            SETTINGS,
            ""
        );
        expect(result).toContain("成功: 1 个");
        expect(result).toContain("失败: 1 个");
    });
});

describe("AT-026: handleCopy 编排守卫链", () => {
    it("权限级别 1 拒绝 duplicatePage(level 2)", async () => {
        OperationGuard.setLevel(1);
        const result = await AIHandlers.handleCopy({}, SETTINGS, "");
        expect(result).toContain("❌ 权限不足");
        expect(result).toContain("复制页面");
    });

    it("目标库不存在时报「找不到目标数据库」", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id) => (id === "s1" ? { id: "s1", name: "源库" } : null);
        const result = await AIHandlers.handleCopy(
            { source_database_id: "s1", target_database_name: "目标库" },
            SETTINGS,
            ""
        );
        expect(result).toContain("❌ 找不到目标数据库「目标库」");
    });

    it("happy path: duplicatePage 契约调用并输出复制完成", async () => {
        OperationGuard.setLevel(2);
        ai._resolveDatabaseId = async (name, id) =>
            id === "t1" ? { id: "t1", name: "目标库" } : { id: "s1", name: "源库" };
        ai._fetchSourcePages = async () => [page("p1", "甲")];
        const calls = [];
        NotionAPI.duplicatePage = async (pageId, targetId, type, key) => {
            calls.push({ pageId, targetId, type, key });
            return { id: "new1" };
        };
        const result = await AIHandlers.handleCopy(
            { source_database_id: "s1", target_database_id: "t1" },
            SETTINGS,
            ""
        );
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
            pageId: "p1",
            targetId: "t1",
            type: "database",
            key: "secret_test",
        });
        expect(result).toContain("✅ **复制完成**");
        expect(result).toContain("成功: 1 个");
    });
});

describe("AT-027: handleCompound 多步编排与中断语义", () => {
    it("steps 为空报「组合指令解析失败」", async () => {
        const result = await AIHandlers.handleCompound({ steps: [], explanation: "x" }, SETTINGS);
        expect(result).toContain("❌ 组合指令解析失败");
        const result2 = await AIHandlers.handleCompound({}, SETTINGS);
        expect(result2).toContain("❌ 组合指令解析失败");
    });

    it("双步成功: 执行完成 + 两步✅ + 详情附加", async () => {
        ai.executeIntent = async (step) => `结果:${step.intent}`;
        const result = await AIHandlers.handleCompound(
            {
                explanation: "搬家",
                steps: [
                    { intent: "move", explanation: "移动页面" },
                    { intent: "copy", explanation: "复制页面" },
                ],
            },
            SETTINGS
        );
        expect(result).toContain("执行完成");
        expect(result).not.toContain("已跳过");
        expect(result).toContain("✅ 步骤 1: 移动页面");
        expect(result).toContain("✅ 步骤 2: 复制页面");
        expect(result).toContain("结果:move");
        expect(result).toContain("结果:copy");
    });

    it("步骤错误中断: ✅1 ❌2 + 已跳过步骤3", async () => {
        ai.executeIntent = async (step) =>
            step.intent === "boom" ? "❌ 目标不存在" : "ok";
        const result = await AIHandlers.handleCompound(
            {
                explanation: "链式",
                steps: [
                    { intent: "query", explanation: "先查询" },
                    { intent: "boom", explanation: "会失败的一步" },
                    { intent: "copy", explanation: "不会执行" },
                ],
            },
            SETTINGS
        );
        expect(result).toContain("执行中断");
        expect(result).toContain("✅ 步骤 1: 先查询");
        expect(result).toContain("❌ 步骤 2: 会失败的一步");
        expect(result).toContain("已跳过");
        expect(result).toContain("3. 不会执行");
    });

    it("executeIntent 抛错同样中断并跳过后续步骤", async () => {
        ai.executeIntent = async (step) => {
            if (step.intent === "throw") throw new Error("网络炸了");
            return "ok";
        };
        const result = await AIHandlers.handleCompound(
            {
                explanation: "抛错链",
                steps: [
                    { intent: "throw", explanation: "炸点" },
                    { intent: "move", explanation: "后续" },
                ],
            },
            SETTINGS
        );
        expect(result).toContain("执行中断");
        expect(result).toContain("❌ 步骤 1: 炸点");
        expect(result).toContain("已跳过");
        expect(result).toContain("2. 后续");
    });
});
