import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import test, { after } from 'node:test';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createBridgeServer, ensureProjectAgentConfig, buildPickFolderScript } from '../../src/bridge/server.mjs';
import { ProjectStore } from '../../src/bridge/project-store.mjs';
import { MapManager } from '../../src/bridge/map-manager.mjs';
import { commandEnvelope, createRouteCommand, temporaryProject } from './helpers.mjs';

const OWNS_TEST_ROOT = !process.env.LIVEDOT_TEST_ROOT;
const TEST_ROOT_DIR = process.env.LIVEDOT_TEST_ROOT || await mkdtemp(join(tmpdir(), 'livedot-server-suite-'));
process.env.LIVEDOT_TEST_ROOT = TEST_ROOT_DIR;
after(() => OWNS_TEST_ROOT ? rm(TEST_ROOT_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }) : undefined);

// 隔离最近项目记录：server.mjs 的 RECENT_PROJECTS_FILE 每次读取该 env，
// 测试进程独立于用户环境，避免把临时项目写进真实 ~/.live-dot-map。
process.env.LIVEDOT_RECENT_PROJECTS_FILE = join(TEST_ROOT_DIR, 'recent-projects-server-test.json');

const APP_ORIGIN = 'https://app.example.test';

async function json(response) {
  const value = await response.json();
  return { response, value };
}

async function startServer(test, options = {}) {
  const project = await temporaryProject(test);
  const recent = [];
  const server = await createBridgeServer({
    allowedProjectRoots: [project.root],
    allowedOrigins: [APP_ORIGIN],
    shared: project.shared,
    recentProjectsStore: {
      async record(root) { const index = recent.indexOf(root); if (index >= 0) recent.splice(index, 1); recent.unshift(root); },
      async list() { return [...recent]; },
    },
    ...options,
  });
  test.after(() => server.close());
  return { ...project, server };
}

test('bridge can bind a persisted port and refuses to silently move when it is occupied', async (test) => {
  const first = await startServer(test);
  assert.ok(first.server.port > 0);

  const secondProject = await temporaryProject(test);
  await assert.rejects(
    createBridgeServer({
      allowedProjectRoots: [secondProject.root],
      allowedOrigins: [APP_ORIGIN],
      shared: secondProject.shared,
      listenPort: first.server.port,
    }),
    (error) => error?.code === 'EADDRINUSE',
  );
});

test('bridge rejects invalid persisted ports before opening a socket', async (test) => {
  const project = await temporaryProject(test);
  await assert.rejects(
    createBridgeServer({ allowedProjectRoots: [project.root], shared: project.shared, listenPort: 70_000 }),
    (error) => error?.code === 'INVALID_LISTEN_PORT',
  );
});

