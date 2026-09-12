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

### wave29 改动区间等效变异退役清单

本轮修复改动区间共 65 个切口，KILLED 57，其余 8 条为**行为不可观测的等效变异**（等价变异体），逐条退役理由如下（其余 SURVIVED 落在未改动行：`src/utils/index.js` 转义/折叠工具、`src/api/constants.js` 及未触及的旧分支）：

| 切口 | 变异 | 退役理由（为何不可观测） |
| --- | --- | --- |
| `DomSpec.js:93` | `&&` → `||` | 仅「无任何 section」的残缺 HTML/测试桩走到该行；真实 DOM 下 `<table>` 直属 `tr` 已被解析器移入隐式 `tbody`，两侧操作数组合不同时为空时 `rowsOf(table)` 恒空 |
| `obsidian.js:472` | `&&` → `||` | 决定「是否在字面量模式重算链接标签」；重算只在子树含 video/audio/iframe 时改变输出，无该类子节点时重算结果与已算 `children` 逐字节相同 |
| `obsidian.js:545` | `||` → `&&` | 早退守卫：`hasQuote` 初值 false 时继续下探只会得到 `tagName == ""` 的文本节点（`scanQuote` 遍历空 childNodes，无副作用）；为 true 时重复置位不改结果 |
| `obsidian.js:620` | `false` → `true` | `append()` 判据首项为 `out &&`，而**首次** append 时 `out` 必为空串；每次 append 末尾又以 `Boolean(isBlockChild)` 覆盖该初值 |
| `obsidian.js:628` | `&&` → `||` | `tagName` 为真必是元素（两式同真）；文本节点 `tagName` 为 `undefined`，`false && x` 与 `false \|\| x` 同为假值 |
| `obsidian.js:667` / `671` | `&&` → `||` | `row.children` 的元素必有 `tagName`，左侧恒真、右侧恒被短路 |
| `DOMToNotion.js:1019` | `<= 2000` → `< 2000` | 只影响「合并后恰为 2000 字符」的边界：合并为单段（Notion 单段上限即 2000，合法）与保留两段（同样合法）等价，可见文本与总长一致 |

> 审计方法：本次以「同一视角由三个模型（deepseek-v4-flash / GLM-5.3-flash / qwen3.8-flash）共同完成」的方式连续多轮查找缺陷，每一轮都要求模型给出**可构造输入**与**规范锚点**，并用测试与变异锁固化结论；对误报需在读源后明确驳回并记录理由。
