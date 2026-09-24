"use strict";
// v3.16.2 验收脚本: GitHub Device Flow 无需回调地址(与 Notion 对照)。
// 用法: node scripts/verify-github-no-callback.js (exit 0 = 通过)
// 断言:
//   R1: src/auth/github-oauth.js 全文件零 "redirect"(大小写不敏感)出现,
//       且 Device Flow 三步参数齐备(client_id/device_code/user_code/grant_type device_code);
//   R2: Notion 双窗口修复注释存在(src/auth/index.js)+ 共享回调 oauth-callback 存在,
//       GitHub 侧仅单次 window.open(verificationUri) 且无 location 跳转 fallback;
//   R3: 面板答疑文案(src/ui/panel-template.js)+ 文档说明(docs/integrations/github.md)均包含"随便填"回调表述。
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let failures = [];
const check = (name, cond, detail = "") => {
    if (cond) console.log(`[PASS] ${name}`);
    else { console.log(`[FAIL] ${name} ${detail}`); failures.push(name); }
};

// R1
const oauth = read("src/auth/github-oauth.js");
check("R1: github-oauth.js zero redirect", !/redirect/i.test(oauth));
check("R1: device flow params", /client_id: clientId/.test(oauth)
    && /dc\.device_code/.test(oauth) && /dc\.user_code/.test(oauth)
    && /grant-type:device_code/.test(oauth));

// R2
const notionAuth = read("src/auth/index.js");
check("R2: notion double-window fix comment", /双授权窗口修复/.test(notionAuth));
check("R2: notion shared callback", notionAuth.includes("LD-Notion/oauth-callback"));
const aiBindings = read("src/ui/events/ai-bindings.js");
const ghOpenIdx = aiBindings.indexOf("window.open(verificationUri");
check("R2: github single window.open, no fallback", ghOpenIdx !== -1
    && !/window\.location\.href\s*=\s*authUrl/.test(aiBindings));

// R3
const panel = read("src/ui/panel-template.js");
check("R3: panel copy", panel.includes("随便填一个 https 地址")
    && panel.includes("不会出现双回调窗口"));
const doc = read("docs/integrations/github.md");
check("R3: docs copy", doc.includes("Callback URL 随便填")
    && /不发送 `redirect_uri`/.test(doc));

if (failures.length) { console.log(`RESULT: FAIL (${failures.length})`); process.exit(1); }
console.log("RESULT: all passed");
