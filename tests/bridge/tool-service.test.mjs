import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { MapManager } from '../../src/bridge/map-manager.mjs';
import { ToolService, TOOL_NAMES } from '../../src/bridge/tool-service.mjs';
import { temporaryProject } from './helpers.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function openService(t) {
  const project = await temporaryProject(t, { withMap: false });
  const manager = await MapManager.open({ projectRoot: project.root, shared: project.shared, pollIntervalMs: 0 });
  const service = new ToolService({ mapManager: manager, shared: project.shared, actor: 'agent:test', projectHandle: 'stdio-test' });
  t.after(() => manager.close());
  return { ...project, manager, service };
}

async function createMap(manager, name) {
  const result = await manager.create(name);
  return result.createdMap;
}

async function addNode(service, mapKey, id = 'n1') {
  const context = await service.mapManager.resolve({ mapKey });
  await service.dispatch('map_apply_commands', {
    mapKey,
    documentId: context.documentId,
    baseRevision: context.snapshot.revision,
    commandId: `seed-${mapKey}-${id}`,
    commands: [{
      op: 'create',
      collection: 'nodes',
      value: { id, name: `节点 ${id}`, type: '目的', x: 0, y: 0 },
    }],
  });
}

test('ToolService 暴露固定 24 项工具，未知工具返回结构化 BridgeError', async (t) => {
  const { service } = await openService(t);
  assert.equal(TOOL_NAMES.length, 24);
  assert.equal(new Set(TOOL_NAMES).size, 24);
  await assert.rejects(
    service.dispatch('map_not_a_real_tool'),
    (error) => error?.code === 'UNKNOWN_MCP_TOOL' && error?.status === 404 && typeof error.message === 'string',
  );
});

test('stdio 每次按 active-map 解析：A → map_switch B → 下一次调用只读写 B', async (t) => {
  const { manager, service } = await openService(t);
  const mapA = await createMap(manager, '地图 A');
  const mapB = await createMap(manager, '地图 B');
  await manager.switch(mapA);
  await addNode(service, mapA, 'a-node');
  await addNode(service, mapB, 'b-node');

  const first = await service.dispatch('map_get_context', { query: '节点' });
  assert.equal(first.mapKey, mapA);
  assert.equal(first.objects.some((item) => item.id === 'a-node'), true);

  const switched = await service.dispatch('map_switch', { mapKey: mapB });
  assert.equal(switched.activeMap, mapB);
  const second = await service.dispatch('map_get_context', { query: '节点' });
  assert.equal(second.mapKey, mapB);
  assert.equal(second.objects.some((item) => item.id === 'b-node'), true);
  assert.equal(second.objects.some((item) => item.id === 'a-node'), false);
});

test('map_create 只创建，不自动切换；map_switch 后 map_rename 保持 mapKey 不变', async (t) => {
  const { manager, service } = await openService(t);
  const created = await service.dispatch('map_create', { name: '新地图' });
  assert.equal(created.activeMap, 'default');
  assert.equal((await service.dispatch('map_list')).activeMap, 'default');
  assert.equal((await service.dispatch('map_list')).maps.some((item) => item.id === created.createdMap), true);

  const switched = await service.dispatch('map_switch', { mapKey: created.createdMap });
  assert.equal(switched.activeMap, created.createdMap);
  const renamed = await service.dispatch('map_rename', { mapKey: created.createdMap, name: '重命名地图' });
  assert.equal(renamed.document.mapId, created.documentId);
  assert.equal((await service.dispatch('map_list')).maps.find((item) => item.id === created.createdMap).name, '重命名地图');
});

test('map_apply_commands 拒绝不匹配 documentId，避免写入错误地图', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '契约地图');
  const context = await manager.resolve({ mapKey });
  await assert.rejects(
    service.dispatch('map_apply_commands', {
      mapKey,
      documentId: 'map-document-does-not-match',
      baseRevision: context.snapshot.revision,
      commandId: 'bad-document-id',
      commands: [{ op: 'create', collection: 'nodes', value: { id: 'must-not-write', name: '拒绝' } }],
    }),
    (error) => error?.code === 'DOCUMENT_ID_MISMATCH' && error?.status === 409,
  );
  const after = await manager.resolve({ mapKey });
  assert.equal(after.snapshot.document.nodes.some((node) => node.id === 'must-not-write'), false);
});

