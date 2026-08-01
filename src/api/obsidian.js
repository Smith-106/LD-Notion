"use strict";

const { UrlValidator } = require("../security/UrlValidator");

const ObsidianAPI = {
    testConnection: async (apiUrl, apiKey) => {
        if (!UrlValidator.validateObsidianUrl(apiUrl)) {
            return { ok: false, error: "Obsidian API URL 安全校验失败：仅允许本地地址 (127.0.0.1/localhost)" };
        }
        const resp = await new Promise((resolve, reject) => {
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
        if (resp.status === 200 || resp.status === 204) return { ok: true };
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },

    writeNote: async (apiUrl, apiKey, path, content) => {
        if (!UrlValidator.validateObsidianUrl(apiUrl)) {
            return { ok: false, error: "Obsidian API URL 安全校验失败：仅允许本地地址 (127.0.0.1/localhost)" };
        }
        const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "PUT",
                url: `${apiUrl}/vault/${encodeURIComponent(path)}`,
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
        if (resp.status === 200 || resp.status === 204 || resp.status === 201) {
            return { ok: true };
        }
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },

    writeImage: async (apiUrl, apiKey, path, blob, contentType) => {
        if (!UrlValidator.validateObsidianUrl(apiUrl)) {
            return { ok: false, error: "Obsidian API URL 安全校验失败：仅允许本地地址 (127.0.0.1/localhost)" };
        }
        const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "PUT",
                url: `${apiUrl}/vault/${encodeURIComponent(path)}`,
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
        if (resp.status === 200 || resp.status === 204 || resp.status === 201) {
            return { ok: true };
        }
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    },
};


const HTMLToMarkdown = {
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
                return "```" + lang + "\n" + text + "\n```\n\n";
            }
            case "blockquote": {
                const lines = children.trim().split("\n");
                return lines.map((l) => `> ${l}`).join("\n") + "\n\n";
            }
            case "a": {
                const href = node.getAttribute("href") || "";
                if (href.startsWith("http")) return `[${children}](${href})`;
                return children;
            }
            case "img": {
                const src = node.getAttribute("src") || "";
                const alt = node.getAttribute("alt") || "";
                return `![${alt}](${src})`;
            }
            case "ul": return children;
            case "ol": {
                const items = node.querySelectorAll(":scope > li");
                let idx = 1;
                return Array.from(items).map((li) => {
                    const md = HTMLToMarkdown._convertNode(li).trim();
                    const result = `${idx}. ${md}\n`;
                    idx++;
                    return result;
                }).join("") + "\n";
            }
            case "li": return `- ${children}\n`;
            case "table": return HTMLToMarkdown._convertTable(node) + "\n\n";
            case "iframe": {
                const src = node.getAttribute("src") || "";
                return `[嵌入内容](${src})\n\n`;
            }
            case "video": {
                const src = node.getAttribute("src") || node.querySelector("source")?.getAttribute("src") || "";
                return `[视频](${src})\n\n`;
            }
            case "audio": {
                const src = node.getAttribute("src") || "";
                return `[音频](${src})\n\n`;
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
                return HTMLToMarkdown._convertChildren(c).replace(/\n/g, " ").trim();
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
        const esc = (s) => String(s || "").replace(/"/g, '\\"');
        if (meta.title) lines.push(`title: "${esc(meta.title)}"`);
        if (meta.url) lines.push(`url: "${esc(meta.url)}"`);
        if (meta.author) lines.push(`author: "${esc(meta.author)}"`);
        if (meta.source) lines.push(`source: "${esc(meta.source)}"`);
        if (meta.sourceType) lines.push(`source_type: "${esc(meta.sourceType)}"`);
        if (meta.topicId) lines.push(`topic_id: ${meta.topicId}`);
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
        if (meta.floors !== undefined) lines.push(`floors: ${meta.floors}`);
        lines.push("---");
        return lines.join("\n") + "\n\n";
    },

    buildPostCallout: (post, index, isOp) => {
        const type = isOp ? "success" : "note";
        const collapsed = index > 0 ? "+" : "";
        const username = post.username || "未知";
        const postNum = post.post_number || (index + 1);
        const date = post.created_at
            ? new Date(post.created_at).toLocaleString("zh-CN")
            : "未知时间";
        const header = `#${postNum} ${username}${post.username ? ` (@${post.username})` : ""}${isOp ? " 楼主" : ""} · ${date}`;
        const content = HTMLToMarkdown.convert(post.cooked || "");
        const lines = content.trim().split("\n");
        const quoted = lines.map((l) => `> ${l}`).join("\n");
        return `> [!${type}]${collapsed} ${header}\n${quoted}\n> ^floor-${postNum}\n\n`;
    },
};

module.exports = { ObsidianAPI, HTMLToMarkdown };
