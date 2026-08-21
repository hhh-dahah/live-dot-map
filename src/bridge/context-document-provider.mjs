import { createHash } from 'node:crypto';
import {
  lstat,
  readdir,
  readFile,
  realpath,
} from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { BridgeError } from './errors.mjs';
import { isSafeMapId } from './maps.mjs';

/**
 * ContextDocumentProvider 是 Agent 上下文的唯一文件入口。
 *
 * 它只读取当前 mapKey 下、当前可见对象拥有的资料包。项目级递归扫描
 * 不属于这个类的职责：没有对象指针的 Markdown、其它地图、.bridge/WAL
 * 和 .archive 都不会进入结果。
 */
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const SAFE_OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const ASSET_TYPES = Object.freeze({
  '.png': { kind: 'png', mimeType: 'image/png' },
  '.jpg': { kind: 'jpeg', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'jpeg', mimeType: 'image/jpeg' },
  '.webp': { kind: 'webp', mimeType: 'image/webp' },
  '.gif': { kind: 'gif', mimeType: 'image/gif' },
  '.pdf': { kind: 'pdf', mimeType: 'application/pdf' },
  '.docx': { kind: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.svg': { kind: 'svg', mimeType: 'image/svg+xml' },
});
const RESERVED_DATA_DIRS = new Set(['.bridge', '.archive', 'backups', 'snapshots', 'quarantine', 'wal', 'locks']);

function contextError(code, message, status = 403, details) {
  return new BridgeError(code, message, { status, details });
}

function hidden(item) {
  return item?.archived === true || item?.shelved === true;
}

function textPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !/^[A-Za-z]:[\\/]/.test(value));
}

function projectRelative(root, candidate) {
  return relative(root, candidate).replace(/\\/g, '/');
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function collectionOwner(collection, item) {
  const ownerId = String(item?.id ?? '');
  if (!ownerId) return null;
  if (!SAFE_OWNER_ID.test(ownerId)) return null;
  if (collection === 'nodes') return { ownerKind: 'node', directoryKind: 'nodes', ownerId };
  // 方案线（route）与方案边（edge）共享 routes/<id>/ 资料包布局。
  if (collection === 'routes') return { ownerKind: 'route', directoryKind: 'routes', ownerId };
  if (collection === 'edges') return { ownerKind: 'edge', directoryKind: 'routes', ownerId };
  return null;
}

function activeObjects(document, includeHistory) {
  const routes = Array.isArray(document?.routes) ? document.routes : [];
  const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
  const edges = Array.isArray(document?.edges) ? document.edges : [];
  const routeById = new Map(routes.map((item) => [String(item?.id), item]));
  const nodeById = new Map(nodes.map((item) => [String(item?.id), item]));
  const routeVisible = (routeId) => includeHistory || typeof routeId !== 'string' || !routeId || !hidden(routeById.get(routeId));
  const nodeVisible = (node) => includeHistory || (!hidden(node) && routeVisible(typeof node?.route === 'string' ? node.route : undefined));
  const edgeVisible = (edge) => {
    if (includeHistory) return true;
    if (hidden(edge) || !routeVisible(typeof edge?.route === 'string' ? edge.route : undefined)) return false;
    const from = typeof edge?.from === 'string' ? nodeById.get(edge.from) : undefined;
    const to = typeof edge?.to === 'string' ? nodeById.get(edge.to) : undefined;
    return (!from || nodeVisible(from)) && (!to || nodeVisible(to));
  };
  const owners = [];
  for (const item of routes) if (includeHistory || !hidden(item)) {
    const owner = collectionOwner('routes', item);
    if (owner) owners.push({ ...owner, item });
  }
  for (const item of nodes) if (nodeVisible(item)) {
    const owner = collectionOwner('nodes', item);
    if (owner) owners.push({ ...owner, item });
  }
  for (const item of edges) if (edgeVisible(item)) {
    const owner = collectionOwner('edges', item);
    if (owner) owners.push({ ...owner, item });
  }
  return { owners, routeVisible, nodeVisible, edgeVisible };
}

async function requireRegularPath(root, candidate, { allowMissing = false } = {}) {
  const rootReal = await realpath(root).catch((error) => {
    if (error?.code === 'ENOENT') throw contextError('CONTEXT_PROJECT_NOT_FOUND', '上下文项目根目录不存在', 404);
    throw error;
  });
  const resolved = resolve(candidate);
  if (!within(rootReal, resolved)) throw contextError('CONTEXT_PATH_OUTSIDE_PROJECT', '上下文文件不在项目根目录内', 403, { path: candidate });
  let cursor = resolved;
  let target;
  while (true) {
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!allowMissing) throw contextError('CONTEXT_FILE_NOT_FOUND', '上下文文件不存在', 404, { path: candidate });
    }
    if (metadata) {
      if (metadata.isSymbolicLink()) throw contextError('CONTEXT_SYMLINK_FORBIDDEN', '上下文拒绝通过符号链接读取文件', 403, { path: candidate });
      if (cursor === resolved) target = metadata;
    }
    if (cursor === rootReal || cursor === dirnameSafe(cursor)) break;
    cursor = dirnameSafe(cursor);
  }
  if (!target && !allowMissing) throw contextError('CONTEXT_FILE_NOT_FOUND', '上下文文件不存在', 404, { path: candidate });
  if (target && !target.isFile()) throw contextError('CONTEXT_NOT_FILE', '上下文路径不是普通文件', 409, { path: candidate });
  return { rootReal, resolved, metadata: target };
}

