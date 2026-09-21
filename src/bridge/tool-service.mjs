import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, isAbsolute } from 'node:path';
import { BridgeError } from './errors.mjs';
import { ContextDocumentProvider } from './context-document-provider.mjs';
import { HumanMdUpdateLog } from './human-md-updates.mjs';
import { MdIndex } from './md-index.mjs';

const schema = (name, description, properties = {}, required = []) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: {
      ...properties,
      projectRoot: {
        type: 'string',
        description: '（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。',
      },
    },
    ...(required.length ? { required } : {}),
    additionalProperties: true,
  },
});

const owner = {
  ownerKind: { type: 'string', enum: ['node', 'route'] },
  ownerId: { type: 'string' },
};

/** 自动为 Agent 写入/追加的内容包裹成对 @author 闭合标签，减少 Agent 心智负担与指令开销。 */
export function ensureAgentAuthorEnvelope(content, actor = 'agent') {
  if (typeof content !== 'string') return content;
  const trimmed = content.trim();
  if (!trimmed) return content;
  // 若已包含任一人机作者标记注释，保持原样，绝不重复包裹
  if (/<!--\s*@author:/i.test(content)) return content;
  const rawActor = String(actor || 'agent').trim();
  const authorId = rawActor.startsWith('agent:') ? rawActor : `agent:${rawActor.replace(/^agent-?/, '') || 'generic'}`;
  return `<!-- @author: ${authorId} -->\n${content.endsWith('\n') ? content : content + '\n'}<!-- /@author -->\n`;
}

/** 提取文档中所有由人类书写的文本行（即剔除任何 @author 闭合块后的非空文本行） */
export function extractHumanLines(markdown) {
  if (typeof markdown !== 'string') return [];
  const lines = markdown.split(/\r?\n/);
  const humanLines = [];
  let inAgent = false;
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    if (inAgent) {
      if (/<!--\s*\/@author\s*-->/i.test(line)) {
        inAgent = false;
        const afterClose = line.replace(/^[\s\S]*?<!--\s*\/@author\s*-->/i, '').trim();
        if (afterClose) {
          humanLines.push(afterClose);
        }
      }
      continue;
    }

    while (/<!--\s*@author:\s*(agent|system)[^\s>]*\s*-->[\s\S]*?<!--\s*\/@author\s*-->/i.test(line)) {
      line = line.replace(/<!--\s*@author:\s*(agent|system)[^\s>]*\s*-->[\s\S]*?<!--\s*\/@author\s*-->/i, '').trim();
    }
    if (!line) continue;

    if (/<!--\s*@author:\s*(agent|system)[^\s>]*\s*-->/i.test(line)) {
      inAgent = true;
      const beforeStart = line.replace(/<!--\s*@author:\s*(agent|system)[^\s>]*\s*-->[\s\S]*$/i, '').trim();
      if (beforeStart) {
        humanLines.push(beforeStart);
      }
      continue;
    }

    if (/^<!--\s*@author:\s*(human|none|clear)\s*-->$/i.test(line)) {
      continue;
    }

    humanLines.push(line);
  }
  return humanLines;
}

