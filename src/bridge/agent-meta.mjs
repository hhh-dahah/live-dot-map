// Agent元数据.md：每个资料包一份，存 Agent 读懂后的一句摘要和各文件说明，只用于导航。
// 格式由程序渲染，Agent 只交内容；人可直接改这个文件，改过/删过的行由程序识别并保护。
// 识别依据是程序上次写出的版本（存在 .bridge/agent-meta/），与当前文件逐行比对。
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const META_FILE = 'Agent元数据.md';
export const META_LABELS = Object.freeze(['原话', '推断', '人']);
const HEADER = ['# Agent元数据', '> Agent 维护，人可修改；人改过的行标「人」，Agent 不再改动。'];
const FILES_HEADING = '## 文件';
const VERSION_LENGTH = 6;

export const isMetaFile = (name) => String(name ?? '').split('/').pop() === META_FILE;
export const contentVersion = (value) => createHash('sha256').update(value ?? '').digest('hex').slice(0, VERSION_LENGTH);
/** index.md 去掉系统登记区段后的版本：系统自动改的资料包清单不算正文变化，不让摘要误报过期。 */
export const bodyVersion = (text) => contentVersion(withoutSystemBlocks(text).replace(/\r\n/g, '\n').trimEnd());

export function oneLine(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').replace(/[（）]/g, (char) => (char === '（' ? '(' : ')')).trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function stripMarkdownLine(raw) {
  return String(raw ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+>]|\d+\.)\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

/** index.md 第一段正文（跳过标题、图片、HTML、系统登记区段），作为没有元数据摘要时的兜底。 */
export function markdownLead(text, max = 40) {
  for (const raw of withoutSystemBlocks(text).split(/\r?\n/)) {
    if (/^\s*#{1,6}\s/.test(raw)) continue;
    const line = stripMarkdownLine(raw);
    if (!line || /^[-=|:\s]+$/.test(line)) continue;
    return oneLine(line, max);
  }
  return '';
}

function withoutSystemBlocks(text) {
  return String(text ?? '').replace(/<!--\s*@author:\s*system:[^>]*-->[\s\S]*?<!--\s*\/@author\s*-->/gi, '');
}

// ---- 解析 / 渲染 ----

function parseTail(tail) {
  if (tail === undefined) return { label: '人' };
  const parts = tail.split('·').map((part) => part.trim()).filter(Boolean);
  const label = META_LABELS.includes(parts[0]) ? parts[0] : null;
  if (!label) return { label: '人' };
  const version = parts.map((part) => part.match(/@([0-9a-f]{4,})$/i)?.[1]).find(Boolean);
  if (label === '人') return { label, date: parts[1] && !parts[1].startsWith('@') ? parts[1] : '', ...(version ? { ver: version.toLowerCase() } : {}) };
  return { label, by: parts[1] ?? '', date: parts[2] ?? '', ...(version ? { ver: version.toLowerCase() } : {}) };
}

const SUMMARY_LINE = /^摘要[：:]\s*(.*?)\s*(?:（([^（）]*)）)?\s*$/;
const FILE_LINE = /^[-*]\s+(.+?)[：:]\s*(.*?)\s*(?:（([^（）]*)）)?\s*$/;

/**
 * 返回 { summary, files: Map<name, entry>, extras: string[], lines: Map<key, raw> }。
 * 末尾没有可识别标记的行一律算人写的。
 */
export function parseMeta(text) {
  const result = { summary: null, files: new Map(), extras: [], lines: new Map() };
  if (typeof text !== 'string') return result;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || HEADER.includes(line) || line === FILES_HEADING) continue;
    const summary = line.match(SUMMARY_LINE);
    if (summary && !result.summary) {
      result.summary = { text: summary[1], ...parseTail(summary[2]) };
      result.lines.set('summary', line);
      continue;
    }
    const file = line.match(FILE_LINE);
    if (file && !result.files.has(file[1].trim())) {
      const name = file[1].trim();
      result.files.set(name, { name, text: file[2], ...parseTail(file[3]) });
      result.lines.set(`file:${name}`, line);
      continue;
    }
    result.extras.push(line);
  }
  return result;
}

function tailOf(entry, versionPrefix) {
  if (entry.label === '人') return `（${['人', entry.date, entry.ver ? `${versionPrefix}@${entry.ver}` : ''].filter(Boolean).join(' · ')}）`;
  return `（${[entry.label, entry.by, entry.date, entry.ver ? `${versionPrefix}@${entry.ver}` : ''].filter(Boolean).join(' · ')}）`;
}

export function renderMeta(model) {
  const out = [...HEADER, ''];
  if (model.summary) out.push(`摘要：${model.summary.text}${tailOf(model.summary, 'index.md')}`, '');
  if (model.files.size) {
    out.push(FILES_HEADING);
    for (const entry of model.files.values()) out.push(`- ${entry.name}：${entry.text}${tailOf(entry, '')}`);
    out.push('');
  }
  if (model.extras.length) out.push(...model.extras, '');
  return `${out.join('\n').trimEnd()}\n`;
}

// ---- 上次写出的版本（判断人改/人删的依据） ----

export function metaStatePath(mapRoot, ownerDirKind, ownerId) {
  return join(mapRoot, '.bridge', 'agent-meta', `${ownerDirKind}-${ownerId}.json`);
}

export async function readMetaState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return {
      written: typeof parsed.written === 'string' ? parsed.written : null,
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted.map(String) : [],
    };
  } catch {
    return { written: null, deleted: [] };
  }
}

