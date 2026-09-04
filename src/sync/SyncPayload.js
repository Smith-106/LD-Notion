"use strict";

const { SyncConstants } = require("./constants");

// 数据类型工具(纯函数)
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const clone = (v) => {
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
};

// watermark 比较: (epoch, time) 字典序全序; epoch 大者整段胜出(F-SYNC-02)
const watermarkCompare = (a, b) => {
    const ea = Number(a?.epoch) || 0;
    const eb = Number(b?.epoch) || 0;
    if (ea !== eb) return ea > eb ? 1 : -1;
    const ta = String(a?.time || "");
    const tb = String(b?.time || "");
    if (ta !== tb) return ta > tb ? 1 : -1;
    return 0;
};

/**
 * SyncPayload — 多端同步数据模型 + 纯函数 merge(join-semilattice)
 * 结构:
 * {
 *   schemaVersion: 1,
 *   deviceId: "…",
 *   version: 1,          // 单调递增版本号(信息性)
 *   updatedAt: "ISO",    // 单调(信息性)
 *   dedup: { "<sourceType>": { "<key>": tsMs } },   // union + max ts
 *   watermarks: { "<sourceType>": { epoch, time, ids } }, // (epoch,time) max, 平局 ids 并集
 *   settings: { "<key>": { value, updatedAt, deviceId } }, // 字段级 LWW
 * }
 */
