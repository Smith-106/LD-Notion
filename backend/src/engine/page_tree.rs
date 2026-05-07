// 页面树构建 — 邻接表 → 树形结构

use rusqlite::Connection;

use super::{Page, PageTreeNode};

/// 将扁平页面列表构建为树形结构
pub fn build_tree(pages: &[Page], parent_id: Option<&str>) -> Vec<PageTreeNode> {
    pages
        .iter()
        .filter(|p| match (parent_id, &p.parent_id) {
            (None, None) => true,
            (Some(pid), Some(ppid)) => pid == ppid,
            _ => false,
        })
        .map(|p| {
            let children = build_tree(pages, Some(&p.id));
            PageTreeNode {
                page: p.clone(),
                children,
            }
        })
        .collect()
}

/// 从数据库获取工作区的页面树
pub fn get_tree(conn: &Connection, workspace_id: &str, depth: Option<i32>) -> Result<Vec<PageTreeNode>, Box<dyn std::error::Error>> {
    let pages = super::page::list_by_workspace(conn, workspace_id)?;
    let tree = build_tree(&pages, None);

    Ok(match depth {
        Some(d) => prune_tree(tree, d),
        None => tree,
    })
}

/// 修剪树深度
fn prune_tree(nodes: Vec<PageTreeNode>, max_depth: i32) -> Vec<PageTreeNode> {
    if max_depth <= 0 {
        return vec![];
    }
    nodes
        .into_iter()
        .map(|mut n| {
            n.children = prune_tree(n.children, max_depth - 1);
            n
        })
        .collect()
}
