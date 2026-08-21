import { execFile as childExecFile, spawn as childSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { lstat, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { BridgeError } from './errors.mjs';
import { atomicWriteFile } from './fs-utils.mjs';

const SETTINGS_VERSION = 1;
const WINDOWS_EDITOR_IDS = new Set(['vscode', 'antigravity', 'pycharm', 'system', 'folder', 'manual']);
const EXE_NAME = /^(Code|Antigravity|pycharm64)\.exe$/i;
const EDITOR_ID = /^[a-z][a-z0-9-]{0,31}$/;

/* VS Code 之外按同一套安全校验探测的编辑器:注册表 App Paths + 常见安装路径,
   找不到就不出现在列表里;校验仍然只允许真实普通文件,拒绝符号链接。 */
const EXTRA_EDITORS = [
  {
    id: 'antigravity',
    label: 'Antigravity',
    appPaths: ['Antigravity.exe'],
    candidates() {
      const out = [];
      const local = process.env.LOCALAPPDATA;
      const programFiles = process.env.ProgramFiles;
      if (local) out.push(join(local, 'Programs', 'Antigravity', 'Antigravity.exe'));
      if (programFiles) out.push(join(programFiles, 'Antigravity', 'Antigravity.exe'));
      return out;
    },
  },
  {
    id: 'pycharm',
    label: 'PyCharm',
    appPaths: ['pycharm64.exe'],
    async candidates() {
      const out = [];
      const local = process.env.LOCALAPPDATA;
      if (local) {
        out.push(join(local, 'Programs', 'PyCharm', 'bin', 'pycharm64.exe'));
        // JetBrains Toolbox:%LOCALAPPDATA%\JetBrains\Toolbox\apps\<App>\ch-N\<版本>\bin\pycharm64.exe
        const toolbox = join(local, 'JetBrains', 'Toolbox', 'apps');
        out.push(...await scanVersionedEditors(toolbox, 3));
      }
      const programFiles = process.env.ProgramFiles;
      if (programFiles) out.push(...await scanVersionedEditors(join(programFiles, 'JetBrains'), 1));
      return out;
    },
  },
];

/** 在 root 下向下 depth 层版本目录里找 bin\pycharm64.exe 形态的编辑器主程序。 */
async function scanVersionedEditors(root, depth) {
  const found = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (depth <= 1) {
      found.push(join(dir, 'bin', 'pycharm64.exe'));
    } else {
      found.push(...await scanVersionedEditors(dir, depth - 1));
    }
  }
  return found;
}

function bridgeError(code, message, status = 400, details) {
  return new BridgeError(code, message, { status, details });
}

function defaultSettingsPath() {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(localAppData, 'live-dot-map', 'settings.json');
}

function normalizePathForCompare(path) {
  const value = resolve(path);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function isInside(root, candidate, { allowRoot = false } = {}) {
  const rootPath = normalizePathForCompare(root);
  const candidatePath = normalizePathForCompare(candidate);
  const rest = relative(rootPath, candidatePath);
  if (!rest) return allowRoot;
  return !rest.startsWith('..') && !isAbsolute(rest) && !win32.isAbsolute(rest);
}

function isAbsoluteAny(path) {
  return isAbsolute(path) || win32.isAbsolute(path);
}

function isRegularFile(metadata) {
  return Boolean(metadata?.isFile?.());
}

function isDirectory(metadata) {
  return Boolean(metadata?.isDirectory?.());
}

function isLink(metadata) {
  return Boolean(metadata?.isSymbolicLink?.() || metadata?.isReparsePoint === true);
}

function stripRegistryCommand(value) {
  let path = String(value ?? '').trim();
  if (!path) return '';
  const quoted = path.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  // App Paths values sometimes omit quotes. The executable has a stable name,
  // so discard the optional "%1"/arguments after it.
  const marker = path.search(/\s+[%\-]/);
  if (marker >= 0) path = path.slice(0, marker);
  return path.replace(/^"|"$/g, '').trim();
}

function normalizeCandidates(value) {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(normalizeCandidates);
  if (typeof value === 'object') {
    return normalizeCandidates(value.path ?? value.executable ?? value.defaultValue ?? value.value);
  }
  return [];
}

function parseRegistryOutput(output) {
  const values = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\(默认\)|\(Default\))\s+REG_SZ\s+(.+)\s*$/i);
    if (match) values.push(stripRegistryCommand(match[1]));
  }
  return values;
}

