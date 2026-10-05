// 确定性统计：只做计数/分位/分组对比，不做预测与显著性。结果必须小到能直接进 Agent 上下文。
import { BridgeError } from './errors.mjs';

const MIN_GROUP = 5;
const MAX_ROWS_OUT = 20;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell, index) => cell.trim() || `列${index + 1}`);
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ''])));
}

function flatten(value, prefix = '', out = {}) {
  for (const [key, inner] of Object.entries(value ?? {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) flatten(inner, name, out);
    else out[name] = Array.isArray(inner) ? inner.join('|') : inner;
  }
  return out;
}

/** 按扩展名解析表格：.csv / .jsonl / .json（数组）。 */
export function parseDataset(text, fileName = '') {
  const lower = String(fileName).toLowerCase();
  const body = String(text ?? '');
  if (lower.endsWith('.csv')) return parseCsv(body);
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) {
    return body.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try { return flatten(JSON.parse(line)); } catch { throw new BridgeError('DATASET_PARSE_FAILED', `第 ${index + 1} 行不是合法 JSON`, { status: 422 }); }
    });
  }
  if (lower.endsWith('.json')) {
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new BridgeError('DATASET_PARSE_FAILED', 'JSON 解析失败', { status: 422 }); }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : null;
    if (!list) throw new BridgeError('DATASET_PARSE_FAILED', 'JSON 数据集必须是对象数组或 {rows:[...]}', { status: 422 });
    return list.map((item) => flatten(item));
  }
  throw new BridgeError('DATASET_TYPE_UNSUPPORTED', '数据集只支持 .csv / .jsonl / .json', { status: 415 });
}

/** “1.2万”“3,400”“5亿”都按数值处理；其余返回 null。 */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/,/g, '');
  if (!text) return null;
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*(万|w|W|亿|k|K)?$/);
  if (!match) return null;
  const unit = { 万: 1e4, w: 1e4, W: 1e4, 亿: 1e8, k: 1e3, K: 1e3 }[match[2]] ?? 1;
  return Number(match[1]) * unit;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const round = (value) => (value === null || value === undefined ? null : Math.round(value * 100) / 100);

function numericValues(rows, field) {
  return rows.map((row) => toNumber(row[field])).filter((value) => value !== null);
}

function fieldTypes(rows) {
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return fields.map((field) => {
    const present = rows.map((row) => row[field]).filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
    const numeric = present.filter((value) => toNumber(value) !== null).length;
    return { field, type: present.length && numeric / present.length >= 0.8 ? 'num' : 'cat', present: present.length };
  });
}

function aggregate(values, agg) {
  if (agg === 'count') return values.length;
  if (!values.length) return null;
  if (agg === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (agg === 'mean') return values.reduce((sum, value) => sum + value, 0) / values.length;
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function requireField(rows, field, label) {
  if (typeof field !== 'string' || !field) throw new BridgeError('ANALYSIS_PARAM_REQUIRED', `缺少 params.${label}`, { status: 400 });
  if (!rows.some((row) => field in row)) {
    const fields = fieldTypes(rows).map((item) => item.field).slice(0, 30).join('、');
    throw new BridgeError('ANALYSIS_FIELD_NOT_FOUND', `字段「${field}」不存在。可用字段：${fields}`, { status: 422 });
  }
  return field;
}

function describe(rows) {
  const fields = fieldTypes(rows).map(({ field, type, present }) => {
    const missing = rows.length - present;
    if (type === 'num') {
      const sorted = numericValues(rows, field).sort((a, b) => a - b);
      return { field, type, missing, min: round(sorted[0]), q1: round(quantile(sorted, 0.25)), median: round(quantile(sorted, 0.5)), q3: round(quantile(sorted, 0.75)), max: round(sorted.at(-1)) };
    }
    const counts = new Map();
    for (const row of rows) {
      const key = String(row[field] ?? '').trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, n]) => `${value}:${n}`);
    return { field, type, missing, distinct: counts.size, top };
  });
  const numeric = fields.filter((item) => item.type === 'num').map((item) => `${item.field} 中位 ${item.median}`).slice(0, 3);
  return { result: fields.slice(0, 40), summary: `${rows.length} 行 ${fields.length} 个字段${numeric.length ? `；${numeric.join('，')}` : ''}` };
}

