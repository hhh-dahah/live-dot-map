import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import { BridgeError } from './errors.mjs';
import { defaultNativeHelperPath } from './recycle-bin.mjs';

function error(code, message, status = 503, details) {
  return new BridgeError(code, message, { status, details });
}

const MODES = Object.freeze({
  'pick-editor': (request) => ['--pick-editor'],
  'save-as': (request) => ['--save-as', resolve(String(request.sourcePath || ''))],
  'open-default': (request) => ['--open-default', resolve(String(request.targetPath || ''))],
  'open-folder': (request) => ['--open-folder', resolve(String(request.targetPath || ''))],
  'open-manual': (request) => ['--open-manual', resolve(String(request.executablePath || '')), resolve(String(request.targetPath || ''))],
});

export class NativeWindowsHelper {
  constructor(options = {}) {
    const candidate = options.helperPath ?? defaultNativeHelperPath(options);
    this.helperPath = candidate ? resolve(candidate) : null;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 120_000);
  }

  async run(request = {}) {
    const buildArgs = MODES[request.operation];
    if (!buildArgs) throw error('NATIVE_HELPER_OPERATION_INVALID', '原生助手操作无效', 400);
    if (!this.helperPath) throw error('NATIVE_HELPER_UNAVAILABLE', '未找到本产品原生助手');
    await access(this.helperPath).catch(() => { throw error('NATIVE_HELPER_UNAVAILABLE', '未找到本产品原生助手'); });
    const args = buildArgs(request);
    if (args.some((value, index) => index > 0 && (!value || value === resolve('')))) {
      throw error('NATIVE_HELPER_ARGUMENT_REQUIRED', '原生助手缺少目标路径', 400);
    }
    return new Promise((resolvePromise, reject) => {
      const child = this.spawnImpl(this.helperPath, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill?.();
        if (!settled) {
          settled = true;
          reject(error('NATIVE_HELPER_TIMEOUT', '本机操作等待超时'));
        }
      }, this.timeoutMs);
      child.stdout?.setEncoding?.('utf8');
      child.stderr?.setEncoding?.('utf8');
      child.stdout?.on?.('data', (chunk) => { stdout += chunk; if (stdout.length > 16_384) stdout = stdout.slice(-16_384); });
      child.stderr?.on?.('data', (chunk) => { stderr += chunk; if (stderr.length > 4_096) stderr = stderr.slice(-4_096); });
      child.once('error', (cause) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error('NATIVE_HELPER_FAILED', '无法启动本产品原生助手', 503, { cause: String(cause?.message || cause) }));
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        let parsed;
        try { parsed = JSON.parse(stdout.trim()); } catch { parsed = null; }
        if (code !== 0 || !parsed || (parsed.ok !== true && parsed.cancelled !== true)) {
          reject(error(parsed?.code || 'NATIVE_HELPER_FAILED', parsed?.message || stderr.trim().slice(0, 400) || '本机操作失败', 503));
          return;
        }
        resolvePromise(parsed);
      });
    });
  }
}

export function createNativeWindowsHelper(options) {
  return new NativeWindowsHelper(options);
}
