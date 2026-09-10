"use strict";

import { describe, it, expect, vi, afterEach } from "vitest";

// P4 收敛 wave5 剩余裁决批次(c10/c11/c12/c14/c15/c16/c17)回归:
// 同步推拉一致性 / 审计账本并集 / 去重读取侧 TTL / 单定时器 / UI 状态一致性。

const fs = require("fs");
const read = (p) => fs.readFileSync(p, "utf8");

const { DedupStore } = require("../src/storage/DedupStore");
const { SyncSerializer } = require("../src/sync/SyncSerializer");
const { SyncRateLimiter } = require("../src/sync/SyncRateLimiter");
const { OperationLog } = require("../src/security");
const { Storage } = require("../src/storage");
const { CONFIG } = require("../src/config");
const { UI } = require("../src/ui/main-ui.js");

describe("P4 收敛(c10): 去重读取侧 TTL / 审计账本并集", () => {
    afterEach(() => {
        try { GM_deleteValue(DedupStore.keyFor("bookmark")); } catch (_) { /* 忽略 */ }
        try { GM_deleteValue(DedupStore.keyFor("linuxdo")); } catch (_) { /* 忽略 */ }
        try { GM_deleteValue(CONFIG.STORAGE_KEYS.OPERATION_LOG); } catch (_) { /* 忽略 */ }
    });

    it("URL 键源: 过期条目读取侧不判重复, 新鲜条目判重复", () => {
        // 直接写入存储(绕过 markSeen 的写回淘汰)—— 模拟历史/陈旧账本条目
        const expired = Date.now() - 91 * 24 * 60 * 60 * 1000;
        const key = DedupStore.keyFor("bookmark");
        GM_setValue(key, JSON.stringify({ "https://example.com/old": expired }));
        expect(DedupStore.isDuplicate("bookmark", "https://example.com/old")).toBe(false);
        // 哈希键路径同样受读取侧 TTL 约束
        const hashed = DedupStore._hashKeyFor("bookmark", "https://example.com/old2");
        GM_setValue(key, JSON.stringify({ [hashed]: expired }));
        expect(DedupStore.isDuplicate("bookmark", "https://example.com/old2")).toBe(false);
        GM_setValue(key, JSON.stringify({ "https://example.com/new": Date.now() }));
        expect(DedupStore.isDuplicate("bookmark", "https://example.com/new")).toBe(true);
    });

    it("id 键源(导出账本)不受 TTL 影响", () => {
        DedupStore.markSeen("linuxdo", "12345", Date.now() - 400 * 24 * 60 * 60 * 1000);
        expect(DedupStore.isDuplicate("linuxdo", "12345")).toBe(true);
    });

    it("非 batch 写回触发缓存失效事件(kind=dedup)", () => {
        const src = read("src/storage/index.js");
        expect(src).toContain('on("storage:state-committed"');
        expect(src).toContain('payload.kind === "dedup"');
    });

    it("OperationLog.add 写前 rebase: 写窗口内他端新增条目不被整键覆写丢弃", () => {
        const key = CONFIG.STORAGE_KEYS.OPERATION_LOG;
        GM_setValue(key, JSON.stringify([{ event_id: "other-tab", audit_event: "write.page.created" }]));
        const originalRedact = OperationLog.redactSensitiveFields;
        let injected = false;
        OperationLog.redactSensitiveFields = (entry) => {
            if (!injected) {
                injected = true;
                // 模拟写窗口内另一个 tab 落盘了一条新审计(本进程快照看不到)
                GM_setValue(key, JSON.stringify([
                    { event_id: "concurrent-tab", audit_event: "write.property.updated" },
                    { event_id: "other-tab", audit_event: "write.page.created" },
                ]));
            }
            return originalRedact(entry);
        };
        try {
            OperationLog.add({ event_id: "mine", audit_event: "page.archived" }, { force: true });
        } finally {
            OperationLog.redactSensitiveFields = originalRedact;
        }
        const ids = JSON.parse(GM_getValue(key, "[]")).map((e) => e.event_id);
        expect(ids).toContain("mine");
        expect(ids).toContain("concurrent-tab");
        expect(ids).toContain("other-tab");
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe("P4 收敛(c11): 同步推拉与限流器", () => {
    it("dedup 源白名单走自有属性校验(原型链键被拒)", () => {
        expect(() => SyncSerializer.assertNoBlacklisted({
            dedup: { constructor: { h: Date.now() } },
        })).toThrow(/源未白名单/);
        expect(() => SyncSerializer.assertNoBlacklisted({
            dedup: { toString: { h: Date.now() } },
        })).toThrow(/源未白名单/);
    });

    it("_drain 只保留单一定时器(不随排队 waiter 倍增)", () => {
        const originalSetTimeout = globalThis.setTimeout;
        const scheduled = [];
        globalThis.setTimeout = (fn, delay) => {
            scheduled.push(delay);
            return scheduled.length; // 真实现(setTimeout)返回真值句柄
        };
        const savedTokens = SyncRateLimiter._tokens;
        const savedWaiters = SyncRateLimiter._waiters;
        const savedTimer = SyncRateLimiter._drainTimer;
        try {
            SyncRateLimiter._tokens = 0;
            SyncRateLimiter._waiters = [() => {}, () => {}, () => {}];
            SyncRateLimiter._drainTimer = null;
            SyncRateLimiter._drain();
            SyncRateLimiter._drain();
            SyncRateLimiter._drain();
            expect(scheduled.length).toBe(1);
        } finally {
            globalThis.setTimeout = originalSetTimeout;
            SyncRateLimiter._tokens = savedTokens;
            SyncRateLimiter._waiters = savedWaiters;
            SyncRateLimiter._drainTimer = savedTimer;
        }
    });

    it("push 与介质既有行并集 + settings 残留分片清理 + pull 过期 dedup 剪枝", () => {
        const src = read("src/sync/SyncEngine.js");
        // push: 与 prior.payload 并集(dedup 单调账本)
        expect(src).toContain("const merged = { ...(row.payload.dedup[row.key] || {}) };");
        expect(src).toContain("row.payload.dedup[row.key] = SyncEngine._truncateSetForRow(row.key, merged);");
        // push: 非当前 settings 分片用空集覆盖
        expect(src).toContain("const currentSettingsKeys = new Set(");
        expect(src).toContain("payload: { settings: {} },");
        // pull: 过期/越界 dedup ts 先剔除再交 validateRemote
        expect(src).toContain("if (!Number.isFinite(num) || num < skewMin || num > skewMax) {");
        expect(src).toContain("delete set[key];\n                        droppedStaleDedup++;");
        expect(src).toContain("droppedStaleSettings > 0 || droppedStaleDedup > 0");
    });

    it("Storage 导出账本缓存失效订阅: batch 提交与非 batch 写回双路径", () => {
        const src = read("src/storage/index.js");
        expect(src).toContain('on("storage:batch-committed", () => { Storage._exportedTopicsCache = null; });');
        expect(src).toContain('if (payload && payload.kind === "dedup") Storage._exportedTopicsCache = null;');
    });

    it("周期 pull 链在禁用期间保留排程(运行期重新启用可自愈)", () => {
        const src = read("src/sync/index.js");
        expect(src).toContain("if (SyncConfig.isEnabled()) {");
        expect(src).not.toContain("if (!SyncConfig.isEnabled()) return;\n                SyncEngine.pull");
    });

    it("sync-lock 降级分支: 按 key 分槽, 释放一方不误清他方互斥", async () => {
        const savedSet = globalThis.GM_setValue;
        const savedGet = globalThis.GM_getValue;
        delete globalThis.GM_setValue;
        delete globalThis.GM_getValue;
        const { SyncLock } = require("../src/sync-lock");
        SyncLock._localLeases.clear();
        SyncLock.isExporting = false;
        try {
            const a = await SyncLock.acquireLease("ldb:k1:lease", 60000);
            expect(a).toBeTruthy();
            expect(await SyncLock.acquireLease("ldb:k1:lease", 60000)).toBe(null);
            const b = await SyncLock.acquireLease("ldb:k2:lease", 60000);
            expect(b).toBeTruthy();
            SyncLock.releaseLease("ldb:k1:lease", a);
            expect(SyncLock.isExporting).toBe(true); // k2 仍持有
            SyncLock.releaseLease("ldb:k2:lease", b);
            expect(SyncLock.isExporting).toBe(false);
        } finally {
            SyncLock._localLeases.clear();
            SyncLock.isExporting = false;
            globalThis.GM_setValue = savedSet;
            globalThis.GM_getValue = savedGet;
        }
    });
});

describe("P4 收敛(c12/c15/c16/c17): UI 口径一致性", () => {
    it("主题按钮在 dark 态承诺的是 auto 而非亮色", () => {
        const src = read("src/ui/design-system.js");
        expect(src).toContain('btn.title = "暗色模式，点击切换跟随系统(自动)";');
    });

    it("剪贴板 API 拒绝时降级 execCommand 成功", async () => {
        const originalCreateElement = document.createElement;
        const originalExec = document.execCommand;
        document.createElement = () => ({
            value: "",
            setAttribute() {},
            style: {},
            select() {},
            remove() {},
        });
        navigator.clipboard = { writeText: vi.fn(() => Promise.reject(new Error("denied"))) };
        document.execCommand = vi.fn(() => true);
        try {
            await expect(UI.copyTextToClipboard("x")).resolves.toBe(true);
            expect(document.execCommand).toHaveBeenCalledWith("copy");
        } finally {
            document.createElement = originalCreateElement;
            if (originalExec === undefined) delete document.execCommand;
            else document.execCommand = originalExec;
            delete navigator.clipboard;
        }
    });

    it("授权后目标回显不对标题二次转义(textContent 路径)", () => {
        const src = read("src/ui/main-ui.js");
        expect(src).toContain("const title = payload.title || \"\";");
        expect(src).not.toContain("payload.title ? Utils.escapeHtml(payload.title) : \"\"");
    });

    it("面板 resize 键盘上界同时受 minHeight 下界约束", () => {
        const src = read("src/ui/panel-resize.js");
        expect(src).toContain("newHeight = Math.max(minHeight, Math.min(liveMax, newHeight + step));");
    });

    it("PanelResize 支持注销已销毁面板", () => {
        const { PanelResize } = require("../src/ui/panel-resize");
        expect(typeof PanelResize.unregister).toBe("function");
        PanelResize._resizeTargets = new Map([["k", {}]]);
        PanelResize.unregister("k");
        expect(PanelResize._resizeTargets.has("k")).toBe(false);
    });

    it("AI 模型列表陈旧响应按 service/baseUrl/key 三重校验", () => {
        const src = read("src/ui/notion-site-ui.js");
        expect(src).toContain("const nowAiKey = panel.querySelector(\"#ldb-notion-ai-api-key\").value.trim()");
        expect(src).toContain("if (nowAiKey !== aiApiKey) return;");
        expect(src).toContain("!== aiBaseUrl) return;");
    });

    it("select_ai_target 失败不再裸 void 丢弃(两处均带 catch)", () => {
        expect(read("src/ui/notion-site-ui.js")).toContain(".catch((error) => NotionSiteUI.showStatus(`切换 AI 目标失败:");
        expect(read("src/ui/events.js")).toContain(".catch((error) => UI.showStatus(`切换 AI 目标失败:");
    });

    it("收藏列表键→URL 映射按数组身份缓存(消除逐行线性 find)", () => {
        const src = read("src/ui/bookmark-list.js");
        expect(src).toContain("UI()._bookmarkKeyUrlCache = { arr: bookmarks, len: bookmarks.length, map };");
        expect(src).not.toContain("const hit = bookmarks.find((b) => UI().getBookmarkKey(b) === bookmarkKey);");
    });

    it("通用导出: 页面已创建时账本标记失败不报导出失败", () => {
        const src = read("src/ui/generic-ui.js");
        expect(src).toContain("导出账本标记失败(页面已创建)");
    });

    it("linux.do 纯数字 slug 归一取真实 topic id", () => {
        const { WorkspaceVisual } = require("../src/ui/workspace-visual");
        expect(WorkspaceVisual.normalizeWorkspaceInsightUrl("https://linux.do/t/2024/45678"))
            .toBe("https://linux.do/t/45678");
        expect(WorkspaceVisual.normalizeWorkspaceInsightUrl("https://linux.do/t/12345/8"))
            .toBe("https://linux.do/t/12345");
    });
});

describe("P4 收敛(c05): 分片上传重试口径", () => {
    it("429/网络错误退避重试, 4xx(非 429)短路不重试", async () => {
        const { NotionAPI } = require("../src/api");
        const { Utils } = require("../src/utils");
        const originalOnce = NotionAPI._sendFilePartOnce;
        const originalSleep = Utils.sleep;
        const sleeps = [];
        Utils.sleep = async (ms) => { sleeps.push(ms); };
        try {
            let calls = 0;
            NotionAPI._sendFilePartOnce = async () => {
                calls++;
                if (calls === 1) {
                    const e = new Error("发送分片失败: 429 rate limited");
                    e.status = 429;
                    throw e;
                }
                return { ok: true };
            };
            await expect(NotionAPI.sendFilePart("u1", {}, 1, "k", "f")).resolves.toEqual({ ok: true });
            expect(calls).toBe(2);
            expect(sleeps).toEqual([1000]);

            calls = 0;
            NotionAPI._sendFilePartOnce = async () => {
                calls++;
                const e = new Error("发送分片失败: 400 bad request");
                e.status = 400;
                throw e;
            };
            await expect(NotionAPI.sendFilePart("u1", {}, 1, "k", "f")).rejects.toThrow(/400/);
            expect(calls).toBe(1);

            // 无 HTTP 状态且无网络标记(构造期/编程错误)同样不重试 —— 不得靠 status 缺失推断可恢复
            calls = 0;
            NotionAPI._sendFilePartOnce = async () => {
                calls++;
                throw new TypeError("FileReader is not defined");
            };
            await expect(NotionAPI.sendFilePart("u1", {}, 1, "k", "f")).rejects.toThrow(TypeError);
            expect(calls).toBe(1);

            // 显式网络标记(onerror/ontimeout)属可恢复态 → 重试
            calls = 0;
            NotionAPI._sendFilePartOnce = async () => {
                calls++;
                if (calls === 1) {
                    const e = new Error("网络请求失败: timeout");
                    e.isNetworkError = true;
                    throw e;
                }
                return { ok: true };
            };
            await expect(NotionAPI.sendFilePart("u1", {}, 1, "k", "f")).resolves.toEqual({ ok: true });
            expect(calls).toBe(2);
        } finally {
            NotionAPI._sendFilePartOnce = originalOnce;
            Utils.sleep = originalSleep;
        }
    });
    it("网络/超时失败显式标记可重试(不以 status 缺失推断)", () => {
        const src = read("src/api/notion-upload.js");
        expect(src).toContain("networkError.isNetworkError = true;");
        expect(src).toContain("timeoutError.isNetworkError = true;");
    });
});

describe("P4 收敛(c16): 拖拽指针捕获降级", () => {
    it("setPointerCapture 失败时挂 document 级监听并在结束时移除", () => {
        const src = read("src/ui/notion-site-ui.js");
        expect(src).toContain('document.addEventListener("pointermove", onPointerMove);');
        expect(src).toContain('document.removeEventListener("pointermove", onPointerMove);');
        expect(src).toContain("docListenersAttached = false;");
    });

    it("嵌套页面标签构建一次性建父级索引(消除 O(N²))", () => {
        const src = read("src/ui/notion-site-ui.js");
        expect(src).toContain("parentName = parentIndex.get(parentId) || \"\";");
        expect(src).toContain("const parentIndex = new Map();");
    });
});

describe("P4 收敛(c10): 安全层失败路径", () => {
    it("ConfirmationDialog countdown 强制数值化(不可注入)", () => {
        const src = read("src/security/index.js");
        expect(src).toContain("${Math.max(0, Math.floor(Number(countdown)) || 0)}");
    });

    it("失败路径审计写入异常不掩盖原始业务错误", () => {
        const src = read("src/security/index.js");
        expect(src).toContain("失败路径审计写入失败");
    });

    it("撤销按钮在途禁用(避免误报撤销失败)", () => {
        const src = read("src/security/index.js");
        expect(src).toContain("if (btn && btn.disabled) return;");
    });
});

// ===== P4 收敛(c05b/c08): 分片覆盖补齐轮(c05b qwen / c08a+c08b glm) =====

describe("P4 收敛(c08): 导出账本容量作用于落盘结果", () => {
    it("存储账本超上限时, flush 后落盘规模收缩到上限", () => {
        const { GitHubAPI } = require("../src/import/GitHubAPI");
        const limit = GitHubAPI._EXPORT_CAPACITY_LIMIT;
        const originalLimit = limit;
        const seed = {};
        for (let i = 0; i < originalLimit + 5; i++) {
            seed[`owner/repo-${i}`] = Date.now() - (originalLimit - i);
        }
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, JSON.stringify(seed));
        GitHubAPI._exportedCache = null;
        GitHubAPI.getExported();
        GitHubAPI.flushExported();
        const persisted = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, "{}"));
        expect(Object.keys(persisted).length).toBeLessThanOrEqual(originalLimit);
        // 已淘汰的最旧键不复活
        expect(persisted["owner/repo-0"]).toBeUndefined();
        expect(persisted[`owner/repo-${originalLimit + 4}`]).toBeDefined();
    });

    it("gist 账本同样在落盘时收缩到上限", () => {
        const { GitHubAPI } = require("../src/import/GitHubAPI");
        const limit = GitHubAPI._EXPORT_CAPACITY_LIMIT;
        const seed = {};
        for (let i = 0; i < limit + 5; i++) {
            seed[`gist-${i}`] = Date.now() - (limit - i);
        }
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, JSON.stringify(seed));
        GitHubAPI._exportedGistsCache = null;
        GitHubAPI.getExportedGists();
        GitHubAPI.flushGistsExported();
        const persisted = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, "{}"));
        expect(Object.keys(persisted).length).toBeLessThanOrEqual(limit);
        expect(persisted["gist-0"]).toBeUndefined();
    });
});

