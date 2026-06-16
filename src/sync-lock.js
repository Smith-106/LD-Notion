"use strict";

/**
 * SyncLock — 导入/导出互斥标志
 * 解耦 export ↔ bridge 的循环依赖
 */
const SyncLock = {
    _exporting: false,

    get isExporting() {
        return this._exporting;
    },

    set isExporting(val) {
        this._exporting = Boolean(val);
    },
};

module.exports = { SyncLock };
