"use strict";

const { UrlValidator } = require("../security/UrlValidator");
const { Utils } = require("../utils");
const { DomSpec } = require("./DomSpec");

const ObsidianAPI = {
    // P4 共识(dsf): 整路径 encodeURIComponent 会把子目录的 "/" 编成 %2F, 且 ".." 段可越权写入。
    // 逐段编码并剔除空/./.. 段。
    _safeVaultPath: (path) => String(path || "")
        .replace(/\\/g, "/")
        .split("/")
        .filter(seg => seg && seg !== "." && seg !== "..")
        .map(seg => encodeURIComponent(seg))
        .join("/"),

    testConnection: async (apiUrl, apiKey) => {
        if (!UrlValidator.validateObsidianUrl(apiUrl)) {
            return { ok: false, error: "Obsidian API URL 安全校验失败：仅允许本地地址 (127.0.0.1/localhost)" };
        }
        let resp;
        try {
            // P4 共识(3/3): onerror/ontimeout 的 reject 逃逸出 async 方法, 破坏 {ok,error} 契约
            resp = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: `${apiUrl}/vault/`,
                    headers: { Authorization: `Bearer ${apiKey}` },
                    responseType: "json",
                    timeout: 10000,
                    onload: (r) => resolve(r),
                    onerror: (e) => reject(e),
                    ontimeout: () => reject(new Error("Obsidian API 请求超时")),
                });
            });
        } catch (error) {
            return { ok: false, error: `Obsidian API 请求失败: ${error?.message || error}` };
        }
        if (resp.status === 200 || resp.status === 204) return { ok: true };
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },

    writeNote: async (apiUrl, apiKey, path, content) => {
        if (!UrlValidator.validateObsidianUrl(apiUrl)) {
            return { ok: false, error: "Obsidian API URL 安全校验失败：仅允许本地地址 (127.0.0.1/localhost)" };
        }
        const safePath = ObsidianAPI._safeVaultPath(path);
        if (!safePath) return { ok: false, error: "无效的笔记路径" };
        let resp;
        try {
            resp = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "PUT",
                    url: `${apiUrl}/vault/${safePath}`,
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "text/markdown",
                    },
                    data: content,
                    timeout: 30000,
                    onload: (r) => resolve(r),
                    onerror: (e) => reject(e),
                    ontimeout: () => reject(new Error("Obsidian API 请求超时")),
                });
            });
        } catch (error) {
            return { ok: false, error: `Obsidian API 请求失败: ${error?.message || error}` };
        }
        if (resp.status === 200 || resp.status === 204 || resp.status === 201) {
            return { ok: true };
        }
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },

    writeImage: async (apiUrl, apiKey, path, blob, contentType) => {
        if (!UrlValidator.validateObsidianUrl(apiUrl)) {
            return { ok: false, error: "Obsidian API URL 安全校验失败：仅允许本地地址 (127.0.0.1/localhost)" };
        }
        const safePath = ObsidianAPI._safeVaultPath(path);
        if (!safePath) return { ok: false, error: "无效的图片路径" };
        let resp;
        try {
            resp = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "PUT",
                    url: `${apiUrl}/vault/${safePath}`,
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": contentType || "application/octet-stream",
                    },
                    data: blob,
                    timeout: 60000,
                    onload: (r) => resolve(r),
                    onerror: (e) => reject(e),
                    ontimeout: () => reject(new Error("Obsidian API 请求超时")),
                });
            });
        } catch (error) {
            return { ok: false, error: `Obsidian API 请求失败: ${error?.message || error}` };
        }
        if (resp.status === 200 || resp.status === 204 || resp.status === 201) {
            return { ok: true };
        }
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },
};


