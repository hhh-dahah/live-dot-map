#!/usr/bin/env node
// 记忆历史库：给 .live-dot-map 单独建 git 历史，历史库放在记忆目录之外（另一个盘）。
// 只往历史库里存快照，从不改写记忆目录；恢复一律导出到新目录。
//
//   node memory-history.mjs init --work-tree <记忆目录> --history <历史目录>
//   node memory-history.mjs snapshot [--allow-delete]     定时任务调用；没变化不提交
//   node memory-history.mjs status | log [--n 20]
//   node memory-history.mjs restore --to <新目录> [--at <提交号|"2026-10-12 10:00">]
//   node memory-history.mjs remote-init --url <仓库地址> [--exclude-map <地图id>]...
//   node memory-history.mjs install-task [--minutes 15] | remove-task
//
// --history 省略时取脚本所在目录（安装后脚本就放在历史目录里）。
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_FILE = 'livedot-history.json';
const ALERT_LOG = '告警.log';
const RUN_LOG = '运行.log';
const TASK_NAME = 'LiveDotMap 记忆快照';
const BASE_EXCLUDES = [
  '# 桥的运行文件：WAL、锁、内部快照，map.json 每次写入都是完整的，不需要它们',
  '.bridge/',
  '*.tmp',
  '*.lock',
];
const SECRET_PATTERNS = [
  ['GitHub 令牌', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['OpenAI/Anthropic 类密钥', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['AWS 密钥', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API 密钥', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack 令牌', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['私钥', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['密码/令牌赋值', /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-+/=]{12,}/i],
];
const BINARY_EXTENSIONS = /\.(pdf|png|jpe?g|gif|webp|bmp|ico|zip|7z|rar|gz|exe|dll|mp4|mov|mp3|wav|docx?|xlsx?|pptx?)$/i;

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const args = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (!value.startsWith('--')) { args._.push(value); continue; }
    const key = value.slice(2);
    const next = rest[i + 1];
    const parsed = !next || next.startsWith('--') ? true : (i += 1, next);
    if (key === 'exclude-map') (args[key] ??= []).push(parsed);
    else args[key] = parsed;
  }
  return { command, args };
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const stamp = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) delete env[key];
  if (!extra.GIT_INDEX_FILE) delete env.GIT_INDEX_FILE;
  return env;
}

