import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUNTIME = join(ROOT, 'livedot.mjs');
const TEMPLATE = join(ROOT, 'agent-kit', 'map.template.json');
const TEST_ROOT = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');
await mkdir(TEST_ROOT, { recursive: true });

function runHook(project, agent, event, input = '') {
  return new Promise((resolveRun, reject) => {
    const child = execFile(process.execPath, [RUNTIME, 'hook', '--event', event, '--project', project, '--agent', agent], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${agent}/${event}: ${stderr || error.message}`));
      else resolveRun(JSON.parse(stdout));
    });
    child.stdin.end(input);
  });
}

async function mcp(project, agent, calls) {
  const child = spawn(process.execPath, [RUNTIME, 'mcp', '--project', project, '--agent', agent], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  lines.on('line', (line) => { const value = JSON.parse(line); pending.get(value.id)?.(value); });
  let id = 0;
  const request = (method, params = {}) => new Promise((resolveRequest) => {
    const next = ++id; pending.set(next, resolveRequest);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: next, method, params })}\n`);
  });
  await request('initialize', {});
  const listed = await request('tools/list');
  const toolNames = listed.result?.tools?.map((tool) => tool.name) || [];
  assert.equal(toolNames.some((name) => /purge/i.test(String(name))), false, `${agent}: purge must not be exposed as an Agent tool`);
  assert.ok(toolNames.includes('map_archive_bundle_file') && toolNames.includes('map_restore_bundle_file'), `${agent}: bundle archive/restore tools are missing`);
  const results = [];
  for (const [name, args, expectedError] of calls) {
    const response = await request('tools/call', { name, arguments: args });
    if (expectedError) {
      assert.equal(response.error?.data?.code, expectedError, `${agent}/${name}: ${JSON.stringify(response)}`);
      results.push(response.error);
    } else {
      assert.equal(response.error, undefined, `${agent}/${name}: ${JSON.stringify(response.error)}`);
      results.push(response.result.structuredContent);
    }
  }
  child.stdin.end(); child.kill();
  return results;
}

const results = [];
for (const agent of ['codex', 'claude', 'kimi', 'codebuddy']) {
  const project = await mkdtemp(join(TEST_ROOT, `livedot-agent-${agent}-`));
  try {
    const data = join(project, '.live-dot-map'); await mkdir(join(data, 'maps', 'default'), { recursive: true });
    // v2 布局：地图文件在 .live-dot-map/maps/<地图id>/ 下，默认地图为 default。
    const mapPath = join(data, 'maps', 'default', 'map.json'); await cp(TEMPLATE, mapPath);
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    map.mapDir = '.live-dot-map/maps/default';
    map.bundleLayoutVersion = 1;
    for (const item of [...(map.nodes || []), ...(map.edges || [])]) {
      const collection = map.nodes?.includes(item) ? 'nodes' : 'routes';
      item.md = `${map.mapDir}/${collection}/${item.id}/index.md`;
    }
    map.anns.push({
      id: 'a-human-1', target: { kind: 'canvas' }, text: '先验证真实用户入口', source: 'human', priority: 'high', attention: 'new', acknowledgements: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'human', updatedRevision: 0,
    });
    await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    const started = await runHook(project, agent, 'session-start');
    assert.equal(started.hookSpecificOutput?.hookEventName, 'SessionStart');
    const deliveredMap = JSON.parse(await readFile(mapPath, 'utf8'));
    assert.equal(deliveredMap.anns[0].attention, 'delivered');
    const [acked, applied, archived, restored, forgedActor] = await mcp(project, agent, [
      ['map_ack_human_updates', { ids: ['a-human-1'], summary: '已读取 a-human-1：先验证真实用户入口' }],
      ['map_apply_commands', { commands: [{ op: 'create', collection: 'nodes', value: { id: `n-${agent}`, num: '02', name: `${agent} 写回`, kind: 'goal', type: '目的', route: 'r1', x: 240, y: 0, md: `.live-dot-map/maps/default/nodes/n-${agent}/index.md` } }] }],
      ['map_apply_commands', { commands: [{ op: 'archive', collection: 'nodes', id: `n-${agent}`, archiveReason: 'Agent 归档验收' }] }],
      ['map_apply_commands', { commands: [{ op: 'restore', collection: 'nodes', id: `n-${agent}` }] }],
      ['map_apply_commands', { commands: [{ op: 'update', collection: 'nodes', id: `n-${agent}`, patch: { shelved: true } }] }, 'HUMAN_APPROVAL_REQUIRED'],
    ]);
    assert.ok(acked.revision >= 2);
    assert.ok(applied.revision > acked.revision);
    assert.equal(archived.document.nodes.find((node) => node.id === `n-${agent}`)?.archived, true);
    assert.equal(restored.document.nodes.find((node) => node.id === `n-${agent}`)?.archived, undefined);
    assert.equal(forgedActor.data.code, 'HUMAN_APPROVAL_REQUIRED');
    const persisted = JSON.parse(await readFile(mapPath, 'utf8'));
    assert.equal(persisted.anns[0].attention, 'acknowledged');
    assert.equal(persisted.nodes.some((node) => node.id === `n-${agent}` && node.updatedBy === `agent:${agent}`), true);
    const stopped = await runHook(project, agent, 'stop');
    assert.equal(stopped.decision, undefined);
    assert.equal(stopped.systemMessage, '地图闭环完成。');
    results.push({ agent, delivered: true, acknowledged: true, wroteBack: true, stopClosed: true, revision: persisted.revision });
  } finally { await rm(project, { recursive: true, force: true }); }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
