"use strict";

/**
 * LD-Notion 构建产物等价性验证
 * 对比 dist/LinuxDo-Bookmarks-to-Notion.user.js 与原始 LinuxDo-Bookmarks-to-Notion.user.js
 * 确保打包产物在功能上与原始脚本等价
 *
 * 检查项:
 *   1. REQUIRED_CONSTS 存在于 bundle 中
 *   2. GM_api 函数存在于 bundle 中
 *   3. CONFIG.STORAGE_KEYS 值作为字符串字面量存在于 bundle 中
 *   4. BUILD 锚点标记存在
 *   5. Chrome 扩展 manifest 有效性（manifest_version=3, storage+bookmarks 权限）
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DIST_BUNDLE = path.join(PROJECT_ROOT, "dist", "LinuxDo-Bookmarks-to-Notion.user.js");
const ORIGINAL_SCRIPT = path.join(PROJECT_ROOT, "LinuxDo-Bookmarks-to-Notion.user.js");
const CHROME_MANIFEST = path.join(PROJECT_ROOT, "chrome-extension-full", "manifest.json");

// ===========================================
// 1. 必需常量 — esbuild 打包后可能追加数字后缀 (如 Storage3, UI3)
// ===========================================
const REQUIRED_CONSTS = [
    "Storage",
    "SyncState",
    "CredentialVault",
    "NotionOAuth",
    "NotionAPI",
    "NotionTransport",
    "OperationGuard",
    "LinuxDoAPI",
    "Exporter",
    "AutoImporter",
    "GitHubAPI",
    "GitHubAutoImporter",
    "BookmarkBridge",
    "BookmarkAutoImporter",
    "RSSAutoImporter",
    "AIClassifier",
    "ZhihuAPI",
    "GenericExtractor",
    "UI",
    // 全盘审计: 补登后续拆分模块(此前 19 项名单对新模块失效, 等价性校验盲区)
    "DedupStore",
    "UICommandService",
    "NotionSiteUI",
    "GenericUI",
    "WorkspaceService",
    "GenericExporter",
    "UpdateChecker",
    "SiteDetector",
    "OperationLog",
    "UndoManager",
    "UrlValidator",
    // v3.14.6 (AUD-ARCH-07): 多端同步模块由 main.js 编译期字面量开关剪枝(默认 false 不入包),
    // 移出 REQUIRED_CONSTS → SYNC_PRUNED_CONSTS(见 verifySyncPrunedConsts)
];

// v3.14.6 (AUD-ARCH-07): sync/ 全模块随编译期开关剪枝 —— 产物中应整体缺席;
// 全员缺席视为符合预期(半剪枝/未剪枝都会在此失败, 保持等价性校验盲区闭合)
const SYNC_PRUNED_CONSTS = [
    "SyncEngine",
    "SyncConfig",
    "SyncCrypto",
    "SyncSerializer",
    "SyncPayload",
    "SyncLedger",
    "SyncRateLimiter",
    "SyncFragmenter",
];

// ===========================================
// 2. GM_api 函数
// ===========================================
const REQUIRED_GM_APIS = [
    "GM_getValue",
    "GM_setValue",
    "GM_deleteValue",
    "GM_xmlhttpRequest",
    "GM_notification",
    "GM_addValueChangeListener",
    // 全盘审计: UpdateChecker.getCurrentVersion 依赖 GM_info.script.version(src 13 处使用)
    "GM_info",
];

// ===========================================
// 3. BUILD 锚点标记
// ===========================================
const REQUIRED_BUILD_MARKERS = [
    "// [LD-NOTION-BUILD:USER_SCRIPT_BODY_START]",
    "// [LD-NOTION-BUILD:USER_SCRIPT_BODY_END]",
    "// [LD-NOTION-BUILD:BOOKMARK_BRIDGE_START]",
    "// [LD-NOTION-BUILD:BOOKMARK_BRIDGE_END]",
];

// ===========================================
// 辅助函数
// ===========================================

function extractStorageKeyValues(source) {
    const keys = [];
    // 匹配 STORAGE_KEYS 对象中的字符串值: KEY_NAME: "ldb_xxx"
    // 前缀白名单补 COLLAPSE_/FLOAT_BTN_/AGENT_/UPDATE_(全盘审计: 此前 98/105 漏检 12 键,
    // NOTION_FLOAT_ 已无对应键, 移除死前缀)。
    const re = /^\s*(?:NOTION_|CREDENTIAL_|FILTER_|IMG_|PANEL_|EXPORTED_|PERMISSION_|REQUIRE_|ENABLE_|OPERATION_|REQUEST_|AI_|CHAT_|EXPORT_|PARENT_|NOTION_PANEL_|FETCHED_|WORKSPACE_|AUTO_|GITHUB_|BOOKMARK_|RSS_|LINUXDO_|EXT_|MODE_|CROSS_|AUTO_SYNC_|OBS_|PANEL_SIZE_|THEME_|ACTIVE_|SYNC_|COLLAPSE_|FLOAT_BTN_|AGENT_|UPDATE_)\w+:\s*"([^"]+)"/gm;
    let match;
    while ((match = re.exec(source)) !== null) {
        keys.push(match[1]);
    }
    return keys;
}

function readIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf8");
}

function makeConstPattern(name) {
    // 匹配 esbuild 打包后的变量声明: var Storage3 = { / const Storage = {
    // 允许数字后缀（esbuild 重命名策略）
    return new RegExp(`\\b(?:const|var|let)\\s+${name}\\d*\\s*=`);
}

// ===========================================
// 验证逻辑
// ===========================================

function verifyRequiredConsts(bundleSource, originalSource) {
    const missing = [];
    for (const name of REQUIRED_CONSTS) {
        const pattern = makeConstPattern(name);
        if (!pattern.test(bundleSource)) {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        throw new Error(`Bundle 缺少必需常量: ${missing.join(", ")}`);
    }
    console.log(`  [PASS] 全部 ${REQUIRED_CONSTS.length} 个必需常量存在于 bundle 中`);
}

// v3.14.6 (AUD-ARCH-07): 剪枝断言 —— sync/ 模块整体缺席(任一带回即失败)
function verifySyncPrunedConsts(bundleSource) {
    const present = [];
    for (const name of SYNC_PRUNED_CONSTS) {
        if (makeConstPattern(name).test(bundleSource)) present.push(name);
    }
    if (present.length > 0) {
        throw new Error(`sync/ 未按编译期开关剪枝(应缺席): ${present.join(", ")}`);
    }
    console.log(`  [PASS] 全部 ${SYNC_PRUNED_CONSTS.length} 个 sync/ 模块常量按剪枝预期缺席 bundle`);
}

function verifyGmApis(bundleSource) {
    const missing = [];
    for (const apiName of REQUIRED_GM_APIS) {
        // GM_api 在 userscript 头部声明为 @grant，在代码中作为全局函数调用
        // bundle 应包含这些调用（而非声明，声明来自 @grant 头）
        const callPattern = new RegExp(`\\b${apiName}\\b`);
        if (!callPattern.test(bundleSource)) {
            missing.push(apiName);
        }
    }
    if (missing.length > 0) {
        throw new Error(`Bundle 缺少 GM_api 函数: ${missing.join(", ")}`);
    }
    console.log(`  [PASS] 全部 ${REQUIRED_GM_APIS.length} 个 GM_api 函数存在于 bundle 中`);
}

function verifyStorageKeyLiterals(bundleSource, originalSource) {
    const originalKeys = extractStorageKeyValues(originalSource);

    if (originalKeys.length === 0) {
        throw new Error("无法从原始脚本提取 STORAGE_KEYS 值，正则可能需要修正");
    }

    const missing = [];
    for (const keyValue of originalKeys) {
        // 作为字符串字面量搜索（含引号）
        if (!bundleSource.includes(`"${keyValue}"`) && !bundleSource.includes(`'${keyValue}'`)) {
            missing.push(keyValue);
        }
    }

    if (missing.length > 0) {
        throw new Error(`Bundle 缺少 STORAGE_KEYS 字符串字面量: ${missing.join(", ")}`);
    }
    console.log(`  [PASS] 全部 ${originalKeys.length} 个 STORAGE_KEYS 值作为字符串字面量存在于 bundle 中`);
}

function verifyBuildMarkers(bundleSource) {
    const missing = [];
    for (const marker of REQUIRED_BUILD_MARKERS) {
        if (!bundleSource.includes(marker)) {
            missing.push(marker);
        }
    }
    if (missing.length > 0) {
        throw new Error(`Bundle 缺少 BUILD 锚点标记: ${missing.join(", ")}`);
    }
    console.log(`  [PASS] 全部 ${REQUIRED_BUILD_MARKERS.length} 个 BUILD 锚点标记存在于 bundle 中`);
}

function verifyChromeManifest() {
    // 验证桥接扩展 manifest (chrome-extension-full/manifest.json)
    // CI 链路中 verify:equivalence 先于 build:extension 执行,此时 chrome-extension-full/ 尚未生成;
    // 该目录的 manifest 已由 verify:extension:surfaces(bounded/完整构建)覆盖验证,此处存在时复核。
    if (!fs.existsSync(CHROME_MANIFEST)) {
        console.log(`  [SKIP] chrome-extension-full/manifest.json 不存在(构建产物,由 verify:extension:surfaces 覆盖),跳过`);
        return;
    }
    const bridgeManifestSource = readIfExists(CHROME_MANIFEST);
    const bridgeManifest = JSON.parse(bridgeManifestSource);

    if (bridgeManifest.manifest_version !== 3) {
        throw new Error(`桥接扩展 manifest_version 应为 3，实际为 ${bridgeManifest.manifest_version}`);
    }
    console.log("  [PASS] 桥接扩展 manifest_version = 3");

    const bridgePermissions = bridgeManifest.permissions || [];
    if (!bridgePermissions.includes("bookmarks")) {
        throw new Error("桥接扩展 manifest 缺少 bookmarks 权限");
    }
    console.log("  [PASS] 桥接扩展 manifest 包含 bookmarks 权限");

    // 验证构建脚本配置 — 完整扩展 manifest 必须包含 storage + bookmarks
    const buildScriptSource = readIfExists(path.join(PROJECT_ROOT, "scripts", "build-extension.js"));
    const buildManifestPattern = /permissions:\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\)/;
    const match = buildManifestPattern.exec(buildScriptSource);
    if (!match) {
        throw new Error("无法从 build-extension.js 提取 permissions 配置");
    }
    const permissionsBlock = match[1];
    const hasStorage = permissionsBlock.includes('"storage"') || permissionsBlock.includes("'storage'");
    const hasBookmarks = permissionsBlock.includes('"bookmarks"') || permissionsBlock.includes("'bookmarks'");

    if (!hasStorage || !hasBookmarks) {
        const missing = [];
        if (!hasStorage) missing.push("storage");
        if (!hasBookmarks) missing.push("bookmarks");
        throw new Error(`完整扩展构建配置缺少权限: ${missing.join(", ")}`);
    }
    console.log("  [PASS] 完整扩展构建配置包含 storage + bookmarks 权限");
}

// ===========================================
// 主入口
// ===========================================

function main() {
    console.log("LD-Notion 构建产物等价性验证\n");

    const bundleSource = readIfExists(DIST_BUNDLE);
    const originalSource = readIfExists(ORIGINAL_SCRIPT);

    console.log("1. 验证必需常量...");
    verifyRequiredConsts(bundleSource, originalSource);

    console.log("1b. 验证 sync/ 剪枝常量(应缺席)...");
    verifySyncPrunedConsts(bundleSource);

    console.log("\n2. 验证 GM_api 函数...");
    verifyGmApis(bundleSource);

    console.log("\n3. 验证 STORAGE_KEYS 字符串字面量...");
    verifyStorageKeyLiterals(bundleSource, originalSource);

    console.log("\n4. 验证 BUILD 锚点标记...");
    verifyBuildMarkers(bundleSource);

    console.log("\n5. 验证 Chrome 扩展 manifest...");
    verifyChromeManifest();

    console.log("\n✅ 构建产物等价性验证全部通过");
}

main();
