"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");

const OperationGuard = {
    _getPermissionName: (level) => {
        return CONFIG.PERMISSION_NAMES[level] || `level_${level}`;
    },

    _inferActor: (context = {}) => {
        if (context.actor === "ai" || context.source === "ai-agent-loop" || context.source === "tool") {
            return "ai";
        }
        if (context.actor === "system" || context.source === "system") {
            return "system";
        }
        return "user";
    },

    _inferSource: (context = {}) => {
        return context.source || context.surface || context.origin || "ui";
    },

    _buildGuardSnapshot: (operation, decision, context = {}, extras = {}) => {
        const currentLevel = OperationGuard.getLevel();
        const requiredLevel = OperationGuard.OPERATION_LEVELS[operation];
        return {
            decision,
            permissionLevel: OperationGuard._getPermissionName(currentLevel),
            requiredLevel: requiredLevel === undefined ? "undefined" : OperationGuard._getPermissionName(requiredLevel),
            confirmation: extras.confirmation
                || (OperationGuard.isDangerous(operation) && OperationGuard.requiresConfirm() ? "required" : "not_required"),
        };
    },

    // 获取当前权限级别
    getLevel: () => {
        return Storage.get(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, CONFIG.DEFAULTS.permissionLevel);
    },

    // 设置权限级别
    setLevel: (level) => {
        if (!Number.isFinite(level) || !Number.isInteger(level) || level < 0 || level > 3) {
            throw new Error(`无效的权限级别: ${level}，应为 0-3 的整数`);
        }
        Storage.set(CONFIG.STORAGE_KEYS.PERMISSION_LEVEL, level);
    },

    // 是否需要确认
    requiresConfirm: () => {
        return Storage.get(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, CONFIG.DEFAULTS.requireConfirm);
    },

    // 操作所需的最低权限级别
    OPERATION_LEVELS: {
        // 只读操作
        search: 0,
        fetchPage: 0,
        fetchBlocks: 0,
        fetchDatabase: 0,
        queryDatabase: 0,
        getUsers: 0,
        getSelf: 0,
        getUser: 0,
        // 标准操作
        createDatabasePage: 1,
        updatePage: 1,
        updateBlock: 1,
        appendBlocks: 1,
        updatePageMarkdown: 1,
        updateDatabase: 1,
        // 高级操作
        movePage: 2,
        duplicatePage: 2,
        createDatabase: 2,
        replacePageMarkdown: 2,
        deletePage: 2,
        restorePage: 2,
        deleteBlock: 2,
        createComment: 1,
        agentTask: 2,
    },

    // 危险操作列表（需要额外确认）
    DANGEROUS_OPERATIONS: ["deletePage", "deleteBlock"],

    // 检查是否有权限执行操作
    canExecute: (operation) => {
        const currentLevel = OperationGuard.getLevel();
        const requiredLevel = OperationGuard.OPERATION_LEVELS[operation];
        if (requiredLevel === undefined) {
            // 安全原则: 未定义的操作默认拒绝
            console.warn(`OperationGuard: 操作 "${operation}" 未定义权限级别，默认拒绝`);
            return false;
        }
        return currentLevel >= requiredLevel;
    },

    // 检查是否为危险操作
    isDangerous: (operation) => {
        return OperationGuard.DANGEROUS_OPERATIONS.includes(operation);
    },

    // 执行受保护的操作
    execute: async (operation, executor, context = {}) => {
        const actor = OperationGuard._inferActor(context);
        const source = OperationGuard._inferSource(context);
        const requiredLevelForOp = OperationGuard.OPERATION_LEVELS[operation];
        const startedAt = Date.now();

        // 检查权限
        if (!OperationGuard.canExecute(operation)) {
            const requiredName = CONFIG.PERMISSION_NAMES[requiredLevelForOp];
            const denialReason = requiredLevelForOp === undefined
                ? `未定义权限级别: ${operation}`
                : `权限不足：需要"${requiredName}"及以上权限才能执行此操作`;
            OperationLog.add({
                audit_event: "guard.denied",
                actor,
                source,
                guard: OperationGuard._buildGuardSnapshot(operation, "deny", context, {
                    confirmation: "not_allowed",
                }),
                operation: {
                    name: operation,
                    risk: requiredLevelForOp === undefined ? "unknown" : OperationGuard._getPermissionName(requiredLevelForOp),
                    trigger: context.trigger || "user_requested_write",
                },
                target: OperationLog.buildTarget(context),
                payload: OperationLog.buildPayload(context),
                result: {
                    status: "denied",
                    reason: denialReason,
                },
                redaction: OperationLog.collectRedactionHints(context),
                operationName: operation,
                context,
                status: "failed",
                error: denialReason,
                startTime: startedAt,
                endTime: Date.now(),
            });
            throw new Error(denialReason);
        }

        // 危险操作需要确认
        if (OperationGuard.isDangerous(operation) && OperationGuard.requiresConfirm()) {
            const isPermanent = operation === "deleteBlock";
            const confirmed = await ConfirmationDialog.show({
                title: isPermanent ? "⚠️ 永久删除确认" : "危险操作确认",
                message: isPermanent
                    ? `您即将永久删除块，此操作无法撤销！`
                    : `您即将执行危险操作: ${operation}`,
                itemName: context.itemName || "未知项目",
                countdown: isPermanent ? 8 : 5, // 永久删除需要更长倒计时
                requireNameInput: true,
            });

            if (!confirmed) {
                OperationLog.add({
                    audit_event: "guard.denied",
                    actor,
                    source,
                    guard: OperationGuard._buildGuardSnapshot(operation, "deny", context, {
                        confirmation: "cancelled",
                    }),
                    operation: {
                        name: operation,
                        risk: OperationGuard._getPermissionName(requiredLevelForOp),
                        trigger: context.trigger || "user_requested_write",
                    },
                    target: OperationLog.buildTarget(context),
                    payload: OperationLog.buildPayload(context),
                    result: {
                        status: "cancelled",
                        reason: "user_cancelled_confirmation",
                    },
                    redaction: OperationLog.collectRedactionHints(context),
                    operationName: operation,
                    context,
                    status: "failed",
                    error: "操作已取消",
                    startTime: startedAt,
                    endTime: Date.now(),
                });
                throw new Error("操作已取消");
            }
        }

        OperationLog.add({
            audit_event: "guard.decision",
            actor,
            source,
            guard: OperationGuard._buildGuardSnapshot(operation, "allow", context),
            operation: {
                name: operation,
                risk: OperationGuard._getPermissionName(requiredLevelForOp),
                trigger: context.trigger || "user_requested_write",
            },
            target: OperationLog.buildTarget(context),
            payload: OperationLog.buildPayload(context),
            result: {
                status: "allow",
            },
            redaction: OperationLog.collectRedactionHints(context),
            operationName: operation,
            context,
            status: "success",
            startTime: startedAt,
            endTime: Date.now(),
        });

        // 记录操作开始
        const logEntry = {
            operationName: operation,
            context,
            startTime: startedAt,
            status: "pending",
        };

        try {
            const result = await executor();
            logEntry.status = "success";
            logEntry.endTime = Date.now();

            // 记录日志
            OperationLog.add({
                audit_event: OperationLog.inferAuditEvent(operation, "success"),
                actor,
                source,
                guard: OperationGuard._buildGuardSnapshot(operation, "allow", context),
                operation: {
                    name: operation,
                    risk: OperationGuard._getPermissionName(requiredLevelForOp),
                    trigger: context.trigger || "user_requested_write",
                },
                target: OperationLog.buildTarget(context),
                payload: OperationLog.buildPayload(context),
                result: {
                    status: "success",
                },
                redaction: OperationLog.collectRedactionHints(context),
                ...logEntry,
            });

            // 危险操作提供撤销选项
            if (OperationGuard.isDangerous(operation)) {
                if (operation === "deletePage") {
                    // deletePage 使用软删除（归档），可以恢复
                    UndoManager.register({
                        operation,
                        undoAction: () => NotionAPI.restorePage(context.pageId, context.apiKey),
                        description: `恢复页面: ${context.itemName || context.pageId}`,
                    });
                } else if (operation === "deleteBlock") {
                    // deleteBlock 是永久删除，无法通过 API 恢复
                    // 仅记录警告日志，不提供撤销选项
                    console.warn(`OperationGuard: deleteBlock 是永久操作，无法撤销`);
                }
            }

            return result;
        } catch (error) {
            logEntry.status = "failed";
            logEntry.error = error.message;
            logEntry.endTime = Date.now();
            OperationLog.add({
                audit_event: OperationLog.inferAuditEvent(operation, "failed"),
                actor,
                source,
                guard: OperationGuard._buildGuardSnapshot(operation, "allow", context),
                operation: {
                    name: operation,
                    risk: OperationGuard._getPermissionName(requiredLevelForOp),
                    trigger: context.trigger || "user_requested_write",
                },
                target: OperationLog.buildTarget(context),
                payload: OperationLog.buildPayload(context),
                result: {
                    status: "failed",
                    reason: error.message,
                },
                redaction: OperationLog.collectRedactionHints(context),
                ...logEntry,
            });
            throw error;
        }
    },
};

