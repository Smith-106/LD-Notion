import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
const { OperationLog } = require("../src/security/index");

// Mock CredentialVault so redactSensitiveFields has a SENSITIVE_KEYS set to work with.
// Without this, CredentialVault is undefined and redactSensitiveFields becomes a no-op.
const MOCK_SENSITIVE_KEYS = new Set([
    "ldb_notion_api_key",
    "ldb_notion_oauth_client_secret",
    "ldb_notion_oauth_refresh_token",
]);

describe("AT-007: OperationLog 纯函数", () => {
    describe("redactSensitiveFields", () => {
        let originalCredentialVault;

        beforeEach(() => {
            originalCredentialVault = globalThis.CredentialVault;
            globalThis.CredentialVault = { SENSITIVE_KEYS: MOCK_SENSITIVE_KEYS };
        });

        afterEach(() => {
            if (originalCredentialVault === undefined) {
                delete globalThis.CredentialVault;
            } else {
                globalThis.CredentialVault = originalCredentialVault;
            }
        });

        it("replaces values of keys in CredentialVault.SENSITIVE_KEYS with ***REDACTED***", () => {
            const entry = {
                operationName: "createDatabasePage",
                context: {
                    "ldb_notion_api_key": "secret-api-key-123",
                    "ldb_notion_oauth_client_secret": "my-client-secret",
                    "ldb_notion_oauth_refresh_token": "refresh-token-abc",
                    pageId: "page-123",
                    itemName: "Test Page",
                },
            };
            const result = OperationLog.redactSensitiveFields(entry);
            expect(result.context["ldb_notion_api_key"]).toBe("***REDACTED***");
            expect(result.context["ldb_notion_oauth_client_secret"]).toBe("***REDACTED***");
            expect(result.context["ldb_notion_oauth_refresh_token"]).toBe("***REDACTED***");
            // Non-sensitive keys are preserved
            expect(result.context.pageId).toBe("page-123");
            expect(result.context.itemName).toBe("Test Page");
        });

        it("preserves non-sensitive field values", () => {
            const entry = {
                operationName: "search",
                context: {
                    query: "hello world",
                    pageId: "abc-123",
                    itemName: "My Page",
                    blockCount: 5,
                },
            };
            const result = OperationLog.redactSensitiveFields(entry);
            expect(result.context.query).toBe("hello world");
            expect(result.context.pageId).toBe("abc-123");
            expect(result.context.itemName).toBe("My Page");
            expect(result.context.blockCount).toBe(5);
        });

        it("handles nested objects with sensitive keys in context", () => {
            const entry = {
                operationName: "updatePage",
                context: {
                    "ldb_notion_api_key": "sk-xxx",
                    nested: { someKey: "someValue", deep: { token: "inner" } },
                    pageId: "pg-1",
                },
            };
            const result = OperationLog.redactSensitiveFields(entry);
            // Only top-level context keys in SENSITIVE_KEYS are redacted
            expect(result.context["ldb_notion_api_key"]).toBe("***REDACTED***");
            // Nested objects are not traversed by redactSensitiveFields
            expect(result.context.nested).toEqual({ someKey: "someValue", deep: { token: "inner" } });
            expect(result.context.pageId).toBe("pg-1");
        });

        it("returns entry as-is when it is null or non-object", () => {
            expect(OperationLog.redactSensitiveFields(null)).toBe(null);
            expect(OperationLog.redactSensitiveFields("string")).toBe("string");
            expect(OperationLog.redactSensitiveFields(42)).toBe(42);
        });

        it("becomes no-op when CredentialVault is undefined", () => {
            delete globalThis.CredentialVault;
            const entry = {
                context: { "ldb_notion_api_key": "secret-key" },
            };
            const result = OperationLog.redactSensitiveFields(entry);
            // No SENSITIVE_KEYS available, so nothing gets redacted
            expect(result.context["ldb_notion_api_key"]).toBe("secret-key");
        });
    });

    describe("inferAuditEvent", () => {
        it("maps known operation names to their audit event types", () => {
            expect(OperationLog.inferAuditEvent("createDatabasePage")).toBe("write.page.created");
            expect(OperationLog.inferAuditEvent("deletePage")).toBe("page.archived");
            expect(OperationLog.inferAuditEvent("deleteBlock")).toBe("block.deleted");
            expect(OperationLog.inferAuditEvent("updatePage")).toBe("write.property.updated");
            expect(OperationLog.inferAuditEvent("appendBlocks")).toBe("write.block.inserted");
            expect(OperationLog.inferAuditEvent("restorePage")).toBe("page.restored");
        });

        it("returns import.completed for unknown operations with success status", () => {
            expect(OperationLog.inferAuditEvent("unknownOp")).toBe("import.completed");
            expect(OperationLog.inferAuditEvent("unknownOp", "success")).toBe("import.completed");
        });

        it("returns import.failed for unknown operations with failed status", () => {
            expect(OperationLog.inferAuditEvent("unknownOp", "failed")).toBe("import.failed");
        });
    });

    describe("normalizeAuditEntry", () => {
        it("fills in missing fields with defaults", () => {
            const result = OperationLog.normalizeAuditEntry({});
            expect(result.actor).toBe("user");
            expect(result.source).toBe("ui");
            expect(result.guard).toBe(null);
            expect(result.status).toBe("success");
            expect(result.error).toBe("");
            expect(result.operationName).toBe("");
            expect(typeof result.event_id).toBe("string");
            expect(result.event_id).toMatch(/^evt_/);
            expect(typeof result.id).toBe("string");
            expect(result.id).toMatch(/^evt_/);
            expect(typeof result.at).toBe("string");
            expect(typeof result.timestamp).toBe("string");
            expect(typeof result.startTime).toBe("number");
            expect(typeof result.endTime).toBe("number");
        });

        it("normalizes timestamp format and preserves provided values", () => {
            const fixedDate = new Date("2025-01-15T10:30:00.000Z");
            vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2025-01-15T10:30:00.000Z");
            vi.spyOn(Date, "now").mockReturnValue(fixedDate.getTime());

            const entry = {
                at: "2024-06-01T12:00:00.000Z",
                timestamp: "2024-06-01T12:00:00.000Z",
                startTime: 1000,
                endTime: 2000,
                actor: "system",
                source: "api",
                status: "failed",
                error: "timeout",
                operationName: "search",
            };
            const result = OperationLog.normalizeAuditEntry(entry);

            // Provided values are preserved
            expect(result.at).toBe("2024-06-01T12:00:00.000Z");
            expect(result.timestamp).toBe("2024-06-01T12:00:00.000Z");
            expect(result.startTime).toBe(1000);
            expect(result.endTime).toBe(2000);
            expect(result.actor).toBe("system");
            expect(result.source).toBe("api");
            expect(result.status).toBe("failed");
            expect(result.error).toBe("timeout");

            // Defaults use ISO format when not provided
            const defaultResult = OperationLog.normalizeAuditEntry({});
            expect(defaultResult.at).toBe("2025-01-15T10:30:00.000Z");
            expect(defaultResult.timestamp).toBe("2025-01-15T10:30:00.000Z");

            vi.restoreAllMocks();
        });

        it("infers audit_event from operationName when not provided", () => {
            const result = OperationLog.normalizeAuditEntry({ operationName: "deletePage" });
            expect(result.audit_event).toBe("page.archived");
        });

        it("uses provided audit_event over inferred one", () => {
            const result = OperationLog.normalizeAuditEntry({
                operationName: "deletePage",
                audit_event: "custom.event",
            });
            expect(result.audit_event).toBe("custom.event");
        });

        it("defaults audit_event to operation.logged when no operationName", () => {
            const result = OperationLog.normalizeAuditEntry({});
            expect(result.audit_event).toBe("operation.logged");
        });
    });

    describe("collectRedactionHints", () => {
        it("identifies paths to sensitive fields in payload via pattern matching", () => {
            const context = {
                accessToken: "abc123",
                apiKey: "sk-xxx",
                client_secret: "ssh!",
                refreshToken: "rt-456",
                passphrase: "mypass",
                pageId: "pg-1",
            };
            const hints = OperationLog.collectRedactionHints(context);
            // Pattern-matched labels
            expect(hints).toContain("token");
            expect(hints).toContain("apiKey");
            expect(hints).toContain("clientSecret");
            expect(hints).toContain("refreshToken");
            expect(hints).toContain("passphrase");
            // ID key label
            expect(hints).toContain("target.id");
        });

        it("skips null or empty values", () => {
            const context = {
                accessToken: null,
                apiKey: "",
                secret: undefined,
                pageId: "pg-1",
            };
            const hints = OperationLog.collectRedactionHints(context);
            expect(hints).not.toContain("token");
            expect(hints).not.toContain("apiKey");
            expect(hints).toContain("target.id");
        });

        it("returns empty array for empty context", () => {
            expect(OperationLog.collectRedactionHints({})).toEqual([]);
            expect(OperationLog.collectRedactionHints()).toEqual([]);
        });

        it("does not duplicate labels", () => {
            const context = {
                accessToken: "a",
                refreshToken: "b",
                pageId: "pg",
                databaseId: "db",
            };
            const hints = OperationLog.collectRedactionHints(context);
            // "token" appears from accessToken and refreshToken patterns
            const tokenCount = hints.filter((h) => h === "token").length;
            expect(tokenCount).toBe(1);
            // "target.id" appears from pageId and databaseId
            const targetIdCount = hints.filter((h) => h === "target.id").length;
            expect(targetIdCount).toBe(1);
        });
    });

    describe("buildTarget", () => {
        it("constructs notion_block target from blockId", () => {
            const context = { blockId: "blk-1234567890", itemName: "My Block" };
            const result = OperationLog.buildTarget(context);
            expect(result.type).toBe("notion_block");
            expect(result.id).toBe("blk-…7890");
            expect(result.title).toBe("My Block");
        });

        it("constructs notion_page target from pageId", () => {
            const context = { pageId: "pg-1234567890", itemName: "My Page" };
            const result = OperationLog.buildTarget(context);
            expect(result.type).toBe("notion_page");
            expect(result.id).toBe("pg-1…7890");
            expect(result.title).toBe("My Page");
        });

        it("constructs notion_page target from parentPageId", () => {
            const context = { parentPageId: "parent-1234567890" };
            const result = OperationLog.buildTarget(context);
            expect(result.type).toBe("notion_page");
            expect(result.id).toBe("pare…7890");
        });

        it("constructs notion_database target from databaseId", () => {
            const context = { databaseId: "db-1234567890", itemName: "My DB" };
            const result = OperationLog.buildTarget(context);
            expect(result.type).toBe("notion_database");
            expect(result.id).toBe("db-1…7890");
            expect(result.title).toBe("My DB");
        });

        it("constructs notion_comment target from commentId", () => {
            const context = { commentId: "cmt-1234567890" };
            const result = OperationLog.buildTarget(context);
            expect(result.type).toBe("notion_comment");
        });

        it("returns generic target when only itemName is present", () => {
            const context = { itemName: "Some Item" };
            const result = OperationLog.buildTarget(context);
            expect(result.type).toBe("generic");
            expect(result.title).toBe("Some Item");
        });

        it("returns null when no identifying fields are present", () => {
            expect(OperationLog.buildTarget({})).toBe(null);
        });

        it("redacts short IDs to <redacted>", () => {
            const context = { pageId: "abc" };
            const result = OperationLog.buildTarget(context);
            expect(result.id).toBe("<redacted>");
        });
    });

    describe("buildPayload", () => {
        it("constructs audit payload from context", () => {
            const context = {
                query: "search term",
                content: "some content here",
                description: "a description",
                folderId: "folder-1234567890",
                targetType: "page",
                blockCount: 42,
                propertyNames: ["Title", "Tags", "Date", "Status", "Extra"],
            };
            const result = OperationLog.buildPayload(context);
            expect(result.query).toBe("search term");
            expect(result.contentPreview).toBe("some content here");
            expect(result.description).toBe("a description");
            expect(result.folderId).toBe("fold…7890"); // redacted via redactTargetId
            expect(result.targetType).toBe("page");
            expect(result.blockCount).toBe(42);
            expect(result.propertyNames).toEqual(["Title", "Tags", "Date", "Status", "Extra"]);
        });

        it("truncates long text fields to 120 characters", () => {
            const longText = "x".repeat(200);
            const context = { query: longText, content: longText, description: longText };
            const result = OperationLog.buildPayload(context);
            expect(result.query.length).toBeLessThanOrEqual(123); // 120 + "..."
            expect(result.query.endsWith("...")).toBe(true);
            expect(result.contentPreview.length).toBeLessThanOrEqual(123);
            expect(result.description.length).toBeLessThanOrEqual(123);
        });

        it("slices propertyNames to max 12 entries", () => {
            const names = Array.from({ length: 20 }, (_, i) => `Prop${i}`);
            const context = { propertyNames: names };
            const result = OperationLog.buildPayload(context);
            expect(result.propertyNames.length).toBe(12);
        });

        it("returns null when context yields no payload fields", () => {
            expect(OperationLog.buildPayload({})).toBe(null);
            expect(OperationLog.buildPayload({ irrelevantKey: "value" })).toBe(null);
        });
    });
});
