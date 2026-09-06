"use strict";

// UICommandService —— UI 命令分发协调器。
//
// 历史：原定义在 src/extract/index.js，但 extract 层职责是数据抽取
// （ZhihuAPI/GenericExtractor/WorkspaceService），不该承担 UI 命令分发
// 协调职责，且其 lazy require ../import / ../export / ../ai 造成
// extract → import/export/ai 多向耦合。ISS-20260718-008 将其迁出到
// 独立 coordination 层，extract 只保留数据抽取导出。
//
// 依赖：config/storage/api/auth 基础设施 + extract 的 WorkspaceService
// （refresh_workspace_targets 命令委托给它）。跨层 import/export/ai 保持
// lazy require，与原实现一致，避免加载期耦合。

const { CONFIG, MSG } = require("../config");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { WorkspaceService } = require("../extract");
const {
    POST_AUTH_CANDIDATE_LIMIT,
    normalizeCandidates,
    sortCandidatesForDisplay,
    decideAutoFill,
} = require("../auth/target-discovery");

const UICommandService = Object.freeze({
    LEGACY_DIRECT_NOTION_WRITE_BOUNDARY: Object.freeze({
        allowedSources: Object.freeze([
            "AIAssistant.AGENT_TOOLS.*",
            "AIAssistant.handleTranslateContent / handleEditContent / handleAIAutofill",
            "AIClassifier.*",
            "GenericExporter.setupDatabaseProperties",
            "GitHubExporter.setupDatabaseProperties",
            "BookmarkExporter.setupDatabaseProperties",
        ]),
        note: "M2-P1 收口 UI 事件到 command boundary;遗留 direct NotionAPI 写路径限定在工具执行器与 schema 初始化 helper 内(GenericExporter.setupDatabaseProperties 的 UI 触发路径已加 updateDatabase 非阻塞闸门 + guard.denied 审计;Bookmark/GitHub exporter 已有 canExecute 闸门),不允许继续从 UI 事件直接扩散。",
    }),

    _persistStorageEntries: async (entries = {}) => {
        for (const [key, value] of Object.entries(entries)) {
            if (CredentialVault.isSensitiveKey(key)) {
                await CredentialVault.set(key, value);
            } else {
                Storage.set(key, value);
            }
        }
    },

    _persistProvidedSensitiveEntries: async (entries = {}) => {
        for (const [key, value] of Object.entries(entries)) {
            if (!CredentialVault.isSensitiveKey(key)) continue;
            const normalized = String(value || "").trim();
            if (!normalized) continue;
            await CredentialVault.set(key, normalized);
        }
    },

    _saveNotionSiteSettings: async (payload = {}) => {
        const {
            liveApiKey = "",
            clearManualApiKey = false,
            aiTargetValue = "",
            aiService = CONFIG.DEFAULTS.aiService,
            aiModel = "",
            aiApiKey = "",
            aiBaseUrl = "",
            aiCategories = CONFIG.DEFAULTS.aiCategories,
            workspaceMaxPages = 0,
            personaName = CONFIG.DEFAULTS.agentPersonaName,
            personaTone = CONFIG.DEFAULTS.agentPersonaTone,
            personaExpertise = CONFIG.DEFAULTS.agentPersonaExpertise,
            personaInstructions = "",
            githubUsername = "",
            githubToken = "",
            githubImportTypes = ["stars"],
            auditEnabled = null,
        } = payload;

        if (liveApiKey) {
            await NotionOAuth.setManualApiKey(liveApiKey);
        } else if (clearManualApiKey && NotionOAuth.getAuthMode() !== "oauth") {
            await NotionOAuth.setManualApiKey("");
        }

        TargetState.setAITarget(aiTargetValue);
        await UICommandService._persistStorageEntries({
            [CONFIG.STORAGE_KEYS.AI_SERVICE]: aiService,
            [CONFIG.STORAGE_KEYS.AI_MODEL]: aiModel,
            [CONFIG.STORAGE_KEYS.AI_BASE_URL]: aiBaseUrl,
            [CONFIG.STORAGE_KEYS.AI_CATEGORIES]: aiCategories,
            [CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES]: parseInt(workspaceMaxPages, 10) || 0,
            [CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME]: personaName || CONFIG.DEFAULTS.agentPersonaName,
            [CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE]: personaTone,
            [CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE]: personaExpertise || CONFIG.DEFAULTS.agentPersonaExpertise,
            [CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS]: personaInstructions,
            [CONFIG.STORAGE_KEYS.GITHUB_USERNAME]: githubUsername,
        });
        if (auditEnabled !== null) {
            // F-UI-07:审计开关经命令边界持久化(布尔校验)
            await UICommandService._persistStorageEntries({
                [CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG]: !!auditEnabled,
            });
        }
        await UICommandService._persistProvidedSensitiveEntries({
            [CONFIG.STORAGE_KEYS.AI_API_KEY]: aiApiKey,
            [CONFIG.STORAGE_KEYS.GITHUB_TOKEN]: githubToken,
        });
        (require("../import").GitHubAPI).setImportTypes(Array.isArray(githubImportTypes) && githubImportTypes.length > 0 ? githubImportTypes : ["stars"]);

        return {
            aiTargetState: TargetState.getDisplayAITargetState(),
            aiService,
            aiModel,
        };
    },

    _saveMainExportSessionSettings: async (payload = {}) => {
        const {
            liveApiKey = "",
            exportState = {},
            storageValues = {},
            sensitiveEntries = {},
        } = payload;

        if (liveApiKey) {
            await NotionOAuth.setManualApiKey(liveApiKey);
        }
        TargetState.saveExportState(exportState);
        await UICommandService._persistStorageEntries(storageValues);
        await UICommandService._persistProvidedSensitiveEntries(sensitiveEntries);
        return {
            exportState: TargetState.getExportState(),
        };
    },

    _saveGenericExportTargetSettings: async (payload = {}) => {
        const {
            liveApiKey = "",
            exportType,
            targetId = "",
            imgMode,
            autoSetupDatabaseProperties = false,
            apiKey = "",
        } = payload;

        if (liveApiKey) {
            await NotionOAuth.setManualApiKey(liveApiKey);
        }

        TargetState.setExportTargetType(exportType);
        Storage.set(CONFIG.STORAGE_KEYS.IMG_MODE, imgMode);

        if (exportType === CONFIG.EXPORT_TARGET_TYPES.PAGE) {
            TargetState.setExportPageId(targetId);
            return { exportState: TargetState.getExportState(), setupResult: null };
        }

        TargetState.setExportDatabaseId(targetId);
        let setupResult = null;
        if (autoSetupDatabaseProperties) {
            // GenericExporter.setupDatabaseProperties 内部 PATCH /databases 是 updateDatabase
            // 写操作。保存链路不因权限拒绝中断(设置仍保存,失败经 setupResult 可见),
            // 采用 canExecute 非阻塞闸门 + guard.denied 审计(与自动同步归档模式对称)。
            const { OperationGuard, OperationLog } = require("../security");
            if (!OperationGuard.canExecute("updateDatabase")) {
                // v3.14.6 (XN-06): 统一构造器(phase=precheck, status=denied)
                OperationGuard.auditDenied("updateDatabase", {
                    trigger: "user_requested_setup_database",
                    databaseId: targetId,
                    actor: "user",
                    source: "ui",
                }, { phase: "precheck", reason: "权限不足:当前权限级别无法修改 Notion 数据库结构" });
                setupResult = {
                    success: false,
                    error: "权限不足:需要\"标准\"及以上权限才能自动设置数据库属性(已跳过自动建属性,目标已保存)",
                };
            } else {
                setupResult = await (require("../export").GenericExporter).setupDatabaseProperties(targetId, apiKey);
            }
        }
        return { exportState: TargetState.getExportState(), setupResult };
    },

    _applyWorkspaceSelection: (payload = {}) => {
        const selectedValue = String(payload.selectedValue || "").trim();
        if (!selectedValue) {
            return { selectedType: "", selectedId: "", exportState: TargetState.getExportState() };
        }

        const [selectedType, selectedId] = selectedValue.split(":");
        if (selectedType === "database") {
            TargetState.saveExportState({
                targetType: CONFIG.EXPORT_TARGET_TYPES.DATABASE,
                databaseId: selectedId,
                parentPageId: "",
            });
        } else if (selectedType === "page") {
            TargetState.saveExportState({
                targetType: CONFIG.EXPORT_TARGET_TYPES.PAGE,
                parentPageId: selectedId,
            });
        }

        return {
            selectedType,
            selectedId,
            exportState: TargetState.getExportState(),
        };
    },

    // 授权后目标发现(三模型共识):只读 search 发现可访问数据库 → 决策矩阵 → 自动填充/引导
    // 仅 source="oauth_callback" 触发完整发现;静默续签(source="refresh")不触发目标重选
    _discoverExportTargetAfterAuth: async (payload = {}) => {
        const { accessToken = "", source = "" } = payload;
        if (!accessToken) return { action: "skip", reason: "no_token" };
        if (source !== "oauth_callback") return { action: "skip", reason: "not_callback" };

        // 只读闸门:search=level 0,默认 level 1 必通过;仅作审计留痕与未来收紧的锚
        const { OperationGuard } = require("../security");
        if (!OperationGuard.canExecute("search")) {
            return { action: "failed", reason: "guard_denied" };
        }

        try {
            // includePages:false → 只拉 database,秒级返回;maxPages:1 → 首屏 100 条足够决策
            const { databases } = await WorkspaceService.fetchWorkspaceStaged(accessToken, {
                includePages: false,
                maxPages: 1,
            });

            const candidates = normalizeCandidates({ results: databases });
            const decision = decideAutoFill({
                candidates,
                currentState: TargetState.getExportState(),
                source,
            });

            if (decision.action === "autofill" && decision.databaseId) {
                TargetState.saveExportState({
                    targetType: CONFIG.EXPORT_TARGET_TYPES.DATABASE,
                    databaseId: decision.databaseId,
                    parentPageId: "",
                });
            }

            // 跨页结果落存储(回调页无 UI):TTL 10min 与 pending 对齐,候选有界
            Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_POST_AUTH_TARGET, JSON.stringify({
                ...decision,
                candidates: sortCandidatesForDisplay(candidates).slice(0, POST_AUTH_CANDIDATE_LIMIT),
                truncated: candidates.length > POST_AUTH_CANDIDATE_LIMIT,
                timestamp: Date.now(),
            }));
            return decision;
        } catch (error) {
            // 失败降级:不丢用户已有配置,保留手动路径
            return { action: "failed", reason: "discovery_error", message: String(error?.message || error) };
        }
    },

    _setExportTargetState: (payload = {}) => {
        const {
            targetType,
            databaseId,
            parentPageId,
        } = payload;
        TargetState.saveExportState({
            targetType,
            databaseId,
            parentPageId,
        });
        return { exportState: TargetState.getExportState() };
    },

    _validateExportTarget: async (payload = {}) => {
        const {
            apiKey = "",
            liveApiKey = "",
            exportTargetType = CONFIG.EXPORT_TARGET_TYPES.DATABASE,
            databaseId = "",
            parentPageId = "",
        } = payload;

        const result = exportTargetType === CONFIG.EXPORT_TARGET_TYPES.DATABASE
            ? await NotionAPI.validateConfig(apiKey, databaseId)
            : await NotionAPI.validatePage(parentPageId, apiKey);

        if (result.valid) {
            if (liveApiKey) {
                await NotionOAuth.setManualApiKey(liveApiKey);
            }
            TargetState.saveExportState({
                targetType: exportTargetType,
                databaseId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.DATABASE ? databaseId : undefined,
                parentPageId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? parentPageId : undefined,
            });
        }

        return result;
    },

    _setupExportDatabaseProperties: async (payload = {}) => {
        const {
            apiKey = "",
            liveApiKey = "",
            databaseId = "",
        } = payload;

        // Guard 收束(遗留缺口修复):NotionAPI.setupDatabaseProperties 内部 PATCH /databases
        // 是 updateDatabase 写操作,用户触发路径必须经 OperationGuard.execute 闸门——
        // 权限不足自动记 guard.denied + 抛错(UI catch 显示明确指引),成功/失败审计对称;
        // updateDatabase 非危险操作,不会触发 ConfirmationDialog。
        const { OperationGuard } = require("../security");
        const result = await OperationGuard.execute(
            "updateDatabase",
            async () => {
                const setupResult = await NotionAPI.setupDatabaseProperties(databaseId, apiKey);
                if (setupResult.success) {
                    if (liveApiKey) {
                        await NotionOAuth.setManualApiKey(liveApiKey);
                    }
                    TargetState.setExportDatabaseId(databaseId);
                }
                return setupResult;
            },
            {
                source: "ui",
                trigger: "user_requested_setup_database",
                databaseId,
            }
        );
        return result;
    },

    execute: async (command, payload = {}) => {
        switch (command) {
            case "select_ai_target":
                return TargetState.setAITarget(payload.targetValue || "");
            case "refresh_workspace_targets": {
                const apiKey = String(payload.apiKey || "").trim();
                if (!apiKey) throw new Error(payload.missingApiKeyMessage || MSG.NO_NOTION_KEY);
                return await WorkspaceService.refreshWorkspaceSnapshot(apiKey, {
                    includePages: payload.includePages !== false,
                    maxPages: payload.maxPages,
                    onProgress: payload.onProgress,
                    onWorkspaceData: payload.onWorkspaceData,
                    onPhaseComplete: payload.onPhaseComplete,
                });
            }
            case "fetch_ai_models": {
                const aiApiKey = String(payload.aiApiKey || "").trim();
                if (!aiApiKey) throw new Error(payload.missingApiKeyMessage || MSG.NO_AI_KEY);
                return await (require("../ai").AIService).fetchModelsSnapshot(payload.aiService, aiApiKey, payload.aiBaseUrl || "");
            }
            case "save_command_boundary_settings":
                switch (payload.scope) {
                    case "notion-site":
                        return UICommandService._saveNotionSiteSettings(payload);
                    case "main-export-session":
                        return UICommandService._saveMainExportSessionSettings(payload);
                    case "generic-export-target":
                        return await UICommandService._saveGenericExportTargetSettings(payload);
                    default:
                        throw new Error(`未知的 settings scope: ${payload.scope || ""}`);
                }
            case "apply_workspace_selection":
                return UICommandService._applyWorkspaceSelection(payload);
            case "discover_export_target_after_auth":
                return await UICommandService._discoverExportTargetAfterAuth(payload);
            case "set_export_target_state":
                return UICommandService._setExportTargetState(payload);
            case "validate_export_target":
                return await UICommandService._validateExportTarget(payload);
            case "setup_export_database_properties":
                return await UICommandService._setupExportDatabaseProperties(payload);
            default:
                throw new Error(`未知的 command: ${command}`);
        }
    },
});

module.exports = { UICommandService };
