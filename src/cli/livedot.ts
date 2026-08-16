import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isSea } from 'node:sea';
import { createBridgeServer, createLogger, ProjectStore } from '../bridge/index.mjs';
import { ensureMapsLayout, mapDirectory, mapRelativeDirectory } from '../bridge/maps.mjs';
import { loadSharedAdapter } from '../bridge/shared-adapter.mjs';
import { autonomyDecision, buildProjectProjection, checkAttemptEvidence, findExplorationAlternatives, planConsolidation, retrieveContext, validateMapDocument } from '../shared/index.ts';
import { doctorProject, installProject, uninstallProject } from '../../agent-kit/lib/installer.mjs';

if (isSea()) process.env.LIVEDOT_SEA = '1';

type Args = Record<string, string | boolean>;
type Json = Record<string, unknown>;

function parseArgs(values: string[]): { command: string; args: Args } {
  const [command = 'help', ...rest] = values;
  const args: Args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return { command, args };
}

function required(args: Args, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value) throw new Error(`缺少 --${name}`);
  return value;
}

async function markdownDocuments(root: string, limit = 200): Promise<Array<{ path: string; text: string }>> {
  const output: Array<{ path: string; text: string }> = [];
  const ignored = new Set(['.git', 'node_modules', '.next', 'dist', 'out', '.bridge', 'backups', 'snapshots', 'quarantine']);
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 5 || output.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= limit || ignored.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        const metadata = await stat(full).catch(() => null);
        if (!metadata || metadata.size > 2_000_000) continue;
        const text = await readFile(full, 'utf8').catch(() => '');
        if (text && text.length <= 2_000_000) output.push({ path: full.slice(root.length + 1).replace(/\\/g, '/'), text });
      }
    }
  };
  await walk(root, 0);
  return output;
}

function markdownSection(text: string, headings: string[]): string {
  const wanted = new Set(headings.map((heading) => heading.replace(/\s+/g, '')));
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*#{1,6}\s*(.*?)\s*$/);
    if (!match || !wanted.has(match[1].replace(/[：:]\s*$/, '').replace(/\s+/g, ''))) continue;
    const content: string[] = [];
    for (let next = index + 1; next < lines.length && !/^\s*#{1,6}\s+/.test(lines[next]); next += 1) content.push(lines[next]);
    return content.join('\n').trim();
  }
  return '';
}

function attemptEvidence(document: Json, markdown: Array<{ path: string; text: string }>): Json[] {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, '/'), String(item.text ?? '')]));
  const edges = Array.isArray(document.edges) ? document.edges as Json[] : [];
  const mapDir = typeof document.mapDir === 'string' && document.mapDir ? document.mapDir : '.live-dot-map';
  return edges
    .filter((edge) => ['failed', 'success', 'pending'].includes(String(edge.status)) && edge.archived !== true && edge.shelved !== true)
    .map((edge) => {
      const path = String(edge.md ?? `${mapDir}/routes/${edge.id}.md`).replace(/\\/g, '/');
      const text = docs.get(path) ?? '';
      const result = markdownSection(text, ['结果', '结论']);
      const failureReason = markdownSection(text, ['失败原因', '失败原因/排除条件']);
      const nextStep = markdownSection(text, ['下一步', '后续建议']);
      const evidence = markdownSection(text, ['关键证据', '证据']);
      return {
        id: String(edge.id), status: String(edge.status), name: String(edge.name ?? edge.id), path,
        evidence: evidence.slice(0, 360), result: result.slice(0, 360),
        failureReason: failureReason.slice(0, 360), nextStep: nextStep.slice(0, 360),
        hasMarkdown: Boolean(text),
      };
    })
    .filter((item) => item.status === 'failed' || item.status === 'pending' || item.status === 'success')
    .sort((a, b) => (a.status === 'failed' ? -1 : 0) - (b.status === 'failed' ? -1 : 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0, 8);
}

