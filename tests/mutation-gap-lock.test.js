import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// 变异缺口锁 —— 针对 `npm run verify:mutation` 在 src/api/{DomSpec,obsidian,DOMToNotion}.js
// 上暴露的**未被测试覆盖的分支**(每条对应一次 SURVIVED 变异)补断言。
// 缺口 = 未覆盖分支 = 潜在 bug 面: 传输层错误路径、媒体/注解判据、表格与长度上限的端点值。
// 断言只锁**可观测行为**(返回结构/可见文本/告警), 不锁内部实现形态。

const { DomSpec } = require("../src/api/DomSpec.js");
const { ObsidianAPI, HTMLToMarkdown } = require("../src/api/obsidian.js");
const { DOMToNotion } = require("../src/api/DOMToNotion.js");

// ---- 桩工具(与 tests/dom-exit-surface.test.js 同风格) ----
const makeNode = () => Object.assign(function Node() {}, { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8 });
let origNode;

beforeAll(() => {
    origNode = globalThis.Node;
    globalThis.Node = makeNode();
});
afterAll(() => {
    if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
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
const classes = (...names) => ({ contains: (n) => names.includes(n) });

// cookedToBlocks 经 new DOMParser().parseFromString(html).body 取根 —— 与既有套件同法注入。
// 桩对输入敏感: 空字符串得到空体(否则 `convert(arg)` 类的变异会被桩屏蔽而不可观测)。
const withDom = (body, fn) => {
    const orig = globalThis.DOMParser;
    globalThis.DOMParser = function () {
        return { parseFromString: (html) => ({ body: html ? body : { childNodes: [] } }) };
    };
    try { return fn(); } finally {
        if (orig === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = orig;
    }
};
const blocksOf = (body, imgMode) => withDom(body, () => DOMToNotion.cookedToBlocks("<div>x</div>", imgMode || "upload"));

// ===== §1 DomSpec 判据原语 =====
describe("DomSpec 判据原语(标签取值 / 类名容器 / 属性回退)", () => {
    it("tagOf: 元素取小写标签名, 非元素/无标签得空串", () => {
        expect(DomSpec.tagOf(element("DIV"))).toBe("div");
        expect(DomSpec.tagOf(element("Img"))).toBe("img");
        expect(DomSpec.tagOf(textNode("x"))).toBe("");
        expect(DomSpec.tagOf({ nodeType: 1 })).toBe("");
        expect(DomSpec.tagOf(null)).toBe("");
        expect(DomSpec.tagOf(undefined)).toBe("");
    });

    it("isBlockNode: 类名容器判据独立于标签(非块级标签 + 容器类名 → 块级)", () => {
        // span 不在 BLOCK_TAGS —— 断言才能真正压到类名判据(用 div 会被标签集短路为 true)
        expect(DomSpec.isBlockNode(element("span", [], { classList: classes("lightbox-wrapper") }))).toBe(true);
        expect(DomSpec.isBlockNode(element("span", [], { classList: classes("image-wrapper") }))).toBe(true);
        expect(DomSpec.isBlockNode(element("span", [], { classList: classes("md-table") }))).toBe(true);
        expect(DomSpec.isBlockNode(element("a", [], { classList: classes("attachment") }))).toBe(true);
        expect(DomSpec.isBlockNode(element("aside", [], { classList: classes("quote") }))).toBe(true);
    });

    it("isBlockNode: 容器类名仅限于各自标签(a.attachment / aside.quote), 同名的其它标签不生效", () => {
        expect(DomSpec.isBlockNode(element("span", [], { classList: classes("attachment") }))).toBe(false);
        expect(DomSpec.isBlockNode(element("span", [], { classList: classes("quote") }))).toBe(false);
    });

    it("isBlockNode: 普通内联元素与缺失 classList 的对象均非块级", () => {
        // 缺 classList(旧式桩/异常对象)时不得被判为灯箱(否则整段内容被当图片容器处理)
        expect(DomSpec.isBlockNode({ nodeType: 1, tagName: "SPAN" })).toBe(false);
        expect(DomSpec.isBlockNode(element("span", [], { classList: classes("other") }))).toBe(false);
        expect(DomSpec.isBlockNode(element("a", [], { classList: classes("other") }))).toBe(false);
        // 标签本身属块级集时与类名无关(aside 默认块级; 仅 aside.quote 属类名灯箱族)
        expect(DomSpec.isBlockNode(element("aside", [], { classList: classes("other") }))).toBe(true);
    });

    it("mediaKind: 附件判据限于 a.attachment, 同名类名的其它标签不视为媒体", () => {
        expect(DomSpec.mediaKind(element("a", [], { classList: classes("attachment") }))).toBe("attachment");
        expect(DomSpec.mediaKind(element("span", [], { classList: classes("attachment") }))).toBe(null);
        expect(DomSpec.mediaKind(element("a", [], { classList: classes("other") }))).toBe(null);
        expect(DomSpec.mediaKind(element("img"))).toBe("img");
    });

    it("mediaSrc: 无 getAttribute 的节点得空串(不抛)", () => {
        expect(DomSpec.mediaSrc({ nodeType: 1, tagName: "IMG" })).toBe("");
    });

    it("mediaSrc: <source> 子节点缺 getAttribute 时静默跳过(不抛)", () => {
        const picture = element("picture", [], {
            getAttribute: attrs({ src: "https://cdn.example.com/p.png" }),
            querySelector: () => ({ nodeType: 1, tagName: "SOURCE" }),
        });
        expect(DomSpec.mediaSrc(picture)).toBe("https://cdn.example.com/p.png");
        expect(DomSpec.mediaSrc(element("img", [], { getAttribute: attrs({}), querySelector: () => ({ nodeType: 1, tagName: "SOURCE" }) }))).toBe("");
    });

    it("textWithBreaks: 文本节点 nodeValue 为空时回退 textContent(最小桩口径)", () => {
        expect(DomSpec.textWithBreaks({ nodeType: 3, nodeValue: "", textContent: "x" })).toBe("x");
        // 有 childNodes 的宿主走递归分支(上一行的无 childNodes 桩走 textContent 整体回退)
        expect(DomSpec.textWithBreaks(element("div", [{ nodeType: 3, nodeValue: "", textContent: "x" }]))).toBe("x");
        expect(DomSpec.textWithBreaks(textNode("a"))).toBe("a");
        // <br> 产换行, 元素下钻
        expect(DomSpec.textWithBreaks(element("div", [textNode("a"), element("br"), textNode("b")]))).toBe("a\nb");
    });
});

// ===== §2 obsidian 传输层结果契约 =====
describe("obsidian 传输层: {ok,error} 契约与状态码判据", () => {
    const savedGm = global.GM_xmlhttpRequest;
    afterAll(() => { global.GM_xmlhttpRequest = savedGm; });
    const reply = (status, statusText = "OK") => { global.GM_xmlhttpRequest = (opts) => opts.onload({ status, statusText }); };

    it("testConnection: 200/204 视为连通, 201 不视为连通", async () => {
        reply(200);
        expect((await ObsidianAPI.testConnection("http://127.0.0.1:27123", "k")).ok).toBe(true);
        reply(204);
        expect((await ObsidianAPI.testConnection("http://127.0.0.1:27123", "k")).ok).toBe(true);
        reply(201);
        expect((await ObsidianAPI.testConnection("http://127.0.0.1:27123", "k")).ok).toBe(false);
    });

    it("testConnection: 非 2xx 返回 {ok:false} + 原样状态码", async () => {
        reply(500, "Server Error");
        const r = await ObsidianAPI.testConnection("http://127.0.0.1:27123", "k");
        expect(r.ok).toBe(false);
        expect(r.error).toContain("500");
    });

    it("testConnection: 非法 URL 在发起请求前被拦(安全校验)", async () => {
        let called = false;
        global.GM_xmlhttpRequest = () => { called = true; };
        const r = await ObsidianAPI.testConnection("http://evil.example.com", "k");
        expect(r.ok).toBe(false);
        expect(r.error).toContain("安全校验");
        expect(called).toBe(false);
    });

    it("testConnection: 网络异常返回 {ok:false}(不抛)", async () => {
        global.GM_xmlhttpRequest = (opts) => opts.onerror(new Error("ECONNREFUSED"));
        const r = await ObsidianAPI.testConnection("http://127.0.0.1:27123", "k");
        expect(r.ok).toBe(false);
        expect(r.error).toContain("ECONNREFUSED");
    });

    it("writeNote: 200/201/204 成功, 500 失败, 空路径失败且不发请求", async () => {
        for (const status of [200, 201, 204]) {
            reply(status);
            expect((await ObsidianAPI.writeNote("http://127.0.0.1:27123", "k", "n.md", "b")).ok).toBe(true);
        }
        reply(500, "Server Error");
        expect((await ObsidianAPI.writeNote("http://127.0.0.1:27123", "k", "n.md", "b")).ok).toBe(false);
        let called = false;
        global.GM_xmlhttpRequest = () => { called = true; };
        const empty = await ObsidianAPI.writeNote("http://127.0.0.1:27123", "k", "../..", "b");
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain("无效");
        expect(called).toBe(false);
    });

    it("writeImage: 200 成功, 500 失败, 非法 URL 被拦", async () => {
        reply(200);
        expect((await ObsidianAPI.writeImage("http://127.0.0.1:27123", "k", "a.png", "blob", "image/png")).ok).toBe(true);
        reply(500, "Server Error");
        expect((await ObsidianAPI.writeImage("http://127.0.0.1:27123", "k", "a.png", "blob")).ok).toBe(false);
        const bad = await ObsidianAPI.writeImage("https://evil.example.com", "k", "a.png", "blob");
        expect(bad.ok).toBe(false);
    });

    it("writeImage: 未给 contentType 时回退 application/octet-stream", async () => {
        let headers = null;
        global.GM_xmlhttpRequest = (opts) => { headers = opts.headers; opts.onload({ status: 200, statusText: "OK" }); };
        await ObsidianAPI.writeImage("http://127.0.0.1:27123", "k", "a.bin", "blob");
        expect(headers["Content-Type"]).toBe("application/octet-stream");
    });

    it("_safeVaultPath: 逐段编码并剔除空段/./.. 段", () => {
        expect(ObsidianAPI._safeVaultPath("a//b.md")).toBe("a/b.md");
        expect(ObsidianAPI._safeVaultPath("a/./b.md")).toBe("a/b.md");
        expect(ObsidianAPI._safeVaultPath("a/../b.md")).toBe("a/b.md");
        expect(ObsidianAPI._safeVaultPath("dir/中 文.md")).toBe("dir/%E4%B8%AD%20%E6%96%87.md");
        expect(ObsidianAPI._safeVaultPath(null)).toBe("");
    });
});

// ===== §3 obsidian Markdown 转换边界 =====
describe("obsidian Markdown 出口边界(列表非项内容 / 续行缩进 / pre 内 code)", () => {
    it("有序列表的非 li 子节点: 元素产物保留字面空白, 文本节点裁剪行首尾", () => {
        const html = HTMLToMarkdown._convertNode(element("ol", [
            element("span", [textNode(" a ")]), element("li", [textNode("b")]),
        ]));
        expect(html).toBe(" a \n\n1. b\n\n");
        const plain = HTMLToMarkdown._convertNode(element("ol", [
            textNode(" a "), element("li", [textNode("b")]),
        ]));
        expect(plain).toBe("a\n\n1. b\n\n");
    });

    it("有序列表续行按父项内容列缩进(不被折成同级)", () => {
        const html = HTMLToMarkdown._convertNode(element("ol", [
            element("li", [textNode("x"), element("p", [textNode("  y")])]),
        ]));
        expect(html).toBe("1. x\n   \n     y\n\n");
    });

    it("pre 内 code 取原始文本, 反斜杠转义不生效", () => {
        const html = HTMLToMarkdown._convertNode(element("pre", [element("code", [textNode("arr[0]")])]));
        expect(html).toContain("arr[0]");
        expect(html).not.toContain("arr\\[0\\]");
    });

    it("buildPostCallout: 缺失用户名/楼层号回退, 无 cooked 不抛", () => {
        withDom(element("body", []), () => {
            const noName = HTMLToMarkdown.buildPostCallout({}, 0, true);
            expect(noName).toContain("未知");
            const zeroFloor = HTMLToMarkdown.buildPostCallout({ name: "a", post_number: 0 }, 2, false);
            expect(zeroFloor).toContain("#3");
            expect(() => HTMLToMarkdown.buildPostCallout({ name: "a" }, 0, true)).not.toThrow();
        });
    });
});

// ===== §4 DOMToNotion 注解与媒体 =====
describe("DOMToNotion 注解与媒体判据", () => {
    const marks = (blocks) => blocks.flatMap((b) => (b.paragraph ? b.paragraph.rich_text.map((r) => r.annotations) : []));
    const img = (src) => element("img", [], { getAttribute: attrs(src === undefined ? {} : { src }) });

    it("em/i → italic, s/del → strikethrough", () => {
        expect(marks(blocksOf(element("body", [element("div", [element("em", [textNode("x")])])])))).toEqual([{ italic: true }]);
        expect(marks(blocksOf(element("body", [element("div", [element("i", [textNode("x")])])])))).toEqual([{ italic: true }]);
        expect(marks(blocksOf(element("body", [element("div", [element("s", [textNode("x")])])])))).toEqual([{ strikethrough: true }]);
        expect(marks(blocksOf(element("body", [element("div", [element("del", [textNode("x")])])])))).toEqual([{ strikethrough: true }]);
    });

    it("imgMode: upload 标记待上传, skip 不产块, external 直链且不待上传", () => {
        const u = blocksOf(element("body", [element("div", [img("https://cdn.example.com/a.png")])]), "upload");
        expect(u[0]._needsUpload).toBe(true);
        expect(u[0].image.external.url).toBe("https://cdn.example.com/a.png");
        expect(blocksOf(element("body", [element("div", [img("https://cdn.example.com/a.png")])]), "skip")).toEqual([]);
        const e = blocksOf(element("body", [element("div", [img("https://cdn.example.com/a.png")])]), "external");
        expect(e[0]._needsUpload).toBe(false);
    });

    it("无 src 的图片不产块(不消费媒体判据)", () => {
        expect(blocksOf(element("body", [element("div", [img()])]), "external")).toEqual([]);
        expect(blocksOf(element("body", [element("div", [img()])]), "skip")).toEqual([]);
    });

    it("灯箱容器内的图片走块级图片(而非内联并入相邻文本)", () => {
        const box = element("div", [img("https://cdn.example.com/a.png")], { classList: classes("lightbox-wrapper") });
        const blocks = blocksOf(element("body", [box]));
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("image");
    });

    it("视频宿主(含子域与 youtu.be 短链)识别为 embed, 其它 iframe 保留可见文本", () => {
        const iframe = (src) => element("iframe", [], { getAttribute: attrs({ src }) });
        for (const src of ["https://www.youtube.com/embed/x", "https://youtu.be/x", "https://vimeo.com/1", "https://www.bilibili.com/video/x"]) {
            expect(blocksOf(element("body", [iframe(src)]))[0].type).toBe("embed");
        }
        expect(blocksOf(element("body", [iframe("https://example.com/embed")]))[0].type).toBe("paragraph");
        // 非法 URL 不得被当视频宿主(hostname 解析失败)
        expect(blocksOf(element("body", [iframe("not a url")]))[0].type).toBe("paragraph");
    });
});

// ===== §5 表格与长度上限端点 =====
describe("DOMToNotion 表格与长度上限的端点值", () => {
    const row = (n) => element("tr", Array.from({ length: n }, () => element("td", [textNode("x")])));

    it("列数恰为上限(100)时不告警, 101 列才告警", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            blocksOf(element("body", [element("table", [element("tbody", [row(100)])])]));
            expect(warn).not.toHaveBeenCalled();
            blocksOf(element("body", [element("table", [element("tbody", [row(101)])])]));
            expect(warn).toHaveBeenCalledTimes(1);
        } finally { warn.mockRestore(); }
    });

    it("普通表格两个表头标志均为 false", () => {
        const t = element("table", [element("tbody", [row(2)])]);
        const blocks = blocksOf(element("body", [t]));
        expect(blocks[0].table.has_column_header).toBe(false);
        expect(blocks[0].table.has_row_header).toBe(false);
    });

    it("splitLongText: 恰为上限长度仍为单段", () => {
        const chunks = DOMToNotion.splitLongText("a".repeat(2000));
        expect(chunks.length).toBe(1);
        expect(chunks[0].text.content.length).toBe(2000);
    });

    it("splitLongText: 切分点落在代理对中间时回退一码元(不产生孤立代理)", () => {
        // U+10000 / U+10FFFF 的高代理恰好落在 0xD800 / 0xDBFF 端点, 覆盖区间判据两端
        for (const pair of ["\uD800\uDC00", "\uDBFF\uDFFF"]) {
            const full = "a".repeat(1999) + pair + "b".repeat(10);
            const chunks = DOMToNotion.splitLongText(full);
            expect(chunks[0].text.content).toBe("a".repeat(1999));
            expect(chunks[0].text.content.length).toBe(1999);
            expect(chunks.map((c) => c.text.content).join("")).toBe(full);
            expect(chunks.every((c) => !/[\uD800-\uDBFF]$/.test(c.text.content))).toBe(true);
        }
    });
});

// ===== §6 flushInline 片段合并与空白折叠 =====
describe("DOMToNotion 段落片段合并/空白折叠边界", () => {
    const rich = (blocks) => blocks.flatMap((b) => (b.paragraph ? b.paragraph.rich_text : []));

    it("code 片段与普通片段不合并, 其前导空白不被折叠", () => {
        const parts = rich(blocksOf(element("body", [element("div", [element("code", [textNode("a ")]), textNode(" b")])])));
        expect(parts.map((p) => p.text.content)).toEqual(["a ", " b"]);
        expect(parts[0].annotations).toEqual({ code: true });
    });

    it("单侧空白不折叠(仅两侧同为空白才折叠)", () => {
        const parts = rich(blocksOf(element("body", [element("div", [element("b", [textNode("a")]), element("i", [textNode(" b")])])])));
        expect(parts.map((p) => p.text.content)).toEqual(["a", " b"]);
    });

    it("相同链接的相邻片段合并, 不同链接各自成段", () => {
        const link = (txt, href) => element("a", [textNode(txt)], { getAttribute: attrs({ href }) });
        const parts = rich(blocksOf(element("body", [element("div", [
            link("x", "https://a.example/1"),
            link("y", "https://a.example/1"),
            link("z", "https://a.example/2"),
        ])])));
        expect(parts.map((p) => p.text.content + "@" + p.text.link.url))
            .toEqual(["xy@https://a.example/1", "z@https://a.example/2"]);
    });
});

// ===== §7 obsidian 传输层: 精确错误串与路径校验分支 =====
describe("obsidian 传输层: 错误串精确形态与各分支 ok 值", () => {
    const savedGm = global.GM_xmlhttpRequest;
    afterAll(() => { global.GM_xmlhttpRequest = savedGm; });
    const netFail = () => { global.GM_xmlhttpRequest = (opts) => opts.onerror(new Error("ECONNREFUSED")); };

    it("网络异常: 三个入口均返回精确错误串(不是 Error 对象)", async () => {
        netFail();
        const expected = "Obsidian API 请求失败: ECONNREFUSED";
        expect(await ObsidianAPI.testConnection("http://127.0.0.1:27123", "k")).toEqual({ ok: false, error: expected });
        expect(await ObsidianAPI.writeNote("http://127.0.0.1:27123", "k", "n.md", "b")).toEqual({ ok: false, error: expected });
        expect(await ObsidianAPI.writeImage("http://127.0.0.1:27123", "k", "a.png", "blob")).toEqual({ ok: false, error: expected });
    });

    it("writeNote/writeImage: 非本地 URL 在发起请求前被拒(ok=false + 安全校验)", async () => {
        let called = false;
        global.GM_xmlhttpRequest = () => { called = true; };
        const writes = [
            () => ObsidianAPI.writeNote("https://evil.example.com", "k", "n.md", "b"),
            () => ObsidianAPI.writeImage("https://evil.example.com", "k", "a.png", "blob"),
        ];
        for (const fn of writes) {
            const r = await fn();
            expect(r.ok).toBe(false);
            expect(r.error).toContain("安全校验");
        }
        expect(called).toBe(false);
    });

    it("writeImage: 无效图片路径被拒(ok=false), 不发起请求", async () => {
        let called = false;
        global.GM_xmlhttpRequest = () => { called = true; };
        const r = await ObsidianAPI.writeImage("http://127.0.0.1:27123", "k", "../..", "blob");
        expect(r.ok).toBe(false);
        expect(r.error).toContain("无效的图片路径");
        expect(called).toBe(false);
    });

    it("<code> 的父元素是 <pre> 时取原始文本(反斜杠转义不生效)", () => {
        const code = element("code", [textNode("arr[0]")], { parentElement: element("pre") });
        // 围栏由 <pre> 分支产出 —— 此处只验证 code 分支未做转义
        expect(HTMLToMarkdown._convertNode(code)).toBe("arr[0]");
    });

    it("<a> 内无媒体时不进入媒体字面化分支(嵌套图片标签保持合法)", () => {
        const link = element("a", [element("img", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.png", alt: "t" }) })], {
            getAttribute: attrs({ href: "https://a.example/1" }),
            querySelector: () => null,
        });
        const md = HTMLToMarkdown._convertNode(link);
        expect(md).toContain("![t](https://cdn.example.com/a.png)");
        expect(md.includes("![\\[")).toBe(false);
    });

    it("buildPostCallout: 用户名取 name(不回退为 username), cooked 内容进入引用块", () => {
        withDom(element("body", [element("p", [textNode("正文")])]), () => {
            const md = HTMLToMarkdown.buildPostCallout({ name: "张三", username: "zhangsan", post_number: 7, cooked: "<p>正文</p>" }, 1, false);
            expect(md).toContain("张三");
            expect(md).toContain("(@zhangsan)");
            expect(md).toContain("> 正文");
        });
    });
});

// ===== §8 DOMToNotion: 媒体/容器/列表/段落归一 =====
describe("DOMToNotion 媒体分派与列表/容器边界", () => {
    const img = (props) => element("img", [], { getAttribute: attrs(props) });
    const first = (body, imgMode) => blocksOf(body, imgMode)[0];

    it("附件链接(a.attachment): 文件块标记待上传", () => {
        const a = element("a", [textNode("n.pdf")], {
            classList: classes("attachment"),
            getAttribute: attrs({ href: "https://cdn.example.com/n.pdf" }),
        });
        const b = first(element("body", [a]), "upload");
        expect(b.type).toBe("file");
        expect(b._needsUpload).toBe(true);
    });

    it("视频元素: 受支持扩展名优先于宿主白名单(不因宿主可嵌入而降级为 embed)", () => {
        const v = element("video", [], { getAttribute: attrs({ src: "https://www.youtube.com/x.mp4" }) });
        expect(first(element("body", [v])).type).toBe("video");
    });

    it("视频元素: 受支持扩展名与非白名单宿主两分支均标记待上传", () => {
        for (const src of ["https://cdn.example.com/v.mp4", "https://cdn.example.com/v.bin"]) {
            const b = first(element("body", [element("video", [], { getAttribute: attrs({ src }) })]), "upload");
            expect(b.type).toBe("video");
            expect(b._needsUpload).toBe(true);
        }
    });

    it("音频元素: 正常地址标记待上传; 地址被拒且 imgMode=skip 时不产块", () => {
        const ok = first(element("body", [element("audio", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.mp3" }) })]), "upload");
        expect(ok.type).toBe("audio");
        expect(ok._needsUpload).toBe(true);
        const rejected = element("body", [element("audio", [], { getAttribute: attrs({ src: "http://127.0.0.1/a.mp3" }) })]);
        expect(blocksOf(rejected, "skip")).toEqual([]);
        expect(blocksOf(rejected, "upload")[0].type).toBe("paragraph");
    });

    it("_isAllowedEmbedHost: 解析失败的地址不视为白名单宿主", () => {
        expect(DOMToNotion._isAllowedEmbedHost("not a url")).toBe(false);
        expect(DOMToNotion._isAllowedEmbedHost("https://www.youtube.com/embed/x")).toBe(true);
    });

    it("_cookIframe: 地址被拒时返回 true(调用方终止子树遍历)并留可见标记", () => {
        const blocks = [];
        const handled = DOMToNotion._cookIframe(element("iframe", [], { getAttribute: attrs({ src: "http://127.0.0.1/x" }) }), blocks, "upload");
        expect(handled).toBe(true);
        expect(blocks[0].paragraph.rich_text[0].text.content).toContain("已拒");
    });

    it("_consumeInlineMedia: 默认内联口径(blockImages=false) 不产出块级回退", () => {
        const blocks = [];
        DOMToNotion._consumeInlineMedia(element("div", [img({ src: "http://127.0.0.1/a.png" })]), blocks, "upload");
        expect(blocks).toEqual([]);
    });

    it("嵌套列表: 内层列表不与父项文本粘连, 内层媒体不重复落块", () => {
        const txt = (b) => {
            const payload = b.paragraph || b.bulleted_list_item || b.numbered_list_item;
            return payload.rich_text.map((r) => r.text.content).join("");
        };
        const nested = element("ul", [element("li", [textNode("a"), element("ul", [element("li", [textNode("b")])])])]);
        const items = blocksOf(element("body", [nested]));
        expect(items.map((b) => b.type)).toEqual(["bulleted_list_item", "bulleted_list_item"]);
        expect(txt(items[0])).toBe("a");
        expect(txt(items[1])).toBe("b");
        const withImg = element("ul", [element("li", [textNode("x"), element("ul", [
            element("li", [img({ src: "https://cdn.example.com/a.png" })]),
        ])])]);
        expect(blocksOf(element("body", [withImg])).filter((b) => b.type === "image").length).toBe(1);
    });

    it("混合列宽表格: 恰为上限的行不被截断(只有超限行才截断)", () => {
        const cellRow = (n) => element("tr", Array.from({ length: n }, (_, i) => element("td", [textNode(String(i))])));
        const t = element("table", [element("tbody", [cellRow(101), cellRow(100)])]);
        const table = blocksOf(element("body", [t]))[0];
        expect(table.type).toBe("table");
        const rows = table.table.children;
        expect(rows.length).toBe(2);
        expect(rows[0].table_row.cells.length).toBe(100);
        expect(rows[1].table_row.cells.length).toBe(100);
        expect(rows[1].table_row.cells[99][0].text.content).toBe("99");
    });

    it("emoji 图: 未收录名称回退 alt, 两者皆无时以 :名称: 承载文本", () => {
        const src = "https://cdn.example.com/images/emoji/win10/zzz999.png";
        const named = blocksOf(element("body", [img({ src, alt: "🎉" })]))[0];
        expect(named.paragraph.rich_text[0].text.content).toBe("🎉");
        const fallback = blocksOf(element("body", [img({ src, alt: "" })]))[0];
        expect(fallback.paragraph.rich_text[0].text.content).toBe(":zzz999:");
    });

    it("块级图片: 地址被拒 + imgMode=skip 时不留下可见标记", () => {
        expect(blocksOf(element("body", [img({ src: "http://127.0.0.1/a.png" })]), "skip")).toEqual([]);
        expect(blocksOf(element("body", [img({ src: "http://127.0.0.1/a.png" })]), "upload")[0].paragraph.rich_text[0].text.content).toContain("已拒");
    });

    it("灯箱容器内的有效图片(带 alt)落块级图片, 不并入相邻文本", () => {
        const box = element("div", [img({ src: "https://cdn.example.com/a.png", alt: "图注" })], { classList: classes("lightbox-wrapper") });
        const blocks = blocksOf(element("body", [box]));
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("image");
    });

    it("灯箱容器内地址被拒且有 alt 的图片按文本载体并入同一段落", () => {
        const box = element("div", [
            textNode("前 "),
            img({ src: "http://127.0.0.1/a.png", alt: "配图" }),
        ], { classList: classes("lightbox-wrapper") });
        const blocks = blocksOf(element("body", [box]));
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("paragraph");
        expect(blocks[0].paragraph.rich_text.map((r) => r.text.content).join("")).toContain("配图");
    });

    it("附件判据限于 a.attachment: 同位类名的 span 走普通段落", () => {
        const span = element("span", [textNode("n.pdf")], {
            classList: classes("attachment"),
            getAttribute: attrs({ href: "https://cdn.example.com/n.pdf" }),
        });
        const blocks = blocksOf(element("body", [element("div", [span])]));
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("paragraph");
    });

    it(".md-table 容器内非表格内容只产出一次(不重复遍历)", () => {
        const box = element("div", [element("p", [textNode("a")])], { classList: classes("md-table") });
        const blocks = blocksOf(element("body", [box]));
        expect(blocks.length).toBe(1);
        expect(blocks[0].paragraph.rich_text[0].text.content).toBe("a");
    });

    it("serializeRichText: 相邻块级子节点间恰一个换行分隔", () => {
        const parts = DOMToNotion.serializeRichText(element("div", [
            element("p", [textNode("a")]), element("p", [textNode("b")]), element("p", [textNode("c")]),
        ]));
        expect(parts.map((p) => p.text.content).join("")).toBe("a\nb\nc");
    });

    it("serializeRichText: 嵌套链接不覆盖内层链接目标", () => {
        const inner = element("a", [textNode("x")], { getAttribute: attrs({ href: "https://inner.example/2" }) });
        const outer = element("a", [inner], { getAttribute: attrs({ href: "https://outer.example/1" }) });
        const parts = DOMToNotion.serializeRichText(element("div", [outer]));
        expect(parts[0].text.content).toBe("x");
        expect(parts[0].text.link.url).toBe("https://inner.example/2");
    });

    it("serializeRichText(skipNestedLists): 跳过嵌套列表仍保留块边界换行", () => {
        const li = element("li", [element("span", [textNode("a")]), element("ul", [element("li", [textNode("b")])]), element("span", [textNode("c")])]);
        const parts = DOMToNotion.serializeRichText(li, { skipNestedLists: true });
        expect(parts.map((p) => p.text.content).join("")).toBe("a\nc");
    });

    it("段落归一化: 非 code 注解的连续空格折叠为单空格", () => {
        const blocks = blocksOf(element("body", [element("div", [textNode("a  b")])]));
        expect(blocks[0].paragraph.rich_text[0].text.content).toBe("a b");
    });

    it("未匹配容器内的块级子节点触发透明下钻(不拍平为单段落)", () => {
        const blocks = blocksOf(element("body", [element("div", [element("div", [element("hr")])])]));
        expect(blocks.length).toBeGreaterThan(0);
    });
});

// ===== §9 差分等价检查器暴露的反例锁定(这 4 条是语料上唯一可观测的残留变异) =====
describe("容器内联/块级混合与嵌套列表的结构边界", () => {
    const contents = (b) => {
        const payload = b.paragraph || b.bulleted_list_item || b.numbered_list_item;
        return payload.rich_text.map((r) => r.text.content).join("");
    };

    it("内联容器(<span>)内含块级子节点(<hr>)时按块级下钻(不拍平成单段落)", () => {
        const blocks = blocksOf(element("body", [element("span", [textNode("a"), element("hr"), textNode("b")])]));
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "divider", "paragraph"]);
        expect(contents(blocks[0])).toBe("a");
        expect(contents(blocks[2])).toBe("b");
    });

    it("内联容器(<a>)内含媒体(<img>)时按块级下钻(媒体不并入链接文本)", () => {
        const link = element("a", [element("img", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.png", alt: "t" }) })], {
            getAttribute: attrs({ href: "https://a.example/1" }),
            querySelector: () => null,
        });
        const blocks = blocksOf(element("body", [element("div", [link])]));
        expect(blocks.length).toBe(1);
        expect(blocks[0].type).toBe("image");
        expect(blocks[0].image.external.url).toBe("https://cdn.example.com/a.png");
    });

    it("嵌套列表的父项 rich_text 不含内层项文本, 但内层媒体作为独立块产出", () => {
        const nested = element("ul", [element("li", [textNode("x"), element("ul", [element("li", [
            element("img", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.png" }) }),
        ])])])]);
        const blocks = blocksOf(element("body", [nested]));
        expect(blocks.map((b) => b.type)).toEqual(["bulleted_list_item", "image"]);
        expect(contents(blocks[0])).toBe("x");
    });

    it("列表项内的块级子节点以换行分隔并保留续行内容", () => {
        const li = element("ol", [element("li", [textNode("x"), element("p", [textNode("  y")])])]);
        const blocks = blocksOf(element("body", [li]));
        expect(blocks.length).toBe(1);
        expect(blocks[0].numbered_list_item.rich_text.map((r) => r.text.content).join("")).toBe("x\n  y");
    });
});

