import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { MapManager } from '../../src/bridge/map-manager.mjs';
import { ToolService } from '../../src/bridge/tool-service.mjs';
import { resetAgentSessions } from '../../src/bridge/agent-tools.mjs';
import { META_FILE, bodyVersion, parseMeta, reconcile, referenceLines } from '../../src/bridge/agent-meta.mjs';
import { temporaryProject } from './helpers.mjs';

async function openService(t) {
  const project = await temporaryProject(t, { withMap: false });
  const manager = await MapManager.open({ projectRoot: project.root, shared: project.shared, pollIntervalMs: 0 });
  const service = new ToolService({ mapManager: manager, shared: project.shared, actor: 'agent:test', projectHandle: 'agent-meta-test' });
  t.after(() => manager.close());
  const mapKey = (await manager.create('元数据地图')).createdMap;
  await manager.switch(mapKey);
  resetAgentSessions();
  const nodeDir = (id) => join(project.root, '.live-dot-map', 'maps', mapKey, 'nodes', id);
  return { ...project, manager, service, mapKey, nodeDir };
}

/** 新建节点 n1 并导入一份 CSV，返回 CSV 文件名。 */
async function seedNode(service, root) {
  await service.dispatch('map_write', { node: { name: '抖音数据' }, content: '# 抖音数据\n\n![](videos.csv)\n上面是 6 月采集的 20 条视频播放数据\n' });
  const source = join(root, 'videos.csv');
  await writeFile(source, '标题,播放\na,1\nb,2\n', 'utf8');
  await service.dispatch('map_manage', { action: 'import', path: 'n1', sourcePath: source });
  return 'videos.csv';
}

