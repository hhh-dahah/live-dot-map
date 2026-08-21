import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isSea } from 'node:sea';
import { createBridgeServer, createLogger, MapManager, noopLogger, TOOL_DEFINITIONS, ToolService } from '../bridge/index.mjs';
import { ProjectRegistry } from '../bridge/project-registry.mjs';
import { SessionStore } from '../bridge/session-store.mjs';
import {
  acquireSingletonLock,
  checkBridgeProcess,
  clearStaleSingletonLock,
  isProcessAlive,
  readBridgeState,
  readOrCreateControlToken,
  removeBridgeState,
  writeBridgeState,
} from '../bridge/runtime-state.mjs';
import { loadSharedAdapter } from '../bridge/shared-adapter.mjs';
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

async function openThroughRunningBridge(
  state: { pid: number; port: number },
  controlToken: string,
  projectRoot: string,
  projectHandle: string,
): Promise<Json> {
  const origin = `http://127.0.0.1:${state.port}`;
  const signal = AbortSignal.timeout(2_000);
  const status = await fetch(`${origin}/api/v1/control/status`, {
    headers: { 'X-LiveDot-Control': controlToken },
    signal,
  });
  if (!status.ok) throw new Error(`已记录的 Bridge 未通过身份验证（HTTP ${status.status}）`);
  const statusBody = await status.json() as Json;
  if (Number(statusBody.pid) !== state.pid) throw new Error('持久化端口上的 Bridge PID 与运行状态不一致');
  const opened = await fetch(`${origin}/api/v1/control/open-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LiveDot-Control': controlToken },
    body: JSON.stringify({ projectRoot, projectHandle }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await opened.json().catch(() => ({})) as Json;
  if (opened.ok && typeof body.bootstrapToken === 'string') {
    const url = `${origin}/app.html?token=${encodeURIComponent(body.bootstrapToken)}`;
    return { ok: true, reused: true, pid: state.pid, origin, projectHandle, url };
  }
  const detail = (body.error && typeof body.error === 'object' ? body.error : {}) as Json;
  const code = typeof detail.code === 'string' ? detail.code : '';
  const message = typeof detail.message === 'string' ? detail.message : '';
  // 把服务端真实错误码带进启动器弹窗，不再只有一句笼统的「打开画布失败」。
  throw Object.assign(
    new Error(`Bridge 无法打开项目（HTTP ${opened.status}${code ? ` ${code}` : ''}${message ? `：${message}` : ''}）`),
    { httpStatus: opened.status, errorCode: code },
  );
}

// 冲突/繁忙类错误（WAL 竞争、迁移写入中途）通常下一次调用即自愈，做有限重试；
// 其余错误（权限、布局过新等）重试无意义，直接抛给启动器显示真实原因。
const REUSABLE_RETRY_STATUS = new Set([409, 503]);

async function openThroughRunningBridgeWithRetry(
  state: { pid: number; port: number },
  controlToken: string,
  projectRoot: string,
  projectHandle: string,
): Promise<Json> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    try {
      return await openThroughRunningBridge(state, controlToken, projectRoot, projectHandle);
    } catch (error) {
      lastError = error;
      const status = (error as { httpStatus?: number })?.httpStatus;
      if (typeof status !== 'number' || !REUSABLE_RETRY_STATUS.has(status)) throw error;
    }
  }
  throw lastError;
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

type ProjectQualification = {
  ok: boolean;
  code?: 'PROJECT_NOT_FOUND' | 'PROJECT_NOT_INITIALIZED' | 'PROJECT_READONLY' | 'PROJECT_LAYOUT_INVALID';
  message?: string;
};

/**
 * MCP 和 hook 只能打开已经存在的项目。这个检查必须完全只读：不能调用
 * ensureMapsLayout、ProjectStore.open 或任何会补齐运行目录的函数。
 *
 * 空目录、Agent 在错误 cwd 启动、没有写权限的目录都走 fail-open；只有
 * 已经有明确地图标记的目录才交给 ProjectStore，这样损坏/未知版本仍会
 * 按真实项目错误上报，而不会被静默伪装成新项目。
 */
async function inspectProjectQualification(projectRoot: string): Promise<ProjectQualification> {
  const root = resolve(projectRoot);
  const rootMetadata = await lstat(root).catch(() => null);
  if (!rootMetadata || !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: '当前目录不存在或不是有效项目目录。' };
  }

  const dataDirectory = join(root, '.live-dot-map');
  const dataMetadata = await lstat(dataDirectory).catch(() => null);
  if (!dataMetadata) return { ok: false, code: 'PROJECT_NOT_INITIALIZED', message: '当前目录还没有活点地图项目。' };
  if (!dataMetadata.isDirectory() || dataMetadata.isSymbolicLink()) {
    return { ok: false, code: 'PROJECT_LAYOUT_INVALID', message: '活点地图数据目录不是可安全读取的目录。' };
  }

  const marker = async (path: string): Promise<boolean> => {
    const metadata = await lstat(path).catch(() => null);
    // 存在但为 symlink 的 map.json 仍属于一个需要报错的项目；交给
    // ProjectStore 的安全路径检查，不要把它误判成全新项目。
    return Boolean(metadata && (metadata.isFile() || metadata.isSymbolicLink()));
  };

  const legacy = await marker(join(dataDirectory, 'map.json'));
  const mapsPath = join(dataDirectory, 'maps');
  const mapsMetadata = await lstat(mapsPath).catch(() => null);
  let packageMap = false;
  if (mapsMetadata?.isDirectory() && !mapsMetadata.isSymbolicLink()) {
    const entries = await readdir(mapsPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (await marker(join(mapsPath, entry.name, 'map.json'))) { packageMap = true; break; }
    }
  }
  if (!legacy && !packageMap) {
    return { ok: false, code: 'PROJECT_NOT_INITIALIZED', message: '当前目录不是已初始化的活点地图项目。' };
  }

  // 不进行写探测（那本身会污染错误目录）。access(W_OK) 只读取 ACL；对
  // 已存在但只读的项目 fail-open，避免 ProjectStore 初始化创建 .bridge。
  const writableTarget = packageMap
    ? (await access(mapsPath, constants.W_OK).then(() => true).catch(() => false))
    : (await access(dataDirectory, constants.W_OK).then(() => true).catch(() => false));
  if (!writableTarget) return { ok: false, code: 'PROJECT_READONLY', message: '当前活点地图项目目录不可写。' };
  return { ok: true };
}

function unavailableToolResult(qualification: ProjectQualification): Json {
  const code = qualification.code ?? 'PROJECT_NOT_INITIALIZED';
  const message = qualification.message ?? '当前目录没有可用的活点地图项目。';
  return {
    isError: true,
    content: [{ type: 'text', text: `[活点地图] ${message}` }],
    structuredContent: { ok: false, error: { code, message } },
  };
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

const toolDefinitions = TOOL_DEFINITIONS;

async function runMcp(projectRoot: string, actor: string): Promise<void> {
  const root = resolve(projectRoot);
  const qualification = await inspectProjectQualification(root);
  // fail-open 进程不能创建日志目录、health 文件或地图目录。transport
  // 仍然保持可用，只有 tools/call 返回结构化 isError。
  const logger = qualification.ok ? createLogger({ source: 'agent' }) : noopLogger;
  let manager: MapManager | null = null;
  let tools: ToolService | null = null;
  if (qualification.ok) await logger.info('agent.mcp.start', { project: root, actor, pid: process.pid });
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
        if (!qualification.ok) {
          result = unavailableToolResult(qualification);
        } else {
          const params = request.params as Json;
          // 延迟打开 manager：initialize/tools/list 即使地图损坏也必须能返回，
          // 真实损坏会在 tools/call 处按 JSON-RPC error 上报。
          if (!manager) {
            const shared = await loadSharedAdapter();
            manager = await MapManager.open({ projectRoot: root, shared, pollIntervalMs: 0 });
            tools = new ToolService({ mapManager: manager, shared, actor, projectHandle: 'stdio' });
          }
          const value = await tools!.dispatch(String(params.name), (params.arguments as Json) ?? {});
          result = { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
        }
      } else throw Object.assign(new Error(`未知方法 ${String(request.method)}`), { code: -32601 });
      if (qualification.ok) await recordAgentHealth(root, actor, `mcp:${String(request.method === 'tools/call' ? (request.params as Json)?.name ?? 'call' : request.method)}`, 'ok');
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    } catch (error) {
      const value = error as Error & { code?: string | number; details?: unknown };
      if (qualification.ok) {
        await recordAgentHealth(root, actor, `mcp:${String((request.params as Json | undefined)?.name ?? request.method ?? 'unknown')}`, 'error', value);
        await logger.error('agent.mcp', { tool: String((request.params as Json | undefined)?.name ?? request.method ?? 'unknown'), error: value });
      }
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: typeof value.code === 'number' ? value.code : -32000, message: value.message, data: { code: value.code, details: value.details } } })}\n`);
    }
  }
  await manager?.close().catch(() => undefined);
}

