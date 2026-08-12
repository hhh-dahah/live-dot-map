import { MCP_TOOL_NAMES, BridgeClientError, LocalBridgeClient } from './bridge-client.mjs';

export const MCP_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'map_get_context',
    description: '读取当前项目地图上下文、全局推进摘要与相关 Markdown 片段。',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, includeHistory: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 12 } },
      additionalProperties: true,
    },
  },
  {
    name: 'map_list_human_updates',
    description: '列出人类新标注和仍未确认的标注；不会因为调用本工具就伪造 Agent 已读取。',
    inputSchema: {
      type: 'object',
      properties: { includeAcknowledged: { type: 'boolean' }, includeResolved: { type: 'boolean' } },
      additionalProperties: true,
    },
  },
  {
    name: 'map_ack_human_updates',
    description: '在摘要明确引用每个标注 ID 后确认已读取；服务端会再次校验 ID。',
    inputSchema: {
      type: 'object',
      required: ['ids', 'summary'],
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1 }, summary: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
  },
  {
    name: 'map_next_candidates',
    description: '按确定性图检索返回候选地图对象和理由。参数契约固定为 query、currentNodeId、limit、includeHistory。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', default: '' },
        currentNodeId: { anyOf: [{ type: 'string' }, { type: 'null' }], default: null },
        limit: { type: 'integer', minimum: 1, maximum: 12, default: 12 },
        includeHistory: { type: 'boolean', default: false },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'map_apply_commands',
    description: '通过本地桥命令处理器提交命令；客户端不直接修改 map.json。',
    inputSchema: {
      type: 'object',
      required: ['baseRevision', 'commands'],
      properties: {
        projectId: { type: 'string' },
        baseRevision: { type: 'integer', minimum: 0 },
        commandId: { type: 'string' },
        actor: { type: 'string' },
        sessionId: { type: 'string' },
        commands: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'map_validate',
    description: '在本地桥校验当前地图及其 Markdown 关系。',
    inputSchema: { type: 'object', properties: { revision: { type: 'integer', minimum: 0 } }, additionalProperties: true },
  },
  {
    name: 'map_checkpoint',
    description: '请求本地桥创建可恢复检查点；不复制或重写地图文件。',
    inputSchema: { type: 'object', properties: { reason: { type: 'string' } }, additionalProperties: true },
  },
]);

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
    switch (name) {
      case 'map_get_context': return this.client.mapGetContext(args);
      case 'map_list_human_updates': return this.client.mapListHumanUpdates(args);
      case 'map_ack_human_updates': return this.client.mapAckHumanUpdates(args);
      case 'map_next_candidates': return this.client.mapNextCandidates(args);
      case 'map_apply_commands': return this.client.mapApplyCommands(args);
      case 'map_validate': return this.client.mapValidate(args);
      case 'map_checkpoint': return this.client.mapCheckpoint(args);
      default: throw new BridgeClientError('UNKNOWN_MCP_TOOL', `未知地图工具: ${name}`, { status: 400 });
    }
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

export { MCP_TOOL_NAMES };
