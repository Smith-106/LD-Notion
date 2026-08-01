---
title: "Coding Conventions"
readMode: required
priority: high
category: coding
keywords:
  - style
  - naming
  - import
  - pattern
  - convention
  - formatting
---

# Coding Conventions

## Formatting

## Naming

## Imports

## Patterns

## Entries



<spec-entry category="coding" keywords="circular-dependency,module,refactor,urlvalidator" date="2026-06-24" title="循环依赖消除：提取共享依赖到独立模块" description="循环依赖修复模式：提取共享依赖到独立模块打破环" source="debug:DBG-003" sid="S-20260718-zliy">

### 循环依赖消除：提取共享依赖到独立模块

当两个模块 A↔B 通过彼此 require 形成循环依赖时（如 api/index.js ↔ security/index.js 都需要 UrlValidator），Node.js 会输出 'Accessing non-existent property inside circular dependency' 警告，且模块导出可能为 partial object。修复模式：将共享依赖提取到第三个独立模块 C（如 src/security/UrlValidator.js），A 和 B 都 require C，打破环。LD-Notion 实例：UrlValidator 从 security/index.js 提取到独立 UrlValidator.js，api/index.js 和 ai/index.js 改 require('../security/UrlValidator')，消除 circular dependency 警告。

</spec-entry>

<spec-entry category="coding" keywords="random,security,crypto,getrandomvalues,math.random" date="2026-06-24" title="安全随机数：crypto.getRandomValues 替代 Math.random" description="安全敏感随机值用 crypto.getRandomValues 替代 Math.random" source="debug:DBG-003" sid="S-20260718-lqzf">

### 安全随机数：crypto.getRandomValues 替代 Math.random

生成安全敏感的随机值（multipart boundary、文件名、token、CSRF nonce）时禁止用 Math.random()（伪随机，可预测）。正确模式：用 crypto.getRandomValues 生成。实例：const bytes = new Uint8Array(8); crypto.getRandomValues(bytes); const hex = Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');。LD-Notion 已有 Utils.randomToken 作为封装参考。应用点：src/api/index.js 的 multipart boundary（原 Math.random）和 src/ui/events.js 的 Obsidian 图片文件名（原 Math.random）均已替换。注意：crypto.getRandomValues 在 Userscript 环境（Tampermonkey）和浏览器均可用，无需 polyfill。

</spec-entry>

<spec-entry category="coding" keywords="concurrency,race-condition,worker,queue,shift" date="2026-06-24" title="并发安全：显式任务队列 shift 替代共享 nextIndex++" description="并发 worker 用显式队列 shift 替代共享 nextIndex++ 消除竞态" source="debug:DBG-003" sid="S-20260718-wv9r">

### 并发安全：显式任务队列 shift 替代共享 nextIndex++

并发 worker 模型中，多 worker 共享同一个 nextIndex 变量并用 nextIndex++ 取任务会导致竞态条件——++ 非原子操作，多 worker 并发自增可能取到相同索引（重复处理）或跳过索引。即使改为 ++nextIndex 前置自增也仅缓解不消除。正确模式：用显式任务队列，worker 通过 remaining.shift() 原子取任务（Array.shift 是同步原子操作）。实例：src/export/index.js 的 exportBookmarks 改为 const remaining = []; for (let i=startIndex; i<bookmarks.length; i++) remaining.push(i); worker 中 const i = remaining.shift(); if (i===undefined) return;。取消/跳过时遍历 remaining 处理剩余项。此模式天然无竞态，且支持暂停（while isPaused await sleep）。

</spec-entry>

<spec-entry category="coding" keywords="esbuild,circular-dependency,free-variable,lazy-require,closure" date="2026-07-18" sid="S-20260718-uomk" title="esbuild 闭包自由变量：跨模块引用须 import 或 lazy require" description="esbuild 闭包内跨模块自由变量须 import 或 lazy require；循环依赖 lazy require 判据补充 coding-conventions-001" source="fix/legacy-test-infrastructure-and-bundle-sync@07038b9">

### esbuild 闭包自由变量：跨模块引用须 import 或 lazy require

esbuild 将每个 CommonJS 模块打包为独立 __commonJS 闭包，闭包间不共享自由变量。模块内引用一个顶部未 require import 的跨模块标识符（如 UI、AIService、AIAssistant、CredentialVault、GenericExtractor、BookmarkExporter）时，该标识符在运行时为 undefined（或 typeof 返回 'undefined'），导致：(1) 直接属性访问抛 TypeError；(2) typeof-guard 静默早退使功能静默降级（如状态栏不更新、操作日志脱敏失效、AI 分类中断、Notion 页面创建中断）。