async function requireSafeDirectory(root, candidate, { allowMissing = true } = {}) {
  const rootReal = await realpath(root).catch((error) => {
    if (error?.code === 'ENOENT') throw contextError('CONTEXT_PROJECT_NOT_FOUND', '上下文项目根目录不存在', 404);
    throw error;
  });
  const resolved = resolve(candidate);
  if (!within(rootReal, resolved)) throw contextError('CONTEXT_PATH_OUTSIDE_PROJECT', '上下文目录不在项目根目录内', 403, { path: candidate });
  let cursor = resolved;
  while (true) {
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!allowMissing) throw contextError('CONTEXT_DIRECTORY_NOT_FOUND', '上下文目录不存在', 404, { path: candidate });
    }
    if (metadata) {
      if (metadata.isSymbolicLink()) throw contextError('CONTEXT_SYMLINK_FORBIDDEN', '上下文拒绝通过符号链接读取目录', 403, { path: candidate });
      if (cursor === resolved && !metadata.isDirectory()) throw contextError('CONTEXT_NOT_DIRECTORY', '上下文路径不是目录', 409, { path: candidate });
    }
    if (cursor === rootReal || cursor === dirnameSafe(cursor)) break;
    cursor = dirnameSafe(cursor);
  }
  return { rootReal, resolved };
}

// path.dirname is tiny, but keeping it local makes the symlink walk above
// explicit and avoids accidentally accepting a drive root as a project child.
function dirnameSafe(value) {
  const normalized = resolve(value);
  const parent = resolve(normalized, '..');
  return parent === normalized ? normalized : parent;
}

function isReservedRelative(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  if (!parts.length) return true;
  if (parts.some((part) => part === '.' || part === '..')) return true;
  // Root-level Markdown is intentionally not ambient context. Data internals
  // are also never accepted as an explicit custom pointer.
  if (parts.length === 1) return true;
  if (parts.some((part) => RESERVED_DATA_DIRS.has(part.toLowerCase()))) return true;
  return false;
}

function normalizedMapRoot(root, mapKey) {
  return resolve(root, '.live-dot-map', 'maps', mapKey);
}

function isInsideMap(root, mapRoot, candidate) {
  const mapRelative = projectRelative(root, mapRoot).toLowerCase().replace(/\\/g, '/');
  const candidateRelative = projectRelative(root, candidate).toLowerCase().replace(/\\/g, '/');
  return candidateRelative === mapRelative || candidateRelative.startsWith(`${mapRelative}/`);
}

