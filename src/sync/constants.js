"use strict";

// 多端同步专属常量(F-SYNC-01~12 + 三模型共识)

const SyncConstants = Object.freeze({
    // payload 结构版本: 跨版本混并必须拒绝
    SCHEMA_VERSION: 1,

    // 行 kind 枚举(同步库行模型 { kind, source, key, version, updatedAt, deviceId, payload, checksum })
    ROW_KINDS: Object.freeze(["dedup", "watermark", "settings"]),

    // Notion 同步库行数上限(防恶意介质塞爆, H-3)
    MAX_ROWS: 2000,

    // 分片参数: Notion rich_text 单块 2000 字符、页面 100 块上限(设计假设,保守取值)
    FRAGMENT_CHUNK_CHARS: 2000,
    FRAGMENT_MAX_BLOCKS: 100,
    // 单行保守上限(分片前)
    FRAGMENT_MAX_ROW_CHARS: 40000,

    // payload 大小上限(防恶意介质, sec 共识 H-2)
    MAX_PAYLOAD_BYTES: 200 * 1024,

    // 单键长度上限 / 单源去重键数上限(H-3)
    MAX_DEDUP_KEY_LENGTH: 512,
    MAX_DEDUP_ENTRIES_PER_SOURCE: 100000,

    // ts 偏斜容忍: 远端键时间戳必须在 [now-90d, now+5min](H-2/H-4)
    TS_FUTURE_SKEW_MS: 5 * 60 * 1000,
    TS_PAST_TTL_MS: 90 * 24 * 60 * 60 * 1000,

    // 设置项 LWW 时间戳复用上限: 值未变时复用旧戳, 但复用不得超过此年龄,
    // 否则会落出 TS_PAST_TTL_MS 窗口被 validateRemote 整包拒绝(且永不自愈)
    SETTINGS_STAMP_MAX_REUSE_MS: 45 * 24 * 60 * 60 * 1000,

    // epoch 通胀上限: 远端 epoch ≤ 本地+1(H-5)
    MAX_EPOCH_LEAD: 1,

    // 危险键: 原型链污染(H-3)
    FORBIDDEN_KEYS: Object.freeze(["__proto__", "constructor", "prototype"]),

    // 同步自限速率: 共享 3 req/s 桶,同步路径自限 ≤2/s(F-SYNC-04)
    RATE_CAPACITY: 3,
    RATE_REFILL_PER_SEC: 1,
    SYNC_SELF_LIMIT_PER_SEC: 2,

    // 防抖窗口 / 退避(5xx 指数退避 1000*2^n, cap 30s)
    DEBOUNCE_MS: 5000,
    BACKOFF_BASE_MS: 1000,
    BACKOFF_CAP_MS: 30000,
});

module.exports = { SyncConstants };
