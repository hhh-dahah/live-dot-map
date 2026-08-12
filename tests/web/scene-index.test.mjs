import assert from 'node:assert/strict';
import test from 'node:test';
import { EdgeSpatialIndex, ParallelIndex, buildEdgeIndex, visibleWorldBounds } from '../../src/web/scene-index.mjs';

test('平行边索引避免每条边重复 filter，并给出对称偏移', () => {
  const edges = [
    { id: 'e2', from: 'n1', to: 'n2' },
    { id: 'e1', from: 'n1', to: 'n2' },
    { id: 'e3', from: 'n2', to: 'n1' },
  ];
  const index = new ParallelIndex(edges);
  assert.equal(index.groupFor(edges[0]).length, 2);
  assert.equal(index.offsetFor(edges[0]), 23);
  assert.equal(index.offsetFor(edges[1]), -23);
  assert.equal(index.offsetFor(edges[2]), 0);
});

test('空间索引可以在视口附近查询连接边', () => {
  const nodes = [{ id: 'n1', x: 0, y: 0 }, { id: 'n2', x: 180, y: 0 }, { id: 'n3', x: 0, y: 500 }];
  const edges = [{ id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n1', to: 'n3' }];
  const index = buildEdgeIndex(edges, nodes, { cellSize: 64, samples: 8 });
  assert.ok(index instanceof EdgeSpatialIndex);
  assert.equal(index.queryPoint({ x: 90, y: 0 }, 8)[0].id, 'e1');
  assert.equal(index.queryRect({ x: 160, y: -10, width: 40, height: 20 })[0].id, 'e1');
  const bounds = visibleWorldBounds({ width: 800, height: 600 }, { x: -100, y: -50, k: 2 }, 100);
  assert.ok(bounds.width > 400 && bounds.height > 300);
});
