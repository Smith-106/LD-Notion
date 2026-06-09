const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { webcrypto } = require('crypto');
const { extractUserscriptIifeBody } = require('../scripts/build-extension.js');

// Load userscript
const userScriptPath = path.resolve(__dirname, '../LinuxDo-Bookmarks-to-Notion.user.js');
let userScriptContent = fs.readFileSync(userScriptPath, 'utf8');
let coreCode = extractUserscriptIifeBody(userScriptContent);

// Shared mock storage
const mockStore = {};
const storageMock = {
    get: (key, defaultValue) => mockStore[key] !== undefined ? mockStore[key] : defaultValue,
    set: (key, value) => { mockStore[key] = value; },
    remove: (key) => { delete mockStore[key]; },
};

// Sandbox
const sandbox = {
    window: {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        location: { hostname: 'localhost', pathname: '/', protocol: 'http:', origin: 'http://localhost' },
        navigator: { userAgent: 'Node.js' },
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        requestIdleCallback: (cb) => cb(),
        crypto: webcrypto,
    },
    document: {
        readyState: 'complete',
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        createElement: () => ({
            appendChild: () => {}, style: {}, setAttribute: () => {}, getAttribute: () => '',
            querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [],
            addEventListener: () => {},
            classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
            offsetHeight: 0,
            getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
            remove: () => {},
        }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        body: { appendChild: () => {} },
        head: { appendChild: () => {} },
        location: { hostname: 'localhost' },
    },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { userAgent: 'Node.js' },
    location: { hostname: 'localhost' },
    HTMLElement: class {},
    DOMParser: class { parseFromString() { return { body: { children: [] } }; } },
    FileReader: class { readAsArrayBuffer() {} },
    GM_getValue: storageMock.get,
    GM_setValue: storageMock.set,
    GM_deleteValue: storageMock.remove,
    GM_xmlhttpRequest: () => {},
    GM_notification: () => {},
    GM_info: { scriptHandler: 'Node.js' },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    Promise: Promise,
    Error: Error,
    Uint8Array: Uint8Array,
    TextDecoder: TextDecoder,
    TextEncoder: TextEncoder,
    URL: URL,
    crypto: webcrypto,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
};
sandbox.global = sandbox;
sandbox.self = sandbox;

// Execute and extract modules
const scriptRunner = new Function(
    ...Object.keys(sandbox),
    coreCode + '\nreturn { CONFIG, OperationLog, TargetState, OperationGuard, Utils, MSG };'
);
const { CONFIG, OperationLog, TargetState, OperationGuard, Utils, MSG } = scriptRunner(...Object.values(sandbox));

if (!CONFIG || !OperationLog || !TargetState || !OperationGuard) {
    console.error('❌ Failed to load modules');
    process.exit(1);
}

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('✅ ' + name); }
    catch (e) { failed++; console.log('❌ ' + name + ': ' + e.message); }
}
function resetStore() { for (const k of Object.keys(mockStore)) delete mockStore[k]; }

// ============================================================
// CONFIG
// ============================================================
test('CONFIG.STORAGE_KEYS has all required keys', () => {
    const required = ['NOTION_API_KEY', 'NOTION_DATABASE_ID', 'AI_SERVICE', 'AI_API_KEY', 'AI_MODEL',
        'EXPORT_TARGET_TYPE', 'PARENT_PAGE_ID', 'PERMISSION_LEVEL', 'IMG_MODE'];
    for (const key of required) {
        assert.ok(CONFIG.STORAGE_KEYS[key], 'Missing STORAGE_KEYS.' + key);
    }
});

test('CONFIG.DEFAULTS has sensible values', () => {
    assert.strictEqual(CONFIG.DEFAULTS.permissionLevel, 1);
    assert.strictEqual(CONFIG.DEFAULTS.requireConfirm, true);
    assert.strictEqual(CONFIG.DEFAULTS.imgMode, 'external');
    assert.strictEqual(CONFIG.DEFAULTS.exportTargetType, 'database');
    assert.strictEqual(CONFIG.DEFAULTS.aiService, 'openai');
});

test('CONFIG.EXPORT_TARGET_TYPES has database and page', () => {
    assert.strictEqual(CONFIG.EXPORT_TARGET_TYPES.DATABASE, 'database');
    assert.strictEqual(CONFIG.EXPORT_TARGET_TYPES.PAGE, 'page');
});

test('CONFIG.PERMISSION_LEVELS are ordered', () => {
    assert.strictEqual(CONFIG.PERMISSION_LEVELS.READONLY, 0);
    assert.strictEqual(CONFIG.PERMISSION_LEVELS.STANDARD, 1);
    assert.strictEqual(CONFIG.PERMISSION_LEVELS.ADVANCED, 2);
    assert.strictEqual(CONFIG.PERMISSION_LEVELS.ADMIN, 3);
});

// ============================================================
// MSG
// ============================================================
test('MSG constants are non-empty strings', () => {
    assert.ok(MSG.NO_NOTION_KEY.length > 0);
    assert.ok(MSG.NO_AI_KEY.length > 0);
    assert.ok(MSG.SETUP_NOTION_KEY.length > 0);
});

