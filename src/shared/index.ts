export const MAP_VERSION = 2 as const;
export const COLLECTIONS = ['routes', 'nodes', 'edges', 'anns'] as const;
export type Collection = typeof COLLECTIONS[number];
export type Actor = 'human' | `agent:${string}` | 'migration';
export type MilestoneOrigin = 'human_created' | 'agent_created';
export type MilestoneLevel = 'project' | 'route' | 'work';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  readOnly?: boolean;
}

export interface CommandEnvelope {
  projectId: string;
  baseRevision: number;
  commandId: string;
  actor: Actor;
  sessionId: string;
  commands: MapCommand[];
}

export type MapCommand =
  | { op: 'create'; collection: Collection; value: Record<string, unknown> }
  | { op: 'update'; collection: Collection; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; collection: Collection; id: string }
  | { op: 'set_view'; patch: Record<string, unknown> }
  | { op: 'set_ui'; patch: Record<string, unknown> }
  | { op: 'deliver_annotations'; ids: string[]; deliveryId: string }
  | { op: 'ack_annotations'; ids: string[]; summary: string }
  | { op: 'resolve_annotations'; ids: string[]; evidence?: string }
  | { op: 'suggest_milestone'; nodeId: string; status: 'approved' | 'changes_requested'; reviewNote?: string };

export interface MapDocument extends Record<string, unknown> {
  mapId: string;
  version: 2;
  revision: number;
  lastEventId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  view: Record<string, unknown>;
  ui: Record<string, unknown>;
  counters: Record<string, number>;
  routes: Record<string, unknown>[];
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  anns: Record<string, unknown>[];
}

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_NAME = 80;
const MAX_ANN = 4000;
const MAX_AGENT_OBJECTS_PER_ENVELOPE = 10;
const MAX_AGENT_NEW_NODES_PER_ENVELOPE = 5;
const MAX_AGENT_MILESTONES_PER_ENVELOPE = 2;
const MAX_ACTIVE_NODES = 30;
const MAX_INITIAL_MAP_NODES = 15;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function utcNow(now?: string): string {
  const value = now ? new Date(now) : new Date();
  if (Number.isNaN(value.getTime())) throw mapError('INVALID_TIME', 400, '时间格式无效');
  return value.toISOString();
}

function legacyTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function mapError(code: string, status: number, message: string, details?: unknown): Error & { code: string; status: number; details?: unknown } {
  return Object.assign(new Error(message), { code, status, details });
}

function cleanRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw mapError('INVALID_COMMAND', 400, `${label} 必须是对象`);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (DANGEROUS_KEYS.has(key)) throw mapError('INVALID_KEY', 400, `禁止字段 ${key}`);
    output[key] = clone(value);
  }
  return output;
}

export function stableMarkdownPath(collection: 'nodes' | 'edges', id: string): string {
  if (!ID.test(id)) throw mapError('INVALID_ID', 400, '对象 ID 无效');
  return collection === 'nodes' ? `.live-dot-map/nodes/${id}.md` : `.live-dot-map/routes/${id}.md`;
}

export function createEmptyMap(options: { name?: string; now?: string; mapId?: string } = {}): MapDocument {
  const now = utcNow(options.now);
  const mapId = options.mapId ?? `map-${fnv1a(`${options.name ?? '未命名地图'}:${now}`)}`;
  return {
    mapId,
    version: MAP_VERSION,
    revision: 0,
    lastEventId: 0,
    name: String(options.name ?? '未命名地图').slice(0, MAX_NAME),
    createdAt: now,
    updatedAt: now,
    view: { x: 0, y: 0, k: 1 },
    ui: { showAnns: true, showRoutes: true, showNums: false, showFailed: true },
    counters: { num: 1, edge: 1, ann: 1, nodeName: 1, edgeName: 1, routeName: 1 },
    routes: [],
    nodes: [],
    edges: [],
    anns: [],
  };
}

