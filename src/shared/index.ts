export const MAP_VERSION = 2 as const;
export const COLLECTIONS = ['routes', 'nodes', 'edges', 'anns'] as const;
export type Collection = typeof COLLECTIONS[number];
export type Actor = 'human' | `agent:${string}` | 'migration';
/** Stable semantic for a node.  `type` remains a display/legacy field. */
export type NodeKind = 'goal' | 'problem' | 'result';
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
  | { op: 'update'; collection: Collection; id: string; patch: Record<string, unknown>; humanOnly?: boolean }
  | { op: 'delete'; collection: Collection; id: string }
  | { op: 'set_view'; patch: Record<string, unknown> }
  | { op: 'set_ui'; patch: Record<string, unknown> }
  | { op: 'set_meta'; patch: { name: string } }
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
  /** 多地图布局：本图的项目相对数据目录（如 .live-dot-map/maps/default），缺省视为 .live-dot-map。 */
  mapDir?: string;
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

/** 文档所属的地图目录；老文档没有 mapDir 字段时回退单图布局根目录。 */
export function documentMapDir(document: Pick<MapDocument, 'mapDir'> | Record<string, unknown>): string {
  const value = (document as Record<string, unknown>).mapDir;
  return typeof value === 'string' && value ? value : '.live-dot-map';
}

export function stableMarkdownPath(collection: 'nodes' | 'edges', id: string, mapDir = '.live-dot-map'): string {
  if (!ID.test(id)) throw mapError('INVALID_ID', 400, '对象 ID 无效');
  return collection === 'nodes' ? `${mapDir}/nodes/${id}.md` : `${mapDir}/routes/${id}.md`;
}