const SyncPayload = {
    isEmpty(payload) {
        if (!isPlainObject(payload)) return true;
        const { dedup, watermarks, settings } = payload;
        const isEmptyMap = (m) => !isPlainObject(m) || Object.keys(m).length === 0;
        return isEmptyMap(dedup) && isEmptyMap(watermarks) && isEmptyMap(settings);
    },

    /**
     * merge(a, b) — join-semilattice:
     * ① dedup: per-source {key: max(tsA, tsB)} (union + max)
     * ② watermarks: 单边缺失取存在侧; epoch 大者整段胜出; 相等比 time; 同刻 ids 并集
     * ③ settings: 字段级 LWW — updatedAt 决胜, deviceId 字典序平局
     * 交换/结合/幂等: 全序 max + 平局确定性 → 任意乱序收敛同一固定点
     * @throws {Error} schema 不匹配
     */
    merge(a, b) {
        if (!isPlainObject(a)) return clone(b || {});
        if (!isPlainObject(b)) return clone(a);
        if (a.schemaVersion !== b.schemaVersion) {
            throw new Error(`SyncPayload schema 不匹配: ${a.schemaVersion} vs ${b.schemaVersion}`);
        }

        const out = {
            schemaVersion: a.schemaVersion,
            deviceId: (a.updatedAt || "") >= (b.updatedAt || "") ? a.deviceId : b.deviceId,
            version: Math.max(Number(a.version) || 0, Number(b.version) || 0),
            updatedAt: (a.updatedAt || "") >= (b.updatedAt || "") ? a.updatedAt : b.updatedAt,
            dedup: {},
            watermarks: {},
            settings: {},
        };

        // ① dedup: union + max ts
        const dedupSources = new Set([...Object.keys(a.dedup || {}), ...Object.keys(b.dedup || {})]);
        for (const src of dedupSources) {
            const A = a.dedup[src] || {};
            const B = b.dedup[src] || {};
            const merged = {};
            const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
            for (const k of keys) {
                merged[k] = Math.max(Number(A[k]) || 0, Number(B[k]) || 0);
            }
            out.dedup[src] = merged;
        }

        // ② watermarks: (epoch, time) 全序 max, 平局 ids 并集
        const wmSources = new Set([...Object.keys(a.watermarks || {}), ...Object.keys(b.watermarks || {})]);
        for (const src of wmSources) {
            const A = a.watermarks[src];
            const B = b.watermarks[src];
            if (!isPlainObject(A)) { out.watermarks[src] = clone(B); continue; }
            if (!isPlainObject(B)) { out.watermarks[src] = clone(A); continue; }
            const cmp = watermarkCompare(A, B);
            if (cmp !== 0) {
                out.watermarks[src] = clone(cmp > 0 ? A : B);
            } else {
                out.watermarks[src] = {
                    epoch: Math.max(Number(A.epoch) || 0, Number(B.epoch) || 0),
                    time: (A.time || "") >= (B.time || "") ? A.time : B.time,
                    ids: Array.from(new Set([...(A.ids || []), ...(B.ids || [])])),
                };
            }
        }

        // ③ settings: (updatedAt, deviceId) 全序 LWW
        const settingKeys = new Set([...Object.keys(a.settings || {}), ...Object.keys(b.settings || {})]);
        for (const k of settingKeys) {
            const A = a.settings[k];
            const B = b.settings[k];
            if (!isPlainObject(A)) { out.settings[k] = clone(B); continue; }
            if (!isPlainObject(B)) { out.settings[k] = clone(A); continue; }
            const cmp = (A.updatedAt || "") === (B.updatedAt || "")
                ? String(A.deviceId || "").localeCompare(String(B.deviceId || ""))
                : ((A.updatedAt || "") > (B.updatedAt || "") ? 1 : -1);
            out.settings[k] = clone(cmp >= 0 ? A : B);
        }

        return out;
    },

    /**
     * buildFromLocal — 从本地去重账本 + watermark + 设置构建 payload
     * @param {Object} deps { deviceId, now, dedupSets: {src: {key:ts}}, watermarks: {src: {epoch,time,ids}}, settings: {key: {value,updatedAt}} }
     */
    buildFromLocal({ deviceId = "local", now = Date.now(), dedupSets = {}, watermarks = {}, settings = {} }) {
        const payload = {
            schemaVersion: SyncConstants.SCHEMA_VERSION,
            deviceId,
            version: 0,
            updatedAt: new Date(now).toISOString(),
            dedup: {},
            watermarks: {},
            settings: {},
        };
        for (const [src, set] of Object.entries(dedupSets)) {
            if (!isPlainObject(set)) continue;
            const clean = {};
            for (const [k, ts] of Object.entries(set)) {
                const num = Number(ts);
                if (Number.isFinite(num) && num > 0) clean[k] = num;
            }
            if (Object.keys(clean).length > 0) payload.dedup[src] = clean;
        }
        for (const [src, wm] of Object.entries(watermarks)) {
            if (isPlainObject(wm) && (wm.time || wm.epoch)) {
                payload.watermarks[src] = {
                    epoch: Math.max(0, Math.floor(Number(wm.epoch) || 0)),
                    time: wm.time || "",
                    ids: Array.isArray(wm.ids) ? wm.ids.map(String) : [],
                };
            }
        }
        for (const [k, entry] of Object.entries(settings)) {
            if (isPlainObject(entry)) {
                payload.settings[k] = {
                    value: entry.value,
                    updatedAt: entry.updatedAt || new Date(now).toISOString(),
                    deviceId,
                };
            }
        }
        return payload;
    },

    /**
     * diffWinners — 计算本地需应用的胜出项(纯函数,不触碰存储)
     * @returns {{ dedupEntries: [{source,key,ts}], watermarkWinners: [{source, watermark}], settingsWinners: [{key, entry}] }}
     */
    diffWinners(local, remote) {
        const localSafe = isPlainObject(local) ? local : {};
        const remoteSafe = isPlainObject(remote) ? remote : {};
        const dedupEntries = [];
        const watermarkWinners = [];
        const settingsWinners = [];

        for (const [src, remoteSet] of Object.entries(remoteSafe.dedup || {})) {
            if (!isPlainObject(remoteSet)) continue;
            const localSet = localSafe.dedup?.[src] || {};
            for (const [k, ts] of Object.entries(remoteSet)) {
                const num = Number(ts);
                if (!Number.isFinite(num) || num <= 0) continue;
                if ((Number(localSet[k]) || 0) < num) {
                    dedupEntries.push({ source: src, key: k, ts: num });
                }
            }
        }

        for (const [src, remoteWm] of Object.entries(remoteSafe.watermarks || {})) {
            if (!isPlainObject(remoteWm)) continue;
            const localWm = localSafe.watermarks?.[src];
            if (!isPlainObject(localWm) || watermarkCompare(remoteWm, localWm) > 0) {
                watermarkWinners.push({ source: src, watermark: clone(remoteWm) });
            }
        }

        for (const [k, remoteEntry] of Object.entries(remoteSafe.settings || {})) {
            if (!isPlainObject(remoteEntry)) continue;
            const localEntry = localSafe.settings?.[k];
            if (!isPlainObject(localEntry)) {
                settingsWinners.push({ key: k, entry: clone(remoteEntry) });
                continue;
            }
            const cmp = (remoteEntry.updatedAt || "") === (localEntry.updatedAt || "")
                ? String(remoteEntry.deviceId || "").localeCompare(String(localEntry.deviceId || ""))
                : ((remoteEntry.updatedAt || "") > (localEntry.updatedAt || "") ? 1 : -1);
            if (cmp > 0) settingsWinners.push({ key: k, entry: clone(remoteEntry) });
        }

        return { dedupEntries, watermarkWinners, settingsWinners };
    },
};

module.exports = { SyncPayload };