test('authenticated control channel issues a fresh project-bound bootstrap ticket', async (test) => {
  const controlToken = 'control-token-for-test';
  const project = await temporaryProject(test);
  const server = await createBridgeServer({
    allowedProjectRoots: [project.root],
    allowedOrigins: [APP_ORIGIN],
    shared: project.shared,
    controlToken,
  });
  test.after(() => server.close());

  const denied = await fetch(`${server.origin}/api/v1/control/status`);
  assert.equal(denied.status, 401);
  const status = await fetch(`${server.origin}/api/v1/control/status`, { headers: { 'X-LiveDot-Control': controlToken } });
  assert.equal(status.status, 200);

  const issued = await fetch(`${server.origin}/api/v1/control/open-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-LiveDot-Control': controlToken },
    body: JSON.stringify({ projectRoot: project.root }),
  });
  assert.equal(issued.status, 201);
  const { bootstrapToken } = await issued.json();
  assert.ok(bootstrapToken);

  const exchange = await fetch(`${server.origin}/api/v1/session`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${bootstrapToken}` },
  });
  assert.equal(exchange.status, 201);
  assert.equal((await exchange.json()).projectRoot, project.root);
  const replay = await fetch(`${server.origin}/api/v1/session`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${bootstrapToken}` },
  });
  assert.equal(replay.status, 401);
});

test('one cookie session can authorize two project handles without rotating csrf', async (test) => {
  const controlToken = 'shared-browser-control';
  const first = await temporaryProject(test);
  const second = await temporaryProject(test);
  const entries = new Map([
    ['ph_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', first.root],
    ['ph_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', second.root],
  ]);
  const projectRegistry = {
    resolve(handle) {
      const projectRoot = entries.get(handle);
      if (!projectRoot) throw new Error('unknown handle');
      return { projectHandle: handle, projectRoot };
    },
  };
  const server = await createBridgeServer({
    allowedProjectRoots: [first.root, second.root],
    allowedOrigins: [APP_ORIGIN],
    shared: first.shared,
    controlToken,
    projectRegistry,
    agentSetup: null,
  });
  test.after(() => server.close());

  async function issue(projectHandle, projectRoot) {
    const response = await fetch(`${server.origin}/api/v1/control/open-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LiveDot-Control': controlToken },
      body: JSON.stringify({ projectHandle, projectRoot }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).bootstrapToken;
  }

  const handleA = 'ph_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const handleB = 'ph_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const tokenA = await issue(handleA, first.root);
  const exchangeA = await fetch(`${server.origin}/api/v1/session`, {
    method: 'POST', headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(exchangeA.status, 201);
  const bodyA = await exchangeA.json();
  const cookie = exchangeA.headers.get('set-cookie').split(';', 1)[0];

  const tokenB = await issue(handleB, second.root);
  const exchangeB = await fetch(`${server.origin}/api/v1/session`, {
    method: 'POST', headers: { Origin: APP_ORIGIN, Cookie: cookie, Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(exchangeB.status, 200);
  assert.equal((await exchangeB.json()).csrfToken, bodyA.csrfToken);
  assert.match(exchangeB.headers.get('set-cookie'), new RegExp(cookie.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const missing = await fetch(`${server.origin}/api/v1/snapshot`, { headers: { Origin: APP_ORIGIN, Cookie: cookie } });
  assert.equal(missing.status, 400);
  const snapshotA = await fetch(`${server.origin}/api/v1/snapshot`, { headers: { Origin: APP_ORIGIN, Cookie: cookie, 'X-LiveDot-Project-Handle': handleA } });
  const snapshotB = await fetch(`${server.origin}/api/v1/snapshot`, { headers: { Origin: APP_ORIGIN, Cookie: cookie, 'X-LiveDot-Project-Handle': handleB } });
  assert.equal(snapshotA.status, 200);
  assert.equal(snapshotB.status, 200);
  const beforeA = await snapshotA.json();
  const beforeB = await snapshotB.json();
  const marker = `only-a-${Date.now()}`;
  const writeA = await fetch(`${server.origin}/api/v1/commands`, {
    method: 'POST',
    headers: {
      Origin: APP_ORIGIN,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': bodyA.csrfToken,
      'X-LiveDot-Project-Handle': handleA,
    },
    body: JSON.stringify(commandEnvelope(marker, beforeA.revision, createRouteCommand(marker))),
  });
  assert.equal(writeA.status, 200);
  const afterB = await fetch(`${server.origin}/api/v1/snapshot`, { headers: { Origin: APP_ORIGIN, Cookie: cookie, 'X-LiveDot-Project-Handle': handleB } });
  assert.equal(afterB.status, 200);
  assert.deepEqual((await afterB.json()).document, beforeB.document);
});

async function establishSession(server) {
  const exchange = await fetch(`${server.origin}/session`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${server.bootstrapToken}` },
  });
  assert.equal(exchange.status, 201);
  const body = await exchange.json();
  const setCookie = exchange.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  return { cookie: setCookie.split(';', 1)[0], csrf: body.csrfToken };
}

function authHeaders(session, extra = {}) {
  return { Origin: APP_ORIGIN, Cookie: session.cookie, 'X-CSRF-Token': session.csrf, ...extra };
}

function requestWithHost(server, host) {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: server.host,
      port: server.port,
      path: '/health',
      method: 'GET',
      headers: { Host: host },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

async function openProject(server, root, session) {
  return fetch(`${server.origin}/open`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ projectRoot: root }),
  });
}

async function readUntil(reader, decoder, initial, pattern, timeoutMs = 2_000) {
  let stream = initial;
  const deadline = Date.now() + timeoutMs;
  while (!stream.includes(pattern)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`event stream did not contain ${pattern}: ${stream}`);
    let timeout;
    try {
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`event stream timeout waiting for ${pattern}`)), remaining);
        }),
      ]);
      if (result.done) throw new Error(`event stream closed before ${pattern}: ${stream}`);
      stream += decoder.decode(result.value || new Uint8Array());
    } finally {
      clearTimeout(timeout);
    }
  }
  return stream;
}

test('binds a random loopback port and exposes a minimal unauthenticated health check', async (t) => {
  const { server } = await startServer(t, { shared: undefined });
  assert.equal(server.host, '127.0.0.1');
  assert.ok(server.port > 0);
  const { response, value } = await json(await fetch(`${server.origin}/health`));
  assert.equal(response.status, 200);
  assert.deepEqual(value, { ok: true, service: 'live-dot-map-bridge', version: 2 });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('exchanges the bootstrap token once and enforces cookie, Origin and CSRF', async (t) => {
  const { root, server } = await startServer(t);

  const badOrigin = await fetch(`${server.origin}/session`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', Authorization: `Bearer ${server.bootstrapToken}` },
  });
  assert.equal(badOrigin.status, 403);

  const session = await establishSession(server);
  const replay = await fetch(`${server.origin}/session`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Authorization: `Bearer ${server.bootstrapToken}` },
  });
  assert.equal(replay.status, 401);

  const noCsrf = await fetch(`${server.origin}/open`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectRoot: root }),
  });
  assert.equal(noCsrf.status, 403);

  const opened = await openProject(server, root, session);
  assert.equal(opened.status, 200);
  assert.equal((await opened.json()).revision, 0);
});

test('resumes an authenticated browser session after the one-time URL token is gone', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const resumed = await fetch(`${server.origin}/session`, {
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie },
  });
  assert.equal(resumed.status, 200);
  const body = await resumed.json();
  assert.equal(body.resumed, true);
  assert.equal(body.projectRoot, root);
  assert.equal(body.csrfToken, session.csrf);
});

test('project open returns a non-blocking Agent setup status for the UI', async (t) => {
  const setup = async (root) => ({ ok: true, status: 'none', changed: false, projectRoot: root, detectedAgents: {} });
  const { root, server } = await startServer(t, { agentSetup: setup });
  const session = await establishSession(server);
  const response = await openProject(server, root, session);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.agentSetup, { ok: true, status: 'none', changed: false, projectRoot: root, detectedAgents: {} });
  assert.equal(body.revision, 0);
});

test('reads, creates and atomically saves project Markdown with explicit conflict checks', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const headers = authHeaders(session);
  const path = '.live-dot-map/nodes/n-test/index.md';

  const missing = await fetch(`${server.origin}/markdown?path=${encodeURIComponent(path)}`, { headers });
  assert.equal(missing.status, 200);
  assert.equal((await missing.json()).exists, false);

  const created = await fetch(`${server.origin}/markdown?path=${encodeURIComponent(path)}&create=1&title=${encodeURIComponent('问题记录')}`, { headers });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.created, true);
  assert.match(createdBody.content, /^# 问题记录\n/);
  assert.ok(createdBody.etag);

  const emptyPath = '.live-dot-map/nodes/empty/index.md';
  await mkdir(`${root}/.live-dot-map/maps/default/nodes/empty`, { recursive: true });
  await writeFile(`${root}/.live-dot-map/maps/default/nodes/empty/index.md`, '');
  const initialized = await fetch(`${server.origin}/markdown?path=${encodeURIComponent(emptyPath)}&create=1&title=${encodeURIComponent('空记录')}`, { headers });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).content, '# 空记录\n\n');

  const saved = await fetch(`${server.origin}/markdown`, {
    method: 'PUT', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content: '# 问题记录\n\n证据已补充。', baseEtag: createdBody.etag }),
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.notEqual(savedBody.etag, createdBody.etag);
  const mcpRead = await fetch(`${server.origin}/api/v1/mcp`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: 'map_read_markdown', arguments: { path } }),
  });
  assert.equal(mcpRead.status, 200);
  assert.equal(mcpRead.headers.get('content-type')?.startsWith('application/json'), true);
  assert.equal((await mcpRead.json()).result.content, '# 问题记录\n\n证据已补充。');
  const mcpWrite = await fetch(`${server.origin}/api/v1/mcp`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: 'map_write_markdown', arguments: { path, content: '# Agent 证据\n', baseEtag: savedBody.etag } }),
  });
  assert.equal(mcpWrite.status, 200);
  assert.equal((await mcpWrite.json()).result.content, '# Agent 证据\n');
  const racePath = '.live-dot-map/nodes/race/index.md';
  const raceCreated = await fetch(`${server.origin}/markdown?path=${encodeURIComponent(racePath)}&create=1&title=${encodeURIComponent('并发')}`, { headers });
  const raceBase = await raceCreated.json();
  const raceResponses = await Promise.all([
    fetch(`${server.origin}/markdown`, {
      method: 'PUT', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path: racePath, content: '# writer-a\n', baseEtag: raceBase.etag }),
    }),
    fetch(`${server.origin}/markdown`, {
      method: 'PUT', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ path: racePath, content: '# writer-b\n', baseEtag: raceBase.etag }),
    }),
  ]);
  assert.deepEqual(raceResponses.map((response) => response.status).sort(), [200, 409]);
  const raceConflict = await raceResponses.find((response) => response.status === 409).json();
  assert.equal(raceConflict.error.code, 'MARKDOWN_CONFLICT');
  assert.equal(typeof raceConflict.error.details.current.etag, 'string');

  // Creation/legacy-empty repair must share the path lock with PUT. Regardless
  // of which request wins the queue, the writer's content is never rolled
  // back by a late '# title' initializer.
  for (let index = 0; index < 8; index += 1) {
    const concurrentPath = `.live-dot-map/nodes/create-write-${index}.md`;
    const emptyBase = await fetch(`${server.origin}/markdown?path=${encodeURIComponent(concurrentPath)}`, { headers }).then((response) => response.json());
    const [createResponse, writeResponse] = await Promise.all([
      fetch(`${server.origin}/markdown?path=${encodeURIComponent(concurrentPath)}&create=1&title=${encodeURIComponent('并发创建')}`, { headers }),
      fetch(`${server.origin}/markdown`, {
        method: 'PUT', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: concurrentPath, content: `# writer-${index}\n`, baseEtag: emptyBase.etag }),
      }),
    ]);
    assert.equal(createResponse.status, 200);
    assert.ok([200, 409].includes(writeResponse.status));
    const final = await fetch(`${server.origin}/markdown?path=${encodeURIComponent(concurrentPath)}`, { headers });
    assert.equal((await final.json()).content, writeResponse.status === 200 ? `# writer-${index}\n` : '# 并发创建\n\n');
  }
  const stale = await fetch(`${server.origin}/markdown`, {
    method: 'PUT', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content: '覆盖', baseEtag: createdBody.etag }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'MARKDOWN_CONFLICT');

  const traversal = await fetch(`${server.origin}/markdown?path=${encodeURIComponent('../outside.md')}`, { headers });
  assert.equal(traversal.status, 403);
  assert.equal((await traversal.json()).error.code, 'MARKDOWN_PATH_TRAVERSAL');

  const reveal = await fetch(`${server.origin}/markdown/reveal?path=${encodeURIComponent(path)}`, { headers });
  assert.equal(reveal.status, 200);
  assert.equal((await reveal.json()).opened, false);
  const unprotectedReveal = await fetch(`${server.origin}/markdown/reveal`, {
    method: 'POST', headers: { Origin: APP_ORIGIN, Cookie: session.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  assert.equal(unprotectedReveal.status, 403);
  assert.equal((await unprotectedReveal.json()).error.code, 'INVALID_CSRF');
});

test('bundle REST uses owner routing and binary asset streams', async (t) => {
  const { root, server } = await startServer(t, { agentSetup: null });
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const created = await fetch(`${server.origin}/api/v1/bundles/markdown/create`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ownerKind: 'node', ownerId: 'n1', fileName: 'evidence.md', content: 'evidence' }),
  });
  assert.equal(created.status, 200);
  const listed = await fetch(`${server.origin}/api/v1/bundles?ownerKind=node&ownerId=n1`, { headers: authHeaders(session) });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).files.some((file) => file.name === 'evidence.md'), true);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const uploaded = await fetch(`${server.origin}/api/v1/assets/import?ownerKind=node&ownerId=n1&fileName=image.png`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'image/png' }),
    body: png,
  });
  assert.equal(uploaded.status, 201);
  const downloaded = await fetch(`${server.origin}/api/v1/assets/read?ownerKind=node&ownerId=n1&fileName=image.png`, { headers: authHeaders(session) });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
});

