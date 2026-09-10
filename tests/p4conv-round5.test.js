"use strict";

import { describe, it, expect } from "vitest";

// P4 收敛 wave4 第二批回归: c09/c10/c11 同步与安全 + c04 分页 + c03/c05 输出净化。
// 覆盖: 原型污染防护 / 行预算兜底 / 空明文 GCM / 状态解析健壮性 /
//       审计失败隔离 / 分页助手 / 代理对切分 / 端点注入 / 模型路径编码 / 复选框真值。

const { SyncPayload } = require("../src/sync/SyncPayload");
const { SyncEngine } = require("../src/sync/SyncEngine");
const { SyncCrypto } = require("../src/sync/SyncCrypto");
const { SyncStateV2 } = require("../src/storage/SyncState");
const { Storage } = require("../src/storage");
const { OperationGuard, OperationLog, UndoManager, ConfirmationDialog } = require("../src/security");
const { NotionAPI, NotionTransport, DOMToNotion } = require("../src/api");
const { AIService, AIAssistant } = require("../src/ai");
const { NotionOAuth } = require("../src/auth");
const { queryAllPages, searchAllDatabases } = require("../src/ai/tools/paginate");

const read = (p) => require("fs").readFileSync(p, "utf8");

describe("P4 收敛(c11): SyncPayload.merge 原型污染防护", () => {
    it("远端 settings 的 own __proto__ 键被丢弃且不污染原型", () => {
        const remote = JSON.parse('{"schemaVersion":1,"deviceId":"r","updatedAt":"2026-01-01T00:00:00Z","version":1,"settings":{"__proto__":{"polluted":true},"theme":{"value":"dark","updatedAt":"2026-01-01T00:00:00Z"}}}');
        const out = SyncPayload.merge({ schemaVersion: 1, deviceId: "l", updatedAt: "", version: 0, dedup: {}, watermarks: {}, settings: {} }, remote);
        expect(Object.keys(out.settings).sort()).toEqual(["theme"]);
        expect(Object.getPrototypeOf(out.settings)).toBe(null);
        expect({}.polluted).toBeUndefined();
        expect(out.settings.polluted).toBeUndefined();
    });

    it("dedup/watermarks 的危险键同样被过滤", () => {
        const remote = JSON.parse('{"schemaVersion":1,"deviceId":"r","updatedAt":"","version":1,"dedup":{"__proto__":{"a":1},"linuxdo":{"u":2}},"watermarks":{"constructor":{"epoch":9}}}');
        const out = SyncPayload.merge({ schemaVersion: 1, deviceId: "l", updatedAt: "", version: 0, dedup: {}, watermarks: {}, settings: {} }, remote);
        expect(Object.keys(out.dedup)).toEqual(["linuxdo"]);
        expect(Object.keys(out.watermarks)).toEqual([]);
        expect(Object.getPrototypeOf(out.dedup)).toBe(null);
    });

    it("常规合并语义不变(幂等/交换)", () => {
        const a = { schemaVersion: 1, deviceId: "a", updatedAt: "2026-01-01T00:00:00Z", version: 2, dedup: { linuxdo: { x: 5 } }, watermarks: {}, settings: {} };
        const b = { schemaVersion: 1, deviceId: "b", updatedAt: "2026-01-02T00:00:00Z", version: 3, dedup: { linuxdo: { x: 9, y: 1 } }, watermarks: {}, settings: {} };
        const ab = SyncPayload.merge(a, b);
        const ba = SyncPayload.merge(b, a);
        expect(ab.dedup.linuxdo).toEqual({ x: 9, y: 1 });
        expect(ab.dedup.linuxdo).toEqual(ba.dedup.linuxdo);
        expect(ab.version).toBe(3);
    });
});

describe("P4 收敛(c11): _enforceRowBudget 兜底", () => {
    it("watermark 开销挤占预算时丢弃 dedup 集, 行回落到预算内", () => {
        const bigSet = {};
        for (let i = 0; i < 400; i++) bigSet[`key-${i}`] = Date.now();
        const bigIds = [];
        for (let i = 0; i < 400; i++) bigIds.push(`id-${i}`);
        const row = {
            kind: "dedup",
            key: "linuxdo",
            version: 1,
            updatedAt: "2026-01-01T00:00:00Z",
            deviceId: "d",
            payload: {
                dedup: { linuxdo: bigSet },
                watermarks: { linuxdo: { epoch: 1, time: "2026-01-01T00:00:00Z", ids: bigIds } },
            },
        };
        const out = SyncEngine._enforceRowBudget([row]);
        expect(out.length).toBe(1);
        const payloadLen = JSON.stringify(out[0].payload || {}).length;
        expect(payloadLen).toBeLessThanOrEqual(1900);
    });
});

