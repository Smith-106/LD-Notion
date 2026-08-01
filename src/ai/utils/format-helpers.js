"use strict";

// ai/utils/format-helpers.js — 格式化工具集（TASK-007）。
// 从 AIAssistant 提取的纯函数。

module.exports = {

/**
 * 格式化用户摘要信息
 * @param {Object} user - Notion user 对象
 */
_formatUserSummary: (user) => {
    if (!user) return "未知用户";
    const kind = user.type === "bot" ? "bot" : "person";
    const name = user.name || user.bot?.owner?.workspace_name || user.person?.email || "未命名用户";
    const email = user.person?.email ? ` <${user.person.email}>` : "";
    const id = user.id?.replace(/-/g, "") || "";
    return `${name}${email} [${kind}]${id ? ` (ID: ${id})` : ""}`;
},

/**
 * 格式化评论摘要
 * @param {Object} comment - Notion comment 对象
 */
_formatCommentSummary: (comment) => {
    if (!comment) return "无评论";
    const author = comment.created_by?.name || "未知用户";
    const time = comment.created_time ? new Date(comment.created_time).toLocaleString("zh-CN") : "";
    const text = (comment.rich_text || []).map(t => t.plain_text).join("") || "（无内容）";
    return `${author} (${time}): ${text}`;
}

};
