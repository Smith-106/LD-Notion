import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";

// P4 收敛轮第四批回归 (wave4 c01-c12 全库复审确认修复的锁定用例)。
const { BlockConverter } = require("../src/ai/BlockConverter.js");
const { AIService } = require("../src/ai/index.js");
const { getMimeType, getFileCategory } = require("../src/config");
const { getMimeType: uploadGetMimeType } = require("../src/api/notion-upload.js");
const { Storage } = require("../src/storage");

const read = (p) => fs.readFileSync(p, "utf8");

describe("P4 收敛(c01): BlockConverter 语言映射与代理对切分", () => {
    it("代码围栏语言为原型链键时回落 plain text", () => {
        const blocks = BlockConverter.textToBlocks("```constructor\nx\n```");
        expect(blocks[0].code.language).toBe("plain text");
        const blocks2 = BlockConverter.textToBlocks("```__proto__\nx\n```");
        expect(blocks2[0].code.language).toBe("plain text");
    });

    it("已知缩写仍映射(js → javascript)", () => {
        const blocks = BlockConverter.textToBlocks("```js\nx\n```");
        expect(blocks[0].code.language).toBe("javascript");
    });

    it("超长文本切分不切断代理对", () => {
        const emoji = "😀"; // 2 码元
        const text = "a".repeat(1999) + emoji + "b".repeat(10);
        const payload = BlockConverter.buildBlockUpdatePayload(
            { id: "b1", type: "paragraph", paragraph: { rich_text: [] } },
            text
        );
        const joined = payload.paragraph.rich_text.map((rt) => rt.text.content).join("");
        expect(joined).toBe(text);
        for (const rt of payload.paragraph.rich_text) {
            const last = rt.text.content.charCodeAt(rt.text.content.length - 1);
            expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
        }
    });
});

describe("P4 收敛(c03): 模型缓存指纹", () => {
    const KEY = "ldb_ai_base_url";
    const AKEY = "ldb_ai_api_key";
    const savedBase = Storage.get(KEY, "");
    const savedKey = Storage.get(AKEY, "");
    afterEach(() => {
        Storage.set(KEY, savedBase);
        Storage.set(AKEY, savedKey);
    });

    it("端点变更后缓存失效, 密钥变更同样失效(指纹为单向哈希)", () => {
        Storage.set(KEY, "https://a.example.com/v1");
        Storage.set(AKEY, "sk-aaa");
        AIService.persistFetchedModels("openai", ["m1"]);
        expect(AIService.getCachedModels("openai")).toEqual(["m1"]);

        Storage.set(KEY, "https://b.example.com/v1");
        expect(AIService.getCachedModels("openai")).toEqual([]);

        Storage.set(KEY, "https://a.example.com/v1");
        AIService.persistFetchedModels("openai", ["m2"]);
        Storage.set(AKEY, "sk-bbb");
        expect(AIService.getCachedModels("openai")).toEqual([]);
    });
});

describe("P4 收敛(c07): 扩展名映射原型链键", () => {
    it("config getMimeType/getFileCategory 不返回继承属性", () => {
        expect(getMimeType("constructor")).toBe("application/octet-stream");
        expect(getFileCategory("toString")).toBe("file");
        expect(getMimeType("png")).toBe("image/png");
        expect(getFileCategory("mp4")).toBe("video");
    });

    it("notion-upload getMimeType 同口径", () => {
        expect(uploadGetMimeType("constructor")).toBe("application/octet-stream");
        expect(uploadGetMimeType("png")).toBe("image/png");
    });
});

describe("P4 收敛(c08): Discourse 主题 URL 取数字 ID", () => {
    const extract = (pathname) => {
        const segs = pathname.split("/").filter(Boolean);
        const tIndex = segs.indexOf("t");
        const numeric = tIndex >= 0 ? segs.slice(tIndex + 1).find((s) => /^\d+$/.test(s)) : null;
        return numeric || pathname.match(/\/t\/([^/]+)/)?.[1] || "";
    };

    it("slug 形式与纯数字形式均取到主题 ID", () => {
        expect(extract("/t/topic-slug/12345")).toBe("12345");
        expect(extract("/t/12345")).toBe("12345");
        expect(extract("/t/12345/7")).toBe("12345");
        expect(extract("/t/topic-slug/12345/7")).toBe("12345");
        expect(extract("/t/some-2-things/999")).toBe("999");
    });

    it("源码优先取数字段", () => {
        expect(read("src/export/index.js")).toContain('pathSegments.slice(tIndex + 1).find((seg) => /^\\d+$/.test(seg))');
    });
});

