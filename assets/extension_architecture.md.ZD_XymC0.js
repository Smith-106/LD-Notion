import{_ as a,o as n,c as i,a6 as e}from"./chunks/framework.wLlb4ebq.js";const k=JSON.parse('{"title":"Chrome Extension Architecture","description":"","frontmatter":{},"headers":[],"relativePath":"extension/architecture.md","filePath":"extension/architecture.md"}'),t={name:"extension/architecture.md"};function l(r,s,p,h,o,d){return n(),i("div",null,[...s[0]||(s[0]=[e(`<h1 id="chrome-extension-architecture" tabindex="-1">Chrome Extension Architecture <a class="header-anchor" href="#chrome-extension-architecture" aria-label="Permalink to “Chrome Extension Architecture”">​</a></h1><p>LD-Notion 有两种运行形态：Tampermonkey 用户脚本和独立 Chrome 扩展。两者共享核心能力，但浏览器权限、存储和跨域请求边界不同。</p><h2 id="boundary-diagram" tabindex="-1">Boundary diagram <a class="header-anchor" href="#boundary-diagram" aria-label="Permalink to “Boundary diagram”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">flowchart TB</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph Page[Web page]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    DOM[Host DOM]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Panel[LD-Notion Panel]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph UserScript[Tampermonkey mode]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    GM[GM_* APIs]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Script[LinuxDo-Bookmarks-to-Notion.user.js]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph Extension[Chrome extension mode]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Content[content script]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Background[background service worker]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Popup[popup]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Storage[chrome.storage.local / vault payload]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph External[External APIs]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Notion[Notion API]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    GitHub[GitHub API]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    AI[AI providers]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Bookmarks[chrome.bookmarks]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Script --&gt; Panel</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Content --&gt; Panel</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Panel --&gt; DOM</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Script --&gt; GM</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Content --&gt; Background</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Popup --&gt; Background</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Background --&gt; Notion</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Background --&gt; GitHub</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Background --&gt; AI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Background --&gt; Bookmarks</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Content --&gt; Storage</span></span></code></pre></div><h2 id="runtime-roles" tabindex="-1">Runtime roles <a class="header-anchor" href="#runtime-roles" aria-label="Permalink to “Runtime roles”">​</a></h2><table tabindex="0"><thead><tr><th>Component</th><th>Responsibility</th></tr></thead><tbody><tr><td>userscript</td><td>直接注入页面，使用 GM API 进行存储和跨域请求</td></tr><tr><td>content script</td><td>独立扩展的页面注入入口</td></tr><tr><td>background service worker</td><td>跨域代理、扩展特权 API、消息中转</td></tr><tr><td>popup</td><td>扩展工具栏入口和快速操作面</td></tr><tr><td>chrome.storage.local</td><td>独立扩展形态下的非敏感配置存储，以及敏感凭证的加密保险箱 payload</td></tr><tr><td>chrome.bookmarks</td><td>书签导入能力</td></tr></tbody></table><h2 id="message-boundary" tabindex="-1">Message boundary <a class="header-anchor" href="#message-boundary" aria-label="Permalink to “Message boundary”">​</a></h2><p>扩展形态下，页面内容脚本不应直接拥有所有能力。需要特权 API 时，通过 message bridge 请求 background service worker：</p><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">sequenceDiagram</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  participant Panel as Panel / Content Script</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  participant BG as Background Service Worker</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  participant API as Remote API / Chrome API</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Panel-&gt;&gt;BG: request(type, payload)</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  BG-&gt;&gt;BG: validate request</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  BG-&gt;&gt;API: call privileged API</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  API--&gt;&gt;BG: response</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  BG--&gt;&gt;Panel: result / error</span></span></code></pre></div><h2 id="contract" tabindex="-1">Contract <a class="header-anchor" href="#contract" aria-label="Permalink to “Contract”">​</a></h2><ul><li>Content script SHOULD validate incoming page context before triggering privileged actions。</li><li>Background service worker SHOULD be treated as the privileged control plane。</li><li>Extension messages SHOULD have explicit <code>type</code> and payload shape。</li><li>Secrets MUST stay in encrypted extension or userscript storage payloads, not in page DOM。</li></ul><h2 id="已知安全待办" tabindex="-1">已知安全待办 <a class="header-anchor" href="#已知安全待办" aria-label="Permalink to “已知安全待办”">​</a></h2><h3 id="ssrf-白名单严格匹配" tabindex="-1">SSRF 白名单严格匹配 <a class="header-anchor" href="#ssrf-白名单严格匹配" aria-label="Permalink to “SSRF 白名单严格匹配”">​</a></h3><p>当前 background service worker 的 URL 白名单使用简单字符串匹配，可被 <code>evil.amazonaws.com.attacker.com</code> 绕过。攻击路径：恶意网站 → content script → <code>chrome.runtime.sendMessage</code> → background worker → <code>fetch(evil URL)</code> → SSRF。</p><p>应改用 URL 构造函数解析 hostname 后精确匹配，并限制协议为 https、端口为默认端口。</p><h3 id="credentialvault-移植" tabindex="-1">CredentialVault 移植 <a class="header-anchor" href="#credentialvault-移植" aria-label="Permalink to “CredentialVault 移植”">​</a></h3><p>Chrome Extension 版本中 API key 通过 <code>chrome.storage.local</code> 明文存储，CredentialVault AES-256-GCM 加密机制尚未移植到 Extension 侧。popup.js 和 content.js 中敏感键直接读取，攻击者可通过 DevTools 获取。</p><p>应将 CredentialVault 的 AES-256-GCM 加密逻辑移植到 Extension service worker 中，popup/content 通过 <code>chrome.runtime.sendMessage</code> 获取加密值。</p>`,18)])])}const E=a(t,[["render",l]]);export{k as __pageData,E as default};
