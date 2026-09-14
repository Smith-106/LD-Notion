"use strict";

// GitHub OAuth Device Flow(20260914)——纯前端 secret-free 授权路径。
// 为什么不用 auth-code 流程: GitHub token 交换强制 client_secret 且不支持 PKCE
// 纯公开客户端,secret 内嵌进分发脚本即公开泄漏;Device Flow 只需公开 client_id,
// 是 GitHub 官方为无后台设备场景设计的流程(与 NotionOAuth 的 manual-secret 模式互补)。
// 范式对齐 NotionOAuth: GM_xmlhttpRequest + 超时 + 错误分类 + REDACT_IN_LOGS
// (诊断信息仅含 client_id/error code, 永不回显 token/device_code/user_code)。

const { CONFIG } = require("../config");
const { Storage } = require("../storage");

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
// scopes: 认证路径(/user/starred 等)与 gists 读取所需; 匿名限额 60 req/h 且 gists 无匿名读
const DEFAULT_SCOPES = "repo gist";
const DEFAULT_INTERVAL_MS = 5000;
const SLOW_DOWN_EXTRA_MS = 5000;
const DEFAULT_MAX_POLL_MS = 15 * 60 * 1000; // GitHub device code expires_in 通常 900s

// —— GM_xmlhttpRequest Promise 封装(对齐 NotionOAuth.exchangeToken 范式) ——
function gmPostForm(url, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest === "undefined") {
            reject(new Error("当前环境不支持 GM_xmlhttpRequest, 无法发起 GitHub 授权"));
            return;
        }
        GM_xmlhttpRequest({
            method: "POST",
            url,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            data: Object.keys(params)
                .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
                .join("&"),
            onload: (response) => {
                let body = {};
                try { body = JSON.parse(response.responseText || "{}"); } catch (_) { body = {}; }
                resolve({ status: response.status, body });
            },
            onerror: (error) => reject(new Error(`GitHub 授权网络请求失败: ${error?.error || error}`)),
            timeout: timeoutMs,
            ontimeout: () => reject(new Error("GitHub 授权请求超时，请检查网络连接")),
        });
    });
}

function describeDeviceCodeError(body, status) {
    const code = String(body?.error || "").toLowerCase();
    const message = String(body?.error_description || body?.error_uri || "").slice(0, 200);
    const map = {
        incorrect_client_credentials: "Client ID 无效（github.com/settings/developers 核对 OAuth App 的 Client ID）",
        incorrect_device_code: "设备码无效或已过期，请重新发起授权",
        expired_token: "授权等待超时（15 分钟内未在 GitHub 页面确认），请重新发起授权",
        device_flow_disabled: "该 OAuth App 未启用 Device Flow（GitHub 默认启用；老式 App 需勾选 Enable Device Flow）",
        unauthorized_client: "该 OAuth App 不允许此授权方式",
        access_denied: "你在 GitHub 页面拒绝了授权",
    };
    const error = new Error(map[code] || `GitHub 授权失败(HTTP ${status}${code ? `, ${code}` : ""})`);
    error.code = code;
    if (message) error.detail = message;
    return error;
}

