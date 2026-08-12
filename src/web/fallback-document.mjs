import {
  MAP_VERSION,
  migrateMapV1,
  validateMapDocument,
} from './shared.mjs';

const COLLECTIONS = ['routes', 'nodes', 'edges', 'anns'];
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const clone = (value) => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

function isoTime(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function samePayload(left, right) {
  if (!left || !right) return false;
  const strip = (value) => {
    const output = { ...value };
    delete output.createdAt;
    delete output.updatedAt;
    delete output.updatedBy;
    delete output.updatedRevision;
    return output;
  };
  return JSON.stringify(strip(left)) === JSON.stringify(strip(right));
}

/**
 * 为双击 app.html 的降级路径准备地图：v1 迁移为 v2，v2 校验后加载，
 * 未知未来版本只允许浏览并保留原始文档。
 */
export function prepareFallbackDocument(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('map.json 必须是对象');
  const source = clone(input);
  const version = Number(source.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`不支持的版本 ${String(source.version)}`);
  if (version === 1) {
    return {
      document: migrateMapV1(source, { now: options.now }),
      sourceVersion: 1,
      migrated: true,
      readOnly: false,
    };
  }
  if (version === MAP_VERSION) {
    const validation = validateMapDocument(source);
    if (!validation.ok) throw new Error(`v2 地图校验失败：${validation.errors.join('；')}`);
    return { document: source, sourceVersion: version, migrated: false, readOnly: false };
  }
  return { document: source, sourceVersion: version, migrated: false, readOnly: true };
}

/**
 * 把旧画布的内存快照合并回 v2 外壳。顶层和对象未知字段均保留；
 * 未知未来版本始终原样返回，防止旧画布伪装成可写客户端。
 */
export function composeFallbackDocument(sourceDocument, canvasSnapshot, options = {}) {
  if (!sourceDocument || typeof sourceDocument !== 'object') return clone(canvasSnapshot);
  const source = clone(sourceDocument);
  if (Number(source.version) !== MAP_VERSION) return source;
  const snapshot = canvasSnapshot && typeof canvasSnapshot === 'object' ? clone(canvasSnapshot) : {};
  const now = new Date(options.now ?? Date.now()).toISOString();
  const revision = Number.isInteger(source.revision) ? source.revision : 0;
  const nextRevision = options.commit ? revision + 1 : revision;
  const output = {
    ...source,
    name: String(snapshot.name ?? source.name ?? '未命名地图'),
    version: MAP_VERSION,
    revision: nextRevision,
    lastEventId: Number.isInteger(source.lastEventId) ? source.lastEventId : 0,
    createdAt: ISO_MS.test(String(source.createdAt ?? '')) ? source.createdAt : now,
    updatedAt: options.commit ? now : isoTime(snapshot.updatedAt, source.updatedAt ?? now),
    view: { ...(source.view ?? {}), ...(snapshot.view ?? {}) },
    ui: { ...(source.ui ?? {}), ...(snapshot.ui ?? {}) },
    counters: { ...(source.counters ?? {}), ...(snapshot.counters ?? {}) },
  };
  for (const collection of COLLECTIONS) {
    const originals = new Map((source[collection] ?? []).map((item) => [String(item?.id), item]));
    output[collection] = (Array.isArray(snapshot[collection]) ? snapshot[collection] : source[collection] ?? []).map((item) => {
      const original = originals.get(String(item?.id));
      const changed = !samePayload(item, original);
      const normalized = {
        ...(original ?? {}),
        ...item,
        createdAt: isoTime(item?.createdAt, isoTime(original?.createdAt, now)),
        updatedAt: changed ? now : isoTime(item?.updatedAt, isoTime(original?.updatedAt, now)),
        updatedBy: changed ? 'human' : String(item?.updatedBy ?? original?.updatedBy ?? 'human'),
        updatedRevision: changed ? nextRevision : Number.isInteger(item?.updatedRevision)
          ? item.updatedRevision
          : Number.isInteger(original?.updatedRevision) ? original.updatedRevision : nextRevision,
      };
      if (collection === 'anns') {
        normalized.source = 'human';
        normalized.priority = String(item?.priority ?? original?.priority ?? 'normal');
        normalized.attention = changed ? 'new' : String(item?.attention ?? original?.attention ?? 'new');
        normalized.acknowledgements = Array.isArray(item?.acknowledgements)
          ? clone(item.acknowledgements)
          : Array.isArray(original?.acknowledgements) ? clone(original.acknowledgements) : [];
      }
      return normalized;
    });
  }
  const validation = validateMapDocument(output);
  if (!validation.ok) throw new Error(`降级模式不能安全导出此地图：${validation.errors.join('；')}`);
  return output;
}

export function installFallbackDocumentApi(target = globalThis) {
  const api = { MAP_VERSION, prepareFallbackDocument, composeFallbackDocument };
  target.LiveDotFallback = api;
  return api;
}

if (typeof window !== 'undefined') installFallbackDocumentApi(window);
