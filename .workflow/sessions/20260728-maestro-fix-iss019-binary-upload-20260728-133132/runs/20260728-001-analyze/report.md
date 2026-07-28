---
verdict: ready
summary: Context7 确认 Notion send endpoint 用 multipart/form-data 二进制 file field，当前 base64+JSON 实现违反契约；D1=proceed-binary。
constraints: []
decisions:
  - id: D1
    status: proposed
    text: "proceed-binary: Notion /file_uploads/{id}/send 接受 multipart/form-data 二进制（file key + part_number），非 base64 JSON。证据：developers.notion.com/reference/upload-file + Context7 /websites/developers_notion_reference (High rep)"
concerns:
  - "createMultiPartUpload 缺 number_of_parts 参数（契约要求 multi_part 模式声明），需在 plan/execute 一并补，否则可能 400。"
  - "multi_part 并发优化（契约允许 part 并发乱序）属 PERF-002/ISS-017 范畴，本 issue 不做。"
  - "file-upload 链路零专属单测（MAINT-005），改动后补契约单测归 ISS-014。"
next:
  - command: "plan step: 产出 sendFilePart 改 multipart/form-data 二进制方案 + number_of_parts 契约对齐"
details:
  code_read: "sendFilePart:906(JSON base64) / multi_part loop:1037(readAsDataURL) / uploadFileContent:931(同构二进制参照，但走 S3 预签名 URL)"
  fix_shape: "仿 931 multipart 模式，endpoint 改 Notion API + Bearer auth"
---

# Analyze — ISS-019 Notion 多分片上传 base64→二进制

## 契约确认（Context7，High reputation）

`POST /v1/file_uploads/{file_upload_id}/send`：
- **Content-Type**: `multipart/form-data; boundary={boundary}`
- **body**: multipart form，`file` key 放原始二进制文件数据，`part_number` field（1-1000，multi_part 时）
- **关键引用**: "To send file contents to Notion, use a Content-Type of `multipart/form-data` and provide file contents under the `file` key. This method is unique to this endpoint; other Notion file upload APIs use JSON parameters."

## 当前实现 vs 契约差距

| 项 | 当前 | 契约要求 | 差距 |
|----|------|---------|------|
| sendFilePart body | JSON `{data: partBase64, part_number}` | multipart/form-data `file`(binary) + `part_number` | 传输格式违反契约 |
| multi_part 编码 | readAsDataURL base64（膨胀 33%） | 原始二进制 | 体积膨胀 |
| createMultiPartUpload | 缺 `number_of_parts` | multi_part 模式须声明 `number_of_parts`(1-10000) | 契约字段缺失 |

## 同构参照

`uploadFileContent` (src/api/index.js:931-977) 已实现 multipart/form-data 二进制 body 构造（boundary + header + Uint8Array + footer + binary:true）。但它是直传 S3 预签名 URL（无 Authorization）；sendFilePart 改造后 endpoint 是 Notion API（须带 `Authorization: Bearer {apiKey}`）。

## 结论

D1 = **proceed-binary**。sendFilePart 可改为 multipart/form-data 二进制，对齐 Notion 契约。fix 风险 medium（仅 >20MB 文件触发，低频；single_part 已有同构二进制参照）。

## 产物

- `outputs/analyze-findings.json` — 契约证据 + gap 分析 + fix direction + risk
