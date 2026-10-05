import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commandId, LocalBridgeClient, projectIdForRoot, BridgeClientError } from './bridge-client.mjs';
import {
  collectChanges,
  formatChangeLine,
  formatPendingLine,
  mergeNotices,
  readAgentWatermark,
  truncateUtf8,
  writeAgentWatermark,
} from './hook-notice.mjs';

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
  if (raw.includes('antigravity') || raw.includes('agy')) return 'antigravity';
  if (raw.includes('qoder')) return 'qoder';
  if (raw.includes('zcode') || raw.includes('glm')) return 'zcode';
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

/** 单行提示（≤160 字节）：只列待确认人类标注 ID，不再全量注入地图上下文。 */
export function contextText(_context, updates = []) {
  return formatChangeLine(updates.map((item) => ({ id: String(item?.id ?? ''), by: 'human' })).filter((entry) => entry.id));
}

function failureText(stage, error) {
  const code = error?.code || 'HOOK_FAILED';
  const reason = String(error?.message || '未知错误').replace(/\s+/g, ' ');
  return truncateUtf8(`[活点地图] ${stage} 未完成（${code}）：${reason}`);
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

async function readActiveMap(root) {
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
  try { return JSON.parse(await readFile(mapPath, 'utf8')); } catch { return null; }
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

/**
 * SessionStart / UserPromptSubmit 共用：按 Agent 分开的已读水位，跳过自己的写入，
 * 有变化或新交付人类标注时只输出一行，否则零输出。
 */
async function notifyChanges(bridge, { env, write, now, projectRoot }) {
  await bridge.health();
  const root = resolveProjectRoot(projectRoot, bridge, env);
  const actor = bridge.actor;
  const { since, initialized } = await readAgentWatermark(root, actor, now.getTime());
  const map = await readActiveMap(root);
  const changes = map ? collectChanges(map, since, actor) : [];
  let deliveredIds = [];
  try {
    const pending = pendingUpdates(await bridge.mapListHumanUpdates({ includeAcknowledged: false }));
    const fresh = pending.filter((item) => item.attention === 'new');
    if (fresh.length) deliveredIds = (await deliver(bridge, fresh)).delivered;
  } catch { /* 桥不可用时只报增量，不阻断 */ }
  const notices = mergeNotices(deliveredIds, changes);
  if (notices.length || !initialized) await writeAgentWatermark(root, actor, now.getTime());
  const output = formatChangeLine(notices);
  write(output);
  return { ok: true, output, sessionId: bridge.sessionId, deliveredIds, at: now.toISOString(), changes: notices, mapMissing: !map };
}

export async function runSessionStart({ client, env = process.env, write = () => {}, now = new Date(), projectRoot } = {}) {
  const bridge = client || createClientFromEnv(env);
  try {
    return await notifyChanges(bridge, { env, write, now, projectRoot });
  } catch (error) {
    const output = failureText('SessionStart', error);
    write(output);
    return { ok: false, output, sessionId: bridge.sessionId, error };
  }
}

export async function runUserPromptSubmit({ client, env = process.env, prompt, input, write = () => {}, now = new Date(), projectRoot } = {}) {
  const bridge = client || createClientFromEnv(env);
  try {
    if (input && !input.isTTY && typeof prompt !== 'string') {
      await readPrompt(input);
    }
    return await notifyChanges(bridge, { env, write, now, projectRoot });
  } catch (error) {
    const output = failureText('UserPromptSubmit', error);
    write(output);
    return { ok: false, output, error };
  }
}

/**
 * Stop 永不拦截（allowStop 恒为 true）。只有存在待确认人类标注时输出一行提示；
 * 画布协作状态只在真正变化时写入，避免每次 Stop 都产生一次地图修订。
 */
export async function runStop({ client, env = process.env, write = () => {} } = {}) {
  const bridge = client || createClientFromEnv(env);
  try {
    await bridge.health();
    const pending = pendingUpdates(await bridge.mapListHumanUpdates({ includeAcknowledged: false }));
    const pendingIds = pending.map((item) => String(item.id)).filter(Boolean);
    let snapshot = {};
    try { snapshot = await bridge.snapshot(); } catch { /* 读不到快照就不改画布状态 */ }
    const desiredStatus = pendingIds.length ? 'incomplete' : 'closed';
    const currentStatus = snapshot?.document?.ui?.collaboration?.status ?? 'closed';
    if (currentStatus !== desiredStatus && Number.isInteger(snapshot?.revision) && typeof bridge.mapApplyCommands === 'function') {
      try {
        await bridge.mapApplyCommands({
          commands: [{ op: 'set_ui', patch: { collaboration: {
            status: desiredStatus, at: new Date().toISOString(),
            ...(pendingIds.length ? { reason: `${pendingIds.length} 条人类标注未完成摘要引用与确认` } : {}),
          } } }],
          baseRevision: snapshot.revision,
          commandId: commandId('stop'),
          actor: bridge.actor,
          sessionId: bridge.sessionId,
          projectId: bridge.projectId,
        });
      } catch { /* 画布标记是尽力而为，不影响结束 */ }
    }
    const output = formatPendingLine(pendingIds);
    write(output);
    return { ok: true, allowStop: true, output, pendingIds };
  } catch (error) {
    const output = failureText('Stop', error);
    write(output);
    return { ok: false, allowStop: true, output, error };
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
