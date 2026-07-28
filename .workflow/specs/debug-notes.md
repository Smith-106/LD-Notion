---
title: "Debug Notes"
readMode: optional
priority: medium
category: debug
keywords:
  - debug
  - issue
  - workaround
  - root-cause
  - gotcha
---

# Debug Notes

## Entries



<spec-entry category="debug" keywords="xss,security,innerhtml,domparser,post.cooked" date="2026-06-24" title="XSS 防护：不可信 HTML 用 DOMParser 解析而非 innerHTML" description="不可信 HTML 提取文本用 DOMParser 而非 innerHTML" source="debug:DBG-003" sid="S-20260718-wdrk">

### XSS 防护：不可信 HTML 用 DOMParser 解析而非 innerHTML

当需要从不可信 HTML（如 Discourse post.cooked、外部 API 返回的 HTML）中提取文本时，禁止直接 el.innerHTML = untrustedHtml（XSS 风险，脚本或事件处理器会被解析执行）。正确模式：用 DOMParser 解析后读取 textContent。实例：src/export/index.js 的 post.cooked 文本提取改为 const parser = new DOMParser(); const doc = parser.parseFromString(post.cooked || '', 'text/html'); const plainText = (doc.body.textContent || '').trim();。DOMParser 不会执行脚本或加载资源，仅构建 DOM 树供安全读取。区别于 REV-001 F6（ConfirmationDialog/UndoManager 的 innerHTML XSS 用 escapeHtml 转义变量），本模式适用于需要保留 HTML 结构语义但只要文本的场景。

</spec-entry>

<spec-entry category="debug" keywords="ssrf,security,whitelist,hostname,extension" date="2026-06-24" title="SSRF 防护：URL.hostname 精确匹配替代 includes 子串匹配" description="URL 白名单用 hostname 精确匹配防止子域名绕过" source="debug:DBG-003" sid="S-20260718-ms00">

### SSRF 防护：URL.hostname 精确匹配替代 includes 子串匹配

URL 白名单校验禁止用 hostname.includes(pattern) 或正则宽松匹配，会被 attacker.com.attacker.com 或 evil.amazonaws.com.attacker.com 等子域名绕过。正确模式：用 new URL(url) 解析后，hostname 精确等于白名单条目，或匹配 *.suffix 通配符时校验后缀边界。同时校验协议（非本地地址必须 https）和端口（非默认端口拒绝）。LD-Notion 实例：chrome-extension-full/background.js 的 isUrlAllowed 改为 const parsed = new URL(url); const host = parsed.hostname; 非本地地址要求 protocol==='https:' 且端口为空或 443，再用 ALLOWED_HOSTS.some(pattern => host===pattern || host.endsWith('.'+pattern))。

</spec-entry>

<spec-entry category="debug" keywords="error-handling,catch,pitfall,console.warn,降级" date="2026-06-24" title="空 catch 块必须补 console.warn 保留回退行为" description="空 catch 补 console.warn 记录上下文但保留回退行为" source="debug:DBG-003" sid="S-20260718-gxtm">

### 空 catch 块必须补 console.warn 保留回退行为

catch {} 空块静默吞掉错误，导致问题难以排查且违反 'Fix Dont Hide' 原则。但许多空 catch 是有意的降级处理（如 JSON 解析失败返回默认值、字符集检测失败用默认编码）。正确模式：补 console.warn 记录错误上下文，但保留原有回退返回值，不引入新的异常传播。实例：src/bridge/BookmarkExporter.js 和 src/ai/index.js 的空 catch 改为 catch (error) { console.warn('[LD-Notion] <上下文>:', error); /* 保留原回退 */ }。每个 catch 的上下文消息应说明发生了什么（如 'AI 分类失败'、'字符集检测失败'、'书签 URL 解析失败'）。禁止：为消除警告而删除 catch（会破坏降级）、或把 warn 升级为 throw（会改变行为）。

</spec-entry>

<spec-entry category="debug" keywords="guard,cwe-862,auto-sync,deletepage" date="2026-07-23" sid="S-20260723-hmah" title="危险操作经 OperationGuard 闸门不裸调" description="自动同步路径危险操作须过 Guard 闸门" source="fix/improve-odyssey-3.7.6-audit@fb76333">

### 危险操作经 OperationGuard 闸门不裸调

OperationGuard level 2 危险操作(deletePage/deleteBlock/restorePage 等)在自动同步/批量循环/定时任务路径不可绕过 Guard 直连 NotionAPI。自动同步需批量处理、ConfirmationDialog 会阻塞循环,但必须过 canExecute 权限闸门:权限不足则跳过该操作并记 guard.denied 审计,绝不裸调 NotionAPI.deletePage 等。判据:任何自动路径调 NotionAPI level2 写方法前必须有 OperationGuard.canExecute(operation) 闸门。LD-Notion 实例: BookmarkAutoImporter:390 删页归档绕 Guard (CWE-862/639),修为 canExecute 闸门+被拒跳过。

