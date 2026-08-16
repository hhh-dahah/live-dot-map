import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// 运行日志：桥、画布（经 /logs/client 转发）、Agent 的 MCP/hook 进程写同一个
// 按天滚动的 JSON 行文件，人为审查或 Agent 定位联动问题时只需读一条时间线。
// 原则：日志绝不阻断主流程——任何写失败都被吞掉；测试用 LIVEDOT_LOG_DIR 隔离。
const KEEP_DAYS = 14;
const MAX_STRING = 1000;

export function logDirectory() {
  return process.env.LIVEDOT_LOG_DIR || join(homedir(), '.live-dot-map', 'logs');
}

function clean(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      ...(value.code ? { code: String(value.code) } : {}),
      message: String(value.message || '').slice(0, MAX_STRING),
      stack: String(value.stack || '').split('\n').slice(0, 6).join('\n'),
    };
  }
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return depth >= 2 ? `[${value.length} 项]` : value.slice(0, 20).map((item) => clean(item, depth + 1));
  if (typeof value === 'object') {
    if (depth >= 2) return '[嵌套对象]';
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = clean(item, depth + 1);
    return output;
  }
  return String(value);
}

export function createLogger({ source = 'bridge', dir, clock = () => new Date() } = {}) {
  const root = dir || logDirectory();
  let chain = Promise.resolve();
  let prepared = false;

  async function prepare() {
    await mkdir(root, { recursive: true });
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    const entries = await readdir(root).catch(() => []);
    for (const entry of entries) {
      const match = /^livedot-(\d{4}-\d{2}-\d{2})\.log$/.exec(entry);
      if (match && Date.parse(`${match[1]}T00:00:00Z`) < cutoff) {
        await rm(join(root, entry), { force: true }).catch(() => undefined);
      }
    }
  }

  function write(level, event, fields = {}, entrySource = source) {
    const at = clock();
    const entry = { at: at.toISOString(), level, source: entrySource, event: String(event).slice(0, 120), ...clean(fields) };
    const file = join(root, `livedot-${at.toISOString().slice(0, 10)}.log`);
    chain = chain.then(async () => {
      if (!prepared) { prepared = true; await prepare(); }
      await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
    }).catch(() => undefined);
    return chain;
  }

  const api = {
    dir: root,
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    flush: () => chain,
    // 派生同文件同队列的子来源（如 client），保证多来源写在一条时间线上。
    as: (childSource) => ({
      dir: root,
      info: (event, fields) => write('info', event, fields, childSource),
      warn: (event, fields) => write('warn', event, fields, childSource),
      error: (event, fields) => write('error', event, fields, childSource),
      flush: () => chain,
      as: api.as,
    }),
  };
  return api;
}

// 测试与不传 logger 的调用方使用：不碰磁盘。
export const noopLogger = {
  dir: null,
  info: () => Promise.resolve(),
  warn: () => Promise.resolve(),
  error: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  as: () => noopLogger,
};