async function readAppPaths(exeNames, execFile = childExecFile) {
  if (process.platform !== 'win32') return [];
  const values = [];
  for (const exeName of exeNames) {
    const roots = [
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
      `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
      `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
    ];
    for (const root of roots) {
      try {
        const result = await new Promise((resolveResult, reject) => {
          execFile('reg.exe', ['query', root, '/ve'], { windowsHide: true, shell: false }, (error, stdout) => {
            if (error) reject(error);
            else resolveResult(stdout);
          });
        });
        values.push(...parseRegistryOutput(result));
      } catch {
        // A missing registry key is normal on machines without that editor.
      }
    }
  }
  return values;
}

async function readVSCodeAppPaths(execFile = childExecFile) {
  return readAppPaths(['Code.exe'], execFile);
}

function knownVSCodePaths() {
  const candidates = [];
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (local) candidates.push(join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'));
  if (programFiles) candidates.push(join(programFiles, 'Microsoft VS Code', 'Code.exe'));
  if (programFilesX86) candidates.push(join(programFilesX86, 'Microsoft VS Code', 'Code.exe'));
  // Portable installs are supported only when the caller explicitly injects
  // the path. Never search the project directory or PATH for an executable.
  return candidates;
}

function safeSettings(value) {
  const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const manualPath = settings.editors?.manual?.path;
  const preferred = typeof settings.preferredEditorId === 'string' && EDITOR_ID.test(settings.preferredEditorId)
    ? settings.preferredEditorId
    : null;
  return {
    version: SETTINGS_VERSION,
    preferredEditorId: preferred,
    editors: {
      manual: typeof manualPath === 'string' ? { path: manualPath } : {},
    },
  };
}

async function readSettingsFile(path) {
  try {
    return safeSettings(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return safeSettings({});
    throw error;
  }
}

/**
 * 外部编辑器服务。
 *
 * 浏览器侧只需要传 `vscode`/`system`/`folder`/`manual` 等 opaque id。
 * 项目路径、可执行文件解析、原生 helper 调用和设置落盘全部在桥端完成。
 * `nativeHelper` 是安装器提供的固定参数 helper；测试可注入函数，生产缺失时
 * 相关能力 fail-closed，不回退到 cmd / shell。
 */
export class EditorService {
  constructor(options = {}) {
    if (!options.projectRoot) throw bridgeError('PROJECT_ROOT_REQUIRED', '编辑器服务需要项目根目录', 400);
    this.projectRoot = resolve(options.projectRoot);
    this.settingsPath = resolve(options.settingsPath || defaultSettingsPath());
    this.clock = options.clock ?? (() => new Date());
    this.spawn = options.spawn ?? childSpawn;
    this.nativeHelper = options.nativeHelper ?? null;
    this.nativePicker = options.nativePicker ?? null;
    this.registryReader = options.registryReader ?? (() => readVSCodeAppPaths(options.execFile ?? childExecFile));
    this.extraRegistryReader = options.extraRegistryReader ?? ((exeNames) => readAppPaths(exeNames, options.execFile ?? childExecFile));
    this.extraEditors = Array.isArray(options.extraEditors) ? options.extraEditors : EXTRA_EDITORS;
    this.extraPaths = new Map();
    this.knownPaths = options.knownVSCodePaths ?? knownVSCodePaths;
    this.manualPathValidator = options.manualPathValidator;
    this.settings = null;
    this.vscodePath = undefined;
    this.pendingPickerToken = null;
  }

  static async open(options) {
    const service = new EditorService(options);
    await service.initialize();
    return service;
  }

  async initialize() {
    await this.#assertProjectRoot();
    this.settings = await readSettingsFile(this.settingsPath);
    return this;
  }

  async #ensureInitialized() {
    if (!this.settings) await this.initialize();
  }

  async #assertProjectRoot() {
    let metadata;
    try {
      metadata = await lstat(this.projectRoot);
    } catch (error) {
      if (error?.code === 'ENOENT') throw bridgeError('PROJECT_NOT_FOUND', '项目目录不存在', 404);
      throw error;
    }
    if (isLink(metadata) || !isDirectory(metadata)) throw bridgeError('PROJECT_ROOT_INVALID', '项目目录不是安全的普通目录', 403);
    const canonical = await realpath(this.projectRoot);
    if (!isInside(resolve(this.projectRoot, '..'), canonical, { allowRoot: true })) {
      throw bridgeError('PROJECT_ROOT_INVALID', '项目目录无法安全解析', 403);
    }
  }

  async #assertNoSymlinkEscape(candidate, { allowMissing = false, root = this.projectRoot } = {}) {
    const canonicalRoot = await realpath(root);
    let current = resolve(candidate);
    let metadata = null;
    while (true) {
      try {
        metadata = await lstat(current);
        break;
      } catch (error) {
        if (!allowMissing || error?.code !== 'ENOENT') throw error;
        const parent = dirname(current);
        if (parent === current) throw error;
        current = parent;
      }
    }
    if (isLink(metadata)) throw bridgeError('SYMLINK_ESCAPE', '拒绝通过符号链接或重解析点打开文件', 403);
    const canonicalCandidate = await realpath(current);
    if (!isInside(canonicalRoot, canonicalCandidate, { allowRoot: true })) {
      throw bridgeError('SYMLINK_ESCAPE', '路径解析后已越出项目目录', 403);
    }
    return canonicalCandidate;
  }

  async #projectPath(relativePath, { kind = 'file', allowMissing = false } = {}) {
    if (typeof relativePath !== 'string' || !relativePath.trim() || relativePath.includes('\0')) {
      throw bridgeError('INVALID_EDITOR_PATH', '编辑器目标路径无效', 400);
    }
    if (isAbsoluteAny(relativePath)) throw bridgeError('EDITOR_PATH_OUTSIDE_PROJECT', '编辑器只能打开项目内文件', 403);
    const candidate = resolve(this.projectRoot, relativePath);
    if (!isInside(this.projectRoot, candidate, { allowRoot: kind === 'directory' })) {
      throw bridgeError('EDITOR_PATH_OUTSIDE_PROJECT', '编辑器只能打开项目内文件', 403);
    }
    await this.#assertNoSymlinkEscape(candidate, { allowMissing });
    let metadata;
    try {
      metadata = await lstat(candidate);
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return candidate;
      if (error?.code === 'ENOENT') throw bridgeError('EDITOR_TARGET_NOT_FOUND', '编辑器目标不存在', 404);
      throw error;
    }
    if (isLink(metadata)) throw bridgeError('SYMLINK_ESCAPE', '拒绝通过符号链接或重解析点打开文件', 403);
    if (kind === 'file' && !isRegularFile(metadata)) throw bridgeError('EDITOR_TARGET_NOT_FILE', '编辑器目标不是文件', 400);
    if (kind === 'directory' && !isDirectory(metadata)) throw bridgeError('EDITOR_TARGET_NOT_DIRECTORY', '编辑器目标不是文件夹', 400);
    return candidate;
  }

  async #assertExternalExecutable(path) {
    if (typeof path !== 'string' || !isAbsoluteAny(path) || !EXE_NAME.test(path.split(/[\\/]/).pop() || '')) {
      throw bridgeError('EDITOR_EXECUTABLE_INVALID', '只允许真实的 Code.exe 或已选择的 .exe 程序', 403);
    }
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error?.code === 'ENOENT') throw bridgeError('EDITOR_NOT_FOUND', '编辑器程序不存在', 404);
      throw error;
    }
    if (isLink(metadata) || !isRegularFile(metadata)) throw bridgeError('EDITOR_EXECUTABLE_INVALID', '编辑器程序不是安全的普通文件', 403);
    const canonical = await realpath(path);
    if (!isInside(resolve(path, '..'), canonical, { allowRoot: true })) {
      throw bridgeError('EDITOR_EXECUTABLE_INVALID', '编辑器程序无法安全解析', 403);
    }
    return resolve(path);
  }

  async #assertManualExecutable(path) {
    if (typeof path !== 'string' || !isAbsoluteAny(path) || !/\.exe$/i.test(path)) {
      throw bridgeError('MANUAL_EDITOR_INVALID', '手动选择的程序必须是绝对路径 .exe 文件', 403);
    }
    if (this.manualPathValidator) {
      const result = await this.manualPathValidator(path);
      if (result === false) throw bridgeError('MANUAL_EDITOR_INVALID', '手动选择的程序未通过安全校验', 403);
    }
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error?.code === 'ENOENT') throw bridgeError('EDITOR_NOT_FOUND', '手动选择的程序不存在', 404);
      throw error;
    }
    if (isLink(metadata) || !isRegularFile(metadata)) throw bridgeError('MANUAL_EDITOR_INVALID', '手动选择的程序必须是普通 .exe 文件', 403);
    const canonical = await realpath(path);
    if (normalizePathForCompare(canonical) !== normalizePathForCompare(path)) {
      throw bridgeError('MANUAL_EDITOR_INVALID', '手动选择的程序不能是符号链接或重解析点', 403);
    }
    return resolve(path);
  }

  async #resolveVSCode() {
    if (this.vscodePath) {
      try {
        this.vscodePath = await this.#assertExternalExecutable(this.vscodePath);
        return this.vscodePath;
      } catch {
        this.vscodePath = undefined;
      }
    }
    const registry = await Promise.resolve(this.registryReader()).catch(() => []);
    const known = typeof this.knownPaths === 'function' ? await this.knownPaths() : this.knownPaths;
    const candidates = [...normalizeCandidates(registry), ...normalizeCandidates(known)];
    const seen = new Set();
    for (const candidate of candidates) {
      const path = stripRegistryCommand(candidate);
      if (!path || seen.has(normalizePathForCompare(path))) continue;
      seen.add(normalizePathForCompare(path));
      try {
        this.vscodePath = await this.#assertExternalExecutable(path);
        return this.vscodePath;
      } catch {
        // Keep looking; registry entries can point to an uninstalled version.
      }
    }
    this.vscodePath = undefined;
    return undefined;
  }

  /* VS Code 之外的编辑器走同一条候选解析+安全校验管线,结果按 id 缓存。 */
  async #resolveExtra(def) {
    const cached = this.extraPaths.get(def.id);
    if (cached) {
      try {
        const verified = await this.#assertExternalExecutable(cached);
        this.extraPaths.set(def.id, verified);
        return verified;
      } catch {
        this.extraPaths.delete(def.id);
      }
    }
    const registry = await Promise.resolve(this.extraRegistryReader(def.appPaths || [])).catch(() => []);
    const known = typeof def.candidates === 'function' ? await def.candidates() : def.candidates;
    const candidates = [...normalizeCandidates(registry), ...normalizeCandidates(known)];
    const seen = new Set();
    for (const candidate of candidates) {
      const path = stripRegistryCommand(candidate);
      if (!path || seen.has(normalizePathForCompare(path))) continue;
      seen.add(normalizePathForCompare(path));
      try {
        const resolved = await this.#assertExternalExecutable(path);
        this.extraPaths.set(def.id, resolved);
        return resolved;
      } catch {
        // Keep looking; registry entries can point to an uninstalled version.
      }
    }
    this.extraPaths.delete(def.id);
    return undefined;
  }

  async list() {
    await this.#ensureInitialized();
    const vscode = await this.#resolveVSCode();
    const manualPath = this.settings.editors.manual.path;
    let manualAvailable = false;
    if (manualPath) {
      try {
        await this.#assertManualExecutable(manualPath);
        manualAvailable = true;
      } catch {
        // Keep the id visible so the UI can offer the picker again, but never
        // expose the invalid path or claim it is launchable.
      }
    }
    const editors = [
      ...(vscode ? [{ id: 'vscode', label: 'VS Code', kind: 'editor', available: true }] : []),
    ];
    for (const def of this.extraEditors) {
      if (await this.#resolveExtra(def)) editors.push({ id: def.id, label: def.label, kind: 'editor', available: true });
    }
    editors.push(
      { id: 'system', label: '用默认应用打开', kind: 'system', available: Boolean(this.nativeHelper) },
      { id: 'folder', label: '在文件夹中显示', kind: 'folder', available: Boolean(this.nativeHelper) },
      {
        id: 'manual',
        label: manualAvailable ? '手动选择的程序' : '手动选择程序…',
        kind: 'manual',
        available: manualAvailable && Boolean(this.nativeHelper),
        needsPicker: !manualAvailable,
      },
    );
    const firstEditor = editors.find((editor) => editor.kind === 'editor' && editor.available);
    const preferredEditorId = editors.some((editor) => editor.id === this.settings.preferredEditorId && editor.available)
      ? this.settings.preferredEditorId
      : (firstEditor ? firstEditor.id : 'system');
    return { editors, preferredEditorId };
  }

  async listEditors() {
    return this.list();
  }

  async setPreferredEditor(editorId) {
    await this.#ensureInitialized();
    if (typeof editorId !== 'string' || !WINDOWS_EDITOR_IDS.has(editorId)) {
      throw bridgeError('EDITOR_ID_INVALID', '编辑器标识无效', 400);
    }
    const listing = await this.list();
    if (!listing.editors.some((editor) => editor.id === editorId && editor.available)) {
      throw bridgeError('EDITOR_NOT_AVAILABLE', '该编辑器当前不可用', 409);
    }
    this.settings.preferredEditorId = editorId;
    await this.#writeSettings();
    return { preferredEditorId: editorId };
  }

  async pickManualEditor() {
    await this.#ensureInitialized();
    const pickerToken = randomUUID();
    this.pendingPickerToken = pickerToken;
    let picked;
    try {
      if (this.nativePicker) picked = await this.nativePicker();
      else picked = await this.#callNative('pick-editor');
    } catch (error) {
      this.pendingPickerToken = null;
      throw error;
    }
    if (picked?.cancelled === true) {
      this.pendingPickerToken = null;
      return { cancelled: true };
    }
    const path = typeof picked === 'string' ? picked : picked?.path;
    return this.registerManual({ path, pickerToken });
  }

  // Deliberately does not accept a path from a browser-facing request. The
  // only supported registration path is the result of the native picker.
  async registerManual({ path, pickerToken } = {}) {
    if (!pickerToken || pickerToken !== this.pendingPickerToken) {
      throw bridgeError('NATIVE_PICKER_REQUIRED', '手动程序必须由本产品原生选择器登记', 403);
    }
    this.pendingPickerToken = null;
    const manualPath = await this.#assertManualExecutable(path);
    await this.#ensureInitialized();
    this.settings.editors.manual = { path: manualPath };
    await this.#writeSettings();
    return { id: 'manual', label: '手动选择的程序', available: true };
  }

  async #writeSettings() {
    await mkdir(dirname(this.settingsPath), { recursive: true });
    const output = {
      version: SETTINGS_VERSION,
      preferredEditorId: this.settings.preferredEditorId || null,
      editors: {
        manual: this.settings.editors.manual?.path ? { path: this.settings.editors.manual.path } : {},
      },
    };
    await atomicWriteFile(this.settingsPath, `${JSON.stringify(output, null, 2)}\n`);
  }

  async #callNative(operation, payload = {}) {
    if (typeof this.nativeHelper === 'function') return this.nativeHelper({ operation, ...payload });
    if (typeof this.nativeHelper?.run === 'function') return this.nativeHelper.run({ operation, ...payload });
    throw bridgeError('NATIVE_HELPER_UNAVAILABLE', '本机原生助手不可用，已拒绝执行', 503);
  }

  #launch(executable, args) {
    const child = this.spawn(executable, args, {
      shell: false,
      windowsHide: false,
      detached: true,
      stdio: 'ignore',
    });
    child?.unref?.();
    return { launched: true };
  }

  async open({ editorId, relativePath, targetKind = 'file' } = {}) {
    await this.#ensureInitialized();
    if (typeof editorId !== 'string' || !WINDOWS_EDITOR_IDS.has(editorId)) {
      throw bridgeError('EDITOR_ID_INVALID', '编辑器标识无效', 400);
    }
    if (editorId === 'folder') {
      const candidate = await this.#projectPath(relativePath, { kind: targetKind === 'directory' ? 'directory' : 'file' });
      const metadata = await stat(candidate);
      const folder = isDirectory(metadata) ? candidate : dirname(candidate);
      await this.#assertNoSymlinkEscape(folder);
      await this.#callNative('open-folder', { targetPath: folder });
      return { editorId, launched: true };
    }
    const target = await this.#projectPath(relativePath, { kind: 'file' });
    if (editorId === 'vscode') {
      const executable = await this.#resolveVSCode();
      if (!executable) throw bridgeError('EDITOR_NOT_AVAILABLE', '未检测到 VS Code', 503);
      return { editorId, ...this.#launch(executable, ['--reuse-window', target]) };
    }
    const extraDef = this.extraEditors.find((def) => def.id === editorId);
    if (extraDef) {
      const executable = await this.#resolveExtra(extraDef);
      if (!executable) throw bridgeError('EDITOR_NOT_AVAILABLE', `未检测到 ${extraDef.label}`, 503);
      return { editorId, ...this.#launch(executable, [target]) };
    }
    if (editorId === 'system') {
      await this.#callNative('open-default', { targetPath: target });
      return { editorId, launched: true };
    }
    const manualPath = await this.#assertManualExecutable(this.settings.editors.manual.path);
    await this.#callNative('open-manual', { executablePath: manualPath, targetPath: target });
    return { editorId, launched: true };
  }

  async saveAs({ relativePath } = {}) {
    await this.#ensureInitialized();
    const sourcePath = await this.#projectPath(relativePath, { kind: 'file' });
    const result = await this.#callNative('save-as', {
      sourcePath,
      suggestedName: sourcePath.split(/[\\/]/).pop() || 'document.md',
    });
    if (result?.cancelled === true) return { exported: false, cancelled: true };
    const destinationPath = typeof result === 'string' ? result : result?.destinationPath ?? result?.path;
    if (!destinationPath || !isAbsoluteAny(destinationPath) || destinationPath.includes('\0')) {
      throw bridgeError('SAVE_AS_INVALID_RESULT', '原生助手没有返回有效的导出路径', 502);
    }
    return { exported: true, fileName: destinationPath.split(/[\\/]/).pop() || null };
  }
}

export {
  defaultSettingsPath,
  isInside,
  knownVSCodePaths,
  parseRegistryOutput,
  readVSCodeAppPaths,
};
