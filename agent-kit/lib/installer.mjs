import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertLoopbackUrl, projectIdForRoot } from './bridge-client.mjs';
import { windowsDesktopDirectory } from './shortcut.mjs';
import { portableManifestFor, runtimePlan } from './portable-node.mjs';
import MAP_TEMPLATE from '../map.template.json' with { type: 'json' };

const ADAPTERS = Object.freeze(['codex', 'claude-code', 'kimi-code']);
const OPTIONAL_ADAPTERS = Object.freeze(['codebuddy']);
const ALL_ADAPTERS = Object.freeze([...ADAPTERS, ...OPTIONAL_ADAPTERS]);

// 2026-08-15 全局化：插件（skill/MCP/hook）安装到用户 Agent 全局，项目里只放数据。
const skillTargetPaths = (home, id) => id === 'codex'
  ? join(home, '.codex', 'skills', 'live-dot-map', 'SKILL.md')
  : id === 'claude-code'
    ? join(home, '.claude', 'skills', 'live-dot-map', 'SKILL.md')
    : id === 'kimi-code'
      ? join(home, '.kimi-code', 'plugins', 'live-dot-map', 'skills', 'live-dot-map', 'SKILL.md')
      : join(home, '.codebuddy', 'plugins', 'live-dot-map', 'skills', 'live-dot-map', 'SKILL.md');

const kimiPluginRoot = (home) => join(home, '.kimi-code', 'plugins', 'live-dot-map');
const codebuddyPluginRoot = (home) => join(home, '.codebuddy', 'plugins', 'live-dot-map');

const ADAPTER_PROBES = Object.freeze({
  codex: ['codex'],
  'claude-code': ['claude', 'claude-code'],
  'kimi-code': ['kimi', 'kimi-code'],
  codebuddy: ['codebuddy', 'codebuddy-code', 'workbuddy'],
});

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

async function atomicText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
  await rename(temp, path);
}

async function atomicJson(path, value) {
  await atomicText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path, fallback = {}) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch { return fallback; }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function captureFile(path) {
  try {
    const metadata = await stat(path);
    if (metadata.isDirectory()) return { path, exists: true, kind: 'directory', sha256: null, content: null };
    const bytes = await readFile(path);
    return { path, exists: true, kind: 'file', sha256: sha256(bytes), content: bytes.toString('base64') };
  } catch {
    return { path, exists: false, kind: 'missing', sha256: null, content: null };
  }
}

async function restoreCapturedFile(entry) {
  if (entry?.kind === 'directory') return;
  if (entry?.exists) {
    await mkdir(dirname(entry.path), { recursive: true });
    await writeFile(entry.path, Buffer.from(String(entry.content || ''), 'base64'));
  } else {
    await rm(entry.path, { force: true }).catch(() => undefined);
  }
}

const adapterConfigPaths = (home, id) => id === 'codex'
  ? [join(home, '.codex', 'config.toml'), join(home, '.codex', 'hooks.json')]
  : id === 'claude-code'
    ? [join(home, '.claude', 'settings.json')]
    : id === 'kimi-code'
      ? [join(home, '.kimi-code', 'mcp.json'), join(kimiPluginRoot(home), 'kimi.plugin.json')]
      : [join(home, '.codebuddy', 'settings.json'), join(codebuddyPluginRoot(home), '.codebuddy-plugin', 'plugin.json'), join(codebuddyPluginRoot(home), '.workbuddy-plugin', 'plugin.json'), join(codebuddyPluginRoot(home), 'hooks', 'hooks.json')];

function seaRuntime() {
  return process.env.LIVEDOT_SEA === '1';
}

function runtimeArgs(runtime) {
  return seaRuntime() ? [] : [runtime];
}

// 全局化后 hook 命令直接指向桥可执行文件（绝对路径），不带 --project（桥用 Agent 当前工作目录）。
function command(nodeCommand, runtime, agent, event) {
  const invocation = [nodeCommand, ...runtimeArgs(runtime), 'hook', '--event', event, '--agent', agent]
    .map((part) => /[\s"]/.test(part) ? `"${part}"` : part)
    .join(' ');
  return process.platform === 'win32' ? ['cmd', '/d', '/s', '/c', invocation].join(' ') : invocation;
}

function execProbe(file, args = []) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 4_000 }, (error, stdout = '') => {
      resolve(!error && String(stdout).trim().length > 0);
    });
  });
}

