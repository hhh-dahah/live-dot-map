import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { createBridgeServer } from '../../src/bridge/server.mjs';
import { ProjectStore } from '../../src/bridge/project-store.mjs';
import { commandEnvelope, createRouteCommand, temporaryProject } from './helpers.mjs';

const APP_ORIGIN = 'https://app.example.test';

async function json(response) {
  const value = await response.json();
  return { response, value };
}

async function startServer(test, options = {}) {
  const project = await temporaryProject(test);
  const server = await createBridgeServer({
    allowedProjectRoots: [project.root],
    allowedOrigins: [APP_ORIGIN],
    shared: project.shared,
    ...options,
  });
  test.after(() => server.close());
  return { ...project, server };
}

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

test('rejects hostile Host and non-allowlisted project roots', async (t) => {
  const { root: otherRoot } = await temporaryProject(t);
  const { root, server } = await startServer(t);
  assert.equal(await requestWithHost(server, 'evil.example'), 403);

  const session = await establishSession(server);
  const denied = await openProject(server, otherRoot, session);
  assert.equal(denied.status, 403);
  const allowed = await openProject(server, root, session);
  assert.equal(allowed.status, 200);
});

test('returns truthful five-state Agent discovery for the opened project', async (t) => {
  const { root, server } = await startServer(t);
  const session = await establishSession(server);
  assert.equal((await openProject(server, root, session)).status, 200);
  const response = await fetch(`${server.origin}/agents`, { headers: { Origin: APP_ORIGIN, Cookie: session.cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.states).sort(), ['awaiting_trust', 'connected', 'discovered', 'error', 'not_installed'].sort());
  assert.equal(body.agents.length, 3);
  for (const agent of body.agents) {
    assert.ok(['awaiting_trust', 'connected', 'discovered', 'error', 'not_installed'].includes(agent.state));
    assert.equal(typeof agent.discovered, 'boolean');
  }
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