describe("P4 收敛(c01/c02/c05/c06/c07/c12): 源码级锁定", () => {
    it("SyncCoordinator 注册标志在 require 成功之后置位", () => {
        const src = read("src/adapter/SyncCoordinator.js");
        const body = src.slice(src.indexOf("function ensureAdaptersRegistered"));
        expect(body.indexOf('require("./index")')).toBeLessThan(body.indexOf("_adaptersRegistered = true"));
    });

    it("批量翻译循环有 REQUEST_DELAY 节流", () => {
        const src = read("src/ai/handlers/batch.js");
        expect(src).toMatch(/if \(delay > 0 && i < pages\.length - 1\) \{\s*await Utils\.sleep\(delay\);/);
    });

    it("分类统计用 null 原型对象 + 意图 limit 归一", () => {
        const src = read("src/ai/handlers/query.js");
        expect(src).toContain("const categoryCount = Object.create(null);");
        expect(src).toMatch(/const normalizeLimit = \(value, fallback = 10, max = 100\) => \{/);
        expect(src).toContain("return Math.max(1, Math.min(Math.floor(n), max));");
        expect(src).toMatch(/const limit = normalizeLimit\(rawLimit, 10\);/);
    });

    it("摘要风格白名单 + 模板形状校验", () => {
        const src = read("src/ai/handlers/content.js");
        expect(src).toContain("Object.prototype.hasOwnProperty.call(styleInstructions, style)");
        expect(src).toContain('if (!Array.isArray(templates) || templates.some((t) => !t || typeof t !== "object" || typeof t.name !== "string")) {');
    });

    it("fetchPageBlocks 有游标去重与页数上限", () => {
        const src = read("src/ai/index.js");
        const start = src.indexOf("fetchPageBlocks: async (pageId");
        const end = src.indexOf("extractText: (blocks)", start);
        const body = src.slice(start, end > start ? end : start + 1200);
        expect(body).toContain("const seenCursors = new Set();");
        expect(body).toContain("} while (cursor && pageCount < MAX_PAGES);");
    });

    it("duplicatePage 排除 formula/rollup/unique_id 只读属性", () => {
        const src = read("src/api/index.js");
        expect(src).toMatch(/READONLY_PROPERTY_TYPES = new Set\(\[[\s\S]*?"formula", "rollup", "unique_id"/);
    });

    it("自动同步失败审计操作名随分支", () => {
        const src = read("src/bridge/BookmarkAutoImporter.js");
        expect(src).toContain('let auditOp = "createDatabasePage";');
        expect(src).toMatch(/auditOp = "updatePage";/);
        expect(src).toMatch(/_auditAutoSync\(auditOp, "failed",/);
    });

    it("OAuth 已连接分支清空输入框前校验焦点", () => {
        const src = read("src/auth/index.js");
        expect(src).toMatch(/if \(NotionOAuth\.isOAuthConnected\(\)\) \{\s*\/\/ P4 收敛\(c06\)[\s\S]*?if \(document\.activeElement !== input\) \{/);
    });

    it("导出账本容量淘汰在 rebase 之后执行", () => {
        const src = read("src/bridge/BookmarkExporter.js");
        const mergedIdx = src.indexOf("BookmarkExporter._exportedCache = merged;");
        const evictIdx = src.indexOf("BookmarkExporter._evictByCapacity(merged);");
        expect(mergedIdx).toBeGreaterThan(-1);
        expect(evictIdx).toBeGreaterThan(mergedIdx);
    });

    it("桥接 pendingRequests 查找校验自有属性", () => {
        const src = read("src/bridge/index.js");
        expect(src).toContain("Object.prototype.hasOwnProperty.call(BookmarkBridge._pendingRequests, requestId)");
    });

    it("SyncScheduler runner 查找校验自有属性", () => {
        const src = read("src/adapter/SyncScheduler.js");
        expect(src).toContain("Object.prototype.hasOwnProperty.call(SOURCE_RUNNERS, sourceType)");
    });

    it("确认框自身带上生效主题属性(否则显式暗色下仍是亮色)", () => {
        const src = read("src/security/index.js");
        expect(src).toContain('dialogPanel.setAttribute("data-ldb-theme", themedRoot.getAttribute("data-ldb-theme"));');
        const css = read("src/ui/design-system.js");
        expect(css).toContain('[data-ldb-theme="dark"].ldb-confirm-dialog,');
        expect(css).toContain('[data-ldb-theme="dark"] .ldb-confirm-dialog {');
    });
});
