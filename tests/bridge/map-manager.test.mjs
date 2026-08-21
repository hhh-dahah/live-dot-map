import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { MapManager } from '../../src/bridge/map-manager.mjs';
import { readActiveMap, resolveActiveMap, writeActiveMap } from '../../src/bridge/maps.mjs';
import { temporaryProject } from './helpers.mjs';

async function openManager(t, options = {}) {
  const project = await temporaryProject(t, { withMap: false });
  const manager = await MapManager.open({ projectRoot: project.root, shared: project.shared, ...options });
  t.after(() => manager.close());
  return { ...project, manager };
}

test('MapManager.create 创建完整 map.json 且不自动切换当前地图', async (t) => {
  const { root, manager } = await openManager(t);

  assert.equal(await resolveActiveMap(root), 'default');
  const result = await manager.create('发布计划');

  assert.match(result.createdMap, /^发布计划|^map-/i);
  assert.equal(result.activeMap, 'default');
  assert.equal(await readActiveMap(root), 'default');
  const document = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', result.createdMap, 'map.json'), 'utf8'));
  assert.equal(document.mapId, result.documentId);
  assert.equal(document.name, '发布计划');
  assert.equal(document.version, 2);
  assert.equal(document.revision, 0);
  assert.equal(document.bundleLayoutVersion, 1);
  assert.equal(document.mapDir, `.live-dot-map/maps/${result.createdMap}`);
  assert.deepEqual(document.nodes, []);
  assert.deepEqual(document.routes, []);
});

test('MapManager.create 并发同名时分配不同 mapKey，且两张图均完成初始化', async (t) => {
  const { root, shared } = await temporaryProject(t, { withMap: false });
  const [left, right] = await Promise.all([
    MapManager.open({ projectRoot: root, shared }),
    MapManager.open({ projectRoot: root, shared }),
  ]);
  t.after(() => Promise.all([left.close(), right.close()]));

  const results = await Promise.all([left.create('并发计划'), right.create('并发计划')]);
  assert.notEqual(results[0].createdMap, results[1].createdMap);
  assert.equal(results[0].activeMap, 'default');
  assert.equal(results[1].activeMap, 'default');
  for (const result of results) {
    const path = join(root, '.live-dot-map', 'maps', result.createdMap, 'map.json');
    await access(path);
    const document = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(document.mapId, result.documentId);
    assert.equal(document.name, '并发计划');
    assert.equal(document.bundleLayoutVersion, 1);
  }
});

test('MapManager.switch 先打开并校验目标地图，失败时不改变 active-map', async (t) => {
  const { root, manager } = await openManager(t);
  const first = await manager.create('当前');
  const second = await manager.create('目标');
  await writeActiveMap(root, first.createdMap);

  await assert.rejects(
    manager.switch('does-not-exist'),
    (error) => error?.code === 'MAP_NOT_FOUND',
  );
  assert.equal(await readActiveMap(root), first.createdMap);

  // 目标目录存在但文档已损坏：ProjectStore 打开失败，指针仍应停留在原图。
  await writeFile(join(root, '.live-dot-map', 'maps', second.createdMap, 'map.json'), '{broken', 'utf8');
  await assert.rejects(manager.switch(second.createdMap));
  assert.equal(await readActiveMap(root), first.createdMap);
});

test('长驻 MapManager 的隐式解析跟随 A→B→A，并释放旧隐式 Store', async (t) => {
  const { root, manager: creator, shared } = await openManager(t);
  const first = await creator.create('地图 A');
  const second = await creator.create('地图 B');
  await creator.close();

  const manager = await MapManager.open({ projectRoot: root, shared });
  t.after(() => manager.close());

  await writeActiveMap(root, first.createdMap);
  const a1 = await manager.resolve();
  assert.equal(a1.mapKey, first.createdMap);
  assert.equal(a1.snapshot.document.mapId, a1.documentId);

  await writeActiveMap(root, second.createdMap);
  const b = await manager.resolve();
  assert.equal(b.mapKey, second.createdMap);
  assert.equal(b.snapshot.document.mapId, b.documentId);
  assert.notEqual(b.store, a1.store);
  assert.equal(manager.stores.has(first.createdMap), false);

  await writeActiveMap(root, first.createdMap);
  const a2 = await manager.resolve();
  assert.equal(a2.mapKey, first.createdMap);
  assert.notEqual(a2.store, a1.store, '旧隐式 Store 不应被重新复用');
  assert.equal(manager.stores.has(second.createdMap), false);
  assert.equal(a2.snapshot.document.mapId, a2.documentId);
});

test('显式 mapKey 解析不受 active-map 指针影响，也不改变隐式地图', async (t) => {
  const { root, manager: creator, shared } = await openManager(t);
  const first = await creator.create('指针图');
  const second = await creator.create('显式图');
  await creator.close();

  const manager = await MapManager.open({ projectRoot: root, shared });
  t.after(() => manager.close());
  await writeActiveMap(root, first.createdMap);
  const implicit = await manager.resolve();
  const explicit = await manager.resolve({ mapKey: second.createdMap });
  assert.equal(explicit.mapKey, second.createdMap);
  assert.equal(explicit.snapshot.document.mapId, explicit.documentId);
  assert.equal(await readActiveMap(root), first.createdMap);

  const implicitAgain = await manager.resolve();
  assert.equal(implicitAgain.mapKey, first.createdMap);
  assert.equal(implicitAgain.store, implicit.store, '显式解析不应改写隐式 active-map 解析状态');
  assert.equal(manager.stores.has(second.createdMap), true);
});