const OperationLog = {
    AUDIT_EVENT_BY_OPERATION: Object.freeze({
        createDatabasePage: "write.page.created",
        createComment: "write.page.created",
        appendBlocks: "write.block.inserted",
        updateBlock: "write.block.inserted",
        updatePage: "write.property.updated",
        updatePageMarkdown: "write.property.updated",
        updateDatabase: "write.property.updated",
        createDatabase: "write.page.created",
        movePage: "write.property.updated",
        duplicatePage: "write.page.created",
        replacePageMarkdown: "write.block.inserted",
        deletePage: "page.archived",
        restorePage: "page.restored",
        deleteBlock: "block.deleted",
        undo: "write.property.updated",
    }),

    SENSITIVE_KEY_HINTS: Object.freeze([
        { pattern: /token/i, label: "token" },
        { pattern: /api[_-]?key/i, label: "apiKey" },
        { pattern: /secret/i, label: "clientSecret" },
        { pattern: /refresh/i, label: "refreshToken" },
        { pattern: /passphrase/i, label: "passphrase" },
    ]),

    // 获取是否启用日志
    isEnabled: () => {
        return Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
    },

    createEventId: () => {
        return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    },

    appendRedaction: (list, label) => {
        if (!label) return;
        if (!list.includes(label)) list.push(label);
    },

    collectRedactionHints: (context = {}) => {
        const redaction = [];
        Object.entries(context || {}).forEach(([key, value]) => {
            if (value == null || value === "") return;
            OperationLog.SENSITIVE_KEY_HINTS.forEach(({ pattern, label }) => {
                if (pattern.test(key)) OperationLog.appendRedaction(redaction, label);
            });
        });
        ["pageId", "databaseId", "blockId", "commentId", "targetId", "parentPageId", "folderId"].forEach((key) => {
            if (context?.[key]) OperationLog.appendRedaction(redaction, "target.id");
        });
        return redaction;
    },

    redactTargetId: (value, redaction = []) => {
        if (!value) return "";
        OperationLog.appendRedaction(redaction, "target.id");
        const normalized = String(value).trim();
        if (normalized.length <= 8) return "<redacted>";
        return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
    },

    buildTarget: (context = {}, redaction = OperationLog.collectRedactionHints(context)) => {
        if (context.blockId) {
            return {
                type: "notion_block",
                id: OperationLog.redactTargetId(context.blockId, redaction),
                title: context.itemName || "",
            };
        }
        if (context.pageId || context.parentPageId) {
            return {
                type: "notion_page",
                id: OperationLog.redactTargetId(context.pageId || context.parentPageId, redaction),
                title: context.itemName || "",
            };
        }
        if (context.databaseId) {
            return {
                type: "notion_database",
                id: OperationLog.redactTargetId(context.databaseId, redaction),
                title: context.itemName || "",
            };
        }
        if (context.commentId) {
            return {
                type: "notion_comment",
                id: OperationLog.redactTargetId(context.commentId, redaction),
                title: context.itemName || "",
            };
        }
        return context.itemName ? { type: "generic", title: context.itemName } : null;
    },

    buildPayload: (context = {}, redaction = OperationLog.collectRedactionHints(context)) => {
        const payload = {};
        if (context.query) payload.query = Utils.truncateText(String(context.query), 120);
        if (context.content) payload.contentPreview = Utils.truncateText(String(context.content), 120);
        if (context.description) payload.description = Utils.truncateText(String(context.description), 120);
        if (context.folderId) payload.folderId = OperationLog.redactTargetId(context.folderId, redaction);
        if (context.targetType) payload.targetType = context.targetType;
        if (context.blockCount != null) payload.blockCount = context.blockCount;
        if (Array.isArray(context.propertyNames)) payload.propertyNames = context.propertyNames.slice(0, 12);
        return Object.keys(payload).length > 0 ? payload : null;
    },

    inferAuditEvent: (operation, status = "success") => {
        const mapped = OperationLog.AUDIT_EVENT_BY_OPERATION[operation];
        if (mapped) return mapped;
        return status === "failed" ? "import.failed" : "import.completed";
    },

    normalizeAuditEntry: (entry = {}) => {
        const context = entry.context || {};
        const redaction = Array.isArray(entry.redaction)
            ? [...entry.redaction]
            : OperationLog.collectRedactionHints(context);
        const operationName = entry.operationName
            || (typeof entry.operation === "string" ? entry.operation : entry.operation?.name || "");
        return {
            audit_event: entry.audit_event || (operationName ? OperationLog.inferAuditEvent(operationName, entry.status) : "operation.logged"),
            event_id: entry.event_id || OperationLog.createEventId(),
            at: entry.at || new Date().toISOString(),
            actor: entry.actor || context.actor || "user",
            source: entry.source || context.source || "ui",
            guard: entry.guard || null,
            operation: typeof entry.operation === "string"
                ? {
                    name: entry.operation,
                    risk: "unknown",
                    trigger: context.trigger || "manual",
                }
                : entry.operation || (operationName ? {
                    name: operationName,
                    risk: "unknown",
                    trigger: context.trigger || "manual",
                } : null),
            target: entry.target === undefined ? OperationLog.buildTarget(context, redaction) : entry.target,
            payload: entry.payload === undefined ? OperationLog.buildPayload(context, redaction) : entry.payload,
            result: entry.result || {
                status: entry.status || "success",
                reason: entry.error || "",
            },
            redaction,
            id: entry.id || OperationLog.createEventId(),
            timestamp: entry.timestamp || new Date().toISOString(),
            operationName,
            status: entry.status || entry.result?.status || "success",
            error: entry.error || entry.result?.reason || "",
            context,
            startTime: entry.startTime || Date.now(),
            endTime: entry.endTime || entry.startTime || Date.now(),
        };
    },

    // 敏感字段脱敏：将所有 SENSITIVE_KEYS 对应的值替换为 ***REDACTED***
    redactSensitiveFields: (entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const redacted = { ...entry };
        const context = redacted.context || {};
        const sensitiveKeys = (typeof CredentialVault !== "undefined" && CredentialVault.SENSITIVE_KEYS)
            ? CredentialVault.SENSITIVE_KEYS
            : new Set();
        for (const key of sensitiveKeys) {
            if (Object.prototype.hasOwnProperty.call(context, key)) {
                context[key] = "***REDACTED***";
            }
        }
        redacted.context = context;
        return redacted;
    },

    // 获取所有日志
    getAll: () => {
        const data = Storage.get(CONFIG.STORAGE_KEYS.OPERATION_LOG, "[]");
        try {
            return JSON.parse(data);
        } catch {
            return [];
        }
    },

    // 添加日志条目
    add: (entry, options = {}) => {
        const { force = false } = options;
        if (!force && !OperationLog.isEnabled()) return;

        const logs = OperationLog.getAll();
        const logEntry = OperationLog.redactSensitiveFields(OperationLog.normalizeAuditEntry(entry));

        logs.unshift(logEntry);

        // 限制日志数量
        if (logs.length > CONFIG.API.MAX_LOG_ENTRIES) {
            logs.length = CONFIG.API.MAX_LOG_ENTRIES;
        }

        Storage.set(CONFIG.STORAGE_KEYS.OPERATION_LOG, JSON.stringify(logs));

        // 触发UI更新
        if (typeof UI !== "undefined" && UI.updateLogPanel) {
            UI.updateLogPanel();
        }

        return logEntry;
    },

    // 清空日志
    clear: () => {
        Storage.set(CONFIG.STORAGE_KEYS.OPERATION_LOG, "[]");
        if (typeof UI !== "undefined" && UI.updateLogPanel) {
            UI.updateLogPanel();
        }
    },

    // 获取最近N条日志
    getRecent: (count = 10) => {
        return OperationLog.getAll().slice(0, count);
    },

    // 格式化日志条目用于显示
    formatEntry: (entry) => {
        const time = new Date(entry.at || entry.timestamp).toLocaleString("zh-CN");
        const status = entry.result?.status || entry.status;
        const statusIcon = status === "success" || status === "allow"
            ? "✅"
            : (status === "failed" || status === "denied" || status === "cancelled")
                ? "❌"
                : "⏳";
        const duration = entry.endTime ? `${entry.endTime - entry.startTime}ms` : "-";
        return {
            time,
            statusIcon,
            operation: entry.audit_event || entry.operationName || entry.operation?.name || entry.operation,
            status,
            duration,
            error: entry.error || entry.result?.reason,
            context: entry.context,
        };
    },
};

