# AGENTS.md — LD-Notion Hub 协作指南

本文件帮助任何 AI 编码 agent 快速理解并有效参与本仓库工作。**先读此文件,再动代码。**

## 快速开始

落地后按顺序执行,确认环境健康:

```bash
npm install            # 安装依赖
npm test               # vitest + legacy 三件套,确认全绿
npm run verify:baseline   # 测试 + 语法检查 + UI 校验(改动前的基线)
```

- 改动前先跑 `npm run verify:baseline` 建立绿色基线。
- 改动后跑 `npm test` 确认无回归;涉及构建产物跑 `npm run verify:build`。
- 交付前跑 `npm run verify:delivery`(13 维度全链检查)。
- **PowerShell 注意**:手敲串联命令用 `;` 分隔,**不要用 `&&`**;scripts 字段内的 `&&` 由 npm 解析不受影响。

## 项目速览

LD-Notion Hub v3.7.8 是 **Tampermonkey 用户脚本 + Chrome 扩展**,统一连接 Linux.do、GitHub、浏览器书签、RSS、知乎 → Notion。**纯前端,无后端/服务端,无外部数据库。**

| 维度 | 约定 |
| --- | --- |
| 模块系统 | CommonJS(package.json 无 `"type"` 字段) |
| 构建工具 | esbuild@^0.28.1 |
| 测试框架 | vitest@^4.1.8 |
| 文档站点 | vitepress@^2.0.0-alpha.17 |
| 安全原语 | AES-256-GCM、PBKDF2、`crypto.getRandomValues` |
| Node 版本 | >=18(**仅构建期**,运行时为 Chrome/Edge) |
| 运行时网络 | `GM_xmlhttpRequest` / `fetch`,无服务端 |

## 双交付形态

| 形态 | 路径 | 说明 |
| --- | --- | --- |
| 单文件 userscript | `LinuxDo-Bookmarks-to-Notion.user.js` | esbuild 打包产物,零部署门槛 |
| Chrome 扩展 | `chrome-extension-full/` | 桥接 + 独立扩展双形态 |

> 构建产物必须仍为单 `.user.js` 文件。模块拆分是内部重构,不影响用户安装体验。

## npm scripts

> scripts 字段内的 `&&` 由 npm 内部 shell 解析,**不受 PowerShell 影响**,保持原样。

| 脚本 | 用途 |
| --- | --- |
| `test` | vitest 全量 + legacy 三件套 |
| `test:legacy` | `node tests/{utils,logic-modules,notion-oauth}.test.js` |
| `verify:baseline` | 测试 + 语法检查(`node --check`)+ UI 校验 |
| `build` | `node build.js` 生成单文件 userscript |
| `build:extension` | 构建 Chrome 扩展 |
| `verify:build` | 构建 + 产物语法检查 + 构建标记校验 |
| `verify:extension:bounded` | bounded_hosts manifest 临时构建验证 |
| `verify:bridge-extension` | 桥接扩展验证 |
| `verify:extension:surfaces` | 扩展表面验证 |
| `verify:equivalence` | 打包等价性校验(存储键字面量等) |
| `verify:delivery` | **交付前 13 维度全链检查**(基线+构建+扩展+桥接+表面+等价) |
| `docs:dev` / `docs:build` / `docs:preview` | VitePress 文档开发/构建/预览 |

## src/ 模块结构

| 目录 | 职责 |
| --- | --- |
| `adapter/` | 多源适配器抽象层:`SourceAdapter` 基类 + `AdapterRegistry` + LinuxDo/GitHub/Bookmark/RSS/Zhihu/Generic 各适配器,新知识源接入标准接口 |
| `ai/` | AI 助手与 Agent:ReAct Agent Loop、`AgentTools`、`Handlers`、`BlockConverter`、`NameResolver`、`AISchema` 输出校验、`AgentTrace` 调用链追踪 |
| `api/` | Notion/Obsidian API 传输层:`NotionTransport`、`NotionAPI`、`DOMToNotion`、`ObsidianAPI`、`SiteDetector`、`HTMLToMarkdown` |
| `auth/` | 鉴权:`NotionOAuth` + manual token + 本地加密保险箱 `CredentialVault` + `TargetState` |
| `bridge/` | 浏览器书签/RSS 桥接:`BookmarkBridge`、`BookmarkExporter`、`BookmarkAutoImporter`、`RSSAutoImporter` |
| `config/` | 全局配置常量:`CONFIG`、`MSG` 消息、文件类型映射、MIME |
| `coordination/` | UI 命令分发协调器 `UICommandService`(从 extract 层迁出,解耦多向耦合) |
| `export/` | 导出层:`GenericExporter`、`LinuxDoAPI`、`Exporter`(标准化→Notion Blocks/Markdown) |
| `extract/` | 数据抽取:`ZhihuAPI`、`GenericExtractor`、`WorkspaceService`(纯数据抽取,不含 UI 协调) |
| `import/` | 导入层:`GitHubAPI`、`GitHubAutoImporter`、`GitHubExporter`、`AutoImporter`、`UpdateChecker` |
| `security/` | 安全层:`OperationGuard` 权限守卫、`OperationLog` 审计、`ConfirmationDialog`、`UndoManager`、`UrlValidator` |
| `storage/` | 持久化:`Storage`(GM storage 封装)、`SyncState`(增量同步状态)、`DedupStore`(去重) |
| `ui/` | 界面层:`MainUI`、`NotionSiteUI`、`GenericUI`、`DesignSystem`、`StyleManager`、`PanelResize`、`events`、`workspace` 等 |
| `utils/` | 通用工具:`Utils`(`escapeHtml`、`randomToken`、`apiKeyHash` 等) |

