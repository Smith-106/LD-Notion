"use strict";

// 导出层共享原语: 单一遍历模型 / 单一媒体判据 / 单一单行上下文折叠入口。
// 消费方: src/api/DOMToNotion.js(P1 起)、src/api/obsidian.js(P2 起)。
// leaf 模块: 不得 require DOMToNotion.js / obsidian.js。
// 背景: wave9-wave14 六轮审计的真缺陷全部是同构出口各自实现所致(块/内联分类两处、
// script/style 跳过两处、emoji 判据五处、媒体采集五处、单行折叠多站点),
// 故按 spec:project:learnings-006(出口面统一枚举法)收束为单一定义。

const { Utils } = require("../utils");
const { UrlValidator } = require("../security/UrlValidator");

// wave14 共识(dsf): 已识别为块级(有专属烹饪分支或容器块)的元素标签 —— 用于顺序化遍历
// (其余元素透明下钻, 其内联内容并入同一段落缓冲)
const BLOCK_TAGS = new Set([
    "div", "p", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "table", "img", "video", "audio", "iframe", "hr", "aside",
]);

// wave11/wave13 共识: 非渲染元素 —— 其文本(JS/CSS 源码)不得进入 rich_text / Markdown
const SKIP_TAGS = new Set(["script", "style", "noscript"]);

// wave17 共识(glm/qwen): 内联序列化的「文本边界」判据单一来源 —— 原实现内联 4 个标签字面量
// (p/div/blockquote/aside), 其余容器块(h1-h6/ul/ol/table/pre/hr)内的文本与相邻内联内容直接
// 拼接(<li>a<ul><li>b</li></ul></li> 的 rich_text 为 "ab"; 嵌套引用为 "外内")。
// 与 BLOCK_TAGS 的差别: 不含 img/video/audio/iframe —— 它们有独立块产出与内联 emoji 语义,
// 纳入边界会把内联 emoji 拆成独立行(回归风险)。
// wave18 共识(dsf): li 亦为文本边界 —— 容器块(h1-h6/引用/表格单元格)内的同层列表项原本走
// 透明下钻拼进同一段落缓冲(<blockquote><ul><li>a</li><li>b</li></ul></blockquote> → "ab"),
// 项边界与词边界同时丢失。
const TEXT_BOUNDARY_TAGS = new Set([
    "div", "p", "pre", "blockquote", "aside", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "hr",
]);

const tagOf = (el) => (el && el.tagName ? String(el.tagName).toLowerCase() : "");

// wave18 共识(qwen): Notion 的 url 字段上限 2000 字符 —— 超长直链原样写入会 400 并
// **整页导入失败**; 与 caption / rich_text 的 2000 上限同因。集中在此判据(单一出口面)。
const MAX_URL_LENGTH = 2000;

