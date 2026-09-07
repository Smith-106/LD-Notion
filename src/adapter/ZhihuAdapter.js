"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { ZhihuAPI } = require("../extract");
const { Utils } = require("../utils");

const ZhihuAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "zhihu",

    async fetchIncremental(watermark) {
        return this._extractFromPage();
    },

    async fetchAll() {
        return this._extractFromPage();
    },

    normalize(raw) {
        const rawUrl = raw.url || (typeof window !== "undefined" ? window.location.href : "");
        const url = Utils.normalizeDedupUrl(rawUrl);
        return {
            source: "zhihu",
            id: url,
            title: raw.title || "",
            content: raw.html || "",
            url,
            author: raw.author || "",
            tags: raw.tags || [],
            createdAt: raw.publishDate || "",
            raw,
        };
    },

    getDedupKey(item) {
        // Clipper URL query/hash variance → same answer must share one DedupStore key
        const url = Utils.normalizeDedupUrl(item.id || item.url || "");
        return `zhihu:${url}`;
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
