"use strict";
/**
 * LD-Notion 构建脚本
 * 从油猴脚本生成 Chrome 扩展版本
 *
 * 用法: node scripts/build-extension.js
 */

const fs = require("fs");
const path = require("path");

const BUILD_ANCHORS = Object.freeze({
    userscriptBodyStart: "// [LD-NOTION-BUILD:USER_SCRIPT_BODY_START]",
    userscriptBodyEnd: "// [LD-NOTION-BUILD:USER_SCRIPT_BODY_END]",
    bookmarkBridgeStart: "// [LD-NOTION-BUILD:BOOKMARK_BRIDGE_START]",
    bookmarkBridgeEnd: "// [LD-NOTION-BUILD:BOOKMARK_BRIDGE_END]",
});

const GENERATED_SECTION_MARKERS = Object.freeze({
    gmShimStart: "// [LD-NOTION-BUILD:GM_SHIM_START]",
    gmShimEnd: "// [LD-NOTION-BUILD:GM_SHIM_END]",
    bookmarkEventBridgeStart: "// [LD-NOTION-BUILD:BOOKMARK_EVENT_BRIDGE_START]",
    bookmarkEventBridgeEnd: "// [LD-NOTION-BUILD:BOOKMARK_EVENT_BRIDGE_END]",
    popupMessageBridgeStart: "// [LD-NOTION-BUILD:POPUP_MESSAGE_BRIDGE_START]",
    popupMessageBridgeEnd: "// [LD-NOTION-BUILD:POPUP_MESSAGE_BRIDGE_END]",
});

const DEFAULT_MANIFEST_PROFILE = "bounded_hosts";

const MANIFEST_SHARED_DEFAULTS = Object.freeze({
    name: "LD-Notion — Notion AI 助手 & 多源收藏管理",
    description: "将 Linux.do、GitHub、浏览器书签与 Notion 深度连接：AI 对话式助手、批量导出收藏、跨源智能搜索与推荐",
    permissions: Object.freeze([
        "storage",
        "bookmarks",
        "notifications",
        "activeTab"
    ]),
    contentScriptMatches: Object.freeze([
        "https://linux.do/*",
        "https://www.notion.so/*",
        "https://notion.so/*",
        "https://github.com/*",
        "https://www.github.com/*",
        "https://www.zhihu.com/*",
        "https://zhuanlan.zhihu.com/*",
        "http://*/*",
        "https://*/*"
    ]),
    contentScriptExcludeMatches: Object.freeze([
        "https://www.google.com/*",
        "https://www.google.com.hk/*",
        "https://www.baidu.com/*",
        "https://www.bing.com/*",
        "https://duckduckgo.com/*",
        "https://mail.google.com/*",
        "https://outlook.live.com/*",
        "*://localhost/*",
        "*://127.0.0.1/*"
    ]),
    action: Object.freeze({
        default_popup: "popup.html",
        default_title: "LD-Notion"
    }),
    backgroundServiceWorker: "background.js",
    icons: Object.freeze({
        48: "icon48.png",
        128: "icon128.png"
    }),
});

const MANIFEST_PROFILE_PRESETS = Object.freeze({
    default: Object.freeze({
        hostPermissions: Object.freeze([
            "https://api.notion.com/*",
            "https://linux.do/*",
            "https://*.amazonaws.com/*",
            "https://s3.amazonaws.com/*",
            "https://api.openai.com/*",
            "https://api.anthropic.com/*",
            "https://generativelanguage.googleapis.com/*",
            "https://api.github.com/*"
        ]),
    }),
    bounded_hosts: Object.freeze({
        hostPermissions: Object.freeze([
            "https://api.notion.com/*",
            "https://linux.do/*",
            "https://*.amazonaws.com/*",
            "https://s3.amazonaws.com/*",
            "https://api.openai.com/*",
            "https://api.anthropic.com/*",
            "https://generativelanguage.googleapis.com/*",
            "https://api.github.com/*"
        ]),
    }),
});

function resolveBuildPaths({ src, outDir } = {}) {
    const resolvedSrc = src || process.env.LD_NOTION_BUILD_SRC || path.resolve(__dirname, "..", "LinuxDo-Bookmarks-to-Notion.user.js");
    const resolvedOutDir = outDir || process.env.LD_NOTION_BUILD_OUT_DIR || path.resolve(__dirname, "..", "chrome-extension-full");
    return {
        src: path.resolve(resolvedSrc),
        outDir: path.resolve(resolvedOutDir),
    };
}

function extractUserscriptVersion(source) {
    return source.match(/@version\s+(\S+)/)?.[1] || "3.2.0";
}

