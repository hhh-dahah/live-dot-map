import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { ProjectStore } from '../../src/bridge/project-store.mjs';
import { commandEnvelope, createRouteCommand, temporaryProject } from './helpers.mjs';

test('durably commits and deduplicates commandId across restart', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const first = await ProjectStore.open({ projectRoot: root, shared, snapshotEvery: 1 });
  const result = await first.execute(commandEnvelope('command-001', 0));
  assert.equal(result.revision, 1);
  assert.equal(result.document.revision, 1);
  assert.equal(result.idempotent, false);

  const duplicate = await first.execute(commandEnvelope('command-001', 0));
  assert.equal(duplicate.revision, 1);
  assert.equal(duplicate.idempotent, true);
  await assert.rejects(
    first.execute(commandEnvelope('command-001', 0, createRouteCommand('r2', 'Different'))),
    (error) => error.code === 'COMMAND_ID_REUSE',
  );

  const reopened = await ProjectStore.open({ projectRoot: root, shared, snapshotEvery: 1 });
  const replay = await reopened.execute(commandEnvelope('command-001', 0));
  assert.equal(replay.revision, 1);
  assert.equal(replay.idempotent, true);
  assert.equal((await reopened.snapshot()).document.routes.length, 1);
});

test('serializes concurrent commands and rejects the stale baseRevision', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  const settled = await Promise.allSettled([
    store.execute(commandEnvelope('command-a01', 0, createRouteCommand('r1', 'A'))),
    store.execute(commandEnvelope('command-b01', 0, createRouteCommand('r2', 'B'))),
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assert.equal(rejected.reason.code, 'REVISION_CONFLICT');
  const snapshot = await store.snapshot();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.document.routes.length, 1);
});

test('serializes two independent store instances with the project lock', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const first = await ProjectStore.open({ projectRoot: root, shared });
  const second = await ProjectStore.open({ projectRoot: root, shared });
  const settled = await Promise.allSettled([
    first.execute(commandEnvelope('command-proc1', 0, createRouteCommand('r1', 'First'))),
    second.execute(commandEnvelope('command-proc2', 0, createRouteCommand('r2', 'Second'))),
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.find((item) => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const reopened = await ProjectStore.open({ projectRoot: root, shared });
  assert.equal((await reopened.snapshot()).document.routes.length, 1);
});

for (const failurePoint of ['afterWalPrepare', 'afterMapReplace']) {
  test(`recovers an interrupted commit at ${failurePoint}`, async (t) => {
    const { root, shared } = await temporaryProject(t);
    let injected = false;
    const store = await ProjectStore.open({
      projectRoot: root,
      shared,
      faultInjector(point) {
        if (!injected && point === failurePoint) {
          injected = true;
          throw Object.assign(new Error('simulated crash'), { code: 'SIMULATED_CRASH' });
        }
      },
    });
    await assert.rejects(store.execute(commandEnvelope('command-crash', 0)), /simulated crash/);

    const reopened = await ProjectStore.open({ projectRoot: root, shared });
    const snapshot = await reopened.snapshot();
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.document.routes[0].id, 'r1');
    const replay = await reopened.execute(commandEnvelope('command-crash', 0));
    assert.equal(replay.idempotent, true);
  });
}

for (const [failureName, failurePoint, code] of [
  ['disk full', 'afterWalPrepare', 'ENOSPC'],
  ['permission revoked', 'afterMapReplace', 'EACCES'],
]) {
  test(`does not report success after ${failureName} and recovers from WAL`, async (t) => {
    const { root, shared } = await temporaryProject(t);
    let injected = false;
    const store = await ProjectStore.open({
      projectRoot: root,
      shared,
      faultInjector(point) {
        if (!injected && point === failurePoint) {
          injected = true;
          throw Object.assign(new Error(failureName), { code });
        }
      },
    });
    await assert.rejects(store.execute(commandEnvelope(`command-${code.toLowerCase()}`, 0)), (error) => error.code === code);
    const reopened = await ProjectStore.open({ projectRoot: root, shared });
    assert.equal((await reopened.snapshot()).revision, 1);
  });
}

test('repairs and quarantines a torn WAL tail', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  await store.execute(commandEnvelope('command-wal1', 0));
  const wal = join(root, '.live-dot-map', '.bridge', 'wal.ndjson');
  await writeFile(wal, `${await readFile(wal, 'utf8')}{"type":"partial"`, 'utf8');

  const reopened = await ProjectStore.open({ projectRoot: root, shared });
  assert.equal((await reopened.snapshot()).revision, 1);
  const quarantine = await readdir(join(root, '.live-dot-map', '.bridge', 'quarantine'));
  assert.ok(quarantine.some((name) => name.includes('wal.invalid-tail')));
  const repairedWal = await readFile(wal, 'utf8');
  assert.doesNotThrow(() => repairedWal.trim().split('\n').map(JSON.parse));
});