describe("P4 收敛(c08): GitHub 列表 partial 标记随派生数组传递", () => {
    it("fetchStarredRepos 的 map 保留 partial", async () => {
        const { GitHubAPI } = require("../src/import/GitHubAPI");
        const original = GitHubAPI._fetchPaginated;
        GitHubAPI._fetchPaginated = async () => {
            const arr = [{ repo: { full_name: "a/b" }, starred_at: "2026-01-01T00:00:00Z" }];
            arr.partial = true;
            return arr;
        };
        try {
            const items = await GitHubAPI.fetchStarredRepos("u", "t");
            expect(items[0].full_name).toBe("a/b");
            expect(items.partial).toBe(true);
        } finally {
            GitHubAPI._fetchPaginated = original;
        }
    });

    it("fetchForkedRepos 的 filter 保留 partial", async () => {
        const { GitHubAPI } = require("../src/import/GitHubAPI");
        const original = GitHubAPI.fetchUserRepos;
        GitHubAPI.fetchUserRepos = async () => {
            const arr = [{ full_name: "a/b", fork: true }, { full_name: "c/d", fork: false }];
            arr.partial = true;
            return arr;
        };
        try {
            const items = await GitHubAPI.fetchForkedRepos("u", "t");
            expect(items.length).toBe(1);
            expect(items.partial).toBe(true);
        } finally {
            GitHubAPI.fetchUserRepos = original;
        }
    });
});

