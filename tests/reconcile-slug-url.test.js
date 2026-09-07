"use strict";

import { describe, it, expect } from "vitest";

const { WorkspaceVisual } = require("../src/ui/workspace-visual");

describe("normalizeWorkspaceInsightUrl Discourse slug 对账", () => {
    const norm = (u) => WorkspaceVisual.normalizeWorkspaceInsightUrl(u);

    it("裸 /t/{id} 保持不变", () => {
        expect(norm("https://linux.do/t/12345")).toBe("https://linux.do/t/12345");
    });

    it("/t/{slug}/{id} → /t/{id}", () => {
        expect(norm("https://linux.do/t/some-topic-slug/12345")).toBe("https://linux.do/t/12345");
    });

    it("/t/{slug}/{id}/{post} → /t/{id}", () => {
        expect(norm("https://linux.do/t/some-topic-slug/12345/8")).toBe("https://linux.do/t/12345");
    });

    it("大小写 host 与尾斜杠归一", () => {
        expect(norm("https://Linux.Do/t/Slug-Here/99/")).toBe("https://linux.do/t/99");
    });

    it("非 linux.do 不改路径", () => {
        expect(norm("https://example.com/t/slug/1")).toBe("https://example.com/t/slug/1");
    });
});
