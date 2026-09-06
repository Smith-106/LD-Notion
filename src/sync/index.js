"use strict";

// src/sync — 多端同步模块汇总导出
// 依赖方向(零环): SyncEngine → { SyncLedger, SyncSerializer, SyncPayload,
// SyncCrypto, SyncRateLimiter, SyncConfig, storage, security, coordination/event-bus }
// storage/ 不反向 require sync(靠 event-bus emit 解耦, F-SYNC-11)。

const { SyncConstants } = require("./constants");
const { SyncPayload } = require("./SyncPayload");
const { SyncSerializer } = require("./SyncSerializer");
const { SyncCrypto } = require("./SyncCrypto");
const { SyncFragmenter } = require("./SyncFragmenter");
const { SyncRateLimiter } = require("./SyncRateLimiter");
const { SyncLedger } = require("./SyncLedger");
const { SyncEngine } = require("./SyncEngine");
const { SyncConfig } = require("./SyncConfig");

module.exports = {
    SyncConstants,
    SyncPayload,
    SyncSerializer,
    SyncCrypto,
    SyncFragmenter,
    SyncRateLimiter,
    SyncLedger,
    SyncEngine,
    SyncConfig,
    // v3.14.6 (AUD-ARCH-07): 启动接线迁入本模块 —— main.js 编译期字面量开关剪枝时
    // require 整体缺席, 接线文本与 sync 模块名不再残留于产物; 启用时运行期 SyncConfig 双闸不变
    boot: ({ Storage, SyncState, DedupStore, NotionAPI, OperationGuard, OperationLog, Utils }) => {
        if (!SyncConfig.isEnabled()) return;
        SyncEngine.init({
            Storage,
            SyncStateV2: SyncState,
            DedupStore,
            NotionAPI,
            OperationGuard,
            OperationLog,
        });
        // 共享请求预算(F-SYNC-04): gate 默认 null; 仅同步启用时注入, 导出路径共享 3 req/s 桶
        NotionAPI.setRequestGate(() => SyncRateLimiter.gateAcquire());
        Utils.runWhenBrowserIdle(() => SyncEngine.pull({ reason: "idle" }));
        // 周期 pull(与自动导入节奏错峰, LOW-3: deviceId 哈希取模)
        const hash = SyncConfig.getDeviceId().split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const phase = hash % 15; // 0-14 分钟偏移
        setTimeout(() => {
            const loop = () => {
                // 全盘审计修复(find 6): 禁用后停止周期 pull(不再拉取/应用远端状态)
                if (!SyncConfig.isEnabled()) return;
                SyncEngine.pull({ reason: "periodic" });
                setTimeout(loop, 30 * 60 * 1000 + phase * 60000);
            };
            loop();
        }, phase * 60000);
    },
};
