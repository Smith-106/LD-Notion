# 更新日志

## [Unreleased]

## [3.14.15] - 2026-09-08

### fix (Notion OAuth 安全收窄, 三模型共识 A+B+C)

- 回调页移除冗余 postMessage(payload,'*') 通道(脚本走 document-start 快照捕获, 无 message 监听方, 减少授权码暴露面)
- validateOAuthRedirectUri 宽松白名单: 共享回调 / *.notion.so / localhost 直通, 自定义 https 回调放行并按 CUSTOM 提醒(不误伤)
- 扩展 contentScriptMatches 收窄为 https://smith-106.github.io/LD-Notion/*(与 userscript @match 路径级对齐)


## [3.14.14] - 2026-09-08

### fix (Notion OAuth Redirect URI → 共享 GitHub Pages 回调)

**根因**：Notion「New connection」表单拒绝登记 `https://www.notion.so/`（“Enter a valid redirect URI”）。旧默认依赖在 Notion 页面拦截 `?code=`，已不可用。

**修复**：
- 默认 `CONFIG.DEFAULTS.notionOauthRedirectUri` → `https://smith-106.github.io/LD-Notion/oauth-callback`（VitePress `base: /LD-Notion/` + `cleanUrls: true`，无尾斜杠；`matchesRedirectUri` 仍容忍尾斜杠）
- 新增文档站着陆页 `docs/oauth-callback.md`（中文成功/失败 UI、延迟清理 query、可选 `postMessage`）
- userscript `@match` 与扩展 content script 覆盖 `smith-106.github.io`，以便回调页运行
- 面板提示 / README / TUTORIAL / docs 同步：全体用户共用 Pages 回调，无需自建网站；个人 Client ID/Secret 模型不变
- 版本 bump 3.14.14

## [3.14.13] - 2026-09-07

### fix (更新路径 token invalid · 401 风暴消除 · 三模型 9 视角复核共识)

**根因**：更新/自动导入路径（Bookmark/RSS）`buildSettings` 在 run 开头构建 `settings.apiKey` 快照并整轮复用——OAuth 续签后后续项仍直发失效 token，逐项 401 + 续签风暴；`processInBatches` 用 allSettled 吞掉 rejected；`setupDatabaseProperties`（GET /databases，token 失效最常见首触点）错误包装丢弃认证标记。

**修复**：
- **逐项重读 token**：`processBookmark`/`_syncSingleRssItem` 每项开工前经 `NotionOAuth.getAccessToken("")` 重读（对齐导出路径 v3.14.7 模式）；归档阶段 `processDeleted` 同款
- **isAuthTerminal fail-fast**：终态错误抛原错误（透传 authCode）→ allSettled rejected 检查中止整批 → 外层 catch 按 authCode 分支场景文案；仅信 `error.isAuthTerminal === true` 标记，不误杀瞬态（冷却期/非 JSON 网关/5xx 均无标记）
- **账本先行落盘（H1）**：fail-fast 前 `flushExported`——中止轮已建页的导出事实（不可再生账本）仅存内存，页面重载后丢失 → 手动导出去重失效 → 重复建页
- **setup 首触点透传（M3）**：`setupDatabaseProperties` catch 返回 `isAuthTerminal`/`authCode`，两 importer 包装错误同款透传
- **clearConnection 无条件清残留（P1-4）**：manual 模式下 OAuth 残留 access_token 也清（断开授权后定时更新不再直发残留 token 401）；清除按钮/toast 文案明示「清除全部本地凭据(含手动 API Key)」
- **版本 bump 3.14.13**（UpdateChecker 依赖 `CONFIG.SCRIPT_VERSION` 比对）
- 回归：`tests/update-token-failfast.test.js` +8（fail-fast 请求数/负向 400 不中止/flush 落盘断言/watermark 重试保留/setup 透传/clearConnection 双模式）

## [3.14.12] - 2026-09-07

### fix (token invalid 误判 · 粘贴污染 · 空 token 预检)

**修复**：
- 空 token 预检：`NotionAPI.request` 发请求前检查，空则抛 `EMPTY_TOKEN`（非终态）不发注定失败的请求
- 401 细分：仅官方认证 code（`unauthorized`/`invalid_bearer_token`）判终态，代理/网关 401 非终态；终态错误透传 authCode（`export/index.js`、`github-obsidian-service.js`）
- key 清洗：`getAccessToken`/`setManualApiKey` 剥不可见字符+换行制表符；`validateManualApiKey` 格式软校验（`secret_`/`ntn_` 前缀，不匹配仅警告不阻断）
- UI 中止横幅按 authCode 分支文案，去误导性「无法自动续签」；docs/faq + guide/notion 补 token 前缀说明
- 回归：`tests/auth-failfast.test.js` +3（空 token 预检/代理 401 非终态/官方 401 终态+authCode）、`tests/notion-oauth.test.js` +1

## [3.14.11] - 2026-09-07

### fix (对账 DedupStore batch 槽残留 → 自动去重/「待导出」复发)

**根因**：`reconcileExportedFromWorkspace` 在 strict 模式总会 `beginBatch("linuxdo")`，但仅在 `linuxdoDirty`（有新回填）时 `endBatch`。刷新工作区零命中（账本已对齐的常见路径）留下打开的 batch 槽；此后手动/自动导出的 `markTopicExported` → `DedupStore.markSeen` 只写内存，页面重载后导出事实丢失 → UI 再显示「待导出」、自动去重跳过失效。

**修复**：
- 只要开过 linuxdo batch，finally 无条件 `endBatch`，并清空 `Storage._exportedTopicsCache`
- `LinuxDoAdapter.getDedupKey` 改为裸 `topicId`，与 `Storage.isTopicExported` / 导出账本键空间对齐（消除 SyncCoordinator 过滤层双轨）；`normalize` 同时接受 `raw.id`
- 回归：`tests/reconcile-export.test.js` R-REC-03

### fix (dedup skip keys / dual ledger / batch clear)

Confirmed NEW bugs beyond PR #17 (reconcile beginBatch leak):

1. **GitHubAutoImporter** missed `isExported` / `isGistExported` filter (manual `GitHubExporter` had it). After UI「重置增量基线」, auto-sync re-created Notion pages for already-exported repos/gists.
2. **RSS `allow_duplicates`** (按 Feed + ID 保留重复) ignored by SyncCoordinator: `getDedupKey` was always `rss:{id}`, so same GUID across feeds was mis-deduped. Added `buildDedupStoreKey` + adapter alignment. Also mark DedupStore on **unchanged** (dateless items otherwise re-entered `newItems` every run).
3. **BookmarkExporter.clearExportedRecords** only cleared `BOOKMARK_EXPORTED`; left `DedupStore("bookmark")` orphans → clear UI lied about「可再导出」for SyncCoordinator path.
4. **DedupStore.clearSeen** inside an open batch was undone by `endBatch` rebase (merge with on-disk fresh revived wiped keys). `wiped` flag skips revive.

### fix (userscript dedup batch unmark 复活 + Discourse slug 对账)

**Confirmed beyond #17/#18** (不重复 reconcile zero-hit endBatch / clearSeen wiped / GitHubAutoImporter isExported / RSS allow_duplicates):

1. **DedupStore batch `unmarkSeen` 被 endBatch rebase 复活** —— 旧逻辑把 `cache.set` 全量并入 fresh；batch 内删除的键仍在盘上 → 「重新导出」后刷新仍显示已导出。修复：`dirtyKeys` 仅写本批 mark + `deleted` 墓碑在 flush 时从 fresh 删除（兼容 #18 `wiped`）。
2. **工作区对账 Discourse slug 链接不命中** —— Notion「链接」常为 `/t/slug/id`，本地索引 `/t/{id}`；`normalizeWorkspaceInsightUrl` 对 `linux.do` 归一到裸 topic id。
3. **GitHubAutoImporter 导出 flush 无 finally** —— 与 `GitHubExporter` CC-10 对齐，异常路径也落盘已导出账本。
4. **fix-p1 rebase 用例 GM 键假绿** —— `ldb_dedup_*` 从未被生产使用；改为 `DedupStore.keyFor`。

### fix (userscript · OAuth 续签快照遮蔽 + 知乎/通用 clipper 去重)

