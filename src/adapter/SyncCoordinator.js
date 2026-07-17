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
    _adaptersRegistered = true;
    require("./index");
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
     * @returns {Promise<{newItems: NormalizedItem[], skippedCount: number, watermark: Object|null, error?: string}>}
     */
    async sync(sourceType, options = {}) {
        ensureAdaptersRegistered();
        const adapter = this._getRegistry().getAdapter(sourceType);
        if (!adapter) {
            return { newItems: [], skippedCount: 0, watermark: null, error: `未注册适配器: ${sourceType}` };
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

            // 去重过滤 (使用 batch 减少 IPC 调用)
            DedupStore.beginBatch(sourceType);
            const newItems = [];
            let skippedCount = 0;
            try {
                for (const item of rawItems) {
                    const dedupKey = adapter.getDedupKey(item);
                    if (DedupStore.isDuplicate(sourceType, dedupKey)) {
                        skippedCount++;
                        continue;
                    }
                    newItems.push(item);
                    DedupStore.markSeen(sourceType, dedupKey);
                }
            } finally {
                DedupStore.endBatch();
            }

            // 计算新水位线
            const newWatermark = SyncStateV2.buildWatermark(
                newItems,
                (item) => adapter.getItemTime(item),
                (item) => adapter.getItemId(item)
            );

            // 更新成功状态
            SyncStateV2.updateSourceState(sourceType, {
                lastSuccessAt: Date.now(),
                lastOutcome: "success",
                lastStats: { newCount: newItems.length, skippedCount },
                watermark: newWatermark || currentState.watermark,
            });

            return { newItems, skippedCount, watermark: newWatermark };
        } catch (error) {
            // 更新错误状态
            SyncStateV2.updateSourceState(sourceType, {
                lastOutcome: "error",
                lastError: error.message || String(error),
            });
            SyncStateV2.forceFlush();
            return { newItems: [], skippedCount: 0, watermark: null, error: error.message || String(error) };
        }
    },
};

module.exports = { SyncCoordinator };
