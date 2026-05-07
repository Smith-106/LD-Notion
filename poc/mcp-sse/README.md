# LD-Notion MCP SSE 端点 PoC

最小可行验证：通过 SSE + HTTP POST 实现 MCP（Model Context Protocol）服务端。

## 快速开始

```bash
# 1. 安装依赖
cd poc/mcp-sse
npm install

# 2. 启动服务
node server.js

# 3. 另一个终端运行测试
node test-client.js
```

服务启动后：
- **SSE 端点**: `http://localhost:9876/sse`
- **消息端点**: `http://localhost:9876/message`

## 提供的工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `hello` | 返回问候语 | 无 |
| `echo`  | 回显消息 | `message` (必填，string) |

## 协议说明

- 客户端发送 JSON-RPC 2.0 请求到 `POST /message`
- 服务端通过 `GET /sse` 的 SSE 连接异步推送响应
- 所有 SSE 事件格式：`data: <json>\n\n`

## 在 Claude Desktop 中配置

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "ld-notion": {
      "url": "http://localhost:9876/sse"
    }
  }
}
```

> 注意：这是 PoC 阶段，仅支持 SSE 传输。不支持 `stdio` 传输。