**顶层文件:** `src/main.js`(入口,导入并连接所有模块,注入跨模块依赖)、`src/sync-lock.js`(同步锁)。

## 编码规范

- **循环依赖三解法**:① 提取共享依赖到独立模块(如 `UrlValidator`);② 运行时 lazy require(有状态跨模块对象如 UI);③ lazy accessor 依赖注入(加载期环)。**禁止新增跨模块循环依赖边**(security 不应 require ui 顶层导出)。
- **innerHTML 模板插值统一 `escapeHtml`**(静态字面量除外),纯字符串实现,非每次创建 DOM 元素。
- **安全随机值用 `crypto.getRandomValues`**,禁止 `Math.random()`(boundary/token/eventId/文件名)。
- **并发 worker 用显式队列 `remaining.shift()`** 替代共享 `nextIndex++`(消除竞态)。
- **esbuild 闭包**:跨模块自由变量须顶部 import 或 lazy require;`typeof X !== "undefined" && X.method()` 对跨闭包自由变量恒 false,是**反模式**(静默降级)。
- **fetch 超时+退避重试**:`AbortController` + `setTimeout(15000)` + 退避 `1000*2^attempt`;401/403/400 短路不重试;定时器前置 `clearTimeout`/`clearInterval` 防泄漏。
- **JSON 映射缓存消除 O(N²)**:禁止循环内逐条 `Storage.set + JSON.stringify`;用顶层缓存引用 + 单次序列化(读写对称,写侧 `mark*` 仅 mutate + 末次 flush)。
- **AI JSON 消费统一入口** `AISchema.parseAIJson`,禁止再内联三段式 `jsonMatch+JSON.parse+try-catch`。
- **持久化存储键必须有 TTL 或容量上限**,禁止无界增长(GM 存储 FIFO rotate);导出/去重集合(`DedupStore`、`GITHUB_EXPORTED_REPOS`、`BOOKMARK_EXPORTED` 等)90 天 TTL 自动淘汰;日志/历史类数组用 `MAX_ENTRIES` 截断。
- **缓存指纹字段须单向哈希**(如 `apiKeyHash`),禁止明文 key 子串(`slice(-8)`)。
- **变量命名禁与遍历索引冲突**(返回对象的变量禁命名 `index`/`idx`,应命名 `pageIndex`)。

## 安全约束

### OperationGuard(权限网关 + 审计)

- 所有写入(用户与 AI)统一收束到 Guard,**禁止裸调 Notion API 绕过**(含自动同步归档)。
- 4 级权限:0 只读 / 1 标准 / 2 高级 / 3 管理员;默认标准;未知操作**默认拒绝**(CWE-862/639)。
- 自动同步归档(`BookmarkAutoImporter`)同样经 `canExecute`,权限不足时跳过并记 `guard.denied`,不裸调 API。
- `setLevel` 强制校验 0-3 整数,拒绝 NaN/Infinity/负数/超范围。

### Prompt Injection 五层防御

| 层 | 防御目标 | 作用阶段 |
| --- | --- | --- |
| ① XML 标签 `<user_content>` 输入隔离 | 防恶意内容劫持 AI 意图 | AI 请求构建 |
| ② `escapeHtml` + `safeMarkdown` 输出净化 | 防恶意内容通过 UI 渲染 | AI 回复展示 |
| ③ UI 全局 `escapeHtml`(50+ 拼接点) | 防恶意内容通过 UI 拼接 | DOM 渲染 |
| ④ `AISchema` 输出校验(v3.7.8) | 防 AI 输出恶意 URL/异常属性写入 Notion | AI 输出消费 |
| ⑤ OperationGuard 写入边界 | 防未授权写入 | 写入执行 |

v3.7.8 schema 校验拦截:icon/cover URL 指向 `169.254.169.254`(SSRF)、`relation`/`people`/`files` 等系统关联字段污染 schema。

