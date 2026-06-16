"use strict";

// ===========================================
// 配置常量
// ===========================================
const CONFIG = {
    // 存储键
    STORAGE_KEYS: {
        NOTION_API_KEY: "ldb_notion_api_key",
        NOTION_DATABASE_ID: "ldb_notion_database_id",
        NOTION_AUTH_MODE: "ldb_notion_auth_mode",
        NOTION_OAUTH_CLIENT_ID: "ldb_notion_oauth_client_id",
        NOTION_OAUTH_CLIENT_SECRET: "ldb_notion_oauth_client_secret",
        NOTION_OAUTH_REDIRECT_URI: "ldb_notion_oauth_redirect_uri",
        NOTION_OAUTH_REFRESH_TOKEN: "ldb_notion_oauth_refresh_token",
        NOTION_OAUTH_STATE: "ldb_notion_oauth_state",
        NOTION_OAUTH_META: "ldb_notion_oauth_meta",
        NOTION_OAUTH_NOTICE: "ldb_notion_oauth_notice",
        CREDENTIAL_VAULT: "ldb_credential_vault",
        FILTER_ONLY_FIRST: "ldb_filter_only_first",
        FILTER_ONLY_OP: "ldb_filter_only_op",
        FILTER_RANGE_START: "ldb_filter_range_start",
        FILTER_RANGE_END: "ldb_filter_range_end",
        FILTER_IMG: "ldb_filter_img",
        FILTER_USERS: "ldb_filter_users",
        FILTER_INCLUDE: "ldb_filter_include",
        FILTER_EXCLUDE: "ldb_filter_exclude",
        FILTER_MINLEN: "ldb_filter_minlen",
        IMG_MODE: "ldb_img_mode",
        PANEL_MINIMIZED: "ldb_panel_minimized",
        EXPORTED_TOPICS: "ldb_exported_topics",
        // 权限控制
        PERMISSION_LEVEL: "ldb_permission_level",
        REQUIRE_CONFIRM: "ldb_require_confirm",
        ENABLE_AUDIT_LOG: "ldb_enable_audit_log",
        OPERATION_LOG: "ldb_operation_log",
        REQUEST_DELAY: "ldb_request_delay",
        // AI 分类
        AI_SERVICE: "ldb_ai_service",
        AI_API_KEY: "ldb_ai_api_key",
        AI_MODEL: "ldb_ai_model",
        AI_CATEGORIES: "ldb_ai_categories",
        AI_BASE_URL: "ldb_ai_base_url",
        // AI 对话历史
        CHAT_HISTORY: "ldb_chat_history",
        // 导出目标配置
        EXPORT_TARGET_TYPE: "ldb_export_target_type",
        PARENT_PAGE_ID: "ldb_parent_page_id",
        // Notion 站点 UI
        NOTION_PANEL_POSITION: "ldb_notion_panel_position",
        NOTION_PANEL_MINIMIZED: "ldb_notion_panel_minimized",
        FLOAT_BTN_POSITION: "ldb_float_btn_position",
        // 模型缓存
        FETCHED_MODELS: "ldb_fetched_models",
        // 工作区页面缓存
        WORKSPACE_PAGES: "ldb_workspace_pages",
        // 自动导入
        AUTO_IMPORT_ENABLED: "ldb_auto_import_enabled",
        AUTO_IMPORT_INTERVAL: "ldb_auto_import_interval",
        EXPORT_CONCURRENCY: "ldb_export_concurrency",
        // AI 查询目标数据库
        AI_TARGET_DB: "ldb_ai_target_db",
        // 工作区获取页数上限
        WORKSPACE_MAX_PAGES: "ldb_workspace_max_pages",
        // Agent 个性化
        AGENT_PERSONA_NAME: "ldb_agent_persona_name",
        AGENT_PERSONA_TONE: "ldb_agent_persona_tone",
        AGENT_PERSONA_EXPERTISE: "ldb_agent_persona_expertise",
        AGENT_PERSONA_INSTRUCTIONS: "ldb_agent_persona_instructions",
        AGENT_MAX_ITERATIONS: "ldb_agent_max_iterations",
        // AI 输出模板
        AI_TEMPLATES: "ldb_ai_templates",
        // GitHub 收藏导入
        GITHUB_USERNAME: "ldb_github_username",
        GITHUB_TOKEN: "ldb_github_token",
        GITHUB_EXPORTED_REPOS: "ldb_github_exported_repos",
        GITHUB_IMPORT_TYPES: "ldb_github_import_types",
        GITHUB_EXPORTED_GISTS: "ldb_github_exported_gists",
        GITHUB_AUTO_IMPORT_ENABLED: "ldb_github_auto_import_enabled",
        GITHUB_AUTO_IMPORT_INTERVAL: "ldb_github_auto_import_interval",
        BOOKMARK_AUTO_IMPORT_ENABLED: "ldb_bookmark_auto_import_enabled",
        BOOKMARK_AUTO_IMPORT_INTERVAL: "ldb_bookmark_auto_import_interval",
        RSS_FEED_URLS: "ldb_rss_feed_urls",
        RSS_AUTO_IMPORT_ENABLED: "ldb_rss_auto_import_enabled",
        RSS_AUTO_IMPORT_INTERVAL: "ldb_rss_auto_import_interval",
        RSS_IMPORT_DEDUP_MODE: "ldb_rss_import_dedup_mode",
        BOOKMARK_SOURCE: "ldb_bookmark_source",
        LINUXDO_IMPORT_DEDUP_MODE: "ldb_linuxdo_import_dedup_mode",
        BOOKMARK_IMPORT_DEDUP_MODE: "ldb_bookmark_import_dedup_mode",
        AI_CATEGORY_AUTO_DEDUP: "ldb_ai_category_auto_dedup",
        // 更新检查
        UPDATE_AUTO_CHECK_ENABLED: "ldb_update_auto_check_enabled",
        UPDATE_CHECK_INTERVAL_HOURS: "ldb_update_check_interval_hours",
        UPDATE_LAST_CHECK_AT: "ldb_update_last_check_at",
        UPDATE_LAST_SEEN_VERSION: "ldb_update_last_seen_version",
        UPDATE_LAST_RESULT: "ldb_update_last_result",
        // 浏览器书签导入
        BOOKMARK_EXPORTED: "ldb_bookmark_exported",
        BOOKMARK_IMPORT_FOLDERS: "ldb_bookmark_import_folders",
        EXT_INSTALL_PROMPT_SHOWN: "ldb_ext_install_prompt_shown",
        MODE_CONFLICT_TIP_SHOWN: "ldb_mode_conflict_tip_shown",
        // 跨源设置
        CROSS_SOURCE_MODE: "ldb_cross_source_mode",
        AUTO_SYNC_STATE: "ldb_auto_sync_state",
        // 同步间隔 (每源独立可配)
        SYNC_INTERVAL_LINUXDO: "ldb_sync_interval_linuxdo",
        SYNC_INTERVAL_GITHUB: "ldb_sync_interval_github",
        SYNC_INTERVAL_BOOKMARKS: "ldb_sync_interval_bookmarks",
        SYNC_INTERVAL_RSS: "ldb_sync_interval_rss",
        // Obsidian 导出
        OBS_API_URL: "ldb_obs_api_url",
        OBS_API_KEY: "ldb_obs_api_key",
        OBS_DIR: "ldb_obs_dir",
        OBS_IMG_MODE: "ldb_obs_img_mode",
        OBS_IMG_DIR: "ldb_obs_img_dir",
        // 面板尺寸记忆
        PANEL_SIZE_NOTION: "ldb_panel_size_notion",
        PANEL_SIZE_MAIN: "ldb_panel_size_main",
        PANEL_SIZE_GENERIC: "ldb_panel_size_generic",
        // UI 主题
        THEME_PREFERENCE: "ldb_theme_preference",
        // 面板 Tab 状态
        ACTIVE_TAB: "ldb_active_tab",
    },
    // 默认值
    DEFAULTS: {
        notionAuthMode: "manual",
        notionOauthRedirectUri: "https://www.notion.so/",
        onlyFirst: false,
        onlyOp: false,
        rangeStart: 1,
        rangeEnd: 999999,
        imgFilter: "all", // all / only_img / no_img
        filterUsers: "",
        filterInclude: "",
        filterExclude: "",
        filterMinLen: 0,
        imgMode: "external", // upload, external, skip
        permissionLevel: 1, // 默认标准权限
        requireConfirm: true, // 默认需要确认
        enableAuditLog: true, // 默认开启审计日志
        requestDelay: 500, // 请求间隔（毫秒），防止被封
        // AI 分类默认值
        aiService: "openai",
        aiModel: "",
        aiCategories: "技术, 生活, 问答, 分享, 资源, 其他",
        aiBaseUrl: "",
        // 导出目标默认值
        exportTargetType: "database", // database 或 page
        // 自动导入默认值
        autoImportEnabled: false,
        autoImportInterval: 5, // 分钟，0=仅页面加载时
        githubAutoImportEnabled: false,
        githubAutoImportInterval: 5,
        bookmarkAutoImportEnabled: false,
        bookmarkAutoImportInterval: 5,
        rssFeedUrls: "",
        rssAutoImportEnabled: false,
        rssAutoImportInterval: 5,
        rssImportDedupMode: "strict",
        bookmarkSource: "linuxdo",
        linuxdoImportDedupMode: "strict",
        bookmarkImportDedupMode: "strict",
        aiCategoryAutoDedup: true,
        updateAutoCheckEnabled: true,
        updateCheckIntervalHours: 24,
        exportConcurrency: 1, // 并发导出数量
        workspaceMaxPages: 10, // 刷新工作区时的分页上限
        // Agent 个性化默认值
        agentPersonaName: "AI 助手",
        agentPersonaTone: "友好",
        agentPersonaExpertise: "Notion 工作区管理",
        agentPersonaInstructions: "",
        agentMaxIterations: 8,
        // AI 输出模板默认值
        aiTemplates: JSON.stringify([
            { name: "周报", prompt: "根据以下内容生成一份工作周报，包含：本周完成、下周计划、问题与风险。使用 Markdown 格式。", icon: "📋" },
            { name: "摘要提纲", prompt: "为以下内容生成一份详细的结构化提纲，使用层级编号。使用 Markdown 格式。", icon: "📝" },
            { name: "SWOT 分析", prompt: "对以下内容进行 SWOT 分析（优势、劣势、机会、威胁），使用 Markdown 表格格式。", icon: "📊" },
            { name: "行动计划", prompt: "根据以下内容提炼出具体的行动计划，包含：目标、步骤、负责人、截止时间。使用 Markdown 格式。", icon: "🎯" },
        ]),
        // GitHub 导入类型默认值
        githubImportTypes: JSON.stringify(["stars"]),
        activeTab: "bookmarks",
        themePreference: "auto",
        // 跨源模式默认值
        crossSourceMode: "separate",  // separate(分库) 或 unified(统一库)
        // 同步间隔默认值 (分钟)
        syncIntervalLinuxdo: 30,
        syncIntervalGithub: 60,
        syncIntervalBookmarks: 120,
        syncIntervalRss: 60,
        // Obsidian 导出默认值
        obsApiUrl: "https://127.0.0.1:27124",
        obsApiKey: "",
        obsDir: "Linux.do",
        obsImgMode: "file", // file / base64 / skip
        obsImgDir: "Linux.do/attachments",
    },
    // 导出目标类型
    EXPORT_TARGET_TYPES: {
        DATABASE: "database",
        PAGE: "page",
    },
    // 权限级别
    PERMISSION_LEVELS: {
        READONLY: 0,   // 只读: 搜索、查看
        STANDARD: 1,   // 标准: + 创建/更新页面
        ADVANCED: 2,   // 高级: + 移动、复制、删除
        ADMIN: 3,      // 管理员: + 完整用户管理
    },
    // 权限级别名称
    PERMISSION_NAMES: {
        0: "只读",
        1: "标准",
        2: "高级",
        3: "管理员",
    },
    // API
    API: {
        NOTION_VERSION: "2022-06-28",
        MARKDOWN_NOTION_VERSION: "2026-03-11",
        COMMENT_NOTION_VERSION: "2026-03-11",
        BATCH_SIZE: 20, // 每次加载的收藏数量
        UNDO_TIMEOUT: 5000, // 撤销窗口时间 (ms)
        MAX_LOG_ENTRIES: 100, // 最大日志条目数
    },
};

