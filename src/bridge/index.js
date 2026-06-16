"use strict";

const { InstallHelper } = require("../api");

var __LD_NOTION_BUILD_BOOKMARK_BRIDGE_START__ = "[LD-NOTION-BUILD:BOOKMARK_BRIDGE_START]";
const BookmarkBridge = {
    _requestId: 0,
    _pendingRequests: {},

    // 检测配套 Chrome 扩展是否已安装
    isExtensionAvailable: () => {
        return !!document.querySelector('meta[name="ld-notion-ext"][content="ready"]');
    },

    // 发起书签请求
    _request: (eventName, detail = {}) => {
        return new Promise((resolve, reject) => {
            if (!BookmarkBridge.isExtensionAvailable()) {
                const installUrl = InstallHelper.getBookmarkExtensionUrl();
                reject(new Error(`未检测到 LD-Notion 书签桥接扩展。请先安装：${installUrl}`));
                return;
            }

            const requestId = `req_${++BookmarkBridge._requestId}_${Date.now()}`;
            const timeout = setTimeout(() => {
                delete BookmarkBridge._pendingRequests[requestId];
                reject(new Error("书签请求超时，请检查扩展是否正常运行。"));
            }, 10000);

            BookmarkBridge._pendingRequests[requestId] = { resolve, reject, timeout };

            window.dispatchEvent(new CustomEvent(eventName, {
                detail: { requestId, ...detail }
            }));
        });
    },

    // 获取书签树
    getBookmarkTree: () => {
        return BookmarkBridge._request("ld-notion-request-bookmarks");
    },

    // 获取指定文件夹的书签
    getBookmarks: (folderId) => {
        return BookmarkBridge._request("ld-notion-request-bookmarks", { folderId });
    },

    // 搜索书签
    searchBookmarks: (query) => {
        return BookmarkBridge._request("ld-notion-search-bookmarks", { query });
    },

    // 初始化响应监听器
    init: () => {
        window.addEventListener("ld-notion-bookmarks-data", (event) => {
            const { requestId, success, data, error } = event.detail || {};
            const pending = BookmarkBridge._pendingRequests[requestId];
            if (!pending) return;

            clearTimeout(pending.timeout);
            delete BookmarkBridge._pendingRequests[requestId];

            if (success) {
                pending.resolve(data);
            } else {
                pending.reject(new Error(error || "书签请求失败"));
            }
        });
    },
};
var __LD_NOTION_BUILD_BOOKMARK_BRIDGE_END__ = "[LD-NOTION-BUILD:BOOKMARK_BRIDGE_END]";

const { BookmarkExporter } = require("./BookmarkExporter");
const { BookmarkAutoImporter } = require("./BookmarkAutoImporter");
const { RSSAutoImporter } = require("./RSSAutoImporter");

module.exports = { BookmarkBridge, BookmarkExporter, BookmarkAutoImporter, RSSAutoImporter };
