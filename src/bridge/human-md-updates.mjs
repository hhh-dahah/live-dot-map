import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { appendDurable, atomicWriteFile, ensureDirectory, withFileLock } from './fs-utils.mjs';

const DEFAULT_MAX_LOG_BYTES = 512 * 1024;

/**
 * 人类 Markdown 写入的「未确认」信号日志（per-map）。
 *
 * 追加式 NDJSON，崩溃安全，不进 map.json、不污染画布：
 *   {"t":"u","path":".live-dot-map/...","etag":"...","mtime":"...","snippet":"...","ts":"..."}
 *   {"t":"a","path":".live-dot-map/...","ts":"..."}
 * 读取时按 path 重放，取每个 path 的最后一条 t：u = 未确认，a = 已确认。
 * 日志超过 maxBytes 时 compact 只保留仍处于未确认状态的 u 行。
 */
export class HumanMdUpdateLog {
  constructor(options = {}) {
    if (!options?.projectRoot) throw new TypeError('HumanMdUpdateLog 需要 projectRoot');
    this.projectRoot = resolve(options.projectRoot);
    this.mapKey = String(options.mapKey ?? 'default');
    this.maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_LOG_BYTES;
    this.logPath = join(this.projectRoot, '.live-dot-map', 'maps', this.mapKey, '.bridge', 'human-md-updates.ndjson');
    this.lockPath = `${this.logPath}.lock`;
  }

  async record({ path, etag, mtime, snippet }) {
    const line = JSON.stringify({
      t: 'u',
      path: String(path || ''),
      etag: String(etag || ''),
      mtime: String(mtime || ''),
      snippet: String(snippet || '').replace(/\s+/g, ' ').slice(0, 160),
      ts: new Date().toISOString(),
    });
    return this.#withLock(async () => {
      await appendDurable(this.logPath, line);
      await this.#compactIfNeeded();
    });
  }

  async acknowledge(paths) {
    const list = [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))];
    if (!list.length) return { acknowledged: [] };
    const ts = new Date().toISOString();
    await this.#withLock(async () => {
      for (const path of list) await appendDurable(this.logPath, JSON.stringify({ t: 'a', path, ts }));
    });
    return { acknowledged: list };
  }

  /** 未确认的人类 md 写入，按 mtime 倒序。 */
  async unacknowledged() {
    const states = await this.#replay();
    return [...states.values()]
      .filter((state) => state.t === 'u' && state.path)
      .map((state) => ({
        id: `md:${state.path}`,
        path: state.path,
        etag: String(state.etag ?? ''),
        mtime: String(state.mtime ?? ''),
        snippet: String(state.snippet ?? ''),
        attention: 'new',
      }))
      .sort((left, right) => String(right.mtime).localeCompare(String(left.mtime)));
  }

  async #replay() {
    const states = new Map();
    let text = '';
    try {
      text = await readFile(this.logPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return states;
      throw error;
    }
    for (const line of text.split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      let entry;
      try { entry = JSON.parse(raw); } catch { continue; } // 损坏行尽力跳过，不阻塞重放
      if (entry?.t === 'u' && typeof entry.path === 'string' && entry.path) {
        states.set(entry.path, entry);
      } else if (entry?.t === 'a' && typeof entry.path === 'string' && entry.path) {
        const previous = states.get(entry.path);
        states.set(entry.path, previous && previous.t === 'u' ? { ...previous, t: 'a' } : { t: 'a', path: entry.path });
      }
    }
    return states;
  }

  async #withLock(operation) {
    await ensureDirectory(join(this.projectRoot, '.live-dot-map', 'maps', this.mapKey, '.bridge'));
    return withFileLock(this.lockPath, operation, { timeoutMs: 5_000, staleMs: 30_000 });
  }

  async #compactIfNeeded() {
    let size = 0;
    try { size = (await stat(this.logPath)).size; } catch { return; }
    if (size <= this.maxBytes) return;
    const states = await this.#replay();
    const pending = [...states.values()].filter((state) => state.t === 'u');
    await atomicWriteFile(this.logPath, pending.length ? `${pending.map((state) => JSON.stringify(state)).join('\n')}\n` : '');
  }
}
