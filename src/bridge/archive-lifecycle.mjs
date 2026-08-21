import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  rename,
  rm,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { BridgeError } from './errors.mjs';
import { ensureDirectory, exists, withFileLock } from './fs-utils.mjs';
import { ProjectStore } from './project-store.mjs';

/** 自动清理的保留期。恰好 30 天即符合条件。 */
export const PURGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const PURGE_COLLECTIONS = new Set(['nodes', 'routes', 'edges', 'anns']);
const ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

function error(code, message, status = 409, details) {
  return new BridgeError(code, message, { status, details });
}

function asDate(value, label) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw error('PURGE_TIME_INVALID', `${label} 无效`, 400);
    return value;
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw error('PURGE_TIME_INVALID', `${label} 无效`, 400);
  return result;
}

function isValidArchivedAt(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
}

/**
 * 判断一个对象是否到了自动 purge 的时间。
 * 没有 archivedAt 或时间格式损坏时永远不会被自动清理。
 */
export function isPurgeEligible(item, { now = new Date(), retentionMs = PURGE_RETENTION_MS } = {}) {
  if (!item || typeof item !== 'object' || item.archived !== true || !isValidArchivedAt(item.archivedAt)) return false;
  const current = asDate(now, '当前时间').getTime();
  const archived = new Date(item.archivedAt).getTime();
  return archived <= current && current - archived >= Number(retentionMs);
}

function safeObjectId(value) {
  const id = String(value ?? '');
  if (!ID.test(id)) throw error('PURGE_ID_INVALID', '待清除对象 ID 无效', 400, { id });
  return id;
}

function clone(value) {
  return structuredClone(value);
}

function collectionItems(document, collection) {
  return Array.isArray(document?.[collection]) ? document[collection] : [];
}

/**
 * 只在生命周期服务内部使用的物理 purge reducer。
 *
 * 该 reducer 不进入 shared 命令协议，也不会被 Agent 工具暴露。它被
 * ProjectStore 的 envelope 写入路径调用，因此 purge 仍然拥有 WAL、原子
 * map 替换、校验与故障恢复能力。
 */
function applyPhysicalPurge(document, { collection, id }, now) {
  const next = clone(document);
  const target = collectionItems(next, collection).find((item) => String(item?.id) === id);
  if (!target) throw error('PURGE_NOT_FOUND', `${collection}/${id} 不存在`, 404);
  if (target.archived !== true) throw error('PURGE_NOT_ARCHIVED', '只有已归档对象才能永久清除', 409);

  const removedNodes = new Set(collection === 'nodes' ? [id] : []);
  const removedRoutes = new Set(collection === 'routes' ? [id] : []);
  const removedEdges = new Set(collection === 'edges' ? [id] : []);

  // 路线被永久清除后，路线下的节点仍可作为独立节点保留；清掉路线引用，
  // 否则 schema 校验会留下悬空 route。路线本身、路线边和路线标注都会删掉。
  if (collection === 'routes') {
    for (const edge of collectionItems(next, 'edges')) {
      if (String(edge?.route ?? '') === id) removedEdges.add(String(edge.id));
    }
  }

  for (const edge of collectionItems(next, 'edges')) {
    if (removedNodes.has(String(edge?.from)) || removedNodes.has(String(edge?.to))) {
      removedEdges.add(String(edge.id));
    }
  }

  next[collection] = collectionItems(next, collection).filter((item) => String(item?.id) !== id);

  if (removedNodes.size) {
    next.edges = collectionItems(next, 'edges').filter((edge) => !removedEdges.has(String(edge.id)));
    for (const route of collectionItems(next, 'routes')) {
      if (removedNodes.has(String(route.currentNodeId))) route.currentNodeId = null;
    }
  } else if (removedRoutes.size) {
    next.edges = collectionItems(next, 'edges').filter((edge) => !removedEdges.has(String(edge.id)));
    for (const node of collectionItems(next, 'nodes')) {
      if (removedRoutes.has(String(node.route))) node.route = null;
    }
  }

  const shouldRemoveAnnotation = (annotation) => {
    if (annotation?.archived === true) {
      // 归档标注仍是地图对象的一部分；只有它指向本次被删对象或级联边时才级联删除。
      // 其它归档标注保留，便于后续人工恢复/审计。
    }
    const targetValue = annotation?.target;
    if (targetValue && typeof targetValue === 'object') {
      if (targetValue.kind === 'node' && removedNodes.has(String(targetValue.id))) return true;
      if (targetValue.kind === 'edge' && removedEdges.has(String(targetValue.id))) return true;
      if (targetValue.kind === 'route' && removedRoutes.has(String(targetValue.id))) return true;
    }
    return removedRoutes.has(String(annotation?.route ?? ''));
  };
  next.anns = collectionItems(next, 'anns').filter((annotation) => !shouldRemoveAnnotation(annotation));

  next.revision = Number.isSafeInteger(next.revision) ? next.revision + 1 : 1;
  next.lastEventId = Number.isSafeInteger(next.lastEventId) ? next.lastEventId + 1 : next.revision;
  next.updatedAt = now;
  return next;
}