// ===========================================
// 文件类型支持 (Notion File Upload API)
// 参考: https://developers.notion.com/docs/working-with-files-and-media
// ===========================================
const SUPPORTED_FILE_TYPES = Object.freeze(new Set([
    // Audio
    "aac", "adts", "mid", "midi", "mp3", "mpga", "m4a", "m4b", "mp4", "oga", "ogg", "wav", "wma",
    // Document
    "pdf", "txt", "json", "doc", "dot", "docx", "dotx", "xls", "xlt", "xla", "xlsx", "xltx",
    "ppt", "pot", "pps", "ppa", "pptx", "potx",
    // Image
    "gif", "heic", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp", "ico",
    // Video
    "amv", "asf", "wmv", "avi", "f4v", "flv", "gifv", "m4v", "mp4", "mkv", "webm", "mov", "qt", "mpeg",
]));

const EXT_TO_MIME = Object.freeze({
    // Audio
    aac: "audio/aac", adts: "audio/aac", mid: "audio/midi", midi: "audio/midi",
    mp3: "audio/mpeg", mpga: "audio/mpeg", m4a: "audio/mp4", m4b: "audio/mp4",
    oga: "audio/ogg", ogg: "audio/ogg", wav: "audio/wav", wma: "audio/x-ms-wma",
    // Document
    pdf: "application/pdf", txt: "text/plain", json: "application/json",
    doc: "application/msword", dot: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    xls: "application/vnd.ms-excel", xlt: "application/vnd.ms-excel", xla: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    ppt: "application/vnd.ms-powerpoint", pot: "application/vnd.ms-powerpoint",
    pps: "application/vnd.ms-powerpoint", ppa: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
    // Image
    gif: "image/gif", heic: "image/heic", jpeg: "image/jpeg", jpg: "image/jpeg",
    png: "image/png", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff",
    webp: "image/webp", ico: "image/vnd.microsoft.icon",
    // Video
    amv: "video/x-amv", asf: "video/x-ms-asf", wmv: "video/x-ms-asf",
    avi: "video/x-msvideo", f4v: "video/x-f4v", flv: "video/x-flv",
    m4v: "video/mp4", mp4: "video/mp4", mkv: "video/mp4",
    webm: "video/webm", mov: "video/quicktime", qt: "video/quicktime", mpeg: "video/mpeg",
});

