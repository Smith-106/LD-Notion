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

    let sql = format!(
        "SELECT f.page_id, f.title, highlight(fts_index, 2, '<mark>', '</mark>') as snippet, bm25(fts_index) as score
         FROM fts_index f WHERE fts_index MATCH ?1 ORDER BY score LIMIT ?2 OFFSET ?3"
    );

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
