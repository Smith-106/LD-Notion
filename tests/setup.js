import { vi, beforeEach } from "vitest";

// GM_* API mocks (Tampermonkey/Greasemonkey runtime globals)
const gmStore = new Map();

globalThis.GM_getValue = (key, defaultValue) => {
    if (gmStore.has(key)) return gmStore.get(key);
    return defaultValue;
};

globalThis.GM_setValue = (key, value) => {
    gmStore.set(key, value);
};

globalThis.GM_deleteValue = (key) => {
    gmStore.delete(key);
};

globalThis.GM_xmlhttpRequest = vi.fn();
globalThis.GM_notification = vi.fn();

// Browser global stubs
globalThis.document = {
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    body: { appendChild: vi.fn(), removeChild: vi.fn(), innerHTML: "" },
    head: { appendChild: vi.fn(), removeChild: vi.fn() },
    createElement: vi.fn(() => ({
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => null),
        appendChild: vi.fn(),
        style: {},
        classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
    })),
    getElementById: vi.fn(),
    createTextNode: vi.fn(() => ({})),
    createDocumentFragment: vi.fn(() => ({ appendChild: vi.fn() })),
};

globalThis.window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { hostname: "localhost", origin: "http://localhost", href: "http://localhost", pathname: "/" },
    dispatchEvent: vi.fn(),
};

Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, writable: true, configurable: true });
Object.defineProperty(globalThis, "location", { value: globalThis.window.location, writable: true, configurable: true });
globalThis.MutationObserver = vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn() }));
globalThis.requestIdleCallback = vi.fn((cb) => cb({ didTimeout: false, timeRemaining: () => 50 }));
globalThis.cancelIdleCallback = vi.fn();

// Reset GM store between tests
beforeEach(() => {
    gmStore.clear();
});