- **OAuth `resolveRequestToken`**：`NotionAPI.request` / 文件分片上传在可自动续签时始终读 Storage 最新 access token，禁止调用方 `settings.apiKey` 快照遮蔽续签结果（AutoImporter / GitHubAutoImporter 批量中项 401→二次续签→`invalid_grant` 整批中止）。手动 Token 模式仍尊重传入覆盖。LinuxDo/GitHub AutoImporter `buildSettings` 对齐 `getAccessToken`，每项开工前重读 token。
- **知乎/通用 clipper mark-after-success**：`GenericExporter.markClipperExported` 与 Adapter `getDedupKey` 同构写入 DedupStore；`GenericUI.doExport` / Obsidian 导出成功后落账；已导出再次导出经 ConfirmationDialog 确认，避免连点重复建页。
- 回归：`tests/oauth-request-token.test.js`、`tests/clipper-dedup-mark.test.js`

### fix (userscript hunt round 5 — beyond #17–#20)

- **ConfirmationDialog `countdown:0`**: OK stayed disabled ~1s because enable only ran inside `setInterval` (first tick after 1000ms). Zero countdown now finishes immediately.
- **Clipper URL alternate keys**: ZhihuAdapter / GenericAdapter `getDedupKey` + `normalize`, and `GenericExporter.enrichMeta` URL, now use `Utils.normalizeDedupUrl` (strip hash + tracking query) so the same Zhihu answer / page shares one DedupStore key.
- **UpdateChecker fallback**: replace ancient stub `3.4.5` with `CONFIG.SCRIPT_VERSION` (aligned to package / userscript @version) when `GM_info.script.version` is absent.

## [3.14.10] - 2026-09-07

### fix (userscript 一键授权 OAuth 回调竞态)

**根因（userscript 专属）**：`@run-at document-idle` + ~1.5MB 包体解析，晚于 Notion SPA 的 `history.replaceState` 清掉 `?code&state`，`handleRedirectCallback` 读不到授权码 → 一键授权看似无法完成。发起页亦未监听授权完成态 GM 键，回调成功后仍停在「等待回调」。

**修复**：
- userscript 改 `@run-at document-start`；`main.js` 启动即 `NotionOAuth.captureCallbackSnapshot()`
- `handleRedirectCallback` 优先消费快照（即使 live URL 已被 SPA 清参）
- `installCrossPageWatchers` 增补 API Key / auth mode / refresh / meta / pending / notice，发起页即时刷新
- `matchesRedirectUri` 与诊断函数对齐：非根路径尾斜杠不敏感
- 回归：legacy T29/T30 + vitest `oauth-callback-snapshot.test.js`


## [3.14.9] - 2026-09-07

### fix (gist + dangling-refs CI + ConfirmationDialog)

- treat `gist.github.com` as GitHub in SiteDetector; add userscript `@match` + extension content-script match
- harden `tests/scan-dangling-refs.js` (export/DI/lazy `require().X`); wire into `verify:baseline` (exit 1 on new dangling refs)
- fix ConfirmationDialog import miss in `src/ai/agent-executor.js`


## [3.14.8] - 2026-09-07

### fix delivery leftover

- verify STRICT + win32 + negative restore
- ConfirmationDialog queue/close; generic save warning; GitHub Notion pause/cancel
- docs: userscript no longer matches arbitrary pages; list @match; extension still generic


## [3.14.7] - 2026-09-06

### 修复（31 条 UI 审计发现全量修复 + 导出几分钟后 token invalid 全部失败根因修复）

**根因（三模型共识确认）**：导出进行几分钟后全部报「Notion API 错误: API token is invalid.」由四因素叠加——`isAuthTerminalError` 消息子串匹配把瞬态续签失败误判为终态致 fail-fast 中止整批；导出循环固定 `settings.apiKey` 快照遮蔽 OAuth 续签后的新 token（每项 401 + 续签风暴）；终态降级只清 refresh_token 残留过期 access token（下次导出首项即报错）；站设置空输入保存误清 token 并翻 manual 模式。

**修复**：
- **token invalid 根因（P0）**：`isAuthTerminalError` 只信 `error.isAuthTerminal === true` 标记（export/index.js + BookmarkExporter + github-obsidian-service 三处）；导出循环每项开工前 `getAccessToken("")` 重解析最新 token（settings.liveApiKey 透传）；终态降级清残留 NOTION_API_KEY；站设置仅显式编辑时清 token；`setManualApiKey` 空值不翻 manual（保 OAuth 续签）；`_persistProvidedSensitiveEntries` 改 REDACT_IN_LOGS 明文落盘；新增 2 回归测试（突变验证旧实现 2 failed→修复全绿）
- **High（P1）**：导出按钮 disabled 提前到首个 await 前 + 校验失败恢复 + GitHub 导出 SyncLock 重入守卫；Obsidian writeNote/writeImage 登记 OPERATION_LEVELS level=1，4 裸调点统一经 OperationGuard；工作区洞察 prompt JSON 序列化改 `isolateContent` 隔离
- **Medium（P2）**：ConfirmationDialog 重入闸门 + 统一 cleanup + ARIA（role/aria-modal/焦点）；DesignSystem.applyTheme 公开 + 三面板创建后重应用；GitHubAutoImporter finally 补 emit；showStatus/showProgress 判空 + 清残留定时器；中心摘要刷新链状态；权限变更后刷新导出目标摘要；GitHub 自动导入未配置回滚；oplog 防抖；loadConfig 恢复手动 DB 输入框可见性
- **Low（P3）**：option 值转义×3；原生 confirm 改 ConfirmationDialog×2；删除 events.js 重复折叠绑定死代码（恢复 source 两区折叠持久化）；硬编码 rgba 换令牌（design-system 新增 danger/success/warning alpha 变体×8）；PanelResize.resetSize 注册表分发；savedTab 白名单防选择器注入；renderInstallLink 转义 + rel=noopener；时间线 label 转义；加载后经 readiness 判定导出按钮；聊天容器 aria-live；mini 按钮 aria-label；.ldb-highlight 样式补定义；Obsidian 指引文案与实机 UI 对齐；renderVisualSummary 微任务合并防抖动；AI_TEMPLATES 容量上限 50
- **验证**：vitest 38 文件 755 用例 + legacy 三件套全绿；verify:baseline/build/delivery EXIT=0（295 PASS）

**升级说明**：涉及认证续签与凭证落盘语义变化，安装后请重新授权 Notion（OAuth 一键授权或填入 API Key）。

[3.14.7]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.14.7

## [3.14.6] - 2026-09-06

### 修复（三模型共识审计 51 条发现全量修复 · 安全/并发/存储/同步）

**根因**：上一审计 Session（maestro-20260906-trimodel-consensus-audit-20260905-201412）发现 51 条问题（2C/8H/17M/24L），涵盖 OAuth 跨页状态失效、批量导出认证失败不中止、凭证落盘未脱敏、AI 输入隔离不完整、Gemini 多轮 role 契约违例、通配 DNS SSRF、存储回写竞态、导出账本 TTL 静默遗忘、同步 payload 超限整包拒绝等。

**修复**：
- **安全（S/XN 类 16 条）**：OAuth 跨 tab 续签租约（修「更新后 Key 失效」根因）；CredentialVault 保险箱退役后凭证 GM 明文 + 审计全链路脱敏，AgentTrace 落盘前 finalResponse/userInput/preview/errors 脱敏（接线测试补防回归）；AI 输入隔离逐字符 `<`/`>` 转义防 `</user_input>` 标签逃逸；Gemini contents[].role 仅 user/model（assistant→model 映射防 400）；通配 DNS 后缀 5 类静态拒绝 + 非规范 IP 字面量（整数/0x/0b/八进制/前导零）纵深防御，前导零判定收窄至末段纯数字形态防合法域名误拒
- **并发（CC 类 7 条）**：批量导出/自动导入遇认证终态 fail-fast（6 处循环，剩余项 skipped 可续传，账本先落盘）；DedupStore beginBatch 幂等 + endBatch 单次 flush rebase（消除 O(N²) 与双 tab 竞争）；SyncState 定时器句柄/挂起布尔拆分
- **存储（DC 类 8 条）**：导出事实账本容量上限淘汰（10000 条最旧淘汰，禁时间 TTL——v3.14.3 根因修正）；去重 URL 键源 90 天 TTL；markSeen 时间合并；sha256 代理项 UTF-8 编码对齐 TextEncoder（高位孤立项 U+FFFD）；sync 模块编译期剪枝（`false ? require("./sync") : null` 源字面量路线）
- **同步（DC 类 6 条）**：单源行 payload ≤2000 字符硬限（超限按 ts 降序截断）；id 键源只投递 ts ≥ now-90d 新鲜条目；RSS 聚合状态按当前键集剪枝；SyncEngine 权限不足审计语义统一（denied/cancelled 区分）
- **修复验证**：fix-p0/p1/p2 契约测试 55 用例（含 Run#7 review 闭环新增 4 条：persist 脱敏接线、Gemini role 映射、XN-02 前导零回归）；全量 vitest 38 文件 754 用例 + legacy 三件套全绿；verify:delivery 13 维度全链 EXIT=0

