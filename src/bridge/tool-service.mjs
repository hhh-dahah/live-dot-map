import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { BridgeError } from './errors.mjs';
import { ContextDocumentProvider } from './context-document-provider.mjs';
import { HumanMdUpdateLog } from './human-md-updates.mjs';

const schema = (name, description, properties = {}, required = []) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: true,
  },
});

const owner = {
  ownerKind: { type: 'string', enum: ['node', 'route'] },
  ownerId: { type: 'string' },
};

/** REST、stdio 与 Agent Kit 共用的固定 24 项工具契约。 */
export const TOOL_DEFINITIONS = Object.freeze([
  schema('map_get_context', '读取当前地图的结构、推进摘要与明确关联 Markdown。', { query: { type: 'string' }, currentNodeId: { anyOf: [{ type: 'string' }, { type: 'null' }] }, includeHistory: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 12 } }),
  schema('map_list_human_updates', '列出人类尚未确认的标注。'),
  schema('map_ack_human_updates', '摘要明确引用标注 ID 后确认读取。', { ids: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, ['ids', 'summary']),
  schema('map_list', '列出项目内地图与当前 active-map。'),
  schema('map_create', '新建完整地图但不自动切换。', { name: { type: 'string' } }),
  schema('map_switch', '校验目标地图后切换 active-map。', { mapKey: { type: 'string' } }, ['mapKey']),
  schema('map_rename', '修改地图显示名，不改变 mapKey。', { mapKey: { type: 'string' }, name: { type: 'string' } }, ['mapKey', 'name']),
  schema('map_next_candidates', '返回带解释的推进候选。', { query: { type: 'string' }, currentNodeId: { anyOf: [{ type: 'string' }, { type: 'null' }] }, limit: { type: 'integer', minimum: 1, maximum: 12 }, includeHistory: { type: 'boolean' } }),
  schema('map_apply_commands', '通过统一 reducer 原子提交地图命令。', { mapKey: { type: 'string' }, documentId: { type: 'string' }, baseRevision: { type: 'integer', minimum: 0 }, commandId: { type: 'string' }, commands: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } } }, ['commands']),
  schema('map_validate', '校验当前地图与关联 Markdown 证据。', { document: { type: 'object' } }),
  schema('map_checkpoint', '创建可恢复检查点。', { reason: { type: 'string' } }),
  schema('map_plan_consolidation', '只读生成可审核的整理建议。', { maxSuggestions: { type: 'integer', minimum: 1, maximum: 20 }, now: { type: 'string' } }),
  schema('map_read_markdown', '读取当前地图资料包 Markdown。', { ...owner, fileName: { type: 'string' }, path: { type: 'string' } }),
  schema('map_write_markdown', '用 baseEtag 原子替换资料包 Markdown。', { ...owner, fileName: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, baseEtag: { type: 'string' } }, ['content', 'baseEtag']),
  schema('map_append_markdown', '按路径锁幂等追加 Markdown。', { ...owner, fileName: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, commandId: { type: 'string' } }, ['content', 'commandId']),
  schema('map_list_bundle_files', '列出对象资料包文件。', { ...owner, includeArchived: { type: 'boolean' } }, ['ownerKind', 'ownerId']),
  schema('map_create_markdown', '在对象资料包中新建补充 Markdown。', { ...owner, fileName: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_rename_bundle_file', '改名补充 Markdown 或附件。', { ...owner, from: { type: 'string' }, to: { type: 'string' } }, ['ownerKind', 'ownerId', 'from', 'to']),
  schema('map_archive_bundle_file', '归档补充 Markdown。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_restore_bundle_file', '恢复补充 Markdown。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_list_assets', '列出对象资料包附件元数据。', { ...owner, includeArchived: { type: 'boolean' } }, ['ownerKind', 'ownerId']),
  schema('map_import_asset', '从项目内 sourcePath 流式导入附件。', { ...owner, sourcePath: { type: 'string' }, fileName: { type: 'string' }, mimeType: { type: 'string' } }, ['ownerKind', 'ownerId', 'sourcePath']),
  schema('map_archive_asset', '归档对象附件。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_restore_asset', '恢复对象附件。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
]);

export const TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((tool) => tool.name));
const TOOL_NAME_SET = new Set(TOOL_NAMES);

