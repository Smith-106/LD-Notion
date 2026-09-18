"use strict";

// quick-intent.js — 快速意图分类规则 (M3 波次6: 提取自 ai/index.js ~288 LOC)。
// QUICK_INTENT_PATTERNS(正则) + QUICK_INTENT_RULES(优先级+buildResult 回调),纯数据无外部依赖。

const QUICK_INTENT_PATTERNS = Object.freeze({
    blockId: /\bblock[_:-]?([A-Za-z0-9-]{6,})\b/i,
    commentId: /\bcomment[_:-]?([A-Za-z0-9-]{3,})\b/i,
    notionUrl: /https?:\/\/(?:www\.)?notion\.so\/\S+/i,
    url: /https?:\/\/\S+/i,
    emoji: /[\p{Extended_Pictographic}]/u,
    commentReplyTail: /\bcomment[_:-]?([A-Za-z0-9-]{3,})\b[：:]\s*(.+)$/i,
    replyVerb: /(回复|reply|回覆)/i,
    commentReadVerb: /(查看|读取|显示|详情|comment)/i,
    restoreVerb: /(恢复|还原|取消归档|取消存档|移出归档|从归档恢复)/,
    archiveVerb: /(归档|删除到归档|软删除|移到归档|放到归档|送到归档)/,
    unlockVerb: /(?:解锁|取消锁定|取消上锁|取消锁住|\bunlock\b)/i,
    lockVerb: /(?:锁定|锁住|上锁|\block\b)/i,
    iconKeyword: /(图标|icon)/i,
    coverKeyword: /(封面|cover)/i,
    markdownKeyword: /(markdown|md|原文|全文)/i,
    commentKeyword: /(评论|讨论)/,
    commentReadKeyword: /(查看|读取|列出|显示)/,
    databaseKeyword: /(数据库|db|database)/i,
    schemaKeyword: /(结构|schema|字段|属性|列)/i,
    detailKeyword: /(详情|信息|对象|看看|读取)/,
    blockUpdateVerb: /(改成|修改为|更新为|替换为)/,
    appendVerb: /(插入|追加|添加)/,
    pageKeyword: /(页面|page)/i,
    blockStructurePhrase: /(块结构|子块)/,
    blockKeyword: /block/i,
    objectReadVerb: /(查看|读取|详情|对象|fetch)/i,
    rawIdReadVerb: /(查看|读取|详情|对象|页面|数据库)/,
    afterBlockKeyword: /(后插入|后面插入|后追加|after)/i,
});

