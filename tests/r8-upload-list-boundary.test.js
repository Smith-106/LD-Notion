"use strict";

// 收敛轮 wave5 分片补齐(c05b2-glm)回归:
// ① uploadFileToNotion 下载→上传是 SSRF/内网外带边界, 须自查 URL(不依赖调用方过滤)
// ② HTMLToMarkdown 嵌套列表须显式缩进, 不能依赖源 HTML 空白节点(否则 "- a- b" 粘连)
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

const { NotionAPI, HTMLToMarkdown } = require("../src/api");

describe("c05b2-glm #1: uploadFileToNotion 拒绝内网/非 http(s) URL", () => {
    const origXhr = global.GM_xmlhttpRequest;

    beforeAll(() => {
        // 任何真实网络请求都不应发生; 若发生则立刻以"下载失败"暴露
        global.GM_xmlhttpRequest = (opts) => { opts.onerror?.({ error: "should-not-request" }); };
    });
    afterAll(() => { global.GM_xmlhttpRequest = origXhr; });

    it.each([
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:8756/x.png",
        "http://10.0.0.5/a.png",
        "http://[::1]/a.png",
        "file:///C:/secret.txt",
        "data:image/png;base64,AAAA",
        "",
    ])("拒绝 %s", async (url) => {
        await expect(NotionAPI.uploadFileToNotion(url, "secret_ok")).rejects.toThrow(/不支持的文件 URL/);
    });

    it("公网 http(s) 通过边界自查(后续失败不是 URL 拒绝)", async () => {
        await expect(NotionAPI.uploadFileToNotion("https://cdn.example.com/a.png", "secret_ok"))
            .rejects.toThrow(/下载失败/);
    });
});

describe("c05b2-glm #3: 嵌套列表显式缩进", () => {
    const origNode = globalThis.Node;
    beforeAll(() => { globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 }; });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: (sel) => (sel === ":scope > li" ? childNodes.filter((c) => c.tagName === "LI") : []),
    });

    it("嵌套 ul 缩进 2 空格, 不与父项文本粘连", () => {
        const inner = el("ul", [el("li", [txt("b")])]);
        expect(HTMLToMarkdown._convertNode(el("li", [txt("a"), inner]))).toBe("- a\n  - b\n");
    });

    it("无嵌套时输出不变", () => {
        expect(HTMLToMarkdown._convertNode(el("li", [txt("a")]))).toBe("- a\n");
    });

    it("多层嵌套逐层缩进", () => {
        const inner2 = el("ul", [el("li", [txt("c")])]);
        const inner1 = el("ul", [el("li", [txt("b"), inner2])]);
        expect(HTMLToMarkdown._convertNode(el("li", [txt("a"), inner1]))).toBe("- a\n  - b\n    - c\n");
    });

    it("有序列表内嵌无序列表不出现 1. - 双前缀", () => {
        const ol = el("ol", [el("li", [txt("a"), el("ul", [el("li", [txt("b")])])])]);
        // wave18 共识(w3 qwen): 续行缩进按父项内容列("1. " → 3), 固定 2 空格会让嵌套列表
        // 在 CommonMark 中脱离父项(渲染为顶层列表)
        expect(HTMLToMarkdown._convertNode(ol)).toBe("1. a\n   - b\n\n");
    });
});

