import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLoopbackUrl, projectIdForRoot } from './bridge-client.mjs';
import { createShortcut, windowsDesktopDirectory } from './shortcut.mjs';
import { portableManifestFor, runtimePlan } from './portable-node.mjs';
import MAP_TEMPLATE from '../map.template.json' with { type: 'json' };

const ADAPTERS = Object.freeze(['codex', 'claude-code', 'kimi-code']);

const ADAPTER_PROBES = Object.freeze({
  codex: ['codex'],
  'claude-code': ['claude', 'claude-code'],
  'kimi-code': ['kimi', 'kimi-code'],
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

const adapterConfigPaths = (root, id) => id === 'codex'
  ? [join(root, '.codex', 'config.toml'), join(root, '.codex', 'hooks.json')]
  : id === 'claude-code'
    ? [join(root, '.mcp.json'), join(root, '.claude', 'settings.json')]
    : [join(root, '.kimi-code', 'mcp.json'), join(root, '.live-dot-map', 'kimi-plugin', 'kimi.plugin.json'), join(root, '.live-dot-map', 'kimi-plugin', 'runtime', 'livedot.mjs')];

function seaRuntime() {
  return process.env.LIVEDOT_SEA === '1';
}

function runtimeArgs(runtime) {
  return seaRuntime() ? [] : [runtime];
}

function command(nodeCommand, runtime, root, agent, event) {
  return [`"${nodeCommand}"`, ...runtimeArgs(runtime).map((arg) => `"${arg}"`), 'hook', '--event', event, '--project', `"${root}"`, '--agent', agent].join(' ');
}

function execProbe(file, args = []) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 4_000 }, (error, stdout = '') => {
      resolve(!error && String(stdout).trim().length > 0);
    });
  });
}

async function commandExists(file) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  return execProbe(locator, [file]);
}

/** 只报告实际存在的 Agent；项目已有配置也算已发现，避免覆盖陌生平台。 */
export async function detectInstalledAdapters({ projectRoot = process.cwd(), platform = process.platform } = {}) {
  const root = resolve(projectRoot);
  const checks = await Promise.all(ADAPTERS.map(async (id) => {
    const configPaths = id === 'codex'
      ? [join(root, '.codex', 'config.toml'), join(root, '.codex', 'hooks.json')]
      : id === 'claude-code'
        ? [join(root, '.mcp.json'), join(root, '.claude', 'settings.json')]
        : [join(root, '.kimi-code', 'mcp.json'), join(root, '.live-dot-map', 'kimi-plugin', 'kimi.plugin.json')];
    const configured = (await Promise.all(configPaths.map(async (path) => {
      const text = await readFile(path, 'utf8').catch(() => '');
      return text.includes('livedot-map');
    }))).some(Boolean);
    const probes = platform === 'win32' || platform === 'darwin' || platform === 'linux' ? ADAPTER_PROBES[id] : [];
    let executable = false;
    for (const probe of probes) {
      if (await commandExists(probe)) { executable = true; break; }
    }
    return [id, { id, configured, executable, discovered: configured || executable }];
  }));
  return Object.fromEntries(checks);
}

function hooksFor(nodeCommand, runtime, root, agent) {
  return Object.fromEntries([
    ['SessionStart', 'session-start'],
    ['UserPromptSubmit', 'user-prompt'],
    ['Stop', 'stop'],
  ].map(([name, event]) => [name, [{ hooks: [{ type: 'command', command: command(nodeCommand, runtime, root, agent, event), timeout: 10 }] }]]));
}

function mergeHooks(existing, additions) {
  const hooks = { ...(existing?.hooks || {}) };
  for (const [event, groups] of Object.entries(additions)) {
    const prior = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = prior.filter((group) => !JSON.stringify(group).includes('livedot.mjs'));
    hooks[event] = [...kept, ...groups];
  }
  return { ...existing, hooks };
}

function tomlString(value) { return JSON.stringify(String(value)); }

