import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { BridgeError } from './errors.mjs';

const execFileAsync = promisify(execFile);

const SCHEMA_VERSION = 1;

function defaultRuntimeStateDir() {
  if (process.env.LIVEDOT_RUNTIME_STATE_DIR) return resolve(process.env.LIVEDOT_RUNTIME_STATE_DIR);
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(localAppData, 'live-dot-map', 'run');
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700).catch(() => undefined);
}

async function atomicPrivateWrite(path, value) {
  await privateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}

export function runtimePaths(runtimeStateDir = defaultRuntimeStateDir()) {
  const root = resolve(runtimeStateDir);
  return {
    root,
    bridge: join(root, 'bridge.json'),
    controlToken: join(root, 'control.token'),
    lock: join(root, 'singleton.lock'),
    sessions: join(root, 'sessions.json'),
    projects: join(root, 'projects.json'),
  };
}

export async function readBridgeState(runtimeStateDir) {
  const paths = runtimePaths(runtimeStateDir);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(paths.bridge, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new BridgeError('BRIDGE_STATE_CORRUPT', 'Bridge runtime state is unreadable', { cause: error });
  }
  if (
    parsed?.schemaVersion !== SCHEMA_VERSION
    || !Number.isInteger(parsed.pid) || parsed.pid <= 0
    || !Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535
    || typeof parsed.startedAt !== 'string'
  ) {
    throw new BridgeError('BRIDGE_STATE_CORRUPT', 'Bridge runtime state has an invalid shape');
  }
  return parsed;
}

export async function writeBridgeState(runtimeStateDir, { pid, port, startedAt = new Date().toISOString() }) {
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BridgeError('INVALID_BRIDGE_STATE', 'Bridge pid and port must be valid positive integers');
  }
  const state = { schemaVersion: SCHEMA_VERSION, pid, port, startedAt };
  await atomicPrivateWrite(runtimePaths(runtimeStateDir).bridge, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export async function readOrCreateControlToken(runtimeStateDir) {
  const path = runtimePaths(runtimeStateDir).controlToken;
  try {
    const value = (await readFile(path, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43,}$/.test(value)) throw new Error('invalid token');
    return value;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new BridgeError('CONTROL_TOKEN_CORRUPT', 'Bridge control token is unreadable or invalid', { cause: error });
    }
  }
  const token = randomBytes(32).toString('base64url');
  try {
    await privateDirectory(dirname(path));
    await writeFile(path, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(path, 0o600).catch(() => undefined);
    return token;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = (await readFile(path, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43,}$/.test(existing)) throw new BridgeError('CONTROL_TOKEN_CORRUPT', 'Bridge control token is invalid');
    return existing;
  }
}

export async function acquireSingletonLock(runtimeStateDir) {
  const path = runtimePaths(runtimeStateDir).lock;
  await privateDirectory(dirname(path));
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, 'utf8');
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error?.code === 'EEXIST') throw new BridgeError('BRIDGE_START_IN_PROGRESS', 'Another Bridge process is starting', { status: 409 });
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close().catch(() => undefined);
    await rm(path, { force: true }).catch(() => undefined);
  };
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * 判断 pid 是否真的是 Bridge 进程，返回 'bridge' | 'other' | 'unknown'。
 * Windows 会回收并复用 pid：bridge.json 里记录的 pid 可能已经被无关进程
 * 占用，单看 isProcessAlive 会把死掉的 Bridge 误判为“仍在运行”，从而拒绝
 * 恢复（打开画布失败）。'other' 表示确认是无关进程，可安全按失效清理；
 * 'unknown'（探测失败/无权读取/进程刚好退出）必须按保守处理，不能当成可清理。
 */
export async function checkBridgeProcess(pid) {
  if (!isProcessAlive(pid)) return 'other';
  try {
    let image = '';
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`,
      ], { timeout: 5000 });
      image = String(stdout).trim();
    } else {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 5000 });
      image = String(stdout).trim();
    }
    if (!image) return 'unknown';
    const base = image.split(/[\\/]/).pop().toLowerCase();
    return base.startsWith('livedot-bridge') || base === 'node' || base === 'node.exe' ? 'bridge' : 'other';
  } catch {
    return 'unknown';
  }
}

export async function clearStaleSingletonLock(runtimeStateDir, expectedPid, options = {}) {
  // force 仅在调用方已另行证明 pid 不属于 Bridge（如 pid 被复用）时使用；
  // 默认仍要求进程确实退出，避免误删活桥的锁。
  if (!options.force && isProcessAlive(expectedPid)) return false;
  const path = runtimePaths(runtimeStateDir).lock;
  let lock;
  try {
    lock = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw new BridgeError('BRIDGE_LOCK_CORRUPT', 'Bridge singleton lock is unreadable', { cause: error });
  }
  if (lock?.pid !== expectedPid) return false;
  await rm(path, { force: true });
  return true;
}

export async function removeBridgeState(runtimeStateDir, expectedPid) {
  const paths = runtimePaths(runtimeStateDir);
  const current = await readBridgeState(runtimeStateDir).catch(() => null);
  if (current && expectedPid && current.pid !== expectedPid) return false;
  await rm(paths.bridge, { force: true });
  return true;
}

export { defaultRuntimeStateDir };
