---
title: "Quality Rules"
readMode: required
priority: medium
category: review
keywords:
  - quality
  - lint
  - rule
  - enforcement
---

# Quality Rules

## Entries

<spec-entry category="review" keywords="test-baseline,verify-delivery,regression,green" date="2026-07-31" sid="S-20260731-qbase" title="任何代码变更必须通过 verify:delivery 全绿" description="拆分/重构/修复后必须跑完整 4 步验证" source="harvest:P1-F4F5-refactor">

### 任何代码变更必须通过 verify:delivery 全绿

代码变更（包括拆分、重构、修复）后必须跑完整验证梯度：(1) npx vitest run（556 用例全绿）；(2) npm run build（产物生成）；(3) npm run build:extension（Extension 产物）；(4) npm run verify:delivery（双形态等价性）。任何一步失败禁止合并。

</spec-entry>

<spec-entry category="review" keywords="coverage,contract-test,new-module,handler" date="2026-07-31" sid="S-20260731-qcov" title="新模块/新 handler 必须附带契约测试" description="新增模块或 handler 必须同步提交契约测试" source="harvest:P1-F4F5-refactor">

### 新模块/新 handler 必须附带契约测试

新增模块或 handler 必须同步提交契约测试，覆盖 happy path + empty input + error propagation 三类用例。禁止“先写代码后补测试”——测试是拆分等价性证明的必要条件。

</spec-entry>

<spec-entry category="review" keywords="bundle-size,regression,5-percent,dependency" date="2026-07-31" sid="S-20260731-qsize" title="Bundle size 偏差 >5% 必须审查" description="构建产物体积偏差超过 5% 必须检查是否意外引入依赖" source="harvest:P1-F4F5-refactor">

### Bundle size 偏差 >5% 必须审查

构建产物体积与上次发布版偏差超过 5% 时，必须检查是否意外引入新依赖或死代码未清理。当前基线：1351.9 KB（未压缩）/ 785.1 KB（--minify）。

</spec-entry>
