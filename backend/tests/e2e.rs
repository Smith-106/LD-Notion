// E2E 测试 — 创建工作区 → 创建页面 → 写入内容 → 搜索 → MCP 读取 完整链路
#![allow(clippy::unnecessary_to_owned)]

use axum::{
    body::Body,
    http::{Request, StatusCode},
    routing::{delete, get, post},
    Router,
};
use ld_notion_backend::*;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;
use tower_http::cors::{Any, CorsLayer};

fn make_app() -> Router {
    let db_dir = std::env::temp_dir().join(format!("ld-notion-e2e-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&db_dir).unwrap();
    let db_path = db_dir.join("test.db");
    let storage_root = db_dir.join("storage");
    std::fs::create_dir_all(&storage_root).unwrap();

    let conn = db::initialize(&db_path, &storage_root).unwrap();
    db::validate_schema(&conn).unwrap();

    let cfg = config::Config {
        host: "127.0.0.1".to_string(),
        port: 13001,
        database_path: db_path,
        storage_root,
    };

    let state = Arc::new(AppState {
        db: tokio::sync::Mutex::new(conn),
        config: cfg,
    });

    Router::new()
        .route("/health", get(health_check))
        .route("/api/workspaces", get(list_workspaces).post(create_workspace))
        .route("/api/workspaces/{id}", delete(delete_workspace))
        .route("/api/pages", post(create_page))
        .route("/api/pages/{id}", get(get_page).delete(delete_page))
        .route("/api/pages/{id}/content", get(get_page_content).put(update_page_content))
        .route("/api/workspaces/{ws_id}/tree", get(get_page_tree))
        .route("/api/search", get(search_pages))
        .nest("/mcp", mcp::transport::mcp_routes())
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .with_state(state)
}

async fn send(app: &Router, req: Request<Body>) -> (StatusCode, Value) {
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let text = String::from_utf8_lossy(&bytes);
    let val: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
        panic!("Non-JSON response (status={status}): {text}");
    });
    (status, val)
}

fn post_json(uri: &str, body: &Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap()
}

fn put_json(uri: &str, body: &Value) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(uri)
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap()
}