function migrateObject(value: unknown, fallback: string, collection: Collection): Record<string, unknown> {
  const item = cleanRecord(value, collection);
  const createdAt = legacyTime(item.createdAt, fallback);
  const updatedAt = legacyTime(item.updatedAt, createdAt);
  const migrated: Record<string, unknown> = {
    ...item,
    createdAt,
    updatedAt,
    createdBy: typeof item.createdBy === 'string' ? item.createdBy : 'migration',
    updatedBy: 'migration',
    updatedRevision: 0,
  };
  if (collection === 'nodes' && isObject(item.milestone)) {
    migrated.milestone = {
      ...item.milestone,
      createdBy: typeof item.milestone.createdBy === 'string' ? item.milestone.createdBy : 'migration',
      updatedBy: 'migration',
      updatedAt,
      updatedRevision: 0,
    };
  }
  if (collection === 'anns') {
    migrated.source = typeof item.source === 'string' ? item.source : 'migration';
    migrated.priority = typeof item.priority === 'string' ? item.priority : 'normal';
    migrated.attention = 'new';
    migrated.acknowledgements = Array.isArray(item.acknowledgements) ? clone(item.acknowledgements) : [];
    migrated.legacyReview = true;
  }
  return migrated;
}

export function migrateMapV1(input: unknown, options: { now?: string } = {}): MapDocument {
  const old = cleanRecord(input, 'map.json');
  if (old.version !== 1) throw mapError('UNSUPPORTED_VERSION', 409, `只能迁移 version 1，收到 ${String(old.version)}`);
  const now = utcNow(options.now);
  const createdAt = legacyTime(old.createdAt ?? old.updatedAt, now);
  const updatedAt = legacyTime(old.updatedAt, createdAt);
  const mapId = typeof old.mapId === 'string' && ID.test(old.mapId)
    ? old.mapId
    : `map-${fnv1a(`${String(old.name ?? '未命名地图')}:${createdAt}`)}`;
  const result = {
    ...old,
    mapId,
    version: MAP_VERSION,
    revision: 0,
    lastEventId: 0,
    name: String(old.name ?? '未命名地图').slice(0, MAX_NAME),
    createdAt,
    updatedAt,
    migration: { from: 1, migratedAt: now, actor: 'migration' },
    view: cleanRecord(old.view ?? { x: 0, y: 0, k: 1 }, 'view'),
    ui: cleanRecord(old.ui ?? {}, 'ui'),
    counters: cleanRecord(old.counters ?? {}, 'counters') as Record<string, number>,
    routes: (Array.isArray(old.routes) ? old.routes : []).map((v) => migrateObject(v, updatedAt, 'routes')),
    nodes: (Array.isArray(old.nodes) ? old.nodes : []).map((v) => migrateObject(v, updatedAt, 'nodes')),
    edges: (Array.isArray(old.edges) ? old.edges : []).map((v) => migrateObject(v, updatedAt, 'edges')),
    anns: (Array.isArray(old.anns) ? old.anns : []).map((v) => migrateObject(v, updatedAt, 'anns')),
  } as MapDocument;
  const validation = validateMapDocument(result);
  if (!validation.ok) throw mapError('MIGRATION_INVALID', 422, 'v1 数据无法安全迁移', validation.errors);
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateBaseObject(item: unknown, label: string, ids: Set<string>, errors: string[]): item is Record<string, unknown> {
  if (!isObject(item)) { errors.push(`${label} 必须是对象`); return false; }
  if (typeof item.id !== 'string' || !ID.test(item.id)) errors.push(`${label}.id 无效`);
  else if (ids.has(item.id)) errors.push(`重复 id: ${item.id}`);
  else ids.add(item.id);
  if (typeof item.createdAt !== 'string' || !ISO_MS.test(item.createdAt)) errors.push(`${label}.createdAt 必须是毫秒 UTC`);
  if (typeof item.updatedAt !== 'string' || !ISO_MS.test(item.updatedAt)) errors.push(`${label}.updatedAt 必须是毫秒 UTC`);
  if (typeof item.updatedBy !== 'string') errors.push(`${label}.updatedBy 缺失`);
  if (item.createdBy !== undefined && typeof item.createdBy !== 'string') errors.push(`${label}.createdBy 无效`);
  if (!Number.isInteger(item.updatedRevision) || Number(item.updatedRevision) < 0) errors.push(`${label}.updatedRevision 无效`);
  return true;
}

export function validateMapDocument(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ['map.json 必须是对象'] };
  if (value.version !== MAP_VERSION) return { ok: false, readOnly: true, errors: [`不支持 schema version ${String(value.version)}`] };
  if (typeof value.mapId !== 'string' || !ID.test(value.mapId)) errors.push('mapId 无效');
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0) errors.push('revision 无效');
  if (!Number.isInteger(value.lastEventId) || Number(value.lastEventId) < 0) errors.push('lastEventId 无效');
  if (typeof value.name !== 'string' || value.name.length > MAX_NAME) errors.push('name 无效或过长');
  if (typeof value.createdAt !== 'string' || !ISO_MS.test(value.createdAt)) errors.push('createdAt 必须是毫秒 UTC');
  if (typeof value.updatedAt !== 'string' || !ISO_MS.test(value.updatedAt)) errors.push('updatedAt 必须是毫秒 UTC');
  if (!isObject(value.view)) errors.push('view 必须是对象');
  if (!isObject(value.ui)) errors.push('ui 必须是对象');
  if (!isObject(value.counters)) errors.push('counters 必须是对象');

  const ids = new Set<string>();
  const byCollection: Record<Collection, Record<string, unknown>[]> = { routes: [], nodes: [], edges: [], anns: [] };
  for (const collection of COLLECTIONS) {
    const list = value[collection];
    if (!Array.isArray(list)) { errors.push(`${collection} 必须是数组`); continue; }
    if (list.length > 100_000) { errors.push(`${collection} 超过对象上限`); continue; }
    for (let i = 0; i < list.length; i += 1) {
      if (validateBaseObject(list[i], `${collection}[${i}]`, ids, errors)) byCollection[collection].push(list[i] as Record<string, unknown>);
    }
  }
  const nodeIds = new Set(byCollection.nodes.map((v) => String(v.id)));
  const routeIds = new Set(byCollection.routes.map((v) => String(v.id)));
  for (const [i, edge] of byCollection.edges.entries()) {
    if (!nodeIds.has(String(edge.from))) errors.push(`edges[${i}].from 引用不存在`);
    if (edge.to !== null && !nodeIds.has(String(edge.to))) errors.push(`edges[${i}].to 引用不存在`);
    if (!['success', 'failed', 'pending'].includes(String(edge.status))) errors.push(`edges[${i}].status 无效`);
    if (edge.route !== null && edge.route !== undefined && !routeIds.has(String(edge.route))) errors.push(`edges[${i}].route 引用不存在`);
    if (edge.score !== undefined && (!Number.isInteger(edge.score) || Number(edge.score) < 0 || Number(edge.score) > 100)) errors.push(`edges[${i}].score 无效`);
  }
  for (const [i, node] of byCollection.nodes.entries()) {
    if (node.route !== null && node.route !== undefined && !routeIds.has(String(node.route))) errors.push(`nodes[${i}].route 引用不存在`);
    if (node.milestone !== undefined) {
      const milestone = node.milestone;
      if (!isObject(milestone) || !['pending', 'approved', 'changes_requested'].includes(String(milestone.status))) {
        errors.push(`nodes[${i}].milestone 无效`);
      } else {
        if (milestone.origin !== undefined && !['human_created', 'agent_created'].includes(String(milestone.origin))) errors.push(`nodes[${i}].milestone.origin 无效`);
        if (milestone.level !== undefined && !['project', 'route', 'work'].includes(String(milestone.level))) errors.push(`nodes[${i}].milestone.level 无效`);
        if (milestone.createdBy !== undefined && typeof milestone.createdBy !== 'string') errors.push(`nodes[${i}].milestone.createdBy 无效`);
        if (milestone.updatedBy !== undefined && typeof milestone.updatedBy !== 'string') errors.push(`nodes[${i}].milestone.updatedBy 无效`);
      }
    }
  }
  for (const [i, ann] of byCollection.anns.entries()) {
    if (typeof ann.text !== 'string' || ann.text.length > MAX_ANN) errors.push(`anns[${i}].text 无效或过长`);
    if (!['new', 'delivered', 'acknowledged', 'resolved'].includes(String(ann.attention))) errors.push(`anns[${i}].attention 无效`);
    const target = ann.target;
    if (!isObject(target) || !['node', 'edge', 'canvas'].includes(String(target.kind))) errors.push(`anns[${i}].target 无效`);
    else if (target.kind === 'node' && !nodeIds.has(String(target.id))) errors.push(`anns[${i}] 节点目标不存在`);
    else if (target.kind === 'edge' && !byCollection.edges.some((e) => e.id === target.id)) errors.push(`anns[${i}] 方案目标不存在`);
  }
  return { ok: errors.length === 0, errors };
}

