import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { MapManager } from '../../src/bridge/map-manager.mjs';
import { LEGACY_TOOL_DEFINITIONS, TOOL_DEFINITIONS, ToolService } from '../../src/bridge/tool-service.mjs';
import { resetAgentSessions } from '../../src/bridge/agent-tools.mjs';
import { temporaryProject } from './helpers.mjs';

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

async function openService(t, actor = 'agent:test') {
  const project = await temporaryProject(t, { withMap: false });
  const manager = await MapManager.open({ projectRoot: project.root, shared: project.shared, pollIntervalMs: 0 });
  const service = new ToolService({ mapManager: manager, shared: project.shared, actor, projectHandle: 'agent-tools-test' });
  t.after(() => manager.close());
  const mapKey = (await manager.create('Agent 工具地图')).createdMap;
  await manager.switch(mapKey);
  resetAgentSessions();
  return { ...project, manager, service, mapKey };
}

/** 70 个 md / 12 个节点的夹具，接近真实地图规模，用来卡注入预算。 */
async function seedLargeMap(service) {
  for (let index = 1; index <= 12; index += 1) {
    await service.dispatch('map_write', {
      node: { name: `节点${index}${index === 3 ? ' 抖音爆款分析' : ''}`, kind: index % 4 === 0 ? 'problem' : 'goal' },
      content: `# 节点${index}\n\n${'这是一段较长的正文，用来模拟真实记录。'.repeat(20)}\n`,
    });
  }
  for (let index = 1; index <= 58; index += 1) {
    const node = `n${(index % 12) + 1}`;
    await service.dispatch('map_write', {
      path: `nodes/${node}/note-${index}.md`,
      content: `# 补充 ${index}\n\n${index === 7 ? '钢琴配乐 暖色 封面 播放量最高。' : ''}${'普通补充材料。'.repeat(30)}\n`,
    });
  }
}

test('tools/list 只发布 5 个工具且 ≤ 3KB，旧 25 个工具不再发布', () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), ['map_look', 'map_read', 'map_write', 'analysis_run', 'map_manage']);
  assert.ok(bytes({ tools: TOOL_DEFINITIONS }) <= 3 * 1024, `tools/list ${bytes({ tools: TOOL_DEFINITIONS })}B`);
  assert.equal(LEGACY_TOOL_DEFINITIONS.length, 25);
  for (const tool of TOOL_DEFINITIONS) assert.equal(JSON.stringify(tool).includes('projectRoot'), false);
});

test('map_write node 新建节点并写入 index.md，map_look 能按关键词找到它', async (t) => {
  const { service, mapKey } = await openService(t);
  const created = await service.dispatch('map_write', { node: { name: '抖音爆款分析', kind: 'problem' }, content: '先收集 20 条对标视频。' });
  assert.equal(created.ok, true);
  assert.equal(created.node, 'n1');
  assert.equal(created.path, 'nodes/n1/index.md');
  assert.equal(created.mode, 'append');

  const looked = await service.dispatch('map_look', { query: '抖音' });
  assert.equal(looked.map, mapKey);
  assert.deepEqual(looked.cols, ['id', 'name', 'kind', 'path', 'why']);
  const row = looked.items.find((item) => item[0] === 'n1');
  assert.ok(row, JSON.stringify(looked));
  assert.equal(row[2], 'problem');
  assert.equal(row[3], 'nodes/n1/index.md');
});

test('map_read 支持节点 id 与路径；同会话同 etag 第二次只回 unchanged，force 强制重读', async (t) => {
  const { service } = await openService(t);
  await service.dispatch('map_write', { node: { name: '读取测试' }, content: '第一条结论' });
  const first = await service.dispatch('map_read', { path: 'n1', sessionId: 's1' });
  assert.equal(first.path, 'nodes/n1/index.md');
  assert.match(first.content, /第一条结论/);
  const again = await service.dispatch('map_read', { path: 'nodes/n1/index.md', sessionId: 's1' });
  assert.deepEqual({ ...again, hint: undefined }, { path: 'nodes/n1/index.md', etag: first.etag, unchanged: true, hint: undefined });
  assert.match(again.hint, /force/);
  assert.ok(bytes(again) <= 192);
  const forced = await service.dispatch('map_read', { path: 'n1', sessionId: 's1', force: true });
  assert.match(forced.content, /第一条结论/);
  const otherSession = await service.dispatch('map_read', { path: 'n1', sessionId: 's2' });
  assert.match(otherSession.content, /第一条结论/);

  await service.dispatch('map_write', { path: 'n1', content: '第二条结论' });
  const changed = await service.dispatch('map_read', { path: 'n1', sessionId: 's1' });
  assert.match(changed.content, /第二条结论/);
});

