/**
 * LD-Notion MCP SSE Server — 最小可行验证 (PoC)
 *
 * 功能：
 *   - 通过 SSE (/sse) 推送 JSON-RPC 响应给客户端
 *   - 通过 POST (/message) 接收客户端的 JSON-RPC 请求
 *   - 实现 MCP 协议握手、tools/list、tools/call
 *
 * 协议：JSON-RPC 2.0 + SSE (text/event-stream)
 */

const express = require('express');

// ─── 配置 ────────────────────────────────────────────────
const PORT = 9876;
const SERVER_INFO = {
  name: 'ld-notion-mcp-poc',
  version: '0.1.0'
};

// ─── 模拟 Tool 定义 ──────────────────────────────────────
const TOOLS = [
  {
    name: 'hello',
    description: '返回来自 LD-Notion MCP Server 的问候语',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'echo',
    description: '回显输入的 message 参数',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '要回显的消息内容'
        }
      },
      required: ['message']
    }
  }
];

// ─── 执行 Tool ───────────────────────────────────────────
function executeToolCall(name, args) {
  switch (name) {
    case 'hello':
      return [{ type: 'text', text: 'Hello from LD-Notion MCP Server!' }];
    case 'echo':
      return [{ type: 'text', text: `Echo: ${args.message}` }];
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

// ─── JSON-RPC 响应构建 ──────────────────────────────────
let nextId = 1;

// 全局 SSE 客户端列表 — 用于广播响应
const sseClients = [];

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastToSSE(jsonRpcResponse) {
  sseClients.forEach((res) => sendSSE(res, jsonRpcResponse));
}

// ─── Express App ────────────────────────────────────────
const app = express();

// 解析 JSON body（POST /message 用）
app.use(express.json());

// CORS 支持 — 允许 Chrome 扩展等跨域连接
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// ─── SSE 端点（GET） — 建立 SSE 连接 ────────────────────
app.get('/sse', (req, res) => {
  console.log('[SSE] 新客户端连接');

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // 立即发送头，建立连接

  // 加入广播列表
  sseClients.push(res);
  console.log(`[SSE] 当前连接数: ${sseClients.length}`);

  // 客户端断开时清理
  req.on('close', () => {
    const index = sseClients.indexOf(res);
    if (index !== -1) {
      sseClients.splice(index, 1);
    }
    console.log(`[SSE] 客户端断开，当前连接数: ${sseClients.length}`);
  });

  // MCP 协议: 连接建立后发送 endpoint 事件，告知客户端消息端点 URL
  sendSSE(res, {
    jsonrpc: '2.0',
    method: 'endpoint',
    params: { uri: `http://localhost:${PORT}/message` }
  });
});

// ─── 消息端点（POST） — 接收 JSON-RPC 请求 ──────────────
app.post('/message', (req, res) => {
  const body = req.body;
  const { method, id, params } = body;

  console.log(`[REQ] method=${method} id=${id}`);

  // 总是先返回 202 Accepted（响应通过 SSE 异步发送）
  res.status(202).json({ status: 'accepted' });

  // ── 处理不同方法 ──────────────────────────────────────
  try {
    switch (method) {
      case 'initialize': {
        console.log('[INIT] MCP 初始化握手');
        broadcastToSSE({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {} // 声明支持 tools
            },
            serverInfo: SERVER_INFO
          }
        });
        break;
      }

      case 'notifications/initialized': {
        // 客户端确认初始化完成，无需响应
        console.log('[INIT] 客户端确认初始化完成');
        break;
      }

      case 'tools/list': {
        console.log('[TOOLS] 返回工具列表');
        broadcastToSSE({
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS
          }
        });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params;
        console.log(`[TOOLS] 调用工具: ${name}, 参数: ${JSON.stringify(args)}`);
        const content = executeToolCall(name, args || {});
        broadcastToSSE({
          jsonrpc: '2.0',
          id,
          result: { content }
        });
        break;
      }

      default: {
        // 未知方法
        broadcastToSSE({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `方法未找到: ${method}`
          }
        });
      }
    }
  } catch (err) {
    console.error(`[ERROR] 处理请求时出错: ${err.message}`);
    broadcastToSSE({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `内部错误: ${err.message}`
      }
    });
  }
});

// ─── 启动服务 ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════');
  console.log('  LD-Notion MCP SSE Server PoC');
  console.log(`  端口: ${PORT}`);
  console.log(`  SSE 端点: http://localhost:${PORT}/sse`);
  console.log(`  消息端点: http://localhost:${PORT}/message`);
  console.log('═══════════════════════════════════════════');
});
