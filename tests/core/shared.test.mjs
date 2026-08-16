import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCommandEnvelope,
  autonomyDecision,
  buildProjectProjection,
  checkAttemptEvidence,
  findExplorationAlternatives,
  createEmptyMap,
  migrateMapV1,
  planConsolidation,
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

test('节点 kind 与地图名称通过受限命令保存，问题节点优先进入检索', () => {
  const map = baseMap();
  const renamed = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: map.revision, commandId: 'meta-name', actor: 'human', sessionId: 'session-1',
    commands: [
      { op: 'set_meta', patch: { name: '壁纸问题地图' } },
      { op: 'update', collection: 'nodes', id: 'n1', patch: { kind: 'problem', type: '问题' } },
    ],
  }, { now: NOW });
  assert.equal(renamed.name, '壁纸问题地图');
  assert.equal(renamed.nodes[0].kind, 'problem');
  const context = retrieveContext(renamed, '目标', { now: NOW });
  assert.equal(context.objects[0].id, 'n1');
  assert.ok(context.objects[0].reasons.includes('未解决问题节点'));
  assert.equal(buildProjectProjection(renamed).problems[0].id, 'n1');
  assert.throws(() => applyCommandEnvelope(renamed, {
    projectId: 'project-test', baseRevision: renamed.revision, commandId: 'bad-kind', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'update', collection: 'nodes', id: 'n1', patch: { kind: 'other' } }],
  }, { now: NOW }), (error) => error.code === 'INVALID_NODE_KIND');
});

test('项目投影提供主路线、当前节点、待验证候选和人类更新', () => {
  const map = baseMap();
  const projected = buildProjectProjection(map, { now: NOW });
  assert.equal(projected.mainRoute.id, 'r1');
  assert.equal(projected.current.source, 'inferred');
  assert.equal(projected.current.nodeId, 'n2');
  assert.equal(projected.pendingCandidates[0].id, 'e1');
  const next = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'projection-ann', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'create', collection: 'anns', value: { id: 'a1', text: '优先看目标', target: { kind: 'node', id: 'n1' } } }],
  }, { now: NOW });
  assert.equal(buildProjectProjection(next).humanUpdates[0].id, 'a1');
});

test('路线 currentNodeId 必须属于该路线，删除当前节点会清空指针', () => {
  const map = baseMap();
  const pinned = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'pin-current', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'update', collection: 'routes', id: 'r1', patch: { currentNodeId: 'n1' } }],
  }, { now: NOW });
  assert.equal(pinned.routes[0].currentNodeId, 'n1');
  const deleted = applyCommandEnvelope(pinned, {
    projectId: 'project-test', baseRevision: 2, commandId: 'delete-current', actor: 'human', sessionId: 'session-1',
    commands: [{ op: 'delete', collection: 'nodes', id: 'n1' }],
  }, { now: NOW });
  assert.equal(deleted.routes[0].currentNodeId, undefined);
});

test('整理预览只产生可审核的可逆归档命令，不直接修改地图', () => {
  const map = applyCommandEnvelope(baseMap(), {
    projectId: 'project-test', baseRevision: 1, commandId: 'fail-edge', actor: 'agent:codex', sessionId: 'session-1',
    commands: [{ op: 'update', collection: 'edges', id: 'e1', patch: { status: 'failed', score: 20, updatedAt: NOW } }],
  }, { now: NOW });
  const plan = planConsolidation(map, { now: '2026-08-20T01:02:03.004Z' });
  assert.equal(plan.revision, map.revision);
  assert.equal(plan.suggestions[0].commands[0].op, 'update');
  assert.equal(plan.suggestions[0].mode, 'human_only');
  assert.equal(plan.suggestions[0].applyable, true);
  assert.equal(plan.before.activeEdges, 1);
  assert.equal(plan.after.activeEdges, 0);
  assert.equal(map.edges[0].archived, undefined);
});

