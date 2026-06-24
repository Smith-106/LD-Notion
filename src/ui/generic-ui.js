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

const GenericUI = {
    panel: null,
    floatBtn: null,
    isExporting: false,

    // 注入样式
    injectStyles: () => {
        DesignSystem.ensureBase();
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.GENERIC, `
            /* LDB_UI_GENERIC */
            .gclip-float-btn {
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 48px;
                height: 48px;
                border-radius: var(--ldb-ui-radius-pill);
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: var(--ldb-ui-white);
                border: 1px solid var(--ldb-ui-focus-ring);
                cursor: pointer;
                box-shadow: var(--ldb-ui-shadow-sm);
                z-index: var(--ldb-ui-z-index-float);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: var(--ldb-ui-font-size-2xl);
                transition: transform 0.18s ease, box-shadow 0.18s ease;
                user-select: none;
            }

            .gclip-float-btn:hover {
                transform: translateY(-1px) scale(1.03);
                box-shadow: var(--ldb-ui-shadow);
            }

            .gclip-float-btn.exporting {
                background: linear-gradient(135deg, var(--ldb-ui-warning-bright), var(--ldb-ui-warning));
                border-color: rgba(217, 119, 6, 0.35);
                animation: gclip-pulse 1.2s infinite;
            }

            .gclip-float-btn.success {
                background: linear-gradient(135deg, var(--ldb-ui-success-bright), var(--ldb-ui-success));
                border-color: rgba(22, 163, 74, 0.35);
            }

            .gclip-float-btn.error {
                background: linear-gradient(135deg, var(--ldb-ui-danger-bright), var(--ldb-ui-danger));
                border-color: rgba(220, 38, 38, 0.35);
            }

            @keyframes gclip-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }

            .gclip-panel {
                position: fixed;
                bottom: 84px;
                right: 24px;
                width: 320px;
                max-width: calc(100vw - 32px);
                z-index: var(--ldb-ui-z-index-overlay);
                display: none;
                overflow: hidden;
                transform: translateY(12px);
                opacity: 0;
                transition: transform 0.22s ease, opacity 0.22s ease;
            }

            .gclip-panel.visible {
                display: block;
                transform: translateY(0);
                opacity: 1;
            }

            .gclip-panel-header {
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: var(--ldb-ui-white);
            }

            .gclip-panel-header .close-btn {
                border-color: rgba(255, 255, 255, 0.22);
                background: rgba(255, 255, 255, 0.14);
                color: var(--ldb-ui-white);
            }

            .gclip-panel-header .close-btn:hover {
                background: rgba(255, 255, 255, 0.22);
            }

            .gclip-preview {
                border: 1px solid var(--ldb-ui-border);
                border-radius: var(--ldb-ui-radius-md);
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
                background: rgba(148, 163, 184, 0.08);
                margin-bottom: var(--ldb-ui-spacing-xl);
            }

            .gclip-preview .title {
                font-size: var(--ldb-ui-font-size-md);
                font-weight: 700;
                line-height: 1.45;
                color: var(--ldb-ui-text);
            }

            .gclip-preview .meta {
                margin-top: var(--ldb-ui-spacing-xs);
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-muted);
            }

            .gclip-status {
                margin-top: var(--ldb-ui-spacing-lg);
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
                border-radius: var(--ldb-ui-radius-md);
                border: 1px solid var(--ldb-ui-border);
                font-size: var(--ldb-ui-font-size-sm);
                display: none;
            }

            .gclip-status.info {
                display: block;
                border-color: rgba(37, 99, 235, 0.30);
                background: rgba(37, 99, 235, 0.10);
                color: var(--ldb-ui-text);
            }

            .gclip-status.success {
                display: block;
                border-color: rgba(22, 163, 74, 0.35);
                background: rgba(22, 163, 74, 0.12);
                color: var(--ldb-ui-text);
            }

            .gclip-status.error {
                display: block;
                border-color: rgba(220, 38, 38, 0.35);
                background: rgba(220, 38, 38, 0.12);
                color: var(--ldb-ui-text);
            }

            .gclip-btn-primary {
                /* alias for .gclip-btn */
            }

            .gclip-btn-setup {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                color: var(--ldb-ui-text);
                font-weight: 650;
            }
        `);
    },

    // 创建浮动按钮
    createFloatButton: () => {
        const btn = document.createElement("button");
        btn.className = "gclip-float-btn";
        btn.setAttribute("data-ldb-root", "");
        btn.innerHTML = "📎";
        btn.title = "导出到 Notion";
        btn.setAttribute("aria-label", "导出到 Notion");
        btn.addEventListener("click", () => {
            if (GenericUI.isExporting) return;
            GenericUI.togglePanel();
        });
        document.body.appendChild(btn);
        GenericUI.floatBtn = btn;
        return btn;
    },

    // 创建设置面板
    createPanel: () => {
        const panel = document.createElement("div");
        panel.className = "gclip-panel";
        panel.setAttribute("data-ldb-root", "");

        const exportState = TargetState.getExportState();
        const apiKey = Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
        const dbId = exportState.databaseId;
        const parentPageId = exportState.parentPageId;
        const exportType = exportState.targetType;
        const imgMode = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
        const meta = GenericExtractor.extractMeta();

        // 根据导出类型判断是否已配置完成
        const targetId = exportType === "page" ? parentPageId : dbId;
        const isConfigured = !!(apiKey && targetId);

        panel.innerHTML = `
            <div class="gclip-panel-header">
                <span>📎 导出到 Notion</span>
                <button class="close-btn" id="gclip-close" aria-label="关闭导出面板">✕</button>
            </div>
            <div class="gclip-panel-body">
                <div class="gclip-preview">
                    <div class="title">${Utils.escapeHtml(meta.title)}</div>
                    <div class="meta">
                        ${meta.author ? `作者: ${Utils.escapeHtml(meta.author)}<br>` : ""}
                        ${meta.siteName ? `来源: ${Utils.escapeHtml(meta.siteName)}` : ""}
                        ${meta.publishDate ? ` · ${meta.publishDate}` : ""}
                    </div>
                </div>

                <div id="gclip-settings" style="display: ${isConfigured ? 'none' : 'block'};">
                    <div class="gclip-field">
                        <label>Notion API Key</label>
                        <div style="display:flex;align-items:center;gap:var(--ldb-ui-spacing-md);">
                            <input type="password" id="gclip-api-key-input" class="gclip-input" placeholder="${CredentialVault.getFieldPlaceholder(CONFIG.STORAGE_KEYS.NOTION_API_KEY, 'secret_...')}" value="" style="flex:1;font-size:var(--ldb-ui-font-size-sm);" autocomplete="off" />
                            <button class="gclip-btn" id="gclip-save-api-key" style="padding:var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-xl);font-size:var(--ldb-ui-font-size-sm);">保存</button>
                        </div>
                    </div>
                    <div class="gclip-field">
                        <label>Notion OAuth（公开集成）</label>
                        <input type="text" id="gclip-oauth-client-id" class="gclip-input" placeholder="Client ID">
                        <input type="password" id="gclip-oauth-client-secret" class="gclip-input" placeholder="Client Secret" style="margin-top:var(--ldb-ui-spacing-md);">
                        <input type="text" id="gclip-oauth-redirect-uri" class="gclip-input" placeholder="Redirect URI" style="margin-top:var(--ldb-ui-spacing-md);">
                        <div style="display:flex;gap:var(--ldb-ui-spacing-md);flex-wrap:wrap;margin-top:var(--ldb-ui-spacing-md);">
                            <button class="gclip-btn gclip-btn-primary" id="gclip-oauth-authorize" style="padding:var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-xl);font-size:var(--ldb-ui-font-size-sm);">🔐 一键授权</button>
                            <button class="gclip-btn gclip-btn-secondary" id="gclip-oauth-clear" style="padding:var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-xl);font-size:var(--ldb-ui-font-size-sm);">断开授权</button>
                        </div>
                        <div id="gclip-oauth-status" style="font-size:var(--ldb-ui-font-size-xs);color:var(--ldb-ui-muted);margin-top:var(--ldb-ui-spacing-sm);"></div>
                        <div style="display:flex;gap:var(--ldb-ui-spacing-md);flex-wrap:wrap;margin-top:var(--ldb-ui-spacing-md);">
                            <button class="gclip-btn gclip-btn-secondary" id="gclip-vault-unlock" style="padding:var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-xl);font-size:var(--ldb-ui-font-size-sm);">解锁保险箱</button>
                            <button class="gclip-btn gclip-btn-secondary" id="gclip-vault-lock" style="padding:var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-xl);font-size:var(--ldb-ui-font-size-sm);">锁定</button>
                        </div>
                        <div id="gclip-vault-status" style="font-size:var(--ldb-ui-font-size-xs);color:var(--ldb-ui-muted);margin-top:var(--ldb-ui-spacing-sm);"></div>
                        <div style="font-size:var(--ldb-ui-font-size-xs);color:var(--ldb-ui-muted);margin-top:var(--ldb-ui-spacing-xs);">公开 OAuth 适合个人自建集成；敏感凭证会保存在本地加密保险箱中。</div>
                    </div>
                    <div class="gclip-field">
                        <label>导出目标类型</label>
                        <select id="gclip-export-type">
                            <option value="database" ${exportType === "database" ? "selected" : ""}>数据库</option>
                            <option value="page" ${exportType === "page" ? "selected" : ""}>页面（子页面）</option>
                        </select>
                    </div>
                    <div class="gclip-field">
                        <label id="gclip-target-label">${exportType === "page" ? "父页面" : "数据库"}</label>
                        <div style="display:flex;align-items:center;gap:var(--ldb-ui-spacing-md);">
                            <select id="gclip-target-select" class="gclip-input" style="flex:1;">
                                <option value="">未选择</option>
                            </select>
                            <button class="gclip-btn" id="gclip-refresh-workspace" style="padding:var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-xl);font-size:var(--ldb-ui-font-size-sm);white-space:nowrap;">刷新</button>
                        </div>
                        <div id="gclip-target-tip" style="font-size:var(--ldb-ui-font-size-xs);color:var(--ldb-ui-muted);margin-top:var(--ldb-ui-spacing-xs);">优先从工作区列表选择，失败时可手动输入 ID</div>
                    </div>
                    <div class="gclip-field" id="gclip-manual-target-wrap" style="display:none;">
                        <label>手动输入 ID（高级）</label>
                        <input type="text" id="gclip-target-id" value="" placeholder="32位ID">
                    </div>
                    <div class="gclip-field" style="margin-top:-var(--ldb-ui-spacing-xs);">
                        <button class="gclip-btn gclip-btn-secondary" id="gclip-toggle-manual-target" style="padding:var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-lg);font-size:var(--ldb-ui-font-size-sm);">高级：手动输入 ID</button>
                    </div>
                    <div class="gclip-field">
                        <label>图片处理</label>
                        <select id="gclip-img-mode">
                            <option value="external" ${imgMode === "external" ? "selected" : ""}>外链引用</option>
                            <option value="upload" ${imgMode === "upload" ? "selected" : ""}>上传到 Notion</option>
                            <option value="skip" ${imgMode === "skip" ? "selected" : ""}>跳过图片</option>
                        </select>
                    </div>
                    <button class="gclip-btn gclip-btn-primary" id="gclip-save-settings">保存配置</button>
                </div>

                <button class="gclip-btn gclip-btn-primary" id="gclip-export" style="display: ${isConfigured ? 'block' : 'none'};">
                    导出当前页面
                </button>
                <button class="gclip-btn gclip-btn-secondary" id="gclip-obs-export" style="display: block;">
                    导出到 Obsidian
                </button>
                <button class="gclip-btn gclip-btn-setup" id="gclip-show-settings" style="display: ${isConfigured ? 'block' : 'none'};">
                    修改配置
                </button>

                <div class="gclip-status" id="gclip-status"></div>
            </div>
        `;

        document.body.appendChild(panel);
        GenericUI.panel = panel;

        // 绑定事件
        GenericUI.bindEvents();

        // 初始化导出目标 UI
        panel.querySelector("#gclip-export-type").value = exportType;
        panel.querySelector("#gclip-target-label").textContent = exportType === "page" ? "父页面" : "数据库";
        panel.querySelector("#gclip-target-id").value = targetId;

        const apiKeyForInit = NotionOAuth.getAccessToken();
        GenericUI.loadTargetOptionsFromCache(apiKeyForInit);
        if (apiKeyForInit) {
            GenericUI.refreshWorkspaceTargets(apiKeyForInit, true);
        }
        NotionOAuth.syncApiKeyInputs();
        return panel;
    },

    updateTargetSelectOptions: (databases = [], pages = []) => {
        const panel = GenericUI.panel;
        if (!panel) return;

        const select = panel.querySelector("#gclip-target-select");
        const exportType = panel.querySelector("#gclip-export-type")?.value || "database";
        if (!select) return;

        const exportState = TargetState.getExportState();
        const restoreValue = exportType === CONFIG.EXPORT_TARGET_TYPES.PAGE
            ? (exportState.parentPageId ? `page:${exportState.parentPageId}` : "")
            : exportState.databaseId;

        let options = '<option value="">未选择</option>';
        const known = new Set();

        if (exportType === "page") {
            const workspacePages = pages.filter(p => p.parent === "workspace");
            workspacePages.forEach(page => {
                const value = `page:${page.id}`;
                known.add(value);
                options += `<option value="${value}">📄 ${Utils.escapeHtml(page.title || "未命名页面")}</option>`;
            });
        } else {
            databases.forEach(db => {
                known.add(db.id);
                options += `<option value="${db.id}">📁 ${Utils.escapeHtml(db.title || "未命名数据库")}</option>`;
            });
        }

        if (restoreValue && !known.has(restoreValue)) {
            const shortId = restoreValue.replace(/^page:/, "");
            options += `<option value="${restoreValue}">已配置 (ID: ${shortId.slice(0, 8)}...)</option>`;
        }

        select.innerHTML = options;
        if (restoreValue) {
            select.value = restoreValue;
        }
    },

    refreshWorkspaceTargets: async (apiKey, silent = false) => {
        const panel = GenericUI.panel;
        if (!panel) return;

        const refreshBtn = panel.querySelector("#gclip-refresh-workspace");
        const tip = panel.querySelector("#gclip-target-tip");

        if (!apiKey) {
            if (!silent) GenericUI.showStatus(MSG.SETUP_NOTION_KEY, "error");
            return;
        }

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = "刷新中";
        }
        if (tip) {
            tip.textContent = "正在获取数据库列表...";
        }

        try {
            const { workspaceData } = await UICommandService.execute("refresh_workspace_targets", {
                apiKey,
                includePages: true,
                onProgress: (progress) => {
                    if (!tip) return;
                    if (progress.phase === "databases") {
                        tip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                    } else if (progress.phase === "pages") {
                        tip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                    }
                },
                onWorkspaceData: (workspaceData, meta) => {
                    GenericUI.updateTargetSelectOptions(workspaceData.databases, workspaceData.pages);
                    if (tip && meta.phase === "databases") {
                        tip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                    }
                },
            });

            GenericUI.updateTargetSelectOptions(workspaceData.databases, workspaceData.pages);
            if (tip) {
                tip.textContent = `已加载 ${workspaceData.databases.length} 个数据库，${workspaceData.pages.filter(p => p.parent === "workspace").length} 个页面`;
            }
        } catch (error) {
            if (tip) {
                tip.textContent = `加载失败：${error.message}`;
            }
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = "刷新";
            }
        }
    },

    loadTargetOptionsFromCache: (apiKey) => {
        const panel = GenericUI.panel;
        if (!panel) return;

        const tip = panel.querySelector("#gclip-target-tip");
        let databases = [];
        let pages = [];

        const raw = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
        try {
            const wsData = JSON.parse(raw);
            const keyHash = apiKey ? apiKey.slice(-8) : "";
            const cacheValid = !apiKey || !wsData.apiKeyHash || wsData.apiKeyHash === keyHash;
            if (cacheValid) {
                databases = wsData.databases || [];
                pages = wsData.pages || [];
            }
        } catch { /* workspace cache invalid */ }

        GenericUI.updateTargetSelectOptions(databases, pages);

        if (tip) {
            if (databases.length > 0 || pages.length > 0) {
                tip.textContent = "已加载缓存工作区列表，可点击刷新更新";
            } else {
                tip.textContent = "优先从工作区列表选择，失败时可手动输入 ID";
            }
        }
    },

    // 绑定面板事件
    bindEvents: () => {
        const panel = GenericUI.panel;

        // 关闭按钮
        panel.querySelector("#gclip-close").addEventListener("click", () => {
            GenericUI.togglePanel(false);
        });

        // 导出类型切换
        panel.querySelector("#gclip-export-type").addEventListener("change", () => {
            const isPage = panel.querySelector("#gclip-export-type").value === "page";
            panel.querySelector("#gclip-target-label").textContent = isPage ? "父页面" : "数据库";
            GenericUI.loadTargetOptionsFromCache(NotionOAuth.getAccessToken(panel.querySelector("#gclip-api-key-input").value.trim()));
        });

        // 刷新工作区目标列表
        panel.querySelector("#gclip-refresh-workspace").addEventListener("click", async () => {
            const keyInput = panel.querySelector("#gclip-api-key-input").value.trim();
            const apiKey = NotionOAuth.getAccessToken(keyInput);
            await GenericUI.refreshWorkspaceTargets(apiKey);
        });

        // 手动输入开关
        panel.querySelector("#gclip-toggle-manual-target").addEventListener("click", () => {
            const wrap = panel.querySelector("#gclip-manual-target-wrap");
            const visible = wrap.style.display !== "none";
            wrap.style.display = visible ? "none" : "block";
        });

        // 保存 API Key（从面板内密码输入框读取，避免使用可被宿主页面拦截的 prompt()）
        panel.querySelector("#gclip-save-api-key").addEventListener("click", async () => {
            const key = panel.querySelector("#gclip-api-key-input").value.trim();
            if (key) {
                try {
                    await NotionOAuth.setManualApiKey(key);
                    panel.querySelector("#gclip-api-key-input").value = "";
                    NotionOAuth.syncApiKeyInputs();
                    GenericUI.showStatus("API Key 已保存", "success");
                } catch (error) {
                    GenericUI.showStatus(`API Key 保存失败: ${error.message}`, "error");
                }
            } else {
                GenericUI.showStatus("请输入 API Key", "error");
            }
        });

        // 保存配置
        panel.querySelector("#gclip-save-settings").addEventListener("click", async () => {
            // 仅当用户主动输入了新 key 时才更新（不从 DOM 预填，防止泄漏）
            const liveKey = panel.querySelector("#gclip-api-key-input").value.trim();
            if (liveKey) {
                await NotionOAuth.setManualApiKey(liveKey);
                panel.querySelector("#gclip-api-key-input").value = "";
                NotionOAuth.syncApiKeyInputs();
            }
            const apiKey = NotionOAuth.getAccessToken();
            const exportType = panel.querySelector("#gclip-export-type").value;
            const selectValue = panel.querySelector("#gclip-target-select")?.value || "";
            const manualTargetId = panel.querySelector("#gclip-target-id").value.trim().replace(/-/g, "");
            const selectedTargetId = selectValue.startsWith("page:") ? selectValue.slice(5) : selectValue;
            const targetId = (selectedTargetId || manualTargetId).replace(/-/g, "");
            const imgMode = panel.querySelector("#gclip-img-mode").value;

            if (!apiKey) return GenericUI.showStatus(MSG.SETUP_NOTION_KEY, "error");
            if (!targetId) return GenericUI.showStatus("请先选择目标，或手动输入 ID", "error");

            if (exportType === "database") {
                GenericUI.showStatus("正在配置数据库属性...", "info");
            }
            const { setupResult } = await UICommandService.execute("save_command_boundary_settings", {
                scope: "generic-export-target",
                liveApiKey: liveKey,
                apiKey,
                exportType,
                targetId,
                imgMode,
                autoSetupDatabaseProperties: exportType === "database",
            });
            if (setupResult && !setupResult.success) {
                return GenericUI.showStatus(`配置失败: ${setupResult.message || setupResult.error}`, "error");
            }

            GenericUI.loadTargetOptionsFromCache(apiKey);

            GenericUI.showStatus("配置已保存", "success");
            panel.querySelector("#gclip-settings").style.display = "none";
            panel.querySelector("#gclip-export").style.display = "block";
            panel.querySelector("#gclip-show-settings").style.display = "block";
        });

        NotionOAuth.attachControls({
            root: panel,
            selectors: {
                clientIdInput: "#gclip-oauth-client-id",
                clientSecretInput: "#gclip-oauth-client-secret",
                redirectUriInput: "#gclip-oauth-redirect-uri",
                authorizeBtn: "#gclip-oauth-authorize",
                clearBtn: "#gclip-oauth-clear",
                statusEl: "#gclip-oauth-status",
            },
            notify: (message, type) => GenericUI.showStatus(message, type),
        });
        CredentialVault.attachControls({
            root: panel,
            selectors: {
                statusEl: "#gclip-vault-status",
                unlockBtn: "#gclip-vault-unlock",
                lockBtn: "#gclip-vault-lock",
            },
            notify: (message, type) => GenericUI.showStatus(message, type),
            onAfterSync: () => {
                NotionOAuth.syncApiKeyInputs();
            },
        });
        NotionOAuth.syncApiKeyInputs();

        // 显示设置（不在 DOM 中预填 API Key，防止第三方页面读取）
        panel.querySelector("#gclip-show-settings").addEventListener("click", () => {
            const settings = panel.querySelector("#gclip-settings");
            const showing = settings.style.display === "none";
            if (showing) {
                const exportState = TargetState.getExportState();
                const exportType = exportState.targetType;
                panel.querySelector("#gclip-export-type").value = exportType;
                panel.querySelector("#gclip-target-label").textContent = exportType === "page" ? "父页面" : "数据库";

                panel.querySelector("#gclip-target-id").value = exportState.targetId;

                const apiKey = NotionOAuth.getAccessToken();
                GenericUI.loadTargetOptionsFromCache(apiKey);
                if (apiKey) {
                    GenericUI.refreshWorkspaceTargets(apiKey, true);
                }
                NotionOAuth.syncApiKeyInputs();
                // API Key 不预填到 DOM，用户需手动输入或留空使用已保存配置
            }
            settings.style.display = showing ? "block" : "none";
        });

        // 导出按钮
        panel.querySelector("#gclip-export").addEventListener("click", () => {
            GenericUI.doExport();
        });

        // 导出到 Obsidian
        panel.querySelector("#gclip-obs-export").addEventListener("click", async () => {
            if (GenericUI.isExporting) return;
            GenericUI.isExporting = true;

            const obsUrl = Storage.get(CONFIG.STORAGE_KEYS.OBS_API_URL, CONFIG.DEFAULTS.obsApiUrl);
            const obsKey = Storage.get(CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            const obsDir = Storage.get(CONFIG.STORAGE_KEYS.OBS_DIR, CONFIG.DEFAULTS.obsDir);

            if (!obsUrl || !obsKey) {
                GenericUI.showStatus("请先配置 Obsidian API（在 LinuxDo 页面设置面板中）", "error");
                GenericUI.isExporting = false;
                return;
            }

            const btn = GenericUI.panel.querySelector("#gclip-obs-export");
            btn.disabled = true;
            btn.textContent = "导出中...";
            GenericUI.showStatus("正在提取页面内容...", "info");

            try {
                const content = SiteDetector.detect() === SiteDetector.SITES.ZHIHU
                    ? ZhihuAPI.extractContent()
                    : null;

                let md = "";
                let title = document.title || "未命名页面";

                if (content) {
                    title = content.title || title;
                    const meta = { title, url: location.href, author: content.author };
                    md = HTMLToMarkdown.buildFrontmatter(meta);
                    md += `> [!info] 页面信息\n> - **来源**: 知乎\n> - **链接**: [${title}](${location.href})\n> - **作者**: ${content.author || "未知"}\n> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;

                    if (content.detail) md += HTMLToMarkdown.convert(content.detail) + "\n\n";
                    if (content.html) md += HTMLToMarkdown.convert(content.html) + "\n\n";
                    if (content.answers) {
                        content.answers.forEach((ans, i) => {
                            md += `> [!note]+ #${i + 1} ${ans.author} · 👍 ${ans.voteCount}\n`;
                            const lines = HTMLToMarkdown.convert(ans.html || "").trim().split("\n");
                            md += lines.map(l => `> ${l}`).join("\n") + "\n\n";
                        });
                    }
                } else {
                    const meta = { title, url: location.href };
                    md = HTMLToMarkdown.buildFrontmatter(meta);
                    md += `> [!info] 页面信息\n> - **链接**: [${title}](${location.href})\n> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;
                    const body = document.querySelector("article") || document.querySelector("main") || document.body;
                    md += HTMLToMarkdown.convert(body.innerHTML) + "\n";
                }

                const fileName = title.replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
                const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${fileName}.md`, md);
                if (!noteResult.ok) throw new Error(noteResult.error);

                GenericUI.showStatus(`导出到 Obsidian 成功: ${title}`, "success");
            } catch (error) {
                GenericUI.showStatus(`Obsidian 导出失败: ${error.message}`, "error");
            } finally {
                GenericUI.isExporting = false;
                btn.disabled = false;
                btn.textContent = " 导出到 Obsidian";
            }
        });
    },

    // 执行导出
    doExport: async () => {
        if (GenericUI.isExporting) return;
        GenericUI.isExporting = true;

        const btn = GenericUI.panel.querySelector("#gclip-export");
        const floatBtn = GenericUI.floatBtn;
        btn.disabled = true;
        btn.textContent = "导出中...";
        floatBtn.className = "gclip-float-btn exporting";
        GenericUI.showStatus("正在提取页面内容...", "info");

        try {
            const apiKey = NotionOAuth.getAccessToken();
            const exportState = TargetState.getExportState();
            const imgMode = Storage.get(CONFIG.STORAGE_KEYS.IMG_MODE, CONFIG.DEFAULTS.imgMode);
            const aiSettings = AIAssistant.getSettings();

            const settings = {
                apiKey,
                exportTargetType: exportState.targetType,
                databaseId: exportState.databaseId,
                parentPageId: exportState.parentPageId,
                imgMode,
                aiApiKey: aiSettings?.aiApiKey || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: aiSettings?.aiService || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService),
                aiModel: aiSettings?.aiModel || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, ""),
                aiBaseUrl: aiSettings?.aiBaseUrl || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
                categories: aiSettings?.categories || Utils.parseAICategories(Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories)),
            };

            GenericUI.showStatus("正在导出到 Notion...", "info");
            const { page, meta } = await GenericExporter.exportCurrentPage(settings);

            floatBtn.className = "gclip-float-btn success";
            GenericUI.showStatus(`导出成功: ${meta.title}`, "success");

            // 3 秒后恢复按钮状态
            setTimeout(() => {
                floatBtn.className = "gclip-float-btn";
            }, 3000);
        } catch (error) {
            floatBtn.className = "gclip-float-btn error";
            GenericUI.showStatus(`导出失败: ${error.message}`, "error");
            setTimeout(() => {
                floatBtn.className = "gclip-float-btn";
            }, 3000);
        } finally {
            GenericUI.isExporting = false;
            btn.disabled = false;
            btn.textContent = "导出当前页面";
        }
    },

    // 显示状态
    showStatus: (message, type = "info") => {
        const el = GenericUI.panel.querySelector("#gclip-status");
        el.textContent = message;
        el.className = `gclip-status ${type}`;
    },

    // 切换面板显示
    togglePanel: (show) => {
        if (!GenericUI.panel) return;
        const isVisible = GenericUI.panel.classList.contains("visible");
        const shouldShow = show !== undefined ? show : !isVisible;
        if (shouldShow) {
            GenericUI.panel.style.display = "block";
            // 触发 reflow 使 transition 生效
            GenericUI.panel.offsetHeight;
            GenericUI.panel.classList.add("visible");
        } else {
            GenericUI.panel.classList.remove("visible");
            GenericUI.panel.addEventListener("transitionend", function handler() {
                if (!GenericUI.panel.classList.contains("visible")) {
                    GenericUI.panel.style.display = "none";
                }
                GenericUI.panel.removeEventListener("transitionend", handler);
            });
        }
    },

    // 初始化
    init: () => {
        // 非 HTML 文档（如 XML/RSS）无 body，跳过 UI 注入
        if (!document.body) return;
        GenericUI.injectStyles();
        GenericUI.createFloatButton();
        GenericUI.createPanel();

        // 面板可拉伸（左边+上边+左上角）
        PanelResize.makeResizable(GenericUI.panel, {
            edges: ["l", "t", "tl"],
            storageKey: CONFIG.STORAGE_KEYS.PANEL_SIZE_GENERIC,
            minWidth: 260,
            minHeight: 200,
        });
    },
};

;

module.exports = { GenericUI };