function group(rows, params) {
  const by = (Array.isArray(params.by) ? params.by : [params.by]).filter(Boolean).slice(0, 2);
  if (!by.length) throw new BridgeError('ANALYSIS_PARAM_REQUIRED', '缺少 params.by（分组字段，最多 2 个）', { status: 400 });
  for (const field of by) requireField(rows, field, 'by');
  const metric = params.metric ? requireField(rows, params.metric, 'metric') : null;
  const agg = metric ? (['median', 'mean', 'sum', 'count'].includes(params.agg) ? params.agg : 'median') : 'count';
  const buckets = new Map();
  for (const row of rows) {
    const key = by.map((field) => String(row[field] ?? '').trim() || '(空)').join(' × ');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const groups = [...buckets.entries()].map(([key, members]) => {
    const values = metric ? numericValues(members, metric) : [];
    const value = metric ? aggregate(values, agg) : members.length;
    return { key, n: members.length, value: round(value), ...(members.length < MIN_GROUP ? { flag: '样本不足' } : {}) };
  });
  // 样本不足的组不参与排序，排在后面。
  groups.sort((a, b) => Number(Boolean(a.flag)) - Number(Boolean(b.flag)) || (b.value ?? -Infinity) - (a.value ?? -Infinity));
  const best = groups.find((item) => !item.flag);
  const summary = best
    ? `按 ${by.join('×')} 分 ${groups.length} 组${metric ? `，${metric} ${agg}` : ''}最高：${best.key}（n=${best.n}${metric ? `，${best.value}` : ''}）`
    : `按 ${by.join('×')} 分 ${groups.length} 组，每组都少于 ${MIN_GROUP} 条，样本不足`;
  return { result: groups.slice(0, MAX_ROWS_OUT), summary, ...(groups.length > MAX_ROWS_OUT ? { truncated: groups.length } : {}) };
}

function top(rows, params) {
  const metric = requireField(rows, params.metric, 'metric');
  const ratio = Number(params.ratio) > 0 && Number(params.ratio) < 1 ? Number(params.ratio) : 0.2;
  const scored = rows.map((row) => ({ row, value: toNumber(row[metric]) })).filter((item) => item.value !== null).sort((a, b) => b.value - a.value);
  if (scored.length < 2) throw new BridgeError('ANALYSIS_TOO_FEW_ROWS', `指标「${metric}」有效数值不足 2 条`, { status: 422 });
  const cut = Math.max(1, Math.round(scored.length * ratio));
  const head = scored.slice(0, cut).map((item) => item.row);
  const rest = scored.slice(cut).map((item) => item.row);
  const wanted = Array.isArray(params.fields) && params.fields.length ? params.fields.map(String) : null;
  const types = fieldTypes(rows).filter((item) => item.field !== metric && (!wanted || wanted.includes(item.field)));
  const diffs = [];
  for (const { field, type } of types) {
    if (type === 'num') {
      const headMedian = aggregate(numericValues(head, field), 'median');
      const restMedian = aggregate(numericValues(rest, field), 'median');
      if (headMedian !== null && restMedian !== null && headMedian !== restMedian) diffs.push({ field, kind: 'num', top: round(headMedian), rest: round(restMedian), gap: Math.abs(headMedian - restMedian) / (Math.abs(restMedian) || 1) });
      continue;
    }
    const values = new Set(rows.map((row) => String(row[field] ?? '').trim()).filter(Boolean));
    if (values.size > 30) continue;
    for (const value of values) {
      const headShare = head.filter((row) => String(row[field] ?? '').trim() === value).length / head.length;
      const restShare = rest.length ? rest.filter((row) => String(row[field] ?? '').trim() === value).length / rest.length : 0;
      if (headShare !== restShare) diffs.push({ field, kind: 'cat', value, top: round(headShare), rest: round(restShare), gap: Math.abs(headShare - restShare) });
    }
  }
  diffs.sort((a, b) => b.gap - a.gap);
  const result = diffs.slice(0, 10).map(({ gap: _gap, ...item }) => item);
  const lead = result[0];
  const leadText = lead ? (lead.kind === 'cat' ? `${lead.field}=${lead.value} 占比 前组 ${lead.top} / 其余 ${lead.rest}` : `${lead.field} 中位 前组 ${lead.top} / 其余 ${lead.rest}`) : '无明显差异字段';
  return {
    result,
    summary: `${metric} 前 ${Math.round(ratio * 100)}%（n=${head.length}）对比其余（n=${rest.length}）：${leadText}${head.length < MIN_GROUP ? '；前组样本不足' : ''}`,
    groups: { top: head.length, rest: rest.length },
  };
}

export const ANALYSIS_OPS = Object.freeze(['describe', 'group', 'top']);

export function runAnalysis(rows, op, params = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new BridgeError('DATASET_EMPTY', '数据集为空或没有表头', { status: 422 });
  const options = params && typeof params === 'object' ? params : {};
  if (op === 'describe') return { rows: rows.length, op, ...describe(rows) };
  if (op === 'group') return { rows: rows.length, op, ...group(rows, options) };
  if (op === 'top') return { rows: rows.length, op, ...top(rows, options) };
  throw new BridgeError('ANALYSIS_OP_UNKNOWN', `未知 op「${op}」，可用：${ANALYSIS_OPS.join(' | ')}`, { status: 400 });
}