function cleanResult(value) {
  if (!value || typeof value !== 'object') return value;
  const { buffer: _buffer, stream: _stream, ...rest } = value;
  return rest;
}

function ownerArgs(args, mapKey) {
  if (args.ownerKind && args.ownerId) return {
    ownerKind: String(args.ownerKind), ownerId: String(args.ownerId), fileName: String(args.fileName || 'index.md'),
  };
  const raw = String(args.path || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const prefix = `.live-dot-map/maps/${mapKey}/`;
  const relative = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^\.live-dot-map\//, '');
  const match = relative.match(/^(nodes|routes)\/([^/]+)\/(.+)$/);
  if (!match) throw new BridgeError('BUNDLE_PATH_REQUIRED', '路径必须指向当前地图的 nodes|routes/<id>/<file>', { status: 400 });
  return { ownerKind: match[1] === 'nodes' ? 'node' : 'route', ownerId: match[2], fileName: match[3] };
}

/**
 * 空 query 的默认上下文：按最近更新倒序取非空的资料包主文档，
 * 让 Agent 一进入地图就能看到最新书写，而不是只能靠 BM25 命中。
 */
function recentMarkdown(markdownList, limit = 6) {
  return (Array.isArray(markdownList) ? markdownList : [])
    .filter((item) => String(item.text ?? '').trim().length > 0)
    .sort((left, right) => new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime())
    .slice(0, limit)
    .map((item) => ({
      kind: 'markdown',
      id: item.path,
      path: item.path,
      score: 0,
      reasons: ['最近书写'],
      source: 'markdown',
      relationPath: [],
      snippet: String(item.text ?? '').replace(/\s+/g, ' ').slice(0, 320),
    }));
}

/** 建节点命令提交成功后，原子补建资料包主文档 index.md（幂等；补建失败不阻断已落盘的提交）。 */
async function ensureNodeIndexes(bundleStore, commands) {
  if (!bundleStore || !Array.isArray(commands)) return;
  for (const command of commands) {
    if (command?.op !== 'create' || command?.collection !== 'nodes' || typeof command?.value?.id !== 'string') continue;
    try {
      await bundleStore.ensureIndex({ ownerKind: 'node', ownerId: command.value.id, title: String(command.value.name ?? '') });
    } catch { /* 提交已写 WAL/map.json，index.md 补建失败仅影响懒创建；留待打开时兜底。 */ }
  }
}

/** 把「未确认的人类 md 写入」并入投影 humanUpdates（与标注并列，Agent 必看）。 */
async function mergeHumanMdUpdates(context, projection) {
  try {
    const log = new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey: context.mapKey });
    const items = await log.unacknowledged();
    if (items.length) {
      const merged = [
        ...(Array.isArray(projection.humanUpdates) ? projection.humanUpdates : []),
        ...items.map((item) => ({
          id: item.id,
          text: item.snippet || item.path,
          attention: 'new',
          priority: 'normal',
          target: { kind: 'markdown', path: item.path },
          source: 'human',
        })),
      ];
      projection.humanUpdates = merged.slice(0, 12);
    }
  } catch { /* 信号读取失败不阻断上下文 */ }
  return projection;
}

function markdownSection(text, headings) {
  const wanted = new Set(headings.map((heading) => heading.replace(/\s+/g, '')));
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*#{1,6}\s*(.*?)\s*$/);
    if (!match || !wanted.has(match[1].replace(/[：:]\s*$/, '').replace(/\s+/g, ''))) continue;
    const content = [];
    for (let next = index + 1; next < lines.length && !/^\s*#{1,6}\s+/.test(lines[next]); next += 1) content.push(lines[next]);
    return content.join('\n').trim();
  }
  return '';
}

