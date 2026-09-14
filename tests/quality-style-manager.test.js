import { describe, it, expect, afterEach } from "vitest";

// quality-auto-test p3-r4 (AT-020, L1): ui/style-manager.injectOnce。
// 断言面: 正常注入(data-ldb-style 标记)、同 id 幂等、空参守卫、head 缺失 documentElement 回退。
// 夹具契约: node 环境无 DOM → global.document 最小 stub, afterEach 清理。
const { StyleManager } = require("../src/ui/style-manager");

const makeDoc = () => {
    const appended = [];
    const registered = new Map();
    global.document = {
        head: { appendChild: (el) => appended.push(el) },
        documentElement: { appendChild: (el) => appended.push(el) },
        getElementById: (id) => registered.get(id) || null,
        createElement: () => ({
            attrs: {},
            textContent: "",
            setAttribute(k, v) {
                this.attrs[k] = v;
            },
        }),
        _appended: appended,
        _register: (el) => registered.set(el.id, el),
    };
    return global.document;
};

afterEach(() => {
    delete global.document;
});

describe("AT-020: style-manager.injectOnce 幂等注入与守卫", () => {
    it("正常注入: id/textContent/data-ldb-style + 恰一次挂载", () => {
        const doc = makeDoc();
        const el = StyleManager.injectOnce("ldb-x", ".a{color:red}");
        expect(el.id).toBe("ldb-x");
        expect(el.attrs["data-ldb-style"]).toBe("ldb-x");
        expect(el.textContent).toBe(".a{color:red}");
        expect(doc._appended.length).toBe(1);
    });

    it("幂等: 同 id 已存在 → 返回既有节点, 零新增挂载", () => {
        const doc = makeDoc();
        const first = StyleManager.injectOnce("ldb-y", ".a{}");
        doc._register(first);
        const second = StyleManager.injectOnce("ldb-y", ".b{}");
        expect(second).toBe(first);
        expect(doc._appended.length).toBe(1);
    });

    it("守卫: 空 id / 空 css → null 且零 DOM 操作", () => {
        const doc = makeDoc();
        expect(StyleManager.injectOnce(null, ".a{}")).toBeNull();
        expect(StyleManager.injectOnce("ldb-z", "")).toBeNull();
        expect(doc._appended.length).toBe(0);
    });

    it("回退: head 缺失 → documentElement 挂载", () => {
        const doc = makeDoc();
        doc.head = null;
        const el = StyleManager.injectOnce("ldb-w", ".c{}");
        expect(el).toBeTruthy();
        expect(doc._appended.length).toBe(1);
    });
});