**升级说明**：涉及持久化存储键与 OAuth 状态语义变化，安装后请重新授权 Notion（OAuth 一键授权或填入 API Key），并点击「刷新工作区」对齐本地账本；此前被 90 天窗口遗忘的导出记录不再发生（容量上限淘汰）。

[3.14.6]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.14.6

## [3.14.5] - 2026-09-06

### 修复（批量导出遇失效 Token 逐项全量失败 · 认证终态 fail-fast）

**根因**：批量导出循环对每一项独立 try/catch,Notion 401（API token is invalid 且无法自动续签）作为普通错误逐项记录——系统性认证失败时批次不中止,464 个收藏逐个发出注定失败的请求,全部报「Notion API 错误: API token is invalid.」,既污染失败报告又浪费时间与请求配额,且报告无法区分「需要重新授权」与「个别项目失败」。

**修复**：
- **认证终态标记**：`NotionAPI.request` 对 401 终态（token 无效且不可续签、OAuth 续签失败如 invalid_grant/invalid_client、官方 unauthorized code）抛出带 `isAuthTerminal` 标记的错误；400 校验错误与 429 限流重试语义不变
- **批量循环 fail-fast**：LinuxDo 批量导出（`Exporter.exportBookmarks`）、自动导入（`AutoImporter`）、浏览器书签导出（`BookmarkExporter.exportBookmarks`）、GitHub→Notion 导出、LinuxDo→Obsidian 导出、GitHub→Obsidian 导出共 6 处循环遇认证终态立即中止批次：已失败项保留在 failed,剩余项进 skipped（可续传）,已成功项的导出账本先落盘不丢失
- **报告与状态引导**：导出报告顶部显示「⛔ 已中止导出：Notion 认证失败」横幅与修复指引（检查 API Key / 重新 OAuth 授权后再次导出即可续传剩余项）;Obsidian 导出中止提示检查 API 地址与 Key;自动导入状态与同步状态记录 lastOutcome=aborted
- **测试**：新增 `tests/auth-failfast.test.js` 6 用例（401 终态标记/OAuth 续签失败标记/400 不误伤/429 重试不变/批量中止时 notion 请求次数=1 而非 N/锁释放）

**升级说明**：遇到此报告后请在主面板检查 Notion API Key（或重新一键授权）,再点击导出——已成功项不会重复导出,仅续传剩余项。

[3.14.5]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.14.5

## [3.14.4] - 2026-09-05

### 修复（v3.14.3 三模型共识审查发现：对账 LinuxDo 死代码 + 同步投影过期拒绝 + 写回 O(N²)）

**根因**：v3.14.3 的对账回填对 LinuxDo 项实际无效——Discourse 原始 bookmark 对象无 `url` 字段（仅含带 slug 的 `bookmarkable_url`），旧实现读 `bookmark.url` 恒为空 → LinuxDo 对账永不命中，主报修场景（471 项待导出）未真正修复；另有两项审查发现：多端同步采用约 90 天后必然整包拒绝（本地账本永久保留后，validateRemote 的 90 天 ts 校验对任一过期条目即拒整包）；对账/导出循环内逐条写账本违反写侧 O(N²) 禁令。

**修复**：
- **对账 LinuxDo 死代码**：LinuxDo 项改按 `topic_id` 构造规范 URL（`https://linux.do/t/{topicId}`，与导出写入“链接”属性同法）参与匹配；数据源改 `getCombinedVisualBookmarks()` 覆盖 LinuxDo+GitHub 两源（旧版只查当前激活源）；回填后刷新列表徽标
- **同步投影过期裁剪**（多端同步）：本地导出账本永久保留不变，同步投影只投递新鲜条目（ts ≥ now-90d），消除 validateRemote 整包拒绝回归；单源行 payload 超 2000 字符（Notion rich_text 上限）时按时间降序保留最新条目并记审计事件
- **写回 O(N²) 消除**：对账回填与 GitHub→Obsidian 导出循环内仅 mutate 内存缓存，循环末单次 flush（LinuxDo 经 DedupStore beginBatch/endBatch，GitHub 经 flushExported/flushGistsExported）
- **GitHub「重新导出」入口**：已导出的 GitHub 仓库/Gist 项现可一键移除导出记录重新入列（修复对账误标后无恢复路径，此前只能清空全部账本）
- **治理文本同步**：AGENTS.md 与 coding-conventions 规范条目更新为「导出账本容量上限 / 去重账本时间 TTL」分类正模式（原 90 天 TTL 正模式正是本次根因的规范源头）

**升级说明**：安装后重新点击「刷新工作区」即可对账（需先在对应页签加载过收藏列表；LinuxDo 项需 Notion 页面存在“链接”属性且在扫描页数范围内）。

## [3.14.3] - 2026-09-05

### Fix (API Key invalid after update / vault retired / commit 049bf46)

No v3.14.2 GitHub tag existed; this is the first tagged release containing the vault retirement (SENSITIVE_KEYS cleared, GM plaintext). See historical 3.14.2 excerpt below.


### 修复（导出账本 90 天 TTL 误删 · “已导出内容反复显示待导出”根因）

**根因**：导出账本（LinuxDo 帖文 / GitHub 仓库与 Gist / 浏览器书签）在每次写回时按 90 天时间 TTL 全局淘汰，超过 90 天的已导出记录被静默遗忘；判定“是否已导出”只查本地账本、从不与 Notion 工作区页面核对 → 已导出的内容被 UI 重新判为“待导出”，列表反复显示（用户报告：Notion 已存在 837 页，本地仍显示 471 项待导出）。此外 Obsidian 导出路径（LinuxDo 帖文 / GitHub 仓库）成功写入后从不记录账本，导出的内容下次仍显示“待导出”。

**修复**：
- 导出账本淘汰策略由「90 天时间 TTL」改为「容量上限淘汰」：仅当单账本超过 10000 条时淘汰最旧条目，导出事实不再因时间流逝丢失；URL 键源去重账本（bookmark/rss/zhihu/generic）保留时间 TTL 防无界增长（DedupStore / GitHubAPI / BookmarkExporter 三处同构）
- Obsidian 导出成功即写入已导出账本（LinuxDo 帖文 `markTopicExported`；GitHub 仓库/Gist `markExportedAndFlush`/`markGistExportedAndFlush`），与 Notion 导出路径对称
- 工作区扫描后自动对账回填：Notion 页面“链接”属性与本地已加载项 URL 归一化精确匹配，命中即回写已导出账本（仅 strict 去重模式回填 LinuxDo，allow_duplicates 语义不被对账破坏）；扫描完成状态栏提示识别数量

**升级说明**：安装后重新点击「刷新工作区」即可把 Notion 中已存在的内容与本地账本对齐（需本地收藏列表已加载；LinuxDo 链接属性匹配依赖 v3.14.4 对账修复）。此前被 90 天窗口遗忘的导出记录，符合条件者（Notion 页面带“链接”属性且在扫描范围内）经对账恢复识别。

[3.14.4]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.14.4
[3.14.3]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.14.3
[3.14.1]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.14.1

## [3.14.2] - 2026-09-05 (untagged orphan; see 3.14.3 for vault fix 049bf46)

### 修复（每次更新后 API Key 失效 · 保险箱会话锁定根因）

