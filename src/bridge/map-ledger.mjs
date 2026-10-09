import { copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BridgeError } from './errors.mjs';
import { exists, readJson, withFileLock, writeJsonAtomic } from './fs-utils.mjs';
import { listMapIds, mapsRoot } from './maps.mjs';

const LEDGER_VERSION = 1;

/**
 * 账本必须放在 .live-dot-map 之外：地图目录整体被删时，账本还能证明“这里原来有图”。
 * 测试沙箱只要隔离了 recent-projects 或 LIVEDOT_TEST_ROOT，账本就自动跟着进沙箱。
 */
export function defaultLedgerFile(env = process.env) {
  if (env.LIVEDOT_MAP_LEDGER_FILE) return resolve(env.LIVEDOT_MAP_LEDGER_FILE);
  if (env.LIVEDOT_RECENT_PROJECTS_FILE) return join(dirname(resolve(env.LIVEDOT_RECENT_PROJECTS_FILE)), 'known-maps.json');
  if (env.LIVEDOT_TEST_ROOT) return join(resolve(env.LIVEDOT_TEST_ROOT), 'known-maps.json');
  return join(homedir(), '.live-dot-map', 'known-maps.json');
}

function projectKey(projectRoot) {
  const absolute = resolve(projectRoot);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/** 只认 map.json 还在的地图；空目录（例如被删剩的壳）不算在。 */
async function inspectPresentMaps(projectRoot) {
  const present = new Map();
  for (const id of await listMapIds(projectRoot)) {
    const path = join(mapsRoot(projectRoot), id, 'map.json');
    if (!(await exists(path))) continue;
    const document = await readJson(path).catch(() => null);
    present.set(id, {
      name: typeof document?.name === 'string' && document.name ? document.name : id,
      nodes: Array.isArray(document?.nodes) ? document.nodes.length : 0,
      edges: Array.isArray(document?.edges) ? document.edges.length : 0,
      revision: Number.isSafeInteger(document?.revision) ? document.revision : 0,
    });
  }
  return present;
}

export function mapsMissingMessage(projectRoot, missing) {
  const names = missing.map((map) => `「${map.name || map.id}」${map.nodes ? `${map.nodes} 个节点` : ''}`).join('、');
  return [
    `活点地图发现地图不见了：这个项目以前有 ${missing.length} 张地图（${names}），现在 .live-dot-map\\maps 里找不到。`,
    '为了不让新建的空地图把它们盖掉，已停止打开。',
    `请先从备份（例如夸克网盘）把 .live-dot-map 文件夹恢复到 ${projectRoot}，再重新打开。`,
    `如果确认是故意删除的，运行：node "%USERPROFILE%\\.live-dot-map\\livedot.mjs" forget-maps --project "${projectRoot}"`,
  ].join('\n');
}

export class MapLedger {
  constructor({ file, clock } = {}) {
    this.explicitFile = file ? resolve(file) : null;
    this.clock = clock ?? (() => new Date());
  }

  get file() {
    return this.explicitFile ?? defaultLedgerFile();
  }

  async #read() {
    try {
      const parsed = await readJson(this.file);
      if (parsed && typeof parsed === 'object' && parsed.projects && typeof parsed.projects === 'object') return { ledger: parsed, corrupt: false };
      return { ledger: { version: LEDGER_VERSION, projects: {} }, corrupt: true };
    } catch (error) {
      if (error?.code === 'ENOENT') return { ledger: { version: LEDGER_VERSION, projects: {} }, corrupt: false };
      return { ledger: { version: LEDGER_VERSION, projects: {} }, corrupt: true };
    }
  }

  async #update(mutate) {
    const file = this.file;
    return withFileLock(`${file}.lock`, async () => {
      const { ledger, corrupt } = await this.#read();
      if (corrupt) {
        const stamp = this.clock().toISOString().replace(/[:.]/g, '-');
        await copyFile(file, `${file}.corrupt-${stamp}`).catch(() => undefined);
      }
      const result = await mutate(ledger);
      await writeJsonAtomic(file, ledger);
      return result;
    });
  }

  /** 账本里记过、但现在 map.json 已不在的地图。 */
  async findMissing(projectRoot) {
    const { ledger } = await this.#read();
    const entry = ledger.projects[projectKey(projectRoot)];
    if (!entry?.maps || typeof entry.maps !== 'object') return [];
    const known = Object.entries(entry.maps);
    if (!known.length) return [];
    const present = await inspectPresentMaps(projectRoot);
    return known
      .filter(([id]) => !present.has(id))
      .map(([id, info]) => ({ id, name: String(info?.name || id), nodes: Number(info?.nodes) || 0, lastSeenAt: info?.lastSeenAt ?? null }));
  }

  async assertPresent(projectRoot) {
    const missing = await this.findMissing(projectRoot);
    if (!missing.length) return;
    throw new BridgeError('MAPS_MISSING', mapsMissingMessage(projectRoot, missing), {
      status: 409,
      details: { projectRoot, missing, ledgerFile: this.file },
    });
  }

  /**
   * 记下当前在的地图。没内容的新图不入账（删了也不值得报警）；
   * 已入账的图即使被清空也继续跟踪，账本里“不见了”的图保持原样等待恢复或 forget。
   */
  async record(projectRoot) {
    const present = await inspectPresentMaps(projectRoot);
    const now = this.clock().toISOString();
    return this.#update((ledger) => {
      const key = projectKey(projectRoot);
      const entry = ledger.projects[key] ?? { root: resolve(projectRoot), maps: {} };
      entry.root = resolve(projectRoot);
      entry.maps ??= {};
      for (const [id, info] of present) {
        if (!entry.maps[id] && info.nodes + info.edges === 0) continue;
        entry.maps[id] = { ...info, lastSeenAt: now };
      }
      if (Object.keys(entry.maps).length) {
        entry.updatedAt = now;
        ledger.projects[key] = entry;
      }
      ledger.version = LEDGER_VERSION;
      return Object.keys(entry.maps);
    });
  }

  /**
   * 用户确认是故意删除后，把不见了的图（或指定 id）从账本移除。
   * @param {string} projectRoot
   * @param {string[] | null} [mapIds]
   */
  async forget(projectRoot, mapIds = null) {
    const missing = await this.findMissing(projectRoot);
    const targets = new Set(mapIds?.length ? mapIds : missing.map((map) => map.id));
    return this.#update((ledger) => {
      const key = projectKey(projectRoot);
      const entry = ledger.projects[key];
      const removed = [];
      if (entry?.maps) {
        for (const id of targets) {
          if (entry.maps[id]) {
            removed.push({ id, name: entry.maps[id].name ?? id });
            delete entry.maps[id];
          }
        }
        if (!Object.keys(entry.maps).length) delete ledger.projects[key];
      }
      return { removed, ledgerFile: this.file };
    });
  }
}
