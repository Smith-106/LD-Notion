"use strict";

const { CONFIG, MSG, getFileCategory } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { NotionAPI, DOMToNotion, HTMLToMarkdown, ObsidianAPI, SiteDetector, EMOJI_MAP } = require("../api");
const { OperationGuard, UndoManager, OperationLog } = require("../security");
const { BookmarkExporter } = require("../bridge");
const { ZhihuAPI } = require("../extract");

const GenericExporter = {
    resolveUnifiedSource: (meta = {}) => {
        const explicitSource = GenericExporter.normalizeSourceLabel(meta.source || "");
        if (explicitSource) return explicitSource;
        const siteDerived = GenericExporter.normalizeSourceLabel(meta.siteName || "");
        return siteDerived === "知乎" ? "知乎" : "通用页面";
    },

    normalizeSourceLabel: (value) => {
        const raw = BookmarkExporter.normalizeText(String(value || "").trim(), 100);
        if (!raw) return "";
        const lower = raw.toLowerCase();
        if (lower.includes("zhihu") || raw.includes("知乎")) return "知乎";
        return raw;
    },

    normalizeSourceTypeLabel: (value, source = "") => {
        const raw = BookmarkExporter.normalizeText(String(value || "").trim(), 40);
        if (!raw) {
            if (source === "知乎") return "网页";
            return "网页";
        }

        const lower = raw.toLowerCase();
        if (["answer", "回答"].includes(lower) || raw.includes("回答")) return "回答";
        if (["question", "问题", "问答"].includes(lower) || raw.includes("问题") || raw.includes("问答")) return "问题";
        if (["article", "column_article", "文章", "专栏文章"].includes(lower) || raw.includes("文章")) return "文章";
        if (["web", "webpage", "web page", "page", "网页"].includes(lower) || raw.includes("网页")) return "网页";
        return raw;
    },

    stripHtml: (html) => BookmarkExporter.normalizeText(
        String(html || "")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " "),
        500
    ),

    extractSummaryText: (meta = {}) => {
        const chunks = [
            meta.description,
            meta.detail,
            meta.html,
            ...(Array.isArray(meta.answers) ? meta.answers.map((answer) => answer?.html || "") : []),
        ];

        for (const chunk of chunks) {
            const text = GenericExporter.stripHtml(chunk);
            if (text) return text;
        }
        return "";
    },

    inferTags: (meta = {}) => {
        const tags = [];
        const source = GenericExporter.normalizeSourceLabel(meta.source || meta.siteName || "");
        const sourceType = GenericExporter.normalizeSourceTypeLabel(meta.sourceType || "", source);

        try {
            const host = new URL(meta.url || "").hostname.replace(/^www\./, "");
            if (host) tags.push(host);
        } catch {
            // ignore invalid URL in tag inference
        }

        if (source) tags.push(source);
        if (sourceType) tags.push(sourceType);
        if (meta.siteName && meta.siteName !== source) {
            tags.push(BookmarkExporter.normalizeText(meta.siteName, 60));
        }

        const uniq = [];
        for (const tag of tags) {
            const clean = BookmarkExporter.normalizeText(tag, 80);
            if (!clean || uniq.includes(clean)) continue;
            uniq.push(clean);
            if (uniq.length >= 8) break;
        }
        return uniq;
    },

    enrichMeta: async (meta = {}, settings = {}) => {
        const source = GenericExporter.resolveUnifiedSource(meta);
        const siteName = BookmarkExporter.normalizeText(meta.siteName || "", 100) || source;
        const sourceType = GenericExporter.normalizeSourceTypeLabel(meta.sourceType || "", source);
        const description = GenericExporter.extractSummaryText(meta);

        const enriched = {
            ...meta,
            title: BookmarkExporter.normalizeText(meta.title || "无标题", 200) || "无标题",
            url: String(meta.url || location.href || "").trim(),
            author: BookmarkExporter.normalizeText(meta.author || "", 100),
            publishDate: BookmarkExporter.normalizeText(meta.publishDate || "", 40),
            siteName,
            source,
            sourceType,
            description,
        };

        const insight = {
            title: enriched.title,
            summary: enriched.description || "",
            siteName: enriched.siteName || enriched.source || "",
        };
        const bookmarkLike = {
            title: enriched.title,
            url: enriched.url,
            folderPath: `${enriched.source} ${enriched.sourceType}`.trim(),
        };

        let inferredCategory = BookmarkExporter.inferCategoryHeuristic(
            bookmarkLike,
            insight,
            settings?.categories || []
        );
        const canUseAI = !!(
            settings?.aiApiKey
            && settings?.aiService
            && Array.isArray(settings?.categories)
            && settings.categories.length > 0
        );
        if (canUseAI) {
            const aiCategory = await BookmarkExporter.generateAICategory(bookmarkLike, insight, settings);
            if (aiCategory) inferredCategory = aiCategory;
        }

        return {
            ...enriched,
            inferredCategory,
            inferredTags: GenericExporter.inferTags(enriched),
        };
    },

    // 构建通用网页的 Notion 属性
    buildProperties: (meta) => {
        const source = GenericExporter.resolveUnifiedSource(meta);
        const sourceType = GenericExporter.normalizeSourceTypeLabel(meta.sourceType || "", source);
        const props = {
            "标题": {
                title: [{ text: { content: meta.title || "无标题" } }]
            },
            "链接": {
                url: meta.url
            },
            "来源": {
                rich_text: [{ text: { content: source } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: sourceType } }]
            },
            "作者": {
                rich_text: [{ text: { content: meta.author || "" } }]
            },
        };
        if (meta.publishDate) {
            props["发布日期"] = { date: { start: meta.publishDate } };
        }
        if (meta.description) {
            props["摘要"] = {
                rich_text: [{ text: { content: meta.description.substring(0, 2000) } }]
            };
        }
        if (meta.inferredCategory) {
            props["分类"] = {
                rich_text: [{ text: { content: BookmarkExporter.normalizeText(meta.inferredCategory, 300) } }]
            };
        }
        const tags = Array.isArray(meta.inferredTags) ? meta.inferredTags : [];
        if (tags.length > 0) {
            props["标签"] = {
                multi_select: tags
                    .map((tag) => BookmarkExporter.normalizeText(tag, 100))
                    .filter(Boolean)
                    .map((name) => ({ name }))
                    .slice(0, 8)
            };
        }
        return props;
    },

    // 导出当前页面
    exportCurrentPage: async (settings) => {
        let meta, blocks;

        // 知乎页面使用专用提取器
        if (SiteDetector.detect() === SiteDetector.SITES.ZHIHU) {
            const content = ZhihuAPI.extractContent();
            if (content) {
                meta = {
                    title: content.title,
                    url: content.url,
                    source: "知乎",
                    siteName: "知乎",
                    sourceType: content.type === "answer"
                        ? "回答"
                        : (content.type === "question" ? "问题" : "文章"),
                    author: content.author,
                    description: GenericExporter.extractSummaryText(content),
                    detail: content.detail || "",
                    html: content.html || "",
                    answers: content.answers || [],
                };
                blocks = ZhihuAPI.htmlToBlocks(content.html || "");
                // 问题详情
                if (content.type === "question" && content.detail) {
                    const detailBlocks = ZhihuAPI.htmlToBlocks(content.detail);
                    if (detailBlocks.length > 0) {
                        blocks.push({
                            type: "callout",
                            callout: {
                                icon: { type: "emoji", emoji: "❓" },
                                rich_text: [{ type: "text", text: { content: "问题描述" } }],
                            },
                        });
                        blocks.push(...detailBlocks);
                    }
                }
                if (content.type === "question" && content.answers) {
                    for (const ans of content.answers) {
                        const ansBlocks = ZhihuAPI.htmlToBlocks(ans.html || "");
                        blocks.push({
                            type: "divider",
                            divider: {},
                        });
                        blocks.push({
                            type: "callout",
                            callout: {
                                icon: { type: "emoji", emoji: "👤" },
                                rich_text: [{ type: "text", text: { content: `${ans.author} · 👍 ${ans.voteCount}` } }],
                            },
                        });
                        blocks.push(...ansBlocks);
                    }
                }
            } else {
                // 降级到通用提取
                meta = GenericExtractor.extractMeta();
                const contentEl = GenericExtractor.extractContent();
                blocks = GenericExtractor.toNotionBlocks(contentEl, settings.imgMode || CONFIG.DEFAULTS.imgMode);
            }
        } else {
            meta = GenericExtractor.extractMeta();
            const contentEl = GenericExtractor.extractContent();
            blocks = GenericExtractor.toNotionBlocks(contentEl, settings.imgMode || CONFIG.DEFAULTS.imgMode);
        }

        meta = await GenericExporter.enrichMeta(meta, settings);

        // 确保有内容
        if (!blocks || blocks.length === 0) {
            blocks = [{
                type: "paragraph",
                paragraph: { rich_text: [{ type: "text", text: { content: meta.url } }] },
            }];
        }

        // 添加来源信息头
        blocks.unshift({
            type: "callout",
            callout: {
                icon: { type: "emoji", emoji: "🔗" },
                rich_text: [{ type: "text", text: { content: `来源: ${meta.url}` } }],
            },
        });

        // 处理图片上传
        if (settings.imgMode === "upload") {
            await Exporter.processImageUploads(blocks, settings.apiKey, null);
        }

        let page;
        if (settings.exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
            page = await AIAssistant._executeGuardedPageWrite("createDatabasePage",
                { id: settings.parentPageId, name: meta.title },
                () => NotionAPI.createChildPage(
                    settings.parentPageId,
                    meta.title,
                    blocks,
                    settings.apiKey
                ),
                settings,
                { itemName: meta.title, pageId: settings.parentPageId }
            );
        } else {
            const properties = GenericExporter.buildProperties(meta);
            page = await AIAssistant._executeGuardedDatabaseWrite("createDatabasePage",
                settings.databaseId,
                () => NotionAPI.createDatabasePage(
                    settings.databaseId,
                    properties,
                    blocks,
                    settings.apiKey
                ),
                settings,
                { itemName: meta.title }
            );
        }

        return { page, meta };
    },

    // 自动设置通用数据库属性
    setupDatabaseProperties: async (databaseId, apiKey) => {
        const requiredProperties = {
            "标题": { typeName: "title", schema: { title: {} } },
            "链接": { typeName: "url", schema: { url: {} } },
            "来源": { typeName: "rich_text", schema: { rich_text: {} } },
            "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
            "作者": { typeName: "rich_text", schema: { rich_text: {} } },
            "发布日期": { typeName: "date", schema: { date: {} } },
            "摘要": { typeName: "rich_text", schema: { rich_text: {} } },
            "分类": { typeName: "rich_text", schema: { rich_text: {} } },
            "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
        };

        try {
            const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
            const existingProps = database.properties || {};
            const propsToAdd = {};
            const propsToUpdate = {};

            const typeConflicts = [];
            for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                const existingProp = existingProps[name];
                if (!existingProp) {
                    if (typeName === "title") {
                        const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                        if (existingTitle && existingTitle[0] !== name) {
                            propsToUpdate[existingTitle[0]] = { name: name };
                        }
                    } else {
                        propsToAdd[name] = schema;
                    }
                } else if (existingProp.type !== typeName) {
                    typeConflicts.push(`「${name}」期望 ${typeName}，实际 ${existingProp.type}`);
                }
            }

            if (typeConflicts.length > 0) {
                return {
                    success: false,
                    message: `属性类型冲突: ${typeConflicts.join("；")}，请手动修改数据库属性后重试`
                };
            }

            const allChanges = { ...propsToAdd, ...propsToUpdate };
            if (Object.keys(allChanges).length === 0) {
                return { success: true, message: "属性已正确配置" };
            }

            await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                properties: allChanges
            }, apiKey);

            return { success: true, message: `已添加 ${Object.keys(propsToAdd).length} 个属性` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },
};