test('rejects hostile Host and missing project roots while allowing session-side switching', async (t) => {
  const { root: otherRoot } = await temporaryProject(t);
  const { root, server } = await startServer(t);
  assert.equal(await requestWithHost(server, 'evil.example'), 403);

  const session = await establishSession(server);
  // 会话内切换：已认证会话可打开任意存在的本机目录（桥是用户本机进程，loopback + CSRF 保护）。
  const switched = await openProject(server, otherRoot, session);
  assert.equal(switched.status, 200);
  const allowed = await openProject(server, root, session);
  assert.equal(allowed.status, 200);
  const missing = await openProject(server, resolve(root, 'does-not-exist-xyz'), session);
  assert.equal(missing.status, 404);
});

test('returns truthful five-state Agent discovery for the opened project', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const response = await fetch(`${server.origin}/agents`, { headers: { Origin: APP_ORIGIN, Cookie: session.cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.states).sort(), ['awaiting_trust', 'connected', 'discovered', 'error', 'not_installed'].sort());
  assert.ok(body.agents.length >= 3);
  assert.deepEqual(new Set(body.agents.map((agent) => agent.id)), new Set(['codex', 'claude-code', 'kimi-code', ...(body.agents.some((agent) => agent.id === 'codebuddy') ? ['codebuddy'] : [])]));
  for (const agent of body.agents) {
    assert.ok(['awaiting_trust', 'connected', 'discovered', 'error', 'not_installed'].includes(agent.state));
    assert.equal(typeof agent.discovered, 'boolean');
  }
});