test('Bundle Markdown 经 ToolService 完成 read/write/append/create/rename/archive/restore', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '资料包地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'bundle-node');
  const owner = { ownerKind: 'node', ownerId: 'bundle-node' };

  const created = await service.dispatch('map_create_markdown', { ...owner, fileName: 'note.md', content: '# 初稿\n\n正文' });
  assert.equal(created.name, 'note.md');
  let read = await service.dispatch('map_read_markdown', { ...owner, fileName: 'note.md' });
  assert.equal(read.content, '# 初稿\n\n正文');

  const replaced = await service.dispatch('map_write_markdown', { ...owner, fileName: 'note.md', content: '# 修改\n\n版本二', baseEtag: read.etag });
  assert.equal(replaced.content, '# 修改\n\n版本二');
  const appended = await service.dispatch('map_append_markdown', { ...owner, fileName: 'note.md', content: '追加证据', commandId: 'append-note-1' });
  assert.equal(appended.name, 'note.md');
  read = await service.dispatch('map_read_markdown', { ...owner, fileName: 'note.md' });
  assert.match(read.content, /版本二[\s\S]*追加证据/);

  const extra = await service.dispatch('map_create_markdown', { ...owner, fileName: 'extra.md', title: '补充资料' });
  assert.equal(extra.name, 'extra.md');
  const renamed = await service.dispatch('map_rename_bundle_file', { ...owner, from: 'extra.md', to: 'renamed.md' });
  assert.equal(renamed.name, 'renamed.md');

  const archived = await service.dispatch('map_archive_bundle_file', { ...owner, fileName: 'renamed.md' });
  assert.equal(archived.archived, true);
  let listed = await service.dispatch('map_list_bundle_files', { ...owner });
  assert.equal(listed.files.some((file) => file.name === 'renamed.md'), false);
  listed = await service.dispatch('map_list_bundle_files', { ...owner, includeArchived: true });
  assert.equal(listed.files.some((file) => file.name === 'renamed.md' && file.archived), true);
  const restored = await service.dispatch('map_restore_bundle_file', { ...owner, fileName: 'renamed.md' });
  assert.equal(restored.archived, false);
  listed = await service.dispatch('map_list_bundle_files', { ...owner });
  assert.equal(listed.files.some((file) => file.name === 'renamed.md'), true);
});

test('Bundle Asset 经 ToolService 完成 list/import/archive/restore', async (t) => {
  const { root, manager, service } = await openService(t);
  const mapKey = await createMap(manager, '附件地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'asset-node');
  const owner = { ownerKind: 'node', ownerId: 'asset-node' };
  const sourcePath = '.live-dot-map-test-asset.png';
  await writeFile(join(root, sourcePath), PNG_1X1);
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(join(root, sourcePath), { force: true })));

  const imported = await service.dispatch('map_import_asset', { ...owner, sourcePath, fileName: 'evidence.png', mimeType: 'image/png' });
  assert.equal(imported.name, 'evidence.png');
  assert.equal(imported.mimeType, 'image/png');
  let listed = await service.dispatch('map_list_assets', { ...owner });
  assert.equal(listed.assets.some((file) => file.name === 'evidence.png' && file.archived === false), true);

  const archived = await service.dispatch('map_archive_asset', { ...owner, fileName: 'evidence.png' });
  assert.equal(archived.archived, true);
  listed = await service.dispatch('map_list_assets', { ...owner });
  assert.equal(listed.assets.some((file) => file.name === 'evidence.png'), false);
  listed = await service.dispatch('map_list_assets', { ...owner, includeArchived: true });
  assert.equal(listed.assets.some((file) => file.name === 'evidence.png' && file.archived), true);
  const restored = await service.dispatch('map_restore_asset', { ...owner, fileName: 'evidence.png' });
  assert.equal(restored.archived, false);
  listed = await service.dispatch('map_list_assets', { ...owner });
  assert.equal(listed.assets.some((file) => file.name === 'evidence.png'), true);
});

test('归档对象 owner 不进入默认 context，includeHistory 才能重新检索', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '归档上下文地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'archived-node');
  const owner = { ownerKind: 'node', ownerId: 'archived-node' };
  await service.dispatch('map_create_markdown', { ...owner, fileName: 'evidence.md', content: '# 证据\n\n只应在历史中出现' });
  const before = await service.dispatch('map_get_context', { query: '只应在历史中出现' });
  assert.equal(before.markdown.some((item) => item.path.includes('/nodes/archived-node/')), true);

  const context = await manager.resolve({ mapKey });
  await service.dispatch('map_apply_commands', {
    mapKey,
    documentId: context.documentId,
    baseRevision: context.snapshot.revision,
    commandId: 'archive-context-owner',
    commands: [{ op: 'archive', collection: 'nodes', id: 'archived-node', archiveReason: '上下文归档测试' }],
  });
  const current = await service.dispatch('map_get_context', { query: '只应在历史中出现' });
  assert.equal(current.markdown.some((item) => item.path.includes('/nodes/archived-node/')), false);
  const history = await service.dispatch('map_get_context', { query: '只应在历史中出现', includeHistory: true });
  assert.equal(history.markdown.some((item) => item.path.includes('/nodes/archived-node/')), true);
});

