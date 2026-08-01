"use strict";

// ai/utils/result-helpers.js — 结果处理工具集（TASK-007）。
// 从 AIAssistant 提取的纯函数。

module.exports = {

/**
 * 构建结构化结果文本
 * @param {Object} result - 结构化结果对象
 */
_buildStructuredResultText: (result) => {
    if (!result) return "";
    const parts = [];
    if (result.title) parts.push(`**${result.title}**`);
    if (result.summary) parts.push(result.summary);
    if (result.details) parts.push(result.details);
    return parts.join("\n\n");
},

/**
 * 判断是否为结构化结果
 * @param {*} result - 任意结果
 */
_isStructuredResult: (result) => {
    return result && typeof result === "object" && !Array.isArray(result) && result.__structured === true;
},

/**
 * 推断结构化结果状态
 * @param {Object} result - 结构化结果对象
 */
_inferStructuredResultStatus: (result) => {
    if (!result) return "unknown";
    if (result.success === true) return "success";
    if (result.success === false) return "error";
    if (result.error) return "error";
    return "success";
}

};
