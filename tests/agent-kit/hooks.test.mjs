import test from 'node:test';
import assert from 'node:assert/strict';
import { runSessionStart, runStop, runUserPromptSubmit } from '../../agent-kit/lib/hooks.mjs';

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

test('SessionStart delivers new annotations but never acknowledges them', async () => {
  const client = fakeClient({ updates: [{ id: 'ann:human1', attention: 'new', text: '请先看这个' }] });
  let output = '';
  const result = await runSessionStart({ client, write: (value) => { output += value; } });
  assert.equal(result.ok, true);
  assert.match(output, /ann:human1/);
  const writes = client.calls.filter(([name]) => name === 'commands');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].commands[0].op, 'deliver_annotations');
  assert.equal(writes[0][1].commands[0].ids[0], 'ann:human1');
  assert.equal(writes.some(([, args]) => args.commands?.[0]?.op === 'ack_annotations'), false);
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
