import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isSea } from 'node:sea';
import { createBridgeServer, ProjectStore } from '../bridge/index.mjs';
import { loadSharedAdapter } from '../bridge/shared-adapter.mjs';
import { autonomyDecision, retrieveContext, validateMapDocument } from '../shared/index.ts';
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

async function openStore(projectRoot: string): Promise<ProjectStore> {
  // MCP/hook 进程是短生命周期写入方；常驻桥负责跨进程轮询和画布 SSE 通知。
  return ProjectStore.open({ projectRoot: resolve(projectRoot), shared: await loadSharedAdapter(), pollIntervalMs: 0 });
}

function envelope(projectId: string, revision: number, actor: string, sessionId: string, commands: Json[]): Json {
  return { projectId, baseRevision: revision, commandId: `cmd-${randomUUID()}`, actor, sessionId, commands };
}

async function callTool(store: ProjectStore, root: string, tool: string, args: Json, defaultActor = 'agent:generic'): Promise<unknown> {
  const snapshot = await store.snapshot();
  const document = snapshot.document as Json;
  const actor = typeof args.actor === 'string' ? args.actor : defaultActor;
  const sessionId = typeof args.sessionId === 'string' ? args.sessionId : `session-${randomUUID()}`;
  if (tool === 'map_get_context') {
    return { revision: snapshot.revision, ...retrieveContext(document as never, String(args.query ?? ''), { markdown: await markdownDocuments(root) }) };
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
    const context = retrieveContext(document as never, String(args.query ?? ''), {
      currentNodeId: args.currentNodeId === null || args.currentNodeId === undefined ? null : String(args.currentNodeId),
      limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
      includeHistory: args.includeHistory === true,
      markdown: await markdownDocuments(root),
    });
    return { revision: snapshot.revision, ...context, autonomy: autonomyDecision(document as never, context.objects) };
  }
  if (tool === 'map_apply_commands') {
    const request = args.envelope && typeof args.envelope === 'object' ? args.envelope as Json : {
      ...envelope(String(document.mapId), snapshot.revision, actor, sessionId, Array.isArray(args.commands) ? args.commands as Json[] : []),
      baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : snapshot.revision,
      commandId: typeof args.commandId === 'string' ? args.commandId : `cmd-${randomUUID()}`,
    };
    return store.execute(request as never);
  }
  if (tool === 'map_validate') return validateMapDocument(args.document ?? document);
  if (tool === 'map_checkpoint') return store.createSnapshot();
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
].map(([name, description, properties]) => ({ name, description, inputSchema: { type: 'object', properties, additionalProperties: true } }));

async function runMcp(projectRoot: string, actor: string): Promise<void> {
  const root = resolve(projectRoot);
  const store = await openStore(root);
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
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    } catch (error) {
      const value = error as Error & { code?: string | number; details?: unknown };
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: typeof value.code === 'number' ? value.code : -32000, message: value.message, data: { code: value.code, details: value.details } } })}\n`);
    }
  }
}

async function runHook(kind: string, args: Args): Promise<void> {
  const root = resolve(required(args, 'project'));
  const actor = `agent:${String(args.agent || 'generic')}`;
  const sessionId = String(args.session || `session-${randomUUID()}`);
  const store = await openStore(root);
  const snapshot = await store.snapshot();
  const document = snapshot.document as Json;
  if (kind === 'session-start') {
    const anns = (document.anns as Json[]).filter((ann) => ann.source === 'human' && ['new', 'delivered'].includes(String(ann.attention)));
    if (anns.some((ann) => ann.attention === 'new')) {
      await store.execute(envelope(String(document.mapId), snapshot.revision, actor, sessionId, [{ op: 'deliver_annotations', ids: anns.filter((ann) => ann.attention === 'new').map((ann) => ann.id), deliveryId: sessionId }]) as never);
    }
    const context = retrieveContext(document as never, '', { markdown: await markdownDocuments(root) });
    const output = {
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [
        `活点地图 revision ${snapshot.revision}。首次摘要必须逐字引用以下人类标注 ID，之后调用 map_ack_human_updates：`,
        ...anns.map((ann) => `${ann.id}: ${ann.text}`),
        `候选：${context.objects.slice(0, 3).map((item) => `${item.id}(${item.reasons.join('、')})`).join('；') || '无'}`,
      ].join('\n') },
      deliveredIds: anns.map((ann) => ann.id),
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
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
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: JSON.stringify(context) } })}\n`);
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
    const incomplete = Array.isArray(updates.updates) && updates.updates.length > 0;
    const attempt = Number(args.attempt || process.env.LIVEDOT_STOP_ATTEMPT || (hookInput.stop_hook_active ? 2 : 1)) || 1;
    if (incomplete && attempt >= 2) {
      const current = await store.snapshot();
      await store.execute(envelope(String((current.document as Json).mapId), current.revision, actor, sessionId, [{
        op: 'set_ui',
        patch: { collaboration: { status: 'incomplete', agent: actor, sessionId, at: new Date().toISOString(), reason: '人类标注未完成摘要引用与确认' } },
      }]) as never);
    }
    process.stdout.write(`${JSON.stringify({
      decision: incomplete && attempt < 2 ? 'block' : 'allow',
      collaborationClosed: !incomplete,
      uiStatus: incomplete ? 'error' : 'saved',
      reason: incomplete
        ? (attempt < 2 ? '仍有人类标注未完成摘要引用与 ack；请先闭环地图。' : '第二次检查仍未闭环，允许结束但画布保持红色。')
        : '地图闭环完成。',
    })}\n`);
  }
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'serve') {
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
    const bridge = await (createBridgeServer as (options: Json) => Promise<{ origin: string; bootstrapToken: string; close(): Promise<void> }>)({ allowedProjectRoots: [projectRoot], appHtml, staticAssets });
    const url = `${bridge.origin}/app.html?token=${encodeURIComponent(bridge.bootstrapToken)}&project=${encodeURIComponent(projectRoot)}`;
    process.stdout.write(`${JSON.stringify({ ok: true, origin: bridge.origin, bootstrapToken: bridge.bootstrapToken, url })}\n`);
    const shutdown = async () => { await bridge.close(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    return;
  }
  if (command === 'mcp') return runMcp(required(args, 'project'), `agent:${String(args.agent || 'generic')}`);
  if (command === 'hook') return runHook(String(args.event || 'session-start'), args);
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

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
