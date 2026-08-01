# verify:delivery 验证清单

## 来源
- F4/F5 架构重构 roadmap（locked_constraints）
- v3.8.0 发布验证

## 验证清单（4 步）

```
1. Baseline test    — npx vitest run（全量绿）
2. Bundle build     — npm run build（Userscript 产物生成）
3. Extension build  — npm run build:extension（Chrome Extension 产物生成）
4. Equivalence check — npm run verify:delivery（双形态等价性 + 测试回归）
```

## 判据
- 每步拆分/重构后必须跑完整 4 步
- Baseline test 失败 → 立即回滚
- Bundle size 偏差 >5% → 检查是否意外引入依赖
- Extension smoke test → 手动验证 popup + content-script 基本功能

## LD-Notion 实例
v3.8.0 F4/F5 重构：556 tests passed, build 1351.9 KB, verify:delivery Chrome Extension + Userscript 双形态通过。
