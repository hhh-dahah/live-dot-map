import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
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
  const codexConfig = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
  assert.match(codexConfig, /mcp_servers\."livedot-map"/);
  assert.match(codexConfig, /required = false/);
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

test('installer removes only owned hook commands and preserves third-party hooks and matchers', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-hook-merge-'));
  const home = await mkdtemp(join(TEST_ROOT, 'livedot-hook-merge-home-'));
  const hooksPath = join(home, '.codex', 'hooks.json');
  await mkdir(join(home, '.codex'), { recursive: true });
  const helper = 'node C:\\tools\\livedot-helper.mjs --event session-start';
  const oldProduct = 'node C:\\old\\livedot.mjs hook --event session-start --agent codex';
  const original = {
    hooks: {
      SessionStart: [
        { matcher: '.*', metadata: { owner: 'team' }, hooks: [
          { type: 'command', command: helper, timeout: 5 },
          { type: 'command', command: oldProduct, timeout: 5 },
        ] },
        { matcher: 'custom', hooks: [{ type: 'prompt', prompt: 'keep this matcher' }] },
      ],
    },
    unknownSetting: { keep: true },
  };
  await writeFile(hooksPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');
  const result = await installProject({
    projectRoot: root,
    homeRoot: home,
    createDesktopShortcut: false,
    register: false,
    offline: true,
    platform: 'linux',
    detectedAgents: { codex: { id: 'codex', discovered: true } },
  });
  const installed = JSON.parse(await readFile(hooksPath, 'utf8'));
  const session = installed.hooks.SessionStart;
  assert.equal(session.length, 3, 'mixed third-party group, custom group, and one product group remain');
  assert.deepEqual(session[0], {
    matcher: '.*',
    metadata: { owner: 'team' },
    hooks: [{ type: 'command', command: helper, timeout: 5 }],
  });
  assert.deepEqual(session[1], original.hooks.SessionStart[1]);
  assert.equal(session[2].hooks.length, 1);
  assert.match(session[2].hooks[0].command, /hook/);
  assert.doesNotMatch(session[2].hooks[0].command, /old/);

  // 重装不会叠加产品 Hook，也不会改变第三方 group 的字节级结构。
  await installProject({
    projectRoot: root,
    homeRoot: home,
    createDesktopShortcut: false,
    register: false,
    offline: true,
    platform: 'linux',
    detectedAgents: { codex: { id: 'codex', discovered: true } },
  });
  const reinstalled = JSON.parse(await readFile(hooksPath, 'utf8'));
  assert.equal(reinstalled.hooks.SessionStart.length, 3);
  assert.deepEqual(reinstalled.hooks.SessionStart[0], session[0]);
  assert.deepEqual(reinstalled.hooks.SessionStart[1], session[1]);

  const config = JSON.parse(await readFile(join(root, '.live-dot-map', 'agent-kit.json'), 'utf8'));
  const backup = JSON.parse(await readFile(config.installBackup, 'utf8'));
  const captured = backup.files.find((entry) => entry.path === hooksPath);
  assert.ok(captured?.exists, 'original hook configuration is captured before write');
  assert.deepEqual(JSON.parse(Buffer.from(captured.content, 'base64').toString('utf8')), original);
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

test('antigravity adapter: fingerprint probe discovers AGY and writes mcp_config.json', async () => {
  const root = await mkdtemp(join(TEST_ROOT, 'livedot-agy-'));
  const home = await mkdtemp(join(TEST_ROOT, 'livedot-agy-home-'));
  // 指纹探测：无 PATH 命令时，~/.gemini/antigravity-ide 目录存在即视为已安装 AGY。
  await mkdir(join(home, '.gemini', 'antigravity-ide'), { recursive: true });
  await mkdir(join(home, '.gemini', 'config'), { recursive: true });
  await writeFile(join(home, '.gemini', 'config', 'config.json'), JSON.stringify({ userSettings: { globalPermissionGrants: { allow: ['command(pnpm build)'] } } }));
  const result = await installProject({ projectRoot: root, homeRoot: home, createDesktopShortcut: false, register: false, offline: true, platform: 'win32', discoverAgents: true });
  assert.equal(result.installed.antigravity, true);
  const config = JSON.parse(await readFile(join(home, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
  const server = config.mcpServers['livedot-map'];
  assert.ok(server, 'mcp_config.json 必须包含 livedot-map 服务器');
  assert.equal(server.command, process.execPath);
  assert.equal(server.args.includes('mcp'), true);
  assert.equal(server.args.includes('--agent'), true);
  assert.equal(server.args.at(-1), 'antigravity');
  assert.equal(server.args.includes('--project'), false, '全局 MCP 配置不带 --project');
  // AGY IDE 兜底同名配置也写入。
  const ideConfig = JSON.parse(await readFile(join(home, '.gemini', 'antigravity-ide', 'mcp_config.json'), 'utf8'));
  assert.equal(ideConfig.mcpServers['livedot-map'].args.at(-1), 'antigravity');
  // 全局权限白名单自动预授权 25 项工具与通配符，免除弹窗逐条审批
  const globalConfig = JSON.parse(await readFile(join(home, '.gemini', 'config', 'config.json'), 'utf8'));
  assert.ok(globalConfig.userSettings.globalPermissionGrants.allow.includes('mcp(livedot-map/map_get_context)'));
  assert.ok(globalConfig.userSettings.globalPermissionGrants.allow.includes('mcp(livedot-map/*)'));
  assert.ok(globalConfig.userSettings.globalPermissionGrants.allow.includes('command(pnpm build)'), '保留既有权限');
  // doctor 认可 antigravity 安装项。
  const doctor = await doctorProject({ projectRoot: root, homeRoot: home, checkBridge: false });
  assert.equal(doctor.ok, true);
  // 卸载：配置与 AGY 缓存目录一并清理。
  await uninstallProject({ projectRoot: root, platform: 'win32' });
  await assert.rejects(access(join(home, '.gemini', 'antigravity-ide', 'mcp_config.json')));
  await assert.rejects(access(join(home, '.gemini', 'config', 'mcp_config.json')));
});
