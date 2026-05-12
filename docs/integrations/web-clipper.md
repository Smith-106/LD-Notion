# Web Clipper Adapter

Web Clipper adapter 是未命中专用来源时的通用路径，用于从普通网页抽取标题、来源、摘要和正文线索，再导入 Notion 或 Obsidian。

## Extraction rules

| Rule | Description |
| --- | --- |
| Host filtering | 排除搜索、邮箱、localhost 等不适合剪藏的页面 |
| Title extraction | 优先使用页面标题和 Open Graph / Twitter meta |
| Summary extraction | 从 meta description、正文段落和可见文本中生成摘要 |
| Charset handling | 按响应头、HTML meta、回退编码尝试解码 |
| Noise cleanup | 去除 script、style、noscript、template 等噪声 |

## Metadata fields

| Field | Meaning |
| --- | --- |
| title | 网页标题 |
| url | 当前页面 URL |
| site | 域名或站点名 |
| excerpt | 摘要 |
| charset | 推断编码 |
| capturedAt | 捕获时间 |

## normalized schema mapping

| Source field | normalizedContent field | Destination |
| --- | --- | --- |
| location.href | identity.url | 链接 |
| document title / meta title | content.title | 标题 |
| meta description / paragraph | content.excerpt | 摘要 |
| visible text | content.body | Markdown / Notion Blocks |
| hostname | metadata.sourceSite | 来源站点 |

## fallback behavior

| Failure | fallback behavior |
| --- | --- |
| 页面禁止访问 | 只保留标题和 URL |
| charset 解码失败 | 使用 UTF-8 结果并提示可能乱码 |
| 正文抽取为空 | 导出 metadata-only 条目 |
| Notion 写入失败 | 保留预览，不伪造成功 |
| Obsidian API 不可达 | 提示检查 Local REST API |

## Known limitations

- 动态渲染页面可能缺少可抽取正文。
- 需要登录的内容通常只能抽取当前 DOM 可见部分。
- 通用抽取无法保证像专用 adapter 一样保留全部结构。
