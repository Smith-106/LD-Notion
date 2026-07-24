# 更新日志

## [3.7.8] - 2026-07-24

### 新增（安全加固 — ISS-20260723-009, CWE-94/918）

**AI 输出 schema 校验层** — AI 返回的属性名/值/URL 直接写入 Notion，prompt injection 可经 AI 输出写入恶意 URL 或异常属性，本次统一校验：

- **新增 `src/ai/schema.js`（AISchema 校验层）**：
  - `validatePageExternalUrl`（转发 UrlValidator，SSRF 防御）
  - `validatePropertyName`（白名单 [中英数字+下划线/连字符/空格] + 截断 ≤64 + 拒 Notion 保留名 title/created_time/last_edited_time/created_by/last_edited_by/url/path/Name）
  - `validatePropertyType`（类型白名单，拒 relation/people/files 等系统关联字段）
  - `validatePropertyValue`（title/rich_text ≤2000、select ≤100、number isFinite+|v|<1e15、date ISO8601、checkbox Boolean）
  - `validateEmoji`（≤32 + 拒控制字符）
  - `sanitizeObjectValue`（对象值白名单，拒 relation/people/created_by/created_time/last_edited_time 等系统字段）
  - `validateExtractToDatabaseSchema`（properties/entries 需 Array，非数组返明确 reason，不再 TypeError 被吞）
  - `parseAIJson`（统一入口：正则提取 + JSON.parse + 按 name 路由校验，消除 7 消费点重复 `jsonMatch+JSON.parse+try-catch` 三段式，为 ai/index.js 拆分 ISS-010 预留接缝）

- **`src/security/UrlValidator.js` 新增 `validatePageExternalUrl`**：http(s) 协议（拒 javascript:/data:/file:）+ `_isPrivateHost` 拒 10.x/172.16-31/192.168/169.254/127/localhost。防 Notion 服务端抓取 external.url 触发云元数据 SSRF（169.254.169.254）

- **`src/ai/index.js` 7 消费点接入**：`_buildPageIconPayload`/`_buildPageCoverPayload`（icon/cover URL + emoji 校验，非法跳过字段）；`_normalizeNotionProperties`（属性名 + 对象值白名单 + number isFinite + rich_text 截断）；`_buildPropertyValuePayload`（按 type 校验值）；`handleExtractToDatabase`（parseAIJson 统一入口 + 属性名/类型校验 + failedCount 回显）；`parseIntent`（intent 白名单 + compound steps 上限 20）；`handleEditContent`（content_updates old_str/new_str 结构校验，非法进 fallbackReason）

### 修复（sibling — S_GENERALIZE 发现，cross-phase loop）

**DOMToNotion SSRF sibling（CWE-918）**：`src/api/index.js` 的 `DOMToNotion` 7 处 external.url 消费点（`_cookLightbox`/`_cookAttachment`/`_cookVideo`/`_cookAudio`/`_cookImage`/`_cookParagraph` 内 img+attachment）把 `full = Utils.absoluteUrl(帖子 HTML 的 src/href)` 直写 Notion `external.url`。帖子作者可写 `<img src="http://169.254.169.254/...">`，导入时 Notion 服务端抓取触发 SSRF/云元数据。来源与 AI 输出不同（帖子 HTML vs AI 输出）但同漏洞模式同触发点。加 `_safeExternalUrl` helper（复用 `validatePageExternalUrl`），7 处全部接入，合法外网 CDN 图片/附件不受影响（`_isPrivateHost` 只拒内网）

### 说明

- 本次为纯安全加固（AI 输出 schema 校验 + DOMToNotion SSRF sibling），无新功能、无运行时行为变化（除安全校验的设计行为对齐：AI 输出 URL/属性非法时跳过该字段不中断流程，导入帖子含内网图时该图静默跳过）
- 严格遵守锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- 新增 `tests/ai-schema.test.js` 32 契约用例（SSRF 防御 + 属性名 + 类型 + 值 + emoji + 对象值 + 结构 + parseAIJson）
- ISS-20260723-009 完成；ISS-20260723-010（ai/index.js 7090 行巨石拆分 + LinuxDoAPI 迁回 extract）deferred，parseAIJson 已为其预留接缝
- S_GENERALIZE 首轮 grep `external:{url}` 漏报 `_cookImage`（L412），二轮全量 grep `Utils.absoluteUrl` 补获第 7 处 + `serializeRichText` link（L476，归 safe：写 rich_text.link.url 非 Notion 服务端抓取点）