判据（补充 coding-conventions-001 循环依赖消除）：
- 可提取的纯工具依赖（如 UrlValidator）→ 提取到独立模块，A/B 都 require C（spec 原方案）。
- 有状态、跨多模块、加载时序敏感的对象（如 UI）→ 提取独立模块不现实，用运行时延迟 require：const _resolveUI = () => { try { return require('../ui').UI; } catch { return undefined; } }，方法执行时整张模块图已加载完成。
- 循环依赖（A↔B 互 require）顶部 require 会让一方拿到 partial export → 用 lazy require 内方法体，或 ensureAdaptersRegistered() 单次 flag-guard 延迟注册。

反模式（必须修）：typeof X !== "undefined" && X.method() 对跨闭包自由变量恒为 false → 静默降级。修复：顶部 import 或 _resolveUI() lazy require。

LD-Notion 实例：fix/legacy-test-infrastructure-and-bundle-sync 分支修复 GitHubAutoImporter.updateStatus、security/index.js（OperationLog.add/clear + UndoManager.showToast）、UpdateChecker、export/index.js（GenericExtractor+AIAssistant）、GitHubExporter（AIService）、BookmarkAdapter（BookmarkExporter）共 7 处 sibling。

</spec-entry>

<spec-entry category="coding" keywords="circular-dependency,lazy-require,dependency-injection,adapter,bridge,esbuild" date="2026-07-18" sid="S-20260718-radk" title="循环依赖消除：lazy accessor 依赖注入（加载期环第三解法）" description="循环依赖第三解法：lazy accessor 注入，适用于加载期环且无法提取共享依赖的场景" source="refactor/adapter-registry-injection@e7656b1">

### 循环依赖消除：lazy accessor 依赖注入（加载期环第三解法）

当两个模块 A↔B 形成循环依赖且无法提取共享依赖到独立模块时（如 adapter 注册器 index.js 需注册 BookmarkAdapter，而 BookmarkAdapter 又需要 bridge，bridge 又回到 adapter 层的 SyncCoordinator），可用 lazy accessor 依赖注入：被依赖方（BookmarkAdapter）不在顶部 require，改为暴露 _bridgeAccessor 槽位（初值 null）+ _getBridge() 方法（注入时用 accessor，未注入走 fallback 顶层 require）；注册器（adapter/index.js）在加载完成时 Object.assign(adapter, { _bridgeAccessor: () => require('../bridge') }) 注入。这样 require('./BookmarkAdapter') 不再触发 bridge 加载，环在加载期断开，运行时 accessor 才解析（此时整张模块图已加载）。判据：仅当环边是加载期时序问题（顶部 require 拉起未完成模块）而非真正双向数据依赖时适用；若 A/B 真的需要彼此的导出值参与初始化，仍须提取共享依赖（见 coding-conventions-001）。LD-Notion 实例：ISS-20260718-007，BookmarkAdapter/RSSAdapter 顶部 require('../bridge') 改为 _bridgeAccessor 注入，契约测试不注入时走 fallback 保持向后兼容。

</spec-entry>

<spec-entry category="coding" keywords="concurrency,race,await,markexported" date="2026-07-23" sid="S-20260723-iebd" title="JS 单线程同步读改写无竞态判据" description="JS 单线程同步读改写无竞态判据" source="fix/improve-odyssey-3.7.6-audit@fb76333">

### JS 单线程同步读改写无竞态判据

判断 JS 并发竞态前先确认方法内是否有 await 间隔:getExported→JSON.parse→set 这类同步读改写(无 await)在 Promise.all worker 间不会中途交错(A.markExported 原子跑完才轮到 B),无丢失更新。仅当方法内 get→await→set 有 await 间隔时,worker 才可能在读写中途插入导致丢失更新。LD-Notion 实例: BookmarkExporter.markExported 被 reliability agent 误判丢失更新,实为同步读改写无竞态;getExported 无缓存是 performance 低优非并发安全。判据:grep 方法体内是否有 await 在 get 与 set 之间,有则竞态风险,无则安全。

</spec-entry>

<spec-entry category="coding" keywords="ai-validation,graceful-degradation,fallback,userscript" date="2026-07-24" sid="S-20260724-56nx" title="AI 输出校验降级策略（跳过不中断）" description="AI 输出校验失败统一降级策略" source="harvest:2026-07-24-odyssey-sessions">

### AI 输出校验降级策略（跳过不中断）

