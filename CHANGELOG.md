# 更新日志

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
