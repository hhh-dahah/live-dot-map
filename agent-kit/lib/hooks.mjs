import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { commandId, LocalBridgeClient, projectIdForRoot, BridgeClientError } from './bridge-client.mjs';

export const HOOK_NAMES = Object.freeze(['session-start', 'user-prompt-submit', 'stop']);

export const INITIALIZATION_REQUEST = '请初始化我的活点地图：先使用 live-dot-map Skill 和 map_get_context；只有用户明确授权时，才按 AGENTS.md 路由读取 goal.md、PRD、README、计划和最新执行记录。只保留一个总目标、3–7 个关键阶段和当前待判断路线，不按文件/目录/函数或聊天轮次建节点；通过本地桥写入并保留来源、理由、createdBy 和层级，不覆盖已有地图。';

function firstEnv(env, names, fallback = '') {
  for (const name of names) if (typeof env?.[name] === 'string' && env[name].trim()) return env[name].trim();
  return fallback;
}

export function agentNameFromEnv(env = process.env, fallback = 'codex') {
  const raw = firstEnv(env, ['LIVEDOT_AGENT', 'LIVE_DOT_AGENT', 'AGENT_NAME'], fallback).toLowerCase();
  if (raw.includes('claude')) return 'claude';
  if (raw.includes('kimi')) return 'kimi';
  if (raw.includes('codebuddy') || raw.includes('workbuddy')) return 'codebuddy';
  return 'codex';
}

export function createClientFromEnv(env = process.env, overrides = {}) {
  const projectRoot = firstEnv(env, ['LIVEDOT_PROJECT_ROOT', 'PROJECT_ROOT'], process.cwd());
  const bridgeUrl = firstEnv(env, ['LIVEDOT_BRIDGE_URL', 'LIVE_DOT_BRIDGE_URL'], `http://127.0.0.1:${firstEnv(env, ['LIVEDOT_BRIDGE_PORT', 'LIVE_DOT_BRIDGE_PORT'], '0')}`);
  const agent = agentNameFromEnv(env);
  const actor = firstEnv(env, ['LIVEDOT_ACTOR', 'LIVE_DOT_ACTOR'], `agent:${agent}`);
  const sessionId = firstEnv(env, ['LIVEDOT_SESSION_ID', 'LIVE_DOT_SESSION_ID', 'SESSION_ID'], randomUUID());
  const projectId = firstEnv(env, ['LIVEDOT_PROJECT_ID', 'LIVE_DOT_PROJECT_ID'], projectIdForRoot(projectRoot));
  return new LocalBridgeClient({
    baseUrl: bridgeUrl,
    token: firstEnv(env, ['LIVEDOT_BRIDGE_TOKEN', 'LIVE_DOT_BRIDGE_TOKEN'], ''),
    projectId,
    sessionId,
    actor,
    ...overrides,
  });
}

function updatesFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['updates', 'annotations', 'humanUpdates', 'items']) if (Array.isArray(value[key])) return value[key];
  return [];
}

function pendingUpdates(value) {
  return updatesFrom(value).filter((item) => (item?.source === undefined || item?.source === 'human') && ['new', 'delivered'].includes(item?.attention));
}

export function contextText(context, updates = []) {
  const ids = updates.map((item) => String(item.id)).filter(Boolean);
  const lines = ['[活点地图] SessionStart 上下文（来源：本地桥）'];
  if (context === undefined || context === null) {
    lines.push('当前地图上下文为空；不会自动扫描项目。若用户明确授权初始化，请发送：');
    lines.push(INITIALIZATION_REQUEST);
  } else if (typeof context === 'string') {
    lines.push(context);
  } else {
    const summary = context.summary || context.progressSummary || context.globalSummary;
    if (typeof summary === 'string' && summary.trim()) lines.push(summary.trim());
    lines.push(JSON.stringify(context, null, 2));
  }
  if (ids.length) {
    lines.push('');
    lines.push(`人类标注待确认（必须在首次摘要中逐字引用 ID）：${ids.join('、')}`);
    for (const item of updates) {
      const target = item?.target?.id ? ` → ${item.target.id}` : '';
      lines.push(`- ${item.id}${target}: ${String(item.text || '').trim()}`);
    }
    lines.push('摘要完成后调用 map_ack_human_updates；服务端会拒绝缺少任一 ID 的摘要。');
  } else {
    lines.push('当前没有待确认的人类新标注。');
  }
  return lines.join('\n');
}

function failureText(stage, error, { allowStop = false } = {}) {
  const code = error?.code || 'HOOK_FAILED';
  const reason = error?.message || '未知错误';
  const tail = allowStop ? '本次已允许结束，但画布应显示红色“本次协作未闭环”。' : '请先修复本地桥连接或冲突后重试。';
  return `[活点地图] ${stage} 未完成（${code}）：${reason}\n补救：${tail}`;
}

