type JsonMap = Record<string, unknown>;

declare global {
  interface Window {
    LiveDotApp?: {
      serialize(): JsonMap;
      load(document: JsonMap): void;
      setStatus(state: SyncState, detail?: string): void;
      refreshAgentStatus?(): Promise<JsonMap | null>;
    };
    LiveDotBridge?: BridgeClient;
  }
}

type SyncState = 'draft' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error' | 'fallback';

const COLLECTIONS = ['routes', 'nodes', 'edges', 'anns'] as const;
const META_FIELDS = new Set(['createdAt', 'updatedAt', 'updatedBy', 'updatedRevision']);

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function publicPatch(current: JsonMap, previous: JsonMap): JsonMap {
  const patch: JsonMap = {};
  for (const [key, value] of Object.entries(current)) {
    if (key === 'id' || META_FIELDS.has(key)) continue;
    if (!equal(value, previous[key])) patch[key] = value;
  }
  for (const key of Object.keys(previous)) {
    if (key === 'id' || META_FIELDS.has(key)) continue;
    if (!(key in current)) patch[key] = null;
  }
  return patch;
}

function diffDocument(previous: JsonMap, current: JsonMap): JsonMap[] {
  const commands: JsonMap[] = [];
  for (const collection of COLLECTIONS) {
    const oldItems = new Map(((previous[collection] as JsonMap[]) ?? []).map((item) => [String(item.id), item]));
    const newItems = new Map(((current[collection] as JsonMap[]) ?? []).map((item) => [String(item.id), item]));
    for (const [id, value] of newItems) {
      const old = oldItems.get(id);
      if (!old) commands.push({ op: 'create', collection, value });
      else {
        const patch = publicPatch(value, old);
        if (Object.keys(patch).length) commands.push({ op: 'update', collection, id, patch });
      }
    }
    for (const id of oldItems.keys()) if (!newItems.has(id)) commands.push({ op: 'delete', collection, id });
  }
  if (!equal(previous.view, current.view)) commands.push({ op: 'set_view', patch: current.view ?? {} });
  if (!equal(previous.ui, current.ui)) commands.push({ op: 'set_ui', patch: current.ui ?? {} });
  return commands;
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('live-dot-map-v2', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDraft(projectId: string, value: JsonMap | null): Promise<void> {
  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    value === null ? store.delete(projectId) : store.put({ value, savedAt: new Date().toISOString() }, projectId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export class BridgeClient {
  private origin = '';
  private csrf = '';
  private projectId = '';
  private sessionId = randomId('session');
  private revision = 0;
  private lastDocument: JsonMap | null = null;
  private pending: JsonMap | null = null;
  private timer = 0;
  private retry = 0;
  private inFlight = false;
  private dirty = false;
  private events?: EventSource;

  get active(): boolean { return Boolean(this.origin && this.csrf && this.lastDocument); }

  async initialize(): Promise<void> {
    if (!window.LiveDotApp) return;
    const url = new URL(location.href);
    const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
    const token = url.searchParams.get('token');
    const projectRoot = url.searchParams.get('project');
    if (!isLoopback || !token || !projectRoot) {
      window.LiveDotApp.setStatus('fallback', 'Agent 自动读取和并发保护未启用');
      return;
    }
    this.origin = url.origin;
    try {
      const session = await this.request('/api/v1/session', { method: 'POST', token });
      this.csrf = String(session.csrfToken ?? '');
      const opened = await this.request('/api/v1/projects/open', { method: 'POST', body: { projectRoot } });
      const openedSnapshot = opened.snapshot && typeof opened.snapshot === 'object' ? opened.snapshot as JsonMap : undefined;
      const document = (opened.document ?? opened.map ?? openedSnapshot?.document) as JsonMap;
      if (!document || Number(document.version) !== 2) throw new Error('本地桥没有返回可写的 v2 地图');
      this.projectId = String(opened.projectId ?? document.mapId);
      this.revision = Number(opened.revision ?? document.revision);
      this.lastDocument = structuredClone(document);
      window.LiveDotApp.load(document);
      window.LiveDotApp.setStatus('saved', `revision ${this.revision}`);
      void this.refreshAgentStatus();
      this.startEvents();
      history.replaceState(null, '', `${url.pathname}?project=${encodeURIComponent(projectRoot)}`);
    } catch (error) {
      window.LiveDotApp.setStatus('error', error instanceof Error ? error.message : '本地桥连接失败');
    }
  }

  async refreshAgentStatus(): Promise<JsonMap | null> {
    if (!this.active) return null;
    try {
      const result = await this.request('/api/v1/agents');
      const list = document.querySelector('#agent-status-list');
      if (list && Array.isArray(result.agents)) {
        const labels = (result.states && typeof result.states === 'object' ? result.states : {}) as JsonMap;
        list.textContent = '';
        for (const item of result.agents as JsonMap[]) {
          const row = document.createElement('div');
          row.className = 'agent-status';
          row.dataset.state = String(item.state ?? 'error');
          const dot = document.createElement('span'); dot.className = 'agent-dot';
          const name = document.createElement('span'); name.className = 'agent-name'; name.textContent = String(item.id ?? '未知 Agent');
          const state = document.createElement('span'); state.className = 'agent-state'; state.textContent = String(labels[String(item.state)] ?? item.state ?? '异常');
          row.append(dot, name, state); list.append(row);
        }
      }
      return result;
    } catch (error) {
      const list = document.querySelector('#agent-status-list');
      if (list) list.textContent = '暂时无法读取 Agent 状态';
      return null;
    }
  }

  schedule(document: JsonMap): void {
    if (!this.active) return;
    this.pending = structuredClone(document);
    this.dirty = true;
    void saveDraft(this.projectId, this.pending).catch(() => undefined);
    window.LiveDotApp?.setStatus('draft', '本地草稿');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 350);
  }

  async flush(): Promise<void> {
    if (!this.active || !this.pending || !this.lastDocument || this.inFlight) return;
    const current = this.pending;
    const commands = diffDocument(this.lastDocument, current);
    if (!commands.length) {
      this.pending = null;
      this.dirty = false;
      await saveDraft(this.projectId, null).catch(() => undefined);
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}`);
      return;
    }
    this.inFlight = true;
    window.LiveDotApp?.setStatus('saving', `${commands.length} 条修改`);
    try {
      const result = await this.request('/api/v1/commands', {
        method: 'POST',
        body: {
          projectId: this.projectId,
          baseRevision: this.revision,
          commandId: randomId('cmd'),
          actor: 'human',
          sessionId: this.sessionId,
          commands,
        },
      });
      const resultSnapshot = result.snapshot && typeof result.snapshot === 'object' ? result.snapshot as JsonMap : undefined;
      const document = (result.document ?? result.map ?? resultSnapshot?.document) as JsonMap;
      this.revision = Number(result.revision ?? document?.revision ?? this.revision + 1);
      this.lastDocument = document ? structuredClone(document) : { ...structuredClone(current), revision: this.revision, version: 2 };
      this.pending = null;
      this.dirty = false;
      this.retry = 0;
      await saveDraft(this.projectId, null).catch(() => undefined);
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}`);
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      if (status === 409) {
        window.LiveDotApp?.setStatus('conflict', error instanceof Error ? error.message : '发生并发冲突');
      } else {
        this.retry += 1;
        window.LiveDotApp?.setStatus(navigator.onLine ? 'error' : 'offline', error instanceof Error ? error.message : '保存失败');
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.flush(), Math.min(30_000, 500 * 2 ** this.retry));
      }
    } finally {
      this.inFlight = false;
    }
  }

  private startEvents(): void {
    this.events?.close();
    this.events = new EventSource(`${this.origin}/api/v1/events`, { withCredentials: true });
      this.events.addEventListener('revision', (event) => void this.onRevision(event as MessageEvent));
      this.events.addEventListener('commit', (event) => void this.onRevision(event as MessageEvent));
      this.events.addEventListener('command', (event) => void this.onRevision(event as MessageEvent));
    this.events.addEventListener('conflict', () => window.LiveDotApp?.setStatus('conflict', '检测到并发冲突'));
    this.events.onerror = () => {
      if (!this.dirty) window.LiveDotApp?.setStatus('offline', '事件连接已断开，正在重连');
    };
  }

  private async onRevision(event: MessageEvent): Promise<void> {
    let payload: JsonMap = {};
    try { payload = JSON.parse(String(event.data)); } catch { return; }
    if (String(payload.sessionId ?? '') === this.sessionId) return;
    const nextRevision = Number(payload.revision ?? 0);
    if (!nextRevision || nextRevision <= this.revision) return;
    if (this.dirty) {
      window.LiveDotApp?.setStatus('conflict', '外部修改与本地草稿同时存在');
      return;
    }
    try {
      const result = await this.request('/api/v1/snapshot');
      const document = (result.document ?? result.map) as JsonMap;
      if (!document) return;
      this.revision = Number(result.revision ?? document.revision);
      this.lastDocument = structuredClone(document);
      window.LiveDotApp?.load(document);
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}，已同步 Agent 修改`);
    } catch (error) {
      window.LiveDotApp?.setStatus('error', error instanceof Error ? error.message : '同步 Agent 修改失败');
    }
  }

  private async request(path: string, options: { method?: string; body?: JsonMap; token?: string } = {}): Promise<JsonMap> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = this.csrf;
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(`${this.origin}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const result = await response.json().catch(() => ({})) as JsonMap;
    if (!response.ok) {
      const detail = result.error as JsonMap | undefined;
      const error = Object.assign(new Error(String(detail?.message ?? `HTTP ${response.status}`)), { status: response.status, code: detail?.code, details: detail?.details });
      throw error;
    }
    return result;
  }
}

const client = new BridgeClient();
window.LiveDotBridge = client;
document.querySelector('#agent-status-refresh')?.addEventListener('click', () => void client.refreshAgentStatus());
window.addEventListener('beforeunload', (event) => {
  if (!client.active || !(client as unknown as { dirty: boolean }).dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
void client.initialize();
