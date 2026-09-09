// 扫描游离引用: 符号被引用但未在 require 解构中导入
// 用法: node tests/scan-dangling-refs.js
// 退出码: 0 干净(或仅允许名单), 1 存在未允许的游离引用
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "src");
const ALLOWLIST_PATH = path.resolve(__dirname, "dangling-refs-allowlist.json");

/** 跳过字符串/模板/注释/正则字面量；返回同长度掩码文本（非代码处置空格，换行保留） */
function maskNoise(content) {
    const out = [];
    let i = 0;
    while (i < content.length) {
        // 正则字面量: 仅当左侧有效字符不是 [标识符/)]} ] 且同行内可闭合时才视为正则,
        // 否则把除法误判为正则会吞掉后续代码(字符类内的引号曾破坏字符串屏蔽)。
        if (content[i] === "/" && content[i + 1] !== "/" && content[i + 1] !== "*") {
            const prevSignificant = content.slice(0, i).replace(/\s+$/, "").slice(-1);
            if (!/[A-Za-z0-9_$)\]}]/.test(prevSignificant || "(")) {
                let j = i + 1;
                let inClass = false;
                let closed = -1;
                while (j < content.length && content[j] !== "\n") {
                    if (content[j] === "\\") {
                        j += 2;
                        continue;
                    }
                    if (content[j] === "[") inClass = true;
                    else if (content[j] === "]") inClass = false;
                    else if (content[j] === "/" && !inClass) {
                        closed = j;
                        break;
                    }
                    j++;
                }
                if (closed > i) {
                    for (let k = i; k <= closed; k++) out.push(" ");
                    i = closed + 1;
                    while (i < content.length && /[a-z]/i.test(content[i])) {
                        out.push(" ");
                        i++;
                    }
                    continue;
                }
            }
        }
        if (content[i] === "/" && content[i + 1] === "/") {
            while (i < content.length && content[i] !== "\n") {
                out.push(" ");
                i++;
            }
            continue;
        }
        if (content[i] === "/" && content[i + 1] === "*") {
            out.push(" ", " ");
            i += 2;
            while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
                out.push(content[i] === "\n" ? "\n" : " ");
                i++;
            }
            if (i < content.length) {
                out.push(" ", " ");
                i += 2;
            }
            continue;
        }
        if (content[i] === '"' || content[i] === "'" || content[i] === "`") {
            const q = content[i];
            out.push(" ");
            i++;
            while (i < content.length && content[i] !== q) {
                if (content[i] === "\\") {
                    out.push(" ", " ");
                    i += 2;
                    continue;
                }
                if (q === "`" && content[i] === "$" && content[i + 1] === "{") {
                    out.push(" ", " ");
                    i += 2;
                    let depth = 1;
                    while (i < content.length && depth > 0) {
                        if (content[i] === "{") depth++;
                        else if (content[i] === "}") depth--;
                        if (depth === 0) {
                            out.push(" ");
                            i++;
                            break;
                        }
                        out.push(content[i]);
                        i++;
                    }
                    continue;
                }
                out.push(content[i] === "\n" ? "\n" : " ");
                i++;
            }
            if (i < content.length) {
                out.push(" ");
                i++;
            }
            continue;
        }
        out.push(content[i]);
        i++;
    }
    return out.join("");
}

function extractExportsBody(content) {
    const masked = maskNoise(content);
    const marker = masked.match(/module\.exports\s*=\s*\{/);
    if (!marker) return null;
    const start = marker.index + marker[0].length - 1;
    let depth = 0;
    for (let i = start; i < masked.length; i++) {
        if (masked[i] === "{") depth++;
        else if (masked[i] === "}") {
            depth--;
            if (depth === 0) return masked.slice(start + 1, i);
        }
    }
    return null;
}

function topLevelExportKeys(body) {
    const keys = new Set();
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "{") { depth++; continue; }
        if (ch === "}") { depth--; continue; }
        if (depth !== 0) continue;
        if (!/[A-Z]/.test(ch)) continue;
        if (i > 0 && /[A-Za-z0-9_]/.test(body[i - 1])) continue;
        // 支持 shorthand `Foo,` / `Foo` 与显式 `Foo:`
        const m = body.slice(i).match(/^([A-Z][A-Za-z0-9_]*)\s*([:,}]|$)/);
        if (m) {
            keys.add(m[1]);
            i += m[1].length - 1;
        }
    }
    return keys;
}

const moduleExports = {};
function collectExports(file) {
    const content = fs.readFileSync(file, "utf8");
    const body = extractExportsBody(content);
    if (!body) return;
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    for (const s of topLevelExportKeys(body)) {
        if (!moduleExports[s]) moduleExports[s] = rel;
    }
}

function walk(dir, fn) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, fn);
        else if (e.name.endsWith(".js")) fn(p);
    }
}
walk(SRC, collectExports);

function collectParamsFromList(paramSrc, into) {
    const flat = paramSrc.replace(/\{|\}/g, " ");
    for (const part of flat.split(",")) {
        const id = part.trim().match(/^([A-Z][A-Za-z0-9_]*)/);
        if (id) into.add(id[1]);
    }
}

function extractBalanced(src, openIdx, openCh, closeCh) {
    let depth = 0;
    for (let i = openIdx; i < src.length; i++) {
        if (src[i] === openCh) depth++;
        else if (src[i] === closeCh) {
            depth--;
            if (depth === 0) return src.slice(openIdx + 1, i);
        }
    }
    return null;
}