describe("wave6 共识(qwen): 重定向边界 + onebox/inline code 转义", () => {
    it("下载响应 finalUrl 指向内网时拒绝(重定向型 SSRF)", async () => {
        const origXhr = global.GM_xmlhttpRequest;
        const { NotionAPI: API2 } = require("../src/api");
        API2.configureTransport({
            request: async () => ({ status: 200, responseText: JSON.stringify({ id: "x", upload_url: "https://api.notion.com/v1/file_uploads/x/send", object: "file_upload" }), responseHeaders: "" }),
        });
        global.GM_xmlhttpRequest = (opts) => {
            if (opts.method === "GET") {
                opts.onload({
                    status: 200,
                    response: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
                    finalUrl: "http://169.254.169.254/latest/meta-data/",
                });
                return;
            }
            opts.onload({ status: 200, responseText: "{}" });
        };
        try {
            await expect(API2.uploadFileToNotion("https://cdn.example.com/ok.png", "secret_ok"))
                .rejects.toThrow(/不支持的文件 URL/);
        } finally {
            global.GM_xmlhttpRequest = origXhr;
            API2.resetTransport();
        }
    });

    it("onebox 多行内容逐行引用, 不脱离 callout", () => {
        const origNode = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
        const div = {
            nodeType: 1,
            tagName: "DIV",
            children: [],
            childNodes: [{ nodeType: 3, textContent: "line1\n> escaped" }],
            className: "onebox",
            parentElement: null,
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        const out = HTMLToMarkdown._convertNode(div);
        if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        expect(out).toBe("> [!quote]\n> line1\n> > escaped\n\n");
    });

    it("内联 code 含反引号时用更长围栏闭合", () => {
        const origNode = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
        const make = (text) => ({
            nodeType: 1,
            tagName: "CODE",
            children: [],
            childNodes: [{ nodeType: 3, textContent: text }],
            parentElement: { tagName: "P" },
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
        });
        const a = HTMLToMarkdown._convertNode(make("a`b"));
        const b = HTMLToMarkdown._convertNode(make("`edge"));
        if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode;
        expect(a).toBe("``a`b``");
        expect(b).toBe("`` `edge ``");
    });
});

describe("wave7 共识(qwen): callout 注入净化 + 下载大小护栏", () => {
    it("buildPostCallout username 含换行时折叠(不逃逸 callout 引用)", () => {
        const post = {
            name: "u\nser\n> 注入行",
            username: "evil\nuser",
            post_number: 3,
            created_at: "2025-01-01T00:00:00Z",
            cooked: "<p>正文</p>",
        };
        const origConvert = HTMLToMarkdown.convert;
        HTMLToMarkdown.convert = () => "\n";
        const out0 = (() => { try { return HTMLToMarkdown.buildPostCallout(post, 2, false); } finally { HTMLToMarkdown.convert = origConvert; } })();
        const out = out0;
        expect(out.split("\n")[0]).not.toContain("\nser");
        out.split("\n").forEach((line) => {
            if (!line.startsWith("> ") && line !== "" ) throw new Error("非引用行逃逸: " + line);
        });
        expect(out).toContain("^floor-3");
    });

});

describe("wave8 共识(dsf+glm): uploadImageToNotion 回退路径 finalUrl 校验", () => {
    const ok = (o) => ({ status: 200, responseText: JSON.stringify(o), responseHeaders: "" });
    afterEach(() => { NotionAPI.resetTransport(); });

    it("回退路径重下载 302 到内网时拒绝(重定向型 SSRF)", async () => {
        const origXhr = global.GM_xmlhttpRequest;
        // 主路径 createFileUpload 失败 → 进入回退重下载 → finalUrl 指向内网须拒绝
        NotionAPI.configureTransport({ request: async () => ({ status: 500, responseText: "{}", responseHeaders: "" }) });
        global.GM_xmlhttpRequest = (opts) => opts.onload({
            status: 200,
            response: new Blob(["x"]),
            finalUrl: "http://169.254.169.254/latest/meta-data",
        });
        try {
            const result = await NotionAPI.uploadImageToNotion("https://evil.example.com/a.png", "secret_ok");
            expect(result).toBeNull(); // 回退也失败 → null(不外带内网资源)
        } finally {
            global.GM_xmlhttpRequest = origXhr;
        }
    });

    it("回退路径 finalUrl 为公网时正常上传", async () => {
        const origXhr = global.GM_xmlhttpRequest;
        const { Utils: U2 } = require("../src/utils");
        NotionAPI.configureTransport({
            request: async (opts) => {
                if (opts.endpoint === "/file_uploads" && opts.method === "POST") return ok({ id: "fu8", upload_url: "https://upload.notion.com/u", object: "file_upload" });
                if (opts.endpoint === "/file_uploads/fu8/send") return ok({ object: "file_upload", status: "uploaded" });
                if (opts.endpoint === "/file_uploads/fu8/complete") return ok({ id: "fu8", object: "file_upload" });
                return { status: 500, responseText: "{}", responseHeaders: "" };
            },
        });
        global.GM_xmlhttpRequest = (opts) => opts.onload({ status: 200, response: new Blob(["x"]), finalUrl: "https://cdn.example.com/a.png" });
        // uploadFileContent 依赖 FileReader(node 环境无) → 最小桩: 同步触发 onload
        const origFR = global.FileReader;
        global.FileReader = class {
            readAsArrayBuffer() { this.result = new Uint8Array(0); this.onload(); }
        };
        try {
            const fileId = await NotionAPI.uploadImageToNotion("https://cdn.example.com/a.png", "secret_ok");
            expect(fileId).toBe("fu8");
        } finally {
            global.GM_xmlhttpRequest = origXhr;
            if (origFR === undefined) delete global.FileReader; else global.FileReader = origFR;
        }
    });
});

describe("wave9 共识(glm): callout 孤立 CR 折叠", () => {
    it("username 含孤立 CR 时不再逃逸 callout 引用前缀", () => {
        // node 环境无 DOMParser —— convert 仅作为换行来源桩(与 wave7 测试同款)
        const origConvert = HTMLToMarkdown.convert;
        HTMLToMarkdown.convert = () => "\n";
        const post = {
            username: "u\rser\r> 注入行",
            name: "u ser > 注入行",
            post_number: 3,
            content: "floor-3",
        };
        const callout = HTMLToMarkdown.buildPostCallout(post, 3);
        // CR 是 CommonMark 行结束符但 JS 不按 CR 拆行 —— 直接断言 callout 无残留 CR
        expect(callout.includes("\r")).toBe(false);
        const lines = callout.split("\n");
        for (const line of lines.slice(1)) {
            if (!line.trim()) continue; // 尾随空行不属于逃逸
            expect(line.startsWith(">")).toBe(true);
        }
        expect(callout).toContain("floor-3");
        HTMLToMarkdown.convert = origConvert;
    });
});

describe("wave9 共识(qwen): 日志脱敏(剔除查询串)", () => {
    afterEach(() => { NotionAPI.resetTransport(); });

    // 跑一次 uploadImageToNotion 并返回拼接后的 console.warn 日志
    const runUpload = async (url) => {
        const origXhr = global.GM_xmlhttpRequest;
        const origWarn = console.warn;
        const warns = [];
        NotionAPI.configureTransport({ request: async () => ({ status: 401, responseText: "{}", responseHeaders: "" }) });
        global.GM_xmlhttpRequest = (opts) => opts.onload({ status: 200, response: new Blob(["x"]), finalUrl: "https://cdn.example.com/a.png" });
        console.warn = (...args) => warns.push(args.join(" "));
        try {
            const result = await NotionAPI.uploadImageToNotion(url, "secret_ok");
            expect(result).toBeNull();
            return warns.join("\n");
        } finally {
            console.warn = origWarn;
            global.GM_xmlhttpRequest = origXhr;
        }
    };

    // 两个分支各有独立 warn 文案 —— 必须分别覆盖, 否则未走到的分支脱敏失效不会被发现
    it("类型不支持分支: console.warn 只含 origin+path(无签名参数)", async () => {
        const joined = await runUpload("https://cdn.example.com/a.xyz?token=SECRET&sig=abc");
        expect(joined).toContain("图片类型不支持");
        expect(joined.includes("token=SECRET")).toBe(false);
        expect(joined).toContain("https://cdn.example.com/a.xyz");
    });

    it("上传失败分支: console.warn 只含 origin+path(无签名参数)", async () => {
        const joined = await runUpload("https://cdn.example.com/a.png?token=SECRET&sig=abc");
        expect(joined).toContain("图片上传失败");
        expect(joined.includes("token=SECRET")).toBe(false);
        expect(joined).toContain("https://cdn.example.com/a.png");
    });
});

describe("wave9 共识(qwen): Obsidian 导出 scheme 白名单", () => {
    // Node 必须是可调用的构造器: vitest 的 toContain 内部会做 `x instanceof Node`,
    // 换成普通对象会抛 "Right-hand side of 'instanceof' is not callable"
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, attrs = {}, children = []) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes: children,
        children: children.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: "",
        getAttribute: (k) => (k in attrs ? attrs[k] : null),
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("a href 大写 scheme 仍生成链接(HTTP:// 不降级纯文本)", () => {
        expect(HTMLToMarkdown._convertNode(el("a", { href: "HTTP://example.com/x" }, [txt("链接")])))
            .toBe("[链接](HTTP://example.com/x)");
    });

    it("a href 非 http 协议不生成链接", () => {
        expect(HTMLToMarkdown._convertNode(el("a", { href: "javascript:alert(1)" }, [txt("点击")])))
            .toBe("点击");
    });

    it("img src 为 javascript: 时降级为 alt 文本(不生成图片)", () => {
        expect(HTMLToMarkdown._convertNode(el("img", { src: "javascript:alert(1)", alt: "危险" })))
            .toBe("危险");
    });

    it("img src 指向云元数据时不生成图片", () => {
        const out = HTMLToMarkdown._convertNode(el("img", { src: "http://169.254.169.254/latest/meta-data/", alt: "x" }));
        expect(out).not.toContain("](");
    });

    it("img src 公网 http(s) 正常生成图片", () => {
        expect(HTMLToMarkdown._convertNode(el("img", { src: "https://cdn.example.com/a.png", alt: "图" })))
            .toBe("![图](https://cdn.example.com/a.png)");
    });

    it("iframe src 非公网时输出拒绝标记", () => {
        expect(HTMLToMarkdown._convertNode(el("iframe", { src: "http://127.0.0.1/x" })))
            .toContain("已拒");
        // wave16: 危险 scheme 不得因 mediaSrc 跳过 data:/about: 占位而绕过判别
        // (占位跳过仅适用于可回退到 data-src/source 的媒体, 非将占位当作安全值)
        for (const src of ["javascript:alert(1)", "vbscript:msgbox", "file:///etc/passwd"] ) {
            // wave18 共识(w3 qwen): 无候选地址(占位/危险 scheme)与 Notion 出口同口径静默
            expect(`${src} :: ${HTMLToMarkdown._convertNode(el("iframe", { src }))}`).toBe(`${src} :: `);
        }
    });

    it("iframe src 公网 https 正常输出嵌入链接", () => {
        expect(HTMLToMarkdown._convertNode(el("iframe", { src: "https://player.example.com/e/1" })))
            .toContain("https://player.example.com/e/1");
    });
});

