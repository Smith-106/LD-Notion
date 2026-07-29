"use strict";

const { OperationGuard } = require("../security");

const GuardedWrite = {

    _resolveGuardApiKey: (settingsOrApiKey, fallbackApiKey) => {
        if (typeof settingsOrApiKey === "string" && settingsOrApiKey) {
            return settingsOrApiKey;
        }
        if (settingsOrApiKey?.notionApiKey) {
            return settingsOrApiKey.notionApiKey;
        }
        if (settingsOrApiKey?.apiKey) {
            return settingsOrApiKey.apiKey;
        }
        return fallbackApiKey;
    },

    _buildGuardContext: (context = {}, settingsOrApiKey) => {
        const guardContext = { ...context };
        const apiKey = GuardedWrite._resolveGuardApiKey(settingsOrApiKey, guardContext.apiKey);
        if (apiKey) {
            guardContext.apiKey = apiKey;
        }
        if (!guardContext.itemName && guardContext.pageId) {
            guardContext.itemName = guardContext.pageId;
        }
        return guardContext;
    },

    _executeGuardedWrite: async (operation, executor, context = {}, settingsOrApiKey) => {
        return await OperationGuard.execute(
            operation,
            executor,
            GuardedWrite._buildGuardContext(context, settingsOrApiKey)
        );
    },

    _executeGuardedPageWrite: async (operation, target, executor, settingsOrApiKey, context = {}) => {
        const pageId = context.pageId || target?.id || "";
        const itemName = context.itemName || target?.name || target?.id || pageId || "未知页面";
        return await GuardedWrite._executeGuardedWrite(
            operation,
            executor,
            { ...context, itemName, pageId },
            settingsOrApiKey
        );
    },

    _executeGuardedDatabaseWrite: async (operation, databaseId, executor, settingsOrApiKey, context = {}) => {
        return await GuardedWrite._executeGuardedWrite(
            operation,
            executor,
            {
                ...context,
                itemName: context.itemName || databaseId,
                databaseId: context.databaseId || databaseId,
            },
            settingsOrApiKey
        );
    },


};

module.exports = { GuardedWrite };
