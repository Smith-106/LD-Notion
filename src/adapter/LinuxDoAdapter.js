"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { LinuxDoAPI } = require("../export");
const { SyncState } = require("../storage");

const LinuxDoAdapter = Object.assign(Object.create(SourceAdapter), {
    sourceType: "linuxdo",

    async fetchIncremental(watermark) {
        const username = LinuxDoAPI._getUsername ? LinuxDoAPI._getUsername() : "";
        if (!username) return [];
        const rawItems = await LinuxDoAPI.fetchBookmarksSince(username, watermark);
        return rawItems.map((item) => this.normalize(item));
    },

    async fetchAll() {
        const username = LinuxDoAPI._getUsername ? LinuxDoAPI._getUsername() : "";
        if (!username) return [];
        const rawItems = await LinuxDoAPI.fetchAllBookmarks(username);
        return rawItems.map((item) => this.normalize(item));
    },

    normalize(raw) {
        return {
            source: "linuxdo",
            id: String(raw.topic_id || raw.bookmarkable_id || ""),
            title: raw.name || raw.title || "",
            content: "",
            url: raw.topic_id ? `https://linux.do/t/${raw.topic_id}` : "",
            author: raw.username || "",
            tags: [],
            createdAt: raw.created_at || raw.bookmarked_at || raw.updated_at || "",
            raw,
        };
    },

    getDedupKey(item) {
        return `linuxdo:${item.id}`;
    },
});

module.exports = { LinuxDoAdapter };
