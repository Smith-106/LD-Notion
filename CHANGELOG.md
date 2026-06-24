# 更新日志

## [3.7.4] - 2026-06-24

### 修复

- **循环依赖消除**：将 `UrlValidator` 从 `src/security/index.js` 提取到独立模块 `src/security/UrlValidator.js`，消除 `src/api/index.js` ↔ `src/security/index.js` circular dependency，测试输出中相关警告消失
- **XSS 防护**：`src/export/index.js` 的 `post.cooked` 文本提取改用 `DOMParser` 解析后读取 `textContent`，避免直接 `innerHTML` 赋值不可信 HTML
- **Extension SSRF 加固**：background service worker 的 URL 白名单校验增加协议检查，非本地地址必须使用 `https:` 协议和默认 443 端口
- **弱随机数消除**：`src/api/index.js` 的 multipart boundary 和 `src/ui/events.js` 的 Obsidian 图片文件名均改用 `crypto.getRandomValues` 生成
- **并发安全**：`Exporter.exportBookmarks` 的 worker 调度改用显式任务队列 `remaining.shift()`，替代共享 `nextIndex++`
- **变量作用域修复**：`src/ui/main-ui.js` 补充声明 `const provider = AIService.PROVIDERS[aiService]`，避免使用未声明变量
- **空 catch 块补日志**：`src/bridge/BookmarkExporter.js` 和 `src/ai/index.js` 中的空 catch 块统一添加 `console.warn` 日志，保留原有回退行为

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.4`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建

[3.7.4]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.4

## [3.7.3] - 2026-06-22

### 修复

- 并发：`Exporter.exportBookmarks` 和 `AutoImporter.run` 的并发 worker `nextIndex` 改为 `++nextIndex` 原子操作，消除 race condition（COR-001/COR-002）
- 正确性：`BookmarkAutoImporter.processBookmark`/`processDeleted` 参数名 `index` shadow 外层页索引对象，重命名为 `itemIndex`（COR-015/COR-016）
- 正确性：`DedupStore.clearSeen` 在 batch 模式下无条件执行 `GM_deleteValue`，加 `return` 跳过（COR-003）
- 正确性：`DOMToNotion` 表格空行 `Math.max()` 返回 `-Infinity`，加 `Math.max(1, ...)` 下限（COR-018）
- 正确性：`ObsidianAPI` 三个方法缺少 `timeout`/`ontimeout`，请求挂起（COR-019）
- 最佳实践：`UndoManager.hideToast` 未清理旧 `setTimeout`，新 toast 被误删（BP-015）
- 最佳实践：`bridge/index.js` 用 `var` 声明构建标记，改为 `const`（BP-003）
- 最佳实践：`SyncState.buildWatermark` 用 `Array.includes` O(n²) 改为 `Set.has` O(1)（BP-012）

### 安全

- **API key 泄露防护**：新增 `UrlValidator` 工具
  - AI 请求 `baseUrl` 白名单校验（`api.openai.com`/`api.anthropic.com`/`generativelanguage.googleapis.com`）或 HTTPS 非内网域名
  - Obsidian API URL 仅允许本地地址（`127.0.0.1`/`localhost`/`::1`）
  - `_isPrivateHost` 拦截 `10.x`/`172.16-31.x`/`192.168.x`/`169.254.x` 私有网段（SEC-001/SEC-002）
- OAuth state token `Math.random()` 回退改为抛出错误，强制使用 `crypto.getRandomValues`（SEC-005）
- `OperationLog` event ID 从 `Math.random()` 改为 `crypto.getRandomValues`（SEC-015）
- `apiKeyHash` 从直接截取后 8 位改为 djb2 hash，避免部分暴露 API key（SEC-011）

### 重构

- **UI 模块拆分**：`src/ui/index.js`（~9700 行）拆分为 8 个独立模块 + re-export 入口
  - `ui/style-manager.js` / `ui/design-system.js` / `ui/panel-resize.js`
  - `ui/notion-site-ui.js` / `ui/styles.js` / `ui/events.js`
  - `ui/main-ui.js` / `ui/generic-ui.js`
- **超长方法拆分**：
  - `GitHubAutoImporter.run`（287 行 → 50 行）拆为 5 个私有方法（MNT-001）
  - `RSSAutoImporter.run`（195 行 → 60 行）拆为 3 个私有方法（MNT-002）
  - `DOMToNotion.cookedToBlocks`（290 行 → 90 行）拆为 13 个元素处理器（MNT-003）
- **AI 模块分区**：`src/ai/index.js`（~7000 行）添加 7 个分区注释，因深度交叉依赖暂无法物理拆分

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.3`
- `AIService` 8 处 baseUrl 标准化合并为 `_normalizeBaseUrl`，内置 URL 安全校验

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建
- 代码质量审查 85 个 findings，15 个已修复（2 critical, 5 high, 6 medium, 2 low）

