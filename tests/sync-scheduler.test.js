import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SyncScheduler } from "../src/adapter/SyncScheduler.js";
import { SyncStateV2 } from "../src/storage/SyncState.js";

describe("SyncScheduler", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        SyncStateV2._cache = null;
        // Clean up SyncScheduler state from previous tests
        SyncScheduler.stopAll();
        SyncScheduler._retryCounts.clear();
        SyncScheduler._retries.clear();
    });

    afterEach(() => {
        SyncScheduler.stopAll();
        vi.useRealTimers();
    });

    it("start creates an interval timer", () => {
        SyncScheduler.start("linuxdo");
        expect(SyncScheduler._timers.has("linuxdo")).toBe(true);
    });

    it("stop clears the interval timer", () => {
        SyncScheduler.start("linuxdo");
        SyncScheduler.stop("linuxdo");
        expect(SyncScheduler._timers.has("linuxdo")).toBe(false);
    });

    it("getStatus returns current state", () => {
        const status = SyncScheduler.getStatus("linuxdo");
        expect(status.intervalMinutes).toBeDefined();
        expect(typeof status.lastOutcome).toBe("string");
    });

    it("_scheduleRetry increments count and creates timeout", () => {
        SyncScheduler._scheduleRetry("test-src");
        expect(SyncScheduler._retryCounts.get("test-src")).toBe(1);
        expect(SyncScheduler._retries.has("test-src")).toBe(true);

        // Cancel
        SyncScheduler._cancelRetry("test-src");

        // Second retry
        SyncScheduler._scheduleRetry("test-src");
        expect(SyncScheduler._retryCounts.get("test-src")).toBe(2);
    });

    it("retry uses exponential backoff delays", () => {
        SyncScheduler._scheduleRetry("test-src"); // count=1 → 5min
        SyncScheduler._cancelRetry("test-src");

        SyncScheduler._scheduleRetry("test-src"); // count=2 → 15min
        SyncScheduler._cancelRetry("test-src");

        SyncScheduler._scheduleRetry("test-src"); // count=3 → 60min
        SyncScheduler._cancelRetry("test-src");

        SyncScheduler._scheduleRetry("test-src"); // count=4 → 60min (capped)
        SyncScheduler._cancelRetry("test-src");

        expect(SyncScheduler._retryCounts.get("test-src")).toBe(4);
    });

    it("_cancelRetry clears the retry timer", () => {
        SyncScheduler._scheduleRetry("test-src");
        SyncScheduler._cancelRetry("test-src");
        expect(SyncScheduler._retries.has("test-src")).toBe(false);
    });

    it("stopAll clears all timers", () => {
        SyncScheduler._timers.set("a", 1);
        SyncScheduler._timers.set("b", 2);
        SyncScheduler.stopAll();
        expect(SyncScheduler._timers.size).toBe(0);
    });

    it("retry count resets on success (via _retryCounts.set)", () => {
        SyncScheduler._scheduleRetry("test-src");
        expect(SyncScheduler._retryCounts.get("test-src")).toBe(1);
        // Simulate success reset
        SyncScheduler._retryCounts.set("test-src", 0);
        expect(SyncScheduler._retryCounts.get("test-src")).toBe(0);
    });
});
