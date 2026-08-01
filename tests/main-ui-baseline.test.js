import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * T1: UI/bundle 行为基线
 * 验证 main-ui 纯逻辑用例 + legacy-harness FACTORY_NAMES 不受影响
 */

// Mock DOM environment
const mockElement = () => {
    const el = {
        className: "",
        innerHTML: "",
        style: {},
        title: "",
        textContent: "",
        value: "",
        checked: false,
        disabled: false,
        display: "",
        children: [],
        attributes: {},
        onclick: null,
        onchange: null,
        onmousedown: null,
        classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            toggle(c, force) {
                if (force === undefined) {
                    if (this._classes.has(c)) { this._classes.delete(c); return false; }
                    this._classes.add(c); return true;
                }
                if (force) { this._classes.add(c); } else { this._classes.delete(c); }
                return force;
            },
            contains(c) { return this._classes.has(c); },
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] || null; },
        querySelector(sel) { return mockElement(); },
        querySelectorAll(sel) { return []; },
        appendChild(child) { this.children.push(child); return child; },
        remove() {},
        addEventListener() {},
        removeEventListener() {},
    };
    return el;
};

describe("T1: main-ui baseline - event-bus module", () => {
    let eventBus;

    beforeEach(() => {
        vi.resetModules();
        eventBus = require("../src/coordination/event-bus");
    });

    afterEach(() => {
        // Clean all subscriptions
        eventBus.off();
    });

    describe("event-bus on/off/emit", () => {
        it("on + emit: handler receives args", () => {
            const handler = vi.fn();
            eventBus.on("test:event", handler);
            eventBus.emit("test:event", "arg1", 42);
            expect(handler).toHaveBeenCalledWith("arg1", 42);
        });

        it("emit without subscribers: silent no-op", () => {
            expect(() => eventBus.emit("no:subscribers", "data")).not.toThrow();
        });

        it("multiple subscribers all called", () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            eventBus.on("multi", h1);
            eventBus.on("multi", h2);
            eventBus.emit("multi", "x");
            expect(h1).toHaveBeenCalledWith("x");
            expect(h2).toHaveBeenCalledWith("x");
        });

        it("duplicate handler not added twice", () => {
            const h = vi.fn();
            eventBus.on("dup", h);
            eventBus.on("dup", h);
            eventBus.emit("dup");
            expect(h).toHaveBeenCalledTimes(1);
        });

        it("off(event, handler) removes specific handler", () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            eventBus.on("ev", h1);
            eventBus.on("ev", h2);
            eventBus.off("ev", h1);
            eventBus.emit("ev", "data");
            expect(h1).not.toHaveBeenCalled();
            expect(h2).toHaveBeenCalledWith("data");
        });

        it("off(event) removes all handlers for event", () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            eventBus.on("ev2", h1);
            eventBus.on("ev2", h2);
            eventBus.off("ev2");
            eventBus.emit("ev2");
            expect(h1).not.toHaveBeenCalled();
            expect(h2).not.toHaveBeenCalled();
        });

        it("off() clears all subscriptions", () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            eventBus.on("a", h1);
            eventBus.on("b", h2);
            eventBus.off();
            eventBus.emit("a");
            eventBus.emit("b");
            expect(h1).not.toHaveBeenCalled();
            expect(h2).not.toHaveBeenCalled();
        });

        it("handler error does not break other handlers", () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const h1 = vi.fn(() => { throw new Error("boom"); });
            const h2 = vi.fn();
            eventBus.on("err", h1);
            eventBus.on("err", h2);
            eventBus.emit("err");
            expect(h1).toHaveBeenCalled();
            expect(h2).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it("zero external dependencies (no require calls)", () => {
            const fs = require("fs");
            const path = require("path");
            const source = fs.readFileSync(
                path.resolve(__dirname, "../src/coordination/event-bus.js"), "utf8"
            );
            // Should not contain require( calls (except module.exports)
            const requireCalls = source.match(/require\s*\(/g);
            expect(requireCalls).toBeNull();
        });
    });
});

describe("T1: legacy-harness FACTORY_NAMES validation", () => {
    it("FACTORY_NAMES includes require_main_ui and require_events", () => {
        const { loadBundle } = require("./legacy-harness");
        // FACTORY_NAMES is embedded in legacy-harness; validate key entries
        const harnessSource = require("fs").readFileSync(
            require("path").resolve(__dirname, "legacy-harness.js"), "utf8"
        );
        expect(harnessSource).toContain("require_main_ui");
        expect(harnessSource).toContain("require_events");
        expect(harnessSource).toContain("require_security");
        expect(harnessSource).toContain("require_import");
        expect(harnessSource).toContain("require_bridge");
    });
});
