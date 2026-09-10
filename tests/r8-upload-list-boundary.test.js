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
        expect(HTMLToMarkdown._convertNode(ol)).toBe("1. a\n  - b\n\n");
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
        expect(HTMLToMarkdown._convertNode(el("iframe", { src: "data:text/html,<script>" })))
            .toContain("已拒");
    });

    it("iframe src 公网 https 正常输出嵌入链接", () => {
        expect(HTMLToMarkdown._convertNode(el("iframe", { src: "https://player.example.com/e/1" })))
            .toContain("https://player.example.com/e/1");
    });
});