test('整理预览补齐近义节点、成功链、重复分支重连和 Markdown 摘要建议', () => {
  let map = baseMap();
  map = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: map.revision, commandId: 'curation-shapes', actor: 'human', sessionId: 'session-1',
    commands: [
      { op: 'create', collection: 'nodes', value: { id: 'n3', name: '阶段结论', type: '阶段', route: 'r1', x: 400, y: 0 } },
      { op: 'create', collection: 'nodes', value: { id: 'n4', name: '阶段结论复用', type: '阶段', route: 'r1', x: 600, y: 0 } },
      { op: 'create', collection: 'edges', value: { id: 'es1', from: 'n1', to: 'n2', name: '步骤一', status: 'success', route: 'r1' } },
      { op: 'create', collection: 'edges', value: { id: 'es2', from: 'n2', to: 'n3', name: '步骤二', status: 'success', route: 'r1' } },
      { op: 'create', collection: 'edges', value: { id: 'eb1', from: 'n1', to: 'n3', name: '分支甲', status: 'pending', route: 'r1' } },
      { op: 'create', collection: 'edges', value: { id: 'eb2', from: 'n1', to: 'n4', name: '分支乙', status: 'pending', route: 'r1' } },
    ],
  }, { now: NOW });
  const beforeJson = JSON.stringify(map);
  const options = { now: '2026-08-20T01:02:03.004Z', maxSuggestions: 20, markdown: [{ path: '.live-dot-map/routes/es1.md', text: 'x'.repeat(4001) }] };
  const first = planConsolidation(map, options);
  const second = planConsolidation(map, options);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(map), beforeJson);
  const byKind = new Map(first.suggestions.map((suggestion) => [suggestion.kind, suggestion]));
  assert.ok(byKind.has('merge_nodes'));
  assert.ok(byKind.has('compress_success_chain'));
  assert.ok(byKind.has('reconnect_duplicate_branch'));
  assert.ok(byKind.has('summarize_markdown'));
  const previewKinds = ['merge_nodes', 'compress_success_chain', 'summarize_markdown'];
  for (const kind of previewKinds) {
    const suggestion = byKind.get(kind);
    assert.equal(suggestion.mode, 'preview_only');
    assert.equal(suggestion.applyable, false);
    assert.deepEqual(suggestion.commands, []);
    assert.equal(suggestion.afterKnown, false);
    assert.ok(suggestion.source.actors.length >= 1);
    assert.deepEqual(suggestion.before, suggestion.after);
  }
  const reconnect = byKind.get('reconnect_duplicate_branch');
  assert.equal(reconnect.mode, 'human_only');
  assert.equal(reconnect.applyable, true);
  assert.equal(reconnect.commands[0].humanOnly, true);
  assert.equal(reconnect.commands[0].patch.to, 'n3');
  assert.ok(reconnect.source.objectIds.includes('eb2'));
  assert.ok(reconnect.source.routeIds.includes('r1'));
  assert.ok(byKind.get('summarize_markdown').source.markdownPaths.includes('.live-dot-map/routes/es1.md'));
});

test('human-only 重连命令拒绝 Agent 自动应用', () => {
  const map = baseMap();
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: map.revision, commandId: 'agent-reconnect', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'update', collection: 'edges', id: 'e1', humanOnly: true, patch: { to: 'n1' } }],
  }, { now: NOW }), (error) => error.code === 'HUMAN_APPROVAL_REQUIRED' && error.status === 403);
});

test('失败方案沿来源节点返回有限替代方向，并排除 shelved 失败线', () => {
  let map = baseMap();
  map = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'explore-branches', actor: 'human', sessionId: 'session-1',
    commands: [
      { op: 'update', collection: 'edges', id: 'e1', patch: { name: '缓存方案', status: 'failed', score: 35 } },
      { op: 'create', collection: 'edges', value: { id: 'e2', from: 'n1', to: 'n2', name: '备用方案', status: 'pending', score: 60, route: 'r1' } },
      { op: 'create', collection: 'routes', value: { id: 'r2', name: '另一条路线' } },
      { op: 'create', collection: 'nodes', value: { id: 'n3', name: '另一结果', route: 'r2' } },
      { op: 'create', collection: 'edges', value: { id: 'e8', from: 'n1', to: 'n3', name: '缓存方案', status: 'success', score: 88, route: 'r2' } },
    ],
  }, { now: NOW });
  const alternatives = findExplorationAlternatives(map, 'n1');
  assert.ok(alternatives.some((item) => item.id === 'e2'));
  assert.ok(alternatives.some((item) => item.id === 'e8' && item.reasons.some((reason) => reason.includes('成功'))));
  map = applyCommandEnvelope(map, { projectId: 'project-test', baseRevision: map.revision, commandId: 'shelve-failed', actor: 'human', sessionId: 'session-1', commands: [{ op: 'update', collection: 'edges', id: 'e1', patch: { shelved: true } }] }, { now: NOW });
  assert.ok(!findExplorationAlternatives(map, 'n1').some((item) => item.id === 'e1'));
});

