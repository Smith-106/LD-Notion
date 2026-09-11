"use strict";

// 导出层共享原语: 单一遍历模型 / 单一媒体判据 / 单一单行上下文折叠入口。
// 消费方: src/api/DOMToNotion.js(P1 起)、src/api/obsidian.js(P2 起)。
// leaf 模块: 不得 require DOMToNotion.js / obsidian.js。
// 背景: wave9-wave14 六轮审计的真缺陷全部是同构出口各自实现所致(块/内联分类两处、
// script/style 跳过两处、emoji 判据五处、媒体采集五处、单行折叠多站点),
// 故按 spec:project:learnings-006(出口面统一枚举法)收束为单一定义。

const { Utils } = require("../utils");

// wave14 共识(dsf): 已识别为块级(有专属烹饪分支或容器块)的元素标签 —— 用于顺序化遍历
// (其余元素透明下钻, 其内联内容并入同一段落缓冲)
const BLOCK_TAGS = new Set([
    "div", "p", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "table", "img", "video", "audio", "iframe", "hr", "aside",
]);

// wave11/wave13 共识: 非渲染元素 —— 其文本(JS/CSS 源码)不得进入 rich_text / Markdown
const SKIP_TAGS = new Set(["script", "style", "noscript"]);

const tagOf = (el) => (el && el.tagName ? String(el.tagName).toLowerCase() : "");

const DomSpec = {
    BLOCK_TAGS,
    SKIP_TAGS,

    // 块级判据: 标签集 ∪ 类名容器(灯箱/图片容器/md-table/a.attachment/aside.quote)
    isBlockNode: (el) => {
        const t = tagOf(el);
        if (BLOCK_TAGS.has(t)) return true;
        const cls = el && el.classList;
        if (!cls) return false;
        return cls.contains("lightbox-wrapper") || cls.contains("image-wrapper")
            || cls.contains("md-table")
            || (t === "a" && cls.contains("attachment"))
            || (t === "aside" && cls.contains("quote"));
    },

    isSkippedNode: (el) => SKIP_TAGS.has(tagOf(el)),

    // 媒体判据: 标签 → 块类型; a.attachment 视为附件
    mediaKind: (el) => {
        const t = tagOf(el);
        if (t === "img" || t === "video" || t === "audio" || t === "iframe") return t;
        if (t === "a" && el.classList && el.classList.contains("attachment")) return "attachment";
        return null;
    },

    // 媒体采集: 元素自身先按自身标签分派(querySelectorAll 只查后代, 元素本身即媒体时会漏采),
    // 再按固定类序采集后代(img → a.attachment → video → audio → iframe, 各类内部保持文档序),
    // 每节点恰一次。wave8(段落/li/引用/单元格补发)、wave9(标题补发)、wave14(自身即媒体)的统一来源。
    eachMedia: (el, visit) => {
        if (!el) return;
        const selfKind = DomSpec.mediaKind(el);
        if (selfKind) visit(el, selfKind);
        if (typeof el.querySelectorAll !== "function") return;
        el.querySelectorAll("img").forEach((node) => visit(node, "img"));
        el.querySelectorAll("a.attachment").forEach((node) => visit(node, "attachment"));
        el.querySelectorAll("video").forEach((node) => visit(node, "video"));
        el.querySelectorAll("audio").forEach((node) => visit(node, "audio"));
        el.querySelectorAll("iframe").forEach((node) => visit(node, "iframe"));
    },

    // wave12 共识(qwen): emoji 图"跳过块级图片"与"转 emoji 文本"必须同口径 ——
    // 前者按 src.includes("/images/emoji/") 跳、后者只认四家 set 会致 Discourse 其余
    // set(win10/emoji_one 等)两边都不命中而静默丢失; 此处 set 目录放宽为任意值
    emojiNameOf: (src) => {
        const m = String(src || "").match(/\/images\/emoji\/[^/]+\/([^/.]+)\.png/i);
        return m ? m[1] : null;
    },

    // 单行上下文出口面的唯一入口(引用块内/callout 行/表格单元格/标题/link label/img alt)。
    // 实现仍驻 Utils.mdText(公开壳, 供 ai/ui 跨模块调用), 此处只做导出层命名收束 ——
    // 依赖方向保持 api → utils, 且折叠语义只有一处实现。
    collapseOneLine: Utils.mdText,

    // 有序子节点遍历(含文本节点, 文档序)。单一来源取代各处的
    // Array.from(el.childNodes || []).forEach(...)(部分站点漏了 || [] 保护)。
    eachChildOrdered: (el, visit) => {
        Array.from((el && el.childNodes) || []).forEach((node) => visit(node));
    },
};

module.exports = { DomSpec };
