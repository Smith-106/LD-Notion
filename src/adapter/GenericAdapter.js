"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { GenericExtractor } = require("../extract");
const { Utils } = require("../utils");

const GenericAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "generic",

    async fetchIncremental(watermark) {
        return this._extractFromPage();
    },

    async fetchAll() {
        return this._extractFromPage();
    },

    normalize(raw) {
        const url = Utils.normalizeDedupUrl(raw.url || "");
        return {
            source: "generic",
            id: url,
            title: raw.title || "",
            content: raw.description || "",
            url,
            author: raw.author || "",
            tags: [],
            createdAt: raw.publishDate || "",
            raw,
        };
    },

    getDedupKey(item) {
        // Clipper URL query/hash variance → same page must share one DedupStore key
        const url = Utils.normalizeDedupUrl(item.url || item.id || "");
        return `generic:${url}`;
    },

    _extractFromPage() {
        if (!GenericExtractor || typeof GenericExtractor.extractMeta !== "function") return [];
        const meta = GenericExtractor.extractMeta();
        if (!meta || !meta.url) return [];
        return [this.normalize(meta)];
    },
});

module.exports = { GenericAdapter };
