# GitHub Adapter

GitHub adapter 负责读取 Stars、Repos、Forks 和 Gists，并将仓库元信息、README 语义和用户选择映射到 Notion 数据库条目。

## Authorization

读取 GitHub 有两条授权路径：OAuth Device Flow 为主，手动 Personal Access Token 兜底。

### 推荐：OAuth Device Flow（免手动创建 Token）

1. 在 `github.com/settings/developers` 创建一个 OAuth App（**无需填写 Callback URL**：Device Flow 不发送 `redirect_uri`、不走回调页——与 Notion OAuth 需要登记共享回调不同，也不会出现双回调窗口），复制 **Client ID**——它是公开信息，不含密钥。
2. 面板「🐙 GitHub 导入」→「GitHub OAuth Client ID」填入该 Client ID。
3. 点击「🔗 通过 GitHub 授权」，浏览器打开 `https://github.com/login/device` 并显示一次性用户代码，在页面中确认授权。
4. 授权成功后 Token 自动回填到「GitHub Token」输入框，无需再手动生成 PAT。

请求 scope 为 `repo gist`，设备码有效期 15 分钟，超时后重新发起即可。整个流程不使用 Client Secret——纯前端分发脚本内嵌 secret 等同于公开泄漏，Device Flow 只依赖公开的 client_id。

| 错误 | 含义与处置 |
| --- | --- |
| 缺少 Client ID | 未填 Client ID，按上面第 1-2 步补齐 |
| Client ID 无效 | 核对 OAuth App 的 Client ID |
| 设备码无效或已过期 | 重新发起授权 |
| 授权等待超时 | 15 分钟内未在 GitHub 页面确认 |
| 该 OAuth App 未启用 Device Flow | 老式 OAuth App 需在设置中勾选 Enable Device Flow |
| 你在 GitHub 页面拒绝了授权 | 重新发起并在页面确认 |

### 兜底：Personal Access Token

在「GitHub Token」输入框手动粘贴 PAT（`ghp_…`），适合不便创建 OAuth App 的场景；认证后速率限制同为 5000 次/小时。

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
