"use strict";

// SyncEngine — 多端同步调度编排(local-first: GM 存储为源, 同步只是投影)
// 流程: buildPayload(local) → push(全量行, 幂等 merge 语义) → pull(远端行)
//   → validateRemote(H-2/H-5) → merge → diffWinners → applyRemote(仅胜出项)
// 依赖注入(解耦测试): 全部经 deps 传入。
// Guard: push 走 execute("sync.state.push"), pull 走 canExecute 非阻塞 + guard.denied
//   (HIGH-1 已 P0 静态注册; 自动路径不弹 dialog)。

const { SyncConstants } = require("./constants");
const { SyncPayload } = require("./SyncPayload");
const { SyncSerializer } = require("./SyncSerializer");
const { SyncLedger } = require("./SyncLedger");
const { SyncConfig } = require("./SyncConfig");
const { SyncRateLimiter } = require("./SyncRateLimiter");
const { SyncCrypto } = require("./SyncCrypto");

const SyncEngine = {
    _deps: null,
    _timer: null,
    _pushTimer: null,
    _running: false,

    /**
     * 初始化(仅 flag on 且 SyncConfig.isEnabled() 时由 main.js 调用)
     * @param {Object} deps { Storage, SyncStateV2, DedupStore, NotionAPI, OperationGuard, OperationLog, apiKeyProvider }
     */
    init(deps) {
        SyncEngine._deps = deps;
        const { on } = require("../coordination/event-bus");
        // 本地状态变更 → 防抖 push
        on("storage:state-committed", (e) => {
            if (SyncEngine._pushTimer) clearTimeout(SyncEngine._pushTimer);
            SyncEngine._pushTimer = setTimeout(() => {
                SyncEngine.push({ reason: "state-committed" });
            }, SyncConstants.DEBOUNCE_MS);
        });
    },

    _getDeps() {
        if (!SyncEngine._deps) throw new Error("SyncEngine 未初始化");
        return SyncEngine._deps;
    },

    /**
     * 收集本地状态 → payload(Serializer 过滤+哈希化)
     */
    async _buildLocalPayload() {
        const { Storage, SyncStateV2, DedupStore, OperationGuard } = SyncEngine._getDeps();
        const deviceId = SyncConfig.getDeviceId();
        const mode = SyncConfig.getMode();

        // 去重集合(单一账本命名空间)
        const dedupSets = {};
        for (const src of Object.keys(SyncSerializer.WHITELIST.dedupSources)) {
            dedupSets[src] = DedupStore.getSeen(src) || {};
        }

        // watermark + epoch
        const watermarks = {};
        for (const src of SyncSerializer.WHITELIST.watermarkSources) {
            const st = SyncStateV2.getSourceState(src);
            if (st.watermark?.time) {
                watermarks[src] = { epoch: st.epoch || 0, time: st.watermark.time, ids: st.watermark.ids || [] };
            }
        }

        // settings(白名单键按存储键值从 Storage 读)
        const settings = {};
        for (const key of Object.keys(SyncSerializer.WHITELIST.settings)) {
            const value = Storage.get(key, undefined);
            if (value !== undefined && value !== null) settings[key] = value;
        }

        const payload = await SyncSerializer.buildPayload(
            { dedupSets, watermarks, settings },
            { deviceId, now: Date.now(), mode, hashUrls: true }
        );
        SyncSerializer.assertNoBlacklisted(payload);
        return payload;
    },

    /**
     * push: 本地 payload 全量投影到介质(每源一行; 幂等 upsert)
     * @returns {Promise<{ok: boolean, outcome: string, error?: string}>}
     */
    async push({ reason = "manual" } = {}) {
        if (SyncEngine._running) return { ok: false, outcome: "busy" };
        const { OperationGuard, OperationLog, NotionAPI } = SyncEngine._getDeps();
        if (!OperationGuard.canExecute("sync.state.push")) {
            OperationLog.add({
                audit_event: "guard.denied", actor: "system", source: "sync-engine",
                guard: { operation: "sync.state.push", decision: "deny", reason: "权限不足: 多端同步推送需 level≥1" },
                operationName: "sync.state.push", status: "denied",
                context: { reason },
            }, { force: true }); // M-4: 审计关闭时 guard.denied 仍可见
            SyncConfig.setLastOutcome("denied");
            return { ok: false, outcome: "denied" };
        }

        SyncEngine._running = true;
        try {
            const payload = await SyncEngine._buildLocalPayload();
            const apiKey = SyncEngine._getApiKey();
            const databaseId = SyncConfig.getDatabaseId();
            if (!databaseId || !apiKey) {
                SyncConfig.setLastOutcome("not-configured");
                return { ok: false, outcome: "not-configured" };
            }
            const { OperationGuard: Guard } = SyncEngine._getDeps();
            await Guard.execute("sync.state.push", async () => {
                // 行模型: 每源一行(dedup+watermark 合并), settings 一行
                // payload 保持完整嵌套结构 { dedup: {src: {key:ts}}, watermarks: {src: …}, settings: {…} },
                // 保证 pull 侧 merge 到同一键空间(diffWinners 按 sourceType 查本地账本)。
                const rows = [];
                for (const [src, set] of Object.entries(payload.dedup)) {
                    rows.push({
                        kind: "dedup",
                        key: src,
                        version: payload.version || 0,
                        updatedAt: payload.updatedAt,
                        deviceId: payload.deviceId,
                        payload: {
                            dedup: { [src]: set },
                            watermarks: payload.watermarks[src] ? { [src]: payload.watermarks[src] } : undefined,
                        },
                    });
                }
                for (const [src] of Object.entries(payload.watermarks)) {
                    if (!payload.dedup[src]) {
                        rows.push({
                            kind: "watermark",
                            key: src,
                            version: payload.version || 0,
                            updatedAt: payload.updatedAt,
                            deviceId: payload.deviceId,
                            payload: { watermarks: { [src]: payload.watermarks[src] } },
                        });
                    }
                }
                rows.push({
                    kind: "settings",
                    key: "settings",
                    version: payload.version || 0,
                    updatedAt: payload.updatedAt,
                    deviceId: payload.deviceId,
                    payload: { settings: payload.settings },
                });

                // 拉取现有行(按 kind:key 索引)
                const existing = await SyncLedger.pullRows({ NotionAPI, apiKey, databaseId, context: { reason } });
                const index = new Map();
                for (const row of existing) {
                    const parsed = SyncLedger.pageToRow(row);
                    if (parsed) index.set(`${parsed.kind}:${parsed.key}`, parsed);
                }

                for (const row of rows) {
                    const id = `${row.kind}:${row.key}`;
                    const prior = index.get(id);
                    if (prior && prior.pageId) {
                        await SyncLedger.pushRow({ NotionAPI, apiKey, databaseId, pageId: prior.pageId, row, context: { reason } });
                    } else {
                        await SyncLedger.createRow({ NotionAPI, apiKey, databaseId, row, context: { reason } });
                    }
                }
            }, { trigger: "multi_device_sync", reason });
            SyncConfig.setLastPushAt(Date.now());
            SyncConfig.setLastOutcome("success");
            return { ok: true, outcome: "success" };
        } catch (error) {
            SyncConfig.setLastOutcome(`error:${String(error?.message || error).slice(0, 200)}`);
            return { ok: false, outcome: "error", error: String(error?.message || error) };
        } finally {
            SyncEngine._running = false;
        }
    },

    _getApiKey() {
        // 测试/扩展可注入 apiKeyProvider; 默认回退 NotionOAuth(manual key/OAuth token)
        const deps = SyncEngine._getDeps();
        if (typeof deps.apiKeyProvider === "function") {
            const v = deps.apiKeyProvider();
            if (v) return v;
        }
        try {
            const { NotionOAuth } = require("../auth");
            return NotionOAuth?.getAccessToken?.() || "";
        } catch {
            return "";
        }
    },

    /**
     * pull: 拉远端行 → 校验 → merge → applyRemote(仅胜出项)
     * @returns {Promise<{ok: boolean, outcome: string, applied: Object, error?: string}>}
     */
    async pull({ reason = "manual" } = {}) {
        if (SyncEngine._running) return { ok: false, outcome: "busy" };
        // 全盘审计修复(find 6): 运行期禁用后仍拉取并 applyRemote(写去重/watermark/settings),
        // 违反用户禁用意图; 此处纵深防御(周期 loop 侧已停, 手动/防抖侧兜底)
        if (!SyncConfig.isEnabled()) return { ok: false, outcome: "disabled" };
        const { OperationGuard, OperationLog, NotionAPI, SyncStateV2, DedupStore } = SyncEngine._getDeps();
        // pull 是只读(L0), canExecute 非阻塞; denied 仍审计(M-4 force)
        if (!OperationGuard.canExecute("sync.state.pull")) {
            OperationLog.add({
                audit_event: "guard.denied", actor: "system", source: "sync-engine",
                guard: { operation: "sync.state.pull", decision: "deny", reason: "权限不足: 拉取需 level≥0" },
                operationName: "sync.state.pull", status: "denied", context: { reason },
            }, { force: true });
            SyncConfig.setLastOutcome("denied");
            return { ok: false, outcome: "denied" };
        }

        SyncEngine._running = true;
        try {
            const apiKey = SyncEngine._getApiKey();
            const databaseId = SyncConfig.getDatabaseId();
            if (!databaseId || !apiKey) {
                SyncConfig.setLastOutcome("not-configured");
                return { ok: false, outcome: "not-configured" };
            }

            const rows = await SyncLedger.pullRows({ NotionAPI, apiKey, databaseId, context: { reason } });
            // 行 → payload union(同 kind:key 去重, version 大者胜)
            let mergedRemote = { schemaVersion: SyncConstants.SCHEMA_VERSION, deviceId: "", updatedAt: "", version: 0, dedup: {}, watermarks: {}, settings: {} };
            let validRows = 0;
            for (const page of rows) {
                const row = SyncLedger.pageToRow(page);
                if (!row || !row.payload || typeof row.payload !== "object") continue;
                validRows++;
                const rowPayload = { schemaVersion: 1, deviceId: row.deviceId || "", updatedAt: row.updatedAt || "", version: row.version || 0, ...row.payload };
                try {
                    mergedRemote = SyncPayload.merge(mergedRemote, rowPayload);
                } catch { /* 版本不匹配行跳过 */ }
            }
            if (validRows === 0) {
                SyncConfig.setLastPullAt(Date.now());
                SyncConfig.setLastOutcome("empty");
                return { ok: true, outcome: "empty", applied: { dedupEntries: [], watermarkWinners: [], settingsWinners: [] } };
            }

            // H-2 校验
            const localEpochs = {};
            for (const src of SyncSerializer.WHITELIST.watermarkSources) {
                localEpochs[src] = SyncStateV2.getSourceState(src).epoch || 0;
            }
            const validation = SyncSerializer.validateRemote(mergedRemote, { now: Date.now(), localEpochs });
            if (!validation.ok) {
                OperationLog.add({
                    audit_event: "sync.state.pulled", actor: "system", source: "sync-engine",
                    operationName: "sync.state.pull", status: "failed",
                    context: { reason, error: validation.error },
                }, { force: true });
                SyncConfig.setLastOutcome(`rejected:${validation.error}`);
                return { ok: false, outcome: "rejected", error: validation.error };
            }

            // 本地 payload
            const localPayload = await SyncEngine._buildLocalPayload();
            const merged = SyncPayload.merge(localPayload, mergedRemote);
            const winners = SyncPayload.diffWinners(localPayload, mergedRemote);

            // applyRemote(仅胜出项, 绝不全量覆盖)
            const applied = SyncEngine.applyRemote(winners, { SyncStateV2, DedupStore });
            SyncConfig.setLastPullAt(Date.now());
            SyncConfig.setLastOutcome(`success(applied:${applied.dedupEntries.length}/${applied.watermarkWinners.length}/${applied.settingsWinners.length})`);
            return { ok: true, outcome: "success", applied };
        } catch (error) {
            SyncConfig.setLastOutcome(`error:${String(error?.message || error).slice(0, 200)}`);
            return { ok: false, outcome: "error", error: String(error?.message || error) };
        } finally {
            SyncEngine._running = false;
        }
    },

    /**
     * applyRemote — 仅写 diffWinners 胜出项(去重 union 写回 + watermark 应用 + settings 应用)
     */
    applyRemote(winners, { SyncStateV2, DedupStore } = {}) {
        const deps = SyncEngine._getDeps();
        const State = SyncStateV2 || deps.SyncStateV2;
        const Dedup = DedupStore || deps.DedupStore;

        // ① dedup 胜出项 → 写回对应源集合(取 max, 保留本地已有)
        for (const entry of winners.dedupEntries || []) {
            Dedup.markSeen(entry.source, entry.key);
        }

        // ② watermark 胜出项(epoch 校验在 validateRemote 已做; 应用时再防一次)
        for (const { source, watermark } of winners.watermarkWinners || []) {
            const local = State.getSourceState(source);
            const localEpoch = Number(local.epoch) || 0;
            const remoteEpoch = Number(watermark.epoch) || 0;
            if (remoteEpoch > localEpoch + SyncConstants.MAX_EPOCH_LEAD) continue;
            State.updateSourceState(source, {
                watermark: { time: watermark.time, ids: watermark.ids || [] },
                epoch: Math.max(localEpoch, remoteEpoch),
                lastOutcome: "success",
            });
        }

        // ③ settings 胜出项(高价值键 L2 确认, H-4: 首次应用需 confirmLevel)
        const { Storage, OperationGuard } = deps;
        for (const { key, entry } of winners.settingsWinners || []) {
            const def = SyncSerializer.WHITELIST.settings[key];
            if (!def) continue;
            // 全盘审计修复(find 9): 此前闸门用 canExecute("updatePage")(level 1), 与
            // confirmLevel=2 声明不符 → 标准权限设备可被远端改写数据库配置。现按声明级别校验。
            if (def.confirmLevel && OperationGuard.getLevel() < def.confirmLevel) {
                continue; // 权限不足不应用高价值键(记审计由调用方)
            }
            const coerce = SyncSerializer._coerceSetting(entry.value, def.kind);
            if (coerce === undefined) continue;
            Storage.set(key, coerce);
        }

        // TTL 淘汰已由 DedupStore._saveSet 统一落盘(单点/批末双路径, 全盘审计修复:
        // 此前此处只改内存副本不写回 → 90 天记录永存 + 旧 ts 随 push 出介质致对端校验拒绝)

        return {
            dedupEntries: (winners.dedupEntries || []).length,
            watermarkWinners: (winners.watermarkWinners || []).length,
            settingsWinners: (winners.settingsWinners || []).length,
        };
    },

    /**
     * syncOnce: push + pull(顺序, 避免自触发)
     */
    async syncOnce({ reason = "manual" } = {}) {
        const pushResult = await SyncEngine.push({ reason });
        const pullResult = await SyncEngine.pull({ reason });
        return { push: pushResult, pull: pullResult };
    },

    /**
     * resetRemote: 清空介质(危险操作 L3 + 确认)
     */
    async resetRemote({ confirm = false } = {}) {
        if (!confirm) return { ok: false, outcome: "need-confirm" };
        const { OperationGuard, OperationLog, NotionAPI } = SyncEngine._getDeps();
        return OperationGuard.execute("sync.medium.reset", async () => {
            const apiKey = SyncEngine._getApiKey();
            const databaseId = SyncConfig.getDatabaseId();
            if (databaseId) {
                await NotionAPI.deletePage(databaseId, apiKey).catch(() => {});
            }
            SyncConfig.setDatabaseId("");
            SyncConfig.setLastOutcome("reset");
            return { ok: true, outcome: "reset" };
        }, { trigger: "multi_device_sync", actor: "user" });
    },

    getStatus() {
        return {
            enabled: SyncConfig.isEnabled(),
            mode: SyncConfig.getMode(),
            deviceId: SyncConfig.getDeviceId(),
            databaseId: SyncConfig.getDatabaseId(),
            lastPushAt: SyncConfig.getLastPushAt(),
            lastPullAt: SyncConfig.getLastPullAt(),
            lastOutcome: SyncConfig.getLastOutcome(),
        };
    },
};

module.exports = { SyncEngine };