function localDecls(masked) {
    const s = new Set();
    let m;
    const declRe = /\b(?:const|let|var|function|class)\s+([A-Z][A-Za-z0-9_]*)/g;
    while ((m = declRe.exec(masked)) !== null) s.add(m[1]);

    const destr = /\b(?:const|let|var)\s*\{/g;
    while ((m = destr.exec(masked)) !== null) {
        const open = m.index + m[0].length - 1;
        const body = extractBalanced(masked, open, "{", "}");
        if (!body) continue;
        for (const part of body.split(",")) {
            const t = part.trim();
            if (!t) continue;
            const renamed = t.match(/^([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)$/);
            if (renamed) {
                if (/^[A-Z]/.test(renamed[2])) s.add(renamed[2]);
            } else {
                const id = t.match(/^([A-Z][A-Za-z0-9_]*)/);
                if (id) s.add(id[1]);
            }
        }
    }

    for (let i = 0; i < masked.length; i++) {
        if (masked[i] !== "(") continue;
        const before = masked.slice(Math.max(0, i - 32), i);
        const isFn =
            /(?:async\s+)?[A-Za-z_][\w]*\s*$/.test(before) ||
            /function\s*[A-Za-z0-9_]*\s*$/.test(before) ||
            /(?::|=)\s*(?:async\s*)?$/.test(before);
        if (!isFn) continue;
        const body = extractBalanced(masked, i, "(", ")");
        if (body == null) continue;
        const after = masked.slice(i + body.length + 2).match(/^\s*(=>|\{)/);
        if (!after) continue;
        collectParamsFromList(body, s);
    }
    return s;
}

function collectImported(raw) {
    const imported = new Set();
    const requireRe = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["'][^"']+["']\s*\)/g;
    let rm;
    while ((rm = requireRe.exec(raw)) !== null) {
        for (const part of rm[1].split(",")) {
            const t = part.trim();
            if (!t) continue;
            const renamed = t.match(/^([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)$/);
            if (renamed) imported.add(renamed[2]);
            else {
                const id = t.match(/^([A-Za-z_][\w]*)/);
                if (id) imported.add(id[1]);
            }
        }
    }
    const propRe = /require\(\s*["'][^"']+["']\s*\)\s*\.\s*([A-Z][A-Za-z0-9_]*)/g;
    while ((rm = propRe.exec(raw)) !== null) imported.add(rm[1]);
    return imported;
}

const issues = [];
function scanFile(file) {
    const raw = fs.readFileSync(file, "utf8");
    const masked = maskNoise(raw);
    const imported = collectImported(raw);
    const local = localDecls(masked);
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    const referenced = new Set();
    const re = /\b([A-Z][A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = re.exec(masked)) !== null) {
        const sym = m[1];
        if (!moduleExports[sym]) continue;
        if (imported.has(sym) || local.has(sym)) continue;
        if (moduleExports[sym] === rel) continue;
        const after = masked.slice(m.index + sym.length).match(/^\s*:/);
        if (after) continue; // object key, not free var
        referenced.add(sym);
    }
    for (const sym of referenced) {
        issues.push({ file: rel, symbol: sym, definedIn: moduleExports[sym] });
    }
}

walk(SRC, scanFile);

const seen = new Set();
const unique = issues.filter((i) => {
    const k = i.file + ":" + i.symbol;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
});

function loadAllowlist() {
    if (!fs.existsSync(ALLOWLIST_PATH)) return { entries: new Set(), reasons: {} };
    const data = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
    const entries = new Set();
    const reasons = {};
    for (const [key, reason] of Object.entries(data.allow || {})) {
        entries.add(key);
        reasons[key] = reason;
    }
    return { entries, reasons };
}

const { entries: ALLOW, reasons } = loadAllowlist();
const unexpected = unique.filter((i) => !ALLOW.has(i.file + ":" + i.symbol));
const allowedHits = unique.filter((i) => ALLOW.has(i.file + ":" + i.symbol));
const unusedAllow = [...ALLOW].filter((k) => !unique.some((i) => i.file + ":" + i.symbol === k));

if (unique.length === 0) {
    console.log("✅ 无游离引用");
    if (unusedAllow.length) console.log(`(提示: 允许名单有 ${unusedAllow.length} 条未命中，可考虑清理)`);
    process.exit(0);
}

console.log(`发现 ${unique.length} 处游离引用（允许名单命中 ${allowedHits.length}，意外 ${unexpected.length}）:\n`);
for (const i of unique) {
    const key = i.file + ":" + i.symbol;
    const tag = ALLOW.has(key) ? "ALLOW" : "NEW";
    const why = reasons[key] ? ` — ${reasons[key]}` : "";
    console.log(`  [${tag}] ${i.file}: 引用 ${i.symbol} (定义于 ${i.definedIn}) 但未 import${why}`);
}
if (unusedAllow.length) console.log(`\n(提示: 允许名单有 ${unusedAllow.length} 条未命中)`);
if (unexpected.length > 0) {
    console.error("\n❌ 存在未允许的游离引用");
    process.exit(1);
}
console.log("\n✅ 游离引用均在允许名单内");
process.exit(0);
