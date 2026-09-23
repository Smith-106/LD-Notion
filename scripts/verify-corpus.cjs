// scripts/verify-corpus.cjs — R2语料库 + 条款原文 + 证据包 + 关键追溯断言, mismatch即非零退出
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fail = (m) => { console.error('FAIL: ' + m); process.exitCode = 1; };
const ok = (m) => console.log('PASS: ' + m);
const D = 'D:/BaiduNetdiskDownload/系统和软件生命周期管理相关标准/系统和软件生命周期管理相关标准_md';
let sub;
try { sub = fs.readdirSync(D); } catch (e) { fail('corpus root unreadable: ' + e.message); sub = []; }
if (sub.length === 9) ok('corpus dirs = 9'); else fail('corpus dirs=' + sub.length);
let files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (f.endsWith('.md')) files.push(p); } };
walk(D);
let bytes = 0; for (const f of files) bytes += fs.statSync(f).size;
if (files.length === 27) ok('corpus md = 27'); else fail('md count=' + files.length);
if (bytes === 4282255) ok('corpus bytes = 4282255'); else fail('bytes=' + bytes);
const t12207 = fs.readFileSync(path.join(D, 'ISO 12207-15288 生命周期过程', 'ISO IEC IEEE 12207 2026.md'), 'utf8');
for (const h of ['## 6.3.5 Configuration management process', '## 6.3.8 Quality assurance process', '## 6.4.9 Verification process', '## 6.4.10 Transition process', '## 6.4.11 Validation process']) {
  if (t12207.includes(h)) ok('12207 has ' + h.slice(0, 11)); else fail('12207 missing ' + h);
}
const t25010 = fs.readFileSync(path.join(D, 'ISO 25000 SQuaRE质量模型', 'ISO IEC 25010 2023.md'), 'utf8');
for (const h of ['## 3.1', '## 3.5', '## 3.6', '## 3.7']) {
  if (t25010.includes(h)) ok('25010 has ' + h); else fail('25010 missing ' + h);
}
const evFiles = fs.readdirSync('verification-evidence');
for (const f of ['SCOPE.md', 'MAPPING.md', 'corpus-dirs.txt', 'corpus-files.txt', 'corpus-bytes.txt']) {
  if (evFiles.includes(f)) ok('evidence has ' + f); else fail('evidence missing ' + f);
}
const clauseCount = evFiles.filter((f) => f.startsWith('clause-')).length;
if (clauseCount >= 13) ok('clause excerpts = ' + clauseCount); else fail('clause excerpts=' + clauseCount);
for (const f of ['src/bridge/RSSAutoImporter.js', 'src/adapter/RSSAdapter.js', 'tests/rss-importer.test.js', 'tests/quality-rss-fullflow.test.js']) {
  if (!fs.existsSync(f)) ok('deleted ' + f); else fail('still exists ' + f);
}
const bundle = fs.readFileSync('LinuxDo-Bookmarks-to-Notion.user.js', 'utf8');
const dist = fs.readFileSync('dist/LinuxDo-Bookmarks-to-Notion.user.js', 'utf8');
if (!bundle.includes('RSSAutoImporter') && !dist.includes('RSSAutoImporter')) ok('bundle RSS refs = 0'); else fail('bundle has RSS refs');
const h1 = crypto.createHash('sha256').update(bundle).digest('hex');
const h2 = crypto.createHash('sha256').update(dist).digest('hex');
if (h1 === h2) ok('root identical dist sha256 ' + h1.slice(0, 16)); else fail('root differs from dist');
console.log(process.exitCode ? 'VERIFY-CORPUS: FAILED' : 'VERIFY-CORPUS: ALL PASS');
