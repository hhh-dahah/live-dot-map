import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { atomicWriteFile, ensureDirectory, withFileLock } from './fs-utils.mjs';
import { BridgeError } from './errors.mjs';

/** Markdown is deliberately kept separate from map.json commands. */
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_MARKDOWN_PATH = 1024;

function inRoot(root, candidate) {
  const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

function normalizeRelativePath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_MARKDOWN_PATH) {
    throw new BridgeError('MARKDOWN_PATH_INVALID', 'Markdown 路径无效', { status: 400 });
  }
  if (input.includes('\0')) throw new BridgeError('MARKDOWN_PATH_INVALID', 'Markdown 路径包含非法字符', { status: 400 });
  // Paths in map.json are portable POSIX paths. Accepting backslashes here is
  // useful on Windows, but normalize before checking traversal.
  const portable = input.replace(/\\/g, '/');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable) || isAbsolute(input)) {
    throw new BridgeError('MARKDOWN_PATH_INVALID', 'Markdown 路径必须是项目内相对路径', { status: 400 });
  }
  const parts = portable.split('/');
  if (parts.some((part) => part === '..')) {
    throw new BridgeError('MARKDOWN_PATH_TRAVERSAL', 'Markdown 路径不能离开项目目录', { status: 403 });
  }
  const normalized = portable.replace(/^\.\//, '').replace(/\/+/g, '/');
  if (!normalized || normalized === '.' || normalized.endsWith('/')) {
    throw new BridgeError('MARKDOWN_PATH_INVALID', 'Markdown 路径必须指向文件', { status: 400 });
  }
  if (!/\.md$/i.test(normalized)) {
    throw new BridgeError('MARKDOWN_EXTENSION_REQUIRED', '只允许读写 .md 文件', { status: 415 });
  }
  return normalized;
}

async function ensureNoSymlink(root, candidate, { allowMissing = true } = {}) {
  const rootReal = await realpath(root);
  if (!inRoot(rootReal, candidate)) {
    throw new BridgeError('MARKDOWN_PATH_OUTSIDE_PROJECT', 'Markdown 路径不在当前项目内', { status: 403 });
  }
  // Check the deepest existing parent. A symlink anywhere in the path could
  // otherwise escape the allowlisted project between path validation and I/O.
  let cursor = candidate;
  let candidateStat;
  try { candidateStat = await lstat(candidate); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (candidateStat?.isSymbolicLink()) {
    throw new BridgeError('MARKDOWN_SYMLINK_FORBIDDEN', '不允许通过符号链接访问 Markdown', { status: 403 });
  }
  if (candidateStat && !candidateStat.isFile()) {
    throw new BridgeError('MARKDOWN_NOT_FILE', 'Markdown 路径不是文件', { status: 409 });
  }
  while (cursor !== rootReal && cursor !== dirname(cursor)) {
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) throw new BridgeError('MARKDOWN_SYMLINK_FORBIDDEN', '不允许通过符号链接访问 Markdown', { status: 403 });
      const resolved = await realpath(cursor);
      if (!inRoot(rootReal, resolved)) throw new BridgeError('MARKDOWN_PATH_OUTSIDE_PROJECT', 'Markdown 路径不在当前项目内', { status: 403 });
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!allowMissing) throw new BridgeError('MARKDOWN_NOT_FOUND', 'Markdown 文件不存在', { status: 404 });
      cursor = dirname(cursor);
    }
  }
  return { root: rootReal, stat: candidateStat };
}

