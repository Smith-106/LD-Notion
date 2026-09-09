import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";

// P4 第四批回归: agent-executor 工具白名单/迭代上限/载荷上限 + notion-upload 边界
const { AgentExecutor } = require("../src/ai/agent-executor.js");
const { AIAssistant, AIService, ChatState } = require("../src/ai/index.js");
const { Storage } = require("../src/storage");
const { CONFIG } = require("../src/config");

describe("P4: agent-executor 边界", () => {
    const saved = {};

    beforeEach(() => {
        saved.buildSystemPrompt = AIAssistant._buildAgentSystemPrompt;
        saved.updateLastMessage = ChatState.updateLastMessage;
        saved.requestAgentChat = AIService.requestAgentChat;
        AIAssistant._buildAgentSystemPrompt = () => "sys";
        ChatState.updateLastMessage = () => {};
    });

    afterEach(() => {
        AIAssistant._buildAgentSystemPrompt = saved.buildSystemPrompt;
        ChatState.updateLastMessage = saved.updateLastMessage;
        AIService.requestAgentChat = saved.requestAgentChat;
        Storage.remove(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS);
    });

    it("_tryParseToolCall 拒绝原型链键", () => {
        expect(AgentExecutor._tryParseToolCall('{"tool":"constructor","args":{}}')).toBeNull();
        expect(AgentExecutor._tryParseToolCall('{"tool":"toString","args":{}}')).toBeNull();
        expect(AgentExecutor._tryParseToolCall('{"tool":"__proto__","args":{}}')).toBeNull();
    });

    it("_tryParseToolCall 仍接受已注册工具", () => {
        const parsed = AgentExecutor._tryParseToolCall('{"tool":"query_database","args":{}}');
        expect(parsed?.tool).toBe("query_database");
    });

    it("runAgentLoop 非法 maxIterations 归一后仍执行至少一轮", async () => {
        Storage.set(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS, "abc");
        let calls = 0;
        AIService.requestAgentChat = async () => { calls++; return "最终回答"; };

        const result = await AgentExecutor.runAgentLoop("你好", { notionApiKey: "k" });
        expect(result).toBe("最终回答");
        expect(calls).toBe(1);
    });

    it("_resultToAgentPayload 超长结果截断并标注", () => {
        const payload = AIAssistant._resultToAgentPayload("x".repeat(30000));
        expect(payload.length).toBeLessThan(30000);
        expect(payload).toContain("工具结果过长已截断");
    });
});

describe("P4: notion-upload 边界契约", () => {
    const src = fs.readFileSync("src/api/notion-upload.js", "utf8").replace(/\r\n/g, "\n");

    it("sendFilePart / uploadFileContent 的 onload 全量包 try/catch", () => {
        const guards = src.match(/catch \(error\) \{\n\s+reject\(error instanceof Error \? error : new Error\(String\(error\)\)\);/g) || [];
        expect(guards.length).toBeGreaterThanOrEqual(2);
    });

    it("multipart contentType 剥离 CR/LF/引号", () => {
        expect(src).toContain("const safeContentType = String(contentType || \"application/octet-stream\").replace(/[\\r\\n\"]/g, \"\")");
    });

    it("下载 2xx 空 response 视为失败", () => {
        const guards = src.match(/r\.status >= 200 && r\.status < 300 && r\.response/g) || [];
        expect(guards.length).toBe(2);
    });

    it("回退上传对超阈文件走 multi_part", () => {
        expect(src).toContain("if (blob.size > MULTI_PART_THRESHOLD) {");
        expect(src).toContain("await NotionAPI.completeFileUpload(multiUpload.id, apiKey);");
    });
});