describe("wave10 共识(dsf): Obsidian 嵌套子树只转换一次(不重复展开)", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: "",
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: (sel) => (sel === ":scope > li" ? childNodes.filter((c) => c.tagName === "LI") : []),
    });
    // depth 层 ul/li 互相嵌套的链式结构
    const chain = (depth) => {
        let inner = txt("x");
        for (let i = 0; i < depth; i++) inner = el("ul", [el("li", [inner])]);
        return inner;
    };

    it("深度 14 的嵌套列表转换次数保持线性(旧实现为 2^depth)", () => {
        const real = HTMLToMarkdown._convertNode;
        let calls = 0;
        HTMLToMarkdown._convertNode = (n) => { calls += 1; return real(n); };
        try {
            const out = HTMLToMarkdown._convertNode(chain(14));
            expect(typeof out).toBe("string");
        } finally {
            HTMLToMarkdown._convertNode = real;
        }
        // 线性约 3*depth+1;重复展开时 ≥ 2^14 = 16384
        expect(calls).toBeLessThan(500);
    });
});

describe("wave11 共识(qwen): 表格单元格孤立 CR 折叠", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: "",
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("单元格内孤立 CR 被折叠, 不拆断表格行", () => {
        const table = el("table", [el("tbody", [el("tr", [el("td", [txt("a\rc")])])])]);
        const out = HTMLToMarkdown._convertTable(table);
        expect(out.includes("\r")).toBe(false);
        expect(out).toBe("| a c |\n| --- |");
    });

    it("CRLF 单元格同样折叠为单空格", () => {
        const table = el("table", [el("tbody", [el("tr", [el("td", [txt("a\r\nc")])])])]);
        expect(HTMLToMarkdown._convertTable(table)).toBe("| a c |\n| --- |");
    });
});

