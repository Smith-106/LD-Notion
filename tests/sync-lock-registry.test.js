import { describe, it, expect, beforeEach } from "vitest";
import { SyncLock } from "../src/sync-lock.js";
import { AdapterRegistry } from "../src/adapter/AdapterRegistry.js";

/**
 * Helper: 创建符合契约的适配器桩
 */
function stubAdapter(sourceType) {
  return {
    sourceType,
    fetchIncremental: () => {},
    fetchAll: () => {},
    normalize: () => {},
    getDedupKey: () => {},
  };
}

describe("AT-012: SyncLock", () => {
  beforeEach(() => {
    SyncLock.isExporting = false;
  });

  it("default isExporting → false", () => {
    expect(SyncLock.isExporting).toBe(false);
  });

  it("set isExporting = true → getter returns true", () => {
    SyncLock.isExporting = true;
    expect(SyncLock.isExporting).toBe(true);
  });

  it("set isExporting = false → getter returns false", () => {
    SyncLock.isExporting = true;
    SyncLock.isExporting = false;
    expect(SyncLock.isExporting).toBe(false);
  });

  it("set isExporting = 0 → Boolean(0) → false", () => {
    SyncLock.isExporting = 0;
    expect(SyncLock.isExporting).toBe(false);
  });

  it("set isExporting = 1 → Boolean(1) → true", () => {
    SyncLock.isExporting = 1;
    expect(SyncLock.isExporting).toBe(true);
  });

  it('set isExporting = "yes" → Boolean("yes") → true', () => {
    SyncLock.isExporting = "yes";
    expect(SyncLock.isExporting).toBe(true);
  });
});

describe("AT-012: AdapterRegistry", () => {
  beforeEach(() => {
    AdapterRegistry.clear();
  });

  it("register adapter → getAdapter returns it", () => {
    const adapter = stubAdapter("notion");
    AdapterRegistry.register(adapter);
    expect(AdapterRegistry.getAdapter("notion")).toBe(adapter);
  });

  it("getAdapter unregistered → null", () => {
    expect(AdapterRegistry.getAdapter("nonexistent")).toBeNull();
  });

  it("listAdapters returns all registered sourceTypes", () => {
    AdapterRegistry.register(stubAdapter("notion"));
    AdapterRegistry.register(stubAdapter("csv"));
    expect(AdapterRegistry.listAdapters()).toEqual(["notion", "csv"]);
  });

  it("listAdapters empty after clear()", () => {
    AdapterRegistry.register(stubAdapter("notion"));
    AdapterRegistry.clear();
    expect(AdapterRegistry.listAdapters()).toEqual([]);
  });

  it("register same sourceType twice → second replaces first", () => {
    const first = stubAdapter("notion");
    const second = stubAdapter("notion");
    AdapterRegistry.register(first);
    AdapterRegistry.register(second);
    expect(AdapterRegistry.getAdapter("notion")).toBe(second);
    expect(AdapterRegistry.getAdapter("notion")).not.toBe(first);
  });

  it("clear() → getAdapter returns null", () => {
    AdapterRegistry.register(stubAdapter("notion"));
    AdapterRegistry.clear();
    expect(AdapterRegistry.getAdapter("notion")).toBeNull();
  });
});
