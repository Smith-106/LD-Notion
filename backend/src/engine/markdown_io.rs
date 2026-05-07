// Markdown 文件读写 — YAML frontmatter 解析与序列化

use std::fs;
use std::path::Path;

use super::MarkdownContent;

/// 读取 Markdown 文件，解析 frontmatter + body
pub fn read(path: &Path) -> Result<MarkdownContent, Box<dyn std::error::Error>> {
    let content = fs::read_to_string(path)?;
    Ok(parse(&content))
}

/// 写入 Markdown 文件，生成 frontmatter + body
pub fn write(path: &Path, content: &MarkdownContent) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = serialize(content);
    fs::write(path, serialized)?;
    Ok(())
}

/// 解析 Markdown 内容为结构化数据
fn parse(content: &str) -> MarkdownContent {
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return MarkdownContent {
            title: String::new(),
            tags: vec![],
            created: String::new(),
            updated: String::new(),
            body: trimmed.to_string(),
        };
    }

    // 查找结束的 ---
    let rest = &trimmed[3..];
    let Some(end) = rest.find("---") else {
        return MarkdownContent {
            title: String::new(),
            tags: vec![],
            created: String::new(),
            updated: String::new(),
            body: content.to_string(),
        };
    };

    let frontmatter = &rest[..end];
    let body = rest[end + 3..].trim_start().to_string();

    // 简易 YAML 解析（避免引入重量级 YAML 库）
    let mut title = String::new();
    let mut tags = vec![];
    let mut created = String::new();
    let mut updated = String::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("title:") {
            title.clone_from(&val.trim().trim_matches('"').replace("\\\"", "\""));
        } else if let Some(val) = line.strip_prefix("tags:") {
            let val = val.trim();
            if val.starts_with('[') && val.ends_with(']') {
                tags = val[1..val.len() - 1]
                    .split(',')
                    .map(|s| s.trim().trim_matches('"').to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        } else if let Some(val) = line.strip_prefix("created:") {
            created = val.trim().trim_matches('"').to_string();
        } else if let Some(val) = line.strip_prefix("updated:") {
            updated = val.trim().trim_matches('"').to_string();
        }
    }

    MarkdownContent { title, tags, created, updated, body }
}

/// 序列化为 Markdown + frontmatter
fn serialize(content: &MarkdownContent) -> String {
    let tags_str = if content.tags.is_empty() {
        "[]".to_string()
    } else {
        format!("[{}]", content.tags.iter().map(|t| format!("\"{}\"", t.replace('"', "\\\""))).collect::<Vec<_>>().join(", "))
    };

    let escaped_title = content.title.replace('"', "\\\"");

    format!(
        "---\ntitle: \"{}\"\ntags: {}\ncreated: {}\nupdated: {}\n---\n{}",
        escaped_title, tags_str, content.created, content.updated, content.body
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frontmatter() {
        let md = "---\ntitle: \"测试页面\"\ntags: [\"rust\", \"mcp\"]\ncreated: 2026-05-07\nupdated: 2026-05-07\n---\nHello world";
        let content = parse(md);
        assert_eq!(content.title, "测试页面");
        assert_eq!(content.tags, vec!["rust", "mcp"]);
        assert_eq!(content.body, "Hello world");
    }

    #[test]
    fn test_roundtrip() {
        let original = MarkdownContent {
            title: "测试".to_string(),
            tags: vec!["a".to_string()],
            created: "2026-01-01".to_string(),
            updated: "2026-01-01".to_string(),
            body: "正文内容".to_string(),
        };
        let serialized = serialize(&original);
        let parsed = parse(&serialized);
        assert_eq!(parsed.title, original.title);
        assert_eq!(parsed.tags, original.tags);
        assert_eq!(parsed.body, original.body);
    }

    #[test]
    fn test_roundtrip_quoted_title() {
        let original = MarkdownContent {
            title: r#"Hello "World" Test"#.to_string(),
            tags: vec![],
            created: "2026-01-01".to_string(),
            updated: "2026-01-01".to_string(),
            body: "内容".to_string(),
        };
        let serialized = serialize(&original);
        assert!(serialized.contains(r#"Hello \"World\" Test"#));
        let parsed = parse(&serialized);
        assert_eq!(parsed.title, original.title);
    }
}
