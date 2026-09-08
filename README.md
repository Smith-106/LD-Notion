# LD-Notion Hub — AI 多源知识中枢

一个可扩展的 Tampermonkey 用户脚本，统一连接 **Linux.do**、**GitHub**、**浏览器书签** 与 **Notion**：多源收藏导入、跨源智能搜索与推荐、AI 对话式管理工作区，并可继续接入更多内容来源。

> **桌面应用已拆分为独立仓库**：[LD-Notion-Desktop](https://github.com/Smith-106/LD-Notion-Desktop)（Tauri v2 + React + Rust 本地知识库）

[![安装脚本](https://img.shields.io/badge/安装脚本-Tampermonkey-green?style=for-the-badge&logo=tampermonkey)](https://greasyfork.org/zh-CN/scripts/566681-ld-notion-notion-ai-%E5%8A%A9%E6%89%8B-linux-do-%E6%94%B6%E8%97%8F%E5%AF%BC%E5%87%BA) [![使用教程](https://img.shields.io/badge/使用教程-TUTORIAL-blue?style=for-the-badge)](./TUTORIAL.md) [![文档站](https://img.shields.io/badge/文档站-GitHub%20Pages-6f42c1?style=for-the-badge&logo=githubpages)](https://smith-106.github.io/LD-Notion/) [![安装浏览器扩展](https://img.shields.io/badge/安装浏览器扩展-Release-orange?style=for-the-badge&logo=googlechrome)](https://github.com/Smith-106/LD-Notion/releases/latest)

- 当前仓库源码版本：`v3.14.14`
- 最新 Release 页面：<https://github.com/Smith-106/LD-Notion/releases/latest>
- 文档站：<https://smith-106.github.io/LD-Notion/>
- 脚本安装（GreasyFork 页面）：<https://greasyfork.org/zh-CN/scripts/566681-ld-notion-notion-ai-%E5%8A%A9%E6%89%8B-linux-do-%E6%94%B6%E8%97%8F%E5%AF%BC%E5%87%BA>
- 脚本安装（直链）：<https://update.greasyfork.org/scripts/566681/LD-Notion%20Hub%20%E2%80%94%20AI%20%E5%A4%9A%E6%BA%90%E7%9F%A5%E8%AF%86%E4%B8%AD%E6%9E%A2.user.js>

## 文档站

完整文档已发布到 GitHub Pages：<https://smith-106.github.io/LD-Notion/>

推荐阅读路径：

- **快速开始**：[安装与首次导入](https://smith-106.github.io/LD-Notion/guide/getting-started)
- **功能地图**：[Linux.do、GitHub、书签、AI 助手与网页剪藏](https://smith-106.github.io/LD-Notion/features/)
- **原理机制**：[Concepts / 机制地图](https://smith-106.github.io/LD-Notion/concepts/)
- **路由规则**：[Routing Rules](https://smith-106.github.io/LD-Notion/concepts/routing-rules)
- **导入流水线**：[Import Pipeline](https://smith-106.github.io/LD-Notion/concepts/import-pipeline)
- **安全边界**：[OperationGuard](https://smith-106.github.io/LD-Notion/concepts/operation-guard)、[Auth Model](https://smith-106.github.io/LD-Notion/concepts/auth-model) 与 [Prompt Injection Defense](https://smith-106.github.io/LD-Notion/concepts/prompt-injection-defense)
- **扩展与部署**：[Chrome Extension Architecture](https://smith-106.github.io/LD-Notion/extension/architecture) 与 [Deployment](https://smith-106.github.io/LD-Notion/reference/deployment)

## 四大核心能力

### 1. Linux.do 收藏导出器

在 Linux.do 页面可加载工具面板并导出收藏（推荐收藏页，已登录时不强依赖 bookmarks 路径），将帖子导出到 Notion 数据库或页面。

- **批量导出**：一键导出所有收藏，支持可视化列表勾选
- **自动导入**：定时轮询（3/5/10/30 分钟）自动导出新收藏，智能去重
- **并发加速**：可选 1/2/3/5 个并发，配合请求间隔调节速度
- **暂停/继续**：导出过程中可随时暂停和恢复
- **导出目标**：数据库（条目）或页面（子页面）两种模式
- **自定义筛选**：楼层范围、仅主楼、仅楼主
- **图片处理**：上传到 Notion / 外链引用 / 跳过图片
- **格式保留**：代码块（语法高亮）、引用、表格、列表、标题、链接、粗体/斜体/删除线/行内代码、Emoji (100+)

### 2. GitHub 活动导入

将 GitHub 上的各类活动导入到 Notion，在设置中勾选需要的类型即可。

- **Stars**：导入你收藏的仓库（名称、描述、语言、Stars 数、标签）
- **Repos**：导入你自己的仓库
- **Forks**：导入你 Fork 过的仓库
- **Gists**：导入你的代码片段
- **类型可选**：在设置中勾选需要导入的类型，按需开启
- **AI 分类**：导入完成后可自动用 AI 对仓库进行分类
- **智能去重**：已导入的不会重复导入

### 3. 浏览器书签导入

通过 Chrome 扩展读取浏览器书签，一键导入 Notion 进行整理。支持两种形态：
- **脚本版 + 书签桥接扩展（`chrome-extension-full/`）**
- **独立扩展版（`chrome-extension-full/`，书签能力内置）**

- **Chrome API 直接读取**：无需手动导出书签文件
- **文件夹路径保留**：书签的文件夹层级结构会记录在「书签路径」字段中
- **智能去重**：已导入的书签不会重复
- **配套扩展极简**：仅 2 个文件，不收集任何数据

### 4. Notion AI 助手

在 **Linux.do** 和 **Notion** 站点均可使用的对话式 AI 助手，通过自然语言操作 Notion 工作区。

#### AI 服务

支持 OpenAI、Anthropic、Google Gemini 等多种 AI 服务，可自定义 Base URL 和模型。

#### Agent Loop (ReAct 模式)

AI 助手仍采用 ReAct / Agent Loop 架构，但现在不再是早期那套固定 15 个工具面。当前稳定、对外可用的能力更适合按命令类别来理解：

| 类别 | 代表命令 | 权限等级 |
|------|----------|----------|
| 工作区检索与对象详情 | 「搜索关于 Docker 的内容」「查看这个 Notion 链接」「查看“知识库”数据库结构」 | 只读 |
| 页面内容读取 | 「读取“项目计划”页面内容」「查看“项目计划”页面 Markdown」「查看“项目计划”页面块结构」 | 只读 |
| 评论与协作信息 | 「查看“项目计划”页面评论」「查看 comment_xxx 这条评论」「列出当前工作区可见用户」 | 只读 |
| 页面与块编辑 | 「在“项目计划”页面末尾插入一段说明」「在 block_xxx 后插入内容」「把 block_xxx 改成新文案 / 公式 / URL」 | 标准 |
| 页面元数据与整理 | 「给“项目计划”加封面」「把“项目计划”换成 🚀 图标」「锁定 / 归档 / 恢复页面」 | 标准 / 高级 |
| 创建与批量处理 | 「创建页面」「批量创建页面」「批量更新页面」「自动分类未分类页面」「批量打标签」 | 标准 |
| 跨源检索与导入 | 「在 Linux.do / GitHub / 书签里统一搜索」「导入 GitHub 收藏」「导入浏览器书签」 | 只读 / 标准 |
| AI 深度工作流 | 「总结页面」「头脑风暴」「校对」「批量翻译数据库」「把页面笔记提取为数据库」「生成多页面结构化内容」 | 只读 / 标准 / 高级 |

#### 意图识别

直接用自然语言发指令，AI 自动识别意图：

- **页面 / 数据库对象**：「查看“项目计划”页面详情」「查看“知识库”数据库属性」
- **页面 Markdown / 块 / 评论**：「读取“项目计划” Markdown」「查看“项目计划”页面评论」「查看 comment_xxx」
- **页面 / 块写入**：「在“项目计划”页面插入“新增说明”」「把 block_xxx 改成“新的段落内容”」「把 equation 块改成 E=mc^2」「把 bookmark/embed 块改成新的 URL」
- **页面整理**：「把“项目计划”移到归档」「恢复“项目计划”」「把“项目计划”换成 🚀 图标」
- **跨源检索与导入**：「在所有来源中搜索 Kubernetes」「导入我的 GitHub 收藏」「导入浏览器书签」
- **AI 分析与生成**：「总结一下这个页面」「围绕远程办公做头脑风暴」「把整个数据库翻译成英文」

说明：
- 当前最稳定的直达短语重点覆盖页面、块、评论和 Notion 链接对象。
- 数据库直达短语当前以「结构 / 属性 / 字段 / 详情」为主，不承诺「数据库评论 / Markdown / 块结构」这类快捷说法。
- 复杂任务仍会自动拆成多步工具调用完成。

#### Notion 站点面板

在 Notion 页面右下角显示浮动 AI 图标，点击展开面板：
- 配置 Notion API Key、AI 服务和模型
- 数据库 / 页面选择器，支持刷新获取工作区列表
- 对话式 AI 助手，与 Linux.do 侧共享配置
- 可拖拽移动，记住位置
- 设置区与 Linux.do 侧保持一致，统一采用可折叠分组（下拉展开/收起）

### 安全与权限

- **四级权限**：只读 → 标准 → 高级 → 管理员，按需授权
- **操作守卫**：用户触发与 AI 触发的写入操作统一经过 `OperationGuard` 守卫层（权限检查 / 审计记录；危险操作额外确认）
- **审计日志**：记录操作历史，支持查看和清除
- **撤销支持**：危险操作提供 5 秒撤销窗口；常规写入默认记录审计，不承诺统一可撤销
- **权限域收窄**（v3.7.0）：`@match` 从 `*://*/*` 收窄为 6 个显式站点，`@connect` 从 `*` 收窄为 9 个显式域名白名单，阻止向任意域名发起请求
- **Prompt Injection 防御**（v3.7.0）：AI 输入用 XML 标签隔离用户内容与系统指令，输出经 `escapeHtml` + `safeMarkdown` 净化，UI 全局 50+ 处拼接点统一转义
- **凭证存储**（v3.14.3 / commit 049bf46）：AI API Key、Base URL、GitHub Token、Obsidian API Key/URL 与 Notion OAuth 三键均走浏览器本地明文存储（GM 存储）；保险箱机制已退役。审计日志仍由 `REDACT_IN_LOGS` 超集统一脱敏
- **setLevel 验证**（v3.7.0）：权限等级设置强制校验 0-3 整数，拒绝 NaN/Infinity/超范围值

## 安装

本项目提供两种使用方式，功能完全一致，按需选择。

> 当前优先支持：Chrome / Edge（脚本版与独立扩展版均按这两种浏览器验证）

### 方式 A：油猴脚本（推荐）

> **v3.14.9 提示**：油猴脚本仅匹配 Linux.do / Notion / GitHub (incl. gist.github.com) / 知乎（含 `*.linux.do` / `*.notion.so` 子域）；**不再**在任意网页自动出现面板。通用剪藏请用 Chrome 扩展，或自行添加 Tampermonkey `@match`。


#### 1. 安装 Tampermonkey

- [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

#### 2. 安装脚本

- GreasyFork 一键安装：<https://greasyfork.org/zh-CN/scripts/566681-ld-notion-notion-ai-%E5%8A%A9%E6%89%8B-linux-do-%E6%94%B6%E8%97%8F%E5%AF%BC%E5%87%BA>

1. 点击 Tampermonkey 图标 → 添加新脚本
2. 复制 `LinuxDo-Bookmarks-to-Notion.user.js` 的全部内容
3. 粘贴并保存（Ctrl+S）
4. 打开以下任一站点验证入口是否生效：
   - `https://linux.do/u/你的用户名/activity/bookmarks`（完整面板）
   - `https://www.notion.so/`（右下角浮动 AI 按钮）
   - `https://github.com/`（与 Linux.do 同步的完整面板）

#### 3. 安装书签桥接扩展（可选，仅导入浏览器书签需要）

- 安装浏览器扩展（Release）：<https://github.com/Smith-106/LD-Notion/releases/latest>

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目中的 `chrome-extension` 文件夹
5. 刷新页面，设置面板中会显示「扩展已安装」

### 方式 B：Chrome 扩展（独立版）

无需 Tampermonkey，所有功能打包为独立 Chrome 扩展，书签导入内置支持。

#### 1. 构建扩展

```bash
node scripts/build-extension.js
```

输出目录：`chrome-extension-full/`

构建说明：

- 默认 profile 已切换为 `bounded_hosts`，优先生成收敛后的受限 `host_permissions` 扩展形态
- 如需兼容旧的宽权限构建，可临时指定 `LD_NOTION_MANIFEST_PROFILE=default` 后再执行构建
- 当前构建脚本已显式校验 userscript 主体锚点、`BookmarkBridge` 补丁区、GM shim / content script / popup / background / manifest 这些关键 seam，源码形状漂移会更早失败

#### 2. 安装扩展

- 安装浏览器扩展（Release）：<https://github.com/Smith-106/LD-Notion/releases/latest>

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `chrome-extension-full` 文件夹

#### 扩展版特点

- **无需 Tampermonkey**：独立运行，不依赖脚本管理器
- **内置书签 API**：直接通过 `chrome.bookmarks` 读取，无需安装额外桥接扩展
- **Popup 快速入口**：点击工具栏图标可快速跳转和触发导入操作
- **CORS 代理**：通过 background service worker 自动处理跨域请求

## Notion 配置

### 1. 创建 Integration

1. 访问 [Notion Integrations](https://www.notion.so/my-integrations)
2. 点击 "New integration"
3. 填写名称（如 "Linux.do 导入"）
4. 选择关联的 Workspace
5. 在 Capabilities 中确保勾选：
   - Read content
   - Update content
   - Insert content
6. 点击 Submit
7. 复制生成的 Internal Integration Token（以 `secret_` 开头）

### 1.1 可选：使用公开 OAuth 一键授权

> **提示（v3.14.16）**：设置里可用单选切换「API Key」与「公开 OAuth」；两者都可预先填写，但只有当前选中的模式会实际用于导出。清空 Notion 后若「待导出」仍偏少，可将「导出状态依据」改为「Notion 工作区」并刷新工作区。

如果你不想手动粘贴 Token，现在也可以改用 Notion 公开集成的 OAuth 授权流：

1. 在你的 Notion 集成设置里启用 Public/Distribution 能力
2. 添加 Redirect URI（Notion「New connection」表单）
   - **推荐（默认）填共享文档站回调**：`https://smith-106.github.io/LD-Notion/oauth-callback`
   - 全体终端用户共用此地址，**无需各自搭建网站**；面板默认值与此一致，须与 Notion 后台逐字符相同
   - **不要再填** `https://www.notion.so/`：Notion 新连接表单会报 “Enter a valid redirect URI”，旧「在 notion.so 页拦截 `?code=`」技巧已过时
3. 复制该公开集成的 `Client ID` 和 `Client Secret`（个人自建集成仍可自行粘贴；Redirect URI 用上面的共享地址即可）
4. 在 LD-Notion 面板里填写 `Client ID`、`Client Secret`、`Redirect URI`（无需预先初始化凭证保险箱）
5. 点击 `🔐 一键授权`
6. 完成 Notion 授权后会跳转到文档站回调页；已安装的 userscript / 扩展会读取 `?code=` 并自动把 access token / refresh token 保存到浏览器本地（GM 存储）

注意：
- 当前项目是纯前端运行，没有单独后端；Notion OAuth 三键（Client Secret、access/refresh token）保存在你的浏览器本地 GM 存储中，以保证授权回调跨页面可读（v3.12.0 起的存储模型）
- AI API Key、GitHub Token、Obsidian 等敏感凭证自 v3.14.3 起亦走 GM 明文存储（保险箱退役），更新脚本后无需重新解锁
- 这更适合个人自建公开集成，不建议把共享的生产级公开集成 secret 直接放进前端
- 面板里的“断开授权”只会清除本地保存的 OAuth 凭据，不会撤销 Notion 后台已经批准的授权

### 2. 创建数据库

在 Notion 中创建一个数据库，需要包含以下属性：

| 属性名 | 类型 | 说明 |
|--------|------|------|
| 标题 | Title | 帖子标题（必须） |
| 链接 | URL | 帖子原始链接 |
| 分类 | Text | 帖子分类 |
| 标签 | Multi-select | 帖子标签 |
| 作者 | Text | 楼主用户名 |
| 收藏时间 | Date | 收藏的时间 |
| 帖子数 | Number | 回复数量 |
| 浏览数 | Number | 浏览量 |
| 点赞数 | Number | 点赞数 |

### 3. 关联 Integration

1. 打开刚创建的数据库页面
2. 点击右上角 `...` → `Connections` → `Connect to`
3. 选择刚创建的 Integration

### 4. 可选：手动获取数据库 ID（高级兜底）

默认推荐在面板中点击「🔄 刷新工作区列表」，再从下拉框选择数据库或页面。

如工作区列表加载失败，可手动从链接中复制 ID：
```
https://www.notion.so/xxx/32位数据库ID?v=xxx
```

## 使用方法

### 帖子导出

1. 推荐访问收藏页：`https://linux.do/u/你的用户名/activity/bookmarks`
2. 已登录状态下，不在 bookmarks 页也可加载 Linux.do 收藏并导出
3. 页面右侧会出现工具面板
4. 二选一完成 Notion 授权
   - 手动模式：填写 Notion API Key
   - OAuth 模式：填写 Client ID / Client Secret / Redirect URI，然后点击 `🔐 一键授权`
5. 点击刷新并从工作区下拉框选择目标（加载失败时可在高级项手动输入 ID）
6. 点击「加载收藏列表」获取收藏
7. 勾选要导出的帖子，调整筛选设置
8. 点击「开始导出」

### 自动导入

1. 完成 Notion 配置
2. 在来源分区中选择 Linux.do 或 GitHub（两边配置互不影响）
3. 勾选「启用自动导入新收藏」
4. 选择轮询间隔
5. 新收藏将自动导出，无需手动操作

### 更新检查

1. 在对应来源分区中点击「检查更新」可立即检查新版本
2. 勾选「自动检查更新」后，可设置「检查间隔」（24/72/168 小时）
3. 状态区会显示上次检查结果和是否发现新版本
4. 说明：userscript 可直接按脚本更新通道升级；ZIP/解压安装的扩展需手动重新安装或在扩展页重新加载

### AI 助手

- **Linux.do 侧**：在收藏页面的工具面板中使用
- **Notion 侧**：在任意 Notion 页面点击右下角浮动图标
- 输入自然语言指令，AI 自动执行对应操作

### GitHub 导入

1. 在设置面板中填写 GitHub 用户名
2. 可选填写 GitHub Token（提高速率限制到 5000 次/小时）
3. 勾选需要导入的类型（Stars / Repos / Forks / Gists）
4. 在 AI 对话中输入「导入 GitHub 收藏」或点击快捷按钮 🐙 GitHub

### 浏览器书签导入

1. 安装配套 Chrome 扩展（见安装步骤第 3 步）
2. 设置面板中会显示扩展安装状态
3. 在 AI 对话中输入「导入浏览器书签」或点击快捷按钮 📖 书签

## 常见问题

### Q: 验证配置失败？
A: 请检查：
1. API Key 是否正确复制（以 `secret_` 开头）
2. 优先点击「🔄 刷新」并从工作区列表选择目标；若手动输入，确认 ID 为 32 位
3. Integration 是否已关联到数据库（页面模式需关联到目标页面）

### Q: 解压安装的扩展会自动更新吗？
A: 不会。你可以在面板里点「检查更新」或开启「自动检查更新」获取新版本提示；但 ZIP/解压安装的扩展仍需手动重新安装或在 `chrome://extensions/` 点击重新加载。要实现真正自动替换二进制，需要通过浏览器商店分发。

### Q: 图片显示不出来？
A: 可能原因：
1. 图片使用外链模式，原图已失效
2. Notion 无法访问某些图片源
3. Notion 上传大小限制：免费套餐所有上传文件需小于 5MB；付费套餐 PDF 小于 20MB、图片小于 5MB
4. 建议使用「上传到 Notion」模式；若图片上传报错，脚本会自动尝试按文件方式上传

### Q: 导出速度很慢？
A: 可尝试以下方法加速：
1. 在筛选设置中将「并发数」调高（如 3 或 5 个并发）
2. 适当缩短「请求间隔」（如 200ms）
3. 使用「外链引用」模式跳过图片上传
4. 遇到 API 速率限制时会自动等待重试，属正常现象

### Q: 如何重新导出已导出的帖子？
A: 在脚本面板的收藏列表里，找到状态为「已导出」的 Linux.do 帖子，点击右侧「重新导出」，该条目会恢复成「待导出」并自动重新选中。

如果你确实要一次性清空全部历史记录，仍可在浏览器控制台执行：
```javascript
GM_setValue("ldb_exported_topics", "{}")
```

### Q: AI 助手报错？
A: 请检查：
1. 是否配置了 AI API Key（与 Notion API Key 分开）
2. AI 服务和模型是否匹配（如 OpenAI Key 选 OpenAI 服务）
3. 如使用自定义 Base URL，确认地址正确且可访问

## 技术说明

- 基于 Discourse API 获取 Linux.do 帖子数据
- 基于 GitHub REST API 获取 Stars/Repos/Forks/Gists
- 配套 Chrome Extension 通过 `chrome.bookmarks` API 读取浏览器书签
- 使用 Notion API 创建数据库记录和子页面
- DOM 解析转换为 Notion Block 格式
- 自动处理 API 速率限制 (429 响应自动重试)
- AI 助手使用 ReAct Agent Loop 架构，支持多轮推理和工具调用
- 跨源工具支持 Linux.do / GitHub / 浏览器书签统一搜索和推荐
- SyncState V1/V2 迁移（v3.7.0）：消除双写，V1 facade 代理 V2，自动迁移幂等安全
- DedupStore 批量优化（v3.7.0）：`beginBatch/endBatch` 减少同步循环 IPC，`queueMicrotask` 合并写入
- 模块化源码（`src/`）经 esbuild 打包为单文件 `.user.js`（1.35MB），同时生成 Chrome Extension 变体
- AI 域采用 Shell + Domain Modules 架构：`Handlers.js`（48 LOC shell）+ 4 域文件、`AgentTools.js`（21 LOC shell）+ 3 域文件，通过 `deps.js` 中央依赖访问器注入
- API 域拆分为核心（696 LOC）+ 4 独立模块（constants/DOMToNotion/obsidian/notion-upload），上传簇通过 `installUploadMethods` 注入避免循环依赖
- 事件总线（`event-bus.js`）解耦 security/import/bridge ↔ ui 循环依赖

## 开发与验证

- 推荐验证梯度：
  1. `npm test`
  2. `node --check LinuxDo-Bookmarks-to-Notion.user.js`
  3. `node scripts/validate-userscript-ui.js`
  4. 如涉及书签桥接扩展：`npm run verify:bridge-extension`
  5. 如涉及扩展交付：`node scripts/build-extension.js`
  6. 最后按 `docs/ui-regression-checklist.md` 做 Linux.do / Notion / 通用网页 / `chrome-extension-full` 手工 smoke
- 一键交付验证：`npm run verify:delivery`（包含 baseline、`bounded_hosts` smoke、bridge runtime smoke 与默认扩展构建）
- `npm test`：38 个测试文件、754 个用例，覆盖 SyncStateV2、DedupStore、Config、OperationLog、AIService、AI Schema/Trace/Handlers、API 模块、RSS/Atom 解析、GitHub/书签/通用导出、UI 基线等模块
- Node 测试会直接读取并执行当前 `LinuxDo-Bookmarks-to-Notion.user.js` 的核心代码，并复用 `scripts/build-extension.js` 的提取/构建 seam，而不是维护一份单独的测试副本
- 当前自动化验证重点覆盖：Utils 辅助函数、OAuth 回调与 refresh fallback、`TargetState`、`quickParseIntent` 正/反例、`assistant_result v1` 输出契约，以及 `scripts/build-extension.js` 的锚点、builder seam、manifest profile、bridge runtime 边界与构建冒烟
- 语法检查：`node --check LinuxDo-Bookmarks-to-Notion.user.js`（如无 Node 可跳过）
- 构建扩展版：`node scripts/build-extension.js`（输出到 `chrome-extension-full/`）
- 自动化收敛权限 smoke：`npm run verify:extension:bounded`（写入临时目录并自动清理）；默认 release / README 安装流程仍以默认 profile 为准
- Bridge 扩展运行时 smoke：`npm run verify:bridge-extension`（验证 `chrome-extension-full/content.js` 只在存在活动 LD-Notion 面板时响应书签桥接请求）
- UI 静态校验：`node scripts/validate-userscript-ui.js`（或 `python3 scripts/validate-userscript-ui.py`）
- UI 手工回归：`docs/ui-regression-checklist.md`
- 四级权限模型 + `OperationGuard` 统一保护用户触发与 AI 触发的写入入口；危险操作额外确认，撤销窗口只覆盖危险操作

## 更新日志

### v3.14.14

- OAuth 默认 Redirect URI 改为作者托管的 GitHub Pages 回调：`https://smith-106.github.io/LD-Notion/oauth-callback`（Notion 新表单拒绝 `https://www.notion.so/`）
- 新增文档站着陆页 `docs/oauth-callback.md`；userscript / 扩展可匹配该回调域

### v3.14.13

### fix (更新路径 token invalid · 401 风暴消除 · 三模型复核共识)

- **逐项重读 token**: Bookmark/RSS 自动导入器每项开工前经 `getAccessToken` 统一入口重读, OAuth 续签后不再整轮复用失效快照
- **isAuthTerminal fail-fast**: 401/403 终态抛原错误中止整批(含归档阶段), 不再逐项重复注定失败的请求
- **setup 首触点透传**: `GET /databases` 401 认证标记/authCode 透传, 场景文案分支可达
- **账本先行落盘**: fail-fast 前 `flushExported`, 已建页导出事实不丢, 防重复建页
- **clearConnection 无条件清残留**: manual 模式下 OAuth 残留 access_token 也清(断开授权后不再直发残留 token 401); 清除按钮文案明示清除范围
- 回归测试 +8(`tests/update-token-failfast.test.js`)

### v3.14.12

### fix (token invalid 误判 · 粘贴污染 · 空 token 预检)

- 空 token 预检: 不发请求, 直接提示保存 API Key
- 401 细分: 仅官方认证 code 判终态, 代理/网关 401 非终态
- key 清洗: 剥不可见字符+换行; `validateManualApiKey` 格式软校验(secret_/ntn_ 前缀)
- 错误透传 authCode, 中止横幅按场景分支文案
- 回归测试 +4

### v3.14.11

### fix (#17–#21 · DedupStore / OAuth 续签 / clipper / UI)

- **#17** 对账 DedupStore batch 槽残留：strict 对账零命中也 `endBatch`；LinuxDo `getDedupKey` 对齐裸 topicId
- **#18** skip keys / dual-ledger clear / batch wipe：GitHubAutoImporter `isExported` 过滤；RSS `allow_duplicates` 键；Bookmark 清账兼清 DedupStore；`clearSeen` `wiped` 防复活
- **#19** batch `unmarkSeen` 墓碑 (`dirtyKeys`+`deleted`) + Discourse slug 对账 URL 归一
- **#20** OAuth `resolveRequestToken` 禁快照遮蔽续签；知乎/通用 clipper 成功后 mark DedupStore
- **#21** ConfirmationDialog `countdown:0` 立即启用；clipper URL `normalizeDedupUrl`；UpdateChecker fallback 用 `CONFIG.SCRIPT_VERSION`

### v3.14.10

### fix (userscript 一键授权 OAuth 回调竞态 / document-start snapshot / cross-tab watchers)

- userscript `@run-at document-start` + `captureCallbackSnapshot()` so OAuth `?code&state` survive Notion SPA `history.replaceState`
- `handleRedirectCallback` prefers snapshot when live URL already cleared
- `installCrossPageWatchers` covers API Key / auth mode / refresh / meta / pending / notice for initiator-tab refresh
- `matchesRedirectUri` trailing-slash tolerant (non-root) aligned with diagnostics
- regression: legacy T29/T30 + vitest `oauth-callback-snapshot.test.js`

### v3.14.9

- treat `gist.github.com` as GitHub (SiteDetector + userscript `@match` + extension content-script)
- harden `scan-dangling-refs` and wire into `verify:baseline` (fail on new dangling refs)
- fix ConfirmationDialog import miss in `agent-executor.js`

### v3.14.8

- userscript match docs + subdomain @match
- LD_VERIFY_STRICT + verify-build negative restore
- ConfirmationDialog queue/close; generic save warning; GitHub Notion pause/cancel

### v3.14.7

31 条 UI 审计发现全量修复 + 导出几分钟后 token invalid 全部失败根因修复（四因素叠加：`isAuthTerminalError` 消息子串误判致 fail-fast、导出循环固定 `settings.apiKey` 快照遮蔽 OAuth 续签、终态降级残留过期 access token、站设置空输入误清 token 翻 manual）：
- **认证（P0）**：`isAuthTerminalError` 只信 `error.isAuthTerminal === true` 显式标记（三处）；导出循环每项开工前重解析最新 token；终态降级清残留 `NOTION_API_KEY`；站设置仅显式编辑时清 token；`setManualApiKey` 空值不翻 manual；凭证落盘改 `REDACT_IN_LOGS` 明文脱敏集
- **安全（P1）**：导出按钮 disabled 提前 + GitHub 导出 SyncLock 重入守卫；Obsidian `writeNote`/`writeImage` 登记 `OPERATION_LEVELS` level=1，4 处裸调点统一经 OperationGuard；工作区洞察 prompt 改 `isolateContent` 隔离
- **UI（P2/P3）**：ConfirmationDialog 重入闸门 + ARIA 焦点管理；三面板主题重应用；oplog 防抖；option 转义 ×3；原生 confirm 替换 ×2；硬编码 rgba 换设计令牌；savedTab 白名单防选择器注入；时间线 label 转义；聊天容器 aria-live；mini 按钮 aria-label；`AI_TEMPLATES` 容量上限 50 等 31 条全量修复
- **验证**：vitest 38 文件 755 用例 + legacy 三件套全绿；verify:baseline/build/delivery EXIT=0（295 PASS）

**升级说明**：涉及认证续签与凭证落盘语义变化，安装后请重新授权 Notion（OAuth 一键授权或填入 API Key）。

### v3.14.6

三模型共识审计 51 条发现全量修复（安全/并发/存储/同步四大类），验证 754 用例全绿：
- **安全**：OAuth 回调跨页状态租约续签（修复「更新后 Key 失效」）、凭证落盘前脱敏（AgentTrace 落盘接线）、AI 输入隔离统一逐字符转义、Gemini 多轮对话 role 契约映射、通配 DNS 后缀（nip.io/sslip.io/xip.io/loca.lt/ssrf.sh）静态拒绝、非规范 IP 字面量纵深防御（前导零判定收窄防合法域名误拒）
- **并发**：批量导出遇失效 Token 认证终态 fail-fast（6 处循环）、存储回写 rebase 防双写竞争、同步锁状态拆分
- **存储**：导出事实账本容量上限淘汰（禁时间 TTL）、去重键 markSeen 时间合并、代理项 UTF-8 编码对齐 TextEncoder（U+FFFD 高位孤立项）
- **同步**：单源行 payload ≤2000 字符硬限 + 超限时间降序截断、id 键源 90 天新鲜度投影、RSS 状态按当前键集剪枝
- **修复验证**：新增契约测试 fix-p0/p1/p2 共 55 用例，全量 vitest 754 用例 + legacy 三件套全绿，verify:delivery 13 维度全链通过

**升级说明**：涉及持久化存储键与 OAuth 状态语义变化，安装后请重新授权 Notion（OAuth 一键授权或填入 API Key），并点击「刷新工作区」对齐本地账本。

### v3.14.5

修复批量导出遇失效 Token 逐项全量失败（认证终态 fail-fast）：
- **根因** 批量循环对每项独立 catch,系统性 401 认证失败不中止批次,464 项逐个注定失败
- **修复** 认证终态（token 无效/OAuth 续签失败）立即中止批次:剩余项进 skipped 可续传,已成功项账本不丢;报告顶部显示认证中止横幅与修复指引
- **覆盖** LinuxDo 批量导出/自动导入/书签导出/GitHub→Notion/LinuxDo→Obsidian/GitHub→Obsidian 6 处循环

### v3.14.4

修复 v3.14.3 三模型共识审查发现的对账/同步缺陷：
- **对账 LinuxDo 死代码** LinuxDo 原始收藏对象无 `url` 字段（仅含带 slug 的 `bookmarkable_url`），旧实现读 `bookmark.url` 恒空 → 对账永不命中；改按 `topic_id` 构造规范 URL（与导出写入"链接"属性同法）匹配，数据源改双源合并快照（LinuxDo+GitHub 一次覆盖）
- **多端同步 90 天后必然失败** 本地导出账本永久保留后，同步层 90 天 ts 校验对任一过期条目整包拒绝；同步投影改为只投递新鲜条目（本地不受影响），单源行 payload 超 2000 字符按时间降序截断并记审计
- **写回 O(N²) 消除** 对账回填与 GitHub→Obsidian 导出循环改为"循环内仅改内存缓存 + 循环末单次落盘"
- **GitHub「重新导出」入口** 已导出的仓库/Gist 可一键移除记录重新入列（对账误标恢复路径）
- **升级** 点「刷新工作区」即可对账（需先在对应页签加载过收藏列表）

### v3.14.3

修复「已导出内容反复显示待导出」（导出账本 90 天 TTL 误删根因）：
- **根因** 导出账本每次写回按 90 天时间 TTL 全局淘汰，旧导出被静默遗忘；判定只查本地账本，从不与 Notion 工作区页面核对；Obsidian 导出路径从不记录账本
- **修复** 导出账本改容量上限淘汰（>10000 条才淘汰最旧，URL 键源去重保留时间 TTL）；Obsidian 导出成功即记账；工作区扫描后按“链接”属性与本地项 URL 精确匹配自动对账回填（仅 strict 模式回填 LinuxDo）
- **升级** 安装后点「刷新工作区」即可把 Notion 已存在内容与本地账本对齐，恢复正确识别

### v3.14.2 (untagged orphan; see v3.14.3)

修复「每次更新后 API Key 失效」（保险箱会话锁定根因，同 v3.12.0 OAuth 先例）：
- **根因** 凭证保险箱解锁态为页面内存态，每次页面加载（含脚本更新重载）即锁定，锁定态下 AI/GitHub/Obsidian 敏感键读空
- **修复** 全部敏感键移出保险箱改 GM 明文存储（同 OAuth 三键先例），更新/刷新后立即可用；审计日志仍由 `REDACT_IN_LOGS` 统一脱敏
- **升级** 已存入旧保险箱的凭证需重新输入一次（密文无法自动回读）；此后更新脚本不再失效

### v3.14.1

跨设备多端同步（默认关闭）+ 一键授权根因修复 + 全盘安全审计 8 项收尾：
- **跨设备多端同步（feat）** 多端状态合并 9 模块、四类去重修复、同步水位统一；默认关闭,不影响单机工作流
- **一键授权（fix）** `normalizeCandidates` 双形状兼容,修复「客户端 ID 缺失或不完整」根因
- **安全审计（fix,8 项）** 循环依赖消除（新增 `src/utils/sha256.js`）、`crypto.getRandomValues` 统一、SHA-256 指纹、fetch 超时+退避、存储 TTL、JSON 缓存 O(N²) 消除、OperationGuard 权限缺口、审计脱敏

### v3.14.0

UI 可控制能力审计 30 项修复（三模型共识 F-UI-01~45 + browse 实机验证 12 项 PASS）：
- **P0（4 项）** 确认对话框 onConfirm/confirmText 补齐、定时轮询按源调度写 Notion、同步间隔配置失效修复、保存按钮重入保护
- **P1（18 项）** AgentTrace 入口、立即导入按钮、权限指示+审计开关、Obsidian 测试连接、主题三态、折叠持久化、面板重置等
- **P2（8 项）** 同步链状态回显（修复 SyncState facade 缺 getSourceState 的 TypeError）、导出目标摘要、AI 忙时提示、反馈双写等
- **收尾** 关闭面板确认文案修正；facade 委托完整性契约测试

### v3.13.0

F-01~F-05 五连修复（三模型共识审计 + browse 实机验证）：
- **F-01** 空状态「导入浏览器书签」按钮死控件修复（注入指令后发送，带状态提示）
- **F-02** 12 个筛选/参数控件新增 `change` 即时持久化，改动即生效不再丢失
- **F-03** 修复 AIClassifier 跨闭包裸引用 ReferenceError 崩溃（批量分类此前必然失败）；批分类新增「⏸️ 暂停 / ✕ 取消」控制按钮
- **F-04** 新增 SyncState 基线重置：同步中心每张来源卡「重置基线」按钮，下次同步退化为全量扫描
- **F-05** 设置面板新增「数据管理」区：去重/已导出记录计数与一键清除

### v3.11.0

本次版本聚焦「Odyssey UI 审计修复」：18 项桌面/移动/触屏/键盘/动效问题全闭环（三模型共识复审 F1–F8）。
- 修复重新导出按钮失效、最小化恢复破坏 flex 布局、空态 CTA ReferenceError 等 HIGH 缺陷；LinuxDo 双浮动图标消除
- 拖拽迁移 pointer events 支持触屏；新增 480px 抽屉式面板与 768px 响应式断点
- 可访问性强化：38 处表单关联、progressbar/tablist ARIA、reduced-motion 全量适配

验证：556/556 测试全绿，单文件产物约 1374.6 KB（+0.66%）。

### v3.10.0

本次版本为「全量 UI/UX 改进循环」，通过完整 UX 管线扫描 12 个 UI 文件，识别 27 个交互/体验问题并修复 26 个。

**运行时缺陷修复（Critical）**:
- 修复 `BookmarkBridge` 未导入导致的面板初始化 `ReferenceError`
- 修复 4 个 CSS 变量自引用（禁用按钮不变灰、warning/danger 按钮背景透明）
- 修复乱码错误提示（UTF-8/GBK 编码损坏）

**交互与健壮性**:
- 浮动按钮拖拽新增 4px 阈值，消除微抖动吞点击
- 统一同步改为每源独立容错 + 聚合报告，单源失败不中断其余源
- GitHub 复选框、图片迁移失败、错误引导文案等多项状态/反馈修复

**可访问性（7 项）**:
- 状态容器 `aria-live` 播报、设置折叠区/Tabs/resize 手柄键盘导航、`:focus-visible` 焦点环、触控目标 ≥44px

**错误预防与反馈**:
- 破坏性操作新增确认对话框；Escape 键关闭面板；保存/空状态/禁用态反馈打磨

**安全与契约**:
- `AgentTrace` trace ID 迁移到 `crypto.getRandomValues`；`GitHubAutoImporter` 返回值携带 `itemKey`/`title` 标识字段

验证：556/556 测试全绿，单文件 Userscript 输出不变，无新增循环依赖。

### v3.9.0

本次版本聚焦「UI 设计系统增强」，通过两轮 UI Polish 管线（scan→diagnose→optimize→verify + GC 循环）将 UI 质量从 24/32 提升至 28.5/32（Excellent）。

**Design Token 体系扩展**:
- 新增 accent alpha 变体系列（`--ldb-ui-accent-alpha-08` ~ `--ldb-ui-accent-alpha-45`）
- 新增 Motion tokens（`--ldb-ui-ease-out/in`、`--ldb-ui-duration-*`），全部过渡动画统一使用显式 cubic-bezier
- 新增 Neutral overlay token（`--ldb-ui-neutral-overlay`），40+ 处硬编码 rgba 迁移到 color-mix() 模式

**可访问性**:
- `.ldb-toggle-section` 新增 `:focus-visible` 样式（P0 键盘导航问题修复）
- 触控目标尺寸优化至 WCAG 2.1 AA 标准（44×44px）
- Tab 按钮新增 `:active` 按压反馈

**验证**: 556/556 测试全绿，零回归，Build 1358.1 KB

- Tag：`v3.9.0`

### v3.8.0

本次版本聚焦「F4/F5 架构级重构」，消除 3 个巨石文件违反 SRP 问题并消除循环依赖，属 M3 规模独立 milestone。

**巨石文件拆分**:
- `src/ai/Handlers.js`: 2277 LOC → 48 LOC shell + 4 域文件 (query/pageCrud/content/batch)
- `src/ai/AgentTools.js`: 1712 LOC → 21 LOC shell + 3 域文件 (read/write/meta)
- `src/api/index.js`: 1801 LOC → 696 LOC + 4 新模块 (constants/DOMToNotion/obsidian/notion-upload)

**循环依赖消除**:
- 新增 `src/coordination/event-bus.js`（零依赖事件总线）
- `security/index.js` 删除 `_resolveUI`，OperationLog/UndoManager 改走事件总线
- `import/bridge` 5 个文件迁移到事件总线，消除 `_resolveUI` ×6 处反向引用

**新增模块**:
- `src/ai/deps.js`: 中央依赖访问器（getAI/getState/getService 三件套）
- `src/ai/utils/`: 4 个纯函数工具集（33 pure functions 提取）
- `src/import/github-obsidian-service.js`: 服务调用提取

**测试**: 新增 41 个基线测试，总计 29 文件 556 用例全通过
**验证**: Build 1351.9 KB，verify:delivery Chrome Extension + Userscript 双形态通过

- Tag：`v3.8.0`

### v3.7.2

本次版本聚焦「UI 安全加固 + 可访问性 + 交互体验」，通过 UI Odyssey 全维度审查修复 10 项 Critical、29 项 High 发现，涵盖 XSS 防御、可访问性合规、交互状态完善和响应式布局。

- 安全：`showStatus` 两处 innerHTML 注入加 `Utils.escapeHtml()` 防 XSS
- 安全：Obsidian 测试状态 innerHTML 加 `escapeHtml` 防 error.message 注入
- 安全：导出按钮加 `disabled` 防重入，避免并发操作导致数据异常
- 安全：`showProgress` 除零防护 `total > 0`，避免 NaN 渲染
- 修复：`showStatus` 定时器冲突——连续调用时 `clearTimeout` 旧定时器，防止新消息被提前清除
- 修复：导出报告失败项截断 20 条 + 错误文本 120 字符，防止 DOM 爆炸
- 修复：27 处重复 `class=""` 属性合并为单一 class，恢复丢失的间距/布局样式
- 修复：`.ldb-report-*` 7 个 CSS 类缺失定义已补全
- 修复：`@keyframes ldb-spin` + `.ldb-spin` CSS 缺失导致加载旋转 emoji 静止
- 可访问性：6 个折叠区域加 `aria-expanded` / `aria-controls` / `role="button"` / `tabindex="0"` + 键盘 Enter/Space 支持
- 可访问性：Tab 面板加 `role="tablist"` / `role="tab"` / `role="tabpanel"` + `aria-selected`
- 可访问性：popup 状态点加 `aria-label`，链接加 `rel="noopener noreferrer"`
- 可访问性：`prefers-reduced-motion` 选择器扩展覆盖所有动画元素
- 交互：所有 `.ldb-btn` / `.gclip-btn` 变体加 `:hover` / `:active` / `:disabled` + `transition`
- 交互：`.ldb-toggle-section` 加 `:hover` / `:active` + `cursor: pointer` + `transition`
- 交互：`.ldb-chat-chip` / `.ldb-notion-float-btn` 加 `:active` 按下反馈
- 交互：`.ldb-progress-fill` 加 `transition: width 0.3s ease` 进度条动画
- 响应式：三面板（`.ldb-panel` / `.ldb-notion-panel` / `.gclip-panel`）加 `max-width: calc(100vw - 32px)` 防窄屏溢出
- 设计 Token：新增 `--ldb-ui-badge-teal` / `--ldb-ui-badge-blue` 替代硬编码颜色，支持暗色主题
- 设计 Token：`.ldb-text-success` / `.ldb-text-danger` / `.ldb-text-info` / `.ldb-text-muted` 工具类
- 设计 Token：16+ 处硬编码颜色 `#4ade80` / `#f87171` / `#60a5fa` / `#666` / `#888` / `#dc2626` / `#0f766e` / `#1d4ed8` 替换为 CSS 变量引用
- Popup 优化：`:active` 按下反馈 + `:focus-visible` 聚焦环 + `:disabled` 禁用态 + `prefers-reduced-motion`

- 已发布 Release：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.2>
- Tag：`v3.7.2`

### v3.7.1

本次版本聚焦「工作区可视化性能收尾 + 发布链路闭环」，重点修复大工作区下可视化模型构建的线性查找与重复遍历问题，并完成 v3.7.0 之后的发布流程收口。

- 优化：工作区可视化模型构建改用 `databasesMap.get` 替换 `databases.find`，将多次 `records.forEach` 合并为单次遍历，降低大工作区下的 CPU 开销
- 优化：`refreshWorkspaceVisualization` 中 `pageObjects` 单次遍历同时生成 `pages` 与 `records`，减少重复映射
- 修复：同步更新 `src/ui/index.js` 与根目录 `.user.js` 的工作区可视化实现
- 交付：补充交付前构建报告、UAT 检查清单、上线检查表与回滚方案
- 已发布 Release：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.1>
- 已上传扩展安装包：<https://github.com/Smith-106/LD-Notion/releases/download/v3.7.1/ld-notion-extension-v3.7.1.zip>

- Tag：`v3.7.1`

### v3.7.0

本次版本聚焦「架构升级 + 安全加固 + 测试扩展」，核心目标是消除 SyncState 双写、收紧权限域、扩展测试覆盖。

- 安全：`@match` 从 `*://*/*` 收窄为 6 个显式站点，`@connect` 从 `*` 收窄为 9 个显式域名白名单
- 安全：AI prompt injection 多层防御——XML 标签隔离 + `escapeHtml`/`safeMarkdown` 输出净化 + UI 全局 50+ 处转义
- 安全：`OperationGuard.setLevel` 强制校验 0-3 整数，拒绝无效权限级别
- 架构：完成 SyncState V1/V2 迁移，V1 改为 V2 facade 代理，消除双写，自动迁移幂等安全
- 架构：`SyncStateV2._save` 使用 `queueMicrotask` 合并写入，减少 IPC 开销
- 架构：`DedupStore` 批量模式 `beginBatch/endBatch`，同步循环中减少数百次 IPC
- 架构：拆分 god module，修复 COR-008/COR-012/SEC-006 遗漏项；删除 dead code，清理未使用导入与重复对象键
- 测试：新增 263 个用例，覆盖 17 个模块，总计 349/349 通过
- 交付：13 维度交付前检查，覆盖需求/测试/安全/性能/兼容性/部署等
- 已发布 Release：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.0>

- Tag：`v3.7.0`

### v3.6.7

本次版本聚焦「工作区级可视化收口 + 生产交付闭环」，重点把全局时间线、来源关系图、导出漏斗和刷新路径补齐到可交付状态，并把凭证、写入守卫、独立扩展注入和交付门禁统一收口到同一条生产链路。

- 新增：工作区级可视化闭环，补齐工作区视图刷新、全局时间线、来源关系图、导出漏斗，以及可复制的 Markdown 洞察报告
- 修复：写入守卫与交付门禁收口，统一 baseline、bounded-hosts、bridge runtime 与扩展表面校验
- 修复：凭证保险箱、敏感配置链路与自动同步生产闭环，减少配置漂移与凭证误暴露风险
- 修复：独立扩展站点注入与回归验证，收口扩展/脚本双形态在关键页面的运行一致性
- 交付：文档站部署链路升级到新的 Pages / Node 24 运行栈，并补齐运行态验证
- 已发布 Release：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.6.7>
- 已上传扩展安装包：<https://github.com/Smith-106/LD-Notion/releases/download/v3.6.7/LD-Notion-chrome-extension-full-v3.6.7.zip>

- Tag：`v3.6.7`

### v3.4.5

本次版本聚焦「预防性性能稳定性优化」，核心目标是降低大收藏列表与后台轮询同时存在时的主线程抖动，减少非必要重算与重复执行。

- 优化：Linux.do 收藏列表改为分片增量渲染，避免大批量条目一次性重绘带来的卡顿
- 优化：Linux.do 列表全选路径不再强制整表重新渲染，批量勾选反馈更平滑
- 优化：Notion 站内面板改为懒初始化，未使用前不抢占启动成本
- 优化：自动导入、GitHub 自动导入与更新检查改为按需/到期执行，并尽量切到浏览器空闲时运行
- 优化：自动导入增加最小运行间隔保护，降低多标签页或短时重复触发时的抖动风险

### v3.4.4

本次版本聚焦「交付稳定性与发布验证收口」，重点解决 userscript 演进时扩展生成链路过于依赖源码形状、构建验证入口分散，以及交付门槛缺少统一自动化命令的问题。

- 优化：Notion 写入口进一步收口到共享 guarded-write helper，减少 `OperationGuard.execute(...)` 在业务代码中的重复包装
- 优化：userscript 主体与 `BookmarkBridge` 构建区增加显式 build anchors，扩展构建不再主要依赖 IIFE / 对象文本形状猜测
- 优化：`scripts/build-extension.js` 为 `background.js`、`popup.html`、`popup.js`、GM shim、`content.js`、`manifest.json` 提供显式 builder seams
- 优化：生成 content script 的关键注入区增加 section marker，构建校验从散落字符串检查升级为显式契约检查
- 优化：manifest 生成策略拆成 profile/config seam，当前默认构建已切换到 `bounded_hosts`，旧的宽权限 `default` profile 仅保留给显式兼容构建
- 新增：`npm run verify:baseline`、`npm run verify:extension:bounded`、`npm run build:extension`、`npm run verify:delivery`
- 优化：发布 workflow 现在先跑 baseline，再跑 `bounded_hosts` smoke，最后构建默认的受限权限扩展 ZIP
- 文档：README / TUTORIAL / tests/README / UI 回归清单同步收口到新的构建与交付验证模型

### v3.4.3

本次版本聚焦「Notion 公开 OAuth 一键授权 + 发布链路收口」，重点解决 Notion 授权门槛高、三端 OAuth 体验不一致，以及生成扩展构建链路对源码形状过于脆弱的问题。

- 新增：Notion 公开 OAuth 一键授权入口（Linux.do 主面板 / Notion 站内面板 / 通用网页剪藏面板）
- 新增：OAuth 回调处理、access token 本地落盘与 refresh token 自动续签
- 新增：OAuth 回归测试，覆盖 callback、失败通知、401 自动 refresh retry、manual fallback 与 main 启动引导
- 优化：三端 OAuth UX 状态收口，已连接时不再直接把 access token 回填到可见输入框
- 优化：断开授权文案，明确“仅清除本地凭据，不会撤销 Notion 后台授权”
- 修复：`scripts/build-extension.js` 对 BookmarkBridge 的脆弱字符串补丁，生成扩展时恢复稳定的 `chrome.bookmarks` 直连替换
- 文档：README / TUTORIAL 同步补充 OAuth 配置、fallback、Redirect URI 和本地 secret 存储说明

- Tag：`v3.4.3`

### v3.4.2

本次版本聚焦「一般网页兼容性与导出稳定性修复」，重点解决非 UTF-8 网页乱码与图片上传异常场景。

- 浏览器书签网页洞察新增字符集感知解码：优先响应头 charset，其次 HTML meta charset / http-equiv，再按 utf-8、gb18030、big5、shift_jis 回退尝试
- 一般网页 insight 抽取增强稳健性：解析前剔除 script/style/noscript/template 噪声；标题与摘要候选补充 twitter:title / twitter:description
- 统一文本清洗增强：在空白压缩前清理 BOM 与零宽字符，减少显示残留乱码
- 图片上传回退链路增强：支持图片失败后自动按文件上传，并修复块类型切换时的字段清理一致性
- 图片 MIME 推断增强：恢复受控白名单映射，避免 `blob.type` 缺失时产生不稳定 MIME
- 已发布 Release：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.4.2>
- 已上传扩展安装包：<https://github.com/Smith-106/LD-Notion/releases/download/v3.4.2/LD-Notion-chrome-extension-full-v3.4.2.zip>

- Tag：`v3.4.2`

### v3.4.1

本次版本聚焦「扩展入口与分区操作效率 + 跨源智能标注增强」，减少手动切换与手工整理成本。

- 扩展弹窗新增「收藏来源页面」入口，可直接进入脚本 UI 的来源分区设置
- 新增 popup→content 消息桥接：支持一键切换到 GitHub 收藏分区并展开来源自动化设置
- 脚本 UI 的 Linux.do / GitHub 收藏分区继续保持独立配置（自动导入开关与间隔互不影响）
- 优化来源分区 UI 文案：统一显示「已加载收藏数量」「启用自动导入新收藏」「自动检查更新」「检查间隔」，不再随来源切换变化
- 浏览器书签导入新增自动摘要与标题生成功能：导入时自动提取网页元信息并写入 Notion（有 AI 配置时自动优化标题与摘要）
- 浏览器书签导入新增自动识别分类与标签：即使原书签名称不清晰，也会基于网页内容/域名/路径自动标注分类与标签（有 AI 配置时进一步优化分类）
- GitHub 导入新增 README 驱动分类与标签：导出 Stars/Repos/Forks 时会读取 README 语义，结合规则与 AI 分类补充「分类/标签」
- 标题策略统一：浏览器书签与 GitHub 导入在智能生成标题时，均保留元标题作为前缀（前缀 + 智能补充标题）
- 已发布 Release：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.4.1>
- 已上传扩展安装包：<https://github.com/Smith-106/LD-Notion/releases/download/v3.4.1/LD-Notion-chrome-extension-full-v3.4.1.zip>

- Tag：`v3.4.1`

### v3.4.0

本次版本聚焦「更新可见性与升级引导」，让用户能更及时获知新版本。

- 新增面板更新检查能力：支持手动「检查更新」
- 新增自动检查更新：可选 24/72/168 小时间隔
- 新增更新状态持久化：展示上次检查结果与时间
- 文档补充扩展升级说明：ZIP/解压安装需手动重装或在扩展页重新加载
- 已发布 Release：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.4.0>
- 已上传扩展安装包：<https://github.com/Smith-106/LD-Notion/releases/download/v3.4.0/LD-Notion-chrome-extension-full-v3.4.0.zip>

- Tag：`v3.4.0`

### v3.3.0

本次版本聚焦「工作区刷新顺滑度 + 安装链路简化 + GitHub 站点独立体验」。

- 工作区刷新改为分阶段加载（数据库优先、页面后补齐），并在三端面板提供阶段性反馈，避免卡在“正在获取工作区页面”
- GitHub 站点新增独立收藏加载体验（已加载数量、列表勾选导入），并支持独立自动导入开关与轮询间隔
- 书签扩展未安装状态新增「一键安装浏览器扩展」入口（主面板 + Notion 面板）
- 书签导入相关错误提示补充安装链接，降低排障路径成本
- Tampermonkey 首次使用时新增一次性安装提示（可选择立即安装或稍后）
- README 安装章节新增浏览器扩展一键安装链接（桥接扩展与独立扩展）

- Tag：`v3.3.0`

### v3.2.0

本次版本聚焦性能与稳定性优化，核心目标是减少重复请求、降低渲染开销、提升自动导入可靠性。

- 工作区刷新引入 `WorkspaceService`，统一数据库/页面拉取并对并发请求去重，减少重复 Notion API 调用
- 收藏列表改为事件委托，避免重渲染时重复绑定 `click/change` 事件
- 导出计数逻辑改为增量统计（`selectedUnexportedCount` / `totalUnexportedCount`），降低全量遍历开销
- 自动导入在页面不可见时延后执行，页面恢复可见后自动补跑，减少后台无效轮询
- Linux.do 主面板高频 DOM 查询改为 `UI.refs` 缓存优先访问，减少重复 `querySelector`
- 导出记录读取增加内存缓存，减少 `GM_getValue + JSON.parse` 的重复开销

- Tag：`v3.2.0`
- 对应提交：`16ef1fc`

### v3.1.0
- 新增：暗色/亮色主题手动切换（☀️/🌙 按钮），支持 auto/light/dark 三种模式
- 新增：Linux.do 面板 Tab 导航（📚 收藏 / 🤖 AI / ⚙️ 设置），减少滚动，聚焦当前任务
- 新增：设置面板分组折叠（筛选设置、AI 设置、GitHub 导入独立折叠区）
- 新增：主题偏好和 Tab 状态持久化
- 新增：小屏幕响应式适配（480px 以下面板全宽）
- 新增：Notion 目标配置默认优先使用工作区下拉选择（数据库/页面），手动输入 32 位 ID 调整为高级兜底入口
- 新增：独立 Chrome 扩展版（`node scripts/build-extension.js` 构建），无需 Tampermonkey
- 新增：扩展版 Popup 快速入口（Notion API / 书签 API 状态检测 + 一键导入）
- 新增：扩展版 BookmarkBridge 直接使用 `chrome.bookmarks` API，无需桥接扩展
- 新增：GM_* API 垫片（`chrome.storage.local` + service worker CORS 代理）
- 优化：Notion 面板添加主题切换按钮
- 优化：所有硬编码颜色替换为 CSS 变量，暗色模式下显示一致
- 优化：主题系统从 `prefers-color-scheme` 媒体查询升级为 `data-ldb-theme` 属性驱动

### v3.0.0
- 新增：GitHub 全类型导入（Stars / Repos / Forks / Gists），可在设置中勾选启用
- 新增：浏览器书签导入，配套 Chrome 扩展通过 `chrome.bookmarks` API 直接读取
- 新增：跨源搜索工具 `cross_source_search`，支持在 Linux.do/GitHub/书签中统一搜索
- 新增：跨源统计工具 `unified_stats`，展示各来源数量和分类分布
- 新增：智能推荐工具 `recommend_similar`，AI 找相似内容
- 新增：批量打标签工具 `batch_tag`，AI 自动为未标记页面添加标签
- 新增：「来源类型」字段（Star/Fork/Repo/Gist/书签），支持跨源筛选
- 新增：「书签路径」字段，保留浏览器书签的文件夹层级
- 优化：GitHub API 请求统一为通用分页方法，减少代码重复

### v2.5.0
- 新增：刷新页数上限可自定义（5/10/20/50 页或无限制），防止大型工作区过多 API 调用
- 优化：两侧面板同步支持该设置，选择后立即生效

### v2.4.2
- 新增：Notion 面板刷新按钮同时获取数据库和页面，下拉框分「📁 数据库」和「📄 页面」两组显示
- 新增：支持选择工作区顶级页面作为导出目标
- 修复：页面选项用 `page:` 前缀区分类型，防止覆盖数据库 ID 导致操作失败
- 修复：rich_text 数组超过 100 个元素导致 Notion API 400 错误
- 优化：标签和提示文本更新为「数据库 / 页面」

### v2.4.1
- 优化：Notion 面板用数据库选择器替换数据库 ID 手动输入框，消除重复 UI
- 修复：旧配置兼容——缓存为空时也能显示已配置的数据库 ID
- 修复：刷新数据库列表后选中值不再被重置为「未选择」

### v2.4.0
- 新增：AI 搜索分页，突破 Notion API 单次 100 条限制（最多 1000 条）
- 新增：AI 设置「查询数据库」下拉框，可选当前配置/所有工作区/指定数据库
- 新增：query_database 工具支持多数据库查询，结果标记来源数据库
- 新增：Linux.do 面板和 Notion 站点面板同步支持数据库选择器
- 优化：分页查询设 10 页上限，防止大型工作区过多 API 调用
- 修复：缓存数据库列表校验 API Key，防止切换 Key 后结果不匹配

### v2.3.0
- 新增：并发导出支持，可选 1/2/3/5 个并发加速导出
- 新增：筛选设置新增「并发数」选项
- 优化：自动导入同样支持并发设置

### v2.2.1
- 修复：AI 属性填充（handleAIAutofill）新增 OperationGuard 权限检查
- 修复：恢复意图解析路由，已知意图走专用 handler，未知/复杂意图走 Agent Loop

### v2.2.0
- 新增：自动导入新收藏功能，支持定时轮询
- 新增：配置验证，防止未配置时盲目执行
- 新增：手动/自动导出互斥保护，防止重复
- 优化：导出按钮异常安全恢复

### v2.1.0
- 新增：AI 助手升级为 Agent Loop（ReAct 模式）
- 新增：多轮工具调用，支持搜索、创建、更新等操作

### v2.0.0
- 新增：AI 对话式助手，支持多种 AI 服务
- 新增：Notion 站点浮动 AI 助手面板
- 新增：内置六大功能模块（搜索、创建、更新等）

### v1.8.0
- 新增：AI 助手浮动图标支持拖拽移动并记住位置

### v1.1.0
- 新增：选择性导出功能，可视化列表勾选
- 新增：暂停/继续导出功能
- 新增：导出报告，详细展示导出结果
- 新增：表格格式支持
- 优化：API 速率限制自动重试
- 优化：扩展 Emoji 映射 (100+)
- 修复：空楼层处理
- 修复：h4-h6 标题降级为 h3

### v1.0.0
- 初始版本发布

## 致谢

本项目参考了以下优秀作品：
- [Linux.do 帖子导出到 Notion](https://greasyfork.org/scripts/561916) by flobby
- [LDStatus Pro](https://github.com/caigg188/LDStatusPro) by JackLiii

## 许可证

MIT License
