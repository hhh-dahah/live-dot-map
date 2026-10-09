import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkstation,
  installPostCheckoutHook,
  readRegistry,
  registerWorktree,
} from '../../scripts/worktree-link.mjs';
import { findLinks, safeRemoveWorktree } from '../../scripts/worktree-remove.mjs';

function gitIn(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'livedot-test',
      GIT_AUTHOR_EMAIL: 'livedot-test@example.invalid',
      GIT_COMMITTER_NAME: 'livedot-test',
      GIT_COMMITTER_EMAIL: 'livedot-test@example.invalid',
    },
  });
}

const isLink = (path) => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), 'livedot-wt-guard-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
  const main = join(base, 'main');
  mkdirSync(join(main, '.live-dot-map', 'maps'), { recursive: true });
  const precious = join(main, '.live-dot-map', 'maps', 'keep.md');
  writeFileSync(precious, '真实记忆');
  writeFileSync(join(main, '.gitignore'), '.live-dot-map/\n');
  writeFileSync(join(main, 'a.txt'), 'x');
  gitIn(main, ['init', '-q']);
  gitIn(main, ['add', '.']);
  gitIn(main, ['commit', '-qm', 'init']);
  const gitCommonDir = join(main, '.git');
  return { base, main, precious, gitCommonDir };
}

test('钩子不给未登记的临时工作树联接真实记忆，安全删除后记忆完好', (t) => {
  const { base, main, precious, gitCommonDir } = setup(t);
  installPostCheckoutHook(gitCommonDir);
  const temp = join(base, 'temp');
  gitIn(main, ['worktree', 'add', '-q', '-b', 'temp', temp]);
  assert.equal(existsSync(join(temp, '.live-dot-map')), false);
  safeRemoveWorktree(temp);
  assert.equal(existsSync(temp), false);
  assert.equal(readFileSync(precious, 'utf8'), '真实记忆');
});

test('钩子确实会运行：名单里已有的路径用普通 git worktree add 也会联接', (t) => {
  const { base, main, gitCommonDir } = setup(t);
  installPostCheckoutHook(gitCommonDir);
  const ws = join(base, 'ws');
  writeFileSync(join(gitCommonDir, 'livedot-工位名单.json'), JSON.stringify({ version: 1, worktrees: [{ path: ws }] }));
  gitIn(main, ['worktree', 'add', '-q', '-b', 'ws', ws]);
  assert.equal(isLink(join(ws, '.live-dot-map')), true);
});

test('--new 建的正式工位会登记并联接真实记忆；安全删除只断联接、取消登记', (t) => {
  const { base, main, precious, gitCommonDir } = setup(t);
  installPostCheckoutHook(gitCommonDir);
  const ws = join(base, 'ws');
  assert.equal(createWorkstation(ws, 'ws-branch', main), true);
  assert.equal(isLink(join(ws, '.live-dot-map')), true);
  assert.equal(readFileSync(join(ws, '.live-dot-map', 'maps', 'keep.md'), 'utf8'), '真实记忆');
  assert.equal(readRegistry(gitCommonDir).worktrees.length, 1);

  const links = safeRemoveWorktree(ws);
  assert.equal(links.length, 1);
  assert.equal(existsSync(ws), false);
  assert.equal(readFileSync(precious, 'utf8'), '真实记忆');
  assert.equal(readRegistry(gitCommonDir).worktrees.length, 0);
});

test('已有工作树可以补登记；git 拒绝删除时把联接接回去', (t) => {
  const { base, main, precious, gitCommonDir } = setup(t);
  const ws = join(base, 'ws');
  gitIn(main, ['worktree', 'add', '-q', '-b', 'ws', ws]);
  assert.equal(registerWorktree(ws), true);
  assert.equal(isLink(join(ws, '.live-dot-map')), true);

  writeFileSync(join(ws, 'a.txt'), '未提交改动');
  assert.throws(() => safeRemoveWorktree(ws));
  assert.equal(existsSync(ws), true);
  assert.equal(isLink(join(ws, '.live-dot-map')), true);
  assert.equal(readFileSync(precious, 'utf8'), '真实记忆');
  assert.equal(readRegistry(gitCommonDir).worktrees.length, 1);
});

test('安全删除拒绝主工作树、非工作树目录和子目录', (t) => {
  const { base, main } = setup(t);
  const plain = join(base, 'plain');
  mkdirSync(plain);
  assert.throws(() => safeRemoveWorktree(main), /主工作树/);
  assert.throws(() => safeRemoveWorktree(plain), /不是 git 工作树/);
  const ws = join(base, 'ws');
  gitIn(main, ['worktree', 'add', '-q', '-b', 'ws', ws]);
  mkdirSync(join(ws, 'sub'));
  assert.throws(() => safeRemoveWorktree(join(ws, 'sub')), /根目录/);
  assert.equal(existsSync(ws), true);
});

test('链接检查查不了就报错，不当作没有链接', (t) => {
  const { base } = setup(t);
  assert.throws(() => findLinks(join(base, '不存在的目录')), /无法检查目录/);
});

test('安装钩子会替换旧版无条件联接块，重复安装不叠加', (t) => {
  const { gitCommonDir } = setup(t);
  const hookFile = join(gitCommonDir, 'hooks', 'post-checkout');
  mkdirSync(join(gitCommonDir, 'hooks'), { recursive: true });
  writeFileSync(hookFile, `#!/bin/sh
echo other
# 活点地图：新开 worktree 自动共享记忆钩子
if [ -f .git ] && [ ! -e .live-dot-map ]; then
  if [ -f "scripts/worktree-link.mjs" ]; then
    node scripts/worktree-link.mjs || true
  fi
fi
`);
  installPostCheckoutHook(gitCommonDir);
  installPostCheckoutHook(gitCommonDir);
  const hook = readFileSync(hookFile, 'utf8');
  assert.match(hook, /echo other/);
  assert.doesNotMatch(hook, /node scripts\/worktree-link\.mjs/);
  assert.equal(hook.split('livedot-worktree-link.mjs" --hook').length - 1, 1);
  assert.equal(existsSync(join(gitCommonDir, 'hooks', 'livedot-worktree-link.mjs')), true);
});