function mergeOwner(entry, owner) {
  const owners = Array.isArray(entry.owners) ? entry.owners : [];
  const key = `${owner.ownerKind}:${owner.ownerId}`;
  if (!owners.some((item) => `${item.ownerKind}:${item.ownerId}` === key)) owners.push({ ownerKind: owner.ownerKind, ownerId: owner.ownerId });
  entry.owners = owners;
  if (!entry.ownerKind) {
    entry.ownerKind = owner.ownerKind;
    entry.ownerId = owner.ownerId;
  }
}

/**
 * Collect the current map's context documents.
 *
 * @param {{projectRoot:string,mapKey:string,document:object,includeHistory?:boolean}} input
 * @returns {Promise<{mapKey:string,mapDir:string,markdown:Array,assets:Array}>}
 */
export async function collect({ projectRoot, mapKey, document, includeHistory = false } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) throw contextError('CONTEXT_PROJECT_REQUIRED', '上下文需要项目根目录', 400);
  if (!isSafeMapId(mapKey)) throw contextError('CONTEXT_MAP_INVALID', '上下文地图 ID 无效', 400, { mapKey });
  if (!document || typeof document !== 'object') throw contextError('CONTEXT_DOCUMENT_REQUIRED', '上下文需要当前地图文档', 400);

  const root = resolve(projectRoot);
  const mapRoot = normalizedMapRoot(root, mapKey);
  const mapDir = `.live-dot-map/maps/${mapKey}`;
  const result = { mapKey, mapDir, markdown: [], assets: [] };
  const markdownByPath = new Map();
  const assetsByPath = new Map();
  const { owners } = activeObjects(document, includeHistory === true);

  // Missing map directories are valid for a newly-created/empty map. Do not
  // create them merely because an Agent asks for context.
  const mapMetadata = await lstat(mapRoot).catch((error) => error?.code === 'ENOENT' ? null : (() => { throw error; })());
  if (mapMetadata?.isSymbolicLink()) throw contextError('CONTEXT_SYMLINK_FORBIDDEN', '当前地图目录不允许是符号链接', 403, { path: mapRoot });
  if (mapMetadata && !mapMetadata.isDirectory()) throw contextError('CONTEXT_MAP_INVALID', '当前地图路径不是目录', 409, { path: mapRoot });
  await requireSafeDirectory(root, mapRoot, { allowMissing: true });
  if (!mapMetadata) return result;

  const addMarkdown = async (candidate, owner, source = 'bundle', { allowMissing = false } = {}) => {
    const safety = await requireRegularPath(root, candidate, { allowMissing });
    if (!safety.metadata) return;
    if (safety.metadata.size > MAX_MARKDOWN_BYTES) throw contextError('CONTEXT_MARKDOWN_TOO_LARGE', '上下文 Markdown 超过 2 MiB', 413, { path: candidate, size: safety.metadata.size });
    const content = await readFile(safety.resolved, 'utf8');
    const path = projectRelative(root, safety.resolved);
    const existing = markdownByPath.get(path.toLowerCase());
    if (existing) {
      mergeOwner(existing, owner);
      if (source === 'bundle' && existing.source === 'custom') existing.source = 'bundle';
      return;
    }
    const info = {
      path,
      text: content,
      source,
      ownerKind: owner.ownerKind,
      ownerId: owner.ownerId,
      isIndex: source === 'bundle' && path.toLowerCase().endsWith('/index.md'),
      archived: false,
      size: Buffer.byteLength(content, 'utf8'),
      etag: digest(Buffer.from(content, 'utf8')),
      updatedAt: safety.metadata.mtime?.toISOString?.() ?? null,
      owners: [{ ownerKind: owner.ownerKind, ownerId: owner.ownerId }],
    };
    markdownByPath.set(path.toLowerCase(), info);
    result.markdown.push(info);
  };

  const addAsset = async (candidate, owner, name) => {
    const safety = await requireRegularPath(root, candidate);
    if (!safety.metadata) return;
    const relativePath = projectRelative(root, safety.resolved);
    const existing = assetsByPath.get(relativePath.toLowerCase());
    if (existing) {
      mergeOwner(existing, owner);
      return;
    }
    const type = ASSET_TYPES[extname(name).toLowerCase()] ?? { kind: 'file', mimeType: 'application/octet-stream' };
    const info = {
      path: relativePath,
      fileName: name,
      name,
      source: 'bundle',
      ownerKind: owner.ownerKind,
      ownerId: owner.ownerId,
      kind: type.kind,
      mimeType: type.mimeType,
      size: safety.metadata.size,
      updatedAt: safety.metadata.mtime?.toISOString?.() ?? null,
      archived: false,
      owners: [{ ownerKind: owner.ownerKind, ownerId: owner.ownerId }],
    };
    assetsByPath.set(relativePath.toLowerCase(), info);
    result.assets.push(info);
  };

  const scanOwner = async (owner) => {
    const directory = join(mapRoot, owner.directoryKind, owner.ownerId);
    const ownerMetadata = await lstat(directory).catch((error) => error?.code === 'ENOENT' ? null : (() => { throw error; })());
    if (!ownerMetadata) return;
    if (ownerMetadata.isSymbolicLink()) throw contextError('CONTEXT_SYMLINK_FORBIDDEN', '资料包对象目录不允许是符号链接', 403, { path: directory });
    if (!ownerMetadata.isDirectory()) throw contextError('CONTEXT_NOT_DIRECTORY', '资料包对象路径不是目录', 409, { path: directory });
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.archive' || entry.name.startsWith('.')) continue;
      const candidate = join(directory, entry.name);
      const metadata = await lstat(candidate).catch((error) => error?.code === 'ENOENT' ? null : (() => { throw error; })());
      if (!metadata) continue;
      if (metadata.isSymbolicLink()) throw contextError('CONTEXT_SYMLINK_FORBIDDEN', '资料包文件不允许是符号链接', 403, { path: candidate });
      if (metadata.isDirectory()) continue;
      if (/\.md$/i.test(entry.name)) await addMarkdown(candidate, owner, 'bundle');
      else if (ASSET_TYPES[extname(entry.name).toLowerCase()]) await addAsset(candidate, owner, entry.name);
    }
  };

  for (const owner of owners) await scanOwner(owner);

  // A legacy/custom md pointer is allowed only when it resolves to an ordinary
  // file in this project, is not an ambient root document, and is not another
  // map or bridge data. It must be referenced by one of the visible owners.
  for (const owner of owners) {
    const pointer = textPath(owner.item?.md);
    if (!pointer || !/\.md$/i.test(pointer)) continue;
    const candidate = resolve(root, pointer);
    const relativePath = projectRelative(root, candidate);
    if (isReservedRelative(relativePath)) continue;
    if (!within(root, candidate)) continue;
    if (relativePath.toLowerCase().startsWith('.live-dot-map/maps/')) {
      if (!isInsideMap(root, mapRoot, candidate)) continue;
      // Current map's bundle files were already collected above. A custom
      // file in the current map may still be explicitly referenced.
    }
    if (relativePath.toLowerCase().startsWith('.live-dot-map/.bridge/')) continue;
    // A stale pointer is not ambient context; leave it out until the user or
    // bridge recreates the file. Symlinked pointers still fail closed because
    // requireRegularPath validates every existing path component.
    await addMarkdown(candidate, owner, 'custom', { allowMissing: true });
  }

  result.markdown.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  result.assets.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return result;
}

export class ContextDocumentProvider {
  async collect(input) {
    return collect(input);
  }
}

export { ASSET_TYPES as CONTEXT_ASSET_TYPES };
