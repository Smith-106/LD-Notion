import { describe, it, expect, beforeAll, afterAll } from "vitest";

// 出口面契约测试 —— 依据 spec:project:learnings-006(同构出口不对称防护 — 出口面统一枚举法):
// 契约按**出口面**写一组(合法原样 / 危险输入 / 空), 而非按 finding 单点写。
// 单一原语驻 src/api/DomSpec.js; DOMToNotion 与 HTMLToMarkdown 必须对同一出口面同口径。
// 规则 3: 新增出口必须对照 SURFACE_INVENTORY(见文件末尾)接入 DomSpec 原语,
// 不允许"下一个审计轮次再补"。
//
// 边界: 本文件只断言**行为契约**(输出不泄漏/不丢失/口径一致), 不断言内部函数名或调用形态。

const { DOMToNotion, HTMLToMarkdown } = require("../src/api");
const { DomSpec } = require("../src/api/DomSpec");

// ---- 桩工具(与 tests/p4-dom-boundary.test.js 同风格: 纯对象 + 局部 Node 常量) ----
// Node 桩必须是**函数**形态: 以普通对象冒充 globalThis.Node 会使 chai/type-detect 的
// `value instanceof 全局构造器` 扫描抛 TypeError(待测代码不受影响)。
const makeNode = () => Object.assign(function Node() {}, { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8 });
let origNode;

beforeAll(() => {
    origNode = globalThis.Node;
    globalThis.Node = makeNode();
});
afterAll(() => {
    if (origNode === undefined) delete globalThis.Node;
    else globalThis.Node = origNode;
});

const textNode = (value) => ({ nodeType: 3, nodeValue: value, textContent: value });
const attrs = (map) => (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null);
const element = (tag, children = [], props = {}) => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: children,
    children,
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { contains: () => false },
    ...props,
});

const JS_SOURCE = "var leaked = 1;";
const CSS_SOURCE = ".leaked { color: red }";
const NOSCRIPT_SOURCE = "noscript-fallback-text";

// ===== 出口面 1: 非渲染标签(script / style / noscript) =====
// 每个宿主都必须排除; 两导出器必须同口径
describe("出口面: 非渲染标签在每个宿主内均被排除", () => {
    const SKIPPED = [
        ["script", JS_SOURCE],
        ["style", CSS_SOURCE],
        ["noscript", NOSCRIPT_SOURCE],
    ];
    // 宿主面: 段落 / li / 表格单元格 / blockquote / 未匹配容器 / div 根
    const HOSTS = [
        ["div", (child) => element("div", [child])],
        ["p", (child) => element("p", [child])],
        ["li", (child) => element("li", [child])],
        ["td", (child) => element("td", [child])],
        ["blockquote", (child) => element("blockquote", [child])],
        ["article(未匹配容器)", (child) => element("article", [child])],
    ];
    const skipChild = (tag, source) => element(tag, [textNode(source)], { getAttribute: attrs({}) });

    it("DOMToNotion: 源码不进 rich_text", () => {
        for (const [hostName, build] of HOSTS) {
            for (const [tag, source] of SKIPPED) {
                const rt = DOMToNotion.serializeRichText(build(skipChild(tag, source)));
                const joined = rt.map((r) => r.text.content).join("");
                expect(`${hostName} | <${tag}> | ${joined}`).toBe(`${hostName} | <${tag}> | `);
            }
        }
    });

    it("HTMLToMarkdown: 源码不进 Markdown", () => {
        for (const [hostName, build] of HOSTS) {
            for (const [tag, source] of SKIPPED) {
                const md = HTMLToMarkdown._convertNode(build(skipChild(tag, source)));
                // 不从简为“输出为空”: 空 <li> 等宿主自身会产出合法标记(如 "-"),
                // 契约是源码不得泄漏进正文
                expect(`${hostName} | <${tag}> | ${md}`).not.toContain(source);
            }
        }
    });

    it("单一判据: 跳过表只有 DomSpec.SKIP_TAGS 一处", () => {
        expect([...DomSpec.SKIP_TAGS].sort()).toEqual(["noscript", "script", "style"]);
        expect(DomSpec.isSkippedNode(element("script"))).toBe(true);
        expect(DomSpec.isSkippedNode(element("STYLE"))).toBe(true);
        expect(DomSpec.isSkippedNode(element("div"))).toBe(false);
        expect(DomSpec.isSkippedNode(element("p"))).toBe(false);
    });
});

