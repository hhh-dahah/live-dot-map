import { createHash } from 'node:crypto';
import { readFile as nodeReadFile, stat as nodeStat, readdir as nodeReaddir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWriteFile, ensureDirectory, withFileLock } from './fs-utils.mjs';

/**
 * per-map md 卡片索引 —— 「节点记概要、后端包记详细信息、Agent 智能索引」的落地层。
 *
 * 卡片不存全文，只存「摘要 + 指纹」：
 *   { path, etag(内容sha256), mtimeMs, bytes, title, summary(前300字), ownerKind, ownerId, assets[], updatedAt }
 * 校验只用 lstat（mtime+size）做便宜指纹；不一致才 readFile 重读该文件刷新单卡。
 * 原子写 `.bridge/md-index.json`；fs 可注入（测试用它数全文读取次数）。
 */
const SUMMARIZED_WINDOW = 300;
const DEFAULT_INDEX_FILE = () => join('.live-dot-map', 'maps', '${mapKey}', '.bridge', 'md-index.json');

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function visibleSummary(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, SUMMARIZED_WINDOW);
}

function firstHeading(text) {
  const match = String(text ?? '').match(/^\s*#{1,6}\s+(.*?)\s*$/m);
  return match ? match[1].trim() : '';
}

export class MdIndex {
  /**
   * @param {{projectRoot:string, mapKey:string, fs?:object}} options
   * @param {object} options.fs 可注入 { readFile, stat, readdir }，测试用它计数全文读取。
   */
  constructor(options = {}) {
    if (!options?.projectRoot) throw new TypeError('MdIndex 需要 projectRoot');
    this.projectRoot = resolve(options.projectRoot);
    this.mapKey = String(options.mapKey ?? 'default');
    this.fs = options.fs ?? { readFile: nodeReadFile, stat: nodeStat, readdir: nodeReaddir };
    this.indexPath = join(
      this.projectRoot,
      '.live-dot-map', 'maps', this.mapKey, '.bridge', 'md-index.json',
    );
    this.lockPath = `${this.indexPath}.lock`;
    this.#cards = new Map();
    this.#dirty = false;
  }

  #cards;
  #dirty;
  #fromFile = false;

  async load() {
    this.#cards = new Map();
    this.#dirty = false;
    this.#fromFile = false;
    let text = '';
    try {
      text = await this.fs.readFile(this.indexPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return this;
      throw error;
    }
    this.#fromFile = true;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch { this.#fromFile = false; return this; } // 损坏索引降级为空，按需重建
    const map = parsed && typeof parsed === 'object' ? parsed.cards : null;
    if (map && typeof map === 'object') {
      for (const [path, card] of Object.entries(map)) {
        if (card && typeof card.path === 'string') this.#cards.set(path, card);
      }
    }
    return this;
  }

  /** 首次使用（无索引文件）时一次性全量建卡；之后增量。 */
  async ensureBuilt({ mapRoot }) {
    if (this.#fromFile) return this;
    await this.buildAll({ mapRoot });
    await this.persist();
    return this;
  }

  async persist() {
    if (!this.#dirty) return this;
    const payload = `${JSON.stringify({ schema: 1, mapKey: this.mapKey, cards: Object.fromEntries(this.#cards) }, null, 0)}\n`;
    await ensureDirectory(join(this.projectRoot, '.live-dot-map', 'maps', this.mapKey, '.bridge'));
    await atomicWriteFile(this.indexPath, payload);
    this.#dirty = false;
    return this;
  }

  /** 取一张卡；指纹对不上/缺失则重读该文件刷新。mapRoot 用于拼绝对路径。 */
  async getOrRefreshCard({ mapRoot, relativePath }) {
    const absolute = join(this.projectRoot, relativePath);
    let stat;
    try {
      stat = await this.fs.stat(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.#cards.delete(relativePath);
        this.#dirty = true;
        return null;
      }
      throw error;
    }
    const existing = this.#cards.get(relativePath);
    const fresh = !existing || existing.mtimeMs !== stat.mtimeMs || existing.bytes !== stat.size;
    if (!fresh) return existing;
    const content = await this.fs.readFile(absolute, 'utf8');
    const card = {
      path: relativePath,
      etag: digest(content),
      mtimeMs: stat.mtimeMs,
      bytes: stat.size,
      title: firstHeading(content) || '',
      summary: visibleSummary(content),
      ownerKind: typeof existing?.ownerKind === 'string' ? existing.ownerKind : inferOwnerKind(relativePath),
      ownerId: typeof existing?.ownerId === 'string' ? existing.ownerId : inferOwnerId(relativePath),
      assets: existing?.assets ?? [],
      updatedAt: stat.mtime?.toISOString?.() ?? new Date(stat.mtimeMs).toISOString(),
    };
    this.#cards.set(relativePath, card);
    this.#dirty = true;
    return card;
  }

  /** 按 owner 目录重扫全部 md + 资产清单，刷新该对象所有卡片。 */
  async refreshOwner({ mapRoot, ownerKind, ownerId }) {
    const directory = join(mapRoot, ownerKind, ownerId);
    let entries = [];
    try {
      entries = await this.fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const assets = entries
      .filter((entry) => !entry.isDirectory() && !/\.md$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const mdFiles = entries.filter((entry) => !entry.isDirectory() && /\.md$/i.test(entry.name));
    const ownerRelative = join('.live-dot-map', 'maps', this.mapKey, relativeOwner(ownerKind), ownerId).replace(/\\/g, '/');
    for (const entry of mdFiles) {
      const relativePath = `${ownerRelative}/${entry.name}`;
      try {
        const absolute = join(directory, entry.name);
        const stat = await this.fs.stat(absolute);
        const content = await this.fs.readFile(absolute, 'utf8');
        this.#cards.set(relativePath, {
          path: relativePath,
          etag: digest(content),
          mtimeMs: stat.mtimeMs,
          bytes: stat.size,
          title: firstHeading(content) || '',
          summary: visibleSummary(content),
          ownerKind: ownerKind === 'nodes' ? 'node' : 'route',
          ownerId,
          assets,
          updatedAt: stat.mtime?.toISOString?.() ?? new Date(stat.mtimeMs).toISOString(),
        });
      } catch { /* 单个坏文件跳过，指纹机制会兜底 */ }
    }
    this.#dirty = true;
  }

  /** 首次迁移：全量扫描当前地图所有 owner 目录建卡（只跑一次）。 */
  async buildAll({ mapRoot }) {
    for (const [directoryKind, ownerKind] of [['nodes', 'nodes'], ['routes', 'routes']]) {
      let owners = [];
      try {
        owners = await this.fs.readdir(join(mapRoot, directoryKind), { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      for (const owner of owners) {
        if (!owner.isDirectory() || owner.name.startsWith('.')) continue;
        await this.refreshOwner({ mapRoot, ownerKind, ownerId: owner.name });
      }
    }
  }

  has(path) {
    return this.#cards.has(path);
  }

  get(path) {
    return this.#cards.get(path);
  }

  entries() {
    return this.#cards.entries();
  }

  size() {
    return this.#cards.size;
  }

  /** 校验某张卡是否仍新鲜（只 lstat，不读内容）。返回 null 表示已失效。 */
  async isFresh(path, stat) {
    const card = this.#cards.get(path);
    if (!card) return false;
    return card.mtimeMs === stat.mtimeMs && card.bytes === stat.size;
  }

  async #withLock(operation) {
    await ensureDirectory(join(this.projectRoot, '.live-dot-map', 'maps', this.mapKey, '.bridge'));
    return withFileLock(this.lockPath, operation, { timeoutMs: 5_000, staleMs: 30_000 });
  }

  /** 供写路径调用：刷完立刻落盘（保存/建节点等关键动作后）。 */
  async refreshOwnerAndPersist(input) {
    await this.#withLock(async () => {
      await this.refreshOwner(input);
      await this.persist();
    });
  }

  /** 从相对路径推断 owner 并刷其卡片（保存 hook 用，路径形如 .live-dot-map/maps/<mapKey>/nodes|routes/<id>/<file>）。 */
  async refreshPathAndPersist({ relativePath }) {
    const parts = String(relativePath).replace(/\\/g, '/').split('/').filter(Boolean);
    const kindIndex = parts.findIndex((part) => part === 'nodes' || part === 'routes');
    if (kindIndex < 0 || kindIndex + 1 >= parts.length) return;
    const mapRoot = join(this.projectRoot, '.live-dot-map', 'maps', this.mapKey);
    await this.refreshOwnerAndPersist({ mapRoot, ownerKind: parts[kindIndex], ownerId: parts[kindIndex + 1] });
  }
}

function inferOwnerKind(relativePath) {
  const parts = relativePath.split('/');
  return parts.length >= 3 && parts[parts.length - 3] === 'routes' ? 'route' : 'node';
}

function inferOwnerId(relativePath) {
  const parts = relativePath.split('/');
  return parts.length >= 3 ? parts[parts.length - 2] : '';
}

function relativeOwner(ownerKind) {
  return ownerKind === 'routes' ? 'routes' : 'nodes';
}

export { DEFAULT_INDEX_FILE };
