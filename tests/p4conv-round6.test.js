"use strict";

import { describe, it, expect } from "vitest";

// P4 收敛 wave4 第三批回归: c09 自动导入互斥/idle 复核 + c10 batch 缓存脱离 +
// c13 来源切换一致性 + c14 导出锁/配置一致性 + c16 面板位置钳制 + c17 跨源候选取舍。
// 行为断言: DedupStore→Storage 缓存失效、面板位置钳制、跨源候选按重要性取舍;
// 其余为源码级契约锁定(UI 胶水层无可注入入口)。

const { Storage } = require("../src/storage");
const { DedupStore } = require("../src/storage/DedupStore");
const { on } = require("../src/coordination/event-bus");
const { NotionSiteUI } = require("../src/ui/notion-site-ui");

const read = (p) => require("fs").readFileSync(p, "utf8");

describe("P4 收敛(c10): batch 落盘后 Storage 导出账本缓存必须失效", () => {
    it("endBatch 发出 storage:batch-committed 且清空 _exportedTopicsCache", () => {
        const seen = [];
        on("storage:batch-committed", (payload) => seen.push(payload));
        // 注册 watcher(否则订阅未绑定)
        Storage.getExportedTopics();
        Storage._exportedTopicsCache = { stale: 1 };

        DedupStore.beginBatch("linuxdo");
        DedupStore.markSeen("linuxdo", "topic-batch-1");
        DedupStore.endBatch("linuxdo");

        expect(seen.length).toBeGreaterThan(0);
        expect(seen[seen.length - 1]).toEqual({ sourceType: "linuxdo" });
        expect(Storage._exportedTopicsCache).toBe(null);
    });

    it("endBatch() 全量提交同样通知(*)", () => {
        const seen = [];
        on("storage:batch-committed", (payload) => seen.push(payload));
        Storage.getExportedTopics();
        Storage._exportedTopicsCache = { stale: 1 };

        DedupStore.beginBatch("bookmark");
        DedupStore.markSeen("bookmark", "https://example.com/a");
        DedupStore.endBatch();

        expect(seen[seen.length - 1]).toEqual({ sourceType: "*" });
        expect(Storage._exportedTopicsCache).toBe(null);
    });
});

describe("P4 收敛(c16): 面板位置钳制必须在尺寸可测时执行", () => {
    const withPanel = (panel, fn) => {
        const prevPanel = NotionSiteUI.panel;
        const prevW = globalThis.window.innerWidth;
        const prevH = globalThis.window.innerHeight;
        globalThis.window.innerWidth = 1000;
        globalThis.window.innerHeight = 800;
        NotionSiteUI.panel = panel;
        try {
            fn();
        } finally {
            NotionSiteUI.panel = prevPanel;
            globalThis.window.innerWidth = prevW;
            globalThis.window.innerHeight = prevH;
        }
    };

    it("可见面板的越界 right/bottom 被钳制回视口内", () => {
        withPanel({ offsetWidth: 380, offsetHeight: 400, style: { right: "5000px", bottom: "5000px" } }, () => {
            NotionSiteUI.clampPanelPosition();
            expect(NotionSiteUI.panel.style.right).toBe("620px");
            expect(NotionSiteUI.panel.style.bottom).toBe("400px");
        });
    });

    it("视口内位置不被改动(幂等)", () => {
        withPanel({ offsetWidth: 380, offsetHeight: 400, style: { right: "24px", bottom: "96px" } }, () => {
            NotionSiteUI.clampPanelPosition();
            expect(NotionSiteUI.panel.style.right).toBe("24px");
            expect(NotionSiteUI.panel.style.bottom).toBe("96px");
        });
    });

    it("尺寸不可测(display:none)时保持原样, 不做伪钳制", () => {
        withPanel({ offsetWidth: 0, offsetHeight: 0, style: { right: "5000px", bottom: "5000px" } }, () => {
            NotionSiteUI.clampPanelPosition();
            expect(NotionSiteUI.panel.style.right).toBe("5000px");
            expect(NotionSiteUI.panel.style.bottom).toBe("5000px");
        });
    });

    it("loadConfig 只恢复坐标, 钳制交给 clampPanelPosition", () => {
        const src = read("src/ui/notion-site-ui.js");
        expect(src).not.toContain("maxPanelRight");
        expect(src).toContain("NotionSiteUI.clampPanelPosition();");
        expect(src).toContain("if (!panel || !panel.offsetWidth) return;");
    });
});

