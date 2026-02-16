// LD-Notion Bookmark Bridge - Content Script
// 此脚本在每个页面注入，作为用户脚本与 Chrome Bookmarks API 之间的桥梁

(function () {
    "use strict";

    // 标记扩展已加载
    const marker = document.createElement("meta");
    marker.name = "ld-notion-ext";
    marker.content = "ready";
    document.head.appendChild(marker);

    // 监听来自用户脚本的书签请求
    window.addEventListener("ld-notion-request-bookmarks", async (event) => {
        const { requestId, folderId } = event.detail || {};

        try {
            // 通过 Chrome API 获取书签树
            const tree = await chrome.bookmarks.getTree();

            let result;
            if (folderId) {
                // 获取指定文件夹的子项
                const children = await chrome.bookmarks.getChildren(folderId);
                result = children;
            } else {
                result = tree;
            }

            // 发送结果回用户脚本
            window.dispatchEvent(new CustomEvent("ld-notion-bookmarks-data", {
                detail: { requestId, success: true, data: result }
            }));
        } catch (error) {
            window.dispatchEvent(new CustomEvent("ld-notion-bookmarks-data", {
                detail: { requestId, success: false, error: error.message }
            }));
        }
    });

    // 搜索书签
    window.addEventListener("ld-notion-search-bookmarks", async (event) => {
        const { requestId, query } = event.detail || {};

        try {
            const results = await chrome.bookmarks.search(query || "");
            window.dispatchEvent(new CustomEvent("ld-notion-bookmarks-data", {
                detail: { requestId, success: true, data: results }
            }));
        } catch (error) {
            window.dispatchEvent(new CustomEvent("ld-notion-bookmarks-data", {
                detail: { requestId, success: false, error: error.message }
            }));
        }
    });
})();
