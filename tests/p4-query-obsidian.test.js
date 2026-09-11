import { describe, it, expect, beforeEach, afterEach } from "vitest";

// P4 第五批回归: query handler 分页游标/截断提示/Markdown 链接净化 + Obsidian 路径与 frontmatter
const { AIHandlers } = require("../src/ai/index.js");
const { NotionAPI } = require("../src/api");
const { ObsidianAPI, HTMLToMarkdown } = require("../src/api/obsidian.js");

const mkPage = (id, title = id) => ({
    object: "page",
    id,
    url: `https://www.notion.so/${id}`,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-02T00:00:00.000Z",
    parent: { type: "database_id", database_id: "db" },
    properties: { title: { type: "title", title: [{ plain_text: title }] } },
});

describe("P4: query handler 分页边界", () => {
    const saved = {};
    beforeEach(() => {
        saved.queryDatabase = NotionAPI.queryDatabase;
        saved.search = NotionAPI.search;
    });
    afterEach(() => {
        NotionAPI.queryDatabase = saved.queryDatabase;
        NotionAPI.search = saved.search;
    });

    it("handleQuery 遇重复游标即终止(不重复拉取同一页)", async () => {
        const cursors = [];
        NotionAPI.queryDatabase = async (dbId, filter, sorts, cursor) => {
            cursors.push(cursor);
            return { results: [mkPage(`p${cursors.length}`)], has_more: true, next_cursor: "same" };
        };

        const result = await AIHandlers.handleQuery({}, { notionDatabaseId: "db", notionApiKey: "k" }, "");
        expect(cursors).toEqual([null, "same"]);
        expect(result).toContain("共找到 **2** 个帖子");
        expect(result).toContain("已达查询上限");
    });

    it("handleQuery 遇空游标即终止并标记截断", async () => {
        let calls = 0;
        NotionAPI.queryDatabase = async () => {
            calls++;
            return { results: [mkPage("p1")], has_more: true, next_cursor: null };
        };

        const result = await AIHandlers.handleQuery({}, { notionDatabaseId: "db", notionApiKey: "k" }, "");
        expect(calls).toBe(1);
        expect(result).toContain("已达查询上限");
    });

    it("handleSearch 分页续拉并去重游标", async () => {
        const cursors = [];
        NotionAPI.search = async (keyword, filter, apiKey, cursor) => {
            cursors.push(cursor);
            if (cursors.length === 1) return { results: [mkPage("s1")], has_more: true, next_cursor: "c1" };
            return { results: [mkPage("s2")], has_more: false, next_cursor: null };
        };

        const result = await AIHandlers.handleSearch(
            { keyword: "k", limit: 10 },
            { notionDatabaseId: "db", notionApiKey: "k" },
            ""
        );
        expect(cursors).toEqual([undefined, "c1"]);
        expect(result).toContain("找到 **2** 个");
    });

    it("handleSearch 标题中的 ]( 被剥离(防链接目标注入)", async () => {
        NotionAPI.search = async () => ({
            results: [mkPage("s1", "标题](https://evil.example)")],
            has_more: false,
            next_cursor: null,
        });

        const result = await AIHandlers.handleSearch(
            { keyword: "k", limit: 10 },
            { notionDatabaseId: "db", notionApiKey: "k" },
            ""
        );
        // wave17 共识(glm): 标签面由「删除方括号」改为「反斜杠转义」—— 删除会破坏标签内嵌套 Markdown,
        // 转义同样阻止 ]( 逃逸链接语法(恶意 URL 不会成为链接目标)
        expect(result).toContain("标题\\](https://evil.example)");
        expect(/(^|[^\\])\]\(https:\/\/evil\.example\)/.test(result)).toBe(false);
        expect(result).toContain("](https://www.notion.so/s1)");
    });

    it("handleWorkspaceSearch 游标缺失时提示结果不完整", async () => {
        NotionAPI.search = async () => ({
            results: [mkPage("w1")],
            has_more: true,
            next_cursor: null,
        });

        const result = await AIHandlers.handleWorkspaceSearch(
            { keyword: "k", limit: 10 },
            { notionDatabaseId: "db", notionApiKey: "k" },
            ""
        );
        expect(result).toContain("结果可能不完整");
    });
});

describe("P4: Obsidian 边界", () => {
    const savedGm = global.GM_xmlhttpRequest;
    afterEach(() => { global.GM_xmlhttpRequest = savedGm; });

    it("网络错误返回 {ok:false} 而非抛异常", async () => {
        global.GM_xmlhttpRequest = (opts) => opts.onerror(new Error("ECONNREFUSED"));
        const result = await ObsidianAPI.writeNote("http://127.0.0.1:27123", "k", "note.md", "body");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("ECONNREFUSED");
    });

    it("超时返回 {ok:false}", async () => {
        global.GM_xmlhttpRequest = (opts) => opts.ontimeout();
        const result = await ObsidianAPI.testConnection("http://127.0.0.1:27123", "k");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("超时");
    });

    it("路径逐段编码并剔除 .. 段", () => {
        expect(ObsidianAPI._safeVaultPath("folder/sub/note.md")).toBe("folder/sub/note.md");
        expect(ObsidianAPI._safeVaultPath("a/../../etc/passwd")).toBe("a/etc/passwd");
        expect(ObsidianAPI._safeVaultPath("中文 目录/n.md")).toBe("%E4%B8%AD%E6%96%87%20%E7%9B%AE%E5%BD%95/n.md");
    });

    it("writeNote 用安全路径发请求", async () => {
        let url = "";
        global.GM_xmlhttpRequest = (opts) => { url = opts.url; opts.onload({ status: 200, statusText: "OK" }); };
        const result = await ObsidianAPI.writeNote("http://127.0.0.1:27123", "k", "sub/../note.md", "body");
        expect(result.ok).toBe(true);
        expect(url).toBe("http://127.0.0.1:27123/vault/sub/note.md");
    });

    it("frontmatter 转义换行/控制字符/反斜杠", () => {
        const fm = HTMLToMarkdown.buildFrontmatter({
            title: 'foo"\ninjected: true',
            author: "a\\",
            topicId: "1\nbad: 1",
            floors: 3,
        });
        expect(fm).not.toContain("injected: true\n");
        expect(fm).toContain('title: "foo\\" injected: true"');
        expect(fm).toContain('author: "a\\\\"');
        expect(fm).toContain('topic_id: "1 bad: 1"');
        expect(fm).toContain("floors: 3");
    });

    it("Markdown 文本/URL 净化转义元字符", () => {
        expect(HTMLToMarkdown._mdText("标题](https://evil)")).toBe("标题\\](https://evil)");
        // P4 收敛(c05): URL 用百分号编码保留目标(删除会改写链接)
        expect(HTMLToMarkdown._mdUrl("https://a.example/x)y z")).toBe("https://a.example/x%29y%20z");
    });
});
