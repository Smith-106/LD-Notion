"use strict";

import { describe, it, expect, beforeEach, vi } from "vitest";

// 20260914: 浏览器书签整理器单测。
// 约定: 跨模块 stub 用 require(); BookmarkBridge 经 lazy require 取用 —— 通过
// mutate bridge/index.js 导出对象的方法实现 stub; 守卫拒绝路径验证不落桥接。

const store = new Map();
globalThis.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
globalThis.GM_setValue = (k, v) => { store.set(k, v); };
globalThis.GM_deleteValue = (k) => { store.delete(k); };

const { BookmarkOrganizer } = require("../src/bridge/BookmarkOrganizer");
const bridgeIndex = require("../src/bridge/index");
const { OperationGuard, OperationLog } = require("../src/security");
const { CONFIG } = require("../src/config");

// —— GM 探测路由: url → { status } 或 { fail: true } ——
let probeRoutes;
globalThis.GM_xmlhttpRequest = (options) => {
    const route = probeRoutes && probeRoutes[options.url];
    Promise.resolve().then(() => {
        if (!route) {
            options.onload && options.onload({ status: 404 });
        } else if (route.fail) {
            options.onerror && options.onerror({ error: "net" });
        } else {
            options.onload && options.onload({ status: route.status });
        }
    });
};

const mkNode = (id, title, url, extra = {}) => ({
    id, title, url: url || "", dateAdded: extra.dateAdded || 0,
    parentId: extra.parentId || "1", children: extra.children,
});

// 典型书签树: 书签栏(1) 下两个顶层文件夹 + 根目录散落书签; 其他书签(2)
const buildTree = () => ([
    mkNode("1", "书签栏", "", { children: [
        mkNode("10", "工具", "", { parentId: "1", children: [
            mkNode("100", "GitHub", "https://github.com/", { dateAdded: 100, parentId: "10" }),
            mkNode("101", "GitHub 副本", "https://github.com", { dateAdded: 200, parentId: "10" }),
        ]}),
        mkNode("11", "阅读", "", { parentId: "1", children: [
            mkNode("110", "死链示例", "https://dead.example.com/x", { dateAdded: 300, parentId: "11" }),
            mkNode("111", "活链示例", "https://alive.example.com/", { dateAdded: 400, parentId: "11" }),
        ]}),
        mkNode("120", "散落书签", "https://loose.example.com/", { dateAdded: 500, parentId: "1" }),
    ]}),
    mkNode("2", "其他书签", "", { children: [] }),
]);

beforeEach(() => {
    store.clear();
    probeRoutes = {};
    vi.restoreAllMocks();
    // 桥接 stub: getBookmarkTree 返回固定树; organizeBookmarks 记录调用
    bridgeIndex.BookmarkBridge.getBookmarkTree = vi.fn(async () => buildTree());
    bridgeIndex.BookmarkBridge.organizeBookmarks = vi.fn(async (ops) =>
        ops.map((op) => (op.action === "ensureFolder" || op.action === "move")
            ? { ok: true, action: op.action, id: op.id }
            : { ok: false, action: op.action, error: "unsupported-action" })
    );
});

describe("BookmarkOrganizer.scan", () => {
    it("重复书签: 同 URL 保留最早, 其余移入重复文件夹", async () => {
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: false });
        expect(plan.dupCount).toBe(1); // github.com/ 与 github.com 归一后同 URL
        const dupMove = plan.operations.find((op) => op.action === "move" && op.reason === "重复书签");
        expect(dupMove.id).toBe("101"); // dateAdded 较晚者为副本
        expect(dupMove.parentIdRef).toBe("folder-dup");
    });

    it("失效链接: 4xx/网络失败移入待清理, 活链不动", async () => {
        probeRoutes = {
            "https://dead.example.com/x": { status: 404 },
            "https://alive.example.com/": { status: 200 },
            "https://github.com/": { status: 200 },
            "https://github.com": { status: 200 },
            "https://loose.example.com/": { status: 200 },
        };
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: true });
        expect(plan.deadCount).toBe(1);
        const deadMove = plan.operations.find((op) => op.action === "move" && op.reason === "失效链接");
        expect(deadMove.id).toBe("110");
        expect(plan.operations.find((op) => op.action === "move" && op.id === "111")).toBeUndefined();
    });

    it("plan 零删除: 仅 ensureFolder/move 两类动作(白名单)", async () => {
        probeRoutes = { "https://dead.example.com/x": { fail: true } };
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: true, classifyWithAI: false });
        const actions = new Set(plan.operations.map((op) => op.action));
        expect(actions.has("remove")).toBe(false);
        expect(actions.has("update")).toBe(false);
        expect([...actions].every((a) => a === "ensureFolder" || a === "move")).toBe(true);
    });

    it("AI Key 未配置时归类跳过并给提示", async () => {
        const aiModule = require("../src/ai");
        vi.spyOn(aiModule, "getAISettings").mockReturnValue({ aiApiKey: "" });
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: false, classifyWithAI: true });
        expect(plan.looseCount).toBe(0);
        expect(plan.aiNotice).toContain("未配置 AI Key");
    });

    it("AI 归类: 根目录散落书签分类进既有顶层文件夹", async () => {
        probeRoutes = {
            "https://loose.example.com/": { status: 200 },
            "https://github.com/": { status: 200 },
            "https://github.com": { status: 200 },
        };
        const aiModule = require("../src/ai");
        vi.spyOn(aiModule.AIService, "classify").mockResolvedValue("工具");
        vi.spyOn(aiModule, "getAISettings").mockReturnValue({ aiApiKey: "k", aiService: "openai" });
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: false, classifyWithAI: true });
        expect(plan.looseCount).toBe(1);
        const looseMove = plan.operations.find((op) => op.action === "move" && op.id === "120");
        expect(looseMove.parentId).toBe("10"); // 顶层「工具」文件夹 id
        expect(looseMove.reason).toContain("AI归类");
    });
});

