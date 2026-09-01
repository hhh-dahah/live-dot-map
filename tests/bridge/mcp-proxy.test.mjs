import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRouteCommand, temporaryProject } from './helpers.mjs';

const OWNS_TEST_ROOT = !process.env.LIVEDOT_TEST_ROOT;
const TEST_ROOT_DIR = process.env.LIVEDOT_TEST_ROOT || await mkdtemp(join(tmpdir(), 'livedot-mcp-proxy-suite-'));
process.env.LIVEDOT_TEST_ROOT = TEST_ROOT_DIR;
// 本套件的子进程持有 cwd 目录锁，清理必须确定执行：不走 test.after 钩子，
// 全部挂进每个测试体的 try/finally；测试根目录再用进程退出钩子兜底。
process.on('exit', () => {
  if (!OWNS_TEST_ROOT) return;
  try { rmSync(TEST_ROOT_DIR, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
});

const exists = (path) => access(path).then(() => true).catch(() => false);

function createResourceBag() {
  const cleanups = [];
  return {
    cleanups,
    async cleanupAll() {
      for (const cleanup of cleanups.splice(0).reverse()) {
        try { await cleanup(); } catch { /* 清理失败不应掩盖真正的断言错误 */ }
      }
    },
  };
}

/** Windows 上目录锁要等进程真正退出才释放：kill 后轮询确认死亡，再给 rm 留足重试。 */
async function killAndWait(pid, timeoutMs = 8_000) {
  try { process.kill(pid); } catch { return; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((done) => setTimeout(done, 150));
  }
}

async function makeRuntimeDir(bag) {
  const runtime = await mkdtemp(join(TEST_ROOT_DIR, 'runtime-'));
  bag.cleanups.push(async () => {
    // 点火拉起的 serve 是分离子进程，不随 mcp 进程退出，测试结束按 bridge.json 里的 pid 清理。
    try {
      const state = JSON.parse(await readFile(join(runtime, 'bridge.json'), 'utf8'));
      if (state?.pid) await killAndWait(state.pid);
    } catch { /* 未曾点火 */ }
    await rm(runtime, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 });
  });
  return runtime;
}

function startMcp(bag, { cwd, runtimeStateDir, app, extraEnv = {} }) {
  const args = [
    join(process.cwd(), 'livedot.mjs'), 'mcp', '--agent', 'kimi',
    '--runtime-state-dir', runtimeStateDir,
    ...(app ? ['--app', app] : []),
  ];
  const child = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      LIVEDOT_RECENT_PROJECTS_FILE: join(runtimeStateDir, 'recent-test.json'),
      LIVEDOT_CURRENT_PROJECT_FILE: join(runtimeStateDir, 'current-project.json'),
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  bag.cleanups.push(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    // 先关 stdin 让 stdio 循环自然结束；Windows 上进程持有 cwd 目录锁，必须等它真正退出。
    child.stdin.end();
    const exited = new Promise((done) => child.once('exit', done));
    const timer = setTimeout(() => child.kill(), 3_000);
    await Promise.race([exited, new Promise((done) => setTimeout(done, 6_000))]);
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) await killAndWait(child.pid);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const entry = pending.get(message.id);
      if (entry) { pending.delete(message.id); entry(message); }
    }
  });
  const request = (method, params, timeoutMs = 40_000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`mcp ${method} timeout: ${stderr}`)); }, timeoutMs);
    pending.set(id, (message) => { clearTimeout(timeout); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
  });
  return { child, request, stderr: () => stderr };
}

test('mcp proxy ignites the bridge on first tools/call and forwards to it', async (t) => {
  const bag = createResourceBag();
  try {
    const project = await temporaryProject(t);
    bag.cleanups.push(() => rm(project.root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 }));
    const runtime = await makeRuntimeDir(bag);
    const client = startMcp(bag, { cwd: project.root, runtimeStateDir: runtime, app: join(process.cwd(), 'app.html') });

    const init = await client.request('initialize');
    assert.equal(init.result.serverInfo.name, 'live-dot-map');
    assert.equal(await exists(join(runtime, 'bridge.json')), false, 'initialize 不应点火');

    const list = await client.request('tools/list');
    assert.ok(Array.isArray(list.result.tools) && list.result.tools.length > 0);
    assert.equal(await exists(join(runtime, 'bridge.json')), false, 'tools/list 不应点火');

    const call = await client.request('tools/call', { name: 'map_get_context', arguments: {} });
    assert.equal(call.error, undefined, `tools/call 失败: ${JSON.stringify(call.error)}`);
    assert.match(call.result.structuredContent.projectHandle, /^ph_/);
    assert.equal(await exists(join(runtime, 'bridge.json')), true, '首次 tools/call 应已点火桥');
  } finally {
    await bag.cleanupAll();
  }
});

