"use strict";

const { SourceAdapter } = require("./SourceAdapter");

const _registry = new Map();

const AdapterRegistry = {
    /**
     * 注册适配器实例
     * @param {Object} adapter - 必须包含 sourceType 和 SourceAdapter 的 4 个方法
     */
    register(adapter) {
        if (!adapter || !adapter.sourceType || typeof adapter.sourceType !== "string") {
            throw new Error("适配器必须包含 sourceType 字符串属性");
        }
        const required = ["fetchIncremental", "fetchAll", "normalize", "getDedupKey"];
        for (const method of required) {
            if (typeof adapter[method] !== "function") {
                throw new Error(`适配器 "${adapter.sourceType}" 缺少方法: ${method}`);
            }
        }
        _registry.set(adapter.sourceType, adapter);
    },

    /**
     * 获取已注册的适配器
     * @param {string} sourceType
     * @returns {Object|null}
     */
    getAdapter(sourceType) {
        return _registry.get(sourceType) || null;
    },

    /**
     * 列出所有已注册的适配器类型
     * @returns {string[]}
     */
    listAdapters() {
        return Array.from(_registry.keys());
    },

    /**
     * 清空注册表 (测试用)
     */
    clear() {
        _registry.clear();
    },
};

module.exports = { AdapterRegistry };
