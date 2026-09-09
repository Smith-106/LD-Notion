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

        // settings(白名单键按存储键值从 Storage 读) + 每键 LWW 时间戳(值未变则复用)
        const settings = {};
        for (const key of Object.keys(SyncSerializer.WHITELIST.settings)) {
            const value = Storage.get(key, undefined);
            if (value !== undefined && value !== null) settings[key] = value;
        }

        const nextStamps = {};
        const payload = await SyncSerializer.buildPayload(
            { dedupSets, watermarks, settings, settingsStamps: SyncStateV2.getSettingsStamps() },
            { deviceId, now: Date.now(), mode, hashUrls: true, stampsOut: nextStamps }
        );
        // 推送失败也不回滚时间戳: 值未变时下轮仍复用同一时间戳(语义等价)
        SyncStateV2.setSettingsStamps(nextStamps);
        SyncSerializer.assertNoBlacklisted(payload);
        return payload;
    },

    /**
     * push: 本地 payload 全量投影到介质(每源一行; 幂等 upsert)
     * @returns {Promise<{ok: boolean, outcome: string, error?: string}>}
     */
    async push({ reason = "manual" } = {}) {
        if (SyncEngine._running) return { ok: false, outcome: "busy" };
        // 2/3 共识(glm+qwen): push 缺运行期禁用闸门 —— 防抖回调(状态提交 5s 后)可能落在
        // 用户禁用同步之后, 仍把本地状态写入介质(与 pull 的禁用防御不对称)。
        if (!SyncConfig.isEnabled()) return { ok: false, outcome: "disabled" };
        const { OperationGuard, OperationLog, NotionAPI } = SyncEngine._getDeps();
        if (!OperationGuard.canExecute("sync.state.push")) {
            // v3.14.6 (XN-06): 统一构造器(phase=precheck, force 保审计可见)
            OperationGuard.auditDenied("sync.state.push", {
                reason, actor: "system", source: "sync-engine", trigger: "multi_device_sync",
            }, { phase: "precheck", reason: "权限不足: 多端同步推送需 level≥1", force: true });
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
                // v3.14.4 修复: SyncLedger 单行 payload 硬限 2000 字符(Notion rich_text 上限, v1 不做多行分片),
                // 单源条目过多时按 ts 降序保留最新条目截断, 防止 push 抛错“行 payload 过大”;
                // 截断仅影响同步介质投影, 本地账本完整保留(容量上限 10000 兜底)。
                const rows = [];
                for (const [src, set] of Object.entries(payload.dedup)) {
                    rows.push({
                        kind: "dedup",
                        key: src,
                        version: payload.version || 0,
                        updatedAt: payload.updatedAt,
                        deviceId: payload.deviceId,
                        payload: {
                            dedup: { [src]: SyncEngine._truncateSetForRow(src, set) },
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

                // v3.14.6 (DC-003): 行预算逐级截断 —— watermark ids/settings 行此前无预算,
                // 超 SyncLedger 2000 硬限整行失败; 现在构造后量长, 超限逐级裁剪
                const budgetedRows = SyncEngine._enforceRowBudget(rows);
                for (const row of budgetedRows) {
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
     * v3.14.4: 单源 dedup set 截断以适配 SyncLedger 单行 2000 字符硬限。
     * 按 ts 降序保留最新条目; 触发截断时记审计事件。返回新对象(不 mutate 输入)。
     */
    _truncateSetForRow(src, set, budgetChars = 1900) {
        const probe = JSON.stringify(set || {});
        if (probe === undefined || probe.length <= budgetChars) return set;
        const entries = Object.entries(set || {});
        entries.sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0));
        const picked = {};
        let size = 2; // "{}"
        let kept = 0;
        for (const [k, ts] of entries) {
            const inc = (kept > 0 ? 1 : 0) + JSON.stringify(k).length + 1 + String(Number(ts)).length;
            if (size + inc > budgetChars) break;
            picked[k] = Number(ts);
            size += inc;
            kept++;
        }
        try {
            const { OperationLog } = SyncEngine._getDeps();
            OperationLog.add({
                audit_event: "sync.row.truncated", actor: "system", source: "sync-engine",
                operationName: "sync.state.push", status: "success",
                context: { source: src, total: entries.length, kept, reason: "row payload 2000 char hard limit" },
            }, { force: true });
        } catch { /* 审计不可用不阻断 push */ }
        return picked;
    },

    /**
     * v3.14.6 (DC-003): 行预算逐级截断 —— 构造后量长, 超限逐级:
     * ① dedup 集按剩余预算(剔除 watermark 开销)进一步 ts 降序截断;
     * ② watermark ids 稳定序截断 + 审计;
     * ③ settings 按字段分片行(≤8 片, 每片 ≤1900)。
     * 返回新行数组(可能含拆分出的 settings 分片行)。
     */
    _enforceRowBudget(rows, budgetChars = 1900) {
        const out = [];
        for (const row of rows) {
            const raw = JSON.stringify(row.payload || {});
            if (raw.length <= budgetChars) {
                out.push(row);
                continue;
            }
            // ① dedup 集进一步按剩余预算截断(watermark 开销已占用预算)
            if (row.payload && row.payload.dedup) {
                const src = Object.keys(row.payload.dedup)[0];
                // glm P2 共识: 包装开销必须实测(旧常量 11 低估了 {"dedup":{"<src>":…}}
                // 与 ,"watermarks": 的真实开销 → 截断后行仍可超 1900, 无 ids 可截时
                // 整行被 SyncLedger 拒绝导致整个 push 失败。
                const overhead = JSON.stringify({
                    dedup: { [src]: {} },
                    watermarks: row.payload.watermarks || {},
                }).length;
                const remain = budgetChars - overhead;
                if (remain > 50) {
                    row.payload.dedup = { [src]: SyncEngine._truncateSetForRow(src, row.payload.dedup[src], remain) };
                }
            }
            // ② watermark ids 稳定序截断 + 审计(保留前缀, 确定性)
            if (JSON.stringify(row.payload || {}).length > budgetChars && row.payload && row.payload.watermarks) {
                for (const [src, wm] of Object.entries(row.payload.watermarks)) {
                    if (!Array.isArray(wm.ids) || wm.ids.length === 0) continue;
                    const before = wm.ids.length;
                    const base = JSON.stringify({ ...row.payload, watermarks: { [src]: { ...wm, ids: [] } } }).length;
                    let kept = 0;
                    const picked = [];
                    let size = base;
                    for (const id of wm.ids) {
                        const inc = (kept > 0 ? 1 : 0) + JSON.stringify(id).length;
                        if (size + inc > budgetChars) break;
                        picked.push(id);
                        size += inc;
                        kept++;
                    }
                    wm.ids = picked;
                    if (kept < before) {
                        try {
                            const { OperationLog } = SyncEngine._getDeps();
                            OperationLog.add({
                                audit_event: "sync.row.ids.truncated", actor: "system", source: "sync-engine",
                                operationName: "sync.state.push", status: "success",
                                context: { source: src, total: before, kept, reason: "watermark ids row budget" },
                            }, { force: true });
                        } catch { /* 审计不可用不阻断 push */ }
                    }
                }
            }
            // ③ settings 按字段分片(≤8 片, 每片 ≤1900; 单字段超限交由 SyncLedger 显式拒绝)
            if (JSON.stringify(row.payload || {}).length > budgetChars && row.payload && row.payload.settings) {
                const shards = SyncEngine._splitSettingsRow(row, budgetChars);
                if (shards.length > 0) {
                    out.push(...shards);
                    continue;
                }
            }
            out.push(row);
        }
        return out;
    },

    /**
     * v3.14.6 (DC-003) + P2 共识(2/3 dsf+glm): settings 行按字段拆分 —— 字段级 LWW 语义下
     * 拆行不影响 pull 侧 merge(SyncPayload.merge 按 key 并集), 每片 ≤ budgetChars。
     * 分片键必须与字段绑定(而非位置序号): 位置序号会让各端因值大小差异产生不同分片边界
     * 互相覆盖(字段从介质丢失后默认值回灌), 且分片数缩减后残留的高位行永不删除。
     * 现按字段名哈希稳定分桶(settings#<0-7>), 同一字段在任何设备都落入同一行;
     * 桶超预算时桶内再切子片(settings#<b>-<n>); 总片数仍封顶 8(超出并入末片)。
     */
    _splitSettingsRow(row, budgetChars = 1900) {
        const entries = Object.entries(row.payload.settings || {});
        if (entries.length <= 1) return []; // 单字段无法拆(超限交 SyncLedger 显式拒绝)
        const buckets = new Map();
        for (const [k, v] of entries) {
            const b = SyncEngine._settingsBucket(k);
            if (!buckets.has(b)) buckets.set(b, {});
            buckets.get(b)[k] = v;
        }
        const shards = [];
        const makeShard = (key, fields) => ({
            kind: "settings",
            key,
            version: row.version || 0,
            updatedAt: row.updatedAt || "",
            deviceId: row.deviceId || "",
            payload: { settings: fields },
        });
        for (const b of [...buckets.keys()].sort((x, y) => x - y)) {
            const fields = buckets.get(b);
            let cur = {};
            let sub = 0;
            const flush = () => {
                if (Object.keys(cur).length === 0) return;
                shards.push(makeShard(sub === 0 ? `settings#${b}` : `settings#${b}-${sub}`, cur));
                cur = {};
            };
            for (const [k, v] of Object.entries(fields)) {
                const inc = JSON.stringify({ settings: { ...cur, [k]: v } }).length;
                if (inc > budgetChars && Object.keys(cur).length > 0) {
                    flush();
                    sub++;
                }
                cur[k] = v;
            }
            flush();
        }
        // 总片数封顶 8: 溢出片并入末片(单行可超预算, 由 SyncLedger 显式拒绝, 不静默截断)
        if (shards.length > 8) {
            const overflow = shards.splice(8);
            const target = shards[7].payload.settings;
            for (const s of overflow) Object.assign(target, s.payload.settings);
        }
        return shards;
    },

    // 字段名 → 稳定桶号(FNV-1a 32bit % 8), 仅用于行分片, 与安全无关
    _settingsBucket(key) {
        let h = 0x811c9dc5;
        const s = String(key);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h % 8;
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
            // v3.14.6 (XN-06): 统一构造器(phase=precheck)
            OperationGuard.auditDenied("sync.state.pull", {
                reason, actor: "system", source: "sync-engine",
            }, { phase: "precheck", reason: "权限不足: 拉取需 level≥0", force: true });
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
            // v3.14.6 (DC-008): 传远端 ts 保留 TTL 起点(此前默认 now 使远端条目标记"新鲜")
            Dedup.markSeen(entry.source, entry.key, entry.ts);
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
                // dsf P2 共识: deletePage 走 PATCH /pages/<id>(数据库 id 必 400)且失败被吞后
                // 仍清空本地 databaseId → 用户以为已清空而介质残留。改为归档数据库并向上抛错,
                // 仅在成功后清本地引用。
                await NotionAPI.request("PATCH", `/databases/${databaseId}`, { archived: true }, apiKey);
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
