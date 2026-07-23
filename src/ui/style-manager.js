"use strict";

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
