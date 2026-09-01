import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { createBridgeServer } from '../../src/bridge/server.mjs';
import { ProjectRegistry } from '../../src/bridge/project-registry.mjs';
import { createRouteCommand, temporaryProject } from './helpers.mjs';

const OWNS_TEST_ROOT = !process.env.LIVEDOT_TEST_ROOT;
const TEST_ROOT_DIR = process.env.LIVEDOT_TEST_ROOT || await mkdtemp(join(tmpdir(), 'livedot-mcp-control-suite-'));
process.env.LIVEDOT_TEST_ROOT = TEST_ROOT_DIR;
after(() => OWNS_TEST_ROOT ? rm(TEST_ROOT_DIR, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }) : undefined);
process.env.LIVEDOT_RECENT_PROJECTS_FILE = join(TEST_ROOT_DIR, 'recent-projects-mcp-control-test.json');

const APP_ORIGIN = 'https://app.example.test';
const CONTROL_TOKEN = 'mcp-control-token-for-test';

async function startControlServer(test, options = {}) {
  const project = await temporaryProject(test);
  const runtimeStateDir = await mkdtemp(join(TEST_ROOT_DIR, 'runtime-'));
  test.after(() => rm(runtimeStateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  const projectRegistry = await ProjectRegistry.open({ runtimeStateDir });
  const server = await createBridgeServer({
    allowedProjectRoots: [project.root],
    allowedOrigins: [APP_ORIGIN],
    shared: project.shared,
    controlToken: CONTROL_TOKEN,
    projectRegistry,
    ...options,
  });
  test.after(() => server.close());
  return { ...project, server, projectRegistry, runtimeStateDir };
}

function controlMcp(server, body, token = CONTROL_TOKEN) {
  return fetch(`${server.origin}/api/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-LiveDot-Control': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('control status advertises the mcpControl capability for CLI probing', async (t) => {
  const { server } = await startControlServer(t);
  const denied = await fetch(`${server.origin}/api/v1/control/status`);
  assert.equal(denied.status, 401);
  const status = await fetch(`${server.origin}/api/v1/control/status`, { headers: { 'X-LiveDot-Control': CONTROL_TOKEN } });
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(body.capabilities?.mcpControl, true);
});

test('mcp control channel: requests without the control header fall through to the browser path', async (t) => {
  const { root, server } = await startControlServer(t);
  // 不带 X-LiveDot-Control：必须原样落入浏览器会话鉴权，无会话即 401 UNAUTHENTICATED。
  const response = await fetch(`${server.origin}/api/v1/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN },
    body: JSON.stringify({ tool: 'map_get_context', projectRoot: root }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
});

test('mcp control channel rejects a wrong token without falling back to session auth', async (t) => {
  const { root, server } = await startControlServer(t);
  const response = await controlMcp(server, { tool: 'map_get_context', projectRoot: root }, 'wrong-token');
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'INVALID_CONTROL_TOKEN');
});

test('mcp control channel requires an absolute projectRoot', async (t) => {
  const { server } = await startControlServer(t);
  const missing = await controlMcp(server, { tool: 'map_get_context' });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, 'PROJECT_ROOT_REQUIRED');

  const relative = await controlMcp(server, { tool: 'map_get_context', projectRoot: 'relative/path' });
  assert.equal(relative.status, 400);
  assert.equal((await relative.json()).error.code, 'PROJECT_ROOT_REQUIRED');
});

test('mcp control channel reports a missing project directory as 404', async (t) => {
  const { server } = await startControlServer(t);
  const ghost = join(TEST_ROOT_DIR, 'does-not-exist-mcp-control');
  const response = await controlMcp(server, { tool: 'map_get_context', projectRoot: ghost });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'PROJECT_NOT_FOUND');
});

test('mcp control channel dispatches tools, registers the project and binds the supplied agent actor', async (t) => {
  const { root, server, projectRegistry } = await startControlServer(t);

  const context = await controlMcp(server, { tool: 'map_get_context', projectRoot: root, agent: 'testagent' });
  assert.equal(context.status, 200);
  const contextBody = await context.json();
  assert.equal(contextBody.tool, 'map_get_context');
  assert.match(contextBody.result.projectHandle, /^ph_/);

  // 与 serve/launcher 同一授权语义：项目根幂等登记进注册表并持久化。
  const registered = projectRegistry.resolve(contextBody.result.projectHandle);
  assert.equal(projectRegistry.byRoot.size, 1);
  const persisted = JSON.parse(await readFile(projectRegistry.filePath, 'utf8'));
  assert.equal(persisted.projects.length, 1);
  assert.equal(persisted.projects[0].projectRoot, registered.projectRoot);

  // actor 绑定：创建路线后落盘的 createdBy 必须是归一化后的 agent:<name>，而非默认或伪造值。
  const write = await controlMcp(server, {
    tool: 'map_apply_commands',
    projectRoot: root,
    agent: 'agent:testagent',
    arguments: { commandId: 'mcp-control-create', baseRevision: 0, commands: [createRouteCommand()] },
  });
  assert.equal(write.status, 200);
  const document = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
  assert.equal(document.routes[0].createdBy, 'agent:testagent');
});

test('mcp control channel defaults the actor to agent:mcp-proxy', async (t) => {
  const { root, server } = await startControlServer(t);
  const write = await controlMcp(server, {
    tool: 'map_apply_commands',
    projectRoot: root,
    arguments: { commandId: 'mcp-control-default-actor', baseRevision: 0, commands: [createRouteCommand()] },
  });
  assert.equal(write.status, 200);
  const document = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
  assert.equal(document.routes[0].createdBy, 'agent:mcp-proxy');
});