describe("P4 收敛(c17): 跨源关联候选按重要性取舍", () => {
    // 惰性 UI 引用指向 main-ui —— 注入桩避免加载整个 UI 栈
    const injectUiStub = () => {
        const mainUiPath = require.resolve("../src/ui/main-ui");
        const prev = require.cache[mainUiPath];
        require.cache[mainUiPath] = {
            id: mainUiPath,
            filename: mainUiPath,
            loaded: true,
            exports: {
                UI: {
                    getViewPct: (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0),
                    getWorkspaceVisualParentLabel: () => "父级",
                    normalizeWorkspaceInsightKey: (title) => String(title || "").trim().toLowerCase(),
                    normalizeWorkspaceInsightUrl: (url) => String(url || "").trim(),
                },
            },
        };
        const { WorkspaceVisual } = require("../src/ui/workspace-visual");
        return { WorkspaceVisual, restore: () => { require.cache[mainUiPath] = prev; } };
    };

    const buildRecords = () => {
        const records = [];
        // 9 个同标题跨源组(每组 2 条, 2 个来源) → count 均为 2
        for (let i = 0; i < 9; i++) {
            records.push({
                id: `t${i}a`, title: `重复标题 ${i}`, source: "Linux.do",
                url: `https://linux.do/t/${i}`, hasSource: true,
            });
            records.push({
                id: `t${i}b`, title: `重复标题 ${i}`, source: "GitHub",
                url: `https://github.com/x/${i}`, hasSource: true,
            });
        }
        // 1 个同链接跨源组(3 条, 2 个来源, 标题各异 → 不构成同标题组) → count 3
        for (let j = 0; j < 3; j++) {
            records.push({
                id: `l${j}`, title: `链接条目 ${j}`,
                source: j === 2 ? "GitHub" : "Linux.do",
                url: "https://example.com/shared", hasSource: true,
            });
        }
        return records;
    };

    it("高 count 的链接类候选不被同标题候选挤出前 8", () => {
        const { WorkspaceVisual, restore } = injectUiStub();
        try {
            const model = WorkspaceVisual.buildWorkspaceVisualizationModel({
                databases: [],
                records: buildRecords(),
                scannedAt: 1,
            });
            expect(model.connectionCandidates).toHaveLength(8);
            expect(model.connectionCandidates[0].key).toBe("url:https://example.com/shared");
            expect(model.connectionCandidates[0].count).toBe(3);
            expect(model.connectionCandidates[0].reason).toBe("同链接跨源候选");
        } finally {
            restore();
        }
    });

    it("候选上限 8 仍生效(不因排序变成无界)", () => {
        const { WorkspaceVisual, restore } = injectUiStub();
        try {
            const model = WorkspaceVisual.buildWorkspaceVisualizationModel({
                databases: [],
                records: buildRecords(),
                scannedAt: 1,
            });
            expect(model.connectionCandidates.length).toBe(8);
        } finally {
            restore();
        }
    });
});

