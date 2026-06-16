"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { RSSAutoImporter } = require("../bridge");

const RSSAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "rss",

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