export function createEmptyMap(options: { name?: string; now?: string; mapId?: string; mapDir?: string } = {}): MapDocument {
  const now = utcNow(options.now);
  const mapId = options.mapId ?? `map-${fnv1a(`${options.name ?? '未命名地图'}:${now}`)}`;
  return {
    mapId,
    version: MAP_VERSION,
    revision: 0,
    lastEventId: 0,
    name: String(options.name ?? '未命名地图').slice(0, MAX_NAME),
    ...(options.mapDir ? { mapDir: options.mapDir } : {}),
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
  if (collection === 'nodes') {
    const legacyType = String(item.type ?? '');
    migrated.kind = item.kind === 'goal' || item.kind === 'problem' || item.kind === 'result'
      ? item.kind
      : legacyType === '问题' || legacyType === 'problem' ? 'problem'
        : legacyType === '结果' || legacyType === 'result' ? 'result' : 'goal';
  }
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

function normalizeNodeKind(value: unknown): NodeKind {
  if (value === 'goal' || value === 'problem' || value === 'result') return value;
  if (value === '问题' || value === 'problem') return 'problem';
  if (value === '结果' || value === 'result') return 'result';
  return 'goal';
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
  for (const [i, route] of byCollection.routes.entries()) {
    if (route.currentNodeId === undefined || route.currentNodeId === null) continue;
    if (typeof route.currentNodeId !== 'string' || !nodeIds.has(route.currentNodeId)) {
      errors.push(`routes[${i}].currentNodeId 引用不存在`);
      continue;
    }
    const current = byCollection.nodes.find((node) => node.id === route.currentNodeId);
    if (current && current.route !== route.id) errors.push(`routes[${i}].currentNodeId 不属于该路线`);
  }
  for (const [i, edge] of byCollection.edges.entries()) {
    if (!nodeIds.has(String(edge.from))) errors.push(`edges[${i}].from 引用不存在`);
    if (edge.to !== null && !nodeIds.has(String(edge.to))) errors.push(`edges[${i}].to 引用不存在`);
    if (!['success', 'failed', 'pending'].includes(String(edge.status))) errors.push(`edges[${i}].status 无效`);
    if (edge.route !== null && edge.route !== undefined && !routeIds.has(String(edge.route))) errors.push(`edges[${i}].route 引用不存在`);
    if (edge.score !== undefined && (!Number.isInteger(edge.score) || Number(edge.score) < 0 || Number(edge.score) > 100)) errors.push(`edges[${i}].score 无效`);
  }
  for (const [i, node] of byCollection.nodes.entries()) {
    if (node.kind !== undefined && !['goal', 'problem', 'result'].includes(String(node.kind))) errors.push(`nodes[${i}].kind 无效`);
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

function assertAgentCurationAllowed(value: Record<string, unknown>, actor: Actor): void {
  if (!isAgent(actor)) return;
  const fields = ['archived', 'shelved'].filter((field) => value[field] === true);
  if (!fields.length) return;
  throw mapError('HUMAN_APPROVAL_REQUIRED', 403, 'Agent 不能直接归档或搁置地图记忆，必须等待人在画布审核后提交', {
    fields,
    suggestion: '调用 map_plan_consolidation 生成只读建议，等待人类审核',
  });
}

function assertHumanOnlyCommand(command: MapCommand, actor: Actor): void {
  if (isAgent(actor) && command.op === 'update' && command.humanOnly === true) {
    throw mapError('HUMAN_APPROVAL_REQUIRED', 403, '该整理命令只能由人在画布审核后提交', {
      suggestion: '先调用 map_plan_consolidation 查看只读建议，再由人在画布确认',
    });
  }
}

function applyOne(document: MapDocument, command: MapCommand, actor: Actor, revision: number, now: string): void {
  assertHumanOnlyCommand(command, actor);
  if (command.op === 'create') {
    const value = cleanRecord(command.value, 'value');
    if (typeof value.id !== 'string' || !ID.test(value.id)) throw mapError('INVALID_ID', 422, '新对象 ID 无效');
    if (getList(document, command.collection).some((v) => v.id === value.id)) throw mapError('DUPLICATE_ID', 409, `对象 ${value.id} 已存在`);
    if (command.collection !== 'anns') assertName(value.name);
    if (command.collection === 'nodes') {
      if (value.kind !== undefined && !['goal', 'problem', 'result'].includes(String(value.kind))) throw mapError('INVALID_NODE_KIND', 422, '节点 kind 必须是 goal、problem 或 result');
      value.kind = normalizeNodeKind(value.kind ?? value.type);
    }
    if (command.collection === 'nodes' && isAgent(actor)) {
      assertAgentMilestoneAllowed(value.milestone);
      if (value.level === 'work') assertAgentMilestoneAllowed(value);
    }
    assertAgentCurationAllowed(value, actor);
    const item: Record<string, unknown> = { ...value, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, updatedRevision: revision };
    if (command.collection === 'nodes' && value.milestone !== undefined) item.milestone = normalizeMilestone(value.milestone, actor, now, revision);
    if (command.collection === 'nodes' && item.md === undefined) item.md = stableMarkdownPath('nodes', String(item.id), documentMapDir(document));
    if (command.collection === 'edges' && item.md === undefined) item.md = stableMarkdownPath('edges', String(item.id), documentMapDir(document));
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
    if (command.collection === 'nodes' && 'kind' in patch) {
      if (!['goal', 'problem', 'result'].includes(String(patch.kind))) throw mapError('INVALID_NODE_KIND', 422, '节点 kind 必须是 goal、problem 或 result');
    }
    assertAgentCurationAllowed(patch, actor);
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
      for (const route of document.routes) {
        if (route.currentNodeId === command.id) {
          delete route.currentNodeId;
          touch(route, actor, revision, now);
        }
      }
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
  if (command.op === 'set_meta') {
    const patch = cleanRecord(command.patch, 'meta');
    assertName(patch.name);
    document.name = String(patch.name).trim().slice(0, MAX_NAME);
    document.updatedAt = now;
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
    return;
  }
  throw mapError('UNKNOWN_COMMAND', 400, `不支持的地图命令：${String((command as { op?: unknown })?.op ?? '')}`);
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
    const nodeCreates = envelope.commands.filter((command) => command.op === 'create' && command.collection === 'nodes') as Array<{ op: 'create'; collection: 'nodes'; value: Record<string, unknown> }>;
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
  if (command.op === 'set_meta') return ['meta/name'];
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
  return [item.id, item.name, item.kind, item.type, item.text, item.status, item.reviewNote].filter((v) => typeof v === 'string').join(' ');
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

export interface AttemptEvidenceIssue {
  edgeId: string;
  status: 'pending' | 'success' | 'failed';
  path: string;
  missing: string[];
  reason: string;
}

function headingContent(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text).match(new RegExp(`^\\s*[-#]*\\s*${escaped}\\s*[:：]?\\s*([\\s\\S]*?)(?=\\n\\s*[-#]+\\s|\\n\\s*[\\u4e00-\\u9fffA-Za-z][^\\n]{0,40}[:：]\\s|$)`, 'im'));
  return match?.[1]?.trim() ?? '';
}

/**
 * Check only Agent-authored scheme edges.  Human edges remain valid without
 * this template because a human may keep their own Markdown structure.  The
 * check is deliberately semantic-light: it only verifies that a future
 * session has a result/evidence/next-step anchor to read, never judges prose.
 */
export function checkAttemptEvidence(document: MapDocument, markdown: MarkdownDocument[] = []): AttemptEvidenceIssue[] {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, '/'), String(item.text ?? '')]));
  const issues: AttemptEvidenceIssue[] = [];
  for (const edge of document.edges) {
    const actor = String(edge.updatedBy ?? edge.createdBy ?? '');
    if (!actor.startsWith('agent:') || !['pending', 'success', 'failed'].includes(String(edge.status))) continue;
    const status = String(edge.status) as AttemptEvidenceIssue['status'];
    const path = String(edge.md ?? stableMarkdownPath('edges', String(edge.id), documentMapDir(document))).replace(/\\/g, '/');
    const text = docs.get(path) ?? '';
    const required = status === 'pending' ? ['关键证据', '下一步'] : ['关键证据', '结果', '下一步'];
    if (status === 'failed') required.push('失败原因');
    if (status === 'success') required.push('评分');
    const missing = required.filter((heading) => !headingContent(text, heading));
    if (!text) missing.splice(0, missing.length, 'Markdown 文件');
    if (missing.length) issues.push({ edgeId: String(edge.id), status, path, missing, reason: `Agent 方案 ${String(edge.id)} 缺少：${missing.join('、')}` });
  }
  return issues;
}

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
  for (const edge of document.edges) {
    if (typeof edge.from !== 'string') continue;
    // Treat a scheme line as a one-hop actionable object as well as a graph
    // relation.  This lets map_next_candidates distinguish a direct branch
    // from an unrelated text match without changing the public query shape.
    const edgeId = String(edge.id);
    connect(edgeId, edge.from);
    connect(edge.from, edgeId);
    if (typeof edge.to === 'string') {
      connect(edgeId, edge.to);
      connect(edge.to, edgeId);
      connect(edge.from, edge.to);
      connect(edge.to, edge.from);
    }
  }
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
    if (kind === 'nodes' && normalizeNodeKind(item.kind ?? item.type) === 'problem' && item.resolved !== true) { score += 700; reasons.push('未解决问题节点'); }
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

export interface ProjectProjection {
  totalGoal: string;
  mainRoute: { id: string | null; name: string; status: string; currentNodeId: string | null };
  current: { nodeId: string | null; nodeName: string | null; routeId: string | null; source: 'stored' | 'inferred' | 'none' };
  activeRoutes: Array<{ id: string; name: string; status: string; nodeCount: number; edgeCount: number; currentNodeId: string | null }>;
  pendingCandidates: Array<{ id: string; name: string; from: string; to: string | null; score: number; routeId: string | null; reason: string }>;
  recentOutcomes: Array<{ id: string; name: string; status: string; score: number | null; routeId: string | null; updatedAt: string }>;
  stalledRoutes: Array<{ id: string; name: string; reason: string; updatedAt: string | null }>;
  humanUpdates: Array<{ id: string; text: string; attention: string; priority: string; target: unknown }>;
  problems: Array<{ id: string; name: string; kind: 'problem'; resolved: boolean; routeId: string | null; updatedAt: string }>;
  milestones: Array<{ id: string; name: string; status: string; origin: string; routeId: string | null }>;
}

export interface ExplorationAlternative {
  id: string;
  sourceNodeId: string;
  routeId: string | null;
  /** Whether this direction already has a completed attempt. */
  isTried: boolean;
  /** Whether the candidate belongs to a route different from its source. */
  isCrossRoute: boolean;
  /** Route containing the source node (or the route source fallback). */
  sourceRouteId: string | null;
  /** A short, human-readable explanation of why this can be tried. */
  reason: string;
  status: string;
  score: number;
  reasons: string[];
}

/** Return at most a few actionable branches after a failed attempt. */
export function findExplorationAlternatives(document: MapDocument, currentNodeId: string | null = null, options: { limit?: number } = {}): ExplorationAlternative[] {
  const limit = Math.max(1, Math.min(3, Number.isInteger(options.limit) ? Number(options.limit) : 3));
  const nodeById = new Map(document.nodes.map((node) => [String(node.id), node]));
  const routeById = new Map(document.routes.map((route) => [String(route.id), route]));
  const routeForNode = (nodeId: string | null): string | null => {
    if (!nodeId) return null;
    const nodeRoute = nodeById.get(nodeId)?.route;
    if (typeof nodeRoute === 'string') return nodeRoute;
    const sourceRoute = document.routes.find((route) => route.source === nodeId);
    return sourceRoute ? String(sourceRoute.id) : null;
  };
  const routeSource = (routeId: string | null): string | null => {
    if (!routeId) return null;
    const source = routeById.get(routeId)?.source;
    return typeof source === 'string' ? source : null;
  };
  const normalizeName = (value: unknown): string => String(value ?? '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
  type FailureContext = { edge: Record<string, unknown>; sourceNodeId: string | null; sourceRouteId: string | null; terms: string[]; key: string };
  const resolveSourceNode = (edge: Record<string, unknown>): string | null => {
    if (typeof edge.from === 'string' && edge.from) return edge.from;
    const edgeRoute = typeof edge.route === 'string' ? edge.route : null;
    return routeSource(edgeRoute);
  };
  const resolveRouteId = (edge: Record<string, unknown>, sourceNodeId: string | null): string | null => {
    if (typeof edge.route === 'string' && edge.route) return edge.route;
    return routeForNode(sourceNodeId);
  };
  const failedContexts: FailureContext[] = document.edges
    .filter((edge) => edge.archived !== true && edge.shelved !== true && edge.status === 'failed')
    .map((edge) => {
      const sourceNodeId = resolveSourceNode(edge);
      const sourceRouteId = routeForNode(sourceNodeId) ?? resolveRouteId(edge, sourceNodeId);
      const terms = tokenize(String(edge.name ?? ''));
      return { edge, sourceNodeId, sourceRouteId, terms, key: `${sourceNodeId ?? ''}:${normalizeName(edge.name)}` };
    });
  const requestedSource = typeof currentNodeId === 'string' && currentNodeId ? currentNodeId : null;
  const requestedRoute = routeForNode(requestedSource);
  const relevantFailures = failedContexts.filter((failure) => !requestedSource || failure.sourceNodeId === requestedSource || failure.sourceNodeId === null && failure.sourceRouteId === requestedRoute);
  const sourceIds = new Set<string>([...(requestedSource ? [requestedSource] : []), ...relevantFailures.flatMap((failure) => failure.sourceNodeId ? [failure.sourceNodeId] : [])]);
  const sourceRouteIds = new Set<string>([...(requestedRoute ? [requestedRoute] : []), ...relevantFailures.flatMap((failure) => failure.sourceRouteId ? [failure.sourceRouteId] : [])]);
  const failedTerms = new Set(relevantFailures.flatMap((failure) => failure.terms));
  const failedKeys = new Set(relevantFailures.map((failure) => failure.key));
  const active = document.edges.filter((edge) => {
    if (edge.archived === true || edge.shelved === true || !['pending', 'success'].includes(String(edge.status))) return false;
    const edgeRouteId = typeof edge.route === 'string' ? edge.route : null;
    if (edgeRouteId && routeById.get(edgeRouteId)?.archived === true) return false;
    return true;
  });
  const rank = (edge: Record<string, unknown>): ExplorationAlternative | null => {
    const sourceNodeId = resolveSourceNode(edge);
    const candidateRouteId = resolveRouteId(edge, sourceNodeId);
    const terms = tokenize(String(edge.name ?? ''));
    const overlap = terms.filter((term) => failedTerms.has(term)).length;
    const sameSource = Boolean(sourceNodeId && sourceIds.has(sourceNodeId));
    const matchingFailure = relevantFailures
      .map((failure) => ({ failure, overlap: terms.filter((term) => failure.terms.includes(term)).length }))
      .sort((a, b) => Number(b.failure.sourceNodeId === sourceNodeId) - Number(a.failure.sourceNodeId === sourceNodeId) || b.overlap - a.overlap || String(a.failure.edge.id).localeCompare(String(b.failure.edge.id)))[0]?.failure;
    const effectiveSourceNodeId = sourceNodeId ?? matchingFailure?.sourceNodeId ?? requestedSource ?? '';
    const sourceRouteId = matchingFailure?.sourceRouteId ?? routeForNode(effectiveSourceNodeId) ?? (sourceRouteIds.size === 1 ? [...sourceRouteIds][0] : null);
    const isCrossRoute = Boolean(candidateRouteId && sourceRouteId && candidateRouteId !== sourceRouteId);
    const isTried = String(edge.status) !== 'pending';
    const candidateKey = `${effectiveSourceNodeId}:${normalizeName(edge.name)}`;
    // A pending edge with the same source/name as a failed edge is the same
    // direction, not an alternative.  A successful cross-route precedent is
    // intentionally retained so it can be used as evidence.
    if (String(edge.status) !== 'success' && failedKeys.has(candidateKey)) return null;
    const reasons: string[] = [];
    if (sameSource) reasons.push('同一来源节点的替代方案');
    if (overlap) reasons.push(`与失败方向共享 ${overlap} 个关键词`);
    if (isCrossRoute) reasons.push(`跨路线候选（来源路线 ${sourceRouteId ?? '未知'}）`);
    if (edge.status === 'success') reasons.push(isCrossRoute ? '其他路线已有成功证据' : '已有成功证据，可复用');
    if (edge.status === 'pending') reasons.push('尚未验证，可继续尝试');
    if (!reasons.length) return null;
    const quality = typeof edge.score === 'number' ? edge.score : 0;
    const score = quality + (sameSource ? 400 : 0) + overlap * 80;
    const reason = isCrossRoute
      ? `${isTried ? '已有成功证据' : '待验证方向'}；跨路线${overlap ? '相似' : '分支'}候选，来源路线 ${sourceRouteId ?? '未知'}`
      : `${isTried ? '已有成功证据' : '待验证方向'}；回到来源节点 ${effectiveSourceNodeId || '未知'} 的替代方案`;
    return {
      id: String(edge.id),
      sourceNodeId: effectiveSourceNodeId,
      routeId: candidateRouteId,
      isTried,
      isCrossRoute,
      sourceRouteId,
      reason,
      status: String(edge.status),
      score,
      reasons,
    };
  };
  return active
    .map(rank)
    .filter((item): item is ExplorationAlternative => Boolean(item))
    .filter((item) => sourceIds.size > 0 ? item.sourceNodeId !== '' || item.reasons.some((reason) => reason.includes('关键词')) : item.reasons.some((reason) => reason.includes('关键词')))
    .sort((a, b) => Number(a.isCrossRoute) - Number(b.isCrossRoute) || Number(a.isTried) - Number(b.isTried) || b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * Build the small, deterministic “project header” injected at session start.
 * It is intentionally a projection, not a second memory store: every field
 * comes from map.json and points the agent back to the canonical node/route.
 */
export function buildProjectProjection(document: MapDocument, options: { now?: string; maxRoutes?: number; maxCandidates?: number } = {}): ProjectProjection {
  const now = new Date(options.now ?? Date.now());
  const maxRoutes = Math.max(1, Math.min(12, Number.isInteger(options.maxRoutes) ? Number(options.maxRoutes) : 6));
  const maxCandidates = Math.max(1, Math.min(12, Number.isInteger(options.maxCandidates) ? Number(options.maxCandidates) : 6));
  const activeRoutes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const routeById = new Map(activeRoutes.map((route) => [String(route.id), route]));
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const activeEdges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && (!edge.route || !document.routes.some((route) => route.id === edge.route && route.archived === true)));
  const nodesByRoute = new Map<string, Record<string, unknown>[]>();
  for (const node of activeNodes) {
    const route = typeof node.route === 'string' ? node.route : '';
    if (!nodesByRoute.has(route)) nodesByRoute.set(route, []);
    nodesByRoute.get(route)!.push(node);
  }
  const edgesByRoute = new Map<string, Record<string, unknown>[]>();
  for (const edge of activeEdges) {
    const route = typeof edge.route === 'string' ? edge.route : '';
    if (!edgesByRoute.has(route)) edgesByRoute.set(route, []);
    edgesByRoute.get(route)!.push(edge);
  }
  const updatedTime = (item: Record<string, unknown>): number => {
    const value = new Date(String(item.updatedAt ?? '')).getTime();
    return Number.isFinite(value) ? value : 0;
  };
  const routeScore = (route: Record<string, unknown>): number => Math.max(updatedTime(route), ...(nodesByRoute.get(String(route.id)) ?? []).map(updatedTime));
  const sortedRoutes = [...activeRoutes].sort((a, b) => routeScore(b) - routeScore(a) || String(a.id).localeCompare(String(b.id)));
  const mainRoute = activeRoutes.find((route) => route.main === true) ?? sortedRoutes[0] ?? null;
  const nodeForRoute = (route: Record<string, unknown> | null): { node: Record<string, unknown> | null; source: 'stored' | 'inferred' | 'none' } => {
    if (!route) return { node: null, source: 'none' };
    const candidates = nodesByRoute.get(String(route.id)) ?? [];
    const stored = typeof route.currentNodeId === 'string' ? candidates.find((node) => node.id === route.currentNodeId) : undefined;
    if (stored) return { node: stored, source: 'stored' };
    const routeEdges = edgesByRoute.get(String(route.id)) ?? [];
    const hasOutgoing = new Set(routeEdges.map((edge) => String(edge.from)));
    const terminal = candidates.filter((node) => !hasOutgoing.has(String(node.id)));
    const inferred = [...(terminal.length ? terminal : candidates)].sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
    return { node: inferred, source: inferred ? 'inferred' : 'none' };
  };
  const currentChoice = nodeForRoute(mainRoute);
  const currentNodeId = currentChoice.node ? String(currentChoice.node.id) : null;
  const currentRouteId = mainRoute ? String(mainRoute.id) : null;
  const pendingCandidates = activeEdges.filter((edge) => edge.status === 'pending' && (!currentRouteId || edge.route === currentRouteId || edge.from === currentNodeId))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id)))
    .slice(0, maxCandidates)
    .map((edge) => ({ id: String(edge.id), name: String(edge.name ?? edge.id), from: String(edge.from), to: edge.to === null || edge.to === undefined ? null : String(edge.to), score: typeof edge.score === 'number' ? edge.score : 0, routeId: typeof edge.route === 'string' ? edge.route : null, reason: edge.from === currentNodeId ? '从当前节点延伸的待验证方案' : '当前主路线的待验证方案' }));
  const recentOutcomes = activeEdges.filter((edge) => edge.status === 'success' || edge.status === 'failed')
    .sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 6)
    .map((edge) => ({ id: String(edge.id), name: String(edge.name ?? edge.id), status: String(edge.status), score: typeof edge.score === 'number' ? edge.score : null, routeId: typeof edge.route === 'string' ? edge.route : null, updatedAt: String(edge.updatedAt ?? '') }));
  const staleDays = (item: Record<string, unknown>): number => {
    const timestamp = updatedTime(item);
    return timestamp ? Math.max(0, (now.getTime() - timestamp) / 86_400_000) : 999;
  };
  const stalledRoutes = activeRoutes.filter((route) => staleDays(route) >= 7 || (nodesByRoute.get(String(route.id)) ?? []).length === 0)
    .sort((a, b) => staleDays(b) - staleDays(a) || String(a.id).localeCompare(String(b.id))).slice(0, 6)
    .map((route) => ({ id: String(route.id), name: String(route.name ?? route.id), reason: (nodesByRoute.get(String(route.id)) ?? []).length === 0 ? '路线暂无节点' : `已 ${Math.floor(staleDays(route))} 天没有更新`, updatedAt: typeof route.updatedAt === 'string' ? route.updatedAt : null }));
  const humanUpdates = document.anns.filter((ann) => ann.source === 'human' && ['new', 'delivered'].includes(String(ann.attention)))
    .sort((a, b) => (String(a.attention) === 'new' ? -1 : 1) - (String(b.attention) === 'new' ? -1 : 1) || updatedTime(b) - updatedTime(a)).slice(0, 6)
    .map((ann) => ({ id: String(ann.id), text: String(ann.text ?? ''), attention: String(ann.attention), priority: String(ann.priority ?? 'normal'), target: clone(ann.target) }));
  const problems = activeNodes.filter((node) => normalizeNodeKind(node.kind ?? node.type) === 'problem' && node.resolved !== true)
    .sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 12)
    .map((node) => ({ id: String(node.id), name: String(node.name ?? node.id), kind: 'problem' as const, resolved: false, routeId: typeof node.route === 'string' ? node.route : null, updatedAt: String(node.updatedAt ?? '') }));
  const milestones = activeNodes.filter((node) => isObject(node.milestone) && ['pending', 'changes_requested'].includes(String(node.milestone.status)))
    .sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 6)
    .map((node) => ({ id: String(node.id), name: String(node.name ?? node.id), status: String((node.milestone as Record<string, unknown>).status), origin: String((node.milestone as Record<string, unknown>).origin ?? 'unknown'), routeId: typeof node.route === 'string' ? node.route : null }));
  return {
    totalGoal: String(document.goal ?? document.name ?? '未命名地图'),
    mainRoute: { id: mainRoute ? String(mainRoute.id) : null, name: mainRoute ? String(mainRoute.name ?? mainRoute.id) : '暂无主路线', status: mainRoute ? String(mainRoute.status ?? 'active') : 'empty', currentNodeId },
    current: { nodeId: currentNodeId, nodeName: currentChoice.node ? String(currentChoice.node.name ?? currentChoice.node.id) : null, routeId: currentRouteId, source: currentChoice.source },
    activeRoutes: sortedRoutes.slice(0, maxRoutes).map((route) => ({ id: String(route.id), name: String(route.name ?? route.id), status: String(route.status ?? 'active'), nodeCount: (nodesByRoute.get(String(route.id)) ?? []).length, edgeCount: (edgesByRoute.get(String(route.id)) ?? []).length, currentNodeId: typeof route.currentNodeId === 'string' ? route.currentNodeId : null })),
    pendingCandidates,
    recentOutcomes,
    stalledRoutes,
    humanUpdates,
    problems,
    milestones,
  };
}

