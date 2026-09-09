"use strict";

// P4 收敛轮第二批(wave2)三模型共识确认的修复回归测试。
// 覆盖: 敏感键未编辑保留 / settings 时间戳复用上限 / applyRemote scope+计数+源白名单 /
//       Atom link 属性序 / redactText secret_ 形态。
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;
global.GM_notification = () => {};

const { CONFIG } = require("../src/config");
const { Storage } = require("../src/storage");
const { SyncStateV2 } = require("../src/storage/SyncState");
const { DedupStore } = require("../src/storage/DedupStore");
const { SyncSerializer } = require("../src/sync/SyncSerializer");
const { SyncConstants } = require("../src/sync/constants");
const { SyncEngine } = require("../src/sync/SyncEngine");
const { SyncConfig } = require("../src/sync/SyncConfig");
const { UICommandService } = require("../src/coordination/UICommandService");
const { CredentialVault } = require("../src/auth");
const { RSSAutoImporter } = require("../src/bridge/RSSAutoImporter");
const { SyncLedger } = require("../src/sync/SyncLedger");

beforeEach(() => {
    store.clear();
    SyncStateV2._cache = null;
    SyncStateV2._saveTimer = null;
    SyncStateV2._dirty = false;
    DedupStore._batchCache = null;
    DedupStore._batchSourceType = null;
    SyncEngine._deps = null;
    SyncEngine._running = false;
    SyncEngine._pushTimer = null;
    SyncConfig._deviceId = null;
});

describe("P4 收敛(c07): 未编辑的敏感输入框不得清除已存密钥", () => {
    const KEY = CONFIG.STORAGE_KEYS.AI_API_KEY;
    const TOKEN = CONFIG.STORAGE_KEYS.GITHUB_TOKEN;

    it("未携带(undefined)时保留已存值", async () => {
        Storage.set(KEY, "sk-existing");
        Storage.set(TOKEN, "ghp_existing");

        await UICommandService._saveNotionSiteSettings({
            scope: "notion-site",
            aiApiKey: undefined,
            githubToken: undefined,
        });

        expect(Storage.get(KEY, "")).toBe("sk-existing");
        expect(Storage.get(TOKEN, "")).toBe("ghp_existing");
    });

    it("携带新值时覆盖", async () => {
        Storage.set(KEY, "sk-existing");
        Storage.set(TOKEN, "ghp_existing");

        await UICommandService._saveNotionSiteSettings({
            scope: "notion-site",
            aiApiKey: "sk-new",
            githubToken: "ghp_new",
        });

        expect(Storage.get(KEY, "")).toBe("sk-new");
        expect(Storage.get(TOKEN, "")).toBe("ghp_new");
    });

    it("显式传空串(用户清空)时删除", async () => {
        Storage.set(KEY, "sk-existing");
        Storage.set(TOKEN, "ghp_existing");

        await UICommandService._saveNotionSiteSettings({
            scope: "notion-site",
            aiApiKey: "",
            githubToken: "",
        });

        expect(Storage.get(KEY, "")).toBe("");
        expect(Storage.get(TOKEN, "")).toBe("");
    });

    it("notion-site 面板保存链路: 两密钥输入框均有 touched 守卫", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");
        // 保存 payload: 未编辑传 undefined(不是裸 value.trim())
        expect(src).toContain('panel.querySelector("#ldb-notion-ai-api-key").dataset.touched === "true"');
        expect(src).toContain('panel.querySelector("#ldb-notion-github-token").dataset.touched === "true"');
        // loadConfig: 两个输入框均初始化并监听 touched
        expect(src).toContain('panel.querySelector("#ldb-notion-ai-api-key").dataset.touched = "false";');
        expect(src).toContain('panel.querySelector("#ldb-notion-github-token").dataset.touched = "false";');
    });
});

describe("P4 收敛(c11): SyncLedger.pullRows 行数上限", () => {
    it("超出 MAX_ROWS 的行被截断", async () => {
        const rows = Array.from({ length: SyncConstants.MAX_ROWS + 5 }, (_, i) => ({ id: `p-${i}` }));
        const out = await SyncLedger.pullRows({
            NotionAPI: { queryDatabase: async () => ({ results: rows, has_more: false, next_cursor: null }) },
            apiKey: "k",
            databaseId: "db",
        });

        expect(out.length).toBe(SyncConstants.MAX_ROWS);
    });
});

