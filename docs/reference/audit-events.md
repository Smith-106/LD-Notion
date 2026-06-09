# Audit Events

Audit Events 是 LD-Notion 的操作审计参考格式。它们记录用户或 AI 在什么时候、对哪个目标、提出或执行了什么动作，以及 OperationGuard 和目标 API 给出的结果。

## audit_event JSON example

```json
{
  "audit_event": "write.block.inserted",
  "event_id": "evt_20260513_001",
  "at": "2026-05-13T00:00:00+08:00",
  "actor": "ai",
  "source": "ai-agent-loop",
  "guard": {
    "decision": "allow",
    "permissionLevel": "standard",
    "requiredLevel": "standard",
    "confirmation": "not_required"
  },
  "operation": {
    "name": "appendBlocks",
    "risk": "standard",
    "trigger": "user_requested_agent_write"
  },
  "target": {
    "type": "notion_page",
    "id": "<redacted>",
    "title": "项目计划"
  },
  "payload": {
    "blockCount": 3,
    "contentPreview": "新增 Docker 网络总结。"
  },
  "result": {
    "status": "success",
    "notionRequestId": "<redacted>"
  },
  "redaction": ["token", "clientSecret", "apiKey", "target.id"]
}
```

## Event table

| Event name | Trigger | Payload | redaction | User-visible result |
| --- | --- | --- | --- | --- |
| `read.workspace.searched` | 用户或 AI 搜索 Notion 工作区。 | query、resultCount、targetScope | 不记录 token；query 可按 UI 策略截断。 | 展示搜索结果或空结果。 |
| `read.page.fetched` | 读取页面详情、Markdown 或 blocks。 | pageId、readMode、blockCount | pageId 可脱敏；不记录正文全文。 | 展示读取内容或失败原因。 |
| `agent.tool.requested` | AI Agent 计划调用工具。 | toolName、intent、risk、targetType | 不记录完整 prompt 中的密钥。 | 用户可看到 Agent 正在执行的步骤。 |
| `guard.decision` | OperationGuard 完成权限判断。 | operation、requiredLevel、currentLevel、decision | target id 和凭据脱敏。 | 允许、要求确认、拒绝或仅预览。 |
| `guard.denied` | 权限不足、授权缺失、未知操作或用户取消。 | reason、requiredLevel、currentLevel、authMode | 不记录 token、Client Secret。 | 显示拒绝原因和下一步建议。 |
| `write.page.created` | 创建 Notion database item 或子页面。 | targetType、parentId、propertyNames | parentId、pageId 脱敏；属性值按需要摘要。 | 创建成功 / 失败。 |
| `write.block.inserted` | 追加或插入页面 blocks。 | pageId、blockCount、blockTypes | pageId 脱敏；内容只保留 preview。 | 插入成功 / 失败。 |
| `write.property.updated` | 更新数据库属性或页面元数据。 | pageId、propertyNames、oldValueSummary、newValueSummary | 不记录敏感属性值。 | 更新成功 / 失败。 |
| `page.archived` | 归档页面。 | pageId、confirmation、undoAvailable | pageId 脱敏。 | 归档成功、取消或失败。 |
| `page.restored` | 恢复页面。 | pageId、sourceEventId | pageId 脱敏。 | 恢复成功 / 失败。 |
| `block.deleted` | 删除 block。 | blockId、confirmation、permanent | blockId 脱敏；不记录原文全文。 | 删除成功、取消或失败；不承诺可撤销。 |
| `batch.tags.applied` | 批量打标签或分类。 | targetCount、successCount、failureCount、tagNames | 批量 target id 列表脱敏或摘要。 | 批量结果摘要。 |
| `import.completed` | 导入流程写入完成。 | source、destination、successCount、failureCount | database/page id 脱敏。 | 导入完成报告。 |
| `import.failed` | 导入在 captured、normalized、routed、guard_checked、written 任一步失败。 | source、state、reason | 不记录原始密钥或完整失败 payload。 | 排错提示和可重试信息。 |
| `auth.failed` | OAuth 或 manual token 验证失败。 | authMode、statusCode、notionErrorCode | token、refresh token、Client Secret 必须脱敏。 | 重新授权或检查 Integration 提示。 |
| `audit.enabled` | 用户开启审计日志。 | actor、previousState、newState | 不需要凭据字段。 | UI 显示审计已开启。 |
| `audit.disabled` | 用户关闭审计日志。 | actor、previousState、newState | 不需要凭据字段。 | UI 显示审计已关闭。 |

## Payload guidelines

| Field | Meaning | Required |
| --- | --- | --- |
| `audit_event` | 稳定事件名。 | Yes |
| `event_id` | 本地生成的事件 ID。 | Recommended |
| `at` | ISO 时间。 | Yes |
| `actor` | `user`、`ai` 或 `system`。 | Yes |
| `source` | `notion-panel`、`linuxdo-import`、`ai-agent-loop` 等来源。 | Yes |
| `guard` | OperationGuard 决策信息。 | For guarded writes |
| `operation` | 实际操作名、风险等级和触发原因。 | Yes |
| `target` | Notion page、database、block 或本地目标摘要。 | For target operations |
| `payload` | 可审计的参数摘要。 | Recommended |
| `result` | `success`、`failed`、`cancelled`、`denied` 或 `preview_only`。 | Yes |
| `redaction` | 被脱敏字段或脱敏策略。 | Yes |

## Redaction rules

Audit events MUST NOT store raw secrets. redaction 至少覆盖：

- Notion access token、refresh token、manual token。
- OAuth Client Secret。
- AI API Key。
- GitHub Token。
- Obsidian API Key。
- 完整数据库 ID、页面 ID、block ID 可按展示需要使用 `<redacted>` 或短摘要。

内容字段应优先记录摘要、数量、字段名或 preview，不记录大段正文、完整 prompt 或用户未确认公开的敏感文本。

## User-visible result contract

| Result | Meaning | UI behavior |
| --- | --- | --- |
| `success` | 操作已完成。 | 展示成功数量、目标名称或打开入口。 |
| `failed` | 工具或 API 返回失败。 | 展示失败原因和可重试建议。 |
| `cancelled` | 用户取消确认。 | 告知未写入。 |
| `denied` | Guard 阻止操作。 | 展示所需权限、当前权限或授权缺失。 |
| `preview_only` | 内容已生成但未写入。 | 展示 preview 和配置入口。 |

## Contract

- 审计事件从用户视角应尽量 append-only。
- Guard denial、用户取消和 Notion API failure 都应可审计。
- AI 触发写入必须在 `actor` 或 `source` 中与用户直接点击区分。
- 任何 audit_event 都不得包含真实 token、secret 或 API key。
