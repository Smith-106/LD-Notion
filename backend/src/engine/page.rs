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
    let slug_base = title_to_slug(title);
    let short_id = &id[..8];
    let slug = if slug_base.is_empty() {
        short_id.to_string()
    } else {
        format!("{slug_base}-{short_id}")
    };
    let file_path = format!("{slug}.md");

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
        parent_id: parent_id.map(std::string::ToString::to_string),
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
#[allow(clippy::missing_errors_doc)]
pub fn update_content(
    conn: &Connection,
    id: &str,
    body: &str,
    ws_root: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let page = find(conn, id)?.ok_or("页面不存在")?;
    let full_path = ws_root.join(&page.file_path);
    let now = chrono::Utc::now().to_rfc3339();
    let mut content = markdown_io::read(&full_path).unwrap_or_else(|_| MarkdownContent {
        title: page.title.clone(),
        tags: vec![],
        created: page.created_at.clone(),
        updated: String::new(),
        body: String::new(),
    });
    content.body = body.to_string();
    content.updated.clone_from(&now);
    // 先写文件，再更新 DB — 文件写入失败时两者都不变（内容安全优先于时间戳准确）
    markdown_io::write(&full_path, &content)?;
    conn.execute(
        "UPDATE pages SET updated_at = ?1 WHERE id = ?2",
        params![&now, id],
    )?;
    Ok(())
}

/// 删除页面（级联删除所有子页面）
pub fn delete(conn: &Connection, id: &str, ws_root: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(page) = find(conn, id)? {
        // 收集所有后代页面 ID
        let descendants: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT descendant_id FROM page_tree WHERE ancestor_id = ?1 AND depth > 0",
            )?;
            let rows = stmt.query_map([id], |row| row.get::<_, String>(0))?;
            rows.filter_map(std::result::Result::ok).collect()
        };

        // 阶段 1: 清除所有后代的 parent_id 引用（避免 pages.parent_id FK 约束失败）
        for desc_id in &descendants {
            conn.execute("UPDATE pages SET parent_id = NULL WHERE id = ?1", [desc_id])?;
        }

        // 阶段 2: 删除所有 page_tree 关系（必须在删除 pages 之前）
        for desc_id in &descendants {
            conn.execute("DELETE FROM page_tree WHERE descendant_id = ?1", [desc_id])?;
        }
        conn.execute("DELETE FROM page_tree WHERE ancestor_id = ?1 OR descendant_id = ?1", [id])?;

        // 阶段 3: 删除搜索索引和页面记录 + 文件
        for desc_id in &descendants {
            if let Some(child) = find(conn, desc_id)? {
                let full_path = ws_root.join(&child.file_path);
                let _ = std::fs::remove_file(full_path);
            }
            conn.execute("DELETE FROM fts_index WHERE page_id = ?1", [desc_id])?;
            conn.execute("DELETE FROM pages WHERE id = ?1", [desc_id])?;
        }

        // 删除自身
        let full_path = ws_root.join(&page.file_path);
        let _ = std::fs::remove_file(full_path);
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
    Ok(rows.filter_map(std::result::Result::ok).collect())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;

    fn setup() -> (Connection, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ld-notion-page-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let storage = dir.join("storage");
        std::fs::create_dir_all(&storage).unwrap();
        let conn = db::initialize(&db_path, &storage).unwrap();
        (conn, storage)
    }

    fn create_ws(conn: &Connection, storage: &Path) -> String {
        crate::engine::workspace::create(conn, "test", storage).unwrap().id
    }

    #[test]
    fn test_create_and_find() {
        let (conn, storage) = setup();
        let ws_id = create_ws(&conn, &storage);

        let page = super::create(&conn, &ws_id, None, "测试页面", &storage).unwrap();
        assert_eq!(page.title, "测试页面");
        assert!(page.slug.contains("测试页面"));
        assert!(page.parent_id.is_none());

        let found = super::find(&conn, &page.id).unwrap().unwrap();
        assert_eq!(found.title, page.title);
    }

    #[test]
    fn test_create_child_page() {
        let (conn, storage) = setup();
        let ws_id = create_ws(&conn, &storage);

        let parent = super::create(&conn, &ws_id, None, "父", &storage).unwrap();
        let child = super::create(&conn, &ws_id, Some(&parent.id), "子", &storage).unwrap();
        assert_eq!(child.parent_id, Some(parent.id));
    }

    #[test]
    fn test_update_content() {
        let (conn, storage) = setup();
        let ws_id = create_ws(&conn, &storage);
        let page = super::create(&conn, &ws_id, None, "内容测试", &storage).unwrap();

        super::update_content(&conn, &page.id, "Hello World", &storage).unwrap();
        let content = super::read_content(&conn, &page.id, &storage).unwrap().unwrap();
        assert_eq!(content.body, "Hello World");
    }

    #[test]
    fn test_delete_cascade() {
        let (conn, storage) = setup();
        let ws_id = create_ws(&conn, &storage);

        let p1 = super::create(&conn, &ws_id, None, "根", &storage).unwrap();
        let p2 = super::create(&conn, &ws_id, Some(&p1.id), "子", &storage).unwrap();
        let p3 = super::create(&conn, &ws_id, Some(&p2.id), "孙", &storage).unwrap();

        let removed = super::delete(&conn, &p1.id, &storage).unwrap();
        assert!(removed);

        assert!(super::find(&conn, &p1.id).unwrap().is_none());
        assert!(super::find(&conn, &p2.id).unwrap().is_none());
        assert!(super::find(&conn, &p3.id).unwrap().is_none());
    }

    #[test]
    fn test_slug_for_special_chars() {
        assert!(super::title_to_slug("!!!").is_empty());
        assert!(super::title_to_slug("Hello World").contains("hello-world"));
        assert_eq!(super::title_to_slug("你好"), "你好");
    }
}
