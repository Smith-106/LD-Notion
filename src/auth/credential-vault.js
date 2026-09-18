"use strict";

// credential-vault.js — 凭证保险箱 (M3 milestone 拆分: 提取自 auth/index.js CredentialVault ~490 LOC)。
// v3.14.2 起敏感键集已清空, vault 解锁态为模块内存态, 每次加载即锁定; 本文件承载 CredentialVault 全部实现。
// 依赖: CONFIG / Storage / Utils / crypto (无回流边, auth/index 反向 require 本文件再导出)。

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");

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
            .replace(/gho_[A-Za-z0-9]{20,}/g, "***REDACTED***")
            // P4 收敛(c06): 同族前缀 ghu_(user-to-server)/ghs_(server-to-server)/ghr_(refresh)
            // 原清单遗漏 → 自由文本中的这类 token 明文落盘
            .replace(/gh[usr]_[A-Za-z0-9]{20,}/g, "***REDACTED***");
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
module.exports = { CredentialVault };
