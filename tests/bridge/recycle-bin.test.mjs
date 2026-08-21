import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { NativeRecycleBin, assertPurgeStagingPath } from '../../src/bridge/recycle-bin.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'livedot-recycle-'));
  const transaction = '2026-08-20T12-00-00-000Z-01234567-89ab-4cde-8fab-0123456789ab';
  const staging = join(root, '.live-dot-map', 'maps', 'default', '.bridge', 'purge-staging', transaction);
  const helper = join(root, 'LiveDotMapSetup.exe');
  await mkdir(staging, { recursive: true });
  await writeFile(helper, 'test');
  return { root, staging, helper };
}

test('purge helper 只接受最终地图的受控 staging transaction', async () => {
  const { root, staging } = await fixture();
  assert.equal(await assertPurgeStagingPath(staging), staging);
  await assert.rejects(assertPurgeStagingPath(join(root, 'ordinary-folder')), (cause) => cause.code === 'PURGE_STAGING_PATH_INVALID');
});

test('native recycle helper 使用固定参数且不启用 shell', async () => {
  const { staging, helper } = await fixture();
  const calls = [];
  const spawnImpl = (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    queueMicrotask(() => {
      child.stdout.emit('data', JSON.stringify({ ok: true }));
      child.emit('close', 0);
    });
    return child;
  };
  const recycle = new NativeRecycleBin({ helperPath: helper, spawnImpl });
  assert.equal(await recycle.recycle(staging), true);
  assert.deepEqual(calls[0].args, ['--recycle-staging', staging]);
  assert.equal(calls[0].options.shell, false);
});
