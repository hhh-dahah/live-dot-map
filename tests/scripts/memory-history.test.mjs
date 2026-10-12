import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/memory-history.mjs', import.meta.url));
const ENV = {
  ...process.env,
  LIVEDOT_HISTORY_NO_POPUP: '1',
  GIT_AUTHOR_NAME: 'livedot-test',
  GIT_AUTHOR_EMAIL: 'livedot-test@example.invalid',
  GIT_COMMITTER_NAME: 'livedot-test',
  GIT_COMMITTER_EMAIL: 'livedot-test@example.invalid',
};

function run(history, ...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args, '--history', history], { encoding: 'utf8', env: ENV });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function gitLog(gitDir) {
  return execFileSync('git', [`--git-dir=${gitDir}`, 'log', '--format=%s'], { encoding: 'utf8', env: ENV }).trim().split('\n').filter(Boolean);
}

function makeMemory(base) {
  const memory = join(base, '记忆 目录', '.live-dot-map');
  for (const [id, name] of [['map-a', '地图甲'], ['map-b', '专利图']]) {
    mkdirSync(join(memory, 'maps', id, 'nodes', 'n1'), { recursive: true });
    mkdirSync(join(memory, 'maps', id, '.bridge'), { recursive: true });
    writeFileSync(join(memory, 'maps', id, 'map.json'), JSON.stringify({ name, revision: 1, nodes: [{ id: 'n1' }] }));
    writeFileSync(join(memory, 'maps', id, 'nodes', 'n1', 'index.md'), `# ${name}\n正文\n`);
    writeFileSync(join(memory, 'maps', id, '.bridge', 'wal.ndjson'), '{}\n');
  }
  for (let i = 0; i < 12; i += 1) writeFileSync(join(memory, 'maps', 'map-a', 'nodes', 'n1', `附件${i}.md`), `内容 ${i}\n`);
  writeFileSync(join(memory, 'active-map'), 'map-a\n');
  return memory;
}

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), 'livedot-history-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const memory = makeMemory(base);
  const history = join(base, '历史库');
  const init = spawnSync(process.execPath, [SCRIPT, 'init', '--work-tree', memory, '--history', history], { encoding: 'utf8', env: ENV });
  assert.equal(init.status, 0, init.stderr);
  return { base, memory, history, gitDir: join(history, 'memory.git') };
}

