"use strict";

// ai/utils/block-helpers.js — Block 处理工具集（TASK-007）。
// 从 AIAssistant 提取的纯函数。

module.exports = {

/**
 * 提取 block 的纯文本内容
 * @param {Object} block - Notion block 对象
 */
_extractBlockPlainText: (block) => {
    if (!block || !block.type) return "";
    const content = block[block.type];
    if (!content || !content.rich_text) return "";
    return content.rich_text.map(t => t.plain_text).join("");
},

/**
 * 递归收集 block 树（包括子 block）
 * @param {Array} blocks - Notion blocks 数组
 * @param {Function} fetchChildren - 获取子 block 的函数 (blockId) => Promise<blocks[]>
 */
_collectBlockTree: async (blocks, fetchChildren) => {
    const result = [];
    for (const block of blocks) {
        const node = { ...block };
        if (block.has_children && fetchChildren) {
            node.children = await fetchChildren(block.id);
        }
        result.push(node);
    }
    return result;
}

};