**根因**：凭证保险箱解锁态（`_unlocked`/`_sessionCache`）为模块内存态，每次页面加载即重置为锁定；Tampermonkey 更新脚本强制重载页面 → 保险箱重新锁定 → AI/GitHub/Obsidian 敏感键在锁定态下读取返回空 → 功能报“未配置 API Key”，看似凭证失效。数据并未丢失（密文仍在 GM 存储），但必须手动重新解锁才能恢复。

**修复（同 v3.12.0 OAuth 三键先例，R1 同根）**：
- 清空 `SENSITIVE_KEYS`（AI_API_KEY / AI_BASE_URL / GITHUB_TOKEN / OBS_API_KEY / OBS_API_URL 全部移出保险箱），改走 GM 明文存储
- 页面加载（含脚本更新重载）后敏感键立即可读，不再要求解锁保险箱
- 审计日志仍由 `REDACT_IN_LOGS`（8 键超集）统一脱敏，不含真实凭证
- 移除 3 处面板“解锁/锁定保险箱” UI 区块与 `attachControls` 绑定，提示文案改为“凭证保存在浏览器本地（GM 存储），脚本更新后无需重新输入”
- `NotionOAuth.getStatus` 不再出现“解锁保险箱后可使用已保存配置”分支

**升级说明**：此前已存入加密保险箱的 AI/GitHub/Obsidian 凭证无法自动解密回读（密文需口令），升级后请在各面板重新输入一次即可；此后更新脚本不再失效。

## [3.14.1] - 2026-09-05

### 修复（安全审计 8 项 · 一键授权 · 跨设备多端同步）

本版包含 3 个提交：跨设备多端同步（e2fa34c）、一键授权「客户端 ID 缺失或不完整」根因修复（54800ae）、全盘安全审计收尾（a0115a4）。

**跨设备多端同步（feat e2fa34c）**
- 新增多端同步 9 模块：跨设备状态合并、四类去重修复（GitHub 仓库 / 书签 / 帖文 / AI 会话）、同步水位统一管理
- 多端同步为可选能力,默认关闭（feature flag 控制）,不影响现有单机工作流

**一键授权（fix 54800ae）**
- 修复一键授权「客户端 ID 缺失或不完整」根因：`normalizeCandidates` 双形状兼容（数组 / 单对象），消除授权流程初始化竞态

**安全审计（fix a0115a4 · 8 项）**
- 循环依赖消除：提取共享依赖（`src/utils/sha256.js` 新增），security 层不再反向依赖 ui 层顶层导出
- 安全随机值统一 `crypto.getRandomValues`（boundary/token/eventId/文件名），消除 `Math.random()` 隐患
- SHA-256 单向哈希指纹（`apiKeyHash` 等缓存指纹），替代明文 key 子串
- fetch 超时 + 退避重试规范化（AbortController + clearTimeout 防泄漏）
- 存储键 TTL/容量上限补充（去重集合 90 天自动淘汰）
- JSON 映射缓存消除 O(N²)（顶层缓存引用 + 单次序列化）
- OperationGuard 权限缺口修复、审计日志脱敏强化

## [3.14.0] - 2026-09-04

### 修复（UI 可控制能力审计 30 项 · 三模型共识 F-UI-01~45 + 同步链状态修复）

本轮对 UI 全部可控制能力做三模型共识审计（deepseek-v4-flash / GLM-5.3-flash / hy3,共 45 项发现 F-UI-01~45），闭环 30 项，含 4 项 P0 功能瘫痪级缺陷；修复后经 browse 实机验证 12 项 PASS。其余 15 项（ARIA/键盘可达/Undo 多槽等 UX 债）列入后续版本。

**P0（4 项,功能瘫痪级）**
- **F-UI-01** ConfirmationDialog 不支持 onConfirm/confirmText →「重新导出」「删除模板」确认后静默失效 → 补齐回调与按钮文案支持
- **F-UI-02** 定时轮询只推进增量水位不写 Notion,Linux.do/GitHub 新增项被永久跳过 → SyncScheduler 按源调 AutoImporter.run()
- **F-UI-03** 自动同步间隔配置失效（UI 写 `*_AUTO_IMPORT_INTERVAL`,调度器读 `SYNC_INTERVAL_*`）→ start 显式传间隔
- **F-UI-22** 视图页「保存到 Notion」按钮无 loading/重入保护,重复点击创建重复页面 → 禁用态 + 保存中提示

**P1（18 项）**
- F-UI-04 AgentTrace 调用链 UI 入口 / F-UI-05 各来源独立「立即导入」按钮 / F-UI-06 孤儿 ChatUI 折叠绑定清理
- F-UI-07 权限指示 + 审计开关入口 / F-UI-08 Obsidian 配置 + 测试连接入口 / F-UI-09 关闭确认对话框
- F-UI-10 假启用回写修正 / F-UI-11 主题三态 auto 入口 / F-UI-12 6 折叠区 + 日志面板展开持久化
- F-UI-13 refresh 走 UICommandService 边界 / F-UI-14 已选计数剔除已导出项 / F-UI-15 空状态 CTA 按来源区分
- F-UI-16 测试连接文案统一 / F-UI-17 诊断信息增强 / F-UI-18 面板尺寸/浮钮位置重置入口
- F-UI-19 cacheRefs 孤儿引用清理 / F-UI-20 deleteBlock 死能力登记 / F-UI-21 BOOKMARK_IMPORT_FOLDERS 死存储键删除

**P2（8 项）**
- F-UI-23 主导出按钮禁用提前 / F-UI-31 同步链状态持久化回显 / F-UI-32 收藏 Tab 空状态引导
- F-UI-33 AI 忙时提示 / F-UI-35 导出目标/授权/权限可见指示 / F-UI-36 书签跳转入口
- F-UI-38 notion-site 配置统一保存 / F-UI-45 反馈双写

**安全与鉴权（随本批提交）**
- 一键授权 `normalizeCandidates` 双形状兼容、OperationGuard 权限缺口修复、新增 `target-discovery`/`coordination` 模块

**收尾修复（随本版发布）**
- SyncState facade 补 `getSourceState`/`updateSourceState`/`forceFlush` 委托,修复同步链状态回显 `renderSyncChainStatus` TypeError（F-UI-31 依赖）及同类委托完整性缺口;新增 facade 契约测试（tests/sync-state-facade.test.js）
- 关闭面板确认文案改为「关闭后可通过刷新页面重新打开」（原文案承诺的悬浮按钮在 destroy 后不存在）

### 验证

- `npm test`:29 个测试文件 593 用例 + legacy 三件套 252 用例全部通过
- `npm run verify:delivery`:13 维全链检查 EXIT=0
- browse 实机验证:12 项 PASS（含 P0 四项、同步链状态回显、反馈双写等）

