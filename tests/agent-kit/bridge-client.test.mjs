import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeClientError, LocalBridgeClient, MCP_TOOL_NAMES, assertLoopbackUrl, projectIdForRoot } from '../../agent-kit/lib/bridge-client.mjs';

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value), body: null };
}

test('bridge client accepts loopback only', () => {
  assert.equal(assertLoopbackUrl('http://127.0.0.1:43127').hostname, '127.0.0.1');
  assert.throws(() => assertLoopbackUrl('https://example.com:43127'), (error) => error.code === 'NON_LOOPBACK_BRIDGE');
  assert.match(projectIdForRoot('C:/project'), /^project:[a-f0-9]{32}$/);
});

test('mcp calls use local bridge and fixed tool names', async () => {
  const calls = [];
  const client = new LocalBridgeClient({ baseUrl: 'http://localhost:43127', projectId: 'project:test', sessionId: 'session:test', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return response({ structuredContent: { objects: [], markdown: [] } });
  } });
  assert.deepEqual(MCP_TOOL_NAMES, ['map_get_context', 'map_list_human_updates', 'map_ack_human_updates', 'map_next_candidates', 'map_apply_commands', 'map_validate', 'map_checkpoint']);
  const result = await client.mapNextCandidates({ query: '路线' });
  assert.deepEqual(result, { objects: [], markdown: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /127\.0\.0\.1|localhost/);
  assert.equal(JSON.parse(calls[0].options.body).name, 'map_next_candidates');
});

test('ack requires every annotation id in summary before a write', async () => {
  let called = false;
  const client = new LocalBridgeClient({ baseUrl: 'http://127.0.0.1:43127', projectId: 'project:test', fetchImpl: async () => { called = true; return response({}); } });
  await assert.rejects(client.mapAckHumanUpdates({ ids: ['ann:one', 'ann:two'], summary: '只引用 ann:one' }), (error) => error instanceof BridgeClientError && error.code === 'ACK_MISSING_ID');
  assert.equal(called, false);
});

test('map_next_candidates normalizes the shared query/currentNodeId/limit/includeHistory contract', async () => {
  let payload;
  const client = new LocalBridgeClient({ baseUrl: 'http://127.0.0.1:43127', projectId: 'project:test', fetchImpl: async (url, options) => {
    payload = JSON.parse(options.body);
    return response({ structuredContent: { objects: [], markdown: [] } });
  } });
  await client.mapNextCandidates({ query: '阶段', currentNodeId: 'n1', limit: 99, includeHistory: true });
  assert.deepEqual(payload.arguments, { query: '阶段', currentNodeId: 'n1', limit: 12, includeHistory: true, projectId: 'project:test', sessionId: client.sessionId });
});
