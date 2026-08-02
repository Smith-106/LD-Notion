---
title: "Architecture Constraints"
readMode: required
priority: high
category: arch
keywords:
  - architecture
  - module
  - layer
  - boundary
  - dependency
  - structure
---

# Architecture Constraints

## Module Structure

模块化源码位于 `src/`，经 esbuild 打包为单文件 `.user.js`。主要分层：
- **UI 层**: `src/ui/`（main-ui/events/notion-site-ui/generic-ui/workspace-visual）
- **服务层**: `src/ai/`、`src/api/`、`src/extract/`、`src/export/`、`src/import/`、`src/bridge/`
- **安全层**: `src/security/`（OperationGuard/UrlValidator）
- **协调层**: `src/coordination/`（UICommandService/event-bus）
- **存储层**: `src/storage/`（SyncState/DedupStore）
- **适配层**: `src/adapter/`（AdapterRegistry + 6 个 SourceAdapter）

## Layer Boundaries

- UI 层可调用服务层，禁止反向（服务层不 require UI）
- 安全层被服务层调用，不主动依赖上层
- 跨层通知走 event-bus（零依赖），禁止底层 require 上层

## Dependency Rules

- 新模块间依赖优先走 `deps.js` getter，禁止新增 lazy closure
- 循环依赖消除三解法：提取共享依赖 / lazy accessor / 事件总线
- 提取模块需挂载回源对象时用 `installXxxMethods(Obj)` 注入模式

## Technology Constraints

- 纯客户端架构，无服务端依赖
- 零生产依赖（dev: esbuild/vitepress/vitest）
- CommonJS 模块系统（esbuild 打包）
- 单文件输出不变（Locked）
- Chrome Extension 双形态（Locked）

## Entries

<spec-entry category="arch" keywords="build,upgrade,priority,esbuild,rollup,模块拆分" date="2026-06-13" title="构建系统升级优先于功能升级" description="ANL-001 决策：先完成模块拆分+构建工具，再做功能升级" sid="S-20260718-rhpa">
### 构建系统升级优先于功能升级
26K行单文件是所有 Active Requirements 实现的前置障碍。决策：先完成模块拆分+构建工具引入，再做功能升级。Option 1（一次性解决架构约束）优于 Option 2（单文件内逐步拆分）和 Option 3（重写为模块化项目）。
- **证据来源**: ANL-001 codebase exploration (26261 lines, 30+ modules)
- **影响**: 前置投入，解锁后续所有功能升级
</spec-entry>

<spec-entry category="arch" keywords="security,immediate,fix,connect,api-key" date="2026-06-13" title="安全加固立即执行" description="ANL-001/DBG-001 决策：@connect 白名单+API Key加密不延后" sid="S-20260718-twu9">
### 安全加固立即执行
@connect * 和 API Key 明文存储是已确认的高危漏洞。决策：立即修复 @connect 白名单 + API Key 加密，独立于模块拆分并行推进。安全漏洞修复优先级高于功能升级。
- **证据来源**: LinuxDo-Bookmarks-to-Notion.user.js:42 (connect), Storage.set() (line ~590)
</spec-entry>

<spec-entry category="arch" keywords="single-file,output,userscript,zero-deploy" date="2026-06-13" title="单文件输出不变(Locked)" description="ANL-001 锁定约束：构建产物仍为单 .user.js 文件" sid="S-20260718-j5m3">
### 单文件输出不变(Locked)
构建产物必须仍为单 .user.js 文件，保持零部署门槛。模块拆分是内部重构，不影响用户安装体验。
</spec-entry>

<spec-entry category="arch" keywords="client-side,pure,no-server,GM_xmlhttpRequest" date="2026-06-13" title="纯客户端架构(Locked)" description="ANL-001 锁定约束：无服务端，所有 API 调用通过 GM_xmlhttpRequest 或 fetch" sid="S-20260718-8208">
### 纯客户端架构(Locked)
所有 API 调用通过 GM_xmlhttpRequest 或 fetch，不引入服务端依赖。MUST NOT 引入外部数据库依赖（SA-07）。
</spec-entry>

<spec-entry category="arch" keywords="backward-compatible,upgrade,smooth" date="2026-06-13" title="向后兼容(Locked)" description="ANL-001/BRN-001 锁定约束：已有功能不能破坏" sid="S-20260718-hazr">
### 向后兼容(Locked)
已有功能不能破坏，升级路径平滑。MUST NOT 破坏已有功能（SA-08）。支持渐进式升级：分库→统一库（PM-06）。
</spec-entry>

