const fs = require('fs');
const path = require('path');
const assert = require('assert');

const userScriptPath = path.resolve(__dirname, '../LinuxDo-Bookmarks-to-Notion.user.js');
const userScriptContent = fs.readFileSync(userScriptPath, 'utf8');
const iifeStart = userScriptContent.indexOf('(function () {');
const iifeEnd = userScriptContent.lastIndexOf('})();');
const wrappedCoreCode = userScriptContent.substring(iifeStart + '(function () {'.length, iifeEnd);
const coreCode = wrappedCoreCode.replace(/\n\s*main\(\);\s*$/, '\n');

function createElementStub() {
    return {
        value: '',
        placeholder: '',
        textContent: '',
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
            matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
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
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    };

    sandbox.global = sandbox;
    sandbox.self = sandbox;

    const scriptRunner = new Function(
        ...Object.keys(sandbox),
        `${coreCode}\nreturn { CONFIG, DesignSystem, GenericUI, NotionAPI, NotionOAuth, SiteDetector, UI, main };`
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

(async () => {
    console.log('Running tests for NotionOAuth...\n');

    await runTest('buildAuthorizeUrl: includes expected Notion OAuth query params', async () => {
        const harness = createHarness();
        harness.NotionOAuth.saveConfig({
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
        harness.NotionOAuth.saveConfig({
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
        harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN] = 'refresh_old';

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
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_API_KEY], 'access_new');
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN], 'refresh_new');
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_AUTH_MODE], 'oauth');
        assert.strictEqual(meta.workspaceName, 'Release Workspace');
    });

    await runTest('handleRedirectCallback: completes authorization, stores notice, and cleans callback params', async () => {
        const harness = createHarness({
            url: 'https://www.notion.so/?code=oauth_code&state=expected_state'
        });
        harness.NotionOAuth.saveConfig({
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

        harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_API_KEY] = 'expired_access';
        harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_OAUTH_REFRESH_TOKEN] = 'refresh_old';
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
        assert.strictEqual(harness.store[harness.CONFIG.STORAGE_KEYS.NOTION_API_KEY], 'fresh_access');
    });

    await runTest('manual fallback: saved manual API key still works when OAuth config exists', async () => {
        const harness = createHarness();
        let authorizationHeader = '';

        harness.NotionOAuth.saveConfig({
            clientId: 'client_123',
            clientSecret: 'secret_456',
            redirectUri: 'https://www.notion.so/'
        });
        harness.NotionOAuth.setManualApiKey('manual_api_key');
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