</spec-entry>

<spec-entry category="debug" keywords="ai-output,ssrf,validatepageexternalurl,cwe94,cwe918" date="2026-07-24" sid="S-20260724-22fl" title="AI 输出 URL 写 Notion external.url 须经 validatePageExternalUrl 校验" description="ISS-009 AI 输出 URL schema 校验 + DOMToNotion sibling" source="fix/improve-odyssey-iss009-ai-schema@1c0495a">

### AI 输出 URL 写 Notion external.url 须经 validatePageExternalUrl 校验

AI 返回的 icon/cover/external.url 直接写入 Notion 页面属性时,Notion 服务端会抓取 external.url 触发 SSRF(云元数据 169.254.169.254/内网穿透)。防御:所有 AI 输出 URL 经 UrlValidator.validatePageExternalUrl(http(s) 协议 + _isPrivateHost 拒 10.x/172.16-31/192.168/169.254/127/localhost)校验,非法跳过该字段不中断流程(降级策略)。同模式 sibling:DOMToNotion 把导入页面 HTML(帖子图片/附件,同样不可信)的 URL 也直写 external.url,来源不同(AI vs 帖子HTML)但同漏洞模式同触发点,修复须覆盖所有 external.url 写入点。fix_template:复用单一 URL 安全原语,AI 输出与页面导入共用,消除双实现(ISS-20260723-009 CWE-94/918)

</spec-entry>

<spec-entry category="debug" keywords="ai-output,cwe-94,ssrf,schema-validation,prompt-injection" date="2026-07-24" sid="S-20260724-ahqt" title="AI 输出 schema 校验层（CWE-94）" description="AI 输出消费防御规则（ISS-009 v3.7.8）" source="harvest:2026-07-24-odyssey-sessions">

### AI 输出 schema 校验层（CWE-94）

AI 模型返回的 JSON 结构（属性名/值/URL/emoji）经 prompt injection 可注入恶意内容，直接写入 Notion 等于把 AI 输出当可信输入。消费前必须经 schema 校验层：属性名字符集白名单 [a-zA-Z0-9_一-龥 \-] + 截断 ≤64 + 拒 Notion 保留名（title/created_time/last_edited_time 等）；值类型校验 + 长度截断（title/rich_text ≤2000、select ≤100、number isFinite + |v|<1e15）；URL 复用 UrlValidator.validatePageExternalUrl（http(s) + 拒内网/169.254/非 http(s)）。同根 SSRF sibling：凡 Notion 服务端会 fetch 的 external.url（icon/cover/embed）都须 validatePageExternalUrl，来源不同（AI 输出 vs 帖子 HTML）但同漏洞模式同触发点。来源：ISS-009 v3.7.8，src/ai/schema.js

</spec-entry>

<spec-entry category="debug" keywords="notion,file-upload,multipart,binary,sendfilepart,base64,contract" date="2026-07-28" sid="S-20260728-z7wc" title="Notion file_uploads send endpoint 用 multipart/form-data 二进制" description="Notion send endpoint multipart 契约，禁 base64 JSON" source="main@91724e6">

### Notion file_uploads send endpoint 用 multipart/form-data 二进制

Notion POST /v1/file_uploads/{id}/send endpoint 接受 multipart/form-data（unique to this endpoint；其他 Notion file upload API 用 JSON）。file field 放原始二进制文件数据，part_number field(1-1000, multi_part 时)。

反模式：sendFilePart 走 NotionAPI.request JSON 通道 {data: partBase64, part_number} — base64 字符串塞 JSON body 违反契约 + 体积膨胀 33%。

正模式：构造 multipart/form-data body（boundary + file field: filename+Uint8Array binary + part_number field + footer），GM_xmlhttpRequest binary:true，Content-Type: multipart/form-data; boundary，走 Notion API endpoint + Authorization Bearer。

关键区分：single_part 路径用预签名 upload_url 直传 S3（uploadFileContent 模式，无 Authorization）；multi_part 的 send 走 Notion API endpoint（须 Authorization Bearer）。两者都 multipart binary 但 endpoint/auth 不同。

multi_part 契约：createMultiPartUpload 须声明 number_of_parts(1-10000)，须与最终 part_number 匹配；part 可并发乱序发送（complete 前所有 part 须成功）。

来源：Context7 /websites/developers_notion_reference (High rep, Benchmark 73.95) — developers.notion.com/reference/upload-file。LD-Notion 实例：ISS-019/PERF-001 commit 91724e6。

</spec-entry>