describe("wave11 共识(glm): script/style 文本不污染导出正文", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: "",
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("script 文本不出现在导出结果中", () => {
        const body = el("div", [txt("正文"), el("script", [txt("window.x=1;")]), txt("尾")]);
        const out = HTMLToMarkdown._convertNode(body);
        expect(out).not.toContain("window.x=1;");
        expect(out).toContain("正文");
    });

    it("style 文本不出现在导出结果中", () => {
        const body = el("div", [el("style", [txt(".a{color:red}")]), txt("正文")]);
        expect(HTMLToMarkdown._convertNode(body)).not.toContain("color:red");
    });
});

describe("wave12 共识(dsf): 标题内换行被折叠", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: "",
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("标题内 <br> 折叠为空格(标题不被拆到下一行)", () => {
        const h = el("h2", [txt("a"), el("br", []), txt("b")]);
        expect(HTMLToMarkdown._convertNode(h)).toBe("## a b\n\n");
    });

    it("标题文本自带换行同样折叠", () => {
        expect(HTMLToMarkdown._convertNode(el("h3", [txt("x\ny")]))).toBe("### x y\n\n");
    });

    it("各级标题层级符号正确", () => {
        const out = ["h1", "h4", "h6"].map((t) => HTMLToMarkdown._convertNode(el(t, [txt("t")])));
        expect(out).toEqual(["# t\n\n", "#### t\n\n", "###### t\n\n"]);
    });
});