const ConfirmationDialog = {
    dialogElement: null,

    // 显示确认对话框
    show: (options) => {
        return new Promise((resolve) => {
            const {
                title = "确认操作",
                message = "确定要执行此操作吗？",
                itemName = "",
                countdown = 5,
                requireNameInput = false,
            } = options;

            const escapeHtml = Utils.escapeHtml;

            // 创建对话框
            const dialog = document.createElement("div");
            dialog.className = "ldb-confirm-overlay";
            dialog.innerHTML = `
                <div class="ldb-confirm-dialog">
                    <div class="ldb-confirm-header">
                        <span class="ldb-confirm-icon">⚠️</span>
                        <span class="ldb-confirm-title">${escapeHtml(title)}</span>
                    </div>
                    <div class="ldb-confirm-body">
                        <p class="ldb-confirm-message">${escapeHtml(message)}</p>
                        ${itemName ? `<p class="ldb-confirm-item">目标: <strong>${escapeHtml(itemName)}</strong></p>` : ""}
                        ${requireNameInput ? `
                            <div class="ldb-confirm-input-group">
                                <label>请输入名称确认:</label>
                                <input type="text" class="ldb-confirm-input" placeholder="${escapeHtml(itemName)}" id="ldb-confirm-name-input">
                                <div class="ldb-confirm-hint">请输入 "${itemName}" 以确认操作</div>
                            </div>
                        ` : ""}
                    </div>
                    <div class="ldb-confirm-footer">
                        <div class="ldb-confirm-countdown-bar" id="ldb-confirm-countdown-bar">
                            <div class="ldb-confirm-countdown-fill" id="ldb-confirm-countdown-fill"></div>
                        </div>
                        <button class="ldb-btn ldb-btn-secondary" id="ldb-confirm-cancel">取消</button>
                        <button class="ldb-btn ldb-btn-danger" id="ldb-confirm-ok" disabled>
                            确认 (<span id="ldb-confirm-countdown">${countdown}</span>)
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);
            ConfirmationDialog.dialogElement = dialog;

            const okBtn = dialog.querySelector("#ldb-confirm-ok");
            const cancelBtn = dialog.querySelector("#ldb-confirm-cancel");
            const countdownEl = dialog.querySelector("#ldb-confirm-countdown");
            const nameInput = dialog.querySelector("#ldb-confirm-name-input");

            let remaining = countdown;
            let canConfirm = !requireNameInput;

            // 倒计时进度条
            const countdownFill = dialog.querySelector("#ldb-confirm-countdown-fill");
            if (countdownFill) {
                // 启动动画（下一帧开始，确保 transition 生效）
                requestAnimationFrame(() => {
                    countdownFill.style.width = "0%";
                    countdownFill.style.transition = `width ${countdown}s linear`;
                });
            }

            // 倒计时
            const timer = setInterval(() => {
                remaining--;
                countdownEl.textContent = remaining;
                if (remaining <= 0) {
                    clearInterval(timer);
                    countdownEl.parentElement.textContent = "确认";
                    if (canConfirm) {
                        okBtn.disabled = false;
                    }
                }
            }, 1000);

            // 名称输入验证
            if (nameInput) {
                nameInput.oninput = () => {
                    canConfirm = nameInput.value.trim() === itemName;
                    if (remaining <= 0 && canConfirm) {
                        okBtn.disabled = false;
                    } else {
                        okBtn.disabled = true;
                    }
                };
                nameInput.focus();
            }

            // 取消按钮
            cancelBtn.onclick = () => {
                clearInterval(timer);
                dialog.remove();
                ConfirmationDialog.dialogElement = null;
                resolve(false);
            };

            // 确认按钮
            okBtn.onclick = () => {
                if (okBtn.disabled) return;
                clearInterval(timer);
                dialog.remove();
                ConfirmationDialog.dialogElement = null;
                resolve(true);
            };

            // ESC 关闭
            const escHandler = (e) => {
                if (e.key === "Escape") {
                    clearInterval(timer);
                    dialog.remove();
                    ConfirmationDialog.dialogElement = null;
                    document.removeEventListener("keydown", escHandler);
                    resolve(false);
                }
            };
            document.addEventListener("keydown", escHandler);
        });
    },

    // 关闭对话框
    close: () => {
        if (ConfirmationDialog.dialogElement) {
            ConfirmationDialog.dialogElement.remove();
            ConfirmationDialog.dialogElement = null;
        }
    },
};

const UndoManager = {
    pendingUndo: null,
    toastElement: null,
    timeoutId: null,

    // 注册可撤销的操作
    register: (undoAction) => {
        // 清除之前的撤销
        UndoManager.clear();

        UndoManager.pendingUndo = {
            ...undoAction,
            registeredAt: Date.now(),
        };

        // 显示撤销提示
        UndoManager.showToast(undoAction.description);

        // 设置超时
        UndoManager.timeoutId = setTimeout(() => {
            UndoManager.clear();
        }, CONFIG.API.UNDO_TIMEOUT);
    },

    // 执行撤销
    execute: async () => {
        if (!UndoManager.pendingUndo) return false;

        try {
            const description = UndoManager.pendingUndo?.description || "";
            await UndoManager.pendingUndo.undoAction();
            UndoManager.hideToast();
            UndoManager.clear();

            // 记录撤销操作
            OperationLog.add({
                audit_event: OperationLog.inferAuditEvent("undo", "success"),
                actor: "user",
                source: "undo-manager",
                operation: {
                    name: "undo",
                    risk: "standard",
                    trigger: "user_requested_undo",
                },
                payload: {
                    description: Utils.truncateText(description, 120),
                },
                result: {
                    status: "success",
                },
                redaction: [],
                operationName: "undo",
                context: { description },
                startTime: Date.now(),
                endTime: Date.now(),
                status: "success",
            });

            return true;
        } catch (error) {
            console.error("[LD-Notion] 撤销失败:", error);
            const description = UndoManager.pendingUndo?.description || "";
            OperationLog.add({
                audit_event: OperationLog.inferAuditEvent("undo", "failed"),
                actor: "user",
                source: "undo-manager",
                operation: {
                    name: "undo",
                    risk: "standard",
                    trigger: "user_requested_undo",
                },
                payload: {
                    description: Utils.truncateText(description, 120),
                },
                result: {
                    status: "failed",
                    reason: error.message,
                },
                redaction: [],
                operationName: "undo",
                context: { description },
                startTime: Date.now(),
                endTime: Date.now(),
                status: "failed",
                error: error.message,
            });
            return false;
        }
    },

    // 清除待撤销操作
    clear: () => {
        if (UndoManager.timeoutId) {
            clearTimeout(UndoManager.timeoutId);
            UndoManager.timeoutId = null;
        }
        UndoManager.pendingUndo = null;
        UndoManager.hideToast();
    },

    // 显示撤销提示 toast
    showToast: (message) => {
        UndoManager.hideToast();

        const toast = document.createElement("div");
        toast.className = "ldb-undo-toast";
        const escapedMsg = Utils.escapeHtml(message);
        toast.innerHTML = `
            <span class="ldb-undo-message">${escapedMsg}</span>
            <button class="ldb-undo-btn" id="ldb-undo-action">撤销</button>
            <div class="ldb-undo-progress">
                <div class="ldb-undo-progress-bar"></div>
            </div>
        `;

        document.body.appendChild(toast);
        UndoManager.toastElement = toast;

        // 绑定撤销按钮
        toast.querySelector("#ldb-undo-action").onclick = async () => {
            const success = await UndoManager.execute();
            if (success) {
                UI.showStatus("撤销成功", "success");
            } else {
                UI.showStatus("撤销失败，请手动检查 Notion 中的变更", "error");
            }
        };

        // 动画显示
        requestAnimationFrame(() => {
            toast.classList.add("visible");
        });
    },

    // 隐藏撤销提示
    hideToast: () => {
        if (UndoManager.toastElement) {
            UndoManager.toastElement.classList.remove("visible");
            setTimeout(() => {
                if (UndoManager.toastElement) {
                    UndoManager.toastElement.remove();
                    UndoManager.toastElement = null;
                }
            }, 300);
        }
    },

    // 检查是否有待撤销操作
    hasPending: () => {
        return UndoManager.pendingUndo !== null;
    },

    // 获取剩余撤销时间
    getRemainingTime: () => {
        if (!UndoManager.pendingUndo) return 0;
        const elapsed = Date.now() - UndoManager.pendingUndo.registeredAt;
        return Math.max(0, CONFIG.API.UNDO_TIMEOUT - elapsed);
    },
};

module.exports = { OperationGuard, OperationLog, ConfirmationDialog, UndoManager };