<spec-entry category="arch" keywords="build-tool,esbuild,rollup,source-adapter" date="2026-06-13" title="MUST 引入构建工具+设计 SourceAdapter" description="BRN-001 SA-01/SA-03：构建工具和 SourceAdapter 是 MUST" sid="S-20260718-7gaw">
### MUST 引入构建工具+设计 SourceAdapter
SA-01: MUST 引入构建工具（esbuild/rollup），将模块拆分为独立源文件。SA-03: MUST 设计 SourceAdapter 抽象层，作为新知识源接入的标准接口。
</spec-entry>

<spec-entry category="arch" keywords="M1,release,gate,条件性PASS,交付" date="2026-06-20" title="M1 条件性 PASS 关闭：critical/high 清零即可发布" description="AUD-001 审计结论：v3.7.0 发布无需所有问题清零，critical/high 清零即可" sid="S-20260718-ddp4">
### M1 条件性 PASS 关闭：critical/high 清零即可发布
M1 以条件性 PASS 关闭：所有 critical/high 评审发现已修复（REV-001: 8C+24H=32项全修，REV-002: 6 UAT gap 全修验证通过），349/349 测试通过，构建与交付验证全绿。剩余 low/medium 问题不阻塞 v3.7.0 发布，列入后续迭代计划（P1×4 + P2×5 + P3×3）。
- **证据来源**: AUD-001 audit-report.md, REV-001 fix-plan.md (F1-F29 全部✅), VRF-001 (coverage 1.0, 349/349)
</spec-entry>

<spec-entry category="arch" keywords="review,fix,verified,P1,99发现" date="2026-06-20" title="REV-001 评审 99 发现全部修复（F1-F29）" description="P1 架构升级深度评审：8C+24H+56M+4L 全部修复，verdict BLOCK→PASS" sid="S-20260718-bl7f">
### REV-001 评审 99 发现全部修复（F1-F29）
P1 架构升级深度评审发现 99 个问题（8 critical, 24 high, 56 medium, 11 low），经 4 波修复全部解决：Wave1 Critical 正确性+架构（F1-F5）、Wave2 High 安全+正确性（F6-F12）、Wave3 Medium 正确性+性能+最佳实践（F13-F23）、Wave4 Low 简单项（F24-F26）+ 额外修复（F27-F29）。关键修复：V1/V2 双写消除、XSS 修堵、DedupStore batch、God module 拆分。
- **证据来源**: REV-001 fix-plan.md, commits da7f4e7/e99b460/0d73834
</spec-entry>

<spec-entry category="arch" keywords="review,pre-delivery,verified,UAT,6gap" date="2026-06-20" title="REV-002 交付前评审 79 发现——6 UAT gap 已修复" description="P1 交付前评审：79发现（6C+30H+32M+11L），6 UAT gap 经 DBG-002 诊断+PLN-002/EXC-001 修复+VRF-001 验证" sid="S-20260718-yua8">
### REV-002 交付前评审 79 发现——6 UAT gap 已修复
P1 交付前评审发现 79 个问题（6 critical, 30 high, 32 medium, 11 low），其中 6 个 UAT gap 经完整修复链闭环：DBG-002 诊断 6 个 cluster（8 critical + 6 high root causes）→ PLN-002 制定 6 任务修复计划 → EXC-001 并行执行 5+1 波修复 → VRF-001 验证 24 条 must-have 标准 coverage=1.0。issues_created 为空，UAT gap 不再新增 issue（已直接修复）。
- **证据来源**: REV-002 review.json, DBG-002 diagnosis-summary.json, VRF-001 verification.json
</spec-entry>

<spec-entry category="arch" keywords="architecture,yagni,abstraction,refactor,核验" date="2026-06-24" title="YAGNI：核验已满足后不引入新抽象" description="计划任务先核验现状，已满足则不引入新抽象避免过度工程" source="plan:PLN-004" sid="S-20260718-sync">

### YAGNI：核验已满足后不引入新抽象

