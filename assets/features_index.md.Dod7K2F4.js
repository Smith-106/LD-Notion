import{_ as i,o as a,c as n,a6 as t}from"./chunks/framework.wLlb4ebq.js";const o=JSON.parse('{"title":"功能地图","description":"","frontmatter":{},"headers":[],"relativePath":"features/index.md","filePath":"features/index.md"}'),l={name:"features/index.md"};function e(p,s,h,E,d,k){return a(),n("div",null,[...s[0]||(s[0]=[t(`<h1 id="功能地图" tabindex="-1">功能地图 <a class="header-anchor" href="#功能地图" aria-label="Permalink to “功能地图”">​</a></h1><p>LD-Notion 的核心不是单一导出工具，而是一套浏览器侧知识采集与工作区管理层。</p><h2 id="能力总览" tabindex="-1">能力总览 <a class="header-anchor" href="#能力总览" aria-label="Permalink to “能力总览”">​</a></h2><div class="language-mermaid"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8;--shiki-light-bg:#fff;--shiki-dark-bg:#24292e;" tabindex="0" dir="ltr"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">mindmap</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">  root((LD-Notion Hub))</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    内容来源</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      Linux.do 收藏</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      GitHub Stars/Repos/Forks/Gists</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      浏览器书签</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      知乎内容</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      通用网页</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    处理能力</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      格式解析</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      图片处理</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      摘要提取</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      AI 分类</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      去重</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    目标系统</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      Notion 数据库</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      Notion 页面</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      Obsidian Markdown</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    AI 助手</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      搜索</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      阅读</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      写入</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      批量整理</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      总结翻译</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">    安全</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      权限等级</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      危险确认</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      审计日志</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">      撤销窗口</span></span></code></pre></div><h2 id="入口与典型任务" tabindex="-1">入口与典型任务 <a class="header-anchor" href="#入口与典型任务" aria-label="Permalink to “入口与典型任务”">​</a></h2><table tabindex="0"><thead><tr><th>入口</th><th>典型任务</th><th>输出</th></tr></thead><tbody><tr><td>Linux.do 面板</td><td>导出收藏、筛选楼层、保留格式、自动导入</td><td>Notion 数据库 / 页面</td></tr><tr><td>GitHub 来源分区</td><td>导入 Stars、Repos、Forks、Gists，并按 README 语义分类</td><td>Notion 数据库</td></tr><tr><td>浏览器书签</td><td>读取书签树、保留路径、抽取网页摘要</td><td>Notion 数据库</td></tr><tr><td>Notion 浮动 AI 面板</td><td>搜索、读取、写入、批量整理工作区</td><td>Notion 页面 / 数据库</td></tr><tr><td>通用网页剪藏</td><td>抽取网页标题、摘要、来源并导出</td><td>Notion / Obsidian</td></tr><tr><td>Obsidian 导出</td><td>将内容转换为 Markdown 与附件</td><td>本地 Obsidian REST API</td></tr></tbody></table><h2 id="推荐使用组合" tabindex="-1">推荐使用组合 <a class="header-anchor" href="#推荐使用组合" aria-label="Permalink to “推荐使用组合”">​</a></h2><ul><li>只整理 Linux.do 收藏：脚本版 + Notion Integration。</li><li>同时整理 GitHub 和书签：独立扩展版更省事，因为书签 API 内置。</li><li>需要自然语言管理 Notion：配置 AI 服务后使用 Linux.do 或 Notion 面板。</li><li>需要本地知识库沉淀：配置 Obsidian Local REST API，再使用网页或来源导出。</li></ul>`,8)])])}const c=i(l,[["render",e]]);export{o as __pageData,c as default};
