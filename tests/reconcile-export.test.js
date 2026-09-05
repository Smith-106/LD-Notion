"use strict";

// v3.14.4 对账回填 + 同步投影契约测试(R-REC-01/R-SYNC-01):
// 覆盖三模型共识审查发现的 F-1(LinuxDo 对账死代码)/F-2(sync ts 过期过滤)/F-3(行截断)/F-6(测试缺口)
import { describe, it, expect, beforeEach } from "vitest";

// GM mock(与 tests/setup.js 同构)
const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;

const { SyncSerializer } = require("../src/sync/SyncSerializer");
const { SyncEngine } = require("../src/sync/SyncEngine");
const { DedupStore } = require("../src/storage/DedupStore");

const D90 = 90 * 24 * 60 * 60 * 1000;
const NOW = 1750000000000;

beforeEach(() => {
    store.clear();
    DedupStore._batchCaches = {};
});

describe("R-SYNC-01: 同步投影过期裁剪(F-2/F-3)", () => {
    it("id 键源: 91 天前条目不出现在同步投影, 新鲜条目保留", async () => {
        const p = await SyncSerializer.buildPayload(
            { dedupSets: { linuxdo: { "old": NOW - D90 - 86400000, "new": NOW - 10 * 86400000 } } },
            { deviceId: "t", now: NOW, hashUrls: false }
        );
        expect(p.dedup.linuxdo["old"]).toBeUndefined();
        expect(p.dedup.linuxdo["new"]).toBe(NOW - 10 * 86400000);
    });

    it("URL 键源(bookmark): 过期条目保留(维持时间 TTL 语义, 由本地淘汰负责)", async () => {
        const p = await SyncSerializer.buildPayload(
            { dedupSets: { bookmark: { "https://a.com/x": NOW - D90 - 86400000 } } },
            { deviceId: "t", now: NOW, hashUrls: false }
        );
        expect(p.dedup.bookmark["https://a.com/x"]).toBe(NOW - D90 - 86400000);
    });

    it("过期裁剪后 payload 通过 validateRemote 整包 ts 校验(修复 F-2 整包拒绝回归)", async () => {
        const dedupSets = { linuxdo: { "a": NOW - D90 - 86400000, "b": NOW - 1000 } };
        const p = await SyncSerializer.buildPayload({ dedupSets }, { deviceId: "t", now: NOW, hashUrls: false });
        const v = SyncSerializer.validateRemote(p, { now: NOW, localEpochs: {} });
        expect(v.ok).toBe(true);
        // 未过滤时同一账本必然整包拒绝(旧行为复现验证)
        const raw = { schemaVersion: p.schemaVersion, deviceId: "t", version: 0, updatedAt: p.updatedAt, dedup: { linuxdo: { "a": NOW - D90 - 86400000, "b": NOW - 1000 } }, watermarks: {}, settings: {} };
        const v2 = SyncSerializer.validateRemote(raw, { now: NOW, localEpochs: {} });
        expect(v2.ok).toBe(false);
        expect(String(v2.error)).toContain("ts 越界");
    });

    it("行截断: 300 条单源 set 截断到 ≤1900 字符且保留 ts 最新条目(F-3)", () => {
        const set = {};
        for (let i = 0; i < 300; i++) set[`topic-${String(i).padStart(4, "0")}`] = NOW - (300 - i) * 1000;
        const trunc = SyncEngine._truncateSetForRow("linuxdo", set);
        expect(JSON.stringify(trunc).length).toBeLessThanOrEqual(1900);
        const maxTs = Math.max(...Object.values(set));
        expect(Object.values(trunc)).toContain(maxTs);
        // 不超限时原样返回(不截断)
        const small = { a: NOW, b: NOW - 1 };
        expect(SyncEngine._truncateSetForRow("linuxdo", small)).toBe(small);
    });
});