执行计划任务前必须先核验当前代码状态是否已满足收敛条件。若计划提议的抽象（如 normalizeValue 类型转换、state-manager.js 订阅模式）要解决的问题在现有代码中不存在（如 GM_getValue 已保留原始类型无 'true' 字符串 bug、业务状态已是纯 JS 对象非 DOM 推断），则不引入该抽象——引入会违反 '拥抱极致简洁、不引入新框架' 约束，增加维护成本和风险（如 subscribe 内存泄漏）。LD-Notion 实例：PLN-004 的 TASK-004（normalizeValue）和 TASK-005（state-manager.js）经核验现有代码已实质满足，未改动代码，避免过度工程。决策依据：coding philosophy 的 'Be pragmatic — Code must solve real-world problems, not hypothetical ones' 和 'Avoid premature abstractions'。

</spec-entry>

<spec-entry category="arch" keywords="ui,scope,roadmap,一致性,locked" date="2026-06-24" title="UI 一致性优化范围界定：非改版，遵守锁定约束" description="UI 一致性优化非改版，遵守单文件/纯客户端/向后兼容锁定约束" source="analyze:ANL-002" sid="S-20260718-vdv5">

### UI 一致性优化范围界定：非改版，遵守锁定约束

UI/UX 优化类任务必须区分'一致性优化'与'改版'。一致性优化：收敛硬编码值到 token、补全可访问性属性、统一交互状态行为，视觉数值 1:1 保留，不改变现有外观。改版：重新设计视觉、改变布局、新增组件库——属 roadmap Out of Scope。LD-Notion 锁定约束（不可违反）：单文件 Userscript 输出不变、Chrome Extension 双形态保留、纯客户端架构（无服务端）、向后兼容（不破坏现有功能和公共 API）、不引入新框架（继续原生 JS + 现有工具链）。ANL-002 scope_verdict=medium，明确 UI/UX 全面改版、新增设计系统库、SSR、移动端原生适配、引入 TypeScript 均为 Deferred/Out of Scope。

</spec-entry>

<spec-entry category="arch" keywords="cwe-312,api-key,hash,cache,credential,fingerprint" date="2026-07-18" sid="S-20260718-zpbu" title="缓存指纹字段须单向哈希，禁止明文 key 子串（CWE-312）" description="缓存指纹字段须单向哈希禁止明文key子串，延伸 arch-constraints-002" source="fix/legacy-test-infrastructure-and-bundle-sync@07038b9">

### 缓存指纹字段须单向哈希，禁止明文 key 子串（CWE-312）

持久化到存储（GM_setValue/Storage）的缓存指纹字段（如 apiKeyHash 用于缓存失效比较）禁止用明文密钥子串（apiKey.slice(-8)），须用单向哈希。

根因：apiKeyHash 既不参与鉴权（仅做相等性比较判断缓存是否失效），明文子串无功能收益却泄露密钥材料。Notion 集成 key 格式 secret_+49字符（共56），slice(-8) 泄露末8字符约14%密钥材料。攻击者读取 GM 存储（恶意扩展/共享设备/同 @match 页面其他 userscript）可零成本获部分密钥，配合其他泄露降低暴力破解熵。WORKSPACE_PAGES 等缓存键不在 CredentialVault.SENSITIVE_KEYS 集合内，以明文 JSON 存储。

正确模式：非可逆32位哈希（(h<<5)-h+charCodeAt|0 → abs → toString(36)）已足做相等性比较且无法逆推；高敏感场景用 SubtleCrypto SHA-256 截断。LD-Notion 已有 Utils.apiKeyHash(apiKey) 封装参考。

向后兼容：算法变更后旧缓存值（明文子串或旧哈希）与新值不等 → 触发刷新（用户重新拉取），不丢数据。所有读写点必须用同一函数（写入点 + N 个读取点），避免读写算法不一致导致永久失配或泄露。

延伸 architecture-constraints-002（API Key 加密）：不仅 API Key 本身要加密，派生指纹字段也不可暴露 key 子串。

LD-Notion 实例：fix/legacy-test-infrastructure-and-bundle-sync 分支 dc8ec85 抽 Utils.apiKeyHash，消除 extract/index.js:255/377 + src/ai/AgentTools.js:267-268（W6-1 从 ai/index.js:1140 提取）+ generic-ui.js:428 + main-ui.js:1121 共5处 slice(-8)。

</spec-entry>

