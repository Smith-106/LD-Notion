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
const { BookmarkBridge, BookmarkAutoImporter, RSSAutoImporter } = require("../bridge");
const { AIAssistant, AIService, AIWelcomeUI, ChatUI, getAISettings } = require("../ai");
const { StyleManager } = require("./style-manager");
const { DesignSystem } = require("./design-system");
const { PanelResize } = require("./panel-resize");
const { UI_CSS } = require("./styles");
const { UIEvents } = require("./events");

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
            bookmarkListContainer: panel.querySelector("#ldb-bookmark-list-container"),
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
            rssFeedUrlsInput: panel.querySelector("#ldb-rss-feed-urls"),
            rssAutoImportEnabled: panel.querySelector("#ldb-rss-auto-import-enabled"),
            rssAutoImportOptions: panel.querySelector("#ldb-rss-auto-import-options"),
            rssAutoImportInterval: panel.querySelector("#ldb-rss-auto-import-interval"),
            rssAutoImportStatus: panel.querySelector("#ldb-rss-auto-import-status"),
            rssDedupModeSelect: panel.querySelector("#ldb-rss-dedup-mode"),
            bookmarkAutoImportEnabled: panel.querySelector("#ldb-bookmark-auto-import-enabled"),
            bookmarkAutoImportOptions: panel.querySelector("#ldb-bookmark-auto-import-options"),
            bookmarkAutoImportInterval: panel.querySelector("#ldb-bookmark-auto-import-interval"),
            bookmarkAutoImportStatus: panel.querySelector("#ldb-bookmark-auto-import-status"),
            sourcePartitionsToggle: panel.querySelector("#ldb-source-partitions-toggle"),
            sourcePartitionsContent: panel.querySelector("#ldb-source-partitions-content"),
            sourcePartitionsArrow: panel.querySelector("#ldb-source-partitions-arrow"),
            sourceSelectLinuxdo: panel.querySelector("#ldb-source-select-linuxdo"),
            sourceSelectGithub: panel.querySelector("#ldb-source-select-github"),
            updateCheckBtn: panel.querySelector("#ldb-update-check-btn"),
            updateAutoEnabled: panel.querySelector("#ldb-update-auto-enabled"),
            updateAutoOptions: panel.querySelector("#ldb-update-auto-options"),
            updateIntervalHours: panel.querySelector("#ldb-update-interval-hours"),
            updateCheckStatus: panel.querySelector("#ldb-update-check-status"),
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
            exportBtns: panel.querySelector("#ldb-export-btns"),
            controlBtns: panel.querySelector("#ldb-control-btns"),
            pauseBtn: panel.querySelector("#ldb-pause"),
            autoImportEnabled: panel.querySelector("#ldb-auto-import-enabled"),
            autoImportOptions: panel.querySelector("#ldb-auto-import-options"),
            autoImportInterval: panel.querySelector("#ldb-auto-import-interval"),
            linuxdoDedupModeSelect: panel.querySelector("#ldb-linuxdo-dedup-mode"),
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
        panel.innerHTML = `
            <div class="ldb-header">
                <h3>📚 LD-Notion <span class="ldb-runtime-badge" id="ldb-runtime-badge">检测中...</span></h3>
                <div class="ldb-header-btns">
                    <button class="ldb-theme-btn" id="ldb-theme-toggle" title="切换主题" aria-label="切换主题">🌙</button>
                    <button class="ldb-header-btn" id="ldb-minimize" title="最小化" aria-label="最小化面板">−</button>
                    <button class="ldb-header-btn" id="ldb-close" title="关闭" aria-label="关闭面板">×</button>
                </div>
            </div>
            <div class="ldb-tabs" role="tablist">
                <button class="ldb-tab active" data-tab="bookmarks" role="tab" aria-selected="true" aria-controls="ldb-tab-bookmarks">📚 收藏</button>
                <button class="ldb-tab" data-tab="visuals" role="tab" aria-selected="false" aria-controls="ldb-tab-visuals">📊 视图</button>
                <button class="ldb-tab" data-tab="ai" role="tab" aria-selected="false" aria-controls="ldb-tab-ai">🤖 AI</button>
                <button class="ldb-tab" data-tab="settings" role="tab" aria-selected="false" aria-controls="ldb-tab-settings">⚙️ 设置</button>
            </div>
            <div class="ldb-body">
                <!-- ============ Tab 1: 收藏 ============ -->
                <div class="ldb-tab-content active" data-tab-content="bookmarks" role="tabpanel" id="ldb-tab-bookmarks">
                    <!-- 收藏信息 -->
                    <div class="ldb-section">
                        <div class="ldb-bookmarks-info">
                            <div class="ldb-bookmarks-count" id="ldb-bookmark-count">-</div>
                            <div class="ldb-bookmarks-label" id="ldb-bookmarks-label">已加载收藏数量</div>
                        </div>

                        <div class="ldb-toggle-section" id="ldb-source-partitions-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="ldb-source-partitions-content" style="margin-top: var(--ldb-ui-spacing-lg); margin-bottom: var(--ldb-ui-spacing-md);">
                            <span>收藏来源分区</span>
                            <span class="ldb-arrow" id="ldb-source-partitions-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed ldb-mb-8" id="ldb-source-partitions-content">
                            <div class="ldb-source-option-group">
                                <button class="ldb-source-option" id="ldb-source-select-linuxdo" type="button">Linux.do 收藏分区</button>
                                <button class="ldb-source-option" id="ldb-source-select-github" type="button">GitHub 收藏分区</button>
                            </div>
                        </div>

                        <div class="ldb-toggle-section ldb-mb-8" id="ldb-source-settings-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="ldb-source-settings-content">
                            <span>来源自动化设置</span>
                            <span class="ldb-arrow" id="ldb-source-settings-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed ldb-mb-8" id="ldb-source-settings-content">
                            <div class="ldb-setting-row ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: var(--ldb-ui-spacing-sm); cursor: pointer;">
                                    <input type="checkbox" id="ldb-auto-import-enabled">
                                    <span id="ldb-auto-import-label">启用自动导入新收藏</span>
                                </label>
                            </div>
                            <div id="ldb-auto-import-options" style="display: none; margin-bottom: var(--ldb-ui-spacing-md);">
                                <div class="ldb-setting-row ldb-flex-center-gap">
                                    <label id="ldb-auto-import-interval-label" style="white-space: nowrap;">轮询间隔</label>
                                    <select id="ldb-auto-import-interval" class="ldb-input ldb-flex-1">
                                        <option value="0">仅页面加载时</option>
                                        <option value="3">每 3 分钟</option>
                                        <option value="5" selected>每 5 分钟</option>
                                        <option value="10">每 10 分钟</option>
                                        <option value="30">每 30 分钟</option>
                                    </select>
                                </div>
                            </div>
                            <div class="ldb-setting-row ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: var(--ldb-ui-spacing-sm); cursor: pointer;">
                                    <input type="checkbox" id="ldb-bookmark-auto-import-enabled">
                                    <span>启用浏览器书签自动同步</span>
                                </label>
                            </div>
                            <div id="ldb-bookmark-auto-import-options" style="display: none; margin-bottom: var(--ldb-ui-spacing-md);">
                                <div class="ldb-setting-row ldb-flex-center-gap">
                                    <label for="ldb-bookmark-auto-import-interval" style="white-space: nowrap;">书签同步间隔</label>
                                    <select id="ldb-bookmark-auto-import-interval" class="ldb-input ldb-flex-1">
                                        <option value="0">仅页面加载时</option>
                                        <option value="3">每 3 分钟</option>
                                        <option value="5" selected>每 5 分钟</option>
                                        <option value="10">每 10 分钟</option>
                                        <option value="30">每 30 分钟</option>
                                    </select>
                                </div>
                            </div>
                            <div id="ldb-bookmark-auto-import-status" style="font-size: var(--ldb-ui-font-size-sm); color: var(--ldb-ui-muted); margin-bottom: var(--ldb-ui-spacing-md);"></div>
                            <div class="ldb-setting-row ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: var(--ldb-ui-spacing-sm); cursor: pointer;">
                                    <input type="checkbox" id="ldb-rss-auto-import-enabled">
                                    <span>启用 RSS 自动同步</span>
                                </label>
                            </div>
                            <div id="ldb-rss-auto-import-options" style="display: none; margin-bottom: var(--ldb-ui-spacing-md);">
                                <div class="ldb-setting-row" style="margin-bottom: var(--ldb-ui-spacing-md);">
                                    <label for="ldb-rss-feed-urls" style="display: block; margin-bottom: var(--ldb-ui-spacing-sm);">RSS Feed URL</label>
                                    <textarea id="ldb-rss-feed-urls" class="ldb-input" rows="3" placeholder="每行一个 RSS / Atom 地址，或用逗号分隔"></textarea>
                                </div>
                                <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                    <label for="ldb-rss-auto-import-interval" style="white-space: nowrap;">RSS 同步间隔</label>
                                    <select id="ldb-rss-auto-import-interval" class="ldb-input ldb-flex-1">
                                        <option value="0">仅页面加载时</option>
                                        <option value="3">每 3 分钟</option>
                                        <option value="5" selected>每 5 分钟</option>
                                        <option value="10">每 10 分钟</option>
                                        <option value="30">每 30 分钟</option>
                                    </select>
                                </div>
                                <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                    <label for="ldb-rss-dedup-mode" style="white-space: nowrap;">RSS 导入去重</label>
                                    <select id="ldb-rss-dedup-mode" class="ldb-input ldb-flex-1">
                                        <option value="strict">按链接去重</option>
                                        <option value="allow_duplicates">按 Feed + ID 保留重复</option>
                                    </select>
                                </div>
                            </div>
                            <div id="ldb-rss-auto-import-status" style="font-size: var(--ldb-ui-font-size-sm); color: var(--ldb-ui-muted); margin-bottom: var(--ldb-ui-spacing-md);"></div>
                            <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-linuxdo-dedup-mode" style="white-space: nowrap;">Linux.do 导入去重</label>
                                <select id="ldb-linuxdo-dedup-mode" class="ldb-input ldb-flex-1">
                                    <option value="strict">自动去重</option>
                                    <option value="allow_duplicates">允许重复（手动勾选）</option>
                                </select>
                            </div>
                            <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-bookmark-dedup-mode" style="white-space: nowrap;">书签导入去重</label>
                                <select id="ldb-bookmark-dedup-mode" class="ldb-input ldb-flex-1">
                                    <option value="strict">自动去重</option>
                                    <option value="allow_duplicates">允许重复（手动勾选）</option>
                                </select>
                            </div>
                            <div class="ldb-setting-row ldb-mb-8">
                                <label style="display: flex; align-items: center; gap: var(--ldb-ui-spacing-sm); cursor: pointer;">
                                    <input type="checkbox" id="ldb-ai-category-auto-dedup" checked>
                                    <span>分类列表自动去重</span>
                                </label>
                            </div>
                            <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-cross-source-mode" style="white-space: nowrap;">跨源存储模式</label>
                                <select id="ldb-cross-source-mode" class="ldb-input ldb-flex-1">
                                    <option value="separate">分库（各来源独立数据库）</option>
                                    <option value="unified">统一库（所有来源同一数据库）</option>
                                </select>
                            </div>
                            <div id="ldb-auto-import-status" style="font-size: var(--ldb-ui-font-size-sm); color: var(--ldb-ui-muted); margin-bottom: var(--ldb-ui-spacing-md);"></div>

                            <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-update-check-btn" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg);">检查更新</button>
                                <label style="display: flex; align-items: center; gap: var(--ldb-ui-spacing-sm); cursor: pointer; margin: 0;">
                                    <input type="checkbox" id="ldb-update-auto-enabled">
                                    <span>自动检查更新</span>
                                </label>
                            </div>
                            <div id="ldb-update-auto-options" style="display: none; margin-bottom: var(--ldb-ui-spacing-md);">
                                <div class="ldb-setting-row ldb-flex-center-gap">
                                    <label for="ldb-update-interval-hours" style="white-space: nowrap;">检查间隔</label>
                                    <select id="ldb-update-interval-hours" class="ldb-input ldb-flex-1">
                                        <option value="24">每 24 小时</option>
                                        <option value="72">每 72 小时</option>
                                        <option value="168">每 168 小时</option>
                                    </select>
                                </div>
                            </div>
                            <div id="ldb-update-check-status" style="font-size: var(--ldb-ui-font-size-sm); color: var(--ldb-ui-muted); margin-bottom: var(--ldb-ui-spacing-xs);"></div>
                        </div>

                        <div class="ldb-btn-group" style="margin-bottom: var(--ldb-ui-spacing-xl);">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-load-bookmarks">
                                🔄 加载收藏列表
                            </button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-import-browser-bookmarks">
                                📖 导入浏览器书签
                            </button>
                        </div>

                        <!-- 收藏列表 (加载后显示) -->
                        <div id="ldb-bookmark-list-container" style="display: none;">
                            <div class="ldb-select-all">
                                <label>
                                    <input type="checkbox" id="ldb-select-all" checked>
                                    <span>全选/取消</span>
                                </label>
                                <span class="ldb-select-count" id="ldb-select-count">已选 0 个</span>
                            </div>
                            <div class="ldb-bookmark-list" id="ldb-bookmark-list"></div>
                        </div>

                        <!-- 导出按钮组 -->
                        <div class="ldb-btn-group" id="ldb-export-btns">
                            <button class="ldb-btn ldb-btn-primary" id="ldb-export" disabled>
                                📤 开始导出
                            </button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-obs-export" disabled>
                                📝 导出到 Obsidian
                            </button>
                        </div>

                        <!-- 控制按钮 (导出时显示) -->
                        <div class="ldb-control-btns" id="ldb-control-btns" style="display: none;">
                            <button class="ldb-btn ldb-btn-warning ldb-btn-small" id="ldb-pause">
                                ⏸️ 暂停
                            </button>
                            <button class="ldb-btn ldb-btn-danger ldb-btn-small" id="ldb-cancel">
                                ⏹️ 取消
                            </button>
                        </div>
                    </div>

                    <!-- 状态显示 -->
                    <div id="ldb-status-container" aria-live="polite"></div>

                    <!-- 导出报告 -->
                    <div id="ldb-report-container"></div>
                </div>

                <!-- ============ Tab 2: 视图 ============ -->
                <div class="ldb-tab-content" data-tab-content="visuals" role="tabpanel" id="ldb-tab-visuals">
                    <div class="ldb-section">
                        <div class="ldb-view-header">
                            <div>
                                <div class="ldb-section-title" style="margin-bottom: var(--ldb-ui-spacing-xs);">工作区视图</div>
                                <div class="ldb-tip" id="ldb-view-subtitle">刷新后会基于当前 Notion 工作区数据库生成全局时间线、来源关系图和导出漏斗；下方继续保留本轮已加载摘要。</div>
                            </div>
                            <div class="ldb-view-actions">
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-refresh-workspace" type="button">刷新工作区视图</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-generate-insight" type="button">生成洞察</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-save-workspace-candidates" type="button">保存候选</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-save-workspace-package" type="button">保存协作包</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-save-workspace-report" type="button">保存到 Notion</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-copy-workspace-report" type="button">复制报告</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-download-workspace-report" type="button">下载报告</button>
                                <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-download-workspace-package" type="button">下载协作包</button>
                            </div>
                        </div>
                        <div class="ldb-view-status" id="ldb-view-workspace-status">尚未刷新工作区视图。</div>
                        <div class="ldb-view-summary" id="ldb-view-workspace-summary">
                            <div class="ldb-view-empty">
                                <div class="ldb-view-empty-title">工作区总览还没有数据</div>
                                <div class="ldb-view-empty-text">点击上方按钮后，会扫描当前工作区数据库里的页面属性，生成全局时间线、来源关系图和导出漏斗。</div>
                            </div>
                        </div>
                        <div class="ldb-view-subsection">
                            <div class="ldb-view-header">
                                <div>
                                    <div class="ldb-view-section-title">统一同步中心</div>
                                    <div class="ldb-tip">统一查看 Linux.do、GitHub 与浏览器书签三条增量同步链的启用状态、增量基线和最近一次成功结果。</div>
                                </div>
                                <div class="ldb-view-actions">
                                    <button class="ldb-btn ldb-btn-secondary ldb-view-action-btn" id="ldb-view-sync-now" type="button">立即同步全部</button>
                                </div>
                            </div>
                            <div class="ldb-view-summary" id="ldb-view-sync-summary">
                                <div class="ldb-view-empty">
                                    <div class="ldb-view-empty-title">统一同步中心还没有摘要</div>
                                    <div class="ldb-view-empty-text">启用任一自动同步来源后，这里会展示轮询策略、增量水位线和最近成功时间。</div>
                                </div>
                            </div>
                        </div>
                        <div class="ldb-view-subsection">
                            <div class="ldb-view-section-title">本轮已加载摘要</div>
                            <div class="ldb-view-summary" id="ldb-view-summary">
                                <div class="ldb-view-empty">
                                    <div class="ldb-view-empty-title">视图还没有数据</div>
                                    <div class="ldb-view-empty-text">先加载 Linux.do 或 GitHub 收藏，这里会展示来源分布、导出状态和时间线摘要。</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ============ Tab 3: AI 助手 ============ -->
                <div class="ldb-tab-content" data-tab-content="ai" role="tabpanel" id="ldb-tab-ai">
                    <div class="ldb-section">
                        <!-- 对话区域 -->
                        <div class="ldb-chat-container" id="ldb-chat-messages">
                            ${AIWelcomeUI.render(personaName)}
                        </div>

                        <!-- 输入区域 -->
                        <div class="ldb-chat-input-container">
                            <textarea
                                id="ldb-chat-input"
                                class="ldb-chat-input"
                                placeholder="${Utils.escapeHtml(AIWelcomeUI.getInputPlaceholder())}"
                                rows="1"
                            ></textarea>
                            <button id="ldb-chat-send" class="ldb-chat-send-btn">发送</button>
                        </div>

                        <!-- 快捷操作 -->
                        <div class="ldb-chat-actions">
                            <button class="ldb-chat-action-btn" id="ldb-chat-clear">🗑️ 清空</button>
                        </div>
                    </div>
                </div>

                <!-- ============ Tab 4: 设置 ============ -->
                <div class="ldb-tab-content" data-tab-content="settings" role="tabpanel" id="ldb-tab-settings">
                    <!-- Notion 配置 -->
                    <div class="ldb-section">
                        <div class="ldb-section-title">Notion 配置</div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">API Key</label>
                            <input type="password" class="ldb-input" id="ldb-api-key" placeholder="secret_xxx...">
                            <div class="ldb-tip">
                                在 <a href="https://www.notion.so/my-integrations" target="_blank" class="ldb-link">Notion Integrations</a> 创建
                            </div>
                        </div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">公开 OAuth 授权（可选）</label>
                            <input type="text" class="ldb-input" id="ldb-oauth-client-id" placeholder="Client ID">
                            <input type="password" class="ldb-input" id="ldb-oauth-client-secret" placeholder="Client Secret" class="ldb-mt-8">
                            <input type="text" class="ldb-input" id="ldb-oauth-redirect-uri" placeholder="Redirect URI" class="ldb-mt-8">
                            <div style="display: flex; gap: var(--ldb-ui-spacing-md); flex-wrap: wrap; margin-top: var(--ldb-ui-spacing-md);">
                                <button class="ldb-btn ldb-btn-primary" id="ldb-oauth-authorize">🔐 一键授权</button>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-oauth-clear">断开授权</button>
                            </div>
                            <div class="ldb-tip" id="ldb-oauth-status" style="margin-top: var(--ldb-ui-spacing-sm);"></div>
                            <div style="display: flex; gap: var(--ldb-ui-spacing-md); flex-wrap: wrap; margin-top: var(--ldb-ui-spacing-md);">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-vault-unlock">解锁保险箱</button>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-vault-lock">锁定</button>
                            </div>
                            <div class="ldb-tip" id="ldb-vault-status" style="margin-top: var(--ldb-ui-spacing-sm);"></div>
                            <div class="ldb-tip">如果你使用 Notion 公开集成，请先把 Redirect URI 加到集成配置里，再点击一键授权。敏感凭证会保存在本地加密保险箱中。</div>
                        </div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">数据库 / 页面</label>
                            <div class="ldb-flex-gap">
                                <select class="ldb-select" id="ldb-workspace-select" class="ldb-flex-1">
                                    <option value="">-- 从工作区选择 --</option>
                                </select>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-refresh-workspace" class="ldb-nowrap-badge" title="刷新工作区页面列表" aria-label="刷新工作区页面列表">🔄</button>
                            </div>
                            <div class="ldb-input-group" id="ldb-manual-db-wrap" style="display: none; margin-top: var(--ldb-ui-spacing-md);">
                                <input type="text" class="ldb-input" id="ldb-database-id" placeholder="手动输入 32 位数据库 ID（高级）" class="ldb-flex-1">
                            </div>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-toggle-manual-db" style="margin-top: var(--ldb-ui-spacing-sm); padding: var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-lg); font-size: var(--ldb-ui-font-size-sm);">高级：手动输入数据库 ID</button>
                            <div class="ldb-tip" id="ldb-workspace-tip">
                                优先从工作区列表选择，无法加载时再手动输入
                            </div>
                        </div>

                        <!-- 导出目标类型选择 -->
                        <div class="ldb-input-group">
                            <label class="ldb-label">导出目标</label>
                            <div class="ldb-checkbox-group ldb-mb-8">
                                <label class="ldb-checkbox-item">
                                    <input type="radio" name="ldb-export-target" id="ldb-export-target-database" value="database" checked>
                                    <span>数据库（推荐）</span>
                                </label>
                                <label class="ldb-checkbox-item">
                                    <input type="radio" name="ldb-export-target" id="ldb-export-target-page" value="page">
                                    <span>页面（子页面）</span>
                                </label>
                            </div>
                            <div class="ldb-tip" id="ldb-export-target-tip">
                                导出为数据库条目，支持筛选和排序
                            </div>
                        </div>

                        <!-- 父页面 ID（页面模式时显示） -->
                        <div class="ldb-input-group" id="ldb-parent-page-group" style="display: none;">
                            <label class="ldb-label">父页面 ID</label>
                            <input type="text" class="ldb-input" id="ldb-parent-page-id" placeholder="32位页面ID">
                            <div class="ldb-tip">
                                帖子将作为子页面创建在此页面下
                            </div>
                        </div>

                        <div style="display: flex; gap: var(--ldb-ui-spacing-md); align-items: center; flex-wrap: wrap;">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-validate-config">验证配置</button>
                            <button class="ldb-btn ldb-btn-primary" id="ldb-setup-database" title="自动在数据库中创建所需属性">自动设置数据库</button>
                            <span id="ldb-config-status" style="font-size: var(--ldb-ui-font-size-sm); margin-left: var(--ldb-ui-spacing-xs);"></span>
                        </div>

                        <!-- 权限设置 -->
                        <div class="ldb-permission-panel ldb-mt-12">
                            <div class="ldb-permission-row">
                                <span class="ldb-permission-label">权限级别</span>
                                <select class="ldb-permission-select" id="ldb-permission-level">
                                    <option value="0">只读</option>
                                    <option value="1">标准</option>
                                    <option value="2">高级</option>
                                    <option value="3">管理员</option>
                                </select>
                            </div>
                            <div class="ldb-permission-row">
                                <span class="ldb-permission-label">危险操作确认</span>
                                <label class="ldb-toggle-switch">
                                    <input type="checkbox" id="ldb-require-confirm" checked>
                                    <span class="ldb-toggle-slider"></span>
                                </label>
                            </div>
                            <div class="ldb-permission-row">
                                <span class="ldb-permission-label">审计日志</span>
                                <label class="ldb-toggle-switch">
                                    <input type="checkbox" id="ldb-enable-audit-log" checked>
                                    <span class="ldb-toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 筛选设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-filter-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="ldb-filter-content">
                            <span class="ldb-section-title" style="margin-bottom: 0;">筛选设置</span>
                            <span id="ldb-filter-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-filter-content">
                            <div class="ldb-input-group ldb-mt-12">
                                <div class="ldb-checkbox-group">
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" id="ldb-only-first">
                                        <span>仅主楼</span>
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" id="ldb-only-op">
                                        <span>仅楼主</span>
                                    </label>
                                </div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">楼层范围</label>
                                <div class="ldb-range-group">
                                    <input type="number" id="ldb-range-start" value="1" min="1">
                                    <span>至</span>
                                    <input type="number" id="ldb-range-end" value="999999" min="1">
                                </div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片处理</label>
                                <select class="ldb-select" id="ldb-img-mode">
                                    <option value="upload">上传到 Notion</option>
                                    <option value="external">外链引用</option>
                                    <option value="skip">跳过图片</option>
                                </select>
                                <div class="ldb-tip">Notion 免费套餐文件需小于 5MB；付费套餐 PDF 小于 20MB、图片小于 5MB。若图片上传报错，脚本会自动尝试按文件上传。</div>
                            </div>
                            <div class="ldb-form-group">
                                <label>请求间隔</label>
                                <select class="ldb-select" id="ldb-request-delay">
                                    <option value="200">快速 (200ms)</option>
                                    <option value="500">正常 (500ms)</option>
                                    <option value="1000">慢速 (1秒)</option>
                                    <option value="2000">较慢 (2秒)</option>
                                    <option value="3000">很慢 (3秒)</option>
                                    <option value="5000">超慢 (5秒)</option>
                                    <option value="10000">极慢 (10秒)</option>
                                    <option value="30000">龟速 (30秒)</option>
                                </select>
                            </div>
                            <div class="ldb-form-group">
                                <label>并发数</label>
                                <select class="ldb-select" id="ldb-export-concurrency">
                                    <option value="1">串行 (1个)</option>
                                    <option value="2">2 个并发</option>
                                    <option value="3">3 个并发</option>
                                    <option value="5">5 个并发</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片筛选</label>
                                <select class="ldb-select" id="ldb-filter-img">
                                    <option value="all">全部</option>
                                    <option value="only_img">仅含图楼层</option>
                                    <option value="no_img">仅无图楼层</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">指定用户</label>
                                <input type="text" class="ldb-input" id="ldb-filter-users" placeholder="user1, user2">
                                <div class="ldb-tip">逗号分隔，仅导出这些用户的回复</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">包含关键词</label>
                                <input type="text" class="ldb-input" id="ldb-filter-include" placeholder="教程, 指南">
                                <div class="ldb-tip">逗号分隔，必须包含任一关键词</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">排除关键词</label>
                                <input type="text" class="ldb-input" id="ldb-filter-exclude" placeholder="广告, 水贴">
                                <div class="ldb-tip">逗号分隔，排除包含关键词的楼层</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">最少字数</label>
                                <input type="number" class="ldb-input" id="ldb-filter-minlen" value="0" min="0" placeholder="0">
                                <div class="ldb-tip">过滤字数不足的楼层</div>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- AI 设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-ai-settings-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="ldb-ai-settings-content">
                            <span class="ldb-section-title" style="margin-bottom: 0;">AI 设置</span>
                            <span id="ldb-ai-settings-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-ai-settings-content">
                            <div class="ldb-input-group ldb-mt-12">
                                <label class="ldb-label">AI 服务</label>
                                <select class="ldb-select" id="ldb-ai-service">
                                    <option value="openai">OpenAI</option>
                                    <option value="claude">Claude</option>
                                    <option value="gemini">Gemini</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">模型</label>
                                <div class="ldb-flex-gap">
                                    <select class="ldb-select" id="ldb-ai-model" class="ldb-flex-1"></select>
                                    <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-fetch-models" class="ldb-nowrap-badge">🔄 获取</button>
                                </div>
                                <div class="ldb-tip" id="ldb-ai-model-tip"></div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">API Key</label>
                                <input type="password" class="ldb-input" id="ldb-ai-api-key" placeholder="AI 服务的 API Key">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">自定义端点 (可选)</label>
                                <input type="text" class="ldb-input" id="ldb-ai-base-url" placeholder="留空使用官方 API">
                                <div class="ldb-tip">支持第三方 OpenAI 兼容 API</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">分类列表</label>
                                <input type="text" class="ldb-input" id="ldb-ai-categories" placeholder="技术, 生活, 问答, 分享, 资源, 其他">
                                <div class="ldb-tip">逗号分隔，用于自动分类功能</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">查询数据库</label>
                                <div class="ldb-flex-gap">
                                    <select class="ldb-select" id="ldb-ai-target-db" class="ldb-flex-1">
                                        <option value="">当前配置的数据库</option>
                                        <option value="__all__">所有工作区数据库</option>
                                    </select>
                                    <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-refresh-dbs" class="ldb-nowrap-badge">🔄</button>
                                </div>
                                <div class="ldb-tip">AI 查询数据库时的目标范围</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">刷新页数上限</label>
                                <select class="ldb-select" id="ldb-workspace-max-pages">
                                    <option value="5">5 页 (500 条)</option>
                                    <option value="10">10 页 (1000 条)</option>
                                    <option value="20">20 页 (2000 条)</option>
                                    <option value="50">50 页 (5000 条)</option>
                                    <option value="0">无限制</option>
                                </select>
                                <div class="ldb-tip">刷新工作区列表时每类的最大分页数</div>
                            </div>
                            <div class="ldb-btn-group ldb-flex-center-gap">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-ai-test">测试连接</button>
                                <span id="ldb-ai-test-status" style="font-size: var(--ldb-ui-font-size-sm);"></span>
                            </div>

                            <!-- AI 输出模板管理 -->
                            <div class="ldb-section-divider">
                                <span class="ldb-hint">📋 AI 输出模板</span>
                            </div>
                            <div id="ldb-template-list" style="margin-bottom: var(--ldb-ui-spacing-md);"></div>
                            <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                <input type="text" class="ldb-input" id="ldb-template-name" placeholder="模板名称" style="width: 80px;">
                                <input type="text" class="ldb-input" id="ldb-template-icon" placeholder="图标" style="width: 50px;">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-template-add" style="padding: var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-md); font-size: var(--ldb-ui-font-size-sm);">添加</button>
                            </div>
                            <div class="ldb-input-group" style="margin-bottom: var(--ldb-ui-spacing-xs);">
                                <textarea class="ldb-input" id="ldb-template-prompt" rows="2" placeholder="模板 prompt，用于 AI 生成内容" style="resize: vertical;"></textarea>
                            </div>
                            <div class="ldb-tip">添加后可在 AI 对话中使用「用xx模板总结xxx页面」</div>

                            <!-- Agent 个性化设置 -->
                            <div class="ldb-section-divider">
                                <span class="ldb-hint">🤖 Agent 个性化</span>
                            </div>
                            <div class="ldb-input-group ldb-mt-8">
                                <label class="ldb-label">助手名字</label>
                                <input type="text" class="ldb-input" id="ldb-agent-persona-name" placeholder="AI 助手">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">语气风格</label>
                                <select class="ldb-select" id="ldb-agent-persona-tone">
                                    <option value="友好">友好</option>
                                    <option value="专业">专业</option>
                                    <option value="幽默">幽默</option>
                                    <option value="简洁">简洁</option>
                                    <option value="热情">热情</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">专业领域</label>
                                <input type="text" class="ldb-input" id="ldb-agent-persona-expertise" placeholder="Notion 工作区管理">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">自定义指令 (可选)</label>
                                <textarea class="ldb-input" id="ldb-agent-persona-instructions" rows="2" placeholder="额外的行为指令，如：总是用列表格式回复" style="resize: vertical;"></textarea>
                                <div class="ldb-tip">Agent 每次对话都会遵循的个性化指令</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">Agent 最大执行步数</label>
                                <select class="ldb-select" id="ldb-agent-max-iterations">
                                    <option value="4">4 步 (快速)</option>
                                    <option value="8" selected>8 步 (默认)</option>
                                    <option value="12">12 步 (深入)</option>
                                    <option value="16">16 步 (复杂任务)</option>
                                    <option value="24">24 步 (极限)</option>
                                </select>
                                <div class="ldb-tip">Agent 循环的最大工具调用次数</div>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- GitHub 收藏导入设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-github-settings-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="ldb-github-settings-content">
                            <span class="ldb-section-title" style="margin-bottom: 0;">🐙 GitHub 导入</span>
                            <span id="ldb-github-settings-arrow">▶</span>
                        </div>
                        <div style="margin-top: var(--ldb-ui-spacing-md); margin-bottom: var(--ldb-ui-spacing-sm);">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-open-github-settings" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg); font-size: var(--ldb-ui-font-size-sm);">
                                🎯 一键定位 GitHub Token
                            </button>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-github-settings-content">
                            <div class="ldb-input-group ldb-mt-12">
                                <label class="ldb-label">GitHub 用户名</label>
                                <input type="text" class="ldb-input" id="ldb-github-username" placeholder="your-username">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">GitHub Token (可选)</label>
                                <input type="password" class="ldb-input" id="ldb-github-token" placeholder="ghp_xxx...">
                                <div class="ldb-tip">不填写也可使用，但有速率限制</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">导入类型</label>
                                <div class="ldb-checkbox-group" style="margin-top: var(--ldb-ui-spacing-xs);">
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="stars" checked> ⭐ Stars
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="repos"> 📦 Repos
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="forks"> 🍴 Forks
                                    </label>
                                    <label class="ldb-checkbox-item">
                                        <input type="checkbox" class="ldb-github-type" value="gists"> 📝 Gists
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- Obsidian 导出设置 -->
                    <div class="ldb-section">
                        <div class="ldb-toggle-section" id="ldb-obs-settings-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="ldb-obs-settings-content">
                            <span class="ldb-section-title" style="margin-bottom: 0;">📝 Obsidian 导出</span>
                            <span id="ldb-obs-settings-arrow">▶</span>
                        </div>
                        <div class="ldb-toggle-content collapsed" id="ldb-obs-settings-content">
                            <div class="ldb-input-group ldb-mt-12">
                                <label class="ldb-label">API 地址</label>
                                <input type="text" class="ldb-input" id="ldb-obs-api-url" placeholder="https://127.0.0.1:27124">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">API Key</label>
                                <input type="password" class="ldb-input" id="ldb-obs-api-key" placeholder="Obsidian Local REST API Key">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">导出目录</label>
                                <input type="text" class="ldb-input" id="ldb-obs-dir" placeholder="Linux.do">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片模式</label>
                                <select class="ldb-select" id="ldb-obs-img-mode">
                                    <option value="file">保存图片并引用</option>
                                    <option value="base64">Base64 内嵌</option>
                                    <option value="skip">不导出图片</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">图片目录</label>
                                <input type="text" class="ldb-input" id="ldb-obs-img-dir" placeholder="Linux.do/attachments">
                                <div class="ldb-tip">仅"保存图片并引用"模式有效</div>
                            </div>
                            <div style="margin-top: var(--ldb-ui-spacing-md);">
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-obs-test-btn" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg); font-size: var(--ldb-ui-font-size-sm);">🔗 测试连接</button>
                                <span id="ldb-obs-test-status" aria-live="polite" style="font-size: var(--ldb-ui-font-size-sm); margin-left: var(--ldb-ui-spacing-md);"></span>
                            </div>
                        </div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 浏览器书签导入 -->
                    <div class="ldb-section">
                        <div style="font-size: var(--ldb-ui-font-size-md); font-weight: 700; color: var(--ldb-ui-text);">📖 浏览器书签</div>
                        <div id="ldb-bookmark-ext-status" style="font-size: var(--ldb-ui-font-size-xs); margin-top: var(--ldb-ui-spacing-xs); color: var(--ldb-ui-muted);"></div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 运行自检 -->
                    <div class="ldb-section">
                        <div style="font-size: var(--ldb-ui-font-size-md); font-weight: 700; color: var(--ldb-ui-text);">🩺 运行自检</div>
                        <div class="ldb-btn-group" style="margin-top: var(--ldb-ui-spacing-md); margin-bottom: var(--ldb-ui-spacing-md);">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-self-check-btn" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg); font-size: var(--ldb-ui-font-size-sm);">执行自检</button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-copy-diagnostics-btn" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg); font-size: var(--ldb-ui-font-size-sm);">复制诊断信息</button>
                        </div>
                        <div id="ldb-self-check-result" class="ldb-hint"></div>
                    </div>

                    <div class="ldb-divider"></div>

                    <!-- 操作日志面板 -->
                    <div class="ldb-log-panel" id="ldb-log-panel">
                        <div class="ldb-log-header" id="ldb-log-toggle">
                            <span class="ldb-log-title">
                                📋 操作日志
                                <span class="ldb-log-badge" id="ldb-log-count">0</span>
                            </span>
                            <span id="ldb-log-arrow">▶</span>
                        </div>
                        <div class="ldb-log-content collapsed" id="ldb-log-content">
                            <div id="ldb-log-list"></div>
                            <div class="ldb-log-actions">
                                <button class="ldb-log-clear-btn" id="ldb-log-clear">清除日志</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
        UI.panel = panel;
        UI.cacheRefs();

        // 绑定事件
        UI.bindEvents();

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
        btn.style.display = "none";

        btn.onclick = () => {
            UI.panel.style.display = "block";
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
                const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
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

        refs.rssFeedUrlsInput.value = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_FEED_URLS,
            CONFIG.DEFAULTS.rssFeedUrls
        );
        const rssAutoImportEnabled = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED,
            CONFIG.DEFAULTS.rssAutoImportEnabled
        );
        refs.rssAutoImportEnabled.checked = rssAutoImportEnabled;
        refs.rssAutoImportOptions.style.display = rssAutoImportEnabled ? "block" : "none";
        const rssAutoInterval = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL,
            CONFIG.DEFAULTS.rssAutoImportInterval
        );
        const rssIntervalSelect = refs.rssAutoImportInterval;
        rssIntervalSelect.value = String(rssAutoInterval);
        if (rssIntervalSelect.selectedIndex === -1) {
            rssIntervalSelect.value = String(CONFIG.DEFAULTS.rssAutoImportInterval);
            Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, CONFIG.DEFAULTS.rssAutoImportInterval);
        }
        const rssDedupMode = Storage.get(
            CONFIG.STORAGE_KEYS.RSS_IMPORT_DEDUP_MODE,
            CONFIG.DEFAULTS.rssImportDedupMode
        );
        const rssDedupSelect = refs.rssDedupModeSelect;
        rssDedupSelect.value = rssDedupMode;
        if (rssDedupSelect.selectedIndex === -1) {
            rssDedupSelect.value = CONFIG.DEFAULTS.rssImportDedupMode;
            Storage.set(CONFIG.STORAGE_KEYS.RSS_IMPORT_DEDUP_MODE, CONFIG.DEFAULTS.rssImportDedupMode);
        }

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

    renderSelfCheckResult: () => {
        const panel = UI.panel;
        if (!panel) return;

        const refs = UI.refs || {};
        const resultEl = refs.selfCheckResult
        if (!resultEl) return;

        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        const bookmarkSource = UI.getActiveBookmarkSource();
        const hasGitHubUsername = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "").trim();
        const hasGitHubToken = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "").trim();

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

    copyDiagnostics: async () => {
        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        const bookmarkSource = UI.getActiveBookmarkSource();
        const hasGitHubUsername = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "").trim();
        const hasGitHubToken = !!Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "").trim();
        const activeTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, CONFIG.DEFAULTS.activeTab);
        const updateLastResultRaw = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, "");
        const updateLastSeenVersion = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_SEEN_VERSION, "");
        const updateLastCheckAt = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, "");
        const modeConflictTipShown = Storage.get(CONFIG.STORAGE_KEYS.MODE_CONFLICT_TIP_SHOWN, false);

        const autoCfg = UI.getAutoImportConfigBySource();
        const autoImportEnabled = Storage.get(autoCfg.enabledKey, autoCfg.enabledDefault);
        const autoImportInterval = Storage.get(autoCfg.intervalKey, autoCfg.intervalDefault);

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
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(diagnostics);
            } else {
                const textarea = document.createElement("textarea");
                textarea.value = diagnostics;
                textarea.setAttribute("readonly", "readonly");
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                textarea.remove();
            }
            UI.showStatus("诊断信息已复制（v2）", "success");
        } catch (error) {
            UI.showStatus(`复制失败: ${error.message || error}`, "error");
        }
    },

    // 显示状态
    showStatus: (message, type = "info") => {
        const container = UI.refs.statusContainer

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
        const container = UI.refs.statusContainer
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;

        container.innerHTML = `
            <div class="ldb-progress">
                <div class="ldb-progress-bar">
                    <div class="ldb-progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="ldb-progress-text">
                    ${current}/${total} (${percent}%)<br>
                    <small>${Utils.escapeHtml(message)}</small>
                </div>
            </div>
        `;
    },

    // 隐藏进度
    hideProgress: () => {
        UI.refs.statusContainer.innerHTML = "";
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
                options += `<option value="${value}">📁 ${Utils.escapeHtml(db.title)}</option>`;
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
                options += `<option value="${value}">📄 ${Utils.escapeHtml(page.title)}</option>`;
            });
            options += '</optgroup>';
        }

        if (restoreValue && !knownValues.has(restoreValue)) {
            const shortId = restoreValue.split(":")[1] || "";
            options += `<option value="${restoreValue}">已配置 (ID: ${shortId.slice(0, 8)}...)</option>`;
        }

        select.innerHTML = options;
        if (restoreValue) {
            select.value = restoreValue;
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
                options += `<option value="${db.id}">📁 ${Utils.escapeHtml(db.title)}</option>`;
            });
            options += '</optgroup>';
        }

        if (savedValue && savedValue !== "__all__" && !knownIds.has(savedValue)) {
            const displayId = savedValue.replace(/^page:/, "");
            options += `<option value="${savedValue}">已配置 (ID: ${displayId.slice(0, 8)}...)</option>`;
        }

        select.innerHTML = options;

        // 恢复之前的选择
        if (savedValue) {
            select.value = savedValue;
        }
    },


    buildWorkspaceCollaborationPackage: (
        model = UI.buildWorkspaceVisualizationModel(),
        syncModel = UI.buildUnifiedSyncModel()
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

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model, UI.workspaceInsightSummary || "");
        const generatedAt = UI.workspaceInsightUpdatedAt || Date.now();
        const summaryText = String(UI.workspaceInsightSummary || "").trim() || UI.buildWorkspaceInsightFallbackSummary(model);

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

    buildWorkspaceCollaborationPackageMarkdown: (collabPackage = UI.buildWorkspaceCollaborationPackage()) => {
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
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model);
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(markdown);
            } else {
                const textarea = document.createElement("textarea");
                textarea.value = markdown;
                textarea.setAttribute("readonly", "readonly");
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                textarea.remove();
            }
            UI.workspaceInsightMarkdown = markdown;
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.showStatus("工作区洞察报告已复制。", "success");
        } catch (error) {
            throw new Error(error?.message || String(error));
        }
    },

    downloadWorkspaceInsightReport: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model);
        const objectUrlApi = (typeof window !== "undefined" && window.URL && typeof window.URL.createObjectURL === "function")
            ? window.URL
            : (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null);
        if (!objectUrlApi) {
            throw new Error("当前环境不支持报告下载。");
        }

        const stampSource = UI.workspaceInsightUpdatedAt || Date.now();
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
            UI.workspaceInsightMarkdown = markdown;
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.showStatus("工作区洞察报告已开始下载。", "success");
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
        const model = UI.buildWorkspaceVisualizationModel();
        const syncModel = UI.buildUnifiedSyncModel();
        const collabPackage = UI.buildWorkspaceCollaborationPackage(model, syncModel);
        const objectUrlApi = (typeof window !== "undefined" && window.URL && typeof window.URL.createObjectURL === "function")
            ? window.URL
            : (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL : null);
        if (!objectUrlApi) {
            throw new Error("当前环境不支持协作包下载。");
        }

        const stampSource = UI.workspaceInsightUpdatedAt || Date.now();
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
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.showStatus("工作区协作包已开始下载。", "success");
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
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI.refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const collabPackage = UI.buildWorkspaceCollaborationPackage(model, UI.buildUnifiedSyncModel());
        const markdown = UI.buildWorkspaceCollaborationPackageMarkdown(collabPackage);
        const packageTime = UI.workspaceInsightUpdatedAt || Date.now();
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
        UI.workspaceInsightUpdatedAt = Date.now();
        UI.setWorkspaceVisualStatus(
            `工作区协作包已保存到 Notion（${exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库"}）。`,
            "success"
        );
        UI.showStatus("工作区协作包已保存到 Notion。", "success");
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
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI.refs?.apiKeyInput?.value.trim());
        if (!apiKey) {
            throw new Error(MSG.NO_NOTION_KEY);
        }

        const exportState = TargetState.getExportState();
        if (!exportState.targetId) {
            throw new Error("请先配置导出目标（数据库或父页面）。");
        }

        const markdown = UI.workspaceInsightMarkdown || UI.buildWorkspaceInsightMarkdown(model);
        const reportTime = UI.workspaceInsightUpdatedAt || Date.now();
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
        UI.workspaceInsightMarkdown = markdown;
        UI.workspaceInsightUpdatedAt = Date.now();
        UI.setWorkspaceVisualStatus(
            `工作区洞察报告已保存到 Notion（${exportState.targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? "父页面" : "数据库"}）。`,
            "success"
        );
        UI.showStatus("工作区洞察报告已保存到 Notion。", "success");
        return {
            pageId,
            title: reportTitle,
            targetId: exportState.targetId,
            targetType: exportState.targetType,
            markdown,
        };
    },

    saveWorkspaceConnectionCandidatesToNotion: async () => {
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }
        if (!Array.isArray(model.connectionCandidates) || model.connectionCandidates.length === 0) {
            throw new Error("当前没有可保存的跨源关联候选。");
        }

        const apiKey = NotionOAuth.getAccessToken(UI.refs?.apiKeyInput?.value.trim());
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
            database = await UI.ensureWorkspaceConnectionCandidateDatabaseSchema(exportState.databaseId, apiKey, database);
        }

        for (let index = 0; index < model.connectionCandidates.length; index++) {
            const candidate = model.connectionCandidates[index];
            const aiDraft = await UI.buildWorkspaceConnectionCandidateAIDraft(candidate, aiSettings);
            const candidateTitle = UI.buildWorkspaceConnectionCandidateTitle(candidate, index, aiDraft);
            const markdown = UI.buildWorkspaceConnectionCandidateMarkdown(candidate, savedAt, aiDraft);
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
                    const properties = UI.buildWorkspaceConnectionCandidateDatabaseProperties(
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

        UI.setWorkspaceVisualStatus(statusMessage, tone);
        UI.showStatus(statusMessage, tone);

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
        const model = UI.buildWorkspaceVisualizationModel();
        if (!model?.scannedAt) {
            throw new Error("请先刷新工作区视图。");
        }

        const btn = UI.refs?.viewGenerateWorkspaceInsightBtn;
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
                    JSON.stringify({
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
                    }, null, 2),
                ].join("\n");
                aiSummary = String(await AIService.requestChat(prompt, settings, 900) || "").trim();
            }

            UI.workspaceInsightSummary = aiSummary;
            UI.workspaceInsightMarkdown = UI.buildWorkspaceInsightMarkdown(model, aiSummary);
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.renderWorkspaceVisualSummary();
            UI.setWorkspaceVisualStatus("已生成工作区洞察报告，可直接复制分享。", "success");
            return UI.workspaceInsightMarkdown;
        } catch (error) {
            UI.workspaceInsightSummary = "";
            UI.workspaceInsightMarkdown = UI.buildWorkspaceInsightMarkdown(model, "");
            UI.workspaceInsightUpdatedAt = Date.now();
            UI.renderWorkspaceVisualSummary();
            UI.setWorkspaceVisualStatus(`洞察生成失败，已回退为规则报告：${error.message}`, "error");
            throw error;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = "生成洞察";
            }
        }
    },

    renderVisualSummary: () => {
        const container = UI.refs?.viewSummary;
        if (!container) return;

        const subtitle = UI.refs?.viewSubtitle;
        const model = UI.buildVisualizationModel();

        if (subtitle) {
            subtitle.textContent = model.loadedSources.length > 0
                ? `这里继续展示本轮已加载的 ${model.loadedSources.join(" + ")} 列表摘要；工作区总览需要点击上方按钮单独刷新。`
                : "这里继续展示当前已加载的 Linux.do / GitHub 列表摘要，不会主动读取 Notion 工作区。";
        }

        if (model.total === 0) {
            container.innerHTML = `
                <div class="ldb-view-empty">
                    <div class="ldb-view-empty-title">视图还没有数据</div>
                    <div class="ldb-view-empty-text">先加载 Linux.do 或 GitHub 收藏，这里会展示来源分布、导出状态和时间线摘要。</div>
                </div>
            `;
            return;
        }

        const renderBarRows = (rows) => rows.length > 0
            ? `<div class="ldb-view-bars">${rows.map((row) => `
                <div class="ldb-view-bar-row">
                    <div class="ldb-view-bar-label">${Utils.escapeHtml(row.label)}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${Math.max(8, row.pct)}%;"></div></div>
                    <div class="ldb-view-bar-value">${row.count} · ${row.pct}%</div>
                </div>
            `).join("")}</div>`
            : `<div class="ldb-view-empty-text">暂无可展示的数据。</div>`;

        const statusRows = [
            { label: "已导出", count: model.exported, pct: UI.getViewPct(model.exported, model.total) },
            { label: "待导出", count: model.pending, pct: UI.getViewPct(model.pending, model.total) },
            { label: "当前已选", count: model.selected, pct: UI.getViewPct(model.selected, model.total) },
        ];

        const timelineMarkup = model.timeline.length > 0
            ? `<div class="ldb-view-timeline">${model.timeline.map((item) => `
                <div class="ldb-view-timeline-item">
                    <div class="ldb-view-timeline-label">${item.label}</div>
                    <div class="ldb-view-bar-track"><div class="ldb-view-bar-fill" style="width: ${Math.max(8, UI.getViewPct(item.count, model.total))}%;"></div></div>
                    <div class="ldb-view-timeline-value">${item.count} 项 / 已导出 ${item.exported}</div>
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

    sanitizeObsidianFileName: (name, fallback = "untitled") => {
        return require("../import/github-obsidian-service").sanitizeObsidianFileName(name, fallback);
    },

    buildGitHubObsidianMarkdown: async (item, settings = {}) => {
        return require("../import/github-obsidian-service").buildGitHubObsidianMarkdown(item, settings);
    },

    exportGitHubSelectedToObsidian: async (selectedItems, settings, onProgress) => {
        const { exportGitHubSelectedToObsidian } = require("../import/github-obsidian-service");
        return exportGitHubSelectedToObsidian(selectedItems, settings, onProgress, {
            get isCancelled() { return Exporter.isCancelled; },
            get isPaused() { return Exporter.isPaused; },
        });
    },

    mapGitHubItemsToBookmarks: (items, sourceType) => {
        return require("../import/github-obsidian-service").mapGitHubItemsToBookmarks(items, sourceType);
    },

    exportGitHubSelected: async (selectedItems, settings, onProgress) => {
        return require("../import/github-obsidian-service").exportGitHubSelectedToNotion(selectedItems, settings, onProgress);
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
        const count = UI.selectedBookmarks?.size || 0;
        const pendingCount = UI.selectedUnexportedCount || 0;

        UI.refs.selectCount.textContent = `已选 ${count} 个，待导出 ${Math.max(0, pendingCount)} 个`;

        // 更新全选框状态
        const selectAll = UI.refs.selectAll
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
        UI.renderVisualSummary();
    },

    // 显示导出报告
    showReport: (results) => {
        const container = UI.refs.reportContainer
        const { success, failed, skipped } = results;

        let html = '<div class="ldb-report">';
        html += '<div class="ldb-report-title">📊 导出报告</div>';

        if (success.length > 0) {
            html += '<div class="ldb-report-section">';
            html += `<div class="ldb-report-section-title">✅ 成功 (${success.length})</div>`;
            success.slice(0, 10).forEach(item => {
                html += `<div class="ldb-report-item success">
                    <span>✓</span>
                    <a href="${Utils.escapeHtml(item.url)}" target="_blank">${Utils.escapeHtml(Utils.truncateText(item.title, 40))}</a>
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
            failed.slice(0, 20).forEach(item => {
                html += `<div class="ldb-report-item failed">
                    <span>✗</span>
                    <span>${Utils.escapeHtml(Utils.truncateText(item.title, 35))}</span>
                </div>`;
                html += `<div class="ldb-report-error">${Utils.escapeHtml(Utils.truncateText(item.error, 120))}</div>`;
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
                <span>由于取消操作，${skipped.length} 个收藏未导出</span>
            </div>`;
            html += '</div>';
        }

        html += '</div>';
        container.innerHTML = html;
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

        handle.onmousedown = (e) => {
            if (e.target.tagName === "BUTTON") return;
            isDragging = true;
            offsetX = e.clientX - element.offsetLeft;
            offsetY = e.clientY - element.offsetTop;
            document.body.style.userSelect = "none";
        };

        document.onmousemove = (e) => {
            if (!isDragging) return;
            const x = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, e.clientX - offsetX));
            const y = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, e.clientY - offsetY));
            element.style.left = x + "px";
            element.style.top = y + "px";
            element.style.right = "auto";
        };

        document.onmouseup = () => {
            isDragging = false;
            document.body.style.userSelect = "";
        };
    },

    maybePromptBookmarkExtensionInstall: () => {
        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        if (!isUserscriptMode) return;
        if (BookmarkBridge.isExtensionAvailable()) return;
        if (Storage.get(CONFIG.STORAGE_KEYS.EXT_INSTALL_PROMPT_SHOWN, false)) return;

        Storage.set(CONFIG.STORAGE_KEYS.EXT_INSTALL_PROMPT_SHOWN, true);
        const shouldInstallNow = window.confirm("检测到你尚未安装书签桥接扩展。\n\n是否现在打开安装页面？");
        if (shouldInstallNow) {
            InstallHelper.openBookmarkExtensionInstall();
        }
    },

    // 初始化
    init: () => {
        UI.injectStyles();
        UI.createPanel();
        UI.miniBtn = UI.createMiniButton();

        // 事件总线订阅（security 解耦后，oplog/notify 通过总线触达 UI）
        const { on } = require("../coordination/event-bus");
        on("oplog:changed", () => {
            if (UI.refs?.logPanel && !UI.refs.logPanel.classList.contains("collapsed")) {
                UI.updateLogPanel();
            }
        });
        on("notify", ({ message, type }) => {
            UI.showStatus(message, type);
        });
        on("sync:center-summary-updated", () => {
            if (typeof UI.renderSyncCenterSummary === "function") {
                try { UI.renderSyncCenterSummary(); } catch (e) { console.warn("[LD-Notion] 同步中心面板渲染失败:", e); }
            }
        });
        on("bookmarks:updated", () => {
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
        UI.panel?.remove();
        UI.panel = null;
        UI.miniBtn?.remove();
        UI.miniBtn = null;
        UI.refs = null;
        UI.isMinimized = true;
    },
};

Object.assign(UI, require("./workspace-visual").WorkspaceVisual);
Object.assign(UI, require("./bookmark-list").BookmarkList);
Object.assign(UI, require("./workspace-insight").WorkspaceInsight);

;

module.exports = { UI };