test('A2: map_get_context 空 query 默认带出最近书写的非空主文档', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '最近书写地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'recent-node');
  // 通过写内容制造“最近书写”的主人文档（写入会推进 updatedAt）。
  await service.dispatch('map_write_markdown', {
    ownerKind: 'node', ownerId: 'recent-node', fileName: 'index.md',
    content: '# 最近节点\n\n最新排障正文', baseEtag: (await service.dispatch('map_read_markdown', { ownerKind: 'node', ownerId: 'recent-node' })).etag,
  });

  const emptyQuery = await service.dispatch('map_get_context', {});
  assert.ok(Array.isArray(emptyQuery.markdown) && emptyQuery.markdown.length > 0, '空 query 应返回最近书写的 markdown');
  assert.equal(emptyQuery.markdown.some((item) => item.path.includes('/nodes/recent-node/index.md') && item.snippet.includes('最新排障正文')), true);
  // 带 query 的 markdown 仍是检索字段，空 query 兜底不能污染明确检索语义。
  const hit = await service.dispatch('map_get_context', { query: '排障正文' });
  assert.equal(hit.markdown.some((item) => item.path.includes('/nodes/recent-node/index.md')), true);
});

test('C3/C4: 人类 md 写入进 humanUpdates，ack 后剔除', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '人类输入信号地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'signal-node');
  const { HumanMdUpdateLog } = await import('../../src/bridge/human-md-updates.mjs');
  const context = await manager.resolve({ mapKey });
  const log = new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey });
  await log.record({
    path: `.live-dot-map/maps/${mapKey}/routes/e1/index.md`,
    etag: 's1',
    mtime: '2026-08-21T06:00:00.000Z',
    snippet: '# 方案1 今天上山打老虎',
  });

  let ctx = await service.dispatch('map_get_context', {});
  const mdUpdate = ctx.projection.humanUpdates.find((item) => String(item.id).startsWith('md:'));
  assert.ok(mdUpdate, 'humanUpdates 应包含 md 未确认条目');
  assert.match(String(mdUpdate.text), /今天上山打老虎/);
  assert.equal(mdUpdate.attention, 'new');

  // 单独 ack md 条目（无标注参与）也应闭环。
  await service.dispatch('map_ack_human_updates', { ids: [mdUpdate.id], summary: `已读取 ${mdUpdate.id}` });
  ctx = await service.dispatch('map_get_context', {});
  assert.equal(ctx.projection.humanUpdates.some((item) => String(item.id).startsWith('md:')), false, 'ack 后不再出现');

  // map_list_human_updates 也合并 md 条目（未 ack 时）。
  await log.record({
    path: `.live-dot-map/maps/${mapKey}/routes/e1/index.md`,
    etag: 's2',
    mtime: '2026-08-21T06:07:00.000Z',
    snippet: '# 方案1 二次输入',
  });
  const listed = await service.dispatch('map_list_human_updates', {});
  assert.equal(listed.updates.some((item) => String(item.id).startsWith('md:') && /二次输入/.test(String(item.text))), true);
});

test('B2: 建节点命令提交成功即原子补建 index.md，无“有记录无文件”半状态', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '原子资料包地图');
  await manager.switch(mapKey);
  const context = await manager.resolve({ mapKey });
  await service.dispatch('map_apply_commands', {
    mapKey,
    documentId: context.documentId,
    baseRevision: context.snapshot.revision,
    commandId: 'seed-atomic-node',
    commands: [{ op: 'create', collection: 'nodes', value: { id: 'atomic-node', name: '原子节点', type: '目标', x: 1, y: 2 } }],
  });

  const read = await service.dispatch('map_read_markdown', { ownerKind: 'node', ownerId: 'atomic-node' });
  assert.equal(read.isIndex, true);
  assert.equal(read.archived, false);
  // 幂等：对同一 owner 二次 ensureIndex 原样返回（不覆盖、不抛错）。
  const ensuredAgain = await (await manager.resolve({ mapKey })).bundleStore.ensureIndex({ ownerKind: 'node', ownerId: 'atomic-node', title: '原子节点' });
  assert.equal(ensuredAgain.name, 'index.md');
  const readAgain = await service.dispatch('map_read_markdown', { ownerKind: 'node', ownerId: 'atomic-node' });
  assert.equal(readAgain.etag, read.etag);
});
