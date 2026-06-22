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

const PanelResize = {
    _stylesInjected: false,

    injectStyles: () => {
        if (PanelResize._stylesInjected) return;
        PanelResize._stylesInjected = true;
        const style = document.createElement("style");
        style.textContent = `
            .ldb-resize-handle {
                position: absolute;
                z-index: 10;
            }
            .ldb-resize-handle-l {
                left: -3px; top: 0; width: 6px; height: 100%;
                cursor: ew-resize;
            }
            .ldb-resize-handle-t {
                left: 0; top: -3px; width: 100%; height: 6px;
                cursor: ns-resize;
            }
            .ldb-resize-handle-b {
                left: 0; bottom: -3px; width: 100%; height: 6px;
                cursor: ns-resize;
            }
            .ldb-resize-handle-tl {
                left: -3px; top: -3px; width: 12px; height: 12px;
                cursor: nwse-resize;
            }
            .ldb-resize-handle-bl {
                left: -3px; bottom: -3px; width: 12px; height: 12px;
                cursor: nesw-resize;
            }
        `;
        document.head.appendChild(style);
    },

    makeResizable: (element, options = {}) => {
        const {
            edges = ["l", "t"],
            storageKey = null,
            minWidth = 280,
            minHeight = 200,
            maxWidth = 800,
        } = options;

        PanelResize.injectStyles();

        edges.forEach(edge => {
            const handle = document.createElement("div");
            handle.className = `ldb-resize-handle ldb-resize-handle-${edge}`;
            element.appendChild(handle);

            handle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                const startWidth = element.offsetWidth;
                const startHeight = element.offsetHeight;
                document.body.style.userSelect = "none";
                element.style.transition = "none";

                const onMove = (ev) => {
                    if (edge.includes("l")) {
                        const dx = startX - ev.clientX;
                        element.style.width = Math.max(minWidth, Math.min(maxWidth, startWidth + dx)) + "px";
                    }
                    if (edge.includes("t")) {
                        const dy = startY - ev.clientY;
                        const maxH = window.innerHeight * 0.9;
                        element.style.maxHeight = Math.max(minHeight, Math.min(maxH, startHeight + dy)) + "px";
                    }
                    if (edge.includes("b")) {
                        const dy = ev.clientY - startY;
                        const maxH = window.innerHeight * 0.9;
                        element.style.maxHeight = Math.max(minHeight, Math.min(maxH, startHeight + dy)) + "px";
                    }
                };

                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    document.body.style.userSelect = "";
                    element.style.transition = "";
                    if (storageKey) {
                        Storage.set(storageKey, JSON.stringify({
                            width: element.style.width,
                            maxHeight: element.style.maxHeight,
                        }));
                    }
                };

                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });
        });

        // 恢复已保存的尺寸
        if (storageKey) {
            const saved = Storage.get(storageKey, null);
            if (saved) {
                try {
                    const size = JSON.parse(saved);
                    if (size.width) element.style.width = size.width;
                    if (size.maxHeight) element.style.maxHeight = size.maxHeight;
                } catch (e) {
                    console.warn("[LD-Notion] corrupted panel size, resetting:", storageKey);
                    Storage.remove(storageKey);
                }
            }
        }
    },
};

;

module.exports = { PanelResize };
