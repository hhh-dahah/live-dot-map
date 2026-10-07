// 面向 Agent 的 5 个工具（map_look / map_read / map_write / analysis_run / map_manage）。
// 规则（权限、人类原声保护、etag 锁、留痕）全部复用旧工具的实现，这一层只负责：
// 路径归一、输出瘦身、同会话去重、把报错改写成新工具的正确用法。
import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.mjs';
import { ANALYSIS_OPS, parseDataset, runAnalysis } from './analysis.mjs';
import {
  META_FILE, bodyVersion, contentVersion, describeEntry, isMetaFile, markdownLead, metaStatePath, metaView, oneLine, parseMeta,
  readMetaState, reconcile, referenceLines, renderMeta, todayLabel, writeMetaState,
} from './agent-meta.mjs';

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
  def('map_look', '看地图目录，不含正文。不带 query 返回整张目录（每项一句摘要，按意思自己挑）；带 query 返回关键词相关项和理由，没命中就换个说法。再用 map_read 读正文。', {
    query: { type: 'string', description: '关键词，可空' },
    nodeId: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 12 },
  }),
  def('map_read', '读正文（index.md 附带该节点的标注 anns）。path 用 look 给的路径或节点 id；同会话内未变化的文件只回 unchanged，force:true 强制重读；以 / 结尾列出资料包文件及说明。结果带 meta:"缺摘要|摘要过期|无说明" 时，读懂后用 map_write 的 meta 补一句。', {
    path: { type: 'string' },
    force: { type: 'boolean' },
  }, ['path']),
  def('map_write', '写入。path+content 默认追加（文件不存在则新建）；带 baseEtag 为整文替换。node:{name,kind} 新建节点；meta:{summary?, files?:{文件名:说明}} 写 Agent元数据（一句话导航，不当证据）；commands 提交地图命令。', {
    path: { type: 'string' },
    content: { type: 'string' },
    baseEtag: { type: 'string' },
    node: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['goal', 'problem'] }, near: { type: 'string' } } },
    meta: { type: 'object', properties: { summary: { type: 'string' }, files: { type: 'object' } } },
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

const CATALOG_LIMIT = 40;
const isHidden = (item) => item?.archived === true || item?.shelved === true;

/**
 * 卡片里的 md 只有前 300 字；元数据文件要逐行解析、也要整份参与检索，所以读全文替换进去。
 * 返回 ownerId → { text: 元数据全文, indexVer: 主文档正文版本 }（判断摘要是否过期）。
 */
async function loadMetaTexts(context, documents) {
  const texts = new Map();
  for (const doc of documents.markdown || []) {
    if (!isMetaFile(doc.path)) continue;
    const ownerId = String(doc.ownerId ?? '');
    let text = doc.summaryOnly ? null : doc.text;
    if (text == null) {
      text = await context.bundleStore.readMarkdown({ ownerKind: doc.ownerKind, ownerId, fileName: META_FILE })
        .then((file) => String(file.content ?? '')).catch(() => null);
    }
    if (text == null) continue;
    doc.text = text;
    doc.summaryOnly = false;
    const index = await context.bundleStore.readMarkdown({ ownerKind: doc.ownerKind, ownerId, fileName: 'index.md' })
      .then((file) => String(file.content ?? '')).catch(() => '');
    texts.set(ownerId, { text, indexVer: bodyVersion(index) });
  }
  return texts;
}

function catalogSummary(meta, indexDoc, name) {
  const summary = meta ? metaView(parseMeta(meta.text), { indexVer: meta.indexVer }).summary : null;
  if (summary?.text) return `${summary.text}${summary.stale ? '（过期）' : ''}`;
  const lead = typeof indexDoc?.lead === 'string' ? indexDoc.lead : indexDoc && !indexDoc.summaryOnly ? markdownLead(indexDoc.text) : '';
  return lead === name ? '' : lead;
}

function catalogRows(document, documents, metaTexts) {
  const routes = new Map((document.routes || []).map((route) => [String(route.id), route]));
  const fileCount = new Map();
  const indexDocs = new Map();
  for (const entry of [...(documents.markdown || []), ...(documents.assets || [])]) {
    if (isMetaFile(entry.path)) continue;
    for (const owner of entry.owners || [{ ownerId: entry.ownerId }]) {
      const id = String(owner.ownerId ?? '');
      if (!id) continue;
      fileCount.set(id, (fileCount.get(id) ?? 0) + 1);
      if (entry.isIndex && !indexDocs.has(id)) indexDocs.set(id, entry);
    }
  }
  const rows = [];
  for (const node of document.nodes || []) {
    if (isHidden(node) || (typeof node.route === 'string' && isHidden(routes.get(node.route)))) continue;
    const id = String(node.id);
    const name = shortText(node.name ?? id, 30);
    rows.push([id, name, String(node.kind ?? 'goal'), relativeMapPath(node.md) || `nodes/${id}/index.md`, catalogSummary(metaTexts.get(id), indexDocs.get(id), name), fileCount.get(id) ?? 0]);
  }
  for (const edge of document.edges || []) {
    const id = String(edge.id);
    if (isHidden(edge) || !indexDocs.has(id)) continue;
    const name = shortText(edge.name ?? id, 30);
    rows.push([id, name, 'edge', relativeMapPath(edge.md) || `routes/${id}/index.md`, catalogSummary(metaTexts.get(id), indexDocs.get(id), name), fileCount.get(id) ?? 0]);
  }
  return rows;
}

