// 工作区管理 — 创建/打开/删除/列表

use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;

use super::Workspace;

/// 创建新工作区
pub fn create(conn: &Connection, name: &str, storage_root: &Path) -> Result<Workspace, Box<dyn std::error::Error>> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let ws_path = storage_root.join(&id);

    fs::create_dir_all(&ws_path)?;

    conn.execute(
        "INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, ws_path.to_str().unwrap_or(""), &now, &now],
    )?;

    Ok(Workspace {
        id,
        name: name.to_string(),
        root_path: ws_path.to_str().unwrap_or("").to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 列出所有工作区
pub fn list(conn: &Connection) -> Result<Vec<Workspace>, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, root_path, created_at, updated_at FROM workspaces ORDER BY created_at",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            root_path: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    Ok(rows.filter_map(std::result::Result::ok).collect())
}

/// 按 ID 查找工作区
pub fn find(conn: &Connection, id: &str) -> Result<Option<Workspace>, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, root_path, created_at, updated_at FROM workspaces WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map([id], |row| {
        Ok(Workspace {
            id: row.get(0)?,
            name: row.get(1)?,
            root_path: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// 删除工作区（及其所有页面记录和 Markdown 文件）
pub fn delete(conn: &Connection, id: &str, storage_root: &Path) -> Result<bool, Box<dyn std::error::Error>> {
    // 先获取 root_path 以删除空的工作区目录
    let ws = find(conn, id)?;

    // 删除该工作区下所有页面的 Markdown 文件
    let file_paths: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT file_path FROM pages WHERE workspace_id = ?1",
        )?;
        let rows = stmt.query_map([id], |row| row.get::<_, String>(0))?;
        rows.filter_map(std::result::Result::ok).collect()
    };
    for fp in &file_paths {
        let full_path = storage_root.join(fp);
        let _ = fs::remove_file(full_path);
    }

    if let Some(ws) = ws {
        if !ws.root_path.is_empty() {
            let _ = fs::remove_dir_all(&ws.root_path);
        }
    }

    // 清除页面间 parent_id 引用 → 删除页面树 → 删除索引 → 删除页面（FK 安全顺序）
    conn.execute("UPDATE pages SET parent_id = NULL WHERE workspace_id = ?1 AND parent_id IS NOT NULL", [id])?;
    conn.execute("DELETE FROM page_tree WHERE descendant_id IN (SELECT id FROM pages WHERE workspace_id = ?1)", [id])?;
    conn.execute("DELETE FROM page_tree WHERE ancestor_id IN (SELECT id FROM pages WHERE workspace_id = ?1)", [id])?;
    conn.execute("DELETE FROM fts_index WHERE page_id IN (SELECT id FROM pages WHERE workspace_id = ?1)", [id])?;
    conn.execute("DELETE FROM pages WHERE workspace_id = ?1", [id])?;
    let removed = conn.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
    Ok(removed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;

    fn setup() -> (Connection, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ld-notion-ws-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let storage = dir.join("storage");
        std::fs::create_dir_all(&storage).unwrap();
        let conn = db::initialize(&db_path, &storage).unwrap();
        (conn, storage)
    }

    #[test]
    fn test_create_and_find() {
        let (conn, storage) = setup();
        let ws = super::create(&conn, "测试工作区", &storage).unwrap();
        assert_eq!(ws.name, "测试工作区");
        assert!(!ws.id.is_empty());

        let found = super::find(&conn, &ws.id).unwrap().unwrap();
        assert_eq!(found.name, ws.name);
    }

    #[test]
    fn test_list() {
        let (conn, storage) = setup();
        super::create(&conn, "A", &storage).unwrap();
        super::create(&conn, "B", &storage).unwrap();
        let list = super::list(&conn).unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_delete_cascades_pages() {
        let (conn, storage) = setup();
        let ws = super::create(&conn, "待删除", &storage).unwrap();

        // 创建带嵌套的页面
        let p1 = crate::engine::page::create(&conn, &ws.id, None, "根", &storage).unwrap();
        crate::engine::page::create(&conn, &ws.id, Some(&p1.id), "子", &storage).unwrap();

        let removed = super::delete(&conn, &ws.id, &storage).unwrap();
        assert!(removed);

        // 工作区已删除
        assert!(super::find(&conn, &ws.id).unwrap().is_none());
        // 页面已级联删除
        assert!(crate::engine::page::find(&conn, &p1.id).unwrap().is_none());
    }

    #[test]
    fn test_delete_nonexistent() {
        let (conn, storage) = setup();
        let removed = super::delete(&conn, "nonexistent", &storage).unwrap();
        assert!(!removed);
    }
}