describe("P4 收敛(c10): 同步状态与密文边界", () => {
    it("Node 回退路径可解密空明文(ct 仅 16 字节 GCM 标签)", async () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
        try {
            Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true, writable: true });
            const blob = await SyncCrypto.encryptBlob("pw-123", "");
            const plain = await SyncCrypto.decryptBlob("pw-123", blob);
            expect(plain).toBe("");
            await expect(SyncCrypto.decryptBlob("wrong", blob)).rejects.toThrow("口令错误或数据损坏");
        } finally {
            if (original) Object.defineProperty(globalThis, "crypto", original);
            else delete globalThis.crypto;
        }
    }, 60000);

    it("AUTO_SYNC_STATE 为非对象 JSON 时不抛错并回落默认状态", () => {
        SyncStateV2._cache = null;
        GM_setValue("ldb_auto_sync_state", "true");
        const state = SyncStateV2._load();
        expect(typeof state).toBe("object");
        expect(Array.isArray(state)).toBe(false);
        expect(state.sources).toBeTruthy();
        SyncStateV2._cache = null;
        GM_setValue("ldb_auto_sync_state", "[1,2,3]");
        const state2 = SyncStateV2._load();
        expect(Array.isArray(state2)).toBe(false);
        expect(state2.sources).toBeTruthy();
        SyncStateV2._cache = null;
    });

    it("legacy 导出账本为非对象 JSON 时不污染去重键", () => {
        Storage._exportedTopicsMigrated = false;
        GM_setValue("ldb_exported_topics", "null");
        expect(() => Storage._migrateLegacyExportedTopics()).not.toThrow();
        Storage._exportedTopicsMigrated = false;
        GM_setValue("ldb_exported_topics", "\"foo\"");
        expect(() => Storage._migrateLegacyExportedTopics()).not.toThrow();
        const seen = require("../src/storage").DedupStore.getSeen("linuxdo") || {};
        expect(Object.keys(seen)).not.toContain("0");
    });
});

describe("P4 收敛(c10): OperationGuard 审计失败隔离", () => {
    it("审计写入抛错时写操作仍算成功并注册撤销", async () => {
        const originalAdd = OperationLog.add;
        const registered = [];
        const originalRegister = UndoManager.register;
        const originalLevel = OperationGuard.getLevel();
        const originalConfirm = ConfirmationDialog.show;
        OperationLog.add = (entry) => {
            // 仅拦写操作成功后的审计(allow 决策审计在写入前, 失败应当 fail-closed)
            if (entry && entry.result && entry.result.status === "success") throw new Error("storage quota exceeded");
        };
        UndoManager.register = (entry) => { registered.push(entry); return entry; };
        ConfirmationDialog.show = async () => true;
        OperationGuard.setLevel(2);
        try {
            const result = await OperationGuard.execute(
                "deletePage",
                async () => ({ id: "p1" }),
                { pageId: "p1", itemName: "测试页面", trigger: "user_requested_write" }
            );
            expect(result).toEqual({ id: "p1" });
            expect(registered.length).toBe(1);
        } finally {
            OperationLog.add = originalAdd;
            UndoManager.register = originalRegister;
            ConfirmationDialog.show = originalConfirm;
            OperationGuard.setLevel(originalLevel);
        }
    });
});

