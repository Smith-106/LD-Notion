// MCP 传输层 — SSE (Server-Sent Events) 端点
// Axum 路由处理 MCP 客户端的 SSE 连接和 JSON-RPC 消息

use axum::{
    extract::State,
    response::sse::{Event, Sse},
    routing::{get, post},
    Json, Router,
};
use futures::stream::Stream;
use std::sync::Arc;
use std::time::Duration;

use super::{JsonRpcRequest, JsonRpcResponse};
use crate::AppState;

/// 注册 MCP SSE 路由
pub fn mcp_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/sse", get(sse_handler))
        .route("/message", post(message_handler))
}

/// GET /mcp/sse — SSE 连接端点
async fn sse_handler() -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let stream = futures::stream::once(async {
        Ok(Event::default().event("endpoint").data("/mcp/message"))
    });
    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text("ping"),
    )
}

/// POST /mcp/message — 接收并处理 JSON-RPC 请求
async fn message_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    let id = req.id.clone();
    let response = match req.method.as_str() {
        "initialize" => super::handler::handle_initialize(&req),
        "notifications/initialized" => {
            return Json(JsonRpcResponse::success(id, serde_json::json!({})));
        }
        "tools/list" => super::handler::handle_tools_list(&req),
        "tools/call" => super::handler::handle_tools_call(&req, &state).await,
        _ => JsonRpcResponse::error(id, -32601, "Method not found"),
    };
    Json(response)
}
