// 数据库连接与初始化模块
// 负责 SQLite 连接建立、schema 迁移、存储目录初始化

use rusqlite::{Connection, Result};
use std::fs;
use std::path::Path;

/// 打开（或创建）SQLite 数据库，执行 schema 初始化
pub fn initialize(database_path: &Path, storage_root: &Path) -> Result<Connection> {
    // 确保父目录存在
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    }

    let conn = Connection::open(database_path)?;

    // 启用 WAL 模式以提升并发读取性能
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    // 启用外键约束以维护数据完整性
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    // 执行 schema 迁移脚本
    let schema_sql = include_str!("schema.sql");
    conn.execute_batch(schema_sql)?;

    // 初始化 Markdown 存储目录结构（按 workspace 隔离）
    // 实际子目录在创建 workspace 时动态建立，此处仅确保根目录存在
    fs::create_dir_all(storage_root)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    tracing::info!(
        "数据库初始化完成: {}, 存储根目录: {}",
        database_path.display(),
        storage_root.display()
    );

    Ok(conn)
}

/// 验证数据库 schema 完整性 — 检查 4 张核心表是否存在
pub fn validate_schema(conn: &Connection) -> Result<()> {
    let expected_tables = ["workspaces", "pages", "page_tree", "fts_index"];
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'",
    )?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(std::result::Result::ok)
        .collect();

    let mut missing = Vec::new();
    for table in &expected_tables {
        if !existing.iter().any(|t| t == table) {
            missing.push(*table);
        }
    }

    if missing.is_empty() {
        tracing::info!(
            "Schema 验证完成，已存在 {} 张表/视图: {:?}",
            existing.len(),
            existing
        );
        Ok(())
    } else {
        Err(rusqlite::Error::InvalidParameterName(format!(
            "核心表缺失: {missing:?}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initialize_creates_tables() {
        let conn = initialize(Path::new(":memory:"), Path::new("/tmp/test-storage"))
            .expect("内存数据库初始化失败");
        validate_schema(&conn).expect("Schema 验证失败");
    }
}
