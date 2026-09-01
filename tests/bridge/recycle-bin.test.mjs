import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { NativeRecycleBin, assertPurgeStagingPath, defaultNativeHelperPath } from '../../src/bridge/recycle-bin.mjs';

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

test('native helper 路径优先取桥进程旁边的启动器，兼容自定义安装目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-helper-path-'));
  const launcher = join(root, 'current', 'LiveDotMapSetup.exe');
  const bridgeExe = join(root, 'current', 'payload', 'livedot-bridge-win-x64.exe');
  await mkdir(join(root, 'current', 'payload'), { recursive: true });
  await writeFile(launcher, 'test');
  await writeFile(bridgeExe, 'test');
  // 桥进程旁边有启动器时直接用，不再依赖 LOCALAPPDATA 固定路径。
  assert.equal(
    defaultNativeHelperPath({ execPath: bridgeExe, envHelper: '', localAppData: join(root, 'elsewhere') }),
    launcher,
  );
  // 开发模式（node.exe 旁边没有启动器）回退到 LOCALAPPDATA 约定路径。
  const localAppData = join(root, 'local-app-data');
  assert.equal(
    defaultNativeHelperPath({ execPath: join(root, 'node-bin', 'node.exe'), envHelper: '', localAppData }),
    join(localAppData, 'live-dot-map', 'current', 'LiveDotMapSetup.exe'),
  );
  // 显式 helperPath 永远优先。
  assert.equal(defaultNativeHelperPath({ helperPath: launcher, execPath: join(root, 'node.exe') }), launcher);
});
