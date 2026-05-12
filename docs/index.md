---
layout: home

hero:
  name: LD-Notion Hub
  text: AI 多源知识中枢
  tagline: 把 Linux.do、GitHub、浏览器书签、知乎与网页内容统一沉淀到 Notion / Obsidian，并用 AI 对话式管理知识工作区。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 查看架构
      link: /architecture/overview
    - theme: alt
      text: GitHub
      link: https://github.com/Smith-106/LD-Notion

features:
  - title: 多源收藏导入
    details: 从 Linux.do、GitHub、浏览器书签、知乎与通用网页收集内容，统一写入 Notion 或导出到 Obsidian。
  - title: 对话式 AI 工作区
    details: 在 Linux.do、Notion 和通用网页面板中用自然语言搜索、整理、创建、更新和总结内容。
  - title: 双形态交付
    details: 支持 Tampermonkey 用户脚本，也支持独立 Chrome 扩展，按使用场景选择。
  - title: 权限与审计守卫
    details: 写入入口统一经过 OperationGuard，按只读、标准、高级、管理员四级权限控制。
  - title: 自动化导入与去重
    details: Linux.do 与 GitHub 来源可独立配置自动导入、轮询间隔、去重策略和更新检查。
  - title: 面向发布的验证链路
    details: 提供 baseline、扩展构建、bounded profile 和 UI 手工回归清单，降低交付回归风险。
---

## 一张图理解 LD-Notion

```mermaid
flowchart LR
  Sources[内容来源\nLinux.do / GitHub / 书签 / 知乎 / 网页] --> Panel[LD-Notion 面板\n脚本版 / 扩展版]
  Panel --> Parser[解析与增强\n格式保留 / 摘要 / 分类 / 标签]
  Parser --> Guard[OperationGuard\n权限检查 / 审计 / 危险确认]
  Guard --> Notion[Notion\n数据库 / 页面 / 块]
  Parser --> Obsidian[Obsidian\nMarkdown / 附件]
  AI[AI 服务\nOpenAI / Anthropic / Gemini / 自定义端点] <--> Panel
  AI --> Parser
```

## 推荐阅读路径

1. 先看 [快速开始](/guide/getting-started)，确认你要使用脚本版还是独立扩展版。
2. 按 [Notion 配置](/guide/notion) 创建 Integration、授权并选择数据库或页面。
3. 从 [功能地图](/features/) 选择你的入口：Linux.do 导出、GitHub 导入、浏览器书签、AI 助手或网页剪藏。
4. 如果要二次开发，阅读 [整体架构](/architecture/overview) 与 [开发与验证](/development)。

## 深入理解系统

- [Concepts](/concepts/)：从机制地图理解 LD-Notion 的核心边界。
- [Routing Rules](/concepts/routing-rules)：理解来源、目标、授权、AI 和权限如何共同决定处理路径。
- [Import Pipeline](/concepts/import-pipeline)：理解内容从捕获到写入、审计和失败处理的状态流。
- [OperationGuard](/concepts/operation-guard)：理解写入动作前的权限、确认和审计网关。
- [Extension Architecture](/concepts/extension-architecture)：理解用户脚本、扩展构建和部署边界。
