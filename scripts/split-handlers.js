"use strict";
// TASK-005 辅助脚本：程序化拆分 Handlers.js 为 4 个域文件 + shell
// 运行: node scripts/split-handlers.js
// 安全保证：原文件备份到 .backups/，拆分后跑测试验证

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "ai", "Handlers.js");
const OUT_DIR = path.join(__dirname, "..", "src", "ai", "handlers");
const BACKUP_DIR = path.join(__dirname, "..", ".workflow", "scratch", "20260731-plan-P1-ai-domain-refactor", ".backups");

// 域分配表：handler name → domain file
const DOMAIN_MAP = {
    // query.js
    handleQuery: "query",
    handleSearch: "query",
    handleWorkspaceSearch: "query",
    // pageCrud.js
    handleUpdate: "pageCrud",
    _resolveDatabaseId: "pageCrud",
    _fetchSourcePages: "pageCrud",
    handleMove: "pageCrud",
    handleCopy: "pageCrud",
    handleCompound: "pageCrud",
    handleCreateDatabase: "pageCrud",
    // content.js
    _resolvePageId: "content",
    _extractPageContent: "content",
    handleWriteContent: "content",
    handleEditContent: "content",
    handleTranslateContent: "content",
    _ensureAIProperty: "content",
    handleAIAutofill: "content",
    handleAsk: "content",
    handleDeepResearch: "content",
    handleSummarize: "content",
    handleBrainstorm: "content",
    handleProofread: "content",
    handleTemplateOutput: "content",
    // batch.js
    handleClassify: "batch",
    handleBatchClassify: "batch",
    handleBatchTranslate: "batch",
    handleExtractToDatabase: "batch",
    handleGeneratePages: "batch",
    handleBatchAnalyze: "batch",
    handleGitHubImport: "batch",
    handleBookmarkImport: "batch",
};

const HEADER = `"use strict";

// handlers/{domain}.js — {desc}（TASK-005, P5_handler_split）。
// 从 Handlers.js 程序化提取，逻辑零修改。

const { CONFIG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage } = require("../../storage");
const { TargetState } = require("../../auth");
const { NotionAPI } = require("../../api");
const { OperationGuard, ConfirmationDialog, UndoManager } = require("../../security");
const { AISchema } = require("../schema");
const { BlockConverter } = require("../BlockConverter");
const { NameResolver } = require("../NameResolver");
const { AgentTrace } = require("../AgentTrace");
const { getAI: AI, getState: state, getService: svc } = require("../deps");

module.exports = {
`;

const DOMAIN_DESC = {
    query: "查询与搜索类 handler",
    pageCrud: "页面 CRUD 与数据库操作类 handler",
    content: "内容读写与 AI 生成类 handler",
    batch: "批量操作与导入类 handler",
};

function main() {
    const content = fs.readFileSync(SRC, "utf8");
    const lines = content.split("\n");

    // 找到所有 handler 起始行（0-based）
    const handlerStarts = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(handle\w+|_\w+):\s*async/);
        if (m) handlerStarts.push({ name: m[1], startLine: i });
    }

    // 找到 AIHandlers 对象的结束行（最后的 };）
    const endLine = lines.length - 1; // module.exports 行之前

    // 按域分组提取
    const domains = { query: [], pageCrud: [], content: [], batch: [] };

    for (let idx = 0; idx < handlerStarts.length; idx++) {
        const { name, startLine } = handlerStarts[idx];
        const nextStart = idx + 1 < handlerStarts.length ? handlerStarts[idx + 1].startLine : null;

        // 找到这个 handler 的结束行：下一个 handler 开始前的最后一个非空行
        let endIdx = nextStart !== null ? nextStart - 1 : endLine;
        // 回退跳过空行
        while (endIdx > startLine && lines[endIdx].trim() === "") endIdx--;

        const domain = DOMAIN_MAP[name];
        if (!domain) {
            console.warn(`WARNING: handler "${name}" not in DOMAIN_MAP, skipping`);
            continue;
        }

        // 提取 handler 代码（包含末尾逗号）
        const handlerLines = lines.slice(startLine, endIdx + 1);
        domains[domain].push(handlerLines.join("\n"));
    }

    // 确保输出目录存在
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // 备份原文件
    fs.copyFileSync(SRC, path.join(BACKUP_DIR, "Handlers.js.bak"));
    console.log("Backup created:", path.join(BACKUP_DIR, "Handlers.js.bak"));

    // 写入 4 个域文件
    for (const [domain, handlers] of Object.entries(domains)) {
        const header = HEADER.replace("{domain}", domain).replace("{desc}", DOMAIN_DESC[domain]);
        const body = handlers.join("\n\n");
        const footer = "\n};\n";
        const filePath = path.join(OUT_DIR, `${domain}.js`);
        fs.writeFileSync(filePath, header + body + footer, "utf8");
        console.log(`Written: ${filePath} (${handlers.length} handlers)`);
    }

    // 生成 shell Handlers.js
    const shell = `"use strict";

// Handlers.js — AI 意图执行处理器 shell（TASK-005, P5_handler_split）。
// 原 2277 行巨石已拆分为 4 个域文件，本文件仅做 spread merge。
// Object.assign(AIAssistant, AIHandlers) 在 ai/index.js 中保留不变（ARCH-001 mixin 语义）。

const { handleQuery, handleSearch, handleWorkspaceSearch } = require("./handlers/query");
const { handleUpdate, _resolveDatabaseId, _fetchSourcePages, handleMove, handleCopy, handleCompound, handleCreateDatabase } = require("./handlers/pageCrud");
const { _resolvePageId, _extractPageContent, handleWriteContent, handleEditContent, handleTranslateContent, _ensureAIProperty, handleAIAutofill, handleAsk, handleDeepResearch, handleSummarize, handleBrainstorm, handleProofread, handleTemplateOutput } = require("./handlers/content");
const { handleClassify, handleBatchClassify, handleBatchTranslate, handleExtractToDatabase, handleGeneratePages, handleBatchAnalyze, handleGitHubImport, handleBookmarkImport } = require("./handlers/batch");

const AIHandlers = {
    handleQuery,
    handleSearch,
    handleWorkspaceSearch,
    handleUpdate,
    _resolveDatabaseId,
    _fetchSourcePages,
    handleMove,
    handleCopy,
    handleCompound,
    handleCreateDatabase,
    _resolvePageId,
    _extractPageContent,
    handleWriteContent,
    handleEditContent,
    handleTranslateContent,
    _ensureAIProperty,
    handleAIAutofill,
    handleAsk,
    handleDeepResearch,
    handleSummarize,
    handleBrainstorm,
    handleProofread,
    handleTemplateOutput,
    handleClassify,
    handleBatchClassify,
    handleBatchTranslate,
    handleExtractToDatabase,
    handleGeneratePages,
    handleBatchAnalyze,
    handleGitHubImport,
    handleBookmarkImport,
};

module.exports = { AIHandlers };
`;
    fs.writeFileSync(SRC, shell, "utf8");
    console.log("Shell written:", SRC);
    console.log("\nDone! Run 'npx vitest run' to verify.");
}

main();
