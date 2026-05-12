# GitHub Adapter

GitHub adapter 负责读取 Stars、Repos、Forks 和 Gists，并将仓库元信息、README 语义和用户选择映射到 Notion 数据库条目。

## Extraction rules

| Rule | Description |
| --- | --- |
| Stars | 读取用户 star 的仓库列表 |
| Repos | 读取用户拥有的仓库 |
| Forks | 读取 fork 过的仓库 |
| Gists | 读取代码片段 |
| README enrichment | 对仓库 README 做摘要和分类增强 |
| Token optional | 未配置 token 时仍可请求，但速率限制更低 |

## Metadata fields

| Field | Meaning |
| --- | --- |
| fullName | `owner/repo` |
| url | 仓库或 gist URL |
| description | GitHub 描述 |
| language | 主语言 |
| stars | Star 数 |
| topics | GitHub topics |
| readmeExcerpt | README 摘要 |

## normalized schema mapping

| Source field | normalizedContent field | Destination |
| --- | --- | --- |
| full name / gist id | identity.sourceId | 来源 ID |
| html_url | identity.url | 链接 |
| name + description | content.title / excerpt | 标题 / 摘要 |
| README | content.body | 页面正文或说明 |
| language / topics | metadata.tags | 标签 |
| stars / forks | metadata.extra | 数字属性 |

## fallback behavior

| Failure | fallback behavior |
| --- | --- |
| GitHub token missing | 使用未认证 API，提示速率限制更低 |
| README 读取失败 | 只使用仓库描述和 topics |
| 某类导入未勾选 | 跳过该类型 |
| API rate limited | 显示限制提示并建议配置 token |
| AI 分类失败 | 使用语言、topics 和规则分类 |

## Known limitations

- 未认证请求受 GitHub rate limit 影响。
- README 内容过大时只能使用摘要或前段内容。
- 私有仓库需要 token 具备访问权限。
- GitHub 元数据不等同于项目质量判断，AI 分类只是辅助。
