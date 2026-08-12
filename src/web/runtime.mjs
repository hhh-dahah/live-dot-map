import {
  SYNC_MODES,
  SYNC_STATUS,
  canonicalizeMarkdownFields,
  normalizeLegacyMap,
  stableHash,
  stableMarkdownPath,
  validateForDraft,
} from './shared.mjs';
import { createSyncController } from './sync.mjs';
import { EdgeSpatialIndex, ParallelIndex, buildEdgeIndex, cullPoints, visibleWorldBounds } from './scene-index.mjs';

const STATUS_LABEL = Object.freeze({
  [SYNC_STATUS.IDLE]: '待同步',
  [SYNC_STATUS.DRAFT]: '本地草稿',
  [SYNC_STATUS.DIRTY]: '有未同步改动',
  [SYNC_STATUS.SAVING]: '同步中',
  [SYNC_STATUS.SYNCED]: '已同步',
  [SYNC_STATUS.CONFLICT]: '存在冲突',
  [SYNC_STATUS.ERROR]: '同步错误',
  [SYNC_STATUS.DEGRADED]: '降级模式',
  [SYNC_STATUS.CLOSED]: '已关闭',
});

const MODE_LABEL = Object.freeze({
  [SYNC_MODES.BRIDGE]: '桥接',
  [SYNC_MODES.FILESYSTEM]: '文件夹',
  [SYNC_MODES.DRAFT]: '草稿',
  [SYNC_MODES.EXPORT]: '导出',
});

function getGlobal(name) {
  try { return globalThis[name]; } catch { return undefined; }
}

function makeBadge(document) {
  if (!document?.createElement) return null;
  const existing = document.querySelector?.('[data-dotmap-sync]');
  if (existing) return existing;
  const badge = document.createElement('span');
  badge.dataset.dotmapSync = 'true';
  badge.setAttribute('role', 'status');
  badge.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:14px', 'z-index:80', 'display:inline-flex',
    'align-items:center', 'gap:6px', 'padding:5px 9px', 'border:1px solid rgba(70,64,58,.18)',
    'border-radius:999px', 'background:rgba(255,253,248,.92)', 'color:#5b554e',
    'font:12px/1.2 system-ui,sans-serif', 'box-shadow:0 2px 12px rgba(50,40,30,.08)',
    'pointer-events:none',
  ].join(';');
  const dot = document.createElement('i');
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = 'width:7px;height:7px;border-radius:50%;background:#a59b91;display:inline-block;flex:none';
  const text = document.createElement('span');
  badge.append(dot, text);
  const mount = document.body ?? document.documentElement;
  mount?.appendChild(badge);
  badge._dot = dot;
  badge._text = text;
  return badge;
}

function updateBadge(badge, state) {
  if (!badge) return;
  const status = state?.status ?? SYNC_STATUS.IDLE;
  const mode = state?.mode ?? SYNC_MODES.DRAFT;
  const label = `${MODE_LABEL[mode] ?? mode} · ${STATUS_LABEL[status] ?? status}`;
  if (badge._text) badge._text.textContent = label;
  else badge.textContent = label;
  const colors = {
    [SYNC_STATUS.SYNCED]: '#4f8d65',
    [SYNC_STATUS.SAVING]: '#b48528',
    [SYNC_STATUS.DIRTY]: '#b48528',
    [SYNC_STATUS.CONFLICT]: '#b64a45',
    [SYNC_STATUS.ERROR]: '#b64a45',
    [SYNC_STATUS.DEGRADED]: '#8e6d29',
  };
  if (badge._dot) badge._dot.style.background = colors[status] ?? '#a59b91';
  badge.title = state?.error?.message ? String(state.error.message).slice(0, 240) : label;
}

