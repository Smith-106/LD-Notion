"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");

const UpdateChecker = {
    timerId: null,
    isChecking: false,

    shouldCheckNow: (intervalHours) => {
        const intervalMs = (parseInt(intervalHours, 10) || 0) * 60 * 60 * 1000;
        if (intervalMs <= 0) return true;
        const lastCheckAt = parseInt(Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, 0), 10) || 0;
        return !lastCheckAt || (Date.now() - lastCheckAt >= intervalMs);
    },

    getCurrentVersion: () => {
        if (typeof GM_info !== "undefined" && GM_info?.script?.version) {
            return GM_info.script.version;
        }
        return "3.4.5";
    },

    compareVersions: (a, b) => {
        const parse = (v) => String(v || "0")
            .replace(/^v/i, "")
            .split(".")
            .map((n) => parseInt(n, 10) || 0);
        const va = parse(a);
        const vb = parse(b);
        const len = Math.max(va.length, vb.length);
        for (let i = 0; i < len; i++) {
            const na = va[i] || 0;
            const nb = vb[i] || 0;
            if (na > nb) return 1;
            if (na < nb) return -1;
        }
        return 0;
    },

    fetchLatestVersion: () => {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://api.github.com/repos/Smith-106/LD-Notion/releases/latest",
                headers: {
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "LD-Notion-UserScript",
                },
                timeout: 15000,
                onload: (response) => {
                    if (response.status !== 200) {
                        reject(new Error(`更新检查失败: HTTP ${response.status}`));
                        return;
                    }
                    try {
                        const data = JSON.parse(response.responseText || "{}");
                        const version = String(data.tag_name || data.name || "").replace(/^v/i, "").trim();
                        if (!version) {
                            reject(new Error("未获取到版本号"));
                            return;
                        }
                        resolve(version);
                    } catch {
                        reject(new Error("解析更新信息失败"));
                    }
                },
                ontimeout: () => reject(new Error("更新检查超时")),
                onerror: () => reject(new Error("网络错误，无法检查更新")),
            });
        });
    },

    saveResult: (result) => {
        const checkedAt = Date.now();
        Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_CHECK_AT, checkedAt);
        Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, JSON.stringify({ ...result, checkedAt }));
        if (result.latestVersion) {
            Storage.set(CONFIG.STORAGE_KEYS.UPDATE_LAST_SEEN_VERSION, result.latestVersion);
        }
    },

    updateStatusText: (text) => {
        const el = (UI.refs && UI.refs.updateCheckStatus) || document.querySelector("#ldb-update-check-status");
        if (el) el.textContent = text;
    },

    renderLastStatus: () => {
        const raw = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_LAST_RESULT, "");
        if (!raw) {
            UpdateChecker.updateStatusText("尚未检查更新");
            return;
        }

        try {
            const result = JSON.parse(raw);
            const checkedAtText = result.checkedAt
                ? new Date(result.checkedAt).toLocaleString("zh-CN")
                : "未知时间";
            const latestText = result.latestVersion ? `，最新 v${result.latestVersion}` : "";
            if (result.status === "update-available") {
                UpdateChecker.updateStatusText(`发现新版本（上次检查：${checkedAtText}${latestText}）`);
            } else if (result.status === "up-to-date") {
                UpdateChecker.updateStatusText(`已是最新（上次检查：${checkedAtText}${latestText}）`);
            } else if (result.status === "error") {
                UpdateChecker.updateStatusText(`上次检查失败：${result.message || "未知错误"}`);
            } else {
                UpdateChecker.updateStatusText(`上次检查：${checkedAtText}`);
            }
        } catch {
            UpdateChecker.updateStatusText("更新状态读取失败");
        }
    },

    check: async ({ manual = false } = {}) => {
        if (UpdateChecker.isChecking) return;
        UpdateChecker.isChecking = true;

        if (manual) {
            UI.showStatus("正在检查更新...", "info");
        }

        try {
            const currentVersion = UpdateChecker.getCurrentVersion();
            const latestVersion = await UpdateChecker.fetchLatestVersion();
            const cmp = UpdateChecker.compareVersions(latestVersion, currentVersion);

            if (cmp > 0) {
                const message = `发现新版本 v${latestVersion}（当前 v${currentVersion}）。脚本可直接更新；ZIP/解压扩展需手动重新安装或在扩展页重新加载。`;
                UpdateChecker.saveResult({
                    status: "update-available",
                    latestVersion,
                    currentVersion,
                    message,
                });
                UpdateChecker.renderLastStatus();
                if (manual) UI.showStatus(message, "info");
            } else {
                const message = `当前已是最新版本 v${currentVersion}`;
                UpdateChecker.saveResult({
                    status: "up-to-date",
                    latestVersion,
                    currentVersion,
                    message,
                });
                UpdateChecker.renderLastStatus();
                if (manual) UI.showStatus(message, "success");
            }
        } catch (error) {
            const message = error?.message || "更新检查失败";
            UpdateChecker.saveResult({ status: "error", message });
            UpdateChecker.renderLastStatus();
            if (manual) UI.showStatus(message, "error");
        } finally {
            UpdateChecker.isChecking = false;
        }
    },

    startPolling: (hours) => {
        UpdateChecker.stopPolling();
        const intervalHours = parseInt(hours, 10) || 0;
        if (intervalHours > 0) {
            UpdateChecker.timerId = setInterval(() => {
                Utils.runWhenBrowserIdle(() => UpdateChecker.check({ manual: false }));
            }, intervalHours * 60 * 60 * 1000);
        }
    },

    stopPolling: () => {
        if (UpdateChecker.timerId) {
            clearInterval(UpdateChecker.timerId);
            UpdateChecker.timerId = null;
        }
    },

    init: () => {
        const enabled = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_AUTO_CHECK_ENABLED, CONFIG.DEFAULTS.updateAutoCheckEnabled);
        const intervalHours = Storage.get(CONFIG.STORAGE_KEYS.UPDATE_CHECK_INTERVAL_HOURS, CONFIG.DEFAULTS.updateCheckIntervalHours);
        UpdateChecker.stopPolling();
        UpdateChecker.renderLastStatus();
        if (enabled) {
            if (UpdateChecker.shouldCheckNow(intervalHours)) {
                Utils.runWhenBrowserIdle(() => UpdateChecker.check({ manual: false }));
            }
            UpdateChecker.startPolling(intervalHours);
        }
    },
};

module.exports = { UpdateChecker };
