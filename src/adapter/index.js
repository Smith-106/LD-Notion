"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { AdapterRegistry } = require("./AdapterRegistry");
const { LinuxDoAdapter } = require("./LinuxDoAdapter");
const { BookmarkAdapter } = require("./BookmarkAdapter");
const { ZhihuAdapter } = require("./ZhihuAdapter");
const { GenericAdapter } = require("./GenericAdapter");

// 注入 lazy bridge accessor：BookmarkAdapter 不再顶部 require("../bridge")，
// 由本注册器在加载完成时注入。访问器延迟到运行时 require，此时整张模块图已加载，
// 避开了 adapter/index → BookmarkAdapter → bridge → BookmarkAutoImporter →
// SyncCoordinator → adapter/index 的加载期循环。
const lazyBridge = () => require("../bridge");
Object.assign(BookmarkAdapter, { _bridgeAccessor: lazyBridge });

// 注册所有内置适配器
AdapterRegistry.register(LinuxDoAdapter);
// v3.17: GitHub 收藏源已移除(仅保留 UpdateChecker 自身更新检查), 不再注册 github-* 适配器;
// 历史 github-* 定时/状态残留由 SyncScheduler/SyncState 兼容层静默跳过。
AdapterRegistry.register(BookmarkAdapter);
AdapterRegistry.register(ZhihuAdapter);
AdapterRegistry.register(GenericAdapter);

module.exports = { SourceAdapter, AdapterRegistry };