test('opening a project auto-configures only detected Agents and preserves trust boundaries', async (t) => {
  const { root } = await temporaryProject(t, { withMap: false });
  const home = await mkdtemp(join(TEST_ROOT_DIR, 'livedot-agent-home-'));
  const detected = {
    codex: { id: 'codex', configured: false, executable: true, discovered: true },
    'claude-code': { id: 'claude-code', configured: false, executable: false, discovered: false },
    'kimi-code': { id: 'kimi-code', configured: false, executable: false, discovered: false },
    codebuddy: { id: 'codebuddy', configured: false, executable: false, discovered: false },
  };
  const first = await ensureProjectAgentConfig(root, {
    platform: 'linux',
    homeRoot: home,
    sourceRoot: resolve(import.meta.dirname, '../..'),
    runtimeSource: resolve(import.meta.dirname, '../../livedot.mjs'),
    detect: async () => detected,
  });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'configured');
  assert.equal(first.changed, true);
  assert.equal(first.configured.codex, true);
  assert.equal(first.trust.codex?.acknowledged, undefined);
  assert.equal(await import('node:fs/promises').then(({ access }) => access(`${home}/.codex/config.toml`).then(() => true).catch(() => false)), true);
  assert.equal(await import('node:fs/promises').then(({ access }) => access(`${home}/.claude/settings.json`).then(() => true).catch(() => false)), false);
  // 项目内零配置：全局化后项目不再出现 .codex 等配置目录。
  assert.equal(await import('node:fs/promises').then(({ access }) => access(`${root}/.codex/config.toml`).then(() => true).catch(() => false)), false);
  const configPath = `${root}/.live-dot-map/agent-kit.json`;
  const config = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(configPath, 'utf8')));
  config.trust.codex.acknowledged = true;
  await import('node:fs/promises').then(({ writeFile }) => writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`));
  const second = await ensureProjectAgentConfig(root, { platform: 'linux', homeRoot: home, detect: async () => detected });
  assert.equal(second.status, 'ready');
  assert.equal(second.changed, false);
  assert.equal(second.trust.codex.acknowledged, true);
});

test('enforces request body limit and baseRevision conflicts through HTTP', async (t) => {
  const { root, server } = await startServer(t, { bodyLimit: 512 });
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);

  const first = await fetch(`${server.origin}/commands`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(commandEnvelope('command-http1', 0)),
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).revision, 1);

  const conflict = await fetch(`${server.origin}/commands`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(commandEnvelope('command-http2', 0)),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'REVISION_CONFLICT');

  const oversized = await fetch(`${server.origin}/commands`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...commandEnvelope('command-http3', 1), padding: 'x'.repeat(1024) }),
  });
  assert.equal(oversized.status, 413);
});

test('binds browser writes to human and MCP writes to Agent regardless of supplied actor', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);

  const humanWrite = await fetch(`${server.origin}/commands`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...commandEnvelope('command-bind-human', 0), actor: 'agent:codex' }),
  });
  assert.equal(humanWrite.status, 200);
  const humanDocument = (await humanWrite.json()).document;
  assert.equal(humanDocument.routes[0].createdBy, 'human');

  const forgedMcp = await fetch(`${server.origin}/api/v1/mcp`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: 'map_apply_commands',
      arguments: {
        actor: 'human',
        baseRevision: 1,
        commandId: 'mcp-forged-human',
        commands: [{ op: 'archive', collection: 'routes', id: 'r1', archiveReason: 'Agent 判断已过时' }],
      },
    }),
  });
  assert.equal(forgedMcp.status, 200);
  const snapshot = await fetch(`${server.origin}/snapshot`, { headers: { Origin: APP_ORIGIN, Cookie: session.cookie } });
  const persisted = await snapshot.json();
  assert.equal(persisted.revision, 2);
  assert.equal(persisted.document.routes[0].archived, true);
  assert.equal(persisted.document.routes[0].archivedBy, 'agent:bridge');
});

test('streams commit events and supports snapshot plus backup recovery endpoints', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);

  const controller = new AbortController();
  const eventResponse = await fetch(`${server.origin}/events`, {
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie },
    signal: controller.signal,
  });
  assert.equal(eventResponse.status, 200);
  assert.match(eventResponse.headers.get('content-type'), /text\/event-stream/);
  const reader = eventResponse.body.getReader();
  const decoder = new TextDecoder();
  let stream = decoder.decode((await reader.read()).value);
  assert.match(stream, /event: ready/);

  const command = await fetch(`${server.origin}/commands`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(commandEnvelope('command-event', 0)),
  });
  assert.equal(command.status, 200);
  for (let attempts = 0; attempts < 5 && !stream.includes('event: command'); attempts += 1) {
    const chunk = await reader.read();
    stream += decoder.decode(chunk.value || new Uint8Array());
  }
  assert.match(stream, /event: command/);
  await reader.cancel();
  controller.abort();

  const snapshot = await fetch(`${server.origin}/snapshot`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
  });
  assert.equal(snapshot.status, 201);

  const recovered = await fetch(`${server.origin}/recover`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ source: 'backup' }),
  });
  assert.equal(recovered.status, 200);
  const recoveryBody = await recovered.json();
  assert.equal(recoveryBody.revision, 2);
  assert.equal(recoveryBody.document.routes.length, 0);
});

test('notifies an opened canvas when an independent MCP-style ProjectStore writes within two seconds', async (t) => {
  const { root, shared, server } = await startServer(t, { pollIntervalMs: 50 });
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);

  const controller = new AbortController();
  const eventResponse = await fetch(`${server.origin}/events`, {
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie },
    signal: controller.signal,
  });
  const reader = eventResponse.body.getReader();
  const decoder = new TextDecoder();
  const initial = decoder.decode((await reader.read()).value);
  assert.match(initial, /event: ready/);

  const writer = await ProjectStore.open({ projectRoot: root, shared, pollIntervalMs: 0 });
  t.after(() => writer.close());
  const startedAt = Date.now();
  await writer.execute(commandEnvelope('external-mcp-1', 0));
  const stream = await readUntil(reader, decoder, initial, 'event: revision', 2_000);
  assert.ok(Date.now() - startedAt < 2_000, 'external revision notification exceeded two seconds');
  assert.match(stream, /"source":"external"/);
  assert.match(stream, /"revision":1/);

  await reader.cancel();
  controller.abort();
});

test('external stdio-style map switch is observed and published to open canvases', async (t) => {
  const { root, shared, server } = await startServer(t, { activeMapPollIntervalMs: 50 });
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const createdResponse = await fetch(`${server.origin}/api/v1/maps/create`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name: 'Agent 外部切换目标' }),
  });
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();

  const controller = new AbortController();
  const eventResponse = await fetch(`${server.origin}/events`, {
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie },
    signal: controller.signal,
  });
  const reader = eventResponse.body.getReader();
  const decoder = new TextDecoder();
  const initial = decoder.decode((await reader.read()).value);
  assert.match(initial, /event: ready/);

  const external = await MapManager.open({ projectRoot: root, shared, pollIntervalMs: 0 });
  t.after(() => external.close());
  await external.switch(created.createdMap);
  const stream = await readUntil(reader, decoder, initial, 'event: active-map-changed', 2_000);
  assert.match(stream, new RegExp(`"mapKey":"${String(created.createdMap).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(stream, /"source":"external"/);
  await reader.cancel();
  controller.abort();
});

