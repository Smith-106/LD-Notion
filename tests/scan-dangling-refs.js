// 扫描游离引用:符号被引用但未在 require 解构中
// 用法: node tests/scan-dangling-refs.js
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "src");

// 已知的模块导出符号 → 定义文件(用于判断符号属于哪个模块)
// 从各模块的 module.exports 收集
const moduleExports = {}; // symbol -> modulePath (相对 src)
function collectExports(file) {
    const content = fs.readFileSync(file, "utf8");
    // 匹配 module.exports = { A, B, C } 或 { A: ..., B, ... }
    const exportMatches = content.match(/module\.exports\s*=\s*\{([^}]*)\}/);
    if (!exportMatches) return;
    const symbols = new Set();
    // 提取标识符: "Name:" 或 "Name," 或 "Name}"
    const re = /\b([A-Z][A-Za-z0-9_]*)\s*[:,}]/g;
    let m;
    while ((m = re.exec(exportMatches[1])) !== null) symbols.add(m[1]);
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    for (const s of symbols) moduleExports[s] = rel;
}

function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js")) collectExports(p);
    }
}
walk(SRC);

// 对每个源文件:找 require("../X") 解构集 + 文件内引用的导出符号
const issues = [];
function localDecls(content) {
    const s = new Set();
    const re = /\b(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(content)) !== null) s.add(m[1]);
    return s;
}

function scanFile(file) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    // 收集所有 require 解构的符号
    const imported = new Set();
    // require("../X") 解构: const { A, B } = require("../X");
    const requireRe = /const\s*\{([^}]*)\}\s*=\s*require\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g;
    let rm;
    while ((rm = requireRe.exec(content)) !== null) {
        const syms = rm[1].split(",").map(s => s.trim()).filter(Boolean);
        syms.forEach(s => imported.add(s));
    }
    // 文件内引用的已知导出符号(大写开头,排除注释行/本文件声明/同文件导出)
    const local = localDecls(content);
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    const referenced = new Set();
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        const re = /\b([A-Z][A-Za-z0-9_]*)\b/g;
        let m;
        while ((m = re.exec(line)) !== null) {
            const sym = m[1];
            if (!moduleExports[sym]) continue;
            if (imported.has(sym) || local.has(sym)) continue;
            if (moduleExports[sym] === rel) continue;
            referenced.add(sym);
        }
    }
    for (const sym of referenced) {
        issues.push({ file: rel, symbol: sym, definedIn: moduleExports[sym] });
    }
}

function walkScan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkScan(p);
        else if (e.name.endsWith(".js")) scanFile(p);
    }
}
walkScan(SRC);

// 去重
const seen = new Set();
const unique = issues.filter(i => {
    const k = i.file + ":" + i.symbol;
    if (seen.has(k)) return false;
    seen.add(k); return true;
});

// 已知惰性 require / 循环依赖注入（非顶部 import）——允许名单
const ALLOW = new Set([
  "adapter/BookmarkAdapter.js:BookmarkBridge",
  "adapter/BookmarkAdapter.js:BookmarkExporter",
  "adapter/SyncScheduler.js:SyncState",
  "adapter/SyncScheduler.js:AutoImporter",
  "adapter/SyncScheduler.js:GitHubAutoImporter",
  "adapter/SyncScheduler.js:BookmarkAutoImporter",
  "ai/agent-executor.js:ChatState",
  "ai/agent-executor.js:AIService",
  "ai/agent-executor.js:ConfirmationDialog",
  "ai/handlers/batch.js:AIClassifier",
  "ai/handlers/batch.js:GitHubAPI",
  "ai/handlers/batch.js:BookmarkBridge",
  "ai/handlers/batch.js:InstallHelper",
  "ai/handlers/batch.js:BookmarkExporter",
  "ai/handlers/content.js:AIClassifier",
  "ai/tools/write-tools.js:AIClassifier",
  "coordination/UICommandService.js:AIAssistant",
  "coordination/UICommandService.js:AIClassifier",
  "coordination/UICommandService.js:GenericExporter",
  "coordination/UICommandService.js:BookmarkExporter",
  "coordination/UICommandService.js:UI",
  "coordination/UICommandService.js:GitHubAPI",
  "coordination/UICommandService.js:AIService",
  "import/index.js:UI",
  "main.js:DedupStore",
  "security/index.js:UI",
  "storage/index.js:CredentialVault",
]);
const unexpected = unique.filter((i) => !ALLOW.has(i.file + ":" + i.symbol));
if (unique.length === 0) {
    console.log("✅ 无游离引用");
    process.exit(0);
}
console.log(`发现 ${unique.length} 处游离引用（其中允许名单 ${unique.length - unexpected.length}，意外 ${unexpected.length}）:\n`);
for (const i of unique) {
    const tag = ALLOW.has(i.file + ":" + i.symbol) ? "ALLOW" : "NEW";
    console.log(`  [${tag}] ${i.file}: 引用 ${i.symbol} (定义于 ${i.definedIn}) 但未 import`);
}
if (unexpected.length > 0) {
    console.error("\n❌ 存在未允许的游离引用");
    process.exit(1);
}
console.log("\n✅ 游离引用均在允许名单内");
process.exit(0);
