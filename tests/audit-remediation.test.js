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