test('reconnects the event stream with the latest revision after a disconnected write', async (t) => {
  const { root, shared, server } = await startServer(t, { pollIntervalMs: 50 });
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);

  const firstResponse = await fetch(`${server.origin}/events`, {
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie },
  });
  const firstReader = firstResponse.body.getReader();
  await firstReader.read();
  await firstReader.cancel();

  const writer = await ProjectStore.open({ projectRoot: root, shared, pollIntervalMs: 0 });
  t.after(() => writer.close());
  await writer.execute(commandEnvelope('external-reconnect-1', 0, { ...createRouteCommand('r1', '断线前') }));
  await writer.execute(commandEnvelope('external-reconnect-2', 1, { ...createRouteCommand('r2', '断线后') }));

  const response = await fetch(`${server.origin}/events`, {
    headers: { Origin: APP_ORIGIN, Cookie: session.cookie },
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stream = await readUntil(reader, decoder, '', 'event: ready', 2_000);
  assert.match(stream, /"revision":2/);
  await reader.cancel();
});

test('session can switch to another local directory and keep prior project in allowlist', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const second = await temporaryProject(t);
  const opened = await openProject(server, second.root, session);
  assert.equal(opened.status, 200);
  const body = await opened.json();
  assert.equal(body.projectRoot, second.root);
  // 历史项目仍可回切（allowlist 保留）。
  const back = await openProject(server, root, session);
  assert.equal(back.status, 200);
  assert.equal((await back.json()).projectRoot, root);
});

