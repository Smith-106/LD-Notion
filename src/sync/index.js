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
};
