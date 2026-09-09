import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";

// P3 共识修复回归(第二批): ChatState 历史恢复 / AIClassifier 按钮状态机 /
// NotionSiteUI 面板空引用与异步陈旧响应
const { ChatState, AIClassifier } = require("../src/ai/index.js");
const { NotionSiteUI } = require("../src/ui/notion-site-ui.js");
const { Storage } = require("../src/storage");
const { CONFIG } = require("../src/config");

const aiSrc = fs.readFileSync("src/ai/index.js", "utf8");
const nsSrc = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");

describe("P3: ChatState.load 历史恢复", () => {
    beforeEach(() => {
        ChatState.messages = [];
    });

    it("拒绝非数组脏数据", () => {
        Storage.set(CONFIG.STORAGE_KEYS.CHAT_HISTORY, JSON.stringify({ foo: 1 }));
        ChatState.load();
        expect(ChatState.messages).toEqual([]);
    });

    it("过滤 null/非对象条目", () => {
        Storage.set(CONFIG.STORAGE_KEYS.CHAT_HISTORY, JSON.stringify([null, "x", { role: "user", content: "hi", status: "complete" }]));
        ChatState.load();
        expect(ChatState.messages).toHaveLength(1);
        expect(ChatState.messages[0].content).toBe("hi");
    });

    it("processing 残留降级为 error 并提示重试", () => {
        Storage.set(CONFIG.STORAGE_KEYS.CHAT_HISTORY, JSON.stringify([
            { id: 1, role: "assistant", content: "思考中...", status: "processing", timestamp: "t" },
        ]));
        ChatState.load();
        expect(ChatState.messages[0].status).toBe("error");
        expect(ChatState.messages[0].content).toMatch(/中断/);
    });
});

describe("P3: AIClassifier 暂停按钮状态机", () => {
    afterEach(() => {
        AIClassifier.isPaused = false;
        AIClassifier.isCancelled = false;
    });

    it("reset 同步复位标志与按钮文案", () => {
        const btn = { textContent: "▶️ 继续分类" };
        const original = document.querySelector;
        document.querySelector = vi.fn(() => btn);
        try {
            AIClassifier.isPaused = true;
            AIClassifier.isCancelled = true;
            AIClassifier.reset();
            expect(AIClassifier.isPaused).toBe(false);
            expect(AIClassifier.isCancelled).toBe(false);
            expect(btn.textContent).toBe("⏸️ 暂停分类");
        } finally {
            document.querySelector = original;
        }
    });
});

describe("P3: NotionSiteUI 空引用与陈旧响应", () => {
    it("showStatus 在面板未创建时静默返回", () => {
        NotionSiteUI.panel = null;
        expect(() => NotionSiteUI.showStatus("x", "error")).not.toThrow();
    });

    it("updateAITargetDbOptions 在面板销毁后静默返回", () => {
        NotionSiteUI.panel = null;
        expect(() => NotionSiteUI.updateAITargetDbOptions([], [])).not.toThrow();
    });

    it("destroy 复位最小化态", () => {
        NotionSiteUI.panel = null;
        NotionSiteUI.floatBtn = null;
        NotionSiteUI.isMinimized = false;
        NotionSiteUI.destroy();
        expect(NotionSiteUI.isMinimized).toBe(true);
        expect(NotionSiteUI.isPanelReady).toBe(false);
    });

    it("fetch_ai_models 陈旧响应被丢弃", () => {
        expect(nsSrc).toMatch(/panel\.querySelector\("#ldb-notion-ai-service"\)\?\.value !== aiService/);
    });

    it("浮钮位置钳制在 append 之后", () => {
        const appendIdx = nsSrc.indexOf("document.body.appendChild(btn);");
        const clampIdx = nsSrc.indexOf("const maxRight = Math.max(0, window.innerWidth - btn.offsetWidth);");
        expect(appendIdx).toBeGreaterThan(-1);
        expect(clampIdx).toBeGreaterThan(appendIdx);
    });

    it("空闲展开回调重新读取持久化标记", () => {
        expect(nsSrc).toMatch(/if \(Storage\.get\(CONFIG\.STORAGE_KEYS\.NOTION_PANEL_MINIMIZED, true\)\) return;/);
    });

    it("已保存模型不在列表时补兼容选项", () => {
        expect(nsSrc).toContain("已保存模型（当前列表之外）");
    });
});

describe("P3: sendMessage 结构化错误状态", () => {
    it("结构化 error 结果不标 complete", () => {
        expect(aiSrc).toMatch(/AIAssistant\._isErrorResult\(response\) \? "error" : "complete"/);
    });
});
