"use strict";

const { AdapterRegistry } = require("./AdapterRegistry");
const { SyncStateV2 } = require("../storage/SyncState");
const { DedupStore } = require("../storage/DedupStore");

// 适配器注册标志。adapter/index.js 在模块加载时向 AdapterRegistry 注册所有内置适配器，
// 但 SyncCoordinator → adapter/index → BookmarkAdapter → bridge → BookmarkAutoImporter → SyncCoordinator
// 构成循环依赖，顶部 require 会让 BookmarkAdapter 在 bridge 部分加载时拿到空的 BookmarkBridge。
// 改为首次 sync 调用时延迟 require（此时整张模块图已加载完成，注册安全）。
let _adaptersRegistered = false;
function ensureAdaptersRegistered() {
    if (_adaptersRegistered) return;
    // P4 收敛(c01): 标志必须在 require 成功之后置位——否则首次加载报错后永久跳过注册
    require("./index");
    _adaptersRegistered = true;
}

/**
 * SyncCoordinator — 统一的多源增量同步协调器
 * 串联 Adapter + DedupStore + SyncStateV2
 */
const SyncCoordinator = {
    _registryOverride: null,

    /**
     * 覆盖默认注册表 (测试用)
     * @param {Object|null} registry
     */
    setRegistry(registry) {
        this._registryOverride = registry;
    },

    _getRegistry() {
        return this._registryOverride || AdapterRegistry;
    },

    /**
     * 执行一次增量同步
     * @param {string} sourceType - 适配器注册类型
     * @param {Object} [options]
     * @param {boolean} [options.fullSync=false] - 强制全量拉取
     * @param {boolean} [options.commitWatermark=true] - 是否在 sync 内推进 watermark。
     *   F7 共识: 消费方自行按成功项提交时应传 false(避免 sync 推进后消费方抛错 →
     *   watermark 已越过未导出项, 增量永久冻结; 全盘审计修复)。
     * @returns {Promise<{newItems: NormalizedItem[], skippedCount: number, watermark: Object|null, pendingKeys: string[], error?: string}>}
     *
     * F6 共识(标记后置): 本方法只过滤不标记。返回的 pendingKeys 由消费方在
     * Notion 写入成功后调用 markItemSeen 落账,失败项天然不落账、下轮重试。
     */
    async sync(sourceType, options = {}) {
        ensureAdaptersRegistered();
        const adapter = this._getRegistry().getAdapter(sourceType);
        if (!adapter) {
            return { newItems: [], skippedCount: 0, watermark: null, pendingKeys: [], error: `未注册适配器: ${sourceType}` };
        }

        // 标记开始
        SyncStateV2.updateSourceState(sourceType, {
            lastAttemptAt: Date.now(),
            lastOutcome: "running",
            lastError: "",
        });

        try {
            const currentState = SyncStateV2.getSourceState(sourceType);
            const rawItems = options.fullSync
                ? await adapter.fetchAll()
                : await adapter.fetchIncremental(currentState.watermark);

            // 去重过滤 (使用 batch 减少 IPC 调用; F6: 只过滤、不 markSeen)
            DedupStore.beginBatch(sourceType);
            const newItems = [];
            const pendingKeys = [];
            let skippedCount = 0;
            try {
                for (const item of rawItems) {
                    const dedupKey = adapter.getDedupKey(item);
                    if (DedupStore.isDuplicate(sourceType, dedupKey)) {
                        skippedCount++;
                        continue;
                    }
                    newItems.push(item);
                    pendingKeys.push(dedupKey);
                }
            } finally {
                DedupStore.endBatch(sourceType);
            }

            // 计算新水位线 (仅基于 newItems; F7: 最终 watermark 由消费方按成功项推进)
            const newWatermark = SyncStateV2.buildWatermark(
                newItems,
                (item) => adapter.getItemTime(item),
                (item) => adapter.getItemId(item)
            );

            // 更新成功状态 (F7: watermark 仅当消费方未自行提交时推进)
            const statePatch = {
                lastSuccessAt: Date.now(),
                lastOutcome: "success",
                lastStats: { newCount: newItems.length, skippedCount },
            };
            if (options.commitWatermark !== false) {
                statePatch.watermark = newWatermark || currentState.watermark;
            }
            SyncStateV2.updateSourceState(sourceType, statePatch);

            return { newItems, skippedCount, watermark: newWatermark, pendingKeys };
        } catch (error) {
            // 更新错误状态
            SyncStateV2.updateSourceState(sourceType, {
                lastOutcome: "error",
                lastError: error.message || String(error),
            });
            SyncStateV2.forceFlush();
            return { newItems: [], skippedCount: 0, watermark: null, pendingKeys: [], error: error.message || String(error) };
        }
    },

    /**
     * F6 共识(标记后置): 消费方在 Notion 写入成功后调用,条目才进入去重账本。
     * 失败项不落账 → 下轮 sync 仍返回 → 重试机会保留。
     * @param {string} sourceType
     * @param {string} dedupKey
     */
    markItemSeen(sourceType, dedupKey) {
        if (!dedupKey) return;
        DedupStore.markSeen(sourceType, dedupKey);
    },
};

module.exports = { SyncCoordinator };
