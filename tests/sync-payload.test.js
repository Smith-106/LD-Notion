"use strict";

// SyncPayload merge 三性(semilattice) + epoch/watermark/settings 语义契约
import { describe, it, expect } from "vitest";
const { SyncPayload } = require("../src/sync/SyncPayload");

const base = () => ({
    schemaVersion: 1,
    deviceId: "dev-a",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    dedup: { linuxdo: { "1": 100, "2": 200 } },
    watermarks: { linuxdo: { epoch: 0, time: "2026-01-01T00:00:00.000Z", ids: ["1"] } },
    settings: { theme: { value: "dark", updatedAt: "2026-01-01T00:00:00.000Z", deviceId: "dev-a" } },
});

// 确定性伪随机(避免 Math.random 被禁用)
let seed = 42;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

const randomPayload = (i) => {
    const p = base();
    p.deviceId = `dev-${i % 3}`;
    p.updatedAt = new Date(1700000000000 + i * 1000).toISOString();
    p.dedup = {
        linuxdo: {},
        bookmark: {},
    };
    for (let k = 0; k < 5; k++) {
        const src = k % 2 === 0 ? "linuxdo" : "bookmark";
        p.dedup[src][`key${rnd(8)}`] = 1700000000000 + rnd(10000);
    }
    p.watermarks = {
        linuxdo: { epoch: rnd(3), time: new Date(1700000000000 + rnd(10000)).toISOString(), ids: ["a", "b"] },
    };
    p.settings = {
        theme: { value: rnd(2) ? "dark" : "light", updatedAt: new Date(1700000000000 + rnd(10000)).toISOString(), deviceId: p.deviceId },
    };
    return p;
};

describe("SyncPayload.merge 三性", () => {
    it("交换律 merge(a,b) = merge(b,a)", () => {
        for (let i = 0; i < 100; i++) {
            const a = randomPayload(i);
            const b = randomPayload(i + 500);
            expect(SyncPayload.merge(a, b)).toEqual(SyncPayload.merge(b, a));
        }
    });

    it("结合律 merge(merge(a,b),c) = merge(a,merge(b,c))", () => {
        for (let i = 0; i < 50; i++) {
            const a = randomPayload(i);
            const b = randomPayload(i + 200);
            const c = randomPayload(i + 400);
            expect(SyncPayload.merge(SyncPayload.merge(a, b), c))
                .toEqual(SyncPayload.merge(a, SyncPayload.merge(b, c)));
        }
    });

    it("幂等 merge(a,a) = a", () => {
        for (let i = 0; i < 50; i++) {
            const a = randomPayload(i + 1000);
            expect(SyncPayload.merge(a, a)).toEqual(a);
        }
    });

    it("null/undefined 视为空", () => {
        const a = base();
        expect(SyncPayload.merge(a, null)).toEqual(a);
        expect(SyncPayload.merge(null, a)).toEqual(a);
        expect(SyncPayload.merge(null, null)).toEqual({});
    });

    it("schema 不匹配 throw", () => {
        const a = base();
        const b = base();
        b.schemaVersion = 2;
        expect(() => SyncPayload.merge(a, b)).toThrow(/schema/);
    });
});

describe("SyncPayload dedup union + max", () => {
    it("同 key 取大 ts, 不同 key 并集", () => {
        const a = base();
        const b = base();
        b.dedup.linuxdo["1"] = 999; // 更大
        b.dedup.linuxdo["3"] = 300; // 新增
        const m = SyncPayload.merge(a, b);
        expect(m.dedup.linuxdo["1"]).toBe(999);
        expect(m.dedup.linuxdo["2"]).toBe(200);
        expect(m.dedup.linuxdo["3"]).toBe(300);
    });
});

