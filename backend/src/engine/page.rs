// 页面 CRUD — 创建/读取/更新/删除

use rusqlite::{params, Connection};
use std::path::Path;

use super::{Page, MarkdownContent};
use super::markdown_io;

/// 创建新页面
pub fn create(
    conn: &Connection,
    workspace_id: &str,
    parent_id: Option<&str>,
    title: &str,
    ws_root: &Path,
) -> Result<Page, Box<dyn std::error::Error>> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let slug = title_to_slug(title);
    let file_path = format!("{}.md", slug);

    // 确定 sort_order
    let sort_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM pages WHERE workspace_id = ?1 AND parent_id IS ?2",
            params![workspace_id, parent_id],
            |row| row.get(0),
        )
        .unwrap_or(1);

    conn.execute(
        "INSERT INTO pages (id, workspace_id, parent_id, title, slug, file_path, sort_order, is_folder, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9)",
        params![id, workspace_id, parent_id, title, &slug, &file_path, sort_order, &now, &now],
    )?;

    // 更新 page_tree 闭包表（自身到自身 depth=0）
    conn.execute(
        "INSERT INTO page_tree (ancestor_id, descendant_id, depth) VALUES (?1, ?1, 0)",
        [&id],
    )?;
    // 如果有父节点，插入祖先路径
    if let Some(pid) = parent_id {
        conn.execute(
            "INSERT INTO page_tree (ancestor_id, descendant_id, depth)
             SELECT ancestor_id, ?1, depth + 1 FROM page_tree WHERE descendant_id = ?2",
            params![&id, pid],
        )?;
    }

    // 创建 Markdown 文件
    let md_content = MarkdownContent {
        title: title.to_string(),
        tags: vec![],
        created: now.clone(),
        updated: now.clone(),
        body: String::new(),
    };
    let full_path = ws_root.join(&file_path);
    markdown_io::write(&full_path, &md_content)?;

    Ok(Page {
        id,
        workspace_id: workspace_id.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        title: title.to_string(),
        slug,
        file_path,
        sort_order,
        is_folder: false,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 按 ID 读取页面
pub fn find(conn: &Connection, id: &str) -> Result<Option<Page>, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, parent_id, title, slug, file_path, sort_order, is_folder, created_at, updated_at
         FROM pages WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map([id], |row| {
        Ok(Page {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            parent_id: row.get(2)?,
            title: row.get(3)?,
            slug: row.get(4)?,
            file_path: row.get(5)?,
            sort_order: row.get(6)?,
            is_folder: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// 读取页面 Markdown 内容
pub fn read_content(
    conn: &Connection,
    id: &str,
    ws_root: &Path,
) -> Result<Option<MarkdownContent>, Box<dyn std::error::Error>> {
    if let Some(page) = find(conn, id)? {
        let full_path = ws_root.join(&page.file_path);
        let content = markdown_io::read(&full_path)?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

/// 更新页面内容
pub fn update_content(
    conn: &Connection,
    id: &str,
    body: &str,
    ws_root: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let page = find(conn, id)?.ok_or("页面不存在")?;
    let full_path = ws_root.join(&page.file_path);
    let now = chrono::Utc::now().to_rfc3339();
    let mut content = markdown_io::read(&full_path).unwrap_or(MarkdownContent {
        title: page.title.clone(),
        tags: vec![],
        created: page.created_at.clone(),
        updated: now.clone(),
        body: String::new(),
    });
    content.body = body.to_string();
    content.updated = now.clone();
    markdown_io::write(&full_path, &content)?;

    conn.execute(
        "UPDATE pages SET updated_at = ?1 WHERE id = ?2",
        params![&now, id],
    )?;
    Ok(())
}

/// 删除页面
pub fn delete(conn: &Connection, id: &str, ws_root: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(page) = find(conn, id)? {
        let full_path = ws_root.join(&page.file_path);
        let _ = std::fs::remove_file(full_path);
        conn.execute("DELETE FROM page_tree WHERE descendant_id = ?1", [id])?;
        conn.execute("DELETE FROM fts_index WHERE page_id = ?1", [id])?;
        conn.execute("DELETE FROM pages WHERE id = ?1", [id])?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 列出工作区下的页面
pub fn list_by_workspace(conn: &Connection, workspace_id: &str) -> Result<Vec<Page>, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, parent_id, title, slug, file_path, sort_order, is_folder, created_at, updated_at
         FROM pages WHERE workspace_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([workspace_id], |row| {
        Ok(Page {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            parent_id: row.get(2)?,
            title: row.get(3)?,
            slug: row.get(4)?,
            file_path: row.get(5)?,
            sort_order: row.get(6)?,
            is_folder: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn title_to_slug(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}
