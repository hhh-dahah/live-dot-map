import { createHash, randomUUID } from 'node:crypto';
import { MCP_TOOL_NAMES } from './tool-definitions.generated.mjs';

/**
 * The seven tools are intentionally kept in one place.  Adapters must not
 * invent a second map protocol: they all use this client and the local
 * bridge's command handler.
 */
export { MCP_TOOL_NAMES };

export class BridgeClientError extends Error {
  constructor(code, message, { status = 500, details, cause } = {}) {
    super(message, { cause });
    this.name = 'BridgeClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Only local bridge URLs are accepted.  This is also used by install/doctor. */
export function assertLoopbackUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (error) {
    throw new BridgeClientError('INVALID_BRIDGE_URL', '本地桥地址不是有效 URL', { status: 400, cause: error });
  }
  if (!['http:', 'https:'].includes(url.protocol) || !isLoopbackHost(url.hostname)) {
    throw new BridgeClientError('NON_LOOPBACK_BRIDGE', '本地桥只允许监听 loopback 地址', {
      status: 400,
      details: { hostname: url.hostname, protocol: url.protocol },
    });
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function jsonClone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapToolResponse(value) {
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, 'structuredContent')) return value.structuredContent;
    if (Object.hasOwn(value, 'result')) return unwrapToolResponse(value.result);
    if (Array.isArray(value.content)) {
      const text = value.content.find((part) => part?.type === 'text' && typeof part.text === 'string')?.text;
      if (text !== undefined) {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
    }
  }
  return value;
}

function asQuery(value) {
  if (value === undefined || value === null) return '';
  return encodeURIComponent(String(value));
}

function safeCommandId(prefix = 'agent') {
  return `${prefix}:${randomUUID()}`;
}

/**
 * Small fetch-only client.  It never reads or writes map.json.  All writes go
 * through /api/v1/commands (or the equivalent MCP tool on the bridge).
 */
export class LocalBridgeClient {
  constructor({
    baseUrl = 'http://127.0.0.1:0',
    token = '',
    projectId = '',
    sessionId = randomUUID(),
    actor = 'agent:codex',
    fetchImpl = globalThis.fetch,
    timeoutMs = 10_000,
  } = {}) {
    this.baseUrl = assertLoopbackUrl(baseUrl);
    this.token = String(token || '');
    this.projectId = String(projectId || '');
    this.sessionId = String(sessionId || randomUUID());
    this.actor = String(actor || 'agent:codex');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(250, Number(timeoutMs) || 10_000);
    if (typeof this.fetchImpl !== 'function') {
      throw new BridgeClientError('FETCH_UNAVAILABLE', '当前 Node 没有可用的 fetch 实现', { status: 500 });
    }
  }

  #url(path) {
    const url = new URL(String(path).replace(/^\//, ''), `${this.baseUrl.toString().replace(/\/$/, '')}/`);
    if (!isLoopbackHost(url.hostname)) throw new BridgeClientError('NON_LOOPBACK_BRIDGE', '拒绝访问非本机桥');
    return url;
  }

  async #fetch(path, { method = 'GET', body, headers = {}, signal } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('bridge request timeout')), this.timeoutMs);
    const linked = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const requestHeaders = {
      Accept: 'application/json',
      'X-Live-Dot-Project': this.projectId,
      'X-Live-Dot-Session': this.sessionId,
      ...headers,
    };
    if (this.token) requestHeaders.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    let response;
    try {
      response = await this.fetchImpl(this.#url(path), {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        signal: linked,
      });
    } catch (error) {
      const code = error?.name === 'AbortError' ? 'BRIDGE_TIMEOUT' : 'BRIDGE_UNAVAILABLE';
      throw new BridgeClientError(code, code === 'BRIDGE_TIMEOUT' ? '本地桥请求超时' : '无法连接本地桥', {
        status: 503,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
    const value = await readResponseBody(response);
    if (!response.ok) {
      const details = value && typeof value === 'object' ? value.details : undefined;
      const code = value && typeof value === 'object' && typeof value.code === 'string' ? value.code : `HTTP_${response.status}`;
      const message = value && typeof value === 'object' && typeof value.message === 'string'
        ? value.message
        : `本地桥返回 HTTP ${response.status}`;
      throw new BridgeClientError(code, message, { status: response.status, details });
    }
    return value;
  }

  async request(path, options = {}) {
    return this.#fetch(path, options);
  }

  async health(options = {}) {
    return this.#fetch('/api/v1/health', options);
  }

  async openProject(projectRoot, options = {}) {
    if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
      throw new BridgeClientError('INVALID_PROJECT_ROOT', '项目根目录不能为空', { status: 400 });
    }
    const result = await this.#fetch('/api/v1/projects/open', {
      ...options,
      method: 'POST',
      body: { projectRoot },
    });
    if (result?.projectId) this.projectId = String(result.projectId);
    return result;
  }

