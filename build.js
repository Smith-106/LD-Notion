"use strict";
/**
 * LD-Notion 构建脚本
 * 使用 esbuild 将模块化源码打包为单个 .user.js 文件
 *
 * 用法: node build.js
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         LD-Notion Hub — AI 多源知识中枢
// @namespace    https://linux.do/
// @version      3.7.3
// @description  将 Linux.do 与 Notion 深度连接：AI 对话式助手管理 Notion 工作区，批量导出帖子到 Notion / Obsidian，知乎内容导出，GitHub 全类型导入，浏览器书签导入，精细筛选，AI 自动分类与批量打标签
// @author       基于 flobby 和 JackLiii 的作品改编
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js
// @downloadURL  https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js
// @match        https://linux.do/*
// @match        https://www.notion.so/*
// @match        https://notion.so/*
// @match        https://github.com/*
// @match        https://www.github.com/*
// @match        https://www.zhihu.com/*
// @match        https://zhuanlan.zhihu.com/*
// @include      /^https?://(?!(www\.google\.com|www\.google\.com\.hk|www\.baidu\.com|www\.bing\.com|duckduckgo\.com|mail\.google\.com|outlook\.live\.com|localhost|127\.0\.0\.1))/
// @exclude      https://www.google.com/*
// @exclude      https://www.google.com.hk/*
// @exclude      https://www.baidu.com/*
// @exclude      https://www.bing.com/*
// @exclude      https://duckduckgo.com/*
// @exclude      https://mail.google.com/*
// @exclude      https://outlook.live.com/*
// @exclude      *://localhost/*
// @exclude      *://localhost:*/*
// @exclude      *://127.0.0.1/*
// @exclude      *://127.0.0.1:*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.notion.com
// @connect      linux.do
// @connect      *.amazonaws.com
// @connect      s3.amazonaws.com
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.github.com
// @connect      zhihu.com
// @connect      zhuanlan.zhihu.com
// @run-at       document-idle
// ==/UserScript==
`;

async function build() {
    const outDir = path.join(__dirname, "dist");
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const tempFile = path.join(outDir, "_bundle.tmp.js");

    // 第一步：使用 esbuild 打包
    await esbuild.build({
        entryPoints: [path.join(__dirname, "src", "main.js")],
        bundle: true,
        outfile: tempFile,
        format: "iife",
        target: ["chrome80"],
        minify: false,
        legalComments: "inline",
        treeShaking: false,
        logLevel: "info",
    });

    // 第二步：读取打包结果
    let bundleContent = fs.readFileSync(tempFile, "utf8");

    // esbuild iife format 输出形如:
    //   "use strict";
    //   (() => {
    //     var __getOwnPropNames = ...
    //     ...code...
    //     main();
    //   })();
    //
    // 我们需要将其转换为与原始文件相同的格式:
    //   (function () {
    //       // [LD-NOTION-BUILD:USER_SCRIPT_BODY_START]
    //       "use strict";
    //       ...code...
    //       // [LD-NOTION-BUILD:USER_SCRIPT_BODY_END]
    //   })();

    // 移除 esbuild 在 IIFE 之前添加的 "use strict";
    // esbuild 输出第一行是 "use strict";\n，然后是 (() => {
    bundleContent = bundleContent.replace(/^"use strict";\n/, "");

    // 替换 esbuild 的箭头函数 IIFE 为传统 function IIFE
    // (() => { ... })();
    // → (function () { ... })();
    bundleContent = bundleContent.replace(/^\(\(\) => \{/, "(function () {");
    bundleContent = bundleContent.replace(/\}\)\(\);\s*$/, "})();");

    // 在 IIFE 开始后插入 BUILD 标记和 "use strict";
    bundleContent = bundleContent.replace(
        /\(function \(\) \{\n/,
        "(function () {\n    // [LD-NOTION-BUILD:USER_SCRIPT_BODY_START]\n    \"use strict\";\n"
    );

    // 在 IIFE 结束前插入 BUILD 标记
    bundleContent = bundleContent.replace(
        /\n\}\)\(\);\s*$/,
        "\n    // [LD-NOTION-BUILD:USER_SCRIPT_BODY_END]\n})();\n"
    );

    // 修正缩进：esbuild 使用 2 空格缩进，原始文件使用 4 空格缩进
    // 为了与 build-extension.js 兼容，我们保持 esbuild 的 2 空格缩进
    // build-extension.js 只查找 BUILD 标记，不关心缩进

    // 将字符串形式的 BUILD 标记转换回注释
    // 在 bridge 模块中，我们用字符串字面量保存标记以防止 esbuild 移除注释
    // 现在需要将它们转换回注释格式
    bundleContent = bundleContent.replace(
        /var __LD_NOTION_BUILD_BOOKMARK_BRIDGE_START__ = "\[LD-NOTION-BUILD:BOOKMARK_BRIDGE_START\]";/g,
        "// [LD-NOTION-BUILD:BOOKMARK_BRIDGE_START]"
    );
    bundleContent = bundleContent.replace(
        /var __LD_NOTION_BUILD_BOOKMARK_BRIDGE_END__ = "\[LD-NOTION-BUILD:BOOKMARK_BRIDGE_END\]";/g,
        "// [LD-NOTION-BUILD:BOOKMARK_BRIDGE_END]"
    );

    // 第三步：拼接 userscript 头 + IIFE 主体
    const finalContent = USERSCRIPT_HEADER + "\n" + bundleContent;

    // 第四步：写入最终输出
    const outfile = path.join(outDir, "LinuxDo-Bookmarks-to-Notion.user.js");
    fs.writeFileSync(outfile, finalContent, "utf8");

    // 清理临时文件
    fs.unlinkSync(tempFile);

    console.log(`Build complete: ${outfile}`);
    console.log(`Output size: ${(fs.statSync(outfile).size / 1024).toFixed(1)} KB`);
}

build().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
});
