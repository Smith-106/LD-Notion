# AI Prompt Injection 多层防御

LD-Notion 的 AI 助手接收用户输入和外部内容（Linux.do 帖子、GitHub README、网页摘要等），这些内容可能包含恶意 prompt injection 攻击。v3.7.0 引入了多层防御体系来隔离和净化不可信输入。

## 威胁模型

攻击者可以通过以下路径注入恶意指令：

1. **Linux.do 帖子内容**：帖子标题或正文中嵌入 `忽略以上指令` 类文本。
2. **GitHub README**：仓库描述或 README 中嵌入 prompt injection payload。
3. **浏览器书签元数据**：书签标题或 URL 中包含恶意文本。
4. **用户对话输入**：用户自身输入中包含试图覆盖系统指令的文本。

## 三层防御

### 第一层：输入隔离（XML 标签分离）

AI 分类 prompt 将用户内容包裹在 `<user_content>` XML 标签中，与系统指令分离：

```text
系统指令...
<user_content>
  <title>帖子标题</title>
  <body>帖子正文</body>
</user_content>
请根据以上用户内容进行分类...
```

这降低了用户内容中的 `忽略以上指令` 类文本被 AI 误判为系统指令的风险。

### 第二层：输出净化（escapeHtml + safeMarkdown）

ChatUI 实现两个净化辅助函数：

- **`escapeHtml`**：使用浏览器原生 `textContent→innerHTML` 机制转义 `<`、`>`、`&`、`"`，防止 HTML/JS 注入。
- **`safeMarkdown`**：先转义全部 HTML，再选择性恢复安全 Markdown 格式（粗体 `**`、换行），防止注入的 HTML/JS 在聊天 UI 中渲染。

```text
原始 AI 回复：<script>alert('xss')</script>**重要**
escapeHtml 后：&lt;script&gt;alert('xss')&lt;/script&gt;**重要**
safeMarkdown 后：&lt;script&gt;alert('xss')&lt;/script&gt;<strong>重要</strong>
```

### 第三层：UI 全局转义

所有用户可控文本在插入 HTML 前统一经过 `Utils.escapeHtml` 转义，覆盖 50+ 处拼接点：

- 数据库名称、页面标题
- 错误消息、书签标题
- 标签、文件名、报告预览
- 来源类型、书签路径

## 与 OperationGuard 的协作

Prompt injection 防御和 OperationGuard 在不同层面工作：

| 防御层 | 防御目标 | 作用阶段 |
| --- | --- | --- |
| XML 标签隔离 | 防止恶意内容劫持 AI 意图 | AI 请求构建 |
| 输出净化 | 防止恶意内容通过 UI 渲染 | AI 回复展示 |
| UI 全局转义 | 防止恶意内容通过 UI 拼接 | DOM 渲染 |
| OperationGuard | 防止未授权写入 | 写入执行 |

四层防御互补：即使 prompt injection 成功影响了 AI 意图，OperationGuard 仍会在写入前检查权限；即使写入被允许，输出净化和 UI 转义仍会阻止恶意内容在 UI 中渲染。

## 已知局限

- XML 标签隔离依赖 AI 模型正确理解标签语义，部分模型可能在复杂嵌套场景下混淆标签边界。
- `safeMarkdown` 当前仅恢复粗体和换行，链接、代码块等格式被转义后不再渲染。
- Extension 版本中 background service worker 的 URL 白名单使用简单字符串匹配，存在 SSRF 绕过风险（详见 [Extension Architecture](/extension/architecture)）。
