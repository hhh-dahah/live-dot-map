import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { createLogger } from '../../src/bridge/logger.mjs';
import { createBridgeServer } from '../../src/bridge/server.mjs';
import { temporaryProject } from './helpers.mjs';

const TEST_ROOT_DIR = process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test';
process.env.LIVEDOT_RECENT_PROJECTS_FILE = join(TEST_ROOT_DIR, 'recent-projects-logger-test.json');

const APP_ORIGIN = 'https://app.example.test';

async function temporaryLogDir(test) {
  await mkdir(TEST_ROOT_DIR, { recursive: true });
  const dir = await mkdtemp(join(TEST_ROOT_DIR, 'live-dot-map-log-test-'));
  test.after(() => rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  return dir;
}

async function readLogLines(dir) {
  const files = (await readdir(dir)).filter((name) => /^livedot-.*\.log$/.test(name));
  assert.ok(files.length > 0, '日志文件应已创建');
  const text = await readFile(join(dir, files[0]), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

test('logger 写 JSON 行并按天命名；错误对象被压缩为可读字段', async (t) => {
  const dir = await temporaryLogDir(t);
  const logger = createLogger({ source: 'bridge', dir, clock: () => new Date('2026-08-16T08:00:00.000Z') });
  await logger.info('bridge.start', { project: 'D:/demo' });
  await logger.error('save.failed', { error: Object.assign(new Error('磁盘被占用'), { code: 'EBUSY' }) });
  await logger.flush();

  const files = await readdir(dir);
  assert.deepEqual(files, ['livedot-2026-08-16.log']);
  const [first, second] = await readLogLines(dir);
  assert.equal(first.at, '2026-08-16T08:00:00.000Z');
  assert.equal(first.level, 'info');
  assert.equal(first.source, 'bridge');
  assert.equal(first.event, 'bridge.start');
  assert.equal(first.project, 'D:/demo');
  assert.equal(second.level, 'error');
  assert.equal(second.error.code, 'EBUSY');
  assert.equal(second.error.message, '磁盘被占用');
});

test('logger.as 派生来源共享同一文件与时间线', async (t) => {
  const dir = await temporaryLogDir(t);
  const logger = createLogger({ source: 'bridge', dir });
  await logger.info('project.open', { root: 'D:/demo' });
  await logger.as('client').info('save.flush', { commands: 3 });
  await logger.flush();

  const lines = await readLogLines(dir);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.source), ['bridge', 'client']);
  assert.equal(lines[1].event, 'save.flush');
});

test('/logs/client 接收画布日志并写入桥日志文件', async (t) => {
  const dir = await temporaryLogDir(t);
  const logger = createLogger({ source: 'bridge', dir });
  const project = await temporaryProject(t);
  const server = await createBridgeServer({
    allowedProjectRoots: [project.root],
    allowedOrigins: [APP_ORIGIN],
    shared: project.shared,
    logger,
  });
  t.after(() => server.close());

  const exchange = await fetch(`${server.origin}/session`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${server.bootstrapToken}` },
  });
  assert.equal(exchange.status, 201);
  const cookie = exchange.headers.get('set-cookie').split(';', 1)[0];
  const { csrfToken } = await exchange.json();

  const response = await fetch(`${server.origin}/api/v1/logs/client`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entries: [
        { at: '2026-08-16T08:01:00.000Z', level: 'info', event: 'client.init', revision: 7 },
        { at: '2026-08-16T08:01:02.000Z', level: 'error', event: 'window.error', message: 'x is not defined' },
        { level: 'info' }, // 缺 event，应被拒绝
        { level: 'bogus', event: 'weird' }, // 非法级别应降级为 info
      ],
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.accepted, 3);
  await logger.flush();

  const lines = await readLogLines(dir);
  const clientLines = lines.filter((line) => line.source === 'client');
  assert.equal(clientLines.length, 3);
  assert.equal(clientLines[0].event, 'client.init');
  assert.equal(clientLines[0].clientAt, '2026-08-16T08:01:00.000Z');
  assert.equal(clientLines[0].revision, 7);
  assert.equal(clientLines[1].level, 'error');
  assert.equal(clientLines[2].level, 'info');
  assert.equal(clientLines[2].event, 'weird');

  // 桥自身的 http 请求日志也在同一文件里（含 session 与 logs/client 两条 POST）。
  const httpLines = lines.filter((line) => line.event === 'http');
  assert.ok(httpLines.length >= 2);
  assert.ok(httpLines.every((line) => !String(line.path).includes('token=')), '日志不得记录 URL 查询串');
});

test('/logs/client 拒绝未认证与缺 CSRF 的写入', async (t) => {
  const dir = await temporaryLogDir(t);
  const project = await temporaryProject(t);
  const server = await createBridgeServer({
    allowedProjectRoots: [project.root],
    allowedOrigins: [APP_ORIGIN],
    shared: project.shared,
    logger: createLogger({ source: 'bridge', dir }),
  });
  t.after(() => server.close());

  const anonymous = await fetch(`${server.origin}/api/v1/logs/client`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ event: 'x' }] }),
  });
  assert.equal(anonymous.status, 401);
});
