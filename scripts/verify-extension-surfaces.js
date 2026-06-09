const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const { buildExtension } = require("./build-extension.js");

const TEST_OVERRIDE_INJECTION = `
globalThis.__LD_NOTION_TEST_HOOKS__ = {
    AutoImporter,
    BookmarkAutoImporter,
    DesignSystem,
    GenericUI,
    GitHubAutoImporter,
    NotionOAuth,
    NotionSiteUI,
    SiteDetector,
    UI,
    UpdateChecker,
};
if (globalThis.__LD_NOTION_TEST_OVERRIDES__ && typeof globalThis.__LD_NOTION_TEST_OVERRIDES__ === "object") {
    [
        "AutoImporter",
        "BookmarkAutoImporter",
        "DesignSystem",
        "GenericUI",
        "GitHubAutoImporter",
        "NotionOAuth",
        "NotionSiteUI",
        "UI",
        "UpdateChecker",
    ].forEach((key) => {
        const target = globalThis.__LD_NOTION_TEST_HOOKS__[key];
        const overrides = globalThis.__LD_NOTION_TEST_OVERRIDES__[key];
        if (target && overrides && typeof overrides === "object") {
            Object.assign(target, overrides);
        }
    });
}
`;

function createElementStub() {
    const element = {
        value: "",
        innerHTML: "",
        placeholder: "",
        style: {},
        dataset: {},
        checked: false,
        disabled: false,
        appendChild: () => {},
        removeChild: () => {},
        setAttribute: () => {},
        getAttribute: () => "",
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        focus: () => {},
        blur: () => {},
        click: () => {},
        remove: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
        offsetHeight: 0,
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    };

    let textContent = "";
    Object.defineProperty(element, "textContent", {
        enumerable: true,
        get() {
            return textContent;
        },
        set(value) {
            textContent = String(value);
            element.innerHTML = textContent;
        },
    });

    return element;
}

class CustomEventStub {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

function instrumentBuiltContent(source) {
    const pattern = /\n\s*main\(\);\s*\n\s*\}\)\(\);\s*$/;
    if (!pattern.test(source)) {
        throw new Error("无法定位 built content script 的 main() 收尾锚点");
    }
    return source.replace(pattern, `\n${TEST_OVERRIDE_INJECTION}\n    main();\n})();`);
}

function createHarness(url, events) {
    const selectorMap = new Map();
    const selectorAllMap = new Map();
    let currentHref = new URL(url).toString();
    const appendedMetaNodes = [];

    const locationObject = {};
    ["href", "hostname", "pathname", "protocol", "origin", "search", "hash"].forEach((key) => {
        Object.defineProperty(locationObject, key, {
            enumerable: true,
            get() {
                const current = new URL(currentHref);
                if (key === "href") return current.href;
                return current[key];
            },
            set(value) {
                if (key !== "href") return;
                currentHref = new URL(value, currentHref).toString();
            },
        });
    });

    const appendNode = (node) => {
        if (node?.name === "ld-notion-ext") {
            appendedMetaNodes.push(node);
        }
        return node;
    };

    const sandbox = {
        window: {
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
            open: () => ({}),
            prompt: () => "",
            location: locationObject,
            history: {
                replaceState: (_state, _title, nextUrl) => {
                    currentHref = new URL(nextUrl, currentHref).toString();
                },
            },
            navigator: { userAgent: "Node.js" },
            setTimeout: global.setTimeout,
            clearTimeout: global.clearTimeout,
            matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
            requestIdleCallback: (cb) => cb(),
            crypto: global.crypto || require("crypto").webcrypto,
        },
        document: {
            title: "Test",
            readyState: "complete",
            activeElement: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
            createElement: createElementStub,
            getElementById: () => null,
            querySelector: (selector) => {
                if (selector === 'meta[name="ld-notion-ext"]') {
                    return appendedMetaNodes.find((node) => node.name === "ld-notion-ext") || null;
                }
                return selectorMap.get(selector) || null;
            },
            querySelectorAll: (selector) => selectorAllMap.get(selector) || [],
            body: { appendChild: appendNode },
            head: { appendChild: appendNode },
            documentElement: { appendChild: appendNode },
            location: locationObject,
        },
        Node: {
            ELEMENT_NODE: 1,
            TEXT_NODE: 3,
        },
        navigator: { userAgent: "Node.js" },
        location: locationObject,
        HTMLElement: class {},
        DOMParser: class {
            parseFromString() {
                return { body: { children: [] } };
            }
        },
        FileReader: class {
            readAsArrayBuffer() {}
        },
        CustomEvent: CustomEventStub,
        chrome: {
            storage: {
                local: {
                    get(_key, cb) {
                        cb({});
                    },
                    set: () => {},
                    remove: () => {},
                },
            },
            runtime: {
                lastError: null,
                sendMessage: (_payload, cb) => {
                    if (typeof cb === "function") cb({ success: true, responseText: "{}", status: 200 });
                },
                onMessage: {
                    addListener: () => {},
                },
            },
            bookmarks: {
                async getTree() {
                    return [];
                },
                async getChildren() {
                    return [];
                },
                async search() {
                    return [];
                },
            },
        },
        GM_info: { scriptHandler: "Node.js" },
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Promise,
        Error,
        Uint8Array,
        TextDecoder,
        TextEncoder,
        URL,
        crypto: global.crypto || require("crypto").webcrypto,
        prompt: () => "",
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        __LD_NOTION_TEST_OVERRIDES__: {
            DesignSystem: {
                initTheme: () => events.push("theme"),
            },
            NotionOAuth: {
                handleRedirectCallback: async () => false,
                syncApiKeyInputs: () => {},
                consumeNotice: () => null,
            },
            UI: {
                init: () => events.push("ui"),
                showStatus: () => {},
            },
            NotionSiteUI: {
                init: () => events.push("notion-ui"),
                showStatus: () => {},
            },
            GenericUI: {
                init: () => events.push("generic-ui"),
                showStatus: () => {},
            },
            UpdateChecker: {
                init: () => events.push("update"),
            },
            AutoImporter: {
                init: () => events.push("auto"),
            },
            GitHubAutoImporter: {
                init: () => events.push("github-auto"),
            },
            BookmarkAutoImporter: {
                init: () => events.push("bookmark-auto"),
            },
        },
    };

    sandbox.global = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.window.requestIdleCallback = sandbox.window.requestIdleCallback;

    return {
        appendedMetaNodes,
        flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
        sandbox,
    };
}

