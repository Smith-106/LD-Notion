"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { ZhihuAPI } = require("../extract");

const ZhihuAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "zhihu",

    async fetchIncremental(watermark) {
        return this._extractFromPage();
    },

    async fetchAll() {
        return this._extractFromPage();
    },

    normalize(raw) {
        return {
            source: "zhihu",
            id: raw.url || (typeof window !== "undefined" ? window.location.href : ""),
            title: raw.title || "",
            content: raw.html || "",
            url: raw.url || (typeof window !== "undefined" ? window.location.href : ""),
            author: raw.author || "",
            tags: raw.tags || [],
            createdAt: raw.publishDate || "",
            raw,
        };
    },

    getDedupKey(item) {
        return `zhihu:${item.id}`;
    },

    _extractFromPage() {
        if (!ZhihuAPI || typeof ZhihuAPI.detectPage !== "function") return [];
        const pageType = ZhihuAPI.detectPage();
        if (!pageType) return [];
        const content = ZhihuAPI.extractContent();
        if (!content) return [];
        return [this.normalize(content)];
    },
});

module.exports = { ZhihuAdapter };
