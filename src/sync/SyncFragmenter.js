"use strict";

// SyncFragmenter — payload JSON ↔ Notion rich_text 分片
// 边界: 单块 2000 字符, 单页 100 块。单行超限转多行分片 {index,total,checksum,data}。
// 损坏检测(checksum 不匹配) → defragment 失败, 永不回写。

const { SyncConstants } = require("./constants");

// FNV-1a 32 位校验(非安全用途, 仅完整性检测)
const fnv1a = (text) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};

const SyncFragmenter = {
    /**
     * 分片(单行方案: 若超限转多行分片)
     * @param {string} text
     * @returns {{rows: string[]}}
     */
    fragment(text, { chunkChars = SyncConstants.FRAGMENT_CHUNK_CHARS } = {}) {
        const str = String(text ?? "");
        if (str.length <= SyncConstants.FRAGMENT_MAX_ROW_CHARS) {
            return { rows: [str] };
        }
        const rows = [];
        const checksum = fnv1a(str);
        const prefix = `LD-SYNC:${checksum}:`;
        // 3/3 共识(dsf+glm+qwen): 行头为 `${index+1}/${total};${checksum};`, 旧实现只扣
        // prefix+2 → usable 偏大 8~14 字符, 每个分片行突破 chunkChars(单块 2000)上限被截断
        // → checksum 不匹配, 大 payload 永久不可读。按最宽序号/总数 + 实际 checksum 精确扣减。
        const width = String(SyncConstants.FRAGMENT_MAX_BLOCKS).length;
        const headerLen = prefix.length + width + 1 + width + 1 + checksum.length + 1;
        const usable = Math.max(100, chunkChars - headerLen);
        for (let i = 0; i < str.length; i += usable) {
            rows.push(str.slice(i, i + usable));
        }
        if (rows.length > SyncConstants.FRAGMENT_MAX_BLOCKS) {
            throw new Error(`payload 过大: ${rows.length} 块超过 ${SyncConstants.FRAGMENT_MAX_BLOCKS} 上限`);
        }
        const total = rows.length;
        return {
            rows: rows.map((data, index) => `${prefix}${index + 1}/${total};${checksum};${data}`),
        };
    },

    /**
     * 重组(自动识别分片; 普通单行原样返回)
     * @param {string[]} rowTexts
     * @returns {{ok: boolean, text?: string, error?: string}}
     */
    defragment(rowTexts) {
        const rows = Array.isArray(rowTexts) ? rowTexts : [];
        if (rows.length === 0) return { ok: false, error: "无行数据" };
        const fragments = [];
        const pattern = /^LD-SYNC:([0-9a-z]+):(\d+)\/(\d+);([0-9a-z]+);/;
        const matches = rows.map((row) => String(row || "").match(pattern));
        const matched = matches.filter(Boolean).length;
        if (matched === 0) return { ok: true, text: rows.join("") }; // 普通多行拼接(非分片)
        // 3/3 共识(dsf+glm+qwen): 部分行是分片、部分行不是时, 旧实现直接 join 返回 ok:true
        // → 分片头被拼进 payload 且绕过 checksum 校验(静默数据损坏)。改为显式报错。
        if (matched !== rows.length) {
            return { ok: false, error: "分片行格式不一致(混合了非分片行)" };
        }
        for (let i = 0; i < rows.length; i++) {
            const m = matches[i];
            fragments.push({ checksum: m[1], index: Number(m[2]), total: Number(m[3]), innerChecksum: m[4], data: rows[i].slice(m[0].length) });
        }
        // 校验分片一致性
        const first = fragments[0];
        if (fragments.some((f) => f.total !== first.total || f.checksum !== first.checksum)) {
            return { ok: false, error: "分片元数据不一致" };
        }
        const ordered = fragments.sort((a, b) => a.index - b.index);
        if (ordered.length !== first.total) {
            return { ok: false, error: `分片缺失: ${ordered.length}/${first.total}` };
        }
        for (let i = 0; i < ordered.length; i++) {
            if (ordered[i].index !== i + 1) return { ok: false, error: "分片序号不连续" };
        }
        const text = ordered.map((f) => f.data).join("");
        if (fnv1a(text) !== first.innerChecksum) {
            return { ok: false, error: "checksum 不匹配, payload 损坏" };
        }
        return { ok: true, text };
    },
};

module.exports = { SyncFragmenter };
