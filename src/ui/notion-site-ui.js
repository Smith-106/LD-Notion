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

const NotionSiteUI = {
    panel: null,
    floatBtn: null,
    isMinimized: true,
    isPanelReady: false,

    // 注入样式
    injectStyles: () => {
        DesignSystem.ensureBase();
        DesignSystem.ensureChat();
        StyleManager.injectOnce(DesignSystem.STYLE_IDS.NOTION, `
            /* LDB_UI_NOTION */
            .ldb-notion-float-btn {
                position: fixed;
                right: 24px;
                bottom: 24px;
                width: 52px;
                height: 52px;
                border-radius: var(--ldb-ui-radius-pill);
                border: 1px solid var(--ldb-ui-focus-ring);
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: var(--ldb-ui-white);
                font-size: var(--ldb-ui-font-size-2xl);
                cursor: pointer;
                box-shadow: var(--ldb-ui-shadow-sm);
                z-index: var(--ldb-ui-z-index-float);
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: transform 0.18s ease, box-shadow 0.18s ease;
            }

            .ldb-notion-float-btn:hover {
                transform: translateY(-1px) scale(1.03);
                box-shadow: var(--ldb-ui-shadow);
            }

            .ldb-notion-float-btn:active {
                transform: translateY(0) scale(0.97);
            }

            .ldb-notion-float-btn.dragging {
                transform: none;
                opacity: 0.85;
                cursor: grabbing;
            }

            .ldb-notion-panel {
                position: fixed;
                right: 24px;
                bottom: 96px;
                width: 380px;
                max-width: calc(100vw - 32px);
                max-height: 70vh;
                z-index: var(--ldb-ui-z-index-overlay);
                overflow: hidden;
                display: none;
            }

            .ldb-notion-panel.visible {
                display: block;
            }

            .ldb-notion-header-btns {
                display: flex;
                gap: var(--ldb-ui-spacing-md);
            }

            .ldb-notion-body {
                max-height: calc(70vh - 56px);
                overflow-y: auto;
            }

            .ldb-notion-toggle-section {
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                user-select: none;
                margin-top: var(--ldb-ui-spacing-lg);
                padding: var(--ldb-ui-spacing-md) var(--ldb-ui-spacing-lg);
                border-radius: var(--ldb-ui-radius-sm);
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                color: var(--ldb-ui-text);
            }

            .ldb-notion-toggle-content.collapsed {
                display: none;
            }

            #ldb-notion-status-container {
                margin-top: var(--ldb-ui-spacing-xl);
            }
        `);
    },

    // 创建浮动按钮（可拖拽）
    createFloatButton: () => {
        const btn = document.createElement("button");
        btn.className = "ldb-notion-float-btn";
        btn.setAttribute("data-ldb-root", "");
        btn.innerHTML = "🤖";
        btn.title = "AI 助手";

        // 拖拽状态
        let isDragging = false;
        let hasMoved = false;
        let offsetX, offsetY;

        btn.addEventListener("mousedown", (e) => {
            isDragging = true;
            hasMoved = false;
            offsetX = e.clientX - btn.getBoundingClientRect().left;
            offsetY = e.clientY - btn.getBoundingClientRect().top;
            btn.classList.add("dragging");
            document.body.style.userSelect = "none";
            e.preventDefault();
        });

        NotionSiteUI._floatDragMove = (e) => {                if (!isDragging) return;
            hasMoved = true;
            const x = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, e.clientX - offsetX));
            const y = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, e.clientY - offsetY));
            btn.style.left = x + "px";
            btn.style.top = y + "px";
            btn.style.right = "auto";
            btn.style.bottom = "auto";            };            document.addEventListener("mousemove", NotionSiteUI._floatDragMove);
        NotionSiteUI._floatDragEnd = () => {                if (!isDragging) return;
            isDragging = false;
            btn.classList.remove("dragging");
            document.body.style.userSelect = "";
            if (hasMoved) {
                const rect = btn.getBoundingClientRect();
                const right = window.innerWidth - rect.right;
                const bottom = window.innerHeight - rect.bottom;
                Storage.set(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION, JSON.stringify({ right: right + "px", bottom: bottom + "px" }));
            }            };            document.addEventListener("mouseup", NotionSiteUI._floatDragEnd);
        btn.addEventListener("click", (e) => {
            if (hasMoved) {
                // 拖拽结束，不触发点击
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            NotionSiteUI.ensurePanelReady();
            NotionSiteUI.togglePanel();
        });

        // 恢复保存的位置
        const savedPosition = Storage.get(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION, null);
        if (savedPosition) {
            try {
                const pos = JSON.parse(savedPosition);
                btn.style.right = pos.right || "24px";
                btn.style.bottom = pos.bottom || "24px";
            } catch (e) {
                console.warn("[LD-Notion] corrupted float btn position, resetting");
                Storage.remove(CONFIG.STORAGE_KEYS.FLOAT_BTN_POSITION);
            }
        }

        document.body.appendChild(btn);
        NotionSiteUI.floatBtn = btn;
        return btn;
    },

    // 创建面板
    createPanel: () => {
        const panel = document.createElement("div");
        const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        panel.className = "ldb-notion-panel";
        panel.setAttribute("data-ldb-root", "");
        panel.innerHTML = `
            <div class="ldb-notion-header">
                <h3>🤖 AI 助手</h3>
                <div class="ldb-notion-header-btns">
                    <button class="ldb-theme-btn" id="ldb-notion-theme-toggle" title="切换主题" style="width:26px;height:26px;border-radius:var(--ldb-ui-radius-xs);font-size:var(--ldb-ui-font-size-md);">🌙</button>
                    <button class="ldb-notion-header-btn" id="ldb-notion-close" title="关闭">×</button>
                </div>
            </div>
            <div class="ldb-notion-body">
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

                <div class="ldb-divider"></div>

                <!-- 设置折叠区 -->
                <div class="ldb-notion-toggle-section" id="ldb-notion-settings-toggle">
                    <span>⚙️ 设置</span>
                    <span id="ldb-notion-settings-arrow">▶</span>
                </div>
                <div class="ldb-notion-toggle-content collapsed" id="ldb-notion-settings-content">
                    <div class="ldb-input-group ldb-mt-12">
                        <label class="ldb-label">Notion API Key</label>
                        <input type="password" class="ldb-input" id="ldb-notion-api-key" placeholder="secret_xxx...">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">Notion OAuth（公开集成）</label>
                        <input type="text" class="ldb-input" id="ldb-notion-oauth-client-id" placeholder="Client ID">
                        <input type="password" class="ldb-input" id="ldb-notion-oauth-client-secret" placeholder="Client Secret" class="ldb-mt-8">
                        <input type="text" class="ldb-input" id="ldb-notion-oauth-redirect-uri" placeholder="Redirect URI" class="ldb-mt-8">
                        <div style="display: flex; gap: var(--ldb-ui-spacing-md); flex-wrap: wrap; margin-top: var(--ldb-ui-spacing-md);">
                            <button class="ldb-btn ldb-btn-primary" id="ldb-notion-oauth-authorize" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-xl);">🔐 一键授权</button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-oauth-clear" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-xl);">断开授权</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-oauth-status" style="margin-top: var(--ldb-ui-spacing-sm);"></div>
                        <div style="display: flex; gap: var(--ldb-ui-spacing-md); flex-wrap: wrap; margin-top: var(--ldb-ui-spacing-md);">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-vault-unlock" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-xl);">解锁保险箱</button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-vault-lock" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-xl);">锁定</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-vault-status" style="margin-top: var(--ldb-ui-spacing-sm);"></div>
                        <div class="ldb-tip">适用于 Notion 公开集成。敏感凭证会保存在本地加密保险箱中，仅在解锁后的当前会话内可用。</div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">数据库 / 页面</label>
                        <div class="ldb-flex-gap">
                            <select class="ldb-select" id="ldb-notion-ai-target-db" class="ldb-flex-1">
                                <option value="">默认（跟随导出数据库）</option>
                                <option value="__all__">所有工作区数据库</option>
                            </select>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-refresh-workspace" class="ldb-nowrap-badge" title="刷新工作区列表">🔄</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-workspace-tip"></div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">AI 服务</label>
                        <select class="ldb-select" id="ldb-notion-ai-service">
                            <option value="openai">OpenAI</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                        </select>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">模型</label>
                        <div class="ldb-flex-gap">
                            <select class="ldb-select" id="ldb-notion-ai-model" class="ldb-flex-1"></select>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-ai-fetch-models" class="ldb-nowrap-badge">🔄 获取</button>
                        </div>
                        <div class="ldb-tip" id="ldb-notion-ai-model-tip"></div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">AI API Key</label>
                        <input type="password" class="ldb-input" id="ldb-notion-ai-api-key" placeholder="AI 服务的 API Key">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">自定义端点 (可选)</label>
                        <input type="text" class="ldb-input" id="ldb-notion-ai-base-url" placeholder="留空使用官方 API">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">分类列表</label>
                        <input type="text" class="ldb-input" id="ldb-notion-ai-categories" placeholder="技术, 生活, 问答, 分享, 资源, 其他">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">刷新页数上限</label>
                        <select class="ldb-select" id="ldb-notion-workspace-max-pages">
                            <option value="5">5 页 (500 条)</option>
                            <option value="10">10 页 (1000 条)</option>
                            <option value="20">20 页 (2000 条)</option>
                            <option value="50">50 页 (5000 条)</option>
                            <option value="0">无限制</option>
                        </select>
                        <div class="ldb-tip">刷新工作区列表时每类的最大分页数</div>
                    </div>
                    <div class="ldb-section-divider">
                        <span class="ldb-hint">🤖 Agent 个性化</span>
                    </div>
                    <div class="ldb-input-group ldb-mt-8">
                        <label class="ldb-label">助手名字</label>
                        <input type="text" class="ldb-input" id="ldb-notion-persona-name" placeholder="AI 助手">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">语气风格</label>
                        <select class="ldb-select" id="ldb-notion-persona-tone">
                            <option value="友好">友好</option>
                            <option value="专业">专业</option>
                            <option value="幽默">幽默</option>
                            <option value="简洁">简洁</option>
                            <option value="热情">热情</option>
                        </select>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">专业领域</label>
                        <input type="text" class="ldb-input" id="ldb-notion-persona-expertise" placeholder="Notion 工作区管理">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">自定义指令 (可选)</label>
                        <textarea class="ldb-input" id="ldb-notion-persona-instructions" rows="2" placeholder="额外的行为指令..." style="resize: vertical;"></textarea>
                    </div>
                    <div class="ldb-section-divider">
                        <span class="ldb-hint">🐙 GitHub 收藏导入</span>
                    </div>
                    <div class="ldb-input-group ldb-mt-8">
                        <label class="ldb-label">GitHub 用户名</label>
                        <input type="text" class="ldb-input" id="ldb-notion-github-username" placeholder="your-username">
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">GitHub Token (可选，提高速率限制)</label>
                        <input type="password" class="ldb-input" id="ldb-notion-github-token" placeholder="ghp_xxx...">
                        <div class="ldb-tip">不填写也可使用，但有 60 次/小时限制</div>
                    </div>
                    <div class="ldb-input-group">
                        <label class="ldb-label">导入类型</label>
                        <div class="ldb-checkbox-group" style="margin-top: var(--ldb-ui-spacing-xs);">
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="stars" checked> ⭐ Stars
                            </label>
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="repos"> 📦 Repos
                            </label>
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="forks"> 🍴 Forks
                            </label>
                            <label class="ldb-checkbox-item">
                                <input type="checkbox" class="ldb-notion-github-type" value="gists"> 📝 Gists
                            </label>
                        </div>
                    </div>
                    <div class="ldb-section-divider">
                        <span class="ldb-hint">📖 浏览器书签导入</span>
                        <div id="ldb-notion-bookmark-status" style="font-size: var(--ldb-ui-font-size-xs); margin-top: var(--ldb-ui-spacing-xs);"></div>
                    </div>
                    <button class="ldb-btn ldb-btn-secondary" id="ldb-notion-save-settings">💾 保存设置</button>
                </div>

                <!-- 状态显示 -->
                <div id="ldb-notion-status-container"></div>
            </div>
        `;

        document.body.appendChild(panel);
        NotionSiteUI.panel = panel;
        NotionSiteUI._abortController = new AbortController();

        // 阻止面板内的键盘和剪贴板事件冒泡到 Notion
        const stopPropagation = (e) => e.stopPropagation();
        panel.addEventListener("copy", stopPropagation);
        panel.addEventListener("paste", stopPropagation);
        panel.addEventListener("cut", stopPropagation);
        panel.addEventListener("keydown", stopPropagation);
        panel.addEventListener("keyup", stopPropagation);
        panel.addEventListener("keypress", stopPropagation);

        return panel;
    },

    ensurePanelReady: () => {
        if (NotionSiteUI.isPanelReady && NotionSiteUI.panel) return;
        NotionSiteUI.createPanel();
        NotionSiteUI.bindEvents();
        NotionSiteUI.loadConfig();

        // 面板可拉伸（左边+上边+左上角）
        PanelResize.makeResizable(NotionSiteUI.panel, {
            edges: ["l", "t", "tl"],
            storageKey: CONFIG.STORAGE_KEYS.PANEL_SIZE_NOTION,
            minWidth: 300,
            minHeight: 250,
        });

        // 初始化对话 UI
        ChatState.load();
        ChatUI.renderMessages();
        ChatUI.bindEvents();
        NotionSiteUI.isPanelReady = true;
    },

    // 切换面板显示
    togglePanel: () => {
        NotionSiteUI.ensurePanelReady();
        if (!NotionSiteUI.panel) return;

        NotionSiteUI.isMinimized = !NotionSiteUI.isMinimized;

        if (NotionSiteUI.isMinimized) {
            NotionSiteUI.panel.classList.remove("visible");
        } else {
            NotionSiteUI.panel.classList.add("visible");
        }

        Storage.set(CONFIG.STORAGE_KEYS.NOTION_PANEL_MINIMIZED, NotionSiteUI.isMinimized);
    },

    // 绑定事件
    bindEvents: () => {
        const panel = NotionSiteUI.panel;

        // 快捷命令 chips
        panel.querySelectorAll(".ldb-chat-chip").forEach(chip => {
            chip.onclick = () => {
                const cmd = chip.getAttribute("data-cmd");
                const input = panel.querySelector("#ldb-chat-input");
                if (input && cmd) {
                    input.value = cmd;
                    ChatUI.sendMessage();
                }
            };
        });

        // 关闭按钮
        panel.querySelector("#ldb-notion-close").onclick = () => {
            NotionSiteUI.togglePanel();
        };

        // 主题切换
        panel.querySelector("#ldb-notion-theme-toggle").onclick = () => {
            DesignSystem.toggleTheme();
        };

        // 设置折叠
        panel.querySelector("#ldb-notion-settings-toggle").onclick = () => {
            const content = panel.querySelector("#ldb-notion-settings-content");
            const arrow = panel.querySelector("#ldb-notion-settings-arrow");
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
        };

        // 保存设置
        panel.querySelector("#ldb-notion-save-settings").onclick = async () => {
            try {
                await UICommandService.execute("save_command_boundary_settings", {
                    scope: "notion-site",
                    liveApiKey: panel.querySelector("#ldb-notion-api-key").value.trim(),
                    clearManualApiKey: true,
                    aiTargetValue: panel.querySelector("#ldb-notion-ai-target-db").value,
                    aiService: panel.querySelector("#ldb-notion-ai-service").value,
                    aiModel: panel.querySelector("#ldb-notion-ai-model").value,
                    aiApiKey: panel.querySelector("#ldb-notion-ai-api-key").value.trim(),
                    aiBaseUrl: panel.querySelector("#ldb-notion-ai-base-url").value.trim(),
                    aiCategories: panel.querySelector("#ldb-notion-ai-categories").value.trim(),
                    workspaceMaxPages: parseInt(panel.querySelector("#ldb-notion-workspace-max-pages").value) || 0,
                    personaName: panel.querySelector("#ldb-notion-persona-name").value.trim() || CONFIG.DEFAULTS.agentPersonaName,
                    personaTone: panel.querySelector("#ldb-notion-persona-tone").value,
                    personaExpertise: panel.querySelector("#ldb-notion-persona-expertise").value.trim() || CONFIG.DEFAULTS.agentPersonaExpertise,
                    personaInstructions: panel.querySelector("#ldb-notion-persona-instructions").value.trim(),
                    githubUsername: panel.querySelector("#ldb-notion-github-username").value.trim(),
                    githubToken: panel.querySelector("#ldb-notion-github-token").value.trim(),
                    githubImportTypes: [...panel.querySelectorAll(".ldb-notion-github-type:checked")].map(cb => cb.value),
                });
                NotionOAuth.syncApiKeyInputs();
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-ai-api-key"), CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-github-token"), CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
                NotionSiteUI.showStatus("设置已保存", "success");
            } catch (error) {
                NotionSiteUI.showStatus(`设置保存失败: ${error.message}`, "error");
            }
        };

        // 刷新数据库列表（合并后的唯一刷新按钮）
        panel.querySelector("#ldb-notion-refresh-workspace").onclick = async () => {
            const liveApiKey = panel.querySelector("#ldb-notion-api-key").value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const refreshBtn = panel.querySelector("#ldb-notion-refresh-workspace");
            const workspaceTip = panel.querySelector("#ldb-notion-workspace-tip");

            if (!apiKey) {
                NotionSiteUI.showStatus(MSG.NO_NOTION_KEY, "error");
                return;
            }

            refreshBtn.disabled = true;
            refreshBtn.innerHTML = "⏳";
            workspaceTip.style.color = "";
            workspaceTip.textContent = "正在获取数据库列表...";

            try {
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
                        NotionSiteUI.updateAITargetDbOptions(workspaceData.databases, workspaceData.pages);

                        if (meta.phase === "databases") {
                            workspaceTip.textContent = `✅ 已加载 ${workspaceData.databases.length} 个数据库，可先选择目标；页面列表继续加载中...`;
                            workspaceTip.style.color = "var(--ldb-ui-success)";
                        }
                    },
                });

                NotionSiteUI.updateAITargetDbOptions(workspaceData.databases, workspaceData.pages);
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

        // 数据库/页面下拉框选择变更
        panel.querySelector("#ldb-notion-ai-target-db").onchange = (e) => {
            void UICommandService.execute("select_ai_target", { targetValue: e.target.value });
        };

        // AI 服务切换 - 更新模型列表并保存（优先使用缓存）
        panel.querySelector("#ldb-notion-ai-service").onchange = (e) => {
            const newService = e.target.value;
            Storage.set(CONFIG.STORAGE_KEYS.AI_SERVICE, newService);
                const availableModels = AIService.getAvailableModels(newService);
                NotionSiteUI.updateAIModelOptions(newService, availableModels.length > 0 ? availableModels : undefined);
            // 重置模型为新服务的默认模型
            const provider = AIService.PROVIDERS[newService];
            if (provider?.defaultModel) {
                Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, provider.defaultModel);
            }
        };

        // AI 模型切换 - 保存选择
        panel.querySelector("#ldb-notion-ai-model").onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.AI_MODEL, e.target.value);
        };

        // 获取模型列表
        panel.querySelector("#ldb-notion-ai-fetch-models").onclick = async () => {
            const aiApiKey = panel.querySelector("#ldb-notion-ai-api-key").value.trim()
                || String(Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "") || "").trim();
            const aiService = panel.querySelector("#ldb-notion-ai-service").value;
            const aiBaseUrl = panel.querySelector("#ldb-notion-ai-base-url").value.trim();
            const fetchBtn = panel.querySelector("#ldb-notion-ai-fetch-models");
            const modelTip = panel.querySelector("#ldb-notion-ai-model-tip");

            if (!aiApiKey) {
                NotionSiteUI.showStatus(MSG.NO_AI_KEY, "error");
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
                NotionSiteUI.updateAIModelOptions(aiService, models, true);
                modelTip.textContent = `✅ 获取到 ${models.length} 个可用模型`;
                modelTip.style.color = "var(--ldb-ui-success)";
            } catch (error) {
                modelTip.textContent = `❌ ${error.message}`;
                modelTip.style.color = "var(--ldb-ui-danger)";
            } finally {
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = "🔄 获取";
            }
        };

        // 拖拽面板
        NotionSiteUI.makeDraggable(panel, panel.querySelector(".ldb-notion-header"));

        NotionOAuth.attachControls({
            root: panel,
            selectors: {
                clientIdInput: "#ldb-notion-oauth-client-id",
                clientSecretInput: "#ldb-notion-oauth-client-secret",
                redirectUriInput: "#ldb-notion-oauth-redirect-uri",
                authorizeBtn: "#ldb-notion-oauth-authorize",
                clearBtn: "#ldb-notion-oauth-clear",
                statusEl: "#ldb-notion-oauth-status",
            },
            notify: (message, type) => NotionSiteUI.showStatus(message, type),
        });
        CredentialVault.attachControls({
            root: panel,
            selectors: {
                statusEl: "#ldb-notion-vault-status",
                unlockBtn: "#ldb-notion-vault-unlock",
                lockBtn: "#ldb-notion-vault-lock",
            },
            notify: (message, type) => NotionSiteUI.showStatus(message, type),
            onAfterSync: () => {
                NotionOAuth.syncApiKeyInputs();
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-ai-api-key"), CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
                CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-github-token"), CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");
            },
        });
    },

    // 加载配置
    loadConfig: () => {
        const panel = NotionSiteUI.panel;

        panel.querySelector("#ldb-notion-api-key").value = "";
        panel.querySelector("#ldb-notion-ai-service").value = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
        panel.querySelector("#ldb-notion-ai-api-key").value = "";
        panel.querySelector("#ldb-notion-ai-base-url").value = Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, "");
        panel.querySelector("#ldb-notion-ai-categories").value = Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories);
        panel.querySelector("#ldb-notion-workspace-max-pages").value = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES, CONFIG.DEFAULTS.workspaceMaxPages);

        // 加载 Agent 个性化设置
        panel.querySelector("#ldb-notion-persona-name").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
        panel.querySelector("#ldb-notion-persona-tone").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone);
        panel.querySelector("#ldb-notion-persona-expertise").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise);
        panel.querySelector("#ldb-notion-persona-instructions").value = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions);

        // 加载 GitHub 设置
        panel.querySelector("#ldb-notion-github-username").value = Storage.get(CONFIG.STORAGE_KEYS.GITHUB_USERNAME, "");
        panel.querySelector("#ldb-notion-github-token").value = "";
        // 加载 GitHub 导入类型
        const savedGHTypes = GitHubAPI.getImportTypes();
        panel.querySelectorAll(".ldb-notion-github-type").forEach(cb => {
            cb.checked = savedGHTypes.includes(cb.value);
        });

        // 书签扩展状态
        const bmStatus = panel.querySelector("#ldb-notion-bookmark-status");
        if (bmStatus) {
            if (BookmarkBridge.isExtensionAvailable()) {
                bmStatus.innerHTML = '<span style="color: var(--ldb-ui-success);">✅ 扩展已安装</span> — 在 AI 对话中输入「导入书签」即可';
            } else {
                bmStatus.innerHTML = `<span style="color: var(--ldb-ui-danger);">❌ 扩展未安装</span> — ${InstallHelper.renderInstallLink("一键安装浏览器扩展")}`;
            }
        }

        // 加载数据库/页面下拉框（始终调用以确保兼容选项被添加）
        const cachedWsForDb = Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}");
        let cachedDatabases = [];
        let cachedPages = [];
        try {
            const wsData = JSON.parse(cachedWsForDb);
            cachedDatabases = wsData.databases || [];
            cachedPages = wsData.pages || [];
        } catch { cachedDatabases = []; cachedPages = []; }
        NotionSiteUI.updateAITargetDbOptions(cachedDatabases, cachedPages);

        // 加载 AI 模型选项（优先使用缓存的模型列表）
        const aiService = Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
        const notionSiteModels = AIService.getAvailableModels(aiService);
        NotionSiteUI.updateAIModelOptions(aiService, notionSiteModels.length > 0 ? notionSiteModels : undefined);

        // 设置保存的模型
        const savedModel = Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
        if (savedModel) {
            const modelSelect = panel.querySelector("#ldb-notion-ai-model");
            const optionExists = Array.from(modelSelect.options).some(opt => opt.value === savedModel);
            if (optionExists) {
                modelSelect.value = savedModel;
            }
        }

        // 恢复面板位置
        const savedPosition = Storage.get(CONFIG.STORAGE_KEYS.NOTION_PANEL_POSITION, null);
        if (savedPosition) {
            try {
                const pos = JSON.parse(savedPosition);
                panel.style.right = pos.right || "24px";
                panel.style.bottom = pos.bottom || "96px";
            } catch (e) {
                console.warn("[LD-Notion] corrupted panel position, resetting");
                Storage.remove(CONFIG.STORAGE_KEYS.NOTION_PANEL_POSITION);
            }
        }

        NotionOAuth.syncApiKeyInputs();
        CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-ai-api-key"), CONFIG.STORAGE_KEYS.AI_API_KEY, "AI 服务的 API Key");
        CredentialVault.syncSensitiveInput(panel.querySelector("#ldb-notion-github-token"), CONFIG.STORAGE_KEYS.GITHUB_TOKEN, "ghp_xxx...");

    },

    getAITargetDefaultOptionLabel: (databases = []) => {
        const effectiveState = TargetState.getEffectiveAITargetState();
        if (effectiveState.mode !== "database" || !effectiveState.databaseId) {
            return "默认（未设置导出数据库）";
        }

        const fallbackDb = databases.find(db => db.id === effectiveState.databaseId);
        const fallbackName = fallbackDb?.title || `ID: ${effectiveState.databaseId.slice(0, 8)}...`;
        return `默认（跟随导出数据库：${fallbackName}）`;
    },

    getAITargetPageParentType: (page) => {
        if (typeof page?.parent === "string") return page.parent;
        return String(page?.parent?.type || "").trim();
    },

    getAITargetPageParentLabel: (page, { databases = [], pages: allPages = [] } = {}) => {
        const parentType = NotionSiteUI.getAITargetPageParentType(page);
        const parentId = page?.parentId;
        let parentName = "";
        if (parentId) {
            const parentDb = databases.find(db => db.id === parentId);
            if (parentDb) parentName = parentDb.title;
            else {
                const parentPage = allPages.find(p => p.id === parentId);
                if (parentPage) parentName = parentPage.title;
            }
        }
        if (parentType === "database_id") {
            return parentName ? "数据库「" + parentName + "」内" : "数据库条目";
        }
        if (parentType === "page_id") {
            return parentName ? "页面「" + parentName + "」下" : "子页面";
        }
        if (parentType === "block_id") return "块内页面";
        if (parentType === "workspace") return "工作区页面";
        return parentType ? "非顶级页面" : "";
    },

    getAITargetPageOptionLabel: (page, { includeParentLabel = false, databases = [], pages: allPages = [] } = {}) => {
        const title = String(page?.title || "").trim() || "未命名页面";
        const parentType = NotionSiteUI.getAITargetPageParentType(page);
        const parentLabel = NotionSiteUI.getAITargetPageParentLabel(page, { databases, pages: allPages });
        const prefix = parentType === "workspace" ? "📄" : "↳";

        if (!includeParentLabel || !parentLabel || parentType === "workspace") {
            return prefix + " " + title;
        }
        return prefix + " " + title + "（" + parentLabel + "）";
    },

    getAITargetCompatibilityOptionLabel: (savedValue, { storedTarget, databases = [], pages = [] } = {}) => {
        if (!savedValue) return "";

        const effectiveState = TargetState.getEffectiveAITargetState();
        if (
            !storedTarget?.exists
            && effectiveState.mode === "database"
            && effectiveState.databaseId === savedValue
        ) {
            return NotionSiteUI.getAITargetDefaultOptionLabel(databases);
        }

        const parsedTarget = TargetState.parseAITarget(savedValue);
        if (parsedTarget.mode === "page" && parsedTarget.pageId) {
            const matchedPage = pages.find(page => page.id === parsedTarget.pageId);
            if (matchedPage) {
                return `${NotionSiteUI.getAITargetPageOptionLabel(matchedPage, {
                    includeParentLabel: NotionSiteUI.getAITargetPageParentType(matchedPage) !== "workspace",
                    databases, pages,
                })}（已保存）`;
            }
            return `已保存页面（当前列表之外，ID: ${parsedTarget.pageId.slice(0, 8)}...）`;
        }

        if (parsedTarget.mode === "database" && parsedTarget.databaseId) {
            const matchedDb = databases.find(db => db.id === parsedTarget.databaseId);
            if (matchedDb) {
                return `📁 ${matchedDb.title}（已保存）`;
            }
            return `已保存数据库（当前列表之外，ID: ${parsedTarget.databaseId.slice(0, 8)}...）`;
        }

        const displayId = savedValue.replace(/^page:/, "");
        return `已保存目标（ID: ${displayId.slice(0, 8)}...）`;
    },

    // 更新数据库/页面下拉框
    updateAITargetDbOptions: (databases, pages = []) => {
        const select = NotionSiteUI.panel.querySelector("#ldb-notion-ai-target-db");
        if (!select) return;

        const storedTarget = TargetState.getStoredAITarget();
        const savedValue = storedTarget.exists ? storedTarget.state.value : "";

        let options = `<option value="">${Utils.escapeHtml(NotionSiteUI.getAITargetDefaultOptionLabel(databases))}</option>`;
        options += '<option value="__all__">所有工作区数据库</option>';

        const knownIds = new Set();
        if (databases.length > 0) {
            options += '<optgroup label="📁 数据库">';
            databases.forEach(db => {
                knownIds.add(db.id);
                options += `<option value="${db.id}">📁 ${Utils.escapeHtml(db.title)}</option>`;
            });
            options += '</optgroup>';
        }

        // 只显示工作区顶级页面（value 带 page: 前缀以区分类型）
        const workspacePages = pages.filter(p => p.parent === "workspace");
        if (workspacePages.length > 0) {
            options += '<optgroup label="📄 页面">';
            workspacePages.forEach(page => {
                const val = `page:${page.id}`;
                knownIds.add(val);
                options += `<option value="${val}">${Utils.escapeHtml(
                    NotionSiteUI.getAITargetPageOptionLabel(page)
                )}</option>`;
            });
            options += '</optgroup>';
        }

        const nestedPages = pages.filter(page => NotionSiteUI.getAITargetPageParentType(page) !== "workspace");
        if (nestedPages.length > 0) {
            options += '<optgroup label="📄 嵌套页面（数据库内/子页面）">';
            nestedPages.forEach(page => {
                const val = `page:${page.id}`;
                knownIds.add(val);
                options += `<option value="${val}">${Utils.escapeHtml(
                    NotionSiteUI.getAITargetPageOptionLabel(page, { includeParentLabel: true, databases, pages })
                )}</option>`;
            });
            options += '</optgroup>';
        }

        // 如果已保存的值不在列表中，添加一个兼容选项
        if (savedValue && savedValue !== "__all__" && !knownIds.has(savedValue)) {
            options += `<option value="${savedValue}">${Utils.escapeHtml(
                NotionSiteUI.getAITargetCompatibilityOptionLabel(savedValue, {
                    storedTarget,
                    databases,
                    pages,
                })
            )}</option>`;
        }

        select.innerHTML = options;

        if (savedValue) {
            select.value = savedValue;
        }
    },

    // 更新 AI 模型选项
    updateAIModelOptions: (service, customModels = null, preserveSelection = false) => {
        const modelSelect = NotionSiteUI.panel.querySelector("#ldb-notion-ai-model");
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
            return `<option value="${model}" ${isSelected ? 'selected' : ''}>${model}</option>`;
        }).join("");
    },

    // 显示状态
    showStatus: (message, type = "info") => {
        const container = NotionSiteUI.panel.querySelector("#ldb-notion-status-container");

        // 清除上一个定时器，避免新消息被旧定时器提前清除
        if (container._statusTimer) clearTimeout(container._statusTimer);

        container.innerHTML = `
            <div class="ldb-status ${Utils.escapeHtml(type)}">
                ${Utils.escapeHtml(message)}
                <button class="ldb-status-close" title="关闭">×</button>
            </div>
        `;

        // 添加关闭按钮事件
        const closeBtn = container.querySelector(".ldb-status-close");
        if (closeBtn) {
            closeBtn.onclick = () => { container.innerHTML = ""; };
        }

        // 错误消息延长显示时间（10秒），其他类型3秒
        const timeout = type === "error" ? 10000 : 3000;
        container._statusTimer = setTimeout(() => {
            container.innerHTML = "";
        }, timeout);
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
            element.style.bottom = "auto";
        };

        document.onmouseup = () => {
            if (isDragging) {
                // 保存位置（使用 right 和 bottom）
                const rect = element.getBoundingClientRect();
                const right = window.innerWidth - rect.right;
                const bottom = window.innerHeight - rect.bottom;
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_PANEL_POSITION, JSON.stringify({ right: right + "px", bottom: bottom + "px" }));
            }
            isDragging = false;
            document.body.style.userSelect = "";
        };
    },

    createAIAssistantSettingsAdapter: () => ({
        isActive: () => !!NotionSiteUI.panel,
        getSettings: ({ getDefaultSettings }) => {
            const notionPanel = NotionSiteUI.panel;
            if (!notionPanel) {
                return getDefaultSettings();
            }

            const aiService = notionPanel.querySelector("#ldb-notion-ai-service")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_SERVICE, CONFIG.DEFAULTS.aiService);
            const selectedModel = notionPanel.querySelector("#ldb-notion-ai-model")?.value || Storage.get(CONFIG.STORAGE_KEYS.AI_MODEL, "");
            const provider = AIService.PROVIDERS[aiService];
            const aiModel = selectedModel || provider?.defaultModel || "";

            return {
                notionApiKey: NotionOAuth.getAccessToken(notionPanel.querySelector("#ldb-notion-api-key")?.value.trim()),
                notionDatabaseId: TargetState.getEffectiveAIDatabaseId({
                    fallbackDatabaseId: Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""),
                    targetValue: notionPanel.querySelector("#ldb-notion-ai-target-db")?.value || "",
                }),
                aiApiKey: notionPanel.querySelector("#ldb-notion-ai-api-key")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: aiService,
                aiModel: aiModel,
                aiBaseUrl: notionPanel.querySelector("#ldb-notion-ai-base-url")?.value.trim() || Storage.get(CONFIG.STORAGE_KEYS.AI_BASE_URL, ""),
                categories: Utils.parseAICategories(
                    notionPanel.querySelector("#ldb-notion-ai-categories")?.value.trim()
                        || Storage.get(CONFIG.STORAGE_KEYS.AI_CATEGORIES, CONFIG.DEFAULTS.aiCategories)
                ),
            };
        }
    }),

    // 初始化 AI 助手模块（复用 AIAssistant）
    initAIAssistant: () => {
        AIAssistant.registerSettingsAdapter("notion-site", NotionSiteUI.createAIAssistantSettingsAdapter());
    },

    // 初始化
    init: () => {
        NotionSiteUI.injectStyles();
        NotionSiteUI.createFloatButton();
        NotionSiteUI.initAIAssistant();

        // 检查是否需要展开
        if (!Storage.get(CONFIG.STORAGE_KEYS.NOTION_PANEL_MINIMIZED, true)) {
            Utils.runWhenBrowserIdle(() => {
                NotionSiteUI.ensurePanelReady();
                NotionSiteUI.isMinimized = false;
                NotionSiteUI.panel.classList.add("visible");
            });
        }
    },

    destroy: () => {
        if (NotionSiteUI._floatDragMove) document.removeEventListener("mousemove", NotionSiteUI._floatDragMove);
        if (NotionSiteUI._floatDragEnd) document.removeEventListener("mouseup", NotionSiteUI._floatDragEnd);
        NotionSiteUI._abortController?.abort();
        NotionSiteUI._abortController = null;
        NotionSiteUI.panel?.remove();
        NotionSiteUI.panel = null;
        NotionSiteUI.floatBtn?.remove();
        NotionSiteUI.floatBtn = null;
        NotionSiteUI.isPanelReady = false;
    },
};

;

module.exports = { NotionSiteUI };
