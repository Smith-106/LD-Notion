# LD-Notion

一个 Tampermonkey 用户脚本，将 **Linux.do** 与 **Notion** 深度连接：批量导出收藏帖子到 Notion，同时在两个站点提供 AI 对话式助手，支持自然语言管理 Notion 工作区。

[![安装脚本](https://img.shields.io/badge/安装脚本-Tampermonkey-green?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/Smith-106/LD-Notion/main/LinuxDo-Bookmarks-to-Notion.user.js) [![使用教程](https://img.shields.io/badge/使用教程-TUTORIAL-blue?style=for-the-badge)](./TUTORIAL.md)

## 两大核心能力

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

### 2. Notion AI 助手

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
| `write_content` | 向页面追加 Markdown 内容 | 标准 |
| `update_page` | 更新页面属性值 | 标准 |
| `create_page` | 在数据库中创建新页面 | 标准 |
| `auto_classify` | AI 自动分类未分类页面 | 标准 |
| `move_page` | 移动页面到另一个数据库 | 高级 |
| `copy_page` | 复制页面到另一个数据库 | 高级 |
| `create_database` | 创建新数据库 | 高级 |

#### 意图识别

直接用自然语言发指令，AI 自动识别意图：

- **搜索**：「搜索关于 Docker 的帖子」
- **查询统计**：「统计各分类的文章数量」
- **分类**：「给未分类的文章自动分类」
- **写入**：「在这个页面末尾加一段总结」
- **编辑**：「改写这篇文章，语气更正式」
- **翻译**：「把这篇翻译成英文」
- **创建**：「创建一个叫"周报"的数据库」
- **移动/复制**：「把这个页面移到归档数据库」
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

### 1. 安装 Tampermonkey

- [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

### 2. 安装脚本

1. 点击 Tampermonkey 图标 → 添加新脚本
2. 复制 `LinuxDo-Bookmarks-to-Notion.user.js` 的全部内容
3. 粘贴并保存（Ctrl+S）

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

### 4. 获取数据库 ID

数据库链接格式：
```
https://www.notion.so/xxx/32位数据库ID?v=xxx
```

复制链接中的 32 位数据库 ID。

## 使用方法

### 帖子导出

1. 访问你的收藏页面：`https://linux.do/u/你的用户名/activity/bookmarks`
2. 页面右侧会出现工具面板
3. 填写 Notion API Key，通过数据库选择器选择目标（或手动输入 ID）
4. 点击「加载收藏列表」获取收藏
5. 勾选要导出的帖子，调整筛选设置
6. 点击「开始导出」

### 自动导入

1. 完成 Notion 配置
2. 勾选「启用自动导入新收藏」
3. 选择轮询间隔
4. 新收藏将自动导出，无需手动操作

### AI 助手

- **Linux.do 侧**：在收藏页面的工具面板中使用
- **Notion 侧**：在任意 Notion 页面点击右下角浮动图标
- 输入自然语言指令，AI 自动执行对应操作

## 常见问题

### Q: 验证配置失败？
A: 请检查：
1. API Key 是否正确复制（以 `secret_` 开头）
2. 数据库 ID 是否为 32 位
3. Integration 是否已关联到数据库

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

- 基于 Discourse API 获取帖子数据
- 使用 Notion API 创建数据库记录和子页面
- DOM 解析转换为 Notion Block 格式
- 自动处理 API 速率限制 (429 响应自动重试)
- AI 助手使用 ReAct Agent Loop 架构，支持多轮推理和工具调用

## 开发与验证

- 语法检查：`node --check LinuxDo-Bookmarks-to-Notion.user.js`（如无 Node 可跳过）
- UI 静态校验：`node scripts/validate-userscript-ui.js`（或 `python3 scripts/validate-userscript-ui.py`）
- UI 手工回归：`docs/ui-regression-checklist.md`
- 四级权限模型 + OperationGuard 保护所有写入操作

## 更新日志

### v2.4.3
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
