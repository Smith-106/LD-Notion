# LD-Notion Hub — AI 多源知识中枢

一个可扩展的 Tampermonkey 用户脚本，统一连接 **Linux.do**、**GitHub**、**浏览器书签** 与 **Notion**：多源收藏导入、跨源智能搜索与推荐、AI 对话式管理工作区，并可继续接入更多内容来源。

[![安装脚本](https://img.shields.io/badge/安装脚本-Tampermonkey-green?style=for-the-badge&logo=tampermonkey)](https://greasyfork.org/zh-CN/scripts/566681-ld-notion-notion-ai-%E5%8A%A9%E6%89%8B-linux-do-%E6%94%B6%E8%97%8F%E5%AF%BC%E5%87%BA) [![使用教程](https://img.shields.io/badge/使用教程-TUTORIAL-blue?style=for-the-badge)](./TUTORIAL.md) [![安装浏览器扩展](https://img.shields.io/badge/安装浏览器扩展-Release-orange?style=for-the-badge&logo=googlechrome)](https://github.com/Smith-106/LD-Notion/releases/latest)

- 当前版本（仓库 / 脚本头）：`v3.4.5`
- 最近已发布版本：`v3.4.3`
- 脚本安装（GreasyFork 页面）：<https://greasyfork.org/zh-CN/scripts/566681-ld-notion-notion-ai-%E5%8A%A9%E6%89%8B-linux-do-%E6%94%B6%E8%97%8F%E5%AF%BC%E5%87%BA>
- 脚本安装（直链）：<https://update.greasyfork.org/scripts/566681/LD-Notion%20Hub%20%E2%80%94%20AI%20%E5%A4%9A%E6%BA%90%E7%9F%A5%E8%AF%86%E4%B8%AD%E6%9E%A2.user.js>
- 最近已发布扩展 ZIP 直链（v3.4.3）：<https://github.com/Smith-106/LD-Notion/releases/download/v3.4.3/LD-Notion-chrome-extension-full-v3.4.3.zip>
- 最近已发布 Release 页面（v3.4.3）：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.4.3>

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
- **脚本版 + 书签桥接扩展（`chrome-extension/`）**
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
| 页面与块编辑 | 「在“项目计划”页面末尾插入一段说明」「在 block_xxx 后插入内容」「把 block_xxx 改成新文案」 | 标准 |
| 页面元数据与整理 | 「给“项目计划”加封面」「把“项目计划”换成 🚀 图标」「锁定 / 归档 / 恢复页面」 | 标准 / 高级 |
| 创建与批量处理 | 「创建页面」「批量创建页面」「批量更新页面」「自动分类未分类页面」「批量打标签」 | 标准 |
| 跨源检索与导入 | 「在 Linux.do / GitHub / 书签里统一搜索」「导入 GitHub 收藏」「导入浏览器书签」 | 只读 / 标准 |
| AI 深度工作流 | 「总结页面」「头脑风暴」「校对」「批量翻译数据库」「把页面笔记提取为数据库」「生成多页面结构化内容」 | 只读 / 标准 / 高级 |

#### 意图识别

直接用自然语言发指令，AI 自动识别意图：

- **页面 / 数据库对象**：「查看“项目计划”页面详情」「查看“知识库”数据库属性」
- **页面 Markdown / 块 / 评论**：「读取“项目计划” Markdown」「查看“项目计划”页面评论」「查看 comment_xxx」
- **页面 / 块写入**：「在“项目计划”页面插入“新增说明”」「把 block_xxx 改成“新的段落内容”」
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

## 安装

本项目提供两种使用方式，功能完全一致，按需选择。

> 当前优先支持：Chrome / Edge（脚本版与独立扩展版均按这两种浏览器验证）

### 方式 A：油猴脚本（推荐）

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

- 默认 profile 仍然生成当前发布用的扩展形态，保留多源裁剪所需的广泛 `host_permissions`
- 如需做更收敛的本地验证，可临时指定 `LD_NOTION_MANIFEST_PROFILE=bounded_hosts` 后再执行构建；这不是当前默认发布配置
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

如果你不想手动粘贴 Token，现在也可以改用 Notion 公开集成的 OAuth 授权流：

1. 在你的 Notion 集成设置里启用 Public/Distribution 能力
2. 添加 Redirect URI
   - 推荐填 `https://www.notion.so/`
   - LD-Notion 的 userscript 和 `chrome-extension-full` 都能在这个地址接住回调
3. 复制该公开集成的 `Client ID` 和 `Client Secret`
4. 在 LD-Notion 面板里填写 `Client ID`、`Client Secret`、`Redirect URI`
5. 点击 `🔐 一键授权`
6. 完成 Notion 授权后，LD-Notion 会自动把 access token 写入本地配置，后续功能继续按原来的 API Key 流工作

注意：
- 当前项目是纯前端运行，没有单独后端，因此 `Client Secret` 会保存在你的本地浏览器存储中
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
A: 在浏览器控制台执行：
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

## 开发与验证

- 推荐验证梯度：
  1. `npm test`
  2. `node --check LinuxDo-Bookmarks-to-Notion.user.js`
  3. `node scripts/validate-userscript-ui.js`
  4. 如涉及扩展交付：`node scripts/build-extension.js`
  5. 最后按 `docs/ui-regression-checklist.md` 做 Linux.do / Notion / 通用网页 / `chrome-extension-full` 手工 smoke
- 一键交付验证：`npm run verify:delivery`
- `npm test`：运行 `tests/utils.test.js` 和 `tests/notion-oauth.test.js`
- Node 测试会直接读取并执行当前 `LinuxDo-Bookmarks-to-Notion.user.js` 的核心代码，并复用 `scripts/build-extension.js` 的提取/构建 seam，而不是维护一份单独的测试副本
- 当前自动化验证重点覆盖：Utils 辅助函数、OAuth 回调与 refresh fallback、`TargetState`、`quickParseIntent` 正/反例、`assistant_result v1` 输出契约，以及 `scripts/build-extension.js` 的锚点、builder seam、manifest profile 与构建冒烟
- 语法检查：`node --check LinuxDo-Bookmarks-to-Notion.user.js`（如无 Node 可跳过）
- 构建扩展版：`node scripts/build-extension.js`（输出到 `chrome-extension-full/`）
- 自动化收敛权限 smoke：`npm run verify:extension:bounded`（写入临时目录并自动清理）；默认 release / README 安装流程仍以默认 profile 为准
- UI 静态校验：`node scripts/validate-userscript-ui.js`（或 `python3 scripts/validate-userscript-ui.py`）
- UI 手工回归：`docs/ui-regression-checklist.md`
- 四级权限模型 + `OperationGuard` 统一保护用户触发与 AI 触发的写入入口；危险操作额外确认，撤销窗口只覆盖危险操作

## 更新日志

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
- 优化：manifest 生成策略拆成 profile/config seam，默认 release 仍保持当前宽权限形态，同时提供 `bounded_hosts` 作为可选收敛 smoke profile
- 新增：`npm run verify:baseline`、`npm run verify:extension:bounded`、`npm run build:extension`、`npm run verify:delivery`
- 优化：发布 workflow 现在先跑 baseline，再跑 `bounded_hosts` smoke，最后才构建默认 release 扩展 ZIP
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
