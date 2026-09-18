"use strict";

// github-obsidian-export.js — GitHub→Obsidian/Notion 导出转发壳 (M3 波次8, ISS-015 职责域)。
// 提取自 main-ui.js (~26 LOC): 五个 GitHub 选中项导出方法,实现均在
// src/import/github-obsidian-service.js;本文件仅转发并注入 Exporter 暂停/取消状态。
// 经 Object.assign(UI, GitHubObsidianExport) mixin 挂到 UI。

const { Exporter } = require("../export");

const GitHubObsidianExport = {
    sanitizeObsidianFileName: (name, fallback = "untitled") => {
        return require("../import/github-obsidian-service").sanitizeObsidianFileName(name, fallback);
    },

    buildGitHubObsidianMarkdown: async (item, settings = {}) => {
        return require("../import/github-obsidian-service").buildGitHubObsidianMarkdown(item, settings);
    },

    exportGitHubSelectedToObsidian: async (selectedItems, settings, onProgress) => {
        const { exportGitHubSelectedToObsidian } = require("../import/github-obsidian-service");
        return exportGitHubSelectedToObsidian(selectedItems, settings, onProgress, {
            get isCancelled() { return Exporter.isCancelled; },
            get isPaused() { return Exporter.isPaused; },
        });
    },

    mapGitHubItemsToBookmarks: (items, sourceType) => {
        return require("../import/github-obsidian-service").mapGitHubItemsToBookmarks(items, sourceType);
    },

    exportGitHubSelected: async (selectedItems, settings, onProgress) => {
        return require("../import/github-obsidian-service").exportGitHubSelectedToNotion(selectedItems, settings, onProgress, {
            get isCancelled() { return Exporter.isCancelled; },
            get isPaused() { return Exporter.isPaused; },
        });
    },
};

module.exports = { GitHubObsidianExport };
