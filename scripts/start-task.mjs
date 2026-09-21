#!/usr/bin/env node
// 工位开工三查：①工作区干净 ②无未合并进 master 的独有提交 ③对齐 master。
// 任何一查不过即拒绝并说明原因——这是铁律，不是建议。主工位（master）直通。
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const head = git(['rev-parse', '--short', 'HEAD']);
if (branch === 'HEAD') fail('处于游离 HEAD 状态，请先检出本工位分支再开工。');

// 查①：工作区必须干净（未提交 = 上单未收尾）
const dirty = git(['status', '--porcelain=v1', '--untracked-files=no']);
if (dirty) {
  fail(`上单未收尾（工作区有未提交改动）：\n${dirty}\n→ 先完成提交，或报告主工位处理，再开工。`);
}

// 主工位：无需对齐，打印身份直通
if (branch === 'master') {
  console.log(`✔ 主工位 ${ROOT}（master @ ${head}）——身份确认，直接开工。`);
  process.exit(0);
}

// 查②：不得有未合并进 master 的独有提交（此时 reset 会把它们从分支上丢弃）
const ahead = Number(git(['rev-list', '--count', 'master..HEAD']));
if (ahead > 0) {
  fail([
    `分支 ${branch} 有 ${ahead} 个未合并进 master 的独有提交（上单待合并）。`,
    '→ 到主工位说「合 ' + branch + '」，合并完成后重新跑 npm run start-task。',
    '→ 仅当用户明确确认废弃这些提交时，才允许手工执行 git reset --hard master。',
  ].join('\n'));
}

// 查③：对齐 master 开工
git(['reset', '--hard', 'master']);
console.log(`✔ 工位身份：${ROOT}（分支 ${branch}）`);
console.log(`✔ 已对齐 master（${git(['rev-parse', '--short', 'HEAD'])}），开工。`);
