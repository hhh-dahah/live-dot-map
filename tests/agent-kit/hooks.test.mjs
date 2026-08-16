import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runSessionStart, runStop, runUserPromptSubmit } from '../../agent-kit/lib/hooks.mjs';

const TEST_ROOT = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');

function fakeClient({ updates = [], validate = { ok: true }, fail = false } = {}) {
  const calls = [];
  return {
    projectId: 'project:test', sessionId: 'session:test', actor: 'agent:codex', calls,
    async health() { calls.push(['health']); if (fail) throw Object.assign(new Error('offline'), { code: 'BRIDGE_UNAVAILABLE' }); return { ok: true }; },
    async snapshot() { calls.push(['snapshot']); return { revision: 3 }; },
    async mapListHumanUpdates() { calls.push(['list']); return { updates }; },
    async mapGetContext(args) { calls.push(['context', args]); return { summary: '主路线推进中' }; },
    async mapApplyCommands(args) { calls.push(['commands', args]); return { revision: 4 }; },
    async mapValidate() { calls.push(['validate']); return validate; },
  };
}

function baseMap() {
  return { version: 2, revision: 3, mapId: 'project:test', name: '测试地图', routes: [], nodes: [], edges: [], anns: [] };
}

test('SessionStart reports incremental changes and delivers new annotations', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-hooks-'));
  await mkdir(join(root, '.live-dot-map'), { recursive: true });
  const now = new Date('2026-08-15T10:00:00.000Z');
  const map = baseMap();
  map.nodes = [{ id: 'n3', name: '新问题', updatedAt: '2026-08-15T09:59:00.000Z' }];
  map.edges = [{ id: 'e5', name: '方案5', status: 'pending', updatedAt: '2026-08-15T09:59:30.000Z' }];
  await writeFile(join(root, '.live-dot-map', 'map.json'), `${JSON.stringify(map, null, 2)}\n`);
  await writeFile(join(root, '.live-dot-map', 'agent-read.json'), `${JSON.stringify({ version: 1, updatedAt: '2026-08-15T09:58:00.000Z' }, null, 2)}\n`);
  const client = fakeClient({ updates: [{ id: 'ann:human1', attention: 'new', text: '请先看这个' }] });
  let output = '';
  const result = await runSessionStart({ client, write: (value) => { output += value; }, now, projectRoot: root });
  assert.equal(result.ok, true);
  assert.match(output, /n3/);
  assert.match(output, /新问题/);
  assert.match(output, /e5/);
  // 交付协议保留：new 标注 deliver，不 ack。
  const writes = client.calls.filter(([name]) => name === 'commands');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].commands[0].op, 'deliver_annotations');
  assert.equal(writes[0][1].commands[0].ids[0], 'ann:human1');
  assert.equal(writes.some(([, args]) => args.commands?.[0]?.op === 'ack_annotations'), false);
  // 水位推进到 now。
  const watermark = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-read.json'), 'utf8'));
  assert.equal(watermark.updatedAt, now.toISOString());
});

test('SessionStart stays silent when nothing changed since the watermark', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-hooks-silent-'));
  await mkdir(join(root, '.live-dot-map'), { recursive: true });
  const now = new Date('2026-08-15T10:00:00.000Z');
  const map = baseMap();
  map.nodes = [{ id: 'n1', name: '开始', updatedAt: '2026-08-15T08:00:00.000Z' }];
  await writeFile(join(root, '.live-dot-map', 'map.json'), `${JSON.stringify(map, null, 2)}\n`);
  // 水位晚于所有对象：无事不打扰。
  await writeFile(join(root, '.live-dot-map', 'agent-read.json'), `${JSON.stringify({ version: 1, updatedAt: '2026-08-15T09:00:00.000Z' }, null, 2)}\n`);
  const client = fakeClient({ updates: [] });
  let output = 'none';
  const result = await runSessionStart({ client, write: (value) => { output = value; }, now, projectRoot: root });
  assert.equal(result.ok, true);
  assert.equal(output, '');
});

test('hook failures do not claim success', async () => {
  const client = fakeClient({ fail: true });
  let output = '';
  const result = await runUserPromptSubmit({ client, prompt: '下一步', write: (value) => { output += value; } });
  assert.equal(result.ok, false);
  assert.match(output, /未完成/);
  assert.doesNotMatch(output, /已保存|协作正常/);
});

test('Stop allows a second failed attempt but keeps a red remediation message', async () => {
  const client = fakeClient({ updates: [{ id: 'ann:human2', attention: 'delivered', text: '待确认' }] });
  let output = '';
  const result = await runStop({ client, attempt: 2, write: (value) => { output += value; } });
  assert.equal(result.ok, false);
  assert.equal(result.allowStop, true);
  assert.match(output, /红色/);
  assert.match(output, /ann:human2/);
  assert.ok(client.calls.some(([name, args]) => name === 'commands' && args.commands?.[0]?.op === 'set_ui'));
});

test('Stop first attempt blocks when an Agent scheme lacks evidence Markdown', async () => {
  const client = fakeClient({ validate: { ok: true, attemptIssues: [{ edgeId: 'e1', missing: ['下一步'] }] } });
  let output = '';
  const result = await runStop({ client, attempt: 1, write: (value) => { output += value; } });
  assert.equal(result.ok, false);
  assert.equal(result.allowStop, false);
  assert.match(output, /大尝试证据未闭环/);
  assert.equal(client.calls.filter(([name]) => name === 'commands').length, 0);
});
