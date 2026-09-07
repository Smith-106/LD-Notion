"use strict";

const { SourceAdapter } = require("./SourceAdapter");
// ISS-20260723-010 W3 (ARCH-005): LinuxDoAPI 已迁回 extract 层，adapter 不再逆向依赖 export。
const { LinuxDoAPI } = require("../extract");
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
        const topicId = raw.topic_id || raw.bookmarkable_id || raw.id || "";
        return {
            source: "linuxdo",
            id: String(topicId),
            title: raw.name || raw.title || "",
            content: "",
            url: topicId ? `https://linux.do/t/${topicId}` : "",
            author: raw.username || "",
            tags: [],
            createdAt: raw.created_at || raw.bookmarked_at || raw.updated_at || "",
            raw,
        };
    },

    getDedupKey(item) {
        // 与 Storage.markTopicExported / isTopicExported 键空间一致(裸 topicId)。
        // 旧实现 `linuxdo:${id}` 与导出账本双轨 → SyncCoordinator 过滤层永不命中已导出项。
        return String(item?.id || "");
    },
});

module.exports = { LinuxDoAdapter };