test('open reports a clear error for a missing directory', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  const missing = resolve(root, 'does-not-exist-xyz');
  const response = await openProject(server, missing, session);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error?.code, 'PROJECT_NOT_FOUND');
});

test('recent projects lists opened directories newest first', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  const second = await temporaryProject(t);
  await openProject(server, root, session);
  await openProject(server, second.root, session);
  const response = await fetch(`${server.origin}/projects/recent`, {
    method: 'GET',
    headers: authHeaders(session),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.recent));
  assert.equal(body.recent[0], second.root);
  assert.ok(body.recent.includes(root));
});

test('archive settings lists, restores and requires typed confirmation before human purge', async (t) => {
  const recycled = [];
  const { root, server } = await startServer(t, { recycleBin: { async recycle(path) { recycled.push(path); return true; } } });
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const snapshot = await fetch(`${server.origin}/snapshot`, { headers: authHeaders(session) }).then((response) => response.json());
  const node = { id: 'archive-settings-node', name: '待清理节点', kind: 'goal', route: null, x: 0, y: 0 };
  const archived = await fetch(`${server.origin}/commands`, {
    method: 'POST',
    headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      projectId: snapshot.document.mapId,
      baseRevision: snapshot.revision,
      commandId: 'archive-settings-create',
      sessionId: 'browser-test',
      commands: [
        { op: 'create', collection: 'nodes', value: node },
        { op: 'archive', collection: 'nodes', id: node.id, archiveReason: '测试归档' },
      ],
    }),
  });
  assert.equal(archived.status, 200);

  const listed = await fetch(`${server.origin}/api/v1/archive`, { headers: authHeaders(session) });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).archived.some((item) => item.id === node.id && item.collection === 'nodes'), true);

  const denied = await fetch(`${server.origin}/api/v1/archive/purge`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ collection: 'nodes', id: node.id, confirmed: true, confirmation: 'wrong-id' }),
  });
  assert.equal(denied.status, 403);
  assert.equal(recycled.length, 0);

  const restored = await fetch(`${server.origin}/api/v1/archive/restore`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ collection: 'nodes', id: node.id }),
  });
  assert.equal(restored.status, 200);
  const afterRestore = await restored.json();
  const rearchive = await fetch(`${server.origin}/commands`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      projectId: afterRestore.document.mapId,
      baseRevision: afterRestore.revision,
      commandId: 'archive-settings-rearchive',
      sessionId: 'browser-test',
      commands: [{ op: 'archive', collection: 'nodes', id: node.id }],
    }),
  });
  assert.equal(rearchive.status, 200);
  const purged = await fetch(`${server.origin}/api/v1/archive/purge`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ collection: 'nodes', id: node.id, confirmed: true, confirmation: node.id }),
  });
  assert.equal(purged.status, 200);
  assert.equal((await purged.json()).purged, true);
  assert.equal(recycled.length, 1);
});

