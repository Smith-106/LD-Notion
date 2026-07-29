# ISS-015 / ISS-016 巨石拆分规划

## 背景
- ISS-015: src/ui/main-ui.js 约 4489 行
- ISS-016: src/ai/index.js 约 2923 行 + src/ai/Handlers.js 约 2281 行
两个文件无独立单测、强耦合全局单例，改动风险高。

## 拆分原则：保守物理拆分（不改运行时行为）
1. 把高内聚功能簇搬到新文件，用 require 重新挂载回原对象。
2. 不修改函数实现、不调整 UI.refs、不改变导出契约。
3. 每搬一簇跑 vitest run，507 测试全绿才 commit。
4. 逐簇提交，单 commit 只动一个簇。

## ISS-015 main-ui.js 拆分
| 新文件 | 簇 | 行号 |
|--------|----|------|
| src/ui/workspace-insight.js | F 工作区洞察/同步/Notion 写入 | 2211-3466 |
| src/ui/workspace-visual.js | E 可视化模型 + G 渲染 | 1635-1976,3544-4096 |
| src/ui/bookmark-list.js | D 书签源/选择/统计 | 1561-1635,3840-4312 |
| src/ui/panel-lifecycle.js | A 生命周期(init/destroy) | 4413-4488 |
保留 main-ui.js: cacheRefs/createPanel(UI.refs 地基)、loadConfig、状态通知。
验收: UI 方法集合不变; main-ui.js 降至 ~1800 行内。

## ISS-016 AI 模块拆分
| 新文件 | 内容 | 来源 |
|--------|------|------|
| src/ai/agent-executor.js | Agent 执行循环 | index.js 2024-2460 |
| src/ai/guarded-write.js | 写入守卫 | index.js 1196-1228 |
| src/ai/intent-classifier.js | 意图识别聚合 | index.js 532-841,1598-1893,2694-2922 |
| src/ai/handlers/ 分组 | 30 handler 按域分组 | Handlers.js 全量 |
保留: AIService/ChatState/ChatUI/schema。
验收: AIAssistant/AIHandlers 方法集合不变; index.js 降至 ~900 行。

## 执行顺序（增量）
1. workspace-visual.js -> verify
2. bookmark-list.js -> verify
3. workspace-insight.js -> verify (最重，单独提交)
4. guarded-write.js -> verify
5. agent-executor.js -> verify
6. intent-classifier.js + handlers 分组 -> verify

## 风险
- UI.refs 全局耦合: 新文件用惰性 require("./main-ui") 获取 UI，沿用项目已有模式。
- AI 循环依赖: 沿用 AI()/svc() 工厂惰性 require。
- 测试缺口: 拆分后逻辑等价，补集成断言列为后续 ISS，不阻塞本次。

## 后续
方案确认后用 /maestro-odyssey --mode planex 正式开 session 执行。