function getList(document: MapDocument, collection: Collection): Record<string, unknown>[] {
  return document[collection];
}

function findItem(document: MapDocument, collection: Collection, id: string): Record<string, unknown> {
  const item = getList(document, collection).find((entry) => entry.id === id);
  if (!item) throw mapError('NOT_FOUND', 404, `${collection}/${id} 不存在`);
  return item;
}

function touch(item: Record<string, unknown>, actor: Actor, revision: number, now: string): void {
  item.updatedAt = now;
  item.updatedBy = actor;
  item.updatedRevision = revision;
}

function assertName(value: unknown): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_NAME) throw mapError('INVALID_NAME', 422, '名称不能为空且不能超过 80 字');
}

function isAgent(actor: Actor): boolean {
  return typeof actor === 'string' && actor.startsWith('agent:');
}

function milestoneOrigin(actor: Actor): MilestoneOrigin | undefined {
  if (actor === 'human') return 'human_created';
  if (isAgent(actor)) return 'agent_created';
  return undefined;
}

function normalizeMilestone(value: unknown, actor: Actor, now: string, revision: number, existing?: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(value)) throw mapError('INVALID_MILESTONE', 422, '里程碑必须是对象');
  const merged = { ...(existing ?? {}), ...cleanRecord(value, 'milestone') };
  if (!['pending', 'approved', 'changes_requested'].includes(String(merged.status))) throw mapError('INVALID_MILESTONE', 422, '里程碑状态无效');
  if (merged.level !== undefined && !['project', 'route', 'work'].includes(String(merged.level))) throw mapError('INVALID_MILESTONE_LEVEL', 422, '里程碑层级必须是 project、route 或 work');
  const origin = milestoneOrigin(actor);
  if (existing?.origin !== undefined) merged.origin = existing.origin;
  else if (origin) merged.origin = origin;
  merged.level = (merged.level === undefined ? 'project' : merged.level);
  if (existing?.createdBy !== undefined) merged.createdBy = existing.createdBy;
  else merged.createdBy = actor;
  merged.updatedBy = actor;
  if (existing?.createdAt !== undefined) merged.createdAt = existing.createdAt;
  else merged.createdAt = now;
  merged.updatedAt = now;
  merged.updatedRevision = revision;
  return merged;
}

