// v3.14.17 (P0-1): 错误分类模型测试 —— 表驱动,断言分类键而非文案字符串。
import { describe, it, expect } from "vitest";
const ErrorModel = require("../src/errors/ErrorModel");

describe("ErrorModel.classifyError", () => {
    const cases = [
        // [name, error, expectKind, expectRetryable]
        ["401 终态标记", { isAuthTerminal: true, statusCode: 401, message: "unauthorized" }, "auth", false],
        ["401 裸状态", { statusCode: 401, message: "Notion API 错误: unauthorized" }, "auth", false],
        ["empty_token", { isAuthTerminal: true, statusCode: 0, authCode: "empty_token", message: "" }, "auth", false],
        ["format_suspect", { isAuthTerminal: true, authCode: "format_suspect", message: "" }, "auth", false],
        ["invalid_grant", { statusCode: 401, authCode: "invalid_grant" }, "auth", false],
        ["403 权限", { statusCode: 403, message: "forbidden" }, "permission", false],
        ["429 限流", { statusCode: 429, message: "rate limited" }, "rate_limit", true],
        ["429 带重试计数", { statusCode: 429, retryCount: 3, message: "rate limited" }, "rate_limit", true],
        ["404 目标不存在", { statusCode: 404, message: "not found" }, "not_found", false],
        ["400 schema", { statusCode: 400, message: "bad request" }, "schema", false],
        ["409 类型冲突", { statusCode: 409, message: "conflict" }, "schema", false],
        ["超时 AbortError", { name: "AbortError", message: "The operation was aborted" }, "timeout", true],
        ["超时消息匹配", { statusCode: 0, message: "request timed out" }, "timeout", true],
        ["500 服务端", { statusCode: 500, message: "internal error" }, "server", true],
        ["502 网关", { statusCode: 502, message: "bad gateway" }, "server", true],
        ["未知错误", { statusCode: 418, message: "teapot" }, "unknown", true],
        ["无信息", {}, "unknown", true],
    ];

    cases.forEach(([name, error, kind, retryable]) => {
        it(name, () => {
            const ux = ErrorModel.classifyError(error);
            expect(ux.kind).toBe(kind);
            expect(ux.retryable).toBe(retryable);
            expect(typeof ux.action).toBe("string");
            expect(ux.action.length).toBeGreaterThan(4);
        });
    });

    it("429 重试计数进入 action 文案", () => {
        const ux = ErrorModel.classifyError({ statusCode: 429, retryCount: 2 });
        expect(ux.action).toContain("2");
    });
});

describe("ErrorModel.annotateError", () => {
    it("幂等:二次标注不覆盖", () => {
        const err = new Error("test");
        const once = ErrorModel.annotateError(err);
        const twice = ErrorModel.annotateError(err);
        expect(once.ux).toBe(twice.ux);
        expect(once.ux.kind).toBe("unknown");
    });

    it("保留已有 ux(overrides 生效一次)", () => {
        const err = ErrorModel.annotateError(new Error("x"), { kind: "custom" });
        expect(err.ux.kind).toBe("custom");
    });

    it("非对象输入原样返回", () => {
        expect(ErrorModel.annotateError(null)).toBeNull();
        expect(ErrorModel.annotateError("str")).toBe("str");
    });
});

describe("ErrorModel.summarize", () => {
    it("无 ux 时自动分类", () => {
        const s = ErrorModel.summarize({ statusCode: 401, message: "Notion API 错误: unauthorized" });
        expect(s).toContain("Notion API 错误: unauthorized");
        expect(s).toContain("重新");
    });
});
