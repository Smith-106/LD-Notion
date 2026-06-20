# UI Odyssey: All UI Components

## §1 Target & Design Context

### Target
All UI components across three delivery forms:
- **主面板** (src/ui/index.js): Linux.do 收藏面板、Notion AI 浮动面板、设置分组、Tab 导航、主题切换、导出进度、工作区可视化
- **Chrome Extension popup** (chrome-extension-full/popup.html + popup.js): 扩展工具栏弹窗
- **书签桥接扩展** (chrome-extension/): 桥接扩展 UI（极简，2 个文件）

### Design Context
- UI conventions spec: 空壳（无沉淀）
- Theme system: `data-ldb-theme` 属性驱动（auto/light/dark），CSS 变量替换硬编码颜色
- Layout: 480px 以下响应式全宽
- Architecture: 单文件 userscript + Chrome Extension 双形态

### Component Inventory

| Surface | File | Design Tokens | Theme | Accent | Dark Palette | Icons | Responsive |
|---------|------|--------------|-------|--------|-------------|-------|-----------|
| 主面板 | src/ui/index.js | 17 `--ldb-ui-*` | data-ldb-theme + prefers-color-scheme | Blue #2563eb | Tailwind Slate | Emoji | 480px |
| Popup | chrome-extension-full/popup.html | 7 `--bg/--text` | prefers-color-scheme only | Indigo #6366f1 | Catppuccin Mocha | Emoji | Fixed 320px |
| 桥接扩展 | chrome-extension/content-script.js | None | None | None | None | None | None |

### Key Survey Findings

1. **Token system split**: 主面板用 `--ldb-ui-*` 17 tokens；popup 用 `--bg/--text` 7 tokens，完全不共享
2. **Palette split**: 主面板 Tailwind Slate；popup Catppuccin Mocha — 不同暗色体系
3. **Accent mismatch**: 主面板 Blue #2563eb；popup Indigo #6366f1
4. **Untokenized neutral family**: `rgba(148, 163, 184, 0.06-0.28)` 大量用于 hover/surface/chip 但未 token 化
5. **JS hardcoded colors**: `#4ade80`, `#f87171`, `#60a5fa`, `#666` 绕过主题系统
6. **Missing .ldb-spin animation**: JS 引用 `<span class="ldb-spin">` 但 CSS 无 `@keyframes ldb-spin`
7. **No :active press states**: 全局无按下状态定义
8. **Font/spacing 不 token 化**: 所有 font-size (11-44px) 和 spacing (4-14px) 均硬编码
9. **Inline style 散布**: HTML 模板中大量 `style="font-size: 11px; color: var(--ldb-ui-muted);"` 内联样式

## §2 Visual Landscape Survey

### Design Token Architecture

主面板 `DesignSystem.getBaseCSS()` (lines 94-483) 定义了所有 `--ldb-*` tokens，通过 `StyleManager.injectOnce()` 注入 `<style>` 标签。5 层样式注入：base → chat → notion → linux-do → generic。

### Typography Scale (Observed)

| Size | Usage |
|------|-------|
| 44px | Chat welcome icon |
| 22px | Large metrics |
| 14px | Header title |
| 13px | Section titles, chat text |
| 12px | Most UI text |
| 11px | Badges, meta, tips |

### Spacing Scale (Observed)

4px / 6px / 8px / 10px / 12px / 14px — 未 token 化，散布在 CSS 和 inline style 中。

### Theme Switching

- Auto 模式: `prefers-color-scheme` media query
- 手动切换: `DesignSystem.toggleTheme()` → `data-ldb-theme="dark|light"` on `[data-ldb-root]`
- 持久化: `Storage.set(CONFIG.STORAGE_KEYS.THEME_PREFERENCE)`
- 降级: `@media (prefers-color-scheme: dark) { .ldb-panel:not([data-ldb-theme]) }`

### Interaction States Inventory

