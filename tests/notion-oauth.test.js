const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { webcrypto } = require('crypto');

const userScriptPath = path.resolve(__dirname, '../LinuxDo-Bookmarks-to-Notion.user.js');
const buildScriptPath = path.resolve(__dirname, '../scripts/build-extension.js');
const {
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
    patchBookmarkBridgeForExtension,
    resolveManifestProfile,
    validatePatchedBuildAssumptions
} = require(buildScriptPath);
const userScriptContent = fs.readFileSync(userScriptPath, 'utf8');
const wrappedCoreCode = extractUserscriptIifeBody(userScriptContent);
const coreCode = wrappedCoreCode.replace(/\n\s*main\(\);\s*$/, '\n');

function createElementStub() {
    const element = {
        value: '',
        innerHTML: '',
        placeholder: '',
        style: {},
        dataset: {},
        checked: false,
        disabled: false,
        appendChild: () => {},
        removeChild: () => {},
        setAttribute: () => {},
        getAttribute: () => '',
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        focus: () => {},
        blur: () => {},
        click: () => {},
        classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
        offsetHeight: 0,
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
    };

    let textContent = '';
    Object.defineProperty(element, 'textContent', {
        enumerable: true,
        get() {
            return textContent;
        },
        set(value) {
            textContent = String(value);
            element.innerHTML = textContent
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
    });

    return element;
}

function createPanelStub(selectors = {}) {
    return {
        querySelector: (selector) => selectors[selector] || null,
        querySelectorAll: (selector) => selectors[selector] || [],
    };
}

function createAutoPanelStub(selectors = {}, selectorLists = {}) {
    const selectorMap = new Map(Object.entries(selectors));
    const selectorAllMap = new Map(Object.entries(selectorLists));
    const panel = createElementStub();

    panel.querySelector = (selector) => {
            if (selectorMap.has(selector)) return selectorMap.get(selector);
            const element = createElementStub();
            selectorMap.set(selector, element);
            return element;
        };
    panel.querySelectorAll = (selector) => selectorAllMap.get(selector) || [];

    return panel;
}

function createHarness({ url = 'https://localhost/', readyState = 'complete' } = {}) {
    const store = {};
    const notifications = [];
    const requests = [];
    const historyCalls = [];
    const documentListeners = {};
    const selectorMap = new Map();
    const selectorAllMap = new Map();
    let currentHref = new URL(url).toString();
    let requestHandler = null;

    const locationObject = {};
    ['href', 'hostname', 'pathname', 'protocol', 'origin', 'search', 'hash'].forEach((key) => {
        Object.defineProperty(locationObject, key, {
            enumerable: true,
            get() {
                const current = new URL(currentHref);
                if (key === 'href') return current.href;
                return current[key];
            },
            set(value) {
                if (key !== 'href') return;
                currentHref = new URL(value, currentHref).toString();
            }
        });
    });

    const sandbox = {
        window: {
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
            open: () => ({}),
            prompt: () => '',
            location: locationObject,
            history: {
                replaceState: (state, title, nextUrl) => {
                    historyCalls.push({ state, title, url: nextUrl });
                    currentHref = new URL(nextUrl, currentHref).toString();
                }
            },
            navigator: { userAgent: 'Node.js' },
            setTimeout: global.setTimeout,
            clearTimeout: global.clearTimeout,
            matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
            crypto: webcrypto,
        },
        document: {
            title: 'Test',
            readyState,
            activeElement: null,
            addEventListener: (eventName, handler) => {
                documentListeners[eventName] = handler;
            },
            removeEventListener: (eventName, handler) => {
                if (documentListeners[eventName] === handler) {
                    delete documentListeners[eventName];
                }
            },
            dispatchEvent: (event) => {
                const eventName = typeof event === 'string' ? event : event?.type;
                const listener = documentListeners[eventName];
                if (listener) return listener(event);
                return undefined;
            },
            createElement: createElementStub,
            getElementById: () => null,
            querySelector: (selector) => selectorMap.get(selector) || null,
            querySelectorAll: (selector) => selectorAllMap.get(selector) || [],
            body: { appendChild: () => {} },
            head: { appendChild: () => {} },
            location: locationObject
        },
        Node: {
            ELEMENT_NODE: 1,
            TEXT_NODE: 3
        },
        navigator: { userAgent: 'Node.js' },
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
        GM_getValue: (key, defaultValue) => (key in store ? store[key] : defaultValue),
        GM_setValue: (key, value) => {
            store[key] = value;
        },
        GM_deleteValue: (key) => {
            delete store[key];
        },
        GM_xmlhttpRequest: (options) => {
            requests.push(options);
            if (!requestHandler) {
                throw new Error(`Unhandled GM_xmlhttpRequest: ${options.method} ${options.url}`);
            }
            requestHandler(options);
        },
        GM_notification: (payload) => {
            notifications.push(payload);
        },
        GM_info: { scriptHandler: 'Node.js' },
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
        crypto: webcrypto,
        prompt: () => '',
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    };

    sandbox.global = sandbox;
    sandbox.self = sandbox;

    const scriptRunner = new Function(
        ...Object.keys(sandbox),
        `${coreCode}\nreturn { AIClassifier, AIService, CONFIG, AIAssistant, ChatState, ChatUI, CredentialVault, DesignSystem, GenericExporter, GenericUI, GitHubAPI, NotionAPI, NotionOAuth, NotionSiteUI, OperationGuard, SiteDetector, TargetState, UI, UICommandService, UndoManager, WorkspaceService, main };`
    );

    const exports = scriptRunner(...Object.values(sandbox));

    return {
        ...exports,
        store,
        notifications,
        requests,
        historyCalls,
        documentListeners,
        createInput: () => createElementStub(),
        flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
        getLocation: () => currentHref,
        setLocation: (nextUrl) => {
            currentHref = new URL(nextUrl, currentHref).toString();
        },
        getNotice: () => {
            const raw = store[exports.CONFIG.STORAGE_KEYS.NOTION_OAUTH_NOTICE];
            return raw ? JSON.parse(raw) : null;
        },
        registerSelector: (selector, element) => {
            selectorMap.set(selector, element);
        },
        registerSelectorAll: (selector, elements) => {
            selectorAllMap.set(selector, elements);
        },
        setRequestHandler: (handler) => {
            requestHandler = handler;
        }
    };
}

function respondJson(options, status, body, headers = '') {
    setTimeout(() => {
        options.onload({
            status,
            responseText: typeof body === 'string' ? body : JSON.stringify(body),
            responseHeaders: headers
        });
    }, 0);
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(error.stack || error);
        process.exit(1);
    }
}

function assertStructuredAssistantResult(output, {
    source,
    name,
    status = 'success',
    title,
    summary,
    text,
    textContains = [],
    fields = [],
    bullets = []
} = {}) {
    assert.ok(output && typeof output === 'object', `Expected structured result object, got ${typeof output}`);
    assert.strictEqual(output.type, 'assistant_result');
    assert.strictEqual(output.version, 1);

    if (source) assert.strictEqual(output.source, source);
    if (name) assert.strictEqual(output.name, name);
    if (status) assert.strictEqual(output.status, status);
    if (typeof title !== 'undefined') assert.strictEqual(output.title, title);
    if (typeof summary !== 'undefined') assert.strictEqual(output.summary, summary);
    if (typeof text !== 'undefined') assert.strictEqual(output.text, text);

    assert.strictEqual(typeof output.text, 'string');

    fields.forEach(({ label, value }) => {
        assert.ok(
            Array.isArray(output.fields) && output.fields.some((field) => field.label === label && field.value === value),
            `Expected field "${label}: ${value}" in:\n${JSON.stringify(output.fields, null, 2)}`
        );
    });

    bullets.forEach((item) => {
        assert.ok(
            Array.isArray(output.bullets) && output.bullets.includes(item),
            `Expected bullet "${item}" in:\n${JSON.stringify(output.bullets, null, 2)}`
        );
    });

    const expectedSnippets = [];
    if (title) expectedSnippets.push(`**${title}**`);
    fields.forEach(({ label, value }) => expectedSnippets.push(`- ${label}: ${value}`));
    bullets.forEach((item) => expectedSnippets.push(`- ${item}`));
    expectedSnippets.push(...textContains);

    expectedSnippets.forEach((snippet) => {
        assert.ok(
            output.text.includes(snippet),
            `Expected snippet "${snippet}" in:\n${output.text}`
        );
    });
}

function assertStructuredToolResult(output, options = {}) {
    assertStructuredAssistantResult(output, {
        source: 'tool',
        ...options,
    });
}

const STABLE_WELCOME_SUBTITLE = '稳定支持：数据库 / 页面检索、跨源搜索、批量分类、GitHub / 书签导入、页面摘要；更多能力看「帮助」';
const STABLE_WELCOME_PLACEHOLDER = '输入指令，如「列出所有数据库」或「导入GitHub收藏」...';
const STABLE_WELCOME_CHIPS = [
    { command: '帮助', label: '💡 帮助' },
    { command: '列出所有数据库', label: '🗂️ 数据库' },
    { command: '在工作区搜索所有页面', label: '📄 页面' },
    { command: '跨源搜索最近收藏的帖子', label: '🔍 跨源搜索' },
    { command: '自动分类所有未分类的帖子', label: '🏷️ 分类' },
    { command: '导入GitHub收藏', label: '🐙 GitHub' },
    { command: '导入浏览器书签', label: '📖 书签' }
];

function assertStableWelcomeMarkup(markup, { includesPlaceholder = false } = {}) {
    assert.ok(markup.includes(STABLE_WELCOME_SUBTITLE), markup);
    STABLE_WELCOME_CHIPS.forEach(({ command, label }) => {
        assert.ok(markup.includes(`data-cmd="${command}"`), markup);
        assert.ok(markup.includes(label), markup);
    });
    assert.ok(!markup.includes('data-cmd="搜索"'), markup);
    assert.ok(!markup.includes('data-cmd="总结"'), markup);
    if (includesPlaceholder) {
        assert.ok(markup.includes(`placeholder="${STABLE_WELCOME_PLACEHOLDER}"`), markup);
    }
}

async function unlockCredentialVault(harness, passphrase = 'test-passphrase') {
    await harness.CredentialVault.unlock(passphrase, {
        initializeIfMissing: true,
        migrateLegacy: true
    });
}

function createWorkspaceVisualizationFixture(harness) {
    const databases = [
        { id: 'db_linux', title: 'Linux 收藏' },
        { id: 'db_github', title: 'GitHub 收藏' },
        { id: 'db_misc', title: 'Inbox' }
    ];

    const pages = [
        {
            id: 'page-linux',
            parent: { type: 'database_id', database_id: 'db_linux' },
            properties: {
                标题: { type: 'title', title: [{ plain_text: 'Post A' }] },
                收藏时间: { type: 'date', date: { start: '2026-06-03T10:00:00Z' } },
                分类: { type: 'rich_text', rich_text: [{ plain_text: '论坛' }] },
                帖子数: { type: 'number', number: 12 },
                浏览数: { type: 'number', number: 200 },
                点赞数: { type: 'number', number: 9 }
            }
        },
        {
            id: 'page-github',
            parent: { type: 'database_id', database_id: 'db_github' },
            properties: {
                Name: { type: 'title', title: [{ plain_text: 'Repo A' }] },
                来源: { type: 'rich_text', rich_text: [{ plain_text: 'GitHub' }] },
                来源类型: { type: 'rich_text', rich_text: [{ plain_text: 'Repos' }] },
                更新时间: { type: 'date', date: { start: '2026-06-02T12:00:00Z' } },
                AI分类: { type: 'select', select: { name: '工具' } }
            }
        },
        {
            id: 'page-bookmark',
            parent: { type: 'database_id', database_id: 'db_misc' },
            properties: {
                标题: { type: 'title', title: [{ plain_text: 'Bookmark A' }] },
                书签路径: { type: 'rich_text', rich_text: [{ plain_text: 'Toolbar/Read' }] },
                收藏时间: { type: 'date', date: { start: '2026-06-01T09:00:00Z' } },
                分类: { type: 'rich_text', rich_text: [{ plain_text: '资料' }] }
            }
        },
        {
            id: 'page-generic',
            parent: { type: 'workspace' },
            properties: {
                标题: { type: 'title', title: [{ plain_text: 'Article A' }] },
                发布日期: { type: 'date', date: { start: '2026-05-31T08:00:00Z' } },
                摘要: { type: 'rich_text', rich_text: [{ plain_text: 'Long read' }] }
            }
        },
        {
            id: 'page-unmarked',
            parent: { type: 'database_id', database_id: 'db_misc' },
            properties: {
                标题: { type: 'title', title: [{ plain_text: 'Loose Note' }] }
            }
        }
    ];

    const records = pages.map((page) => harness.UI.extractWorkspaceVisualRecord(page, databases));
    return { databases, pages, records };
}