fn get_uri(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

fn delete_uri(uri: &str) -> Request<Body> {
    Request::builder().method("DELETE").uri(uri).body(Body::empty()).unwrap()
}

#[tokio::test]
async fn e2e_create_workspace_page_search_mcp() {
    let app = make_app();

    // 1. 创建工作区
    let (status, body) = send(&app, post_json("/api/workspaces", &json!({"name": "测试工作区"}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    let ws_id = body["data"]["id"].as_str().unwrap();

    // 2. 创建页面
    let (status, body) = send(
        &app,
        post_json("/api/pages", &json!({
            "workspace_id": ws_id,
            "title": "Rust 异步编程"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    let page_id = body["data"]["id"].as_str().unwrap();
    assert_eq!(body["data"]["title"], "Rust 异步编程");

    // 3. 写入页面内容
    let (status, body) = send(
        &app,
        put_json(
            &format!("/api/pages/{page_id}/content"),
            &json!({"body": "# Rust 异步编程\n\nTokio 是 Rust 最流行的异步运行时。\n\n## async/await\n\n使用 async fn 和 .await 语法。"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    // 4. 读取页面内容
    let (status, body) = send(&app, get_uri(&format!("/api/pages/{page_id}/content"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["title"], "Rust 异步编程");
    assert!(body["data"]["body"].as_str().unwrap().contains("Tokio"));

    // 5. 搜索 — 关键词 "Tokio"
    let (status, body) = send(&app, get_uri("/api/search?q=Tokio")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    // 6. MCP: tools/list 验证
    let mcp_req = Request::builder()
        .method("POST")
        .uri("/mcp/message")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}
        })).unwrap()))
        .unwrap();
    let (status, body) = send(&app, mcp_req).await;
    assert_eq!(status, StatusCode::OK);
    let tools = body["result"]["tools"].as_array().unwrap();
    assert!(tools.len() >= 3);

    // 7. MCP: page/read 验证
    let mcp_req = Request::builder()
        .method("POST")
        .uri("/mcp/message")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "page/read", "arguments": { "page_id": page_id } }
        })).unwrap()))
        .unwrap();
    let (status, body) = send(&app, mcp_req).await;
    assert_eq!(status, StatusCode::OK);
    let content_text = body["result"]["content"][0]["text"].as_str().unwrap();
    assert!(content_text.contains("Rust 异步编程"));

    // 8. 删除页面
    let (status, body) = send(&app, delete_uri(&format!("/api/pages/{page_id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    // 9. 删除工作区
    let (status, body) = send(&app, delete_uri(&format!("/api/workspaces/{ws_id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn e2e_page_tree_hierarchy() {
    let app = make_app();

    // 创建工作区
    let (_, body) = send(&app, post_json("/api/workspaces", &json!({"name": "树测试"}))).await;
    let ws_id = body["data"]["id"].as_str().unwrap();

    // 创建父页面
    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({"workspace_id": ws_id, "title": "父页面"})),
    )
    .await;
    let parent_id = body["data"]["id"].as_str().unwrap();

    // 创建子页面
    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({
            "workspace_id": ws_id,
            "parent_id": parent_id,
            "title": "子页面"
        })),
    )
    .await;
    assert_eq!(body["ok"], true);

    // 获取页面树
    let (_, body) = send(&app, get_uri(&format!("/api/workspaces/{ws_id}/tree"))).await;
    assert_eq!(body["ok"], true);
    let tree = body["data"].as_array().unwrap();
    assert!(!tree.is_empty());

    // MCP: page/list 验证树结构
    let mcp_req = Request::builder()
        .method("POST")
        .uri("/mcp/message")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": "page/list", "arguments": { "workspace_id": ws_id } }
        })).unwrap()))
        .unwrap();
    let (_, body) = send(&app, mcp_req).await;
    let content_text = body["result"]["content"][0]["text"].as_str().unwrap();
    assert!(content_text.contains("父页面"));
}

#[tokio::test]
async fn e2e_cascade_delete_deep_hierarchy() {
    let app = make_app();

    let (_, body) = send(&app, post_json("/api/workspaces", &json!({"name": "级联删除测试"}))).await;
    let ws_id = body["data"]["id"].as_str().unwrap();

    // 创建三层嵌套: 根 → 子 → 孙
    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({"workspace_id": ws_id, "title": "根页面"})),
    )
    .await;
    let root_id = body["data"]["id"].as_str().unwrap();

    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({
            "workspace_id": ws_id,
            "parent_id": root_id,
            "title": "子页面"
        })),
    )
    .await;
    let child_id = body["data"]["id"].as_str().unwrap();

    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({
            "workspace_id": ws_id,
            "parent_id": child_id,
            "title": "孙页面"
        })),
    )
    .await;
    let grandchild_id = body["data"]["id"].as_str().unwrap();

    // 写入内容
    send(
        &app,
        put_json(&format!("/api/pages/{grandchild_id}/content"), &json!({"body": "孙页面内容"})),
    )
    .await;

    // 删除根页面（应级联删除所有后代）
    let (status, body) = send(&app, delete_uri(&format!("/api/pages/{root_id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    // 验证子页面已删除
    let (_, body) = send(&app, get_uri(&format!("/api/pages/{child_id}"))).await;
    assert_eq!(body["ok"], false);

    // 验证孙页面已删除
    let (_, body) = send(&app, get_uri(&format!("/api/pages/{grandchild_id}"))).await;
    assert_eq!(body["ok"], false);
}

#[tokio::test]
async fn e2e_search_and_or_modes() {
    let app = make_app();

    let (_, body) = send(&app, post_json("/api/workspaces", &json!({"name": "搜索测试"}))).await;
    let ws_id = body["data"]["id"].as_str().unwrap();

    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({"workspace_id": ws_id, "title": "JavaScript 教程"})),
    )
    .await;
    let page1 = body["data"]["id"].as_str().unwrap();

    send(
        &app,
        put_json(
            &format!("/api/pages/{page1}/content"),
            &json!({"body": "JavaScript 是一门动态类型的编程语言，广泛用于 Web 开发。"}),
        ),
    )
    .await;

    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({"workspace_id": ws_id, "title": "TypeScript 进阶"})),
    )
    .await;
    let page2 = body["data"]["id"].as_str().unwrap();

    send(
        &app,
        put_json(
            &format!("/api/pages/{page2}/content"),
            &json!({"body": "TypeScript 是 JavaScript 的超集，增加了静态类型检查。"}),
        ),
    )
    .await;

    // AND 模式搜索
    let (_, body) = send(&app, get_uri("/api/search?q=JavaScript+编程&mode=and")).await;
    assert_eq!(body["ok"], true);

    // OR 模式搜索
    let (_, body) = send(&app, get_uri("/api/search?q=JavaScript+TypeScript&mode=or")).await;
    assert_eq!(body["ok"], true);
}

