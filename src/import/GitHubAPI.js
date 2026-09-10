"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");

const GitHubAPI = {
    _readmeCache: {},
    // FIFO 上限（PERF-005）：_readmeCache 原为无界普通对象，长会话累积内存泄漏。
    // 超 MAX_README_CACHE 时删最旧 key（Object.keys 保插入顺序），仿 AgentTrace.MAX_TRACES=50 的 FIFO rotate 模式。
    MAX_README_CACHE: 50,
    // 已导出集合缓存（H6：消除循环内逐条 JSON.parse 的 O(N²)，与 BookmarkExporter._exportedCache 同模式）。
    _exportedCache: null,
    _exportedGistsCache: null,
    _fetchPaginated: (url, token = "", label = "GitHub", options = {}) => {
        return new Promise((resolve, reject) => {
            const allItems = [];
            // P4 收敛(c08): 网络错误/超时 partial resolve 时标记数组, 调用方据此不推进水位
            // (已拉 N 项的尾部未取到 —— 推进水位会把它们永久甩到水位之下)
            const resolvePartial = () => {
                try { allItems.partial = true; } catch (_) { /* 冻结数组兼容 */ }
                resolve(allItems);
            };
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
                    onerror: () => {
                        // 网络抖动下若已拉到部分页，partial resolve 保留已拉数据
                        // （否则整次 reject 丢弃前 N 页，下次从旧 watermark 重拉全部，放大流量）。
                        // 调用方经 markExported 标记已处理项，partial 不会导致重复导入。
                        if (allItems.length > 0) {
                            console.warn(`[LD-Notion] ${label} 分页拉取网络错误，保留已拉 ${allItems.length} 项（partial）`);
                            resolvePartial();
                        } else {
                            reject(new Error(`网络错误，无法连接 ${label}`));
                        }
                    },
                    timeout: 30000,
                    ontimeout: () => {
                        if (allItems.length > 0) {
                            console.warn(`[LD-Notion] ${label} 分页拉取超时，保留已拉 ${allItems.length} 项（partial）`);
                            resolvePartial();
                        } else {
                            reject(new Error("GitHub API 请求超时"));
                        }
                    },
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
        const mapped = items.map((item) => {
            if (item?.repo && item?.starred_at) {
                return {
                    ...item.repo,
                    starred_at: item.starred_at,
                };
            }
            return item;
        });
        // P4 收敛(c08-glm): map 返回新数组, _fetchPaginated 挂在原数组上的 partial 标记被丢弃
        // → 调用方据不完整列表推进水位, 未拉到的尾部永久漏导入
        if (items.partial === true) mapped.partial = true;
        return mapped;
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
        const forks = allRepos.filter(r => r.fork);
        // P4 收敛(c08-glm): filter 同样产出新数组 —— partial 标记需随派生数组传递
        if (allRepos.partial === true) forks.partial = true;
        return forks;
    },

    // 获取用户的 Gists
    fetchUserGists: (username, token = "") => {
        const url = token
            ? `https://api.github.com/gists`
            : `https://api.github.com/users/${encodeURIComponent(username)}/gists`;
        return GitHubAPI._fetchPaginated(url, token, "GitHub Gists");
    },

    // F3 共识(缓存失效): 跨 tab 清除/其他 tab 标记必须置空内存缓存
    _registerExportedWatcher: () => {
        if (GitHubAPI._exportedWatcherBound) return;
        GitHubAPI._exportedWatcherBound = true;
        if (typeof GM_addValueChangeListener !== "function") return;
        try {
            GM_addValueChangeListener(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, () => {
                GitHubAPI._exportedCache = null;
            });
            GM_addValueChangeListener(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, () => {
                GitHubAPI._exportedGistsCache = null;
            });
        } catch (e) { /* 监听失败仅缓存陈旧风险 */ }
    },

    // 获取已导出的 repo 集合
    getExported: () => {
        if (GitHubAPI._exportedCache) return GitHubAPI._exportedCache;
        GitHubAPI._registerExportedWatcher();
        try {
            const parsed = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, "{}"));
            // 损坏存储兜底: 非纯对象时严格模式赋值抛 TypeError(全盘审计修复)
            GitHubAPI._exportedCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        }
        catch { GitHubAPI._exportedCache = {}; }
        return GitHubAPI._exportedCache;
    },

    // 获取已导出的 gist 集合
    getExportedGists: () => {
        if (GitHubAPI._exportedGistsCache) return GitHubAPI._exportedGistsCache;
        GitHubAPI._registerExportedWatcher();
        try {
            const parsed = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, "{}"));
            GitHubAPI._exportedGistsCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        }
        catch { GitHubAPI._exportedGistsCache = {}; }
        return GitHubAPI._exportedGistsCache;
    },

    // 仅 mutate 内存缓存，不写存储（DISCOVER P3）：循环内逐条调用避免写侧 O(N²)。
    // 单次调用场景须紧跟 flushExported() 持久化，或用 markExportedAndFlush。
    markExported: (repoFullName) => {
        const exported = GitHubAPI.getExported();
        exported[repoFullName] = Date.now();
    },

    markExportedAndFlush: (repoFullName) => {
        GitHubAPI.markExported(repoFullName);
        GitHubAPI.flushExported();
    },

    // 批量导出循环末尾单次回写已导出映射（DISCOVER P3 同类修复）：循环内仅 mutate 内存缓存，
    // 避免逐条 JSON.stringify 整个不断增长映射的写侧 O(N²)。与 BookmarkExporter.flushExported 同构。
    // v3.14.3: 导出账本改容量上限淘汰（repo full_name 天然有界），不再按 90 天时间 TTL 误删导出事实。
    // v3.14.6 (CC-05): 写前 rebase(重读-并集-max ts) —— 跨 tab 他端新增键不可丢
    // P4 收敛(c08): removedKeys —— 写前 rebase 会把存储旧值并集回写, 刚删除的键被复活
    // (unmarkExported 返回 true 但账本仍含该项, 重新导出入口静默失效)
    flushExported: (removedKeys = null) => {
        if (GitHubAPI._exportedCache) {
            GitHubAPI._evictByCapacity(GitHubAPI._exportedCache);
            let remote = {};
            try {
                remote = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, "{}")) || {};
            } catch { remote = {}; }
            const merged = { ...remote };
            if (removedKeys) for (const key of removedKeys) delete merged[key];
            for (const [key, ts] of Object.entries(GitHubAPI._exportedCache)) {
                if (merged[key] === undefined || Number(merged[key]) < Number(ts)) merged[key] = ts;
            }
            // P4 收敛(c08-glm): 容量上限须作用于最终落盘账本 —— 仅淘汰内存缓存时,
            // rebase 会把存储中超出上限的旧条目全量并集回写, 账本永不收缩(无界增长)
            GitHubAPI._evictByCapacity(merged);
            GitHubAPI._exportedCache = merged;
            Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS, JSON.stringify(merged));
        }
    },

    // F-05 修复：清除已导出记录（清键 + 失效内存缓存，供数据管理 UI 调用）
    clearExportedRecords: () => {
        GitHubAPI._exportedCache = null;
        GitHubAPI._exportedGistsCache = null;
        Storage.remove(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_REPOS);
        Storage.remove(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS);
    },

    markGistExported: (gistId) => {
        const exported = GitHubAPI.getExportedGists();
        exported[gistId] = Date.now();
    },

    markGistExportedAndFlush: (gistId) => {
        GitHubAPI.markGistExported(gistId);
        GitHubAPI.flushGistsExported();
    },

    flushGistsExported: (removedKeys = null) => {
        if (GitHubAPI._exportedGistsCache) {
            GitHubAPI._evictByCapacity(GitHubAPI._exportedGistsCache);
            // v3.14.6 (CC-05): 写前 rebase(重读-并集-max ts)
            let remote = {};
            try {
                remote = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, "{}")) || {};
            } catch { remote = {}; }
            const merged = { ...remote };
            // P4 收敛(c08): 同 flushExported —— rebase 不得复活已撤销键
            if (removedKeys) for (const key of removedKeys) delete merged[key];
            for (const [key, ts] of Object.entries(GitHubAPI._exportedGistsCache)) {
                if (merged[key] === undefined || Number(merged[key]) < Number(ts)) merged[key] = ts;
            }
            // P4 收敛(c08-glm): 同 flushExported —— 上限作用于落盘结果
            GitHubAPI._evictByCapacity(merged);
            GitHubAPI._exportedGistsCache = merged;
            Storage.set(CONFIG.STORAGE_KEYS.GITHUB_EXPORTED_GISTS, JSON.stringify(merged));
        }
    },

    // v3.14.3: 导出账本容量上限（repo full_name / gist id 天然有界）——
    // 仅在超过上限时淘汰最旧条目，避免 90 天时间窗误删导出事实致 UI 误判“待导出”。
    _EXPORT_CAPACITY_LIMIT: 10000,
    _evictByCapacity: (set) => {
        const keys = Object.keys(set);
        const excess = keys.length - GitHubAPI._EXPORT_CAPACITY_LIMIT;
        if (excess <= 0) return;
        keys.sort((a, b) => Number(set[a] || 0) - Number(set[b] || 0));
        for (let i = 0; i < excess && i < keys.length; i++) {
            delete set[keys[i]];
        }
    },

    isExported: (repoFullName) => {
        return !!GitHubAPI.getExported()[repoFullName];
    },

    isGistExported: (gistId) => {
        return !!GitHubAPI.getExportedGists()[gistId];
    },

    // v3.14.4: 键级撤销已导出记录(与 Storage.unmarkTopicExported 对称), 供“重新导出”入口
    // 修复对账误标后 GitHub 项无恢复路径的问题(此前只能清空全部账本)。
    // 返回是否真正移除; 单次调用内 flush(与 markExportedAndFlush 对称)。
    unmarkExported: (repoFullName) => {
        const exported = GitHubAPI.getExported();
        if (!Object.prototype.hasOwnProperty.call(exported, repoFullName)) return false;
        delete exported[repoFullName];
        GitHubAPI.flushExported([repoFullName]);
        return true;
    },

    unmarkGistExported: (gistId) => {
        const exported = GitHubAPI.getExportedGists();
        if (!Object.prototype.hasOwnProperty.call(exported, gistId)) return false;
        delete exported[gistId];
        GitHubAPI.flushGistsExported([gistId]);
        return true;
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

    // 写入 readme 缓存并执行 FIFO 淘汰（PERF-005）：统一所有写入点，超 MAX_README_CACHE 删最旧 key。
    _cacheReadme: (cacheKey, text) => {
        const keys = Object.keys(GitHubAPI._readmeCache);
        if (!Object.prototype.hasOwnProperty.call(GitHubAPI._readmeCache, cacheKey)
            && keys.length >= GitHubAPI.MAX_README_CACHE) {
            delete GitHubAPI._readmeCache[keys[0]];
        }
        GitHubAPI._readmeCache[cacheKey] = text;
    },

    fetchRepoReadme: (repoFullName, token = "") => {
        if (!repoFullName) return Promise.resolve("");
        // P4 收敛(c08): 缓存键含 token 指纹 —— 仅 auth/anon 两槽会让不同账号(或换 token)
        // 复用同一 readme 缓存, 私有仓库内容跨账号泄漏/过期
        const cacheKey = `${repoFullName}::${token ? Utils.apiKeyHash(token) : "anon"}`;
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
                            GitHubAPI._cacheReadme(cacheKey, text);
                            resolve(text);
                            return;
                        } catch {
                            GitHubAPI._cacheReadme(cacheKey, "");
                            resolve("");
                            return;
                        }
                    }
                    // P4 收敛(c08 2/3): 仅 404(确实无 readme)才负缓存 —— 限流/网关/5xx 等瞬态失败
                    // 负缓存会让该 repo 在 FIFO 淘汰前永久命中空串(导出内容静默缺失)
                    if (response.status === 404) GitHubAPI._cacheReadme(cacheKey, "");
                    resolve("");
                },
                onerror: () => {
                    // 瞬态网络错误不缓存
                    resolve("");
                },
                timeout: 15000,
                ontimeout: () => {
                    // 瞬态超时不缓存(与其他错误路径一致: 降级为空但不落负缓存)
                    resolve("");
                },
            });
        });
    },
};

module.exports = { GitHubAPI };
