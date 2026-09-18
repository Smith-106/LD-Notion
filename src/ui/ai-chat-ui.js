"use strict";

// ai-chat-ui.js — AI 对话面板 UI (M3 波次4: 提取自 ai/index.js 消 ISS-016 层级倒置)。
// AI_WELCOME_ENTRY_POINTS + AIWelcomeUI + ChatUI 本属 UI 层却滞留 ai/index —— 迁至 src/ui/。
// 回边(ChatState/AIAssistant/AIClassifier 仍属 ai/index)经 lazy accessor require("../ai") 解循环,
// 与 deps.js 同一缓解口径(运行时 require,非加载期环)。

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { Storage } = require("../storage");
const { ConfirmationDialog } = require("../security");

// lazy accessor —— 回边模块运行时获取(此时 ai/index 已加载完毕)。
let _ai = null; const AI = () => (_ai || (_ai = require("../ai")));
const ChatState = () => AI().ChatState;
const AIAssistant = () => AI().AIAssistant;
const AIClassifier = () => AI().AIClassifier;

const AI_WELCOME_ENTRY_POINTS = Object.freeze({
    subtitle: "稳定支持：数据库 / 页面检索、跨源搜索、批量分类、GitHub / 书签导入、页面摘要；更多能力看「帮助」",
    inputPlaceholder: "输入指令，如「列出所有数据库」或「导入GitHub收藏」...",
    chips: Object.freeze([
        { command: "帮助", label: "💡 帮助" },
        { command: "列出所有数据库", label: "🗂️ 数据库" },
        { command: "在工作区搜索所有页面", label: "📄 页面" },
        { command: "跨源搜索最近收藏的帖子", label: "🔍 跨源搜索" },
        { command: "自动分类所有未分类的帖子", label: "🏷️ 分类" },
        { command: "导入GitHub收藏", label: "🐙 GitHub" },
        { command: "导入浏览器书签", label: "📖 书签" }
    ]),
});

const AIWelcomeUI = {
    render: (personaName) => {
        const chips = AI_WELCOME_ENTRY_POINTS.chips
            .map((chip) => `<button class="ldb-chat-chip" data-cmd="${Utils.escapeHtml(chip.command)}">${Utils.escapeHtml(chip.label)}</button>`)
            .join("");
        return `
            <div class="ldb-chat-welcome">
                <div class="ldb-chat-welcome-icon">🤖</div>
                <div class="ldb-chat-welcome-text">
                    你好！我是 ${Utils.escapeHtml(personaName)}<br>
                    <small>${Utils.escapeHtml(AI_WELCOME_ENTRY_POINTS.subtitle)}</small>
                </div>
                <div class="ldb-chat-chips">
                    ${chips}
                </div>
            </div>
        `;
    },

    getInputPlaceholder: () => AI_WELCOME_ENTRY_POINTS.inputPlaceholder,
};