describe("wave12 共识(dsf): 标题内回车符折叠(补 R12 变异覆盖)", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: "",
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("标题文本含孤立 CR 同样折叠", () => {
        expect(HTMLToMarkdown._convertNode(el("h2", [txt("a\rb")]))).toBe("## a b\n\n");
    });

    it("标题文本含 CRLF 折叠为单空格", () => {
        expect(HTMLToMarkdown._convertNode(el("h2", [txt("a\r\nb")]))).toBe("## a b\n\n");
    });
});

describe("wave12 共识(glm): li 内代码围栏空白不被折叠篡改", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes, attrs = {}) => {
        const node = {
            nodeType: 1,
            tagName: tag.toUpperCase(),
            childNodes,
            children: childNodes.filter((n) => n.nodeType === 1),
            parentElement: null,
            className: attrs.className || "",
            getAttribute: (n) => attrs[n] || null,
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        childNodes.forEach((c) => { if (c.nodeType === 1) c.parentElement = node; });
        return node;
    };

    const codeNode = (code) => {
        const codeEl = el("code", [txt(code)]);
        codeEl.textContent = code;
        const pre = el("pre", [codeEl]);
        // wave14: pre 分支改读整块 textContent(真实 DOM 下父元素聚合子文本)
        pre.textContent = code;
        pre.querySelector = (sel) => (sel === "code" ? codeEl : null);
        return pre;
    };

    it("围栏内容自带缩进时不丢列表续行缩进", () => {
        const li = el("li", [codeNode("  x")]);
        expect(HTMLToMarkdown._convertNode(li)).toBe("- ```\n    x\n  ```\n");
    });

    it("pre 内 code 之外的文本不丢失", () => {
        const codeEl = el("code", [txt("bar")]);
        codeEl.textContent = "bar";
        const pre = el("pre", [txt("foo"), codeEl]);
        pre.textContent = "foobar";
        pre.querySelector = (sel) => (sel === "code" ? codeEl : null);
        expect(HTMLToMarkdown._convertNode(pre)).toContain("foobar");
    });

    it("围栏内空行与行尾空白原样保留", () => {
        const li = el("li", [codeNode("line1\n\nline2  ")]);
        expect(HTMLToMarkdown._convertNode(li)).toBe("- ```\n  line1\n  \n  line2  \n  ```\n");
    });

    it("代码围栏前的文本仍按原口径折叠", () => {
        const li = el("li", [txt("说明文字   "), codeNode("code")]);
        expect(HTMLToMarkdown._convertNode(li)).toBe("- 说明文字\n  ```\n  code\n  ```\n");
    });
});

describe("wave13 共识(dsf): audio 与 video 同口径回退 <source src>", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const el = (tag, attrs = {}, kids = []) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes: kids,
        children: kids.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: attrs.className || "",
        getAttribute: (n) => attrs[n] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("audio 仅有 <source src> 时不再误判\"已拒\"", () => {
        const audio = el("audio", {});
        audio.querySelector = (sel) => (sel === "source" ? el("source", { src: "https://cdn.example.com/a.mp3" }) : null);
        expect(HTMLToMarkdown._convertNode(audio)).toBe("[音频](https://cdn.example.com/a.mp3)\n\n");
    });

    it("audio 自身 src 优先于 <source src>", () => {
        const audio = el("audio", { src: "https://cdn.example.com/self.mp3" });
        audio.querySelector = () => el("source", { src: "https://cdn.example.com/child.mp3" });
        expect(HTMLToMarkdown._convertNode(audio)).toBe("[音频](https://cdn.example.com/self.mp3)\n\n");
    });

    it("audio 完全无地址时不产出链接也不造「已拒」噪声(与 Notion 出口同口径)", () => {
        expect(HTMLToMarkdown._convertNode(el("audio", {}))).toBe("");
        // 有候选地址但被判拒 → 可见标记(不静默丢弃)
        expect(HTMLToMarkdown._convertNode(el("audio", { src: "http://127.0.0.1/x.mp3" }))).toContain("已拒");
    });
});

