#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function readFileUtf8(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let idx = 0;
    while (true) {
        idx = haystack.indexOf(needle, idx);
        if (idx === -1) return count;
        count++;
        idx += needle.length;
    }
}

function extractMethodBody(source, objectName, methodName) {
    // esbuild 合并多模块时会为重名对象字面量加数字后缀（如 UI3、NotionSiteUI2），
    // 且统一输出 var。用正则兼容 const|var|let + 可选数字后缀，避免对标识符名脆弱。
    const anchorRe = new RegExp(`\\b(?:const|var|let)\\s+${objectName}\\d*\\s*=\\s*\\{`);
    const anchorMatch = source.match(anchorRe);
    if (!anchorMatch) return null;
    const start = anchorMatch.index;
    const sub = source.slice(start);

    const re = new RegExp(
        `${methodName}:\\s*\\(\\)\\s*=>\\s*\\{([\\s\\S]*?)\\n\\s*\\},`,
        "m"
    );
    const m = sub.match(re);
    if (!m) return null;
    return m[1];
}

// esbuild 会为重名顶层标识符加数字后缀（DesignSystem2、StyleManager2 等），
// 方法体内容检查需兼容后缀：把 "DesignSystem.ensureBase()" 当作
// "DesignSystem<数字?>.ensureBase()" 来匹配。
function hasCall(body, ident, restLiteral) {
    const restEsc = restLiteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\b" + ident + "\\d*\\b" + restEsc);
    return re.test(body);
}

function run() {
    const target = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.resolve(process.cwd(), "LinuxDo-Bookmarks-to-Notion.user.js");

    if (!fs.existsSync(target)) {
        console.error(`❌ 找不到目标 userscript: ${target}`);
        process.exit(1);
    }

    const source = readFileUtf8(target);
    const errors = [];

    function expect(desc, ok, details = "") {
        if (ok) return;
        errors.push(details ? `${desc}: ${details}` : desc);
    }

    // --- 全局锚点（tokens + 样式 ID）---
    expect("缺少 StyleManager.injectOnce", source.includes("injectOnce: (styleId, cssText) => {"));
    expect("缺少 DesignSystem.STYLE_IDS.BASE", source.includes('BASE: "ldb-ui-base"'));
    expect("缺少 DesignSystem.STYLE_IDS.CHAT", source.includes('CHAT: "ldb-ui-chat"'));
    expect("缺少 tokens 标识 LDB_UI_TOKENS", source.includes("/* LDB_UI_TOKENS */"));
    expect("缺少 ChatUI 样式标识 LDB_UI_CHAT", source.includes("/* LDB_UI_CHAT */"));
    expect("ChatUI 样式标识重复（应为 1 处）", countOccurrences(source, "/* LDB_UI_CHAT */") === 1, `count=${countOccurrences(source, "/* LDB_UI_CHAT */")}`);

    // --- 三处注入点必须迁移到 StyleManager ---
    const notionInject = extractMethodBody(source, "NotionSiteUI", "injectStyles");
    expect("无法提取 NotionSiteUI.injectStyles()", !!notionInject);
    if (notionInject) {
        expect(
            "NotionSiteUI.injectStyles 未调用 DesignSystem.ensureBase()",
            hasCall(notionInject, "DesignSystem", ".ensureBase()")
        );
        expect(
            "NotionSiteUI.injectStyles 未调用 DesignSystem.ensureChat()",
            hasCall(notionInject, "DesignSystem", ".ensureChat()")
        );
        expect(
            "NotionSiteUI.injectStyles 未使用 StyleManager.injectOnce(DesignSystem.STYLE_IDS.NOTION)",
            hasCall(notionInject, "StyleManager", ".injectOnce(") && hasCall(notionInject, "DesignSystem", ".STYLE_IDS.NOTION")
        );
        expect(
            "NotionSiteUI.injectStyles 仍在使用 document.createElement(\"style\")（应改为 StyleManager）",
            !notionInject.includes('document.createElement("style")')
        );
    }

    const uiInject = extractMethodBody(source, "UI", "injectStyles");
    expect("无法提取 UI.injectStyles()", !!uiInject);
    if (uiInject) {
        expect(
            "UI.injectStyles 未调用 DesignSystem.ensureBase()",
            hasCall(uiInject, "DesignSystem", ".ensureBase()")
        );
        expect(
            "UI.injectStyles 未调用 DesignSystem.ensureChat()",
            hasCall(uiInject, "DesignSystem", ".ensureChat()")
        );
        expect(
            "UI.injectStyles 未使用 StyleManager.injectOnce(DesignSystem.STYLE_IDS.LINUX_DO)",
            hasCall(uiInject, "StyleManager", ".injectOnce(") && hasCall(uiInject, "DesignSystem", ".STYLE_IDS.LINUX_DO")
        );
        expect(
            "UI.injectStyles 仍在使用 document.createElement(\"style\")（应改为 StyleManager）",
            !uiInject.includes('document.createElement("style")')
        );
    }

    const genericInject = extractMethodBody(source, "GenericUI", "injectStyles");
    expect("无法提取 GenericUI.injectStyles()", !!genericInject);
    if (genericInject) {
        expect(
            "GenericUI.injectStyles 未调用 DesignSystem.ensureBase()",
            hasCall(genericInject, "DesignSystem", ".ensureBase()")
        );
        expect(
            "GenericUI.injectStyles 未使用 StyleManager.injectOnce(DesignSystem.STYLE_IDS.GENERIC)",
            hasCall(genericInject, "StyleManager", ".injectOnce(") && hasCall(genericInject, "DesignSystem", ".STYLE_IDS.GENERIC")
        );
        expect(
            "GenericUI.injectStyles 仍在使用 document.createElement(\"style\")（应改为 StyleManager）",
            !genericInject.includes('document.createElement("style")')
        );
    }

    // --- reduced motion / focus-visible 基础保障 ---
    expect(
        "缺少 prefers-reduced-motion 适配",
        source.includes("@media (prefers-reduced-motion: reduce)")
    );
    expect(
        "缺少 :focus-visible 焦点环样式",
        source.includes(":focus-visible")
    );

    if (errors.length) {
        console.error("❌ UI 静态验证失败：");
        for (const e of errors) console.error(`- ${e}`);
        process.exit(1);
    }

    console.log("✅ UI 静态验证通过");
    console.log(`- userscript: ${path.relative(process.cwd(), target)}`);
    console.log("- 关键锚点：tokens、chat、三处 injectStyles 注入点已校验");
}

run();

