"use strict";

const { isSupportedFileType } = require("../config");
const { Utils } = require("../utils");
const { UrlValidator } = require("../security/UrlValidator");
const { normalizeLanguage, EMOJI_MAP } = require("./constants");
const { DomSpec } = require("./DomSpec");

// P4 收敛(c05): 上界处若落在代理对中间(emoji 前半), 回退一个码元 —— 切出孤立代理字符
// 会被 Notion 拒绝(400)或渲染为乱码。软切/截断标记两处共用同一口径。
const safeCutIndex = (text, index) => {
    const cut = Math.max(0, Math.min(index, text.length));
    if (cut > 0 && cut < text.length) {
        const code = text.charCodeAt(cut - 1);
        if (code >= 0xd800 && code <= 0xdbff) return cut - 1;
    }
    return cut;
};

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
        if (full && !DOMToNotion._emojiImageName(src)) {
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
            // wave8 共识(qwen): 先剥查询串/锚点再取扩展名 —— "a.exe?y=.mp4"/"a.mp4#y.exe"
            // 否则扩展名可被查询串或锚点伪造, 误选 video/embed 块类型
            const ext = ((full.split("#")[0] || "").split("?")[0].split(".").pop() || "").toLowerCase();
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
    _cookAsideQuote: (el, blocks, imgMode) => {
        const blockquote = el.querySelector("blockquote");
        if (blockquote) {
            const richText = DOMToNotion.serializeRichText(blockquote);
            if (richText.length > 0) {
                blocks.push({ type: "quote", quote: { rich_text: richText } });
            }
            // wave8 共识(dsf): 引用内嵌媒体此前静默丢弃 —— 与段落/li 同款补发块
            DOMToNotion._consumeInlineMedia(blockquote, blocks, imgMode);
        }
    },

    // 单一 emoji 判据驻 DomSpec(与块级跳过同源); 保留公开键名供现有测试与 legacy harness
    _emojiImageName: (src) => DomSpec.emojiNameOf(src),

    // wave8 共识(dsf): 段落/li/引用/表格单元格共用的内联媒体补发
    // 采集逻辑单一驻 DomSpec.eachMedia(自身+后代, 每节点恰一次); 此处保留公开键名转发
    _consumeInlineMedia: (el, blocks, imgMode) => {
        DomSpec.eachMedia(el, (node, kind) => {
            if (kind === "img") DOMToNotion._cookImage(node, blocks, imgMode);
            else if (kind === "attachment") DOMToNotion._cookAttachment(node, blocks, imgMode);
            else if (kind === "video") DOMToNotion._cookVideo(node, blocks, imgMode);
            else if (kind === "audio") DOMToNotion._cookAudio(node, blocks, imgMode);
            else if (kind === "iframe") DOMToNotion._cookIframe(node, blocks);
        });
    },

    // 段落 p（含内部图片与附件）
    _cookParagraph: (el, blocks, imgMode) => {
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
        }
        el.querySelectorAll("img").forEach((img) => {
            const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
            const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
            if (full && !DOMToNotion._emojiImageName(src)) {
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
        // P4 收敛(c05a-glm): 段落内嵌 video/audio/iframe 无任何消费点 —— iframe/video 属短语
        // 内容, <p><iframe …></iframe></p> 是合法 HTML 且 DOMParser 原样保留; 段落分支提前
        // return 使这些块静默丢失(与上方 img/a.attachment 后处理同口径)
        el.querySelectorAll("video").forEach((video) => DOMToNotion._cookVideo(video, blocks, imgMode));
        el.querySelectorAll("audio").forEach((audio) => DOMToNotion._cookAudio(audio, blocks, imgMode));
        el.querySelectorAll("iframe").forEach((frame) => { DOMToNotion._cookIframe(frame, blocks); });
    },

    // 代码块 pre
    _cookCode: (el, blocks) => {
        const codeEl = el.querySelector("code");
        const langClass = codeEl?.getAttribute("class") || "";
        // P4 收敛(c05): 语言标识白名单化前先完整捕获 —— `#` 未入字符类时 `language-c#`
        // 被截为 "c", 命中 NOTION_LANGUAGES 的 c → C# 代码块按 C 语言写入
        const rawLang = (langClass.match(/lang(?:uage)?-([a-z0-9_+#-]+)/i) || [])[1] || "plain text";
        const code = (codeEl ? codeEl.textContent : el.textContent) || "";
        const richTextArray = DOMToNotion.splitLongText(code);
        blocks.push({
            type: "code",
            code: { rich_text: richTextArray, language: normalizeLanguage(rawLang) },
        });
    },

    // 引用 blockquote
    _cookBlockquote: (el, blocks, imgMode) => {
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: "quote", quote: { rich_text: richText } });
        }
        // wave8 共识(dsf): 引用内嵌媒体此前静默丢弃 —— 与段落/li 同款补发块
        DOMToNotion._consumeInlineMedia(el, blocks, imgMode);
    },

    // 标题 h1-h6（h4-h6 降级为 h3）
    _cookHeading: (el, blocks, imgMode) => {
        const tag = el.tagName.toLowerCase();
        let level = parseInt(tag.substring(1));
        if (level > 3) level = 3;
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: `heading_${level}`, [`heading_${level}`]: { rich_text: richText } });
        }
        // wave9 共识(dsf): 标题内联媒体此前静默丢弃 —— 与段落/引用/单元格同款补发块
        DOMToNotion._consumeInlineMedia(el, blocks, imgMode);
    },

    // 列表 ul/ol
    _cookList: (el, blocks, imgMode) => {
        const tag = el.tagName.toLowerCase();
        const listType = tag === "ul" ? "bulleted_list_item" : "numbered_list_item";
        Array.from(el.children).forEach((child) => {
            if (!child.tagName) return;
            const childTag = child.tagName.toLowerCase();
            // wave12 共识(dsf): 解析器允许 <ul>/<ol> 直接嵌套其他列表(<ul><ul><li>)——
            // 此前非 li 子元素整支跳过, 该支文本/媒体静默丢弃
            if (childTag === "ul" || childTag === "ol") {
                DOMToNotion._cookList(child, blocks, imgMode);
                return;
            }
            if (childTag !== "li") {
                const richText = DOMToNotion.serializeRichText(child);
                if (richText.length > 0) {
                    blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
                }
                DOMToNotion._consumeInlineMedia(child, blocks, imgMode);
                return;
            }
            const li = child;
            {
                const richText = DOMToNotion.serializeRichText(li);
                if (richText.length > 0) {
                    blocks.push({ type: listType, [listType]: { rich_text: richText } });
                }
                // P4 收敛(c05): li 内嵌图片/附件此前静默丢弃 —— 与 _cookParagraph 同款补发块
                li.querySelectorAll("img").forEach((img) => DOMToNotion._cookImage(img, blocks, imgMode));
                li.querySelectorAll("a.attachment").forEach((a) => DOMToNotion._cookAttachment(a, blocks, imgMode));
                // wave6 共识(dsf): 与 _cookParagraph 同口径 —— li 内嵌 video/audio/iframe 同样
                // 有消费点(ul/ol 分支提前 return, 不下钻到这些块)
                li.querySelectorAll("video").forEach((video) => DOMToNotion._cookVideo(video, blocks, imgMode));
                li.querySelectorAll("audio").forEach((audio) => DOMToNotion._cookAudio(audio, blocks, imgMode));
                li.querySelectorAll("iframe").forEach((frame) => { DOMToNotion._cookIframe(frame, blocks); });
            }
        });
    },

    // 表格 table / .md-table
    _cookTable: (el, blocks, imgMode) => {
        const tag = el.tagName.toLowerCase();
        const table = tag === "table" ? el : el.querySelector("table");
        if (!table) return;

        const rows = [];
        let hasHeader = false;

        // P4 收敛(c05): 表格行列只取直属子元素 —— 后代选择器会把单元格内嵌套表格的
        // tr/td 并入外层行(列宽污染/内容窜行); 与下方 tbody 分支同口径
        const directRows = (container) => Array.from(container.children || [])
            .filter((child) => child.tagName && child.tagName.toLowerCase() === "tr");
        const directCells = (row) => Array.from(row.children || [])
            .filter((child) => child.tagName && ["td", "th"].includes(child.tagName.toLowerCase()));
        // wave6 共识(qwen): thead/tbody 同样须取直属子元素 —— querySelector 会把单元格内
        // 嵌套表格的 thead/tbody 当外层表头/表体(hasHeader 误置 + 行内容窜入)
        const directSections = (tagNames) => Array.from(table.children || [])
            .filter((child) => child.tagName && tagNames.includes(child.tagName.toLowerCase()));
        const thead = directSections(["thead"])[0];
        if (thead) {
            hasHeader = true;
            directRows(thead).forEach((tr) => {
                const cells = [];
                directCells(tr).forEach((cell) => {
                    const richText = DOMToNotion.serializeRichText(cell);
                    cells.push(richText.length > 0 ? richText : [{ type: "text", text: { content: "" } }]);
                });
                if (cells.length > 0) rows.push(cells);
            });
        }

        // wave6 共识(qwen): 合法 HTML 可有多个 tbody, tfoot 行同样属于表格正文 ——
        // 原实现只取第一个 tbody 且从不读 tfoot, 其余行静默丢失
        const bodyContainers = directSections(["tbody", "tfoot"]);
        (bodyContainers.length > 0 ? bodyContainers : [table]).forEach((container) => {
            directRows(container).forEach((tr) => {
                if (tr.closest("thead")) return;
                const cells = [];
                directCells(tr).forEach((cell) => {
                    const richText = DOMToNotion.serializeRichText(cell);
                    cells.push(richText.length > 0 ? richText : [{ type: "text", text: { content: "" } }]);
                });
                if (cells.length > 0) rows.push(cells);
            });
        });

        // P4 收敛(c05a-glm): Notion table.children 上限 100 —— 超限整批 400, 该页导入全失败;
        // 与长文本同口径: 截断并留可见标记, 不静默丢弃
        const MAX_TABLE_ROWS = 100;
        if (rows.length > MAX_TABLE_ROWS) {
            const droppedRows = rows.length - (MAX_TABLE_ROWS - 1);
            rows.length = MAX_TABLE_ROWS - 1;
            rows.push([[{ type: "text", text: { content: `…（表格行数过多，已截断 ${droppedRows} 行）` } }]]);
            console.warn(`[LD-Notion] 表格行数超 ${MAX_TABLE_ROWS} 上限, 已截断 ${droppedRows} 行`);
        }

        // wave6 共识(qwen): Notion table_width 上限 100 —— 超宽整批 400; 超宽行截断到 100 列
        // 并在末列留可见标记(不静默丢弃)
        const MAX_TABLE_COLS = 100;
        if (rows.some((cells) => cells.length > MAX_TABLE_COLS)) {
            rows.forEach((cells) => {
                if (cells.length <= MAX_TABLE_COLS) return;
                // 末列留标记：实际丢弃 = length - (MAX-1)，保留 MAX-1 个原单元格
                const droppedCols = cells.length - (MAX_TABLE_COLS - 1);
                cells.length = MAX_TABLE_COLS - 1;
                cells.push([{ type: "text", text: { content: `…（列数过多，已截断 ${droppedCols} 列）` } }]);
            });
            console.warn(`[LD-Notion] 表格列数超 ${MAX_TABLE_COLS} 上限, 已截断`);
        }

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

        // wave8 共识(dsf): Notion table_row.cells 只收 rich_text, 单元格内媒体此前静默
        // 丢弃 —— 表格后补发兄弟块(与段落/li/引用补发块同口径)
        // wave9 共识(qwen): 无 section 时回退直属 tr(与 _convertTable 同口径),
        // 否则 <table><tr><td><img></td></tr></table> 的单元格媒体漏采
        const mediaSections = directSections(["thead", "tbody", "tfoot"]);
        const mediaRows = mediaSections.length > 0
            ? mediaSections.flatMap((sec) => directRows(sec))
            : directRows(table);
        const cellMedia = [];
        mediaRows.forEach((tr) => {
            directCells(tr).forEach((cell) => {
                cellMedia.push(...cell.querySelectorAll("img, video, audio, a.attachment, iframe"));
            });
        });
        cellMedia.forEach((m) => {
            const t = m.tagName ? m.tagName.toLowerCase() : "";
            if (t === "img") DOMToNotion._cookImage(m, blocks, imgMode);
            else if (t === "a") DOMToNotion._cookAttachment(m, blocks, imgMode);
            else if (t === "video") DOMToNotion._cookVideo(m, blocks, imgMode);
            else if (t === "audio") DOMToNotion._cookAudio(m, blocks, imgMode);
            else if (t === "iframe") DOMToNotion._cookIframe(m, blocks);
        });
    },

    // 独立图片 img
    _cookImage: (el, blocks, imgMode) => {
        // wave7 共识(qwen): 懒加载图片 src 为空时回退 data-src(与 _cookLightbox 同口径)
        const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
        const full = DOMToNotion._safeExternalUrl(Utils.absoluteUrl(src));
        if (full && !DOMToNotion._emojiImageName(src)) {
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
                const cut = safeCutIndex(remaining, maxLength);
                const chunk = remaining.substring(0, cut);
                chunks.push({ type: "text", text: { content: chunk }, annotations: { ...annotations } });
                remaining = remaining.substring(cut);
            }
            // P4 共识(glm+qwen): 达 100 项上限后剩余文本此前静默丢弃——末块尾插入截断标记,
            // 保留用户可见状态(项目约定: 不静默丢弃)
            if (remaining.length > 0 && chunks.length > 0) {
                const marker = `…（内容过长，已截断 ${remaining.length} 字符）`;
                const last = chunks[chunks.length - 1];
                // P4 收敛(c05): 截断点同样需避让代理对(与上方分块同口径)
                last.text.content = last.text.content.slice(0, safeCutIndex(last.text.content, maxLength - marker.length)) + marker;
                console.warn(`[LD-Notion] rich_text 达 ${maxItems} 项上限, 已截断 ${remaining.length} 字符`);
            }
        }
        return chunks;
    },

    serializeRichText: (node) => {
        const result = [];

        // wave14 共识(dsf/glm): 块级元素前后均为文本边界 —— 用"下次落库前需补分隔符"标记,
        // 由真正产出内容的那次调用消费(后续可能是裸文本, 不一定是 p/div); 延迟消费
        // 避免嵌套块(<blockquote><p>a</p><div><p>b</p></div></blockquote>)重复补空行
        let needBreak = false;
        const breakIfNeeded = (annotations) => {
            if (!needBreak) return;
            needBreak = false;
            if (result.length > 0) result.push(...DOMToNotion.splitLongText("\n", annotations));
        };

        const processNode = (n, annotations = {}) => {
            if (!n) return;

            if (n.nodeType === Node.TEXT_NODE) {
                const text = n.nodeValue || "";
                if (text) {
                    breakIfNeeded(annotations);
                    result.push(...DOMToNotion.splitLongText(text, annotations));
                }
                return;
            }

            if (n.nodeType !== Node.ELEMENT_NODE) return;

            const el = n;
            const tag = el.tagName.toLowerCase();

            // 处理 emoji 图片
            if (tag === "img") {
                // wave8 共识(qwen): 懒加载 emoji 仅在 data-src 时同样识别(与块级图片回退同口径)
                // wave12 共识(qwen): set 目录放宽到任意值(与 _emojiImageName 同口径, 后者决定块级跳过)
                const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
                const emojiName = DOMToNotion._emojiImageName(src);
                if (emojiName) {
                    const emoji = Object.prototype.hasOwnProperty.call(EMOJI_MAP, emojiName)
                        ? EMOJI_MAP[emojiName]
                        : (el.getAttribute("alt") || `:${emojiName}:`);
                    if (emoji) {
                        breakIfNeeded(annotations);
                        result.push(...DOMToNotion.splitLongText(emoji, annotations));
                    }
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
                // wave6 共识(dsf): 链接内非文本内容(如 <a><img class="emoji" alt="😀"></a>)
                // 让 textContent 为空 —— 回退裸 URL 会丢掉 emoji, 改优先取 emoji alt
                let linkText = el.textContent || "";
                if (!linkText) {
                    const innerImg = el.querySelector("img");
                    linkText = innerImg ? (innerImg.getAttribute("alt") || "") : "";
                }
                if (!linkText) linkText = link;
                // v3.14.6 (XN-04): 文本链接过 _safeExternalUrl —— 非法(内网/169.254/非 http(s))降级纯文本
                const safeLink = DOMToNotion._safeExternalUrl(link);
                if (link && linkText) {
                    breakIfNeeded(annotations);
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
                if (text) {
                    breakIfNeeded(annotations);
                    result.push(...DOMToNotion.splitLongText(text, { ...annotations, code: true }));
                }
                return;
            }

            // wave9 共识(dsf): Discourse 单次换行输出 <br>, 无分支时相邻文本节点直接拼接
            // ("line1line2" 词句粘连, 硬换行丢失) —— br 输出带换行的文本片段
            if (tag === "br") {
                // br 自身即分隔符: 清掉待补边界, 不叠加
                needBreak = false;
                result.push(...DOMToNotion.splitLongText("\n", annotations));
                return;
            }

            // wave13 共识(qwen): script/style/noscript 非渲染元素 —— 其文本(JS/CSS 源码)
            // 经通用递归进入 rich_text, 内容污染(与 obsidian 同口径)
            if (tag === "script" || tag === "style" || tag === "noscript") return;

            // wave12 共识(dsf) + wave14 共识(dsf): 块级元素是文本边界 —— 前后都不得与相邻
            // 内联内容粘连(<blockquote><p>a</p>b</blockquote> 此前输出 "ab"); 仅"下一项也是
            // p/div 时才补换行"不够, 裸文本同样需要边界
            if (tag === "p" || tag === "div") {
                // 块级元素前后都是边界(前面是内联文本或块级都算): 标记延迟到真正产出内容时消费
                if (result.length > 0) needBreak = true;
                const before = result.length;
                Array.from(el.childNodes).forEach((c) => processNode(c, annotations));
                if (result.length > before) needBreak = true;
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

            // wave14 共识(glm): <hr> 此前无烹饪分支, 分隔线静默丢弃
            if (tag === "hr") {
                blocks.push({ type: "divider", divider: {} });
                return;
            }

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
                DOMToNotion._cookAsideQuote(el, blocks, imgMode);
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
                DOMToNotion._cookBlockquote(el, blocks, imgMode);
                return;
            }

            // 处理标题 (h1-h6, h4-h6 降级为 h3)
            if (/^h[1-6]$/.test(tag)) {
                DOMToNotion._cookHeading(el, blocks, imgMode);
                return;
            }

            // 处理列表
            if (tag === "ul" || tag === "ol") {
                DOMToNotion._cookList(el, blocks, imgMode);
                return;
            }

            // 处理表格
            if (tag === "table" || (el.classList && el.classList.contains('md-table'))) {
                DOMToNotion._cookTable(el, blocks, imgMode);
                return;
            }

            // 处理独立图片
            if (tag === "img") {
                DOMToNotion._cookImage(el, blocks, imgMode);
                return;
            }

            // 递归处理子节点(未匹配容器的文本已由 walkNode 按序并入内联缓冲)
            Array.from(el.childNodes || []).forEach(walkNode);
        };

        // wave13/14 共识(dsf/qwen): 未匹配容器与顶层裸文本此前只递归子元素 —— 直属文本
        // 静默丢弃; 且"先提取直属文本成段再递归子元素"会打乱文档顺序
        // (<div>Hello <span>world</span> again</div> 变成 "Hello  again" + "world")。
        // 改为单次顺序遍历: 连续的文本/内联内容合并为同一段落, 遇已识别块级元素
        // 先落段落再走原路径; 容器元素透明下钻。
        let inlineBuf = "";
        const flushInline = () => {
            const text = inlineBuf.replace(/[ \t\r\n]+/g, " ").trim();
            if (text) {
                blocks.push({ type: "paragraph", paragraph: { rich_text: DOMToNotion.splitLongText(text) } });
            }
            inlineBuf = "";
        };
        const walkNode = (node) => {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                inlineBuf += node.nodeValue || "";
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (DomSpec.isBlockNode(node)) {
                flushInline();
                processElement(node);
                return;
            }
            Array.from(node.childNodes || []).forEach(walkNode);
        };

        Array.from(root.childNodes || []).forEach(walkNode);
        flushInline();
        return blocks;
    },
};

module.exports = { DOMToNotion };