describe("wave12 系统扫描: 单行上下文内联文本折叠换行(链接标签/图片 alt)", () => {
    const origNode = globalThis.Node;
    beforeAll(() => {
        const NodeStub = function NodeStub() {};
        NodeStub.TEXT_NODE = 3;
        NodeStub.ELEMENT_NODE = 1;
        globalThis.Node = NodeStub;
    });
    afterAll(() => { if (origNode === undefined) delete globalThis.Node; else globalThis.Node = origNode; });

    const { Utils } = require("../src/utils/index.js");
    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes, attrs = {}) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        className: attrs.className || "",
        getAttribute: (n) => attrs[n] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("Utils.mdText 折叠换行(列表项/链接标签为单行上下文)", () => {
        expect(Utils.mdText("标题\n第二行")).toBe("标题 第二行");
        expect(Utils.mdText("a\r\nb")).toBe("a b");
        // wave17 共识(glm): 方括号由删除改为反斜杠转义(内容无损, 且仍阻止 ]( 逃逸链接语法)
        expect(Utils.mdText("仍有]括号[被剥离")).toBe("仍有\\]括号\\[被剥离");
    });

    it("链接标签内含 <br> 不再拆断链接结构", () => {
        const a = el("a", [txt("a"), el("br", []), txt("b")], { href: "https://example.com/x" });
        expect(HTMLToMarkdown._convertNode(a)).toBe("[a b](https://example.com/x)");
    });

    it("obsidian _mdText 与 Utils.mdText 同源", () => {
        expect(HTMLToMarkdown._mdText("x\ny")).toBe(Utils.mdText("x\ny"));
    });
});

describe("wave14 共识(dsf): ol 非 li 直属内容不被丢弃", () => {
    const withNode = (fn) => {
        const orig = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.Node; else globalThis.Node = orig;
        }
    };

    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => ({
        nodeType: 1,
        tagName: tag.toUpperCase(),
        childNodes,
        children: childNodes.filter((n) => n.nodeType === 1),
        parentElement: null,
        getAttribute: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });

    it("ol 内裸文本原样保留且不影响序号", () => {
        const md = withNode(() => HTMLToMarkdown._convertNode(
            el("ol", [txt("说明"), el("li", [txt("a")]), el("li", [txt("b")])])));
        expect(md).toContain("说明");
        expect(md).toContain("1. a");
        expect(md).toContain("2. b");
    });

    it("ol 内非 li 元素(p)内容保留", () => {
        const md = withNode(() => HTMLToMarkdown._convertNode(
            el("ol", [el("p", [txt("x")]), el("li", [txt("a")])])));
        expect(md).toContain("x");
        expect(md).toContain("1. a");
    });

    it("有序列表序号不受非 li 节点影响", () => {
        const md = withNode(() => HTMLToMarkdown._convertNode(
            el("ol", [el("li", [txt("a")]), txt("\n"), el("li", [txt("b")])])));
        // wave15: 项间纯空白文本节点不再产出空行/行首缩进(紧凑列表) —— 序号契约不变
        expect(md).toBe("1. a\n2. b\n\n");
    });
});

describe("wave14 共识(qwen): 嵌套列表内代码围栏空行不被过滤", () => {
    const withNode = (fn) => {
        const orig = globalThis.Node;
        globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
        try { return fn(); } finally {
            if (orig === undefined) delete globalThis.Node; else globalThis.Node = orig;
        }
    };
    const txt = (s) => ({ nodeType: 3, textContent: s });
    const el = (tag, childNodes) => {
        const node = {
            nodeType: 1,
            tagName: tag.toUpperCase(),
            childNodes,
            children: childNodes.filter((n) => n.nodeType === 1),
            parentElement: null,
            className: "",
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        childNodes.forEach((c) => { if (c.nodeType === 1) c.parentElement = node; });
        return node;
    };
    const codeNode = (code) => {
        const codeEl = el("code", [txt(code)]);
        codeEl.textContent = code;
        const pre = el("pre", [codeEl]);
        pre.textContent = code;
        pre.querySelector = (sel) => (sel === "code" ? codeEl : null);
        return pre;
    };

    it("嵌套列表项内代码围栏的空行原样保留", () => {
        const outer = el("li", [txt("x"), el("ul", [el("li", [codeNode("a\n\nb")])])]);
        expect(withNode(() => HTMLToMarkdown._convertNode(outer))).toContain("a\n    \n    b");
    });

    it("普通嵌套列表不受影响", () => {
        const outer = el("li", [txt("x"), el("ul", [el("li", [txt("a")]), el("li", [txt("b")])])]);
        expect(withNode(() => HTMLToMarkdown._convertNode(outer))).toBe("- x\n  - a\n  - b\n");
    });
});
