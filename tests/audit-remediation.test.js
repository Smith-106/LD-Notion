import { describe, it, expect } from "vitest";
const { AISchema } = require("../src/ai/schema.js");
const { Utils } = require("../src/utils");
const fs = require("fs");
describe("audit remediation", () => {
  it("parseAIJson workspaceConnection accepts valid payload", () => {
    const r = AISchema.parseAIJson("workspaceConnection", "{\"canonicalTitle\":\"t\",\"summary\":\"s\",\"recommendedAction\":\"merge\",\"tags\":[\"a\"]}");
    expect(r.ok).toBe(true);
  });
  it("parseAIJson workspaceConnection rejects bad action", () => {
    const r = AISchema.parseAIJson("workspaceConnection", "{\"canonicalTitle\":\"t\",\"recommendedAction\":\"delete\"}");
    expect(r.ok).toBe(false);
  });
  it("escapeHtml escapes quotes for option values", () => {
    const v = Utils.escapeHtml("a\"b>c");
    expect(v).toContain("&quot;");
    expect(v).toContain("&gt;");
  });
  it("workspace prompt uses isolateContent", () => {
    const src = fs.readFileSync("src/ui/workspace-insight.js","utf8");
    expect(src).toMatch(/AIService\.isolateContent/);
    expect(src).toMatch(/<user_content>/);
  });
  it("4xx short-circuit present in LinuxDoAPI and RSS", () => {
    const ld = fs.readFileSync("src/extract/LinuxDoAPI.js","utf8");
    const rss = fs.readFileSync("src/bridge/RSSAutoImporter.js","utf8");
    expect(ld).toContain("40[013]");
    expect(rss).toContain("40[013]");
  });
});

describe("v3.14.8 audit follow-ups", () => {
  it("ConfirmationDialog queues re-entry instead of false-cancel", async () => {
    const { ConfirmationDialog } = require("../src/security");
    // minimal DOM
    const body = { children: [], appendChild(n){ this.children.push(n); return n; } };
    global.document = {
      body,
      createElement(tag) {
        const el = {
          tagName: tag.toUpperCase(),
          className: "",
          style: {},
          attrs: {},
          children: [],
          setAttribute(k,v){ this.attrs[k]=v; },
          appendChild(n){ this.children.push(n); return n; },
          remove(){ body.children = body.children.filter(x => x !== el); },
          querySelector(sel){
            if (sel === "#ldb-confirm-ok") return { disabled: true, onclick: null, focus(){}, textContent: "" };
            if (sel === "#ldb-confirm-cancel") return { onclick: null, focus(){} };
            if (sel === "#ldb-confirm-countdown") return { textContent: "0", parentElement: { textContent: "" } };
            if (sel === "#ldb-confirm-countdown-fill") return { style: {} };
            if (sel === "#ldb-confirm-name-input") return null;
            if (sel === ".ldb-confirm-item-name") return { textContent: "" };
            if (sel === ".ldb-confirm-hint-name") return { textContent: "" };
            return null;
          },
          addEventListener(){},
          removeEventListener(){},
        };
        // innerHTML setter: no-op for stub
        Object.defineProperty(el, "innerHTML", { set(){}, get(){ return ""; } });
        return el;
      },
      addEventListener(){},
      removeEventListener(){},
    };
    global.requestAnimationFrame = (cb) => cb();
    ConfirmationDialog.dialogElement = null;
    ConfirmationDialog._queue = [];
    ConfirmationDialog._activeResolve = null;

    const p1 = ConfirmationDialog.show({ title: "A", message: "m1", countdown: 0 });
    expect(ConfirmationDialog.dialogElement).toBeTruthy();
    const p2 = ConfirmationDialog.show({ title: "B", message: "m2", countdown: 0 });
    expect(ConfirmationDialog._queue.length).toBe(1);
    // close should resolve false (not leave hanging) and drain queue
    ConfirmationDialog.close();
    await expect(p1).resolves.toBe(false);
    // second dialog should now be presented
    expect(ConfirmationDialog.dialogElement).toBeTruthy();
    ConfirmationDialog.close();
    await expect(p2).resolves.toBe(false);
  });

  it("exportGitHubSelectedToNotion honors cancel control", async () => {
    const { exportGitHubSelectedToNotion } = require("../src/import/github-obsidian-service");
    const { GitHubExporter } = require("../src/import/GitHubExporter");
    const { NotionAPI } = require("../src/api");
    const { OperationGuard } = require("../src/security");
    const origSetup = GitHubExporter.setupDatabaseProperties;
    const origEnrich = GitHubExporter.enrichRepo;
    const origProps = GitHubExporter.buildRepoProperties;
    const origAudit = GitHubExporter._auditExport;
    const origCan = OperationGuard.canExecute;
    const origReq = NotionAPI.request;
    GitHubExporter.setupDatabaseProperties = async () => ({ success: true });
    GitHubExporter.enrichRepo = async (b) => b;
    GitHubExporter.buildRepoProperties = () => ({ title: "x" });
    GitHubExporter._auditExport = () => {};
    OperationGuard.canExecute = () => true;
    let calls = 0;
    NotionAPI.request = async () => { calls++; return { id: "p" + calls }; };
    const control = { isCancelled: false, isPaused: false };
    try {
      const items = [
        { itemKey: "a/b1", title: "1", sourceType: "repos", raw: { html_url: "https://github.com/a/b1" } },
        { itemKey: "a/b2", title: "2", sourceType: "repos", raw: { html_url: "https://github.com/a/b2" } },
        { itemKey: "a/b3", title: "3", sourceType: "repos", raw: { html_url: "https://github.com/a/b3" } },
      ];
      // cancel before any item
      control.isCancelled = true;
      const result = await exportGitHubSelectedToNotion(items, { apiKey: "k", databaseId: "db" }, null, control);
      expect(calls).toBe(0);
      expect(result.skipped.length).toBe(3);
      expect(result.success.length).toBe(0);
    } finally {
      GitHubExporter.setupDatabaseProperties = origSetup;
      GitHubExporter.enrichRepo = origEnrich;
      GitHubExporter.buildRepoProperties = origProps;
      GitHubExporter._auditExport = origAudit;
      OperationGuard.canExecute = origCan;
      NotionAPI.request = origReq;
    }
  });

  it("userscript header lists subdomain matches and no catch-all include", () => {
    const src = fs.readFileSync("build.js", "utf8");
    expect(src).toMatch(/@match\s+https:\/\/\*\.linux\.do\/\*/);
    expect(src).toMatch(/@match\s+https:\/\/\*\.notion\.so\/\*/);
    expect(src).not.toMatch(/@include\s+/);
  });

  it("generic save UX keeps export visible language in source", () => {
    const src = fs.readFileSync("src/ui/generic-ui.js", "utf8");
    expect(src).toContain("目标已保存，但数据库属性配置失败");
    expect(src).toContain("仍可尝试导出");
  });
});

