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
    Ok(rows.filter_map(|r| r.ok()).collect())
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

/// 删除工作区（及其所有页面记录）
pub fn delete(conn: &Connection, id: &str) -> Result<bool, Box<dyn std::error::Error>> {
    // 先获取 root_path 以删除文件
    if let Some(ws) = find(conn, id)? {
        let _ = fs::remove_dir_all(&ws.root_path);
    }
    // 删除关联页面和树
    conn.execute("DELETE FROM page_tree WHERE descendant_id IN (SELECT id FROM pages WHERE workspace_id = ?1)", [id])?;
    conn.execute("DELETE FROM fts_index WHERE page_id IN (SELECT id FROM pages WHERE workspace_id = ?1)", [id])?;
    conn.execute("DELETE FROM pages WHERE workspace_id = ?1", [id])?;
    let removed = conn.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
    Ok(removed > 0)
}
