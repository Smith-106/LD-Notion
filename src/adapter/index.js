"use strict";

const { SourceAdapter } = require("./SourceAdapter");
const { AdapterRegistry } = require("./AdapterRegistry");
const { LinuxDoAdapter } = require("./LinuxDoAdapter");
const { createGitHubAdapter } = require("./GitHubAdapter");
const { BookmarkAdapter } = require("./BookmarkAdapter");
const { RSSAdapter } = require("./RSSAdapter");
const { ZhihuAdapter } = require("./ZhihuAdapter");
const { GenericAdapter } = require("./GenericAdapter");

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
