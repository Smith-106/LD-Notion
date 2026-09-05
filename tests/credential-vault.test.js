import { describe, it, expect, afterEach } from "vitest";
import { CredentialVault } from "../src/auth/index.js";
import { CONFIG } from "../src/config/index.js";
import { Storage } from "../src/storage/index.js";

describe("CredentialVault", () => {
    describe("SENSITIVE_KEYS", () => {
        it("all sensitive keys moved out (vault 会话锁定导致更新后 Key 失效, 同 OAuth 先例)", () => {
            // OAuth 三键已脱敏(改明文 GM 存储),不在此集
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.NOTION_API_KEY)).toBe(false);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET)).toBe(false);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN)).toBe(false);
            // v3.14.2: AI/GitHub/Obsidian 键一并移出 —— 保险箱解锁态为模块内存态,
            // 每次页面加载(含脚本更新重载)即锁定, 锁定态读空导致"API Key 失效"
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe(false);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.AI_BASE_URL)).toBe(false);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.GITHUB_TOKEN)).toBe(false);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.OBS_API_KEY)).toBe(false);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.OBS_API_URL)).toBe(false);
        });

        it("has 0 sensitive keys total (保险箱 UI 已移除)", () => {
            expect(CredentialVault.SENSITIVE_KEYS.size).toBe(0);
        });

        it("REDACT_IN_LOGS 超集覆盖全部敏感键(审计不得泄漏)", () => {
            expect(CredentialVault.REDACT_IN_LOGS.has(CONFIG.STORAGE_KEYS.NOTION_API_KEY)).toBe(true);
            expect(CredentialVault.REDACT_IN_LOGS.has(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET)).toBe(true);
            expect(CredentialVault.REDACT_IN_LOGS.has(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN)).toBe(true);
            expect(CredentialVault.REDACT_IN_LOGS.has(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe(true);
            expect(CredentialVault.REDACT_IN_LOGS.has(CONFIG.STORAGE_KEYS.GITHUB_TOKEN)).toBe(true);
            expect(CredentialVault.REDACT_IN_LOGS.size).toBe(8);
        });
    });

    describe("isSensitiveKey", () => {
        it("returns false for all keys (敏感键集已清空)", () => {
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.NOTION_API_KEY)).toBe(false);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe(false);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.GITHUB_TOKEN)).toBe(false);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.OBS_API_KEY)).toBe(false);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.AI_BASE_URL)).toBe(false);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.OBS_API_URL)).toBe(false);
        });

        it("returns false for non-sensitive keys", () => {
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.FILTER_IMG)).toBe(false);
            expect(CredentialVault.isSensitiveKey("ldb_some_random_key")).toBe(false);
            expect(CredentialVault.isSensitiveKey("")).toBe(false);
        });
    });

    describe("GM 明文读写(保险箱无关)", () => {
        afterEach(() => {
            Storage.remove(CONFIG.STORAGE_KEYS.AI_API_KEY);
        });

        it("set/get/clear 直接读写 GM 明文, 无需解锁, 页面加载(重载)后仍可读", async () => {
            // 未解锁状态下写入
            await CredentialVault.set(CONFIG.STORAGE_KEYS.AI_API_KEY, "secret_ai_key_123");
            // 未解锁状态下读取(模拟新页面加载后: 保险箱锁定态不再影响敏感键)
            expect(CredentialVault.get(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe("secret_ai_key_123");
            // Storage.get 走同一明文路径
            expect(Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "")).toBe("secret_ai_key_123");
            // 清除
            await CredentialVault.clear(CONFIG.STORAGE_KEYS.AI_API_KEY);
            expect(CredentialVault.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "default")).toBe("default");
        });

        it("hasPersistedValue 反映明文有无, 与解锁态无关", async () => {
            expect(CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe(false);
            await CredentialVault.set(CONFIG.STORAGE_KEYS.AI_API_KEY, "sk-test-key");
            expect(CredentialVault.hasPersistedValue(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe(true);
        });
    });

    describe("Storage.CredentialVault injection", () => {
        afterEach(() => {
            Storage.CredentialVault = null;
            Storage.remove(CONFIG.STORAGE_KEYS.AI_API_KEY);
        });

        it("Storage.get 对敏感键不再要求 vault 注入(直接明文)", async () => {
            await CredentialVault.set(CONFIG.STORAGE_KEYS.AI_API_KEY, "secret_plaintext");

            Storage.CredentialVault = null;
            const beforeInject = Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "fallback");

            Storage.CredentialVault = CredentialVault;
            const afterInject = Storage.get(CONFIG.STORAGE_KEYS.AI_API_KEY, "fallback");

            // 注入与否结果一致: 敏感键集已空, 全部走 GM 明文
            expect(beforeInject).toBe("secret_plaintext");
            expect(afterInject).toBe("secret_plaintext");
        });
    });
});