async function runHook(kind: string, args: Args): Promise<void> {
  const root = resolve(required(args, 'project'));
  const actor = `agent:${String(args.agent || 'generic')}`;
  const sessionId = String(args.session || `session-${randomUUID()}`);
  const qualification = await inspectProjectQualification(root);
  // Hook 在未初始化/错误/只读目录中必须完全静默成功：不能打开 store，
  // 也不能落 health、日志或其他运行态文件。
  if (!qualification.ok) return;
  const logger = createLogger({ source: 'agent' });
  await logger.info('agent.hook.start', { event: kind, actor, project: root });
  const shared = await loadSharedAdapter();
  const manager = await MapManager.open({ projectRoot: root, shared, pollIntervalMs: 0 });
  const resolvedMap = await manager.resolve();
  const store = resolvedMap.store;
  const tools = new ToolService({ mapManager: manager, shared, actor, projectHandle: 'hook' });
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
    await manager.close();
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
    const context = await tools.dispatch('map_get_context', { query: prompt });
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: JSON.stringify(compactHookContext(context)) } })}\n`);
    await recordAgentHealth(root, actor, 'hook:user-prompt', 'ok');
    await manager.close();
    return;
  }
  if (kind === 'stop') {
    let hookInput: Json = {};
    if (!process.stdin.isTTY) {
      let raw = '';
      for await (const chunk of process.stdin) raw += chunk;
      try { hookInput = raw ? JSON.parse(raw) as Json : {}; } catch { hookInput = {}; }
    }
    const updates = await tools.dispatch('map_list_human_updates', {}) as Json;
    const validation = await tools.dispatch('map_validate', {}) as Json;
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
    await manager.close();
  }
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === 'serve') {
    const logger = createLogger({ source: 'bridge' });
    const projectRoot = resolve(required(args, 'project'));
    const runtimeStateDir = typeof args['runtime-state-dir'] === 'string' ? resolve(args['runtime-state-dir']) : undefined;
    const controlToken = await readOrCreateControlToken(runtimeStateDir);
    const registry = await ProjectRegistry.open({ runtimeStateDir });
    const sessionStore = await SessionStore.open({ runtimeStateDir });
    const registered = await registry.register(projectRoot);
    let state = await readBridgeState(runtimeStateDir);
    if (state) {
      try {
        const reused = await openThroughRunningBridgeWithRetry(state, controlToken, projectRoot, registered.projectHandle);
        process.stdout.write(`${JSON.stringify(reused)}\n`);
        await logger.flush();
        return;
      } catch (error) {
        // pid 可能被系统回收复用：只有确认活着的进程不是 Bridge（或进程已死）才清理，
        // 否则用户强杀 Bridge 后将永远无法从桌面图标恢复（打开画布失败）。
        // 探测结果不明（unknown）时保持保守，按“仍在运行”报错而不是冒险双开。
        const identity = isProcessAlive(state.pid) ? await checkBridgeProcess(state.pid) : 'other';
        if (identity !== 'other') {
          throw new Error(`现有 Bridge 进程仍在运行但无法安全复用：${error instanceof Error ? error.message : String(error)}`);
        }
        if (!(await clearStaleSingletonLock(runtimeStateDir, state.pid, { force: true }))) {
          throw new Error('Bridge 状态已失效，但单例锁不能安全回收');
        }
        await removeBridgeState(runtimeStateDir, state.pid);
      }
    }
    let releaseLock: (() => Promise<void>) | null = null;
    try {
      releaseLock = await acquireSingletonLock(runtimeStateDir);
    } catch (error) {
      // 并发首启时，另一个进程可能已取得锁但尚未写 bridge.json；短暂等待其就绪后复用。
      if ((error as { code?: string })?.code !== 'BRIDGE_START_IN_PROGRESS') throw error;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        state = await readBridgeState(runtimeStateDir);
        if (!state) continue;
        try {
          const reused = await openThroughRunningBridge(state, controlToken, projectRoot, registered.projectHandle);
          process.stdout.write(`${JSON.stringify(reused)}\n`);
          await logger.flush();
          return;
        } catch { /* 首个进程仍在启动 */ }
      }
      throw new Error('Bridge 正在启动，但在 2 秒内没有进入可复用状态');
    }
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
    let bridge: { origin: string; port: number; issueBootstrapTicket(root: string, projectHandle?: string): string; close(): Promise<void> };
    try {
      bridge = await (createBridgeServer as (options: Json) => Promise<{ origin: string; port: number; issueBootstrapTicket(root: string, projectHandle?: string): string; close(): Promise<void> }>)({
        allowedProjectRoots: [projectRoot],
        appHtml,
        staticAssets,
        logger,
        controlToken,
        projectRegistry: registry,
        sessionStore,
        listenPort: state?.port ?? 0,
      });
      state = await writeBridgeState(runtimeStateDir, { pid: process.pid, port: bridge.port });
    } catch (error) {
      await releaseLock?.();
      if ((error as { code?: string })?.code === 'EADDRINUSE' && state?.port) {
        throw new Error(`Bridge 固定端口 ${state.port} 被其他程序占用；为保护浏览器草稿，未切换到随机端口`);
      }
      throw error;
    }
    const bootstrapToken = bridge.issueBootstrapTicket(projectRoot, registered.projectHandle);
    const url = `${bridge.origin}/app.html?token=${encodeURIComponent(bootstrapToken)}`;
    await logger.info('bridge.start', { origin: bridge.origin, pid: process.pid });
    process.stdout.write(`${JSON.stringify({ ok: true, reused: false, pid: process.pid, origin: bridge.origin, projectHandle: registered.projectHandle, url })}\n`);
    const shutdown = async () => {
      await logger.info('bridge.stop', { pid: process.pid });
      await logger.flush();
      await bridge.close();
      await releaseLock?.();
      process.exit(0);
    };
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