function parseBridgeUrl(options = {}) {
  if (options.bridgeUrl) return String(options.bridgeUrl);
  try {
    const value = new URL(globalThis.location?.href ?? '').searchParams.get('bridge');
    if (!value) return null;
    const url = new URL(value, globalThis.location?.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch { return null; }
}

function scheduleWithRaf(callback) {
  const raf = getGlobal('requestAnimationFrame');
  if (typeof raf === 'function') return raf(callback);
  return setTimeout(callback, 16);
}

function wrapGlobal(name, wrapper) {
  const original = getGlobal(name);
  if (typeof original !== 'function' || original.__dotmapV2Wrapped) return null;
  const wrapped = wrapper(original);
  if (typeof wrapped !== 'function') return null;
  Object.defineProperty(wrapped, '__dotmapV2Wrapped', { value: true });
  Object.defineProperty(wrapped, '__dotmapV2Original', { value: original });
  try { globalThis[name] = wrapped; } catch { return null; }
  return wrapped;
}

function readSerializedState() {
  const serializer = getGlobal('serialize');
  if (typeof serializer !== 'function') return null;
  try {
    const value = serializer();
    if (typeof value === 'string') return JSON.parse(value);
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function installRenderScheduler(options = {}) {
  if (options.coalesceRender === false) return null;
  let pending = false;
  let args = [];
  return wrapGlobal('render', (original) => function renderScheduled(...nextArgs) {
    args = nextArgs;
    if (pending) return undefined;
    pending = true;
    scheduleWithRaf(() => {
      pending = false;
      const callArgs = args;
      args = [];
      original.apply(this, callArgs);
    });
    return undefined;
  });
}

function installErrorReporting(sync, badge) {
  const target = globalThis;
  if (!target?.addEventListener) return () => {};
  const onError = (event) => {
    const message = event?.error?.message ?? event?.message ?? '页面脚本发生错误';
    sync.markError(new Error(String(message).slice(0, 240)));
    updateBadge(badge, sync.state);
  };
  const onRejection = (event) => {
    const reason = event?.reason;
    const message = reason?.message ?? reason ?? '异步操作失败';
    sync.markError(new Error(String(message).slice(0, 240)));
    updateBadge(badge, sync.state);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener?.('error', onError);
    target.removeEventListener?.('unhandledrejection', onRejection);
  };
}

export function installWebRuntime(options = {}) {
  if (globalThis.__DOTMAP_V2?.version === 2) return globalThis.__DOTMAP_V2;
  const bridgeUrl = parseBridgeUrl(options);
  const sync = createSyncController({
    ...options,
    bridgeUrl,
    eventSourceFactory: options.eventSourceFactory,
    hasFileSystemAccess: options.hasFileSystemAccess ?? ('showDirectoryPicker' in globalThis),
  });
  const document = getGlobal('document');
  const badge = options.badge === false || globalThis.LiveDotBridge ? null : makeBadge(document);
  updateBadge(badge, sync.state);
  const timers = new Set();
  let closed = false;
  let draftTimer = null;
  const scheduleDraft = () => {
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      const current = readSerializedState();
      if (!current) return;
      try {
        const canonical = canonicalizeMarkdownFields(current);
        const validated = validateForDraft(canonical);
        sync.saveDraft(canonical, {
          sourceVersion: canonical.version,
          migrated: validated.document?.version !== canonical.version,
          valid: validated.ok,
          hash: stableHash(canonical),
        });
      } catch (error) {
        sync.markError(error);
      }
      updateBadge(badge, sync.state);
    }, Math.max(80, Number(options.draftDebounceMs) || 320));
    timers.add(draftTimer);
  };
  const markDirty = (reason) => { sync.markDirty(reason); scheduleDraft(); updateBadge(badge, sync.state); };

  // 老画布仍使用 v1 serialize；这里仅在边界层规范 Markdown 路径，不改其内存结构。
  wrapGlobal('serialize', (original) => function serializeCanonical(...args) {
    const value = original.apply(this, args);
    if (!value || typeof value !== 'object') return value;
    return canonicalizeMarkdownFields(value);
  });
  for (const name of ['pushHistory', 'undo', 'redo', 'addNodeAt', 'addEdge', 'addAnnotation']) {
    wrapGlobal(name, (original) => function stateChangingAction(...args) {
      const result = original.apply(this, args);
      markDirty(name);
      return result;
    });
  }
  wrapGlobal('deserialize', (original) => function deserializeWithBaseline(...args) {
    const result = original.apply(this, args);
    const input = args[0];
    if (input && typeof input === 'object') sync.setBaseline(input, Number.isInteger(input.revision) ? input.revision : 0);
    sync.clearDraft();
    sync.markSaved();
    updateBadge(badge, sync.state);
    return result;
  });
  wrapGlobal('writeMapNow', (original) => async function writeMapWithStatus(...args) {
    sync.markSaving();
    updateBadge(badge, sync.state);
    try {
      const result = await original.apply(this, args);
      sync.markSaved({ mode: SYNC_MODES.FILESYSTEM });
      updateBadge(badge, sync.state);
      return result;
    } catch (error) {
      sync.markError(error);
      updateBadge(badge, sync.state);
      throw error;
    }
  });
  wrapGlobal('exportMap', (original) => function exportWithStatus(...args) {
    const result = original.apply(this, args);
    sync.markSaved({ mode: SYNC_MODES.EXPORT });
    updateBadge(badge, sync.state);
    return result;
  });
  installRenderScheduler(options);

  sync.on('status', () => updateBadge(badge, sync.state));
  sync.on('error', () => updateBadge(badge, sync.state));
  sync.on('conflict', () => updateBadge(badge, sync.state));
  sync.installCloseWarning(globalThis);
  const removeErrorReporting = installErrorReporting(sync, badge);
  if (document?.addEventListener) document.addEventListener('dotmap:state-changed', (event) => markDirty(event?.detail?.reason ?? 'event'));

  // 明确配置 bridge 才连接；没有 bridge 时不产生网络请求，自动降级为 FSA/草稿。
  if (bridgeUrl) {
    sync.connectBridge({ url: bridgeUrl });
    updateBadge(badge, sync.state);
  }
  const current = readSerializedState();
  if (current) sync.setBaseline(current, Number.isInteger(current.revision) ? current.revision : 0);

  // 撤销/重做与普通编辑一样必须走同一条草稿/桥接提交路径。
  // 旧画布没有公开 undo/redo 函数时，运行时只监听到按钮点击，导致
  // 内存已经恢复但刷新后又回到撤销前版本；这里把动作包裹为可持久化操作。

  const api = {
    version: 2,
    sync,
    badge,
    captureState: readSerializedState,
    scheduleDraft,
    normalizeMap: normalizeLegacyMap,
    canonicalizeMarkdownFields,
    stableMarkdownPath,
    stableHash,
    createParallelIndex: (edges) => new ParallelIndex(edges),
    createEdgeIndex: buildEdgeIndex,
    EdgeSpatialIndex,
    visibleWorldBounds,
    cullPoints,
    close() {
      if (closed) return;
      closed = true;
      if (draftTimer !== null) clearTimeout(draftTimer);
      for (const timer of timers) clearTimeout(timer);
      removeErrorReporting();
      sync.close();
      updateBadge(badge, sync.state);
    },
  };
  globalThis.__DOTMAP_V2 = api;
  return api;
}

// 构建产物在普通浏览器中直接执行；测试/嵌入场景可以显式传 options。
if (typeof globalThis.document !== 'undefined') installWebRuntime();
