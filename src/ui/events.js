"use strict";

// 依赖引入
const { CONFIG, MSG, getMimeType } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState, DedupStore } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState, GitHubOAuth } = require("../auth");
const { buildConfiguredTargetWarning } = require("../auth/target-discovery");
const { NotionAPI, DOMToNotion, SiteDetector, InstallHelper, HTMLToMarkdown, ObsidianAPI, EMOJI_MAP } = require("../api");
const { OperationGuard, UndoManager, OperationLog, ConfirmationDialog } = require("../security");
const { ZhihuAPI, GenericExtractor, WorkspaceService } = require("../extract");
const { UICommandService } = require("../coordination/UICommandService");
const { Exporter, LinuxDoAPI, GenericExporter } = require("../export");
const { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter } = require("../import");
const { BookmarkBridge, BookmarkAutoImporter, BookmarkExporter, BookmarkOrganizer } = require("../bridge");
const { AIService, ChatUI, AIClassifier, AgentTrace, ChatState } = require("../ai");
const { DesignSystem } = require("./design-system");
const { PanelResize } = require("./panel-resize");

const UIEvents = {
    bindEvents: () => {
        // UI 对象由 main-ui 定义；events↔main-ui 互引用构成循环依赖，
        // 顶部 import 会让 main-ui 加载时拿不到 UIEvents。改在 bindEvents 运行时
        // 延迟 require（此时 main-ui 已加载完成），为整个 bindEvents 闭包链提供 UI。
        const UI = require("./main-ui").UI;
        const panel = UI.panel;
        const refs = UI.refs || {};
        const body = panel.querySelector(".ldb-body");

        // === ctx 共享变量（T9: 闭包分段标记，保持整体传递） ===
        // 以下 helper 函数在整个 bindEvents 闭包内共享，
        // 不拆散为独立文件以避免可变引用失效风险。
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
        // 20260914: GitHub OAuth Client ID 为公开信息, 普通键同步(非敏感)
        if (refs.githubOauthClientIdInput) {
            refs.githubOauthClientIdInput.value = GitHubOAuth.getClientId();
        }

        const isUserscriptMode = Utils.isUserscriptMode();
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

        // Odyssey UI M: 主面板 Esc 关闭(最小化到 mini 按钮),与 GenericUI/NotionSiteUI 行为统一
        if (!UI._escMinimizeHandler) {
            UI._escMinimizeHandler = (e) => {
                if (e.key !== "Escape") return;
                // Odyssey Review F3(flash+ox): IME 组合中/输入控件内/确认弹窗打开时不最小化,
                // 防止中文输入法取消组合、下拉框原生关闭、确认框取消连带收起面板。
                if (e.isComposing || e.keyCode === 229) return;
                const t = e.target;
                if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
                if (document.querySelector(".ldb-confirm-overlay")) return;
                const p = UI.panel;
                if (!p || !document.body.contains(p) || p.style.display === "none") return;
                if (!refs.minimizeBtn) return;
                refs.minimizeBtn.onclick();
            };
            document.addEventListener("keydown", UI._escMinimizeHandler);
        }

        // 关闭(F-UI-09:确认后走 UI.destroy() 完整清理,而非裸 panel.remove())
        refs.closeBtn.onclick = () => {
            ConfirmationDialog.show({
                title: "关闭面板",
                message: "关闭后可通过刷新页面重新打开。确定关闭吗？",
                confirmText: "关闭",
                onConfirm: () => UI.destroy(),
            });
        };

        // 主题切换
        refs.themeToggleBtn.onclick = () => {
            DesignSystem.toggleTheme();
        };

        // === Section 1: Tab 切换 + 面板操作 (L95-1437) ===
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

        // Add arrow key navigation for tabs
        const tabContainer = panel.querySelector('.ldb-tabs');
        if (tabContainer) {
            tabContainer.addEventListener('keydown', (e) => {
                const tabs = Array.from(tabContainer.querySelectorAll('[role="tab"]'));
                const currentIndex = tabs.indexOf(document.activeElement);
                
                if (currentIndex === -1) return;
                
                let newIndex = currentIndex;
                
                if (e.key === 'ArrowRight') {
                    newIndex = (currentIndex + 1) % tabs.length;
                    e.preventDefault();
                } else if (e.key === 'ArrowLeft') {
                    newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                    e.preventDefault();
                } else if (e.key === 'Home') {
                    newIndex = 0;
                    e.preventDefault();
                } else if (e.key === 'End') {
                    newIndex = tabs.length - 1;
                    e.preventDefault();
                }
                
                if (newIndex !== currentIndex) {
                    tabs[newIndex].focus();
                    tabs[newIndex].click();
                }
            });
        }

        // 恢复上次选择的 tab
        // v3.14.7 (REV-23 UI-22): savedTab 注入防御——存储损坏/手改(如含引号/方括号)
        // 会令 querySelector 抛 SyntaxError 中断 bindEvents 整链; 先校验仅允许白名单值。
        const savedTab = Storage.get(CONFIG.STORAGE_KEYS.ACTIVE_TAB, CONFIG.DEFAULTS.activeTab);
        const SAFE_TABS = ["bookmarks", "visuals", "ai", "settings"];
        const safeTab = SAFE_TABS.includes(savedTab) ? savedTab : CONFIG.DEFAULTS.activeTab;
        const tabBtn = panel.querySelector(`.ldb-tab[data-tab="${safeTab}"]`);
        if (tabBtn) tabBtn.click();

        // 折叠筛选设置
        // F-UI-12:折叠状态持久化(单键 JSON,容量有界)
        const collapseState = Storage.get(CONFIG.STORAGE_KEYS.COLLAPSE_STATE, {});
        const collapseSections = [
            { toggle: refs.filterToggle, content: refs.filterContent, arrow: refs.filterArrow, key: "filter" },
            { toggle: refs.aiSettingsToggle, content: refs.aiSettingsContent, arrow: refs.aiSettingsArrow, key: "ai" },
            { toggle: refs.githubSettingsToggle, content: refs.githubSettingsContent, arrow: refs.githubSettingsArrow, key: "github" },
            { toggle: refs.obsSettingsToggle, content: refs.obsSettingsContent, arrow: refs.obsSettingsArrow, key: "obsidian" },
            { toggle: refs.sourceSettingsToggle, content: refs.sourceSettingsContent, arrow: refs.sourceSettingsArrow, key: "source" },
            { toggle: refs.sourcePartitionsToggle, content: refs.sourcePartitionsContent, arrow: refs.sourcePartitionsArrow, key: "partitions" },
        ];
        const applyCollapse = (section) => {
            if (!section.toggle || !section.content) return;
            const collapsed = !!collapseState[section.key];
            section.content.classList.toggle("collapsed", collapsed);
            if (section.arrow) section.arrow.textContent = collapsed ? "▶" : "▼";
            section.toggle.setAttribute("aria-expanded", String(!collapsed));
        };
        const bindCollapse = (section) => {
            if (!section.toggle) return;
            section.toggle.onclick = () => {
                section.content.classList.toggle("collapsed");
                const collapsed = section.content.classList.contains("collapsed");
                if (section.arrow) section.arrow.textContent = collapsed ? "▶" : "▼";
                section.toggle.setAttribute("aria-expanded", String(!collapsed));
                collapseState[section.key] = collapsed;
                Storage.set(CONFIG.STORAGE_KEYS.COLLAPSE_STATE, collapseState);
            };
        };
        collapseSections.forEach(applyCollapse);
        collapseSections.forEach(bindCollapse);

        // Obsidian 测试连接
        refs.obsTestBtn.onclick = async () => {
            const url = refs.obsApiUrlInput.value.trim();
            const key = getSensitiveValue(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            if (!url || !key) {
                refs.obsTestStatus.innerHTML = '<span class="ldb-status-text ldb-status-text--danger">请填写 API 地址和 Key</span>';
                return;
            }
            refs.obsTestStatus.innerHTML = '<span class="ldb-status-text ldb-status-text--accent">连接中...</span>';
            try {
                const result = await ObsidianAPI.testConnection(url, key);
                if (result.ok) {
                    refs.obsTestStatus.innerHTML = '<span class="ldb-status-text ldb-status-text--success">✅ 连接成功</span>';
                } else {
                    refs.obsTestStatus.innerHTML = `<span class="ldb-status-text ldb-status-text--danger">❌ ${Utils.escapeHtml(result.error)}</span>`;
                }
            } catch (e) {
                refs.obsTestStatus.innerHTML = `<span class="ldb-status-text ldb-status-text--danger">❌ ${Utils.escapeHtml(e.message)}</span>`;
            }
        };

        // 折叠区域键盘支持（Enter/Space 触发 click）
        // v3.14.7 (REV-20 UI-03): 已删除非持久化 sourceSettings/Partitions toggle handler——
        // 它们覆盖上方 bindCollapse 的持久化版本(丢失 source 两区折叠持久化)。
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

        // v3.14.7 (REV-20 UI-03): 删除重复死代码——此前的非持久化 sourceSettings/Partitions
        // toggle handler 会覆盖上方 bindCollapse 的持久化版本(丢失折叠持久化),
        // 且 collapseSections.forEach×2 + obsTestBtn.onclick 在此后重复出现。
        // 统一保留: bindCollapse(持久化) + 上方唯一 obsTestBtn.onclick。

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
            updateExportButtonState();
            UI.updateExportTargetSummary();
        };

        refs.exportTargetDatabaseRadio.onchange = handleExportTargetChange;
        refs.exportTargetPageRadio.onchange = handleExportTargetChange;

        // 父页面 ID 自动保存
        refs.parentPageIdInput.onchange = (e) => {
            void UICommandService.execute("set_export_target_state", {
                targetType: CONFIG.EXPORT_TARGET_TYPES.PAGE,
                parentPageId: e.target.value.trim(),
            });
            updateExportButtonState();
            UI.updateExportTargetSummary();
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

            // v3.14.17 (P0-3): Database ID URL 预提取(warn-only,不阻断)——
            // 用户粘贴 notion.so 链接时自动识别出 32 位 ID 并提示,
            // 避免拿链接原文去请求必然失败后等 15s 超时才暴露
            const rawDbId = refs.databaseIdInput.value.trim();
            const extractedDbId = Utils.extractNotionId(rawDbId);
            if (exportTargetType === "database" && databaseId && extractedDbId && extractedDbId !== rawDbId) {
                statusSpan.textContent = `🔍 已从链接识别到数据库 ID: ${extractedDbId}`;
                statusSpan.style.color = "var(--ldb-ui-accent)";
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
                    // F-UI-45:结果类反馈双写（就地 + 全局）
                    UI.showStatus("✅ 配置验证成功", "success");
                }

                if (!result.valid) {
                    statusSpan.textContent = `❌ ${result.error}`;
                    statusSpan.style.color = "var(--ldb-ui-danger)";
                    UI.showStatus(`❌ ${result.error}`, "error");
                }
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "var(--ldb-ui-danger)";
                UI.showStatus(`❌ ${error.message}`, "error");
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
                    // F-UI-45:结果类反馈双写（就地 + 全局）
                    UI.showStatus(`✅ ${result.message}`, "success");
                } else {
                    statusSpan.textContent = `❌ ${result.error}`;
                    statusSpan.style.color = "var(--ldb-ui-danger)";
                    UI.showStatus(`❌ ${result.error}`, "error");
                }
            } catch (error) {
                statusSpan.textContent = `❌ ${error.message}`;
                statusSpan.style.color = "var(--ldb-ui-danger)";
                UI.showStatus(`❌ ${error.message}`, "error");
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
                    // v3.14.7 (REV-14 UI-16): 未配置时勾选不再假启用——此前 enabledKey 直接落盘,
                    // 即使无 GitHub 用户名/token + Notion 目标也显示开启且开始注定失败的轮询。
                    const githubReady = !!(
                        Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "").trim()
                        || Storage.get(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "").trim()
                    );
                    const notionReady = !!(
                        NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim())
                        && (refs.databaseIdInput.value.trim() || refs.parentPageIdInput.value.trim())
                    );
                    if (!githubReady || !notionReady) {
                        // P4 收敛(c13): 此处是 GitHub 自动导入开关 —— 警告必须写到 GitHub 状态位,
                        // 写到 Linux.do 状态位会让 GitHub 状态残留旧值
                        GitHubAutoImporter.updateStatus("⚠️ 请先配置 GitHub 用户名/Token 与 Notion 目标");
                        e.target.checked = false;
                        Storage.set(cfg.enabledKey, false);
                        refs.autoImportOptions.style.display = "none";
                        return;
                    }
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
                    // F-UI-10:配置不完整时回写开关,避免假启用
                    e.target.checked = false;
                    Storage.set(cfg.enabledKey, false);
                    refs.autoImportOptions.style.display = "none";
                    return;
                }
                const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
                if (exportTargetType === "database" && !refs.databaseIdInput.value.trim()) {
                    AutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                    e.target.checked = false;
                    Storage.set(cfg.enabledKey, false);
                    refs.autoImportOptions.style.display = "none";
                    return;
                }
                if (exportTargetType === "page" && !refs.parentPageIdInput.value.trim()) {
                    AutoImporter.updateStatus("⚠️ 请先配置父页面 ID");
                    e.target.checked = false;
                    Storage.set(cfg.enabledKey, false);
                    refs.autoImportOptions.style.display = "none";
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
                    // F-UI-10:配置不完整时回写开关,避免假启用
                    e.target.checked = false;
                    Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, false);
                    refs.bookmarkAutoImportOptions.style.display = "none";
                    return;
                }
                if (!apiKey) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先配置 Notion API Key");
                    e.target.checked = false;
                    Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, false);
                    refs.bookmarkAutoImportOptions.style.display = "none";
                    return;
                }
                if (exportTargetType !== "database") {
                    BookmarkAutoImporter.updateStatus("⚠️ 浏览器书签自动同步仅支持导出到 Notion 数据库");
                    e.target.checked = false;
                    Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, false);
                    refs.bookmarkAutoImportOptions.style.display = "none";
                    return;
                }
                if (!refs.databaseIdInput.value.trim()) {
                    BookmarkAutoImporter.updateStatus("⚠️ 请先配置 Notion 数据库 ID");
                    e.target.checked = false;
                    Storage.set(CONFIG.STORAGE_KEYS.BOOKMARK_AUTO_IMPORT_ENABLED, false);
                    refs.bookmarkAutoImportOptions.style.display = "none";
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

        // v3.15 RSS 功能已移除: 相关 refs 已从面板删除; 守卫式保留防旧缓存面板崩溃
        if (refs.rssFeedUrlsInput) refs.rssFeedUrlsInput.onchange = () => {};
        if (refs.rssAutoImportEnabled) refs.rssAutoImportEnabled.onchange = () => {};
        if (refs.rssAutoImportInterval) refs.rssAutoImportInterval.onchange = () => {};
        if (refs.rssDedupModeSelect) refs.rssDedupModeSelect.onchange = () => {};

        // F-UI-05:各来源「立即导入」按钮(完整同步:拉取 + 写 Notion + 推进水位)
        const bindImportNow = (btn, label, runner) => {
            if (!btn) return;
            btn.onclick = async () => {
                if (btn.disabled) return;
                const originalText = btn.textContent;
                btn.disabled = true;
                btn.textContent = "导入中...";
                try {
                    const result = await runner();
                    const count = result?.importedCount ?? result?.count ?? 0;
                    // odyssey-debug 20260913: runner 内部吞错(如 GitHub 404)经 errors 上抛红显真实原因;
                    // 其余 runner 未返回 errors 时行为不变。
                    if (Array.isArray(result?.errors) && result.errors.length > 0) {
                        UI.showStatus(`${label}失败：${result.errors[0]}`, "error");
                    } else {
                        UI.showStatus(`${label}完成：新增 ${count} 条`, "success");
                    }
                } catch (error) {
                    UI.showStatus(`${label}失败：${error.message}`, "error");
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            };
        };
        bindImportNow(refs.importNowLinuxdoBtn, "Linux.do 导入", () => AutoImporter.run());
        bindImportNow(refs.importNowGithubBtn, "GitHub 导入", () => GitHubAutoImporter.run());
        bindImportNow(refs.importNowBookmarkBtn, "书签导入", () => BookmarkAutoImporter.run());

        refs.linuxdoDedupModeSelect.onchange = (e) => {
            const mode = e.target.value === "allow_duplicates" ? "allow_duplicates" : "strict";
            Storage.set(CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE, mode);
            UI.recomputeExportStats();
            UI.renderBookmarkList();
            UI.updateExportStatusTip?.();
        };

        if (refs.exportStatusSourceSelect) {
            refs.exportStatusSourceSelect.value = UI.getExportStatusSource();
            refs.exportStatusSourceSelect.onchange = (e) => {
                const source = e.target.value === "notion" ? "notion" : "local";
                UI.setExportStatusSource(source);
                UI.recomputeExportStatusFromNotion();
                UI.showStatus(
                    source === "notion"
                        ? "导出状态改为依据 Notion 工作区快照"
                        : "导出状态改为依据本地账本",
                    "success"
                );
            };
        }
        if (refs.recomputeExportStatusBtn) {
            refs.recomputeExportStatusBtn.onclick = () => {
                const result = UI.recomputeExportStatusFromNotion();
                if (UI.getExportStatusSource() !== "notion") {
                    UI.showStatus("当前为本地账本模式；切换到「Notion 工作区」后可按快照重算。", "info");
                    return;
                }
                if (!result.hasSnapshot) {
                    UI.showStatus("请先刷新工作区后再按 Notion 重算导出状态", "error");
                    return;
                }
                UI.showStatus(`已按 Notion 快照重算（识别到 ${result.urlCount} 条链接，未改本地账本）`, "success");
            };
        }
        UI.updateExportStatusTip?.();

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
            // F-UI-32:未加载时显示空状态引导
            if (UI.refs.bookmarkEmptyState) UI.refs.bookmarkEmptyState.style.display = "block";
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
                        const isGitHubKey = bookmarkKey.startsWith("gh:");
                        // Odyssey Review F2(flash+hy3): 恢复破坏性覆盖前的确认弹窗
                        // (随坏内联 onclick 移除而丢失;旧内联因 ConfirmationDialog 非全局本就失效)
                        // v3.14.4: GitHub 项同供重新导出(对账误标恢复入口)
                        ConfirmationDialog.show({
                            title: "确认重新导出",
                            message: isGitHubKey
                                ? "重新导出将移除该项（仓库/Gist）的导出记录并重新加入待导出列表，可能覆盖现有 Notion 页面或 Obsidian 笔记，是否继续？"
                                : "重新导出将移除该帖子的导出记录并重新加入待导出列表，可能覆盖现有 Notion 页面，是否继续？",
                            confirmText: "重新导出",
                            onConfirm: () => {
                                UI.requeueLinuxDoBookmark(bookmarkKey);
                            },
                        });
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

        // F-UI-42:设置 Tab 书签入口跳转收藏 Tab
        const bookmarkJumpBtn = panel.querySelector("#ldb-bookmark-settings-jump");
        if (bookmarkJumpBtn) {
            bookmarkJumpBtn.onclick = () => {
                const bookmarksTab = panel.querySelector('[data-tab="bookmarks"]');
                if (bookmarksTab) bookmarksTab.click();
            };
        }

        // F-UI-32:空状态 CTA 复用加载按钮
        if (refs.bookmarkEmptyLoad) {
            refs.bookmarkEmptyLoad.onclick = () => refs.loadBookmarksBtn.click();
        }

        // 加载收藏
        refs.loadBookmarksBtn.onclick = async () => {
            const btn = refs.loadBookmarksBtn
            btn.disabled = true;
            btn.innerHTML = '<span class="ldb-spin">🔄</span> 加载中...';
            // P3 共识(dsf+qwen): 记录发起时来源, await 期间用户可能切换来源
            const loadSource = UI.getActiveBookmarkSource();

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
                        // P4 收敛(c13): 与 Linux.do 分支同口径 —— 加载期间切换来源后不再写计数
                        if (loadSource === UI.getActiveBookmarkSource() && UI.refs?.bookmarkCount) {
                            UI.refs.bookmarkCount.textContent = allItems.length;
                        }
                    }
                    bookmarks = allItems;
                } else {
                    const username = await Utils.getCurrentLinuxDoUsernameAsync();
                    if (!username) {
                        UI.showStatus("无法获取当前 Linux.do 用户名，请先登录后重试", "error");
                        return;
                    }
                    bookmarks = await LinuxDoAPI.fetchAllBookmarks(username, (count) => {
                        // P4 收敛(c13): 加载期间切换来源后不再写计数(与最终结果丢弃同源)
                        if (loadSource !== UI.getActiveBookmarkSource()) return;
                        if (UI.refs?.bookmarkCount) UI.refs.bookmarkCount.textContent = count;
                    });
                }

                // P3 共识(dsf+qwen): 加载期间切换来源时丢弃陈旧结果——否则旧来源数据
                // 覆盖新来源列表与选中集, 展示与导出统计错配。
                if (loadSource !== UI.getActiveBookmarkSource()) return;
                UI.bookmarks = bookmarks;
                UI.updateVisualSnapshot(UI.getActiveBookmarkSource(), bookmarks);
                UI.selectedBookmarks = new Set(bookmarks.map(b => UI.getBookmarkKey(b)));
                UI.recomputeExportStats();
                UI.refs.bookmarkCount.textContent = bookmarks.length;
                // v3.14.7 (REV-26 UI-19): 加载后不再无条件启用导出按钮——
                // 配置不完整时按钮可点且 title 提示矛盾; 经 readiness 统一判定。
                updateExportButtonState();
                UI.refs.obsExportBtn.disabled = false;

                // 渲染收藏列表
                UI.renderBookmarkList();
                UI.refs.bookmarkListContainer.style.display = "block";
                // F-UI-32:加载成功后隐藏空状态引导
                if (UI.refs.bookmarkEmptyState) UI.refs.bookmarkEmptyState.style.display = "none";

                const sourceText = UI.isActiveGitHubSource() ? "GitHub 收藏" : "Linux.do 收藏";
                UI.showStatus(`成功加载 ${bookmarks.length} 个${sourceText}`, "success");
            } catch (error) {
                UI.showStatus(`加载失败: ${error.message}`, "error");
            } finally {
                btn.disabled = false;
                btn.innerHTML = "🔄 加载收藏列表";
            }
        };

        // F-02 修复：筛选/参数控件变更即时持久化，避免未点导出丢失
        const bindFilterPersistence = (el, key, parse) => {
            if (!el) return;
            el.addEventListener("change", () => { Storage.set(key, parse(el)); });
        };
        const numOr = (el, d) => { const n = parseInt(el.value, 10); return Number.isFinite(n) ? n : d; };
        bindFilterPersistence(refs.onlyFirstCheckbox, CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST, (el) => !!el.checked);
        bindFilterPersistence(refs.onlyOpCheckbox, CONFIG.STORAGE_KEYS.FILTER_ONLY_OP, (el) => !!el.checked);
        bindFilterPersistence(refs.rangeStartInput, CONFIG.STORAGE_KEYS.FILTER_RANGE_START, (el) => numOr(el, CONFIG.DEFAULTS.rangeStart));
        bindFilterPersistence(refs.rangeEndInput, CONFIG.STORAGE_KEYS.FILTER_RANGE_END, (el) => numOr(el, CONFIG.DEFAULTS.rangeEnd));
        bindFilterPersistence(refs.imgModeSelect, CONFIG.STORAGE_KEYS.IMG_MODE, (el) => el.value);
        bindFilterPersistence(refs.requestDelaySelect, CONFIG.STORAGE_KEYS.REQUEST_DELAY, (el) => numOr(el, CONFIG.DEFAULTS.requestDelay));
        bindFilterPersistence(refs.exportConcurrencySelect, CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY, (el) => numOr(el, CONFIG.DEFAULTS.exportConcurrency));
        bindFilterPersistence(refs.filterImgSelect, CONFIG.STORAGE_KEYS.FILTER_IMG, (el) => el.value);
        bindFilterPersistence(refs.filterUsersInput, CONFIG.STORAGE_KEYS.FILTER_USERS, (el) => el.value.trim());
        bindFilterPersistence(refs.filterIncludeInput, CONFIG.STORAGE_KEYS.FILTER_INCLUDE, (el) => el.value.trim());
        bindFilterPersistence(refs.filterExcludeInput, CONFIG.STORAGE_KEYS.FILTER_EXCLUDE, (el) => el.value.trim());
        bindFilterPersistence(refs.filterMinLenInput, CONFIG.STORAGE_KEYS.FILTER_MINLEN, (el) => numOr(el, CONFIG.DEFAULTS.filterMinLen));

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

            const chatInput = panel.querySelector("#ldb-chat-input");
            if (chatInput && ChatUI.sendMessage) {
                // F-UI-33:AI 忙时不再给出误导性「正在导入」反馈
                if (ChatState.isProcessing) {
                    UI.showStatus("AI 正在处理上一条指令，请稍候再试", "info");
                    return;
                }
                UI.showStatus("正在导入浏览器书签，请耐心等待...", "info");
                chatInput.value = "导入浏览器书签";
                ChatUI.sendMessage();
            } else {
                UI.showStatus("AI 面板未就绪，请稍后重试", "error");
            }
        };

        // 20260914: 书签写回整理 —— scan→预览确认→备份→执行; 移动优先零删除, 可撤销
        const syncUndoOrganizeBtn = () => {
            if (refs.undoOrganizeBtn) {
                refs.undoOrganizeBtn.style.display = BookmarkOrganizer.getUndoCount() > 0 ? "" : "none";
            }
        };
        syncUndoOrganizeBtn();
        if (refs.organizeBookmarksBtn) {
            refs.organizeBookmarksBtn.onclick = async () => {
                if (!BookmarkBridge.isExtensionAvailable()) {
                    UI.showStatus("书签整理需要 LD-Notion 书签桥接扩展（用户脚本模式无浏览器书签写权限）", "error");
                    return;
                }
                const btn = refs.organizeBookmarksBtn;
                const setStatus = (text, kind) => UI.showStatus(text, kind || "info");
                try {
                    btn.disabled = true;
                    const goOn = await ConfirmationDialog.show({
                        title: "整理浏览器书签",
                        message: "将扫描：① 重复书签（同 URL 仅保留最早一条）\n② 失效链接（HTTP 4xx/无法访问，最多检测 500 个，可能耗时几分钟）\n③ 根目录散落书签（若已配置 AI Key 则自动归类到现有文件夹）\n\n所有动作仅移动到「LD-Notion 整理/」文件夹，不删除任何书签；执行前会自动下载全量备份。",
                        confirmText: "开始扫描",
                        countdown: 0,
                    });
                    if (!goOn) return;
                    setStatus("正在扫描书签树…");
                    const { plan } = await BookmarkOrganizer.scan({ checkDeadLinks: true, classifyWithAI: true });
                    const totalMoves = plan.deadCount + plan.dupCount + plan.looseCount;
                    if (totalMoves === 0) {
                        setStatus("扫描完成：未发现重复/失效/待归类书签，无需整理", "success");
                        return;
                    }
                    const previewLines = [
                        `重复书签: ${plan.dupCount} 条`,
                        `失效链接: ${plan.deadCount} 条${plan.deadLinkSkipped > 0 ? `（另有 ${plan.deadLinkSkipped} 个 URL 未检测，超出单次上限）` : ""}`,
                        `AI 归类: ${plan.looseCount} 条${plan.aiNotice ? `\n（${plan.aiNotice}）` : ""}`,
                        "",
                        ...plan.preview.duplicates.slice(0, 3),
                        ...plan.preview.dead.slice(0, 3),
                        ...plan.preview.loose.slice(0, 3),
                        "",
                        `共 ${totalMoves} 条书签将被移动到「${BookmarkOrganizer.ORGANIZE_ROOT_TITLE}/」下，不删除；执行前自动备份。确认执行？`,
                    ];
                    const confirmed = await ConfirmationDialog.show({
                        title: "整理预览",
                        message: previewLines.join("\n"),
                        confirmText: `执行整理（${totalMoves} 条）`,
                        countdown: 0,
                    });
                    if (!confirmed) {
                        setStatus("已取消整理");
                        return;
                    }
                    setStatus("正在执行整理（已先下载备份）…");
                    const report = await BookmarkOrganizer.execute(plan);
                    setStatus(`整理完成: 移动 ${report.movedCount} 条到「LD-Notion 整理/」（重复 ${plan.dupCount}/失效 ${plan.deadCount}/归类 ${plan.looseCount}）；备份 ${report.backupFile}${report.failedCount ? `；失败 ${report.failedCount} 条` : ""}`, report.failedCount ? "error" : "success");
                    syncUndoOrganizeBtn();
                } catch (error) {
                    setStatus(`整理失败: ${error.message || error}`, "error");
                } finally {
                    btn.disabled = false;
                }
            };
        }
        if (refs.undoOrganizeBtn) {
            refs.undoOrganizeBtn.onclick = async () => {
                try {
                    const goOn = await ConfirmationDialog.show({
                        title: "撤销上次整理",
                        message: `将把上次整理移动的 ${BookmarkOrganizer.getUndoCount()} 条书签移回原位置，确认？`,
                        confirmText: "撤销",
                        countdown: 0,
                    });
                    if (!goOn) return;
                    const report = await BookmarkOrganizer.undoLast();
                    UI.showStatus(`已移回 ${report.movedCount} 条书签`, "success");
                    syncUndoOrganizeBtn();
                } catch (error) {
                    UI.showStatus(`撤销失败: ${error.message || error}`, "error");
                }
            };
        }

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
            // P2:原生 confirm 统一为 ConfirmationDialog
            ConfirmationDialog.show({
                title: "取消导出",
                message: "确定要取消导出吗？已导出的内容不会被删除。",
                confirmText: "取消导出",
                onConfirm: () => Exporter.cancel(),
            });
        };

        // 导出按钮可用性：配置不完整时提前禁用（避免点击后才报错）
        const updateExportButtonState = () => {
            const apiKey = NotionOAuth.getAccessToken(refs.apiKeyInput.value.trim());
            const targetType = refs.exportTargetPageRadio.checked ? "page" : "database";
            const databaseId = refs.databaseIdInput.value.trim();
            const parentPageId = refs.parentPageIdInput.value.trim();
            const ready = Boolean(apiKey) && (targetType === "page" ? Boolean(parentPageId) : Boolean(databaseId));
            refs.exportBtn.disabled = !ready;
            refs.exportBtn.title = ready ? "" : "请先完成 Notion 配置（API Key 与导出目标）";
        };
        updateExportButtonState();
        // P3: 暴露给跨页同步/工作区选择回填复用(避免程序赋值绕过就绪判定)
        UI.updateExportButtonState = updateExportButtonState;

        // 开始导出
        // 导出/Obsidian/日志/去重数据管理 → src/ui/events/export-bindings.js (M3 拆分)
        require("./events/export-bindings").bindExport({ UI, panel, refs, getInputValue, getSensitiveValue, updateExportButtonState, syncUndoOrganizeBtn });

        // F-UI-04:AI 调用链追踪查看/清除(AgentTrace 落盘但此前 UI 零引用)
        const renderAiTraces = () => {
            const resultEl = refs.aiTracesResult;
            if (!resultEl) return;
            const traces = AgentTrace.list();
            if (!traces.length) {
                resultEl.innerHTML = '<span class="ldb-hint">暂无 AI 调用链记录。</span>';
                return;
            }
            const rows = traces.slice(-10).reverse().map((t) => {
                const ts = t?.ts ? new Date(t.ts).toLocaleString("zh-CN", { hour12: false }) : "";
                const status = t?.status || "unknown";
                const summary = (t?.summary || t?.error || "").slice(0, 80);
                return `<div style="padding: 4px 0; border-bottom: 1px solid var(--ldb-ui-border); font-size: var(--ldb-ui-font-size-sm);">`
                    + `<span style="color: var(--ldb-ui-muted);">${Utils.escapeHtml(ts)}</span> `
                    + `<span class="ldb-status-text ldb-status-text--${status === "completed" ? "success" : "danger"}">${Utils.escapeHtml(status)}</span> `
                    + `<span>${Utils.escapeHtml(summary)}</span></div>`;
            }).join("");
            resultEl.innerHTML = `<div style="max-height: 180px; overflow-y: auto;">${rows}</div>`
                + `<div class="ldb-hint" style="margin-top: 4px;">共 ${traces.length} 条，显示最近 10 条。</div>`;
        };
        if (refs.viewAiTracesBtn) {
            refs.viewAiTracesBtn.onclick = renderAiTraces;
        }
        if (refs.clearAiTracesBtn) {
            refs.clearAiTracesBtn.onclick = () => {
                // P2:原生 confirm 统一为 ConfirmationDialog
                ConfirmationDialog.show({
                    title: "清除 AI 调用链",
                    message: "确定清除所有 AI 调用链记录吗？",
                    confirmText: "清除",
                    onConfirm: () => {
                        AgentTrace.clear();
                        renderAiTraces();
                        UI.showStatus("AI 调用链记录已清除", "success");
                    },
                });
            };
        }

        // F-UI-18:重置面板尺寸(清除持久化尺寸并恢复默认)
        if (refs.resetPanelSizeBtn) {
            refs.resetPanelSizeBtn.onclick = () => {
                PanelResize.resetSize(CONFIG.STORAGE_KEYS.PANEL_SIZE_MAIN);
                UI.showStatus("面板尺寸已重置", "success");
            };
        }

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
            updateExportButtonState();
            UI.updateExportTargetSummary();
        };
        refs.databaseIdInput.onchange = (e) => {
            void UICommandService.execute("apply_workspace_selection", { selectedValue: `database:${e.target.value.trim()}` });
            updateExportButtonState();
            UI.updateExportTargetSummary();
        };

        // 手动输入数据库 ID 开关
        refs.toggleManualDbBtn.onclick = () => {
            const wrap = refs.manualDbWrap
            const visible = wrap.style.display !== "none";
            wrap.style.display = visible ? "none" : "block";
        };

        // 刷新工作区页面列表
        // 切换目标时即时重算可见性警告(odyssey-debug 20260913):刷新时旧 ID 占位渲染的警告
        // 在用户选中新库后不再适用,不能等到下次刷新才消失
        let lastWorkspaceTargets = null;
        const renderWorkspaceTip = (workspaceData, configuredId) => {
            const tip = refs.workspaceTip;
            if (!tip) return;
            const noDbHint = workspaceData.databases.length === 0 ? MSG.WORKSPACE_NO_DATABASES_HINT : "";
            const targetWarn = buildConfiguredTargetWarning({
                configuredDatabaseId: configuredId,
                databases: workspaceData.databases,
            });
            tip.textContent = `✅ 获取到 ${workspaceData.databases.length} 个数据库，${workspaceData.pages.length} 个页面${noDbHint}${targetWarn}`;
            tip.style.color = "var(--ldb-ui-success)";
        };

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
                // F-UI-13:统一走 UICommandService 命令边界(与 #ldb-ai-refresh-dbs 一致)
                const { workspaceData } = await UICommandService.execute("refresh_workspace_targets", {
                    apiKey,
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
                lastWorkspaceTargets = workspaceData;
                renderWorkspaceTip(workspaceData, refs.databaseIdInput?.value?.trim());
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
                    UI.showStatus(`下载工作区报告失败：${error.message}`, "error");
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
                // F-UI-22:loading 态 + 重入保护(与 generateWorkspaceInsight 模式一致)
                if (refs.viewSaveWorkspacePackageBtn.disabled) return;
                const originalText = refs.viewSaveWorkspacePackageBtn.textContent;
                refs.viewSaveWorkspacePackageBtn.disabled = true;
                refs.viewSaveWorkspacePackageBtn.textContent = "保存中...";
                try {
                    await UI.saveWorkspaceCollaborationPackageToNotion();
                } catch (error) {
                    UI.showStatus(`保存工作区协作包失败：${error.message}`, "error");
                } finally {
                    refs.viewSaveWorkspacePackageBtn.disabled = false;
                    refs.viewSaveWorkspacePackageBtn.textContent = originalText;
                }
            };
        }

        if (refs.viewSaveWorkspaceReportBtn) {
            refs.viewSaveWorkspaceReportBtn.onclick = async () => {
                // F-UI-22:loading 态 + 重入保护
                if (refs.viewSaveWorkspaceReportBtn.disabled) return;
                const originalText = refs.viewSaveWorkspaceReportBtn.textContent;
                refs.viewSaveWorkspaceReportBtn.disabled = true;
                refs.viewSaveWorkspaceReportBtn.textContent = "保存中...";
                try {
                    await UI.saveWorkspaceInsightReportToNotion();
                } catch (error) {
                    UI.showStatus(`保存工作区报告失败：${error.message}`, "error");
                } finally {
                    refs.viewSaveWorkspaceReportBtn.disabled = false;
                    refs.viewSaveWorkspaceReportBtn.textContent = originalText;
                }
            };
        }

        if (refs.viewSaveWorkspaceCandidatesBtn) {
            refs.viewSaveWorkspaceCandidatesBtn.onclick = async () => {
                // F-UI-22:loading 态 + 重入保护
                if (refs.viewSaveWorkspaceCandidatesBtn.disabled) return;
                const originalText = refs.viewSaveWorkspaceCandidatesBtn.textContent;
                refs.viewSaveWorkspaceCandidatesBtn.disabled = true;
                refs.viewSaveWorkspaceCandidatesBtn.textContent = "保存中...";
                try {
                    await UI.saveWorkspaceConnectionCandidatesToNotion();
                } catch (error) {
                    UI.showStatus(`保存统一候选失败：${error.message}`, "error");
                } finally {
                    refs.viewSaveWorkspaceCandidatesBtn.disabled = false;
                    refs.viewSaveWorkspaceCandidatesBtn.textContent = originalText;
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
                    if (lastWorkspaceTargets) renderWorkspaceTip(lastWorkspaceTargets, id);
                } else if (type === "page") {
                    // 页面类型：填入父页面 ID 字段
                    refs.parentPageIdInput.value = id;
                    // 自动切换到页面导出模式
                    refs.exportTargetPageRadio.checked = true;
                    // P3 共识(dsf+glm): 程序赋值不触发 onchange, 需显式刷新按钮可用性/
                    // 目标摘要/区域显示态, 与 database 分支保持一致。
                    handleExportTargetChange({ target: { value: CONFIG.EXPORT_TARGET_TYPES.PAGE } });
                    void UICommandService.execute("apply_workspace_selection", { selectedValue: `page:${id}` });
                    UI.showStatus("已选择页面，自动切换为页面导出模式", "info");
                    if (lastWorkspaceTargets) renderWorkspaceTip(lastWorkspaceTargets, "");
                }
            }
        };

        // === Section 2: AI 对话事件绑定 → src/ui/events/ai-bindings.js (M3 拆分) ===
        // ctx 携带顶层闭包助手(getSensitiveValue/persistSensitiveInput 内部仍调
        // syncSensitiveInputs),模块内直接 import CONFIG/Storage/ChatUI 等。
        require("./events/ai-bindings").bindAISection({ UI, panel, refs, getSensitiveValue, persistSensitiveInput });

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
        syncSensitiveInputs();

        // 拖拽
        UI.makeDraggable(panel, panel.querySelector(".ldb-header"));
    }
};

;

module.exports = { UIEvents };
