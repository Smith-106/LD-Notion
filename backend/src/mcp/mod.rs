// MCP 协议模块 — JSON-RPC 2.0 over SSE
// 实现 MCP Server 核心：initialize、tools/list、tools/call

pub mod transport;
pub mod handler;

use serde::{Deserialize, Serialize};

/// JSON-RPC 2.0 请求
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// JSON-RPC 2.0 响应
#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl JsonRpcResponse {
    #[must_use] 
    pub fn success(id: Option<serde_json::Value>, result: serde_json::Value) -> Self {
        Self { jsonrpc: "2.0".to_string(), id, result: Some(result), error: None }
    }

    #[must_use] 
    pub fn error(id: Option<serde_json::Value>, code: i32, message: &str) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message: message.to_string(), data: None }),
        }
    }
}

/// MCP Server 信息
#[must_use] 
pub fn server_info() -> serde_json::Value {
    serde_json::json!({
        "name": "ld-notion-mcp",
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// MCP 能力声明
#[must_use] 
pub fn server_capabilities() -> serde_json::Value {
    serde_json::json!({
        "tools": { "listChanged": false }
    })
}
