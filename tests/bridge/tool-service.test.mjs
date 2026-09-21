import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('ToolService 暴露固定 25 项工具，未知工具返回结构化 BridgeError', async (t) => {
  const { service } = await openService(t);
  assert.equal(TOOL_NAMES.length, 25);
  assert.equal(new Set(TOOL_NAMES).size, 25);
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
  assert.equal(read.content, '<!-- @author: agent:test -->\n# 初稿\n\n正文\n<!-- /@author -->\n');

  const replaced = await service.dispatch('map_write_markdown', { ...owner, fileName: 'note.md', content: '# 修改\n\n版本二', baseEtag: read.etag, allowContentRemoval: true });
  assert.equal(replaced.content, '<!-- @author: agent:test -->\n# 修改\n\n版本二\n<!-- /@author -->\n');
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

test('map_write_markdown 默认追加式：删已有行被拒，显式 allowContentRemoval 才放行（n12）', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '写入契约地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'contract-node');
  const owner = { ownerKind: 'node', ownerId: 'contract-node' };
  await service.dispatch('map_create_markdown', { ...owner, fileName: 'note.md', content: '# 人类原话\n\n第一行\n第二行', wrapAuthor: false });

  // 1) 纯追加式替换（旧行全部保留）不需要标志
  let read = await service.dispatch('map_read_markdown', { ...owner, fileName: 'note.md' });
  const superset = await service.dispatch('map_write_markdown', { ...owner, fileName: 'note.md', content: '# 人类原话\n\n第一行\n第二行\n第三行（agent 追加）', baseEtag: read.etag });
  assert.equal(superset.content.includes('第三行'), true);

  // 2) 删除已有行被拒，且原文不被破坏
  read = await service.dispatch('map_read_markdown', { ...owner, fileName: 'note.md' });
  await assert.rejects(
    service.dispatch('map_write_markdown', { ...owner, fileName: 'note.md', content: '# 只剩标题\n', baseEtag: read.etag }),
    (error) => error?.code === 'REWRITE_REMOVES_CONTENT' && error?.status === 409,
  );
  read = await service.dispatch('map_read_markdown', { ...owner, fileName: 'note.md' });
  assert.equal(read.content.includes('第二行'), true);

  // 3) 显式 allowContentRemoval 放行
  const rewritten = await service.dispatch('map_write_markdown', { ...owner, fileName: 'note.md', content: '# 只剩标题\n', baseEtag: read.etag, allowContentRemoval: true, wrapAuthor: false });
  assert.equal(rewritten.content, '# 只剩标题\n');
});

test('map_read_asset 返回路径+元数据；文本带 content；includeContent 出 base64', async (t) => {
  const { root, manager, service } = await openService(t);
  const mapKey = await createMap(manager, '资产读取地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'asset-read-node');
  const owner = { ownerKind: 'node', ownerId: 'asset-read-node' };
  const sourcePath = '.live-dot-map-test-asset.png';
  await writeFile(join(root, sourcePath), PNG_1X1);
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(join(root, sourcePath), { force: true })));
  await service.dispatch('map_import_asset', { ...owner, sourcePath, fileName: 'evidence.png', mimeType: 'image/png' });

  // 二进制默认只给路径+元数据，不搬运内容
  const read = await service.dispatch('map_read_asset', { ...owner, fileName: 'evidence.png' });
  assert.equal(read.path, 'nodes/asset-read-node/evidence.png');
  assert.equal(read.mimeType, 'image/png');
  assert.equal('content' in read, false);
  assert.equal('base64' in read, false);
  // 显式 includeContent 才出 base64
  const withContent = await service.dispatch('map_read_asset', { ...owner, fileName: 'evidence.png', includeContent: true });
  assert.equal(typeof withContent.base64, 'string');
  assert.ok(withContent.base64.length > 40);
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

test('map_import_asset 支持导入项目外绝对路径资产（如 zip 和 py 脚本）', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '通用资产地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'external-asset-node');
  const owner = { ownerKind: 'node', ownerId: 'external-asset-node' };

  const outsideDir = await mkdtemp(join(tmpdir(), 'live-dot-map-outside-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(outsideDir, { recursive: true, force: true })));

  // 创建外部 zip 文件（PK0304）
  const zipPath = join(outsideDir, 'dataset.zip');
  const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
  await writeFile(zipPath, zipHeader);

  // 创建外部 py 脚本
  const pyPath = join(outsideDir, 'verify.py');
  await writeFile(pyPath, 'print("simulation completed")\n');

  // 1. 导入外部绝对路径 zip
  const importedZip = await service.dispatch('map_import_asset', { ...owner, sourcePath: zipPath });
  assert.equal(importedZip.name, 'dataset.zip');
  assert.equal(importedZip.mimeType, 'application/zip');
  assert.equal(importedZip.disposition, 'attachment');

  // 2. 导入外部绝对路径 py
  const importedPy = await service.dispatch('map_import_asset', { ...owner, sourcePath: pyPath });
  assert.equal(importedPy.name, 'verify.py');
  assert.equal(importedPy.mimeType, 'text/x-python; charset=utf-8');
  assert.equal(importedPy.disposition, 'attachment');

  const assets = await service.dispatch('map_list_assets', { ...owner });
  assert.ok(assets.assets.some((a) => a.name === 'dataset.zip'));
  assert.ok(assets.assets.some((a) => a.name === 'verify.py'));
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
    allowContentRemoval: true,
    allowIndexModification: true,
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

test('map_create_markdown 与 map_append_markdown 自动为 Agent 写入包裹成对 @author 闭合块，减少 Agent 负担', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '自动标记地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'agent-tag-node');
  const owner = { ownerKind: 'node', ownerId: 'agent-tag-node' };

  // 1. map_create_markdown 传入未标记的方案内容，系统自动补齐成对 @author 闭合标签
  await service.dispatch('map_create_markdown', {
    ...owner,
    fileName: '01-proposal.md',
    content: '# 方案一：全量记忆包格式\n\n核心内容',
  });
  let read = await service.dispatch('map_read_markdown', { ...owner, fileName: '01-proposal.md' });
  assert.match(read.content, /^<!-- @author: agent:test -->\n# 方案一：全量记忆包格式\n\n核心内容\n<!-- \/@author -->/);

  // 2. 若 Agent 已自行包含 @author 标签，绝不重复包裹
  await service.dispatch('map_create_markdown', {
    ...owner,
    fileName: '02-already-tagged.md',
    content: '<!-- @author: agent:custom -->\n# 自带标签\n<!-- /@author -->\n',
  });
  read = await service.dispatch('map_read_markdown', { ...owner, fileName: '02-already-tagged.md' });
  assert.equal(read.content, '<!-- @author: agent:custom -->\n# 自带标签\n<!-- /@author -->\n');

  // 3. map_append_markdown 自动包裹追加段落，不污染前文
  await service.dispatch('map_append_markdown', {
    ...owner,
    fileName: '01-proposal.md',
    content: '## 新增补充要点',
    commandId: 'append-test-1',
  });
  read = await service.dispatch('map_read_markdown', { ...owner, fileName: '01-proposal.md' });
  assert.match(read.content, /<!-- @author: agent:test -->\n## 新增补充要点\n<!-- \/@author -->/);

  // 4. map_write_markdown 自动包裹 Agent 覆盖写入的内容（覆盖非 Agent 标记内容传 allowHumanContentOverride）
  const created3 = await service.dispatch('map_create_markdown', {
    ...owner,
    fileName: '03-written.md',
    content: '# 初始内容\n',
    wrapAuthor: false,
  });
  await service.dispatch('map_write_markdown', {
    ...owner,
    fileName: '03-written.md',
    content: '# 整篇方案内容\n\n测试',
    baseEtag: created3.etag,
    allowContentRemoval: true,
    allowHumanContentOverride: true,
  });
  read = await service.dispatch('map_read_markdown', { ...owner, fileName: '03-written.md' });
  assert.match(read.content, /^<!-- @author: agent:test -->\n# 整篇方案内容\n\n测试\n<!-- \/@author -->/);
});

test('全域人类原声保护与 index.md 节点索引中枢：Agent 追加放行、改写保护与资料包索引联动', async (t) => {
  const { manager, service } = await openService(t);
  const mapKey = await createMap(manager, '全域原声保护地图');
  await manager.switch(mapKey);
  await addNode(service, mapKey, 'hub-node');

  const owner = { ownerKind: 'node', ownerId: 'hub-node' };

  // 1. 模拟人类在 index.md 中写下了原始问题与诉求
  const initial = await service.dispatch('map_read_markdown', { ...owner, fileName: 'index.md' });
  const humanPrompt = '# hub-node\n\n请帮我设计一个高可用的分布式索引服务，要求支持秒级故障自愈。';
  await (await manager.resolve({ mapKey })).bundleStore.replaceMarkdown({
    ...owner,
    fileName: 'index.md',
    content: humanPrompt,
    baseEtag: initial.etag,
  });

  const readHuman = await service.dispatch('map_read_markdown', { ...owner, fileName: 'index.md' });
  assert.equal(readHuman.content, humanPrompt);

  // 2. Agent 往 index.md 追加内容（map_append_markdown）：放行！
  // 自动包裹成对 @author 闭合块，且上方人类原声完好无损
  const appended = await service.dispatch('map_append_markdown', {
    ...owner,
    fileName: 'index.md',
    content: '## 🤖 Agent 方案建议\n建议采用基于 Raft 的一致性状态机实现。',
    commandId: 'cmd-append-solution-1',
  });
  assert.ok(appended.etag);

  const afterAppend = await service.dispatch('map_read_markdown', { ...owner, fileName: 'index.md' });
  assert.match(afterAppend.content, /# hub-node\n\n请帮我设计一个高可用的分布式索引服务/);
  assert.match(afterAppend.content, /<!-- @author: agent:test -->\n## 🤖 Agent 方案建议\n建议采用基于 Raft 的一致性状态机实现。\n<!-- \/@author -->/);

  // 3. Agent 企图通过 map_write_markdown 抹除/删减人类文字：坚决拦截抛出 HUMAN_CONTENT_PROTECTED
  await assert.rejects(
    service.dispatch('map_write_markdown', {
      ...owner,
      fileName: 'index.md',
      content: '# 企图篡改抹除人类原声\n\n直接替换全文',
      baseEtag: afterAppend.etag,
      allowContentRemoval: true,
    }),
    (err) => err.code === 'HUMAN_CONTENT_PROTECTED' && err.message.includes('人类原始文本'),
    '应拒绝抹除人类原声'
  );

  // 4. Agent 在完整保留人类原声的前提下，更新自身 Agent 块：放行！
  const preservedContent = `${humanPrompt}\n\n<!-- @author: agent:test -->\n## 🤖 Agent 方案建议（精化版）\n更新为 Multi-Raft 分区架构。\n<!-- /@author -->\n`;
  const updated = await service.dispatch('map_write_markdown', {
    ...owner,
    fileName: 'index.md',
    content: preservedContent,
    baseEtag: afterAppend.etag,
    allowContentRemoval: true,
  });
  assert.ok(updated.etag);
  const afterUpdate = await service.dispatch('map_read_markdown', { ...owner, fileName: 'index.md' });
  assert.equal(afterUpdate.content, preservedContent);

  // 5. 全域保护：在资料包子文档（如 01-notes.md）中若有人类书写内容，Agent 试图覆盖同样被拦截
  const noteFile = await service.dispatch('map_create_markdown', {
    ...owner,
    fileName: '01-notes.md',
    content: '# 架构要点\n\n人类补充：注意跨机房延迟。',
    wrapAuthor: false, // 模拟人类书写，不带 agent tag
  });
  await assert.rejects(
    service.dispatch('map_write_markdown', {
      ...owner,
      fileName: '01-notes.md',
      content: '# 架构要点\n\nAgent 抹掉了人类补充的延迟要求',
      baseEtag: noteFile.etag,
      allowContentRemoval: true,
    }),
    (err) => err.code === 'HUMAN_CONTENT_PROTECTED',
    '子文档的人类原声同样受全域保护'
  );

  // 6. 资料包索引自动联动：创建子文档后，index.md 自动登记该文档的索引条目
  const indexWithBundle = await service.dispatch('map_read_markdown', { ...owner, fileName: 'index.md' });
  assert.match(indexWithBundle.content, /## 📁 节点资料包索引/);
  assert.match(indexWithBundle.content, /\[01-notes\.md\]\(01-notes\.md\)/);

  // 7. 用户明确指令要求覆盖（allowHumanContentOverride: true）时允许改写
  const overridden = await service.dispatch('map_write_markdown', {
    ...owner,
    fileName: '01-notes.md',
    content: '# 彻底重写文档\n\n用户明确要求',
    baseEtag: noteFile.etag,
    allowContentRemoval: true,
    allowHumanContentOverride: true,
  });
  assert.ok(overridden.etag);
});


test('agent 改节点名进入通知流，map_list_human_updates 可见（结构性改名可确认）', async (t) => {
  const { service, manager, root } = await openService(t);
  const mapKey = await createMap(manager, '改名通知');
  await addNode(service, mapKey, 'n1');
  let context = await service.mapManager.resolve({ mapKey });
  // agent:test 改自建节点名（放行）→ 必须产生待确认通知
  await service.dispatch('map_apply_commands', {
    mapKey,
    documentId: context.documentId,
    baseRevision: context.snapshot.revision,
    commandId: 'rename-1',
    commands: [{ op: 'update', collection: 'nodes', id: 'n1', patch: { name: '被 agent 改过的名' } }],
  });
  context = await service.mapManager.resolve({ mapKey });
  const updates = await service.dispatch('map_list_human_updates', { mapKey });
  const entry = (updates.updates || updates).find?.((item) => String(item.id || item.path || '').includes('struct:nodes/n1/name'))
    || (Array.isArray(updates) ? updates.find((item) => String(item.id || '').includes('struct:nodes/n1/name')) : null);
  assert.ok(entry, `应存在 struct:nodes/n1/name 通知，实际: ${JSON.stringify(updates).slice(0, 300)}`);
  assert.match(String(entry.snippet || entry.text || ''), /agent:test/);
  // human 创建的节点（模拟：用另一个 human actor 的 service 不必要——reducer 单测已覆盖拒绝路径）
  const { HumanMdUpdateLog } = await import('../../src/bridge/human-md-updates.mjs');
  const log = new HumanMdUpdateLog({ projectRoot: root, mapKey });
  const pending = await log.unacknowledged();
  assert.ok(pending.some((item) => item.path === 'struct:nodes/n1/name'), '底层日志应含结构性改名记录');
});

test('owner+path 同传时 path 生效：读写的不再是 index.md（修复静默回落）', async (t) => {
  const { service, manager } = await openService(t);
  const mapKey = await createMap(manager, '路径修复');
  await addNode(service, mapKey, 'n1');
  // 用 owner + path 追加到一个具名文件
  await service.dispatch('map_append_markdown', {
    mapKey, ownerKind: 'node', ownerId: 'n1', path: `.live-dot-map/maps/${mapKey}/nodes/n1/09-测试文档.md`,
    content: '路径修复验证内容', commandId: 'path-fix-1',
  });
  // 同样以 owner + path 读回，必须读到该文件而不是 index.md
  const read = await service.dispatch('map_read_markdown', {
    mapKey, ownerKind: 'node', ownerId: 'n1', path: `.live-dot-map/maps/${mapKey}/nodes/n1/09-测试文档.md`,
  });
  assert.equal(read.mapKey, mapKey, '响应应携带 mapKey');
  assert.ok(String(read.content).includes('路径修复验证内容'), '应读到 path 指向的文件');
});

test('对不存在的 owner 读写作出 OWNER_NOT_FOUND，绝不落盘孤儿目录', async (t) => {
  const { service, manager, root } = await openService(t);
  const mapKey = await createMap(manager, '孤儿防护');
  await assert.rejects(
    service.dispatch('map_append_markdown', { mapKey, ownerKind: 'node', ownerId: 'nX', content: '不应落盘', commandId: 'orphan-1' }),
    (error) => error.code === 'OWNER_NOT_FOUND' && error.status === 404,
  );
  const orphanDir = join(root, '.live-dot-map', 'maps', mapKey, 'nodes', 'nX');
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(orphanDir), false, '磁盘不得出现孤儿目录');
});

test('map_validate 扫出孤儿资料包目录', async (t) => {
  const { service, manager, root } = await openService(t);
  const mapKey = await createMap(manager, '孤儿扫描');
  await addNode(service, mapKey, 'n1');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const orphanDir = join(root, '.live-dot-map', 'maps', mapKey, 'nodes', 'nGhost');
  await mkdir(orphanDir, { recursive: true });
  await writeFile(join(orphanDir, 'index.md'), '# ghost', 'utf8');
  const result = await service.dispatch('map_validate', { mapKey });
  assert.ok(Array.isArray(result.orphanBundles), '应返回 orphanBundles 字段');
  assert.ok(result.orphanBundles.includes('nodes/nGhost'), `应扫出 nodes/nGhost，实际: ${JSON.stringify(result.orphanBundles)}`);
});
