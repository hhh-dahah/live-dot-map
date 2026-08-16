import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { canonicalDirectory } from './fs-utils.mjs';
import { asBridgeError, BridgeError } from './errors.mjs';
import { noopLogger } from './logger.mjs';
import { ProjectStore } from './project-store.mjs';
import { MarkdownStore } from './markdown-store.mjs';
import {
  createMap,
  ensureMapsLayout,
  isSafeMapId,
  listMaps,
  mapDirectory,
  mapRelativeDirectory,
  readActiveMap,
  resolveActiveMap,
  writeActiveMap,
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

async function markdownDocuments(root, limit = 200) {
  const output = [];
  const ignored = new Set(['.git', 'node_modules', '.next', 'dist', 'out', '.bridge', 'backups', 'snapshots', 'quarantine']);
  const walk = async (directory, depth) => {
    if (depth > 5 || output.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= limit || ignored.has(entry.name)) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        const metadata = await stat(full).catch(() => null);
        if (!metadata || metadata.size > 2_000_000) continue;
        const text = await readFile(full, 'utf8').catch(() => '');
        if (text && text.length <= 2_000_000) output.push({ path: full.slice(root.length + 1).replace(/\\/g, '/'), text });
      }
    }
  };
  await walk(root, 0);
  return output;
}

function markdownSection(text, headings) {
  const wanted = new Set(headings.map((heading) => heading.replace(/\s+/g, '')));
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*#{1,6}\s*(.*?)\s*$/);
    if (!match || !wanted.has(match[1].replace(/[：:]\s*$/, '').replace(/\s+/g, ''))) continue;
    const content = [];
    for (let next = index + 1; next < lines.length && !/^\s*#{1,6}\s+/.test(lines[next]); next += 1) content.push(lines[next]);
    return content.join('\n').trim();
  }
  return '';
}

