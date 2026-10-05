import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MapMcpServer } from '../../agent-kit/lib/mcp-tools.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const RUNTIME = join(ROOT, 'livedot.mjs');
const TEMPLATE = join(ROOT, 'agent-kit', 'map.template.json');
const TEST_ROOT = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');
const MAX_BYTES = 160;
const OLD = '2020-01-01T00:00:00.000Z';
const exists = (path) => access(path).then(() => true).catch(() => false);

async function setup(t) {
  await mkdir(TEST_ROOT, { recursive: true });
  const project = await mkdtemp(join(TEST_ROOT, 'livedot-hook-hygiene-'));
  const sandbox = await mkdtemp(join(TEST_ROOT, 'livedot-hook-hygiene-env-'));
  t.after(async () => {
    await rm(project, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    await rm(sandbox, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const env = {
    ...process.env,
    LIVEDOT_MCP_LOCAL: '1',
    LIVEDOT_RUNTIME_STATE_DIR: sandbox,
    LIVEDOT_CURRENT_PROJECT_FILE: join(sandbox, 'current-project.json'),
    LIVEDOT_RECENT_PROJECTS_FILE: join(sandbox, 'recent-projects.json'),
    LIVEDOT_LOG_DIR: join(sandbox, 'logs'),
  };
  const data = join(project, '.live-dot-map');
  await mkdir(join(data, 'maps', 'default'), { recursive: true });
  const mapPath = join(data, 'maps', 'default', 'map.json');
  await cp(TEMPLATE, mapPath);
  const map = JSON.parse(await readFile(mapPath, 'utf8'));
  map.mapDir = '.live-dot-map/maps/default';
  map.bundleLayoutVersion = 1;
  for (const collection of ['nodes', 'edges', 'routes', 'anns']) {
    for (const item of map[collection] || []) { item.updatedAt = OLD; item.createdAt = OLD; }
  }
  for (const node of map.nodes) node.md = `${map.mapDir}/nodes/${node.id}/index.md`;
  const recent = new Date(Date.now() - 60_000).toISOString();
  map.nodes.push({ ...map.nodes[0], id: 'n40', num: '40', name: '人类改的节点', md: `${map.mapDir}/nodes/n40/index.md`, createdAt: recent, updatedAt: recent, updatedBy: 'human' });
  map.anns.push({
    id: 'a-human-1', target: { kind: 'canvas' }, text: '先验证真实用户入口', source: 'human', priority: 'high', attention: 'new', acknowledgements: [],
    createdAt: recent, updatedAt: recent, updatedBy: 'human', updatedRevision: 0,
  });
  await writeFile(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  const legacy = new Date(Date.now() - 120_000).toISOString();
  await writeFile(join(data, 'agent-read.json'), `${JSON.stringify({ version: 1, updatedAt: legacy })}\n`);
  return { project, env, mapPath, legacy };
}

function hook(ctx, agent, event) {
  return new Promise((resolveRun, reject) => {
    const child = execFile(process.execPath, [RUNTIME, 'hook', '--event', event, '--project', ctx.project, '--agent', agent], { env: ctx.env, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${agent}/${event}: ${stderr || error.message}`));
      else resolveRun(stdout);
    });
    child.stdin.end('{"stop_hook_active":false}');
  });
}

function mcpCall(ctx, agent, name, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [RUNTIME, 'mcp', '--project', ctx.project, '--agent', agent], { env: ctx.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', () => {
      const line = stdout.trim().split(/\r?\n/).map((entry) => JSON.parse(entry)).find((entry) => entry.id === 1);
      resolveRun(line);
    });
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })}\n`);
  });
}

function contextLine(stdout, eventName) {
  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, stdout);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.hookSpecificOutput.hookEventName, eventName);
  const text = parsed.hookSpecificOutput.additionalContext;
  assert.equal(text.includes('\n'), false, `additionalContext 应恰好 1 行：${text}`);
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_BYTES, `additionalContext ${Buffer.byteLength(text, 'utf8')}B > ${MAX_BYTES}B`);
  assert.doesNotMatch(text, /map\.json|MCP 工具|map_list_human_updates|map_get_context/);
  return text;
}

const revisionOf = async (ctx) => JSON.parse(await readFile(ctx.mapPath, 'utf8')).revision;
const watermarkOf = async (ctx, agent) => JSON.parse(await readFile(join(ctx.project, '.live-dot-map', '.bridge', 'agent-read', `${agent}.json`), 'utf8')).updatedAt;

test('livedot hook: per-agent watermarks, no self echo, one short line, Stop never blocks', async (t) => {
  const ctx = await setup(t);

  const started = contextLine(await hook(ctx, 'codex', 'session-start'), 'SessionStart');
  assert.match(started, /^\[活点地图\] 2处新变化：a-human-1\(human\)、n40\(human\)；用 livedot look 查看$/);
  assert.ok(await exists(join(ctx.project, '.live-dot-map', '.bridge', 'agent-read', 'codex.json')));
  const legacyAfter = JSON.parse(await readFile(join(ctx.project, '.live-dot-map', 'agent-read.json'), 'utf8')).updatedAt;
  assert.equal(legacyAfter, ctx.legacy, '旧的项目级水位不再被写');

  assert.equal(await hook(ctx, 'codex', 'user-prompt'), '', '无变化时 stdout 0 字节');

  const write = await mcpCall(ctx, 'codex', 'map_apply_commands', { commands: [{ op: 'create', collection: 'nodes', value: { id: 'n-codex', num: '02', name: 'codex 写回', kind: 'goal', type: '目的', route: 'r1', x: 240, y: 0, md: '.live-dot-map/maps/default/nodes/n-codex/index.md' } }] });
  assert.equal(write.error, undefined, JSON.stringify(write.error));
  assert.equal(write.result.structuredContent, undefined, 'MCP 结果不带 structuredContent');
  assert.equal(write.result.content.length, 1);
  const text = write.result.content[0].text;
  assert.equal(text, JSON.stringify(JSON.parse(text)), 'MCP 文本为紧凑 JSON');

  const codexMark = await watermarkOf(ctx, 'codex');
  assert.equal(await hook(ctx, 'codex', 'user-prompt'), '', 'Agent 自己刚写入的对象不推给自己');

  const seenByClaude = contextLine(await hook(ctx, 'claude', 'user-prompt'), 'UserPromptSubmit');
  assert.match(seenByClaude, /a-human-1\(human\)/);
  assert.match(seenByClaude, /n-codex\(codex\)/, '其他 Agent 的写入照推');
  assert.ok(seenByClaude.indexOf('a-human-1') < seenByClaude.indexOf('n-codex'), '人类标注排最前');
  assert.equal(await hook(ctx, 'claude', 'user-prompt'), '', 'claude 读过后不再重复');
  assert.equal(await watermarkOf(ctx, 'codex'), codexMark, 'claude 的读取不推进 codex 水位');

  const beforeStop = await revisionOf(ctx);
  const stopped = await hook(ctx, 'codex', 'stop');
  const stopLines = stopped.trim().split(/\r?\n/);
  assert.equal(stopLines.length, 1);
  const stopOutput = JSON.parse(stopLines[0]);
  assert.deepEqual(Object.keys(stopOutput), ['systemMessage']);
  assert.equal(stopOutput.systemMessage, '[活点地图] 1 条人类标注待确认：a-human-1');
  assert.ok(Buffer.byteLength(stopOutput.systemMessage, 'utf8') <= MAX_BYTES);
  assert.equal(await revisionOf(ctx), beforeStop + 1, '状态从无到 incomplete 写一次');
  await hook(ctx, 'codex', 'stop');
  assert.equal(await revisionOf(ctx), beforeStop + 1, '状态未变化时 Stop 不产生修订');

  const ack = await mcpCall(ctx, 'codex', 'map_ack_human_updates', { ids: ['a-human-1'], summary: '已读取 a-human-1：先验证真实用户入口' });
  assert.equal(ack.error, undefined, JSON.stringify(ack.error));
  const afterAck = await revisionOf(ctx);
  assert.equal(await hook(ctx, 'codex', 'stop'), '', '无待确认时 Stop stdout 为空');
  assert.equal(await revisionOf(ctx), afterAck + 1, 'incomplete 恢复为 closed 写一次');
  assert.equal(await hook(ctx, 'codex', 'stop'), '');
  assert.equal(await revisionOf(ctx), afterAck + 1);
  const persisted = JSON.parse(await readFile(ctx.mapPath, 'utf8'));
  assert.equal(persisted.ui.collaboration.status, 'closed');
});

test('agent-kit MCP adapter returns a single compact text block', async () => {
  const server = new MapMcpServer({ client: { mcp: async () => ({ ok: true, nested: { list: [1, 2] } }) } });
  const ok = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'map_validate', arguments: {} } });
  assert.equal(ok.result.structuredContent, undefined);
  assert.equal(ok.result.content[0].text, '{"ok":true,"nested":{"list":[1,2]}}');
  const failing = new MapMcpServer({ client: { mcp: async () => { throw Object.assign(new Error('坏了'), { code: 'BOOM' }); } } });
  const error = await failing.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'map_validate', arguments: {} } });
  assert.equal(error.result.isError, true);
  assert.equal(error.result.structuredContent, undefined);
  assert.equal(error.result.content[0].text, '{"ok":false,"code":"BOOM","message":"坏了"}');
});
