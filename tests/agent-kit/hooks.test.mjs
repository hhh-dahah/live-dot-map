import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { contextText, runSessionStart, runStop, runUserPromptSubmit } from '../../agent-kit/lib/hooks.mjs';
import { HOOK_LINE_MAX_BYTES, agentReadPath, formatChangeLine, formatPendingLine, safeAgentName } from '../../agent-kit/lib/hook-notice.mjs';

const TEST_ROOT = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');
await mkdir(TEST_ROOT, { recursive: true });
const exists = (path) => access(path).then(() => true).catch(() => false);

function fakeClient({ updates = [], fail = false, actor = 'agent:codex', collaboration } = {}) {
  const calls = [];
  return {
    projectId: 'project:test', sessionId: 'session:test', actor, calls,
    async health() { calls.push(['health']); if (fail) throw Object.assign(new Error('offline'), { code: 'BRIDGE_UNAVAILABLE' }); return { ok: true }; },
    async snapshot() { calls.push(['snapshot']); return { revision: 3, document: { ui: collaboration ? { collaboration } : {} } }; },
    async mapListHumanUpdates() { calls.push(['list']); return { updates }; },
    async mapGetContext(args) { calls.push(['context', args]); return { summary: '主路线推进中' }; },
    async mapApplyCommands(args) { calls.push(['commands', args]); return { revision: 4 }; },
    async mapValidate() { calls.push(['validate']); return { ok: true }; },
  };
}

function baseMap() {
  return { version: 2, revision: 3, mapId: 'project:test', name: '测试地图', routes: [], nodes: [], edges: [], anns: [] };
}

async function project(prefix, map, { legacy, agents = {} } = {}) {
  const root = await mkdtemp(join(TEST_ROOT, prefix));
  await mkdir(join(root, '.live-dot-map'), { recursive: true });
  await writeFile(join(root, '.live-dot-map', 'map.json'), `${JSON.stringify(map, null, 2)}\n`);
  if (legacy) await writeFile(join(root, '.live-dot-map', 'agent-read.json'), `${JSON.stringify({ version: 1, updatedAt: legacy })}\n`);
  for (const [agent, updatedAt] of Object.entries(agents)) {
    const path = agentReadPath(root, agent);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, `${JSON.stringify({ version: 1, updatedAt })}\n`);
  }
  return root;
}

const readWatermark = async (root, agent) => JSON.parse(await readFile(agentReadPath(root, agent), 'utf8')).updatedAt;

function assertOneLine(output) {
  assert.equal(output.includes('\n'), false, `应只有一行：${output}`);
  assert.ok(Buffer.byteLength(output, 'utf8') <= HOOK_LINE_MAX_BYTES, `超过 ${HOOK_LINE_MAX_BYTES} 字节：${Buffer.byteLength(output, 'utf8')}`);
}

test('SessionStart reports changes in one line, delivers new annotations and migrates the legacy watermark', async () => {
  const now = new Date('2026-08-15T10:00:00.000Z');
  const map = baseMap();
  map.nodes = [{ id: 'n3', name: '新问题', updatedAt: '2026-08-15T09:59:00.000Z', updatedBy: 'agent:claude' }];
  map.edges = [{ id: 'e5', name: '方案5', status: 'pending', updatedAt: '2026-08-15T09:59:30.000Z', updatedBy: 'human' }];
  const root = await project('livedot-hooks-', map, { legacy: '2026-08-15T09:58:00.000Z' });
  const client = fakeClient({ updates: [{ id: 'ann:human1', attention: 'new', text: '请先看这个' }] });
  let output = '';
  const result = await runSessionStart({ client, write: (value) => { output += value; }, now, projectRoot: root });
  assert.equal(result.ok, true);
  assertOneLine(output);
  assert.equal(output, '[活点地图] 3处新变化：ann:human1(human)、e5(human)、n3(claude)；用 livedot look 查看');
  assert.doesNotMatch(output, /map\.json|MCP 工具|map_list_human_updates/);
  // 交付协议保留：new 标注 deliver，不 ack。
  const writes = client.calls.filter(([name]) => name === 'commands');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].commands[0].op, 'deliver_annotations');
  assert.deepEqual(writes[0][1].commands[0].ids, ['ann:human1']);
  // 水位写到按 Agent 分开的文件；旧文件不再被改写。
  assert.equal(await readWatermark(root, 'codex'), now.toISOString());
  const legacy = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-read.json'), 'utf8'));
  assert.equal(legacy.updatedAt, '2026-08-15T09:58:00.000Z');
});

