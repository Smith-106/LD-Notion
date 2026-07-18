"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { AdapterRegistry } = require("./AdapterRegistry");
const { LinuxDoAdapter } = require("./LinuxDoAdapter");
const { createGitHubAdapter } = require("./GitHubAdapter");
const { BookmarkAdapter } = require("./BookmarkAdapter");
const { RSSAdapter } = require("./RSSAdapter");
const { ZhihuAdapter } = require("./ZhihuAdapter");
const { GenericAdapter } = require("./GenericAdapter");

// 注入 lazy bridge accessor：BookmarkAdapter/RSSAdapter 不再顶部 require("../bridge")，
// 由本注册器在加载完成时注入。访问器延迟到运行时 require，此时整张模块图已加载，
// 避开了 adapter/index → BookmarkAdapter → bridge → BookmarkAutoImporter →
// SyncCoordinator → adapter/index 的加载期循环。
const lazyBridge = () => require("../bridge");
Object.assign(BookmarkAdapter, { _bridgeAccessor: lazyBridge });
Object.assign(RSSAdapter, { _bridgeAccessor: lazyBridge });

// 注册所有内置适配器
AdapterRegistry.register(LinuxDoAdapter);
AdapterRegistry.register(createGitHubAdapter("stars"));
AdapterRegistry.register(createGitHubAdapter("repos"));
AdapterRegistry.register(createGitHubAdapter("forks"));
AdapterRegistry.register(createGitHubAdapter("gists"));
AdapterRegistry.register(BookmarkAdapter);
AdapterRegistry.register(RSSAdapter);
AdapterRegistry.register(ZhihuAdapter);
AdapterRegistry.register(GenericAdapter);

module.exports = { SourceAdapter, AdapterRegistry };
