"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");

const CredentialVault = {
    VERSION: 1,
    SENSITIVE_KEYS: Object.freeze(new Set([
        CONFIG.STORAGE_KEYS.NOTION_API_KEY,
        CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET,
        CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN,
        CONFIG.STORAGE_KEYS.AI_API_KEY,
        CONFIG.STORAGE_KEYS.AI_BASE_URL,
        CONFIG.STORAGE_KEYS.GITHUB_TOKEN,
        CONFIG.STORAGE_KEYS.OBS_API_KEY,
        CONFIG.STORAGE_KEYS.OBS_API_URL,
    ])),
    _sessionCache: Object.create(null),
    _sessionPassphrase: "",
    _unlocked: false,
    _syncHandlers: [],

    isSensitiveKey: (key) => CredentialVault.SENSITIVE_KEYS.has(key),

    hasVault: () => !!CredentialVault._getVaultPayloadRaw(),

    isUnlocked: () => CredentialVault._unlocked,

    get: (key, defaultValue = "") => {
        if (!CredentialVault.isSensitiveKey(key)) {
            return Storage.getRaw(key, defaultValue);
        }
        if (Object.prototype.hasOwnProperty.call(CredentialVault._sessionCache, key)) {
            return CredentialVault._sessionCache[key];
        }
        return Storage.getRaw(key, defaultValue);
    },

    getStatus: () => {
        const legacyCount = [...CredentialVault.SENSITIVE_KEYS].reduce((count, key) => {
            const value = String(Storage.getRaw(key, "") || "").trim();
            return value ? count + 1 : count;
        }, 0);
        return {
            hasVault: CredentialVault.hasVault(),
            unlocked: CredentialVault.isUnlocked(),
            legacyCount,
            sensitiveCount: Object.keys(CredentialVault._sessionCache).filter((key) => {
                return CredentialVault.isSensitiveKey(key) && String(CredentialVault._sessionCache[key] || "").trim();
            }).length,
        };
    },

    getStatusText: () => {
        const status = CredentialVault.getStatus();
        if (status.hasVault && status.unlocked) {
            return `凭证保险箱已解锁，当前会话中的敏感凭证会以加密形式保存。已加载 ${status.sensitiveCount} 项。`;
        }
        if (status.hasVault) {
            return "凭证保险箱已锁定。解锁后才能读取或更新已加密保存的敏感凭证。";
        }
        if (status.legacyCount > 0) {
            return `检测到 ${status.legacyCount} 项旧明文凭证。初始化保险箱后，后续会迁移为本地加密存储。`;
        }
        return "凭证保险箱尚未初始化。敏感凭证在初始化后会改为本地加密存储。";
    },

    hasPersistedValue: (key) => {
        if (!CredentialVault.isSensitiveKey(key)) {
            return !!String(Storage.getRaw(key, "") || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(CredentialVault._sessionCache, key)) {
            return !!String(CredentialVault._sessionCache[key] || "").trim();
        }
        const rawValue = String(Storage.getRaw(key, "") || "").trim();
        if (rawValue) return true;
        const payload = Utils.safeJsonParse(CredentialVault._getVaultPayloadRaw(), null);
        return Array.isArray(payload?.keys) && payload.keys.includes(key);
    },

    getFieldPlaceholder: (key, emptyPlaceholder = "") => {
        if (!CredentialVault.hasPersistedValue(key)) return emptyPlaceholder;
        if (CredentialVault.isUnlocked()) {
            return "已保存在保险箱中，输入新值可更新";
        }
        if (CredentialVault.hasVault()) {
            return "已保存在保险箱中，解锁后可更新";
        }
        return "已配置（输入新值可更新）";
    },

    syncSensitiveInput: (input, key, emptyPlaceholder = "") => {
        if (!input || !CredentialVault.isSensitiveKey(key)) return;
        if (document.activeElement !== input) {
            input.value = "";
        }
        input.placeholder = CredentialVault.getFieldPlaceholder(key, emptyPlaceholder);
    },

    registerSyncHandler: (handler) => {
        if (typeof handler !== "function") return;
        CredentialVault._syncHandlers.push(handler);
    },

    syncRegisteredControls: () => {
        CredentialVault._syncHandlers.forEach((handler) => {
            try {
                handler();
            } catch (error) {
                console.warn("[LD-Notion] 同步凭证保险箱状态失败", error);
            }
        });
    },

    attachControls: ({ root, selectors, notify, onAfterSync } = {}) => {
        if (!root || !selectors) return;
        const get = (name) => root.querySelector(selectors[name]);
        const fields = {
            statusEl: get("statusEl"),
            unlockBtn: get("unlockBtn"),
            lockBtn: get("lockBtn"),
        };
        if (!fields.statusEl || !fields.unlockBtn || !fields.lockBtn) {
            return;
        }

        const sync = () => {
            const status = CredentialVault.getStatus();
            fields.statusEl.textContent = CredentialVault.getStatusText();
            if (fields.statusEl.style) {
                fields.statusEl.style.color = status.unlocked ? "#34d399" : status.hasVault ? "#f59e0b" : "#94a3b8";
            }
            fields.unlockBtn.textContent = status.unlocked
                ? "已解锁"
                : status.hasVault
                    ? "解锁保险箱"
                    : "设置保险箱";
            fields.unlockBtn.disabled = status.unlocked;
            fields.lockBtn.disabled = !status.unlocked;
            if (typeof onAfterSync === "function") {
                onAfterSync(status);
            }
        };

        fields.unlockBtn.addEventListener("click", async () => {
            try {
                const before = CredentialVault.hasVault();
                await CredentialVault.promptUnlock();
                if (typeof notify === "function") {
                    notify(before ? "凭证保险箱已解锁" : "凭证保险箱已初始化并解锁", "success");
                }
            } catch (error) {
                if (error?.message && typeof notify === "function") {
                    notify(error.message, "error");
                }
            } finally {
                sync();
            }
        });

        fields.lockBtn.addEventListener("click", () => {
            CredentialVault.lock();
            if (typeof notify === "function") {
                notify("凭证保险箱已锁定", "info");
            }
            sync();
        });

        CredentialVault.registerSyncHandler(sync);
        sync();
    },

    promptUnlock: async () => {
        const promptFn = typeof window?.prompt === "function"
            ? window.prompt.bind(window)
            : (typeof prompt === "function" ? prompt : null);
        if (!promptFn) {
            throw new Error("当前环境不支持输入保险箱口令，请在浏览器页面中操作。");
        }
        if (CredentialVault.hasVault()) {
            const passphrase = promptFn("输入本地凭证保险箱口令");
            if (passphrase == null) throw new Error("已取消解锁凭证保险箱。");
            return CredentialVault.unlock(passphrase, { initializeIfMissing: false, migrateLegacy: true });
        }
        const passphrase = promptFn("为本地凭证保险箱设置口令。口令不会离开当前浏览器，丢失后将无法解密已保存的新凭证。");
        if (passphrase == null) throw new Error("已取消设置凭证保险箱。");
        const confirmPassphrase = promptFn("请再次输入保险箱口令进行确认");
        if (confirmPassphrase == null) throw new Error("已取消设置凭证保险箱。");
        if (String(passphrase) !== String(confirmPassphrase)) {
            throw new Error("两次输入的保险箱口令不一致。");
        }
        return CredentialVault.unlock(passphrase, { initializeIfMissing: true, migrateLegacy: true });
    },

    unlock: async (passphrase = "", { initializeIfMissing = true, migrateLegacy = true } = {}) => {
        CredentialVault._ensureCryptoReady();
        const normalizedPassphrase = String(passphrase || "");
        if (!normalizedPassphrase.trim()) {
            throw new Error("凭证保险箱口令不能为空。");
        }

        CredentialVault._sessionPassphrase = normalizedPassphrase;
        CredentialVault._unlocked = true;

        if (!CredentialVault.hasVault()) {
            if (!initializeIfMissing) {
                CredentialVault.lock();
                throw new Error("凭证保险箱尚未初始化。");
            }
            CredentialVault._sessionCache = migrateLegacy
                ? CredentialVault._collectLegacyValues()
                : Object.create(null);
            await CredentialVault._persistCurrentState({ removeLegacy: migrateLegacy });
            CredentialVault.syncRegisteredControls();
            return CredentialVault.getStatus();
        }

        const payload = CredentialVault._readVaultPayload();
        let decrypted;
        try {
            decrypted = await CredentialVault._decryptPayload(payload, normalizedPassphrase);
        } catch {
            CredentialVault.lock();
            throw new Error("凭证保险箱口令错误，或本地加密数据已损坏。");
        }
        const parsed = Utils.safeJsonParse(decrypted, null);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            CredentialVault.lock();
            throw new Error("凭证保险箱内容损坏，无法解析。");
        }

        CredentialVault._sessionCache = Object.create(null);
        for (const key of CredentialVault.SENSITIVE_KEYS) {
            const value = String(parsed[key] || "").trim();
            if (value) {
                CredentialVault._sessionCache[key] = value;
            }
        }

        if (migrateLegacy) {
            const legacyValues = CredentialVault._collectLegacyValues();
            let needsPersist = false;
            for (const [key, value] of Object.entries(legacyValues)) {
                if (!CredentialVault._sessionCache[key] && value) {
                    CredentialVault._sessionCache[key] = value;
                    needsPersist = true;
                }
            }
            if (needsPersist) {
                await CredentialVault._persistCurrentState({ removeLegacy: true });
            }
        }

        CredentialVault.syncRegisteredControls();
        return CredentialVault.getStatus();
    },

    lock: () => {
        CredentialVault._sessionCache = Object.create(null);
        CredentialVault._sessionPassphrase = "";
        CredentialVault._unlocked = false;
        CredentialVault.syncRegisteredControls();
    },

    set: async (key, value) => {
        if (!CredentialVault.isSensitiveKey(key)) {
            Storage.setRaw(key, value);
            return value;
        }

        const normalized = String(value || "").trim();
        if (!normalized) {
            delete CredentialVault._sessionCache[key];
            if (!CredentialVault.hasVault()) {
                Storage.remove(key);
                CredentialVault.syncRegisteredControls();
                return "";
            }
            CredentialVault._ensureUnlocked("清除敏感凭证");
            await CredentialVault._persistCurrentState({ removeLegacy: true });
            Storage.remove(key);
            CredentialVault.syncRegisteredControls();
            return "";
        }

        if (!CredentialVault.hasVault() && !CredentialVault.isUnlocked()) {
            throw new Error("请先设置并解锁凭证保险箱，再保存敏感凭证。");
        }

        CredentialVault._ensureUnlocked("保存敏感凭证");
        CredentialVault._sessionCache[key] = normalized;
        await CredentialVault._persistCurrentState({ removeLegacy: true });
        Storage.remove(key);
        CredentialVault.syncRegisteredControls();
        return normalized;
    },

    clear: async (key) => {
        return CredentialVault.set(key, "");
    },

    _ensureUnlocked: (actionLabel = "保存敏感凭证") => {
        if (!CredentialVault.isUnlocked()) {
            throw new Error(`${actionLabel} 前请先解锁凭证保险箱。`);
        }
    },

    _ensureCryptoReady: () => {
        if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined" || typeof TextDecoder === "undefined") {
            throw new Error("当前环境不支持凭证保险箱所需的加密能力。");
        }
    },

    _getVaultPayloadRaw: () => String(Storage.getRaw(CONFIG.STORAGE_KEYS.CREDENTIAL_VAULT, "") || "").trim(),

    _readVaultPayload: () => {
        const raw = CredentialVault._getVaultPayloadRaw();
        const payload = Utils.safeJsonParse(raw, null);
        if (!payload?.ciphertext || !payload?.iv || !payload?.salt) {
            throw new Error("凭证保险箱内容不完整。");
        }
        return payload;
    },

    _collectLegacyValues: () => {
        const legacyValues = Object.create(null);
        CredentialVault.SENSITIVE_KEYS.forEach((key) => {
            const value = String(Storage.getRaw(key, "") || "").trim();
            if (value) {
                legacyValues[key] = value;
            }
        });
        return legacyValues;
    },

    _serializeSessionCache: () => {
        const payload = Object.create(null);
        CredentialVault.SENSITIVE_KEYS.forEach((key) => {
            const value = String(CredentialVault._sessionCache[key] || "").trim();
            if (value) {
                payload[key] = value;
            }
        });
        return payload;
    },

    _persistCurrentState: async ({ removeLegacy = false } = {}) => {
        CredentialVault._ensureCryptoReady();
        CredentialVault._ensureUnlocked("更新凭证保险箱");
        const serialized = JSON.stringify(CredentialVault._serializeSessionCache());
        const encoder = new TextEncoder();
        const saltBytes = CredentialVault._randomBytes(16);
        const ivBytes = CredentialVault._randomBytes(12);
        const key = await CredentialVault._deriveKey(CredentialVault._sessionPassphrase, saltBytes);
        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: ivBytes },
            key,
            encoder.encode(serialized)
        );
        Storage.setRaw(CONFIG.STORAGE_KEYS.CREDENTIAL_VAULT, JSON.stringify({
            version: CredentialVault.VERSION,
            keys: Object.keys(CredentialVault._serializeSessionCache()),
            salt: CredentialVault._bytesToBase64(saltBytes),
            iv: CredentialVault._bytesToBase64(ivBytes),
            ciphertext: CredentialVault._bytesToBase64(new Uint8Array(encryptedBuffer)),
            updatedAt: Date.now(),
        }));
        if (removeLegacy) {
            CredentialVault.SENSITIVE_KEYS.forEach((keyName) => Storage.remove(keyName));
        }
    },

    _decryptPayload: async (payload, passphrase) => {
        CredentialVault._ensureCryptoReady();
        const saltBytes = CredentialVault._base64ToBytes(payload.salt);
        const ivBytes = CredentialVault._base64ToBytes(payload.iv);
        const cipherBytes = CredentialVault._base64ToBytes(payload.ciphertext);
        const key = await CredentialVault._deriveKey(passphrase, saltBytes);
        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: ivBytes },
                key,
                cipherBytes
            );
            return new TextDecoder("utf-8").decode(decryptedBuffer);
        } catch {
            throw new Error("凭证保险箱口令错误，或本地加密数据已损坏。");
        }
    },

    _deriveKey: async (passphrase, saltBytes) => {
        const encoder = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            "raw",
            encoder.encode(String(passphrase || "")),
            "PBKDF2",
            false,
            ["deriveKey"]
        );
        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: saltBytes,
                iterations: 200000,
                hash: "SHA-256",
            },
            baseKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    },

    _randomBytes: (length) => {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return bytes;
    },

    _bytesToBase64: (bytes) => {
        if (typeof Buffer !== "undefined") {
            return Buffer.from(bytes).toString("base64");
        }
        let binary = "";
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    },

    _base64ToBytes: (input) => {
        if (typeof Buffer !== "undefined") {
            return Uint8Array.from(Buffer.from(String(input || ""), "base64"));
        }
        const binary = atob(String(input || ""));
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    },
};

