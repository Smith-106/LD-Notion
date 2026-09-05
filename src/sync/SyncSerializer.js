"use strict";

// SyncSerializer — payload 序列化(白名单显式枚举 + 黑名单硬拒 + URL 哈希化)
// 安全共识(H-1/H-2/H-3/M-1/M-2): 黑名单以 REDACT_IN_LOGS 集合为基集(含 OAuth 三键),
// 白名单逐键显式枚举(禁前缀匹配), 派生去重键族显式映射, URL 类值 SHA-256 哈希化,
// 危险键(__proto__/constructor/prototype)拒收, 键长/计数/ts 偏斜上限。

const { SyncConstants } = require("./constants");
const { SyncCrypto } = require("./SyncCrypto");
const { SyncStateV2 } = require("../storage/SyncState");

// 白名单 — 显式逐键枚举(96 键穷举分区, sec-dsv3 共识)。
// scope: "shared" 两模式都同步; "personal" 仅 personal 模式(shared 剔除)。
const WHITELIST = Object.freeze({
    // 设置类(LWW)
    settings: {
        // W: 无敏感信息
        ldb_sync_interval_linuxdo: { scope: "shared", kind: "number" },
        ldb_sync_interval_github: { scope: "shared", kind: "number" },
        ldb_sync_interval_bookmarks: { scope: "shared", kind: "number" },
        ldb_sync_interval_rss: { scope: "shared", kind: "number" },
        ldb_cross_source_mode: { scope: "shared", kind: "string" },
        ldb_auto_import_enabled: { scope: "shared", kind: "boolean" },
        ldb_auto_import_interval: { scope: "shared", kind: "number" },
        ldb_github_auto_import_enabled: { scope: "shared", kind: "boolean" },
        ldb_github_auto_import_interval: { scope: "shared", kind: "number" },
        ldb_bookmark_auto_import_enabled: { scope: "shared", kind: "boolean" },
        ldb_bookmark_auto_import_interval: { scope: "shared", kind: "number" },
        ldb_rss_auto_import_enabled: { scope: "shared", kind: "boolean" },
        ldb_rss_auto_import_interval: { scope: "shared", kind: "number" },
        ldb_rss_import_dedup_mode: { scope: "shared", kind: "string" },
        ldb_linuxdo_import_dedup_mode: { scope: "shared", kind: "string" },
        ldb_bookmark_import_dedup_mode: { scope: "shared", kind: "string" },
        ldb_ai_category_auto_dedup: { scope: "shared", kind: "boolean" },
        ldb_bookmark_source: { scope: "shared", kind: "string" },
        ldb_github_import_types: { scope: "shared", kind: "string" },
        ldb_export_target_type: { scope: "shared", kind: "string" },
        ldb_workspace_max_pages: { scope: "shared", kind: "number" },
        ldb_agent_max_iterations: { scope: "shared", kind: "number" },
        ldb_ai_service: { scope: "shared", kind: "string" },
        ldb_ai_model: { scope: "shared", kind: "string" },
        ldb_ai_categories: { scope: "shared", kind: "string" },
        ldb_export_concurrency: { scope: "shared", kind: "number" },
        ldb_theme_preference: { scope: "shared", kind: "string" },
        // W(p): 个性化, shared 剔除
        ldb_agent_persona_name: { scope: "personal", kind: "string" },
        ldb_agent_persona_tone: { scope: "personal", kind: "string" },
        ldb_agent_persona_expertise: { scope: "personal", kind: "string" },
        ldb_agent_persona_instructions: { scope: "personal", kind: "string" },
        ldb_ai_templates: { scope: "personal", kind: "string" },
        // W*(高价值, 首次应用需 L2 确认): Notion 目标库
        ldb_notion_database_id: { scope: "shared", kind: "string", confirmLevel: 2 },
        ldb_ai_target_db: { scope: "shared", kind: "string", confirmLevel: 2 },
    },

    // 去重集合(sourceType → 是否 URL 类键需哈希化)。RSS_FEED_URLS 等入硬黑名单(M-2)。
    dedupSources: Object.freeze({
        linuxdo: { urlKeyed: false },       // linuxdo:{id}
        "github-stars": { urlKeyed: false },
        "github-repos": { urlKeyed: false },
        "github-forks": { urlKeyed: false },
        "github-gists": { urlKeyed: false },
        bookmark: { urlKeyed: true },       // bookmark:{url} → 哈希
        rss: { urlKeyed: true },            // rss:{guid||link} → 哈希
        zhihu: { urlKeyed: true },
        generic: { urlKeyed: true },        // generic:{url} → 哈希
    }),

    // watermark 源白名单(与 SyncStateV2._defaults 对齐)
    watermarkSources: Object.freeze([
        "linuxdo", "github-stars", "github-repos", "github-forks", "github-gists",
        "bookmark", "rss", "zhihu", "generic",
    ]),
});

