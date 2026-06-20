# SyncState V1/V2 迁移

v3.7.0 完成了 SyncState 从 V1 嵌套结构到 V2 扁平结构的迁移，消除了 V1/V2 双写问题，并引入 V1 facade 保证向后兼容。

## 为什么要迁移

旧版 SyncState 使用嵌套结构存储同步状态：

```text
V1: { linuxdo: {...}, github: { meta, stars, repos, forks, gists }, bookmarks: {...} }
```

这带来了两个问题：

1. **V1/V2 双写**：新代码写 V2 格式，旧代码仍写 V1 格式，导致数据不一致。
2. **GitHub 子类型嵌套**：`github.stars`、`github.repos` 等子类型嵌套在同一对象下，无法独立管理同步周期。

## V2 扁平结构

V2 将所有来源类型展平为独立 key：

```text
V2: { version: 2, sources: { linuxdo: {...}, github-stars: {...}, github-repos: {...}, github-forks: {...}, github-gists: {...}, github-meta: {...}, bookmark: {...}, rss: {...}, zhihu: {...}, generic: {...} } }
```

每个来源类型独立管理自己的 `lastSyncTime`、`lastSyncCount`、`lastError` 等字段。

## 自动迁移

首次访问时，`SyncStateV2._load()` 检测到 V1 数据后自动执行 `_migrateV1toV2()`：

- 将 `github.meta/stars/repos/forks/gists` 展平为 `github-meta/github-stars/...`。
- 将 `bookmarks` 重命名为 `bookmark`（单数形式，与其他来源类型一致）。
- 迁移是幂等的，重复执行不会产生副作用。

## V1 facade

为了消除双写，V1 的公共 API 被替换为 V2 的 facade 代理层。所有现有代码调用 `SyncState.getLinuxDoState()`、`SyncState.updateGitHubState()` 等方法时，实际委托给 `SyncStateV2`：

```text
SyncState.getLinuxDoState() → SyncStateV2.getSourceState("linuxdo")
SyncState.updateGitHubState(subtype, data) → SyncStateV2.updateSourceState("github-" + subtype, data)
```

这样，旧代码无需修改即可自动使用 V2 存储。

## 写入优化

### queueMicrotask 合并

`SyncStateV2._save()` 使用 `queueMicrotask` 将同一事件循环 tick 内的多次写入合并为一次 `GM_setValue` 调用，减少 IPC 开销。回退链：`queueMicrotask` → `setTimeout(flush, 0)` → 同步写入。

### DedupStore 批量模式

`DedupStore` 支持 `beginBatch(sourceType)` / `endBatch()` 批量模式。批量模式下，`isDuplicate` 和 `markSeen` 只操作内存缓存，`endBatch()` 时一次性写入 `GM_setValue`。`SyncCoordinator.sync()` 在同步循环中使用批量模式，避免每条记录都触发 IPC。

## 遗留问题

V1 facade 代理了 V2 的私有方法（`_clone`、`_load`、`_save`），破坏了封装。外部代码可能通过 V1 facade 访问 V2 内部实现。建议：

1. 移除 V1 facade 中对 V2 私有方法的代理。
2. 将需要外部访问的方法提升为 V2 的公共 API。
3. 或将 V1 facade 标记为 `@deprecated`，引导调用方迁移到 V2。
