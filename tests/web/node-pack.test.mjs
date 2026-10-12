import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8 } from 'fflate';
import { prepareFallbackDocument } from '../../src/web/fallback-document.mjs';
import {
  buildMemoryPack,
  collectNodeScope,
  extractScopeDocument,
  packFileOwner,
  parseMemoryPack,
  remapNodePack,
} from '../../src/web/memory-pack.mjs';

// n1 → n2 → n3 → n1 成环；n1 有一条悬空方案线；n4 是范围外节点，n3 → n4 不该被单节点导出带上；n5 已归档。
function sourceDocument() {
  return prepareFallbackDocument({
    version: 1, name: '来源地图', updatedAt: '2026-10-12', mapDir: '.live-dot-map/maps/src',
    view: { x: 0, y: 0, k: 1 }, ui: {},
    counters: { num: 6, edge: 7, ann: 4 },
    routes: [{ id: 'r100', name: '主路线', source: 'n1' }],
    nodes: [
      { id: 'n1', num: '01', name: '根', type: '目标', kind: 'goal', route: 'r100', x: 100, y: 100 },
      { id: 'n2', num: '02', name: '子', type: '目标', kind: 'goal', route: 'r100', x: 200, y: 100 },
      { id: 'n3', num: '03', name: '孙', type: '问题', kind: 'problem', route: null, x: 300, y: 100 },
      { id: 'n4', num: '04', name: '旁支', type: '目标', kind: 'goal', route: null, x: 100, y: 300 },
      { id: 'n5', num: '05', name: '已归档', type: '目标', kind: 'goal', route: null, x: 400, y: 100, archived: true, archivedAt: '2026-10-01T00:00:00.000Z' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', name: '方案1', status: 'success', route: 'r100' },
      { id: 'e2', from: 'n2', to: 'n3', name: '方案2', status: 'success', route: null },
      { id: 'e3', from: 'n3', to: 'n1', name: '回环', status: 'failed', route: null },
      { id: 'e4', from: 'n1', to: null, name: '待验证', status: 'pending', route: null, dx: 50, dy: 40 },
      { id: 'e5', from: 'n4', to: 'n1', name: '外部指向根', status: 'success', route: null },
      { id: 'e6', from: 'n3', to: 'n5', name: '指向归档', status: 'success', route: null },
    ],
    anns: [
      { id: 'a1', target: { kind: 'node', id: 'n2' }, text: '子节点标注' },
      { id: 'a2', target: { kind: 'edge', id: 'e5' }, text: '外部连线标注' },
      { id: 'a3', target: { kind: 'canvas' }, text: '画布标注', x: 0, y: 0 },
    ],
  }).document;
}

test('单节点：只带自己、悬空方案线和自己的标注', () => {
  const scope = collectNodeScope(sourceDocument(), 'n1');
  assert.deepEqual([...scope.nodeIds], ['n1']);
  assert.deepEqual([...scope.edgeIds], ['e4']);
  assert.deepEqual([...scope.annIds], []);
});

test('节点及下游：沿连线走、成环不死循环、不带上游和归档节点', () => {
  const scope = collectNodeScope(sourceDocument(), 'n1', { downstream: true });
  assert.deepEqual([...scope.nodeIds].sort(), ['n1', 'n2', 'n3']);
  assert.deepEqual([...scope.edgeIds].sort(), ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual([...scope.annIds], ['a1']);
  assert.throws(() => collectNodeScope(sourceDocument(), 'n9'), /找不到节点/);
});

test('裁出的文档仍能通过 v2 校验，只带被引用的路线', () => {
  const document = sourceDocument();
  const extracted = extractScopeDocument(document, collectNodeScope(document, 'n2', { downstream: true }));
  assert.equal(extracted.name, '子');
  assert.deepEqual(extracted.nodes.map((node) => node.id).sort(), ['n1', 'n2', 'n3']);
  assert.deepEqual(extracted.routes.map((route) => route.id), ['r100']);
  assert.doesNotThrow(() => prepareFallbackDocument(extracted));
});

test('导入重新编号：接着目标地图的计数往下编，连线、标注、资料包路径一起改', () => {
  const document = sourceDocument();
  const extracted = extractScopeDocument(document, collectNodeScope(document, 'n1', { downstream: true }));
  const result = remapNodePack(extracted, {
    counters: { nextNum: 3, nextEdge: 2, nextAnn: 9 },
    routeIds: [],
    anchor: { x: 1000, y: 500 },
    rootId: 'n1',
  });
  assert.deepEqual(result.nodes.map((node) => [node.id, node.num, node.name]), [['n3', '03', '根'], ['n4', '04', '子'], ['n5', '05', '孙']]);
  assert.equal(result.rootId, 'n3');
  assert.deepEqual(result.nodes.map((node) => [node.x, node.y]), [[1000, 500], [1100, 500], [1200, 500]]);
  assert.ok(result.nodes.every((node) => node.route === null && node.md === undefined), '目标地图没有的路线要清空，md 交给序列化层按新图重建');
  const edges = Object.fromEntries(result.edges.map((edge) => [edge.name, [edge.id, edge.from, edge.to]]));
  assert.deepEqual(edges['方案1'], ['e2', 'n3', 'n4']);
  assert.deepEqual(edges['回环'], ['e4', 'n5', 'n3']);
  assert.deepEqual(edges['待验证'], ['e5', 'n3', null]);
  assert.deepEqual(result.anns.map((ann) => [ann.id, ann.target]), [['a9', { kind: 'node', id: 'n4' }]]);
  assert.deepEqual(result.counters, { nextNum: 6, nextEdge: 6, nextAnn: 10 });
  assert.equal(result.renamePath('nodes/n1/index.md'), 'nodes/n3/index.md');
  assert.equal(result.renamePath('nodes/n2/图/a.png'), 'nodes/n4/图/a.png');
  assert.equal(result.renamePath('routes/e1/index.md'), 'routes/e2/index.md');
  assert.equal(result.renamePath('nodes/n4/index.md'), null, '包外对象的文件不导入');
  assert.equal(result.renamePath('routes/r100/index.md'), null);
});

test('目标地图已有同 id 路线时保留归属；指向包外节点的连线丢弃', () => {
  const document = sourceDocument();
  const result = remapNodePack(document, { counters: { nextNum: 1, nextEdge: 1, nextAnn: 1 }, routeIds: ['r100'] });
  assert.equal(result.nodes.find((node) => node.name === '根').route, 'r100');
  assert.ok(!result.edges.some((edge) => edge.name === '指向归档'), '归档节点不导入，指向它的连线也不导入');
  assert.ok(!result.nodes.some((node) => node.name === '已归档'));
  assert.equal(result.rootId, 'n1', '没有指定根时取第一个节点');
});

test('并入后的整张地图能通过校验', () => {
  const target = prepareFallbackDocument({
    version: 1, name: '目标地图', updatedAt: '2026-10-12', view: { x: 0, y: 0, k: 1 }, ui: {},
    counters: { num: 3, edge: 2, ann: 1 }, routes: [],
    nodes: [
      { id: 'n1', num: '01', name: '已有一', type: '目标', kind: 'goal', route: null, x: 0, y: 0 },
      { id: 'n2', num: '02', name: '已有二', type: '目标', kind: 'goal', route: null, x: 50, y: 0 },
    ],
    edges: [{ id: 'e1', from: 'n1', to: 'n2', name: '已有连线', status: 'success', route: null }],
    anns: [],
  }).document;
  const source = sourceDocument();
  const result = remapNodePack(extractScopeDocument(source, collectNodeScope(source, 'n1', { downstream: true })), {
    counters: { nextNum: 3, nextEdge: 2, nextAnn: 1 }, routeIds: [], rootId: 'n1',
  });
  const merged = { ...target, nodes: [...target.nodes, ...result.nodes], edges: [...target.edges, ...result.edges], anns: [...target.anns, ...result.anns] };
  const ids = [...merged.nodes, ...merged.edges, ...merged.anns].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, '不能撞号');
  assert.doesNotThrow(() => prepareFallbackDocument(merged));
});

test('节点包 round-trip：manifest 带范围，资料包路径归属可解析', async () => {
  const document = sourceDocument();
  const scope = collectNodeScope(document, 'n1');
  const { zip } = await buildMemoryPack({
    document: extractScopeDocument(document, scope),
    files: [{ path: 'nodes/n1/index.md', data: strToU8('# 根') }, { path: 'routes/e4/index.md', data: strToU8('# 待验证') }],
    scope: { kind: 'nodes', rootId: 'n1', downstream: false },
  });
  const parsed = await parseMemoryPack(zip);
  assert.deepEqual(parsed.manifest.scope, { kind: 'nodes', rootId: 'n1', downstream: false });
  assert.deepEqual(parsed.files.map((file) => packFileOwner(file.path)).sort((a, b) => a.kind.localeCompare(b.kind)),
    [{ kind: 'node', id: 'n1', fileName: 'index.md' }, { kind: 'route', id: 'e4', fileName: 'index.md' }]);
  assert.equal(packFileOwner('map.json'), null);
});
