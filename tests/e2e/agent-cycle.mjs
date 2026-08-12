import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUNTIME = join(ROOT, 'livedot.mjs');
const TEMPLATE = join(ROOT, 'agent-kit', 'map.template.json');

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
  const results = [];
  for (const [name, args] of calls) {
    const response = await request('tools/call', { name, arguments: args });
    assert.equal(response.error, undefined, `${agent}/${name}: ${JSON.stringify(response.error)}`);
    results.push(response.result.structuredContent);
  }
  child.stdin.end(); child.kill();
  return results;
}

const results = [];
for (const agent of ['codex', 'claude', 'kimi', 'codebuddy']) {
  const project = await mkdtemp(join(tmpdir(), `livedot-agent-${agent}-`));
  try {
    const data = join(project, '.live-dot-map'); await mkdir(data, { recursive: true });
    const mapPath = join(data, 'map.json'); await cp(TEMPLATE, mapPath);
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    map.anns.push({
      id: 'a-human-1', target: { kind: 'canvas' }, text: '先验证真实用户入口', source: 'human', priority: 'high', attention: 'new', acknowledgements: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'human', updatedRevision: 0,
    });
    await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    const started = await runHook(project, agent, 'session-start');
    assert.deepEqual(started.deliveredIds, ['a-human-1']);
    const [acked, applied] = await mcp(project, agent, [
      ['map_ack_human_updates', { ids: ['a-human-1'], summary: '已读取 a-human-1：先验证真实用户入口' }],
      ['map_apply_commands', { commands: [{ op: 'create', collection: 'nodes', value: { id: `n-${agent}`, num: '02', name: `${agent} 写回`, type: '结果', route: 'r1', x: 240, y: 0, md: `.live-dot-map/nodes/n-${agent}.md` } }] }],
    ]);
    assert.ok(acked.revision >= 2);
    assert.ok(applied.revision > acked.revision);
    const persisted = JSON.parse(await readFile(mapPath, 'utf8'));
    assert.equal(persisted.anns[0].attention, 'acknowledged');
    assert.equal(persisted.nodes.some((node) => node.id === `n-${agent}` && node.updatedBy === `agent:${agent}`), true);
    const stopped = await runHook(project, agent, 'stop');
    assert.equal(stopped.collaborationClosed, true);
    results.push({ agent, delivered: true, acknowledged: true, wroteBack: true, stopClosed: true, revision: persisted.revision });
  } finally { await rm(project, { recursive: true, force: true }); }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