test('替代候选返回来源/尝试/跨路线字段，并从 route.source 回溯', () => {
  let map = baseMap();
  map = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'explore-fields', actor: 'human', sessionId: 'session-1',
    commands: [
      { op: 'update', collection: 'edges', id: 'e1', patch: { name: '缓存方案', status: 'failed', score: 35 } },
      { op: 'create', collection: 'edges', value: { id: 'e2', from: 'n1', to: 'n2', name: '备用方案', status: 'pending', score: 60, route: 'r1' } },
      { op: 'create', collection: 'routes', value: { id: 'r2', name: '另一条路线', source: 'n1' } },
      { op: 'create', collection: 'nodes', value: { id: 'n3', name: '另一结果', route: 'r2' } },
      { op: 'create', collection: 'edges', value: { id: 'e8', from: 'n1', to: 'n3', name: '缓存方案', status: 'success', score: 88, route: 'r2' } },
    ],
  }, { now: NOW });
  // This deliberately omits edge.from to exercise the route.source fallback;
  // valid command envelopes still require from, preserving the v2 schema.
  const fallback = structuredClone(map);
  fallback.edges.push({ id: 'e9', route: 'r2', name: '跨线验证', status: 'pending', score: 70 });
  const alternatives = findExplorationAlternatives(fallback, 'n1');
  const sameRoute = alternatives.find((item) => item.id === 'e2');
  assert.equal(sameRoute?.sourceNodeId, 'n1');
  assert.equal(sameRoute?.sourceRouteId, 'r1');
  assert.equal(sameRoute?.isTried, false);
  assert.equal(sameRoute?.isCrossRoute, false);
  assert.match(sameRoute?.reason ?? '', /来源节点/);
  const crossRoute = alternatives.find((item) => item.id === 'e8' || item.id === 'e9');
  assert.equal(crossRoute?.sourceNodeId, 'n1');
  assert.equal(crossRoute?.sourceRouteId, 'r1');
  assert.equal(crossRoute?.isCrossRoute, true);
  assert.match(crossRoute?.reason ?? '', /跨路线/);
  assert.ok(alternatives.length <= 3);
  // A pending direction with the same source/name as a failed direction is
  // semantically the same failed attempt and must not be proposed again.
  fallback.edges.push({ id: 'e10', from: 'n1', route: 'r1', name: '缓存方案', status: 'pending', score: 99 });
  assert.ok(!findExplorationAlternatives(fallback, 'n1').some((item) => item.id === 'e10'));
});

test('自治判断覆盖当前路线/一跳、重大新方向、对象批量和候选分差', () => {
  const map = baseMap();
  const highGap = autonomyDecision(map, [
    { kind: 'nodes', id: 'n1', score: 900, reasons: ['当前推进节点'], value: { id: 'n1', route: 'r1' } },
    { kind: 'nodes', id: 'n2', score: 400, reasons: ['当前路线'], value: { id: 'n2', route: 'r1' } },
  ]);
  assert.equal(highGap.auto, true);
  const blocked = autonomyDecision(map, [
    { kind: 'edges', id: 'cross', score: 900, reasons: ['文本命中'], value: { id: 'cross', route: 'r2', from: 'other' } },
    { kind: 'edges', id: 'cross-2', score: 850, reasons: ['文本命中'], value: { id: 'cross-2', route: 'r2', from: 'other' } },
  ]);
  assert.equal(blocked.auto, false);
  assert.ok(blocked.reasons.some((reason) => reason.includes('当前路线或一跳')));
  assert.ok(blocked.reasons.some((reason) => reason.includes('重大新方向')));
  assert.ok(blocked.reasons.some((reason) => reason.includes('分差')));
  const many = Array.from({ length: 11 }, (_, index) => ({ kind: 'nodes', id: `x${index}`, score: 900 - index, reasons: ['当前路线'], value: { id: `x${index}`, route: 'r1' } }));
  const crowded = autonomyDecision(map, many);
  assert.equal(crowded.auto, false);
  assert.ok(crowded.reasons.some((reason) => reason.includes('超过 10')));
  const largeMap = structuredClone(map);
  for (let index = 0; index < 18; index += 1) largeMap.nodes.push({ id: `extra-${index}`, route: 'r1', name: `阶段${index}`, updatedAt: NOW, createdAt: NOW, updatedBy: 'human', updatedRevision: 1 });
  const threshold = autonomyDecision(largeMap, [
    { kind: 'nodes', id: 'n1', score: 900, reasons: ['当前推进节点'], value: { id: 'n1', route: 'r1' } },
    { kind: 'nodes', id: 'n2', score: 700, reasons: ['当前路线'], value: { id: 'n2', route: 'r1' } },
  ]);
  assert.ok(threshold.reasons.some((reason) => reason.includes('整理阈值')));
});