const QUICK_INTENT_RULES = Object.freeze([
    {
        id: "comment.reply",
        intent: "create_comment",
        priority: 1000,
        requires: ["commentId", "hasReplyVerb", "commentReplyContent"],
        buildResult: (ctx) => ({
            intent: "create_comment",
            params: {
                comment_id: ctx.commentId,
                content: ctx.commentReplyContent
            },
            explanation: "根据明确的 comment_id 回复已有评论"
        })
    },
    {
        id: "comment.detail",
        intent: "get_comment",
        priority: 990,
        requires: ["commentId", "hasCommentReadVerb"],
        rejects: ["hasReplyVerb"],
        buildResult: (ctx) => ({
            intent: "get_comment",
            params: { comment_id: ctx.commentId },
            explanation: "根据明确的 comment_id 读取评论详情"
        })
    },
    {
        id: "page.restore",
        intent: "restore_page",
        priority: 950,
        requires: ["firstQuoted", "hasRestoreVerb"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "restore_page",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称恢复页面"
        })
    },
    {
        id: "page.archive",
        intent: "archive_page",
        priority: 940,
        requires: ["firstQuoted", "hasArchiveVerb"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "archive_page",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称归档页面"
        })
    },
    {
        id: "page.unlock",
        intent: "update_page",
        priority: 930,
        requires: ["firstQuoted", "hasUnlockVerb"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, is_locked: false },
            explanation: "根据明确的页面名称解锁页面"
        })
    },
    {
        id: "page.lock",
        intent: "update_page",
        priority: 920,
        requires: ["firstQuoted", "hasLockVerb"],
        rejects: ["hasUnlockVerb", "hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, is_locked: true },
            explanation: "根据明确的页面名称锁定页面"
        })
    },
    {
        id: "page.icon",
        intent: "update_page",
        priority: 910,
        requires: ["firstQuoted", "hasIconKeyword", "emoji"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, icon_emoji: ctx.emoji },
            explanation: "根据明确的页面名称更新页面图标"
        })
    },
    {
        id: "page.cover",
        intent: "update_page",
        priority: 900,
        requires: ["firstQuoted", "hasCoverKeyword", "url"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "update_page",
            params: { page_name: ctx.firstQuoted, cover_url: ctx.url },
            explanation: "根据明确的页面名称更新页面封面"
        })
    },
    {
        id: "page.markdown",
        intent: "fetch_page_markdown",
        priority: 890,
        requires: ["firstQuoted", "hasMarkdownKeyword"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "fetch_page_markdown",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称读取页面 Markdown"
        })
    },
    {
        id: "page.comments",
        intent: "get_comments",
        priority: 880,
        requires: ["firstQuoted", "hasPageCommentReadIntent"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "get_comments",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称读取页面评论"
        })
    },
    {
        id: "database.schema",
        intent: "get_database_schema",
        priority: 870,
        requires: ["firstQuoted", "hasDatabaseKeyword", "hasSchemaKeyword"],
        rejects: ["hasPageKeyword", "hasBlockStructurePhrase"],
        buildResult: (ctx) => ({
            intent: "get_database_schema",
            params: { database_name: ctx.firstQuoted },
            explanation: "根据明确的数据库名称读取数据库结构"
        })
    },
    {
        id: "database.detail",
        intent: "fetch_notion_object",
        priority: 860,
        requires: ["firstQuoted", "hasDatabaseKeyword", "hasDetailKeyword"],
        rejects: ["hasPageKeyword", "hasMarkdownKeyword"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.firstQuoted, type: "database" },
            explanation: "根据明确的数据库名称读取对象详情"
        })
    },
    {
        id: "page.append",
        intent: "append_block_children",
        priority: 850,
        requires: ["firstQuoted", "hasAppendVerb", "hasMultipleQuotedTexts", "hasPageKeyword"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "append_block_children",
            params: {
                page_name: ctx.firstQuoted,
                content: ctx.lastQuoted,
                insert_position: "end"
            },
            explanation: "根据明确的页面名称插入内容块"
        })
    },
    {
        id: "block.update",
        intent: "update_block_content",
        priority: 840,
        requires: ["blockId", "hasBlockUpdateVerb", "quoted"],
        buildResult: (ctx) => ({
            intent: "update_block_content",
            params: {
                block_id: ctx.blockId,
                content: ctx.quoted
            },
            explanation: "根据明确的 block_id 更新块内容"
        })
    },
    {
        id: "block.append",
        intent: "append_block_children",
        priority: 830,
        requires: ["blockId", "hasAppendVerb", "quoted"],
        buildResult: (ctx) => {
            const insertPosition = ctx.hasAfterBlockKeyword ? "after_block" : "end";
            return {
                intent: "append_block_children",
                params: {
                    block_id: ctx.blockId,
                    content: ctx.quoted,
                    insert_position: insertPosition,
                    after_block_id: insertPosition === "after_block" ? ctx.blockId : undefined
                },
                explanation: "根据明确的 block_id 插入内容块"
            };
        }
    },
    {
        id: "page.blocks",
        intent: "fetch_page_blocks",
        priority: 820,
        requires: ["firstQuoted", "hasBlockStructurePhrase", "hasPageKeyword"],
        rejects: ["hasDatabaseKeyword"],
        buildResult: (ctx) => ({
            intent: "fetch_page_blocks",
            params: { page_name: ctx.firstQuoted },
            explanation: "根据明确的页面名称查看块结构"
        })
    },
    {
        id: "block.blocks",
        intent: "fetch_page_blocks",
        priority: 810,
        requires: ["hasBlockStructureIntent"],
        rejects: ["hasDatabaseKeyword"],
        when: (ctx) => !!ctx.blockId || !ctx.firstQuoted,
        buildResult: (ctx) => ({
            intent: "fetch_page_blocks",
            params: ctx.blockId ? { block_id: ctx.blockId } : {},
            explanation: "查看块结构"
        })
    },
    {
        id: "notion.url.object",
        intent: "fetch_notion_object",
        priority: 800,
        requires: ["notionUrl", "hasObjectReadVerb"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.notionUrl },
            explanation: "根据明确的 Notion 链接读取对象详情"
        })
    },
    {
        id: "notion.id.object",
        intent: "fetch_notion_object",
        priority: 790,
        requires: ["rawNotionId", "hasRawIdReadVerb"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.rawNotionId },
            explanation: "根据明确的 Notion ID 读取对象详情"
        })
    },
    {
        id: "page.detail",
        intent: "fetch_notion_object",
        priority: 780,
        requires: ["firstQuoted", "hasDetailKeyword"],
        rejects: ["hasDatabaseKeyword", "hasBlockStructurePhrase"],
        buildResult: (ctx) => ({
            intent: "fetch_notion_object",
            params: { reference: ctx.firstQuoted, type: "page" },
            explanation: "根据明确的页面名称读取对象详情"
        })
    }
]);
module.exports = { QUICK_INTENT_PATTERNS, QUICK_INTENT_RULES };
