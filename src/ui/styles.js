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

const UI_CSS = `
            .ldb-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 380px;
                max-width: calc(100vw - 32px);
                max-height: 90vh;
                z-index: 2147483640;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .ldb-panel.minimized {
                width: auto;
                max-height: none;
                overflow: visible;
            }

            .ldb-header {
                cursor: move;
                border-top-left-radius: var(--ldb-ui-radius);
                border-top-right-radius: var(--ldb-ui-radius);
            }

            .ldb-header-btns {
                display: flex;
                gap: 8px;
            }

            .ldb-runtime-badge {
                margin-left: 8px;
                padding: 2px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 700;
                line-height: 1.8;
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                color: var(--ldb-ui-muted);
                vertical-align: middle;
            }

            .ldb-runtime-badge.mode-userscript {
                color: var(--ldb-ui-badge-teal);
                border-color: rgba(13, 148, 136, 0.35);
                background: rgba(20, 184, 166, 0.14);
            }

            .ldb-runtime-badge.mode-extension {
                color: var(--ldb-ui-badge-blue);
                border-color: rgba(37, 99, 235, 0.35);
                background: rgba(59, 130, 246, 0.14);
            }

            .ldb-body {
                overflow-y: auto;
                padding: 14px;
            }

            .ldb-body::-webkit-scrollbar {
                width: 8px;
            }

            .ldb-body::-webkit-scrollbar-track {
                background: transparent;
            }

            .ldb-body::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.25);
                border-radius: 999px;
            }

            .ldb-mini-btn {
                position: fixed;
                right: 20px;
                bottom: 80px;
                width: 52px;
                height: 52px;
                border-radius: 999px;
                border: 1px solid rgba(37, 99, 235, 0.35);
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: #fff;
                font-size: 22px;
                cursor: pointer;
                box-shadow: var(--ldb-ui-shadow-sm);
                z-index: 2147483641;
                display: none;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: transform 0.18s ease, box-shadow 0.18s ease;
            }

            .ldb-mini-btn:hover {
                transform: translateY(-1px) scale(1.03);
                box-shadow: var(--ldb-ui-shadow);
            }

            .ldb-section {
                padding: 10px 0;
            }

            .ldb-btn-group {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
            }

            .ldb-btn-primary {
                /* alias for .ldb-btn */
            }

            .ldb-btn-small {
                padding: 6px 10px;
                border-radius: 10px;
                font-size: 12px;
            }

            .ldb-link {
                color: var(--ldb-ui-accent);
            }

            .ldb-checkbox-group {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                align-items: center;
            }

            .ldb-checkbox-item {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: var(--ldb-ui-text);
                user-select: none;
            }

            .ldb-checkbox-item input[type="checkbox"],
            .ldb-checkbox-item input[type="radio"] {
                accent-color: var(--ldb-ui-accent);
            }

            .ldb-toggle-section {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
                cursor: pointer;
                transition: background 0.15s ease;
            }

            .ldb-toggle-section:hover {
                background: rgba(148, 163, 184, 0.14);
            }

            .ldb-toggle-section:active {
                background: rgba(148, 163, 184, 0.20);
            }

            .ldb-source-option-group {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-bottom: 8px;
            }

            .ldb-source-option {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                color: var(--ldb-ui-text);
                font-size: 12px;
                font-weight: 600;
                border-radius: 10px;
                padding: 8px 10px;
                cursor: pointer;
                transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
                text-align: center;
                font-family: inherit;
            }

            .ldb-source-option:hover {
                border-color: rgba(37, 99, 235, 0.45);
                background: rgba(37, 99, 235, 0.14);
            }

            .ldb-source-option.active {
                border-color: var(--ldb-ui-accent);
                background: rgba(37, 99, 235, 0.18);
                color: var(--ldb-ui-accent);
            }

            .ldb-toggle-switch {
                position: relative;
                display: inline-block;
                width: 44px;
                height: 24px;
            }

            .ldb-toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .ldb-toggle-slider {
                position: absolute;
                cursor: pointer;
                inset: 0;
                background: rgba(148, 163, 184, 0.28);
                border: 1px solid var(--ldb-ui-border);
                transition: background 0.2s ease, border-color 0.2s ease;
                border-radius: 999px;
            }

            .ldb-toggle-slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                top: 50%;
                transform: translateY(-50%);
                background: #fff;
                transition: transform 0.2s ease;
                border-radius: 50%;
                box-shadow: 0 6px 16px rgba(2, 6, 23, 0.18);
            }

            .ldb-toggle-switch input:checked + .ldb-toggle-slider {
                background: rgba(37, 99, 235, 0.45);
                border-color: rgba(37, 99, 235, 0.35);
            }

            .ldb-toggle-switch input:checked + .ldb-toggle-slider:before {
                transform: translateY(-50%) translateX(20px);
            }

            .ldb-toggle-content.collapsed {
                display: none;
            }

            .ldb-progress {
                padding: 10px 12px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-progress-bar {
                height: 10px;
                background: rgba(148, 163, 184, 0.20);
                border-radius: 999px;
                overflow: hidden;
            }

            .ldb-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--ldb-ui-accent), var(--ldb-ui-accent-2));
                border-radius: 999px;
                transition: width 0.3s ease;
            }

            .ldb-progress-text {
                margin-top: 8px;
                font-size: 12px;
                color: var(--ldb-ui-muted);
                display: flex;
                justify-content: space-between;
                gap: 10px;
            }

            .ldb-report {
                margin-top: 12px;
            }
            .ldb-report-title {
                font-size: 14px;
                font-weight: 600;
                margin-bottom: 10px;
            }
            .ldb-report-section {
                margin-bottom: 8px;
            }
            .ldb-report-section-title {
                font-size: 13px;
                font-weight: 500;
                margin-bottom: 6px;
            }
            .ldb-report-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                font-size: 12px;
                border-radius: 6px;
                margin-bottom: 3px;
            }
            .ldb-report-item.success {
                background: rgba(22, 163, 74, 0.06);
            }
            .ldb-report-item.failed {
                background: rgba(220, 38, 38, 0.06);
            }
            .ldb-report-item a {
                color: var(--ldb-ui-accent);
                text-decoration: none;
            }
            .ldb-report-item a:hover {
                text-decoration: underline;
            }
            .ldb-report-error {
                font-size: 11px;
                color: var(--ldb-ui-danger);
                padding: 2px 8px 6px 28px;
                opacity: 0.8;
            }

            .ldb-bookmarks-info {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 12px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-bookmarks-count {
                font-size: 20px;
                font-weight: 800;
                letter-spacing: 0.2px;
                color: var(--ldb-ui-text);
            }

            .ldb-bookmarks-label {
                font-size: 12px;
                color: var(--ldb-ui-muted);
                text-align: right;
            }

            .ldb-view-header {
                margin-bottom: 10px;
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
            }

            .ldb-view-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                flex-wrap: wrap;
            }

            .ldb-view-action-btn {
                padding: 6px 10px;
                font-size: 12px;
                white-space: nowrap;
            }

            .ldb-view-status {
                margin-bottom: 10px;
                font-size: 12px;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-status[data-tone="success"] {
                color: var(--ldb-ui-success);
            }

            .ldb-view-status[data-tone="error"] {
                color: var(--ldb-ui-danger);
            }

            .ldb-view-summary {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .ldb-view-subsection {
                margin-top: 14px;
                padding-top: 14px;
                border-top: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-view-section-title {
                margin-bottom: 8px;
                font-size: 12px;
                font-weight: 700;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
            }

            .ldb-view-card {
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                padding: 12px;
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-view-card.full {
                grid-column: 1 / -1;
            }

            .ldb-view-card-title {
                font-size: 12px;
                font-weight: 700;
                color: var(--ldb-ui-muted);
                margin-bottom: 8px;
            }

            .ldb-view-metric-value {
                font-size: 22px;
                font-weight: 800;
                color: var(--ldb-ui-text);
                line-height: 1.1;
            }

            .ldb-view-metric-meta {
                margin-top: 6px;
                font-size: 12px;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-bars,
            .ldb-view-timeline {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .ldb-view-bar-row {
                display: grid;
                grid-template-columns: minmax(0, 88px) 1fr auto;
                gap: 8px;
                align-items: center;
            }

            .ldb-view-bar-label,
            .ldb-view-timeline-label {
                font-size: 12px;
                color: var(--ldb-ui-text);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .ldb-view-bar-track {
                height: 8px;
                border-radius: 999px;
                overflow: hidden;
                background: rgba(148, 163, 184, 0.20);
            }

            .ldb-view-bar-fill {
                height: 100%;
                border-radius: 999px;
                background: linear-gradient(90deg, var(--ldb-ui-accent), var(--ldb-ui-accent-2));
            }

            .ldb-view-bar-value,
            .ldb-view-timeline-value {
                font-size: 12px;
                color: var(--ldb-ui-muted);
                white-space: nowrap;
            }

            .ldb-view-timeline-item {
                display: grid;
                grid-template-columns: minmax(0, 72px) 1fr auto;
                gap: 8px;
                align-items: center;
            }

            .ldb-view-link-graph,
            .ldb-view-funnel {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .ldb-view-link-row,
            .ldb-view-funnel-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 8px;
                align-items: center;
            }

            .ldb-view-link-path,
            .ldb-view-funnel-label {
                font-size: 12px;
                color: var(--ldb-ui-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .ldb-view-link-count,
            .ldb-view-funnel-value {
                font-size: 12px;
                color: var(--ldb-ui-muted);
                white-space: nowrap;
            }

            .ldb-view-empty {
                border: 1px dashed rgba(148, 163, 184, 0.35);
                border-radius: 12px;
                padding: 18px 14px;
                background: rgba(148, 163, 184, 0.05);
            }

            .ldb-view-empty-title {
                font-size: 13px;
                font-weight: 700;
                color: var(--ldb-ui-text);
                margin-bottom: 6px;
            }

            .ldb-view-empty-text {
                font-size: 12px;
                line-height: 1.5;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-highlight {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }

            .ldb-view-pill {
                padding: 4px 8px;
                border-radius: 999px;
                border: 1px solid rgba(148, 163, 184, 0.25);
                background: rgba(148, 163, 184, 0.08);
                font-size: 11px;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-report-preview {
                white-space: pre-wrap;
                word-break: break-word;
                font-size: 12px;
                line-height: 1.6;
                color: var(--ldb-ui-text);
                border-radius: 10px;
                border: 1px dashed rgba(148, 163, 184, 0.25);
                background: rgba(15, 23, 42, 0.04);
                padding: 12px;
                max-height: 280px;
                overflow: auto;
            }

            .ldb-bookmark-list {
                margin-top: 10px;
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                overflow: hidden;
                background: rgba(148, 163, 184, 0.06);
                max-height: 260px;
                overflow-y: auto;
            }

            .ldb-bookmark-item {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
                cursor: pointer;
            }

            .ldb-bookmark-item:hover {
                background: rgba(37, 99, 235, 0.08);
            }

            .ldb-bookmark-item:last-child {
                border-bottom: none;
            }

            .ldb-bookmark-item input[type="checkbox"] {
                margin-top: 2px;
            }

            .ldb-bookmark-item .title {
                font-size: 13px;
                font-weight: 650;
                line-height: 1.45;
                color: var(--ldb-ui-text);
            }

            .ldb-bookmark-item .status {
                font-size: 11px;
                margin-top: 4px;
                color: var(--ldb-ui-muted);
            }

            .ldb-bookmark-item .status.exported {
                color: var(--ldb-ui-success);
            }

            .ldb-bookmark-item .status.pending {
                color: var(--ldb-ui-warning);
            }

            .ldb-permission-panel {
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                background: rgba(148, 163, 184, 0.08);
                overflow: hidden;
            }

            .ldb-permission-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 10px 12px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-permission-row:last-child {
                border-bottom: none;
            }

            .ldb-permission-label {
                font-size: 12px;
                color: var(--ldb-ui-muted);
            }

            .ldb-permission-select {
                min-width: 160px;
            }

            .ldb-log-panel {
                border: 1px solid var(--ldb-ui-border);
                border-radius: 12px;
                overflow: hidden;
                background: rgba(148, 163, 184, 0.06);
            }

            .ldb-log-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
                cursor: pointer;
                user-select: none;
                background: rgba(148, 163, 184, 0.10);
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-log-title {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: var(--ldb-ui-text);
                font-weight: 700;
            }

            .ldb-log-badge {
                padding: 1px 8px;
                border-radius: 999px;
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                font-size: 11px;
                color: var(--ldb-ui-muted);
            }

            .ldb-log-content {
                padding: 10px 12px;
            }

            .ldb-log-content.collapsed {
                display: none;
            }

            .ldb-log-item {
                display: grid;
                grid-template-columns: 18px 1fr;
                gap: 10px;
                padding: 8px 0;
                border-bottom: 1px solid rgba(148, 163, 184, 0.14);
            }

            .ldb-log-item:last-child {
                border-bottom: none;
            }

            .ldb-log-item .icon {
                font-size: 14px;
                line-height: 1.2;
                opacity: 0.9;
            }

            .ldb-log-item .content {
                font-size: 12px;
                color: var(--ldb-ui-text);
                line-height: 1.5;
            }

            .ldb-log-item .operation {
                font-weight: 650;
            }

            .ldb-log-item .time,
            .ldb-log-item .duration {
                margin-top: 2px;
                font-size: 11px;
                color: var(--ldb-ui-muted);
            }

            .ldb-log-item .error {
                margin-top: 4px;
                color: var(--ldb-ui-danger);
                font-size: 11px;
            }

            .ldb-log-empty {
                padding: 10px 0;
                color: var(--ldb-ui-muted);
                font-size: 12px;
                text-align: center;
            }

            .ldb-log-actions {
                margin-top: 10px;
                display: flex;
                justify-content: flex-end;
            }

            .ldb-log-clear-btn {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                color: var(--ldb-ui-text);
                border-radius: 10px;
                padding: 6px 10px;
                cursor: pointer;
                font-size: 12px;
            }

            .ldb-log-clear-btn:hover {
                background: rgba(148, 163, 184, 0.16);
            }

            .ldb-control-btns {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            }

            /* Tab 导航 */
            .ldb-tabs {
                display: flex;
                border-bottom: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.06);
                padding: 0 4px;
            }

            .ldb-tab {
                flex: 1;
                padding: 10px 6px;
                border: none;
                background: transparent;
                color: var(--ldb-ui-muted);
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                text-align: center;
                border-bottom: 2px solid transparent;
                transition: color 0.2s ease, border-color 0.2s ease;
                user-select: none;
                font-family: inherit;
                white-space: nowrap;
            }

            .ldb-tab:hover {
                color: var(--ldb-ui-text);
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-tab.active {
                color: var(--ldb-ui-accent);
                border-bottom-color: var(--ldb-ui-accent);
            }

            .ldb-tab-content {
                display: none;
            }

            .ldb-tab-content.active {
                display: block;
            }

            /* 主题切换按钮 */
            .ldb-theme-btn {
                width: 30px;
                height: 30px;
                border-radius: 10px;
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                cursor: pointer;
                user-select: none;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                line-height: 1;
                font-size: 14px;
                transition: background 0.2s ease;
            }

            .ldb-theme-btn:hover {
                background: rgba(148, 163, 184, 0.22);
            }

            /* 响应式 */
            @media (max-width: 480px) {
                .ldb-panel {
                    right: 0 !important;
                    left: 0 !important;
                    top: auto !important;
                    bottom: 0 !important;
                    width: 100% !important;
                    max-height: 70vh;
                    border-radius: var(--ldb-ui-radius) var(--ldb-ui-radius) 0 0;
                }
                .ldb-mini-btn {
                    right: 12px;
                    bottom: 12px;
                }
                .ldb-view-grid {
                    grid-template-columns: 1fr;
                }
                .ldb-view-card.full {
                    grid-column: auto;
                }
            }
`;

;

module.exports = { UI_CSS };