### Auth

- OAuth 推荐路径,manual token 高级兜底。
- 敏感凭证(token/Client Secret/AI Key/GitHub/Obsidian token)入本地 AES-256-GCM 加密保险箱。
- 鉴权失败须在 Guard 前阻止写入;审计日志不得含真实 token。

### Routing 优先级

1. 安全与授权优先于写入(无有效授权不进入 Notion 写入)。
2. 明确用户选择优先于自动推断。
3. 来源专用解析优先于通用网页解析。
4. AI 增强可选(AI 失败不阻断基础导入)。
5. OperationGuard 是最终写入边界;fallback 保留用户可见状态,不静默丢弃。

### URL / SSRF 防护

- `UrlValidator` 白名单:AI base 限 `api.openai/anthropic/google` 或 HTTPS 非内网;Obsidian 仅 `127.0.0.1/localhost/::1`;页面外链 http(s) + 拒内网/169.254。
- Extension background worker 强制 https + 默认端口 + hostname 精确匹配。
- 权限域收窄(v3.7.0):`@match` 6 个显式站点;`@connect` 9 个域名白名单;`@include` 正则白名单 + `@exclude` 搜索引擎/邮箱/localhost。

## 禁止操作(明确清单)

- 禁止裸调 Notion API 绕过 OperationGuard(含自动同步归档)。
- 禁止 innerHTML 插值未 `escapeHtml`(含 AI/用户不可信输入)。
- 禁止 `Math.random()` 用于安全随机值(boundary/token/eventId/文件名)。
- 禁止循环内逐条 `Storage.set + JSON.stringify`(写侧 O(N²))。
- 禁止 `typeof X !== "undefined" && X.method()` 对跨闭包自由变量(恒 false 静默降级)。
- 禁止新增 AI JSON 消费点内联三段式(须走 `parseAIJson`)。
- 禁止引入服务端依赖/外部数据库。
- 禁止破坏单文件输出/向后兼容/双扩展形态。
- 禁止新增跨模块循环依赖边。

## 架构锁定约束

| 约束 | 状态 |
| --- | --- |
| 单文件 userscript 输出不变(零部署) | 🔒 Locked |
| 纯客户端架构(无服务端,禁外部数据库) | 🔒 Locked |
| 向后兼容(不破坏公共 API) | 🔒 Locked |
| 不引入新框架(原生 JS + 现有工具链) | 🔒 Locked |
| Chrome Extension 双形态保留 | 🔒 Locked |

- **YAGNI**:核验现状已满足后不引入新抽象(避免过度工程)。
- **大文件拆分**(>1500 LOC 违反 SRP)与**循环依赖消除**属独立 milestone,禁止在常规 bugfix 中顺带展开;拆分走「测试基线→提取模块→转发壳→全绿验证」流程。

## 测试约定

- **框架**:vitest,`environment: node`,`setupFiles: tests/setup.js`,`include: tests/**/*.test.js`,排除 3 个 legacy 测试。
- **legacy 测试**用 node 直跑:`tests/utils.test.js`、`tests/logic-modules.test.js`、`tests/notion-oauth.test.js`。
- 每个 `SourceAdapter` 须通过契约测试(`fetchIncremental`/`fetchAll`/`normalize`/`getDedupKey`)。
- `SyncState` 须覆盖增量同步关键路径(新项添加、已存在跳过、watermark 更新、边界条件)。

## 环境与已知约束

- **Shell**:Windows PowerShell,不支持 `&&`,手敲串联命令用 `;` 分隔(如 `npm run build; npm test`)。**scripts 字段内的 `&&` 由 npm 解析,不受影响。**
- **本地代理** `127.0.0.1:8756`,网络请求经此代理。
- **NVIDIA NIM** POST 端点经本地代理不可达 → agent 必须固定用 Claude 主模型,避免 NIM 降级重试。
- **Qoder 运行时不触发 maestro hooks** → 补偿方式为手动 `spec load` / `delegate status`(见 `.workflow/.maestro/`)。

## 相关文档

| 路径 | 内容 |
| --- | --- |
| `package.json` / `vitest.config.js` / `src/main.js` | 构建配置、测试配置、入口 |
| `docs/architecture/overview.md` / `docs/architecture/security.md` | 架构总览、安全 |
| `docs/concepts/operation-guard.md` | 权限网关 + 审计 |
| `docs/concepts/prompt-injection-defense.md` | AI 注入五层防御 |
| `docs/concepts/auth-model.md` | 鉴权模型 |
| `docs/concepts/routing-rules.md` | 路由优先级 |
| `.workflow/specs/architecture-constraints.md` | 架构锁定约束 |
| `.workflow/specs/coding-conventions.md` | 编码规范 |
| `.workflow/specs/test-conventions.md` | 测试约定 |