const TargetState = {
    _AI_TARGET_MISSING: "__ldb_ai_target_missing__",

    normalizeNotionId: (value) => {
        const extracted = Utils.extractNotionId(value);
        if (extracted) return extracted;
        return String(value || "").trim().replace(/-/g, "").toLowerCase();
    },

    normalizeAITarget: (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        if (raw === "__all__") return "__all__";
        if (raw.startsWith("page:")) {
            const pageId = TargetState.normalizeNotionId(raw.slice(5));
            return pageId ? `page:${pageId}` : "";
        }
        return TargetState.normalizeNotionId(raw);
    },

    parseAITarget: (value) => {
        const normalized = TargetState.normalizeAITarget(value);
        if (normalized === "__all__") {
            return { value: "__all__", mode: "all", databaseId: "", pageId: "" };
        }
        if (normalized.startsWith("page:")) {
            return { value: normalized, mode: "page", databaseId: "", pageId: normalized.slice(5) };
        }
        if (normalized) {
            return { value: normalized, mode: "database", databaseId: normalized, pageId: "" };
        }
        return { value: "", mode: "default", databaseId: "", pageId: "" };
    },

    getStoredAITarget: () => {
        const rawValue = Storage.get(CONFIG.STORAGE_KEYS.AI_TARGET_DB, TargetState._AI_TARGET_MISSING);
        if (rawValue === TargetState._AI_TARGET_MISSING) {
            return {
                exists: false,
                rawValue: "",
                state: TargetState.parseAITarget(""),
            };
        }
        const normalized = TargetState.normalizeAITarget(rawValue);
        return {
            exists: true,
            rawValue: normalized,
            state: TargetState.parseAITarget(normalized),
        };
    },

    getDisplayAITargetState: () => {
        const stored = TargetState.getStoredAITarget();
        if (stored.exists) return stored.state;
        const legacyDatabaseId = TargetState.normalizeNotionId(Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""));
        return legacyDatabaseId ? TargetState.parseAITarget(legacyDatabaseId) : stored.state;
    },

    getEffectiveAITargetState: ({ fallbackDatabaseId = "" } = {}) => {
        const stored = TargetState.getStoredAITarget();
        if (stored.state.mode !== "default") return stored.state;
        const fallbackId = TargetState.normalizeNotionId(fallbackDatabaseId)
            || TargetState.normalizeNotionId(Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""));
        return fallbackId ? TargetState.parseAITarget(fallbackId) : stored.state;
    },

    getEffectiveAIDatabaseId: ({ fallbackDatabaseId = "", targetValue } = {}) => {
        const state = typeof targetValue === "undefined"
            ? TargetState.getEffectiveAITargetState({ fallbackDatabaseId })
            : TargetState.parseAITarget(targetValue);
        if (state.mode === "database") return state.databaseId;
        return TargetState.normalizeNotionId(fallbackDatabaseId)
            || TargetState.normalizeNotionId(Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""));
    },

    setAITarget: (value) => {
        const normalized = TargetState.normalizeAITarget(value);
        Storage.set(CONFIG.STORAGE_KEYS.AI_TARGET_DB, normalized);
        return TargetState.parseAITarget(normalized);
    },

    getExportState: () => {
        const targetType = Storage.get(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, CONFIG.DEFAULTS.exportTargetType)
            === CONFIG.EXPORT_TARGET_TYPES.PAGE
            ? CONFIG.EXPORT_TARGET_TYPES.PAGE
            : CONFIG.EXPORT_TARGET_TYPES.DATABASE;
        const databaseId = TargetState.normalizeNotionId(Storage.get(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, ""));
        const parentPageId = TargetState.normalizeNotionId(Storage.get(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, ""));
        return {
            targetType,
            databaseId,
            parentPageId,
            targetId: targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? parentPageId : databaseId,
            selectValue: targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE
                ? (parentPageId ? `page:${parentPageId}` : "")
                : databaseId,
        };
    },

    setExportTargetType: (targetType) => {
        const normalized = targetType === CONFIG.EXPORT_TARGET_TYPES.PAGE
            ? CONFIG.EXPORT_TARGET_TYPES.PAGE
            : CONFIG.EXPORT_TARGET_TYPES.DATABASE;
        Storage.set(CONFIG.STORAGE_KEYS.EXPORT_TARGET_TYPE, normalized);
        return normalized;
    },

    setExportDatabaseId: (databaseId) => {
        const normalized = TargetState.normalizeNotionId(databaseId);
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID, normalized);
        return normalized;
    },

    setExportPageId: (parentPageId) => {
        const normalized = TargetState.normalizeNotionId(parentPageId);
        Storage.set(CONFIG.STORAGE_KEYS.PARENT_PAGE_ID, normalized);
        return normalized;
    },

    saveExportState: ({ targetType, databaseId, parentPageId } = {}) => {
        if (typeof targetType !== "undefined") {
            TargetState.setExportTargetType(targetType);
        }
        if (typeof databaseId !== "undefined") {
            TargetState.setExportDatabaseId(databaseId);
        }
        if (typeof parentPageId !== "undefined") {
            TargetState.setExportPageId(parentPageId);
        }
        return TargetState.getExportState();
    },
};

