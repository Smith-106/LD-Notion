"use strict";

const { Storage } = require("../storage");

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
            /* Odyssey UI L: 手柄为 div,全局 button:focus-visible 不生效,需自带焦点环 */
            .ldb-resize-handle:focus-visible {
                outline: 2px solid var(--ldb-ui-focus-ring);
                outline-offset: -2px;
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

        // F-UI-18:重置面板尺寸(清除持久化尺寸并恢复默认)
        // v3.14.7 (REV-22 UI-21): resetSize 改按 storageKey 注册——此前每次 makeResizable
        // 都覆盖全局 resetSize 闭包, 多面板时后初始化者覆盖前者(每页单面板场景无实发,
        // 属潜在缺陷)。注册表内找到该面板即重置, 找不到(无 storageKey)时回退首个面板。
        PanelResize._resizeTargets = PanelResize._resizeTargets || new Map();
        if (storageKey) {
            PanelResize._resizeTargets.set(storageKey, element);
        }
        PanelResize.resetSize = (key) => {
            const targets = PanelResize._resizeTargets || new Map();
            const target = (key && targets.get(key)) || (targets.size > 0 ? targets.values().next().value : null);
            if (key) Storage.remove(key);
            if (target) {
                target.style.width = "";
                target.style.maxHeight = "";
            }
        };

        PanelResize.injectStyles();

        const maxViewportHeight = () => Math.round(window.innerHeight * 0.9);

        edges.forEach(edge => {
            const handle = document.createElement("div");
            handle.className = `ldb-resize-handle ldb-resize-handle-${edge}`;
            handle.setAttribute("tabindex", "0");
            handle.setAttribute("role", "slider");
            // Odyssey UI L: 垂直手柄(t/b)实调高度,label 与 aria 范围按轴区分
            const vertical = edge === "t" || edge === "b";
            handle.setAttribute("aria-label", vertical ? "调整面板高度" : "调整面板宽度");
            handle.setAttribute("aria-valuemin", vertical ? minHeight : minWidth);
            handle.setAttribute("aria-valuemax", vertical ? maxViewportHeight() : maxWidth);
            // Odyssey UI L: 创建时以当前尺寸初始化 valuenow,辅助技术首读不再为空
            handle.setAttribute("aria-valuenow", String(vertical ? element.offsetHeight : element.offsetWidth));
            element.appendChild(handle);

            const syncValueNow = () => {
                // Odyssey Review F7(flash+ox): 垂直轴键盘写的是 style.maxHeight,
                // 内容不足时 offsetHeight 不随按键变化 — 改读已钘制的 maxHeight 解析值
                if (vertical) {
                    const parsedMax = parseFloat(element.style.maxHeight);
                    handle.setAttribute("aria-valuenow", String(!Number.isNaN(parsedMax) && parsedMax > 0 ? Math.round(parsedMax) : element.offsetHeight));
                } else {
                    handle.setAttribute("aria-valuenow", String(element.offsetWidth));
                }
            };

            const persist = () => {
                if (!storageKey) return;
                Storage.set(storageKey, JSON.stringify({
                    width: element.style.width,
                    maxHeight: element.style.maxHeight,
                }));
            };

            // 键盘支持:水平轴用 Left/Right 调宽,垂直轴用 Up/Down 调高
            handle.addEventListener("keydown", (e) => {
                const step = 10;
                let handled = false;

                if (vertical) {
                    // Odyssey Review F7(hy3): 视口尺寸随窗口变化,valuemax 与 End 上限实时计算
                    const liveMax = maxViewportHeight();
                    handle.setAttribute("aria-valuemax", String(liveMax));
                    let newHeight = element.offsetHeight;
                    if (e.key === 'ArrowUp') {
                        newHeight = Math.min(liveMax, newHeight + step);
                        handled = true;
                    } else if (e.key === 'ArrowDown') {
                        newHeight = Math.max(minHeight, newHeight - step);
                        handled = true;
                    } else if (e.key === 'Home') {
                        newHeight = minHeight;
                        handled = true;
                    } else if (e.key === 'End') {
                        newHeight = liveMax;
                        handled = true;
                    }
                    if (handled) {
                        e.preventDefault();
                        element.style.maxHeight = newHeight + 'px';
                        syncValueNow();
                        persist();
                    }
                } else {
                    let newWidth = element.offsetWidth;
                    if (e.key === 'ArrowRight') {
                        newWidth = Math.min(maxWidth, element.offsetWidth + step);
                        handled = true;
                    } else if (e.key === 'ArrowLeft') {
                        newWidth = Math.max(minWidth, element.offsetWidth - step);
                        handled = true;
                    } else if (e.key === 'Home') {
                        newWidth = minWidth;
                        handled = true;
                    } else if (e.key === 'End') {
                        newWidth = maxWidth;
                        handled = true;
                    }
                    if (handled) {
                        e.preventDefault();
                        element.style.width = newWidth + 'px';
                        syncValueNow();
                        persist();
                    }
                }
            });

            // Odyssey UI Q: pointer events + setPointerCapture 替代 document mouse 监听
            // 触屏可拉伸,且不再占用 document 全局监听。
            handle.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                const startWidth = element.offsetWidth;
                const startHeight = element.offsetHeight;
                document.body.style.userSelect = "none";
                element.style.transition = "none";
                try { handle.setPointerCapture(e.pointerId); } catch (_) { /* 旧浏览器降级 */ }

                const onMove = (ev) => {
                    if (edge.includes("l")) {
                        const dx = startX - ev.clientX;
                        element.style.width = Math.max(minWidth, Math.min(maxWidth, startWidth + dx)) + "px";
                    }
                    if (edge.includes("t")) {
                        const dy = startY - ev.clientY;
                        element.style.maxHeight = Math.max(minHeight, Math.min(maxViewportHeight(), startHeight + dy)) + "px";
                    }
                    if (edge.includes("b")) {
                        const dy = ev.clientY - startY;
                        element.style.maxHeight = Math.max(minHeight, Math.min(maxViewportHeight(), startHeight + dy)) + "px";
                    }
                };

                const endResize = (ev) => {
                    handle.removeEventListener("pointermove", onMove);
                    handle.removeEventListener("pointerup", endResize);
                    handle.removeEventListener("pointercancel", endResize);
                    document.body.style.userSelect = "";
                    element.style.transition = "";
                    try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* 旧浏览器降级 */ }
                    syncValueNow();
                    persist();
                };

                handle.addEventListener("pointermove", onMove);
                handle.addEventListener("pointerup", endResize);
                handle.addEventListener("pointercancel", endResize);
            });
        });

        // 恢复已保存的尺寸
        // Odyssey UI L + Review F7(hy3): 恢复时按当前视口软钳制。优先级说明:
        // 无 !important 的内联 max-height 会被 ≤480px 断点的 max-height:70vh !important 覆盖,
        // 此处钳制主要保护非移动端与恢复期布局。
        if (storageKey) {
            const saved = Storage.get(storageKey, null);
            if (saved) {
                try {
                    const size = JSON.parse(saved);
                    if (size.width) {
                        const savedWidth = parseFloat(size.width);
                        if (!Number.isNaN(savedWidth)) {
                            element.style.width = Math.min(savedWidth, window.innerWidth - 16) + "px";
                        }
                    }
                    if (size.maxHeight) {
                        const savedMaxHeight = parseFloat(size.maxHeight);
                        if (!Number.isNaN(savedMaxHeight)) {
                            element.style.maxHeight = Math.min(savedMaxHeight, window.innerHeight * 0.9) + "px";
                        }
                    }
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