function extractUserscriptIifeBody(source) {
    if (typeof source !== "string" || !source.trim()) {
        throw new Error("用户脚本源码为空");
    }

    const anchoredRegion = findAnchoredRegion(
        source,
        BUILD_ANCHORS.userscriptBodyStart,
        BUILD_ANCHORS.userscriptBodyEnd,
        "userscript 主体"
    );
    if (anchoredRegion) {
        return source.slice(
            anchoredRegion.start + BUILD_ANCHORS.userscriptBodyStart.length,
            anchoredRegion.end - BUILD_ANCHORS.userscriptBodyEnd.length
        );
    }

    const iifeStartMatch = /\(function\s*\(\)\s*\{/.exec(source);
    const iifeEndMatch = /\}\)\(\);\s*$/.exec(source);
    if (!iifeStartMatch || !iifeEndMatch || iifeEndMatch.index <= iifeStartMatch.index) {
        throw new Error("无法定位 userscript IIFE 边界");
    }

    return source.slice(iifeStartMatch.index + iifeStartMatch[0].length, iifeEndMatch.index);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indentBlock(content, indent) {
    return content
        .trim()
        .split("\n")
        .map((line) => `${indent}${line}`)
        .join("\n");
}

function replaceArrowMethodBlock(objectSource, methodName, replacement) {
    // 匹配方法定义，兼容有逗号和无逗号（末尾方法）的情况
    const pattern = new RegExp(
        `(^|\\n)(\\s*)${escapeRegExp(methodName)}:\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\2\\},?`,
        "m"
    );

    if (!pattern.test(objectSource)) {
        throw new Error(`未找到 BookmarkBridge.${methodName} 的原始实现`);
    }

    return objectSource.replace(pattern, (match, prefix, indent) => {
        // 如果原始方法没有逗号（末尾方法），且替换内容有逗号，去掉替换的逗号
        const trimmedMatch = match.trimEnd();
        const hasComma = trimmedMatch.endsWith(",");
        let finalReplacement = indentBlock(replacement, indent);
        if (!hasComma && finalReplacement.trimEnd().endsWith(",")) {
            finalReplacement = finalReplacement.replace(/,(\s*)$/, "$1");
        }
        return `${prefix}${finalReplacement}`;
    });
}

function findMatchingBrace(source, openIndex) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = openIndex; i < source.length; i++) {
        const char = source[i];
        const next = source[i + 1];

        if (inLineComment) {
            if (char === "\n") inLineComment = false;
            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                i++;
            }
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === "\\") {
                escaped = true;
                continue;
            }
            if (char === quote) {
                quote = "";
            }
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            i++;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            i++;
            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }

        if (char === "{") {
            depth++;
            continue;
        }

        if (char === "}") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }

    throw new Error("未找到匹配的对象结束大括号");
}

function findAnchoredRegion(source, startMarker, endMarker, label) {
    const start = source.indexOf(startMarker);
    if (start === -1) {
        return null;
    }

    const end = source.indexOf(endMarker, start + startMarker.length);
    if (end === -1) {
        throw new Error(`未找到 ${label} 结束锚点`);
    }

    return {
        start,
        end: end + endMarker.length,
    };
}