<spec-entry category="arch" keywords="ai-schema,parseaijson,seam,architecture,iss-010" date="2026-07-24" sid="S-20260724-g5i6" title="AI JSON 消费统一入口 parseAIJson 接缝" description="AI JSON 消费统一入口，ai/index.js 拆分接缝" source="harvest:2026-07-24-odyssey-sessions">

### AI JSON 消费统一入口 parseAIJson 接缝

AI 输出消费点收敛为 AISchema.parseAIJson(name, rawText) 统一入口，按 name 路由结构校验。W1-W8（ISS-20260723-010）已将 ai/index.js 从 7090 行巨石拆分为 7 模块（AgentTools 1715/Handlers 2281/BlockConverter 237/NameResolver 103/schema 240/AgentTrace 150/index 3036 聚合 re-export；AgentTrace 为 ISS-012 MAINT-002 新增 observability 模块）。schema 层（src/ai/schema.js）不依赖 ai/index.js，只依赖 UrlValidator，可独立测试（57 契约用例，含 W8 bookmarkSummary 7 例 + ISS-013 editPlan 4/generatePages 4/agentPlan 4/intent 5）。ISS-013（commit 818860b，2026-07-28）已将全部 8 处 AI JSON 消费点收敛至 parseAIJson（含 editPlan/generatePages/agentPlan/intent 4 处迁移），手工三段式残留 0 处，ISS-20260727-013 已关闭。当前 6 处生产调用全走接缝（extractToDatabase/bookmarkSummary/editPlan/generatePages/agentPlan/intent）。parseAIJson name 路由表：{extractToDatabase, bookmarkSummary, editPlan, generatePages, agentPlan, intent} 走结构校验；toolCall name 仅返 parsed（结构校验由消费点 _tryParseToolCall 单独做，因其 JSON 形状含 "tool" 锚字段非通用 \{[\s\S]*\}）。新增 AI JSON 消费点应一律走 parseAIJson，禁止再内联三段式。

</spec-entry>

<spec-entry category="arch" keywords="object-assign,mixin,split,refactor,委托化,arch-001" date="2026-07-27" sid="S-20260727-50n2" title="Object.assign mixin 拆分时保留机制非删机制" description="Object.assign mixin 拆分保留机制非删机制，拆分被 mixin 方法集时保留 Object.assign 行" source="harvest:2026-07-27-odyssey-iss010-w6-2">

### Object.assign mixin 拆分时保留机制非删机制

当一个模块通过 Object.assign(A, B) 把 B 的多个方法 mixin 进 A（如 ai/index.js 的 Object.assign(AIAssistant, AIHandlers) 把 27 个 handler 方法合并进 AIAssistant），拆分 B 到独立文件时禁止删除 mixin 机制本身——只改 B 的来源从内联定义变为 require，保留 Object.assign 行不变。

根因：A 内部大量调用 A._xxx（被 mixin 进来的方法）是通过 A 的属性访问，若拆 B 到独立模块后改为 B._xxx 调用，需改 A 内 N 处调用点，且 A 可能被外部按 A._xxx 引用（公共 API）。保留 Object.assign 让 B 的方法仍以 A 属性形式暴露，调用点零改动，拆分是内部实现迁移非接口变更。

正确模式：B 的方法定义独立到模块（如 src/ai/Handlers.js 导出 AIHandlers 对象）→ A 顶部 require('../ai/Handlers') → 保留 Object.assign(A, AHandlers) 行 → A 内 A._xxx 调用全部继续生效。拆分前后 A 的公共接口（A._xxx 可达性）不变。

判据：拆分被 mixin 的方法集时，grep 调用点用 A._xxx 还是 B._xxx——若全用 A._xxx（含外部引用），必须保留 Object.assign；仅当所有调用点都改用 B._xxx 且无外部依赖时才可删 mixin。与 coding-conventions-005（lazy accessor 注入）不同：005 的 Object.assign 是注入 _accessor 槽位（运行时解析依赖），本条是合并方法集（静态接口保持）。

LD-Notion 实例：ISS-20260723-010 W6-2（ARCH-001/004），AIHandlers 27 方法 2400 行从 ai/index.js 提取到 src/ai/Handlers.js，保留 Object.assign(AIAssistant, AIHandlers)（require 来源），AIAssistant 内 handleQuery/handleBatchClassify 等 27 处 A._xxx 调用零改动，7 契约单测验证 mixin 机制保留。

</spec-entry>

