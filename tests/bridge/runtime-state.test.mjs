import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireSingletonLock,
  checkBridgeProcess,
  clearStaleSingletonLock,
  readBridgeState,
  readOrCreateControlToken,
  removeBridgeState,
  runtimePaths,
  writeBridgeState,
} from '../../src/bridge/runtime-state.mjs';

async function temporaryRuntime(test) {
  const root = await mkdtemp(join(tmpdir(), 'livedot-runtime-'));
  test.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('runtime state keeps a validated stable port', async (test) => {
  const root = await temporaryRuntime(test);
  assert.equal(await readBridgeState(root), null);
  const written = await writeBridgeState(root, { pid: 1234, port: 45678, startedAt: '2026-08-20T00:00:00.000Z' });
  assert.deepEqual(await readBridgeState(root), written);
  assert.equal((await readFile(runtimePaths(root).bridge, 'utf8')).includes('45678'), true);
});

test('control token is stable and invalid content fails closed', async (test) => {
  const root = await temporaryRuntime(test);
  const first = await readOrCreateControlToken(root);
  assert.equal(first.length, 43);
  assert.equal(await readOrCreateControlToken(root), first);
  await writeFile(runtimePaths(root).controlToken, 'weak\n', 'utf8');
  await assert.rejects(readOrCreateControlToken(root), (error) => error?.code === 'CONTROL_TOKEN_CORRUPT');
});

test('singleton lock is exclusive and can be released', async (test) => {
  const root = await temporaryRuntime(test);
  const release = await acquireSingletonLock(root);
  await assert.rejects(acquireSingletonLock(root), (error) => error?.code === 'BRIDGE_START_IN_PROGRESS');
  await release();
  const releaseAgain = await acquireSingletonLock(root);
  await releaseAgain();
});

test('stale lock is removed only when its recorded process is gone', async (test) => {
  const root = await temporaryRuntime(test);
  const stalePid = 2_147_483_647;
  await writeFile(runtimePaths(root).lock, `${JSON.stringify({ pid: stalePid })}\n`, 'utf8');
  assert.equal(await clearStaleSingletonLock(root, stalePid), true);
  const release = await acquireSingletonLock(root);
  assert.equal(await clearStaleSingletonLock(root, process.pid), false);
  await release();
});

test('only the owning pid removes bridge state', async (test) => {
  const root = await temporaryRuntime(test);
  await writeBridgeState(root, { pid: 4321, port: 45679 });
  assert.equal(await removeBridgeState(root, 9999), false);
  assert.ok(await readBridgeState(root));
  assert.equal(await removeBridgeState(root, 4321), true);
  assert.equal(await readBridgeState(root), null);
});

test('checkBridgeProcess identifies the current node process and dead pids', async () => {
  // 当前测试进程就是 node，应被认成 Bridge 形态；不存在的 pid 按“可清理”处理。
  assert.equal(await checkBridgeProcess(process.pid), 'bridge');
  assert.equal(await checkBridgeProcess(2_147_483_647), 'other');
});

test('force option clears a lock whose pid was reused by another process', async (test) => {
  const root = await temporaryRuntime(test);
  // 用一个确认活着的 pid（当前进程）模拟“pid 被复用”：默认拒绝清理，force 放行。
  await writeFile(runtimePaths(root).lock, `${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
  assert.equal(await clearStaleSingletonLock(root, process.pid), false);
  assert.equal(await clearStaleSingletonLock(root, process.pid, { force: true }), true);
  // force 仍然校验锁的归属 pid，不能清掉别人的锁。
  const release = await acquireSingletonLock(root);
  assert.equal(await clearStaleSingletonLock(root, 9999, { force: true }), false);
  await release();
});