function locateBookmarkBridgeObject(iifeBody) {
    // 兼容原始格式 (const BookmarkBridge = {) 和 esbuild 打包格式 (var BookmarkBridge3 = {)
    const declarationPattern = /\b(?:const|var|let)\s+BookmarkBridge\d*\s*=\s*\{/;
    const anchoredRegion = findAnchoredRegion(
        iifeBody,
        BUILD_ANCHORS.bookmarkBridgeStart,
        BUILD_ANCHORS.bookmarkBridgeEnd,
        "BookmarkBridge 构建区域"
    );

    if (anchoredRegion) {
        const anchoredBody = iifeBody.slice(anchoredRegion.start, anchoredRegion.end);
        const match = anchoredBody.match(declarationPattern);
        if (!match) {
            throw new Error("BookmarkBridge 构建锚点内未找到对象定义");
        }

        const relativeObjectStart = match.index;
        const objectStart = anchoredRegion.start + relativeObjectStart;
        const braceStart = iifeBody.indexOf("{", objectStart);
        const braceEnd = findMatchingBrace(iifeBody, braceStart);
        const semicolonIndex = iifeBody.indexOf(";", braceEnd);
        if (semicolonIndex === -1 || semicolonIndex >= anchoredRegion.end) {
            throw new Error("BookmarkBridge 构建锚点内未找到对象结束分号");
        }

        return { objectStart, semicolonIndex };
    }

    const match = iifeBody.match(declarationPattern);
    if (!match) {
        throw new Error("未找到 BookmarkBridge 对象");
    }

    const objectStart = match.index;
    const braceStart = iifeBody.indexOf("{", objectStart);
    const braceEnd = findMatchingBrace(iifeBody, braceStart);
    const semicolonIndex = iifeBody.indexOf(";", braceEnd);
    if (semicolonIndex === -1) {
        throw new Error("未找到 BookmarkBridge 对象结束分号");
    }

    return { objectStart, semicolonIndex };
}

function patchBookmarkBridgeForExtension(iifeBody) {
    const { objectStart, semicolonIndex } = locateBookmarkBridgeObject(iifeBody);

    const originalObject = iifeBody.slice(objectStart, semicolonIndex + 1);
    let patchedObject = originalObject;

    const methodReplacements = {
        isExtensionAvailable: `
isExtensionAvailable: () => {
    return !!(typeof chrome !== "undefined" && chrome.bookmarks);
},`,
        _request: `
_request: () => {
    throw new Error("扩展版不使用 _request");
},`,
        getBookmarkTree: `
getBookmarkTree: () => {
    return chrome.bookmarks.getTree();
},`,
        getBookmarks: `
getBookmarks: (folderId) => {
    return chrome.bookmarks.getChildren(folderId);
},`,
        searchBookmarks: `
searchBookmarks: (query) => {
    return chrome.bookmarks.search(query || "");
},`,
        init: `
init: () => {},`,
    };

    const patchedMethods = [];
    Object.entries(methodReplacements).forEach(([methodName, replacement]) => {
        patchedObject = replaceArrowMethodBlock(patchedObject, methodName, replacement);
        patchedMethods.push(methodName);
    });

    return {
        code: `${iifeBody.slice(0, objectStart)}${patchedObject}${iifeBody.slice(semicolonIndex + 1)}`,
        patchedMethods,
    };
}

function assertContains(source, snippet, label) {
    if (!source.includes(snippet)) {
        throw new Error(`扩展构建前置检查失败：缺少 ${label}`);
    }
}

function resolveManifestProfile(profileName) {
    const resolvedName = profileName || process.env.LD_NOTION_MANIFEST_PROFILE || DEFAULT_MANIFEST_PROFILE;
    const profile = MANIFEST_PROFILE_PRESETS[resolvedName];
    if (!profile) {
        throw new Error(`未知 manifest profile: ${resolvedName}`);
    }
    return {
        name: resolvedName,
        config: profile,
    };
}

function validatePatchedBuildAssumptions({ source, patchedBody, contentScript, backgroundScript, popupHtml, popupScript, manifest } = {}) {
    if (typeof source === "string") {
        assertContains(source, BUILD_ANCHORS.userscriptBodyStart, "userscript 主体开始锚点");
        assertContains(source, BUILD_ANCHORS.userscriptBodyEnd, "userscript 主体结束锚点");
        assertContains(source, BUILD_ANCHORS.bookmarkBridgeStart, "BookmarkBridge 构建开始锚点");
        assertContains(source, BUILD_ANCHORS.bookmarkBridgeEnd, "BookmarkBridge 构建结束锚点");
        // 兼容原始格式 (const BookmarkBridge = {) 和 esbuild 打包格式 (var BookmarkBridge3 = {)
        const bookmarkBridgeMatch = source.match(/\b(?:const|var|let)\s+BookmarkBridge\d*\s*=\s*\{/);
        if (!bookmarkBridgeMatch) {
            throw new Error("BookmarkBridge 对象定义未找到");
        }
    }

    if (typeof patchedBody === "string") {
        assertContains(patchedBody, BUILD_ANCHORS.bookmarkBridgeStart, "补丁后的 BookmarkBridge 开始锚点");
        assertContains(patchedBody, BUILD_ANCHORS.bookmarkBridgeEnd, "补丁后的 BookmarkBridge 结束锚点");
        assertContains(patchedBody, "isExtensionAvailable: () => {", "BookmarkBridge 可用性补丁");
        assertContains(patchedBody, "return chrome.bookmarks.getTree();", "BookmarkBridge getTree 补丁");
        assertContains(patchedBody, "return chrome.bookmarks.search(query || \"\");", "BookmarkBridge search 补丁");
    }

    if (typeof contentScript === "string") {
        assertContains(contentScript, GENERATED_SECTION_MARKERS.gmShimStart, "content script GM shim 开始锚点");
        assertContains(contentScript, GENERATED_SECTION_MARKERS.gmShimEnd, "content script GM shim 结束锚点");
        assertContains(contentScript, GENERATED_SECTION_MARKERS.bookmarkEventBridgeStart, "content script 书签桥接开始锚点");
        assertContains(contentScript, GENERATED_SECTION_MARKERS.bookmarkEventBridgeEnd, "content script 书签桥接结束锚点");
        assertContains(contentScript, GENERATED_SECTION_MARKERS.popupMessageBridgeStart, "content script popup 桥接开始锚点");
        assertContains(contentScript, GENERATED_SECTION_MARKERS.popupMessageBridgeEnd, "content script popup 桥接结束锚点");
        assertContains(contentScript, "await _gmInitStorage();", "GM storage 初始化");
        assertContains(contentScript, "chrome.runtime.onMessage.addListener", "content script popup 桥接监听");
        assertContains(contentScript, "window.addEventListener(\"ld-notion-request-bookmarks\"", "content script 书签请求桥接");
        assertContains(contentScript, "window.addEventListener(\"ld-notion-search-bookmarks\"", "content script 书签搜索桥接");
        assertContains(contentScript, "const LD_NOTION_ACTIVE_ROOT_SELECTOR =", "content script LD-Notion 活动根选择器");
        assertContains(contentScript, "if (!hasActiveLdNotionRoot())", "content script 活动根校验");
        assertContains(contentScript, "未检测到活动中的 LD-Notion 面板，已拒绝书签桥接请求。", "content script 非活动上下文拒绝文案");
    }

    if (typeof backgroundScript === "string") {
        assertContains(backgroundScript, "message.type !== \"GM_xmlhttpRequest\"", "background GM_xmlhttpRequest 分发");
        assertContains(backgroundScript, "return true;", "background 异步 sendResponse 约定");
    }

    if (typeof popupHtml === "string") {
        assertContains(popupHtml, "<script src=\"popup.js\"></script>", "popup HTML 脚本入口");
        assertContains(popupHtml, "id=\"import-bookmarks\"", "popup 书签导入按钮");
        assertContains(popupHtml, "id=\"import-github\"", "popup GitHub 导入按钮");
        assertContains(popupHtml, "id=\"open-bookmark-panel\"", "popup 收藏来源按钮");
    }

    if (typeof popupScript === "string") {
        assertContains(popupScript, "document.addEventListener(\"DOMContentLoaded\"", "popup DOMContentLoaded 入口");
        assertContains(popupScript, "LD_NOTION_IMPORT_BOOKMARKS", "popup 书签导入消息");
        assertContains(popupScript, "LD_NOTION_IMPORT_GITHUB", "popup GitHub 导入消息");
        assertContains(popupScript, "LD_NOTION_SET_BOOKMARK_SOURCE", "popup 收藏来源消息");
    }

    if (manifest && typeof manifest === "object") {
        const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
        const hasContentScript = contentScripts.some((entry) => Array.isArray(entry.js) && entry.js.includes("content.js"));
        if (!hasContentScript) {
            throw new Error("扩展构建后置检查失败：manifest 未声明 content.js");
        }
        if (manifest.background?.service_worker !== "background.js") {
            throw new Error("扩展构建后置检查失败：manifest 未声明 background.js");
        }
        if (manifest.action?.default_popup !== "popup.html") {
            throw new Error("扩展构建后置检查失败：manifest 未声明 popup.html");
        }
    }
}

function buildBackgroundScript() {
    return `// LD-Notion Chrome Extension — Background Service Worker
// 代理 HTTP 请求以绕过 CORS 限制

// 允许的域名白名单 (对应 manifest host_permissions)
const ALLOWED_HOSTS = [
    "api.notion.com", "linux.do", "*.linux.do",
    "api.github.com", "github.com", "*.github.com",
    "api.openai.com", "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "*.amazonaws.com", "s3.amazonaws.com",
    "zhihu.com", "*.zhihu.com",
    "127.0.0.1", "localhost"
];

function isUrlAllowed(url) {
    try {
        const host = new URL(url).hostname;
        return ALLOWED_HOSTS.some(pattern => {
            if (pattern.startsWith("*.")) {
                return host === pattern.slice(2) || host.endsWith(pattern.slice(1));
            }
            return host === pattern;
        });
    } catch { return false; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "GM_xmlhttpRequest") return false;

    const { method, url, headers, data } = message.payload;

    // URL 白名单校验
    if (!isUrlAllowed(url)) {
        sendResponse({ success: false, error: "Domain not allowed: " + (new URL(url).hostname || url) });
        return true;
    }

    const fetchOptions = {
        method: method || "GET",
        headers: headers || {},
    };

    if (data && method !== "GET") {
        fetchOptions.body = data;
    }

    fetch(url, fetchOptions)
        .then(async (response) => {
            const text = await response.text();
            // 提取 response headers
            const respHeaders = [];
            response.headers.forEach((value, key) => {
                respHeaders.push(key + ": " + value);
            });
            sendResponse({
                success: true,
                status: response.status,
                statusText: response.statusText,
                responseText: text,
                responseHeaders: respHeaders.join("\\r\\n"),
                finalUrl: response.url
            });
        })
        .catch((error) => {
            sendResponse({
                success: false,
                error: error.message
            });
        });

    // 返回 true 表示异步 sendResponse
    return true;
});
`;
}

function buildPopupHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
:root {
    --bg: #fff; --text: #1a1a2e; --muted: #64748b;
    --accent: #6366f1; --accent-hover: #4f46e5;
    --border: #e2e8f0; --card-bg: #f8fafc;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #1e1e2e; --text: #cdd6f4; --muted: #a6adc8;
        --accent: #89b4fa; --accent-hover: #74c7ec;
        --border: #45475a; --card-bg: #313244;
    }
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 320px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
.header { padding: 16px; text-align: center; border-bottom: 1px solid var(--border); }
.header h1 { font-size: 16px; font-weight: 600; }
.header p { font-size: 12px; color: var(--muted); margin-top: 4px; }
.actions { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.action-btn { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--card-bg); cursor: pointer; transition: all .15s; text-decoration: none; color: var(--text); }
.action-btn:hover { border-color: var(--accent); background: var(--bg); }
.action-btn .icon { font-size: 20px; width: 32px; text-align: center; }
.action-btn .label { font-size: 13px; font-weight: 500; }
.action-btn .desc { font-size: 11px; color: var(--muted); }
.status { padding: 12px; border-top: 1px solid var(--border); }
.status-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted); padding: 4px 0; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.status-dot.ok { background: #22c55e; }
.status-dot.err { background: #ef4444; }
</style>
</head>
<body>
<div class="header">
    <h1>LD-Notion</h1>
    <p>Notion AI \u52a9\u624b & \u591a\u6e90\u6536\u85cf\u7ba1\u7406</p>
</div>
<div class="actions">
    <a class="action-btn" id="goto-linuxdo" href="https://linux.do" target="_blank">
        <span class="icon">\ud83d\udcda</span>
        <div><div class="label">Linux.do \u6536\u85cf</div><div class="desc">\u6253\u5f00\u6536\u85cf\u9875\u9762\uff0c\u5bfc\u51fa\u5e16\u5b50\u5230 Notion</div></div>
    </a>
    <a class="action-btn" id="goto-notion" href="https://www.notion.so" target="_blank">
        <span class="icon">\ud83e\udde0</span>
        <div><div class="label">Notion AI \u52a9\u624b</div><div class="desc">\u5728 Notion \u4e2d\u4f7f\u7528 AI \u5bf9\u8bdd\u52a9\u624b</div></div>
    </a>
    <button class="action-btn" id="import-bookmarks">
        <span class="icon">\ud83d\udd16</span>
        <div><div class="label">\u5bfc\u5165\u6d4f\u89c8\u5668\u4e66\u7b7e</div><div class="desc">\u5c06\u4e66\u7b7e\u76f4\u63a5\u5bfc\u5165 Notion \u6570\u636e\u5e93</div></div>
    </button>
    <button class="action-btn" id="import-github">
        <span class="icon">\ud83d\udc19</span>
        <div><div class="label">GitHub \u6d3b\u52a8\u5bfc\u5165</div><div class="desc">\u5bfc\u5165 Stars\u3001Repos\u3001Forks\u3001Gists</div></div>
    </button>
    <button class="action-btn" id="open-bookmark-panel">
        <span class="icon">\ud83e\udde9</span>
        <div><div class="label">收藏来源页面</div><div class="desc">打开扩展页设置 Linux.do / GitHub 收藏分区</div></div>
    </button>
</div>
<div class="status" id="status-section">
    <div class="status-row">
        <span><span class="status-dot" id="notion-dot"></span>Notion API</span>
        <span id="notion-status">\u68c0\u6d4b\u4e2d...</span>
    </div>
    <div class="status-row">
        <span><span class="status-dot" id="bookmark-dot"></span>\u4e66\u7b7e API</span>
        <span id="bookmark-status">\u68c0\u6d4b\u4e2d...</span>
    </div>
</div>
<script src="popup.js"></script>
</body>
</html>`;
}

function buildPopupScript() {
    return `// LD-Notion Popup
document.addEventListener("DOMContentLoaded", async () => {
    // 检查 Notion API 配置
    const data = await chrome.storage.local.get(["ldb_notion_api_key"]);
    const notionDot = document.getElementById("notion-dot");
    const notionStatus = document.getElementById("notion-status");
    if (data.ldb_notion_api_key) {
        notionDot.classList.add("ok");
        notionStatus.textContent = "\u5df2\u914d\u7f6e";
    } else {
        notionDot.classList.add("err");
        notionStatus.textContent = "\u672a\u914d\u7f6e";
    }

    // 检查书签 API
    const bookmarkDot = document.getElementById("bookmark-dot");
    const bookmarkStatus = document.getElementById("bookmark-status");
    try {
        await chrome.bookmarks.getTree();
        bookmarkDot.classList.add("ok");
        bookmarkStatus.textContent = "\u53ef\u7528";
    } catch (e) {
        bookmarkDot.classList.add("err");
        bookmarkStatus.textContent = "\u4e0d\u53ef\u7528";
    }

    // 导入书签按钮 — 打开 Linux.do 收藏页面并通知 content script
    document.getElementById("import-bookmarks").addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab && tab.url && tab.url.includes("linux.do")) {
                // 当前在 linux.do，直接发消息
                chrome.tabs.sendMessage(tab.id, { type: "LD_NOTION_IMPORT_BOOKMARKS" });
                window.close();
            } else {
                // 打开 linux.do
                chrome.tabs.create({ url: "https://linux.do" });
                window.close();
            }
        });
    });

    // GitHub 导入按钮
    document.getElementById("import-github").addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            if (tab && tab.url && tab.url.includes("linux.do")) {
                chrome.tabs.sendMessage(tab.id, { type: "LD_NOTION_IMPORT_GITHUB" });
                window.close();
            } else {
                chrome.tabs.create({ url: "https://linux.do" });
                window.close();
            }
        });
    });

    // 收藏来源面板按钮
    document.getElementById("open-bookmark-panel").addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            const openAndSetSource = (tabId) => {
                chrome.tabs.sendMessage(tabId, {
                    type: "LD_NOTION_SET_BOOKMARK_SOURCE",
                    source: "github"
                }, () => {
                    window.close();
                });
            };

            if (tab && tab.url && tab.url.includes("linux.do")) {
                openAndSetSource(tab.id);
            } else {
                chrome.tabs.create({ url: "https://linux.do" }, (newTab) => {
                    if (!newTab || !newTab.id) {
                        window.close();
                        return;
                    }
                    setTimeout(() => {
                        openAndSetSource(newTab.id);
                    }, 900);
                });
            }
        });
    });
});
`;
}

function buildManifest({ version, profile } = {}) {
    const { config } = resolveManifestProfile(profile);
    return {
        manifest_version: 3,
        name: MANIFEST_SHARED_DEFAULTS.name,
        version: version || "3.2.0",
        description: MANIFEST_SHARED_DEFAULTS.description,
        permissions: [...MANIFEST_SHARED_DEFAULTS.permissions],
        host_permissions: [...config.hostPermissions],
        action: { ...MANIFEST_SHARED_DEFAULTS.action },
        background: {
            service_worker: MANIFEST_SHARED_DEFAULTS.backgroundServiceWorker
        },
        content_scripts: [
            {
                matches: [...MANIFEST_SHARED_DEFAULTS.contentScriptMatches],
                exclude_matches: [...MANIFEST_SHARED_DEFAULTS.contentScriptExcludeMatches],
                js: ["content.js"],
                run_at: "document_idle"
            }
        ],
        icons: { ...MANIFEST_SHARED_DEFAULTS.icons }
    };
}

function buildGmShim() {
    return `${GENERATED_SECTION_MARKERS.gmShimStart}