async function writeCodexConfig(root, nodeCommand, runtime) {
  const path = join(root, '.codex', 'config.toml');
  const begin = '# BEGIN LIVE-DOT-MAP';
  const end = '# END LIVE-DOT-MAP';
  const old = await readFile(path, 'utf8').catch(() => '');
  const stripped = old.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\s*`, 'g'), '').trimEnd();
  const block = [begin, '[mcp_servers."livedot-map"]', `command = ${tomlString(nodeCommand)}`, `args = [${[...runtimeArgs(runtime), 'mcp', '--project', root, '--agent', 'codex'].map(tomlString).join(', ')}]`, 'required = true', end].join('\n');
  await atomicText(path, `${stripped ? `${stripped}\n\n` : ''}${block}\n`);
  await atomicJson(join(root, '.codex', 'hooks.json'), mergeHooks(await readJson(join(root, '.codex', 'hooks.json')), hooksFor(nodeCommand, runtime, root, 'codex')));
  return [path, join(root, '.codex', 'hooks.json')];
}

async function writeClaudeConfig(root, nodeCommand, runtime) {
  const settingsPath = join(root, '.claude', 'settings.json');
  await atomicJson(settingsPath, mergeHooks(await readJson(settingsPath), hooksFor(nodeCommand, runtime, root, 'claude')));
  const mcpPath = join(root, '.mcp.json');
  const mcp = await readJson(mcpPath);
  mcp.mcpServers = { ...(mcp.mcpServers || {}), 'livedot-map': { type: 'stdio', command: nodeCommand, args: [...runtimeArgs(runtime), 'mcp', '--project', root, '--agent', 'claude'] } };
  await atomicJson(mcpPath, mcp);
  return [settingsPath, mcpPath];
}

async function writeKimiConfig(root, nodeCommand, runtime) {
  const mcpPath = join(root, '.kimi-code', 'mcp.json');
  const mcp = await readJson(mcpPath);
  mcp.mcpServers = { ...(mcp.mcpServers || {}), 'livedot-map': { command: nodeCommand, args: [...runtimeArgs(runtime), 'mcp', '--project', root, '--agent', 'kimi'] } };
  await atomicJson(mcpPath, mcp);

  // Kimi project MCP is automatic; lifecycle hooks ship as a valid local
  // plugin and require the product's one explicit trust/install confirmation.
  const plugin = join(root, '.live-dot-map', 'kimi-plugin');
  const pluginRuntime = join(plugin, 'runtime', 'livedot.mjs');
  await mkdir(dirname(pluginRuntime), { recursive: true });
  if (!seaRuntime()) await copyFile(runtime, pluginRuntime);
  const pluginInvocation = [`"${nodeCommand}"`, ...(seaRuntime() ? [] : ['./runtime/livedot.mjs'].map((arg) => `"${arg}"`))].join(' ');
  const manifest = {
    name: 'livedot-map', version: '2.0.0', description: '活点地图人机协作闭环',
    mcpServers: { 'livedot-map': { command: nodeCommand, args: [...(seaRuntime() ? [] : ['./runtime/livedot.mjs']), 'mcp', '--project', '.', '--agent', 'kimi'] } },
    hooks: [
      { event: 'SessionStart', command: `${pluginInvocation} hook --event session-start --project . --agent kimi`, timeout: 10 },
      { event: 'UserPromptSubmit', command: `${pluginInvocation} hook --event user-prompt --project . --agent kimi`, timeout: 10 },
      { event: 'Stop', command: `${pluginInvocation} hook --event stop --project . --agent kimi`, timeout: 10 },
    ],
  };
  await atomicJson(join(plugin, 'kimi.plugin.json'), manifest);
  return [mcpPath, join(plugin, 'kimi.plugin.json')];
}

export function adapterManifest({ sourceRoot = process.cwd() } = {}) {
  const root = resolve(sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : sourceRoot);
  return Object.fromEntries(ADAPTERS.map((id) => [id, { id, source: join(root, 'adapters', id) }]));
}

export async function installProject({
  projectRoot = process.cwd(), sourceRoot, runtimeSource, appPath, bridgeUrl = '', bridgeClient, register = true,
  createDesktopShortcut = true, offline = true, platform = process.platform, env = process.env, exec,
  discoverAgents = true,
} = {}) {
  const root = resolve(projectRoot);
  if (!(await exists(root))) throw new Error(`项目目录不存在: ${root}`);
  const source = resolve(sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : (sourceRoot || process.cwd()));
  const sourceRuntime = resolve(runtimeSource || resolve(source, 'livedot.mjs'));
  if (!seaRuntime() && !(await exists(sourceRuntime))) throw new Error(`缺少已构建运行时: ${sourceRuntime}`);
  const dataDir = join(root, '.live-dot-map');
  const runtime = seaRuntime() ? null : join(dataDir, 'livedot.mjs');
  await mkdir(dataDir, { recursive: true });
  const projectId = projectIdForRoot(root);
  const mapPath = join(dataDir, 'map.json');
  const configPath = join(dataDir, 'agent-kit.json');
  const old = await readJson(configPath);
  const url = bridgeUrl || old?.bridge?.url || 'http://127.0.0.1:0';
  assertLoopbackUrl(url);
  const nodeCommand = process.execPath;
  const detected = discoverAgents ? await detectInstalledAdapters({ projectRoot: root, platform }) : Object.fromEntries(ADAPTERS.map((id) => [id, { id, configured: false, executable: false, discovered: true }]));
  const installed = {};
  for (const id of ADAPTERS) if (detected[id]?.discovered) installed[id] = true;
  const backupPath = join(dataDir, 'backups', 'agent-kit-install.json');
  const beforeBackup = await captureFile(backupPath);
  const oldRuntime = runtime ? await captureFile(runtime) : { exists: false, kind: 'missing', path: null };
  const oldMap = await captureFile(mapPath);
  const touched = new Set([configPath, ...(runtime ? [runtime] : [])]);
  for (const id of new Set([...Object.keys(old.installed || {}), ...Object.keys(installed)])) for (const path of adapterConfigPaths(root, id)) touched.add(path);
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
    if (runtime && !oldRuntime.exists) await rm(runtime, { force: true }).catch(() => undefined);
  };

  try {
    await atomicJson(backupPath, backup);
    if (runtime && resolve(sourceRuntime) !== resolve(runtime)) await copyFile(sourceRuntime, runtime);
    if (!oldMap.exists) {
      const map = structuredClone(MAP_TEMPLATE);
      if (map.version !== 2) throw new Error('内置 map.json 模板不是 v2');
      const now = new Date().toISOString();
      map.mapId = projectId;
      map.name = basename(root);
      map.createdAt = now;
      map.updatedAt = now;
      for (const collection of ['routes', 'nodes', 'edges', 'anns']) for (const item of Array.isArray(map[collection]) ? map[collection] : []) {
        item.createdAt = now;
        item.updatedAt = now;
        item.updatedBy = 'installer';
      }
      await atomicJson(mapPath, map);
    }
    if (installed.codex) await writeCodexConfig(root, nodeCommand, runtime);
    if (installed['claude-code']) await writeClaudeConfig(root, nodeCommand, runtime);
    if (installed['kimi-code']) await writeKimiConfig(root, nodeCommand, runtime);
    const config = {
      ...old, version: 2, projectId: old.projectId || projectId, projectRoot: root, runtime, runtimeMode: seaRuntime() ? 'sea' : 'node', nodeCommand, detectedAgents: detected,
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
      trustRequired: Object.fromEntries(Object.keys(installed).map((id) => [id, id === 'codex' ? '在 Codex /hooks 中信任项目 hooks' : id === 'claude-code' ? '首次打开项目时确认 hooks 与 MCP' : `在 Kimi 执行 /plugins install ${join(dataDir, 'kimi-plugin')}`])), runtimePlan: runtimePlan({ offline }) };
    if (register && bridgeClient) { result.bridge.registration = await bridgeClient.openProject(root); result.bridge.mode = 'live-bridge'; }
    if (createDesktopShortcut && platform === 'win32') {
      const launcher = join(dataDir, '启动活点地图.cmd');
      const app = resolve(appPath || join(root, 'app.html'));
      await atomicText(launcher, `@echo off\r\n"${nodeCommand}"${runtimeArgs(runtime).map((arg) => ` "${arg}"`).join('')} serve --project "${root}" --app "${app}"\r\n`);
      try {
        result.shortcut = await createShortcut({ target: launcher, name: '活点地图本地桥', platform, env, exec });
      } catch (error) {
        const fallback = join(dataDir, '打开活点地图.cmd');
        await atomicText(fallback, `@echo off\r\n"${launcher}"\r\n`);
        result.shortcut = { ok: false, type: 'project-fallback', fallback, reason: 'shortcut-location-unavailable', error: error?.message };
      }
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
  if (!config || typeof config !== 'object') return { ok: false, reason: 'not-installed', projectRoot: root, mapPreserved: await exists(join(dataDir, 'map.json')) };
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
  const mapPreserved = await exists(join(dataDir, 'map.json'));
  return { ok: skipped.length === 0, projectRoot: root, restored, skipped, mapPreserved, backupPath };
}

export async function doctorProject({ projectRoot = process.cwd(), checkBridge = false, bridgeClient, offline = true } = {}) {
  const root = resolve(projectRoot);
  const configPath = join(root, '.live-dot-map', 'agent-kit.json');
  const config = await readJson(configPath, null);
  const installed = config?.installed && typeof config.installed === 'object' ? config.installed : {};
  const expected = [
    ['agent-kit-config', configPath], ['map', join(root, '.live-dot-map', 'map.json')],
  ];
  if (config?.runtimeMode !== 'sea' && config?.runtime !== null) expected.push(['runtime', join(root, '.live-dot-map', 'livedot.mjs')]);
  if (installed.codex) expected.push(['codex-hooks', join(root, '.codex', 'hooks.json')], ['codex-mcp', join(root, '.codex', 'config.toml')]);
  if (installed['claude-code']) expected.push(['claude-hooks', join(root, '.claude', 'settings.json')], ['claude-mcp', join(root, '.mcp.json')]);
  if (installed['kimi-code']) expected.push(['kimi-mcp', join(root, '.kimi-code', 'mcp.json')], ['kimi-plugin', join(root, '.live-dot-map', 'kimi-plugin', 'kimi.plugin.json')]);
  const checks = [{ name: 'project-root', ok: await exists(root), detail: root }];
  for (const [name, path] of expected) checks.push({ name, ok: await exists(path), detail: path });
  const detectedAgents = await detectInstalledAdapters({ projectRoot: root });
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
