"use strict";

// AgentTools.js — AI Agent 工具注册表 shell（TASK-006, P6_agenttools_split）。
// 原 1712 行巨石已拆分为 3 个域文件，本文件仅做 spread merge。
// AI_AGENT_TOOLS 注册表键名不变，agent-executor.js 消费者零改动。

const readTools = require("./tools/read-tools");
const writeTools = require("./tools/write-tools");
const metaTools = require("./tools/meta-tools");

const AI_AGENT_TOOLS = {
    ...readTools,
    ...writeTools,
    ...metaTools,
};

module.exports = { AI_AGENT_TOOLS };
