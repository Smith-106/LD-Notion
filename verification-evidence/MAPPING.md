# 标准条款 → 项目证据追溯矩阵（MAPPING）
语料库：D:/BaiduNetdiskDownload/系统和软件生命周期管理相关标准/系统和软件生命周期管理相关标准_md
语料库指纹：9子目录（corpus-dirs.txt）/ 27个md（corpus-files.txt）/ 4282255字节（corpus-bytes.txt，明细corpus-sizes.txt）。
条款摘录：verification-evidence/clause-*.md 共13个文件812行（行数见下）。

| # | 标准条款（原文要点） | 摘录证据 | 项目证据（本仓文件） | 判定 |
|---|---|---|---|---|
| M1 | 12207 6.4.9 Verification：Purpose "provide objective evidence … fulfils specified requirements"；NOTE1 "product is built right"；Outcomes a–g（含e客观证据、g可追溯性） | clause-12207-6.4.9-verification.md（55行，原L4193–4247） | result-npm-test.txt：Test Files 109 passed / Tests 1827 passed；Logic 40 passed 0 failed；NotionOAuth全过。阈值0 failed | PASS |
| M2 | 12207 6.4.10 Transition：Purpose "establish capability … in operational environment"；NOTE3 releases经transition、记账经CM | clause-12207-6.4.10-transition.md（30行，原L4323–4352） | result-verify-build.txt：7项PASS，root≡dist（sha256 c9882bad6961…）；result-verify-delivery.txt：29常量/8剪枝/7 GM_api/112 STORAGE_KEYS/4锚点/manifest v3；result-bundle-sha.txt双份sha一致（1785659B） | PASS |
| M3 | 12207 6.4.11 Validation：Purpose "when in use … business/mission objectives … stakeholder needs"；NOTE2 "right product is built"；Outcomes a–h | clause-12207-6.4.11-validation.md（50行，原L4493–4542） | result-export-chain.json：OPT_CREDENTIALS=include，HAS_resolveTopicId=true，MSG401=actionable，NORETRY404=true；result-notion-version.txt：2022-06-28＋2026-03-11×2；result-obsidian-contract.txt：vault/＋Bearer＋validateObsidianUrl＋_safeVaultPath；result-docscheck.txt：notion-versioning.html 445069B / obsidian-readme 30297B / obsidian-rest 933B | PASS |
| M4 | 12207 6.3.5 CM：Purpose "consistency, integrity, traceability, and control"；Outcomes a–f（含基线维护、变更控制、状态可知、release批准） | clause-12207-6.3.5-cm.md（50行，原L2601–2650） | result-git-status.txt：44 files变更（4×D为RSS删除）；result-git-stat.txt：+441/-3424；result-rss-deletion.txt：4文件No such file；result-rss-bundle.txt：root/dist计数0/0；result-trace-count.txt：18；result-trace-files.txt：6文件；result-bundle-sha.txt | PASS |
| M5 | 12207 6.3.8 QA：Purpose "confidence that quality requirements are fulfilled"；Outcomes a–e | clause-12207-6.3.8-qa.md（50行，原L2929–2978） | result-npm-test.txt全绿（含audit-remediation 37/sync-payload 14等专项，0 failed） | PASS |
| M6 | 25010 3.1功能适合性（completeness/correctness/appropriateness）＋3.2性能效率（time behaviour/resource utilization/capacity） | clause-25010-3.1-3.2.md（64行） | adapter-contract＋reconcile 52用例通过；fetch 15s超时＋指数退避1000*2^i；401/403/400短路不重试 | PASS |
| M7 | 25010 3.3兼容性（co-existence/interoperability）＋3.4交互能力（3.4.1–3.4.8） | clause-25010-3.3-3.4.md（120行） | Notion双版本写入＋Obsidian vault/Bearer契约（result-notion-version.txt / result-obsidian-contract.txt）；UI可操作性测试通过 | PASS |
| M8 | 25010 3.5可靠性（faultlessness/availability/fault tolerance/recoverability）＋3.6安全性（confidentiality/integrity/non-repudiation/accountability/authenticity/resistance） | clause-25010-3.5-3.6.md（105行） | 401可行动提示、404不重试、失败快照保留（BookmarkAutoImporter用例）；audit-remediation 37用例；token脱敏、UrlValidator、BLACKLIST硬拦截 | PASS |
| M9 | 25010 3.7可维护性（modularity/reusability/analysability/modifiability/testability）＋3.8灵活性（adaptability/scalability/installability/replaceability）＋3.9安全 | clause-25010-3.7-3.9.md（113行） | extract/adapter/export/import/ui分层，无新增循环依赖；44文件变更+441/-3424可控；单文件bundle＋双扩展形态保留 | PASS |
| M10 | 27001：0.1 "preserves confidentiality, integrity and availability … risk management"；Scope含风险评估与处置要求 | clause-27001-scope.md（40行） | 敏感凭证GM明文存储＋审计脱敏；鉴权失败在Guard前阻止写入；内网/169.254拦截 | PASS |
| M11 | 29148：Scope统一需求工程过程＋必需信息项/内容/格式；适用于15288/12207项目 | clause-29148-scope.md（40行） | resolveTopicId统一口径18处/6文件（result-trace-*.txt）；需求→用例→测试用例可追溯 | PASS |
| M12 | 42010：AD协助理解structure/behaviour/evolution；AD元素一致性/对应关系可查 | clause-42010-intro.md（50行） | src分层（extract/adapter/export/import/ui/config/security/storage）与docs/architecture一致；无新增跨模块循环依赖边 | PASS |
| M13 | 33001：基于实施过程产生的客观证据评估过程质量特性；评估结果用于改进/基准/风险识别 | clause-33001-intro.md（45行） | 本矩阵＋verification-evidence/全量文件即客观证据包；npm/verify三链全绿为过程能力证据 | PASS |

总体：M1–M13全部PASS；T1–T9（SCOPE.md）全部满足。本文件与SCOPE.md、corpus-*.txt、clause-*.md、result-*.txt/json共同构成完整证据包络。
