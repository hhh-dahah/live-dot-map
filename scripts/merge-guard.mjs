#!/usr/bin/env node
// 工位合并闸门：只在主工位（master）运行，合并任何工位分支前必须先通过本脚本。
// 用法: node scripts/merge-guard.mjs <分支> [--full]
//   --full  用全量 verify（含 Windows 安装器构建，较慢）代替默认的单元测试
// 退出码: 0=快速通道，可合并；2=存在碰撞文件，需慢速通道；1=前置条件不满足或测试失败
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...options }).trim();
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const full = argv.includes('--full');
const branch = argv.find((value) => !value.startsWith('--'));
if (!branch) {
  console.log('用法: node scripts/merge-guard.mjs <分支> [--full]\n示例: node scripts/merge-guard.mjs feat-agent-adapter');
  process.exit(1);
}

// ---- 前置检查：主工位必须在 master 且工作区干净 ----
const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (current !== 'master') fail(`闸门只能在主工位 master 上运行（当前分支: ${current}）`);
const dirty = git(['status', '--porcelain=v1', '--untracked-files=no']);
if (dirty) fail(`主工位存在未提交改动，先处理再过闸门：\n${dirty}`);
const branches = git(['branch', '--format=%(refname:short)']).split('\n').map((value) => value.trim());
if (!branches.includes(branch)) fail(`分支不存在: ${branch}`);

// 目标分支所在工作树必须收尾干净（上次任务未收尾时拒绝合并，防止丢工作）
const blocks = [];
let block = {};
for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
  if (!line) { if (Object.keys(block).length) blocks.push(block); block = {}; continue; }
  const space = line.indexOf(' ');
  block[line.slice(0, space)] = line.slice(space + 1);
}
if (Object.keys(block).length) blocks.push(block);
const worktreeEntry = blocks.find((entry) => entry.branch === `refs/heads/${branch}`);
if (worktreeEntry) {
  const worktreeDirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: worktreeEntry.worktree, encoding: 'utf8' }).trim();
  if (worktreeDirty) fail(`工位 ${worktreeEntry.worktree} 有未提交改动（上次任务未收尾）：\n${worktreeDirty}`);
}

// ---- 碰撞检测：本分支改动 ∩ master 自分叉以来改动 ----
const base = git(['merge-base', 'master', branch]);
const branchFiles = git(['diff', '--name-only', `${base}..${branch}`]).split('\n').filter(Boolean);
const masterFiles = git(['diff', '--name-only', `${base}..master`]).split('\n').filter(Boolean);
const hot = branchFiles.filter((file) => masterFiles.includes(file));
const behind = git(['rev-list', '--count', `${branch}..master`]);
const ahead = git(['rev-list', '--count', `master..${branch}`]);

console.log(`分支 ${branch}: 领先 master ${ahead} 个提交 / 落后 ${behind} 个`);
console.log(`分叉点以来：本分支改动 ${branchFiles.length} 个文件，master 改动 ${masterFiles.length} 个文件`);

if (hot.length > 0) {
  console.error(`\n✖ 碰撞文件 ${hot.length} 个（两边都改过，合并必起冲突，走慢速通道）：`);
  for (const file of hot) console.error(`  · ${file}`);
  console.error('慢速通道：让该工位执行 git rebase master 逐块解冲突（app.html 冲突 = 合并源码后 npm run build:app 重建），完成后重新过闸门。');
  process.exit(2);
}

// ---- 测试：碰撞为空才跑（有碰撞时先变基，跑了也要重跑） ----
console.log(`\n[merge-guard] 无碰撞文件，运行 ${full ? 'npm run verify（全量）' : 'npm test（单元）'} ...`);
const npmArgs = full ? ['run', 'verify'] : ['test'];
const test = spawnSync(
  process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm',
  process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${npmArgs.join(' ')}`] : npmArgs,
  { cwd: ROOT, stdio: 'inherit', shell: false },
);
if (test.status !== 0) fail('测试未通过，禁止合并');

console.log('\n✔ 快速通道：无碰撞、测试通过，可以合并：');
console.log(`  git merge --no-ff ${branch} -m "Merge branch '${branch}' via merge-guard"`);
console.log('合并后提醒该工位：下次开工第 0 步自动 reset 对齐 master。');
