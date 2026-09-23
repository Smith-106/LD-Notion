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
        if (match) return decodeURIComponent(match[1]);
        const meta = document.querySelector('meta[name="discourse-username"]');
        if (meta?.content) return meta.content.trim();
        // 对齐 LDStatusPro _getUserFromDom: 头部当前用户链接(含 data-user-card 回退)。
        // 原实现仅认 .user-menu(新版 Discourse 头部已改 .d-header-icons .current-user),
        // 在收藏页/话题页均取不到用户名 → fetchBookmarksSince username 为空直接返回 []。
        const userLink = document.querySelector('.current-user a[href^="/u/"]')
            || document.querySelector('.d-header-icons .current-user a[href^="/u/"]')
            || document.querySelector('.header-dropdown-toggle.current-user[href^="/u/"]');
        if (userLink) {
            const href = userLink.getAttribute('href') || '';
            const hrefMatch = href.match(/\/u\/([^/?#]+)/);
            if (hrefMatch && /^[A-Za-z0-9_.-]+$/.test(decodeURIComponent(hrefMatch[1]))) {
                return decodeURIComponent(hrefMatch[1]);
            }
            const card = (userLink.getAttribute('data-user-card') || '').trim();
            if (card) return card;
        }
        // 对齐 LDStatusPro _getUserFromDiscourse: Ember 全局当前用户。
        try {
            const discourseUser = window.Discourse?.User?.current?.();
            const name = (discourseUser?.username || '').trim();
            if (name) return name;
        } catch (e) {
            console.warn('[LD-Notion] Discourse 用户名探测失败:', e);
        }
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
        // 对齐 LDStatusPro 可用实现: Discourse 登录态 API 必须显式携带站点鉴权头。
        // 原生 fetch 同源默认 credentials=same-origin, 但 Tampermonkey 沙箱/GM 上下文下
        // cookie 可能不被携带 → bookmarks.json 等登录态接口 403/401 → "无法导出帖子"。
        // 故此处与 LDStatusPro 同口径显式声明 credentials:include + Accept +
        // X-Requested-With + Discourse-Present/Logged-In(见 收藏页面源码/源码.txt 实证)。
        const headers = {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
            "Discourse-Present": "true",
            "Discourse-Logged-In": "true",
        };
        if (csrf) headers["X-CSRF-Token"] = csrf;
        return { headers, credentials: "include" };
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
                // 400/401/403/404 为客户端错误(404 = 已删除/不存在, 永久性), 退避重试无意义
                const msg = String(e && e.message || e || "");
                if (/\bHTTP\s+40[0134]\b/.test(msg)) throw e;
                // 铁律⑩: 指数退避 1000*2^attempt(此前线性 250*(i+1), 全盘审计 find 修正)
                if (i < retries) await Utils.sleep(1000 * Math.pow(2, i));
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastErr || new Error("fetchJson failed");
    },

    // 获取收藏列表(新版 Discourse serializer 字段: id/title/fancy_title/topic_id/
    // bookmarkable_id/bookmarkable_type/bookmarkable_url/excerpt/bumped_at/slug).
    // Post 收藏时 bookmarkable_id=postId 而 topic_id=话题 ID —— 下游 exportTopic 必须用
    // resolveTopicId 取话题 ID(否则 /t/{postId}.json 404 → 单帖导出失败)。
    fetchBookmarks: async (username, page = 0) => {
        const url = `${window.location.origin}/u/${encodeURIComponent(username)}/bookmarks.json?page=${page}`;
        const data = await LinuxDoAPI.fetchJson(url);
        return data;
    },

    // 从 bookmark 项解析话题 ID: topic_id 优先(Post/Topic 收藏均有) → bookmarkable_url
    // 尾段数字(/t/slug/123 或 /t/123/45 取话题段) → Topic 收藏的 bookmarkable_id。
    // Post 收藏 bookmarkable_id 为 postId, 不可直接作为话题 ID(旧实现误用致 404)。
    resolveTopicId: (bookmark) => {
        const direct = bookmark?.topic_id;
        if (direct !== undefined && direct !== null && String(direct) !== '') return String(direct);
        const rawUrl = bookmark?.bookmarkable_url || bookmark?.url || '';
        if (rawUrl) {
            try {
                const path = new URL(String(rawUrl), window.location.origin).pathname;
                const segs = path.split('/').filter(Boolean);
                const tIndex = segs.indexOf('t');
                if (tIndex >= 0) {
                    const numeric = segs.slice(tIndex + 1).find((seg) => /^\d+$/.test(seg));
                    if (numeric) return numeric;
                }
            } catch { /* 相对 URL 解析失败则走 Topic 回退 */ }
        }
        if (String(bookmark?.bookmarkable_type || '').toLowerCase() === 'topic' && bookmark?.bookmarkable_id) {
            return String(bookmark.bookmarkable_id);
        }
        return String(bookmark?.bookmarkable_id || bookmark?.id || '');
    },

    getBookmarkId: (bookmark) => LinuxDoAPI.resolveTopicId(bookmark),

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

    // 获取帖子所有楼层(含 403 登录态诊断: 未登录/cookie 缺失时 Discourse 返回 403,
    // 原实现仅抛 HTTP 403, 用户看到"导出失败"无从下手; 此处给出可行动提示)。
    fetchAllPosts: async (topicId, onProgress) => {
        const opts = LinuxDoAPI.getRequestOpts();
        const failHint = '可能未登录或登录态失效: 请确认已在 linux.do 登录后重试';

        // 获取所有帖子 ID
        let idData;
        try {
            idData = await LinuxDoAPI.fetchJson(
                `${window.location.origin}/t/${topicId}/post_ids.json?post_number=0&limit=99999`
            );
        } catch (e) {
            if (/\bHTTP\s+40[13]\b/.test(String(e?.message || e))) {
                throw new Error(`获取帖子列表失败(${e.message}), ${failHint}`);
            }
            throw e;
        }
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
