---
type: note
slug: harvest-debug-exported-topics-growth
title: Exported Topics集合无限增长（已修复）
tags: performance, storage, resolved
source: DBG-001
source_type: debug
date: 2026-06-13
resolved: 2026-07-31
---

~~EXPORTED_TOPICS 集合只增不减（Storage.markTopicExported() 只添加不清理），长时间使用后 GM_setValue 可能超限。~~

**已修复** (v3.7.9+): 所有已处理/已导出集合统一加入 90 天 TTL 淡汰机制：
- `DedupStore.endBatch()` 调用 `_evictExpired()` 清理过期条目
- `GitHubAPI.flushExported/flushGistsExported` 同模式
- `BookmarkExporter.flushExported` 同模式
- 日志/历史类数组用 MAX_ENTRIES 截断（OPERATION_LOG=100、CHAT_HISTORY=50）

参照 spec: S-20260731-k3tv（持久化存储键必须有TTL或容量上限）。