async function recordAgentHealth(root: string, actor: string, event: string, status: 'ok' | 'error', error?: unknown): Promise<void> {
  const path = join(root, '.live-dot-map', '.bridge', 'agent-health.json');
  const prior = await readFile(path, 'utf8').then((text) => JSON.parse(text) as Json).catch(() => ({} as Json));
  const records = prior.records && typeof prior.records === 'object' && !Array.isArray(prior.records) ? prior.records as Json : {};
  const value = error as { code?: string | number; message?: string } | undefined;
  records[actor.replace(/^agent:/, '')] = {
    status, actor, event, boundary: event.startsWith('hook:') ? 'hook' : 'mcp', at: new Date().toISOString(),
    ...(status === 'error' ? { code: value?.code ?? 'HOOK_FAILED', message: String(value?.message ?? value ?? '未知错误').slice(0, 400) } : {}),
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records }, null, 2)}\n`, 'utf8'); await rename(temporary, path); } catch { /* health is best-effort and must not change map writes */ }
}

async function openStore(projectRoot: string): Promise<ProjectStore> {
  // MCP/hook 进程是短生命周期写入方；常驻桥负责跨进程轮询和画布 SSE 通知。
  // 多地图布局：先幂等迁移/补指针，再按 active-map 指针打开当前地图的目录。
  const root = resolve(projectRoot);
  const { activeMap } = await ensureMapsLayout(root);
  let mapName: string | undefined;
  try {
    const parsed = JSON.parse(await readFile(join(mapDirectory(root, activeMap), 'map.json'), 'utf8'));
    if (typeof parsed?.name === 'string' && parsed.name) mapName = parsed.name;
  } catch { /* 空地图由 ProjectStore 创建，用默认名 */ }
  return ProjectStore.open({
    projectRoot: root,
    dataDirectory: mapDirectory(root, activeMap),
    mapName,
    mapDir: mapRelativeDirectory(activeMap),
    shared: await loadSharedAdapter(),
    pollIntervalMs: 0,
  });
}

function envelope(projectId: string, revision: number, actor: string, sessionId: string, commands: Json[]): Json {
  return { projectId, baseRevision: revision, commandId: `cmd-${randomUUID()}`, actor, sessionId, commands };
}

function compactHookContext(value: unknown): Json {
  const context = value && typeof value === 'object' ? value as Json : {};
  const objects = Array.isArray(context.objects) ? context.objects as Json[] : [];
  const markdown = Array.isArray(context.markdown) ? context.markdown as Json[] : [];
  return {
    revision: context.revision,
    projection: context.projection,
    objects: objects.slice(0, 6).map((item) => ({
      kind: item.kind, id: item.id, score: item.score, source: item.source,
      reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 3) : [],
      relationPath: Array.isArray(item.relationPath) ? item.relationPath.slice(0, 3) : [],
    })),
    markdown: markdown.slice(0, 2).map((item) => ({
      path: item.path, score: item.score,
      reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 2) : [],
      snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 360) : '',
    })),
  };
}

async function callTool(store: ProjectStore, root: string, tool: string, args: Json, defaultActor = 'agent:generic'): Promise<unknown> {
  const snapshot = await store.snapshot();
  const document = snapshot.document as Json;
  // The adapter process, not model-provided tool arguments, owns identity.
  // Otherwise a model could submit actor="human" and bypass human-only
  // delete/curation rules in the shared reducer.
  const actor = defaultActor.startsWith('agent:') ? defaultActor : 'agent:generic';
  const sessionId = `session-${randomUUID()}`;
  if (tool === 'map_get_context') {
    const markdown = await markdownDocuments(root);
    const projection = { ...buildProjectProjection(document as never), attemptEvidence: attemptEvidence(document, markdown) };
    return { revision: snapshot.revision, projection, attemptEvidence: projection.attemptEvidence, ...retrieveContext(document as never, String(args.query ?? ''), { currentNodeId: args.currentNodeId == null ? null : String(args.currentNodeId), markdown }) };
  }
  if (tool === 'map_list_human_updates') {
    const anns = Array.isArray(document.anns) ? document.anns as Json[] : [];
    return { revision: snapshot.revision, updates: anns.filter((ann) => ann.source === 'human' && ['new', 'delivered'].includes(String(ann.attention))) };
  }
  if (tool === 'map_ack_human_updates') {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    return store.execute(envelope(String(document.mapId), snapshot.revision, actor, sessionId, [{ op: 'ack_annotations', ids, summary: String(args.summary ?? '') }]) as never);
  }
  if (tool === 'map_next_candidates') {
    const markdown = await markdownDocuments(root);
    const context = retrieveContext(document as never, String(args.query ?? ''), {
      currentNodeId: args.currentNodeId === null || args.currentNodeId === undefined ? null : String(args.currentNodeId),
      limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
      includeHistory: args.includeHistory === true,
      markdown,
    });
    return { revision: snapshot.revision, alternatives: findExplorationAlternatives(document as never, args.currentNodeId == null ? null : String(args.currentNodeId), { limit: 3 }), attemptEvidence: attemptEvidence(document, markdown), ...context, autonomy: autonomyDecision(document as never, context.objects) };
  }
  if (tool === 'map_apply_commands') {
    const request = {
      ...envelope(String(document.mapId), snapshot.revision, actor, sessionId, Array.isArray(args.commands) ? args.commands as Json[] : []),
      baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : snapshot.revision,
      commandId: typeof args.commandId === 'string' ? args.commandId : `cmd-${randomUUID()}`,
    };
    return store.execute(request as never);
  }
  if (tool === 'map_validate') {
    const target = args.document ?? document;
    const validation = validateMapDocument(target);
    return target === document ? { ...validation, attemptIssues: validation.ok ? checkAttemptEvidence(document as never, await markdownDocuments(root)) : [] } : validation;
  }
  if (tool === 'map_checkpoint') return store.createSnapshot();
  if (tool === 'map_plan_consolidation') {
    const markdown = await markdownDocuments(root);
    return { ...planConsolidation(document as never, {
      now: typeof args.now === 'string' ? args.now : undefined,
      maxSuggestions: Number.isInteger(args.maxSuggestions) ? Number(args.maxSuggestions) : 12,
      markdown,
    }), revision: snapshot.revision };
  }
  throw Object.assign(new Error(`未知工具 ${tool}`), { code: 'UNKNOWN_TOOL' });
}

const toolDefinitions = [
  ['map_get_context', '按图结构与本地 Markdown 检索本轮相关上下文', { query: { type: 'string' } }],
  ['map_list_human_updates', '列出 new/delivered 的人类标注', {}],
  ['map_ack_human_updates', '摘要明确引用标注 ID 后确认读取', { ids: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }],
  ['map_next_candidates', '返回带可解释分数的推进候选与自治判断', {
    query: { type: 'string' }, currentNodeId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    limit: { type: 'integer', minimum: 1, maximum: 12 }, includeHistory: { type: 'boolean' },
  }],
  ['map_apply_commands', '通过统一 reducer 原子提交地图命令', { commands: { type: 'array' } }],
  ['map_validate', '校验 v2 地图或当前地图', { document: { type: 'object' } }],
  ['map_checkpoint', '创建人工检查点', {}],
  ['map_plan_consolidation', '只读分析可审核的地图整理建议，不直接修改地图', { maxSuggestions: { type: 'integer', minimum: 1, maximum: 20 } }],
].map(([name, description, properties]) => ({ name, description, inputSchema: { type: 'object', properties, additionalProperties: true } }));

async function runMcp(projectRoot: string, actor: string): Promise<void> {
  const root = resolve(projectRoot);
  const logger = createLogger({ source: 'agent' });
  const store = await openStore(root);
  await logger.info('agent.mcp.start', { project: root, actor, pid: process.pid });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let request: Json;
    try { request = JSON.parse(line); } catch { continue; }
    if (!('id' in request)) continue;
    const id = request.id;
    try {
      let result: unknown;
      if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'live-dot-map', version: '2.0.0' } };
      else if (request.method === 'tools/list') result = { tools: toolDefinitions };
      else if (request.method === 'tools/call') {
        const params = request.params as Json;
        const value = await callTool(store, root, String(params.name), (params.arguments as Json) ?? {}, actor);
        result = { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
      } else throw Object.assign(new Error(`未知方法 ${String(request.method)}`), { code: -32601 });
      await recordAgentHealth(root, actor, `mcp:${String(request.method === 'tools/call' ? (request.params as Json)?.name ?? 'call' : request.method)}`, 'ok');
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    } catch (error) {
      const value = error as Error & { code?: string | number; details?: unknown };
      await recordAgentHealth(root, actor, `mcp:${String((request.params as Json | undefined)?.name ?? request.method ?? 'unknown')}`, 'error', value);
      await logger.error('agent.mcp', { tool: String((request.params as Json | undefined)?.name ?? request.method ?? 'unknown'), error: value });
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: typeof value.code === 'number' ? value.code : -32000, message: value.message, data: { code: value.code, details: value.details } } })}\n`);
    }
  }
}

