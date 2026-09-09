"use strict";

// P4 收敛轮第三批(wave3, c13-c17)三模型共识确认的修复回归测试。
// 覆盖: events.js getMimeType 导入 / 保存失败恢复导出按钮 / 面板销毁后模型回调 /
//       touched 三处复位 / 浮钮 0 坐标 / 面板视口钳制 / normalizeWatermark 之外的
//       utils 边界(escapeHtml 0、base64Encode UTF-8) / 跨源候选原型链键守卫 /
//       connectionCandidates 先过滤后截断 / oplog 防抖定时器 / normalizeDedupUrl 契约。
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;

const { Utils } = require("../src/utils");
const { NotionSiteUI } = require("../src/ui/notion-site-ui");
const { WorkspaceInsight } = require("../src/ui/workspace-insight");

beforeEach(() => {
    store.clear();
});

describe("P4 收敛(c17): Utils 边界值", () => {
    it("escapeHtml 保留数值 0 / false，仅 null/undefined 视为无值", () => {
        expect(Utils.escapeHtml(0)).toBe("0");
        expect(Utils.escapeHtml(false)).toBe("false");
        expect(Utils.escapeHtml(null)).toBe("");
        expect(Utils.escapeHtml(undefined)).toBe("");
        expect(Utils.escapeHtml("")).toBe("");
        expect(Utils.escapeHtml("<a>&\"")).toBe("&lt;a&gt;&amp;&quot;");
    });

    it("base64Encode 非 Latin-1 输入走 UTF-8 而非抛错", () => {
        expect(Utils.base64Encode("中文abc")).toBe(Buffer.from("中文abc", "utf8").toString("base64"));
        expect(Utils.base64Encode("plain")).toBe(Buffer.from("plain", "utf8").toString("base64"));
    });

    it("normalizeDedupUrl 查询串内的尾斜杠不被去斜杠正则篡改", () => {
        expect(Utils.normalizeDedupUrl("https://a.com/p?u=http://b.com/"))
            .toBe("https://a.com/p?u=http%3A%2F%2Fb.com%2F");
        expect(Utils.normalizeDedupUrl("https://a.com/")).toBe("https://a.com");
        expect(Utils.normalizeDedupUrl("https://a.com/path/")).toBe("https://a.com/path");
    });
});

describe("P4 收敛(c16): NotionSiteUI 销毁后回调与坐标恢复", () => {
    it("panel 为 null 时 updateAIModelOptions 不抛错", () => {
        NotionSiteUI.panel = null;

        expect(() => NotionSiteUI.updateAIModelOptions("openai")).not.toThrow();
    });

    it("源码: 浮钮坐标与面板坐标均不再用 || 吞掉合法 0", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");

        expect(src).not.toMatch(/parseFloat\(pos\.right\) \|\| 24/);
        expect(src).toMatch(/Number\.isFinite\(parsedRight\)/);
        expect(src).toMatch(/Number\.isFinite\(panelRight\)/);
    });

    it("源码: 保存 finally 复位三处 touched 标记", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");

        // 三行必须连续出现(仅 finally 块内为连续序列; loadConfig 处另有 P4 注释隔开)
        expect(src).toMatch(/#ldb-notion-api-key"\)\.dataset\.touched = "false";\s*\n\s*panel\.querySelector\("#ldb-notion-ai-api-key"\)\.dataset\.touched = "false";\s*\n\s*panel\.querySelector\("#ldb-notion-github-token"\)\.dataset\.touched = "false";/);
    });

    it("源码: 加载配置时两密钥输入框 touched 初始为 false", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");

        expect(src).toMatch(/#ldb-notion-ai-api-key"\)\.value = "";\s*\n\s*\/\/ P4 收敛[^\n]*\n\s*panel\.querySelector\("#ldb-notion-ai-api-key"\)\.dataset\.touched = "false";/);
        expect(src).toMatch(/#ldb-notion-github-token"\)\.value = "";\s*\n\s*panel\.querySelector\("#ldb-notion-github-token"\)\.dataset\.touched = "false";/);
    });
});