export function autonomyDecision(document: MapDocument, candidates: RetrievalItem[]): { auto: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (document.anns.some((ann) => ann.attention === 'new' || ann.attention === 'delivered')) reasons.push('存在尚未确认的人类标注');
  if (document.nodes.some((node) => isObject(node.milestone) && node.milestone.status === 'pending')) reasons.push('存在待审核里程碑');
  const projection = buildProjectProjection(document);
  const currentNodeId = projection.current.nodeId;
  const currentRouteId = projection.current.routeId ?? projection.mainRoute.id;
  const nodeRoute = new Map(document.nodes.map((node) => [String(node.id), typeof node.route === 'string' ? node.route : null]));
  const candidateRoute = (candidate: RetrievalItem): string | null => {
    const metadata = candidate as unknown as Record<string, unknown>;
    if (typeof metadata.routeId === 'string') return metadata.routeId;
    const value = candidate.value;
    if (!value) return null;
    if (typeof value.route === 'string') return value.route;
    if (candidate.kind === 'edges' && typeof value.from === 'string') return nodeRoute.get(value.from) ?? null;
    return null;
  };
  const usableCandidates = candidates.filter((candidate) => candidate.kind !== 'markdown');
  const uniqueCandidateIds = new Set(usableCandidates.map((candidate) => String(candidate.id)));
  const directOrCurrent = usableCandidates.filter((candidate) => {
    const routeId = candidateRoute(candidate);
    const isOneHop = candidate.reasons.some((reason) => reason.includes('一跳'));
    const isCurrent = currentNodeId !== null && String(candidate.id) === currentNodeId;
    return isCurrent || isOneHop || (currentRouteId !== null && routeId === currentRouteId);
  });
  const crossRoute = usableCandidates.filter((candidate) => {
    const metadata = candidate as unknown as Record<string, unknown>;
    if (metadata.isCrossRoute === true) return true;
    const routeId = candidateRoute(candidate);
    return Boolean(routeId && currentRouteId && routeId !== currentRouteId);
  });
  if (usableCandidates.length > 0 && currentRouteId && directOrCurrent.length === 0) reasons.push('候选不在当前路线或一跳范围');
  if (crossRoute.length > 0) reasons.push('存在需要人工确认的跨路线候选');
  const majorNewDirection = crossRoute.some((candidate) => !candidate.reasons.some((reason) => reason.includes('一跳')));
  if (majorNewDirection) reasons.push('存在重大新方向，不能自动扩张路线');
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true).length;
  if (activeNodes >= 20) reasons.push(`活跃对象数量达到整理阈值（${activeNodes} 个节点）`);
  if (uniqueCandidateIds.size > 10) reasons.push(`单批候选对象超过 10 个（${uniqueCandidateIds.size}）`);
  const first = candidates[0]?.score ?? 0;
  const second = candidates[1]?.score ?? 0;
  if (first < 500 || first - second < 150) reasons.push('候选置信度或候选分差不足');
  return { auto: reasons.length === 0, reasons };
}

