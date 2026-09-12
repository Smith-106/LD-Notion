"use strict";

const { isSupportedFileType } = require("../config");
const { Utils } = require("../utils");
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

    // 过滤导入页面（帖子 HTML）中的外部 URL：地址判据单一驻 DomSpec.safeUrl
    // (scheme 白名单 + 公网/内网校验(含 169.254 云元数据 SSRF 防御) + 2000 字符上限);
    // 与 src/ai/schema.js 的 AISchema.validatePageExternalUrl 同原语（ISS-20260723-009 CWE-94 sibling）。
    // wave18 共识(w2 glm): 与 DomSpec.safeUrl 合一 —— 此前只做公网/协议校验, 漏长度上限
    // (MAX_URL_LENGTH 2000), <iframe> 白名单宿主的超长 src 仍可写入 embed.url 触发整页 400
    _safeExternalUrl: (full) => DomSpec.safeUrl(full),

    // 图片容器 lightbox-wrapper / image-wrapper
    // wave22 共识(w22 qwen): 本路径不经 serializeRichText —— 图片一律走 _cookBlockImage
    // (含 alt → 标记的可见回退), 与顶层 img 及 <p> 内 img 同口径
    // wave24 共识(w24 qwen): 生产路径改由 processElement 按**文档序**逐直属子节点分派(见该处);
    // 本键保留为公开壳(既有测试/legacy harness 直接调用), 语义 = 容器内媒体统一采集, 零可见文本
    _cookLightbox: (el, blocks, imgMode) => {
        DOMToNotion._consumeInlineMedia(el, blocks, imgMode, true);
    },

    // 附件链接 a.attachment
    _cookAttachment: (el, blocks, imgMode) => {
        const href = el.getAttribute("href") || "";
        // wave21: textContent 在最小桩/测试替身上可能缺失 —— 回退 DomSpec.textWithBreaks(逐节点取文本)
        const fileName = (el.textContent || "").trim()
            || DomSpec.foldToSingleLine(DomSpec.textWithBreaks(el))
            || "attachment";
        const full = DomSpec.safeUrl(href);
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
            return;
        }
        // wave16 共识(dsf): 地址被拒(或 imgMode=skip)时连可见链接文本一起丢弃 —— 与
        // obsidian 出口(地址判据被拒时保留子文本, R15)不对称; 保留文本段落, 不静默丢弃
        // wave21 共识(w21 qwen): 本元素即 a.attachment, serializeRichText 现按去重契约跳过它
        // (内联不再产出重复链接) —— 故此处直接以可见文本(fileName)落段落
        const richText = DOMToNotion.splitLongText(fileName);
        if (richText.length > 0) blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
    },

    // 视频元素
    _cookVideo: (el, blocks, imgMode) => {
        // P3 收敛 + R15: 地址判据单一驻 DomSpec.mediaUrl(回退 → 补齐 → 公网校验)
        const full = DomSpec.mediaUrl(el);
        // wave17 共识(dsf/glm/qwen): 地址被判拒时此前零产出 —— 与 Markdown 出口的可见标记
        // ([视频已拒…])及「fallback 保留用户可见状态」约定不一致; imgMode=skip 属用户显式设置,
        // 仍保持静默(与图片/音频同口径)
        if (!full) {
            if (imgMode !== "skip" && DomSpec.mediaSrc(el)) {
                blocks.push({
                    type: "paragraph",
                    paragraph: { rich_text: DOMToNotion.splitLongText("[视频已拒（非公网 http(s) 地址）]") },
                });
            }
            return;
        }
        if (imgMode !== "skip") {
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
        // P3 收敛 + R15: 地址判据单一驻 DomSpec.mediaUrl(与视频/图片同口径)
        const full = DomSpec.mediaUrl(el);
        // wave17 共识(dsf/glm/qwen): 与 _cookVideo 同款可见回退(地址被拒不静默丢弃)
        if (!full) {
            if (imgMode !== "skip" && DomSpec.mediaSrc(el)) {
                blocks.push({
                    type: "paragraph",
                    paragraph: { rich_text: DOMToNotion.splitLongText("[音频已拒（非公网 http(s) 地址）]") },
                });
            }
            return;
        }
        if (imgMode !== "skip") {
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

    _cookIframe: (el, blocks, imgMode) => {
        // wave17 共识(glm): 原实现只取原始 src(无 data-src 回退) —— 懒加载 iframe 在 Notion 侧零产出。
        // 地址回退口径统一走 DomSpec.mediaSrc; SSRF 面不变: 两条分支最终都经 _isAllowedEmbedHost
        // (hostname 严格白名单) + _safeExternalUrl(拒内网/169.254/非 http(s))。
        // wave17 共识(dsf): imgMode=skip 时同其它媒体静默跳过(原先 iframe 绕过用户设置写 embed)
        const src = DomSpec.mediaSrc(el);
        // wave22 共识(w22 dsf + w22 qwen): iframe 的浏览器降级文案不得经 processElement 兜底
        // 落成段落 —— 由调用方在 _cookIframe 返回 false 时终止该元素的子树遍历(见 processElement),
        // 返回值语义("已处理/未匹配")保持为既有契约
        if (!src || imgMode === "skip") return false;
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
        // wave17 共识(dsf/glm/qwen): 非白名单宿主(或地址被拒)时此前恒零产出且调用点无兜底 ——
        // 公网地址降级为**链接文本**(客户端点击, 不经 Notion 服务端抓取), 非法/内网地址留可见标记。
        // 与 Markdown 出口(obsidian.js iframe 分支产出 [嵌入内容](url) / 拒标记)同口径。
        const linkable = DomSpec.safeUrl(src);
        if (linkable) {
            blocks.push({
                type: "paragraph",
                paragraph: { rich_text: [{ type: "text", text: { content: "嵌入内容", link: { url: linkable } } }] },
            });
            return true;
        }
        blocks.push({
            type: "paragraph",
            paragraph: { rich_text: DOMToNotion.splitLongText("[嵌入内容已拒（非公网 http(s) 地址）]") },
        });
        return true;
    },

    // 引用块 aside.quote
    _cookAsideQuote: (el, blocks, imgMode) => {
        // wave15(dsf): 无内层 blockquote 的引用容器(<aside class="quote">text</aside>)
        // 整支静默丢弃 —— 无 blockquote 时以 aside 自身为引用源。
        // wave16 共识(dsf): 容器内有多个 blockquote 时只取首个(其余引用与内嵌媒体静默
        // 丢弃) —— 逐块产出; 单块路径与 _cookBlockquote 完全同构, 故直接委托(口径单一)
        const quotes = Array.from(el.children || [])
            .filter((child) => child.tagName && String(child.tagName).toLowerCase() === "blockquote");
        // wave17/wave18/wave22/wave23: 逐直属子节点分派(引用块 / 其余内容段落 + 内联媒体);
        // 「子树内含引用源」的子节点按同口径再下钻一层 —— 否则该项目身内部的其余内容(与引用源
        // 同级的说明文字/后记/内嵌媒体)只出引用块、其余静默丢弃(wave23 共识 w23 dsf)
        const dispatchAsideChild = (child) => {
            if (!child) return;
            // wave18 共识(dsf): 裸文本子节点不得丢弃
            // (<aside class="quote">署名文本<blockquote>引用</blockquote></aside>)
            if (child.nodeType === Node.TEXT_NODE) {
                const text = String(child.nodeValue || "").replace(/[ \t\r\n]+/g, " ").trim();
                if (text) {
                    blocks.push({ type: "paragraph", paragraph: { rich_text: DOMToNotion.splitLongText(text) } });
                }
                return;
            }
            if (child.nodeType !== Node.ELEMENT_NODE || !child.tagName) return;
            if (String(child.tagName).toLowerCase() === "blockquote") {
                DOMToNotion._cookBlockquote(child, blocks, imgMode);
                return;
            }
            const inner = typeof child.querySelector === "function" ? child.querySelector("blockquote") : null;
            if (inner) {
                DomSpec.eachChildOrdered(child, dispatchAsideChild);
                return;
            }
            const richText = DOMToNotion.serializeRichText(child);
            if (richText.length > 0) {
                blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
            }
            DOMToNotion._consumeInlineMedia(child, blocks, imgMode);
        };
        if (quotes.length > 0) {
            DomSpec.eachChildOrdered(el, dispatchAsideChild);
            return;
        }
        // 无直属 blockquote 时回退后代首个(与 wave15 同口径); 无任何 blockquote 时以 aside 自身为源
        const deep = typeof el.querySelector === "function" ? el.querySelector("blockquote") : null;
        // wave22 共识(w22 dsf + w22 qwen): 该回退此前只消费后代首个 blockquote —— aside 内其余
        // 直属内容(Discourse 引用自带的署名行 <div class="title">张三</div>、裸文本、内嵌媒体)
        // 整支静默丢弃, 与上方直属分支(逐子节点分派)及 Markdown 出口口径不一致。
        // 改为: 逐直属子节点分派 —— 命中引用源的子树走引用块, 其余走段落 + 内联媒体
        if (deep) {
            DomSpec.eachChildOrdered(el, dispatchAsideChild);
            return;
        }
        DOMToNotion._cookBlockquote(el, blocks, imgMode);
    },

    // 单一 emoji 判据驻 DomSpec(与块级跳过同源); 保留公开键名供现有测试与 legacy harness
    _emojiImageName: (src) => DomSpec.emojiNameOf(src),

    // wave8 共识(dsf): 段落/li/引用/表格单元格共用的内联媒体补发
    // 采集逻辑单一驻 DomSpec.eachMedia(自身+后代, 每节点恰一次); 此处保留公开键名转发
    _consumeInlineMedia: (el, blocks, imgMode, blockImages = false) => {
        DomSpec.eachMedia(el, (node, kind) => {
            // wave22 共识(w22 qwen): 不经 serializeRichText 的采集路径(lightbox/image-wrapper 容器)
            // 用 _cookImage 时地址被判拒/为 emoji 会零产出 —— 该路径改走 _cookBlockImage(含可见回退)
            if (kind === "img") {
                if (blockImages) DOMToNotion._cookBlockImage(node, blocks, imgMode);
                else DOMToNotion._cookImage(node, blocks, imgMode);
            }
            else if (kind === "attachment") DOMToNotion._cookAttachment(node, blocks, imgMode);
            else if (kind === "video") DOMToNotion._cookVideo(node, blocks, imgMode);
            else if (kind === "audio") DOMToNotion._cookAudio(node, blocks, imgMode);
            else if (kind === "iframe") DOMToNotion._cookIframe(node, blocks, imgMode);
        });
    },

    // 段落 p（含内部图片与附件）
    _cookParagraph: (el, blocks, imgMode) => {
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
        }
        // P4 收敛(c05a-glm) + wave6 共识(dsf): 段落内嵌 img/a.attachment/video/audio/iframe
        // 此前逐类各自实现(段落分支提前 return, 不补发即静默丢失) —— 统一走
        // _consumeInlineMedia, 采集口径单一驻 DomSpec.eachMedia
        DOMToNotion._consumeInlineMedia(el, blocks, imgMode);
    },

    // 代码块 pre
    _cookCode: (el, blocks, imgMode) => {
        const codeEl = el.querySelector("code");
        const langClass = codeEl?.getAttribute("class") || "";
        // P4 收敛(c05): 语言标识白名单化前先完整捕获 —— `#` 未入字符类时 `language-c#`
        // 被截为 "c", 命中 NOTION_LANGUAGES 的 c → C# 代码块按 C 语言写入
        const rawLang = (langClass.match(/lang(?:uage)?-([a-z0-9_+#-]+)/i) || [])[1] || "plain text";
        // wave16 共识(dsf+qwen): textContent 下 <br> 不产生换行 —— <pre><code>a<br>b</code></pre>
        // 导出为 "ab"(代码行粘连); 统一走 DomSpec.textWithBreaks(<br> → \n)
        // wave17 共识(dsf/glm): 原实现只取 <code> 子树 —— <pre>foo<code>bar</code>baz</pre> 的
        // 非 code 文本静默丢弃(Markdown 出口 wave14 已改为整棵 pre, 两面不对称) → 统一取整个 pre
        const code = DomSpec.textWithBreaks(el);
        // wave22 裁决(w22 dsf 提出「空 pre 不应落空 code 块」): 驳回 —— code 块的**存在**是源文档的
        // 结构事实(<pre></pre> 在 Markdown 出口同样产出空围栏, 两出口对称), 且空 content 片段在本
        // 模块内本就使用(表格空单元格补齐), 不构成「静默丢弃」或结构错误
        const richTextArray = DOMToNotion.splitLongText(code);
        blocks.push({
            type: "code",
            code: { rich_text: richTextArray, language: normalizeLanguage(rawLang) },
        });
        // wave18 共识(dsf): <pre> 内媒体此前静默丢弃 —— 与 _cookParagraph/_cookHeading/
        // _cookBlockquote/_cookTable 的既有补发口径不一致; 统一走 _consumeInlineMedia
        DOMToNotion._consumeInlineMedia(el, blocks, imgMode);
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
        // wave22 裁决: qwen 提出「标题/单元格应折叠换行」—— 该差异为本文件已登记并有契约测试的
        // 口径(Notion 侧 rich_text 允许承载 \n, Markdown 侧折叠), 且 wave21 的 td/th 边界未引入
        // 新的暴露类别(<br> 早已可达) ⇒ 驳回, 保持既有口径
        const richText = DOMToNotion.serializeRichText(el);
        if (richText.length > 0) {
            blocks.push({ type: `heading_${level}`, [`heading_${level}`]: { rich_text: richText } });
        }
        // wave9 共识(dsf): 标题内联媒体此前静默丢弃 —— 与段落/引用/单元格同款补发块
        DOMToNotion._consumeInlineMedia(el, blocks, imgMode);
    },

    // 列表 ul/ol
    // skipMedia: 由 li 内嵌套列表的分派方置 true —— 媒体已由外层 _consumeInlineMedia(li) 统一采集,
    // 嵌套分派不得重复消费(wave17 共识: 否则同一图片落两个块)
    _cookList: (el, blocks, imgMode, skipMedia = false) => {
        const tag = el.tagName.toLowerCase();
        const listType = tag === "ul" ? "bulleted_list_item" : "numbered_list_item";
        // wave15(dsf): el.children 只含元素 —— <ul>text<li> 的直属文本静默丢弃(obsidian 侧
        // ol/ul 分支已在 wave14 按 childNodes 渲染)。改按 childNodes 顺序: 纯空白(缩进排版)
        // 不产块, 其余文本按段落落块; 元素分支语义不变
        DomSpec.eachChildOrdered(el, (child) => {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = String(child.nodeValue || "").replace(/[ \t\r\n]+/g, " ").trim();
                if (text) {
                    blocks.push({ type: "paragraph", paragraph: { rich_text: DOMToNotion.splitLongText(text) } });
                }
                return;
            }
            if (!child.tagName) return;
            const childTag = child.tagName.toLowerCase();
            // wave12 共识(dsf): 解析器允许 <ul>/<ol> 直接嵌套其他列表(<ul><ul><li>)——
            // 此前非 li 子元素整支跳过, 该支文本/媒体静默丢弃
            if (childTag === "ul" || childTag === "ol") {
                DOMToNotion._cookList(child, blocks, imgMode, skipMedia);
                return;
            }
            if (childTag !== "li") {
                const richText = DOMToNotion.serializeRichText(child);
                if (richText.length > 0) {
                    blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
                }
                if (!skipMedia) DOMToNotion._consumeInlineMedia(child, blocks, imgMode);
                return;
            }
            const li = child;
            {
                // wave17 共识(glm/qwen): li 内含嵌套 ul/ol 时原实现把它并入父项 rich_text
                // (<li>a<ul><li>b</li></ul></li> → "ab" 粘连, 层级信息丢失)。现按 childNodes 分派:
                // 嵌套列表交给 _cookList 产出同级列表项(与容器级嵌套列表同口径), serializeRichText
                // 以 skipNestedLists 跳过该子树避免重复落块; 媒体仍由外层一次采集(skipMedia=true)。
                const richText = DOMToNotion.serializeRichText(li, { skipNestedLists: true });
                if (richText.length > 0) {
                    blocks.push({ type: listType, [listType]: { rich_text: richText } });
                }
                DomSpec.eachChildOrdered(li, (inner) => {
                    if (inner.nodeType !== Node.ELEMENT_NODE || !inner.tagName) return;
                    const innerTag = String(inner.tagName).toLowerCase();
                    if (innerTag === "ul" || innerTag === "ol") {
                        DOMToNotion._cookList(inner, blocks, imgMode, true);
                    }
                });
                // P4 收敛(c05) + wave6 共识(dsf): li 内嵌媒体统一走 _consumeInlineMedia,
                // 采集口径单一驻 DomSpec.eachMedia
                if (!skipMedia) DOMToNotion._consumeInlineMedia(li, blocks, imgMode);
            }
        });
    },

    // 表格 table(容器 .md-table 的分派在 processElement —— 与容器外同一条分派表)
    _cookTable: (el, blocks, imgMode) => {
        const tag = el.tagName.toLowerCase();
        // wave18 共识(dsf + qwen + w2 glm): 容器(.md-table)分派已上移至 processElement,
        // 容器内非表格内容改走同一条透明下钻路径(walkNode)
        if (tag !== "table") return;
        const table = el;

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
        // wave15(dsf): 空 thead 也置 hasHeader → 正文首行被误标为列标题(数据行降级为表头)
        if (thead && directRows(thead).length > 0) {
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
        // wave16 共识(qwen): 空 <thead> 但数据首行全为 <th> 时同属表头 —— wave15 的修复
        // (空 thead 不置表头)只覆盖"有 thead 行"的情形, 此处按首行单元格标签补齐判据
        let firstBodyRow = true;
        (bodyContainers.length > 0 ? bodyContainers : [table]).forEach((container) => {
            directRows(container).forEach((tr) => {
                if (tr.closest("thead")) return;
                const rowCells = directCells(tr);
                if (firstBodyRow) {
                    firstBodyRow = false;
                    if (!hasHeader && rowCells.length > 0
                        && rowCells.every((cell) => String(cell.tagName).toLowerCase() === "th")) {
                        hasHeader = true;
                    }
                }
                const cells = [];
                rowCells.forEach((cell) => {
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

        // wave16 共识(glm): <caption> 既不在 thead/tbody/tfoot 也不属 tr —— 表格标题文字
        // 与内嵌媒体整支丢弃(与 wave6 已修的 tfoot 行同族); 以段落补发, 不静默丢弃
        const caption = directSections(["caption"])[0];
        if (caption) {
            const captionText = DOMToNotion.serializeRichText(caption);
            if (captionText.length > 0) {
                blocks.push({ type: "paragraph", paragraph: { rich_text: captionText } });
            }
            DOMToNotion._consumeInlineMedia(caption, blocks, imgMode);
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
        // wave8 共识(dsf) + wave9 共识(qwen): 单元格内媒体补发 —— 采集口径统一走
        // _consumeInlineMedia(DomSpec.eachMedia), 不再自带逗号选择器与 tag 二次分派
        mediaRows.forEach((tr) => {
            directCells(tr).forEach((cell) => {
                DOMToNotion._consumeInlineMedia(cell, blocks, imgMode);
            });
        });
    },

    // 独立图片 img
    _cookImage: (el, blocks, imgMode) => {
        // wave7 共识(qwen) → P3 收敛: 图片地址判据统一走 DomSpec.mediaSrc
        // (src → data-src → <source src>), 与 lightbox/视频/音频/obsidian 同源
        const src = DomSpec.mediaSrc(el);
        const full = DomSpec.mediaUrl(el);
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

    // 块级(非内联)图片: 内联路径由 serializeRichText 处理 emoji 文本与 alt 回退; 块级路径此前对
    // emoji 图与地址被拒的图片**零产出**(wave17 共识 qwen), 此处补齐可见回退, 不静默丢弃。
    _cookBlockImage: (el, blocks, imgMode) => {
        const src = DomSpec.mediaSrc(el);
        const emojiName = DOMToNotion._emojiImageName(src);
        const full = DomSpec.mediaUrl(el);
        if (full && !emojiName) {
            DOMToNotion._cookImage(el, blocks, imgMode);
            return;
        }
        // wave19 共识(w19 glm): emoji 以**文本**承载(不下载/不上传) —— skip 语义只针对图片资源,
        // 原顺序(imgMode 判先于 emoji 分支)令块级路径在 imgMode=skip 时静默丢失 emoji,
        // 而同一 img 走 <p>/serializeRichText 的内联路径不受 imgMode 影响(两路径口径不一致)
        if (emojiName) {
            const emoji = Object.prototype.hasOwnProperty.call(EMOJI_MAP, emojiName)
                ? EMOJI_MAP[emojiName]
                : (el.getAttribute("alt") || `:${emojiName}:`);
            if (emoji) {
                blocks.push({ type: "paragraph", paragraph: { rich_text: DOMToNotion.splitLongText(emoji) } });
            }
            return;
        }
        // wave21 共识(w21 dsf): alt 是**文本载体**(与 emoji 同族) —— 原顺序把 imgMode 判在 alt
        // 之前, 顶层 <img alt=配图> 在 imgMode=skip 下零产出, 而同一 img 在 <p> 内经
        // serializeRichText 仍回退 alt(该函数无 imgMode) ⇒ 同文件两条路径口径不一致。
        // 与 Markdown 出口 case "img" 的无地址分支(alt 回退)同口径。
        const alt = typeof el.getAttribute === "function" ? (el.getAttribute("alt") || "") : "";
        if (alt) {
            blocks.push({ type: "paragraph", paragraph: { rich_text: DOMToNotion.splitLongText(alt) } });
            return;
        }
        if (imgMode === "skip") return;
        // 无任何候选地址时无可报告(不造占位噪声); 有地址但被判拒时留可见标记
        if (!src) return;
        blocks.push({
            type: "paragraph",
            paragraph: {
                rich_text: DOMToNotion.splitLongText("[图片已拒（非公网 http(s) 地址）]"),
            },
        });
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

    // options.skipNestedLists: 由 _cookList 的 li 分支传入 —— 嵌套 ul/ol 已分派给 _cookList 产出
    // 独立列表块, 本函数跳过该子树以免同一内容重复落块(wave17 共识 glm/qwen)
    serializeRichText: (node, options = {}) => {
        const skipNestedLists = options.skipNestedLists === true;
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
                // P3 收敛: emoji 图的地址判据同源 DomSpec.mediaSrc(src → data-src)
                const src = DomSpec.mediaSrc(el);
                const emojiName = DOMToNotion._emojiImageName(src);
                if (emojiName) {
                    const emoji = Object.prototype.hasOwnProperty.call(EMOJI_MAP, emojiName)
                        ? EMOJI_MAP[emojiName]
                        : (el.getAttribute("alt") || `:${emojiName}:`);
                    if (emoji) {
                        breakIfNeeded(annotations);
                        result.push(...DOMToNotion.splitLongText(emoji, annotations));
                    }
                    return;
                }
                // wave17 共识(glm/qwen): 地址被判拒/缺失时图片的可见替代文本(alt)此前随 _cookImage
                // 的不产块一起丢失(与 Markdown 出口 img 分支回退 alt 不对称, 违反「不静默丢弃」)。
                // 仅在 mediaUrl 判空时回退 alt; 正常图片仍只由媒体补发块承载, 不重复。
                if (!DomSpec.mediaUrl(el)) {
                    const alt = el.getAttribute("alt") || "";
                    if (alt) {
                        breakIfNeeded(annotations);
                        result.push(...DOMToNotion.splitLongText(alt, annotations));
                    }
                }
                return;
            }

            // 处理链接
            if (tag === "a") {
                // wave21 共识(w21 qwen): a.attachment 已由 _cookAttachment 落 file 块承载 ——
                // 内联路径再产一次带 link 的文本会把同一附件落两个块(段落链接 + file 块),
                // 而 img 分支的既有去重契约是「正常图片只由媒体补发块承载」
                if (el.classList && el.classList.contains("attachment")) return;
                const href = el.getAttribute("href") || "";
                if (href.startsWith("#")) {
                    DomSpec.eachChildOrdered(el, (c) => processNode(c, annotations));
                    return;
                }
                // R15: 地址判据统一走 DomSpec.safeUrl(非 http(s) scheme 不再被原点补齐成假链接)
                const link = DomSpec.safeUrl(href);
                // wave17 共识(glm): 原实现取 el.textContent 拍平 —— 链接内格式(<a><b>x</b></a>)与
                // 内嵌 emoji 的标注全部丢失(Notion rich_text 本可同时携带 link 与注解)。
                // 改为按子节点递归产出, 再把 link 合并到本次新增的每个片段上。
                breakIfNeeded(annotations);
                const before = result.length;
                DomSpec.eachChildOrdered(el, (c) => processNode(c, annotations));
                if (result.length === before) {
                    // wave6 共识(dsf): 链接内非文本内容(如 <a><img class="emoji" alt="😀"></a>)
                    // 让 textContent 为空 —— 回退裸 URL 会丢掉 emoji, 改优先取 emoji alt
                    const innerImg = el.querySelector("img");
                    let linkText = el.textContent || (innerImg ? (innerImg.getAttribute("alt") || "") : "");
                    if (!linkText) linkText = link;
                    if (linkText) {
                        result.push(...DOMToNotion.splitLongText(linkText, annotations));
                    }
                }
                // v3.14.6 (XN-04) + R15: link 为空串时文本仍照常落 rich_text(降级纯文本)
                if (link) {
                    for (let i = before; i < result.length; i++) {
                        const chunk = result[i];
                        if (chunk && chunk.text && !chunk.text.link) chunk.text.link = { url: link };
                    }
                }
                return;
            }

            // 处理格式标签
            if (tag === "strong" || tag === "b") {
                DomSpec.eachChildOrdered(el, (c) => processNode(c, { ...annotations, bold: true }));
                return;
            }
            if (tag === "em" || tag === "i") {
                DomSpec.eachChildOrdered(el, (c) => processNode(c, { ...annotations, italic: true }));
                return;
            }
            if (tag === "s" || tag === "del") {
                DomSpec.eachChildOrdered(el, (c) => processNode(c, { ...annotations, strikethrough: true }));
                return;
            }
            if (tag === "code") {
                // wave17 共识(dsf/qwen): 内联 code 原用 el.textContent —— <br> 不产生换行
                // (<p>见 <code>a<br>b</code></p> → "ab"), 与已修的 _cookCode/obsidian br 分支同族;
                // 统一走 DomSpec.textWithBreaks
                const text = DomSpec.textWithBreaks(el);
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
            if (DomSpec.isSkippedNode(n)) return;

            // wave21 共识(w21 qwen): 媒体元素的子树是**浏览器降级文案**(<video>您的浏览器
            // 不支持 video 标签</video>), 不是正文 —— Markdown 出口的 video/audio/iframe
            // 分支从不转换子树(只产 [视频](url) 等), 此处原样递归会把该文案并入段落
            // (媒体块另由 _consumeInlineMedia 补发承载) ⇒ 两出口内容不对称
            if (DomSpec.mediaKind(el)) return;

            // wave12 共识(dsf) + wave14 共识(dsf): 块级元素是文本边界 —— 前后都不得与相邻
            // 内联内容粘连(<blockquote><p>a</p>b</blockquote> 此前输出 "ab"); 仅"下一项也是
            // p/div 时才补换行"不够, 裸文本同样需要边界
            // wave16 共识(qwen): 嵌套引用(Discourse 引用内含引用)缺块级边界 —— blockquote/
            // aside 与 p/div 同为文本边界(顶层的两者由 _cookBlockquote/_cookAsideQuote 产出
            // 独立块, 此处只覆盖内层/嵌入场景), 否则 "外内" 直接拼接
            // wave17 共识(glm/qwen): 嵌套列表子树已由 _cookList 分派, 此处只补文本边界不产出内容
            if (skipNestedLists && (tag === "ul" || tag === "ol")
                // wave19 共识(w19 dsf): 跳过范围须与 _cookList 的分派范围**一致** —— 分派只认 li
                // 的直属 ul/ol, 而这里原为深度不限: 包裹在 blockquote/div 内的嵌套列表既被跳过、
                // 又不被分派 ⇒ 既不在 rich_text 也不产出块(内容静默丢失)
                && (!n.parentNode || n.parentNode === node)) {
                if (result.length > 0) needBreak = true;
                return;
            }

            if (DomSpec.TEXT_BOUNDARY_TAGS.has(tag)) {
                // 块级元素前后都是边界(前面是内联文本或块级都算): 标记延迟到真正产出内容时消费
                if (result.length > 0) needBreak = true;
                const before = result.length;
                DomSpec.eachChildOrdered(el, (c) => processNode(c, annotations));
                if (result.length > before) needBreak = true;
                return;
            }

            // 其他元素递归处理
            DomSpec.eachChildOrdered(el, (c) => processNode(c, annotations));
        };

        processNode(node);
        // Notion API 限制 rich_text 数组最多 100 个元素
        // P4 共识(dsf): 超限此前静默 slice, 补告警(内联节点数异常时用户可见)
        // wave17 共识(dsf): 仅 console.warn 不满足「不静默丢弃、保留用户可见状态」—— 与
        // splitLongText 的 100 项上限处理(末块插入可见截断标记)同口径: 保留 99 段 + 1 标记段
        if (result.length > 100) {
            const dropped = result.length - 99;
            console.warn(`[LD-Notion] rich_text 节点数 ${result.length} 超 Notion 上限 100, 已截断 ${dropped} 段`);
            return [
                ...result.slice(0, 99),
                { type: "text", text: { content: `…（富文本片段过多，已截断 ${dropped} 段）` } },
            ];
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

            // 处理图片容器(lightbox-wrapper / image-wrapper)
            // wave22/23/24 共识: 容器内媒体走 _cookBlockImage(含 alt 可见回退), 其余内容按**文档序**
            // 分派 —— 统一走 walkNode(与 .md-table 容器同口径): 媒体到来前先落已累积的内联内容
            // (前后说明文字不再粘连、顺序不乱), 容器内 .meta(图片元信息)与 script/style 子树经同一
            // 分派表被跳过, 内联片段数上限由 flushInline 统一守卫(避免超 100 段触发 Notion 400)
            if (el.classList && (el.classList.contains('lightbox-wrapper') || el.classList.contains('image-wrapper'))) {
                let handled = false;
                DomSpec.eachChildOrdered(el, (child) => {
                    if (!child) return;
                    if (child.nodeType === Node.ELEMENT_NODE && child.tagName
                        && DomSpec.mediaKind(child) === "img") {
                        flushInline();
                        DOMToNotion._cookBlockImage(child, blocks, imgMode);
                        handled = true;
                        return;
                    }
                    handled = true;
                    walkNode(child);
                });
                if (handled) {
                    flushInline();
                    return;
                }
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

            // 处理 iframe 嵌入（视频/外部内容），未匹配则终止该子树（降级文案不得入正文）
            if (tag === "iframe") {
                if (DOMToNotion._cookIframe(el, blocks, imgMode)) return;
                // wave22 共识(w22 dsf + w22 qwen): 未处理(无候选地址/imgMode=skip)时若继续
                // 走到末尾的 walkNode, iframe 内的浏览器降级文案会被落成段落; Markdown 出口的
                // iframe 分支从不转换其子树 ⇒ 两出口不一致。此处终止遍历(先落缓冲中的内联文本)
                flushInline();
                return;
            }

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
                DOMToNotion._cookCode(el, blocks, imgMode);
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
            if (tag === "table") {
                DOMToNotion._cookTable(el, blocks, imgMode);
                return;
            }

            // wave18 共识(dsf + qwen + w2 glm): .md-table 容器按文档序分派 —— 直属表格走
            // _cookTable, 其余内容走同一条透明下钻路径(walkNode), 与容器外的分派口径一致。
            // 此前只处理后代表格: 容器其余直属内容静默丢失、无表格时整支丢失; 以段落/媒体
            // 兑底又会让 <hr>/<ul>/<blockquote> 丢结构或零产出
            if (el.classList && el.classList.contains('md-table')) {
                let handled = false;
                DomSpec.eachChildOrdered(el, (child) => {
                    if (!child) return;
                    if (child.nodeType === Node.ELEMENT_NODE && child.tagName
                        && String(child.tagName).toLowerCase() === "table") {
                        // 保持文档序: 表格是块级产出, 先落缓冲中的内联文本
                        flushInline();
                        DOMToNotion._cookTable(child, blocks, imgMode);
                        handled = true;
                        return;
                    }
                    handled = true;
                    walkNode(child);
                });
                if (handled) {
                    flushInline();
                    return;
                }
            }

            // 处理独立图片(块级: emoji 图与地址被拒的图片经 _cookBlockImage 补可见回退)
            if (tag === "img") {
                DOMToNotion._cookBlockImage(el, blocks, imgMode);
                return;
            }

            // 递归处理子节点(未匹配容器的文本已由 walkNode 按序并入内联缓冲)
            DomSpec.eachChildOrdered(el, walkNode);
        };

        // wave13/14 共识(dsf/qwen): 未匹配容器与顶层裸文本此前只递归子元素 —— 直属文本
        // 静默丢弃; 且"先提取直属文本成段再递归子元素"会打乱文档顺序
        // (<div>Hello <span>world</span> again</div> 变成 "Hello  again" + "world")。
        // 改为单次顺序遍历: 连续的文本/内联内容合并为同一段落, 遇已识别块级元素
        // 先落段落再走原路径; 容器元素透明下钻。
        // wave18 共识(w2 dsf + qwen): 内联缓冲此前只存纯文本 —— 未匹配容器透明下钻路径
        // (GenericExtractor 的 body.innerHTML 兜底源主路径)会把 <a href> 的链接目标与
        // <strong>/<em>/<code> 的注解、内联 emoji 全部压成纯文本; 同一输入经 <p> 走
        // _cookParagraph 时链接完好 ⇒ 同文件内两套口径。改为按 rich_text 片段累积:
        // 文本节点归一空白, 内联元素委托 serializeRichText(与块级路径同源),
        // 块级元素到来时统一 flush 为一个段落。
        let inlineParts = [];
        // wave19 共识(w19 dsf + w19 glm): 归一化不得吞掉 br 产生的空行(<div>a<br><br>b</div>
        // 经本路径得 "a\nb", 而同一输入经 <p>/Markdown 出口保留空行 ⇒ 同一 HTML 两种结构),
        // 也不得改写已生成片段内部的空白(code 注解的片段是多空格语义)。
        // 折叠目标改为「最多一个空行」: \n{3,} → \n\n(源缩进排版仍被收敛)
        const normalizeInline = (value, annotations) => {
            const base = value.replace(/\r\n?/g, "\n");
            if (annotations && annotations.code) return base;
            return base
                .replace(/[ \t]+/g, " ")
                .replace(/ *\n */g, "\n")
                .replace(/\n{3,}/g, "\n\n");
        };
        const flushInline = () => {
            if (inlineParts.length === 0) return;
            const merged = [];
            for (const part of inlineParts) {
                if (!part || !part.text || !part.text.content) continue;
                const prev = merged[merged.length - 1];
                const sameMarks = prev
                    && JSON.stringify(prev.annotations || {}) === JSON.stringify(part.annotations || {})
                    && (prev.text.link?.url || "") === (part.text.link?.url || "")
                    // wave18 共识(w2 glm): 不得把已按 2000 字符切分的片段重新合并回去 ——
                    // 合并后的单段会重新突破 rich_text 单段上限(Notion 400)
                    && prev.text.content.length + part.text.content.length <= 2000;
                if (sameMarks) prev.text.content += part.text.content;
                else merged.push({ ...part, text: { ...part.text } });
            }
            inlineParts = [];
            if (merged.length === 0) return;
            merged[0].text.content = normalizeInline(merged[0].text.content, merged[0].annotations).replace(/^\s+/, "");
            const last = merged[merged.length - 1];
            last.text.content = normalizeInline(last.text.content, last.annotations).replace(/\s+$/, "");
            for (let i = 1; i < merged.length - 1; i++) {
                merged[i].text.content = normalizeInline(merged[i].text.content, merged[i].annotations);
            }
            const richText = merged.filter((part) => part.text.content);
            // wave18 共识(w2 glm): 多内联元素可累计出超过 Notion 上限的片段数 ——
            // 与 serializeRichText/splitLongText 同口径保留可见截断标记
            if (richText.length > 100) {
                const dropped = richText.length - 99;
                console.warn(`[LD-Notion] 段落富文本片段 ${richText.length} 超上限 100, 已截断 ${dropped} 段`);
                richText.length = 99;
                richText.push({ type: "text", text: { content: `…（富文本片段过多，已截断 ${dropped} 段）` } });
            }
            if (richText.length > 0) {
                blocks.push({ type: "paragraph", paragraph: { rich_text: richText } });
            }
        };
        // 容器(非块级元素且后代含块级/媒体)继续透明下钻 —— 保持内层块级结构不被拍平
        const hasBlockOrMedia = (node) => {
            let found = false;
            const scan = (n) => {
                DomSpec.eachChildOrdered(n, (child) => {
                    if (found || !child || child.nodeType !== Node.ELEMENT_NODE) return;
                    if (DomSpec.isBlockNode(child) || DomSpec.mediaKind(child)) { found = true; return; }
                    scan(child);
                });
            };
            scan(node);
            return found;
        };
        const walkNode = (node) => {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                inlineParts.push(...DOMToNotion.splitLongText(node.nodeValue || ""));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            // wave15(dsf): 本路径(未匹配容器的透明下钻)此前无跳过判据 —— script/style/
            // noscript 的文本(JS/CSS 源码)直入正文; serializeRichText 的同款守卫在 :535。
            // 触发面为 GenericExtractor 的 body.innerHTML 兜底源(普遍含 <style>)。
            // 判据统一驻 DomSpec, 不得在此重声明
            if (DomSpec.isSkippedNode(node)) return;
            // wave19 共识(w19 glm): emoji 图是**文本载体**(DomSpec.emojiNameOf 命中), 块级 img
            // 分支会把 "前 🎉 后" 拆成三个块, 而同一 img 在 <p> 内是单段内联(与 Markdown 出口一致)
            // —— 故 emoji 图沿内联路径并入当前缓冲
            // wave20 共识(w20 qwen): 同族残余边界 —— 地址被判拒时的 alt 文本回退也是**文本**
            // (serializeRichText 的内联 alt 回退), 仍走块级分支会把 "前 配图 后" 拆成三块
            if (DomSpec.mediaKind(node) === "img"
                && (DomSpec.emojiNameOf(DomSpec.mediaSrc(node))
                    || (!DomSpec.mediaUrl(node)
                        && typeof node.getAttribute === "function" && node.getAttribute("alt")))) {
                inlineParts.push(...DOMToNotion.serializeRichText(node));
                return;
            }
            // wave17 共识(dsf): 本路径不识别 <br> → 两段文本被直接拼接("line1line2");
            // wave18: 统一入内联片段缓冲(仍为硬换行)
            if (node.tagName && String(node.tagName).toLowerCase() === "br") {
                inlineParts.push(...DOMToNotion.splitLongText("\n"));
                return;
            }
            if (DomSpec.isBlockNode(node)) {
                flushInline();
                processElement(node);
                return;
            }
            if (!hasBlockOrMedia(node)) {
                // wave18 共识(dsf + qwen): 纯内联子树保留语义(link/annotations/emoji)
                inlineParts.push(...DOMToNotion.serializeRichText(node));
                return;
            }
            DomSpec.eachChildOrdered(node, walkNode);
        };

        DomSpec.eachChildOrdered(root, walkNode);
        flushInline();
        return blocks;
    },
};

module.exports = { DOMToNotion };
