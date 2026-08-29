import test from 'node:test';
import assert from 'node:assert/strict';
import { MapMcpServer, mcpToolDefinitions } from '../../agent-kit/lib/mcp-tools.mjs';

test('MCP stdio adapter exposes the fixed 24-tool contract and never writes files', async () => {
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
  assert.equal(list.result.tools.length, 25);
  assert.deepEqual(list.result.tools.map((tool) => tool.name), [
    'map_get_context', 'map_list_human_updates', 'map_ack_human_updates',
    'map_list', 'map_create', 'map_switch', 'map_rename',
    'map_next_candidates', 'map_apply_commands', 'map_validate', 'map_checkpoint', 'map_plan_consolidation',
    'map_read_markdown', 'map_write_markdown', 'map_append_markdown',
    'map_list_bundle_files', 'map_create_markdown', 'map_rename_bundle_file', 'map_archive_bundle_file', 'map_restore_bundle_file',
    'map_list_assets', 'map_import_asset', 'map_archive_asset', 'map_restore_asset', 'map_read_asset',
  ]);
  const result = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'map_validate', arguments: {} } });
  assert.equal(result.result.isError, false);
  assert.equal(calls[0][0], 'map_validate');
  assert.equal(calls.length, 1);
  assert.equal(mcpToolDefinitions().every((tool) => tool.inputSchema), true);
});

test('map_next_candidates schema publishes the unified retrieval parameters', async () => {
  const server = new MapMcpServer({ client: { mcp: async () => ({}) } });
  const response = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tool = response.result.tools.find((entry) => entry.name === 'map_next_candidates');
  assert.ok(tool.inputSchema.properties.query);
  assert.ok(tool.inputSchema.properties.currentNodeId);
  assert.ok(tool.inputSchema.properties.limit);
  assert.ok(tool.inputSchema.properties.includeHistory);
});
