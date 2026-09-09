"use strict";

const { UrlValidator } = require("../security/UrlValidator");
const { Utils } = require("../utils");

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
    _mdText: (s) => String(s ?? "").replace(/[\[\]]/g, ""),
    _mdUrl: (s) => Utils.mdUrl(s),

    convert: (html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return HTMLToMarkdown._convertNode(doc.body);
    },

    _convertNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || "";
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const tag = node.tagName.toLowerCase();
        const children = HTMLToMarkdown._convertChildren(node);

        switch (tag) {
            case "h1": return `# ${children}\n\n`;
            case "h2": return `## ${children}\n\n`;
            case "h3": return `### ${children}\n\n`;
            case "h4": return `#### ${children}\n\n`;
            case "h5": return `##### ${children}\n\n`;
            case "h6": return `###### ${children}\n\n`;
            case "p": return `${children}\n\n`;
            case "br": return "\n";
            case "hr": return "---\n\n";
            case "strong": case "b": return `**${children}**`;
            case "em": case "i": return `*${children}*`;
            case "del": case "s": return `~~${children}~~`;
            case "code": {
                const parent = node.parentElement;
                if (parent && parent.tagName.toLowerCase() === "pre") return children;
                return `\`${children}\``;
            }
            case "pre": {
                const codeEl = node.querySelector("code");
                const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || "";
                const text = codeEl ? codeEl.textContent : node.textContent;
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
                if (href.startsWith("http")) return `[${HTMLToMarkdown._mdText(children)}](${HTMLToMarkdown._mdUrl(href)})`;
                return children;
            }
            case "img": {
                const src = node.getAttribute("src") || "";
                const alt = node.getAttribute("alt") || "";
                return `![${HTMLToMarkdown._mdText(alt)}](${HTMLToMarkdown._mdUrl(src)})`;
            }
            case "ul": return children;
            case "ol": {
                const items = node.querySelectorAll(":scope > li");
                let idx = 1;
                return Array.from(items).map((li) => {
                    // P4 收敛(c05 2/3): li 分支已输出 "- " 前缀 —— 有序列表需剥离, 否则 "1. - x"
                    const md = HTMLToMarkdown._convertNode(li).trim().replace(/^-\s+/, "");
                    const result = `${idx}. ${md}\n`;
                    idx++;
                    return result;
                }).join("") + "\n";
            }
            case "li": return `- ${children}\n`;
            case "table": return HTMLToMarkdown._convertTable(node) + "\n\n";
            case "iframe": {
                const src = node.getAttribute("src") || "";
                return `[嵌入内容](${HTMLToMarkdown._mdUrl(src)})\n\n`;
            }
            case "video": {
                const src = node.getAttribute("src") || node.querySelector("source")?.getAttribute("src") || "";
                return `[视频](${HTMLToMarkdown._mdUrl(src)})\n\n`;
            }
            case "audio": {
                const src = node.getAttribute("src") || "";
                return `[音频](${HTMLToMarkdown._mdUrl(src)})\n\n`;
            }
            case "div": {
                const cls = node.className || "";
                if (cls.includes("onebox")) {
                    return `> [!quote]\n> ${children.trim()}\n\n`;
                }
                return children;
            }
            default: return children;
        }
    },

    _convertChildren: (node) => {
        return Array.from(node.childNodes).map(HTMLToMarkdown._convertNode).join("");
    },

    _convertTable: (table) => {
        const rows = table.querySelectorAll("tr");
        if (rows.length === 0) return "";
        const result = [];
        rows.forEach((row, i) => {
            const cells = Array.from(row.querySelectorAll("th, td")).map((c) => {
                // P4 收敛(c05): 单元格内的竖线会破坏表格列结构
                return HTMLToMarkdown._convertChildren(c).replace(/\n/g, " ").replace(/\|/g, "\\|").trim();
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
        const username = post.name || post.username || "未知";
        const handle = post.username && post.username !== username ? ` (@${post.username})` : "";
        const postNum = post.post_number || (index + 1);
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