test('缺摘要 → 补摘要 → 目录显示；正文变了标过期', async (t) => {
  const { service } = await openService(t);
  const created = await service.dispatch('map_write', { node: { name: '抖音数据' }, content: '正文第一段' });
  assert.match(created.hint, /meta:\{summary/);
  assert.equal((await service.dispatch('map_read', { path: 'n1' })).meta, '缺摘要');
  const before = await service.dispatch('map_look', {});
  assert.deepEqual(before.cols, ['id', 'name', 'kind', 'path', 'summary', 'files']);
  assert.equal(before.items[0][4], '正文第一段', '没有元数据时用正文第一段兜底');

  const wrote = await service.dispatch('map_write', { path: 'n1', meta: { summary: '6 月抖音视频播放数据与结论' } });
  assert.deepEqual(wrote.meta, { path: `nodes/n1/${META_FILE}`, wrote: ['summary'] });
  assert.equal((await service.dispatch('map_read', { path: 'n1', force: true })).meta, undefined);
  assert.equal((await service.dispatch('map_look', {})).items[0][4], '6 月抖音视频播放数据与结论');

  await service.dispatch('map_write', { path: 'n1', content: '新增一段结论' });
  assert.equal((await service.dispatch('map_read', { path: 'n1', force: true })).meta, '摘要过期');
  assert.match((await service.dispatch('map_look', {})).items[0][4], /（过期）$/);
});

test('文件说明：列文件给引用处原文；写说明后列出；元数据命中指回主文档；不进 index.md', async (t) => {
  const { service, root, nodeDir } = await openService(t);
  const csv = await seedNode(service, root);
  const listed = await service.dispatch('map_read', { path: 'nodes/n1/' });
  assert.equal(listed.files.find((row) => row[0] === csv)[3], '引用处：上面是 6 月采集的 20 条视频播放数据');
  assert.equal((await service.dispatch('map_read', { path: `nodes/n1/${csv}` })).meta, '无说明');

  await service.dispatch('map_write', { path: 'n1', meta: { files: { [csv]: '对标账号视频数据，按播放排序' } } });
  const after = await service.dispatch('map_read', { path: 'nodes/n1/' });
  assert.equal(after.files.find((row) => row[0] === csv)[3], '对标账号视频数据，按播放排序（推断）');
  assert.equal(after.files.some((row) => row[0] === META_FILE), false, '元数据文件不出现在资料包清单里');
  assert.equal((await service.dispatch('map_read', { path: `nodes/n1/${csv}` })).note, '对标账号视频数据，按播放排序（推断）');

  const hit = await service.dispatch('map_look', { query: '对标账号' });
  const row = hit.items.find((item) => item[3] === 'nodes/n1/index.md');
  assert.ok(row, JSON.stringify(hit));

  const text = await readFile(join(nodeDir('n1'), META_FILE), 'utf8');
  assert.match(text, /^- videos\.csv：对标账号视频数据，按播放排序（推断 · test · \d\d-\d\d · @[0-9a-f]{6}）$/m);
  assert.doesNotMatch(await readFile(join(nodeDir('n1'), 'index.md'), 'utf8'), /Agent元数据/);

  await assert.rejects(service.dispatch('map_write', { path: 'n1', meta: { files: { 'nope.png': 'x' } } }), (error) => error.code === 'META_FILE_NOT_FOUND' && /videos\.csv/.test(error.message));
  await assert.rejects(service.dispatch('map_write', { path: `nodes/n1/${META_FILE}`, content: 'x' }), (error) => error.code === 'META_WRITE_VIA_META');
  await assert.rejects(service.dispatch('map_write', { path: 'n1', meta: {} }), (error) => error.code === 'META_EMPTY');
});

test('人改过的行 Agent 不改，人删过的行不补写；用户明确要求时可以', async (t) => {
  const { service, root, nodeDir } = await openService(t);
  const csv = await seedNode(service, root);
  await service.dispatch('map_write', { path: 'n1', meta: { summary: 'Agent 写的摘要', files: { [csv]: 'Agent 写的说明' } } });
  const metaPath = join(nodeDir('n1'), META_FILE);
  const text = await readFile(metaPath, 'utf8');
  await writeFile(metaPath, text.replace('Agent 写的说明', '我改过的说明').split('\n').filter((line) => !line.startsWith('摘要')).join('\n'), 'utf8');

  await assert.rejects(service.dispatch('map_write', { path: 'n1', meta: { files: { [csv]: '再改回去' } } }), (error) => error.code === 'META_HUMAN_LOCKED');
  await assert.rejects(service.dispatch('map_write', { path: 'n1', meta: { summary: '补回去' } }), (error) => error.code === 'META_HUMAN_DELETED');
  assert.equal((await service.dispatch('map_read', { path: 'n1' })).meta, undefined, '人删掉的摘要不再提示缺摘要');
  assert.equal((await service.dispatch('map_read', { path: 'nodes/n1/' })).files.find((row) => row[0] === csv)[3], '我改过的说明');

  await service.dispatch('map_write', { path: 'n1', meta: { summary: '用户要求写的摘要', userAsked: true } });
  const final = await readFile(metaPath, 'utf8');
  assert.match(final, /^摘要：用户要求写的摘要/m);
  assert.match(final, /^- videos\.csv：我改过的说明（人 · /m);
});

test('改名同步：工具改名带走说明；资源管理器改名按内容哈希接上', async (t) => {
  const { service, root, nodeDir } = await openService(t);
  const csv = await seedNode(service, root);
  await service.dispatch('map_write', { path: 'n1', meta: { files: { [csv]: '视频数据' } } });

  await service.dispatch('map_manage', { action: 'rename_file', path: `n1/${csv}`, to: '数据.csv' });
  const metaPath = join(nodeDir('n1'), META_FILE);
  assert.match(await readFile(metaPath, 'utf8'), /^- 数据\.csv：视频数据（推断/m);
  // 工具改名不能被当成人删了一行：之后 Agent 仍能更新这条说明。
  await service.dispatch('map_write', { path: 'n1', meta: { files: { '数据.csv': '视频数据 v2' } } });

  await rename(join(nodeDir('n1'), '数据.csv'), join(nodeDir('n1'), '外部改名.csv'));
  const listed = await service.dispatch('map_read', { path: 'nodes/n1/' });
  assert.equal(listed.files.find((row) => row[0] === '外部改名.csv')?.[3], '视频数据 v2（推断）', JSON.stringify(listed));
  assert.equal(listed.gone, undefined);
});

test('纯函数：bodyVersion 忽略系统登记区段与行尾空白；无标记的行算人写的；引用处取相邻行', () => {
  const body = '# 标题\n\n正文';
  const withBlock = `${body}\n\n<!-- @author: system:bundle-index -->\n## 📁 节点资料包索引\n- a.png\n<!-- /@author -->\n`;
  assert.equal(bodyVersion(body), bodyVersion(withBlock));
  assert.equal(bodyVersion(body), bodyVersion(body.replace(/\n/g, '\r\n')));
  assert.notEqual(bodyVersion(body), bodyVersion(`${body}改`));

  const parsed = parseMeta('# Agent元数据\n\n摘要：一句话（推断 · codex · 10-05 · index.md@abcdef）\n\n## 文件\n- a.png：人手写的说明\n');
  assert.equal(parsed.summary.label, '推断');
  assert.equal(parsed.summary.ver, 'abcdef');
  assert.equal(parsed.files.get('a.png').label, '人');

  const fresh = reconcile('摘要：别人写的（推断 · x · 10-05）\n', { written: null, deleted: [] });
  assert.equal(fresh.model.summary.label, '人', '程序从没写过的文件整份算人写的');

  assert.equal(referenceLines(['截图如下\n![](a.png)\n'], ['a.png']).get('a.png'), '截图如下');
});
