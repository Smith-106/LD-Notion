"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { BookmarkBridge } = require("../bridge");

const BookmarkAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "bookmark",

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
        if (!BookmarkBridge.isExtensionAvailable()) return [];
        const tree = await BookmarkBridge.getBookmarkTree();
        // 扁平化书签树
        const flat = BookmarkBridge.flattenTree ? BookmarkBridge.flattenTree(tree) : this._flattenTree(tree);
        const items = flat
            .filter((b) => b.url && BookmarkExporter && BookmarkExporter.isHttpUrl ? BookmarkExporter.isHttpUrl(b.url) : /^https?:/.test(b.url || ""))
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
