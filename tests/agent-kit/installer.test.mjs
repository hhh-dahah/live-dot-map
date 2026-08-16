import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { installProject, doctorProject, uninstallProject } from '../../agent-kit/lib/installer.mjs';
import { downloadPortableNode, portableManifestFor, verifyPortableNodeArchive } from '../../agent-kit/lib/portable-node.mjs';

const TEST_ROOT = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');
await mkdir(TEST_ROOT, { recursive: true });

// 2026-08-15 全局化：插件安装到用户 Agent 全局（homeRoot），项目里只放数据（map.json + 最小状态文件）。

test('install writes global agent plugins while keeping the project data-only', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-agent-kit-'));
  const home = await mkdtemp(join(TEST_ROOT, 'livedot-agent-home-'));
  const result = await installProject({ projectRoot: root, homeRoot: home, createDesktopShortcut: false, register: false, offline: true });
  assert.equal(result.ok, true);
  const config = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-kit.json'), 'utf8'));
  assert.equal(config.version, 2);
  assert.equal(config.projectRoot, root);
  assert.equal(config.homeRoot, home);
  // 多地图布局：新装项目写 maps/default/map.json + active-map 指针，不再写老路径 map.json。
  const dataEntries0 = await readdir(join(root, '.live-dot-map'));
  assert.equal(dataEntries0.includes('map.json'), false, '项目根不再写老路径 map.json');
  assert.equal(dataEntries0.includes('maps'), true);
  assert.equal(dataEntries0.includes('active-map'), true);
  // 项目零配置：项目内不再出现 .codex/.claude/.kimi-code/.codebuddy/.mcp.json/hook.cmd。
  const projectEntries = await readdir(root);
  for (const forbidden of ['.codex', '.claude', '.kimi-code', '.codebuddy', '.mcp.json']) {
    assert.equal(projectEntries.includes(forbidden), false, `project must not contain ${forbidden}`);
  }
  const dataEntries = await readdir(join(root, '.live-dot-map'));
  assert.equal(dataEntries.includes('hook.cmd'), false, 'project must not contain hook.cmd');
  // 全局插件：skill / MCP / hooks 在用户 home 下。
  assert.match(await readFile(join(home, '.codex', 'skills', 'live-dot-map', 'SKILL.md'), 'utf8'), /map_plan_consolidation/);
  const map = JSON.parse(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'map.json'), 'utf8'));
  assert.equal(map.version, 2);
  assert.equal(map.mapId, result.projectId);
  assert.equal(map.mapDir, '.live-dot-map/maps/default');
  assert.equal((await readFile(join(root, '.live-dot-map', 'active-map'), 'utf8')).trim(), 'default');
  assert.equal(result.bridge.registered, true);
  assert.match(await readFile(join(home, '.codex', 'config.toml'), 'utf8'), /mcp_servers\."livedot-map"/);
  assert.equal(JSON.parse(await readFile(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.Stop[0].hooks[0].type, 'command');
  await installProject({ projectRoot: root, homeRoot: home, createDesktopShortcut: false, register: false, offline: true, discoverAgents: false });
  const reinstalledHooks = JSON.parse(await readFile(join(home, '.codex', 'hooks.json'), 'utf8')).hooks;
  assert.equal(reinstalledHooks.SessionStart.length, 1);
  assert.equal(reinstalledHooks.UserPromptSubmit.length, 1);
  assert.equal(reinstalledHooks.Stop.length, 1);
  const claudeSettings = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(claudeSettings.hooks.SessionStart.length, 1);
  // 全局 MCP 配置不带 --project（桥用 Agent 当前工作目录）。
  assert.equal(claudeSettings.mcpServers['livedot-map'].args.includes('mcp'), true);
  assert.equal(claudeSettings.mcpServers['livedot-map'].args.includes('--project'), false);
  assert.equal(JSON.parse(await readFile(join(home, '.kimi-code', 'mcp.json'), 'utf8')).mcpServers['livedot-map'].command, process.execPath);
  assert.equal(claudeSettings.mcpServers['livedot-map'].command, process.execPath);
  assert.ok((await readFile(join(home, '.codex', 'config.toml'), 'utf8')).includes(`command = ${JSON.stringify(process.execPath)}`));
  const kimi = JSON.parse(await readFile(join(home, '.kimi-code', 'plugins', 'live-dot-map', 'kimi.plugin.json'), 'utf8'));
  assert.equal(Array.isArray(kimi.hooks), true);
  assert.equal(kimi.mcpServers['livedot-map'].args[0], './runtime/livedot.mjs');
  const doctor = await doctorProject({ projectRoot: root, homeRoot: home, checkBridge: false });
  assert.equal(doctor.ok, true);
});

