#!/usr/bin/env node
/**
 * 变异锁等效性校验 —— 对 `verify-mutation` 报出的 SURVIVED 切口做**差分等价检查**:
 * 在固定输入语料上比较「原始实现」与「变异实现」的全部可观测输出(cookedToBlocks 三模式 /
 * Markdown 出口 / 公开判据), 输出逐字节一致 ⇒ 该变异对公开出口面不可观测(等效变异, 可退役);
 * 输出不一致 ⇒ **可观测变异**(必须补测试杀死, 不得以"等效"名义退役)。
 *
 * 用法:
 *   node scripts/verify-mutation-equivalence.js <mutation-log>        # 逐条判定(有 DIFF 则 exit 1)
 *   node scripts/verify-mutation-equivalence.js --hash                # 打印语料输出哈希(内部使用)
 *
 * 语料固定在本文件内(与测试同款 DOM 桩): 出口面判据、媒体分派、列表/表格/引用/灯箱容器、
 * 转义与截断边界。语料变更会使旧哈希失效 —— 重新运行即得到新基线。
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const body = { ref: null, byHtml: null };

function installStubs() {
    globalThis.Node = Object.assign(function Node() {}, { TEXT_NODE: 3, ELEMENT_NODE: 1, COMMENT_NODE: 8 });
    globalThis.DOMParser = function () {
        return { parseFromString: (html) => {
            if (body.byHtml && body.byHtml.has(html)) return { body: body.byHtml.get(html) };
            if (body.ref) return { body: body.ref };
            if (!html) return { body: { childNodes: [] } };
            const text = String(html).replace(/<[^>]*>/g, "").trim();
            return { body: element("body", text ? [element("p", [textNode(text)])] : []) };
        } };
    };
    globalThis.document = { addEventListener: () => {}, createElement: () => ({ style: {} }) };
}

const textNode = (v) => ({ nodeType: 3, nodeValue: v, textContent: v });
const attrs = (map) => (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null);
const classes = (...names) => ({ contains: (n) => names.includes(n) });
const element = (tag, children = [], props = {}) => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: children,
    children,
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: classes(),
    ...props,
});
const img = (props) => element("img", [], { getAttribute: attrs(props) });
const link = (children, href, props = {}) => element("a", children, { getAttribute: attrs({ href }), ...props });
const wrap = (...nodes) => element("body", nodes);

const CASES = [
    // 文本 / 空白 / 归一化
    () => wrap(element("div", [textNode("a  b")])),
    () => wrap(element("div", [textNode("a"), element("br"), element("br"), textNode("b")])),
    () => wrap(element("div", [textNode("a "), element("strong", [textNode("b ")]), textNode(" c")])),
    () => wrap(element("div", [element("code", [textNode("  x  ")])])),
    () => wrap(element("div", [element("code", [textNode("arr[0]")]), textNode(" y")])),
    () => wrap(element("span", [textNode("a"), element("hr"), textNode("b")])),
    () => wrap(element("div", [element("div", [textNode("b")]), textNode("c")])),
    () => wrap(element("div", [element("div", [element("hr")])])),
    () => wrap(element("div", [element("p", [textNode("a")]), element("p", [textNode("b")])])),
    () => wrap(element("div", [element("p", [textNode("a")])])),
    // 链接
    () => wrap(element("div", [link([textNode("x")], "https://a.example/1")])),
    () => wrap(element("div", [link([link([textNode("x")], "https://inner.example/2")], "https://outer.example/1")])),
    () => wrap(element("div", [link([img({ src: "https://cdn.example.com/a.png", alt: "t" })], "https://a.example/1", { querySelector: () => null })])),
    () => wrap(element("div", [link([textNode("n.pdf")], "https://cdn.example.com/n.pdf", { classList: classes("attachment") })])),
    () => wrap(element("div", [element("span", [textNode("n.pdf")], { classList: classes("attachment"), getAttribute: attrs({ href: "https://cdn.example.com/n.pdf" }) })])),
    // 图片 / 灯箱 / md-table
    () => wrap(element("div", [img({ src: "https://cdn.example.com/a.png" })])),
    () => wrap(element("div", [img({ src: "http://127.0.0.1/a.png" })])),
    () => wrap(element("div", [img({ src: "http://127.0.0.1/a.png", alt: "配图" })])),
    () => wrap(element("div", [img({ src: "https://cdn.example.com/images/emoji/win10/zzz999.png", alt: "" })])),
    () => wrap(element("div", [img({ src: "https://cdn.example.com/images/emoji/win10/zzz999.png", alt: "🎉" })])),
    () => wrap(element("div", [textNode("前 "), img({ src: "http://127.0.0.1/a.png", alt: "配图" }), textNode(" 后")])),
    () => wrap(element("div", [img({ src: "https://cdn.example.com/a.png", alt: "图注" })], { classList: classes("lightbox-wrapper") })),
    () => wrap(element("div", [textNode("前 "), img({ src: "http://127.0.0.1/a.png", alt: "配图" })], { classList: classes("lightbox-wrapper") })),
    () => wrap(element("div", [img({ src: "https://cdn.example.com/a.png", alt: "图注" })], { classList: classes("image-wrapper") })),
    () => wrap(element("div", [element("table", [element("tbody", [element("tr", [element("td", [textNode("a")])])])])], { classList: classes("md-table") })),
    () => wrap(element("div", [element("p", [textNode("a")])], { classList: classes("md-table") })),
    // 裸 <img>(直属 body → 块级 _cookBlockImage 分支)
    () => wrap(img({ src: "https://cdn.example.com/a.png" })),
    () => wrap(img({ src: "http://127.0.0.1/a.png" })),
    () => wrap(img({ src: "http://127.0.0.1/a.png", alt: "配图" })),
    () => wrap(img({ src: "https://cdn.example.com/images/emoji/win10/zzz999.png", alt: "🎉" })),
    () => wrap(img({ src: "https://cdn.example.com/images/emoji/win10/zzz999.png", alt: "" })),
    () => wrap(img({ src: "https://cdn.example.com/images/emoji/win10/1f600.png", alt: "" })),
    // 媒体
    () => wrap(element("video", [], { getAttribute: attrs({ src: "https://cdn.example.com/v.mp4" }) })),
    () => wrap(element("video", [], { getAttribute: attrs({ src: "https://www.youtube.com/x.mp4" }) })),
    () => wrap(element("video", [], { getAttribute: attrs({ src: "https://cdn.example.com/v.bin" }) })),
    () => wrap(element("audio", [], { getAttribute: attrs({ src: "https://cdn.example.com/a.mp3" }) })),
    () => wrap(element("audio", [], { getAttribute: attrs({ src: "http://127.0.0.1/a.mp3" }) })),
    () => wrap(element("iframe", [], { getAttribute: attrs({ src: "https://www.youtube.com/embed/x" }) })),
    () => wrap(element("iframe", [], { getAttribute: attrs({ src: "http://127.0.0.1/x" }) })),
    () => wrap(element("iframe", [], { getAttribute: attrs({ src: "not a url" }) })),
    // 列表
    () => wrap(element("ul", [element("li", [textNode("a"), element("ul", [element("li", [textNode("b")])])])])),
    () => wrap(element("ul", [element("li", [textNode("x"), element("ul", [element("li", [img({ src: "https://cdn.example.com/a.png" })])])])])),
    () => wrap(element("ol", [element("li", [textNode("x"), element("p", [textNode("  y")])])])),
    () => wrap(element("ul", [textNode(" a "), element("li", [textNode("b")])])),
    () => wrap(element("li", [element("span", [textNode("a")]), element("ul", [element("li", [textNode("b")])]), element("span", [textNode("c")])])),
    // 引用 / 标题 / 表格
    () => wrap(element("aside", [element("blockquote", [textNode("q")]), textNode("署名")], { classList: classes("quote") })),
    () => wrap(element("blockquote", [element("p", [textNode("a")]), element("p", [textNode("b")]), element("p", [textNode("c")])])),
    () => wrap(element("blockquote", [element("table", [element("tr", [element("td", [textNode("1")]), element("td", [textNode("2")])])])])),
    () => wrap(element("h2", [textNode("t"), link([textNode("l")], "https://a.example/1")])),
    () => wrap(element("table", [element("caption", [textNode("cap")]), element("thead", [element("tr", [element("th", [textNode("h")])])]), element("tbody", [element("tr", [element("td", [textNode("c")])])])])),
    () => {
        const row = (n) => element("tr", Array.from({ length: n }, (_, i) => element("td", [textNode(String(i))])));
        return wrap(element("table", [element("tbody", [row(101), row(100), row(2)])]));
    },
    () => {
        const many = Array.from({ length: 120 }, () => element("tr", [element("td", [textNode("x")])]));
        many.push(element("tr", [element("td", [textNode("x")]), element("td", [textNode("y")]), element("td", [textNode("z")])]));
        return wrap(element("table", [element("tbody", many)]));
    },
    () => wrap(element("table", [element("tr", [element("td", [img({ src: "https://cdn.example.com/a.png" })])])])),
    () => wrap(element("table", [element("tr", [element("td", [element("ul", [element("li", [textNode("a")])])])])])),
    // 长文本 / 截断
    () => wrap(element("div", [textNode("a".repeat(2000))])),
    () => wrap(element("div", [textNode("a".repeat(1999) + "\uD83D\uDE00" + "b".repeat(10))])),
    () => wrap(element("div", [textNode("a".repeat(5000))])),
    () => wrap(element("div", [element("p", [textNode("a".repeat(2100))])])),
    // 跳过元素 / 注释 / 空节点
    () => wrap(element("div", [element("script", [textNode("var t=1")]), textNode("x")])),
    () => wrap(element("div", [element("noscript", [img({ src: "https://cdn.example.com/a.png" })])])),
    () => wrap(element("div", [textNode("")])),
    () => wrap(element("div", [])),
    () => wrap(element("div", [element("span", [textNode("a")])])),
    () => wrap(element("div", [{ nodeType: 8, nodeValue: "c" }, textNode("a")])),
    // 内联片段数上限
    () => wrap(element("div", Array.from({ length: 130 }, (_, i) => element("b", [textNode(String(i))])))),
];

function corpus() {
    const { DOMToNotion, HTMLToMarkdown, ObsidianAPI } = require(path.join(ROOT, "src/api"));
    const { DomSpec } = require(path.join(ROOT, "src/api/DomSpec.js"));
    const out = [];
    for (const build of CASES) {
        for (const mode of ["upload", "skip", "external"]) {
            body.ref = build();
            try {
                out.push(JSON.stringify(DOMToNotion.cookedToBlocks("<div>x</div>", mode)));
            } catch (error) {
                out.push("ERR:" + error.message);
            }
        }
        body.ref = build();
        try {
            out.push(JSON.stringify(HTMLToMarkdown.convert("<div>x</div>")));
            out.push(JSON.stringify(HTMLToMarkdown._convertNode(body.ref.childNodes[0] || element("div"))));
        } catch (error) {
            out.push("ERR:" + error.message);
        }
    }
    body.ref = element("body", [element("p", [textNode("正文")])]);
    const probes = [
        () => DomSpec.isBlockNode(element("span", [], { classList: classes("lightbox-wrapper") })),
        () => DomSpec.isBlockNode(element("span", [], { classList: classes("quote") })),
        () => DomSpec.mediaKind(element("span", [], { classList: classes("attachment") })),
        () => DomSpec.mediaSrc(element("img", [], { getAttribute: attrs({ src: "http://127.0.0.1/a.png" }) })),
        () => DomSpec.textWithBreaks(element("div", [element("br"), textNode("a")])),
        () => DomSpec.tagOf({ nodeType: 3, nodeValue: "x" }),
        () => DOMToNotion._isAllowedEmbedHost("not a url"),
        () => DOMToNotion._isAllowedEmbedHost("https://vimeo.com/1"),
        () => DOMToNotion._safeExternalUrl("http://127.0.0.1/x") || "rejected",
        () => DOMToNotion.splitLongText("a".repeat(2000)).length,
        () => DOMToNotion.splitLongText("a".repeat(2001)).length,
        () => JSON.stringify(DOMToNotion.serializeRichText(element("li", [element("span", [textNode("a")]), element("ul", [element("li", [textNode("b")])]), element("span", [textNode("c")])]), { skipNestedLists: true })),
        () => JSON.stringify(DOMToNotion.serializeRichText(element("div", [element("p", [textNode("a")]), element("p", [textNode("b")])]))),
        () => ObsidianAPI._safeVaultPath("a/../b.md"),
        () => {
            body.byHtml = new Map([["<p>x</p>", element("body", [element("p", [textNode("x")])])]]);
            const md = HTMLToMarkdown.buildPostCallout({ name: "a", username: "b", cooked: "<p>x</p>" }, 0, true);
            body.byHtml = null;
            return md.slice(0, 40);
        },
    ];
    for (const fn of probes) {
        try { out.push(String(fn())); } catch (error) { out.push("ERR:" + error.message); }
    }
    return out.join("\n");
}

if (process.argv.includes("--hash")) {
    installStubs();
    process.stdout.write(crypto.createHash("sha256").update(corpus()).digest("hex"));
    process.exit(0);
}

const OP_TO = {
    "and-or": "||", "or-and": "&&", "bool-flip": "false", "bool-flip-r": "true",
    "lt-flip": "<", "gt-flip": ">", "eq-flip": "===", "eq-flip-r": "!==",
};
const OP_FROM = {
    "and-or": "&&", "or-and": "||", "bool-flip": "true", "bool-flip-r": "false",
    "lt-flip": "<=", "gt-flip": ">=", "eq-flip": "!==", "eq-flip-r": "===",
};

function corpusHash() {
    const r = spawnSync(process.execPath, [__filename, "--hash"], { cwd: ROOT, encoding: "utf8" });
    return (r.stdout || "").trim();
}

function main() {
    const logPath = process.argv[2];
    if (!logPath || !fs.existsSync(logPath)) {
        console.error("用法: node scripts/verify-mutation-equivalence.js <mutation-log>");
        process.exit(2);
    }
    const log = fs.readFileSync(logPath, "utf8");
    const sites = [];
    for (const line of log.split(/\r?\n/)) {
        const m = /^\[\d+\/\d+\] (\S+):(\d+):(\d+) (\S+) \(.*?\) => SURVIVED$/.exec(line);
        if (m) sites.push({ file: m[1], line: Number(m[2]), op: m[4] });
    }
    if (sites.length === 0) {
        console.log("日志中无 SURVIVED 切口 —— 无需等效性退役。");
        process.exit(0);
    }
    const base = corpusHash();
    console.log("变异锁等效性校验 — 语料输出基线 " + base.slice(0, 16) + "…");
    console.log("待判定切口: " + sites.length + " 条\n");
    let observable = 0;
    const rows = [];
    for (const site of sites) {
        const target = path.join(ROOT, site.file);
        const original = fs.readFileSync(target, "utf8");
        const eol = original.includes("\r\n") ? "\r\n" : "\n";
        const lines = original.split(/\r?\n/);
        const idx = site.line - 1;
        const from = OP_FROM[site.op];
        const to = OP_TO[site.op];
        const col = lines[idx].indexOf(from);
        if (col === -1) {
            rows.push([site, "NO_SITE", ""]);
            fs.writeFileSync(target, original, "utf8");
            continue;
        }
        lines[idx] = lines[idx].slice(0, col) + to + lines[idx].slice(col + from.length);
        fs.writeFileSync(target, lines.join(eol), "utf8");
        let verdict = "OBSERVABLE";
        try {
            verdict = corpusHash() === base ? "EQUIVALENT" : "OBSERVABLE";
        } catch (error) {
            verdict = "THROW";
        } finally {
            fs.writeFileSync(target, original, "utf8");
        }
        if (verdict !== "EQUIVALENT") observable += 1;
        rows.push([site, verdict, lines[idx].trim()]);
        console.log(verdict.padEnd(11) + " " + site.file.replace("src/api/", "") + ":" + site.line + " " + from + " -> " + to);
    }
    console.log("");
    console.log("等效变异(可退役): " + (sites.length - observable) + " | 可观测变异(须补测试): " + observable);
    if (observable > 0) {
        console.log("\n可观测切口明细(必须杀死, 不得以等效名义退役):");
        for (const [site, verdict, code] of rows) {
            if (verdict === "EQUIVALENT") continue;
            console.log("  " + verdict + " " + site.file + ":" + site.line + " (" + site.op + ") " + (code || "").slice(0, 100));
        }
        process.exit(1);
    }
}

main();