async function look(service, args) {
  const { context, documents } = await service.agentView({ ...args, includeHistory: args.includeHistory === true });
  const document = context.snapshot.document;
  const metaTexts = await loadMetaTexts(context, documents);
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
      let path = relativeMapPath(hit.path);
      const source = documents.markdown.find((doc) => doc.path === hit.path);
      const meta = isMetaFile(path);
      // 元数据命中指回它描述的节点主文档，Agent 不需要去读元数据文件本身。
      if (meta) path = path.replace(/[^/]+$/, 'index.md');
      if (!path || seenPaths.has(path)) continue;
      seenPaths.add(path);
      const ownerId = path.split('/')[1] ?? path;
      const owner = meta ? [...(document.nodes || []), ...(document.edges || [])].find((item) => String(item.id) === ownerId) : null;
      rows.push([ownerId, owner ? shortText(owner.name ?? ownerId, 30) : markdownTitle(source?.text, path), meta ? String(owner?.kind ?? 'goal') : 'md', path, meta ? '元数据命中' : '正文命中']);
    }
  }
  const goal = shortText(service.shared.buildProjectProjection(document).totalGoal, 60);
  const result = {
    map: context.mapKey,
    name: shortText(document.name, 30),
    rev: context.snapshot.revision,
    ...(goal ? { goal } : {}),
  };
  if (!focused) {
    // 无关键词 = 总览：整张目录 + 每项一句摘要，由 Agent 按语义自己挑，弥补关键词检索不认同义词。
    const catalog = catalogRows(document, documents, metaTexts);
    const cap = Number.isInteger(args.limit) ? limit : CATALOG_LIMIT;
    Object.assign(result, { cols: ['id', 'name', 'kind', 'path', 'summary', 'files'], items: catalog.slice(0, cap) });
    if (catalog.length > cap) Object.assign(result, { more: catalog.length - cap, hint: '目录过长，用 query 关键词缩小' });
    if (!catalog.length) result.hint = '地图还没有内容';
    return result;
  }
  Object.assign(result, { cols: ['id', 'name', 'kind', 'path', 'why'], items: rows.slice(0, limit) });
  if (rows.length > limit) result.more = rows.length - limit;
  if (!rows.length) result.hint = query ? '没有命中，换个关键词或不带 query 看总览' : '地图还没有内容';
  return result;
}

// ---- map_read ----

