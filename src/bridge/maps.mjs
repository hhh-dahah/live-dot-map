import { copyFile, cp, lstat, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BridgeError } from './errors.mjs';
import {
  atomicWriteFile,
  ensureDirectory,
  exists,
  readJson,
  writeJsonAtomic,
} from './fs-utils.mjs';

const DATA_DIRECTORY = '.live-dot-map';
const MAPS_DIRECTORY = 'maps';
const ACTIVE_MAP_FILE = 'active-map';
const LEGACY_NODES_PREFIX = '.live-dot-map/nodes/';
const LEGACY_ROUTES_PREFIX = '.live-dot-map/routes/';
const MAP_ID = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/** 地图 id 直接做目录名，必须是不带分隔符的安全字符集。 */
export function isSafeMapId(id) {
  return typeof id === 'string' && MAP_ID.test(id);
}

export function mapsRoot(projectRoot) {
  return join(projectRoot, DATA_DIRECTORY, MAPS_DIRECTORY);
}

export function mapDirectory(projectRoot, mapId) {
  if (!isSafeMapId(mapId)) {
    throw new BridgeError('INVALID_MAP_ID', '地图 ID 无效', { status: 400, details: { mapId } });
  }
  return join(mapsRoot(projectRoot), mapId);
}

/** 项目相对的地图目录（写进 map.json 的 mapDir 字段，Markdown 分片路径以其为前缀）。 */
export function mapRelativeDirectory(mapId) {
  return `${DATA_DIRECTORY}/${MAPS_DIRECTORY}/${mapId}`;
}

