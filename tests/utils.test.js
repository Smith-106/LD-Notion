const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Extract the IIFE body from the userscript
const userScriptPath = path.resolve(__dirname, '../LinuxDo-Bookmarks-to-Notion.user.js');
let userScriptContent = fs.readFileSync(userScriptPath, 'utf8');

// Remove userscript header and IIFE wrapper
const iifeStart = userScriptContent.indexOf('(function () {');
const iifeEnd = userScriptContent.lastIndexOf('})();');
let coreCode = userScriptContent.substring(iifeStart + '(function () {'.length, iifeEnd);

// Mock browser globals
const sandbox = {
    window: {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        location: { hostname: 'localhost', pathname: '/', protocol: 'http:', origin: 'http://localhost' },
        navigator: { userAgent: 'Node.js' },
        setTimeout: global.setTimeout,
        clearTimeout: global.clearTimeout,
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })
    },
    document: {
        readyState: 'complete',
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        createElement: () => ({
            appendChild: () => {},
            style: {},
            setAttribute: () => {},
            getAttribute: () => '',
            querySelector: () => ({ addEventListener: () => {} }),
            querySelectorAll: () => [],
            addEventListener: () => {},
            classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
            offsetHeight: 0,
            getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 })
        }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        body: { appendChild: () => {} },
        head: { appendChild: () => {} },
        location: { hostname: 'localhost' }
    },
    Node: {
        ELEMENT_NODE: 1,
        TEXT_NODE: 3
    },
    navigator: { userAgent: 'Node.js' },
    location: { hostname: 'localhost' },
    HTMLElement: class {},
    DOMParser: class {
        parseFromString() { return { body: { children: [] } }; }
    },
    FileReader: class {
        readAsArrayBuffer() {}
    },
    GM_getValue: () => {},
    GM_setValue: () => {},
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
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
};

// Add self-referencing for common globals
sandbox.global = sandbox;
sandbox.self = sandbox;

// Create a function to run the script and return the Utils object
// We add a return statement to get the Utils object
const scriptRunner = new Function(...Object.keys(sandbox), coreCode + '\nreturn Utils;');
const Utils = scriptRunner(...Object.values(sandbox));

if (!Utils) {
    console.error('❌ Utils not found after script execution');
    process.exit(1);
}

function runTest(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (e) {
        console.error(`❌ ${name}`);
        console.error(e.stack || e);
        process.exit(1);
    }
}

console.log('Running tests for Utils.getPageTitle...\n');

runTest('getPageTitle: returns fallback when page is null', () => {
    assert.strictEqual(Utils.getPageTitle(null, 'Fallback'), 'Fallback');
});

runTest('getPageTitle: returns default fallback when page is undefined', () => {
    assert.strictEqual(Utils.getPageTitle(undefined), '无标题');
});

runTest('getPageTitle: returns fallback when properties are missing', () => {
    assert.strictEqual(Utils.getPageTitle({}, 'Fallback'), 'Fallback');
});

runTest('getPageTitle: returns title from "title" property', () => {
    const page = {
        properties: {
            title: {
                title: [{ plain_text: 'Test Title' }]
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page), 'Test Title');
});

runTest('getPageTitle: returns title from "标题" property', () => {
    const page = {
        properties: {
            标题: {
                title: [{ plain_text: '测试标题' }]
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page), '测试标题');
});

runTest('getPageTitle: returns title from "Name" property', () => {
    const page = {
        properties: {
            Name: {
                title: [{ plain_text: 'Name Title' }]
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page), 'Name Title');
});

runTest('getPageTitle: returns title from "名称" property', () => {
    const page = {
        properties: {
            名称: {
                title: [{ plain_text: '名称标题' }]
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page), '名称标题');
});

runTest('getPageTitle: returns title from any property of type "title"', () => {
    const page = {
        properties: {
            CustomProp: {
                type: 'title',
                title: [{ plain_text: 'Custom Title' }]
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page), 'Custom Title');
});

runTest('getPageTitle: respects priority of common names', () => {
    const page = {
        properties: {
            Name: {
                title: [{ plain_text: 'Name Title' }]
            },
            title: {
                title: [{ plain_text: 'Priority Title' }]
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page), 'Priority Title');
});

runTest('getPageTitle: returns fallback when no title property found', () => {
    const page = {
        properties: {
            Description: {
                rich_text: [{ plain_text: 'Not a title' }]
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page, 'Missing'), 'Missing');
});

runTest('getPageTitle: returns fallback when title array is empty', () => {
    const page = {
        properties: {
            title: {
                title: []
            }
        }
    };
    assert.strictEqual(Utils.getPageTitle(page, 'Empty'), 'Empty');
});

console.log('\nAll tests passed successfully!');
