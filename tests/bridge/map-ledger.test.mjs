import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MapLedger, defaultLedgerFile } from '../../src/bridge/map-ledger.mjs';
import { MapManager } from '../../src/bridge/map-manager.mjs';
import { createBridgeServer } from '../../src/bridge/server.mjs';
import { temporaryProject } from './helpers.mjs';

const APP_ORIGIN = 'https://app.example.test';

async function ledgerFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'livedot-ledger-test-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  return new MapLedger({ file: join(directory, 'known-maps.json') });
}

async function addNodes(manager, mapKey, count) {
  const context = await manager.resolve({ mapKey });
  const commands = Array.from({ length: count }, (_, index) => ({
    op: 'create', collection: 'nodes', value: { id: `n${index + 1}`, name: `节点 ${index + 1}`, type: '目标', x: index, y: index },
  }));
  return context.store.execute({
    projectId: context.documentId,
    baseRevision: context.snapshot.revision,
    commandId: `cmd-${randomUUID()}`,
    actor: 'human',
    sessionId: 'ledger-test',
    commands,
  });
}

const missingDirectory = (path) => access(path).then(() => false, () => true);

test('账本：空的新项目正常打开，空图不入账', async (t) => {
  const { root, shared } = await temporaryProject(t, { withMap: false });
  const ledger = await ledgerFor(t);
  const manager = await MapManager.open({ projectRoot: root, shared, ledger });
  t.after(() => manager.close());
  await manager.resolve();
  await manager.recordLedger();
  assert.deepEqual(await ledger.findMissing(root), []);
  const saved = JSON.parse(await readFile(ledger.file, 'utf8'));
  assert.deepEqual(saved.projects, {});
});

test('账本：有内容的地图整体被删后拒绝打开，也不补建空 default', async (t) => {
  const { root, shared } = await temporaryProject(t, { withMap: false });
  const ledger = await ledgerFor(t);
  const first = await MapManager.open({ projectRoot: root, shared, ledger });
  await addNodes(first, 'default', 3);
  await first.recordLedger();
  await first.close();

  await rm(join(root, '.live-dot-map'), { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  await assert.rejects(
    MapManager.open({ projectRoot: root, shared, ledger }),
    (error) => {
      assert.equal(error.code, 'MAPS_MISSING');
      assert.equal(error.details.missing.length, 1);
      assert.equal(error.details.missing[0].id, 'default');
      assert.equal(error.details.missing[0].nodes, 3);
      assert.match(error.message, /夸克网盘/);
      assert.match(error.message, /forget-maps/);
      return true;
    },
  );
  assert.equal(await missingDirectory(join(root, '.live-dot-map')), true, '丢图时不能补建 .live-dot-map');
});

test('账本：只丢一张图也拦下；forget 之后恢复正常打开', async (t) => {
  const { root, shared } = await temporaryProject(t, { withMap: false });
  const ledger = await ledgerFor(t);
  const manager = await MapManager.open({ projectRoot: root, shared, ledger });
  const created = await manager.create('第二张');
  await addNodes(manager, 'default', 1);
  await addNodes(manager, created.createdMap, 2);
  await manager.recordLedger();
  await manager.close();

  await rm(join(root, '.live-dot-map', 'maps', created.createdMap, 'map.json'), { force: true });
  await assert.rejects(
    MapManager.open({ projectRoot: root, shared, ledger }),
    (error) => error.code === 'MAPS_MISSING' && error.details.missing.length === 1 && error.details.missing[0].name === '第二张',
  );

  const forgotten = await ledger.forget(root);
  assert.deepEqual(forgotten.removed.map((map) => map.id), [created.createdMap]);
  const reopened = await MapManager.open({ projectRoot: root, shared, ledger });
  t.after(() => reopened.close());
  assert.equal((await reopened.resolve({ mapKey: 'default' })).snapshot.document.nodes.length, 1);
});

test('账本：运行中地图被删，resolve 报 MAPS_MISSING 而不是普通的不存在', async (t) => {
  const { root, shared } = await temporaryProject(t, { withMap: false });
  const ledger = await ledgerFor(t);
  const manager = await MapManager.open({ projectRoot: root, shared, ledger });
  const created = await manager.create('会被删的图');
  await addNodes(manager, created.createdMap, 2);
  await manager.recordLedger();
  await manager.close();

  const running = await MapManager.open({ projectRoot: root, shared, ledger });
  t.after(() => running.close());
  await rm(join(root, '.live-dot-map', 'maps', created.createdMap), { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  await assert.rejects(running.resolve({ mapKey: created.createdMap }), (error) => error.code === 'MAPS_MISSING');
});

test('账本默认位置跟随测试沙箱，不写进真实用户目录', () => {
  assert.equal(defaultLedgerFile({ LIVEDOT_MAP_LEDGER_FILE: 'X:\\a\\ledger.json' }), 'X:\\a\\ledger.json');
  assert.equal(defaultLedgerFile({ LIVEDOT_RECENT_PROJECTS_FILE: 'X:\\sandbox\\recent.json' }), join('X:\\sandbox', 'known-maps.json'));
  assert.equal(defaultLedgerFile({ LIVEDOT_TEST_ROOT: 'X:\\test-root' }), join('X:\\test-root', 'known-maps.json'));
});

test('桥 /open：丢图返回 409 MAPS_MISSING，且不建空地图', async (t) => {
  const { root, shared } = await temporaryProject(t, { withMap: false });
  const ledger = await ledgerFor(t);
  const seed = await MapManager.open({ projectRoot: root, shared, ledger });
  await addNodes(seed, 'default', 4);
  await seed.recordLedger();
  await seed.close();
  await rm(join(root, '.live-dot-map'), { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });

  const server = await createBridgeServer({
    allowedProjectRoots: [root],
    allowedOrigins: [APP_ORIGIN],
    shared,
    mapLedger: ledger,
    agentSetup: null,
    retentionEnabled: false,
    recentProjectsStore: { async record() {}, async list() { return []; } },
  });
  t.after(() => server.close());
  const exchange = await fetch(`${server.origin}/session`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${server.bootstrapToken}` },
  });
  const session = { cookie: exchange.headers.get('set-cookie').split(';', 1)[0], csrf: (await exchange.json()).csrfToken };
  const opened = await fetch(`${server.origin}/open`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectRoot: root }),
  });
  assert.equal(opened.status, 409);
  const body = await opened.json();
  assert.equal(body.error.code, 'MAPS_MISSING');
  assert.equal(await missingDirectory(join(root, '.live-dot-map', 'maps', 'default')), true, '不能补建空 default');
});
