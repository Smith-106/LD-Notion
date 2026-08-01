"use strict";

// deps.js — AI 域中央依赖访问器（TASK-002, P2_infra）。
// 统一 Handlers.js / AgentTools.js / agent-executor.js 的 lazy accessor 模式，
// 消除各文件重复的 let _AI = null; const AI = () => ... 三件套。
//
// 设计决策（analyze findings.json "Lazy Closure Retirement Strategy"）：
// 选择 central deps.js 而非 global DI container —— 认知开销更低，
// 仍实现解耦目标，减少约 6 man-hours 迁移工作量。
//
// 时序安全：require("./index") 在 handler/tool 执行时发生（非模块加载时），
// 此时 ai/index.js 已完成加载 + Object.assign mixin 完毕（coding-conventions-005）。
// CommonJS require 有模块缓存，二次起为对象属性读取，开销可忽略。

let _AI = null;
let _state = null;
let _svc = null;

/**
 * 获取 AIAssistant 实例（含 mixin 后的全部方法）
 * @returns {Object} AIAssistant
 */
const getAI = () => (_AI || (_AI = require("./index").AIAssistant));

/**
 * 获取 ChatState（对话状态管理）
 * @returns {Object} ChatState
 */
const getState = () => (_state || (_state = require("./index").ChatState));

/**
 * 获取 AIService（AI 请求服务层）
 * @returns {Object} AIService
 */
const getService = () => (_svc || (_svc = require("./index").AIService));

module.exports = { getAI, getState, getService };