function execText(file, args = [], timeout = 2_500) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, encoding: 'utf8' }, (error, stdout = '') => {
      resolve(error ? '' : String(stdout));
    });
  });
}

async function commandExists(file) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return execProbe(locator, [file]);
}

async function discoverEmbeddedCodeBuddy({ platform = process.platform } = {}) {
  if (platform !== 'win32') return null;
  // WorkBuddy ships CodeBuddy Code inside its Electron bundle rather than
  // putting `codebuddy` on PATH. Read only uninstall metadata; never launch
  // the product or inspect credentials.
  const registryRoots = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  const outputs = await Promise.all(registryRoots.map((root) => execText('reg.exe', ['query', root, '/s', '/v', 'DisplayIcon'])));
  const iconPaths = outputs.flatMap((output) => String(output).split(/\r?\n/).flatMap((line) => {
    if (!/workbuddy/i.test(line) || !/REG_SZ/i.test(line)) return [];
    const match = line.match(/REG_SZ\s+(.+)$/i);
    if (!match) return [];
    return [match[1].trim().replace(/^"|"$/g, '').replace(/,\d+$/, '')];
  }));
  for (const iconPath of iconPaths) {
    const installRoot = dirname(iconPath);
    const candidate = join(installRoot, 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** 只报告实际存在的 Agent；全局已配置也算已发现，避免覆盖陌生平台。 */
export async function detectInstalledAdapters({ projectRoot = process.cwd(), platform = process.platform, homeRoot = homedir() } = {}) {
  const root = resolve(projectRoot);
  const home = resolve(homeRoot);
  const checks = await Promise.all(ALL_ADAPTERS.map(async (id) => {
    const configPaths = adapterConfigPaths(home, id);
    const configured = (await Promise.all(configPaths.map(async (path) => {
      const text = await readFile(path, 'utf8').catch(() => '');
      return text.includes('livedot-map');
    }))).some(Boolean);
    const probes = platform === 'win32' || platform === 'darwin' || platform === 'linux' ? ADAPTER_PROBES[id] : [];
    let executable = false;
    for (const probe of probes) {
      if (await commandExists(probe)) { executable = true; break; }
    }
    const embeddedPath = id === 'codebuddy' && !executable ? await discoverEmbeddedCodeBuddy({ platform }) : null;
    return [id, { id, configured, executable: executable || Boolean(embeddedPath), executableSource: embeddedPath ? 'workbuddy-embedded' : null, discovered: configured || executable || Boolean(embeddedPath) }];
  }));
  return Object.fromEntries(checks);
}

function hooksFor(nodeCommand, runtime, agent) {
  return Object.fromEntries([
    ['SessionStart', 'session-start'],
    ['UserPromptSubmit', 'user-prompt'],
    ['Stop', 'stop'],
  ].map(([name, event]) => [name, [{ hooks: [{ type: 'command', command: command(nodeCommand, runtime, agent, event), timeout: 30 }] }]]));
}

const HOOK_EVENTS = Object.freeze({
  SessionStart: ['session-start', 'sessionstart'],
  UserPromptSubmit: ['user-prompt', 'userpromptsubmit'],
  Stop: ['stop'],
});

/**
 * Only identify the product executable/script itself, never an arbitrary
 * command that happens to contain the word "livedot".  The event check is
 * intentional: a user's helper named livedot.mjs is not a product hook just
 * because it appears in a group.
 */
export function isLiveDotHookCommand(value, eventName) {
  const commandText = String(value ?? '').trim();
  if (!commandText) return false;
  const normalized = commandText.replace(/["']/g, '').replace(/\\/g, '/').toLowerCase();
  const eventTokens = HOOK_EVENTS[eventName] || [];
  const hasEvent = eventTokens.some((token) => new RegExp(`(?:^|[^a-z0-9])${token}(?:$|[^a-z0-9])`, 'i').test(normalized));
  if (!hasEvent) return false;

  const hasProductScript = /(?:^|\/)livedot\.mjs(?:$|\s)/i.test(normalized);
  const hasProductExecutable = /(?:^|\/)livedot(?:-bridge(?:-[a-z0-9_-]+)?|)\.exe(?:$|\s)/i.test(normalized);
  const hasScopedLegacyLauncher = /(?:^|\/)hook\.cmd(?:$|\s)/i.test(normalized)
    && /(?:^|\/)(?:\.live-dot-map|live-dot-map|livedotmap)(?:\/|$)/i.test(normalized);
  if (!(hasProductScript || hasProductExecutable || hasScopedLegacyLauncher)) return false;
  // A known product file still must be used by the hook entry, not merely
  // mentioned in an unrelated matcher or environment value.
  return /(?:^|[^a-z0-9])hook(?:$|[^a-z0-9])/i.test(normalized) || hasScopedLegacyLauncher;
}

function stripOwnedHookGroup(group, eventName) {
  if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.hooks)) return group;
  const kept = group.hooks.filter((hook) => !(hook && typeof hook === 'object' && hook.type === 'command' && isLiveDotHookCommand(hook.command, eventName)));
  if (!kept.length) return null;
  return { ...group, hooks: kept };
}

export function mergeHooks(existing, additions) {
  const hooks = { ...(existing?.hooks || {}) };
  for (const [event, groups] of Object.entries(additions)) {
    const prior = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = prior
      .map((group) => stripOwnedHookGroup(group, event))
      .filter((group) => group !== null);
    hooks[event] = [...kept, ...groups];
  }
  return { ...existing, hooks };
}

function mcpAgentOf(server) {
  const args = Array.isArray(server?.args) ? server.args : [];
  const index = args.indexOf('--agent');
  return index >= 0 ? args[index + 1] : null;
}

// Claude Code and CodeBuddy both read the project-level .mcp.json. Keep the
// historical `livedot-map` name for a single adapter, but never let the last
// adapter silently replace another adapter's agent identity.
function mcpServerKey(mcp, agent) {
  const base = mcp?.mcpServers?.['livedot-map'];
  if (!base || mcpAgentOf(base) === agent) return 'livedot-map';
  return `livedot-map-${agent}`;
}

function tomlString(value) { return JSON.stringify(String(value)); }

async function writeCodexConfig(home, nodeCommand, runtime) {
  const path = join(home, '.codex', 'config.toml');
  const begin = '# BEGIN LIVE-DOT-MAP';
  const end = '# END LIVE-DOT-MAP';
  const old = await readFile(path, 'utf8').catch(() => '');
  const stripped = old.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\s*`, 'g'), '').trimEnd();
  // 全局 MCP 配置不带 --project：桥 mcp 命令使用 Agent 当前工作目录。
  const block = [begin, '[mcp_servers."livedot-map"]', `command = ${tomlString(nodeCommand)}`, `args = [${[...runtimeArgs(runtime), 'mcp', '--agent', 'codex'].map(tomlString).join(', ')}]`, 'required = false', end].join('\n');
  await atomicText(path, `${stripped ? `${stripped}\n\n` : ''}${block}\n`);
  const hooksPath = join(home, '.codex', 'hooks.json');
  await atomicJson(hooksPath, mergeHooks(await readJson(hooksPath), hooksFor(nodeCommand, runtime, 'codex')));
  return [path, hooksPath];
}

async function writeClaudeConfig(home, nodeCommand, runtime) {
  const settingsPath = join(home, '.claude', 'settings.json');
  const settings = await readJson(settingsPath);
  const mcp = { mcpServers: settings.mcpServers && typeof settings.mcpServers === 'object' ? settings.mcpServers : {} };
  const key = mcpServerKey(mcp, 'claude');
  mcp.mcpServers = { ...(mcp.mcpServers || {}), [key]: { type: 'stdio', command: nodeCommand, args: [...runtimeArgs(runtime), 'mcp', '--agent', 'claude'] } };
  settings.mcpServers = mcp.mcpServers;
  await atomicJson(settingsPath, mergeHooks(settings, hooksFor(nodeCommand, runtime, 'claude')));
  return [settingsPath];
}

async function writeKimiConfig(home, nodeCommand, runtime) {
  const mcpPath = join(home, '.kimi-code', 'mcp.json');
  const mcp = await readJson(mcpPath);
  mcp.mcpServers = { ...(mcp.mcpServers || {}), 'livedot-map': { command: nodeCommand, args: [...runtimeArgs(runtime), 'mcp', '--agent', 'kimi'] } };
  await atomicJson(mcpPath, mcp);

  // Kimi 全局插件：生命周期 hooks 以本地插件形式安装到 ~/.kimi-code/plugins/live-dot-map。
  const plugin = kimiPluginRoot(home);
  const pluginRuntime = join(plugin, 'runtime', 'livedot.mjs');
  await mkdir(dirname(pluginRuntime), { recursive: true });
  if (!seaRuntime()) await copyFile(runtime, pluginRuntime);
  const manifest = {
    name: 'livedot-map', version: '2.0.0', description: '活点地图人机协作闭环',
    mcpServers: { 'livedot-map': { command: nodeCommand, args: [...(seaRuntime() ? [] : ['./runtime/livedot.mjs']), 'mcp', '--agent', 'kimi'] } },
    hooks: [
      { event: 'SessionStart', command: command(nodeCommand, runtime, 'kimi', 'session-start'), timeout: 30 },
      { event: 'UserPromptSubmit', command: command(nodeCommand, runtime, 'kimi', 'user-prompt'), timeout: 30 },
      { event: 'Stop', command: command(nodeCommand, runtime, 'kimi', 'stop'), timeout: 30 },
    ],
  };
  await atomicJson(join(plugin, 'kimi.plugin.json'), manifest);
  return [mcpPath, join(plugin, 'kimi.plugin.json')];
}

async function writeCodeBuddyConfig(home, nodeCommand, runtime) {
  const settingsPath = join(home, '.codebuddy', 'settings.json');
  const settings = await readJson(settingsPath);
  const mcp = { mcpServers: settings.mcpServers && typeof settings.mcpServers === 'object' ? settings.mcpServers : {} };
  const key = mcpServerKey(mcp, 'codebuddy');
  mcp.mcpServers = { ...(mcp.mcpServers || {}), [key]: { type: 'stdio', command: nodeCommand, args: [...runtimeArgs(runtime), 'mcp', '--agent', 'codebuddy'] } };
  settings.mcpServers = mcp.mcpServers;
  await atomicJson(settingsPath, mergeHooks(settings, hooksFor(nodeCommand, runtime, 'codebuddy')));

  // CodeBuddy Code 接受 Claude 兼容插件布局；hooks 保持 fail-open 直到用户在插件面板批准。
  const plugin = codebuddyPluginRoot(home);
  const manifest = {
    name: 'livedot-map', version: '2.0.0', description: '活点地图人机协作闭环（腾讯系 Agent）',
    hooks: './hooks/hooks.json', mcpServers: { 'livedot-map': { command: nodeCommand, args: [...runtimeArgs(runtime), 'mcp', '--agent', 'codebuddy'] } },
  };
  await atomicJson(join(plugin, '.codebuddy-plugin', 'plugin.json'), manifest);
  await atomicJson(join(plugin, '.workbuddy-plugin', 'plugin.json'), manifest);
  await atomicJson(join(plugin, 'hooks', 'hooks.json'), { hooks: hooksFor(nodeCommand, runtime, 'codebuddy') });
  return [settingsPath, join(plugin, '.codebuddy-plugin', 'plugin.json'), join(plugin, '.workbuddy-plugin', 'plugin.json'), join(plugin, 'hooks', 'hooks.json')];
}

export function adapterManifest({ sourceRoot = process.cwd() } = {}) {
  const root = resolve(sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : sourceRoot);
  return Object.fromEntries(ALL_ADAPTERS.map((id) => [id, { id, optional: OPTIONAL_ADAPTERS.includes(id), source: join(root, 'adapters', id) }]));
}

export async function installProject({
  projectRoot = process.cwd(), sourceRoot, runtimeSource, appPath, bridgeUrl = '', bridgeClient, register = true,
  createDesktopShortcut = true, offline = true, platform = process.platform, env = process.env, exec,
  discoverAgents = true, detectedAgents = null, homeRoot = homedir(),
} = {}) {
  const root = resolve(projectRoot);
  const home = resolve(homeRoot);
  if (!(await exists(root))) throw new Error(`项目目录不存在: ${root}`);
  const source = resolve(sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : (sourceRoot || process.cwd()));
  const sourceRuntime = resolve(runtimeSource || resolve(source, 'livedot.mjs'));
  const canonicalCandidates = [resolve(source, 'skills', 'live-dot-map', 'SKILL.md'), resolve(source, 'agent-kit', 'skills', 'live-dot-map', 'SKILL.md')];
  let canonicalSkill = null;
  for (const candidate of canonicalCandidates) if (await exists(candidate)) { canonicalSkill = candidate; break; }
  if (!canonicalSkill || !(await exists(canonicalSkill))) throw new Error(`缺少 canonical Skill: ${canonicalCandidates[0]}`);
  if (!seaRuntime() && !(await exists(sourceRuntime))) throw new Error(`缺少已构建运行时: ${sourceRuntime}`);
  const dataDir = join(root, '.live-dot-map');
  // 全局化：运行时（非 SEA 模式）复制到用户全局数据目录，项目里只放 map/md 数据。
  const globalDataDir = join(home, '.live-dot-map');
  const runtime = seaRuntime() ? null : join(globalDataDir, 'livedot.mjs');
  await mkdir(dataDir, { recursive: true });
  const projectId = projectIdForRoot(root);
  const mapPath = join(dataDir, 'map.json');
  const configPath = join(dataDir, 'agent-kit.json');
  const old = await readJson(configPath);
  const url = bridgeUrl || old?.bridge?.url || 'http://127.0.0.1:0';
  assertLoopbackUrl(url);
  const nodeCommand = process.execPath;
  const detected = detectedAgents && typeof detectedAgents === 'object'
    ? detectedAgents
    : discoverAgents
      ? await detectInstalledAdapters({ projectRoot: root, platform, homeRoot: home })
      : Object.fromEntries(ALL_ADAPTERS.map((id) => [id, { id, configured: false, executable: false, discovered: true }]));
  const installed = {};
  for (const id of ALL_ADAPTERS) if (detected[id]?.discovered) installed[id] = true;
  const backupPath = join(globalDataDir, 'backups', `agent-kit-install-${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  const beforeBackup = await captureFile(backupPath);
  const oldRuntime = runtime ? await captureFile(runtime) : { exists: false, kind: 'missing', path: null };
  const oldMap = await captureFile(mapPath);
  // 多地图布局：老项目已迁移时 maps/ 存在，绝不再往单图老路径写模板。
  const mapsLayoutExists = await exists(join(dataDir, 'maps'));
  let createdMapsLayout = false;
  const touched = new Set([configPath, ...(runtime ? [runtime] : [])]);
  for (const id of new Set([...Object.keys(old.installed || {}), ...Object.keys(installed)])) for (const path of adapterConfigPaths(home, id)) touched.add(path);
  for (const id of Object.keys(installed)) touched.add(skillTargetPaths(home, id));
  const existingBackup = await readJson(backupPath, null);
  const backupFiles = new Map(Array.isArray(existingBackup?.files) ? existingBackup.files.map((entry) => [entry.path, entry]) : []);
  for (const path of touched) if (!backupFiles.has(path)) backupFiles.set(path, await captureFile(path));
  const backup = existingBackup?.version === 1 && Array.isArray(existingBackup.files)
    ? { ...existingBackup, files: [...backupFiles.values()] }
    : { version: 1, createdAt: new Date().toISOString(), projectRoot: root, files: [...backupFiles.values()] };

  const rollback = async () => {
    for (const entry of backup.files) await restoreCapturedFile(entry);
    await restoreCapturedFile(beforeBackup);
    if (!oldMap.exists) await rm(mapPath, { force: true }).catch(() => undefined);
    if (createdMapsLayout) {
      await rm(join(dataDir, 'maps'), { recursive: true, force: true }).catch(() => undefined);
      await rm(join(dataDir, 'active-map'), { force: true }).catch(() => undefined);
    }
    if (runtime && !oldRuntime.exists) await rm(runtime, { force: true }).catch(() => undefined);
  };

  try {
    await atomicJson(backupPath, backup);
    if (runtime && resolve(sourceRuntime) !== resolve(runtime)) {
      await mkdir(globalDataDir, { recursive: true });
      await copyFile(sourceRuntime, runtime);
    }
    for (const id of Object.keys(installed)) {
      const target = skillTargetPaths(home, id);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(canonicalSkill, target);
    }
    if (!oldMap.exists && !mapsLayoutExists) {
      // 全新项目：按多地图布局写 maps/default/map.json + active-map 指针
      const map = structuredClone(MAP_TEMPLATE);
      if (map.version !== 2) throw new Error('内置 map.json 模板不是 v2');
      const now = new Date().toISOString();
      map.mapId = projectId;
      map.name = basename(root);
      map.createdAt = now;
      map.updatedAt = now;
      map.mapDir = '.live-dot-map/maps/default';
      for (const collection of ['routes', 'nodes', 'edges', 'anns']) for (const item of Array.isArray(map[collection]) ? map[collection] : []) {
        item.createdAt = now;
        item.updatedAt = now;
        item.updatedBy = 'installer';
        // Markdown 分片路径随地图目录改写
        if (typeof item.md === 'string' && item.md.startsWith('.live-dot-map/')) {
          item.md = `.live-dot-map/maps/default${item.md.slice('.live-dot-map'.length)}`;
        }
      }
      await atomicJson(join(dataDir, 'maps', 'default', 'map.json'), map);
      await atomicText(join(dataDir, 'active-map'), 'default\n');
      createdMapsLayout = true;
    }
    if (installed.codex) await writeCodexConfig(home, nodeCommand, runtime);
    if (installed['claude-code']) await writeClaudeConfig(home, nodeCommand, runtime);
    if (installed['kimi-code']) await writeKimiConfig(home, nodeCommand, runtime);
    if (installed.codebuddy) await writeCodeBuddyConfig(home, nodeCommand, runtime);
    const config = {
      ...old, version: 2, projectId: old.projectId || projectId, projectRoot: root, runtime, runtimeMode: seaRuntime() ? 'sea' : 'node', nodeCommand, homeRoot: home, detectedAgents: detected,
      trust: { ...(old.trust && typeof old.trust === 'object' ? old.trust : {}), ...Object.fromEntries(Object.keys(installed).map((id) => [id, { acknowledged: old.trust?.[id]?.acknowledged === true, updatedAt: old.trust?.[id]?.updatedAt || null }])) },
      bridge: { url, tokenEnv: 'LIVEDOT_BRIDGE_TOKEN', sessionEnv: 'LIVEDOT_SESSION_ID' },
      installed, installBackup: backupPath, installedFiles: Object.fromEntries([...touched].map((path) => [path, null])), installedAt: old.installedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    for (const path of touched) {
      const current = await captureFile(path);
      config.installedFiles[path] = current.sha256;
    }
    await atomicJson(configPath, config);

    const result = { ok: true, projectRoot: root, projectId: config.projectId, configPath, runtime, installed, detectedAgents: detected, bridge: { registered: true, mode: 'project-config' }, shortcut: null,
      trustRequired: Object.fromEntries(Object.keys(installed).map((id) => [id, id === 'codex' ? '在 Codex 全局 hooks 中确认活点地图 hook（一次性）' : id === 'claude-code' ? '在 Claude Code 设置中确认 hooks 与 MCP（一次性）' : id === 'kimi-code' ? `在 Kimi 执行 /plugins install ${kimiPluginRoot(home)}` : '在 WorkBuddy/CodeBuddy 插件面板审核并启用 hooks 与 MCP'])), runtimePlan: runtimePlan({ offline }) };
    if (register && bridgeClient) { result.bridge.registration = await bridgeClient.openProject(root); result.bridge.mode = 'live-bridge'; }
    // The product installer owns the single user-facing “活点地图” entry.
    // Project configuration must not create a second shortcut that exposes a
    // bridge/service implementation detail or starts a stale project root.
    if (createDesktopShortcut && platform === 'win32') {
      result.shortcut = { ok: true, skipped: true, reason: 'product-installer-manages-shortcut' };
    }
    return result;
  } catch (error) {
    await rollback();
    throw error;
  }
}

export async function uninstallProject({ projectRoot = process.cwd(), platform = process.platform, env = process.env, exec } = {}) {
  const root = resolve(projectRoot);
  const dataDir = join(root, '.live-dot-map');
  const configPath = join(dataDir, 'agent-kit.json');
  const config = await readJson(configPath, null);
  if (!config || typeof config !== 'object') return { ok: false, reason: 'not-installed', projectRoot: root, mapPreserved: await exists(join(dataDir, 'map.json')) || await exists(join(dataDir, 'maps')) };
  const backupPath = typeof config.installBackup === 'string' ? config.installBackup : join(dataDir, 'backups', 'agent-kit-install.json');
  const backup = await readJson(backupPath, null);
  const installedFiles = config.installedFiles && typeof config.installedFiles === 'object' ? config.installedFiles : {};
  const restored = [];
  const skipped = [];
  for (const entry of Array.isArray(backup?.files) ? backup.files : []) {
    if (!entry?.path || entry.path === join(dataDir, 'map.json') || entry.path === backupPath) continue;
    const current = await captureFile(entry.path);
    const expected = installedFiles[entry.path];
    let configOwned = false;
    if (entry.path === configPath && current.exists) {
      try {
        const parsed = JSON.parse(Buffer.from(String(current.content || ''), 'base64').toString('utf8'));
        configOwned = parsed?.installBackup === backupPath && parsed?.projectRoot === root;
      } catch { /* 用户改成了非 JSON 配置，不覆盖 */ }
    }
    if ((expected && current.sha256 === expected) || configOwned) {
      await restoreCapturedFile(entry);
      restored.push(entry.path);
    } else if (!current.exists && !entry.exists) {
      restored.push(entry.path);
    } else if (current.sha256 === entry.sha256) {
      await restoreCapturedFile(entry);
      restored.push(entry.path);
    } else {
      skipped.push({ path: entry.path, reason: 'after-install-change' });
    }
  }
  const launcherPaths = [join(dataDir, '启动活点地图.cmd'), join(dataDir, '打开活点地图.cmd')];
  if (platform === 'win32') {
    const desktop = windowsDesktopDirectory({ platform, env, exec });
    launcherPaths.push(join(desktop, '活点地图本地桥.lnk'), join(desktop, '活点地图本地桥.cmd'));
  }
  for (const path of launcherPaths) {
    const current = await captureFile(path);
    if (!current.exists) continue;
    const looksOwned = path.includes(dataDir) || current.content?.includes(Buffer.from('livedot.mjs').toString('base64'));
    if (looksOwned) { await rm(path, { force: true }); restored.push(path); }
  }
  const mapPreserved = await exists(join(dataDir, 'map.json')) || await exists(join(dataDir, 'maps'));
  return { ok: skipped.length === 0, projectRoot: root, restored, skipped, mapPreserved, backupPath };
}

export async function doctorProject({ projectRoot = process.cwd(), checkBridge = false, bridgeClient, offline = true, homeRoot = homedir() } = {}) {
  const root = resolve(projectRoot);
  const home = resolve(homeRoot);
  const configPath = join(root, '.live-dot-map', 'agent-kit.json');
  const config = await readJson(configPath, null);
  const installed = config?.installed && typeof config.installed === 'object' ? config.installed : {};
  const expected = [
    ['agent-kit-config', configPath],
  ];
  if (config?.runtimeMode !== 'sea' && config?.runtime !== null) expected.push(['runtime', join(home, '.live-dot-map', 'livedot.mjs')]);
  if (installed.codex) expected.push(['codex-hooks', join(home, '.codex', 'hooks.json')], ['codex-mcp', join(home, '.codex', 'config.toml')]);
  if (installed['claude-code']) expected.push(['claude-hooks', join(home, '.claude', 'settings.json')]);
  if (installed['kimi-code']) expected.push(['kimi-mcp', join(home, '.kimi-code', 'mcp.json')], ['kimi-plugin', join(kimiPluginRoot(home), 'kimi.plugin.json')]);
  if (installed.codebuddy) expected.push(['codebuddy-hooks', join(home, '.codebuddy', 'settings.json')], ['codebuddy-plugin', join(codebuddyPluginRoot(home), '.codebuddy-plugin', 'plugin.json')]);
  const checks = [{ name: 'project-root', ok: await exists(root), detail: root }];
  for (const [name, path] of expected) checks.push({ name, ok: await exists(path), detail: path });
  // 地图存在性：多地图布局 maps/ 或单图老路径 map.json 任一即可
  checks.push({ name: 'map', ok: await exists(join(root, '.live-dot-map', 'map.json')) || await exists(join(root, '.live-dot-map', 'maps')), detail: join(root, '.live-dot-map') });
  const detectedAgents = await detectInstalledAdapters({ projectRoot: root, homeRoot: home });
  checks.push({ name: 'agent-discovery', ok: Object.values(detectedAgents).every((item) => !item.discovered || Boolean(installed[item.id])), detail: detectedAgents });
  checks.push({ name: 'node', ok: runtimePlan({ offline }).use === 'system-node', detail: process.versions.node });
  checks.push({ name: 'portable-node-manifest', ok: Boolean(portableManifestFor()), detail: portableManifestFor()?.version || 'unavailable' });
  if (checkBridge) {
    try { const health = await bridgeClient.health(); checks.push({ name: 'bridge-health', ok: true, detail: health?.status || health }); }
    catch (error) { checks.push({ name: 'bridge-health', ok: false, detail: error?.message }); }
  }
  return { ok: checks.every((check) => check.ok), projectRoot: root, configPath, checks, runtime: runtimePlan({ offline }) };
}

export { ADAPTERS };