test('map_write 默认追加不覆盖；带 baseEtag 才整文替换；人类原文仍受保护', async (t) => {
  const { service, root, mapKey } = await openService(t);
  await service.dispatch('map_write', { node: { name: '写入测试' } });
  const indexPath = join(root, '.live-dot-map', 'maps', mapKey, 'nodes', 'n1', 'index.md');
  await writeFile(indexPath, '# 写入测试\n\n人类写的原话\n', 'utf8');

  const appended = await service.dispatch('map_write', { path: 'nodes/n1/index.md', content: 'Agent 补充' });
  assert.equal(appended.mode, 'append');
  const after = await service.dispatch('map_read', { path: 'n1', force: true });
  assert.match(after.content, /人类写的原话/);
  assert.match(after.content, /Agent 补充/);
  assert.match(after.content, /@author: agent:test/);

  await assert.rejects(
    service.dispatch('map_write', { path: 'n1', content: '全部替换掉', baseEtag: after.etag, allowContentRemoval: true }),
    (error) => error.code === 'HUMAN_CONTENT_PROTECTED' && !/map_append_markdown/.test(error.message) && /map_write/.test(error.message),
  );

  const created = await service.dispatch('map_write', { path: 'n1/方案.md', content: '# 方案\n\n第一版' });
  assert.equal(created.mode, 'create');
  assert.equal(created.path, 'nodes/n1/方案.md');
  const listed = await service.dispatch('map_read', { path: 'nodes/n1/' });
  assert.deepEqual(listed.files.map((file) => file.name).sort(), ['index.md', '方案.md'].sort());
});

test('map_write 冲突报错不带整份正文，提示先 map_read', async (t) => {
  const { service } = await openService(t);
  await service.dispatch('map_write', { node: { name: '冲突测试' }, content: '原文' });
  await assert.rejects(
    service.dispatch('map_write', { path: 'n1', content: '# 冲突测试\n\n新文', baseEtag: 'stale-etag', allowContentRemoval: true }),
    (error) => error.code === 'MARKDOWN_CONFLICT' && /map_read/.test(error.message) && error.details?.current?.content === undefined,
  );
});

test('参数错误时报错带正确用法', async (t) => {
  const { service } = await openService(t);
  await assert.rejects(service.dispatch('map_read', {}), (error) => error.code === 'PATH_REQUIRED' && /用法：map_read/.test(error.message));
  await assert.rejects(service.dispatch('map_read', { path: 'nope' }), (error) => error.code === 'OWNER_NOT_FOUND' && /map_look/.test(error.message));
  await assert.rejects(service.dispatch('map_manage', { action: 'purge' }), (error) => error.code === 'MANAGE_ACTION_UNKNOWN' && /maps\|create_map/.test(error.message));
  await assert.rejects(service.dispatch('map_write', {}), (error) => error.code === 'WRITE_NOTHING');
  await assert.rejects(service.dispatch('map_get_context_typo'), (error) => error.code === 'UNKNOWN_MCP_TOOL' && /map_look/.test(error.message));
});

test('ack 确认人类标注；map_look 列出待确认的人类标注 id', async (t) => {
  const { service, manager, mapKey } = await openService(t);
  await service.dispatch('map_write', { node: { name: '标注测试' } });
  const context = await manager.resolve({ mapKey });
  await context.store.execute({
    projectId: context.documentId,
    baseRevision: context.snapshot.revision,
    commandId: 'human-ann-1',
    actor: 'human',
    sessionId: 'human-session',
    commands: [{ op: 'create', collection: 'anns', value: { id: 'a1', text: '请先看这里', target: { kind: 'node', id: 'n1' } } }],
  });
  const looked = await service.dispatch('map_look', {});
  assert.deepEqual(looked.human, ['a1']);
  const annotation = await service.dispatch('map_read', { path: 'a1' });
  assert.equal(annotation.text, '请先看这里');
  assert.equal(annotation.on, 'nodes/n1/index.md');
  assert.equal(annotation.pending, true);
  const acked = await service.dispatch('map_write', { ack: ['a1'] });
  assert.deepEqual(acked.acked, ['a1']);
  const afterAck = await service.dispatch('map_read', { path: 'a1' });
  assert.equal(afterAck.by, 'human');
  assert.equal(afterAck.pending, undefined);
  const after = await service.dispatch('map_look', {});
  assert.equal(after.human, undefined);
});

