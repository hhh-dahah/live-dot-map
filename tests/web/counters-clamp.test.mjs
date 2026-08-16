import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../../app.html', import.meta.url), 'utf8');

// 从发布产物中提取 clampCounters(纯函数),直接做行为断言
const m = html.match(/function clampCounters\(c, nodes, edges, anns\)\{[\s\S]*?\n\}/);
assert.ok(m, 'app.html 中应存在 clampCounters 函数');
const clampCounters = new Function(`${m[0]}; return clampCounters;`)();

test('过期 counters 反序列化后钳制到数据推导值之上', () => {
  const nodes = [
    { id:'n4', num:'04', name:'新节点3' },
    { id:'n7', num:'07', name:'改名节点' },
    { id:'n2', num:'02', name:'新节点6' },
  ];
  const edges = [{ id:'e8' }, { id:'e3' }];
  const anns = [{ id:'a5' }];
  // 保存层长期未同步的过期 counters(问题 4 的现场)
  const cc = clampCounters({ num:2, edge:1, ann:1, nodeName:1, edgeName:1, routeName:1 }, nodes, edges, anns);
  assert.ok(cc.nextNum >= 8, `nextNum 应 ≥ 最大 id/num + 1,实际 ${cc.nextNum}`);
  assert.ok(cc.nextEdge >= 9, `nextEdge 应 ≥ 最大边 id + 1,实际 ${cc.nextEdge}`);
  assert.ok(cc.nextAnn >= 6, `nextAnn 应 ≥ 最大便签 id + 1,实际 ${cc.nextAnn}`);
  assert.ok(cc.nextNodeName >= 7, `nextNodeName 应 ≥ 「新节点N」最大 N + 1,实际 ${cc.nextNodeName}`);
});

test('counters 比数据新时尊重记录值(不回退)', () => {
  const cc = clampCounters({ num:20, edge:30, ann:9, nodeName:15 }, [{ id:'n3', num:'03', name:'新节点2' }], [], []);
  assert.equal(cc.nextNum, 20);
  assert.equal(cc.nextEdge, 30);
  assert.equal(cc.nextAnn, 9);
  assert.equal(cc.nextNodeName, 15);
});

test('空地图/无 counters 时从 1 开始', () => {
  const cc = clampCounters({}, [], [], []);
  assert.equal(cc.nextNum, 1);
  assert.equal(cc.nextEdge, 1);
  assert.equal(cc.nextAnn, 1);
  assert.equal(cc.nextNodeName, 1);
});

test('节点数多于名称序号时不重名(新节点N 取节点数+1 兜底)', () => {
  const nodes = Array.from({ length:5 }, (_, i) => ({ id:'n'+(i+1), num:String(i+1), name:'手工命名'+i }));
  const cc = clampCounters({ nodeName:2 }, nodes, [], []);
  assert.ok(cc.nextNodeName >= 6, `nextNodeName 应 ≥ 节点数 + 1,实际 ${cc.nextNodeName}`);
});