AI 输出校验失败时统一降级而非中断主流程，符合 userscript 容错语义：icon/cover URL 非法 → 跳过该字段（undefined），页面仍创建；属性名/类型非法 → 跳过该属性 + console.warn，不建列不填值；条目结构非法 → 跳过该条目 + 计入 failedCount 回传；tool args 非法 → 拒绝该 tool call（return null），runAgentLoop 继续；整体结构非法（properties/entries 非数组）→ 中断 + 明确 reason。结构校验前置在 parseAIJson 内，不再让 TypeError 被 try-catch 吞掉成模糊错误。

</spec-entry>

<spec-entry category="coding" keywords="reliability,fetch-timeout,retry,abortcontroller,timer-leak" date="2026-07-24" sid="S-20260724-mr28" title="fetch 超时 + 退避重试模板" description="网络请求超时+退避重试+定时器清理模板" source="harvest:2026-07-24-odyssey-sessions">

### fetch 超时 + 退避重试模板

native fetch 无默认超时会无限挂起。所有网络请求须：(1) AbortController + setTimeout(abort, 15000) 超时（LinuxDoAPI.fetchJson 等客户端网络请求，纯客户端架构无服务端）；(2) _retryable 退避重试 1000*2^attempt，鉴权类错误（401/403/400/invalid/unauthorized/forbidden）短路不重试——鉴权错重试无意义。AI 3*Chat 请求方法用此模板。定时器泄漏同步防护：showStatus _statusTimer / ConfirmationDialog countdown interval 在重新设置前必须 clearTimeout/clearInterval 前置清理。

</spec-entry>

<spec-entry category="coding" keywords="performance,json-cache,o-n-squared,getexported,storage" date="2026-07-24" sid="S-20260724-sfap" title="JSON 映射缓存消除 O(N²) parse" description="JSON 映射缓存消除循环内 O(N²) parse/stringify" source="harvest:2026-07-24-odyssey-sessions">

### JSON 映射缓存消除 O(N²) parse

循环内逐条 getExported（JSON.parse）+ markExported（JSON.stringify）是 O(N²)。正确模式：顶层 _exportedCache 缓存引用——getExported 命中返引用，markExported 就地 mutate 缓存对象，末尾单次 JSON.stringify 回写。v3.7.8 BookmarkExporter/GitHubAPI 引入 _exportedCache/_exportedGistsCache 实现 N²→N。Storage 已有 _exportedTopicsCache 同模式。判据：凡循环内 get/set Storage JSON 映射，顶层缓存引用 + 单次序列化。

</spec-entry>

<spec-entry category="coding" keywords="xss,cwe-79,escapehtml,innerhtml,sanitization" date="2026-07-24" sid="S-20260724-52yw" title="innerHTML 模板插值统一 escapeHtml" description="innerHTML 插值统一 escapeHtml + 纯字符串实现" source="harvest:2026-07-24-odyssey-sessions">

### innerHTML 模板插值统一 escapeHtml

innerHTML 拼接时易漏个别插值点（同块 placeholder 已转义、hint 行漏），无 lint 校验。所有 ${var} 进 innerHTML 必须 escapeHtml，静态字面量除外。v3.7.7 修 4 处 XSS（main-ui 模型 option、notion-site-ui 同、events 模板 icon、security 确认 hint）。escapeHtml 实现须纯字符串替换（非每次创建 DOM 元素），热路径 60 处调用放大 GC——utils/index.js 已改纯字符串 O(1)。新增 innerHTML 插值点须审查是否含用户/AI 不可信输入。

</spec-entry>

<spec-entry category="coding" keywords="pagination,partial-resolve,retry,reliability,github-api" date="2026-07-24" sid="S-20260724-c4gg" title="分页累积请求 partial resolve" description="分页累积请求网络抖动 partial resolve" source="harvest:2026-07-24-odyssey-sessions">

### 分页累积请求 partial resolve

分页/批量累积请求在网络抖动下应 partial resolve（保留已拉数据），而非 reject 丢弃全部。GitHubAPI._fetchPaginated onerror 时若 allItems.length>0 则 partial resolve，避免下次从旧 watermark 重拉全部放大流量；调用方经 markExported 标记已处理项不导致重复。RSSAutoImporter 单 feed 失败 continue 不阻断整批。判据：累积型请求 reject 会丢已累积数据 + 放大重试流量时，改为 partial resolve + 调用方幂等标记。

</spec-entry>

<spec-entry category="coding" keywords="naming,index,nan,throttle,bug" date="2026-07-24" sid="S-20260724-ikga" title="变量命名禁与遍历索引冲突" description="变量命名禁与遍历索引语义冲突致 NaN" source="harvest:2026-07-24-odyssey-sessions">

