import { describe, it, expect, beforeEach, afterEach } from "vitest";

// quality-auto-test p3-r3 (AT-016, L2): GitHubAdapter 水位过滤与键空间分离。
// 断言面: fetchIncremental→SyncState.filterOrderedItems(旧项过滤/同刻 ids 补拉/新项保留,
//         per-subType _getTime 分派) + normalize 形状 + getDedupKey 键空间 github:${subType}:${id}。
// 夹具契约: stub GitHubAPI.fetch*/Storage.get; filterOrderedItems/normalize 真实。
const { createGitHubAdapter } = require("../src/adapter/GitHubAdapter");
const { GitHubAPI } = require("../src/import/GitHubAPI.js");
const { Storage } = require("../src/storage");
const { CONFIG } = require("../src/config");

const mkStar = (full_name, starred_at, language) => ({
    full_name,
    html_url: `https://github.com/${full_name}`,
    description: `desc ${full_name}`,
    language,
    owner: { login: full_name.split("/")[0] },
    starred_at,
});

describe("AT-016: GitHubAdapter 水位过滤与键空间分离", () => {
    const saved = {};
    let rawStars;

    beforeEach(() => {
        rawStars = [
            // filterOrderedItems 契约: 输入须 newest-first 有序(遇更旧项 break 短路)
            mkStar("u/new-repo", "2026-01-03T00:00:00Z", "Go"),
            mkStar("u/same-repo", "2026-01-02T00:00:00Z", "Rust"),
            mkStar("u/old-repo", "2026-01-01T00:00:00Z", "JS"),
        ];
        saved.fetchStars = GitHubAPI.fetchStarredRepos;
        saved.fetchRepos = GitHubAPI.fetchUserRepos;
        saved.storageGet = Storage.get;
        GitHubAPI.fetchStarredRepos = async () => rawStars.map((x) => ({ ...x }));
        GitHubAPI.fetchUserRepos = async () => rawStars.map((x) => ({ ...x, starred_at: undefined, pushed_at: "2026-01-03T00:00:00Z" }));
        Storage.get = (key, dflt) => (key === CONFIG.STORAGE_KEYS.GITHUB_USERNAME ? "u" : (key === CONFIG.STORAGE_KEYS.GITHUB_TOKEN ? "tok" : dflt));
    });

    afterEach(() => {
        GitHubAPI.fetchStarredRepos = saved.fetchStars;
        GitHubAPI.fetchUserRepos = saved.fetchRepos;
        Storage.get = saved.storageGet;
    });

    it("无 watermark: 全量 normalize(source github/id=full_name/tags lang:)", async () => {
        const adapter = createGitHubAdapter("stars");
        const items = await adapter.fetchIncremental(null);
        expect(items.length).toBe(3);
        const first = items[0];
        expect(first.source).toBe("github");
        expect(first.id).toBe("u/new-repo");
        expect(first.url).toBe("https://github.com/u/new-repo");
        expect(first.author).toBe("u");
        expect(first.tags).toEqual(["lang:Go"]);
        expect(first.createdAt).toBe("2026-01-03T00:00:00Z");
    });

    it("有 watermark: 旧项过滤/同刻不在 ids 保留/新项保留", async () => {
        const adapter = createGitHubAdapter("stars");
        const items = await adapter.fetchIncremental({
            time: "2026-01-02T00:00:00Z",
            ids: ["u/same-repo"],
        });
        const ids = items.map((x) => x.id);
        expect(ids).not.toContain("u/old-repo"); // 旧于水位 → 过滤
        expect(ids).not.toContain("u/same-repo"); // 同刻且已在 ids → 已见
        expect(ids).toContain("u/new-repo"); // 新于水位 → 保留
    });

    it("同刻但不在 ids: 补拉(水位冻结防漏导入)", async () => {
        const adapter = createGitHubAdapter("stars");
        const items = await adapter.fetchIncremental({
            time: "2026-01-02T00:00:00Z",
            ids: [],
        });
        expect(items.map((x) => x.id)).toContain("u/same-repo");
    });

    it("repos 子类型: _getTime 走 pushed_at; 键空间按 subType 分离", async () => {
        const stars = createGitHubAdapter("stars");
        const repos = createGitHubAdapter("repos");
        const items = await repos.fetchIncremental(null);
        expect(items[0].createdAt).toBe("2026-01-03T00:00:00Z"); // pushed_at 而非 starred_at
        // 键空间分离: 同一 id 在不同 subType 下互不误杀
        const norm = { id: "u/same-repo" };
        expect(stars.getDedupKey(norm)).toBe("github:stars:u/same-repo");
        expect(repos.getDedupKey(norm)).toBe("github:repos:u/same-repo");
        expect(stars.sourceType).toBe("github-stars");
        expect(repos.sourceType).toBe("github-repos");
    });
});
