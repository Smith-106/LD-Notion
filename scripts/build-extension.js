/**
 * LD-Notion 构建脚本
 * 从油猴脚本生成 Chrome 扩展版本
 *
 * 用法: node scripts/build-extension.js
 */

const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "LinuxDo-Bookmarks-to-Notion.user.js");
const OUT_DIR = path.resolve(__dirname, "..", "chrome-extension-full");

// 1. 读取源文件
const source = fs.readFileSync(SRC, "utf-8");

// 2. 提取 IIFE 内部代码（去掉 userscript 元数据和 IIFE 包装）
const iifeStart = source.indexOf('(function () {');
const iifeEnd = source.lastIndexOf('})();');
if (iifeStart === -1 || iifeEnd === -1) {
    console.error("❌ 无法定位 IIFE 边界");
    process.exit(1);
}

// 提取 IIFE 内部代码（不含包装）
const iifeBody = source.substring(iifeStart + '(function () {'.length, iifeEnd);

// 3. 生成输出目录
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// 4. 生成 GM_* 垫片
const gmShim = `/**
 * GM_* API 垫片 — 将 Tampermonkey API 映射到 Chrome Extension API
 * 由 build-extension.js 自动生成
 */

// Storage 垫片 — 同步封装异步 chrome.storage.local
// 因为原脚本使用同步 GM_getValue/GM_setValue，
// 我们使用一个内存缓存 + 异步回写的策略
const _gmStorage = {};
let _gmStorageReady = false;

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
    chrome.storage.local.set({ [key]: value });
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

// Popup 消息监听 — 接收来自 popup.js 的快捷操作指令
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
`;

// 5. 在 IIFE body 中将 BookmarkBridge 替换为直接使用 chrome.bookmarks API 的版本
// 原版通过 CustomEvent 与配套扩展通信，扩展版直接拥有 bookmarks 权限无需桥接
const bookmarkBridgeOriginal = `const BookmarkBridge = {
        _requestId: 0,
        _pendingRequests: {},

        // 检测配套 Chrome 扩展是否已安装
        isExtensionAvailable: () => {
            return !!document.querySelector('meta[name="ld-notion-ext"][content="ready"]');
        },`;

const bookmarkBridgeReplacement = `const BookmarkBridge = {
        _requestId: 0,
        _pendingRequests: {},

        // Chrome 扩展版：直接使用 chrome.bookmarks API，无需桥接
        isExtensionAvailable: () => {
            return !!(typeof chrome !== "undefined" && chrome.bookmarks);
        },`;

let patchedBody = iifeBody;
if (iifeBody.includes(bookmarkBridgeOriginal)) {
    patchedBody = iifeBody.replace(bookmarkBridgeOriginal, bookmarkBridgeReplacement);
    console.log("🔧 BookmarkBridge.isExtensionAvailable 已替换为 chrome.bookmarks 检测");
} else {
    console.warn("⚠️  未找到 BookmarkBridge 原始代码，跳过书签 API 补丁");
}

// 替换 BookmarkBridge 的请求方法为直接 API 调用
const requestOriginal = `// 发起书签请求
        _request: (eventName, detail = {}) => {
            return new Promise((resolve, reject) => {
                if (!BookmarkBridge.isExtensionAvailable()) {
                    reject(new Error("未检测到 LD-Notion 书签桥接扩展。请先安装 chrome-extension 目录中的扩展。"));
                    return;
                }

                const requestId = \`req_\${++BookmarkBridge._requestId}_\${Date.now()}\`;
                const timeout = setTimeout(() => {
                    delete BookmarkBridge._pendingRequests[requestId];
                    reject(new Error("书签请求超时，请检查扩展是否正常运行。"));
                }, 10000);

                BookmarkBridge._pendingRequests[requestId] = { resolve, reject, timeout };

                window.dispatchEvent(new CustomEvent(eventName, {
                    detail: { requestId, ...detail }
                }));
            });
        },

        // 获取书签树
        getBookmarkTree: () => {
            return BookmarkBridge._request("ld-notion-request-bookmarks");
        },

        // 获取指定文件夹的书签
        getBookmarks: (folderId) => {
            return BookmarkBridge._request("ld-notion-request-bookmarks", { folderId });
        },

        // 搜索书签
        searchBookmarks: (query) => {
            return BookmarkBridge._request("ld-notion-search-bookmarks", { query });
        },

        // 初始化响应监听器
        init: () => {
            window.addEventListener("ld-notion-bookmarks-data", (event) => {
                const { requestId, success, data, error } = event.detail || {};
                const pending = BookmarkBridge._pendingRequests[requestId];
                if (!pending) return;

                clearTimeout(pending.timeout);
                delete BookmarkBridge._pendingRequests[requestId];

                if (success) {
                    pending.resolve(data);
                } else {
                    pending.reject(new Error(error || "书签请求失败"));
                }
            });
        },
    };`;

const requestReplacement = `// Chrome 扩展版：直接调用 chrome.bookmarks API
        _request: () => { throw new Error("扩展版不使用 _request"); },

        // 获取书签树
        getBookmarkTree: () => {
            return chrome.bookmarks.getTree();
        },

        // 获取指定文件夹的书签
        getBookmarks: (folderId) => {
            return chrome.bookmarks.getChildren(folderId);
        },

        // 搜索书签
        searchBookmarks: (query) => {
            return chrome.bookmarks.search(query || "");
        },

        // 初始化（扩展版无需初始化响应监听器）
        init: () => {},
    };`;

if (patchedBody.includes(requestOriginal)) {
    patchedBody = patchedBody.replace(requestOriginal, requestReplacement);
    console.log("🔧 BookmarkBridge 请求方法已替换为 chrome.bookmarks 直接调用");
} else {
    console.warn("⚠️  未找到 BookmarkBridge._request 原始代码，跳过请求方法补丁");
}