function attemptEvidence(document, markdown) {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, '/'), String(item.text ?? '')]));
  const mapDir = typeof document.mapDir === 'string' && document.mapDir ? document.mapDir : '.live-dot-map';
  return (Array.isArray(document.edges) ? document.edges : [])
    .filter((edge) => ['failed', 'success', 'pending'].includes(String(edge.status)) && edge.archived !== true && edge.shelved !== true)
    .map((edge) => {
      const path = String(edge.md || `${mapDir}/routes/${edge.id}/index.md`).replace(/\\/g, '/');
      const text = docs.get(path) || '';
      return {
        id: String(edge.id), status: String(edge.status), name: String(edge.name || edge.id), path,
        evidence: markdownSection(text, ['关键证据', '证据']).slice(0, 360),
        result: markdownSection(text, ['结果', '结论']).slice(0, 360),
        failureReason: markdownSection(text, ['失败原因', '失败原因/排除条件']).slice(0, 360),
        nextStep: markdownSection(text, ['下一步', '后续建议']).slice(0, 360),
        hasMarkdown: Boolean(text),
      };
    })
    .sort((left, right) => (left.status === 'failed' ? -1 : 0) - (right.status === 'failed' ? -1 : 0) || left.id.localeCompare(right.id))
    .slice(0, 8);
}

export class ToolService {
  constructor(options = {}) {
    if (!options.mapManager) throw new BridgeError('MAP_MANAGER_REQUIRED', 'ToolService 需要 MapManager', { status: 500 });
    if (!options.shared) throw new BridgeError('SHARED_ADAPTER_REQUIRED', 'ToolService 需要 shared adapter', { status: 500 });
    this.mapManager = options.mapManager;
    this.shared = options.shared;
    this.actor = String(options.actor || 'agent:generic').startsWith('agent:') ? String(options.actor || 'agent:generic') : 'agent:generic';
    this.projectHandle = String(options.projectHandle || 'stdio');
    this.contextProvider = options.contextProvider ?? new ContextDocumentProvider();
  }

