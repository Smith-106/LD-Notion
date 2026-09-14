"use strict";

// 20260914: 浏览器书签整理器(写回)——「移动优先, 零删除」设计。
// 浏览器书签 remove 不可逆, 本模块只产出 ensureFolder/move 两类白名单操作
// (扩展桥接侧对其他 action 一律拒绝); 重复/失效书签一律移入「LD-Notion 整理/」
// 专用文件夹, 物理删除由用户在浏览器书签管理器手动完成。
// 安全链: scan(只读) → plan(纯数据, 可预览) → backup(全量 JSON 下载)
//        → UI 确认(ConfirmationDialog) → execute(OperationGuard 闸门 + OperationLog 审计)
//        → 撤销记录(原 parentId 持久化, undoLast 可回滚)。
// 仅 Chrome 扩展桥接模式可用(userscript 无浏览器书签写权限)。

const { OperationGuard, OperationLog } = require("../security");
const { Storage } = require("../storage");
const { Utils } = require("../utils");

// BookmarkBridge 经 lazy require 获取(解法②): ./index 顶层导出本模块, 顶层互引会
// 在循环加载期拿到 undefined —— 有状态跨模块对象一律运行时取用(AGENTS.md 循环依赖解法②)
const getBridge = () => require("./index").BookmarkBridge;

// 撤销记录存储键(经 CONFIG.STORAGE_KEYS 注册, 避免裸字符串分散)
const CONFIG_KEY_UNDO = require("../config").CONFIG.STORAGE_KEYS.BOOKMARK_ORGANIZE_UNDO;

// 整理根文件夹挂在「其他书签」(root children id=2; 1=书签栏), 减少对书签栏的侵入
const ORGANIZE_PARENT_ID = "2";
const ORGANIZE_ROOT_TITLE = "LD-Notion 整理";
const FOLDER_DUPLICATES = "重复书签";
const FOLDER_DEAD = "待清理失效";

const DEAD_LINK_CONCURRENCY = 5;
const DEAD_LINK_TIMEOUT_MS = 15000;
const DEAD_LINK_RETRY_BACKOFF_MS = 1000;
const DEAD_LINK_LIMIT = 500;      // 单次失效检测上限(全量检测耗时长, 超出部分标记未检测)
const AI_CLASSIFY_LIMIT = 50;     // 单次 AI 归类上限
const UNDO_MAX_ENTRIES = 5000;    // 撤销记录 FIFO 上限(AGENTS.md: 持久化键必须有界)

// —— GM 请求 Promise 封装(失效链接探测; HEAD 优先, 网络层错误降级 GET 重试一次) ——
function gmProbe(url, method, timeoutMs = DEAD_LINK_TIMEOUT_MS) {
    return new Promise((resolve) => {
        if (typeof GM_xmlhttpRequest === "undefined") {
            resolve({ ok: false, unreachable: true, error: "no-gm" });
            return;
        }
        GM_xmlhttpRequest({
            method,
            url,
            headers: { "User-Agent": "LD-Notion-Bookmark-Organizer/1.0" },
            timeout: timeoutMs,
            onload: (response) => resolve({ ok: response.status > 0 && response.status < 400, status: response.status }),
            onerror: () => resolve({ ok: false, unreachable: true }),
            ontimeout: () => resolve({ ok: false, unreachable: true, error: "timeout" }),
        });
    });
}

async function probeDeadLink(url) {
    // 1 次退避重试(仅网络层失败; HTTP 4xx/5xx 是确定性结论不重试)
    let first = await gmProbe(url, "HEAD");
    if (first.unreachable || first.error === "timeout") {
        await new Promise((r) => setTimeout(r, DEAD_LINK_RETRY_BACKOFF_MS));
        first = await gmProbe(url, "GET");
    }
    return first;
}

