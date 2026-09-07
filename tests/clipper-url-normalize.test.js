import { describe, it, expect } from "vitest";

describe("clipper URL alternate-key normalize", () => {
    it("ZhihuAdapter collapses query/hash variants to one dedup key", () => {
        const { ZhihuAdapter } = require("../src/adapter/ZhihuAdapter");
        const a = ZhihuAdapter.getDedupKey({
            id: "https://www.zhihu.com/question/1/answer/2?utm_source=share#section",
        });
        const b = ZhihuAdapter.getDedupKey({
            id: "https://www.zhihu.com/question/1/answer/2",
        });
        const c = ZhihuAdapter.normalize({
            url: "https://www.zhihu.com/question/1/answer/2?utm_campaign=x",
            title: "t",
        });
        expect(a).toBe(b);
        expect(a).toBe(`zhihu:${c.id}`);
        expect(a).toBe("zhihu:https://www.zhihu.com/question/1/answer/2");
    });

    it("GenericAdapter collapses query/hash variants to one dedup key", () => {
        const { GenericAdapter } = require("../src/adapter/GenericAdapter");
        const a = GenericAdapter.getDedupKey({
            url: "https://example.com/post?utm_medium=social&fbclid=abc#top",
        });
        const b = GenericAdapter.getDedupKey({ url: "https://example.com/post" });
        const c = GenericAdapter.normalize({
            url: "https://example.com/post/?ref=home",
            title: "t",
        });
        expect(a).toBe(b);
        expect(a).toBe(`generic:${c.url}`);
        expect(a).toBe("generic:https://example.com/post");
    });

    it("GenericExporter.enrichMeta canonicalizes url", async () => {
        const { GenericExporter } = require("../src/export");
        const enriched = await GenericExporter.enrichMeta(
            {
                title: "Hello",
                url: "https://www.zhihu.com/question/9/answer/8?utm_source=copy#frag",
                source: "知乎",
            },
            {}
        );
        expect(enriched.url).toBe("https://www.zhihu.com/question/9/answer/8");
    });
});

describe("UpdateChecker version fallback", () => {
    it("falls back to CONFIG.SCRIPT_VERSION when GM_info missing", () => {
        const had = global.GM_info;
        try {
            delete global.GM_info;
            delete require.cache[require.resolve("../src/import/UpdateChecker")];
            delete require.cache[require.resolve("../src/config")];
            const { CONFIG } = require("../src/config");
            const { UpdateChecker } = require("../src/import/UpdateChecker");
            expect(UpdateChecker.getCurrentVersion()).toBe(CONFIG.SCRIPT_VERSION);
            expect(CONFIG.SCRIPT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
            expect(UpdateChecker.getCurrentVersion()).not.toBe("3.4.5");
        } finally {
            if (had !== undefined) global.GM_info = had;
            else delete global.GM_info;
        }
    });
});
