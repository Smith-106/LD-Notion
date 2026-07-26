import { describe, it, expect, beforeEach, vi } from "vitest";

// ISS-20260723-010 W7-1 (MAINT-007): UICommandService 契约单测。
// execute(command, payload) 是 coordination 层的命令路由 switch——纯路由逻辑可测。
//
// 测试范围聚焦"路由 + 参数校验 + 错误降级"——这些契约不触发网络依赖，直接断言抛错/返回。
// 不 spy 依赖方法：vitest ESM-CJS 互操作下，测试 import 的 TargetState 与 UICommandService
// 内部 require("../auth") 拿到的不是同一实例，vi.spyOn 不生效（实例分裂）。
// select_ai_target 用真实 TargetState.setAITarget（纯 Storage 写入，setup.js 已 mock GM_setValue），
// 断言 Storage 副作用而非 spy 调用。refresh_workspace_targets/fetch_ai_models 的"有 key"路径走
// NotionAPI/AIService 网络调用，由"缺 key 抛错"用例覆盖校验逻辑，透传是 trivial await 不单测。
// 参照 ai-service.test.js 的 vitest + 直接 import + 行为断言模式。

import { UICommandService } from "../src/coordination/UICommandService.js";
import { TargetState } from "../src/auth/index.js";
import { MSG } from "../src/config/index.js";
import { CONFIG } from "../src/config/index.js";

describe("AT-007: UICommandService.execute 命令路由 + 参数校验", () => {
    describe("未知 command 降级", () => {
        it("未知 command 抛「未知的 command: xxx」", async () => {
            await expect(UICommandService.execute("non_existent_command")).rejects.toThrow(
                "未知的 command: non_existent_command"
            );
        });

        it("空 command 抛「未知的 command: 」", async () => {
            await expect(UICommandService.execute("")).rejects.toThrow("未知的 command: ");
        });
    });

    describe("select_ai_target 路由（真实 TargetState.setAITarget 副作用）", () => {
        beforeEach(() => {
            // 清 AI_TARGET_DB 存储状态
            GM_setValue(CONFIG.STORAGE_KEYS.AI_TARGET_DB, null);
        });

        it("调 TargetState.setAITarget 写入 Storage 并返回解析值", async () => {
            const result = await UICommandService.execute("select_ai_target", { targetValue: "db-abc-123" });
            // setAITarget 内部 normalizeAITarget + Storage.set + parseAITarget，返回解析后的对象
            expect(result).toBeDefined();
            expect(typeof result).toBe("object");
            // Storage 被写入（GM_setValue mock）
            const stored = GM_getValue(CONFIG.STORAGE_KEYS.AI_TARGET_DB, null);
            expect(stored).toBeTruthy();
        });

        it("targetValue 缺省传空串（不抛错，交 TargetState 处理）", async () => {
            await expect(UICommandService.execute("select_ai_target", {})).resolves.toBeDefined();
        });
    });

    describe("refresh_workspace_targets 参数校验", () => {
        it("缺 apiKey 抛 MSG.NO_NOTION_KEY", async () => {
            await expect(UICommandService.execute("refresh_workspace_targets", {})).rejects.toThrow(
                MSG.NO_NOTION_KEY
            );
        });

        it("apiKey 仅空白也判缺失（trim 后空）", async () => {
            await expect(
                UICommandService.execute("refresh_workspace_targets", { apiKey: "   " })
            ).rejects.toThrow(MSG.NO_NOTION_KEY);
        });

        it("缺 apiKey 但有 missingApiKeyMessage 抛自定义消息", async () => {
            await expect(
                UICommandService.execute("refresh_workspace_targets", {
                    missingApiKeyMessage: "自定义缺失提示",
                })
            ).rejects.toThrow("自定义缺失提示");
        });
    });

    describe("fetch_ai_models 参数校验", () => {
        it("缺 aiApiKey 抛 MSG.NO_AI_KEY", async () => {
            await expect(UICommandService.execute("fetch_ai_models", {})).rejects.toThrow(MSG.NO_AI_KEY);
        });

        it("aiApiKey 仅空白也判缺失（trim 后空）", async () => {
            await expect(
                UICommandService.execute("fetch_ai_models", { aiApiKey: "  " })
            ).rejects.toThrow(MSG.NO_AI_KEY);
        });

        it("缺 aiApiKey 但有 missingApiKeyMessage 抛自定义消息", async () => {
            await expect(
                UICommandService.execute("fetch_ai_models", { missingApiKeyMessage: "AI key 缺失" })
            ).rejects.toThrow("AI key 缺失");
        });
    });

    describe("save_command_boundary_settings scope 路由", () => {
        it("未知 scope 抛「未知的 settings scope: xxx」", async () => {
            await expect(
                UICommandService.execute("save_command_boundary_settings", { scope: "unknown_scope" })
            ).rejects.toThrow("未知的 settings scope: unknown_scope");
        });

        it("scope 缺省抛「未知的 settings scope: 」", async () => {
            await expect(
                UICommandService.execute("save_command_boundary_settings", {})
            ).rejects.toThrow("未知的 settings scope: ");
        });

        it("scope=notion-site 不抛错（路由到 _saveNotionSiteSettings）", async () => {
            await expect(
                UICommandService.execute("save_command_boundary_settings", { scope: "notion-site" })
            ).resolves.toBeDefined();
        });

        it("scope=main-export-session 不抛错", async () => {
            await expect(
                UICommandService.execute("save_command_boundary_settings", { scope: "main-export-session" })
            ).resolves.toBeDefined();
        });
    });

    describe("Object.freeze 单例不可变", () => {
        it("UICommandService 被 Object.freeze", () => {
            expect(Object.isFrozen(UICommandService)).toBe(true);
        });
    });
});