// ============================================================
// TargetState — normalizeNotionId
// ============================================================
test('TargetState.normalizeNotionId: extracts 32-char id', () => {
    const id = TargetState.normalizeNotionId('abc123def456abc123def456abc123de');
    assert.strictEqual(id, 'abc123def456abc123def456abc123de');
});

test('TargetState.normalizeNotionId: removes dashes', () => {
    const id = TargetState.normalizeNotionId('abc123de-f456-abc1-23de-f456abc123de');
    assert.strictEqual(id, 'abc123def456abc123def456abc123de');
});

test('TargetState.normalizeNotionId: returns empty for empty input', () => {
    assert.strictEqual(TargetState.normalizeNotionId(''), '');
    assert.strictEqual(TargetState.normalizeNotionId(null), '');
});

// ============================================================
// TargetState — normalizeAITarget
// ============================================================
test('TargetState.normalizeAITarget: handles __all__', () => {
    assert.strictEqual(TargetState.normalizeAITarget('__all__'), '__all__');
});

test('TargetState.normalizeAITarget: handles page: prefix', () => {
    const result = TargetState.normalizeAITarget('page:abc123def456abc123def456abc123de');
    assert.strictEqual(result, 'page:abc123def456abc123def456abc123de');
});

test('TargetState.normalizeAITarget: returns empty for empty', () => {
    assert.strictEqual(TargetState.normalizeAITarget(''), '');
});

test('TargetState.normalizeAITarget: normalizes database id', () => {
    const result = TargetState.normalizeAITarget('abc123de-f456-abc1-23de-f456abc123de');
    assert.strictEqual(result, 'abc123def456abc123def456abc123de');
});

// ============================================================
// TargetState — parseAITarget
// ============================================================
test('TargetState.parseAITarget: database mode', () => {
    const result = TargetState.parseAITarget('abc123def456abc123def456abc123de');
    assert.strictEqual(result.mode, 'database');
    assert.strictEqual(result.databaseId, 'abc123def456abc123def456abc123de');
    assert.strictEqual(result.pageId, '');
});

test('TargetState.parseAITarget: page mode', () => {
    const result = TargetState.parseAITarget('page:abc123def456abc123def456abc123de');
    assert.strictEqual(result.mode, 'page');
    assert.strictEqual(result.pageId, 'abc123def456abc123def456abc123de');
    assert.strictEqual(result.databaseId, '');
});

test('TargetState.parseAITarget: all mode', () => {
    const result = TargetState.parseAITarget('__all__');
    assert.strictEqual(result.mode, 'all');
});

test('TargetState.parseAITarget: default mode for empty', () => {
    const result = TargetState.parseAITarget('');
    assert.strictEqual(result.mode, 'default');
    assert.strictEqual(result.value, '');
});

// ============================================================
// TargetState — storage round-trips
// ============================================================
test('TargetState.getStoredAITarget: returns exists=false when not set', () => {
    resetStore();
    const result = TargetState.getStoredAITarget();
    assert.strictEqual(result.exists, false);
});

test('TargetState.getStoredAITarget: returns exists=true when set', () => {
    resetStore();
    storageMock.set(CONFIG.STORAGE_KEYS.AI_TARGET_DB, 'abc123def456abc123def456abc123de');
    const result = TargetState.getStoredAITarget();
    assert.strictEqual(result.exists, true);
    assert.strictEqual(result.state.mode, 'database');
});

test('TargetState.setAITarget + getStoredAITarget round-trip', () => {
    resetStore();
    const state = TargetState.setAITarget('__all__');
    assert.strictEqual(state.mode, 'all');
    const stored = TargetState.getStoredAITarget();
    assert.strictEqual(stored.state.mode, 'all');
});

// ============================================================
// TargetState — export state
// ============================================================
test('TargetState.setExportTargetType defaults to database', () => {
    resetStore();
    const result = TargetState.setExportTargetType('invalid');
    assert.strictEqual(result, 'database');
});

test('TargetState.setExportTargetType accepts page', () => {
    resetStore();
    const result = TargetState.setExportTargetType('page');
    assert.strictEqual(result, 'page');
});

test('TargetState.getExportState returns database target by default', () => {
    resetStore();
    const state = TargetState.getExportState();
    assert.strictEqual(state.targetType, 'database');
    assert.strictEqual(state.targetId, '');
});

test('TargetState.getExportState returns page target when configured', () => {
    resetStore();
    TargetState.setExportTargetType('page');
    TargetState.setExportPageId('abc123def456abc123def456abc123de');
    const state = TargetState.getExportState();
    assert.strictEqual(state.targetType, 'page');
    assert.strictEqual(state.targetId, 'abc123def456abc123def456abc123de');
});

test('TargetState.saveExportState saves all fields', () => {
    resetStore();
    const state = TargetState.saveExportState({
        targetType: 'page',
        parentPageId: 'abc123def456abc123def456abc123de',
    });
    assert.strictEqual(state.targetType, 'page');
    assert.strictEqual(state.parentPageId, 'abc123def456abc123def456abc123de');
});

