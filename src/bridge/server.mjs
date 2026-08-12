import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalDirectory } from './fs-utils.mjs';
import { asBridgeError, BridgeError } from './errors.mjs';
import { ProjectStore } from './project-store.mjs';
import { loadSharedAdapter } from './shared-adapter.mjs';
import { detectInstalledAdapters } from '../../agent-kit/lib/installer.mjs';

const SESSION_COOKIE = 'ldm_bridge_session';
const DEFAULT_BODY_LIMIT = 16 * 1024 * 1024;
const DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1000;

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function constantEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  if (header.length > 8192) throw new BridgeError('COOKIE_HEADER_TOO_LARGE', 'Cookie header is too large', { status: 400 });
  const cookies = new Map();
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    cookies.set(key, value);
  }
  return cookies;
}

async function readJsonBody(request, limit) {
  const contentType = request.headers['content-type'] || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new BridgeError('JSON_REQUIRED', 'Content-Type must be application/json', { status: 415 });
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw new BridgeError('BODY_TOO_LARGE', 'Request body exceeds the configured limit', { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new BridgeError('BODY_TOO_LARGE', 'Request body exceeds the configured limit', { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required');
    return value;
  } catch (error) {
    throw new BridgeError('INVALID_JSON', 'Request body must be a valid JSON object', { status: 400, cause: error });
  }
}

class EventHub {
  #clients = new Map();

  subscribe(root, response) {
    let clients = this.#clients.get(root);
    if (!clients) this.#clients.set(root, (clients = new Set()));
    clients.add(response);
    response.once('close', () => clients.delete(response));
  }

  publish(root, event) {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const response of this.#clients.get(root) || []) {
      if (!response.destroyed) response.write(payload);
    }
  }

  close() {
    for (const clients of this.#clients.values()) {
      for (const response of clients) {
        // 否则 SSE 响应可能让 node:http 的 keep-alive 套接字在桥关闭时
        // 继续存活数秒。
        if (!response.destroyed) response.destroy();
      }
    }
    this.#clients.clear();
  }
}

function setSecurityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

function sendJson(response, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', data.length);
  response.end(data);
}

function sendError(response, error) {
  const bridgeError = asBridgeError(error);
  const body = {
    error: {
      code: bridgeError.code,
      message: bridgeError.status >= 500 ? 'Local bridge request failed' : bridgeError.message,
    },
  };
  if (bridgeError.details !== undefined && bridgeError.status < 500) body.error.details = bridgeError.details;
  sendJson(response, bridgeError.status || 500, body);
}

function requireMethod(request, method) {
  if (request.method !== method) {
    throw new BridgeError('METHOD_NOT_ALLOWED', `Expected ${method}`, { status: 405 });
  }
}

export async function createBridgeServer({
  allowedProjectRoots,
  allowedOrigins = [],
  shared,
  bodyLimit = DEFAULT_BODY_LIMIT,
  sessionTtlMs = DEFAULT_SESSION_TTL,
  snapshotEvery = 20,
  pollIntervalMs = 250,
  clock = () => new Date(),
  faultInjector,
  host = '127.0.0.1',
  appHtml = null,
  staticAssets = {},
} = {}) {
  if (!Array.isArray(allowedProjectRoots) || allowedProjectRoots.length === 0) {
    throw new BridgeError('ALLOWLIST_REQUIRED', 'At least one project root must be allowlisted');
  }
  const adapter = shared || await loadSharedAdapter();
  const roots = new Map();
  for (const root of allowedProjectRoots) roots.set(await canonicalDirectory(root), true);

  const bootstrapToken = randomToken();
  let bootstrapConsumed = false;
  let port;
  const sessions = new Map();
  const stores = new Map();
  const events = new EventHub();
  const configuredOrigins = new Set(allowedOrigins);

  function allowedHosts() {
    return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  }

  function validateHost(request) {
    const value = String(request.headers.host || '').toLowerCase();
    if (!allowedHosts().has(value)) {
      throw new BridgeError('INVALID_HOST', 'Host header is not an allowed loopback host', { status: 403 });
    }
  }

  function validateOrigin(request, response, { required = true } = {}) {
    const origin = request.headers.origin;
    if (!origin) {
      if (required) throw new BridgeError('ORIGIN_REQUIRED', 'Origin header is required', { status: 403 });
      return;
    }
    const allowed = new Set([
      ...configuredOrigins,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
    ]);
    if (!allowed.has(origin)) throw new BridgeError('INVALID_ORIGIN', 'Origin is not allowed', { status: 403 });
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }

  function authenticate(request) {
    const sessionId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    const session = sessionId && sessions.get(sessionId);
    if (!session || session.expiresAt <= clock().getTime()) {
      if (sessionId) sessions.delete(sessionId);
      throw new BridgeError('UNAUTHENTICATED', 'A valid local bridge session is required', { status: 401 });
    }
    return session;
  }

  function validateCsrf(request, session) {
    const token = request.headers['x-csrf-token'];
    if (!token || !constantEqual(token, session.csrfToken)) {
      throw new BridgeError('INVALID_CSRF', 'CSRF token is missing or invalid', { status: 403 });
    }
  }

  async function activeStore(session) {
    if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
    return stores.get(session.projectRoot);
  }

  async function openProject(requestedRoot) {
    let root;
    try {
      root = await canonicalDirectory(requestedRoot);
    } catch {
      throw new BridgeError('PROJECT_NOT_ALLOWED', 'Project root is not allowlisted', { status: 403 });
    }
    if (!roots.has(root)) throw new BridgeError('PROJECT_NOT_ALLOWED', 'Project root is not allowlisted', { status: 403 });
    let store = stores.get(root);
    if (!store) {
      store = await ProjectStore.open({
        projectRoot: root,
        shared: adapter,
        snapshotEvery,
        pollIntervalMs,
        clock,
        faultInjector,
        onEvent: (event) => events.publish(
          root,
          event.type === 'external' ? { ...event, type: 'revision', source: 'external' } : event,
        ),
      });
      stores.set(root, store);
    }
    return { root, store };
  }

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      validateHost(request);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const aliases = new Map([
        ['/api/v1/health', '/health'],
        ['/api/v1/session', '/session'],
        ['/api/v1/projects/open', '/open'],
        ['/api/v1/snapshot', '/snapshot'],
        ['/api/v1/commands', '/commands'],
       ['/api/v1/events', '/events'],
       ['/api/v1/recover', '/recover'],
        ['/api/v1/agents', '/agents'],
      ]);
      const pathname = aliases.get(url.pathname) || url.pathname;

      if (request.method === 'OPTIONS') {
        validateOrigin(request, response);
        response.statusCode = 204;
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, Authorization');
        response.setHeader('Access-Control-Max-Age', '600');
        response.end();
        return;
      }

      if (pathname === '/health') {
        requireMethod(request, 'GET');
        validateOrigin(request, response, { required: false });
        sendJson(response, 200, { ok: true, service: 'live-dot-map-bridge', version: 2 });
        return;
      }

      if ((pathname === '/' || pathname === '/app.html') && appHtml) {
        requireMethod(request, 'GET');
        const data = Buffer.from(appHtml);
        response.statusCode = 200;
        // app.html 自带逐次构建 nonce 的 CSP；API 的 default-src 'none'
        // 若叠加在 HTML 响应上会把所有脚本一起禁用。
        response.removeHeader('Content-Security-Policy');
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Content-Length', data.length);
        response.end(data);
        return;
      }

      if (Object.hasOwn(staticAssets, pathname)) {
        requireMethod(request, 'GET');
        const asset = staticAssets[pathname];
        const data = Buffer.isBuffer(asset.body) ? asset.body : Buffer.from(asset.body);
        response.statusCode = 200;
        response.removeHeader('Content-Security-Policy');
        response.setHeader('Content-Type', asset.type);
        response.setHeader('Content-Length', data.length);
        response.end(data);
        return;
      }

      // Same-origin GET/EventSource 请求通常不带 Origin。它们仍受随机
      // loopback 端口、Host 校验和 HttpOnly 会话保护；写请求必须带 Origin。
      validateOrigin(request, response, { required: request.method !== 'GET' && request.method !== 'HEAD' });
      if (pathname === '/session') {
        requireMethod(request, 'POST');
        if (bootstrapConsumed) throw new BridgeError('BOOTSTRAP_CONSUMED', 'Bootstrap token has already been consumed', { status: 401 });
        const authorization = request.headers.authorization || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        if (!constantEqual(token, bootstrapToken)) throw new BridgeError('INVALID_BOOTSTRAP_TOKEN', 'Bootstrap token is invalid', { status: 401 });
        bootstrapConsumed = true;
        const sessionId = randomToken();
        const csrfToken = randomToken();
        const expiresAt = clock().getTime() + sessionTtlMs;
        sessions.set(sessionId, { csrfToken, expiresAt, projectRoot: null });
        response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}`);
        sendJson(response, 201, { csrfToken, expiresAt: new Date(expiresAt).toISOString() });
        return;
      }

      const session = authenticate(request);
      if (pathname === '/open') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectRoot !== 'string') throw new BridgeError('PROJECT_ROOT_REQUIRED', 'projectRoot is required', { status: 400 });
        const { root, store } = await openProject(body.projectRoot);
        session.projectRoot = root;
        const snapshot = await store.snapshot();
        sendJson(response, 200, { projectRoot: root, projectId: snapshot.document.mapId, ...snapshot });
        return;
      }

      if (pathname === '/agents') {
        requireMethod(request, 'GET');
        const root = session.projectRoot;
        if (!root) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const detected = await detectInstalledAdapters({ projectRoot: root });
        let config = {};
        try {
          const parsed = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-kit.json'), 'utf8'));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed;
        } catch { /* 未接入项目仍返回未安装/已发现状态 */ }
        const trust = config.trust && typeof config.trust === 'object' ? config.trust : {};
        const agents = Object.values(detected).map((item) => {
          const id = String(item.id);
          let state = 'not_installed';
          if (item.configured && !item.executable) state = 'error';
          else if (item.configured && item.executable) state = trust[id]?.acknowledged === true ? 'connected' : 'awaiting_trust';
          else if (item.executable) state = 'discovered';
          return { ...item, state, trustAcknowledged: trust[id]?.acknowledged === true };
        });
        sendJson(response, 200, { projectRoot: root, agents, states: {
          not_installed: '未安装', discovered: '已发现', awaiting_trust: '待信任', connected: '已连接', error: '异常',
        } });
        return;
      }

      if (pathname === '/snapshot') {
        const store = await activeStore(session);
        if (request.method === 'GET') {
          sendJson(response, 200, await store.snapshot());
          return;
        }
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        sendJson(response, 201, await store.createSnapshot());
        return;
      }

      if (pathname === '/commands') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await store.execute(body));
        return;
      }

      if (pathname === '/events') {
        requireMethod(request, 'GET');
        const store = await activeStore(session);
        const snapshot = await store.snapshot();
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Connection', 'keep-alive');
        response.flushHeaders();
        response.write(`event: ready\ndata: ${JSON.stringify({ revision: snapshot.revision, checksum: snapshot.checksum })}\n\n`);
        events.subscribe(session.projectRoot, response);
        return;
      }

      if (pathname === '/recover') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await store.recover(body));
        return;
      }

      if (pathname === '/api/v1/mcp') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        const tool = body.tool || body.name;
        const args = body.arguments && typeof body.arguments === 'object' ? body.arguments : {};
        const snapshot = await store.snapshot();
        let result;
        if (tool === 'map_get_context') {
          result = { revision: snapshot.revision, ...adapter.retrieveContext(snapshot.document, String(args.query || ''), { markdown: Array.isArray(args.markdown) ? args.markdown : [] }) };
        } else if (tool === 'map_list_human_updates') {
          result = { revision: snapshot.revision, updates: snapshot.document.anns.filter((ann) => ann.source === 'human' && ['new', 'delivered'].includes(ann.attention)) };
        } else if (tool === 'map_ack_human_updates') {
          result = await store.execute(args);
        } else if (tool === 'map_next_candidates') {
          const context = adapter.retrieveContext(snapshot.document, String(args.query || ''), {
            currentNodeId: args.currentNodeId === null || args.currentNodeId === undefined ? null : String(args.currentNodeId),
            limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
            includeHistory: args.includeHistory === true,
            markdown: Array.isArray(args.markdown) ? args.markdown : [],
          });
          result = { revision: snapshot.revision, ...context, autonomy: adapter.autonomyDecision(snapshot.document, context.objects) };
        } else if (tool === 'map_apply_commands') {
          result = await store.execute(args);
        } else if (tool === 'map_validate') {
          result = await adapter.validateDocument(args.document || snapshot.document);
        } else if (tool === 'map_checkpoint') {
          result = await store.createSnapshot();
        } else {
          throw new BridgeError('UNKNOWN_MCP_TOOL', 'Unknown MCP tool', { status: 404 });
        }
        sendJson(response, 200, { tool, result });
        return;
      }

      throw new BridgeError('NOT_FOUND', 'Endpoint not found', { status: 404 });
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else response.end();
    }
  });

  server.maxHeadersCount = 64;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  port = server.address().port;

  return {
    host,
    port,
    origin: `http://${host}:${port}`,
    bootstrapToken,
    close: async () => {
      events.close();
      await Promise.all([...stores.values()].map((store) => store.close()));
      sessions.clear();
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