test('editor HTTP surface accepts only opaque ids and project-relative targets', async (t) => {
  const nativeCalls = [];
  const nativeHelper = async (request) => {
    nativeCalls.push(request);
    if (request.operation === 'save-as') return { destinationPath: join(root, 'exported.md') };
    return { ok: true };
  };
  const { root, server } = await startServer(t, { nativeHelper });
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'editor target.md'), '# editor\n');

  const listing = await fetch(`${server.origin}/api/v1/editors`, { headers: authHeaders(session) });
  assert.equal(listing.status, 200);
  const listBody = await listing.json();
  assert.equal(listBody.editors.some((item) => item.id === 'system' && item.available), true);
  assert.equal(JSON.stringify(listBody).includes('.exe'), false);

  const opened = await fetch(`${server.origin}/api/v1/editors/open`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ editorId: 'system', relativePath: 'docs/editor target.md' }),
  });
  assert.equal(opened.status, 200);
  assert.equal(nativeCalls[0].operation, 'open-default');

  const hostile = await fetch(`${server.origin}/api/v1/editors/open`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ editorId: 'C:\\Windows\\System32\\cmd.exe', relativePath: 'docs/editor target.md' }),
  });
  assert.equal(hostile.status, 400);
  const outside = await fetch(`${server.origin}/api/v1/editors/open`, {
    method: 'POST', headers: authHeaders(session, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ editorId: 'system', relativePath: '..\\secret.md' }),
  });
  assert.equal(outside.status, 403);
});