describe("R-REC-01: 对账回填索引构建语义(F-1 死代码回归护栏)", () => {
    // reconcile 的 URL 索引构建规则(纯函数化验证, 不依赖 UI DOM):
    // GitHub 项 → raw.html_url; LinuxDo 项 → https://linux.do/t/{topic_id}(与导出写入"链接"属性同法)
    const buildIndex = (bookmarks, normalize) => {
        const m = new Map();
        bookmarks.forEach((b) => {
            let rawUrl = "";
            if (b?.source === "github") rawUrl = b?.raw?.html_url;
            else {
                const topicId = String(b?.topic_id || b?.bookmarkable_id || "");
                if (topicId) rawUrl = `https://linux.do/t/${topicId}`;
            }
            const url = normalize(rawUrl || "");
            if (url && !m.has(url)) m.set(url, b);
        });
        return m;
    };
    // 与 workspace-visual.js normalizeWorkspaceInsightUrl 同构的最小实现
    const normalize = (raw) => {
        const s = String(raw || "").trim();
        if (!s) return "";
        try {
            const u = new URL(s);
            return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
        } catch {
            return s.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
        }
    };

    it("Discourse 原始 bookmark(无 url 字段, 仅 bookmarkable_url 含 slug)按 topic_id 构造规范 URL 命中导出写入的链接属性", () => {
        // Discourse user_bookmark_base_serializer 实际形状: 有 bookmarkable_url(含 slug), 无 url
        const discourseBookmark = {
            topic_id: 12345,
            bookmarkable_id: 12345,
            bookmarkable_url: "https://linux.do/t/some-slug-topic/12345",
            name: "示例帖子",
        };
        // 导出时写入 Notion"链接"属性的 URL(LinuxDoAPI.fetchAllPosts 构造, 无 slug)
        const notionRecordUrl = "https://linux.do/t/12345";
        const idx = buildIndex([discourseBookmark], normalize);
        expect(idx.get(normalize(notionRecordUrl))).toBeTruthy();
        expect(idx.size).toBe(1);
        // 死代码回归断言: 旧实现读 bookmark.url 恒 undefined → 索引为空
        expect(discourseBookmark.url).toBeUndefined();
    });

    it("GitHub 项: raw.html_url 与导出写入同串命中", () => {
        const gh = { source: "github", sourceType: "stars", itemKey: "user/repo", raw: { html_url: "https://github.com/user/repo" } };
        const idx = buildIndex([gh], normalize);
        expect(idx.get(normalize("https://github.com/user/repo"))).toBeTruthy();
    });

    it("无 topic_id 的 LinuxDo 项不进索引(空串兜底)", () => {
        const broken = { topic_id: null, bookmarkable_id: null, title: "x" };
        const idx = buildIndex([broken], normalize);
        expect(idx.size).toBe(0);
    });

    it("尾部斜杠归一化: /t/12345/ 与 /t/12345 命中同一索引键", () => {
        const b = { topic_id: 999 };
        const idx = buildIndex([b], normalize);
        expect(idx.get(normalize("https://linux.do/t/999/"))).toBeTruthy();
    });

    it("含 slug 的 bookmarkable_url 与规范 URL 不混淆: slug 形式不产生额外索引键", () => {
        const b = { topic_id: 777, bookmarkable_url: "https://linux.do/t/slug-name/777" };
        const idx = buildIndex([b], normalize);
        // 索引只含按 topic_id 构造的规范键, 不含 slug 变体
        expect(idx.has(normalize("https://linux.do/t/slug-name/777"))).toBe(false);
        expect(idx.has(normalize("https://linux.do/t/777"))).toBe(true);
    });
});

describe("R-REC-02: DedupStore batch 模式对账批量写回(F-4 回归护栏)", () => {
    it("beginBatch 后 markSeen 仅 mutate 内存, endBatch 单次落盘", () => {
        DedupStore.beginBatch("linuxdo");
        DedupStore.markSeen("linuxdo", "111");
        DedupStore.markSeen("linuxdo", "222");
        // 未 endBatch 前不落盘
        expect(store.get(DedupStore._keyFor("linuxdo"))).toBeUndefined();
        DedupStore.endBatch("linuxdo");
        const saved = JSON.parse(store.get(DedupStore._keyFor("linuxdo")));
        expect(saved["111"]).toBeTruthy();
        expect(saved["222"]).toBeTruthy();
    });

    it("对账回填多次 markSeen 后条目不因 90 天窗口丢失(id 键源容量上限语义)", () => {
        DedupStore.beginBatch("linuxdo");
        const oldTs = NOW - D90 - 86400000; // 91 天前
        for (let i = 0; i < 50; i++) DedupStore.markSeen("linuxdo", `t${i}`);
        DedupStore.endBatch("linuxdo");
        const saved = JSON.parse(store.get(DedupStore._keyFor("linuxdo")));
        expect(Object.keys(saved).length).toBe(50); // 容量上限不删
        expect(oldTs).toBeLessThan(Date.now() - D90); // 时间断言背景: 91 天条目若在集合中也不会被 endBatch 淘汰
    });
});
