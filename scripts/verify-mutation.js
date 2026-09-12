"use strict";
/**
 * verify-mutation.js — 出口面变异锁运行器(可复现的测试强度证据)
 *
 * 为什么存在: 出口面缺陷审计(三模型共识)的最终判据是"契约测试能否杀死对判据/转义分支的注入"。
 * 该判据此前依赖会话内临时脚本, 清理后不可复现 → 本脚本把判据固化为仓库内可重跑工具。
 *
 * 判据: 对出口面源码施加**单一切口**变异, 若契约测试套件仍然全绿 → 该变异为 SURVIVED(测试盲区)。
 *   KILLED   = 测试失败(变异被捕获)
 *   SURVIVED = 测试全绿(测试未覆盖该行为)
 *   INVALID  = 变异后语法不合法(node --check 失败) —— 不计入 SURVIVED, 只如实登记
 *
 * 用法:
 *   node scripts/verify-mutation.js [--max N] [--stride N] [--files a,b,c] [--tests t1,t2]
 *   退出码: 0 = 无 SURVIVED; 1 = 存在 SURVIVED 或运行错误
 *
 * 实测: 10 个出口面契约测试文件 / 370 例, 单轮约 3.5s → 每 100 个切口约 6 分钟。
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const DEFAULT_FILES = [
    "src/api/DomSpec.js",
    "src/utils/index.js",
    "src/api/DOMToNotion.js",
    "src/api/obsidian.js",
    "src/api/constants.js",
];

const DEFAULT_TESTS = [
    "tests/dom-exit-surface.test.js",
    "tests/p4-dom-boundary.test.js",
    "tests/p4conv-round1.test.js",
    "tests/p4conv-round2.test.js",
    "tests/p4conv-round3.test.js",
    "tests/p4conv-round4.test.js",
    "tests/p4conv-round5.test.js",
    "tests/p4conv-round6.test.js",
    "tests/p4conv-round7.test.js",
    "tests/p4conv-round8.test.js",
];

// 单一算子: 只在**同一行内**做等长/近等长替换, 保持行号与结构, 便于逐条复核。
const OPERATORS = [
    { id: "eq-flip", from: "!==", to: "===" },
    { id: "eq-flip-r", from: "===", to: "!==" },
    { id: "and-or", from: "&&", to: "||" },
    { id: "or-and", from: "||", to: "&&" },
    { id: "lt-flip", from: "<=", to: "<" },
    { id: "gt-flip", from: ">=", to: ">" },
    { id: "bool-flip", from: "true", to: "false" },
    { id: "bool-flip-r", from: "false", to: "true" },
];

function parseArgs(argv) {
    const opts = { max: 60, stride: 0, files: DEFAULT_FILES, tests: DEFAULT_TESTS };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === "--max") { opts.max = Number(value); i += 1; }
        else if (key === "--stride") { opts.stride = Number(value); i += 1; }
        else if (key === "--files") { opts.files = String(value).split(",").filter(Boolean); i += 1; }
        else if (key === "--tests") { opts.tests = String(value).split(",").filter(Boolean); i += 1; }
        else if (key === "--no-tests") { opts.tests = []; }
        else throw new Error("未知参数: " + key);
    }
    return opts;
}

function listCandidates(file) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    const lines = source.split(/\r?\n/);
    const out = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // 跳过注释行
        for (const op of OPERATORS) {
            let cursor = line.indexOf(op.from);
            while (cursor !== -1) {
                // 跳过算子名内部的子串命中(如 "===" 命中 "!==" 的尾巴)
                const before = line[cursor - 1];
                if (op.from === "===" && before === "!") { cursor = line.indexOf(op.from, cursor + 1); continue; }
                if (op.from === "&&" && line.substr(cursor, 3) === "&&&") { cursor = line.indexOf(op.from, cursor + 1); continue; }
                out.push({ file, line: index, column: cursor, op: op.id, from: op.from, to: op.to });
                cursor = line.indexOf(op.from, cursor + op.from.length);
                break; // 每行每算子只取首个命中, 控制总量
            }
        }
    }
    return out;
}

function applyMutation(file, lineIndex, column, from, to) {
    const target = path.join(ROOT, file);
    const original = fs.readFileSync(target, "utf8");
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.split(/\r?\n/);
    const line = lines[lineIndex];
    lines[lineIndex] = line.slice(0, column) + to + line.slice(column + from.length);
    const mutated = lines.join(eol);
    fs.writeFileSync(target, mutated, "utf8");
    return original;
}

function syntaxOk(file) {
    const r = spawnSync(process.execPath, ["--check", path.join(ROOT, file)], { encoding: "utf8" });
    return r.status === 0;
}

function runTests(tests) {
    if (!tests.length) return { killed: false, status: 0 };
    const args = ["vitest", "run", ...tests, "--reporter=dot", "--silent"];
    const r = spawnSync("npx", args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
    return { killed: r.status !== 0, status: r.status };
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const all = [];
    for (const file of opts.files) all.push(...listCandidates(file));

    const stride = opts.stride > 0 ? opts.stride : Math.max(1, Math.ceil(all.length / opts.max));
    const selected = all.filter((_, index) => index % stride === 0).slice(0, opts.max);

    console.log("变异锁运行器 — 单一算子切口");
    console.log("候选变异点: " + all.length + " | stride: " + stride + " | 本轮执行: " + selected.length);
    console.log("目标文件: " + opts.files.join(", "));
    console.log("契约测试: " + (opts.tests.length ? opts.tests.join(", ") : "(未指定 → 仅做语法校验)"));
    console.log("");

    const totals = { KILLED: 0, SURVIVED: 0, INVALID: 0 };
    const survivors = [];
    const startedAt = Date.now();

    selected.forEach((mutation, index) => {
        const original = applyMutation(mutation.file, mutation.line, mutation.column, mutation.from, mutation.to);
        let verdict;
        try {
            if (!syntaxOk(mutation.file)) {
                verdict = "INVALID";
            } else {
                verdict = runTests(opts.tests).killed ? "KILLED" : "SURVIVED";
            }
        } finally {
            fs.writeFileSync(path.join(ROOT, mutation.file), original, "utf8");
        }
        totals[verdict] += 1;
        const where = mutation.file + ":" + (mutation.line + 1) + ":" + (mutation.column + 1);
        console.log("[" + (index + 1) + "/" + selected.length + "] " + where + " " + mutation.op + " (" + mutation.from + " -> " + mutation.to + ") => " + verdict);
        if (verdict === "SURVIVED") survivors.push(where + " " + mutation.op);
    });

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log("");
    console.log("KILLED " + totals.KILLED + " / SURVIVED " + totals.SURVIVED + " / INVALID " + totals.INVALID + " (总 " + selected.length + ", 用时 " + seconds + "s)");
    if (survivors.length) {
        console.log("SURVIVED 明细(测试盲区, 需补契约测试或退役该变异):");
        for (const s of survivors) console.log("  - " + s);
        process.exit(1);
    }
    console.log("✅ 变异锁验证通过: 无 SURVIVED");
}

main();
