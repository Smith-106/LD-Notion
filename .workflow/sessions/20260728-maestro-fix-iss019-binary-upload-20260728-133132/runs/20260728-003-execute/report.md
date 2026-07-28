---
verdict: ready
summary: ISS-019 三处改造完成 + 重建验证全绿（479/479 + verify:baseline + verify:equivalence），commit 91724e6。
constraints:
  - id: C1
    status: locked
    text: "sendFilePart/createMultiPartUpload 唯一调用方是 uploadFileToNotion，已同步改造保向后兼容"
  - id: C2
    status: locked
    text: "重建 dist + cp 根 .user.js + verify 全绿 (memory refactor-rebuild-then-verify) — 已执行"
decisions:
  - id: D3
    status: proposed
    text: "sendFilePart 用独立 GM_xmlhttpRequest binary:true（不复用 NotionTransport.request 的 JSON.stringify 路径），走 Notion API endpoint + Bearer auth"
concerns:
  - "F3 multi_part 并发未做（留 ISS-017）"
  - "file-upload 契约单测未补（留 ISS-014）"
next:
  - command: "review step: 验证改造无回归 + 向后兼容"
details:
  commit: "91724e6"
  changes: "createMultiPartUpload +number_of_parts / sendFilePart multipart binary / loop 去 base64"
  verify: "479/479 vitest + verify:baseline + verify:equivalence 全 PASS"
  dist: "26563→26621 (+58 sendFilePart multipart body)"
---

# Execute — ISS-019 sendFilePart base64→二进制

## 实现（commit 91724e6）

### S1 createMultiPartUpload (src/api/index.js:898)
加 `numberOfParts` 参数，body 补 `number_of_parts`。F2 契约对齐。

### S2 sendFilePart (src/api/index.js:912)
改 multipart/form-data 二进制 body：boundary + `file` field(filename + Uint8Array) + `part_number` field + footer。`GM_xmlhttpRequest binary:true`，走 Notion API `/file_uploads/{id}/send` + `Authorization: Bearer`。FileReader.readAsArrayBuffer 取二进制（非 base64）。

### S3 uploadFileToNotion multi_part loop (src/api/index.js:1086)
删 readAsDataURL base64，直接传 partBlob；createMultiPartUpload 传 totalParts。

## 验证
- 479/479 vitest passed (22 files)
- verify:baseline PASS (node --check + legacy + UI 静态 + 锚点)
- verify:equivalence PASS (GM_api 5 / STORAGE_KEYS 85 / required constants 19 / anchors 4 / manifest MV3)
- dist 重建 26563→26621 (+58)，根 .user.js 已同步

## 不做（留 issue）
- F3 multi_part 并发 → ISS-017
- file-upload 契约单测 → ISS-014

## 产物
- src/api/index.js（commit 91724e6）+ dist/根 .user.js 重建同步