function git(gitDir, workTree, args, { allowFail = false, env = {}, input } = {}) {
  const result = spawnSync('git', [
    '-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.longpaths=true',
    `--git-dir=${gitDir}`, ...(workTree ? [`--work-tree=${workTree}`] : []), ...args,
  ], { encoding: 'utf8', env: cleanEnv(env), input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

function historyDirectory(args) {
  return resolve(typeof args.history === 'string' ? args.history : scriptDirectory);
}

function readConfig(history) {
  const path = join(history, CONFIG_FILE);
  if (!existsSync(path)) throw new Error(`没有找到 ${path}，请先运行 init`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeConfig(history, config) {
  writeFileSync(join(history, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function log(history, message) {
  try { appendFileSync(join(history, RUN_LOG), `[${stamp()}] ${message}\n`, 'utf8'); } catch { /* 日志失败不影响快照 */ }
}

function alert(history, message, { popup = true } = {}) {
  try { appendFileSync(join(history, ALERT_LOG), `[${stamp()}] ${message}\n`, 'utf8'); } catch { /* 同上 */ }
  log(history, `告警：${message}`);
  process.stderr.write(`${message}\n`);
  if (!popup || process.env.LIVEDOT_HISTORY_NO_POPUP === '1' || process.platform !== 'win32') return;
  // 定时任务在后台跑，没人看输出；告警必须弹窗。分离子进程，脚本不等弹窗关闭。
  // 消息里有换行和路径，用 EncodedCommand 传，避免命令行转义出错。
  const text = `${message}\n\n详细记录：${join(history, ALERT_LOG)}`.replace(/'/g, "''");
  const script = `(New-Object -ComObject WScript.Shell).Popup('${text}', 0, '活点地图记忆快照', 48) | Out-Null`;
  const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function withRunLock(history, operation) {
  const lockPath = join(history, '.snapshot.lock');
  try {
    if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 10 * 60 * 1000) unlinkSync(lockPath);
  } catch { /* 下面 openSync 会再判断 */ }
  let handle;
  try {
    handle = openSync(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') { log(history, '上一次快照还没结束，本次跳过'); return 0; }
    throw error;
  }
  try {
    return operation();
  } finally {
    closeSync(handle);
    try { unlinkSync(lockPath); } catch { /* 已删 */ }
  }
}

function writeExcludes(gitDir, extra = []) {
  const infoDirectory = join(gitDir, 'info');
  mkdirSync(infoDirectory, { recursive: true });
  writeFileSync(join(infoDirectory, 'exclude'), `${[...BASE_EXCLUDES, ...extra].join('\n')}\n`, 'utf8');
}

function initRepository(gitDir, workTree, extraExcludes = []) {
  if (existsSync(join(gitDir, 'HEAD'))) return false;
  mkdirSync(gitDir, { recursive: true });
  git(gitDir, null, ['init', '--quiet', '--bare', '--initial-branch=main']);
  git(gitDir, null, ['config', 'core.bare', 'false']);
  git(gitDir, null, ['config', 'core.worktree', workTree.replace(/\\/g, '/')]);
  git(gitDir, null, ['config', 'core.quotepath', 'false']);
  git(gitDir, null, ['config', 'core.autocrlf', 'false']);
  git(gitDir, null, ['config', 'core.longpaths', 'true']);
  writeExcludes(gitDir, extraExcludes);
  return true;
}

function mapNames(workTree) {
  const names = new Map();
  const root = join(workTree, 'maps');
  if (!existsSync(root)) return names;
  for (const id of readdirSync(root)) {
    try { names.set(id, JSON.parse(readFileSync(join(root, id, 'map.json'), 'utf8')).name || id); } catch { names.set(id, id); }
  }
  return names;
}

/** porcelain -z：XY 路径；改名项后面跟一个原路径。 */
function readChanges(gitDir, workTree) {
  const output = git(gitDir, workTree, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout;
  const parts = output.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code.includes('R') || code.includes('C')) i += 1;
    changes.push({ code, path });
  }
  return changes;
}

function trackedCount(gitDir) {
  const head = git(gitDir, null, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true });
  if (head.status !== 0) return 0;
  return git(gitDir, null, ['ls-tree', '-r', '--name-only', 'HEAD']).stdout.split('\n').filter(Boolean).length;
}

/** 删除超过两成、或删掉任何一张地图的 map.json：多半是事故，不提交，等人确认。 */
function deletionGuard(gitDir, changes) {
  const deleted = changes.filter((change) => change.code.includes('D')).map((change) => change.path);
  const tracked = trackedCount(gitDir);
  const mapFiles = deleted.filter((path) => /^maps\/[^/]+\/map\.json$/.test(path));
  if (mapFiles.length) return `这次会删掉 ${mapFiles.length} 张地图的 map.json（${mapFiles.join('、')}）`;
  if (tracked && deleted.length >= 10 && deleted.length / tracked > 0.2) return `这次会删掉 ${deleted.length}/${tracked} 个文件`;
  return '';
}

function summarize(changes, names) {
  const counts = { added: 0, modified: 0, deleted: 0 };
  const touched = new Set();
  for (const { code, path } of changes) {
    if (code.includes('D')) counts.deleted += 1;
    else if (code === '??' || code.includes('A')) counts.added += 1;
    else counts.modified += 1;
    const match = path.match(/^maps\/([^/]+)\//);
    if (match) touched.add(names.get(match[1]) || match[1]);
  }
  const head = `快照 ${stamp()}：新增 ${counts.added}，修改 ${counts.modified}，删除 ${counts.deleted}`;
  return touched.size ? `${head}\n\n改动地图：${[...touched].join('、')}` : head;
}

function commitAll(gitDir, workTree, message) {
  git(gitDir, workTree, ['add', '-A']);
  const staged = git(gitDir, workTree, ['diff', '--cached', '--quiet'], { allowFail: true });
  if (staged.status === 0) return false;
  git(gitDir, workTree, ['commit', '--quiet', '--no-verify', '-F', '-'], { input: message });
  return true;
}

function scanSecrets(gitDir, workTree) {
  const findings = [];
  const output = git(gitDir, workTree, ['diff', '--cached', '--name-only', '-z', '--diff-filter=AM']).stdout;
  for (const path of output.split('\0').filter(Boolean)) {
    if (BINARY_EXTENSIONS.test(path)) continue;
    let text;
    try {
      const buffer = readFileSync(join(workTree, path));
      if (buffer.length > 5 * 1024 * 1024 || buffer.includes(0)) continue;
      text = buffer.toString('utf8');
    } catch { continue; }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [label, pattern] of SECRET_PATTERNS) {
        if (pattern.test(line)) findings.push(`${path}:${index + 1}（${label}）`);
      }
    });
  }
  return findings;
}

function snapshotRemote(history, config, names) {
  const remote = config.remote;
  if (!remote) return;
  const gitDir = join(history, remote.gitDir);
  const workTree = config.workTree;
  const changes = readChanges(gitDir, workTree);
  if (changes.length) {
    git(gitDir, workTree, ['add', '-A']);
    const findings = scanSecrets(gitDir, workTree);
    if (findings.length) {
      git(gitDir, workTree, ['reset', '--quiet']);
      alert(history, `发现疑似密钥，这次没有提交到 GitHub 仓库（本地历史不受影响）：\n${findings.slice(0, 20).join('\n')}`);
      return;
    }
    const staged = git(gitDir, workTree, ['diff', '--cached', '--quiet'], { allowFail: true });
    if (staged.status !== 0) git(gitDir, workTree, ['commit', '--quiet', '--no-verify', '-F', '-'], { input: summarize(changes, names) });
  }
  if (!remote.url) return;
  const ahead = git(gitDir, null, ['rev-list', '--count', `origin/main..main`], { allowFail: true });
  if (ahead.status === 0 && ahead.stdout.trim() === '0') return;
  const pushed = git(gitDir, null, ['push', '--quiet', 'origin', 'main:main'], { allowFail: true, env: { GIT_TERMINAL_PROMPT: '0' } });
  if (pushed.status !== 0) {
    log(history, `推送失败（下次再试）：${(pushed.stderr || '').trim().slice(0, 300)}`);
    return;
  }
  log(history, '已推送到 GitHub');
}

function cmdInit(args) {
  if (typeof args['work-tree'] !== 'string' || typeof args.history !== 'string') throw new Error('用法：init --work-tree <记忆目录> --history <历史目录>');
  const workTree = resolve(args['work-tree']);
  const history = resolve(args.history);
  if (!existsSync(join(workTree, 'maps'))) throw new Error(`${workTree} 下没有 maps 目录，不像是记忆目录`);
  const relativeHistory = history.toLowerCase().startsWith(`${workTree.toLowerCase()}\\`) || history.toLowerCase() === workTree.toLowerCase();
  if (relativeHistory) throw new Error('历史目录不能放在记忆目录里面，否则会和记忆一起被删');
  mkdirSync(history, { recursive: true });
  const gitDir = join(history, 'memory.git');
  const created = initRepository(gitDir, workTree);
  const config = existsSync(join(history, CONFIG_FILE)) ? readConfig(history) : {};
  writeConfig(history, { ...config, version: 1, workTree, gitDir: 'memory.git' });
  copyFileSync(fileURLToPath(import.meta.url), join(history, 'memory-history.mjs'));
  process.stdout.write(`${created ? '已创建' : '已存在'}历史库：${gitDir}\n记忆目录：${workTree}\n脚本副本：${join(history, 'memory-history.mjs')}\n`);
}

function cmdSnapshot(args) {
  const history = historyDirectory(args);
  const config = readConfig(history);
  return withRunLock(history, () => {
    const workTree = config.workTree;
    if (!existsSync(join(workTree, 'maps')) || !readdirSync(join(workTree, 'maps')).some((id) => existsSync(join(workTree, 'maps', id, 'map.json')))) {
      alert(history, `记忆目录里找不到任何地图：${workTree}\n没有提交快照。请从历史库或夸克网盘恢复。`);
      return 2;
    }
    const gitDir = join(history, config.gitDir);
    const changes = readChanges(gitDir, workTree);
    if (!changes.length) {
      log(history, '没有变化');
      snapshotRemote(history, config, mapNames(workTree));
      return 0;
    }
    const guard = args['allow-delete'] ? '' : deletionGuard(gitDir, changes);
    if (guard) {
      alert(history, `${guard}，看起来像误删，这次没有提交。\n如果是你故意删的，运行：node "${join(history, 'memory-history.mjs')}" snapshot --allow-delete`);
      return 2;
    }
    const names = mapNames(workTree);
    const message = summarize(changes, names);
    if (commitAll(gitDir, workTree, message)) log(history, message.split('\n')[0]);
    snapshotRemote(history, config, names);
    return 0;
  });
}

function resolveTarget(gitDir, at) {
  if (!at || at === true) return git(gitDir, null, ['rev-parse', 'HEAD']).stdout.trim();
  const direct = git(gitDir, null, ['rev-parse', '--verify', '--quiet', `${at}^{commit}`], { allowFail: true });
  if (direct.status === 0) return direct.stdout.trim();
  const byTime = git(gitDir, null, ['rev-list', '-1', `--before=${at}`, 'HEAD'], { allowFail: true }).stdout.trim();
  if (!byTime) throw new Error(`找不到 ${at} 对应的快照`);
  return byTime;
}

function cmdRestore(args) {
  const history = historyDirectory(args);
  const config = readConfig(history);
  if (typeof args.to !== 'string' || !isAbsolute(args.to)) throw new Error('用法：restore --to <新目录的绝对路径> [--at <提交号或时间>]');
  const target = resolve(args.to);
  if (target.toLowerCase() === resolve(config.workTree).toLowerCase()) throw new Error('不能恢复到正在使用的记忆目录；先导出到新目录，核对后再替换');
  if (existsSync(target) && readdirSync(target).length) throw new Error(`目标目录不是空的：${target}`);
  const gitDir = join(history, config.gitDir);
  const commit = resolveTarget(gitDir, args.at);
  mkdirSync(target, { recursive: true });
  // 用临时索引导出，历史库自己的索引不动，下一次快照的删除判断才可靠。
  const indexFile = join(tmpdir(), `livedot-history-index-${process.pid}-${Date.now()}`);
  try {
    git(gitDir, null, ['read-tree', commit], { env: { GIT_INDEX_FILE: indexFile } });
    git(gitDir, target, ['checkout-index', '-a', '-f'], { env: { GIT_INDEX_FILE: indexFile } });
  } finally {
    rmSync(indexFile, { force: true });
  }
  const info = git(gitDir, null, ['log', '-1', '--format=%h %ad %s', '--date=format:%Y-%m-%d %H:%M', commit]).stdout.trim();
  process.stdout.write(`已导出快照 ${info}\n到：${target}\n核对无误后再关掉画布、用它替换 .live-dot-map。\n`);
}

function cmdLog(args) {
  const history = historyDirectory(args);
  const config = readConfig(history);
  const count = Number(args.n) || 20;
  process.stdout.write(git(join(history, config.gitDir), null, ['log', `-${count}`, '--format=%h  %ad  %s', '--date=format:%Y-%m-%d %H:%M']).stdout);
}

function cmdStatus(args) {
  const history = historyDirectory(args);
  const config = readConfig(history);
  const gitDir = join(history, config.gitDir);
  const changes = readChanges(gitDir, config.workTree);
  const last = git(gitDir, null, ['log', '-1', '--format=%h %ad', '--date=format:%Y-%m-%d %H:%M'], { allowFail: true }).stdout.trim();
  process.stdout.write(`记忆目录：${config.workTree}\n历史库：${gitDir}\n快照数：${git(gitDir, null, ['rev-list', '--count', 'HEAD'], { allowFail: true }).stdout.trim() || 0}\n最近快照：${last || '无'}\n未快照的变化：${changes.length} 个文件\n`);
  if (config.remote) {
    const remoteDir = join(history, config.remote.gitDir);
    const ahead = git(remoteDir, null, ['rev-list', '--count', 'origin/main..main'], { allowFail: true });
    process.stdout.write(`GitHub 仓库：${config.remote.url || '未设置'}\n排除的地图：${(config.remote.excludeMaps || []).join('、') || '无'}\n待推送：${ahead.status === 0 ? ahead.stdout.trim() : '尚未推送过'}\n`);
  }
}

function cmdRemoteInit(args) {
  const history = historyDirectory(args);
  const config = readConfig(history);
  const excludeMaps = (args['exclude-map'] || []).filter((id) => typeof id === 'string');
  const gitDir = join(history, 'github.git');
  initRepository(gitDir, config.workTree, ['# 不推到 GitHub 的地图', ...excludeMaps.map((id) => `maps/${id}/`)]);
  writeExcludes(gitDir, ['# 不推到 GitHub 的地图', ...excludeMaps.map((id) => `maps/${id}/`)]);
  const url = typeof args.url === 'string' ? args.url : '';
  if (url) {
    const existing = git(gitDir, null, ['remote', 'get-url', 'origin'], { allowFail: true });
    git(gitDir, null, existing.status === 0 ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  }
  writeConfig(history, { ...config, remote: { gitDir: 'github.git', url, excludeMaps } });
  process.stdout.write(`GitHub 用的仓库：${gitDir}\n地址：${url || '未设置'}\n排除的地图：${excludeMaps.join('、') || '无'}\n`);
}

function cmdInstallTask(args) {
  const history = historyDirectory(args);
  readConfig(history);
  const minutes = Number(args.minutes) || 15;
  const script = join(history, 'memory-history.mjs');
  const runner = join(history, 'run-snapshot.vbs');
  // wscript + 窗口参数 0：每 15 分钟跑一次也不会闪黑框。
  const quote = (value) => `""${value}""`;
  // wscript 读 UTF-8 会把中文路径读坏；UTF-16LE 带 BOM 它能正确识别。
  const body = `CreateObject("WScript.Shell").Run "${quote(process.execPath)} ${quote(script)} snapshot", 0, False\r\n`;
  writeFileSync(runner, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]));
  const created = spawnSync('schtasks.exe', ['/Create', '/F', '/TN', TASK_NAME, '/SC', 'MINUTE', '/MO', String(minutes), '/TR', `wscript.exe "${runner}"`], { encoding: 'utf8', windowsHide: true });
  if (created.status !== 0) throw new Error(`创建计划任务失败：${(created.stderr || created.stdout).trim()}`);
  process.stdout.write(`已创建计划任务「${TASK_NAME}」：每 ${minutes} 分钟快照一次\n`);
}

function cmdRemoveTask() {
  const removed = spawnSync('schtasks.exe', ['/Delete', '/F', '/TN', TASK_NAME], { encoding: 'utf8', windowsHide: true });
  process.stdout.write(removed.status === 0 ? `已删除计划任务「${TASK_NAME}」\n` : `${(removed.stderr || removed.stdout).trim()}\n`);
}

const HELP = `活点地图记忆历史库
  init --work-tree <记忆目录> --history <历史目录>   建历史库（历史目录必须在记忆目录之外）
  snapshot [--allow-delete]                        存一份快照；大量删除默认不提交并告警
  status                                           看状态
  log [--n 20]                                     看最近的快照
  restore --to <新目录> [--at <提交号|时间>]          导出某次快照到新目录（不覆盖正在用的记忆）
  remote-init --url <地址> [--exclude-map <地图id>]  配置推送到 GitHub 的仓库
  install-task [--minutes 15] / remove-task         定时快照
  --history <目录> 省略时取脚本所在目录
`;

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'init': return cmdInit(args);
    case 'snapshot': return cmdSnapshot(args);
    case 'status': return cmdStatus(args);
    case 'log': return cmdLog(args);
    case 'restore': return cmdRestore(args);
    case 'remote-init': return cmdRemoteInit(args);
    case 'install-task': return cmdInstallTask(args);
    case 'remove-task': return cmdRemoveTask(args);
    default: process.stdout.write(HELP); return 0;
  }
}

try {
  const code = main();
  if (typeof code === 'number') process.exitCode = code;
} catch (error) {
  const history = (() => { try { return historyDirectory(parseArgs(process.argv.slice(2)).args); } catch { return null; } })();
  if (history && existsSync(join(history, CONFIG_FILE))) log(history, `出错：${error?.message || error}`);
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
