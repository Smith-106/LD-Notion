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
            let idx = 1;
            DomSpec.eachChildOrdered(node, (child) => {
                const isLi = child.nodeType === Node.ELEMENT_NODE
                    && child.tagName.toLowerCase() === "li";
                if (!isLi) {
                    items.push(HTMLToMarkdown._convertNode(child));
                    return;
                }
                // P4 收敛(c05 2/3): li 分支已输出 "- " 前缀 —— 有序列表需剥离, 否则 "1. - x"
                const md = HTMLToMarkdown._convertNode(child).trim().replace(/^-\s+/, "");
                items.push(`${idx}. ${md}\n`);
                idx++;
            });
            return items.join("") + "\n";
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
            // wave12 共识(glm): 代码围栏不做空白折叠 —— \s+\n → \n 会删掉围栏内的空行
            // 与行尾空白(代码内容被篡改), 围栏自身成段原样推入
            const flushBuf = () => {
                pushText(buf.replace(/\s+\n/g, "\n").trim());
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
                    if (/^\s*`{3,}/.test(md)) {
                        flushBuf();
                        pushText(md.replace(/^\n+|\n+$/g, ""));
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

    _convertNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || "";
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const tag = node.tagName.toLowerCase();

        // wave10 共识(dsf): 这三个分支自行转换子树, 前置返回避免重复转换(见 _convertNodeBranch)
        if (tag === "li" || tag === "ol" || tag === "table") {
            return HTMLToMarkdown._convertNodeBranch(node, tag);
        }

        // wave11 共识(glm): script/style/noscript 非渲染元素 —— 其文本内容(JS/CSS 源码)
        // 经 default 原样并入导出正文, 污染笔记。判据统一驻 DomSpec.SKIP_TAGS, 且置于
        // _convertChildren 之前(源码不必先转换再丢弃)
        if (DomSpec.isSkippedNode(node)) return "";

        const children = HTMLToMarkdown._convertChildren(node);

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
            case "strong": case "b": return `**${children}**`;
            case "em": case "i": return `*${children}*`;
            case "del": case "s": return `~~${children}~~`;
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
                const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || "";
                // wave14 共识(glm): 只取 code 元素会丢掉 pre 内其余文本(<pre>foo<code>bar</code></pre>);
                // 改用整块 textContent, 并按 HTML 规范去掉 <pre> 紧随的首个换行
                const text = String(node.textContent || "").replace(/^\n/, "");
                // P4 共识(glm): 内容含 ``` 会提前闭合围栏 —— 用比最长反引号串更长的围栏
                const longestRun = (String(text).match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0);
                const fence = "`".repeat(Math.max(3, longestRun + 1));
                return fence + lang + "\n" + text + "\n" + fence + "\n\n";
            }
            case "blockquote": {
                const lines = children.trim().split("\n");
                return lines.map((l) => `> ${l}`).join("\n") + "\n\n";
            }
            case "a": {
                const href = node.getAttribute("href") || "";
                // wave9 共识(dsf): 协议判断不区分大小写(HTTP:// 不再降级纯文本)
                if (href.toLowerCase().startsWith("http")) return `[${HTMLToMarkdown._mdText(children)}](${HTMLToMarkdown._mdUrl(href)})`;
                return children;
            }
            case "img": {
                const src = DomSpec.mediaSrc(node);
                const alt = node.getAttribute("alt") || "";
                // wave9 共识(qwen): src 仅放行 http(s) 公网地址(javascript:/data:/内网 拒绝)
                if (src && UrlValidator.validatePageExternalUrl(src)) {
                    return `![${HTMLToMarkdown._mdText(alt)}](${HTMLToMarkdown._mdUrl(src)})`;
                }
                return HTMLToMarkdown._mdText(alt || "");
            }
            case "ul": return children;
            case "iframe": {
                const src = DomSpec.mediaSrc(node);
                // wave9 共识(qwen): src 仅放行 http(s) 公网地址(javascript:/data:/内网 拒绝)
                const safeSrc = String(src || "");
                if (safeSrc && UrlValidator.validatePageExternalUrl(safeSrc)) {
                    return `[嵌入内容](${HTMLToMarkdown._mdUrl(safeSrc)})\n\n`;
                }
                return "[嵌入内容已拒（非公网 http(s) 地址）]\n\n";
            }
            case "video": {
                const src = DomSpec.mediaSrc(node);
                // wave9 共识(qwen): 同 img —— 非公网 http(s) 不生成链接
                if (String(src || "") && UrlValidator.validatePageExternalUrl(String(src))) {
                    return `[视频](${HTMLToMarkdown._mdUrl(src)})\n\n`;
                }
                return "[视频已拒（非公网 http(s) 地址）]\n\n";
            }
            case "audio": {
                // wave13 共识(dsf): 与 video 同口径 —— 仅有 <source src> 子元素时不再误判"已拒"
                const src = DomSpec.mediaSrc(node);
                if (String(src || "") && UrlValidator.validatePageExternalUrl(String(src))) {
                    return `[音频](${HTMLToMarkdown._mdUrl(src)})\n\n`;
                }
                return "[音频已拒（非公网 http(s) 地址）]\n\n";
            }
            case "div": {
                const cls = node.className || "";
                if (cls.includes("onebox")) {
                    // wave6 共识(qwen): 仅首行加 "> " 时, 子内容换行后的行会脱离 callout(可注入 Markdown)
                    const quoted = String(children).trim().split("\n")
                        .map((line) => `> ${line}`).join("\n");
                    return `> [!quote]\n${quoted}\n\n`;
                }
                return children;
            }
            default: return children;
        }
    },

    _convertChildren: (node) => {
        let out = "";
        DomSpec.eachChildOrdered(node, (child) => { out += HTMLToMarkdown._convertNode(child); });
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
        if (rows.length === 0) return "";
        const result = [];
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
        const numOrQuoted = (key, value) => {
            const num = Number(value);
            return Number.isFinite(num) ? `${key}: ${num}` : `${key}: "${esc(value)}"`;
        };
        if (meta.title) lines.push(`title: "${esc(meta.title)}"`);
        if (meta.url) lines.push(`url: "${esc(meta.url)}"`);
        if (meta.author) lines.push(`author: "${esc(meta.author)}"`);
        if (meta.source) lines.push(`source: "${esc(meta.source)}"`);
        if (meta.sourceType) lines.push(`source_type: "${esc(meta.sourceType)}"`);
        if (meta.topicId) lines.push(numOrQuoted("topic_id", meta.topicId));
        if (meta.owner) lines.push(`owner: "${esc(meta.owner)}"`);
        if (meta.repo) lines.push(`repo: "${esc(meta.repo)}"`);
        if (meta.gistId) lines.push(`gist_id: "${esc(meta.gistId)}"`);
        if (meta.category) lines.push(`category: "${esc(meta.category)}"`);
        if (meta.language) lines.push(`language: "${esc(meta.language)}"`);
        if (Number.isFinite(Number(meta.stars))) lines.push(`stars: ${Number(meta.stars)}`);
        if (meta.updatedAt) lines.push(`updated_at: "${esc(meta.updatedAt)}"`);
        if (meta.tags && meta.tags.length > 0) {
            lines.push("tags:");
            meta.tags.forEach((t) => lines.push(`  - "${esc(t)}"`));
        }
        lines.push(`export_time: "${new Date().toISOString()}"`);
        if (meta.floors !== undefined) lines.push(numOrQuoted("floors", meta.floors));
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
        const lines = content.trim().split("\n");
        const quoted = lines.map((l) => `> ${l}`).join("\n");
        return `> [!${type}]${collapsed} ${header}\n${quoted}\n> ^floor-${postNum}\n\n`;
    },
};

module.exports = { ObsidianAPI, HTMLToMarkdown };
