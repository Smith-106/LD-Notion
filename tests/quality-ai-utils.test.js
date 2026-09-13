import { describe, it, expect } from "vitest";

// quality-auto-test p3-r3 (AT-013, L1): ai/utils 4 纯函数模块契约。
// 断言面: block 文本提取/树收集、用户与评论摘要、结构化结果判定/状态推断、
//         payload 构建(SSRF 闸门/NaN 守卫/checkbox 严格真值/annotations 保留)。
const B = require("../src/ai/utils/block-helpers");
const F = require("../src/ai/utils/format-helpers");
const R = require("../src/ai/utils/result-helpers");
const P = require("../src/ai/utils/payload-builders");

describe("AT-013: ai/utils 纯函数模块契约", () => {
    it("block: 纯文本提取与树收集", async () => {
        expect(B._extractBlockPlainText(null)).toBe("");
        expect(B._extractBlockPlainText({ type: "paragraph" })).toBe("");
        expect(B._extractBlockPlainText({
            type: "paragraph",
            paragraph: { rich_text: [{ plain_text: "A" }, { plain_text: "B" }] },
        })).toBe("AB");

        const fetched = [];
        const tree = await B._collectBlockTree(
            [
                { id: "b1", has_children: false },
                { id: "b2", has_children: true },
            ],
            async (id) => { fetched.push(id); return [{ id: `${id}-c1`, has_children: false }]; }
        );
        expect(fetched).toEqual(["b2"]);
        expect(tree[0].children).toBeUndefined();
        expect(tree[1].children[0].id).toBe("b2-c1");
    });

    it("format: 用户与评论摘要", () => {
        expect(F._formatUserSummary(null)).toBe("未知用户");
        expect(F._formatUserSummary({ type: "bot", name: "机器人", id: "aa-bb" })).toContain("bot");
        const person = F._formatUserSummary({ type: "person", name: "张三", person: { email: "z@x.com" }, id: "aaaa-bbbb" });
        expect(person).toContain("张三");
        expect(person).toContain("<z@x.com>");
        expect(person).toContain("[person]");
        expect(person).not.toContain("-");

        expect(F._formatCommentSummary(null)).toBe("无评论");
        const c = F._formatCommentSummary({
            created_by: { name: "李四" },
            created_time: "2026-01-01T00:00:00Z",
            rich_text: [{ plain_text: "内容" }],
        });
        expect(c).toContain("李四");
        expect(c).toContain("内容");
    });

    it("result: 结构化结果判定与状态推断", () => {
        expect(R._buildStructuredResultText(null)).toBe("");
        const text = R._buildStructuredResultText({ title: "T", summary: "S", details: "D" });
        expect(text).toContain("**T**");
        expect(text).toContain("S");
        expect(text).toContain("D");

        expect(R._isStructuredResult({ __structured: true })).toBe(true);
        expect(R._isStructuredResult([{ __structured: true }])).toBe(false);
        expect(R._isStructuredResult(null)).toBeFalsy();

        expect(R._inferStructuredResultStatus(null)).toBe("unknown");
        expect(R._inferStructuredResultStatus({ success: true })).toBe("success");
        expect(R._inferStructuredResultStatus({ success: false })).toBe("error");
        expect(R._inferStructuredResultStatus({ error: "x" })).toBe("error");
        expect(R._inferStructuredResultStatus({})).toBe("success");
    });

    it("payload: icon/cover SSRF 闸门与属性值收敛", () => {
        expect(P._buildPageIconPayload(null, "x")).toBeNull();
        expect(P._buildPageIconPayload("emoji", "🚀")).toEqual({ type: "emoji", emoji: "🚀" });
        // 注入面: AI 输出的 external URL 必须过 UrlValidator
        expect(P._buildPageIconPayload("external", "javascript:alert(1)")).toBeNull();
        expect(P._buildPageIconPayload("external", "http://169.254.169.254/x")).toBeNull();
        expect(P._buildPageIconPayload("external", "https://example.com/i.png")).toEqual({
            type: "external", external: { url: "https://example.com/i.png" },
        });
        expect(P._buildPageCoverPayload("")).toBeNull();
        expect(P._buildPageCoverPayload("http://localhost:9000/x")).toBeNull();
        expect(P._buildPageCoverPayload("https://example.com/c.png").external.url).toBe("https://example.com/c.png");
    });

    it("payload: _buildPropertyValuePayload 类型适配", () => {
        expect(P._buildPropertyValuePayload("number", "abc")).toEqual({ number: null });
        expect(P._buildPropertyValuePayload("number", "3.5")).toEqual({ number: 3.5 });
        expect(P._buildPropertyValuePayload("number", "")).toEqual({ number: null });
        expect(P._buildPropertyValuePayload("checkbox", "false")).toEqual({ checkbox: false });
        expect(P._buildPropertyValuePayload("checkbox", "TRUE")).toEqual({ checkbox: true });
        expect(P._buildPropertyValuePayload("checkbox", 1)).toEqual({ checkbox: true });
        expect(P._buildPropertyValuePayload("select", "")).toEqual({ select: null });
        expect(P._buildPropertyValuePayload("multi_select", ["a", "", "b"])).toEqual({
            multi_select: [{ name: "a" }, { name: "b" }],
        });
        expect(P._buildPropertyValuePayload("url", "javascript:alert(1)")).toEqual({ url: null });
        expect(P._buildPropertyValuePayload("url", "https://ok.example.com")).toEqual({ url: "https://ok.example.com" });
        expect(P._buildPropertyValuePayload("date", null)).toEqual({ date: null });
        expect(P._buildPropertyValuePayload("unknown-type", "v").rich_text[0].text.content).toBe("v");
    });

    it("payload: block 更新保留 annotations", () => {
        const block = {
            type: "paragraph",
            paragraph: { rich_text: [{ text: { content: "旧" }, annotations: { bold: true } }] },
        };
        const payload = P._buildBlockUpdatePayload(block, "新");
        expect(payload.paragraph.rich_text[0].text.content).toBe("新");
        expect(payload.paragraph.rich_text[0].annotations.bold).toBe(true);
        expect(P._buildBlockUpdatePayload({ type: "" }, "x")).toBeNull();
    });
});
