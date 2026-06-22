"use strict";

// 依赖引入
const { CONFIG, MSG } = require("../config");
const { Utils } = require("../utils");
const { Storage, SyncState } = require("../storage");
const { CredentialVault, NotionOAuth, TargetState } = require("../auth");
const { NotionAPI, DOMToNotion, SiteDetector, InstallHelper, HTMLToMarkdown, ObsidianAPI, EMOJI_MAP } = require("../api");
const { OperationGuard, UndoManager, OperationLog, ConfirmationDialog } = require("../security");
const { ZhihuAPI, GenericExtractor, WorkspaceService } = require("../extract");
const { Exporter, LinuxDoAPI, GenericExporter } = require("../export");
const { AutoImporter, UpdateChecker, GitHubAutoImporter, GitHubAPI, GitHubExporter } = require("../import");

const StyleManager = {
    injectOnce: (styleId, cssText) => {
        if (!styleId || !cssText) return null;
        const root = document.head || document.documentElement;
        if (!root) return null;

        const existing = document.getElementById(styleId);
        if (existing) return existing;

        const style = document.createElement("style");
        style.id = styleId;
        style.setAttribute("data-ldb-style", styleId);
        style.textContent = cssText;
        root.appendChild(style);
        return style;
    },
};
;

module.exports = { StyleManager };
