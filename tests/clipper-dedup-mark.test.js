"use strict";

/**
 * Zhihu/Generic clipper：导出成功后必须写入 DedupStore，避免连点重复建页。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;

// Minimal DOM globals for SiteDetector / location
global.window = global;
global.location = { href: "https://www.zhihu.com/question/1/answer/2", hostname: "www.zhihu.com", pathname: "/question/1/answer/2" };
global.document = { title: "q", querySelector: () => null, querySelectorAll: () => [] };

const { DedupStore } = require("../src/storage");
const { GenericExporter } = require("../src/export");
const { SiteDetector } = require("../src/api");

beforeEach(() => {
    store.clear();
    global.location.href = "https://www.zhihu.com/question/1/answer/2";
    global.location.hostname = "www.zhihu.com";
});

describe("GenericExporter clipper DedupStore", () => {
    it("resolveClipperDedup 与 ZhihuAdapter 键同构", () => {
        vi.spyOn(SiteDetector, "detect").mockReturnValue(SiteDetector.SITES.ZHIHU);
        const { sourceType, dedupKey } = GenericExporter.resolveClipperDedup({
            url: "https://www.zhihu.com/question/1/answer/2",
            source: "知乎",
        });
        expect(sourceType).toBe("zhihu");
        expect(dedupKey).toBe("zhihu:https://www.zhihu.com/question/1/answer/2");
    });

    it("resolveClipperDedup generic 键同构", () => {
        vi.spyOn(SiteDetector, "detect").mockReturnValue(SiteDetector.SITES.GENERIC);
        const { sourceType, dedupKey } = GenericExporter.resolveClipperDedup({
            url: "https://example.com/a",
        });
        expect(sourceType).toBe("generic");
        expect(dedupKey).toBe("generic:https://example.com/a");
    });

    it("markClipperExported 后 isClipperExported 为 true", () => {
        vi.spyOn(SiteDetector, "detect").mockReturnValue(SiteDetector.SITES.ZHIHU);
        const meta = { url: "https://www.zhihu.com/question/9/answer/8", source: "知乎" };
        expect(GenericExporter.isClipperExported(meta)).toBe(false);
        GenericExporter.markClipperExported(meta);
        expect(GenericExporter.isClipperExported(meta)).toBe(true);
        expect(DedupStore.isDuplicate("zhihu", "zhihu:https://www.zhihu.com/question/9/answer/8")).toBe(true);
    });
});