function attemptEvidence(document, markdown) {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, '/'), String(item.text || '')]));
  const mapDir = typeof document?.mapDir === 'string' && document.mapDir ? document.mapDir : '.live-dot-map';
  return (Array.isArray(document.edges) ? document.edges : [])
    .filter((edge) => ['failed', 'success', 'pending'].includes(String(edge.status)) && edge.archived !== true && edge.shelved !== true)
    .map((edge) => {
      const path = String(edge.md || `${mapDir}/routes/${edge.id}.md`).replace(/\\/g, '/');
      const text = docs.get(path) || '';
      return {
        id: String(edge.id), status: String(edge.status), name: String(edge.name || edge.id), path,
        evidence: markdownSection(text, ['关键证据', '证据']).slice(0, 360),
        result: markdownSection(text, ['结果', '结论']).slice(0, 360),
        failureReason: markdownSection(text, ['失败原因', '失败原因/排除条件']).slice(0, 360),
        nextStep: markdownSection(text, ['下一步', '后续建议']).slice(0, 360),
        hasMarkdown: Boolean(text),
      };
    })
    .sort((a, b) => (a.status === 'failed' ? -1 : 0) - (b.status === 'failed' ? -1 : 0) || a.id.localeCompare(b.id))
    .slice(0, 8);
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
  agentSetup = ensureProjectAgentConfig,
  logger = noopLogger,
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
  const markdownStores = new Map();
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

  // 多地图：stores/事件频道按「项目::地图」键控；会话记住自己当前的地图 id。
  const storeKey = (root, mapId) => `${root}::${mapId}`;

  async function openMapStore(root, mapId, { mapName } = {}) {
    const key = storeKey(root, mapId);
    let store = stores.get(key);
    if (!store) {
      store = await ProjectStore.open({
        projectRoot: root,
        dataDirectory: mapDirectory(root, mapId),
        mapName,
        mapDir: mapRelativeDirectory(mapId),
        shared: adapter,
        snapshotEvery,
        pollIntervalMs,
        clock,
        faultInjector,
        onEvent: (event) => events.publish(
          key,
          event.type === 'external' ? { ...event, type: 'revision', source: 'external' } : event,
        ),
      });
      stores.set(key, store);
    }
    return store;
  }

  async function activeStore(session) {
    if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
    if (!session.activeMapId) session.activeMapId = await resolveActiveMap(session.projectRoot);
    const store = stores.get(storeKey(session.projectRoot, session.activeMapId));
    if (!store) return openMapStore(session.projectRoot, session.activeMapId);
    return store;
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
    await recordRecentProject(root).catch(() => undefined);
    // 打开项目时幂等迁移到多地图布局（老项目先备份再动），再按指针打开当前地图。
    const { activeMap } = await ensureMapsLayout(root);
    const store = await openMapStore(root, activeMap);
    if (!markdownStores.has(root)) markdownStores.set(root, new MarkdownStore(root));
    logger.info('project.open', { root, map: activeMap });
    return { root, store, mapId: activeMap };
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
      events.close();
      Promise.all([...stores.values()].map((store) => store.close())).catch(() => undefined).finally(() => {
        sessions.clear();
        server.close(() => process.exit(0));
        server.closeAllConnections?.();
        setTimeout(() => process.exit(0), 1500).unref?.();
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
        ['/api/v1/update/check', '/update/check'],
        ['/api/v1/update/apply', '/update/apply'],
        ['/api/v1/logs/client', '/logs/client'],
      ]);
      const pathname = aliases.get(url.pathname) || url.pathname;

      if (request.method === 'OPTIONS') {
        validateOrigin(request, response);
        response.statusCode = 204;
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
          const current = authenticate(request);
          sendJson(response, 200, {
            csrfToken: current.csrfToken,
            expiresAt: new Date(current.expiresAt).toISOString(),
            projectRoot: current.projectRoot,
            resumed: true,
          });
          return;
        }
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
        sendJson(response, 201, { csrfToken, expiresAt: new Date(expiresAt).toISOString(), resumed: false });
        return;
      }

      const session = authenticate(request);
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
        session.projectRoot = root;
        session.activeMapId = mapId;
        const snapshot = await store.snapshot();
        const setup = typeof agentSetup === 'function'
          ? await agentSetup(root).catch((error) => ({ ok: false, status: 'error', changed: false, code: error?.code || 'AGENT_SETUP_FAILED', message: String(error?.message || error).slice(0, 400) }))
          : { ok: true, status: 'none', changed: false, projectRoot: root, detectedAgents: {} };
        sendJson(response, 200, { cancelled: false, projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...snapshot });
        return;
      }
      if (pathname === '/projects/recent') {
        requireMethod(request, 'GET');
        sendJson(response, 200, { projectRoot: session.projectRoot, recent: await readRecentProjects() });
        return;
      }
      // ---- 多地图：列/建/切/改名。切换与新建返回与 /open 相同的装载载荷，
      // 前端复用同一段 attach 逻辑（projectId 换成新图的 mapId）。 ----
      if (pathname === '/maps') {
        requireMethod(request, 'GET');
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const { activeMap, maps } = await listMaps(session.projectRoot);
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap, maps });
        return;
      }
      if (pathname === '/maps/create') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const created = await createMap(session.projectRoot, typeof body.name === 'string' ? body.name : '');
        await writeActiveMap(session.projectRoot, created.id);
        session.activeMapId = created.id;
        const store = await openMapStore(session.projectRoot, created.id, { mapName: created.name });
        const snapshot = await store.snapshot();
        logger.info('map.create', { root: session.projectRoot, map: created.id });
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap: created.id, projectId: snapshot.document.mapId, ...snapshot });
        return;
      }
      if (pathname === '/maps/switch') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        if (!isSafeMapId(body.mapId)) throw new BridgeError('INVALID_MAP_ID', '地图 ID 无效', { status: 400 });
        if (!(await listMaps(session.projectRoot)).maps.some((map) => map.id === body.mapId)) {
          throw new BridgeError('MAP_NOT_FOUND', `地图不存在：${body.mapId}`, { status: 404 });
        }
        await writeActiveMap(session.projectRoot, body.mapId);
        session.activeMapId = body.mapId;
        const store = await openMapStore(session.projectRoot, body.mapId);
        const snapshot = await store.snapshot();
        logger.info('map.switch', { root: session.projectRoot, map: body.mapId });
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap: body.mapId, projectId: snapshot.document.mapId, ...snapshot });
        return;
      }
      if (pathname === '/maps/rename') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        if (!isSafeMapId(body.mapId)) throw new BridgeError('INVALID_MAP_ID', '地图 ID 无效', { status: 400 });
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) throw new BridgeError('MAP_NAME_REQUIRED', '地图名称不能为空', { status: 400 });
        if (!(await listMaps(session.projectRoot)).maps.some((map) => map.id === body.mapId)) {
          throw new BridgeError('MAP_NOT_FOUND', `地图不存在：${body.mapId}`, { status: 404 });
        }
        // 重命名走目标图的命令通道（set_meta），与画布改名一样进 WAL，保持 revision/审计一致。
        const store = await openMapStore(session.projectRoot, body.mapId);
        const current = await store.snapshot();
        const executed = await store.execute({
          commandId: `map-rename-${randomToken(12)}`,
          baseRevision: current.revision,
          command: { op: 'set_meta', patch: { name: name.slice(0, 80) } },
          actor: 'human',
        });
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
        sendJson(response, 200, { projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...snapshot });
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
        if (request.method === 'GET') {
          sendJson(response, 200, await store.snapshot());
          return;
        }
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        sendJson(response, 201, await store.createSnapshot());
        return;
      }

      if (pathname === '/markdown') {
        const markdown = markdownStores.get(session.projectRoot);
        if (!markdown) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
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
          sendJson(response, 200, await markdown.write(await mapMarkdownPath(session, body.path), body.content, { baseEtag: body.baseEtag ?? body.etag }));
          return;
        }
        throw new BridgeError('METHOD_NOT_ALLOWED', 'Expected GET, PUT or POST', { status: 405 });
      }

      if (pathname === '/markdown/reveal') {
        const markdown = markdownStores.get(session.projectRoot);
        if (!markdown) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
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
        // Opening Explorer is an observable local side effect, so it stays on
        // a CSRF-protected POST rather than a GET beacon.
        sendJson(response, 200, await markdown.reveal(await mapMarkdownPath(session, body.path), { open: true }));
        return;
      }

      if (pathname === '/commands') {
        requireMethod(request, 'POST');
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        // This endpoint is the authenticated browser/human channel.  Never
        // trust a caller-supplied actor value; Agent writes use the MCP channel.
        const executed = await store.execute({ ...body, actor: 'human' });
        logger.info('commands', { count: Array.isArray(body.commands) ? body.commands.length : 0, revision: executed?.revision, actor: 'human' });
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
        response.write(`event: ready\ndata: ${JSON.stringify({ revision: snapshot.revision, checksum: snapshot.checksum })}\n\n`);
        events.subscribe(storeKey(session.projectRoot, session.activeMapId), response);
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
        try {
        const tool = body.tool || body.name;
        const args = body.arguments && typeof body.arguments === 'object' ? body.arguments : {};
        const snapshot = await store.snapshot();
        const agentEnvelope = (commands, prefix) => ({
          projectId: snapshot.document.mapId,
          baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : snapshot.revision,
          commandId: typeof args.commandId === 'string' ? args.commandId : `${prefix}-${randomToken(12)}`,
          actor: 'agent:bridge',
          sessionId: 'agent-bridge',
          commands,
        });
        let result;
        if (tool === 'map_get_context') {
          const markdown = Array.isArray(args.markdown) ? args.markdown : await markdownDocuments(session.projectRoot);
          const context = adapter.retrieveContext(snapshot.document, String(args.query || ''), { markdown, currentNodeId: args.currentNodeId == null ? null : String(args.currentNodeId) });
          const projection = { ...adapter.buildProjectProjection(snapshot.document, { now: typeof args.now === 'string' ? args.now : undefined }), attemptEvidence: attemptEvidence(snapshot.document, markdown) };
          result = { revision: snapshot.revision, projection, attemptEvidence: projection.attemptEvidence, ...context };
        } else if (tool === 'map_read_markdown') {
          const markdown = markdownStores.get(session.projectRoot);
          if (!markdown) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
          result = await markdown.read(await mapMarkdownPath(session, String(args.path || '')), { create: args.create === true, title: String(args.title || '') });
        } else if (tool === 'map_write_markdown') {
          const markdown = markdownStores.get(session.projectRoot);
          if (!markdown) throw new BridgeError('PROJECT_NOT_OPEN', 'Open an allowlisted project first', { status: 409 });
          result = await markdown.write(await mapMarkdownPath(session, String(args.path || '')), args.content, { baseEtag: args.baseEtag ?? args.etag });
        } else if (tool === 'map_list_human_updates') {
          result = { revision: snapshot.revision, updates: snapshot.document.anns.filter((ann) => ann.source === 'human' && ['new', 'delivered'].includes(ann.attention)) };
        } else if (tool === 'map_ack_human_updates') {
          result = await store.execute(agentEnvelope([{
            op: 'ack_annotations',
            ids: Array.isArray(args.ids) ? args.ids.map(String) : [],
            summary: String(args.summary || ''),
          }], 'mcp-ack'));
        } else if (tool === 'map_next_candidates') {
          const markdown = Array.isArray(args.markdown) ? args.markdown : await markdownDocuments(session.projectRoot);
          const context = adapter.retrieveContext(snapshot.document, String(args.query || ''), {
            currentNodeId: args.currentNodeId === null || args.currentNodeId === undefined ? null : String(args.currentNodeId),
            limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
            includeHistory: args.includeHistory === true,
            markdown,
          });
          result = { revision: snapshot.revision, projection: adapter.buildProjectProjection(snapshot.document), attemptEvidence: attemptEvidence(snapshot.document, markdown), alternatives: adapter.findExplorationAlternatives(snapshot.document, args.currentNodeId == null ? null : String(args.currentNodeId), { limit: 3 }), ...context, autonomy: adapter.autonomyDecision(snapshot.document, context.objects) };
        } else if (tool === 'map_apply_commands') {
          result = await store.execute(agentEnvelope(Array.isArray(args.commands) ? args.commands : [], 'mcp-apply'));
        } else if (tool === 'map_validate') {
          const target = args.document || snapshot.document;
          const validation = await adapter.validateDocument(target);
          result = target === snapshot.document
            ? { ...validation, attemptIssues: validation.ok ? adapter.checkAttemptEvidence(snapshot.document, await markdownDocuments(session.projectRoot)) : [] }
            : validation;
        } else if (tool === 'map_checkpoint') {
          result = await store.createSnapshot();
        } else if (tool === 'map_plan_consolidation') {
          const markdown = await markdownDocuments(session.projectRoot);
          result = { revision: snapshot.revision, ...adapter.planConsolidation(snapshot.document, {
            now: typeof args.now === 'string' ? args.now : undefined,
            maxSuggestions: Number.isInteger(args.maxSuggestions) ? args.maxSuggestions : 12,
            markdown,
          }) };
        } else {
          throw new BridgeError('UNKNOWN_MCP_TOOL', 'Unknown MCP tool', { status: 404 });
        }
        await recordAgentHealth(session.projectRoot, 'agent:bridge', `mcp:${String(tool)}`, 'ok');
        logger.info('mcp', { tool: String(tool), ok: true });
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