const NotionOAuth = {
    _syncHandlers: [],

    getAuthMode: () => {
        const mode = Storage.get(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, CONFIG.DEFAULTS.notionAuthMode);
        return mode === "oauth" ? "oauth" : "manual";
    },

    setAuthMode: (mode) => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, mode === "oauth" ? "oauth" : "manual");
    },

    getConfig: () => ({
        clientId: String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, "") || "").trim(),
        clientSecret: String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, "") || "").trim(),
        redirectUri: String(
            Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI, CONFIG.DEFAULTS.notionOauthRedirectUri)
            || CONFIG.DEFAULTS.notionOauthRedirectUri
        ).trim(),
    }),

    saveConfig: async ({ clientId, clientSecret, redirectUri } = {}) => {
        if (typeof clientId !== "undefined") {
            Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, String(clientId || "").trim());
        }
        if (typeof clientSecret !== "undefined") {
            const normalizedClientSecret = String(clientSecret || "").trim();
            if (normalizedClientSecret) {
                await CredentialVault.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, normalizedClientSecret);
            }
        }
        if (typeof redirectUri !== "undefined") {
            Storage.set(
                CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI,
                String(redirectUri || "").trim() || CONFIG.DEFAULTS.notionOauthRedirectUri
            );
        }
    },

    getMeta: () => Utils.safeJsonParse(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_META, ""), {}),

    setMeta: (meta = {}) => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_META, JSON.stringify(meta || {}));
    },

    getPendingState: () => Utils.safeJsonParse(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_STATE, ""), null),

    setPendingState: (stateInfo) => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_STATE, JSON.stringify(stateInfo || {}));
    },

    clearPendingState: () => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_STATE, "");
    },

    getRefreshToken: () => String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "") || "").trim(),

    setRefreshToken: async (refreshToken = "") => {
        await CredentialVault.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, String(refreshToken || "").trim());
    },

    getAccessToken: (liveValue = "") => {
        const manualValue = String(liveValue || "").trim();
        if (manualValue) return manualValue;
        return String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "") || "").trim();
    },

    setManualApiKey: async (apiKey = "") => {
        const normalized = String(apiKey || "").trim();
        await CredentialVault.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, normalized);
        NotionOAuth.setAuthMode("manual");
        NotionOAuth.syncApiKeyInputs(normalized);
        NotionOAuth.syncRegisteredControls();
    },

    isOAuthReady: () => {
        const config = NotionOAuth.getConfig();
        return !!(config.clientId && config.clientSecret && config.redirectUri);
    },

    isOAuthConnected: () => {
        return NotionOAuth.getAuthMode() === "oauth" && !!NotionOAuth.getRefreshToken() && !!NotionOAuth.getAccessToken();
    },

    canAutoRefresh: () => {
        return NotionOAuth.isOAuthConnected() && NotionOAuth.isOAuthReady();
    },

    getStatus: () => {
        const config = NotionOAuth.getConfig();
        const meta = NotionOAuth.getMeta();
        const accessToken = NotionOAuth.getAccessToken();
        const workspaceName = meta.workspaceName || meta.workspaceId || "";
        const hasStoredClientSecret = CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET);
        const hasStoredManualToken = CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_API_KEY);
        const hasStoredRefreshToken = CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN);

        if (CredentialVault.hasVault() && !CredentialVault.isUnlocked() && (hasStoredManualToken || hasStoredClientSecret || hasStoredRefreshToken)) {
            return {
                connected: false,
                color: "#f59e0b",
                text: "Notion 敏感凭证已保存在保险箱中。请先解锁保险箱，再使用已保存的 Token 或重新授权。",
                apiKeyPlaceholder: "解锁保险箱后可使用已保存配置",
            };
        }

        if (NotionOAuth.isOAuthConnected()) {
            return {
                connected: true,
                color: "#34d399",
                text: workspaceName
                    ? `已通过 OAuth 授权: ${workspaceName}。可留空 API Key 输入框，必要时仍可手动覆盖。`
                    : "已通过 OAuth 授权，Access Token 将自动续签；必要时仍可切回手动 Token。",
                apiKeyPlaceholder: "OAuth 已授权；留空即可，手动输入可覆盖",
            };
        }

        if (config.clientId && hasStoredClientSecret) {
            if (hasStoredManualToken && NotionOAuth.getAuthMode() === "manual") {
                return {
                    connected: false,
                    color: "#fbbf24",
                    text: "当前使用手动 API Key，OAuth 配置已保存，可随时切换到一键授权。",
                    apiKeyPlaceholder: "手动 Token（可选）",
                };
            }

            return {
                connected: false,
                color: "#94a3b8",
                text: "OAuth 配置已保存，点击“一键授权”完成连接；断开只会清除本地凭据。",
                apiKeyPlaceholder: "手动 Token（可选）",
            };
        }

        return {
            connected: false,
            color: "#94a3b8",
            text: "未配置 OAuth，仍可继续手动填写 API Key",
            apiKeyPlaceholder: "手动 Token（可选）",
        };
    },

    buildAuthorizeUrl: (config, state) => {
        const normalized = {
            clientId: String(config?.clientId || "").trim(),
            redirectUri: String(config?.redirectUri || "").trim(),
        };
        if (!normalized.clientId) throw new Error("请先填写 Notion OAuth Client ID");
        if (!normalized.redirectUri) throw new Error("请先填写 Redirect URI");

        const url = new URL("https://api.notion.com/v1/oauth/authorize");
        url.searchParams.set("client_id", normalized.clientId);
        url.searchParams.set("redirect_uri", normalized.redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("owner", "user");
        if (state) url.searchParams.set("state", state);
        return url.toString();
    },

    matchesRedirectUri: (currentUrl, redirectUri) => {
        if (!currentUrl || !redirectUri) return false;
        try {
            const current = new URL(currentUrl);
            const expected = new URL(redirectUri);
            return current.origin === expected.origin && current.pathname === expected.pathname;
        } catch {
            return false;
        }
    },

    pushNotice: (message, type = "info") => {
        const payload = { message: String(message || ""), type, timestamp: Date.now() };
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_NOTICE, JSON.stringify(payload));
        if (typeof GM_notification === "function" && payload.message) {
            GM_notification({
                title: "Notion OAuth",
                text: payload.message,
                timeout: 5000,
            });
        }
    },

    consumeNotice: () => {
        const raw = Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_NOTICE, "");
        if (!raw) return null;
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_NOTICE, "");
        return Utils.safeJsonParse(raw, null);
    },

    syncApiKeyInputs: () => {
        const status = NotionOAuth.getStatus();
        document.querySelectorAll("#ldb-api-key, #ldb-notion-api-key").forEach((input) => {
            if (!input) return;
            if (NotionOAuth.isOAuthConnected()) {
                input.value = "";
                input.placeholder = status.apiKeyPlaceholder;
            } else {
                CredentialVault.syncSensitiveInput(input, CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_xxx...");
            }
        });

        const genericInput = document.querySelector("#gclip-api-key-input");
        if (genericInput) {
            genericInput.value = "";
            if (NotionOAuth.isOAuthConnected()) {
                genericInput.placeholder = "已通过 OAuth 授权（如需覆盖，可手动输入）";
            } else {
                genericInput.placeholder = CredentialVault.getFieldPlaceholder(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_...");
            }
        }
    },

    registerSyncHandler: (handler) => {
        if (typeof handler !== "function") return;
        NotionOAuth._syncHandlers.push(handler);
    },

    syncRegisteredControls: () => {
        NotionOAuth._syncHandlers.forEach((handler) => {
            try {
                handler();
            } catch (error) {
                console.warn("[LD-Notion] 同步 OAuth 控件状态失败", error);
            }
        });
    },

    attachControls: ({ root, selectors, notify } = {}) => {
        if (!root || !selectors) return;
        const get = (name) => root.querySelector(selectors[name]);
        const fields = {
            clientIdInput: get("clientIdInput"),
            clientSecretInput: get("clientSecretInput"),
            redirectUriInput: get("redirectUriInput"),
            authorizeBtn: get("authorizeBtn"),
            clearBtn: get("clearBtn"),
            statusEl: get("statusEl"),
        };

        if (!fields.clientIdInput || !fields.clientSecretInput || !fields.redirectUriInput || !fields.authorizeBtn || !fields.clearBtn || !fields.statusEl) {
            return;
        }

        const sync = () => {
            const config = NotionOAuth.getConfig();
            const status = NotionOAuth.getStatus();

            if (document.activeElement !== fields.clientIdInput) {
                fields.clientIdInput.value = config.clientId;
            }
            CredentialVault.syncSensitiveInput(fields.clientSecretInput, CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, "Client Secret");
            if (document.activeElement !== fields.redirectUriInput) {
                fields.redirectUriInput.value = config.redirectUri || CONFIG.DEFAULTS.notionOauthRedirectUri;
            }

            fields.statusEl.textContent = status.text;
            if (fields.statusEl.style) {
                fields.statusEl.style.color = status.color;
            }
            fields.authorizeBtn.textContent = status.connected ? "🔄 重新授权" : "🔐 一键授权";
            fields.clearBtn.textContent = status.connected ? "断开并切回手动" : "清除本地授权";
            fields.clearBtn.disabled = !status.connected
                && !CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN)
                && !CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_API_KEY);
        };

        const saveFormConfig = async () => {
            await NotionOAuth.saveConfig({
                clientId: fields.clientIdInput.value.trim(),
                clientSecret: fields.clientSecretInput.value.trim(),
                redirectUri: fields.redirectUriInput.value.trim() || CONFIG.DEFAULTS.notionOauthRedirectUri,
            });
        };

        [fields.clientIdInput, fields.clientSecretInput, fields.redirectUriInput].forEach((input) => {
            input.addEventListener("change", async () => {
                try {
                    await saveFormConfig();
                    sync();
                } catch (error) {
                    if (typeof notify === "function") {
                        notify(error.message || String(error), "error");
                    }
                }
            });
        });

        fields.authorizeBtn.addEventListener("click", async () => {
            try {
                await saveFormConfig();
                NotionOAuth.startAuthorization();
                if (typeof notify === "function") {
                    notify("已打开 Notion OAuth 授权页", "info");
                }
            } catch (error) {
                if (typeof notify === "function") {
                    notify(error.message || String(error), "error");
                }
            } finally {
                sync();
            }
        });

        fields.clearBtn.addEventListener("click", async () => {
            try {
                await NotionOAuth.clearConnection();
                if (typeof notify === "function") {
                    notify("已清除本地 OAuth 凭据，可继续手动填写 API Key；这不会撤销 Notion 后台授权。", "success");
                }
            } catch (error) {
                if (typeof notify === "function") {
                    notify(error.message || String(error), "error");
                }
            }
            sync();
        });

        NotionOAuth.registerSyncHandler(sync);
        CredentialVault.registerSyncHandler(sync);
        sync();
    },

    clearConnection: async () => {
        const shouldClearAccessToken = NotionOAuth.getAuthMode() === "oauth";
        if (shouldClearAccessToken) {
            await CredentialVault.clear(CONFIG.STORAGE_KEYS.NOTION_API_KEY);
        }
        await NotionOAuth.setRefreshToken("");
        NotionOAuth.setMeta({});
        NotionOAuth.clearPendingState();
        NotionOAuth.setAuthMode("manual");
        NotionOAuth.syncApiKeyInputs("");
        NotionOAuth.syncRegisteredControls();
    },

    startAuthorization: () => {
        const config = NotionOAuth.getConfig();
        if (!config.clientId) throw new Error("请先填写 Notion OAuth Client ID");
        if (!config.clientSecret) {
            if (CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET) && CredentialVault.hasVault() && !CredentialVault.isUnlocked()) {
                throw new Error("Notion OAuth Client Secret 已保存在保险箱中，请先解锁凭证保险箱后再授权。");
            }
            throw new Error("请先填写 Notion OAuth Client Secret");
        }
        if (!config.redirectUri) throw new Error("请先填写 Redirect URI");

        const state = Utils.randomToken("notion_oauth");
        NotionOAuth.setPendingState({
            state,
            redirectUri: config.redirectUri,
            createdAt: Date.now(),
        });

        const authUrl = NotionOAuth.buildAuthorizeUrl(config, state);
        const opened = window.open(authUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
            window.location.href = authUrl;
        }
        return authUrl;
    },

    exchangeToken: (payload) => {
        const config = NotionOAuth.getConfig();
        if (!config.clientId) throw new Error("缺少 Notion OAuth Client ID");
        if (!config.clientSecret) throw new Error("缺少 Notion OAuth Client Secret");

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: "https://api.notion.com/v1/oauth/token",
                headers: {
                    "Authorization": `Basic ${Utils.base64Encode(`${config.clientId}:${config.clientSecret}`)}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Notion-Version": CONFIG.API.NOTION_VERSION,
                },
                data: JSON.stringify(payload),
                onload: (response) => {
                    const result = Utils.safeJsonParse(response.responseText, {});
                    if (response.status >= 200 && response.status < 300 && result?.access_token) {
                        resolve(result);
                        return;
                    }
                    reject(new Error(result?.error_description || result?.message || result?.error || `OAuth 交换失败: ${response.status}`));
                },
                onerror: (error) => reject(new Error(`OAuth 网络请求失败: ${error?.error || error}`)),
                timeout: 30000,
                ontimeout: () => reject(new Error("OAuth 请求超时，请检查网络连接")),
            });
        });
    },

    applyTokenResponse: async (result = {}) => {
        if (!result?.access_token) throw new Error("Notion OAuth 未返回 access_token");

        await CredentialVault.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, result.access_token);
        if (result.refresh_token) {
            await NotionOAuth.setRefreshToken(result.refresh_token);
        }
        NotionOAuth.setAuthMode("oauth");
        NotionOAuth.setMeta({
            workspaceId: result.workspace_id || "",
            workspaceName: result.workspace_name || "",
            workspaceIcon: result.workspace_icon || "",
            botId: result.bot_id || "",
            ownerType: result.owner?.type || "",
            duplicatedTemplateId: result.duplicated_template_id || "",
            authorizedAt: Date.now(),
        });
        NotionOAuth.syncApiKeyInputs(result.access_token);
        NotionOAuth.syncRegisteredControls();
    },

    refreshAccessToken: async () => {
        const refreshToken = NotionOAuth.getRefreshToken();
        const config = NotionOAuth.getConfig();
        if (!refreshToken) {
            if (CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN) && CredentialVault.hasVault() && !CredentialVault.isUnlocked()) {
                throw new Error("Notion OAuth refresh token 已保存在保险箱中，请先解锁凭证保险箱后再刷新令牌。");
            }
            throw new Error("当前没有可刷新的 Notion OAuth refresh_token");
        }
        if (!config.clientId || !config.clientSecret) {
            if (CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET) && CredentialVault.hasVault() && !CredentialVault.isUnlocked()) {
                throw new Error("Notion OAuth Client Secret 已保存在保险箱中，请先解锁凭证保险箱后再刷新令牌。");
            }
            throw new Error("缺少 Notion OAuth Client 配置，无法刷新令牌");
        }

        const result = await NotionOAuth.exchangeToken({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
        });
        await NotionOAuth.applyTokenResponse(result);
        return result.access_token;
    },

    handleRedirectCallback: async () => {
        const pending = NotionOAuth.getPendingState();
        if (!pending?.state || !pending?.redirectUri) return false;

        let currentUrl;
        try {
            currentUrl = new URL(window.location.href);
        } catch {
            return false;
        }

        const code = currentUrl.searchParams.get("code");
        const error = currentUrl.searchParams.get("error");
        const state = currentUrl.searchParams.get("state");

        if (!code && !error) return false;
        if (!NotionOAuth.matchesRedirectUri(window.location.href, pending.redirectUri)) return false;

        try {
            if (error) {
                throw new Error(`授权被拒绝: ${error}`);
            }
            if (!state || state !== pending.state) {
                throw new Error("OAuth state 校验失败，请重新发起授权");
            }

            const result = await NotionOAuth.exchangeToken({
                grant_type: "authorization_code",
                code,
                redirect_uri: pending.redirectUri,
            });
            await NotionOAuth.applyTokenResponse(result);
            const workspaceName = result.workspace_name || result.workspace_id || "";
            NotionOAuth.pushNotice(
                workspaceName
                    ? `Notion OAuth 授权成功，已连接到 ${workspaceName}`
                    : "Notion OAuth 授权成功",
                "success"
            );
        } catch (errorObj) {
            NotionOAuth.pushNotice(`Notion OAuth 授权失败: ${errorObj.message}`, "error");
        } finally {
            NotionOAuth.clearPendingState();
            Utils.cleanupUrlParams(["code", "state", "error"]);
        }

        return true;
    },
};

module.exports = { CredentialVault, TargetState, NotionOAuth };
