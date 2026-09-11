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
            expect(HTMLToMarkdown._convertNode(imgSrc(raw))).toBe("");
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

    it("折叠原语不可互换: foldToSingleLine 保方括号, collapseOneLine 剔方括号", () => {
        expect(DomSpec.foldToSingleLine("[RFC]\r\n8601")).toBe("[RFC] 8601");
        expect(DomSpec.foldToSingleLine("a\rb")).toBe("a b");
        expect(DomSpec.foldToSingleLine(null)).toBe("");
        expect(DomSpec.collapseOneLine("[RFC] 8601")).toBe("RFC 8601");
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

// ===== 清单自检: 清单与 src/ 现状一致(learnings-006 规则 3) =====
// 规则 3: 新增出口必须对照 SURFACE_INVENTORY 接入 DomSpec 原语, 不允许"下一轮审计再补"。
// 本组把清单从文档变成**可执行断言**: 原语消费点缺失 / 实现地重复 = 测试红。
describe("清单自检: 出口面清单与 src/ 现状一致", () => {
    const fs = require("fs");
    const path = require("path");
    const read = (p) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
    const EXPORTERS = ["src/api/DOMToNotion.js", "src/api/obsidian.js"];

    it("清单条目结构完整", () => {
        expect(SURFACE_INVENTORY.length).toBe(6);
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
        for (const name of ["SKIP_TAGS", "eachChildOrdered", "foldToSingleLine", "safeUrl", "mediaUrl", "mediaSrc", "eachMedia"]) {
            expect(`DomSpec | ${name} | ${spec.includes(name)}`).toBe(`DomSpec | ${name} | true`);
        }
        for (const p of EXPORTERS) {
            const src = read(p);
            expect(`${p} | 重声明跳过表 | ${/SKIP_TAGS\s*=/.test(src)}`).toBe(`${p} | 重声明跳过表 | false`);
            expect(`${p} | 重写 script 跳过 | ${/tag === "script"|case "script"/.test(src)}`).toBe(`${p} | 重写 script 跳过 | false`);
        }
    });
});

// ===== SURFACE_INVENTORY =====
// 完整清单与可复现计数见 _surface_inventory.md(P0 产出)。新增出口时:
//   1) 在此登记面名 + 该面必须接入的 DomSpec 原语;
//   2) 在对应 describe 中补一组断言(合法原样 / 危险输入 / 空)。
export const SURFACE_INVENTORY = [
    { surface: "非渲染标签(script/style/noscript)", primitive: "DomSpec.SKIP_TAGS / isSkippedNode", hosts: 6, exporters: 2 },
    { surface: "媒体地址回退(src/data-src/<source src>)", primitive: "DomSpec.mediaSrc", hosts: 4, exporters: 2 },
    { surface: "地址判据(相对补齐 / scheme 白名单 / 公网校验)", primitive: "DomSpec.safeUrl / mediaUrl", hosts: 5, exporters: 2 },
    { surface: "媒体采集(自身+后代)", primitive: "DomSpec.eachMedia / mediaKind", hosts: 7, exporters: 2 },
    { surface: "单行上下文折叠", primitive: "DomSpec.foldToSingleLine / collapseOneLine", hosts: 11, exporters: 2, note: "记录在案的差异: Markdown 侧折叠 CR/LF, Notion 侧 rich_text 保留 \\n" },
    { surface: "emoji 判据", primitive: "DomSpec.emojiNameOf", hosts: 1, exporters: 1, note: "仅 DOMToNotion 消费(转 emoji 文本); obsidian 侧按普通图片写出 emoji 图链接, 不失信息" },
];
