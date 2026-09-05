"use strict";

const { SourceAdapter } = require("./SourceAdapter");

// 不再顶部 require("../bridge")。adapter/index → BookmarkAdapter → bridge →
// BookmarkAutoImporter → SyncCoordinator → adapter/index 构成结构性循环，
// 顶部 require 会让 BookmarkAdapter 在 bridge 部分加载时拿到空的 BookmarkBridge。
// 改由 adapter/index.js 注册时注入 lazy bridge accessor（运行时整张模块图已加载）。
// _bridgeAccessor 未注入时（如契约测试只取对象不注册）走 fallback 顶层 require，
// 保证向后兼容。
//
// T10 (F5 循环依赖修复): 双 require 已统一为 _bridgeAccessor lazy 模式。
// ensureAdaptersRegistered() 在 adapter/index.js 中调用，确保所有适配器
// 在首次使用前已注册到 AdapterRegistry。调用时机：main.js init 阶段。
const BookmarkAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "bookmark",

    // 注入的 lazy bridge accessor；adapter/index.js 注册时设置。
    _bridgeAccessor: null,

    // 运行时解析 bridge 模块（BookmarkBridge + BookmarkExporter）。
    _getBridge() {
        if (this._bridgeAccessor) return this._bridgeAccessor() || {};
        // fallback：未注入时顶层 require（此时整张模块图已加载，安全）。
        return require("../bridge");
    },

    async fetchIncremental(watermark) {
        return this._fetchAndFilter(watermark);
    },

    async fetchAll() {
        return this._fetchAndFilter(null);
    },

    normalize(raw) {
        return {
            source: "bookmark",
            id: String(raw.id || ""),
            title: raw.title || "",
            content: "",
            url: raw.url || "",
            author: "",
            tags: [],
            // F5 共识(R11 实证): Chrome bookmarks API dateAdded 为毫秒,
            // 旧代码 /1000 把 2025 毫秒压成 1970 年 → 增量过滤恒 false →
            // SyncCoordinator 首轮后冻结、去重层失效。毫秒直传即可。
            // 非法日期兜底: toISOString 对 RangeError 输入抛错致整次同步失败(全盘审计 find 16)
            createdAt: (() => {
                if (!raw.dateAdded) return "";
                const d = new Date(raw.dateAdded);
                return Number.isNaN(d.getTime()) ? "" : d.toISOString();
            })(),
            raw,
        };
    },

    getDedupKey(item) {
        // F14 共识: 空 id 用 url 兜底, 防 bookmark: 空键碰撞误杀
        return `bookmark:${item.id || item.url || ""}`;
    },

    async _fetchAndFilter(watermark) {
        const { BookmarkBridge, BookmarkExporter } = this._getBridge();
        if (!BookmarkBridge || !BookmarkBridge.isExtensionAvailable()) return [];
        const tree = await BookmarkBridge.getBookmarkTree();
        // 扁平化书签树
        const flat = BookmarkBridge.flattenTree ? BookmarkBridge.flattenTree(tree) : this._flattenTree(tree);
        // isHttpUrl 直接用 BookmarkExporter 实现（L6 maintainability：移除冗余 typeof-guard + 正则
        // fallback 双路径，esbuild 自由变量反模式残留）。BookmarkExporter 由 _getBridge 运行时解析。
        const isHttpUrl = (url) => BookmarkExporter?.isHttpUrl?.(url) ?? /^https?:\/\//i.test(url || "");
        const items = flat
            .filter((b) => b.url && isHttpUrl(b.url))
            .map((b) => this.normalize(b));
        if (watermark && watermark.time) {
            return items.filter((item) => item.createdAt > watermark.time);
        }
        return items;
    },

    _flattenTree(nodes, parentPath) {
        const result = [];
        if (!Array.isArray(nodes)) return result;
        for (const node of nodes) {
            if (node.url) {
                result.push({ ...node, folderPath: parentPath || "" });
            }
            if (node.children) {
                result.push(...this._flattenTree(node.children, (parentPath ? parentPath + "/" : "") + (node.title || "")));
            }
        }
        return result;
    },
});

module.exports = { BookmarkAdapter };