function assertAgentMilestoneAllowed(value: unknown): void {
  if (!isObject(value)) return;
  const level = value.level;
  if (level === 'work') {
    throw mapError('AGENT_WORK_MILESTONE_FORBIDDEN', 422, 'Agent 只能创建项目级或路线级大节点，不能把执行碎片建成里程碑', {
      suggestion: '合并为项目/路线阶段，或把执行细节写入 Markdown',
    });
  }
}

function applyOne(document: MapDocument, command: MapCommand, actor: Actor, revision: number, now: string): void {
  if (command.op === 'create') {
    const value = cleanRecord(command.value, 'value');
    if (typeof value.id !== 'string' || !ID.test(value.id)) throw mapError('INVALID_ID', 422, '新对象 ID 无效');
    if (getList(document, command.collection).some((v) => v.id === value.id)) throw mapError('DUPLICATE_ID', 409, `对象 ${value.id} 已存在`);
    if (command.collection !== 'anns') assertName(value.name);
    if (command.collection === 'nodes' && isAgent(actor)) {
      assertAgentMilestoneAllowed(value.milestone);
      if (value.level === 'work') assertAgentMilestoneAllowed(value);
    }
    const item: Record<string, unknown> = { ...value, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, updatedRevision: revision };
    if (command.collection === 'nodes' && value.milestone !== undefined) item.milestone = normalizeMilestone(value.milestone, actor, now, revision);
    if (command.collection === 'nodes' && item.md === undefined) item.md = stableMarkdownPath('nodes', String(item.id));
    if (command.collection === 'edges' && item.md === undefined) item.md = stableMarkdownPath('edges', String(item.id));
    if (command.collection === 'anns') {
      if (typeof item.text !== 'string' || item.text.length > MAX_ANN) throw mapError('INVALID_ANNOTATION', 422, '标注无效或过长');
      item.source = actor === 'human' ? 'human' : actor;
      item.priority = item.priority ?? 'normal';
      item.attention = actor === 'human' ? 'new' : (item.attention ?? 'acknowledged');
      item.acknowledgements = [];
    }
    getList(document, command.collection).push(item);
    return;
  }
  if (command.op === 'update') {
    const item = findItem(document, command.collection, command.id);
    const patch = cleanRecord(command.patch, 'patch');
    for (const key of ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'updatedRevision']) delete patch[key];
    if ('name' in patch) assertName(patch.name);
    if (command.collection === 'nodes' && isObject(patch.milestone)) {
      if (isAgent(actor)) {
        assertAgentMilestoneAllowed(patch.milestone);
      }
      patch.milestone = normalizeMilestone(patch.milestone, actor, now, revision, isObject(item.milestone) ? item.milestone : undefined);
    }
    Object.assign(item, patch);
    if (command.collection === 'anns' && actor === 'human') {
      item.source = 'human';
      item.attention = 'new';
      if (!Array.isArray(item.acknowledgements)) item.acknowledgements = [];
    }
    touch(item, actor, revision, now);
    return;
  }
  if (command.op === 'delete') {
    if (actor.startsWith('agent:')) throw mapError('HUMAN_APPROVAL_REQUIRED', 403, 'Agent 不能直接删除对象');
    const list = getList(document, command.collection);
    const index = list.findIndex((entry) => entry.id === command.id);
    if (index < 0) return;
    if (command.collection === 'nodes') {
      document.edges = document.edges.filter((edge) => edge.from !== command.id);
      for (const edge of document.edges) {
        if (edge.to === command.id) {
          edge.to = null;
          edge.status = 'pending';
          edge.dx = typeof edge.dx === 'number' ? edge.dx : 120;
          edge.dy = typeof edge.dy === 'number' ? edge.dy : 0;
          touch(edge, actor, revision, now);
        }
      }
      document.anns = document.anns.filter((ann) => !(isObject(ann.target) && ann.target.kind === 'node' && ann.target.id === command.id));
    }
    if (command.collection === 'edges') document.anns = document.anns.filter((ann) => !(isObject(ann.target) && ann.target.kind === 'edge' && ann.target.id === command.id));
    list.splice(index, 1);
    return;
  }
  if (command.op === 'set_view' || command.op === 'set_ui') {
    const key = command.op === 'set_view' ? 'view' : 'ui';
    document[key] = { ...document[key], ...cleanRecord(command.patch, key) };
    return;
  }
  if (command.op === 'deliver_annotations') {
    for (const id of command.ids) {
      const ann = findItem(document, 'anns', id);
      if (ann.attention === 'new') ann.attention = 'delivered';
      const deliveries = Array.isArray(ann.deliveries) ? ann.deliveries : [];
      if (!deliveries.some((entry) => isObject(entry) && entry.deliveryId === command.deliveryId)) deliveries.push({ deliveryId: command.deliveryId, sessionId: command.deliveryId, deliveredAt: now });
      ann.deliveries = deliveries;
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command.op === 'ack_annotations') {
    if (!actor.startsWith('agent:')) throw mapError('AGENT_REQUIRED', 403, '只有 Agent 会话可以确认读取');
    for (const id of command.ids) if (!command.summary.includes(id)) throw mapError('ACK_MISSING_ID', 422, `摘要没有引用标注 ${id}`);
    for (const id of command.ids) {
      const ann = findItem(document, 'anns', id);
      ann.attention = 'acknowledged';
      const records = Array.isArray(ann.acknowledgements) ? ann.acknowledgements : [];
      records.push({ actor, sessionId: actor, acknowledgedAt: now, summary: command.summary });
      ann.acknowledgements = records;
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command.op === 'resolve_annotations') {
    for (const id of command.ids) {
      const ann = findItem(document, 'anns', id);
      if (actor === 'human') ann.attention = 'resolved';
      else ann.resolutionProposal = { actor, evidence: command.evidence ?? '', proposedAt: now };
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command.op === 'suggest_milestone') {
    const node = findItem(document, 'nodes', command.nodeId);
    node.milestoneSuggestion = { status: command.status, reviewNote: command.reviewNote ?? null, suggestedBy: actor, suggestedAt: now };
    touch(node, actor, revision, now);
  }
}

export function applyMapCommand(document: MapDocument, command: MapCommand, options: { actor?: Actor; revision?: number; now?: string } = {}): MapDocument {
  const validation = validateMapDocument(document);
  if (!validation.ok) throw mapError('INVALID_MAP', 422, '当前地图无效', validation.errors);
  const next = clone(document);
  const revision = options.revision ?? next.revision + 1;
  const now = utcNow(options.now);
  applyOne(next, command, options.actor ?? 'human', revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const result = validateMapDocument(next);
  if (!result.ok) throw mapError('COMMAND_INVALID_RESULT', 422, '命令会产生无效地图', result.errors);
  return next;
}

export function applyCommandEnvelope(document: MapDocument, envelope: CommandEnvelope, options: { now?: string } = {}): MapDocument {
  if (!envelope || !Array.isArray(envelope.commands) || envelope.commands.length === 0 || envelope.commands.length > 100) throw mapError('INVALID_ENVELOPE', 400, 'commands 必须包含 1–100 条命令');
  if (!ID.test(envelope.projectId) || !ID.test(envelope.commandId) || !ID.test(envelope.sessionId)) throw mapError('INVALID_ENVELOPE', 400, 'projectId/commandId/sessionId 无效');
  if (!Number.isInteger(envelope.baseRevision) || envelope.baseRevision < 0) throw mapError('INVALID_ENVELOPE', 400, 'baseRevision 无效');
  const agentInitialMap = isAgent(envelope.actor)
    && (document.nodes.length === 0 || (isObject(document.ui?.initialization) && document.ui.initialization.status === 'in_progress'));
  if (isAgent(envelope.actor)) {
    const objectCommands = envelope.commands.filter((command) => ['create', 'update', 'delete'].includes(command.op));
    const nodeCreates = envelope.commands.filter((command) => command.op === 'create' && command.collection === 'nodes');
    const milestoneCreates = nodeCreates.filter((command) => isObject(command.value) && command.value.milestone !== undefined);
    if (objectCommands.length > MAX_AGENT_OBJECTS_PER_ENVELOPE) throw mapError('AGENT_BATCH_LIMIT', 422, 'Agent 单次最多修改 10 个对象，请先合并或让人选择', { maxObjects: MAX_AGENT_OBJECTS_PER_ENVELOPE, suggestion: '压缩执行碎片，保留项目/路线级结论' });
    if (nodeCreates.length > MAX_AGENT_NEW_NODES_PER_ENVELOPE) throw mapError('AGENT_NODE_LIMIT', 422, 'Agent 单次最多新增 5 个活跃节点，请先合并或分阶段提交', { maxNodes: MAX_AGENT_NEW_NODES_PER_ENVELOPE, suggestion: '只保留目标、阶段、结果或审核门' });
    if (milestoneCreates.length > MAX_AGENT_MILESTONES_PER_ENVELOPE) throw mapError('AGENT_MILESTONE_LIMIT', 422, 'Agent 单次最多新增 2 个里程碑大节点', { maxMilestones: MAX_AGENT_MILESTONES_PER_ENVELOPE, suggestion: '更新或合并已有阶段，不要创建执行碎片' });
    const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true).length;
    if (activeNodes + nodeCreates.length >= MAX_ACTIVE_NODES && nodeCreates.length) throw mapError('AGENT_ACTIVE_NODE_LIMIT', 422, '活跃节点将达到 30 个，Agent 必须先整理、合并或归档', { maxActiveNodes: MAX_ACTIVE_NODES, suggestion: '请让人选择整理路线' });
    if (agentInitialMap && activeNodes + nodeCreates.length > MAX_INITIAL_MAP_NODES) throw mapError('AGENT_INITIAL_MAP_LIMIT', 422, '首次初始化地图最多保留 15 个活跃节点，请压缩为目标、阶段、路线和待判断事项', { maxInitialNodes: MAX_INITIAL_MAP_NODES, suggestion: '不要按文件、目录、函数或聊天轮次建节点' });
  }
  const revision = document.revision + 1;
  const now = utcNow(options.now);
  let next = clone(document);
  if (agentInitialMap && !isObject(next.ui.initialization)) next.ui.initialization = { status: 'in_progress', startedBy: envelope.actor, startedAt: now };
  for (const command of envelope.commands) applyOne(next, command, envelope.actor, revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const validation = validateMapDocument(next);
  if (!validation.ok) throw mapError('COMMAND_INVALID_RESULT', 422, '命令会产生无效地图', validation.errors);
  return next;
}

export function commandTouches(command: MapCommand): string[] {
  if (command.op === 'create' || command.op === 'delete') return [`${command.collection}/${command.op === 'create' ? String(command.value.id ?? '*') : command.id}/*`];
  if (command.op === 'update') return Object.keys(command.patch).map((key) => `${command.collection}/${command.id}/${key}`);
  if (command.op === 'set_view' || command.op === 'set_ui') return Object.keys(command.patch).map((key) => `${command.op === 'set_view' ? 'view' : 'ui'}/${key}`);
  if ('ids' in command) return command.ids.map((id) => `anns/${id}/attention`);
  if (command.op === 'suggest_milestone') return [`nodes/${command.nodeId}/milestoneSuggestion`];
  return ['*'];
}

export function envelopeTouches(envelope: CommandEnvelope): string[] {
  return [...new Set(envelope.commands.flatMap(commandTouches))].sort();
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().normalize('NFKC');
  const words = normalized.match(/[a-z0-9_:-]+/g) ?? [];
  const chinese = [...normalized.matchAll(/[\p{Script=Han}]+/gu)].flatMap((match) => {
    const chars = Array.from(match[0]);
    return chars.length < 2 ? chars : chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
  });
  return [...new Set([...words, ...chinese])];
}

function objectText(item: Record<string, unknown>): string {
  return [item.id, item.name, item.type, item.text, item.status, item.reviewNote].filter((v) => typeof v === 'string').join(' ');
}

function ageScore(updatedAt: unknown, now: Date): number {
  if (typeof updatedAt !== 'string') return 0;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  return Math.max(0, 60 - Math.floor(days) * 5);
}

export interface MarkdownDocument { path: string; text: string }
export interface RetrievalItem { kind: Collection | 'markdown'; id: string; score: number; reasons: string[]; value?: Record<string, unknown>; path?: string; snippet?: string; source?: string; relationPath?: string[] }

function bm25(query: string[], docs: MarkdownDocument[]): Array<{ doc: MarkdownDocument; score: number }> {
  if (query.length === 0 || docs.length === 0) return [];
  const tokenized = docs.map((doc) => tokenize(doc.text));
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, tokenized.length);
  return docs.map((doc, index) => {
    const tokens = tokenized[index];
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of query) {
      const frequency = counts.get(term) ?? 0;
      if (!frequency) continue;
      const present = tokenized.filter((entry) => entry.includes(term)).length;
      const idf = Math.log(1 + (docs.length - present + 0.5) / (present + 0.5));
      score += idf * ((frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * tokens.length / Math.max(1, averageLength))));
    }
    return { doc, score };
  }).filter((entry) => entry.score > 0);
}

