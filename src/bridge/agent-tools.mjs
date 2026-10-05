// 面向 Agent 的 5 个工具（map_look / map_read / map_write / analysis_run / map_manage）。
// 规则（权限、人类原声保护、etag 锁、留痕）全部复用旧工具的实现，这一层只负责：
// 路径归一、输出瘦身、同会话去重、把报错改写成新工具的正确用法。
import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.mjs';
import { HumanMdUpdateLog } from './human-md-updates.mjs';
import { ANALYSIS_OPS, parseDataset, runAnalysis } from './analysis.mjs';

const def = (name, description, properties, required = []) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: true },
});

const MANAGE_ACTIONS = Object.freeze([
  'maps', 'create_map', 'switch_map', 'rename_map',
  'files', 'rename_file', 'archive', 'restore', 'import',
  'validate', 'checkpoint', 'plan', 'human',
]);

export const AGENT_TOOL_DEFINITIONS = Object.freeze([
  def('map_look', '看地图目录：返回相关节点/文档的 id、名称、类型、路径和一句理由，不含正文。先 look 找路径，再 map_read。', {
    query: { type: 'string', description: '关键词，可空' },
    nodeId: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 12 },
  }),
  def('map_read', '读正文。path 用 look 给的路径或节点 id；同会话内未变化的文件只回 unchanged，force:true 强制重读；以 / 结尾列出资料包文件。', {
    path: { type: 'string' },
    force: { type: 'boolean' },
  }, ['path']),
  def('map_write', '写入。path+content 默认追加（文件不存在则新建）；带 baseEtag 为整文替换。node:{name,kind} 新建节点；ack:[id] 确认人类标注；commands 提交地图命令。', {
    path: { type: 'string' },
    content: { type: 'string' },
    baseEtag: { type: 'string' },
    node: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['goal', 'problem'] }, near: { type: 'string' } } },
    ack: { type: 'array', items: { type: 'string' } },
    commands: { type: 'array', items: { type: 'object' } },
  }),
  def('analysis_run', '对资料包里的 CSV/JSONL/JSON 表做确定性统计，只回摘要。op: describe 字段概况 | group 分组对比 | top 前20%对比其余。', {
    path: { type: 'string' },
    op: { type: 'string', enum: [...ANALYSIS_OPS] },
    params: { type: 'object', description: 'group: {by, metric?, agg?}；top: {metric, ratio?, fields?}' },
  }, ['path', 'op']),
  def('map_manage', `低频管理。action: ${MANAGE_ACTIONS.join('|')}。`, {
    action: { type: 'string', enum: [...MANAGE_ACTIONS] },
    mapKey: { type: 'string' },
    name: { type: 'string' },
    path: { type: 'string' },
    to: { type: 'string' },
    sourcePath: { type: 'string' },
  }, ['action']),
]);

export const AGENT_TOOL_NAMES = Object.freeze(AGENT_TOOL_DEFINITIONS.map((tool) => tool.name));

const USAGE = {
  map_look: 'map_look({query:"关键词"}) 或 map_look({nodeId:"n3"})',
  map_read: 'map_read({path:"nodes/n3/index.md"})，path 也可直接写节点 id 如 "n3"',
  map_write: 'map_write({path:"nodes/n3/index.md", content:"…"}) 追加；带 baseEtag 才是整文替换；新建节点 map_write({node:{name:"…"}, content:"…"})',
  analysis_run: 'analysis_run({path:"nodes/n3/data.csv", op:"describe|group|top", params:{by:"字段", metric:"指标"}})',
  map_manage: `map_manage({action:"${MANAGE_ACTIONS.join('|')}", …})`,
};

const LEGACY_NAME_HINTS = [
  [/map_append_markdown/g, 'map_write（不带 baseEtag 即追加）'],
  [/map_write_markdown/g, 'map_write'],
  [/map_read_markdown/g, 'map_read'],
  [/map_get_context|map_next_candidates/g, 'map_look'],
  [/map_plan_consolidation/g, 'map_manage({action:"plan"})'],
  [/map_ack_human_updates/g, 'map_write({ack:[…]})'],
  [/map_apply_commands/g, 'map_write({commands:[…]})'],
];