<spec-entry category="arch" keywords="refactor,monolith-method,test-baseline,forwarder,转发壳,arch-009,arch-001" date="2026-07-27" sid="S-20260727-9s4b" title="巨石方法跨块耦合：先补测试基线再提取转发壳" description="巨石方法跨块耦合先补测试基线再提取转发壳，禁止直接拆块断调用点" source="harvest:2026-07-27-odyssey-iss010-w2-w4">

### 巨石方法跨块耦合：先补测试基线再提取转发壳

拆分被多处跨块调用的巨石方法（如 ai/index.js 的 _textToBlocks 被 9 处跨块调用）时，必须按「先补测试基线 → 再提取独立模块 + 转发壳 → 验证调用点零改动」顺序，禁止直接拆块。

根因：巨石方法被 N 处调用点引用（同文件 + 跨文件），直接拆到独立模块会断所有调用点，且无测试基线无法验证拆分前后行为契约等价。先补契约测试锁定当前行为（输入→输出/副作用），再提取时转发壳（原位置保留同名函数转发到新模块）让调用点零改动，测试自动验证等价性。

正确模式：(1) 先补测试基线——为巨石方法的输入空间（边界/正常/异常）写契约用例（如 _textToBlocks 的 27 用例覆盖 text/blocks/children 全路径），全部绿；(2) 提取独立模块——方法体原样移到新模块（如 src/ai/BlockConverter.js），不改逻辑；(3) 转发壳——原位置保留同名函数，体内 return 新模块的导出（如 _textToBlocks = (...args) => BlockConverter.textToBlocks(...args)）；(4) 跑测试基线——全绿即等价性证明，调用点零改动。

判据：grep 巨石方法被调用次数 >3 且跨文件 → 必须走测试基线 + 转发壳；调用点 ≤3 且同文件 → 可直接拆 + 改调用点。转发壳是临时桥接，可后续迭代清理调用点后移除，但拆分当下必须保留以保证零回归。

LD-Notion 实例：ISS-20260723-010 W2（_textToBlocks 27 契约用例）→ W4（BlockConverter 提取 + _textToBlocks 转发壳），调用点 9 处零改动，27 用例 + verify:equivalence 验证拆分等价。

</spec-entry>
<spec-entry category="arch" keywords="循环依赖,事件总线,解耦,延迟加载" date="2026-07-31" sid="S-20260731-m8qc" title="security与ui循环依赖须解耦" description="security↔ui 循环依赖靠延迟 require 绕行属临时方案，演进方向为事件总线解耦">
### security与ui循环依赖须解耦

security↔ui 循环依赖当前靠运行时延迟 require（security/index.js 的 _resolveUI）绕行，属临时方案。约束：(1) 新增跨模块调用禁止再引入新的循环边（如 security 直接 require ui 顶层导出）；(2) 长期演进方向为事件总线解耦——security 发事件（如 operation-logged），ui 订阅刷新，消除 security 对 ui 的反向感知。

检查方法：新增 require 前确认依赖方向为 ui→security 单向；grep 'require("../ui")' 不应出现在 security/adapter/storage 等底层模块顶层。

LD-Notion 实例：security/index.js _resolveUI 延迟 require（UI.updateLogPanel 刷新）；SyncCoordinator→adapter/index→BookmarkAdapter→bridge→SyncCoordinator 同类环靠 ensureAdaptersRegistered 延迟注册。
</spec-entry>

<spec-entry category="arch" keywords="deps.js,dependency-injection,getAI,getState,getService,lazy-closure" date="2026-07-31" sid="S-20260731-deps" title="deps.js 中央依赖访问器替代 lazy closure 组合拳" description="F4/F5 AI 域拆分引入 deps.js 三件套 getAI/getState/getService 替代散落 lazy closure" source="harvest:P1-F4F5-refactor">

### deps.js 中央依赖访问器替代 lazy closure 组合拳

F4/F5 AI 域拆分引入 `src/ai/deps.js` 作为中央依赖访问器，提供 `getAI()`/`getState()`/`getService()` 三件套，替代原先散落在各模块的 lazy closure 组合拳（`let _X = null; const X = () => (_X || (_X = require(...)))`）。CommonJS require 缓存已提供安全保证，无需额外同步机制。迁移时三件套统一入口降低认知负荷，且便于未来切换为真正的 DI 容器。

判据：新模块间依赖优先走 deps.js getter，禁止新增 lazy closure 模式。已有 lazy closure 可在下次触碰时渐进迁移。

