// 页面树构建 — 邻接表 → 树形结构

use rusqlite::Connection;

use super::{Page, PageTreeNode};

/// 将扁平页面列表构建为树形结构
#[must_use] 
pub fn build_tree(pages: &[Page], parent_id: Option<&str>) -> Vec<PageTreeNode> {
    pages
        .iter()
        .filter(|p| match (parent_id, &p.parent_id) {
            (None, None) => true,
            (Some(target), Some(page_parent)) => target == page_parent,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_page(id: &str, title: &str) -> Page {
        Page {
            id: id.to_string(),
            workspace_id: "ws".to_string(),
            parent_id: None,
            title: title.to_string(),
            slug: title.to_lowercase(),
            file_path: format!("{title}.md"),
            sort_order: 0,
            is_folder: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn test_build_tree_flat() {
        let pages = vec![make_page("1", "A"), make_page("2", "B")];
        let tree = build_tree(&pages, None);
        assert_eq!(tree.len(), 2);
    }

    #[test]
    fn test_build_tree_nested() {
        let mut parent = make_page("1", "父");
        let child = Page {
            parent_id: Some("1".to_string()),
            ..make_page("2", "子")
        };
        parent.parent_id = None;
        let pages = vec![parent, child];
        let tree = build_tree(&pages, None);
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].children.len(), 1);
        assert_eq!(tree[0].children[0].page.title, "子");
    }

    #[test]
    fn test_prune_tree() {
        let mut root = make_page("1", "根");
        root.parent_id = None;
        let child = Page {
            parent_id: Some("1".to_string()),
            ..make_page("2", "子")
        };
        let pages = vec![root, child];
        let tree = build_tree(&pages, None);

        let pruned = prune_tree(tree, 1);
        assert_eq!(pruned.len(), 1);
        assert!(pruned[0].children.is_empty());
    }
}
