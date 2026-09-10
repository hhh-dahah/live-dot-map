import { execSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 解析 Git 主仓库物理路径与 .git 目录
 */
export function resolveGitMainRepo(startDir = process.cwd()) {
  let current = resolve(startDir);
  const gitPath = join(current, '.git');
  
  if (!existsSync(gitPath)) {
    const parent = dirname(current);
    if (parent && parent !== current) {
      return resolveGitMainRepo(parent);
    }
    return null;
  }

  const stat = lstatSync(gitPath);
  if (stat.isDirectory()) {
    return {
      isWorktree: false,
      worktreeRoot: current,
      mainRepoRoot: current,
      gitCommonDir: gitPath,
    };
  }

  const content = readFileSync(gitPath, 'utf8').trim();
  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (!match) return null;

  const gitdir = resolve(current, match[1]);
  const worktreesIndex = gitdir.replace(/\\/g, '/').lastIndexOf('/.git/worktrees/');
  if (worktreesIndex === -1) {
    try {
      const common = execSync('git rev-parse --git-common-dir', { cwd: current, encoding: 'utf8' }).trim();
      const mainGit = resolve(current, common);
      return {
        isWorktree: true,
        worktreeRoot: current,
        mainRepoRoot: dirname(mainGit),
        gitCommonDir: mainGit,
      };
    } catch {
      return null;
    }
  }

  const mainGitDir = gitdir.slice(0, worktreesIndex + 5);
  const mainRepoRoot = dirname(mainGitDir);

  return {
    isWorktree: true,
    worktreeRoot: current,
    mainRepoRoot,
    gitCommonDir: mainGitDir,
  };
}

/**
 * 为当前工作树挂载主仓库的 .live-dot-map 目录联接（Junction）
 */
export function linkWorktreeMemory(targetDir = process.cwd()) {
  const info = resolveGitMainRepo(targetDir);
  if (!info) {
    console.error('❌ 未检测到有效的 Git 仓库或工作树环境。');
    return false;
  }

  const mainMemory = join(info.mainRepoRoot, '.live-dot-map');
  if (!existsSync(mainMemory)) {
    console.error(`❌ 主仓库未找到记忆源目录: ${mainMemory}`);
    return false;
  }

  if (!info.isWorktree) {
    console.log(`ℹ️ 当前目录为主工作树 (${info.worktreeRoot})，无需链接。`);
    return true;
  }

  const linkTarget = join(info.worktreeRoot, '.live-dot-map');
  if (existsSync(linkTarget)) {
    const stat = lstatSync(linkTarget);
    if (stat.isSymbolicLink()) {
      console.log(`✅ 已存在目录联接: ${linkTarget} -> ${mainMemory}`);
      return true;
    }
    console.warn(`⚠️ 目标已存在但非软链接，请先确认并清理旧目录: ${linkTarget}`);
    return false;
  }

  try {
    if (process.platform === 'win32') {
      execSync(`cmd /c mklink /J "${linkTarget}" "${mainMemory}"`, { stdio: 'inherit' });
    } else {
      execSync(`ln -s "${mainMemory}" "${linkTarget}"`, { stdio: 'inherit' });
    }
    console.log(`🎉 成功建立记忆共享联接: ${info.worktreeRoot} => ${mainMemory}`);
    return true;
  } catch (error) {
    console.error(`❌ 创建目录联接失败:`, error.message);
    return false;
  }
}

/**
 * 安装 Git post-checkout 自动挂载钩子
 */
export function installPostCheckoutHook(gitCommonDir) {
  const hooksDir = join(gitCommonDir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const hookFile = join(hooksDir, 'post-checkout');

  const hookScript = `#!/bin/sh
# 活点地图：新开 worktree 自动共享记忆钩子
if [ -f .git ] && [ ! -e .live-dot-map ]; then
  if [ -f "scripts/worktree-link.mjs" ]; then
    node scripts/worktree-link.mjs || true
  fi
fi
`;

  let existing = '';
  if (existsSync(hookFile)) {
    existing = readFileSync(hookFile, 'utf8');
    if (existing.includes('scripts/worktree-link.mjs')) {
      console.log('✅ Git post-checkout 钩子已就绪。');
      return true;
    }
  }

  writeFileSync(hookFile, (existing ? existing + '\n' : '') + hookScript, 'utf8');
  try { chmodSync(hookFile, 0o755); } catch {}
  console.log(`✅ 已在 ${hookFile} 中注册自动记忆挂载钩子。`);
  return true;
}

// CLI 执行入口
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const info = resolveGitMainRepo();

  if (args.includes('--install-hook') && info) {
    installPostCheckoutHook(info.gitCommonDir);
  } else {
    linkWorktreeMemory();
    if (info?.gitCommonDir) {
      installPostCheckoutHook(info.gitCommonDir);
    }
  }
}