test('mcp proxy fail-open on an uninitialized directory without igniting the bridge', async (t) => {
  const bag = createResourceBag();
  try {
    const empty = await mkdtemp(join(TEST_ROOT_DIR, 'uninitialized-'));
    bag.cleanups.push(() => rm(empty, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 }));
    const runtime = await makeRuntimeDir(bag);
    const client = startMcp(bag, { cwd: empty, runtimeStateDir: runtime });

    const call = await client.request('tools/call', { name: 'map_get_context', arguments: {} });
    assert.equal(call.error, undefined);
    assert.equal(call.result.isError, true);
    assert.equal(call.result.structuredContent.error.code, 'PROJECT_NOT_INITIALIZED');
    assert.equal(await exists(join(runtime, 'bridge.json')), false, 'fail-open 不应点火');
    assert.equal(await exists(join(empty, '.live-dot-map')), false, 'fail-open 不应创建数据目录');
  } finally {
    await bag.cleanupAll();
  }
});

test('mcp proxy follows the canvas current-project pointer across calls', async (t) => {
  const bag = createResourceBag();
  try {
    const first = await temporaryProject(t);
    const second = await temporaryProject(t);
    bag.cleanups.push(() => rm(first.root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 }));
    bag.cleanups.push(() => rm(second.root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 }));
    const runtime = await makeRuntimeDir(bag);
    const client = startMcp(bag, { cwd: first.root, runtimeStateDir: runtime, app: join(process.cwd(), 'app.html') });

    // 第一次调用点火并落在启动项目；随后画布指针切到第二个项目，下一次调用必须跟随。
    const warm = await client.request('tools/call', { name: 'map_get_context', arguments: {} });
    assert.equal(warm.error, undefined, `预热调用失败: ${JSON.stringify(warm.error)}`);
    await writeFile(join(runtime, 'current-project.json'), `${JSON.stringify({ projectRoot: second.root })}\n`);

    const write = await client.request('tools/call', {
      name: 'map_apply_commands',
      arguments: { commandId: 'proxy-follow-pointer', baseRevision: 0, commands: [createRouteCommand('r9', '跟随测试')] },
    });
    assert.equal(write.error, undefined, `写入失败: ${JSON.stringify(write.error)}`);
    const secondDocument = JSON.parse(await readFile(join(second.root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
    assert.equal(secondDocument.routes[0]?.id, 'r9');
    assert.equal(secondDocument.routes[0]?.createdBy, 'agent:kimi');
    // 预热调用已让桥打开启动项目并完成多地图迁移，落盘在 maps/default/map.json。
    const firstDocument = JSON.parse(await readFile(join(first.root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
    assert.equal(firstDocument.routes.some((route) => route.id === 'r9'), false, '写入不应落在启动项目');
  } finally {
    await bag.cleanupAll();
  }
});

test('mcp proxy reports a structured error with restart guidance when ignition fails', async (t) => {
  const bag = createResourceBag();
  try {
    const project = await temporaryProject(t);
    bag.cleanups.push(() => rm(project.root, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 }));
    const runtime = await makeRuntimeDir(bag);
    // --app 指向一个目录：access(F_OK) 通过，但 serve 启动读文件失败，桥永远不就绪。
    const client = startMcp(bag, {
      cwd: project.root,
      runtimeStateDir: runtime,
      app: runtime,
      extraEnv: { LIVEDOT_MCP_IGNITE_TIMEOUT_MS: '3000' },
    });

    const call = await client.request('tools/call', { name: 'map_get_context', arguments: {} });
    assert.ok(call.error, '点火失败应返回 JSON-RPC error');
    assert.equal(call.error.data?.code, 'BRIDGE_UNAVAILABLE');
    assert.match(call.error.message, /双击桌面/);
  } finally {
    await bag.cleanupAll();
  }
});
