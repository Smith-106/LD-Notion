# LD-Notion Hub — AI 多源知识中枢

一个可扩展的 Tampermonkey 用户脚本，统一连接 **Linux.do**、**GitHub**、**浏览器书签** 与 **Notion**：多源收藏导入、跨源智能搜索与推荐、AI 对话式管理工作区，并可继续接入更多内容来源。

[![安装脚本](https://img.shields.io/badge/安装脚本-Tampermonkey-green?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js) [![使用教程](https://img.shields.io/badge/使用教程-TUTORIAL-blue?style=for-the-badge)](./TUTORIAL.md) [![安装浏览器拓展](https://img.shields.io/badge/安装浏览器拓展-Release-orange?style=for-the-badge&logo=googlechrome)](https://github.com/Smith-106/LD-Notion/releases/latest)

- v3.4.1 插件 ZIP 直链：<https://github.com/Smith-106/LD-Notion/releases/download/v3.4.1/LD-Notion-chrome-extension-full-v3.4.1.zip>
- v3.4.1 Release 页面：<https://github.com/Smith-106/LD-Notion/releases/tag/v3.4.1>

## 四大核心能力

### 1. Linux.do 收藏导出器

在 Linux.do 收藏页面自动加载工具面板，将帖子导出到 Notion 数据库或页面。

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

通过配套 Chrome 扩展读取浏览器书签，一键导入 Notion 进行整理。

- **Chrome API 直接读取**：无需手动导出书签文件
- **文件夹路径保留**：书签的文件夹层级结构会记录在「书签路径」字段中
- **智能去重**：已导入的书签不会重复
- **配套扩展极简**：仅 2 个文件，不收集任何数据

### 4. Notion AI 助手

在 **Linux.do** 和 **Notion** 站点均可使用的对话式 AI 助手，通过自然语言操作 Notion 工作区。

#### AI 服务

支持 OpenAI、Anthropic、Google Gemini 等多种 AI 服务，可自定义 Base URL 和模型。

#### Agent Loop (ReAct 模式)

AI 助手采用 ReAct 推理架构，支持多轮工具调用，自动拆解复杂任务：

| 工具 | 能力 | 权限等级 |
|------|------|----------|
| `search_workspace` | 搜索工作区中的页面或数据库 | 只读 |
| `query_database` | 查询数据库，支持筛选/排序/分页 | 只读 |
| `read_page` | 读取页面文字内容 | 只读 |
| `get_database_schema` | 获取数据库属性结构 | 只读 |
| `cross_source_search` | 跨源搜索（Linux.do/GitHub/书签） | 只读 |
| `unified_stats` | 跨源数据统计（各来源数量、分类分布） | 只读 |
| `recommend_similar` | AI 智能推荐相似内容 | 只读 |
| `write_content` | 向页面追加 Markdown 内容 | 标准 |
| `update_page` | 更新页面属性值 | 标准 |
| `create_page` | 在数据库中创建新页面 | 标准 |
| `auto_classify` | AI 自动分类未分类页面 | 标准 |
| `batch_tag` | AI 批量自动打标签 | 标准 |
| `move_page` | 移动页面到另一个数据库 | 高级 |
| `copy_page` | 复制页面到另一个数据库 | 高级 |
| `create_database` | 创建新数据库 | 高级 |

#### 意图识别

直接用自然语言发指令，AI 自动识别意图：

- **搜索**：「搜索关于 Docker 的帖子」
- **跨源搜索**：「在所有来源中搜索 Kubernetes」
- **查询统计**：「统计各分类的文章数量」
- **跨源统计**：「各来源分别有多少条数据」
- **分类**：「给未分类的文章自动分类」
- **打标签**：「给所有 GitHub 仓库自动打标签」
- **智能推荐**：「推荐和这篇文章相似的内容」
- **写入**：「在这个页面末尾加一段总结」
- **编辑**：「改写这篇文章，语气更正式」
- **翻译**：「把这篇翻译成英文」
- **创建**：「创建一个叫"周报"的数据库」
- **移动/复制**：「把这个页面移到归档数据库」
- **GitHub 导入**：「导入我的 GitHub 收藏」
- **书签导入**：「导入浏览器书签」
- **RAG 问答**：「我的笔记里有没有关于 K8s 的内容」

#### Notion 站点面板

在 Notion 页面右下角显示浮动 AI 图标，点击展开面板：
- 配置 Notion API Key、AI 服务和模型
- 数据库 / 页面选择器，支持刷新获取工作区列表
- 对话式 AI 助手，与 Linux.do 侧共享配置
- 可拖拽移动，记住位置

### 安全与权限

- **四级权限**：只读 → 标准 → 高级 → 管理员，按需授权
- **操作守卫**：所有写入操作经过 OperationGuard 权限检查
- **审计日志**：记录操作历史，支持查看和清除
- **撤销支持**：危险操作提供 5 秒撤销窗口

## 安装

本项目提供两种使用方式，功能完全一致，按需选择。

> 当前优先支持：Chrome / Edge（脚本版与独立扩展版均按这两种浏览器验证）

### 方式 A：油猴脚本（推荐）

#### 1. 安装 Tampermonkey

- [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

#### 2. 安装脚本

1. 点击 Tampermonkey 图标 → 添加新脚本
2. 复制 `LinuxDo-Bookmarks-to-Notion.user.js` 的全部内容
3. 粘贴并保存（Ctrl+S）
4. 打开以下任一站点验证入口是否生效：
   - `https://linux.do/u/你的用户名/activity/bookmarks`（完整面板）
   - `https://www.notion.so/`（右下角浮动 AI 按钮）
   - `https://github.com/`（与 Linux.do 同步的完整面板）

#### 3. 安装书签桥接扩展（可选，仅导入浏览器书签需要）

- 一键安装浏览器扩展：<https://github.com/Smith-106/LD-Notion/releases/latest>

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

#### 2. 安装扩展

- 一键安装浏览器扩展（预构建目录）：<https://github.com/Smith-106/LD-Notion/releases/latest>

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

1. 访问你的收藏页面：`https://linux.do/u/你的用户名/activity/bookmarks`
2. 页面右侧会出现工具面板
3. 填写 Notion API Key，点击刷新并从工作区下拉框选择目标（加载失败时可在高级项手动输入 ID）
4. 点击「加载收藏列表」获取收藏
5. 勾选要导出的帖子，调整筛选设置
6. 点击「开始导出」

### 自动导入

1. 完成 Notion 配置
2. 勾选「启用自动导入新收藏」
3. 选择轮询间隔
4. 新收藏将自动导出，无需手动操作

### 更新检查

1. 在收藏面板中点击「检查更新」可立即检查新版本
2. 勾选「自动检查更新」后，可选择 24/72/168 小时间隔自动检查
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
3. 建议使用「上传到 Notion」模式

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

- 语法检查：`node --check LinuxDo-Bookmarks-to-Notion.user.js`（如无 Node 可跳过）
- 构建扩展版：`node scripts/build-extension.js`（输出到 `chrome-extension-full/`）
- UI 静态校验：`node scripts/validate-userscript-ui.js`（或 `python3 scripts/validate-userscript-ui.py`）
- UI 手工回归：`docs/ui-regression-checklist.md`
- 四级权限模型 + OperationGuard 保护所有写入操作

## 更新日志

### v3.4.1

本次版本聚焦「扩展入口与分区操作效率 + 跨源智能标注增强」，减少手动切换与手工整理成本。

- 扩展弹窗新增「收藏来源页面」入口，可直接进入脚本 UI 的来源分区设置
- 新增 popup→content 消息桥接：支持一键切换到 GitHub 收藏分区并展开来源自动化设置
- 脚本 UI 的 Linux.do / GitHub 收藏分区继续保持独立配置（自动导入开关与间隔互不影响）
- 优化来源分区 UI 文案：统一显示「已加载收藏数量」「启用自动导入新收藏」，不再随来源切换变化
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
