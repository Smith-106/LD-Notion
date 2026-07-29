"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { NotionOAuth } = require("../auth");
const { NotionAPI } = require("../api");
const { WorkspaceService } = require("../extract");
const { AutoImporter, GitHubAutoImporter, GitHubAPI } = require("../import");
const { BookmarkAutoImporter, RSSAutoImporter } = require("../bridge");
const { AIAssistant, AIService, ChatUI } = require("../ai");

// 工作区洞察/同步中心/可视化渲染相关方法，引用 UI 自身方法与状态（如 UI.refs、
// UI.workspaceVisualSnapshot、UI.buildWorkspaceVisualizationModel 等）。
// 采用惰性 require 模式避免循环依赖，运行时获取 UI 引用。
let _UI = null;
const UI = () => {
    if (!_UI) _UI = require("./main-ui").UI;
    return _UI;
};

const WorkspaceInsight = {

    buildWorkspaceInsightMarkdown: (model = UI().buildWorkspaceVisualizationModel(), aiSummary = UI().workspaceInsightSummary || "") => {
        if (!model?.scannedAt) {
            return "# 工作区洞察报告\n\n尚未刷新工作区视图，暂无可分享的数据。";
        }

        const scannedAt = new Date(model.scannedAt).toLocaleString("zh-CN", { hour12: false });
        const structuredPct = UI().getViewPct(model.structuredPages, model.totalPages);
        const sourceLines = model.sourceBreakdown.length > 0
            ? model.sourceBreakdown.map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无来源分布数据"];
        const categoryLines = model.categoryBreakdown.length > 0
            ? model.categoryBreakdown.slice(0, 8).map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无分类统计"];
        const timelineLines = model.timeline.length > 0
            ? model.timeline.map((item) => `- ${item.label}：${item.count} 页`)
            : ["- 暂无时间线数据"];
        const relationshipLines = model.relationships.length > 0
            ? model.relationships.slice(0, 8).map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无来源关系数据"];
        const funnelLines = model.funnel.length > 0
            ? model.funnel.map((item) => `- ${item.label}：${item.count} 页（${item.pct}%）`)
            : ["- 暂无漏斗数据"];
        const duplicateLines = model.duplicateCandidates.length > 0
            ? model.duplicateCandidates.map((item) => `- ${item.label}：${item.count} 页，来源 ${item.sources.join(" + ") || "未标记"}`)
            : ["- 暂无同标题重复候选"];
        const connectionLines = model.connectionCandidates.length > 0
            ? model.connectionCandidates.map((item) => `- ${item.label}：${item.count} 页，原因：${item.reason}`)
            : ["- 暂无跨源关联候选"];
        const summaryBlock = String(aiSummary || "").trim() || UI().buildWorkspaceInsightFallbackSummary(model);

        return [
            "# 工作区洞察报告",
            "",
            `- 扫描时间：${scannedAt}`,
            `- 页面总数：${model.totalPages}`,
            `- 覆盖数据库：${model.totalDatabases}`,
            `- 已识别来源：${model.sourcedPages}`,
            `- 结构完整率：${structuredPct}%`,
            "",
            "## 洞察摘要",
            summaryBlock,
            "",
            "## 导出漏斗",
            ...funnelLines,
            "",
            "## 来源分布",
            ...sourceLines,
            "",
            "## 分类分布",
            ...categoryLines,
            "",
            "## 全局时间线",
            ...timelineLines,
            "",
            "## 来源关系图",
            ...relationshipLines,
            "",
            "## 重复候选",
            ...duplicateLines,
            "",
            "## 跨源关联候选",
            ...connectionLines,
            "",
            "## 待补齐缺口",
            `- 未标记来源：${model.missingSourcePages}`,
            `- 缺少时间字段：${model.missingDatePages}`,
            `- 未完成分类：${model.missingCategoryPages}`,
        ].join("\n");
    },

    buildWorkspaceConnectionCandidateActionLabel: (action) => {
        const normalized = String(action || "").trim().toLowerCase();
        if (normalized === "merge") return "合并整理";
        if (normalized === "enrich") return "补充信息";
        if (normalized === "archive") return "暂缓归档";
        return "人工复核";
    },

    buildWorkspaceConnectionCandidateWorkflow: (candidate, aiDraft = null) => {
        const normalized = String(aiDraft?.recommendedAction || "review").trim().toLowerCase();
        const presets = {
            merge: {
                actionLabel: "合并整理",
                actionNames: ["合并整理", "合并", "Merge"],
                statusLabel: "待处理",
                statusNames: ["待处理", "待合并", "待办", "未开始", "Not started", "Backlog", "Inbox", "To do"],
                defaultNextStep: "确认主条目后合并重复来源，并补充统一摘要。",
            },
            review: {
                actionLabel: "人工复核",
                actionNames: ["人工复核", "复核", "Review"],
                statusLabel: "待复核",
                statusNames: ["待复核", "待处理", "待办", "未开始", "Not started", "Backlog", "Inbox", "To do"],
                defaultNextStep: "人工确认这些来源是否属于同一知识条目。",
            },
            enrich: {
                actionLabel: "补充信息",
                actionNames: ["补充信息", "补充", "Enrich"],
                statusLabel: "待补充",
                statusNames: ["待补充", "待处理", "待办", "未开始", "Not started", "Backlog", "Inbox", "To do"],
                defaultNextStep: "先补充缺失来源上下文，再决定是否合并。",
            },
            archive: {
                actionLabel: "暂缓归档",
                actionNames: ["暂缓归档", "归档", "Archive"],
                statusLabel: "已搁置",
                statusNames: ["已搁置", "暂缓", "归档", "Not started", "Backlog"],
                defaultNextStep: "暂缓处理，保留候选以备后续复核。",
            },
        };

        const preset = presets[normalized] || presets.review;
        return {
            recommendedAction: normalized || "review",
            actionLabel: preset.actionLabel,
            actionNames: preset.actionNames,
            statusLabel: preset.statusLabel,
            statusNames: preset.statusNames,
            nextStep: String(aiDraft?.nextStep || preset.defaultNextStep).trim().slice(0, 200),
            mergeReason: String(aiDraft?.mergeReason || `${candidate?.reason || "跨源候选"}，建议保留为统一知识条目的整理入口。`).trim().slice(0, 200),
        };
    },

    buildWorkspaceConnectionCandidateAIPrompt: (candidate) => {
        const items = Array.isArray(candidate?.items) ? candidate.items : [];
        return [
            "你是知识整理助手。请基于以下跨源关联候选，输出一个适合写回 Notion 的统一知识条目整理建议。",
            "要求：",
            "1. 只返回 JSON，不要包含任何额外说明。",
            "2. canonicalTitle 使用中文，20 字以内，适合作为统一知识条目标题。",
            "3. summary 使用中文，80 字以内，概括这些候选的共同主题与价值。",
            "4. recommendedAction 只能是 merge、review、enrich、archive 之一。",
            "5. nextStep 使用一句中文，给出下一步整理动作。",
            "6. mergeReason 使用一句中文，说明为什么它们应该合并或关联。",
            "7. tags 返回 1-5 个短标签。",
            "",
            "JSON Schema:",
            "{\"canonicalTitle\":\"\",\"summary\":\"\",\"recommendedAction\":\"merge|review|enrich|archive\",\"nextStep\":\"\",\"mergeReason\":\"\",\"tags\":[\"\"]}",
            "",
            JSON.stringify({
                label: candidate?.label || "",
                reason: candidate?.reason || "",
                count: Number(candidate?.count || items.length || 0),
                sources: Array.isArray(candidate?.sources) ? candidate.sources : [],
                url: candidate?.url || "",
                items: items.map((item) => ({
                    title: item?.title || "",
                    source: item?.source || "",
                    parentLabel: item?.parentLabel || "",
                    url: item?.url || "",
                })),
            }, null, 2),
        ].join("\n");
    },

    buildWorkspaceConnectionCandidateAIDraft: async (candidate, settings) => {
        if (!settings?.aiApiKey || !settings?.aiService) return null;

        try {
            const prompt = UI().buildWorkspaceConnectionCandidateAIPrompt(candidate);
            const raw = String(await AIService.requestChat(prompt, settings, 700) || "").trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("AI 未返回有效 JSON。");
            }

            const parsed = JSON.parse(jsonMatch[0]);
            const canonicalTitle = String(parsed?.canonicalTitle || parsed?.title || "").trim();
            const summary = String(parsed?.summary || "").trim();
            const recommendedAction = String(parsed?.recommendedAction || "review").trim().toLowerCase();
            const nextStep = String(parsed?.nextStep || "").trim();
            const mergeReason = String(parsed?.mergeReason || "").trim();
            const tags = Array.from(new Set(
                (Array.isArray(parsed?.tags) ? parsed.tags : [])
                    .map((item) => String(item || "").trim())
                    .filter(Boolean)
            )).slice(0, 5);

            return {
                canonicalTitle: canonicalTitle.slice(0, 80),
                summary: summary.slice(0, 200),
                recommendedAction,
                actionLabel: UI().buildWorkspaceConnectionCandidateActionLabel(recommendedAction),
                nextStep: nextStep.slice(0, 200),
                mergeReason: mergeReason.slice(0, 200),
                tags,
            };
        } catch (error) {
            console.warn("[LD-Notion] 统一候选 AI 整理失败，已回退规则版：", error);
            return null;
        }
    },

    buildWorkspaceConnectionCandidateTitle: (candidate, index = 0, aiDraft = null) => {
        const firstTitle = String(candidate?.items?.[0]?.title || "").trim();
        const fallbackLabel = String(candidate?.label || "").trim();
        const aiTitle = String(aiDraft?.canonicalTitle || "").trim();
        const baseTitle = aiTitle || firstTitle || fallbackLabel || `候选 ${index + 1}`;
        const reason = String(candidate?.reason || "").trim();
        const fullTitle = reason ? `统一候选 · ${baseTitle} · ${reason}` : `统一候选 · ${baseTitle}`;
        return fullTitle.slice(0, 200);
    },

    buildWorkspaceConnectionCandidateMarkdown: (candidate, savedAt = Date.now(), aiDraft = null) => {
        const items = Array.isArray(candidate?.items) ? candidate.items : [];
        const sourceList = Array.isArray(candidate?.sources) ? candidate.sources.filter(Boolean) : [];
        const exportedAt = new Date(savedAt).toLocaleString("zh-CN", { hour12: false });
        const workflow = UI().buildWorkspaceConnectionCandidateWorkflow(candidate, aiDraft);
        const lines = [
            "# 统一候选条目",
            "",
            `- 候选标签：${candidate?.label || "未命名候选"}`,
            `- 原因：${candidate?.reason || "未标记"}`,
            `- 来源组合：${sourceList.join(" + ") || "未标记"}`,
            `- 候选数量：${items.length}`,
            `- 导出时间：${exportedAt}`,
        ];

        if (candidate?.url) {
            lines.push(`- 候选链接：${candidate.url}`);
        }

        if (candidate?.key) {
            lines.push(`- 候选键：${candidate.key}`);
        }

        lines.push("", "## 处理状态");
        lines.push(`- 当前状态：${workflow.statusLabel}`);
        lines.push(`- 建议动作：${workflow.actionLabel}`);
        lines.push(`- 下一步：${workflow.nextStep}`);
        lines.push(`- 合并理由：${workflow.mergeReason}`);

        if (aiDraft) {
            lines.push("", "## AI 整理建议");
            if (aiDraft.canonicalTitle) {
                lines.push(`- 统一标题：${aiDraft.canonicalTitle}`);
            }
            if (aiDraft.summary) {
                lines.push(`- 摘要：${aiDraft.summary}`);
            }
            if (Array.isArray(aiDraft.tags) && aiDraft.tags.length > 0) {
                lines.push(`- AI 标签：${aiDraft.tags.join(" / ")}`);
            }
        }

        lines.push("", "## 候选条目明细");

        if (items.length === 0) {
            lines.push("- 当前候选没有可写入的条目明细。");
        } else {
            items.forEach((item, index) => {
                lines.push(`### 条目 ${index + 1}`);
                lines.push(`- 标题：${item?.title || "未命名页面"}`);
                lines.push(`- 来源：${item?.source || "未标记"}`);
                lines.push(`- 上级归属：${item?.parentLabel || "未标记"}`);
                lines.push(`- 页面 ID：${item?.id || ""}`);
                if (item?.url) {
                    lines.push(`- URL：${item.url}`);
                }
                lines.push("");
            });
        }

        return lines.join("\n").trim();
    },

    buildWorkspaceConnectionCandidateDatabaseProperties: (database, titlePropertyName, candidate, candidateTitle, aiDraft = null) => {
        const databaseProperties = database?.properties || {};
        const workflow = UI().buildWorkspaceConnectionCandidateWorkflow(candidate, aiDraft);
        const properties = {
            [titlePropertyName]: {
                title: [{ text: { content: String(candidateTitle || "统一候选").slice(0, 2000) } }]
            }
        };

        const addTextProperty = (propertyName, value) => {
            const property = databaseProperties[propertyName];
            const text = String(value || "").trim();
            if (!property || !text) return;

            if (property.type === "rich_text") {
                properties[propertyName] = {
                    rich_text: [{ text: { content: text.slice(0, 2000) } }]
                };
                return;
            }

            if (property.type === "select") {
                const options = Array.isArray(property.select?.options) ? property.select.options : [];
                if (options.some((option) => option?.name === text)) {
                    properties[propertyName] = { select: { name: text } };
                }
                return;
            }

            if (property.type === "url" && /^https?:\/\//i.test(text)) {
                properties[propertyName] = { url: text };
            }
        };

        const addChoiceProperty = (propertyName, preferredNames, fallbackText = "") => {
            const property = databaseProperties[propertyName];
            if (!property) return;

            const names = Array.isArray(preferredNames)
                ? preferredNames.map((item) => String(item || "").trim()).filter(Boolean)
                : [];
            const fallback = String(fallbackText || "").trim();

            if (property.type === "status") {
                const options = Array.isArray(property.status?.options) ? property.status.options : [];
                const matched = names.find((name) => options.some((option) => option?.name === name));
                if (matched) {
                    properties[propertyName] = { status: { name: matched } };
                }
                return;
            }

            if (property.type === "select") {
                const options = Array.isArray(property.select?.options) ? property.select.options : [];
                const matched = names.find((name) => options.some((option) => option?.name === name));
                if (matched) {
                    properties[propertyName] = { select: { name: matched } };
                }
                return;
            }

            if (property.type === "rich_text") {
                const content = fallback || names[0] || "";
                if (content) {
                    properties[propertyName] = {
                        rich_text: [{ text: { content: content.slice(0, 2000) } }]
                    };
                }
            }
        };

        const addTagProperty = (propertyName, values) => {
            const property = databaseProperties[propertyName];
            const tags = Array.from(new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 20);
            if (!property || tags.length === 0) return;

            if (property.type === "multi_select") {
                const options = Array.isArray(property.multi_select?.options) ? property.multi_select.options : [];
                const optionNames = new Set(options.map((option) => option?.name).filter(Boolean));
                const matchedTags = tags.filter((tag) => optionNames.has(tag));
                if (matchedTags.length > 0) {
                    properties[propertyName] = {
                        multi_select: matchedTags.map((tag) => ({ name: tag }))
                    };
                }
                return;
            }

            if (property.type === "rich_text") {
                properties[propertyName] = {
                    rich_text: [{ text: { content: tags.join(", ").slice(0, 2000) } }]
                };
            }
        };

        const sourceList = Array.isArray(candidate?.sources) ? candidate.sources : [];
        const aiTags = Array.isArray(aiDraft?.tags) ? aiDraft.tags : [];
        const summaryText = String(aiDraft?.summary || `${candidate?.reason || "跨源候选"}：${sourceList.join(" + ") || "未标记"}`).trim();
        addTextProperty("来源", "统一候选");
        addTextProperty("来源类型", "跨源关联候选");
        addTextProperty("分类", "统一候选");
        addChoiceProperty("状态", workflow.statusNames, workflow.statusLabel);
        addChoiceProperty("处理状态", workflow.statusNames, workflow.statusLabel);
        addChoiceProperty("候选状态", workflow.statusNames, workflow.statusLabel);
        addChoiceProperty("建议动作", workflow.actionNames, workflow.actionLabel);
        addChoiceProperty("处理动作", workflow.actionNames, workflow.actionLabel);
        addTagProperty("标签", ["候选", candidate?.reason, ...sourceList, ...aiTags]);
        addTextProperty("链接", candidate?.url || "");
        addTextProperty("描述", summaryText);
        addTextProperty("摘要", summaryText);
        addTextProperty("AI摘要", summaryText);
        addTextProperty("下一步", workflow.nextStep);
        addTextProperty("合并理由", workflow.mergeReason);
        addTextProperty("统一标题", String(aiDraft?.canonicalTitle || "").trim());

        return properties;
    },

    getWorkspaceConnectionCandidateSchemaDefinition: () => {
        const statusOptions = [
            "待处理",
            "待复核",
            "待补充",
            "待合并",
            "待办",
            "未开始",
            "已搁置",
            "暂缓",
            "归档",
        ].map((name) => ({ name }));
        const actionOptions = [
            "合并整理",
            "人工复核",
            "补充信息",
            "暂缓归档",
            "合并",
            "复核",
            "补充",
            "归档",
        ].map((name) => ({ name }));

        return {
            "来源": { typeName: "rich_text", schema: { rich_text: {} } },
            "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
            "分类": { typeName: "rich_text", schema: { rich_text: {} } },
            "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
            "链接": { typeName: "url", schema: { url: {} } },
            "描述": { typeName: "rich_text", schema: { rich_text: {} } },
            "摘要": { typeName: "rich_text", schema: { rich_text: {} } },
            "AI摘要": { typeName: "rich_text", schema: { rich_text: {} } },
            "状态": { typeName: "select", schema: { select: { options: statusOptions } } },
            "处理状态": { typeName: "select", schema: { select: { options: statusOptions } } },
            "候选状态": { typeName: "select", schema: { select: { options: statusOptions } } },
            "建议动作": { typeName: "select", schema: { select: { options: actionOptions } } },
            "处理动作": { typeName: "select", schema: { select: { options: actionOptions } } },
            "下一步": { typeName: "rich_text", schema: { rich_text: {} } },
            "合并理由": { typeName: "rich_text", schema: { rich_text: {} } },
            "统一标题": { typeName: "rich_text", schema: { rich_text: {} } },
        };
    },

    ensureWorkspaceConnectionCandidateDatabaseSchema: async (databaseId, apiKey, database = null) => {
        const currentDatabase = database || await NotionAPI.fetchDatabase(databaseId, apiKey);
        const existingProps = currentDatabase?.properties || {};
        const requiredProperties = UI().getWorkspaceConnectionCandidateSchemaDefinition();
        const propsToAdd = {};
        const typeConflicts = [];

        for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
            const existingProp = existingProps[name];
            if (!existingProp) {
                propsToAdd[name] = schema;
                continue;
            }
            if (existingProp.type !== typeName) {
                typeConflicts.push({
                    name,
                    expected: typeName,
                    actual: existingProp.type,
                });
            }
        }

        if (typeConflicts.length > 0) {
            const detail = typeConflicts
                .map((item) => `「${item.name}」期望 ${item.expected}，当前为 ${item.actual}`)
                .join("；");
            throw new Error(`统一候选目标数据库属性类型不匹配：${detail}`);
        }

        if (Object.keys(propsToAdd).length === 0) {
            return currentDatabase;
        }

        await AIAssistant._executeGuardedDatabaseWrite(
            "updateDatabase",
            databaseId,
            () => NotionAPI.updateDatabase(databaseId, propsToAdd, apiKey),
            apiKey,
            {
                itemName: "统一候选 schema",
                databaseId,
                source: "ui",
                surface: "workspace-visualization",
                propertyNames: Object.keys(propsToAdd),
            }
        );

        return {
            ...currentDatabase,
            properties: {
                ...existingProps,
                ...Object.fromEntries(
                    Object.entries(requiredProperties)
                        .filter(([name]) => propsToAdd[name])
                        .map(([name, { typeName, schema }]) => ([
                            name,
                            { type: typeName, ...schema },
                        ]))
                ),
            },
        };
    },

    formatSyncDateTime: (timestamp, emptyText = "未记录") => {
        const numeric = Number(timestamp);
        if (!Number.isFinite(numeric) || numeric <= 0) return emptyText;
        return new Date(numeric).toLocaleString("zh-CN", { hour12: false });
    },

    formatSyncWatermarkLabel: (watermark, emptyText = "未建立") => {
        if (!watermark?.time) return emptyText;
        const timeLabel = new Date(watermark.time).toLocaleString("zh-CN", { hour12: false });
        const boundaryCount = Array.isArray(watermark.ids) ? watermark.ids.length : 0;
        return boundaryCount > 0 ? `${timeLabel} · ${boundaryCount} 个边界 ID` : timeLabel;
    },

    getSyncOutcomeMeta: (outcome) => {
        const normalized = String(outcome || "idle");
        if (normalized === "running") return { label: "同步中", tone: "running" };
        if (normalized === "success") return { label: "正常", tone: "success" };
        if (normalized === "partial") return { label: "部分成功", tone: "partial" };
        if (normalized === "error") return { label: "失败", tone: "error" };
        return { label: "待机", tone: "idle" };
    },

    buildSyncStatsText: (sourceKey, stats = {}) => {
        if (!stats || typeof stats !== "object") return "暂无统计";
        if (sourceKey === "linuxdo") {
            if (!stats.scanned && !stats.pending && !stats.success && !stats.failed) return "暂无统计";
            return `扫描 ${stats.scanned || 0}，待处理 ${stats.pending || 0}，成功 ${stats.success || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}`;
        }
        if (sourceKey === "github") {
            if (!stats.enabledTypes && !stats.exported && !stats.failed && !stats.syncErrors) return "暂无统计";
            return `启用 ${stats.enabledTypes || 0} 类，成功 ${stats.exported || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}${stats.syncErrors ? `，异常 ${stats.syncErrors}` : ""}`;
        }
        if (sourceKey === "bookmarks") {
            if (!stats.created && !stats.updated && !stats.archived && !stats.failed && !stats.unchanged) return "暂无统计";
            return `新增 ${stats.created || 0}，更新 ${stats.updated || 0}，归档 ${stats.archived || 0}，无变更 ${stats.unchanged || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}`;
        }
        if (sourceKey === "rss") {
            if (!stats.feeds && !stats.scanned && !stats.created && !stats.updated && !stats.failed && !stats.unchanged) return "暂无统计";
            return `Feed ${stats.feeds || 0}，扫描 ${stats.scanned || 0}，新增 ${stats.created || 0}，更新 ${stats.updated || 0}，无变更 ${stats.unchanged || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}`;
        }
        return "暂无统计";
    },

    buildUnifiedSyncModel: () => {
        const githubTypeLabelMap = {
            stars: "Stars",
            repos: "Repos",
            forks: "Forks",
            gists: "Gists",
        };
        const linuxdoState = SyncState.getLinuxDoState();
        const githubMeta = SyncState.getGitHubMeta();
        const githubTypes = Array.from(new Set((GitHubAPI.getImportTypes() || []).filter(Boolean)));
        const githubStates = githubTypes.map((type) => ({
            type,
            label: githubTypeLabelMap[type] || type,
            state: SyncState.getGitHubState(type),
        }));
        const bookmarkState = SyncState.getBookmarkState();
        const rssState = SyncState.getRssState();
        const rssFeedCount = RSSAutoImporter.getFeedUrls().length;

        const sourceRows = [
            {
                key: "linuxdo",
                label: "Linux.do",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.autoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.autoImportInterval), 10) || 0,
                outcome: linuxdoState.lastOutcome,
                lastSuccessAt: linuxdoState.lastSuccessAt || 0,
                lastAttemptAt: linuxdoState.lastAttemptAt || 0,
                lastError: linuxdoState.lastError || "",
                watermarkLabel: UI().formatSyncWatermarkLabel(linuxdoState.watermark),
                statsLabel: UI().buildSyncStatsText("linuxdo", linuxdoState.lastStats),
                scheduleLabel: "定时轮询导入 Linux.do 新收藏",
                detailLabel: "增量基线来自最近收藏时间 + 边界 ID",
            },
            {
                key: "github",
                label: "GitHub",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.githubAutoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.githubAutoImportInterval), 10) || 0,
                outcome: githubMeta.lastOutcome,
                lastSuccessAt: githubMeta.lastSuccessAt || 0,
                lastAttemptAt: githubMeta.lastAttemptAt || 0,
                lastError: githubMeta.lastError || "",
                watermarkLabel: githubStates.length > 0
                    ? githubStates.map((item) => `${item.label}：${UI().formatSyncWatermarkLabel(item.state.watermark)}`).join("；")
                    : "未选择导入类型",
                statsLabel: UI().buildSyncStatsText("github", githubMeta.lastStats),
                scheduleLabel: githubTypes.length > 0 ? `启用类型：${githubTypes.map((type) => githubTypeLabelMap[type] || type).join(" / ")}` : "未选择导入类型",
                detailLabel: "每种 GitHub 类型都维护独立增量基线",
            },
            {
                key: "bookmarks",
                label: "浏览器书签",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.bookmarkAutoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.bookmarkAutoImportInterval), 10) || 0,
                outcome: bookmarkState.lastOutcome,
                lastSuccessAt: bookmarkState.lastSuccessAt || 0,
                lastAttemptAt: bookmarkState.lastAttemptAt || 0,
                lastError: bookmarkState.lastError || "",
                watermarkLabel: UI().formatSyncWatermarkLabel(bookmarkState.watermark),
                statsLabel: UI().buildSyncStatsText("bookmarks", bookmarkState.lastStats),
                scheduleLabel: `跟踪 ${Object.keys(bookmarkState.snapshot || {}).length} 个已知书签映射`,
                detailLabel: "增量基线来自书签时间 + 当前快照映射",
            },
            {
                key: "rss",
                label: "RSS",
                enabled: !!Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.rssAutoImportEnabled),
                intervalMinutes: parseInt(Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.rssAutoImportInterval), 10) || 0,
                outcome: rssState.lastOutcome,
                lastSuccessAt: rssState.lastSuccessAt || 0,
                lastAttemptAt: rssState.lastAttemptAt || 0,
                lastError: rssState.lastError || "",
                watermarkLabel: UI().formatSyncWatermarkLabel(rssState.watermark),
                statsLabel: UI().buildSyncStatsText("rss", rssState.lastStats),
                scheduleLabel: rssFeedCount > 0 ? `监控 ${rssFeedCount} 个 Feed` : "未配置 Feed URL",
                detailLabel: "增量基线来自 Feed 发布时间 + 当前快照映射",
            },
        ].map((row) => {
            const outcomeMeta = UI().getSyncOutcomeMeta(row.outcome);
            const intervalLabel = row.enabled
                ? (row.intervalMinutes > 0 ? `${row.intervalMinutes} 分钟轮询` : "仅页面打开时补跑")
                : "未启用";
            return {
                ...row,
                outcomeLabel: outcomeMeta.label,
                outcomeTone: outcomeMeta.tone,
                intervalLabel,
                lastSuccessLabel: UI().formatSyncDateTime(row.lastSuccessAt, "未成功同步"),
                lastAttemptLabel: UI().formatSyncDateTime(row.lastAttemptAt, "未尝试"),
            };
        });

        const latestSuccessRow = sourceRows
            .filter((row) => row.lastSuccessAt > 0)
            .sort((a, b) => b.lastSuccessAt - a.lastSuccessAt)[0] || null;

        return {
            sourceRows,
            enabledCount: sourceRows.filter((row) => row.enabled).length,
            runningCount: sourceRows.filter((row) => row.outcome === "running").length,
            issueCount: sourceRows.filter((row) => row.enabled && (row.outcome === "error" || row.outcome === "partial")).length,
            latestSuccessSource: latestSuccessRow ? latestSuccessRow.label : "尚未建立",
            latestSuccessLabel: latestSuccessRow ? latestSuccessRow.lastSuccessLabel : "暂无成功记录",
        };
    },

    renderSyncCenterSummary: () => {
        const container = UI().refs?.viewSyncSummary;
        if (!container) return;

        const model = UI().buildUnifiedSyncModel();
        if (!model.sourceRows.length) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">统一同步中心还没有来源</div>
                    <div class="ldb-view-empty-text">启用自动同步后，这里会聚合展示各来源的轮询状态和增量基线。</div>
                </div>
            `;
            return;
        }

        const sourceCards = model.sourceRows.map((row) => {
            const highlights = [
                `<span class="ldb-view-pill">${Utils.escapeHtml(row.intervalLabel)}</span>`,
                `<span class="ldb-view-pill">${Utils.escapeHtml(row.outcomeLabel)}</span>`,
            ].join("");
            const errorMarkup = row.lastError
                ? `<div class="ldb-view-empty-text" style="margin-top: var(--ldb-ui-spacing-md); color: var(--ldb-ui-danger);">最近异常：${Utils.escapeHtml(row.lastError)}</div>`
                : "";
            return `
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">${Utils.escapeHtml(row.label)}</div>
                    <div class="ldb-view-metric-value">${Utils.escapeHtml(row.outcomeLabel)}</div>
                    <div class="ldb-view-metric-meta">${Utils.escapeHtml(row.scheduleLabel)}</div>
                    <div class="ldb-view-highlight">${highlights}</div>
                    <div class="ldb-view-link-graph">
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">最近成功</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.lastSuccessLabel)}</div>
                        </div>
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">最近尝试</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.lastAttemptLabel)}</div>
                        </div>
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">增量基线</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.watermarkLabel)}</div>
                        </div>
                        <div class="ldb-view-link-row">
                            <div class="ldb-view-link-path">最近统计</div>
                            <div class="ldb-view-link-count">${Utils.escapeHtml(row.statsLabel)}</div>
                        </div>
                    </div>
                    <div class="ldb-view-empty-text" style="margin-top: var(--ldb-ui-spacing-md);">${Utils.escapeHtml(row.detailLabel)}</div>
                    ${errorMarkup}
                </div>
            `;
        }).join("");

        container.innerHTML = `
            <div class="ldb-view-grid">
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">已启用来源</div>
                    <div class="ldb-view-metric-value">${model.enabledCount}</div>
                    <div class="ldb-view-metric-meta">共 ${model.sourceRows.length} 条多源同步链</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">最近成功</div>
                    <div class="ldb-view-metric-value">${Utils.escapeHtml(model.latestSuccessSource)}</div>
                    <div class="ldb-view-metric-meta">${Utils.escapeHtml(model.latestSuccessLabel)}</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">运行中 / 需关注</div>
                    <div class="ldb-view-metric-value">${model.runningCount} / ${model.issueCount}</div>
                    <div class="ldb-view-metric-meta">运行中来源 / 部分成功或失败来源</div>
                </div>
                ${sourceCards}
            </div>
        `;
    },

    runUnifiedSyncNow: async () => {
        const refs = UI().refs || {};
        const btn = refs.viewSyncNowBtn;
        const tasks = [];

        if (Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.autoImportEnabled)) {
            tasks.push({ label: "Linux.do", run: () => AutoImporter.run() });
        }
        if (Storage.get(CONFIG.STORAGE_KEYS.GITHUB_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.githubAutoImportEnabled)) {
            tasks.push({ label: "GitHub", run: () => GitHubAutoImporter.run() });
        }
        if (Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.bookmarkAutoImportEnabled)) {
            tasks.push({ label: "浏览器书签", run: () => BookmarkAutoImporter.run() });
        }
        if (Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.rssAutoImportEnabled)) {
            tasks.push({ label: "RSS", run: () => RSSAutoImporter.run() });
        }

        if (tasks.length === 0) {
            throw new Error("至少先启用一个自动同步来源。");
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = "同步中...";
        }

        try {
            for (const task of tasks) {
                await task.run();
            }
            UI().renderSyncCenterSummary();
            const model = UI().buildUnifiedSyncModel();
            UI().showStatus(
                `统一同步完成：已执行 ${tasks.map((task) => task.label).join("、")}，当前需关注来源 ${model.issueCount} 个。`,
                model.issueCount > 0 ? "error" : "success"
            );
            return model;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "立即同步全部";
            }
        }
    },

    setWorkspaceVisualStatus: (message, tone = "") => {
        const statusEl = UI().refs?.viewWorkspaceStatus;
        if (!statusEl) return;
        statusEl.textContent = message || "尚未刷新工作区视图。";
        if (statusEl.dataset) {
            if (tone) statusEl.dataset.tone = tone;
            else delete statusEl.dataset.tone;
        }
    },

    refreshWorkspaceVisualization: async (apiKey = NotionOAuth.getAccessToken(UI().refs?.apiKeyInput?.value.trim())) => {
        if (!apiKey) {
            UI().setWorkspaceVisualStatus(MSG.NO_NOTION_KEY, "error");
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const maxPages = parseInt(UI().refs?.workspaceMaxPagesSelect?.value, 10)
            || parseInt(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages), 10)
            || 0;
        const refreshBtn = UI().refs?.viewRefreshWorkspaceBtn;

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = "扫描中...";
        }

        UI().setWorkspaceVisualStatus("正在扫描工作区数据库...", "");

        try {
            const { databases, workspaceData } = await WorkspaceService.refreshWorkspaceSnapshot(apiKey, {
                includePages: false,
                maxPages,
                onProgress: (progress) => {
                    if (progress.phase === "databases") {
                        UI().setWorkspaceVisualStatus(`正在扫描工作区数据库... 已加载 ${progress.loaded} 个数据库`, "");
                    }
                },
                onWorkspaceData: (partialData) => {
                    UI().updateWorkspaceSelect(partialData);
                    UI().updateAITargetDbOptions(partialData.databases || []);
                },
            });

            UI().setWorkspaceVisualStatus("数据库已就绪，正在分析页面属性...", "");

            const pageObjects = await WorkspaceService.fetchWorkspacePageObjects(apiKey, {
                maxPages,
                phase: "workspace_visual_pages",
                onProgress: (progress) => {
                    UI().setWorkspaceVisualStatus(`正在分析页面属性... 已扫描 ${progress.loaded} 个页面`, "");
                },
            });

            const databasesMap = new Map(databases.map((d) => [d.id, d]));
            const pages = [];
            const records = [];
            pageObjects.forEach((page) => {
                const summary = UI().mapWorkspacePageSummary(page);
                if (summary.id) {
                    pages.push(summary);
                    records.push(UI().extractWorkspaceVisualRecord(page, databasesMap));
                }
            });
            const finalWorkspaceData = WorkspaceService.persistWorkspaceData(apiKey, {
                databases,
                pages,
            });

            UI().updateWorkspaceSelect(finalWorkspaceData);
            UI().updateAITargetDbOptions(finalWorkspaceData.databases || []);
            UI().workspaceVisualSnapshot = {
                databases,
                pages,
                records,
                scannedAt: Date.now(),
                maxPages,
            };
            UI().workspaceInsightSummary = "";
            UI().workspaceInsightMarkdown = UI().buildWorkspaceInsightMarkdown(UI().buildWorkspaceVisualizationModel(UI().workspaceVisualSnapshot), "");
            UI().workspaceInsightUpdatedAt = Date.now();
            UI().renderWorkspaceVisualSummary();

            const model = UI().buildWorkspaceVisualizationModel();
            UI().setWorkspaceVisualStatus(
                `已扫描 ${model.totalPages} 个页面，覆盖 ${model.totalDatabases} 个数据库。`,
                "success"
            );
            return model;
        } catch (error) {
            UI().setWorkspaceVisualStatus(`工作区视图刷新失败：${error.message}`, "error");
            throw error;
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = "刷新工作区视图";
            }
        }
    },

    renderWorkspaceVisualSummary: () => {
        const container = UI().refs?.viewWorkspaceSummary;
        if (!container) return;

        const model = UI().buildWorkspaceVisualizationModel();
        if (!model.scannedAt) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">工作区总览还没有数据</div>
                    <div class="ldb-view-empty-text">点击上方按钮后，会扫描当前工作区数据库里的页面属性，生成全局时间线、来源关系图和导出漏斗。</div>
                </div>
            `;
            return;
        }

        if (model.totalPages === 0) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">本次扫描没有可统计页面</div>
                    <div class="ldb-view-empty-text">已完成工作区扫描，但当前范围内没有可用于聚合的页面属性。</div>
                </div>
            `;
            return;
        }

        const timelineMarkup = model.timeline.length > 0
            ? `<div class="ldb-view-timeline">${model.timeline.map((item) => `
                <div class="ldb-view-timeline-item">
                    <div class="ldb-view-timeline-label">${item.label}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${Math.max(8, item.pct || UI().getViewPct(item.count, model.totalPages))}%;"></div></div>
                    <div class="ldb-view-timeline-value">${item.count} 页</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前工作区页面里还没有可解析的时间字段。</div>`;

        const relationshipMarkup = model.relationships.length > 0
            ? `<div class="ldb-view-link-graph">${model.relationships.map((item) => `
                <div class="ldb-view-link-row">
                    <div class="ldb-view-link-path">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-link-count">${item.count} 页 · ${item.pct}%</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前工作区页面里还没有可展示的来源关系。</div>`;

        const funnelMarkup = model.funnel.length > 0
            ? `<div class="ldb-view-funnel">${model.funnel.map((item) => `
                <div class="ldb-view-funnel-row">
                    <div class="ldb-view-funnel-label">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-funnel-value">${item.count} 页 · ${item.pct}%</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前没有可展示的漏斗数据。</div>`;

        const highlights = [
            `未标记 ${model.missingSourcePages}`,
            `缺时间 ${model.missingDatePages}`,
            `未分类 ${model.missingCategoryPages}`,
        ].map((text) => `<span class="ldb-view-pill">${Utils.escapeHtml(text)}</span>`).join("");
        const duplicateMarkup = model.duplicateCandidates.length > 0
            ? `<div class="ldb-view-link-graph">${model.duplicateCandidates.map((item) => `
                <div class="ldb-view-link-row">
                    <div class="ldb-view-link-path">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-link-count">${item.count} 页 · ${Utils.escapeHtml(item.sources.join(" + ") || "未标记")}</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前还没有识别到明显的同标题重复候选。</div>`;
        const connectionMarkup = model.connectionCandidates.length > 0
            ? `<div class="ldb-view-link-graph">${model.connectionCandidates.map((item) => `
                <div class="ldb-view-link-row">
                    <div class="ldb-view-link-path">${Utils.escapeHtml(item.label)}</div>
                    <div class="ldb-view-link-count">${item.count} 页 · ${Utils.escapeHtml(item.reason)}</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前还没有跨源关联候选，继续补齐来源字段后会更容易发现统一条目。</div>`;
        const insightSummary = String(UI().workspaceInsightSummary || "").trim();
        const reportPreview = Utils.escapeHtml(
            UI().workspaceInsightMarkdown
            || UI().buildWorkspaceInsightMarkdown(model, insightSummary)
        );

        container.innerHTML = `
            <div class="ldb-view-grid">
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">已扫描页面</div>
                    <div class="ldb-view-metric-value">${model.totalPages}</div>
                    <div class="ldb-view-metric-meta">覆盖 ${model.totalDatabases} 个数据库</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">结构完整</div>
                    <div class="ldb-view-metric-value">${model.structuredPages}</div>
                    <div class="ldb-view-metric-meta">来源、时间、分类三项齐备</div>
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">全局时间线</div>
                    ${timelineMarkup}
                    ${highlights ? `<div class="ldb-view-highlight">${highlights}</div>` : ""}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">来源关系图</div>
                    ${relationshipMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">导出漏斗</div>
                    ${funnelMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">重复候选</div>
                    ${duplicateMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">跨源关联候选</div>
                    ${connectionMarkup}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">洞察摘要</div>
                    <div class="ldb-view-empty-text">${ChatUI.safeMarkdown(insightSummary || UI().buildWorkspaceInsightFallbackSummary(model))}</div>
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">Markdown 报告预览</div>
                    <div class="ldb-view-report-preview">${reportPreview}</div>
                </div>
            </div>
        `;
    },

};

module.exports = { WorkspaceInsight };
