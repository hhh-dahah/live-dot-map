import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Hook 注入卫生：平时 0 打扰，有变化只推一行，不推 Agent 自己的写入。
// livedot.mjs 的 runHook 与 agent-kit 旧 hook 共用这里的规则。

export const HOOK_LINE_MAX_BYTES = 160;
const MAX_LISTED_IDS = 3;
const ELLIPSIS = '…';

export function truncateUtf8(text, maxBytes = HOOK_LINE_MAX_BYTES) {
  const value = String(text ?? '');
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const budget = maxBytes - Buffer.byteLength(ELLIPSIS, 'utf8');
  let output = '';
  let used = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8');
    if (used + size > budget) break;
    output += char;
    used += size;
  }
  return `${output}${ELLIPSIS}`;
}

export function safeAgentName(agent) {
  const cleaned = String(agent ?? '').replace(/^agent:/, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 64);
  return cleaned || 'generic';
}

export function agentReadPath(root, agent) {
  return join(root, '.live-dot-map', '.bridge', 'agent-read', `${safeAgentName(agent)}.json`);
}

function legacyReadPath(root) {
  return join(root, '.live-dot-map', 'agent-read.json');
}

async function readTimestamp(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const value = typeof parsed?.updatedAt === 'string' ? Date.parse(parsed.updatedAt) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 读取该 Agent 的已读水位。没有自己的水位文件时，用旧的项目级 agent-read.json
 * 作为初始水位（升级迁移，避免第一次全量刷屏）；两者都没有就从 now 开始。
 * `initialized` 为 false 表示调用方应落盘一次初始水位。
 */
export async function readAgentWatermark(root, agent, now = Date.now()) {
  const own = await readTimestamp(agentReadPath(root, agent));
  if (own !== null) return { since: own, initialized: true };
  const legacy = await readTimestamp(legacyReadPath(root));
  return { since: legacy ?? now, initialized: false };
}

export async function writeAgentWatermark(root, agent, timestamp) {
  const path = agentReadPath(root, agent);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, updatedAt: new Date(timestamp).toISOString() })}\n`, 'utf8');
  await rename(temporary, path);
}

function byLabel(updatedBy) {
  const value = typeof updatedBy === 'string' && updatedBy.trim() ? updatedBy.trim() : '?';
  return value.replace(/^agent:/, '');
}

function isPendingHumanAnn(item) {
  return item?.source === 'human' && ['new', 'delivered'].includes(String(item?.attention));
}

/** 水位之后、且不是 actor 自己写入的对象变化。人类新标注最前，其次人类其他改动。 */
export function collectChanges(document, since, actor) {
  const humanAnns = [];
  const human = [];
  const others = [];
  for (const collection of ['nodes', 'edges', 'anns', 'routes']) {
    const items = Array.isArray(document?.[collection]) ? document[collection] : [];
    for (const item of items) {
      if (!item || item.updatedBy === actor) continue;
      const updated = Date.parse(String(item.updatedAt));
      if (!Number.isFinite(updated) || updated <= since) continue;
      // 被其他 Agent 交付过的人类标注 updatedBy 已变成该 Agent，但对读者仍是人类待办。
      if (collection === 'anns' && isPendingHumanAnn(item)) {
        humanAnns.push({ id: String(item.id), by: 'human' });
        continue;
      }
      const entry = { id: String(item.id), by: byLabel(item.updatedBy) };
      (entry.by === 'human' ? human : others).push(entry);
    }
  }
  return [...humanAnns, ...human, ...others];
}

/** 合并刚交付的人类标注与变化列表，去重且交付项在前。 */
export function mergeNotices(deliveredIds, changes) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...deliveredIds.map((id) => ({ id: String(id), by: 'human' })), ...changes]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

function fitLine(build, count) {
  for (let shown = Math.min(MAX_LISTED_IDS, count); shown >= 0; shown -= 1) {
    const line = build(shown);
    if (Buffer.byteLength(line, 'utf8') <= HOOK_LINE_MAX_BYTES) return line;
  }
  return truncateUtf8(build(0));
}

/** 例：[活点地图] 3处新变化：n40(human)、n12(codex)等；用 livedot look 查看 */
export function formatChangeLine(entries) {
  const list = entries.filter(Boolean);
  if (!list.length) return '';
  return fitLine((shown) => {
    const ids = list.slice(0, shown).map((entry) => `${entry.id}(${entry.by})`).join('、');
    const more = shown < list.length ? '等' : '';
    const body = ids ? `：${ids}${more}` : '';
    return `[活点地图] ${list.length}处新变化${body}；用 livedot look 查看`;
  }, list.length);
}

/** 例：[活点地图] 2 条人类标注待确认：a1、a2 */
export function formatPendingLine(ids) {
  const list = ids.map(String).filter(Boolean);
  if (!list.length) return '';
  return fitLine((shown) => {
    const shownIds = list.slice(0, shown).join('、');
    const more = shown < list.length ? '等' : '';
    return `[活点地图] ${list.length} 条人类标注待确认${shownIds ? `：${shownIds}${more}` : ''}`;
  }, list.length);
}
