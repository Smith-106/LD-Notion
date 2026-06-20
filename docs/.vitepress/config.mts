import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'LD-Notion Hub',
  description: 'AI 多源知识中枢文档站',
  base: '/LD-Notion/',
  cleanUrls: true,
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: 'Concepts', link: '/concepts/' },
      { text: 'GitHub', link: 'https://github.com/Smith-106/LD-Notion' }
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '项目概览', link: '/' },
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '安装方式', link: '/guide/install' },
          { text: 'Notion 配置', link: '/guide/notion' }
        ]
      },
      {
        text: '核心能力',
        items: [
          { text: '功能地图', link: '/features/' },
          { text: 'Linux.do 导出', link: '/features/linuxdo' },
          { text: 'GitHub 与书签导入', link: '/features/sources' },
          { text: 'AI 助手', link: '/features/ai-assistant' },
          { text: '通用网页与 Obsidian', link: '/features/web-obsidian' }
        ]
      },
      {
        text: 'Concepts / 原理机制',
        items: [
          { text: '机制地图', link: '/concepts/' },
          { text: 'Routing Rules', link: '/concepts/routing-rules' },
          { text: 'Import Pipeline', link: '/concepts/import-pipeline' },
          { text: 'OperationGuard', link: '/concepts/operation-guard' },
          { text: 'AI Agent Loop', link: '/concepts/ai-agent-loop' },
          { text: 'Auth Model', link: '/concepts/auth-model' },
          { text: 'Prompt Injection Defense', link: '/concepts/prompt-injection-defense' },
          { text: 'SyncState V1/V2 迁移', link: '/concepts/syncstate-migration' },
          { text: 'UI 设计系统', link: '/concepts/design-system' }
        ]
      },
      {
        text: 'Integrations / 来源集成',
        items: [
          { text: 'Linux.do Adapter', link: '/integrations/linuxdo' },
          { text: 'GitHub Adapter', link: '/integrations/github' },
          { text: 'Bookmarks Adapter', link: '/integrations/bookmarks' },
          { text: 'Zhihu Adapter', link: '/integrations/zhihu' },
          { text: 'Web Clipper Adapter', link: '/integrations/web-clipper' }
        ]
      },
      {
        text: 'Extension / 扩展与部署',
        items: [
          { text: 'Chrome Extension Architecture', link: '/extension/architecture' },
          { text: 'Extension Permissions', link: '/extension/permissions' },
          { text: 'Build Seams', link: '/extension/build-seams' }
        ]
      },
      {
        text: 'Reference / 参考',
        items: [
          { text: 'Normalized Content Schema', link: '/reference/normalized-content-schema' },
          { text: 'Audit Events', link: '/reference/audit-events' },
          { text: 'Deployment', link: '/reference/deployment' },
          { text: '安全与权限', link: '/architecture/security' },
          { text: '常见问题', link: '/faq' }
        ]
      },
      {
        text: '维护',
        items: [
          { text: '开发与验证', link: '/development' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Smith-106/LD-Notion' }
    ],
    search: {
      provider: 'local'
    },
    outline: {
      label: '本页目录',
      level: [2, 3]
    },
    docFooter: {
      prev: '上一页',
      next: '下一页'
    },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部'
  },
  markdown: {
    mermaid: true
  }
})