// 显式队列并发(AGENTS.md: remaining.shift() 替代共享 nextIndex++)
async function runQueue(items, worker, concurrency = DEAD_LINK_CONCURRENCY) {
    const remaining = items.slice();
    const runners = Array.from({ length: Math.min(concurrency, remaining.length) }, async () => {
        for (;;) {
            const item = remaining.shift();
            if (!item) return;
            await worker(item);
        }
    });
    await Promise.all(runners);
}

function walkTree(nodes, path, out) {
    for (const node of nodes || []) {
        // path 自包含(含自身标题): 文件夹节点 path = 祖先链 + 自身, 供顶层分类夹判定(depth===2)
        const selfPath = path ? path + "/" + (node.title || "") : (node.title || "");
        const entry = {
            id: node.id,
            title: node.title || "",
            url: node.url || "",
            dateAdded: node.dateAdded || 0,
            parentId: node.parentId || "",
            path: selfPath,
            isFolder: !node.url,
        };
        out.push(entry);
        if (node.children) {
            walkTree(node.children, selfPath, out);
        }
    }
    return out;
}

const BookmarkOrganizer = {
    ORGANIZE_ROOT_TITLE,
    FOLDER_DUPLICATES,
    FOLDER_DEAD,

    // —— 只读扫描: 重复书签 + 失效链接 + 根目录散落(AI 归类可选) ——
    // 返回 { tree, flat, plan }; plan.operations 可预览, 不含任何删除动作
    scan: async ({ checkDeadLinks = true, classifyWithAI = false } = {}) => {
        const BookmarkBridge = getBridge();
        const tree = await BookmarkBridge.getBookmarkTree();
        const flat = walkTree(tree, "", []);
        const bookmarks = flat.filter((n) => !n.isFolder && /^https?:\/\//i.test(n.url));

        // ① 重复: 同归一化 URL 取 dateAdded 最早为正本, 其余移入重复书签
        const byUrl = new Map();
        for (const node of bookmarks) {
            const key = Utils.normalizeDedupUrl(node.url);
            if (!byUrl.has(key)) byUrl.set(key, []);
            byUrl.get(key).push(node);
        }
        const duplicateGroups = [];
        const dupIds = new Set();
        for (const [, group] of byUrl) {
            if (group.length < 2) continue;
            const sorted = group.slice().sort((a, b) => (a.dateAdded - b.dateAdded) || String(a.id).localeCompare(String(b.id)));
            duplicateGroups.push({ url: sorted[0].url, keep: sorted[0], duplicates: sorted.slice(1) });
            for (const dup of sorted.slice(1)) dupIds.add(dup.id);
        }

        // ② 失效链接: 唯一 URL 探测(限量); 结论覆盖重复分类(dead > duplicate)
        const deadIds = new Set();
        let deadLinkChecked = 0;
        let deadLinkSkipped = 0;
        if (checkDeadLinks) {
            // 20260914: 判定键域统一 — 探测/查表与去重同用 normalized 键，
            // 否则 normalized 等价的重复 raw URL 会漏判失效(错归为重复书签)
            const uniqueUrls = [];
            const seenUrls = new Set();
            for (const node of bookmarks) {
                const key = Utils.normalizeDedupUrl(node.url);
                if (!seenUrls.has(key)) {
                    seenUrls.add(key);
                    uniqueUrls.push({ key, url: node.url });
                }
            }
            const toCheck = uniqueUrls.slice(0, DEAD_LINK_LIMIT);
            deadLinkSkipped = uniqueUrls.length - toCheck.length;
            const verdicts = new Map();
            await runQueue(toCheck, async (u) => {
                const verdict = await probeDeadLink(u.url);
                verdicts.set(u.key, verdict);
                deadLinkChecked++;
            });
            for (const node of bookmarks) {
                const verdict = verdicts.get(Utils.normalizeDedupUrl(node.url));
                if (verdict && !verdict.ok) deadIds.add(node.id);
            }
        }

        // ③ 根目录散落(仅顶层根的直接书签): AI 归类进既有顶层文件夹(可选, 失败静默跳过)
        const looseMoves = [];
        let aiNotice = "";
        if (classifyWithAI) {
            try {
                // classify 在 AIService 上(AIClassifier 仅有 classifyBatch); lazy require 避免测试/无 AI 场景加载 ai 层
                const { AIService, getAISettings } = require("../ai");
                const settings = getAISettings();
                if (settings && settings.aiApiKey) {
                    const rootIds = new Set(["1", "2"]);
                    const folderByTitle = new Map();
                    for (const n of flat) {
                        // 顶层分类夹: 根节点(parentId 0)的下一层 —— 即 path 深度 2 的文件夹
                        if (n.isFolder && n.parentId !== "0" && n.path.split("/").length === 2 && n.title) {
                            folderByTitle.set(n.title, n);
                        }
                    }
                    const categories = Array.from(folderByTitle.keys());
                    const loose = bookmarks.filter((n) => rootIds.has(String(n.parentId)) && !dupIds.has(n.id) && !deadIds.has(n.id));
                    const targets = loose.slice(0, AI_CLASSIFY_LIMIT);
                    const classified = [];
                    await runQueue(targets, async (node) => {
                        try {
                            const category = await AIService.classify(node.title || node.url, node.url, categories, settings);
                            const folder = category && folderByTitle.get(category);
                            if (folder && folder.id !== node.parentId) {
                                classified.push({ node, folderId: folder.id, folderTitle: folder.title });
                            }
                        } catch (_) { /* 单条失败不阻断整理 */ }
                    }, 3);
                    for (const c of classified) looseMoves.push(c);
                    if (loose.length > targets.length) {
                        aiNotice = `根目录散落书签共 ${loose.length} 条, 本轮仅归类前 ${targets.length} 条`;
                    }
                } else {
                    aiNotice = "未配置 AI Key, 跳过归类(可在 AI 设置中配置后重试)";
                }
            } catch (error) {
                aiNotice = `AI 归类不可用, 已跳过: ${String(error?.message || error).slice(0, 80)}`;
            }
        }

        // —— 汇成 plan: 单书签单操作; 分类优先级 dead > duplicate > loose ——
        const operations = [];
        const undoRecords = [];
        const moveOp = (node, parentIdRef, reason) => {
            operations.push({ action: "move", id: node.id, parentIdRef, reason });
            undoRecords.push({ id: node.id, fromParentId: node.parentId, reason });
        };
        let deadCount = 0;
        let dupCount = 0;
        const deadAll = new Set(deadIds);
        for (const node of bookmarks) {
            if (deadAll.has(node.id)) {
                moveOp(node, "folder-dead", "失效链接");
                deadCount++;
            } else if (dupIds.has(node.id)) {
                moveOp(node, "folder-dup", "重复书签");
                dupCount++;
            }
        }
        if (operations.length > 0 || classifyWithAI) {
            operations.unshift(
                { action: "ensureFolder", ref: "organize-root", parentId: ORGANIZE_PARENT_ID, title: ORGANIZE_ROOT_TITLE },
                { action: "ensureFolder", ref: "folder-dup", parentIdRef: "organize-root", title: FOLDER_DUPLICATES },
                { action: "ensureFolder", ref: "folder-dead", parentIdRef: "organize-root", title: FOLDER_DEAD },
            );
        }
        for (const c of looseMoves) {
            operations.push({ action: "move", id: c.node.id, parentId: c.folderId, reason: "AI归类:" + c.folderTitle });
            undoRecords.push({ id: c.node.id, fromParentId: c.node.parentId, reason: "AI归类:" + c.folderTitle });
        }

        const plan = {
            createdAt: new Date().toISOString(),
            checkDeadLinks,
            classifyWithAI,
            aiNotice,
            deadLinkChecked,
            deadLinkSkipped,
            duplicateGroupsCount: duplicateGroups.length,
            deadCount,
            dupCount,
            looseCount: looseMoves.length,
            undoRecords,
            operations,
            preview: {
                duplicates: duplicateGroups.slice(0, 10).map((g) => `${g.duplicates.length} 个重复 ← ${Utils.truncateText(g.url, 60)}`),
                dead: bookmarks.filter((n) => deadIds.has(n.id)).slice(0, 10).map((n) => Utils.truncateText((n.title || n.url), 60)),
                loose: looseMoves.slice(0, 10).map((c) => `${Utils.truncateText(c.node.title || c.node.url, 40)} → ${c.folderTitle}`),
            },
            tree,
        };
        return { tree, flat, plan };
    },

    // —— 全量备份: JSON 下载(执行任何写操作前必须先备份) ——
    backup: (tree) => {
        const payload = {
            kind: "ld-notion-bookmark-backup",
            version: 1,
            exportedAt: new Date().toISOString(),
            tree,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
        a.href = url;
        a.download = `ldb-bookmark-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        return `ldb-bookmark-backup-${stamp}.json`;
    },

    // —— 执行(Guard 闸门 + 审计 + 撤销记录持久化; UI 层负责执行前确认) ——
    execute: async (plan) => {
        if (!OperationGuard.canExecute("bookmarks.organize")) {
            OperationLog.add({
                operation: "bookmarks.organize",
                phase: "execute",
                allowed: false,
                detail: { reason: "permission-denied", moves: (plan.undoRecords || []).length },
            });
            throw new Error("权限不足: 书签整理需要「高级」权限（设置 → 安全 → 权限等级 ≥ 2）");
        }
        if (!plan || !Array.isArray(plan.operations)) throw new Error("整理计划无效");

        const backupFile = BookmarkOrganizer.backup(plan.tree);

        const BookmarkBridge = getBridge();
        const results = await BookmarkBridge.organizeBookmarks(plan.operations, { timeoutMs: 60000 });
        const failed = (results || []).filter((r) => r && r.ok === false);
        const movedCount = (results || []).filter((r) => r && r.action === "move" && r.ok).length;

        // 撤销记录持久化(FIFO 上限): 仅记录成功 move 的原 parentId
        const successIds = new Set((results || []).filter((r) => r && r.action === "move" && r.ok).map((r) => r.id));
        const prev = Storage.get(CONFIG_KEY_UNDO, []);
        const merged = (Array.isArray(prev) ? prev : [])
            .concat((plan.undoRecords || []).filter((u) => successIds.has(u.id)));
        Storage.set(CONFIG_KEY_UNDO, merged.slice(-UNDO_MAX_ENTRIES));

        OperationLog.add({
            operation: "bookmarks.organize",
            phase: "execute",
            allowed: true,
            detail: { moved: movedCount, failed: failed.length, backupFile },
        });

        return { backupFile, movedCount, failedCount: failed.length, failed: failed.slice(0, 10) };
    },

    // —— 撤销上次整理: 按持久化记录把书签移回原文件夹 ——
    undoLast: async () => {
        const records = Storage.get(CONFIG_KEY_UNDO, []);
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error("没有可撤销的整理记录");
        }
        if (!OperationGuard.canExecute("bookmarks.organize")) {
            throw new Error("权限不足: 书签整理需要「高级」权限（设置 → 安全 → 权限等级 ≥ 2）");
        }
        const operations = records.map((r) => ({ action: "move", id: r.id, parentId: r.fromParentId, reason: "undo" }));
        const BookmarkBridge = getBridge();
        const results = await BookmarkBridge.organizeBookmarks(operations, { timeoutMs: 60000 });
        const movedCount = (results || []).filter((r) => r && r.action === "move" && r.ok).length;
        Storage.set(CONFIG_KEY_UNDO, []);
        OperationLog.add({
            operation: "bookmarks.organize",
            phase: "execute",
            allowed: true,
            detail: { undo: true, moved: movedCount },
        });
        return { movedCount };
    },

    getUndoCount: () => {
        const records = Storage.get(CONFIG_KEY_UNDO, []);
        return Array.isArray(records) ? records.length : 0;
    },
};

module.exports = { BookmarkOrganizer };