describe("SyncPayload watermarks (epoch, time) 全序", () => {
    it("epoch 大者整段胜出(即使 time 更旧)", () => {
        const a = base();
        const b = base();
        b.watermarks.linuxdo = { epoch: 1, time: "2020-01-01T00:00:00.000Z", ids: ["x"] };
        const m = SyncPayload.merge(a, b);
        expect(m.watermarks.linuxdo.epoch).toBe(1);
        expect(m.watermarks.linuxdo.ids).toEqual(["x"]);
    });

    it("epoch 相等比 time, 大者胜出", () => {
        const a = base();
        const b = base();
        b.watermarks.linuxdo = { epoch: 0, time: "2027-01-01T00:00:00.000Z", ids: ["x"] };
        const m = SyncPayload.merge(a, b);
        expect(m.watermarks.linuxdo.time).toBe("2027-01-01T00:00:00.000Z");
    });

    it("同刻 ids 并集", () => {
        const a = base();
        const b = base();
        b.watermarks.linuxdo = { epoch: 0, time: "2026-01-01T00:00:00.000Z", ids: ["2"] };
        const m = SyncPayload.merge(a, b);
        expect(m.watermarks.linuxdo.ids.sort()).toEqual(["1", "2"]);
    });
});

describe("SyncPayload settings LWW", () => {
    it("updatedAt 决胜", () => {
        const a = base();
        const b = base();
        b.settings.theme = { value: "light", updatedAt: "2026-02-01T00:00:00.000Z", deviceId: "dev-b" };
        const m = SyncPayload.merge(a, b);
        expect(m.settings.theme.value).toBe("light");
    });

    it("同 updatedAt deviceId 字典序平局决胜(确定性)", () => {
        const a = base();
        const b = base();
        b.settings.theme = { value: "light", updatedAt: "2026-01-01T00:00:00.000Z", deviceId: "dev-b" };
        const m = SyncPayload.merge(a, b);
        expect(m.settings.theme.value).toBe("light"); // dev-b > dev-a
        expect(SyncPayload.merge(b, a).settings.theme.value).toBe("light");
    });
});

describe("SyncPayload.diffWinners", () => {
    it("只返回本地缺失/落后的胜出项", () => {
        const local = base();
        const remote = base();
        remote.dedup.linuxdo["9"] = 900;
        remote.dedup.linuxdo["2"] = 250; // 本地 200 → 胜出
        remote.watermarks.linuxdo = { epoch: 1, time: "2027-01-01T00:00:00.000Z", ids: ["9"] };
        remote.settings.theme = { value: "light", updatedAt: "2026-03-01T00:00:00.000Z", deviceId: "dev-b" };
        const winners = SyncPayload.diffWinners(local, remote);
        expect(winners.dedupEntries).toContainEqual({ source: "linuxdo", key: "9", ts: 900 });
        expect(winners.dedupEntries).toContainEqual({ source: "linuxdo", key: "2", ts: 250 });
        expect(winners.dedupEntries).toHaveLength(2);
        expect(winners.watermarkWinners).toEqual([{ source: "linuxdo", watermark: { epoch: 1, time: "2027-01-01T00:00:00.000Z", ids: ["9"] } }]);
        expect(winners.settingsWinners).toEqual([{ key: "theme", entry: { value: "light", updatedAt: "2026-03-01T00:00:00.000Z", deviceId: "dev-b" } }]);
    });

    it("本地已领先时无胜出项", () => {
        const local = base();
        local.watermarks.linuxdo = { epoch: 2, time: "2028-01-01T00:00:00.000Z", ids: ["z"] };
        const remote = base();
        const winners = SyncPayload.diffWinners(local, remote);
        expect(winners.dedupEntries).toEqual([]);
        expect(winners.watermarkWinners).toEqual([]);
        expect(winners.settingsWinners).toEqual([]);
    });
});

describe("SyncPayload.buildFromLocal", () => {
    it("构建结构正确的 payload", () => {
        const p = SyncPayload.buildFromLocal({
            deviceId: "dev-x",
            now: 1700000000000,
            dedupSets: { linuxdo: { "1": 100 } },
            watermarks: { rss: { epoch: 0, time: "2026-01-01T00:00:00.000Z", ids: ["a"] } },
            settings: { theme: { value: "dark", updatedAt: "2026-01-01T00:00:00.000Z" } },
        });
        expect(p.schemaVersion).toBe(1);
        expect(p.dedup.linuxdo).toEqual({ "1": 100 });
        expect(p.watermarks.rss.epoch).toBe(0);
        expect(p.settings.theme.deviceId).toBe("dev-x");
    });
});
