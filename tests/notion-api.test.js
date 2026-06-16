import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotionAPI, NotionTransport } from "../src/api/index.js";

describe("NotionAPI", () => {
    let mockTransport;

    beforeEach(() => {
        // Create a mock transport that replaces NotionTransport.request
        mockTransport = {
            request: vi.fn(),
        };
        NotionAPI.configureTransport(mockTransport);
    });

    describe("configureTransport / getTransport", () => {
        it("configures a custom transport adapter", () => {
            const custom = { request: vi.fn() };
            const result = NotionAPI.configureTransport(custom);
            expect(NotionAPI.getTransport()).toBe(custom);
        });

        it("rejects transport without request method", () => {
            expect(() => NotionAPI.configureTransport({})).toThrow("request 方法");
        });

        it("resets to default transport", () => {
            NotionAPI.configureTransport({ request: vi.fn() });
            const result = NotionAPI.resetTransport();
            expect(result).toBe(NotionAPI.Transport);
        });
    });

    describe("validateConfig", () => {
        it("returns valid:true when API responds 200", async () => {
            mockTransport.request.mockResolvedValue({
                status: 200,
                responseText: JSON.stringify({ id: "db-123", title: "Test" }),
                responseHeaders: "",
            });

            const result = await NotionAPI.validateConfig("fake-key", "db-123");
            expect(result.valid).toBe(true);
        });

        it("returns valid:false with error when API responds 401", async () => {
            mockTransport.request.mockResolvedValue({
                status: 401,
                responseText: JSON.stringify({ message: "Unauthorized" }),
                responseHeaders: "",
            });

            const result = await NotionAPI.validateConfig("bad-key", "db-123");
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });

        it("returns valid:false when API responds 404", async () => {
            mockTransport.request.mockResolvedValue({
                status: 404,
                responseText: JSON.stringify({ message: "Not Found" }),
                responseHeaders: "",
            });

            const result = await NotionAPI.validateConfig("fake-key", "nonexistent");
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
        });
    });

    describe("request", () => {
        it("makes a successful GET request and returns parsed JSON", async () => {
            mockTransport.request.mockResolvedValue({
                status: 200,
                responseText: JSON.stringify({ id: "page-1", object: "page" }),
                responseHeaders: "",
            });

            const result = await NotionAPI.request("GET", "/pages/page-1", null, "fake-key");
            expect(result.id).toBe("page-1");

            expect(mockTransport.request).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: "GET",
                    endpoint: "/pages/page-1",
                    token: "fake-key",
                })
            );
        });

        it("throws on non-2xx response", async () => {
            mockTransport.request.mockResolvedValue({
                status: 500,
                responseText: JSON.stringify({ message: "Internal Server Error" }),
                responseHeaders: "",
            });

            await expect(
                NotionAPI.request("GET", "/pages/bad", null, "fake-key")
            ).rejects.toThrow();
        });

        it("retries on 429 rate limit", async () => {
            // First call: 429, second call: 200
            // Use real sleep mock to avoid waiting
            vi.spyOn(await import("../src/utils/index.js").then(m => m.Utils), "sleep").mockResolvedValue(undefined);

            mockTransport.request
                .mockResolvedValueOnce({
                    status: 429,
                    responseText: JSON.stringify({ message: "Rate limited" }),
                    responseHeaders: "retry-after: 1",
                })
                .mockResolvedValueOnce({
                    status: 200,
                    responseText: JSON.stringify({ id: "retry-ok" }),
                    responseHeaders: "",
                });

            const result = await NotionAPI.request("GET", "/databases/db-1", null, "fake-key", 3);
            expect(result.id).toBe("retry-ok");
            expect(mockTransport.request).toHaveBeenCalledTimes(2);
        });
    });

    describe("NotionTransport", () => {
        it("has a request method", () => {
            expect(typeof NotionTransport.request).toBe("function");
        });

        it("exposes buildUrl method", () => {
            expect(typeof NotionTransport.buildUrl).toBe("function");
            expect(NotionTransport.buildUrl("/databases/test")).toBe("https://api.notion.com/v1/databases/test");
        });
    });
});
