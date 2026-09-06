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