[3.14.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.14.0

## [3.13.0] - 2026-09-04

### 修复（F-01~F-05 五连修复 · 稳定性与数据管理闭环）

本轮集中修复 5 类用户可见问题：空状态导入按钮失效、筛选设置丢失、AI 批分类崩溃、增量同步基线不可重置、本地去重/导出记录无法管理。三模型共识审计（deepseek-v4 / GLM-5.2 / hy3）发现并交叉验证，修复后经 browse 实机验证全部通过。

**F-01 空状态导入按钮死控件**
- 空书签列表「导入浏览器书签」按钮调用 `ChatUI.sendMessage("import-bookmarks-from-browser")`，但 `sendMessage` 忽略入参 → 点击无任何反应。→ 改为先向聊天输入框注入指令文本再发送，并新增「正在导入」状态提示；AI 面板未就绪时给出明确错误提示

**F-02 筛选/参数控件即时持久化**
- 12 个筛选与参数控件（仅主楼/仅楼主、楼层范围起止、图片模式、请求间隔、导出并发、图片筛选、用户/包含/排除关键词、最小长度）此前仅在点击导出时才写入存储，调整后未导出即丢失。→ 全部控件新增 `change` 事件即时持久化，改动即生效

**F-03 AIClassifier 跨闭包裸引用崩溃 + 批分类暂停/取消**
- `batch.js`/`content.js`/`write-tools.js` 三处 handler 层裸引用 `AIClassifier`（esbuild 闭包外自由变量恒为 `ReferenceError`）→ 批量分类/内容提取必然崩溃。→ 新增 `deps.getClassifier()` lazy 获取统一修复
- 批分类循环新增 `isPaused`/`isCancelled` 标志位支持；主面板与 Notion 站点面板新增常驻「⏸️ 暂停分类 / ✕ 取消分类」按钮，取消时保留已完成部分并给出汇总

**F-04 SyncState 基线重置**
- 增量同步基线（watermark）此前无任何 UI 入口可重置，误同步/数据回退后无法恢复全量扫描。→ 新增 `SyncState.resetSourceState(sourceType)`（清空 watermark/lastOutcome，下次同步退化为全量）；工作区洞察每个来源卡片新增「重置基线」按钮，GitHub 按子类型逐个重置

**F-05 数据管理区**
- 去重/已导出记录此前只能靠控制台 `GM_setValue` 清理。→ 设置面板新增「数据管理」区：实时统计 Linux.do 去重、GitHub 已导出（仓库+Gist）、书签已导出记录数，三个按钮经确认后一键清除（清存储键 + 失效内存缓存），清除后对应来源可再次导出

### 验证

- `npm test`：26 个测试文件、557 个用例全部通过（vitest + legacy 三件套）
- `node build.js`：单文件产物构建成功，产物版本标记 v3.13.0
- browse 实机验证：F-01~F-05 六项 PASS（空态导入、筛选持久化、分类控制按钮、重置基线、数据管理区、Notion 配置链路）

## [3.12.0] - 2026-08-25

### 修复（Notion OAuth 自动授权失效 · 三模型共识根因闭环）

Notion OAuth 一键授权此前在回调页与自动续签场景必然失败：OAuth 三键（Client Secret / Refresh Token / Access Token）被锁入「每次页面加载即重新锁定」的凭证保险箱，而 OAuth 授权回调与续签天然发生在全新页面，锁定态下读空 → 用 code 换 token 必败。三模型共识诊断（R1/R2'/R3）后调整凭证存储模型。

**根因与修复**:
- **R1 跨页回调必败**：保险箱会话态（`_unlocked` / `_sessionCache`）为模块内存态，每次页面加载即重置为锁定；回调页读 `Client Secret` / `refresh_token` 恒为空 → `exchangeToken` 抛「缺少 Client Secret」。→ OAuth 三键移出 `CredentialVault.SENSITIVE_KEYS`（8 → 5 键），改走 GM 明文存储，跨页可读
- **R2' 迁移陷阱**：旧 `migrateLegacy` 会把明文 OAuth 键吞入保险箱并删除明文副本，连兜底也被清掉。→ 脱敏后明文保留，不再二次迁移
- **R3 新用户写门槛**：未初始化保险箱时 `CredentialVault.set()` 抛错，新用户连 Client Secret 都无法保存。→ 脱离后走 `Storage.set`，未初始化保险箱也能完成配置

**安全与审计**:
- 新增 `REDACT_IN_LOGS` 超集（原敏感键 + OAuth 三键，共 8 键）；`OperationLog.redactSensitiveFields` 从 `SENSITIVE_KEYS` 切换为 `REDACT_IN_LOGS`——OAuth 密钥虽改明文存储，审计日志仍一律 `***REDACTED***` 脱敏

**健壮性**:
- `handleRedirectCallback` 新增 pendingState 10 分钟 TTL：陈旧 code/state 残留不再重放干扰后续授权，超时自动清理 URL 参数

**升级说明**：此前已迁入保险箱的 OAuth 凭据无法自动回读（vault 不再含 OAuth 键），升级后如遇 OAuth 字段为空，重新输入一次 Client Secret 并重新授权即可。

### 验证

- `npm test`：557/557 用例全绿（vitest + legacy 三件套），新增回归覆盖：保险箱锁定态下回调交换成功（R1）、未初始化保险箱可保存 Client Secret（R3）、legacy 迁移保留 OAuth 明文（R2'）、pending TTL 过期清理、`REDACT_IN_LOGS` 超集断言
- `node build.js`：单文件产物同步（含 `REDACT_IN_LOGS` 与 TTL 逻辑）

## [3.11.0] - 2026-08-24

### 新增（Odyssey UI 六维审计修复 · 三模型复审闭环）

本轮完成桌面/平板/移动、键盘、触屏、动效六维审计，闭环 18 项问题（含三模型共识复审 F1–F8）。

**运行时缺陷修复（High）**:
- LinuxDo 页面移除 GenericUI 重复初始化，「双浮动图标」消失
- 「重新导出」按钮内联 onclick 三重失效 → 改事件委托，并恢复破坏性覆盖前的确认弹窗
- 最小化恢复误用 `display:block` 破坏面板 flex 布局 → 修正为 `flex`
- 空书签 CTA 引用未导入的 `ChatUI` 致 ReferenceError → 补齐导入
- gclip 面板新增 max-height 视口钳制，内容不再溢出屏幕

**交互与触屏**:
- 拖拽全面迁移 pointer events + setPointerCapture + touch-action（面板/浮钮/缩放手柄触屏可用），消除 document.onmousemove 相互覆盖
- Esc 关闭统一走 togglePanel；主面板 Esc 最小化带输入法组合/输入控件/确认弹窗三重守卫
- gclip 关闭过渡竞态以取消闭包兑底；reduced-motion 下同步隐藏
- 面板 resize 重写：恢复视口钳制、分轴 ARIA slider；浮钮位置恢复钘制

**响应式与可访问性**:
- 新增 480px 抽屉式面板与 768px 平板断点；媒体查询源顺序级联修正
- 38 处 label↔input 显式关联；aria-expanded 初始态、progressbar 数值属性、tablist 方向标注、typing-dots reduced-motion 适配
- 浮钮统一 52px、主题按钮 30px 对齐头部按钮

**清理与一致性**:
- 删除死代码（dark-alpha 非法位置声明/.minimized）；硬编码色令牌化；重复 class 合并；非法负 var() 修正；零值条形渲染 0 宽

### 验证

- `npm test`：556 vitest + legacy 三件套全部通过
- `npm run build`：单文件产物 1374.6 KB（较 v3.10.0 +0.66%，低于 5% 审查阈值）
- Odyssey Review 三模型独立复审：Security/Performance 维度零发现

[3.13.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.13.0
[3.12.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.12.0
[3.11.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.11.0
[3.10.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.10.0

## [3.10.0] - 2026-08-02

### 新增（全量 UI/UX 改进循环）

本轮通过完整的 UX 改进管线（scan → diagnose → implement → test）扫描 12 个 UI 文件，识别 27 个交互/体验问题并修复 26 个。

**运行时缺陷修复（Critical）**:
- 修复 `notion-site-ui.js` 中 `BookmarkBridge` 未导入导致的 `ReferenceError`（面板初始化崩溃）
- 修复 `design-system.js` 中 4 个 CSS 变量自引用（`--x: var(--x)`）→ 禁用按钮不变灰、warning/danger 按钮背景透明
- 修复 `events.js` 中乱码错误提示（UTF-8/GBK 编码损坏）

**交互与状态**:
- 浮动按钮拖拽新增 4px 距离阈值，消除微抖动吞没点击（「按钮无响应」假象）
- GitHub 类型复选框取消全选后自动回同步「stars」，消除 UI 与实际存储状态失同步
- 浏览器书签导入移除误导性 loading 按钮态，改用状态栏提示

**错误健壮性**:
- 统一同步改为每源独立 try/catch + 聚合报告，单源失败不再中断其余源
- 导出时图片下载失败计入汇总（不再静默吞掉）
- 修正通用面板错误引导文案指向正确位置

**可访问性（7 项）**:
- 状态容器新增 `aria-live="polite"` + `aria-atomic`（Notion/通用/工作区面板）
- 设置折叠区改为 `<button>` + `aria-expanded` + Enter/Space 键盘支持
- Tabs 新增 `role="tablist"` + 方向键/Home/End 导航
- 面板 resize 手柄新增键盘调整（ARIA slider）
- Toggle switch 新增 `:focus-visible` 焦点环
- 触控目标优化至 ≥44px

**错误预防与用户控制**:
- 重新导出、删除模板等破坏性操作新增 `ConfirmationDialog` 确认
- 修复 Escape 键被 `stopPropagation` 阻断；通用面板新增 Esc 关闭

**反馈打磨**:
- 保存设置新增 loading 态 + 成功 toast
- 空书签状态新增「导入浏览器书签」CTA
- 已导出复选框禁用时新增原因 tooltip

### 变更

- `AgentTrace`：trace ID 生成从 `Math.random()` 迁移到 `crypto.getRandomValues`（安全随机值规范）
- `GitHubAutoImporter._exportViaGitHubExporter`：返回值从填充空对象数组改为携带 `itemKey`/`title` 的条目数组（返回值标识字段契约）
- `main.js`：移除 `typeof UI !== "undefined"` 跨闭包反模式检查（esbuild 打包后恒 false）

### 验证

- 556/556 vitest 用例 + legacy 三件套全部通过
- 单文件 Userscript 输出保持不变（零部署）
- 无新增跨模块循环依赖；构建产物经 grep 逐项核验修复生效

---

## [3.9.0] - 2026-08-02

### 新增（UI 设计系统增强）

**Design Token 体系扩展**:
- 新增 accent alpha 变体系列（`--ldb-ui-accent-alpha-08` ~ `--ldb-ui-accent-alpha-45`），替代硬编码 rgba 值
- 新增 dark mode accent alpha 变体（`--ldb-ui-accent-dark-alpha-10` ~ `--ldb-ui-accent-dark-alpha-22`）
- 新增 Motion tokens（`--ldb-ui-ease-out/in`、`--ldb-ui-duration-instant/fast/normal/slow/entrance`）
- 新增 Neutral overlay token（`--ldb-ui-neutral-overlay: 148, 163, 184`），统一 slate-400 半透明用法

### 变更

- `styles.js`: 全部 `rgba(148,163,184,α)` 硬编码迁移到 `color-mix(in srgb, rgb(var(--ldb-ui-neutral-overlay)), transparent N%)`
- `styles.js`: 过渡动画统一使用 motion tokens（duration + easing）替代魔法数字
- `--ldb-ui-white` 微调为品牌色调 `rgb(253, 253, 255)`（视觉 1:1 不变）
- 新增 `:focus-visible` 样式（toggle-section 等交互元素），提升键盘可访问性
- 触控目标尺寸优化（generic-ui / notion-site-ui）

### 验证

- Build: 单文件 Userscript 输出不变
- 设计 token 向后兼容（纯 CSS 变量新增，无破坏性变更）

[3.9.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.9.0

---

## [3.8.0] - 2026-08-01

### 架构重构（F4/F5）

**巨石文件拆分**:
- `src/ai/Handlers.js`: 2277 LOC → 48 LOC shell + 4 域文件 (query/pageCrud/content/batch)
- `src/ai/AgentTools.js`: 1712 LOC → 21 LOC shell + 3 域文件 (read/write/meta)
- `src/api/index.js`: 1801 LOC → 696 LOC + 4 新模块 (constants/DOMToNotion/obsidian/notion-upload)
- `src/ui/main-ui.js`: -292 行（部分提取到 workspace-insight/github-obsidian-export）

**循环依赖消除**:
- 新增 `src/coordination/event-bus.js`（零依赖事件总线）
- `security/index.js`: 删除 `_resolveUI`，OperationLog/UndoManager 改走事件总线
- `import/bridge`: 5 个文件 Pattern A 通知类调用迁移到事件总线
- `adapter/BookmarkAdapter`: 双 require 统一为 lazy accessor

**新增模块**:
- `src/ai/deps.js`: 中央依赖访问器（消除 ai 内部循环）
- `src/ai/utils/`: 4 个纯函数工具集 (payload-builders/format-helpers/block-helpers/result-helpers)
- `src/import/github-obsidian-service.js`: GitHubAutoImporter 服务调用提取

### 测试
- 新增 41 个基线测试（api-modules.test.js + main-ui-baseline.test.js）
- 总计: 556 tests passed

### 验证
- Build: 1351.9 KB
- verify:delivery: Chrome Extension + Userscript 双形态通过

---

## [3.7.8] - 2026-07-24

### 新增（安全加固 — ISS-20260723-009, CWE-94/918）

**AI 输出 schema 校验层** — AI 返回的属性名/值/URL 直接写入 Notion，prompt injection 可经 AI 输出写入恶意 URL 或异常属性，本次统一校验：

- **新增 `src/ai/schema.js`（AISchema 校验层）**：
  - `validatePageExternalUrl`（转发 UrlValidator，SSRF 防御）
  - `validatePropertyName`（白名单 [中英数字+下划线/连字符/空格] + 截断 ≤64 + 拒 Notion 保留名 title/created_time/last_edited_time/created_by/last_edited_by/url/path/Name）
  - `validatePropertyType`（类型白名单，拒 relation/people/files 等系统关联字段）
  - `validatePropertyValue`（title/rich_text ≤2000、select ≤100、number isFinite+|v|<1e15、date ISO8601、checkbox Boolean）
  - `validateEmoji`（≤32 + 拒控制字符）
  - `sanitizeObjectValue`（对象值白名单，拒 relation/people/created_by/created_time/last_edited_time 等系统字段）
  - `validateExtractToDatabaseSchema`（properties/entries 需 Array，非数组返明确 reason，不再 TypeError 被吞）
  - `parseAIJson`（统一入口：正则提取 + JSON.parse + 按 name 路由校验，消除 7 消费点重复 `jsonMatch+JSON.parse+try-catch` 三段式，为 ai/index.js 拆分 ISS-010 预留接缝）

- **`src/security/UrlValidator.js` 新增 `validatePageExternalUrl`**：http(s) 协议（拒 javascript:/data:/file:）+ `_isPrivateHost` 拒 10.x/172.16-31/192.168/169.254/127/localhost。防 Notion 服务端抓取 external.url 触发云元数据 SSRF（169.254.169.254）

- **`src/ai/index.js` 7 消费点接入**：`_buildPageIconPayload`/`_buildPageCoverPayload`（icon/cover URL + emoji 校验，非法跳过字段）；`_normalizeNotionProperties`（属性名 + 对象值白名单 + number isFinite + rich_text 截断）；`_buildPropertyValuePayload`（按 type 校验值）；`handleExtractToDatabase`（parseAIJson 统一入口 + 属性名/类型校验 + failedCount 回显）；`parseIntent`（intent 白名单 + compound steps 上限 20）；`handleEditContent`（content_updates old_str/new_str 结构校验，非法进 fallbackReason）

### 修复（sibling — S_GENERALIZE 发现，cross-phase loop）

**DOMToNotion SSRF sibling（CWE-918）**：`src/api/index.js` 的 `DOMToNotion` 7 处 external.url 消费点（`_cookLightbox`/`_cookAttachment`/`_cookVideo`/`_cookAudio`/`_cookImage`/`_cookParagraph` 内 img+attachment）把 `full = Utils.absoluteUrl(帖子 HTML 的 src/href)` 直写 Notion `external.url`。帖子作者可写 `<img src="http://169.254.169.254/...">`，导入时 Notion 服务端抓取触发 SSRF/云元数据。来源与 AI 输出不同（帖子 HTML vs AI 输出）但同漏洞模式同触发点。加 `_safeExternalUrl` helper（复用 `validatePageExternalUrl`），7 处全部接入，合法外网 CDN 图片/附件不受影响（`_isPrivateHost` 只拒内网）

### 说明

- 本次为纯安全加固（AI 输出 schema 校验 + DOMToNotion SSRF sibling），无新功能、无运行时行为变化（除安全校验的设计行为对齐：AI 输出 URL/属性非法时跳过该字段不中断流程，导入帖子含内网图时该图静默跳过）
- 严格遵守锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- 新增 `tests/ai-schema.test.js` 32 契约用例（SSRF 防御 + 属性名 + 类型 + 值 + emoji + 对象值 + 结构 + parseAIJson）
- ISS-20260723-009 完成；ISS-20260723-010（ai/index.js 7090 行巨石拆分 + LinuxDoAPI 迁回 extract）deferred，parseAIJson 已为其预留接缝
- S_GENERALIZE 首轮 grep `external:{url}` 漏报 `_cookImage`（L412），二轮全量 grep `Utils.absoluteUrl` 补获第 7 处 + `serializeRichText` link（L476，归 safe：写 rich_text.link.url 非 Notion 服务端抓取点）

### 验证

- `npm run verify:baseline`：18 个测试文件、384 个用例全部通过（+32 ai-schema 契约），legacy 全绿，EXIT=0 零回归
- `node build.js`：零警告构建，单文件产物 1290.5 KB（+11.1 KB），关键锚点校验通过

[3.7.8]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.8

## [3.7.7] - 2026-07-23

### 修复（odyssey-improve 全项目 6 维度审计）

**安全**:
- **XSS 渲染未转义 (CWE-79)**：4 处 innerHTML 拼接补 escapeHtml — main-ui/notion-site-ui 的 AI 模型 option value+文本、events 模板 icon、security 确认对话框 hint itemName（同块 placeholder 已转义，hint 行遗漏）
- **删页绕 OperationGuard (CWE-862/639)**：BookmarkAutoImporter 自动同步归档已删除书签时直连 `NotionAPI.deletePage` 绕过 Guard（deletePage level 2）。改为 `OperationGuard.canExecute` 权限闸门，权限不足跳过归档并记 `guard.denied` 审计，不裸调

**可靠**:
- **节流失效**：BookmarkAutoImporter `processInBatches` 延迟条件引用外层页面对象 `index`（非遍历 `itemIndex`），`对象<数字→NaN→恒 false` 致 REQUEST_DELAY 永不生效，高书签量打 Notion API 触发 429。改名 `pageIndex` + 用 `itemIndex`
- **并发取任务**：`import/index.js` worker `nextIndex++` 改 `remaining.shift()`，对齐 export 层显式任务队列（并发安全锁定约束跟进）
- **RSS 单 feed 阻断**：RSSAutoImporter 新增 `fetchFeedWithRetry`（2 次指数退避重试），`loadCurrentItems` 单 feed 失败 catch continue，不再因单 feed 抖动阻断整次 RSS 同步
- **GitHub 分页数据丢失**：`_fetchPaginated` onerror/ontimeout 时若已拉到部分页则 partial resolve 保留已拉数据（否则整次 reject 丢弃前 N 页，下次从旧 watermark 重拉全部放大流量）

**性能**:
- **escapeHtml 热路径**：改纯字符串替换（`& < > "` 转义，保持 `!text` falsy 语义与 `textContent+innerHTML` 一致），消除每次调用创建一次性 DOM 节点；60 处批量渲染调用放大 GC

**可维护**:
- **死导入清理**：ui 层 5 文件（style-manager/index/styles/design-system/panel-resize）整段复制未用的 extract/export/import 导入块清理（~45 行死导入，ISS-008 同类遗留）
- **isHttpUrl 语义分歧**：BookmarkAdapter fallback 正则 `/^https?:/.test` 对齐主实现 `/^https?:\/\//i`（缺 `//` 与 `i` 标志）
- **ISS-007 注入路径测试**：adapter-contract 补 lazy bridge accessor 注入主路径测试（此前契约测试只 import adapter 对象不 import 注册器，注入主路径零覆盖，仅 fallback 被测）

### 说明

- 本次为纯质量加固（odyssey-improve 6 维度审计 high+medium 修复），无新功能、无运行时行为变化（除安全/可靠修复的设计行为对齐），严格遵守锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- `notion-oauth.test.js` BookmarkAutoImporter.run 测试设 `PERMISSION_LEVEL=2`（归档=deletePage level 2 新安全语义），新增权限不足跳过归档回归测试（CWE-862/639）
- deferred 2 issue：ISS-20260723-009（AI 输出 schema 校验层 CWE-94）、ISS-20260723-010（ai/index.js 7090 行巨石拆分 + LinuxDoAPI 迁回 extract）
- reliability agent 报 `markExported` 丢失更新经核实为误判（JS 单线程同步读改写无 await 间隔即无竞态），已记 safe 并持久化判据 spec S-20260723-iebd

### 验证

- `npm run verify:baseline`：17 个测试文件、352 个用例全部通过（+2 ISS-007 注入 + CWE-862 回归），legacy 全绿，logic 40/0
- `node build.js`：零警告构建，单文件产物 1279.4 KB（-2.3 KB），关键锚点校验通过

[3.7.7]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.7

## [3.7.6] - 2026-07-18

### 重构

- **UICommandService 分层迁移**：将 UI 命令分发协调器从 `src/extract/index.js` 迁至独立 `src/coordination/UICommandService.js`，extract 层回归数据抽取职责，仅导出 `ZhihuAPI`/`GenericExtractor`/`WorkspaceService`。消除 extract 层承担 UI 命令分发（`select_ai_target`/`refresh_workspace_targets`/`fetch_ai_models`/`save_command_boundary_settings` 等）的分层违规，及 extract → import/export/ai 的多向耦合（ISS-20260718-008）
- **adapter 结构性循环消除**：`BookmarkAdapter`/`RSSAdapter` 不再顶部 `require("../bridge")`，改由 `src/adapter/index.js` 注册时注入 `_bridgeAccessor` lazy accessor，运行时解析 bridge 模块。消除 `adapter/index → BookmarkAdapter → bridge → BookmarkAutoImporter → SyncCoordinator → adapter/index` 加载期循环（ISS-20260718-007）

### 说明

- 本次为模块边界整理（纯 refactor），无运行时行为变化，严格遵守锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- 源码层 extract 不再导出 UICommandService（验证通过）；产物层 esbuild 为 coordination 生成独立 `require_UICommandService` 工厂
- `tests/legacy-harness.js` 的 `FACTORY_NAMES` 列表补充 `require_UICommandService`，使 legacy 测试经 harness 仍能取到 UICommandService
- adapter 契约测试未注入 `_bridgeAccessor` 时走 fallback 顶层 require，保持向后兼容

### 验证

- `npm run verify:baseline`：17 个测试文件、350 个用例全部通过，legacy 全绿，logic 40/0
- `node build.js`：零警告构建，单文件产物，关键锚点校验通过

[3.7.6]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.6

## [3.7.5] - 2026-06-24

### 新增

- **UI 设计 Token 体系完善**：`src/ui/design-system.js` 新增 28 个 CSS 变量 token，覆盖 spacing（3xs~3xl）、font-size（xs~2xl）、z-index（panel/panel-top/overlay/float）、radius（2xs/md/pill）、white、bright（warning/success/danger）、disabled（opacity/cursor）系列，建立完整的主题无关 token 层级
- **就地状态文本语义类**：新增 `.ldb-status-text` 及修饰符（`--danger/--success/--warning/--accent/--muted`），替代内联 `color` 样式，用于测试按钮旁等持久状态显示
- **可访问性补全**：12 处图标按钮（主题切换、最小化、关闭、刷新、浮动按钮）补全 `aria-label`；2 处状态容器（`#ldb-status-container`、`#ldb-obs-test-status`）补全 `aria-live="polite"`

### 变更

- **CSS 硬编码消除**：4 个 UI 文件（styles/main-ui/generic-ui/notion-site-ui）共 325 处硬编码值收敛为 `var(--ldb-ui-*)` 引用（hex 颜色 9、border-radius 30、spacing 201、font-size 74、z-index 6、rgba focus-ring 5），视觉数值 1:1 保留
- **disabled 样式 token 化**：`design-system.js` 中 5 处 `opacity: 0.65` 与 5 处 `cursor: not-allowed` 字面量替换为 `var(--ldb-ui-disabled-opacity)` / `var(--ldb-ui-disabled-cursor)`
- **错误展示统一**：10 处 `innerHTML` 内联 `color` 状态文本（events.js 的 `obsTestStatus`、main-ui.js 与 notion-site-ui.js 的 `bmStatus`）收敛为 `.ldb-status-text` 语义类，保留就地持久显示语义
- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.5`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建，单文件产物 1263.2 KB
- 收敛 grep：hex/border-radius/font-size/opacity/innerHTML+color/DEFAULTS-snake_case 均为 0

### 说明

- 本次为 UI/UX 一致性优化（非改版），严格遵守路线图锁定约束：单文件 Userscript 输出不变、纯客户端架构、向后兼容
- TASK-004（数据契约对齐）与 TASK-005（状态管理）经核验现有代码已实质满足，未引入 `normalizeValue` 与 `state-manager.js`，避免过度工程

[3.7.5]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.5

## [3.7.4] - 2026-06-24

### 修复

- **循环依赖消除**：将 `UrlValidator` 从 `src/security/index.js` 提取到独立模块 `src/security/UrlValidator.js`，消除 `src/api/index.js` ↔ `src/security/index.js` circular dependency，测试输出中相关警告消失
- **XSS 防护**：`src/export/index.js` 的 `post.cooked` 文本提取改用 `DOMParser` 解析后读取 `textContent`，避免直接 `innerHTML` 赋值不可信 HTML
- **Extension SSRF 加固**：background service worker 的 URL 白名单校验增加协议检查，非本地地址必须使用 `https:` 协议和默认 443 端口
- **弱随机数消除**：`src/api/index.js` 的 multipart boundary 和 `src/ui/events.js` 的 Obsidian 图片文件名均改用 `crypto.getRandomValues` 生成
- **并发安全**：`Exporter.exportBookmarks` 的 worker 调度改用显式任务队列 `remaining.shift()`，替代共享 `nextIndex++`
- **变量作用域修复**：`src/ui/main-ui.js` 补充声明 `const provider = AIService.PROVIDERS[aiService]`，避免使用未声明变量
- **空 catch 块补日志**：`src/bridge/BookmarkExporter.js` 和 `src/ai/index.js` 中的空 catch 块统一添加 `console.warn` 日志，保留原有回退行为

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.4`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建

[3.7.4]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.4

## [3.7.3] - 2026-06-22

### 修复

- 并发：`Exporter.exportBookmarks` 和 `AutoImporter.run` 的并发 worker `nextIndex` 改为 `++nextIndex` 原子操作，消除 race condition（COR-001/COR-002）
- 正确性：`BookmarkAutoImporter.processBookmark`/`processDeleted` 参数名 `index` shadow 外层页索引对象，重命名为 `itemIndex`（COR-015/COR-016）
- 正确性：`DedupStore.clearSeen` 在 batch 模式下无条件执行 `GM_deleteValue`，加 `return` 跳过（COR-003）
- 正确性：`DOMToNotion` 表格空行 `Math.max()` 返回 `-Infinity`，加 `Math.max(1, ...)` 下限（COR-018）
- 正确性：`ObsidianAPI` 三个方法缺少 `timeout`/`ontimeout`，请求挂起（COR-019）
- 最佳实践：`UndoManager.hideToast` 未清理旧 `setTimeout`，新 toast 被误删（BP-015）
- 最佳实践：`bridge/index.js` 用 `var` 声明构建标记，改为 `const`（BP-003）
- 最佳实践：`SyncState.buildWatermark` 用 `Array.includes` O(n²) 改为 `Set.has` O(1)（BP-012）

### 安全

- **API key 泄露防护**：新增 `UrlValidator` 工具
  - AI 请求 `baseUrl` 白名单校验（`api.openai.com`/`api.anthropic.com`/`generativelanguage.googleapis.com`）或 HTTPS 非内网域名
  - Obsidian API URL 仅允许本地地址（`127.0.0.1`/`localhost`/`::1`）
  - `_isPrivateHost` 拦截 `10.x`/`172.16-31.x`/`192.168.x`/`169.254.x` 私有网段（SEC-001/SEC-002）
- OAuth state token `Math.random()` 回退改为抛出错误，强制使用 `crypto.getRandomValues`（SEC-005）
- `OperationLog` event ID 从 `Math.random()` 改为 `crypto.getRandomValues`（SEC-015）
- `apiKeyHash` 从直接截取后 8 位改为 djb2 hash，避免部分暴露 API key（SEC-011）

### 重构

- **UI 模块拆分**：`src/ui/index.js`（~9700 行）拆分为 8 个独立模块 + re-export 入口
  - `ui/style-manager.js` / `ui/design-system.js` / `ui/panel-resize.js`
  - `ui/notion-site-ui.js` / `ui/styles.js` / `ui/events.js`
  - `ui/main-ui.js` / `ui/generic-ui.js`
- **超长方法拆分**：
  - `GitHubAutoImporter.run`（287 行 → 50 行）拆为 5 个私有方法（MNT-001）
  - `RSSAutoImporter.run`（195 行 → 60 行）拆为 3 个私有方法（MNT-002）
  - `DOMToNotion.cookedToBlocks`（290 行 → 90 行）拆为 13 个元素处理器（MNT-003）
- **AI 模块分区**：`src/ai/index.js`（~7000 行）添加 7 个分区注释，因深度交叉依赖暂无法物理拆分

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.3`
- `AIService` 8 处 baseUrl 标准化合并为 `_normalizeBaseUrl`，内置 URL 安全校验

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建
- 代码质量审查 85 个 findings，15 个已修复（2 critical, 5 high, 6 medium, 2 low）

[3.7.3]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.3

## [3.7.2] - 2026-06-20

### 修复

- 安全：`showStatus` 两处 `innerHTML` 注入加 `Utils.escapeHtml` 防 XSS
- 安全：Obsidian 测试状态 `innerHTML` 加 `escapeHtml`
- 健壮性：`showProgress` `total=0` 时 percent 归零而非 NaN（除零防护）
- 健壮性：`showStatus` 加 `clearTimeout` 防新消息被旧定时器清除
- 防重入：`exportBtn`/`obsExportBtn` 加 `disabled` 防双击
- DOM 爆炸：失败项截断 20 条 + 错误文本截断 120 字符
- CSS：27 处双 `class=""` 合并为单一 class 属性
- CSS：添加 `.ldb-report-*` 7 个缺失类定义
- 响应式：三面板加 `max-width: calc(100vw - 32px)`
- Token：添加 `--ldb-ui-badge-teal/blue` 替代硬编码色值
- 可访问性：6 个 `toggle-section` 加 `aria-expanded`/`aria-controls`/`role`/`tabindex`/keyboard
- 可访问性：tab 面板加 `role=tablist/tab/tabpanel` + `aria-selected`

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.2`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建
- 10/10 critical findings 已修复

[3.7.2]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.2

## [3.7.1] - 2026-06-18

### 修复

- 性能：优化工作区可视化模型构建，将 `databases.find` 改为 `databasesMap.get`，合并多次 `records.forEach` 为单次遍历，减少大工作区下的 CPU 开销
- 代码质量：同步更新 `src/ui/index.js` 与根目录 `.user.js` 对应实现

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.1`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `npm run verify:delivery`：构建、扩展、等价性、UI 静态验证全部通过
- `node --check LinuxDo-Bookmarks-to-Notion.user.js`：语法检查通过

[3.7.1]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.1

## [3.7.0] - 2026-06-17

### 新增

- 扩展测试覆盖率：新增 263 个用例，覆盖 SyncStateV2、DedupStore、Config、OperationLog、AIService、RSS/Atom 解析、GitHub/书签/通用导出等 17 个模块，总计 349/349 用例通过，收敛判定 PASS，置信度 0.85
- 交付前 13 维度检查：覆盖需求、测试有效性、回归、代码质量、异常处理、安全、性能、兼容性、数据迁移、部署、监控/日志、回滚、文档/交接

### 修复

- 安全：收紧 Userscript 权限域，将 `@match *://*/*` 与 `@connect *` 替换为显式域名与 `@include` 正则白名单，降低横向请求风险
- 架构：完成 P1 架构升级，消除 SyncState V1/V2 双写，引入 V1→V2 facade 迁移与 SyncLock 解决 `export`↔`bridge` 循环依赖
- 性能：修复 PERF-004，`DedupStore` 批量模式改为 `queueMicrotask` 防抖写入，减少 GM_setValue IPC 次数
- 代码质量：拆分 god module，修复 COR-008/COR-012/SEC-006 遗漏项；删除 dead code (`src/ui/SyncSettings.js`)，清理未使用导入与重复对象键

### 变更

- `package.json`、`build.js` 与根目录 `.user.js` 的 `@version` 同步递增到 `3.7.0`
- `package-lock.json` 同步更新 `esbuild@^0.28.1` 与 `vitest@^4.1.8`

### 验证

- `npm test`：17 个测试文件、349 个用例全部通过
- `node build.js`：零警告构建
- `node --check LinuxDo-Bookmarks-to-Notion.user.js`：语法检查通过

[3.7.0]: https://github.com/Smith-106/LD-Notion/releases/tag/v3.7.0
