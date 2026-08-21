import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { BundleStore } from './bundle-store.mjs';
import { BridgeError } from './errors.mjs';
import { withFileLock } from './fs-utils.mjs';
import {
  createMap,
  ensureMapsLayout,
  isSafeMapId,
  listMaps,
  mapDirectory,
  mapRelativeDirectory,
  resolveActiveMap,
  writeActiveMap,
} from './maps.mjs';
import { ProjectStore } from './project-store.mjs';

/**
 * 项目内地图生命周期的唯一协调器。
 * 显式 mapKey 请求可并行复用 Store；stdio 省略 mapKey 时每次重读 active-map，
 * 指针变化即释放旧的隐式 Store，避免长驻 Agent 继续写旧图。
 */
export class MapManager {
  constructor(options = {}) {
    if (!options.projectRoot) throw new BridgeError('PROJECT_ROOT_REQUIRED', 'MapManager 需要项目根目录', { status: 400 });
    if (!options.shared) throw new BridgeError('SHARED_ADAPTER_REQUIRED', 'MapManager 需要 shared adapter', { status: 500 });
    this.projectRoot = resolve(options.projectRoot);
    this.shared = options.shared;
    this.clock = options.clock ?? (() => new Date());
    this.snapshotEvery = options.snapshotEvery;
    this.pollIntervalMs = options.pollIntervalMs ?? 0;
    this.faultInjector = options.faultInjector;
    this.onEvent = options.onEvent ?? (() => {});
    this.onActiveMapChanged = options.onActiveMapChanged ?? (() => {});
    this.stores = new Map();
    this.bundles = new Map();
    this.lastImplicitKey = null;
    this.lockPath = join(this.projectRoot, '.live-dot-map', '.bridge', 'map-manager.lock');
  }

  static async open(options) {
    const manager = new MapManager(options);
    await manager.initialize();
    return manager;
  }

  async initialize() {
    await withFileLock(this.lockPath, () => ensureMapsLayout(this.projectRoot));
    return this;
  }

  async #assertMapExists(mapKey) {
    if (!isSafeMapId(mapKey)) throw new BridgeError('INVALID_MAP_KEY', 'mapKey 无效', { status: 400 });
    const listed = await listMaps(this.projectRoot);
    if (!listed.maps.some((map) => map.id === mapKey)) {
      throw new BridgeError('MAP_NOT_FOUND', `地图不存在：${mapKey}`, { status: 404 });
    }
  }

  async #openStore(mapKey, mapName) {
    let store = this.stores.get(mapKey);
    if (!store) {
      store = await ProjectStore.open({
        projectRoot: this.projectRoot,
        dataDirectory: mapDirectory(this.projectRoot, mapKey),
        mapName,
        mapDir: mapRelativeDirectory(mapKey),
        shared: this.shared,
        snapshotEvery: this.snapshotEvery,
        pollIntervalMs: this.pollIntervalMs,
        clock: this.clock,
        faultInjector: this.faultInjector,
        onEvent: (event) => this.onEvent({ ...event, mapKey }),
      });
      this.stores.set(mapKey, store);
    }
    return store;
  }

  async resolve(options = {}) {
    const explicit = typeof options.mapKey === 'string' && options.mapKey.length > 0;
    const mapKey = explicit ? options.mapKey : await resolveActiveMap(this.projectRoot);
    await this.#assertMapExists(mapKey);
    if (!explicit && this.lastImplicitKey && this.lastImplicitKey !== mapKey) {
      const stale = this.stores.get(this.lastImplicitKey);
      await stale?.close().catch(() => undefined);
      this.stores.delete(this.lastImplicitKey);
      this.bundles.delete(this.lastImplicitKey);
    }
    if (!explicit) this.lastImplicitKey = mapKey;
    const store = await this.#openStore(mapKey);
    const snapshot = await store.snapshot();
    let bundleStore = this.bundles.get(mapKey);
    if (!bundleStore) {
      bundleStore = await BundleStore.open({ projectRoot: this.projectRoot, mapKey, clock: this.clock });
      this.bundles.set(mapKey, bundleStore);
    }
    return {
      projectRoot: this.projectRoot,
      mapKey,
      documentId: String(snapshot.document.mapId),
      store,
      bundleStore,
      snapshot,
    };
  }

  list() {
    return listMaps(this.projectRoot);
  }

  async create(name = '') {
    return withFileLock(this.lockPath, async () => {
      const created = await createMap(this.projectRoot, name, { now: this.clock });
      try {
        const store = await this.#openStore(created.id, created.name);
        const snapshot = await store.snapshot();
        const bundleStore = await BundleStore.open({ projectRoot: this.projectRoot, mapKey: created.id, clock: this.clock });
        this.bundles.set(created.id, bundleStore);
        return { createdMap: created.id, activeMap: await resolveActiveMap(this.projectRoot), documentId: String(snapshot.document.mapId), ...snapshot };
      } catch (error) {
        // 已占位目录保留为可诊断失败证据；active-map 从未提前切换。
        throw new BridgeError('MAP_CREATE_FAILED', '地图初始化失败，当前地图未切换', { status: 500, cause: error, details: { mapKey: created.id } });
      }
    }).catch((error) => {
      if (error?.code === 'LOCK_TIMEOUT') throw new BridgeError('MAP_MANAGER_BUSY', '地图管理操作繁忙，请重试', { status: 409 });
      throw error;
    });
  }

  async switch(mapKey) {
    return withFileLock(this.lockPath, async () => {
      const context = await this.resolve({ mapKey });
      // 只有目标图已经完整打开并通过校验后才提交 pointer。
      await writeActiveMap(this.projectRoot, mapKey);
      this.onActiveMapChanged({ type: 'active-map-changed', mapKey, documentId: context.documentId });
      return { activeMap: mapKey, documentId: context.documentId, ...context.snapshot };
    }).catch((error) => {
      if (error?.code === 'LOCK_TIMEOUT') throw new BridgeError('MAP_MANAGER_BUSY', '地图管理操作繁忙，请重试', { status: 409 });
      throw error;
    });
  }

  async rename(mapKey, name, actor = 'human') {
    const context = await this.resolve({ mapKey });
    const displayName = String(name ?? '').trim().slice(0, 80);
    if (!displayName) throw new BridgeError('MAP_NAME_REQUIRED', '地图名称不能为空', { status: 400 });
    return context.store.execute({
      projectId: context.documentId,
      baseRevision: context.snapshot.revision,
      commandId: `map-rename-${randomUUID()}`,
      actor,
      sessionId: `map-manager-${randomUUID()}`,
      commands: [{ op: 'set_meta', patch: { name: displayName } }],
    });
  }

  async close() {
    await Promise.all([...this.stores.values()].map((store) => store.close().catch(() => undefined)));
    this.stores.clear();
    this.bundles.clear();
    this.lastImplicitKey = null;
  }
}
