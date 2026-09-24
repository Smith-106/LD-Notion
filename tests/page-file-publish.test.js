import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// v3.16.0: 当前页面 → 本地文件 + 发布到 linux.do（对齐 LDStatus Pro）。
// 覆盖 PageFileExporter 纯函数（文件名消毒/装配/载荷/发帖参数）、
// OperationGuard 登记（linuxdo.publish level=1 + 审计事件映射）、
// LinuxDoAPI 写操作（域名守卫 + 参数校验 + postJson 错误短路）。

const store = new Map();
global.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
global.GM_setValue = (k, v) => { store.set(k, v); };
global.GM_deleteValue = (k) => { store.delete(k); };
global.GM_addValueChangeListener = () => 0;

global.window = global;
global.location = { href: "https://linux.do/t/123", hostname: "linux.do", pathname: "/t/123", origin: "https://linux.do" };
global.window.location = global.location;
global.document = { title: "t", querySelector: () => null, querySelectorAll: () => [] };

const { PageFileExporter } = require("../src/export");
const { OperationGuard, OperationLog } = require("../src/security");
const { LinuxDoAPI } = require("../src/extract");

beforeEach(() => {
    store.clear();
    global.location.href = "https://linux.do/t/123";
    global.location.hostname = "linux.do";
    global.location.pathname = "/t/123";
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("PageFileExporter.sanitizeFileName", () => {
    it("Windows 非法字符 → 下划线", () => {
        expect(PageFileExporter.sanitizeFileName('a/b:c*d?e"f<g>h|i')).toBe("a_b_c_d_e_f_g_h_i");
    });
    it("空名回退 fallback", () => {
        expect(PageFileExporter.sanitizeFileName("", "page")).toBe("page");
        expect(PageFileExporter.sanitizeFileName("   ")).toBe("page");
    });
    it("超长截断 80", () => {
        expect(PageFileExporter.sanitizeFileName("x".repeat(200)).length).toBe(80);
    });
});

describe("PageFileExporter.buildFilePayload", () => {
    const built = { meta: { title: "测试页", url: "https://x.com/a" }, markdown: "# hi" };
    it("md 载荷", () => {
        const p = PageFileExporter.buildFilePayload(built, "md");
        expect(p.filename).toBe("测试页.md");
        expect(p.content).toBe("# hi");
        expect(p.mime).toContain("markdown");
    });
    it("html 载荷含标题与正文", () => {
        const p = PageFileExporter.buildFilePayload(built, "html", "<p>正文</p>");
        expect(p.filename).toBe("测试页.html");
        expect(p.content).toContain("测试页");
        expect(p.content).toContain("<p>正文</p>");
        expect(p.mime).toContain("text/html");
    });
    it("json 载荷可解析", () => {
        const p = PageFileExporter.buildFilePayload(built, "json");
        expect(p.filename).toBe("测试页.json");
        const obj = JSON.parse(p.content);
        expect(obj.kind).toBe("ld-notion-page-file");
        expect(obj.markdown).toBe("# hi");
    });
    it("未知格式回退 md", () => {
        const p = PageFileExporter.buildFilePayload(built, "exe");
        expect(p.filename).toBe("测试页.md");
    });
});

describe("PageFileExporter.buildPublishParams", () => {
    const raw = "正文内容超过十个字符的示例文本内容，足够长。";
    it("topic 正常组装", () => {
        const p = PageFileExporter.buildPublishParams({ mode: "topic", title: "这是一个测试标题文本", raw });
        expect(p.title).toBe("这是一个测试标题文本");
        expect(p.raw).toBe(raw);
        expect(p.archetype).toBe("regular");
        expect(p.category).toBeUndefined();
    });
    it("topic 带数字分类", () => {
        const p = PageFileExporter.buildPublishParams({ mode: "topic", title: "这是一个测试标题文本", raw, category: "4" });
        expect(p.category).toBe("4");
    });
    it("topic 标题过短拒绝", () => {
        expect(() => PageFileExporter.buildPublishParams({ mode: "topic", title: "短", raw })).toThrow(/标题过短/);
    });
    it("topic 非数字分类拒绝", () => {
        expect(() => PageFileExporter.buildPublishParams({ mode: "topic", title: "这是一个测试标题文本", raw, category: "abc" })).toThrow(/分类/);
    });
    it("reply 正常组装", () => {
        const p = PageFileExporter.buildPublishParams({ mode: "reply", topicId: "456", raw });
        expect(p.topic_id).toBe("456");
    });
    it("reply 非数字话题 ID 拒绝", () => {
        expect(() => PageFileExporter.buildPublishParams({ mode: "reply", topicId: "abc", raw })).toThrow(/数字话题/);
    });
    it("正文过短拒绝（topic/reply 同口径）", () => {
        expect(() => PageFileExporter.buildPublishParams({ mode: "topic", title: "这是一个测试标题文本", raw: "太短" })).toThrow(/正文过短/);
        expect(() => PageFileExporter.buildPublishParams({ mode: "reply", topicId: "1", raw: "太短" })).toThrow(/正文过短/);
    });
    it("正文超长拒绝并提示存文件", () => {
        const long = "x".repeat(PageFileExporter.MAX_PUBLISH_RAW_LENGTH + 1);
        expect(() => PageFileExporter.buildPublishParams({ mode: "topic", title: "这是一个测试标题文本", raw: long })).toThrow(/存本地文件/);
    });
});

describe("OperationGuard linuxdo.publish 登记", () => {
    it("level=1（标准权限可执行）", () => {
        expect(OperationGuard.OPERATION_LEVELS["linuxdo.publish"]).toBe(1);
    });
    it("审计事件映射为 linuxdo.post.published", () => {
        expect(OperationLog.AUDIT_EVENT_BY_OPERATION["linuxdo.publish"]).toBe("linuxdo.post.published");
    });
    it("审计目标携带话题/分类 ID 且不含正文", () => {
        const target = OperationLog.buildTarget({ itemName: "新话题《测试》", linuxdoTopicId: "", linuxdoCategory: "4" });
        expect(target.type).toBe("linuxdo_post");
        expect(target.category).toBe("4");
        expect(JSON.stringify(target)).not.toContain("正文");
    });
});

describe("LinuxDoAPI 写操作", () => {
    it("createTopic 非 linux.do 域名拒绝", async () => {
        global.location.hostname = "example.com";
        await expect(LinuxDoAPI.createTopic({ title: "这是一个测试标题文本", raw: "正文内容超过十个字符的示例文本" })).rejects.toThrow(/仅可在 linux\.do/);
    });
    it("replyToTopic 非数字话题 ID 拒绝", async () => {
        await expect(LinuxDoAPI.replyToTopic({ topic_id: "abc", raw: "正文内容超过十个字符的示例文本" })).rejects.toThrow(/数字话题/);
    });
    it("postJson 401/403/422/429 短路不重试", async () => {
        for (const status of [401, 403, 429]) {
            let calls = 0;
            global.fetch = vi.fn(async () => { calls++; return { status, ok: false, json: async () => ({}) }; });
            await expect(LinuxDoAPI.postJson("/posts.json", {})).rejects.toThrow(new RegExp(`HTTP ${status}`));
            expect(calls).toBe(1);
        }
        global.fetch = vi.fn(async () => ({ status: 422, ok: false, json: async () => ({ errors: ["标题太短"] }) }));
        await expect(LinuxDoAPI.postJson("/posts.json", {})).rejects.toThrow(/422.*标题太短/);
    });
    it("postJson 成功返回解析体", async () => {
        global.fetch = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ topic_id: 789, id: 1 }) }));
        const data = await LinuxDoAPI.postJson("/posts.json", { title: "t", raw: "r" });
        expect(data.topic_id).toBe(789);
    });
    it("createTopic 成功返回 topicId 链接要素", async () => {
        global.fetch = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ topic_id: 789, topic_slug: "slug", id: 1 }) }));
        const r = await LinuxDoAPI.createTopic({ title: "这是一个测试标题文本", raw: "正文内容超过十个字符的示例文本" });
        expect(r.topicId).toBe("789");
    });
});