describe("P4 收敛(c04): 查询分页助手", () => {
    it("queryAllPages 逐页取全并上报截断", async () => {
        const calls = [];
        const original = NotionAPI.request;
        let page = 0;
        NotionAPI.request = async (method, endpoint, body) => {
            calls.push(body);
            page++;
            return { results: [{ id: `p${page}` }], has_more: page < 3, next_cursor: `c${page}` };
        };
        try {
            const { results, truncated } = await queryAllPages({ dbId: "db1", apiKey: "k", body: { page_size: 50 } });
            expect(results.length).toBe(3);
            expect(truncated).toBe(false);
            expect(calls[0].start_cursor).toBeUndefined();
            expect(calls[1].start_cursor).toBe("c1");
        } finally {
            NotionAPI.request = original;
        }
    });

    it("queryAllPages 游标重复时停止, 不死循环", async () => {
        const original = NotionAPI.request;
        NotionAPI.request = async () => ({ results: [{ id: "x" }], has_more: true, next_cursor: "same" });
        try {
            const { results } = await queryAllPages({ dbId: "db1", apiKey: "k", body: {} });
            expect(results.length).toBe(2);
        } finally {
            NotionAPI.request = original;
        }
    });

    it("searchAllDatabases 分页发现数据库", async () => {
        const original = NotionAPI.search;
        let page = 0;
        NotionAPI.search = async () => {
            page++;
            return { results: [{ id: `db${page}` }], has_more: page < 2, next_cursor: `c${page}` };
        };
        try {
            const { results, truncated } = await searchAllDatabases({ apiKey: "k" });
            expect(results.length).toBe(2);
            expect(truncated).toBe(false);
        } finally {
            NotionAPI.search = original;
        }
    });
});

describe("P4 收敛(c05/c03): 输出净化与端点/模型校验", () => {
    it("DOMToNotion.splitLongText 不拆散代理对", () => {
        const emoji = "😀";
        const text = "a".repeat(1999) + emoji + "b";
        const chunks = DOMToNotion.splitLongText(text);
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            const content = chunk.text.content;
            for (let i = 0; i < content.length; i++) {
                const code = content.charCodeAt(i);
                if (code >= 0xd800 && code <= 0xdbff) {
                    const next = content.charCodeAt(i + 1);
                    expect(next >= 0xdc00 && next <= 0xdfff).toBe(true);
                }
            }
        }
        expect(chunks.map(c => c.text.content).join("")).toContain(emoji);
    });

    it("NotionTransport.buildUrl 拒路径穿越/片段注入, 保留合法游标查询", () => {
        expect(NotionTransport.buildUrl("/pages/abc")).toBe("https://api.notion.com/v1/pages/abc");
        expect(NotionTransport.buildUrl("/blocks/abc/children?start_cursor=xyz")).toContain("?start_cursor=xyz");
        expect(() => NotionTransport.buildUrl("/pages/../../users/me")).toThrow("非法 Notion API 端点");
        expect(() => NotionTransport.buildUrl("/pages/abc#frag")).toThrow("非法 Notion API 端点");
        expect(() => NotionTransport.buildUrl("pages/abc")).toThrow("非法 Notion API 端点");
        expect(() => NotionTransport.buildUrl("/pages/a b")).toThrow("非法 Notion API 端点");
        // wave14 共识(dsf): 百分号编码的 dot-segment / 斜线同样穿透路径检查
        expect(() => NotionTransport.buildUrl("/pages/%2e%2e/users/me")).toThrow("非法 Notion API 端点");
        expect(() => NotionTransport.buildUrl("/pages/%2E%2E/users/me")).toThrow("非法 Notion API 端点");
        expect(() => NotionTransport.buildUrl("/pages/%2e/users/me")).toThrow("非法 Notion API 端点");
        expect(() => NotionTransport.buildUrl("/pages/a%2fb/children")).toThrow("非法 Notion API 端点");
        // 查询串里的百分号编码是合法游标内容, 不受影响
        expect(NotionTransport.buildUrl("/blocks/abc/children?start_cursor=a%2Fb")).toContain("start_cursor=a%2Fb");
    });

    it("AIService._modelPathSegment 编码模型名", () => {
        expect(AIService._modelPathSegment("gemini-2.0-flash")).toBe("gemini-2.0-flash");
        expect(AIService._modelPathSegment("a/b?c#d")).toBe("a%2Fb%3Fc%23d");
        expect(AIService._modelPathSegment(undefined)).toBe("");
    });

    it("checkbox 消费 schema 校验结果: 字符串 false 不再写 true", () => {
        expect(AIAssistant._buildPropertyValuePayload("false", "checkbox")).toEqual({ checkbox: false });
        expect(AIAssistant._buildPropertyValuePayload("true", "checkbox")).toEqual({ checkbox: true });
        expect(AIAssistant._buildPropertyValuePayload(true, "checkbox")).toEqual({ checkbox: true });
        expect(AIAssistant._buildPropertyValuePayload(1, "checkbox")).toEqual({ checkbox: true });
    });

    it("_buildPageUpdatePayloads 拒危险属性名", () => {
        const built = AIAssistant._buildPageUpdatePayloads({ property: "__proto__", value: "x", type: "text" });
        expect(built.error).toContain("属性名不合法");
        const ok = AIAssistant._buildPageUpdatePayloads({ property: "标签", value: "x", type: "text" });
        expect(ok.error).toBeUndefined();
        expect(Object.keys(ok.propertyUpdates)).toEqual(["标签"]);
    });

    it("OAuth clientSecret 读取层剥离隐形字符", () => {
        Storage.set("ldb_notion_oauth_client_secret", "secret_\u200babc\u200d");
        const config = NotionOAuth.getConfig();
        expect(config.clientSecret).toBe("secret_abc");
    });
});

