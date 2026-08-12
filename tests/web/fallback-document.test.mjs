import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyMap, validateMapDocument } from '../../src/web/shared.mjs';
import {
  composeFallbackDocument,
  prepareFallbackDocument,
} from '../../src/web/fallback-document.mjs';

const NOW = '2026-08-11T12:00:00.000Z';

test('降级导入把 v1 安全迁移为可导出的 v2，并保留未知字段', () => {
  const prepared = prepareFallbackDocument({
    version: 1,
    name: '旧地图',
    updatedAt: '2026-08-10',
    futureTop: { keep: true },
    routes: [{ id: 'r1', name: '主路线' }],
    nodes: [{ id: 'n1', name: '起点', route: 'r1', futureItem: 7 }],
    edges: [],
    anns: [],
  }, { now: NOW });
  assert.equal(prepared.migrated, true);
  assert.equal(prepared.readOnly, false);
  assert.equal(prepared.document.version, 2);
  assert.deepEqual(prepared.document.futureTop, { keep: true });
  assert.equal(prepared.document.nodes[0].futureItem, 7);
  assert.equal(validateMapDocument(prepared.document).ok, true);
});

test('v2 降级导出保留未知字段、生成有效时间元数据且只在提交时推进 revision', () => {
  const source = createEmptyMap({ name: 'v2 地图', now: NOW, mapId: 'map-fallback' });
  source.futureTop = { keep: true };
  source.ui.futureFlag = 'keep';
  source.routes.push({ id: 'r1', name: '主路线', createdAt: NOW, updatedAt: NOW, updatedBy: 'migration', updatedRevision: 0, futureItem: 9 });
  source.nodes.push({ id: 'n1', name: '起点', route: 'r1', x: 0, y: 0, createdAt: NOW, updatedAt: NOW, updatedBy: 'migration', updatedRevision: 0 });
  const canvas = {
    ...source,
    name: '已编辑',
    updatedAt: '2026-08-11',
    ui: { showAnns: false },
    routes: source.routes,
    nodes: [{ ...source.nodes[0], name: '新名称', updatedAt: '2026-08-11' }],
  };
  const draft = composeFallbackDocument(source, canvas, { now: '2026-08-11T13:00:00.000Z' });
  assert.equal(draft.revision, 0);
  const committed = composeFallbackDocument(source, canvas, { now: '2026-08-11T13:00:00.000Z', commit: true });
  assert.equal(committed.revision, 1);
  assert.equal(committed.nodes[0].updatedRevision, 1);
  assert.equal(committed.nodes[0].updatedAt, '2026-08-11T13:00:00.000Z');
  assert.deepEqual(committed.futureTop, { keep: true });
  assert.equal(committed.ui.futureFlag, 'keep');
  assert.equal(committed.routes[0].futureItem, 9);
  assert.equal(validateMapDocument(committed).ok, true);
});

test('未知未来版本只读加载并始终原样导出', () => {
  const source = { version: 99, name: '未来地图', future: { nested: true }, routes: [], nodes: [], edges: [], anns: [] };
  const prepared = prepareFallbackDocument(source);
  assert.equal(prepared.readOnly, true);
  const output = composeFallbackDocument(prepared.document, { version: 2, name: '不得写入', nodes: [{ id: 'n1' }] }, { commit: true });
  assert.deepEqual(output, source);
  assert.notEqual(output, source);
});

test('降级模式新建或修改人类标注时补齐闭环字段并重置为 new', () => {
  const source = createEmptyMap({ name: '标注地图', now: NOW, mapId: 'map-annotations' });
  source.anns.push({
    id: 'a1', target: { kind: 'canvas' }, text: '旧标注', source: 'human', priority: 'high',
    attention: 'acknowledged', acknowledgements: [{ actor: 'agent:test', at: NOW }],
    createdAt: NOW, updatedAt: NOW, updatedBy: 'human', updatedRevision: 0,
  });
  const output = composeFallbackDocument(source, {
    ...source,
    anns: [
      { ...source.anns[0], text: '已修改' },
      { id: 'a2', target: { kind: 'canvas' }, text: '新标注' },
    ],
  }, { now: '2026-08-11T13:00:00.000Z', commit: true });
  assert.equal(output.anns[0].attention, 'new');
  assert.equal(output.anns[0].source, 'human');
  assert.equal(output.anns[1].attention, 'new');
  assert.equal(output.anns[1].priority, 'normal');
  assert.deepEqual(output.anns[1].acknowledgements, []);
  assert.equal(validateMapDocument(output).ok, true);
});

test('损坏的 v2 不会伪装成可写地图', () => {
  assert.throws(() => prepareFallbackDocument({ version: 2, name: '缺字段' }), /v2 地图校验失败/);
});
