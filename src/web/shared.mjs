/* 浏览器侧只做适配；数据 schema、命令 reducer 以 src/shared/index.mjs 为准。 */
import * as core from '../shared/index.mjs';

export const MAP_VERSION = core.MAP_VERSION;
export const COLLECTIONS = core.COLLECTIONS;
export const stableMarkdownPath = core.stableMarkdownPath;
export const validateMapDocument = core.validateMapDocument;
export const migrateMapV1 = core.migrateMapV1;
export const applyMapCommand = core.applyMapCommand;
export const applyCommandEnvelope = core.applyCommandEnvelope;
export const createEmptyMap = core.createEmptyMap;
export const retrieveContext = core.retrieveContext;

export const SYNC_MODES = Object.freeze({
  BRIDGE: 'bridge',
  FILESYSTEM: 'filesystem',
  DRAFT: 'draft',
  EXPORT: 'export',
});

export const SYNC_STATUS = Object.freeze({
  IDLE: 'idle',
  DRAFT: 'draft',
  DIRTY: 'dirty',
  SAVING: 'saving',
  SYNCED: 'synced',
  CONFLICT: 'conflict',
  ERROR: 'error',
  DEGRADED: 'degraded',
  CLOSED: 'closed',
});

const PATH_SEGMENT_RE = /[<>:"/\\|?*\u0000-\u001f]/;

/**
 * 只接受项目相对路径，兼容旧版 nodes/、routes/ 前缀。
 * 新对象的稳定路径应由 core.stableMarkdownPath(id) 生成；旧文件路径不强制重命名。
 */
export function normalizeMarkdownPath(value, options = {}) {
  const { collection, id, preferStable = false } = options;
  if (preferStable && (collection === 'nodes' || collection === 'edges') && typeof id === 'string') {
    try { return stableMarkdownPath(collection, id); } catch { /* 继续检查已有路径 */ }
  }
  if (value === null || value === undefined || value === '') {
    if ((collection === 'nodes' || collection === 'edges') && typeof id === 'string') return stableMarkdownPath(collection, id);
    return null;
  }
  if (typeof value !== 'string') throw new TypeError('Markdown 路径必须是字符串');
  let path = value.replace(/\\/g, '/');
  if (path.startsWith('./live-dot-map/')) path = `.live-dot-map/${path.slice('./live-dot-map/'.length)}`;
  else path = path.replace(/^\.\//, '');
  if (path.includes('\u0000')) throw new Error('Markdown 路径包含非法字符');
  if (!path || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    throw new Error('Markdown 路径必须位于项目目录内');
  }
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) throw new Error('Markdown 路径不能包含 . 或 ..');
  if (parts.some((part) => PATH_SEGMENT_RE.test(part))) throw new Error('Markdown 路径包含非法字符');
  if (path.startsWith('nodes/')) path = `.live-dot-map/${path}`;
  else if (path.startsWith('routes/')) path = `.live-dot-map/${path}`;
  else if (path.startsWith('live-dot-map/')) path = `.${path}`;
  else if (!path.startsWith('.live-dot-map/') && !path.startsWith('docs/')) {
    // 外部数据只允许显式的项目相对目录，不能借此逃逸到项目根外。
    path = `docs/${path}`;
  }
  return path;
}

export function canonicalizeMarkdownFields(document) {
  if (!document || typeof document !== 'object') return document;
  const clone = typeof structuredClone === 'function'
    ? structuredClone(document)
    : JSON.parse(JSON.stringify(document));
  for (const collection of ['nodes', 'edges']) {
    if (!Array.isArray(clone[collection])) continue;
    for (const item of clone[collection]) {
      if (!item || typeof item !== 'object') continue;
      try {
        item.md = normalizeMarkdownPath(item.md, { collection, id: item.id, preferStable: true });
      } catch {
        // 坏路径不应阻断导出；改为按 ID 生成受控路径。
        try { item.md = stableMarkdownPath(collection, String(item.id)); } catch { delete item.md; }
      }
    }
  }
  return clone;
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const sort = (input) => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) throw new TypeError('无法对循环数据计算摘要');
    seen.add(input);
    let output;
    if (Array.isArray(input)) output = input.map(sort);
    else output = Object.keys(input).sort().reduce((acc, key) => {
      acc[key] = sort(input[key]);
      return acc;
    }, {});
    seen.delete(input);
    return output;
  };
  return JSON.stringify(sort(value));
}

export function stableHash(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeLegacyMap(document) {
  if (!document || typeof document !== 'object') throw new TypeError('地图必须是对象');
  const canonical = canonicalizeMarkdownFields(document);
  if (canonical.version === MAP_VERSION) return canonical;
  if (canonical.version === 1) {
    try { return migrateMapV1(canonical); } catch { return canonical; }
  }
  return canonical;
}

export function validateForDraft(document) {
  const normalized = normalizeLegacyMap(document);
  const result = validateMapDocument(normalized);
  return { ...result, document: normalized };
}

export function createCommandEnvelope(options = {}) {
  const now = options.now ?? new Date().toISOString();
  const random = () => (globalThis.crypto?.randomUUID?.() ?? `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  return {
    projectId: String(options.projectId ?? 'local-project'),
    baseRevision: Number.isInteger(options.baseRevision) ? options.baseRevision : 0,
    commandId: String(options.commandId ?? random()),
    actor: options.actor ?? 'human',
    sessionId: String(options.sessionId ?? random()),
    commands: Array.isArray(options.commands) ? options.commands : [],
    issuedAt: now,
  };
}

export function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}
