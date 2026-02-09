# Linux.do 收藏帖子导出到 Notion

一个 Tampermonkey 用户脚本，用于批量导出 Linux.do 收藏的帖子到 Notion 数据库。

## 功能特点

### 核心功能
- **批量导出**：一键导出所有收藏的帖子
- **选择性导出**：可视化列表，勾选需要导出的帖子
- **自定义筛选**：支持楼层范围、仅主楼、仅楼主等筛选条件
- **图片处理**：支持上传到 Notion、外链引用、跳过图片三种模式

### 高级功能
- **暂停/继续**：导出过程中可随时暂停和继续
- **智能去重**：自动跳过已导出的帖子
- **导出报告**：详细展示成功、失败和跳过的帖子
- **进度显示**：实时显示导出进度和当前状态
- **API 速率限制**：自动处理 Notion API 速率限制，失败自动重试
- **表格支持**：完整保留帖子中的表格格式

### 格式支持
- 代码块（支持语法高亮）
- 引用块
- 有序/无序列表
- 多级标题 (h1-h6)
- 表格
- 图片
- 链接
- 粗体、斜体、删除线、行内代码
- Emoji 表情 (100+ 种)

## 安装说明

### 1. 安装 Tampermonkey

首先需要安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)：
- [Chrome 版本](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox 版本](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Edge 版本](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

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

1. 访问你的收藏页面：`https://linux.do/u/你的用户名/activity/bookmarks`
2. 页面右侧会出现工具面板
3. 填写 Notion API Key 和数据库 ID
4. 点击「验证配置」确认连接正常
5. 点击「加载收藏列表」获取收藏
6. **选择要导出的帖子**（默认全选，可取消勾选不需要的）
7. 根据需要调整筛选设置
8. 点击「开始导出」

### 导出控制
- **暂停/继续**：导出过程中可点击「暂停」按钮暂停导出，再次点击继续
- **取消**：点击「取消」按钮可中止导出，已导出的内容不会被删除
- **导出报告**：导出完成后会显示详细报告，包括成功、失败和跳过的帖子

## 筛选选项

- **仅主楼**：只导出每个帖子的第一楼（主帖）
- **仅楼主**：只导出楼主的回复
- **楼层范围**：设置导出的楼层范围（如 1-10）
- **图片处理**：
  - 上传到 Notion：将图片上传到 Notion 服务器（稳定但较慢）
  - 外链引用：直接使用原图链接（快速但可能失效）
  - 跳过图片：不导出图片

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
A: 这是正常现象：
1. 每个帖子需要获取完整内容
2. 图片上传需要时间
3. 为避免触发 API 限制，有意添加延迟
4. 遇到速率限制会自动等待重试

### Q: 如何重新导出已导出的帖子？
A: 在浏览器控制台执行：
```javascript
GM_setValue("ldb_exported_topics", "{}")
```

### Q: 导出过程中可以暂停吗？
A: 可以。点击「暂停」按钮暂停导出，点击「继续」恢复。暂停期间已导出的内容不会丢失。

### Q: 取消导出后可以继续吗？
A: 取消后需要重新开始导出。但已导出的帖子会被自动跳过，不会重复导出。

### Q: 表格导出后格式不正确？
A: 确保帖子中的表格是标准的 HTML 表格格式。Markdown 表格会被正确转换为 Notion 表格。

## 技术说明

- 基于 Discourse API 获取帖子数据
- 使用 Notion API 创建数据库记录
- DOM 解析转换为 Notion Block 格式
- 支持代码高亮、引用、表格等格式
- 自动处理 API 速率限制 (429 响应自动重试)
- 支持暂停/继续的异步导出流程

## 更新日志

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