(async () => {
    console.log('Running tests for NotionOAuth...\n');

    await runTest('buildAuthorizeUrl: includes expected Notion OAuth query params', async () => {
        const harness = createHarness();
        await unlockCredentialVault(harness);
        await harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });

        const url = new URL(harness.NotionOAuth.buildAuthorizeUrl(harness.NotionOAuth.getConfig(), 'state_abc'));

        assert.strictEqual(url.origin + url.pathname, 'https://api.notion.com/v1/oauth/authorize');
        assert.strictEqual(url.searchParams.get('client_id'), 'client_123');
        assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://www.notion.so/');
        assert.strictEqual(url.searchParams.get('response_type'), 'code');
        assert.strictEqual(url.searchParams.get('owner'), 'user');
        assert.strictEqual(url.searchParams.get('state'), 'state_abc');
    });

    await runTest('matchesRedirectUri: ignores query string and matches exact origin/path', async () => {
        const harness = createHarness();
        assert.strictEqual(
            harness.NotionOAuth.matchesRedirectUri('https://www.notion.so/?code=abc&state=def', 'https://www.notion.so/'),
            true
        );
    });

    await runTest('matchesRedirectUri: rejects different path or origin', async () => {
        const harness = createHarness();
        assert.strictEqual(
            harness.NotionOAuth.matchesRedirectUri('https://www.notion.so/settings?code=abc', 'https://www.notion.so/'),
            false
        );
        assert.strictEqual(
            harness.NotionOAuth.matchesRedirectUri('https://linux.do/?code=abc', 'https://www.notion.so/'),
            false
        );
    });

    await runTest('getStatus: reports connected OAuth workspace when tokens are present', async () => {
        const harness = createHarness();
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_API_KEY] = 'ntn_access_token';
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN] = 'refresh_token';
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE] = 'oauth';
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_META] = JSON.stringify({ workspaceName: 'My Workspace' });

        const status = harness.NotionOAuth.getStatus();

        assert.strictEqual(status.connected, true);
        assert.ok(status.text.includes('My Workspace'));
    });

    await runTest('exchangeToken: posts OAuth payload with Basic auth header', async () => {
        const harness = createHarness();
        let capturedRequest = null;
        await unlockCredentialVault(harness);
        await harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, {
                access_token: 'oauth_access',
                refresh_token: 'oauth_refresh'
            });
        });

        const result = await harness.NotionOAuth.exchangeToken({
            grant_type: 'authorization_code',
            code: 'oauth_code',
            redirect_uri: 'https://www.notion.so/'
        });

        assert.strictEqual(capturedRequest.method, 'POST');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/oauth/token');
        assert.strictEqual(
            capturedRequest.headers.Authorization,
            `Basic ${Buffer.from('client_123:secret_456', 'utf8').toString('base64')}`
        );
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            grant_type: 'authorization_code',
            code: 'oauth_code',
            redirect_uri: 'https://www.notion.so/'
        });
        assert.strictEqual(result.access_token, 'oauth_access');
    });

    await runTest('refreshAccessToken: refreshes token and persists returned OAuth state', async () => {
        const harness = createHarness();
        await unlockCredentialVault(harness);
        await harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        await harness.NotionOAuth.setRefreshToken('refresh_old');

        harness.setRequestHandler((options) => {
            respondJson(options, 200, {
                access_token: 'access_new',
                refresh_token: 'refresh_new',
                workspace_id: 'workspace_123',
                workspace_name: 'Release Workspace',
                bot_id: 'bot_123',
                owner: { type: 'user' }
            });
        });

        const accessToken = await harness.NotionOAuth.refreshAccessToken();
        const meta = JSON.parse(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_META]);

        assert.strictEqual(accessToken, 'access_new');
        assert.strictEqual(harness.NotionOAuth.getAccessToken(), 'access_new');
        assert.strictEqual(harness.NotionOAuth.getRefreshToken(), 'refresh_new');
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE], 'oauth');
        assert.strictEqual(meta.workspaceName, 'Release Workspace');
    });

    await runTest('handleRedirectCallback: completes authorization, stores notice, and cleans callback params', async () => {
        const harness = createHarness({
            url: 'https://www.notion.so/?code=oauth_code&state=expected_state'
        });
        await unlockCredentialVault(harness);
        await harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        harness.NotionOAuth.setPendingState({
            state: 'expected_state',
            redirectUri: 'https://www.notion.so/',
            createdAt: 1
        });
        harness.setRequestHandler((options) => {
            respondJson(options, 200, {
                access_token: 'oauth_access',
                refresh_token: 'oauth_refresh',
                workspace_id: 'workspace_123',
                workspace_name: 'Release Workspace'
            });
        });

        const handled = await harness.NotionOAuth.handleRedirectCallback();
        const notice = harness.NotionOAuth.consumeNotice();

        assert.strictEqual(handled, true);
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE], 'oauth');
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_STATE], '');
        assert.strictEqual(notice.type, 'success');
        assert.ok(notice.message.includes('Release Workspace'));
        assert.strictEqual(harness.historyCalls.length, 1);
        assert.strictEqual(new URL(harness.getLocation()).search, '');
    });

    await runTest('handleRedirectCallback: records failure notice when provider returns an error', async () => {
        const harness = createHarness({
            url: 'https://www.notion.so/?error=access_denied&state=expected_state'
        });
        harness.NotionOAuth.setPendingState({
            state: 'expected_state',
            redirectUri: 'https://www.notion.so/',
            createdAt: 1
        });

        const handled = await harness.NotionOAuth.handleRedirectCallback();
        const notice = harness.NotionOAuth.consumeNotice();

        assert.strictEqual(handled, true);
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_STATE], '');
        assert.strictEqual(notice.type, 'error');
        assert.ok(notice.message.includes('access_denied'));
        assert.strictEqual(new URL(harness.getLocation()).search, '');
    });

    await runTest('NotionAPI.request: refreshes once on 401 and retries with the new OAuth token', async () => {
        const harness = createHarness();
        let pageRequests = 0;

        await unlockCredentialVault(harness);
        await harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        await harness.NotionOAuth.setManualApiKey('expired_access');
        await harness.NotionOAuth.setRefreshToken('refresh_old');
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE] = 'oauth';

        harness.setRequestHandler((options) => {
            if (options.url === 'https://api.notion.com/v1/pages/test-page') {
                pageRequests += 1;
                if (pageRequests === 1) {
                    respondJson(options, 401, { message: 'unauthorized' });
                    return;
                }

                respondJson(options, 200, { id: 'test-page', ok: true });
                return;
            }

            if (options.url === 'https://api.notion.com/v1/oauth/token') {
                respondJson(options, 200, {
                    access_token: 'fresh_access',
                    refresh_token: 'refresh_new',
                    workspace_name: 'Release Workspace'
                });
                return;
            }

            throw new Error(`Unexpected request: ${options.url}`);
        });

        const result = await harness.NotionAPI.request('GET', '/pages/test-page', null, '');

        assert.strictEqual(result.ok, true);
        assert.strictEqual(pageRequests, 2);
        assert.strictEqual(harness.requests[0].headers.Authorization, 'Bearer expired_access');
        assert.strictEqual(harness.requests[2].headers.Authorization, 'Bearer fresh_access');
        assert.strictEqual(harness.NotionOAuth.getAccessToken(), 'fresh_access');
    });

    await runTest('NotionAPI.configureTransport: routes requests through the explicit transport seam', async () => {
        const harness = createHarness();
        const captured = [];

        harness.NotionAPI.configureTransport({
            request: async (request) => {
                captured.push(request);
                return {
                    status: 200,
                    responseText: JSON.stringify({ ok: true }),
                    responseHeaders: ''
                };
            }
        });

        try {
            const result = await harness.NotionAPI.request('GET', '/users/me', null, 'manual_api_key', 1, {
                notionVersion: '2025-09-03'
            });

            assert.strictEqual(result.ok, true);
            assert.deepStrictEqual(captured, [{
                method: 'GET',
                endpoint: '/users/me',
                data: null,
                token: 'manual_api_key',
                notionVersion: '2025-09-03'
            }]);
            assert.strictEqual(harness.requests.length, 0);
        } finally {
            harness.NotionAPI.resetTransport();
        }
    });

    await runTest('manual fallback: saved manual API key still works when OAuth config exists', async () => {
        const harness = createHarness();
        let authorizationHeader = '';

        await unlockCredentialVault(harness);
        await harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        await harness.NotionOAuth.setManualApiKey('manual_api_key');
        harness.setRequestHandler((options) => {
            authorizationHeader = options.headers.Authorization;
            respondJson(options, 200, { ok: true });
        });

        const result = await harness.NotionAPI.request('GET', '/users/me', null, '');
        const status = harness.NotionOAuth.getStatus();

        assert.strictEqual(result.ok, true);
        assert.strictEqual(authorizationHeader, 'Bearer manual_api_key');
        assert.strictEqual(harness.NotionOAuth.getAuthMode(), 'manual');
        assert.strictEqual(harness.NotionOAuth.canAutoRefresh(), false);
        assert.ok(status.text.includes('手动 API Key'));
    });

    await runTest('NotionAPI.listComments: uses comments endpoint with the comment API version', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, {
                results: [{ id: 'comment_123' }],
                has_more: false
            });
        });

        const result = await harness.NotionAPI.listComments('page_123', 'cursor_1', 25, 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'GET');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/comments?block_id=page_123&start_cursor=cursor_1&page_size=25');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.COMMENT_NOTION_VERSION);
        assert.strictEqual(result.results[0].id, 'comment_123');
    });

    await runTest('NotionAPI.createComment: posts rich_text comment content to a page target', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, {
                id: 'comment_created'
            });
        });

        const result = await harness.NotionAPI.createComment({
            pageId: 'page_abc',
            content: 'This is a test comment'
        }, 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'POST');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/comments');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.COMMENT_NOTION_VERSION);
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            parent: { page_id: 'page_abc' },
            rich_text: [{ type: 'text', text: { content: 'This is a test comment' } }]
        });
        assert.strictEqual(result.id, 'comment_created');
    });

    await runTest('NotionAPI.getComment: retrieves comment detail with comment API version', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, {
                id: 'comment_lookup',
                rich_text: [{ plain_text: 'hello comment' }]
            });
        });

        const result = await harness.NotionAPI.getComment('comment_lookup', 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'GET');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/comments/comment_lookup');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.COMMENT_NOTION_VERSION);
        assert.strictEqual(result.id, 'comment_lookup');
    });

    await runTest('NotionAPI.fetchPageMarkdown: uses markdown endpoint with markdown API version', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, {
                markdown: '# Hello Markdown'
            });
        });

        const result = await harness.NotionAPI.fetchPageMarkdown('page_markdown_1', 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'GET');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/pages/page_markdown_1/markdown');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.MARKDOWN_NOTION_VERSION);
        assert.strictEqual(result.markdown, '# Hello Markdown');
    });

    await runTest('NotionAPI.fetchBlock: retrieves a single block by id', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, {
                object: 'block',
                id: 'block_123',
                type: 'paragraph'
            });
        });

        const result = await harness.NotionAPI.fetchBlock('block_123', 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'GET');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/blocks/block_123');
        assert.strictEqual(result.type, 'paragraph');
    });

    await runTest('NotionAPI.appendBlockChildren: uses append block children payload with after cursor', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, { ok: true });
        });

        const result = await harness.NotionAPI.appendBlockChildren(
            'parent_block_1',
            [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Inserted' } }] } }],
            'manual_api_key',
            { after: 'sibling_1' }
        );

        assert.strictEqual(capturedRequest.method, 'PATCH');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/blocks/parent_block_1/children');
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Inserted' } }] } }],
            after: 'sibling_1'
        });
        assert.strictEqual(result.ok, true);
    });

    await runTest('NotionAPI.appendPageMarkdown: sends insert_content payload', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, { ok: true });
        });

        const result = await harness.NotionAPI.appendPageMarkdown('page_markdown_2', '## Added Section', 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'PATCH');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/pages/page_markdown_2/markdown');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.MARKDOWN_NOTION_VERSION);
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            type: 'insert_content',
            insert_content: {
                content: '## Added Section'
            }
        });
        assert.strictEqual(result.ok, true);
    });

    await runTest('NotionAPI.searchReplacePageMarkdown: sends update_content payload', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, { ok: true });
        });

        const result = await harness.NotionAPI.searchReplacePageMarkdown('page_markdown_3', [
            { old_str: 'old text', new_str: 'new text', replace_all_matches: true }
        ], 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'PATCH');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/pages/page_markdown_3/markdown');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.MARKDOWN_NOTION_VERSION);
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            type: 'update_content',
            update_content: {
                content_updates: [
                    { old_str: 'old text', new_str: 'new text', replace_all_matches: true }
                ],
                allow_deleting_content: false
            }
        });
        assert.strictEqual(result.ok, true);
    });

    await runTest('NotionAPI.replacePageMarkdown: sends replace_content payload', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, { ok: true });
        });

        const result = await harness.NotionAPI.replacePageMarkdown('page_markdown_4', '# Replaced Page', 'manual_api_key', true);

        assert.strictEqual(capturedRequest.method, 'PATCH');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/pages/page_markdown_4/markdown');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.MARKDOWN_NOTION_VERSION);
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            type: 'replace_content',
            replace_content: {
                new_str: '# Replaced Page',
                allow_deleting_content: true
            }
        });
        assert.strictEqual(result.ok, true);
    });

    await runTest('NotionAPI.createPageObject: sends generic page create payload with icon and cover', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, { id: 'page_created' });
        });

        const result = await harness.NotionAPI.createPageObject(
            { page_id: 'parent_123' },
            { title: { title: [{ text: { content: 'Child Page' } }] } },
            [],
            'manual_api_key',
            {
                icon: { type: 'emoji', emoji: '📝' },
                cover: { type: 'external', external: { url: 'https://example.com/cover.png' } }
            }
        );

        assert.strictEqual(capturedRequest.method, 'POST');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/pages');
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            parent: { page_id: 'parent_123' },
            properties: { title: { title: [{ text: { content: 'Child Page' } }] } },
            children: [],
            icon: { type: 'emoji', emoji: '📝' },
            cover: { type: 'external', external: { url: 'https://example.com/cover.png' } }
        });
        assert.strictEqual(result.id, 'page_created');
    });

    await runTest('NotionAPI.updatePageMeta: patches icon and cover on a page', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, { ok: true });
        });

        const result = await harness.NotionAPI.updatePageMeta('page_meta_1', {
            icon: { type: 'emoji', emoji: '🚀' },
            cover: { type: 'external', external: { url: 'https://example.com/banner.png' } },
            is_locked: true
        }, 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'PATCH');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/pages/page_meta_1');
        assert.deepStrictEqual(JSON.parse(capturedRequest.data), {
            icon: { type: 'emoji', emoji: '🚀' },
            cover: { type: 'external', external: { url: 'https://example.com/banner.png' } },
            is_locked: true
        });
        assert.strictEqual(result.ok, true);
    });

    await runTest('AIAssistant._buildBlockUpdatePayload: preserves paragraph color and replaces rich text', async () => {
        const harness = createHarness();

        const payload = harness.AIAssistant._buildBlockUpdatePayload({
            type: 'paragraph',
            paragraph: {
                color: 'blue_background',
                rich_text: [{ plain_text: 'old' }]
            }
        }, 'new paragraph');

        assert.deepStrictEqual(payload, {
            paragraph: {
                color: 'blue_background',
                rich_text: [{ type: 'text', text: { content: 'new paragraph' } }]
            }
        });
    });

    await runTest('AIAssistant._buildBlockUpdatePayload: preserves to_do checked state unless overridden', async () => {
        const harness = createHarness();

        const payload = harness.AIAssistant._buildBlockUpdatePayload({
            type: 'to_do',
            to_do: {
                checked: true,
                color: 'default',
                rich_text: [{ plain_text: 'old todo' }]
            }
        }, 'updated todo');

        assert.deepStrictEqual(payload, {
            to_do: {
                checked: true,
                color: 'default',
                rich_text: [{ type: 'text', text: { content: 'updated todo' } }]
            }
        });
    });

    await runTest('AIAssistant.executeIntent: falls back to AGENT_TOOLS for create_comment reply by comment_id', async () => {
        const harness = createHarness();
        const calls = [];

        harness.NotionAPI.getComment = async (commentId) => {
            calls.push(['getComment', commentId]);
            return { discussion_id: 'discussion_123' };
        };
        harness.NotionAPI.createComment = async (payload) => {
            calls.push(['createComment', payload]);
            return { id: 'comment_new' };
        };

        const result = await harness.AIAssistant.executeIntent({
            intent: 'create_comment',
            params: {
                comment_id: 'comment_old',
                content: 'reply content'
            }
        }, {
            notionApiKey: 'manual_api_key',
            aiApiKey: 'dummy',
            notionDatabaseId: '',
            categories: []
        });

        assert.deepStrictEqual(calls, [
            ['getComment', 'comment_old'],
            ['createComment', {
                pageId: undefined,
                blockId: undefined,
                discussionId: 'discussion_123',
                content: 'reply content'
            }]
        ]);
        assertStructuredToolResult(result, {
            name: 'create_comment',
            status: 'success',
            textContains: ['评论已创建']
        });
    });

    await runTest('AIAssistant.IntentMatcher: exposes the declarative matcher seam without changing quick intent output', async () => {
        const harness = createHarness();
        const phrase = '查看“项目计划”页面详情';

        const seamResult = harness.AIAssistant.IntentMatcher.parse(phrase);
        const directResult = harness.AIAssistant.quickParseIntent(phrase);

        assert.ok(Array.isArray(harness.AIAssistant.IntentMatcher.getRules()));
        assert.ok(harness.AIAssistant.IntentMatcher.getRules().length > 0);
        assert.deepStrictEqual(seamResult, directResult);
    });

    await runTest('AIAssistant.IntentDispatcher: exposes shared intent/tool resolution seams', async () => {
        const harness = createHarness();
        const helpExecutor = harness.AIAssistant.IntentDispatcher.resolveExecutor('help');
        const commentExecutor = harness.AIAssistant.IntentDispatcher.resolveExecutor('create_comment');

        assert.strictEqual(helpExecutor?.source, 'intent');
        assert.strictEqual(commentExecutor?.source, 'tool');
        assert.strictEqual(harness.AIAssistant.IntentDispatcher.canExecuteDirectly('help'), false);
        assert.strictEqual(harness.AIAssistant.IntentDispatcher.canExecuteDirectly('create_comment'), true);
    });

    await runTest('AIAssistant._buildGuardContext: derives apiKey and default item name from page context', async () => {
        const harness = createHarness();

        const context = harness.AIAssistant._buildGuardContext({
            pageId: 'page_guard_1'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(context, {
            pageId: 'page_guard_1',
            itemName: 'page_guard_1',
            apiKey: 'manual_api_key'
        });
    });

    await runTest('AIAssistant._executeGuardedDatabaseWrite: delegates normalized database context through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.itemName, context.databaseId, context.apiKey]);
            return executor();
        };

        const result = await harness.AIAssistant._executeGuardedDatabaseWrite(
            'updateDatabase',
            'db_guard_1',
            async () => 'ok',
            'manual_api_key'
        );

        assert.strictEqual(result, 'ok');
        assert.deepStrictEqual(calls, [
            ['guard', 'updateDatabase', 'db_guard_1', 'db_guard_1', 'manual_api_key']
        ]);
    });

    await runTest('AIAssistant.quickParseIntent: recognizes comment detail lookup', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看 comment_abc123 这条评论');

        assert.deepStrictEqual(result, {
            intent: 'get_comment',
            params: { comment_id: 'abc123' },
            explanation: '根据明确的 comment_id 读取评论详情'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes block content update with quoted text', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('把 block_123abc 改成“新的段落内容”');

        assert.deepStrictEqual(result, {
            intent: 'update_block_content',
            params: {
                block_id: '123abc',
                content: '新的段落内容'
            },
            explanation: '根据明确的 block_id 更新块内容'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes notion url object fetch', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看这个页面详情 https://www.notion.so/My-Page-1234567890abcdef1234567890abcdef');

        assert.deepStrictEqual(result, {
            intent: 'fetch_notion_object',
            params: {
                reference: 'https://www.notion.so/My-Page-1234567890abcdef1234567890abcdef'
            },
            explanation: '根据明确的 Notion 链接读取对象详情'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes archive page by quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('归档“项目计划”页面');

        assert.deepStrictEqual(result, {
            intent: 'archive_page',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称归档页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes unlock page by quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('解锁“项目计划”页面');

        assert.deepStrictEqual(result, {
            intent: 'update_page',
            params: { page_name: '项目计划', is_locked: false },
            explanation: '根据明确的页面名称解锁页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes append content to quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('在“项目计划”页面插入“新增说明”');

        assert.deepStrictEqual(result, {
            intent: 'append_block_children',
            params: {
                page_name: '项目计划',
                content: '新增说明',
                insert_position: 'end'
            },
            explanation: '根据明确的页面名称插入内容块'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page block fetch by quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“项目计划”页面块结构');

        assert.deepStrictEqual(result, {
            intent: 'fetch_page_blocks',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称查看块结构'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes reply to comment with quoted content', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('回复 comment_abc123 “收到，我来补充”');

        assert.deepStrictEqual(result, {
            intent: 'create_comment',
            params: {
                comment_id: 'abc123',
                content: '收到，我来补充'
            },
            explanation: '根据明确的 comment_id 回复已有评论'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes append after specific block', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('在 block_123abc 后插入“新增列表”');

        assert.deepStrictEqual(result, {
            intent: 'append_block_children',
            params: {
                block_id: '123abc',
                content: '新增列表',
                insert_position: 'after_block',
                after_block_id: '123abc'
            },
            explanation: '根据明确的 block_id 插入内容块'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page icon update by quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('把“项目计划”页面换成🚀图标');

        assert.deepStrictEqual(result, {
            intent: 'update_page',
            params: { page_name: '项目计划', icon_emoji: '🚀' },
            explanation: '根据明确的页面名称更新页面图标'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page detail fetch by quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“项目计划”页面详情');

        assert.deepStrictEqual(result, {
            intent: 'fetch_notion_object',
            params: { reference: '项目计划', type: 'page' },
            explanation: '根据明确的页面名称读取对象详情'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page markdown fetch by quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“项目计划”页面 Markdown');

        assert.deepStrictEqual(result, {
            intent: 'fetch_page_markdown',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称读取页面 Markdown'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page comments fetch by quoted page name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“项目计划”页面评论');

        assert.deepStrictEqual(result, {
            intent: 'get_comments',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称读取页面评论'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page detail fetch without explicit page keyword', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('看看“项目计划”详情');

        assert.deepStrictEqual(result, {
            intent: 'fetch_notion_object',
            params: { reference: '项目计划', type: 'page' },
            explanation: '根据明确的页面名称读取对象详情'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page markdown fetch without explicit page keyword', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('读取“项目计划” Markdown');

        assert.deepStrictEqual(result, {
            intent: 'fetch_page_markdown',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称读取页面 Markdown'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes page comments fetch without explicit page keyword', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('显示“项目计划”评论');

        assert.deepStrictEqual(result, {
            intent: 'get_comments',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称读取页面评论'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes archive without explicit page keyword', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('归档“项目计划”');

        assert.deepStrictEqual(result, {
            intent: 'archive_page',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称归档页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes move-to-archive phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('把“项目计划”移到归档');

        assert.deepStrictEqual(result, {
            intent: 'archive_page',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称归档页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes lock without explicit page keyword', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('锁住“项目计划”');

        assert.deepStrictEqual(result, {
            intent: 'update_page',
            params: { page_name: '项目计划', is_locked: true },
            explanation: '根据明确的页面名称锁定页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes cancel-lock phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('取消锁定“项目计划”');

        assert.deepStrictEqual(result, {
            intent: 'update_page',
            params: { page_name: '项目计划', is_locked: false },
            explanation: '根据明确的页面名称解锁页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes cover update without explicit page keyword', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('给“项目计划”加封面 https://example.com/cover.png');

        assert.deepStrictEqual(result, {
            intent: 'update_page',
            params: { page_name: '项目计划', cover_url: 'https://example.com/cover.png' },
            explanation: '根据明确的页面名称更新页面封面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes database schema fetch by quoted database name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“知识库”数据库结构');

        assert.deepStrictEqual(result, {
            intent: 'get_database_schema',
            params: { database_name: '知识库' },
            explanation: '根据明确的数据库名称读取数据库结构'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes database property phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“知识库”数据库属性');

        assert.deepStrictEqual(result, {
            intent: 'get_database_schema',
            params: { database_name: '知识库' },
            explanation: '根据明确的数据库名称读取数据库结构'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes database field phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“知识库”数据库字段');

        assert.deepStrictEqual(result, {
            intent: 'get_database_schema',
            params: { database_name: '知识库' },
            explanation: '根据明确的数据库名称读取数据库结构'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes database column phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“知识库”数据库列');

        assert.deepStrictEqual(result, {
            intent: 'get_database_schema',
            params: { database_name: '知识库' },
            explanation: '根据明确的数据库名称读取数据库结构'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes database detail fetch by quoted database name', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('看看“知识库”数据库详情');

        assert.deepStrictEqual(result, {
            intent: 'fetch_notion_object',
            params: { reference: '知识库', type: 'database' },
            explanation: '根据明确的数据库名称读取对象详情'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes restore-from-archive phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('把“项目计划”移出归档');

        assert.deepStrictEqual(result, {
            intent: 'restore_page',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称恢复页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: recognizes reply to comment with colon syntax', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('回复 comment_abc123：收到，我来补充');

        assert.deepStrictEqual(result, {
            intent: 'create_comment',
            params: {
                comment_id: 'abc123',
                content: '收到，我来补充'
            },
            explanation: '根据明确的 comment_id 回复已有评论'
        });
    });

    await runTest('AIAssistant.quickParseIntent: returns null for reply without content', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('回复 comment_abc123');

        assert.strictEqual(result, null);
    });

    await runTest('AIAssistant.quickParseIntent: returns null for database cover phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('给“知识库”数据库加封面 https://example.com/cover.png');

        assert.strictEqual(result, null);
    });

    await runTest('AIAssistant.quickParseIntent: prefers reply intent when detail and reply wording overlap', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看 comment_abc123 并回复“收到”');

        assert.deepStrictEqual(result, {
            intent: 'create_comment',
            params: {
                comment_id: 'abc123',
                content: '收到'
            },
            explanation: '根据明确的 comment_id 回复已有评论'
        });
    });

    await runTest('AIAssistant.quickParseIntent: prefers database schema when schema and detail wording overlap', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“知识库”数据库结构详情');

        assert.deepStrictEqual(result, {
            intent: 'get_database_schema',
            params: { database_name: '知识库' },
            explanation: '根据明确的数据库名称读取数据库结构'
        });
    });

    await runTest('AIAssistant.quickParseIntent: prefers restore intent over detail lookup for archive exit phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('把“项目计划”移出归档并查看详情');

        assert.deepStrictEqual(result, {
            intent: 'restore_page',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称恢复页面'
        });
    });

    await runTest('AIAssistant.quickParseIntent: prefers page block lookup when block structure and detail wording overlap', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“项目计划”页面块结构详情');

        assert.deepStrictEqual(result, {
            intent: 'fetch_page_blocks',
            params: { page_name: '项目计划' },
            explanation: '根据明确的页面名称查看块结构'
        });
    });

    await runTest('AIAssistant.quickParseIntent: returns null for database comment phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“知识库”数据库评论');

        assert.strictEqual(result, null);
    });

    await runTest('AIAssistant.quickParseIntent: returns null for database markdown phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('读取“知识库”数据库 Markdown');

        assert.strictEqual(result, null);
    });

    await runTest('AIAssistant.quickParseIntent: returns null for database block structure phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“知识库”数据库块结构');

        assert.strictEqual(result, null);
    });

    await runTest('AIAssistant.quickParseIntent: returns null for mixed page and database detail phrasing', async () => {
        const harness = createHarness();

        const result = harness.AIAssistant.quickParseIntent('查看“项目计划”页面数据库详情');

        assert.strictEqual(result, null);
    });

    await runTest('NotionAPI.getUsers: keeps existing users endpoint behavior', async () => {
        const harness = createHarness();
        let capturedRequest = null;

        harness.setRequestHandler((options) => {
            capturedRequest = options;
            respondJson(options, 200, {
                results: [{ id: 'user_1', name: 'Alice' }],
                has_more: false
            });
        });

        const result = await harness.NotionAPI.getUsers('cursor_2', 'manual_api_key');

        assert.strictEqual(capturedRequest.method, 'GET');
        assert.strictEqual(capturedRequest.url, 'https://api.notion.com/v1/users?start_cursor=cursor_2');
        assert.strictEqual(capturedRequest.headers['Notion-Version'], harness.CONFIG.API.NOTION_VERSION);
        assert.strictEqual(result.results[0].name, 'Alice');
    });

    await runTest('AIAssistant.AGENT_TOOLS.search_workspace: returns structured result output', async () => {
        const harness = createHarness();

        harness.NotionAPI.search = async () => ({
            results: [{
                object: 'page',
                id: 'page-123',
                url: 'https://www.notion.so/page123',
                properties: {
                    title: {
                        title: [{ plain_text: '项目计划' }]
                    }
                }
            }],
            has_more: false
        });

        const result = await harness.AIAssistant.AGENT_TOOLS.search_workspace.execute({
            query: '项目',
            type: 'page'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assertStructuredToolResult(result, {
            name: 'search_workspace',
            title: '工作区搜索结果',
            fields: [
                { label: '总数', value: 1 },
                { label: '显示', value: 1 },
                { label: '对象类型', value: 'page' }
            ],
            bullets: [
                '[页面] 项目计划 (ID: page123, URL: https://www.notion.so/page123)'
            ]
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.fetch_page_blocks: returns structured block tree output', async () => {
        const harness = createHarness();

        harness.AIAssistant._resolvePageId = async () => ({
            id: 'page_123',
            name: '项目计划'
        });
        harness.AIAssistant._collectBlockTree = async () => ([
            {
                id: 'block-root',
                type: 'heading_1',
                heading_1: {
                    rich_text: [{ plain_text: '概览' }]
                },
                has_children: false
            },
            {
                id: 'block-child',
                type: 'to_do',
                to_do: {
                    rich_text: [{ plain_text: '待处理' }],
                    checked: false
                },
                has_children: true,
                _depth: 1
            }
        ]);

        const result = await harness.AIAssistant.AGENT_TOOLS.fetch_page_blocks.execute({
            page_name: '项目计划',
            max_depth: 2,
            limit: 10
        }, {
            notionApiKey: 'manual_api_key'
        });

        assertStructuredToolResult(result, {
            name: 'fetch_page_blocks',
            title: '块结构',
            fields: [
                { label: '目标', value: '项目计划' },
                { label: '块数', value: 2 }
            ],
            bullets: [
                '[heading_1] 概览 (id: blockroot)'
            ]
        });
        assert.ok(result.text.includes('[to_do] 待处理'), result.text);
    });

    await runTest('AIAssistant.AGENT_TOOLS.get_comment: returns structured comment detail output', async () => {
        const harness = createHarness();

        harness.NotionAPI.getComment = async () => ({
            id: 'comment-123',
            discussion_id: 'discussion-456',
            created_time: '2026-04-10T00:00:00.000Z',
            created_by: { name: 'Alice' },
            rich_text: [{ plain_text: '已处理' }]
        });

        const result = await harness.AIAssistant.AGENT_TOOLS.get_comment.execute({
            comment_id: 'comment_123'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assertStructuredToolResult(result, {
            name: 'get_comment',
            title: '评论详情',
            fields: [
                { label: '评论ID', value: 'comment123' },
                { label: '讨论ID', value: 'discussion456' },
                { label: '作者', value: 'Alice' },
                { label: '创建时间', value: '2026-04-10T00:00:00.000Z' },
                { label: '内容', value: '已处理' }
            ]
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.fetch_notion_object: normalizes legacy error output into structured error result', async () => {
        const harness = createHarness();

        const result = await harness.AIAssistant.AGENT_TOOLS.fetch_notion_object.execute({}, {
            notionApiKey: 'manual_api_key'
        });

        assertStructuredToolResult(result, {
            name: 'fetch_notion_object',
            status: 'error',
            summary: '错误: 请提供 reference。',
            text: '错误: 请提供 reference。'
        });
    });

    await runTest('AIAssistant.executeIntent: normalizes unknown intent fallback into structured error result', async () => {
        const harness = createHarness();

        const result = await harness.AIAssistant.executeIntent({
            intent: 'unknown',
            explanation: '无法解析响应'
        }, {
            notionApiKey: 'manual_api_key',
            aiApiKey: 'dummy',
            notionDatabaseId: '',
            categories: []
        });

        assertStructuredAssistantResult(result, {
            source: 'intent',
            name: 'unknown',
            status: 'error',
            textContains: [
                '抱歉，我没有完全理解你的指令。',
                '我的理解：无法解析响应'
            ]
        });
    });

    await runTest('TargetState.setAITarget: keeps exporter target database unchanged', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const aiDb = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.TargetState.setAITarget(aiDb);

        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.AI_TARGET_DB], aiDb);
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID], exportDb);
    });

    await runTest('TargetState: restores legacy exporter database when AI target is missing and keeps explicit blank separate', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;

        const missingStoredState = harness.TargetState.getStoredAITarget();
        const legacyDisplayState = harness.TargetState.getDisplayAITargetState();
        assert.strictEqual(missingStoredState.exists, false);
        assert.strictEqual(legacyDisplayState.mode, 'database');
        assert.strictEqual(legacyDisplayState.databaseId, exportDb);

        harness.TargetState.setAITarget('');

        const explicitBlankStoredState = harness.TargetState.getStoredAITarget();
        const explicitBlankDisplayState = harness.TargetState.getDisplayAITargetState();
        const explicitBlankEffectiveState = harness.TargetState.getEffectiveAITargetState();
        assert.strictEqual(explicitBlankStoredState.exists, true);
        assert.strictEqual(explicitBlankDisplayState.mode, 'default');
        assert.strictEqual(explicitBlankDisplayState.value, '');
        assert.strictEqual(explicitBlankEffectiveState.mode, 'database');
        assert.strictEqual(explicitBlankEffectiveState.databaseId, exportDb);
    });

    await runTest('NotionSiteUI.initAIAssistant: registers an explicit settings adapter instead of monkey-patching getSettings', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const selectors = {
            '#ldb-notion-api-key': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-service': Object.assign(createElementStub(), { value: 'openai' }),
            '#ldb-notion-ai-model': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-target-db': Object.assign(createElementStub(), { value: 'page:cccccccccccccccccccccccccccccccc' }),
            '#ldb-notion-ai-api-key': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-base-url': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-categories': Object.assign(createElementStub(), { value: '' })
        };
        const getSettingsRef = harness.AIAssistant.getSettings;

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.NotionSiteUI.panel = createPanelStub(selectors);

        harness.NotionSiteUI.initAIAssistant();

        const activeAdapter = harness.AIAssistant.getActiveSettingsAdapter();
        const settings = harness.AIAssistant.getSettings();

        assert.strictEqual(harness.AIAssistant.getSettings, getSettingsRef);
        assert.strictEqual(activeAdapter?.name, 'notion-site');
        assert.strictEqual(settings.notionDatabaseId, exportDb);

        harness.NotionSiteUI.panel = null;
        assert.strictEqual(harness.AIAssistant.getActiveSettingsAdapter(), null);
    });

    await runTest('WorkspaceService.refreshWorkspaceSnapshot: persists staged workspace data and notifies standardized UI callbacks', async () => {
        const harness = createHarness();
        const partialWorkspace = {
            databases: [{ id: 'db1', title: '知识库' }],
            pages: []
        };
        const finalWorkspace = {
            databases: partialWorkspace.databases,
            pages: [{ id: 'page1', title: '项目计划', parent: 'workspace' }]
        };
        const updates = [];

        harness.WorkspaceService.fetchWorkspaceStaged = async (apiKey, options) => {
            assert.strictEqual(apiKey, 'manual_api_key');
            options.onPhaseComplete('databases', partialWorkspace);
            options.onPhaseComplete('pages', finalWorkspace);
            return finalWorkspace;
        };

        const result = await harness.WorkspaceService.refreshWorkspaceSnapshot('manual_api_key', {
            includePages: true,
            onWorkspaceData: (workspaceData, meta) => updates.push({ workspaceData, meta })
        });

        const cachedWorkspace = JSON.parse(harness.store[harness.CONFIG.STORAGE_KEYS.WORKSPACE_PAGES]);
        assert.deepStrictEqual(updates.map(({ meta }) => meta.phase), ['databases', 'pages']);
        assert.deepStrictEqual(updates.map(({ meta }) => meta.isFinal), [false, true]);
        assert.strictEqual(updates[0].workspaceData.databases.length, 1);
        assert.strictEqual(updates[1].workspaceData.pages.length, 1);
        assert.strictEqual(cachedWorkspace.apiKeyHash, 'manual_api_key'.slice(-8));
        assert.strictEqual(cachedWorkspace.pages[0].id, 'page1');
        assert.strictEqual(result.workspaceData.pages[0].title, '项目计划');
    });

    await runTest('AIService.fetchModelsSnapshot: persists fetched model snapshots in the shared cache format', async () => {
        const harness = createHarness();

        harness.AIService.fetchModels = async (service, apiKey, baseUrl) => {
            assert.strictEqual(service, 'openai');
            assert.strictEqual(apiKey, 'sk-test');
            assert.strictEqual(baseUrl, 'https://example.com');
            return ['gpt-4.1-mini', 'gpt-4o'];
        };

        const result = await harness.AIService.fetchModelsSnapshot('openai', 'sk-test', 'https://example.com');
        const cachedModels = JSON.parse(harness.store[harness.CONFIG.STORAGE_KEYS.FETCHED_MODELS]);

        assert.deepStrictEqual(result.models, ['gpt-4.1-mini', 'gpt-4o']);
        assert.deepStrictEqual(cachedModels.openai.models, ['gpt-4.1-mini', 'gpt-4o']);
        assert.strictEqual(typeof cachedModels.openai.timestamp, 'number');
    });

    await runTest('UICommandService.execute: select_ai_target delegates to TargetState.setAITarget and exposes legacy write boundary metadata', async () => {
        const harness = createHarness();
        let selectedValue = null;

        harness.TargetState.setAITarget = (value) => {
            selectedValue = value;
            return { value };
        };

        const result = await harness.UICommandService.execute('select_ai_target', { targetValue: 'page:cccc' });

        assert.strictEqual(selectedValue, 'page:cccc');
        assert.deepStrictEqual(result, { value: 'page:cccc' });
        assert.ok(harness.UICommandService.LEGACY_DIRECT_NOTION_WRITE_BOUNDARY.allowedSources.includes('GenericExporter.setupDatabaseProperties'));
    });

    await runTest('UICommandService.execute: save_command_boundary_settings persists notion-site command payloads through one boundary', async () => {
        const harness = createHarness();
        let selectedValue = null;
        let importTypes = null;
        await unlockCredentialVault(harness);

        harness.TargetState.setAITarget = (value) => {
            selectedValue = value;
            return { value };
        };
        harness.GitHubAPI.setImportTypes = (types) => {
            importTypes = types;
        };

        await harness.UICommandService.execute('save_command_boundary_settings', {
            scope: 'notion-site',
            liveApiKey: 'manual_api_key',
            clearManualApiKey: true,
            aiTargetValue: 'page:cccc',
            aiService: 'openai',
            aiModel: 'gpt-4.1-mini',
            aiApiKey: 'sk-test',
            aiBaseUrl: 'https://example.com',
            aiCategories: 'AI,工具',
            workspaceMaxPages: 50,
            personaName: 'Niko',
            personaTone: 'professional',
            personaExpertise: 'notion',
            personaInstructions: 'be concise',
            githubUsername: 'smith',
            githubToken: 'ghp_xxx',
            githubImportTypes: ['stars', 'repos']
        });

        assert.strictEqual(selectedValue, 'page:cccc');
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.AI_SERVICE], 'openai');
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.AI_MODEL], 'gpt-4.1-mini');
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.WORKSPACE_MAX_PAGES], 50);
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME], 'Niko');
        assert.deepStrictEqual(importTypes, ['stars', 'repos']);
    });

    await runTest('UICommandService.execute: refresh_workspace_targets delegates to WorkspaceService.refreshWorkspaceSnapshot with forwarded hooks', async () => {
        const harness = createHarness();
        const progressEvents = [];
        const workspaceEvents = [];

        harness.WorkspaceService.refreshWorkspaceSnapshot = async (apiKey, options) => {
            assert.strictEqual(apiKey, 'manual_api_key');
            assert.strictEqual(options.includePages, false);
            options.onProgress({ phase: 'databases', loaded: 1 });
            options.onWorkspaceData({ databases: [{ id: 'db1' }], pages: [] }, { phase: 'databases', isFinal: true });
            return { workspaceData: { databases: [{ id: 'db1' }], pages: [] } };
        };

        const result = await harness.UICommandService.execute('refresh_workspace_targets', {
            apiKey: 'manual_api_key',
            includePages: false,
            onProgress: (progress) => progressEvents.push(progress),
            onWorkspaceData: (workspaceData, meta) => workspaceEvents.push({ workspaceData, meta }),
        });

        assert.strictEqual(progressEvents[0].phase, 'databases');
        assert.strictEqual(workspaceEvents[0].workspaceData.databases[0].id, 'db1');
        assert.strictEqual(result.workspaceData.databases[0].id, 'db1');
    });

    await runTest('UICommandService.execute: apply_workspace_selection normalizes page/database selections through TargetState.saveExportState', async () => {
        const harness = createHarness();
        const savedStates = [];

        harness.TargetState.saveExportState = (state) => {
            savedStates.push(state);
            return { ...state };
        };
        harness.TargetState.getExportState = () => ({ targetType: 'page', parentPageId: 'page1' });

        const result = await harness.UICommandService.execute('apply_workspace_selection', { selectedValue: 'page:page1' });

        assert.deepStrictEqual(savedStates[0], {
            targetType: harness.CONFIG.EXPORT_TARGET_TYPES.PAGE,
            parentPageId: 'page1'
        });
        assert.strictEqual(result.selectedType, 'page');
        assert.strictEqual(result.selectedId, 'page1');
    });

    await runTest('UICommandService.execute: set_export_target_state centralizes explicit export target updates', async () => {
        const harness = createHarness();
        const savedStates = [];

        harness.TargetState.saveExportState = (state) => {
            savedStates.push(state);
            return state;
        };
        harness.TargetState.getExportState = () => ({ targetType: 'database', databaseId: 'db1' });

        const result = await harness.UICommandService.execute('set_export_target_state', {
            targetType: harness.CONFIG.EXPORT_TARGET_TYPES.DATABASE,
            databaseId: 'db1'
        });

        assert.deepStrictEqual(savedStates[0], {
            targetType: harness.CONFIG.EXPORT_TARGET_TYPES.DATABASE,
            databaseId: 'db1',
            parentPageId: undefined
        });
        assert.strictEqual(result.exportState.databaseId, 'db1');
    });

    await runTest('UICommandService.execute: validate_export_target delegates validation and persists success state', async () => {
        const harness = createHarness();
        const savedStates = [];
        await unlockCredentialVault(harness);

        harness.NotionAPI.validateConfig = async (apiKey, databaseId) => {
            assert.strictEqual(apiKey, 'manual_api_key');
            assert.strictEqual(databaseId, 'db1');
            return { valid: true };
        };
        harness.TargetState.saveExportState = (state) => {
            savedStates.push(state);
            return state;
        };

        const result = await harness.UICommandService.execute('validate_export_target', {
            apiKey: 'manual_api_key',
            liveApiKey: 'manual_api_key',
            exportTargetType: harness.CONFIG.EXPORT_TARGET_TYPES.DATABASE,
            databaseId: 'db1'
        });

        assert.strictEqual(result.valid, true);
        assert.strictEqual(savedStates[0].databaseId, 'db1');
    });

    await runTest('UICommandService.execute: setup_export_database_properties delegates setup and persists export database on success', async () => {
        const harness = createHarness();
        let persistedDatabaseId = null;
        await unlockCredentialVault(harness);

        harness.NotionAPI.setupDatabaseProperties = async (databaseId, apiKey) => {
            assert.strictEqual(databaseId, 'db1');
            assert.strictEqual(apiKey, 'manual_api_key');
            return { success: true, message: 'ok' };
        };
        harness.TargetState.setExportDatabaseId = (databaseId) => {
            persistedDatabaseId = databaseId;
            return databaseId;
        };

        const result = await harness.UICommandService.execute('setup_export_database_properties', {
            apiKey: 'manual_api_key',
            liveApiKey: 'manual_api_key',
            databaseId: 'db1'
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(persistedDatabaseId, 'db1');
    });

    await runTest('UICommandService.execute: save_command_boundary_settings generic-export-target keeps schema setup inside declared legacy boundary', async () => {
        const harness = createHarness();
        let setupCall = null;
        await unlockCredentialVault(harness);

        harness.GenericExporter = harness.GenericExporter || {};
        harness.GenericExporter.setupDatabaseProperties = async (targetId, apiKey) => {
            setupCall = { targetId, apiKey };
            return { success: true, message: 'ok' };
        };

        const result = await harness.UICommandService.execute('save_command_boundary_settings', {
            scope: 'generic-export-target',
            liveApiKey: 'manual_api_key',
            apiKey: 'manual_api_key',
            exportType: harness.CONFIG.EXPORT_TARGET_TYPES.DATABASE,
            targetId: 'db1',
            imgMode: 'embed',
            autoSetupDatabaseProperties: true,
        });

        assert.deepStrictEqual(setupCall, { targetId: 'db1', apiKey: 'manual_api_key' });
        assert.strictEqual(result.setupResult.success, true);
        assert.ok(harness.UICommandService.LEGACY_DIRECT_NOTION_WRITE_BOUNDARY.note.includes('direct NotionAPI 写路径'));
    });

    await runTest('NotionSiteUI.bindEvents: workspace refresh delegates to WorkspaceService.refreshWorkspaceSnapshot', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#ldb-notion-api-key': Object.assign(createElementStub(), { value: 'manual_api_key' }),
            '#ldb-notion-refresh-workspace': createElementStub(),
            '#ldb-notion-workspace-tip': createElementStub(),
            '#ldb-notion-ai-target-db': createElementStub()
        });
        const targetUpdates = [];
        let refreshCalls = 0;

        harness.NotionSiteUI.panel = panel;
        harness.NotionOAuth.getAccessToken = (value) => value;
        harness.WorkspaceService.fetchWorkspaceStaged = async () => {
            throw new Error('fetchWorkspaceStaged should not be called directly from NotionSiteUI');
        };
        harness.WorkspaceService.refreshWorkspaceSnapshot = async (apiKey, options) => {
            refreshCalls += 1;
            assert.strictEqual(apiKey, 'manual_api_key');
            options.onProgress({ phase: 'databases', loaded: 1 });
            options.onWorkspaceData({
                apiKeyHash: 'manual_api_key'.slice(-8),
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [],
                timestamp: 1
            }, { phase: 'databases', isFinal: false });
            return {
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [{ id: 'page1', title: '项目计划' }],
                workspaceData: {
                    apiKeyHash: 'manual_api_key'.slice(-8),
                    databases: [{ id: 'db1', title: '知识库' }],
                    pages: [{ id: 'page1', title: '项目计划' }],
                    timestamp: 2
                }
            };
        };
        harness.NotionSiteUI.updateAITargetDbOptions = (databases, pages) => {
            targetUpdates.push({ databases, pages });
        };

        harness.NotionSiteUI.bindEvents();
        await panel.querySelector('#ldb-notion-refresh-workspace').onclick();

        assert.strictEqual(refreshCalls, 1);
        assert.strictEqual(targetUpdates.length, 2);
        assert.strictEqual(targetUpdates[1].pages[0].id, 'page1');
        assert.ok(panel.querySelector('#ldb-notion-workspace-tip').textContent.includes('获取到 1 个数据库，1 个页面'));
    });

    await runTest('NotionSiteUI.bindEvents: AI target selector and save settings delegate through UICommandService', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#ldb-notion-ai-target-db': Object.assign(createElementStub(), { value: 'page:cccc' }),
            '#ldb-notion-save-settings': createElementStub(),
            '#ldb-notion-api-key': Object.assign(createElementStub(), { value: 'manual_api_key' }),
            '#ldb-notion-ai-service': Object.assign(createElementStub(), { value: 'openai' }),
            '#ldb-notion-ai-model': Object.assign(createElementStub(), { value: 'gpt-4.1-mini' }),
            '#ldb-notion-ai-api-key': Object.assign(createElementStub(), { value: 'sk-test' }),
            '#ldb-notion-ai-base-url': Object.assign(createElementStub(), { value: 'https://example.com' }),
            '#ldb-notion-ai-categories': Object.assign(createElementStub(), { value: 'AI,工具' }),
            '#ldb-notion-workspace-max-pages': Object.assign(createElementStub(), { value: '50' }),
            '#ldb-notion-persona-name': Object.assign(createElementStub(), { value: 'Niko' }),
            '#ldb-notion-persona-tone': Object.assign(createElementStub(), { value: 'professional' }),
            '#ldb-notion-persona-expertise': Object.assign(createElementStub(), { value: 'notion' }),
            '#ldb-notion-persona-instructions': Object.assign(createElementStub(), { value: 'be concise' }),
            '#ldb-notion-github-username': Object.assign(createElementStub(), { value: 'smith' }),
            '#ldb-notion-github-token': Object.assign(createElementStub(), { value: 'ghp_xxx' })
        }, {
            '.ldb-notion-github-type:checked': [Object.assign(createElementStub(), { value: 'stars' })]
        });

        harness.NotionSiteUI.panel = panel;

        harness.NotionSiteUI.bindEvents();
        assert.ok(panel.querySelector('#ldb-notion-ai-target-db').onchange.toString().includes('UICommandService.execute("select_ai_target"'));
        assert.ok(panel.querySelector('#ldb-notion-save-settings').onclick.toString().includes('save_command_boundary_settings'));
    });

    await runTest('NotionSiteUI.bindEvents: model fetch delegates to AIService.fetchModelsSnapshot', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#ldb-notion-ai-api-key': Object.assign(createElementStub(), { value: 'sk-test' }),
            '#ldb-notion-ai-service': Object.assign(createElementStub(), { value: 'openai' }),
            '#ldb-notion-ai-base-url': Object.assign(createElementStub(), { value: 'https://example.com' }),
            '#ldb-notion-ai-fetch-models': createElementStub(),
            '#ldb-notion-ai-model-tip': createElementStub(),
            '#ldb-notion-ai-model': createElementStub()
        });
        const updates = [];
        let fetchCalls = 0;

        harness.NotionSiteUI.panel = panel;
        harness.store[harness.CONFIG.STORAGE_KEYS.AI_API_KEY] = 'sk-test';
        harness.AIService.fetchModels = async () => {
            throw new Error('fetchModels should not be called directly from NotionSiteUI');
        };
        harness.AIService.fetchModelsSnapshot = async (service, apiKey, baseUrl) => {
            fetchCalls += 1;
            assert.strictEqual(service, 'openai');
            assert.strictEqual(apiKey, 'sk-test');
            assert.strictEqual(baseUrl, 'https://example.com');
            return { models: ['gpt-4.1-mini', 'gpt-4o'], timestamp: 1 };
        };
        harness.NotionSiteUI.updateAIModelOptions = (service, models) => {
            updates.push({ service, models });
        };

        harness.NotionSiteUI.bindEvents();
        await panel.querySelector('#ldb-notion-ai-fetch-models').onclick();

        assert.strictEqual(fetchCalls, 1);
        assert.deepStrictEqual(updates[0], { service: 'openai', models: ['gpt-4.1-mini', 'gpt-4o'] });
        assert.ok(panel.querySelector('#ldb-notion-ai-model-tip').textContent.includes('获取到 2 个可用模型'));
    });

    await runTest('NotionSiteUI.updateAITargetDbOptions: restores legacy exporter database in the selector', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const select = createElementStub();

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.NotionSiteUI.panel = createPanelStub({
            '#ldb-notion-ai-target-db': select
        });

        harness.NotionSiteUI.updateAITargetDbOptions([
            { id: exportDb, title: 'Legacy Export DB' }
        ], []);

        assert.strictEqual(select.value, '');
        assert.ok(select.innerHTML.includes('默认（跟随导出数据库：Legacy Export DB）'), select.innerHTML);
    });

    await runTest('NotionSiteUI.updateAITargetDbOptions: explicit blank keeps the default option selected while describing the inherited exporter database', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const select = createElementStub();

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.TargetState.setAITarget('');
        harness.NotionSiteUI.panel = createPanelStub({
            '#ldb-notion-ai-target-db': select
        });

        harness.NotionSiteUI.updateAITargetDbOptions([
            { id: exportDb, title: 'Legacy Export DB' }
        ], []);

        assert.strictEqual(select.value, '');
        assert.ok(select.innerHTML.includes('默认（跟随导出数据库：Legacy Export DB）'), select.innerHTML);
        assert.strictEqual(harness.TargetState.getEffectiveAITargetState().databaseId, exportDb);
    });

    await runTest('NotionSiteUI.updateAITargetDbOptions: renders nested page targets with explicit parent context', async () => {
        const harness = createHarness();
        const nestedPageId = 'cccccccccccccccccccccccccccccccc';
        const nestedDatabasePageId = 'dddddddddddddddddddddddddddddddd';
        const select = createElementStub();

        harness.TargetState.setAITarget(`page:${nestedPageId}`);
        harness.NotionSiteUI.panel = createPanelStub({
            '#ldb-notion-ai-target-db': select
        });

        harness.NotionSiteUI.updateAITargetDbOptions([], [
            { id: nestedPageId, title: '项目计划', parent: 'page_id' },
            { id: nestedDatabasePageId, title: '周报归档', parent: 'database_id' }
        ]);

        assert.strictEqual(select.value, `page:${nestedPageId}`);
        assert.ok(select.innerHTML.includes('<optgroup label="📄 嵌套页面（数据库内/子页面）">'), select.innerHTML);
        assert.ok(select.innerHTML.includes('↳ 项目计划（子页面）'), select.innerHTML);
        assert.ok(select.innerHTML.includes('↳ 周报归档（数据库条目）'), select.innerHTML);
        assert.ok(!select.innerHTML.includes('已配置 (ID:'), select.innerHTML);
    });

    await runTest('NotionSiteUI.updateAITargetDbOptions: saved missing page targets use an explicit page compatibility label', async () => {
        const harness = createHarness();
        const savedPageId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        const select = createElementStub();

        harness.TargetState.setAITarget(`page:${savedPageId}`);
        harness.NotionSiteUI.panel = createPanelStub({
            '#ldb-notion-ai-target-db': select
        });

        harness.NotionSiteUI.updateAITargetDbOptions([], []);

        assert.strictEqual(select.value, `page:${savedPageId}`);
        assert.ok(
            select.innerHTML.includes(`已保存页面（当前列表之外，ID: ${savedPageId.slice(0, 8)}...）`),
            select.innerHTML
        );
    });

    await runTest('NotionSiteUI.initAIAssistant: page AI target falls back to exporter database for database-scoped tools', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const selectors = {
            '#ldb-notion-api-key': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-service': Object.assign(createElementStub(), { value: 'openai' }),
            '#ldb-notion-ai-model': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-target-db': Object.assign(createElementStub(), { value: 'page:cccccccccccccccccccccccccccccccc' }),
            '#ldb-notion-ai-api-key': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-base-url': Object.assign(createElementStub(), { value: '' }),
            '#ldb-notion-ai-categories': Object.assign(createElementStub(), { value: '' })
        };

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.NotionSiteUI.panel = createPanelStub(selectors);

        harness.NotionSiteUI.initAIAssistant();
        const settings = harness.AIAssistant.getSettings();

        assert.strictEqual(settings.notionDatabaseId, exportDb);
    });

    await runTest('NotionSiteUI.createPanel/UI.createPanel: stable welcome shortcuts stay aligned across both AI entry panels', async () => {
        const harness = createHarness();
        const notionPanel = harness.NotionSiteUI.createPanel();
        harness.UI.cacheRefs = () => {};
        harness.UI.bindEvents = () => {};
        harness.UI.loadConfig = () => {};
        harness.UI.createPanel();

        assertStableWelcomeMarkup(notionPanel.innerHTML, { includesPlaceholder: true });
        assertStableWelcomeMarkup(harness.UI.panel.innerHTML, { includesPlaceholder: true });
    });

    await runTest('GenericUI.updateTargetSelectOptions: exporter target remains isolated from AI target selection', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const aiDb = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const select = createElementStub();
        const exportType = Object.assign(createElementStub(), { value: 'database' });

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.TargetState.setAITarget(aiDb);
        harness.GenericUI.panel = createPanelStub({
            '#gclip-target-select': select,
            '#gclip-export-type': exportType
        });

        harness.GenericUI.updateTargetSelectOptions([
            { id: exportDb, title: 'Export DB' },
            { id: aiDb, title: 'AI DB' }
        ], []);

        assert.strictEqual(select.value, exportDb);
    });

    await runTest('GenericUI.refreshWorkspaceTargets: delegates backend refresh through WorkspaceService.refreshWorkspaceSnapshot', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#gclip-refresh-workspace': createElementStub(),
            '#gclip-target-tip': createElementStub()
        });
        const targetUpdates = [];
        let refreshCalls = 0;

        harness.GenericUI.panel = panel;
        harness.WorkspaceService.fetchWorkspaceStaged = async () => {
            throw new Error('fetchWorkspaceStaged should not be called directly from GenericUI');
        };
        harness.WorkspaceService.refreshWorkspaceSnapshot = async (apiKey, options) => {
            refreshCalls += 1;
            assert.strictEqual(apiKey, 'manual_api_key');
            options.onProgress({ phase: 'databases', loaded: 1 });
            options.onWorkspaceData({
                apiKeyHash: 'manual_api_key'.slice(-8),
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [],
                timestamp: 1
            }, { phase: 'databases', isFinal: false });
            return {
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [{ id: 'page1', title: '项目计划', parent: 'workspace' }],
                workspaceData: {
                    apiKeyHash: 'manual_api_key'.slice(-8),
                    databases: [{ id: 'db1', title: '知识库' }],
                    pages: [{ id: 'page1', title: '项目计划', parent: 'workspace' }],
                    timestamp: 2
                }
            };
        };
        harness.GenericUI.updateTargetSelectOptions = (databases, pages) => {
            targetUpdates.push({ databases, pages });
        };

        await harness.GenericUI.refreshWorkspaceTargets('manual_api_key');

        assert.strictEqual(refreshCalls, 1);
        assert.strictEqual(targetUpdates.length, 2);
        assert.strictEqual(targetUpdates[1].pages[0].parent, 'workspace');
        assert.ok(panel.querySelector('#gclip-target-tip').textContent.includes('已加载 1 个数据库，1 个页面'));
    });

    await runTest('GenericUI.refreshWorkspaceTargets and save settings delegate through UICommandService', async () => {
        const harness = createHarness();
        const saveSettingsBtn = Object.assign(createElementStub(), {
            addEventListener(eventName, handler) {
                this[`on${eventName}`] = handler;
            }
        });
        const panel = createAutoPanelStub({
            '#gclip-refresh-workspace': createElementStub(),
            '#gclip-target-tip': createElementStub(),
            '#gclip-save-settings': saveSettingsBtn,
            '#gclip-api-key-input': Object.assign(createElementStub(), { value: 'manual_api_key' }),
            '#gclip-export-type': Object.assign(createElementStub(), { value: 'database' }),
            '#gclip-target-select': Object.assign(createElementStub(), { value: 'db1' }),
            '#gclip-target-id': Object.assign(createElementStub(), { value: '' }),
            '#gclip-img-mode': Object.assign(createElementStub(), { value: 'embed' }),
            '#gclip-settings': Object.assign(createElementStub(), { style: { display: 'block' } }),
            '#gclip-export': Object.assign(createElementStub(), { style: { display: 'none' } }),
            '#gclip-show-settings': Object.assign(createElementStub(), { style: { display: 'none' } })
        });

        harness.GenericUI.panel = panel;
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_API_KEY] = 'manual_api_key';
        harness.GenericUI.bindEvents();
        assert.ok(harness.GenericUI.refreshWorkspaceTargets.toString().includes('UICommandService.execute("refresh_workspace_targets"'));
        assert.ok(saveSettingsBtn.onclick.toString().includes('save_command_boundary_settings'));
    });

    await runTest('UI.bindEvents: workspace picker selecting a database switches exporter back from page mode', async () => {
        const harness = createHarness();
        const oldDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const newDb = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const parentPageId = 'cccccccccccccccccccccccccccccccc';
        const panel = createAutoPanelStub();

        harness.TargetState.saveExportState({
            targetType: harness.CONFIG.EXPORT_TARGET_TYPES.PAGE,
            databaseId: oldDb,
            parentPageId
        });

        panel.querySelector('#ldb-export-target-page').checked = true;
        panel.querySelector('#ldb-parent-page-group').style.display = 'block';
        panel.querySelector('#ldb-manual-db-wrap').style.display = 'none';
        panel.querySelector('#ldb-export-target-tip').textContent = '导出为子页面，包含完整内容';
        panel.querySelector('#ldb-parent-page-id').value = parentPageId;

        harness.UI.panel = panel;
        harness.UI.cacheRefs();
        harness.UI.bindEvents();

        const workspaceSelect = panel.querySelector('#ldb-workspace-select');
        workspaceSelect.onchange({ target: { value: `database:${newDb}` } });

        const exportState = harness.TargetState.getExportState();
        assert.strictEqual(panel.querySelector('#ldb-database-id').value, newDb);
        assert.strictEqual(panel.querySelector('#ldb-export-target-database').checked, true);
        assert.strictEqual(panel.querySelector('#ldb-parent-page-group').style.display, 'none');
        assert.strictEqual(panel.querySelector('#ldb-export-target-tip').textContent, '导出为数据库条目，支持筛选和排序');
        assert.strictEqual(exportState.targetType, harness.CONFIG.EXPORT_TARGET_TYPES.DATABASE);
        assert.strictEqual(exportState.databaseId, newDb);
        assert.strictEqual(exportState.targetId, newDb);
    });

    await runTest('UI.bindEvents: workspace refresh delegates to WorkspaceService.refreshWorkspaceSnapshot', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#ldb-api-key': Object.assign(createElementStub(), { value: 'manual_api_key' }),
            '#ldb-refresh-workspace': createElementStub(),
            '#ldb-workspace-tip': createElementStub()
        });
        const workspaceUpdates = [];
        let refreshCalls = 0;

        harness.UI.panel = panel;
        harness.UI.cacheRefs();
        harness.NotionOAuth.getAccessToken = (value) => value;
        harness.WorkspaceService.fetchWorkspaceStaged = async () => {
            throw new Error('fetchWorkspaceStaged should not be called directly from UI');
        };
        harness.WorkspaceService.refreshWorkspaceSnapshot = async (apiKey, options) => {
            refreshCalls += 1;
            assert.strictEqual(apiKey, 'manual_api_key');
            options.onProgress({ phase: 'databases', loaded: 1 });
            options.onWorkspaceData({
                apiKeyHash: 'manual_api_key'.slice(-8),
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [],
                timestamp: 1
            }, { phase: 'databases', isFinal: false });
            return {
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [{ id: 'page1', title: '项目计划' }],
                workspaceData: {
                    apiKeyHash: 'manual_api_key'.slice(-8),
                    databases: [{ id: 'db1', title: '知识库' }],
                    pages: [{ id: 'page1', title: '项目计划' }],
                    timestamp: 2
                }
            };
        };
        harness.UI.updateWorkspaceSelect = (workspaceData) => {
            workspaceUpdates.push(workspaceData);
        };

        harness.UI.bindEvents();
        await harness.UI.refs.refreshWorkspaceBtn.onclick();

        assert.strictEqual(refreshCalls, 1);
        assert.strictEqual(workspaceUpdates.length, 2);
        assert.strictEqual(workspaceUpdates[1].pages[0].id, 'page1');
        assert.ok(harness.UI.refs.workspaceTip.textContent.includes('获取到 1 个数据库，1 个页面'));
    });

    await runTest('UI.bindEvents: workspace selector delegates through UICommandService.apply_workspace_selection', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub();

        harness.UI.panel = panel;
        harness.UI.cacheRefs();

        harness.UI.bindEvents();
        assert.ok(panel.querySelector('#ldb-workspace-select').onchange.toString().includes('apply_workspace_selection'));
    });

    await runTest('UI.bindEvents: export target radio, parent page save, validate and setup delegate through UICommandService', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#ldb-api-key': Object.assign(createElementStub(), { value: 'manual_api_key' }),
            '#ldb-database-id': Object.assign(createElementStub(), { value: 'db1' }),
            '#ldb-parent-page-id': Object.assign(createElementStub(), { value: 'page1' }),
            '#ldb-export-target-database': Object.assign(createElementStub(), { checked: true, value: 'database' }),
            '#ldb-export-target-page': Object.assign(createElementStub(), { checked: false, value: 'page' }),
            '#ldb-validate-config': createElementStub(),
            '#ldb-setup-database': createElementStub(),
            '#ldb-config-status': createElementStub()
        });

        harness.UI.panel = panel;
        harness.UI.cacheRefs();
        harness.UI.bindEvents();

        assert.ok(harness.UI.refs.exportTargetDatabaseRadio.onchange.toString().includes('set_export_target_state'));
        assert.ok(harness.UI.refs.parentPageIdInput.onchange.toString().includes('set_export_target_state'));
        assert.ok(harness.UI.refs.validateConfigBtn.onclick.toString().includes('validate_export_target'));
        assert.ok(harness.UI.refs.setupDatabaseBtn.onclick.toString().includes('setup_export_database_properties'));
    });

    await runTest('UI.bindEvents: AI database refresh delegates to WorkspaceService.refreshWorkspaceSnapshot with database-only mode', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#ldb-api-key': Object.assign(createElementStub(), { value: 'manual_api_key' }),
            '#ldb-ai-refresh-dbs': createElementStub(),
            '#ldb-ai-model-tip': createElementStub()
        });
        const dbUpdates = [];
        let refreshCalls = 0;

        harness.UI.panel = panel;
        harness.UI.cacheRefs();
        harness.NotionOAuth.getAccessToken = (value) => value;
        harness.WorkspaceService.fetchWorkspace = async () => {
            throw new Error('fetchWorkspace should not be called directly from UI AI db refresh');
        };
        harness.WorkspaceService.refreshWorkspaceSnapshot = async (apiKey, options) => {
            refreshCalls += 1;
            assert.strictEqual(apiKey, 'manual_api_key');
            assert.strictEqual(options.includePages, false);
            options.onWorkspaceData({
                apiKeyHash: 'manual_api_key'.slice(-8),
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [],
                timestamp: 1
            }, { phase: 'databases', isFinal: true });
            return {
                databases: [{ id: 'db1', title: '知识库' }],
                pages: [],
                workspaceData: {
                    apiKeyHash: 'manual_api_key'.slice(-8),
                    databases: [{ id: 'db1', title: '知识库' }],
                    pages: [],
                    timestamp: 1
                }
            };
        };
        harness.UI.updateAITargetDbOptions = (databases) => {
            dbUpdates.push(databases);
        };
        harness.UI.showStatus = (message, type) => {
            harness.notifications.push({ message, type });
        };

        harness.UI.bindEvents();
        await harness.UI.refs.aiRefreshDbsBtn.onclick();

        assert.strictEqual(refreshCalls, 1);
        assert.strictEqual(dbUpdates.length, 2);
        assert.strictEqual(dbUpdates[1][0].id, 'db1');
        assert.deepStrictEqual(harness.notifications.at(-1), { message: '获取到 1 个数据库', type: 'success' });
    });

    await runTest('UI.bindEvents: AI model fetch delegates to AIService.fetchModelsSnapshot', async () => {
        const harness = createHarness();
        const panel = createAutoPanelStub({
            '#ldb-ai-api-key': Object.assign(createElementStub(), { value: 'sk-test' }),
            '#ldb-ai-service': Object.assign(createElementStub(), { value: 'openai' }),
            '#ldb-ai-base-url': Object.assign(createElementStub(), { value: 'https://example.com' }),
            '#ldb-ai-fetch-models': createElementStub(),
            '#ldb-ai-model-tip': createElementStub(),
            '#ldb-ai-model': createElementStub()
        });
        const updates = [];
        let fetchCalls = 0;

        harness.UI.panel = panel;
        harness.UI.cacheRefs();
        harness.store[harness.CONFIG.STORAGE_KEYS.AI_API_KEY] = 'sk-test';
        harness.AIService.fetchModels = async () => {
            throw new Error('fetchModels should not be called directly from UI AI model fetch');
        };
        harness.AIService.fetchModelsSnapshot = async (service, apiKey, baseUrl) => {
            fetchCalls += 1;
            assert.strictEqual(service, 'openai');
            assert.strictEqual(apiKey, 'sk-test');
            assert.strictEqual(baseUrl, 'https://example.com');
            return { models: ['gpt-4.1-mini', 'gpt-4o'], timestamp: 1 };
        };
        harness.UI.updateAIModelOptions = (service, models) => {
            updates.push({ service, models });
        };
        harness.UI.showStatus = (message, type) => {
            harness.notifications.push({ message, type });
        };

        harness.UI.bindEvents();
        await harness.UI.refs.aiFetchModelsBtn.onclick();

        assert.strictEqual(fetchCalls, 1);
        assert.deepStrictEqual(updates[0], { service: 'openai', models: ['gpt-4.1-mini', 'gpt-4o'] });
        assert.ok(harness.UI.refs.aiModelTip.textContent.includes('获取到 2 个可用模型'));
        assert.deepStrictEqual(harness.notifications.at(-1), { message: '成功获取 2 个模型', type: 'success' });
    });

    await runTest('UI.buildVisualizationModel: aggregates Linux.do and GitHub snapshots into source, status and timeline summaries', async () => {
        const harness = createHarness();

        harness.store[harness.CONFIG.STORAGE_KEYS.EXPORTED_TOPICS] = JSON.stringify({
            101: Date.now()
        });
        harness.store[harness.CONFIG.STORAGE_KEYS.LINUXDO_IMPORT_DEDUP_MODE] = 'strict';
        harness.GitHubAPI.isExported = (itemKey) => itemKey === 'smith/repo-b';
        harness.GitHubAPI.isGistExported = (itemKey) => itemKey === 'gist-1';

        harness.UI.selectedBookmarks = new Set([
            '101',
            'gh:repos:smith/repo-a'
        ]);

        harness.UI.updateVisualSnapshot('linuxdo', [
            {
                topic_id: 101,
                title: 'Post A',
                created_at: '2026-06-01T10:00:00Z'
            }
        ]);
        harness.UI.updateVisualSnapshot('github', [
            {
                source: 'github',
                sourceType: 'repos',
                itemKey: 'smith/repo-a',
                title: 'Repo A',
                raw: {
                    updated_at: '2026-06-02T12:00:00Z'
                }
            },
            {
                source: 'github',
                sourceType: 'gists',
                itemKey: 'gist-1',
                title: 'Gist A',
                raw: {
                    created_at: '2026-06-03T08:00:00Z'
                }
            }
        ]);

        const model = harness.UI.buildVisualizationModel();
        const sourceBreakdownMap = Object.fromEntries(model.sourceBreakdown.map((item) => [item.label, item]));
        const typeBreakdownMap = Object.fromEntries(model.typeBreakdown.map((item) => [item.label, item]));

        assert.strictEqual(model.total, 3);
        assert.strictEqual(model.exported, 2);
        assert.strictEqual(model.pending, 1);
        assert.strictEqual(model.selected, 2);
        assert.deepStrictEqual(model.loadedSources, ['Linux.do', 'GitHub']);
        assert.deepStrictEqual(sourceBreakdownMap['GitHub'], { label: 'GitHub', count: 2, pct: 67 });
        assert.deepStrictEqual(sourceBreakdownMap['Linux.do'], { label: 'Linux.do', count: 1, pct: 33 });
        assert.strictEqual(typeBreakdownMap.Repos.count, 1);
        assert.strictEqual(typeBreakdownMap.Gists.count, 1);
        assert.strictEqual(model.typeBreakdown.length, 3);
        assert.deepStrictEqual(model.timeline, [
            { key: '2026-06-03', label: '06/03', count: 1, exported: 1 },
            { key: '2026-06-02', label: '06/02', count: 1, exported: 0 },
            { key: '2026-06-01', label: '06/01', count: 1, exported: 1 }
        ]);
    });

    await runTest('UI.buildWorkspaceVisualizationModel: aggregates workspace records into timeline, relationships and funnel summaries', async () => {
        const harness = createHarness();
        const { databases, records } = createWorkspaceVisualizationFixture(harness);
        const model = harness.UI.buildWorkspaceVisualizationModel({
            databases,
            records,
            scannedAt: 1,
            maxPages: 50
        });
        const sourceBreakdownMap = Object.fromEntries(model.sourceBreakdown.map((item) => [item.label, item]));
        const relationshipMap = Object.fromEntries(model.relationships.map((item) => [item.label, item.count]));

        assert.strictEqual(model.totalPages, 5);
        assert.strictEqual(model.totalDatabases, 3);
        assert.strictEqual(model.sourcedPages, 4);
        assert.strictEqual(model.datedPages, 4);
        assert.strictEqual(model.categorizedPages, 3);
        assert.strictEqual(model.structuredPages, 3);
        assert.strictEqual(model.missingSourcePages, 1);
        assert.strictEqual(model.missingDatePages, 1);
        assert.strictEqual(model.missingCategoryPages, 2);
        assert.deepStrictEqual(model.funnel.map((item) => item.count), [5, 4, 4, 3, 3]);
        assert.deepStrictEqual(model.timeline, [
            { key: '2026-06-03', label: '06/03', count: 1 },
            { key: '2026-06-02', label: '06/02', count: 1 },
            { key: '2026-06-01', label: '06/01', count: 1 },
            { key: '2026-05-31', label: '05/31', count: 1 }
        ]);
        assert.strictEqual(sourceBreakdownMap['Linux.do'].count, 1);
        assert.strictEqual(sourceBreakdownMap['GitHub'].count, 1);
        assert.strictEqual(sourceBreakdownMap['浏览器书签'].count, 1);
        assert.strictEqual(sourceBreakdownMap['通用页面'].count, 1);
        assert.strictEqual(sourceBreakdownMap['未标记'].count, 1);
        assert.strictEqual(relationshipMap['Linux 收藏 → Linux.do'], 1);
        assert.strictEqual(relationshipMap['GitHub 收藏 → GitHub'], 1);
        assert.strictEqual(relationshipMap['Inbox → 浏览器书签'], 1);
        assert.strictEqual(relationshipMap['Inbox → 未标记'], 1);
        assert.strictEqual(relationshipMap['工作区页面 → 通用页面'], 1);
    });

    await runTest('UI.renderWorkspaceVisualSummary: renders workspace timeline, relationship graph and funnel cards', async () => {
        const harness = createHarness();
        const summaryContainer = createElementStub();
        const { databases, pages, records } = createWorkspaceVisualizationFixture(harness);

        harness.UI.refs = {
            viewWorkspaceSummary: summaryContainer
        };
        harness.UI.workspaceVisualSnapshot = {
            databases,
            pages,
            records,
            scannedAt: 1,
            maxPages: 50
        };

        harness.UI.renderWorkspaceVisualSummary();

        assert.ok(summaryContainer.innerHTML.includes('已扫描页面'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('覆盖 3 个数据库'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('结构完整'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('全局时间线'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('来源关系图'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('导出漏斗'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('Linux 收藏 → Linux.do'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('Inbox → 浏览器书签'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('识别来源'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('未标记 1'), summaryContainer.innerHTML);
        assert.ok(!summaryContainer.innerHTML.includes('[object Object]'), summaryContainer.innerHTML);
    });

    await runTest('UI.refreshWorkspaceVisualization: persists workspace snapshot, renders summary and updates status', async () => {
        const harness = createHarness();
        const summaryContainer = createElementStub();
        const statusEl = createElementStub();
        const refreshBtn = Object.assign(createElementStub(), { textContent: '刷新工作区视图' });
        const maxPagesSelect = Object.assign(createElementStub(), { value: '50' });
        const { databases, pages, records } = createWorkspaceVisualizationFixture(harness);
        const workspaceUpdates = [];
        const aiDbUpdates = [];
        const persistedPayloads = [];

        harness.UI.refs = {
            viewWorkspaceSummary: summaryContainer,
            viewWorkspaceStatus: statusEl,
            viewRefreshWorkspaceBtn: refreshBtn,
            workspaceMaxPagesSelect: maxPagesSelect,
            apiKeyInput: Object.assign(createElementStub(), { value: 'manual_api_key' })
        };

        harness.WorkspaceService.refreshWorkspaceSnapshot = async (apiKey, options) => {
            assert.strictEqual(apiKey, 'manual_api_key');
            assert.strictEqual(refreshBtn.disabled, true);
            assert.strictEqual(refreshBtn.textContent, '扫描中...');
            options.onProgress({ phase: 'databases', loaded: databases.length });
            assert.ok(statusEl.textContent.includes(`已加载 ${databases.length} 个数据库`), statusEl.textContent);
            options.onWorkspaceData({
                apiKeyHash: apiKey.slice(-8),
                databases,
                pages: [],
                timestamp: 1
            });
            return {
                databases,
                workspaceData: {
                    apiKeyHash: apiKey.slice(-8),
                    databases,
                    pages: [],
                    timestamp: 2
                }
            };
        };
        harness.WorkspaceService.fetchWorkspacePageObjects = async (apiKey, options) => {
            assert.strictEqual(apiKey, 'manual_api_key');
            assert.strictEqual(options.maxPages, 50);
            assert.strictEqual(options.phase, 'workspace_visual_pages');
            options.onProgress({ loaded: pages.length });
            assert.ok(statusEl.textContent.includes(`已扫描 ${pages.length} 个页面`), statusEl.textContent);
            return pages;
        };
        harness.WorkspaceService.persistWorkspaceData = (apiKey, payload) => {
            persistedPayloads.push({ apiKey, payload });
            return {
                apiKeyHash: apiKey.slice(-8),
                databases: payload.databases,
                pages: payload.pages,
                timestamp: 3
            };
        };
        harness.UI.updateWorkspaceSelect = (workspaceData) => {
            workspaceUpdates.push(workspaceData);
        };
        harness.UI.updateAITargetDbOptions = (dbs) => {
            aiDbUpdates.push(dbs);
        };

        const model = await harness.UI.refreshWorkspaceVisualization('manual_api_key');

        assert.strictEqual(model.totalPages, 5);
        assert.strictEqual(model.totalDatabases, 3);
        assert.strictEqual(workspaceUpdates.length, 2);
        assert.strictEqual(aiDbUpdates.length, 2);
        assert.strictEqual(aiDbUpdates[0][0].id, 'db_linux');
        assert.strictEqual(workspaceUpdates[1].pages.length, 5);
        assert.strictEqual(persistedPayloads.length, 1);
        assert.strictEqual(persistedPayloads[0].payload.pages[0].id, pages[0].id.replace(/-/g, ''));
        assert.strictEqual(harness.UI.workspaceVisualSnapshot.records.length, records.length);
        assert.ok(harness.UI.workspaceVisualSnapshot.scannedAt > 0);
        assert.strictEqual(refreshBtn.disabled, false);
        assert.strictEqual(refreshBtn.textContent, '刷新工作区视图');
        assert.strictEqual(statusEl.dataset.tone, 'success');
        assert.ok(statusEl.textContent.includes('已扫描 5 个页面，覆盖 3 个数据库。'), statusEl.textContent);
        assert.ok(summaryContainer.innerHTML.includes('导出漏斗'), summaryContainer.innerHTML);
        assert.ok(summaryContainer.innerHTML.includes('Linux 收藏 → Linux.do'), summaryContainer.innerHTML);
    });

    await runTest('AIAssistant.AGENT_TOOLS.query_database: reuses legacy export database when AI target is missing', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        let capturedDbId = null;

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.NotionAPI.queryDatabase = async (dbId) => {
            capturedDbId = dbId;
            return { results: [], has_more: false, next_cursor: null };
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.query_database.execute({}, {
            notionApiKey: 'manual_api_key',
            notionDatabaseId: ''
        });

        assert.strictEqual(capturedDbId, exportDb);
        assertStructuredToolResult(result, {
            name: 'query_database',
            status: 'empty',
            summary: '数据库中没有页面。',
            text: '数据库中没有页面。'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.query_database: page AI target no longer leaks page ids into database queries', async () => {
        const harness = createHarness();
        const exportDb = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        let capturedDbId = null;

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = exportDb;
        harness.TargetState.setAITarget('page:cccccccccccccccccccccccccccccccc');
        harness.NotionAPI.queryDatabase = async (dbId) => {
            capturedDbId = dbId;
            return { results: [], has_more: false, next_cursor: null };
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.query_database.execute({}, {
            notionApiKey: 'manual_api_key',
            notionDatabaseId: exportDb
        });

        assert.strictEqual(capturedDbId, exportDb);
        assertStructuredToolResult(result, {
            name: 'query_database',
            status: 'empty',
            summary: '数据库中没有页面。',
            text: '数据库中没有页面。'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.append_content: routes page append writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIAssistant._resolvePageId = async () => ({ id: 'page_append_1', name: '项目计划' });
        harness.NotionAPI.appendPageMarkdown = async () => {
            calls.push('appendPageMarkdown');
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.itemName]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.append_content.execute({
            page_name: '项目计划',
            content: '## Added'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'appendBlocks', '项目计划']);
        assert.strictEqual(calls[1], 'appendPageMarkdown');
        assertStructuredToolResult(result, {
            title: '页面内容追加完成'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.create_comment: routes comment writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIAssistant._resolvePageId = async () => ({ id: 'page_comment_1', name: '项目计划' });
        harness.NotionAPI.createComment = async (payload) => {
            calls.push(['createComment', payload.pageId, payload.content]);
            return { id: 'comment_new_1' };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.itemName, context.pageId]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.create_comment.execute({
            page_name: '项目计划',
            content: '请补充示例'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'createComment', '项目计划', 'page_comment_1']);
        assert.deepStrictEqual(calls[1], ['createComment', 'page_comment_1', '请补充示例']);
        assertStructuredToolResult(result, {
            title: '评论已创建'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.create_page: routes page creation through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.NotionAPI.createPageObject = async (parent, properties) => {
            calls.push(['createPageObject', parent.database_id, properties['标题'].title[0].text.content]);
            return { id: 'page_new_1' };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.itemName]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.create_page.execute({
            title: '新页面'
        }, {
            notionApiKey: 'manual_api_key',
            notionDatabaseId: 'db_parent_1'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'createDatabasePage', '新页面']);
        assert.deepStrictEqual(calls[1], ['createPageObject', 'db_parent_1', '新页面']);
        assertStructuredToolResult(result, {
            title: '页面创建完成'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.search_replace_page_markdown: routes markdown edits through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIAssistant._resolvePageId = async () => ({ id: 'page_markdown_1', name: '项目计划' });
        harness.NotionAPI.searchReplacePageMarkdown = async (pageId, updates) => {
            calls.push(['searchReplace', pageId, updates.length]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.pageId]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.search_replace_page_markdown.execute({
            page_name: '项目计划',
            updates: [{ old_str: '旧内容', new_str: '新内容' }]
        }, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'updatePageMarkdown', 'page_markdown_1']);
        assert.deepStrictEqual(calls[1], ['searchReplace', 'page_markdown_1', 1]);
        assertStructuredToolResult(result, {
            title: 'Markdown 精确替换完成'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.archive_page: preserves page context for dangerous guarded writes', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIAssistant._resolvePageTargets = async () => [{ id: 'page_archive_1', name: '旧页面' }];
        harness.NotionAPI.deletePage = async (pageId) => {
            calls.push(['deletePage', pageId]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.itemName, context.pageId]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.archive_page.execute({}, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'deletePage', '旧页面', 'page_archive_1']);
        assert.deepStrictEqual(calls[1], ['deletePage', 'page_archive_1']);
        assertStructuredToolResult(result, {
            title: '页面归档完成'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.update_page_property: routes property writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.NotionAPI.updatePage = async (pageId, payload) => {
            calls.push(['updatePage', pageId, payload]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.pageId]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.update_page_property.execute({
            page_id: 'page_prop_1',
            property: '状态',
            value: '处理中',
            type: 'text'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'updatePage', 'page_prop_1']);
        assert.strictEqual(calls[1][0], 'updatePage');
        assertStructuredToolResult(result, {
            name: 'update_page_property',
            summary: '已更新页面属性「状态」为「处理中」。',
            text: '已更新页面属性「状态」为「处理中」。'
        });
    });

    await runTest('AIAssistant.AGENT_TOOLS.update_page: routes metadata writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIAssistant._resolvePageTargets = async () => [{ id: 'page_meta_1', name: '项目计划' }];
        harness.NotionAPI.updatePageMeta = async (pageId, payload) => {
            calls.push(['updatePageMeta', pageId, payload.icon?.emoji || '']);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.pageId]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.update_page.execute({
            page_name: '项目计划',
            icon_emoji: '🚀'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'updatePage', 'page_meta_1']);
        assert.deepStrictEqual(calls[1], ['updatePageMeta', 'page_meta_1', '🚀']);
        assertStructuredToolResult(result, {
            title: '页面更新完成'
        });
    });

    await runTest('AIAssistant.handleAIAutofill: routes page property writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID] = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.pageId]);
            return executor();
        };
        harness.AIAssistant.checkConfig = () => ({ valid: true });
        harness.AIAssistant._ensureAIProperty = async () => {};
        harness.NotionAPI.queryDatabase = async () => ({
            results: [{
                id: 'page_auto_1',
                properties: {
                    标题: { title: [{ plain_text: '项目计划' }] }
                }
            }],
            has_more: false,
            next_cursor: null
        });
        harness.AIAssistant._extractPageContent = async () => '内容';
        harness.AIService.requestChat = async () => '自动摘要';
        harness.NotionAPI.request = async (method, url, body) => {
            calls.push(['request', method, url, body.properties ? 'properties' : 'none']);
            return { ok: true };
        };

        const result = await harness.AIAssistant.handleAIAutofill({
            autofill_type: 'summary'
        }, {
            notionApiKey: 'manual_api_key',
            notionDatabaseId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            aiApiKey: 'ai_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'updatePage', 'page_auto_1']);
        assert.deepStrictEqual(calls[1][0], 'request');
        assert.ok(String(result).includes('AI 属性填充完成'));
    });

    await runTest('AIAssistant.AGENT_TOOLS.update_block_content: routes block writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.NotionAPI.fetchBlock = async () => ({
            type: 'paragraph',
            paragraph: { rich_text: [] }
        });
        harness.NotionAPI.updateBlock = async (blockId) => {
            calls.push(['updateBlock', blockId]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.itemName]);
            return executor();
        };

        const result = await harness.AIAssistant.AGENT_TOOLS.update_block_content.execute({
            block_id: 'block_123',
            content: '新内容'
        }, {
            notionApiKey: 'manual_api_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'updateBlock', 'block_123']);
        assert.deepStrictEqual(calls[1], ['updateBlock', 'block_123']);
        assertStructuredToolResult(result, {
            title: '块内容更新完成'
        });
    });

    await runTest('AIAssistant.handleTranslateContent: routes append translation writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIAssistant.checkConfig = () => ({ valid: true });
        harness.AIAssistant._resolvePageId = async () => ({ id: 'page_translate_1', name: '项目计划' });
        harness.AIAssistant._extractPageContent = async () => '原文';
        harness.AIService.requestChat = async () => '翻译结果';
        harness.NotionAPI.appendBlocks = async (pageId) => {
            calls.push(['appendBlocks', pageId]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.pageId]);
            return executor();
        };

        const result = await harness.AIAssistant.handleTranslateContent({
            page_name: '项目计划',
            target_language: '英文'
        }, {
            notionApiKey: 'manual_api_key',
            aiApiKey: 'ai_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'appendBlocks', 'page_translate_1']);
        assert.deepStrictEqual(calls[1], ['appendBlocks', 'page_translate_1']);
        assert.ok(String(result).includes('翻译已追加到页面'));
    });

    await runTest('AIAssistant.handleEditContent: append-version writes route through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIAssistant.checkConfig = () => ({ valid: true });
        harness.AIAssistant._resolvePageId = async () => ({ id: 'page_edit_1', name: '项目计划' });
        harness.AIAssistant._extractPageContent = async () => '原文内容';
        harness.AIService.requestChat = async () => JSON.stringify({
            mode: 'append_version',
            append_markdown: '## 改写版本'
        });
        harness.NotionAPI.appendPageMarkdown = async (pageId) => {
            calls.push(['appendPageMarkdown', pageId]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.pageId]);
            return executor();
        };

        const result = await harness.AIAssistant.handleEditContent({
            page_name: '项目计划',
            content_prompt: '改得更简洁'
        }, {
            notionApiKey: 'manual_api_key',
            aiApiKey: 'ai_key'
        });

        assert.deepStrictEqual(calls[0], ['guard', 'appendBlocks', 'page_edit_1']);
        assert.deepStrictEqual(calls[1], ['appendPageMarkdown', 'page_edit_1']);
        assert.ok(String(result).includes('编辑版本已追加到页面'));
    });

    await runTest('AIClassifier.classifyPage: routes page classification writes through OperationGuard.execute', async () => {
        const harness = createHarness();
        const calls = [];

        harness.AIClassifier.fetchPageBlocks = async () => [];
        harness.AIService.classify = async () => '技术';
        harness.NotionAPI.updatePage = async (pageId) => {
            calls.push(['updatePage', pageId]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.pageId]);
            return executor();
        };

        const result = await harness.AIClassifier.classifyPage({
            id: 'page_classify_1',
            properties: { 标题: { title: [{ plain_text: '项目计划' }] } }
        }, {
            notionApiKey: 'manual_api_key',
            categories: ['技术', '产品']
        });

        assert.deepStrictEqual(calls[0], ['guard', 'updatePage', 'page_classify_1']);
        assert.deepStrictEqual(calls[1], ['updatePage', 'page_classify_1']);
        assert.strictEqual(result, '技术');
    });

    await runTest('AIClassifier.ensureAICategoryProperty: routes schema writes through OperationGuard.execute at standard level', async () => {
        const harness = createHarness();
        const calls = [];

        assert.strictEqual(harness.OperationGuard.OPERATION_LEVELS.updateDatabase, 1);
        harness.NotionAPI.fetchDatabase = async () => ({ properties: {} });
        harness.NotionAPI.updateDatabase = async (dbId) => {
            calls.push(['updateDatabase', dbId]);
            return { ok: true };
        };
        harness.OperationGuard.execute = async (operation, executor, context) => {
            calls.push(['guard', operation, context.itemName]);
            return executor();
        };

        await harness.AIClassifier.ensureAICategoryProperty({
            notionApiKey: 'manual_api_key',
            notionDatabaseId: 'db_123',
            categories: ['技术', '产品']
        });

        assert.deepStrictEqual(calls[0], ['guard', 'updateDatabase', 'db_123']);
        assert.deepStrictEqual(calls[1], ['updateDatabase', 'db_123']);
    });

    await runTest('ChatUI.renderMessages: renders structured assistant results without object leakage', async () => {
        const harness = createHarness();
        const container = createElementStub();

        harness.registerSelector('#ldb-chat-messages', container);
        harness.ChatState.messages = [{
            id: 1,
            role: 'assistant',
            status: 'complete',
            content: harness.AIAssistant._formatToolResult({
                title: '工作区搜索结果',
                fields: [{ label: '总数', value: 1 }],
                bullets: ['[页面] 项目计划']
            }),
            timestamp: '2026-04-10T00:00:00.000Z'
        }];

        harness.ChatUI.renderMessages();

        assert.ok(container.innerHTML.includes('<strong>工作区搜索结果</strong>'), container.innerHTML);
        assert.ok(container.innerHTML.includes('总数: 1'), container.innerHTML);
        assert.ok(container.innerHTML.includes('[页面] 项目计划'), container.innerHTML);
        assert.ok(!container.innerHTML.includes('[object Object]'), container.innerHTML);
    });

    await runTest('ChatUI.renderMessages: empty state advertises stable entry points and wires concise chips to full commands', async () => {
        const harness = createHarness();
        const container = createElementStub();
        const chatInput = createElementStub();
        let sent = 0;
        const chips = STABLE_WELCOME_CHIPS.map(({ command }) => Object.assign(createElementStub(), {
            getAttribute: (name) => (name === 'data-cmd' ? command : '')
        }));

        container.querySelectorAll = (selector) => (selector === '.ldb-chat-chip' ? chips : []);
        harness.registerSelector('#ldb-chat-messages', container);
        harness.registerSelector('#ldb-chat-input', chatInput);
        harness.ChatState.messages = [];
        harness.ChatUI.sendMessage = () => {
            sent += 1;
        };

        harness.ChatUI.renderMessages();

        assertStableWelcomeMarkup(container.innerHTML);
        chips[2].onclick();
        assert.strictEqual(chatInput.value, '在工作区搜索所有页面');
        assert.strictEqual(sent, 1);
    });

    await runTest('scripts/build-extension.js: exports reusable extraction and BookmarkBridge patch seams', async () => {
        const iifeBody = extractUserscriptIifeBody(userScriptContent);
        const patched = patchBookmarkBridgeForExtension(iifeBody);

        assert.ok(userScriptContent.includes(BUILD_ANCHORS.userscriptBodyStart));
        assert.ok(userScriptContent.includes(BUILD_ANCHORS.userscriptBodyEnd));
        assert.ok(!iifeBody.includes(BUILD_ANCHORS.userscriptBodyStart));
        assert.ok(!iifeBody.includes(BUILD_ANCHORS.userscriptBodyEnd));
        assert.ok(iifeBody.includes(BUILD_ANCHORS.bookmarkBridgeStart));
        assert.ok(iifeBody.includes(BUILD_ANCHORS.bookmarkBridgeEnd));
        assert.ok(iifeBody.includes('const BookmarkBridge = {'));
        assert.ok(!iifeBody.includes('// ==UserScript=='));
        assert.deepStrictEqual(patched.patchedMethods, [
            'isExtensionAvailable',
            '_request',
            'getBookmarkTree',
            'getBookmarks',
            'searchBookmarks',
            'init'
        ]);
        assert.ok(patched.code.includes(BUILD_ANCHORS.bookmarkBridgeStart));
        assert.ok(patched.code.includes(BUILD_ANCHORS.bookmarkBridgeEnd));
        assert.ok(patched.code.includes('return !!(typeof chrome !== "undefined" && chrome.bookmarks);'));
        assert.ok(patched.code.includes('return chrome.bookmarks.getTree();'));
        assert.ok(patched.code.includes('return chrome.bookmarks.search(query || "");'));
        assert.ok(!patched.code.includes("return !!document.querySelector('meta[name=\"ld-notion-ext\"][content=\"ready\"]');"));
    });

    await runTest('scripts/build-extension.js: exposes reusable generated asset builders', async () => {
        const backgroundScript = buildBackgroundScript();
        const gmShim = buildGmShim();
        const popupHtml = buildPopupHtml();
        const popupScript = buildPopupScript();
        const contentScript = buildContentScript({ gmShim, patchedBody: 'console.log("patched");' });
        const manifest = buildManifest({ version: '9.9.9' });

        assert.ok(backgroundScript.includes('message.type !== "GM_xmlhttpRequest"'));
        assert.ok(backgroundScript.includes('return true;'));
        assert.ok(gmShim.includes(GENERATED_SECTION_MARKERS.gmShimStart));
        assert.ok(gmShim.includes(GENERATED_SECTION_MARKERS.gmShimEnd));
        assert.ok(contentScript.includes('await _gmInitStorage();'));
        assert.ok(contentScript.includes('console.log("patched");'));
        assert.ok(popupHtml.includes('id="import-bookmarks"'));
        assert.ok(popupHtml.includes('<script src="popup.js"></script>'));
        assert.ok(popupScript.includes('LD_NOTION_IMPORT_BOOKMARKS'));
        assert.ok(popupScript.includes('LD_NOTION_IMPORT_GITHUB'));
        assert.ok(popupScript.includes('LD_NOTION_SET_BOOKMARK_SOURCE'));
        assert.strictEqual(manifest.version, '9.9.9');
        assert.strictEqual(manifest.background?.service_worker, 'background.js');
        assert.strictEqual(manifest.action?.default_popup, 'popup.html');
    });

    await runTest('scripts/build-extension.js: resolves manifest profiles and keeps default output policy stable', async () => {
        const resolvedDefault = resolveManifestProfile();
        const resolvedBounded = resolveManifestProfile('bounded_hosts');
        const manifest = buildManifest({ version: '9.9.9' });
        const boundedManifest = buildManifest({ version: '9.9.9', profile: 'bounded_hosts' });

        assert.strictEqual(resolvedDefault.name, DEFAULT_MANIFEST_PROFILE);
        assert.deepStrictEqual(resolvedDefault.config, MANIFEST_PROFILE_PRESETS.bounded_hosts);
        assert.strictEqual(resolvedBounded.name, 'bounded_hosts');
        assert.deepStrictEqual(resolvedBounded.config, MANIFEST_PROFILE_PRESETS.bounded_hosts);
        assert.ok(!manifest.host_permissions.includes('https://*/*'));
        assert.ok(!manifest.host_permissions.includes('http://*/*'));
        assert.ok(!boundedManifest.host_permissions.includes('https://*/*'));
        assert.ok(!boundedManifest.host_permissions.includes('http://*/*'));
    });

    await runTest('scripts/build-extension.js: validates critical bridge assumptions before writing extension output', async () => {
        const iifeBody = extractUserscriptIifeBody(userScriptContent);
        const patched = patchBookmarkBridgeForExtension(iifeBody);
        const backgroundScript = buildBackgroundScript();
        const popupHtml = buildPopupHtml();
        const popupScript = buildPopupScript();
        const manifest = buildManifest({ version: '3.4.3' });
        const contentScript = `
            ${GENERATED_SECTION_MARKERS.gmShimStart}
            ${GENERATED_SECTION_MARKERS.bookmarkEventBridgeStart}
            window.addEventListener("ld-notion-request-bookmarks", () => {});
            window.addEventListener("ld-notion-search-bookmarks", () => {});
            ${GENERATED_SECTION_MARKERS.bookmarkEventBridgeEnd}
            ${GENERATED_SECTION_MARKERS.popupMessageBridgeStart}
            chrome.runtime.onMessage.addListener(() => {});
            ${GENERATED_SECTION_MARKERS.popupMessageBridgeEnd}
            await _gmInitStorage();
            ${GENERATED_SECTION_MARKERS.gmShimEnd}
        `;

        assert.doesNotThrow(() => {
            validatePatchedBuildAssumptions({
                source: userScriptContent,
                patchedBody: patched.code,
                contentScript,
                backgroundScript,
                popupHtml,
                popupScript,
                manifest
            });
        });

        assert.throws(() => {
            validatePatchedBuildAssumptions({
                source: userScriptContent.replace('const BookmarkBridge = {', 'const BookmarkBridgeMissing = {'),
                patchedBody: patched.code
            });
        }, /BookmarkBridge 对象定义/);

        assert.throws(() => {
            validatePatchedBuildAssumptions({
                source: userScriptContent.replace(BUILD_ANCHORS.userscriptBodyStart, '// body anchor removed'),
                patchedBody: patched.code
            });
        }, /userscript 主体开始锚点/);

        assert.throws(() => {
            validatePatchedBuildAssumptions({
                source: userScriptContent.replace(BUILD_ANCHORS.bookmarkBridgeStart, '// anchor removed'),
                patchedBody: patched.code
            });
        }, /BookmarkBridge 构建开始锚点/);

        assert.throws(() => {
            assertContains('', 'needle', '测试片段');
        }, /测试片段/);
    });

    await runTest('scripts/build-extension.js: buildExtension accepts manifest profile override without changing shared manifest seams', async () => {
        const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-notion-build-profile-'));

        try {
            const result = buildExtension({
                source: userScriptContent,
                outDir: tempOutDir,
                manifestProfile: 'bounded_hosts'
            });
            const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));

            assert.strictEqual(result.manifestProfile, 'bounded_hosts');
            assert.ok(!manifest.host_permissions.includes('https://*/*'));
            assert.ok(!manifest.host_permissions.includes('http://*/*'));
            assert.strictEqual(manifest.background?.service_worker, 'background.js');
            assert.strictEqual(manifest.action?.default_popup, 'popup.html');
        } finally {
            fs.rmSync(tempOutDir, { recursive: true, force: true });
        }
    });

    await runTest('scripts/build-extension.js: builds extension artifacts from the current userscript shape', async () => {
        const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-notion-build-'));

        try {
            const stdout = execFileSync(process.execPath, [buildScriptPath], {
                cwd: path.resolve(__dirname, '..'),
                encoding: 'utf8',
                env: {
                    ...process.env,
                    LD_NOTION_BUILD_OUT_DIR: tempOutDir
                }
            });

            assert.ok(stdout.includes('Chrome 扩展构建完成'), stdout);

            const manifestPath = path.join(tempOutDir, 'manifest.json');
            const contentPath = path.join(tempOutDir, 'content.js');
            const backgroundPath = path.join(tempOutDir, 'background.js');
            const popupHtmlPath = path.join(tempOutDir, 'popup.html');
            const popupJsPath = path.join(tempOutDir, 'popup.js');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const contentScript = fs.readFileSync(contentPath, 'utf8');
            const backgroundScript = fs.readFileSync(backgroundPath, 'utf8');
            const popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');
            const popupScript = fs.readFileSync(popupJsPath, 'utf8');

            assert.strictEqual(manifest.manifest_version, 3);
            assert.strictEqual(manifest.background?.service_worker, 'background.js');
            assert.ok(
                Array.isArray(manifest.content_scripts) &&
                manifest.content_scripts.some((entry) => Array.isArray(entry.js) && entry.js.includes('content.js'))
            );
            assert.ok(fs.existsSync(backgroundPath));
            assert.ok(fs.existsSync(popupHtmlPath));
            assert.ok(fs.existsSync(popupJsPath));
            assert.ok(fs.existsSync(path.join(tempOutDir, 'icon48.png')));
            assert.ok(fs.existsSync(path.join(tempOutDir, 'icon128.png')));
            assert.ok(contentScript.includes(GENERATED_SECTION_MARKERS.gmShimStart));
            assert.ok(contentScript.includes(GENERATED_SECTION_MARKERS.gmShimEnd));
            assert.ok(contentScript.includes(GENERATED_SECTION_MARKERS.bookmarkEventBridgeStart));
            assert.ok(contentScript.includes(GENERATED_SECTION_MARKERS.bookmarkEventBridgeEnd));
            assert.ok(contentScript.includes(GENERATED_SECTION_MARKERS.popupMessageBridgeStart));
            assert.ok(contentScript.includes(GENERATED_SECTION_MARKERS.popupMessageBridgeEnd));
            assert.ok(contentScript.includes('LD-Notion Chrome Extension — Content Script'));
            assert.ok(contentScript.includes('await _gmInitStorage();'));
            assert.ok(contentScript.includes('chrome.bookmarks.getTree()'));
            assert.ok(contentScript.includes('return !!(typeof chrome !== "undefined" && chrome.bookmarks);'));
            assert.ok(!contentScript.includes('// ==UserScript=='));
            assert.ok(backgroundScript.includes('message.type !== "GM_xmlhttpRequest"'));
            assert.ok(backgroundScript.includes('return true;'));
            assert.ok(popupHtml.includes('id="import-bookmarks"'));
            assert.ok(popupHtml.includes('<script src="popup.js"></script>'));
            assert.ok(popupScript.includes('LD_NOTION_IMPORT_BOOKMARKS'));
            assert.ok(popupScript.includes('LD_NOTION_IMPORT_GITHUB'));
            assert.ok(popupScript.includes('LD_NOTION_SET_BOOKMARK_SOURCE'));
        } finally {
            fs.rmSync(tempOutDir, { recursive: true, force: true });
        }
    });

    await runTest('main: awaits OAuth callback bootstrap before showing the callback notice', async () => {
        const harness = createHarness();
        const events = [];

        harness.DesignSystem.initTheme = () => {
            events.push('theme');
        };
        harness.SiteDetector.detect = () => harness.SiteDetector.SITES.GENERIC;
        harness.NotionOAuth.handleRedirectCallback = async () => {
            events.push('callback:start');
            await harness.flush();
            events.push('callback:end');
            return true;
        };
        harness.NotionOAuth.syncApiKeyInputs = () => {
            events.push('sync-inputs');
        };
        harness.NotionOAuth.consumeNotice = () => ({ message: 'OAuth ready', type: 'success' });
        harness.GenericUI.init = () => {
            events.push('generic:init');
        };
        harness.GenericUI.showStatus = (message, type) => {
            events.push(`notice:${type}:${message}`);
        };

        harness.main();
        await harness.flush();
        await harness.flush();

        assert.deepStrictEqual(events, [
            'theme',
            'callback:start',
            'callback:end',
            'sync-inputs',
            'generic:init',
            'notice:success:OAuth ready'
        ]);
    });

    console.log('\nAll NotionOAuth tests passed successfully!');
})();
