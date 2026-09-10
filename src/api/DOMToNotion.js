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
                    // P4 共识(glm+qwen): fileName 未切分, 超 2000 字符触发 Notion 400(整批失败)
                    caption: DOMToNotion.splitLongText(fileName),
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
            } else if (DOMToNotion._isAllowedEmbedHost(full)) {
                blocks.push({
                    type: "embed",
                    embed: { url: full },
                });
            } else {
                // P4 共识(dsf): 非白名单宿主的 embed.url 会绕过 _cookIframe 的 SSRF 收窄
                // (embed.url 由 Notion 服务端抓取), 降级为 video external(客户端播放)
                blocks.push({
                    type: "video",
                    video: { type: "external", external: { url: full } },
                    _needsUpload: imgMode === "upload",
                    _originalUrl: full,
                    _fileType: "video",
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
    // v3.14.6 (XN-04) 抽出的共享白名单: embed.url 由 Notion 服务端抓取(CWE-918),
    // 仅显式视频宿主可写入(_cookIframe / _cookVideo 双消费点保持一致)
    _isAllowedEmbedHost: (url) => {
        let host = "";
        try { host = new URL(url).hostname; } catch { return false; }
        return host === "youtube.com" || host.endsWith(".youtube.com") ||
            host === "youtu.be" || host.endsWith(".youtu.be") ||
            host === "vimeo.com" || host.endsWith(".vimeo.com") ||
            host === "bilibili.com" || host.endsWith(".bilibili.com");
    },

    _cookIframe: (el, blocks) => {
        const src = el.getAttribute("src") || "";
        if (!src) return false;
        // 子串匹配（src.includes）可被 evil.com/youtube.com 或 169.254.169.254/player.html 绕过
        // 写入 Notion embed.url（服务端抓取触发 SSRF，CWE-918，ISS-009 sibling 补全）。
        // 改 hostname 严格白名单 + _safeExternalUrl 校验（拒内网/169.254/非 http(s)）。
        const absoluteSrc = Utils.absoluteUrl(src);
        // v3.14.6 (XN-04): player. 子串兜底移除 —— 任意公网域 player.evil.com 可被放行写入
        // embed.url(服务端抓取 SSRF); 仅显式视频宿主白名单 + _safeExternalUrl 双保险
        if (DOMToNotion._isAllowedEmbedHost(absoluteSrc)) {
            const full = DOMToNotion._safeExternalUrl(absoluteSrc);
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
                        caption: DOMToNotion.splitLongText(fileName),
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
    _cookList: (el, blocks, imgMode) => {
        const tag = el.tagName.toLowerCase();
        const listType = tag === "ul" ? "bulleted_list_item" : "numbered_list_item";
        Array.from(el.children).forEach((li) => {
            if (li.tagName.toLowerCase() === "li") {
                const richText = DOMToNotion.serializeRichText(li);
                if (richText.length > 0) {
                    blocks.push({ type: listType, [listType]: { rich_text: richText } });
                }
                // P4 收敛(c05): li 内嵌图片/附件此前静默丢弃 —— 与 _cookParagraph 同款补发块
                li.querySelectorAll("img").forEach((img) => DOMToNotion._cookImage(img, blocks, imgMode));
                li.querySelectorAll("a.attachment").forEach((a) => DOMToNotion._cookAttachment(a, blocks, imgMode));
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
            // P4 3/3 共识(dsf+glm+qwen): Notion 要求每个 table_row.cells 长度等于 table_width,
            // 短行(空单元格/colspan)未补齐会被 400 拒绝并整批上传失败
            const paddedRows = rows.map((cells) => cells.length >= tableWidth
                ? cells
                : cells.concat(Array.from({ length: tableWidth - cells.length },
                    () => [{ type: "text", text: { content: "" } }])));
            blocks.push({
                type: "table",
                table: {
                    table_width: tableWidth,
                    has_column_header: hasHeader,
                    has_row_header: false,
                    children: paddedRows.map(cells => ({
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
                // P4 收敛(c05): 按 UTF-16 码元硬切会拆散代理对(emoji) → 孤立代理对触发 Notion 400/乱码
                let cut = maxLength;
                if (cut < remaining.length) {
                    const code = remaining.charCodeAt(cut - 1);
                    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
                }
                const chunk = remaining.substring(0, cut);
                chunks.push({ type: "text", text: { content: chunk }, annotations: { ...annotations } });
                remaining = remaining.substring(cut);
            }
            // P4 共识(glm+qwen): 达 100 项上限后剩余文本此前静默丢弃——末块尾插入截断标记,
            // 保留用户可见状态(项目约定: 不静默丢弃)
            if (remaining.length > 0 && chunks.length > 0) {
                const marker = `…（内容过长，已截断 ${remaining.length} 字符）`;
                const last = chunks[chunks.length - 1];
                last.text.content = last.text.content.slice(0, Math.max(0, maxLength - marker.length)) + marker;
                console.warn(`[LD-Notion] rich_text 达 ${maxItems} 项上限, 已截断 ${remaining.length} 字符`);
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
                    const emoji = Object.prototype.hasOwnProperty.call(EMOJI_MAP, emojiName)
                        ? EMOJI_MAP[emojiName]
                        : (el.getAttribute("alt") || `:${emojiName}:`);
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
                // v3.14.6 (XN-04): 文本链接过 _safeExternalUrl —— 非法(内网/169.254/非 http(s))降级纯文本
                const safeLink = DOMToNotion._safeExternalUrl(link);
                if (link && linkText) {
                    const chunks = DOMToNotion.splitLongText(linkText, annotations);
                    if (safeLink) {
                        chunks.forEach(chunk => { chunk.text.link = { url: safeLink }; });
                    }
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
        // P4 共识(dsf): 超限此前静默 slice, 补告警(内联节点数异常时用户可见)
        if (result.length > 100) {
            console.warn(`[LD-Notion] rich_text 节点数 ${result.length} 超 Notion 上限 100, 已截断`);
            return result.slice(0, 100);
        }
        return result;
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
                DOMToNotion._cookList(el, blocks, imgMode);
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
