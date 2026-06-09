const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ACTIVE_ROOT_SELECTOR = "[data-ldb-root], .ldb-panel, .ldb-notion-panel, .gclip-panel";
const BRIDGE_DENIAL_MESSAGE = "未检测到活动中的 LD-Notion 面板，已拒绝书签桥接请求。";
const contentScriptPath = path.resolve(__dirname, "..", "chrome-extension", "content-script.js");
const contentScriptSource = fs.readFileSync(contentScriptPath, "utf8");

class CustomEventStub {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

function createEventTarget() {
    const listeners = new Map();

    return {
        addEventListener(type, handler) {
            const current = listeners.get(type) || [];
            current.push(handler);
            listeners.set(type, current);
        },
        removeEventListener(type, handler) {
            const current = listeners.get(type) || [];
            listeners.set(type, current.filter((entry) => entry !== handler));
        },
        dispatchEvent(event) {
            const current = [...(listeners.get(event.type) || [])];
            current.forEach((handler) => handler.call(this, event));
            return true;
        },
    };
}

function createDocumentStub({ hasActiveRoot }) {
    const injectedNodes = [];
    const appendChild = (node) => {
        injectedNodes.push(node);
        return node;
    };

    return {
        injectedNodes,
        head: { appendChild },
        documentElement: { appendChild },
        createElement(tagName) {
            return {
                tagName: String(tagName || "").toUpperCase(),
                name: "",
                content: "",
            };
        },
        querySelector(selector) {
            if (selector === ACTIVE_ROOT_SELECTOR) {
                return hasActiveRoot ? { nodeType: 1 } : null;
            }
            if (selector === 'meta[name="ld-notion-ext"]') {
                return injectedNodes.find((node) => node.name === "ld-notion-ext") || null;
            }
            return null;
        },
    };
}

function createChromeStub() {
    const callCounts = {
        getTree: 0,
        getChildren: 0,
        search: 0,
    };
    const fixture = {
        tree: [{ id: "root", title: "Bookmarks Bar" }],
        folderChildren: [{ id: "child-1", title: "LD-Notion Repo" }],
        searchResults: [{ id: "search-1", title: "LD-Notion Search Hit" }],
    };

    return {
        callCounts,
        fixture,
        bookmarks: {
            async getTree() {
                callCounts.getTree += 1;
                return fixture.tree;
            },
            async getChildren(folderId) {
                callCounts.getChildren += 1;
                return fixture.folderChildren.map((entry) => ({ ...entry, parentId: folderId }));
            },
            async search(query) {
                callCounts.search += 1;
                return fixture.searchResults.map((entry) => ({ ...entry, query }));
            },
        },
    };
}

function createHarness({ hasActiveRoot }) {
    const window = createEventTarget();
    const document = createDocumentStub({ hasActiveRoot });
    const chrome = createChromeStub();
    const bootstrap = new Function("window", "document", "chrome", "CustomEvent", contentScriptSource);

    bootstrap(window, document, chrome, CustomEventStub);

    return { window, document, chrome };
}

function waitForBridgeResponse(window, requestId, timeoutMs = 100) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener("ld-notion-bookmarks-data", handleResponse);
            reject(new Error(`等待桥接响应超时: ${requestId}`));
        }, timeoutMs);

        const handleResponse = (event) => {
            if (event?.detail?.requestId !== requestId) return;
            clearTimeout(timer);
            window.removeEventListener("ld-notion-bookmarks-data", handleResponse);
            resolve(event.detail);
        };

        window.addEventListener("ld-notion-bookmarks-data", handleResponse);
    });
}

async function dispatchBridgeRequest(harness, type, detail) {
    const responsePromise = waitForBridgeResponse(harness.window, detail.requestId);
    harness.window.dispatchEvent(new CustomEventStub(type, { detail }));
    return responsePromise;
}

async function verifyInactiveRootBoundary() {
    const harness = createHarness({ hasActiveRoot: false });
    const marker = harness.document.querySelector('meta[name="ld-notion-ext"]');

    assert.ok(marker, "content script 应注入 ld-notion-ext ready 标记");
    assert.strictEqual(marker.content, "ready");

    const denied = await dispatchBridgeRequest(harness, "ld-notion-request-bookmarks", {
        requestId: "deny-bookmarks",
    });

    assert.deepStrictEqual(denied, {
        requestId: "deny-bookmarks",
        success: false,
        error: BRIDGE_DENIAL_MESSAGE,
    });
    assert.strictEqual(harness.chrome.callCounts.getTree, 0);
    assert.strictEqual(harness.chrome.callCounts.getChildren, 0);

    const deniedSearch = await dispatchBridgeRequest(harness, "ld-notion-search-bookmarks", {
        requestId: "deny-search",
        query: "ld-notion",
    });

    assert.deepStrictEqual(deniedSearch, {
        requestId: "deny-search",
        success: false,
        error: BRIDGE_DENIAL_MESSAGE,
    });
    assert.strictEqual(harness.chrome.callCounts.search, 0);
}

async function verifyActiveRootBookmarkFlow() {
    const harness = createHarness({ hasActiveRoot: true });

    const folderResponse = await dispatchBridgeRequest(harness, "ld-notion-request-bookmarks", {
        requestId: "folder-request",
        folderId: "folder-123",
    });

    assert.strictEqual(folderResponse.requestId, "folder-request");
    assert.strictEqual(folderResponse.success, true);
    assert.deepStrictEqual(folderResponse.data, [
        { id: "child-1", title: "LD-Notion Repo", parentId: "folder-123" },
    ]);
    assert.strictEqual(harness.chrome.callCounts.getTree, 1);
    assert.strictEqual(harness.chrome.callCounts.getChildren, 1);

    const treeResponse = await dispatchBridgeRequest(harness, "ld-notion-request-bookmarks", {
        requestId: "tree-request",
    });

    assert.strictEqual(treeResponse.success, true);
    assert.deepStrictEqual(treeResponse.data, harness.chrome.fixture.tree);
    assert.strictEqual(harness.chrome.callCounts.getTree, 2);

    const searchResponse = await dispatchBridgeRequest(harness, "ld-notion-search-bookmarks", {
        requestId: "search-request",
        query: "notion",
    });

    assert.strictEqual(searchResponse.requestId, "search-request");
    assert.strictEqual(searchResponse.success, true);
    assert.deepStrictEqual(searchResponse.data, [
        { id: "search-1", title: "LD-Notion Search Hit", query: "notion" },
    ]);
    assert.strictEqual(harness.chrome.callCounts.search, 1);
}

async function verifyMissingRequestIdIsIgnored() {
    const harness = createHarness({ hasActiveRoot: true });
    let responseCount = 0;

    harness.window.addEventListener("ld-notion-bookmarks-data", () => {
        responseCount += 1;
    });

    harness.window.dispatchEvent(new CustomEventStub("ld-notion-request-bookmarks", {
        detail: { folderId: "folder-ignored" },
    }));
    harness.window.dispatchEvent(new CustomEventStub("ld-notion-search-bookmarks", {
        detail: { query: "ignored" },
    }));

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(responseCount, 0, "缺失 requestId 的桥接请求应被忽略");
}

async function main() {
    await verifyInactiveRootBoundary();
    await verifyActiveRootBookmarkFlow();
    await verifyMissingRequestIdIsIgnored();
    console.log("✅ Bridge extension runtime smoke passed");
}

main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
});
