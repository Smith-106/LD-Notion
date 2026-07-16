"use strict";

// 共享 legacy 测试加载器。
//
// 背景：legacy 测试通过 new Function(coreCode + "return { 裸符号 }") 提取产物中的
// 模块符号。但 esbuild 打包后，模块内符号被重命名为带后缀的局部变量（如 TargetState2），
// 裸符号在 eval 作用域不可见，且 entry 模块（main.js）的符号无法稳定提取。
//
// 解决：产物 IIFE 顶层暴露了 __commonJS 包裹的 require_* 工厂函数，每个工厂返回对应
// 模块的 exports 对象。本加载器 eval coreCode（去掉末尾的 main() 副作用调用），return
// 所有 require_* 工厂，再组装成统一的模块对象。完全不依赖裸符号，对 esbuild 重命名免疫。
//
// 各测试只需调用 loadBundle(sandbox) 即可拿到 { Utils, CONFIG, UI, UICommandService, ... }。

const fs = require('fs');
const path = require('path');
const { extractUserscriptIifeBody } = require('../scripts/build-extension.js');

const userScriptPath = path.resolve(__dirname, '../LinuxDo-Bookmarks-to-Notion.user.js');
const userScriptContent = fs.readFileSync(userScriptPath, 'utf8');

// 取 IIFE 主体并去掉末尾的 main() 调用（避免加载时触发 initUI 副作用崩溃）。
const coreCode = extractUserscriptIifeBody(userScriptContent).replace(/\n\s*main\(\);\s*$/, '\n');

// 产物中所有 require_* 工厂名（与 esbuild 生成的 __commonJS 顶层声明对应）。
const FACTORY_NAMES = [
    'require_AdapterRegistry', 'require_BookmarkAutoImporter', 'require_BookmarkExporter',
    'require_DedupStore', 'require_GitHubAPI', 'require_GitHubAutoImporter',
    'require_GitHubExporter', 'require_RSSAutoImporter', 'require_SourceAdapter',
    'require_SyncCoordinator', 'require_SyncScheduler', 'require_SyncState',
    'require_UpdateChecker', 'require_UrlValidator', 'require_ai', 'require_api',
    'require_auth', 'require_bridge', 'require_config', 'require_design_system',
    'require_events', 'require_export', 'require_extract', 'require_generic_ui',
    'require_import', 'require_main_ui', 'require_notion_site_ui', 'require_panel_resize',
    'require_security', 'require_storage', 'require_style_manager', 'require_styles',
    'require_sync_lock', 'require_ui', 'require_utils'
];

// 已知会被测试引用但未通过 require_* 工厂导出的 entry 符号（main.js 顶层定义）。
// 这些符号在产物 entry section 内联，加载器额外从 eval 作用域 return。
// 若未来 esbuild 改变 entry 处理导致这些符号不可见，需回归到工厂方案。
const ENTRY_SYMBOLS = ['main'];

function loadBundle(sandbox) {
    const runner = new Function(
        ...Object.keys(sandbox),
        coreCode + '\nreturn { ' +
            FACTORY_NAMES.join(', ') + ', ' +
            ENTRY_SYMBOLS.join(', ') +
            ' };'
    );
    const bundle = runner(...Object.values(sandbox));

    // 调用每个工厂取其 exports，合并成统一模块对象。
    // 后调用的工厂可能依赖先调用的工厂（esbuild __commonJS 内部有缓存，重复调用安全）。
    // 注意：某些工厂会通过 Object.defineProperty 向 module.exports 注入跨模块依赖 getter
    // （如 require_storage 注入 CredentialVault），这些 getter 在工厂内可能返回 null。
    // 因此跳过 null/undefined 值，避免覆盖前面工厂已经提供的真实导出。
    const modules = {};
    for (const name of FACTORY_NAMES) {
        const factory = bundle[name];
        if (typeof factory !== 'function') {
            throw new Error(`工厂 ${name} 未在产物中找到 — 产物结构已变化，需更新 FACTORY_NAMES`);
        }
        const exports = factory();
        for (const key of Object.keys(exports)) {
            const value = exports[key];
            if (value !== null && value !== undefined) {
                modules[key] = value;
            }
        }
    }

    // entry 符号直接挂载。
    for (const sym of ENTRY_SYMBOLS) {
        if (bundle[sym] !== undefined) {
            modules[sym] = bundle[sym];
        }
    }

    return modules;
}

// 暴露 coreCode 供需要原始产物文本的测试复用（如构建产物断言）。
module.exports = { loadBundle, coreCode, userScriptContent };
