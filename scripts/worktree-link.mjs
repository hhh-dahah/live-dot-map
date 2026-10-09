import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只有登记过的正式工位才把 .live-dot-map 联接到主仓库的真实记忆。
// 临时工作树一律不联接：git worktree remove 在 Windows 上会穿过联接删掉目标（10-07 事故）。
export const REGISTRY_FILE = 'livedot-工位名单.json';
export const HOOK_SCRIPT = 'livedot-worktree-link.mjs';
const HOOK_BEGIN = '# >>> 活点地图 worktree 记忆联接（由 scripts/worktree-link.mjs 安装，勿手改）';
const HOOK_END = '# <<< 活点地图 worktree 记忆联接';
const LEGACY_HOOK = /# 活点地图：新开 worktree 自动共享记忆钩子\r?\n[\s\S]*?\r?\n[ \t]*fi\r?\nfi\r?\n?/;

export function git(cwd, args) {
  // 钩子里 git 会注入 GIT_DIR 等变量，带着它们查别的目录会查错仓库。
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function normPath(path) {
  const full = resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

export const samePath = (a, b) => normPath(a) === normPath(b);

/** 解析 Git 主仓库物理路径与 .git 目录 */
export function resolveGitMainRepo(startDir = process.cwd()) {
  try {
    const worktreeRoot = resolve(git(startDir, ['rev-parse', '--show-toplevel']));
    const gitCommonDir = resolve(git(startDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    const mainRepoRoot = dirname(gitCommonDir);
    return { isWorktree: !samePath(worktreeRoot, mainRepoRoot), worktreeRoot, mainRepoRoot, gitCommonDir };
  } catch {
    return null;
  }
}

/** git worktree list 的结果；第一项是主工作树。 */
export function listWorktrees(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']);
  const list = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const entry = {};
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) entry.path = resolve(line.slice(9));
      else if (line.startsWith('branch ')) entry.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
    if (entry.path) list.push(entry);
  }
  return list;
}

export function registryPath(gitCommonDir) {
  return join(gitCommonDir, REGISTRY_FILE);
}

export function readRegistry(gitCommonDir) {
  const file = registryPath(gitCommonDir);
  if (!existsSync(file)) return { version: 1, worktrees: [] };
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.worktrees)) throw new Error(`工位名单格式不对：${file}`);
  return data;
}

