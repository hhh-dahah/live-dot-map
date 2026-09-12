import { constants, createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { BridgeError } from './errors.mjs';
import { atomicWriteFile, ensureDirectory, withFileLock, writeJsonAtomic, readJson } from './fs-utils.mjs';
import { mapDirectory, isSafeMapId } from './maps.mjs';

/** 资料包单文件硬上限（默认 2 GiB，满足本地科研仿真、工程大包与数据集）。浏览器端使用流式管道。 */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const MAX_BUNDLE_FILES = 1000;
export const MAX_MAP_ASSET_BYTES = 50 * 1024 * 1024 * 1024; // 50 GiB

const MAX_NAME_BYTES = 255;
const OWNER_KINDS = new Map([
  ['node', 'nodes'],
  ['nodes', 'nodes'],
  ['route', 'routes'],
  ['routes', 'routes'],
]);
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.msi', '.vbs', '.vbe', '.scr', '.pif', '.com', '.cpl', '.hta',
]);
const ASSET_TYPES = Object.freeze({
  // 图片与多媒体
  '.png': { mime: 'image/png', kind: 'png', disposition: 'inline' },
  '.jpg': { mime: 'image/jpeg', kind: 'jpeg', disposition: 'inline' },
  '.jpeg': { mime: 'image/jpeg', kind: 'jpeg', disposition: 'inline' },
  '.webp': { mime: 'image/webp', kind: 'webp', disposition: 'inline' },
  '.gif': { mime: 'image/gif', kind: 'gif', disposition: 'inline' },
  '.svg': { mime: 'image/svg+xml', kind: 'svg', disposition: 'attachment' },
  '.bmp': { mime: 'image/bmp', kind: 'bmp', disposition: 'inline' },
  '.ico': { mime: 'image/x-icon', kind: 'ico', disposition: 'inline' },
  '.mp4': { mime: 'video/mp4', kind: 'mp4', disposition: 'inline' },
  '.mp3': { mime: 'audio/mpeg', kind: 'mp3', disposition: 'inline' },
  '.wav': { mime: 'audio/wav', kind: 'wav', disposition: 'inline' },

  // 文档与论文素材
  '.pdf': { mime: 'application/pdf', kind: 'pdf', disposition: 'inline' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'docx', disposition: 'attachment' },
  '.doc': { mime: 'application/msword', kind: 'doc', disposition: 'attachment' },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'pptx', disposition: 'attachment' },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', kind: 'ppt', disposition: 'attachment' },
  '.md': { mime: 'text/markdown; charset=utf-8', kind: 'markdown', disposition: 'inline' },
  '.txt': { mime: 'text/plain; charset=utf-8', kind: 'txt', disposition: 'inline' },
  '.tex': { mime: 'application/x-tex', kind: 'tex', disposition: 'attachment' },

  // 压缩包与工程归档
  '.zip': { mime: 'application/zip', kind: 'zip', disposition: 'attachment' },
  '.7z': { mime: 'application/x-7z-compressed', kind: '7z', disposition: 'attachment' },
  '.rar': { mime: 'application/vnd.rar', kind: 'rar', disposition: 'attachment' },
  '.tar': { mime: 'application/x-tar', kind: 'tar', disposition: 'attachment' },
  '.gz': { mime: 'application/gzip', kind: 'gz', disposition: 'attachment' },
  '.bz2': { mime: 'application/x-bzip2', kind: 'bz2', disposition: 'attachment' },

  // 科学计算、数据与数据库
  '.csv': { mime: 'text/csv; charset=utf-8', kind: 'csv', disposition: 'attachment' },
  '.tsv': { mime: 'text/tab-separated-values; charset=utf-8', kind: 'tsv', disposition: 'attachment' },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'xlsx', disposition: 'attachment' },
  '.xls': { mime: 'application/vnd.ms-excel', kind: 'xls', disposition: 'attachment' },
  '.parquet': { mime: 'application/vnd.apache.parquet', kind: 'parquet', disposition: 'attachment' },
  '.h5': { mime: 'application/x-hdf5', kind: 'h5', disposition: 'attachment' },
  '.hdf5': { mime: 'application/x-hdf5', kind: 'hdf5', disposition: 'attachment' },
  '.pkl': { mime: 'application/octet-stream', kind: 'pkl', disposition: 'attachment' },
  '.npy': { mime: 'application/octet-stream', kind: 'npy', disposition: 'attachment' },
  '.npz': { mime: 'application/octet-stream', kind: 'npz', disposition: 'attachment' },
  '.mat': { mime: 'application/octet-stream', kind: 'mat', disposition: 'attachment' },
  '.sqlite': { mime: 'application/vnd.sqlite3', kind: 'sqlite', disposition: 'attachment' },
  '.db': { mime: 'application/vnd.sqlite3', kind: 'db', disposition: 'attachment' },
  '.sql': { mime: 'application/sql', kind: 'sql', disposition: 'attachment' },

  // 代码与脚本
  '.py': { mime: 'text/x-python; charset=utf-8', kind: 'py', disposition: 'attachment' },
  '.ipynb': { mime: 'application/x-ipynb+json', kind: 'ipynb', disposition: 'attachment' },
  '.m': { mime: 'text/x-matlab; charset=utf-8', kind: 'm', disposition: 'attachment' },
  '.r': { mime: 'text/x-r; charset=utf-8', kind: 'r', disposition: 'attachment' },
  '.c': { mime: 'text/x-c; charset=utf-8', kind: 'c', disposition: 'attachment' },
  '.cpp': { mime: 'text/x-c++src; charset=utf-8', kind: 'cpp', disposition: 'attachment' },
  '.h': { mime: 'text/x-c; charset=utf-8', kind: 'h', disposition: 'attachment' },
  '.rs': { mime: 'text/rust; charset=utf-8', kind: 'rs', disposition: 'attachment' },
  '.go': { mime: 'text/x-go; charset=utf-8', kind: 'go', disposition: 'attachment' },
  '.java': { mime: 'text/x-java-source; charset=utf-8', kind: 'java', disposition: 'attachment' },
  '.ts': { mime: 'application/typescript; charset=utf-8', kind: 'ts', disposition: 'attachment' },
  '.js': { mime: 'application/javascript; charset=utf-8', kind: 'js', disposition: 'attachment' },
  '.json': { mime: 'application/json; charset=utf-8', kind: 'json', disposition: 'inline' },
  '.yaml': { mime: 'text/yaml; charset=utf-8', kind: 'yaml', disposition: 'inline' },
  '.yml': { mime: 'text/yaml; charset=utf-8', kind: 'yml', disposition: 'inline' },
  '.toml': { mime: 'text/x-toml; charset=utf-8', kind: 'toml', disposition: 'inline' },
});
const ASSET_EXTENSIONS = new Set(Object.keys(ASSET_TYPES));
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