async function read(service, args) {
  const scope = scopedArgs(args);
  const { context } = await service.agentView({ ...scope, skipDocuments: true });
  const document = context.snapshot.document;
  // read 返回的 anns 与 look 的 ann 行给的是标注 id；标注正文在 map.json 里，不在任何 md 里。
  const annId = String(args.path ?? '').trim();
  const ann = (document.anns || []).find((item) => String(item.id) === annId);
  if (ann) {
    const on = ann.target?.id ? `${ann.target.kind === 'node' ? 'nodes' : 'routes'}/${ann.target.id}/index.md` : 'canvas';
    return {
      // updatedBy 会被 ack 改成确认的 Agent，署名要看来源。
      id: ann.id, kind: 'ann', text: String(ann.text ?? ''), on, by: ann.source === 'human' ? 'human' : (ann.createdBy ?? ann.updatedBy ?? ann.source),
      ...(ann.priority ? { priority: ann.priority } : {}),
    };
  }
  const target = parseTarget(args.path, document);
  const owner = { ...scope, ownerKind: target.ownerKind, ownerId: target.ownerId };
  if (target.listing) {
    const facts = await bundleFacts(context, target, { includeArchived: args.includeArchived === true });
    const view = await currentMeta(context, target, facts);
    const refs = referenceLines(facts.mdTexts, facts.files.map((file) => file.name));
    const describe = (file) => {
      if (file.name === 'index.md') return '主文档';
      const entry = view.files.get(file.name);
      if (entry) return describeEntry(entry);
      if (refs.has(file.name)) return `引用处：${refs.get(file.name)}`;
      if (/\.(md|markdown)$/i.test(file.name) && file.title) return `标题：${file.title}`;
      return '未描述';
    };
    return {
      path: `${target.ownerKind === 'node' ? 'nodes' : 'routes'}/${target.ownerId}/`,
      cols: ['name', 'kind', 'size', 'note'],
      files: facts.all.map((file) => [file.name, file.kind, file.size, file.archived ? '已归档' : describe(file)]),
      ...(view.missing.length ? { gone: view.missing.map((entry) => entry.name) } : {}),
    };
  }
  const fileName = target.fileName || 'index.md';
  if (!isMarkdownName(fileName)) {
    const asset = await service.dispatchLegacy('map_read_asset', { ...owner, fileName, includeContent: false });
    const text = typeof asset.content === 'string' ? asset.content : undefined;
    const limit = 64 * 1024;
    const facts = await bundleFacts(context, target);
    const view = await currentMeta(context, target, facts);
    const entry = view.files.get(asset.fileName ?? fileName);
    return {
      path: target.display, kind: asset.kind, mimeType: asset.mimeType, size: asset.size, file: asset.path,
      ...(entry ? { note: describeEntry(entry) } : view.deleted.has(`file:${fileName}`) ? {} : { meta: '无说明' }),
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
  if (fileName === 'index.md') {
    // 标注是人在画布上给这个对象的强调，跟着正文走；不单独推送，也不要求确认。
    const anns = (document.anns || [])
      .filter((ann) => !isHidden(ann) && String(ann.target?.id ?? '') === target.ownerId)
      .map((ann) => [String(ann.id), String(ann.text ?? ''), ann.source === 'human' ? 'human' : String(ann.createdBy ?? ann.source ?? '').replace(/^agent:/, '')]);
    if (anns.length) result.anns = anns;
    const facts = await bundleFacts(context, target);
    // 正文里通常已引用图片；只给数量，要清单用 path 以 / 结尾。
    if (facts.files.length) result.otherFiles = facts.files.length;
    const view = await currentMeta(context, target, facts);
    if (!view.summary && !view.deleted.has('summary')) result.meta = '缺摘要';
    else if (view.summary?.stale) result.meta = '摘要过期';
  }
  return result;
}

// ---- 资料包事实与元数据 ----

/** 资料包里除 index.md、元数据以外的文件（含内容版本），以及所有 md 的正文（找引用处、判断原话）。 */
async function bundleFacts(context, target, { includeArchived = false } = {}) {
  const store = context.bundleStore;
  const owner = { ownerKind: target.ownerKind, ownerId: target.ownerId };
  const listed = await store.list({ ...owner, includeArchived }).catch(() => []);
  const facts = { all: [], files: [], mdTexts: [], indexVer: '', metaText: null, metaEtag: null };
  for (const entry of listed) {
    const name = entry.fileName ?? entry.name;
    if (isMetaFile(name)) {
      if (!entry.archived) {
        facts.metaEtag = entry.etag;
        facts.metaText = String((await store.readMarkdown({ ...owner, fileName: name }).catch(() => ({}))).content ?? '');
      }
      continue;
    }
    const file = { name, kind: entry.kind, size: entry.size, archived: Boolean(entry.archived) };
    facts.all.push(file);
    if (entry.archived) continue;
    if (entry.kind === 'markdown') {
      const content = String((await store.readMarkdown({ ...owner, fileName: name }).catch(() => ({}))).content ?? '');
      facts.mdTexts.push(content);
      file.ver = contentVersion(content);
      if (name === 'index.md') facts.indexVer = bodyVersion(content);
      file.title = content.match(/^\s*#{1,6}\s+(.+)$/m)?.[1]?.trim() ?? '';
    } else {
      const asset = await store.readAsset({ ...owner, fileName: name }).catch(() => null);
      file.ver = asset?.buffer ? contentVersion(asset.buffer) : '';
    }
    if (name !== 'index.md') facts.files.push(file);
  }
  return facts;
}

function metaStateFor(context, target) {
  return metaStatePath(context.bundleStore.mapRoot, target.ownerKind === 'node' ? 'nodes' : 'routes', target.ownerId);
}

/** 当前元数据（已识别人改/人删、过期、改名接续）。 */
async function currentMeta(context, target, facts) {
  const state = await readMetaState(metaStateFor(context, target));
  const { model, deleted } = reconcile(facts.metaText ?? '', state);
  return { model, deleted, state, ...metaView(model, { files: facts.files, indexVer: facts.indexVer }) };
}

const collapse = (text) => String(text ?? '').replace(/\s+/g, '');

async function writeMeta(service, context, document, args) {
  const meta = args.meta;
  if (!args.path) throw new BridgeError('META_PATH_REQUIRED', 'meta 需要 path 指明节点，如 path:"n3"', { status: 400 });
  const target = parseTarget(args.path, document);
  const facts = await bundleFacts(context, target);
  const current = await currentMeta(context, target, facts);
  const { deleted } = current;
  const model = { ...current.model, files: new Map() };
  for (const [name, entry] of current.files) model.files.set(name, stripView(entry));
  for (const entry of current.missing) model.files.set(entry.name, stripView(entry));
  const userAsked = meta.userAsked === true;
  const by = String(service.actor).replace(/^agent:/, '');
  const date = todayLabel();
  const label = (text) => (collapse(text).length >= 6 && facts.mdTexts.some((md) => collapse(md).includes(collapse(text))) ? '原话' : '推断');
  const guard = (key, existing, what) => {
    if (userAsked) return;
    if (existing?.label === '人') throw new BridgeError('META_HUMAN_LOCKED', `${what}是人写/人改的，Agent 不改；确属用户明确要求时带 meta.userAsked:true`, { status: 409 });
    if (deleted.has(key)) throw new BridgeError('META_HUMAN_DELETED', `${what}被人删过，不再补写；确属用户明确要求时带 meta.userAsked:true`, { status: 409 });
  };
  const written = [];
  if (typeof meta.summary === 'string' && meta.summary.trim()) {
    guard('summary', model.summary, '摘要');
    const text = oneLine(meta.summary, 60);
    model.summary = { text, label: label(text), by, date, ver: facts.indexVer };
    deleted.delete('summary');
    written.push('summary');
  }
  const fileNotes = meta.files && typeof meta.files === 'object' ? Object.entries(meta.files) : [];
  for (const [rawName, rawText] of fileNotes) {
    const name = String(rawName).split('/').pop();
    const file = facts.files.find((item) => item.name === name);
    if (!file) {
      const names = facts.files.map((item) => item.name);
      throw new BridgeError('META_FILE_NOT_FOUND', `资料包里没有文件「${name}」${names.length ? `；现有：${names.slice(0, 20).join('、')}` : ''}`, { status: 404 });
    }
    if (typeof rawText !== 'string' || !rawText.trim()) continue;
    guard(`file:${name}`, model.files.get(name), `「${name}」的说明`);
    const text = oneLine(rawText, 60);
    model.files.set(name, { name, text, label: label(text), by, date, ver: file.ver });
    deleted.delete(`file:${name}`);
    written.push(name);
  }
  if (!written.length) throw new BridgeError('META_EMPTY', 'meta 至少要有 summary 或 files:{文件名:"说明"}', { status: 400 });
  const content = renderMeta(model);
  const owner = { ownerKind: target.ownerKind, ownerId: target.ownerId };
  // 直接写资料包：不包作者标记（整份由行尾标记区分人/Agent），也不登记进 index.md 的资料包索引区段。
  if (facts.metaText === null) await context.bundleStore.createMarkdown({ ...owner, fileName: META_FILE, content });
  else await context.bundleStore.replaceMarkdown({ ...owner, fileName: META_FILE, content, baseEtag: facts.metaEtag });
  await writeMetaState(metaStateFor(context, target), { written: content, deleted: [...deleted] });
  return { path: `${target.ownerKind === 'node' ? 'nodes' : 'routes'}/${target.ownerId}/${META_FILE}`, wrote: written };
}

function stripView(entry) {
  const { stale: _stale, renamedFrom: _renamed, missing: _missing, ...rest } = entry;
  return rest;
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
  const hasMeta = Boolean(args.meta && typeof args.meta === 'object');
  if (!args.node && !args.commands && !args.ack && !hasMeta && !(args.path && hasContent)) {
    throw new BridgeError('WRITE_NOTHING', 'map_write 至少需要 path+content、node、meta 或 commands 之一', { status: 400 });
  }
  if (hasContent && args.path && isMetaFile(String(args.path))) {
    throw new BridgeError('META_WRITE_VIA_META', `${META_FILE} 由程序排版，不能直接写；用 map_write({path:"n3", meta:{summary:"…", files:{"文件名":"说明"}}})`, { status: 400 });
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
  if (hasMeta) {
    out.meta = await writeMeta(service, context, document, { ...args, path: args.path ?? createdNode ?? undefined });
  } else if (createdNode) {
    out.hint = `写一句摘要：map_write({path:"${createdNode}", meta:{summary:"…"}})`;
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
      const importedName = imported.fileName ?? imported.name ?? '';
      return {
        ok: true, path: `${target.ownerKind === 'node' ? 'nodes' : 'routes'}/${target.ownerId}/${importedName}`,
        hint: `写一句说明：map_write({path:"${target.ownerId}", meta:{files:{"${importedName}":"…"}}})`,
      };
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
