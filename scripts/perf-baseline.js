"use strict";

// perf-baseline.js — 性能基线测量(M3 阶段4)。
// 测量目标(可重复, 输出 .workflow/perf-baseline.json):
//   1. renderPanel()        主面板 HTML 生成耗时(单次 ~60KB 模板串)
//   2. buildBookmarkItemHtml 单项生成吞吐(书签列表 chunked 渲染的单位成本)
//   3. BookmarkExporter.exportBookmarks 串行 vs 并发网络往返时延( mocked latency )
// 用法: node scripts/perf-baseline.js

const fs = require("fs");
const path = require("path");

// ---- 最小 DOM/GM stub(仅需满足模块加载 + 模板字符串求值) ----
globalThis.window = globalThis.window || { location: { hostname: "linux.do", href: "https://linux.do/" } };
globalThis.location = globalThis.location || { href: "https://linux.do/" };
globalThis.document = globalThis.document || {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, innerHTML: "" }),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {} },
    head: { appendChild() {} },
};
globalThis.GM_getValue = () => undefined;
globalThis.GM_setValue = () => {};
if (typeof globalThis.navigator === "undefined") {
    try { globalThis.navigator = { userAgent: "node" }; } catch (_) {}
}

const { Utils } = require("../src/utils");
const { renderPanel } = require("../src/ui/panel-template.js");
const { BookmarkExporter } = require("../src/bridge/BookmarkExporter.js");
const { NotionAPI } = require("../src/api");
const { Storage } = require("../src/storage");
const { OperationGuard, OperationLog } = require("../src/security");
const { CONFIG } = require("../src/config");
const { BookmarkList } = require("../src/ui/bookmark-list.js");
const UI = require("../src/ui/main-ui").UI;

function bench(label, fn, iters) {
    // warmup
    fn(); fn();
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) fn();
    const t1 = process.hrtime.bigint();
    const totalMs = Number(t1 - t0) / 1e6;
    const perOp = totalMs / iters;
    return { label, iters, totalMs: +totalMs.toFixed(3), perOpMs: +perOp.toFixed(4) };
}

const results = { timestamp: new Date().toISOString(), node: process.version, cases: [] };

// ---- Case 1: renderPanel ----
results.cases.push(bench("renderPanel(主面板模板生成)", () => renderPanel("助手"), 200));

// ---- Case 2: buildBookmarkItemHtml 单项成本 ----
// 构造 UI 上下文(最小字段) + bookmark-list 混入到 UI
Object.assign(UI, BookmarkList);
UI.selectedBookmarks = new Set();
UI.isBookmarkKeyExported = () => false;
UI.isBookmarkKeyExportedLocal = () => false;
UI.getBookmarkKey = BookmarkList.getBookmarkKey;
const bm = { topic_id: "42", title: "一个用于性能基线的收藏标题示例文字", source: "linuxdo" };
results.cases.push(bench("buildBookmarkItemHtml(单项)", () => UI.buildBookmarkItemHtml(bm, false), 5000));

// ---- Case 3: 导出并发收益 ----
// 固定网络往返延迟 LATENCY_MS;N 项导出。串行基线用历史数据推算(N*latency),
// 并发实际测得 wall-clock。并发=3。
(async () => {
    const LATENCY_MS = 40;
    const N = 30;
    Utils.isBookmarkDedupStrict = () => false;
    Storage.get = (k, d) => (k === CONFIG.STORAGE_KEYS.REQUEST_DELAY ? 0 : d);
    Storage.set = () => {};
    BookmarkExporter.setupDatabaseProperties = async () => ({ success: true });
    BookmarkExporter.getExported = () => ({});
    BookmarkExporter.flushExported = () => {};
    BookmarkExporter.enrichBookmark = async (b) => ({ ...b, generatedTitle: b.title });
    BookmarkExporter.buildProperties = (b) => ({ "链接": { url: b.url } });
    OperationGuard.canExecute = () => true;
    OperationLog.add = () => {};
    NotionAPI.request = async (_m, p) => {
        if (p !== "/pages") throw new Error("unexpected " + p);
        await new Promise((r) => setTimeout(r, LATENCY_MS));
        return { id: "p" };
    };
    const bookmarks = Array.from({ length: N }, (_, i) => ({ url: `https://s-${i}.com/`, title: `t${i}` }));
    const t0 = process.hrtime.bigint();
    const r = await BookmarkExporter.exportBookmarks({ apiKey: "t", databaseId: "db", bookmarks });
    const t1 = process.hrtime.bigint();
    const concurrentMs = Number(t1 - t0) / 1e6;
    const serialEst = N * LATENCY_MS; // 旧实现每项一次往返,无 sleep
    results.cases.push({
        label: `exportBookmarks 并发实测(N=${N}, 往返=${LATENCY_MS}ms, CONCURRENCY=3)`,
        iters: 1,
        totalMs: +concurrentMs.toFixed(2),
        perOpMs: null,
        serialBaselineMs: serialEst,
        speedupX: +(serialEst / concurrentMs).toFixed(2),
        exported: r.exported,
    });

    fs.mkdirSync(path.dirname(".workflow/perf-baseline.json"), { recursive: true });
    fs.writeFileSync(".workflow/perf-baseline.json", JSON.stringify(results, null, 2), "utf8");
    console.log(JSON.stringify(results, null, 2));
})();
