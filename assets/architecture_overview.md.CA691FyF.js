import{_ as i,o as a,c as n,a6 as l}from"./chunks/framework.wLlb4ebq.js";const o=JSON.parse('{"title":"整体架构","description":"","frontmatter":{},"headers":[],"relativePath":"architecture/overview.md","filePath":"architecture/overview.md"}'),e={name:"architecture/overview.md"};function t(p,s,E,h,r,k){return a(),n("div",null,[...s[0]||(s[0]=[l(`<h1 id="整体架构" tabindex="-1">整体架构 <a class="header-anchor" href="#整体架构" aria-label="Permalink to “整体架构”">​</a></h1><p>LD-Notion 是一个浏览器侧应用：核心逻辑运行在用户脚本或扩展 content script 中，通过浏览器存储保存非敏感配置，并通过本地加密凭证保险箱保存敏感凭证，再调用外部 API 读写 Notion、GitHub、AI 服务和 Obsidian。</p><h2 id="模块结构" tabindex="-1">模块结构 <a class="header-anchor" href="#模块结构" aria-label="Permalink to “模块结构”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">flowchart TB</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph Runtime[运行形态]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    UserScript[Tampermonkey 用户脚本]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    FullExt[独立 Chrome 扩展]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    BridgeExt[书签桥接扩展]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph UI[界面层]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    MainUI[Linux.do / GitHub 主面板]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    NotionUI[Notion 浮动 AI 面板]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    GenericUI[通用网页剪藏面板]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Popup[扩展 Popup]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph Services[服务层]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    WorkspaceService[WorkspaceService]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    NotionAPI[NotionAPI / NotionTransport]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    GitHubAPI[GitHubAPI / GitHubExporter]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    BookmarkExporter[BookmarkBridge / BookmarkExporter]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    ZhihuAPI[ZhihuAPI]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    ObsidianAPI[ObsidianAPI]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Agent[AI Agent Loop]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph Guard[安全层]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    OperationGuard[OperationGuard]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Audit[审计日志]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Permission[权限等级]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  subgraph External[外部系统]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    LinuxDo[Linux.do]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    GitHub[GitHub API]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    ChromeBookmarks[chrome.bookmarks]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Notion[Notion API]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    AI[AI Providers]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    Obsidian[Obsidian REST API]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  end</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  UserScript --&gt; MainUI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  UserScript --&gt; NotionUI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  UserScript --&gt; GenericUI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  FullExt --&gt; MainUI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  FullExt --&gt; NotionUI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  FullExt --&gt; GenericUI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  FullExt --&gt; Popup</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  BridgeExt --&gt; BookmarkExporter</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  MainUI --&gt; Services</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  NotionUI --&gt; Services</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  GenericUI --&gt; Services</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Popup --&gt; Services</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Services --&gt; OperationGuard</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  OperationGuard --&gt; Permission</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  OperationGuard --&gt; Audit</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  OperationGuard --&gt; NotionAPI</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  NotionAPI --&gt; Notion</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  WorkspaceService --&gt; Notion</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  GitHubAPI --&gt; GitHub</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  BookmarkExporter --&gt; ChromeBookmarks</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  ZhihuAPI --&gt; External</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  ObsidianAPI --&gt; Obsidian</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Agent --&gt; AI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Agent --&gt; Services</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  MainUI --&gt; LinuxDo</span></span></code></pre></div><h2 id="关键数据流" tabindex="-1">关键数据流 <a class="header-anchor" href="#关键数据流" aria-label="Permalink to “关键数据流”">​</a></h2><ol><li>UI 层读取用户配置与来源选择。</li><li>来源服务拉取帖子、仓库、书签或网页信息。</li><li>解析层清洗内容、保留格式、生成 Notion Blocks 或 Markdown。</li><li>可选 AI 层生成摘要、分类、标签或执行对话式任务。</li><li>写入前进入 OperationGuard。</li><li>Notion 或 Obsidian 适配层完成输出。</li><li>非敏感状态、日志和导出记录写回浏览器本地存储；敏感凭证写入本地加密保险箱。</li></ol><h2 id="代码定位" tabindex="-1">代码定位 <a class="header-anchor" href="#代码定位" aria-label="Permalink to “代码定位”">​</a></h2><table tabindex="0"><thead><tr><th>模块</th><th>位置</th></tr></thead><tbody><tr><td>用户脚本主体</td><td><code>LinuxDo-Bookmarks-to-Notion.user.js</code></td></tr><tr><td>书签桥接扩展</td><td><code>chrome-extension/</code></td></tr><tr><td>独立扩展构建</td><td><code>scripts/build-extension.js</code> 输出 <code>chrome-extension-full/</code></td></tr><tr><td>自动化测试</td><td><code>tests/</code></td></tr><tr><td>UI 手工回归</td><td><code>docs/ui-regression-checklist.md</code></td></tr></tbody></table><h2 id="设计取舍" tabindex="-1">设计取舍 <a class="header-anchor" href="#设计取舍" aria-label="Permalink to “设计取舍”">​</a></h2><ul><li>纯前端部署：安装简单，但共享生产级 secret 仍不适合放进前端；当前通过本地加密保险箱降低个人自用场景下的明文凭证暴露面。</li><li>单脚本核心：便于 Tampermonkey 分发，但需要构建 seam 来稳定生成扩展版。</li><li>权限守卫集中化：减少 AI 与用户触发写入入口的安全漂移。</li><li>多来源统一抽象：跨源搜索和推荐更自然，但来源去重策略需要分别处理。</li></ul>`,10)])])}const c=i(e,[["render",t]]);export{o as __pageData,c as default};