describe("BookmarkOrganizer.execute", () => {
    it("守卫拒绝: 权限不足时不落桥接且记审计 denied", async () => {
        vi.spyOn(OperationGuard, "canExecute").mockReturnValue(false);
        const logSpy = vi.spyOn(OperationLog, "add").mockImplementation(() => {});
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: false });
        await expect(BookmarkOrganizer.execute(plan)).rejects.toThrow(/权限不足/);
        expect(bridgeIndex.BookmarkBridge.organizeBookmarks).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
            operation: "bookmarks.organize", allowed: false,
        }));
    });

    it("执行成功: 先备份, 白名单操作全过, 撤销记录持久化", async () => {
        vi.spyOn(OperationGuard, "canExecute").mockReturnValue(true);
        const logSpy = vi.spyOn(OperationLog, "add").mockImplementation(() => {});
        const backupSpy = vi.spyOn(BookmarkOrganizer, "backup").mockReturnValue("backup.json");
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: false });
        const report = await BookmarkOrganizer.execute(plan);
        expect(backupSpy).toHaveBeenCalled();
        expect(report.movedCount).toBe(1); // dup 101
        expect(report.failedCount).toBe(0);
        const opsArg = bridgeIndex.BookmarkBridge.organizeBookmarks.mock.calls[0][0];
        expect(opsArg.some((op) => op.action === "ensureFolder" && op.title === BookmarkOrganizer.ORGANIZE_ROOT_TITLE)).toBe(true);
        const undo = store.get(CONFIG.STORAGE_KEYS.BOOKMARK_ORGANIZE_UNDO);
        expect(undo.some((u) => u.id === "101" && u.fromParentId === "10")).toBe(true);
        expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ operation: "bookmarks.organize", allowed: true }));
    });

    it("桥接返回白名单外结果按失败统计", async () => {
        vi.spyOn(OperationGuard, "canExecute").mockReturnValue(true);
        vi.spyOn(BookmarkOrganizer, "backup").mockReturnValue("backup.json");
        bridgeIndex.BookmarkBridge.organizeBookmarks = vi.fn(async (ops) =>
            ops.map((op) => op.action === "move"
                ? { ok: true, action: "move", id: op.id }
                : { ok: false, action: op.action, error: "unsupported-action" })
        );
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: false });
        const report = await BookmarkOrganizer.execute(plan);
        expect(report.failedCount).toBe(3); // 3 个 ensureFolder 被拒(模拟旧版扩展)
        expect(report.movedCount).toBe(1);
    });
});

describe("BookmarkOrganizer.undoLast", () => {
    it("撤销: 按记录移回原 parentId 并清空记录", async () => {
        vi.spyOn(OperationGuard, "canExecute").mockReturnValue(true);
        store.set(CONFIG.STORAGE_KEYS.BOOKMARK_ORGANIZE_UNDO, [
            { id: "101", fromParentId: "10", reason: "重复书签" },
        ]);
        const report = await BookmarkOrganizer.undoLast();
        expect(report.movedCount).toBe(1);
        const opsArg = bridgeIndex.BookmarkBridge.organizeBookmarks.mock.calls[0][0];
        expect(opsArg[0]).toMatchObject({ action: "move", id: "101", parentId: "10" });
        expect(store.get(CONFIG.STORAGE_KEYS.BOOKMARK_ORGANIZE_UNDO)).toEqual([]);
    });

    it("无记录时撤销抛错", async () => {
        await expect(BookmarkOrganizer.undoLast()).rejects.toThrow(/没有可撤销/);
    });
});

// 20260914: odyssey-review 修复回归 — 失效判定键域统一(normalized)。
// 场景: github.com/ 与 github.com normalized 等价; 正本探测 404 时,
// normalized 等价的副本必须同样归类为失效(folder-dead), 而非漏判成重复书签。
describe("BookmarkOrganizer.scan — 失效判定键域统一(回归)", () => {
    it("normalized 等价副本随正本同判失效", async () => {
        probeRoutes = { "https://github.com/": { status: 404 } };
        const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: true, classifyWithAI: false });
        const deadIds = plan.operations
            .filter((op) => op.action === "move" && op.parentIdRef === "folder-dead")
            .map((op) => op.id);
        expect(deadIds).toEqual(expect.arrayContaining(["100", "101"]));
        const dupIds = plan.operations
            .filter((op) => op.action === "move" && op.parentIdRef === "folder-dup")
            .map((op) => op.id);
        expect(dupIds).toEqual([]);
        expect(plan.deadCount).toBe(5); // mock 默认路由全 404: github×2 + dead/alive/loose 全判失效
    });
});
