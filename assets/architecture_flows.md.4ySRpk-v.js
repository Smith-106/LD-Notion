import{_ as a,o as i,c as n,a6 as t}from"./chunks/framework.wLlb4ebq.js";const d=JSON.parse('{"title":"关键流程图","description":"","frontmatter":{},"headers":[],"relativePath":"architecture/flows.md","filePath":"architecture/flows.md"}'),e={name:"architecture/flows.md"};function l(p,s,h,E,k,r){return i(),n("div",null,[...s[0]||(s[0]=[t(`<h1 id="关键流程图" tabindex="-1">关键流程图 <a class="header-anchor" href="#关键流程图" aria-label="Permalink to “关键流程图”">​</a></h1><p>本页集中展示 LD-Notion 的核心流程，便于理解安装、授权、导入、AI 执行和扩展构建之间的关系。</p><h2 id="安装与运行形态" tabindex="-1">安装与运行形态 <a class="header-anchor" href="#安装与运行形态" aria-label="Permalink to “安装与运行形态”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">flowchart TD</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Start[用户选择安装方式] --&gt; Choice{安装形态}</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Choice --&gt; TM[Tampermonkey 脚本]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Choice --&gt; CE[独立 Chrome 扩展]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  TM --&gt; NeedBookmarks{需要浏览器书签?}</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  NeedBookmarks --&gt;|是| Bridge[安装书签桥接扩展]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  NeedBookmarks --&gt;|否| RunScript[直接运行用户脚本]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Bridge --&gt; RunScript</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  CE --&gt; Build[下载或构建 chrome-extension-full]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Build --&gt; Load[加载已解压扩展]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  RunScript --&gt; Panels[页面注入面板]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Load --&gt; Panels</span></span></code></pre></div><h2 id="notion-oauth-授权" tabindex="-1">Notion OAuth 授权 <a class="header-anchor" href="#notion-oauth-授权" aria-label="Permalink to “Notion OAuth 授权”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">sequenceDiagram</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  participant User as 用户</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  participant Panel as LD-Notion 面板</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  participant Notion as Notion OAuth</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  participant Store as 本地加密保险箱 + 本地配置存储</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  User-&gt;&gt;Panel: 填写 Client ID / Secret / Redirect URI</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  User-&gt;&gt;Panel: 初始化并解锁保险箱</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  User-&gt;&gt;Panel: 点击一键授权</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Panel-&gt;&gt;Notion: 打开授权 URL</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Notion--&gt;&gt;Panel: 重定向回 Redirect URI 并携带 code/state</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Panel-&gt;&gt;Notion: 用 code 换取 access token</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Notion--&gt;&gt;Panel: 返回 access token / refresh token</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Panel-&gt;&gt;Store: 保存敏感 OAuth 凭据与非敏感配置</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Panel--&gt;&gt;User: 显示已连接状态</span></span></code></pre></div><h2 id="收藏导入到-notion" tabindex="-1">收藏导入到 Notion <a class="header-anchor" href="#收藏导入到-notion" aria-label="Permalink to “收藏导入到 Notion”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">flowchart LR</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Source[来源数据] --&gt; Normalize[标准化条目]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Normalize --&gt; Dedup{是否已导入?}</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Dedup --&gt;|是| Skip[跳过]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Dedup --&gt;|否| Detail[获取详情]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Detail --&gt; Blocks[转换 Notion Blocks]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Blocks --&gt; Guard[OperationGuard]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Guard --&gt; Write{目标类型}</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Write --&gt; Database[创建数据库条目]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Write --&gt; Page[创建或追加页面]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Database --&gt; Record[记录导出状态]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Page --&gt; Record</span></span></code></pre></div><h2 id="ai-工具调用闭环" tabindex="-1">AI 工具调用闭环 <a class="header-anchor" href="#ai-工具调用闭环" aria-label="Permalink to “AI 工具调用闭环”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">stateDiagram-v2</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  [*] --&gt; Receive: 接收用户输入</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Receive --&gt; Plan: 识别意图与拆解步骤</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Plan --&gt; ReadOnly: 检索 / 读取</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Plan --&gt; WriteAction: 写入 / 批量整理</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  ReadOnly --&gt; Observe: 观察结果</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  WriteAction --&gt; Guard: 权限检查</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Guard --&gt; Confirm: 危险操作确认</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Guard --&gt; Execute: 普通写入</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Confirm --&gt; Execute: 用户确认</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Confirm --&gt; Abort: 用户取消</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Execute --&gt; Observe</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Observe --&gt; Plan: 需要继续</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Observe --&gt; Reply: 足够回答</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Abort --&gt; Reply</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Reply --&gt; [*]</span></span></code></pre></div><h2 id="扩展构建链路" tabindex="-1">扩展构建链路 <a class="header-anchor" href="#扩展构建链路" aria-label="Permalink to “扩展构建链路”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">flowchart TD</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Script[LinuxDo-Bookmarks-to-Notion.user.js] --&gt; Anchors[构建锚点与 seams]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Anchors --&gt; Builder[scripts/build-extension.js]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Builder --&gt; GMShim[GM API shim]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Builder --&gt; Content[content.js]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Builder --&gt; Background[background.js]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Builder --&gt; Popup[popup.html / popup.js]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Builder --&gt; Manifest[manifest.json]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  GMShim --&gt; Output[chrome-extension-full]</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Content --&gt; Output</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Background --&gt; Output</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Popup --&gt; Output</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Manifest --&gt; Output</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  Output --&gt; Smoke[bounded profile smoke / 手工回归]</span></span></code></pre></div>`,12)])])}const c=a(e,[["render",l]]);export{d as __pageData,c as default};