export type ConsolidationSuggestionKind =
  | 'archive_edge'
  | 'archive_route'
  | 'merge_nodes'
  | 'compress_success_chain'
  | 'reconnect_duplicate_branch'
  | 'summarize_markdown';

export type ConsolidationSuggestionMode = 'human_only' | 'preview_only';

export interface ConsolidationCounts {
  routes: number;
  nodes: number;
  edges: number;
  activeNodes: number;
  activeEdges: number;
}

export interface ConsolidationSource {
  objectIds: string[];
  routeIds: string[];
  actors: string[];
  markdownPaths: string[];
}

export interface ConsolidationSuggestion {
  id: string;
  kind: ConsolidationSuggestionKind;
  /** human_only proposals carry guarded commands; preview_only has no executable command. */
  mode: ConsolidationSuggestionMode;
  applyable: boolean;
  title: string;
  reason: string;
  objectIds: string[];
  source: ConsolidationSource;
  before: ConsolidationCounts;
  after: ConsolidationCounts;
  /** false means the preview intentionally does not claim a safe post-apply count. */
  afterKnown: boolean;
  commands: MapCommand[];
}

export interface ConsolidationPlan {
  revision: number;
  /** `counts` remains flat for the existing canvas/API consumers. */
  counts: ConsolidationCounts;
  before: ConsolidationCounts;
  after: ConsolidationCounts;
  trigger: string[];
  suggestions: ConsolidationSuggestion[];
}

