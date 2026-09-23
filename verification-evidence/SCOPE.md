# 全面验证范围与通过准则（SCOPE）
Goal: 再次全面验证一次，参考D:\BaiduNetdiskDownload\系统和软件生命周期管理相关标准\系统和软件生命周期管理相关标准_md

## R1 全面验证（可测量清单）
- [ ] T1 语料库存在性：D盘标准_md根目录listing=9子目录；find *.md=27个；cat总字节=4282255。证据：verification-evidence/corpus-dirs.txt、corpus-files.txt、corpus-bytes.txt、corpus-sizes.txt（本仓文件，非口头断言）。
- [ ] T2 条款原文提取：12207 6.3.5/6.3.8/6.4.9/6.4.10/6.4.11、25010 3.1-3.9、27001 Scope、29148 Scope、42010 Intro、33001 Intro共13个摘录文件，共812行。证据：verification-evidence/clause-*.md。
- [ ] T3 Verification(12207 6.4.9)：npm test → Test Files 109 passed / Tests 1827 passed；Logic 40 passed；NotionOAuth全过。阈值：0 failed。
- [ ] T4 Validation(12207 6.4.11)：导出链路运行时等价验证 OPT_CREDENTIALS=include、HAS_resolveTopicId=true、MSG401=actionable、NORETRY404=true；Notion双版本+Obsidian契约对齐。
- [ ] T5 Transition(12207 6.4.10)：npm run verify:build PASS（root≡dist，sha256 c9882bad…）；npm run verify:delivery PASS（29/8/7/112/4+manifest v3）。
- [ ] T6 CM(12207 6.3.5)：git status 44 files +441/-3424；RSS 4文件已删（D×4）；resolveTopicId 18处/6文件；root/dist sha一致。
- [ ] T7 QA(12207 6.3.8)：audit-remediation/sync-payload等专项测试通过。
- [ ] T8 25010质量特性：3.1功能/3.2性能/3.3兼容/3.5可靠/3.6安全/3.7可维护逐项有测试或代码证据。
- [ ] T9 信息安全/需求追溯/架构一致性：27001 CIA、29148需求追溯（resolveTopicId）、42010分层无新增循环依赖。

## R2 参考语料库
路径：D:/BaiduNetdiskDownload/系统和软件生命周期管理相关标准/系统和软件生命周期管理相关标准_md
本信封内bash已输出：ls=9子目录；find sort=27个md全文路径；wc -l=27；cat|wc -c=4282255；grep条款行号（2601/2929/4193/4323/4493）；各条款sed摘录行数（55/30/50/50/50等）。
磁盘持久化证据：verification-evidence/ 目录（18个文件）。
