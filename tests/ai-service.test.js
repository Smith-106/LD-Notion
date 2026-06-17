import { describe, it, expect } from "vitest";
import { AIService } from "../src/ai/index.js";

describe("AT-006: AIService.matchCategory + PROVIDERS", () => {
    describe("matchCategory", () => {
        const categories = ["技术", "产品", "设计", "运营", "其他"];

        it("exact match returns matching category", () => {
            expect(AIService.matchCategory("技术", categories)).toBe("技术");
            expect(AIService.matchCategory("产品", categories)).toBe("产品");
        });

        it("case-insensitive match", () => {
            expect(AIService.matchCategory("tech", ["Tech", "Design"])).toBe("Tech");
            expect(AIService.matchCategory("DESIGN", ["Tech", "Design"])).toBe("Design");
        });

        it("substring/contains match", () => {
            expect(AIService.matchCategory("前端技术分享", categories)).toBe("技术");
            expect(AIService.matchCategory("产", ["产品", "设计"])).toBe("产品");
        });

        it("no match returns default (last category)", () => {
            expect(AIService.matchCategory("完全无关的内容", categories)).toBe("其他");
        });

        it("multiple categories, picks best match (exact over contains)", () => {
            const cats = ["前端", "前端工程化", "其他"];
            // exact match takes priority over substring match
            expect(AIService.matchCategory("前端", cats)).toBe("前端");
        });
    });

    describe("PROVIDERS", () => {
        it("has openai, claude, gemini entries", () => {
            expect(AIService.PROVIDERS).toHaveProperty("openai");
            expect(AIService.PROVIDERS).toHaveProperty("claude");
            expect(AIService.PROVIDERS).toHaveProperty("gemini");
        });

        it("each provider has endpoint property", () => {
            expect(AIService.PROVIDERS.openai).toHaveProperty("endpoint");
            expect(AIService.PROVIDERS.claude).toHaveProperty("endpoint");
            expect(AIService.PROVIDERS.gemini).toHaveProperty("endpoint");
            expect(typeof AIService.PROVIDERS.openai.endpoint).toBe("string");
            expect(typeof AIService.PROVIDERS.claude.endpoint).toBe("string");
            expect(typeof AIService.PROVIDERS.gemini.endpoint).toBe("string");
        });
    });
});
