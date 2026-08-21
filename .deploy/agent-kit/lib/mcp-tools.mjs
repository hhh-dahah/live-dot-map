import { BridgeClientError, LocalBridgeClient } from './bridge-client.mjs';
import { MCP_TOOL_DEFINITIONS, MCP_TOOL_NAMES } from './tool-definitions.generated.mjs';

export { MCP_TOOL_DEFINITIONS, MCP_TOOL_NAMES };

const DEFINITION_BY_NAME = new Map(MCP_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

function jsonText(value) {
  return JSON.stringify(value === undefined ? null : value, null, 2);
}

function toolError(error) {
  const code = error?.code || 'MCP_TOOL_FAILED';
  const message = error?.message || '地图工具执行失败';
  return {
    isError: true,
    content: [{ type: 'text', text: jsonText({ ok: false, code, message, details: error?.details }) }],
    structuredContent: { ok: false, code, message, details: error?.details },
  };
}

/** MCP JSON-RPC adapter.  It is deliberately transport-only and has no FS map access. */
export class MapMcpServer {
  constructor({ client, output = process.stdout } = {}) {
    this.client = client;
    this.output = output;
    if (!(client instanceof LocalBridgeClient) && !client) throw new BridgeClientError('MCP_CLIENT_REQUIRED', 'MCP 适配器需要 LocalBridgeClient');
  }

  async callTool(name, args = {}) {
    if (!DEFINITION_BY_NAME.has(name)) throw new BridgeClientError('UNKNOWN_MCP_TOOL', `未知地图工具: ${name}`, { status: 400 });
    return this.client.mcp(name, args);
  }

  async handleMessage(message) {
    if (!message || typeof message !== 'object') return undefined;
    const { id, method, params = {} } = message;
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return undefined;
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'livedot-map-local-bridge', version: '2.0.0' },
          instructions: '活点地图所有写入必须经本地桥命令处理器；不要直接编辑 map.json。',
        },
      };
    }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOL_DEFINITIONS } };
    }
    if (method === 'tools/call') {
      const name = params.name;
      try {
        const result = await this.callTool(name, params.arguments || {});
        return {
          jsonrpc: '2.0',
          id,
          result: {
            isError: false,
            content: [{ type: 'text', text: jsonText(result) }],
            structuredContent: result,
          },
        };
      } catch (error) {
        return { jsonrpc: '2.0', id, result: toolError(error) };
      }
    }
    if (id === undefined) return undefined;
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `不支持 MCP 方法: ${String(method)}` },
    };
  }

  async serveStdio({ input = process.stdin, output = this.output } = {}) {
    let buffer = '';
    input.setEncoding?.('utf8');
    for await (const chunk of input) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 无效' } })}\n`);
          continue;
        }
        const response = await this.handleMessage(message);
        if (response) output.write(`${JSON.stringify(response)}\n`);
      }
    }
    if (buffer.trim()) {
      const response = await this.handleMessage(JSON.parse(buffer));
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  }
}

export function mcpToolDefinitions() {
  return MCP_TOOL_DEFINITIONS.map((definition) => structuredClone(definition));
}
