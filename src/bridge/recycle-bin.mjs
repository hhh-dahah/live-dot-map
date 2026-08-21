import { spawn } from 'node:child_process';
import { access, lstat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { BridgeError } from './errors.mjs';

const TRANSACTION_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, status = 503, details) {
  return new BridgeError(code, message, { status, details });
}

export function defaultNativeHelperPath(options = {}) {
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return join(resolve(localAppData), 'live-dot-map', 'current', 'LiveDotMapSetup.exe');
}

/**
 * 仅接受最终地图目录中的 purge transaction 目录，避免 native helper 变成
 * 任意目录删除入口。真实的 reparse-point 检查在 Node 与原生端各做一次。
 */
export async function assertPurgeStagingPath(value) {
  const target = resolve(String(value ?? ''));
  const parts = target.split(sep);
  const marker = parts.findIndex((part) => part.toLowerCase() === '.live-dot-map');
  const suffix = marker >= 0 ? parts.slice(marker) : [];
  if (
    suffix.length !== 7
    || suffix[1].toLowerCase() !== 'maps'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(suffix[2])
    || suffix[3].toLowerCase() !== '.bridge'
    || suffix[4].toLowerCase() !== 'purge-staging'
    || !TRANSACTION_ID.test(suffix[5])
    || suffix[6] !== ''
  ) {
    // Windows resolve() normally has no trailing empty segment. Accept the six-part form.
    if (
      suffix.length !== 6
      || suffix[1].toLowerCase() !== 'maps'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(suffix[2])
      || suffix[3].toLowerCase() !== '.bridge'
      || suffix[4].toLowerCase() !== 'purge-staging'
      || !TRANSACTION_ID.test(suffix[5])
    ) throw failure('PURGE_STAGING_PATH_INVALID', '回收站暂存路径不符合产品目录约束', 400, { path: target });
  }

  let current = parts[0].endsWith(':') ? `${parts[0]}${sep}` : parts[0] || sep;
  for (const part of parts.slice(1)) {
    if (!part) continue;
    current = join(current, part);
    const metadata = await lstat(current).catch((cause) => {
      if (cause?.code === 'ENOENT') return null;
      throw cause;
    });
    if (!metadata) throw failure('PURGE_STAGING_MISSING', '回收站暂存目录不存在', 404, { path: current });
    if (metadata.isSymbolicLink()) throw failure('PURGE_STAGING_REPARSE_FORBIDDEN', '回收站暂存路径不能经过符号链接或联接', 403, { path: current });
  }
  const leaf = await lstat(target);
  if (!leaf.isDirectory()) throw failure('PURGE_STAGING_NOT_DIRECTORY', '回收站暂存目标不是目录', 400, { path: target });
  return target;
}

function runHelper(spawnImpl, executable, args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill?.();
      if (!settled) {
        settled = true;
        reject(failure('RECYCLE_BIN_TIMEOUT', '系统回收站响应超时，已停止永久清除'));
      }
    }, timeoutMs);
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on?.('data', (chunk) => { stdout += chunk; if (stdout.length > 16_384) stdout = stdout.slice(-16_384); });
    child.stderr?.on?.('data', (chunk) => { stderr += chunk; if (stderr.length > 4_096) stderr = stderr.slice(-4_096); });
    child.once('error', (cause) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(failure('RECYCLE_BIN_HELPER_FAILED', '无法启动系统回收站 helper', 503, { cause: String(cause?.message || cause) }));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim()); } catch { /* 统一转成受控失败 */ }
      if (code !== 0 || parsed?.ok !== true) {
        reject(failure('RECYCLE_BIN_FAILED', '系统回收站未接收暂存资料', 503, {
          exitCode: code,
          code: parsed?.code,
          message: parsed?.message || stderr.trim().slice(0, 400),
        }));
        return;
      }
      resolvePromise(true);
    });
  });
}

export class NativeRecycleBin {
  constructor(options = {}) {
    const candidate = options.helperPath ?? defaultNativeHelperPath(options);
    this.helperPath = candidate ? resolve(candidate) : null;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 30_000);
  }

  async recycle(stagingPath) {
    if (process.platform !== 'win32' && this.spawnImpl === spawn) {
      throw failure('RECYCLE_BIN_UNSUPPORTED', '系统回收站 helper 仅在 Windows 安装版可用');
    }
    if (!this.helperPath) throw failure('RECYCLE_BIN_UNAVAILABLE', '未找到系统回收站 helper');
    await access(this.helperPath).catch(() => { throw failure('RECYCLE_BIN_UNAVAILABLE', '未找到系统回收站 helper'); });
    const safePath = await assertPurgeStagingPath(stagingPath);
    return runHelper(this.spawnImpl, this.helperPath, ['--recycle-staging', safePath], this.timeoutMs);
  }
}

export function createNativeRecycleBin(options) {
  return new NativeRecycleBin(options);
}
