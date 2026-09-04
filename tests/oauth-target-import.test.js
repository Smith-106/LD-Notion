import { describe, it, expect, vi, beforeEach } from "vitest";

const {
    POST_AUTH_CANDIDATE_LIMIT,
    normalizeCandidates,
    sortCandidatesForDisplay,
    decideAutoFill,
    describeExchangeError,
    describeRedirectUriMismatch,
} = require("../src/auth/target-discovery");

describe("target-discovery L1 纯逻辑", () => {
    describe("normalizeCandidates", () => {
        it("映射 search 响应为候选列表(去横线/过滤 archived/非 database)", () => {
            const response = {
                results: [
                    { object: "database", id: "abc-def-123", title: [{ plain_text: "收藏库" }], url: "https://notion.so/abc", archived: false },
                    { object: "database", id: "ghi-456", title: [{ plain_text: "书签" }], url: "", archived: true },
                    { object: "page", id: "page-1", title: [{ plain_text: "页面" }] },
                    { object: "database", id: "jkl-789", title: [], archived: false },
                ],
            };
            const candidates = normalizeCandidates(response);
            expect(candidates).toHaveLength(2);
            expect(candidates[0]).toEqual({ id: "abcdef123", title: "收藏库", url: "https://notion.so/abc" });
            expect(candidates[1].title).toBe("无标题数据库");
        });

        it("兼容 WorkspaceService 映射形状(type 字段 + 字符串 title)", () => {
            const candidates = normalizeCandidates({
                results: [
                    { type: "database", id: "db-1-2-3", title: "收藏库", url: "https://notion.so/db123" },
                    { type: "page", id: "page-1", title: "页面" },
                ],
            });
            expect(candidates).toHaveLength(1);
            expect(candidates[0]).toEqual({ id: "db123", title: "收藏库", url: "https://notion.so/db123" });
        });

        it("空/非法输入返回空数组", () => {
            expect(normalizeCandidates()).toEqual([]);
            expect(normalizeCandidates({ results: [] })).toEqual([]);
            expect(normalizeCandidates({ results: "nope" })).toEqual([]);
        });
    });

    describe("sortCandidatesForDisplay", () => {
        it("关键词命中置顶,其余保持原序", () => {
            const list = [
                { id: "a", title: "普通库" },
                { id: "b", title: "我的收藏" },
                { id: "c", title: "Clip 库" },
            ];
            const sorted = sortCandidatesForDisplay(list);
            expect(sorted[0].id).toBe("b");
            expect(sorted[1].id).toBe("c");
            expect(sorted[2].id).toBe("a");
        });
    });

    describe("decideAutoFill 决策矩阵", () => {
        const db = (id, title = "库") => ({ id, title });

        it("已配置且仍可达 → skip", () => {
            const decision = decideAutoFill({ candidates: [db("aaa")], currentState: { databaseId: "aaa" } });
            expect(decision.action).toBe("skip");
            expect(decision.reason).toBe("already-configured");
        });

        it("已配置但不在候选 → needs_choice + warn(不静默改也不静默留)", () => {
            const decision = decideAutoFill({ candidates: [db("bbb")], currentState: { databaseId: "aaa" } });
            expect(decision.action).toBe("needs_choice");
            expect(decision.reason).toBe("configured-target-unreachable");
            expect(decision.warn).toBeTruthy();
        });

        it("0 个候选 → empty + 引导文案", () => {
            const decision = decideAutoFill({ candidates: [], currentState: {} });
            expect(decision.action).toBe("empty");
            expect(decision.hint).toContain("Connections");
        });

        it("恰好 1 个 → autofill", () => {
            const decision = decideAutoFill({ candidates: [db("ccc", "唯一库")], currentState: {} });
            expect(decision.action).toBe("autofill");
            expect(decision.databaseId).toBe("ccc");
            expect(decision.title).toBe("唯一库");
        });

        it("≥2 个 → needs_choice(不猜,弹选择器)", () => {
            const decision = decideAutoFill({ candidates: [db("a"), db("b")], currentState: {} });
            expect(decision.action).toBe("needs_choice");
            expect(decision.reason).toBe("multi-database");
            expect(decision.count).toBe(2);
        });

        it("非法输入不崩溃", () => {
            expect(decideAutoFill({}).action).toBe("empty");
            expect(decideAutoFill({ candidates: "x", currentState: null }).action).toBe("empty");
        });
    });

    describe("describeExchangeError 错误分类映射", () => {
        it("invalid_grant → 重新授权指引", () => {
            expect(describeExchangeError({ error: "invalid_grant" }, 400)).toContain("重新点击一键授权");
        });
        it("invalid_client → 配置检查", () => {
            expect(describeExchangeError({ error: "invalid_client" }, 401)).toContain("Client ID");
        });
        it("invalid_redirect_uri → 逐字符核对", () => {
            expect(describeExchangeError({ error: "invalid_redirect_uri" }, 400)).toContain("逐字符核对");
        });
        it("access_denied → 用户拒绝", () => {
            expect(describeExchangeError({ error: "access_denied" }, 400)).toContain("拒绝");
        });
        it("5xx → 服务不可用", () => {
            expect(describeExchangeError({}, 503)).toContain("503");
        });
        it("未知 → 通用文案", () => {
            expect(describeExchangeError({}, 0)).toContain("网络错误");
        });
        it("禁止回显请求体(防 CWE-532)", () => {
            const message = describeExchangeError({ error: "invalid_grant", error_description: "secret_abc123" }, 400);
            expect(message).not.toContain("secret_abc123");
        });
    });

    describe("describeRedirectUriMismatch", () => {
        it("origin 不同 → originMatch false", () => {
            const diff = describeRedirectUriMismatch("https://example.com/?code=x", "https://www.notion.so/");
            expect(diff.originMatch).toBe(false);
            expect(diff.pathnameMatch).toBe(true);
        });
        it("pathname 不同 → pathnameMatch false", () => {
            const diff = describeRedirectUriMismatch("https://www.notion.so/settings?code=x", "https://www.notion.so/");
            expect(diff.originMatch).toBe(true);
            expect(diff.pathnameMatch).toBe(false);
        });
        it("尾斜杠归一化 → 匹配", () => {
            const diff = describeRedirectUriMismatch("https://www.notion.so?code=x", "https://www.notion.so/");
            expect(diff.originMatch).toBe(true);
            expect(diff.pathnameMatch).toBe(true);
        });
        it("非法 URL → 全 false", () => {
            const diff = describeRedirectUriMismatch("not-a-url", "https://www.notion.so/");
            expect(diff.originMatch).toBe(false);
        });
    });
});