async function runHook(kind: string, args: Args): Promise<void> {
  const root = resolve(required(args, 'project'));
  const actor = `agent:${String(args.agent || 'generic')}`;
  const sessionId = String(args.session || `session-${randomUUID()}`);
  const logger = createLogger({ source: 'agent' });
  await logger.info('agent.hook.start', { event: kind, actor, project: root });
  const store = await openStore(root);
  const snapshot = await store.snapshot();
  const document = snapshot.document as Json;
  if (kind === 'session-start') {
    // 增量变更通知（2026-08-15 原则：无事不打扰，有事必回应）。
    // 已读水位 .live-dot-map/agent-read.json：只报告水位之后的节点/方案/标注/路线变化。
    const watermarkPath = join(root, '.live-dot-map', 'agent-read.json');
    let watermark = 0;
    try {
      const parsed = JSON.parse(await readFile(watermarkPath, 'utf8')) as Json;
      if (typeof parsed?.updatedAt === 'string') watermark = Date.parse(parsed.updatedAt);
    } catch { /* 首次运行 */ }
    const since = watermark || Date.now();
    const changes: { label: string; id: string; name: string; status: string; attention: string }[] = [];
    const collections: [string, string][] = [['nodes', '节点'], ['edges', '方案'], ['anns', '标注'], ['routes', '路线']];
    for (const [collection, label] of collections) {
      for (const item of Array.isArray((document as Json)[collection]) ? (document as Json)[collection] as Json[] : []) {
        const updated = Date.parse(String(item.updatedAt));
        if (Number.isFinite(updated) && updated > since) {
          changes.push({
            label,
            id: String(item.id),
            name: String(item.name ?? item.text ?? ''),
            status: item.status ? String(item.status) : '',
            attention: item.attention ? String(item.attention) : '',
          });
        }
      }
    }
    const newAnns = (document.anns as Json[]).filter((ann) => (ann as Json).source === 'human' && (ann as Json).attention === 'new');
    let deliveredIds: string[] = [];
    if (newAnns.length) {
      await store.execute(envelope(String(document.mapId), snapshot.revision, actor, sessionId, [{ op: 'deliver_annotations', ids: newAnns.map((ann) => String((ann as Json).id)), deliveryId: sessionId }]) as never);
      deliveredIds = newAnns.map((ann) => String((ann as Json).id));
    }
    // 有增量或交付了新标注都必须回应（无事不打扰，有事必回应）。
    if (changes.length || deliveredIds.length) {
      await mkdir(dirname(watermarkPath), { recursive: true });
      await writeFile(watermarkPath, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
      const newCount = changes.filter((item) => item.label === '标注' && item.attention === 'new').length;
      const lines = changes.slice(0, 20).map((item) => `${item.label} ${item.id}${item.name ? `「${item.name}」` : ''}${item.status ? `(${item.status})` : ''}`);
      const output = {
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [
          `[活点地图] 自上次以来有 ${changes.length} 处更新（${newCount} 条新标注优先）：`,
          ...lines,
          ...(deliveredIds.length ? [`人类标注已交付（摘要中请逐字引用）：${deliveredIds.join('、')}`] : []),
          changes.length > 20 ? `…共 ${changes.length} 处` : '',
          '详细请读 .live-dot-map/map.json。',
        ].filter(Boolean).join('\n') },
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
    // 无变更且无新交付：零输出（无事不打扰）。
    await recordAgentHealth(root, actor, 'hook:session-start', 'ok');
    return;
  }
  if (kind === 'user-prompt') {
    let prompt = typeof args.prompt === 'string' ? args.prompt : '';
    if (!prompt && !process.stdin.isTTY) {
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      try {
        const input = JSON.parse(raw) as Json;
        prompt = String(input.prompt ?? input.user_prompt ?? input.input ?? raw);
      } catch { prompt = raw; }
    }
    const context = await callTool(store, root, 'map_get_context', { query: prompt }, actor);
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: JSON.stringify(compactHookContext(context)) } })}\n`);
    await recordAgentHealth(root, actor, 'hook:user-prompt', 'ok');
    return;
  }
  if (kind === 'stop') {
    let hookInput: Json = {};
    if (!process.stdin.isTTY) {
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      try { hookInput = raw ? JSON.parse(raw) as Json : {}; } catch { hookInput = {}; }
    }
    const updates = await callTool(store, root, 'map_list_human_updates', {}, actor) as Json;
    const validation = await callTool(store, root, 'map_validate', {}, actor) as Json;
    const attemptIssues = Array.isArray(validation.attemptIssues) ? validation.attemptIssues as Json[] : [];
    const incomplete = (Array.isArray(updates.updates) && updates.updates.length > 0) || attemptIssues.length > 0 || validation.ok === false;
    const attempt = Number(args.attempt || process.env.LIVEDOT_STOP_ATTEMPT || (hookInput.stop_hook_active ? 2 : 1)) || 1;
    if (incomplete && attempt >= 2) {
      const current = await store.snapshot();
      await store.execute(envelope(String((current.document as Json).mapId), current.revision, actor, sessionId, [{
        op: 'set_ui',
        patch: { collaboration: { status: 'incomplete', agent: actor, sessionId, at: new Date().toISOString(), reason: attemptIssues.length ? `大尝试证据未闭环：${attemptIssues.map((item) => `${item.edgeId}（${(item.missing as string[] || []).join('、')}）`).join('；')}` : '人类标注未完成摘要引用与确认' } },
      }]) as never);
    }
    const reason = incomplete
      ? (attemptIssues.length ? (attempt < 2 ? '大尝试缺少证据/结果/下一步 Markdown；请先补齐方案记录。' : '第二次检查仍有大尝试证据缺口，允许结束但画布保持红色。') : (attempt < 2 ? '仍有人类标注未完成摘要引用与 ack；请先闭环地图。' : '第二次检查仍未闭环，允许结束但画布保持红色。'))
      : '地图闭环完成。';
    // Codex validates hook stdout against the event schema. Product-only
    // fields (such as deliveredIds/uiStatus) stay in the library result and
    // persisted map state, never in the wire response.
    const output: Json = incomplete && attempt < 2
      ? { decision: 'block', reason }
      : { systemMessage: reason };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    await recordAgentHealth(root, actor, 'hook:stop', incomplete ? 'error' : 'ok', incomplete ? new Error(reason) : undefined);
  }
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'serve') {
    const logger = createLogger({ source: 'bridge' });
    const projectRoot = resolve(required(args, 'project'));
    const appPath = resolve(typeof args.app === 'string' ? args.app : join(process.cwd(), 'app.html'));
    const appHtml = await readFile(appPath, 'utf8');
    const assetRoot = dirname(appPath);
    const staticAssets: Json = {};
    for (const [urlPath, file, type] of [
      ['/sw.js', 'sw.js', 'text/javascript; charset=utf-8'],
      ['/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
      ['/icons/icon-192.png', join('icons', 'icon-192.png'), 'image/png'],
      ['/icons/icon-512.png', join('icons', 'icon-512.png'), 'image/png'],
    ]) {
      try { staticAssets[urlPath] = { body: await readFile(join(assetRoot, file)), type }; } catch { /* 可选 PWA 资产 */ }
    }
    const bridge = await (createBridgeServer as (options: Json) => Promise<{ origin: string; bootstrapToken: string; close(): Promise<void> }>)({ allowedProjectRoots: [projectRoot], appHtml, staticAssets, logger });
    const url = `${bridge.origin}/app.html?token=${encodeURIComponent(bridge.bootstrapToken)}&project=${encodeURIComponent(projectRoot)}`;
    await logger.info('bridge.start', { origin: bridge.origin, project: projectRoot, pid: process.pid });
    process.stdout.write(`${JSON.stringify({ ok: true, origin: bridge.origin, bootstrapToken: bridge.bootstrapToken, url })}\n`);
    const shutdown = async () => { await logger.info('bridge.stop', { pid: process.pid }); await logger.flush(); await bridge.close(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    return;
  }
  if (command === 'mcp') {
    // 全局 MCP 配置不带 --project：Agent 在哪个项目目录启动，就协作哪个项目。
    const project = resolve(typeof args.project === 'string' && args.project.trim() ? args.project : process.cwd());
    return runMcp(project, `agent:${String(args.agent || 'generic')}`);
  }
  if (command === 'hook') {
    // 全局 hook 配置同样不带 --project，用 Agent 当前工作目录。
    const project = resolve(typeof args.project === 'string' && args.project.trim() ? args.project : process.cwd());
    return runHook(String(args.event || 'session-start'), { ...args, project });
  }
  if (command === 'install') {
    const root = resolve(typeof args.project === 'string' ? args.project : process.cwd());
    const runtimeSource = process.env.LIVEDOT_RUNTIME_SOURCE || process.argv[1] || process.cwd();
    const appPath = resolve(typeof args.app === 'string' ? args.app : join(dirname(runtimeSource), 'app.html'));
    const install = installProject as (options: Record<string, unknown>) => Promise<unknown>;
    const result = await install({ projectRoot: root, runtimeSource, appPath, createDesktopShortcut: args['no-shortcut'] !== true, register: false });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === 'doctor') {
    const root = resolve(required(args, 'project'));
    const result = await doctorProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'uninstall') {
    const root = resolve(required(args, 'project'));
    const result = await uninstallProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok && result.reason !== 'not-installed') process.exitCode = 1;
    return;
  }
  process.stdout.write('活点地图 v2\n  livedot.mjs install --project <path> --app <app.html>\n  livedot.mjs serve --project <path> --app <app.html>\n  livedot.mjs mcp --project <path> --agent codex|claude|kimi\n  livedot.mjs hook --event session-start|user-prompt|stop --project <path>\n  livedot.mjs doctor --project <path>\n  livedot.mjs uninstall --project <path>\n');
}

void main().catch(async (error) => {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'hook' || parsed.command === 'mcp') {
    const project = resolve(typeof parsed.args.project === 'string' && parsed.args.project.trim() ? parsed.args.project : process.cwd());
    await recordAgentHealth(project, `agent:${String(parsed.args.agent || 'generic')}`, `${parsed.command === 'hook' ? `hook:${String(parsed.args.event || 'unknown')}` : 'mcp:process'}`, 'error', error).catch(() => undefined);
  }
  // 进程级故障同时落运行日志：桥/Agent 静默退出时仍留有痕迹。
  await createLogger({ source: parsed.command === 'serve' ? 'bridge' : 'agent' }).error('process.error', { command: parsed.command, error });
  console.error(error instanceof Error ? error.message : error); process.exitCode = 1;
});
