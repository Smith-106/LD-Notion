"use strict";

import { describe, it, expect } from "vitest";

// P4 收敛 wave5 (c18): 新建分页助手的截断语义 / 端点编码 / 损坏响应降级。
// 三模型共识(dsf+qwen 同根因): 失败与损坏游标 break 时未标记 truncated,
// dbId 未编码可改写请求路径, results 非数组在 try 外抛错。

const { NotionAPI } = require("../src/api");
const { queryAllPages, searchAllDatabases } = require("../src/ai/tools/paginate");

const read = (p) => require("fs").readFileSync(p, "utf8");

describe("P4 收敛(c18): 分页助手截断语义", () => {
    it("查询失败时 truncated=true(不把残缺结果当全量)", async () => {
        const original = NotionAPI.request;
        let page = 0;
        NotionAPI.request = async () => {
            page++;
            if (page === 2) throw new Error("boom");
            return { results: [{ id: "p1" }], has_more: true, next_cursor: "c1" };
        };
        try {
            const { results, truncated } = await queryAllPages({ dbId: "db1", apiKey: "k" });
            expect(results.length).toBe(1);
            expect(truncated).toBe(true);
        } finally {
            NotionAPI.request = original;
        }
    });

    it("响应结构损坏(results 非数组)不抛错且标记截断", async () => {
        const original = NotionAPI.request;
        NotionAPI.request = async () => ({ results: { not: "array" }, has_more: false });
        try {
            const { results, truncated } = await queryAllPages({ dbId: "db1", apiKey: "k" });
            expect(results).toEqual([]);
            expect(truncated).toBe(true);
        } finally {
            NotionAPI.request = original;
        }
    });

    it("has_more 为真但游标缺失时标记截断", async () => {
        const original = NotionAPI.request;
        NotionAPI.request = async () => ({ results: [{ id: "p" }], has_more: true, next_cursor: "" });
        try {
            const { truncated } = await queryAllPages({ dbId: "db1", apiKey: "k" });
            expect(truncated).toBe(true);
        } finally {
            NotionAPI.request = original;
        }
    });

    it("达到 maxPages 上限时标记截断", async () => {
        const original = NotionAPI.request;
        let page = 0;
        NotionAPI.request = async () => {
            page++;
            return { results: [{ id: `p${page}` }], has_more: true, next_cursor: `c${page}` };
        };
        try {
            const { results, truncated } = await queryAllPages({ dbId: "db1", apiKey: "k", maxPages: 2 });
            expect(results.length).toBe(2);
            expect(truncated).toBe(true);
        } finally {
            NotionAPI.request = original;
        }
    });

    it("dbId 经 URL 编码, 路径注入字符不得改写端点", async () => {
        const original = NotionAPI.request;
        const endpoints = [];
        NotionAPI.request = async (method, endpoint) => {
            endpoints.push(endpoint);
            return { results: [], has_more: false };
        };
        try {
            await queryAllPages({ dbId: "../pages/x?y=1#z", apiKey: "k" });
            expect(endpoints[0]).toBe("/databases/..%2Fpages%2Fx%3Fy%3D1%23z/query");
        } finally {
            NotionAPI.request = original;
        }
    });

    it("searchAllDatabases 失败同样标记截断", async () => {
        const original = NotionAPI.search;
        NotionAPI.search = async () => { throw new Error("boom"); };
        try {
            const { results, truncated } = await searchAllDatabases({ apiKey: "k" });
            expect(results).toEqual([]);
            expect(truncated).toBe(true);
        } finally {
            NotionAPI.search = original;
        }
    });

    it("searchAllDatabases 损坏响应不抛错且标记截断", async () => {
        const original = NotionAPI.search;
        NotionAPI.search = async () => null;
        try {
            const { results, truncated } = await searchAllDatabases({ apiKey: "k" });
            expect(results).toEqual([]);
            expect(truncated).toBe(true);
        } finally {
            NotionAPI.search = original;
        }
    });

    it("unified_stats 单库分页截断计入统计提示", () => {
        const src = read("src/ai/tools/read-tools.js");
        expect(src).toContain("if (truncated) dbTruncated = true;");
        expect(src).toContain("受分页/数据库数量上限截断");
    });
});
