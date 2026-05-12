# 整体架构

LD-Notion 是一个浏览器侧应用：核心逻辑运行在用户脚本或扩展 content script 中，通过浏览器存储保存配置，通过外部 API 读写 Notion、GitHub、AI 服务和 Obsidian。

## 模块结构

```mermaid
flowchart TB
  subgraph Runtime[运行形态]
    UserScript[Tampermonkey 用户脚本]
    FullExt[独立 Chrome 扩展]
    BridgeExt[书签桥接扩展]
  end

  subgraph UI[界面层]
    MainUI[Linux.do / GitHub 主面板]
    NotionUI[Notion 浮动 AI 面板]
    GenericUI[通用网页剪藏面板]
    Popup[扩展 Popup]
  end

  subgraph Services[服务层]
    WorkspaceService[WorkspaceService]
    NotionAPI[NotionAPI / NotionTransport]
    GitHubAPI[GitHubAPI / GitHubExporter]
    BookmarkExporter[BookmarkBridge / BookmarkExporter]
    ZhihuAPI[ZhihuAPI]
    ObsidianAPI[ObsidianAPI]
    Agent[AI Agent Loop]
  end

  subgraph Guard[安全层]
    OperationGuard[OperationGuard]
    Audit[审计日志]
    Permission[权限等级]
  end

  subgraph External[外部系统]
    LinuxDo[Linux.do]
    GitHub[GitHub API]
    ChromeBookmarks[chrome.bookmarks]
    Notion[Notion API]
    AI[AI Providers]
    Obsidian[Obsidian REST API]
  end

  UserScript --> MainUI
  UserScript --> NotionUI
  UserScript --> GenericUI
  FullExt --> MainUI
  FullExt --> NotionUI
  FullExt --> GenericUI
  FullExt --> Popup
  BridgeExt --> BookmarkExporter

  MainUI --> Services
  NotionUI --> Services
  GenericUI --> Services
  Popup --> Services

  Services --> OperationGuard
  OperationGuard --> Permission
  OperationGuard --> Audit
  OperationGuard --> NotionAPI

  NotionAPI --> Notion
  WorkspaceService --> Notion
  GitHubAPI --> GitHub
  BookmarkExporter --> ChromeBookmarks
  ZhihuAPI --> External
  ObsidianAPI --> Obsidian
  Agent --> AI
  Agent --> Services
  MainUI --> LinuxDo
```

## 关键数据流

1. UI 层读取用户配置与来源选择。
2. 来源服务拉取帖子、仓库、书签或网页信息。
3. 解析层清洗内容、保留格式、生成 Notion Blocks 或 Markdown。
4. 可选 AI 层生成摘要、分类、标签或执行对话式任务。
5. 写入前进入 OperationGuard。
6. Notion 或 Obsidian 适配层完成输出。
7. 状态、日志和导出记录写回浏览器本地存储。

## 代码定位

| 模块 | 位置 |
| --- | --- |
| 用户脚本主体 | `LinuxDo-Bookmarks-to-Notion.user.js` |
| 书签桥接扩展 | `chrome-extension/` |
| 独立扩展构建 | `scripts/build-extension.js` 输出 `chrome-extension-full/` |
| 自动化测试 | `tests/` |
| UI 手工回归 | `docs/ui-regression-checklist.md` |

## 设计取舍

- 纯前端部署：安装简单，但 OAuth Client Secret 只能保存在本地浏览器存储中。
- 单脚本核心：便于 Tampermonkey 分发，但需要构建 seam 来稳定生成扩展版。
- 权限守卫集中化：减少 AI 与用户触发写入入口的安全漂移。
- 多来源统一抽象：跨源搜索和推荐更自然，但来源去重策略需要分别处理。
