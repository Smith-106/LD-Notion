"use strict";

const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");
const { CredentialVault } = require("../auth");

// 事件总线解耦：security 不再直接 require("../ui")，改由 emit 通知 UI 层订阅响应。
// coordination/event-bus.js 零依赖，不引入新循环。
const { emit } = require("../coordination/event-bus");

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

    // v3.14.6 (XN-06/S-05): guard.denied 统一构造器 —— 6 处手写形态归一(actor/source/status 不再漂移);
    // phase: precheck(canExecute 非阻塞闸门) | execute(execute 内权限拒绝) | cancelled(确认取消);
    // 语义: denied 顶 status="denied"(非 failed); 确认取消独立事件 guard.cancelled
    auditDenied: (operation, context = {}, options = {}) => {
        const { phase = "precheck", reason = "", force = false } = options;
        const startedAt = Date.now();
        const isCancelled = phase === "cancelled";
        const actor = OperationGuard._inferActor(context);
        const source = OperationGuard._inferSource(context);
        const risk = OperationGuard._getPermissionName(OperationGuard.OPERATION_LEVELS[operation]) || "unknown";
        return OperationLog.add({
            audit_event: isCancelled ? "guard.cancelled" : "guard.denied",
            actor,
            source,
            guard: OperationGuard._buildGuardSnapshot(operation, "deny", context),
            operation: {
                name: operation,
                risk,
                trigger: context.trigger || "user_requested_write",
            },
            target: OperationLog.buildTarget(context),
            payload: OperationLog.buildPayload(context),
            result: {
                status: isCancelled ? "cancelled" : "denied",
                reason: reason || (isCancelled ? "user_cancelled_confirmation" : "权限不足"),
            },
            redaction: OperationLog.collectRedactionHints(context),
            operationName: operation,
            context: { ...context, phase },
            status: isCancelled ? "cancelled" : "denied",
            error: reason || (isCancelled ? "操作已取消" : "权限不足"),
            startTime: startedAt,
            endTime: Date.now(),
        }, { force });
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
        createComment: 1,
        agentTask: 2,
        // v3.14.7 (REV-03 UI-07): Obsidian 写入登记——此前 4 个裸调点(events.js:1335/1380,
        // github-obsidian-service.js:210, generic-ui.js:704)绕过 OperationGuard, 权限 0 只读
        // 级仍可写零审计。登记后 writeNote/writeImage 统一经 canExecute 闸门 + auditDenied。
        "obsidian.writeNote": 1,
        "obsidian.writeImage": 1,
        // 多端同步(F-SYNC-05, HIGH-1 共识: 必须 P0 静态注册,接线在后)
        "sync.state.pull": 0,      // 只读拉取 payload
        "sync.state.push": 1,      // 推送本地状态(写介质)
        "sync.medium.provision": 2, // 创建同步库(复用 createDatabase 语义)
        "sync.medium.reset": 3,    // 重置远程同步库(跨设备不可逆)
    },

    // 危险操作列表（需要额外确认）
    // 注:deleteBlock 已从登记移除(F-UI-20)——NotionAPI.deleteBlock 无任何调用方
    // (AI 工具表无 delete_block,UI 无按钮),保留登记会误导「块级删除可经本工具触发」。
    DANGEROUS_OPERATIONS: ["deletePage", "sync.medium.reset"],

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
        // qwen P1 共识: 权限判定与执行之间存在确认对话框 await(可长达数十秒),
        // 权限级别存于跨 tab GM 存储, 期间可能被下调 → 执行前必须复查(TOCTOU)。
        const buildDenial = () => {
            const requiredName = CONFIG.PERMISSION_NAMES[requiredLevelForOp];
            const denialReason = requiredLevelForOp === undefined
                ? `未定义权限级别: ${operation}`
                : `权限不足：需要"${requiredName}"及以上权限才能执行此操作。可在主面板「权限控制」中调整权限级别。`;
            // v3.14.6 (XN-06): 统一构造器(phase=execute, status=denied)
            OperationGuard.auditDenied(operation, context, { phase: "execute", reason: denialReason });
            return new Error(denialReason);
        };
        if (!OperationGuard.canExecute(operation)) {
            throw buildDenial();
        }

        // 危险操作需要确认; v3.14.6 (S-04): context.requireConfirm 使 AI 常规写也走确认(AI 写零确认缺口)
        if ((OperationGuard.isDangerous(operation) && OperationGuard.requiresConfirm()) || context.requireConfirm === true) {
            const isPermanent = false; // deleteBlock 已从危险操作登记移除(F-UI-20)
            const dangerous = OperationGuard.isDangerous(operation);
            const confirmed = await ConfirmationDialog.show({
                title: isPermanent ? "⚠️ 永久删除确认" : (dangerous ? "危险操作确认" : "操作确认"),
                message: isPermanent
                    ? `您即将永久删除块，此操作无法撤销！`
                    : (dangerous ? `您即将执行危险操作: ${operation}` : `您即将执行操作: ${operation}`),
                itemName: context.itemName || "未知项目",
                countdown: isPermanent ? 8 : 5, // 永久删除需要更长倒计时
                requireNameInput: true,
            });

            if (!confirmed) {
                // v3.14.6 (S-05/XN-06): 确认取消独立事件 guard.cancelled + status=cancelled
                OperationGuard.auditDenied(operation, context, { phase: "cancelled", reason: "user_cancelled_confirmation" });
                throw new Error("操作已取消");
            }

            // 确认期间权限可能被下调(跨 tab 设置同步) — 执行前复查
            if (!OperationGuard.canExecute(operation)) {
                throw buildDenial();
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
            // P4 收敛(c10): 审计写入失败不得把已成功的写操作判为失败
            // (否则调用方收到错误且跳过下方撤销注册)
            try {
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
            } catch (auditError) {
                console.warn("[LD-Notion] 操作审计写入失败(写操作已成功):", auditError);
            }

            // 危险操作提供撤销选项
            if (OperationGuard.isDangerous(operation)) {
                if (operation === "deletePage") {
                    // deletePage 使用软删除（归档），可以恢复
                    // 撤销执行时经 Guard 复查(安全审计 hy3 LOW): 删除与撤销之间
                    // 权限若被下调, restorePage(level 2)仍须过闸, 禁止裸调绕过
                    UndoManager.register({
                        operation,
                        undoAction: () => OperationGuard.execute(
                            "restorePage",
                            () => NotionAPI.restorePage(context.pageId, context.apiKey),
                            { ...context, trigger: "user_undo" }
                        ),
                        description: `恢复页面: ${context.itemName || context.pageId}`,
                    });
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
        undo: "write.property.updated",
        // 多端同步(HIGH-2/M-3 共识): 无映射则 inferAuditEvent 回退 import.*,语义错位
        "sync.state.pull": "sync.state.pulled",
        "sync.state.push": "sync.state.pushed",
        "sync.medium.provision": "sync.medium.provisioned",
        "sync.medium.reset": "sync.medium.reset",
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
        const bytes = new Uint8Array(4);
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
            crypto.getRandomValues(bytes);
        }
        const randomPart = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
        return `evt_${Date.now().toString(36)}_${randomPart}`;
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
        // P4 收敛(c10 2/3): 浅拷贝的 context 与调用方同引用 —— 原地脱敏会污染调用方对象。
        // OperationGuard.execute 在写 guard.decision 审计后仍用同一 context 注册撤销
        // (NotionAPI.restorePage(context.pageId, context.apiKey)) → 拿到占位串 401, 删除无法恢复。
        const context = { ...(entry.context || {}) };
        const sensitiveKeys = (CredentialVault && CredentialVault.REDACT_IN_LOGS)
            ? CredentialVault.REDACT_IN_LOGS
            : new Set();
        for (const key of sensitiveKeys) {
            if (Object.prototype.hasOwnProperty.call(context, key)) {
                context[key] = "***REDACTED***";
            }
        }
        // 通用敏感键名兜底(CWE-532): guard context 用 apiKey 而非存储键名,
        // 仅按存储键名脱敏会漏掉真实 token 落盘(安全审计 hy3 CRITICAL)。
        for (const key of Object.keys(context)) {
            if (/api[_-]?key|token|secret|passphrase|password/i.test(key)) {
                context[key] = "***REDACTED***";
            }
        }
        redacted.context = context;
        return redacted;
    },

    // 获取所有日志(损坏存储兜底: JSON 解析成功但非数组时返回 [] ,
    // 否则 add 中 logs.unshift 抛 TypeError → OperationGuard 放行前崩溃, 全盘审计修复)
    getAll: () => {
        const data = Storage.get(CONFIG.STORAGE_KEYS.OPERATION_LOG, "[]");
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
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

        // 触发UI更新（通过事件总线，消除 security→ui 循环依赖）
        // v3.14.6 (XN-07): 广播投影而非全量深拷贝 —— context/payload/error 原文不回传事件总线
        emit("oplog:changed", OperationLog.projectForBroadcast(logs));

        return logEntry;
    },

    // v3.14.6 (XN-07): 广播投影 —— 仅安全字段子集(id/timestamp/operationName/actor/source/status/
    // audit_event/result:{status,reason 截断}); UI 渲染走 getAll 全量(已脱敏), 事件总线零敏感载荷
    projectForBroadcast: (logs = []) => {
        return logs.map((entry) => ({
            id: entry.id,
            timestamp: entry.timestamp || entry.at || entry.startTime,
            operationName: entry.operationName || entry.operation?.name || entry.audit_event,
            actor: entry.actor,
            source: entry.source,
            status: entry.result?.status || entry.status,
            audit_event: entry.audit_event,
            result: {
                status: entry.result?.status || entry.status,
                reason: String(entry.result?.reason || "").slice(0, 120),
            },
        }));
    },

    // 清空日志
    clear: () => {
        Storage.set(CONFIG.STORAGE_KEYS.OPERATION_LOG, "[]");
        emit("oplog:changed", []);
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
    _queue: [],
    _activeResolve: null,

    // 显示确认对话框
    // 支持 onConfirm/confirmText(三模型共识 F-UI-01):确认时调用 onConfirm 回调,
    // 按钮文案用 confirmText(默认「确认」),修复「重新导出/删除模板确认后零执行」瘫痪。
    // v3.14.8: 重入改为队列(不再 resolve(false) 伪取消); close() 会 resolve(false);
    // 名称确认提示用 textContent 展示原文, 比较也用 raw itemName。
    show: (options) => {
        return new Promise((resolve) => {
            if (ConfirmationDialog.dialogElement) {
                ConfirmationDialog._queue.push({ options, resolve });
                return;
            }
            ConfirmationDialog._present(options, resolve);
        });
    },

    _drainQueue: () => {
        if (ConfirmationDialog.dialogElement) return;
        const next = ConfirmationDialog._queue.shift();
        if (!next) return;
        ConfirmationDialog._present(next.options, next.resolve);
    },

    _present: (options, resolve) => {
            const {
                title = "确认操作",
                message = "确定要执行此操作吗？",
                itemName = "",
                countdown = 5,
                requireNameInput = false,
                confirmText = "确认",
                onConfirm = null,
            } = options || {};

            const escapeHtml = Utils.escapeHtml;
            const rawItemName = String(itemName || "");

            // 创建对话框
            const dialog = document.createElement("div");
            // v3.14.7 (REV-16 UI-18): ARIA——role=dialog + aria-modal, 屏幕阅读器可播报
            dialog.className = "ldb-confirm-overlay";
            dialog.setAttribute("role", "dialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.setAttribute("aria-labelledby", "ldb-confirm-title");
            dialog.innerHTML = `
                <div class="ldb-confirm-dialog">
                    <div class="ldb-confirm-header">
                        <span class="ldb-confirm-icon">⚠️</span>
                        <span class="ldb-confirm-title" id="ldb-confirm-title">${escapeHtml(title)}</span>
                    </div>
                    <div class="ldb-confirm-body">
                        <p class="ldb-confirm-message">${escapeHtml(message)}</p>
                        ${rawItemName ? `<p class="ldb-confirm-item">目标: <strong class="ldb-confirm-item-name"></strong></p>` : ""}
                        ${requireNameInput ? `
                            <div class="ldb-confirm-input-group">
                                <label>请输入名称确认:</label>
                                <input type="text" class="ldb-confirm-input" id="ldb-confirm-name-input">
                                <div class="ldb-confirm-hint">请输入「<span class="ldb-confirm-hint-name"></span>」以确认操作</div>
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

            // 名称展示走 textContent(保留原文), 避免 escapeHtml 后与 raw 比较产生认知偏差
            const itemNameEl = dialog.querySelector(".ldb-confirm-item-name");
            if (itemNameEl) itemNameEl.textContent = rawItemName;
            const hintNameEl = dialog.querySelector(".ldb-confirm-hint-name");
            if (hintNameEl) hintNameEl.textContent = rawItemName;
            const nameInputEl = dialog.querySelector("#ldb-confirm-name-input");
            if (nameInputEl) nameInputEl.placeholder = rawItemName;

            document.body.appendChild(dialog);
            // P4 收敛(c12): 确认框挂在 body 下, 不在任何 [data-ldb-theme] 根内 —— 显式暗色时
            // 属性选择器不命中而媒体回退(.ldb-confirm-dialog:not([data-ldb-theme]))仍生效,
            // 导致主题与确认框不一致。从已盖章的根读取生效主题并盖到对话框自身。
            const themedRoot = document.querySelector("[data-ldb-theme]");
            const dialogPanel = dialog.querySelector(".ldb-confirm-dialog");
            if (themedRoot && dialogPanel) {
                dialogPanel.setAttribute("data-ldb-theme", themedRoot.getAttribute("data-ldb-theme"));
            }
            ConfirmationDialog.dialogElement = dialog;
            ConfirmationDialog._activeResolve = resolve;

            const okBtn = dialog.querySelector("#ldb-confirm-ok");
            const cancelBtn = dialog.querySelector("#ldb-confirm-cancel");
            const countdownEl = dialog.querySelector("#ldb-confirm-countdown");
            const nameInput = dialog.querySelector("#ldb-confirm-name-input");

            // countdown:0 must enable immediately — setInterval only ticks after 1s,
            // so a zero countdown previously left OK disabled for ~1s (PR #20 residual).
            let remaining = Math.max(0, Math.floor(Number(countdown)) || 0);
            let canConfirm = !requireNameInput;
            let settled = false;
            let timer = null;

            // v3.14.7 (REV-02 UI-06): 统一关闭路径——cancel/ok/esc/close 共用 cleanup
            const cleanup = (result) => {
                if (settled) return;
                settled = true;
                if (timer) clearInterval(timer);
                document.removeEventListener("keydown", escHandler);
                dialog.remove();
                if (ConfirmationDialog.dialogElement === dialog) {
                    ConfirmationDialog.dialogElement = null;
                }
                if (ConfirmationDialog._activeResolve === resolve) {
                    ConfirmationDialog._activeResolve = null;
                }
                resolve(result);
                ConfirmationDialog._drainQueue();
            };
            dialog._ldConfirmCleanup = cleanup;

            const finishCountdown = () => {
                if (timer) {
                    clearInterval(timer);
                    timer = null;
                }
                dialog._countdownTimer = null;
                // F-UI-01:按钮文案用 confirmText(默认「确认」)
                if (countdownEl && countdownEl.parentElement) {
                    countdownEl.parentElement.textContent = confirmText;
                }
                if (canConfirm) {
                    okBtn.disabled = false;
                }
            };

            // 倒计时进度条
            const countdownFill = dialog.querySelector("#ldb-confirm-countdown-fill");
            if (countdownFill) {
                if (remaining <= 0) {
                    countdownFill.style.width = "0%";
                    countdownFill.style.transition = "none";
                } else {
                    // 启动动画（下一帧开始，确保 transition 生效）
                    requestAnimationFrame(() => {
                        countdownFill.style.width = "0%";
                        countdownFill.style.transition = `width ${remaining}s linear`;
                    });
                }
            }

            // 倒计时（0 秒立即可确认，避免空等一个 interval tick）
            if (remaining <= 0) {
                finishCountdown();
            } else {
                if (countdownEl) countdownEl.textContent = String(remaining);
                timer = setInterval(() => {
                    remaining--;
                    if (countdownEl) countdownEl.textContent = String(remaining);
                    if (remaining <= 0) {
                        finishCountdown();
                    }
                }, 1000);
                dialog._countdownTimer = timer;
            }

            // 名称输入验证——比较 raw itemName(非 HTML 转义串)
            if (nameInput) {
                nameInput.oninput = () => {
                    canConfirm = nameInput.value.trim() === rawItemName;
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
                cleanup(false);
            };

            // 确认按钮
            okBtn.onclick = () => {
                if (okBtn.disabled) return;
                cleanup(true);
                // F-UI-01:确认后执行调用方回调(重新导出/删除模板等),失败不吞错
                if (typeof onConfirm === "function") {
                    try {
                        onConfirm();
                    } catch (error) {
                        console.error("[LD-Notion] ConfirmationDialog onConfirm 执行失败:", error);
                    }
                }
            };

            // ESC 关闭
            const escHandler = (e) => {
                if (e.key === "Escape") {
                    cleanup(false);
                }
            };
            document.addEventListener("keydown", escHandler);
            // v3.14.7 (REV-16 UI-18): 焦点移入对话框(此前焦点留在背景按钮)
            if (!nameInput) cancelBtn.focus();
    },

    // 关闭对话框(外部关闭视为取消, resolve false)
    close: () => {
        const dialog = ConfirmationDialog.dialogElement;
        if (!dialog) return;
        if (typeof dialog._ldConfirmCleanup === "function") {
            dialog._ldConfirmCleanup(false);
            return;
        }
        // 兜底:无 cleanup 句柄时仍清 DOM / timer
        if (dialog._countdownTimer) {
            clearInterval(dialog._countdownTimer);
        }
        dialog.remove();
        ConfirmationDialog.dialogElement = null;
        const resolve = ConfirmationDialog._activeResolve;
        ConfirmationDialog._activeResolve = null;
        if (typeof resolve === "function") resolve(false);
        ConfirmationDialog._drainQueue();
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
        const pending = UndoManager.pendingUndo;
        if (!pending) return false;
        // dsf P1 共识: 先摘除再 await —— 撤销请求网络耗时期间重复点击不得重入执行同一撤销
        UndoManager.pendingUndo = null;
        if (UndoManager.timeoutId) {
            clearTimeout(UndoManager.timeoutId);
            UndoManager.timeoutId = null;
        }

        try {
            const description = pending?.description || "";
            await pending.undoAction();
            // P4 收敛: await 期间可能已注册新撤销 —— hideToast/clear 仅在无新入口时执行
            if (UndoManager.pendingUndo === null) {
                UndoManager.hideToast();
                UndoManager.clear();
            }

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
            // glm P1 共识: 入口已清 timeoutId, 失败路径不隐藏则 toast 永久滞留 DOM
            // P4 收敛: 但 await 期间新注册的撤销入口不得被隐藏
            if (UndoManager.pendingUndo === null) UndoManager.hideToast();
            const description = pending?.description || "";
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

        // 绑定撤销按钮（通过事件总线通知 UI，消除 security→ui 循环依赖）
        toast.querySelector("#ldb-undo-action").onclick = async () => {
            const success = await UndoManager.execute();
            if (success) {
                emit("notify", { message: "撤销成功", type: "success" });
            } else {
                emit("notify", { message: "撤销失败，请手动检查 Notion 中的变更", type: "error" });
            }
        };

        // 动画显示
        requestAnimationFrame(() => {
            toast.classList.add("visible");
        });
    },

    // 隐藏撤销提示
    hideToast: () => {
        // qwen P1 共识: 单例 _hideTimeout 会被下一次 hideToast 清除, 使前一个 toast
        // 的移除定时器永久丢失而滞留 DOM — 定时器改为按 toast 元素存放。
        const toast = UndoManager.toastElement;
        if (!toast) return;
        if (toast._hideTimer) clearTimeout(toast._hideTimer);
        toast.classList.remove("visible");
        toast._hideTimer = setTimeout(() => {
            toast.remove();
            if (UndoManager.toastElement === toast) {
                UndoManager.toastElement = null;
            }
        }, 300);
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
