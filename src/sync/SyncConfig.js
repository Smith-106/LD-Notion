"use strict";

// SyncConfig — 同步配置存取 + deviceId 生成
// 设备本地键(ldb_sync_*)不入介质(黑名单), deviceId 用 crypto.getRandomValues(AGENTS.md)。

const { CONFIG } = require("../config");

const SyncConfig = {
    _deviceId: null,

    /**
     * 获取/生成设备 ID(内存缓存 + 持久化)
     */
    getDeviceId() {
        if (SyncConfig._deviceId) return SyncConfig._deviceId;
        let id = GM_getValue(CONFIG.STORAGE_KEYS.SYNC_DEVICE_ID, "");
        if (!id || !/^[0-9a-f]{32}$/.test(id)) {
            const bytes = new Uint8Array(16);
            if (typeof globalThis.crypto?.getRandomValues === "function") {
                globalThis.crypto.getRandomValues(bytes);
            } else {
                const { randomBytes } = require("crypto");
                const buf = randomBytes(16);
                bytes.set(buf);
            }
            id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
            GM_setValue(CONFIG.STORAGE_KEYS.SYNC_DEVICE_ID, id);
        }
        SyncConfig._deviceId = id;
        return id;
    },

    isEnabled() {
        // 兼容字符串 "true"(旧版/手动编辑存储), 全盘审计 find 22
        const raw = GM_getValue(CONFIG.STORAGE_KEYS.SYNC_ENABLED, CONFIG.DEFAULTS.syncEnabled);
        return raw === true || raw === "true";
    },

    setEnabled(v) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_ENABLED, !!v);
    },

    getMode() {
        const m = GM_getValue(CONFIG.STORAGE_KEYS.SYNC_MODE, CONFIG.DEFAULTS.syncMode);
        return m === "shared" ? "shared" : "personal";
    },

    setMode(m) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_MODE, m === "shared" ? "shared" : "personal");
    },

    getDatabaseId() {
        return GM_getValue(CONFIG.STORAGE_KEYS.SYNC_DATABASE_ID, "") || "";
    },

    setDatabaseId(id) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_DATABASE_ID, String(id || ""));
    },

    getParentPageId() {
        return GM_getValue(CONFIG.STORAGE_KEYS.SYNC_PARENT_PAGE_ID, "") || "";
    },

    setParentPageId(id) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_PARENT_PAGE_ID, String(id || ""));
    },

    getLastPushAt() {
        return GM_getValue(CONFIG.STORAGE_KEYS.SYNC_LAST_PUSH_AT, 0) || 0;
    },

    setLastPushAt(ts) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_LAST_PUSH_AT, Number(ts) || Date.now());
    },

    getLastPullAt() {
        return GM_getValue(CONFIG.STORAGE_KEYS.SYNC_LAST_PULL_AT, 0) || 0;
    },

    setLastPullAt(ts) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_LAST_PULL_AT, Number(ts) || Date.now());
    },

    getLastOutcome() {
        return GM_getValue(CONFIG.STORAGE_KEYS.SYNC_LAST_OUTCOME, "") || "";
    },

    setLastOutcome(s) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_LAST_OUTCOME, String(s || ""));
    },

    isPassphraseSet() {
        // 兼容字符串 "true"(旧版/手动编辑存储), 与 isEnabled 同一先例(全盘审计 find 22)
        const raw = GM_getValue(CONFIG.STORAGE_KEYS.SYNC_PASSPHRASE_SET, false);
        return raw === true || raw === "true";
    },

    setPassphraseSet(v) {
        GM_setValue(CONFIG.STORAGE_KEYS.SYNC_PASSPHRASE_SET, !!v);
    },

    /**
     * 多标签页 deviceId 收敛(3/3 共识 dsf+glm+qwen):
     * 两标签页同时首建时各自生成并先后写入(后写覆盖先写), 内存缓存又永不回读,
     * 导致同一浏览器持两个设备身份(按设备分键的同步行/租约分裂)。
     * 监听远端写入并失效/同步内存缓存。
     */
    _installDeviceIdWatcher() {
        if (SyncConfig._deviceIdWatcherInstalled) return;
        SyncConfig._deviceIdWatcherInstalled = true;
        if (typeof GM_addValueChangeListener !== "function") return;
        try {
            GM_addValueChangeListener(CONFIG.STORAGE_KEYS.SYNC_DEVICE_ID, (_name, _oldValue, newValue, remote) => {
                if (!remote) return;
                const value = String(newValue || "");
                if (/^[0-9a-f]{32}$/.test(value)) SyncConfig._deviceId = value;
            });
        } catch (error) {
            console.warn("[LD-Notion] deviceId 跨页监听注册失败", error?.message || error);
        }
    },
};

SyncConfig._installDeviceIdWatcher();

module.exports = { SyncConfig };
