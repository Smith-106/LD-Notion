"use strict";
// TASK-006 辅助脚本：程序化拆分 AgentTools.js 为 3 个域文件 + shell
// 运行: node scripts/split-agent-tools.js

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "ai", "AgentTools.js");
const OUT_DIR = path.join(__dirname, "..", "src", "ai", "tools");
const BACKUP_DIR = path.join(__dirname, "..", ".workflow", "scratch", "20260731-plan-P1-ai-domain-refactor", ".backups");

// 域分配：tool name → domain
const READ_TOOLS = new Set([
    "search_workspace", "fetch_notion_object", "fetch_page_blocks", "get_comment",
    "query_database", "get_page_content", "fetch_page_markdown", "get_database_schema",
    "get_comments", "list_workspace_users", "get_current_user", "get_workspace_user",
    "cross_source_search", "unified_stats", "recommend_similar"
]);
const WRITE_TOOLS = new Set([
    "batch_tag", "append_content", "append_block_children", "search_replace_page_markdown",
    "replace_page_markdown", "create_comment", "update_page_property", "create_page",
    "batch_create_pages", "update_page_metadata", "update_page", "batch_update_pages",
    "update_block_content", "classify_pages", "move_page", "copy_page",
    "archive_page", "restore_page", "create_database"
]);
const META_TOOLS = new Set([
    "research_report", "generate_formula", "summarize_page", "brainstorm_ideas",
    "proofread_content", "batch_translate_database", "extract_to_database",
    "generate_structured_pages", "batch_analyze_pages"
]);

const HEADER = `"use strict";

// tools/{domain}-tools.js — {desc}（TASK-006, P6_agenttools_split）。
// 从 AgentTools.js 程序化提取，逻辑零修改。

const { CONFIG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage } = require("../../storage");
const { TargetState } = require("../../auth");
const { NotionAPI } = require("../../api");
const { OperationGuard } = require("../../security");
const { getAI: AI, getService: svc } = require("../deps");

module.exports = {
`;

const DOMAIN_DESC = {
    read: "只读查询类工具（Level 0）",
    write: "写入操作类工具（Level 1-2）",
    meta: "元转发类工具（委托 intent 执行）",
};

function main() {
    const content = fs.readFileSync(SRC, "utf8");
    const lines = content.split("\n");

    // 找到所有 tool 起始行（4 空格缩进的 key: { 模式）
    const toolStarts = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^    (\w+): \{/);
        if (m) toolStarts.push({ name: m[1], startLine: i });
    }

    console.log(`Found ${toolStarts.length} tools`);

    // 按域分组
    const domains = { read: [], write: [], meta: [] };

    for (let idx = 0; idx < toolStarts.length; idx++) {
        const { name, startLine } = toolStarts[idx];
        const nextStart = idx + 1 < toolStarts.length ? toolStarts[idx + 1].startLine : null;

        // 找到 tool 结束：下一个 tool 开始前的最后非空行
        let endIdx = nextStart !== null ? nextStart - 1 : lines.length - 1;
        while (endIdx > startLine && lines[endIdx].trim() === "") endIdx--;

        // 去掉尾部多余的分号/闭合（原始文件最后的 }; 和 module.exports）
        const lastLine = lines[endIdx].trim();
        if (lastLine === "};" || lastLine.startsWith("module.exports")) {
            endIdx--;
            while (endIdx > startLine && lines[endIdx].trim() === "") endIdx--;
        }

        let domain;
        if (READ_TOOLS.has(name)) domain = "read";
        else if (WRITE_TOOLS.has(name)) domain = "write";
        else if (META_TOOLS.has(name)) domain = "meta";
        else {
            console.warn(`WARNING: tool "${name}" not classified, putting in meta`);
            domain = "meta";
        }

        const toolLines = lines.slice(startLine, endIdx + 1);
        domains[domain].push(toolLines.join("\n"));
    }

    // 确保目录存在
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // 备份
    fs.copyFileSync(SRC, path.join(BACKUP_DIR, "AgentTools.js.bak"));
    console.log("Backup:", path.join(BACKUP_DIR, "AgentTools.js.bak"));

    // 写入 3 个域文件
    for (const [domain, tools] of Object.entries(domains)) {
        const header = HEADER.replace("{domain}", domain).replace("{desc}", DOMAIN_DESC[domain]);
        const body = tools.join("\n\n");
        const footer = "\n};\n";
        const filePath = path.join(OUT_DIR, `${domain}-tools.js`);
        fs.writeFileSync(filePath, header + body + footer, "utf8");
        console.log(`Written: ${filePath} (${tools.length} tools)`);
    }

    // 生成 shell AgentTools.js
    const readNames = [...READ_TOOLS];
    const writeNames = [...WRITE_TOOLS];
    const metaNames = [...META_TOOLS];

    const shell = `"use strict";

// AgentTools.js — AI Agent 工具注册表 shell（TASK-006, P6_agenttools_split）。
// 原 1712 行巨石已拆分为 3 个域文件，本文件仅做 spread merge。
// AI_AGENT_TOOLS 注册表键名不变，agent-executor.js 消费者零改动。

const readTools = require("./tools/read-tools");
const writeTools = require("./tools/write-tools");
const metaTools = require("./tools/meta-tools");

const AI_AGENT_TOOLS = {
    ...readTools,
    ...writeTools,
    ...metaTools,
};

module.exports = { AI_AGENT_TOOLS };
`;
    fs.writeFileSync(SRC, shell, "utf8");
    console.log("Shell written:", SRC);
    console.log("\nDone! Run 'npx vitest run' to verify.");
}

main();
