import { randomUUID } from 'node:crypto';
import { commandId, LocalBridgeClient, projectIdForRoot, BridgeClientError } from './bridge-client.mjs';

export const HOOK_NAMES = Object.freeze(['session-start', 'user-prompt-submit', 'stop']);

export const INITIALIZATION_REQUEST = '请初始化我的活点地图：先读取 AGENTS.md 路由，再按顺序读取 goal.md、PRD、README、计划和最新执行记录；只保留一个总目标、3–7 个关键阶段和当前待判断路线，不要按文件/目录/函数或聊天轮次建节点。通过本地桥创建地图，为每个节点写入来源路径、生成理由、createdBy 和层级；不确定内容标为“待确认”，不要覆盖已有地图。';

function firstEnv(env, names, fallback = '') {
  for (const name of names) if (typeof env?.[name] === 'string' && env[name].trim()) return env[name].trim();
  return fallback;
}

export function agentNameFromEnv(env = process.env, fallback = 'codex') {
  const raw = firstEnv(env, ['LIVEDOT_AGENT', 'LIVE_DOT_AGENT', 'AGENT_NAME'], fallback).toLowerCase();
  if (raw.includes('claude')) return 'claude';
  if (raw.includes('kimi')) return 'kimi';
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

export async function runSessionStart({ client, env = process.env, write = () => {}, now = new Date() } = {}) {
  const bridge = client || createClientFromEnv(env);
  try {
    await bridge.health();
    const listed = await bridge.mapListHumanUpdates({ includeAcknowledged: false });
    const pending = pendingUpdates(listed);
    // Delivery is a durable command, but acknowledgement is deliberately not
    // performed here: the Agent must first quote the IDs in its own summary.
    if (pending.length) await deliver(bridge, pending.filter((item) => item.attention === 'new'));
    const context = await bridge.mapGetContext({ query: '', sessionId: bridge.sessionId });
    const after = pendingUpdates(await bridge.mapListHumanUpdates({ includeAcknowledged: false }));
    const output = contextText(context, after.length ? after : pending);
    write(output);
    return { ok: true, output, sessionId: bridge.sessionId, deliveredIds: pending.filter((item) => item.attention === 'new').map((item) => String(item.id)), at: now.toISOString() };
  } catch (error) {
    const output = failureText('SessionStart', error);
    write(output);
    return { ok: false, output, sessionId: bridge.sessionId, error };
  }
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
    const validationFailed = validation && (validation.ok === false || validation.valid === false || validation.error);
    const stateIssues = [];
    for (const key of ['conflicts', 'uncommitted', 'dirty', 'pendingWrites']) {
      const value = snapshot?.[key] ?? validation?.[key];
      if (value === true || (Array.isArray(value) && value.length)) stateIssues.push(key);
    }
    if (!pending.length && !validationFailed && !stateIssues.length) {
      const output = '[活点地图] Stop 闭环检查通过：没有未确认人类标注，地图校验通过。';
      write(output);
      return { ok: true, allowStop: true, output };
    }
    const issues = [];
    if (pending.length) issues.push(`未确认人类标注：${pending.map((item) => item.id).join('、')}`);
    if (validationFailed) issues.push('地图校验或本地桥状态未通过');
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
