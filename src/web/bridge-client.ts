type JsonMap = Record<string, unknown>;

declare global {
  interface Window {
    LiveDotApp?: {
      serialize(): JsonMap;
      load(document: JsonMap): void;
      setStatus(state: SyncState, detail?: string): void;
      flashObjects?(ids: string[]): void;
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
  if (!equal(previous.name, current.name) && typeof current.name === 'string') {
    // Top-level map metadata is persisted through the same authenticated
    // command reducer as object edits. The shared reducer exposes this
    // narrow operation (only `name` is accepted), avoiding direct JSON rewrite.
    commands.push({ op: 'set_meta', patch: { name: current.name } });
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
  private checkpoint: JsonMap | null = null;
  private logQueue: JsonMap[] = [];
  private logTimer = 0;
  /** Agent 最近一次写回（来自桥端 agent-health 记录），供状态点 tooltip 展示。 */
  lastAgentActivity: { at: string; name: string } | null = null;

  /** 操作日志：缓冲后批量发给桥写入运行日志（与桥、Agent 同一文件）；桥未连接时只留 console。 */
  log(event: string, fields: JsonMap = {}, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.origin || !this.csrf) { console.debug('[live-dot-map]', event, fields); return; }
    this.logQueue.push({ at: new Date().toISOString(), level, event, ...fields });
    if (this.logQueue.length > 50) this.logQueue.splice(0, this.logQueue.length - 50);
    clearTimeout(this.logTimer);
    this.logTimer = window.setTimeout(() => void this.flushLogs(), level === 'error' ? 0 : 1500);
  }

  private async flushLogs(): Promise<void> {
    if (!this.origin || !this.csrf || !this.logQueue.length) return;
    const entries = this.logQueue.splice(0, 50);
    try {
      await fetch(`${this.origin}/api/v1/logs/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify({ entries }),
      });
    } catch { /* 日志失败直接丢弃，绝不阻断画布使用 */ }
    if (this.logQueue.length) {
      clearTimeout(this.logTimer);
      this.logTimer = window.setTimeout(() => void this.flushLogs(), 1500);
    }
  }

  private logError(event: string, error: unknown, fields: JsonMap = {}): void {
    const value = error as { message?: unknown; code?: unknown; status?: unknown };
    this.log(event, {
      ...fields,
      message: error instanceof Error ? error.message : String(error),
      ...(value?.code ? { code: String(value.code) } : {}),
      ...(value?.status ? { status: Number(value.status) } : {}),
    }, 'error');
  }

  get active(): boolean { return Boolean(this.origin && this.csrf && this.lastDocument); }
  get latestCheckpoint(): JsonMap | null { return this.checkpoint ? structuredClone(this.checkpoint) : null; }

  async initialize(): Promise<void> {
    if (!window.LiveDotApp) return;
    const url = new URL(location.href);
    const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
    const token = url.searchParams.get('token');
    const projectRoot = url.searchParams.get('project') || sessionStorage.getItem('live-dot-map-project');
    if (!isLoopback || !projectRoot) {
      window.LiveDotApp.setStatus('fallback', 'Agent 自动读取和并发保护未启用');
      return;
    }
    this.origin = url.origin;
    try {
      // The bootstrap token is intentionally one-use and is removed from the
      // address bar after the first load. Refreshes resume the HttpOnly-cookie
      // session instead of incorrectly falling back to browser-only mode.
      const session = token
        ? await this.request('/api/v1/session', { method: 'POST', token })
        : await this.request('/api/v1/session', { method: 'GET' });
      this.csrf = String(session.csrfToken ?? '');
      const resumedRoot = String(session.projectRoot ?? '');
      const opened = resumedRoot
        ? await this.request('/api/v1/snapshot')
        : await this.request('/api/v1/projects/open', { method: 'POST', body: { projectRoot } });
      const openedSnapshot = opened.snapshot && typeof opened.snapshot === 'object' ? opened.snapshot as JsonMap : undefined;
      const document = (opened.document ?? opened.map ?? openedSnapshot?.document) as JsonMap;
      if (!document || Number(document.version) !== 2) throw new Error('本地桥没有返回可写的 v2 地图');
      if (resumedRoot && resumedRoot !== projectRoot) throw new Error('本地桥会话绑定了另一个项目，请重新打开项目');
      this.projectId = String(opened.projectId ?? document.mapId);
      this.revision = Number(opened.revision ?? document.revision);
      this.lastDocument = structuredClone(document);
      sessionStorage.setItem('live-dot-map-project', projectRoot);
      window.LiveDotApp.load(document);
      window.LiveDotApp.setStatus('saved', `revision ${this.revision}`);
      this.log('client.init', { projectRoot, revision: this.revision, resumed: Boolean(resumedRoot) });
      void this.refreshAgentStatus();
      this.startEvents();
      url.searchParams.delete('token');
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (error) {
      const code = String((error as { code?: unknown })?.code ?? '');
      const state = code === 'UNAUTHENTICATED' || code === 'BOOTSTRAP_CONSUMED' ? 'offline' : 'error';
      this.logError('client.init.failed', error);
      window.LiveDotApp.setStatus(state, state === 'offline' ? '本地桥会话已结束，请从活点地图重新打开项目' : (error instanceof Error ? error.message : '本地桥连接失败'));
    }
  }

  /** Read/create a node or route Markdown document through the bridge. */
  async readMarkdown(path: string, options: { create?: boolean; title?: string } = {}): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法打开 Markdown');
    const params = new URLSearchParams({ path });
    if (options.create) params.set('create', '1');
    if (options.title) params.set('title', options.title);
    return this.request(`/api/v1/markdown?${params.toString()}`);
  }

  /** Atomically save Markdown; baseEtag makes concurrent edits explicit. */
  async writeMarkdown(path: string, content: string, baseEtag?: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法保存 Markdown');
    window.LiveDotApp?.setStatus('saving', '正在保存 Markdown');
    try {
      const result = await this.request('/api/v1/markdown', {
        method: 'PUT',
        body: { path, content, ...(baseEtag ? { baseEtag } : {}) },
      });
      window.LiveDotApp?.setStatus('saved', 'Markdown 已保存');
      return result;
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      this.logError('markdown.save.failed', error, { path });
      window.LiveDotApp?.setStatus(status === 409 ? 'conflict' : 'error', error instanceof Error ? error.message : 'Markdown 保存失败');
      throw error;
    }
  }

  async revealMarkdown(path: string, options: { open?: boolean } = {}): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    if (options.open) {
      return this.request('/api/v1/markdown/reveal', { method: 'POST', body: { path } });
    }
    const params = new URLSearchParams({ path });
    return this.request(`/api/v1/markdown/reveal?${params.toString()}`);
  }

  // Aliases keep the browser integration readable while allowing an adapter
  // to call either “open” or “read” without duplicating transport logic.
  openMarkdown(path: string, options: { create?: boolean; title?: string } = {}): Promise<JsonMap> {
    return this.readMarkdown(path, options);
  }

  saveMarkdown(path: string, content: string, baseEtag?: string): Promise<JsonMap> {
    return this.writeMarkdown(path, content, baseEtag);
  }

  /** 弹出原生文件夹选择器并切换项目（桥会话内完成）；用户取消返回 null。 */
  async pickProject(): Promise<JsonMap | null> {
    if (!this.active) throw new Error('本地桥未连接');
    const result = await this.request('/api/v1/projects/pick', { method: 'POST', body: {} });
    if (result.cancelled) return null;
    this.attachProject(result);
    return result;
  }

  /** 按路径切换到已打开过的项目（最近项目列表点击）。 */
  async switchProject(projectRoot: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    const result = await this.request('/api/v1/projects/open', { method: 'POST', body: { projectRoot } });
    this.attachProject(result);
    return result;
  }

  /** 最近打开过的项目根路径列表（目录已失效的会被桥过滤）。 */
  async recentProjects(): Promise<string[]> {
    if (!this.active) return [];
    const result = await this.request('/api/v1/projects/recent');
    return Array.isArray(result.recent) ? result.recent.filter((item): item is string => typeof item === 'string') : [];
  }

  /** 当前项目的地图清单（id/名称/更新时间/当前标记）与 active-map 指针。 */
  async listMaps(): Promise<{ activeMap: string; maps: JsonMap[] }> {
    if (!this.active) return { activeMap: '', maps: [] };
    const result = await this.request('/api/v1/maps');
    return {
      activeMap: String(result.activeMap ?? ''),
      maps: Array.isArray(result.maps) ? result.maps as JsonMap[] : [],
    };
  }

  /** 新建一张地图并切换过去（桥端建目录、写指针，返回新图快照）。 */
  async createMap(name = ''): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    const result = await this.request('/api/v1/maps/create', { method: 'POST', body: { name } });
    this.attachProject(result, String((result.document as JsonMap)?.name ?? name ?? '新地图'));
    return result;
  }

  /** 切换到当前项目里的另一张地图。 */
  async switchMap(mapId: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    const result = await this.request('/api/v1/maps/switch', { method: 'POST', body: { mapId } });
    this.attachProject(result, String((result.document as JsonMap)?.name ?? mapId));
    return result;
  }

  /** 重命名地图（只改 map.json 的 name，目录 id 不变）。 */
  async renameMap(mapId: string, name: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    return this.request('/api/v1/maps/rename', { method: 'POST', body: { mapId, name } });
  }

  /** 切换项目/地图后的共享装载：替换会话基准、重载画布、重建事件流（订阅新频道）。 */
  private attachProject(result: JsonMap, label = ''): void {
    const snapshot = result.snapshot && typeof result.snapshot === 'object' ? result.snapshot as JsonMap : undefined;
    const document = (result.document ?? result.map ?? snapshot?.document) as JsonMap;
    if (!document || Number(document.version) !== 2) throw new Error('项目没有可写的 v2 地图');
    const root = String(result.projectRoot ?? '');
    if (root) {
      sessionStorage.setItem('live-dot-map-project', root);
      // URL 的 ?project= 是各处判断「当前项目」的权威来源，切换后必须同步，
      // 否则顶栏项目名与刷新后重开都会停在旧项目上。
      const url = new URL(location.href);
      if (url.searchParams.get('project') !== root) {
        url.searchParams.set('project', root);
        history.replaceState(null, '', url);
      }
    }
    this.projectId = String(result.projectId ?? document.mapId);
    this.revision = Number(result.revision ?? document.revision);
    this.lastDocument = structuredClone(document);
    this.pending = null;
    this.dirty = false;
    this.retry = 0;
    window.LiveDotApp?.load(document);
    window.LiveDotApp?.setStatus('saved', `已切换到 ${label || root} · revision ${this.revision}`);
    this.log('project.switch', { root, map: String(result.activeMap ?? ''), revision: this.revision });
    this.startEvents();
  }

  /* 读取桥端 agent-health 记录,取最新一条写回时间,供状态点 tooltip 展示 */
  async refreshAgentStatus(): Promise<JsonMap | null> {
    if (!this.active) return null;
    try {
      const result = await this.request('/api/v1/agents');
      if (Array.isArray(result.agents)) {
        let latest: { at: string; name: string } | null = null;
        for (const item of result.agents as JsonMap[]) {
          const health = item.health as JsonMap | undefined;
          const at = typeof health?.at === 'string' ? health.at : '';
          if (at && (!latest || at > latest.at)) latest = { at, name: String(item.id ?? health?.actor ?? '') };
        }
        this.lastAgentActivity = latest;
      }
      return result;
    } catch {
      return null;
    }
  }

  async planConsolidation(options: JsonMap = {}): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    const [response, contextResponse] = await Promise.all([
      this.request('/api/v1/mcp', {
        method: 'POST',
        body: { name: 'map_plan_consolidation', arguments: { ...options, projectId: this.projectId, sessionId: this.sessionId } },
      }),
      this.request('/api/v1/mcp', {
        method: 'POST',
        body: { name: 'map_get_context', arguments: { query: '', projectId: this.projectId, sessionId: this.sessionId } },
      }),
    ]);
    const plan = (response.result && typeof response.result === 'object' ? response.result : response) as JsonMap;
    const context = (contextResponse.result && typeof contextResponse.result === 'object' ? contextResponse.result : contextResponse) as JsonMap;
    return { ...plan, projection: context.projection };
  }

  async applyCommands(commands: JsonMap[]): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    window.LiveDotApp?.setStatus('saving', `${commands.length} 条整理修改`);
    try {
      const priorRevision = this.revision;
      const result = await this.request('/api/v1/commands', {
        method: 'POST',
        body: {
          projectId: this.projectId,
          baseRevision: priorRevision,
          commandId: randomId('curation'),
          actor: 'human',
          sessionId: this.sessionId,
          commands,
        },
      });
      const snapshot = result.snapshot && typeof result.snapshot === 'object' ? result.snapshot as JsonMap : undefined;
      const document = (result.document ?? result.map ?? snapshot?.document) as JsonMap | undefined;
      const nextRevision = Number(result.revision ?? document?.revision);
      if (!document || !Number.isInteger(nextRevision) || nextRevision !== priorRevision + 1) throw new Error('整理结果缺少完整地图或 revision 不连续');
      this.revision = nextRevision;
      this.lastDocument = structuredClone(document);
      this.pending = null;
      this.dirty = false;
      await saveDraft(this.projectId, null).catch(() => undefined);
      window.LiveDotApp?.load(document);
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}`);
      return result;
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      this.dirty = true;
      window.LiveDotApp?.setStatus(status === 409 ? 'conflict' : 'error', error instanceof Error ? error.message : '整理保存失败');
      throw error;
    }
  }

  async createCheckpoint(): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    this.checkpoint = await this.request('/api/v1/snapshot', { method: 'POST', body: { reason: '整理地图前检查点' } });
    return structuredClone(this.checkpoint);
  }

  /** 检查是否有新版本（静默；失败返回不可用，不打扰用户）。 */
  async checkUpdate(): Promise<JsonMap> {
    if (!this.active) return { ok: false, current: null, latest: null, available: false };
    try {
      return await this.request('/api/v1/update/check');
    } catch {
      return { ok: false, current: null, latest: null, available: false };
    }
  }

  /** 下载并应用更新；成功后桥会退出并重启，由更新器重新打开画布。 */
  async applyUpdate(): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    return this.request('/api/v1/update/apply', { method: 'POST', body: {} });
  }

  async recoverCheckpoint(): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    const path = String(this.checkpoint?.path ?? '');
    const name = path.split(/[\\/]/).pop();
    if (!name) throw new Error('还没有可恢复的整理前检查点');
    window.LiveDotApp?.setStatus('saving', '正在恢复整理前检查点');
    try {
      const result = await this.request('/api/v1/recover', { method: 'POST', body: { source: 'snapshot', name } });
      const document = (result.document ?? result.map) as JsonMap | undefined;
      if (!document) throw new Error('恢复结果缺少完整地图');
      this.revision = Number(result.revision ?? document.revision);
      this.lastDocument = structuredClone(document);
      this.pending = null;
      this.dirty = false;
      await saveDraft(this.projectId, null).catch(() => undefined);
      window.LiveDotApp?.load(document);
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}，已恢复整理前状态`);
      return result;
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      this.dirty = true;
      window.LiveDotApp?.setStatus(status === 409 ? 'conflict' : 'error', error instanceof Error ? error.message : '恢复失败');
      throw error;
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
    if (!this.active || !this.pending || !this.lastDocument) return;
    if (this.inFlight) {
      // 上一次提交仍在进行中：稍后重试，绝不丢弃新的本地修改。
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.flush(), 200);
      return;
    }
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
      // 只清空本次提交的 pending；提交期间若又有新修改 schedule 进来，必须保留并继续保存。
      if (this.pending === current) {
        this.pending = null;
        this.dirty = false;
        await saveDraft(this.projectId, null).catch(() => undefined);
        window.LiveDotApp?.setStatus('saved', `revision ${this.revision}`);
      } else {
        window.LiveDotApp?.setStatus('draft', '本地草稿');
      }
      this.retry = 0;
      this.log('save.flush', { commands: commands.length, revision: this.revision });
    } catch (error) {
      const status = Number((error as { status?: number }).status);
      if (status === 409) {
        this.log('save.conflict', { message: error instanceof Error ? error.message : String(error) }, 'warn');
        window.LiveDotApp?.setStatus('conflict', error instanceof Error ? error.message : '发生并发冲突');
      } else {
        this.retry += 1;
        this.logError('save.failed', error, { retry: this.retry });
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
      this.log('sse.error', {}, 'warn');
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
      // Agent 写回的新对象：对比上一份文档，标记后让画布脉冲高亮（C9）。
      const fresh: string[] = [];
      const before = this.lastDocument;
      this.lastDocument = structuredClone(document);
      for (const collection of COLLECTIONS) {
        const previous = new Set(((before?.[collection] as JsonMap[]) ?? []).map((item) => String(item.id)));
        for (const item of (document[collection] as JsonMap[]) ?? []) {
          if (!previous.has(String(item.id))) fresh.push(String(item.id));
        }
      }
      window.LiveDotApp?.load(document);
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}，已同步 Agent 修改`);
      window.LiveDotApp?.flashObjects?.(fresh);
      this.log('agent.sync', { revision: this.revision, fresh: fresh.length });
      void this.refreshAgentStatus();
    } catch (error) {
      this.logError('agent.sync.failed', error);
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
// 画布全局 JS 错误也进运行日志：前端异常不再只能依赖用户截图口述。
window.addEventListener('error', (event) => {
  client.logError('window.error', event.error ?? new Error(String(event.message || '未知脚本错误')));
});
window.addEventListener('unhandledrejection', (event) => {
  client.logError('window.unhandledrejection', event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
});
window.addEventListener('beforeunload', (event) => {
  if (!client.active || !(client as unknown as { dirty: boolean }).dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
void client.initialize();
