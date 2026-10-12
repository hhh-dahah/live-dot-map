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
export async function buildMemoryPack({ document, files, now, scope } = {}) {
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
    ...(scope ? { scope } : {}),
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

/* ---------- 节点包：导出单个节点或节点及下游，导入时并入当前地图 ---------- */

const live = (item) => item && item.archived !== true;

/**
 * 选出要导出的对象。下游 = 沿连线 from→to 能走到的节点。
 * 连线只收两端都在范围内的，以及从范围内节点伸出的悬空方案线（to 为 null）。
 */
export function collectNodeScope(document, rootId, { downstream = false } = {}) {
  const nodes = (document?.nodes ?? []).filter(live);
  const edges = (document?.edges ?? []).filter(live);
  const nodeIds = new Set();
  if (!nodes.some((node) => node.id === rootId)) throw new Error(`找不到节点 ${rootId}`);
  nodeIds.add(rootId);
  if (downstream) {
    const known = new Set(nodes.map((node) => node.id));
    const queue = [rootId];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of edges) {
        if (edge.from !== current || edge.to === null || edge.to === undefined) continue;
        if (!known.has(edge.to) || nodeIds.has(edge.to)) continue;
        nodeIds.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  const edgeIds = new Set(edges
    .filter((edge) => nodeIds.has(edge.from) && (edge.to === null || edge.to === undefined || nodeIds.has(edge.to)))
    .map((edge) => edge.id));
  const annIds = new Set((document?.anns ?? []).filter(live).filter((ann) => (
    (ann.target?.kind === 'node' && nodeIds.has(ann.target.id)) || (ann.target?.kind === 'edge' && edgeIds.has(ann.target.id))
  )).map((ann) => ann.id));
  return { rootId, downstream, nodeIds, edgeIds, annIds };
}

/** 按范围裁出一份仍能通过 v2 校验的地图文档（只带被引用到的路线）。 */
export function extractScopeDocument(document, scope) {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const nodes = copy((document.nodes ?? []).filter((node) => scope.nodeIds.has(node.id)));
  const edges = copy((document.edges ?? []).filter((edge) => scope.edgeIds.has(edge.id)));
  const anns = copy((document.anns ?? []).filter((ann) => scope.annIds.has(ann.id)));
  const routeIds = new Set([...nodes, ...edges].map((item) => item.route).filter(Boolean));
  const routes = copy((document.routes ?? []).filter((route) => routeIds.has(route.id))).map((route) => {
    if (route.currentNodeId && !scope.nodeIds.has(route.currentNodeId)) delete route.currentNodeId;
    return route;
  });
  const root = nodes.find((node) => node.id === scope.rootId);
  return { ...copy(document), name: String(root?.name || document.name || '节点'), nodes, edges, anns, routes };
}

/** 包内文件属于哪个对象：nodes/<节点id>/…，routes/<连线id>/…（连线资料包放在 routes 目录下）。 */
export function packFileOwner(path) {
  const segments = String(path).split('/');
  if (segments.length < 3 || !segments[1]) return null;
  if (segments[0] === 'nodes') return { kind: 'node', id: segments[1], fileName: segments.slice(2).join('/') };
  if (segments[0] === 'routes') return { kind: 'route', id: segments[1], fileName: segments.slice(2).join('/') };
  return null;
}

/**
 * 把包里的节点、连线、标注重新编号后并入目标地图。
 * 两台电脑上的编号都是各自从 1 往上数的，原样并入一定撞号，所以一律换新号，
 * 并同步改写连线两端、标注目标和资料包路径。
 * @param counters 目标地图当前的 { nextNum, nextEdge, nextAnn }
 * @param routeIds 目标地图已有的路线 id；包里引用的路线若不存在就清空
 * @param anchor 根节点要放到的世界坐标；不给则保持原坐标
 */
export function remapNodePack(document, { counters, routeIds = [], anchor = null, rootId = null } = {}) {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const existingRoutes = new Set(routeIds);
  let nextNum = Math.max(1, Number(counters?.nextNum) || 1);
  let nextEdge = Math.max(1, Number(counters?.nextEdge) || 1);
  let nextAnn = Math.max(1, Number(counters?.nextAnn) || 1);
  const sourceNodes = (document?.nodes ?? []).filter(live);
  if (!sourceNodes.length) throw new Error('包里没有可导入的节点');
  const root = sourceNodes.find((node) => node.id === rootId) ?? sourceNodes[0];
  const shiftX = anchor && Number.isFinite(root.x) ? anchor.x - root.x : 0;
  const shiftY = anchor && Number.isFinite(root.y) ? anchor.y - root.y : 0;
  const scrub = (item) => {
    for (const key of ['md', 'archived', 'archivedAt', 'archivedBy', 'archiveReason']) delete item[key];
    if (item.route && !existingRoutes.has(item.route)) item.route = null;
    return item;
  };

  const nodeMap = new Map();
  const nodes = sourceNodes.map((source) => {
    const node = scrub(copy(source));
    node.id = `n${nextNum}`;
    node.num = String(nextNum).padStart(2, '0');
    nextNum += 1;
    if (Number.isFinite(node.x)) node.x += shiftX;
    if (Number.isFinite(node.y)) node.y += shiftY;
    nodeMap.set(source.id, node.id);
    return node;
  });

  const edgeMap = new Map();
  const edges = [];
  for (const source of (document?.edges ?? []).filter(live)) {
    const from = nodeMap.get(source.from);
    const dangling = source.to === null || source.to === undefined;
    const to = dangling ? null : nodeMap.get(source.to);
    // 指向包外节点的连线没有落点，悬空方案线又缺偏移量，只能丢掉。
    if (!from || (!dangling && !to)) continue;
    const edge = scrub(copy(source));
    edge.id = `e${nextEdge}`;
    nextEdge += 1;
    edge.from = from;
    edge.to = to;
    edgeMap.set(source.id, edge.id);
    edges.push(edge);
  }

  const anns = [];
  for (const source of (document?.anns ?? []).filter(live)) {
    const kind = source.target?.kind;
    const targetId = kind === 'node' ? nodeMap.get(source.target.id) : kind === 'edge' ? edgeMap.get(source.target.id) : null;
    if (!targetId) continue;
    const ann = copy(source);
    ann.id = `a${nextAnn}`;
    nextAnn += 1;
    ann.target = { ...ann.target, id: targetId };
    anns.push(ann);
  }

  const renamePath = (path) => {
    const owner = packFileOwner(path);
    if (!owner) return null;
    const id = owner.kind === 'node' ? nodeMap.get(owner.id) : edgeMap.get(owner.id);
    return id ? `${owner.kind === 'node' ? 'nodes' : 'routes'}/${id}/${owner.fileName}` : null;
  };

  return {
    nodes, edges, anns,
    rootId: nodeMap.get(root.id),
    nodeMap, edgeMap,
    counters: { nextNum, nextEdge, nextAnn },
    renamePath,
  };
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
    collectNodeScope,
    extractScopeDocument,
    packFileOwner,
    remapNodePack,
  };
  target.LiveDotMemoryPack = api;
  return api;
}

if (typeof window !== 'undefined') installMemoryPackApi(window);