const DomSpec = {
    BLOCK_TAGS,
    SKIP_TAGS,
    TEXT_BOUNDARY_TAGS,

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
    // 再按**文档序**采集后代, 每节点恰一次。wave8(段落/li/引用/单元格补发)、
    // wave9(标题补发)、wave14(自身即媒体)的统一来源。
    eachMedia: (el, visit) => {
        if (!el) return;
        // wave18 共识(w1 glm): 参数自身为跳过元素时其后代媒体照采(与 walk 的子树剪枝不对称 ——
        // 容器分支以 <noscript> 为参数时会产出幽灵媒体块)
        if (DomSpec.isSkippedNode(el)) return;
        const selfKind = DomSpec.mediaKind(el);
        if (selfKind) visit(el, selfKind);
        // wave17 共识(dsf): 原实现分五次按固定类序采集(img → a.attachment → video → audio →
        // iframe), 类内部保序但**类之间被重排** —— <p>文字<video><img></p> 产出
        // paragraph → image → video, 与源文档序相反, 且与 Markdown 出口(_convertChildren 沿
        // childNodes 文档序)不对称。改为沿 childNodes 的文档序递归(与 eachChildOrdered 同源),
        // 每节点仍恰一次, 且不依赖宿主 querySelectorAll 的复合选择器支持。
        // wave17 共识(qwen): 文本面三处均有 script/style/noscript 跳过守卫, 唯此采集面漏判 ——
        // noscript 内的降级媒体(DOMParser 非脚本上下文下解析为真元素)被误采为幽灵媒体块;
        // 递归时遇 SKIP_TAGS 子树直接剪枝(与文本面同口径)。
        const walk = (node) => {
            DomSpec.eachChildOrdered(node, (child) => {
                if (DomSpec.isSkippedNode(child)) return;
                const kind = DomSpec.mediaKind(child);
                if (kind) visit(child, kind);
                walk(child);
            });
        };
        walk(el);
    },

    // wave12 共识(qwen): emoji 图"跳过块级图片"与"转 emoji 文本"必须同口径 ——
    // 前者按 src.includes("/images/emoji/") 跳、后者只认四家 set 会致 Discourse 其余
    // set(win10/emoji_one 等)两边都不命中而静默丢失; 此处 set 目录放宽为任意值
    emojiNameOf: (src) => {
        const m = String(src || "").match(/\/images\/emoji\/[^/]+\/([^/.]+)\.png/i);
        return m ? m[1] : null;
    },

    // 媒体地址回退口径: src → data-src(懒加载, Discourse 常见) → <source src>(video/audio)。
    // 此前 img 只认 src|data-src 而 video/audio 只认 src|<source src>, 两导出器各自实现且
    // 互不覆盖 —— 懒加载图在 Obsidian 侧被丢、<source> 型视频在 Notion 侧被丢。
    mediaSrc: (el) => {
        if (!el || typeof el.getAttribute !== "function") return "";
        // wave16 共识(qwen) + wave17 共识(qwen): 占位 src 会阻断懒加载真实地址 —— 原判据只列
        // data:/about:, 而 blob:/javascript:/file: 等非 http(s) scheme 同样经 safeUrl 判空后整体
        // 丢弃(真实地址就在同一元素的 data-src 上)。改为「非 http(s) scheme 一律视为占位」。
        // 无 scheme(相对/协议相对/裸相对)仍按真实地址返回, 交由 safeUrl 补齐 + 公网校验。
        // wave18 共识(qwen): ① 占位判据此前只施加在 src 上 —— 懒加载骨架
        // (<img src="data:…" data-src="data:…">)会返回占位串, 消费侧据此把"未加载完成"
        // 误报成"地址被安全策略拒绝"(自造噪声块); ② 回退链缺响应式属性 —— 无 src 的
        // <img srcset=…>/<img data-lazy-src=…>/<img data-original=…> 整体零产出。
        // 统一为: 按优先级取第一个「非占位」候选, 全无候选时返回 ""(消费侧据此静默)。
        const attrOf = (node, name) => (node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null);
        const firstSrcset = (value) => String(value || "").split(",")[0].trim().split(/\s+/)[0] || "";
        const candidates = [
            attrOf(el, "src"), attrOf(el, "data-src"), attrOf(el, "data-lazy-src"),
            attrOf(el, "data-original"), firstSrcset(attrOf(el, "srcset")),
        ];
        // wave18 共识(w1 glm): 响应式图片(<picture><source srcset><img src=占位>)的首选源
        // 挂在父级 <picture> 上 —— 只查元素自身下属的 <source> 会整体零产出
        const sources = [
            typeof el.querySelector === "function" ? el.querySelector("source") : null,
        ];
        const picture = typeof el.closest === "function" ? el.closest("picture") : null;
        if (picture && typeof picture.querySelector === "function") {
            sources.push(picture.querySelector("source"));
        }
        sources.forEach((node) => {
            if (!node) return;
            candidates.push(attrOf(node, "src"), firstSrcset(attrOf(node, "srcset")));
        });
        for (const candidate of candidates) {
            const value = String(candidate == null ? "" : candidate).trim();
            if (!value) continue;
            const scheme = (value.match(/^([a-z][a-z0-9+.-]*):/i) || [])[1];
            if (scheme && !/^https?$/i.test(scheme)) continue;
            return value;
        }
        return "";
    },

    // 地址出口面唯一判据(媒体 src 与文件/链接 href 共用): 仅 http(s) 与相对形式可入,
    // 其余 scheme(javascript:/data:/vbscript:/file:/mailto: 等)一律拒绝 —— 关键在**先判
    // scheme 再补齐**: Utils.absoluteUrl 会把未知 scheme 拼成 "<origin>/<scheme>:…" 并被
    // validatePageExternalUrl 判为合法公网 http(s)(旧契约测试仅因测试环境 origin 为内网
    // localhost 才显绿, 实网 origin=https://linux.do 下 javascript:/data: 均放行)。
    // 相对(/x)、协议相对(//host/x)、裸相对(x)、已绝对 http(s) 地址补齐后过公网校验。
    safeUrl: (raw) => {
        const value = String(raw == null ? "" : raw).trim();
        if (!value || value.startsWith("#")) return "";
        const scheme = (value.match(/^([a-z][a-z0-9+.-]*):/i) || [])[1];
        if (scheme && !/^https?$/i.test(scheme)) return "";
        const abs = scheme ? value : Utils.absoluteUrl(value);
        if (!abs || !UrlValidator.validatePageExternalUrl(abs)) return "";
        // wave18 共识(qwen): 超长 URL 会使整页导入 400(见 MAX_URL_LENGTH); URL 截断即失效,
        // 故整体判空 —— 链接退化为纯文本、文件/媒体块降级为可见标记, 用户可见内容不丢。
        if (abs.length > MAX_URL_LENGTH) {
            console.warn(`[LD-Notion] URL 长度 ${abs.length} 超 Notion 上限 ${MAX_URL_LENGTH}, 已忽略该地址`);
            return "";
        }
        return abs;
    },

    // 媒体地址出口面唯一入口: 回退(mediaSrc) + 地址判据(safeUrl)。消费方不得再各自
    // absoluteUrl + validatePageExternalUrl —— 两导出器口径曾因此不对称: 相对与协议相对
    // 媒体地址在 Markdown 侧被整体判为"非公网"而静默丢弃(Notion 侧正常落块)。
    mediaUrl: (el) => DomSpec.safeUrl(DomSpec.mediaSrc(el)),

    // 单行上下文出口面的唯一入口(引用块内/callout 行/表格单元格/标题/link label/img alt)。
    // 实现仍驻 Utils.mdText(公开壳, 供 ai/ui 跨模块调用), 此处只做导出层命名收束 ——
    // 依赖方向保持 api → utils, 且折叠语义只有一处实现。
    collapseOneLine: Utils.mdText,

    // 纯空白单行折叠(标题/表格单元格等非 Markdown 语法上下文): 折叠 CR/LF 并去首尾空白。
    // 与 collapseOneLine 语义不同 —— 后者用于链接标签/alt, 需剔方括号防链接结构被破坏;
    // 此处**不可**剔方括号("[RFC]" 是合法标题内容), 二者不可互替。
    foldToSingleLine: (text) => String(text ?? "").replace(/\r\n?|\n/g, " ").trim(),

    // wave16 共识(qwen + dsf): 代码块文本提取 —— <br> 在 textContent 下不产生换行
    // (<pre><code>line1<br>line2</code></pre> 导出为 "line1line2", 代码行粘连且缩进丢失)。
    // 逐节点递归: <br> → "\n", 文本节点原样, 其余元素下钻; 不产出 Notion 注解(纯文本上下文)。
    // nodeType 用字面量而非全局 Node —— 本模块为 leaf, 不依赖宿主全局。
    // 无 childNodes 的宿主(测试替身/最小桩)回退 textContent, 保持既有取文本口径。
    textWithBreaks: (el) => {
        if (!el) return "";
        let pruned = false;
        const collect = (node) => {
            if (!node) return "";
            // 文本节点: 真实 DOM 下 nodeValue 与 textContent 同值; 后者兼作最小桩回退
            if (node.nodeType === 3) return node.nodeValue || node.textContent || "";
            if (node.nodeType !== 1) return "";
            // wave18 共识(w1 glm): SKIP_TAGS 子树剪枝 —— <pre><code>x</code><script>…</script></pre>
            // 的 JS/CSS 源码原样并入代码块; 其余文本面(serializeRichText 通用递归、obsidian
            // _convertChildren)均有同款守卫, 唯此原语漏判(与 wave17 已修的 eachMedia 剪枝同族)
            if (DomSpec.isSkippedNode(node)) { pruned = true; return ""; }
            if (tagOf(node) === "br") return "\n";
            return Array.from(node.childNodes || []).map(collect).join("");
        };
        const walked = collect(el);
        // wave19 共识(w19 qwen): 回退分支的本意是「宿主无可遍历子节点(测试替身/最小桩)时保持
        // 既有取文本口径」, 但它把「剪枝后确实为空」也当成该情形 —— <pre><script>…</script></pre>
        // 的脚本源码又经 el.textContent 泄入代码块。故仅当**未发生任何剪枝**时才回退
        if (walked) return walked;
        if (pruned) return "";
        return String(el.textContent || "");
    },

    // 有序子节点遍历(含文本节点, 文档序)。单一来源取代各处的
    // Array.from(el.childNodes || []).forEach(...)(部分站点漏了 || [] 保护)。
    eachChildOrdered: (el, visit) => {
        Array.from((el && el.childNodes) || []).forEach((node) => visit(node));
    },
};

module.exports = { DomSpec };