/**
 * GM_* API 垫片 — 将 Tampermonkey API 映射到 Chrome Extension API
 * 由 build-extension.js 自动生成
 */

// Storage 垫片 — 同步封装异步 chrome.storage.local
// 因为原脚本使用同步 GM_getValue/GM_setValue，
// 我们使用一个内存缓存 + 异步回写的策略
const _gmStorage = {};
let _gmStorageReady = false;
const _pendingWrites = {};
let _writeFlushScheduled = false;

function _flushPendingWrites() {
    _writeFlushScheduled = false;
    const batch = { ..._pendingWrites };
    for (const k of Object.keys(_pendingWrites)) delete _pendingWrites[k];
    if (Object.keys(batch).length > 0) {
        chrome.storage.local.set(batch);
    }
}

function _gmInitStorage() {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (data) => {
            Object.assign(_gmStorage, data || {});
            _gmStorageReady = true;
            resolve();
        });
    });
}

function GM_getValue(key, defaultValue) {
    if (key in _gmStorage) return _gmStorage[key];
    return defaultValue;
}

function GM_setValue(key, value) {
    _gmStorage[key] = value;
    _pendingWrites[key] = value;
    if (!_writeFlushScheduled) {
        _writeFlushScheduled = true;
        if (typeof queueMicrotask === "function") {
            queueMicrotask(_flushPendingWrites);
        } else {
            setTimeout(_flushPendingWrites, 0);
        }
    }
}