// ===========================================
const ChatUI = {
    // HTML 转义函数，防止 XSS 攻击
    escapeHtml: (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // 安全的 Markdown 渲染（先转义再处理 Markdown）
    safeMarkdown: (text) => {
        // 先转义 HTML 特殊字符
        let escaped = Utils.escapeHtml(text);
        // 再处理安全的 Markdown 格式
        return escaped
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    },

    // 增量更新最后一个气泡 DOM（PERF-006）。
    // 返回 true 表示已成功 patch，false 表示需要回退到全量 renderMessages。
    _patchLastBubble: () => {
        const container = document.querySelector("#ldb-chat-messages");
        if (!container) return false;
        const bubbles = container.querySelectorAll(".ldb-chat-message");
        if (bubbles.length !== ChatState().messages.length) return false;
        const lastMsg = ChatState().messages[ChatState().messages.length - 1];
        const lastBubble = bubbles[bubbles.length - 1]?.querySelector(".ldb-chat-bubble");
        if (!lastBubble) return false;

        const statusClass = lastMsg.status === "processing" ? "processing" : (lastMsg.status === "error" ? "error" : "");
        const content = lastMsg.status === "processing"
            ? '思考中<span class="ldb-typing-dots"><span></span><span></span><span></span></span>'
            : ChatUI.safeMarkdown(AIAssistant()._resultToText(lastMsg.content));

        lastBubble.className = `ldb-chat-bubble ${lastMsg.role === "user" ? "user" : "assistant"} ${statusClass}`.trim();
        lastBubble.innerHTML = content;
        container.scrollTop = container.scrollHeight;
        return true;
    },

    // 渲染消息列表
    renderMessages: () => {
        const container = document.querySelector("#ldb-chat-messages");
        if (!container) return;

        if (ChatState().messages.length === 0) {
            const personaName = Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName);
            container.innerHTML = AIWelcomeUI.render(personaName);
            // 绑定 chip 点击
            container.querySelectorAll(".ldb-chat-chip").forEach(chip => {
                chip.onclick = () => {
                    const input = document.querySelector("#ldb-chat-input");
                    if (input) {
                        input.value = chip.getAttribute("data-cmd");
                        ChatUI.sendMessage();
                    }
                };
            });
            return;
        }

        container.innerHTML = ChatState().messages.map(msg => {
            const isUser = msg.role === "user";
            const statusClass = msg.status === "processing" ? "processing" : (msg.status === "error" ? "error" : "");

            // processing 状态使用预设动画，不经过 Markdown 渲染
            const content = msg.status === "processing"
                ? '思考中<span class="ldb-typing-dots"><span></span><span></span><span></span></span>'
                : ChatUI.safeMarkdown(AIAssistant()._resultToText(msg.content));

            return `
                <div class="ldb-chat-message ${isUser ? 'user' : 'assistant'}">
                    <div class="ldb-chat-bubble ${isUser ? 'user' : 'assistant'} ${statusClass}">
                        ${content}
                    </div>
                </div>
            `;
        }).join('');

        // 滚动到底部
        container.scrollTop = container.scrollHeight;
    },

    // 发送消息
    sendMessage: async () => {
        const input = document.querySelector("#ldb-chat-input");
        const sendBtn = document.querySelector("#ldb-chat-send");
        if (!input) return;

        const message = input.value.trim();
        if (!message || ChatState().isProcessing) return;

        // 禁用输入区域
        if (input) input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;

        // P4 收敛(c03): 状态变更(存储写入/渲染)纳入 try —— 此前抛错会跳过 finally,
        // 输入框与发送按钮永久禁用、isProcessing 永久 true
        try {
            // 清空输入框
            input.value = "";
            input.style.height = "auto";

            // 添加用户消息
            ChatState().addMessage("user", message);

            // 添加 AI 回复占位
            ChatState().isProcessing = true;
            ChatState().addMessage("assistant", "思考中...", "processing");

            const response = await AIAssistant().handleMessage(message);
            // P3(qwen, 主 agent 复核): handleMessage 可返回 {status:"error"} 结构化结果而非抛错,
            // 原实现一律标 complete, UI 状态机与执行结果相反。
            ChatState().updateLastMessage(response, AIAssistant()._isErrorResult(response) ? "error" : "complete");
        } catch (error) {
            console.error("[LD-Notion] AI 处理失败:", error);
            // P4 收敛(c03): addMessage 自身抛错时可能无占位消息, 兜底避免异常逃逸
            try {
                ChatState().updateLastMessage(`❌ 处理失败: ${error.message}`, "error");
            } catch (updateError) {
                console.error("[LD-Notion] 更新失败消息也出错:", updateError);
            }
        } finally {
            ChatState().isProcessing = false;
            // 恢复输入区域
            if (input) input.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.focus();
        }
    },

    // 绑定事件
    bindEvents: () => {
        // 发送按钮
        const sendBtn = document.querySelector("#ldb-chat-send");
        if (sendBtn) {
            sendBtn.onclick = ChatUI.sendMessage;
        }

        // Enter 发送
        const input = document.querySelector("#ldb-chat-input");
        if (input) {
            input.onkeydown = (e) => {
                // 阻止事件冒泡到 Notion
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ChatUI.sendMessage();
                }
            };

            // 阻止粘贴、复制、剪切等事件冒泡到 Notion
            input.onpaste = (e) => e.stopPropagation();
            input.oncopy = (e) => e.stopPropagation();
            input.oncut = (e) => e.stopPropagation();
            input.oninput = (e) => {
                e.stopPropagation();
                // textarea 自动增高
                input.style.height = "auto";
                input.style.height = Math.min(input.scrollHeight, 80) + "px";
            };
            input.onkeyup = (e) => e.stopPropagation();
            input.onkeypress = (e) => e.stopPropagation();
        }

        // 清空对话
        const clearBtn = document.querySelector("#ldb-chat-clear");
        if (clearBtn) {
            clearBtn.onclick = async () => {
                // v3.14.7 (REV-19 UI-02): 原生 confirm 遗留 → ConfirmationDialog 统一(其余危险操作已全迁移)
                const confirmed = await ConfirmationDialog.show({
                    title: "清空对话历史",
                    message: "确定要清空对话历史吗？",
                    countdown: 3,
                });
                if (confirmed) {
                    ChatState().clear();
                }
            };
        }

        // F-03 修复：批量分类暂停/取消控制（三面板共享 ChatUI 在此统一绑定）
        const classifyPauseBtn = document.querySelector("#ldb-classify-pause");
        if (classifyPauseBtn) {
            classifyPauseBtn.onclick = () => {
                if (AIClassifier().isPaused) {
                    AIClassifier().resume();
                    classifyPauseBtn.textContent = "⏸️ 暂停分类";
                } else {
                    AIClassifier().pause();
                    classifyPauseBtn.textContent = "▶️ 继续分类";
                }
            };
        }
        const classifyCancelBtn = document.querySelector("#ldb-classify-cancel");
        if (classifyCancelBtn) {
            classifyCancelBtn.onclick = async () => {
                // v3.14.7 (REV-19 UI-02): 原生 confirm 遗留 → ConfirmationDialog 统一
                const confirmed = await ConfirmationDialog.show({
                    title: "取消批量分类",
                    message: "确定要取消批量分类吗？已完成的部分不会丢失。",
                    countdown: 3,
                });
                if (confirmed) {
                    AIClassifier().cancel();
                }
            };
        }
    },

    // 初始化
    init: () => {
        ChatState().load();
        ChatUI.renderMessages();
        ChatUI.bindEvents();
    },
};

module.exports = { AI_WELCOME_ENTRY_POINTS, AIWelcomeUI, ChatUI };
