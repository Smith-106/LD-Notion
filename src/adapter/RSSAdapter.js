"use strict";

const { SourceAdapter } = require("./SourceAdapter");

// 不再顶部 require("../bridge")。adapter/index → RSSAdapter → bridge →
// RSSAutoImporter → SyncCoordinator → adapter/index 构成结构性循环，
// 顶部 require 会让 RSSAdapter 在 bridge 部分加载时拿到空的 RSSAutoImporter。
// 改由 adapter/index.js 注册时注入 lazy bridge accessor（运行时整张模块图已加载）。
// _bridgeAccessor 未注入时（如契约测试只取对象不注册）走 fallback 顶层 require，
// 保证向后兼容。
const RSSAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "rss",

    // 注入的 lazy bridge accessor；adapter/index.js 注册时设置。
    _bridgeAccessor: null,

    // 运行时解析 bridge 模块（RSSAutoImporter）。
    _getBridge() {
        if (this._bridgeAccessor) return this._bridgeAccessor() || {};
        // fallback：未注入时顶层 require（此时整张模块图已加载，安全）。
        return require("../bridge");
    },

    async fetchIncremental(watermark) {
        return this._fetchItems(watermark);
    },

    async fetchAll() {
        return this._fetchItems(null);
    },

    normalize(raw) {
        return {
            source: "rss",
            id: raw.guid || raw.link || "",
            title: raw.title || "",
            content: raw.content || raw.summary || "",
            url: raw.link || "",
            author: raw.creator || raw.author || "",
            tags: raw.categories || [],
            createdAt: raw.pubDate || raw.isoDate || "",
            raw,
        };
    },

    getDedupKey(item) {
        return `rss:${item.id}`;
    },

    async _fetchItems(watermark) {
        const { RSSAutoImporter } = this._getBridge();
        if (!RSSAutoImporter || typeof RSSAutoImporter.getFeedUrls !== "function") return [];
        const feedUrls = RSSAutoImporter.getFeedUrls();
        const allItems = [];
        const results = await Promise.allSettled(
            feedUrls.map((feedUrl) => RSSAutoImporter.fetchFeed(feedUrl))
        );
        for (const result of results) {
            if (result.status === "fulfilled" && Array.isArray(result.value?.items)) {
                allItems.push(...result.value.items);
            }
            // 单个 feed 失败不阻塞
        }
        const normalized = allItems.map((item) => this.normalize(item));
        // watermark 过滤: 仅保留 watermark.time 之后发布的条目
        if (watermark && watermark.time) {
            return normalized.filter((item) => {
                const itemTime = item.createdAt;
                if (!itemTime) return true; // 无时间戳的条目保留
                return itemTime > watermark.time;
            });
        }
        return normalized;
    },
});

module.exports = { RSSAdapter };