function normalizeForComparison(value: unknown): string {
  return String(value ?? '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function comparisonTokens(value: unknown): Set<string> {
  const normalized = normalizeForComparison(value);
  if (!normalized) return new Set();
  return new Set(tokenize(normalized));
}

function similarText(left: unknown, right: unknown): boolean {
  const a = normalizeForComparison(left);
  const b = normalizeForComparison(right);
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  if (a === b) return true;
  const leftTokens = comparisonTokens(a);
  const rightTokens = comparisonTokens(b);
  if (!leftTokens.size || !rightTokens.size) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap > 0 && overlap / (leftTokens.size + rightTokens.size - overlap) >= 0.5;
}

function consolidationCounts(document: MapDocument): ConsolidationCounts {
  const activeRoutes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const activeEdges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && !document.routes.some((route) => route.id === edge.route && (route.archived === true || route.shelved === true)));
  return {
    routes: document.routes.length,
    nodes: document.nodes.length,
    edges: document.edges.length,
    activeNodes: activeNodes.length,
    activeEdges: activeEdges.length,
  };
}

function sortedUnique(values: Iterable<unknown>): string[] {
  return [...new Set([...values].map((value) => String(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function sourceFor(document: MapDocument, objectIds: string[], markdownPaths: string[] = []): ConsolidationSource {
  const byId = new Map<string, Record<string, unknown>>();
  for (const collection of ['routes', 'nodes', 'edges'] as const) {
    for (const item of document[collection]) byId.set(String(item.id), item);
  }
  const objects = objectIds.map((id) => byId.get(String(id))).filter((item): item is Record<string, unknown> => Boolean(item));
  const routeIds = objects.flatMap((item) => {
    if (typeof item.route === 'string') return [item.route];
    if (typeof item.id === 'string' && document.routes.some((route) => route.id === item.id)) return [item.id];
    return [];
  });
  const actors = objects.flatMap((item) => [item.createdBy, item.updatedBy]).filter((actor): actor is string => typeof actor === 'string');
  const paths = objects.map((item) => (typeof item.md === 'string' ? item.md : '')).filter(Boolean).concat(markdownPaths);
  return { objectIds: sortedUnique(objectIds), routeIds: sortedUnique(routeIds), actors: sortedUnique(actors), markdownPaths: sortedUnique(paths.map((path) => path.replace(/\\/g, '/'))) };
}

function decrementAfter(before: ConsolidationCounts, commands: MapCommand[]): ConsolidationCounts {
  const after = { ...before };
  const archived = new Set<string>();
  for (const command of commands) {
    if (command.op !== 'update' || command.patch.archived !== true) continue;
    const key = `${command.collection}/${command.id}`;
    if (archived.has(key)) continue;
    archived.add(key);
    if (command.collection === 'nodes') after.activeNodes = Math.max(0, after.activeNodes - 1);
    if (command.collection === 'edges') after.activeEdges = Math.max(0, after.activeEdges - 1);
  }
  return after;
}

function makeSuggestion(document: MapDocument, before: ConsolidationCounts, value: Omit<ConsolidationSuggestion, 'source' | 'before' | 'after' | 'afterKnown'> & { markdownPaths?: string[]; afterKnown?: boolean }): ConsolidationSuggestion {
  const source = sourceFor(document, value.objectIds, value.markdownPaths ?? []);
  const afterKnown = value.afterKnown ?? value.mode === 'human_only';
  return {
    ...value,
    source,
    before: { ...before },
    after: afterKnown ? decrementAfter(before, value.commands) : { ...before },
    afterKnown,
    commands: value.commands.map((command) => structuredClone(command)),
  };
}

function activeForConsolidation(document: MapDocument): { routes: Record<string, unknown>[]; nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const routes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const routeIds = new Set(routes.map((route) => String(route.id)));
  const nodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const edges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && (!edge.route || routeIds.has(String(edge.route))));
  return { routes, nodes, edges };
}

function successfulChains(edges: Record<string, unknown>[]): Record<string, unknown>[][] {
  const successful = edges.filter((edge) => edge.status === 'success' && typeof edge.from === 'string' && typeof edge.to === 'string')
    .sort((a, b) => String(a.route ?? '').localeCompare(String(b.route ?? '')) || String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to)) || String(a.id).localeCompare(String(b.id)));
  const byFrom = new Map<string, Record<string, unknown>[]>();
  for (const edge of successful) {
    const key = `${String(edge.route ?? '')}:${String(edge.from)}`;
    const list = byFrom.get(key) ?? [];
    list.push(edge);
    byFrom.set(key, list);
  }
  const incoming = new Set(successful.map((edge) => `${String(edge.route ?? '')}:${String(edge.to)}`));
  const starts = successful.filter((edge) => !incoming.has(`${String(edge.route ?? '')}:${String(edge.from)}`));
  const chains: Record<string, unknown>[][] = [];
  const visited = new Set<string>();
  const walk = (start: Record<string, unknown>): void => {
    const chain: Record<string, unknown>[] = [];
    let current: Record<string, unknown> | undefined = start;
    while (current && !visited.has(String(current.id))) {
      visited.add(String(current.id));
      chain.push(current);
      const nextEdges: Record<string, unknown>[] = byFrom.get(`${String(current.route ?? '')}:${String(current.to)}`) ?? [];
      current = nextEdges.length === 1 ? nextEdges[0] : undefined;
    }
    if (chain.length >= 2) chains.push(chain);
  };
  for (const start of starts) walk(start);
  for (const edge of successful) if (!visited.has(String(edge.id))) walk(edge);
  return chains;
}

/**
 * Produce a deterministic, read-only consolidation preview.  Only reversible
 * archive and explicitly human-guarded reconnect commands are executable.
 * Merging nodes, compressing successful chains, and summarizing Markdown are
 * preview_only because the current command model cannot atomically preserve
 * every edge, annotation, and original document reference.
 */
export function planConsolidation(document: MapDocument, options: { now?: string; maxSuggestions?: number; markdown?: MarkdownDocument[] } = {}): ConsolidationPlan {
  const now = new Date(options.now ?? Date.now());
  const maxSuggestions = Math.max(1, Math.min(20, Number.isInteger(options.maxSuggestions) ? Number(options.maxSuggestions) : 12));
  const active = activeForConsolidation(document);
  const before = consolidationCounts(document);
  const trigger: string[] = [];
  if (before.activeNodes >= 20) trigger.push(`活跃节点达到 ${before.activeNodes} 个`);
  if (before.activeEdges >= 20) trigger.push(`活跃方案达到 ${before.activeEdges} 条`);
  const suggestions: ConsolidationSuggestion[] = [];
  const ageDays = (value: unknown): number => {
    const time = new Date(String(value ?? '')).getTime();
    return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 86_400_000) : 0;
  };
  const add = (value: Omit<ConsolidationSuggestion, 'source' | 'before' | 'after' | 'afterKnown'> & { markdownPaths?: string[]; afterKnown?: boolean }): void => {
    if (suggestions.length < maxSuggestions) suggestions.push(makeSuggestion(document, before, value));
  };

  // Failed, low-confidence or stale branches remain reversible archive proposals.
  for (const edge of active.edges) {
    if (edge.status !== 'failed') continue;
    const age = ageDays(edge.updatedAt);
    const score = typeof edge.score === 'number' ? edge.score : 0;
    if (age < 7 && score >= 50) continue;
    trigger.push('存在长期未更新或低分失败方案');
    add({
      id: `archive-${edge.id}`,
      kind: 'archive_edge',
      mode: 'human_only',
      applyable: true,
      title: `归档失败方案：${String(edge.name ?? edge.id)}`,
      reason: `该方案已失败，${Math.floor(age)} 天未更新，当前评分 ${score}；归档只弱化显示，不删除历史 Markdown。`,
      objectIds: [String(edge.id)],
      commands: [{ op: 'update', collection: 'edges', id: String(edge.id), humanOnly: true, patch: { archived: true } }],
    });
  }

  // Same-source, same-name failed branches preserve the old deterministic archive behaviour.
  const seenFailures = new Map<string, Record<string, unknown>>();
  for (const edge of active.edges) {
    if (edge.status !== 'failed') continue;
    const key = `${String(edge.from)}:${normalizeForComparison(edge.name)}`;
    const prior = seenFailures.get(key);
    if (!prior) { seenFailures.set(key, edge); continue; }
    const candidate = ageDays(edge.updatedAt) >= ageDays(prior.updatedAt) ? edge : prior;
    const other = candidate === edge ? prior : edge;
    trigger.push('发现同一来源的重复失败方向');
    add({
      id: `duplicate-${candidate.id}`,
      kind: 'archive_edge',
      mode: 'human_only',
      applyable: true,
      title: `整理重复失败方向：${String(candidate.name ?? candidate.id)}`,
      reason: `与方案 ${String(other.id)} 来源相同且名称相近；保留较新的记录，归档重复方向。`,
      objectIds: [String(candidate.id), String(other.id)],
      commands: [{ op: 'update', collection: 'edges', id: String(candidate.id), humanOnly: true, patch: { archived: true } }],
    });
  }

  // Same-route near-duplicate nodes cannot be merged safely without rewriting all references.
  const nodesByRoute = new Map<string, Record<string, unknown>[]>();
  for (const node of active.nodes) {
    const key = String(node.route ?? '');
    const list = nodesByRoute.get(key) ?? [];
    list.push(node);
    nodesByRoute.set(key, list);
  }
  for (const [routeId, nodes] of [...nodesByRoute.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const consumed = new Set<string>();
    for (let index = 0; index < sorted.length; index += 1) {
      const canonical = sorted[index];
      if (consumed.has(String(canonical.id))) continue;
      for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
        const duplicate = sorted[nextIndex];
        if (consumed.has(String(duplicate.id)) || !similarText(canonical.name, duplicate.name)) continue;
        trigger.push('同一路线存在名称近义节点');
        add({
          id: `merge-nodes-${canonical.id}-${duplicate.id}`,
          kind: 'merge_nodes',
          mode: 'preview_only',
          applyable: false,
          title: `预览合并近义节点：${String(canonical.name ?? canonical.id)}`,
          reason: `路线 ${routeId || '未分配'} 中节点名称相似；合并需要同时重连方案、标注和 Markdown 引用，当前只提供预览，不自动改写。`,
          objectIds: [String(canonical.id), String(duplicate.id)],
          commands: [],
        });
        consumed.add(String(duplicate.id));
        break;
      }
    }
  }

  // A chain of successful edges is a candidate for a human-reviewed stage conclusion.
  for (const chain of successfulChains(active.edges)) {
    const ids = chain.map((edge) => String(edge.id));
    trigger.push('存在连续成功步骤，可压缩为阶段结论');
    add({
      id: `compress-success-${ids[0]}`,
      kind: 'compress_success_chain',
      mode: 'preview_only',
      applyable: false,
      title: `预览压缩连续成功步骤：${ids.join(' → ')}`,
      reason: `同一路线连续 ${chain.length} 步成功；需要人确认阶段结论并保留每条证据，当前命令模型不能安全删除或改写原步骤。`,
      objectIds: ids,
      commands: [],
    });
  }

  // Pending duplicate branches may be reconnected with an explicitly human-only update.
  const nodesById = new Map(active.nodes.map((node) => [String(node.id), node]));
  const reconnectSeen = new Set<string>();
  const pendingEdges = active.edges.filter((edge) => ['pending'].includes(String(edge.status)) && typeof edge.from === 'string' && typeof edge.to === 'string');
  for (let index = 0; index < pendingEdges.length; index += 1) {
    const left = pendingEdges[index];
    const leftTarget = nodesById.get(String(left.to));
    if (!leftTarget) continue;
    for (let otherIndex = index + 1; otherIndex < pendingEdges.length; otherIndex += 1) {
      const right = pendingEdges[otherIndex];
      if (String(left.from) !== String(right.from) || String(left.route ?? '') !== String(right.route ?? '') || String(left.to) === String(right.to)) continue;
      const rightTarget = nodesById.get(String(right.to));
      if (!rightTarget || !similarText(leftTarget.name, rightTarget.name)) continue;
      const canonical = String(leftTarget.id).localeCompare(String(rightTarget.id)) <= 0 ? leftTarget : rightTarget;
      const duplicateEdge = canonical.id === leftTarget.id ? right : left;
      if (reconnectSeen.has(String(duplicateEdge.id))) continue;
      reconnectSeen.add(String(duplicateEdge.id));
      trigger.push('发现重复分支，可重连到同一结果节点');
      add({
        id: `reconnect-${duplicateEdge.id}-${canonical.id}`,
        kind: 'reconnect_duplicate_branch',
        mode: 'human_only',
        applyable: true,
        title: `重连重复分支到：${String(canonical.name ?? canonical.id)}`,
        reason: `来自同一节点的两个待验证分支指向名称近义结果；仅在人确认后把 ${String(duplicateEdge.id)} 重连到 ${String(canonical.id)}，不会删除原节点或 Markdown。`,
        objectIds: [String(left.from), String(left.id), String(right.id), String(leftTarget.id), String(rightTarget.id)],
        commands: [{ op: 'update', collection: 'edges', id: String(duplicateEdge.id), humanOnly: true, patch: { to: String(canonical.id) } }],
      });
    }
  }

  // Markdown is never rewritten by the preview.  The bridge can pass its read-only documents here.
  const markdownThreshold = 4000;
  for (const markdown of [...(options.markdown ?? [])].sort((a, b) => String(a.path).localeCompare(String(b.path)))) {
    const text = String(markdown.text ?? '');
    if (text.length <= markdownThreshold) continue;
    const path = String(markdown.path).replace(/\\/g, '/');
    const owner = [...document.nodes, ...document.edges].find((item) => String(item.md ?? '').replace(/\\/g, '/') === path);
    const objectIds = owner ? [String(owner.id)] : [];
    trigger.push('存在过长 Markdown 摘要候选');
    add({
      id: `summarize-markdown-${fnv1a(path)}`,
      kind: 'summarize_markdown',
      mode: 'preview_only',
      applyable: false,
      title: `预览生成 Markdown 摘要：${path}`,
      reason: `原文 ${text.length} 字符，超过 ${markdownThreshold} 字符建议阈值；只生成摘要预览，原文必须保留，当前不提交写入命令。`,
      objectIds,
      markdownPaths: [path],
      commands: [],
    });
  }

  const kindOrder: Record<ConsolidationSuggestionKind, number> = {
    archive_edge: 1,
    archive_route: 2,
    reconnect_duplicate_branch: 3,
    merge_nodes: 4,
    compress_success_chain: 5,
    summarize_markdown: 6,
  };
  const ordered = suggestions.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id)).slice(0, maxSuggestions);
  let after = { ...before };
  for (const suggestion of ordered) if (suggestion.afterKnown) after = decrementAfter(after, suggestion.commands);
  return {
    revision: document.revision,
    counts: { ...before },
    before: { ...before },
    after,
    trigger: [...new Set(trigger)],
    suggestions: ordered,
  };
}