test('快照：首次全量、没变化不提交、.bridge 不进历史、提交说明列出改动地图', (t) => {
  const { memory, history, gitDir } = setup(t);
  assert.equal(run(history, 'snapshot').code, 0);
  assert.equal(gitLog(gitDir).length, 1);
  const files = execFileSync('git', [`--git-dir=${gitDir}`, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8', env: ENV });
  assert.match(files, /maps\/map-a\/map\.json/);
  assert.doesNotMatch(files, /\.bridge/);

  assert.equal(run(history, 'snapshot').code, 0);
  assert.equal(gitLog(gitDir).length, 1, '没变化不应多一个提交');

  writeFileSync(join(memory, 'maps', 'map-a', 'nodes', 'n1', 'index.md'), '# 地图甲\n改过了\n');
  assert.equal(run(history, 'snapshot').code, 0);
  const message = execFileSync('git', [`--git-dir=${gitDir}`, 'log', '-1', '--format=%B'], { encoding: 'utf8', env: ENV });
  assert.match(message, /修改 1/);
  assert.match(message, /改动地图：地图甲/);
  assert.ok(existsSync(join(memory, 'maps', 'map-a', '.bridge', 'wal.ndjson')), '快照不能动记忆目录');
});

test('误删拦截：记忆整个没了、删掉 map.json、大量删除都不提交，--allow-delete 才放行', (t) => {
  const { memory, history, gitDir } = setup(t);
  assert.equal(run(history, 'snapshot').code, 0);

  rmSync(join(memory, 'maps', 'map-b', 'map.json'));
  let result = run(history, 'snapshot');
  assert.equal(result.code, 2);
  assert.match(result.err, /map\.json/);
  assert.equal(gitLog(gitDir).length, 1);
  assert.match(readFileSync(join(history, '告警.log'), 'utf8'), /误删/);
  result = run(history, 'snapshot', '--allow-delete');
  assert.equal(result.code, 0);
  assert.equal(gitLog(gitDir).length, 2);

  for (let i = 0; i < 12; i += 1) rmSync(join(memory, 'maps', 'map-a', 'nodes', 'n1', `附件${i}.md`));
  assert.equal(run(history, 'snapshot').code, 2, '一次删掉大部分文件要拦下');

  rmSync(memory, { recursive: true, force: true });
  result = run(history, 'snapshot');
  assert.equal(result.code, 2);
  assert.match(result.err, /找不到任何地图/);
  assert.equal(gitLog(gitDir).length, 2);
});

test('恢复：导出到新目录，拒绝覆盖正在用的记忆和非空目录，可按时间点', (t) => {
  const { base, memory, history } = setup(t);
  assert.equal(run(history, 'snapshot').code, 0);
  writeFileSync(join(memory, 'maps', 'map-a', 'nodes', 'n1', 'index.md'), '# 地图甲\n第二版\n');
  assert.equal(run(history, 'snapshot').code, 0);

  assert.notEqual(run(history, 'restore', '--to', memory).code, 0);
  const occupied = join(base, '非空');
  mkdirSync(occupied);
  writeFileSync(join(occupied, 'x.txt'), 'x');
  assert.notEqual(run(history, 'restore', '--to', occupied).code, 0);

  const latest = join(base, '恢复-最新');
  assert.equal(run(history, 'restore', '--to', latest).code, 0);
  assert.match(readFileSync(join(latest, 'maps', 'map-a', 'nodes', 'n1', 'index.md'), 'utf8'), /第二版/);

  const first = execFileSync('git', [`--git-dir=${join(history, 'memory.git')}`, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8', env: ENV }).trim();
  const older = join(base, '恢复-第一版');
  assert.equal(run(history, 'restore', '--to', older, '--at', first).code, 0);
  assert.match(readFileSync(join(older, 'maps', 'map-a', 'nodes', 'n1', 'index.md'), 'utf8'), /正文/);

  writeFileSync(join(memory, 'active-map'), 'map-b\n');
  assert.equal(run(history, 'snapshot').code, 0, '恢复不能弄乱历史库索引，之后照常快照');
  assert.match(execFileSync('git', [`--git-dir=${join(history, 'memory.git')}`, 'log', '-1', '--format=%s'], { encoding: 'utf8', env: ENV }), /修改 1/);
});

test('历史目录不能放在记忆目录里面', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'livedot-history-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const memory = makeMemory(base);
  const result = spawnSync(process.execPath, [SCRIPT, 'init', '--work-tree', memory, '--history', join(memory, 'history')], { encoding: 'utf8', env: ENV });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /不能放在记忆目录里面/);
});

test('GitHub 仓库：排除专利图、发现密钥不提交不推送、清除后推送到远端', (t) => {
  const { base, memory, history } = setup(t);
  const remote = join(base, 'remote.git');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote], { env: ENV });
  assert.equal(run(history, 'remote-init', '--url', remote, '--exclude-map', 'map-b').code, 0);

  const secretFile = join(memory, 'maps', 'map-a', 'nodes', 'n1', '配置.md');
  writeFileSync(secretFile, `token = ghp_${'a'.repeat(36)}\n`);
  assert.equal(run(history, 'snapshot').code, 0);
  assert.match(readFileSync(join(history, '告警.log'), 'utf8'), /配置\.md:1（GitHub 令牌）/);
  assert.doesNotMatch(readFileSync(join(history, '告警.log'), 'utf8'), /a{36}/, '告警里不能写出密钥本身');
  const empty = spawnSync('git', [`--git-dir=${remote}`, 'rev-parse', '--verify', '--quiet', 'main'], { encoding: 'utf8', env: ENV });
  assert.notEqual(empty.status, 0, '有密钥时远端不能收到任何东西');
  assert.equal(gitLog(join(history, 'memory.git')).length, 1, '本地历史照常提交');

  rmSync(secretFile);
  assert.equal(run(history, 'snapshot').code, 0);
  const pushed = execFileSync('git', [`--git-dir=${remote}`, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8', env: ENV });
  assert.match(pushed, /maps\/map-a\/map\.json/);
  assert.doesNotMatch(pushed, /map-b/, '专利图不能推上去');
  assert.doesNotMatch(pushed, /配置\.md/);

  writeFileSync(join(memory, 'maps', 'map-a', 'nodes', 'n1', 'index.md'), '# 地图甲\n远端第二版\n');
  assert.equal(run(history, 'snapshot').code, 0);
  assert.equal(gitLog(remote).length, 2);
  assert.match(run(history, 'status').out, /待推送：0/);
});
