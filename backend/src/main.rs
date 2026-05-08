// LD-Notion Hub 后端服务入口

use axum::{routing::{delete, get, post, put}, Router};
use ld_notion_backend::{config, db, AppState, health_check, list_workspaces, create_workspace, delete_workspace, create_page, get_page, delete_page, get_page_content, update_page_content, get_page_tree, search_pages, rename_page, move_page, import_page, update_tags, list_tags as list_workspace_tags, list_recent, list_pinned, toggle_pin, mcp};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "ld_notion_backend=info".to_string()),
        )
        .init();

    let cfg = config::Config::from_env();
    cfg.validate().expect("配置验证失败");

    let conn = db::initialize(&cfg.database_path, &cfg.storage_root)
        .expect("数据库初始化失败");
    db::validate_schema(&conn).expect("Schema 验证失败");

    tracing::info!("数据库路径: {}", cfg.database_path.display());
    tracing::info!("存储根目录: {}", cfg.storage_root.display());

    let state = Arc::new(AppState {
        db: tokio::sync::Mutex::new(conn),
        config: cfg.clone(),
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/workspaces", get(list_workspaces).post(create_workspace))
        .route("/api/workspaces/{id}", delete(delete_workspace))
        .route("/api/pages", post(create_page))
        .route("/api/pages/{id}", get(get_page).delete(delete_page))
        .route("/api/pages/{id}/content", get(get_page_content).put(update_page_content))
        .route("/api/pages/{id}/rename", put(rename_page))
        .route("/api/pages/{id}/move", put(move_page))
        .route("/api/pages/import", post(import_page))
        .route("/api/pages/{id}/tags", put(update_tags))
        .route("/api/pages/{id}/pin", put(toggle_pin))
        .route("/api/workspaces/{ws_id}/tags", get(list_workspace_tags))
        .route("/api/workspaces/{ws_id}/recent", get(list_recent))
        .route("/api/workspaces/{ws_id}/pinned", get(list_pinned))
        .route("/api/workspaces/{ws_id}/tree", get(get_page_tree))
        .route("/api/search", get(search_pages))
        .nest("/mcp", mcp::transport::mcp_routes())
        .layer(cors)
        .with_state(state);

    let addr = cfg.bind_address();
    tracing::info!("服务启动于 http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("绑定端口失败");

    axum::serve(listener, app).await.expect("服务运行失败");
}
