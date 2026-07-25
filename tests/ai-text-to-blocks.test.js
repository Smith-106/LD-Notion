import { describe, it, expect } from "vitest";
import { AIAssistant } from "../src/ai/index.js";

// ISS-20260723-010 W2: _textToBlocks 测试基线。
// _textToBlocks (ai/index.js:3453) 是 markdown→Notion blocks 核心转换器，被 9 处跨块调用
// (AI_AGENT_TOOLS + AIHandlers)，是 ISS-010 巨石拆分的耦合枢纽 (MAINT-006)。
// 拆分前先固化行为契约，确保提取到 BlockConverter 模块后零回归。

describe("AIAssistant._textToBlocks — markdown 转 Notion blocks (ISS-010 W2 基线)", () => {
    const textToBlocks = AIAssistant._textToBlocks;

    describe("标题", () => {
        it("h1 → heading_1", () => {
            const blocks = textToBlocks("# 一级标题");
            expect(blocks).toHaveLength(1);
            expect(blocks[0]).toEqual({
                type: "heading_1",
                heading_1: { rich_text: [{ type: "text", text: { content: "一级标题" } }] },
            });
        });

        it("h2 → heading_2", () => {
            const blocks = textToBlocks("## 二级标题");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("heading_2");
            expect(blocks[0].heading_2.rich_text[0].text.content).toBe("二级标题");
        });

        it("h3 → heading_3", () => {
            const blocks = textToBlocks("### 三级标题");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("heading_3");
            expect(blocks[0].heading_3.rich_text[0].text.content).toBe("三级标题");
        });

        it("标题切片去掉前缀 (#/##/### + 空格)", () => {
            expect(textToBlocks("# ").at(0)?.heading_1.rich_text[0].text.content).toBe("");
            expect(textToBlocks("##abc").at(0)?.type).toBe("paragraph"); // 无空格不算标题
        });
    });

    describe("分割线", () => {
        it("--- → divider", () => {
            const blocks = textToBlocks("---");
            expect(blocks).toHaveLength(1);
            expect(blocks[0]).toEqual({ type: "divider", divider: {} });
        });

        it("*** → divider", () => {
            const blocks = textToBlocks("***");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("divider");
        });

        it("分割线 trim 后识别 (前后空格)", () => {
            expect(textToBlocks("  ---  ").at(0)?.type).toBe("divider");
        });
    });

    describe("引用", () => {
        it("> text → quote", () => {
            const blocks = textToBlocks("> 引用内容");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("quote");
            expect(blocks[0].quote.rich_text[0].text.content).toBe("引用内容");
        });
    });

    describe("无序列表", () => {
        it("- item → bulleted_list_item", () => {
            const blocks = textToBlocks("- 项目一");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("bulleted_list_item");
            expect(blocks[0].bulleted_list_item.rich_text[0].text.content).toBe("项目一");
        });

        it("* item → bulleted_list_item", () => {
            const blocks = textToBlocks("* 项目二");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("bulleted_list_item");
        });
    });

    describe("有序列表", () => {
        it("1. item → numbered_list_item", () => {
            const blocks = textToBlocks("1. 第一步");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("numbered_list_item");
            expect(blocks[0].numbered_list_item.rich_text[0].text.content).toBe("第一步");
        });

        it("多数字序号都识别", () => {
            expect(textToBlocks("10. 第十步").at(0)?.type).toBe("numbered_list_item");
        });
    });

    describe("段落", () => {
        it("普通文本 → paragraph", () => {
            const blocks = textToBlocks("这是一段普通文本");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("paragraph");
            expect(blocks[0].paragraph.rich_text[0].text.content).toBe("这是一段普通文本");
        });
    });

    describe("空行处理", () => {
        it("空行与纯空白行被跳过", () => {
            const blocks = textToBlocks("第一段\n\n   \n第二段");
            expect(blocks).toHaveLength(2);
            expect(blocks[0].paragraph.rich_text[0].text.content).toBe("第一段");
            expect(blocks[1].paragraph.rich_text[0].text.content).toBe("第二段");
        });

        it("空字符串返回空数组", () => {
            expect(textToBlocks("")).toEqual([]);
            expect(textToBlocks("   \n  \n")).toEqual([]);
        });
    });

    describe("代码块", () => {
        it("```js ... ``` → code block with language", () => {
            const md = "```js\nconst x = 1;\nconsole.log(x);\n```";
            const blocks = textToBlocks(md);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("code");
            expect(blocks[0].code.language).toBe("javascript");
            expect(blocks[0].code.rich_text[0].text.content).toBe("const x = 1;\nconsole.log(x);");
        });

        it("语言映射: py→python, ts→typescript, bash→shell", () => {
            expect(textToBlocks("```py\npass\n```").at(0).code.language).toBe("python");
            expect(textToBlocks("```ts\nconst a=1\n```").at(0).code.language).toBe("typescript");
            expect(textToBlocks("```bash\necho hi\n```").at(0).code.language).toBe("shell");
        });

        it("未知语言 → plain text", () => {
            expect(textToBlocks("```unknownlang\ncode\n```").at(0).code.language).toBe("plain text");
        });

        it("无语言标注 → plain text", () => {
            expect(textToBlocks("```\ncode\n```").at(0).code.language).toBe("plain text");
        });

        it("Notion 原生语言名直接保留 (如 ruby/rust/go)", () => {
            expect(textToBlocks("```ruby\nputs 1\n```").at(0).code.language).toBe("ruby");
            expect(textToBlocks("```rust\nfn main(){}\n```").at(0).code.language).toBe("rust");
        });

        it("代码块内容跨多行保留换行", () => {
            const md = "```js\nline1\nline2\nline3\n```";
            expect(textToBlocks(md).at(0).code.rich_text[0].text.content).toBe("line1\nline2\nline3");
        });

        it("未闭合代码块仍产出 code block", () => {
            const blocks = textToBlocks("```js\nconst x = 1;\nconst y = 2;");
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("code");
            expect(blocks[0].code.language).toBe("javascript");
            expect(blocks[0].code.rich_text[0].text.content).toBe("const x = 1;\nconst y = 2;");
        });

        it("代码块内的列表/标题语法不解析为 block (原样保留)", () => {
            const md = "```\n# 不是标题\n- 不是列表\n```";
            const blocks = textToBlocks(md);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].type).toBe("code");
            expect(blocks[0].code.rich_text[0].text.content).toBe("# 不是标题\n- 不是列表");
        });
    });

    describe("长文本分块 (splitLongText >2000 字符)", () => {
        it("超过 2000 字符的段落切分为多个 rich_text chunk", () => {
            const long = "a".repeat(2500);
            const blocks = textToBlocks(long);
            expect(blocks).toHaveLength(1);
            const rich = blocks[0].paragraph.rich_text;
            expect(rich).toHaveLength(2);
            expect(rich[0].text.content).toHaveLength(2000);
            expect(rich[1].text.content).toHaveLength(500);
        });

        it("恰好 2000 字符不切分", () => {
            const exact = "b".repeat(2000);
            const blocks = textToBlocks(exact);
            expect(blocks[0].paragraph.rich_text).toHaveLength(1);
            expect(blocks[0].paragraph.rich_text[0].text.content).toHaveLength(2000);
        });

        it("超长代码块也切分", () => {
            const longCode = "x".repeat(3500);
            const blocks = textToBlocks("```\n" + longCode + "\n```");
            expect(blocks[0].code.rich_text).toHaveLength(2);
            expect(blocks[0].code.rich_text[0].text.content).toHaveLength(2000);
        });
    });

    describe("混合文档 (端到端顺序保留)", () => {
        it("多类型 block 顺序与数量正确", () => {
            const md = [
                "# 标题",
                "",
                "第一段",
                "",
                "- 列表项",
                "1. 有序项",
                "",
                "> 引用",
                "",
                "```js",
                "code()",
                "```",
                "---",
                "尾段",
            ].join("\n");
            const blocks = textToBlocks(md);
            expect(blocks.map(b => b.type)).toEqual([
                "heading_1",
                "paragraph",
                "bulleted_list_item",
                "numbered_list_item",
                "quote",
                "code",
                "divider",
                "paragraph",
            ]);
        });
    });
});
