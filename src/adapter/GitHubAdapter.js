"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { GitHubAPI } = require("../import");
const { SyncState } = require("../storage");
const { CONFIG } = require("../config");
const { Storage } = require("../storage");

/**
 * GitHubAdapter — 支持 stars/repos/forks/gists 四种子类型
 * @param {string} subType - 'stars' | 'repos' | 'forks' | 'gists'
 */
function createGitHubAdapter(subType) {
    const adapter = Object.assign(Object.create(SourceAdapter), {
        sourceType: `github-${subType}`,
        subType,

        async fetchIncremental(watermark) {
            const rawItems = await this._fetchByType();
            // 使用 SyncState 过滤水位线之后的条目
            if (watermark && watermark.time) {
                return SyncState.filterOrderedItems(
                    rawItems,
                    watermark,
                    this._getTime.bind(this),
                    this._getId.bind(this)
                ).map((item) => this.normalize(item));
            }
            return rawItems.map((item) => this.normalize(item));
        },

        async fetchAll() {
            const rawItems = await this._fetchByType();
            return rawItems.map((item) => this.normalize(item));
        },

        normalize(raw) {
            return {
                source: "github",
                id: String(raw.full_name || raw.id || ""),
                title: raw.full_name || raw.description || "",
                content: raw.description || "",
                url: raw.html_url || "",
                author: (raw.owner && raw.owner.login) || "",
                tags: raw.language ? [`lang:${raw.language}`] : [],
                createdAt: raw.starred_at || raw.pushed_at || raw.updated_at || raw.created_at || "",
                raw,
            };
        },

        getDedupKey(item) {
            return `github:${subType}:${item.id}`;
        },

        _getTime(raw) {
            if (subType === "stars") return raw.starred_at || "";
            if (subType === "repos") return raw.pushed_at || raw.updated_at || "";
            if (subType === "forks") return raw.pushed_at || raw.updated_at || "";
            if (subType === "gists") return raw.updated_at || raw.created_at || "";
            return "";
        },

        _getId(raw) {
            return String(raw.full_name || raw.id || "");
        },

        async _fetchByType() {
            const username = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
            const token = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
            if (subType === "stars") return GitHubAPI.fetchStarredRepos(username, token);
            if (subType === "repos") return GitHubAPI.fetchUserRepos(username, token);
            if (subType === "forks") return GitHubAPI.fetchForkedRepos(username, token);
            if (subType === "gists") return GitHubAPI.fetchUserGists(username, token);
            return [];
        },
    });

    return adapter;
}

module.exports = { createGitHubAdapter };