/** 智能维护节点资料包在 index.md 中的索引区段（自动登记与同步，绝不碰人类原文） */
export async function syncBundleIndexToMainMarkdown(bundleStore, ownerKind, ownerId) {
  if (!bundleStore || !ownerKind || !ownerId) return;
  try {
    const list = await bundleStore.list({ ownerKind, ownerId, includeArchived: false });
    const otherFiles = (list || []).filter((f) => f.fileName !== 'index.md' && f.name !== 'index.md');

    const indexEntry = await bundleStore.readMarkdown({ ownerKind, ownerId, fileName: 'index.md' }).catch(() => null);
    if (!indexEntry || typeof indexEntry.content !== 'string') return;
    const currentContent = indexEntry.content;

    let indexSection = '';
    if (otherFiles.length > 0) {
      const items = otherFiles.map((f) => {
        const icon = f.kind === 'markdown' ? '📄' : (f.kind === 'png' || f.kind === 'jpg' || f.kind === 'jpeg' || f.kind === 'svg' || f.kind === 'gif') ? '🖼️' : '📎';
        const sizeKb = f.size ? ` (${(f.size / 1024).toFixed(1)} KB)` : '';
        return `- ${icon} [${f.fileName}](${f.fileName})${sizeKb}`;
      }).join('\n');
      indexSection = `<!-- @author: system:bundle-index -->\n## 📁 节点资料包索引\n${items}\n<!-- /@author -->\n`;
    }

    const bundleIndexRegex = /<!--\s*@author:\s*system:bundle-index\s*-->[\s\S]*?<!--\s*\/@author\s*-->\r?\n?/i;
    let nextContent = '';
    if (bundleIndexRegex.test(currentContent)) {
      nextContent = currentContent.replace(bundleIndexRegex, indexSection ? `${indexSection}` : '').trimEnd() + '\n';
    } else if (indexSection) {
      const sep = currentContent.endsWith('\n\n') ? '' : currentContent.endsWith('\n') ? '\n' : '\n\n';
      nextContent = `${currentContent}${sep}${indexSection}`;
    } else {
      return;
    }

    if (nextContent.trim() !== currentContent.trim()) {
      await bundleStore.replaceMarkdown({
        ownerKind,
        ownerId,
        fileName: 'index.md',
        content: nextContent,
        baseEtag: indexEntry.etag,
      }).catch(() => {});
    }
  } catch {
    // 资料包索引自动同步属于贴心增强，出错不阻断主操作
  }
}

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
  schema('map_apply_commands', '通过统一 reducer 原子提交地图命令。⚠ 写入目标默认取全局 active-map 指针——跨地图操作必须显式传 mapKey，否则会写进指针所指的旧图；禁止修改非你创建节点的 name（会被拒绝）；要记录任务清单/新内容时请新建节点，不要原地改名。', { mapKey: { type: 'string' }, documentId: { type: 'string' }, baseRevision: { type: 'integer', minimum: 0 }, commandId: { type: 'string' }, commands: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object' } } }, ['commands']),
  schema('map_validate', '校验当前地图与关联 Markdown 证据。', { document: { type: 'object' } }),
  schema('map_checkpoint', '创建可恢复检查点。', { reason: { type: 'string' } }),
  schema('map_plan_consolidation', '只读生成可审核的整理建议。', { maxSuggestions: { type: 'integer', minimum: 1, maximum: 20 }, now: { type: 'string' } }),
  schema('map_read_markdown', '读取当前地图资料包 Markdown。', { ...owner, fileName: { type: 'string' }, path: { type: 'string' } }),
  schema('map_write_markdown', '用 baseEtag 原子替换资料包 Markdown。全域人类原声保护：严禁删除或覆盖人类原始文字（违规将被拒绝 HUMAN_CONTENT_PROTECTED）；默认追加式：若替换会删除已有内容的行将被拒绝（REWRITE_REMOVES_CONTENT），请优先用 map_append_markdown；确属用户明确要求改写时才传 allowContentRemoval: true。', { ...owner, fileName: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, baseEtag: { type: 'string' }, allowContentRemoval: { type: 'boolean' }, allowHumanContentOverride: { type: 'boolean' }, allowIndexModification: { type: 'boolean' }, wrapAuthor: { type: 'boolean' } }, ['content', 'baseEtag']),
  schema('map_append_markdown', '按路径锁幂等追加 Markdown。可在任意文件（含 index.md）末尾安全追加 Agent 结论、回复或补充要点，自动包裹成对 @author 闭合标签，绝不破坏上方已有的人类原话。', { ...owner, fileName: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, commandId: { type: 'string' } }, ['content', 'commandId']),
  schema('map_list_bundle_files', '列出对象资料包文件。', { ...owner, includeArchived: { type: 'boolean' } }, ['ownerKind', 'ownerId']),
  schema('map_create_markdown', '在对象资料包中新建补充 Markdown（如 01-方案.md）。创建后系统将在 index.md 自动同步登记资料包索引。', { ...owner, fileName: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_rename_bundle_file', '改名补充 Markdown 或附件。', { ...owner, from: { type: 'string' }, to: { type: 'string' } }, ['ownerKind', 'ownerId', 'from', 'to']),
  schema('map_archive_bundle_file', '归档补充 Markdown。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_restore_bundle_file', '恢复补充 Markdown。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_list_assets', '列出对象资料包附件元数据。', { ...owner, includeArchived: { type: 'boolean' } }, ['ownerKind', 'ownerId']),
  schema('map_import_asset', '从 sourcePath（支持项目内相对路径或本机任意绝对路径）流式导入附件（支持 zip、数据包、代码、图片、文档等各类文件）。导入后系统将在 index.md 自动同步登记资料包索引。', { ...owner, sourcePath: { type: 'string' }, fileName: { type: 'string' }, mimeType: { type: 'string' }, allowExternalPath: { type: 'boolean' } }, ['ownerKind', 'ownerId', 'sourcePath']),
  schema('map_archive_asset', '归档对象附件。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_restore_asset', '恢复对象附件。', { ...owner, fileName: { type: 'string' } }, ['ownerKind', 'ownerId', 'fileName']),
  schema('map_read_asset', '返回对象附件路径与元数据（不搬运二进制）。文本类附 content，二进制可传 includeContent 取 base64。', { ...owner, fileName: { type: 'string' }, includeContent: { type: 'boolean' } }, ['ownerKind', 'ownerId', 'fileName']),
]);

export const TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((tool) => tool.name));
const TOOL_NAME_SET = new Set(TOOL_NAMES);

function cleanResult(value) {
  if (!value || typeof value !== 'object') return value;
  const { buffer: _buffer, stream: _stream, ...rest } = value;
  return rest;
}

function ownerArgs(args, mapKey) {
  if (args.ownerKind && args.ownerId) {
    // 修复：owner 与 path 同传时，path 末段（.md）作为 fileName——此前 path 被忽略、静默回落 index.md，
    // 导致“读取/写入自认为的文件”实际落在 index.md 上。
    let fileName = String(args.fileName || '');
    if (!fileName && args.path) {
      const lastSegment = String(args.path).replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
      if (/\.(md|markdown)$/i.test(lastSegment)) fileName = lastSegment;
    }
    return { ownerKind: String(args.ownerKind), ownerId: String(args.ownerId), fileName: fileName || 'index.md' };
  }
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

async function attemptEvidence(document, markdown, { readFull } = {}) {
  const mapDir = typeof document.mapDir === 'string' && document.mapDir ? document.mapDir : '.live-dot-map';
  const edges = (Array.isArray(document.edges) ? document.edges : [])
    .filter((edge) => ['failed', 'success', 'pending'].includes(String(edge.status)) && edge.archived !== true && edge.shelved !== true);
  const result = [];
  for (const edge of edges) {
    const path = String(edge.md || `${mapDir}/routes/${edge.id}/index.md`).replace(/\\/g, '/');
    let text = '';
    const hit = (markdown || []).find((item) => String(item.path).replace(/\\/g, '/') === path);
    if (hit) text = String(hit.text ?? '');
    // 摘要足够就用摘要；不够才按需下探读全文（edges 数量受控）。
    if (!text.trim() && typeof readFull === 'function') {
      try { text = await readFull(path); } catch { text = ''; }
    }
    result.push({
      id: String(edge.id), status: String(edge.status), name: String(edge.name || edge.id), path,
      evidence: markdownSection(text, ['关键证据', '证据']).slice(0, 360),
      result: markdownSection(text, ['结果', '结论']).slice(0, 360),
      failureReason: markdownSection(text, ['失败原因', '失败原因/排除条件']).slice(0, 360),
      nextStep: markdownSection(text, ['下一步', '后续建议']).slice(0, 360),
      hasMarkdown: Boolean(text),
    });
  }
  return result
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
    this.mdIndexes = new Map();
  }

  /** per-map 卡片索引：懒创建 + load + 首次全量建卡。 */
  async #mdIndexFor(context) {
    const key = `${context.projectRoot}/${context.mapKey}`;
    let index = this.mdIndexes.get(key);
    if (!index) {
      index = new MdIndex({ projectRoot: context.projectRoot, mapKey: context.mapKey });
      await index.load();
      this.mdIndexes.set(key, index);
    }
    await index.ensureBuilt({ mapRoot: join(context.projectRoot, '.live-dot-map', 'maps', context.mapKey) });
    return index;
  }

  /** 写路径成功后刷单 owner 卡片（保存/改名/归档/资产/建节点等，双写全覆盖）。 */
  async #refreshCard(ownerKindNodeOrRoute, ownerId, context) {
    if (!ownerKindNodeOrRoute || !ownerId) return;
    try {
      const index = await this.#mdIndexFor(context);
      await index.refreshOwnerAndPersist({
        mapRoot: join(context.projectRoot, '.live-dot-map', 'maps', context.mapKey),
        ownerKind: ownerKindNodeOrRoute === 'route' ? 'routes' : 'nodes',
        ownerId: String(ownerId),
      });
    } catch { /* 卡片刷新失败是加速器自愈兜底，不阻断主操作 */ }
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
    const mdIndex = await this.#mdIndexFor(context);
    const collected = async () => this.contextProvider.collect({
      projectRoot: context.projectRoot,
      mapKey,
      document,
      includeHistory: args.includeHistory === true,
      mdIndex,
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
      const evidence = await attemptEvidence(document, markdown, {
        readFull: async (path) => {
          try {
            const file = ownerArgs({ path }, mapKey);
            return String((await bundleStore.readMarkdown(file)).content ?? '');
          } catch { return ''; }
        },
      });
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
      const commands = Array.isArray(args.commands) ? args.commands : [];
      const result = await store.execute(this.#envelope(context, args, commands, 'mcp-apply'));
      // 建节点原子补建资料包主文档：避免“有记录无 index.md”的半状态。
      await ensureNodeIndexes(bundleStore, commands);
      // 新建节点同步建卡片，保证“有节点必有卡”。
      for (const command of commands) {
        if (command?.op === 'create' && command?.collection === 'nodes' && typeof command?.value?.id === 'string') {
          await this.#refreshCard('node', command.value.id, context);
        }
      }
      // 结构性改名进通知流：agent 对节点 name 的修改（含被放行的自建节点改名）必须对人类可见、可确认，
      // 杜绝 09-10 式“改名静默 10 天无人知”。记录失败不阻断命令结果。
      if (typeof this.actor === 'string' && this.actor.startsWith('agent:')) {
        const renames = commands.filter((command) => command?.op === 'update' && command?.collection === 'nodes' && command?.patch && typeof command.patch.name === 'string');
        if (renames.length) {
          try {
            const structLog = new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey });
            for (const command of renames) {
              await structLog.record({
                path: `struct:nodes/${command.id}/name`,
                etag: '',
                mtime: new Date().toISOString(),
                snippet: `${this.actor} 将节点 ${command.id} 改名为「${command.patch.name}」`,
              });
            }
          } catch { /* 通知失败不影响命令结果 */ }
        }
      }
      return result;
    }
    if (name === 'map_validate') {
      const target = args.document || document;
      const validation = await this.shared.validateDocument(target);
      if (target !== document || !validation.ok) return validation;
      const documents = await collected();
      // 孤儿资料包扫描：磁盘上存在、但地图文档中无对应对象的 nodes|routes 目录（误写/历史 bug 遗留）。
      const knownIds = new Set([...(document.nodes || []), ...(document.routes || [])].map((item) => String(item.id)));
      const orphanBundles = [];
      for (const kind of ['nodes', 'routes']) {
        const dir = join(context.projectRoot, '.live-dot-map', 'maps', mapKey, kind);
        let entries = [];
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          if (entry.isDirectory() && !knownIds.has(entry.name)) orphanBundles.push(`${kind}/${entry.name}`);
        }
      }
      return { ...validation, attemptIssues: this.shared.checkAttemptEvidence(document, documents.markdown), orphanBundles, mapKey };
    }
    if (name === 'map_checkpoint') return store.createSnapshot();
    if (name === 'map_plan_consolidation') {
      const documents = await collected();
      return { mapKey, documentId: context.documentId, revision: snapshot.revision, ...this.shared.planConsolidation(document, { now: typeof args.now === 'string' ? args.now : undefined, maxSuggestions: Number.isInteger(args.maxSuggestions) ? args.maxSuggestions : 12, markdown: documents.markdown }) };
    }

    const file = ownerArgs(args, mapKey);
    // owner 存在性校验（防孤儿资料包）：仅当"地图文档无此对象 且 磁盘也无其资料包目录"才拒绝——
    // 这是纯粹的孤儿创建形态（09-20 事故）。磁盘已有目录的 md-first 内容（画布先建文档、节点后补）合法放行。
    const ownerCollection = file.ownerKind === 'route' ? 'routes' : 'nodes';
    if (!(document[ownerCollection] || []).some((item) => String(item.id) === String(file.ownerId))) {
      const bundleDir = join(context.projectRoot, '.live-dot-map', 'maps', mapKey, ownerCollection, String(file.ownerId));
      let bundleDirExists = false;
      try { bundleDirExists = (await stat(bundleDir)).isDirectory(); } catch { /* 目录不存在 */ }
      if (!bundleDirExists) {
        throw new BridgeError('OWNER_NOT_FOUND', `目标地图 ${mapKey} 不存在 ${file.ownerKind}=${file.ownerId}（文档与磁盘均无），已拒绝以防止形成画布不可见的孤儿资料包`, { status: 404, mapKey });
      }
    }
    const isIndexFile = (file.fileName === 'index.md' || file.name === 'index.md');
    const isAgent = typeof this.actor === 'string' && this.actor.startsWith('agent');

    if (name === 'map_read_markdown') return cleanResult({ ...(await bundleStore.readMarkdown(file)), mapKey });
    if (name === 'map_write_markdown') {
      const rawContent = args.content;
      const content = (args.wrapAuthor !== false && rawContent !== undefined && isAgent)
        ? ensureAgentAuthorEnvelope(rawContent, this.actor)
        : rawContent;

      const current = await bundleStore.readMarkdown(file).catch(() => null);
      const existing = String(current?.content ?? '');
      const next = String(content ?? '');

      // 全域人类原声保护：无论在哪个文件（index.md 或其他子文档），人类书写的文字禁止被 Agent 覆盖或删改
      if (isAgent && args.allowHumanContentOverride !== true && args.allowIndexModification !== true) {
        const existingHumanLines = extractHumanLines(existing);
        if (existingHumanLines.length) {
          const missing = existingHumanLines.filter((line) => !next.includes(line));
          if (missing.length > 0) {
            throw new BridgeError('HUMAN_CONTENT_PROTECTED', `整文替换缺失了人类原始文本（共 ${missing.length} 行，如：“${missing[0].slice(0, 30)}”）。人类书写内容在任何文件下均受到绝对保护，禁止 Agent 擅自覆盖或删减。请改用 map_append_markdown 进行追加，或确保在替换内容中完整保留人类原话。`, { status: 403 });
          }
        }
      }

      // 人机写入契约：默认追加式。整文替换若会删掉已有内容的行，必须显式传 allowContentRemoval。
      if (args.allowContentRemoval !== true) {
        if (existing.trim()) {
          const removed = existing.split(/\r?\n/).filter((line) => line.trim() && !next.includes(line.trim()));
          if (removed.length) {
            throw new BridgeError('REWRITE_REMOVES_CONTENT', `整文替换会删除 ${removed.length} 行已有内容，已拒绝。人与 Agent 的写入默认是追加式：请改用 map_append_markdown；确属用户明确要求改写时，重传 allowContentRemoval: true。`, { status: 409 });
          }
        }
      }
      const result = await bundleStore.replaceMarkdown({ ...file, content, baseEtag: args.baseEtag });
      await this.#refreshCard(file.ownerKind, file.ownerId, context);
      return { ...result, content: String(content), mapKey };
    }
    if (name === 'map_append_markdown') {
      const content = args.wrapAuthor !== false ? ensureAgentAuthorEnvelope(args.content, this.actor) : args.content;
      const result = await bundleStore.appendMarkdown({ ...file, content, commandId: args.commandId });
      await this.#refreshCard(file.ownerKind, file.ownerId, context);
      return { ...result, mapKey };
    }
    if (name === 'map_list_bundle_files') return { mapKey, files: await bundleStore.list({ ...file, includeArchived: args.includeArchived === true }) };
    if (name === 'map_create_markdown') {
      if (isIndexFile) {
        throw new BridgeError('BUNDLE_INDEX_CREATE_USE_ENSURE', 'index.md 是节点主文档，已在节点创建时自动初始化。如需追加内容请使用 map_append_markdown，如需补充方案文档请传入独立文件名（如 01-proposal.md）。', { status: 409 });
      }
      const rawContent = args.content;
      const content = (args.wrapAuthor !== false && rawContent !== undefined)
        ? ensureAgentAuthorEnvelope(rawContent, this.actor)
        : rawContent;
      const result = await bundleStore.createMarkdown({ ...file, content, title: args.title });
      await syncBundleIndexToMainMarkdown(bundleStore, file.ownerKind, file.ownerId);
      await this.#refreshCard(file.ownerKind, file.ownerId, context);
      return { ...result, mapKey };
    }
    if (name === 'map_rename_bundle_file') {
      const result = await bundleStore.rename({ ownerKind: file.ownerKind, ownerId: file.ownerId, from: args.from, to: args.to });
      await syncBundleIndexToMainMarkdown(bundleStore, file.ownerKind, file.ownerId);
      await this.#refreshCard(file.ownerKind, file.ownerId, context);
      return result;
    }
    if (name === 'map_archive_bundle_file' || name === 'map_archive_asset') {
      const result = await bundleStore.archive(file);
      await syncBundleIndexToMainMarkdown(bundleStore, file.ownerKind, file.ownerId);
      await this.#refreshCard(file.ownerKind, file.ownerId, context);
      return result;
    }
    if (name === 'map_restore_bundle_file' || name === 'map_restore_asset') {
      const result = await bundleStore.restore(file);
      await syncBundleIndexToMainMarkdown(bundleStore, file.ownerKind, file.ownerId);
      await this.#refreshCard(file.ownerKind, file.ownerId, context);
      return result;
    }
    if (name === 'map_list_assets') {
      const files = await bundleStore.list({ ...file, includeArchived: args.includeArchived === true });
      return { mapKey, assets: files.filter((entry) => entry.kind !== 'markdown') };
    }
    if (name === 'map_import_asset') {
      const sourcePath = String(args.sourcePath || '');
      const isExt = isAbsolute(sourcePath);
      const result = await bundleStore.importAsset({
        ...file,
        fileName: String(args.fileName || basename(sourcePath)),
        sourcePath,
        mimeType: args.mimeType,
        allowExternalPath: isExt || args.allowExternalPath === true,
      });
      await syncBundleIndexToMainMarkdown(bundleStore, file.ownerKind, file.ownerId);
      await this.#refreshCard(file.ownerKind, file.ownerId, context);
      return result;
    }
    if (name === 'map_read_asset') {
      // 返回路径 + 元数据（不搬运二进制）。文本类附 content；二进制可传 includeContent 取 base64。
      const metadata = await bundleStore.readAsset({ ...file, archived: args.archived === true });
      const bytes = metadata?.buffer ?? Buffer.alloc(0);
      const entry = {
        ownerKind: metadata.ownerKind, ownerId: metadata.ownerId, fileName: metadata.fileName, path: metadata.path,
        archived: Boolean(metadata.archived), kind: metadata.kind, mimeType: metadata.mimeType, disposition: metadata.disposition,
        size: Number(metadata.size ?? 0), updatedAt: metadata.updatedAt ?? null,
      };
      const isText = /^(text\/|application\/(json|xml|javascript))/.test(String(entry.mimeType ?? ''));
      if (bytes.length && isText) entry.content = bytes.toString('utf8');
      if (args.includeContent === true && bytes.length) entry.base64 = bytes.toString('base64');
      return { mapKey, ...entry };
    }
    throw new BridgeError('UNKNOWN_MCP_TOOL', `未知地图工具：${name}`, { status: 404 });
  }
}
