// 安全移除 git worktree：先断开工作树里的目录联接/软链接，再交给 git。
// git worktree remove 在 Windows 上会穿过 junction 删除目标目录（例如主仓库共享的 .live-dot-map）。
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findLinks(root) {
  const links = [];
  const visit = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.name === '.git') continue;
      if (lstatSync(full).isSymbolicLink()) links.push(full);
      else if (entry.isDirectory()) visit(full);
    }
  };
  visit(root);
  return links;
}

function unlinkOnly(path) {
  try { unlinkSync(path); } catch { rmdirSync(path); }
}

export function safeRemoveWorktree(worktreePath, { force = false, git = 'git' } = {}) {
  const root = resolve(worktreePath);
  if (!existsSync(join(root, '.git')) || lstatSync(join(root, '.git')).isDirectory()) {
    throw new Error(`不是附属工作树（缺少 .git 文件）：${root}`);
  }
  const links = findLinks(root);
  for (const link of links) unlinkOnly(link);
  const left = findLinks(root);
  if (left.length) throw new Error(`仍有链接未断开，已停止：\n${left.join('\n')}`);
  execFileSync(git, ['worktree', 'remove', ...(force ? ['--force'] : []), root], { stdio: 'inherit' });
  return links;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('用法：node scripts/worktree-remove.mjs <工作树路径> [--force]');
    process.exit(2);
  }
  try {
    const links = safeRemoveWorktree(target, { force: args.includes('--force') });
    for (const link of links) console.log(`已断开链接（目标未动）：${link}`);
    console.log(`已移除工作树：${resolve(target)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
