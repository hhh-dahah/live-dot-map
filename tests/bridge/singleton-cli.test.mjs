import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { temporaryProject } from './helpers.mjs';

function firstJsonLine(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`serve output timeout: ${stderr}`)), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      try { resolve(JSON.parse(stdout.slice(0, newline))); } catch (error) { reject(error); }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!stdout.includes('\n')) {
        clearTimeout(timeout);
        reject(new Error(`serve exited ${code}: ${stderr}`));
      }
    });
  });
}

function startServe(projectRoot, runtimeStateDir) {
  return spawn(process.execPath, [
    join(process.cwd(), 'livedot.mjs'),
    'serve', '--project', projectRoot,
    '--app', join(process.cwd(), 'app.html'),
    '--runtime-state-dir', runtimeStateDir,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, LIVEDOT_RECENT_PROJECTS_FILE: join(runtimeStateDir, 'recent-test.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

test('two serve launchers reuse one pid and one stable origin', async (test) => {
  const firstProject = await temporaryProject(test);
  const secondProject = await temporaryProject(test);
  const runtime = await mkdtemp(join(tmpdir(), 'livedot-singleton-'));
  const first = startServe(firstProject.root, runtime);
  let restarted = null;
  test.after(async () => {
    if (!first.killed) first.kill();
    if (restarted && !restarted.killed) restarted.kill();
    await rm(runtime, { recursive: true, force: true });
  });

  const firstResult = await firstJsonLine(first);
  assert.equal(firstResult.reused, false);
  assert.equal(firstResult.pid, first.pid);
  assert.equal(String(firstResult.url).includes(firstProject.root), false);

  const second = startServe(secondProject.root, runtime);
  const secondResult = await firstJsonLine(second);
  const exitCode = await new Promise((resolve) => second.once('exit', resolve));
  assert.equal(exitCode, 0);
  assert.equal(secondResult.reused, true);
  assert.equal(secondResult.pid, firstResult.pid);
  assert.equal(secondResult.origin, firstResult.origin);
  assert.notEqual(secondResult.projectHandle, firstResult.projectHandle);
  assert.equal(String(secondResult.url).includes(secondProject.root), false);

  const bootstrap = new URL(firstResult.url).searchParams.get('token');
  const exchange = await fetch(`${firstResult.origin}/api/v1/session`, {
    method: 'POST',
    headers: { Origin: firstResult.origin, Authorization: `Bearer ${bootstrap}` },
  });
  assert.equal(exchange.status, 201);
  const session = await exchange.json();
  const cookie = exchange.headers.get('set-cookie').split(';', 1)[0];
  first.kill();
  await new Promise((resolve) => first.once('exit', resolve));

  restarted = startServe(firstProject.root, runtime);
  const restartedResult = await firstJsonLine(restarted);
  assert.equal(restartedResult.origin, firstResult.origin);
  const resumed = await fetch(`${restartedResult.origin}/api/v1/session`, { headers: { Cookie: cookie } });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).csrfToken, session.csrfToken);
});

// —— 裸 serve 的脏树自动隔离（防测试代码顶替常驻桥）——

function gitIn(projectRoot, args) {
  execFileSync('git', ['-C', projectRoot, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'livedot-test',
      GIT_AUTHOR_EMAIL: 'livedot-test@example.invalid',
      GIT_COMMITTER_NAME: 'livedot-test',
      GIT_COMMITTER_EMAIL: 'livedot-test@example.invalid',
    },
  });
}

// 裸 serve：不带 --runtime-state-dir；用 LIVEDOT_RUNTIME_STATE_DIR 把"默认状态目录"指到临时目录，
// 以便断言脏树时默认目录不被写入、隔离目录被使用；净树时相反。
function bareServe(projectRoot, fakeDefaultDir) {
  return spawn(process.execPath, [
    join(process.cwd(), 'livedot.mjs'),
    'serve', '--project', projectRoot,
    '--app', join(process.cwd(), 'app.html'),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, LIVEDOT_RUNTIME_STATE_DIR: fakeDefaultDir, LIVEDOT_RECENT_PROJECTS_FILE: join(fakeDefaultDir, 'recent-test.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

test('dirty git worktree bare serve isolates into .live-dot-map-dev and leaves default state untouched', async (test) => {
  const project = await temporaryProject(test);
  const fakeDefault = await mkdtemp(join(tmpdir(), 'livedot-dirty-default-'));
  gitIn(project.root, ['init']);
  await writeFile(join(project.root, 'tracked.txt'), 'base', 'utf8');
  gitIn(project.root, ['add', 'tracked.txt']);
  gitIn(project.root, ['commit', '-m', 'init']);
  await writeFile(join(project.root, 'tracked.txt'), 'modified', 'utf8');
  const child = bareServe(project.root, fakeDefault);
  test.after(async () => {
    if (!child.killed) child.kill();
    await rm(fakeDefault, { recursive: true, force: true });
  });
  const result = await firstJsonLine(child);
  assert.equal(result.reused, false);
  assert.ok(existsSync(join(project.root, '.live-dot-map-dev', 'bridge.json')), '脏树应自动使用隔离状态目录');
  assert.equal(existsSync(join(fakeDefault, 'bridge.json')), false, '脏树不得写入默认（生产）状态目录');
});

test('clean git worktree bare serve keeps default runtime state and ignores untracked files', async (test) => {
  const project = await temporaryProject(test);
  const fakeDefault = await mkdtemp(join(tmpdir(), 'livedot-clean-default-'));
  gitIn(project.root, ['init']);
  await writeFile(join(project.root, 'tracked.txt'), 'base', 'utf8');
  await writeFile(join(project.root, 'untracked.txt'), 'noise', 'utf8');
  gitIn(project.root, ['add', 'tracked.txt']);
  gitIn(project.root, ['commit', '-m', 'init']);
  const child = bareServe(project.root, fakeDefault);
  test.after(async () => {
    if (!child.killed) child.kill();
    await rm(fakeDefault, { recursive: true, force: true });
  });
  const result = await firstJsonLine(child);
  assert.equal(result.reused, false);
  assert.ok(existsSync(join(fakeDefault, 'bridge.json')), '净树应继续使用默认状态目录（保护点火/恢复路径）');
  assert.equal(existsSync(join(project.root, '.live-dot-map-dev')), false, '净树不应产生隔离目录');
});
