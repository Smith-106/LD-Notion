"use strict";

const { isSupportedFileType } = require("../config");
const { Utils } = require("../utils");
const { UrlValidator } = require("../security/UrlValidator");
const { normalizeLanguage, EMOJI_MAP } = require("./constants");

const DOMToNotion = {
    // ===== cookedToBlocks 各元素处理器（MNT-003 提取，保持 if 顺序与逻辑等价）=====

    // 过滤导入页面（帖子 HTML）中的外部 URL：复用 UrlValidator.validatePageExternalUrl
    // 拒绝内网/私有/链路本地（169.254 云元数据 SSRF 防御）与非 http(s) 协议。
    // 与 src/ai/schema.js 的 AISchema.validatePageExternalUrl 同原语（ISS-20260723-009 CWE-94 sibling）。
    _safeExternalUrl: (full) => {
        if (!full || !UrlValidator.validatePageExternalUrl(full)) return "";
        return full;
    },

    // 图片容器 lightbox-wrapper / image-wrapper
    _cookLightbox: (el, blocks, imgMode) => {
        const img = el.querySelector("img");
        if (!img) return;
        const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
        const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
        if (full && !src.includes("/images/emoji/")) {
            if (imgMode === "skip") return;
            blocks.push({
                type: "image",
                image: { type: "external", external: { url: full } },
                _needsUpload: imgMode === "upload",
                _originalUrl: full,
                _fileType: "image",
            });
        }
    },

    // 附件链接 a.attachment
    _cookAttachment: (el, blocks, imgMode) => {
        const href = el.getAttribute("href") || "";
        const fileName = el.textContent?.trim() || "attachment";
        const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(href));
        if (full && imgMode !== "skip") {
            blocks.push({
                type: "file",
                file: {
                    type: "external",
                    external: { url: full },
                    caption: [{ type: "text", text: { content: fileName } }],
                },
                _needsUpload: imgMode === "upload",
                _originalUrl: full,
                _fileType: "file",
                _fileName: fileName,
            });
        }
    },

    // 视频元素
    _cookVideo: (el, blocks, imgMode) => {
        const source = el.querySelector("source");
        const src = el.getAttribute("src") || source?.getAttribute("src") || "";
        const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
        if (full && imgMode !== "skip") {
            const ext = (full.split(".").pop() || "").split("?")[0].toLowerCase();
            if (isSupportedFileType(ext)) {
                blocks.push({
                    type: "video",
                    video: { type: "external", external: { url: full } },
                    _needsUpload: imgMode === "upload",
                    _originalUrl: full,
                    _fileType: "video",
                });
            } else {
                blocks.push({
                    type: "embed",
                    embed: { url: full },
                });
            }
        }
    },

    // 音频元素
    _cookAudio: (el, blocks, imgMode) => {
        const source = el.querySelector("source");
        const src = el.getAttribute("src") || source?.getAttribute("src") || "";
        const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
        if (full && imgMode !== "skip") {
            blocks.push({
                type: "audio",
                audio: { type: "external", external: { url: full } },
                _needsUpload: imgMode === "upload",
                _originalUrl: full,
                _fileType: "audio",
            });
        }
    },

    // iframe 嵌入，返回 true 表示已处理（视频 src），false 表示未匹配需 fallthrough
    _cookIframe: (el, blocks) => {
        const src = el.getAttribute("src") || "";
        if (!src) return false;
        // 子串匹配（src.includes）可被 evil.com/youtube.com 或 169.254.169.254/player.html 绕过
        // 写入 Notion embed.url（服务端抓取触发 SSRF，CWE-918，ISS-009 sibling 补全）。
        // 改 hostname 严格白名单 + _safeExternalUrl 校验（拒内网/169.254/非 http(s)）。
        let host = "";
        try { host = new URL(Utils.absoluteUrl(src)).hostname; } catch { return false; }
        const isAllowedEmbedHost =
            host === "youtube.com" || host.endsWith(".youtube.com") ||
            host === "youtu.be" || host.endsWith(".youtu.be") ||
            host === "vimeo.com" || host.endsWith(".vimeo.com") ||
            host === "bilibili.com" || host.endsWith(".bilibili.com");
        if (isAllowedEmbedHost || host.includes("player.")) {
            const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
            if (full) {
                blocks.push({ type: "embed", embed: { url: full } });
                return true;
            }
        }
        return false;
    },

    // 引用块 aside.quote
    _cookAsideQuote: (el, blocks) => {
        const blockquote = el.querySelector("blockquote");
        if (blockquote) {
            const richText = DOMToNotion.serializeRichText(blockquote);
            if (richText.length > 0) {
                blocks.push({ type: "quote", quote: { rich_text: richText } });
            }
        }
    },

    // 段落 p（含内部图片与附件）
    _cookParagraph: (el, blocks, imgMode) => {
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
        }
        el.querySelectorAll("img").forEach((img) => {
            const src = img.getAttribute("src") || "";
            const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
            if (full && !src.includes("/images/emoji/")) {
                if (imgMode !== "skip") {
                    blocks.push({
                        type: "image",
                        image: { type: "external", external: { url: full } },
                        _needsUpload: imgMode === "upload",
                        _originalUrl: full,
                        _fileType: "image",
                    });
                }
            }
        });
        el.querySelectorAll("a.attachment").forEach((a) => {
            const href = a.getAttribute("href") || "";
            const fileName = a.textContent?.trim() || "attachment";
            const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(href));
            if (full && imgMode !== "skip") {
                blocks.push({
                    type: "file",
                    file: {
                        type: "external",
                        external: { url: full },
                        caption: [{ type: "text", text: { content: fileName } }],
                    },
                    _needsUpload: imgMode === "upload",
                    _originalUrl: full,
                    _fileType: "file",
                    _fileName: fileName,
                });
            }
        });
    },

    // 代码块 pre
    _cookCode: (el, blocks) => {
        const codeEl = el.querySelector("code");
        const langClass = codeEl?.getAttribute("class") || "";
        const rawLang = (langClass.match(/lang(?:uage)?-([a-z0-9_+-]+)/i) || [])[1] || "plain text";
        const code = (codeEl ? codeEl.textContent : el.textContent) || "";
        const richTextArray = DOMToNotion.splitLongText(code);
        blocks.push({
            type: "code",
            code: { rich_text: richTextArray, language: normalizeLanguage(rawLang) },
        });
    },

    // 引用 blockquote
    _cookBlockquote: (el, blocks) => {
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: "quote", quote: { rich_text: richText } });
        }
    },

    // 标题 h1-h6（h4-h6 降级为 h3）
    _cookHeading: (el, blocks) => {
        const tag = el.tagName.toLowerCase();
        let level = parseInt(tag.substring(1));
        if (level > 3) level = 3;
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: `heading_${level}`, [`heading_${level}`]: { rich_text: richText } });
        }
    },

    // 列表 ul/ol
    _cookList: (el, blocks) => {
        const tag = el.tagName.toLowerCase();
        const listType = tag === "ul" ? "bulleted_list_item" : "numbered_list_item";
        Array.from(el.children).forEach((li) => {
            if (li.tagName.toLowerCase() === "li") {
                const richText = DOMToNotion.serializeRichText(li);
                if (richText.length > 0) {
                    blocks.push({ type: listType, [listType]: { rich_text: richText } });
                }
            }
        });
    },

    // 表格 table / .md-table
    _cookTable: (el, blocks) => {
        const tag = el.tagName.toLowerCase();
        const table = tag === "table" ? el : el.querySelector("table");
        if (!table) return;

        const rows = [];
        let hasHeader = false;

        const thead = table.querySelector("thead");
        if (thead) {
            hasHeader = true;
            thead.querySelectorAll("tr").forEach((tr) => {
                const cells = [];
                tr.querySelectorAll("th, td").forEach((cell) => {
                    const richText = DOMToNotion.serializeRichText(cell);
                    cells.push(richText.length > 0 ? richText : [{ type: "text", text: { content: "" } }]);
                });
                if (cells.length > 0) rows.push(cells);
            });
        }

        const tbody = table.querySelector("tbody") || table;
        tbody.querySelectorAll("tr").forEach((tr) => {
            if (tr.closest("thead")) return;
            const cells = [];
            tr.querySelectorAll("td, th").forEach((cell) => {
                const richText = DOMToNotion.serializeRichText(cell);
                cells.push(richText.length > 0 ? richText : [{ type: "text", text: { content: "" } }]);
            });
            if (cells.length > 0) rows.push(cells);
        });

        if (rows.length > 0) {
            const tableWidth = Math.max(1, ...rows.map(r => r.length));
            blocks.push({
                type: "table",
                table: {
                    table_width: tableWidth,
                    has_column_header: hasHeader,
                    has_row_header: false,
                    children: rows.map(cells => ({
                        type: "table_row",
                        table_row: { cells }
                    }))
                }
            });
        }
    },

    // 独立图片 img
    _cookImage: (el, blocks, imgMode) => {
        const src = el.getAttribute("src") || "";
        const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
        if (full && !src.includes("/images/emoji/")) {
            if (imgMode !== "skip") {
                blocks.push({
                    type: "image",
                    image: { type: "external", external: { url: full } },
                    _needsUpload: imgMode === "upload",
                    _originalUrl: full,
                    _fileType: "image",
                });
            }
        }
    },

    // ===== 通用文本切分与序列化 =====

    splitLongText: (text, annotations = {}) => {
        const maxLength = 2000;
        const maxItems = 100; // Notion API 限制
        const chunks = [];
        if (text.length <= maxLength) {
            chunks.push({ type: "text", text: { content: text }, annotations: { ...annotations } });
        } else {
            let remaining = text;
            while (remaining.length > 0 && chunks.length < maxItems) {
                const chunk = remaining.substring(0, maxLength);
                chunks.push({ type: "text", text: { content: chunk }, annotations: { ...annotations } });
                remaining = remaining.substring(maxLength);
            }
        }
        return chunks;
    },

    serializeRichText: (node) => {
        const result = [];

        const processNode = (n, annotations = {}) => {
            if (!n) return;

            if (n.nodeType === Node.TEXT_NODE) {
                const text = n.nodeValue || "";
                if (text) result.push(...DOMToNotion.splitLongText(text, annotations));
                return;
            }

            if (n.nodeType !== Node.ELEMENT_NODE) return;

            const el = n;
            const tag = el.tagName.toLowerCase();

            // 处理 emoji 图片
            if (tag === "img") {
                const src = el.getAttribute("src") || "";
                const emojiMatch = src.match(/\/images\/emoji\/(?:twemoji|apple|google|twitter)\/([^/.]+)\.png/i);
                if (emojiMatch) {
                    const emojiName = emojiMatch[1];
                    const emoji = EMOJI_MAP[emojiName] || el.getAttribute("alt") || `:${emojiName}:`;
                    if (emoji) result.push({ type: "text", text: { content: emoji }, annotations: { ...annotations } });
                }
                return;
            }

            // 处理链接
            if (tag === "a") {
                const href = el.getAttribute("href") || "";
                if (href.startsWith("#")) {
                    Array.from(el.childNodes).forEach((c) => processNode(c, annotations));
                    return;
                }
                const link = Utils.absoluteUrl(href);
                const linkText = el.textContent || link;
                if (link && linkText) {
                    const chunks = DOMToNotion.splitLongText(linkText, annotations);
                    chunks.forEach(chunk => { chunk.text.link = { url: link }; });
                    result.push(...chunks);
                }
                return;
            }

            // 处理格式标签
            if (tag === "strong" || tag === "b") {
                Array.from(el.childNodes).forEach((c) => processNode(c, { ...annotations, bold: true }));
                return;
            }
            if (tag === "em" || tag === "i") {
                Array.from(el.childNodes).forEach((c) => processNode(c, { ...annotations, italic: true }));
                return;
            }
            if (tag === "s" || tag === "del") {
                Array.from(el.childNodes).forEach((c) => processNode(c, { ...annotations, strikethrough: true }));
                return;
            }
            if (tag === "code") {
                const text = el.textContent || "";
                if (text) result.push(...DOMToNotion.splitLongText(text, { ...annotations, code: true }));
                return;
            }

            // 其他元素递归处理
            Array.from(el.childNodes).forEach((c) => processNode(c, annotations));
        };

        processNode(node);
        // Notion API 限制 rich_text 数组最多 100 个元素
        return result.slice(0, 100);
    },

    cookedToBlocks: (cookedHtml, imgMode = "upload") => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(cookedHtml || "", "text/html");
        const root = doc.body;
        const blocks = [];

        const processElement = (el) => {
            if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

            const tag = el.tagName.toLowerCase();

            // 跳过元信息容器
            if (el.classList && el.classList.contains('meta')) return;

            // 处理图片容器
            if (el.classList && (el.classList.contains('lightbox-wrapper') || el.classList.contains('image-wrapper'))) {
                DOMToNotion._cookLightbox(el, blocks, imgMode);
                return;
            }

            // 处理附件链接 (<a class="attachment">)
            if (tag === "a" && el.classList && el.classList.contains("attachment")) {
                DOMToNotion._cookAttachment(el, blocks, imgMode);
                return;
            }

            // 处理视频元素
            if (tag === "video") {
                DOMToNotion._cookVideo(el, blocks, imgMode);
                return;
            }

            // 处理音频元素
            if (tag === "audio") {
                DOMToNotion._cookAudio(el, blocks, imgMode);
                return;
            }

            // 处理 iframe 嵌入（视频/外部内容），未匹配则 fallthrough
            if (tag === "iframe" && DOMToNotion._cookIframe(el, blocks)) return;

            // 处理引用块
            if (tag === "aside" && el.classList.contains("quote")) {
                DOMToNotion._cookAsideQuote(el, blocks);
                return;
            }

            // 处理段落
            if (tag === "p") {
                DOMToNotion._cookParagraph(el, blocks, imgMode);
                return;
            }

            // 处理代码块
            if (tag === "pre") {
                DOMToNotion._cookCode(el, blocks);
                return;
            }

            // 处理引用
            if (tag === "blockquote") {
                DOMToNotion._cookBlockquote(el, blocks);
                return;
            }

            // 处理标题 (h1-h6, h4-h6 降级为 h3)
            if (/^h[1-6]$/.test(tag)) {
                DOMToNotion._cookHeading(el, blocks);
                return;
            }

            // 处理列表
            if (tag === "ul" || tag === "ol") {
                DOMToNotion._cookList(el, blocks);
                return;
            }

            // 处理表格
            if (tag === "table" || (el.classList && el.classList.contains('md-table'))) {
                DOMToNotion._cookTable(el, blocks);
                return;
            }

            // 处理独立图片
            if (tag === "img") {
                DOMToNotion._cookImage(el, blocks, imgMode);
                return;
            }

            // 递归处理子元素
            Array.from(el.children).forEach(processElement);
        };

        Array.from(root.children).forEach(processElement);
        return blocks;
    },
};

module.exports = { DOMToNotion };
