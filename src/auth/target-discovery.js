"use strict";

// ===========================================
// 授权后目标发现 — 纯逻辑层(L1,零 IO、零 require)
// 三模型共识(deepseek-v4-flash/GLM-5.3-flash/hy3)设计:
// 授权成功后自动发现可访问数据库 → 决策矩阵(0/1/N 个)→ 自动填充/引导选择
// ===========================================

// 候选上限(与 pending TTL 对齐的跨页结果存储,容量有界)
const POST_AUTH_CANDIDATE_LIMIT = 200;

// 候选排序关键词(仅用于 UI 呈现,不用于自动选择)
const PREFERRED_TITLE_KEYWORDS = ["收藏", "书签", "书签库", "clip", "notion", "导出"];

// 从 Notion search 响应映射候选列表(纯函数)
// 兼容两种输入形状:
//   ① NotionAPI.search 原始结果: { object: "database", title: [{ plain_text }] }
//   ② WorkspaceService.fetchWorkspaceStaged 映射形状: { type: "database", title: "字符串" }
const normalizeCandidates = (searchResponse = {}) => {
    const results = Array.isArray(searchResponse?.results) ? searchResponse.results : [];
    return results
        .filter((item) => item && (item.object === "database" || item.type === "database") && !item.archived)
        .map((item) => ({
            id: String(item.id || "").replace(/-/g, "").toLowerCase(),
            title: typeof item.title === "string"
                ? item.title
                : String(item.title?.[0]?.plain_text || "无标题数据库"),
            url: String(item.url || ""),
        }))
        .filter((item) => item.id);
};

// 候选排序(仅 UI 呈现用):标题含关键词优先置顶,其余按原顺序
const sortCandidatesForDisplay = (candidates = []) => {
    const lower = (title) => String(title || "").toLowerCase();
    return [...candidates].sort((a, b) => {
        const aHit = PREFERRED_TITLE_KEYWORDS.some((kw) => lower(a.title).includes(kw));
        const bHit = PREFERRED_TITLE_KEYWORDS.some((kw) => lower(b.title).includes(kw));
        if (aHit !== bHit) return aHit ? -1 : 1;
        return 0;
    });
};

// 决策矩阵(纯函数,可单测):
//   currentState.databaseId 已配置 → skip(尊重用户选择,不覆盖)
//   0 个候选 → empty(引导「在 Notion 中把集成分享给目标数据库」)
//   恰好 1 个 → autofill(自动填充)
//   ≥2 个 → needs_choice(不猜,弹选择器 — AGENTS.md Routing 优先级 2)
//   currentState.databaseId 非空但不在候选 → needs_choice + warn(token 换了工作区/集成被移除共享)
const decideAutoFill = ({ candidates = [], currentState = {}, source = "" } = {}) => {
    const list = Array.isArray(candidates) ? candidates : [];
    const existingDatabaseId = String(currentState?.databaseId || "").trim();

    if (existingDatabaseId) {
        const stillReachable = list.some((db) => db.id === existingDatabaseId);
        if (stillReachable) {
            return { action: "skip", reason: "already-configured", databaseId: existingDatabaseId };
        }
        return {
            action: "needs_choice",
            reason: "configured-target-unreachable",
            databaseId: "",
            warn: "已配置的数据库不在当前可访问列表中(token 可能已切换工作区,或集成被移除共享)",
        };
    }

    if (list.length === 0) {
        return {
            action: "empty",
            reason: "no-database",
            databaseId: "",
            hint: "集成尚未获得数据库访问权,请在目标数据库右上角 ⋯ → Connections → 添加本集成",
        };
    }

    if (list.length === 1) {
        return { action: "autofill", reason: "single-database", databaseId: list[0].id, title: list[0].title };
    }

    return { action: "needs_choice", reason: "multi-database", databaseId: "", count: list.length };
};

// exchangeToken 错误分类映射(纯字符串表,禁止回显请求体 — REDACT_IN_LOGS 纪律)
const describeExchangeError = (result = {}, status = 0) => {
    const errorCode = String(result?.error || result?.error_description || result?.message || "").toLowerCase();
    const statusCode = Number(status) || 0;

    if (errorCode.includes("invalid_grant")) {
        return "授权码已使用或已过期(10 分钟内有效),请重新点击一键授权";
    }
    if (errorCode.includes("invalid_client")) {
        return "Client ID 与 Client Secret 不匹配,或集成类型不是 Public Integration(Internal Integration 不支持 OAuth)";
    }
    if (errorCode.includes("invalid_redirect_uri") || errorCode.includes("redirect_uri_mismatch")) {
        return "Redirect URI 与 Notion 集成后台配置不一致,请两边逐字符核对(含尾斜杠)";
    }
    if (errorCode.includes("access_denied")) {
        return "你在 Notion 授权页点了拒绝,可重新点击一键授权";
    }
    if (statusCode === 401) {
        return "Notion 拒绝了凭证(401),请检查 Client ID / Client Secret 是否正确";
    }
    if (statusCode === 403) {
        return "Notion 拒绝了请求(403),请检查集成是否拥有目标页面/数据库的访问权";
    }
    if (statusCode >= 500) {
        return `Notion 服务暂时不可用(${statusCode}),请稍后重试`;
    }
    return `OAuth 交换失败(${statusCode || "网络错误"}),请检查网络连接后重试`;
};

// redirect_uri 差异诊断(只加诊断,不改判定 — CSRF 防线仍是 state+TTL)
const describeRedirectUriMismatch = (currentUrl = "", redirectUri = "") => {
    let current = null;
    let expected = null;
    try {
        current = new URL(currentUrl);
    } catch {
        return { originMatch: false, pathnameMatch: false, expected: null, actual: null };
    }
    try {
        expected = new URL(redirectUri);
    } catch {
        return { originMatch: false, pathnameMatch: false, expected: null, actual: null };
    }
    const normalizePath = (path) => {
        let p = String(path || "/");
        if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
        return p.toLowerCase();
    };
    return {
        originMatch: current.origin === expected.origin,
        pathnameMatch: normalizePath(current.pathname) === normalizePath(expected.pathname),
        expected: { origin: expected.origin, pathname: expected.pathname },
        actual: { origin: current.origin, pathname: current.pathname },
    };
};

module.exports = {
    POST_AUTH_CANDIDATE_LIMIT,
    normalizeCandidates,
    sortCandidatesForDisplay,
    decideAutoFill,
    describeExchangeError,
    describeRedirectUriMismatch,
};