const FILE_TYPE_CATEGORY = Object.freeze({
    aac: "audio", adts: "audio", mid: "audio", midi: "audio",
    mp3: "audio", mpga: "audio", m4a: "audio", m4b: "audio",
    oga: "audio", ogg: "audio", wav: "audio", wma: "audio",
    pdf: "file", txt: "file", json: "file",
    doc: "file", dot: "file", docx: "file", dotx: "file",
    xls: "file", xlt: "file", xla: "file", xlsx: "file", xltx: "file",
    ppt: "file", pot: "file", pps: "file", ppa: "file", pptx: "file", potx: "file",
    gif: "image", heic: "image", jpeg: "image", jpg: "image", png: "image",
    svg: "image", tif: "image", tiff: "image", webp: "image", ico: "image",
    amv: "video", asf: "video", wmv: "video", avi: "video",
    f4v: "video", flv: "video", gifv: "video", m4v: "video",
    mp4: "video", mkv: "video", webm: "video", mov: "video", qt: "video", mpeg: "video",
});

const SUPPORTED_IMAGE_TYPES = new Set(["gif", "heic", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp", "ico"]);
const MULTI_PART_THRESHOLD = 20 * 1024 * 1024; // 20 MiB

function isSupportedFileType(ext) {
    return SUPPORTED_FILE_TYPES.has((ext || "").toLowerCase());
}

function getMimeType(ext, fallback = "application/octet-stream") {
    return EXT_TO_MIME[(ext || "").toLowerCase()] || fallback;
}

function getFileCategory(ext) {
    return FILE_TYPE_CATEGORY[(ext || "").toLowerCase()] || "file";
}

// 通用提示消息
const MSG = {
    NO_NOTION_KEY: "请先填写 Notion API Key",
    NO_AI_KEY: "请先填写 AI API Key",
    SETUP_NOTION_KEY: "请先设置 Notion API Key",
};

module.exports = {
    CONFIG,
    SUPPORTED_FILE_TYPES,
    EXT_TO_MIME,
    FILE_TYPE_CATEGORY,
    SUPPORTED_IMAGE_TYPES,
    MULTI_PART_THRESHOLD,
    isSupportedFileType,
    getMimeType,
    getFileCategory,
    MSG,
};
