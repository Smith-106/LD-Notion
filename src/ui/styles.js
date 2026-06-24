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
                z-index: var(--ldb-ui-z-index-panel);
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
                gap: var(--ldb-ui-spacing-md);
            }

            .ldb-runtime-badge {
                margin-left: var(--ldb-ui-spacing-md);
                padding: var(--ldb-ui-spacing-3xs) var(--ldb-ui-spacing-md);
                border-radius: var(--ldb-ui-radius-pill);
                font-size: var(--ldb-ui-font-size-xs);
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
                border-color: var(--ldb-ui-focus-ring);
                background: rgba(59, 130, 246, 0.14);
            }

            .ldb-body {
                overflow-y: auto;
                padding: var(--ldb-ui-spacing-2xl);
            }

            .ldb-body::-webkit-scrollbar {
                width: 8px;
            }

            .ldb-body::-webkit-scrollbar-track {
                background: transparent;
            }

            .ldb-body::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.25);
                border-radius: var(--ldb-ui-radius-pill);
            }

            .ldb-mini-btn {
                position: fixed;
                right: 20px;
                bottom: 80px;
                width: 52px;
                height: 52px;
                border-radius: var(--ldb-ui-radius-pill);
                border: 1px solid var(--ldb-ui-focus-ring);
                background: linear-gradient(135deg, var(--ldb-ui-accent) 0%, var(--ldb-ui-accent-2) 100%);
                color: var(--ldb-ui-white);
                font-size: var(--ldb-ui-font-size-2xl);
                cursor: pointer;
                box-shadow: var(--ldb-ui-shadow-sm);
                z-index: var(--ldb-ui-z-index-panel-top);
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
                padding: var(--ldb-ui-spacing-lg) 0;
            }

            .ldb-btn-group {
                display: flex;
                flex-wrap: wrap;
                gap: var(--ldb-ui-spacing-lg);
            }

            .ldb-btn-primary {
                /* alias for .ldb-btn */
            }

            .ldb-btn-small {
                padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg);
                border-radius: var(--ldb-ui-radius-sm);
                font-size: var(--ldb-ui-font-size-sm);
            }

            .ldb-link {
                color: var(--ldb-ui-accent);
            }

            .ldb-checkbox-group {
                display: flex;
                flex-wrap: wrap;
                gap: var(--ldb-ui-spacing-lg);
                align-items: center;
            }

            .ldb-checkbox-item {
                display: inline-flex;
                align-items: center;
                gap: var(--ldb-ui-spacing-sm);
                font-size: var(--ldb-ui-font-size-sm);
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
                gap: var(--ldb-ui-spacing-lg);
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
                border: 1px solid var(--ldb-ui-border);
                border-radius: var(--ldb-ui-radius-md);
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
                gap: var(--ldb-ui-spacing-md);
                margin-bottom: var(--ldb-ui-spacing-md);
            }

            .ldb-source-option {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                color: var(--ldb-ui-text);
                font-size: var(--ldb-ui-font-size-sm);
                font-weight: 600;
                border-radius: var(--ldb-ui-radius-sm);
                padding: var(--ldb-ui-spacing-md) var(--ldb-ui-spacing-lg);
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
                border-radius: var(--ldb-ui-radius-pill);
            }

            .ldb-toggle-slider:before {
                position: absolute;
                content: "";
                height: 18px;
                width: 18px;
                left: 3px;
                top: 50%;
                transform: translateY(-50%);
                background: var(--ldb-ui-white);
                transition: transform 0.2s ease;
                border-radius: 50%;
                box-shadow: 0 6px 16px rgba(2, 6, 23, 0.18);
            }

            .ldb-toggle-switch input:checked + .ldb-toggle-slider {
                background: rgba(37, 99, 235, 0.45);
                border-color: var(--ldb-ui-focus-ring);
            }

            .ldb-toggle-switch input:checked + .ldb-toggle-slider:before {
                transform: translateY(-50%) translateX(20px);
            }

            .ldb-toggle-content.collapsed {
                display: none;
            }

            .ldb-progress {
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
                border: 1px solid var(--ldb-ui-border);
                border-radius: var(--ldb-ui-radius-md);
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-progress-bar {
                height: 10px;
                background: rgba(148, 163, 184, 0.20);
                border-radius: var(--ldb-ui-radius-pill);
                overflow: hidden;
            }

            .ldb-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--ldb-ui-accent), var(--ldb-ui-accent-2));
                border-radius: var(--ldb-ui-radius-pill);
                transition: width 0.3s ease;
            }

            .ldb-progress-text {
                margin-top: var(--ldb-ui-spacing-md);
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-muted);
                display: flex;
                justify-content: space-between;
                gap: var(--ldb-ui-spacing-lg);
            }

            .ldb-report {
                margin-top: var(--ldb-ui-spacing-xl);
            }
            .ldb-report-title {
                font-size: var(--ldb-ui-font-size-lg);
                font-weight: 600;
                margin-bottom: var(--ldb-ui-spacing-lg);
            }
            .ldb-report-section {
                margin-bottom: var(--ldb-ui-spacing-md);
            }
            .ldb-report-section-title {
                font-size: var(--ldb-ui-font-size-md);
                font-weight: 500;
                margin-bottom: var(--ldb-ui-spacing-sm);
            }
            .ldb-report-item {
                display: flex;
                align-items: center;
                gap: var(--ldb-ui-spacing-md);
                padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-md);
                font-size: var(--ldb-ui-font-size-sm);
                border-radius: var(--ldb-ui-radius-2xs);
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
                font-size: var(--ldb-ui-font-size-xs);
                color: var(--ldb-ui-danger);
                padding: var(--ldb-ui-spacing-3xs) var(--ldb-ui-spacing-md) var(--ldb-ui-spacing-sm) 28px;
                opacity: 0.8;
            }

            .ldb-bookmarks-info {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--ldb-ui-spacing-xl);
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
                border: 1px solid var(--ldb-ui-border);
                border-radius: var(--ldb-ui-radius-md);
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-bookmarks-count {
                font-size: var(--ldb-ui-font-size-xl);
                font-weight: 800;
                letter-spacing: 0.2px;
                color: var(--ldb-ui-text);
            }

            .ldb-bookmarks-label {
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-muted);
                text-align: right;
            }

            .ldb-view-header {
                margin-bottom: var(--ldb-ui-spacing-lg);
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: var(--ldb-ui-spacing-xl);
            }

            .ldb-view-actions {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: var(--ldb-ui-spacing-md);
                flex-wrap: wrap;
            }

            .ldb-view-action-btn {
                padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg);
                font-size: var(--ldb-ui-font-size-sm);
                white-space: nowrap;
            }

            .ldb-view-status {
                margin-bottom: var(--ldb-ui-spacing-lg);
                font-size: var(--ldb-ui-font-size-sm);
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
                gap: var(--ldb-ui-spacing-xl);
            }

            .ldb-view-subsection {
                margin-top: var(--ldb-ui-spacing-2xl);
                padding-top: var(--ldb-ui-spacing-2xl);
                border-top: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-view-section-title {
                margin-bottom: var(--ldb-ui-spacing-md);
                font-size: var(--ldb-ui-font-size-sm);
                font-weight: 700;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: var(--ldb-ui-spacing-lg);
            }

            .ldb-view-card {
                border: 1px solid var(--ldb-ui-border);
                border-radius: var(--ldb-ui-radius-md);
                padding: var(--ldb-ui-spacing-xl);
                background: rgba(148, 163, 184, 0.08);
            }

            .ldb-view-card.full {
                grid-column: 1 / -1;
            }

            .ldb-view-card-title {
                font-size: var(--ldb-ui-font-size-sm);
                font-weight: 700;
                color: var(--ldb-ui-muted);
                margin-bottom: var(--ldb-ui-spacing-md);
            }

            .ldb-view-metric-value {
                font-size: var(--ldb-ui-font-size-2xl);
                font-weight: 800;
                color: var(--ldb-ui-text);
                line-height: 1.1;
            }

            .ldb-view-metric-meta {
                margin-top: var(--ldb-ui-spacing-sm);
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-muted);
            }

            .ldb-view-bars,
            .ldb-view-timeline {
                display: flex;
                flex-direction: column;
                gap: var(--ldb-ui-spacing-md);
            }

            .ldb-view-bar-row {
                display: grid;
                grid-template-columns: minmax(0, 88px) 1fr auto;
                gap: var(--ldb-ui-spacing-md);
                align-items: center;
            }

            .ldb-view-bar-label,
            .ldb-view-timeline-label {
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-text);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .ldb-view-bar-track {
                height: 8px;
                border-radius: var(--ldb-ui-radius-pill);
                overflow: hidden;
                background: rgba(148, 163, 184, 0.20);
            }

            .ldb-view-bar-fill {
                height: 100%;
                border-radius: var(--ldb-ui-radius-pill);
                background: linear-gradient(90deg, var(--ldb-ui-accent), var(--ldb-ui-accent-2));
            }

            .ldb-view-bar-value,
            .ldb-view-timeline-value {
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-muted);
                white-space: nowrap;
            }

            .ldb-view-timeline-item {
                display: grid;
                grid-template-columns: minmax(0, 72px) 1fr auto;
                gap: var(--ldb-ui-spacing-md);
                align-items: center;
            }

            .ldb-view-link-graph,
            .ldb-view-funnel {
                display: flex;
                flex-direction: column;
                gap: var(--ldb-ui-spacing-md);
            }

            .ldb-view-link-row,
            .ldb-view-funnel-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: var(--ldb-ui-spacing-md);
                align-items: center;
            }

            .ldb-view-link-path,
            .ldb-view-funnel-label {
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .ldb-view-link-count,
            .ldb-view-funnel-value {
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-muted);
                white-space: nowrap;
            }

            .ldb-view-empty {
                border: 1px dashed rgba(148, 163, 184, 0.35);
                border-radius: var(--ldb-ui-radius-md);
                padding: var(--ldb-ui-spacing-3xl) var(--ldb-ui-spacing-2xl);
                background: rgba(148, 163, 184, 0.05);
            }

            .ldb-view-empty-title {
                font-size: var(--ldb-ui-font-size-md);
                font-weight: 700;
                color: var(--ldb-ui-text);
                margin-bottom: var(--ldb-ui-spacing-sm);
            }

            .ldb-view-empty-text {
                font-size: var(--ldb-ui-font-size-sm);
                line-height: 1.5;
                color: var(--ldb-ui-muted);
            }

            .ldb-view-highlight {
                display: flex;
                flex-wrap: wrap;
                gap: var(--ldb-ui-spacing-md);
                margin-top: var(--ldb-ui-spacing-md);
            }

            .ldb-view-pill {
                padding: var(--ldb-ui-spacing-xs) var(--ldb-ui-spacing-md);
                border-radius: var(--ldb-ui-radius-pill);
                border: 1px solid rgba(148, 163, 184, 0.25);
                background: rgba(148, 163, 184, 0.08);
                font-size: var(--ldb-ui-font-size-xs);
                color: var(--ldb-ui-muted);
            }

            .ldb-view-report-preview {
                white-space: pre-wrap;
                word-break: break-word;
                font-size: var(--ldb-ui-font-size-sm);
                line-height: 1.6;
                color: var(--ldb-ui-text);
                border-radius: var(--ldb-ui-radius-sm);
                border: 1px dashed rgba(148, 163, 184, 0.25);
                background: rgba(15, 23, 42, 0.04);
                padding: var(--ldb-ui-spacing-xl);
                max-height: 280px;
                overflow: auto;
            }

            .ldb-bookmark-list {
                margin-top: var(--ldb-ui-spacing-lg);
                border: 1px solid var(--ldb-ui-border);
                border-radius: var(--ldb-ui-radius-md);
                overflow: hidden;
                background: rgba(148, 163, 184, 0.06);
                max-height: 260px;
                overflow-y: auto;
            }

            .ldb-bookmark-item {
                display: flex;
                align-items: flex-start;
                gap: var(--ldb-ui-spacing-lg);
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
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
                margin-top: var(--ldb-ui-spacing-3xs);
            }

            .ldb-bookmark-item .title {
                font-size: var(--ldb-ui-font-size-md);
                font-weight: 650;
                line-height: 1.45;
                color: var(--ldb-ui-text);
            }

            .ldb-bookmark-item .status {
                font-size: var(--ldb-ui-font-size-xs);
                margin-top: var(--ldb-ui-spacing-xs);
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
                border-radius: var(--ldb-ui-radius-md);
                background: rgba(148, 163, 184, 0.08);
                overflow: hidden;
            }

            .ldb-permission-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--ldb-ui-spacing-lg);
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-permission-row:last-child {
                border-bottom: none;
            }

            .ldb-permission-label {
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-muted);
            }

            .ldb-permission-select {
                min-width: 160px;
            }

            .ldb-log-panel {
                border: 1px solid var(--ldb-ui-border);
                border-radius: var(--ldb-ui-radius-md);
                overflow: hidden;
                background: rgba(148, 163, 184, 0.06);
            }

            .ldb-log-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
                cursor: pointer;
                user-select: none;
                background: rgba(148, 163, 184, 0.10);
                border-bottom: 1px solid rgba(148, 163, 184, 0.18);
            }

            .ldb-log-title {
                display: inline-flex;
                align-items: center;
                gap: var(--ldb-ui-spacing-md);
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-text);
                font-weight: 700;
            }

            .ldb-log-badge {
                padding: 1px var(--ldb-ui-spacing-md);
                border-radius: var(--ldb-ui-radius-pill);
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                font-size: var(--ldb-ui-font-size-xs);
                color: var(--ldb-ui-muted);
            }

            .ldb-log-content {
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-xl);
            }

            .ldb-log-content.collapsed {
                display: none;
            }

            .ldb-log-item {
                display: grid;
                grid-template-columns: 18px 1fr;
                gap: var(--ldb-ui-spacing-lg);
                padding: var(--ldb-ui-spacing-md) 0;
                border-bottom: 1px solid rgba(148, 163, 184, 0.14);
            }

            .ldb-log-item:last-child {
                border-bottom: none;
            }

            .ldb-log-item .icon {
                font-size: var(--ldb-ui-font-size-lg);
                line-height: 1.2;
                opacity: 0.9;
            }

            .ldb-log-item .content {
                font-size: var(--ldb-ui-font-size-sm);
                color: var(--ldb-ui-text);
                line-height: 1.5;
            }

            .ldb-log-item .operation {
                font-weight: 650;
            }

            .ldb-log-item .time,
            .ldb-log-item .duration {
                margin-top: var(--ldb-ui-spacing-3xs);
                font-size: var(--ldb-ui-font-size-xs);
                color: var(--ldb-ui-muted);
            }

            .ldb-log-item .error {
                margin-top: var(--ldb-ui-spacing-xs);
                color: var(--ldb-ui-danger);
                font-size: var(--ldb-ui-font-size-xs);
            }

            .ldb-log-empty {
                padding: var(--ldb-ui-spacing-lg) 0;
                color: var(--ldb-ui-muted);
                font-size: var(--ldb-ui-font-size-sm);
                text-align: center;
            }

            .ldb-log-actions {
                margin-top: var(--ldb-ui-spacing-lg);
                display: flex;
                justify-content: flex-end;
            }

            .ldb-log-clear-btn {
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.10);
                color: var(--ldb-ui-text);
                border-radius: var(--ldb-ui-radius-sm);
                padding: var(--ldb-ui-spacing-sm) var(--ldb-ui-spacing-lg);
                cursor: pointer;
                font-size: var(--ldb-ui-font-size-sm);
            }

            .ldb-log-clear-btn:hover {
                background: rgba(148, 163, 184, 0.16);
            }

            .ldb-control-btns {
                display: flex;
                gap: var(--ldb-ui-spacing-lg);
                flex-wrap: wrap;
            }

            /* Tab 导航 */
            .ldb-tabs {
                display: flex;
                border-bottom: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.06);
                padding: 0 var(--ldb-ui-spacing-xs);
            }

            .ldb-tab {
                flex: 1;
                padding: var(--ldb-ui-spacing-lg) var(--ldb-ui-spacing-sm);
                border: none;
                background: transparent;
                color: var(--ldb-ui-muted);
                font-size: var(--ldb-ui-font-size-sm);
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
                border-radius: var(--ldb-ui-radius-sm);
                border: 1px solid var(--ldb-ui-border);
                background: rgba(148, 163, 184, 0.12);
                cursor: pointer;
                user-select: none;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                line-height: 1;
                font-size: var(--ldb-ui-font-size-lg);
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
