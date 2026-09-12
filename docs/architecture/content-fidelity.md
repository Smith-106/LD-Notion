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
| 段落首尾片段统一去首尾空白（含 `code` 注解） | 既定语义 | `normalizeInline` 对 `code` 的提前返回只保护**段内**空白 |

## 验证方式

三层守卫，缺一不可：

1. **出口面契约测试**（`tests/dom-exit-surface.test.js` 等）：以构造 HTML 断言两个出口的可见内容与结构形态；单一判据本身也有断言。
2. **变异测试**（`_p4cmut.py`，本地审计脚本）：对判据、转义分支、归一化与截断路径注入 286 条等价/非等价变异，要求**全部被测试杀死**（KILLED 286 / SURVIVED 0）。等效变异（行为不变的变异体）必须显式说明并退役，不能用「无法杀死」蒙混。
3. **交付链**：`npm test` → `node build.js` → `npm run verify:build`（BUILD markers + root ≡ dist）→ `npm run verify:equivalence` → `npm run verify:delivery`。

> 审计方法：本次以「同一视角由三个模型（deepseek-v4-flash / GLM-5.3-flash / qwen3.8-flash）共同完成」的方式连续多轮查找缺陷，每一轮都要求模型给出**可构造输入**与**规范锚点**，并用测试与变异锁固化结论；对误报需在读源后明确驳回并记录理由。
