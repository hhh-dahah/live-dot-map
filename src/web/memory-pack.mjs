import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

/**
 * 记忆包（.zip）打包 / 解包 / 校验。
 *
 * 设计红线（来自 n27 方案审阅）：
 * - 共享包只含 map.json + 资料包文件；WAL、.bridge/、.archive/ 一律不进包。
 * - 大附件（> MAX_PACK_ASSET_BYTES 的非 Markdown 文件）不压入包，
 *   改写为人类可读的 <name>.stub.md 占位，stub 不含本机绝对路径、不含云链接。
 * - 解包严格防御 Zip Slip：绝对路径、盘符、`..`、ADS、保留设备名一律拒绝。
 */

export const PACK_FORMAT = 'live-dot-map';
export const PACK_FORMAT_VERSION = '1.0.0';
export const MAX_PACK_ASSET_BYTES = 10 * 1024 * 1024;
export const STUB_SUFFIX = '.stub.md';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** 校验并规范化包内相对路径；非法路径直接抛错（Zip Slip 防线）。 */
export function normalizePackPath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('记忆包包含空路径条目');
  let value = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw new Error(`记忆包包含非法绝对路径：${raw}`);
  }
  if (value.includes(':')) throw new Error(`记忆包包含非法盘符/ADS 路径：${raw}`);
  const segments = value.split('/').filter((seg) => seg.length > 0);
  if (!segments.length) throw new Error('记忆包包含空路径条目');
  for (const segment of segments) {
    if (segment === '..' || segment === '.') throw new Error(`记忆包包含路径穿越条目：${raw}`);
    if (CONTROL_CHARS.test(segment)) throw new Error(`记忆包包含控制字符路径：${raw}`);
    if (/[. ]$/.test(segment)) throw new Error(`记忆包包含尾点/尾空格路径：${raw}`);
    if (WINDOWS_RESERVED.test(segment)) throw new Error(`记忆包包含系统保留名：${raw}`);
  }
  return segments.join('/');
}

/** 归档冷数据与桥内部文件不进共享包。 */
export function isExcludedFromPack(packPath) {
  const segments = packPath.split('/');
  return segments.includes('.archive') || segments.includes('.bridge');
}

export function isStubFileName(fileName) {
  return typeof fileName === 'string' && fileName.toLowerCase().endsWith(STUB_SUFFIX);
}

/** 大文件占位内容：人类可读的 Markdown，首行带机器可识别标记。 */
export function makeStubContent({ name, sizeBytes }) {
  const marker = JSON.stringify({ name, sizeBytes });
  return [
    `<!-- livedot-stub: ${marker} -->`,
    `# 占位：${name}`,
    '',
    `该文件未随记忆包导出（原始大小 ${(sizeBytes / 1024 / 1024).toFixed(1)} MB，超过随包上限）。`,
    '请向来源方索取原文件后，拖入本节点完成关联。',
    '',
  ].join('\n');
}