test('pick folder script prefers modern IFileOpenDialog with topmost owner and falls back safely', () => {
  const script = buildPickFolderScript('D:\\tmp\\pick-测试.txt');
  // 主路径：COM IFileOpenDialog + FOS_PICKFOLDERS（VS Code 同款现代选择文件夹对话框）。
  assert.match(script, /IFileOpenDialog/);
  assert.match(script, /FOS_PICKFOLDERS/);
  // 置顶隐形 owner 窗体，句柄传给对话框，保证弹窗在画布窗口前。
  assert.match(script, /TopMost\s*=\s*\$true/);
  assert.match(script, /Pick\(\$owner\.Handle/);
  // 兜底：异常时回落 FolderBrowserDialog，同样挂置顶 owner。
  assert.match(script, /FolderBrowserDialog/);
  assert.match(script, /\$d\.ShowDialog\(\$owner\)/);
  // 输出协议：选中路径写 marker 文件，stdout 报告 OK/CANCEL 与使用的模式。
  assert.match(script, /PICK:OK/);
  assert.match(script, /PICK:CANCEL/);
  assert.match(script, /WriteAllText\('D:\\\\tmp\\\\pick-测试\.txt'/);
});

test('pick folder script escapes quotes in marker path', () => {
  const script = buildPickFolderScript("C:\\Users\\o'brien\\pick.txt");
  // PowerShell 单引号字符串内的单引号须双写转义。
  assert.match(script, /o''brien/);
});
