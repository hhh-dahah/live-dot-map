import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BridgeError } from './errors.mjs';
import { runtimePaths } from './runtime-state.mjs';

const SCHEMA_VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;

const secret = () => randomBytes(32).toString('base64url');
const digest = (value) => createHash('sha256').update(String(value)).digest('base64url');

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}

export class SessionStore {
  constructor({ filePath, sessions = [], clock = () => new Date(), ttlMs = 7 * DAY, persistIntervalMs = 60_000, maxSessions = 64 } = {}) {
    this.filePath = filePath;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.persistIntervalMs = persistIntervalMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map(sessions.map((session) => [session.sessionIdHash, session]));
    this.lastPersistedAt = 0;
    this.dirty = false;
    this.writeQueue = Promise.resolve();
    this.reconnectAttempts = new Map();
    this.prune();
  }

  static async open(options = {}) {
    const filePath = options.filePath || runtimePaths(options.runtimeStateDir).sessions;
    let sessions = [];
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (parsed?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.sessions)) throw new Error('invalid shape');
      sessions = parsed.sessions;
      for (const session of sessions) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(session?.sessionIdHash) || typeof session?.csrfToken !== 'string' || !Array.isArray(session?.projectHandles)) {
          throw new Error('invalid session');
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new BridgeError('SESSION_STORE_CORRUPT', 'Browser session store is unreadable or invalid', { cause: error });
    }
    return new SessionStore({ ...options, filePath, sessions });
  }

  now() { return this.clock().getTime(); }

  create({ projectHandle = null } = {}) {
    const sessionId = secret();
    const reconnectTicket = secret();
    const now = this.now();
    const record = {
      schemaVersion: SCHEMA_VERSION,
      sessionIdHash: digest(sessionId),
      csrfToken: secret(),
      projectHandles: projectHandle ? [projectHandle] : [],
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      reconnectTicketHash: digest(reconnectTicket),
      revokedAt: null,
    };
    this.sessions.set(record.sessionIdHash, record);
    this.prune();
    this.dirty = true;
    return { sessionId, reconnectTicket, record: structuredClone(record) };
  }

  get(sessionId, { touch = true } = {}) {
    const record = this.sessions.get(digest(sessionId));
    if (!record || record.revokedAt) return null;
    const now = this.now();
    if (Date.parse(record.expiresAt) <= now) {
      this.sessions.delete(record.sessionIdHash);
      this.dirty = true;
      return null;
    }
    if (touch) {
      record.lastSeenAt = new Date(now).toISOString();
      record.expiresAt = new Date(now + this.ttlMs).toISOString();
      this.dirty = true;
      void this.persistIfDue();
    }
    return structuredClone(record);
  }

  authorize(sessionId, projectHandle) {
    const key = digest(sessionId);
    const record = this.sessions.get(key);
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= this.now()) return null;
    if (!record.projectHandles.includes(projectHandle)) record.projectHandles.push(projectHandle);
    record.lastSeenAt = new Date(this.now()).toISOString();
    record.expiresAt = new Date(this.now() + this.ttlMs).toISOString();
    const reconnectTicket = secret();
    record.reconnectTicketHash = digest(reconnectTicket);
    this.dirty = true;
    return { ...structuredClone(record), reconnectTicket };
  }

  reconnect({ reconnectTicket, projectHandle, peer = 'loopback' }) {
    const now = this.now();
    const rateKey = `${peer}|${projectHandle}`;
    const recent = (this.reconnectAttempts.get(rateKey) || []).filter((at) => now - at < 60_000);
    if (recent.length >= 5) throw new BridgeError('RECONNECT_RATE_LIMITED', 'Too many reconnect attempts', { status: 429 });
    recent.push(now);
    this.reconnectAttempts.set(rateKey, recent);
    const ticketHash = digest(reconnectTicket);
    const current = [...this.sessions.values()].find((record) => record.reconnectTicketHash === ticketHash && !record.revokedAt);
    if (!current || Date.parse(current.expiresAt) <= now || !current.projectHandles.includes(projectHandle)) {
      throw new BridgeError('INVALID_RECONNECT_TICKET', 'Reconnect ticket is invalid or expired', { status: 401 });
    }
    current.revokedAt = new Date(now).toISOString();
    const created = this.create({ projectHandle });
    for (const handle of current.projectHandles) {
      if (!created.record.projectHandles.includes(handle)) created.record.projectHandles.push(handle);
    }
    const stored = this.sessions.get(created.record.sessionIdHash);
    stored.projectHandles = [...created.record.projectHandles];
    this.dirty = true;
    return created;
  }

  prune() {
    const now = this.now();
    for (const [key, record] of this.sessions) {
      if (record.revokedAt || Date.parse(record.expiresAt) <= now) this.sessions.delete(key);
    }
    const ordered = [...this.sessions.values()].sort((a, b) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt));
    while (ordered.length > this.maxSessions) {
      const oldest = ordered.shift();
      this.sessions.delete(oldest.sessionIdHash);
    }
  }

  async persistIfDue() {
    if (!this.dirty || this.now() - this.lastPersistedAt < this.persistIntervalMs) return false;
    await this.flush();
    return true;
  }

  async flush() {
    this.prune();
    const payload = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: [...this.sessions.values()] }, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(() => atomicWrite(this.filePath, payload));
    await this.writeQueue;
    this.lastPersistedAt = this.now();
    this.dirty = false;
  }
}

export { digest as hashSessionSecret };