test('SessionStart stays silent when nothing changed since the watermark', async () => {
  const map = baseMap();
  map.nodes = [{ id: 'n1', name: '开始', updatedAt: '2026-08-15T08:00:00.000Z', updatedBy: 'human' }];
  const root = await project('livedot-hooks-silent-', map, { agents: { codex: '2026-08-15T09:00:00.000Z' } });
  let output = 'none';
  const result = await runSessionStart({ client: fakeClient(), write: (value) => { output = value; }, now: new Date('2026-08-15T10:00:00.000Z'), projectRoot: root });
  assert.equal(result.ok, true);
  assert.equal(output, '');
});

test('first run without any watermark is silent and persists an initial per-agent watermark', async () => {
  const now = new Date('2026-08-15T10:00:00.000Z');
  const map = baseMap();
  map.nodes = [{ id: 'n1', name: '开始', updatedAt: '2026-08-15T08:00:00.000Z', updatedBy: 'human' }];
  const root = await project('livedot-hooks-first-', map);
  let output = 'none';
  await runUserPromptSubmit({ client: fakeClient(), write: (value) => { output = value; }, now, projectRoot: root });
  assert.equal(output, '');
  assert.equal(await readWatermark(root, 'codex'), now.toISOString());
  assert.equal(await exists(join(root, '.live-dot-map', 'agent-read.json')), false);
});

test('UserPromptSubmit skips the Agent own writes but reports other agents and keeps watermarks independent', async () => {
  const map = baseMap();
  map.nodes = [{ id: 'n-codex', name: 'codex 写回', updatedAt: '2026-08-15T09:59:00.000Z', updatedBy: 'agent:codex' }];
  const root = await project('livedot-user-prompt-own-', map, { agents: { codex: '2026-08-15T09:00:00.000Z', claude: '2026-08-15T09:00:00.000Z' } });
  const now = new Date('2026-08-15T10:00:00.000Z');

  let codexOut = 'none';
  await runUserPromptSubmit({ client: fakeClient({ actor: 'agent:codex' }), write: (value) => { codexOut = value; }, now, projectRoot: root });
  assert.equal(codexOut, '', '自己的写入不应推给自己');
  assert.equal(await readWatermark(root, 'codex'), '2026-08-15T09:00:00.000Z', '无输出时不推进水位');

  let claudeOut = '';
  await runUserPromptSubmit({ client: fakeClient({ actor: 'agent:claude' }), write: (value) => { claudeOut = value; }, now, projectRoot: root });
  assertOneLine(claudeOut);
  assert.match(claudeOut, /n-codex\(codex\)/);
  assert.equal(await readWatermark(root, 'claude'), now.toISOString());
  assert.equal(await readWatermark(root, 'codex'), '2026-08-15T09:00:00.000Z', 'claude 的水位不影响 codex');
});

test('UserPromptSubmit stays silent when nothing changed since the watermark', async () => {
  const map = baseMap();
  map.nodes = [{ id: 'n1', name: '开始', updatedAt: '2026-08-15T08:00:00.000Z', updatedBy: 'human' }];
  const root = await project('livedot-user-prompt-silent-', map, { agents: { codex: '2026-08-15T09:00:00.000Z' } });
  let output = 'none';
  const result = await runUserPromptSubmit({ client: fakeClient(), write: (value) => { output = value; }, now: new Date('2026-08-15T10:00:00.000Z'), projectRoot: root });
  assert.equal(result.ok, true);
  assert.equal(output, '');
});