function packagePath(mapRoot, collection, id) {
  return join(mapRoot, collection, id);
}

function purgePackageOwners(document, collection, id) {
  // BundleStore 的 route owner 实际承载 edge 的 Markdown：
  // routes/<edgeId>/index.md。地图里的 routes scheme 本身没有默认资料包，
  // 因此不能把 routes/<schemeId> 当成 scheme 的资料包误移走。
  const owners = collection === 'nodes'
    ? [{ collection: 'nodes', id }]
    : collection === 'edges'
      ? [{ collection: 'routes', id }]
      : [];
  const nodeIds = new Set(collection === 'nodes' ? [id] : []);
  const routeIds = new Set(collection === 'routes' ? [id] : []);
  for (const edge of collectionItems(document, 'edges')) {
    if ((collection === 'edges' && String(edge?.id) === id)
      || routeIds.has(String(edge?.route ?? ''))
      || nodeIds.has(String(edge?.from))
      || nodeIds.has(String(edge?.to))) {
      // Edge Markdown uses the routes/ owner namespace for historical and
      // final bundle paths, so its physical package is routes/<edgeId>.
      const owner = { collection: 'routes', id: String(edge.id) };
      if (!owners.some((item) => item.collection === owner.collection && item.id === owner.id)) owners.push(owner);
    }
  }
  return owners;
}

async function assertPackagePath(path) {
  const metadata = await lstat(path).catch((cause) => {
    if (cause?.code === 'ENOENT') return null;
    throw cause;
  });
  if (metadata?.isSymbolicLink()) throw error('PURGE_SYMLINK_FORBIDDEN', '归档资料包不能通过符号链接清除', 403, { path });
  return metadata;
}

function recycleFunction(recycleBin) {
  if (typeof recycleBin === 'function') return recycleBin;
  if (typeof recycleBin?.recycle === 'function') return recycleBin.recycle.bind(recycleBin);
  return null;
}

/**
 * 归档对象的恢复与永久清除生命周期。
 *
 * purge 接受地图四类对象。Agent 不会拿到本服务的工具入口；系统保留期
 * 任务或已确认的人类操作才可调用。资料包先同盘移动到 staging，再提交
 * ProjectStore 物理 reducer，最后一次性移交给回收站。
 */
export class ArchiveLifecycle {
  constructor(options = {}) {
    if (!options.store) throw error('PURGE_STORE_REQUIRED', '归档生命周期需要 ProjectStore', 500);
    this.store = options.store;
    this.projectRoot = resolve(options.projectRoot ?? this.store.projectRoot);
    this.mapRoot = resolve(options.mapRoot ?? this.store.dataDirectory);
    this.shared = options.shared ?? this.store.shared;
    this.clock = options.clock ?? (() => new Date());
    this.retentionMs = Number(options.retentionMs ?? PURGE_RETENTION_MS);
    this.recycleBin = options.recycleBin;
    this.faultInjector = options.faultInjector ?? (() => {});
    this.stagingRoot = join(this.mapRoot, '.bridge', 'purge-staging');
    this.lockPath = join(this.mapRoot, '.bridge', 'purge.lock');
  }

