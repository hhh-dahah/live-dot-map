import { createHash } from 'node:crypto';
import { LocalBridgeClient, MCP_TOOL_NAMES } from './bridge-client.mjs';
import { MapMcpServer, mcpToolDefinitions } from './mcp-tools.mjs';
import { verifyPortableNodeArchive } from './portable-node.mjs';

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
    body: null,
  };
}

function fakeFetchFactory() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path.endsWith('/health')) return response({ ok: true, status: 'ready' });
    if (path.endsWith('/snapshot')) return response({ revision: 3, document: { anns: [] } });
    if (path.endsWith('/commands')) return response({ revision: 4, checksum: 'test', idempotent: false });
    if (path.endsWith('/mcp')) {
      const payload = JSON.parse(options.body);
      if (payload.name === 'map_get_context') return response({ structuredContent: { summary: 'self-test context' } });
      if (payload.name === 'map_list_human_updates') return response({ structuredContent: { updates: [] } });
      if (payload.name === 'map_validate') return response({ structuredContent: { ok: true } });
      if (payload.name === 'map_next_candidates') return response({ structuredContent: { objects: [], markdown: [] } });
      if (payload.name === 'map_checkpoint') return response({ structuredContent: { revision: 3 } });
      return response({ structuredContent: { ok: true } });
    }
    return response({ code: 'NOT_FOUND', message: 'not found' }, 404);
  };
  return { fetchImpl, calls };
}

export async function runSelfTest() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
  check('fixed-mcp-tool-list', JSON.stringify(MCP_TOOL_NAMES) === JSON.stringify([
    'map_get_context', 'map_list_human_updates', 'map_ack_human_updates', 'map_next_candidates', 'map_apply_commands', 'map_validate', 'map_checkpoint',
  ]));
  check('mcp-tool-schemas', mcpToolDefinitions().length === 7 && mcpToolDefinitions().every((tool) => MCP_TOOL_NAMES.includes(tool.name)));

  const { fetchImpl, calls } = fakeFetchFactory();
  const client = new LocalBridgeClient({ baseUrl: 'http://127.0.0.1:43127', projectId: 'project:self-test', sessionId: 'session:self-test', fetchImpl });
  const context = await client.mapGetContext({ query: 'self-test' });
  check('bridge-context', context?.summary === 'self-test context');
  await client.mapValidate();
  await client.mapCheckpoint({ reason: 'self-test' });
  check('bridge-mcp-transport', calls.some((call) => call.url.endsWith('/api/v1/mcp')));
  let ackRejected = false;
  try { await client.mapAckHumanUpdates({ ids: ['ann:test'], summary: '没有引用' }); } catch (error) { ackRejected = error.code === 'ACK_MISSING_ID'; }
  check('ack-requires-explicit-id', ackRejected);

  const server = new MapMcpServer({ client });
  const listed = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  check('stdio-tools-list', listed?.result?.tools?.length === 7);
  const called = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'map_get_context', arguments: { query: 'self-test' } } });
  check('stdio-tool-call', called?.result?.isError === false);

  const bytes = Buffer.from('portable-node-self-test');
  const digest = createHash('sha256').update(bytes).digest('hex');
  check('portable-node-sha256', verifyPortableNodeArchive(bytes, digest).ok);
  check('portable-node-bad-sha256', verifyPortableNodeArchive(bytes, '0'.repeat(64)).ok === false);
  return { ok: checks.every((item) => item.ok), checks };
}