const GitHubOAuth = {
    DEVICE_CODE_URL,
    TOKEN_URL,
    DEFAULT_SCOPES,

    // client_id 为公开信息(设计上随请求明文出现), 存普通键即可; 空表示未配置
    getClientId: () => String(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_OAUTH_CLIENT_ID, "")).trim(),

    setClientId: (clientId) => {
        const value = String(clientId || "").trim();
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_OAUTH_CLIENT_ID, value);
        return value;
    },

    // —— Device Flow 主流程 ——
    // options: { clientId?, scopes?, intervalMs?, maxPollMs?, onUserCode?, onStatus? }
    // 返回 { accessToken, tokenType, scope }; 过程回调用于 UI 展示(用户代码/轮询状态)
    startDeviceFlow: async (options = {}) => {
        const clientId = String(options.clientId || GitHubOAuth.getClientId()).trim();
        if (!clientId) {
            const error = new Error("缺少 GitHub OAuth Client ID —— 前往 github.com/settings/developers 创建 OAuth App（无需填 Callback URL），把 Client ID 粘贴到下方输入框");
            error.code = "missing_client_id";
            throw error;
        }
        const scopes = options.scopes || GitHubOAuth.DEFAULT_SCOPES;
        let intervalMs = Number(options.intervalMs) > 0 ? Number(options.intervalMs) : DEFAULT_INTERVAL_MS;
        const maxPollMs = Number(options.maxPollMs) > 0 ? Number(options.maxPollMs) : DEFAULT_MAX_POLL_MS;
        const slowDownExtraMs = Number(options.slowDownExtraMs) > 0 ? Number(options.slowDownExtraMs) : SLOW_DOWN_EXTRA_MS;
        const onUserCode = typeof options.onUserCode === "function" ? options.onUserCode : (() => {});
        const onStatus = typeof options.onStatus === "function" ? options.onStatus : (() => {});

        GitHubOAuth._pollCancelled = false;

        // ① 申请设备码
        const dcResponse = await gmPostForm(DEVICE_CODE_URL, {
            client_id: clientId,
            scope: scopes,
        });
        const dc = dcResponse.body || {};
        if (dcResponse.status !== 200 || !dc.device_code || !dc.user_code) {
            throw describeDeviceCodeError(dc, dcResponse.status);
        }

        // ② 展示用户代码(verification_uri 固定 https://github.com/login/device)
        // 20260914: expires_in 提取复用 — 轮询死线绑定设备码实际有效期(maxPollMs 取小)，
        // 否则 expires_in < maxPollMs 时会多轮空转到服务端报错才终止
        const expiresInSeconds = Number(dc.expires_in) > 0 ? Number(dc.expires_in) : 900;
        onUserCode({
            userCode: String(dc.user_code),
            verificationUri: String(dc.verification_uri || "https://github.com/login/device"),
            expiresInSeconds,
        });

        // ③ 轮询 token 端点(authorization_pending → 继续; slow_down → 降速; expired → 失败)
        const startedAt = Date.now();
        const deadlineMs = Math.min(maxPollMs, expiresInSeconds * 1000);
        for (;;) {
            if (GitHubOAuth._pollCancelled) {
                const cancelError = new Error("已取消 GitHub 授权");
                cancelError.code = "cancelled";
                throw cancelError;
            }
            if (Date.now() - startedAt > deadlineMs) {
                const timeoutError = new Error("GitHub 授权等待超时，请重新发起授权");
                timeoutError.code = "expired_token";
                throw timeoutError;
            }
            await new Promise((r) => setTimeout(r, intervalMs));
            if (GitHubOAuth._pollCancelled) {
                const cancelError = new Error("已取消 GitHub 授权");
                cancelError.code = "cancelled";
                throw cancelError;
            }

            const tokenResponse = await gmPostForm(TOKEN_URL, {
                client_id: clientId,
                device_code: dc.device_code,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            });
            const tb = tokenResponse.body || {};
            if (tokenResponse.status === 200 && tb.access_token) {
                onStatus({ phase: "success" });
                return {
                    accessToken: String(tb.access_token),
                    tokenType: String(tb.token_type || "bearer"),
                    scope: String(tb.scope || scopes),
                };
            }
            const code = String(tb.error || "").toLowerCase();
            if (code === "authorization_pending") {
                onStatus({ phase: "pending", intervalMs });
                continue;
            }
            if (code === "slow_down") {
                intervalMs += slowDownExtraMs;
                onStatus({ phase: "slow_down", intervalMs });
                continue;
            }
            throw describeDeviceCodeError(tb, tokenResponse.status);
        }
    },

    // —— 授权结果落库(与手动 PAT 同一存储键, GitHubAPI 零改动) ——
    applyTokenResponse: async (result = {}) => {
        if (!result?.accessToken) throw new Error("GitHub OAuth 未返回 access_token");
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_TOKEN, result.accessToken);
        return result.accessToken;
    },

    // UI 取消按钮调用; 正在进行的轮询在下一个检查点抛 cancelled
    cancelPolling: () => {
        GitHubOAuth._pollCancelled = true;
    },
};

module.exports = { GitHubOAuth };
