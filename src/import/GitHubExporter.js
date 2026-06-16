"use strict";

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { NotionAPI } = require("../api");
const { GitHubAPI } = require("./GitHubAPI");

const GitHubExporter = {
    normalizeText: (text, maxLen = 280) => {
        if (!text) return "";
        const normalized = String(text).replace(/\s+/g, " ").trim();
        return normalized.substring(0, maxLen);
    },

    composeTitleWithPrefix: (prefix, candidate, maxLen = 180) => {
        const safePrefix = GitHubExporter.normalizeText(prefix, maxLen);
        const safeCandidate = GitHubExporter.normalizeText(candidate, maxLen);
        if (!safePrefix) return safeCandidate || "无标题";
        if (!safeCandidate || safeCandidate === safePrefix) return safePrefix;
        if (safeCandidate.startsWith(`${safePrefix} - `) || safeCandidate.startsWith(`${safePrefix} · `)) {
            return safeCandidate.substring(0, maxLen);
        }
        return `${safePrefix} · ${safeCandidate}`.substring(0, maxLen);
    },

    extractReadmeInsight: (readmeText = "") => {
        const text = String(readmeText || "").replace(/\r\n/g, "\n");
        if (!text) return { title: "", summary: "" };

        const headingMatch = text.match(/^#{1,3}\s+(.+)$/m);
        const title = GitHubExporter.normalizeText(headingMatch?.[1] || "", 120);

        const lines = text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("#") && !line.startsWith("```"));
        const summary = GitHubExporter.normalizeText(lines.slice(0, 8).join(" "), 320);

        return { title, summary };
    },

    inferRepoCategoryHeuristic: (repo, insight, categories = []) => {
        const available = (categories || []).map(c => String(c || "").trim()).filter(Boolean);
        if (available.length === 0) return "";

        const text = `${repo.full_name || ""} ${repo.name || ""} ${repo.description || ""} ${(repo.topics || []).join(" ")} ${repo.language || ""} ${insight.title || ""} ${insight.summary || ""}`.toLowerCase();
        for (const cat of available) {
            if (text.includes(cat.toLowerCase())) return cat;
        }

        const rules = [
            { keys: ["llm", "openai", "anthropic", "prompt", "rag", "ai", "agent"], hints: ["ai", "人工智能"] },
            { keys: ["react", "vue", "next", "svelte", "frontend", "ui", "css", "tailwind"], hints: ["前端", "ui"] },
            { keys: ["node", "express", "fastapi", "backend", "server", "api", "spring"], hints: ["后端", "服务端", "api"] },
            { keys: ["devops", "docker", "kubernetes", "k8s", "terraform", "ci", "cd"], hints: ["运维", "devops"] },
            { keys: ["docs", "guide", "tutorial", "awesome", "resource", "学习", "教程"], hints: ["文档", "资源", "学习"] },
        ];

        for (const rule of rules) {
            if (!rule.keys.some(k => text.includes(k))) continue;
            const matched = available.find(cat => rule.hints.some(h => cat.toLowerCase().includes(h.toLowerCase())));
            if (matched) return matched;
        }

        const fallback = available.find(cat => cat.includes("其他"));
        return fallback || available[available.length - 1];
    },

    inferRepoTags: (repo, insight) => {
        const tags = [];
        const pushTag = (value) => {
            const clean = GitHubExporter.normalizeText(value, 80);
            if (!clean) return;
            if (tags.includes(clean)) return;
            tags.push(clean);
        };

        (repo.topics || []).forEach(pushTag);
        pushTag(repo.language || "");

        const owner = String(repo.full_name || "").split("/")[0] || "";
        pushTag(owner);

        const lowerText = `${insight.title || ""} ${insight.summary || ""}`.toLowerCase();
        const keywordTags = ["ai", "llm", "rag", "agent", "react", "vue", "nextjs", "nodejs", "python", "rust", "go", "docker", "kubernetes", "notion", "github", "automation"];
        keywordTags.forEach((kw) => {
            if (lowerText.includes(kw)) pushTag(kw);
        });

        return tags.slice(0, 20);
    },

    generateAIRepoCategory: async (repo, insight, settings) => {
        const categories = Array.isArray(settings?.categories) ? settings.categories.filter(Boolean) : [];
        if (!settings?.aiApiKey || !settings?.aiService || categories.length === 0) return "";

        try {
            return await AIService.classify(
                `${repo.full_name || repo.name || ""} ${insight.title || ""}`,
                `${repo.description || ""}\n${insight.summary || ""}`,
                categories,
                settings
            );
        } catch {
            return "";
        }
    },

    enrichRepo: async (repo, settings, context = {}) => {
        const enriched = { ...repo };
        const prefix = GitHubExporter.normalizeText(repo.full_name || repo.name || "", 120) || "无标题";
        let insight = { title: "", summary: "" };

        try {
            const readme = await GitHubAPI.fetchRepoReadme(repo.full_name, settings?.token || "");
            insight = GitHubExporter.extractReadmeInsight(readme);
        } catch {
            insight = { title: "", summary: "" };
        }

        const defaultSuffix = insight.title || GitHubExporter.normalizeText(repo.description || "", 80);
        enriched.generatedTitle = GitHubExporter.composeTitleWithPrefix(prefix, defaultSuffix, 180);

        let inferredCategory = GitHubExporter.inferRepoCategoryHeuristic(repo, insight, settings?.categories || []);
        const canUseAI = !!(settings?.aiApiKey && settings?.aiService);
        const aiMaxItems = Number.isFinite(context.aiMaxItems) ? context.aiMaxItems : 20;
        if (canUseAI && (context.aiUsedCount || 0) < aiMaxItems) {
            const aiCategory = await GitHubExporter.generateAIRepoCategory(repo, insight, settings);
            if (aiCategory) inferredCategory = aiCategory;
            context.aiUsedCount = (context.aiUsedCount || 0) + 1;
        }

        enriched.inferredCategory = inferredCategory;
        enriched.inferredTags = GitHubExporter.inferRepoTags(repo, insight);
        enriched.readmeSummary = GitHubExporter.normalizeText(insight.summary || "", 1000);
        return enriched;
    },

    // 构建 Notion 数据库属性 (repos/stars/forks)
    buildRepoProperties: (repo, sourceType = "Star") => {
        const titlePrefix = GitHubExporter.normalizeText(repo.full_name || repo.name || "无标题", 120) || "无标题";
        const titleContent = GitHubExporter.composeTitleWithPrefix(titlePrefix, repo.generatedTitle || "", 2000);
        const summaryText = GitHubExporter.normalizeText(repo.readmeSummary || "", 1600);
        const descCandidate = GitHubExporter.normalizeText(repo.description || "", 1200);
        const description = [descCandidate, summaryText].filter(Boolean).join("\n\n").substring(0, 2000);
        const props = {
            "标题": {
                title: [{ text: { content: titleContent } }]
            },
            "链接": {
                url: repo.html_url
            },
            "描述": {
                rich_text: [{ text: { content: description } }]
            },
            "语言": {
                rich_text: [{ text: { content: repo.language || "" } }]
            },
            "Stars": {
                number: repo.stargazers_count || 0
            },
            "来源": {
                rich_text: [{ text: { content: "GitHub" } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: sourceType } }]
            },
        };
        const topicTags = Array.isArray(repo.topics) ? repo.topics.slice(0, 20) : [];
        const inferredTags = Array.isArray(repo.inferredTags) ? repo.inferredTags : [];
        const mergedTags = [];
        [...topicTags, ...inferredTags].forEach((tag) => {
            const clean = GitHubExporter.normalizeText(tag, 100);
            if (!clean) return;
            if (mergedTags.includes(clean)) return;
            mergedTags.push(clean);
        });
        if (mergedTags.length > 0) {
            props["标签"] = {
                multi_select: mergedTags.slice(0, 20).map(t => ({ name: t }))
            };
        }
        if (repo.inferredCategory) {
            props["分类"] = {
                rich_text: [{ text: { content: GitHubExporter.normalizeText(repo.inferredCategory, 300) } }]
            };
        }
        if (repo.pushed_at) {
            props["更新时间"] = { date: { start: repo.pushed_at } };
        }
        return props;
    },

    // 构建 Gist 属性
    buildGistProperties: (gist) => {
        const files = Object.keys(gist.files || {});
        const title = gist.description || files[0] || "无标题 Gist";
        const language = gist.files?.[files[0]]?.language || "";
        return {
            "标题": {
                title: [{ text: { content: title.substring(0, 2000) } }]
            },
            "链接": {
                url: gist.html_url
            },
            "描述": {
                rich_text: [{ text: { content: `文件: ${files.join(", ")}`.substring(0, 2000) } }]
            },
            "语言": {
                rich_text: [{ text: { content: language } }]
            },
            "Stars": {
                number: 0
            },
            "来源": {
                rich_text: [{ text: { content: "GitHub" } }]
            },
            "来源类型": {
                rich_text: [{ text: { content: "Gist" } }]
            },
            "更新时间": gist.updated_at ? { date: { start: gist.updated_at } } : undefined,
        };
    },

    // 向后兼容：原 buildProperties 映射到 buildRepoProperties
    buildProperties: (repo) => GitHubExporter.buildRepoProperties(repo, "Star"),

    // 配置数据库属性结构
    setupDatabaseProperties: async (databaseId, apiKey) => {
        const requiredProperties = {
            "标题": { typeName: "title", schema: { title: {} } },
            "链接": { typeName: "url", schema: { url: {} } },
            "描述": { typeName: "rich_text", schema: { rich_text: {} } },
            "语言": { typeName: "rich_text", schema: { rich_text: {} } },
            "Stars": { typeName: "number", schema: { number: { format: "number" } } },
            "标签": { typeName: "multi_select", schema: { multi_select: { options: [] } } },
            "来源": { typeName: "rich_text", schema: { rich_text: {} } },
            "来源类型": { typeName: "rich_text", schema: { rich_text: {} } },
            "更新时间": { typeName: "date", schema: { date: {} } },
            "分类": { typeName: "rich_text", schema: { rich_text: {} } },
        };

        try {
            const database = await NotionAPI.request("GET", `/databases/${databaseId}`, null, apiKey);
            const existingProps = database.properties || {};
            const propsToAdd = {};
            const propsToUpdate = {};
            const typeConflicts = [];

            for (const [name, { typeName, schema }] of Object.entries(requiredProperties)) {
                const existingProp = existingProps[name];
                if (!existingProp) {
                    if (typeName === "title") {
                        // 特殊处理：title 属性需要重命名现有的
                        const existingTitle = Object.entries(existingProps).find(([_, prop]) => prop.type === "title");
                        if (existingTitle && existingTitle[0] !== name) {
                            propsToUpdate[existingTitle[0]] = { name: name };
                        }
                    } else {
                        propsToAdd[name] = schema;
                    }
                } else if (existingProp.type !== typeName) {
                    typeConflicts.push({ name, expected: typeName, actual: existingProp.type });
                }
            }

            if (typeConflicts.length > 0) {
                const details = typeConflicts.map(c => `"${c.name}": 期望 ${c.expected}，实际 ${c.actual}`).join("; ");
                return { success: false, error: `属性类型不匹配: ${details}。请手动修改这些属性的类型。` };
            }

            const allChanges = { ...propsToAdd, ...propsToUpdate };
            if (Object.keys(allChanges).length > 0) {
                await NotionAPI.request("PATCH", `/databases/${databaseId}`, {
                    properties: allChanges,
                }, apiKey);
            }

            return { success: true, added: Object.keys(propsToAdd), renamed: Object.keys(propsToUpdate) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    // 通用导出方法
    _exportItems: async (items, settings, sourceType, buildFn, isExportedFn, markExportedFn, getKeyFn, onProgress) => {
        const { apiKey, databaseId } = settings;
        const delay = Storage.get(CONFIG.STORAGE_KEYS.REQUEST_DELAY, CONFIG.DEFAULTS.requestDelay);

        const newItems = items.filter(item => !isExportedFn(getKeyFn(item)));
        if (newItems.length === 0) {
            return { total: items.length, exported: 0, failed: 0, message: `没有新的 ${sourceType} 需要导出` };
        }

        let success = 0, failed = 0;
        const enrichContext = { aiUsedCount: 0, aiMaxItems: 20 };
        for (let i = 0; i < newItems.length; i++) {
            const item = newItems[i];
            const key = getKeyFn(item);
            const pct = Math.round(10 + (i / newItems.length) * 85);
            if (onProgress) onProgress(`正在导出 ${sourceType} (${i + 1}/${newItems.length}): ${key}`, pct);

            try {
                const enriched = sourceType === "Gist" ? item : await GitHubExporter.enrichRepo(item, settings, enrichContext);
                const properties = buildFn(enriched);
                // 清理 undefined 属性
                for (const k of Object.keys(properties)) {
                    if (properties[k] === undefined) delete properties[k];
                }
                await NotionAPI.request("POST", "/pages", {
                    parent: { database_id: databaseId },
                    properties,
                }, apiKey);
                markExportedFn(key);
                success++;
            } catch (e) {
                console.warn(`[GitHubExporter] 导出失败: ${key}`, e);
                failed++;
            }

            if (i < newItems.length - 1) {
                await new Promise(r => setTimeout(r, delay));
            }
        }

        return { total: items.length, exported: success, failed, newCount: newItems.length };
    },

    // 导出 stars 到 Notion
    exportStars: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        const setupResult = await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);
        if (!setupResult.success) {
            throw new Error(`数据库配置失败: ${setupResult.error}`);
        }

        if (onProgress) onProgress("正在获取 GitHub Stars...", 5);
        const repos = await GitHubAPI.fetchStarredRepos(username, token);

        return GitHubExporter._exportItems(
            repos, settings, "Star",
            (r) => GitHubExporter.buildRepoProperties(r, "Star"),
            GitHubAPI.isExported, GitHubAPI.markExported,
            (r) => r.full_name, onProgress
        );
    },

    // 导出用户仓库到 Notion
    exportRepos: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

        if (onProgress) onProgress("正在获取 GitHub Repos...", 5);
        const repos = await GitHubAPI.fetchUserRepos(username, token);
        const ownRepos = repos.filter(r => !r.fork);

        return GitHubExporter._exportItems(
            ownRepos, settings, "Repo",
            (r) => GitHubExporter.buildRepoProperties(r, "Repo"),
            GitHubAPI.isExported, GitHubAPI.markExported,
            (r) => r.full_name, onProgress
        );
    },

    // 导出 fork 的仓库到 Notion
    exportForks: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

        if (onProgress) onProgress("正在获取 GitHub Forks...", 5);
        const forks = await GitHubAPI.fetchForkedRepos(username, token);

        return GitHubExporter._exportItems(
            forks, settings, "Fork",
            (r) => GitHubExporter.buildRepoProperties(r, "Fork"),
            GitHubAPI.isExported, GitHubAPI.markExported,
            (r) => r.full_name, onProgress
        );
    },

    // 导出 Gists 到 Notion
    exportGists: async (settings, onProgress) => {
        const { apiKey, databaseId, username, token } = settings;

        if (!apiKey || !databaseId || !username) {
            throw new Error("请先配置 GitHub 用户名和 Notion 数据库");
        }

        if (onProgress) onProgress("正在配置数据库结构...", 0);
        await GitHubExporter.setupDatabaseProperties(databaseId, apiKey);

        if (onProgress) onProgress("正在获取 GitHub Gists...", 5);
        const gists = await GitHubAPI.fetchUserGists(username, token);

        return GitHubExporter._exportItems(
            gists, settings, "Gist",
            GitHubExporter.buildGistProperties,
            GitHubAPI.isGistExported, GitHubAPI.markGistExported,
            (g) => g.id, onProgress
        );
    },

    // 按用户选择的类型批量导出
    exportAll: async (settings, onProgress) => {
        const types = GitHubAPI.getImportTypes();
        const results = {};
        const totalTypes = types.length;
        let typeIndex = 0;

        for (const type of types) {
            const typeProgress = (msg, pct) => {
                const overallPct = Math.round((typeIndex / totalTypes) * 100 + pct / totalTypes);
                if (onProgress) onProgress(`[${type}] ${msg}`, overallPct);
            };

            try {
                switch (type) {
                    case "stars":
                        results.stars = await GitHubExporter.exportStars(settings, typeProgress);
                        break;
                    case "repos":
                        results.repos = await GitHubExporter.exportRepos(settings, typeProgress);
                        break;
                    case "forks":
                        results.forks = await GitHubExporter.exportForks(settings, typeProgress);
                        break;
                    case "gists":
                        results.gists = await GitHubExporter.exportGists(settings, typeProgress);
                        break;
                }
            } catch (e) {
                results[type] = { error: e.message };
            }
            typeIndex++;
        }

        return results;
    },

    // AI 分类已导出的 GitHub repos
    classifyRepos: async (settings, onProgress) => {
        const { apiKey, databaseId, aiApiKey, aiService, aiModel, aiBaseUrl, categories } = settings;

        if (!apiKey || !databaseId) throw new Error("请先配置 Notion 数据库");
        if (!aiApiKey) throw new Error("请先配置 AI API Key");

        if (onProgress) onProgress("正在获取待分类的仓库...", 0);

        // 查询数据库中未分类的条目
        const response = await NotionAPI.request("POST", `/databases/${databaseId}/query`, {
            filter: {
                or: [
                    { property: "分类", rich_text: { is_empty: true } },
                    { property: "分类", rich_text: { equals: "" } },
                ]
            },
            page_size: 100,
        }, apiKey);

        const pages = response.results || [];
        if (pages.length === 0) {
            return { classified: 0, message: "没有待分类的仓库" };
        }

        let classified = 0;
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const pct = Math.round((i / pages.length) * 100);
            const title = page.properties?.["标题"]?.title?.[0]?.text?.content || "";
            const desc = page.properties?.["描述"]?.rich_text?.[0]?.text?.content || "";
            const lang = page.properties?.["语言"]?.rich_text?.[0]?.text?.content || "";
            const tags = (page.properties?.["标签"]?.multi_select || []).map(t => t.name).join(", ");

            if (onProgress) onProgress(`正在分类 (${i + 1}/${pages.length}): ${title}`, pct);

            try {
                const prompt = `请根据以下 GitHub 仓库信息，从这些分类中选择最合适的一个: [${categories.join(", ")}]

仓库名: ${title}
描述: ${desc}
语言: ${lang}
标签: ${tags}

只回复分类名，不要其他内容。`;

                const category = await AIService.request(prompt, {
                    aiService, aiApiKey, aiModel: aiModel, aiBaseUrl,
                });

                const matched = categories.find(c => category.trim().includes(c)) || category.trim();

                await NotionAPI.request("PATCH", `/pages/${page.id}`, {
                    properties: {
                        "分类": { rich_text: [{ text: { content: matched } }] },
                    },
                }, apiKey);
                classified++;
            } catch (e) {
                console.warn(`[GitHubExporter] 分类失败: ${title}`, e);
            }

            await new Promise(r => setTimeout(r, 500));
        }

        return { classified, total: pages.length };
    },
};

module.exports = { GitHubExporter };
