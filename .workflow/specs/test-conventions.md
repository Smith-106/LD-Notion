---
title: "Test Conventions"
readMode: required
priority: high
category: test
keywords:
  - test
  - coverage
  - mock
  - fixture
  - assertion
  - framework
---

# Test Conventions

## Framework

Vitest（Node 环境），无浏览器 DOM。测试文件位于 `tests/` 目录，命名 `*.test.js`。

## Directory Structure

```
tests/
├── setup.js              # 全局 setup（GM_* mock、Storage mock）
├── legacy-harness.js     # 从 bundle 产物提取工厂的测试 harness
├── *.test.js             # 29 个测试文件，556 用例
└── scan-dangling-refs.js # 游离引用扫描工具
```

## Naming Conventions

- 测试文件：`<module-name>.test.js`（如 `sync-state.test.js`、`ai-schema.test.js`）
- 用例命名：`<ID>: <中文描述>`（如 `AT-001: 增量同步新项添加`）

## Patterns

- **契约测试**：验证模块输入/输出行为符合接口规范，不测内部实现
- **Mock 策略**：GM_xmlhttpRequest/Storage 在 setup.js 统一 mock，禁止单文件重复 mock
- **基线测试**：拆分前先补测试锁定行为，拆分后测试证明等价性

## Entries

<spec-entry category="test" keywords="source-adapter,contract-test,adapter" date="2026-06-13" title="MUST 为 SourceAdapter 建立契约测试" description="BRN-001 TS-01：新知识源接入的质量保障" sid="S-20260718-m3od">
### MUST 为 SourceAdapter 建立契约测试
每个 SourceAdapter 实现必须通过契约测试，验证 fetchIncremental/fetchAll/normalize/getDedupKey 方法的行为符合接口规范。这是新知识源接入的质量保障基础（TS-01）。
</spec-entry>

<spec-entry category="test" keywords="sync-state,incremental,test" date="2026-06-13" title="MUST 为 SyncState 建立增量同步测试" description="BRN-001 TS-02：数据一致性关键路径" sid="S-20260718-0ygs">
### MUST 为 SyncState 建立增量同步测试
统一 SyncState 管理必须覆盖增量同步的关键路径：新项添加、已存在项跳过、watermark 更新、边界条件（TS-02）。
</spec-entry>

<spec-entry category="test" keywords="test,gap,integration,关键路径,集成测试" date="2026-06-20" title="关键业务路径集成测试缺失（delivery-check 4.5/10）" description="TST-001/TST-002 交付前检查：纯函数覆盖好但端到端集成零覆盖" sid="S-20260718-ix3a">
### 关键业务路径集成测试缺失（delivery-check 4.5/10）
349 个单元测试全绿但测试有效性仅 4.5/10。关键缺口：(1) LinuxDo 导出流程端到端（帖子抓取→规范化→AI分类→Notion写入）零覆盖；(2) 自动同步集成测试（GitHub/书签/RSS 的 run() 完整流程）未测试；(3) 网络错误边界（超时、429/403、畸形JSON）未覆盖；(4) AI 请求/响应链（三大服务商）无测试；(5) Exporter 核心模块无测试文件。需优先补充集成测试。
- **证据来源**: TST-001 report.json, delivery-check.md §二, AUD-001 audit-report.md
- **状态更新** (v3.8.0): 测试已从 349 增长到 556，新增 AI Schema/Trace/Handlers、API 模块、UI 基线等覆盖，但端到端集成测试仍缺失
</spec-entry>

<spec-entry category="test" keywords="UAT,diagnosis,fixed,gap,P1" date="2026-06-20" title="UAT 4 pass / 6 pending（6 gap 经 DBG-002 诊断后全部修复验证通过）" description="TST-003 UAT: 构建/权限/版本/回滚通过，6 功能缺口经诊断修复后验证通过" sid="S-20260718-kf6l">
### UAT 4 pass / 6 pending（6 gap 经 DBG-002 诊断后全部修复验证通过）
P1 交付前 UAT 共 10 项：4 项直接通过（构建语法、权限域、版本号、回滚方案），6 项 pending（LinuxDo 导出/GitHub 导入/AI 安全/书签同步/RSS 拉取/工作区可视化）。6 个 pending 项经 DBG-002 诊断根因→PLN-002 制定修复计划→EXC-001 执行修复→VRF-001 验证，全部 24 条 must-have 标准 coverage=1.0，349/349 测试通过。
- **证据来源**: TST-003 uat.md, VRF-001 verification.json
</spec-entry>