function GM_deleteValue(key) {
    delete _gmStorage[key];
    delete _pendingWrites[key];
    chrome.storage.local.remove(key);
}

// HTTP 请求垫片 — 通过 background service worker 代理
function GM_xmlhttpRequest(details) {
    const { method, url, headers, data, onload, onerror } = details;

    chrome.runtime.sendMessage(
        {
            type: "GM_xmlhttpRequest",
            payload: { method, url, headers, data }
        },
        (response) => {
            if (chrome.runtime.lastError) {
                if (onerror) onerror({ error: chrome.runtime.lastError.message });
                return;
            }
            if (response && response.success) {
                if (onload) onload({
                    status: response.status,
                    statusText: response.statusText || "",
                    responseText: response.responseText,
                    responseHeaders: response.responseHeaders || "",
                    response: response.responseText,
                    finalUrl: response.finalUrl || url
                });
            } else {
                if (onerror) onerror({
                    error: (response && response.error) || "Unknown error"
                });
            }
        }
    );
}

// 通知垫片
function GM_notification(detailsOrTitle, textOrUndefined) {
    let title, text;
    if (typeof detailsOrTitle === "object") {
        title = detailsOrTitle.title || "LD-Notion";
        text = detailsOrTitle.text || "";
    } else {
        title = detailsOrTitle || "LD-Notion";
        text = textOrUndefined || "";
    }

    if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icon128.png",
            title: title,
            message: text
        });
    }
}