test('optional CodeBuddy adapter is packaged without adding an undiscovered UI agent', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-codebuddy-'));
  const home = await mkdtemp(join(TEST_ROOT, 'livedot-codebuddy-home-'));
  const result = await installProject({ projectRoot: root, homeRoot: home, createDesktopShortcut: false, register: false, offline: true, discoverAgents: false });
  assert.equal(result.installed.codebuddy, true);
  const settings = JSON.parse(await readFile(join(home, '.codebuddy', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.SessionStart[0].hooks[0].type, 'command');
  const codeBuddyServer = Object.values(settings.mcpServers).find((server) => server.args?.at(-1) === 'codebuddy');
  assert.ok(codeBuddyServer);
  assert.equal(codeBuddyServer.args.at(-1), 'codebuddy');
  assert.equal(codeBuddyServer.args.includes('--project'), false);
  const plugin = JSON.parse(await readFile(join(home, '.codebuddy', 'plugins', 'live-dot-map', '.codebuddy-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'livedot-map');
  assert.equal(JSON.parse(await readFile(join(home, '.codebuddy', 'plugins', 'live-dot-map', '.workbuddy-plugin', 'plugin.json'), 'utf8')).name, 'livedot-map');
  assert.equal((await doctorProject({ projectRoot: root, homeRoot: home, checkBridge: false })).ok, true);
});

test('Claude and CodeBuddy keep distinct MCP identities when installed together', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-mcp-identities-'));
  const home = await mkdtemp(join(TEST_ROOT, 'livedot-mcp-identities-home-'));
  await installProject({ projectRoot: root, homeRoot: home, createDesktopShortcut: false, register: false, offline: true, discoverAgents: false });
  // Claude 与 CodeBuddy 各自写入各自的全局 settings.json，MCP 身份不混淆。
  const claudeSettings = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
  const claudeIdentity = Object.values(claudeSettings.mcpServers).map((server) => server.args?.at(-1));
  assert.ok(claudeIdentity.includes('claude'));
  const codebuddySettings = JSON.parse(await readFile(join(home, '.codebuddy', 'settings.json'), 'utf8'));
  const codebuddyIdentity = Object.values(codebuddySettings.mcpServers).map((server) => server.args?.at(-1));
  assert.ok(codebuddyIdentity.includes('codebuddy'));
  assert.equal(new Set([...claudeIdentity, ...codebuddyIdentity]).size, claudeIdentity.length + codebuddyIdentity.length);
});

test('portable Node downloader does not fetch unless explicitly enabled', async () => {
  let fetched = false;
  const result = await downloadPortableNode({ destination: join(await mkdtemp(join(TEST_ROOT, 'livedot-runtime-')), 'node.zip'), allowDownload: false, fetchImpl: async () => { fetched = true; } });
  assert.equal(result.skipped, true);
  assert.equal(fetched, false);
  assert.match(portableManifestFor().sha256, /^[a-f0-9]{64}$/);
  assert.equal(verifyPortableNodeArchive(Buffer.from('abc'), '0'.repeat(64)).ok, false);
});

test('uninstall restores global Agent configuration and preserves the project map', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-uninstall-'));
  const home = await mkdtemp(join(TEST_ROOT, 'livedot-uninstall-home-'));
  await mkdir(join(home, '.codex'), { recursive: true });
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(home, '.codex', 'config.toml'), 'user-config\n', 'utf8'));
  await installProject({ projectRoot: root, homeRoot: home, createDesktopShortcut: false, register: false, offline: true, platform: 'linux', discoverAgents: false });
  const result = await uninstallProject({ projectRoot: root, platform: 'linux' });
  assert.equal(result.ok, true);
  assert.equal(result.mapPreserved, true);
  assert.equal(await readFile(join(home, '.codex', 'config.toml'), 'utf8'), 'user-config\n');
  await assert.rejects(access(join(root, '.live-dot-map', 'agent-kit.json')));
  await assert.rejects(access(join(root, '.live-dot-map', 'livedot.mjs')));
});

test('failed install rolls back newly written configs, runtime and map', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-install-rollback-'));
  const home = await mkdtemp(join(TEST_ROOT, 'livedot-install-rollback-home-'));
  // 用目录占位全局 config.toml，使 atomicText 的 rename 失败，触发安装回滚。
  await mkdir(join(home, '.codex', 'config.toml'), { recursive: true });
  await assert.rejects(installProject({ projectRoot: root, homeRoot: home, createDesktopShortcut: false, register: false, offline: true, platform: 'linux', discoverAgents: false }));
  await assert.rejects(access(join(root, '.live-dot-map', 'map.json')));
  await assert.rejects(access(join(root, '.live-dot-map', 'maps')));
  await assert.rejects(access(join(root, '.live-dot-map', 'active-map')));
  await assert.rejects(access(join(root, '.live-dot-map', 'livedot.mjs')));
});
