"use strict";

// events/ai-bindings.js — AI 对话事件绑定 (M3 events.js 拆分波次)。
// 提取自 events.js bindEvents Section 2 (~318 LOC): ChatUI 初始化、AI 服务/模型/
// API Key/目标库绑定、AI 模板管理。
// 共享闭包助手经 ctx 注入(getSensitiveValue/persistSensitiveInput 内部仍调用
// events.js 顶层定义的 syncSensitiveInputs,行为不变)。

const { CONFIG, MSG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage } = require("../../storage");
const { CredentialVault, NotionOAuth } = require("../../auth");
const { buildConfiguredTargetWarning } = require("../../auth/target-discovery");
const { ConfirmationDialog } = require("../../security");
const { UICommandService } = require("../../coordination/UICommandService");
const { ChatUI, AIService } = require("../../ai");

const bindAISection = (ctx) => {
    const { UI, panel, refs, getSensitiveValue, persistSensitiveInput } = ctx;

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
            // P4 收敛(c16): 与 NotionSiteUI 同口径 —— execute 可 reject, 不可裸 void 丢弃
            void UICommandService.execute("select_ai_target", { targetValue: e.target.value })
                .catch((error) => UI.showStatus(`切换 AI 目标失败: ${error.message}`, "error"));
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
        // v3.17: GitHub 收藏源已移除,以下历史 GitHub 用户名/Token/OAuth/导入类型绑定删除。
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
        // v3.17: GitHub 收藏源已移除,以下历史 GitHub 导入类型复选框绑定删除。

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
                // v3.14.18 (debug-odyssey): 0 数据库时附可行动指引(与主面板刷新同口径)
                const aiNoDbHint = workspaceData.databases.length === 0 ? MSG.WORKSPACE_NO_DATABASES_HINT : "";
                // odyssey-debug 20260913: AI 目标刷新同口径校验当前所选目标库可见性
                const aiTargetWarn = buildConfiguredTargetWarning({
                    configuredDatabaseId: refs.aiTargetDbSelect?.value,
                    databases: workspaceData.databases,
                });
                UI.showStatus(`获取到 ${workspaceData.databases.length} 个数据库${aiNoDbHint}${aiTargetWarn}`, "success");
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
                // F-UI-16:文案与初始模板一致(测试连接),避免漂移
                btn.innerHTML = "测试连接";
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
            // v3.14.7 (REV-09 UI-13): 容量上限——防 GM 存储无界增长(超限保留最旧)
            const cap = CONFIG.LIMITS.AI_TEMPLATES_MAX;
            if (Array.isArray(templates) && templates.length > cap) {
                templates = templates.slice(templates.length - cap);
            }
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
                const icon = Utils.escapeHtml(t.icon || "📝");
                const name = Utils.escapeHtml(t.name || "未命名");
                const prompt = Utils.escapeHtml((t.prompt || "").substring(0, 50));
                return `<div class="ldb-setting-row" style="justify-content: space-between; padding: var(--ldb-ui-spacing-3xs) 0;">
                    <span style="font-size: 12px;">${icon} <strong>${name}</strong> <span style="color: var(--ldb-ui-muted);">${prompt}${t.prompt && t.prompt.length > 50 ? "..." : ""}</span></span>
                    <button class="ldb-btn ldb-btn-secondary" data-template-delete="${i}" style="padding: var(--ldb-ui-spacing-3xs) var(--ldb-ui-spacing-sm); font-size: var(--ldb-ui-font-size-xs);">删除</button>
                </div>`;
            }).join("");

            list.querySelectorAll("[data-template-delete]").forEach(btn => {
                btn.onclick = () => {
                    const idx = parseInt(btn.dataset.templateDelete);
                    ConfirmationDialog.show({
                        title: '确认删除',
                        message: '确定要删除此模板吗？此操作无法撤销。',
                        confirmText: '删除',
                        onConfirm: () => {
                            const ts = UI._loadTemplates();
                            ts.splice(idx, 1);
                            UI._saveTemplates(ts);
                            UI.renderTemplateList();
                            UI.showStatus("模板已删除", "success");
                        }
                    });
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
};

module.exports = { bindAISection };
