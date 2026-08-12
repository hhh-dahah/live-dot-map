import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installProject, doctorProject, uninstallProject } from '../../agent-kit/lib/installer.mjs';
import { downloadPortableNode, portableManifestFor, verifyPortableNodeArchive } from '../../agent-kit/lib/portable-node.mjs';

test('install copies one runtime and writes discoverable project configs for all three agents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-agent-kit-'));
  const result = await installProject({ projectRoot: root, createDesktopShortcut: false, register: false, offline: true });
  assert.equal(result.ok, true);
  const config = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-kit.json'), 'utf8'));
  assert.equal(config.version, 2);
  assert.equal(config.projectRoot, root);
  assert.equal(await readdir(join(root, '.live-dot-map')).then((entries) => entries.includes('map.json')), true);
  const map = JSON.parse(await readFile(join(root, '.live-dot-map', 'map.json'), 'utf8'));
  assert.equal(map.version, 2);
  assert.equal(map.mapId, result.projectId);
  assert.equal(result.bridge.registered, true);
  assert.match(await readFile(join(root, '.codex', 'config.toml'), 'utf8'), /mcp_servers\."livedot-map"/);
  assert.equal(JSON.parse(await readFile(join(root, '.codex', 'hooks.json'), 'utf8')).hooks.Stop[0].hooks[0].type, 'command');
  assert.equal(JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8')).hooks.SessionStart.length, 1);
  assert.equal(JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8')).mcpServers['livedot-map'].args.includes('mcp'), true);
  assert.equal(JSON.parse(await readFile(join(root, '.kimi-code', 'mcp.json'), 'utf8')).mcpServers['livedot-map'].command, process.execPath);
  assert.equal(JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8')).mcpServers['livedot-map'].command, process.execPath);
  assert.ok((await readFile(join(root, '.codex', 'config.toml'), 'utf8')).includes(`command = ${JSON.stringify(process.execPath)}`));
  const kimi = JSON.parse(await readFile(join(root, '.live-dot-map', 'kimi-plugin', 'kimi.plugin.json'), 'utf8'));
  assert.equal(Array.isArray(kimi.hooks), true);
  assert.equal(kimi.mcpServers['livedot-map'].args[0], './runtime/livedot.mjs');
  const doctor = await doctorProject({ projectRoot: root, checkBridge: false });
  assert.equal(doctor.ok, true);
});

test('optional CodeBuddy adapter is packaged without adding an undiscovered UI agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-codebuddy-'));
  const result = await installProject({ projectRoot: root, createDesktopShortcut: false, register: false, offline: true, discoverAgents: false });
  assert.equal(result.installed.codebuddy, true);
  const settings = JSON.parse(await readFile(join(root, '.codebuddy', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.SessionStart[0].hooks[0].type, 'command');
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  const codeBuddyServer = Object.values(mcp.mcpServers).find((server) => server.args?.at(-1) === 'codebuddy');
  assert.ok(codeBuddyServer);
  assert.equal(codeBuddyServer.args.at(-1), 'codebuddy');
  const plugin = JSON.parse(await readFile(join(root, '.live-dot-map', 'codebuddy-plugin', '.codebuddy-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'livedot-map');
  assert.equal(JSON.parse(await readFile(join(root, '.live-dot-map', 'codebuddy-plugin', '.workbuddy-plugin', 'plugin.json'), 'utf8')).name, 'livedot-map');
  assert.equal((await doctorProject({ projectRoot: root, checkBridge: false })).ok, true);
});

test('Claude and CodeBuddy keep distinct MCP identities when installed together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-mcp-identities-'));
  await installProject({ projectRoot: root, createDesktopShortcut: false, register: false, offline: true, discoverAgents: false });
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'));
  const identities = Object.values(mcp.mcpServers).map((server) => server.args?.at(-1));
  assert.ok(identities.includes('claude'));
  assert.ok(identities.includes('codebuddy'));
  assert.equal(new Set(identities).size, identities.length);
});

test('portable Node downloader does not fetch unless explicitly enabled', async () => {
  let fetched = false;
  const result = await downloadPortableNode({ destination: join(await mkdtemp(join(tmpdir(), 'livedot-runtime-')), 'node.zip'), allowDownload: false, fetchImpl: async () => { fetched = true; } });
  assert.equal(result.skipped, true);
  assert.equal(fetched, false);
  assert.match(portableManifestFor().sha256, /^[a-f0-9]{64}$/);
  assert.equal(verifyPortableNodeArchive(Buffer.from('abc'), '0'.repeat(64)).ok, false);
});

test('uninstall restores Agent configuration and preserves the project map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-uninstall-'));
  await mkdir(join(root, '.codex'), { recursive: true });
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(root, '.codex', 'config.toml'), 'user-config\n', 'utf8'));
  await installProject({ projectRoot: root, createDesktopShortcut: false, register: false, offline: true, platform: 'linux', discoverAgents: false });
  const result = await uninstallProject({ projectRoot: root, platform: 'linux' });
  assert.equal(result.ok, true);
  assert.equal(result.mapPreserved, true);
  assert.equal(await readFile(join(root, '.codex', 'config.toml'), 'utf8'), 'user-config\n');
  await assert.rejects(access(join(root, '.live-dot-map', 'agent-kit.json')));
  await assert.rejects(access(join(root, '.live-dot-map', 'livedot.mjs')));
});

test('failed install rolls back newly written configs, runtime and map', async () => {
  const root = await mkdtemp(join(tmpdir(), 'livedot-install-rollback-'));
  await mkdir(join(root, '.mcp.json'), { recursive: true });
  await assert.rejects(installProject({ projectRoot: root, createDesktopShortcut: false, register: false, offline: true, platform: 'linux', discoverAgents: false }));
  await assert.rejects(access(join(root, '.live-dot-map', 'map.json')));
  await assert.rejects(access(join(root, '.live-dot-map', 'livedot.mjs')));
  await assert.rejects(access(join(root, '.codex', 'config.toml')));
});
