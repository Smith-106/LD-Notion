// 知识库引擎模块
// 提供工作区管理、页面 CRUD、Markdown 读写、页面树构建

pub mod workspace;
pub mod page;
pub mod page_tree;
pub mod markdown_io;

use serde::{Deserialize, Serialize};

/// 工作区信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 页面信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub workspace_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub slug: String,
    pub file_path: String,
    pub sort_order: i32,
    pub is_folder: bool,
    pub is_pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// 页面树节点（含子节点）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageTreeNode {
    #[serde(flatten)]
    pub page: Page,
    pub children: Vec<Self>,
}

/// Markdown 文件内容（含 frontmatter）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownContent {
    pub title: String,
    pub tags: Vec<String>,
    pub created: String,
    pub updated: String,
    pub body: String,
}
