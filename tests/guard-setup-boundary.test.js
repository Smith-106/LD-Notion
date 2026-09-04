import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Guard 收束回归:setupDatabaseProperties 直调 PATCH /databases 的写路径
// 必须经 OperationGuard 闸门(遗留缺口修复)——用户触发路径权限不足时:
//   ① 不执行任何 Notion 写(不调用 helper,transport 零写)
//   ② 记 guard.denied 审计(actor=user)
//   ③ UI 命令路径抛错(success:false 形态),settings 保存链路不中断(经 setupResult 可见)
describe("Guard 收束: setupDatabaseProperties 写路径(schema 初始化)", () => {
    let UICommandService;
    let OperationGuard;
    let OperationLog;
    let TargetState;
    let NotionAPI;
    let GenericExporter;
    let CONFIG;

    beforeEach(async () => {
        vi.resetModules();
        ({ UICommandService } = require("../src/coordination"));
        ({ OperationGuard, OperationLog } = require("../src/security"));
        ({ TargetState } = require("../src/auth"));
        ({ NotionAPI } = require("../src/api"));
        ({ GenericExporter } = require("../src/export"));
        ({ CONFIG } = require("../src/config"));
        // 每个用例从标准权限(默认 1)起步,测试内按需 setLevel
        OperationGuard.setLevel(1);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const guardDeniedEntries = () =>
        OperationLog.getAll().filter((e) => e.audit_event === "guard.denied");

    describe("setup_export_database_properties(UI 交互式命令)", () => {
        it("标准权限 → 放行,调用 setupDatabaseProperties 并持久化目标", async () => {
            const setupSpy = vi.spyOn(NotionAPI, "setupDatabaseProperties").mockResolvedValue({
                success: true,
                message: "已添加 2 个属性",
                added: ["链接"],
                renamed: ["标题"],
            });
            const persistSpy = vi.spyOn(TargetState, "setExportDatabaseId");

            const result = await UICommandService.execute("setup_export_database_properties", {
                apiKey: "manual_api_key",
                liveApiKey: "",
                databaseId: "db1",
            });

            expect(result.success).toBe(true);
            expect(setupSpy).toHaveBeenCalledTimes(1);
            expect(setupSpy).toHaveBeenCalledWith("db1", "manual_api_key");
            expect(persistSpy).toHaveBeenCalledWith("db1");
            // Guard 放行审计(updateDatabase → write.property.updated)
            const decision = OperationLog.getAll().find((e) => e.audit_event === "write.property.updated");
            expect(decision).toBeTruthy();
            expect(decision.guard.decision).toBe("allow");
            expect(decision.operation.name).toBe("updateDatabase");
        });

        it("只读权限(level 0)→ 拒绝:不调用写 helper、不持久化、抛错、记 guard.denied", async () => {
            OperationGuard.setLevel(0);
            const setupSpy = vi.spyOn(NotionAPI, "setupDatabaseProperties");
            const persistSpy = vi.spyOn(TargetState, "setExportDatabaseId");

            await expect(
                UICommandService.execute("setup_export_database_properties", {
                    apiKey: "manual_api_key",
                    liveApiKey: "",
                    databaseId: "db1",
                })
            ).rejects.toThrow(/权限不足/);

            expect(setupSpy).not.toHaveBeenCalled();
            expect(persistSpy).not.toHaveBeenCalled();

            const denied = guardDeniedEntries();
            expect(denied.length).toBeGreaterThanOrEqual(1);
            const latest = denied[0];
            expect(latest.operation.name).toBe("updateDatabase");
            expect(latest.actor).toBe("user");
            expect(latest.source).toBe("ui");
            expect(latest.result.status).toBe("denied");
            expect(latest.target.type).toBe("notion_database");
        });
    });

    describe("save_command_boundary_settings generic-export-target + autoSetupDatabaseProperties", () => {
        const settingsPayload = (overrides = {}) => ({
            scope: "generic-export-target",
            liveApiKey: "",
            apiKey: "manual_api_key",
            exportType: CONFIG.EXPORT_TARGET_TYPES.DATABASE,
            targetId: "db1",
            imgMode: "embed",
            autoSetupDatabaseProperties: true,
            ...overrides,
        });

        it("标准权限 → 放行,调用 GenericExporter.setupDatabaseProperties,setupResult 成功", async () => {
            const setupSpy = vi.spyOn(GenericExporter, "setupDatabaseProperties").mockResolvedValue({
                success: true,
                message: "属性已正确配置",
            });

            const result = await UICommandService.execute("save_command_boundary_settings", settingsPayload());

            expect(setupSpy).toHaveBeenCalledTimes(1);
            expect(setupSpy).toHaveBeenCalledWith("db1", "manual_api_key");
            expect(result.setupResult.success).toBe(true);
            expect(result.exportState.databaseId).toBe("db1");
        });

        it("只读权限 → 不调用写 helper,setupResult 失败可见,保存流程不中断,记 guard.denied", async () => {
            OperationGuard.setLevel(0);
            const setupSpy = vi.spyOn(GenericExporter, "setupDatabaseProperties");

            const result = await UICommandService.execute("save_command_boundary_settings", settingsPayload());

            expect(setupSpy).not.toHaveBeenCalled();
            expect(result.setupResult.success).toBe(false);
            expect(result.setupResult.error).toContain("权限不足");
            // 目标仍被保存(保存链路不被权限拒绝中断)
            expect(result.exportState.databaseId).toBe("db1");

            const denied = guardDeniedEntries();
            expect(denied.length).toBeGreaterThanOrEqual(1);
            const latest = denied[0];
            expect(latest.operation.name).toBe("updateDatabase");
            expect(latest.actor).toBe("user");
            expect(latest.result.status).toBe("denied");
        });

        it("autoSetupDatabaseProperties=false → 不触发任何 schema 写", async () => {
            const setupSpy = vi.spyOn(GenericExporter, "setupDatabaseProperties");
            const result = await UICommandService.execute("save_command_boundary_settings", {
                ...settingsPayload(),
                autoSetupDatabaseProperties: false,
            });
            expect(setupSpy).not.toHaveBeenCalled();
            expect(result.setupResult).toBeNull();
        });
    });
});