const HTMLToMarkdown = {
    // P4 共识(glm+qwen): 链接文本/alt 与 href/src 未净化, 含 ]( 的不可信内容可逃逸链接语法。
    // P4 收敛(c05): URL 改用百分号编码(与 Utils.mdUrl 同口径), 删除字符会改写链接目标
    // wave12 系统扫描: 与 Utils.mdText 同源 —— 引用共享原语而非重复实现
    _mdText: (s) => Utils.mdText(s),
    _mdUrl: (s) => Utils.mdUrl(s),

    convert: (html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return HTMLToMarkdown._convertNode(doc.body);
    },

    // wave10 共识(dsf): li/ol/table 分支自行转换子树 —— 若在 _convertNode 顶部提前计算
    // _convertChildren, 同一子树会被转换两遍, 嵌套深度 n 时代价 2^n(深嵌套列表/表格
    // 导出时主线程卡顿)。三个分支前置返回, 保证每棵子树只被转换一次。
    _convertNodeBranch: (node, tag) => {
        if (tag === "ol") {
            // wave14 共识(dsf): :scope > li 只取直属 li —— <ol> 内非 li 直属内容(裸文本/
            // <p>)被静默丢弃(ul 分支走 _convertChildren 会保留); 改为按 childNodes 顺序
            // 渲染, 非 li 节点原样转换, 只对 li 编序号
            const items = [];
            // wave18 共识(w3 dsf): 空行边界(同 ul 分支, 见 pushSeparated 注释)
            const pushSeparated = (md) => {
                if (items.length > 0 && !/\n\n$/.test(items[items.length - 1])) {
                    items[items.length - 1] = items[items.length - 1].replace(/\n?$/, "\n\n");
                }
                items.push(/\n\n$/.test(md) ? md : `${md.replace(/\n?$/, "\n\n")}`);
            };
            // wave17 共识(qwen): <ol start="N"> 与 <li value="N"> 此前被忽略 —— 续接编号被静默
            // 改写为 1..n(内容篡改); CommonMark 支持显式起始序号, 可无损保留
            // wave18 共识(w3 第三模型复审): 判据 `> 0` 把显式 0/负值当成缺省 —— HTML 允许
            // start="0"/"-2"; 且必须区分「属性缺失」与「数值为 0」(Number(null) === 0)
            const rawStart = node.getAttribute ? node.getAttribute("start") : null;
            const startNum = rawStart === null || rawStart === undefined || rawStart === ""
                ? NaN : Number(rawStart);
            let idx = Number.isFinite(startNum) ? Math.floor(startNum) : 1;
            DomSpec.eachChildOrdered(node, (child) => {
                // wave15(glm): 缩进排版的 <ol>\n    <li> 产生项间纯空白文本节点 —— 原样拼入会把
                // 后续 "1. a" 推到行首缩进位(≥4 空格时整表退化为缩进代码块)
                if (child.nodeType === Node.TEXT_NODE && !String(child.textContent || "").trim()) return;
                const isLi = child.nodeType === Node.ELEMENT_NODE
                    && child.tagName.toLowerCase() === "li";
                if (!isLi) {
                    // wave16 共识(dsf): 非 li 子节点的转换结果直接入数组, 与其后 "1. a" 行
                    // 粘连(<ol>intro<li>a</li></ol> → "intro1. a") —— 补齐行边界
                    // wave18 共识(w3 dsf): 且需空行分隔, 否则被并进相邻列表项
                    const md = HTMLToMarkdown._convertNode(child);
                    if (md) pushSeparated(child.nodeType === Node.TEXT_NODE ? String(md).trim() : md);
                    return;
                }
                // P4 收敛(c05 2/3): li 分支已输出 "- " 前缀 —— 有序列表需剥离, 否则 "1. - x"
                // wave18 共识(w3 复审): value 同样是显式序号(允许 0/负值); 空 li 的 li 分支
                // 产物 "- " 经 trim 得裸 "-", /^-\s+/ 不匹配 → "1. -"(凭空注入连字符)
                const rawValue = child.getAttribute ? child.getAttribute("value") : null;
                const valueNum = rawValue === null || rawValue === undefined || rawValue === ""
                    ? NaN : Number(rawValue);
                if (Number.isFinite(valueNum)) idx = Math.floor(valueNum);
                // wave18 共识(w3 qwen): 续行/嵌套缩进须按**父项内容列**算 —— 固定 2 空格对
                // 有序项不足("10. " 的内容列是 4 = 数字位数 + 点和空格), 嵌套列表与多段内容
                // 会脱离父项(层级丢失)
                const indent = " ".repeat(String(idx).length + 2);
                const md = HTMLToMarkdown._convertNode(child).trim().replace(/^-(?:\s+|$)/, "")
                    .split("\n")
                    .map((line, i) => (i === 0 || !/^ {2}/.test(line) ? line : line.replace(/^ {2}/, indent)))
                    .join("\n").trim();
                items.push(md ? `${idx}. ${md}\n` : `${idx}.\n`);
                idx++;
            });
            return items.join("") + "\n";
        }
        if (tag === "ul") {
            // wave15(glm): 同 ol —— 项间缩进空白文本节点(缩进排版)不产出内容, 非 li 直属
            // 文本仍保留; 否则 "- a" 行会被前置缩进(≥4 空格时退化为缩进代码块)
            const items = [];
            // wave18 共识(w3 dsf): 列表块与相邻块级内容之间须有空行 —— 单个换行会使后续段落
            // 成为末个列表项的懒延续行(内容被并进列表项, 段落结构丢失)
            const pushSeparated = (md) => {
                if (items.length > 0 && !/\n\n$/.test(items[items.length - 1])) {
                    items[items.length - 1] = items[items.length - 1].replace(/\n?$/, "\n\n");
                }
                items.push(/\n\n$/.test(md) ? md : `${md.replace(/\n?$/, "\n\n")}`);
            };
            DomSpec.eachChildOrdered(node, (child) => {
                if (child.nodeType === Node.TEXT_NODE) {
                    const text = String(child.textContent || "").trim();
                    // wave16 共识(dsf): 裸文本原样入数组与首个列表项粘连("intro- a") —— 补行边界
                    if (text) pushSeparated(text);
                    return;
                }
                const isLi = child.nodeType === Node.ELEMENT_NODE && child.tagName
                    && String(child.tagName).toLowerCase() === "li";
                const md = HTMLToMarkdown._convertNode(child);
                if (!md) return;
                if (isLi) {
                    items.push(/\n$/.test(md) ? md : `${md}\n`);
                    return;
                }
                // wave18 共识(w3 glm): 容器层直属的块级子元素(HTML 解析器不包裹的 <ol>/<table>/<div>)
                // 此前零缩进原样拼接 —— 渲染为顶层块(层级丢失); 与 li 分支同行 2 空格缩进
                pushSeparated(md.trim().split("\n").map((line) => `  ${line}`).join("\n"));
            });
            return items.join("");
        }
        if (tag === "li") {
            // P4 收敛(c05b2-glm): 内层 ul/ol 与父项文本直接拼接会粘连("- a- b"),
            // 且完全依赖源 HTML 空白节点 —— 显式缩进 2 空格(Obsidian 嵌套列表语法)
            // wave8 共识(qwen): 改按 childNodes 分段渲染 —— replace(md, "") 在父项文本
            // 与内层列表 markdown 重叠时会误删父项文本, 不再依赖子串匹配
            // wave9 共识(dsf): ①按 childNodes 顺序交错收集(嵌套列表后的文本不再被
            // 挪到前面); ②无嵌套列表时续行也缩进 2 空格(多段内容不再脱离列表)
            const segments = [];
            // wave14 共识(glm): 嵌套列表行已由本分支加过续行缩进 —— 不能再靠
            // startsWith("  ") 猜(会误伤自带 ≥2 空格缩进的代码围栏内容行, 丢掉列表续行缩进)
            const preIndented = new Set();
            let buf = "";
            const pushText = (text) => {
                if (text) text.split("\n").forEach((line) => segments.push(line));
            };
            // wave19 共识(w19 dsf + w19 glm): 块级子节点(hr/引用/表格/块容器)此前走 `buf += md`
            // —— 与父项文本**同行拼接**(<li>a<hr>b</li> → "a---" 分隔线字面化;
            // <li>a<blockquote>x</blockquote></li> → "a> x" 引用前缀被吞)。与嵌套列表分支同口径:
            // 先落缓冲, 块内容逐行按内容列缩进, 并在其前补空行(否则 "---" 会与前文构成 setext 标题)
            const pushBlock = (md) => {
                flushBuf();
                if (segments.length > 0) segments.push("  ");
                md.replace(/^\n+|\n+$/g, "").split("\n").forEach((line) => {
                    // 项内首个块行不缩进("- " 已由本分支补上, 与 pushText 首段同口径)
                    if (segments.length === 0) {
                        pushText(line);
                        return;
                    }
                    preIndented.add(segments.length);
                    segments.push(line ? `  ${line}` : "  ");
                });
            };
            // wave12 共识(glm): 代码围栏不做空白折叠 —— \s+\n → \n 会删掉围栏内的空行
            // 与行尾空白(代码内容被篡改), 围栏自身成段原样推入
            // wave18 共识(w3 复审): 折叠只清行尾空白, 不再把 \n\n 压成 \n ——
            // <li><p>a</p><p>b</p></li> 的块级段落分隔被压成软换行(结构丢失)
            const flushBuf = () => {
                pushText(buf.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
                buf = "";
            };
            DomSpec.eachChildOrdered(node, (child) => {
                const isList = child.nodeType === Node.ELEMENT_NODE
                    && child.tagName && ["ul", "ol"].includes(child.tagName.toLowerCase());
                if (isList) {
                    flushBuf();
                    const md = HTMLToMarkdown._convertNode(child).trim();
                    // wave14 共识(qwen): 不能过滤空行 —— 嵌套列表内代码围栏的空行会被丢
                    // (md 已 trim, 首尾空行本就不存在, 剩余空行属于代码内容)
                    md.split("\n").forEach((line) => {
                        preIndented.add(segments.length);
                        segments.push(`  ${line}`);
                    });
                } else {
                    const md = HTMLToMarkdown._convertNode(child);
                    // wave16 共识(qwen): 仅看行首反引号会把内联 code 误判为围栏 ——
                    // <code>``a``</code> 转出 "``` ``a`` ```"(单行), 被当作代码块拆行;
                    // 真围栏必有换行分隔的闭合行
                    const childTag = child.nodeType === Node.ELEMENT_NODE && child.tagName
                        ? String(child.tagName).toLowerCase() : "";
                    if (/^\s*`{3,}[^\n]*\n[\s\S]*\n\s*`{3,}\s*$/.test(md)) {
                        flushBuf();
                        pushText(md.replace(/^\n+|\n+$/g, ""));
                    } else if (DomSpec.TEXT_BOUNDARY_TAGS.has(childTag)) {
                        // wave19 共识(w19 dsf + w19 glm): 块级子节点改走 pushBlock(见上)
                        pushBlock(md);
                    } else {
                        buf += md;
                    }
                }
            });
            flushBuf();
            if (segments.length === 0) return `- ${HTMLToMarkdown._convertChildren(node)}\n`;
            const [first, ...rest] = segments;
            const restLines = rest.map((line, i) => {
                if (preIndented.has(i + 1)) return line;
                if (!line.trim()) return "  ";
                return `  ${line}`;
            });
            return `- ${[first, ...restLines].join("\n")}\n`;
        }
        return HTMLToMarkdown._convertTable(node) + "\n\n";
    },

    // wave18 共识(w3 qwen): 链接标签既可能是纯文本(需转义 [ ] \\ 以防 "](url)" 逃逸链接语法),
    // 也可能是已生成的内联 Markdown(内嵌 ![]())。对整体跑 _mdText 会把内嵌图片语法转义成
    // 字面文本(<a href><img alt="A"></a> → "[!\[A\](…)](…)"); 完全不转义又可注入。
    // 故以「标签转换深度」为界: 仅标签内的**文本节点**转义, 已生成的结构原样保留。
    _labelDepth: 0,

    _convertNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || "";
            return HTMLToMarkdown._labelDepth > 0 ? Utils.mdText(text) : text;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const tag = node.tagName.toLowerCase();

        // wave10 共识(dsf): 这些分支自行转换子树, 前置返回避免重复转换(见 _convertNodeBranch)
        // wave15(glm): ul 同 ol —— 项间缩进空白文本节点必须在容器层过滤, 否则
        // _convertChildren 会把 "\n    " 拼到列表项行首
        if (tag === "li" || tag === "ol" || tag === "ul" || tag === "table") {
            return HTMLToMarkdown._convertNodeBranch(node, tag);
        }

        // wave11 共识(glm): script/style/noscript 非渲染元素 —— 其文本内容(JS/CSS 源码)
        // 经 default 原样并入导出正文, 污染笔记。判据统一驻 DomSpec.SKIP_TAGS, 且置于
        // _convertChildren 之前(源码不必先转换再丢弃)
        if (DomSpec.isSkippedNode(node)) return "";

        let children;
        // wave18 共识(w3 qwen): 链接标签的子树内文本需转义(见 _labelDepth)
        if (tag === "a") {
            HTMLToMarkdown._labelDepth++;
            try {
                children = HTMLToMarkdown._convertChildren(node);
            } finally {
                HTMLToMarkdown._labelDepth--;
            }
        } else {
            children = HTMLToMarkdown._convertChildren(node);
        }

        switch (tag) {
            // wave12 共识(dsf): 标题是单行结构 —— 标题内 <br>(br 分支返回换行)或文本节点自带
            // 换行会把标题体推到下一行, Markdown 行首起不再属于标题(文本与层级双丢)
            case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
                const text = DomSpec.foldToSingleLine(children);
                return `${"#".repeat(Number(tag[1]))} ${text}\n\n`;
            }
            case "p": return `${children}\n\n`;
            case "br": return "\n";
            case "hr": return "---\n\n";
            case "strong": case "b": {
                // wave18 共识(w3 dsf): 定界符内侧留白会使 CommonMark 判为非 flanking ——
                // <strong> 重点 </strong> 原样输出 "** 重点 **" 不渲染为强调(星号字面可见)。
                // 内层留白移到定界符外(空白在 Markdown 中本就折叠, 内容无损)
                const text = String(children).trim();
                return text ? `**${text}**` : children;
            }
            case "em": case "i": {
                const text = String(children).trim();
                return text ? `*${text}*` : children;
            }
            case "del": case "s": {
                const text = String(children).trim();
                return text ? `~~${text}~~` : children;
            }
            case "code": {
                const parent = node.parentElement;
                if (parent && parent.tagName.toLowerCase() === "pre") return children;
                // wave6 共识(qwen): 内容含反引号会提前闭合代码跨度并可注入后续标记 ——
                // 用比最长反引号串更长的围栏(与 pre 分支同口径), 首尾为反引号时补空格
                const codeText = String(children);
                const run = (codeText.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
                const fence = "`".repeat(Math.max(1, run + 1));
                const pad = /^`|`$/.test(codeText) ? " " : "";
                return `${fence}${pad}${codeText}${pad}${fence}`;
            }
            case "pre": {
                const codeEl = node.querySelector("code");
                // wave15 共识(qwen/glm): className 在 SVG 命名空间元素上是 SVGAnimatedString
                // (无 .match → TypeError 中断整个导出); \w+ 在 c++/c#/objective-c 的 +/#/- 处
                // 截断(与 NOTION_LANGUAGES 已收录 c++/c# 的口径不一致)
                // wave17 共识(qwen): 判据与 Notion 出口(DOMToNotion._cookCode 的
                // /lang(?:uage)?-([a-z0-9_+#-]+)/i)不一致 —— class="lang-python" 在两出口得到不同
                // 结果(prism 写法在 Markdown 侧丢语言标注); 统一为同一形态并大小写不敏感
                const lang = String((codeEl && (codeEl.getAttribute?.("class") || codeEl.className)) || "")
                    .match(/lang(?:uage)?-([\w+#.-]+)/i)?.[1] || "";
                // wave14 共识(glm): 只取 code 元素会丢掉 pre 内其余文本(<pre>foo<code>bar</code></pre>);
                // wave16 共识(qwen): textContent 下 <br> 不产生换行(<pre>a<br>b</pre> 导出 "ab");
                // 统一走 DomSpec.textWithBreaks, 并按 HTML 规范去掉 <pre> 紧随的首个换行
                const text = DomSpec.textWithBreaks(node).replace(/^\n/, "");
                // P4 共识(glm): 内容含 ``` 会提前闭合围栏 —— 用比最长反引号串更长的围栏
                const longestRun = (String(text).match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
                const fence = "`".repeat(Math.max(3, longestRun + 1));
                return fence + lang + "\n" + text + "\n" + fence + "\n\n";
            }
            case "blockquote": {
                // wave18 共识(w3 glm): 拆行前需统一行结束符 —— 源文本中的孤立 \r
                // (&#13; 实体可达, 输入流规范化不覆盖字符引用)在 CommonMark 中同样是行结束符,
                // 未归一则该行脱离 "> " 前缀(引用/callout 结构被逃逸)
                const lines = String(children).replace(/\r\n?/g, "\n").trim().split("\n");
                return lines.map((l) => `> ${l}`).join("\n") + "\n\n";
            }
            case "a": {
                // wave9 共识(dsf) + R15: 地址判据统一走 DomSpec.safeUrl —— 此前仅放行 "http"
                // 前缀, 相对(/t/1)与协议相对(//host/t/1)链接被降级为纯文本(链接静默丢失);
                // 且 http://127.0.0.1/… 等内网链接未经公网校验直接被写入
                const link = DomSpec.safeUrl(node.getAttribute("href") || "");
                // wave18 共识(w3 qwen): children 已是子树 Markdown(内嵌图片/强调原样保留),
                // 标签内文本的转义由 TEXT_NODE 分支在 _labelDepth 内完成
                // 标签是单行上下文 —— <br>/文本内换行会拆断链接语法(wave12);
                // 已生成的内联 Markdown 结构不受影响(只折叠换行, 不再整体转义)
                if (link) {
                    // wave19 共识(w19 qwen): 标签被剪空时(子树全为 script/style/noscript)
                    // 产出 "[](url)" —— CommonMark 中空标签不构成链接(渲染为字面垃圾且不可点),
                    // 与 Notion 出口的回退(linkText = link)不对称; 改为以 URL 自身作标签
                    const label = String(children).replace(/\r\n?|\n/g, " ").trim();
                    return label
                        ? `[${label}](${HTMLToMarkdown._mdUrl(link)})`
                        : `[${HTMLToMarkdown._mdText(link)}](${HTMLToMarkdown._mdUrl(link)})`;
                }
                return children;
            }
            case "img": {
                const alt = node.getAttribute("alt") || "";
                // wave9 共识(qwen) + R15: 地址判据(回退 → 原点补齐 → 公网 http(s) 校验)
                // 单一驻 DomSpec.mediaUrl —— 相对/协议相对地址此前被整体判为"非公网"而丢失
                const src = DomSpec.mediaUrl(node);
                if (src) {
                    return `![${HTMLToMarkdown._mdText(alt)}](${HTMLToMarkdown._mdUrl(src)})`;
                }
                if (alt) return HTMLToMarkdown._mdText(alt);
                // wave18 共识(w3 glm + qwen): 有候选地址但被判拒时此前零产出 —— 与同文件
                // iframe/video/audio 分支及 Notion 出口 _cookBlockImage 不对称, 改留可见标记;
                // 完全无候选地址(未加载完成)仍静默, 不造「已拒」噪声块
                return DomSpec.mediaSrc(node) ? "[图片已拒（非公网 http(s) 地址）]" : "";
            }
            case "iframe": {
                // wave9 共识(qwen) + R15: 地址判据统一走 DomSpec.mediaUrl
                const safeSrc = DomSpec.mediaUrl(node);
                if (safeSrc) {
                    return `[嵌入内容](${HTMLToMarkdown._mdUrl(safeSrc)})\n\n`;
                }
                // wave18 共识(w3 qwen): 无任何候选地址时不得输出「已拒」标记(与 Notion 出口
                // _cookIframe/_cookVideo 以 DomSpec.mediaSrc 为前置的判据同口径, 不造噪声块)
                return DomSpec.mediaSrc(node) ? "[嵌入内容已拒（非公网 http(s) 地址）]\n\n" : "";
            }
            case "video": {
                // wave9 共识(qwen) + R15: 同 img —— 地址判据统一走 DomSpec.mediaUrl
                const src = DomSpec.mediaUrl(node);
                if (src) {
                    return `[视频](${HTMLToMarkdown._mdUrl(src)})\n\n`;
                }
                // wave18 共识(w3 qwen): 同 iframe —— 无候选地址不输出「已拒」标记
                return DomSpec.mediaSrc(node) ? "[视频已拒（非公网 http(s) 地址）]\n\n" : "";
            }
            case "audio": {
                // wave13 共识(dsf) + R15: 与 video 同口径 —— 地址判据统一走 DomSpec.mediaUrl
                const src = DomSpec.mediaUrl(node);
                if (src) {
                    return `[音频](${HTMLToMarkdown._mdUrl(src)})\n\n`;
                }
                // wave18 共识(w3 qwen): 同 iframe/video —— 无候选地址不输出「已拒」标记
                return DomSpec.mediaSrc(node) ? "[音频已拒（非公网 http(s) 地址）]\n\n" : "";
            }
            case "div": {
                const cls = node.className || "";
                if (cls.includes("onebox")) {
                    // wave6 共识(qwen): 仅首行加 "> " 时, 子内容换行后的行会脱离 callout(可注入 Markdown)
                    // wave18 共识(w3 glm): 拆行前统一行结束符(孤立 \r 同样会断行并逃逸前缀)
                    const quoted = String(children).replace(/\r\n?/g, "\n").trim().split("\n")
                        .map((line) => `> ${line}`).join("\n");
                    return `> [!quote]\n${quoted}\n\n`;
                }
                return children;
            }
            default: return children;
        }
    },

    // wave17 共识(qwen): 块级子节点与相邻内联文本/嵌套引用之间缺行边界 ——
    // <blockquote>外<blockquote>内</blockquote></blockquote> 的子树输出为 "外> 内\n\n",
    // 外层逐行加 "> " 后得 "> 外> 内"(内层引用语法被吞); div.onebox 同族。
    // 与 Notion 出口 serializeRichText 的文本边界同口径: 沿 childNodes 拼接, 块级子节点前补换行。
    _convertChildren: (node) => {
        // wave18 共识(w3 第三模型复审): 只补「块级子节点之前」的边界仍不够 ——
        // <div><div>a</div>b</div> 输出 "ab"(块级内容与其后的文本粘连)。沿用 DOMToNotion
        // wave14 的 needBreak 延迟语义: 块级子节点后若仍拼接内容且 out 未以换行结尾, 补一个
        // 换行; 末尾不无条件补(单块子节点输出逐字节兼容)
        // wave18 共识(w3 dsf + w2 glm): 块级子节点前后此前只补**单个**换行 ——
        // ① 列表块后紧跟段落时("1. x\n" + "after")按 CommonMark 成为末个列表项的懒延续行
        // (段落被并进列表项); ② "前言" + "---" 构成 setext 二级标题(分隔线被吞);
        // ③ 相邻块级 div 被并为同一段落(软换行, 结构丢失)。统一改为块级边界处保证空行。
        let out = "";
        let needBreak = false;
        DomSpec.eachChildOrdered(node, (child) => {
            const md = HTMLToMarkdown._convertNode(child);
            if (!md) return;
            const isBlock = child.nodeType === Node.ELEMENT_NODE && child.tagName
                && DomSpec.TEXT_BOUNDARY_TAGS.has(String(child.tagName).toLowerCase());
            if ((needBreak || Boolean(isBlock)) && out && !/\n\n$/.test(out)) {
                out = out.replace(/\n?$/, "\n\n");
            }
            needBreak = Boolean(isBlock);
            out += md;
        });
        return out;
    },

    _convertTable: (table) => {
        // wave9 共识(dsf): querySelectorAll("tr") 会把嵌套表格的行列并入外层(重复/错乱)
        // —— 改为 thead/tbody/tfoot 直属行遍历(与 DOMToNotion 表格隔离同口径),
        // 无 section 时回退直属 tr(测试桩/残缺 HTML)
        const direct = (tag) => Array.from(table.children || [])
            .filter((c) => c.tagName && c.tagName.toLowerCase() === tag);
        const sections = [...direct("thead"), ...direct("tbody"), ...direct("tfoot")];
        const rows = sections.length > 0
            ? sections.flatMap((sec) => Array.from(sec.children || [])
                .filter((r) => r.tagName && r.tagName.toLowerCase() === "tr"))
            : Array.from(table.children || []).filter((r) => r.tagName && r.tagName.toLowerCase() === "tr");
        const caption = direct("caption")[0];
        // wave17 共识(dsf/qwen): <caption> 既非 thead/tbody/tfoot 也不属 tr, 此前整支丢弃 ——
        // Notion 出口已在 wave16 按同族缺陷补发段落, 此处补可见文本(表格标题, 置于表格行之前)
        const captionText = caption ? DomSpec.foldToSingleLine(HTMLToMarkdown._convertChildren(caption)).trim() : "";
        if (rows.length === 0) return captionText ? `${captionText}\n\n` : "";
        const result = [];
        if (captionText) result.push(captionText);
        rows.forEach((row, i) => {
            const cells = Array.from(row.children || [])
                .filter((c) => c.tagName && ["th", "td"].includes(c.tagName.toLowerCase()))
                .map((c) => {
                // P4 收敛(c05): 单元格内的竖线会破坏表格列结构
                // wave11 共识(qwen): 与 buildPostCallout.sanitize 同口径 —— \n 漏孤立 \r
                // (CommonMark 行结束符), 单元格文本中的 CR 会拆断表格行; 折叠口径统一驻 DomSpec
                return DomSpec.foldToSingleLine(HTMLToMarkdown._convertChildren(c)).replace(/\|/g, "\\|");
            });
            result.push(`| ${cells.join(" | ")} |`);
            if (i === 0) {
                result.push(`| ${cells.map(() => "---").join(" | ")} |`);
            }
        });
        return result.join("\n");
    },

    buildFrontmatter: (meta) => {
        const lines = ["---"];
        // P4 共识(3/3): 仅转义双引号 —— 换行/控制字符可注入任意 YAML 字段, 尾部反斜杠可吞掉闭合引号。
        const esc = (s) => String(s ?? "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/[\r\n\u2028\u2029]/g, " ")
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
        // P4 共识(qwen): 数值字段直插 —— 非数值输入可注入 YAML 片段, 数值化后再写
        // wave17 共识(glm/qwen): Number(null)/Number("")/Number([]) 均为 0、Number(true) 为 1
        // —— 缺失/空值/非数值真值被静默伪造成合法数字写进 YAML(下游按真实楼层/话题号/星数读取
        // 即得错误数据)。改为: 仅接受 number 类型或非空数字字符串, 缺失值直接省略该字段。
        const hasValue = (v) => v !== undefined && v !== null && v !== "";
        const asNumber = (value) => {
            if (typeof value === "number") return Number.isFinite(value) ? value : null;
            if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
            return null;
        };
        const numOrQuoted = (key, value) => {
            if (!hasValue(value)) return "";
            const num = asNumber(value);
            return num === null ? `${key}: "${esc(value)}"` : `${key}: ${num}`;
        };
        const pushNum = (key, value) => {
            const line = numOrQuoted(key, value);
            if (line) lines.push(line);
        };
        if (meta.title) lines.push(`title: "${esc(meta.title)}"`);
        if (meta.url) lines.push(`url: "${esc(meta.url)}"`);
        if (meta.author) lines.push(`author: "${esc(meta.author)}"`);
        if (meta.source) lines.push(`source: "${esc(meta.source)}"`);
        if (meta.sourceType) lines.push(`source_type: "${esc(meta.sourceType)}"`);
        if (meta.topicId) pushNum("topic_id", meta.topicId);
        if (meta.owner) lines.push(`owner: "${esc(meta.owner)}"`);
        if (meta.repo) lines.push(`repo: "${esc(meta.repo)}"`);
        if (meta.gistId) lines.push(`gist_id: "${esc(meta.gistId)}"`);
        if (meta.category) lines.push(`category: "${esc(meta.category)}"`);
        if (meta.language) lines.push(`language: "${esc(meta.language)}"`);
        pushNum("stars", meta.stars);
        if (meta.updatedAt) lines.push(`updated_at: "${esc(meta.updatedAt)}"`);
        // wave16 共识(qwen): meta.tags 为有 length 的非数组(如字符串)时 forEach 抛 TypeError ——
        // 整个导出中断; 按"单值数组化"降级, 不静默丢标签
        const tags = Array.isArray(meta.tags)
            ? meta.tags
            : (meta.tags != null && meta.tags !== "" ? [meta.tags] : []);
        if (tags.length > 0) {
            lines.push("tags:");
            tags.forEach((t) => lines.push(`  - "${esc(t)}"`));
        }
        lines.push(`export_time: "${new Date().toISOString()}"`);
        pushNum("floors", meta.floors);
        lines.push("---");
        return lines.join("\n") + "\n\n";
    },

    buildPostCallout: (post, index, isOp) => {
        const type = isOp ? "success" : "note";
        const collapsed = index > 0 ? "+" : "";
        // wave7 共识(qwen): username/postNum 来自用户可控数据 —— 含换行会把 callout 首行
        // 拆行逃逸引用前缀(注入 Markdown); 折叠换行后再拼入
        // wave7 共识(qwen): header 各成分折叠换行(注入防御) —— wave9 共识(glm):
        // \r?\n 漏孤立 \r(CommonMark 行结束符), 用 \r\n?|\n 全覆盖
        const sanitize = (v) => String(v ?? "").replace(/\r\n?|\n/g, " ").trim();
        const username = sanitize(post.name || post.username) || "未知";
        const handleRaw = post.username && post.username !== (post.name || post.username) ? ` (@${sanitize(post.username)})` : "";
        const handle = sanitize(handleRaw);
        const postNum = Number(post.post_number) || (index + 1);
        const date = post.created_at
            ? new Date(post.created_at).toLocaleString("zh-CN")
            : "未知时间";
        const header = `#${postNum} ${username}${handle}${isOp ? " 楼主" : ""} · ${date}`;
        const content = HTMLToMarkdown.convert(post.cooked || "");
        // wave18 共识(w3 glm): 同 blockquote/onebox —— 孤立 \r 会在渲染时断行并脱离 "> " 前缀
        const lines = content.replace(/\r\n?/g, "\n").trim().split("\n");
        const quoted = lines.map((l) => `> ${l}`).join("\n");
        return `> [!${type}]${collapsed} ${header}\n${quoted}\n> ^floor-${postNum}\n\n`;
    },
};

module.exports = { ObsidianAPI, HTMLToMarkdown };
