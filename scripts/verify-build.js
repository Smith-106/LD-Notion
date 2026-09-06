"use strict";

/**
 * verify:build — 构建 + 语法检查 + BUILD 标记 + sync 剪枝 + root≡dist
 * 必须可失败（旧 package.json 中 `grep && (FAIL; exit 1) || (PASS)` 恒 exit 0）。
 *
 * 用法:
 *   node scripts/verify-build.js
 *   node scripts/verify-build.js --negative-check   # 注入假 SyncSerializer 断言脚本会 FAIL
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist", "LinuxDo-Bookmarks-to-Notion.user.js");
const ROOT_USER = path.join(ROOT, "LinuxDo-Bookmarks-to-Notion.user.js");

function fail(msg) {
    console.error(`[FAIL] ${msg}`);
    const err = new Error(msg);
    err.code = "VERIFY_BUILD_FAIL";
    throw err;
}

function pass(msg) {
    console.log(`[PASS] ${msg}`);
}

function runBuild() {
    const r = spawnSync(process.execPath, [path.join(ROOT, "build.js")], {
        cwd: ROOT,
        stdio: "inherit",
    });
    if (r.status !== 0) fail(`build.js exited ${r.status}`);
    pass("build.js");
}

function checkSyntax(file) {
    const r = spawnSync(process.execPath, ["--check", file], {
        cwd: ROOT,
        encoding: "utf8",
    });
    if (r.status !== 0) fail(`node --check ${path.relative(ROOT, file)}: ${r.stderr || r.stdout}`);
    pass(`node --check ${path.relative(ROOT, file)}`);
}

function sha256(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex");
}

function main() {
    const negative = process.argv.includes("--negative-check");

    if (!negative) {
        runBuild();
    }

    if (!fs.existsSync(DIST)) fail(`missing ${DIST}`);
    if (!fs.existsSync(ROOT_USER)) fail(`missing ${ROOT_USER}`);

    let distContent = fs.readFileSync(DIST, "utf8");
    const rootBuf = fs.readFileSync(ROOT_USER);
    const distBuf = fs.readFileSync(DIST);

    let originalDistForNeg = null;
    if (negative) {
        // 注入应导致剪枝断言失败的假声明；finally 还原 dist
        originalDistForNeg = fs.readFileSync(DIST);
        distContent += "\nvar SyncSerializer = {};\n";
        fs.writeFileSync(DIST, distContent, "utf8");
        console.log("[NEG] injected SyncSerializer into dist for negative check");
    }
    try {

    checkSyntax(DIST);
    if (!negative) checkSyntax(ROOT_USER);

    const markers = [
        "LD-NOTION-BUILD:USER_SCRIPT_BODY_START",
        "LD-NOTION-BUILD:BOOKMARK_BRIDGE_START",
    ];
    for (const m of markers) {
        if (!distContent.includes(m)) fail(`missing BUILD marker: ${m}`);
        pass(`marker ${m}`);
    }

    // sync/ 剪枝：SyncSerializer 等应缺席（允许字面量字符串提及，禁止变量声明）
    if (/\b(?:const|var|let)\s+SyncSerializer\d*\s*=/.test(distContent)) {
        fail("sync/ 未剪枝(SyncSerializer 应缺席)");
    }
    pass("sync/ 已按编译期开关剪枝 (no SyncSerializer decl)");

    if (!negative) {
        if (sha256(rootBuf) !== sha256(distBuf)) {
            fail("root userscript !== dist (checksum mismatch)");
        }
        pass(`root ≡ dist (sha256 ${sha256(rootBuf).slice(0, 12)}…)`);
    }

    if (negative) {
        // 若走到这里说明剪枝断言未触发 —— 失败
        fail("negative-check expected SyncSerializer decl to fail but did not");
    }

    console.log("\n✅ verify:build 全部通过");
    } finally {
        if (originalDistForNeg) {
            fs.writeFileSync(DIST, originalDistForNeg);
            console.log("[NEG] restored dist after negative check");
        }
    }
}

try {
    main();
} catch (e) {
    if (e && e.code === "VERIFY_BUILD_FAIL") process.exit(1);
    throw e;
}
