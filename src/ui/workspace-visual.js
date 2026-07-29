"use strict";

const { Utils } = require("../utils");

// 因这些函数内部引用了 UI 自身方法（如 UI.getWorkspacePageProperty 等），
// 需要在运行时获取 UI 引用。采用惰性 require 模式避免循环依赖。
let _UI = null;
const UI = () => {
    if (!_UI) _UI = require("./main-ui").UI;
    return _UI;
};

const WorkspaceVisual = {

    getViewPct: (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0),

    buildViewDateBucket: (date) => ({
        key: [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
        ].join("-"),
        label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
    }),

    collectWorkspacePlainText: (items = []) => {
        return Array.isArray(items)
            ? items.map((item) => item?.plain_text || item?.text?.content || "").join("").trim()
            : "";
    },

    getWorkspacePageProperty: (page, names = []) => {
        const properties = page?.properties || {};
        for (const name of names) {
            if (name && Object.prototype.hasOwnProperty.call(properties, name)) {
                return properties[name];
            }
        }
        return null;
    },

    getWorkspacePagePropertyText: (page, names = []) => {
        const prop = UI().getWorkspacePageProperty(page, names);
        if (!prop) return "";
        switch (prop.type) {
            case "title":
                return UI().collectWorkspacePlainText(prop.title);
            case "rich_text":
                return UI().collectWorkspacePlainText(prop.rich_text);
            case "select":
                return String(prop.select?.name || "").trim();
            case "multi_select":
                return Array.isArray(prop.multi_select)
                    ? prop.multi_select.map((item) => item?.name || "").filter(Boolean).join(", ")
                    : "";
            case "url":
                return String(prop.url || "").trim();
            case "number":
                return prop.number === 0 || Number.isFinite(prop.number) ? String(prop.number) : "";
            case "checkbox":
                return prop.checkbox ? "true" : "";
            case "created_time":
                return String(prop.created_time || "").trim();
            case "last_edited_time":
                return String(prop.last_edited_time || "").trim();
            default:
                return "";
        }
    },

    getWorkspacePagePropertyDateValue: (page, names = []) => {
        const prop = UI().getWorkspacePageProperty(page, names);
        if (!prop) return "";
        if (prop.type === "date") return String(prop.date?.start || "").trim();
        if (prop.type === "created_time") return String(prop.created_time || "").trim();
        if (prop.type === "last_edited_time") return String(prop.last_edited_time || "").trim();
        return "";
    },

    getWorkspaceVisualSourceUrl: (pageOrRecord) => {
        if (pageOrRecord?.sourceUrl) return String(pageOrRecord.sourceUrl || "").trim();
        const explicitUrl = UI().getWorkspacePagePropertyText(pageOrRecord, ["链接", "URL", "网址", "链接地址"]);
        if (explicitUrl) return explicitUrl;
        return String(pageOrRecord?.url || "").trim();
    },

    normalizeWorkspaceSourceLabel: (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        const lower = raw.toLowerCase();
        if (lower.includes("linux.do") || lower.includes("linuxdo")) return "Linux.do";
        if (lower.includes("github") || ["repo", "repos", "star", "stars", "fork", "forks", "gist", "gists"].includes(lower)) return "GitHub";
        if (lower.includes("rss") || lower.includes("feed")) return "RSS";
        if (lower.includes("candidate") || raw.includes("统一候选")) return "统一候选";
        if (lower.includes("zhihu") || raw.includes("知乎")) return "知乎";
        if (lower.includes("bookmark") || lower.includes("书签")) return "浏览器书签";
        if (lower.includes("generic") || lower.includes("通用页面")) return "通用页面";
        if (lower.includes("unknown") || lower.includes("未标记")) return "未标记";
        return raw;
    },

    normalizeWorkspaceSourceTypeLabel: (value, source = "") => {
        const raw = String(value || "").trim();
        if (!raw) {
            if (source === "GitHub") return "GitHub";
            if (source === "Linux.do") return "帖子";
            if (source === "RSS") return "Feed";
            if (source === "浏览器书签") return "书签";
            if (source === "知乎") return "网页";
            return "";
        }
        const lower = raw.toLowerCase();
        if (["star", "stars"].includes(lower)) return "Stars";
        if (["repo", "repos"].includes(lower)) return "Repos";
        if (["fork", "forks"].includes(lower)) return "Forks";
        if (["gist", "gists"].includes(lower)) return "Gists";
        if (lower.includes("rss") || lower.includes("feed")) return "Feed";
        if (lower.includes("bookmark") || lower.includes("书签")) return "书签";
        if (lower.includes("post") || lower.includes("topic") || lower.includes("帖子")) return "帖子";
        if (lower.includes("candidate") || raw.includes("候选")) return "跨源关联候选";
        if (["answer", "回答"].includes(lower) || raw.includes("回答")) return "回答";
        if (["question", "问题", "问答"].includes(lower) || raw.includes("问题") || raw.includes("问答")) return "问题";
        if (["article", "column_article", "文章", "专栏文章"].includes(lower) || raw.includes("文章")) return "文章";
        if (["web", "webpage", "web page", "page", "网页"].includes(lower) || raw.includes("网页")) return "网页";
        return raw;
    },

    getWorkspaceVisualDate: (pageOrRecord) => {
        if (pageOrRecord?.date instanceof Date && pageOrRecord?.dateKey) {
            return {
                date: pageOrRecord.date,
                key: pageOrRecord.dateKey,
                label: pageOrRecord.dateLabel || UI().buildViewDateBucket(pageOrRecord.date).label,
                field: pageOrRecord.dateField || "",
            };
        }

        const candidates = [
            { field: "收藏时间", value: UI().getWorkspacePagePropertyDateValue(pageOrRecord, ["收藏时间"]) },
            { field: "更新时间", value: UI().getWorkspacePagePropertyDateValue(pageOrRecord, ["更新时间"]) },
            { field: "发布日期", value: UI().getWorkspacePagePropertyDateValue(pageOrRecord, ["发布日期"]) },
            { field: "created_time", value: String(pageOrRecord?.created_time || "").trim() },
            { field: "last_edited_time", value: String(pageOrRecord?.last_edited_time || "").trim() },
        ];

        for (const candidate of candidates) {
            if (!candidate.value) continue;
            const date = new Date(candidate.value);
            if (Number.isNaN(date.getTime())) continue;
            const bucket = UI().buildViewDateBucket(date);
            return {
                date,
                key: bucket.key,
                label: bucket.label,
                field: candidate.field,
            };
        }
        return null;
    },

    inferWorkspaceVisualSource: (page, databases = []) => {
        const explicitSource = UI().normalizeWorkspaceSourceLabel(UI().getWorkspacePagePropertyText(page, ["来源"]));
        const explicitTypeRaw = UI().getWorkspacePagePropertyText(page, ["来源类型"]);
        const properties = page?.properties || {};
        const propertyNames = Object.keys(properties);
        const parentDatabaseId = String(page?.parent?.database_id || "").replace(/-/g, "");
        const parentDatabaseTitle = databases.find((db) => db.id === parentDatabaseId)?.title || "";
        const pageTitle = Utils.getPageTitle(page);
        const hintText = [explicitSource, explicitTypeRaw, parentDatabaseTitle, pageTitle].join(" ").toLowerCase();
        const hasProp = (...names) => names.some((name) => propertyNames.includes(name));

        let source = explicitSource;
        let sourceType = UI().normalizeWorkspaceSourceTypeLabel(explicitTypeRaw, explicitSource);

        if (!source && sourceType) {
            if (sourceType === "书签") source = "浏览器书签";
            else if (["Stars", "Repos", "Forks", "Gists", "GitHub"].includes(sourceType)) source = "GitHub";
            else if (sourceType === "Feed") source = "RSS";
            else if (sourceType === "帖子") source = "Linux.do";
            else if (["回答", "问题", "文章", "网页"].includes(sourceType)) source = hintText.includes("zhihu") ? "知乎" : "通用页面";
        }

        if (!source && (hasProp("帖子数", "浏览数", "点赞数") || hintText.includes("linux.do") || hintText.includes("linuxdo"))) {
            source = "Linux.do";
            if (!sourceType) sourceType = "帖子";
        }

        if (!source && (hasProp("Stars", "语言", "更新时间") || hintText.includes("github"))) {
            source = "GitHub";
            if (!sourceType) sourceType = hasProp("Stars") ? "Repos" : "GitHub";
        }

        if (!source && (hasProp("书签路径") || hintText.includes("bookmark") || hintText.includes("书签"))) {
            source = "浏览器书签";
            if (!sourceType) sourceType = "书签";
        }

        if (!source && (hintText.includes("rss") || hintText.includes("feed"))) {
            source = "RSS";
            if (!sourceType) sourceType = "Feed";
        }

        if (!source && (hintText.includes("统一候选") || hintText.includes("candidate"))) {
            source = "统一候选";
            if (!sourceType) sourceType = "跨源关联候选";
        }

        if (!source && (hintText.includes("zhihu") || hasProp("作者", "发布日期", "摘要") && ["回答", "问题", "文章"].includes(sourceType))) {
            source = "知乎";
            if (!sourceType) sourceType = "网页";
        }

        if (!source && (hasProp("发布日期") || hasProp("摘要", "描述"))) {
            source = explicitSource || "通用页面";
        }

        if (source && !["Linux.do", "GitHub", "RSS", "浏览器书签", "知乎", "通用页面", "未标记"].includes(source)) {
            if (["回答", "问题", "文章", "网页"].includes(sourceType)) {
                source = source === "知乎" ? "知乎" : "通用页面";
            }
        }

        if (!source) source = explicitSource || "未标记";
        if (!sourceType) sourceType = UI().normalizeWorkspaceSourceTypeLabel(explicitTypeRaw, source);

        return { source, sourceType };
    },

    getWorkspaceVisualCategory: (pageOrRecord) => {
        if (pageOrRecord?.category) return String(pageOrRecord.category).trim();
        return String(
            UI().getWorkspacePagePropertyText(pageOrRecord, ["AI分类"])
            || UI().getWorkspacePagePropertyText(pageOrRecord, ["分类"])
            || ""
        ).trim();
    },

    getWorkspaceVisualParentLabel: (record) => {
        if (record?.parentDatabaseTitle) return record.parentDatabaseTitle;
        if (record?.parentType === "workspace") return "工作区页面";
        if (record?.parentType === "page_id") return "子页面";
        if (record?.parentType === "block_id") return "块内页面";
        if (record?.parentType === "database_id") return "未命名数据库";
        return "未归档页面";
    },

    mapWorkspacePageSummary: (page) => ({
        id: page?.id?.replace(/-/g, "") || "",
        title: Utils.getPageTitle(page),
        type: "page",
        url: page?.url || "",
        parent: page?.parent?.type || "",
        parentId: String(page?.parent?.database_id || page?.parent?.page_id || "").replace(/-/g, ""),
    }),

    extractWorkspaceVisualRecord: (page, databasesMap = new Map()) => {
        const summary = UI().mapWorkspacePageSummary(page);
        const dateInfo = UI().getWorkspaceVisualDate(page);
        const category = UI().getWorkspaceVisualCategory(page);
        const sourceInfo = UI().inferWorkspaceVisualSource(page, Array.from(databasesMap.values()));
        const sourceUrl = UI().getWorkspaceVisualSourceUrl(page);
        const hasSource = sourceInfo.source && sourceInfo.source !== "未标记";
        const hasDate = !!dateInfo;
        const hasCategory = !!category;

        return {
            id: summary.id,
            title: summary.title,
            url: sourceUrl || summary.url,
            sourceUrl,
            notionUrl: summary.url,
            parentType: summary.parent,
            parentDatabaseId: summary.parent === "database_id" ? summary.parentId : "",
            parentPageId: summary.parent === "page_id" ? summary.parentId : "",
            parentDatabaseTitle: databasesMap.get(summary.parentId)?.title || "",
            source: sourceInfo.source,
            sourceType: sourceInfo.sourceType,
            category,
            date: dateInfo?.date || null,
            dateKey: dateInfo?.key || "",
            dateLabel: dateInfo?.label || "",
            dateField: dateInfo?.field || "",
            hasSource,
            hasDate,
            hasCategory,
            isFullyStructured: hasSource && hasDate && hasCategory,
        };
    },

    buildVisualizationModel: (bookmarks = UI().getCombinedVisualBookmarks()) => {
        const items = Array.isArray(bookmarks) ? bookmarks : [];
        const sourceCounts = new Map();
        const typeCounts = new Map();
        const timelineCounts = new Map();
        let exported = 0;
        let pending = 0;

        items.forEach((bookmark) => {
            const bookmarkKey = UI().getBookmarkKey(bookmark);
            const isExported = UI().isBookmarkKeyExported(bookmarkKey);
            if (isExported) {
                exported += 1;
            } else {
                pending += 1;
            }

            const sourceLabel = UI().getBookmarkVisualSourceLabel(bookmark);
            sourceCounts.set(sourceLabel, (sourceCounts.get(sourceLabel) || 0) + 1);

            const typeLabel = UI().getBookmarkVisualTypeLabel(bookmark);
            typeCounts.set(typeLabel, (typeCounts.get(typeLabel) || 0) + 1);

            const dateInfo = UI().getBookmarkVisualDate(bookmark);
            if (!dateInfo) return;
            const bucket = UI().buildViewDateBucket(dateInfo);
            const existing = timelineCounts.get(bucket.key) || {
                key: bucket.key,
                label: bucket.label,
                count: 0,
                exported: 0,
            };
            existing.count += 1;
            if (isExported) existing.exported += 1;
            timelineCounts.set(bucket.key, existing);
        });

        const total = items.length;
        const toBreakdown = (map) => Array.from(map.entries())
            .map(([label, count]) => ({
                label,
                count,
                pct: UI().getViewPct(count, total),
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

        const timeline = Array.from(timelineCounts.values())
            .sort((a, b) => b.key.localeCompare(a.key))
            .slice(0, 6);

        const loadedSources = Object.entries(UI().visualSnapshots)
            .filter(([, snapshot]) => Array.isArray(snapshot) && snapshot.length > 0)
            .map(([source]) => source === "github" ? "GitHub" : "Linux.do");

        return {
            total,
            exported,
            pending,
            selected: UI().selectedBookmarks?.size || 0,
            loadedSources,
            sourceBreakdown: toBreakdown(sourceCounts),
            typeBreakdown: toBreakdown(typeCounts),
            timeline,
        };
    },

    buildWorkspaceVisualizationModel: (snapshot = UI().workspaceVisualSnapshot) => {
        const databases = Array.isArray(snapshot?.databases) ? snapshot.databases : [];
        const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
        const totalPages = records.length;
        const sourceCounts = new Map();
        const categoryCounts = new Map();
        const timelineCounts = new Map();
        const relationshipCounts = new Map();
        const recognizedSources = new Set();
        const duplicateGroups = new Map();
        const linkGroups = new Map();
        let sourcedPages = 0;
        let datedPages = 0;
        let categorizedPages = 0;
        let structuredPages = 0;

        records.forEach((record) => {
            const sourceLabel = record?.source || "未标记";
            sourceCounts.set(sourceLabel, (sourceCounts.get(sourceLabel) || 0) + 1);
            if (record?.hasSource) {
                sourcedPages += 1;
                recognizedSources.add(sourceLabel);
            }

            if (record?.hasCategory) {
                const categoryLabel = record.category;
                categoryCounts.set(categoryLabel, (categoryCounts.get(categoryLabel) || 0) + 1);
                categorizedPages += 1;
            }

            if (record?.hasDate && record?.dateKey) {
                datedPages += 1;
                const existingTimeline = timelineCounts.get(record.dateKey) || {
                    key: record.dateKey,
                    label: record.dateLabel || record.dateKey,
                    count: 0,
                };
                existingTimeline.count += 1;
                timelineCounts.set(record.dateKey, existingTimeline);
            }

            if (record?.isFullyStructured) {
                structuredPages += 1;
            }

            const parentLabel = UI().getWorkspaceVisualParentLabel(record);
            const linkLabel = `${parentLabel} → ${sourceLabel}`;
            const existingRelationship = relationshipCounts.get(linkLabel) || {
                label: linkLabel,
                parentLabel,
                sourceLabel,
                count: 0,
            };
            existingRelationship.count += 1;
            relationshipCounts.set(linkLabel, existingRelationship);

            const duplicateKey = UI().normalizeWorkspaceInsightKey(record?.title);
            if (duplicateKey) {
                const existingDuplicate = duplicateGroups.get(duplicateKey) || {
                    key: duplicateKey,
                    title: String(record?.title || "").trim() || "未命名页面",
                    items: [],
                    sources: new Set(),
                };
                existingDuplicate.items.push({
                    id: record?.id || "",
                    title: String(record?.title || "").trim() || "未命名页面",
                    source: sourceLabel,
                    parentLabel,
                    url: record?.url || "",
                });
                if (record?.hasSource) existingDuplicate.sources.add(sourceLabel);
                duplicateGroups.set(duplicateKey, existingDuplicate);
            }

            const linkKey = UI().normalizeWorkspaceInsightUrl(record?.url);
            if (linkKey) {
                const existingGroup = linkGroups.get(linkKey) || {
                    key: linkKey,
                    title: String(record?.title || "").trim() || String(record?.url || "").trim() || "未命名页面",
                    url: String(record?.url || "").trim(),
                    items: [],
                    sources: new Set(),
                };
                existingGroup.items.push({
                    id: record?.id || "",
                    title: String(record?.title || "").trim() || "未命名页面",
                    source: sourceLabel,
                    parentLabel,
                    url: record?.url || "",
                });
                if (record?.hasSource) existingGroup.sources.add(sourceLabel);
                linkGroups.set(linkKey, existingGroup);
            }
        });

        const toBreakdown = (map) => Array.from(map.entries())
            .map(([label, count]) => ({
                label,
                count,
                pct: UI().getViewPct(count, totalPages),
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

        const timeline = Array.from(timelineCounts.values())
            .sort((a, b) => b.key.localeCompare(a.key))
            .slice(0, 8);

        const relationships = Array.from(relationshipCounts.values())
            .map((item) => ({
                ...item,
                pct: UI().getViewPct(item.count, totalPages),
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .slice(0, 10);

        const duplicateCandidates = Array.from(duplicateGroups.values())
            .filter((group) => group.items.length > 1)
            .map((group) => {
                const sourceList = Array.from(group.sources).sort((a, b) => a.localeCompare(b));
                return {
                    key: group.key,
                    label: group.title,
                    count: group.items.length,
                    sourceCount: sourceList.length,
                    sources: sourceList,
                    items: group.items,
                };
            })
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .slice(0, 8);

        const linkConnectionCandidates = Array.from(linkGroups.values())
            .filter((group) => group.items.length > 1 && group.sources.size > 1)
            .map((group) => ({
                key: `url:${group.key}`,
                label: `${group.title} · ${Array.from(group.sources).sort((a, b) => a.localeCompare(b)).join(" + ")}`,
                count: group.items.length,
                sources: Array.from(group.sources).sort((a, b) => a.localeCompare(b)),
                reason: "同链接跨源候选",
                items: group.items,
                url: group.url,
            }));

        const connectionCandidates = Array.from(new Map([
            ...duplicateCandidates
                .filter((group) => group.sourceCount > 1)
                .map((group) => [group.key, {
                    key: `title:${group.key}`,
                    label: `${group.label} · ${group.sources.join(" + ")}`,
                    count: group.count,
                    sources: group.sources,
                    reason: "同标题跨源候选",
                    items: group.items,
                }]),
            ...linkConnectionCandidates.map((group) => [group.key, group]),
        ]).values()).slice(0, 8);

        const funnel = [
            { label: "已扫描页面", count: totalPages, pct: UI().getViewPct(totalPages, totalPages) },
            { label: "识别来源", count: sourcedPages, pct: UI().getViewPct(sourcedPages, totalPages) },
            { label: "有时间字段", count: datedPages, pct: UI().getViewPct(datedPages, totalPages) },
            { label: "已分类", count: categorizedPages, pct: UI().getViewPct(categorizedPages, totalPages) },
            { label: "结构完整", count: structuredPages, pct: UI().getViewPct(structuredPages, totalPages) },
        ];

        return {
            totalPages,
            totalDatabases: databases.length,
            scannedAt: Number(snapshot?.scannedAt || 0),
            maxPages: Number(snapshot?.maxPages || 0),
            recognizedSources: Array.from(recognizedSources).sort((a, b) => a.localeCompare(b)),
            sourceBreakdown: toBreakdown(sourceCounts),
            categoryBreakdown: toBreakdown(categoryCounts),
            timeline,
            relationships,
            duplicateCandidates,
            connectionCandidates,
            funnel,
            sourcedPages,
            datedPages,
            categorizedPages,
            structuredPages,
            missingSourcePages: Math.max(0, totalPages - sourcedPages),
            missingDatePages: Math.max(0, totalPages - datedPages),
            missingCategoryPages: Math.max(0, totalPages - categorizedPages),
        };
    },

    normalizeWorkspaceInsightKey: (value) => {
        const raw = String(value || "")
            .toLowerCase()
            .replace(/[\s\u3000]+/g, " ")
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim();
        if (!raw) return "";
        return raw.replace(/\s+/g, " ");
    },

    normalizeWorkspaceInsightUrl: (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        try {
            const parsed = new URL(raw);
            const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
            const search = parsed.search || "";
            return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${search}`;
        } catch {
            return raw
                .toLowerCase()
                .replace(/#.*$/, "")
                .replace(/\/+$/, "");
        }
    },

    buildWorkspaceInsightFallbackSummary: (model) => {
        const lines = [];
        if (model.connectionCandidates.length > 0) {
            lines.push(`- 检测到 ${model.connectionCandidates.length} 组跨源关联候选，优先适合作为统一知识条目的合并入口。`);
        } else {
            lines.push("- 当前还没有明显的跨源同标题或同链接候选，统一知识层更多依赖来源字段与分类字段补齐。");
        }
        if (model.missingSourcePages > 0 || model.missingDatePages > 0 || model.missingCategoryPages > 0) {
            lines.push(`- 结构缺口仍然存在：未标记 ${model.missingSourcePages}，缺时间 ${model.missingDatePages}，未分类 ${model.missingCategoryPages}。`);
        } else {
            lines.push("- 当前扫描范围内的来源、时间和分类字段已经全部齐备。");
        }
        const topSource = model.sourceBreakdown[0];
        if (topSource) {
            lines.push(`- 当前工作区以「${topSource.label}」为主，占 ${topSource.pct}%（${topSource.count} 页）。`);
        }
        lines.push("- 下一步建议优先把关联候选收敛成统一条目，再对缺字段页面跑 AI 摘要与分类补齐。");
        return lines.join("\n");
    },

};

module.exports = { WorkspaceVisual };