const LinuxDoAPI = {
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
            try {
                const res = await fetch(url, opts);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (e) {
                lastErr = e;
                if (i < retries) await Utils.sleep(250 * (i + 1));
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

const Exporter = {
    isExporting: false, // 标记是否正在导出（用于与自动导入互斥）

    // 筛选帖子
    filterPosts: (posts, topic, settings) => {
        const wantUsers = (settings.filterUsers || "").split(/[,;，；\s]+/).filter(Boolean).map(u => u.toLowerCase());
        const includeKws = (settings.filterInclude || "").split(/[,;，；\s]+/).filter(Boolean).map(k => k.toLowerCase());
        const excludeKws = (settings.filterExclude || "").split(/[,;，；\s]+/).filter(Boolean).map(k => k.toLowerCase());
        const minLen = settings.filterMinLen || 0;

        return posts.filter((post) => {
            const postNum = post.post_number;

            if (postNum < settings.rangeStart || postNum > settings.rangeEnd) return false;
            if (settings.onlyFirst && postNum !== 1) return false;
            if (settings.onlyOp && post.username !== topic.opUsername) return false;

            // 用户过滤
            if (wantUsers.length && !wantUsers.includes((post.username || "").toLowerCase())) return false;

            // 图片筛选
            if (settings.imgFilter === "only_img" && !(post.cooked || "").includes("<img")) return false;
            if (settings.imgFilter === "no_img" && (post.cooked || "").includes("<img")) return false;

            // 文本内容检查（关键词 + 最少字数）
            if (includeKws.length || excludeKws.length || minLen > 0) {
                const textEl = document.createElement("div");
                textEl.innerHTML = post.cooked || "";
                const plainText = (textEl.textContent || "").trim();

                if (minLen > 0 && plainText.length < minLen) return false;
                if (includeKws.length && !includeKws.some(k => plainText.toLowerCase().includes(k))) return false;
                if (excludeKws.length && excludeKws.some(k => plainText.toLowerCase().includes(k))) return false;
            }

            return true;
        });
    },

    // 构建 Notion 页面属性
    buildProperties: (topic, bookmark) => {
        return {
            "标题": {
                title: [{ text: { content: topic.title || "无标题" } }]
            },
            "链接": {
                url: topic.url
            },
            "分类": {
                rich_text: [{ text: { content: topic.categoryName || topic.category || "" } }]
            },
            "标签": {
                multi_select: (topic.tags || []).map(tag => ({
                    name: typeof tag === 'string' ? tag : (tag.name || '')
                })).filter(t => t.name)
            },
            "作者": {
                rich_text: [{ text: { content: topic.opUsername || "" } }]
            },
            "收藏时间": bookmark?.created_at ? {
                date: { start: bookmark.created_at.split("T")[0] }
            } : undefined,
            "帖子数": {
                number: topic.postsCount || 0
            },
            "浏览数": {
                number: topic.views || 0
            },
            "点赞数": {
                number: topic.likeCount || 0
            },
        };
    },

    // 构建帖子内容 blocks
    buildContentBlocks: (posts, topic, settings) => {
        const blocks = [];

        // 添加帖子元数据 callout（类似 frontmatter）
        const metaLines = [
            { label: "原始链接", value: topic.url, link: true },
            { label: "主题 ID", value: String(topic.topicId || topic.topic_id || "") },
            { label: "楼主", value: `@${topic.opUsername || "未知"}` },
            { label: "分类", value: topic.categoryName || topic.category || "无" },
            { label: "标签", value: (topic.tags || []).join(", ") || "无" },
            { label: "导出时间", value: new Date().toLocaleString("zh-CN") },
            { label: "楼层数", value: String(posts.length) },
        ];
        const metaRichText = [];
        metaLines.forEach((line, i) => {
            if (i > 0) metaRichText.push({ type: "text", text: { content: "\n" } });
            metaRichText.push({ type: "text", text: { content: `${line.label}: ` }, annotations: { bold: true } });
            if (line.link && line.value) {
                metaRichText.push({ type: "text", text: { content: line.value, link: { url: line.value } } });
            } else {
                metaRichText.push({ type: "text", text: { content: line.value || "无" } });
            }
        });
        blocks.push({
            type: "callout",
            callout: {
                icon: { type: "emoji", emoji: "📋" },
                rich_text: metaRichText,
            },
        });

        // 处理每个楼层
        for (const post of posts) {
            const isOp = post.username === topic.opUsername;
            const dateStr = Utils.formatDate(post.created_at);
            const emoji = isOp ? "🏠" : "💬";

            let title = `#${post.post_number} ${post.name || post.username || "匿名"}`;
            if (isOp) title += " 楼主";
            if (dateStr) title += ` · ${dateStr}`;

            // 转换帖子内容
            const contentBlocks = DOMToNotion.cookedToBlocks(post.cooked, settings.imgMode);

            // 创建 callout 包裹
            const children = [];

            // 添加回复信息
            if (post.reply_to_post_number) {
                children.push({
                    type: "paragraph",
                    paragraph: {
                        rich_text: [{ type: "text", text: { content: `↩️ 回复 #${post.reply_to_post_number}楼` } }],
                    },
                });
            }

            children.push(...contentBlocks);

            // 跳过空楼层
            if (children.length === 0) {
                children.push({
                    type: "paragraph",
                    paragraph: {
                        rich_text: [{ type: "text", text: { content: "（内容为空或无法解析）" } }],
                    },
                });
            }

            // 拆分超过 100 个子 block 的内容
            const maxChildren = 100;
            for (let i = 0; i < children.length; i += maxChildren) {
                const chunk = children.slice(i, i + maxChildren);
                const isFirst = i === 0;
                const partNum = Math.floor(i / maxChildren) + 1;
                const totalParts = Math.ceil(children.length / maxChildren);

                blocks.push({
                    type: "callout",
                    callout: {
                        icon: { type: "emoji", emoji: isFirst ? emoji : "📎" },
                        rich_text: [{
                            type: "text",
                            text: {
                                content: isFirst ? title : `#${post.post_number}楼 续（${partNum}/${totalParts}）`
                            }
                        }],
                        children: chunk,
                    },
                });
            }
        }

        return blocks;
    },

    // 处理文件上传（图片、视频、音频、附件）
    // 支持 URL 去重 + 受控并发 + 递归子 block
    processImageUploads: async (blocks, apiKey, onProgress, _fileUrlCache) => {
        const fileUrlCache = _fileUrlCache || new Map();
        const pendingBlocks = [];

        // 收集所有待上传 block（递归）
        const collectPending = (items) => {
            for (const block of (items || [])) {
                if (block._needsUpload && block._originalUrl) {
                    pendingBlocks.push(block);
                }
                // 递归子容器
                const containers = Exporter._getChildContainers(block);
                for (const c of containers) {
                    collectPending(c.children);
                }
            }
        };
        collectPending(blocks);

        if (pendingBlocks.length === 0) return;

        // 收集去重后的唯一 URL
        const uniqueUrls = [...new Set(pendingBlocks.map(b => b._originalUrl))];
        let uploaded = 0;

        // 受控并发上传 (最多 3 个并行)
        const CONCURRENCY = 3;
        const uploadWithRetry = async (url) => {
            try {
                const result = await NotionAPI.uploadFileToNotion(url, apiKey);
                fileUrlCache.set(url, result);
            } catch (e) {
                console.warn("[LD-Notion] 文件上传失败:", url, e.message);
                fileUrlCache.set(url, null);
            }
            uploaded++;
            if (onProgress) onProgress(uploaded, uniqueUrls.length);
        };

        for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
            const batch = uniqueUrls.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(url => {
                if (fileUrlCache.has(url)) {
                    uploaded++;
                    if (onProgress) onProgress(uploaded, uniqueUrls.length);
                    return Promise.resolve();
                }
                return uploadWithRetry(url);
            }));
            if (i + CONCURRENCY < uniqueUrls.length) {
                await Utils.sleep(300);
            }
        }

        // 批量替换 block 引用
        const applyUploadedRefs = (items) => {
            for (const block of (items || [])) {
                if (block._needsUpload && block._originalUrl) {
                    const uploadResult = fileUrlCache.get(block._originalUrl);
                    if (uploadResult?.fileId) {
                        const blockType = uploadResult.blockType || block._fileType || "image";
                        const blockKey = blockType === "image" ? "image" : blockType === "video" ? "video" : blockType === "audio" ? "audio" : "file";
                        block[blockKey] = { type: "file_upload", file_upload: { id: uploadResult.fileId } };
                        // 清理其他类型的 block 属性
                        ["image", "file", "video", "audio"].forEach(k => {
                            if (k !== blockKey) delete block[k];
                        });
                        if (block._fileType === "file" && block.file?.caption) {
                            block[blockKey].caption = block.file.caption;
                        }
                        block.type = blockKey;
                        block._uploaded = true;
                    } else {
                        // 上传失败，回退到外链
                        const fallbackKey = block._fileType || "image";
                        const ext = (block._originalUrl.split(".").pop() || "").toLowerCase();
                        const category = getFileCategory(ext);
                        const fallbackBlockKey = category === "video" ? "video" : category === "audio" ? "audio" : fallbackKey === "file" ? "file" : "image";
                        block[fallbackBlockKey] = {
                            type: "external",
                            external: { url: block._originalUrl },
                        };
                        if (fallbackKey === "file" && block.file?.caption) {
                            block[fallbackBlockKey].caption = block.file.caption;
                        }
                        ["image", "file", "video", "audio"].forEach(k => {
                            if (k !== fallbackBlockKey) delete block[k];
                        });
                        block.type = fallbackBlockKey;
                    }
                    delete block._needsUpload;
                    delete block._originalUrl;
                    delete block._uploaded;
                    delete block._fileType;
                    delete block._fileName;
                }
                // 递归子容器
                const containers = Exporter._getChildContainers(block);
                for (const c of containers) {
                    applyUploadedRefs(c.children);
                }
            }
        };
        applyUploadedRefs(blocks);
    },

    _getChildContainers: (block) => {
        const containers = [];
        if (block.callout?.children) containers.push(block.callout);
        if (block.quote?.children) containers.push(block.quote);
        if (block.synced_block?.children) containers.push(block.synced_block);
        if (block.column_list?.children) containers.push(block.column_list);
        if (block.toggle?.children) containers.push(block.toggle);
        return containers;
    },

    // 导出单个帖子
    exportTopic: async (bookmark, settings, onProgress) => {
        const topicId = bookmark.topic_id || bookmark.bookmarkable_id;

        onProgress?.({ stage: "fetch", message: "获取帖子数据..." });

        // 获取帖子详情
        const { topic, posts } = await LinuxDoAPI.fetchAllPosts(topicId, (current, total) => {
            onProgress?.({ stage: "fetch", message: `获取楼层 ${current}/${total}` });
        });

        // 筛选帖子
        const filteredPosts = Exporter.filterPosts(posts, topic, settings);

        onProgress?.({ stage: "convert", message: "转换内容格式..." });

        // 构建内容
        const blocks = Exporter.buildContentBlocks(filteredPosts, topic, settings);

        // 处理图片上传
        if (settings.imgMode === "upload") {
            onProgress?.({ stage: "upload", message: "上传图片..." });
            await Exporter.processImageUploads(blocks, settings.apiKey, (current, total) => {
                onProgress?.({ stage: "upload", message: `上传图片 ${current}/${total}` });
            });
        }

        onProgress?.({ stage: "create", message: "创建 Notion 页面..." });

        let page;

        // 根据导出目标类型创建页面
        if (settings.exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
            // 创建为子页面
            page = await AIAssistant._executeGuardedPageWrite("createDatabasePage",
                { id: settings.parentPageId, name: topic.title },
                () => NotionAPI.createChildPage(
                    settings.parentPageId,
                    topic.title,
                    blocks,
                    settings.apiKey
                ),
                settings,
                { itemName: topic.title, pageId: settings.parentPageId }
            );
        } else {
            // 创建为数据库条目（默认行为）
            const properties = Exporter.buildProperties(topic, bookmark);
            page = await AIAssistant._executeGuardedDatabaseWrite("createDatabasePage",
                settings.databaseId,
                () => NotionAPI.createDatabasePage(
                    settings.databaseId,
                    properties,
                    blocks,
                    settings.apiKey
                ),
                settings,
                { itemName: topic.title }
            );
        }

        // 标记为已导出
        Storage.markTopicExported(topicId);

        return page;
    },

    // 批量导出 (支持暂停/继续)
    isPaused: false,
    isCancelled: false,
    currentIndex: 0,

    pause: () => { Exporter.isPaused = true; },
    resume: () => { Exporter.isPaused = false; },
    cancel: () => { Exporter.isCancelled = true; Exporter.isPaused = false; },
    reset: () => { Exporter.isPaused = false; Exporter.isCancelled = false; Exporter.currentIndex = 0; },

    exportBookmarks: async (bookmarks, settings, onProgress, startIndex = 0) => {
        const results = { success: [], failed: [], skipped: [] };
        Exporter.reset();
        Exporter.isExporting = true;
        Exporter.currentIndex = startIndex;
        const concurrency = settings.concurrency || 1;
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        // 共享队列索引
        let nextIndex = startIndex;
        let completedCount = 0;

        const worker = async () => {
            while (true) {
                // 检查暂停
                while (Exporter.isPaused) {
                    await Utils.sleep(200);
                    if (Exporter.isCancelled) return;
                }
                if (Exporter.isCancelled) return;

                // 取任务
                const i = nextIndex;
                if (i >= bookmarks.length) return;
                nextIndex++;

                const bookmark = bookmarks[i];
                const topicId = bookmark.topic_id || bookmark.bookmarkable_id;
                const title = bookmark.title || bookmark.name || `帖子 ${topicId}`;
                const taskNum = i - startIndex + 1;

                onProgress?.({
                    current: taskNum,
                    total: bookmarks.length,
                    title: title,
                    stage: "start",
                    isPaused: Exporter.isPaused,
                });

                try {
                    await Exporter.exportTopic(bookmark, settings, (detail) => {
                        onProgress?.({
                            current: taskNum,
                            total: bookmarks.length,
                            title: title,
                            isPaused: Exporter.isPaused,
                            ...detail,
                        });
                    });
                    results.success.push({ topicId, title, url: `https://linux.do/t/${topicId}` });
                } catch (error) {
                    console.error(`[LD-Notion] 导出失败: ${title}`, error);
                    results.failed.push({ topicId, title, error: error.message });
                }

                completedCount++;
                Exporter.currentIndex = completedCount + startIndex;

                // 请求间隔
                if (delay > 0 && nextIndex < bookmarks.length && !Exporter.isCancelled) {
                    await Utils.sleep(delay);
                }
            }
        };

        // 启动 N 个 worker
        const workerCount = Math.min(concurrency, bookmarks.length - startIndex);
        const workers = [];
        for (let w = 0; w < workerCount; w++) {
            workers.push(worker());
            // 错开启动避免同时请求
            if (w < workerCount - 1) await Utils.sleep(100);
        }
        await Promise.all(workers);

        // 取消时收集剩余为 skipped
        if (Exporter.isCancelled && nextIndex < bookmarks.length) {
            for (let i = nextIndex; i < bookmarks.length; i++) {
                const b = bookmarks[i];
                results.skipped.push({
                    topicId: b.topic_id || b.bookmarkable_id,
                    title: b.title || b.name || `帖子 ${b.topic_id || b.bookmarkable_id}`,
                });
            }
        }

        Exporter.isExporting = false;
        return results;
    },
};

module.exports = { GenericExporter, LinuxDoAPI, Exporter };
