"use strict";

// events/export-bindings.js — 导出 + Obsidian + 日志 + 去重数据管理绑定 (M3 events 拆分)。
// 提取自 events.js bindEvents (~596 LOC): exportBtn.onclick / exportObsidianBtn.onclick /
// 日志面板开关与清除 / 去重与已导出记录清理(renderDedupSummary + clearWithConfirm 块内自带)。
// 共享闭包助手经 ctx 注入(updateExportButtonState/syncUndoOrganizeBtn/getInputValue/
// getSensitiveValue 仍定义于 events.js 顶层,供 Section 1 其他绑定复用)。

const { CONFIG, MSG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage, DedupStore } = require("../../storage");
const { NotionOAuth } = require("../../auth");
const { OperationGuard, OperationLog, ConfirmationDialog } = require("../../security");
const { Exporter, LinuxDoAPI, GenericExporter, PageFileExporter } = require("../../export");
const { GitHubAPI } = require("../../import");
const { BookmarkExporter } = require("../../bridge");
const { UICommandService } = require("../../coordination/UICommandService");
const { HTMLToMarkdown, ObsidianAPI } = require("../../api");

const bindExport = (ctx) => {
    const { UI, panel, refs, getInputValue, getSensitiveValue, updateExportButtonState, syncUndoOrganizeBtn } = ctx;

        refs.exportBtn.onclick = async () => {
            // 防重入：导出进行中时忽略重复点击
            if (refs.exportBtn.disabled) return;
            // v3.14.7 (REV-01 UI-05): 立即禁用按钮——此前在首个 await
            // (save_command_boundary_settings) 之后才置 disabled, 双击窗口内
            // 两次 onClick 都会通过守卫(重入面收窄到 SyncLock 兜底)。
            refs.exportBtn.disabled = true;
            // 校验失败时恢复按钮(供下方 return 分支使用)
            const restoreExportBtn = () => { refs.exportBtn.disabled = false; };
            const liveApiKey = refs.apiKeyInput.value.trim();
            const apiKey = NotionOAuth.getAccessToken(liveApiKey);
            const exportTargetType = refs.exportTargetPageRadio.checked ? "page" : "database";
            const databaseId = refs.databaseIdInput.value.trim();
            const parentPageId = refs.parentPageIdInput.value.trim();

            if (!apiKey) {
                UI.showStatus("请先配置 Notion API Key", "error");
                restoreExportBtn();
                return;
            }

            if (exportTargetType === "database" && !databaseId) {
                UI.showStatus("请先配置数据库 ID", "error");
                restoreExportBtn();
                return;
            }

            if (exportTargetType === "page" && !parentPageId) {
                UI.showStatus("请先配置父页面 ID", "error");
                restoreExportBtn();
                return;
            }

            if (!UI.bookmarks || UI.bookmarks.length === 0) {
                UI.showStatus("请先加载收藏列表", "error");
                restoreExportBtn();
                return;
            }

            // 获取选中的收藏（严格模式过滤已导出，允许重复模式仅按勾选）
            // P4 收敛(c13): 导出器选择必须与 toExport 同一来源快照 ——
            // 设置保存 await 期间用户切换来源时, 重读来源会把陈旧列表交给错误导出器
            const exportIsGitHub = UI.isActiveGitHubSource();
            const toExport = UI.bookmarks.filter((b) => {
                const bookmarkKey = UI.getBookmarkKey(b);
                return UI.selectedBookmarks.has(bookmarkKey) && !UI.isBookmarkKeyExported(bookmarkKey);
            });

            if (toExport.length === 0) {
                UI.showStatus("没有可导出的收藏（可能都已导出过或未选中）", "info");
                restoreExportBtn();
                return;
            }

            const settings = {
                apiKey,
                // v3.14.7: 透传输入框原文(liveApiKey 为空=OAuth 模式)→ 导出循环每项重解析最新 token
                liveApiKey,
                databaseId,
                parentPageId,
                exportTargetType,
                onlyFirst: refs.onlyFirstCheckbox.checked,
                onlyOp: refs.onlyOpCheckbox.checked,
                rangeStart: parseInt(refs.rangeStartInput.value) || 1,
                rangeEnd: parseInt(refs.rangeEndInput.value) || 999999,
                imgMode: refs.imgModeSelect.value,
                concurrency: parseInt(refs.exportConcurrencySelect.value) || 1,
                aiApiKey: getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                aiService: refs.aiServiceSelect.value,
                aiModel: refs.aiModelSelect.value,
                aiBaseUrl: refs.aiBaseUrlInput.value.trim(),
                categories: Utils.parseAICategories(
                    refs.aiCategoriesInput.value.trim() || ""
                ),
                githubUsername: refs.githubUsernameInput.value.trim(),
                token: getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
                imgFilter: refs.filterImgSelect.value,
                filterUsers: refs.filterUsersInput.value.trim(),
                filterInclude: refs.filterIncludeInput.value.trim(),
                filterExclude: refs.filterExcludeInput.value.trim(),
                filterMinLen: parseInt(refs.filterMinLenInput.value) || 0,
            };

            // 保存设置
            const settingsSaved = await UICommandService.execute("save_command_boundary_settings", {
                scope: "main-export-session",
                liveApiKey,
                exportState: {
                    targetType: exportTargetType,
                    databaseId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.DATABASE ? databaseId : undefined,
                    parentPageId: exportTargetType === CONFIG.EXPORT_TARGET_TYPES.PAGE ? parentPageId : undefined,
                },
                storageValues: {
                    [CONFIG.STORAGE_KEYS.FILTER_ONLY_FIRST]: settings.onlyFirst,
                    [CONFIG.STORAGE_KEYS.FILTER_ONLY_OP]: settings.onlyOp,
                    [CONFIG.STORAGE_KEYS.FILTER_RANGE_START]: settings.rangeStart,
                    [CONFIG.STORAGE_KEYS.FILTER_RANGE_END]: settings.rangeEnd,
                    [CONFIG.STORAGE_KEYS.FILTER_IMG]: settings.imgFilter,
                    [CONFIG.STORAGE_KEYS.FILTER_USERS]: settings.filterUsers,
                    [CONFIG.STORAGE_KEYS.FILTER_INCLUDE]: settings.filterInclude,
                    [CONFIG.STORAGE_KEYS.FILTER_EXCLUDE]: settings.filterExclude,
                    [CONFIG.STORAGE_KEYS.FILTER_MINLEN]: settings.filterMinLen,
                    [CONFIG.STORAGE_KEYS.IMG_MODE]: settings.imgMode,
                    [CONFIG.STORAGE_KEYS.REQUEST_DELAY]: parseInt(refs.requestDelaySelect.value),
                    [CONFIG.STORAGE_KEYS.EXPORT_CONCURRENCY]: settings.concurrency,
                    [CONFIG.STORAGE_KEYS.GITHUB_OAUTH_CLIENT_ID]: refs.githubOauthClientIdInput ? String(refs.githubOauthClientIdInput.value || "").trim() : "",
                },
                sensitiveEntries: {
                    [CONFIG.STORAGE_KEYS.AI_API_KEY]: getInputValue(refs.aiApiKeyInput),
                    [CONFIG.STORAGE_KEYS.GITHUB_TOKEN]: getInputValue(refs.githubTokenInput),
                },
            }).then(() => true, (error) => {
                // P4 收敛(c13): 保存失败不得使导出按钮永久禁用(异常此前直接逃逸 onclick)
                UI.showStatus(`保存设置失败: ${error.message}`, "error");
                return false;
            });
            if (!settingsSaved) {
                restoreExportBtn();
                return;
            }

            // 显示控制按钮，隐藏导出按钮
            refs.exportBtn.disabled = true;
            refs.exportBtns.style.display = "none";
            refs.controlBtns.style.display = "flex";
            refs.pauseBtn.innerHTML = "⏸️ 暂停";
            refs.pauseBtn.classList.add("ldb-btn-warning");
            refs.pauseBtn.classList.remove("ldb-btn-primary");

            // 清空之前的报告
            UI.refs.reportContainer.innerHTML = "";

            try {
                let results;
                if (exportIsGitHub) {
                    results = await UI.exportGitHubSelected(toExport, settings, (current, total, title) => {
                        UI.showProgress(current, total, `${title}\n导出中`);
                    });
                } else {
                    results = await Exporter.exportBookmarks(toExport, settings, (progress) => {
                        UI.showProgress(
                            progress.current,
                            progress.total,
                            `${progress.title}\n${progress.message || progress.stage}${progress.isPaused ? " (已暂停)" : ""}`
                        );
                    });
                }

                UI.hideProgress();

                // 显示导出报告
                UI.showReport(results);

                // 刷新列表状态
                UI.renderBookmarkList();

                const successCount = results.success.length;
                const failCount = results.failed.length;
                const skippedCount = results.skipped?.length || 0;

                let statusMsg;
                if (results.authAborted || results.aborted === true) {
                    // v3.14.12 (三模型共识): 按 authCode 分支,manual 模式无「续签」概念
                    const authCode = String(results.authAborted?.authCode || "").toLowerCase();
                    if (authCode === "empty_token") {
                        statusMsg = `⛔ 导出已中止（未读取到 API Key）：成功 ${successCount} 个，未尝试 ${skippedCount} 个。请重新保存 API Key 后重试`;
                    } else if (authCode === "format_suspect") {
                        statusMsg = `⛔ 导出已中止（API Key 格式异常）：成功 ${successCount} 个，未尝试 ${skippedCount} 个。请确认 Key 以 secret_/ntn_ 开头`;
                    } else if (authCode === "invalid_bearer_token" || authCode === "unauthorized") {
                        statusMsg = `⛔ 导出已中止（Notion 拒绝该 Key）：成功 ${successCount} 个，未尝试 ${skippedCount} 个。请重新复制 API Key 或重新 OAuth 授权`;
                    } else {
                        statusMsg = `⛔ 导出已中止（Notion 认证失败）：成功 ${successCount} 个，未尝试 ${skippedCount} 个。请检查 API Key / OAuth 授权后重新导出`;
                    }
                } else {
                    statusMsg = `导出完成：成功 ${successCount} 个`;
                    if (failCount > 0) statusMsg += `，失败 ${failCount} 个`;
                    if (skippedCount > 0) statusMsg += `，跳过 ${skippedCount} 个`;
                }

                UI.showStatus(statusMsg, (results.authAborted || results.aborted === true || failCount > successCount) ? "error" : "success");

                // 通知
                if (typeof GM_notification === "function") {
                    GM_notification({
                        title: "导出完成",
                        text: statusMsg,
                        timeout: 5000,
                    });
                }
            } catch (error) {
                // P4 收敛(c13): 导出失败也必须收掉进度浮层 —— 否则遮罩残留、面板不可用
                UI.hideProgress();
                UI.showStatus(`导出出错: ${error.message}`, "error");
            } finally {
                // P3(qwen, 主 agent 复核): 按当前配置完整性恢复按钮——无条件启用会与
                // updateExportButtonState 守卫矛盾(导出期间用户清空 Key/目标后仍可点)。
                updateExportButtonState();
                refs.exportBtns.style.display = "flex";
                refs.controlBtns.style.display = "none";
                Exporter.reset();
            }
        };

        // 导出到 Obsidian
        refs.obsExportBtn.onclick = async () => {
            if (refs.obsExportBtn.disabled) return;
            const obsUrl = refs.obsApiUrlInput.value.trim();
            const obsKey = getSensitiveValue(refs.obsApiKeyInput, CONFIG.STORAGE_KEYS.OBS_API_KEY, CONFIG.DEFAULTS.obsApiKey);
            const obsDir = refs.obsDirInput.value.trim() || "Linux.do";
            const obsImgMode = refs.obsImgModeSelect.value;
            const obsImgDir = refs.obsImgDirInput.value.trim() || "Linux.do/attachments";

            if (!obsUrl || !obsKey) {
                UI.showStatus("请先在设置中配置 Obsidian API 地址和 Key", "error");
                return;
            }

            // P3(qwen, 主 agent 复核): 与 Notion 导出同款过滤——已导出项复选框 disabled
            // 却因初始全选残留在 selectedBookmarks, 会被重复导出到 Obsidian。
            const selected = UI.getSelectedBookmarks().filter((b) => !UI.isBookmarkKeyExported(UI.getBookmarkKey(b)));
            if (selected.length === 0) {
                UI.showStatus("请先选择要导出的帖子", "error");
                return;
            }

            refs.obsExportBtn.disabled = true;
            refs.exportBtns.style.display = "none";
            refs.controlBtns.style.display = "flex";
            // P4 收敛(c13): 与 Notion 导出同款重置 —— 上轮暂停态标签/样式不得残留到本轮
            refs.pauseBtn.innerHTML = "⏸️ 暂停";
            refs.pauseBtn.classList.add("ldb-btn-warning");
            refs.pauseBtn.classList.remove("ldb-btn-primary");
            UI.refs.reportContainer.innerHTML = "";

            const results = { success: [], failed: [], skipped: [] };
            let imageFailures = 0;

            try {
                if (UI.isActiveGitHubSource()) {
                    const githubResults = await UI.exportGitHubSelectedToObsidian(selected, {
                        obsUrl,
                        obsKey,
                        obsDir,
                        aiApiKey: getSensitiveValue(refs.aiApiKeyInput, CONFIG.STORAGE_KEYS.AI_API_KEY, ""),
                        aiService: refs.aiServiceSelect.value,
                        aiModel: refs.aiModelSelect.value,
                        aiBaseUrl: refs.aiBaseUrlInput.value.trim(),
                        categories: Utils.parseAICategories(refs.aiCategoriesInput.value.trim() || ""),
                        token: getSensitiveValue(refs.githubTokenInput, CONFIG.STORAGE_KEYS.GITHUB_TOKEN, ""),
                    }, (current, total, title) => {
                        UI.showProgress(current, total, `${title}\n导出到 Obsidian...`);
                    });
                    results.success.push(...githubResults.success);
                    results.failed.push(...githubResults.failed);
                    results.skipped.push(...(githubResults.skipped || []));
                } else {
                    for (let i = 0; i < selected.length; i++) {
                        if (Exporter.isCancelled) break;
                        while (Exporter.isPaused) {
                            await Utils.sleep(200);
                            if (Exporter.isCancelled) break;
                        }
                        if (Exporter.isCancelled) break;

                        const bookmark = selected[i];
                        const topicId = LinuxDoAPI.resolveTopicId(bookmark);
                        if (!topicId) {
                            results.failed.push({ topicId: "", title: bookmark.title || bookmark.fancy_title || bookmark.name || "未知标题", error: "无法解析话题 ID" });
                            continue;
                        }
                        UI.showProgress(i + 1, selected.length, "导出帖子到 Obsidian...");

                        try {
                            const { topic, posts } = await LinuxDoAPI.fetchAllPosts(topicId);
                            const filteredPosts = Exporter.filterPosts(posts, topic, {
                                onlyFirst: refs.onlyFirstCheckbox.checked,
                                onlyOp: refs.onlyOpCheckbox.checked,
                                rangeStart: parseInt(refs.rangeStartInput.value) || 1,
                                rangeEnd: parseInt(refs.rangeEndInput.value) || 999999,
                                imgFilter: refs.filterImgSelect.value,
                                filterUsers: refs.filterUsersInput.value.trim(),
                                filterInclude: refs.filterIncludeInput.value.trim(),
                                filterExclude: refs.filterExcludeInput.value.trim(),
                                filterMinLen: parseInt(refs.filterMinLenInput.value) || 0,
                            });

                            const meta = {
                                title: topic.title,
                                url: topic.url,
                                author: topic.opUsername,
                                topicId: topic.topicId || topic.topic_id,
                                category: topic.categoryName || topic.category,
                                tags: topic.tags || [],
                                floors: filteredPosts.length,
                            };
                            let md = HTMLToMarkdown.buildFrontmatter(meta);

                            md += `> [!info] 帖子信息\n`;
                            md += `> - **原始链接**: ${Utils.mdLink(topic.title, topic.url)}\n`;
                            md += `> - **楼主**: @${topic.opUsername || "未知"}\n`;
                            md += `> - **分类**: ${meta.category || "无"}\n`;
                            md += `> - **标签**: ${(topic.tags || []).join(", ") || "无"}\n`;
                            md += `> - **导出时间**: ${new Date().toLocaleString("zh-CN")}\n\n`;

                            filteredPosts.forEach((post, idx) => {
                                const isOp = post.username === topic.opUsername;
                                md += HTMLToMarkdown.buildPostCallout(post, idx, isOp);
                            });

                            if (obsImgMode === "file") {
                                const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                                let match;
                                const imgDownloads = [];
                                while ((match = imgRegex.exec(md)) !== null) {
                                    imgDownloads.push({ full: match[0], alt: match[1], url: match[2] });
                                }
                                for (const img of imgDownloads) {
                                    // P4 收敛(c13): 与主题循环同口径 —— 取消/暂停必须穿透图片下载循环
                                    if (Exporter.isCancelled) break;
                                    while (Exporter.isPaused) {
                                        await Utils.sleep(200);
                                        if (Exporter.isCancelled) break;
                                    }
                                    if (Exporter.isCancelled) break;
                                    try {
                                        const ext = img.url.split(".").pop().split("?")[0] || "png";
                                        const nameBytes = new Uint8Array(4);
                                        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
                                            crypto.getRandomValues(nameBytes);
                                        } else {
                                            throw new Error("crypto.getRandomValues 不可用，无法生成 Obsidian 图片文件名");
                                        }
                                        const safeName = `img-${Date.now()}-${Array.from(nameBytes, b => b.toString(16).padStart(2, "0")).join("")}.${ext}`;
                                        const imgPath = `${obsImgDir}/${safeName}`;
                                        // SSRF 防护（SEC-003）：img.url 来自导入页面 Markdown/HTML 解析的 img src，
                                        // 远程不可信。校验外链 URL 拒内网/私有地址后再下载（@connect 白名单已限制可达域，
                                        // 但白名单含 *.amazonaws.com/zhihu.com 宽泛域，此处补私有地址过滤）。
                                        const { UrlValidator } = require("../security/UrlValidator");
                                        if (!UrlValidator.validatePageExternalUrl(img.url)) {
                                            throw new Error("图片 URL 未通过安全校验");
                                        }
                                        const blob = await new Promise((resolve, reject) => {
                                            GM_xmlhttpRequest({
                                                method: "GET",
                                                url: img.url,
                                                responseType: "blob",
                                                timeout: 30000,
                                                onload: (r) => {
                                                    // P4 收敛(c13): onload 对 4xx/5xx 同样触发 ——
                                                    // 错误页字节不得当图片写入
                                                    if (r.status >= 200 && r.status < 300) resolve(r.response);
                                                    else reject(new Error(`图片下载失败: HTTP ${r.status}`));
                                                },
                                                onerror: (e) => reject(e),
                                                ontimeout: () => reject(new Error("图片下载超时")),
                                            });
                                        });
                                        // v3.14.7 (REV-03 UI-07): Obsidian 写入经 OperationGuard 闸门
                                        if (!OperationGuard.canExecute("obsidian.writeImage")) {
                                            OperationGuard.auditDenied("obsidian.writeImage", { itemName: topic.title, trigger: "user_requested_write" }, {
                                                phase: "execute",
                                                reason: "权限不足：Obsidian 图片写入需要 level≥1",
                                            });
                                            throw new Error("权限不足：Obsidian 图片写入需要 level≥1");
                                        }
                                        const imgResult = await ObsidianAPI.writeImage(obsUrl, obsKey, imgPath, blob, getMimeType(ext));
                                        if (!imgResult.ok) throw new Error(imgResult.error);
                                        // P4 收敛(c13): 替换串中的 __BODY__/$1/$ 会被 String.replace 解释 ——
                                        // 用函数形式避免 alt 含 $ 时损坏 Markdown
                                        md = md.replace(img.full, () => `![${img.alt}](${encodeURI(imgPath)})`);
                                    } catch {
                                        // 图片下载失败，保留原始链接
                                        imageFailures++;
                                    }
                                }
                            } else if (obsImgMode === "base64") {
                                const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                                const matches = [];
                                let m;
                                while ((m = imgRegex.exec(md)) !== null) matches.push(m);
                                for (const match of matches.reverse()) {
                                    // P4 收敛(c13): 与主题循环同口径 —— 取消/暂停必须穿透图片内嵌循环
                                    if (Exporter.isCancelled) break;
                                    while (Exporter.isPaused) {
                                        await Utils.sleep(200);
                                        if (Exporter.isCancelled) break;
                                    }
                                    if (Exporter.isCancelled) break;
                                    try {
                                        // SSRF 防护（SEC-003）：match[2] 同为页面解析的 img src，校验外链 URL。
                                        const { UrlValidator } = require("../security/UrlValidator");
                                        if (!UrlValidator.validatePageExternalUrl(match[2])) {
                                            throw new Error("图片 URL 未通过安全校验");
                                        }
                                        const resp = await new Promise((resolve, reject) => {
                                            GM_xmlhttpRequest({
                                                method: "GET",
                                                url: match[2],
                                                responseType: "blob",
                                                timeout: 30000,
                                                // P4 收敛(c13): onload 对 4xx/5xx 同样触发 —— 错误页不得内嵌为 data URL
                                                onload: (r) => {
                                                    if (r.status >= 200 && r.status < 300) resolve(r);
                                                    else reject(new Error(`图片下载失败: HTTP ${r.status}`));
                                                },
                                                onerror: (e) => reject(e),
                                                ontimeout: () => reject(new Error("图片下载超时")),
                                            });
                                        });
                                        const b64 = await new Promise((resolve) => {
                                            const reader = new FileReader();
                                            reader.onloadend = () => resolve(reader.result);
                                            reader.readAsDataURL(resp.response);
                                        });
                                        md = md.replace(match[0], () => `![${match[1]}](${b64})`);
                                    } catch {
                                        // 跳过失败的图片
                                        imageFailures++;
                                    }
                                }
                            }

                            const fileName = UI.sanitizeObsidianFileName(topic.title, `topic-${topicId}`);
                            // v3.14.7 (REV-03 UI-07): Obsidian 写入经 OperationGuard 闸门
                            if (!OperationGuard.canExecute("obsidian.writeNote")) {
                                OperationGuard.auditDenied("obsidian.writeNote", { itemName: topic.title, trigger: "user_requested_write" }, {
                                    phase: "execute",
                                    reason: "权限不足：Obsidian 笔记写入需要 level≥1",
                                });
                                throw new Error("权限不足：Obsidian 笔记写入需要 level≥1");
                            }
                            const noteResult = await ObsidianAPI.writeNote(obsUrl, obsKey, `${obsDir}/${fileName}.md`, md);
                            if (!noteResult.ok) throw new Error(noteResult.error);
                            // v3.14.3 修复: Obsidian 导出成功同样写入已导出账本(与 Notion 导出同构),
                            // 否则 UI 恒显示“待导出”致重复导出。
                            Storage.markTopicExported(topicId);
                            results.success.push({
                                title: topic.title,
                                url: topic.url,
                            });
                        } catch (error) {
                            results.failed.push({
                                title: bookmark.title || `帖子 ${topicId}`,
                                error: error.message,
                            });
                            // 认证/连接终态 fail-fast(v3.14.5):Obsidian key 无效或连接拒绝是系统性错误,
                            // 逐项重试只会重复注定失败的请求——中止批次,剩余项留待重试
                            const msgText = String(error?.message || "");
                            // 认证/连接终态(Obsidian HTTP 401/403 或本地服务拒绝):系统性错误 fail-fast
                            if (/\bHTTP\s*40[13]\b/.test(msgText) || msgText.includes("invalid") || msgText.includes("Invalid") || msgText.includes("ECONNREFUSED") || msgText.includes("refused")) {
                                results.authAborted = { reason: error.message, at: i + 1 };
                                for (let k = i + 1; k < selected.length; k++) {
                                    const skippedBm = selected[k];
                                    results.skipped.push({
                                        title: skippedBm.title || skippedBm.fancy_title || skippedBm.name || `帖子 ${LinuxDoAPI.resolveTopicId(skippedBm)}`,
                                    });
                                }
                                break;
                            }
                        }

                        if (i < selected.length - 1) {
                            await Utils.sleep(300);
                        }
                    }
                }

                UI.hideProgress();
                UI.showReport(results);
                UI.renderBookmarkList();

                const msg = results.authAborted
                    ? `⛔ Obsidian 导出已中止（认证/连接失败）：成功 ${results.success.length} 个，未尝试 ${results.skipped.length} 个。请检查 Obsidian API 地址与 Key 后重试。`
                    : `Obsidian 导出完成：成功 ${results.success.length} 个${results.failed.length ? `，失败 ${results.failed.length} 个` : ""}${imageFailures > 0 ? `，${imageFailures} 张图片下载失败` : ""}`;
                UI.showStatus(msg, results.authAborted ? "error" : ((results.failed.length > 0 || imageFailures > 0) ? "warning" : "success"));
            } catch (error) {
                UI.showStatus(`Obsidian 导出出错: ${error.message}`, "error");
            } finally {
                refs.obsExportBtn.disabled = false;
                refs.exportBtns.style.display = "flex";
                refs.controlBtns.style.display = "none";
                Exporter.reset();
            }
        };

        // v3.16.0: 当前页 → 本地文件 / 发布到 linux.do（linux.do 话题页入口；
        // 对齐 LDStatus Pro：当前页面可直接存为本地文件，也可发布到 linux.do。
        // 存文件为纯本地写不经 Guard；发布经 OperationGuard.execute("linuxdo.publish")
        // + 用户二次确认 + 审计（正文 raw 永不进审计）；成功同样落 clipper 账本。）
        if (refs.pageFileBtn) {
            refs.pageFileBtn.onclick = async () => {
                if (refs.pageFileBtn.disabled) return;
                refs.pageFileBtn.disabled = true;
                try {
                    UI.showStatus("正在提取当前页面内容...", "info");
                    const built = await PageFileExporter.buildCurrentPage();
                    const format = refs.pageFileFormatSelect?.value || "md";
                    let bodyHtml = "";
                    if (format === "html") {
                        const { GenericExtractor } = require("../../extract");
                        const contentEl = GenericExtractor.extractContent();
                        bodyHtml = contentEl ? contentEl.innerHTML : "";
                    }
                    const payload = PageFileExporter.buildFilePayload(built, format, bodyHtml);
                    PageFileExporter.downloadFile(payload.filename, payload.content, payload.mime);
                    try { GenericExporter.markClipperExported(built.meta || {}); } catch (markError) {
                        console.warn("[LD-Notion] 存文件账本标记失败(文件已下载):", markError);
                    }
                    UI.showStatus(`已保存本地文件：${payload.filename}`, "success");
                } catch (error) {
                    UI.showStatus(`存文件失败: ${error.message}`, "error");
                } finally {
                    refs.pageFileBtn.disabled = false;
                }
            };
        }
        if (refs.pagePublishBtn) {
            refs.pagePublishBtn.onclick = async () => {
                if (refs.pagePublishBtn.disabled) return;
                refs.pagePublishBtn.disabled = true;
                try {
                    const mode = refs.pagePublishModeSelect?.value || "topic";
                    const titleInput = (refs.pagePublishTitleInput?.value || "").trim();
                    const topicInput = (refs.pagePublishTopicInput?.value || "").trim();
                    const categoryInput = (refs.pagePublishCategoryInput?.value || "").trim();
                    UI.showStatus("正在提取当前页面内容...", "info");
                    const built = await PageFileExporter.buildCurrentPage();
                    const raw = built.markdown || "";
                    const title = titleInput || built.meta?.title || document.title || "无标题";
                    let params;
                    try {
                        params = PageFileExporter.buildPublishParams({
                            mode, title, raw, category: categoryInput, topicId: topicInput,
                        });
                    } catch (paramError) {
                        UI.showStatus(`发布参数有误: ${paramError.message}`, "error");
                        return;
                    }
                    const itemName = mode === "reply" ? `回复话题 ${params.topic_id}` : `新话题《${params.title}》`;
                    const ok = await ConfirmationDialog.show({
                        title: "发布到 linux.do",
                        message: mode === "reply"
                            ? `将以当前登录身份回复话题 ${params.topic_id}（正文约 ${params.raw.length} 字），发布后不可由脚本撤回，是否继续？`
                            : `将以当前登录身份在 linux.do 发布新话题《${params.title}》（正文约 ${params.raw.length} 字），发布后不可由脚本撤回，是否继续？`,
                        itemName,
                        confirmText: "确认发布",
                        countdown: 0,
                    });
                    if (!ok) { UI.showStatus("已取消发布", "info"); return; }
                    UI.showStatus(mode === "reply" ? "正在回复话题..." : "正在发布新话题...", "info");
                    const result = await OperationGuard.execute("linuxdo.publish", async () => {
                        return mode === "reply"
                            ? LinuxDoAPI.replyToTopic(params)
                            : LinuxDoAPI.createTopic(params);
                    }, {
                        itemName,
                        trigger: "user_requested_write",
                        linuxdoTopicId: mode === "reply" ? params.topic_id : "",
                        linuxdoCategory: mode === "topic" ? (params.category || "") : "",
                    });
                    try { GenericExporter.markClipperExported(built.meta || {}); } catch (markError) {
                        console.warn("[LD-Notion] 发帖账本标记失败(帖子已发布):", markError);
                    }
                    const link = result.topicId ? `https://linux.do/t/${result.topicId}` : "";
                    UI.showStatus(link ? `发布成功：${link}` : "发布成功", "success");
                } catch (error) {
                    UI.showStatus(`发布失败: ${error.message}`, "error");
                } finally {
                    refs.pagePublishBtn.disabled = false;
                }
            };
        }

        // 权限设置事件
        refs.permissionLevelSelect.onchange = (e) => {
            const level = parseInt(e.target.value);
            OperationGuard.setLevel(level);
            UI.showStatus(`权限级别已设置为: ${CONFIG.PERMISSION_NAMES[level]}`, "success");
            // v3.14.7 (REV-13 UI-14): 权限变更后刷新收藏 Tab 摘要(此前仍显示旧级别)
            try { UI.updateExportTargetSummary(); } catch (err) { console.warn("[LD-Notion] 权限摘要刷新失败:", err); }
        };

        refs.requireConfirmCheckbox.onchange = (e) => {
            Storage.set(CONFIG.STORAGE_KEYS.REQUIRE_CONFIRM, e.target.checked);
        };

        refs.enableAuditLogCheckbox.onchange = (e) => {
            const previousState = Storage.get(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, CONFIG.DEFAULTS.enableAuditLog);
            const nextState = !!e.target.checked;
            OperationLog.add({
                audit_event: nextState ? "audit.enabled" : "audit.disabled",
                actor: "user",
                source: "linuxdo-panel",
                operation: {
                    name: "toggleAuditLog",
                    risk: "standard",
                    trigger: "user_settings_change",
                },
                payload: {
                    previousState,
                    newState: nextState,
                },
                result: {
                    status: "success",
                    reason: nextState ? "audit_enabled" : "audit_disabled",
                },
                redaction: [],
                operationName: "toggleAuditLog",
                context: {
                    previousState,
                    newState: nextState,
                },
                startTime: Date.now(),
                endTime: Date.now(),
                status: "success",
            }, { force: true });
            Storage.set(CONFIG.STORAGE_KEYS.ENABLE_AUDIT_LOG, nextState);
            // 更新日志面板可见性
            const logPanel = refs.logPanel
            if (logPanel) {
                logPanel.style.display = nextState ? "block" : "none";
            }
        };

        // 日志面板事件
        refs.logToggleBtn.onclick = () => {
            const content = refs.logContent
            const arrow = refs.logArrow
            content.classList.toggle("collapsed");
            arrow.textContent = content.classList.contains("collapsed") ? "▶" : "▼";
            // P2:aria-expanded 同步 + 键盘可达(Enter/Space)
            refs.logToggleBtn.setAttribute("aria-expanded", String(!content.classList.contains("collapsed")));

            // 展开时更新日志内容
            if (!content.classList.contains("collapsed")) {
                UI.updateLogPanel();
            }
        };
        refs.logToggleBtn.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                refs.logToggleBtn.click();
            }
        };

        refs.logClearBtn.onclick = () => {
            // P2:原生 confirm 统一为 ConfirmationDialog
            ConfirmationDialog.show({
                title: "清除操作日志",
                message: "确定要清除所有操作日志吗？",
                confirmText: "清除",
                onConfirm: () => {
                    OperationLog.clear();
                    UI.showStatus("日志已清除", "success");
                },
            });
        };

        // F-05 修复：数据管理（去重/已导出记录清理）
        const renderDedupSummary = () => {
            const el = refs.dedupSummary;
            if (!el) return;
            const linuxdoCount = Object.keys(DedupStore.getSeen("linuxdo") || {}).length;
            const githubCount = Object.keys(GitHubAPI.getExported() || {}).length + Object.keys(GitHubAPI.getExportedGists() || {}).length;
            const bookmarkCount = Object.keys(BookmarkExporter.getExported() || {}).length;
            el.textContent = `去重/导出记录 —— Linux.do: ${linuxdoCount} 条；GitHub: ${githubCount} 条；书签: ${bookmarkCount} 条`;
        };
        const clearWithConfirm = (label, doClear) => {
            // P2:原生 confirm 统一为 ConfirmationDialog
            ConfirmationDialog.show({
                title: `清除${label}记录`,
                message: `确定清除${label}记录吗？\n清除后该来源的所有内容将可再次导出/导入。`,
                confirmText: "清除",
                onConfirm: () => {
                    doClear();
                    renderDedupSummary();
                    UI.showStatus(`${label}记录已清除`, "success");
                },
            });
        };
        refs.clearLinuxdoDedupBtn.onclick = () => clearWithConfirm("Linux.do 去重", () => {
            // 全盘审计修复: 直调 DedupStore.clearSeen 绕过 Storage._exportedTopicsCache
            // → 同 tab 内 isTopicExported 仍返回 true, 按钮实际无效(刷新后才生效)
            Storage.clearExportedTopics();
        });
        refs.clearGithubExportedBtn.onclick = () => clearWithConfirm("GitHub 已导出", () => GitHubAPI.clearExportedRecords());
        refs.clearBookmarkExportedBtn.onclick = () => clearWithConfirm("书签已导出", () => BookmarkExporter.clearExportedRecords());
        renderDedupSummary();
};

module.exports = { bindExport };
