# Zhihu Adapter

Zhihu adapter 面向知乎文章、专栏和回答内容导出。相比 Linux.do 与 GitHub，知乎页面结构和登录可见性更容易变化，因此需要更明确的 fallback behavior。

## Extraction rules

| Rule | Description |
| --- | --- |
| URL match | 支持 `www.zhihu.com` 和 `zhuanlan.zhihu.com` |
| Page metadata | 抽取标题、作者、来源 URL 和摘要 |
| Content cleanup | 清理页面噪声，保留正文线索 |
| Image handling | 复用导入管线的图片策略 |
| Fallback | 页面结构不匹配时降级为通用网页剪藏 |

## Metadata fields

| Field | Meaning |
| --- | --- |
| title | 文章、回答或页面标题 |
| url | 原始 URL |
| author | 作者名，可能为空 |
| excerpt | 页面摘要 |
| sourceType | article / answer / web |
| tags/category | 规则或 AI 分类 |

## normalized schema mapping

| Source field | normalizedContent field | Destination |
| --- | --- | --- |
| URL | identity.url | 链接 |
| page title | content.title | 标题 |
| article body / extracted text | content.body | Notion blocks / Markdown |
| author | metadata.author | 作者 |
| source type | metadata.source | 来源类型 |

## fallback behavior

| Failure | fallback behavior |
| --- | --- |
| 页面结构变更 | 降级为通用网页剪藏 |
| 登录内容不可见 | 只导出可见标题和 URL |
| 图片不可访问 | 改用外链或跳过 |
| 字符串抽取为空 | 提示用户当前页面不适合自动导出 |

## Known limitations

- 页面结构变化可能导致抽取质量下降。
- 登录或权限限制会影响可见内容。
- 长文或动态加载内容可能只抽取到部分正文。