function writeRegistry(gitCommonDir, data) {
  const file = registryPath(gitCommonDir);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

export function isRegistered(gitCommonDir, worktreeRoot) {
  return readRegistry(gitCommonDir).worktrees.some((item) => samePath(item.path, worktreeRoot));
}

/** 为登记过的工作树挂载主仓库的 .live-dot-map 目录联接（Junction）。未登记的不挂。 */
export function linkWorktreeMemory(targetDir = process.cwd()) {
  const info = resolveGitMainRepo(targetDir);
  if (!info) {
    console.error('❌ 未检测到有效的 Git 仓库或工作树环境。');
    return false;
  }
  if (!info.isWorktree) {
    console.log(`ℹ️ 当前目录为主工作树 (${info.worktreeRoot})，无需链接。`);
    return true;
  }

  let registered = false;
  try { registered = isRegistered(info.gitCommonDir, info.worktreeRoot); } catch (error) {
    console.error(`❌ 读不了工位名单，不连接真实记忆：${error.message}`);
    return false;
  }
  if (!registered) {
    console.log(`ℹ️ 活点地图：${info.worktreeRoot} 不是登记的正式工位，不连接真实记忆。`);
    console.log(`   要作为正式工位使用：node scripts/worktree-link.mjs --register "${info.worktreeRoot}"`);
    return false;
  }

  const mainMemory = join(info.mainRepoRoot, '.live-dot-map');
  if (!existsSync(mainMemory)) {
    console.error(`❌ 主仓库未找到记忆源目录: ${mainMemory}`);
    return false;
  }

  const linkTarget = join(info.worktreeRoot, '.live-dot-map');
  if (existsSync(linkTarget) || isLink(linkTarget)) {
    if (isLink(linkTarget)) {
      console.log(`✅ 已存在目录联接: ${linkTarget} -> ${mainMemory}`);
      return true;
    }
    console.warn(`⚠️ 目标已存在但非联接，请先确认并清理旧目录: ${linkTarget}`);
    return false;
  }

  try {
    symlinkSync(mainMemory, linkTarget, 'junction');
    console.log(`🎉 成功建立记忆共享联接: ${info.worktreeRoot} => ${mainMemory}`);
    return true;
  } catch (error) {
    console.error('❌ 创建目录联接失败:', error.message);
    return false;
  }
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

/** 把已存在的附属工作树登记为正式工位，并挂上记忆联接。 */
export function registerWorktree(worktreePath) {
  const root = resolve(worktreePath);
  const info = resolveGitMainRepo(root);
  if (!info || !samePath(info.worktreeRoot, root)) throw new Error(`不是工作树根目录：${root}`);
  if (!info.isWorktree) throw new Error('主工位不需要登记。');
  const entry = listWorktrees(info.mainRepoRoot).find((item) => samePath(item.path, root));
  if (!entry) throw new Error(`不是本仓库的工作树：${root}`);
  const data = readRegistry(info.gitCommonDir);
  if (!data.worktrees.some((item) => samePath(item.path, root))) {
    data.worktrees.push({ path: root, branch: entry.branch ?? null, registeredAt: new Date().toISOString() });
    writeRegistry(info.gitCommonDir, data);
  }
  return linkWorktreeMemory(root);
}

export function unregisterWorktree(gitCommonDir, worktreePath) {
  const data = readRegistry(gitCommonDir);
  const kept = data.worktrees.filter((item) => !samePath(item.path, worktreePath));
  if (kept.length === data.worktrees.length) return false;
  writeRegistry(gitCommonDir, { ...data, worktrees: kept });
  return true;
}

/** 新建正式工位：建工作树 → 登记 → 挂记忆联接。 */
export function createWorkstation(worktreePath, branch, cwd = process.cwd()) {
  const info = resolveGitMainRepo(cwd);
  if (!info) throw new Error('未检测到有效的 Git 仓库。');
  const target = resolve(cwd, worktreePath);
  let branchExists = true;
  try { git(info.mainRepoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); } catch { branchExists = false; }
  git(info.mainRepoRoot, branchExists ? ['worktree', 'add', target, branch] : ['worktree', 'add', '-b', branch, target]);
  return registerWorktree(target);
}

/** 安装 post-checkout 钩子。钩子运行 .git/hooks 里的副本，不运行工作树里检出的脚本，检出旧提交也绕不过名单。 */
export function installPostCheckoutHook(gitCommonDir) {
  const hooksDir = join(gitCommonDir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  copyFileSync(fileURLToPath(import.meta.url), join(hooksDir, HOOK_SCRIPT));

  const hookFile = join(hooksDir, 'post-checkout');
  const block = `${HOOK_BEGIN}
if [ -f .git ] && [ ! -e .live-dot-map ]; then
  node "$(git rev-parse --path-format=absolute --git-common-dir)/hooks/${HOOK_SCRIPT}" --hook || true
fi
${HOOK_END}
`;
  let existing = existsSync(hookFile) ? readFileSync(hookFile, 'utf8') : '';
  const begin = existing.indexOf(HOOK_BEGIN);
  const end = existing.indexOf(HOOK_END);
  if (begin !== -1 && end > begin) existing = existing.slice(0, begin) + existing.slice(end + HOOK_END.length).replace(/^\r?\n/, '');
  existing = existing.replace(LEGACY_HOOK, '');
  if (!existing.startsWith('#!')) existing = `#!/bin/sh\n${existing}`;
  if (!existing.endsWith('\n')) existing += '\n';
  writeFileSync(hookFile, existing + block, 'utf8');
  try { chmodSync(hookFile, 0o755); } catch {}
  console.log(`✅ 已安装记忆联接钩子：${hookFile}（只给登记的正式工位联接）`);
  return true;
}

const USAGE = `用法：
  node scripts/worktree-link.mjs                       给当前工作树挂记忆（仅限登记工位）并安装钩子
  node scripts/worktree-link.mjs --new <路径> <分支>    新建正式工位：建工作树、登记、挂记忆
  node scripts/worktree-link.mjs --register <路径>      把已有工作树登记为正式工位
  node scripts/worktree-link.mjs --unregister <路径>    取消登记（不删工作树，联接需另行断开）
  node scripts/worktree-link.mjs --list                 列出登记的正式工位
  node scripts/worktree-link.mjs --install-hook         只安装/更新钩子`;

function main(args) {
  if (args.includes('--hook')) {
    linkWorktreeMemory(process.cwd());
    return 0;
  }
  const info = resolveGitMainRepo();
  if (!info) { console.error('❌ 未检测到有效的 Git 仓库。'); return 1; }
  const value = (flag, offset = 1) => args[args.indexOf(flag) + offset];
  if (args.includes('--help')) { console.log(USAGE); return 0; }
  if (args.includes('--install-hook')) return installPostCheckoutHook(info.gitCommonDir) ? 0 : 1;
  if (args.includes('--list')) {
    const { worktrees } = readRegistry(info.gitCommonDir);
    if (!worktrees.length) console.log('（还没有登记的正式工位）');
    for (const item of worktrees) console.log(`${item.path}\t${item.branch ?? ''}\t${existsSync(item.path) ? '' : '（目录不存在）'}`);
    return 0;
  }
  if (args.includes('--unregister')) {
    const target = value('--unregister');
    if (!target) { console.error(USAGE); return 2; }
    console.log(unregisterWorktree(info.gitCommonDir, resolve(target)) ? '已取消登记。' : '名单里没有这个工作树。');
    return 0;
  }
  if (args.includes('--register') || args.includes('--new')) {
    installPostCheckoutHook(info.gitCommonDir);
    if (args.includes('--register')) {
      const target = value('--register');
      if (!target) { console.error(USAGE); return 2; }
      return registerWorktree(target) ? 0 : 1;
    }
    const target = value('--new');
    const branch = value('--new', 2);
    if (!target || !branch) { console.error(USAGE); return 2; }
    return createWorkstation(target, branch) ? 0 : 1;
  }
  const linked = linkWorktreeMemory();
  installPostCheckoutHook(info.gitCommonDir);
  return linked || !info.isWorktree ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}