[3.7.3]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.3

## [3.7.2] - 2026-06-20

### 修复

- 安全：`showStatus` 两处 `innerHTML` 注入加 `Utils.escapeHtml` 防 XSS
- 安全：Obsidian 测试状态 `innerHTML` 加 `escapeHtml`
- 健壮性：`showProgress` `total=0` 时 percent 归零而非 NaN（除零防护）
- 健壮性：`showStatus` 加 `clearTimeout` 防新消息被旧定时器清除
- 防重入：`exportBtn`/`obsExportBtn` 加 `disabled` 防双击
- DOM 爆炸：失败项截断 20 条 + 错误文本截断 120 字符
- CSS：27 处双 `class=""` 合并为单一 class 属性
- CSS：添加 `.ldb-report-*` 7 个缺失类定义
- 响应式：三面板加 `max-width: calc(100vw - 32px)`
- Token：添加 `--ldb-ui-badge-teal/blue` 替代硬编码色值
- 可访问性：6 个 `toggle-section` 加 `aria-expanded`/`aria-controls`/`role`/`tabindex`/keyboard
- 可访问性：tab 面板加 `role=tablist/tab/tabpanel` + `aria-selected`

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.2`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建
- 10/10 critical findings 已修复

[3.7.2]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.2

## [3.7.1] - 2026-06-18

### 修复

- 性能：优化工作区可视化模型构建，将 `databases.find` 改为 `databasesMap.get`，合并多次 `records.forEach` 为单次遍历，减少大工作区下的 CPU 开销
- 代码质量：同步更新 `src/ui/index.js` 与根目录 `.user.js` 对应实现

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.1`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `npm run verify:delivery`：构建、扩展、等价性、UI 静态验证全部通过
- `node --check LinuxDo-Bookmarks-to-Notion.user.js`：语法检查通过

[3.7.1]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.1

## [3.7.0] - 2026-06-17

### 新增

- 扩展测试覆盖率：新增 263 个用例，覆盖 SyncStateV2、DedupStore、Config、OperationLog、AIService、RSS/Atom 解析、GitHub/书签/通用导出等 17 个模块，总计 349/349 用例通过，收敛判定 PASS，置信度 0.85
- 交付前 13 维度检查：覆盖需求、测试有效性、回归、代码质量、异常处理、安全、性能、兼容性、数据迁移、部署、监控/日志、回滚、文档/交接

### 修复

- 安全：收紧 Userscript 权限域，将 `@match *://*/*` 与 `@connect *` 替换为显式域名与 `@include` 正则白名单，降低横向请求风险
- 架构：完成 P1 架构升级，消除 SyncState V1/V2 双写，引入 V1→V2 facade 迁移与 SyncLock 解决 `export`↔`bridge` 循环依赖
- 性能：修复 PERF-004，`DedupStore` 批量模式改为 `queueMicrotask` 防抖写入，减少 GM_setValue IPC 次数
- 代码质量：拆分 god module，修复 COR-008/COR-012/SEC-006 遗漏项；删除 dead code (`src/ui/SyncSettings.js`)，清理未使用导入与重复对象键

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.0`
- `package-lock.json` 同步更新 `esbuild@^0.28.1` 与 `vitest@^4.1.8`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建
- `node --check LinuxDo-Bookmarks-to-Notion.user.js`：语法检查通过

[3.7.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.0
