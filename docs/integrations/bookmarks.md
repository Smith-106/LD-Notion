# Bookmarks Adapter

Bookmarks adapter 读取浏览器书签树，把 URL、标题和文件夹路径导入 Notion，并可结合网页元信息与 AI 进行标题、摘要、分类增强。

## Extraction rules

| Rule | Description |
| --- | --- |
| 脚本版 | 通过 `chrome-extension-full/` 桥接扩展读取 `chrome.bookmarks` |
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

## Write-back organize（写回整理，v3.14.28）

除导入外，adapter 还能整理浏览器书签本身，设计原则是**移动优先、零删除**。

| 阶段 | 行为 |
| --- | --- |
| scan | 只读扫描：重复书签判定、失效链接探测（HEAD 优先、失败降级 GET，并发 5、单次超时 15s、退避 1s）、可选 AI 归类 |
| preview | 面板展示计划：重复 / 失效 / 待归类条数与样例，确认后才继续 |
| backup | 下载全量书签 JSON 备份 |
| execute | **仅移动**：重复项与失效项移入「其他书签 → LD-Notion 整理」下的「重复书签」/「待清理失效」，AI 归类项移入对应文件夹 |
| undo | 「↩️ 撤销整理」按持久化的原 `parentId` 回滚上一次整理 |

- 入口：设置面板「🧹 整理书签」/「↩️ 撤销整理」。
- 权限：写入经 OperationGuard 的 `bookmarks.organize`（等级 2 高级）；权限不足时拒绝并记审计。
- 扩展桥接：仅开放白名单动作，**不提供 remove**——整理不会删除任何书签。
- 单次上限：失效检测 500 条（超出标记「未检测」而非判失效）、AI 归类 50 条、撤销记录 FIFO 5000 条。

## Known limitations

- 脚本版无法直接调用 `chrome.bookmarks`，必须依赖桥接扩展。
- 某些网页需要登录，摘要抽取可能为空。
- 书签标题可能过短或不具备语义，需要 AI 或网页元信息增强。
