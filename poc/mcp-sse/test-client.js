/**
 * MCP SSE 测试客户端
 *
 * 模拟完整的 MCP 客户端流程：
 *   1. 建立 SSE 连接
 *   2. 发送 initialize 请求 → 等待响应
 *   3. 发送 tools/list → 等待响应
 *   4. 调用 hello 工具
 *   5. 调用 echo 工具
 *   6. 验证所有响应
 */

const http = require('http');

// ─── 配置 ────────────────────────────────────────────────
const SSE_URL = 'http://localhost:9876/sse';
const MSG_URL = 'http://localhost:9876/message';

// 解析 URL 得到 host/port/path
const sseUrl = new URL(SSE_URL);
const msgUrl = new URL(MSG_URL);

let requestId = 1;
const pendingRequests = new Map(); // id → { resolve, reject }

// ─── SSE 连接 ────────────────────────────────────────────
function connectSSE() {
  return new Promise((resolve, reject) => {
    console.log('[TEST] 建立 SSE 连接...');

    const req = http.request(
      {
        hostname: sseUrl.hostname,
        port: sseUrl.port,
        path: sseUrl.pathname,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream'
        }
      },
      (res) => {
        console.log(`[TEST] SSE 连接建立，状态码: ${res.statusCode}`);

        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          // 解析 SSE 事件 — 按双换行分割
          const events = buffer.split('\n\n');
          buffer = events.pop(); // 最后一段可能不完整

          events.forEach((event) => {
            const lines = event.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.substring(6);
                try {
                  const data = JSON.parse(jsonStr);
                  handleSSEMessage(data);
                } catch (e) {
                  console.log(`[SSE] 非 JSON 数据: ${jsonStr}`);
                }
              }
            }
          });
        });

        res.on('end', () => {
          console.log('[TEST] SSE 连接关闭');
        });

        resolve();
      }
    );

    req.on('error', (err) => {
      console.error(`[TEST] SSE 连接失败: ${err.message}`);
      reject(err);
    });

    req.end();
  });
}

// ─── SSE 消息处理 ────────────────────────────────────────
function handleSSEMessage(data) {
  // MCP endpoint 事件 — 服务端告知消息端点
  if (data.method === 'endpoint') {
    console.log(`[SSE] 收到 endpoint 事件: ${data.params.uri}`);
    return;
  }

  // JSON-RPC 响应或通知
  if (data.jsonrpc === '2.0') {
    // 通知（无 id）
    if (data.id === undefined || data.id === null) {
      console.log(`[SSE] 收到通知: method=${data.method}`);
      return;
    }

    // 响应 — 匹配 pending 请求
    const pending = pendingRequests.get(data.id);
    if (pending) {
      pendingRequests.delete(data.id);
      if (data.error) {
        pending.reject(new Error(`JSON-RPC 错误 ${data.error.code}: ${data.error.message}`));
      } else {
        pending.resolve(data.result);
      }
    } else {
      console.log(`[SSE] 收到未匹配的响应 id=${data.id}`);
    }
  }
}