/** 旧实现的报错文案里写的是旧工具名；Agent 只看得到新工具，统一改写并附正确用法。 */
function rewriteError(name, error) {
  if (!(error instanceof BridgeError)) return error;
  let message = String(error.message || '');
  for (const [pattern, replacement] of LEGACY_NAME_HINTS) message = message.replace(pattern, replacement);
  const status = Number(error.status) || 500;
  if (error.code === 'MARKDOWN_CONFLICT') message += ' 先 map_read 拿最新 etag 再写；只想追加就去掉 baseEtag。';
  else if (status >= 400 && status < 500 && status !== 409) message += ` 用法：${USAGE[name]}`;
  let details = error.details;
  // 冲突详情里带整份当前正文，进上下文太贵；只留 etag。
  if (details && typeof details === 'object' && details.current && typeof details.current === 'object') {
    details = { ...details, current: { etag: details.current.etag, size: details.current.size } };
  }
  return new BridgeError(error.code, message, { status, details, cause: error });
}

// ---- 路径 ----

function stripMapPrefix(raw) {
  let path = String(raw ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  let mapKey = null;
  const scoped = path.match(/^\.live-dot-map\/maps\/([^/]+)\/(.*)$/);
  if (scoped) { mapKey = scoped[1]; path = scoped[2]; }
  else path = path.replace(/^\.live-dot-map\//, '');
  return { path, mapKey };
}

function ownerOfId(document, id) {
  if ((document.nodes || []).some((item) => String(item.id) === id)) return 'node';
  if ((document.edges || []).some((item) => String(item.id) === id)) return 'route';
  if ((document.routes || []).some((item) => String(item.id) === id)) return 'route';
  return null;
}

/** 接受 nodes/n3/x.md、routes/e1/index.md、n3、n3/x.md、.live-dot-map/maps/<k>/nodes/n3/x.md。 */
function parseTarget(raw, document) {
  const { path } = stripMapPrefix(raw);
  if (!path) throw new BridgeError('PATH_REQUIRED', '缺少 path', { status: 400 });
  const listing = path.endsWith('/');
  const parts = path.split('/').filter(Boolean);
  let ownerKind;
  let ownerId;
  let rest;
  if (parts[0] === 'nodes' || parts[0] === 'routes') {
    if (!parts[1]) throw new BridgeError('PATH_INVALID', `路径「${raw}」缺少对象 id`, { status: 400 });
    ownerKind = parts[0] === 'nodes' ? 'node' : 'route';
    ownerId = parts[1];
    rest = parts.slice(2).join('/');
    if (!ownerOfId(document, ownerId)) throw new BridgeError('OWNER_NOT_FOUND', `当前地图没有对象「${ownerId}」，先用 map_look 找 id`, { status: 404 });
  } else {
    ownerId = parts[0];
    ownerKind = ownerOfId(document, ownerId);
    if (!ownerKind) throw new BridgeError('OWNER_NOT_FOUND', `当前地图没有对象「${ownerId}」，先用 map_look 找 id`, { status: 404 });
    rest = parts.slice(1).join('/');
  }
  const dir = ownerKind === 'node' ? 'nodes' : 'routes';
  return { ownerKind, ownerId, fileName: rest || null, listing, display: `${dir}/${ownerId}/${rest || 'index.md'}` };
}

function scopedArgs(args) {
  const { mapKey } = stripMapPrefix(args.path);
  if (typeof args.mapKey === 'string' && args.mapKey) return { mapKey: args.mapKey };
  return mapKey ? { mapKey } : {};
}

const isMarkdownName = (name) => /\.(md|markdown)$/i.test(String(name || 'index.md'));

function relativeMapPath(value) {
  if (typeof value !== 'string' || !value) return '';
  return stripMapPrefix(value).path;
}

function shortText(value, max = 40) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---- 同会话去重：同一会话里同 etag 的正文只发一次 ----

const SENT = new Map();
const MAX_SESSIONS = 200;

function sentFor(key) {
  if (!key) return null;
  let entry = SENT.get(key);
  if (!entry) {
    if (SENT.size >= MAX_SESSIONS) SENT.delete(SENT.keys().next().value);
    entry = new Map();
    SENT.set(key, entry);
  }
  return entry;
}

function sessionKey(service, mapKey, args) {
  const session = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : '';
  return session ? `${service.actor}|${mapKey}|${session}` : '';
}

/** 测试用：清空会话去重表。 */
export function resetAgentSessions() {
  SENT.clear();
}

// ---- map_look ----

function objectRow(entry, document) {
  const item = entry.value ?? {};
  const kind = entry.kind === 'nodes' ? String(item.kind ?? 'goal')
    : entry.kind === 'edges' ? 'edge'
      : entry.kind === 'routes' ? 'route'
        : 'ann';
  let path = relativeMapPath(item.md);
  if (!path && entry.kind === 'nodes') path = `nodes/${entry.id}/index.md`;
  if (!path && (entry.kind === 'edges' || entry.kind === 'routes')) path = `routes/${entry.id}/index.md`;
  if (entry.kind === 'anns') {
    const target = item.target && typeof item.target === 'object' ? String(item.target.id ?? '') : '';
    path = target && ownerOfId(document, target) === 'node' ? `nodes/${target}/index.md` : '';
  }
  const name = entry.kind === 'anns' ? shortText(item.text, 30) : shortText(item.name ?? entry.id, 30);
  const reason = String((entry.reasons || []).find((value) => !/^最近修改|^质量评分/.test(value)) ?? entry.reasons?.[0] ?? '');
  return [entry.id, name, kind, path, reason.replace(/ \+\d+$/, '')];
}

function hasRealReason(entry) {
  return (entry.reasons || []).some((value) => !/^最近修改|^质量评分/.test(value));
}

function markdownTitle(text, path) {
  const heading = String(text ?? '').match(/^\s*#{1,6}\s+(.+)$/m);
  return shortText(heading ? heading[1] : path.split('/').slice(-2).join('/'), 30);
}

async function look(service, args) {
  const { context, documents } = await service.agentView({ ...args, includeHistory: args.includeHistory === true });
  const document = context.snapshot.document;
  const query = String(args.query ?? args.q ?? '').trim();
  const nodeId = args.nodeId ?? args.currentNodeId ?? args.node;
  const limit = Math.max(1, Math.min(12, Number.isInteger(args.limit) ? args.limit : 5));
  const retrieved = service.shared.retrieveContext(document, query, {
    currentNodeId: nodeId == null ? null : String(nodeId),
    limit: 12,
    includeHistory: args.includeHistory === true,
    markdown: documents.markdown,
  });
  // 有查询或指定节点时，只靠“最近修改/评分”加分的对象是凑数，不进目录。
  const focused = Boolean(query) || nodeId != null;
  const objects = retrieved.objects.filter((entry) => !focused || hasRealReason(entry));
  const rows = objects.map((entry) => objectRow(entry, document));
  const seenPaths = new Set(rows.map((row) => row[3]).filter(Boolean));
  if (query) {
    for (const hit of retrieved.markdown) {
      const path = relativeMapPath(hit.path);
      if (!path || seenPaths.has(path)) continue;
      seenPaths.add(path);
      const source = documents.markdown.find((doc) => doc.path === hit.path);
      rows.push([path.split('/')[1] ?? path, markdownTitle(source?.text, path), 'md', path, '正文命中']);
    }
  }
  const humanAnns = (document.anns || [])
    .filter((ann) => ann.source === 'human' && ['new', 'delivered'].includes(String(ann.attention)))
    .map((ann) => String(ann.id));
  const humanMd = await new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey: context.mapKey }).unacknowledged().catch(() => []);
  const human = [...humanAnns, ...humanMd.map((item) => item.id)];
  const goal = shortText(service.shared.buildProjectProjection(document).totalGoal, 60);
  const result = {
    map: context.mapKey,
    name: shortText(document.name, 30),
    rev: context.snapshot.revision,
    ...(goal ? { goal } : {}),
    ...(human.length ? { human: human.slice(0, 5), ...(human.length > 5 ? { humanMore: human.length - 5 } : {}) } : {}),
    cols: ['id', 'name', 'kind', 'path', 'why'],
    items: rows.slice(0, limit),
  };
  if (rows.length > limit) result.more = rows.length - limit;
  if (!rows.length) result.hint = query ? '没有命中，换个关键词或不带 query 看总览' : '地图还没有内容';
  return result;
}

// ---- map_read ----

async function read(service, args) {
  const scope = scopedArgs(args);
  const { context } = await service.agentView({ ...scope, skipDocuments: true });
  const document = context.snapshot.document;
  // look 的 human 字段与 ann 行给的是标注 id；标注正文在 map.json 里，不在任何 md 里。
  const annId = String(args.path ?? '').trim();
  const ann = (document.anns || []).find((item) => String(item.id) === annId);
  if (ann) {
    const on = ann.target?.id ? `${ann.target.kind === 'node' ? 'nodes' : 'routes'}/${ann.target.id}/index.md` : 'canvas';
    const pending = ann.source === 'human' && ['new', 'delivered'].includes(String(ann.attention));
    return {
      // updatedBy 会被 ack 改成确认的 Agent，署名要看来源。
      id: ann.id, kind: 'ann', text: String(ann.text ?? ''), on, by: ann.source === 'human' ? 'human' : (ann.createdBy ?? ann.updatedBy ?? ann.source),
      ...(ann.priority ? { priority: ann.priority } : {}),
      ...(pending ? { pending: true, hint: '处理完用 ack 确认这条标注' } : {}),
    };
  }
  const target = parseTarget(args.path, document);
  const owner = { ...scope, ownerKind: target.ownerKind, ownerId: target.ownerId };
  if (target.listing) {
    const listed = await service.dispatchLegacy('map_list_bundle_files', { ...owner, includeArchived: args.includeArchived === true });
    return {
      path: `${target.ownerKind === 'node' ? 'nodes' : 'routes'}/${target.ownerId}/`,
      files: (listed.files || []).map((file) => ({ name: file.fileName ?? file.name, kind: file.kind, size: file.size, ...(file.archived ? { archived: true } : {}) })),
    };
  }
  const fileName = target.fileName || 'index.md';
  if (!isMarkdownName(fileName)) {
    const asset = await service.dispatchLegacy('map_read_asset', { ...owner, fileName, includeContent: false });
    const text = typeof asset.content === 'string' ? asset.content : undefined;
    const limit = 64 * 1024;
    return {
      path: target.display, kind: asset.kind, mimeType: asset.mimeType, size: asset.size, file: asset.path,
      ...(text !== undefined ? { content: text.length > limit ? text.slice(0, limit) : text, ...(text.length > limit ? { truncated: true } : {}) } : {}),
    };
  }
  const file = await service.dispatchLegacy('map_read_markdown', { ...owner, fileName });
  const sent = sentFor(sessionKey(service, context.mapKey, args));
  if (sent && args.force !== true && sent.get(target.display) === file.etag) {
    return { path: target.display, etag: file.etag, unchanged: true, hint: '已读过未变；要正文加 force' };
  }
  sent?.set(target.display, file.etag);
  const result = { path: target.display, etag: file.etag, content: String(file.content ?? '') };
  if (!target.fileName) {
    const listed = await service.dispatchLegacy('map_list_bundle_files', owner).catch(() => ({ files: [] }));
    const others = (listed.files || []).map((item) => item.fileName ?? item.name).filter((name) => name && name !== 'index.md');
    if (others.length) result.files = others;
  }
  return result;
}

// ---- map_write ----

function nextNodeId(document) {
  let max = 0;
  for (const node of document.nodes || []) {
    const match = String(node.id).match(/^n(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let id = `n${max + 1}`;
  while ((document.nodes || []).some((node) => String(node.id) === id)) id = `n${Number(id.slice(1)) + 1}`;
  return id;
}

function placeNear(document, nearId) {
  const nodes = document.nodes || [];
  const anchor = nodes.find((node) => String(node.id) === String(nearId)) ?? nodes.at(-1);
  if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') return { x: 80 + nodes.length * 40, y: 200 };
  return { x: anchor.x + 240, y: anchor.y + (nodes.length % 3) * 60 };
}

async function write(service, args) {
  const scope = scopedArgs(args);
  const out = { ok: true };
  let { context } = await service.agentView({ ...scope, skipDocuments: true });
  let document = context.snapshot.document;
  const hasContent = typeof args.content === 'string';
  if (!args.node && !args.commands && !args.ack && !(args.path && hasContent)) {
    throw new BridgeError('WRITE_NOTHING', 'map_write 至少需要 path+content、node、ack 或 commands 之一', { status: 400 });
  }

  const commands = Array.isArray(args.commands) ? [...args.commands] : [];
  let createdNode = null;
  if (args.node && typeof args.node === 'object') {
    const name = String(args.node.name ?? '').trim();
    if (!name) throw new BridgeError('NODE_NAME_REQUIRED', 'node.name 不能为空', { status: 400 });
    createdNode = nextNodeId(document);
    const kind = args.node.kind === 'problem' ? 'problem' : 'goal';
    const position = placeNear(document, args.node.near);
    commands.push({
      op: 'create',
      collection: 'nodes',
      value: { id: createdNode, name, kind, type: kind === 'problem' ? '问题' : '目标', num: String((document.nodes || []).length + 1).padStart(2, '0'), ...position },
    });
  }
  if (commands.length) {
    const applied = await service.dispatchLegacy('map_apply_commands', {
      ...scope,
      commands,
      ...(Number.isInteger(args.baseRevision) ? { baseRevision: args.baseRevision } : {}),
      ...(typeof args.commandId === 'string' ? { commandId: args.commandId } : {}),
    });
    out.rev = applied?.revision ?? applied?.snapshot?.revision;
    if (createdNode) out.node = createdNode;
    ({ context } = await service.agentView({ ...scope, skipDocuments: true }));
    document = context.snapshot.document;
  }

  if (Array.isArray(args.ack) && args.ack.length) {
    const ids = args.ack.map(String);
    const summary = typeof args.summary === 'string' && ids.every((id) => args.summary.includes(id)) ? args.summary : `已读：${ids.join('、')}`;
    await service.dispatchLegacy('map_ack_human_updates', { ...scope, ids, summary });
    out.acked = ids;
  }

  const path = args.path ?? (createdNode && hasContent ? `nodes/${createdNode}/index.md` : null);
  if (path && hasContent) {
    const target = parseTarget(path, document);
    const owner = { ...scope, ownerKind: target.ownerKind, ownerId: target.ownerId };
    const fileName = target.fileName || 'index.md';
    if (!isMarkdownName(fileName)) throw new BridgeError('WRITE_MARKDOWN_ONLY', '只能写 .md 文件；附件用 map_manage({action:"import"})', { status: 415 });
    let result;
    if (typeof args.baseEtag === 'string' && args.baseEtag) {
      result = await service.dispatchLegacy('map_write_markdown', {
        ...owner, fileName, content: args.content, baseEtag: args.baseEtag,
        ...(args.allowContentRemoval === true ? { allowContentRemoval: true } : {}),
      });
      out.mode = 'replace';
    } else {
      const listed = await service.dispatchLegacy('map_list_bundle_files', owner).catch(() => ({ files: [] }));
      const exists = (listed.files || []).some((file) => String(file.fileName ?? file.name).toLowerCase() === fileName.toLowerCase());
      if (!exists && fileName !== 'index.md') {
        result = await service.dispatchLegacy('map_create_markdown', { ...owner, fileName, content: args.content });
        out.mode = 'create';
      } else {
        result = await service.dispatchLegacy('map_append_markdown', {
          ...owner, fileName, content: args.content,
          commandId: typeof args.commandId === 'string' && args.commandId ? `${args.commandId}-md` : `agent-${randomUUID()}`,
        });
        out.mode = 'append';
      }
    }
    out.path = `${target.ownerKind === 'node' ? 'nodes' : 'routes'}/${target.ownerId}/${result?.fileName ?? fileName}`;
    if (result?.etag) out.etag = result.etag;
  }
  return out;
}

// ---- analysis_run ----

async function analyze(service, args) {
  const scope = scopedArgs(args);
  const { context } = await service.agentView({ ...scope, skipDocuments: true });
  const target = parseTarget(args.path, context.snapshot.document);
  if (!target.fileName) throw new BridgeError('DATASET_PATH_REQUIRED', 'path 要指向资料包里的数据文件，如 nodes/n3/data.csv', { status: 400 });
  const asset = await service.dispatchLegacy('map_read_asset', { ...scope, ownerKind: target.ownerKind, ownerId: target.ownerId, fileName: target.fileName, includeContent: true });
  const text = typeof asset.content === 'string' ? asset.content : asset.base64 ? Buffer.from(asset.base64, 'base64').toString('utf8') : '';
  const rows = parseDataset(text, target.fileName);
  return { path: target.display, ...runAnalysis(rows, String(args.op ?? ''), args.params ?? {}) };
}

// ---- map_manage ----

async function manage(service, args) {
  const action = String(args.action ?? '');
  const scope = scopedArgs(args);
  const ownerFrom = async () => {
    const { context } = await service.agentView({ ...scope, skipDocuments: true });
    const target = parseTarget(args.path, context.snapshot.document);
    return { target, owner: { ...scope, ownerKind: target.ownerKind, ownerId: target.ownerId } };
  };
  switch (action) {
    case 'maps': {
      const listed = await service.dispatchLegacy('map_list', {});
      return { active: listed.activeMap, maps: (listed.maps || []).map((item) => [item.id, item.name]) };
    }
    case 'create_map': {
      const created = await service.dispatchLegacy('map_create', { name: String(args.name ?? '') });
      return { ok: true, map: created.createdMap, active: created.activeMap };
    }
    case 'switch_map': {
      const switched = await service.dispatchLegacy('map_switch', { mapKey: String(args.mapKey ?? args.name ?? '') });
      return { ok: true, active: switched.activeMap };
    }
    case 'rename_map':
      await service.dispatchLegacy('map_rename', { mapKey: String(args.mapKey ?? ''), name: String(args.name ?? '') });
      return { ok: true };
    case 'files': {
      const { target, owner } = await ownerFrom();
      const listed = await service.dispatchLegacy('map_list_bundle_files', { ...owner, includeArchived: args.includeArchived === true });
      return { path: `${target.ownerKind === 'node' ? 'nodes' : 'routes'}/${target.ownerId}/`, files: (listed.files || []).map((file) => ({ name: file.fileName ?? file.name, kind: file.kind, size: file.size, ...(file.archived ? { archived: true } : {}) })) };
    }
    case 'rename_file': {
      const { target, owner } = await ownerFrom();
      if (!target.fileName || !args.to) throw new BridgeError('RENAME_ARGS_REQUIRED', 'rename_file 需要 path（含文件名）和 to', { status: 400 });
      await service.dispatchLegacy('map_rename_bundle_file', { ...owner, from: target.fileName, to: String(args.to) });
      return { ok: true };
    }
    case 'archive':
    case 'restore': {
      const { target, owner } = await ownerFrom();
      if (!target.fileName) throw new BridgeError('FILE_REQUIRED', `${action} 需要 path 指向具体文件`, { status: 400 });
      const md = isMarkdownName(target.fileName);
      const legacy = action === 'archive' ? (md ? 'map_archive_bundle_file' : 'map_archive_asset') : (md ? 'map_restore_bundle_file' : 'map_restore_asset');
      await service.dispatchLegacy(legacy, { ...owner, fileName: target.fileName });
      return { ok: true };
    }
    case 'import': {
      const { target, owner } = await ownerFrom();
      if (!args.sourcePath) throw new BridgeError('SOURCE_PATH_REQUIRED', 'import 需要 sourcePath', { status: 400 });
      const imported = await service.dispatchLegacy('map_import_asset', { ...owner, sourcePath: String(args.sourcePath), ...(target.fileName ? { fileName: target.fileName } : {}) });
      return { ok: true, path: `${target.ownerKind === 'node' ? 'nodes' : 'routes'}/${target.ownerId}/${imported.fileName ?? imported.name ?? ''}` };
    }
    case 'validate': {
      const result = await service.dispatchLegacy('map_validate', scope);
      return { ok: result.ok, ...(result.errors?.length ? { errors: result.errors.slice(0, 10) } : {}), ...(result.orphanBundles?.length ? { orphanBundles: result.orphanBundles } : {}) };
    }
    case 'checkpoint': {
      const result = await service.dispatchLegacy('map_checkpoint', scope);
      return { ok: true, ...(result?.id ? { id: result.id } : {}), ...(result?.revision !== undefined ? { rev: result.revision } : {}) };
    }
    case 'plan':
      return service.dispatchLegacy('map_plan_consolidation', { ...scope, maxSuggestions: Number.isInteger(args.maxSuggestions) ? args.maxSuggestions : 8 });
    case 'human': {
      const result = await service.dispatchLegacy('map_list_human_updates', scope);
      return { updates: (result.updates || []).map((item) => [String(item.id), shortText(item.text, 60), String(item.attention ?? '')]) };
    }
    default:
      throw new BridgeError('MANAGE_ACTION_UNKNOWN', `未知 action「${action}」`, { status: 400 });
  }
}

const HANDLERS = { map_look: look, map_read: read, map_write: write, analysis_run: analyze, map_manage: manage };

export async function runAgentTool(service, name, args = {}) {
  try {
    return await HANDLERS[name](service, args && typeof args === 'object' ? args : {});
  } catch (error) {
    throw rewriteError(name, error);
  }
}
