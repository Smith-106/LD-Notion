"use strict";

// tools/meta-tools.js — 元转发类工具（委托 intent 执行）（TASK-006, P6_agenttools_split）。
// 从 AgentTools.js 程序化提取，逻辑零修改。

const { CONFIG } = require("../../config");
const { Utils } = require("../../utils");
const { Storage } = require("../../storage");
const { TargetState } = require("../../auth");
const { NotionAPI } = require("../../api");
const { OperationGuard } = require("../../security");
const { getAI: AI, getService: svc } = require("../deps");

module.exports = {
    research_report: {
        description: "深入研究指定主题，多关键词搜索并生成结构化研究报告",
        params: "research_topic(研究主题), scope(范围:workspace/database,默认workspace)",
        level: 0,
        execute: async (args, settings) => {
            return await AI().handleDeepResearch(args, settings, "Agent工具调用");
        }
    },

    // === 公式编写辅助 (Level 1) ===

    generate_formula: {
        description: "根据自然语言描述生成 Notion 数据库公式",
        params: "description(功能描述), database_name/database_id(目标数据库,可选), property_name(目标属性名,可选)",
        level: 1,
        execute: async (args, settings) => {
            const { description, database_name, database_id, property_name } = args;
            if (!description) return "错误: 请描述你想要的公式功能。";

            // 获取数据库 schema 作为上下文
            let schemaDesc = "";
            const dbId = database_id || settings.notionDatabaseId;
            if (dbId) {
                try {
                    const database = await NotionAPI.fetchDatabase(dbId, settings.notionApiKey);
                    const props = Object.entries(database.properties || {})
                        .map(([name, prop]) => `${name}(${prop.type})`)
                        .join(", ");
                    schemaDesc = `数据库属性: ${props}`;
                } catch (error) {
                    console.warn("[LD-Notion] 数据库属性获取失败:", error);
                    schemaDesc = "";
                }
            }

            const prompt = `你是 Notion 公式专家。根据以下信息生成 Notion 公式。

${schemaDesc ? schemaDesc + "\n" : ""}用户需求: ${description}

请返回以下格式:
公式: <Notion公式表达式>
说明: <公式功能简述>
示例: <公式返回值示例>

注意：使用 Notion 的公式语法（prop(), if(), contains() 等函数）。`;

            const result = await svc().requestChat(prompt, settings, 500);
            let response = `📐 **Notion 公式生成**\n\n${result}`;
            if (property_name) {
                response += `\n\n💡 请将此公式手动设置到数据库属性「${property_name}」中（Notion API 暂不支持直接写入公式属性）。`;
            }
            return response;
        }
    },

    summarize_page: {
        description: "总结指定页面的内容，生成关键信息摘要",
        params: "page_name/page_id(目标页面), style(摘要风格:brief/detailed/bullet,默认brief)",
        level: 0,
        execute: async (args, settings) => {
            return await AI().handleSummarize(args, settings, "Agent工具调用");
        }
    },

    brainstorm_ideas: {
        description: "根据主题进行头脑风暴，生成创意列表或方案建议",
        params: "topic(主题), count(生成数量,默认10), style(风格:practical/creative/wild,默认practical)",
        level: 0,
        execute: async (args, settings) => {
            return await AI().handleBrainstorm(args, settings, "Agent工具调用");
        }
    },

    proofread_content: {
        description: "校对页面内容，纠正拼写、语法和表达问题",
        params: "page_name/page_id(目标页面)",
        level: 0,
        execute: async (args, settings) => {
            return await AI().handleProofread(args, settings, "Agent工具调用");
        }
    },

    batch_translate_database: {
        description: "批量翻译数据库中所有页面的内容",
        params: "database_name/database_id(目标数据库), target_language(目标语言,如英文/日文)",
        level: 1,
        execute: async (args, settings) => {
            return await AI().handleBatchTranslate(args, settings, "Agent工具调用");
        }
    },

    extract_to_database: {
        description: "从页面内容中提取结构化信息，创建数据库并填充条目",
        params: "page_name/page_id(源页面), database_name(新数据库名称), extraction_prompt(提取要求描述)",
        level: 2,
        execute: async (args, settings) => {
            return await AI().handleExtractToDatabase(args, settings, "Agent工具调用");
        }
    },

    generate_structured_pages: {
        description: "根据需求生成多页面结构化内容（如入职指南、竞品分析报告）",
        params: "topic(主题), structure_prompt(结构描述), parent_page_name/parent_page_id(父页面,可选)",
        level: 2,
        execute: async (args, settings) => {
            return await AI().handleGeneratePages(args, settings, "Agent工具调用");
        }
    },

    batch_analyze_pages: {
        description: "批量分析数据库中的页面，生成跨页面综合分析报告",
        params: "database_name/database_id(目标数据库), analysis_prompt(分析要求), limit(分析页数,默认10)",
        level: 0,
        execute: async (args, settings) => {
            return await AI().handleBatchAnalyze(args, settings, "Agent工具调用");
        }
    },

};
