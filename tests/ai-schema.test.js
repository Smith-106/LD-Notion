import { describe, it, expect } from "vitest";
const { AISchema } = require("../src/ai/schema.js");

// ISS-20260723-009 (CWE-94): AI 输出 schema 校验层契约测试。
// 固化 AI 返回的属性名/值/URL 经校验后的安全行为，防回归。

describe("AISchema — AI 输出 schema 校验层 (ISS-009)", () => {
    describe("validatePageExternalUrl (SSRF 防御)", () => {
        it("接受合法 http(s) URL", () => {
            expect(AISchema.validatePageExternalUrl("https://example.com/icon.png")).toBe(true);
            expect(AISchema.validatePageExternalUrl("http://example.com/cover.jpg")).toBe(true);
        });

        it("拒绝非 http(s) 协议（javascript:/data:/file:）", () => {
            expect(AISchema.validatePageExternalUrl("javascript:alert(1)")).toBe(false);
            expect(AISchema.validatePageExternalUrl("data:text/html,<script>")).toBe(false);
            expect(AISchema.validatePageExternalUrl("file:///etc/passwd")).toBe(false);
        });

        it("拒绝内网/私有/链路本地地址（防云元数据 SSRF）", () => {
            expect(AISchema.validatePageExternalUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
            expect(AISchema.validatePageExternalUrl("http://127.0.0.1/admin")).toBe(false);
            expect(AISchema.validatePageExternalUrl("http://10.0.0.1/internal")).toBe(false);
            expect(AISchema.validatePageExternalUrl("http://192.168.1.1/router")).toBe(false);
            expect(AISchema.validatePageExternalUrl("http://172.16.0.1/x")).toBe(false);
        });

        it("拒绝空/畸形 URL", () => {
            expect(AISchema.validatePageExternalUrl("")).toBe(false);
            expect(AISchema.validatePageExternalUrl("not-a-url")).toBe(false);
            expect(AISchema.validatePageExternalUrl(null)).toBe(false);
        });
    });

    describe("validatePropertyName (属性名白名单)", () => {
        it("接受合法属性名（中英数字+下划线/连字符/空格）", () => {
            expect(AISchema.validatePropertyName("标题")).toBe("标题");
            expect(AISchema.validatePropertyName("My Prop-1")).toBe("My Prop-1");
            expect(AISchema.validatePropertyName("tags_list")).toBe("tags_list");
        });

        it("拒绝特殊字符属性名", () => {
            expect(AISchema.validatePropertyName("name<script>")).toBe("");
            expect(AISchema.validatePropertyName('a"b')).toBe("");
            expect(AISchema.validatePropertyName("a\nb")).toBe("");
        });

        it("截断超长属性名", () => {
            const long = "a".repeat(100);
            const result = AISchema.validatePropertyName(long);
            expect(result.length).toBe(AISchema.MAX_PROP_NAME);
        });

        it("拒绝 Notion 保留名", () => {
            expect(AISchema.validatePropertyName("title")).toBe("");
            expect(AISchema.validatePropertyName("created_time")).toBe("");
            expect(AISchema.validatePropertyName("created_by")).toBe("");
        });

        it("拒绝空/非字符串", () => {
            expect(AISchema.validatePropertyName("")).toBe("");
            expect(AISchema.validatePropertyName("   ")).toBe("");
            expect(AISchema.validatePropertyName(null)).toBe("");
        });
    });

    describe("validatePropertyType", () => {
        it("接受合法类型", () => {
            expect(AISchema.validatePropertyType("title").valid).toBe(true);
            expect(AISchema.validatePropertyType("rich_text").valid).toBe(true);
            expect(AISchema.validatePropertyType("number").valid).toBe(true);
            expect(AISchema.validatePropertyType("multi_select").valid).toBe(true);
            expect(AISchema.validatePropertyType("date").valid).toBe(true);
        });

        it("拒绝非法类型", () => {
            expect(AISchema.validatePropertyType("relation").valid).toBe(false);
            expect(AISchema.validatePropertyType("people").valid).toBe(false);
            expect(AISchema.validatePropertyType("rm -rf").valid).toBe(false);
            expect(AISchema.validatePropertyType("").valid).toBe(false);
        });
    });

    describe("validatePropertyValue", () => {
        it("title/rich_text 截断到上限", () => {
            const long = "x".repeat(3000);
            expect(AISchema.validatePropertyValue(long, "title").length).toBe(AISchema.MAX_TITLE);
            expect(AISchema.validatePropertyValue(long, "rich_text").length).toBe(AISchema.MAX_RICH_TEXT);
        });

        it("select 截断", () => {
            const long = "x".repeat(200);
            expect(AISchema.validatePropertyValue(long, "select").length).toBe(AISchema.MAX_SELECT_NAME);
        });

        it("number 拒绝 Infinity/NaN/超大数", () => {
            expect(AISchema.validatePropertyValue("Infinity", "number")).toBe(null);
            expect(AISchema.validatePropertyValue("1e400", "number")).toBe(null);
            expect(AISchema.validatePropertyValue("abc", "number")).toBe(null);
            expect(AISchema.validatePropertyValue(42, "number")).toBe(42);
        });

        it("date 校验 ISO8601 格式", () => {
            expect(AISchema.validatePropertyValue("2026-07-23", "date")).toBe("2026-07-23");
            expect(AISchema.validatePropertyValue("2026-07-23T10:30:00Z", "date")).toBe("2026-07-23T10:30:00Z");
            expect(AISchema.validatePropertyValue("not-a-date", "date")).toBe(null);
            expect(AISchema.validatePropertyValue("'; DROP TABLE--", "date")).toBe(null);
        });

        it("multi_select 返回字符串数组", () => {
            const result = AISchema.validatePropertyValue(["a", "b"], "multi_select");
            expect(Array.isArray(result)).toBe(true);
            expect(result).toEqual(["a", "b"]);
        });

        it("checkbox 转 boolean", () => {
            expect(AISchema.validatePropertyValue(true, "checkbox")).toBe(true);
            expect(AISchema.validatePropertyValue(0, "checkbox")).toBe(false);
        });
    });

    describe("validateEmoji", () => {
        it("接受合法 emoji", () => {
            expect(AISchema.validateEmoji("📝")).toBe("📝");
            expect(AISchema.validateEmoji("🚀")).toBe("🚀");
        });

        it("截断超长", () => {
            const long = "a".repeat(50);
            expect(AISchema.validateEmoji(long).length).toBe(AISchema.MAX_EMOJI);
        });

        it("拒绝控制字符", () => {
            expect(AISchema.validateEmoji("a\nb")).toBe("");
            expect(AISchema.validateEmoji("a\x00b")).toBe("");
        });
    });

    describe("sanitizeObjectValue (对象值白名单)", () => {
        it("保留合法属性类型键", () => {
            const result = AISchema.sanitizeObjectValue({ rich_text: [{ text: "x" }], number: 5 });
            expect(result).toEqual({ rich_text: [{ text: "x" }], number: 5 });
        });

        it("拒绝 relation/people/created_by 等系统字段", () => {
            const result = AISchema.sanitizeObjectValue({
                relation: { database_id: "attacker-uuid" },
                people: [{ id: "x" }],
                created_by: { id: "y" },
                rich_text: [{ text: "ok" }],
            });
            expect(result).toEqual({ rich_text: [{ text: "ok" }] });
            expect(result.relation).toBeUndefined();
            expect(result.people).toBeUndefined();
            expect(result.created_by).toBeUndefined();
        });

        it("全非法返回 null", () => {
            expect(AISchema.sanitizeObjectValue({ relation: {} })).toBe(null);
            expect(AISchema.sanitizeObjectValue(null)).toBe(null);
            expect(AISchema.sanitizeObjectValue([])).toBe(null);
        });
    });

    describe("validateExtractToDatabaseSchema (结构校验)", () => {
        it("接受合法结构", () => {
            const r = AISchema.validateExtractToDatabaseSchema({
                properties: [{ name: "标题", type: "title" }],
                entries: [{ 标题: "x" }],
            });
            expect(r.ok).toBe(true);
        });

        it("拒绝 properties/entries 非数组（M3: 不再 TypeError 被吞）", () => {
            expect(AISchema.validateExtractToDatabaseSchema({ properties: "x", entries: [] }).ok).toBe(false);
            expect(AISchema.validateExtractToDatabaseSchema({ properties: [], entries: "x" }).ok).toBe(false);
            expect(AISchema.validateExtractToDatabaseSchema({ properties: {}, entries: {} }).ok).toBe(false);
        });

        it("拒绝空 entries", () => {
            expect(AISchema.validateExtractToDatabaseSchema({
                properties: [{ name: "x", type: "title" }], entries: [],
            }).ok).toBe(false);
        });

        it("拒绝属性 name/type 缺失", () => {
            expect(AISchema.validateExtractToDatabaseSchema({
                properties: [{ name: "", type: "title" }], entries: [{}],
            }).ok).toBe(false);
            expect(AISchema.validateExtractToDatabaseSchema({
                properties: [{ name: "x", type: "" }], entries: [{}],
            }).ok).toBe(false);
        });
    });

    describe("parseAIJson (统一解析入口)", () => {
        it("提取并解析合法 JSON", () => {
            const raw = '前缀文字 {"properties":[{"name":"标题","type":"title"}],"entries":[{"标题":"x"}]} 后缀';
            const r = AISchema.parseAIJson("extractToDatabase", raw);
            expect(r.ok).toBe(true);
            expect(r.value.properties[0].name).toBe("标题");
        });

        it("无 JSON 返回明确原因", () => {
            const r = AISchema.parseAIJson("extractToDatabase", "纯文本无 JSON");
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/未找到 JSON/);
        });

        it("畸形 JSON 返回明确原因", () => {
            const r = AISchema.parseAIJson("extractToDatabase", "{invalid json}");
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/格式无效/);
        });

        it("extractToDatabase 结构非法返回明确原因", () => {
            const r = AISchema.parseAIJson("extractToDatabase", '{"properties":"not-array","entries":[]}');
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/不是数组/);
        });

        it("空输入返回明确原因", () => {
            expect(AISchema.parseAIJson("x", "").ok).toBe(false);
            expect(AISchema.parseAIJson("x", null).ok).toBe(false);
        });
    });

    // ISS-20260723-010 W8 (SEC-009): bookmark AI 摘要 schema 校验契约。
    // generateAISummary 改用 parseAIJson("bookmarkSummary", ...) 统一接缝后，
    // AI 返回非字符串 title/summary 必须被拒（防 CWE-94 注入），降级返回 null。
    describe("validateBookmarkSummarySchema (SEC-009)", () => {
        it("合法 title/summary 字符串通过", () => {
            const r = AISchema.validateBookmarkSummarySchema({ title: "标题", summary: "摘要" });
            expect(r.ok).toBe(true);
        });

        it("缺 title/summary 也通过（可选字段，消费侧 || 兜底）", () => {
            expect(AISchema.validateBookmarkSummarySchema({}).ok).toBe(true);
            expect(AISchema.validateBookmarkSummarySchema({ title: "仅标题" }).ok).toBe(true);
        });

        it("title 非 string 拒绝", () => {
            const r = AISchema.validateBookmarkSummarySchema({ title: 123, summary: "ok" });
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/title 不是字符串/);
        });

        it("summary 非 string 拒绝", () => {
            const r = AISchema.validateBookmarkSummarySchema({ title: "ok", summary: { evil: true } });
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/summary 不是字符串/);
        });

        it("非对象拒绝", () => {
            expect(AISchema.validateBookmarkSummarySchema(null).ok).toBe(false);
            expect(AISchema.validateBookmarkSummarySchema("string").ok).toBe(false);
            expect(AISchema.validateBookmarkSummarySchema([1, 2]).ok).toBe(false);
        });
    });

    describe("parseAIJson bookmarkSummary 路由 (SEC-009)", () => {
        it("合法 JSON 通过并返回 value", () => {
            const r = AISchema.parseAIJson("bookmarkSummary", '{"title":"t","summary":"s"}');
            expect(r.ok).toBe(true);
            expect(r.value.title).toBe("t");
            expect(r.value.summary).toBe("s");
        });

        it("AI 返回非字符串 title 经路由校验拒绝", () => {
            const r = AISchema.parseAIJson("bookmarkSummary", '{"title":123,"summary":"s"}');
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/title 不是字符串/);
        });

        it("无 JSON 返回未找到原因", () => {
            const r = AISchema.parseAIJson("bookmarkSummary", "纯文本无 JSON");
            expect(r.ok).toBe(false);
            expect(r.reason).toMatch(/未找到 JSON/);
        });
    });
});
