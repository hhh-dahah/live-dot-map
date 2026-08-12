import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCommandEnvelope,
  autonomyDecision,
  createEmptyMap,
  migrateMapV1,
  retrieveContext,
  stableMarkdownPath,
  validateMapDocument,
} from '../../src/shared/index.mjs';

const NOW = '2026-08-11T01:02:03.004Z';

function baseMap() {
  const map = createEmptyMap({ name: '测试', now: NOW, mapId: 'map-test' });
  return applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 0, commandId: 'cmd-1', actor: 'human', sessionId: 'session-1',
    commands: [
      { op: 'create', collection: 'routes', value: { id: 'r1', name: '主路线', source: null, main: true } },
      { op: 'create', collection: 'nodes', value: { id: 'n1', num: '01', name: '目标', type: '目的', route: 'r1', x: 0, y: 0 } },
      { op: 'create', collection: 'nodes', value: { id: 'n2', num: '02', name: '结果', type: '结果', route: 'r1', x: 200, y: 0 } },
      { op: 'create', collection: 'edges', value: { id: 'e1', from: 'n1', to: 'n2', name: '实现', status: 'pending', route: 'r1' } },
    ],
  }, { now: NOW });
}

test('新对象使用稳定 Markdown 路径，名称修改不改变路径', () => {
  const map = baseMap();
  assert.equal(map.nodes[0].md, '.live-dot-map/nodes/n1.md');
  assert.equal(map.edges[0].md, '.live-dot-map/routes/e1.md');
  const changed = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'cmd-2', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'update', collection: 'nodes', id: 'n1', patch: { name: '新名称' } }],
  }, { now: '2026-08-11T01:03:03.004Z' });
  assert.equal(changed.nodes[0].md, stableMarkdownPath('nodes', 'n1'));
});

test('v1 迁移保留未知字段和已有 Markdown，并把旧标注列为 new', () => {
  const migrated = migrateMapV1({
    version: 1, name: '旧地图', updatedAt: '2026-08-01', futureTop: { keep: true },
    view: {}, ui: {}, counters: {},
    routes: [{ id: 'r1', name: '主线', source: null, main: true, future: 1 }],
    nodes: [{ id: 'n1', name: '开始', type: '目的', route: 'r1', x: 0, y: 0, md: 'docs/old.md' }],
    edges: [], anns: [{ id: 'a1', target: { kind: 'node', id: 'n1' }, text: '请先看这里', hidden: false }],
  }, { now: NOW });
  assert.deepEqual(migrated.futureTop, { keep: true });
  assert.equal(migrated.routes[0].future, 1);
  assert.equal(migrated.nodes[0].md, 'docs/old.md');
  assert.equal(migrated.anns[0].attention, 'new');
  assert.equal(validateMapDocument(migrated).ok, true);
});

test('Agent 摘要不含标注 ID 时不能确认读取', () => {
  let map = baseMap();
  map = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'cmd-3', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'create', collection: 'anns', value: { id: 'a1', target: { kind: 'node', id: 'n1' }, text: '优先做可靠性', hidden: false } }],
  }, { now: NOW });
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 2, commandId: 'cmd-4', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'ack_annotations', ids: ['a1'], summary: '我读到了需求' }],
  }, { now: NOW }), /没有引用标注/);
});

test('检索中人类新标注排第一，一跳高于两跳，归档默认排除', () => {
  let map = baseMap();
  map = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'cmd-5', actor: 'human', sessionId: 'session-1',
    commands: [
      { op: 'create', collection: 'nodes', value: { id: 'n3', num: '03', name: '远端', type: '问题', route: 'r1', x: 400, y: 0 } },
      { op: 'create', collection: 'edges', value: { id: 'e2', from: 'n2', to: 'n3', name: '继续', status: 'pending', route: 'r1' } },
      { op: 'create', collection: 'anns', value: { id: 'a1', target: { kind: 'node', id: 'n1' }, text: '人工优先信息', hidden: false } },
      { op: 'update', collection: 'nodes', id: 'n3', patch: { archived: true } },
    ],
  }, { now: NOW });
  const result = retrieveContext(map, '目标', { now: NOW });
  assert.equal(result.objects[0].id, 'a1');
  assert.ok(result.objects.some((item) => item.id === 'n2'));
  assert.ok(!result.objects.some((item) => item.id === 'n3'));
  assert.equal(autonomyDecision(map, result.objects).auto, false);
});