export async function writeMetaState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, written: state.written, deleted: state.deleted })}\n`, 'utf8');
  await rename(temporary, path);
}

/**
 * 把当前文件与程序上次写出的版本对比：
 * - 当前有、上次没有（或内容不同）的条目 → 人写/人改，标「人」；
 * - 上次有、当前没有的条目 → 人删，记进 deleted，之后 Agent 不再补写。
 * 从未由程序写过（无 state）而文件已存在时，整份都算人写的。
 */
export function reconcile(currentText, state, now = new Date()) {
  const current = parseMeta(currentText);
  const written = state.written === null ? null : parseMeta(state.written);
  const deleted = new Set(state.deleted);
  const ownLines = new Set(written ? written.lines.values() : []);
  const markHuman = (entry, key) => {
    if (entry.label !== '人' && !ownLines.has(current.lines.get(key))) return { name: entry.name, text: entry.text, label: '人', date: todayLabel(now), ...(entry.ver ? { ver: entry.ver } : {}) };
    return entry;
  };
  if (current.summary) current.summary = markHuman(current.summary, 'summary');
  for (const [name, entry] of current.files) current.files.set(name, markHuman(entry, `file:${name}`));
  if (written) {
    if (written.summary && !current.summary) deleted.add('summary');
    for (const name of written.files.keys()) if (!current.files.has(name)) deleted.add(`file:${name}`);
  }
  return { model: current, deleted };
}

/** 画布/工具改名后同步元数据与状态里的文件名，避免改名被误判成人删了一行。 */
export function renameMetaText(text, from, to) {
  if (typeof text !== 'string') return text;
  return text.split(/\r?\n/).map((raw) => {
    const match = raw.trim().match(FILE_LINE);
    if (!match || match[1].trim() !== from) return raw;
    return raw.replace(`${from}：`, `${to}：`).replace(`${from}:`, `${to}:`);
  }).join('\n');
}

export async function syncMetaRename({ mapRoot, ownerDirKind, ownerId, directory, from, to, writeText }) {
  if (from === to || isMetaFile(from)) return;
  const metaPath = join(directory, META_FILE);
  const statePath = metaStatePath(mapRoot, ownerDirKind, ownerId);
  const text = await readFile(metaPath, 'utf8').catch(() => null);
  const state = await readMetaState(statePath);
  if (text !== null) {
    const next = renameMetaText(text, from, to);
    if (next !== text) await writeText(metaPath, next);
  }
  if (state.written !== null || state.deleted.length) {
    await writeMetaState(statePath, {
      written: state.written === null ? null : renameMetaText(state.written, from, to),
      deleted: state.deleted.map((key) => (key === `file:${from}` ? `file:${to}` : key)),
    });
  }
}

// ---- 视图 ----

/** md 里引用某文件的那一行原文（事实，不猜意思）；同一行没字就取相邻行。 */
export function referenceLines(markdownTexts, names) {
  const found = new Map();
  const wanted = new Set(names);
  for (const text of markdownTexts) {
    const lines = withoutSystemBlocks(text).split(/\r?\n/);
    lines.forEach((raw, index) => {
      for (const name of wanted) {
        if (found.has(name)) continue;
        if (!raw.includes(name) && !raw.includes(encodeURI(name))) continue;
        let line = stripMarkdownLine(raw.split(name).join(' '));
        // 图片独占一行时，说明一般写在紧邻的上下文里：就近找两行内的非空正文。
        for (const offset of [-1, 1, -2, 2]) {
          if (line) break;
          const neighbour = lines[index + offset];
          if (neighbour !== undefined && !/^\s*#{1,6}\s/.test(neighbour) && !/!\[[^\]]*\]\(/.test(neighbour)) line = stripMarkdownLine(neighbour);
        }
        if (line) found.set(name, oneLine(line, 40));
      }
    });
  }
  return found;
}

/**
 * 合成当前可见的元数据：标出过期、文件已不存在；资源管理器里改名（内容哈希相同）自动接到新文件名。
 * files: [{name, ver}]，indexVer: index.md 的 bodyVersion。
 */
export function metaView(model, { files = [], indexVer = '' } = {}) {
  const present = new Map(files.map((file) => [file.name, file]));
  const summary = model.summary
    ? { ...model.summary, stale: model.summary.label !== '人' && Boolean(model.summary.ver) && model.summary.ver !== indexVer }
    : null;
  const byName = new Map();
  const orphans = [];
  for (const entry of model.files.values()) {
    if (present.has(entry.name)) byName.set(entry.name, entry);
    else orphans.push(entry);
  }
  const unclaimed = files.filter((file) => !byName.has(file.name));
  const missing = [];
  for (const entry of orphans) {
    const match = entry.ver ? unclaimed.find((file) => file.ver === entry.ver && !byName.has(file.name)) : null;
    if (match) byName.set(match.name, { ...entry, name: match.name, renamedFrom: entry.name });
    else missing.push({ ...entry, missing: true });
  }
  for (const [name, entry] of byName) {
    const file = present.get(name);
    byName.set(name, { ...entry, stale: entry.label !== '人' && Boolean(entry.ver) && entry.ver !== file.ver });
  }
  return { summary, files: byName, missing };
}

export function describeEntry(entry) {
  if (!entry) return '';
  const flags = [entry.label === '推断' ? '推断' : '', entry.stale ? '过期' : ''].filter(Boolean);
  return `${entry.text}${flags.length ? `（${flags.join('，')}）` : ''}`;
}

export function todayLabel(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
