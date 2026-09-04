"use strict";

// SyncCrypto — SHA-256 哈希助手 + encryptBlob/decryptBlob(PBKDF2-200000/AES-256-GCM)
// 原语与 CredentialVault 同款(auth/index.js _deriveKey/_persistCurrentState),零新依赖。
// M-1 共识: URL 哈希化禁止复用 Utils.apiKeyHash(djb2 32 位非加密),必须 SHA-256。

const { SyncConstants } = require("./constants");

// 环境判断: crypto.subtle 在 page context 可用,node(测试)用 fallback
const subtle = () => {
    if (typeof globalThis.crypto?.subtle?.digest === "function") return globalThis.crypto.subtle;
    return null;
};

const bytesToHex = (bytes) => {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let hex = "";
    for (let i = 0; i < arr.length; i++) {
        hex += arr[i].toString(16).padStart(2, "0");
    }
    return hex;
};

const base64ToBytes = (b64) => {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const bytesToBase64 = (bytes) => {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
};

const SyncCrypto = {
    /**
     * SHA-256 hex(URL 哈希化唯一 canonical 函数)
     * @returns {Promise<string>}
     */
    async sha256Hex(str) {
        const text = String(str ?? "");
        const encoder = new TextEncoder();
        const subtleApi = subtle();
        if (subtleApi) {
            const digest = await subtleApi.digest("SHA-256", encoder.encode(text));
            return bytesToHex(digest);
        }
        // node fallback(crypto 模块)
        const { createHash } = require("crypto");
        return createHash("sha256").update(text).digest("hex");
    },

    // --- encryptBlob / decryptBlob (PBKDF2-200000 + AES-256-GCM, 16B salt / 12B IV) ---

    async _deriveKey(passphrase, saltBytes, iterations = 200000) {
        const encoder = new TextEncoder();
        const subtleApi = subtle();
        if (subtleApi) {
            const baseKey = await subtleApi.importKey(
                "raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]
            );
            return subtleApi.deriveKey(
                { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
                baseKey,
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"]
            );
        }
        // node fallback
        const { scryptSync, createCipheriv } = require("crypto");
        return { mode: "node", key: require("crypto").pbkdf2Sync(passphrase, saltBytes, iterations, 32, "sha256"), createCipheriv };
    },

    _randomBytes(n) {
        if (typeof globalThis.crypto?.getRandomValues === "function") {
            const arr = new Uint8Array(n);
            globalThis.crypto.getRandomValues(arr);
            return arr;
        }
        const { randomBytes } = require("crypto");
        return randomBytes(n);
    },

    /**
     * 加密 payload(异步)
     * @param {string} passphrase
     * @param {string} plaintext
     * @returns {Promise<{v:number, salt:string, iv:string, ct:string}>}
     */
    async encryptBlob(passphrase, plaintext) {
        if (!passphrase) throw new Error("加密需要 passphrase");
        const salt = this._randomBytes(16);
        const iv = this._randomBytes(12);
        const encoder = new TextEncoder();
        const subtleApi = subtle();
        let ciphertext;
        if (subtleApi) {
            const key = await this._deriveKey(passphrase, salt);
            ciphertext = await subtleApi.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
        } else {
            const { createCipheriv } = require("crypto");
            const key = require("crypto").pbkdf2Sync(passphrase, salt, 200000, 32, "sha256");
            const cipher = createCipheriv("aes-256-gcm", key, iv);
            ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        }
        return {
            v: 1,
            salt: bytesToBase64(salt),
            iv: bytesToBase64(iv),
            ct: bytesToBase64(ciphertext),
        };
    },

    /**
     * 解密 payload; 错口令/损坏 throw
     * @param {string} passphrase
     * @param {Object} blob - {v, salt, iv, ct}
     * @returns {Promise<string>}
     */
    async decryptBlob(passphrase, blob) {
        if (!passphrase || !blob || blob.v !== 1) throw new Error("无效的加密 payload");
        const salt = base64ToBytes(blob.salt);
        const iv = base64ToBytes(blob.iv);
        const ct = base64ToBytes(blob.ct);
        const subtleApi = subtle();
        if (subtleApi) {
            const key = await this._deriveKey(passphrase, salt);
            try {
                const plain = await subtleApi.decrypt({ name: "AES-GCM", iv }, key, ct);
                return new TextDecoder().decode(plain);
            } catch (e) {
                throw new Error("口令错误或数据损坏");
            }
        }
        const { createDecipheriv } = require("crypto");
        const key = require("crypto").pbkdf2Sync(passphrase, salt, 200000, 32, "sha256");
        try {
            const decipher = createDecipheriv("aes-256-gcm", key, iv);
            return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
        } catch (e) {
            throw new Error("口令错误或数据损坏");
        }
    },
};

module.exports = { SyncCrypto };