test('recovers a corrupted map from the last checksummed WAL image', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  await store.execute(commandEnvelope('command-map1', 0));
  await writeFile(join(root, '.live-dot-map', 'map.json'), '{broken-json', 'utf8');

  const reopened = await ProjectStore.open({ projectRoot: root, shared });
  const snapshot = await reopened.snapshot();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.document.routes[0].id, 'r1');
  const quarantine = await readdir(join(root, '.live-dot-map', '.bridge', 'quarantine'));
  assert.ok(quarantine.some((name) => name.includes('map.json.corrupt')));
});

test('treats an empty map.json as a fresh project instead of failing', async (t) => {
  const { root, shared } = await temporaryProject(t);
  await writeFile(join(root, '.live-dot-map', 'map.json'), '', 'utf8');
  const store = await ProjectStore.open({ projectRoot: root, shared });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.document.version, 2);
  assert.ok(typeof snapshot.document.mapId === 'string' && snapshot.document.mapId.length > 0, 'empty map should be replaced by a fresh empty map');
  assert.ok(Array.isArray(snapshot.document.routes), 'rebuilt map must have collections');
  const quarantine = await readdir(join(root, '.live-dot-map', '.bridge', 'quarantine'));
  assert.ok(quarantine.some((name) => name.includes('map.empty.json')), 'empty original should be preserved as evidence');
  await store.execute(commandEnvelope('command-empty1', 0));
  assert.equal((await store.snapshot()).revision, 1, 'rebuilt map must stay writable');
});

test('rebuilds a map emptied at runtime instead of quarantining per poll', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared, pollIntervalMs: 30 });
  await store.execute(commandEnvelope('command-empty2', 0));
  const quarantineDir = join(root, '.live-dot-map', '.bridge', 'quarantine');
  const before = await readdir(quarantineDir);
  await writeFile(join(root, '.live-dot-map', 'map.json'), '', 'utf8');
  // 轮询检测到磁盘变化后应重建（WAL 有提交记录 → 恢复历史文档，revision 保持）。
  const mapPath = join(root, '.live-dot-map', 'map.json');
  const deadline = Date.now() + 5000;
  let size = 0;
  while (Date.now() < deadline) {
    size = (await stat(mapPath)).size;
    if (size > 0) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.ok(size > 0, 'emptied map should be rebuilt from WAL');
  assert.ok((await store.snapshot()).revision >= 1, 'WAL history should survive a runtime empty');
  const after = await readdir(quarantineDir);
  const newOperationCorrupt = after.filter((name) => name.includes('operation-corrupt') && !before.includes(name));
  assert.deepEqual(newOperationCorrupt, [], 'runtime rebuild must not quarantine garbage per poll');
});

test('detects an external write and turns an old command into a revision conflict', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  const current = (await store.snapshot()).document;
  const external = await shared.applyCommand(current, createRouteCommand('external-route', 'Agent'), {
    actor: 'agent:test', revision: 1, now: '2026-08-11T01:00:00.000Z',
  });
  await writeFile(join(root, '.live-dot-map', 'map.json'), `${JSON.stringify(external, null, 2)}\n`);

  await assert.rejects(
    store.execute(commandEnvelope('command-stale', 0, createRouteCommand('human-route', 'Human'))),
    (error) => error.code === 'REVISION_CONFLICT' && error.details.currentRevision === 1,
  );
  assert.equal((await store.snapshot()).document.routes[0].id, 'external-route');
});

test('quarantines and rolls back an external stale-revision overwrite', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  const original = (await store.snapshot()).document;
  await store.execute(commandEnvelope('command-safe1', 0));
  await writeFile(join(root, '.live-dot-map', 'map.json'), `${JSON.stringify(original, null, 2)}\n`);

  await assert.rejects(store.snapshot(), (error) => (
    error.code === 'EXTERNAL_REVISION_CONFLICT'
    && error.details.externalRevision === 0
    && error.details.currentRevision === 1
    && error.details.restored === true
  ));
  const disk = JSON.parse(await readFile(join(root, '.live-dot-map', 'map.json'), 'utf8'));
  assert.equal(disk.revision, 1);
  assert.equal(disk.routes.length, 1);
  const quarantine = await readdir(join(root, '.live-dot-map', '.bridge', 'quarantine'));
  assert.ok(quarantine.some((name) => name.includes('map.stale-external')));
});

test('creates snapshots and daily backup, then restores a selected snapshot with quarantine', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const clock = () => new Date('2026-08-11T02:00:00.000Z');
  const store = await ProjectStore.open({ projectRoot: root, shared, clock, snapshotEvery: 100 });
  await store.execute(commandEnvelope('command-snap1', 0, createRouteCommand('r1', 'Keep')));
  const image = await store.createSnapshot();
  await store.execute(commandEnvelope('command-snap2', 1, createRouteCommand('r2', 'Discard')));

  const recovered = await store.recover({ source: 'snapshot', name: basename(image.path) });
  assert.equal(recovered.revision, 3);
  assert.deepEqual(recovered.document.routes.map((route) => route.id), ['r1']);
  assert.ok(recovered.quarantinePath.includes('map.before-recovery'));
  const backups = await readdir(join(root, '.live-dot-map', '.bridge', 'backups'));
  assert.deepEqual(backups, ['2026-08-11.json']);
});