function bridgeError(code, message, status = 400, details) {
  return new BridgeError(code, message, { status, details });
}

function asOptions(args, keys) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Buffer.isBuffer(args[0])) return { ...args[0] };
  return Object.fromEntries(keys.map((key, index) => [key, args[index]]));
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function caseKey(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase('en-US');
}

function within(root, candidate) {
  const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !/^[A-Za-z]:[\\/]/.test(value));
}

function decodeForSecurity(input) {
  let current = String(input);
  for (let round = 0; round < 4; round += 1) {
    let decoded;
    try { decoded = decodeURIComponent(current); } catch { break; }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

function validateSegment(input, label = '名称') {
  if (typeof input !== 'string' || input.length === 0 || Buffer.byteLength(input, 'utf8') > MAX_NAME_BYTES) {
    throw bridgeError('BUNDLE_NAME_INVALID', `${label}无效`, 400);
  }
  const decoded = decodeForSecurity(input);
  if (decoded.includes('\0') || decoded.includes('/') || decoded.includes('\\') || decoded === '.' || decoded === '..') {
    throw bridgeError('BUNDLE_PATH_TRAVERSAL', `${label}包含非法路径`, 403);
  }
  if (input.includes('\0') || input.includes('/') || input.includes('\\') || input.includes(':')) {
    throw bridgeError('BUNDLE_PATH_INVALID', `${label}不能包含路径分隔符、盘符或 ADS`, 403);
  }
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decoded) || decoded === '.' || decoded === '..' || decoded.endsWith('.') || decoded.endsWith(' ')) {
    throw bridgeError('BUNDLE_PATH_INVALID', `${label}不能使用路径穿越、尾点或尾空格`, 403);
  }
  if (RESERVED_DEVICE_NAMES.test(input)) {
    throw bridgeError('BUNDLE_RESERVED_NAME', `${label}不能使用 Windows 保留设备名`, 403);
  }
  return input;
}

function normalizeOwnerKind(ownerKind) {
  const value = OWNER_KINDS.get(String(ownerKind || '').toLowerCase());
  if (!value) throw bridgeError('BUNDLE_OWNER_INVALID', '资料包对象类型必须是 node 或 route', 400);
  return value;
}

function validateOwnerId(ownerId) {
  validateSegment(ownerId, '对象 ID');
  if (String(ownerId).startsWith('.')) throw bridgeError('BUNDLE_OWNER_INVALID', '对象 ID 无效', 400);
  return ownerId;
}

function normalizeFileName(fileName, { asset = false } = {}) {
  const value = validateSegment(fileName, '资料包文件名');
  if (value.startsWith('.')) throw bridgeError('BUNDLE_NAME_INVALID', '资料包文件名不能以点开头', 400);
  if (caseKey(value) === 'index.md') return 'index.md';
  if (!/\.md$/i.test(value) && !asset) throw bridgeError('BUNDLE_MARKDOWN_REQUIRED', '补充资料必须是 .md 文件', 415);
  const ext = extname(value).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    throw bridgeError('BUNDLE_ASSET_TYPE_FORBIDDEN', `禁止导入系统可执行文件：${ext}`, 403);
  }
  return value;
}

function titleMarkdown(name, title) {
  const fallback = basename(name, extname(name)).slice(0, 80) || '未命名资料';
  return `# ${String(title || fallback).slice(0, 80)}\n\n`;
}

function contentTypeFor(fileName) {
  const ext = extname(fileName).toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    throw bridgeError('BUNDLE_ASSET_TYPE_FORBIDDEN', `禁止导入系统可执行文件：${ext}`, 403);
  }
  const type = ASSET_TYPES[ext] ?? { mime: 'application/octet-stream', kind: ext.slice(1) || 'bin', disposition: 'attachment' };
  return type;
}