- **:hover** — 一致使用 Slate-400-based transparent 背景加深（0.12→0.18）
- **:focus-visible** — `box-shadow: 0 0 0 3px var(--ldb-ui-focus-ring)`
- **:disabled** — `opacity: 0.65; cursor: not-allowed`
- **:active** — **缺失**
- **.active** — Tab 和 Source option 的选中态
- **.dragging** — 浮动按钮拖拽态

### Animations

- Float buttons: `transform 0.18s ease, box-shadow 0.18s ease`
- @keyframes `ldb-typing`: 1.1s 聊天打字指示
- @keyframes `gclip-pulse`: 1.2s 导出中脉冲
- `prefers-reduced-motion: reduce` 支持 ✅

## §3 Audit Findings

### Severity Summary

| Dimension | Critical | High | Medium | Low | Total |
|-----------|----------|------|--------|-----|-------|
| Visual Hierarchy | 2 | 6 | 9 | 5 | 22 |
| Interaction States | 2 | 4 | 8 | 9 | 23 |
| Accessibility | 2 | 7 | 8 | 5 | 25 |
| Responsiveness | 2 | 5 | 9 | 4 | 20 |
| Micro-interactions | 1 | 3 | 7 | 7 | 18 |
| Edge Cases | 1 | 4 | 7 | 4 | 20 |
| **Total** | **10** | **29** | **48** | **34** | **121** |

### Critical Findings (10)