  async snapshot(options = {}) {
    const query = this.projectId ? `?projectId=${asQuery(this.projectId)}` : '';
    return this.#fetch(`/api/v1/snapshot${query}`, options);
  }

  async commands(envelope, options = {}) {
    const normalized = this.#normalizeEnvelope(envelope);
    return this.#fetch('/api/v1/commands', {
      ...options,
      method: 'POST',
      body: normalized,
    });
  }

  async recover({ source = 'snapshot', name, ...options } = {}) {
    return this.#fetch('/api/v1/recover', {
      ...options,
      method: 'POST',
      body: { source, ...(name === undefined ? {} : { name }) },
    });
  }

  #normalizeEnvelope(envelope = {}) {
    const commands = Array.isArray(envelope.commands) ? envelope.commands : [];
    if (!commands.length || commands.length > 100) {
      throw new BridgeClientError('INVALID_ENVELOPE', 'commands 必须包含 1–100 条命令', { status: 400 });
    }
    const projectId = String(envelope.projectId || this.projectId);
    const sessionId = String(envelope.sessionId || this.sessionId);
    const actor = String(envelope.actor || this.actor);
    if (!projectId || !sessionId || !actor) {
      throw new BridgeClientError('INVALID_ENVELOPE', 'projectId/sessionId/actor 不能为空', { status: 400 });
    }
    const baseRevision = envelope.baseRevision;
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new BridgeClientError('INVALID_BASE_REVISION', 'baseRevision 必须是非负整数', { status: 400 });
    }
    const commandId = String(envelope.commandId || safeCommandId('agent'));
    if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(commandId)) {
      throw new BridgeClientError('INVALID_COMMAND_ID', 'commandId 包含不安全字符', { status: 400 });
    }
    return { projectId, baseRevision, commandId, actor, sessionId, commands: jsonClone(commands) };
  }

  async mapApplyCommands({ commands, baseRevision, commandId, actor, sessionId, projectId } = {}, options = {}) {
    return this.commands({ commands, baseRevision, commandId, actor, sessionId, projectId }, options);
  }

  async mcp(name, args = {}, options = {}) {
    if (!MCP_TOOL_NAMES.includes(name)) {
      throw new BridgeClientError('UNKNOWN_MCP_TOOL', `未知地图工具: ${name}`, { status: 400 });
    }
    try {
      const value = await this.#fetch('/api/v1/mcp', {
        ...options,
        method: 'POST',
        body: { name, arguments: jsonClone(args) },
      });
      return unwrapToolResponse(value);
    } catch (error) {
      // The fixed HTTP surface predates the MCP route.  Keeping these narrow
      // fallbacks lets an older bridge remain useful without changing the
      // adapter contract; writes still go through /api/v1/commands only.
      if (error?.status !== 404) throw error;
      const fallback = {
        map_get_context: '/api/v1/context',
        map_list_human_updates: '/api/v1/annotations',
        map_next_candidates: '/api/v1/candidates',
        map_validate: '/api/v1/validate',
        map_checkpoint: '/api/v1/checkpoint',
        map_plan_consolidation: '/api/v1/consolidation/plan',
      }[name];
      if (!fallback || name === 'map_ack_human_updates' || name === 'map_apply_commands') throw error;
      return this.#fetch(fallback, { ...options, method: 'POST', body: jsonClone(args) });
    }
  }

  async mapGetContext(args = {}, options = {}) {
    return this.mcp('map_get_context', { ...args, projectId: args.projectId || this.projectId, sessionId: args.sessionId || this.sessionId }, options);
  }

  async mapListHumanUpdates(args = {}, options = {}) {
    return this.mcp('map_list_human_updates', { ...args, projectId: args.projectId || this.projectId, sessionId: args.sessionId || this.sessionId }, options);
  }

  async mapAckHumanUpdates({ ids, summary, baseRevision, commandId, ...rest } = {}, options = {}) {
    const annotationIds = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
    if (!annotationIds.length || typeof summary !== 'string' || !summary.trim()) {
      throw new BridgeClientError('INVALID_ACK', '确认读取需要 ids 和摘要', { status: 400 });
    }
    const missing = annotationIds.filter((id) => !summary.includes(id));
    if (missing.length) {
      throw new BridgeClientError('ACK_MISSING_ID', `摘要缺少标注 ID: ${missing.join(', ')}`, {
        status: 422,
        details: { missing },
      });
    }
    const revision = baseRevision === undefined ? (await this.snapshot(options)).revision : baseRevision;
    return this.mapApplyCommands({
      ...rest,
      commands: [{ op: 'ack_annotations', ids: annotationIds, summary }],
      baseRevision: revision,
      commandId: commandId || safeCommandId('ack'),
      actor: rest.actor || this.actor,
      sessionId: rest.sessionId || this.sessionId,
      projectId: rest.projectId || this.projectId,
    }, options);
  }

  async mapNextCandidates(args = {}, options = {}) {
    const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(12, args.limit)) : 12;
    const normalized = {
      query: typeof args.query === 'string' ? args.query : '',
      currentNodeId: args.currentNodeId === undefined ? null : (args.currentNodeId === null ? null : String(args.currentNodeId)),
      limit,
      includeHistory: args.includeHistory === true,
      ...args,
      projectId: args.projectId || this.projectId,
      sessionId: args.sessionId || this.sessionId,
    };
    normalized.query = typeof normalized.query === 'string' ? normalized.query : '';
    normalized.currentNodeId = normalized.currentNodeId == null ? null : String(normalized.currentNodeId);
    normalized.limit = Number.isInteger(normalized.limit) ? Math.max(1, Math.min(12, normalized.limit)) : 12;
    normalized.includeHistory = normalized.includeHistory === true;
    return this.mcp('map_next_candidates', normalized, options);
  }

  async mapValidate(args = {}, options = {}) {
    return this.mcp('map_validate', { ...args, projectId: args.projectId || this.projectId, sessionId: args.sessionId || this.sessionId }, options);
  }

  async mapCheckpoint(args = {}, options = {}) {
    return this.mcp('map_checkpoint', { ...args, projectId: args.projectId || this.projectId, sessionId: args.sessionId || this.sessionId }, options);
  }

  async mapPlanConsolidation(args = {}, options = {}) {
    return this.mcp('map_plan_consolidation', { ...args, projectId: args.projectId || this.projectId, sessionId: args.sessionId || this.sessionId }, options);
  }

  /**
   * Parse the SSE event endpoint without bringing in EventSource or another
   * runtime dependency.  Every yielded value is already JSON decoded where
   * possible.  The caller owns the AbortController.
   */
  async *events({ since = 0, signal } = {}) {
    const query = `?since=${asQuery(since)}${this.projectId ? `&projectId=${asQuery(this.projectId)}` : ''}`;
    const response = await this.#fetchResponse(`/api/v1/events${query}`, { signal, headers: { Accept: 'text/event-stream' } });
    if (!response.body?.getReader) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const records = buffer.split(/\r?\n\r?\n/);
        buffer = records.pop() || '';
        for (const record of records) {
          const data = record.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (!data) continue;
          try {
            yield JSON.parse(data);
          } catch {
            yield data;
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  async subscribeEvents({ since = 0, signal, onEvent = () => {} } = {}) {
    for await (const event of this.events({ since, signal })) await onEvent(event);
  }

  async #fetchResponse(path, { headers = {}, signal } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('bridge request timeout')), this.timeoutMs);
    const linked = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const requestHeaders = { Accept: 'application/json', ...headers, 'X-Live-Dot-Project': this.projectId, 'X-Live-Dot-Session': this.sessionId };
    if (this.token) requestHeaders.Authorization = `Bearer ${this.token}`;
    let response;
    try {
      response = await this.fetchImpl(this.#url(path), { headers: requestHeaders, credentials: 'include', signal: linked });
    } catch (error) {
      throw new BridgeClientError('BRIDGE_UNAVAILABLE', '无法连接本地桥事件流', { status: 503, cause: error });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const value = await readResponseBody(response);
      throw new BridgeClientError(value?.code || `HTTP_${response.status}`, value?.message || `本地桥返回 HTTP ${response.status}`, { status: response.status, details: value?.details });
    }
    return response;
  }
}

export function projectIdForRoot(projectRoot) {
  const digest = createHash('sha256').update(String(projectRoot)).digest('hex').slice(0, 32);
  return `project:${digest}`;
}

export function commandId(prefix = 'agent') {
  return safeCommandId(prefix);
}
