import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { canonicalDirectory } from './fs-utils.mjs';
import { asBridgeError, BridgeError } from './errors.mjs';
import { noopLogger } from './logger.mjs';
import { MarkdownStore } from './markdown-store.mjs';
import { HumanMdUpdateLog } from './human-md-updates.mjs';
import { MapManager } from './map-manager.mjs';
import { ToolService } from './tool-service.mjs';
import { ArchiveLifecycle } from './archive-lifecycle.mjs';
import { NativeRecycleBin } from './recycle-bin.mjs';
import { EditorService } from './editor-service.mjs';
import { NativeWindowsHelper } from './native-helper.mjs';
import {
  ensureMapsLayout,
  isSafeMapId,
  listMaps,
  mapRelativeDirectory,
  resolveActiveMap,
} from './maps.mjs';
import { loadSharedAdapter } from './shared-adapter.mjs';
import { detectInstalledAdapters, installProject } from '../../agent-kit/lib/installer.mjs';

const SESSION_COOKIE = 'ldm_bridge_session';
const DEFAULT_BODY_LIMIT = 16 * 1024 * 1024;
const DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1000;
const RECENT_PROJECTS_FILE = () => process.env.LIVEDOT_RECENT_PROJECTS_FILE || join(homedir(), '.live-dot-map', 'recent-projects.json');

/** 记录最近打开的项目（去重置顶，最多 15 个）；失败不影响使用。 */
async function recordRecentProject(root) {
  let recent = [];
  try {
    const parsed = JSON.parse(await readFile(RECENT_PROJECTS_FILE(), 'utf8'));
    if (Array.isArray(parsed)) recent = parsed.filter((item) => typeof item === 'string');
  } catch { /* 首次使用 */ }
  recent = [root, ...recent.filter((item) => item !== root)].slice(0, 15);
  await mkdir(dirname(RECENT_PROJECTS_FILE()), { recursive: true });
  await writeFile(RECENT_PROJECTS_FILE(), `${JSON.stringify(recent, null, 2)}\n`, 'utf8');
}

async function readRecentProjects() {
  try {
    const parsed = JSON.parse(await readFile(RECENT_PROJECTS_FILE(), 'utf8'));
    const list = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    const valid = [];
    for (const item of list) {
      try { await canonicalDirectory(item); valid.push(item); } catch { /* 目录已不存在则跳过 */ }
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * 构建「选择项目文件夹」的 PowerShell 脚本。
 * 主路径：Add-Type 内嵌 C# 调 COM IFileOpenDialog（FOS_PICKFOLDERS）——VS Code 同款
 * 现代选择文件夹对话框（带地址栏/搜索/新建文件夹），无新依赖。
 * 置顶：创建一个 TopMost 隐形 owner 窗体，把句柄传给对话框，保证弹窗永远在画布窗口前。
 * 兜底：IFileOpenDialog 抛异常（COM 不可用等）时回落老式 FolderBrowserDialog，
 * 同样挂置顶 owner（ShowDialog($owner)）。
 * 输出协议：选中路径写入 marker 文件（避免控制台编码问题），取消则不写；
 * stdout 输出 PICK:OK|PICK:CANCEL <modern|fallback> 与 PICK:DIAG 诊断行，仅供日志分析。
 * 导出仅供测试对脚本内容做静态断言。
 */
export function buildPickFolderScript(marker) {
  const markerEscaped = marker.replaceAll('\\', '\\\\').replaceAll("'", "''");
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace LdmFolderPicker {
  // 现代「选择文件夹」对话框：COM IFileOpenDialog + FOS_PICKFOLDERS。
  // 未用到的方法只声明占位签名以维持 vtable 顺序（永远不会被调用）。
  public static class ModernFolderPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    private class FileOpenDialogComClass { }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog {
      [PreserveSig] int Show(IntPtr parent);
      void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
      void SetFileTypeIndex(uint iFileType);
      void GetFileTypeIndex(out uint piFileType);
      void Advise(IntPtr pfde, out uint pdwCookie);
      void Unadvise(uint dwCookie);
      void SetOptions(uint fos);
      void GetOptions(out uint pfos);
      void SetDefaultFolder(IntPtr psi);
      void SetFolder(IntPtr psi);
      void GetFolder(out IntPtr ppsi);
      void GetCurrentSelection(out IntPtr ppsi);
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
      void GetResult(out IShellItem ppsi);
      void AddPlace(IntPtr psi, int fdap);
      void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
      void Close(int hr);
      void SetClientGuid(ref Guid guid);
      void ClearClientData();
      void SetFilter(IntPtr pFilter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
      void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
      void GetParent(out IShellItem ppsi);
      void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
      void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
      void Compare(IntPtr psi, uint hint, out int piOrder);
    }

    private const uint FOS_PICKFOLDERS = 0x00000020;
    private const uint FOS_FORCEFILESYSTEM = 0x00000040;
    private const uint SIGDN_FILESYSPATH = 0x80058000;

    // 用户取消返回 null（Show 返回 0x800704C7）；COM 创建/调用失败抛异常，由调用方回落老对话框。
    public static string Pick(IntPtr owner, string title) {
      var dialog = (IFileOpenDialog)new FileOpenDialogComClass();
      try {
        dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
        dialog.SetTitle(title);
        int hr = dialog.Show(owner);
        if (hr != 0) return null;
        IShellItem item;
        dialog.GetResult(out item);
        string path;
        item.GetDisplayName(SIGDN_FILESYSPATH, out path);
        return path;
      } finally {
        Marshal.FinalReleaseComObject(dialog);
      }
    }
  }
}
'@

# 置顶隐形 owner 窗体：对话框以它为父窗口，Z 序压过画布浏览器窗口。
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Show()

$path = $null
$mode = 'modern'
try {
  try {
    $path = [LdmFolderPicker.ModernFolderPicker]::Pick($owner.Handle, '选择活点地图项目文件夹')
  } catch {
    # 现代对话框不可用（异常），回落老式 FolderBrowserDialog，同样挂置顶 owner。
    $mode = 'fallback'
    Write-Output ('PICK:DIAG 现代对话框不可用，已回落：' + $_.Exception.Message)
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    $d.Description = '选择活点地图项目文件夹'
    $d.ShowNewFolderButton = $true
    if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $path = $d.SelectedPath }
  }
} finally {
  $owner.Dispose()
}

if ($path) {
  [System.IO.File]::WriteAllText('${markerEscaped}', $path, [System.Text.Encoding]::UTF8)
  Write-Output ('PICK:OK ' + $mode)
} else {
  Write-Output ('PICK:CANCEL ' + $mode)
}
`;
}

/**
 * 弹出原生文件夹选择器（现代 IFileOpenDialog 优先，失败回落 FolderBrowserDialog，均置顶）。
 * 返回契约不变：{ cancelled: true } 或 { cancelled: false, path }；
 * 结果（成功路径/取消/失败原因）写入当天运行日志（project.pick 事件）。
 */
async function pickProjectFolder({ logger = noopLogger } = {}) {
  const tmpDir = join(homedir(), '.live-dot-map', 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const marker = join(tmpDir, `pick-${randomUUID()}.txt`);
  const script = buildPickFolderScript(marker);
  const run = await new Promise((resolveRun, rejectRun) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { if (stdout.length < 4096) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 4096) stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 超时强制关闭选择器 */ } }, 300_000);
    child.once('error', rejectRun);
    child.once('exit', (code) => { clearTimeout(timer); resolveRun({ code: code ?? 1, stdout, stderr }); });
  });
  const statusLine = run.stdout.split(/\r?\n/).find((line) => /^PICK:(OK|CANCEL)/.test(line));
  const mode = statusLine && statusLine.includes('fallback') ? 'fallback' : 'modern';
  const diag = run.stdout.split(/\r?\n/).filter((line) => line.startsWith('PICK:DIAG')).join(' | ');
  if (run.code !== 0) {
    await logger.warn('project.pick', { outcome: 'error', exitCode: run.code, stderr: run.stderr.slice(0, 400), diag });
    await rm(marker, { force: true }).catch(() => undefined);
    return { cancelled: true };
  }
  try {
    const text = (await readFile(marker, 'utf8')).trim();
    await rm(marker, { force: true }).catch(() => undefined);
    if (text) {
      await logger.info('project.pick', { outcome: 'ok', mode, path: text, diag });
      return { cancelled: false, path: text };
    }
    await logger.info('project.pick', { outcome: 'cancelled', mode, diag });
    return { cancelled: true };
  } catch (error) {
    await logger.warn('project.pick', { outcome: 'error', message: String(error?.message || error).slice(0, 400) });
    return { cancelled: true };
  }
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

async function recordAgentHealth(root, actor, event, status, error) {
  const path = join(root, '.live-dot-map', '.bridge', 'agent-health.json');
  const prior = await readFile(path, 'utf8').then((text) => JSON.parse(text)).catch(() => ({}));
  const records = prior.records && typeof prior.records === 'object' && !Array.isArray(prior.records) ? prior.records : {};
  records[String(actor).replace(/^agent:/, '')] = {
    status, actor, event, boundary: String(event).startsWith('mcp:') ? 'mcp' : 'hook', at: new Date().toISOString(),
    ...(status === 'error' ? { code: error?.code || 'BRIDGE_MCP_FAILED', message: String(error?.message || error || '未知错误').slice(0, 400) } : {}),
  };
  await mkdir(join(root, '.live-dot-map', '.bridge'), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomToken(8)}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records }, null, 2)}\n`, 'utf8'); await rename(temporary, path); } catch { /* health evidence is best-effort */ }
}