describe("P4 收敛(c06/c08/c09): 源码级契约锁定", () => {
    it("RSS needsUpdate 与写入侧同口径", () => {
        // P4 收敛(c07 续): 写入侧 safeUrl 为空时不发「链接」字段 —— 仅在本次有可写链接时才比对
        const src = read("src/bridge/RSSAutoImporter.js");
        expect(src).toContain("const safeUrl = RSSAutoImporter._safeUrl(item.url);");
        expect(src).toContain('if (safeUrl && String(pageMeta.url || "") !== safeUrl) return true;');
    });

    it("BookmarkExporter strict 批内去重", () => {
        expect(read("src/bridge/BookmarkExporter.js")).toContain("const seenUrls = new Set();");
    });

    it("上传替换前捕获 caption", () => {
        expect(read("src/export/index.js")).toContain('const originalCaption = block._fileType === "file" ? block.file?.caption : null;');
    });

    it("手动 GitHub 导出取跨 tab 租约并释放", () => {
        const src = read("src/import/GitHubExporter.js");
        expect(src).toContain("lease = await SyncLock.acquireLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE);");
        expect(src).toContain("SyncLock.releaseLease(CONFIG.STORAGE_KEYS.AUTO_SYNC_LEASE, lease);");
        expect(src).toContain("const hasMore = response.has_more === true;");
        expect(src).toContain("还有更多待分类条目，请再次运行以继续");
    });

    it("自动导入 finally 仅在本次置位时复位互斥", () => {
        expect(read("src/import/GitHubAutoImporter.js")).toContain("if (exportMutexAcquired) SyncLock.isExporting = false;");
        expect(read("src/bridge/BookmarkAutoImporter.js")).toContain("if (exportMutexAcquired) SyncLock.isExporting = false;");
    });

    it("4xx 短路覆盖 404", () => {
        expect(read("src/extract/LinuxDoAPI.js")).toContain("/\\bHTTP\\s+40[0134]\\b/.test(msg)");
    });

    it("clipper 去重键与适配器同口径(normalizeDedupUrl)", () => {
        const src = read("src/export/index.js");
        expect(src).toContain('const url = Utils.normalizeDedupUrl(String(meta.url ||');
    });

    it("GitHub readme 缓存键含 token 指纹", () => {
        expect(read("src/import/GitHubAPI.js")).toContain("const cacheKey = `${repoFullName}::${token ? Utils.apiKeyHash(token) : \"anon\"}`;");
    });

    it("认证重试失败仍走降级清理", () => {
        const src = read("src/auth/index.js");
        expect(src).toContain("他 tab 轮换后的 refresh token 重试失败");
        expect(src).toContain("clientSecret: String(Storage.get(CONFIG.STORAGE_KEYS.NOTION_OAUTH_CLIENT_SECRET, \"\") || \"\").trim().replace(INVISIBLE_CHARS_RE, \"\"),");
    });

    it("对话发送的状态变更纳入 try(异常也复位 UI)", () => {
        const src = read("src/ai/index.js");
        const sendBody = src.slice(src.indexOf("sendMessage: async () =>"), src.indexOf("// 绑定事件"));
        expect(sendBody.indexOf("try {")).toBeLessThan(sendBody.indexOf('ChatState.addMessage("user"'));
        expect(sendBody).toContain("} finally {");
    });

    it("上传回退写入的 URL 已过 UrlValidator(DOMToNotion 唯一生产者)", () => {
        const dom = read("src/api/DOMToNotion.js");
        expect(dom).toContain("_safeExternalUrl: (full) => {");
        expect(dom).toContain("if (!full || !UrlValidator.validatePageExternalUrl(full)) return \"\";");
        const others = ["src/ai/BlockConverter.js", "src/export/index.js"].map(read).join("\n");
        expect(others).not.toContain("_needsUpload: true");
    });
});