  eligible(item, options = {}) {
    return isPurgeEligible(item, { retentionMs: this.retentionMs, ...options });
  }

  async listEligible({ collection, now = this.clock() } = {}) {
    const snapshot = await this.store.snapshot();
    const collections = collection === undefined ? ['routes', 'nodes', 'edges', 'anns'] : [collection];
    for (const name of collections) if (!PURGE_COLLECTIONS.has(name)) throw error('PURGE_COLLECTION_UNSUPPORTED', '只能清理路线、节点、方案或标注', 400, { collection: name });
    return collections.flatMap((name) => collectionItems(snapshot.document, name)
      .filter((item) => this.eligible(item, { now }))
      .map((item) => ({ collection: name, id: String(item.id), archivedAt: item.archivedAt })));
  }

  async #openPurgeStore() {
    const base = this.shared;
    const physicalShared = {
      ...base,
      applyEnvelope(document, envelope, options = {}) {
        if (envelope?.actor !== 'system:purge') throw error('PURGE_ACTOR_INVALID', '物理清除只能由系统生命周期服务执行', 403);
        const command = envelope?.commands?.[0];
        if (!command || command.op !== 'purge' || envelope.commands.length !== 1) throw error('PURGE_COMMAND_INVALID', '物理清除命令无效', 400);
        return applyPhysicalPurge(document, command, options.now ?? new Date().toISOString());
      },
    };
    return ProjectStore.open({
      projectRoot: this.projectRoot,
      dataDirectory: this.store.dataDirectory,
      mapName: this.store.mapName,
      mapDir: this.store.mapDir,
      shared: physicalShared,
      clock: this.clock,
      snapshotEvery: this.store.snapshotEvery,
      pollIntervalMs: 0,
      faultInjector: this.faultInjector,
    });
  }

  async #moveToStaging(collections, txnRoot) {
    await ensureDirectory(txnRoot);
    const moved = [];
    try {
      for (const { collection, id } of collections) {
        const source = packagePath(this.mapRoot, collection, id);
        const metadata = await assertPackagePath(source);
        if (!metadata) continue;
        const target = packagePath(txnRoot, collection, id);
        await assertPackagePath(target);
        if (await exists(target)) throw error('PURGE_STAGING_CONFLICT', '清除暂存目录已有同名资料包', 409, { collection, id });
        await ensureDirectory(join(txnRoot, collection));
        await rename(source, target);
        moved.push({ collection, id, source, target });
      }
      return moved;
    } catch (cause) {
      await this.#restorePackages(moved).catch(() => undefined);
      throw cause;
    }
  }

  async #restorePackages(moved) {
    for (const item of [...moved].reverse()) {
      const sourceExists = await exists(item.source);
      const stagedExists = await exists(item.target);
      if (!stagedExists) {
        if (sourceExists) continue;
        throw error('PURGE_PACKAGE_ROLLBACK_FAILED', '资料包已不在暂存目录，无法恢复', 500, item);
      }
      if (sourceExists) throw error('PURGE_PACKAGE_ROLLBACK_CONFLICT', '资料包恢复目标已被占用，拒绝覆盖', 409, item);
      await ensureDirectory(join(this.mapRoot, item.collection));
      await rename(item.target, item.source);
    }
  }

  async #rollback(snapshotName, moved, mapAttempted) {
    let mapError;
    if (mapAttempted) {
      try {
        await this.store.recover({ source: 'snapshot', name: snapshotName });
      } catch (cause) {
        mapError = cause;
      }
    }
    let packageError;
    try {
      await this.#restorePackages(moved);
    } catch (cause) {
      packageError = cause;
    }
    if (mapError || packageError) {
      throw error('PURGE_ROLLBACK_FAILED', '永久清除失败，自动恢复未完全完成，需要人工检查恢复点和暂存目录', 500, {
        mapError: mapError?.code ?? mapError?.message,
        packageError: packageError?.code ?? packageError?.message,
      });
    }
  }

  async purge(options = {}) {
    const collection = String(options.collection ?? '');
    if (!PURGE_COLLECTIONS.has(collection)) throw error('PURGE_COLLECTION_UNSUPPORTED', '只能清理路线、节点、方案或标注', 400, { collection });
    const id = safeObjectId(options.id);
    const actor = String(options.actor ?? 'system:purge');
    const humanConfirmed = actor === 'human' && (options.confirmed === true || options.confirm === true);
    const systemActor = actor === 'system:purge' || actor === 'system:retention' || actor === 'system';
    if (!humanConfirmed && !systemActor) throw error('PURGE_HUMAN_CONFIRMATION_REQUIRED', '永久清除需要人类二次确认或系统保留期任务', 403);

    const recycle = recycleFunction(this.recycleBin);
    if (!recycle) throw error('RECYCLE_BIN_UNAVAILABLE', '系统回收站不可用，已拒绝永久清除', 503);

    return withFileLock(this.lockPath, async () => {
      const now = asDate(options.now ?? this.clock(), '当前时间');
      const before = await this.store.snapshot();
      const target = collectionItems(before.document, collection).find((item) => String(item?.id) === id);
      if (!target) throw error('PURGE_NOT_FOUND', `${collection}/${id} 不存在`, 404);
      if (target.archived !== true) throw error('PURGE_NOT_ARCHIVED', '只有已归档对象才能永久清除', 409);
      if (!humanConfirmed && !this.eligible(target, { now })) {
        throw error('PURGE_NOT_ELIGIBLE', '对象尚未归档满 30 天，且没有 archivedAt 的旧归档永不自动清理', 409, { collection, id, archivedAt: target.archivedAt });
      }

      const snapshot = await this.store.createSnapshot();
      const snapshotName = String(snapshot.path).split(/[\\/]/).pop();
      const transactionId = `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
      const txnRoot = join(this.stagingRoot, transactionId);
      const packageOwners = purgePackageOwners(before.document, collection, id);
      let moved = [];
      let mapAttempted = false;
      let committedRevision = before.revision;
      try {
        moved = await this.#moveToStaging(packageOwners, txnRoot);
        await this.faultInjector('afterPurgeStaging', { collection, id, txnRoot, moved });

        mapAttempted = true;
        const purgeStore = await this.#openPurgeStore();
        try {
          const committed = await purgeStore.execute({
            projectId: String(before.document.mapId),
            baseRevision: before.revision,
            commandId: String(options.commandId ?? `purge-${randomUUID()}`),
            actor: 'system:purge',
            sessionId: 'archive-lifecycle',
            commands: [{ op: 'purge', collection, id }],
          });
          committedRevision = committed.revision;
        } finally {
          await purgeStore.close().catch(() => undefined);
        }
        await this.faultInjector('afterPurgeMapCommit', { collection, id, txnRoot, moved });

        const recycled = await recycle(txnRoot, { collection, id, transactionId });
        if (recycled === false) throw error('RECYCLE_BIN_FAILED', '系统回收站拒绝接收资料包', 503, { transactionId });
        return {
          purged: true,
          collection,
          id,
          // 回收站接管 staging 后不再执行任何可能失败的磁盘读取；否则 helper
          // 已成功但响应构造失败时，生命周期服务将无法从已移动的 staging 回滚。
          revision: committedRevision,
          snapshot: snapshotName,
          transactionId,
          recycled: true,
        };
      } catch (cause) {
        await this.#rollback(snapshotName, moved, mapAttempted).catch((rollbackError) => {
          throw rollbackError;
        });
        await rm(txnRoot, { recursive: true, force: true }).catch(() => undefined);
        if (cause instanceof BridgeError && cause.code.startsWith('PURGE_')) throw cause;
        if (cause?.code === 'RECYCLE_BIN_FAILED') throw cause;
        throw new BridgeError('PURGE_FAILED', '永久清除失败，已恢复归档对象和资料包', { status: 500, cause });
      }
    }).catch((cause) => {
      if (cause?.code === 'LOCK_TIMEOUT') throw error('PURGE_BUSY', '永久清除正在进行，请稍后重试', 409);
      throw cause;
    });
  }
}

export function createArchiveLifecycle(options) {
  return new ArchiveLifecycle(options);
}
