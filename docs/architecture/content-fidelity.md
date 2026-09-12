# 双出口内容保真

LD-Notion 把同一份源内容渲染到两个出口：**Notion blocks**（`src/api/DOMToNotion.js`）与 **Markdown**（`src/api/obsidian.js` 的 `HTMLToMarkdown`）。两个出口的**可见内容必须一致**——这是本项目的核心不变量，也是历轮验收与审计的判据。

本页记录该不变量的实现口径、转义链的规范锚点，以及**已知边界**（经评估决定不修或属调用方职责的项）。

## 出口面与单一判据

出口形态各异，但判据必须唯一。所有「什么算块级」「什么算媒体」「什么算跳过」「如何取地址」「如何折行」的判断集中在 `src/api/DomSpec.js`，两个出口共同消费：

| 判据 | 原语 | 说明 |
| --- | --- | --- |
| 块级节点 | `DomSpec.isBlockNode` | 标签表 + 容器 class（`lightbox-wrapper` / `image-wrapper` / `md-table` / `a.attachment` / `aside.quote`） |
| 跳过子树 | `DomSpec.isSkippedNode` | `script` / `style` / `noscript` / `object` / `embed` / `canvas` |
| 媒体类型 | `DomSpec.mediaKind` | `img` / `video` / `audio` / `iframe` / `a.attachment` |
| 媒体地址 | `DomSpec.mediaSrc` / `mediaUrl` | 属性回退链（`data-src` → `src` → `srcset` 首项…）+ URL 校验（拒内网与 `data:`） |
| 单行折叠 | `DomSpec.foldToSingleLine` / `TEXT_BOUNDARY_TAGS` | 表格单元格/标题等不允许换行的位置 |
| emoji 识别 | `DomSpec.emojiNameOf` | `/images/emoji/...` 视为**文本载体**而非图片块 |
| 元信息容器 | `DomSpec.isMetaNode` | `.meta`（图片文件名/尺寸，源页由 CSS 隐藏）两出口一致跳过 |
| 表格行采集 | `DomSpec.collectTableRows` | 浏览器渲染序 `thead → tbody → tfoot`（含**全部**段），两出口唯一行源 |
| 富文本上下文分隔线 | `DomSpec.HR_TEXT` | 无法落原生分隔线的上下文以 `---` 保持两出口可见内容一致 |

> 维护约定：新增出口或新增判据时，必须回到 `DomSpec` 扩展，而不是在出口内重声明局部表。`tests/dom-exit-surface.test.js` 对「单一判据」本身做了断言（例如跳过表只有一处声明）。

## Notion 出口：单一遍历模型

`cookedToBlocks` 只保留一条遍历路径，三态出口：

1. **内联**：文本、`<br>`、以及整棵「无块级且无媒体」子树，进入内联片段缓冲；
2. **块级**：命中 `isBlockNode` 时先 `flushInline()` 再交给 `processElement` 分派；
3. **透明下钻**：自身非块级但**含**块级/媒体时，按 `childNodes` 顺序继续下钻。

媒体容器（`lightbox-wrapper` / `image-wrapper`）不再整容器交给单一处理器，而是**按文档序逐子节点分派**——Discourse cooked HTML 的常见形态是 `<div class="lightbox-wrapper"><a class="lightbox" href="原图"><img src="缩略图"></a>…</div>`，整容器处理会跳过锚内图片，造成正文丢图且与 Markdown 出口不对称。

内联片段在 `flushInline` 中合并（注解与链接相同且合并后不超 2000 字符）、归一（HTML 空白折叠）、边界收敛，并保证：

- 首/末片段去除首尾空白，**段内**换行语义保留（`<br>` 产生的空行不被吞）；
- 跨片段边界只折叠空格/制表符（`code` 注解片段跳过，多空格在代码中有语义）；
- 折叠后再次过滤空片段（否则空 `content` 会被 Notion 拒绝）；
- 超出 100 段时保留 99 段 + 可见截断提示。

## Markdown 出口：转义链

