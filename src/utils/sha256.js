"use strict";

// 同步 SHA-256 纯函数实现(零依赖, 供 utils 与 DedupStore 共享)。
// 输出与浏览器 crypto.subtle.digest("SHA-256") / node createHash("sha256") 一致(互通)。
// 字节输入按 UTF-8 编码, 输出 64 位小写 hex。
// 背景: DedupStore 需要同步哈希(去重键跨设备同步), 但 DedupStore 不能 require utils
// (utils → storage → DedupStore 循环); 独立模块打破环且保持单实现。

const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function _utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) {
            out.push(code);
        } else if (code < 0x800) {
            out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff) {
            const low = i + 1 < str.length ? str.charCodeAt(i + 1) : -1;
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                i++;
            } else {
                // v3.14.6 (DC-010): 孤立高位代理项(含末尾)输出 U+FFFD(EF BF BD), 对齐 TextEncoder 标准
                // (此前 WTF-8 3 字节原样编码 → 双实现哈希不等价)
                out.push(0xef, 0xbf, 0xbd);
            }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            // v3.14.6 (DC-010): 孤立低位代理项 → U+FFFD
            out.push(0xef, 0xbf, 0xbd);
        } else if (code >= 0x10000) {
            // BMP 外字符(emoji 等): 4 字节 UTF-8
            out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
            out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return out;
}

// 压缩一个 64 字节块; state 为上一块后的完整状态(默认标准 IV)。
// 返回完整状态 = 初始 state + 64 轮结果(FIPS 压缩函数 CV' = CV + Σ)。
// 注意: 多块输入必须以 state 链式传递, 不能在循环外固定 IV 累加增量。
function _sha256Rounds(blockBytes, state) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
        w[i] = (blockBytes[i * 4] << 24) | (blockBytes[i * 4 + 1] << 16) | (blockBytes[i * 4 + 2] << 8) | blockBytes[i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a, b, c, d, e, f, g, h, a0, b0, c0, d0, e0, f0, g0, h0;
    if (state) {
        [a0, b0, c0, d0, e0, f0, g0, h0] = state;
    } else {
        a0 = 0x6a09e667; b0 = 0xbb67ae85; c0 = 0x3c6ef372; d0 = 0xa54ff53a;
        e0 = 0x510e527f; f0 = 0x9b05688c; g0 = 0x1f83d9ab; h0 = 0x5be0cd19;
    }
    a = a0; b = b0; c = c0; d = d0; e = e0; f = f0; g = g0; h = h0;
    for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    return [(a + a0) | 0, (b + b0) | 0, (c + c0) | 0, (d + d0) | 0, (e + e0) | 0, (f + f0) | 0, (g + g0) | 0, (h + h0) | 0];
}

function sha256HexSync(str) {
    const bytes = _utf8Bytes(String(str ?? ""));
    const bitLen = bytes.length * 8;
    const padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    // 64 位长度字段(高 4 字节恒 0; 单次输入 < 2^32 字节)
    padded.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
    let state = null;
    for (let off = 0; off < padded.length; off += 64) {
        state = _sha256Rounds(padded.slice(off, off + 64), state);
    }
    const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
    return state.map(hex).join("");
}

module.exports = { sha256HexSync };
