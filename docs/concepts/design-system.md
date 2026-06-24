# UI 设计系统

LD-Notion 的 UI 由三个面板组成，共享统一的设计 token 体系，支持亮色/暗色主题切换。

## 设计 Token 架构

### Token 作用域

所有 `--ldb-ui-*` token 定义在以下选择器上，确保面板内所有元素都能继承：

```css
.ldb-panel,
.ldb-notion-panel,
.gclip-panel,
.ldb-notion-float-btn,
.ldb-mini-btn,
.gclip-float-btn,
.ldb-undo-toast {
    --ldb-ui-*: ...;
}
```

### 完整 Token 列表

| Token | 亮色值 | 暗色值 | 用途 |
|-------|--------|--------|------|
| `--ldb-ui-font` | -apple-system, BlinkMacSystemFont... | (同) | 字体族 |
| `--ldb-ui-radius` | 14px | (同) | 大圆角 |
| `--ldb-ui-radius-sm` | 10px | (同) | 中圆角 |
| `--ldb-ui-radius-xs` | 8px | (同) | 小圆角 |
| `--ldb-ui-shadow` | 0 18px 55px rgba(2,6,23,0.22) | (同) | 大阴影 |
| `--ldb-ui-shadow-sm` | 0 10px 26px rgba(2,6,23,0.16) | (同) | 小阴影 |
| `--ldb-ui-text` | #0f172a | #e5e7eb | 主文本 |
| `--ldb-ui-muted` | #64748b | #9ca3af | 次要文本 |
| `--ldb-ui-border` | rgba(15,23,42,0.14) | rgba(148,163,184,0.22) | 边框 |
| `--ldb-ui-surface` | rgba(255,255,255,0.94) | rgba(17,24,39,0.92) | 主背景 |
| `--ldb-ui-surface-2` | rgba(248,250,252,0.94) | rgba(15,23,42,0.92) | 次背景 |
| `--ldb-ui-surface-3` | rgba(241,245,249,0.94) | rgba(2,6,23,0.60) | 三级背景 |
| `--ldb-ui-accent` | #2563eb | #60a5fa | 强调色 |
| `--ldb-ui-accent-2` | #7c3aed | #c4b5fd | 次强调色 |
| `--ldb-ui-success` | #16a34a | (同) | 成功色 |
| `--ldb-ui-warning` | #d97706 | (同) | 警告色 |
| `--ldb-ui-danger` | #dc2626 | (同) | 危险色 |
| `--ldb-ui-badge-teal` | #0f766e | #2dd4bf | 徽章色（teal） |
| `--ldb-ui-badge-blue` | #1d4ed8 | #93c5fd | 徽章色（blue） |
| `--ldb-ui-focus-ring` | rgba(37,99,235,0.35) | rgba(96,165,250,0.35) | 聚焦环 |
| `--ldb-ui-backdrop` | rgba(2,6,23,0.35) | rgba(0,0,0,0.45) | 遮罩 |
| `--ldb-ui-white` | #fff | (同) | 纯白（按钮文本） |

### 主题无关 Token

以下 token 主题无关，仅在亮色作用域定义一次，暗色自动继承：

| Token | 值 | 用途 |
|-------|-----|------|
| `--ldb-ui-radius-2xs` | 6px | 极小圆角 |
| `--ldb-ui-radius-md` | 12px | 中大圆角 |
| `--ldb-ui-radius-pill` | 999px | 胶囊圆角 |
| `--ldb-ui-spacing-3xs` | 2px | 间距 3xs |
| `--ldb-ui-spacing-xs` | 4px | 间距 xs |
| `--ldb-ui-spacing-sm` | 6px | 间距 sm |
| `--ldb-ui-spacing-md` | 8px | 间距 md |
| `--ldb-ui-spacing-lg` | 10px | 间距 lg |
| `--ldb-ui-spacing-xl` | 12px | 间距 xl |
| `--ldb-ui-spacing-2xl` | 14px | 间距 2xl |
| `--ldb-ui-spacing-3xl` | 18px | 间距 3xl |
| `--ldb-ui-font-size-xs` | 11px | 字号 xs |
| `--ldb-ui-font-size-sm` | 12px | 字号 sm |
| `--ldb-ui-font-size-md` | 13px | 字号 md |
| `--ldb-ui-font-size-lg` | 14px | 字号 lg |
| `--ldb-ui-font-size-xl` | 20px | 字号 xl |
| `--ldb-ui-font-size-2xl` | 22px | 字号 2xl |
| `--ldb-ui-z-index-panel` | 2147483640 | 面板层 |
| `--ldb-ui-z-index-panel-top` | 2147483641 | 面板顶层 |
| `--ldb-ui-z-index-overlay` | 2147483646 | 遮罩层 |
| `--ldb-ui-z-index-float` | 2147483647 | 浮动按钮层 |
| `--ldb-ui-warning-bright` | #f59e0b | 警告亮色（渐变起点） |
| `--ldb-ui-success-bright` | #10b981 | 成功亮色（渐变起点） |
| `--ldb-ui-danger-bright` | #ef4444 | 危险亮色（渐变起点） |
| `--ldb-ui-disabled-opacity` | 0.65 | 禁用透明度 |
| `--ldb-ui-disabled-cursor` | not-allowed | 禁用光标 |

