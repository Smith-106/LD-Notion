import { describe, it, expect } from "vitest";
const { SyncState } = require("../src/storage");
const { SyncStateV2 } = require("../src/storage/SyncState");

/**
 * facade 契约完整性测试（K2 · 三模型共识 2026-09-04）
 *
 * 背景：v3.14.0 曾因 facade 缺失 getSourceState 委托导致
 * renderSyncChainStatus 抛 TypeError → loadConfig 中断 → 同步链状态永不回显。
 * 根因是测试全部直测 SyncStateV2、绕过 facade，契约无测试。
 *
 * 规则：枚举 V2 全部公共方法，断言 facade 上存在同名委托。
 * 新增 V2 公共方法时若未同步委托，本测试立即失败。
 */
describe("SyncState facade — 委托完整性契约", () => {
    const publicMethods = Object.getOwnPropertyNames(SyncStateV2).filter(
        (name) => !name.startsWith("_") && typeof SyncStateV2[name] === "function"
    );

    it("facade 委托覆盖 V2 全部公共方法", () => {
        const missing = publicMethods.filter((name) => typeof SyncState[name] !== "function");
        expect(missing, `facade 缺失委托: ${missing.join(", ")}`).toEqual([]);
    });

    it("facade 委托与 V2 行为一致（抽样验证）", () => {
        // getSourceState：F-UI-31 同步链状态回显依赖
        expect(typeof SyncState.getSourceState).toBe("function");
        expect(SyncState.getSourceState("linuxdo")).toEqual(SyncStateV2.getSourceState("linuxdo"));

        // updateSourceState：通用源状态更新
        expect(typeof SyncState.updateSourceState).toBe("function");

        // forceFlush：持久化冲刷
        expect(typeof SyncState.forceFlush).toBe("function");

        // resetSourceState：F-04 基线重置
        expect(typeof SyncState.resetSourceState).toBe("function");
    });

    it("V1 兼容 API 仍可用（向后兼容锁定）", () => {
        expect(typeof SyncState.getLinuxDoState).toBe("function");
        expect(typeof SyncState.updateLinuxDoState).toBe("function");
        expect(typeof SyncState.getGitHubState).toBe("function");
        expect(typeof SyncState.getBookmarkState).toBe("function");
        expect(typeof SyncState.getRssState).toBe("function");
    });
});
