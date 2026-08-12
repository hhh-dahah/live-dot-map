import { createHash, randomBytes } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export function checksum(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function cloneJson(value) {
  return structuredClone(value);
}

export const MAX_JSON_BYTES = 64 * 1024 * 1024;

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

export async function canonicalDirectory(path) {
  return realpath(path);
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'EISDIR', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

export async function atomicWriteFile(path, data, { mode = 0o600 } = {}) {
  await ensureDirectory(dirname(path));
  const temporary = join(dirname(path), `.${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function appendDurable(path, line) {
  await ensureDirectory(dirname(path));
  const handle = await open(path, 'a', 0o600);
  try {
    await handle.writeFile(`${line}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function lockOwnerIsGone(path, staleMs) {
  try {
    const [metadata, content] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    try {
      const owner = JSON.parse(content);
      if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
          return false;
        } catch (error) {
          return error?.code === 'ESRCH';
        }
      }
    } catch {
      // A partially written lock is only reclaimable after the stale window.
    }
    return Date.now() - metadata.mtimeMs > staleMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    return true;
  }
}

export async function withFileLock(path, operation, { timeoutMs = 5_000, staleMs = 30_000 } = {}) {
  await ensureDirectory(dirname(path));
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      await handle.sync();
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        await handle?.close().catch(() => {});
        handle = undefined;
        await unlink(path).catch(() => {});
        throw error;
      }
      if (await lockOwnerIsGone(path, staleMs)) {
        await unlink(path).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        });
        continue;
      }
      if (Date.now() >= deadline) {
        const timeout = new Error('Timed out waiting for the project write lock');
        timeout.code = 'LOCK_TIMEOUT';
        throw timeout;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {});
    await unlink(path).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

export async function readJson(path, { maxBytes = MAX_JSON_BYTES } = {}) {
  const metadata = await stat(path);
  if (metadata.size > maxBytes) {
    const error = new RangeError(`JSON file exceeds ${maxBytes} bytes`);
    error.code = 'FILE_TOO_LARGE';
    error.details = { path, size: metadata.size, limit: maxBytes };
    throw error;
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJsonAtomic(path, value) {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function quarantineCopy(source, quarantineDirectory, label, content) {
  await ensureDirectory(quarantineDirectory);
  const safeLabel = String(label).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const target = join(
    quarantineDirectory,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}-${safeLabel}`,
  );
  if (content === undefined) await copyFile(source, target);
  else await writeFile(target, content, { mode: 0o600 });
  return target;
}