async function verifySurfaceRuntime(contentSource, testCase) {
    const events = [];
    const harness = createHarness(testCase.url, events);
    const runner = new Function(...Object.keys(harness.sandbox), contentSource);
    runner(...Object.values(harness.sandbox));

    await harness.flush();
    await harness.flush();

    const marker = harness.appendedMetaNodes.find((node) => node.name === "ld-notion-ext");
    assert.ok(marker, `${testCase.site}: 缺少 ld-notion-ext ready 标记`);
    assert.strictEqual(marker.content, "ready", `${testCase.site}: ready 标记内容异常`);
    assert.deepStrictEqual(events, testCase.expected, `${testCase.site}: ${JSON.stringify(events)}`);
}

async function main() {
    const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "ld-notion-runtime-surfaces-"));

    try {
        const result = buildExtension({ manifestProfile: "bounded_hosts", outDir: tempOutDir });
        const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
        const contentPath = path.join(tempOutDir, "content.js");
        const contentSource = instrumentBuiltContent(fs.readFileSync(contentPath, "utf8"));

        assert.ok(manifest.content_scripts?.[0]?.matches?.includes("https://github.com/*"));
        assert.ok(manifest.content_scripts?.[0]?.matches?.includes("https://www.zhihu.com/*"));
        assert.ok(manifest.content_scripts?.[0]?.matches?.includes("https://*/*"));
        assert.ok(manifest.content_scripts?.[0]?.exclude_matches?.includes("*://localhost/*"));
        assert.ok(manifest.content_scripts?.[0]?.exclude_matches?.includes("*://127.0.0.1/*"));

        const cases = [
            {
                site: "linuxdo-bookmark-page",
                url: "https://linux.do/u/test/activity/bookmarks",
                expected: ["theme", "ui", "update", "bookmark-auto"],
            },
            {
                site: "notion",
                url: "https://www.notion.so/workspace/page",
                expected: ["theme", "notion-ui", "bookmark-auto"],
            },
            {
                site: "github",
                url: "https://github.com/smith-106",
                expected: ["theme", "ui", "update", "github-auto", "bookmark-auto"],
            },
            {
                site: "zhihu",
                url: "https://www.zhihu.com/question/1",
                expected: ["theme", "generic-ui"],
            },
            {
                site: "generic",
                url: "https://example.com/article",
                expected: ["theme", "generic-ui"],
            },
        ];

        for (const testCase of cases) {
            await verifySurfaceRuntime(contentSource, testCase);
        }

        console.log("✅ Built extension surface runtime smoke passed");
    } finally {
        fs.rmSync(tempOutDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
});
