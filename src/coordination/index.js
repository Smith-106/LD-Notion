"use strict";

// coordination 层门面:UI 命令分发协调器 + 事件总线
const { UICommandService } = require("./UICommandService");
const { on, off, emit } = require("./event-bus");

module.exports = { UICommandService, on, off, emit };
