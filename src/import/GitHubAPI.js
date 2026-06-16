"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");

const GitHubAPI = {
    _readmeCache: {},
    _fetchPaginated: (url, token = "", label = "GitHub", options = {}) => {
        return new Promise((resolve, reject) => {
            const allItems = [];
            let page = 1;
            const perPage = 100;

            const fetchPage = () => {
                const separator = url.includes("?") ? "&" : "?";
                const pagedUrl = `${url}${separator}per_page=${perPage}&page=${page}`;

                const headers = {
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "LD-Notion-UserScript",
                };
                if (token) headers["Authorization"] = `Bearer ${token}`;
                if (options.headers && typeof options.headers === "object") {
                    Object.assign(headers, options.headers);
                }

                GM_xmlhttpRequest({
                    method: "GET",
                    url: pagedUrl,
                    headers,
                    onload: (response) => {
                        if (response.status === 200) {
                            try {
                                const items = JSON.parse(response.responseText);
                                if (items.length === 0) return resolve(allItems);
                                allItems.push(...items);
                                if (items.length < perPage) return resolve(allItems);
                                page++;
                                setTimeout(fetchPage, 300);
                            } catch (e) {
                                reject(new Error(`解析 ${label} 响应失败`));
                            }
                        } else if (response.status === 403) {
                            reject(new Error(`${label} API 速率限制，请稍后再试或配置 Token`));
                        } else if (response.status === 404) {
                            reject(new Error(`${label} 资源不存在`));
                        } else {
                            reject(new Error(`${label} API 错误: ${response.status}`));
                        }
                    },
                    onerror: () => reject(new Error(`网络错误，无法连接 ${label}`)),
                    timeout: 30000,
                    ontimeout: () => reject(new Error("GitHub API 请求超时")),
                });
            };

            fetchPage();
        });
    },

    // 获取用户 starred repos（带分页）
    fetchStarredRepos: async (username, token = "") => {
        const url = token
            ? `https://api.github.com/user/starred?sort=created&direction=desc`
            : `https://api.github.com/users/${encodeURIComponent(username)}/starred?sort=created&direction=desc`;
        const items = await GitHubAPI._fetchPaginated(url, token, "GitHub Stars", {
            headers: {
                "Accept": "application/vnd.github.star+json, application/vnd.github+json",
            },
        });
        return items.map((item) => {
            if (item?.repo && item?.starred_at) {
                return {
                    ...item.repo,
                    starred_at: item.starred_at,
                };
            }
            return item;
        });
    },

    // 获取用户自己的仓库
    fetchUserRepos: (username, token = "") => {
        const url = token
            ? `https://api.github.com/user/repos?type=owner&sort=updated`
            : `https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated`;
        return GitHubAPI._fetchPaginated(url, token, "GitHub Repos");
    },

    // 获取用户 fork 的仓库
    fetchForkedRepos: async (username, token = "") => {
        const allRepos = await GitHubAPI.fetchUserRepos(username, token);
        return allRepos.filter(r => r.fork);
    },

    // 获取用户的 Gists
    fetchUserGists: (username, token = "") => {
        const url = token
            ? `https://api.github.com/gists`
            : `https://api.github.com/users/${encodeURIComponent(username)}/gists`;
        return GitHubAPI._fetchPaginated(url, token, "GitHub Gists");
    },

    // 获取已导出的 repo 集合
    getExported: () => {
        try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, "{}")); }
        catch { return {}; }
    },

    // 获取已导出的 gist 集合
    getExportedGists: () => {
        try { return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, "{}")); }
        catch { return {}; }
    },

    markExported: (repoFullName) => {
        const exported = GitHubAPI.getExported();
        exported[repoFullName] = Date.now();
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, JSON.stringify(exported));
    },

    markGistExported: (gistId) => {
        const exported = GitHubAPI.getExportedGists();
        exported[gistId] = Date.now();
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, JSON.stringify(exported));
    },

    isExported: (repoFullName) => {
        return !!GitHubAPI.getExported()[repoFullName];
    },

    isGistExported: (gistId) => {
        return !!GitHubAPI.getExportedGists()[gistId];
    },

    // 获取启用的导入类型
    getImportTypes: () => {
        try {
            return JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_IMPORT_TYPES, CONFIG.DEFAULTS.githubImportTypes));
        } catch {
            return ["stars"];
        }
    },

    setImportTypes: (types) => {
        Storage.set(CONFIG.STORAGE_KEYS.GITHUB_IMPORT_TYPES, JSON.stringify(types));
    },

    fetchRepoReadme: (repoFullName, token = "") => {
        if (!repoFullName) return Promise.resolve("");
        const cacheKey = `${repoFullName}::${token ? "auth" : "anon"}`;
        if (Object.prototype.hasOwnProperty.call(GitHubAPI._readmeCache, cacheKey)) {
            return Promise.resolve(GitHubAPI._readmeCache[cacheKey]);
        }

        return new Promise((resolve, reject) => {
            const headers = {
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "LD-Notion-UserScript",
            };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: `https://api.github.com/repos/${repoFullName}/readme`,
                headers,
                onload: (response) => {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText || "{}");
                            const decoded = Utils.base64DecodeUnicode(data.content || "");
                            const text = String(decoded || "").replace(/\r\n/g, "\n");
                            GitHubAPI._readmeCache[cacheKey] = text;
                            resolve(text);
                            return;
                        } catch {
                            GitHubAPI._readmeCache[cacheKey] = "";
                            resolve("");
                            return;
                        }
                    }
                    GitHubAPI._readmeCache[cacheKey] = "";
                    resolve("");
                },
                onerror: () => {
                    GitHubAPI._readmeCache[cacheKey] = "";
                    resolve("");
                },
                timeout: 15000,
                ontimeout: () => {
                    GitHubAPI._readmeCache[cacheKey] = "";
                    resolve(""); // 超时降级为空，与其他错误路径一致
                },
            });
        });
    },
};

module.exports = { GitHubAPI };
