# Bookmarks Adapter

Bookmarks adapter 读取浏览器书签树，把 URL、标题和文件夹路径导入 Notion，并可结合网页元信息与 AI 进行标题、摘要、分类增强。

## Extraction rules

| Rule | Description |
| --- | --- |
| 脚本版 | 通过 `chrome-extension/` 桥接扩展读取 `chrome.bookmarks` |
| 独立扩展版 | 直接使用内置 `bookmarks` 权限 |
| Folder path | 保留书签所在文件夹层级 |
| Web insight | 可抽取网页标题、摘要和域名信息 |
| Dedup | 按 URL 和路径策略去重 |

## Metadata fields

| Field | Meaning |
| --- | --- |
| title | 书签标题或网页标题 |
| url | 书签 URL |
| folderPath | 浏览器书签文件夹路径 |
| domain | URL 域名 |
| excerpt | 网页摘要 |
| tags/category | 规则或 AI 生成 |

## normalized schema mapping

| Source field | normalizedContent field | Destination |
| --- | --- | --- |
| bookmark id / URL | identity.sourceId / url | 链接 |
| title | content.title | 标题 |
| folder path | metadata.folderPath | 书签路径 |
| webpage excerpt | content.excerpt | 摘要 |
| domain | metadata.sourceSite | 来源站点 |

## fallback behavior

| Failure | fallback behavior |
| --- | --- |
| 桥接扩展未安装 | 提示安装桥接扩展或使用独立扩展版 |
| 网页摘要抽取失败 | 使用书签标题和 URL |
| 页面字符集异常 | 尝试 charset 回退解码 |
| AI 分类失败 | 使用域名和路径规则分类 |
| URL 重复 | 按去重策略跳过或提示已导入 |

## Known limitations

- 脚本版无法直接调用 `chrome.bookmarks`，必须依赖桥接扩展。
- 某些网页需要登录，摘要抽取可能为空。
- 书签标题可能过短或不具备语义，需要 AI 或网页元信息增强。
