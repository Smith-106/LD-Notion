"use strict";

// ai/utils/payload-builders.js — Notion API payload 构建工具集（TASK-007）。
// 从 AIAssistant 提取的纯函数，不依赖 this 或其他 AIAssistant 方法。

const { Utils } = require("../../utils");

module.exports = {

/**
 * 构建页面图标 payload
 * @param {string} iconType - emoji|external
 * @param {string} iconValue - emoji 字符或 URL
 */
_buildPageIconPayload: (iconType, iconValue) => {
    if (!iconType || !iconValue) return null;
    if (iconType === "emoji") {
        return { type: "emoji", emoji: iconValue };
    }
    if (iconType === "external") {
        return { type: "external", external: { url: iconValue } };
    }
    return null;
},

/**
 * 构建页面封面 payload
 * @param {string} coverUrl - 封面图片 URL
 */
_buildPageCoverPayload: (coverUrl) => {
    if (!coverUrl) return null;
    return { type: "external", external: { url: coverUrl } };
},

/**
 * 构建属性值 payload（根据属性类型自动适配）
 * @param {string} type - rich_text|select|multi_select|number|checkbox|date|url|email|phone_number
 * @param {*} value - 属性值
 */
_buildPropertyValuePayload: (type, value) => {
    switch (type) {
        case "rich_text":
            return { rich_text: [{ type: "text", text: { content: String(value || "") } }] };
        case "select":
            return value ? { select: { name: String(value) } } : { select: null };
        case "multi_select":
            return { multi_select: (Array.isArray(value) ? value : [value]).filter(Boolean).map(v => ({ name: String(v) })) };
        case "number":
            return { number: value != null ? Number(value) : null };
        case "checkbox":
            return { checkbox: Boolean(value) };
        case "date":
            return value ? { date: { start: String(value) } } : { date: null };
        case "url":
            return value ? { url: String(value) } : { url: null };
        case "email":
            return value ? { email: String(value) } : { email: null };
        case "phone_number":
            return value ? { phone_number: String(value) } : { phone_number: null };
        default:
            return { rich_text: [{ type: "text", text: { content: String(value || "") } }] };
    }
},

/**
 * 构建 block 更新 payload
 * @param {Object} block - Notion block 对象
 * @param {string} newContent - 新的文本内容
 */
_buildBlockUpdatePayload: (block, newContent) => {
    const type = block.type;
    if (!type) return null;

    // 保留原有样式，仅替换文本
    const existing = block[type] || {};
    const richText = existing.rich_text || [];
    const firstText = richText[0] || {};
    const annotations = firstText.annotations || {};

    return {
        [type]: {
            rich_text: [{
                type: "text",
                text: { content: newContent },
                annotations
            }]
        }
    };
}

};