// 标记桥接扩展可用（兼容 userscript 的 BookmarkBridge 检测）
if (typeof document !== "undefined" && document.head && !document.querySelector('meta[name="ld-notion-ext"]')) {
    const marker = document.createElement("meta");
    marker.name = "ld-notion-ext";
    marker.content = "ready";
    document.head.appendChild(marker);
}

const LD_NOTION_ACTIVE_ROOT_SELECTOR = "[data-ldb-root], .ldb-panel, .ldb-notion-panel, .gclip-panel";

function hasActiveLdNotionRoot() {
    return typeof document !== "undefined" && !!document.querySelector(LD_NOTION_ACTIVE_ROOT_SELECTOR);
}

function dispatchBookmarkBridgeResponse(detail) {
    window.dispatchEvent(new CustomEvent("ld-notion-bookmarks-data", { detail }));
}

function rejectBookmarkBridgeRequest(requestId, error) {
    if (!requestId) return;
    dispatchBookmarkBridgeResponse({
        requestId,
        success: false,
        error: error || "书签请求失败"
    });
}

// 兼容 userscript 的 CustomEvent 书签桥接协议
${GENERATED_SECTION_MARKERS.bookmarkEventBridgeStart}
window.addEventListener("ld-notion-request-bookmarks", async (event) => {
    const { requestId, folderId } = event.detail || {};
    if (!requestId) return;
    if (!hasActiveLdNotionRoot()) {
        rejectBookmarkBridgeRequest(requestId, "未检测到活动中的 LD-Notion 面板，已拒绝书签桥接请求。");
        return;
    }
    try {
        const data = folderId
            ? await chrome.bookmarks.getChildren(folderId)
            : await chrome.bookmarks.getTree();
        dispatchBookmarkBridgeResponse({ requestId, success: true, data });
    } catch (error) {
        rejectBookmarkBridgeRequest(requestId, error?.message || String(error));
    }
});