#[tokio::test]
async fn e2e_workspace_delete_cleans_files() {
    let app = make_app();

    // 创建工作区和页面
    let (_, body) = send(&app, post_json("/api/workspaces", &json!({"name": "文件清理测试"}))).await;
    let ws_id = body["data"]["id"].as_str().unwrap();

    let (_, body) = send(
        &app,
        post_json("/api/pages", &json!({"workspace_id": ws_id, "title": "待删除页面"})),
    )
    .await;
    let page_id = body["data"]["id"].as_str().unwrap();

    // 写入内容确保文件存在
    send(
        &app,
        put_json(
            &format!("/api/pages/{page_id}/content"),
            &json!({"body": "这条内容应该随工作区删除而消失"}),
        ),
    )
    .await;

    // 验证文件在删除前存在（通过读取 API 确认）
    let (status, _) = send(&app, get_uri(&format!("/api/pages/{page_id}/content"))).await;
    assert_eq!(status, StatusCode::OK);

    // 删除工作区
    let (status, body) = send(&app, delete_uri(&format!("/api/workspaces/{ws_id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);

    // 验证页面已不存在
    let (status, body) = send(&app, get_uri(&format!("/api/pages/{page_id}"))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
}

#[tokio::test]
async fn e2e_validation_errors() {
    let app = make_app();

    // 空工作区名称
    let (status, body) = send(&app, post_json("/api/workspaces", &json!({"name": ""}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert!(body["error"].as_str().unwrap().contains("不能为空"));

    // 纯空格名称
    let (status, body) = send(&app, post_json("/api/workspaces", &json!({"name": "   "}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);

    // 空页面标题
    let (_, body) = send(&app, post_json("/api/workspaces", &json!({"name": "验证测试"}))).await;
    let ws_id = body["data"]["id"].as_str().unwrap();

    let (status, body) = send(
        &app,
        post_json("/api/pages", &json!({"workspace_id": ws_id, "title": ""})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);

    // 不存在的页面
    let (status, body) = send(&app, get_uri("/api/pages/nonexistent-id")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);

    // 不存在的页面内容
    let (status, body) = send(&app, get_uri("/api/pages/nonexistent-id/content")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
}

#[tokio::test]
async fn e2e_create_page_invalid_workspace() {
    let app = make_app();

    // 不存在的工作区 ID
    let (status, body) = send(
        &app,
        post_json("/api/pages", &json!({
            "workspace_id": "00000000-0000-0000-0000-000000000000",
            "title": "测试页面"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], false);
    assert!(body["error"].as_str().unwrap().contains("工作区不存在"));
}