  async #context(args = {}) {
    return this.mapManager.resolve({ ...(typeof args.mapKey === 'string' && args.mapKey ? { mapKey: args.mapKey } : {}) });
  }

  #envelope(context, args, commands, prefix) {
    const claimed = args.documentId ?? args.projectId;
    if (claimed !== undefined && String(claimed) !== context.documentId) {
      throw new BridgeError('DOCUMENT_ID_MISMATCH', 'documentId 与当前 mapKey 不匹配', { status: 409 });
    }
    return {
      projectId: context.documentId,
      baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : context.snapshot.revision,
      commandId: typeof args.commandId === 'string' ? args.commandId : `${prefix}-${randomUUID()}`,
      actor: this.actor,
      sessionId: typeof args.sessionId === 'string' ? args.sessionId : `tool-${randomUUID()}`,
      commands,
    };
  }

  async dispatch(name, args = {}) {
    if (!TOOL_NAME_SET.has(name)) throw new BridgeError('UNKNOWN_MCP_TOOL', `未知地图工具：${name}`, { status: 404 });
    if (name === 'map_list') return this.mapManager.list();
    if (name === 'map_create') return this.mapManager.create(String(args.name || ''));
    if (name === 'map_switch') return this.mapManager.switch(String(args.mapKey || ''));
    if (name === 'map_rename') return this.mapManager.rename(String(args.mapKey || ''), String(args.name || ''), this.actor);

    const context = await this.#context(args);
    const { store, bundleStore, snapshot, mapKey } = context;
    const document = snapshot.document;
    const collected = async () => this.contextProvider.collect({
      projectRoot: context.projectRoot,
      mapKey,
      document,
      includeHistory: args.includeHistory === true,
    });

    if (name === 'map_get_context' || name === 'map_next_candidates') {
      const documents = await collected();
      const markdown = documents.markdown;
      const queryText = String(args.query ?? '').trim();
      const retrieved = this.shared.retrieveContext(document, queryText, {
        currentNodeId: args.currentNodeId == null ? null : String(args.currentNodeId),
        limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
        includeHistory: args.includeHistory === true,
        markdown,
      });
      const evidence = attemptEvidence(document, markdown);
      const projection = await mergeHumanMdUpdates(context, { ...this.shared.buildProjectProjection(document, { now: typeof args.now === 'string' ? args.now : undefined }), attemptEvidence: evidence });
      if (name === 'map_get_context') return { projectHandle: this.projectHandle, mapKey, documentId: context.documentId, revision: snapshot.revision, projection, attemptEvidence: evidence, assets: documents.assets, ...retrieved, markdown: queryText ? retrieved.markdown : recentMarkdown(markdown) };
      return { projectHandle: this.projectHandle, mapKey, documentId: context.documentId, revision: snapshot.revision, projection, attemptEvidence: evidence, assets: documents.assets, alternatives: this.shared.findExplorationAlternatives(document, args.currentNodeId == null ? null : String(args.currentNodeId), { limit: 3 }), ...retrieved, autonomy: this.shared.autonomyDecision(document, retrieved.objects) };
    }
    if (name === 'map_list_human_updates') {
      const updates = document.anns.filter((ann) => ann.source === 'human' && ['new', 'delivered'].includes(String(ann.attention)));
      const mdItems = await new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey }).unacknowledged().catch(() => []);
      return {
        mapKey,
        documentId: context.documentId,
        revision: snapshot.revision,
        updates: [
          ...updates,
          ...mdItems.map((item) => ({ id: item.id, text: item.snippet || item.path, attention: 'new', priority: 'normal', target: { kind: 'markdown', path: item.path }, source: 'human' })),
        ],
      };
    }
    if (name === 'map_ack_human_updates') {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const annIds = ids.filter((id) => !id.startsWith('md:'));
      const mdPaths = ids.filter((id) => id.startsWith('md:')).map((id) => id.slice(3));
      // md:<path> 条目先写 ack 信号；标注部分仍走 ack_annotations 命令。
      if (mdPaths.length) {
        try {
          await new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey }).acknowledge(mdPaths);
        } catch { /* md ack 失败不阻断标注确认 */ }
      }
      return store.execute(this.#envelope(context, args, [{ op: 'ack_annotations', ids: annIds, summary: String(args.summary || '') }], 'mcp-ack'));
    }
    if (name === 'map_apply_commands') {
      const result = await store.execute(this.#envelope(context, args, Array.isArray(args.commands) ? args.commands : [], 'mcp-apply'));
      // 建节点原子补建资料包主文档：避免“有记录无 index.md”的半状态。
      await ensureNodeIndexes(bundleStore, Array.isArray(args.commands) ? args.commands : []);
      return result;
    }
    if (name === 'map_validate') {
      const target = args.document || document;
      const validation = await this.shared.validateDocument(target);
      if (target !== document || !validation.ok) return validation;
      const documents = await collected();
      return { ...validation, attemptIssues: this.shared.checkAttemptEvidence(document, documents.markdown) };
    }
    if (name === 'map_checkpoint') return store.createSnapshot();
    if (name === 'map_plan_consolidation') {
      const documents = await collected();
      return { mapKey, documentId: context.documentId, revision: snapshot.revision, ...this.shared.planConsolidation(document, { now: typeof args.now === 'string' ? args.now : undefined, maxSuggestions: Number.isInteger(args.maxSuggestions) ? args.maxSuggestions : 12, markdown: documents.markdown }) };
    }

    const file = ownerArgs(args, mapKey);
    if (name === 'map_read_markdown') return cleanResult(await bundleStore.readMarkdown(file));
    if (name === 'map_write_markdown') {
      const result = await bundleStore.replaceMarkdown({ ...file, content: args.content, baseEtag: args.baseEtag });
      return { ...result, content: String(args.content) };
    }
    if (name === 'map_append_markdown') return bundleStore.appendMarkdown({ ...file, content: args.content, commandId: args.commandId });
    if (name === 'map_list_bundle_files') return { mapKey, files: await bundleStore.list({ ...file, includeArchived: args.includeArchived === true }) };
    if (name === 'map_create_markdown') return bundleStore.createMarkdown({ ...file, content: args.content, title: args.title });
    if (name === 'map_rename_bundle_file') return bundleStore.rename({ ownerKind: file.ownerKind, ownerId: file.ownerId, from: args.from, to: args.to });
    if (name === 'map_archive_bundle_file' || name === 'map_archive_asset') return bundleStore.archive(file);
    if (name === 'map_restore_bundle_file' || name === 'map_restore_asset') return bundleStore.restore(file);
    if (name === 'map_list_assets') {
      const files = await bundleStore.list({ ...file, includeArchived: args.includeArchived === true });
      return { mapKey, assets: files.filter((entry) => entry.kind !== 'markdown') };
    }
    if (name === 'map_import_asset') {
      return bundleStore.importAsset({ ...file, fileName: String(args.fileName || basename(String(args.sourcePath || ''))), sourcePath: String(args.sourcePath || ''), mimeType: args.mimeType });
    }
    throw new BridgeError('UNKNOWN_MCP_TOOL', `未知地图工具：${name}`, { status: 404 });
  }
}