function headerMatches(kind, header) {
  // 危险二进制防御：非可执行文件严禁包含 Windows PE 头 (MZ)
  if (header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a) {
    return false;
  }
  if (kind === 'png') return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === 'jpeg') return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (kind === 'webp') return header.length >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
  if (kind === 'gif') return header.length >= 6 && ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6));
  if (kind === 'pdf') return header.subarray(0, 5).toString('ascii') === '%PDF-';
  if (kind === 'docx' || kind === 'pptx' || kind === 'xlsx' || kind === 'zip') {
    return header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b && (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07);
  }
  if (kind === '7z') return header.length >= 6 && header[0] === 0x37 && header[1] === 0x7a && header[2] === 0xbc && header[3] === 0xaf && header[4] === 0x27 && header[5] === 0x1c;
  if (kind === 'gz') return header.length >= 2 && header[0] === 0x1f && header[1] === 0x8b;
  if (kind === 'rar') return header.length >= 4 && header.toString('ascii', 0, 4) === 'Rar!';
  if (kind === 'sqlite' || kind === 'db') return header.length >= 16 && header.toString('ascii', 0, 16).startsWith('SQLite format 3');
  if (kind === 'svg') {
    const text = header.toString('utf8').replace(/^\uFEFF/, '').trimStart();
    return /^(?:<\?xml\b[^>]*>\s*)?<svg(?:\s|>)/i.test(text);
  }
  return true;
}

function normalizeMime(mimeType) {
  if (mimeType === undefined || mimeType === null || mimeType === '') return undefined;
  return String(mimeType).split(';', 1)[0].trim().toLowerCase();
}

function compareStats(left, right) {
  return Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs)
    && (left.ino === undefined || right.ino === undefined || Number(left.ino) === Number(right.ino));
}

async function safeLstat(path) {
  return lstat(path).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
}

/**
 * 资料包的唯一底层实现。
 *
 * 目录布局固定为 mapRoot/nodes/<id>/index.md 或
 * mapRoot/routes/<id>/index.md；所有其它资料都只能位于同一对象目录。
 * 本类不接受客户端传入相对路径，调用方只能提供 ownerKind、ownerId、fileName。
 */
export class BundleStore {
  constructor(options = {}, legacyMapKey = 'default') {
    const value = typeof options === 'string' ? { projectRoot: options, mapKey: legacyMapKey } : options;
    if (!value?.projectRoot) throw bridgeError('BUNDLE_PROJECT_REQUIRED', '资料包需要项目根目录', 400);
    this.projectRoot = resolve(value.projectRoot);
    this.mapKey = value.mapKey ?? legacyMapKey;
    if (!isSafeMapId(this.mapKey)) throw bridgeError('INVALID_MAP_ID', '地图 ID 无效', 400, { mapKey: this.mapKey });
    this.mapRoot = resolve(value.mapDirectory ?? mapDirectory(this.projectRoot, this.mapKey));
    this.clock = value.clock ?? (() => new Date());
    this.faultInjector = value.faultInjector ?? (() => undefined);
    this.lockRoot = join(this.mapRoot, '.bridge', 'bundle-locks');
    this.commandRoot = join(this.mapRoot, '.bridge', 'bundle-commands');
    this.maxAssetBytes = value.maxAssetBytes ?? MAX_ASSET_BYTES;
    this.maxBundleFiles = value.maxBundleFiles ?? MAX_BUNDLE_FILES;
    this.maxMapAssetBytes = value.maxMapAssetBytes ?? MAX_MAP_ASSET_BYTES;
  }

  static async open(options) {
    const store = new BundleStore(options);
    await store.initialize();
    return store;
  }

  async initialize() {
    await this.#assertSafePath(this.projectRoot, this.projectRoot, { allowMissing: false });
    await this.#ensureMapRoot();
    return this;
  }