describe("P4 收敛(c11): settings 时间戳复用上限", () => {
    const OPTS = { deviceId: "dev-a", mode: "personal", hashUrls: true };
    const BASE = 1_000_000_000_000;

    it("复用年龄超上限后重新盖戳(否则落出 90 天窗口致整包被拒)", async () => {
        const stamps = {};
        await SyncSerializer.buildPayload(
            { settings: { ldb_ai_model: "gpt-4" } }, { ...OPTS, now: BASE, stampsOut: stamps }
        );

        const now = BASE + SyncConstants.SETTINGS_STAMP_MAX_REUSE_MS + 1000;
        const next = await SyncSerializer.buildPayload(
            { settings: { ldb_ai_model: "gpt-4" }, settingsStamps: stamps }, { ...OPTS, now, stampsOut: {} }
        );

        expect(next.settings.ldb_ai_model.updatedAt).toBe(new Date(now).toISOString());
    });

    it("上限内仍复用原时间戳(LWW 语义不变)", async () => {
        const stamps = {};
        await SyncSerializer.buildPayload(
            { settings: { ldb_ai_model: "gpt-4" } }, { ...OPTS, now: BASE, stampsOut: stamps }
        );

        const now = BASE + SyncConstants.SETTINGS_STAMP_MAX_REUSE_MS - 1000;
        const next = await SyncSerializer.buildPayload(
            { settings: { ldb_ai_model: "gpt-4" }, settingsStamps: stamps }, { ...OPTS, now, stampsOut: {} }
        );

        expect(next.settings.ldb_ai_model.updatedAt).toBe(new Date(BASE).toISOString());
    });
});

describe("P4 收敛(c11): applyRemote scope / 源白名单 / 返回计数", () => {
    const initEngine = () => {
        SyncEngine.init({
            Storage,
            SyncStateV2,
            DedupStore,
            NotionAPI: { queryDatabase: async () => ({ results: [], has_more: false }) },
            OperationGuard: { canExecute: () => true, getLevel: () => 3, execute: async (op, fn) => fn() },
            OperationLog: { add: () => {} },
            apiKeyProvider: () => "test-key",
        });
    };

    it("shared 模式跳过 personal 设置键", () => {
        initEngine();
        SyncConfig.setMode("shared");
        const before = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, "unset");

        SyncEngine.applyRemote({
            dedupEntries: [],
            watermarkWinners: [],
            settingsWinners: [
                { key: CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, entry: { value: "远端人格", updatedAt: new Date().toISOString(), deviceId: "d" } },
            ],
        });

        expect(Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, "unset")).toBe(before);
    });

    it("personal 模式应用 personal 设置键", () => {
        initEngine();
        SyncConfig.setMode("personal");

        SyncEngine.applyRemote({
            dedupEntries: [],
            watermarkWinners: [],
            settingsWinners: [
                { key: CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, entry: { value: "远端人格", updatedAt: new Date().toISOString(), deviceId: "d" } },
            ],
        });

        expect(Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, "")).toBe("远端人格");
    });

    it("非白名单 watermark 源不写入本地状态", () => {
        initEngine();

        SyncEngine.applyRemote({
            dedupEntries: [],
            watermarkWinners: [{ source: "evil-source", watermark: { epoch: 0, time: "2026-01-01T00:00:00.000Z", ids: ["x"] } }],
            settingsWinners: [],
        });

        expect(SyncStateV2.getSourceState("evil-source").watermark).toBeFalsy();
    });

    it("返回计数为数字(供 lastOutcome 直接插值)", () => {
        initEngine();

        const applied = SyncEngine.applyRemote({
            dedupEntries: [{ source: "linuxdo", key: "1", ts: Date.now() }],
            watermarkWinners: [],
            settingsWinners: [],
        });

        expect(applied.dedupEntries).toBe(1);
        expect(applied.watermarkWinners).toBe(0);
        expect(applied.settingsWinners).toBe(0);
    });
});

describe("P4 收敛(c07): Atom link 属性顺序无关", () => {
    it("rel=alternate 在 href 之后也能取到", () => {
        const block = '<link href="https://self.example.com/feed" rel="self"/><link href="https://item.example.com/a" rel="alternate"/>';

        expect(RSSAutoImporter.extractLink(block, true)).toBe("https://item.example.com/a");
    });

    it("只有 rel=self 时不误取 feed 自身地址", () => {
        const block = '<link href="https://self.example.com/feed" rel="self"/>';

        expect(RSSAutoImporter.extractLink(block, true)).toBe("");
    });
});

describe("P4 收敛(c07): RSS feed 地址 SSRF 过滤", () => {
    it("内网/元数据地址被拒, 公网保留", () => {
        const urls = RSSAutoImporter.getFeedUrls([
            "https://example.com/feed.xml",
            "http://127.0.0.1:8756/x",
            "http://169.254.169.254/latest/meta-data/",
            "http://192.168.1.1/rss",
        ].join("\n"));

        expect(urls).toEqual(["https://example.com/feed.xml"]);
    });
});

describe("P4 收敛(c06): redactText 覆盖 secret_ 形态凭证", () => {
    it("secret_ 前缀凭证明文被脱敏", () => {
        const out = CredentialVault.redactText("key=secret_abcdefghijklmnopqrstuvwxyz0123456789 done");

        expect(out).not.toContain("secret_abcdefghijklmnopqrstuvwxyz0123456789");
        expect(out).toContain("***REDACTED***");
    });
});

describe("P4 收敛(c10): normalizeWatermark 容量上限", () => {
    it("超量 ids 被截断到 MAX_WATERMARK_IDS", () => {
        const ids = Array.from({ length: 600 }, (_, i) => `id-${i}`);

        const wm = SyncStateV2.normalizeWatermark({ time: "2026-01-01T00:00:00.000Z", ids });

        expect(wm.ids.length).toBe(500);
    });
});
