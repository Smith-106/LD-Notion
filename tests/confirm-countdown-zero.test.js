import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * ConfirmationDialog countdown:0 must enable OK immediately.
 * Previously setInterval deferred the first tick by 1s, so countdown:0
 * still left the button disabled for ~1 second.
 */
describe("ConfirmationDialog countdown:0", () => {
    let ConfirmationDialog;
    let okBtn;

    beforeEach(() => {
        vi.useFakeTimers();
        okBtn = { disabled: true, onclick: null, focus() {}, textContent: "" };
        const body = {
            children: [],
            appendChild(n) {
                this.children.push(n);
                return n;
            },
        };
        global.document = {
            body,
            createElement(tag) {
                const el = {
                    tagName: tag.toUpperCase(),
                    className: "",
                    style: {},
                    attrs: {},
                    children: [],
                    setAttribute(k, v) {
                        this.attrs[k] = v;
                    },
                    appendChild(n) {
                        this.children.push(n);
                        return n;
                    },
                    remove() {
                        body.children = body.children.filter((x) => x !== el);
                    },
                    querySelector(sel) {
                        if (sel === "#ldb-confirm-ok") return okBtn;
                        if (sel === "#ldb-confirm-cancel") return { onclick: null, focus() {} };
                        if (sel === "#ldb-confirm-countdown") {
                            return { textContent: "0", parentElement: { textContent: "" } };
                        }
                        if (sel === "#ldb-confirm-countdown-fill") return { style: {} };
                        if (sel === "#ldb-confirm-name-input") return null;
                        if (sel === ".ldb-confirm-item-name") return { textContent: "" };
                        if (sel === ".ldb-confirm-hint-name") return { textContent: "" };
                        return null;
                    },
                    addEventListener() {},
                    removeEventListener() {},
                };
                Object.defineProperty(el, "innerHTML", {
                    set() {},
                    get() {
                        return "";
                    },
                });
                return el;
            },
            addEventListener() {},
            removeEventListener() {},
        };
        global.requestAnimationFrame = (cb) => cb();

        // fresh module each test
        delete require.cache[require.resolve("../src/security")];
        ({ ConfirmationDialog } = require("../src/security"));
        ConfirmationDialog.dialogElement = null;
        ConfirmationDialog._queue = [];
        ConfirmationDialog._activeResolve = null;
    });

    afterEach(() => {
        if (ConfirmationDialog?.dialogElement) ConfirmationDialog.close();
        vi.useRealTimers();
    });

    it("enables OK immediately when countdown is 0 (no 1s wait)", async () => {
        const p = ConfirmationDialog.show({
            title: "t",
            message: "m",
            countdown: 0,
            confirmText: "确认",
        });
        expect(ConfirmationDialog.dialogElement).toBeTruthy();
        // Must be enabled before any timer tick
        expect(okBtn.disabled).toBe(false);
        expect(dialogTimerUnset()).toBe(true);

        okBtn.onclick();
        await expect(p).resolves.toBe(true);
    });

    it("still counts down when countdown > 0", async () => {
        ConfirmationDialog.show({ title: "t", message: "m", countdown: 2 });
        expect(okBtn.disabled).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(okBtn.disabled).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(okBtn.disabled).toBe(false);
        ConfirmationDialog.close();
    });

    function dialogTimerUnset() {
        const d = ConfirmationDialog.dialogElement;
        return !d || !d._countdownTimer;
    }
});