describe("P4 收敛(c08): 工作区在途请求复用时进度回调不丢失", () => {
    it("并发两次 fetchWorkspace, 后到调用方的 onProgress 仍收到事件", async () => {
        const { WorkspaceService } = require("../src/extract");
        const original = WorkspaceService._requestSearchItems;
        const started = [];
        WorkspaceService._requestSearchItems = async (apiKey, type, maxPages, onProgress) => {
            started.push(type);
            if (typeof onProgress === "function") {
                onProgress({ phase: type, loaded: 1, hasMore: false, pageCount: 1 });
            }
            await new Promise((r) => setTimeout(r, 30));
            if (typeof onProgress === "function") {
                onProgress({ phase: type, loaded: 2, hasMore: false, pageCount: 2 });
            }
            return [];
        };
        try {
            const firstEvents = [];
            const secondEvents = [];
            const first = WorkspaceService.fetchWorkspace("k", { onProgress: (p) => firstEvents.push(p) });
            await new Promise((r) => setTimeout(r, 5));
            const second = WorkspaceService.fetchWorkspace("k", { onProgress: (p) => secondEvents.push(p) });
            await Promise.all([first, second]);
            expect(firstEvents.length).toBeGreaterThan(0);
            // 后到调用方此前全程收不到任何进度事件
            expect(secondEvents.length).toBeGreaterThan(0);
            expect(started.length).toBe(2); // 复用同一在途请求, 未重复扫描
        } finally {
            WorkspaceService._requestSearchItems = original;
        }
    });
});

describe("P4 收敛(c08): 来源 callout 截断计入前缀", () => {
    it("超长 URL 拼接后不超过 rich_text 2000 上限", () => {
        const src = read("src/export/index.js");
        expect(src).toContain("const sourcePrefix = \"来源: \";");
        expect(src).toContain("slice(0, 2000 - sourcePrefix.length)");
    });
});