### 变量命名禁与遍历索引冲突

const index = buildPageIndex() 返回对象，与 itemIndex 遍历参数混淆致 index < length 为 NaN 恒 false，REQUEST_DELAY 节流条件永不生效、429 风险。v3.7.7 BookmarkAutoImporter.processInBatches 修复：外层重命名 pageIndex，delay 条件用 itemIndex。判据：返回对象的变量禁止命名为 index/idx 等与数字遍历索引同形的名称；页面对象索引应命名 pageIndex/pageIndexMap。

</spec-entry>

<spec-entry category="coding" keywords="refactor,dead-import,cleanup,iss-008" date="2026-07-24" sid="S-20260724-gpm5" title="迁移 refactor 须清理同类死导入债" description="迁移 refactor 须清理同类死导入债" source="harvest:2026-07-24-odyssey-sessions">

### 迁移 refactor 须清理同类死导入债

ISS-008 拆 UICommandService 导入时，同文件的 extract/export/import 复制导入块是同类样板债（5 文件 ~45 行），应一并清理而非只拆目标符号。v3.7.7 已清理 ui/style-manager 等 5 文件死导入。判据：迁移/拆分某符号时，grep 同文件同形状的复制 import 块，确认是否随迁移失效，失效则一并删除——避免死导入累积成耦合污染。

</spec-entry>

<spec-entry category="coding" keywords="observability,ai-trace,persistence,rotate,fifo,gm-storage,prompt-injection" date="2026-07-28" sid="S-20260728-trace" title="AI Agent 调用链追踪持久化模式（GM 存储 FIFO rotate + 截断防注入）" description="AI Agent 调用链追踪持久化：GM 存储 JSON 数组 FIFO rotate + 输入预览截断防注入" source="harvest:2026-07-28-iss012-ai-trace">

### AI Agent 调用链追踪持久化模式（GM 存储 FIFO rotate + 截断防注入）

AI Agent 调用链（runAgentLoop）须持久化 per-invocation trace 用于 observability 诊断与回归分析。模式：(1) 入口 create trace（含 id/timestamp/userInput/iterations/空数组 toolCalls+results+errors/in_progress 状态 + _startedAt 计时）；(2) 每次工具调用前后 recordToolCall+recordResult；(3) 出口 persist 落盘，设 status（completed/failed/max_iterations）+ latencyMs；(4) 存储 GM_getValue/GM_setValue JSON 数组，固定容量 FIFO rotate（超限 shift 最旧）。安全：所有用户输入/结果预览/最终回复须截断后再持久化——userInput 截断防 prompt injection 污染存储，result preview + finalResponse 截断防存储膨胀。纯客户端架构无服务端，存 GM 存储走 CONFIG.STORAGE_KEYS 单一来源（verify-bundle-equivalence 校验存储键字面量）。参照 DedupStore/SyncStateV2 的 GM 封装模式。LD-Notion 实例：ISS-012 src/ai/AgentTrace.js，MAX_TRACES=50/MAX_USER_INPUT=500/MAX_RESULT_PREVIEW=200/MAX_FINAL_RESPONSE=1000，runAgentLoop 4 出口埋点（AI 调用失败 recordError+persist(failed)/非工具调用最终回复 persist(completed)/循环结束 persist(max_iterations)/每次 _executeAgentToolCall 前后 record），STORAGE_KEYS.AI_TRACE_LOG=ldb_ai_trace_log，21 契约用例（tests/ai-trace.test.js）。

</spec-entry>

<spec-entry category="coding" keywords="on2,write-side,flush,cache,markexported,symmetry" date="2026-07-28" sid="S-20260728-33vb" title="写侧 O(N^2) 对称延伸规则" description="读侧缓存优化须对称延伸到写侧，循环内 mark* 仅 mutate 末次 flush" source="main@a744d88">

### 写侧 O(N^2) 对称延伸规则

读侧缓存优化（getExported 返对象引用消除逐条 JSON.parse）必须对称延伸到写侧：循环内 mark* 仅 mutate 内存缓存（exported[key]=Date.now()），循环末单次 flush（Storage.set+JSON.stringify 整个 map）。否则读侧 O(1) 而写侧仍 O(N^2)——每次 mark* 都 JSON.stringify 不断增长的整个映射 + 同步写 GM_setValue。

适用场景：任何 "已处理/已导出集合" map（bookmark exported / github exported repos / github exported gists）在批量循环内逐条标记。

反模式：markExported(bookmarkUrl) { const exported=getExported(); exported[bookmarkUrl]=Date.now(); Storage.set(KEY, JSON.stringify(exported)); }  // 循环内逐条 stringify 整个 map