// ─── 发送 JSON-RPC 请求 ──────────────────────────────────
// notification=true → 通知类型，不等待响应，不加入 pending map
function sendRequest(method, params, notification) {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id
    });

    // 通知不期望响应，POST 返回 202 后直接 resolve
    if (notification) {
      const req = http.request(
        {
          hostname: msgUrl.hostname,
          port: msgUrl.port,
          path: msgUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        },
        (res) => {
          res.resume(); // 消费响应体
          res.on('end', () => resolve());
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
      return;
    }

    // 普通请求 — 等待 SSE 响应
    pendingRequests.set(id, { resolve, reject });

    // 设置超时（5 秒）
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`请求超时: ${method} (id=${id})`));
    }, 5000);

    const req = http.request(
      {
        hostname: msgUrl.hostname,
        port: msgUrl.port,
        path: msgUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          clearTimeout(timer);
          if (res.statusCode !== 202) {
            pendingRequests.delete(id);
            reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
          }
          // 202 Accepted — 真正的响应通过 SSE 异步返回
        });
      }
    );

    req.on('error', (err) => {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

// ─── 断言工具 ────────────────────────────────────────────
function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ 失败: ${message}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  ✓ 通过: ${message}`);
  return true;
}

// ─── 主测试流程 ──────────────────────────────────────────
async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  LD-Notion MCP SSE 测试客户端');
  console.log('═══════════════════════════════════════════\n');

  // 短暂等待服务端就绪
  await new Promise((r) => setTimeout(r, 300));

  try {
    // 1. 建立 SSE 连接
    await connectSSE();
    await new Promise((r) => setTimeout(r, 200)); // 等待 endpoint 事件

    // 2. Initialize 握手
    console.log('[TEST] 发送 initialize 请求...');
    const initResult = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ld-notion-test-client', version: '0.1.0' }
    });

    assert(initResult.protocolVersion === '2024-11-05', '协议版本正确');
    assert(initResult.serverInfo.name === 'ld-notion-mcp-poc', '服务名称正确');
    assert(initResult.capabilities.tools !== undefined, '声明支持 tools');

    // 3. 发送 initialized 通知（notification=true → 不等待 SSE 响应）
    console.log('[TEST] 发送 initialized 通知...');
    await sendRequest('notifications/initialized', {}, true);

    // 4. tools/list
    console.log('[TEST] 获取工具列表...');
    const toolsResult = await sendRequest('tools/list', {});
    assert(toolsResult.tools !== undefined, '返回 tools 数组');
    assert(toolsResult.tools.length === 2, `工具数量为 2（实际: ${toolsResult.tools.length}）`);

    // 验证 hello 工具
    const helloDef = toolsResult.tools.find((t) => t.name === 'hello');
    assert(helloDef !== undefined, '存在 hello 工具');
    assert(helloDef.description !== undefined, 'hello 工具有描述');

    // 验证 echo 工具
    const echoDef = toolsResult.tools.find((t) => t.name === 'echo');
    assert(echoDef !== undefined, '存在 echo 工具');
    assert(echoDef.inputSchema.required.includes('message'), 'echo 工具要求 message 参数');

    // 5. 调用 hello 工具
    console.log('[TEST] 调用 hello 工具...');
    const helloResult = await sendRequest('tools/call', {
      name: 'hello',
      arguments: {}
    });
    assert(helloResult.content !== undefined, '返回 content 数组');
    assert(helloResult.content[0].type === 'text', 'content 类型为 text');
    assert(
      helloResult.content[0].text === 'Hello from LD-Notion MCP Server!',
      'hello 返回正确消息'
    );

    // 6. 调用 echo 工具
    console.log('[TEST] 调用 echo 工具...');
    const echoResult = await sendRequest('tools/call', {
      name: 'echo',
      arguments: { message: 'Hello World!' }
    });
    assert(echoResult.content !== undefined, '返回 content 数组');
    assert(echoResult.content[0].type === 'text', 'content 类型为 text');
    assert(echoResult.content[0].text === 'Echo: Hello World!', 'echo 返回正确回显');

    // 7. 测试未知工具
    console.log('[TEST] 调用未知工具（预期错误）...');
    try {
      await sendRequest('tools/call', {
        name: 'nonexistent',
        arguments: {}
      });
      assert(false, '未知工具应返回错误');
    } catch (err) {
      assert(err.message.includes('未知工具'), `未知工具错误: ${err.message}`);
    }

    console.log('\n═══════════════════════════════════════════');
    if (process.exitCode === 1) {
      console.log('  测试完成 — 有失败项');
    } else {
      console.log('  全部测试通过!');
    }
    console.log('═══════════════════════════════════════════');
  } catch (err) {
    console.error(`\n[TEST] 测试异常: ${err.message}`);
    process.exitCode = 1;
  } finally {
    // 给 SSE 一个清理窗口后退出
    setTimeout(() => process.exit(), 200);
  }
}

runTests();