describe("target-discovery L2 编排(UICommandService)", () => {
    let UICommandService;
    let Storage;
    let TargetState;
    let WorkspaceService;
    let OperationGuard;

    beforeEach(async () => {
        vi.resetModules();
        // 注入 transport mock(对齐 tests/api-modules.test.js configureTransport 先例)
        // NotionAPI.request 期望 transport 返回 {status, responseText} 形态
        const { NotionAPI } = require("../src/api");
        NotionAPI.configureTransport({
            request: vi.fn(async ({ method, endpoint }) => {
                if (endpoint === "/search") {
                    return {
                        status: 200,
                        responseText: JSON.stringify({
                            results: [
                                { object: "database", id: "db-1-2-3", title: [{ plain_text: "收藏库" }], url: "", archived: false },
                            ],
                            has_more: false,
                            next_cursor: null,
                        }),
                    };
                }
                return { status: 200, responseText: JSON.stringify({ results: [] }) };
            }),
        });
        ({ UICommandService } = require("../src/coordination"));
        ({ Storage } = require("../src/storage"));
        ({ TargetState } = require("../src/auth"));
        ({ WorkspaceService } = require("../src/extract"));
        ({ OperationGuard } = require("../src/security"));
    });

    it("无 token → skip no_token,不写 TargetState", async () => {
        const result = await UICommandService.execute("discover_export_target_after_auth", { accessToken: "", source: "oauth_callback" });
        expect(result.action).toBe("skip");
        expect(result.reason).toBe("no_token");
    });

    it("source 非 oauth_callback(续签)→ skip not_callback", async () => {
        const result = await UICommandService.execute("discover_export_target_after_auth", { accessToken: "token-x", source: "refresh" });
        expect(result.action).toBe("skip");
        expect(result.reason).toBe("not_callback");
    });

    it("单数据库 → autofill 且 TargetState 被填充", async () => {
        const result = await UICommandService.execute("discover_export_target_after_auth", { accessToken: "token-x", source: "oauth_callback" });
        expect(result.action).toBe("autofill");
        expect(result.databaseId).toBe("db123");
        const state = TargetState.getExportState();
        expect(state.databaseId).toBe("db123");
        expect(state.targetType).toBe("database");
    });

    it("多数据库 → needs_choice 且不覆盖已有配置", async () => {
        const { NotionAPI } = require("../src/api");
        NotionAPI.configureTransport({
            request: vi.fn(async () => ({
                status: 200,
                responseText: JSON.stringify({
                    results: [
                        { object: "database", id: "aaa", title: [{ plain_text: "A" }], archived: false },
                        { object: "database", id: "bbb", title: [{ plain_text: "B" }], archived: false },
                    ],
                    has_more: false,
                    next_cursor: null,
                }),
            })),
        });
        TargetState.saveExportState({ targetType: "database", databaseId: "existing" });
        const result = await UICommandService.execute("discover_export_target_after_auth", { accessToken: "token-x", source: "oauth_callback" });
        expect(result.action).toBe("needs_choice");
        expect(TargetState.getExportState().databaseId).toBe("existing");
    });

    it("search 抛错 → failed 且不写 TargetState", async () => {
        const { NotionAPI } = require("../src/api");
        NotionAPI.configureTransport({
            request: vi.fn(async () => { throw new Error("network down"); }),
        });
        const result = await UICommandService.execute("discover_export_target_after_auth", { accessToken: "token-x", source: "oauth_callback" });
        expect(result.action).toBe("failed");
        expect(result.reason).toBe("discovery_error");
        expect(TargetState.getExportState().databaseId).toBe("");
    });

    it("跨页结果落存储(带 timestamp,候选有界)", async () => {
        await UICommandService.execute("discover_export_target_after_auth", { accessToken: "token-x", source: "oauth_callback" });
        const raw = Storage.get("ldb_notion_oauth_post_auth_target", "");
        const payload = JSON.parse(raw);
        expect(payload.action).toBe("autofill");
        expect(payload.timestamp).toBeTruthy();
        expect(Array.isArray(payload.candidates)).toBe(true);
        expect(payload.candidates.length).toBeLessThanOrEqual(POST_AUTH_CANDIDATE_LIMIT);
    });

    it("Guard level 0 时 search 仍可执行(只读不阻断)", async () => {
        OperationGuard.setLevel(0);
        const result = await UICommandService.execute("discover_export_target_after_auth", { accessToken: "token-x", source: "oauth_callback" });
        expect(result.action).toBe("autofill");
        OperationGuard.setLevel(1);
    });
});