字面文本进入 Markdown 前经 `Utils.mdLiteral` 两遍处理：

```js
// 第 1 遍：字符类（块级与内联结构触发字符）
.replace(/([\\`*~_\[\]<&|])/g, "\\$1")
// 第 2 遍：行首结构符（只能出现在行首的标记）
.replace(/^([ \t]*)([>#=]|-{2,}(?=[ \t]*$)|[-+*](?=\s|$)|-(?=[- \t]*$)(?=(?:[- \t]*-){2})|(\d+)([.)])(?=\s|$))/gm, …)
```

规范锚点与阻断位：

| 结构 | 规范锚点 | 阻断位 |
| --- | --- | --- |
| ATX 标题 / setext `=` / 引用 | CommonMark §4.2–4.5 | 第 2 遍行首 `[>#=]`（`^([ \t]*)` 已吸收任意缩进） |
| 主题分隔线、setext `-`、无序列表 | §4.1、§5.1 | 第 1 遍 `*`/`_`；第 2 遍 `-{2,}(?=[ \t]*$)`、`[-+*](?=\s|$)`、连字符混合间距分支 |
| 有序列表 | §5.1 | 第 2 遍 `(\d+)([.)])(?=\s|$)` |
| 围栏代码块 | §4.7 | 第 1 遍反引号与 `~` |
| HTML 块 / 自动链接 / 注释 | §4.6、§6.7 | 第 1 遍 `<` |
| 实体引用 | §6.10 | 第 1 遍 `&` |
| 强调 / 删除线 / 行内代码 | §6.5、GFM §6.2 | 第 1 遍 `* _ ~` 与反引号 |
| 链接 / 图片 / 引用式定义 | §6.7 | 第 1 遍 `[` `]` |
| GFM 表格 | GFM §6.6 | 第 1 遍 `|` |

- `mdUrl` 对目标面单独处理（`\s<>()\\` 查表 + 百分号编码），避免括号平衡计数截断链接目标。
- `mdText` 只用于链接**标签位**（字符集略窄：`\ [ ] < ` 反引号），`mdLabel` 用于链接标签与图片 alt 等单行字面量（先转义再折叠换行）。
- 行首判据只处理**块级**上下文；`mdLiteral` 保留换行，逐行前缀（`> ` / `- ` / `N. `）由调用方拼接。

## 已知边界（记录理由，不修）

| 边界 | 判定 | 理由 |
| --- | --- | --- |
| 块首行 ≥4 空格缩进 | 范围外 | 缩进代码块**不能中断段落**；块级上下文中行首缩进由调用方决定 |
| 行尾 2+ 空格 → 硬换行 | 范围外 | 属换行/块布局（调用方职责），且不改写文本语义为标题/链接/强调 |
| 无管道的 GFM 单列定界行（`foo`⏎`:-:`） | 待渲染器确认 | 纯连字符形态已被行首判据拦截；其余可利用性取决于渲染器是否要求定界行含未转义 `|`，`:` 本身非 CommonMark 结构符 |
| `_cookLightbox` 兜底仅在容器无子节点时可达 | 保留公开壳 | 生产路径已改为逐子节点分派；该键保留供既有测试与 legacy harness 直接调用 |
| lightbox 锚的 `href`（原图）未被读取，落库用 `<img src>` | 不修 | 缩略图与原图同为图片资源，地址统一经 `DomSpec.mediaSrc` 归一，且与 Markdown 出口同口径，无内容丢失 |
| 段落首尾片段统一去首尾空白 | 已收窄（wave29） | `code` 注解片段**豁免**边界裁剪——`<div><code>  x  </code></div>` 的空白与 `<p>` 路径、Markdown 出口一致保留 |

## 验证方式

三层守卫，缺一不可：

1. **出口面契约测试**（`tests/dom-exit-surface.test.js` 等）：以构造 HTML 断言两个出口的可见内容与结构形态；单一判据本身也有断言。
2. **变异测试**（`npm run verify:mutation` → `scripts/verify-mutation.js`）：对判据、转义分支、归一化与截断路径注入单一切口变异，要求**全部被测试杀死**（语法不合法的变异记 `INVALID`，不计入 `SURVIVED`）。等效变异（行为不变的变异体）必须显式说明并退役，不能用「无法杀死」蒙混。
3. **交付链**：`npm test` → `node build.js` → `npm run verify:build`（BUILD markers + root ≡ dist）→ `npm run verify:equivalence` → `npm run verify:delivery`。

## wave29 共识复审确认项（三模型 × 三出口面分片）

三模型（deepseek-v4-flash / GLM-5.3-flash / qwen3.8-flash）各按同一出口面分片（Markdown 转义链 / Notion 遍历与富文本 / 表格与容器）独立读源复审，合计 35 条原始 FINDING，经只读探针逐条实证后确认 16 项、驳回 1 项（误报：`mdLiteral` 行首判据「漏孤立 `\r`」—— JS `m` 标志的 `^` 本就匹配 `\r` 之后位置）。按出口面归类的成因：

| 出口面 | 缺陷共性 | 修复口径 |
| --- | --- | --- |
| 判据未驻 `DomSpec` | `.meta` 跳过、表格行采集 | 新原语 `isMetaNode` / `collectTableRows`，两出口共用 |
| 富文本上下文缺可见表示 | `<hr>` 在引用/单元格内零产出 | `HR_TEXT` 标记（块级上下文仍产原生分隔线） |
| 裸 `textContent` 回退 | `<a>` 标签、附件名泄露 `script` 源码 | 统一走 `textWithBreaks`（逐节点取文本 + 剪枝） |
| 块级边界丢失 | 嵌套容器文本合并、空块子节点词融合 | 容器进出均落缓冲；空块级子节点仍置边界 |
| 语义空白被裁剪 | 透明下钻 `code` 片段首尾空白 | `code` 注解片段豁免边界裁剪 |
| 字面量上下文错配 | `<a>` 内媒体双重转义、单元格块级结构符 | `_literalLink` 只标记媒体自身；单元格按单行上下文投影 |
| CommonMark/GFM 结构误判 | 空 `<code>` 反引号、code 首尾空格、强调跨空行 | 空内容零产出；空格补位；按行包裹 |

> 所有确认项均已由 `tests/dom-exit-surface.test.js` 的 wave29 一组契约锁定（合法原样 / 危险输入 / 空），并由 `npm run verify:mutation` 提供可重跑强度证据。

### wave30 改动区间与全文件变异锁现状

wave30 把改动区间与全文件的**变异幸存者**逐条当作“未验证行为面”收敛：

- 改动区间（`DomSpec.tagOf` / `TABLE_CELL_TAGS` 收束 + 死初始化清理）：**5 切口 → KILLED 4 / 等效 1**
- 全文件深跑（`src/api/{DomSpec,obsidian,DOMToNotion}.js`，stride 1）：**353 切口 → KILLED 337 / SURVIVED 16 / INVALID 0**
- 16 条幸存切口全部经 `node scripts/verify-mutation-equivalence.js <mutation-log>` 判定为 **EQUIVALENT**（exit 0）：在约 370 项可观测输出（`cookedToBlocks` 三模式 × 72 输入、Markdown 出口、公开判据）上与原始实现逐字节一致；只要有一条不一致，校验器即非零退出并列出切口

一轮 wave29/wave30 之间还被补测试杀死的可观测变异（**可观测不得以“等效”名义退役**）的 5 例：`obsidian.js:759`（`convert(post.cooked \|\| "")` 误改后 callout 正文丢失）、`DOMToNotion.js:373`（`skipNestedLists` 误改后父项富文本吞内层项文本）、`DOMToNotion.js:1070`（`nodeType` 比较反转后内联容器拍平成单段落）、`DOMToNotion.js:1071` 两条（块级/媒体判据失效后 `<span>a<hr>b</span>` 与嵌套列表结构丢失）。

### 等效变异退役清单（16 条）

| 切口 | 变异 | 退役理由（为何对公开出口面不可观测） |
| --- | --- | --- |
| `obsidian.js:176` | `&&` → `\|\|` | 属于本轮改动区间：该映射 i=0 分支因上游 `.trim()` 不可能以 2 空格开头，故 `i === 0` 与 `!test` 在同一点恒等价；i>0 且无缩进时 `replace` 为恒等变换 |
| `obsidian.js:471` | `&&` → `\|\|` | 该判据只决定“标签是否按字面量重算”；querySelector 存在却无媒体时，重算结果与原标签逐字节相同（语料含 `<a>` 裹裸文本/裹图两式） |
| `DOMToNotion.js:12` | `&&` → `\|\|` | `cut === 0` / `cut === text.length` 均不可达（上游对 `length <= maxLength` 已早退）；不可达时 `charCodeAt(-1)` 为 NaN，不构成代理对判据 |
| `DOMToNotion.js:35` | `true` → `false` | `_cookLightbox` 公开壳仅在容器无直属子节点时被兜底调用（有子节点时 `processElement` 已逐个分派并 return），空容器下两条图片路径都无节点可采 |
| `DOMToNotion.js:481` | `>=` → `>` | 等长行 `concat(空数组)` 结果逐元素相同 |
| `DOMToNotion.js:551` | `\|\|` → `&&` | 该行只在“emoji 名未收录且地址被判拒”的块级路径可达；emoji 图在遍历中始终先被 `walkNode` 按文本载体分流（内联） |
| `DOMToNotion.js:583` | `<=` → `<` | 长度恰为 2000 时 else 分支的 `safeCutIndex(remaining, 2000)` 仍切出整串单块，与早退分支逐字节相同 |
| `DOMToNotion.js:616` | `false` → `true` | 首次 `breakIfNeeded` 时 `result` 为空，`result.length > 0` 守卫吞掉初值，且该次调用立即归位 |
| `DOMToNotion.js:619` | `false` → `true` | 置位只由块边界触发，归位发生在 `if (!needBreak) return` 之后并被当次消费；两次消费之间必有新的块边界重新置位，残留 true 观测不到 |
| `DOMToNotion.js:842` | `\|\|` → `&&` | `lightbox-wrapper` 与 `image-wrapper` 在真实 DOM 中互斥，两式同真同假 |
| `DOMToNotion.js:843` | `false` → `true` | 该标志仅在遍历后读取，任何真值子节点都会置真；仅零子节点时保留初值，此时两条兜底路径都不产块 |
| `DOMToNotion.js:853` | `&&` → `\|\|` | 实测该判据两分支在语料（含灯箱内“有效地址 + alt”图）上产出相同的块级图片（内联 img 路径同样落块级图片） |
| `DOMToNotion.js:875` | `&&` → `\|\|` | 非 `a` 元素带 `attachment` 类名时 `_cookAttachment` 需 `getAttribute("href")`，语料内含该反例且输出一致（无 href 时两条路径都不产文件块） |
| `DOMToNotion.js:949` | `false` → `true` | 同 `843`（`.md-table` 容器；零子节点时两条路径都不产块） |
| `DOMToNotion.js:1010` | `\|\|` → `&&` | 空内容片段即使被合并，也在此后按 `part.text.content` 被两道过滤剔除，不进 `rich_text` |
| `DOMToNotion.js:1070` | `\|\|` → `&&` | `found` 为假且子节点为元素时，短路顺序变化不改变“是否找到块级/媒体子节点”的结论（`!child` 为真时右侧不再求值） |

> 审计方法：本次以「同一视角由三个模型（deepseek-v4-flash / GLM-5.3-flash / qwen3.8-flash）共同完成」的方式连续多轮查找缺陷，每一轮都要求模型给出**可构造输入**与**规范锚点**，并用契约测试与变异锁固化结论；对误报需在读源后明确驳回并记录理由。wave30 额外要求：每条幸存变异必须有**可复现的等效性依据**（差分语料哈希一致）或**杀死它的契约测试**，两者俱无则不许交付。
