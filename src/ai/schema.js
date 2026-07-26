"use strict";

// AI 输出 schema 校验层（ISS-20260723-009, CWE-94）。
// AI 返回的属性名/值/URL 直接写入 Notion，prompt injection 可经 AI 输出写入恶意 URL
// 或异常属性。本模块统一校验 AI 输出，复用 UrlValidator 保持 URL 安全原语单一来源，
// 并提供 parseAIJson 统一入口（正则提取+JSON.parse+按 name 路由校验），消除 7 个消费点
// 的重复三段式，为 ai/index.js 拆分（ISS-20260723-010）预留接缝。

const { UrlValidator } = require("../security/UrlValidator");

const AISchema = {
    // 长度上限
    MAX_PROP_NAME: 64,
    MAX_TITLE: 2000,
    MAX_RICH_TEXT: 2000,
    MAX_SELECT_NAME: 100,
    MAX_EMOJI: 32,
    MAX_NUMBER: 1e15,

    // 属性名白名单：中英数字 + 下划线/连字符/空格
    PROP_NAME_RE: /^[一-龥a-zA-Z0-9 _\-]+$/,

    // Notion 保留/系统属性名（不可作 AI 生成的自定义属性，避免与系统字段冲突）
    NOTION_RESERVED_NAMES: new Set([
        "title", "created_time", "last_edited_time", "created_by", "last_edited_by",
        "url", "path", "Name",
    ]),

    // 合法属性类型白名单
    ALLOWED_PROPERTY_TYPES: new Set([
        "title", "rich_text", "number", "select", "multi_select",
        "checkbox", "date", "url", "email", "phone_number", "status",
    ]),

    // _normalizeNotionProperties 对象值允许的 Notion 属性类型键（拒 relation/people/files 等系统字段）
    ALLOWED_OBJECT_VALUE_TYPES: new Set([
        "title", "rich_text", "number", "select", "multi_select",
        "checkbox", "date", "url", "email", "phone_number", "status",
    ]),

    // ISO 8601 日期正则（简化：YYYY-MM-DD 或带时间）
    ISO_DATE_RE: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,

    // 校验 AI 返回的页面外部 URL（icon/cover）。转发 UrlValidator.validatePageExternalUrl。
    validatePageExternalUrl: (url) => {
        return UrlValidator.validatePageExternalUrl(url);
    },

    // 校验属性名：白名单 + 截断 + 拒 Notion 保留名。返回规范化名或 ""（非法）。
    validatePropertyName: (name) => {
        let n = String(name || "").trim();
        if (!n) return "";
        if (n.length > AISchema.MAX_PROP_NAME) n = n.slice(0, AISchema.MAX_PROP_NAME);
        if (!AISchema.PROP_NAME_RE.test(n)) return "";
        if (AISchema.NOTION_RESERVED_NAMES.has(n)) return "";
        return n;
    },

    // 校验属性类型。返回 { valid, type } 或 { valid: false }。
    validatePropertyType: (type) => {
        const t = String(type || "").trim();
        if (AISchema.ALLOWED_PROPERTY_TYPES.has(t)) return { valid: true, type: t };
        return { valid: false };
    },

    // 校验属性值（按 type）。返回规范化值或 null（非法/应跳过）。
    validatePropertyValue: (val, type) => {
        if (val === undefined || val === null) return null;
        switch (type) {
            case "title":
            case "rich_text":
                return String(val).slice(0, type === "title" ? AISchema.MAX_TITLE : AISchema.MAX_RICH_TEXT);
            case "select":
            case "status":
                return String(val).trim().slice(0, AISchema.MAX_SELECT_NAME);
            case "multi_select": {
                const arr = Array.isArray(val) ? val : [val];
                return arr.map((v) => String(v || "").trim()).filter(Boolean)
                    .map((v) => v.slice(0, AISchema.MAX_SELECT_NAME));
            }
            case "number": {
                const n = Number(val);
                if (!isFinite(n) || Math.abs(n) > AISchema.MAX_NUMBER) return null;
                return n;
            }
            case "checkbox":
                return Boolean(val);
            case "date":
                return AISchema.ISO_DATE_RE.test(String(val).trim()) ? String(val).trim() : null;
            case "url":
            case "email":
            case "phone_number":
                return String(val).trim().slice(0, AISchema.MAX_RICH_TEXT);
            default:
                return String(val).slice(0, AISchema.MAX_RICH_TEXT);
        }
    },

    // 校验 emoji（icon）。长度 + 拒控制字符。
    validateEmoji: (emoji) => {
        const e = String(emoji || "").trim();
        if (!e) return "";
        if (e.length > AISchema.MAX_EMOJI) return e.slice(0, AISchema.MAX_EMOJI);
        // 拒控制字符（除普通空格）
        if (/[\x00-\x1f\x7f]/.test(e)) return "";
        return e;
    },

    // 规范化 _normalizeNotionProperties 的对象值：仅允许 ALLOWED_OBJECT_VALUE_TYPES 顶层键，
    // 拒 relation/people/files/created_by/created_time/last_edited_time 等系统/关联字段。
    // 返回清洗后的对象或 null（应跳过）。
    sanitizeObjectValue: (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const cleaned = {};
        let hasValid = false;
        for (const key of Object.keys(value)) {
            if (AISchema.ALLOWED_OBJECT_VALUE_TYPES.has(key)) {
                cleaned[key] = value[key];
                hasValid = true;
            }
        }
        return hasValid ? cleaned : null;
    },

    // 校验 extractToDatabase 结构：properties/entries 均为 Array、properties[i].name/type 非空 string。
    // 返回 { ok: true } 或 { ok: false, reason }。
    validateExtractToDatabaseSchema: (data) => {
        if (!data || typeof data !== "object") return { ok: false, reason: "AI 返回的数据不是对象" };
        if (!Array.isArray(data.properties)) return { ok: false, reason: "AI 返回的 properties 不是数组" };
        if (!Array.isArray(data.entries)) return { ok: false, reason: "AI 返回的 entries 不是数组" };
        if (data.entries.length === 0) return { ok: false, reason: "未能从页面中提取到有效条目" };
        for (const prop of data.properties) {
            if (!prop || typeof prop.name !== "string" || !prop.name.trim() ||
                typeof prop.type !== "string" || !prop.type.trim()) {
                return { ok: false, reason: "AI 返回的属性结构无效（name/type 缺失）" };
            }
        }
        return { ok: true };
    },

    // 校验 bookmark AI 摘要结构：title/summary 均为 string（防 AI 返回非字符串注入，
    // CWE-94，ISS-010 W8 SEC-009）。返回 { ok: true } 或 { ok: false, reason }。
    // 长度上限由消费侧 normalizeText 截断，此处只校验类型。
    validateBookmarkSummarySchema: (data) => {
        if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "AI 返回的摘要不是对象" };
        if (data.title !== undefined && typeof data.title !== "string") {
            return { ok: false, reason: "AI 返回的 title 不是字符串" };
        }
        if (data.summary !== undefined && typeof data.summary !== "string") {
            return { ok: false, reason: "AI 返回的 summary 不是字符串" };
        }
        return { ok: true };
    },

    // 统一 AI JSON 解析入口：正则提取 + JSON.parse + 按 name 路由校验。
    // name ∈ {"extractToDatabase"|"generatePages"|"editPlan"|"intent"|"agentPlan"|"toolCall"}。
    // 返回 { ok: true, value } 或 { ok: false, reason }。
    parseAIJson: (name, rawText) => {
        if (!rawText) return { ok: false, reason: "AI 响应为空" };
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { ok: false, reason: "AI 响应中未找到 JSON" };
        let parsed;
        try {
            parsed = JSON.parse(jsonMatch[0]);
        } catch (error) {
            return { ok: false, reason: `AI 返回的 JSON 格式无效: ${error.message}` };
        }
        // 按 name 路由结构校验
        if (name === "extractToDatabase") {
            const r = AISchema.validateExtractToDatabaseSchema(parsed);
            if (!r.ok) return r;
        }
        if (name === "bookmarkSummary") {
            const r = AISchema.validateBookmarkSummarySchema(parsed);
            if (!r.ok) return r;
        }
        // 其他 name 的结构校验由消费点按需调用对应 validate* 函数
        return { ok: true, value: parsed };
    },
};

module.exports = { AISchema };
