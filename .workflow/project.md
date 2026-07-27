# Project: LD-Notion Hub

## What This Is

多源知识获取与整理系统。将 LinuxDo、GitHub、浏览器书签等多源知识统一采集、智能分类、导出到 Notion，并提供 AI 对话式工作区管理。面向 LinuxDo 社区的高级用户和知识工作者。

## Core Value

**知识从获取到整理的完整闭环** — 从信息源头（论坛、代码仓库、书签）到结构化知识库（Notion），每一步都可自动化、可 AI 增强。

## Requirements

### Validated

- [x] LinuxDo 帖子导出到 Notion 数据库（筛选、格式转换、图片处理）
- [x] OAuth + Manual API Key 双认证模式
- [x] AI 自动分类与批量打标签（OpenAI/Anthropic/Gemini 多服务商）
- [x] AI 对话式助手（自然语言管理 Notion 工作区）
- [x] GitHub Stars/Repos/Forks/Gists 导入
- [x] 浏览器书签导入
- [x] 跨源智能搜索与推荐
- [x] Chrome Extension (Manifest V3) 双形态
- [x] 文件上传系统（54 种文件类型、去重、多分片、video/audio block）

### Active

- [ ] 多源知识统一管理架构（跨源去重、关联发现、时间线视图）
- [ ] AI 驱动的知识整理（自动摘要、知识图谱、相似推荐）
- [ ] 定时/增量同步（LinuxDo 新帖、GitHub 新 Star、书签变更）
- [x] RSS 知识源接入（RSSAdapter + RSSAutoImporter + rss-importer.test.js 已实现，v3.7.x）
- [ ] 更多知识源接入（Twitter/X、Hacker News、Reddit）
- [ ] 知识分享与协作（导出为 Markdown/PDF、生成报告）

### Out of Scope

- 自建后端服务器 — 保持纯客户端架构（Userscript + Extension），零部署成本
- 替代 Notion — Notion 是唯一的知识存储目标，不做独立知识库
- 移动端应用 — 浏览器扩展形态，不开发原生移动端

## Context

项目从 LinuxDo 帖子导出工具起步（基于 flobby 和 JackLiii 的作品改编），v3.5.0 已发展为功能丰富的多源知识工具。源码为 esbuild 模块化（src/ 多目录分层：extract/adapter/bridge/api/ai/ui/security/coordination 等），构建产物为单文件 .user.js（~26K 行）。含 Chrome Extension 构建系统。已有 AI 对话、OAuth、权限控制、审计日志等企业级特性。文件处理系统刚完成全面升级，支持 Notion File Upload API 的完整能力。

## Constraints

- **单文件架构**: 主代码在一个 .user.js 文件中，构建时拆分为 Chrome Extension
- **纯客户端**: 所有 API 调用通过 GM_xmlhttpRequest 或 fetch，无服务端
- **Notion API 限制**: 请求速率 3 req/s，block 嵌套深度有限，文件大小依赖工作区套餐
- **跨域安全**: 上传文件到 S3 预签名 URL 时不携带 Authorization 头

## Tech Stack

- **Language**: JavaScript (ES2020+), Node.js >=18
- **Runtime**: Tampermonkey/Greasemonkey (Userscript ~26K lines) + Chrome Extension (Manifest V3, bounded + full)
- **Build**: esbuild (build.js bundles src/ modules → single .user.js); scripts/build-extension.js (extension packaging)
- **Test**: Vitest 4.x (441 tests, tests/ + tests/setup.js); legacy node tests (utils/logic-modules/notion-oauth)
- **Docs**: VitePress 2.x (docs/)
- **Verification**: verify:* suite (baseline, build, extension bounded/bridge/surfaces, bundle equivalence, delivery)
- **APIs**: Notion API (+ File Upload API, 54 file types), Discourse API, GitHub API v3, OpenAI/Anthropic/Gemini AI APIs, Obsidian Local REST API
- **Security**: @connect whitelist, GM_xmlhttpRequest, crypto.getRandomValues, UrlValidator (SSRF), CredentialVault (API key encryption)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 单文件 Userscript 架构 | 降低安装门槛，一键安装 | 代码量大但维护成本可控 |
| Chrome Extension 双形态 | 解决 GM_xmlhttpRequest 限制 | build-extension.js 自动构建 |
| File Upload API + file_upload 类型 | Notion 新版文件上传需要先上传再引用 | 图片/视频/音频/附件全部支持 |
| 3 路并发上传池 | 批量导出时大幅提升速度 | 去重后唯一文件数量有限，并发安全 |
| 多 AI 服务商支持 | 用户可能使用不同 AI 服务 | 统一接口 + 自动模型发现 |

## Stakeholders

- LinuxDo 社区用户（主要用户群）
- 知识工作者（使用 Notion 管理知识库的人群）
- 开源贡献者（MIT 协议）

---
*Last updated: 2026-07-27 (drift-realign: W1-W8 ai 拆分后源码模块化 + 测试 384→441)*