// ============================================================
// OperationGuard
// ============================================================
test('OperationGuard.OPERATION_LEVELS: read ops are level 0', () => {
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.search, 0);
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.fetchPage, 0);
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.queryDatabase, 0);
});

test('OperationGuard.OPERATION_LEVELS: write ops are level 1', () => {
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.createDatabasePage, 1);
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.updatePage, 1);
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.appendBlocks, 1);
});

test('OperationGuard.OPERATION_LEVELS: advanced ops are level 2', () => {
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.movePage, 2);
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.deletePage, 2);
    assert.strictEqual(OperationGuard.OPERATION_LEVELS.agentTask, 2);
});

test('OperationGuard.canExecute: allows level 0 at permission 0', () => {
    resetStore();
    storageMock.set(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, 0);
    assert.strictEqual(OperationGuard.canExecute('search'), true);
});

test('OperationGuard.canExecute: denies level 1 at permission 0', () => {
    resetStore();
    storageMock.set(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, 0);
    assert.strictEqual(OperationGuard.canExecute('createDatabasePage'), false);
});

test('OperationGuard.canExecute: allows level 1 at permission 1', () => {
    resetStore();
    storageMock.set(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, 1);
    assert.strictEqual(OperationGuard.canExecute('updatePage'), true);
    assert.strictEqual(OperationGuard.canExecute('deletePage'), false);
});

test('OperationGuard.canExecute: allows level 2 at permission 2', () => {
    resetStore();
    storageMock.set(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, 2);
    assert.strictEqual(OperationGuard.canExecute('deletePage'), true);
});

test('OperationGuard.canExecute: denies undefined operations', () => {
    resetStore();
    storageMock.set(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, 3);
    assert.strictEqual(OperationGuard.canExecute('nonexistentOp'), false);
});

test('OperationGuard.isDangerous: deletePage and deleteBlock', () => {
    assert.strictEqual(OperationGuard.isDangerous('deletePage'), true);
    assert.strictEqual(OperationGuard.isDangerous('deleteBlock'), true);
    assert.strictEqual(OperationGuard.isDangerous('updatePage'), false);
    assert.strictEqual(OperationGuard.isDangerous('search'), false);
});

test('OperationLog.collectRedactionHints: detects secret-like fields and target ids', () => {
    const hints = OperationLog.collectRedactionHints({
        apiKey: 'secret_xxx',
        notionToken: 'ntn_xxx',
        pageId: 'abc123def456abc123def456abc123de',
        description: 'safe text'
    });

    assert.ok(hints.includes('apiKey'));
    assert.ok(hints.includes('token'));
    assert.ok(hints.includes('target.id'));
});

test('OperationLog.normalizeAuditEntry: produces structured audit event fields', () => {
    const entry = OperationLog.normalizeAuditEntry({
        audit_event: 'guard.decision',
        actor: 'ai',
        source: 'ai-agent-loop',
        operationName: 'appendBlocks',
        operation: {
            name: 'appendBlocks',
            risk: 'standard',
            trigger: 'user_requested_write'
        },
        context: {
            itemName: '项目计划',
            pageId: 'abc123def456abc123def456abc123de',
            content: '新增 Docker 网络总结'
        },
        result: {
            status: 'success'
        },
        startTime: 1,
        endTime: 2
    });

    assert.strictEqual(entry.audit_event, 'guard.decision');
    assert.strictEqual(entry.actor, 'ai');
    assert.strictEqual(entry.source, 'ai-agent-loop');
    assert.strictEqual(entry.operation.name, 'appendBlocks');
    assert.strictEqual(entry.target.type, 'notion_page');
    assert.ok(entry.target.id.includes('…'));
    assert.strictEqual(entry.payload.contentPreview, '新增 Docker 网络总结');
    assert.ok(entry.redaction.includes('target.id'));
});

// ============================================================
// Utils (expanded)
// ============================================================
test('Utils.extractNotionId: extracts from Notion URL', () => {
    const id = Utils.extractNotionId('https://www.notion.so/workspace/Page-Title-abc123def456abc123def456abc123de');
    assert.strictEqual(id, 'abc123def456abc123def456abc123de');
});

test('Utils.extractNotionId: normalizes dashed id', () => {
    const id = Utils.extractNotionId('abc123de-f456-abc1-23de-f456abc123de');
    assert.strictEqual(id, 'abc123def456abc123def456abc123de');
});

test('Utils.extractNotionId: returns empty for no match', () => {
    assert.strictEqual(Utils.extractNotionId('no-id-here'), '');
});

test('Utils.extractNotionId: returns raw 32-char string unchanged', () => {
    assert.strictEqual(Utils.extractNotionId('abc123def456abc123def456abc123de'), 'abc123def456abc123def456abc123de');
});

test('Utils.extractQuotedText: extracts Chinese quoted content', () => {
    // CJK quotes not supported, uses typographic quotes
    assert.strictEqual(Utils.extractQuotedText('test “quoted” end'), 'quoted');
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(40));
console.log('Logic module tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
console.log('All logic module tests passed successfully!');
