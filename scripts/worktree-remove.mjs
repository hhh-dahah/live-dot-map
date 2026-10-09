// 安全移除 git worktree：先断开工作树里的目录联接/软链接，再交给 git。
// git worktree remove 在 Windows 上会穿过 junction 删除目标目录（例如主仓库共享的 .live-dot-map），
// 加不加 --force 都一样。任何一步查不清楚就停下，不删。
import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, linkWorktreeMemory, listWorktrees, resolveGitMainRepo, samePath, unregisterWorktree } from './worktree-link.mjs';

/** 列出目录内所有链接（不进入链接内部）。读不了的目录直接报错，不能当作“没有链接”。 */
export function findLinks(root) {
  const links = [];
  const visit = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (error) {
      throw new Error(`无法检查目录，已停止：${dir}（${error.code ?? error.message}）`);
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      let stat;
      try { stat = lstatSync(full); } catch (error) {
        throw new Error(`无法检查文件，已停止：${full}（${error.code ?? error.message}）`);
      }
      if (stat.isSymbolicLink()) links.push(full);
      else if (stat.isDirectory() && entry.name !== '.git') visit(full);
    }
  };
  visit(root);
  return links;
}

function unlinkOnly(path) {
  // 两种方式都只删链接本身：unlink 删符号链接，非递归 rmdir 删目录联接。
  try { unlinkSync(path); } catch { rmdirSync(path); }
}

export function safeRemoveWorktree(worktreePath, { force = false } = {}) {
  const root = resolve(worktreePath);
  if (!existsSync(root)) throw new Error(`目录不存在：${root}`);
  const info = resolveGitMainRepo(root);
  if (!info) throw new Error(`不是 git 工作树：${root}`);
  if (!samePath(info.worktreeRoot, root)) throw new Error(`请给出工作树的根目录：${info.worktreeRoot}`);
  if (!info.isWorktree) throw new Error(`这是主工作树，不能删除：${root}`);
  const [main, ...others] = listWorktrees(info.mainRepoRoot);
  if (main && samePath(main.path, root)) throw new Error(`这是主工作树，不能删除：${root}`);
  if (!others.some((item) => samePath(item.path, root))) throw new Error(`不是本仓库登记的工作树：${root}`);

  const links = findLinks(root);
  for (const link of links) unlinkOnly(link);
  const left = findLinks(root);
  if (left.length) throw new Error(`仍有链接未断开，已停止：\n${left.join('\n')}`);

  try {
    git(info.mainRepoRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), root]);
  } catch (error) {
    // git 拒绝删除（如有未提交改动）时，把正式工位的记忆联接接回去，免得工位失忆。
    linkWorktreeMemory(root);
    throw error;
  }
  unregisterWorktree(info.gitCommonDir, root);
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
    console.error(error.stderr?.toString().trim() || error.message);
    process.exit(1);
  }
}