async function deliver(client, updates) {
  const ids = updates.map((item) => String(item.id)).filter(Boolean);
  if (!ids.length) return { delivered: [], result: null };
  const snapshot = await client.snapshot();
  const result = await client.mapApplyCommands({
    commands: [{ op: 'deliver_annotations', ids, deliveryId: client.sessionId }],
    baseRevision: snapshot.revision,
    commandId: commandId('deliver'),
    actor: client.actor,
    sessionId: client.sessionId,
    projectId: client.projectId,
  });
  return { delivered: ids, result };
}

// ---- 增量变更通知（2026-08-15 原则：无事不打扰，有事必回应） ----
// 已读水位 .live-dot-map/agent-read.json：只报告水位之后的地图变化；
// 无变化时完全静默，不做全量状态汇报。

async function collectIncrementalChanges(root, now) {
  // 多地图布局：事实源是 active-map 指针指向的 maps/<id>/map.json；老项目回退单图路径。
  let mapPath = join(root, '.live-dot-map', 'map.json');
  try {
    const pointer = (await readFile(join(root, '.live-dot-map', 'active-map'), 'utf8')).trim();
    if (/^[a-z0-9][a-z0-9-_]{0,63}$/.test(pointer)) {
      const candidate = join(root, '.live-dot-map', 'maps', pointer, 'map.json');
      await readFile(candidate, 'utf8');
      mapPath = candidate;
    }
  } catch { /* 无指针或目标缺失：保持老路径 */ }
  const readPath = join(root, '.live-dot-map', 'agent-read.json');
  let watermark = 0;
  try {
    const parsed = JSON.parse(await readFile(readPath, 'utf8'));
    if (typeof parsed?.updatedAt === 'string') watermark = Date.parse(parsed.updatedAt);
  } catch { /* 首次运行 */ }
  const since = watermark || now.getTime();
  let map = {};
  try { map = JSON.parse(await readFile(mapPath, 'utf8')); } catch { return { changes: [], watermark, next: now.getTime(), mapMissing: true }; }
  const changes = [];
  const collections = [['nodes', '节点'], ['edges', '方案'], ['anns', '标注'], ['routes', '路线']];
  for (const [collection, label] of collections) {
    for (const item of Array.isArray(map[collection]) ? map[collection] : []) {
      const updated = Date.parse(String(item?.updatedAt));
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
  return { changes, watermark, next: now.getTime(), mapMissing: false };
}

async function writeWatermark(root, timestamp) {
  const readPath = join(root, '.live-dot-map', 'agent-read.json');
  await mkdir(dirname(readPath), { recursive: true });
  await writeFile(readPath, `${JSON.stringify({ version: 1, updatedAt: new Date(timestamp).toISOString() }, null, 2)}\n`, 'utf8');
}

export async function runSessionStart({ client, env = process.env, write = () => {}, now = new Date(), projectRoot } = {}) {
  const bridge = client || createClientFromEnv(env);
  try {
    await bridge.health();
    const root = resolveProjectRoot(projectRoot, bridge, env);
    const { changes, next, mapMissing } = await collectIncrementalChanges(root, now);
    // 保留标注交付协议（new → delivered）；"已读"语义由水位承担。
    let deliveredIds = [];
    try {
      const listed = await bridge.mapListHumanUpdates({ includeAcknowledged: false });
      const pending = pendingUpdates(listed);
      if (pending.length) {
        const delivered = await deliver(bridge, pending.filter((item) => item.attention === 'new'));
        deliveredIds = delivered.delivered;
      }
    } catch { /* 桥不可用时只报增量，不阻断 */ }
    if (!changes.length && !deliveredIds.length) {
      // 无事不打扰：无变化时零输出。
      write('');
      return { ok: true, output: '', sessionId: bridge.sessionId, deliveredIds, at: now.toISOString(), changes: [], mapMissing };
    }
    await writeWatermark(root, next);
    const newCount = changes.filter((item) => item.label === '标注' && item.attention === 'new').length;
    const lines = changes.slice(0, 20).map((item) => `${item.label} ${item.id}${item.name ? `「${item.name}」` : ''}${item.status ? `(${item.status})` : ''}`);
    const output = [
      `[活点地图] 自上次以来有 ${changes.length} 处更新（${newCount} 条新标注优先）：`,
      ...lines,
      changes.length > 20 ? `…共 ${changes.length} 处` : '',
      '详细请读 .live-dot-map/active-map 指向的当前地图 map.json。',
    ].filter(Boolean).join('\n');
    write(output);
    return { ok: true, output, sessionId: bridge.sessionId, deliveredIds, at: now.toISOString(), changes };
  } catch (error) {
    const output = failureText('SessionStart', error);
    write(output);
    return { ok: false, output, sessionId: bridge.sessionId, error };
  }
}

function resolveProjectRoot(projectRoot, bridge, env) {
  if (projectRoot) return projectRoot;
  const fromEnv = firstEnv(env, ['LIVEDOT_PROJECT_ROOT', 'PROJECT_ROOT'], '');
  if (fromEnv) return fromEnv;
  if (bridge?.projectRoot) return bridge.projectRoot;
  return process.cwd();
}

async function readPrompt(input = process.stdin) {
  if (!input || input.isTTY) return '';
  let value = '';
  for await (const chunk of input) value += chunk;
  return value.trim();
}

export async function runUserPromptSubmit({ client, env = process.env, prompt, input = process.stdin, write = () => {} } = {}) {
  const bridge = client || createClientFromEnv(env);
  try {
    const query = typeof prompt === 'string' ? prompt.trim() : await readPrompt(input);
    await bridge.health();
    const context = await bridge.mapGetContext({ query, sessionId: bridge.sessionId });
    const output = `[活点地图] 本轮检索上下文\n${typeof context === 'string' ? context : JSON.stringify(context ?? {}, null, 2)}`;
    write(output);
    return { ok: true, output, query };
  } catch (error) {
    const output = failureText('UserPromptSubmit', error);
    write(output);
    return { ok: false, output, error };
  }
}

export async function runStop({ client, env = process.env, write = () => {}, attempt = Number(env.LIVEDOT_STOP_ATTEMPT || 1) || 1 } = {}) {
  const bridge = client || createClientFromEnv(env);
  try {
    await bridge.health();
    let snapshot = {};
    try { snapshot = await bridge.snapshot(); } catch { /* validation below remains the authoritative gate */ }
    const listed = await bridge.mapListHumanUpdates({ includeAcknowledged: false });
    const pending = pendingUpdates(listed);
    let validation;
    try {
      validation = await bridge.mapValidate({});
    } catch (error) {
      // Validation is part of the stop gate; preserve the failure below.
      validation = { ok: false, error: error?.code || error?.message };
    }
    const attemptIssues = Array.isArray(validation?.attemptIssues) ? validation.attemptIssues : [];
    const validationFailed = validation && (validation.ok === false || validation.valid === false || validation.error);
    const stateIssues = [];
    for (const key of ['conflicts', 'uncommitted', 'dirty', 'pendingWrites']) {
      const value = snapshot?.[key] ?? validation?.[key];
      if (value === true || (Array.isArray(value) && value.length)) stateIssues.push(key);
    }
    if (attemptIssues.length) stateIssues.push('attemptEvidence');
    if (!pending.length && !validationFailed && !stateIssues.length) {
      const output = '[活点地图] Stop 闭环检查通过：没有未确认人类标注，地图校验通过。';
      write(output);
      return { ok: true, allowStop: true, output };
    }
    const issues = [];
    if (pending.length) issues.push(`未确认人类标注：${pending.map((item) => item.id).join('、')}`);
    if (validationFailed) issues.push('地图校验或本地桥状态未通过');
    if (attemptIssues.length) issues.push(`大尝试证据未闭环：${attemptIssues.map((item) => `${item.edgeId}（${item.missing.join('、')}）`).join('；')}`);
    if (stateIssues.length) issues.push(`存在未提交或冲突状态：${stateIssues.join('、')}`);
    const allowStop = attempt >= 2;
    const error = new BridgeClientError('COLLABORATION_NOT_CLOSED', issues.join('；'), { status: 409, details: { pendingIds: pending.map((item) => item.id), validation } });
    const output = failureText('Stop', error, { allowStop });
    if (allowStop && typeof bridge.mapApplyCommands === 'function') {
      try {
        await bridge.mapApplyCommands({
          commands: [{ op: 'set_ui', patch: { collaboration: { status: 'incomplete', reason: issues.join('；'), at: new Date().toISOString() } } }],
          baseRevision: Number.isInteger(snapshot?.revision) ? snapshot.revision : 0,
          commandId: commandId('stop'),
          actor: bridge.actor,
          sessionId: bridge.sessionId,
          projectId: bridge.projectId,
        });
      } catch { /* allowStop remains fail-open, while the message stays red */ }
    }
    write(output);
    return { ok: false, allowStop, output, issues, pendingIds: pending.map((item) => String(item.id)), validation, stateIssues };
  } catch (error) {
    const allowStop = attempt >= 2;
    const output = failureText('Stop', error, { allowStop });
    write(output);
    return { ok: false, allowStop, output, error };
  }
}

export async function runHook(name, options = {}) {
  if (name === 'session-start') return runSessionStart(options);
  if (name === 'user-prompt-submit') return runUserPromptSubmit(options);
  if (name === 'stop') return runStop(options);
  throw new BridgeClientError('UNKNOWN_HOOK', `未知 hook: ${name}`, { status: 400 });
}

export async function runHookCli(name, options = {}) {
  const result = await runHook(name, options);
  if (options.write === undefined && result.output) process.stdout.write(`${result.output}\n`);
  // Hooks are fail-open for all three supported Agents: a failed hook must
  // never turn into a false acknowledgement or a green UI state.
  return result;
}