test('map_manage 覆盖地图与资料包的低频管理', async (t) => {
  const { service, mapKey } = await openService(t);
  const maps = await service.dispatch('map_manage', { action: 'maps' });
  assert.equal(maps.active, mapKey);
  assert.ok(maps.maps.some(([id]) => id === mapKey));
  await service.dispatch('map_write', { node: { name: '管理测试' } });
  await service.dispatch('map_write', { path: 'n1/草稿.md', content: '草稿' });
  assert.deepEqual(await service.dispatch('map_manage', { action: 'rename_file', path: 'n1/草稿.md', to: '定稿.md' }), { ok: true });
  assert.deepEqual(await service.dispatch('map_manage', { action: 'archive', path: 'n1/定稿.md' }), { ok: true });
  const files = await service.dispatch('map_manage', { action: 'files', path: 'n1', includeArchived: true });
  assert.ok(files.files.some((file) => file.name === '定稿.md' && file.archived));
  assert.deepEqual(await service.dispatch('map_manage', { action: 'restore', path: 'n1/定稿.md' }), { ok: true });
  const validation = await service.dispatch('map_manage', { action: 'validate' });
  assert.equal(validation.ok, true);
});

test('analysis_run 对资料包 CSV 做 describe / group / top，小样本标记样本不足', async (t) => {
  const { service, root } = await openService(t);
  await service.dispatch('map_write', { node: { name: '数据节点' } });
  const lines = ['id,音乐,色调,播放'];
  for (let index = 1; index <= 20; index += 1) {
    const piano = index <= 8;
    lines.push(`v${index},${piano ? '钢琴' : '流行'},${index % 2 ? '暖' : '冷'},${piano ? `${40 + index}万` : String(100000 + index * 1000)}`);
  }
  lines.push('v21,民谣,暖,"1,200"');
  const source = join(root, 'douyin.csv');
  await writeFile(source, `${lines.join('\n')}\n`, 'utf8');
  const imported = await service.dispatch('map_manage', { action: 'import', path: 'n1', sourcePath: source });
  assert.equal(imported.path, 'nodes/n1/douyin.csv');

  const described = await service.dispatch('analysis_run', { path: 'nodes/n1/douyin.csv', op: 'describe' });
  assert.equal(described.rows, 21);
  assert.equal(described.result.find((item) => item.field === '播放').type, 'num');

  const grouped = await service.dispatch('analysis_run', { path: 'n1/douyin.csv', op: 'group', params: { by: '音乐', metric: '播放' } });
  assert.equal(grouped.result[0].key, '钢琴');
  assert.equal(grouped.agg, 'median');
  assert.equal(grouped.result.find((item) => item.key === '民谣').flag, '样本不足');
  assert.match(grouped.summary, /钢琴/);

  const topped = await service.dispatch('analysis_run', { path: 'n1/douyin.csv', op: 'top', params: { metric: '播放', ratio: 0.2 } });
  assert.equal(topped.groups.top, 4);
  assert.equal(topped.result[0].field, '音乐');
  assert.equal(topped.result.some((item) => item.field === 'id'), false, '每行一个值的 id 列不参与对比');
  assert.ok(bytes(topped) <= 2048, `${bytes(topped)}B`);

  await assert.rejects(
    service.dispatch('analysis_run', { path: 'n1/douyin.csv', op: 'group', params: { by: '不存在' } }),
    (error) => error.code === 'ANALYSIS_FIELD_NOT_FOUND' && /可用字段/.test(error.message),
  );
});

test('注入预算：70 个 md / 12 个节点时 map_look ≤ 1.5KB，带关键词仍 ≤ 1.5KB 且不凑数', async (t) => {
  const { service } = await openService(t);
  await seedLargeMap(service);
  const overview = await service.dispatch('map_look', {});
  assert.ok(bytes(overview) <= 1536, `map_look 空查询 ${bytes(overview)}B`);
  assert.ok(overview.items.length <= 5);
  const legacy = await service.dispatch('map_get_context', {});
  assert.ok(bytes(legacy) > bytes(overview) * 3, `旧 get_context ${bytes(legacy)}B vs look ${bytes(overview)}B`);

  const focused = await service.dispatch('map_look', { query: '钢琴配乐' });
  assert.ok(bytes(focused) <= 1536, `map_look 关键词 ${bytes(focused)}B`);
  assert.ok(focused.items.some((item) => item[3] === 'nodes/n8/note-7.md'), JSON.stringify(focused));
  for (const item of focused.items) assert.notEqual(item[4], '', '每条都要有理由');
});
