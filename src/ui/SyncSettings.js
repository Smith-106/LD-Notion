"use strict";

const { CONFIG } = require("../config");
const { Storage } = require("../storage");
const { SyncScheduler } = require("../adapter/SyncScheduler");
const { SyncCoordinator } = require("../adapter/SyncCoordinator");
const { SyncStateV2 } = require("../storage/SyncState");

const SOURCE_LABELS = {
    linuxdo: "Linux.do",
    "github-stars": "GitHub Stars",
    "github-repos": "GitHub Repos",
    "github-forks": "GitHub Forks",
    "github-gists": "GitHub Gists",
    bookmarks: "浏览器书签",
    rss: "RSS Feed",
};

const OUTCOME_ICONS = {
    idle: "⚪",
    running: "🔄",
    success: "✅",
    partial: "⚠️",
    error: "❌",
};

/**
 * SyncSettings — 同步设置 UI 组件
 */
const SyncSettings = {
    _container: null,

    render() {
        if (this._container) return this._container;

        const wrapper = document.createElement("div");
        wrapper.className = "ldb-sync-settings";
        wrapper.innerHTML = `
            <style>
                .ldb-sync-settings { padding: 8px 0; }
                .ldb-sync-summary { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 13px; }
                .ldb-sync-summary th, .ldb-sync-summary td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
                .ldb-sync-summary th { font-weight: 600; color: #374151; }
                .ldb-sync-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; flex-wrap: wrap; }
                .ldb-sync-row label { min-width: 80px; font-size: 13px; font-weight: 500; }
                .ldb-sync-row input[type="number"] { width: 60px; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }
                .ldb-sync-row input[type="checkbox"] { margin-right: 4px; }
                .ldb-sync-btn { padding: 4px 10px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; background: #f9fafb; }
                .ldb-sync-btn:hover { background: #f3f4f6; }
                .ldb-sync-status { font-size: 12px; color: #6b7280; }
            </style>
            <h4 style="margin: 0 0 8px; font-size: 14px;">📡 同步设置</h4>
            <table class="ldb-sync-summary" id="ldb-sync-summary-table">
                <thead><tr><th>来源</th><th>状态</th><th>上次同步</th><th>下次同步</th></tr></thead>
                <tbody id="ldb-sync-summary-body"></tbody>
            </table>
            <div id="ldb-sync-controls"></div>
        `;

        this._container = wrapper;
        this._renderSummary();
        this._renderControls();
        return wrapper;
    },

    _renderSummary() {
        const tbody = this._container?.querySelector("#ldb-sync-summary-body");
        if (!tbody) return;
        tbody.innerHTML = "";
        for (const sourceType of Object.keys(SOURCE_LABELS)) {
            const status = SyncScheduler.getStatus(sourceType);
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${SOURCE_LABELS[sourceType] || sourceType}</td>
                <td>${OUTCOME_ICONS[status.lastOutcome] || "⚪"} ${status.lastOutcome}</td>
                <td>${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "-"}</td>
                <td>${status.nextSyncAt ? new Date(status.nextSyncAt).toLocaleString() : "已暂停"}</td>
            `;
            tbody.appendChild(tr);
        }
    },

    _renderControls() {
        const controls = this._container?.querySelector("#ldb-sync-controls");
        if (!controls) return;
        controls.innerHTML = "";
        for (const sourceType of Object.keys(SOURCE_LABELS)) {
            const row = document.createElement("div");
            row.className = "ldb-sync-row";

            const label = document.createElement("label");
            label.textContent = SOURCE_LABELS[sourceType];

            const enabled = SyncScheduler.isEnabled(sourceType);
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = enabled;
            cb.addEventListener("change", () => {
                const key = SOURCE_ENABLED_KEYS[sourceType];
                if (key) Storage.setRaw(key, cb.checked);
                if (cb.checked) {
                    SyncScheduler.start(sourceType);
                } else {
                    SyncScheduler.stop(sourceType);
                }
                this._renderSummary();
            });

            const intervalMin = SyncScheduler.getIntervalMinutes(sourceType);
            const numInput = document.createElement("input");
            numInput.type = "number";
            numInput.value = intervalMin;
            numInput.min = 0;
            numInput.title = "同步间隔 (分钟, 0=仅手动)";
            numInput.addEventListener("change", () => {
                const key = SOURCE_INTERVAL_KEYS[sourceType];
                if (key) Storage.setRaw(key, Number(numInput.value) || 0);
                if (SyncScheduler.isEnabled(sourceType)) {
                    SyncScheduler.start(sourceType);
                }
                this._renderSummary();
            });

            const intervalLabel = document.createElement("span");
            intervalLabel.className = "ldb-sync-status";
            intervalLabel.textContent = "分钟";

            const syncBtn = document.createElement("button");
            syncBtn.className = "ldb-sync-btn";
            syncBtn.textContent = "立即同步";
            syncBtn.addEventListener("click", async () => {
                syncBtn.disabled = true;
                syncBtn.textContent = "同步中...";
                await SyncCoordinator.sync(sourceType);
                syncBtn.disabled = false;
                syncBtn.textContent = "立即同步";
                this._renderSummary();
            });

            row.appendChild(cb);
            row.appendChild(label);
            row.appendChild(numInput);
            row.appendChild(intervalLabel);
            row.appendChild(syncBtn);
            controls.appendChild(row);
        }
    },

    refresh() {
        this._renderSummary();
    },
};

module.exports = { SyncSettings };