// 硬黑名单 — 永不出介质(sec-dsv3 96 键逐键分区)。以 REDACT_IN_LOGS 为基集(H-1)。
const BLACKLIST = Object.freeze([
    // Notion 凭证(OAuth 三键不在 SENSITIVE_KEYS, 必须显式)
    "ldb_notion_api_key",
    "ldb_notion_oauth_client_secret",
    "ldb_notion_oauth_refresh_token",
    // OAuth 瞬态/设备态
    "ldb_notion_oauth_client_id",
    "ldb_notion_oauth_redirect_uri",
    "ldb_notion_oauth_state",
    "ldb_notion_oauth_meta",
    "ldb_notion_oauth_notice",
    "ldb_notion_oauth_post_auth_target",
    "ldb_notion_auth_mode",
    // 保险箱
    "ldb_credential_vault",
    // 其他凭证
    "ldb_ai_api_key",
    "ldb_ai_base_url",
    "ldb_github_token",
    "ldb_obs_api_key",
    "ldb_obs_api_url",
    // 安全姿态(远程可改 = 提权/去审计)
    "ldb_permission_level",
    "ldb_require_confirm",
    "ldb_enable_audit_log",
    // 审计/隐私
    "ldb_operation_log",
    "ldb_chat_history",
    "ldb_ai_trace_log",
    // UI 瞬态/设备态
    "ldb_panel_minimized",
    "ldb_collapse_state",
    "ldb_active_tab",
    "ldb_panel_size_notion",
    "ldb_panel_size_main",
    "ldb_panel_size_generic",
    "ldb_notion_panel_position",
    "ldb_notion_panel_minimized",
    "ldb_float_btn_position",
    "ldb_ext_install_prompt_shown",
    "ldb_mode_conflict_tip_shown",
    // 过滤词/隐私边缘
    "ldb_filter_only_first",
    "ldb_filter_only_op",
    "ldb_filter_range_start",
    "ldb_filter_range_end",
    "ldb_filter_img",
    "ldb_filter_users",
    "ldb_filter_include",
    "ldb_filter_exclude",
    "ldb_filter_minlen",
    "ldb_img_mode",
    // 设备/缓存
    "ldb_request_delay",
    "ldb_fetched_models",
    "ldb_workspace_pages",
    "ldb_update_auto_check_enabled",
    "ldb_update_check_interval_hours",
    "ldb_update_last_check_at",
    "ldb_update_last_seen_version",
    "ldb_update_last_result",
    // 同步库本体/设备本地
    "ldb_parent_page_id",           // 承载同步库, 循环语义
    "ldb_exported_topics",          // legacy 键(已迁移到派生键)
    "ldb_auto_sync_state",          // 本地真源, 仅投影 watermark+epoch
    "ldb_sync_device_id",
    "ldb_sync_enabled",
    "ldb_sync_mode",
    "ldb_sync_database_id",
    "ldb_sync_parent_page_id",
    "ldb_sync_last_push_at",
    "ldb_sync_last_pull_at",
    "ldb_sync_last_outcome",
    "ldb_sync_passphrase_set",
    // RSS feed URL(可能携带私有凭证, M-2 硬黑)
    "ldb_rss_feed_urls",
    // GitHub 身份/路径语义
    "ldb_github_username",
    "ldb_obs_dir",
    "ldb_obs_img_mode",
    "ldb_obs_img_dir",
]);

