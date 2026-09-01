import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const RUNTIME = join(ROOT, 'livedot.mjs');

function runMcp(project, requests, environment = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [RUNTIME, 'mcp', '--project', project, '--agent', 'codex'], {
      cwd: ROOT,
      windowsHide: true,
      // 薄代理是默认模式；本套件验证的是就地模式的 fail-open 语义，固定走逃生门。
      env: { ...process.env, LIVEDOT_MCP_LOCAL: '1', ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolveRun({ code, signal, stdout, stderr }));
    child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join('\n')}\n`);
  });
}

function runHook(project, event = 'session-start') {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [RUNTIME, 'hook', '--event', event, '--project', project, '--agent', 'codex'], {
      cwd: ROOT,
      windowsHide: true,
      encoding: 'utf8',
    }, (error, stdout = '', stderr = '') => resolveRun({ error, stdout, stderr }));
  });
}

function parseLines(stdout) {
  return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

test('MCP fail-open keeps transport alive and never initializes an empty project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-fail-open-empty-'));
  try {
    const before = await readdir(root);
    const result = await runMcp(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'map_validate', arguments: {} } },
    ]);
    const responses = parseLines(result.stdout);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    assert.equal(responses.length, 3);
    assert.equal(responses[0].result.serverInfo.name, 'live-dot-map');
    assert.ok(responses[1].result.tools.length > 0);
    assert.equal(responses[2].result.isError, true);
    assert.equal(responses[2].result.structuredContent.error.code, 'PROJECT_NOT_INITIALIZED');
    assert.deepEqual(await readdir(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hooks silently succeed in an uninitialized directory without health or logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-fail-open-hook-'));
  try {
    const before = await readdir(root);
    const result = await runHook(root);
    assert.equal(result.error, null);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    assert.deepEqual(await readdir(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a qualified but damaged project reports the real store error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-fail-open-corrupt-'));
  const logs = await mkdtemp(join(tmpdir(), 'livedot-fail-open-logs-'));
  try {
    const mapDirectory = join(root, '.live-dot-map', 'maps', 'default');
    await mkdir(mapDirectory, { recursive: true });
    await writeFile(join(mapDirectory, 'map.json'), '{ not-json', 'utf8');
    const result = await runMcp(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'map_validate', arguments: {} } },
    ], { LIVEDOT_LOG_DIR: logs });
    const response = parseLines(result.stdout)[1];
    assert.equal(result.code, 0);
    assert.equal(response.error.data.code, 'CORRUPT_MAP');
    assert.equal(response.result, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(logs, { recursive: true, force: true });
  }
});

test('read-only empty project layout stays fail-open', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows ACL tests need a non-elevated service account; empty-layout check is covered above');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'livedot-fail-open-readonly-'));
  try {
    await chmod(root, 0o555);
    const result = await runMcp(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'map_validate', arguments: {} } },
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.equal(parseLines(result.stdout)[1].result.isError, true);
  } finally {
    await chmod(root, 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