/** 读取 stub 标记；非 stub 文件返回 null。 */
export function parseStubContent(content) {
  if (typeof content !== 'string') return null;
  const match = content.match(/^<!-- livedot-stub: (\{.*\}) -->/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.name !== 'string' || !Number.isFinite(parsed.sizeBytes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function sha256Hex(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('当前环境不支持 SHA-256（crypto.subtle 不可用）');
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const toBytes = (data) => (data instanceof Uint8Array ? data : new Uint8Array(data));

/**
 * 打包记忆包。
 * @param {object} input.document 当前地图 v2 文档
 * @param {Array<{path:string, data:Uint8Array|ArrayBuffer}>} input.files
 *        资料包文件，path 形如 nodes/n1/index.md
 * @returns {Promise<{zip:Uint8Array, manifest:object}>}
 */
export async function buildMemoryPack({ document, files, now } = {}) {
  if (!document || typeof document !== 'object') throw new TypeError('打包需要地图文档');
  const entries = {};
  const manifestFiles = [];
  const manifestStubs = [];
  for (const file of Array.isArray(files) ? files : []) {
    const packPath = normalizePackPath(file.path);
    if (isExcludedFromPack(packPath)) continue;
    const isMarkdown = /\.md$/i.test(packPath);
    // stub 条目：调用方只提供大小不提供字节（大文件根本不读入内存）。
    if (!isMarkdown && file.stub === true) {
      const sizeBytes = Number(file.sizeBytes ?? 0);
      const name = packPath.split('/').pop();
      const stubPath = `${packPath}${STUB_SUFFIX}`;
      entries[stubPath] = strToU8(makeStubContent({ name, sizeBytes }));
      manifestStubs.push({ stubPath, originalPath: packPath, sizeBytes });
      continue;
    }
    const data = toBytes(file.data);
    // 调用方显式标记 forceInclude 的大文件（用户在导出对话框逐个勾选/全量打包）不再降级为 stub；
    // 未标记的超大文件仍按智能导出规则写占位，避免无意识的巨型包。
    if (!isMarkdown && data.byteLength > MAX_PACK_ASSET_BYTES && file.forceInclude !== true) {
      const name = packPath.split('/').pop();
      const stubPath = `${packPath}${STUB_SUFFIX}`;
      entries[stubPath] = strToU8(makeStubContent({ name, sizeBytes: data.byteLength }));
      manifestStubs.push({ stubPath, originalPath: packPath, sizeBytes: data.byteLength });
      continue;
    }
    entries[packPath] = data;
    manifestFiles.push({ path: packPath, sha256: await sha256Hex(data), sizeBytes: data.byteLength });
  }
  const nodeCount = Array.isArray(document.nodes) ? document.nodes.length : 0;
  const manifest = {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    mapName: String(document.name ?? '未命名地图'),
    exportedAt: new Date(now ?? Date.now()).toISOString(),
    nodeCount,
    files: manifestFiles,
    stubs: manifestStubs,
  };
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  entries['map.json'] = strToU8(JSON.stringify(document, null, 2));
  return { zip: zipSync(entries, { level: 6 }), manifest };
}

/** 嗅探一段字节是否为活点地图记忆包（含合法 manifest 的 zip）。 */
export function sniffMemoryPack(zipBytes) {
  let entries;
  try {
    entries = unzipSync(toBytes(zipBytes));
  } catch {
    return false;
  }
  return Object.keys(entries).some((name) => {
    if (!/(^|\/)manifest\.json$/i.test(name)) return false;
    try {
      return JSON.parse(strFromU8(entries[name])).format === PACK_FORMAT;
    } catch {
      return false;
    }
  });
}

/**
 * 解包并校验记忆包。
 * @returns {Promise<{manifest:object|null, document:object, files:Array<{path:string, data:Uint8Array}>}>}
 */
export async function parseMemoryPack(zipBytes) {
  let raw;
  try {
    raw = unzipSync(toBytes(zipBytes));
  } catch {
    throw new Error('文件不是有效的 zip 压缩包');
  }
  // Zip Slip 校验 + 归一化；目录条目（空数据 + 以 / 结尾）跳过。
  const entries = new Map();
  for (const [name, data] of Object.entries(raw)) {
    if (name.endsWith('/')) continue;
    const normalized = normalizePackPath(name);
    if (!entries.has(normalized)) entries.set(normalized, data);
  }
  // 兼容“多套了一层文件夹”的 zip：自动向内下探一层。
  let prefix = '';
  const has = (rel) => entries.has(prefix + rel);
  if (!has('manifest.json') && !has('map.json')) {
    const candidate = [...entries.keys()]
      .map((key) => key.split('/'))
      .filter((segs) => segs.length >= 2 && /^(manifest|map)\.json$/i.test(segs[segs.length - 1]))
      .map((segs) => segs.slice(0, -1).join('/') + '/')
      .find((dir) => entries.has(`${dir}manifest.json`) || entries.has(`${dir}map.json`));
    if (candidate) prefix = candidate;
  }
  if (!has('map.json')) throw new Error('记忆包缺少 map.json');

  let manifest = null;
  if (has('manifest.json')) {
    try {
      manifest = JSON.parse(strFromU8(entries.get(prefix + 'manifest.json')));
    } catch {
      throw new Error('记忆包 manifest.json 损坏');
    }
    if (manifest.format !== PACK_FORMAT) throw new Error('不是活点地图记忆包（format 不匹配）');
    // 逐文件完整性校验：manifest 登记过的文件必须存在且 hash 一致。
    for (const item of Array.isArray(manifest.files) ? manifest.files : []) {
      const rel = normalizePackPath(String(item.path ?? ''));
      const data = entries.get(prefix + rel);
      if (!data) throw new Error(`记忆包缺少登记文件：${rel}`);
      if ((await sha256Hex(data)) !== item.sha256) throw new Error(`记忆包文件校验失败：${rel}`);
    }
  }

  let document;
  try {
    document = JSON.parse(strFromU8(entries.get(prefix + 'map.json')));
  } catch {
    throw new Error('记忆包 map.json 损坏');
  }
  if (!document || typeof document !== 'object') throw new Error('记忆包 map.json 不是对象');

  const files = [];
  for (const [key, data] of entries) {
    if (prefix && !key.startsWith(prefix)) continue;
    const rel = prefix ? key.slice(prefix.length) : key;
    if (!/^(nodes|routes)\//.test(rel)) continue;
    files.push({ path: rel, data });
  }
  return { manifest, document, files };
}

export function installMemoryPackApi(target = globalThis) {
  const api = {
    PACK_FORMAT,
    PACK_FORMAT_VERSION,
    MAX_PACK_ASSET_BYTES,
    STUB_SUFFIX,
    normalizePackPath,
    isExcludedFromPack,
    isStubFileName,
    makeStubContent,
    parseStubContent,
    buildMemoryPack,
    sniffMemoryPack,
    parseMemoryPack,
  };
  target.LiveDotMemoryPack = api;
  return api;
}

if (typeof window !== 'undefined') installMemoryPackApi(window);