export function retrieveContext(document: MapDocument, query: string, options: { markdown?: MarkdownDocument[]; now?: string; includeHistory?: boolean; currentNodeId?: string | null; limit?: number } = {}): { objects: RetrievalItem[]; markdown: RetrievalItem[] } {
  const normalizedQuery = typeof query === 'string' ? query : '';
  const terms = tokenize(normalizedQuery);
  const queryLower = normalizedQuery.toLowerCase();
  const limit = Math.max(1, Math.min(12, Number.isInteger(options.limit) ? Number(options.limit) : 12));
  const now = new Date(options.now ?? Date.now());
  const all: Array<{ kind: Collection; item: Record<string, unknown> }> = COLLECTIONS.flatMap((kind) => document[kind].map((item) => ({ kind, item })));
  const active = all.filter(({ item, kind }) => options.includeHistory || (!(item.archived === true || item.shelved === true) && !(kind === 'edges' && document.routes.some((route) => route.id === item.route && route.archived === true))));
  const seeds = new Set<string>();
  for (const { item } of active) {
    const id = String(item.id ?? '').toLowerCase();
    const name = String(item.name ?? '').toLowerCase();
    if ((id && queryLower.includes(id)) || (name && queryLower.includes(name))) seeds.add(String(item.id));
  }
  if (typeof options.currentNodeId === 'string' && active.some(({ item }) => String(item.id) === options.currentNodeId)) seeds.add(options.currentNodeId);
  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => { if (!adjacency.has(a)) adjacency.set(a, new Set()); adjacency.get(a)!.add(b); };
  for (const edge of document.edges) if (typeof edge.from === 'string' && typeof edge.to === 'string') { connect(edge.from, edge.to); connect(edge.to, edge.from); }
  const oneHop = new Set<string>();
  for (const seed of seeds) for (const id of adjacency.get(seed) ?? []) oneHop.add(id);
  const twoHop = new Set<string>();
  for (const id of oneHop) for (const next of adjacency.get(id) ?? []) if (!seeds.has(next) && !oneHop.has(next)) twoHop.add(next);
  const seedRoutes = new Set(active.filter(({ item }) => seeds.has(String(item.id))).map(({ item }) => item.route).filter((v): v is string => typeof v === 'string'));

  const ranked: RetrievalItem[] = [];
  for (const { kind, item } of active) {
    const reasons: string[] = [];
    let score = 0;
    const id = String(item.id);
    const text = objectText(item).toLowerCase();
    if (seeds.has(id)) {
      score += 1000;
      reasons.push(options.currentNodeId === id ? '当前推进节点' : '问题明确提到该对象');
    }
    const tokenHits = terms.filter((term) => text.includes(term)).length;
    if (tokenHits) { score += Math.min(250, tokenHits * 50); reasons.push(`文本命中 ${tokenHits} 个词元`); }
    if (kind === 'anns' && (item.attention === 'new' || item.attention === 'delivered')) { score += 800; reasons.push('人类新标注尚未确认'); }
    if (kind === 'anns' && isObject(item.target) && seeds.has(String(item.target.id))) { score += 800; reasons.push('标注属于明确目标'); }
    if (kind === 'nodes' && isObject(item.milestone) && item.milestone.status === 'pending') { score += 500; reasons.push('里程碑待审核'); }
    if (oneHop.has(id)) { score += 300; reasons.push('明确目标的一跳邻居'); }
    if (typeof item.route === 'string' && seedRoutes.has(item.route)) { score += 200; reasons.push('与明确目标属于同一路线'); }
    if (twoHop.has(id)) { score += 120; reasons.push('明确目标的两跳邻居'); }
    if (kind === 'edges' && item.status === 'pending') { score += 100; reasons.push('待验证方案'); }
    if (kind === 'edges' && typeof item.score === 'number') { score += item.score; reasons.push(`质量评分 ${item.score}`); }
    const recent = ageScore(item.updatedAt, now);
    if (recent) { score += recent; reasons.push(`最近修改 +${recent}`); }
    if (score > 0) {
      const relationPath = options.currentNodeId && id !== options.currentNodeId && (oneHop.has(id) || twoHop.has(id))
        ? [options.currentNodeId, id]
        : seeds.has(id) ? [id] : [];
      ranked.push({ kind, id, score, reasons, source: typeof item.source === 'string' ? item.source : (typeof item.createdBy === 'string' ? item.createdBy : kind), relationPath, value: clone(item) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const markdownScores = bm25(terms, options.markdown ?? []);
  const max = Math.max(0, ...markdownScores.map((entry) => entry.score));
  const markdown = markdownScores.map(({ doc, score }) => ({
    kind: 'markdown' as const,
    id: doc.path,
    path: doc.path,
    score: max ? Math.round(score / max * 300) : 0,
    reasons: ['Markdown BM25 命中'],
    source: 'markdown',
    relationPath: [],
    snippet: doc.text.replace(/\s+/g, ' ').slice(0, 320),
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 6);
  return { objects: ranked.slice(0, limit), markdown };
}

export function autonomyDecision(document: MapDocument, candidates: RetrievalItem[]): { auto: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (document.anns.some((ann) => ann.attention === 'new' || ann.attention === 'delivered')) reasons.push('存在尚未确认的人类标注');
  if (document.nodes.some((node) => isObject(node.milestone) && node.milestone.status === 'pending')) reasons.push('存在待审核里程碑');
  const first = candidates[0]?.score ?? 0;
  const second = candidates[1]?.score ?? 0;
  if (first < 500 || first - second < 150) reasons.push('候选置信度或领先幅度不足');
  return { auto: reasons.length === 0, reasons };
}
