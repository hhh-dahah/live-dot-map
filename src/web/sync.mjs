import { SYNC_MODES, SYNC_STATUS, stableHash, stableStringify } from './shared.mjs';

const noop = () => {};

function safeStorage(storage) {
  const memory = new Map();
  const candidate = storage ?? globalThis.localStorage;
  return {
    get(key) {
      try { return candidate?.getItem?.(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; }
    },
    set(key, value) {
      memory.set(key, value);
      try { candidate?.setItem?.(key, value); } catch { /* 隐私模式/配额不足时保留内存草稿 */ }
    },
    remove(key) {
      memory.delete(key);
      try { candidate?.removeItem?.(key); } catch { /* noop */ }
    },
  };
}

export function createDraftStore(options = {}) {
  const key = `${options.namespace ?? 'live-dot-map'}:${options.key ?? 'draft'}`;
  const store = safeStorage(options.storage);
  return {
    key,
    load() {
      const value = store.get(key);
      if (!value) return null;
      try { return JSON.parse(value); } catch { store.remove(key); return null; }
    },
    save(document, metadata = {}) {
      const record = {
        schema: 1,
        savedAt: new Date().toISOString(),
        hash: stableHash(document),
        metadata: { ...metadata },
        document,
      };
      store.set(key, stableStringify(record));
      return record;
    },
    clear() { store.remove(key); },
  };
}

function responseError(response, body) {
  const message = body && typeof body.message === 'string' ? body.message : `请求失败 (${response.status})`;
  const error = new Error(message.slice(0, 240));
  error.status = response.status;
  error.code = typeof body?.code === 'string' ? body.code : 'HTTP_ERROR';
  error.details = body?.details;
  return error;
}

export function createCommandsClient(options = {}) {
  const baseUrl = String(options.baseUrl ?? '').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15_000);
  const endpoint = options.endpoint ?? '/api/map/commands';
  if (!fetchImpl) return { send: async () => { throw new Error('当前浏览器没有 fetch，桥接不可用'); } };
  return {
    async send(envelope, requestOptions = {}) {
      const controller = new AbortController();
      const externalSignal = requestOptions.signal;
      const timer = setTimeout(() => controller.abort('timeout'), requestOptions.timeoutMs ?? timeoutMs);
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort(externalSignal.reason);
        else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
      }
      try {
        const response = await fetchImpl(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(envelope),
          signal: controller.signal,
          credentials: requestOptions.credentials ?? 'same-origin',
        });
        let body = null;
        try { body = await response.json(); } catch { /* 空响应也可由状态码判断 */ }
        if (!response.ok) throw responseError(response, body);
        return body ?? { ok: true };
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) {
          const timeout = new Error('桥接请求超时');
          timeout.code = 'BRIDGE_TIMEOUT';
          timeout.cause = error;
          throw timeout;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createSseClient(options = {}) {
  const EventSourceImpl = options.eventSourceFactory ?? globalThis.EventSource;
  const url = options.url;
  let source = null;
  let closed = false;
  let retryTimer = null;
  let lastEventId = options.lastEventId ?? null;
  const onCommand = options.onCommand ?? noop;
  const onError = options.onError ?? noop;
  const retryMs = Math.max(500, Number(options.retryMs) || 3000);

  const connect = () => {
    if (closed || !url || !EventSourceImpl) return null;
    try {
      const separator = String(url).includes('?') ? '&' : '?';
      const sourceUrl = lastEventId === null ? String(url) : `${url}${separator}lastEventId=${encodeURIComponent(lastEventId)}`;
      source = new EventSourceImpl(sourceUrl, options.eventSourceOptions);
      source.onmessage = (event) => {
        if (event?.lastEventId) lastEventId = event.lastEventId;
        try { onCommand(typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data); }
        catch (error) { onError(Object.assign(new Error('桥接事件格式无效'), { code: 'INVALID_SSE_EVENT', cause: error })); }
      };
      source.onerror = (error) => {
        onError(Object.assign(new Error('桥接连接中断'), { code: 'SSE_ERROR', cause: error }));
        if (!closed && retryTimer === null) retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
      };
      return source;
    } catch (error) {
      onError(Object.assign(new Error('无法建立桥接连接'), { code: 'SSE_CONNECT_ERROR', cause: error }));
      return null;
    }
  };
  return {
    connect,
    close() {
      closed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      source?.close?.();
      source = null;
    },
    get connected() { return Boolean(source); },
    get lastEventId() { return lastEventId; },
  };
}

function detectMode(options) {
  if (options.mode) return options.mode;
  if (options.bridgeUrl && typeof (options.eventSourceFactory ?? globalThis.EventSource) === 'function') return SYNC_MODES.BRIDGE;
  if (options.hasFileSystemAccess ?? ('showDirectoryPicker' in globalThis)) return SYNC_MODES.FILESYSTEM;
  return SYNC_MODES.DRAFT;
}

export function createSyncController(options = {}) {
  const listeners = new Map();
  const draft = options.draftStore ?? createDraftStore({ key: options.draftKey ?? 'map' });
  const mode = detectMode(options);
  const state = {
    mode,
    status: mode === SYNC_MODES.DRAFT ? SYNC_STATUS.DRAFT : SYNC_STATUS.IDLE,
    dirty: false,
    revision: Number.isInteger(options.revision) ? options.revision : 0,
    baselineHash: options.baselineHash ?? null,
    error: null,
    conflict: null,
  };
  let closed = false;
  let bridge = null;
  let commands = null;
  const emit = (event, payload) => {
    for (const listener of listeners.get(event) ?? []) {
      try { listener(payload, { ...state }); } catch { /* 观察者不应阻断同步 */ }
    }
  };
  const setState = (patch, event = 'status') => {
    Object.assign(state, patch);
    emit(event, { ...state });
  };
  const on = (event, listener) => {
    const bucket = listeners.get(event) ?? new Set();
    bucket.add(listener);
    listeners.set(event, bucket);
    return () => bucket.delete(listener);
  };
  const markDirty = (reason = 'edit') => {
    if (closed) return;
    setState({ dirty: true, status: SYNC_STATUS.DIRTY, error: null }, 'status');
    emit('dirty', { reason });
  };
  const markSaving = () => setState({ status: SYNC_STATUS.SAVING, error: null }, 'status');
  const markSaved = (metadata = {}) => setState({ dirty: false, status: SYNC_STATUS.SYNCED, error: null, conflict: null, ...metadata }, 'status');
  const markError = (error, metadata = {}) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    setState({ status: SYNC_STATUS.ERROR, error: normalized, ...metadata }, 'error');
    emit('status', { ...state });
  };
  const markConflict = (details = {}) => {
    setState({ status: SYNC_STATUS.CONFLICT, dirty: true, conflict: { ...details } }, 'conflict');
  };
  const saveDraft = (document, metadata = {}) => {
    const record = draft.save(document, { mode, ...metadata });
    setState({ status: state.dirty ? SYNC_STATUS.DIRTY : SYNC_STATUS.DRAFT }, 'status');
    emit('draft', record);
    return record;
  };
  const loadDraft = () => draft.load();
  const clearDraft = () => { draft.clear(); emit('draft-cleared'); };
  const setBaseline = (documentOrHash, revision) => {
    const hash = typeof documentOrHash === 'string' ? documentOrHash : stableHash(documentOrHash);
    setState({ baselineHash: hash, revision: Number.isInteger(revision) ? revision : state.revision }, 'status');
    return hash;
  };
  const assertBase = (base = {}) => {
    const revisionMismatch = Number.isInteger(base.revision) && Number.isInteger(state.revision) && base.revision !== state.revision;
    const hashMismatch = Boolean(base.hash && state.baselineHash && base.hash !== state.baselineHash);
    if (revisionMismatch || hashMismatch) {
      markConflict({ expectedRevision: state.revision, receivedRevision: base.revision, expectedHash: state.baselineHash, receivedHash: base.hash });
      return false;
    }
    return true;
  };
  const connectBridge = (bridgeOptions = {}) => {
    if (!bridgeOptions.url && !options.bridgeUrl) return false;
    if (!(bridgeOptions.eventSourceFactory ?? options.eventSourceFactory ?? globalThis.EventSource)) {
      setState({ mode: SYNC_MODES.DRAFT, status: SYNC_STATUS.DEGRADED }, 'status');
      return false;
    }
    bridge?.close?.();
    bridge = createSseClient({
      url: bridgeOptions.url ?? options.bridgeUrl,
      eventSourceFactory: bridgeOptions.eventSourceFactory ?? options.eventSourceFactory,
      onCommand: (event) => emit('command', event),
      onError: (error) => markError(error, { status: SYNC_STATUS.DEGRADED }),
      retryMs: bridgeOptions.retryMs ?? options.retryMs,
    });
    bridge.connect();
    commands = createCommandsClient({ baseUrl: bridgeOptions.baseUrl ?? options.bridgeUrl, fetchImpl: bridgeOptions.fetchImpl ?? options.fetchImpl });
    setState({ mode: SYNC_MODES.BRIDGE, status: SYNC_STATUS.IDLE }, 'status');
    return true;
  };
  const sendCommand = async (envelope) => {
    if (!commands) throw new Error('尚未连接桥接服务');
    if (!assertBase({ revision: envelope?.baseRevision })) throw Object.assign(new Error('地图已发生冲突，请先刷新'), { code: 'CONFLICT' });
    markSaving();
    try {
      const result = await commands.send(envelope);
      setState({ revision: Number.isInteger(result?.revision) ? result.revision : state.revision }, 'status');
      markSaved();
      return result;
    } catch (error) {
      if (error?.status === 409 || error?.code === 'CONFLICT') markConflict({ error });
      else markError(error);
      throw error;
    }
  };
  const installCloseWarning = (target = globalThis) => {
    if (!target?.addEventListener) return noop;
    const handler = (event) => {
      if (!state.dirty && state.status !== SYNC_STATUS.CONFLICT) return undefined;
      event.preventDefault();
      event.returnValue = '还有未同步的地图改动';
      return event.returnValue;
    };
    target.addEventListener('beforeunload', handler);
    return () => target.removeEventListener?.('beforeunload', handler);
  };
  const close = () => {
    closed = true;
    bridge?.close?.();
    bridge = null;
    setState({ status: SYNC_STATUS.CLOSED }, 'status');
  };
  return {
    get state() { return { ...state }; },
    get mode() { return state.mode; },
    on,
    markDirty,
    markSaving,
    markSaved,
    markError,
    markConflict,
    saveDraft,
    loadDraft,
    clearDraft,
    setBaseline,
    assertBase,
    connectBridge,
    sendCommand,
    installCloseWarning,
    close,
  };
}