### 验证

- `npm run verify:baseline`：18 个测试文件、384 个用例全部通过（+32 ai-schema 契约），legacy 全绿，EXIT=0 零回归
- `node build.js`：零警告构建，单文件产物 1290.5 KB（+11.1 KB），关键锚点校验通过

[3.7.8]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.8

## [3.7.7] - 2026-07-23

### 修复（odyssey-improve 全项目 6 维度审计）

**安全**:
- **XSS 渲染未转义 (CWE-79)**：4 处 innerHTML 拼接补 escapeHtml — main-ui/notion-site-ui 的 AI 模型 option value+文本、events 模板 icon、security 确认对话框 hint itemName（同块 placeholder 已转义，hint 行遗漏）
- **删页绕 OperationGuard (CWE-862/639)**：BookmarkAutoImporter 自动同步归档已删除书签时直连 `NotionAPI.deletePage` 绕过 Guard（deletePage level 2）。改为 `OperationGuard.canExecute` 权限闸门，权限不足跳过归档并记 `guard.denied` 审计，不裸调

**可靠**:
- **节流失效**：BookmarkAutoImporter `processInBatches` 延迟条件引用外层页面对象 `index`（非遍历 `itemIndex`），`对象<数字→NaN→恒 false` 致 REQUEST_DELAY 永不生效，高书签量打 Notion API 触发 429。改名 `pageIndex` + 用 `itemIndex`
- **并发取任务**：`import/index.js` worker `nextIndex++` 改 `remaining.shift()`，对齐 export 层显式任务队列（并发安全锁定约束跟进）
- **RSS 单 feed 阻断**：RSSAutoImporter 新增 `fetchFeedWithRetry`（2 次指数退避重试），`loadCurrentItems` 单 feed 失败 catch continue，不再因单 feed 抖动阻断整次 RSS 同步
- **GitHub 分页数据丢失**：`_fetchPaginated` onerror/ontimeout 时若已拉到部分页则 partial resolve 保留已拉数据（否则整次 reject 丢弃前 N 页，下次从旧 watermark 重拉全部放大流量）

**性能**:
- **escapeHtml 热路径**：改纯字符串替换（`& < > "` 转义，保持 `!text` falsy 语义与 `textContent+innerHTML` 一致），消除每次调用创建一次性 DOM 节点；60 处批量渲染调用放大 GC

**可维护**:
- **死导入清理**：ui 层 5 文件（style-manager/index/styles/design-system/panel-resize）整段复制未用的 extract/export/import 导入块清理（~45 行死导入，ISS-008 同类遗留）
- **isHttpUrl 语义分歧**：BookmarkAdapter fallback 正则 `/^https?:/.test` 对齐主实现 `/^https?:\/\//i`（缺 `//` 与 `i` 标志）
- **ISS-007 注入路径测试**：adapter-contract 补 lazy bridge accessor 注入主路径测试（此前契约测试只 import adapter 对象不 import 注册器，注入主路径零覆盖，仅 fallback 被测）

### 说明

- 本次为纯质量加固（odyssey-improve 6 维度审计 high+medium 修复），无新功能、无运行时行为变化（除安全/可靠修复的设计行为对齐），严格遵守锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- `notion-oauth.test.js` BookmarkAutoImporter.run 测试设 `PERMISSION_LEVEL=2`（归档=deletePage level 2 新安全语义），新增权限不足跳过归档回归测试（CWE-862/639）
- deferred 2 issue：ISS-20260723-009（AI 输出 schema 校验层 CWE-94）、ISS-20260723-010（ai/index.js 7090 行巨石拆分 + LinuxDoAPI 迁回 extract）
- reliability agent 报 `markExported` 丢失更新经核实为误判（JS 单线程同步读改写无 await 间隔即无竞态），已记 safe 并持久化判据 spec S-20260723-iebd

### 验证

- `npm run verify:baseline`：17 个测试文件、352 个用例全部通过（+2 ISS-007 注入 + CWE-862 回归），legacy 全绿，logic 40/0
- `node build.js`：零警告构建，单文件产物 1279.4 KB（-2.3 KB），关键锚点校验通过

