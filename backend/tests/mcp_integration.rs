// MCP 集成测试 — 验证 initialize / tools/list / tools/call 协议链路

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
    let db_dir = std::env::temp_dir().join(format!("ld-notion-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&db_dir).unwrap();
    let db_path = db_dir.join("test.db");
    let storage_root = db_dir.join("storage");
    std::fs::create_dir_all(&storage_root).unwrap();

    let conn = db::initialize(&db_path, &storage_root).unwrap();
    db::validate_schema(&conn).unwrap();

    let cfg = config::Config {
        host: "127.0.0.1".to_string(),
        port: 13000,
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
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

async fn send_request(app: Router, req: Request<Body>) -> (StatusCode, Value) {
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let val: Value = serde_json::from_slice(&body_bytes)
        .unwrap_or_else(|_| {
            let text = String::from_utf8_lossy(&body_bytes);
            panic!("Non-JSON response (status={}): {}", status, text);
        });
    (status, val)
}

async fn send_mcp(app: Router, method: &str, params: Value) -> (StatusCode, Value) {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let req = Request::builder()
        .method("POST")
        .uri("/mcp/message")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(&body).unwrap()))
        .unwrap();
    send_request(app, req).await
}

#[tokio::test]
async fn test_health_check() {
    let app = make_app();
    let req = Request::builder().uri("/health").body(Body::empty()).unwrap();
    let (status, body) = send_request(app, req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn test_mcp_initialize() {
    let app = make_app();
    let (status, body) = send_mcp(
        app,
        "initialize",
        json!({
            "protocolVersion": "2024-11-05",
            "clientInfo": { "name": "test-client", "version": "1.0" }
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(body["result"]["serverInfo"]["name"], "ld-notion-mcp");
}

#[tokio::test]
async fn test_mcp_tools_list() {
    let app = make_app();
    let (status, body) = send_mcp(app, "tools/list", json!({})).await;

    assert_eq!(status, StatusCode::OK);
    let tools = body["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"page/list"));
    assert!(names.contains(&"page/read"));
    assert!(names.contains(&"search"));
}

#[tokio::test]
async fn test_mcp_search_tool() {
    let app = make_app();
    let (status, body) = send_mcp(
        app,
        "tools/call",
        json!({
            "name": "search",
            "arguments": { "query": "test" }
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["result"]["content"][0]["type"], "text");
}

#[tokio::test]
async fn test_mcp_unknown_tool() {
    let app = make_app();
    let (status, body) = send_mcp(app, "tools/call", json!({ "name": "nonexistent" })).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["error"]["code"] == -32000);
}

#[tokio::test]
async fn test_mcp_method_not_found() {
    let app = make_app();
    let (status, body) = send_mcp(app, "nonexistent/method", json!({})).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["error"]["code"] == -32601);
}