describe("P4 收敛(c09/c13/c14): 源码级契约锁定", () => {
    it("AutoImporter 互斥仅在本次置位时复位", () => {
        const src = read("src/import/index.js");
        expect(src).toContain("const exportMutexAcquired = SyncLock.isExporting !== true;");
        expect((src.match(/if \(exportMutexAcquired\) SyncLock\.isExporting = false;/g) || []).length).toBe(3);
        expect(src).not.toContain("        SyncLock.isExporting = false;\n");
    });

    it("AutoImporter idle 回调执行前复核 canStart", () => {
        const src = read("src/import/index.js");
        expect((src.match(/Utils\.runWhenBrowserIdle\(\(\) => \{ if \(AutoImporter\.canStart\(\)\) AutoImporter\.run\(\); \}\);/g) || []).length).toBe(2);
        expect(src).not.toContain("Utils.runWhenBrowserIdle(() => AutoImporter.run());");
    });

    it("AI 分类匹配为精确优先 + 最长匹配", () => {
        const src = read("src/import/GitHubExporter.js");
        expect(src).toContain("categories.includes(trimmedCategory)");
        expect(src).toContain(".sort((a, b) => String(b).length - String(a).length)[0]");
        expect(src).not.toContain("categories.find(c => category.trim().includes(c))");
    });

    it("GitHub 自动导入配置警告写到 GitHub 状态位", () => {
        const src = read("src/ui/events.js");
        expect(src).toContain('GitHubAutoImporter.updateStatus("⚠️ 请先配置 GitHub 用户名/Token 与 Notion 目标");');
    });

    it("GitHub 加载循环写计数前复核来源", () => {
        const src = read("src/ui/events.js");
        expect(src).toContain("if (loadSource === UI.getActiveBookmarkSource() && UI.refs?.bookmarkCount) {");
    });

    it("导出器选择与 toExport 同一来源快照", () => {
        const src = read("src/ui/events.js");
        expect(src).toContain("const exportIsGitHub = UI.isActiveGitHubSource();");
        expect(src).toContain("if (exportIsGitHub) {");
    });

    it("Obsidian URL/目录在 Key 落盘成功后才写", () => {
        const src = read("src/ui/generic-ui.js");
        const keyIdx = src.indexOf("await CredentialVault.set(CONFIG.STORAGE_KEYS.OBS_API_KEY, key);");
        const urlIdx = src.indexOf("Storage.set(CONFIG.STORAGE_KEYS.OBS_API_URL, url);");
        expect(keyIdx).toBeGreaterThan(-1);
        expect(urlIdx).toBeGreaterThan(keyIdx);
    });

    it("setManualApiKey 异常可见且不中断保存流程", () => {
        const src = read("src/ui/generic-ui.js");
        expect(src).toContain("保存 API Key 失败: ${error.message}");
    });

    it("两处导出锁的前置步骤都在 try 内", () => {
        const src = read("src/ui/generic-ui.js");
        expect(src).not.toContain("GenericUI.isExporting = false;\n                GenericUI.showStatus(\"已取消");
        expect((src.match(/let btn = null;/g) || []).length).toBe(2);
        expect((src.match(/if \(btn\) \{\n                    btn\.disabled = false;/g) || []).length).toBe(1);
        expect(src).toContain('if (floatBtn) floatBtn.className = "gclip-float-btn error";');
    });
});

describe("P4 收敛(c15/c16/c17): 销毁中止 / 面板复用 / 原型键 / base64 对称", () => {
    const fs = require("fs");
    const { Utils } = require("../src/utils");

    it("MainUI 保存候选循环用预先捕获的 signal(destroy 置 null 后仍可中止)", () => {
        const src = fs.readFileSync("src/ui/main-ui.js", "utf8");
        expect(src).toContain("const abortSignal = UI._abortController?.signal;");
        expect(src).toContain("if (abortSignal?.aborted) break;");
        expect(src).not.toContain("if (UI._abortController?.signal?.aborted) break;");
    });

    it("NotionSiteUI destroy 后排队 idle 回调不得重建面板", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");
        expect(src).toContain("NotionSiteUI._destroyed = true;");
        expect(src).toContain("NotionSiteUI._destroyed = false;");
        expect(src).toContain("if (NotionSiteUI._destroyed) return;");
    });

    it("顶级页面判定兼容对象形态 parent", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");
        expect(src).not.toContain('pages.filter(p => p.parent === "workspace")');
        expect(src).toContain('pages.filter(p => NotionSiteUI.getAITargetPageParentType(p) === "workspace")');
    });

    it("applyPostAuthTarget 标题不双重转义", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");
        expect(src).not.toContain("const title = payload.title ? Utils.escapeHtml(payload.title) : \"\";");
        expect(src).toContain("const title = payload.title ? String(payload.title) : \"\";");
    });

    it("GitHub 类型标签映射为无原型对象", () => {
        const src = fs.readFileSync("src/ui/workspace-insight.js", "utf8");
        expect(src).toContain("const githubTypeLabelMap = Object.assign(Object.create(null), {");
    });

    it("base64Encode/DecodeUnicode 对 Latin-1 区间字符对称(UTF-8)", () => {
        for (const input of ["café", "©2024", "中文abc", "·middle·"]) {
            expect(Utils.base64Encode(input)).toBe(Buffer.from(input, "utf8").toString("base64"));
            expect(Utils.base64DecodeUnicode(Utils.base64Encode(input))).toBe(input);
        }
    });

    it("githubTypeLabelMap 对原型键不再取到函数源码", () => {
        const src = fs.readFileSync("src/ui/workspace-insight.js", "utf8");
        const map = Object.assign(Object.create(null), { stars: "Stars", repos: "Repos", forks: "Forks", gists: "Gists" });
        expect(map["constructor"] || "constructor").toBe("constructor");
        expect(src).not.toMatch(/const githubTypeLabelMap = \{\n\s+stars: "Stars",/);
    });
});