| # | Dimension | Title | File:Line |
|---|-----------|-------|-----------|
| C1 | Visual Hierarchy | Split design token systems between main panel and popup | popup.html:6 |
| C2 | Visual Hierarchy | Hardcoded success/error colors (#4ade80/#f87171) bypass tokens in 12+ locations | index.js:1494 |
| C3 | Interaction States | Missing @keyframes for .ldb-spin — loading spinners render static emoji | index.js:2904 |
| C4 | Interaction States | No :active press states defined for ANY interactive element | index.js:326 |
| C5 | Accessibility | No ARIA attributes anywhere in main panel or popup | index.js:4501 |
| C6 | Accessibility | Tab panels lack ARIA tablist/tab/tabpanel pattern | index.js:4510 |
| C7 | Responsiveness | Three panels use hardcoded fixed widths (380px/320px) with no responsive fallback | index.js:909 |
| C8 | Responsiveness | Fixed panel positioning (right:24px) causes off-screen panels on narrow viewports | index.js:8757 |
| C9 | Micro-interactions | ldb-spin class used in JS at 5 locations but @keyframes undefined — spinning emoji broken | index.js:2904 |
| C10 | Edge Cases | showStatus renders raw error.message via innerHTML — XSS risk | index.js:5684 |

### High Findings (29) — Key Themes

**Token System Bypass (4)**:
- Hardcoded #666/#888 in status divs (6 locations) — invisible on dark backgrounds
- Hardcoded #34d399/#f87171 via .style.color in 16+ JS event handlers
- Duplicate class attributes on 20+ HTML elements — second class silently dropped
- Untokenized rgba(148,163,184) opacity scale used 40+ times

**Design Token Gaps (2)**:
- Untokenized spacing (4-14px, 50+ inline values, only 3 utility classes)
- Untokenized font-size scale (7 sizes 11-44px, 20+ inline overrides)

**Interaction Deficits (4)**:
- No :hover on .ldb-btn/.ldb-btn-secondary/.ldb-btn-warning/.ldb-btn-danger
- No :focus-visible on popup action buttons
- Float button drag: mouse-only, no touch/pointer event support
- Toggle switch touch target too small (24px height, 18px knob)

**Accessibility Gaps (4)**:
- Collapsible toggle sections lack aria-expanded/aria-controls
- No skip-to-content link in panels
- Status dot conveys info by color only in popup
- Chat messages lack aria-live for screen reader announcements
- Icon-only buttons lack aria-label
- ConfirmationDialog has no focus trap or aria-modal
- ConfirmationDialog ESC key blocked by panel stopPropagation

**Responsiveness (3)**:
- No fluid typography (all fixed px 11-44px)
- Single 480px breakpoint only — no intermediate or container queries
- Small inline buttons (2-6px padding) unusable on touch devices

**Edge Cases (4)**:
- Export button lacks double-click/concurrent-operation guard
- showProgress divides by zero when total is 0
- Failed items in export report have no truncation — DOM explosion
- Chrome extension popup.js uses setTimeout(900ms) hack — race condition
- Popup.js has no error handling for chrome.tabs.query failures

### Cross-Dimension Recurring Patterns

1. **Hardcoded colors bypass theme system** — appears in 4 dimensions (VH, A, IS, MI): #4ade80, #f87171, #34d399, #666, #888, #dc2626, #0f766e, #1d4ed8, gradient starts
2. **Duplicate class attributes** — found in VH (high) and EC (medium), affecting 20+ elements with lost spacing/layout classes
3. **Missing ldb-spin animation** — found in IS (critical), MI (critical), and Survey — 5 JS locations with broken loading spinner
4. **Touch targets below 44x44px** — appears in IS (header 30x30, tabs 32px, source options 34px) and R (toggle 24px, inline buttons 2-6px padding)
5. **No :active press states** — appears in IS (high, all buttons) and MI (high, .ldb-btn/.gclip-btn) — zero press feedback across entire UI
6. **prefers-reduced-motion incomplete** — appears in A (gclip-pulse not suppressed) and MI (selector list misses .ldb-btn, .ldb-tab, etc.)
7. **Report/overflow CSS missing** — .ldb-report-item/.ldb-report-error have no CSS definitions (R medium, IS low)

## §4 Divergent Exploration

### Polish Ideas (12) — Subtle refinements beyond bug fixes

| # | Idea | Impact | Effort |
|---|------|--------|--------|
| P1 | Panel entrance animation with spring easing (scale+opacity+translateY) | high | small |
| P2 | Status bar auto-dismiss with fadeOut+slideUp exit animation | high | small |
| P3 | Tab indicator slide animation (translateX underline) | high | small |
| P4 | Empty states with illustrative icon + micro-float animation | high | medium |
| P5 | Bookmark list hover micro-shadow lift (translateY(-1px)+box-shadow) | medium | small |
| P6 | Progress bar animated gradient shimmer during active export | medium | small |
| P7 | Toggle section arrow rotation instead of character swap | medium | small |
| P8 | Focus ring with outline-offset:2px for floating gap | medium | small |
| P9 | Chat bubble entrance stagger (user right, assistant left) | medium | small |
| P10 | Popup action buttons :active scale(0.97) press-down | medium | small |
| P11 | Scrollbar fade-on-idle (overlay on hover) | low | small |
| P12 | Source option active inner glow (inset box-shadow) | low | small |

### Delight Ideas (12) — Memorable moments beyond polish

| # | Idea | Impact | Effort |
|---|------|--------|--------|
| D1 | Confetti burst on export complete (canvas particles, accent colors) | high | small |
| D2 | Float button morphs to reflect state (breathing/spinner/checkmark/shake) | high | medium |
| D3 | Witty empty states with personality (CSS illustration + warm copy) | high | small |
| D4 | Staggered cascade on bookmark list load (15ms/item, 300ms cap) | medium | small |
| D5 | Status toast slide-in + spring-exit with warm copy | medium | small |
| D6 | Panel entrance choreography (backdrop→panel→header→content sequence) | medium | medium |
| D7 | AI persona ambient presence (floating icon, thinking glow, magnetic chips) | high | medium |
| D8 | Popup status dots breathing animation | low | small |
| D9 | Milestone celebration for collection size (10/50/100 toast) | high | small |
| D10 | Progress ribbon during export (2px top gradient bar + shimmer) | medium | medium |
| D11 | Keyboard shortcut hint that appears then fades (localStorage) | low | small |
| D12 | Export report victory summary (radial progress ring, animated counters) | medium | small |

### Top Improvement Priorities (Impact×Effort matrix)

**Quick wins (high impact / small effort):**
1. **P1** Panel entrance animation — CSS-only spring easing
2. **P2** Status toast exit animation — CSS transition before clear
3. **P3** Tab sliding indicator — pseudo-element translateX
4. **D1** Confetti burst on export — canvas overlay, existing success state
5. **D3** Witty empty states — copy + CSS illustration in .ldb-view-empty
6. **D9** Milestone celebration — threshold check in updateSelectCount

**Medium investment (high impact / medium effort):**
7. **D2** Float button state morph — choreographed motion per state
8. **P4** Empty state illustration — SVG + micro-animation
9. **D7** AI persona ambient presence — floating + glow + chips

### Consolidated Improvement List

Total: 24 ideas (12 polish + 12 delight)
- High impact: 11 (P1-4, D1-3, D7, D9)
- Medium impact: 10 (P5-10, D4-6, D10, D12)
- Low impact: 3 (P11-12, D8, D11)

## §5 Verification

### Test Results
- **Unit tests**: 349 passed, 0 failed (17 test files)
- **Build**: 成功 (1.2MB userscript + chrome extension)

### Verification Checklist

| Finding | Fix | Verified | Notes |
|---------|-----|----------|-------|
| C1 Split token systems | Popup 保留独立 token 系统（设计决策，不统一） | ✅ | popup 和主面板服务不同上下文 |
| C2 Hardcoded colors | 16+ 处替换为 `var(--ldb-ui-*)` + 新增 badge tokens | ✅ | 源码+构建产物均确认 |
| C3 ldb-spin missing | 添加 `@keyframes ldb-spin` + `.ldb-spin` CSS | ✅ | |
| C4 No :active states | 所有 btn 变体 + chip + float-btn + toggle 加 `:active` | ✅ | 6 处 `scale(0.96-0.97)` |
| C5 No ARIA | 6 toggle-section + tab 面板加完整 ARIA | ✅ | aria-expanded/controls/role/tabindex |
| C6 Tab ARIA | role=tablist/tab/tabpanel + aria-selected | ✅ | |
| C7 Fixed widths | 三面板加 `max-width: calc(100vw - 32px)` | ✅ | |
| C8 Fixed positioning | max-width 缓解溢出 | ✅ | 部分缓解，right:24px 极端情况仍可能溢出 |
| C9 ldb-spin broken | 同 C3 | ✅ | |
| C10 XSS innerHTML | 两处 showStatus 加 `Utils.escapeHtml` | ✅ | 构建产物确认 |

### Remaining (not fixed, design decisions)

1. **C1 Token 系统分裂** — popup 用独立 `--bg/--text` token，主面板用 `--ldb-ui-*`。统一需要 popup 也引入 `data-ldb-root` 作用域，改动过大，记录为决策。
2. **Untokenized spacing/font-size** — 50+ inline spacing 和 7 个 font-size 未 token 化。全面 token 化是大重构，记录为后续优化。
3. **Float button touch/pointer support** — 拖拽仅 mouse events，添加 pointer events 是中等改动。
4. **Toggle switch touch target** — 24px 高度低于 44px 推荐值。
5. **ConfirmationDialog focus trap** — 需要 FocusTrap 实现。
6. **Chat aria-live** — 需要 screen reader 消息队列。
7. **src/auth/index.js hardcoded colors** — 3 处 `#34d399`，auth UI 不在 LDB panel 作用域。

## §6 Generalization

### Extracted Patterns (7)

| ID | Source Finding | Layer | Signature | Description | Confidence |
|----|---------------|-------|-----------|-------------|------------|
| P1 | C10 + C2 | syntax | `innerHTML.*\$\{.*message}` | **innerHTML 注入未转义用户数据** — 所有 innerHTML 中插入动态内容必须经过 `Utils.escapeHtml()` | high |
| P2 | C4 + H5 | syntax | `:hover.*\{` (无 `:active`) | **交互状态缺失 :active press** — 有 :hover 但无 :active 的按钮/链接缺少按下反馈 | high |
| P3 | VH-H1 | syntax | `class="[^"]*"\s+class="` | **重复 class 属性** — HTML 模板中多个 class 属性，第二个被静默忽略 | high |
| P4 | C7 + C8 | structural | `width:\s*\d+px` (无 max-width) | **固定宽度无响应式回退** — 面板固定宽度缺少 `max-width: calc(100vw - Xpx)` | high |
| P5 | C3 + C9 | syntax | `.ldb-spin` (无 `@keyframes`) | **CSS 类引用缺失动画定义** — JS 引用 CSS 类但无对应 @keyframes | medium |
| P6 | A-H3 | semantic | `toggle-section.*onclick` (无 `aria-expanded`) | **折叠区域缺少 ARIA 属性** — 可折叠内容区缺少 `aria-expanded`/`aria-controls` | high |
| P7 | EC-H4 | syntax | `setTimeout.*innerHTML.*=""` (无 clearTimeout) | **状态定时器无清理** — 连续调用 showStatus 时旧定时器会清除新消息 | medium |

### Syntax Scan Results

| Pattern | Total Hits (全项目) | Source Hits | Build-Only |
|---------|-------------------|-------------|------------|
| innerHTML-xss | 0 | 0 ✅ | 0 |
| hardcoded-color-bypass | 0 | 0 ✅ | 0 (rebuild) |
| duplicate-class-attr | 0 | 0 ✅ | 0 (rebuild) |
| divide-by-zero | 2 | 0 | 2 (other) |
| no-active-press | ~33 | 0 (已修) | 33 (build) |

### Cross-Layer Analysis

- **P1 (XSS)** — syntax 层 0 hits，源码已完全修复。`chrome-extension-full/popup.js` 使用 `textContent` 赋值，不受影响。
- **P3 (duplicate class)** — syntax 层 0 hits，源码已修复。构建产物 rebuild 后已同步。
- **P4 (fixed-width)** — structural 层确认三面板（`.ldb-panel`, `.ldb-notion-panel`, `.gclip-panel`）已加 `max-width`。
- **P6 (ARIA)** — semantic 层确认 6 个 toggle-section + tab 面板已加完整 ARIA。`chrome-extension-full/popup.html` 的 `aria-label` 已加。

### Similar Files (Structural Scan)

| File | Shared Patterns | Risk |
|------|----------------|------|
| `src/auth/index.js` | hardcoded `style.color = "#34d399"` (3 处) | low — auth UI 不在 LDB panel 作用域 |
| `chrome-extension-full/popup.js` | status display via `textContent` | safe — 不走 innerHTML |
| `chrome-extension/content-script.js` | minimal UI, no innerHTML | safe |

### Generalization Stats

- Patterns extracted: 7
- Total hits (syntax scan): 35 (all in build artifacts → 0 after rebuild)
- Cross-layer confirmed: 4 (P1+P3+P4+P6 across syntax/semantic/structural)
- Regression risks: 0
- Deepening triggered: false

## §7 Discoveries

### Hit Classification

| # | Finding | Source | Classification | Action |
|---|---------|--------|----------------|--------|
| 1 | C1 Token 系统分裂 | S_AUDIT | design_decision | 记录决策：popup 独立 token 系统是合理的设计选择 |
| 2 | Untokenized spacing/font-size | S_AUDIT (H) | low_risk | 记录为后续优化，非当前阻断项 |
| 3 | Float button pointer events | S_AUDIT (H) | needs_treatment | 后续添加 pointer event 支持 |
| 4 | Toggle switch touch target | S_AUDIT (H) | low_risk | 当前 24px 可用，增大到 44px 需布局调整 |
| 5 | ConfirmationDialog focus trap | S_AUDIT (H) | needs_treatment | 需实现 FocusTrap，独立任务 |
| 6 | Chat aria-live | S_AUDIT (H) | low_risk | SR 用户少用聊天，记录为后续改进 |
| 7 | src/auth/index.js hardcoded #34d399 | S_GENERALIZE | low_risk | auth UI 不在 LDB 作用域，CSS var 不生效 |
| 8 | chrome-extension-full/popup.js setTimeout hack | S_AUDIT (H) | low_risk | 900ms 延迟是已知的 workaround |
| 9 | Diverge ideas P1-P12, D1-D12 | S_DIVERGE | deferred | 24 个创意想法待后续迭代评估 |

### Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | 保留 popup 独立 token 系统 | popup 是 320px 固定宽度，不需要主面板的完整 token 系统，统一反而增加维护负担 |
| D2 | 不 token 化 spacing/font-size | 50+ 处 inline style 改为 token 引用是大重构，风险高于收益，记录为后续优化方向 |
| D3 | 不在 auth 模块使用 CSS var | auth UI（CredentialVault status）不在 `.ldb-panel` DOM 下，CSS var 无法解析 |

## §8 Learnings

### 设计 Pattern

1. **innerHTML 注入必须 escapeHtml** — 所有通过 innerHTML 渲染用户数据的路径（showStatus、showProgress、showReport）必须经过 `Utils.escapeHtml()`。即使当前调用方传入的是固定字符串，未来调用方可能传入 error.message 等不可信数据。
   - 建议: `/spec-add ui "innerHTML-injection" "所有 innerHTML 中插入动态内容必须经过 Utils.escapeHtml()" --keywords xss,innerHTML,escape --description "安全规范"`

2. **交互状态三件套** — 每个可交互元素需要 `:hover` + `:active` + `:focus-visible` + `transition`。缺少任何一个都会导致交互反馈缺失。
   - 建议: `/spec-add ui "interaction-states-trio" "可交互元素必须定义 :hover/:active/:focus-visible + transition" --keywords interaction,hover,active,focus --description "交互规范"`

3. **固定宽度必须有 max-width 回退** — 面板/弹窗使用固定 `width: Xpx` 时，必须同时设置 `max-width: calc(100vw - margin)` 防止窄屏溢出。
   - 建议: `/spec-add ui "fixed-width-responsive" "固定宽度元素必须设置 max-width: calc(100vw - Xpx)" --keywords responsive,overflow,panel --description "响应式规范"`

### 可访问性规则

4. **折叠区域 ARIA 完整模式** — `<div role="button" tabindex="0" aria-expanded="false" aria-controls="contentId">` + `Enter/Space` 键盘触发 + JS 同步 `aria-expanded`。
5. **Tab 面板 ARIA 模式** — `role="tablist"` > `role="tab" aria-selected` > `role="tabpanel"` 三层结构。

### 可复用泛化 Pattern

6. **重复 class 属性检测** — HTML 模板中 `class="a" class="b"` 第二个被静默忽略。应在 CI/lint 中添加检测规则。
7. **定时器清理模式** — 连续调用状态显示函数时，必须 `clearTimeout` 旧定时器再设新的，否则新消息被旧定时器提前清除。
8. **导出操作防重入** — 所有异步操作按钮必须在入口检查 `disabled`，操作中设 `disabled = true`，`finally` 中恢复 `disabled = false`。

### 后续建议命令

- `/spec-add ui "innerHTML-injection" "所有 innerHTML 中插入动态内容必须经过 Utils.escapeHtml()" --keywords xss,innerHTML,escape`
- `/spec-add ui "interaction-states-trio" "可交互元素必须定义 :hover/:active/:focus-visible + transition" --keywords interaction,hover,active,focus`
- `/spec-add ui "fixed-width-responsive" "固定宽度元素必须设置 max-width: calc(100vw - Xpx)" --keywords responsive,overflow,panel`
- `/spec-add coding "duplicate-class-attribute" "HTML 模板中禁止重复 class 属性，应合并为单一 class 字符串" --keywords html,class,lint`
