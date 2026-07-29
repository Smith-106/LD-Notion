"use strict";

const { CONFIG } = require("../config");
const { Storage } = require("../storage");
const { TargetState } = require("../auth");
const { OperationGuard } = require("../security");
const { AgentTrace } = require("./AgentTrace");
const { AI_AGENT_TOOLS } = require("./AgentTools");

let _AI = null;
const AI = () => { if (!_AI) _AI = require("./index").AIAssistant; return _AI; };
const ChatState = new Proxy({}, { get: (_, prop) => require("./index").ChatState[prop] });
const AIService = new Proxy({}, { get: (_, prop) => require("./index").AIService[prop] });

const AgentExecutor = {

    _generateAgentPlan: async (params, settings) => {
        const { task_description } = params;

        const planPrompt = `你是一个 Notion 任务规划器。将用户的高层任务分解为可执行步骤。
每一步必须是以下操作之一：query, search, workspace_search, classify, batch_classify,
update, move, copy, create_database, write_content, edit_content, translate_content,
ai_autofill, ask, deep_research, template_output, summarize, brainstorm, proofread,
batch_translate, extract_to_database, generate_pages, batch_analyze

返回 JSON（只返回 JSON，不要其他内容）：
{
  "plan": [
{ "intent": "操作名", "params": { 对应操作的参数 }, "explanation": "步骤说明" }
  ],
  "explanation": "整体计划说明"
}

用户任务：${task_description}`;

        const planResponse = await AIService.requestChat(planPrompt, settings, 1500);

        // ISS-013: 统一走 parseAIJson 接缝（arch-013），消除手工 jsonMatch+JSON.parse 三段式。
        // validateAgentPlanSchema 校验 plan 为非空 Array 且每项含 explanation；ok=false 返回错误提示。
        const planResult = AISchema.parseAIJson("agentPlan", planResponse);
        if (!planResult.ok) {
            console.warn("[LD-Notion] Agent 计划 JSON 解析失败:", planResult.reason);
            return "❌ Agent 生成的计划格式无效。请尝试换一种方式描述。";
        }
        const plan = planResult.value;

        if (!plan.plan || plan.plan.length === 0) {
            return "❌ Agent 未能分解出有效的执行步骤。请尝试更具体地描述任务。";
        }

        // 展示计划并等待确认
        let planMsg = `🤖 **Agent 执行计划**\n${plan.explanation || ""}\n\n`;
        plan.plan.forEach((step, i) => {
            planMsg += `${i + 1}. ${step.explanation}\n`;
        });

        ChatState.updateLastMessage(planMsg + "\n⏳ 等待确认...", "processing");

        const confirmed = await ConfirmationDialog.show({
            title: "🤖 Agent 执行计划确认",
            message: plan.plan.map((s, i) => `${i + 1}. ${s.explanation}`).join("\n"),
            itemName: task_description,
            countdown: 5,
            requireNameInput: false,
        });

        if (!confirmed) {
            return "🤖 Agent 任务已取消。";
        }

        return { plan, planMsg };
    },

    // 执行 Agent 计划并生成汇总报告。
    // W5 (MAINT-004/011): 从 handleAgentTask 提取。executeIntent 异常被内部 catch 捕获（降级，coding-conventions-007）。
    _executeAgentPlan: async (plan, settings, planMsg) => {
        // 执行计划（复用 compound 的执行模式）
        const results = [];
        let aborted = false;

        for (let i = 0; i < plan.plan.length; i++) {
            const step = plan.plan[i];

            ChatState.updateLastMessage(
                `${planMsg}\n⏳ 步骤 ${i + 1}/${plan.plan.length}: ${step.explanation}`,
                "processing"
            );

            try {
                const stepResult = await AI().executeIntent(step, settings);
                const normalizedStepResult = AI()._normalizeExecutionResult(stepResult);

                if (AI()._isErrorResult(normalizedStepResult)) {
                    results.push({ index: i + 1, explanation: step.explanation, success: false, result: normalizedStepResult });
                    aborted = true;
                    break;
                }

                results.push({ index: i + 1, explanation: step.explanation, success: true, result: normalizedStepResult });
            } catch (error) {
                results.push({
                    index: i + 1,
                    explanation: step.explanation,
                    success: false,
                    result: AI()._normalizeExecutionResult(`❌ ${error.message}`, { status: "error", name: step.intent })
                });
                aborted = true;
                break;
            }
        }

        // 汇总报告
        let report = `🤖 **Agent 任务${aborted ? "中断" : "完成"}**\n\n`;
        for (const r of results) {
            report += `${r.success ? "✅" : "❌"} 步骤 ${r.index}: ${r.explanation}\n`;
        }

        if (aborted) {
            const skipped = plan.plan.slice(results.length);
            if (skipped.length > 0) {
                report += `\n⏭️ 已跳过：\n`;
                skipped.forEach((step, i) => {
                    report += `${results.length + i + 1}. ${step.explanation}\n`;
                });
            }
        }

        report += `\n---\n`;
        for (const r of results) {
            report += `\n**步骤 ${r.index}**: ${r.explanation}\n${AI()._resultToText(r.result)}\n`;
        }

        return report;
    },

    handleAgentTask: async (params, settings, explanation) => {
        const configCheck = AI().checkConfig(settings, false);
        if (!configCheck.valid) return configCheck.error;

        if (!OperationGuard.canExecute("agentTask")) {
            return "❌ 权限不足：Agent 自主代理需要「高级」权限级别。\n\n请在设置面板中将权限级别调整为「高级」或更高。";
        }

        const { task_description } = params;
        if (!task_description) {
            return "❌ 请描述你想让 Agent 完成的任务。\n\n💡 示例：「帮我整理所有未分类的帖子并生成摘要」";
        }

        ChatState.updateLastMessage("🤖 Agent 正在规划任务...", "processing");

        try {
            const generated = await AI()._generateAgentPlan(params, settings);
            if (typeof generated === "string") return generated;
            const { plan, planMsg } = generated;

            return await AI()._executeAgentPlan(plan, settings, planMsg);
        } catch (error) {
            return `❌ Agent 任务失败: ${error.message}`;
        }
    },

    // ======= Agent Loop (ReAct 模式) =======

    // 尝试解析 AI 回复为工具调用 JSON
    _tryParseToolCall: (response) => {
        if (!response) return null;
        const trimmed = response.trim();
        // 尝试直接解析整个响应为 JSON
        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
            if (parsed.tool && typeof parsed.tool === "string") {
                // 白名单校验：tool 必须在 AI_AGENT_TOOLS 中定义
                const toolDef = AI_AGENT_TOOLS[parsed.tool];
                if (!toolDef) {
                    console.warn(`[LD-Notion] _tryParseToolCall: 拒绝未知工具 "${parsed.tool}"`);
                    return null;
                }
                // 参数类型校验：args 必须是对象
                if (parsed.args !== undefined && (typeof parsed.args !== "object" || parsed.args === null || Array.isArray(parsed.args))) {
                    console.warn(`[LD-Notion] _tryParseToolCall: 工具 "${parsed.tool}" 的参数类型无效`);
                    return null;
                }
                return parsed;
            }
        } catch (error) {
            console.warn("[LD-Notion] 工具调用解析失败:", error);
        }
        // 尝试提取嵌入的 JSON
        const jsonMatch = trimmed.match(/\{[\s\S]*"tool"\s*:\s*"[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[0]);
                if (parsed.tool && typeof parsed.tool === "string") {
                    // 白名单校验：tool 必须在 AI_AGENT_TOOLS 中定义
                    const toolDef = AI_AGENT_TOOLS[parsed.tool];
                    if (!toolDef) {
                        console.warn(`[LD-Notion] _tryParseToolCall: 拒绝未知工具 "${parsed.tool}"`);
                        return null;
                    }
                    // 参数类型校验：args 必须是对象
                    if (parsed.args !== undefined && (typeof parsed.args !== "object" || parsed.args === null || Array.isArray(parsed.args))) {
                        console.warn(`[LD-Notion] _tryParseToolCall: 工具 "${parsed.tool}" 的参数类型无效`);
                        return null;
                    }
                    return parsed;
                }
            } catch (error) {
                console.warn("[LD-Notion] 工具调用解析失败:", error);
            }
        }
        return null;
    },

    // 构建 Agent 系统提示（含可用工具列表、工作区上下文、persona 个性化）。
    // W5 (MAINT-003/011): 从 runAgentLoop 提取，保留 prompt injection 防御
    // （persona.instructions 过滤 + <user_input> 包裹由调用方 runAgentLoop 注入，learnings-003）。
    _buildAgentSystemPrompt: (permLevel, availableTools, settings) => {
        const aiTargetState = TargetState.getDisplayAITargetState();
        let dbInfo;
        if (aiTargetState.mode === "all") {
            let cached;
            try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch (error) {
                console.warn("[LD-Notion] 工作区页面缓存解析失败:", error);
                cached = {};
            }
            const dbCount = cached.databases?.length || 0;
            dbInfo = `查询模式: 所有工作区数据库 (${dbCount} 个)`;
        } else if (aiTargetState.mode === "database") {
            let cached;
            try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch (error) {
                console.warn("[LD-Notion] 工作区页面缓存解析失败:", error);
                cached = {};
            }
            const dbName = cached.databases?.find(d => d.id === aiTargetState.databaseId)?.title || aiTargetState.databaseId;
            dbInfo = `已配置的数据库: ${dbName} (ID: ${aiTargetState.databaseId})`;
        } else if (aiTargetState.mode === "page") {
            let cached;
            try { cached = JSON.parse(Storage.get(CONFIG.STORAGE_KEYS.WORKSPACE_PAGES, "{}")); } catch (error) {
                console.warn("[LD-Notion] 工作区页面缓存解析失败:", error);
                cached = {};
            }
            const pageName = cached.pages?.find(p => p.id === aiTargetState.pageId)?.title || aiTargetState.pageId;
            dbInfo = `当前 AI 目标页面: ${pageName} (ID: ${aiTargetState.pageId})`;
        } else {
            dbInfo = settings.notionDatabaseId ? `已配置的数据库 ID: ${settings.notionDatabaseId}` : "未配置数据库 ID";
        }

        // 读取 Agent 个性化配置
        const persona = {
            name: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_NAME, CONFIG.DEFAULTS.agentPersonaName),
            tone: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_TONE, CONFIG.DEFAULTS.agentPersonaTone),
            expertise: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_EXPERTISE, CONFIG.DEFAULTS.agentPersonaExpertise),
            instructions: Storage.get(CONFIG.STORAGE_KEYS.AGENT_PERSONA_INSTRUCTIONS, CONFIG.DEFAULTS.agentPersonaInstructions),
        };

        const personaBlock = persona.instructions
            ? `\n个性化指令：${String(persona.instructions).slice(0, 500).replace(/<system|ignore previous|ignore all previous|disregard|you are now|new instructions/gi, "[已过滤]")}`
            : "";

        return `你是${persona.name}，一个专注于${persona.expertise}的助手。语气风格：${persona.tone}。${personaBlock}
你可以使用以下工具来完成用户的任务。

当前环境：${dbInfo}
当前权限级别：${CONFIG.PERMISSION_NAMES[permLevel] || permLevel}

可用工具：
${availableTools}

使用规则：
1. 每次回复只能做一件事：调用一个工具 OR 给用户最终回复
2. 调用工具时，只返回 JSON（不要包含其他文字）：
   {"tool": "工具名", "args": {参数对象}, "thought": "你的思考过程"}
3. 给用户最终回复时，直接返回文本（不要 JSON 格式）
4. 根据工具返回的结果决定下一步行动
5. 如果任务需要多步，逐步执行，每次一个工具调用
6. 执行写入/修改操作前，先用读取工具确认目标存在
7. 参数值必须是具体的值，不要用占位符`;
    },

    // 执行单次 Agent 工具调用（4 分支：未知工具/权限不足/Level≥1需确认/Level=0直接执行）。
    // W5 (MAINT-003/011): 从 runAgentLoop 提取，保留 OperationGuard.execute 闸门 + 取消语义。
    _executeAgentToolCall: async (toolCall, settings, permLevel) => {
        const tool = AI().AGENT_TOOLS[toolCall.tool];
        let result;
        if (!tool) {
            result = AI()._normalizeExecutionResult(
                `错误: 未知工具 "${toolCall.tool}"。可用工具: ${Object.keys(AI().AGENT_TOOLS).filter(name => AI().AGENT_TOOLS[name].level <= permLevel).join(", ")}`,
                { source: "tool", name: toolCall.tool, status: "error" }
            );
        } else if (tool.level > permLevel) {
            result = AI()._normalizeExecutionResult(
                `错误: 权限不足，"${toolCall.tool}" 需要「${CONFIG.PERMISSION_NAMES[tool.level]}」权限，当前为「${CONFIG.PERMISSION_NAMES[permLevel]}」`,
                { source: "tool", name: toolCall.tool, status: "error" }
            );
        } else {
            // Level >= 1 的写入操作需要用户确认
            if (tool.level >= 1) {
                try {
                    result = await OperationGuard.execute(toolCall.tool, async () => {
                        return await tool.execute(toolCall.args || {}, settings);
                    }, {
                        source: "ai-agent-loop",
                        actor: "ai",
                        itemName: toolCall.tool,
                        trigger: "ai_tool_execution",
                    });
                } catch (guardError) {
                    if (guardError.message === "操作已取消") {
                        result = AI()._normalizeExecutionResult(
                            `错误: 用户取消了 "${toolCall.tool}" 操作的执行`,
                            { source: "tool", name: toolCall.tool, status: "cancelled" }
                        );
                    } else {
                        result = AI()._normalizeExecutionResult(`错误: ${guardError.message}`, {
                            source: "tool",
                            name: toolCall.tool,
                            status: "error",
                        });
                    }
                }
            } else {
                try {
                    result = await tool.execute(toolCall.args || {}, settings);
                } catch (e) {
                    result = AI()._normalizeExecutionResult(`错误: ${e.message}`, {
                        source: "tool",
                        name: toolCall.tool,
                        status: "error",
                    });
                }
            }
        }
        return result;
    },

    // 核心 Agent 循环
    runAgentLoop: async (userMessage, settings, maxIterations = Storage.get(CONFIG.STORAGE_KEYS.AGENT_MAX_ITERATIONS, CONFIG.DEFAULTS.agentMaxIterations)) => {
        const permLevel = OperationGuard.getLevel();

        // ISS-012 MAINT-002: 创建调用链路 trace（observability），出口 persist 落盘。
        const trace = AgentTrace.create(userMessage);

        // 1. 构建系统提示（含可用工具列表，根据权限过滤）
        const availableTools = Object.entries(AI().AGENT_TOOLS)
            .filter(([_, tool]) => tool.level <= permLevel)
            .map(([name, tool]) => `- ${name}: ${tool.description} | 参数: ${tool.params}`)
            .join("\n");

        const systemPrompt = AI()._buildAgentSystemPrompt(permLevel, availableTools, settings);

        // 2. Agent 循环（<user_input> 包裹防 prompt injection，learnings-003）
        const messages = [{ role: "user", content: `<user_input>\n${userMessage}\n</user_input>` }];
        let iteration = 0;

        while (iteration < maxIterations) {
            iteration++;
            trace.iterations = iteration;
            ChatState.updateLastMessage(
                `🤖 Agent 思考中... (${iteration}/${maxIterations})`,
                "processing"
            );

            // 调用 AI
            let response;
            try {
                response = await AIService.requestAgentChat(
                    systemPrompt, messages, settings, 1500
                );
            } catch (error) {
                AgentTrace.recordError(trace, error);
                AgentTrace.persist(trace, "failed", `❌ AI 调用失败: ${error.message}`);
                return `❌ AI 调用失败: ${error.message}`;
            }

            // 尝试解析为工具调用
            const toolCall = AI()._tryParseToolCall(response);

            if (!toolCall) {
                // 不是工具调用 → 最终回复
                AgentTrace.persist(trace, "completed", response);
                return response;
            }

            // 记录 AI 的工具调用
            messages.push({ role: "assistant", content: response });

            // 执行工具
            const thoughtText = toolCall.thought ? `\n💭 ${toolCall.thought}` : "";
            ChatState.updateLastMessage(
                `🤖 正在执行: ${toolCall.tool}...${thoughtText}`,
                "processing"
            );

            AgentTrace.recordToolCall(trace, toolCall, iteration);
            const result = await AI()._executeAgentToolCall(toolCall, settings, permLevel);
            AgentTrace.recordResult(trace, toolCall, result, iteration);

            // 将工具结果喂回 AI
            messages.push({ role: "user", content: `[工具结果] ${toolCall.tool}:\n${AI()._resultToAgentPayload(result)}` });
        }

        const maxMsg = "🤖 Agent 达到最大执行步数，已停止。如果任务尚未完成，请继续描述你的需求。";
        AgentTrace.persist(trace, "max_iterations", maxMsg);
        return maxMsg;
    },


};

module.exports = { AgentExecutor };