window.addEventListener("ld-notion-search-bookmarks", async (event) => {
    const { requestId, query } = event.detail || {};
    if (!requestId) return;
    if (!hasActiveLdNotionRoot()) {
        rejectBookmarkBridgeRequest(requestId, "未检测到活动中的 LD-Notion 面板，已拒绝书签桥接请求。");
        return;
    }
    try {
        const data = await chrome.bookmarks.search(query || "");
        dispatchBookmarkBridgeResponse({ requestId, success: true, data });
    } catch (error) {
        rejectBookmarkBridgeRequest(requestId, error?.message || String(error));
    }
});
${GENERATED_SECTION_MARKERS.bookmarkEventBridgeEnd}

// Popup 消息监听 — 接收来自 popup.js 的快捷操作指令
${GENERATED_SECTION_MARKERS.popupMessageBridgeStart}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "LD_NOTION_IMPORT_BOOKMARKS") {
        // 触发书签导入（模拟点击 AI 对话中的书签导入）
        const event = new CustomEvent("ld-notion-popup-action", { detail: { action: "import-bookmarks" } });
        window.dispatchEvent(event);
        sendResponse({ ok: true });
    } else if (message.type === "LD_NOTION_IMPORT_GITHUB") {
        const event = new CustomEvent("ld-notion-popup-action", { detail: { action: "import-github" } });
        window.dispatchEvent(event);
        sendResponse({ ok: true });
    } else if (message.type === "LD_NOTION_SET_BOOKMARK_SOURCE") {
        const event = new CustomEvent("ld-notion-popup-action", {
            detail: { action: "set-bookmark-source", source: message.source || "github" }
        });
        window.dispatchEvent(event);
        sendResponse({ ok: true });
    }
});
${GENERATED_SECTION_MARKERS.popupMessageBridgeEnd}
${GENERATED_SECTION_MARKERS.gmShimEnd}
`;
}

function buildContentScript({ gmShim, patchedBody } = {}) {
    return `// LD-Notion Chrome Extension — Content Script
// 由 build-extension.js 从油猴脚本自动生成
// 版本同步自: LinuxDo-Bookmarks-to-Notion.user.js

${gmShim}