// ===== 出口面 2: 媒体地址回退口径(src / data-src / <source src>) =====
// 三个回退必须对所有媒体元素同口径, 且两导出器一致
describe("出口面: 媒体地址回退", () => {
    const IMAGE_SRC = "https://cdn.example.com/pic.png";
    const VIDEO_SRC = "https://cdn.example.com/clip.mp4";
    const AUDIO_SRC = "https://cdn.example.com/sound.mp3";
    const sourceChild = (src) => element("source", [], { getAttribute: attrs({ src }) });
    const withSource = (src) => ({ querySelector: () => sourceChild(src) });

    it("DomSpec.mediaSrc 覆盖 src / data-src / <source src>", () => {
        expect(DomSpec.mediaSrc(element("img", [], { getAttribute: attrs({ src: "s" }) }))).toBe("s");
        expect(DomSpec.mediaSrc(element("img", [], { getAttribute: attrs({ "data-src": "d" }) }))).toBe("d");
        expect(DomSpec.mediaSrc(element("img", [], { getAttribute: attrs({ src: "s", "data-src": "d" }) }))).toBe("s");
        expect(DomSpec.mediaSrc(element("video", [], { getAttribute: attrs({}), ...withSource("v") }))).toBe("v");
        expect(DomSpec.mediaSrc(element("video", [], { getAttribute: attrs({}) }))).toBe("");
        expect(DomSpec.mediaSrc(null)).toBe("");
    });

    it("DOMToNotion: 懒加载图与 <source> 型视频/音频都产出块", () => {
        const lazy = [];
        DOMToNotion._cookImage(element("img", [], { getAttribute: attrs({ "data-src": IMAGE_SRC }) }), lazy, "external");
        expect(lazy.map((b) => b.type)).toEqual(["image"]);

        const video = [];
        DOMToNotion._cookVideo(element("video", [], { getAttribute: attrs({}), ...withSource(VIDEO_SRC) }), video, "external");
        expect(video.length).toBe(1);

        const audio = [];
        DOMToNotion._cookAudio(element("audio", [], { getAttribute: attrs({}), ...withSource(AUDIO_SRC) }), audio, "external");
        expect(audio.length).toBe(1);
    });

    it("HTMLToMarkdown: 同一批输入给出同口径链接", () => {
        expect(HTMLToMarkdown._convertNode(element("img", [], { getAttribute: attrs({ "data-src": IMAGE_SRC }) }))).toContain(IMAGE_SRC);
        expect(HTMLToMarkdown._convertNode(element("video", [], { getAttribute: attrs({}), ...withSource(VIDEO_SRC) }))).toContain(VIDEO_SRC);
        expect(HTMLToMarkdown._convertNode(element("audio", [], { getAttribute: attrs({}), ...withSource(AUDIO_SRC) }))).toContain(AUDIO_SRC);
        expect(HTMLToMarkdown._convertNode(element("iframe", [], { getAttribute: attrs({ src: "https://cdn.example.com/embed" }) }))).toContain("https://cdn.example.com/embed");
    });

    it("危险 scheme 两侧都拒绝(不生成链接/不产出块)", () => {
        const dangerous = ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "http://127.0.0.1/x.png", "http://169.254.169.254/latest/meta-data"];
        for (const src of dangerous) {
            const blocks = [];
            DOMToNotion._cookImage(element("img", [], { getAttribute: attrs({ src }) }), blocks, "external");
            expect(`${src} -> ${blocks.length}`).toBe(`${src} -> 0`);
            expect(HTMLToMarkdown._convertNode(element("img", [], { getAttribute: attrs({ src }) }))).not.toContain("](");
        }
    });
});

// ===== 出口面 3: 媒体采集的"自身即媒体" =====
// querySelectorAll 只查后代 —— 宿主元素自身即媒体时必须同样被消费
describe("出口面: 媒体采集覆盖自身与后代", () => {
    it("DomSpec.eachMedia 自身即媒体时同样回调", () => {
        const seen = [];
        DomSpec.eachMedia(element("img", [], { getAttribute: attrs({ src: "https://cdn.example.com/x.png" }) }), (node, kind) => seen.push(kind));
        expect(seen).toEqual(["img"]);
    });

    it("DomSpec.eachMedia 对非媒体宿主只报后代", () => {
        const seen = [];
        const host = element("ul", [element("img", [], { getAttribute: attrs({}) })], {
            querySelectorAll: (sel) => (sel === "img" ? [element("img", [], { getAttribute: attrs({}) })] : []),
        });
        DomSpec.eachMedia(host, (node, kind) => seen.push(kind));
        expect(seen).toEqual(["img"]);
    });

    it("_consumeInlineMedia: 自身为 a.attachment 时同样产出 file 块", () => {
        const blocks = [];
        DOMToNotion._consumeInlineMedia(
            element("a", [], {
                getAttribute: attrs({ href: "https://example.com/doc.pdf" }),
                classList: { contains: (c) => c === "attachment" },
                textContent: "doc.pdf",
            }),
            blocks,
            "external",
        );
        expect(blocks.map((b) => b.type)).toEqual(["file"]);
    });
});

// ===== SURFACE_INVENTORY =====
// 完整清单与可复现计数见 _surface_inventory.md(P0 产出)。新增出口时:
//   1) 在此登记面名 + 该面必须接入的 DomSpec 原语;
//   2) 在对应 describe 中补一组断言(合法原样 / 危险输入 / 空)。
export const SURFACE_INVENTORY = [
    { surface: "非渲染标签(script/style/noscript)", primitive: "DomSpec.SKIP_TAGS / isSkippedNode", hosts: 6, exporters: 2 },
    { surface: "媒体地址回退(src/data-src/<source src>)", primitive: "DomSpec.mediaSrc", hosts: 4, exporters: 2 },
    { surface: "媒体采集(自身+后代)", primitive: "DomSpec.eachMedia / mediaKind", hosts: 7, exporters: 2 },
];
