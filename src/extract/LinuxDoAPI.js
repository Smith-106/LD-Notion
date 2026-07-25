"use strict";

// LinuxDo (Discourse) 平台数据抓取 API。
// ISS-20260723-010 W3 (ARCH-005): 从 src/export/index.js 迁回 extract 层。
// 原定义在 export 层（src/export/index.js:408-592）造成 adapter→export 逆向依赖
// （src/adapter/LinuxDoAdapter.js:4 require("../export")），与正交分层冲突。
// 此处仅含纯平台抓取方法（_getUsername/fetchJson/fetchBookmarks/fetchAllPosts 等），
// 不含导出编排（Exporter.exportBookmarks/pause/resume 留 export 层，它们操作 Exporter 状态机）。
// 依赖：CONFIG/Utils/Storage/SyncState + userscript 运行时（window/document/fetch，与 ZhihuAPI 同模式）。

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");

const LinuxDoAPI = {
    _getUsername: () => {
        const path = window.location.pathname;
        const match = path.match(/\/u\/([^/]+)/);
        if (match) return match[1];
        const meta = document.querySelector('meta[name="discourse-username"]');
        if (meta?.content) return meta.content;
        const userMenu = document.querySelector('.user-menu .username, .user-menu .d-label');
        if (userMenu) {
            const text = userMenu.textContent?.trim();
            if (text) return text;
        }
        const avatar = document.querySelector('img.avatar');
        if (avatar) {
            const alt = avatar.getAttribute('alt');
            if (alt) return alt;
        }
        return '';
    },

    getRequestOpts: () => {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
        const headers = { "x-requested-with": "XMLHttpRequest" };
        if (csrf) headers["x-csrf-token"] = csrf;
        return { headers };
    },

    fetchJson: async (url, retries = 2) => {
        let lastErr = null;
        const opts = LinuxDoAPI.getRequestOpts();

        for (let i = 0; i <= retries; i++) {
            // 原生 fetch 无默认超时，半开连接/服务器挂起会让 AutoImporter 永久 pending（M2 reliability）。
            // 加 AbortController 15s 超时，abort 触发的 TypeError 被下方 catch 捕获并走重试。
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 15000);
            try {
                const res = await fetch(url, { ...opts, signal: ctrl.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (e) {
                lastErr = e;
                if (i < retries) await Utils.sleep(250 * (i + 1));
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastErr || new Error("fetchJson failed");
    },

    // 获取收藏列表
    fetchBookmarks: async (username, page = 0) => {
        const url = `${window.location.origin}/u/${username}/bookmarks.json?page=${page}`;
        const data = await LinuxDoAPI.fetchJson(url);
        return data;
    },

    getBookmarkId: (bookmark) => String(bookmark?.topic_id || bookmark?.bookmarkable_id || ""),

    getBookmarkSyncTime: (bookmark) => bookmark?.created_at || bookmark?.bookmarked_at || bookmark?.updated_at || "",

    // 获取所有收藏
    fetchAllBookmarks: async (username, onProgress) => {
        const allBookmarks = [];
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            const data = await LinuxDoAPI.fetchBookmarks(username, page);
            const bookmarks = data.user_bookmark_list?.bookmarks || [];

            if (bookmarks.length === 0) {
                hasMore = false;
            } else {
                allBookmarks.push(...bookmarks);
                page++;
                if (onProgress) onProgress(allBookmarks.length);

                // 检查是否还有更多
                hasMore = data.user_bookmark_list?.more_bookmarks_url != null;
                const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
                await Utils.sleep(delay); // 避免请求过快
            }
        }

        return allBookmarks;
    },

    fetchBookmarksSince: async (username, watermark, onProgress) => {
        const newBookmarks = [];
        let page = 0;
        let hasMore = true;

        while (hasMore) {
            const data = await LinuxDoAPI.fetchBookmarks(username, page);
            const bookmarks = data.user_bookmark_list?.bookmarks || [];

            if (bookmarks.length === 0) {
                hasMore = false;
                continue;
            }

            const batch = SyncState.filterOrderedItems(
                bookmarks,
                watermark,
                LinuxDoAPI.getBookmarkSyncTime,
                LinuxDoAPI.getBookmarkId
            );
            newBookmarks.push(...batch);

            if (onProgress) onProgress(newBookmarks.length);
            if (batch.length < bookmarks.length) break;

            hasMore = data.user_bookmark_list?.more_bookmarks_url != null;
            page++;
            const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
            await Utils.sleep(delay);
        }

        return newBookmarks;
    },

    // 获取帖子详情
    fetchTopicDetail: async (topicId) => {
        const url = `${window.location.origin}/t/${topicId}.json`;
        return await LinuxDoAPI.fetchJson(url);
    },

    // 获取帖子所有楼层
    fetchAllPosts: async (topicId, onProgress) => {
        const opts = LinuxDoAPI.getRequestOpts();

        // 获取所有帖子 ID
        const idData = await LinuxDoAPI.fetchJson(
            `${window.location.origin}/t/${topicId}/post_ids.json?post_number=0&limit=99999`
        );
        let postIds = idData.post_ids || [];

        // 获取主题详情
        const mainData = await LinuxDoAPI.fetchJson(`${window.location.origin}/t/${topicId}.json`);
        const mainFirstPost = mainData.post_stream?.posts?.[0];
        if (mainFirstPost && !postIds.includes(mainFirstPost.id)) {
            postIds.unshift(mainFirstPost.id);
        }

        const opUsername = mainData?.details?.created_by?.username || mainData?.post_stream?.posts?.[0]?.username || "";

        const topic = {
            topicId: String(topicId),
            title: mainData?.title || "",
            category: mainData?.category_id ? `分类ID: ${mainData.category_id}` : "",
            categoryName: "",
            tags: mainData?.tags || [],
            url: `${window.location.origin}/t/${topicId}`,
            opUsername: opUsername,
            createdAt: mainData?.created_at || "",
            postsCount: mainData?.posts_count || 0,
            likeCount: mainData?.like_count || 0,
            views: mainData?.views || 0,
        };

        // 尝试获取分类名称
        const categoryBadge = document.querySelector(`.badge-category[data-category-id="${mainData.category_id}"]`);
        if (categoryBadge) {
            topic.categoryName = categoryBadge.textContent.trim();
        }

        // 分批获取帖子详情
        let allPosts = [];
        for (let i = 0; i < postIds.length; i += 200) {
            const chunk = postIds.slice(i, i + 200);
            const q = chunk.map((id) => `post_ids[]=${encodeURIComponent(id)}`).join("&");
            const data = await LinuxDoAPI.fetchJson(
                `${window.location.origin}/t/${topicId}/posts.json?${q}&include_suggested=false`
            );
            const posts = data.post_stream?.posts || [];
            allPosts = allPosts.concat(posts);

            if (onProgress) onProgress(Math.min(i + 200, postIds.length), postIds.length);
        }

        allPosts.sort((a, b) => a.post_number - b.post_number);
        return { topic, posts: allPosts };
    },
};

module.exports = { LinuxDoAPI };
