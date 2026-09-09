"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const {
    describeExchangeError,
    describeRedirectUriMismatch,
} = require("./target-discovery");

// 隐形字符(零宽空格/连接符/BOM/词连接符/bidi 标记/软连字符)——复制粘贴时易混入,Notion 端无法解析
const INVISIBLE_CHARS_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
// Notion 公开集成 OAuth Client ID 为 UUID(版本无关,不钉死 version nibble)
const CLIENT_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CredentialVault = {
    VERSION: 1,
    // 敏感键集已全部清空(v3.14.2):
    // vault 解锁态(_unlocked/_sessionCache)为模块内存态,每次页面加载(含 Tampermonkey
    // 脚本更新强制重载)即重置为锁定;锁定态下读取返回空,导致 AI/GitHub/Obsidian
    // 敏感键在每次更新后看似失效。与 v3.12.0 OAuth 三键同根(R1),按同一先例改走
    // GM 明文存储,审计日志仍由 REDACT_IN_LOGS 统一脱敏。
    SENSITIVE_KEYS: Object.freeze(new Set()),
    // 审计日志脱敏超集:SENSITIVE_KEYS + OAuth 三键(虽改明文存储,仍不得出现在日志)
    REDACT_IN_LOGS: Object.freeze(new Set([
        CONFIG.STORAGE_KEYS.AI_API_KEY,
        CONFIG.STORAGE_KEYS.AI_BASE_URL,
        CONFIG.STORAGE_KEYS.GITHUB_TOKEN,
        CONFIG.STORAGE_KEYS.OBS_API_KEY,
        CONFIG.STORAGE_KEYS.OBS_API_URL,
        CONFIG.STORAGE_KEYS.NOTION_API_KEY,
        CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET,
        CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN,
    ])),
    _sessionCache: Object.create(null),
    _sessionPassphrase: "",
    _unlocked: false,
    _syncHandlers: [],

    isSensitiveKey: (key) => CredentialVault.SENSITIVE_KEYS.has(key),

    // v3.14.6 (S-08): 自由文本/JSON 序列化脱敏 —— REDACT_IN_LOGS 键名 + token 形态正则,
    // AI trace/回喂 payload 落盘前统一过此函数(凭证片段不回显)
    redactText: (text) => {
        let out = String(text ?? "");
        for (const key of CredentialVault.REDACT_IN_LOGS) {
            out = out.split(key).join("***REDACTED***");
        }
        return out
            .replace(/ntn_[A-Za-z0-9_\-]{20,}/g, "***REDACTED***")
            // P4 收敛(c06): secret_ 为 Notion 旧版 manual Key 与 OAuth Client Secret 形态
            // (validateManualApiKey 明确接受), 原清单遗漏 → 明文穿透脱敏
            .replace(/secret_[A-Za-z0-9]{20,}/g, "***REDACTED***")
            .replace(/sk-[A-Za-z0-9_\-]{20,}/g, "***REDACTED***")
            .replace(/Bearer\s+[A-Za-z0-9._\-]{10,}/gi, "Bearer ***REDACTED***")
            .replace(/github_pat_[A-Za-z0-9_\-]{20,}/g, "***REDACTED***")
            .replace(/ghp_[A-Za-z0-9]{20,}/g, "***REDACTED***")
            .replace(/gho_[A-Za-z0-9]{20,}/g, "***REDACTED***");
    },

    hasVault: () => !!CredentialVault._getVaultPayloadRaw(),

    isUnlocked: () => CredentialVault._unlocked,

    get: (key, defaultValue = "") => {
        if (!CredentialVault.isSensitiveKey(key)) {
            return Storage.getRaw(key, defaultValue);
        }
        if (Object.prototype.hasOwnProperty.call(CredentialVault._sessionCache, key)) {
            return CredentialVault._sessionCache[key];
        }
        // 保险箱已初始化但未解锁: 禁止回退读取明文 legacy(安全审计 hy3 LOW),
        // 与 getStatus「解锁后才能读取」承诺一致; 未初始化时才允许明文兼容(迁移前形态)。
        if (CredentialVault.hasVault() && !CredentialVault.isUnlocked()) {
            return defaultValue;
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
        if (!input) return;
        if (!CredentialVault.isSensitiveKey(key)) {
            // OAuth 三键已脱敏:无保险箱语义,按本地明文有无给同等视觉契约
            const hasLocal = !!String(Storage.get(key, "") || "").trim();
            if (document.activeElement !== input) {
                input.value = "";
            }
            input.placeholder = hasLocal ? `${emptyPlaceholder}（已保存在本机）` : emptyPlaceholder;
            return;
        }
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

        const payload = (() => {
            // P4 收敛(c06): _readVaultPayload 对不完整 payload 抛错 —— 与 _decryptPayload 同口径
            // 先 lock 再抛, 否则异常逃逸后 isUnlocked() 仍为 true(UI 显示已解锁但 sessionCache 未加载)
            try {
                return CredentialVault._readVaultPayload();
            } catch {
                CredentialVault.lock();
                throw new Error("凭证保险箱内容损坏或不完整，无法解锁。");
            }
        })();
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
            // 非敏感键(含 v3.14.2 移出保险箱的全部敏感键)直接 GM 明文读写;
            // 空值语义为删除键(与 clear 一致),避免残留空串
            if (!String(value || "").trim()) {
                Storage.remove(key);
                return "";
            }
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
    _postAuthHandlers: [],
    _refreshInFlight: null,

    registerPostAuthHandler: (handler) => {
        if (typeof handler !== "function") return () => {};
        NotionOAuth._postAuthHandlers.push(handler);
        return () => {
            NotionOAuth._postAuthHandlers = NotionOAuth._postAuthHandlers.filter((h) => h !== handler);
        };
    },

    _notifyPostAuth: async (context) => {
        for (const handler of NotionOAuth._postAuthHandlers) {
            try {
                await handler(context);
            } catch (error) {
                // 发现失败绝不回滚授权成功(Routing 优先级 5:不静默丢弃,但也不阻断)
                console.warn("[LD-Notion] 授权后目标发现失败:", error?.message || error);
            }
        }
    },

    getAuthMode: () => {
        const mode = Storage.get(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, CONFIG.DEFAULTS.notionAuthMode);
        return mode === "oauth" ? "oauth" : "manual";
    },

    setAuthMode: (mode) => {
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE, mode === "oauth" ? "oauth" : "manual");
        // v3.14.16: 显式模式切换后立即刷新各面板单选/状态行
        NotionOAuth.syncRegisteredControls();
    },

    getConfig: () => ({
        // 纵深防御(三模型共识验证轮):存量脏值(隐形字符)在读取层剥离,续签/授权不再携带
        clientId: String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, "") || "").trim().replace(INVISIBLE_CHARS_RE, ""),
        clientSecret: String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, "") || "").trim(),
        redirectUri: String(
            Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI, CONFIG.DEFAULTS.notionOauthRedirectUri)
            || CONFIG.DEFAULTS.notionOauthRedirectUri
        ).trim(),
    }),

    saveConfig: async ({ clientId, clientSecret, redirectUri } = {}) => {
        if (typeof clientId !== "undefined") {
            const normalizedClientId = String(clientId || "").trim();
            if (normalizedClientId) {
                // 空值不覆盖(三模型共识):陈旧面板/误清空输入不得摧毁已存好值,语义与 clientSecret 分支对称
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID, normalizedClientId);
            }
        }
        if (typeof clientSecret !== "undefined") {
            const normalizedClientSecret = String(clientSecret || "").trim();
            if (normalizedClientSecret) {
                // OAuth 脱离保险箱(三模型共识修复):改走 GM 明文存储,保证回调页/刷新后可读
                Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, normalizedClientSecret);
            }
        }
        if (typeof redirectUri !== "undefined") {
            const normalizedRedirectUri = String(redirectUri || "").trim();
            if (normalizedRedirectUri) {
                // 空值不覆盖(三模型共识验证轮,与 clientId/secret 分支对称):陈旧面板/误清空不得把自定义 URI 静默改回默认
                Storage.set(
                    CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI,
                    normalizedRedirectUri
                );
            }
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
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, String(refreshToken || "").trim());
    },

    getAccessToken: (liveValue = "") => {
        const manualValue = String(liveValue || "").trim().replace(INVISIBLE_CHARS_RE, "").replace(/[\r\n\t]/g, "");
        if (manualValue) return manualValue;
        return String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "") || "").trim().replace(INVISIBLE_CHARS_RE, "").replace(/[\r\n\t]/g, "");
    },

    // OAuth 可续签时：请求层禁止用调用方快照遮蔽 Storage 中刚续签的新 token。
    // 根因：getAccessToken(liveValue) 在 liveValue 非空时优先返回快照；AutoImporter /
    // 批量导出若把 buildSettings 时的 access token 当 apiKey 传入，首项 401 续签成功后
    // 后续项仍带旧 token → 再次 401 → refresh_token 轮换后 invalid_grant 整批中止
    // （v3.14.7 仅修了手动 exportBookmarks 每项重解析；自动导入/上传分片仍中招）。
    // 手动 Token 模式：仍尊重传入的 apiKey（含 UI live 覆盖）。
    resolveRequestToken: (apiKey = "") => {
        if (NotionOAuth.canAutoRefresh()) {
            return NotionOAuth.getAccessToken("");
        }
        return NotionOAuth.getAccessToken(apiKey);
    },

    setManualApiKey: async (apiKey = "") => {
        // v3.14.12 (三模型共识): 剥不可见字符+换行/制表符(零宽/全角/换行残留)防粘贴污染致 401
        const normalized = String(apiKey || "").trim().replace(INVISIBLE_CHARS_RE, "").replace(/[\r\n\t]/g, "");
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, normalized);
        // v3.14.16: 认证方式单选为唯一真相源——保存非空 API Key 不再静默翻 manual
        // (修复 v3.14.7 仍残留的「填 Key 偷走 OAuth」脚枪)。空值仍不改 mode。
        NotionOAuth.syncApiKeyInputs(normalized);
        NotionOAuth.syncRegisteredControls();
        // v3.14.12 复核(三模型): validateManualApiKey 接线——保存时软校验,
        // 格式可疑仅 console 警告不阻断(兼容旧 secret_ 与新版 ntn_)
        if (normalized) {
            const check = NotionOAuth.validateManualApiKey(normalized);
            if (!check.valid && check.code !== "EMPTY") {
                console.warn(`[LD-Notion] API Key 格式可疑(${check.code}): ${check.message}`);
            }
        }
    },

    // v3.14.12 (三模型共识): manual key 格式软校验——secret_/ntn_ 均合法,仅不匹配时警告不阻断
    validateManualApiKey: (apiKey = "") => {
        const raw = String(apiKey ?? "").trim().replace(INVISIBLE_CHARS_RE, "").replace(/[\r\n\t]/g, "");
        if (!raw) return { valid: false, code: "EMPTY", value: "", message: "请先填写 Notion API Key" };
        if (!/^(secret_|ntn_)/i.test(raw)) {
            return { valid: false, code: "FORMAT_SUSPECT", value: raw, message: "Notion API Key 应以 secret_ 或 ntn_ 开头；当前值疑似复制不完整或误贴其他凭证（如 OAuth Client Secret / AI Key / GitHub token）" };
        }
        if (raw.length < 20) {
            return { valid: false, code: "TOO_SHORT", value: raw, message: "Notion API Key 长度异常（过短），疑似复制不完整，请从 Notion 集成页面用 Copy 按钮完整复制" };
        }
        return { valid: true, code: "OK", value: raw, message: "" };
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

    // —— client_id/redirect_uri 本地校验(三模型共识:根因 = 非空但非法值直接进 URL) ——
    validateOAuthClientId: (clientId) => {
        const raw = String(clientId ?? "").trim();
        if (!raw) return { valid: false, code: "EMPTY", value: "", message: "请先填写 Notion OAuth Client ID" };
        const stripped = raw.replace(INVISIBLE_CHARS_RE, "");
        if (!stripped) return { valid: false, code: "INVISIBLE_ONLY", value: "", message: "Notion OAuth Client ID 仅包含不可见字符，请重新从集成页面复制 OAuth client ID" };
        if (/^secret_/i.test(stripped)) return { valid: false, code: "LOOKS_LIKE_SECRET", value: stripped, message: "这不是 Client ID：secret_ 开头的是 Client Secret，请粘贴到下方 Client Secret 输入框；Client ID 应为 UUID 格式" };
        if (/^ntn_/i.test(stripped)) return { valid: false, code: "LOOKS_LIKE_TOKEN", value: stripped, message: "这不是 Client ID：ntn_ 开头的是 Notion API Token；Client ID 应为 UUID 格式（形如 12345678-1234-4234-8234-123456789012）" };
        if (!CLIENT_ID_UUID_RE.test(stripped)) return { valid: false, code: "FORMAT", value: stripped, message: "Notion OAuth Client ID 格式不合法：应为 36 位 UUID（形如 12345678-1234-4234-8234-123456789012），请到 Notion 集成页面复制完整的 OAuth client ID（不是集成名称，也不是 Internal Integration Token）" };
        return { valid: true, code: "OK", value: stripped, message: "" };
    },

    validateOAuthRedirectUri: (redirectUri) => {
        const raw = String(redirectUri ?? "").trim();
        if (!raw) return { valid: false, code: "EMPTY", value: "", message: "请先填写 Redirect URI" };
        let url;
        try {
            url = new URL(raw);
        } catch {
            return { valid: false, code: "PARSE", value: "", message: "Redirect URI 格式不合法：必须是完整 URL（例如 https://smith-106.github.io/LD-Notion/oauth-callback）" };
        }
        const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (url.protocol === "http:" && !isLocalhost) return { valid: false, code: "HTTP_NOT_LOCALHOST", value: raw, message: "Redirect URI 仅允许 https；http 仅限 http://localhost 本地调试，请勿使用公网 http 地址" };
        if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) return { valid: false, code: "PROTOCOL", value: raw, message: "Redirect URI 协议不合法：仅支持 https 或 http://localhost" };
        if (isLocalhost) return { valid: true, code: "LOCALHOST", value: url.toString(), message: "本地回调仅 Chrome 扩展形态可用：userscript 不运行于 localhost 页面，回调无法自动完成" };
        // 宽松白名单(v3.14.15): 共享回调与 Notion 域直通; 其他 https 自定义回调放行但提示
        // (Notion 侧仍会在授权页强校验登记列表, 本地白名单仅作提前提醒, 不误伤自定义合法回调)
        const sharedCallback = "smith-106.github.io/LD-Notion/oauth-callback";
        const isNotionDomain = url.hostname === "notion.so" || url.hostname.endsWith(".notion.so");
        const isSharedCallback =
            url.hostname === new URL("https://" + sharedCallback).hostname &&
            url.pathname.replace(/\/$/, "") === "/LD-Notion/oauth-callback";
        if (!isSharedCallback && !isNotionDomain) {
            return { valid: true, code: "CUSTOM", value: url.toString(), message: "自定义 Redirect URI 已放行：请确认已在 Notion 集成后台逐字符登记该地址（当前共享回调：https://" + sharedCallback + "）" };
        }
        return { valid: true, code: "OK", value: url.toString(), message: "" };
    },

    buildAuthorizeUrl: (config, state) => {
        const normalized = {
            clientId: String(config?.clientId || "").trim(),
            redirectUri: String(config?.redirectUri || "").trim(),
        };
        if (!normalized.clientId) throw new Error("请先填写 Notion OAuth Client ID");
        if (!normalized.redirectUri) throw new Error("请先填写 Redirect URI");
        // 严格校验(三模型共识):空值本地拦截后,能到 Notion 的错误只能是「非空但非法」,
        // 必须在打开授权页前拦截并给出可行动的中文提示,而不是让 Notion 报模糊错误。
        const clientIdCheck = NotionOAuth.validateOAuthClientId(normalized.clientId);
        if (!clientIdCheck.valid) throw new Error(clientIdCheck.message);
        const redirectCheck = NotionOAuth.validateOAuthRedirectUri(normalized.redirectUri);
        if (!redirectCheck.valid) throw new Error(redirectCheck.message);

        const url = new URL("https://api.notion.com/v1/oauth/authorize");
        url.searchParams.set("client_id", clientIdCheck.value);
        url.searchParams.set("redirect_uri", redirectCheck.value);
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
            // Align with describeRedirectUriMismatch: trailing-slash insensitive
            // (https://host/cb vs https://host/cb/ must not fail CSRF-safe path check).
            const normalizePath = (path) => {
                let p = String(path || "/");
                if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
                return p.toLowerCase();
            };
            return current.origin === expected.origin
                && normalizePath(current.pathname) === normalizePath(expected.pathname);
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

    // 授权后目标发现结果消费(三模型共识):跨页结果落存储,TTL 10min 与 pending 对齐,读后即清
    consumePostAuthTarget: () => {
        const raw = Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_POST_AUTH_TARGET, "");
        if (!raw) return null;
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_OAUTH_POST_AUTH_TARGET, "");
        const payload = Utils.safeJsonParse(raw, null);
        if (!payload?.action) return null;
        if (payload.timestamp && Date.now() - payload.timestamp > 10 * 60 * 1000) {
            return null;
        }
        return payload;
    },

    syncApiKeyInputs: () => {
        const status = NotionOAuth.getStatus();
        document.querySelectorAll("#ldb-api-key, #ldb-notion-api-key").forEach((input) => {
            if (!input) return;
            if (NotionOAuth.isOAuthConnected()) {
                // P4 收敛(c06): 与 gclip 分支/syncSensitiveInput 对齐——用户正在输入时不得清空
                if (document.activeElement !== input) {
                    input.value = "";
                }
                input.placeholder = status.apiKeyPlaceholder;
            } else {
                CredentialVault.syncSensitiveInput(input, CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_xxx...");
            }
        });

        const genericInput = document.querySelector("#gclip-api-key-input");
        if (genericInput) {
            // P4 收敛(c06): 与 syncSensitiveInput 对齐 —— 用户正在输入时不得清空
            if (document.activeElement !== genericInput) {
                genericInput.value = "";
            }
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

    // 跨页/跨 tab 刷新(三模型共识辅因修复):OAuth 配置三键 + 授权完成态注册 GM_addValueChangeListener,
    // 其他页面修改配置/完成回调后本页面板立即回填,避免陈旧面板把旧值写回 Storage,
    // 以及发起页一直停在「等待回调」而回调页其实已成功(userscript 弹窗/跳转场景)。
    _crossPageWatchersInstalled: false,
    // document-start 快照:Notion SPA 可能在 document-idle 前清掉 ?code&state
    _callbackSnapshot: null,

    captureCallbackSnapshot: (href) => {
        const rawHref = typeof href === "string" && href
            ? href
            : (typeof window !== "undefined" ? String(window.location?.href || "") : "");
        if (!rawHref) return null;
        try {
            const url = new URL(rawHref);
            const code = url.searchParams.get("code");
            const error = url.searchParams.get("error");
            const state = url.searchParams.get("state");
            // 仅在疑似 OAuth 回调时落快照(有 code/error);避免普通页面误捕获
            if (!code && !error) return null;
            NotionOAuth._callbackSnapshot = {
                href: rawHref,
                code,
                error,
                state,
                capturedAt: Date.now(),
            };
            return NotionOAuth._callbackSnapshot;
        } catch {
            return null;
        }
    },

    clearCallbackSnapshot: () => {
        NotionOAuth._callbackSnapshot = null;
    },

    installCrossPageWatchers: () => {
        if (NotionOAuth._crossPageWatchersInstalled) return;
        if (typeof GM_addValueChangeListener !== "function") return;
        const configKeys = [
            CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID,
            CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET,
            CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI,
        ];
        // 授权完成态:回调页写入后,发起页(linux.do 等)须即时刷新状态/占位符
        const authResultKeys = [
            CONFIG.STORAGE_KEYS.NOTION_API_KEY,
            CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE,
            CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN,
            CONFIG.STORAGE_KEYS.NOTION_OAUTH_META,
            CONFIG.STORAGE_KEYS.NOTION_OAUTH_STATE,
        ];
        try {
            const syncUi = () => {
                try {
                    NotionOAuth.syncApiKeyInputs();
                    NotionOAuth.syncRegisteredControls();
                } catch (error) {
                    console.warn("[LD-Notion] OAuth 跨页同步失败", error?.message || error);
                }
            };
            for (const key of configKeys) {
                GM_addValueChangeListener(key, syncUi);
            }
            for (const key of authResultKeys) {
                GM_addValueChangeListener(key, syncUi);
            }
            GM_addValueChangeListener(CONFIG.STORAGE_KEYS.NOTION_OAUTH_NOTICE, (_name, _oldValue, newValue, remote) => {
                if (!remote || !newValue) return;
                try {
                    const notice = Utils.safeJsonParse(newValue, null);
                    if (!notice?.message) return;
                    // 发起页即时刷新 OAuth 状态文案(回调页也会 consumeNotice;GM_notification 已在 pushNotice)
                    NotionOAuth.syncApiKeyInputs();
                    NotionOAuth.syncRegisteredControls();
                } catch (error) {
                    console.warn("[LD-Notion] OAuth 跨页通知同步失败", error?.message || error);
                }
            });
        } catch (error) {
            // 注册失败静默降级(仅失去跨页刷新),与 storage/index.js 既有先例一致
            console.warn("[LD-Notion] OAuth 跨页监听注册失败", error?.message || error);
            return;
        }
        // P4 收敛(c06): 注册全部成功后才置位 —— 中途抛错不再永久跳过剩余监听器
        NotionOAuth._crossPageWatchersInstalled = true;
    },


    // v3.14.16: 同步认证方式单选 / 状态行 / 分区弱化（主面板 / Notion 站 / 通用剪藏共用）
    syncAuthModeUI: (root = document) => {
        if (!root || typeof root.querySelector !== "function") return;
        const mode = NotionOAuth.getAuthMode();
        const manualRadio = root.querySelector("[data-ldb-auth-mode=\"manual\"]");
        const oauthRadio = root.querySelector("[data-ldb-auth-mode=\"oauth\"]");
        if (manualRadio) manualRadio.checked = mode === "manual";
        if (oauthRadio) oauthRadio.checked = mode === "oauth";
        const statusEl = root.querySelector("[data-ldb-auth-mode-status]");
        if (statusEl) {
            if (mode === "oauth") {
                const connected = NotionOAuth.isOAuthConnected();
                statusEl.textContent = connected
                    ? "当前启用：OAuth（已连接）"
                    : "当前启用：OAuth（未授权）";
            } else {
                statusEl.textContent = "当前启用：API Key";
            }
        }
        const manualSection = root.querySelector("[data-ldb-auth-section=\"manual\"]");
        const oauthSection = root.querySelector("[data-ldb-auth-section=\"oauth\"]");
        if (manualSection) {
            manualSection.classList.toggle("ldb-auth-section-muted", mode !== "manual");
            manualSection.classList.toggle("ldb-auth-section-active", mode === "manual");
        }
        if (oauthSection) {
            oauthSection.classList.toggle("ldb-auth-section-muted", mode !== "oauth");
            oauthSection.classList.toggle("ldb-auth-section-active", mode === "oauth");
        }
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

            // 授权进行中状态可见(三模型共识 R4):pending 存在且未过期 → 提示等待回调
            const pending = NotionOAuth.getPendingState();
            if (pending?.state && pending?.createdAt && !status.connected) {
                const remainingMs = pending.createdAt + 10 * 60 * 1000 - Date.now();
                if (remainingMs > 0) {
                    const remainingMin = Math.max(1, Math.ceil(remainingMs / 60000));
                    fields.statusEl.textContent = `⏳ 已打开授权页，等待 Notion 回调（剩余约 ${remainingMin} 分钟）`;
                    fields.statusEl.style.color = "#f59e0b";
                } else {
                    NotionOAuth.clearPendingState();
                }
            } else {
                fields.statusEl.textContent = status.text;
                if (fields.statusEl.style) {
                    fields.statusEl.style.color = status.color;
                }
            }
            fields.authorizeBtn.textContent = status.connected ? "🔄 重新授权" : "🔐 一键授权";
            // v3.14.13: 清除按钮会清除本地全部 Notion 凭据(含手动保存的 API Key)——
            // 文案明示, 避免 manual 用户误以为仅断 OAuth。
            fields.clearBtn.textContent = status.connected ? "断开 OAuth 并清除本地凭据" : "清除本地凭据(含手动 API Key)";
            fields.clearBtn.disabled = !status.connected
                && !CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN)
                && !CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_API_KEY)
                // P4 收敛(c06): clearConnection 会清除 OAuth 配置三键 —— 按钮判定必须对称,
                // 否则仅存配置未授权时清除入口禁用, 错误配置只能覆盖不能清除
                && !CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID)
                && !CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET)
                && !CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI);
            NotionOAuth.syncAuthModeUI(root);
        };

        const saveFormConfig = async () => {
            // 先校验再保存(三模型共识):非法 client_id/redirect_uri 在本地拦截,
            // 携带 code 供 change handler 区分「部分填写」静默与真实错误。
            const clientIdRaw = fields.clientIdInput.value.trim();
            const redirectUriRaw = fields.redirectUriInput.value.trim() || CONFIG.DEFAULTS.notionOauthRedirectUri;
            const clientIdCheck = NotionOAuth.validateOAuthClientId(clientIdRaw);
            if (!clientIdCheck.valid) {
                const err = new Error(clientIdCheck.message);
                err.code = clientIdCheck.code;
                throw err;
            }
            const redirectCheck = NotionOAuth.validateOAuthRedirectUri(redirectUriRaw);
            if (!redirectCheck.valid) {
                const err = new Error(redirectCheck.message);
                err.code = redirectCheck.code;
                throw err;
            }
            await NotionOAuth.saveConfig({
                clientId: clientIdCheck.value,
                clientSecret: fields.clientSecretInput.value.trim(),
                redirectUri: redirectCheck.value,
            });
        };

        let warnedDefaultRedirectUri = false;

        // v3.14.16: 认证方式单选（若面板提供）
        root.querySelectorAll("[data-ldb-auth-mode]").forEach((radio) => {
            if (radio.dataset.ldbAuthModeBound === "1") return;
            radio.dataset.ldbAuthModeBound = "1";
            radio.addEventListener("change", async () => {
                if (!radio.checked) return;
                const next = radio.getAttribute("data-ldb-auth-mode") === "oauth" ? "oauth" : "manual";
                NotionOAuth.setAuthMode(next);
                // 切到 API Key 时：若输入框已预填，立即落盘（单选为真相源后不会再靠保存偷 mode）
                if (next === "manual") {
                    const apiInput = root.querySelector("#ldb-api-key, #ldb-notion-api-key, #gclip-api-key-input");
                    const live = String(apiInput?.value || "").trim();
                    if (live) {
                        try { await NotionOAuth.setManualApiKey(live); } catch { /* 校验警告已在 setManualApiKey */ }
                    }
                }
                if (typeof notify === "function") {
                    notify(next === "oauth" ? "已切换为公开 OAuth" : "已切换为 API Key（Internal）", "success");
                }
            });
        });

        [fields.clientIdInput, fields.clientSecretInput, fields.redirectUriInput].forEach((input) => {
            input.addEventListener("change", async () => {
                try {
                    await saveFormConfig();
                    sync();
                } catch (error) {
                    // 部分填写(如先粘 Secret)时 EMPTY 静默,点击授权时统一报错
                    if (error && error.code === "EMPTY") return;
                    if (typeof notify === "function") {
                        notify(error.message || String(error), "error");
                    }
                }
            });
        });

        fields.authorizeBtn.addEventListener("click", async () => {
            try {
                await saveFormConfig();
                // 默认 Redirect URI 引导(三模型共识):未注册时 Notion 授权后无法回调
                if (!warnedDefaultRedirectUri && NotionOAuth.getConfig().redirectUri === CONFIG.DEFAULTS.notionOauthRedirectUri) {
                    warnedDefaultRedirectUri = true;
                    if (typeof notify === "function") {
                        notify("当前 Redirect URI 为默认共享回调 https://smith-106.github.io/LD-Notion/oauth-callback。请确认已在 Notion 集成后台（OAuth 域和 URI）逐字符注册该地址（勿用 https://www.notion.so/，新连接表单会拒绝）；未注册时 Notion 授权后会报错且无法回调。", "info");
                    }
                }
                // localhost 回调提示(三模型共识验证轮):userscript 不运行于 localhost 页,回调无法自动完成
                const redirectCheck = NotionOAuth.validateOAuthRedirectUri(NotionOAuth.getConfig().redirectUri);
                if (redirectCheck.valid && redirectCheck.code === "LOCALHOST" && typeof notify === "function") {
                    notify(redirectCheck.message, "info");
                }
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
                    notify("已清除本地全部 Notion 凭据(含手动 API Key 与 OAuth 残留)，可重新填写；这不会撤销 Notion 后台授权。", "success");
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
        // v3.14.13 (P1-4): 无条件清 NOTION_API_KEY——此前仅 oauth 模式清键, manual 模式下
        // OAuth 残留(applyTokenResponse 曾用 access_token 覆盖此键)永不清除, 用户断开授权后
        // 定时更新仍直发残留 token 401。断开=清除本地全部凭据的用户意图, 与 authMode 无关。
        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "");
        await NotionOAuth.setRefreshToken("");
        NotionOAuth.setMeta({});
        NotionOAuth.clearPendingState();
        NotionOAuth.setAuthMode("manual");
        // 全盘审计修复(交叉回归#4): 清除 OAuth 配置三键——此前仅 saveConfig 一个写点且空值不覆盖,
        // clientId 永不可经 UI 清除, 与 invalid_client 无限重试叠加成"授权拦截+续签失败+无法清除"三锁死。
        // 清空配置后重新授权需重填 Client ID(断开=摆脱 OAuth 的用户意图一致)。
        Storage.remove(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_ID);
        Storage.remove(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET);
        Storage.remove(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REDIRECT_URI);
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
        // 先构建 URL 再落 pending(三模型共识):校验失败时不残留幽灵 pending state
        const authUrl = NotionOAuth.buildAuthorizeUrl(config, state);
        NotionOAuth.setPendingState({
            state,
            redirectUri: config.redirectUri,
            createdAt: Date.now(),
        });

        // 诊断日志(三模型共识):仅含 client_id/redirect_uri/state,无任何 secret,符合 REDACT_IN_LOGS 纪律
        try {
            const parsed = new URL(authUrl);
            console.info("[LD-Notion] Notion OAuth 授权请求参数", {
                client_id: parsed.searchParams.get("client_id"),
                redirect_uri: parsed.searchParams.get("redirect_uri"),
                state: parsed.searchParams.get("state"),
            });
        } catch (_) { /* 日志失败不影响授权 */ }
        // 修复(三模型共识 R2):window.open(...,"noopener,noreferrer") 恒返回 null(实测),
        // 旧判定 if(!opened) 永远为真 → 永远整页跳转丢失上下文。
        // 先尝试带 noopener 的打开(防反向 tabnabbing);返回 null 时降级无 noopener 重试;
        // 仍失败才整页跳转(授权仍可完成,但丢失原页面)。
        let opened = null;
        try {
            opened = window.open(authUrl, "_blank", "noopener,noreferrer");
        } catch (_) {
            opened = null;
        }
        if (!opened) {
            try {
                opened = window.open(authUrl, "_blank");
            } catch (_) {
                opened = null;
            }
        }
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
                    // 诊断化(三模型共识 R3):错误分类映射,禁止回显请求体(REDACT_IN_LOGS 纪律)
                    const exchangeError = new Error(describeExchangeError(result, response.status));
                    // 附加原始 OAuth error code(安全审计 hy3 MEDIUM: 降级判断此前只匹配
                    // 中文文案关键词, invalid_client 分支文案不含 "invalid_client" → 死代码)
                    exchangeError.code = String(result?.error || "").toLowerCase();
                    reject(exchangeError);
                },
                onerror: (error) => reject(new Error(`OAuth 网络请求失败: ${error?.error || error}`)),
                timeout: 30000,
                ontimeout: () => reject(new Error("OAuth 请求超时，请检查网络连接")),
            });
        });
    },

    applyTokenResponse: async (result = {}, options = {}) => {
        if (!result?.access_token) throw new Error("Notion OAuth 未返回 access_token");

        Storage.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, result.access_token);
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

        // 授权后目标发现钩子(三模型共识):source 门控 — 仅首次授权走完整发现,
        // 静默续签(source="refresh")不触发目标重选(不打扰用户)
        const source = options?.source || "unknown";
        await NotionOAuth._notifyPostAuth({
            accessToken: result.access_token,
            meta: NotionOAuth.getMeta(),
            source,
        });
    },

    // v3.14.6 (AUD-ARCH-11): 续签失败终态判定单源 —— invalid_grant/invalid_client 或凭证类关键词
    // 为终态(已使用/已过期/Client 配置无效), 其余(网络/超时/5xx)为可恢复瞬态;
    // api 层据此决定是否标记 isAuthTerminal 中止整批(可恢复批次不得误杀)
    isTerminalRefreshError: (error) => {
        const message = String(error?.message || "");
        const errorCode = String(error?.code || "").toLowerCase();
        return errorCode === "invalid_grant" || errorCode === "invalid_client"
            || message.includes("已使用或已过期") || message.includes("invalid_grant")
            || message.includes("invalid_client") || message.includes("Client 配置无效")
            || message.includes("Client ID 与 Client Secret 不匹配");
    },

    refreshAccessToken: async () => {
        // 并发串行化(三模型共识,借鉴 MCP 令牌工程):多标签 401 同时续签时单飞,
        // 避免 refresh_token 轮换竞争与重复交换
        if (NotionOAuth._refreshInFlight) {
            return NotionOAuth._refreshInFlight;
        }
        NotionOAuth._refreshInFlight = (async () => {
            // v3.14.6 (CC-09): 跨 tab 续签租约 —— refresh_token 轮换 + 双 tab 并发时
            // 后到者 invalid_grant 被判终态清凭据降级(先到者已成功); 持锁者交换,
            // 其余等待 GM 值变化拿到新 token
            const { SyncLock } = require("../sync-lock");
            const leaseKey = CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_LEASE;
            let lease = null;
            try {
                // P4 收敛(c06 2/3): acquireLease 必须在 try 内 —— 在 try 外抛错时 finally 不执行,
                // _refreshInFlight 永不复位, 后续续签全部复用同一个 rejected promise(永久失败)
                lease = await SyncLock.acquireLease(leaseKey, 30000);
                if (!lease) {
                    const rotated = await NotionOAuth._waitForTokenRotation(30000);
                    if (rotated) return rotated;
                    // 30s 未等到(他 tab 崩溃/超时) → 租约 TTL 已过期, 重试获取
                    lease = await SyncLock.acquireLease(leaseKey, 30000);
                    if (!lease) throw new Error("Notion OAuth 续签被其他标签页占用，请稍后重试");
                }
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

                try {
                    const result = await NotionOAuth.exchangeToken({
                        grant_type: "refresh_token",
                        refresh_token: refreshToken,
                    });
                    await NotionOAuth.applyTokenResponse(result, { source: "refresh" });
                    return result.access_token;
                } catch (error) {
                    const isTerminal = NotionOAuth.isTerminalRefreshError(error);
                    if (isTerminal) {
                        // v3.14.6 (CC-09): 降级前重读存储 token —— 他 tab 可能已轮换成功,
                        // 用新值重试一次再判终态(防后到者误清凭据)
                        const stored = Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "");
                        if (stored && stored !== refreshToken) {
                            const retryResult = await NotionOAuth.exchangeToken({
                                grant_type: "refresh_token",
                                refresh_token: stored,
                            });
                            await NotionOAuth.applyTokenResponse(retryResult, { source: "refresh" });
                            return retryResult.access_token;
                        }
                        // invalid_grant/invalid_client 均视为终态(三模型共识 + 全盘审计交叉回归):
                        // invalid_grant=已使用/已过期; invalid_client=clientId 被污染/非法——
                        // 两者都清 token 降级 manual, 禁止无限重试(此前 invalid_client 永不降级,
                        // 与 clientId 无法清除叠加成死锁)。
                        // v3.14.7 (AUD-ARCH-11 残余修复): 同时清除残留的过期 access token——
                        // 否则降级后每次导出首项即报「API token is invalid」, 且用户无法从
                        // 输入框占位符看出需要重新授权。
                        await NotionOAuth.setRefreshToken("");
                        Storage.remove(CONFIG.STORAGE_KEYS.NOTION_API_KEY);
                        NotionOAuth.setAuthMode("manual");
                        const message = String(error?.message || "");
                        const errorCode = String(error?.code || "").toLowerCase();
                        const hint = errorCode === "invalid_client" || message.includes("invalid_client") || message.includes("Client ID 与 Client Secret 不匹配")
                            ? "Notion OAuth Client 配置无效，已切换手动模式。请重新一键授权或填写有效 Client ID。"
                            : "Notion OAuth 登录已过期，请重新点击一键授权。";
                        NotionOAuth.pushNotice(hint, "error");
                    }
                    throw error;
                }
            } finally {
                if (lease) SyncLock.releaseLease(leaseKey, lease);
                NotionOAuth._refreshInFlight = null;
            }
        })();
        return NotionOAuth._refreshInFlight;
    },

    // v3.14.6 (CC-09): 等待他 tab 轮换后的新 token(GM 存储值变化轮询)
    _waitForTokenRotation: (timeoutMs = 30000) => {
        return new Promise((resolve) => {
            const before = Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "");
            const start = Date.now();
            const poll = () => {
                const current = Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN, "");
                if (current && current !== before) {
                    resolve(Storage.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, ""));
                    return;
                }
                if (Date.now() - start >= timeoutMs) {
                    resolve(null);
                    return;
                }
                setTimeout(poll, 500);
            };
            poll();
        });
    },

    handleRedirectCallback: async () => {
        const pending = NotionOAuth.getPendingState();
        if (!pending?.state || !pending?.redirectUri) {
            NotionOAuth.clearCallbackSnapshot();
            return false;
        }

        // OAuth 修复·次要项(用户选定):pending 10 分钟 TTL,防陈旧 code/state 残留重放干扰后续授权
        if (pending.createdAt && Date.now() - pending.createdAt > 10 * 60 * 1000) {
            NotionOAuth.clearPendingState();
            NotionOAuth.clearCallbackSnapshot();
            Utils.cleanupUrlParams(["code", "state", "error"]);
            return false;
        }

        // Prefer document-start snapshot: Notion SPA may have already wiped live query
        const snapshot = NotionOAuth._callbackSnapshot;
        const snapshotFresh = !!(
            snapshot
            && (snapshot.code || snapshot.error)
            && snapshot.capturedAt
            && (Date.now() - snapshot.capturedAt <= 10 * 60 * 1000)
        );

        let callbackHref = "";
        let code = null;
        let error = null;
        let state = null;

        if (snapshotFresh) {
            callbackHref = snapshot.href;
            code = snapshot.code;
            error = snapshot.error;
            state = snapshot.state;
        } else {
            try {
                callbackHref = window.location.href;
                const currentUrl = new URL(callbackHref);
                code = currentUrl.searchParams.get("code");
                error = currentUrl.searchParams.get("error");
                state = currentUrl.searchParams.get("state");
            } catch {
                NotionOAuth.clearCallbackSnapshot();
                return false;
            }
        }

        if (!code && !error) {
            NotionOAuth.clearCallbackSnapshot();
            return false;
        }
        if (!NotionOAuth.matchesRedirectUri(callbackHref, pending.redirectUri)) {
            // 诊断化(三模型共识 R1):仅当 URL 携带 code/error 时提示差异,普通页面加载不打扰
            const diff = describeRedirectUriMismatch(callbackHref, pending.redirectUri);
            NotionOAuth.pushNotice(
                `回调地址与 Redirect URI 不一致: 期望 ${diff.expected?.origin || "?"}${diff.expected?.pathname || ""} / 实际 ${diff.actual?.origin || "?"}${diff.actual?.pathname || ""}。请检查 Notion 集成后台的 Redirect URI 配置。`,
                "error"
            );
            NotionOAuth.clearCallbackSnapshot();
            return false;
        }

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
            await NotionOAuth.applyTokenResponse(result, { source: "oauth_callback" });
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
            NotionOAuth.clearCallbackSnapshot();
            Utils.cleanupUrlParams(["code", "state", "error"]);
        }

        return true;
    },
};

module.exports = { CredentialVault, TargetState, NotionOAuth };
