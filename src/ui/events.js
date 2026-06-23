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

const UIEvents = {
    bindEvents: () => {
        const panel = UI.panel;
        const refs = UI.refs || {};
        const body = panel.querySelector(".ldb-body");
        const getInputValue = (input) => String(input?.value || "").trim();
        const getSensitiveValue = (input, key, defaultValue = "") => {
            const liveValue = getInputValue(input);
            if (liveValue) return liveValue;
            return String(Storage.get(key, defaultValue) || "").trim();
        };
        const persistSensitiveInput = async (input, key, { allowClear = true } = {}) => {
            const value = getInputValue(input);
            if (value) {
                await CredentialVault.set(key, value);
            } else if (allowClear) {
                await CredentialVault.clear(key);
            }
            syncSensitiveInputs();
            return value;
        };
        const syncSensitiveInputs = () => {
            NotionOAuth.syncApiKeyInputs();
            CredentialVault.syncSensitiveInput(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
            CredentialVault.syncSensitiveInput(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
            CredentialVault.syncSensitiveInput(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, "Obsidian Local REST API Key");
        };

        const isUserscriptMode = typeof GM_info !== "undefined" && !!GM_info.scriptHandler;
        const hasBridgeMarker = BookmarkBridge.isExtensionAvailable();
        if (refs.runtimeBadge) {
            refs.runtimeBadge.textContent = isUserscriptMode ? "Userscript" : "Extension";
            refs.runtimeBadge.classList.toggle("mode-userscript", isUserscriptMode);
            refs.runtimeBadge.classList.toggle("mode-extension", !isUserscriptMode);
            refs.runtimeBadge.title = isUserscriptMode
                ? "当前运行模式：Userscript（建议搭配 chrome-extension 书签桥接）"
                : "当前运行模式：Extension（独立扩展）";
        }

        if (isUserscriptMode && hasBridgeMarker && !Storage.get(CONFIG.STORAGE_KEYS.MODE_CONFLICT_TIP_SHOWN, false)) {
            Storage.set(CONFIG.STORAGE_KEYS.MODE_CONFLICT_TIP_SHOWN, true);
            UI.showStatus("检测到桥接扩展已注入。若你也安装了独立版 chrome-extension-full，请关闭其一以避免模式混用。", "info");
        }

        panel.addEventListener("wheel", (e) => {
            if (!body) return;
            const target = e.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.closest(".ldb-body")) return;
            if (target.closest("input, textarea, select, [contenteditable=\"true\"]")) return;
            if (e.deltaY === 0) return;
            body.scrollTop += e.deltaY;
            e.preventDefault();
        }, { passive: false });

        // 最小化
        refs.minimizeBtn.onclick = () => {
            panel.style.display = "none";
            UI.miniBtn.style.display = "flex";
            Storage.set(CONFIG.STORAGE_KEYS.PANEL_MINIMIZED, true);
        };

        // 关闭
        refs.closeBtn.onclick = () => {
            panel.remove();
            UI.miniBtn.remove();
        };

        // 主题切换
        refs.themeToggleBtn.onclick = () => {
            DesignSystem.toggleTheme();
        };

        // Tab 切换
        refs.tabs.forEach(tab => {
            tab.onclick = () => {
                const tabName = tab.getAttribute("data-tab");
                // 更新 tab 按钮状态
                refs.tabs.forEach(t => {
                    t.classList.remove("active");
                    t.setAttribute("aria-selected", "false");
                });
                tab.classList.add("active");
                tab.setAttribute("aria-selected", "true");
                // 更新 tab 内容显示
                refs.tabContents.forEach(c => c.classList.remove("active"));
                const content = panel.querySelector(`[data-tab-content="${tabName}"]`);
                if (content) content.classList.add("active");
                // 持久化
                Storage.set(CONFIG.STORAGE_KEYS.ACTIVE_TAB, tabName);
            };
        });

        // 恢复上次选择的 tab
        const savedTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, CONFIG.DEFAULTS.activeTab);
        const tabBtn = panel.querySelector(`.ldb-tab[data-tab="${savedTab}"]`);
        if (tabBtn) tabBtn.click();

        // 折叠筛选设置
        refs.filterToggle.onclick = () => {
            const content = refs.filterContent
            const arrow = refs.filterArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            refs.filterToggle.setAttribute("aria-expanded", !content.classList.contains("collapsed"));
        };

        // 折叠 AI 设置
        refs.aiSettingsToggle.onclick = () => {
            const content = refs.aiSettingsContent
            const arrow = refs.aiSettingsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            refs.aiSettingsToggle.setAttribute("aria-expanded", !content.classList.contains("collapsed"));
        };

        // 折叠 GitHub 设置
        refs.githubSettingsToggle.onclick = () => {
            const content = refs.githubSettingsContent
            const arrow = refs.githubSettingsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            refs.githubSettingsToggle.setAttribute("aria-expanded", !content.classList.contains("collapsed"));
        };

        // 折叠 Obsidian 设置
        refs.obsSettingsToggle.onclick = () => {
            const content = refs.obsSettingsContent;
            const arrow = refs.obsSettingsArrow;
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            refs.obsSettingsToggle.setAttribute("aria-expanded", !content.classList.contains("collapsed"));
        };

        // Obsidian 测试连接
        refs.obsTestBtn.onclick = async () => {
            const url = refs.obsApiUrlInput.value.trim();
            const key = getSensitiveValue(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            if (!url || !key) {
                refs.obsTestStatus.innerHTML = '<span style="color: var(--ldb-ui-danger);">请填写 API 地址和 Key</span>';
                return;
            }
            refs.obsTestStatus.innerHTML = '<span style="color: var(--ldb-ui-accent);">连接中...</span>';
            try {
                const result = await ObsidianAPI.testConnection(url, key);
                if (result.ok) {
                    refs.obsTestStatus.innerHTML = '<span style="color: var(--ldb-ui-success);">✅ 连接成功</span>';
                } else {
                    refs.obsTestStatus.innerHTML = `<span style="color: var(--ldb-ui-danger);">❌ ${Utils.escapeHtml(result.error)}</span>`;
                }
            } catch (e) {
                refs.obsTestStatus.innerHTML = `<span style="color: var(--ldb-ui-danger);">❌ ${Utils.escapeHtml(e.message)}</span>`;
            }
        };

        refs.sourceSettingsToggle.onclick = () => {
            const content = refs.sourceSettingsContent
            const arrow = refs.sourceSettingsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            refs.sourceSettingsToggle.setAttribute("aria-expanded", !content.classList.contains("collapsed"));
        };

        refs.sourcePartitionsToggle.onclick = () => {
            const content = refs.sourcePartitionsContent
            const arrow = refs.sourcePartitionsArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            refs.sourcePartitionsToggle.setAttribute("aria-expanded", !content.classList.contains("collapsed"));
        };

        // 折叠区域键盘支持（Enter/Space 触发 click）
        [refs.filterToggle, refs.aiSettingsToggle, refs.githubSettingsToggle,
         refs.obsSettingsToggle, refs.sourceSettingsToggle, refs.sourcePartitionsToggle
        ].forEach(el => {
            if (!el) return;
            el.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    el.click();
                }
            });
        });

        refs.sourceSelectLinuxdo.onclick = () => {
            UI.switchBookmarkSource("linuxdo");
        };

        refs.sourceSelectGithub.onclick = () => {
            UI.switchBookmarkSource("github");
        };

        refs.openGithubSettingsBtn.onclick = () => {
            const settingsTab = panel.querySelector('.ldb-tab[data-tab="settings"]');
            if (settingsTab && !settingsTab.classList.contains("active")) {
                settingsTab.click();
            }
            const content = refs.githubSettingsContent
            const arrow = refs.githubSettingsArrow
            const tokenInput = refs.githubTokenInput
            if (content?.classList.contains("collapsed")) {
                content.classList.remove("collapsed");
                if (arrow) arrow.textContent = "▼";
            }
            if (tokenInput) {
                tokenInput.scrollIntoView({ block: "center", behavior: "smooth" });
                tokenInput.focus();
            }
            UI.showStatus("已定位到 GitHub Token 设置", "info");
        };

        refs.selfCheckBtn.onclick = () => {
            UI.renderSelfCheckResult();
            UI.showStatus("自检已完成", "info");
        };

        refs.copyDiagBtn.onclick = async () => {
            await UI.copyDiagnostics();
        };

        // 导出目标类型切换
        const handleExportTargetChange = (e) => {
            const targetType = e.target.value;
            const parentPageGroup = refs.parentPageGroup
            const manualDbWrap = refs.manualDbWrap
            const exportTargetTip = refs.exportTargetTip

            if (targetType === "page") {
                parentPageGroup.style.display = "block";
                manualDbWrap.style.display = "none";
                exportTargetTip.textContent = "导出为子页面，包含完整内容";
            } else {
                parentPageGroup.style.display = "none";
                manualDbWrap.style.display = "none";
                exportTargetTip.textContent = "导出为数据库条目，支持筛选和排序";
            }

            void UICommandService.execute("set_export_target_state", { targetType });
        };

        refs.exportTargetDatabaseRadio.onchange = handleExportTargetChange;
        refs.exportTargetPageRadio.onchange = handleExportTargetChange;

        // 父页面 ID 自动保存
        refs.parentPageIdInput.onchange = (e) => {
            void UICommandService.execute("set_export_target_state", {
                targetType: CONFIG.EXPORT_TARGET_TYPES.PAGE,
                parentPageId: e.target.value.trim(),
            });
        };

        // 验证配置
        refs.validateConfigBtn.onclick = async () => {
            const btn = refs.validateConfigBtn
            const statusSpan = refs.configStatus
            const liveApiKey = refs.apiKeyInput.value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
            const databaseId = refs.databaseIdInput.value.trim();
            const parentPageId = refs.parentPageIdInput.value.trim();

            // 清除之前的状态
            statusSpan.textContent = "";
            statusSpan.style.color = "";

            if (!apiKey) {
                UI.showStatus("请填写 API Key", "error");
                return;
            }

            if (exportTargetType === "database" && !databaseId) {
                UI.showStatus("请填写数据库 ID", "error");
                return;
            }

            if (exportTargetType === "page" && !parentPageId) {
                UI.showStatus("请填写父页面 ID", "error");
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 验证中...';

            try {
                const result = await UICommandService.execute("validate_export_target", {
                    apiKey,
                    liveApiKey,
                    exportTargetType,
                    databaseId,
                    parentPageId,
                });

                if (result.valid) {
                    statusSpan.textContent = "✅ 验证成功";
                    statusSpan.style.color = "var(--ldb-ui-success)";
                }

                if (!result.valid) {
                    statusSpan.textContent = `❌ ${result.error}`;
                    statusSpan.style.color = "var(--ldb-ui-danger)";
                }
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "var(--ldb-ui-danger)";
            } finally {
                btn.disabled = false;
                btn.innerHTML = "验证配置";
            }
        };

        // 自动设置数据库属性
        refs.setupDatabaseBtn.onclick = async () => {
            const liveApiKey = refs.apiKeyInput.value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const databaseId = refs.databaseIdInput.value.trim();
            const statusSpan = refs.configStatus

            // 清除之前的状态
            statusSpan.textContent = "";
            statusSpan.style.color = "";

            if (!apiKey) {
                UI.showStatus("请先填写 API Key", "error");
                return;
            }

            if (!databaseId) {
                UI.showStatus("请先填写数据库 ID", "error");
                return;
            }

            const btn = refs.setupDatabaseBtn
            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 设置中...';

            try {
                const result = await UICommandService.execute("setup_export_database_properties", {
                    apiKey,
                    liveApiKey,
                    databaseId,
                });
                if (result.success) {
                    statusSpan.textContent = `✅ ${result.message}`;
                    statusSpan.style.color = "var(--ldb-ui-success)";
                } else {
                    statusSpan.textContent = `❌ ${result.error}`;
                    statusSpan.style.color = "var(--ldb-ui-danger)";
                }
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "var(--ldb-ui-danger)";
            } finally {
                btn.disabled = false;
                btn.innerHTML = "自动设置数据库";
            }
        };

        // 自动导入设置
        refs.autoImportEnabled.onchange = (e) => {
            const enabled = e.target.checked;
            const cfg = UI.getAutoImportConfigBySource();
            Storage.set(cfg.enabledKey, enabled);
            refs.autoImportOptions.style.display = enabled ? "block" : "none";
            if (enabled) {
                if (cfg.isGitHub) {
                    GitHubAutoImporter.run();
                    const interval = parseInt(refs.autoImportInterval.value) || 0;
                    Storage.set(cfg.intervalKey, interval);
                    if (interval > 0) GitHubAutoImporter.startPolling(interval);
                    return;
                }

                // 检查 Notion 配置是否完整
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                if (!apiKey) {
                    AutoImporter.updateStatus("⚠️ 请先配置 Notion API Key");
                    return;
                }
                const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
                if (exportTargetType === "database" && !refs.databaseIdInput.value.trim()) {
                    AutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                    return;
                }
                if (exportTargetType === "page" && !refs.parentPageIdInput.value.trim()) {
                    AutoImporter.updateStatus("⚠️ 请先配置父页面 ID");
                    return;
                }
                AutoImporter.run();
                const interval = parseInt(refs.autoImportInterval.value) || 0;
                Storage.set(cfg.intervalKey, interval);
                if (interval > 0) AutoImporter.startPolling(interval);
            } else {
                if (cfg.isGitHub) {
                    GitHubAutoImporter.stopPolling();
                    GitHubAutoImporter.updateStatus("");
                } else {
                    AutoImporter.stopPolling();
                    AutoImporter.updateStatus("");
                }
            }
        };

        refs.autoImportInterval.onchange = (e) => {
            const interval = parseInt(e.target.value) || 0;
            const cfg = UI.getAutoImportConfigBySource();

            Storage.set(cfg.intervalKey, interval);
            if (cfg.isGitHub) {
                GitHubAutoImporter.stopPolling();
                if (interval > 0 && Storage.get(cfg.enabledKey, false)) {
                    GitHubAutoImporter.startPolling(interval);
                }
            } else {
                AutoImporter.stopPolling();
                if (interval > 0 && Storage.get(cfg.enabledKey, false)) {
                    AutoImporter.startPolling(interval);
                }
            }
        };

        refs.bookmarkAutoImportEnabled.onchange = (e) => {
            const enabled = !!e.target.checked;
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, enabled);
            refs.bookmarkAutoImportOptions.style.display = enabled ? "block" : "none";

            if (enabled) {
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
                if (!BookmarkBridge.isExtensionAvailable()) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先安装并启用书签桥接扩展");
                    return;
                }
                if (!apiKey) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先配置 Notion API Key");
                    return;
                }
                if (exportTargetType !== "database") {
                    BookmarkAutoImporter.updateStatus("⚠️ 浏览器书签自动同步仅支持导出到 Notion 数据库");
                    return;
                }
                if (!refs.databaseIdInput.value.trim()) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                    return;
                }

                const interval = parseInt(refs.bookmarkAutoImportInterval.value, 10) || 0;
                Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, interval);
                BookmarkAutoImporter.run();
                if (interval > 0) BookmarkAutoImporter.startPolling(interval);
            } else {
                BookmarkAutoImporter.stopPolling();
                BookmarkAutoImporter.updateStatus("");
            }
        };

        refs.bookmarkAutoImportInterval.onchange = (e) => {
            const interval = parseInt(e.target.value, 10) || 0;
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_INTERVAL, interval);
            BookmarkAutoImporter.stopPolling();
            if (interval > 0 && Storage.get(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, false)) {
                BookmarkAutoImporter.startPolling(interval);
            }
        };

        refs.rssFeedUrlsInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.RSS_FEED_URLS, e.target.value.trim());
        };

        refs.rssAutoImportEnabled.onchange = (e) => {
            const enabled = !!e.target.checked;
            Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, enabled);
            refs.rssAutoImportOptions.style.display = enabled ? "block" : "none";

            if (enabled) {
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
                if (!apiKey) {
                    RSSAutoImporter.updateStatus("❌ 请先配置 Notion API Key");
                    return;
                }
                if (exportTargetType !== "database") {
                    RSSAutoImporter.updateStatus("❌ RSS 自动同步仅支持导出到 Notion 数据库");
                    return;
                }
                if (!refs.databaseIdInput.value.trim()) {
                    RSSAutoImporter.updateStatus("❌ 请先配置 Notion 数据库 ID");
                    return;
                }
                if (RSSAutoImporter.getFeedUrls(refs.rssFeedUrlsInput.value).length === 0) {
                    RSSAutoImporter.updateStatus("❌ 请先配置至少一个 RSS Feed URL");
                    return;
                }

                const interval = parseInt(refs.rssAutoImportInterval.value, 10) || 0;
                Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, interval);
                RSSAutoImporter.run();
                if (interval > 0) RSSAutoImporter.startPolling(interval);
            } else {
                RSSAutoImporter.stopPolling();
                RSSAutoImporter.updateStatus("");
            }
        };

        refs.rssAutoImportInterval.onchange = (e) => {
            const interval = parseInt(e.target.value, 10) || 0;
            Storage.set(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_INTERVAL, interval);
            RSSAutoImporter.stopPolling();
            if (interval > 0 && Storage.get(CONFIG.STORAGE_KEYS.RSS_AUTO_IMPORT_ENABLED, false)) {
                RSSAutoImporter.startPolling(interval);
            }
        };

        refs.rssDedupModeSelect.onchange = (e) => {
            const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
            Storage.set(CONFIG.STORAGE_KEYS.RSS_IMPORT_DEDUP_MODE, mode);
        };

        refs.linuxdoDedupModeSelect.onchange = (e) => {
            const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
            Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, mode);
            UI.recomputeExportStats();
            UI.renderBookmarkList();
        };

        refs.bookmarkDedupModeSelect.onchange = (e) => {
            const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_IMPORT_DEDUP_MODE, mode);
        };

        refs.aiCategoryAutoDedupCheckbox.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORY_AUTO_DEDUP, !!e.target.checked);
        };

        refs.crossSourceModeSelect.onchange = (e) => {
            const mode = e.target.value === "unified" ? "unified" : "separate";
            Storage.set(CONFIG.STORAGE_KEYS.CROSS_SOURCE_MODE, mode);
        };

        refs.updateCheckBtn.onclick = async () => {
            await UpdateChecker.check({ manual: true });
        };

        refs.updateAutoEnabled.onchange = (e) => {
            const enabled = e.target.checked;
            const optionsEl = refs.updateAutoOptions
            optionsEl.style.display = enabled ? "block" : "none";
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, enabled);

            if (enabled) {
                const hours = parseInt(refs.updateIntervalHours.value, 10)
                    || CONFIG.DEFAULTS.updateCheckIntervalHours;
                Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, hours);
                UpdateChecker.check({ manual: false });
                UpdateChecker.startPolling(hours);
            } else {
                UpdateChecker.stopPolling();
            }
        };

        refs.updateIntervalHours.onchange = (e) => {
            const hours = parseInt(e.target.value, 10) || CONFIG.DEFAULTS.updateCheckIntervalHours;
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, hours);
            if (Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled)) {
                UpdateChecker.startPolling(hours);
            }
        };

        UI.switchBookmarkSource = (source) => {
            const resolvedSource = source === "github" ? "github" : "linuxdo";
            Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_SOURCE, resolvedSource);
            UI.applyBookmarkSourceUI(resolvedSource);
            UI.renderSelfCheckResult();
            UI.bookmarks = [];
            UI.selectedBookmarks = new Set();
            UI.recomputeExportStats();
            UI.refs.bookmarkCount.textContent = "-";
            UI.refs.exportBtn.disabled = true;
            UI.refs.obsExportBtn.disabled = true;
            UI.refs.bookmarkListContainer.style.display = "none";
            UI.renderBookmarkList();

            const cfg = UI.getAutoImportConfigBySource();
            const autoImportEnabled = Storage.get(cfg.enabledKey, cfg.enabledDefault);
            const autoImportEnabledEl = refs.autoImportEnabled
            const autoImportOptionsEl = refs.autoImportOptions
            const intervalEl = refs.autoImportInterval
            autoImportEnabledEl.checked = autoImportEnabled;
            autoImportOptionsEl.style.display = autoImportEnabled ? "block" : "none";
            intervalEl.value = String(Storage.get(cfg.intervalKey, cfg.intervalDefault));
            if (intervalEl.selectedIndex === -1) {
                intervalEl.value = String(cfg.intervalDefault);
                Storage.set(cfg.intervalKey, cfg.intervalDefault);
            }
            UI.renderVisualSummary();
        };

        // 收藏列表事件委托（避免每次重渲染重复绑定）
        if (!UI.bookmarkListBound) {
            const bookmarkList = UI.refs.bookmarkList;
            bookmarkList.addEventListener("click", (e) => {
                const reexportBtn = e.target.closest("[data-bookmark-action=\"reexport\"]");
                if (reexportBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = reexportBtn.closest(".ldb-bookmark-item");
                    const bookmarkKey = String(item?.dataset.topicId || "");
                    if (bookmarkKey) {
                        UI.requeueLinuxDoBookmark(bookmarkKey);
                    }
                    return;
                }

                const item = e.target.closest(".ldb-bookmark-item");
                if (!item) return;
                if (e.target.tagName === "INPUT") return;

                const checkbox = item.querySelector('input[type="checkbox"]');
                if (!checkbox || checkbox.disabled) return;

                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            });

            bookmarkList.addEventListener("change", (e) => {
                const checkbox = e.target;
                if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox") return;

                const item = checkbox.closest(".ldb-bookmark-item");
                if (!item) return;

                const bookmarkKey = String(item.dataset.topicId || "");
                if (!bookmarkKey) return;

                const isUnexported = !UI.isBookmarkKeyExported(bookmarkKey);

                if (checkbox.checked) {
                    UI.selectedBookmarks.add(bookmarkKey);
                    if (isUnexported) UI.selectedUnexportedCount++;
                } else {
                    UI.selectedBookmarks.delete(bookmarkKey);
                    if (isUnexported) UI.selectedUnexportedCount = Math.max(0, UI.selectedUnexportedCount - 1);
                }
                UI.updateSelectCount();
            });

            UI.bookmarkListBound = true;
        }

        // 加载收藏
        refs.loadBookmarksBtn.onclick = async () => {
            const btn = refs.loadBookmarksBtn
            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 加载中...';

            try {
                let bookmarks = [];

                if (UI.isActiveGitHubSource()) {
                    const username = refs.githubUsernameInput.value.trim()
                        || Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
                    const token = getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "");
                    const types = GitHubAPI.getImportTypes();

                    if (!username && !token) {
                        UI.showStatus("请先在设置中填写 GitHub 用户名（或配置 Token）", "error");
                        return;
                    }

                    const allItems = [];
                    for (const type of types) {
                        if (type === "stars") {
                            const items = await GitHubAPI.fetchStarredRepos(username, token);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(items, "stars"));
                        } else if (type === "repos") {
                            const items = await GitHubAPI.fetchUserRepos(username, token);
                            const ownRepos = items.filter(r => !r.fork);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(ownRepos, "repos"));
                        } else if (type === "forks") {
                            const items = await GitHubAPI.fetchForkedRepos(username, token);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(items, "forks"));
                        } else if (type === "gists") {
                            const items = await GitHubAPI.fetchUserGists(username, token);
                            allItems.push(...UI.mapGitHubItemsToBookmarks(items, "gists"));
                        }
                        UI.refs.bookmarkCount.textContent = allItems.length;
                    }
                    bookmarks = allItems;
                } else {
                    const username = Utils.getCurrentLinuxDoUsername();
                    if (!username) {
                        UI.showStatus("无法获取当前 Linux.do 用户名，请先登录后重试", "error");
                        return;
                    }
                    bookmarks = await LinuxDoAPI.fetchAllBookmarks(username, (count) => {
                        UI.refs.bookmarkCount.textContent = count;
                    });
                }

                UI.bookmarks = bookmarks;
                UI.updateVisualSnapshot(UI.getActiveBookmarkSource(), bookmarks);
                UI.selectedBookmarks = new Set(bookmarks.map(b => UI.getBookmarkKey(b)));
                UI.recomputeExportStats();
                UI.refs.bookmarkCount.textContent = bookmarks.length;
                UI.refs.exportBtn.disabled = false;
                UI.refs.obsExportBtn.disabled = false;

                // 渲染收藏列表
                UI.renderBookmarkList();
                UI.refs.bookmarkListContainer.style.display = "block";

                const sourceText = UI.isActiveGitHubSource() ? "GitHub 收藏" : "Linux.do 收藏";
                UI.showStatus(`成功加载 ${bookmarks.length} 个${sourceText}`, "success");
            } catch (error) {
                UI.showStatus(`加载失败: ${error.message}`, "error");
            } finally {
                btn.disabled = false;
                btn.innerHTML = "🔄 加载收藏列表";
            }
        };

        refs.importBrowserBookmarksBtn.onclick = async () => {
            const btn = refs.importBrowserBookmarksBtn
            const source = UI.getActiveBookmarkSource();
            if (source !== "linuxdo") {
                UI.switchBookmarkSource("linuxdo");
                const toggle = refs.sourceSettingsToggle
                const content = refs.sourceSettingsContent
                if (toggle && content?.classList.contains("collapsed")) {
                    toggle.click();
                }
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 导入中...';
            try {
                const chatInput = panel.querySelector("#ldb-chat-input");
                if (chatInput && typeof ChatUI !== "undefined" && ChatUI.sendMessage) {
                    chatInput.value = "导入浏览器书签";
                    ChatUI.sendMessage();
                } else {
                    UI.showStatus("AI 面板未就绪，请稍后重试", "error");
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = "📖 导入浏览器书签";
            }
        };

        // 全选/取消
        refs.selectAll.onchange = (e) => {
            const checked = e.target.checked;
            if (checked) {
                UI.selectedBookmarks = new Set(UI.bookmarks.map(b => UI.getBookmarkKey(b)));
            } else {
                UI.selectedBookmarks = new Set();
            }
            UI.recomputeExportStats();
            UI.syncRenderedSelectionState();
            UI.updateSelectCount();
        };

        // 暂停按钮
        refs.pauseBtn.onclick = () => {
            const pauseBtn = refs.pauseBtn
            if (Exporter.isPaused) {
                Exporter.resume();
                pauseBtn.innerHTML = "⏸️ 暂停";
                pauseBtn.classList.remove("ldb-btn-primary");
                pauseBtn.classList.add("ldb-btn-warning");
            } else {
                Exporter.pause();
                pauseBtn.innerHTML = "▶️ 继续";
                pauseBtn.classList.remove("ldb-btn-warning");
                pauseBtn.classList.add("ldb-btn-primary");
            }
        };

        // 取消按钮
        refs.cancelBtn.onclick = () => {
            if (confirm("确定要取消导出吗？已导出的内容不会被删除。")) {
                Exporter.cancel();
            }
        };

        // 开始导出
        refs.exportBtn.onclick = async () => {
            // 防重入：导出进行中时忽略重复点击
            if (refs.exportBtn.disabled) return;
            const liveApiKey = refs.apiKeyInput.value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
            const databaseId = refs.databaseIdInput.value.trim();
            const parentPageId = refs.parentPageIdInput.value.trim();

            if (!apiKey) {
                UI.showStatus("请先配置 Notion API Key", "error");
                return;
            }

            if (exportTargetType === "database" && !databaseId) {
                UI.showStatus("请先配置数据库 ID", "error");
                return;
            }

            if (exportTargetType === "page" && !parentPageId) {
                UI.showStatus("请先配置父页面 ID", "error");
                return;
            }

            if (!UI.bookmarks || UI.bookmarks.length === 0) {
                UI.showStatus("请先加载收藏列表", "error");
                return;
            }

            // 获取选中的收藏（严格模式过滤已导出，允许重复模式仅按勾选）
            const toExport = UI.bookmarks.filter((b) => {
                const bookmarkKey = UI.getBookmarkKey(b);
                return UI.selectedBookmarks.has(bookmarkKey) && !UI.isBookmarkKeyExported(bookmarkKey);
            });

            if (toExport.length === 0) {
                UI.showStatus("没有可导出的收藏（可能都已导出过或未选中）", "info");
                return;
            }

            const settings = {
                apiKey,
                databaseId,
                parentPageId,
                exportTargetType,
                onlyFirst: refs.onlyFirstCheckbox.checked,
                onlyOp: refs.onlyOpCheckbox.checked,
                rangeStart: parseInt(refs.rangeStartInput.value) || 1,
                rangeEnd: parseInt(refs.rangeEndInput.value) || 999999,
                imgMode: refs.imgModeSelect.value,
                concurrency: parseInt(refs.exportConcurrencySelect.value) || 1,
                aiApiKey: getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: refs.aiServiceSelect.value,
                aiModel: refs.aiModelSelect.value,
                aiBaseUrl: refs.aiBaseUrlInput.value.trim(),
                categories: Utils.parseAICategories(
                    refs.aiCategoriesInput.value.trim() || ""
                ),
                githubUsername: refs.githubUsernameInput.value.trim(),
                token: getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
                imgFilter: refs.filterImgSelect.value,
                filterUsers: refs.filterUsersInput.value.trim(),
                filterInclude: refs.filterIncludeInput.value.trim(),
                filterExclude: refs.filterExcludeInput.value.trim(),
                filterMinLen: parseInt(refs.filterMinLenInput.value) || 0,
            };

            // 保存设置
            await UICommandService.execute("save_command_boundary_settings", {
                scope: "main-export-session",
                liveApiKey,
                exportState: {
                    targetType: exportTargetType,
                    databaseId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.DATABASE ? databaseId : undefined,
                    parentPageId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? parentPageId : undefined,
                },
                storageValues: {
                    [CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST]: settings.onlyFirst,
                    [CONFIG.STORAGE_KEYS.FILTER_ONLY_OP]: settings.onlyOp,
                    [CONFIG.STORAGE_KEYS.FILTER_RANGE_START]: settings.rangeStart,
                    [CONFIG.STORAGE_KEYS.FILTER_RANGE_END]: settings.rangeEnd,
                    [CONFIG.STORAGE_KEYS.FILTER_IMG]: settings.imgFilter,
                    [CONFIG.STORAGE_KEYS.FILTER_USERS]: settings.filterUsers,
                    [CONFIG.STORAGE_KEYS.FILTER_INCLUDE]: settings.filterInclude,
                    [CONFIG.STORAGE_KEYS.FILTER_EXCLUDE]: settings.filterExclude,
                    [CONFIG.STORAGE_KEYS.FILTER_MINLEN]: settings.filterMinLen,
                    [CONFIG.STORAGE_KEYS.IMG_MODE]: settings.imgMode,
                    [CONFIG.STORAGE_KEYS.REQUEST_DELAY]: parseInt(refs.requestDelaySelect.value),
                    [CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY]: settings.concurrency,
                },
                sensitiveEntries: {
                    [CONFIG.STORAGE_KEYS.AI_API_KEY]: getInputValue(refs.aiApiKeyInput),
                    [CONFIG.STORAGE_KEYS.GITHUB_TOKEN]: getInputValue(refs.githubTokenInput),
                },
            });

            // 显示控制按钮，隐藏导出按钮
            refs.exportBtn.disabled = true;
            refs.exportBtns.style.display = "none";
            refs.controlBtns.style.display = "flex";
            refs.pauseBtn.innerHTML = "⏸️ 暂停";
            refs.pauseBtn.classList.add("ldb-btn-warning");
            refs.pauseBtn.classList.remove("ldb-btn-primary");

            // 清空之前的报告
            UI.refs.reportContainer.innerHTML = "";

            try {
                let results;
                if (UI.isActiveGitHubSource()) {
                    results = await UI.exportGitHubSelected(toExport, settings, (current, total, title) => {
                        UI.showProgress(current, total, `${title}\n导出中`);
                    });
                } else {
                    results = await Exporter.exportBookmarks(toExport, settings, (progress) => {
                        UI.showProgress(
                            progress.current,
                            progress.total,
                            `${progress.title}\n${progress.message || progress.stage}${progress.isPaused ? " (已暂停)" : ""}`
                        );
                    });
                }

                UI.hideProgress();

                // 显示导出报告
                UI.showReport(results);

                // 刷新列表状态
                UI.renderBookmarkList();

                const successCount = results.success.length;
                const failCount = results.failed.length;
                const skippedCount = results.skipped?.length || 0;

                let statusMsg = `导出完成：成功 ${successCount} 个`;
                if (failCount > 0) statusMsg += `，失败 ${failCount} 个`;
                if (skippedCount > 0) statusMsg += `，跳过 ${skippedCount} 个`;

                UI.showStatus(statusMsg, failCount > successCount ? "error" : "success");

                // 通知
                if (typeof GM_notification === "function") {
                    GM_notification({
                        title: "导出完成",
                        text: statusMsg,
                        timeout: 5000,
                    });
                }
            } catch (error) {
                UI.showStatus(`导出出错: ${error.message}`, "error");
            } finally {
                // 恢复按钮状态
                refs.exportBtn.disabled = false;
                refs.exportBtns.style.display = "flex";
                refs.controlBtns.style.display = "none";
                Exporter.reset();
            }
        };

        // 导出到 Obsidian
        refs.obsExportBtn.onclick = async () => {
            if (refs.obsExportBtn.disabled) return;
            const obsUrl = refs.obsApiUrlInput.value.trim();
            const obsKey = getSensitiveValue(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            const obsDir = refs.obsDirInput.value.trim() || "Linux.do";
            const obsImgMode = refs.obsImgModeSelect.value;
            const obsImgDir = refs.obsImgDirInput.value.trim() || "Linux.do/attachments";

            if (!obsUrl || !obsKey) {
                UI.showStatus("请先在设置中配置 Obsidian API 地址和 Key", "error");
                return;
            }

            const selected = UI.getSelectedBookmarks();
            if (selected.length === 0) {
                UI.showStatus("请先选择要导出的帖子", "error");
                return;
            }

            refs.obsExportBtn.disabled = true;
            refs.exportBtns.style.display = "none";
            refs.controlBtns.style.display = "flex";
            UI.refs.reportContainer.innerHTML = "";

            const results = { success: [], failed: [], skipped: [] };

            try {
                if (UI.isActiveGitHubSource()) {
                    const githubResults = await UI.exportGitHubSelectedToObsidian(selected, {
                        obsUrl,
                        obsKey,
                        obsDir,
                        aiApiKey: getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                        aiService: refs.aiServiceSelect.value,
                        aiModel: refs.aiModelSelect.value,
                        aiBaseUrl: refs.aiBaseUrlInput.value.trim(),
                        categories: Utils.parseAICategories(refs.aiCategoriesInput.value.trim() || ""),
                        token: getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
                    }, (current, total, title) => {
                        UI.showProgress(current, total, `${title}\n导出到 Obsidian...`);
                    });
                    results.success.push(...githubResults.success);
                    results.failed.push(...githubResults.failed);
                    results.skipped.push(...(githubResults.skipped || []));
                } else {
                    for (let i = 0; i < selected.length; i++) {
                        if (Exporter.isCancelled) break;
                        while (Exporter.isPaused) {
                            await Utils.sleep(200);
                            if (Exporter.isCancelled) break;
                        }
                        if (Exporter.isCancelled) break;

                        const bookmark = selected[i];
                        const topicId = bookmark.topic_id || bookmark.bookmarkable_id;
                        UI.showProgress(i + 1, selected.length, "导出帖子到 Obsidian...");

                        try {
                            const { topic, posts } = await LinuxDoAPI.fetchAllPosts(topicId);
                            const filteredPosts = Exporter.filterPosts(posts, topic, {
                                onlyFirst: refs.onlyFirstCheckbox.checked,
                                onlyOp: refs.onlyOpCheckbox.checked,
                                rangeStart: parseInt(refs.rangeStartInput.value) || 1,
                                rangeEnd: parseInt(refs.rangeEndInput.value) || 999999,
                                imgFilter: refs.filterImgSelect.value,
                                filterUsers: refs.filterUsersInput.value.trim(),
                                filterInclude: refs.filterIncludeInput.value.trim(),
                                filterExclude: refs.filterExcludeInput.value.trim(),
                                filterMinLen: parseInt(refs.filterMinLenInput.value) || 0,
                            });

                            const meta = {
                                title: topic.title,
                                url: topic.url,
                                author: topic.opUsername,
                                topicId: topic.topicId || topic.topic_id,
                                category: topic.categoryName || topic.category,
                                tags: topic.tags || [],
                                floors: filteredPosts.length,
                            };
                            let md = HTMLToMarkdown.buildFrontmatter(meta);

                            md += `> [!info] 帖子信息\n`;
                            md += `> - **原始链接**: [${topic.title}](${topic.url})\n`;
                            md += `> - **楼主**: @${topic.opUsername || "未知"}\n`;
                            md += `> - **分类**: ${meta.category || "无"}\n`;
                            md += `> - **标签**: ${(topic.tags || []).join(", ") || "无"}\n`;
                            md += `> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;

                            filteredPosts.forEach((post, idx) => {
                                const isOp = post.username === topic.opUsername;
                                md += HTMLToMarkdown.buildPostCallout(post, idx, isOp);
                            });

                            if (obsImgMode === "file") {
                                const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                                let match;
                                const imgDownloads = [];
                                while ((match = imgRegex.exec(md)) !== null) {
                                    imgDownloads.push({ full: match[0], alt: match[1], url: match[2] });
                                }
                                for (const img of imgDownloads) {
                                    try {
                                        const ext = img.url.split(".").pop().split("?")[0] || "png";
                                        const nameBytes = new Uint8Array(4);
                                        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
                                            crypto.getRandomValues(nameBytes);
                                        } else {
                                            throw new Error("crypto.getRandomValues 不可用，无法生成 Obsidian 图片文件名");
                                        }
                                        const safeName = `img-${Date.now()}-${Array.from(nameBytes, b => b.toString(16).padStart(2, "0")).join("")}.${ext}`;
                                        const imgPath = `${obsImgDir}/${safeName}`;
                                        const blob = await new Promise((resolve, reject) => {
                                            GM_xmlhttpRequest({
                                                method: "GET",
                                                url: img.url,
                                                responseType: "blob",
                                                timeout: 30000,
                                                onload: (r) => resolve(r.response),
                                                onerror: (e) => reject(e),
                                                ontimeout: () => reject(new Error("图片下载超时")),
                                            });
                                        });
                                        const imgResult = await ObsidianAPI.writeImage(obsUrl, obsKey, imgPath, blob, getMimeType(ext));
                                        if (!imgResult.ok) throw new Error(imgResult.error);
                                        md = md.replace(img.full, `![${img.alt}](${encodeURI(imgPath)})`);
                                    } catch {
                                        // 图片下载失败，保留原始链接
                                    }
                                }
                            } else if (obsImgMode === "base64") {
                                const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                                const matches = [];
                                let m;
                                while ((m = imgRegex.exec(md)) !== null) matches.push(m);
                                for (const match of matches.reverse()) {
                                    try {
                                        const resp = await new Promise((resolve, reject) => {
                                            GM_xmlhttpRequest({
                                                method: "GET",
                                                url: match[2],
                                                responseType: "blob",
                                                timeout: 30000,
                                                onload: (r) => resolve(r),
                                                onerror: (e) => reject(e),
                                                ontimeout: () => reject(new Error("图片下载超时")),
                                            });
                                        });
                                        const b64 = await new Promise((resolve) => {
                                            const reader = new FileReader();
                                            reader.onloadend = () => resolve(reader.result);
                                            reader.readAsDataURL(resp.response);
                                        });
                                        md = md.replace(match[0], `![${match[1]}](${b64})`);
                                    } catch {
                                        // 跳过失败的图片
                                    }
                                }
                            }

                            const fileName = UI.sanitizeObsidianFileName(topic.title, `topic-${topicId}`);
                            const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${fileName}.md`, md);
                            if (!noteResult.ok) throw new Error(noteResult.error);
                            results.success.push({
                                title: topic.title,
                                url: topic.url,
                            });
                        } catch (error) {
                            results.failed.push({
                                title: bookmark.title || `帖子 ${topicId}`,
                                error: error.message,
                            });
                        }

                        if (i < selected.length - 1) {
                            await Utils.sleep(300);
                        }
                    }
                }

                UI.hideProgress();
                UI.showReport(results);
                UI.renderBookmarkList();

                const msg = `Obsidian 导出完成：成功 ${results.success.length} 个${results.failed.length ? `，失败 ${results.failed.length} 个` : ""}`;
                UI.showStatus(msg, results.failed.length > 0 ? "warning" : "success");
            } catch (error) {
                UI.showStatus(`Obsidian 导出出错: ${error.message}`, "error");
            } finally {
                refs.obsExportBtn.disabled = false;
                refs.exportBtns.style.display = "flex";
                refs.controlBtns.style.display = "none";
                Exporter.reset();
            }
        };

        // 权限设置事件
        refs.permissionLevelSelect.onchange = (e) => {
            const level = parseInt(e.target.value);
            OperationGuard.setLevel(level);
            UI.showStatus(`权限级别已设置为: ${CONFIG.PERMISSION_NAMES[level]}`, "success");
        };

        refs.requireConfirmCheckbox.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, e.target.checked);
        };

        refs.enableAuditLogCheckbox.onchange = (e) => {
            const previousState = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
            const nextState = !!e.target.checked;
            OperationLog.add({
                audit_event: nextState ? "audit.enabled" : "audit.disabled",
                actor: "user",
                source: "linuxdo-panel",
                operation: {
                    name: "toggleAuditLog",
                    risk: "standard",
                    trigger: "user_settings_change",
                },
                payload: {
                    previousState,
                    newState: nextState,
                },
                result: {
                    status: "success",
                    reason: nextState ? "audit_enabled" : "audit_disabled",
                },
                redaction: [],
                operationName: "toggleAuditLog",
                context: {
                    previousState,
                    newState: nextState,
                },
                startTime: Date.now(),
                endTime: Date.now(),
                status: "success",
            }, { force: true });
            Storage.set(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, nextState);
            // 更新日志面板可见性
            const logPanel = refs.logPanel
            if (logPanel) {
                logPanel.style.display = nextState ? "block" : "none";
            }
        };

        // 日志面板事件
        refs.logToggleBtn.onclick = () => {
            const content = refs.logContent
            const arrow = refs.logArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";

            // 展开时更新日志内容
            if (!content.classList.contains("collapsed")) {
                UI.updateLogPanel();
            }
        };

        refs.logClearBtn.onclick = () => {
            if (confirm("确定要清除所有操作日志吗？")) {
                OperationLog.clear();
                UI.showStatus("日志已清除", "success");
            }
        };

        // 输入框自动保存
        refs.apiKeyInput.onchange = async (e) => {
            const value = e.target.value.trim();
            try {
                if (value) {
                    await NotionOAuth.setManualApiKey(value);
                } else if (NotionOAuth.getAuthMode() !== "oauth") {
                    await NotionOAuth.setManualApiKey("");
                }
            } catch (error) {
                UI.showStatus(error.message || String(error), "error");
            }
        };
        refs.databaseIdInput.onchange = (e) => {
            void UICommandService.execute("apply_workspace_selection", { selectedValue: `database:${e.target.value.trim()}` });
        };

        // 手动输入数据库 ID 开关
        refs.toggleManualDbBtn.onclick = () => {
            const wrap = refs.manualDbWrap
            const visible = wrap.style.display !== "none";
            wrap.style.display = visible ? "none" : "block";
        };

        // 刷新工作区页面列表
        refs.refreshWorkspaceBtn.onclick = async () => {
            const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
            const refreshBtn = refs.refreshWorkspaceBtn
            const workspaceTip = refs.workspaceTip

            if (!apiKey) {
                UI.showStatus(MSG.NO_NOTION_KEY, "error");
                return;
            }

            refreshBtn.disabled = true;
            refreshBtn.innerHTML = "⏳";
            workspaceTip.style.color = "";
            workspaceTip.textContent = "正在获取数据库列表...";

            try {
                const { workspaceData } = await WorkspaceService.refreshWorkspaceSnapshot(apiKey, {
                    includePages: true,
                    onProgress: (progress) => {
                        if (progress.phase === "databases") {
                            workspaceTip.textContent = `正在获取数据库列表... 已加载 ${progress.loaded} 个`;
                        } else if (progress.phase === "pages") {
                            workspaceTip.textContent = `数据库已就绪，正在获取页面... 已加载 ${progress.loaded} 个`;
                        }
                    },
                    onWorkspaceData: (workspaceData, meta) => {
                        UI.updateWorkspaceSelect(workspaceData);

                        if (meta.phase === "databases") {
                            workspaceTip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                            workspaceTip.style.color = "var(--ldb-ui-success)";
                        }
                    },
                });
                UI.updateWorkspaceSelect(workspaceData);
                workspaceTip.textContent = `✅ 获取到 ${workspaceData.databases.length} 个数据库，${workspaceData.pages.length} 个页面`;
                workspaceTip.style.color = "var(--ldb-ui-success)";
            } catch (error) {
                workspaceTip.textContent = `❌ ${error.message}`;
                workspaceTip.style.color = "var(--ldb-ui-danger)";
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = "🔄";
            }
        };

        if (refs.viewRefreshWorkspaceBtn) {
            refs.viewRefreshWorkspaceBtn.onclick = async () => {
                const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
                if (!apiKey) {
                    UI.showStatus(MSG.NO_NOTION_KEY, "error");
                    UI.setWorkspaceVisualStatus(MSG.NO_NOTION_KEY, "error");
                    return;
                }

                try {
                    await UI.refreshWorkspaceVisualization(apiKey);
                } catch (error) {
                    UI.showStatus(`工作区视图刷新失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewGenerateWorkspaceInsightBtn) {
            refs.viewGenerateWorkspaceInsightBtn.onclick = async () => {
                try {
                    await UI.generateWorkspaceInsight();
                } catch (error) {
                    UI.showStatus(`生成工作区洞察失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewCopyWorkspaceReportBtn) {
            refs.viewCopyWorkspaceReportBtn.onclick = async () => {
                try {
                    await UI.copyWorkspaceInsightReport();
                } catch (error) {
                    UI.showStatus(`复制工作区报告失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewDownloadWorkspaceReportBtn) {
            refs.viewDownloadWorkspaceReportBtn.onclick = async () => {
                try {
                    await UI.downloadWorkspaceInsightReport();
                } catch (error) {
                    UI.showStatus(`涓嬭浇宸ヤ綔鍖烘姤鍛婂け璐ワ細${error.message}`, "error");
                }
            };
        }

        if (refs.viewDownloadWorkspacePackageBtn) {
            refs.viewDownloadWorkspacePackageBtn.onclick = async () => {
                try {
                    await UI.downloadWorkspaceCollaborationPackage();
                } catch (error) {
                    UI.showStatus(`下载工作区协作包失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSaveWorkspacePackageBtn) {
            refs.viewSaveWorkspacePackageBtn.onclick = async () => {
                try {
                    await UI.saveWorkspaceCollaborationPackageToNotion();
                } catch (error) {
                    UI.showStatus(`保存工作区协作包失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSaveWorkspaceReportBtn) {
            refs.viewSaveWorkspaceReportBtn.onclick = async () => {
                try {
                    await UI.saveWorkspaceInsightReportToNotion();
                } catch (error) {
                    UI.showStatus(`保存工作区报告失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSaveWorkspaceCandidatesBtn) {
            refs.viewSaveWorkspaceCandidatesBtn.onclick = async () => {
                try {
                    await UI.saveWorkspaceConnectionCandidatesToNotion();
                } catch (error) {
                    UI.showStatus(`保存统一候选失败：${error.message}`, "error");
                }
            };
        }

        if (refs.viewSyncNowBtn) {
            refs.viewSyncNowBtn.onclick = async () => {
                try {
                    await UI.runUnifiedSyncNow();
                } catch (error) {
                    UI.showStatus(`统一同步失败：${error.message}`, "error");
                }
            };
        }

        // 从工作区选择页面/数据库
        refs.workspaceSelect.onchange = (e) => {
            const selected = e.target.value;
            if (selected) {
                const [type, id] = selected.split(":");
                if (type === "database") {
                    refs.databaseIdInput.value = id;
                    refs.exportTargetDatabaseRadio.checked = true;
                    handleExportTargetChange({ target: { value: CONFIG.EXPORT_TARGET_TYPES.DATABASE } });
                    void UICommandService.execute("apply_workspace_selection", { selectedValue: `database:${id}` });
                    UI.showStatus("已选择数据库，自动切换为数据库导出模式", "info");
                } else if (type === "page") {
                    // 页面类型：填入父页面 ID 字段
                    refs.parentPageIdInput.value = id;
                    // 自动切换到页面导出模式
                    refs.exportTargetPageRadio.checked = true;
                    refs.parentPageGroup.style.display = "block";
                    refs.manualDbWrap.style.display = "none";
                    refs.exportTargetTip.textContent = "导出为子页面，包含完整内容";
                    void UICommandService.execute("apply_workspace_selection", { selectedValue: `page:${id}` });
                    UI.showStatus("已选择页面，自动切换为页面导出模式", "info");
                }
            }
        };

        // ===========================================
        // AI 对话事件绑定
        // ===========================================

        // 初始化对话 UI
        ChatUI.init();

        // AI 服务切换 - 更新模型列表（优先使用缓存）
        refs.aiServiceSelect.onchange = (e) => {
            const newService = e.target.value;
            const availableModels = AIService.getAvailableModels(newService);
            UI.updateAIModelOptions(newService, availableModels.length > 0 ? availableModels : undefined);
            Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, newService);
        };

        // 保存 AI 配置
        refs.aiApiKeyInput.onchange = (e) => {
            persistSensitiveInput(e.target, CONFIG.STORAGE_KEYS.AI_API_KEY).catch((error) => {
                UI.showStatus(error.message || String(error), "error");
            });
        };
        refs.aiBaseUrlInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_BASE_URL, e.target.value.trim());
        };
        refs.aiCategoriesInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_CATEGORIES, e.target.value.trim());
        };
        refs.aiModelSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, e.target.value);
        };

        // AI 查询目标数据库选择
        refs.aiTargetDbSelect.onchange = (e) => {
            void UICommandService.execute("select_ai_target", { targetValue: e.target.value });
        };

        refs.workspaceMaxPagesSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, parseInt(e.target.value) || 0);
        };

        // Agent 个性化设置
        refs.agentPersonaNameInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, e.target.value.trim() || CONFIG.DEFAULTS.agentPersonaName);
        };
        refs.agentPersonaToneSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, e.target.value);
        };
        refs.agentPersonaExpertiseInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, e.target.value.trim() || CONFIG.DEFAULTS.agentPersonaExpertise);
        };
        refs.agentPersonaInstructionsInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, e.target.value.trim());
        };
        refs.agentMaxIterationsSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS, parseInt(e.target.value) || 8);
        };
        refs.githubUsernameInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, e.target.value.trim());
        };
        refs.githubTokenInput.onchange = (e) => {
            persistSensitiveInput(e.target, CONFIG.STORAGE_KEYS.GITHUB_TOKEN).catch((error) => {
                UI.showStatus(error.message || String(error), "error");
            });
        };
        // Obsidian 设置变更保存
        refs.obsApiUrlInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_API_URL, e.target.value.trim());
        };
        refs.obsApiKeyInput.onchange = (e) => {
            persistSensitiveInput(e.target, CONFIG.STORAGE_KEYS.OBS_API_KEY).catch((error) => {
                UI.showStatus(error.message || String(error), "error");
            });
        };
        refs.obsDirInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_DIR, e.target.value.trim());
        };
        refs.obsImgModeSelect.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_IMG_MODE, e.target.value);
        };
        refs.obsImgDirInput.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.OBS_IMG_DIR, e.target.value.trim());
        };
        // GitHub 导入类型
        refs.githubTypeCheckboxes.forEach(cb => {
            cb.onchange = () => {
                const source = [...refs.githubTypeCheckboxes].filter(c => c.checked);
                const types = [...source].filter(c => c.checked).map(c => c.value);
                GitHubAPI.setImportTypes(types.length > 0 ? types : ["stars"]);
            };
        });

        // 刷新 AI 数据库列表
        refs.aiRefreshDbsBtn.onclick = async () => {
            const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
            const refreshBtn = refs.aiRefreshDbsBtn

            if (!apiKey) {
                UI.showStatus(MSG.NO_NOTION_KEY, "error");
                return;
            }

            refreshBtn.disabled = true;
            refreshBtn.innerHTML = "⏳";

            try {
                const { workspaceData } = await UICommandService.execute("refresh_workspace_targets", {
                    apiKey,
                    includePages: false,
                    onWorkspaceData: (workspaceData) => {
                        UI.updateAITargetDbOptions(workspaceData.databases);
                    },
                });

                UI.updateAITargetDbOptions(workspaceData.databases);
                UI.showStatus(`获取到 ${workspaceData.databases.length} 个数据库`, "success");
            } catch (error) {
                UI.showStatus(`获取数据库列表失败: ${error.message}`, "error");
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = "🔄";
            }
        };

        // 获取模型列表
        refs.aiFetchModelsBtn.onclick = async () => {
            const aiApiKey = getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "");
            const aiService = refs.aiServiceSelect.value;
            const aiBaseUrl = refs.aiBaseUrlInput.value.trim();
            const fetchBtn = refs.aiFetchModelsBtn
            const modelTip = refs.aiModelTip

            if (!aiApiKey) {
                UI.showStatus(MSG.NO_AI_KEY, "error");
                return;
            }

            fetchBtn.disabled = true;
            fetchBtn.innerHTML = "⏳ 获取中...";
            modelTip.textContent = "";

            try {
                const { models } = await UICommandService.execute("fetch_ai_models", {
                    aiService,
                    aiApiKey,
                    aiBaseUrl,
                });
                UI.updateAIModelOptions(aiService, models, true); // 保留当前选择
                modelTip.textContent = `✅ 获取到 ${models.length} 个可用模型`;
                modelTip.style.color = "var(--ldb-ui-success)";
                UI.showStatus(`成功获取 ${models.length} 个模型`, "success");
            } catch (error) {
                modelTip.textContent = `❌ ${error.message}`;
                modelTip.style.color = "var(--ldb-ui-danger)";
                UI.showStatus(`获取模型失败: ${error.message}`, "error");
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = "🔄 获取";
            }
        };

        // 测试 AI 连接
        refs.aiTestBtn.onclick = async () => {
            const btn = refs.aiTestBtn
            const statusSpan = refs.aiTestStatus
            const aiApiKey = getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, "");
            const aiService = refs.aiServiceSelect.value;
            const aiModel = refs.aiModelSelect.value;
            const aiBaseUrl = refs.aiBaseUrlInput.value.trim();

            // 清除之前的状态
            statusSpan.textContent = "";
            statusSpan.style.color = "";

            if (!aiApiKey) {
                UI.showStatus(MSG.NO_AI_KEY, "error");
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 测试中...';

            try {
                const response = await AIService.request(
                    "请回复：连接成功",
                    { aiService, aiApiKey, aiModel, aiBaseUrl }
                );
                statusSpan.textContent = `✅ ${response}`;
                statusSpan.style.color = "var(--ldb-ui-success)";
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "var(--ldb-ui-danger)";
            } finally {
                btn.disabled = false;
                btn.innerHTML = "🧪 测试";
            }
        };

        // AI 模板管理
        UI._loadTemplates = () => {
            try {
                return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.AI_TEMPLATES, CONFIG.DEFAULTS.aiTemplates));
            } catch {
                return JSON.parse(CONFIG.DEFAULTS.aiTemplates);
            }
        };

        UI._saveTemplates = (templates) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_TEMPLATES, JSON.stringify(templates));
        };

        UI.renderTemplateList = () => {
            const list = refs.templateList;
            if (!list) return;
            const templates = UI._loadTemplates();
            if (templates.length === 0) {
                list.innerHTML = '<div class="ldb-tip">暂无模板，请添加</div>';
                return;
            }
            list.innerHTML = templates.map((t, i) => {
                const icon = t.icon || "📝";
                const name = Utils.escapeHtml(t.name || "未命名");
                const prompt = Utils.escapeHtml((t.prompt || "").substring(0, 50));
                return `<div class="ldb-setting-row" style="justify-content: space-between; padding: 4px 0;">
                    <span style="font-size: 12px;">${icon} <strong>${name}</strong> <span style="color: var(--ldb-ui-muted);">${prompt}${t.prompt && t.prompt.length > 50 ? "..." : ""}</span></span>
                    <button class="ldb-btn ldb-btn-secondary" data-template-delete="${i}" style="padding: 2px 6px; font-size: 11px;">删除</button>
                </div>`;
            }).join("");

            list.querySelectorAll("[data-template-delete]").forEach(btn => {
                btn.onclick = () => {
                    const idx = parseInt(btn.dataset.templateDelete);
                    const ts = UI._loadTemplates();
                    ts.splice(idx, 1);
                    UI._saveTemplates(ts);
                    UI.renderTemplateList();
                    UI.showStatus("模板已删除", "success");
                };
            });
        };

        refs.templateAddBtn.onclick = () => {
            const name = refs.templateNameInput.value.trim();
            const icon = refs.templateIconInput.value.trim() || "📝";
            const prompt = refs.templatePromptInput.value.trim();
            if (!name || !prompt) {
                UI.showStatus("请填写模板名称和 prompt", "error");
                return;
            }
            const templates = UI._loadTemplates();
            templates.push({ name, icon, prompt });
            UI._saveTemplates(templates);
            refs.templateNameInput.value = "";
            refs.templateIconInput.value = "";
            refs.templatePromptInput.value = "";
            UI.renderTemplateList();
            UI.showStatus(`模板「${name}」已添加`, "success");
        };

        UI.renderTemplateList();

        NotionOAuth.attachControls({
            root: panel,
            selectors: {
                clientIdInput: "#ldb-oauth-client-id",
                clientSecretInput: "#ldb-oauth-client-secret",
                redirectUriInput: "#ldb-oauth-redirect-uri",
                authorizeBtn: "#ldb-oauth-authorize",
                clearBtn: "#ldb-oauth-clear",
                statusEl: "#ldb-oauth-status",
            },
            notify: (message, type) => UI.showStatus(message, type),
        });
        CredentialVault.attachControls({
            root: panel,
            selectors: {
                statusEl: "#ldb-vault-status",
                unlockBtn: "#ldb-vault-unlock",
                lockBtn: "#ldb-vault-lock",
            },
            notify: (message, type) => UI.showStatus(message, type),
            onAfterSync: () => {
                syncSensitiveInputs();
            },
        });
        syncSensitiveInputs();

        // 拖拽
        UI.makeDraggable(panel, panel.querySelector(".ldb-header"));
    }
};

;

module.exports = { UIEvents };
