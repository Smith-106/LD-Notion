"use strict";

// BlockConverter — markdown/文本 与 Notion block 之间的双向转换。
// ISS-20260723-010 W4 (MAINT-005/006): 从 ai/index.js 提取 _textToBlocks(3453) +
// _buildBlockUpdatePayload(5515) 到独立模块，消除 9 处跨块调用耦合（AI_AGENT_TOOLS +
// AIHandlers 共用）。纯数据转换，无 ChatState/外部状态依赖。
// AIAssistant 上保留转发壳 (_textToBlocks/_buildBlockUpdatePayload) 保持 38 处调用点零改动。

const { Utils } = require("../utils");

const BlockConverter = {
    // markdown 文本 → Notion blocks 数组
    textToBlocks: (text) => {
        const blocks = [];
        const lines = text.split("\n");
        let inCodeBlock = false;
        let codeLines = [];
        let codeLang = "plain text";

        // Notion 接受的代码语言映射（常见缩写 → Notion 标准名）
        const LANG_MAP = {
            js: "javascript", ts: "typescript", py: "python", rb: "ruby",
            sh: "shell", bash: "shell", zsh: "shell", yml: "yaml",
            md: "markdown", cs: "c#", cpp: "c++", objc: "objective-c",
            kt: "kotlin", rs: "rust", go: "go", java: "java",
            html: "html", css: "css", json: "json", xml: "xml",
            sql: "sql", r: "r", swift: "swift", scala: "scala",
            php: "php", perl: "perl", lua: "lua", dart: "dart",
            dockerfile: "docker", makefile: "makefile", toml: "toml",
            graphql: "graphql", protobuf: "protobuf", sass: "sass",
            scss: "scss", less: "less", jsx: "javascript", tsx: "typescript",
        };
        const NOTION_LANGS = new Set([
            "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript",
            "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm",
            "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql",
            "groovy", "haskell", "html", "java", "javascript", "json", "julia",
            "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile",
            "markdown", "markup", "matlab", "mermaid", "nix", "objective-c",
            "ocaml", "pascal", "perl", "php", "plain text", "powershell",
            "prolog", "protobuf", "python", "r", "reason", "ruby", "rust",
            "sass", "scala", "scheme", "scss", "shell", "sql", "swift",
            "typescript", "vb.net", "verilog", "vhdl", "visual basic",
            "webassembly", "xml", "yaml", "java/c/c++/c#",
        ]);
        const normalizeLanguage = (lang) => {
            const lower = (lang || "").toLowerCase().trim();
            if (!lower) return "plain text";
            if (LANG_MAP[lower]) return LANG_MAP[lower];
            if (NOTION_LANGS.has(lower)) return lower;
            return "plain text";
        };

        const splitLongText = (str) => {
            const maxLen = 2000;
            const chunks = [];
            if (str.length <= maxLen) {
                chunks.push({ type: "text", text: { content: str } });
            } else {
                let remaining = str;
                while (remaining.length > 0) {
                    chunks.push({ type: "text", text: { content: remaining.substring(0, maxLen) } });
                    remaining = remaining.substring(maxLen);
                }
            }
            return chunks;
        };

        for (const line of lines) {
            // 代码块处理
            if (line.startsWith("```")) {
                if (inCodeBlock) {
                    const code = codeLines.join("\n");
                    blocks.push({
                        type: "code",
                        code: { rich_text: splitLongText(code), language: codeLang }
                    });
                    codeLines = [];
                    inCodeBlock = false;
                } else {
                    inCodeBlock = true;
                    codeLang = normalizeLanguage(line.slice(3).trim());
                }
                continue;
            }

            if (inCodeBlock) {
                codeLines.push(line);
                continue;
            }

            // 空行跳过
            if (!line.trim()) continue;

            // 标题
            if (line.startsWith("### ")) {
                blocks.push({ type: "heading_3", heading_3: { rich_text: splitLongText(line.slice(4)) } });
            } else if (line.startsWith("## ")) {
                blocks.push({ type: "heading_2", heading_2: { rich_text: splitLongText(line.slice(3)) } });
            } else if (line.startsWith("# ")) {
                blocks.push({ type: "heading_1", heading_1: { rich_text: splitLongText(line.slice(2)) } });
            }
            // 分割线
            else if (line.trim() === "---" || line.trim() === "***") {
                blocks.push({ type: "divider", divider: {} });
            }
            // 引用
            else if (line.startsWith("> ")) {
                blocks.push({ type: "quote", quote: { rich_text: splitLongText(line.slice(2)) } });
            }
            // 无序列表
            else if (/^[-*]\s/.test(line)) {
                blocks.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: splitLongText(line.replace(/^[-*]\s/, "")) } });
            }
            // 有序列表
            else if (/^\d+\.\s/.test(line)) {
                blocks.push({ type: "numbered_list_item", numbered_list_item: { rich_text: splitLongText(line.replace(/^\d+\.\s/, "")) } });
            }
            // 普通段落
            else {
                blocks.push({ type: "paragraph", paragraph: { rich_text: splitLongText(line) } });
            }
        }

        // 处理未闭合的代码块
        if (inCodeBlock && codeLines.length > 0) {
            const code = codeLines.join("\n");
            blocks.push({
                type: "code",
                code: { rich_text: splitLongText(code), language: codeLang }
            });
        }

        return blocks;
    },

    // Notion block + 新内容 → 更新 payload（按 block 类型分发）
    buildBlockUpdatePayload: (block, content, options = {}) => {
        if (!block || !block.type) {
            throw new Error("无法识别块类型");
        }

        const rawContent = String(content || "");
        const richText = [{ type: "text", text: { content: String(content || "") } }];
        const type = block.type;
        const current = block[type] || {};

        switch (type) {
            case "paragraph":
            case "heading_1":
            case "heading_2":
            case "heading_3":
            case "bulleted_list_item":
            case "numbered_list_item":
            case "quote":
            case "toggle":
                return {
                    [type]: {
                        ...current,
                        rich_text: richText,
                        color: options.color || current.color,
                    }
                };
            case "to_do":
                return {
                    to_do: {
                        ...current,
                        rich_text: richText,
                        checked: typeof options.checked === "boolean" ? options.checked : !!current.checked,
                        color: options.color || current.color,
                    }
                };
            case "callout":
                return {
                    callout: {
                        ...current,
                        rich_text: richText,
                        icon: options.icon || current.icon,
                        color: options.color || current.color,
                    }
                };
            case "code":
                return {
                    code: {
                        ...current,
                        rich_text: richText,
                        caption: Array.isArray(current.caption) ? current.caption : [],
                        language: current.language || "plain text",
                    }
                };
            case "template":
                return {
                    template: {
                        ...current,
                        rich_text: richText,
                    }
                };
            case "equation":
                return {
                    equation: {
                        ...current,
                        expression: rawContent,
                    }
                };
            case "bookmark":
                if (!Utils.isHttpUrl(rawContent)) {
                    throw new Error("bookmark 块仅支持更新为 http/https URL。");
                }
                return {
                    bookmark: {
                        ...current,
                        url: rawContent,
                        caption: Array.isArray(current.caption) ? current.caption : [],
                    }
                };
            case "embed":
                if (!Utils.isHttpUrl(rawContent)) {
                    throw new Error("embed 块仅支持更新为 http/https URL。");
                }
                return {
                    embed: {
                        ...current,
                        url: rawContent,
                        caption: Array.isArray(current.caption) ? current.caption : [],
                    }
                };
            case "link_preview":
                throw new Error("link_preview 块是 Notion API 的只读返回类型，不能直接更新；请改用 bookmark 或 embed 块。");
            case "table_row":
                throw new Error("table_row 块当前无法通过单一 content 参数安全更新单元格；请改用页面 Markdown 编辑或重新插入表格行。");
            default:
                throw new Error(`暂不支持更新块类型「${type}」`);
        }
    },
};

module.exports = { BlockConverter };
