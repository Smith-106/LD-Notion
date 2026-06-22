import{_ as a,o as n,c as i,a6 as t}from"./chunks/framework.wLlb4ebq.js";const c=JSON.parse('{"title":"Concepts","description":"","frontmatter":{},"headers":[],"relativePath":"concepts/index.md","filePath":"concepts/index.md"}'),e={name:"concepts/index.md"};function p(l,s,E,h,k,r){return n(),i("div",null,[...s[0]||(s[0]=[t(`<h1 id="concepts" tabindex="-1">Concepts <a class="header-anchor" href="#concepts" aria-label="Permalink to “Concepts”">​</a></h1><p>Concepts 分区用于解释 LD-Notion 的架构、路由、权限、AI 与扩展机制。使用功能页解决“怎么做”，使用这里理解“为什么这样流转”。</p><h2 id="机制地图" tabindex="-1">机制地图 <a class="header-anchor" href="#机制地图" aria-label="Permalink to “机制地图”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">mindmap</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  root((LD-Notion 机制地图))</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Routing Rules</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      来源选择</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      目标选择</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      授权状态</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      AI 配置</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      权限等级</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Import Pipeline</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      captured</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      normalized</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      guard_checked</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      enriched</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      previewed</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      written</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      audited</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      failed</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    OperationGuard</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      权限检查</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      危险确认</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      审计事件</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      撤销窗口</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    AI Agent Loop</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      observe</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      plan</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      act</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      observe</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Auth Model</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      Notion OAuth</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      Manual Token</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      本地加密保险箱</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      失效处理</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Prompt Injection Defense</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      XML 标签隔离</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      输出净化</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      UI 全局转义</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    SyncState V1/V2</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      V2 扁平结构</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      V1 facade 代理</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      自动迁移</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      写入优化</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Extension Architecture</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      userscript</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      content script</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      background service worker</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      popup</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      storage</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      remote APIs</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    UI Design System</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      design tokens</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      theme switching</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      interaction states</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      accessibility</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      responsive layout</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Module Architecture</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      UI module split (8 files)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      AI module sections (7 sections)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      UrlValidator (API key exfil protection)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      AutoImporter method decomposition</span></span></code></pre></div><h2 id="机制页用途" tabindex="-1">机制页用途 <a class="header-anchor" href="#机制页用途" aria-label="Permalink to “机制页用途”">​</a></h2><table tabindex="0"><thead><tr><th>页面</th><th>用途</th></tr></thead><tbody><tr><td><a href="/LD-Notion/concepts/routing-rules">Routing Rules</a></td><td>解释来源、目标、授权、AI 配置和权限等级如何共同决定处理路径。</td></tr><tr><td><a href="/LD-Notion/concepts/import-pipeline">Import Pipeline</a></td><td>解释内容从捕获、标准化、守卫检查、增强、预览到写入和审计的状态流。</td></tr><tr><td><a href="/LD-Notion/concepts/operation-guard">OperationGuard</a></td><td>解释写入动作前的权限、确认、审计和撤销边界。</td></tr><tr><td><a href="/LD-Notion/concepts/ai-agent-loop">AI Agent Loop</a></td><td>解释 AI 助手如何 observe、plan、act，并再次观察结果。</td></tr><tr><td><a href="/LD-Notion/concepts/auth-model">Auth Model</a></td><td>解释 Notion OAuth、manual token、本地加密保险箱和授权失败处理。</td></tr><tr><td><a href="/LD-Notion/concepts/prompt-injection-defense">Prompt Injection Defense</a></td><td>解释 AI 输入隔离、输出净化和 UI 全局转义的多层防御体系。</td></tr><tr><td><a href="/LD-Notion/concepts/syncstate-migration">SyncState V1/V2 迁移</a></td><td>解释 SyncState 从嵌套 V1 到扁平 V2 的迁移、facade 代理和写入优化。</td></tr><tr><td><a href="/LD-Notion/concepts/extension-architecture">Extension Architecture</a></td><td>解释 userscript、Chrome 扩展、构建 seam、权限和部署边界。</td></tr><tr><td><a href="/LD-Notion/concepts/design-system">UI 设计系统</a></td><td>解释设计 token、主题切换、交互状态、可访问性和响应式布局规范。</td></tr></tbody></table>`,6)])])}const o=a(e,[["render",p]]);export{c as __pageData,o as default};
