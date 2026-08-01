"use strict";

// Handlers.js — AI 意图执行处理器 shell（TASK-005, P5_handler_split）。
// 原 2277 行巨石已拆分为 4 个域文件，本文件仅做 spread merge。
// Object.assign(AIAssistant, AIHandlers) 在 ai/index.js 中保留不变（ARCH-001 mixin 语义）。

const { handleQuery, handleSearch, handleWorkspaceSearch } = require("./handlers/query");
const { handleUpdate, _resolveDatabaseId, _fetchSourcePages, handleMove, handleCopy, handleCompound, handleCreateDatabase } = require("./handlers/pageCrud");
const { _resolvePageId, _textToBlocks, _extractPageContent, handleWriteContent, handleEditContent, handleTranslateContent, _ensureAIProperty, handleAIAutofill, handleAsk, handleDeepResearch, handleSummarize, handleBrainstorm, handleProofread, handleTemplateOutput } = require("./handlers/content");
const { handleClassify, handleBatchClassify, handleBatchTranslate, handleExtractToDatabase, handleGeneratePages, handleBatchAnalyze, handleGitHubImport, handleBookmarkImport } = require("./handlers/batch");

const AIHandlers = {
    handleQuery,
    handleSearch,
    handleWorkspaceSearch,
    handleUpdate,
    _resolveDatabaseId,
    _fetchSourcePages,
    handleMove,
    handleCopy,
    handleCompound,
    handleCreateDatabase,
    _resolvePageId,
    _textToBlocks,
    _extractPageContent,
    handleWriteContent,
    handleEditContent,
    handleTranslateContent,
    _ensureAIProperty,
    handleAIAutofill,
    handleAsk,
    handleDeepResearch,
    handleSummarize,
    handleBrainstorm,
    handleProofread,
    handleTemplateOutput,
    handleClassify,
    handleBatchClassify,
    handleBatchTranslate,
    handleExtractToDatabase,
    handleGeneratePages,
    handleBatchAnalyze,
    handleGitHubImport,
    handleBookmarkImport,
};

module.exports = { AIHandlers };
