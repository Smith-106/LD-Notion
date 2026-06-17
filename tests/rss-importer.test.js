"use strict";

import { describe, it, expect } from "vitest";
const { RSSAutoImporter } = require("../src/bridge/RSSAutoImporter");

describe("AT-005: RSSAutoImporter 纯函数", () => {
    // ── escapeRegExp ────────────────────────────────────────────
    describe("escapeRegExp", () => {
        it("escapes special regex chars . * + ? ^ $ { } ( ) | [ ] \\", () => {
            const specials = ".*+?^${}()|[]\\";
            const escaped = RSSAutoImporter.escapeRegExp(specials);
            // 每个特殊字符前应有反斜杠
            expect(escaped).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
        });

        it("normal text passes through unchanged", () => {
            expect(RSSAutoImporter.escapeRegExp("hello")).toBe("hello");
        });

        it("null/undefined → empty string", () => {
            expect(RSSAutoImporter.escapeRegExp(null)).toBe("");
            expect(RSSAutoImporter.escapeRegExp(undefined)).toBe("");
        });
    });

    // ── decodeXmlEntities ───────────────────────────────────────
    describe("decodeXmlEntities", () => {
        it("&amp; → &, &lt; → <, &gt; → >, &quot; → \"", () => {
            expect(RSSAutoImporter.decodeXmlEntities("&amp;")).toBe("&");
            expect(RSSAutoImporter.decodeXmlEntities("&lt;")).toBe("<");
            expect(RSSAutoImporter.decodeXmlEntities("&gt;")).toBe(">");
            expect(RSSAutoImporter.decodeXmlEntities("&quot;")).toBe('"');
        });

        it("&#39; → ' (apos)", () => {
            expect(RSSAutoImporter.decodeXmlEntities("&#39;")).toBe("'");
        });

        it("&apos; → ' (named apos)", () => {
            expect(RSSAutoImporter.decodeXmlEntities("&apos;")).toBe("'");
        });

        it("&#x26; stays as-is (hex entities not decoded)", () => {
            // 当前实现不处理通用十六进制实体
            expect(RSSAutoImporter.decodeXmlEntities("&#x26;")).toBe("&#x26;");
        });

        it("&#60; stays as-is (decimal entities not decoded, except &#39;)", () => {
            // 当前实现仅解码 &#39; 和 &apos;，不处理通用十进制实体
            expect(RSSAutoImporter.decodeXmlEntities("&#60;")).toBe("&#60;");
        });

        it("CDATA section stripped", () => {
            expect(RSSAutoImporter.decodeXmlEntities("<![CDATA[hello world]]>")).toBe("hello world");
        });

        it("mixed entities in text", () => {
            expect(RSSAutoImporter.decodeXmlEntities("a &amp; b &lt; c &gt; d")).toBe("a & b < c > d");
        });

        it("null/undefined → empty string", () => {
            expect(RSSAutoImporter.decodeXmlEntities(null)).toBe("");
            expect(RSSAutoImporter.decodeXmlEntities(undefined)).toBe("");
        });
    });

    // ── stripHtml ───────────────────────────────────────────────
    describe("stripHtml", () => {
        it("removes HTML tags, keeps text content", () => {
            expect(RSSAutoImporter.stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
        });

        it("truncates to maxLen", () => {
            const long = "a".repeat(2000);
            const result = RSSAutoImporter.stripHtml(long, 100);
            expect(result.length).toBeLessThanOrEqual(100);
        });

        it("empty string → \"\"", () => {
            expect(RSSAutoImporter.stripHtml("")).toBe("");
        });
    });

    // ── extractTagText ──────────────────────────────────────────
    describe("extractTagText", () => {
        it("extracts text content from named XML tag in block", () => {
            const block = "<title>My Feed Title</title><link>https://example.com</link>";
            expect(RSSAutoImporter.extractTagText(block, ["title"])).toBe("My Feed Title");
        });

        it("missing tag → \"\"", () => {
            const block = "<title>My Title</title>";
            expect(RSSAutoImporter.extractTagText(block, ["description"])).toBe("");
        });

        it("tries multiple tag names in order", () => {
            const block = "<pubDate>Mon, 01 Jan 2024</pubDate>";
            expect(RSSAutoImporter.extractTagText(block, ["published", "pubDate"])).toBe("Mon, 01 Jan 2024");
        });

        it("decodes XML entities in extracted text", () => {
            const block = "<title>A &amp; B</title>";
            expect(RSSAutoImporter.extractTagText(block, ["title"])).toBe("A & B");
        });
    });

    // ── extractTagTexts ─────────────────────────────────────────
    describe("extractTagTexts", () => {
        it("extracts multiple same-named tags → array", () => {
            const block = "<category>Tech</category><category>News</category><category>AI</category>";
            const result = RSSAutoImporter.extractTagTexts(block, ["category"]);
            expect(result).toEqual(["Tech", "News", "AI"]);
        });

        it("returns empty array when no matches", () => {
            const block = "<title>No categories here</title>";
            expect(RSSAutoImporter.extractTagTexts(block, ["category"])).toEqual([]);
        });

        it("skips empty values", () => {
            const block = "<category></category><category>Valid</category>";
            const result = RSSAutoImporter.extractTagTexts(block, ["category"]);
            expect(result).toEqual(["Valid"]);
        });
    });

    // ── extractAtomCategoryTerms ────────────────────────────────
    describe("extractAtomCategoryTerms", () => {
        it("extracts term attributes from category elements", () => {
            const block = '<category term="Technology"/><category term="Science" />';
            const result = RSSAutoImporter.extractAtomCategoryTerms(block);
            expect(result).toEqual(["Technology", "Science"]);
        });

        it("handles single-quoted term values", () => {
            const block = "<category term='AI'/>";
            const result = RSSAutoImporter.extractAtomCategoryTerms(block);
            expect(result).toEqual(["AI"]);
        });

        it("returns empty array for no category elements", () => {
            expect(RSSAutoImporter.extractAtomCategoryTerms("<title>Feed</title>")).toEqual([]);
        });
    });

    // ── extractLink ─────────────────────────────────────────────
    describe("extractLink", () => {
        it("RSS <link> text content", () => {
            const block = "<link>https://example.com/article</link>";
            expect(RSSAutoImporter.extractLink(block, false)).toBe("https://example.com/article");
        });

        it('Atom <link rel="alternate" href="...">', () => {
            const block = '<link rel="alternate" href="https://example.com/atom-entry"/>';
            expect(RSSAutoImporter.extractLink(block, true)).toBe("https://example.com/atom-entry");
        });

        it("Atom fallback: <link href=\"...\"> without rel=alternate", () => {
            const block = '<link href="https://example.com/fallback"/>';
            expect(RSSAutoImporter.extractLink(block, true)).toBe("https://example.com/fallback");
        });
    });

    // ── normalizeItem ───────────────────────────────────────────
    describe("normalizeItem", () => {
        it("RSS item → normalized structure with title, url, summary, tags", () => {
            const item = {
                title: "Test Article",
                url: "https://example.com/test",
                summary: "A test description",
                tags: ["tech", "test"],
                feedTitle: "My Feed",
                feedUrl: "https://example.com/feed.xml",
                publishedAt: "2024-01-15T10:00:00Z",
                id: "guid-123",
            };
            const result = RSSAutoImporter.normalizeItem(item);
            expect(result).toMatchObject({
                title: "Test Article",
                url: "https://example.com/test",
                summary: "A test description",
                tags: ["tech", "test"],
                feedTitle: "My Feed",
                feedUrl: "https://example.com/feed.xml",
            });
            // publishedAt 经 normalizeTime 转为 ISO 格式
            expect(result.publishedAt).toBe("2024-01-15T10:00:00.000Z");
            expect(result.id).toBeTruthy();
        });

        it("Atom entry → normalized structure", () => {
            const entry = {
                title: "Atom Post",
                url: "https://example.com/atom",
                summary: "Atom content",
                tags: [],
                feedTitle: "Atom Feed",
                feedUrl: "https://example.com/atom.xml",
                publishedAt: "2024-03-20T08:30:00Z",
                id: "urn:uuid:abc-123",
            };
            const result = RSSAutoImporter.normalizeItem(entry);
            expect(result.title).toBe("Atom Post");
            expect(result.url).toBe("https://example.com/atom");
            expect(result.id).toBeTruthy();
        });

        it("deduplicates tags", () => {
            const item = { title: "Dup", url: "https://example.com", tags: ["A", "A", "B"] };
            const result = RSSAutoImporter.normalizeItem(item);
            expect(result.tags).toEqual(["A", "B"]);
        });

        it("undefined item → defaults", () => {
            const result = RSSAutoImporter.normalizeItem(undefined);
            expect(result.title).toBe("未命名 RSS 条目");
            expect(result.url).toBe("");
            expect(result.tags).toEqual([]);
        });

        it("empty object → defaults", () => {
            const result = RSSAutoImporter.normalizeItem({});
            expect(result.title).toBe("未命名 RSS 条目");
            expect(result.url).toBe("");
        });
    });

    // ── buildItemKey ────────────────────────────────────────────
    describe("buildItemKey", () => {
        it("dedupMode=strict → URL-based key", () => {
            const item = { title: "Title", url: "https://example.com/a" };
            const key = RSSAutoImporter.buildItemKey(item, "strict");
            expect(key).toBe("https://example.com/a");
        });

        it('dedupMode="allow_duplicates" → feedUrl::id key', () => {
            const item = {
                title: "Title",
                url: "https://example.com/a",
                feedUrl: "https://example.com/feed.xml",
                id: "guid-123",
            };
            const key = RSSAutoImporter.buildItemKey(item, "allow_duplicates");
            expect(key).toContain("https://example.com/feed.xml");
            expect(key).toContain("guid-123");
        });

        it("dedupMode=strict, no url → falls back to id", () => {
            const item = { title: "No URL", url: "", id: "fallback-id" };
            const key = RSSAutoImporter.buildItemKey(item, "strict");
            expect(key).toBe("fallback-id");
        });
    });

    // ── parseFeedXml ────────────────────────────────────────────
    describe("parseFeedXml", () => {
        it("valid RSS 2.0 feed → array of items", () => {
            const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test RSS Feed</title>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <guid>guid-001</guid>
      <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
      <description>A first post description</description>
      <category>Tech</category>
    </item>
    <item>
      <title>Second Post</title>
      <link>https://example.com/second</link>
      <guid>guid-002</guid>
      <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
      <description>Second post content</description>
    </item>
  </channel>
</rss>`;
            const result = RSSAutoImporter.parseFeedXml(rssXml, "https://example.com/rss.xml");
            expect(result.feedTitle).toBe("Test RSS Feed");
            expect(result.items).toHaveLength(2);
            // 按时间降序排列
            expect(result.items[0].title).toBe("Second Post");
            expect(result.items[1].title).toBe("First Post");
            expect(result.items[0].feedUrl).toBe("https://example.com/rss.xml");
            expect(result.items[1].feedUrl).toBe("https://example.com/rss.xml");
            // 第二个 item (First Post) 含 category tag
            const firstItem = result.items.find((i) => i.title === "First Post");
            expect(firstItem.tags).toEqual(["Tech"]);
        });

        it("valid Atom feed → array of items", () => {
            const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Feed</title>
  <entry>
    <title>Atom Entry One</title>
    <link rel="alternate" href="https://example.com/atom-one"/>
    <id>urn:uuid:atom-001</id>
    <published>2024-02-15T09:00:00Z</published>
    <summary>Atom summary one</summary>
    <category term="Science"/>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <link rel="alternate" href="https://example.com/atom-two"/>
    <id>urn:uuid:atom-002</id>
    <published>2024-02-16T09:00:00Z</published>
    <summary>Atom summary two</summary>
  </entry>
</feed>`;
            const result = RSSAutoImporter.parseFeedXml(atomXml, "https://example.com/atom.xml");
            expect(result.feedTitle).toBe("Test Atom Feed");
            expect(result.items).toHaveLength(2);
            expect(result.items[0].title).toBe("Atom Entry Two");
            const oneItem = result.items.find((i) => i.title === "Atom Entry One");
            expect(oneItem.tags).toEqual(["Science"]);
        });

        it("malformed XML → empty array (graceful)", () => {
            const result = RSSAutoImporter.parseFeedXml("<not valid rss><broken>", "https://example.com/broken");
            expect(result.items).toEqual([]);
        });

        it("empty string → empty result", () => {
            const result = RSSAutoImporter.parseFeedXml("", "");
            expect(result.feedTitle).toBe("");
            expect(result.items).toEqual([]);
        });

        it("items without url or id are skipped", () => {
            const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Skip Feed</title>
    <item>
      <title>No URL Item</title>
      <description>This item has no link or guid</description>
    </item>
    <item>
      <title>Valid Item</title>
      <link>https://example.com/valid</link>
      <guid>valid-guid</guid>
    </item>
  </channel>
</rss>`;
            const result = RSSAutoImporter.parseFeedXml(rssXml);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].title).toBe("Valid Item");
        });
    });
});