> **硬编码消除原则**：UI 文件中的颜色、圆角、间距、字号、z-index 必须通过 `var(--ldb-ui-*)` 引用，禁止裸 `#hex`、`rgba()`、`Npx`、z-index 字面量。仅 token 定义行本身（`:root` / 面板选择器内）允许字面值。

## 主题切换

- **Auto 模式**：`prefers-color-scheme` 媒体查询自动适配系统主题
- **手动切换**：`DesignSystem.toggleTheme()` → `data-ldb-theme="dark|light"` on `[data-ldb-root]`
- **持久化**：`Storage.set(CONFIG.STORAGE_KEYS.THEME_PREFERENCE)`
- **降级**：未设置 `data-ldb-theme` 时，`@media (prefers-color-scheme: dark)` 作为回退

## 交互状态规范

所有可交互元素必须定义完整的交互状态三件套：

| 状态 | 实现方式 | 示例 |
|------|---------|------|
| `:hover` | `filter: brightness(1.08)` 或背景加深 | `.ldb-btn:hover { filter: brightness(1.08); }` |
| `:active` | `transform: scale(0.97)` 按下缩放 | `.ldb-btn:active { transform: scale(0.97); }` |
| `:focus-visible` | `box-shadow: 0 0 0 3px var(--ldb-ui-focus-ring)` | `.ldb-btn:focus-visible { ... }` |
| `:disabled` | `opacity: var(--ldb-ui-disabled-opacity); cursor: var(--ldb-ui-disabled-cursor)` | `.ldb-btn:disabled { ... }` |

### 过渡

所有交互状态变化需添加 `transition`：

```css
transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
```

## 可访问性规范

### 折叠区域

```html
<div class="ldb-toggle-section" role="button" tabindex="0"
     aria-expanded="false" aria-controls="content-id">
    标题 <span class="ldb-arrow">▶</span>
</div>
<div class="ldb-toggle-content collapsed" id="content-id">
    内容
</div>
```

- `aria-expanded` 必须与内容区折叠状态同步
- 必须支持 `Enter` 和 `Space` 键盘触发

### Tab 面板

```html
<div class="ldb-tabs" role="tablist">
    <button class="ldb-tab active" role="tab" aria-selected="true" aria-controls="panel-1">Tab 1</button>
    <button class="ldb-tab" role="tab" aria-selected="false" aria-controls="panel-2">Tab 2</button>
</div>
<div class="ldb-tab-content active" role="tabpanel" id="panel-1">Content 1</div>
<div class="ldb-tab-content" role="tabpanel" id="panel-2">Content 2</div>
```

### 减少动画

`prefers-reduced-motion: reduce` 媒体查询禁用所有 transition 和 animation：

```css
@media (prefers-reduced-motion: reduce) {
    .ldb-panel, .ldb-panel *, .ldb-btn, .ldb-spin, ... {
        transition: none !important;
        animation: none !important;
    }
}
```

## 响应式布局

三个固定宽度面板均设置了响应式回退：

```css
.ldb-panel        { width: 380px; max-width: calc(100vw - 32px); }
.ldb-notion-panel { width: 380px; max-width: calc(100vw - 32px); }
.gclip-panel      { width: 320px; max-width: calc(100vw - 32px); }
```

## CSS 工具类

| 类名 | 作用 |
|------|------|
| `.ldb-text-success` | `color: var(--ldb-ui-success)` |
| `.ldb-text-danger` | `color: var(--ldb-ui-danger)` |
| `.ldb-text-info` | `color: var(--ldb-ui-accent)` |
| `.ldb-text-muted` | `color: var(--ldb-ui-muted)` |
| `.ldb-spin` | 0.8s 无限旋转动画 |
| `.ldb-status-text` | 就地状态文本基类（`font-weight: 500`） |
| `.ldb-status-text--danger` | `color: var(--ldb-ui-danger)` |
| `.ldb-status-text--success` | `color: var(--ldb-ui-success)` |
| `.ldb-status-text--warning` | `color: var(--ldb-ui-warning)` |
| `.ldb-status-text--accent` | `color: var(--ldb-ui-accent)` |
| `.ldb-status-text--muted` | `color: var(--ldb-ui-muted)` |

> **就地状态文本 vs 全局状态栏**：`.ldb-status-text` 用于紧邻操作按钮的持久状态显示（如 Obsidian 测试连接结果、书签扩展状态），消息会一直保留直到下次操作。`UI.showStatus(message, type)` 用于全局状态栏（面板顶部 `#ldb-status-container`），消息 3-10 秒后自动清除。两者不可混用——把就地持久状态误用 `showStatus` 会导致消息被自动清除。

## 安全规范

- **所有 innerHTML 中的动态内容必须经过 `Utils.escapeHtml()`** 转义
- **状态文本着色必须使用 `.ldb-status-text--*` 语义类**，禁止内联 `style="color: var(--ldb-ui-*)"` 直接设置错误/成功文本颜色
- 使用 `textContent` 赋值是更安全的选择（如 `GenericUI.showStatus`）
- 导出操作按钮必须有 `disabled` 防重入机制
- 定时器清理：状态显示函数连续调用前必须 `clearTimeout` 旧定时器
