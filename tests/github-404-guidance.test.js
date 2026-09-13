import { describe, it, expect, beforeEach, afterEach } from "vitest";

// odyssey-debug 20260913: GitHub 静默失效复合根因回归 ——
// ① 404 用户域资源给出可行动指引(用户名不存在/已改名) ② 401 token 失效专门分支
// ③ run() 吞错面收敛: 错误经 errors 上抛供 bindImportNow 红显(而非绿"完成 0 条")
const { GitHubAPI, GitHubAutoImporter } = require("../src/import");
const { NotionOAuth } = require("../src/auth");
const { Storage, SyncState } = require("../src/storage");
const { SyncLock } = require("../src/sync-lock");
const { CONFIG } = require("../src/config");

describe("odyssey-debug 20260913: GitHub 404/401 指引 + run() 错误上抛", () => {
    const saved = {};
    const originalDocument = global.document;
    const originalGMRequest = global.GM_xmlhttpRequest;

    beforeEach(() => {
        saved.acquireLease = SyncLock.acquireLease;
        saved.releaseLease = SyncLock.releaseLease;
        saved.renewLease = SyncLock.renewLease;
        saved.updateGitHubMeta = SyncState.updateGitHubMeta;
        saved.getAccessToken = NotionOAuth.getAccessToken;
        saved.storageGet = Storage.get;
        saved.getImportTypes = GitHubAPI.getImportTypes;
        saved.syncSingleType = GitHubAutoImporter._syncSingleType;

        global.document = { hidden: false, querySelector: () => null };
        SyncLock.isExporting = false;
        GitHubAutoImporter.isRunning = false;
    });

    afterEach(() => {
        SyncLock.acquireLease = saved.acquireLease;
        SyncLock.releaseLease = saved.releaseLease;
        SyncLock.renewLease = saved.renewLease;
        SyncState.updateGitHubMeta = saved.updateGitHubMeta;
        NotionOAuth.getAccessToken = saved.getAccessToken;
        Storage.get = saved.storageGet;
        GitHubAPI.getImportTypes = saved.getImportTypes;
        GitHubAutoImporter._syncSingleType = saved.syncSingleType;

        if (originalDocument === undefined) delete global.document;
        else global.document = originalDocument;
        if (originalGMRequest === undefined) delete global.GM_xmlhttpRequest;
        else global.GM_xmlhttpRequest = originalGMRequest;
    });

    const stubGM = (status, body = "{}") => {
        global.GM_xmlhttpRequest = (opts) => {
            setTimeout(() => opts.onload({ status, responseText: body }), 0);
        };
    };

    it("T1: 未认证 404 → 用户名指引 enriched", async () => {
        stubGM(404);
        await expect(GitHubAPI.fetchStarredRepos("ghost-user")).rejects.toThrow(/「ghost-user」/);
        await expect(GitHubAPI.fetchStarredRepos("ghost-user")).rejects.toThrow(/设置区/);
    });

    it("T2: 用户名为空时 404 保持原文案(不误导)", async () => {
        stubGM(404);
        await expect(GitHubAPI.fetchStarredRepos("")).rejects.toThrow(/^GitHub Stars 资源不存在$/);
    });

    it("T3: token 路径(/user/*) 404 与用户名无关, 不 enrich", async () => {
        stubGM(404);
        await expect(GitHubAPI.fetchStarredRepos("someone", "tok")).rejects.toThrow(/^GitHub Stars 资源不存在$/);
    });

    it("T4: 401 → Token 失效专门指引", async () => {
        stubGM(401);
        await expect(GitHubAPI.fetchStarredRepos("someone", "tok")).rejects.toThrow(/Token 无效或已过期/);
    });

    it("T5: repos/gists 用户域 404 同样 enriched", async () => {
        stubGM(404);
        await expect(GitHubAPI.fetchUserRepos("ghost-user")).rejects.toThrow(/「ghost-user」/);
        await expect(GitHubAPI.fetchUserGists("ghost-user")).rejects.toThrow(/「ghost-user」/);
    });

    it("T6: 全错路径 run() 经 errors 上抛(吞错面收敛)", async () => {
        SyncLock.acquireLease = async () => ({ owner: "test-owner", expiresAt: Date.now() + 60000 });
        SyncLock.releaseLease = () => {};
        SyncLock.renewLease = () => true;
        SyncState.updateGitHubMeta = () => {};
        NotionOAuth.getAccessToken = () => "notion-token";
        Storage.get = (key, d) => {
            if (key === CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID) return "db-id";
            if (key === CONFIG.STORAGE_KEYS.GITHUB_USERNAME) return "ghost-user";
            return d;
        };
        GitHubAPI.getImportTypes = () => ["stars"];
        GitHubAutoImporter._syncSingleType = async () => ({
            success: 0,
            failed: 0,
            syncError: new Error("Stars: GitHub Stars 资源不存在 —— 指引"),
        });
        GitHubAutoImporter.lastRunAt = 0;

        const result = await GitHubAutoImporter.run();
        expect(result).toBeDefined();
        expect(result.importedCount).toBe(0);
        expect(Array.isArray(result.errors)).toBe(true);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/资源不存在/);
        expect(GitHubAutoImporter.isRunning).toBe(false);
    });

    it("T7: 全成功路径返回 {importedCount, errors:[]}", async () => {
        SyncLock.acquireLease = async () => ({ owner: "test-owner", expiresAt: Date.now() + 60000 });
        SyncLock.releaseLease = () => {};
        SyncLock.renewLease = () => true;
        SyncState.updateGitHubMeta = () => {};
        NotionOAuth.getAccessToken = () => "notion-token";
        Storage.get = (key, d) => {
            if (key === CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID) return "db-id";
            if (key === CONFIG.STORAGE_KEYS.GITHUB_USERNAME) return "real-user";
            return d;
        };
        GitHubAPI.getImportTypes = () => ["stars"];
        GitHubAutoImporter._syncSingleType = async () => ({ success: 1, failed: 0 });
        GitHubAutoImporter.lastRunAt = 0;

        const result = await GitHubAutoImporter.run();
        expect(result).toBeDefined();
        expect(result.importedCount).toBe(1);
        expect(result.errors).toHaveLength(0);
    });

    it("T8: 空 types 早退路径返回 errors:[]", async () => {
        SyncLock.acquireLease = async () => ({ owner: "test-owner", expiresAt: Date.now() + 60000 });
        SyncLock.releaseLease = () => {};
        SyncLock.renewLease = () => true;
        SyncState.updateGitHubMeta = () => {};
        NotionOAuth.getAccessToken = () => "notion-token";
        Storage.get = (key, d) => {
            if (key === CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID) return "db-id";
            if (key === CONFIG.STORAGE_KEYS.GITHUB_USERNAME) return "real-user";
            return d;
        };
        GitHubAPI.getImportTypes = () => [];
        GitHubAutoImporter.lastRunAt = 0;

        const result = await GitHubAutoImporter.run();
        expect(result).toBeDefined();
        expect(result.errors).toHaveLength(0);
    });

    it("T9: 用户名+Token 全空 → errors 上抛配置指引", async () => {
        NotionOAuth.getAccessToken = () => "notion-token";
        Storage.get = (key, d) => (key === CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID ? "db-id" : d);

        const result = await GitHubAutoImporter.run();
        expect(result).toBeDefined();
        expect(result.errors).toEqual(["请先配置 GitHub 用户名或 Token"]);
        expect(GitHubAutoImporter.isRunning).toBe(false);
    });

    it("T10: 邮箱形用户名 404 → 精确邮箱指引(非泛化「不存在或已改名」)", () => {
        const error = new Error("GitHub Stars 资源不存在");
        const wrapped = GitHubAPI._wrapUserScoped404(error, "wds2788245684@gmail.com");
        expect(wrapped.message).toContain("不应填邮箱");
        expect(wrapped.message).toContain("github.com/ 后面那串");
    });

    it("T11: 邮箱形用户名无 Token → run() 快速失败, 不发网络请求", async () => {
        NotionOAuth.getAccessToken = () => "notion-token";
        Storage.get = (key, d) => {
            if (key === CONFIG.STORAGE_KEYS.NOTION_DATABASE_ID) return "db-id";
            if (key === CONFIG.STORAGE_KEYS.GITHUB_USERNAME) return "wds2788245684@gmail.com";
            return d;
        };
        let fetchCalled = 0;
        global.fetch = async () => { fetchCalled += 1; throw new Error("should not fetch"); };
        GitHubAutoImporter.lastRunAt = 0;

        const result = await GitHubAutoImporter.run();
        expect(result).toBeDefined();
        expect(fetchCalled).toBe(0);
        expect(result.errors[0]).toContain("不应填邮箱");
        expect(result.errors[0]).toContain("octocat");
    });
});