function digest(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function initialMarkdown(path, title) {
  return `# ${String(title || path.split('/').at(-1)?.replace(/\.md$/i, '') || '未命名记录').slice(0, 80)}\n\n`;
}

function result(path, content, metadata, { created = false } = {}) {
  const bytes = Buffer.byteLength(content, 'utf8');
  return {
    path,
    content,
    exists: true,
    created,
    size: bytes,
    etag: digest(content),
    updatedAt: metadata?.mtime?.toISOString?.() ?? null,
  };
}

export class MarkdownStore {
  constructor(projectRoot) {
    this.projectRoot = resolve(projectRoot);
  }

  async #target(requestedPath, options = {}) {
    const path = normalizeRelativePath(requestedPath);
    const candidate = resolve(this.projectRoot, path);
    await ensureNoSymlink(this.projectRoot, candidate, options);
    return { path, candidate };
  }

  #lockPath(path) {
    const lockId = createHash('sha256').update(path, 'utf8').digest('hex');
    return join(this.projectRoot, '.live-dot-map', '.bridge', 'markdown-locks', `${lockId}.lock`);
  }

  async #readUnlocked(requestedPath, { create = false, title = '' } = {}) {
    const { path, candidate } = await this.#target(requestedPath, { allowMissing: true });
    let metadata;
    try {
      metadata = await stat(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!create) return { path, content: '', exists: false, created: false, size: 0, etag: digest(''), updatedAt: null };
      const initial = initialMarkdown(path, title);
      if (Buffer.byteLength(initial, 'utf8') > MAX_MARKDOWN_BYTES) throw new BridgeError('MARKDOWN_TOO_LARGE', 'Markdown 内容超过 2 MiB 限制', { status: 413 });
      await mkdir(dirname(candidate), { recursive: true });
      // Re-check the parent after mkdir: a malicious replacement must not turn
      // an allowlisted directory into a symlink target.
      await ensureNoSymlink(this.projectRoot, candidate, { allowMissing: true });
      try {
        await atomicWriteFile(candidate, initial);
      } catch (writeError) {
        throw new BridgeError('MARKDOWN_WRITE_FAILED', 'Markdown 创建失败，请重试', { status: 503, cause: writeError });
      }
      metadata = await stat(candidate);
      return result(path, initial, metadata, { created: true });
    }
    // The old canvas could leave a zero-byte n*.md after a failed open. Treat
    // that known broken artifact as an uninitialized detail when the caller
    // explicitly requested create/open, so the user lands in a useful editor
    // instead of another blank path preview.
    if (create && metadata.size === 0) {
      const initial = initialMarkdown(path, title);
      await atomicWriteFile(candidate, initial).catch((error) => {
        throw new BridgeError('MARKDOWN_WRITE_FAILED', 'Markdown 初始化失败，请重试', { status: 503, cause: error });
      });
      metadata = await stat(candidate);
      return result(path, initial, metadata, { created: true });
    }
    if (metadata.size > MAX_MARKDOWN_BYTES) throw new BridgeError('MARKDOWN_TOO_LARGE', 'Markdown 文件超过 2 MiB 限制', { status: 413, details: { size: metadata.size, limit: MAX_MARKDOWN_BYTES } });
    let content;
    try { content = await readFile(candidate, 'utf8'); } catch (error) {
      throw new BridgeError('MARKDOWN_READ_FAILED', 'Markdown 读取失败，请重试', { status: 503, cause: error });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) throw new BridgeError('MARKDOWN_TOO_LARGE', 'Markdown 文件超过 2 MiB 限制', { status: 413 });
    return result(path, content, metadata);
  }

  async read(requestedPath, options = {}) {
    const { create = false } = options;
    if (!create) return this.#readUnlocked(requestedPath, options);
    const path = normalizeRelativePath(requestedPath);
    const lockPath = this.#lockPath(path);
    try {
      // First creation and repair of a legacy zero-byte file use the exact
      // same lock as write(). A concurrent writer therefore cannot be
      // followed by a late '# title' initialization that rolls its content
      // back.
      await ensureDirectory(dirname(lockPath));
      await ensureNoSymlink(this.projectRoot, lockPath, { allowMissing: true });
      return await withFileLock(lockPath, () => this.#readUnlocked(path, options), { timeoutMs: 5_000, staleMs: 30_000 });
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error?.code === 'LOCK_TIMEOUT') throw new BridgeError('MARKDOWN_BUSY', 'Markdown 正在被其他写入占用，请重试', { status: 409, cause: error });
      throw new BridgeError('MARKDOWN_READ_FAILED', 'Markdown 初始化失败，请重试', { status: 503, cause: error });
    }
  }

  async write(requestedPath, content, { baseEtag } = {}) {
    if (typeof content !== 'string') throw new BridgeError('MARKDOWN_CONTENT_REQUIRED', 'Markdown 内容必须是文本', { status: 400 });
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_MARKDOWN_BYTES) throw new BridgeError('MARKDOWN_TOO_LARGE', 'Markdown 内容超过 2 MiB 限制', { status: 413, details: { size: bytes, limit: MAX_MARKDOWN_BYTES } });
    const path = normalizeRelativePath(requestedPath);
    const lockPath = this.#lockPath(path);
    try {
      // The lock is both process-local and cross-process. Re-reading the
      // current document while holding it turns compare-and-write into one
      // serial operation: two callers with the same baseEtag cannot both win.
      await ensureDirectory(dirname(lockPath));
      await ensureNoSymlink(this.projectRoot, lockPath, { allowMissing: true });
      return await withFileLock(lockPath, async () => {
        const { candidate } = await this.#target(path, { allowMissing: true });
        let current;
        try {
          current = await this.read(path);
        } catch (error) {
          if (error?.code !== 'MARKDOWN_NOT_FOUND') throw error;
          current = { path, content: '', exists: false, created: false, size: 0, etag: digest(''), updatedAt: null };
        }
        if (baseEtag !== undefined && String(baseEtag) !== String(current?.etag ?? digest(''))) {
          throw new BridgeError('MARKDOWN_CONFLICT', 'Markdown 已被其他窗口或 Agent 修改', {
            status: 409,
            details: current ? { current: { path: current.path, content: current.content, size: current.size, etag: current.etag, updatedAt: current.updatedAt } } : { current: null },
          });
        }
        // Re-check the complete parent chain immediately before the atomic
        // rename. This narrows the symlink-swap window without ever following
        // a pre-existing symlink supplied by the caller.
        await mkdir(dirname(candidate), { recursive: true });
        await ensureNoSymlink(this.projectRoot, candidate, { allowMissing: true });
        await atomicWriteFile(candidate, content);
        const metadata = await stat(candidate);
        return result(path, content, metadata);
      }, { timeoutMs: 5_000, staleMs: 30_000 });
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error?.code === 'LOCK_TIMEOUT') throw new BridgeError('MARKDOWN_BUSY', 'Markdown 正在被其他写入占用，请重试', { status: 409, cause: error });
      throw new BridgeError('MARKDOWN_WRITE_FAILED', 'Markdown 保存失败，请重试', { status: 503, cause: error });
    }
  }

  async reveal(requestedPath, { open = false } = {}) {
    const { path, candidate } = await this.#target(requestedPath, { allowMissing: true });
    const exists = await stat(candidate).then(() => true).catch((error) => error?.code === 'ENOENT' ? false : Promise.reject(error));
    let opened = false;
    if (open) {
      const target = exists ? candidate : dirname(candidate);
      try {
        const child = process.platform === 'win32'
          ? spawn('explorer.exe', ['/select,', target], { detached: true, stdio: 'ignore' })
          : process.platform === 'darwin'
            ? spawn('open', ['-R', target], { detached: true, stdio: 'ignore' })
            : spawn('xdg-open', [dirname(target)], { detached: true, stdio: 'ignore' });
        child.once('error', () => {});
        child.unref();
        opened = true;
      } catch {
        opened = false;
      }
    }
    return { path, exists, opened };
  }
}
