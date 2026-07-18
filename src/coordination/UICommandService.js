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
        note: "M2-P1 只收口 UI 事件到 command boundary；遗留 direct NotionAPI 写路径暂限定在工具执行器和导出 schema 初始化 helper 内，不允许继续从 UI 事件直接扩散。",
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
            // M2-P1 明确保留的 legacy direct NotionAPI 写路径：导出目标 schema 初始化仍复用现有 helper。
            setupResult = await (require("../export").GenericExporter).setupDatabaseProperties(targetId, apiKey);
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
        const result = await NotionAPI.setupDatabaseProperties(databaseId, apiKey);
        if (result.success) {
            if (liveApiKey) {
                await NotionOAuth.setManualApiKey(liveApiKey);
            }
            TargetState.setExportDatabaseId(databaseId);
        }
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
