"use strict";

// 依赖引入
const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { NotionAPI, DOMToNotion, SiteDetector, InstallHelper, HTMLToMarkdown, ObsidianAPI, EMOJI_MAP } = require("../api");
const { OperationGuard, UndoManager, OperationLog, ConfirmationDialog } = require("../security");
const { ZhihuAPI, GenericExtractor, WorkspaceService } = require("../extract");
const { Exporter, LinuxDoAPI, GenericExporter } = require("../export");
const { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter } = require("../import");
const { BookmarkBridge, BookmarkAutoImporter } = require("../bridge");
const { AIAssistant, AIService, AIWelcomeUI, ChatUI, getAISettings } = require("../ai");
const { StyleManager } = require("./style-manager");
const { DesignSystem } = require("./design-system");
const { PanelResize } = require("./panel-resize");
const { UI_CSS } = require("./styles");
const { UIEvents } = require("./events");
// M3 milestone 拆分: createPanel 的 ~815 LOC innerHTML 模板字面量提取至 panel-template.js,
// 本文件仅保留 DOM 装配 + 事件/ChatUI/配置接线(转发壳, 行为不变)。
const { renderPanel } = require("./panel-template");

const UI = {
    panel: null,
    miniBtn: null,
    isMinimized: false,
    bookmarks: [],
    visualSnapshots: { linuxdo: [], github: [] },
    workspaceVisualSnapshot: { databases: [], pages: [], records: [], scannedAt: 0, maxPages: 0 },
    workspaceInsightMarkdown: "",
    workspaceInsightSummary: "",
    workspaceInsightUpdatedAt: 0,
    renderJobId: 0,
    selectedBookmarks: new Set(),
    selectedUnexportedCount: 0,
    totalUnexportedCount: 0,
    bookmarkListBound: false,
    refs: null,

    // 缓存高频节点引用
    cacheRefs: () => {
        const panel = UI.panel;
        if (!panel) {
            UI.refs = null;
            return;
        }

        UI.refs = {
            statusContainer: panel.querySelector("#ldb-status-container"),
            bookmarkList: panel.querySelector("#ldb-bookmark-list"),
            selectCount: panel.querySelector("#ldb-select-count"),
            selectAll: panel.querySelector("#ldb-select-all"),
            bookmarkCount: panel.querySelector("#ldb-bookmark-count"),
            bookmarksLabel: panel.querySelector("#ldb-bookmarks-label"),
            autoImportLabel: panel.querySelector("#ldb-auto-import-label"),
            autoImportIntervalLabel: panel.querySelector("#ldb-auto-import-interval-label"),
            exportBtn: panel.querySelector("#ldb-export"),
            obsExportBtn: panel.querySelector("#ldb-obs-export"),
            // v3.16.0: 当前页 → 本地文件 / 发布到 linux.do
            pageFileBtn: panel.querySelector("#ldb-page-save-file"),
            pageFileFormatSelect: panel.querySelector("#ldb-page-file-format"),
            pagePublishBtn: panel.querySelector("#ldb-page-publish"),
            pagePublishModeSelect: panel.querySelector("#ldb-page-publish-mode"),
            pagePublishTitleInput: panel.querySelector("#ldb-page-publish-title"),
            pagePublishTopicInput: panel.querySelector("#ldb-page-publish-topic"),
            pagePublishCategoryInput: panel.querySelector("#ldb-page-publish-category"),
            bookmarkListContainer: panel.querySelector("#ldb-bookmark-list-container"),
            bookmarkEmptyState: panel.querySelector("#ldb-bookmark-empty-state"),
            bookmarkEmptyLoad: panel.querySelector("#ldb-bookmark-empty-load"),
            reportContainer: panel.querySelector("#ldb-report-container"),
            viewSummary: panel.querySelector("#ldb-view-summary"),
            viewSubtitle: panel.querySelector("#ldb-view-subtitle"),
            viewWorkspaceSummary: panel.querySelector("#ldb-view-workspace-summary"),
            viewWorkspaceStatus: panel.querySelector("#ldb-view-workspace-status"),
            viewRefreshWorkspaceBtn: panel.querySelector("#ldb-view-refresh-workspace"),
            viewCopyWorkspaceReportBtn: panel.querySelector("#ldb-view-copy-workspace-report"),
            viewDownloadWorkspaceReportBtn: panel.querySelector("#ldb-view-download-workspace-report"),
            viewDownloadWorkspacePackageBtn: panel.querySelector("#ldb-view-download-workspace-package"),
            viewSaveWorkspacePackageBtn: panel.querySelector("#ldb-view-save-workspace-package"),
            viewSaveWorkspaceReportBtn: panel.querySelector("#ldb-view-save-workspace-report"),
            viewSaveWorkspaceCandidatesBtn: panel.querySelector("#ldb-view-save-workspace-candidates"),
            viewGenerateWorkspaceInsightBtn: panel.querySelector("#ldb-view-generate-insight"),
            viewSyncSummary: panel.querySelector("#ldb-view-sync-summary"),
            viewSyncNowBtn: panel.querySelector("#ldb-view-sync-now"),
            autoImportStatus: panel.querySelector("#ldb-auto-import-status"),
            importNowLinuxdoBtn: panel.querySelector("#ldb-import-now-linuxdo"),
            importNowGithubBtn: panel.querySelector("#ldb-import-now-github"),
            importNowBookmarkBtn: panel.querySelector("#ldb-import-now-bookmark"),
            bookmarkAutoImportEnabled: panel.querySelector("#ldb-bookmark-auto-import-enabled"),
            bookmarkAutoImportOptions: panel.querySelector("#ldb-bookmark-auto-import-options"),
            bookmarkAutoImportInterval: panel.querySelector("#ldb-bookmark-auto-import-interval"),
            sourcePartitionsToggle: panel.querySelector("#ldb-source-partitions-toggle"),
            sourcePartitionsContent: panel.querySelector("#ldb-source-partitions-content"),
            sourcePartitionsArrow: panel.querySelector("#ldb-source-partitions-arrow"),
            sourceSelectLinuxdo: panel.querySelector("#ldb-source-select-linuxdo"),
            sourceSelectGithub: panel.querySelector("#ldb-source-select-github"),
            updateCheckBtn: panel.querySelector("#ldb-update-check-btn"),
            updateAutoEnabled: panel.querySelector("#ldb-update-auto-enabled"),
            updateAutoOptions: panel.querySelector("#ldb-update-auto-options"),
            updateIntervalHours: panel.querySelector("#ldb-update-interval-hours"),
            minimizeBtn: panel.querySelector("#ldb-minimize"),
            closeBtn: panel.querySelector("#ldb-close"),
            themeToggleBtn: panel.querySelector("#ldb-theme-toggle"),
            runtimeBadge: panel.querySelector("#ldb-runtime-badge"),
            tabs: panel.querySelectorAll(".ldb-tab"),
            tabContents: panel.querySelectorAll(".ldb-tab-content"),
            filterToggle: panel.querySelector("#ldb-filter-toggle"),
            filterContent: panel.querySelector("#ldb-filter-content"),
            filterArrow: panel.querySelector("#ldb-filter-arrow"),
            aiSettingsToggle: panel.querySelector("#ldb-ai-settings-toggle"),
            aiSettingsContent: panel.querySelector("#ldb-ai-settings-content"),
            aiSettingsArrow: panel.querySelector("#ldb-ai-settings-arrow"),
            githubSettingsToggle: panel.querySelector("#ldb-github-settings-toggle"),
            githubSettingsContent: panel.querySelector("#ldb-github-settings-content"),
            githubSettingsArrow: panel.querySelector("#ldb-github-settings-arrow"),
            openGithubSettingsBtn: panel.querySelector("#ldb-open-github-settings"),
            sourceSettingsToggle: panel.querySelector("#ldb-source-settings-toggle"),
            sourceSettingsContent: panel.querySelector("#ldb-source-settings-content"),
            sourceSettingsArrow: panel.querySelector("#ldb-source-settings-arrow"),
            apiKeyInput: panel.querySelector("#ldb-api-key"),
            databaseIdInput: panel.querySelector("#ldb-database-id"),
            parentPageIdInput: panel.querySelector("#ldb-parent-page-id"),
            exportTargetPageRadio: panel.querySelector("#ldb-export-target-page"),
            exportTargetDatabaseRadio: panel.querySelector("#ldb-export-target-database"),
            parentPageGroup: panel.querySelector("#ldb-parent-page-group"),
            manualDbWrap: panel.querySelector("#ldb-manual-db-wrap"),
            exportTargetTip: panel.querySelector("#ldb-export-target-tip"),
            configStatus: panel.querySelector("#ldb-config-status"),
            loadBookmarksBtn: panel.querySelector("#ldb-load-bookmarks"),
            importBrowserBookmarksBtn: panel.querySelector("#ldb-import-browser-bookmarks"),
            organizeBookmarksBtn: panel.querySelector("#ldb-organize-bookmarks"),
            undoOrganizeBtn: panel.querySelector("#ldb-undo-organize"),
            exportBtns: panel.querySelector("#ldb-export-btns"),
            exportTargetSummary: panel.querySelector("#ldb-export-target-summary"),
            controlBtns: panel.querySelector("#ldb-control-btns"),
            pauseBtn: panel.querySelector("#ldb-pause"),
            classifyPauseBtn: panel.querySelector("#ldb-classify-pause"),
            classifyCancelBtn: panel.querySelector("#ldb-classify-cancel"),
            autoImportEnabled: panel.querySelector("#ldb-auto-import-enabled"),
            autoImportOptions: panel.querySelector("#ldb-auto-import-options"),
            autoImportInterval: panel.querySelector("#ldb-auto-import-interval"),
            linuxdoDedupModeSelect: panel.querySelector("#ldb-linuxdo-dedup-mode"),
            exportStatusSourceSelect: panel.querySelector("#ldb-export-status-source"),
            exportStatusTip: panel.querySelector("#ldb-export-status-tip"),
            recomputeExportStatusBtn: panel.querySelector("#ldb-recompute-export-status"),
            exportStatusDiffTip: panel.querySelector("#ldb-export-status-diff-tip"),
            alignLedgerToSnapshotBtn: panel.querySelector("#ldb-align-ledger-to-snapshot"),
            bookmarkDedupModeSelect: panel.querySelector("#ldb-bookmark-dedup-mode"),
            aiCategoryAutoDedupCheckbox: panel.querySelector("#ldb-ai-category-auto-dedup"),
            crossSourceModeSelect: panel.querySelector("#ldb-cross-source-mode"),
            aiServiceSelect: panel.querySelector("#ldb-ai-service"),
            aiModelSelect: panel.querySelector("#ldb-ai-model"),
            aiApiKeyInput: panel.querySelector("#ldb-ai-api-key"),
            aiBaseUrlInput: panel.querySelector("#ldb-ai-base-url"),
            aiCategoriesInput: panel.querySelector("#ldb-ai-categories"),
            workspaceMaxPagesSelect: panel.querySelector("#ldb-workspace-max-pages"),
            aiTargetDbSelect: panel.querySelector("#ldb-ai-target-db"),
            permissionLevelSelect: panel.querySelector("#ldb-permission-level"),
            requireConfirmCheckbox: panel.querySelector("#ldb-require-confirm"),
            enableAuditLogCheckbox: panel.querySelector("#ldb-enable-audit-log"),
            logPanel: panel.querySelector("#ldb-log-panel"),
            workspaceSelect: panel.querySelector("#ldb-workspace-select"),
            bookmarkExtStatus: panel.querySelector("#ldb-bookmark-ext-status"),
            selfCheckBtn: panel.querySelector("#ldb-self-check-btn"),
            copyDiagBtn: panel.querySelector("#ldb-copy-diagnostics-btn"),
            selfCheckResult: panel.querySelector("#ldb-self-check-result"),
            viewAiTracesBtn: panel.querySelector("#ldb-view-ai-traces"),
            clearAiTracesBtn: panel.querySelector("#ldb-clear-ai-traces"),
            aiTracesResult: panel.querySelector("#ldb-ai-traces-result"),
            resetPanelSizeBtn: panel.querySelector("#ldb-reset-panel-size"),
            onlyFirstCheckbox: panel.querySelector("#ldb-only-first"),
            onlyOpCheckbox: panel.querySelector("#ldb-only-op"),
            rangeStartInput: panel.querySelector("#ldb-range-start"),
            rangeEndInput: panel.querySelector("#ldb-range-end"),
            imgModeSelect: panel.querySelector("#ldb-img-mode"),
            requestDelaySelect: panel.querySelector("#ldb-request-delay"),
            exportConcurrencySelect: panel.querySelector("#ldb-export-concurrency"),
            filterImgSelect: panel.querySelector("#ldb-filter-img"),
            filterUsersInput: panel.querySelector("#ldb-filter-users"),
            filterIncludeInput: panel.querySelector("#ldb-filter-include"),
            filterExcludeInput: panel.querySelector("#ldb-filter-exclude"),
            filterMinLenInput: panel.querySelector("#ldb-filter-minlen"),
            validateConfigBtn: panel.querySelector("#ldb-validate-config"),
            setupDatabaseBtn: panel.querySelector("#ldb-setup-database"),
            cancelBtn: panel.querySelector("#ldb-cancel"),
            agentPersonaNameInput: panel.querySelector("#ldb-agent-persona-name"),
            agentPersonaToneSelect: panel.querySelector("#ldb-agent-persona-tone"),
            agentPersonaExpertiseInput: panel.querySelector("#ldb-agent-persona-expertise"),
            agentPersonaInstructionsInput: panel.querySelector("#ldb-agent-persona-instructions"),
            agentMaxIterationsSelect: panel.querySelector("#ldb-agent-max-iterations"),
            githubUsernameInput: panel.querySelector("#ldb-github-username"),
            githubTokenInput: panel.querySelector("#ldb-github-token"),
            githubOAuthBtn: panel.querySelector("#ldb-github-oauth-btn"),
            githubOAuthStatus: panel.querySelector("#ldb-github-oauth-status"),
            githubOauthClientIdInput: panel.querySelector("#ldb-github-oauth-client-id"),
            githubTypeCheckboxes: panel.querySelectorAll(".ldb-github-type"),
            obsSettingsToggle: panel.querySelector("#ldb-obs-settings-toggle"),
            obsSettingsContent: panel.querySelector("#ldb-obs-settings-content"),
            obsSettingsArrow: panel.querySelector("#ldb-obs-settings-arrow"),
            obsApiUrlInput: panel.querySelector("#ldb-obs-api-url"),
            obsApiKeyInput: panel.querySelector("#ldb-obs-api-key"),
            obsDirInput: panel.querySelector("#ldb-obs-dir"),
            obsImgModeSelect: panel.querySelector("#ldb-obs-img-mode"),
            obsImgDirInput: panel.querySelector("#ldb-obs-img-dir"),
            obsTestBtn: panel.querySelector("#ldb-obs-test-btn"),
            obsTestStatus: panel.querySelector("#ldb-obs-test-status"),
            toggleManualDbBtn: panel.querySelector("#ldb-toggle-manual-db"),
            refreshWorkspaceBtn: panel.querySelector("#ldb-refresh-workspace"),
            workspaceTip: panel.querySelector("#ldb-workspace-tip"),
            logToggleBtn: panel.querySelector("#ldb-log-toggle"),
            logContent: panel.querySelector("#ldb-log-content"),
            logArrow: panel.querySelector("#ldb-log-arrow"),
            logClearBtn: panel.querySelector("#ldb-log-clear"),
            dedupSummary: panel.querySelector("#ldb-dedup-summary"),
            clearLinuxdoDedupBtn: panel.querySelector("#ldb-clear-linuxdo-dedup"),
            clearGithubExportedBtn: panel.querySelector("#ldb-clear-github-exported"),
            clearBookmarkExportedBtn: panel.querySelector("#ldb-clear-bookmark-exported"),
            aiRefreshDbsBtn: panel.querySelector("#ldb-ai-refresh-dbs"),
            aiFetchModelsBtn: panel.querySelector("#ldb-ai-fetch-models"),
            aiModelTip: panel.querySelector("#ldb-ai-model-tip"),
            aiTestBtn: panel.querySelector("#ldb-ai-test"),
            aiTestStatus: panel.querySelector("#ldb-ai-test-status"),
            templateList: panel.querySelector("#ldb-template-list"),
            templateNameInput: panel.querySelector("#ldb-template-name"),
            templateIconInput: panel.querySelector("#ldb-template-icon"),
            templatePromptInput: panel.querySelector("#ldb-template-prompt"),
            templateAddBtn: panel.querySelector("#ldb-template-add"),
        };
    },

    // 样式
    injectStyles: () => {
        DesignSystem.ensureBase();
        DesignSystem.ensureChat();
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.LINUX_DO, UI_CSS);
    },

    // 创建面板
    createPanel: () => {
        const panel = document.createElement("div");
        const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        panel.className = "ldb-panel";
        panel.setAttribute("data-ldb-root", "");
        panel.innerHTML = renderPanel(personaName);

        document.body.appendChild(panel);
        UI.panel = panel;
        // P4 收敛(c15): destroy 时中止在途的长任务(如逐条保存统一候选), 与 NotionSiteUI 同构
        UI._abortController = new AbortController();
        UI.cacheRefs();
        // v3.14.7 (REV-05 UI-09): 动态创建后重应用主题偏好(仅 data-ldb-root 不带 data-ldb-theme 时
        // 主题被忽略; 与 notion-site/generic 面板同根因同修复)
        DesignSystem.applyTheme();

        // 绑定事件
        UI.bindEvents();

        // bug1 修复(2978b01 拆分回归): god-module 拆分时丢失 ChatUI 初始化接线 —
        // 主面板 AI Tab 的 发送/回车/清空/暂停分类/取消分类/welcome chip 按钮自此无监听器
        // (唯一绑定体 ai/index.js ChatUI.bindEvents 仅被 Notion 站面板调用)。
        // ChatUI.init = ChatState.load + renderMessages + bindEvents, 全 null 守卫。
        ChatUI.init();

        // 加载保存的配置
        UI.loadConfig();
    },

    // 创建最小化按钮
    createMiniButton: () => {
        const btn = document.createElement("button");
        btn.className = "ldb-mini-btn";
        btn.setAttribute("data-ldb-root", "");
        btn.innerHTML = "📚";
        btn.title = "打开收藏导出工具";
        // v3.14.7 (REV-28 UI-20): mini 按钮补 aria-label(对照 notion-site/generic 同族浮钮均有)
        btn.setAttribute("aria-label", "打开收藏导出工具");
        btn.style.display = "none";

        btn.onclick = () => {
            // 修复:主面板 .ldb-panel 为 display:flex 布局,用 block 会破坏 flex 流
            // 导致 .ldb-body 滚动失效、超过 90vh 的底部内容不可达。
            UI.panel.style.display = "flex";
            btn.style.display = "none";
            Storage.set(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, false);
        };

        document.body.appendChild(btn);
        return btn;
    },


    // 绑定事件
    bindEvents: UIEvents.bindEvents,

    // 加载配置
    loadConfig: () => {
        const panel = UI.panel;
        const refs = UI.refs || {};
        const exportState = TargetState.getExportState();

        refs.apiKeyInput.value = "";
        refs.databaseIdInput.value = exportState.databaseId;
        refs.parentPageIdInput.value = exportState.parentPageId;
        refs.onlyFirstCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, CONFIG.DEFAULTS.onlyFirst);
        refs.onlyOpCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, CONFIG.DEFAULTS.onlyOp);
        refs.rangeStartInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_START, CONFIG.DEFAULTS.rangeStart);
        refs.rangeEndInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_RANGE_END, CONFIG.DEFAULTS.rangeEnd);
        refs.imgModeSelect.value = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
        refs.requestDelaySelect.value = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);
        refs.exportConcurrencySelect.value = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY, CONFIG.DEFAULTS.exportConcurrency);
        refs.filterImgSelect.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_IMG, CONFIG.DEFAULTS.imgFilter);
        refs.filterUsersInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_USERS, CONFIG.DEFAULTS.filterUsers);
        refs.filterIncludeInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_INCLUDE, CONFIG.DEFAULTS.filterInclude);
        refs.filterExcludeInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_EXCLUDE, CONFIG.DEFAULTS.filterExclude);
        refs.filterMinLenInput.value = Storage.get(CONFIG.STORAGE_KEYS.FILTER_MINLEN, CONFIG.DEFAULTS.filterMinLen);

        // 加载导出目标类型设置
        const exportTargetType = exportState.targetType;
        if (exportTargetType === "page") {
            refs.exportTargetPageRadio.checked = true;
            refs.parentPageGroup.style.display = "block";
            refs.manualDbWrap.style.display = "none";
            refs.exportTargetTip.textContent = "导出为子页面，包含完整内容";
        } else {
            refs.exportTargetDatabaseRadio.checked = true;
            refs.parentPageGroup.style.display = "none";
            refs.exportTargetTip.textContent = "导出为数据库条目，支持筛选和排序";
            // v3.14.7 (REV-17 UI-15): 恢复手动 DB 输入框可见性——此前 database 分支恒隐藏
            // manualDbWrap, 与保存时的显示态脱节(用户手动输入的 databaseId 恢复后输入框
            // 却不可见, 需再点「高级」按钮才看到值)。
            const hasManualDb = !!String(refs.databaseIdInput.value || "").trim();
            refs.manualDbWrap.style.display = hasManualDb ? "block" : "none";
        }

        // 加载权限设置
        refs.permissionLevelSelect.value = Storage.get(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, CONFIG.DEFAULTS.permissionLevel);
        refs.requireConfirmCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, CONFIG.DEFAULTS.requireConfirm);
        refs.enableAuditLogCheckbox.checked = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);

        // 根据审计日志设置更新面板可见性
        const enableAuditLog = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
        const logPanel = refs.logPanel
        if (logPanel) {
            logPanel.style.display = enableAuditLog ? "block" : "none";
        }

        // 加载 AI 分类设置
        const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
        refs.aiServiceSelect.value = aiService;

        // 验证并加载 AI 模型（优先使用缓存的模型列表）
        const savedModel = Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
        const modelSelect = refs.aiModelSelect
        const provider = AIService.PROVIDERS[aiService];

        const validModels = AIService.getAvailableModels(aiService);
        UI.updateAIModelOptions(aiService, validModels.length > 0 ? validModels : undefined);

        if (savedModel) {
            // 检查保存的模型是否在下拉框选项中存在
            const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
            if (optionExists || validModels.includes(savedModel)) {
                // 存储的模型可用，直接设置
                modelSelect.value = savedModel;
            } else {
                // 存储的模型不兼容当前服务，重置为默认模型
                const defaultModel = provider?.defaultModel || "";
                modelSelect.value = defaultModel;
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, defaultModel);
                console.warn(`[LD-Notion] AI 模型 "${savedModel}" 与当前服务 "${aiService}" 不兼容，已重置为默认模型`);
            }
        }

        refs.aiApiKeyInput.value = "";
        refs.aiBaseUrlInput.value = Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, CONFIG.DEFAULTS.aiBaseUrl);
        refs.aiCategoriesInput.value = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories);
        refs.workspaceMaxPagesSelect.value = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages);

        // 加载 Agent 个性化设置
        refs.agentPersonaNameInput.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        refs.agentPersonaToneSelect.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone);
        refs.agentPersonaExpertiseInput.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise);
        refs.agentPersonaInstructionsInput.value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions);
        refs.agentMaxIterationsSelect.value = String(Storage.get(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS, CONFIG.DEFAULTS.agentMaxIterations));

        // 加载 GitHub 设置
        refs.githubUsernameInput.value = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
        refs.githubTokenInput.value = "";
        // 加载 GitHub 导入类型
        const savedGHTypesMain = GitHubAPI.getImportTypes();
        refs.githubTypeCheckboxes.forEach(cb => {
            cb.checked = savedGHTypesMain.includes(cb.value);
        });

        // 加载 Obsidian 设置
        refs.obsApiUrlInput.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_API_URL, CONFIG.DEFAULTS.obsApiUrl);
        refs.obsApiKeyInput.value = "";
        refs.obsDirInput.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_DIR, CONFIG.DEFAULTS.obsDir);
        refs.obsImgModeSelect.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_IMG_MODE, CONFIG.DEFAULTS.obsImgMode);
        refs.obsImgDirInput.value = Storage.get(CONFIG.STORAGE_KEYS.OBS_IMG_DIR, CONFIG.DEFAULTS.obsImgDir);

        const source = UI.getActiveBookmarkSource();
        UI.applyBookmarkSourceUI(source);

        // 书签扩展状态
        const bmStatusMain = refs.bookmarkExtStatus
        if (bmStatusMain) {
            if (BookmarkBridge.isExtensionAvailable()) {
                const isUserscriptMode = Utils.isUserscriptMode();
                if (isUserscriptMode) {
                    bmStatusMain.innerHTML = '<span class="ldb-status-text ldb-status-text--success">✅ 桥接已就绪（Userscript 模式）</span> — 可用「📖 导入浏览器书签」按钮';
                } else {
                    bmStatusMain.innerHTML = '<span class="ldb-status-text ldb-status-text--success">✅ 书签能力已就绪（Extension 模式）</span> — 可用「📖 导入浏览器书签」按钮';
                }
            } else {
                bmStatusMain.innerHTML = `<span class="ldb-status-text ldb-status-text--danger">❌ 扩展未安装</span> — ${InstallHelper.renderInstallLink("一键安装浏览器扩展")}`;
            }
        }
        UI.renderSelfCheckResult();

        // 加载工作区缓存（单次解析，复用于 AI 目标库 + 工作区选择）（PERF-007）
        let workspaceData = null;
        try {
            workspaceData = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}"));
        } catch { /* workspace cache invalid */ }

        // 加载 AI 查询目标数据库设置
        UI.updateAITargetDbOptions(workspaceData?.databases || []);

        // 初始化日志面板
        UI.updateLogPanel();

        // 加载缓存的工作区页面列表（校验 API Key）
        if (workspaceData) {
            const currentApiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
            const currentKeyHash = currentApiKey ? Utils.apiKeyHash(currentApiKey) : "";
            // 仅当 API Key 匹配时才显示缓存
            if (workspaceData.apiKeyHash === currentKeyHash &&
                (workspaceData.databases?.length > 0 || workspaceData.pages?.length > 0)) {
                UI.updateWorkspaceSelect(workspaceData);
            }
        }

        // 加载自动导入设置
        const savedSource = Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, CONFIG.DEFAULTS.bookmarkSource);
        const resolvedSource = savedSource === "github" ? "github" : "linuxdo";
        Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, resolvedSource);
        UI.applyBookmarkSourceUI(resolvedSource);

        const autoConfig = UI.getAutoImportConfigBySource();
        const autoImportEnabled = Storage.get(autoConfig.enabledKey, autoConfig.enabledDefault);
        refs.autoImportEnabled.checked = autoImportEnabled;
        refs.autoImportOptions.style.display = autoImportEnabled ? "block" : "none";
        const autoImportInterval = Storage.get(autoConfig.intervalKey, autoConfig.intervalDefault);
        const intervalSelect = refs.autoImportInterval
        intervalSelect.value = autoImportInterval;
        // 如果存储的值不在选项中，回退到默认值
        if (intervalSelect.selectedIndex === -1) {
            intervalSelect.value = autoConfig.intervalDefault;
            Storage.set(autoConfig.intervalKey, autoConfig.intervalDefault);
        }

        const bookmarkAutoImportEnabled = Storage.get(
            CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED,
            CONFIG.DEFAULTS.bookmarkAutoImportEnabled
        );
        refs.bookmarkAutoImportEnabled.checked = bookmarkAutoImportEnabled;
        refs.bookmarkAutoImportOptions.style.display = bookmarkAutoImportEnabled ? "block" : "none";
        const bookmarkAutoInterval = Storage.get(
            CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL,
            CONFIG.DEFAULTS.bookmarkAutoImportInterval
        );
        const bookmarkIntervalSelect = refs.bookmarkAutoImportInterval
        bookmarkIntervalSelect.value = String(bookmarkAutoInterval);
        if (bookmarkIntervalSelect.selectedIndex === -1) {
            bookmarkIntervalSelect.value = String(CONFIG.DEFAULTS.bookmarkAutoImportInterval);
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.bookmarkAutoImportInterval);
        }

        // F-UI-31:两条自动同步链状态持久化回显（上次同步:时间·结果）
        UI.renderSyncChainStatus();
        // F-UI-35:收藏 Tab 导出目标摘要
        UI.updateExportTargetSummary();

        const linuxdoDedupMode = Utils.getLinuxDoImportDedupMode();
        const linuxdoDedupSelect = refs.linuxdoDedupModeSelect
        linuxdoDedupSelect.value = linuxdoDedupMode;
        if (linuxdoDedupSelect.selectedIndex === -1) {
            linuxdoDedupSelect.value = CONFIG.DEFAULTS.linuxdoImportDedupMode;
            Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.linuxdoImportDedupMode);
        }

        const bookmarkDedupMode = Utils.getBookmarkImportDedupMode();
        const bookmarkDedupSelect = refs.bookmarkDedupModeSelect
        bookmarkDedupSelect.value = bookmarkDedupMode;
        if (bookmarkDedupSelect.selectedIndex === -1) {
            bookmarkDedupSelect.value = CONFIG.DEFAULTS.bookmarkImportDedupMode;
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.bookmarkImportDedupMode);
        }

        refs.aiCategoryAutoDedupCheckbox.checked = Storage.get(
            CONFIG.STORAGE_KEYS.AI_CATEGORY_AUTO_DEDUP,
            CONFIG.DEFAULTS.aiCategoryAutoDedup
        );

        const crossSourceMode = Storage.get(
            CONFIG.STORAGE_KEYS.CROSS_SOURCE_MODE,
            CONFIG.DEFAULTS.crossSourceMode
        );
        refs.crossSourceModeSelect.value = crossSourceMode;

        const updateAutoEnabled = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled);
        const updateIntervalHours = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
        const updateAutoEnabledEl = refs.updateAutoEnabled
        const updateAutoOptionsEl = refs.updateAutoOptions
        const updateIntervalEl = refs.updateIntervalHours
        updateAutoEnabledEl.checked = updateAutoEnabled;
        updateAutoOptionsEl.style.display = updateAutoEnabled ? "block" : "none";
        updateIntervalEl.value = String(updateIntervalHours);
        if (updateIntervalEl.selectedIndex === -1) {
            updateIntervalEl.value = String(CONFIG.DEFAULTS.updateCheckIntervalHours);
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
        }
        NotionOAuth.syncApiKeyInputs();
        CredentialVault.syncSensitiveInput(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
        CredentialVault.syncSensitiveInput(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
        CredentialVault.syncSensitiveInput(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, "Obsidian Local REST API Key");
        UI.renderSyncCenterSummary();
        UI.renderWorkspaceVisualSummary();
        UI.renderVisualSummary();
        UpdateChecker.renderLastStatus();
    },

    // F-UI-31:三条自动同步链状态持久化回显（上次同步:时间·结果）
    renderSyncChainStatus: () => {
        const panel = UI.panel;
        if (!panel) return;
        const OUTCOME_LABELS = { idle: "空闲", running: "同步中", success: "成功", partial: "部分成功", error: "失败" };
        const chains = [
            { source: "bookmark", selector: "#ldb-bookmark-auto-import-status" },
            { source: "github-stars", selector: "#ldb-auto-import-status" },
        ];
        for (const chain of chains) {
            const el = panel.querySelector(chain.selector);
            if (!el) continue;
            const state = SyncState.getSourceState(chain.source);
            if (!state.lastAttemptAt) {
                el.textContent = "尚未同步";
                continue;
            }
            const time = new Date(state.lastAttemptAt).toLocaleTimeString();
            const outcome = OUTCOME_LABELS[state.lastOutcome] || state.lastOutcome;
            el.textContent = `上次同步:${time} · ${outcome}`;
        }
    },

    // F-UI-35:收藏 Tab 导出目标/授权/权限只读摘要
    updateExportTargetSummary: () => {
        const panel = UI.panel;
        if (!panel) return;
        const el = panel.querySelector("#ldb-export-target-summary");
        if (!el) return;
        const exportState = TargetState.getExportState();
        const targetType = exportState.targetType === "page" ? "父页面" : "数据库";
        const targetId = targetType === "父页面" ? exportState.parentPageId : exportState.databaseId;
        const level = Number(Storage.get(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, CONFIG.DEFAULTS.permissionLevel));
        const levelLabels = { 0: "只读", 1: "标准", 2: "高级", 3: "管理员" };
        const authMode = NotionOAuth.getAuthMode() === "oauth" ? "OAuth" : "Manual";
        el.textContent = `导出目标:${targetType} ${targetId ? targetId.slice(0, 12) : "未配置"} · 权限:${levelLabels[level] || level} · 授权:${authMode}`;
    },

    // 跨页配置同步(3/3 共识 dsf+glm+qwen):其他标签页修改导出/AI 目标时回填本页输入与摘要。
    // 否则陈旧面板保存(events.js 从 refs 读取目标)会把他端新配置覆盖回旧值。
    installTargetCrossPageWatchers: () => {
        if (UI._targetWatchersInstalled) return;
        UI._targetWatchersInstalled = true;
        if (typeof GM_addValueChangeListener !== "function") return;
        const keys = [
            CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID,
            CONFIG.STORAGE_KEYS.PARENT_PAGE_ID,
            CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE,
            CONFIG.STORAGE_KEYS.AI_TARGET_DB,
        ];
        const syncFromStorage = () => {
            if (!UI.panel) return;
            try {
                const refs = UI.refs || {};
                const exportState = TargetState.getExportState();
                // 正在编辑的输入框不覆盖(避免打断用户输入)
                if (refs.databaseIdInput && document.activeElement !== refs.databaseIdInput) {
                    refs.databaseIdInput.value = exportState.databaseId;
                }
                if (refs.parentPageIdInput && document.activeElement !== refs.parentPageIdInput) {
                    refs.parentPageIdInput.value = exportState.parentPageId;
                }
                const isPage = exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE;
                if (refs.exportTargetPageRadio) refs.exportTargetPageRadio.checked = isPage;
                if (refs.exportTargetDatabaseRadio) refs.exportTargetDatabaseRadio.checked = !isPage;
                // P3(qwen, 主 agent 复核): 只切单选框会让父页面/手动 DB 区域与提示残留旧态
                if (refs.parentPageGroup) refs.parentPageGroup.style.display = isPage ? "block" : "none";
                if (refs.manualDbWrap) {
                    const hasManualDb = !!String(refs.databaseIdInput?.value || "").trim();
                    refs.manualDbWrap.style.display = isPage ? "none" : (hasManualDb ? "block" : "none");
                }
                if (refs.exportTargetTip) {
                    refs.exportTargetTip.textContent = isPage
                        ? "导出为子页面，包含完整内容"
                        : "导出为数据库条目，支持筛选和排序";
                }
                UI.updateExportButtonState?.();
                UI.updateExportTargetSummary();
                // P4 收敛(c15): AI_TARGET_DB 也在监听键内, 必须回填 AI 目标下拉 ——
                // 否则他端改动后本页陈旧选择会在保存时反向覆盖
                if (refs.aiTargetDbSelect) {
                    const workspaceData = Utils.safeJsonParse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}"), {}) || {};
                    UI.updateAITargetDbOptions(workspaceData.databases || []);
                    if (!TargetState.getDisplayAITargetState().value) refs.aiTargetDbSelect.value = "";
                }
            } catch (error) {
                console.warn("[LD-Notion] 导出目标跨页同步失败", error?.message || error);
            }
        };
        try {
            for (const key of keys) {
                GM_addValueChangeListener(key, (_name, _oldValue, _newValue, remote) => {
                    if (remote) syncFromStorage();
                });
            }
        } catch (error) {
            // 注册失败静默降级(仅失去跨页刷新),与 auth/storage 既有先例一致
            console.warn("[LD-Notion] 导出目标跨页监听注册失败", error?.message || error);
        }
    },

    renderSelfCheckResult: () => {
        const panel = UI.panel;
        if (!panel) return;

        const refs = UI.refs || {};
        const resultEl = refs.selfCheckResult
        if (!resultEl) return;

        const isUserscriptMode = Utils.isUserscriptMode();
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        const bookmarkSource = UI.getActiveBookmarkSource();
        const hasGitHubUsername = !!String(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "") ?? "").trim();
        const hasGitHubToken = !!String(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "") ?? "").trim();

        const checks = [
            {
                ok: true,
                label: "运行模式",
                value: isUserscriptMode ? "Userscript" : "Extension",
            },
            {
                ok: hasBridgeMarker,
                label: "书签桥接",
                value: hasBridgeMarker ? "已检测" : "未检测",
            },
            {
                ok: true,
                label: "当前来源",
                value: bookmarkSource === "github" ? "GitHub" : "Linux.do",
            },
            {
                ok: hasGitHubUsername,
                label: "GitHub 用户名",
                value: hasGitHubUsername ? "已配置" : "未配置",
            },
            {
                ok: hasGitHubToken,
                label: "GitHub Token",
                value: hasGitHubToken ? "已配置" : "未配置",
            },
            {
                ok: true,
                label: "权限级别",
                value: `级别 ${OperationGuard.getLevel()}`,
            },
            {
                ok: true,
                label: "审计日志",
                value: Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog) ? "已启用" : "未启用",
            },
        ];

        const tips = [];
        if (!hasBridgeMarker) {
            tips.push("• 未检测到书签桥接：请安装/启用 chrome-extension（Userscript）或确认扩展权限。");
        }
        if (bookmarkSource === "github" && !hasGitHubUsername && !hasGitHubToken) {
            tips.push("• 当前来源为 GitHub：请至少配置 GitHub 用户名，建议同时配置 Token。");
        }
        if (isUserscriptMode && hasBridgeMarker) {
            tips.push("• 当前为 Userscript + 桥接可用，建议仅保留一种运行模式避免混用。");
        }
        if (tips.length === 0) {
            tips.push("• 当前自检通过：可直接执行加载与导入。", "• 如导入失败，请点击“复制诊断信息”并反馈。");
        }

        const lines = [
            ...checks.map(item => `${item.ok ? "✅" : "⚠️"} ${item.label}：${item.value}`),
            "",
            "建议：",
            ...tips,
        ];

        resultEl.style.whiteSpace = "pre-line";
        resultEl.textContent = lines.join("\n");
    },

    // P3 共识(dsf+qwen+glm): 剪贴板写入统一入口——await 失败不再静默,
    // execCommand 降级校验返回值, 失败抛错由调用方提示。
    copyTextToClipboard: async (text) => {
        const value = String(text || "");
        let clipboardError = null;
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch (error) {
                // P4 收敛(c15): Clipboard API 存在但 reject(页面失焦/权限拒绝) —— 原实现直接抛错,
                // 无 execCommand 降级, 复制功能整体不可用。降级也失败时抛原始错误
                // (保留 P3 契约: 失败必须可见且带真实原因)
                clipboardError = error;
            }
        }
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        let copied = false;
        try {
            copied = typeof document.execCommand === "function" && document.execCommand("copy");
        } finally {
            textarea.remove();
        }
        if (!copied) throw clipboardError || new Error("浏览器未允许复制到剪贴板");
        return true;
    },

    copyDiagnostics: async () => {
        const isUserscriptMode = Utils.isUserscriptMode();
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        const bookmarkSource = UI.getActiveBookmarkSource();
        // P4 收敛(c15): 非字符串脏值(跨设备同步/历史存储)会让 .trim() 抛 TypeError
        const hasGitHubUsername = !!String(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "") ?? "").trim();
        const hasGitHubToken = !!String(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "") ?? "").trim();
        const activeTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, CONFIG.DEFAULTS.activeTab);
        const updateLastResultRaw = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, "");
        const updateLastSeenVersion = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_SEEN_VERSION, "");
        const updateLastCheckAt = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, "");
        const modeConflictTipShown = Storage.get(CONFIG.STORAGE_KEYS.MODE_CONFLICT_TIP_SHOWN, false);

        const autoCfg = UI.getAutoImportConfigBySource();
        const autoImportEnabled = Storage.get(autoCfg.enabledKey, autoCfg.enabledDefault);
        const autoImportInterval = Storage.get(autoCfg.intervalKey, autoCfg.intervalDefault);

        // F-UI-17:诊断补项(权限级别/授权模式/AI 服务/同步状态)
        const permissionLevel = OperationGuard.getLevel();
        const authMode = Storage.get(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, CONFIG.DEFAULTS.notionAuthMode);
        const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
        const aiModel = Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, CONFIG.DEFAULTS.aiModel);
        const auditEnabled = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
        const syncState = Storage.get(CONFIG.STORAGE_KEYS.AUTO_SYNC_STATE, {});
        const syncStateSummary = (syncState && typeof syncState === "object")
            ? Object.keys(syncState).map(k => `${k}=${syncState[k]?.lastSyncAt ? "synced" : "idle"}`).join(",")
            : "";

        const issues = [];
        if (!hasBridgeMarker) {
            issues.push("missing_bookmark_bridge");
        }
        if (bookmarkSource === "github" && !hasGitHubUsername && !hasGitHubToken) {
            issues.push("github_credentials_missing");
        }

        let updateLastResult = "";
        if (typeof updateLastResultRaw === "string") {
            updateLastResult = updateLastResultRaw;
        } else if (updateLastResultRaw && typeof updateLastResultRaw === "object") {
            try {
                updateLastResult = JSON.stringify(updateLastResultRaw);
            } catch {
                updateLastResult = String(updateLastResultRaw);
            }
        }

        const diagnostics = [
            "[LD-Notion Diagnostics v2]",
            "",
            "[runtime]",
            `url=${location.href}`,
            `mode=${isUserscriptMode ? "userscript" : "extension"}`,
            `bridge=${hasBridgeMarker ? "ready" : "missing"}`,
            `source=${bookmarkSource}`,
            `active_tab=${activeTab}`,
            `bookmark_count=${Array.isArray(UI.bookmarks) ? UI.bookmarks.length : 0}`,
            "",
            "[config]",
            `github_username=${hasGitHubUsername ? "set" : "unset"}`,
            `github_token=${hasGitHubToken ? "set" : "unset"}`,
            `auto_import_enabled=${autoImportEnabled ? "true" : "false"}`,
            `auto_import_interval=${String(autoImportInterval)}`,
            `permission_level=${permissionLevel}`,
            `auth_mode=${authMode}`,
            `audit_log=${auditEnabled ? "enabled" : "disabled"}`,
            `ai_service=${aiService}`,
            `ai_model=${aiModel}`,
            `sync_state=${syncStateSummary || "none"}`,
            `mode_conflict_tip_shown=${modeConflictTipShown ? "true" : "false"}`,
            "",
            "[update_checker]",
            `last_check_at=${updateLastCheckAt || ""}`,
            `last_seen_version=${updateLastSeenVersion || ""}`,
            `last_result=${(updateLastResult || "").slice(0, 500)}`,
            "",
            "[issues]",
            `count=${issues.length}`,
            `items=${issues.join(",")}`,
            "",
            "[env]",
            `user_agent=${navigator.userAgent}`,
            `time=${new Date().toISOString()}`,
        ].join("\n");

        try {
            await UI.copyTextToClipboard(diagnostics);
            UI.showStatus("诊断信息已复制（v2）", "success");
        } catch (error) {
            UI.showStatus(`复制失败: ${error.message || error}`, "error");
        }
    },

    // 显示状态
    showStatus: (message, type = "info") => {
        // v3.14.7 (REV-10 UI-04): 面板销毁(destroy 置 UI.refs=null)后 emit("notify")
        // 对 null 解引用抛 TypeError(被 event-bus 吞成 console.error, 通知静默丢失)——
        // 判空后直接忽略, 配合 bus 不抛错语义。
        const container = UI.refs?.statusContainer;
        if (!container) return;

        // 清除上一个定时器，避免新消息被旧定时器提前清除
        if (container._statusTimer) clearTimeout(container._statusTimer);

        container.innerHTML = `
            <div class="ldb-status ${Utils.escapeHtml(type)}">
                ${Utils.escapeHtml(message)}
                <button class="ldb-status-close" title="关闭" aria-label="关闭状态提示">×</button>
            </div>
        `;

        // 添加关闭按钮事件
        const closeBtn = container.querySelector(".ldb-status-close");
        if (closeBtn) {
            closeBtn.onclick = () => { container.innerHTML = ""; };
        }

        // 错误消息延长显示时间（10秒），其他类型3秒
        const timeout = type === "error" ? 10000 : 3000;
        // 清旧定时器，防高频调用堆叠致状态栏被过期定时器意外清空（L1 reliability）
        if (container._statusTimer) clearTimeout(container._statusTimer);
        container._statusTimer = setTimeout(() => {
            container.innerHTML = "";
        }, timeout);
    },

    // 显示进度
    showProgress: (current, total, message) => {
        // v3.14.7 (REV-10): 与 showStatus 同款判空(destroy 后总线悬挂 TypeError 同类)
        const container = UI.refs?.statusContainer;
        if (!container) return;
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;

        // v3.14.7 (REV-12 UI-11): 清除 showStatus 残留的自动清除定时器——
        // 否则导出前的 3s/10s 状态提示定时器在进度条展示中途到期, 把进度条容器清空(随机闪断)。
        if (container._statusTimer) {
            clearTimeout(container._statusTimer);
            container._statusTimer = null;
        }

        container.innerHTML = `
            <div class="ldb-progress">
                <div class="ldb-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
                    <div class="ldb-progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="ldb-progress-text">
                    ${current}/${total} (${percent}%)<br>
                    <small style="white-space: pre-line; word-break: break-word;">${Utils.escapeHtml(message)}</small>
                </div>
            </div>
        `;
    },

    // 隐藏进度
    hideProgress: () => {
        // v3.14.7 (REV-12): 同步清除残留定时器, 防隐藏后旧定时器清空新内容
        const container = UI.refs?.statusContainer;
        if (!container) return;
        if (container._statusTimer) {
            clearTimeout(container._statusTimer);
            container._statusTimer = null;
        }
        container.innerHTML = "";
    },

    // 更新 AI 模型选项
    updateAIModelOptions: (service, customModels = null, preserveSelection = false) => {
        const refs = UI.refs || {};
        const modelSelect = refs.aiModelSelect;
        const provider = AIService.PROVIDERS[service];

        if (!provider || !modelSelect) return;

        const models = customModels || provider.models;
        const defaultModel = provider.defaultModel;

        // 保留当前选择的模型（如果需要且存在于新列表中）
        const currentValue = modelSelect.value;
        const shouldPreserve = preserveSelection && currentValue && models.includes(currentValue);

        modelSelect.innerHTML = models.map(model => {
            const isSelected = shouldPreserve
                ? model === currentValue
                : model === defaultModel;
            // model 来自 AI /models 响应（用户可配自定义 baseUrl 指向攻击者端点），
            // 须转义 value 属性与文本，防 CWE-79 注入
            const safeModel = Utils.escapeHtml(model);
            return `<option value="${safeModel}" ${isSelected ? 'selected' : ''}>${safeModel}</option>`;
        }).join("");
    },

    // 更新工作区选择下拉框
    updateWorkspaceSelect: (workspaceData) => {
        const refs = UI.refs || {};
        const select = refs.workspaceSelect;
        if (!select) return;

        const { databases = [], pages = [] } = workspaceData;
        const exportState = TargetState.getExportState();
        const restoreValue = exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE
            ? (exportState.parentPageId ? `page:${exportState.parentPageId}` : "")
            : (exportState.databaseId ? `database:${exportState.databaseId}` : "");

        let options = '<option value="">-- 从工作区选择 --</option>';
        const knownValues = new Set();

        // 数据库组
        if (databases.length > 0) {
            options += '<optgroup label="📁 数据库">';
            databases.forEach(db => {
                const value = `database:${db.id}`;
                knownValues.add(value);
                options += `<option value="${Utils.escapeHtml(value)}">📁 ${Utils.escapeHtml(db.title)}</option>`;
            });
            options += '</optgroup>';
        }

        // 页面组（只显示工作区顶级页面）
        const workspacePages = pages.filter(p => p.parent === "workspace");
        if (workspacePages.length > 0) {
            options += '<optgroup label="📄 工作区页面">';
            workspacePages.forEach(page => {
                const value = `page:${page.id}`;
                knownValues.add(value);
                options += `<option value="${Utils.escapeHtml(value)}">📄 ${Utils.escapeHtml(page.title)}</option>`;
            });
            options += '</optgroup>';
        }

        if (restoreValue && !knownValues.has(restoreValue)) {
            const shortId = restoreValue.split(":")[1] || "";
            // v3.14.7 (REV-18 UI-01): restoreValue 为用户手输 ID(可含引号)——
            // value 属性须转义防属性逃逸(self-XSS 面; db.id/page.id 为 Notion UUID 实际安全)
            const safeRestoreValue = Utils.escapeHtml(restoreValue);
            options += `<option value="${safeRestoreValue}">已配置 (ID: ${Utils.escapeHtml(shortId.slice(0, 8))}...)</option>`;
        }

        select.innerHTML = options;
        if (restoreValue) {
            select.value = restoreValue;
        }
    },

    // 授权后目标发现结果消费(三模型共识):复用 workspace select + tip,不新建控件
    applyPostAuthTarget: async (payload = {}) => {
        const refs = UI.refs || {};
        const workspaceTip = refs.workspaceTip;
        const action = payload.action || "";

        if (action === "autofill") {
            // P4 收敛(c15): 此处为 textContent 赋值 —— 预先 escapeHtml 会双重转义(& → &amp; 字面显示)
            const title = payload.title || "";
            if (workspaceTip) {
                workspaceTip.textContent = `✅ 已自动选择数据库${title ? `「${title}」` : ""}，可点击「自动设置数据库」初始化属性`;
                workspaceTip.style.color = "var(--ldb-ui-success)";
            }
            // 刷新下拉以回显已配置目标
            const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput?.value?.trim() || "");
            if (apiKey) {
                try {
                    const { workspaceData } = await WorkspaceService.refreshWorkspaceSnapshot(apiKey, {
                        includePages: false,
                        maxPages: 1,
                    });
                    UI.updateWorkspaceSelect(workspaceData);
                } catch (_) { /* 回显失败不阻断,用户可手动刷新 */ }
            }
        } else if (action === "needs_choice") {
            const count = payload.count || (Array.isArray(payload.candidates) ? payload.candidates.length : 0);
            if (workspaceTip) {
                workspaceTip.textContent = payload.warn
                    ? `⚠️ ${payload.warn}，请重新选择导出目标`
                    : `请选择导出目标（发现 ${count} 个可访问数据库）`;
                workspaceTip.style.color = "var(--ldb-ui-warning)";
            }
            const select = refs.workspaceSelect;
            if (select) {
                select.classList.add("ldb-highlight");
                setTimeout(() => select.classList.remove("ldb-highlight"), 3000);
            }
        } else if (action === "empty") {
            if (workspaceTip) {
                workspaceTip.textContent = payload.hint
                    ? `⚠️ ${payload.hint}`
                    : "⚠️ 集成未共享任何数据库：请在 Notion 目标库页面右上角 ⋯ → Connections → 连接你的集成";
                workspaceTip.style.color = "var(--ldb-ui-warning)";
            }
        } else if (action === "failed") {
            if (workspaceTip) {
                workspaceTip.textContent = `❌ 自动发现目标失败：${payload.message || payload.reason || "未知错误"}（可手动刷新工作区列表）`;
                workspaceTip.style.color = "var(--ldb-ui-danger)";
            }
        }
    },

    // 更新 AI 查询目标数据库下拉框
    updateAITargetDbOptions: (databases) => {
        const refs = UI.refs || {};
        const select = refs.aiTargetDbSelect;
        if (!select) return;

        const savedValue = TargetState.getDisplayAITargetState().value;

        // 保留固定选项，添加数据库列表
        let options = '<option value="">当前配置的数据库</option>';
        options += '<option value="__all__">所有工作区数据库</option>';
        const knownIds = new Set();

        if (databases.length > 0) {
            options += '<optgroup label="📁 指定数据库">';
            databases.forEach(db => {
                knownIds.add(db.id);
                options += `<option value="${Utils.escapeHtml(db.id)}">📁 ${Utils.escapeHtml(db.title)}</option>`;
            });
            options += '</optgroup>';
        }

        if (savedValue && savedValue !== "__all__" && !knownIds.has(savedValue)) {
            const displayId = savedValue.replace(/^page:/, "");
            // v3.14.7 audit: savedValue 为手输 ID 可含引号——value 属性须 escapeHtml 防属性逃逸
            options += `<option value="${Utils.escapeHtml(savedValue)}">已配置 (ID: ${Utils.escapeHtml(displayId.slice(0, 8))}...)</option>`;
        }

        select.innerHTML = options;

        // 恢复之前的选择
        if (savedValue) {
            select.value = savedValue;
        }
    },

    // 重算导出统计（在列表变更后调用）
    recomputeExportStats: () => {
        if (!UI.bookmarks || UI.bookmarks.length === 0) {
            UI.totalUnexportedCount = 0;
            UI.selectedUnexportedCount = 0;
            return;
        }

        let totalUnexported = 0;
        let selectedUnexported = 0;

        UI.bookmarks.forEach((b) => {
            const bookmarkKey = UI.getBookmarkKey(b);
            const isUnexported = !UI.isBookmarkKeyExported(bookmarkKey);
            if (isUnexported) {
                totalUnexported++;
                if (UI.selectedBookmarks?.has(bookmarkKey)) {
                    selectedUnexported++;
                }
            }
        });

        UI.totalUnexportedCount = totalUnexported;
        UI.selectedUnexportedCount = selectedUnexported;
    },

    // 更新选中数量
    updateSelectCount: () => {
        // P3 共识(dsf+glm): destroy 置 UI.refs=null 后晚到的异步回调(加载/导出完成)
        // 会裸解引用 selectCount 抛 TypeError, 中断计数与全选框更新。
        const refs = UI.refs;
        if (!refs?.selectCount) return;
        const count = UI.selectedBookmarks?.size || 0;
        const pendingCount = UI.selectedUnexportedCount || 0;

        // F-UI-14:已选集合含已导出项(复选框 disabled),文案改为「已加载/待导出」避免误导
        const statusSrc = typeof UI.getExportStatusSource === "function" ? UI.getExportStatusSource() : "local";
        const srcTag = statusSrc === "notion" ? "（Notion）" : "（本地）";
        refs.selectCount.textContent = `已加载 ${count} 个，待导出 ${Math.max(0, pendingCount)} 个${srcTag}`;
        if (typeof UI.updateExportStatusTip === "function") UI.updateExportStatusTip();

        // 更新全选框状态
        const selectAll = refs.selectAll;
        if (selectAll) {
            if (count === 0) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
            } else if (UI.totalUnexportedCount > 0 && pendingCount === UI.totalUnexportedCount) {
                selectAll.checked = true;
                selectAll.indeterminate = false;
            } else {
                selectAll.checked = false;
                selectAll.indeterminate = true;
            }
        }
        // v3.14.7 (REV-31 UI-27): renderVisualSummary 微任务合并——逐项选择几十项时
        // 每次 updateSelectCount 都全量重渲染概览致抖动; 合并到同轮宏任务末只渲染一次。
        if (!UI._selectCountRenderScheduled) {
            UI._selectCountRenderScheduled = true;
            Promise.resolve().then(() => {
                UI._selectCountRenderScheduled = false;
                if (!UI.refs) return;
                UI.renderVisualSummary();
            });
        }
    },

    // 显示导出报告
    showReport: (results) => {
        // P3 共识(dsf+glm): destroy 置 UI.refs=null 后晚到导出回调会裸解引用崩溃
        const container = UI.refs?.reportContainer;
        if (!container) return;
        const { success, failed, skipped } = results;

        let html = '<div class="ldb-report">';
        html += '<div class="ldb-report-title">📊 导出报告</div>';

        // v3.14.17 (P0-2): 认证中止时提供『重新授权』直达按钮(OAuth 已配置时)——
        // 用户无需翻设置页,一次性走完重新授权流程
        const authAborted = results.authAborted
            || (results.aborted === true ? { reason: "认证失败" } : null);
        let reauthorizeBtnHtml = "";
        if (authAborted && NotionOAuth.getConfig().clientId) {
            reauthorizeBtnHtml = `<button type="button" class="ldb-btn ldb-btn-primary ldb-reauthorize-btn" style="margin-top:8px;">🔄 重新授权</button>`;
        }
        if (authAborted) {
            // v3.14.12 (三模型共识): 按 authCode 分支文案——manual 模式无「续签」概念,
            // 空 token/格式非法/官方拒绝分别提示,避免误导
            const authCode = String(authAborted.authCode || "").toLowerCase();
            let authTitle = "⛔ 已中止导出：Notion 认证失败（API token 无效且无法自动续签）";
            let authHint = "请检查 Notion API Key 或重新 OAuth 一键授权后，再次点击导出即可续传剩余项。";
            if (authCode === "empty_token") {
                authTitle = "⛔ 已中止导出：未读取到已保存的 Notion API Key";
                authHint = "请到设置页重新粘贴保存 API Key（secret_/ntn_ 开头），或重新 OAuth 一键授权。";
            } else if (authCode === "format_suspect") {
                authTitle = "⛔ 已中止导出：Notion API Key 格式异常";
                authHint = "Key 应以 secret_ 或 ntn_ 开头；疑似复制不完整或误贴其他凭证，请从 Notion 集成页面用 Copy 按钮重新复制。";
            } else if (authCode === "invalid_bearer_token" || authCode === "unauthorized") {
                authTitle = "⛔ 已中止导出：Notion 拒绝了该 API Key";
                authHint = "Key 可能已失效（集成被删除/轮换）或复制不完整。请到 Notion Integrations 重新复制（勿含空格/换行），或重新 OAuth 一键授权。";
            }
            html += `<div class="ldb-report-item failed" style="padding:8px 12px;margin-bottom:6px;border-radius:6px;background:var(--ldb-ui-danger-alpha-12);">
                <div>${authTitle}</div>
                <div style="margin-top:4px;font-size:12px;opacity:.85;">${Utils.escapeHtml(Utils.truncateText(String(authAborted.reason || ""), 160))}</div>
                <div style="margin-top:4px;font-size:12px;opacity:.85;">${authHint}</div>
                ${reauthorizeBtnHtml}
            </div>`;
        }

        if (success.length > 0) {
            html += '<div class="ldb-report-section">';
            html += `<div class="ldb-report-section-title">✅ 成功 (${success.length})</div>`;
            success.slice(0, 10).forEach(item => {
                // 全盘审计修复: escapeHtml 不拦 javascript:/data: scheme——非 http(s) 链接降级为纯文本
                const safeUrl = /^https?:\/\//i.test(String(item.url || "")) ? item.url : "";
                html += `<div class="ldb-report-item success">
                    ${safeUrl
                        ? `<a href="${Utils.escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${Utils.escapeHtml(Utils.truncateText(item.title, 40))}</a>`
                        : `<span>${Utils.escapeHtml(Utils.truncateText(item.title, 40))}</span>`}
                </div>`;
            });
            if (success.length > 10) {
                html += `<div class="ldb-report-item success"><span>...</span> 还有 ${success.length - 10} 个</div>`;
            }
            html += '</div>';
        }

        if (failed.length > 0) {
            html += '<div class="ldb-report-section">';
            html += `<div class="ldb-report-section-title">❌ 失败 (${failed.length})</div>`;
            // v3.14.17 (P0-1): 失败区顶部附可行动建议(分类函数产出的 action 字段)——
            // 用户无需点开每条错误即可获得下一步指引; 认证中止时横幅已有专属引导, 不重复
            if (!authAborted) {
                // H1: ux 是 failed 项上的独立字段(error 才是 message 字符串),
                // 此前读 failed[0].error.ux 恒 undefined → 「💡 建议」块永不渲染
                const firstUx = failed[0]?.ux;
                if (firstUx && firstUx.action) {
                    html += `<div class="ldb-report-item" style="color: var(--ldb-ui-accent);padding:6px 12px;margin-bottom:8px;border-radius:6px;background:var(--ldb-ui-accent-alpha-12);">💡 建议：${Utils.escapeHtml(Utils.truncateText(firstUx.action, 220))}</div>`;
                }
            }
            failed.slice(0, 20).forEach(item => {
                // P2:失败项 title 悬停显示完整标题,错误详情可点击复制
                const fullTitle = item.title || "";
                const fullError = item.error || "";
                html += `<div class="ldb-report-item failed" title="${Utils.escapeHtml(fullTitle)}">
                    <span>✗</span>
                    <span>${Utils.escapeHtml(Utils.truncateText(fullTitle, 35))}</span>
                </div>`;
                html += `<div class="ldb-report-error" data-err="${Utils.escapeHtml(fullError)}" title="点击复制完整错误" style="cursor:pointer;">${Utils.escapeHtml(Utils.truncateText(fullError, 120))}</div>`;
            });
            if (failed.length > 20) {
                html += `<div class="ldb-report-item failed"><span>...</span> 还有 ${failed.length - 20} 个失败项</div>`;
            }
            html += '</div>';
        }

        if (skipped && skipped.length > 0) {
            html += '<div class="ldb-report-section">';
            html += `<div class="ldb-report-section-title">⏭️ 已跳过 (${skipped.length})</div>`;
            html += `<div class="ldb-report-item" style="color: var(--ldb-ui-muted);">
                <span>${authAborted ? "认证中止后未尝试" : "由于取消操作"}，${skipped.length} 个收藏未导出</span>
            </div>`;
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
        // 失败项错误复制: data-err 属性 + addEventListener(替代内联 onclick JSON 拼接——
        // 首字符引号截断属性致按钮恒失效且可属性注入, 全盘审计修复)
        container.querySelectorAll(".ldb-report-error").forEach((el) => {
            el.addEventListener("click", async () => {
                // P3 共识(dsf+qwen): 原实现未 await/未捕获, 剪贴板失败完全静默
                try {
                    await UI.copyTextToClipboard(el.dataset.err || "");
                    UI.showStatus("错误信息已复制", "success");
                } catch (error) {
                    UI.showStatus(`复制失败: ${error.message || error}`, "error");
                }
            });
        });
        // v3.14.17 (P0-2): 重新授权按钮直达 OAuth 流,避免用户翻设置页
        container.querySelectorAll(".ldb-reauthorize-btn").forEach((el) => {
            el.addEventListener("click", () => {
                try {
                    NotionOAuth.startAuthorization();
                    UI.showStatus("🔐 已打开 Notion 授权页，请在弹出的页面中选择数据库并允许", "info");
                } catch (e) {
                    UI.showStatus(`❌ ${e.message}`, "error");
                }
            });
        });
    },

    // 更新操作日志面板
    updateLogPanel: () => {
        if (!UI.panel) return;

        const listContainer = UI.panel.querySelector("#ldb-log-list");
        const countBadge = UI.panel.querySelector("#ldb-log-count");

        if (!listContainer || !countBadge) return;

        const logs = OperationLog.getRecent(20);
        countBadge.textContent = logs.length;

        if (logs.length === 0) {
            listContainer.innerHTML = '<div class="ldb-log-empty">暂无操作记录</div>';
            return;
        }

        let html = '';
        logs.forEach(entry => {
            const formatted = OperationLog.formatEntry(entry);
            html += `
                <div class="ldb-log-item">
                    <span class="icon">${formatted.statusIcon}</span>
                    <div class="content">
                        <div class="operation">${Utils.escapeHtml(formatted.operation)}</div>
                        <div class="time">${formatted.time} · ${formatted.duration}</div>
                        ${formatted.error ? `<div class="error">${Utils.escapeHtml(formatted.error)}</div>` : ''}
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    },

    // 拖拽功能
    makeDraggable: (element, handle) => {
        let offsetX, offsetY, isDragging = false;

        // Odyssey UI F+Q: pointer events + setPointerCapture 替代 document.onmouse*
        // 解决:① 与 NotionSiteUI.makeDraggable 的全局 handler 互相覆盖;
        // ② 触屏设备不可拖拽(mouse-only)。
        handle.addEventListener("pointerdown", (e) => {
            if (e.target.tagName === "BUTTON") return;
            isDragging = true;
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
            document.body.style.userSelect = "none";
            try { handle.setPointerCapture(e.pointerId); } catch (_) { /* 旧浏览器降级 */ }
        });

        handle.addEventListener("pointermove", (e) => {
            if (!isDragging) return;
            const x = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, e.clientX - offsetX));
            const y = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, e.clientY - offsetY));
            element.style.left = x + "px";
            element.style.top = y + "px";
            element.style.right = "auto";
        });

        const endDrag = (e) => {
            if (!isDragging) return;
            isDragging = false;
            document.body.style.userSelect = "";
            try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* 旧浏览器降级 */ }
        };
        handle.addEventListener("pointerup", endDrag);
        handle.addEventListener("pointercancel", endDrag);
    },

    maybePromptBookmarkExtensionInstall: () => {
        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        if (!isUserscriptMode) return;
        if (BookmarkBridge.isExtensionAvailable()) return;
        if (Storage.get(CONFIG.STORAGE_KEYS.EXT_INSTALL_PROMPT_SHOWN, false)) return;

        Storage.set(CONFIG.STORAGE_KEYS.EXT_INSTALL_PROMPT_SHOWN, true);
        // P2:原生 confirm 统一为 ConfirmationDialog
        ConfirmationDialog.show({
            title: "安装书签桥接扩展",
            message: "检测到你尚未安装书签桥接扩展。\n\n是否现在打开安装页面？",
            confirmText: "打开安装页",
            onConfirm: () => InstallHelper.openBookmarkExtensionInstall(),
        });
    },

    // 初始化
    init: () => {
        UI.injectStyles();
        UI.createPanel();
        UI.miniBtn = UI.createMiniButton();

        // 事件总线订阅（security 解耦后，oplog/notify 通过总线触达 UI）
        // P3 共识(glm+qwen): 记录 handler 供 destroy 注销——此前匿名订阅在面板销毁后
        // 仍被总线回调(renderBookmarkList 等裸解引用 refs), destroy→init 还会叠加订阅。
        const { on, off } = require("../coordination/event-bus");
        const busHandlers = (UI._busHandlers = []);
        const subscribe = (event, handler) => {
            on(event, handler);
            busHandlers.push([event, handler]);
        };
        subscribe("oplog:changed", () => {
            // v3.14.7 (REV-15 UI-17): 修正折叠守卫——此前检查 #ldb-log-panel(存在性容器
            // 恒不 collapsed)恒真, 审计关闭/折叠时仍全量重渲染; 改查真实折叠元素
            // #ldb-log-content。另加防抖: 批量导出 O(N) 次 OperationLog.add 每项都
            // emit+parse+重渲染, 合并到宏任务末一次性刷新。
            clearTimeout(UI._oplogDebounceTimer);
            UI._oplogDebounceTimer = setTimeout(() => {
                const content = UI.refs?.logContent;
                if (content && !content.classList.contains("collapsed")) {
                    try { UI.updateLogPanel(); } catch (e) { console.warn("[LD-Notion] 日志面板渲染失败:", e); }
                }
            }, 120);
        });
        subscribe("notify", ({ message, type }) => {
            UI.showStatus(message, type);
        });
        subscribe("sync:center-summary-updated", () => {
            if (typeof UI.renderSyncCenterSummary === "function") {
                try { UI.renderSyncCenterSummary(); } catch (e) { console.warn("[LD-Notion] 同步中心面板渲染失败:", e); }
            }
            // v3.14.7 (REV-11 UI-10): 自动同步完成只 emit sync:center-summary-updated,
            // 而收藏 Tab 三条链状态(#ldb-*-auto-import-status)的渲染不在此事件链上,
            // 冻结在加载时刻——同步事件同时刷新收藏 Tab 链状态与导出目标摘要。
            try { UI.renderSyncChainStatus(); } catch (e) { console.warn("[LD-Notion] 同步链状态渲染失败:", e); }
            try { UI.updateExportTargetSummary(); } catch (e) { console.warn("[LD-Notion] 导出目标摘要渲染失败:", e); }
        });
        subscribe("bookmarks:updated", () => {
            if (typeof UI.renderBookmarkList === "function") {
                try { UI.renderBookmarkList(); } catch (e) { console.warn("[LD-Notion] 书签列表渲染失败:", e); }
            }
        });

        // 面板可拉伸（左边+上边+下边+左上角+左下角）
        PanelResize.makeResizable(UI.panel, {
            edges: ["l", "t", "b", "tl", "bl"],
            storageKey: CONFIG.STORAGE_KEYS.PANEL_SIZE_MAIN,
            minWidth: 300,
            minHeight: 300,
        });

        // 检查是否需要最小化启动
        if (Storage.get(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, false)) {
            UI.panel.style.display = "none";
            UI.miniBtn.style.display = "flex";
        }

        UI.maybePromptBookmarkExtensionInstall();
    },

    destroy: () => {
        UI._abortController?.abort();
        UI._abortController = null;
        // P4 收敛(c15): oplog:changed 防抖定时器已排队时 destroy 仍会触发一次渲染
        if (UI._oplogDebounceTimer) {
            clearTimeout(UI._oplogDebounceTimer);
            UI._oplogDebounceTimer = null;
        }
        // P3 共识(glm+qwen): 注销 init 注册的事件总线 handler——此前悬挂回调在面板
        // 销毁后仍触发渲染(裸解引用 refs), destroy→init 还会叠加订阅。
        if (UI._busHandlers) {
            const { off } = require("../coordination/event-bus");
            UI._busHandlers.forEach(([event, handler]) => off(event, handler));
            UI._busHandlers = null;
        }
        if (UI._escMinimizeHandler) {
            document.removeEventListener("keydown", UI._escMinimizeHandler);
            UI._escMinimizeHandler = null;
        }
        // P4 收敛(c15): 残留的 showStatus 自动清除定时器仍持有已卸载容器(短时内存滞留),
        // 在 refs 复位前清掉
        const statusContainer = UI.refs?.statusContainer;
        if (statusContainer?._statusTimer) {
            clearTimeout(statusContainer._statusTimer);
            statusContainer._statusTimer = null;
        }
        UI.panel?.remove();
        UI.panel = null;
        // P4 收敛(c16 2/3 共识 glm+qwen): 清 PanelResize 注册表条目 ——
        // 否则 Map 持续持有已分离面板子树(含会话 DOM)无法被 GC
        PanelResize.unregister(CONFIG.STORAGE_KEYS.PANEL_SIZE_MAIN);
        UI.miniBtn?.remove();
        UI.miniBtn = null;
        UI.refs = null;
        // P4 收敛(c15): 事件委托标记与列表状态随面板复位 —— 否则再次 init 时新列表
        // 因 bookmarkListBound 仍为 true 而不绑定, 且残留选中集参与导出统计
        UI.bookmarkListBound = false;
        UI.bookmarks = [];
        UI.selectedBookmarks = new Set();
        UI.isMinimized = true;
    },
};

Object.assign(UI, require("./workspace-visual").WorkspaceVisual);
Object.assign(UI, require("./bookmark-list").BookmarkList);
Object.assign(UI, require("./workspace-insight").WorkspaceInsight);
// M3 波次8 (ISS-015): GitHub→Obsidian/Notion 导出转发壳 5 方法 mixin
Object.assign(UI, require("./github-obsidian-export").GitHubObsidianExport);

module.exports = { UI };