LD-Notion 实例：F4/F5 AI 域重构（v3.8.0），Handlers 四域 + AgentTools 三域统一通过 deps.js 获取 AIAssistant/Storage/bridge 依赖。

</spec-entry>

<spec-entry category="arch" keywords="shell-domain-split,handlers,agenttools,forwarding,object-assign" date="2026-07-31" sid="S-20260731-shdom" title="Shell + Domain Modules 拆分模式（F4 完成实例）" description="Handlers 2277→48 shell + 四域；AgentTools 1712→21 shell + 三域，Object.assign mixin 保留公共接口" source="harvest:P1-F4F5-refactor">

### Shell + Domain Modules 拆分模式（F4 完成实例）

巨石方法集拆分为「转发壳 + 域模块」两步模式：(1) 原文件保留 shell（仅含公共接口 + Object.assign mixin 注入），方法体委托到域模块；(2) 域模块按职责域独立文件（如 query/pageCrud/content/batch），导出方法集供 shell Object.assign 注入。

关键约束：shell 内 `A._xxx` 调用零改动（Object.assign 保持公共接口不变），域模块纯函数可直接单测。与 S-20260727-50n2（Object.assign mixin 保留机制）配合使用。

LD-Notion 实例：F4/F5（v3.8.0）Handlers.js 2277→48 LOC shell + `src/ai/handlers/{query,pageCrud,content,batch}.js` 四域；AgentTools.js 1712→21 LOC shell + `src/ai/tools/{read,write,meta}.js` 三域。

</spec-entry>

<spec-entry category="arch" keywords="installUploadMethods,injection,upload,circular-dependency,notion-upload" date="2026-07-31" sid="S-20260731-upinj" title="installUploadMethods 注入模式避免 upload 循环依赖" description="upload cluster 不直接 require NotionAPI 定义文件，改为 installUploadMethods(NotionAPI) 注入式挂载" source="harvest:P1-F4F5-refactor">

### installUploadMethods 注入模式避免 upload 循环依赖

当提取模块的方法需要挂载回源模块的 prototype/对象上时（如 upload cluster 方法需作为 NotionAPI 的静态方法），禁止提取模块直接 require 源模块（会形成循环依赖）。正确模式：提取模块导出 `installXxxMethods(SourceObj)` 函数，源模块在初始化阶段调用注入。

与 Object.assign mixin（S-20260727-50n2）区别：mixin 是同一对象的方法集合并；installXxx 是跨文件的方法注入，注入目标由调用方传入，提取模块对目标零感知。

LD-Notion 实例：F4/F5 API 域拆分（v3.8.0），`src/api/notion-upload.js` 导出 `installUploadMethods(NotionAPI)` 将 createFileUpload/uploadFileToNotion 等 8 方法挂载到 NotionAPI，`src/api/index.js` 在 module.exports 前调用注入。

</spec-entry>

<spec-entry category="arch" keywords="pure-function,extraction,utils,dependency-analysis,AIAssistant" date="2026-07-31" sid="S-20260731-pure" title="纯函数提取 vs 依赖函数保留的判定准则" description="33 pure functions 可安全提取至 utils/；34 dependent functions 需依赖注入或保留原地" source="harvest:P1-F4F5-refactor">

### 纯函数提取 vs 依赖函数保留的判定准则

巨石模块拆分时，函数按依赖关系分两类：(1) pure functions（无外部模块依赖，仅操作输入参数）→ 安全提取至 utils/ 独立文件，可直接单测；(2) dependent functions（依赖 AIAssistant/Storage/bridge 等外部上下文）→ 需依赖注入（deps.js getter）或保留在 shell 中。

判定方法：静态分析函数体内 require/import 引用——零外部引用为 pure，否则为 dependent。

LD-Notion 实例：F4/F5 AI 域分析，33 pure functions 提取至 `src/ai/utils/`（4 文件）；34 dependent functions 保留在 Handlers/AgentTools shell 中通过 deps.js 获取依赖。34 个 dependent functions 为后续技术债（ISS-20260728-016）。

</spec-entry>

<spec-entry category="arch" keywords="大文件拆分,SRP,重构规划,转发壳" date="2026-07-31" sid="S-20260731-p5wn" title="大文件拆分与循环依赖属独立milestone" description="F4/F5 架构级重构禁止顺带展开，须独立 milestone 按测试基线+转发壳流程执行">
### 大文件拆分与循环依赖属独立milestone

