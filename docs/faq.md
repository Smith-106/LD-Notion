# 常见问题

## 验证 Notion 配置失败怎么办？

检查以下几项：

1. Internal Integration Token 是否完整，通常以 `secret_` 开头。
2. Integration 是否已经连接到目标数据库或页面。
3. 是否先点击刷新工作区列表，并从下拉框选择目标。
4. 手动输入 ID 时是否只填写 32 位 ID。
5. OAuth 模式下 Redirect URI 是否与 Notion 后台配置一致。

## 图片为什么显示不出来？

常见原因：

- 外链图片已失效。
- Notion 无法访问需要登录的图片源。
- 图片超过 Notion 上传限制。
- 图片 MIME 推断失败或来源响应异常。

建议优先使用「上传到 Notion」模式；如果导出速度更重要，可以使用「外链引用」或「跳过图片」。

## 导出很慢怎么办？

- 并发数调到 3 或 5。
- 请求间隔不要过低，避免频繁触发 429。
- 图片改为外链引用或跳过。
- 大批量导入前先用少量内容测试。

## AI 助手不工作怎么办？

- 确认 AI API Key 与 Notion API Key 没有填反。
- AI 服务与模型要匹配。
- 使用自定义 Base URL 时确认端点可访问。
- 涉及写入时检查权限等级是否足够。

## 如何重新导出已经导过的 Linux.do 帖子？

优先直接在脚本面板的收藏列表里操作：找到状态为“已导出”的 Linux.do 帖子，点击右侧“重新导出”，该条目会恢复为“待导出”并自动重新选中。

如果你确实要一次性清空全部 Linux.do 导出记录，再在浏览器控制台执行：

```javascript
GM_setValue('ldb_exported_topics', '{}')
```

执行前建议确认目标 Notion 数据库中是否需要保留旧数据。

## 解压安装的扩展会自动更新吗？

不会。ZIP 或解压目录安装的扩展需要手动重新安装，或在 `chrome://extensions/` 中重新加载。真正自动更新需要走浏览器商店分发。

## 文档站如何发布到 GitHub Pages？

本项目的文档站构建命令是：

```bash
npm run docs:build
```

构建产物位于 `docs/.vitepress/dist`。如果仓库名是 `LD-Notion`，当前 VitePress `base` 已设置为 `/LD-Notion/`，适合发布到 GitHub Pages 的项目路径。
