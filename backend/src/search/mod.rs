// 搜索模块 — SQLite FTS5 全文搜索

use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub page_id: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}

/// 索引页面内容到 FTS5
pub fn index_page(
    conn: &Connection,
    page_id: &str,
    title: &str,
    content: &str,
    tags: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // 先删除旧索引
    conn.execute("DELETE FROM fts_index WHERE page_id = ?1", [page_id])?;
    // 插入新索引
    conn.execute(
        "INSERT INTO fts_index (page_id, title, content, tags) VALUES (?1, ?2, ?3, ?4)",
        params![page_id, title, content, tags],
    )?;
    Ok(())
}

/// 从索引中移除页面
pub fn deindex_page(conn: &Connection, page_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    conn.execute("DELETE FROM fts_index WHERE page_id = ?1", [page_id])?;
    Ok(())
}

/// 全文搜索
pub fn search(
    conn: &Connection,
    query: &str,
    mode: &str,
    limit: i32,
    offset: i32,
) -> Result<SearchOutput, Box<dyn std::error::Error>> {
    let fts_query = match mode {
        "or" => query.split_whitespace().collect::<Vec<_>>().join(" OR "),
        _ => query.split_whitespace().collect::<Vec<_>>().join(" AND "),
    };

    let sql = "SELECT f.page_id, f.title, highlight(fts_index, 2, '<mark>', '</mark>') as snippet, bm25(fts_index) as score
         FROM fts_index f WHERE fts_index MATCH ?1 ORDER BY score LIMIT ?2 OFFSET ?3".to_string();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![&fts_query, limit, offset], |row| {
        let score: f64 = row.get(3)?;
        Ok(SearchResult {
            page_id: row.get(0)?,
            title: row.get(1)?,
            snippet: row.get(2)?,
            score: -score, // bm25 返回负值，取反使其为正
        })
    })?;

    let results: Vec<SearchResult> = rows.filter_map(|r| r.ok()).collect();
    let total = results.len() as i32;

    Ok(SearchOutput {
        query: query.to_string(),
        mode: mode.to_string(),
        total,
        results,
    })
}

#[derive(Debug, Serialize)]
pub struct SearchOutput {
    pub query: String,
    pub mode: String,
    pub total: i32,
    pub results: Vec<SearchResult>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(page_id, title, content, tags);",
        ).unwrap();
        conn
    }

    #[test]
    fn test_index_and_search() {
        let conn = test_conn();
        index_page(&conn, "p1", "Rust 编程", "Rust 是一门系统编程语言", "rust,lang").unwrap();
        index_page(&conn, "p2", "Go 语言", "Go 是 Google 开发的语言", "go,lang").unwrap();

        let output = search(&conn, "Rust", "and", 10, 0).unwrap();
        assert_eq!(output.total, 1);
        assert_eq!(output.results[0].page_id, "p1");
        assert!(output.results[0].snippet.contains("<mark>"));
    }

    #[test]
    fn test_search_or_mode() {
        let conn = test_conn();
        index_page(&conn, "p1", "Rust", "Rust 内容", "").unwrap();
        index_page(&conn, "p2", "Go", "Go 内容", "").unwrap();

        let output = search(&conn, "Rust Go", "or", 10, 0).unwrap();
        assert_eq!(output.total, 2);
    }

    #[test]
    fn test_search_no_results() {
        let conn = test_conn();
        let output = search(&conn, "不存在的关键词", "and", 10, 0).unwrap();
        assert_eq!(output.total, 0);
    }

    #[test]
    fn test_deindex() {
        let conn = test_conn();
        index_page(&conn, "p1", "Test", "内容", "").unwrap();
        deindex_page(&conn, "p1").unwrap();

        let output = search(&conn, "Test", "and", 10, 0).unwrap();
        assert_eq!(output.total, 0);
    }

    #[test]
    fn test_reindex() {
        let conn = test_conn();
        index_page(&conn, "p1", "旧标题", "旧内容", "").unwrap();
        index_page(&conn, "p1", "新标题", "新内容", "").unwrap();

        let output = search(&conn, "新内容", "and", 10, 0).unwrap();
        assert_eq!(output.total, 1);
        assert_eq!(output.results[0].title, "新标题");
    }
}