F4（6 个文件 >1500 LOC 违反 SRP：main-ui.js 2700 / ai/index.js 2483 / Handlers.js 1909 / api/index.js 1802 / events.js 1732 / AgentTools.js 1527）与 F5（循环依赖消除）为架构级重构，禁止在常规 bugfix/audit 修复中顺带展开。

必须作为独立 milestone 规划，按既定流程执行：(1) 先补测试基线（契约用例覆盖输入空间）→ (2) 提取独立模块（原样移动不改逻辑）→ (3) 原位置保留转发壳（调用点零改动）→ (4) 全绿验证等价性。参照 BlockConverter 拆分先例（ISS-20260723-010）。
</spec-entry>


<spec-entry category="arch" keywords="event-bus,circular-dependency,decoupling,resolveui,emit,coordination" date="2026-08-02" sid="S-20260802-cppl" title="事件总线解耦模式：零依赖 event-bus 替代 _resolveUI lazy require" source="harvest:TLV4-sessions-20260801">

### 事件总线解耦模式：零依赖 event-bus 替代 _resolveUI lazy require

当 security/import/bridge 层需要通知 UI 层时，禁止 _resolveUI() lazy require 模式（运行时脆弱、时序敏感），改为零依赖事件总线：src/coordination/event-bus.js（65 LOC，无任何 require 调用）提供 on/off/emit API。写侧 emit(oplog:changed/notify/sync:center-summary-updated/bookmarks:updated)，UI 侧 main-ui.js 初始化后 on() 订阅。设计原则：(1) 零外部依赖确保不引入新循环；(2) 无订阅者时 emit 静默失败不抛错；(3) 同步阻塞调用；(4) handler 异常不中断其他 handler（try-catch + console.error）；(5) 订阅晚于 emit 安全（lazy subscription）。LD-Notion 实例：TLV4-ui-eventbus T3/T4 消除 security-ui + import/bridge-ui 共 7 处 _resolveUI，117/117 测试通过。

</spec-entry>

<spec-entry category="arch" keywords="api-split,module-extraction,forwarding-shell,task-ordering,monolith" date="2026-08-02" sid="S-20260802-7jrs" title="API 域拆分蓝图：巨石 index.js 到职责单一模块 + 转发壳" source="harvest:TLV4-sessions-20260801">

### API 域拆分蓝图：巨石 index.js 到职责单一模块 + 转发壳

api/index.js 1802 LOC 拆分为 5 模块的已验证实例：constants.js（SiteDetector/InstallHelper/EMOJI_MAP/NOTION_LANGUAGES，137 LOC 零依赖）、DOMToNotion.js（470 LOC）、obsidian.js（ObsidianAPI+HTMLToMarkdown 合并 221 LOC，同场景服务）、notion-upload.js（upload 簇 272 LOC，installUploadMethods 注入）、index.js 保留核心+转发壳（约717 LOC）。执行顺序依赖感知：T1 测试基线先行 - T5 constants 先于 T2 DOMToNotion（避免循环引用）- T3 可并行 - T4 upload 最后（与 request 核心耦合最紧）- T6 全量验证。约束：module.exports 名单 10 项不变，15 个外部引用文件零改动，legacy-harness FACTORY_NAMES require_api 保留。

</spec-entry>

<spec-entry category="arch" keywords="gm-xmlhttprequest,upload,binary,multipart,design-intent" date="2026-08-02" sid="S-20260802-579u" title="二进制上传保留 GM_xmlhttpRequest 直接调用（multipart 设计意图）" source="harvest:TLV4-sessions-20260801">

### 二进制上传保留 GM_xmlhttpRequest 直接调用（multipart 设计意图）

notion-upload.js 的 sendFilePart/uploadFileContent 绕过 NotionAPI.request 核心直接调用 GM_xmlhttpRequest 是设计意图而非技术债：multipart binary 传输需要精确控制 Content-Type（application/octet-stream + part boundary），request 核心的 JSON 封装不适用。提取时保留直接调用，仅将 NotionTransport.buildUrl + NotionOAuth.getAccessToken 作为依赖注入传入。判据：凡绕过统一请求层的直接网络调用，确认是否为二进制/流式场景设计意图；是则保留并文档化，否则收敛到统一层。

</spec-entry>