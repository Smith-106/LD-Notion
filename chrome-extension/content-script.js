// LD-Notion Bookmark Bridge - Content Script
// 此脚本在每个页面注入，作为用户脚本与 Chrome Bookmarks API 之间的桥梁

(function () {
    "use strict";

    const LD_NOTION_ACTIVE_ROOT_SELECTOR = "[data-ldb-root], .ldb-panel, .ldb-notion-panel, .gclip-panel";

    function getBridgeHost() {
        return document.head || document.documentElement;
    }

    function hasActiveLdNotionRoot() {
        return !!document.querySelector(LD_NOTION_ACTIVE_ROOT_SELECTOR);
    }

    function dispatchBridgeResponse(detail) {
        window.dispatchEvent(new CustomEvent("ld-notion-bookmarks-data", { detail }));
    }

    function rejectBridgeRequest(requestId, error) {
        if (!requestId) return;
        dispatchBridgeResponse({
            requestId,
            success: false,
            error: error || "书签请求失败"
        });
    }

    // 标记扩展已加载
    const marker = document.createElement("meta");
    marker.name = "ld-notion-ext";
    marker.content = "ready";
    const bridgeHost = getBridgeHost();
    if (bridgeHost) {
        bridgeHost.appendChild(marker);
    }

    // 监听来自用户脚本的书签请求
    window.addEventListener("ld-notion-request-bookmarks", async (event) => {
        const { requestId, folderId } = event.detail || {};
        if (!requestId) return;
        if (!hasActiveLdNotionRoot()) {
            rejectBridgeRequest(requestId, "未检测到活动中的 LD-Notion 面板，已拒绝书签桥接请求。");
            return;
        }

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
            dispatchBridgeResponse({ requestId, success: true, data: result });
        } catch (error) {
            rejectBridgeRequest(requestId, error?.message || String(error));
        }
    });

    // 搜索书签
    window.addEventListener("ld-notion-search-bookmarks", async (event) => {
        const { requestId, query } = event.detail || {};
        if (!requestId) return;
        if (!hasActiveLdNotionRoot()) {
            rejectBridgeRequest(requestId, "未检测到活动中的 LD-Notion 面板，已拒绝书签桥接请求。");
            return;
        }

        try {
            const results = await chrome.bookmarks.search(query || "");
            dispatchBridgeResponse({ requestId, success: true, data: results });
        } catch (error) {
            rejectBridgeRequest(requestId, error?.message || String(error));
        }
    });
})();
