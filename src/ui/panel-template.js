"use strict";

// panel-template.js — 主面板 HTML 模板 (M3 milestone 拆分: 提取自 ui/main-ui.js createPanel ~815 LOC 模板字面量)。
// 转发壳模式: main-ui.js createPanel 仅保留 DOM 装配 + 事件/ChatUI/配置接线, 模板本体外置本文件。
// 依赖: Utils.escapeHtml (插值净化, 与 AGENTS.md innerHTML 规范一致) + AIWelcomeUI (欢迎块/占位符)。

const { Utils } = require("../utils");
const { AIWelcomeUI } = require("../ai");

/**
 * 渲染主面板 HTML (personaName 注入 AI 欢迎区)。
 * @param {string} personaName AI 助手显示名
 * @returns {string} 面板 innerHTML
 */
function renderPanel(personaName) {
    return `
            <div class="ldb-header">
                <h3>📚 LD-Notion <span class="ldb-runtime-badge" id="ldb-runtime-badge">检测中...</span></h3>
                <div class="ldb-header-btns">
                    <button class="ldb-theme-btn" id="ldb-theme-toggle" title="切换主题" aria-label="切换主题">🌙</button>
                    <button class="ldb-header-btn" id="ldb-minimize" title="最小化" aria-label="最小化面板">−</button>
                    <button class="ldb-header-btn" id="ldb-close" title="关闭" aria-label="关闭面板">×</button>
                </div>
            </div>
            <div class="ldb-tabs" role="tablist" aria-orientation="horizontal">
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
                                <button class="ldb-source-option" id="ldb-source-select-linuxdo" type="button" aria-pressed="true">Linux.do 收藏分区</button>
                                <button class="ldb-source-option" id="ldb-source-select-github" type="button" aria-pressed="false">GitHub 收藏分区</button>
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
                            <!-- F-UI-05:各来源「立即导入」按钮(不依赖 AI 指令,直接触发完整同步) -->
                            <div class="ldb-input-group ldb-mt-12">
                                <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-import-now-linuxdo">立即导入 Linux.do</button>
                                <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-import-now-github">立即导入 GitHub</button>
                                <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-import-now-bookmark">立即导入书签</button>
                            </div>
                            <div class="ldb-tip">立即导入会执行完整同步（拉取 + 写入 Notion + 推进水位），与自动同步路径一致。</div>
                            <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-linuxdo-dedup-mode" style="white-space: nowrap;">Linux.do 导入去重</label>
                                <select id="ldb-linuxdo-dedup-mode" class="ldb-input ldb-flex-1">
                                    <option value="strict">自动去重</option>
                                    <option value="allow_duplicates">允许重复（手动勾选）</option>
                                </select>
                            </div>
                            <div class="ldb-setting-row ldb-flex-center-gap ldb-mb-8">
                                <label for="ldb-export-status-source" style="white-space: nowrap;">导出状态依据</label>
                                <select id="ldb-export-status-source" class="ldb-input ldb-flex-1">
                                    <option value="local">本地账本</option>
                                    <option value="notion">Notion 工作区</option>
                                </select>
                            </div>
                            <div class="ldb-tip" id="ldb-export-status-tip">「本地账本」沿用去重/导出记录；「Notion 工作区」按最近一次工作区快照中的链接判定已导出（只读，不改本地账本）。</div>
                            <div class="ldb-setting-row ldb-mb-8">
                                <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-recompute-export-status" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg);">按 Notion 重算导出状态</button>
                            </div>
                            <div class="ldb-tip" id="ldb-export-status-diff-tip" style="display: none;"></div>
                            <div class="ldb-setting-row ldb-mb-8">
                                <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-align-ledger-to-snapshot" style="padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg);">按快照对齐本地账本（去残留）</button>
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
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-organize-bookmarks">
                                🧹 整理书签
                            </button>
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-undo-organize" style="display: none;">
                                ↩️ 撤销整理
                            </button>
                        </div>

                        <!-- F-UI-32:未加载时的空状态引导 -->
                        <div class="ldb-view-empty" id="ldb-bookmark-empty-state">
                            <div class="ldb-view-empty-title">还没有加载收藏</div>
                            <div class="ldb-view-empty-text">点击下方按钮加载当前来源的收藏列表，加载后可勾选并导出到 Notion。</div>
                            <button class="ldb-btn ldb-btn-primary" id="ldb-bookmark-empty-load" type="button">🔄 加载收藏列表</button>
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

                        <!-- F-UI-35:导出目标/授权/权限只读摘要 -->
                        <div id="ldb-export-target-summary" style="font-size: var(--ldb-ui-font-size-xs); color: var(--ldb-ui-muted); margin-bottom: var(--ldb-ui-spacing-sm);"></div>

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
                        <div class="ldb-view-status" id="ldb-view-workspace-status" aria-live="polite" aria-atomic="true">尚未刷新工作区视图。</div>
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
                        <!-- v3.14.7 (REV-27 UI-13): 聊天容器 aria-live=polite —— AI 流式回复对辅助技术可感知 -->
                        <div class="ldb-chat-container" id="ldb-chat-messages" aria-live="polite" aria-relevant="additions">
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
                            <!-- F-03 修复：批量分类控制（与 Exporter 暂停/取消一致，常驻） -->
                            <span id="ldb-classify-controls">
                                <button class="ldb-chat-action-btn" id="ldb-classify-pause">⏸️ 暂停分类</button>
                                <button class="ldb-chat-action-btn" id="ldb-classify-cancel">✕ 取消分类</button>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- ============ Tab 4: 设置 ============ -->
                <div class="ldb-tab-content" data-tab-content="settings" role="tabpanel" id="ldb-tab-settings">
                    <!-- Notion 配置 -->
                    <div class="ldb-section">
                        <div class="ldb-section-title">Notion 配置</div>
                        <div class="ldb-input-group">
                            <label class="ldb-label">认证方式</label>
                            <div class="ldb-checkbox-group ldb-mb-8" role="radiogroup" aria-label="Notion 认证方式">
                                <label class="ldb-checkbox-item">
                                    <input type="radio" name="ldb-auth-mode" data-ldb-auth-mode="manual" id="ldb-auth-mode-manual" value="manual">
                                    <span>使用 API Key（Internal）</span>
                                </label>
                                <label class="ldb-checkbox-item">
                                    <input type="radio" name="ldb-auth-mode" data-ldb-auth-mode="oauth" id="ldb-auth-mode-oauth" value="oauth">
                                    <span>使用公开 OAuth</span>
                                </label>
                            </div>
                            <div class="ldb-tip" data-ldb-auth-mode-status id="ldb-auth-mode-status">当前启用：API Key</div>
                            <div class="ldb-tip">API Key 与 OAuth 凭证都可预先填写，但只有上方所选模式会被导出 / getAccessToken 使用。</div>
                        </div>
                        <div class="ldb-input-group" data-ldb-auth-section="manual" id="ldb-auth-section-manual">
                                                        <label class="ldb-label" for="ldb-api-key">API Key</label>
                            <input type="password" class="ldb-input" id="ldb-api-key" placeholder="secret_xxx...">
                            <div class="ldb-tip">
                                在 <a href="https://www.notion.so/my-integrations" target="_blank" class="ldb-link">Notion Integrations</a> 创建
                            </div>
                        </div>
                        <div class="ldb-input-group" data-ldb-auth-section="oauth" id="ldb-auth-section-oauth">
                            <label class="ldb-label">公开 OAuth 授权（可选）</label>
                            <input type="text" class="ldb-input" id="ldb-oauth-client-id" placeholder="Client ID" aria-label="OAuth Client ID">
                            <input type="password" class="ldb-input ldb-mt-8" id="ldb-oauth-client-secret" placeholder="Client Secret" aria-label="OAuth Client Secret">
                            <input type="text" class="ldb-input ldb-mt-8" id="ldb-oauth-redirect-uri" placeholder="Redirect URI" aria-label="OAuth Redirect URI">
                            <div style="display: flex; gap: var(--ldb-ui-spacing-md); flex-wrap: wrap; margin-top: var(--ldb-ui-spacing-md);">
                                <button class="ldb-btn ldb-btn-primary" id="ldb-oauth-authorize">🔐 一键授权</button>
                                <button class="ldb-btn ldb-btn-secondary" id="ldb-oauth-clear">断开授权</button>
                            </div>
                            <div class="ldb-tip" id="ldb-oauth-status" style="margin-top: var(--ldb-ui-spacing-sm);"></div>
                            <div class="ldb-tip">如果你使用 Notion 公开集成：① Redirect URI 推荐填共享回调 <code>https://smith-106.github.io/LD-Notion/oauth-callback</code>（须与 Notion 后台逐字符一致；Notion 新连接表单已拒绝 <code>https://www.notion.so/</code>，终端用户无需自建网站）；② Notion 要求公开集成<strong>提交审核并通过后</strong> Authorization URL 才会生效。若授权页提示「客户端 ID 缺失或不完整」，请核对 Client ID 为完整 UUID（不是 Client Secret）、URI 已注册、集成已通过审核。敏感凭证保存在浏览器本地（GM 存储），脚本更新后无需重新输入。</div>
                        </div>
                        <div class="ldb-input-group">
                            <label class="ldb-label" for="ldb-workspace-select">数据库 / 页面</label>
                            <div class="ldb-flex-gap">
                                <select class="ldb-select ldb-flex-1" id="ldb-workspace-select">
                                    <option value="">-- 从工作区选择 --</option>
                                </select>
                                <button class="ldb-btn ldb-btn-secondary ldb-nowrap-badge" id="ldb-refresh-workspace" title="刷新工作区页面列表" aria-label="刷新工作区页面列表">🔄</button>
                            </div>
                            <div class="ldb-input-group" id="ldb-manual-db-wrap" style="display: none; margin-top: var(--ldb-ui-spacing-md);">
                                <input type="text" class="ldb-input ldb-flex-1" id="ldb-database-id" placeholder="手动输入 32 位数据库 ID（高级）">
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
                            <label class="ldb-label" for="ldb-parent-page-id">父页面 ID</label>
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
                                    <input type="number" id="ldb-range-start" value="1" min="1" aria-label="起始楼层">
                                    <span>至</span>
                                    <input type="number" id="ldb-range-end" value="999999" min="1" aria-label="结束楼层">
                                </div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-img-mode">图片处理</label>
                                <select class="ldb-select" id="ldb-img-mode">
                                    <option value="upload">上传到 Notion</option>
                                    <option value="external">外链引用</option>
                                    <option value="skip">跳过图片</option>
                                </select>
                                <div class="ldb-tip">Notion 免费套餐文件需小于 5MB；付费套餐 PDF 小于 20MB、图片小于 5MB。若图片上传报错，脚本会自动尝试按文件上传。</div>
                            </div>
                            <div class="ldb-form-group">
                                <label for="ldb-request-delay">请求间隔</label>
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
                                <label for="ldb-export-concurrency">并发数</label>
                                <select class="ldb-select" id="ldb-export-concurrency">
                                    <option value="1">串行 (1个)</option>
                                    <option value="2">2 个并发</option>
                                    <option value="3">3 个并发</option>
                                    <option value="5">5 个并发</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-filter-img">图片筛选</label>
                                <select class="ldb-select" id="ldb-filter-img">
                                    <option value="all">全部</option>
                                    <option value="only_img">仅含图楼层</option>
                                    <option value="no_img">仅无图楼层</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-filter-users">指定用户</label>
                                <input type="text" class="ldb-input" id="ldb-filter-users" placeholder="user1, user2">
                                <div class="ldb-tip">逗号分隔，仅导出这些用户的回复</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-filter-include">包含关键词</label>
                                <input type="text" class="ldb-input" id="ldb-filter-include" placeholder="教程, 指南">
                                <div class="ldb-tip">逗号分隔，必须包含任一关键词</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-filter-exclude">排除关键词</label>
                                <input type="text" class="ldb-input" id="ldb-filter-exclude" placeholder="广告, 水贴">
                                <div class="ldb-tip">逗号分隔，排除包含关键词的楼层</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-filter-minlen">最少字数</label>
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
                                <label class="ldb-label" for="ldb-ai-service">AI 服务</label>
                                <select class="ldb-select" id="ldb-ai-service">
                                    <option value="openai">OpenAI</option>
                                    <option value="claude">Claude</option>
                                    <option value="gemini">Gemini</option>
                                </select>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-ai-model">模型</label>
                                <div class="ldb-flex-gap">
                                    <select class="ldb-select ldb-flex-1" id="ldb-ai-model"></select>
                                    <button class="ldb-btn ldb-btn-secondary ldb-nowrap-badge" id="ldb-ai-fetch-models">🔄 获取</button>
                                </div>
                                <div class="ldb-tip" id="ldb-ai-model-tip"></div>
                            </div>
                            <div class="ldb-input-group">
                                                            <label class="ldb-label" for="ldb-ai-api-key">API Key</label>
                                <input type="password" class="ldb-input" id="ldb-ai-api-key" placeholder="AI 服务的 API Key">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-ai-base-url">自定义端点 (可选)</label>
                                <input type="text" class="ldb-input" id="ldb-ai-base-url" placeholder="留空使用官方 API">
                                <div class="ldb-tip">支持第三方 OpenAI 兼容 API</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-ai-categories">分类列表</label>
                                <input type="text" class="ldb-input" id="ldb-ai-categories" placeholder="技术, 生活, 问答, 分享, 资源, 其他">
                                <div class="ldb-tip">逗号分隔，用于自动分类功能</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label" for="ldb-ai-target-db">查询数据库</label>
                                <div class="ldb-flex-gap">
                                    <select class="ldb-select ldb-flex-1" id="ldb-ai-target-db">
                                        <option value="">当前配置的数据库</option>
                                        <option value="__all__">所有工作区数据库</option>
                                    </select>
                                    <button class="ldb-btn ldb-btn-secondary ldb-nowrap-badge" id="ldb-ai-refresh-dbs">🔄</button>
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
                                <label class="ldb-label">GitHub 授权（推荐，免手动创建 Token）</label>
                                <div style="display: flex; gap: var(--ldb-ui-spacing-sm); align-items: center; flex-wrap: wrap;">
                                    <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-github-oauth-btn">🔗 通过 GitHub 授权</button>
                                    <span id="ldb-github-oauth-status" class="ldb-tip" style="flex: 1;"></span>
                                </div>
                                <div class="ldb-tip">首次使用需在下方填入 Client ID（github.com/settings/developers 创建 OAuth App 即可，公开信息无需保密）；授权后 Token 自动填入下方输入框，无需手动去 GitHub 生成</div>
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">GitHub OAuth Client ID（授权用，可选）</label>
                                <input type="text" class="ldb-input" id="ldb-github-oauth-client-id" placeholder="Iv1.xxxxxxxxxxxxxxxx">
                            </div>
                            <div class="ldb-input-group">
                                <label class="ldb-label">GitHub Token (可选)</label>
                                <input type="password" class="ldb-input" id="ldb-github-token" placeholder="ghp_xxx...">
                                <div class="ldb-tip">手动粘贴 Personal Access Token（PAT 兑底路径）；推荐用上方「通过 GitHub 授权」自动获取</div>
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

                    <!-- F-UI-42:浏览器书签入口（状态 + 跳转收藏 Tab，不再空壳） -->
                    <div class="ldb-section">
                        <div style="font-size: var(--ldb-ui-font-size-md); font-weight: 700; color: var(--ldb-ui-text);">📖 浏览器书签</div>
                        <div id="ldb-bookmark-ext-status" style="font-size: var(--ldb-ui-font-size-xs); margin-top: var(--ldb-ui-spacing-xs); color: var(--ldb-ui-muted);"></div>
                        <div class="ldb-input-group ldb-mt-12">
                            <button class="ldb-btn ldb-btn-secondary" id="ldb-bookmark-settings-jump" type="button">📚 前往收藏 Tab 配置</button>
                        </div>
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

                    <!-- F-05 修复：数据管理（去重/已导出记录清理） -->
                    <div class="ldb-section">
                        <div class="ldb-section-title">数据管理</div>
                        <div class="ldb-tip" id="ldb-dedup-summary"></div>
                        <div class="ldb-input-group ldb-mt-12">
                            <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-clear-linuxdo-dedup">清除 Linux.do 去重</button>
                            <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-clear-github-exported">清除 GitHub 已导出记录</button>
                            <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-clear-bookmark-exported">清除书签已导出记录</button>
                        </div>
                        <div class="ldb-tip">仅清除本地去重/导出记录，不影响 Notion 中已有内容；清除后对应来源可再次导出。若「导出状态依据」为 Notion 工作区，清空 Notion 后刷新工作区即可全部回到待导出，无需先清本地账本。</div>
                        <!-- F-UI-04:AI 调用链追踪可观测入口 -->
                        <div class="ldb-input-group ldb-mt-12">
                            <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-view-ai-traces">查看 AI 调用链</button>
                            <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-clear-ai-traces">清除 AI 调用链</button>
                            <button type="button" class="ldb-btn ldb-btn-secondary" id="ldb-reset-panel-size">重置面板尺寸</button>
                        </div>
                        <div id="ldb-ai-traces-result" class="ldb-hint" style="margin-top: var(--ldb-ui-spacing-sm);"></div>
                    </div>

                    <!-- 操作日志面板 -->
                    <div class="ldb-log-panel" id="ldb-log-panel">
                        <div class="ldb-log-header" id="ldb-log-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="ldb-log-content">
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
}

module.exports = { renderPanel };