describe("P4 收敛(c13): events.js 跨闭包标识符与保存失败恢复", () => {
    it("源码: getMimeType 必须从 config 导入(esbuild 会重命名, 裸标识符运行时 ReferenceError)", () => {
        const src = fs.readFileSync("src/ui/events.js", "utf8");

        expect(src).toMatch(/const \{[^}]*\bgetMimeType\b[^}]*\} = require\("\.\.\/config"\)/);
    });

    it("源码: save_command_boundary_settings 失败后恢复导出按钮", () => {
        const src = fs.readFileSync("src/ui/events.js", "utf8");

        expect(src).toMatch(/\.then\(\(\) => true, \(error\) => \{/);
        expect(src).toMatch(/if \(!settingsSaved\) \{\s*restoreExportBtn\(\);/);
    });
});

describe("P4 收敛(c15): MainUI 长任务与防抖定时器", () => {
    it("源码: init 创建 AbortController, destroy 中止并清理 oplog 防抖", () => {
        const src = fs.readFileSync("src/ui/main-ui.js", "utf8");

        expect(src).toMatch(/UI\._abortController = new AbortController\(\)/);
        expect(src).toMatch(/clearTimeout\(UI\._oplogDebounceTimer\)/);
        expect(src).toMatch(/if \(UI\._abortController\?\.signal\?\.aborted\) break;/);
    });

    it("源码: GitHub 凭证判定经 String() 守卫(脏存储值不再抛 TypeError)", () => {
        const src = fs.readFileSync("src/ui/main-ui.js", "utf8");
        const matches = src.match(/String\(Storage\.get\(CONFIG\.STORAGE_KEYS\.GITHUB_(USERNAME|TOKEN), ""\) \?\? ""\)\.trim\(\)/g) || [];

        expect(matches.length).toBe(4);
    });
});

describe("P4 收敛(c17): 跨源候选原型链键与截断顺序", () => {
    it("AI 回传原型链键时回落到 review 预设", () => {
        const wf = WorkspaceInsight.buildWorkspaceConnectionCandidateWorkflow(
            { reason: "同标题" },
            { recommendedAction: "constructor" }
        );

        expect(wf.actionLabel).toBe("人工复核");
        expect(wf.actionNames).toEqual(["人工复核", "复核", "Review"]);
        expect(wf.statusLabel).toBe("待复核");
        expect(wf.nextStep).toBe("人工确认这些来源是否属于同一知识条目。");
    });

    it("合法 action 仍命中自身预设", () => {
        const wf = WorkspaceInsight.buildWorkspaceConnectionCandidateWorkflow({}, { recommendedAction: "merge" });

        expect(wf.actionLabel).toBe("合并整理");
        expect(wf.statusLabel).toBe("待处理");
    });

    it("源码: 跨源候选先过滤后截断(展示列表才 slice 8)", () => {
        const src = fs.readFileSync("src/ui/workspace-visual.js", "utf8");

        expect(src).toMatch(/duplicateCandidatesSorted\n\s*\.filter\(\(group\) => group\.sourceCount > 1\)/);
        expect(src).toMatch(/const duplicateCandidates = duplicateCandidatesSorted\.slice\(0, 8\);/);
    });
});

describe("P4 收敛(c14): GenericUI 陈旧请求与 Markdown 净化", () => {
    it("源码: refreshWorkspaceTargets 的 onProgress/catch 有 isStale 守卫", () => {
        const src = fs.readFileSync("src/ui/generic-ui.js", "utf8");

        expect(src).toMatch(/onProgress: \(progress\) => \{\n\s*\/\/ P4 收敛\(c14\): 陈旧请求不得写状态栏\n\s*if \(!tip \|\| isStale\(\)\) return;/);
        expect(src).toMatch(/if \(tip && !isStale\(\)\) \{/);
    });

    it("源码: 知乎导出链接/作者经 mdLink/mdText 净化", () => {
        const src = fs.readFileSync("src/ui/generic-ui.js", "utf8");

        expect(src).toMatch(/Utils\.mdLink\(title, location\.href\)/);
        expect(src).toMatch(/Utils\.mdText\(content\.author \|\| "未知"\)/);
        expect(src).not.toMatch(/\*\*链接\*\*: \[\$\{title\}\]/);
    });

    it("源码: 切换导出类型清空手输目标 ID", () => {
        const src = fs.readFileSync("src/ui/generic-ui.js", "utf8");

        expect(src).toMatch(/panel\.querySelector\("#gclip-target-id"\)\.value = "";/);
    });
});