test('UserPromptSubmit lists at most three ids and stays within 160 bytes for many changes', async () => {
  const map = baseMap();
  map.nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n-很长的中文节点编号-${index}`, name: '节点', updatedAt: '2026-08-15T09:59:00.000Z', updatedBy: 'agent:claude' }));
  map.anns = [{ id: 'ann:human1', source: 'human', attention: 'new', text: '请看', updatedAt: '2026-08-15T09:59:10.000Z', updatedBy: 'human' }];
  const root = await project('livedot-user-prompt-many-', map, { agents: { codex: '2026-08-15T09:00:00.000Z' } });
  let output = '';
  await runUserPromptSubmit({ client: fakeClient(), write: (value) => { output += value; }, now: new Date('2026-08-15T10:00:00.000Z'), projectRoot: root });
  assertOneLine(output);
  assert.match(output, /^\[活点地图\] 13处新变化：ann:human1\(human\)/);
  assert.match(output, /等；用 livedot look 查看$/);
});

test('hook failures do not claim success', async () => {
  const client = fakeClient({ fail: true });
  let output = '';
  const result = await runUserPromptSubmit({ client, prompt: '下一步', write: (value) => { output += value; } });
  assert.equal(result.ok, false);
  assert.match(output, /未完成/);
  assert.doesNotMatch(output, /已保存|协作正常/);
  assertOneLine(output);
});

test('Stop never blocks and emits one short line when human annotations are pending', async () => {
  const client = fakeClient({ updates: [{ id: 'ann:human2', attention: 'delivered', text: '待确认' }] });
  let output = '';
  const result = await runStop({ client, write: (value) => { output += value; } });
  assert.equal(result.allowStop, true);
  assert.equal(output, '[活点地图] 1 条人类标注待确认：ann:human2');
  assertOneLine(output);
  assert.doesNotMatch(output, /红色|大尝试/);
  const setUi = client.calls.filter(([name, args]) => name === 'commands' && args.commands?.[0]?.op === 'set_ui');
  assert.equal(setUi.length, 1);
  assert.equal(setUi[0][1].commands[0].patch.collaboration.status, 'incomplete');
  assert.equal(client.calls.some(([name]) => name === 'validate'), false);
});

test('Stop is silent and does not rewrite the canvas when nothing is pending', async () => {
  const client = fakeClient({ updates: [] });
  let output = 'none';
  const result = await runStop({ client, write: (value) => { output = value; } });
  assert.equal(result.ok, true);
  assert.equal(result.allowStop, true);
  assert.equal(output, '');
  assert.equal(client.calls.filter(([name]) => name === 'commands').length, 0);
});

test('Stop does not rewrite an unchanged incomplete status but clears it once closed', async () => {
  const stillPending = fakeClient({ updates: [{ id: 'a1', attention: 'delivered' }], collaboration: { status: 'incomplete' } });
  await runStop({ client: stillPending });
  assert.equal(stillPending.calls.filter(([name]) => name === 'commands').length, 0);
  const closed = fakeClient({ updates: [], collaboration: { status: 'incomplete' } });
  await runStop({ client: closed });
  const writes = closed.calls.filter(([name]) => name === 'commands');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].commands[0].patch.collaboration.status, 'closed');
});

test('line formatters respect the byte budget and file-name safety', () => {
  const long = Array.from({ length: 5 }, (_, index) => ({ id: `${'超长标识'.repeat(20)}${index}`, by: 'human' }));
  const line = formatChangeLine(long);
  assertOneLine(line);
  assert.match(line, /^\[活点地图\] 5处新变化/);
  assertOneLine(formatPendingLine(long.map((entry) => entry.id)));
  assertOneLine(contextText({ big: 'x'.repeat(5000) }, [{ id: 'a1' }]));
  assert.equal(contextText({ big: 'x' }, []), '');
  assert.equal(safeAgentName('agent:../evil\\name'), '_evil_name');
  assert.equal(safeAgentName(''), 'generic');
});