describe("debug-ui-bugs: AI 面板接线回归守卫(2978b01 拆分丢失 ChatUI.init)", () => {
    it("bug1: 主面板 initPanel 含 ChatUI.init 接线(拆分前 ui/index.js:4219 同款)", () => {
        const src = fs.readFileSync("src/ui/main-ui.js", "utf8");
        expect(src).toContain("ChatUI.init();");
        // 绑定体仍在 ai/index.js(唯一归属)
        const ai = fs.readFileSync("src/ai/index.js", "utf8");
        expect(ai).toMatch(/bindEvents: \(\) => \{/);
        expect(ai).toContain("#ldb-chat-send");
    });
    it("bug1: Notion 站面板接线仍完整(load+render+bind)", () => {
        const src = fs.readFileSync("src/ui/notion-site-ui.js", "utf8");
        expect(src).toContain("ChatState.load();");
        expect(src).toContain("ChatUI.renderMessages();");
        expect(src).toContain("ChatUI.bindEvents();");
    });
    it("bug2: 404 未共享指引存在于 api 抛错点与 ErrorModel 分类", () => {
        const api = fs.readFileSync("src/api/index.js", "utf8");
        expect(api).toContain("notFoundHint");
        expect(api).toContain("重新授权并勾选");
        const em = fs.readFileSync("src/errors/ErrorModel.js", "utf8");
        expect(em).toContain("未共享给当前集成");
    });
});

describe("debug-aipanel-keys: 确认对话框可见性 + 请求错误文案回归守卫", () => {
    it("Utils.formatRequestError: 对象提取常见字段, 字符串原样, 空值兑底", () => {
        expect(Utils.formatRequestError({ error: "net::ERR_CONNECTION_REFUSED" })).toBe("net::ERR_CONNECTION_REFUSED");
        expect(Utils.formatRequestError({ message: "timeout of 15000ms" })).toBe("timeout of 15000ms");
        expect(Utils.formatRequestError({ type: "error" })).toBe("error");
        expect(Utils.formatRequestError("plain failure")).toBe("plain failure");
        expect(Utils.formatRequestError(null)).toBe("未知错误");
        // 无常见字段的对象 JSON 序列化兑底(不再 [object Object])
        expect(Utils.formatRequestError({ foo: 1 })).toContain("foo");
    });
    it("确认对话框遮罩样式存在于 BASE CSS 且可覆盖面板(修复 v2.5.0 起无 CSS 的诞生缺陷)", () => {
        const { DesignSystem } = require("../src/ui/design-system");
        const css = DesignSystem.getBaseCSS();
        expect(css).toContain(".ldb-confirm-overlay");
        // fixed 全屏居中 — 否则裸 block 流式 append 到 body 末尾, 长页面下视口外不可见
        expect(css).toMatch(/\.ldb-confirm-overlay\s*\{[^}]*position:\s*fixed/);
        // 遮罩 z-index 必须高于面板(2147483640), 否则被面板自身盖住
        expect(css).toMatch(/\.ldb-confirm-overlay\s*\{[^}]*z-index:\s*2147483641/);
        expect(css).toContain(".ldb-confirm-dialog");
    });
    it("AI/上传 onerror 不再裸串化对象参数(全部走 Utils.formatRequestError)", () => {
        for (const f of ["src/ai/index.js", "src/api/notion-upload.js"]) {
            const src = fs.readFileSync(f, "utf8");
            expect(src).not.toContain("网络请求失败: ${error}");
            expect(src).toContain("Utils.formatRequestError(error)");
        }
    });
});

describe("agent-executor deps getter 调用守卫(修复 ChatState2.updateLastMessage is not a function)", () => {
    it("deps.js getter 误当对象裸用 — ChatState/AIService 必须 getter 调用", () => {
        const src = fs.readFileSync("src/ai/agent-executor.js", "utf8");
        // 定义行除外: getState: ChatState 是绑定 getter 本身
        const callLines = src.split("\n").filter(l => /(^|[^()\w])(ChatState|AIService)\.[a-zA-Z]/.test(l) && !/get(State|Service): /.test(l));
        expect(callLines).toEqual([]);
    });
    it("deps getter 返回真对象(updateLastMessage 可用)", () => {
        const { getState, getService } = require("../src/ai/deps");
        const st = getState();
        expect(typeof st.updateLastMessage).toBe("function");
        expect(typeof getService().requestChat).toBe("function");
    });
});

describe("P1 三模型共识修复守卫(异步/定时器/禁用绕过)", () => {
    it("Bookmark/RSS init 延迟启动定时器必须可被 stopPolling 清理", () => {
        for (const f of ["src/bridge/BookmarkAutoImporter.js", "src/bridge/RSSAutoImporter.js"]) {
            const src = fs.readFileSync(f, "utf8");
            expect(src).toContain("initTimerId");
            // stopPolling 内必须清理 initTimerId, 否则禁用后延迟回调仍 run + 复活轮询
            const stopBody = src.slice(src.indexOf("stopPolling: () =>"), src.indexOf("startPolling:"));
            expect(stopBody).toContain("clearTimeout(");
            expect(stopBody).toContain("initTimerId = null");
            // 禁用后不得再经 visibilitychange 补跑
            expect(stopBody).toContain("deferredWhileHidden = false");
        }
    });
    it("SyncScheduler 已排队 idle 回调在 stop 后必须丢弃(epoch 复核)", () => {
        const src = fs.readFileSync("src/adapter/SyncScheduler.js", "utf8");
        // runSync 内先捕获 epoch, 再在执行前比对 — 防 stop 后仍同步
        expect(src).toMatch(/const runSync = \(\) => \{[\s\S]{0,400}const epoch = this\._epochs\.get\(sourceType\)[\s\S]{0,300}if \(epoch !== \(this\._epochs\.get\(sourceType\)/);
    });
    it("init 延迟回调执行前复核 enabled(防延迟窗口内禁用)", () => {
        for (const [f, key] of [["src/bridge/BookmarkAutoImporter.js", "BOOKMARK_AUTO_IMPORT_ENABLED"], ["src/bridge/RSSAutoImporter.js", "RSS_AUTO_IMPORT_ENABLED"]]) {
            const src = fs.readFileSync(f, "utf8");
            const start = src.indexOf("initTimerId = setTimeout");
            const end = src.indexOf("}, 3000)", start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            expect(src.slice(start, end)).toContain(key);
        }
    });

    it("显式 0 间隔(仅手动)不得回退默认并启动定时器", () => {
        const src = fs.readFileSync("src/adapter/SyncScheduler.js", "utf8");
        // getIntervalMinutes 不得用 || def 吞掉 0
        const gi = src.slice(src.indexOf("getIntervalMinutes(sourceType)"), src.indexOf("getIntervalMinutes(sourceType)") + 420);
        expect(gi).not.toMatch(/return Number\(Storage\.getRaw\(key, def\)\) \|\| def;/);
        expect(gi).toContain("raw >= 0");
        // start 中显式 interval 优先(含 0), 不再要求 > 0 才采用
        expect(src).toMatch(/const intervalMin = Number\.isFinite\(intervalMinutes\)[\s\S]{0,60}\? intervalMinutes/);
    });
});