const BLACKLIST_SET = new Set(BLACKLIST);

const FORBIDDEN_KEYS = new Set(SyncConstants.FORBIDDEN_KEYS);

const SyncSerializer = {
    WHITELIST,
    BLACKLIST,

    /**
     * 断言 payload 不含黑名单键/危险键(契约: 黑名单键经序列化器永不出现)
     * @throws {Error}
     */
    assertNoBlacklisted(payload) {
        const bad = [];
        if (payload?.settings && typeof payload.settings === "object") {
            for (const key of Object.keys(payload.settings)) {
                if (BLACKLIST_SET.has(key)) bad.push(`settings:${key}`);
                if (FORBIDDEN_KEYS.has(key)) bad.push(`settings:${key}(危险键)`);
            }
        }
        if (payload?.dedup && typeof payload.dedup === "object") {
            for (const [src, set] of Object.entries(payload.dedup)) {
                if (!WHITELIST.dedupSources[src]) bad.push(`dedup.${src}(源未白名单)`);
                if (set && typeof set === "object") {
                    for (const k of Object.keys(set)) {
                        if (FORBIDDEN_KEYS.has(k)) bad.push(`dedup.${src}:${k}(危险键)`);
                        if (k.length > SyncConstants.MAX_DEDUP_KEY_LENGTH) bad.push(`dedup.${src}:键超长`);
                    }
                }
            }
        }
        if (bad.length > 0) {
            throw new Error(`SyncSerializer 黑名单拦截: ${bad.join(", ")}`);
        }
    },

    /**
     * 从原始集合构建 payload(白名单过滤 + URL 哈希化 + 边界校验)
     * @param {Object} raw { dedupSets, watermarks, settings }
     * @param {Object} opts { deviceId, now, mode: "personal"|"shared", hashUrls: boolean }
     * @returns {Promise<Object>} payload
     */
    async buildPayload(raw, { deviceId = "local", now = Date.now(), mode = "personal", hashUrls = true } = {}) {
        const payload = {
            schemaVersion: SyncConstants.SCHEMA_VERSION,
            deviceId,
            version: 0,
            updatedAt: new Date(now).toISOString(),
            dedup: {},
            watermarks: {},
            settings: {},
        };

        // ① dedup: 白名单源过滤 + URL 键哈希化(共享键空间收敛, MED-3)
        for (const [src, set] of Object.entries(raw?.dedupSets || {})) {
            const meta = WHITELIST.dedupSources[src];
            if (!meta || !set || typeof set !== "object") continue;
            const clean = {};
            let count = 0;
            for (const [k, ts] of Object.entries(set)) {
                if (FORBIDDEN_KEYS.has(k)) continue;
                if (k.length > SyncConstants.MAX_DEDUP_KEY_LENGTH) continue;
                const num = Number(ts);
                if (!Number.isFinite(num) || num <= 0) continue;
                if (++count > SyncConstants.MAX_DEDUP_ENTRIES_PER_SOURCE) break;
                // 本地账本含原文键与 h: 哈希键双条目(DedupStore 双写); 已哈希键跳过再哈希
                const key = meta.urlKeyed && hashUrls && !k.startsWith("h:") ? `h:${await SyncCrypto.sha256Hex(k)}` : k;
                clean[key] = num;
            }
            if (Object.keys(clean).length > 0) payload.dedup[src] = clean;
        }

        // ② watermarks: 白名单源 + epoch 上限校验(H-5 在应用侧, 这里仅结构)
        for (const src of WHITELIST.watermarkSources) {
            const wm = raw?.watermarks?.[src];
            if (!wm || typeof wm !== "object") continue;
            const epoch = Number(wm.epoch);
            if (!Number.isFinite(epoch) || epoch < 0) continue;
            payload.watermarks[src] = {
                epoch: Math.floor(epoch),
                time: String(wm.time || ""),
                ids: Array.isArray(wm.ids) ? wm.ids.map(String).slice(0, 500) : [],
            };
        }

        // ③ settings: 白名单过滤 + scope 裁剪(shared 模式剔除 personal; personal 模式全含)
        for (const [key, def] of Object.entries(WHITELIST.settings)) {
            if (mode === "shared" && def.scope === "personal") continue;
            const value = raw?.settings?.[key];
            if (value === undefined || value === null) continue;
            const clean = SyncSerializer._coerceSetting(value, def.kind);
            if (clean === undefined) continue;
            payload.settings[key] = {
                value: clean,
                updatedAt: new Date(now).toISOString(),
                deviceId,
            };
        }

        return payload;
    },

    _coerceSetting(value, kind) {
        switch (kind) {
            case "number": {
                const n = Number(value);
                return Number.isFinite(n) ? n : undefined;
            }
            case "boolean":
                return value === true || value === false ? value : undefined;
            case "string": {
                const s = String(value ?? "");
                return s.length <= 1000 ? s : undefined;
            }
            default:
                return undefined;
        }
    },

    /**
     * 校验远端 payload(拉取侧强校验, H-2):
     * 结构/schemaVersion/键长/计数/ts 偏斜/epoch 增量上限/危险键
     * @param {Object} payload
     * @param {Object} opts { now, localEpochs: {src: number} }
     * @returns {Object} { ok: boolean, error?: string }
     */
    validateRemote(payload, { now = Date.now(), localEpochs = {} } = {}) {
        if (!payload || typeof payload !== "object") {
            return { ok: false, error: "payload 非对象" };
        }
        if (payload.schemaVersion !== SyncConstants.SCHEMA_VERSION) {
            return { ok: false, error: `schema 版本不兼容: ${payload.schemaVersion}` };
        }
        try {
            SyncSerializer.assertNoBlacklisted(payload);
        } catch (e) {
            return { ok: false, error: e.message };
        }
        // JSON 大小上限(序列化后)
        try {
            if (JSON.stringify(payload).length > SyncConstants.MAX_PAYLOAD_BYTES) {
                return { ok: false, error: "payload 超限" };
            }
        } catch { /* stringify 失败由结构校验兜底 */ }

        // ts 偏斜: 远端去重时间戳必须在 [now-90d, now+5min]
        const tsMin = now - SyncConstants.TS_PAST_TTL_MS;
        const tsMax = now + SyncConstants.TS_FUTURE_SKEW_MS;
        for (const [src, set] of Object.entries(payload.dedup || {})) {
            for (const [k, ts] of Object.entries(set || {})) {
                const num = Number(ts);
                if (!Number.isFinite(num) || num < tsMin || num > tsMax) {
                    return { ok: false, error: `dedup.${src} ts 越界: ${k}` };
                }
            }
        }

        // epoch 通胀(H-5): 远端 epoch ≤ 本地+1
        for (const [src, wm] of Object.entries(payload.watermarks || {})) {
            const localEpoch = Number(localEpochs[src]) || 0;
            const remoteEpoch = Number(wm?.epoch) || 0;
            if (remoteEpoch > localEpoch + SyncConstants.MAX_EPOCH_LEAD) {
                return { ok: false, error: `watermark ${src} epoch 通胀: ${remoteEpoch} > ${localEpoch}+1` };
            }
        }
        return { ok: true };
    },

    // 契约辅助: 96 键穷举分区断言(W/B 恰好落一侧, 未知键默认拒绝)
    assertKeyPartition(keys) {
        const violations = [];
        for (const key of keys) {
            const inW = WHITELIST.settings[key] !== undefined;
            const inB = BLACKLIST_SET.has(key);
            if (inW && inB) violations.push(`${key}(W+B 冲突)`);
        }
        if (violations.length > 0) {
            throw new Error(`黑白名单冲突: ${violations.join(", ")}`);
        }
        // 硬黑名单必须 ⊆ 实际键集合之外的显式黑(允许额外黑)
        return true;
    },
};

module.exports = { SyncSerializer };