/** 读取当前地图指针；缺失或内容非法返回 null（调用方自行回退 default）。 */
export async function readActiveMap(projectRoot) {
  try {
    const value = (await readFile(join(projectRoot, DATA_DIRECTORY, ACTIVE_MAP_FILE), 'utf8')).trim();
    return isSafeMapId(value) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** 读取当前地图指针，缺指针时回退 default。 */
export async function resolveActiveMap(projectRoot) {
  return (await readActiveMap(projectRoot)) ?? 'default';
}

export async function writeActiveMap(projectRoot, mapId) {
  if (!isSafeMapId(mapId)) {
    throw new BridgeError('INVALID_MAP_ID', '地图 ID 无效', { status: 400, details: { mapId } });
  }
  await atomicWriteFile(join(projectRoot, DATA_DIRECTORY, ACTIVE_MAP_FILE), `${mapId}\n`);
}

/** 把显示名转成安全目录 id；中文等无法转换时回退 map-<时间戳>。 */
export function slugifyMapName(name, now = () => new Date()) {
  const base = String(name ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64);
  const candidate = base.replace(/^[^a-z0-9]+/, '');
  if (candidate && MAP_ID.test(candidate)) return candidate;
  return `map-${now().getTime().toString(36)}`;
}

/** 列出 maps/ 下的地图 id（只收安全命名的目录）。 */
export async function listMapIds(projectRoot) {
  const entries = await readdir(mapsRoot(projectRoot), { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isDirectory() && isSafeMapId(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** 列出地图清单（id/名称/更新时间/是否当前），供弹层与 API 使用。 */
export async function listMaps(projectRoot) {
  const active = await resolveActiveMap(projectRoot);
  const ids = await listMapIds(projectRoot);
  const maps = [];
  for (const id of ids) {
    const document = await readJson(join(mapsRoot(projectRoot), id, 'map.json')).catch(() => null);
    maps.push({
      id,
      name: typeof document?.name === 'string' && document.name ? document.name : id,
      updatedAt: typeof document?.updatedAt === 'string' ? document.updatedAt : null,
      active: id === active,
    });
  }
  return { activeMap: active, maps };
}

/** 新建空地图目录并返回 id；同名单词自动加 -2/-3 后缀。 */
export async function createMap(projectRoot, name, { now = () => new Date() } = {}) {
  const displayName = String(name ?? '').trim().slice(0, 80) || '未命名地图';
  const base = slugifyMapName(displayName, now);
  const taken = new Set(await listMapIds(projectRoot));
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  await ensureDirectory(mapDirectory(projectRoot, id));
  return { id, name: displayName };
}

/** 迁移时把节点/方案的 Markdown 分片路径改写为地图目录前缀，并记录 mapDir。 */
export function rewriteMarkdownPaths(document, mapDir) {
  for (const list of [document?.nodes, document?.edges]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item.md !== 'string') continue;
      if (item.md.startsWith(LEGACY_NODES_PREFIX)) item.md = `${mapDir}/nodes/${item.md.slice(LEGACY_NODES_PREFIX.length)}`;
      else if (item.md.startsWith(LEGACY_ROUTES_PREFIX)) item.md = `${mapDir}/routes/${item.md.slice(LEGACY_ROUTES_PREFIX.length)}`;
    }
  }
  if (typeof document.mapDir !== 'string') document.mapDir = mapDir;
  return document;
}

async function rejectSymlink(path) {
  const metadata = await lstat(path).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (metadata?.isSymbolicLink()) {
    throw new BridgeError('SYMLINK_ESCAPE', '本地桥拒绝通过符号链接迁移项目数据', { status: 403, details: { path } });
  }
}

/**
 * 老版单图布局（.live-dot-map/map.json + nodes/ + routes/ + .bridge/）迁移为
 * maps/default/。先整份备份到 .bridge/backups/pre-maps-migration-<时间>/，再逐项
 *  rename；任一步失败把已移动的项 rename 回去并删指针。
 * WAL 不随图迁移：迁移会改写 map.json 的 md 前缀，旧 WAL 的 checksum 与新文档
 * 对不上会被当成外部冲突回滚，因此旧 wal.ndjson 只留进备份作为历史证据。
 */
async function migrateLegacyLayout(projectRoot) {
  const dataDirectory = join(projectRoot, DATA_DIRECTORY);
  const target = mapDirectory(projectRoot, 'default');
  const mapDir = mapRelativeDirectory('default');
  for (const path of [
    join(dataDirectory, 'map.json'),
    join(dataDirectory, 'nodes'),
    join(dataDirectory, 'routes'),
    join(dataDirectory, '.bridge'),
  ]) await rejectSymlink(path);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = join(dataDirectory, '.bridge', 'backups', `pre-maps-migration-${stamp}`);
  await ensureDirectory(backupDirectory);
  await copyFile(join(dataDirectory, 'map.json'), join(backupDirectory, 'map.json'));
  for (const name of ['nodes', 'routes']) {
    const source = join(dataDirectory, name);
    if (await exists(source)) await cp(source, join(backupDirectory, name), { recursive: true });
  }
  const legacyWal = join(dataDirectory, '.bridge', 'wal.ndjson');
  if (await exists(legacyWal)) await copyFile(legacyWal, join(backupDirectory, 'wal.ndjson'));

  const moves = [
    [join(dataDirectory, 'map.json'), join(target, 'map.json')],
    [join(dataDirectory, 'nodes'), join(target, 'nodes')],
    [join(dataDirectory, 'routes'), join(target, 'routes')],
    [join(dataDirectory, '.bridge', 'snapshots'), join(target, '.bridge', 'snapshots')],
    [join(dataDirectory, '.bridge', 'backups'), join(target, '.bridge', 'backups')],
    [join(dataDirectory, '.bridge', 'quarantine'), join(target, '.bridge', 'quarantine')],
    [legacyWal, join(target, '.bridge', 'wal.ndjson.legacy-migrated')],
  ];
  const completed = [];
  try {
    await ensureDirectory(join(target, '.bridge'));
    for (const [source, destination] of moves) {
      if (!(await exists(source))) continue;
      await ensureDirectory(dirname(destination));
      await rename(source, destination);
      completed.push([destination, source]);
    }
    const document = await readJson(join(target, 'map.json'));
    rewriteMarkdownPaths(document, mapDir);
    await writeJsonAtomic(join(target, 'map.json'), document);
    await writeActiveMap(projectRoot, 'default');
  } catch (error) {
    for (const [destination, source] of completed.reverse()) {
      await rename(destination, source).catch(() => undefined);
    }
    await rm(join(dataDirectory, ACTIVE_MAP_FILE), { force: true }).catch(() => undefined);
    await rm(mapsRoot(projectRoot), { recursive: true, force: true }).catch(() => undefined);
    throw new BridgeError('MAPS_MIGRATION_FAILED', `多地图迁移失败，已回滚；完整备份在 ${backupDirectory}`, {
      status: 500,
      cause: error,
      details: { backupDirectory, causeMessage: String(error?.message || error) },
    });
  }
  return { backupDirectory };
}

/**
 * 幂等保证项目处于多地图布局：
 * - 已有 maps/ → 只补齐/修正 active-map 指针；
 * - 有老版 map.json → 迁移到 maps/default/；
 * - 全新项目 → 建空 maps/default/ 并写指针（空 map.json 由 ProjectStore 打开时创建）。
 */
export async function ensureMapsLayout(projectRoot) {
  const dataDirectory = join(projectRoot, DATA_DIRECTORY);
  await ensureDirectory(dataDirectory);
  const existing = await listMapIds(projectRoot);
  if (existing.length) {
    const active = await readActiveMap(projectRoot);
    if (!active || !existing.includes(active)) {
      const fallback = existing.includes('default') ? 'default' : existing[0];
      await writeActiveMap(projectRoot, fallback);
      return { migrated: false, activeMap: fallback };
    }
    return { migrated: false, activeMap: active };
  }
  if (await exists(join(dataDirectory, 'map.json'))) {
    await migrateLegacyLayout(projectRoot);
    return { migrated: true, activeMap: 'default' };
  }
  await ensureDirectory(mapDirectory(projectRoot, 'default'));
  await writeActiveMap(projectRoot, 'default');
  return { migrated: false, activeMap: 'default' };
}
