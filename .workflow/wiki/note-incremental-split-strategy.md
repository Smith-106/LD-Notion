# 增量拆分策略

## 来源
- F4/F5 架构重构 roadmap（risks/R-001）
- BlockConverter 拆分先例（ISS-20260723-010）

## 策略原则

巨石文件拆分禁止一步到位，必须按增量步骤执行：

```
Step 1: 补测试基线（契约用例覆盖输入空间）
Step 2: 提取最小域模块（原样移动，不改逻辑）
Step 3: 原位置保留转发壳（调用点零改动）
Step 4: 跑 verify:delivery（全绿 = 等价性证明）
Step 5: 重复 Step 2-4 直到拆分完成
```

## 风险控制
- 每步 run verify:delivery before proceeding
- 单步失败可精确回滚到上一个绿点
- 禁止在常规 bugfix/audit 中顺带展开架构级拆分

## LD-Notion 实例
F4 Handlers.js: 2277→48 LOC，分 5 步（test baseline → query 域 → pageCrud 域 → content 域 → batch 域），每步 verify:delivery 全绿。
F5 循环依赖: event-bus.js 零依赖模块先行，5 类循环边逐条消除。