// 6. 生成 content script（GM 垫片 + 补丁后 IIFE 内部代码）
const contentScript = `// LD-Notion Chrome Extension — Content Script
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

// 7. 生成 background service worker（处理 CORS 代理）
const backgroundJs = `// LD-Notion Chrome Extension — Background Service Worker
// 代理 HTTP 请求以绕过 CORS 限制

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "GM_xmlhttpRequest") return false;

    const { method, url, headers, data } = message.payload;

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

// 8. 生成 popup.html（扩展弹出窗口 — 快速入口）
const popupHtml = `<!DOCTYPE html>
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

// 9. 生成 popup.js
const popupJs = `// LD-Notion Popup
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

// 10. 生成 manifest.json
const manifest = {
    manifest_version: 3,
    name: "LD-Notion — Notion AI 助手 & 多源收藏管理",
    version: source.match(/@version\s+(\S+)/)?.[1] || "3.2.0",
    description: "将 Linux.do、GitHub、浏览器书签与 Notion 深度连接：AI 对话式助手、批量导出收藏、跨源智能搜索与推荐",
    permissions: [
        "storage",
        "bookmarks",
        "notifications",
        "activeTab"
    ],
    host_permissions: [
        "https://api.notion.com/*",
        "https://linux.do/*",
        "https://*.amazonaws.com/*",
        "https://api.openai.com/*",
        "https://api.anthropic.com/*",
        "https://generativelanguage.googleapis.com/*",
        "https://api.github.com/*",
        "http://*/*",
        "https://*/*"
    ],
    action: {
        default_popup: "popup.html",
        default_title: "LD-Notion"
    },
    background: {
        service_worker: "background.js"
    },
    content_scripts: [
        {
            matches: [
                "https://linux.do/*",
                "https://www.notion.so/*",
                "https://notion.so/*"
            ],
            js: ["content.js"],
            run_at: "document_idle"
        }
    ],
    icons: {
        48: "icon48.png",
        128: "icon128.png"
    }
};

// 11. 写入文件
fs.writeFileSync(path.join(OUT_DIR, "content.js"), contentScript, "utf-8");
fs.writeFileSync(path.join(OUT_DIR, "background.js"), backgroundJs, "utf-8");
fs.writeFileSync(path.join(OUT_DIR, "popup.html"), popupHtml, "utf-8");
fs.writeFileSync(path.join(OUT_DIR, "popup.js"), popupJs, "utf-8");
fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

// 复制书签桥接的 content script（已在 content script 中通过补丁直接使用 chrome.bookmarks API）
console.log("ℹ️  书签 API 已通过 BookmarkBridge 补丁 + manifest permissions 直接获取");

// 复制或生成图标
["icon48.png", "icon128.png"].forEach(iconName => {
    const src = path.resolve(__dirname, "..", "chrome-extension", iconName);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(OUT_DIR, iconName));
        console.log(`📋 复制图标: ${iconName}`);
    } else {
        // 自动生成简约 PNG 图标
        const size = parseInt(iconName.match(/\d+/)[0]);
        const png = generateIcon(size);
        fs.writeFileSync(path.join(OUT_DIR, iconName), png);
        console.log(`🎨 生成图标: ${iconName} (${png.length} bytes)`);
    }
});

function generateIcon(size) {
    const zlib = require("zlib");
    const pixels = Buffer.alloc(size * size * 4);
    const r = size * 0.2, thick = Math.max(2, Math.floor(size * 0.06));

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const cx = x / size, cy = y / size;
            // Rounded rectangle
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

    // Draw "LN" letters
    const ls = Math.floor(size * 0.4), sx = Math.floor(size * 0.15), sy = Math.floor(size * 0.3);
    function setW(px, py) {
        for (let dx = 0; dx < thick; dx++) for (let dy = 0; dy < thick; dy++) {
            const fx = px + dx, fy = py + dy;
            if (fx < size && fy < size) { const j = (fy * size + fx) * 4; if (pixels[j + 3] > 0) pixels[j] = pixels[j + 1] = pixels[j + 2] = 255; }
        }
    }
    for (let dy = 0; dy < ls; dy++) setW(sx, sy + dy);
    for (let dx = 0; dx < ls * 0.6; dx++) setW(sx + dx, sy + ls - thick);
    const ns = sx + Math.floor(ls * 0.7);
    for (let dy = 0; dy < ls; dy++) { setW(ns, sy + dy); setW(ns + Math.floor(ls * 0.6), sy + dy); setW(ns + Math.floor(dy * ls * 0.6 / ls), sy + dy); }

    // Build PNG
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
    const compressed = zlib.deflateSync(raw);

    function crc32(buf) {
        let c = 0xFFFFFFFF;
        const tbl = new Int32Array(256);
        for (let n = 0; n < 256; n++) { let v = n; for (let k = 0; k < 8; k++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1); tbl[n] = v; }
        for (let i = 0; i < buf.length; i++) c = tbl[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function chunk(type, data) {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    }
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

// 12. 报告
const contentSize = Buffer.byteLength(contentScript, "utf-8");
console.log(`\n✅ Chrome 扩展构建完成`);
console.log(`   📁 输出目录: ${OUT_DIR}`);
console.log(`   📄 content.js: ${(contentSize / 1024).toFixed(1)} KB`);
console.log(`   📄 background.js: Service Worker (CORS 代理)`);
console.log(`   📄 manifest.json: Manifest V3`);
console.log(`\n   安装方式:`);
console.log(`   1. 打开 chrome://extensions/`);
console.log(`   2. 开启「开发者模式」`);
console.log(`   3. 点击「加载已解压的扩展程序」`);
console.log(`   4. 选择 ${OUT_DIR}`);
