# Linux.do Adapter

Linux.do adapter 负责读取收藏列表和帖子详情，并把 Discourse 风格内容转换为 LD-Notion 的 normalized schema mapping。

## Extraction rules

| Rule | Description |
| --- | --- |
| 收藏列表 | 从已登录用户可见的收藏入口加载 topic 列表 |
| 帖子详情 | 拉取 topic 内容、楼层、作者、回复和统计信息 |
| 筛选 | 支持仅主楼、仅楼主、楼层范围、包含 / 排除关键词 |
| 格式转换 | 将标题、段落、列表、引用、代码块、表格、图片转换为 Notion Blocks |
| 图片策略 | 上传到 Notion、外链引用或跳过 |

## Metadata fields

| Field | Meaning |
| --- | --- |
| title | 帖子标题 |
| url | 原帖链接 |
| author | 楼主或楼层作者 |
| collectedAt | 收藏时间 |
| replyCount | 回复数量 |
| viewCount | 浏览数 |
| likeCount | 点赞数 |
| tags/category | AI 或规则生成的分类标签 |

## normalized schema mapping

| Source field | normalizedContent field | Destination |
| --- | --- | --- |
| topic id / URL | identity.sourceId / identity.url | 链接 |
| topic title | content.title | 标题 |
| cooked HTML / posts | content.body | Notion children blocks |
| author username | metadata.author | 作者 |
| stats | metadata.extra | 帖子数 / 浏览数 / 点赞数 |
| selected filters | routing.template | 导出配置说明 |

## Fallback behavior

| Failure | fallback behavior |
| --- | --- |
| 收藏列表加载失败 | 提示登录状态或网络问题 |
| 部分帖子详情失败 | 跳过失败项并在报告中列出 |
| 图片上传失败 | 尝试文件上传或改用外链 / 跳过策略 |
| Notion 429 | 等待后重试 |
| 格式不支持 | 降级为段落文本 |

## Known limitations

- 自动导入依赖页面保持打开。
- 需要用户当前浏览器已登录 Linux.do。
- 私有或权限受限图片可能无法被 Notion 访问。
- 复杂 HTML 结构可能无法 100% 映射到 Notion Blocks。
