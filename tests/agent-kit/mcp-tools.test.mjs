import test from 'node:test';
import assert from 'node:assert/strict';
import { MapMcpServer, mcpToolDefinitions } from '../../agent-kit/lib/mcp-tools.mjs';

test('MCP stdio adapter exposes the 5 agent tools and never writes files', async () => {
  const calls = [];
  const client = {
    async mcp(name, args) { calls.push([name, args]); return name === 'map_validate' ? { ok: true } : {}; },
    async mapGetContext(args) { calls.push(['context', args]); return { summary: 'ok' }; },
    async mapListHumanUpdates(args) { calls.push(['list', args]); return { updates: [] }; },
    async mapAckHumanUpdates(args) { calls.push(['ack', args]); return { revision: 1 }; },
    async mapNextCandidates(args) { calls.push(['next', args]); return { objects: [] }; },
    async mapApplyCommands(args) { calls.push(['apply', args]); return { revision: 1 }; },
    async mapValidate(args) { calls.push(['validate', args]); return { ok: true }; },
    async mapCheckpoint(args) { calls.push(['checkpoint', args]); return { revision: 1 }; },
    async mapPlanConsolidation(args) { calls.push(['consolidation', args]); return { suggestions: [] }; },
  };
  const server = new MapMcpServer({ client });
  const list = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(list.result.tools.length, 5);
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ['map_look', 'map_read', 'map_write', 'analysis_run', 'map_manage']);
  const result = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'map_manage', arguments: { action: 'validate' } } });
  assert.equal(result.result.isError, false);
  assert.equal(calls[0][0], 'map_manage');
  assert.equal(calls.length, 1);
  assert.equal(mcpToolDefinitions().every((tool) => tool.inputSchema), true);
});

test('map_look schema publishes the retrieval parameters', async () => {
  const server = new MapMcpServer({ client: { mcp: async () => ({}) } });
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tool = response.result.tools.find((entry) => entry.name === 'map_look');
  assert.ok(tool.inputSchema.properties.query);
  assert.ok(tool.inputSchema.properties.nodeId);
  assert.ok(tool.inputSchema.properties.limit);
});