// 等待 Storage 初始化完成后再执行主逻辑
(async function () {
    await _gmInitStorage();

    // === 原始脚本逻辑（IIFE 内部，已补丁 BookmarkBridge） ===
    "use strict";
${patchedBody}
})();
`;
}

function buildExtension({ src, outDir, source, manifestProfile } = {}) {
    const paths = resolveBuildPaths({ src, outDir });
    const resolvedSource = typeof source === "string" ? source : fs.readFileSync(paths.src, "utf8");
    const iifeBody = extractUserscriptIifeBody(resolvedSource);
    const { code: patchedBody, patchedMethods } = patchBookmarkBridgeForExtension(iifeBody);
    validatePatchedBuildAssumptions({ source: resolvedSource, patchedBody });

    if (!fs.existsSync(paths.outDir)) {
        fs.mkdirSync(paths.outDir, { recursive: true });
    }

    const gmShim = buildGmShim();
    const contentScript = buildContentScript({ gmShim, patchedBody });

    const backgroundJs = buildBackgroundScript();
    const popupHtml = buildPopupHtml();
    const popupJs = buildPopupScript();
    const { name: manifestProfileName } = resolveManifestProfile(manifestProfile);
    const manifest = buildManifest({ version: extractUserscriptVersion(resolvedSource), profile: manifestProfileName });

    validatePatchedBuildAssumptions({ contentScript, backgroundScript: backgroundJs, popupHtml, popupScript: popupJs, manifest });

    fs.writeFileSync(path.join(paths.outDir, "content.js"), contentScript, "utf8");
    fs.writeFileSync(path.join(paths.outDir, "background.js"), backgroundJs, "utf8");
    fs.writeFileSync(path.join(paths.outDir, "popup.html"), popupHtml, "utf8");
    fs.writeFileSync(path.join(paths.outDir, "popup.js"), popupJs, "utf8");
    fs.writeFileSync(path.join(paths.outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    console.log(`🔧 BookmarkBridge 扩展补丁已应用: ${patchedMethods.join(", ")}`);
    console.log("ℹ️  书签 API 已通过 BookmarkBridge 补丁 + manifest permissions 直接获取");

    ["icon48.png", "icon128.png"].forEach((iconName) => {
        const srcIcon = path.resolve(__dirname, "..", "chrome-extension", iconName);
        if (fs.existsSync(srcIcon)) {
            fs.copyFileSync(srcIcon, path.join(paths.outDir, iconName));
            console.log(`📋 复制图标: ${iconName}`);
        } else {
            const size = parseInt(iconName.match(/\d+/)[0], 10);
            const png = generateIcon(size);
            fs.writeFileSync(path.join(paths.outDir, iconName), png);
            console.log(`🎨 生成图标: ${iconName} (${png.length} bytes)`);
        }
    });

    const contentSize = Buffer.byteLength(contentScript, "utf8");
    console.log("\n✅ Chrome 扩展构建完成");
    console.log(`   📁 输出目录: ${paths.outDir}`);
    console.log(`   📄 content.js: ${(contentSize / 1024).toFixed(1)} KB`);
    console.log("   📄 background.js: Service Worker (CORS 代理)");
    console.log("   📄 manifest.json: Manifest V3");
    console.log("\n   安装方式:");
    console.log("   1. 打开 chrome://extensions/");
    console.log("   2. 开启「开发者模式」");
    console.log("   3. 点击「加载已解压的扩展程序」");
    console.log(`   4. 选择 ${paths.outDir}`);

    return {
        outDir: paths.outDir,
        manifestProfile: manifestProfileName,
        patchedMethods,
        contentPath: path.join(paths.outDir, "content.js"),
        manifestPath: path.join(paths.outDir, "manifest.json"),
    };
}

function generateIcon(size) {
    const zlib = require("zlib");
    const pixels = Buffer.alloc(size * size * 4);
    const r = size * 0.2;
    const thick = Math.max(2, Math.floor(size * 0.06));

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const cx = x / size;
            const cy = y / size;
            let inRect = true;
            const corners = [[r, r], [size - r - 1, r], [r, size - r - 1], [size - r - 1, size - r - 1]];
            if (x < r && y < r) inRect = Math.hypot(x - corners[0][0], y - corners[0][1]) <= r;
            else if (x >= size - r && y < r) inRect = Math.hypot(x - corners[1][0], y - corners[1][1]) <= r;
            else if (x < r && y >= size - r) inRect = Math.hypot(x - corners[2][0], y - corners[2][1]) <= r;
            else if (x >= size - r && y >= size - r) inRect = Math.hypot(x - corners[3][0], y - corners[3][1]) <= r;

            if (inRect) {
                const t = (cx + cy) / 2;
                pixels[i] = Math.round(99 * (1 - t) + 139 * t);
                pixels[i + 1] = Math.round(102 * (1 - t) + 92 * t);
                pixels[i + 2] = Math.round(241 * (1 - t) + 246 * t);
                pixels[i + 3] = 255;
            }
        }
    }

    const ls = Math.floor(size * 0.4);
    const sx = Math.floor(size * 0.15);
    const sy = Math.floor(size * 0.3);

    function setW(px, py) {
        for (let dx = 0; dx < thick; dx++) {
            for (let dy = 0; dy < thick; dy++) {
                const fx = px + dx;
                const fy = py + dy;
                if (fx < size && fy < size) {
                    const j = (fy * size + fx) * 4;
                    if (pixels[j + 3] > 0) {
                        pixels[j] = 255;
                        pixels[j + 1] = 255;
                        pixels[j + 2] = 255;
                    }
                }
            }
        }
    }

    for (let dy = 0; dy < ls; dy++) setW(sx, sy + dy);
    for (let dx = 0; dx < ls * 0.6; dx++) setW(sx + dx, sy + ls - thick);
    const ns = sx + Math.floor(ls * 0.7);
    for (let dy = 0; dy < ls; dy++) {
        setW(ns, sy + dy);
        setW(ns + Math.floor(ls * 0.6), sy + dy);
        setW(ns + Math.floor(dy * ls * 0.6 / ls), sy + dy);
    }

    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    const compressed = zlib.deflateSync(raw);

    function crc32(buffer) {
        let crc = 0xFFFFFFFF;
        const table = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let value = n;
            for (let k = 0; k < 8; k++) {
                value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
            }
            table[n] = value;
        }
        for (let i = 0; i < buffer.length; i++) {
            crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function chunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    }

    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

module.exports = {
    BUILD_ANCHORS,
    DEFAULT_MANIFEST_PROFILE,
    GENERATED_SECTION_MARKERS,
    MANIFEST_PROFILE_PRESETS,
    assertContains,
    buildBackgroundScript,
    buildContentScript,
    buildExtension,
    buildGmShim,
    buildManifest,
    buildPopupHtml,
    buildPopupScript,
    extractUserscriptIifeBody,
    extractUserscriptVersion,
    findAnchoredRegion,
    patchBookmarkBridgeForExtension,
    resolveBuildPaths,
    resolveManifestProfile,
    validatePatchedBuildAssumptions,
};

if (require.main === module) {
    // 支持 --src 参数指定源文件路径
    const srcArg = process.argv.find((a, i) => i > 0 && process.argv[i - 1] === "--src");
    try {
        buildExtension({ src: srcArg || undefined });
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }
}