test('Agent 大尝试 Stop 证据检查要求 Markdown 有证据、结果和下一步', () => {
  const map = applyCommandEnvelope(baseMap(), {
    projectId: 'project-test', baseRevision: 1, commandId: 'attempt-evidence', actor: 'agent:codex', sessionId: 'session-1',
    commands: [{ op: 'update', collection: 'edges', id: 'e1', patch: { status: 'failed', score: 25 } }],
  }, { now: NOW });
  const missing = checkAttemptEvidence(map, [{ path: '.live-dot-map/routes/e1.md', text: '# 方案\n\n## 关键证据\n已验证\n\n## 结果\n失败\n' }]);
  assert.equal(missing.length, 1);
  assert.ok(missing[0].missing.includes('下一步'));
  assert.ok(missing[0].missing.includes('失败原因'));
  const complete = checkAttemptEvidence(map, [{ path: '.live-dot-map/routes/e1.md', text: '# 方案\n\n## 关键证据\n已验证\n\n## 结果\n失败\n\n## 评分\n25\n\n## 失败原因\n条件不满足\n\n## 下一步\n回到 n1\n' }]);
  assert.deepEqual(complete, []);
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

test('未知地图命令必须显式失败，不能静默推进 revision', () => {
  const map = baseMap();
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: 1, commandId: 'unknown-command', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'upsertEdge', edge: { id: 'e1', name: '错误格式' } }],
  }, { now: NOW }), (error) => error.code === 'UNKNOWN_COMMAND' && error.status === 400);
  assert.equal(map.revision, 1);
  assert.equal(map.edges.length, 1);
  assert.equal(map.edges[0].id, 'e1');
});

test('Agent 不能直接归档或搁置记忆，人类审核提交仍可应用', () => {
  const map = baseMap();
  for (const field of ['archived', 'shelved']) {
    assert.throws(() => applyCommandEnvelope(map, {
      projectId: 'project-test', baseRevision: map.revision, commandId: `agent-${field}`, actor: 'agent:codex', sessionId: 'session-agent',
      commands: [{ op: 'update', collection: 'edges', id: 'e1', patch: { [field]: true } }],
    }, { now: NOW }), (error) => error.code === 'HUMAN_APPROVAL_REQUIRED' && error.status === 403);
  }
  assert.throws(() => applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: map.revision, commandId: 'agent-hidden-create', actor: 'agent:codex', sessionId: 'session-agent',
    commands: [{ op: 'create', collection: 'nodes', value: { id: 'hidden1', name: '隐藏节点', route: 'r1', archived: true } }],
  }, { now: NOW }), (error) => error.code === 'HUMAN_APPROVAL_REQUIRED');
  const reviewed = applyCommandEnvelope(map, {
    projectId: 'project-test', baseRevision: map.revision, commandId: 'human-archive', actor: 'human', sessionId: 'session-human',
    commands: [{ op: 'update', collection: 'edges', id: 'e1', patch: { archived: true } }],
  }, { now: NOW });
  assert.equal(reviewed.edges[0].archived, true);
  assert.equal(reviewed.edges[0].updatedBy, 'human');
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
