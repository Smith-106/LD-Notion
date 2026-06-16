"use strict";

/**
 * @typedef {Object} NormalizedItem
 * @property {string} source - adapter type name
 * @property {string} id - unique item identifier
 * @property {string} title
 * @property {string} content - HTML or markdown
 * @property {string} url
 * @property {string} author
 * @property {string[]} tags
 * @property {string} createdAt - ISO 8601
 * @property {Object} raw - original API item
 */

/**
 * SourceAdapter — 知识源适配器基类
 * 每个具体适配器必须实现 4 个方法: fetchIncremental, fetchAll, normalize, getDedupKey
 */
const SourceAdapter = {
    /**
     * 适配器类型标识 (子类覆盖)
     * @type {string}
     */
    sourceType: "_base",

    /**
     * 增量拉取: 根据 watermark 获取上次同步后的新条目
     * @param {{time:string, ids:string[]}|null} watermark - 上次同步的水位线
     * @returns {Promise<NormalizedItem[]>}
     */
    async fetchIncremental(watermark) {
        throw new Error(`SourceAdapter.fetchIncremental 未实现: ${this.sourceType}`);
    },

    /**
     * 全量拉取: 获取所有可用条目
     * @returns {Promise<NormalizedItem[]>}
     */
    async fetchAll() {
        throw new Error(`SourceAdapter.fetchAll 未实现: ${this.sourceType}`);
    },

    /**
     * 将原始 API 条目归一化为 NormalizedItem 格式
     * @param {Object} rawItem - 原始 API 数据
     * @returns {NormalizedItem}
     */
    normalize(rawItem) {
        throw new Error(`SourceAdapter.normalize 未实现: ${this.sourceType}`);
    },

    /**
     * 从 NormalizedItem 生成去重键
     * @param {NormalizedItem} item
     * @returns {string}
     */
    getDedupKey(item) {
        throw new Error(`SourceAdapter.getDedupKey 未实现: ${this.sourceType}`);
    },

    /**
     * 获取条目时间戳 (供 SyncState.buildWatermark 使用)
     * @param {NormalizedItem} item
     * @returns {string} ISO 8601 时间
     */
    getItemTime(item) {
        return item.createdAt || "";
    },

    /**
     * 获取条目 ID (供 SyncState.buildWatermark 使用)
     * @param {NormalizedItem} item
     * @returns {string}
     */
    getItemId(item) {
        return item.id || "";
    },
};

module.exports = { SourceAdapter };
