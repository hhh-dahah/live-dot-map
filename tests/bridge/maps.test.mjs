import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { createBridgeServer } from '../../src/bridge/server.mjs';
import { ProjectStore } from '../../src/bridge/project-store.mjs';
import {
  createMap,
  ensureBundleLayout,
  ensureMapsLayout,
  isSafeMapId,
  listMaps,
  readActiveMap,
  resolveActiveMap,
  writeActiveMap,
} from '../../src/bridge/maps.mjs';
import { temporaryProject } from './helpers.mjs';

// 隔离最近项目记录，理由同 server.test.mjs。
process.env.LIVEDOT_RECENT_PROJECTS_FILE = join(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test', 'recent-projects-maps-test.json');

const APP_ORIGIN = 'https://app.example.test';

async function startServer(t, options = {}) {
  const project = await temporaryProject(t);
  const server = await createBridgeServer({
    allowedProjectRoots: [project.root],
    allowedOrigins: [APP_ORIGIN],
    shared: project.shared,
    ...options,
  });
  t.after(() => server.close());
  return { ...project, server };
}

async function establishSession(server) {
  const exchange = await fetch(`${server.origin}/session`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${server.bootstrapToken}` },
  });
  assert.equal(exchange.status, 201);
  const body = await exchange.json();
  return { cookie: exchange.headers.get('set-cookie').split(';', 1)[0], csrf: body.csrfToken };
}

function authHeaders(session, extra = {}) {
  return { Origin: APP_ORIGIN, Cookie: session.cookie, 'X-CSRF-Token': session.csrf, ...extra };
}

async function openProject(server, root, session) {
  const response = await fetch(`${server.origin}/open`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ projectRoot: root }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('地图 id 校验：只收安全字符集', () => {
  assert.equal(isSafeMapId('default'), true);
  assert.equal(isSafeMapId('a-b_c2'), true);
  assert.equal(isSafeMapId(''), false);
  assert.equal(isSafeMapId('../escape'), false);
  assert.equal(isSafeMapId('Abc'), false);
  assert.equal(isSafeMapId('-lead'), false);
  assert.equal(isSafeMapId(null), false);
});

test('active-map 指针：写入/读取/非法内容回退 default', async (t) => {
  const { root } = await temporaryProject(t);
  assert.equal(await readActiveMap(root), null);
  assert.equal(await resolveActiveMap(root), 'default');
  await writeActiveMap(root, 'alpha');
  assert.equal(await readActiveMap(root), 'alpha');
  assert.equal(await resolveActiveMap(root), 'alpha');
  await writeFile(join(root, '.live-dot-map', 'active-map'), '../escape\n', 'utf8');
  assert.equal(await readActiveMap(root), null);
  assert.equal(await resolveActiveMap(root), 'default');
});

test('ensureMapsLayout 迁移老布局：备份、改写 md 前缀、资料包 index、幂等', async (t) => {
  const { root } = await temporaryProject(t);
  // 造一份带 Markdown 引用与分片文件的老布局
  const legacy = JSON.parse(await readFile(join(root, '.live-dot-map', 'map.json'), 'utf8'));
  legacy.nodes = [{ id: 'n1', name: '目标', md: '.live-dot-map/nodes/n1.md' }];
  legacy.edges = [{ id: 'e1', name: '方案', md: '.live-dot-map/routes/e1.md' }];
  await writeFile(join(root, '.live-dot-map', 'map.json'), JSON.stringify(legacy, null, 2));
  await mkdir(join(root, '.live-dot-map', 'nodes'), { recursive: true });
  await writeFile(join(root, '.live-dot-map', 'nodes', 'n1.md'), '# 目标\n', 'utf8');
  await mkdir(join(root, '.live-dot-map', '.bridge'), { recursive: true });
  await writeFile(join(root, '.live-dot-map', '.bridge', 'wal.ndjson'), '{"record":1}\n', 'utf8');

  const first = await ensureMapsLayout(root);
  assert.deepEqual(first, { migrated: true, activeMap: 'default' });

  const migrated = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
  assert.equal(migrated.mapDir, '.live-dot-map/maps/default');
  assert.equal(migrated.nodes[0].md, '.live-dot-map/maps/default/nodes/n1/index.md');
  assert.equal(migrated.edges[0].md, '.live-dot-map/maps/default/routes/e1/index.md');
  assert.equal(migrated.bundleLayoutVersion, 1);
  assert.equal(migrated.name, legacy.name);
  // 迁移直写绕过 WAL，必须推进 revision，否则常驻 ProjectStore 会把直写
  // 当成“外部旧版本覆盖”抛 EXTERNAL_REVISION_CONFLICT。
  assert.equal(migrated.revision, legacy.revision + 1);

  // 分片文件随图迁移；旧 map.json 已搬走
  assert.equal(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'nodes', 'n1', 'index.md'), 'utf8'), '# 目标\n');
  await assert.rejects(access(join(root, '.live-dot-map', 'map.json')));

  // 旧 WAL 不继续使用（迁移改写了 md 前缀，checksum 已失真），留作证据文件
  assert.equal(
    await readFile(join(root, '.live-dot-map', 'maps', 'default', '.bridge', 'wal.ndjson.legacy-migrated'), 'utf8'),
    '{"record":1}\n',
  );

  // 迁移前备份（backups 目录随图迁到 maps/default/.bridge/backups）保留改写前内容
  const backups = await readdir(join(root, '.live-dot-map', 'maps', 'default', '.bridge', 'backups'));
  const stamp = backups.find((name) => name.startsWith('pre-maps-migration-'));
  assert.ok(stamp, '缺少迁移前备份目录');
  const backupDoc = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', 'default', '.bridge', 'backups', stamp, 'map.json'), 'utf8'));
  assert.equal(backupDoc.nodes[0].md, '.live-dot-map/nodes/n1.md');
  assert.equal(await readFile(join(root, '.live-dot-map', 'maps', 'default', '.bridge', 'backups', stamp, 'wal.ndjson'), 'utf8'), '{"record":1}\n');

  assert.equal(await readActiveMap(root), 'default');

  // 幂等：二次调用不再迁移，文档保持不变
  const second = await ensureMapsLayout(root);
  assert.deepEqual(second, { migrated: false, activeMap: 'default' });
  const again = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
  assert.deepEqual(again, migrated);
});

test('ensureMapsLayout 全新项目：建空 maps/default 并写指针', async (t) => {
  const { root } = await temporaryProject(t, { withMap: false });
  const result = await ensureMapsLayout(root);
  assert.deepEqual(result, { migrated: false, activeMap: 'default' });
  await access(join(root, '.live-dot-map', 'maps', 'default'));
  assert.equal(await readActiveMap(root), 'default');
});

test('ensureBundleLayout：平铺主文档迁入 index.md，保留未知字段并写完整备份/journal', async (t) => {
  const { root } = await temporaryProject(t);
  const mapId = 'bundle-migration';
  const mapRoot = join(root, '.live-dot-map', 'maps', mapId);
  const document = JSON.parse(await readFile(join(root, '.live-dot-map', 'map.json'), 'utf8'));
  document.mapId = 'map-bundle-migration';
  document.mapDir = `.live-dot-map/maps/${mapId}`;
  document.nodes = [{ id: 'n1', name: '目标', md: `${document.mapDir}/nodes/n1.md` }];
  document.edges = [{ id: 'e1', name: '方案', md: `${document.mapDir}/routes/e1.md` }];
  document.unknownFutureField = { keep: true };
  delete document.bundleLayoutVersion;
  await mkdir(join(mapRoot, 'nodes'), { recursive: true });
  await mkdir(join(mapRoot, 'routes'), { recursive: true });
  await writeFile(join(mapRoot, 'map.json'), `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(join(mapRoot, 'nodes', 'n1.md'), '# 目标\n', 'utf8');
  await writeFile(join(mapRoot, 'routes', 'e1.md'), '# 方案\n', 'utf8');

  const result = await ensureBundleLayout(root, mapId);
  assert.equal(result.migrated, true);
  assert.equal(result.mapId, mapId);
  assert.ok(result.backupDirectory);
  assert.equal(await readFile(join(mapRoot, 'nodes', 'n1', 'index.md'), 'utf8'), '# 目标\n');
  assert.equal(await readFile(join(mapRoot, 'routes', 'e1', 'index.md'), 'utf8'), '# 方案\n');
  await assert.rejects(access(join(mapRoot, 'nodes', 'n1.md')));
  await assert.rejects(access(join(mapRoot, 'routes', 'e1.md')));

  const migrated = JSON.parse(await readFile(join(mapRoot, 'map.json'), 'utf8'));
  assert.equal(migrated.bundleLayoutVersion, 1);
  assert.equal(migrated.nodes[0].md, `${document.mapDir}/nodes/n1/index.md`);
  assert.equal(migrated.edges[0].md, `${document.mapDir}/routes/e1/index.md`);
  assert.deepEqual(migrated.unknownFutureField, { keep: true });

  const journal = JSON.parse(await readFile(join(mapRoot, '.bridge', 'migrations', 'bundle-layout-v1.json'), 'utf8'));
  assert.equal(journal.state, 'complete');
  assert.deepEqual(journal.planned.sort(), ['nodes/n1.md', 'routes/e1.md']);
  assert.deepEqual(journal.completed.sort(), journal.planned.sort());
  assert.equal(await readFile(join(result.backupDirectory, 'map.json'), 'utf8'), `${JSON.stringify(document, null, 2)}\n`);
  assert.equal(await readFile(join(result.backupDirectory, 'nodes', 'n1.md'), 'utf8'), '# 目标\n');
  assert.equal(await readFile(join(result.backupDirectory, 'routes', 'e1.md'), 'utf8'), '# 方案\n');
});

test('ensureBundleLayout：目标冲突预检不覆盖、不改平铺文件或 map.json', async (t) => {
  const { root } = await temporaryProject(t);
  const mapId = 'bundle-conflict';
  const mapRoot = join(root, '.live-dot-map', 'maps', mapId);
  const document = JSON.parse(await readFile(join(root, '.live-dot-map', 'map.json'), 'utf8'));
  document.mapId = 'map-bundle-conflict';
  document.mapDir = `.live-dot-map/maps/${mapId}`;
  delete document.bundleLayoutVersion;
  await mkdir(join(mapRoot, 'nodes', 'n1'), { recursive: true });
  await writeFile(join(mapRoot, 'map.json'), `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(join(mapRoot, 'nodes', 'n1.md'), '旧平铺内容\n', 'utf8');
  await writeFile(join(mapRoot, 'nodes', 'n1', 'index.md'), '用户新内容\n', 'utf8');
  const before = await readFile(join(mapRoot, 'map.json'), 'utf8');

  await assert.rejects(
    ensureBundleLayout(root, mapId),
    (error) => error?.code === 'BUNDLE_MIGRATION_CONFLICT' && error?.status === 409,
  );
  assert.equal(await readFile(join(mapRoot, 'nodes', 'n1.md'), 'utf8'), '旧平铺内容\n');
  assert.equal(await readFile(join(mapRoot, 'nodes', 'n1', 'index.md'), 'utf8'), '用户新内容\n');
  assert.equal(await readFile(join(mapRoot, 'map.json'), 'utf8'), before);
  await assert.rejects(access(join(mapRoot, '.bridge', 'migrations', 'bundle-layout-v1.json')));
});

test('ensureBundleLayout：无平铺文件只补版本，重复调用幂等且不新增备份', async (t) => {
  const { root } = await temporaryProject(t);
  const mapId = 'bundle-empty';
  const mapRoot = join(root, '.live-dot-map', 'maps', mapId);
  const document = JSON.parse(await readFile(join(root, '.live-dot-map', 'map.json'), 'utf8'));
  document.mapId = 'map-bundle-empty';
  delete document.mapDir;
  document.nodes = [{ id: 'n1', name: '旧节点', md: '.live-dot-map/nodes/n1.md' }];
  delete document.bundleLayoutVersion;
  await mkdir(mapRoot, { recursive: true });
  await writeFile(join(mapRoot, 'map.json'), `${JSON.stringify(document, null, 2)}\n`);

  const first = await ensureBundleLayout(root, mapId);
  assert.deepEqual(first, { migrated: false, mapId });
  const firstText = await readFile(join(mapRoot, 'map.json'), 'utf8');
  const firstDocument = JSON.parse(firstText);
  assert.equal(firstDocument.bundleLayoutVersion, 1);
  assert.equal(firstDocument.mapDir, `.live-dot-map/maps/${mapId}`);
  assert.equal(firstDocument.nodes[0].md, `.live-dot-map/maps/${mapId}/nodes/n1/index.md`);
  // 只补元数据也推进 revision（直写必须让常驻 ProjectStore 采纳）
  assert.equal(firstDocument.revision, document.revision + 1);
  const second = await ensureBundleLayout(root, mapId);
  assert.deepEqual(second, { migrated: false, mapId });
  assert.equal(await readFile(join(mapRoot, 'map.json'), 'utf8'), firstText);
  // .bridge/ 会因写锁存在，但不应产生迁移备份或 journal
  await assert.rejects(access(join(mapRoot, '.bridge', 'backups')));
  await assert.rejects(access(join(mapRoot, '.bridge', 'migrations')));
});

test('ensureBundleLayout 与常驻 ProjectStore 共存：直写推进 revision，重开不再 409 死循环', async (t) => {
  // 线上事故回归：map.json 缺 bundleLayoutVersion 时，迁移直写若不推进
  // revision，常驻 ProjectStore 会把它当成“外部旧版本覆盖”，隔离文件并
  // 恢复 WAL 旧文档，下次打开再迁移再冲突——画布永远打不开。
  const { root, shared } = await temporaryProject(t);
  await ensureMapsLayout(root);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  const before = await store.snapshot();
  await store.close();

  // 模拟旧数据：磁盘 map.json 缺 bundleLayoutVersion，revision 与 WAL 终态相同
  const mapRoot = join(root, '.live-dot-map', 'maps', 'default');
  const mapPath = join(mapRoot, 'map.json');
  const legacy = JSON.parse(await readFile(mapPath, 'utf8'));
  delete legacy.bundleLayoutVersion;
  await writeFile(mapPath, JSON.stringify(legacy, null, 2));

  await ensureBundleLayout(root, 'default');
  const stamped = JSON.parse(await readFile(mapPath, 'utf8'));
  assert.equal(stamped.revision, before.revision + 1);
  assert.equal(stamped.bundleLayoutVersion, 1);

  // 修复前这里必抛 EXTERNAL_REVISION_CONFLICT；修复后应采纳磁盘文档
  const reopened = await ProjectStore.open({ projectRoot: root, shared });
  const after = await reopened.snapshot();
  await reopened.close();
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.document, stamped);
});

test('createMap 生成安全 id、撞名加后缀；listMaps 标记当前地图', async (t) => {
  const { root, shared } = await temporaryProject(t);
  await ensureMapsLayout(root);
  const first = await createMap(root, '计划 A');
  const second = await createMap(root, '计划 A');
  assert.ok(isSafeMapId(first.id) && isSafeMapId(second.id));
  assert.notEqual(first.id, second.id);
  assert.equal(second.id, `${first.id}-2`);
  // createMap 只建目录；map.json 由 ProjectStore 首次打开时写入（这里模拟）
  const document = await shared.createEmptyMap({ name: second.name, now: '2026-08-16T00:00:00.000Z' });
  await writeFile(join(root, '.live-dot-map', 'maps', second.id, 'map.json'), JSON.stringify(document));
  await writeActiveMap(root, second.id);
  const { activeMap, maps } = await listMaps(root);
  assert.equal(activeMap, second.id);
  assert.deepEqual(maps.map((map) => map.id).sort(), ['default', first.id, second.id].sort());
  assert.equal(maps.find((map) => map.id === second.id).active, true);
  assert.equal(maps.find((map) => map.id === second.id).name, '计划 A');
  assert.equal(maps.find((map) => map.id === 'default').active, false);
});

test('多地图 HTTP API：打开迁移、列表、新建、切换、改名与命令按图隔离', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);

  // 打开老布局项目 → 自动迁移到 maps/default
  const opened = await openProject(server, root, session);
  assert.equal(opened.activeMap, 'default');
  assert.equal(opened.document.mapDir, '.live-dot-map/maps/default');
  await access(join(root, '.live-dot-map', 'maps', 'default', 'map.json'));

  const listedResponse = await fetch(`${server.origin}/maps`, { headers: authHeaders(session) });
  assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json();
  assert.equal(listed.activeMap, 'default');
  assert.deepEqual(listed.maps.map((map) => map.id), ['default']);

  // 新建地图只创建，不自动切换；UI 需要显式 create → switch。
  const createdResponse = await fetch(`${server.origin}/maps/create`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: '实验地图' }),
  });
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  const newId = created.createdMap;
  assert.ok(isSafeMapId(newId) && newId !== 'default');
  assert.equal(created.activeMap, 'default');
  assert.equal(created.document.name, '实验地图');
  assert.equal(created.document.mapDir, `.live-dot-map/maps/${newId}`);
  assert.equal(created.projectId, created.document.mapId);

  const enterCreated = await fetch(`${server.origin}/maps/switch`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mapId: newId }),
  });
  assert.equal(enterCreated.status, 200);

  // 显式切换后命令落到新图；新建节点的 Markdown 分片按新图目录
  const commandResponse = await fetch(`${server.origin}/commands`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      commandId: 'maps-command-1',
      baseRevision: 0,
      command: { op: 'create', collection: 'nodes', value: { id: 'n-x', name: '新图节点' } },
    }),
  });
  assert.equal(commandResponse.status, 200);
  const commandBody = await commandResponse.json();
  const newNode = commandBody.document.nodes.find((node) => node.id === 'n-x');
  assert.equal(newNode.md, `.live-dot-map/maps/${newId}/nodes/n-x/index.md`);

  // 切回 default：新图的节点不出现；磁盘上两张图各自独立
  const switchedResponse = await fetch(`${server.origin}/maps/switch`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mapId: 'default' }),
  });
  assert.equal(switchedResponse.status, 200);
  const switched = await switchedResponse.json();
  assert.equal(switched.activeMap, 'default');
  assert.equal(switched.document.nodes.some((node) => node.id === 'n-x'), false);

  const newDoc = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', newId, 'map.json'), 'utf8'));
  assert.equal(newDoc.nodes.some((node) => node.id === 'n-x'), true);
  const defaultDoc = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
  assert.equal(defaultDoc.nodes.some((node) => node.id === 'n-x'), false);
  assert.equal(await readActiveMap(root), 'default');

  // 改名走 set_meta 命令通道，只改显示名不改目录 id
  const renamedResponse = await fetch(`${server.origin}/maps/rename`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mapId: 'default', name: '主地图' }),
  });
  assert.equal(renamedResponse.status, 200);
  const relisted = await (await fetch(`${server.origin}/maps`, { headers: authHeaders(session) })).json();
  assert.equal(relisted.maps.find((map) => map.id === 'default').name, '主地图');

  // 参数校验
  const invalid = await fetch(`${server.origin}/maps/switch`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mapId: '../escape' }),
  });
  assert.equal(invalid.status, 400);
  const missing = await fetch(`${server.origin}/maps/switch`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mapId: 'nope' }),
  });
  assert.equal(missing.status, 404);
});

test('旧版 Markdown 路径重写到当前地图目录，不在项目根重建老布局', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  await openProject(server, root, session);

  const createdResponse = await fetch(
    `${server.origin}/markdown?path=${encodeURIComponent('.live-dot-map/nodes/legacy.md')}&create=1&title=${encodeURIComponent('旧路径')}`,
    { headers: authHeaders(session) },
  );
  assert.equal(createdResponse.status, 200);
  assert.equal((await createdResponse.json()).created, true);
  assert.equal(
    await readFile(join(root, '.live-dot-map', 'maps', 'default', 'nodes', 'legacy.md'), 'utf8'),
    '# 旧路径\n\n',
  );
  await assert.rejects(access(join(root, '.live-dot-map', 'nodes')));

  const readResponse = await fetch(
    `${server.origin}/markdown?path=${encodeURIComponent('.live-dot-map/nodes/legacy.md')}`,
    { headers: authHeaders(session) },
  );
  assert.equal((await readResponse.json()).content, '# 旧路径\n\n');
});
