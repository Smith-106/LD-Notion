import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CredentialVault } from "../src/auth/index.js";
import { CONFIG } from "../src/config/index.js";

describe("CredentialVault", () => {
    describe("SENSITIVE_KEYS", () => {
        it("includes all expected sensitive keys", () => {
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.NOTION_API_KEY)).toBe(true);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET)).toBe(true);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN)).toBe(true);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe(true);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.AI_BASE_URL)).toBe(true);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.GITHUB_TOKEN)).toBe(true);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.OBS_API_KEY)).toBe(true);
            expect(CredentialVault.SENSITIVE_KEYS.has(CONFIG.STORAGE_KEYS.OBS_API_URL)).toBe(true);
        });

        it("has 8 sensitive keys total", () => {
            expect(CredentialVault.SENSITIVE_KEYS.size).toBe(8);
        });
    });

    describe("isSensitiveKey", () => {
        it("returns true for sensitive keys", () => {
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.NOTION_API_KEY)).toBe(true);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.AI_API_KEY)).toBe(true);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.GITHUB_TOKEN)).toBe(true);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.OBS_API_KEY)).toBe(true);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.AI_BASE_URL)).toBe(true);
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.OBS_API_URL)).toBe(true);
        });

        it("returns false for non-sensitive keys", () => {
            expect(CredentialVault.isSensitiveKey(CONFIG.STORAGE_KEYS.FILTER_IMG)).toBe(false);
            expect(CredentialVault.isSensitiveKey("ldb_some_random_key")).toBe(false);
            expect(CredentialVault.isSensitiveKey("")).toBe(false);
        });
    });

    describe("encrypt/decrypt roundtrip", () => {
        afterEach(() => {
            // Always lock after encrypt/decrypt tests to clear session cache
            CredentialVault.lock();
        });

        it("can unlock (init), set, lock, unlock, and get a sensitive value", async () => {
            // First unlock creates the vault (initializeIfMissing defaults to true)
            const status = await CredentialVault.unlock("test-passphrase-123");
            expect(status.unlocked).toBe(true);
            expect(status.hasVault).toBe(true);

            // Set a sensitive key value
            await CredentialVault.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "secret_notion_key_123");
            expect(CredentialVault.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY)).toBe("secret_notion_key_123");

            // Lock the vault
            CredentialVault.lock();
            expect(CredentialVault.isUnlocked()).toBe(false);

            // Unlock with correct passphrase
            const unlockResult = await CredentialVault.unlock("test-passphrase-123", { initializeIfMissing: false, migrateLegacy: false });
            expect(unlockResult.unlocked).toBe(true);
            expect(CredentialVault.isUnlocked()).toBe(true);

            // Retrieve the value after unlock
            expect(CredentialVault.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY)).toBe("secret_notion_key_123");
        });

        it("fails to unlock with wrong passphrase", async () => {
            await CredentialVault.unlock("correct-passphrase");
            await CredentialVault.set(CONFIG.STORAGE_KEYS.AI_API_KEY, "sk-test-key");
            CredentialVault.lock();

            // Wrong passphrase should throw (decryption fails)
            await expect(
                CredentialVault.unlock("wrong-passphrase", { initializeIfMissing: false, migrateLegacy: false })
            ).rejects.toThrow();
            expect(CredentialVault.isUnlocked()).toBe(false);
        });

        it("returns defaultValue when vault is locked", async () => {
            await CredentialVault.unlock("passphrase");
            await CredentialVault.set(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "my-key");
            CredentialVault.lock();

            const value = CredentialVault.get(CONFIG.STORAGE_KEYS.NOTION_API_KEY, "default");
            expect(value).toBe("default");
        });
    });
});
