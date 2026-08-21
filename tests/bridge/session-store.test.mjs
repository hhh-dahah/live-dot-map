import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionStore } from '../../src/bridge/session-store.mjs';
import { runtimePaths } from '../../src/bridge/runtime-state.mjs';

async function fixture(test) {
  const root = await mkdtemp(join(tmpdir(), 'livedot-sessions-'));
  test.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('session store persists only hashes and restores a seven-day sliding session', async (test) => {
  const root = await fixture(test);
  let now = Date.parse('2026-08-20T00:00:00.000Z');
  const clock = () => new Date(now);
  const store = await SessionStore.open({ runtimeStateDir: root, clock, persistIntervalMs: 60_000 });
  const created = store.create({ projectHandle: 'ph_a' });
  await store.flush();
  const raw = await readFile(runtimePaths(root).sessions, 'utf8');
  assert.equal(raw.includes(created.sessionId), false);
  assert.equal(raw.includes(created.reconnectTicket), false);
  now += 6 * 24 * 60 * 60 * 1000;
  const touched = store.get(created.sessionId);
  assert.ok(touched);
  assert.equal(Date.parse(touched.expiresAt), now + 7 * 24 * 60 * 60 * 1000);
  await store.flush();
  const reopened = await SessionStore.open({ runtimeStateDir: root, clock });
  assert.ok(reopened.get(created.sessionId, { touch: false }));
});

test('reconnect rotates all secrets, rejects replay, and rate limits guesses', async (test) => {
  const root = await fixture(test);
  const store = await SessionStore.open({ runtimeStateDir: root });
  const first = store.create({ projectHandle: 'ph_a' });
  const next = store.reconnect({ reconnectTicket: first.reconnectTicket, projectHandle: 'ph_a' });
  assert.equal(store.get(first.sessionId, { touch: false }), null);
  assert.ok(store.get(next.sessionId, { touch: false }));
  assert.throws(() => store.reconnect({ reconnectTicket: first.reconnectTicket, projectHandle: 'ph_a' }), (error) => error?.code === 'INVALID_RECONNECT_TICKET');
  for (let index = 0; index < 3; index += 1) {
    assert.throws(() => store.reconnect({ reconnectTicket: `bad-${index}`, projectHandle: 'ph_a' }), (error) => error?.code === 'INVALID_RECONNECT_TICKET');
  }
  assert.throws(() => store.reconnect({ reconnectTicket: 'bad-final', projectHandle: 'ph_a' }), (error) => error?.code === 'RECONNECT_RATE_LIMITED');
});

test('session cap evicts least recently used and corrupt files fail closed', async (test) => {
  const root = await fixture(test);
  let now = 1_700_000_000_000;
  const store = await SessionStore.open({ runtimeStateDir: root, clock: () => new Date(now), maxSessions: 2 });
  const first = store.create({ projectHandle: 'ph_a' });
  now += 1;
  const second = store.create({ projectHandle: 'ph_b' });
  now += 1;
  store.create({ projectHandle: 'ph_c' });
  assert.equal(store.get(first.sessionId, { touch: false }), null);
  assert.ok(store.get(second.sessionId, { touch: false }));
  await store.flush();
  await writeFile(runtimePaths(root).sessions, '{broken', 'utf8');
  await assert.rejects(SessionStore.open({ runtimeStateDir: root }), (error) => error?.code === 'SESSION_STORE_CORRUPT');
});
