# Harvest Plan - F4/F5 Architecture Refactor

## Source Artifacts
1. `20260731-plan-P1-ai-domain-refactor` — P1 AI 域重构执行计划
2. `roadmap-f4f5-refactor` — F4/F5架构重构 roadmap
3. `analyze-ai-domain` — AI 域静态分析报告

## Fragments Extracted & Routed

### → Spec (arch): 7 entries

#### S-F4F5-001: Locked Decision Constraints
- **Source**: roadmap-f4f5-refactor.json
- **Content**: 单文件输出不变、纯客户端架构、向后兼容是 F4/F5 的硬性约束
- **Tags**: architecture-constraints, locked-decisions

#### S-F4F5-002: F4 Monolith Classification
- **Source**: roadmap-f4f5-refactor.json
- **Content**: 6 个 >1500 LOC 巨石违反 SRP（main-ui/ai-index/Handlers/api-index/events/AgentTools）→ 全量拆分
- **Tags**: f4, monolith, srp-violation

#### S-F4F5-003: F5 Cycle Patterns
- **Source**: roadmap-f4f5-refactor.json
- **Content**: 5 类循环依赖（security↔ui via event-bus, import/bridge↔ui via _resolveUI×6, adapter↔bridge, ai internal lazy closure, ui internal binding closures）
- **Tags**: f5, circular-dependency

#### S-AI-DOMAIN-001: Deps.js Central Dependency Accessor
- **Source**: plan-P1-ai-domain-refactor/TASK-002-summary.md
- **Content**: getAI()/getState()/getService() 三件套替代 Proxy + lazy closure 组合拳，CommonJS require 缓存已提供安全保证
- **Tags**: dependency-injection, deps-pattern

#### S-AI-DOMAIN-002: Shell + Domain Modules Split Pattern
- **Source**: plan-P1-ai-domain-refactor/TASK-005~006-summary.md
- **Content**: Handlers.js 2277→48 shell + query/pageCrud/content/batch 四域；AgentTools.js 1712→21 shell + read/write/meta 三域
- **Tags**: refactor-pattern, module-splitting

#### S-AI-DOMAIN-003: installUploadMethods Injection Pattern
- **Source**: plan-P1-ai-domain-refactor/scripts/split-api-upload.js
- **Content**: upload cluster 不直接 require(index)，而是 installUploadMethods(NotionAPI) 注入式调用避免循环依赖
- **Tags**: injection-pattern, upload

#### S-AI-DOMAIN-004: Pure Function Extraction Analysis
- **Source**: analyze-ai-domain/report.md
- **Content**: 33 pure functions 可安全提取至 utils/；34 dependent functions 需依赖注入或保留在原地
- **Tags**: pure-functions, dependency-analysis

### → Spec (coding): 4 entries

#### S-CODE-001: Batch Ops Contract Test Template
- **Source**: plan-P1-ai-domain-refactor/TASK-001-summary.md
- **Content**: `handleBatchClassify/BatchTranslate/ExtractToDatabase/GeneratePages/BatchAnalyze/GitHubImport/BookmarkImport` 等批量操作 handler 必须补契约测试
- **Tags**: contract-testing, batch-ops

#### S-CODE-002: Lazy Closure Retirement Pattern
- **Source**: plan-P1-ai-domain-refactor/TASK-004-summary.md
- **Content**: Retire lazy closure 三件套 (`let _X = null`, `const X = () => (_X || (X = require(...)))`) → replace with deps.js central getter
- **Tags**: refactoring-lazy-closure

#### S-CODE-003: UI Forwarding Shell Migration
- **Source**: plan-P1-ai-domain-refactor/TASK-003-summary.md
- **Content**: UI getSettings() callers migrate to explicit API surface `getAISettings()` in ai/index.js
- **Tags**: forward-shell, migration

#### S-CODE-004: Path Adjustment After Split
- **Source**: common_pitfalls_experience (learned skill)
- **Content**: Handler file迁移后 require 路径从../升级为../../（如 batch.js import("../bridge") → ../../bridge）
- **Tags**: path-migration, pitfall

### → Wiki (note): 2 entries

#### W-ARCH-001: verify:delivery Verification Checklist
- **Source**: roadmap-f4f5-refactor.json locked_constraints
- **Content**: 构建产物等价性验证 = baseline test + bundle build + extension build + equivalence check
- **Tags**: verification, delivery-check

#### W-ARCH-002: Incremental Split Strategy
- **Source**: roadmap-f4f5-refactor.json risks/R-001
- **Content**: Risk mitigation = incremental steps per step run verify:delivery before proceeding
- **Tags**: risk-mitigation, incremental-refactor

### → Issue: 3 entries

#### ISS-F4F5-001: events.js Closure Segmentation Deferred
- **Source**: analyze-ai-domain/report.md
- **Title**: events.js bindEvents 闭包分段风险高，暂不拆散为独立模块
- **Severity**: low
- **Status**: deferred
- **Tags**: technical-debt, events-js

#### ISS-F4F5-002: 34 Dependent Functions Need Future Refactoring
- **Source**: analyze-ai-domain/report.md
- **Title**: AIAssistant 核心中有 34 个函数存在 AIAssistant.xxx 自引用，需依赖注入或上下文传递才能提取
- **Severity**: medium
- **Status**: open
- **Tags**: tech-debt, future-work

#### ISS-F4F5-003: BookmarkAdapter Dual Require Fix
- **Source**: analyzed artifact (bookmark-rss-bridge.md learned skill)
- **Title**: BookmarkAdapter 有 fallback 顶层 require("../bridge") 虽向后兼容但应文档化 ensureAdaptersRegistered 调用时机
- **Severity**: low
- **Status**: resolved (documented in commit ec3b8d4)
- **Tags**: documentation, adapter-pattern

---

**Next Steps:**
- Review wiki entries: `maestro wiki list --type note`
- Triage issues: `/maestro-issue list --source harvest`
- View specs: `maestro load --type arch` and `--type coding`