[3.7.7]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.7

## [3.7.6] - 2026-07-18

### 重构

- **UICommandService 分层迁移**：将 UI 命令分发协调器从 `src/extract/index.js` 迁至独立 `src/coordination/UICommandService.js`，extract 层回归数据抽取职责，仅导出 `ZhihuAPI`/`GenericExtractor`/`WorkspaceService`。消除 extract 层承担 UI 命令分发（`select_ai_target`/`refresh_workspace_targets`/`fetch_ai_models`/`save_command_boundary_settings` 等）的分层违规，及 extract → import/export/ai 的多向耦合（ISS-20260718-008）
- **adapter 结构性循环消除**：`BookmarkAdapter`/`RSSAdapter` 不再顶部 `require("../bridge")`，改由 `src/adapter/index.js` 注册时注入 `_bridgeAccessor` lazy accessor，运行时解析 bridge 模块。消除 `adapter/index → BookmarkAdapter → bridge → BookmarkAutoImporter → SyncCoordinator → adapter/index` 加载期循环（ISS-20260718-007）

### 说明

- 本次为模块边界整理（纯 refactor），无运行时行为变化，严格遵守锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- 源码层 extract 不再导出 UICommandService（验证通过）；产物层 esbuild 为 coordination 生成独立 `require_UICommandService` 工厂
- `tests/legacy-harness.js` 的 `FACTORY_NAMES` 列表补充 `require_UICommandService`，使 legacy 测试经 harness 仍能取到 UICommandService
- adapter 契约测试未注入 `_bridgeAccessor` 时走 fallback 顶层 require，保持向后兼容

### 验证

- `npm run verify:baseline`：17 个测试文件、350 个用例全部通过，legacy 全绿，logic 40/0
- `node build.js`：零警告构建，单文件产物，关键锚点校验通过

[3.7.6]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.6

## [3.7.5] - 2026-06-24

### 新增

- **UI 设计 Token 体系完善**：`src/ui/design-system.js` 新增 28 个 CSS 变量 token，覆盖 spacing（3xs~3xl）、font-size（xs~2xl）、z-index（panel/panel-top/overlay/float）、radius（2xs/md/pill）、white、bright（warning/success/danger）、disabled（opacity/cursor）系列，建立完整的主题无关 token 层级
- **就地状态文本语义类**：新增 `.ldb-status-text` 及修饰符（`--danger/--success/--warning/--accent/--muted`），替代内联 `color` 样式，用于测试按钮旁等持久状态显示
- **可访问性补全**：12 处图标按钮（主题切换、最小化、关闭、刷新、浮动按钮）补全 `aria-label`；2 处状态容器（`#ldb-status-container`、`#ldb-obs-test-status`）补全 `aria-live="polite"`

### 变更

- **CSS 硬编码消除**：4 个 UI 文件（styles/main-ui/generic-ui/notion-site-ui）共 325 处硬编码值收敛为 `var(--ldb-ui-*)` 引用（hex 颜色 9、border-radius 30、spacing 201、font-size 74、z-index 6、rgba focus-ring 5），视觉数值 1:1 保留
- **disabled 样式 token 化**：`design-system.js` 中 5 处 `opacity: 0.65` 与 5 处 `cursor: not-allowed` 字面量替换为 `var(--ldb-ui-disabled-opacity)` / `var(--ldb-ui-disabled-cursor)`
- **错误展示统一**：10 处 `innerHTML` 内联 `color` 状态文本（events.js 的 `obsTestStatus`、main-ui.js 与 notion-site-ui.js 的 `bmStatus`）收敛为 `.ldb-status-text` 语义类，保留就地持久显示语义
- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.5`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建，单文件产物 1263.2 KB
- 收敛 grep：hex/border-radius/font-size/opacity/innerHTML+color/DEFAULTS-snake_case 均为 0

### 说明

- 本次为 UI/UX 一致性优化（非改版），严格遵守路线图锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- TASK-004（数据契约对齐）与 TASK-005（状态管理）经核验现有代码已实质满足，未引入 `normalizeValue` 与 `state-manager.js`，避免过度工程

[3.7.5]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.5

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
