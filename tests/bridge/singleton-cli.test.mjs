import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
