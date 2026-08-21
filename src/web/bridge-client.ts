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
    for (const id of oldItems.keys()) if (!newItems.has(id)) commands.push({ op: 'archive', collection, id });
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
    const request = indexedDB.open('live-dot-map-v2', 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
      if (!request.result.objectStoreNames.contains('reconnect')) request.result.createObjectStore('reconnect');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveReconnectTicket(key: string, value: string): Promise<void> {
  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('reconnect', 'readwrite');
    transaction.objectStore('reconnect').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function readReconnectTicket(key: string): Promise<string> {
  const db = await openDraftDb();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction('reconnect', 'readonly').objectStore('reconnect').get(key);
    request.onsuccess = () => resolve(request.result ?? '');
    request.onerror = () => reject(request.error);
  });
  db.close();
  return typeof value === 'string' ? value : '';
}

async function saveDraft(key: string, value: JsonMap | null): Promise<void> {
  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    value === null ? store.delete(key) : store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function readDraft(key: string): Promise<JsonMap | null> {
  const db = await openDraftDb();
  const value = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readonly');
    const request = transaction.objectStore('drafts').get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonMap : null;
}

function mergeThreeWay(base: unknown, local: unknown, remote: unknown, path = ''): { value: unknown; conflicts: string[] } {
  if (equal(local, base)) return { value: structuredClone(remote), conflicts: [] };
  if (equal(remote, base) || equal(local, remote)) return { value: structuredClone(local), conflicts: [] };
  if ([base, local, remote].every((value) => Array.isArray(value) && value.every((item) => item && typeof item === 'object' && !Array.isArray(item) && 'id' in item))) {
    const baseMap = new Map((base as JsonMap[]).map((item) => [String(item.id), item]));
    const localMap = new Map((local as JsonMap[]).map((item) => [String(item.id), item]));
    const remoteMap = new Map((remote as JsonMap[]).map((item) => [String(item.id), item]));
    const ids = [...new Set([...remoteMap.keys(), ...localMap.keys(), ...baseMap.keys()])];
    const value: unknown[] = [];
    const conflicts: string[] = [];
    for (const id of ids) {
      const merged = mergeThreeWay(baseMap.get(id), localMap.get(id), remoteMap.get(id), `${path}[${id}]`);
      if (merged.value !== undefined) value.push(merged.value);
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }
  if (
    base && local && remote
    && typeof base === 'object' && typeof local === 'object' && typeof remote === 'object'
    && !Array.isArray(base) && !Array.isArray(local) && !Array.isArray(remote)
  ) {
    const value: JsonMap = {};
    const conflicts: string[] = [];
    const keys = new Set([...Object.keys(base as JsonMap), ...Object.keys(local as JsonMap), ...Object.keys(remote as JsonMap)]);
    for (const key of keys) {
      const merged = mergeThreeWay((base as JsonMap)[key], (local as JsonMap)[key], (remote as JsonMap)[key], path ? `${path}.${key}` : key);
      if (merged.value !== undefined) value[key] = merged.value;
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }
  // 同一叶子被两边修改：画布保留本地值，服务端值仍在 lastDocument，禁止自动提交。
  return { value: structuredClone(local), conflicts: [path || '$'] };
}

export class BridgeClient {
  private origin = '';
  private csrf = '';
  private initialized = false;
  private connected = false;
  private authErrorShown = false;
  private projectHandle = '';
  private mapKey = '';
  private projectId = '';
  private sessionId = randomId('session');
  private revision = 0;
  private lastDocument: JsonMap | null = null;
  private pending: JsonMap | null = null;
  private timer = 0;
  private retry = 0;
  private inFlight = false;
  private inFlightWaiters = new Set<() => void>();
  private mapTransition = false;
  private mapTransitionWaiters = new Set<() => void>();
  private dirty = false;
  private draftCommandId = '';
  private markdownBases = new Map<string, { content: string; etag: string }>();
  private events?: EventSource;
  private eventWatchdog = 0;
  private sessionChannel?: BroadcastChannel;
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
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrf,
          'X-LiveDot-Project-Handle': this.projectHandle,
          'X-LiveDot-Map-Key': this.mapKey,
        },
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

  /** active 表示已接管真实地图且可记草稿；网络认证状态由 connected 单独维护。 */
  get active(): boolean { return this.initialized; }
  get latestCheckpoint(): JsonMap | null { return this.checkpoint ? structuredClone(this.checkpoint) : null; }

  private draftKeyFor(mapKey: string, projectHandle = this.projectHandle): string {
    return `${this.origin}|${projectHandle}|${mapKey}`;
  }

  private draftKey(): string {
    return this.draftKeyFor(this.mapKey);
  }

  private reconnectKey(): string { return `${this.origin}|${this.projectHandle}`; }
  private markdownBaseKey(path: string, mapKey = this.mapKey, projectHandle = this.projectHandle): string {
    return `${this.origin}|${projectHandle}|${mapKey}|md-base|${path.replace(/\\/g, '/')}`;
  }

  private markdownDraftKey(path: string, mapKey = this.mapKey, projectHandle = this.projectHandle): string {
    return `${this.origin}|${projectHandle}|${mapKey}|md|${path.replace(/\\/g, '/')}`;
  }

  private async waitForInFlight(): Promise<void> {
    if (!this.inFlight) return;
    await new Promise<void>((resolve) => this.inFlightWaiters.add(resolve));
  }

  private notifyInFlightDone(): void {
    this.inFlight = false;
    const waiters = [...this.inFlightWaiters];
    this.inFlightWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  private async waitForMapTransition(): Promise<void> {
    if (!this.mapTransition) return;
    await new Promise<void>((resolve) => this.mapTransitionWaiters.add(resolve));
  }

  private beginMapTransition(): void { this.mapTransition = true; }

  private endMapTransition(): void {
    this.mapTransition = false;
    const waiters = [...this.mapTransitionWaiters];
    this.mapTransitionWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  /** 停放当前地图草稿；调用方随后才可以切换 mapKey。 */
  private async parkPendingDraft(mapKey: string, projectHandle = this.projectHandle): Promise<void> {
    clearTimeout(this.timer);
    this.timer = 0;
    if (!this.pending || !this.lastDocument) return;
    const commandId = this.draftCommandId || randomId('cmd');
    this.draftCommandId = commandId;
    await saveDraft(this.draftKeyFor(mapKey, projectHandle), {
      baseRevision: this.revision,
      baseSnapshot: structuredClone(this.lastDocument),
      draft: structuredClone(this.pending),
      commandId,
      sessionId: this.sessionId,
      savedAt: new Date().toISOString(),
    });
  }

  private resumePendingAfterTransitionFailure(): void {
    if (!this.pending || !this.dirty || this.timer) return;
    this.timer = window.setTimeout(() => void this.flush(), 350);
  }

  private async prepareMapTransition(): Promise<string> {
    await this.waitForMapTransition();
    await this.waitForInFlight();
    this.beginMapTransition();
    const oldMapKey = this.mapKey;
    try {
      await this.parkPendingDraft(oldMapKey);
      return oldMapKey;
    } catch (error) {
      this.resumePendingAfterTransitionFailure();
      this.endMapTransition();
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (!window.LiveDotApp) return;
    const url = new URL(location.href);
    const isLoopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
    const token = url.searchParams.get('token');
    const requestedProjectRoot = url.searchParams.get('project') || sessionStorage.getItem('live-dot-map-project');
    this.projectHandle = sessionStorage.getItem('live-dot-map-project-handle') || '';
    if (!isLoopback || (!token && !requestedProjectRoot && !this.projectHandle)) {
      window.LiveDotApp.setStatus('fallback', 'Agent 自动读取和并发保护未启用');
      return;
    }
    this.origin = url.origin;
    if ('BroadcastChannel' in window) {
      this.sessionChannel = new BroadcastChannel('live-dot-map-session-v1');
      this.sessionChannel.onmessage = (event) => {
        const ticket = String((event.data as JsonMap | undefined)?.reconnectTicket ?? '');
        if (ticket && this.projectHandle) void saveReconnectTicket(this.reconnectKey(), ticket).catch(() => undefined);
      };
    }
    try {
      // The bootstrap token is intentionally one-use and is removed from the
      // address bar after the first load. Refreshes resume the HttpOnly-cookie
      // session instead of incorrectly falling back to browser-only mode.
      let session: JsonMap;
      try {
        session = token
          ? await this.request('/api/v1/session', { method: 'POST', token })
          : await this.request('/api/v1/session', { method: 'GET' });
      } catch (error) {
        if (token || Number((error as { status?: number }).status) !== 401 || !this.projectHandle) throw error;
        const reconnectTicket = await readReconnectTicket(this.reconnectKey()).catch(() => '');
        if (!reconnectTicket) throw error;
        session = await this.request('/api/v1/session/reconnect', {
          method: 'POST', body: { projectHandle: this.projectHandle, reconnectTicket },
        });
      }
      this.csrf = String(session.csrfToken ?? '');
      this.projectHandle = String(session.projectHandle ?? this.projectHandle);
      if (this.projectHandle) sessionStorage.setItem('live-dot-map-project-handle', this.projectHandle);
      const reconnectTicket = String(session.reconnectTicket ?? '');
      if (reconnectTicket && this.projectHandle) {
        await saveReconnectTicket(this.reconnectKey(), reconnectTicket).catch(() => undefined);
        this.sessionChannel?.postMessage({ reconnectTicket });
      }
      const resumedRoot = String(session.projectRoot ?? '');
      const projectRoot = resumedRoot || requestedProjectRoot || '';
      if (!projectRoot && !this.projectHandle) throw new Error('本地桥会话没有绑定项目，请从活点地图重新打开');
      const opened = resumedRoot || this.projectHandle
        ? await this.request('/api/v1/snapshot')
        : await this.request('/api/v1/projects/open', { method: 'POST', body: { projectRoot } });
      const openedSnapshot = opened.snapshot && typeof opened.snapshot === 'object' ? opened.snapshot as JsonMap : undefined;
      let document = (opened.document ?? opened.map ?? openedSnapshot?.document) as JsonMap;
      if (!document || Number(document.version) !== 2) throw new Error('本地桥没有返回可写的 v2 地图');
      if (resumedRoot && resumedRoot !== projectRoot) throw new Error('本地桥会话绑定了另一个项目，请重新打开项目');
      this.projectId = String(opened.projectId ?? document.mapId);
      this.revision = Number(opened.revision ?? document.revision);
      this.initialized = true;
      this.connected = true;
      if (projectRoot) sessionStorage.setItem('live-dot-map-project', projectRoot);
      this.mapKey = String(opened.activeMap ?? this.mapKey);
      let renderDocument = document;
      let storedDraft = await readDraft(this.draftKey()).catch(() => null);
      let baseSnapshot = storedDraft?.baseSnapshot as JsonMap | undefined;
      let localDraft = storedDraft?.draft as JsonMap | undefined;
      const storedCommandId = String(storedDraft?.commandId ?? '');
      // 上次提交可能已在服务端落盘，但浏览器在删除 IndexedDB 草稿前被刷新。
      // 先以同一 commandId 重放：命中持久回执时只会返回既有结果，不会重复执行。
      if (baseSnapshot && localDraft && storedCommandId && Number.isInteger(Number(storedDraft?.baseRevision))) {
        const replayCommands = diffDocument(baseSnapshot, localDraft);
        if (!replayCommands.length) {
          await saveDraft(this.draftKey(), null).catch(() => undefined);
          storedDraft = null;
          baseSnapshot = undefined;
          localDraft = undefined;
        } else {
          try {
            await this.request('/api/v1/commands', {
              method: 'POST',
              body: {
                projectId: this.projectId,
                documentId: this.projectId,
                mapKey: this.mapKey,
                baseRevision: Number(storedDraft.baseRevision),
                commandId: storedCommandId,
                actor: 'human',
                sessionId: String(storedDraft.sessionId || this.sessionId),
                commands: replayCommands,
              },
            });
            const latest = await this.request('/api/v1/snapshot');
            document = (latest.document ?? latest.map) as JsonMap;
            this.revision = Number(latest.revision ?? document.revision);
            renderDocument = document;
            await saveDraft(this.draftKey(), null).catch(() => undefined);
            storedDraft = null;
            baseSnapshot = undefined;
            localDraft = undefined;
          } catch {
            // 没有回执或确有并发变化时，继续走下方三方合并并保留双方内容。
          }
        }
      }
      this.lastDocument = structuredClone(document);
      if (baseSnapshot && localDraft && Number.isInteger(Number(storedDraft?.baseRevision))) {
        const merged = mergeThreeWay(baseSnapshot, localDraft, document);
        renderDocument = merged.value as JsonMap;
        this.pending = structuredClone(renderDocument);
        this.dirty = !equal(renderDocument, document);
        this.draftCommandId = String(storedDraft?.commandId || randomId('cmd'));
        window.LiveDotApp.load(renderDocument);
        window.LiveDotApp.setStatus(merged.conflicts.length ? 'conflict' : 'draft', merged.conflicts.length ? `草稿有 ${merged.conflicts.length} 处冲突，已保留双方版本` : '已恢复本地草稿');
        if (this.dirty && !merged.conflicts.length) this.timer = window.setTimeout(() => void this.flush(), 350);
      } else {
        window.LiveDotApp.load(document);
        window.LiveDotApp.setStatus('saved', `revision ${this.revision}`);
      }
      this.log('client.init', { revision: this.revision, resumed: Boolean(resumedRoot), draftRecovered: Boolean(storedDraft) });
      void this.refreshAgentStatus();
      this.startEvents();
      url.searchParams.delete('token');
      url.searchParams.delete('project');
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (error) {
      const code = String((error as { code?: unknown })?.code ?? '');
      const state = code === 'UNAUTHENTICATED' || code === 'BOOTSTRAP_CONSUMED' ? 'offline' : 'error';
      this.logError('client.init.failed', error);
      window.LiveDotApp.setStatus(state, state === 'offline' ? '本地桥会话已结束，请从活点地图重新打开项目' : (error instanceof Error ? error.message : '本地桥连接失败'));
    }
  }

  /** Read the currently routed map snapshot without bypassing project/map headers. */
  async readSnapshot(): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法读取地图');
    return this.request('/api/v1/snapshot');
  }

  /**
   * 断线弹窗的「重新连接」：用 IndexedDB 里落盘的通行证补办新会话，
   * 成功则重建事件流并对账快照；没有通行证或补办失败都返回 false，
   * 由界面引导用户双击桌面图标重新打开。
   */
  async reconnect(): Promise<boolean> {
    if (!this.projectHandle) return false;
    try {
      const reconnectTicket = await readReconnectTicket(this.reconnectKey()).catch(() => '');
      if (!reconnectTicket) return false;
      // 旧会话可能已失效，先清掉过期 CSRF 再补办，避免被拒。
      this.csrf = '';
      const session = await this.request('/api/v1/session/reconnect', {
        method: 'POST', body: { projectHandle: this.projectHandle, reconnectTicket },
      });
      this.csrf = String(session.csrfToken ?? '');
      const nextTicket = String(session.reconnectTicket ?? '');
      if (nextTicket) {
        await saveReconnectTicket(this.reconnectKey(), nextTicket).catch(() => undefined);
        this.sessionChannel?.postMessage({ reconnectTicket: nextTicket });
      }
      this.authErrorShown = false;
      this.connected = true;
      await this.reconcileSnapshot();
      this.startEvents();
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}`);
      this.log('client.reconnect', { revision: this.revision });
      return true;
    } catch (error) {
      this.logError('client.reconnect.failed', error);
      return false;
    }
  }

  /** Invoke a shared MCP tool through the authenticated browser transport. */
  async callTool(name: string, arguments_: JsonMap = {}): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法调用 Agent 工具');
    return this.request('/api/v1/mcp', { method: 'POST', body: { name, arguments: arguments_ } });
  }

  /** Read/create a node or route Markdown document through the bridge. */
  async readMarkdown(path: string, options: { create?: boolean; title?: string } = {}): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法打开 Markdown');
    const params = new URLSearchParams({ path });
    if (options.create) params.set('create', '1');
    if (options.title) params.set('title', options.title);
    try {
      const result = await this.request(`/api/v1/markdown?${params.toString()}`);
      const remoteContent = String(result.content ?? '');
      const remoteEtag = String(result.etag ?? '');
      this.markdownBases.set(this.markdownBaseKey(path), { content: remoteContent, etag: remoteEtag });
      const stored = await readDraft(this.markdownDraftKey(path)).catch(() => null);
      if (!stored || typeof stored.draft !== 'string' || typeof stored.baseContent !== 'string') return result;
      const local = stored.draft;
      const base = stored.baseContent;
      if (local === base) {
        await saveDraft(this.markdownDraftKey(path), null).catch(() => undefined);
        return result;
      }
      if (remoteContent === base || remoteContent === local) {
        window.LiveDotApp?.setStatus('draft', '已恢复 Markdown 本地草稿');
        return { ...result, content: local, recoveredDraft: true, baseEtag: remoteEtag };
      }
      window.LiveDotApp?.setStatus('conflict', 'Markdown 本地草稿与外部修改冲突，双方内容已保留');
      return { ...result, content: local, recoveredDraft: true, conflict: true, serverContent: remoteContent, baseContent: base };
    } catch (error) {
      const stored = await readDraft(this.markdownDraftKey(path)).catch(() => null);
      if (stored && typeof stored.draft === 'string') {
        return { path, content: stored.draft, etag: stored.baseEtag, offlineDraft: true, baseContent: stored.baseContent };
      }
      throw error;
    }
  }

  /** Atomically save Markdown; baseEtag makes concurrent edits explicit. */
  async writeMarkdown(path: string, content: string, baseEtag?: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法保存 Markdown');
    const base = this.markdownBases.get(this.markdownBaseKey(path)) || { content: '', etag: '' };
    const effectiveBaseEtag = baseEtag || base.etag;
    if (!effectiveBaseEtag) throw new Error('Markdown 尚未读取安全基线，请重新打开后再保存');
    await saveDraft(this.markdownDraftKey(path), {
      baseEtag: effectiveBaseEtag,
      baseContent: base.content,
      draft: content,
      savedAt: new Date().toISOString(),
    }).catch(() => undefined);
    window.LiveDotApp?.setStatus('saving', '正在保存 Markdown');
    try {
      const result = await this.request('/api/v1/markdown', {
        method: 'PUT',
        body: { path, content, baseEtag: effectiveBaseEtag },
      });
      this.markdownBases.set(this.markdownBaseKey(path), { content: String(result.content ?? content), etag: String(result.etag ?? '') });
      await saveDraft(this.markdownDraftKey(path), null).catch(() => undefined);
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

  /** 返回桥端检测到的编辑器清单；浏览器只拿 opaque id 和展示标签。 */
  async listEditors(): Promise<{ editors: JsonMap[]; preferredEditorId: string }> {
    if (!this.active) return { editors: [], preferredEditorId: '' };
    const result = await this.request('/api/v1/editors');
    return {
      editors: Array.isArray(result.editors) ? result.editors as JsonMap[] : [],
      preferredEditorId: String(result.preferredEditorId ?? ''),
    };
  }

  /** 用桥端登记的编辑器打开相对 Markdown 文件；不接受任意命令行。 */
  async openEditor(editorId: string, relativePath: string, targetKind: 'file' | 'directory' = 'file'): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法打开外部编辑器');
    return this.request('/api/v1/editors/open', {
      method: 'POST',
      body: { editorId, relativePath, targetKind },
    });
  }

  /** 将桥端清单中的 opaque 编辑器 id 写入用户首选设置。 */
  async setPreferredEditor(editorId: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法记住编辑器偏好');
    return this.request('/api/v1/editors/preferred', { method: 'POST', body: { editorId } });
  }

  /** 通过本机原生文件选择器登记手动编辑器，不向浏览器暴露可执行文件路径。 */
  async pickManualEditor(): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法选择外部编辑器');
    return this.request('/api/v1/editors/pick', { method: 'POST', body: {} });
  }

  /** 将当前 Markdown 交给原生 Save As，只导出副本，不改变资料包引用。 */
  async saveMarkdownAsCopy(relativePath: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法导出 Markdown 副本');
    return this.request('/api/v1/editors/save-as', { method: 'POST', body: { relativePath } });
  }

  /** 当前对象资料包文件清单；index.md 永远排在第一项。 */
  async listBundleFiles(ownerKind: 'node' | 'route', ownerId: string, includeArchived = false): Promise<JsonMap[]> {
    if (!this.active) return [];
    const params = new URLSearchParams({ ownerKind, ownerId });
    if (includeArchived) params.set('includeArchived', 'true');
    const result = await this.request(`/api/v1/bundles?${params.toString()}`);
    return Array.isArray(result.files) ? result.files as JsonMap[] : [];
  }

  /** 读取对象资料包中的 Markdown（index.md 或补充 md）。 */
  async readBundleMarkdown(ownerKind: 'node' | 'route', ownerId: string, fileName = 'index.md'): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法打开资料包 Markdown');
    const params = new URLSearchParams({ ownerKind, ownerId, fileName });
    return this.request(`/api/v1/bundles/markdown/read?${params.toString()}`);
  }

  /** 创建补充 Markdown；index.md 必须由桥端迁移/初始化产生且不可覆盖。 */
  async createBundleMarkdown(ownerKind: 'node' | 'route', ownerId: string, fileName: string, content?: string, title?: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法创建资料包 Markdown');
    return this.request('/api/v1/bundles/markdown/create', {
      method: 'POST',
      body: { ownerKind, ownerId, fileName, ...(content === undefined ? {} : { content }), ...(title ? { title } : {}) },
    });
  }

  /** 以 etag 乐观并发检查替换资料包 Markdown。 */
  async replaceBundleMarkdown(ownerKind: 'node' | 'route', ownerId: string, fileName: string, content: string, baseEtag: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法保存资料包 Markdown');
    return this.request('/api/v1/bundles/markdown/replace', {
      method: 'POST',
      body: { ownerKind, ownerId, fileName, content, baseEtag },
    });
  }

  /** Agent/人追加资料包 Markdown，commandId 可保证重试幂等。 */
  async appendBundleMarkdown(ownerKind: 'node' | 'route', ownerId: string, fileName: string, content: string, commandId?: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法追加资料包 Markdown');
    return this.request('/api/v1/bundles/markdown/append', {
      method: 'POST',
      body: { ownerKind, ownerId, fileName, content, ...(commandId ? { commandId } : {}) },
    });
  }

  async renameBundleFile(ownerKind: 'node' | 'route', ownerId: string, from: string, to: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法重命名资料包文件');
    return this.request('/api/v1/bundles/rename', { method: 'POST', body: { ownerKind, ownerId, from, to } });
  }

  async archiveBundleFile(ownerKind: 'node' | 'route', ownerId: string, fileName: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法归档资料包文件');
    return this.request('/api/v1/bundles/archive', { method: 'POST', body: { ownerKind, ownerId, fileName } });
  }

  async restoreBundleFile(ownerKind: 'node' | 'route', ownerId: string, fileName: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法恢复资料包文件');
    return this.request('/api/v1/bundles/restore', { method: 'POST', body: { ownerKind, ownerId, fileName } });
  }

  /**
   * 以原始二进制流上传附件，避免 base64 放大和 JSON body 上限。
   * 调用方只需提供 Blob/File、ArrayBuffer 或 Uint8Array；文件名来自 File.name
   * 或显式参数，服务端仍会执行扩展名、MIME 和文件头校验。
   */
  async importAsset(
    ownerKind: 'node' | 'route',
    ownerId: string,
    data: Blob | ArrayBuffer | Uint8Array,
    fileName?: string,
  ): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法导入附件');
    const candidateName = fileName || (typeof File !== 'undefined' && data instanceof File ? data.name : 'asset.bin');
    if (!candidateName) throw new Error('附件缺少文件名');
    const params = new URLSearchParams({ ownerKind, ownerId, fileName: candidateName });
    const contentType = typeof Blob !== 'undefined' && data instanceof Blob ? data.type : '';
    return this.requestBinary(`/api/v1/assets/import?${params.toString()}`, data, contentType || 'application/octet-stream');
  }

  private async requestBinary(path: string, body: Blob | ArrayBuffer | Uint8Array, contentType: string): Promise<JsonMap> {
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    if (this.projectHandle) headers['X-LiveDot-Project-Handle'] = this.projectHandle;
    if (this.mapKey) headers['X-LiveDot-Map-Key'] = this.mapKey;
    const response = await fetch(`${this.origin}${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: body as BodyInit,
    });
    const result = await response.json().catch(() => ({})) as JsonMap;
    if (!response.ok) {
      const detail = result.error as JsonMap | undefined;
      const error = Object.assign(new Error(String(detail?.message ?? `HTTP ${response.status}`)), {
        status: response.status,
        code: detail?.code,
        details: detail?.details,
      });
      if (response.status === 401 && this.initialized) {
        this.connected = false;
        this.events?.close();
        clearTimeout(this.eventWatchdog);
        if (!this.authErrorShown) {
          this.authErrorShown = true;
          window.LiveDotApp?.setStatus('offline', '本地桥会话已结束，草稿会继续保存在本机');
        }
      }
      throw error;
    }
    if (this.initialized) this.connected = true;
    return result;
  }

  /** 弹出原生文件夹选择器并切换项目（桥会话内完成）；用户取消返回 null。 */
  async pickProject(): Promise<JsonMap | null> {
    if (!this.active) throw new Error('本地桥未连接');
    await this.prepareMapTransition();
    try {
      const result = await this.request('/api/v1/projects/pick', { method: 'POST', body: {} });
      if (result.cancelled) {
        this.resumePendingAfterTransitionFailure();
        return null;
      }
      await this.attachProject(result);
      return result;
    } catch (error) {
      this.resumePendingAfterTransitionFailure();
      throw error;
    } finally {
      this.endMapTransition();
    }
  }

  /** 按路径切换到已打开过的项目（最近项目列表点击）。 */
  async switchProject(projectRoot: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    await this.prepareMapTransition();
    try {
      const result = await this.request('/api/v1/projects/open', { method: 'POST', body: { projectRoot } });
      await this.attachProject(result);
      return result;
    } catch (error) {
      this.resumePendingAfterTransitionFailure();
      throw error;
    } finally {
      this.endMapTransition();
    }
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

  /** 当前地图的已归档对象清单；永久清除入口只在设置页显式提供。 */
  async listArchived(): Promise<JsonMap[]> {
    if (!this.active) return [];
    const result = await this.request('/api/v1/archive');
    return Array.isArray(result.archived) ? result.archived as JsonMap[] : [];
  }

  /** 从已归档清单恢复对象；服务端会按当前 revision 做并发保护。 */
  async restoreArchived(collection: 'routes' | 'nodes' | 'edges' | 'anns', id: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法恢复归档对象');
    return this.request('/api/v1/archive/restore', { method: 'POST', body: { collection, id } });
  }

  /** 永久清除必须把对象 ID 原样回填；服务端也会再次校验 confirmed/confirmation。 */
  async purgeArchived(collection: 'routes' | 'nodes' | 'edges' | 'anns', id: string, confirmation: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接，无法永久清除归档对象');
    if (String(confirmation) !== String(id)) {
      throw Object.assign(new Error('永久清除确认文本必须与对象 ID 完全一致'), { code: 'PURGE_CONFIRMATION_REQUIRED', status: 403 });
    }
    return this.request('/api/v1/archive/purge', {
      method: 'POST',
      body: { collection, id, confirmed: true, confirmation: id },
    });
  }

  /** 新建一张地图并切换过去（桥端建目录、写指针，返回新图快照）。 */
  async createMap(name = ''): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    const created = await this.request('/api/v1/maps/create', { method: 'POST', body: { name } });
    const mapKey = String(created.createdMap ?? '');
    if (!mapKey) throw new Error('新建地图结果缺少 mapKey');
    return this.switchMap(mapKey);
  }

  /** 切换到当前项目里的另一张地图。 */
  async switchMap(mapId: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    await this.prepareMapTransition();
    try {
      const result = await this.request('/api/v1/maps/switch', { method: 'POST', body: { mapId } });
      await this.attachProject(result, String((result.document as JsonMap)?.name ?? mapId));
      return result;
    } catch (error) {
      this.resumePendingAfterTransitionFailure();
      throw error;
    } finally {
      this.endMapTransition();
    }
  }

  /** 重命名地图（只改 map.json 的 name，目录 id 不变）。 */
  async renameMap(mapId: string, name: string): Promise<JsonMap> {
    if (!this.active) throw new Error('本地桥未连接');
    return this.request('/api/v1/maps/rename', { method: 'POST', body: { mapId, name } });
  }

  /** 切换项目/地图后的共享装载：先回读目标地图草稿，再替换基准和事件流。 */
  private async attachProject(result: JsonMap, label = ''): Promise<void> {
    const snapshot = result.snapshot && typeof result.snapshot === 'object' ? result.snapshot as JsonMap : undefined;
    const document = (result.document ?? result.map ?? snapshot?.document) as JsonMap;
    if (!document || Number(document.version) !== 2) throw new Error('项目没有可写的 v2 地图');

    const previous = {
      projectHandle: this.projectHandle,
      projectId: this.projectId,
      mapKey: this.mapKey,
      revision: this.revision,
      lastDocument: this.lastDocument ? structuredClone(this.lastDocument) : null,
      pending: this.pending ? structuredClone(this.pending) : null,
      dirty: this.dirty,
      draftCommandId: this.draftCommandId,
      retry: this.retry,
      projectRoot: sessionStorage.getItem('live-dot-map-project'),
      projectHandleStorage: sessionStorage.getItem('live-dot-map-project-handle'),
    };
    const root = String(result.projectRoot ?? previous.projectRoot ?? '');
    const handle = String(result.projectHandle ?? previous.projectHandle);
    const mapKey = String(result.activeMap ?? previous.mapKey);
    const projectId = String(result.projectId ?? document.mapId);
    const revision = Number(result.revision ?? document.revision);
    const targetDraftKey = this.draftKeyFor(mapKey, handle);
    const storedDraft = await readDraft(targetDraftKey).catch(() => null);
    let renderDocument = document;
    let pending: JsonMap | null = null;
    let dirty = false;
    let draftCommandId = '';
    let conflicts: string[] = [];
    if (storedDraft?.baseSnapshot && storedDraft.draft && Number.isInteger(Number(storedDraft.baseRevision))) {
      const merged = mergeThreeWay(storedDraft.baseSnapshot, storedDraft.draft, document);
      renderDocument = merged.value as JsonMap;
      conflicts = merged.conflicts;
      dirty = !equal(renderDocument, document);
      if (dirty) {
        pending = structuredClone(renderDocument);
        draftCommandId = String(storedDraft.commandId || randomId('cmd'));
      } else {
        await saveDraft(targetDraftKey, null).catch(() => undefined);
      }
    }

    try {
      if (handle) {
        this.projectHandle = handle;
        sessionStorage.setItem('live-dot-map-project-handle', handle);
        const reconnectTicket = String(result.reconnectTicket ?? '');
        if (reconnectTicket) await saveReconnectTicket(this.reconnectKey(), reconnectTicket).catch(() => undefined);
      }
      if (root) {
        sessionStorage.setItem('live-dot-map-project', root);
        // 项目绝对路径只保留在当前标签页的 sessionStorage 兼容层；URL 不暴露本机路径。
        const url = new URL(location.href);
        if (url.searchParams.has('project')) {
          url.searchParams.delete('project');
          history.replaceState(null, '', url);
        }
      }
      this.projectId = projectId;
      this.mapKey = mapKey;
      this.revision = revision;
      this.lastDocument = structuredClone(document);
      this.pending = pending;
      this.dirty = dirty;
      this.draftCommandId = draftCommandId;
      this.retry = 0;
      clearTimeout(this.timer);
      this.timer = 0;
      window.LiveDotApp?.load(renderDocument);
      const status = conflicts.length ? 'conflict' : dirty ? 'draft' : 'saved';
      const detail = conflicts.length
        ? `草稿有 ${conflicts.length} 处冲突，已保留双方版本`
        : dirty ? '已恢复本地草稿' : `已切换到 ${label || root} · revision ${this.revision}`;
      window.LiveDotApp?.setStatus(status, detail);
      this.log('project.switch', { root, map: mapKey, revision: this.revision, draftRecovered: dirty, conflicts: conflicts.length });
      if (dirty && !conflicts.length) this.timer = window.setTimeout(() => void this.flush(), 350);
      this.startEvents();
    } catch (error) {
      // attach 失败时，绝不能留下“新 mapKey + 旧 lastDocument”的错绑状态。
      this.projectHandle = previous.projectHandle;
      this.projectId = previous.projectId;
      this.mapKey = previous.mapKey;
      this.revision = previous.revision;
      this.lastDocument = previous.lastDocument;
      this.pending = previous.pending;
      this.dirty = previous.dirty;
      this.draftCommandId = previous.draftCommandId;
      this.retry = previous.retry;
      clearTimeout(this.timer);
      this.timer = 0;
      if (previous.projectRoot) sessionStorage.setItem('live-dot-map-project', previous.projectRoot);
      else sessionStorage.removeItem('live-dot-map-project');
      if (previous.projectHandleStorage) sessionStorage.setItem('live-dot-map-project-handle', previous.projectHandleStorage);
      else sessionStorage.removeItem('live-dot-map-project-handle');
      if (previous.lastDocument) window.LiveDotApp?.load(previous.pending && previous.dirty ? previous.pending : previous.lastDocument);
      throw error;
    }
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
          documentId: this.projectId,
          mapKey: this.mapKey,
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
      await saveDraft(this.draftKey(), null).catch(() => undefined);
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
      await saveDraft(this.draftKey(), null).catch(() => undefined);
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
    this.draftCommandId ||= randomId('cmd');
    void saveDraft(this.draftKey(), {
      baseRevision: this.revision,
      baseSnapshot: structuredClone(this.lastDocument),
      draft: this.pending,
      commandId: this.draftCommandId,
      sessionId: this.sessionId,
      savedAt: new Date().toISOString(),
    }).catch(() => undefined);
    window.LiveDotApp?.setStatus('draft', '本地草稿');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 350);
  }

  async flush(): Promise<void> {
    if (!this.active || !this.connected || !this.pending || !this.lastDocument) return;
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
      await saveDraft(this.draftKey(), null).catch(() => undefined);
      this.draftCommandId = '';
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
          documentId: this.projectId,
          mapKey: this.mapKey,
          baseRevision: this.revision,
          commandId: this.draftCommandId || randomId('cmd'),
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
        await saveDraft(this.draftKey(), null).catch(() => undefined);
        this.draftCommandId = '';
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
      } else if (status === 401) {
        // request() 已完成中央断线转换；草稿留在 IndexedDB，等待显式重连。
        window.LiveDotApp?.setStatus('offline', '本地桥会话已结束，草稿已保留');
      } else {
        this.retry += 1;
        this.logError('save.failed', error, { retry: this.retry });
        window.LiveDotApp?.setStatus(navigator.onLine ? 'error' : 'offline', error instanceof Error ? error.message : '保存失败');
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.flush(), Math.min(30_000, 500 * 2 ** this.retry));
      }
    } finally {
      this.notifyInFlightDone();
    }
  }

  private startEvents(): void {
    this.events?.close();
    clearTimeout(this.eventWatchdog);
    const query = new URLSearchParams({ projectHandle: this.projectHandle, mapKey: this.mapKey });
    this.events = new EventSource(`${this.origin}/api/v1/events?${query.toString()}`, { withCredentials: true });
    this.events.onopen = () => this.armEventWatchdog();
    this.events.addEventListener('heartbeat', () => this.armEventWatchdog());
    this.events.addEventListener('ready', (event) => {
      this.armEventWatchdog();
      let payload: JsonMap = {};
      try { payload = JSON.parse(String((event as MessageEvent).data)); } catch { /* 由 snapshot 对账 */ }
      if (payload.mapKey) this.mapKey = String(payload.mapKey);
      void this.reconcileSnapshot();
    });
    this.events.addEventListener('active-map-changed', (event) => {
      let payload: JsonMap = {};
      try { payload = JSON.parse(String((event as MessageEvent).data)); } catch { return; }
      const nextMapKey = String(payload.mapKey ?? '');
      if (nextMapKey && nextMapKey !== this.mapKey) void this.followActiveMap(nextMapKey);
    });
      this.events.addEventListener('revision', (event) => void this.onRevision(event as MessageEvent));
      this.events.addEventListener('commit', (event) => void this.onRevision(event as MessageEvent));
      this.events.addEventListener('command', (event) => void this.onRevision(event as MessageEvent));
    this.events.addEventListener('conflict', () => window.LiveDotApp?.setStatus('conflict', '检测到并发冲突'));
    this.events.onerror = () => {
      this.log('sse.error', {}, 'warn');
      if (!this.dirty) window.LiveDotApp?.setStatus('offline', '事件连接已断开，正在重连');
    };
  }

  private async followActiveMap(nextMapKey: string): Promise<void> {
    if (!nextMapKey || nextMapKey === this.mapKey) return;
    await this.waitForMapTransition();
    await this.waitForInFlight();
    if (!nextMapKey || nextMapKey === this.mapKey) return;
    this.beginMapTransition();
    const oldMapKey = this.mapKey;
    try {
      await this.parkPendingDraft(oldMapKey);
      // 目标 mapKey 必须用于 snapshot 请求；失败时下面会完整恢复旧 key。
      this.mapKey = nextMapKey;
      const result = await this.request('/api/v1/snapshot');
      await this.attachProject(result, String(result.document?.name ?? nextMapKey));
    } catch (error) {
      this.mapKey = oldMapKey;
      this.resumePendingAfterTransitionFailure();
      this.logError('map.follow.failed', error, { mapKey: nextMapKey });
      window.LiveDotApp?.setStatus('error', error instanceof Error ? error.message : '地图切换失败');
    } finally {
      this.endMapTransition();
    }
  }

  private armEventWatchdog(): void {
    clearTimeout(this.eventWatchdog);
    this.eventWatchdog = window.setTimeout(() => {
      this.connected = false;
      this.events?.close();
      window.LiveDotApp?.setStatus('offline', '事件连接超过 10 秒无响应，请重新打开活点地图');
    }, 10_000);
  }

  private async reconcileSnapshot(): Promise<void> {
    const requestedProjectHandle = this.projectHandle;
    const requestedMapKey = this.mapKey;
    try {
      const result = await this.request('/api/v1/snapshot');
      if (requestedProjectHandle !== this.projectHandle || requestedMapKey !== this.mapKey) return;
      const document = (result.document ?? result.map) as JsonMap | undefined;
      if (!document || this.dirty) return;
      const nextRevision = Number(result.revision ?? document.revision);
      // 同 revision 的 ready 对账不重复 load；否则会清空用户刚建立的
      // 选择态/属性面板，表现为“刚点开又消失”。
      if (nextRevision <= this.revision) return;
      this.mapKey = String(result.activeMap ?? this.mapKey);
      this.revision = nextRevision;
      this.lastDocument = structuredClone(document);
      window.LiveDotApp?.load(document);
      window.LiveDotApp?.setStatus('saved', `revision ${this.revision}`);
    } catch { /* request() 统一处理认证状态 */ }
  }

  private async onRevision(event: MessageEvent): Promise<void> {
    this.armEventWatchdog();
    let payload: JsonMap = {};
    try { payload = JSON.parse(String(event.data)); } catch { return; }
    if (String(payload.sessionId ?? '') === this.sessionId) return;
    const nextRevision = Number(payload.revision ?? 0);
    if (!nextRevision || nextRevision <= this.revision) return;
    if (this.dirty) {
      window.LiveDotApp?.setStatus('conflict', '外部修改与本地草稿同时存在');
      return;
    }
    const requestedProjectHandle = this.projectHandle;
    const requestedMapKey = this.mapKey;
    try {
      const result = await this.request('/api/v1/snapshot');
      // 项目/地图切换期间，旧 EventSource 已经在途的响应可能晚于新地图
      // 返回；身份不再一致时必须丢弃，不能用旧画布覆盖新项目。
      if (requestedProjectHandle !== this.projectHandle || requestedMapKey !== this.mapKey) return;
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
    if (this.projectHandle) headers['X-LiveDot-Project-Handle'] = this.projectHandle;
    if (this.mapKey) headers['X-LiveDot-Map-Key'] = this.mapKey;
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
      if (response.status === 401 && this.initialized) {
        this.connected = false;
        this.events?.close();
        clearTimeout(this.eventWatchdog);
        if (!this.authErrorShown) {
          this.authErrorShown = true;
          window.LiveDotApp?.setStatus('offline', '本地桥会话已结束，草稿会继续保存在本机');
        }
      }
      throw error;
    }
    if (this.initialized) this.connected = true;
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