test('未知版本只读拒绝', () => {
  const result = validateMapDocument({ version: 99 });
  assert.equal(result.ok, false);
  assert.equal(result.readOnly, true);
});

test('1000 次命令往返始终有效且未知字段不丢失', () => {
  let map = baseMap();
  map.futureExtension = { keep: ['yes'] };
  for (let index = 0; index < 1000; index += 1) {
    map = applyCommandEnvelope(map, {
      projectId: 'project-test', baseRevision: map.revision, commandId: `random-command-${String(index).padStart(4, '0')}`,
      actor: index % 2 ? 'human' : 'agent:codex', sessionId: 'property-session',
      commands: [{ op: 'update', collection: 'nodes', id: index % 2 ? 'n1' : 'n2', patch: { x: index, futureObjectField: { index } } }],
    }, { now: new Date(Date.parse(NOW) + index).toISOString() });
    assert.equal(validateMapDocument(map).ok, true);
  }
  assert.deepEqual(map.futureExtension, { keep: ['yes'] });
  assert.equal(map.revision, 1001);
});

test('Agent 创建里程碑写入真实来源，不能伪装执行碎片', () => {
  const map = createEmptyMap({ name: '来源测试', now: NOW, mapId: 'map-origin' });
  const created = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 0, commandId: 'cmd-origin', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'create', collection: 'nodes', value: {
      id: 'n1', name: '项目阶段', type: '阶段', x: 0, y: 0,
      milestone: { status: 'pending', origin: 'human_created', level: 'project', createdBy: 'human' },
      futureEvidence: { path: 'docs/context.md' },
    } }],
  }, { now: NOW });
  const node = created.nodes[0];
  assert.equal(node.createdBy, 'agent:codex');
  assert.equal(node.updatedBy, 'agent:codex');
  assert.equal(node.milestone.origin, 'agent_created');
  assert.equal(node.milestone.level, 'project');
  assert.equal(node.milestone.createdBy, 'agent:codex');
  const updated = applyCommandEnvelope(created, {
    projectId: 'project-test', baseRevision: 1, commandId: 'cmd-origin-update', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'update', collection: 'nodes', id: 'n1', patch: { milestone: { status: 'changes_requested', origin: 'agent_created' } } }],
  }, { now: '2026-08-11T01:03:03.004Z' });
  assert.equal(updated.nodes[0].milestone.origin, 'agent_created');
  assert.equal(updated.nodes[0].milestone.createdBy, 'agent:codex');
  assert.equal(updated.nodes[0].milestone.updatedBy, 'human');
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 0, commandId: 'cmd-work', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'create', collection: 'nodes', value: { id: 'work1', name: '执行碎片', type: '任务', x: 0, y: 0, milestone: { status: 'pending', level: 'work' } } }],
  }, { now: NOW }), (error) => error.code === 'AGENT_WORK_MILESTONE_FORBIDDEN');
  const agentApproved = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 0, commandId: 'cmd-approved', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'create', collection: 'nodes', value: { id: 'approved1', name: 'Agent 已确认阶段', type: '阶段', x: 0, y: 0, milestone: { status: 'approved', level: 'project' } } }],
  }, { now: NOW });
  assert.equal(agentApproved.nodes[0].milestone.status, 'approved');
  assert.equal(agentApproved.nodes[0].milestone.origin, 'agent_created');
  assert.equal(agentApproved.nodes[0].milestone.createdBy, 'agent:codex');
  const agentUpdated = applyCommandEnvelope(agentApproved, {
    projectId: 'project-test', baseRevision: 1, commandId: 'cmd-approved-update', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'update', collection: 'nodes', id: 'approved1', patch: { milestone: { status: 'approved' } } }],
  }, { now: '2026-08-11T01:03:04.004Z' });
  assert.equal(agentUpdated.nodes[0].milestone.status, 'approved');
  assert.equal(agentUpdated.nodes[0].milestone.origin, 'agent_created');
  assert.equal(agentUpdated.nodes[0].milestone.updatedBy, 'agent:codex');
});

