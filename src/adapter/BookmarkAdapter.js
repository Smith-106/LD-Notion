"use strict";

const { SourceAdapter } = require("./SourceAdapter");

// 不再顶部 require("../bridge")。adapter/index → BookmarkAdapter → bridge →
// BookmarkAutoImporter → SyncCoordinator → adapter/index 构成结构性循环，
// 顶部 require 会让 BookmarkAdapter 在 bridge 部分加载时拿到空的 BookmarkBridge。
// 改由 adapter/index.js 注册时注入 lazy bridge accessor（运行时整张模块图已加载）。
// _bridgeAccessor 未注入时（如契约测试只取对象不注册）走 fallback 顶层 require，
// 保证向后兼容。
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
            createdAt: raw.dateAdded ? new Date(raw.dateAdded / 1000).toISOString() : "",
            raw,
        };
    },

    getDedupKey(item) {
        return `bookmark:${item.id}`;
    },

    async _fetchAndFilter(watermark) {
        const { BookmarkBridge, BookmarkExporter } = this._getBridge();
        if (!BookmarkBridge || !BookmarkBridge.isExtensionAvailable()) return [];
        const tree = await BookmarkBridge.getBookmarkTree();
        // 扁平化书签树
        const flat = BookmarkBridge.flattenTree ? BookmarkBridge.flattenTree(tree) : this._flattenTree(tree);
        const items = flat
            .filter((b) => b.url && BookmarkExporter && BookmarkExporter.isHttpUrl ? BookmarkExporter.isHttpUrl(b.url) : /^https?:\/\//i.test(b.url || ""))
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
