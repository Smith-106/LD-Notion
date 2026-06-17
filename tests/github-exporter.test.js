import { describe, it, expect } from "vitest";
import { UpdateChecker } from "../src/import/UpdateChecker.js";
import { GitHubExporter } from "../src/import/GitHubExporter.js";

// ---------------------------------------------------------------------------
// AT-008: UpdateChecker.compareVersions
// ---------------------------------------------------------------------------
describe("AT-008: UpdateChecker.compareVersions", () => {
    const { compareVersions } = UpdateChecker;

    it('"3.0.0" > "2.9.9" → positive', () => {
        expect(compareVersions("3.0.0", "2.9.9")).toBeGreaterThan(0);
    });

    it('"3.0.1" > "3.0.0" → positive', () => {
        expect(compareVersions("3.0.1", "3.0.0")).toBeGreaterThan(0);
    });

    it('"3.0.0" === "3.0.0" → 0', () => {
        expect(compareVersions("3.0.0", "3.0.0")).toBe(0);
    });

    it('"2.0.0" < "3.0.0" → negative', () => {
        expect(compareVersions("2.0.0", "3.0.0")).toBeLessThan(0);
    });

    it('"3.1.0" > "3.0.5" → positive', () => {
        expect(compareVersions("3.1.0", "3.0.5")).toBeGreaterThan(0);
    });

    it('"3.01" vs "3.1" → handle leading zeros', () => {
        // parseInt("01", 10) === 1, so "3.01" and "3.1" are semantically equal
        expect(compareVersions("3.01", "3.1")).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// AT-009: GitHubExporter pure functions
// ---------------------------------------------------------------------------
describe("AT-009: GitHubExporter 纯函数", () => {
    // --- extractReadmeInsight ------------------------------------------------
    describe("extractReadmeInsight", () => {
        const { extractReadmeInsight } = GitHubExporter;

        it("markdown with heading → extracts title", () => {
            const md = "# My Awesome Project\n\nSome intro text.\n";
            const result = extractReadmeInsight(md);
            expect(result.title).toBe("My Awesome Project");
        });

        it("extracts summary from first non-heading paragraphs", () => {
            const md = [
                "# Title",
                "",
                "First paragraph of the readme.",
                "Second line of description.",
                "Third line here.",
                "",
                "## Installation",
                "More content after heading.",
            ].join("\n");
            const result = extractReadmeInsight(md);
            expect(result.summary).toContain("First paragraph of the readme.");
            expect(result.summary).toContain("Second line of description.");
            // Heading lines (starting with #) are filtered out
            expect(result.summary).not.toContain("## Installation");
            expect(result.summary).not.toContain("# Title");
        });

        it("empty readme → {title:'', summary:''}", () => {
            const result = extractReadmeInsight("");
            expect(result).toEqual({ title: "", summary: "" });
        });
    });

    // --- inferRepoCategoryHeuristic ------------------------------------------
    describe("inferRepoCategoryHeuristic", () => {
        const { inferRepoCategoryHeuristic } = GitHubExporter;

        it("keyword match → matching category", () => {
            const repo = {
                full_name: "user/ai-agent",
                name: "ai-agent",
                description: "An AI agent framework",
                topics: ["ai", "llm"],
                language: "Python",
            };
            const insight = { title: "AI Agent", summary: "LLM powered agent" };
            const categories = ["前端", "人工智能", "后端", "其他"];
            const result = inferRepoCategoryHeuristic(repo, insight, categories);
            expect(result).toBe("人工智能");
        });

        it("no match → last category or empty string", () => {
            const repo = {
                full_name: "user/random-lib",
                name: "random-lib",
                description: "A utility library",
                topics: [],
                language: "R",
            };
            const insight = { title: "Random Lib", summary: "Utility for stats" };
            const categories = ["前端", "后端"];
            // No rule matches "R" / "utility" / "stats", and no "其他" fallback → last category
            const result = inferRepoCategoryHeuristic(repo, insight, categories);
            expect(result).toBe("后端");
        });

        it("empty categories → empty string", () => {
            const repo = { full_name: "user/repo", name: "repo", description: "", topics: [], language: "" };
            const insight = { title: "", summary: "" };
            const result = inferRepoCategoryHeuristic(repo, insight, []);
            expect(result).toBe("");
        });
    });

    // --- inferRepoTags -------------------------------------------------------
    describe("inferRepoTags", () => {
        const { inferRepoTags } = GitHubExporter;

        it("from topics + language → deduped tags", () => {
            const repo = {
                full_name: "owner/ai-project",
                name: "ai-project",
                topics: ["machine-learning", "python"],
                language: "Python",
            };
            const insight = { title: "AI Project", summary: "" };
            const tags = inferRepoTags(repo, insight);
            // "python" from topics and "Python" from language — normalizeText keeps case,
            // so they are different strings; both present, no dedup needed
            expect(tags).toContain("machine-learning");
            expect(tags).toContain("python");
            expect(tags).toContain("Python");
            // owner extracted from full_name
            expect(tags).toContain("owner");
        });

        it("caps tags at max 20", () => {
            const repo = {
                full_name: "owner/big-repo",
                name: "big-repo",
                topics: Array.from({ length: 30 }, (_, i) => `topic-${i}`),
                language: "Go",
            };
            const insight = { title: "", summary: "" };
            const tags = inferRepoTags(repo, insight);
            expect(tags.length).toBeLessThanOrEqual(20);
        });
    });

    // --- normalizeText -------------------------------------------------------
    describe("normalizeText", () => {
        const { normalizeText } = GitHubExporter;

        it("collapses whitespace and trims", () => {
            expect(normalizeText("  hello   world  ")).toBe("hello world");
        });

        it("truncates to maxLen", () => {
            const long = "a".repeat(300);
            expect(normalizeText(long, 280)).toHaveLength(280);
        });

        it("returns empty string for falsy input", () => {
            expect(normalizeText(null)).toBe("");
            expect(normalizeText(undefined)).toBe("");
            expect(normalizeText("")).toBe("");
        });
    });

    // --- composeTitleWithPrefix ----------------------------------------------
    describe("composeTitleWithPrefix", () => {
        const { composeTitleWithPrefix } = GitHubExporter;

        it('"owner/repo · Custom Title" pattern', () => {
            const result = composeTitleWithPrefix("owner/repo", "Custom Title");
            expect(result).toBe("owner/repo · Custom Title");
        });

        it("returns candidate only when prefix is empty", () => {
            expect(composeTitleWithPrefix("", "Just Title")).toBe("Just Title");
        });

        it("returns prefix when candidate is empty or same", () => {
            expect(composeTitleWithPrefix("owner/repo", "")).toBe("owner/repo");
            expect(composeTitleWithPrefix("owner/repo", "owner/repo")).toBe("owner/repo");
        });

        it("avoids duplicate when candidate already starts with prefix · ", () => {
            expect(composeTitleWithPrefix("owner/repo", "owner/repo · Extra")).toBe("owner/repo · Extra");
        });

        it("avoids duplicate when candidate already starts with prefix - ", () => {
            expect(composeTitleWithPrefix("owner/repo", "owner/repo - Alt")).toBe("owner/repo - Alt");
        });
    });
});
