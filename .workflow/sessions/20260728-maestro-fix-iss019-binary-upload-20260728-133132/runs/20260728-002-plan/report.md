---
verdict: ready
summary: 4 步改造方案：createMultiPartUpload 补 number_of_parts + sendFilePart 改 multipart/form-data 二进制 + loop 去 base64 + 重建验证。
constraints:
  - id: C1
    status: locked
    text: "sendFilePart 函数签名变更但 uploadFileToNotion 是唯一调用方，同步改造保向后兼容"
  - id: C2
    status: locked
    text: "每步后重建 dist + cp 根 .user.js + verify 全绿 (memory refactor-rebuild-then-verify)"
decisions:
  - id: D2
    status: proposed
    text: "sendFilePart 用独立 GM_xmlhttpRequest binary:true 走 Notion API endpoint + Bearer auth，不复用 NotionTransport.request（后者 JSON.stringify）"
concerns:
  - "F3 multi_part 并发留 ISS-017，本 plan 不含"
  - "file-upload 契约单测留 ISS-014，本 plan 不含"
next:
  - command: "execute step: 按 plan.json S1-S4 实现改造 + 重建 dist + verify 全绿"
details:
  steps: "S1 number_of_parts / S2 sendFilePart multipart binary / S3 loop 去 base64 + 传 numberOfParts / S4 重建验证"
  body_construction: "boundary=crypto.getRandomValues hex; header+file Uint8Array+part_number field+footer 拼接"
---

# Plan — ISS-019 sendFilePart base64→二进制

## 方案（基于 analyze D1 proceed-binary 契约）

### S1 createMultiPartUpload 补 number_of_parts (F2)
`src/api/index.js:896-903` — 加 `numberOfParts` 参数，body 补 `number_of_parts`。Context7 OpenAPI: multi_part 须声明且匹配最终 part_number。

### S2 sendFilePart 改 multipart/form-data 二进制 (F1)
`src/api/index.js:906-911` — 新签名 `sendFilePart(uploadId, partBlob, partNumber, apiKey, filename)`：
- 构造 multipart body: boundary + `file` field(filename + Uint8Array binary) + `part_number` field + footer
- `GM_xmlhttpRequest` `binary:true`, `Content-Type: multipart/form-data; boundary`
- endpoint `/file_uploads/{id}/send` + `Authorization: Bearer apiKey`
- 仿 `uploadFileContent:931` 模式，但走 Notion API + Bearer（非 S3 预签名）

### S3 uploadFileToNotion multi_part loop 去 base64 (F1+F2)
`src/api/index.js:1028-1054` — `createMultiPartUpload` 传 `totalParts`；循环删 `readAsDataURL`，直接传 `partBlob` 给 `sendFilePart`；传 `filename`。

### S4 重建 + 验证
`node build.js` → cp dist → 根 `.user.js` → `verify:baseline` + `verify:equivalence`。

## 不做
- F3 multi_part 并发 → ISS-017
- file-upload 契约单测 → ISS-014

## 产物
- `outputs/plan.json` — 完整 4 步改造方案 + body 构造细节 + 验收标准