正模式：markExported 改 mutate-only + 新增 markExportedAndFlush（单次调用场景）+ flushExported（循环末单次回写，if(_cache) 守卫未 mutate 缓存为 null 不写）。

检查方法：grep 'Storage.set.*JSON.stringify' 是否落在 for/while/processInBatches 循环体内；若是，且 map 随循环增长，即写侧 O(N^2)。

LD-Notion 实例：PERF-003 (BookmarkExporter.exportBookmarks) + DISCOVER P3 跨阶段延伸 (GitHubAPI markExported/markGistExported + BookmarkExporter.markExported + BookmarkAutoImporter processBookmark + GitHubExporter._exportItems) 共收敛 4 路径。

</spec-entry>
<spec-entry category="coding" keywords="TTL,存储上限,GM存储,淘汰,无界增长" date="2026-07-31" sid="S-20260731-k3tv" title="持久化存储键必须有TTL或容量上限" description="GM 存储 JSON 集合必须有 TTL 淘汰或容量截断，禁止无界增长">
### 持久化存储键必须有TTL或容量上限

持久化存储键（GM_setValue/Storage.set 的 JSON 集合）必须有 TTL 或容量上限，禁止无界增长。已处理/已导出集合类 map 在 flush 回写前调用 _evictExpired()（90 天 cutoff）；日志/历史类数组用 MAX_ENTRIES 截断（如 OPERATION_LOG=100、CHAT_HISTORY=50）。

反模式：markSeen 只增不减，集合随 sync 周期持续膨胀，单键 JSON 达数百 KB，每次 sync 全量 parse/stringify 延迟线性增加。

正模式：flush/endBatch 回写前就地淘汰过期条目（for key: if set[key] < Date.now()-TTL delete）。

检查方法：grep 'Storage.set.*JSON.stringify' 与 GM_setValue 写路径，确认有 _evictExpired 或 MAX_ENTRIES 守卫。

LD-Notion 实例：PERF-001 (DedupStore.endBatch) 泛化到 GitHubAPI.flushExported/flushGistsExported + BookmarkExporter.flushExported 共 4 路径，统一 90 天 TTL。
</spec-entry>

<spec-entry category="coding" keywords="batch-ops,contract-test,handler,template,handleBatch" date="2026-07-31" sid="S-20260731-batch" title="批量操作 handler 必须补契约测试" description="handleBatchClassify/BatchTranslate 等批量操作 handler 须补契约测试覆盖输入空间" source="harvest:P1-F4F5-refactor">

### 批量操作 handler 必须补契约测试

批量操作 handler（`handleBatchClassify`/`handleBatchTranslate`/`ExtractToDatabase`/`GeneratePages`/`BatchAnalyze`/`GitHubImport`/`BookmarkImport` 等）拆分到域模块后，必须补契约测试覆盖输入空间（正常/边界/异常）。契约测试模板：(1) 构造典型输入（含空数组/单条/多条/异常参数）；(2) mock 外部依赖（deps.js getter 注入 stub）；(3) 断言输出结构 + 副作用（调用次数/参数形状）。

判据：每个 handler 至少覆盖 happy path + empty input + error propagation 三类用例。

LD-Notion 实例：F4/F5（v3.8.0）Handlers 四域拆分后，batch.js 批量操作 handler 待补契约测试（已列入技术债）。

</spec-entry>

<spec-entry category="coding" keywords="forwarding-shell,getAISettings,explicit-api,migration,ui-caller" date="2026-07-31" sid="S-20260731-fwdsh" title="UI 调用方迁移至显式 API 表面（转发壳模式）" description="UI getSettings() 等隐式依赖调用方须迁移到显式 API 如 getAISettings()" source="harvest:P1-F4F5-refactor">

### UI 调用方迁移至显式 API 表面（转发壳模式）

当聚合层（如 ai/index.js）拆分后，外部调用方（特别是 UI 层）原先通过 `AIAssistant.getSettings()` 等隐式路径获取的配置，应迁移到显式 API 表面（如 `ai/index.js` 导出的 `getAISettings()`）。转发壳在聚合层保留同名方法委托到新模块，但新代码应直接引用显式 API。

判据：grep 拆分后聚合层 shell 的转发方法，确认 UI 层调用点是否已迁移到显式 API。未迁移的保留转发壳兼容，新代码禁止再走隐式路径。

LD-Notion 实例：F4/F5（v3.8.0）UI getSettings() callers 迁移到 `getAISettings()` in ai/index.js，转发壳保留向后兼容。

</spec-entry>
