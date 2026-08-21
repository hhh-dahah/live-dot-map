import { copyFile, cp, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BridgeError } from './errors.mjs';
import {
  atomicWriteFile,
  ensureDirectory,
  exists,
  readJson,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils.mjs';

const DATA_DIRECTORY = '.live-dot-map';
const MAPS_DIRECTORY = 'maps';
const ACTIVE_MAP_FILE = 'active-map';
const LEGACY_NODES_PREFIX = '.live-dot-map/nodes/';
const LEGACY_ROUTES_PREFIX = '.live-dot-map/routes/';
const MAP_ID = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const BUNDLE_OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const BUNDLE_LAYOUT_VERSION = 1;

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
  await ensureDirectory(mapsRoot(projectRoot));
  for (let suffix = 1; suffix < 100_000; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    try {
      // 非递归 mkdir 是跨进程原子占位；并发同名只能有一个调用成功。
      await mkdir(mapDirectory(projectRoot, id));
      return { id, name: displayName };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new BridgeError('MAP_ID_EXHAUSTED', '同名地图数量过多，无法分配安全 ID', { status: 409 });
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

function rewriteBundlePaths(document, mapDir) {
  let changed = false;
  for (const [list, kind] of [
    [document?.nodes, 'nodes'],
    [document?.edges, 'routes'],
    [document?.routes, 'routes'],
  ]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item.id !== 'string' || typeof item.md !== 'string') continue;
      const current = item.md.replace(/\\/g, '/');
      const finalPath = `${mapDir}/${kind}/${item.id}/index.md`;
      const ownedLegacyPaths = new Set([
        `.live-dot-map/${kind}/${item.id}.md`,
        `.live-dot-map/${kind}/${item.id}/index.md`,
        `${mapDir}/${kind}/${item.id}.md`,
        finalPath,
      ]);
      if (ownedLegacyPaths.has(current) && item.md !== finalPath) {
        item.md = finalPath;
        changed = true;
      }
    }
  }
  if (document.mapDir !== mapDir) {
    document.mapDir = mapDir;
    changed = true;
  }
  if (document.bundleLayoutVersion !== BUNDLE_LAYOUT_VERSION) {
    document.bundleLayoutVersion = BUNDLE_LAYOUT_VERSION;
    changed = true;
  }
  return changed;
}

/**
 * 资料包迁移绕过 WAL 直写 map.json，必须把 revision 推进一格：
 * 常驻 ProjectStore 只采纳 revision 更高的外部写入；同 revision 的直写会被
 * 视为“外部旧版本覆盖”，隔离后恢复 WAL 文档，元数据迁移被还原并形成
 * EXTERNAL_REVISION_CONFLICT 死循环（画布永远打不开）。
 */
function stampBundleMigrationRevision(document) {
  document.revision = (Number.isSafeInteger(document.revision) ? document.revision : 0) + 1;
}

/** 把地图内旧平铺 nodes|routes/<id>.md 一次性迁入对象资料包的 index.md。 */
export async function ensureBundleLayout(projectRoot, mapId) {
  const root = mapDirectory(projectRoot, mapId);
  const mapPath = join(root, 'map.json');
  if (!(await exists(mapPath))) return { migrated: false, mapId };
  // 与常驻 ProjectStore 用同一把写锁（.bridge/write.lock）：元数据迁移必须
  // 和 Store 的 snapshot/execute 串行，否则直写会被当成“外部旧版本覆盖”。
  // Store 繁忙时本次跳过迁移（下次打开再试），不让整个打开流程失败。
  const lockPath = join(root, '.bridge', 'write.lock');
  try {
    return await withFileLock(lockPath, () => ensureBundleLayoutLocked(projectRoot, mapId, root, mapPath));
  } catch (error) {
    if (error?.code === 'LOCK_TIMEOUT') return { migrated: false, mapId, deferred: true };
    throw error;
  }
}

async function ensureBundleLayoutLocked(projectRoot, mapId, root, mapPath) {
  let document;
  try {
    document = await readJson(mapPath);
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('CORRUPT_MAP', 'map.json 无法解析，资料包迁移未执行', {
      status: 409,
      cause: error,
      details: { mapId, causeMessage: String(error?.message || error) },
    });
  }
  if (Number(document.bundleLayoutVersion) > BUNDLE_LAYOUT_VERSION) {
    throw new BridgeError('FUTURE_BUNDLE_LAYOUT', '资料包布局版本高于当前程序，只能只读', { status: 409 });
  }
  const planned = [];
  for (const kind of ['nodes', 'routes']) {
    const directory = join(root, kind);
    await rejectSymlink(directory);
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => error?.code === 'ENOENT' ? [] : (() => { throw error; })());
    for (const entry of entries) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const ownerId = entry.name.slice(0, -3);
      if (!BUNDLE_OWNER_ID.test(ownerId)) throw new BridgeError('BUNDLE_OWNER_INVALID', `旧资料文件名不能安全迁移：${entry.name}`, { status: 409 });
      const source = join(directory, entry.name);
      const destination = join(directory, ownerId, 'index.md');
      await rejectSymlink(source);
      if (await exists(destination)) {
        throw new BridgeError('BUNDLE_MIGRATION_CONFLICT', `资料包目标已存在，未覆盖：${kind}/${ownerId}/index.md`, { status: 409 });
      }
      planned.push({ source, destination, relative: `${kind}/${entry.name}` });
    }
  }
  const metadataChanged = rewriteBundlePaths(document, mapRelativeDirectory(mapId));
  if (!metadataChanged && !planned.length) {
    return { migrated: false, mapId };
  }
  if (!planned.length) {
    stampBundleMigrationRevision(document);
    await writeJsonAtomic(mapPath, document);
    return { migrated: false, mapId };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = join(root, '.bridge', 'backups', `pre-bundle-migration-${stamp}`);
  const journalPath = join(root, '.bridge', 'migrations', 'bundle-layout-v1.json');
  await ensureDirectory(backupDirectory);
  await ensureDirectory(dirname(journalPath));
  await copyFile(mapPath, join(backupDirectory, 'map.json'));
  for (const item of planned) {
    const backup = join(backupDirectory, item.relative);
    await ensureDirectory(dirname(backup));
    await copyFile(item.source, backup);
  }
  await writeJsonAtomic(journalPath, { version: 1, state: 'prepared', mapId, planned: planned.map((item) => item.relative), completed: [] });
  const completed = [];
  try {
    for (const item of planned) {
      await ensureDirectory(dirname(item.destination));
      await rename(item.source, item.destination);
      completed.push(item);
      await writeJsonAtomic(journalPath, { version: 1, state: 'moving', mapId, planned: planned.map((entry) => entry.relative), completed: completed.map((entry) => entry.relative) });
    }
    rewriteBundlePaths(document, mapRelativeDirectory(mapId));
    stampBundleMigrationRevision(document);
    await writeJsonAtomic(mapPath, document);
    await writeJsonAtomic(journalPath, { version: 1, state: 'complete', mapId, planned: planned.map((entry) => entry.relative), completed: completed.map((entry) => entry.relative) });
  } catch (error) {
    for (const item of completed.reverse()) {
      await ensureDirectory(dirname(item.source));
      await rename(item.destination, item.source).catch(() => undefined);
    }
    throw new BridgeError('BUNDLE_MIGRATION_FAILED', `资料包迁移失败，旧文件已恢复；备份在 ${backupDirectory}`, { status: 500, cause: error, details: { backupDirectory } });
  }
  return { migrated: true, mapId, backupDirectory };
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
      for (const mapId of existing) await ensureBundleLayout(projectRoot, mapId);
      return { migrated: false, activeMap: fallback };
    }
    for (const mapId of existing) await ensureBundleLayout(projectRoot, mapId);
    return { migrated: false, activeMap: active };
  }
  if (await exists(join(dataDirectory, 'map.json'))) {
    await migrateLegacyLayout(projectRoot);
    await ensureBundleLayout(projectRoot, 'default');
    return { migrated: true, activeMap: 'default' };
  }
  await ensureDirectory(mapDirectory(projectRoot, 'default'));
  await writeActiveMap(projectRoot, 'default');
  return { migrated: false, activeMap: 'default' };
}
