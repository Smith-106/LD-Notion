---
type: finding
slug: harvest-analysis-single-file-coupling
title: 单文件26K行物理耦合（已解决）
tags: arch, codebase, resolved
source: ANL-001
source_type: analysis
date: 2026-06-13
resolved: 2026-08-01
---

~~LD-Notion Hub 主代码库为单文件 Userscript（26261 行），30+ 逻辑模块通过对象字面量命名空间隔离，物理耦合于同一文件。~~

**已解决** (v3.7.0+): 源码已拆分为模块化 `src/` 目录（56 文件，25K LOC），经 esbuild 打包为单文件 `.user.js` 产物。内部模块独立、可测试、可维护，对外仍保持单文件分发。

当前架构：`src/` 6 层分层（UI/服务/安全/协调/存储/适配），AI 域采用 Shell+Domain Modules 模式，事件总线解耦循环依赖。
