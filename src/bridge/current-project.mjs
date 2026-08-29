import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { atomicWriteFile, canonicalDirectory } from './fs-utils.mjs';

/**
 * 全局「当前项目」指针 —— bug1（画布切项目 Agent 不知情）的共享状态。
 *
 * HTTP 桥（画布）在 session.projectRoot 每次变化时写入指针；
 * stdio Agent 桥在每次 tools/call 前读取并跟随。
 * 写入/读取均 fail-open：指针失效时回退调用方自己的项目根，绝不阻断主流程。
 */
export function currentProjectFile() {
  return process.env.LIVEDOT_CURRENT_PROJECT_FILE || join(homedir(), '.live-dot-map', 'current-project.json');
}

/** HTTP 桥在项目根变化时调用；写入失败仅 warn 不抛（fail-open）。 */
export async function recordCurrentProject(projectRoot, options = {}) {
  try {
    const target = options.file ?? currentProjectFile();
    const payload = { projectRoot: resolve(projectRoot), updatedAt: new Date().toISOString() };
    await atomicWriteFile(target, `${JSON.stringify(payload)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** 读当前项目指针；不存在/损坏返回 null。 */
export async function readCurrentProject(options = {}) {
  const target = options.file ?? currentProjectFile();
  try {
    const text = await readFile(target, 'utf8');
    const parsed = JSON.parse(text);
    if (typeof parsed?.projectRoot === 'string' && parsed.projectRoot.trim()) return parsed.projectRoot.trim();
  } catch { /* 无指针/损坏 = 回落 */ }
  return null;
}

/**
 * 解析「本次调用应使用的项目根」：
 * 指针存在且目标目录真实存在 → 返回指针项目根；否则回退 fallbackRoot。
 * fail-open：目录不可达/指针损坏都回退，绝不抛错。
 */
export async function resolveProjectRootToUse(pointerRoot, fallbackRoot, options = {}) {
  const candidate = pointerRoot ?? await readCurrentProject(options).catch(() => null);
  if (!candidate) return fallbackRoot;
  try {
    const resolved = await canonicalDirectory(candidate);
    return resolved;
  } catch {
    return fallbackRoot;
  }
}