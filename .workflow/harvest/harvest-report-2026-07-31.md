# Harvest Report — P1 F4/F5 Architecture Refactor

**Date**: 2026-07-31  
**Source Artifacts**: 3 (plan-P1-ai-domain-refactor, roadmap-f4f5-refactor, analyze-ai-domain)  
**Mode**: -y (immediate, no confirmation)

---

## Summary

| Category | Extracted | Routed | Skipped (duplicate) | Skipped (resolved) |
|----------|-----------|--------|---------------------|---------------------|
| Spec (arch) | 7 | 4 | 3 | 0 |
| Spec (coding) | 4 | 2 | 2 | 0 |
| Wiki (note) | 2 | 2 | 0 | 0 |
| Issue | 3 | 1 | 1 | 1 |
| **Total** | **16** | **9** | **6** | **1** |

---

## Routed Items (9)

### Spec — arch (4 entries)

| SID | Title | File |
|-----|-------|------|
| S-20260731-deps | deps.js 中央依赖访问器替代 lazy closure 组合拳 | architecture-constraints.md |
| S-20260731-shdom | Shell + Domain Modules 拆分模式（F4 完成实例） | architecture-constraints.md |
| S-20260731-upinj | installUploadMethods 注入模式避免 upload 循环依赖 | architecture-constraints.md |
| S-20260731-pure | 纯函数提取 vs 依赖函数保留的判定准则 | architecture-constraints.md |

### Spec — coding (2 entries)

| SID | Title | File |
|-----|-------|------|
| S-20260731-batch | 批量操作 handler 必须补契约测试 | coding-conventions.md |
| S-20260731-fwdsh | UI 调用方迁移至显式 API 表面（转发壳模式） | coding-conventions.md |

### Wiki — note (2 entries)

| ID | Title | File |
|----|-------|------|
| W-ARCH-001 | verify:delivery 验证清单 | note-verify-delivery-checklist.md |
| W-ARCH-002 | 增量拆分策略 | note-incremental-split-strategy.md |

### Issue (1 entry)

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| ISS-20260731-021 | events.js bindEvents 闭包分段风险高，暂不拆散 | low | deferred |

---

## Skipped Items (7)

| ID | Title | Reason |
|----|-------|--------|
| S-F4F5-001 | Locked Decision Constraints | Duplicate: S-20260718-j5m3/8208/hazr |
| S-F4F5-002 | F4 Monolith Classification | Duplicate: S-20260731-p5wn |
| S-F4F5-003 | F5 Cycle Patterns | Duplicate: S-20260731-m8qc + S-20260718-radk |
| S-CODE-002 | Lazy Closure Retirement Pattern | Duplicate: S-20260718-radk |
| S-CODE-004 | Path Adjustment After Split | Duplicate: learned skill |
| ISS-F4F5-002 | 34 Dependent Functions Need Future Refactoring | Duplicate: ISS-20260728-016 |
| ISS-F4F5-003 | BookmarkAdapter Dual Require Fix | Resolved: commit ec3b8d4 |

---

## Notes

- Dedup rate: 43.75% (7/16 skipped) — high overlap with M2 odyssey-improve harvest entries
- All routed entries include LD-Notion instance references for traceability
- harvest-log.jsonl updated with provenance for all 16 fragments (9 routed + 7 skipped)