  async #ensureMapRoot() {
    await this.#assertSafePath(this.projectRoot, this.mapRoot, { allowMissing: true });
    await ensureDirectory(this.mapRoot);
    await this.#assertSafePath(this.projectRoot, this.mapRoot, { allowMissing: false });
  }

  async #assertSafePath(root, candidate, { allowMissing = true } = {}) {
    const rootReal = await realpath(root).catch((error) => {
      if (error?.code === 'ENOENT' && allowMissing) return resolve(root);
      throw error;
    });
    if (!within(rootReal, resolve(candidate))) throw bridgeError('BUNDLE_PATH_OUTSIDE_PROJECT', '资料包路径不在项目内', 403, { path: candidate });
    let cursor = resolve(candidate);
    while (true) {
      const metadata = await safeLstat(cursor);
      if (metadata) {
        if (metadata.isSymbolicLink()) throw bridgeError('BUNDLE_SYMLINK_FORBIDDEN', '资料包拒绝通过符号链接或 junction 访问', 403, { path: cursor });
        if (cursor !== resolve(candidate) && !metadata.isDirectory()) throw bridgeError('BUNDLE_PATH_INVALID', '资料包父路径不是目录', 409, { path: cursor });
        if (cursor === rootReal) break;
      } else if (!allowMissing) {
        throw bridgeError('BUNDLE_NOT_FOUND', '资料包路径不存在', 404, { path: cursor });
      }
      const parent = dirname(cursor);
      if (parent === cursor || !within(rootReal, parent)) break;
      cursor = parent;
    }
  }

  #ownerInfo(input) {
    const ownerKind = normalizeOwnerKind(input.ownerKind);
    const ownerId = validateOwnerId(input.ownerId);
    const directory = join(this.mapRoot, ownerKind, ownerId);
    return { ownerKind, ownerId, directory };
  }

  #lockPath(ownerKind, ownerId) {
    return join(this.lockRoot, `${digest(`${ownerKind}/${ownerId}`)}.lock`);
  }

  async #withOwnerLock(info, operation) {
    await this.#ensureMapRoot();
    await this.#assertSafePath(this.projectRoot, this.lockRoot, { allowMissing: true });
    await ensureDirectory(this.lockRoot);
    await this.#assertSafePath(this.projectRoot, this.lockRoot, { allowMissing: false });
    try {
      return await withFileLock(this.#lockPath(info.ownerKind, info.ownerId), operation, { timeoutMs: 10_000, staleMs: 30_000 });
    } catch (error) {
      if (error?.code === 'LOCK_TIMEOUT') throw bridgeError('BUNDLE_BUSY', '资料包正在被其他写入占用，请重试', 409);
      throw error;
    }
  }

  async #prepareOwner(info) {
    await this.#assertSafePath(this.projectRoot, info.directory, { allowMissing: true });
    await mkdir(info.directory, { recursive: true });
    await this.#assertSafePath(this.projectRoot, info.directory, { allowMissing: false });
  }

  async #entries(info, { includeArchived = false } = {}) {
    await this.#assertSafePath(this.projectRoot, info.directory, { allowMissing: true });
    const active = await readdir(info.directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    const output = [];
    for (const entry of active) {
      if (entry.name === '.archive') continue;
      if (entry.name.startsWith('.')) continue;
      const path = join(info.directory, entry.name);
      await this.#assertSafePath(this.projectRoot, path, { allowMissing: false });
      if (!entry.isFile()) continue;
      if (!/\.md$/i.test(entry.name) && !ASSET_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      output.push({ name: entry.name, path, archived: false });
    }
    if (!includeArchived) return output;
    const archivedRoot = join(info.directory, '.archive');
    const archived = await readdir(archivedRoot, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    await this.#assertSafePath(this.projectRoot, archivedRoot, { allowMissing: true });
    for (const entry of archived) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.meta.json')) continue;
      const path = join(archivedRoot, entry.name);
      await this.#assertSafePath(this.projectRoot, path, { allowMissing: false });
      if (entry.isFile() && (/\.md$/i.test(entry.name) || ASSET_EXTENSIONS.has(extname(entry.name).toLowerCase()))) {
        output.push({ name: entry.name, path, archived: true });
      }
    }
    return output;
  }

  async #fileInfo(info, entry) {
    const metadata = await stat(entry.path);
    const isIndex = entry.name === 'index.md';
    const isMarkdown = isIndex || /\.md$/i.test(entry.name);
    const type = isMarkdown ? { mime: 'text/markdown; charset=utf-8', kind: 'markdown' } : contentTypeFor(entry.name);
    // Markdown etags are content hashes, rather than mtime/size surrogates.
    // Callers can therefore safely compare a value read before a concurrent
    // append/replace with the bytes that are actually under the lock.
    const markdownContent = isMarkdown
      ? (entry.content === undefined ? await readFile(entry.path) : Buffer.from(entry.content))
      : undefined;
    return {
      ownerKind: info.ownerKind === 'nodes' ? 'node' : 'route',
      ownerId: info.ownerId,
      name: entry.name,
      fileName: entry.name,
      path: `${info.ownerKind}/${info.ownerId}/${entry.name}`,
      archived: Boolean(entry.archived),
      isIndex,
      kind: type.kind,
      mimeType: type.mime,
      disposition: type.disposition ?? 'inline',
      size: metadata.size,
      updatedAt: metadata.mtime?.toISOString?.() ?? null,
      ...(isMarkdown ? { etag: digest(markdownContent) } : {}),
    };
  }

  async list(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'options']);
    const info = this.#ownerInfo(input);
    const includeArchived = Boolean(input.includeArchived ?? input.options?.includeArchived);
    const entries = await this.#entries(info, { includeArchived });
    const result = [];
    for (const entry of entries) result.push(await this.#fileInfo(info, entry));
    result.sort((left, right) => Number(right.isIndex) - Number(left.isIndex) || left.name.localeCompare(right.name, 'en'));
    return result;
  }

  async #resolveEntry(info, fileName, { archived = false, includeArchived = false, asset = false } = {}) {
    const name = normalizeFileName(fileName, { asset });
    if (name === 'index.md' && archived) throw bridgeError('BUNDLE_INDEX_IMMUTABLE', 'index.md 不允许归档', 409);
    const entries = await this.#entries(info, { includeArchived: archived || includeArchived });
    const entry = entries.find((item) => item.archived === archived && caseKey(item.name) === caseKey(name));
    if (!entry) throw bridgeError('BUNDLE_NOT_FOUND', '资料包文件不存在', 404, { ownerKind: info.ownerKind, ownerId: info.ownerId, fileName: name });
    return entry;
  }

  async read(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'options']);
    const options = input.options ?? {};
    const info = this.#ownerInfo(input);
    const entry = await this.#resolveEntry(info, input.fileName ?? 'index.md', {
      archived: Boolean(input.archived ?? options.archived),
      asset: Boolean(input.asset ?? options.asset),
    });
    const data = await readFile(entry.path);
    const metadata = await this.#fileInfo(info, { ...entry, content: data });
    return { ...metadata, content: metadata.kind === 'markdown' ? data.toString('utf8') : data, buffer: data };
  }

  async readMarkdown(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'options']);
    const result = await this.read({ ...input, fileName: input.fileName ?? 'index.md' });
    if (result.kind !== 'markdown') throw bridgeError('BUNDLE_MARKDOWN_REQUIRED', '目标不是 Markdown 文件', 415);
    return result;
  }

  async readAsset(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'options']);
    const result = await this.read({ ...input, asset: true });
    if (result.kind === 'markdown') throw bridgeError('BUNDLE_ASSET_REQUIRED', '目标不是附件', 415);
    return result;
  }

  async createMarkdown(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'content']);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName ?? 'note.md');
    if (name === 'index.md') throw bridgeError('BUNDLE_INDEX_CREATE_USE_ENSURE', '主文档应通过 ensureIndex 创建', 409);
    const content = input.content === undefined ? titleMarkdown(name, input.title) : String(input.content);
    if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) throw bridgeError('BUNDLE_MARKDOWN_TOO_LARGE', 'Markdown 内容超过 2 MiB', 413);
    return this.#withOwnerLock(info, async () => {
      await this.#prepareOwner(info);
      const entries = await this.#entries(info, { includeArchived: true });
      if (entries.length >= MAX_BUNDLE_FILES) throw bridgeError('BUNDLE_FILE_QUOTA', '单资料包最多保存 200 个文件', 413);
      const names = new Set(entries.map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(name, names);
      const target = join(info.directory, finalName);
      await atomicWriteFile(target, content);
      return this.#fileInfo(info, { name: finalName, path: target, archived: false });
    });
  }

  async ensureIndex(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'content']);
    const info = this.#ownerInfo(input);
    return this.#withOwnerLock(info, async () => {
      await this.#prepareOwner(info);
      const target = join(info.directory, 'index.md');
      const current = await safeLstat(target);
      if (current) {
        if (current.isSymbolicLink() || !current.isFile()) throw bridgeError('BUNDLE_SYMLINK_FORBIDDEN', 'index.md 不是安全普通文件', 403);
        return this.#fileInfo(info, { name: 'index.md', path: target, archived: false });
      }
      const entries = await this.#entries(info, { includeArchived: true });
      if (entries.length >= MAX_BUNDLE_FILES) throw bridgeError('BUNDLE_FILE_QUOTA', '单资料包最多保存 200 个文件', 413);
      const content = input.content === undefined ? titleMarkdown('index.md', input.title) : String(input.content);
      if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) throw bridgeError('BUNDLE_MARKDOWN_TOO_LARGE', 'Markdown 内容超过 2 MiB', 413);
      await atomicWriteFile(target, content);
      return this.#fileInfo(info, { name: 'index.md', path: target, archived: false });
    });
  }

  async replaceMarkdown(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'content', 'baseEtag']);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName ?? 'index.md');
    if (typeof input.content !== 'string') throw bridgeError('BUNDLE_CONTENT_REQUIRED', 'Markdown 内容必须是文本', 400);
    if (typeof input.baseEtag !== 'string' || input.baseEtag.length === 0) {
      throw bridgeError('MARKDOWN_BASE_ETAG_REQUIRED', '替换 Markdown 必须提供 baseEtag', 400);
    }
    if (Buffer.byteLength(input.content, 'utf8') > MAX_MARKDOWN_BYTES) throw bridgeError('BUNDLE_MARKDOWN_TOO_LARGE', 'Markdown 内容超过 2 MiB', 413);
    return this.#withOwnerLock(info, async () => {
      const entry = await this.#resolveEntry(info, name);
      await this.#prepareOwner(info);
      // Re-read while holding the same lock used by append. A caller may have
      // read an etag before another append acquired the lock; comparing the
      // pre-write bytes here prevents that stale replace from winning.
      let current;
      try {
        current = await readFile(entry.path);
      } catch (error) {
        if (error?.code === 'ENOENT') throw bridgeError('BUNDLE_NOT_FOUND', '资料包文件不存在', 404, { ownerKind: info.ownerKind, ownerId: info.ownerId, fileName: name });
        throw error;
      }
      const currentEtag = digest(current);
      if (String(input.baseEtag) !== currentEtag) {
        const currentMetadata = await this.#fileInfo(info, { ...entry, content: current });
        throw bridgeError('MARKDOWN_CONFLICT', 'Markdown 已被其他窗口或 Agent 修改', 409, {
          current: {
            ...currentMetadata,
            content: current.toString('utf8'),
          },
        });
      }
      await atomicWriteFile(entry.path, input.content);
      return this.#fileInfo(info, { ...entry, path: entry.path, content: Buffer.from(input.content) });
    });
  }

  async appendMarkdown(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'content', 'commandId']);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName ?? 'index.md');
    if (typeof input.content !== 'string') throw bridgeError('BUNDLE_CONTENT_REQUIRED', 'Markdown 内容必须是文本', 400);
    if (typeof input.commandId !== 'string' || input.commandId.length === 0) {
      throw bridgeError('BUNDLE_COMMAND_ID_REQUIRED', '追加 Markdown 必须提供 commandId', 400);
    }
    if (Buffer.byteLength(input.content, 'utf8') > MAX_MARKDOWN_BYTES) throw bridgeError('BUNDLE_MARKDOWN_TOO_LARGE', 'Markdown 内容超过 2 MiB', 413);
    return this.#withOwnerLock(info, async () => {
      await this.#prepareOwner(info);
      const commandId = input.commandId;
      const requestDigest = digest(JSON.stringify({ name, content: input.content }));
      await this.#assertSafePath(this.projectRoot, this.commandRoot, { allowMissing: true });
      await ensureDirectory(this.commandRoot);
      const receiptPath = join(this.commandRoot, `${digest(`${info.ownerKind}/${info.ownerId}/${name}/${commandId}`)}.json`);
      const receipt = await readJson(receiptPath).catch((error) => error?.code === 'ENOENT' ? null : (() => { throw error; })());
      if (receipt?.requestDigest !== undefined && receipt.requestDigest !== requestDigest) {
        throw bridgeError('BUNDLE_COMMAND_REUSE', 'commandId 已用于其他 Markdown 追加', 409);
      }
      const target = join(info.directory, name);
      const current = await safeLstat(target);
      let existing = '';
      if (current) {
        if (current.isSymbolicLink() || !current.isFile()) throw bridgeError('BUNDLE_SYMLINK_FORBIDDEN', 'Markdown 目标不是安全普通文件', 403);
        existing = await readFile(target, 'utf8');
      } else {
        const entries = await this.#entries(info, { includeArchived: true });
        if (entries.length >= MAX_BUNDLE_FILES) throw bridgeError('BUNDLE_FILE_QUOTA', '单资料包最多保存 200 个文件', 413);
      }
      // Normalize only the append boundary: preserve intentional indentation
      // and blank lines inside a segment, while ensuring exactly one LF joins
      // two non-empty segments and CRLF never accumulates across retries.
      const normalizeBoundary = (value) => String(value)
        .replace(/\r\n?/g, '\n')
        .replace(/^\n+/g, '')
        .replace(/\n+$/g, '');
      const left = normalizeBoundary(existing);
      const right = normalizeBoundary(input.content);
      const next = left.length === 0 ? right : right.length === 0 ? left : `${left}\n${right}`;
      if (Buffer.byteLength(next, 'utf8') > MAX_MARKDOWN_BYTES) throw bridgeError('BUNDLE_MARKDOWN_TOO_LARGE', 'Markdown 内容超过 2 MiB', 413);
      const beforeEtag = digest(Buffer.from(existing));
      const afterEtag = digest(Buffer.from(next));

      // Older receipts did not record a state. They were only written after
      // the file replacement, so treating them as committed keeps upgrades
      // compatible without appending the same segment again.
      if (receipt && receipt.state !== 'prepared') {
        return this.#fileInfo(info, { name, path: target, archived: false });
      }
      if (receipt?.state === 'prepared') {
        if (beforeEtag === receipt.afterEtag) {
          const result = await this.#fileInfo(info, { name, path: target, archived: false });
          await writeJsonAtomic(receiptPath, { ...receipt, state: 'committed', result });
          return result;
        }
        if (beforeEtag !== receipt.beforeEtag || afterEtag !== receipt.afterEtag) {
          throw bridgeError('BUNDLE_APPEND_RECOVERY_CONFLICT', 'Markdown 追加恢复时发现内容已变化', 409);
        }
      } else {
        await writeJsonAtomic(receiptPath, {
          state: 'prepared',
          requestDigest,
          beforeEtag,
          afterEtag,
        });
      }
      await atomicWriteFile(target, next);
      await this.faultInjector('afterAppendReplaceBeforeReceipt', { info, name, commandId, target });
      const result = await this.#fileInfo(info, { name, path: target, archived: false, content: Buffer.from(next) });
      await writeJsonAtomic(receiptPath, { state: 'committed', requestDigest, beforeEtag, afterEtag, result });
      return result;
    });
  }

  async rename(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'from', 'to']);
    const info = this.#ownerInfo(input);
    const requestedFrom = input.from ?? input.fileName;
    const from = normalizeFileName(requestedFrom, { asset: typeof requestedFrom === 'string' && !/\.md$/i.test(requestedFrom) });
    const to = normalizeFileName(input.to ?? input.newName, { asset: !/\.md$/i.test(from) });
    if (from === 'index.md' || to === 'index.md') throw bridgeError('BUNDLE_INDEX_IMMUTABLE', 'index.md 不允许改名', 409);
    if (/\.md$/i.test(from) !== /\.md$/i.test(to)) throw bridgeError('BUNDLE_TYPE_CHANGE_FORBIDDEN', '改名不能改变 Markdown/附件类型', 415);
    return this.#withOwnerLock(info, async () => {
      const source = await this.#resolveEntry(info, from, { asset: !/\.md$/i.test(from) });
      if (!/\.md$/i.test(from) && contentTypeFor(from).kind !== contentTypeFor(to).kind) {
        throw bridgeError('BUNDLE_TYPE_CHANGE_FORBIDDEN', '附件改名不能改变文件类型', 415);
      }
      const names = new Set((await this.#entries(info, { includeArchived: true })).filter((entry) => caseKey(entry.name) !== caseKey(from)).map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(to, names);
      const target = join(info.directory, finalName);
      await this.#assertSafePath(this.projectRoot, source.path, { allowMissing: false });
      await rename(source.path, target);
      return this.#fileInfo(info, { name: finalName, path: target, archived: false });
    });
  }

  async archive(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName']);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName, { asset: typeof input.fileName === 'string' && !/\.md$/i.test(input.fileName) });
    if (name === 'index.md') throw bridgeError('BUNDLE_INDEX_IMMUTABLE', 'index.md 不允许归档', 409);
    return this.#withOwnerLock(info, async () => {
      const source = await this.#resolveEntry(info, name, { asset: !/\.md$/i.test(name) });
      const archiveRoot = join(info.directory, '.archive');
      await this.#assertSafePath(this.projectRoot, archiveRoot, { allowMissing: true });
      await ensureDirectory(archiveRoot);
      await this.#assertSafePath(this.projectRoot, archiveRoot, { allowMissing: false });
      const names = new Set((await this.#entries(info, { includeArchived: true })).filter((entry) => entry.archived).map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(name, names);
      const target = join(archiveRoot, finalName);
      await rename(source.path, target);
      await writeJsonAtomic(`${target}.meta.json`, { archivedAt: this.clock().toISOString(), originalName: name });
      return this.#fileInfo(info, { name: finalName, path: target, archived: true });
    });
  }

  async restore(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName']);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName, { asset: typeof input.fileName === 'string' && !/\.md$/i.test(input.fileName) });
    if (name === 'index.md') throw bridgeError('BUNDLE_INDEX_IMMUTABLE', 'index.md 不允许恢复', 409);
    return this.#withOwnerLock(info, async () => {
      const source = await this.#resolveEntry(info, name, { archived: true, asset: !/\.md$/i.test(name) });
      await this.#prepareOwner(info);
      const names = new Set((await this.#entries(info)).map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(name, names);
      const target = join(info.directory, finalName);
      await rename(source.path, target);
      await rm(`${source.path}.meta.json`, { force: true }).catch(() => undefined);
      return this.#fileInfo(info, { name: finalName, path: target, archived: false });
    });
  }

  #allocateName(requested, occupied) {
    if (!occupied.has(caseKey(requested))) return requested;
    const extension = extname(requested);
    const stem = requested.slice(0, requested.length - extension.length);
    for (let suffix = 2; suffix < 100_000; suffix += 1) {
      const candidate = `${stem}-${suffix}${extension}`;
      if (!occupied.has(caseKey(candidate))) return candidate;
    }
    throw bridgeError('BUNDLE_NAME_EXHAUSTED', '资料包重名后缀已耗尽', 409);
  }

  async #quota(info, incomingBytes = 0) {
    const entries = await this.#entries(info, { includeArchived: true });
    if (entries.length >= this.maxBundleFiles) throw bridgeError('BUNDLE_FILE_QUOTA', `单资料包最多保存 ${this.maxBundleFiles} 个文件`, 413);
    const mapEntries = [];
    for (const ownerKind of ['nodes', 'routes']) {
      const kindRoot = join(this.mapRoot, ownerKind);
      await this.#assertSafePath(this.projectRoot, kindRoot, { allowMissing: true });
      const owners = await readdir(kindRoot, { withFileTypes: true }).catch((error) => error?.code === 'ENOENT' ? [] : (() => { throw error; })());
      for (const owner of owners) {
        if (!owner.isDirectory() || owner.name.startsWith('.')) continue;
        const ownerInfo = { ownerKind, ownerId: owner.name, directory: join(kindRoot, owner.name) };
        const ownerEntries = await this.#entries(ownerInfo, { includeArchived: true });
        mapEntries.push(...ownerEntries.filter((entry) => !/\.md$/i.test(entry.name)));
      }
    }
    let total = incomingBytes;
    for (const entry of mapEntries) total += (await stat(entry.path)).size;
    if (total > this.maxMapAssetBytes) throw bridgeError('BUNDLE_SIZE_QUOTA', `单地图附件总量超过 ${Math.round(this.maxMapAssetBytes / (1024 * 1024 * 1024))} GiB`, 413);
  }

  async #withMapLock(operation) {
    await this.#ensureMapRoot();
    await this.#assertSafePath(this.projectRoot, this.lockRoot, { allowMissing: true });
    await ensureDirectory(this.lockRoot);
    try {
      return await withFileLock(join(this.lockRoot, 'map-assets.lock'), operation, { timeoutMs: 10_000, staleMs: 30_000 });
    } catch (error) {
      if (error?.code === 'LOCK_TIMEOUT') throw bridgeError('BUNDLE_BUSY', '地图附件正在被其他写入占用，请重试', 409);
      throw error;
    }
  }

  async #consumeStream(stream, temporary) {
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw bridgeError('BUNDLE_STREAM_REQUIRED', '附件必须通过可读流导入', 400);
    await ensureDirectory(dirname(temporary));
    const handle = await open(temporary, 'wx', 0o600);
    let size = 0;
    const chunks = [];
    let headerSize = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > this.maxAssetBytes) throw bridgeError('BUNDLE_ASSET_TOO_LARGE', `单附件超过限制（最大 ${Math.round(this.maxAssetBytes / (1024 * 1024))} MiB）`, 413, { limit: this.maxAssetBytes });
        if (headerSize < 8192) {
          chunks.push(buffer.subarray(0, Math.min(buffer.length, 8192 - headerSize)));
          headerSize += Math.min(buffer.length, 8192 - headerSize);
        }
        await handle.write(buffer);
      }
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
    return { size, header: Buffer.concat(chunks).subarray(0, 8192) };
  }

  async #copySource(sourcePath, temporary, { allowExternal = false } = {}) {
    /* 默认只允许项目内相对路径;显式 allowExternal(本地路径粘贴导入)才放行项目外绝对路径 */
    const candidate = allowExternal ? resolve(sourcePath) : resolve(this.projectRoot, sourcePath);
    if (!allowExternal) await this.#assertSafePath(this.projectRoot, candidate, { allowMissing: false });
    const before = await stat(candidate);
    if (!before.isFile()) throw bridgeError('BUNDLE_SOURCE_NOT_FILE', '附件源必须是普通文件', 400);
    if (before.size > this.maxAssetBytes) throw bridgeError('BUNDLE_ASSET_TOO_LARGE', `单附件超过限制（最大 ${Math.round(this.maxAssetBytes / (1024 * 1024))} MiB）`, 413, { limit: this.maxAssetBytes });
    let handle;
    try {
      const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
      handle = await open(candidate, flags);
      const opened = await handle.stat();
      if (!opened.isFile() || !compareStats(before, opened)) throw bridgeError('BUNDLE_SOURCE_CHANGED', '附件源在导入前已变化', 409);
      const result = await this.#consumeStream(handle.createReadStream(), temporary);
      const after = await stat(candidate);
      if (!compareStats(before, after) || result.size !== before.size) throw bridgeError('BUNDLE_SOURCE_CHANGED', '附件源在导入过程中发生变化', 409);
      return result;
    } catch (error) {
      if (error?.code === 'ELOOP') throw bridgeError('BUNDLE_SYMLINK_FORBIDDEN', '附件源不允许是符号链接', 403);
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async importAsset(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'sourcePath', 'stream', 'mimeType', 'allowExternalPath']);
    const info = this.#ownerInfo(input);
    const requestedName = normalizeFileName(input.fileName, { asset: true });
    const type = contentTypeFor(requestedName);
    const declaredMime = normalizeMime(input.mimeType ?? input.contentType);
    if (declaredMime && declaredMime !== type.mime) throw bridgeError('BUNDLE_MIME_MISMATCH', '声明 MIME 与扩展名不一致', 415, { expected: type.mime, received: declaredMime });
    if (!input.sourcePath && !input.stream) throw bridgeError('BUNDLE_SOURCE_REQUIRED', '附件导入需要 sourcePath 或 stream', 400);
    await this.#prepareOwner(info);
    const temporary = join(info.directory, `.${randomBytes(12).toString('hex')}.upload.tmp`);
    let imported;
    try {
      imported = input.sourcePath ? await this.#copySource(input.sourcePath, temporary, { allowExternal: input.allowExternalPath === true }) : await this.#consumeStream(input.stream, temporary);
      if (!headerMatches(type.kind, imported.header)) throw bridgeError('BUNDLE_FILE_HEADER_MISMATCH', '附件文件头与扩展名不一致', 415, { expected: type.kind });
      return await this.#withMapLock(() => this.#withOwnerLock(info, async () => {
        await this.#prepareOwner(info);
        await this.#quota(info, imported.size);
        const names = new Set((await this.#entries(info, { includeArchived: true })).map((entry) => caseKey(entry.name)));
        const finalName = this.#allocateName(requestedName, names);
        const target = join(info.directory, finalName);
        await this.#assertSafePath(this.projectRoot, target, { allowMissing: true });
        await rename(temporary, target);
        const result = await this.#fileInfo(info, { name: finalName, path: target, archived: false });
        return { ...result, mimeType: type.mime, disposition: type.disposition ?? 'inline' };
      }));
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async createReadStream(...args) {
    const input = asOptions(args, ['ownerKind', 'ownerId', 'fileName', 'options']);
    const options = input.options ?? {};
    const info = this.#ownerInfo(input);
    const entry = await this.#resolveEntry(info, input.fileName, { archived: Boolean(input.archived ?? options.archived), asset: true });
    const metadata = await this.#fileInfo(info, entry);
    return { ...metadata, stream: createReadStream(entry.path) };
  }
}

export { ASSET_TYPES, contentTypeFor, headerMatches, validateSegment };
