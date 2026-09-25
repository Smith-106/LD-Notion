"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState, DedupStore } = require("../storage");
const { NotionOAuth, TargetState } = require("../auth");
const { NotionAPI } = require("../api");
const { ConfirmationDialog } = require("../security");
const { WorkspaceService } = require("../extract");
const { AutoImporter } = require("../import");
const { BookmarkAutoImporter } = require("../bridge");
const { AIAssistant, AIService, ChatUI, getAISettings } = require("../ai");
const { AISchema } = require("../ai/schema");

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

        // P4 收敛(c17): 原型链键守卫 —— AI 可回传 constructor/__proto__ 使 presets[key] 取到 Object 原型成员
        const preset = Object.prototype.hasOwnProperty.call(presets, normalized) ? presets[normalized] : presets.review;
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
            // 候选标题/URL/来源来自 Notion 页面元数据，不可信——与 main-ui 同构，走 isolateContent 防 prompt injection
            `<user_content>\n${AIService.isolateContent(JSON.stringify({
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
            }, null, 2))}\n</user_content>`,
        ].join("\n");
    },

    buildWorkspaceConnectionCandidateAIDraft: async (candidate, settings) => {
        if (!settings?.aiApiKey || !settings?.aiService) return null;

        try {
            const prompt = UI().buildWorkspaceConnectionCandidateAIPrompt(candidate);
            const raw = String(await AIService.requestChat(prompt, settings, 700) || "").trim();
            const parseResult = AISchema.parseAIJson("workspaceConnection", raw);
            if (!parseResult.ok) {
                throw new Error(parseResult.reason);
            }

            const parsed = parseResult.value;
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
        // v3.17: GitHub 收藏源已移除,github 分支保留作历史统计文本兼容(无调用方传入)。
        if (sourceKey === "github") {
            if (!stats.enabledTypes && !stats.exported && !stats.failed && !stats.syncErrors) return "暂无统计";
            return `启用 ${stats.enabledTypes || 0} 类，成功 ${stats.exported || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}${stats.syncErrors ? `，异常 ${stats.syncErrors}` : ""}`;
        }
        if (sourceKey === "bookmarks") {
            if (!stats.created && !stats.updated && !stats.archived && !stats.failed && !stats.unchanged) return "暂无统计";
            return `新增 ${stats.created || 0}，更新 ${stats.updated || 0}，归档 ${stats.archived || 0}，无变更 ${stats.unchanged || 0}${stats.failed ? `，失败 ${stats.failed}` : ""}`;
        }
        return "暂无统计";
    },

    buildUnifiedSyncModel: () => {
        // v3.17: GitHub 收藏源已移除,同步中心仅保留 Linux.do 与浏览器书签两源。
        const linuxdoState = SyncState.getLinuxDoState();
        const bookmarkState = SyncState.getBookmarkState();

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
            // F-04 修复：每个来源卡片提供「重置增量基线」入口
            const resetMarkup = `<button type="button" class="ldb-btn ldb-btn-secondary ldb-btn-small" data-reset-baseline="${Utils.escapeHtml(row.key)}" style="margin-top: var(--ldb-ui-spacing-md);">重置基线</button>`;
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
                    ${resetMarkup}
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

        // F-04 修复：重置基线按钮事件委托
        container.querySelectorAll("[data-reset-baseline]").forEach((btn) => {
            btn.onclick = () => {
                const sourceKey = btn.getAttribute("data-reset-baseline");
                const sourceLabel = sourceKey;
                // P2:原生 confirm 统一为 ConfirmationDialog
                ConfirmationDialog.show({
                    title: `重置「${sourceLabel}」增量基线`,
                    message: `确定重置「${sourceLabel}」的增量同步基线吗？\n重置后下次同步将重新全量扫描。`,
                    confirmText: "重置基线",
                    onConfirm: () => {
                        SyncState.resetSourceState(sourceKey === "bookmarks" ? "bookmark" : sourceKey);
                        WorkspaceInsight.renderSyncCenterSummary();
                        UI().showStatus(`已重置「${sourceLabel}」增量基线，下次同步将全量扫描`, "success");
                    },
                });
            };
        });
    },

    runUnifiedSyncNow: async () => {
        const refs = UI().refs || {};
        const btn = refs.viewSyncNowBtn;
        const tasks = [];

        if (Storage.get(CONFIG.STORAGE_KEYS.AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.autoImportEnabled)) {
            tasks.push({ label: "Linux.do", run: () => AutoImporter.run() });
        }
        if (Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, CONFIG.DEFAULTS.bookmarkAutoImportEnabled)) {
            tasks.push({ label: "浏览器书签", run: () => BookmarkAutoImporter.run() });
        }

        if (tasks.length === 0) {
            throw new Error("至少先启用一个自动同步来源。");
        }

        if (btn) {
            btn.disabled = true;
            btn.textContent = "同步中...";
        }

        try {
            const syncErrors = [];
            for (const task of tasks) {
                try {
                    await task.run();
                } catch (error) {
                    syncErrors.push({ source: task.label, error: error.message });
                }
            }
            UI().renderSyncCenterSummary();
            const model = UI().buildUnifiedSyncModel();
            const successCount = tasks.length - syncErrors.length;
            if (syncErrors.length > 0) {
                UI().showStatus(
                    `统一同步完成：${successCount}/${tasks.length} 个源成功（${syncErrors.map(e => e.source).join("、")} 失败），当前需关注来源 ${model.issueCount} 个。`,
                    successCount > 0 ? "info" : "error"
                );
                console.warn("[LD-Notion] Sync partial failures:", syncErrors);
            } else {
                UI().showStatus(
                    `统一同步完成：已执行 ${tasks.map((task) => task.label).join("、")}，当前需关注来源 ${model.issueCount} 个。`,
                    model.issueCount > 0 ? "error" : "success"
                );
            }
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

    // v3.14.3 修复: 工作区扫描对账回填 —— 用 Notion 页面“链接”属性(导出时写入的原始 URL)
    // 与本地已加载项 URL 精确匹配, 命中即回写已导出账本。
    // 解决存量误判: 导出账本曾被 90 天 TTL 时间淘汰静默遗忘, Notion 已存在页面被 UI 判为“待导出”。
    // 护栏: 仅 strict 模式回填 LinuxDo 账本(allow_duplicates 语义是允许重复导出, 不得被对账破坏);
    // URL 非空且归一化精确相等才回写, 避免误标用户手工页面。
    // v3.14.4 修复: ① LinuxDo 项 Discourse 原始 bookmark 对象无 url 字段(仅 bookmarkable_url 含 slug),
    // 旧实现 bookmark?.url 恒 undefined → LinuxDo 对账永不命中(死代码); 改按 topic_id 构造规范 URL
    // https://linux.do/t/{topicId}(与 LinuxDoAdapter.normalize 及导出写入“链接”属性同法, 无 slug)。
    // Notion 侧若存带 slug 的链接, normalizeWorkspaceInsightUrl 会归一到 /t/{id} 再匹配。
    // ② 数据源改 getCombinedVisualBookmarks() 覆盖多源快照(旧实现只查当前激活源)。
    // ③ 回填后调 renderBookmarkList() 刷新行内徽标, 与状态提示一致。
    // ④ 循环内仅 mutate 账本缓存, 循环末单次 flush(消除写侧 O(N²), 见 AGENTS.md 禁令)。
    reconcileExportedFromWorkspace: (records = []) => {
        // 20260914: 内存快照为空(页面刷新后未手动加载列表)时回退主列表数据 —— 旧实现仅查
        // visualSnapshots, 空快照会话恒 0 命中且静默(用户报「重算也没有用」路径之一)。
        // 按 bookmarkKey 去重合并, 快照优先(保持既有优先级)。
        const combined = UI().getCombinedVisualBookmarks();
        const activeList = Array.isArray(UI().bookmarks) ? UI().bookmarks : [];
        const seenKeys = new Set(combined.map((b) => UI().getBookmarkKey(b)));
        const bookmarks = combined.concat(activeList.filter((b) => !seenKeys.has(UI().getBookmarkKey(b))));
        if (!Array.isArray(bookmarks) || bookmarks.length === 0 || !Array.isArray(records) || records.length === 0) {
            return 0;
        }
        // 本地已加载项 → 归一化 URL 索引。
        // v3.17: GitHub 收藏源已移除,恒按 LinuxDo 项 topic_id 构造无 slug 规范 URL。
        const urlToBookmark = new Map();
        bookmarks.forEach((bookmark) => {
            const topicId = String(bookmark?.topic_id || bookmark?.bookmarkable_id || "");
            const rawUrl = topicId ? `https://linux.do/t/${topicId}` : "";
            const url = UI().normalizeWorkspaceInsightUrl(rawUrl || "");
            if (url && !urlToBookmark.has(url)) urlToBookmark.set(url, bookmark);
        });
        if (urlToBookmark.size === 0) return 0;

        const strictMode = Utils.isLinuxDoDedupStrict();
        let matched = 0;
        // LinuxDo 账本用 DedupStore batch 模式: 循环内 markSeen 仅 mutate 内存缓存,
        // 循环末 endBatch 单次写回(消除逐条全账本序列化的写侧 O(N²), 与 SyncCoordinator 同模式)
        // v3.14.11: 无论是否命中 LinuxDo 回填, beginBatch 后必须 endBatch。
        // 旧逻辑仅在 linuxdoDirty 时 endBatch → 刷新工作区零命中时槽残留;
        // 随后手动/自动导出的 markTopicExported 只写内存, 页面重载后账本丢失,
        // UI 再次显示「待导出」、自动去重失效(用户报「自动去重也有问题」)。
        let linuxdoBatchOpened = false;
        if (strictMode) {
            try {
                DedupStore.beginBatch("linuxdo");
                linuxdoBatchOpened = true;
            } catch { /* batch 不可用时降级直写 */ }
        }
        try {
        records.forEach((record) => {
            const recordUrl = UI().normalizeWorkspaceInsightUrl(record?.sourceUrl || "");
            if (!recordUrl) return;
            const bookmark = urlToBookmark.get(recordUrl);
            if (!bookmark) return;

            if (strictMode) {
                const topicId = String(bookmark?.topic_id || bookmark?.bookmarkable_id || "");
                if (!topicId) return;
                if (Storage.isTopicExported(topicId)) return;
                Storage.markTopicExported(topicId);
                matched++;
            }
        });
        } finally {
            // v3.14.6 (CC-14) + v3.14.11: 只要开过 batch 就必须关闭(含零命中/抛错),
            // 否则槽残留使后续导出 markSeen 仅驻内存、刷新后「待导出」复发。
            if (linuxdoBatchOpened) {
                try { DedupStore.endBatch("linuxdo"); } catch { /* batch 异常时忽略 */ }
                // endBatch 可能 rebase/淘汰; 失效 Storage 侧缓存, 避免同 tab 读到陈旧对象
                Storage._exportedTopicsCache = null;
            }
        }
        // v3.17: GitHub 收藏源已移除,GitHubExporter 落账分支删除。
        if (matched > 0) {
            UI().recomputeExportStats();
            UI().updateSelectCount();
            UI().renderBookmarkList();
        }
        return matched;
    },

    refreshWorkspaceVisualization: async (apiKey = NotionOAuth.getAccessToken(UI().refs?.apiKeyInput?.value.trim())) => {
        if (!apiKey) {
            UI().setWorkspaceVisualStatus(MSG.NO_NOTION_KEY, "error");
            throw new Error(MSG.NO_NOTION_KEY);
        }
        // P3 3/3 共识(dsf+glm+qwen): 并发刷新无请求序号——旧扫描晚到会覆盖新快照/状态。
        const epoch = (UI()._workspaceRefreshEpoch || 0) + 1;
        UI()._workspaceRefreshEpoch = epoch;
        const isStale = () => epoch !== UI()._workspaceRefreshEpoch;

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
                    // P4 收敛(c17): 陈旧请求不得覆盖最新请求的状态文案
                    if (isStale()) return;
                    if (progress.phase === "databases") {
                        UI().setWorkspaceVisualStatus(`正在扫描工作区数据库... 已加载 ${progress.loaded} 个数据库`, "");
                    }
                },
                onWorkspaceData: (partialData) => {
                    if (isStale()) return;
                    UI().updateWorkspaceSelect(partialData);
                    UI().updateAITargetDbOptions(partialData.databases || []);
                },
            });

            if (isStale()) return;
            UI().setWorkspaceVisualStatus("数据库已就绪，正在分析页面属性...", "");

            const pageObjects = await WorkspaceService.fetchWorkspacePageObjects(apiKey, {
                maxPages,
                phase: "workspace_visual_pages",
                onProgress: (progress) => {
                    if (isStale()) return;
                    UI().setWorkspaceVisualStatus(`正在分析页面属性... 已扫描 ${progress.loaded} 个页面`, "");
                },
            });

            if (isStale()) return;
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

            // v3.14.3: 扫描后对账回填 —— Notion 页面“链接”属性与本地已加载项 URL 匹配,
            // 命中即回写已导出账本(仅 strict 模式回填 LinuxDo), 解决存量“待导出”误判。
            const reconciled = WorkspaceInsight.reconcileExportedFromWorkspace(records);

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
            // v3.14.16: Notion 导出状态依据依赖快照——刷新后重算 UI 徽标/待导出计数
            if (typeof UI().recomputeExportStatusFromNotion === "function") {
                try { UI().recomputeExportStatusFromNotion(); } catch { /* ignore */ }
            }

            const model = UI().buildWorkspaceVisualizationModel();
            UI().setWorkspaceVisualStatus(
                reconciled > 0
                    ? `已扫描 ${model.totalPages} 个页面，覆盖 ${model.totalDatabases} 个数据库；并在工作区中识别到 ${reconciled} 项已导出的内容，已同步更新导出状态。`
                    : `已扫描 ${model.totalPages} 个页面，覆盖 ${model.totalDatabases} 个数据库。`,
                "success"
            );
            return model;
        } catch (error) {
            // P4 收敛(c17): 陈旧请求的失败不得覆盖最新刷新的状态
            if (!isStale()) {
                UI().setWorkspaceVisualStatus(`工作区视图刷新失败：${error.message}`, "error");
            }
            throw error;
        } finally {
            // 陈旧请求不解除最新请求的「扫描中」态
            if (refreshBtn && !isStale()) {
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
                    <div class="ldb-view-timeline-label">${Utils.escapeHtml(String(item.label || ""))}</div>
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

    // M3 波次7: 工作区协作包/洞察报告/保存到 Notion/可视化摘要 —— 提取自 main-ui.js (~640 LOC),
    // UI.* 引用统一改 UI(). (lazy accessor,与本文件既有口径一致)。

    buildWorkspaceCollaborationPackage: (
        model = UI().buildWorkspaceVisualizationModel(),
        syncModel = UI().buildUnifiedSyncModel()
    ) => {
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const cloneJson = (value, fallback) => {
            try {
                return JSON.parse(JSON.stringify(value));
            } catch {
                return fallback;
            }
        };

        const markdown = UI().workspaceInsightMarkdown || UI().buildWorkspaceInsightMarkdown(model, UI().workspaceInsightSummary || "");
        const generatedAt = UI().workspaceInsightUpdatedAt || Date.now();
        const summaryText = String(UI().workspaceInsightSummary || "").trim() || UI().buildWorkspaceInsightFallbackSummary(model);

        return {
            packageType: "ld-notion-workspace-collaboration",
            packageVersion: 1,
            generatedAt: new Date(generatedAt).toISOString(),
            workspace: {
                scannedAt: new Date(Number(model.scannedAt || generatedAt)).toISOString(),
                maxPages: Number(model.maxPages || 0),
                totalPages: Number(model.totalPages || 0),
                totalDatabases: Number(model.totalDatabases || 0),
                sourcedPages: Number(model.sourcedPages || 0),
                datedPages: Number(model.datedPages || 0),
                categorizedPages: Number(model.categorizedPages || 0),
                structuredPages: Number(model.structuredPages || 0),
                missingSourcePages: Number(model.missingSourcePages || 0),
                missingDatePages: Number(model.missingDatePages || 0),
                missingCategoryPages: Number(model.missingCategoryPages || 0),
                recognizedSources: cloneJson(model.recognizedSources || [], []),
                sourceBreakdown: cloneJson(model.sourceBreakdown || [], []),
                categoryBreakdown: cloneJson(model.categoryBreakdown || [], []),
                timeline: cloneJson(model.timeline || [], []),
                relationships: cloneJson(model.relationships || [], []),
                funnel: cloneJson(model.funnel || [], []),
                duplicateCandidates: cloneJson(model.duplicateCandidates || [], []),
                connectionCandidates: cloneJson(model.connectionCandidates || [], []),
            },
            insight: {
                summary: summaryText,
                markdown,
                updatedAt: new Date(generatedAt).toISOString(),
            },
            syncCenter: {
                enabledCount: Number(syncModel?.enabledCount || 0),
                runningCount: Number(syncModel?.runningCount || 0),
                issueCount: Number(syncModel?.issueCount || 0),
                latestSuccessSource: String(syncModel?.latestSuccessSource || "尚未建立"),
                latestSuccessLabel: String(syncModel?.latestSuccessLabel || "暂无成功记录"),
                sourceRows: cloneJson(syncModel?.sourceRows || [], []),
            },
        };
    },

    buildWorkspaceCollaborationPackageMarkdown: (collabPackage = UI().buildWorkspaceCollaborationPackage()) => {
        const candidateLines = Array.isArray(collabPackage?.workspace?.connectionCandidates) && collabPackage.workspace.connectionCandidates.length > 0
            ? collabPackage.workspace.connectionCandidates.map((item) => `- ${item.label}：${item.count} 条，原因 ${item.reason}`)
            : ["- 暂无跨源关联候选"];
        const duplicateLines = Array.isArray(collabPackage?.workspace?.duplicateCandidates) && collabPackage.workspace.duplicateCandidates.length > 0
            ? collabPackage.workspace.duplicateCandidates.map((item) => `- ${item.label}：${item.count} 条，来源 ${Array.isArray(item.sources) ? item.sources.join(" + ") : ""}`)
            : ["- 暂无重复候选"];
        const syncLines = Array.isArray(collabPackage?.syncCenter?.sourceRows) && collabPackage.syncCenter.sourceRows.length > 0
            ? collabPackage.syncCenter.sourceRows.map((row) => `- ${row.label}：${row.outcomeLabel}，最近成功 ${row.lastSuccessLabel}，基线 ${row.watermarkLabel}`)
            : ["- 暂无同步中心摘要"];
        const payload = JSON.stringify(collabPackage, null, 2);

        return [
            "# 工作区协作包",
            "",
            `- 生成时间：${collabPackage?.generatedAt || ""}`,
            `- 页面总数：${collabPackage?.workspace?.totalPages || 0}`,
            `- 数据库总数：${collabPackage?.workspace?.totalDatabases || 0}`,
            `- 已启用同步来源：${collabPackage?.syncCenter?.enabledCount || 0}`,
            "",
            "## 协作摘要",
            collabPackage?.insight?.summary || "暂无协作摘要",
            "",
            "## 工作区洞察",
            collabPackage?.insight?.markdown || "暂无洞察内容",
            "",
            "## 统一候选概览",
            ...candidateLines,
            "",
            "## 重复候选概览",
            ...duplicateLines,
            "",
            "## 同步中心摘要",
            ...syncLines,
            "",
            "## 结构化协作包 JSON",
            "```json",
            payload,
            "```",
        ].join("\n");
    },

    copyWorkspaceInsightReport: async () => {
        const model = UI().buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const markdown = UI().workspaceInsightMarkdown || UI().buildWorkspaceInsightMarkdown(model);
        try {
            await UI().copyTextToClipboard(markdown);
            UI().workspaceInsightMarkdown = markdown;
            UI().workspaceInsightUpdatedAt = Date.now();
            UI().showStatus("工作区洞察报告已复制。", "success");
        } catch (error) {
            throw new Error(error?.message || String(error));
        }
    },

    downloadWorkspaceInsightReport: async () => {
        const model = UI().buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const markdown = UI().workspaceInsightMarkdown || UI().buildWorkspaceInsightMarkdown(model);
        const objectUrlApi = (typeof window !== "undefined" && window.URL && typeof window.URL.createObjectURL === "function")
            ? window.URL
            : (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null);
        if (!objectUrlApi) {
            throw new Error("当前环境不支持报告下载。");
        }

        const stampSource = UI().workspaceInsightUpdatedAt || Date.now();
        const stamp = new Date(stampSource).toISOString().replace(/[:.]/g, "-");
        const filename = `ld-notion-workspace-insight-${stamp}.md`;
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const href = objectUrlApi.createObjectURL(blob);

        try {
            const link = document.createElement("a");
            link.href = href;
            link.download = filename;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            if (typeof link.remove === "function") {
                link.remove();
            }
            UI().workspaceInsightMarkdown = markdown;
            UI().workspaceInsightUpdatedAt = Date.now();
            UI().showStatus("工作区洞察报告已开始下载。", "success");
            return { filename, markdown };
        } catch (error) {
            throw new Error(error?.message || String(error));
        } finally {
            if (typeof objectUrlApi.revokeObjectURL === "function") {
                setTimeout(() => objectUrlApi.revokeObjectURL(href), 0);
            }
        }
    },

    downloadWorkspaceCollaborationPackage: async () => {
        const model = UI().buildWorkspaceVisualizationModel();
        const syncModel = UI().buildUnifiedSyncModel();
        const collabPackage = UI().buildWorkspaceCollaborationPackage(model, syncModel);
        const objectUrlApi = (typeof window !== "undefined" && window.URL && typeof window.URL.createObjectURL === "function")
            ? window.URL
            : (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null);
        if (!objectUrlApi) {
            throw new Error("当前环境不支持协作包下载。");
        }

        const stampSource = UI().workspaceInsightUpdatedAt || Date.now();
        const stamp = new Date(stampSource).toISOString().replace(/[:.]/g, "-");
        const filename = `ld-notion-workspace-collaboration-${stamp}.json`;
        const payload = JSON.stringify(collabPackage, null, 2);
        const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
        const href = objectUrlApi.createObjectURL(blob);

        try {
            const link = document.createElement("a");
            link.href = href;
            link.download = filename;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            if (typeof link.remove === "function") {
                link.remove();
            }
            UI().workspaceInsightUpdatedAt = Date.now();
            UI().showStatus("工作区协作包已开始下载。", "success");
            return { filename, payload, collabPackage };
        } catch (error) {
            throw new Error(error?.message || String(error));
        } finally {
            if (typeof objectUrlApi.revokeObjectURL === "function") {
                setTimeout(() => objectUrlApi.revokeObjectURL(href), 0);
            }
        }
    },

    saveWorkspaceCollaborationPackageToNotion: async () => {
        const model = UI().buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI().refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const collabPackage = UI().buildWorkspaceCollaborationPackage(model, UI().buildUnifiedSyncModel());
        const markdown = UI().buildWorkspaceCollaborationPackageMarkdown(collabPackage);
        const packageTime = UI().workspaceInsightUpdatedAt || Date.now();
        const packageTitle = `工作区协作包 ${new Date(packageTime).toLocaleString("zh-CN", { hour12: false })}`;
        const contentBlocks = AIAssistant._textToBlocks(markdown);
        let page = null;

        if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
            const parentPageId = exportState.parentPageId;
            page = await AIAssistant._executeGuardedPageWrite(
                "createDatabasePage",
                { id: parentPageId, name: packageTitle },
                () => NotionAPI.createChildPage(parentPageId, packageTitle, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: packageTitle,
                    pageId: parentPageId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        } else {
            const databaseId = exportState.databaseId;
            const database = await NotionAPI.fetchDatabase(databaseId, apiKey);
            const titlePropertyName = Object.entries(database.properties || {}).find(([_, prop]) => prop?.type === "title")?.[0] || null;
            if (!titlePropertyName) {
                throw new Error("当前目标数据库缺少标题属性，无法保存协作包。");
            }
            const properties = {
                [titlePropertyName]: {
                    title: [{ text: { content: packageTitle } }]
                }
            };
            page = await AIAssistant._executeGuardedDatabaseWrite(
                "createDatabasePage",
                databaseId,
                () => NotionAPI.createPageObject({ database_id: databaseId }, properties, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: packageTitle,
                    databaseId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        }

        const pageId = Utils.extractNotionId(page?.id) || String(page?.id || "").replace(/-/g, "");
        UI().workspaceInsightUpdatedAt = Date.now();
        UI().setWorkspaceVisualStatus(
            `工作区协作包已保存到 Notion（${exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库"}）。`,
            "success"
        );
        UI().showStatus("工作区协作包已保存到 Notion。", "success");
        return {
            pageId,
            title: packageTitle,
            targetId: exportState.targetId,
            targetType: exportState.targetType,
            markdown,
            collabPackage,
        };
    },

    saveWorkspaceInsightReportToNotion: async () => {
        const model = UI().buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI().refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const markdown = UI().workspaceInsightMarkdown || UI().buildWorkspaceInsightMarkdown(model);
        const reportTime = UI().workspaceInsightUpdatedAt || Date.now();
        const reportTitle = `工作区洞察报告 ${new Date(reportTime).toLocaleString("zh-CN", { hour12: false })}`;
        const contentBlocks = AIAssistant._textToBlocks(markdown);
        let page = null;

        if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
            const parentPageId = exportState.parentPageId;
            page = await AIAssistant._executeGuardedPageWrite(
                "createDatabasePage",
                { id: parentPageId, name: reportTitle },
                () => NotionAPI.createChildPage(parentPageId, reportTitle, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: reportTitle,
                    pageId: parentPageId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        } else {
            const databaseId = exportState.databaseId;
            const database = await NotionAPI.fetchDatabase(databaseId, apiKey);
            const titlePropertyName = Object.entries(database.properties || {}).find(([_, prop]) => prop?.type === "title")?.[0] || null;
            if (!titlePropertyName) {
                throw new Error("当前目标数据库缺少标题属性，无法保存报告。");
            }
            const properties = {
                [titlePropertyName]: {
                    title: [{ text: { content: reportTitle } }]
                }
            };
            page = await AIAssistant._executeGuardedDatabaseWrite(
                "createDatabasePage",
                databaseId,
                () => NotionAPI.createPageObject({ database_id: databaseId }, properties, contentBlocks, apiKey),
                apiKey,
                {
                    itemName: reportTitle,
                    databaseId,
                    source: "ui",
                    surface: "workspace-visualization",
                }
            );
        }

        const pageId = Utils.extractNotionId(page?.id) || String(page?.id || "").replace(/-/g, "");
        UI().workspaceInsightMarkdown = markdown;
        UI().workspaceInsightUpdatedAt = Date.now();
        UI().setWorkspaceVisualStatus(
            `工作区洞察报告已保存到 Notion（${exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库"}）。`,
            "success"
        );
        UI().showStatus("工作区洞察报告已保存到 Notion。", "success");
        return {
            pageId,
            title: reportTitle,
            targetId: exportState.targetId,
            targetType: exportState.targetType,
            markdown,
        };
    },

    saveWorkspaceConnectionCandidatesToNotion: async () => {
        const model = UI().buildWorkspaceVisualizationModel();
        // P4 收敛(c15): 先捕获 signal —— destroy 会 abort 后置 _abortController = null,
        // 循环内再读 UI()._abortController 会得到 null → 中止检查恒失效(销毁后仍写入)
        const abortSignal = UI()._abortController?.signal;
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }
        if (!Array.isArray(model.connectionCandidates) || model.connectionCandidates.length === 0) {
            throw new Error("当前没有可保存的跨源关联候选。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI().refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const savedAt = Date.now();
        const createdPages = [];
        const failedCandidates = [];
        const aiSettings = getAISettings();
        let database = null;
        let titlePropertyName = null;

        if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.DATABASE) {
            database = await NotionAPI.fetchDatabase(exportState.databaseId, apiKey);
            titlePropertyName = Object.entries(database.properties || {}).find(([_, prop]) => prop?.type === "title")?.[0] || null;
            if (!titlePropertyName) {
                throw new Error("当前目标数据库缺少标题属性，无法保存统一候选。");
            }
            database = await UI().ensureWorkspaceConnectionCandidateDatabaseSchema(exportState.databaseId, apiKey, database);
        }

        for (let index = 0; index < model.connectionCandidates.length; index++) {
            // P4 收敛(c15): 面板销毁(_abortController.abort)后不得继续逐条 AI 调用 + Notion 写入
            if (abortSignal?.aborted) break;
            const candidate = model.connectionCandidates[index];
            const aiDraft = await UI().buildWorkspaceConnectionCandidateAIDraft(candidate, aiSettings);
            const candidateTitle = UI().buildWorkspaceConnectionCandidateTitle(candidate, index, aiDraft);
            const markdown = UI().buildWorkspaceConnectionCandidateMarkdown(candidate, savedAt, aiDraft);
            const contentBlocks = AIAssistant._textToBlocks(markdown);

            try {
                let page = null;
                if (exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
                    const parentPageId = exportState.parentPageId;
                    page = await AIAssistant._executeGuardedPageWrite(
                        "createDatabasePage",
                        { id: parentPageId, name: candidateTitle },
                        () => NotionAPI.createChildPage(parentPageId, candidateTitle, contentBlocks, apiKey),
                        apiKey,
                        {
                            itemName: candidateTitle,
                            pageId: parentPageId,
                            source: "ui",
                            surface: "workspace-visualization",
                        }
                    );
                } else {
                    const properties = UI().buildWorkspaceConnectionCandidateDatabaseProperties(
                        database,
                        titlePropertyName,
                        candidate,
                        candidateTitle,
                        aiDraft
                    );
                    page = await AIAssistant._executeGuardedDatabaseWrite(
                        "createDatabasePage",
                        exportState.databaseId,
                        () => NotionAPI.createPageObject({ database_id: exportState.databaseId }, properties, contentBlocks, apiKey),
                        apiKey,
                        {
                            itemName: candidateTitle,
                            databaseId: exportState.databaseId,
                            source: "ui",
                            surface: "workspace-visualization",
                        }
                    );
                }

                createdPages.push({
                    id: Utils.extractNotionId(page?.id) || String(page?.id || "").replace(/-/g, ""),
                    title: candidateTitle,
                    markdown,
                    candidateKey: candidate?.key || "",
                    aiDraft,
                });
            } catch (error) {
                failedCandidates.push({
                    title: candidateTitle,
                    error: error?.message || String(error),
                });
            }
        }

        if (createdPages.length === 0) {
            throw new Error(failedCandidates[0]?.error || "保存统一候选失败。");
        }

        const targetLabel = exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库";
        const statusMessage = failedCandidates.length > 0
            ? `统一候选已部分保存到 Notion（${targetLabel}）：成功 ${createdPages.length} 条，失败 ${failedCandidates.length} 条。`
            : `统一候选已保存到 Notion（${targetLabel}）：共 ${createdPages.length} 条。`;
        const tone = failedCandidates.length > 0 ? "error" : "success";

        UI().setWorkspaceVisualStatus(statusMessage, tone);
        UI().showStatus(statusMessage, tone);

        return {
            createdCount: createdPages.length,
            failedCount: failedCandidates.length,
            candidateCount: model.connectionCandidates.length,
            targetId: exportState.targetId,
            targetType: exportState.targetType,
            pageIds: createdPages.map((page) => page.id),
            pages: createdPages,
            failures: failedCandidates,
        };
    },

    generateWorkspaceInsight: async () => {
        const model = UI().buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const btn = UI().refs?.viewGenerateWorkspaceInsightBtn;
        if (btn) {
            btn.disabled = true;
            btn.textContent = "生成中...";
        }

        try {
            let aiSummary = "";
            const settings = getAISettings();
            if (settings?.aiApiKey) {
                const prompt = [
                    "你是知识工作区分析师。请基于以下工作区快照输出一段简洁的 Markdown 洞察摘要。",
                    "要求：",
                    "1. 只输出 4-6 条 bullet。",
                    "2. 依次覆盖整体判断、结构缺口、跨源关联机会、下一步动作。",
                    "3. 不要重复原始数字表格，重点做结论与建议。",
                    "",
                    // v3.14.7 (REV-04 UI-08): label 溯源 Notion 页面标题(常来自不可信导入内容),
                    // 裸 JSON.stringify 注入可让页面内容劫持 AI 意图——统一走 isolateContent
                    // 隔离标签(与全仓其余 12+ AI 请求构造点对齐, 五层防御第①层)。
                    `<user_input>\n${AIService.isolateContent(JSON.stringify({
                        totalPages: model.totalPages,
                        totalDatabases: model.totalDatabases,
                        sourceBreakdown: model.sourceBreakdown,
                        categoryBreakdown: model.categoryBreakdown,
                        funnel: model.funnel,
                        duplicateCandidates: model.duplicateCandidates.map((item) => ({
                            label: item.label,
                            count: item.count,
                            sources: item.sources,
                        })),
                        connectionCandidates: model.connectionCandidates.map((item) => ({
                            label: item.label,
                            count: item.count,
                            reason: item.reason,
                        })),
                        missingSourcePages: model.missingSourcePages,
                        missingDatePages: model.missingDatePages,
                        missingCategoryPages: model.missingCategoryPages,
                    }, null, 2))}\n</user_input>`,
                ].join("\n");
                aiSummary = String(await AIService.requestChat(prompt, settings, 900) || "").trim();
            }

            UI().workspaceInsightSummary = aiSummary;
            UI().workspaceInsightMarkdown = UI().buildWorkspaceInsightMarkdown(model, aiSummary);
            UI().workspaceInsightUpdatedAt = Date.now();
            UI().renderWorkspaceVisualSummary();
            UI().setWorkspaceVisualStatus("已生成工作区洞察报告，可直接复制分享。", "success");
            return UI().workspaceInsightMarkdown;
        } catch (error) {
            UI().workspaceInsightSummary = "";
            UI().workspaceInsightMarkdown = UI().buildWorkspaceInsightMarkdown(model, "");
            UI().workspaceInsightUpdatedAt = Date.now();
            UI().renderWorkspaceVisualSummary();
            UI().setWorkspaceVisualStatus(`洞察生成失败，已回退为规则报告：${error.message}`, "error");
            throw error;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "生成洞察";
            }
        }
    },

    renderVisualSummary: () => {
        const container = UI().refs?.viewSummary;
        if (!container) return;

        const subtitle = UI().refs?.viewSubtitle;
        const model = UI().buildVisualizationModel();

        if (subtitle) {
            subtitle.textContent = model.loadedSources.length > 0
                ? `这里继续展示本轮已加载的 ${model.loadedSources.join(" + ")} 列表摘要；工作区总览需要点击上方按钮单独刷新。`
                : "这里继续展示当前已加载的 Linux.do 列表摘要，不会主动读取 Notion 工作区。";
        }

        if (model.total === 0) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">视图还没有数据</div>
                    <div class="ldb-view-empty-text">先加载 Linux.do 收藏，这里会展示来源分布、导出状态和时间线摘要。</div>
                </div>
            `;
            return;
        }

        const renderBarRows = (rows) => rows.length > 0
            ? `<div class="ldb-view-bars">${rows.map((row) => `
                <div class="ldb-view-bar-row">
                    <div class="ldb-view-bar-label">${Utils.escapeHtml(row.label)}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${row.pct > 0 ? Math.max(8, row.pct) : 0}%;"></div></div>
                    <div class="ldb-view-bar-value">${row.count} · ${row.pct}%</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">暂无可展示的数据。</div>`;

        const statusRows = [
            { label: "已导出", count: model.exported, pct: UI().getViewPct(model.exported, model.total) },
            { label: "待导出", count: model.pending, pct: UI().getViewPct(model.pending, model.total) },
            { label: "当前已选", count: model.selected, pct: UI().getViewPct(model.selected, model.total) },
        ];

        const timelineMarkup = model.timeline.length > 0
            ? `<div class="ldb-view-timeline">${model.timeline.map((item) => `
                <div class="ldb-view-timeline-item">
                    <!-- v3.14.7 (REV-25 UI-24): label 裸插值转义——当前数值来源不可注入,
                         一旦生成逻辑携带来源文本即成 XSS 点, 统一 escapeHtml -->
                    <div class="ldb-view-timeline-label">${Utils.escapeHtml(String(item.label || ""))}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${item.count > 0 ? Math.max(8, UI().getViewPct(item.count, model.total)) : 0}%;"></div></div>
                    <div class="ldb-view-timeline-value">${Utils.escapeHtml(String(item.count))} 项 / 已导出 ${Utils.escapeHtml(String(item.exported))}</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">当前数据里没有可解析的时间字段。</div>`;

        const typeHighlights = model.typeBreakdown.slice(0, 4).map((item) => {
            return `<span class="ldb-view-pill">${Utils.escapeHtml(item.label)} ${item.count}</span>`;
        }).join("");

        container.innerHTML = `
            <div class="ldb-view-grid">
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">已加载条目</div>
                    <div class="ldb-view-metric-value">${model.total}</div>
                    <div class="ldb-view-metric-meta">来自 ${Math.max(1, model.loadedSources.length)} 个已加载来源</div>
                </div>
                <div class="ldb-view-card">
                    <div class="ldb-view-card-title">当前选择</div>
                    <div class="ldb-view-metric-value">${model.selected}</div>
                    <div class="ldb-view-metric-meta">用于当前面板的批量导出选择</div>
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">来源分布</div>
                    ${renderBarRows(model.sourceBreakdown)}
                    ${typeHighlights ? `<div class="ldb-view-highlight">${typeHighlights}</div>` : ""}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">导出状态</div>
                    ${renderBarRows(statusRows)}
                </div>
                <div class="ldb-view-card full">
                    <div class="ldb-view-card-title">时间线</div>
                    ${timelineMarkup}
                </div>
            </div>
        `;
    },
};

module.exports = { WorkspaceInsight };
