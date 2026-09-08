// v3.14.17 (三模型共识 P0-1): 错误分类 + 可行动文案 —— 纯函数,零依赖,无 DOM。
// 目标: 任何 Notion API 失败都得到 { kind, retryable, action } 三元组,
// UI 只渲染,不各自判断;测试断言 kind/action 键,不断言具体文案(文案可演进)。

// 错误分类: 输入 API 状态的错误对象,输出稳定类别。
// 优先级自高向低: 认证终态 > 权限 > 限流 > 超时 > 网络 > 服务端 > 资源 > 未知。
const classifyError = (error) => {
    const status = Number(error?.statusCode || error?.status || 0);
    const authCode = String(error?.authCode || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    const name = String(error?.name || "").toLowerCase();

    // 认证终态: 官方标记优先; 401 无续签可能; 凭证类错误码兜底
    if (error?.isAuthTerminal === true || status === 401) {
        let action = "请重新复制保存 API Key（secret_/ntn_ 开头），或重新 OAuth 一键授权后重试";
        if (authCode === "empty_token") {
            action = "请到设置页重新粘贴保存 API Key，或重新 OAuth 一键授权";
        } else if (authCode === "format_suspect") {
            action = "Key 应以 secret_ 或 ntn_ 开头，请从 Notion 集成页面用 Copy 按钮重新复制（勿含空格/换行）";
        } else if (authCode === "invalid_bearer_token" || authCode === "unauthorized" || authCode === "invalid_grant" || authCode === "invalid_client") {
            action = "Key 可能已失效（集成被删除/轮换）或复制不完整，请重新复制保存，或点面板『重新授权』重新走 OAuth";
        }
        return { kind: "auth", retryable: false, action };
    }

    if (status === 403) {
        return {
            kind: "permission",
            retryable: false,
            action: "该集成可能未关联目标数据库/页面，或没有写入权限。请到 Notion 集成后台确认已连接目标库，并检查集成能力里已勾选读写权限",
        };
    }

    if (status === 429) {
        const retryCount = error?.retryCount || 0;
        return {
            kind: "rate_limit",
            retryable: true,
            action: retryCount > 0
                ? `已自动重试 ${retryCount} 次仍被限流。请降低导出速度（设置里的请求间隔调大），稍后再试`
                : "Notion API 限流。请降低导出速度（请求间隔调大），稍后再试",
        };
    }

    if (status === 404) {
        return {
            kind: "not_found",
            retryable: false,
            action: "目标数据库/页面不存在或已被删除/移动。请检查数据库 ID 与父页面 ID 是否仍有效",
        };
    }

    if (status === 400 || status === 409) {
        return {
            kind: "schema",
            retryable: false,
            action: status === 409
                ? "属性类型不匹配：请手动修改 Notion 数据库中的属性类型，或删除后重新运行自动设置"
                : "请求体与数据库结构不匹配：请检查目标数据库属性与脚本要求是否一致，必要时点『自动设置数据库属性』重建",
        };
    }

    // 网络层: 超时/中止/断网(仅凭特征判定;status 0 不足以分类)
    if (name.includes("abort") || name.includes("timeout") || /timeout|timed out|abort|网络|连接/i.test(message)) {
        return {
            kind: "timeout",
            retryable: true,
            action: "连接超时或已中断（脚本 30 秒超时）。请检查网络与本地代理设置，稍后重试；批量导出可安全续传，不会重复写入",
        };
    }

    if (error?.statusCode === 0) {
        return { kind: "network", retryable: true, action: "网络请求失败，请检查网络与本地代理设置后重试" };
    }

    if (status >= 500) {
        return { kind: "server", retryable: true, action: "Notion 服务端临时故障。请稍后重试；批量导出可安全续传，不会重复写入" };
    }

    return { kind: "unknown", retryable: true, action: "请复制上方错误详情反馈给维护者（不会包含密钥）" };
};

// 把分类结果挂到错误对象上(幂等,不覆盖已有标记)
const annotateError = (error, overrides = {}) => {
    if (!error || typeof error !== "object") return error;
    if (!error.ux) {
        error.ux = { ...classifyError(error), ...overrides };
    }
    return error;
};

// 单行可行动摘要: 供状态栏等单行文本位使用
const summarize = (error) => {
    const ux = error?.ux || classifyError(error);
    const title = error?.message || "未知错误";
    return `${title}（${ux.action}）`;
};

module.exports = { classifyError, annotateError, summarize };