test('Agent 扩张达到批量/里程碑上限时返回压缩建议', () => {
  const map = createEmptyMap({ name: '上限测试', now: NOW, mapId: 'map-limit' });
  const milestones = Array.from({ length: 3 }, (_, index) => ({ op: 'create', collection: 'nodes', value: { id: `m${index}`, name: `阶段${index}`, type: '阶段', x: index, y: 0, milestone: { status: 'pending', level: 'route' } } }));
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 0, commandId: 'cmd-limit-m', actor: 'agent:codex', sessionId: 'session-agent', commands: milestones,
  }, { now: NOW }), (error) => error.code === 'AGENT_MILESTONE_LIMIT' && error.details.maxMilestones === 2);
  const objects = Array.from({ length: 11 }, (_, index) => ({ op: 'create', collection: 'routes', value: { id: `r${index}`, name: `路线${index}` } }));
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 0, commandId: 'cmd-limit-b', actor: 'agent:codex', sessionId: 'session-agent', commands: objects,
  }, { now: NOW }), (error) => error.code === 'AGENT_BATCH_LIMIT' && error.details.maxObjects === 10);
});

test('map_next_candidates 支持当前节点、limit 和历史开关', () => {
  const map = baseMap();
  const limited = retrieveContext(map, '', { currentNodeId: 'n1', limit: 1, now: NOW });
  assert.equal(limited.objects.length, 1);
  assert.equal(limited.objects[0].id, 'n1');
  const archived = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: map.revision, commandId: 'cmd-history', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'update', collection: 'nodes', id: 'n2', patch: { archived: true } }],
  }, { now: NOW });
  assert.ok(!retrieveContext(archived, '结果', { now: NOW }).objects.some((item) => item.id === 'n2'));
  assert.ok(retrieveContext(archived, '结果', { includeHistory: true, now: NOW }).objects.some((item) => item.id === 'n2'));
});

test('Agent 初始化地图在 15 个活跃节点后必须先压缩', () => {
  let map = createEmptyMap({ name: '初始化上限', now: NOW, mapId: 'map-initial-limit' });
  const makeNodes = (start, count) => Array.from({ length: count }, (_, index) => ({
    op: 'create', collection: 'nodes', value: { id: `n${start + index}`, name: `阶段${start + index}`, type: '阶段', x: index * 100, y: 0 },
  }));
  for (const [number, commands] of [[1, makeNodes(1, 5)], [2, makeNodes(6, 5)], [3, makeNodes(11, 5)]]) {
    map = applyCommandEnvelope(map, {
      projectId: 'project-test', baseRevision: map.revision, commandId: `cmd-initial-${number}`, actor: 'agent:codex', sessionId: 'session-agent', commands,
    }, { now: NOW });
  }
  assert.equal(map.nodes.length, 15);
  assert.equal(map.ui.initialization.status, 'in_progress');
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: map.revision, commandId: 'cmd-initial-over', actor: 'agent:codex', sessionId: 'session-agent', commands: makeNodes(16, 1),
  }, { now: NOW }), (error) => error.code === 'AGENT_INITIAL_MAP_LIMIT' && error.details.maxInitialNodes === 15);
});
