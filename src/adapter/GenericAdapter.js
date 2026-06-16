"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { GenericExtractor } = require("../extract");

const GenericAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "generic",

    async fetchIncremental(watermark) {
        return this._extractFromPage();
    },

    async fetchAll() {
        return this._extractFromPage();
    },

    normalize(raw) {
        return {
            source: "generic",
            id: raw.url || "",
            title: raw.title || "",
            content: raw.description || "",
            url: raw.url || "",
            author: raw.author || "",
            tags: [],
            createdAt: raw.publishDate || "",
            raw,
        };
    },

    getDedupKey(item) {
        return `generic:${item.url}`;
    },

    _extractFromPage() {
        if (!GenericExtractor || typeof GenericExtractor.extractMeta !== "function") return [];
        const meta = GenericExtractor.extractMeta();
        if (!meta || !meta.url) return [];
        return [this.normalize(meta)];
    },
});

module.exports = { GenericAdapter };