async function readAgentHealth(root) {
  return readFile(join(root, '.live-dot-map', '.bridge', 'agent-health.json'), 'utf8').then((text) => {
    const value = JSON.parse(text);
    return value && typeof value.records === 'object' && !Array.isArray(value.records) ? value.records : {};
  }).catch(() => ({}));
}

async function readObject(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function runtimeSources({ sourceRoot, runtimeSource } = {}) {
  const entry = process.argv[1] ? resolve(process.argv[1]) : '';
  const entryRoot = entry ? dirname(entry) : '';
  const roots = [
    sourceRoot,
    process.env.LIVEDOT_AGENT_KIT_SOURCE,
    process.cwd(),
    entryRoot,
  ].filter(Boolean).map((value) => resolve(value));
  const uniqueRoots = [...new Set(roots)];
  const runtimes = [
    runtimeSource,
    process.env.LIVEDOT_RUNTIME_SOURCE,
    ...uniqueRoots.map((root) => join(root, 'livedot.mjs')),
  ].filter(Boolean).map((value) => resolve(value));
  return { sourceRoot: uniqueRoots[0] || process.cwd(), runtimeSource: runtimes[0] || '' };
}

/**
 * Opening a project is also the one safe place to prepare its Agent adapter.
 * Detection is read-only; only an actually discovered Agent is configured.
 * Trust is never acknowledged here, and a setup failure never blocks opening
 * the map.  The returned status is intentionally UI-friendly rather than an
 * implementation detail.
 */
export async function ensureProjectAgentConfig(projectRoot, {
  platform = process.platform,
  sourceRoot,
  runtimeSource,
  homeRoot,
  detect = detectInstalledAdapters,
  install = installProject,
} = {}) {
  const root = resolve(projectRoot);
  try {
    const detected = await detect({ projectRoot: root, platform, ...(homeRoot ? { homeRoot } : {}) });
    const available = Object.values(detected || {}).filter((item) => item?.discovered === true);
    const configPath = join(root, '.live-dot-map', 'agent-kit.json');
    const existing = await readObject(configPath);
    if (!available.length) {
      return { ok: true, status: 'none', changed: false, projectRoot: root, detectedAgents: detected || {}, configured: existing?.installed || {} };
    }
    const installed = existing?.installed && typeof existing.installed === 'object' ? existing.installed : {};
    const alreadyConfigured = existing?.version === 2 && available.every((item) => installed[item.id] === true);
    if (alreadyConfigured) {
      return { ok: true, status: 'ready', changed: false, projectRoot: root, detectedAgents: detected || {}, configured: installed, trust: existing?.trust || {} };
    }
    const sources = runtimeSources({ sourceRoot, runtimeSource });
    const result = await install({
      projectRoot: root,
      ...(homeRoot ? { homeRoot } : {}),
      sourceRoot: sources.sourceRoot,
      runtimeSource: sources.runtimeSource,
      createDesktopShortcut: false,
      register: false,
      offline: true,
      platform,
      discoverAgents: true,
      detectedAgents: detected,
    });
    return {
      ok: true,
      status: 'configured',
      changed: true,
      projectRoot: root,
      detectedAgents: result.detectedAgents || detected || {},
      configured: result.installed || {},
      trust: existing?.trust || {},
      trustRequired: result.trustRequired || {},
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      changed: false,
      projectRoot: root,
      code: error?.code || 'AGENT_SETUP_FAILED',
      message: String(error?.message || error || 'Agent 接入配置失败').slice(0, 400),
    };
  }
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
  #heartbeat;

  constructor(heartbeatMs = 3_000) {
    this.#heartbeat = setInterval(() => {
      const payload = `event: heartbeat\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`;
      for (const clients of this.#clients.values()) {
        for (const response of clients) if (!response.destroyed) response.write(payload);
      }
    }, heartbeatMs);
    this.#heartbeat.unref?.();
  }

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
    clearInterval(this.#heartbeat);
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
  heartbeatMs = 3_000,
  activeMapPollIntervalMs = 250,
  clock = () => new Date(),
  faultInjector,
  host = '127.0.0.1',
  listenPort = 0,
  controlToken = null,
  projectRegistry = null,
  sessionStore = null,
  recentProjectsStore = { record: recordRecentProject, list: readRecentProjects },
  recycleBin = null,
  nativeHelper = null,
  editorOpener = null,
  retentionEnabled = true,
  retentionInitialDelayMs = 30_000,
  retentionIntervalMs = 6 * 60 * 60 * 1000,
  appHtml = null,
  staticAssets = {},
  agentSetup = ensureProjectAgentConfig,
  logger = noopLogger,
} = {}) {
  if (!Array.isArray(allowedProjectRoots) || allowedProjectRoots.length === 0) {
    throw new BridgeError('ALLOWLIST_REQUIRED', 'At least one project root must be allowlisted');
  }
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    throw new BridgeError('INVALID_LISTEN_PORT', 'Bridge listenPort must be an integer between 0 and 65535', { status: 400 });
  }
  const adapter = shared || await loadSharedAdapter();
  const roots = new Map();
  for (const root of allowedProjectRoots) roots.set(await canonicalDirectory(root), true);

  const bootstrapTickets = new Map();
  function issueBootstrapTicket(projectRoot = null, projectHandle = null) {
    const token = randomToken();
    bootstrapTickets.set(token, { projectRoot, projectHandle, createdAt: clock().getTime() });
    return token;
  }
  // The returned token keeps the embedded/test API backward compatible: it
  // creates an authenticated session but does not implicitly choose a project.
  // Launcher-issued control tickets below are project-bound.
  const bootstrapToken = issueBootstrapTicket(null);
  let port;
  const sessions = new Map();
  const mapManagers = new Map();
  const knownActiveMaps = new Map();
  const markdownStores = new Map();
  const humanMdLogs = new Map();
  const editorServices = new Map();
  const events = new EventHub(heartbeatMs);
  const configuredOrigins = new Set(allowedOrigins);
  const recycleService = recycleBin ?? (process.platform === 'win32' ? new NativeRecycleBin() : null);
  const nativeWindowsHelper = nativeHelper ?? (process.platform === 'win32' ? new NativeWindowsHelper() : null);
  let retentionStartTimer = null;
  let retentionTimer = null;
  let activeMapTimer = null;

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

  function readSession(request, response = null) {
    const sessionId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (sessionStore) {
      const persisted = sessionId && sessionStore.get(sessionId);
      if (!persisted) throw new BridgeError('UNAUTHENTICATED', 'A valid local bridge session is required', { status: 401 });
      const projects = new Map();
      for (const handle of persisted.projectHandles) {
        try {
          const registered = projectRegistry?.resolve(handle);
          if (registered) projects.set(handle, { projectRoot: registered.projectRoot });
        } catch { /* 已撤销的项目授权不恢复 */ }
      }
      if (response) {
        response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionStore.ttlMs / 1000)}`);
      }
      return {
        sessionId,
        session: {
          csrfToken: persisted.csrfToken,
          expiresAt: Date.parse(persisted.expiresAt),
          projectRoot: null,
          projects,
        },
      };
    }
    const session = sessionId && sessions.get(sessionId);
    if (!session || session.expiresAt <= clock().getTime()) {
      if (sessionId) sessions.delete(sessionId);
      throw new BridgeError('UNAUTHENTICATED', 'A valid local bridge session is required', { status: 401 });
    }
    return { sessionId, session };
  }

  function authenticate(request, url = null, response = null) {
    const { sessionId, session } = readSession(request, response);
    const projectHandle = String(request.headers['x-livedot-project-handle'] || url?.searchParams?.get('projectHandle') || '');
    if (session.projects?.size) {
      if (!projectHandle) throw new BridgeError('PROJECT_HANDLE_REQUIRED', 'A projectHandle is required for this request', { status: 400 });
      const project = session.projects.get(projectHandle);
      if (!project) throw new BridgeError('PROJECT_NOT_AUTHORIZED', 'This browser session is not authorized for the requested project', { status: 403 });
      return {
        ...session,
        sessionId,
        projectHandle,
        projectRoot: project.projectRoot,
        activeMapId: String(request.headers['x-livedot-map-key'] || url?.searchParams?.get('mapKey') || '') || null,
      };
    }
    // 兼容未启用 project registry 的内存会话：后续 /open 会直接更新
    // 这个对象，因此不能在这里返回浅拷贝，否则绑定只活一个请求。
    session.sessionId = sessionId;
    return session;
  }

  async function authorizeOpenedProject(session, projectRoot) {
    if (!projectRegistry) {
      session.projectRoot = projectRoot;
      return {};
    }
    const registered = await projectRegistry.register(projectRoot);
    session.projects?.set(registered.projectHandle, { projectRoot: registered.projectRoot });
    let reconnectTicket;
    if (sessionStore && session.sessionId) {
      const authorized = sessionStore.authorize(session.sessionId, registered.projectHandle);
      reconnectTicket = authorized?.reconnectTicket;
      await sessionStore.flush();
    }
    return {
      projectHandle: registered.projectHandle,
      ...(reconnectTicket ? { reconnectTicket } : {}),
    };
  }

  function validateCsrf(request, session) {
    const token = request.headers['x-csrf-token'];
    if (!token || !constantEqual(token, session.csrfToken)) {
      throw new BridgeError('INVALID_CSRF', 'CSRF token is missing or invalid', { status: 403 });
    }
  }

  // 多地图：stores/事件频道按「项目::地图」键控；会话记住自己当前的地图 id。
  const storeKey = (root, mapId) => `${root}::${mapId}`;

  async function mapManagerFor(root) {
    let manager = mapManagers.get(root);
    if (!manager) {
      manager = await MapManager.open({
        projectRoot: root,
        shared: adapter,
        snapshotEvery,
        pollIntervalMs,
        clock,
        faultInjector,
        onEvent: (event) => events.publish(
          storeKey(root, event.mapKey),
          event.type === 'external' ? { ...event, type: 'revision', source: 'external' } : event,
        ),
        onActiveMapChanged: (event) => {
          knownActiveMaps.set(root, event.mapKey);
          events.publish(`project::${root}`, event);
        },
      });
      mapManagers.set(root, manager);
      knownActiveMaps.set(root, await resolveActiveMap(root));
    }
    return manager;
  }

  async function openMapStore(root, mapId, { mapName } = {}) {
    return (await (await mapManagerFor(root)).resolve({ mapKey: mapId })).store;
  }

  async function activeStore(session) {
    if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
    if (!session.activeMapId) session.activeMapId = await resolveActiveMap(session.projectRoot);
    else {
      if (!isSafeMapId(session.activeMapId)) throw new BridgeError('INVALID_MAP_KEY', 'mapKey is invalid', { status: 400 });
      const available = await listMaps(session.projectRoot);
      if (!available.maps.some((map) => map.id === session.activeMapId)) {
        throw new BridgeError('MAP_NOT_FOUND', `Map does not exist: ${session.activeMapId}`, { status: 404 });
      }
    }
    return openMapStore(session.projectRoot, session.activeMapId);
  }

  async function activeBundleStore(session) {
    await activeStore(session);
    return (await (await mapManagerFor(session.projectRoot)).resolve({ mapKey: session.activeMapId })).bundleStore;
  }

  async function editorServiceFor(projectRoot) {
    let service = editorServices.get(projectRoot);
    if (!service) {
      service = await EditorService.open({
        projectRoot,
        nativeHelper: nativeWindowsHelper,
        ...(typeof editorOpener === 'function' ? { spawn: editorOpener } : {}),
      });
      editorServices.set(projectRoot, service);
    }
    return service;
  }

  // 兼容单图时代的 Markdown 路径：.live-dot-map/nodes|routes/ 一律重写到当前地图
  // 目录，避免迁移后旧客户端在项目根重新长出老布局目录。maps/<id>/ 形式原样放行。
  async function mapMarkdownPath(session, requested) {
    const text = String(requested || '').replace(/\\/g, '/');
    const match = text.match(/^\.live-dot-map\/(nodes|routes)\/(.+)$/);
    if (!match) return requested;
    const active = session.activeMapId ?? await resolveActiveMap(session.projectRoot);
    return `${mapRelativeDirectory(active)}/${match[1]}/${match[2]}`;
  }

  async function openProject(requestedRoot) {
    let root;
    try {
      root = await canonicalDirectory(requestedRoot);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new BridgeError('PROJECT_NOT_FOUND', `Project directory does not exist: ${requestedRoot}`, { status: 404 });
      throw new BridgeError('PROJECT_NOT_ALLOWED', 'Project root is not accessible', { status: 403 });
    }
    // 会话内切换：已认证会话可把新目录加入 allowlist（桥是用户本机进程，loopback + 随机端口 + CSRF 保护；
    // Agent 的 MCP 通道不暴露此接口）。目录不存在返回明确 404。
    if (!roots.has(root)) roots.set(root, true);
    await recentProjectsStore.record(root).catch(() => undefined);
    // 打开项目时幂等迁移到多地图布局（老项目先备份再动），再按指针打开当前地图。
    const { activeMap } = await ensureMapsLayout(root);
    const store = await openMapStore(root, activeMap);
    markdownStoreFor(root);
    logger.info('project.open', { root, map: activeMap });
    return { root, store, mapId: activeMap };
  }

  function markdownStoreFor(root) {
    if (!root) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
    let store = markdownStores.get(root);
    if (!store) {
      store = new MarkdownStore(root);
      markdownStores.set(root, store);
    }
    return store;
  }

  /** 人类 md 写入的未确认信号日志（per-map，惰性创建）。 */
  async function humanMdLogFor(session) {
    const mapKey = session.activeMapId ?? await resolveActiveMap(session.projectRoot);
    const key = `${session.projectRoot}/${mapKey}`;
    let log = humanMdLogs.get(key);
    if (!log) {
      log = new HumanMdUpdateLog({ projectRoot: session.projectRoot, mapKey });
      humanMdLogs.set(key, log);
    }
    return log;
  }

  // ---- 产品内更新：/update/check 与 /update/apply ----
  // 更新渠道指向线上 windows-installer 目录（update-manifest.json + payload 文件），
  // 可用 LIVEDOT_UPDATE_BASE 覆盖（本地预演/测试）。所有请求由桥代发，前端不直连外网（CSP）。
  const UPDATE_BASE = (process.env.LIVEDOT_UPDATE_BASE || 'https://livedotmap.top/windows-installer').replace(/\/+$/, '');

  async function readLocalPayloadVersion() {
    try {
      const parsed = JSON.parse(await readFile(join(process.cwd(), 'payload-manifest.json'), 'utf8'));
      return typeof parsed.version === 'string' ? parsed.version : null;
    } catch {
      return null;
    }
  }

  function compareVersions(a, b) {
    const left = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
    const right = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      const delta = (left[i] || 0) - (right[i] || 0);
      if (delta !== 0) return delta > 0 ? 1 : -1;
    }
    return 0;
  }

  async function fetchUpdateManifest() {
    const response = await fetch(`${UPDATE_BASE}/update-manifest.json`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new BridgeError('UPDATE_MANIFEST_UNAVAILABLE', `Update manifest unavailable (HTTP ${response.status})`, { status: 502 });
    const manifest = await response.json();
    if (!manifest || typeof manifest !== 'object' || typeof manifest.version !== 'string' || !manifest.files || typeof manifest.files !== 'object') {
      throw new BridgeError('UPDATE_MANIFEST_INVALID', 'Update manifest is invalid', { status: 502 });
    }
    return manifest;
  }

  async function checkUpdate() {
    const current = await readLocalPayloadVersion();
    try {
      const manifest = await fetchUpdateManifest();
      const latest = manifest.version;
      const available = current !== null && compareVersions(latest, current) > 0;
      return { ok: true, current, latest, available, fileCount: available ? Object.keys(manifest.files).length : 0 };
    } catch (error) {
      return { ok: false, current, latest: null, available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function applyUpdate() {
    const current = await readLocalPayloadVersion();
    const manifest = await fetchUpdateManifest();
    if (current !== null && compareVersions(manifest.version, current) <= 0) {
      throw new BridgeError('ALREADY_UP_TO_DATE', `Current version ${current} is up to date`, { status: 409 });
    }
    const updater = resolve(join(process.cwd(), '..', 'LiveDotMapSetup.exe'));
    try {
      await access(updater);
    } catch {
      throw new BridgeError('UPDATER_UNAVAILABLE', 'Installer entry not found; updates are only available in installed mode', { status: 501 });
    }
    const tempRoot = join(process.env.TEMP || process.env.TMP || homedir(), `livedot-update-${manifest.version}-${randomUUID()}`);
    const payloadDir = join(tempRoot, 'payload');
    await mkdir(payloadDir, { recursive: true });
    try {
      for (const [relative, meta] of Object.entries(manifest.files)) {
        if (!meta || typeof meta !== 'object' || typeof meta.sha256 !== 'string' || typeof meta.url !== 'string') {
          throw new BridgeError('UPDATE_MANIFEST_INVALID', `Invalid file entry: ${relative}`, { status: 502 });
        }
        if (relative.includes('..') || relative.startsWith('/') || /^[a-zA-Z]:/.test(relative)) {
          throw new BridgeError('UPDATE_MANIFEST_INVALID', `Unsafe file path: ${relative}`, { status: 502 });
        }
        const target = join(payloadDir, relative);
        await mkdir(dirname(target), { recursive: true });
        const response = await fetch(`${UPDATE_BASE}/${meta.url}`, { signal: AbortSignal.timeout(600000) });
        if (!response.ok) throw new BridgeError('UPDATE_DOWNLOAD_FAILED', `Download failed for ${relative} (HTTP ${response.status})`, { status: 502 });
        const buffer = Buffer.from(await response.arrayBuffer());
        const actual = createHash('sha256').update(buffer).digest('hex');
        if (actual !== meta.sha256.toLowerCase()) throw new BridgeError('UPDATE_CHECKSUM_MISMATCH', `Checksum mismatch for ${relative}`, { status: 502 });
        await writeFile(target, buffer);
      }
    } catch (error) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    // 启动更新器（独立进程），随后桥优雅退出；更新器完成 备份→切换→重开画布。
    const child = spawn(updater, ['--update', tempRoot], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true, version: manifest.version, restarting: true };
  }

  function scheduleRestart() {
    setTimeout(() => {
      if (activeMapTimer) clearInterval(activeMapTimer);
      if (retentionStartTimer) clearTimeout(retentionStartTimer);
      if (retentionTimer) clearInterval(retentionTimer);
      events.close();
      Promise.all([...mapManagers.values()].map((manager) => manager.close())).catch(() => undefined).finally(() => {
        Promise.resolve(sessionStore?.flush()).catch(() => undefined).finally(() => {
          if (!sessionStore) sessions.clear();
          server.close(() => process.exit(0));
          server.closeAllConnections?.();
          setTimeout(() => process.exit(0), 1500).unref?.();
        });
      });
    }, 500);
  }

  const clientLog = logger.as('client');

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    // 请求计时日志：只记路径不记查询串（首访 URL 带一次性 bootstrap token，不能落盘）。
    const httpStart = Date.now();
    let httpLogged = false;
    response.once('finish', () => {
      if (httpLogged) return;
      httpLogged = true;
      const status = response.statusCode;
      const fields = { method: request.method, path: String(request.url || '').split('?')[0], status, ms: Date.now() - httpStart };
      if (status >= 500) logger.error('http', fields);
      else if (status >= 400) logger.warn('http', fields);
      else logger.info('http', fields);
    });
    try {
      validateHost(request);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const aliases = new Map([
        ['/api/v1/health', '/health'],
        ['/api/v1/session', '/session'],
        ['/api/v1/session/reconnect', '/session/reconnect'],
        ['/api/v1/projects/open', '/open'],
        ['/api/v1/projects/pick', '/projects/pick'],
        ['/api/v1/projects/recent', '/projects/recent'],
        ['/api/v1/maps', '/maps'],
        ['/api/v1/maps/create', '/maps/create'],
        ['/api/v1/maps/switch', '/maps/switch'],
        ['/api/v1/maps/rename', '/maps/rename'],
        ['/api/v1/snapshot', '/snapshot'],
        ['/api/v1/commands', '/commands'],
       ['/api/v1/events', '/events'],
        ['/api/v1/recover', '/recover'],
        ['/api/v1/agents', '/agents'],
        ['/api/v1/markdown', '/markdown'],
        ['/api/v1/markdown/reveal', '/markdown/reveal'],
        ['/api/v1/bundles', '/bundles'],
        ['/api/v1/bundles/markdown/read', '/bundles/markdown/read'],
        ['/api/v1/bundles/markdown/create', '/bundles/markdown/create'],
        ['/api/v1/bundles/markdown/replace', '/bundles/markdown/replace'],
        ['/api/v1/bundles/markdown/append', '/bundles/markdown/append'],
        ['/api/v1/bundles/rename', '/bundles/rename'],
        ['/api/v1/bundles/archive', '/bundles/archive'],
        ['/api/v1/bundles/restore', '/bundles/restore'],
        ['/api/v1/archive', '/archive'],
        ['/api/v1/archive/restore', '/archive/restore'],
        ['/api/v1/archive/purge', '/archive/purge'],
        ['/api/v1/editors', '/editors'],
        ['/api/v1/editors/open', '/editors/open'],
        ['/api/v1/editors/preferred', '/editors/preferred'],
        ['/api/v1/editors/pick', '/editors/pick'],
        ['/api/v1/editors/save-as', '/editors/save-as'],
        ['/api/v1/assets/import', '/assets/import'],
        ['/api/v1/assets/read', '/assets/read'],
        ['/api/v1/update/check', '/update/check'],
        ['/api/v1/update/apply', '/update/apply'],
        ['/api/v1/logs/client', '/logs/client'],
        ['/api/v1/control/status', '/control/status'],
        ['/api/v1/control/open-project', '/control/open-project'],
      ]);
      const pathname = aliases.get(url.pathname) || url.pathname;

      if (pathname === '/control/status' || pathname === '/control/open-project') {
        if (!controlToken || !constantEqual(request.headers['x-livedot-control'], controlToken)) {
          throw new BridgeError('INVALID_CONTROL_TOKEN', 'Bridge control authentication failed', { status: 401 });
        }
        if (pathname === '/control/status') {
          requireMethod(request, 'GET');
          sendJson(response, 200, { ok: true, service: 'live-dot-map-bridge', pid: process.pid, port });
          return;
        }
        requireMethod(request, 'POST');
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectRoot !== 'string' || !body.projectRoot.trim()) {
          throw new BridgeError('PROJECT_ROOT_REQUIRED', 'projectRoot is required', { status: 400 });
        }
        let projectHandle = typeof body.projectHandle === 'string' ? body.projectHandle : null;
        if (projectRegistry) {
          if (projectHandle) await projectRegistry.refresh?.();
          const registered = projectHandle ? projectRegistry.resolve(projectHandle) : await projectRegistry.register(body.projectRoot);
          const canonical = await canonicalDirectory(body.projectRoot);
          if (registered.projectRoot !== canonical) {
            throw new BridgeError('PROJECT_HANDLE_MISMATCH', 'Project handle does not match the requested project', { status: 403 });
          }
          projectHandle = registered.projectHandle;
        }
        const opened = await openProject(body.projectRoot);
        const ticket = issueBootstrapTicket(opened.root, projectHandle);
        sendJson(response, 201, {
          ok: true,
          bootstrapToken: ticket,
          ...(projectHandle ? { projectHandle } : {}),
        });
        return;
      }

      if (request.method === 'OPTIONS') {
        validateOrigin(request, response);
        response.statusCode = 204;
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-LiveDot-Project-Handle, X-LiveDot-Map-Key, Authorization');
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
      if (pathname === '/update/check') {
        requireMethod(request, 'GET');
        validateOrigin(request, response, { required: false });
        sendJson(response, 200, await checkUpdate());
        return;
      }
      if (pathname === '/session') {
        if (request.method === 'GET') {
          // A refresh must be able to recover the in-memory session from the
          // HttpOnly cookie after the one-time bootstrap token was removed
          // from the address bar. GET responses stay same-origin/loopback
          // constrained by the Host check; browsers may omit Origin on a
          // same-origin GET, so it is intentionally optional here.
          validateOrigin(request, response, { required: false });
          const { session: current } = readSession(request, response);
          sendJson(response, 200, {
            csrfToken: current.csrfToken,
            expiresAt: new Date(current.expiresAt).toISOString(),
            projects: current.projects ? [...current.projects.keys()] : [],
            projectRoot: current.projectRoot,
            resumed: true,
          });
          return;
        }
        requireMethod(request, 'POST');
        const authorization = request.headers.authorization || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const ticket = [...bootstrapTickets.entries()].find(([candidate]) => constantEqual(token, candidate));
        if (!ticket) throw new BridgeError('INVALID_BOOTSTRAP_TOKEN', 'Bootstrap token is invalid or has already been consumed', { status: 401 });
        bootstrapTickets.delete(ticket[0]);
        const existingId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
        if (sessionStore && existingId && ticket[1].projectHandle && ticket[1].projectRoot) {
          const authorized = sessionStore.authorize(existingId, ticket[1].projectHandle);
          if (authorized) {
            await sessionStore.persistIfDue();
            response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${existingId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionStore.ttlMs / 1000)}`);
            sendJson(response, 200, {
              csrfToken: authorized.csrfToken,
              expiresAt: authorized.expiresAt,
              projectHandle: ticket[1].projectHandle,
              reconnectTicket: authorized.reconnectTicket,
              resumed: true,
            });
            return;
          }
        }
        const existing = existingId && sessions.get(existingId);
        if (existing && existing.expiresAt > clock().getTime() && ticket[1].projectHandle && ticket[1].projectRoot) {
          existing.projects ??= new Map();
          existing.projects.set(ticket[1].projectHandle, { projectRoot: ticket[1].projectRoot });
          response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${existingId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}`);
          sendJson(response, 200, {
            csrfToken: existing.csrfToken,
            expiresAt: new Date(existing.expiresAt).toISOString(),
            projectHandle: ticket[1].projectHandle,
            resumed: true,
          });
          return;
        }
        const createdSession = sessionStore ? sessionStore.create({ projectHandle: ticket[1].projectHandle }) : null;
        const sessionId = createdSession?.sessionId || randomToken();
        const csrfToken = createdSession?.record.csrfToken || randomToken();
        const expiresAt = createdSession ? Date.parse(createdSession.record.expiresAt) : clock().getTime() + sessionTtlMs;
        const projects = new Map();
        if (ticket[1].projectHandle && ticket[1].projectRoot) projects.set(ticket[1].projectHandle, { projectRoot: ticket[1].projectRoot });
        if (!sessionStore) sessions.set(sessionId, { csrfToken, expiresAt, projectRoot: ticket[1].projectHandle ? null : ticket[1].projectRoot, projects });
        else await sessionStore.flush();
        const cookieTtl = sessionStore?.ttlMs || sessionTtlMs;
        response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(cookieTtl / 1000)}`);
        sendJson(response, 201, {
          csrfToken,
          expiresAt: new Date(expiresAt).toISOString(),
          projectRoot: ticket[1].projectHandle ? undefined : ticket[1].projectRoot,
          projectHandle: ticket[1].projectHandle,
          reconnectTicket: createdSession?.reconnectTicket,
          resumed: false,
        });
        return;
      }

      if (pathname === '/session/reconnect') {
        requireMethod(request, 'POST');
        if (!sessionStore || !projectRegistry) throw new BridgeError('RECONNECT_UNAVAILABLE', 'Persistent reconnect is not configured', { status: 503 });
        const peer = String(request.socket.remoteAddress || '');
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
          throw new BridgeError('LOOPBACK_REQUIRED', 'Reconnect is only available from loopback', { status: 403 });
        }
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectHandle !== 'string' || typeof body.reconnectTicket !== 'string') {
          throw new BridgeError('RECONNECT_CREDENTIALS_REQUIRED', 'projectHandle and reconnectTicket are required', { status: 400 });
        }
        projectRegistry.resolve(body.projectHandle);
        const reconnected = sessionStore.reconnect({ reconnectTicket: body.reconnectTicket, projectHandle: body.projectHandle, peer });
        await sessionStore.flush();
        response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${reconnected.sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionStore.ttlMs / 1000)}`);
        sendJson(response, 201, {
          csrfToken: reconnected.record.csrfToken,
          expiresAt: reconnected.record.expiresAt,
          projectHandle: body.projectHandle,
          reconnectTicket: reconnected.reconnectTicket,
        });
        return;
      }

      const session = authenticate(request, url, response);
      if (pathname === '/update/apply') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const applied = await applyUpdate();
        sendJson(response, 200, applied);
        scheduleRestart();
        return;
      }
      if (pathname === '/projects/pick') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const picked = await pickProjectFolder({ logger });
        if (picked.cancelled) {
          sendJson(response, 200, { cancelled: true, projectRoot: session.projectRoot });
          return;
        }
        const { root, store, mapId } = await openProject(picked.path);
        const binding = await authorizeOpenedProject(session, root);
        session.projectRoot = root;
        session.activeMapId = mapId;
        const snapshot = await store.snapshot();
        const setup = typeof agentSetup === 'function'
          ? await agentSetup(root).catch((error) => ({ ok: false, status: 'error', changed: false, code: error?.code || 'AGENT_SETUP_FAILED', message: String(error?.message || error).slice(0, 400) }))
          : { ok: true, status: 'none', changed: false, projectRoot: root, detectedAgents: {} };
        sendJson(response, 200, { cancelled: false, projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...binding, ...snapshot });
        return;
      }
      if (pathname === '/projects/recent') {
        requireMethod(request, 'GET');
        sendJson(response, 200, { projectRoot: session.projectRoot, recent: await recentProjectsStore.list() });
        return;
      }
      // ---- 多地图：列/建/切/改名。切换与新建返回与 /open 相同的装载载荷，
      // 前端复用同一段 attach 逻辑（projectId 换成新图的 mapId）。 ----
      if (pathname === '/maps') {
        requireMethod(request, 'GET');
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const { activeMap, maps } = await (await mapManagerFor(session.projectRoot)).list();
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap, maps });
        return;
      }
      if (pathname === '/maps/create') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const created = await (await mapManagerFor(session.projectRoot)).create(typeof body.name === 'string' ? body.name : '');
        logger.info('map.create', { root: session.projectRoot, map: created.createdMap });
        sendJson(response, 200, {
          projectRoot: session.projectRoot,
          ...created,
          projectId: created.documentId,
        });
        return;
      }
      if (pathname === '/maps/switch') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const switched = await (await mapManagerFor(session.projectRoot)).switch(String(body.mapId || ''));
        session.activeMapId = body.mapId;
        logger.info('map.switch', { root: session.projectRoot, map: body.mapId });
        sendJson(response, 200, { projectRoot: session.projectRoot, ...switched, projectId: switched.documentId });
        return;
      }
      if (pathname === '/maps/rename') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const executed = await (await mapManagerFor(session.projectRoot)).rename(String(body.mapId || ''), name, 'human');
        logger.info('map.rename', { root: session.projectRoot, map: body.mapId, revision: executed.revision });
        sendJson(response, 200, { ok: true, mapId: body.mapId, name: name.slice(0, 80), revision: executed.revision });
        return;
      }
      if (pathname === '/open') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectRoot !== 'string') throw new BridgeError('PROJECT_ROOT_REQUIRED', 'projectRoot is required', { status: 400 });
        const { root, store, mapId } = await openProject(body.projectRoot);
        const binding = await authorizeOpenedProject(session, root);
        session.projectRoot = root;
        session.activeMapId = mapId;
        const snapshot = await store.snapshot();
        // Agent setup is deliberately best-effort: map access must remain
        // available even when no supported Agent is installed or a local
        // configuration cannot be updated. The UI receives a truthful status
        // and can keep the first-trust step visible.
        const setup = typeof agentSetup === 'function'
          ? await agentSetup(root).catch((error) => ({ ok: false, status: 'error', changed: false, code: error?.code || 'AGENT_SETUP_FAILED', message: String(error?.message || error).slice(0, 400) }))
          : { ok: true, status: 'none', changed: false, projectRoot: root, detectedAgents: {} };
        sendJson(response, 200, { projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...binding, ...snapshot });
        return;
      }

      // 画布端操作日志转发：与桥日志写同一个文件（source=client），便于按时间线对人机操作。
      // 逐条校验结构与大小，画布异常刷屏也不会撑爆磁盘（单次最多 50 条 / 256KB）。
      if (pathname === '/logs/client') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, 256 * 1024);
        const entries = Array.isArray(body.entries) ? body.entries.slice(0, 50) : [];
        const levels = new Set(['info', 'warn', 'error']);
        let accepted = 0;
        for (const item of entries) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const { level, event, at, ...fields } = item;
          if (typeof event !== 'string' || !event) continue;
          const write = levels.has(level) ? level : 'info';
          await clientLog[write](String(event), { ...(typeof at === 'string' ? { clientAt: at } : {}), ...fields });
          accepted += 1;
        }
        sendJson(response, 200, { ok: true, accepted });
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
        const healthRecords = await readAgentHealth(root);
        // Optional Tencent adapter stays hidden until the user actually has
        // CodeBuddy/WorkBuddy or project configuration; the novice UI keeps
        // the default list focused on the three first-party adapters.
        const agents = Object.values(detected).filter((item) => item.id !== 'codebuddy' || item.discovered).map((item) => {
          const id = String(item.id);
          const health = healthRecords[id] || healthRecords[id.replace(/-code$/, '')] || (id === 'claude-code' ? healthRecords.claude : id === 'kimi-code' ? healthRecords.kimi : null);
          let state = 'not_installed';
          if (item.configured && !item.executable) state = 'error';
          else if (item.configured && item.executable) state = trust[id]?.acknowledged === true ? 'connected' : 'awaiting_trust';
          else if (item.executable) state = 'discovered';
          if (health?.status === 'error') state = 'error';
          return { ...item, state, trustAcknowledged: trust[id]?.acknowledged === true, health: health || null };
        });
        sendJson(response, 200, { projectRoot: root, agents, states: {
          not_installed: '未安装', discovered: '已发现', awaiting_trust: '待信任', connected: '已连接', error: '异常',
        } });
        return;
      }

      if (pathname === '/snapshot') {
        const store = await activeStore(session);
        const activeMap = session.activeMapId || await resolveActiveMap(session.projectRoot);
        if (request.method === 'GET') {
          sendJson(response, 200, { activeMap, ...await store.snapshot() });
          return;
        }
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        sendJson(response, 201, { activeMap, ...await store.createSnapshot() });
        return;
      }

      if (pathname === '/archive') {
        requireMethod(request, 'GET');
        const store = await activeStore(session);
        const snapshot = await store.snapshot();
        const lifecycle = new ArchiveLifecycle({ store, projectRoot: session.projectRoot, shared: adapter, clock, recycleBin: recycleService });
        const collections = ['routes', 'nodes', 'edges', 'anns'];
        const archived = collections.flatMap((collection) => (Array.isArray(snapshot.document[collection]) ? snapshot.document[collection] : [])
          .filter((item) => item?.archived === true)
          .map((item) => ({
            collection,
            id: String(item.id),
            name: String(item.name || item.text || item.id),
            archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
            archivedBy: typeof item.archivedBy === 'string' ? item.archivedBy : null,
            archiveReason: typeof item.archiveReason === 'string' ? item.archiveReason : null,
            purgeEligible: lifecycle.eligible(item, { now: clock() }),
          })));
        sendJson(response, 200, { mapKey: session.activeMapId, documentId: snapshot.document.mapId, revision: snapshot.revision, archived });
        return;
      }

      if (pathname === '/archive/restore') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        const store = await activeStore(session);
        const snapshot = await store.snapshot();
        const collection = String(body.collection || '');
        const id = String(body.id || '');
        const result = await store.execute({
          projectId: String(snapshot.document.mapId),
          baseRevision: snapshot.revision,
          commandId: `human-restore-${randomUUID()}`,
          actor: 'human',
          sessionId: 'browser-archive-settings',
          commands: [{ op: 'restore', collection, id }],
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === '/archive/purge') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        const id = String(body.id || '');
        if (body.confirmed !== true || String(body.confirmation || '') !== id) {
          throw new BridgeError('PURGE_HUMAN_CONFIRMATION_REQUIRED', '永久清除需要再次输入对象 ID 确认', { status: 403 });
        }
        const store = await activeStore(session);
        const lifecycle = new ArchiveLifecycle({ store, projectRoot: session.projectRoot, shared: adapter, clock, recycleBin: recycleService });
        const result = await lifecycle.purge({
          collection: String(body.collection || ''),
          id,
          actor: 'human',
          confirmed: true,
          commandId: `human-purge-${randomUUID()}`,
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === '/editors') {
        requireMethod(request, 'GET');
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).list());
        return;
      }

      if (pathname === '/editors/open') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).open({
          editorId: String(body.editorId || ''),
          relativePath: String(body.relativePath || ''),
          targetKind: body.targetKind === 'directory' ? 'directory' : 'file',
        }));
        return;
      }

      if (pathname === '/editors/preferred') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).setPreferredEditor(String(body.editorId || '')));
        return;
      }

      if (pathname === '/editors/pick') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).pickManualEditor());
        return;
      }

      if (pathname === '/editors/save-as') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).saveAs({ relativePath: String(body.relativePath || '') }));
        return;
      }

      if (pathname === '/markdown') {
        const markdown = markdownStoreFor(session.projectRoot);
        if (request.method === 'GET') {
          const requestedPath = url.searchParams.get('path');
          if (!requestedPath) throw new BridgeError('MARKDOWN_PATH_REQUIRED', 'path is required', { status: 400 });
          const created = url.searchParams.get('create') === '1' || url.searchParams.get('create') === 'true';
          const title = url.searchParams.get('title') || '';
          sendJson(response, 200, await markdown.read(await mapMarkdownPath(session, requestedPath), { create: created, title }));
          return;
        }
        if (request.method === 'PUT' || request.method === 'POST') {
          requireMethod(request, request.method);
          validateCsrf(request, session);
          const body = await readJsonBody(request, bodyLimit);
          if (typeof body.path !== 'string') throw new BridgeError('MARKDOWN_PATH_REQUIRED', 'path is required', { status: 400 });
          const saved = await markdown.write(await mapMarkdownPath(session, body.path), body.content, { baseEtag: body.baseEtag ?? body.etag });
          // 人类保存即产生「未确认输入」信号：Agent 的 humanUpdates 必列，直到 ack。
          try {
            await (await humanMdLogFor(session)).record({
              path: saved.path,
              etag: saved.etag,
              mtime: saved.updatedAt,
              snippet: String(saved.content ?? ''),
            });
          } catch (error) {
            logger.warn('human-md-updates.record', { path: saved.path, error: error?.message });
          }
          sendJson(response, 200, saved);
          return;
        }
        throw new BridgeError('METHOD_NOT_ALLOWED', 'Expected GET, PUT or POST', { status: 405 });
      }

      if (pathname === '/markdown/reveal') {
        const markdown = markdownStoreFor(session.projectRoot);
        if (request.method === 'GET') {
          const requestedPath = url.searchParams.get('path');
          if (!requestedPath) throw new BridgeError('MARKDOWN_PATH_REQUIRED', 'path is required', { status: 400 });
          sendJson(response, 200, await markdown.reveal(await mapMarkdownPath(session, requestedPath)));
          return;
        }
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.path !== 'string') throw new BridgeError('MARKDOWN_PATH_REQUIRED', 'path is required', { status: 400 });
        // 可观察的本机副作用统一经过 EditorService + 原生 helper；旧 reveal
        // 接口只作为“在文件夹中显示”的兼容入口。
        const path = await mapMarkdownPath(session, body.path);
        const metadata = await markdown.reveal(path);
        const opened = await (await editorServiceFor(session.projectRoot)).open({ editorId: 'folder', relativePath: path });
        sendJson(response, 200, { ...metadata, opened: opened.launched === true });
        return;
      }

      if (pathname === '/bundles') {
        requireMethod(request, 'GET');
        const ownerKind = url.searchParams.get('ownerKind');
        const ownerId = url.searchParams.get('ownerId');
        if (!ownerKind || !ownerId) throw new BridgeError('BUNDLE_OWNER_REQUIRED', 'ownerKind and ownerId are required', { status: 400 });
        const bundle = await activeBundleStore(session);
        sendJson(response, 200, {
          files: await bundle.list({ ownerKind, ownerId, includeArchived: url.searchParams.get('includeArchived') === 'true' }),
        });
        return;
      }

      if (pathname === '/bundles/markdown/read') {
        requireMethod(request, 'GET');
        const ownerKind = url.searchParams.get('ownerKind');
        const ownerId = url.searchParams.get('ownerId');
        const fileName = url.searchParams.get('fileName') || 'index.md';
        if (!ownerKind || !ownerId) throw new BridgeError('BUNDLE_OWNER_REQUIRED', 'ownerKind and ownerId are required', { status: 400 });
        const bundle = await activeBundleStore(session);
        const { buffer: _buffer, ...markdown } = await bundle.readMarkdown({
          ownerKind,
          ownerId,
          fileName,
          archived: url.searchParams.get('archived') === 'true',
        });
        sendJson(response, 200, markdown);
        return;
      }

      if (pathname === '/bundles/markdown/create' || pathname === '/bundles/markdown/replace' || pathname === '/bundles/markdown/append' || pathname === '/bundles/rename' || pathname === '/bundles/archive' || pathname === '/bundles/restore') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        const bundle = await activeBundleStore(session);
        let result;
        if (pathname === '/bundles/markdown/create') result = await bundle.createMarkdown(body);
        else if (pathname === '/bundles/markdown/replace') result = await bundle.replaceMarkdown(body);
        else if (pathname === '/bundles/markdown/append') result = await bundle.appendMarkdown(body);
        else if (pathname === '/bundles/rename') result = await bundle.rename(body);
        else if (pathname === '/bundles/archive') result = await bundle.archive(body);
        else result = await bundle.restore(body);
        sendJson(response, 200, result);
        return;
      }

      if (pathname === '/assets/import') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const ownerKind = url.searchParams.get('ownerKind');
        const ownerId = url.searchParams.get('ownerId');
        const fileName = url.searchParams.get('fileName');
        if (!ownerKind || !ownerId || !fileName) throw new BridgeError('ASSET_FIELDS_REQUIRED', 'ownerKind, ownerId and fileName are required', { status: 400 });
        const bundle = await activeBundleStore(session);
        const result = await bundle.importAsset({
          ownerKind,
          ownerId,
          fileName,
          stream: request,
          mimeType: String(request.headers['content-type'] || ''),
        });
        sendJson(response, 201, result);
        return;
      }

      if (pathname === '/assets/read') {
        requireMethod(request, 'GET');
        const ownerKind = url.searchParams.get('ownerKind');
        const ownerId = url.searchParams.get('ownerId');
        const fileName = url.searchParams.get('fileName');
        if (!ownerKind || !ownerId || !fileName) throw new BridgeError('ASSET_FIELDS_REQUIRED', 'ownerKind, ownerId and fileName are required', { status: 400 });
        const bundle = await activeBundleStore(session);
        const asset = await bundle.readAsset({ ownerKind, ownerId, fileName, archived: url.searchParams.get('archived') === 'true' });
        response.statusCode = 200;
        response.setHeader('Content-Type', asset.mimeType);
        response.setHeader('Content-Length', asset.buffer.length);
        response.setHeader('Content-Disposition', `${asset.disposition}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
        response.end(asset.buffer);
        return;
      }

      if (pathname === '/commands') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        const current = await store.snapshot();
        const claimedDocumentId = body.documentId ?? body.projectId;
        if (claimedDocumentId !== undefined && String(claimedDocumentId) !== String(current.document.mapId)) {
          throw new BridgeError('DOCUMENT_ID_MISMATCH', 'documentId does not match the routed map', { status: 409 });
        }
        // This endpoint is the authenticated browser/human channel.  Never
        // trust a caller-supplied actor value; Agent writes use the MCP channel.
        const executed = await store.execute({ ...body, actor: 'human' });
        logger.info('commands', { count: Array.isArray(body.commands) ? body.commands.length : 0, revision: executed?.revision, actor: 'human' });
        // 建节点命令提交成功后补建资料包主文档，避免“有记录无 index.md”的半状态
        // （幂等：已存在则原样返回；补建失败不阻断已落盘的提交，打开时还有懒创建兜底）。
        if (Array.isArray(body.commands)) {
          try {
            const bundle = await activeBundleStore(session);
            for (const command of body.commands) {
              if (command?.op === 'create' && command?.collection === 'nodes' && typeof command?.value?.id === 'string') {
                await bundle.ensureIndex({ ownerKind: 'node', ownerId: command.value.id, title: String(command.value.name || '') }).catch((error) => {
                  logger.warn('bundle.ensureIndex', { ownerId: command.value.id, error: error?.message });
                });
              }
            }
          } catch (error) {
            logger.warn('bundle.ensureIndex.failed', { error: error?.message });
          }
        }
        sendJson(response, 200, executed);
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
        response.write(`event: ready\ndata: ${JSON.stringify({ projectHandle: session.projectHandle, mapKey: session.activeMapId, revision: snapshot.revision, checksum: snapshot.checksum })}\n\n`);
        events.subscribe(storeKey(session.projectRoot, session.activeMapId), response);
        events.subscribe(`project::${session.projectRoot}`, response);
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
        const body = await readJsonBody(request, bodyLimit);
        try {
          const tool = String(body.tool || body.name || '');
          const args = body.arguments && typeof body.arguments === 'object' ? body.arguments : {};
          const manager = await mapManagerFor(session.projectRoot);
          const service = new ToolService({
            mapManager: manager,
            shared: adapter,
            actor: 'agent:bridge',
            projectHandle: session.projectHandle || 'browser',
          });
          const result = await service.dispatch(tool, {
            ...args,
            mapKey: typeof args.mapKey === 'string' && args.mapKey ? args.mapKey : session.activeMapId,
          });
          if (tool === 'map_switch' && result?.activeMap) session.activeMapId = result.activeMap;
          await recordAgentHealth(session.projectRoot, 'agent:bridge', `mcp:${tool}`, 'ok');
          logger.info('mcp', { tool, ok: true });
          sendJson(response, 200, { tool, result });
          return;
        } catch (error) {
          await recordAgentHealth(session.projectRoot, 'agent:bridge', `mcp:${String(body.tool || body.name || 'unknown')}`, 'error', error);
          logger.error('mcp', { tool: String(body.tool || body.name || 'unknown'), error });
          throw error;
        }
      }

      throw new BridgeError('NOT_FOUND', 'Endpoint not found', { status: 404 });
    } catch (error) {
      // 4xx 已在 http 完成日志里按 warn 记录；这里只补充 5xx 的堆栈细节。
      if ((asBridgeError(error).status || 500) >= 500) {
        logger.error('request.error', { method: request.method, path: String(request.url || '').split('?')[0], error });
      }
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
    server.listen(listenPort, host, resolve);
  });
  port = server.address().port;

  async function pollActiveMaps() {
    for (const [root, manager] of mapManagers) {
      try {
        const mapKey = await resolveActiveMap(root);
        const previous = knownActiveMaps.get(root);
        if (!previous) {
          knownActiveMaps.set(root, mapKey);
          continue;
        }
        if (previous === mapKey) continue;
        // 外部 stdio MCP 只有在新图可完整打开时才会通知画布；损坏 pointer
        // 只记录诊断，不让所有标签页跟进不可用地图。
        const context = await manager.resolve({ mapKey });
        knownActiveMaps.set(root, mapKey);
        events.publish(`project::${root}`, {
          type: 'active-map-changed',
          mapKey,
          documentId: context.documentId,
          source: 'external',
        });
      } catch (error) {
        logger.warn('map.pointer.watch', { root, error });
      }
    }
  }
  if (Number(activeMapPollIntervalMs) > 0) {
    activeMapTimer = setInterval(
      () => pollActiveMaps().catch((error) => logger.warn('map.pointer.watch', { error })),
      Math.max(50, Number(activeMapPollIntervalMs)),
    );
    activeMapTimer.unref?.();
  }

  async function runRetentionSweep() {
    if (!recycleService) return;
    for (const projectRoot of roots.keys()) {
      try {
        const manager = await mapManagerFor(projectRoot);
        const listed = await manager.list();
        for (const map of listed.maps) {
          const context = await manager.resolve({ mapKey: map.id });
          const lifecycle = new ArchiveLifecycle({ store: context.store, projectRoot, shared: adapter, clock, recycleBin: recycleService });
          for (const item of await lifecycle.listEligible({ now: clock() })) {
            await lifecycle.purge({ ...item, actor: 'system:retention', now: clock(), commandId: `retention-purge-${randomUUID()}` });
          }
        }
      } catch (error) {
        logger.warn('archive.retention', { root: projectRoot, error });
      }
    }
  }
  if (retentionEnabled && Number(retentionIntervalMs) > 0) {
    retentionStartTimer = setTimeout(() => {
      runRetentionSweep().catch((error) => logger.warn('archive.retention', { error }));
      retentionTimer = setInterval(() => runRetentionSweep().catch((error) => logger.warn('archive.retention', { error })), Number(retentionIntervalMs));
      retentionTimer.unref?.();
    }, Math.max(0, Number(retentionInitialDelayMs) || 0));
    retentionStartTimer.unref?.();
  }

  return {
    host,
    port,
    origin: `http://${host}:${port}`,
    bootstrapToken,
    issueBootstrapTicket,
    close: async () => {
      if (activeMapTimer) clearInterval(activeMapTimer);
      if (retentionStartTimer) clearTimeout(retentionStartTimer);
      if (retentionTimer) clearInterval(retentionTimer);
      events.close();
      await Promise.all([...mapManagers.values()].map((manager) => manager.close()));
      if (sessionStore) await sessionStore.flush();
      else sessions.clear();
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
