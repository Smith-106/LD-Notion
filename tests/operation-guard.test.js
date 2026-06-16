import { describe, it, expect, beforeEach, vi } from "vitest";
import { OperationGuard } from "../src/security/index.js";

describe("OperationGuard", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    describe("OPERATION_LEVELS", () => {
        it("defines readonly operations at level 0", () => {
            expect(OperationGuard.OPERATION_LEVELS.search).toBe(0);
            expect(OperationGuard.OPERATION_LEVELS.fetchPage).toBe(0);
            expect(OperationGuard.OPERATION_LEVELS.fetchBlocks).toBe(0);
            expect(OperationGuard.OPERATION_LEVELS.fetchDatabase).toBe(0);
            expect(OperationGuard.OPERATION_LEVELS.queryDatabase).toBe(0);
            expect(OperationGuard.OPERATION_LEVELS.getUsers).toBe(0);
            expect(OperationGuard.OPERATION_LEVELS.getSelf).toBe(0);
            expect(OperationGuard.OPERATION_LEVELS.getUser).toBe(0);
        });

        it("defines standard operations at level 1", () => {
            expect(OperationGuard.OPERATION_LEVELS.createDatabasePage).toBe(1);
            expect(OperationGuard.OPERATION_LEVELS.updatePage).toBe(1);
            expect(OperationGuard.OPERATION_LEVELS.updateBlock).toBe(1);
            expect(OperationGuard.OPERATION_LEVELS.appendBlocks).toBe(1);
            expect(OperationGuard.OPERATION_LEVELS.updatePageMarkdown).toBe(1);
            expect(OperationGuard.OPERATION_LEVELS.updateDatabase).toBe(1);
            expect(OperationGuard.OPERATION_LEVELS.createComment).toBe(1);
        });

        it("defines advanced operations at level 2", () => {
            expect(OperationGuard.OPERATION_LEVELS.movePage).toBe(2);
            expect(OperationGuard.OPERATION_LEVELS.duplicatePage).toBe(2);
            expect(OperationGuard.OPERATION_LEVELS.createDatabase).toBe(2);
            expect(OperationGuard.OPERATION_LEVELS.replacePageMarkdown).toBe(2);
            expect(OperationGuard.OPERATION_LEVELS.deletePage).toBe(2);
            expect(OperationGuard.OPERATION_LEVELS.restorePage).toBe(2);
            expect(OperationGuard.OPERATION_LEVELS.deleteBlock).toBe(2);
            expect(OperationGuard.OPERATION_LEVELS.agentTask).toBe(2);
        });
    });

    describe("canExecute", () => {
        it("allows readonly ops at level 0", () => {
            const origGetLevel = OperationGuard.getLevel;
            OperationGuard.getLevel = () => 0;
            try {
                expect(OperationGuard.canExecute("search")).toBe(true);
                expect(OperationGuard.canExecute("fetchPage")).toBe(true);
                expect(OperationGuard.canExecute("createDatabasePage")).toBe(false);
                expect(OperationGuard.canExecute("deletePage")).toBe(false);
            } finally {
                OperationGuard.getLevel = origGetLevel;
            }
        });

        it("allows standard ops at level 1", () => {
            const origGetLevel = OperationGuard.getLevel;
            OperationGuard.getLevel = () => 1;
            try {
                expect(OperationGuard.canExecute("search")).toBe(true);
                expect(OperationGuard.canExecute("createDatabasePage")).toBe(true);
                expect(OperationGuard.canExecute("updatePage")).toBe(true);
                expect(OperationGuard.canExecute("movePage")).toBe(false);
                expect(OperationGuard.canExecute("deletePage")).toBe(false);
            } finally {
                OperationGuard.getLevel = origGetLevel;
            }
        });

        it("allows all ops at level 2 (advanced)", () => {
            const origGetLevel = OperationGuard.getLevel;
            OperationGuard.getLevel = () => 2;
            try {
                expect(OperationGuard.canExecute("search")).toBe(true);
                expect(OperationGuard.canExecute("createDatabasePage")).toBe(true);
                expect(OperationGuard.canExecute("deletePage")).toBe(true);
                expect(OperationGuard.canExecute("agentTask")).toBe(true);
            } finally {
                OperationGuard.getLevel = origGetLevel;
            }
        });

        it("allows all ops at level 3 (admin)", () => {
            const origGetLevel = OperationGuard.getLevel;
            OperationGuard.getLevel = () => 3;
            try {
                expect(OperationGuard.canExecute("search")).toBe(true);
                expect(OperationGuard.canExecute("deletePage")).toBe(true);
                expect(OperationGuard.canExecute("deleteBlock")).toBe(true);
            } finally {
                OperationGuard.getLevel = origGetLevel;
            }
        });

        it("denies undefined operations (default deny)", () => {
            const origGetLevel = OperationGuard.getLevel;
            OperationGuard.getLevel = () => 3;
            try {
                expect(OperationGuard.canExecute("nonExistentOp")).toBe(false);
                expect(console.warn).toHaveBeenCalledWith(
                    expect.stringContaining("未定义权限级别")
                );
            } finally {
                OperationGuard.getLevel = origGetLevel;
            }
        });
    });

    describe("DANGEROUS_OPERATIONS", () => {
        it("marks deletePage and deleteBlock as dangerous", () => {
            expect(OperationGuard.DANGEROUS_OPERATIONS).toContain("deletePage");
            expect(OperationGuard.DANGEROUS_OPERATIONS).toContain("deleteBlock");
        });

        it("does not mark safe operations as dangerous", () => {
            expect(OperationGuard.DANGEROUS_OPERATIONS).not.toContain("search");
            expect(OperationGuard.DANGEROUS_OPERATIONS).not.toContain("updatePage");
            expect(OperationGuard.DANGEROUS_OPERATIONS).not.toContain("createDatabasePage");
        });

        it("isDangerous returns correct results", () => {
            expect(OperationGuard.isDangerous("deletePage")).toBe(true);
            expect(OperationGuard.isDangerous("deleteBlock")).toBe(true);
            expect(OperationGuard.isDangerous("search")).toBe(false);
            expect(OperationGuard.isDangerous("updatePage")).toBe(false);
        });
    });
});
