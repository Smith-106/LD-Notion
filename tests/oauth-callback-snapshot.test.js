import { describe, it, expect, beforeEach } from "vitest";

const { NotionOAuth } = require("../src/auth");

describe("OAuth callback snapshot (userscript SPA race)", () => {
    beforeEach(() => {
        NotionOAuth.clearCallbackSnapshot();
        NotionOAuth.clearPendingState();
    });

    it("captureCallbackSnapshot stores code/state from href", () => {
        const snap = NotionOAuth.captureCallbackSnapshot(
            "https://www.notion.so/?code=abc&state=xyz"
        );
        expect(snap).toMatchObject({ code: "abc", state: "xyz" });
        expect(NotionOAuth._callbackSnapshot.code).toBe("abc");
    });

    it("captureCallbackSnapshot ignores ordinary pages without code/error", () => {
        expect(NotionOAuth.captureCallbackSnapshot("https://www.notion.so/workspace")).toBeNull();
        expect(NotionOAuth._callbackSnapshot).toBeNull();
    });

    it("matchesRedirectUri treats trailing slash as equivalent on non-root paths", () => {
        expect(
            NotionOAuth.matchesRedirectUri(
                "https://example.com/oauth/cb?code=1",
                "https://example.com/oauth/cb/"
            )
        ).toBe(true);
    });
});
