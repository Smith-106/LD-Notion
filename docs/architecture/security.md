# 安全与权限

LD-Notion 同时支持用户手动操作和 AI 触发操作。为了避免自然语言误操作直接写入工作区，写入口会经过统一守卫层。

## 权限等级

| 等级 | 能力边界 | 适合场景 |
| --- | --- | --- |
| 只读 | 搜索、读取、查看详情 | 初次体验、只问不改 |
| 标准 | 创建页面、写内容、更新属性、自动分类 | 日常整理 |
| 高级 | 移动、复制、归档、数据库结构类操作 | 深度整理 |
| 管理员 | 高风险管理操作 | 确认后短期开启 |

## OperationGuard

```mermaid
flowchart TD
  Action[用户或 AI 请求操作] --> Classify[识别操作类型]
  Classify --> Read{只读?}
  Read -->|是| AllowRead[直接执行]
  Read -->|否| Permission{权限足够?}
  Permission -->|否| Deny[拒绝并提示]
  Permission -->|是| Dangerous{危险操作?}
  Dangerous -->|否| Audit[记录审计]
  Dangerous -->|是| Confirm[请求用户确认]
  Confirm -->|取消| Deny
  Confirm -->|确认| Undo[设置撤销窗口]
  Undo --> Audit
  Audit --> Execute[执行写入]
```

## 审计日志

审计日志用于回答两个问题：

1. AI 或用户刚刚做了什么。
2. 如果结果不符合预期，应该从哪一步排查。

日志可在面板中查看和清除。

## OAuth 与本地存储

- Internal Integration Token、OAuth token、AI API Key 都保存在浏览器本地存储中。
- Public OAuth 的 `Client Secret` 也会保存在本地，因此更适合个人自用。
- 「断开授权」只清除本地凭据，不会撤销 Notion 后台已经批准的授权。

## 推荐安全实践

- 日常使用保持「标准」权限。
- 危险操作确认保持开启。
- 只在需要移动、归档、数据库结构操作时临时切到「高级」。
- 不要把共享生产级 OAuth Client Secret 放进前端配置。
- 在批量操作前先对少量数据试运行。