test('keeps only 20 snapshots, compacts WAL documents, and preserves old command idempotency', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared, snapshotEvery: 1 });
  for (let revision = 0; revision < 25; revision += 1) {
    await store.execute(commandEnvelope(`command-retain-${String(revision).padStart(2, '0')}`, revision, createRouteCommand(`r${revision + 1}`, `R${revision + 1}`)));
  }
  const snapshots = await readdir(join(root, '.live-dot-map', '.bridge', 'snapshots'));
  assert.equal(snapshots.length, 20);
  const records = (await readFile(join(root, '.live-dot-map', '.bridge', 'wal.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.filter((record) => record.document !== undefined).length, 1);
  assert.equal(records.at(-1).type, 'checkpoint');
  const reopened = await ProjectStore.open({ projectRoot: root, shared, snapshotEvery: 1 });
  const replay = await reopened.execute(commandEnvelope('command-retain-00', 0, createRouteCommand('r1', 'R1')));
  assert.equal(replay.idempotent, true);
  assert.equal(replay.revision, 1);
});

test('keeps only the latest 7 daily backups', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const backupDirectory = join(root, '.live-dot-map', '.bridge', 'backups');
  await ProjectStore.open({ projectRoot: root, shared, clock: () => new Date('2026-08-11T00:00:00.000Z') });
  for (let day = 1; day <= 8; day += 1) {
    await writeFile(join(backupDirectory, `2026-07-${String(day).padStart(2, '0')}.json`), '{}');
  }
  await ProjectStore.open({ projectRoot: root, shared, clock: () => new Date('2026-08-12T00:00:00.000Z') });
  const backups = (await readdir(backupDirectory)).sort();
  assert.equal(backups.length, 7);
  assert.equal(backups.at(-1), '2026-08-12.json');
});

test('migrates a v1 map only after preserving the source in quarantine', async (t) => {
  const legacy = {
    version: 1,
    name: 'legacy',
    updatedAt: '2026-08-01',
    view: { x: 0, y: 0, k: 1 },
    ui: {},
    counters: {},
    routes: [], nodes: [], edges: [], anns: [],
  };
  const { root, shared } = await temporaryProject(t, { map: legacy });
  const store = await ProjectStore.open({ projectRoot: root, shared, clock: () => new Date('2026-08-11T00:00:00.000Z') });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.document.version, 2);
  assert.equal(snapshot.document.migration.from, 1);
  const quarantine = await readdir(join(root, '.live-dot-map', '.bridge', 'quarantine'));
  assert.ok(quarantine.some((name) => name.includes('map.v1-before-migration')));
});

test('opens an unknown future schema read-only without rewriting or quarantining it', async (t) => {
  const future = { version: 99, revision: 7, futurePayload: { keep: true } };
  const { root, shared } = await temporaryProject(t, { map: future });
  const path = join(root, '.live-dot-map', 'map.json');
  const before = await readFile(path, 'utf8');
  const store = await ProjectStore.open({ projectRoot: root, shared });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.readOnly, true);
  assert.deepEqual(snapshot.document.futurePayload, { keep: true });
  await assert.rejects(store.execute(commandEnvelope('command-future', 7)), (error) => error.code === 'READ_ONLY_SCHEMA');
  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(await readdir(join(root, '.live-dot-map', '.bridge', 'quarantine')), []);
});

test('rejects an oversized map before reading or quarantining the payload', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const path = join(root, '.live-dot-map', 'map.json');
  await truncate(path, 64 * 1024 * 1024 + 1);
  await assert.rejects(ProjectStore.open({ projectRoot: root, shared }), (error) => error.code === 'MAP_TOO_LARGE' && error.status === 413);
  assert.deepEqual(await readdir(join(root, '.live-dot-map', '.bridge', 'quarantine')), []);
});

test('rejects a .live-dot-map junction that escapes the registered project', async (t) => {
  const { root, shared } = await temporaryProject(t, { withMap: false });
  const testRoot = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');
  await mkdir(testRoot, { recursive: true });
  const outside = await mkdtemp(join(testRoot, 'live-dot-map-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(outside, { recursive: true });
  try {
    await symlink(outside, join(root, '.live-dot-map'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('当前系统不允许创建测试符号链接');
    throw error;
  }
  await assert.rejects(ProjectStore.open({ projectRoot: root, shared }), (error) => error.code === 'SYMLINK_ESCAPE' && error.status === 403);
});
