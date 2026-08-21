import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BridgeError } from './errors.mjs';
import { canonicalDirectory } from './fs-utils.mjs';
import { runtimePaths } from './runtime-state.mjs';

const SCHEMA_VERSION = 1;

function handleValue() {
  return `ph_${randomBytes(24).toString('base64url')}`;
}

async function atomicWrite(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => undefined);
}

export class ProjectRegistry {
  constructor({ filePath, entries = [], canonicalize = canonicalDirectory } = {}) {
    this.filePath = filePath;
    this.canonicalize = canonicalize;
    this.byHandle = new Map(entries.map((entry) => [entry.projectHandle, entry]));
    this.byRoot = new Map(entries.map((entry) => [entry.projectRoot, entry]));
    this.writeQueue = Promise.resolve();
  }

  static async open({ runtimeStateDir, filePath = runtimePaths(runtimeStateDir).projects, canonicalize } = {}) {
    let entries = [];
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (parsed?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.projects)) throw new Error('invalid shape');
      entries = parsed.projects;
      for (const entry of entries) {
        if (!/^ph_[A-Za-z0-9_-]{32}$/.test(entry?.projectHandle) || typeof entry?.projectRoot !== 'string') {
          throw new Error('invalid project entry');
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new BridgeError('PROJECT_REGISTRY_CORRUPT', 'Project authorization registry is unreadable or invalid', { cause: error });
      }
    }
    return new ProjectRegistry({ filePath, entries, canonicalize });
  }

  async register(requestedRoot) {
    const projectRoot = await this.canonicalize(requestedRoot);
    await this.refresh();
    const existing = this.byRoot.get(projectRoot);
    if (existing) return { ...existing };
    const entry = {
      projectHandle: handleValue(),
      projectRoot,
      createdAt: new Date().toISOString(),
    };
    this.byHandle.set(entry.projectHandle, entry);
    this.byRoot.set(projectRoot, entry);
    try {
      await this.persist();
    } catch (error) {
      this.byHandle.delete(entry.projectHandle);
      this.byRoot.delete(projectRoot);
      throw error;
    }
    return { ...entry };
  }

  resolve(projectHandle) {
    const entry = this.byHandle.get(String(projectHandle));
    if (!entry) throw new BridgeError('PROJECT_HANDLE_NOT_FOUND', 'Project handle is unknown or no longer authorized', { status: 404 });
    return { ...entry };
  }

  list() {
    return [...this.byHandle.values()].map((entry) => ({ ...entry }));
  }

  async refresh() {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw new BridgeError('PROJECT_REGISTRY_CORRUPT', 'Project authorization registry is unreadable or invalid', { cause: error });
    }
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.projects)) {
      throw new BridgeError('PROJECT_REGISTRY_CORRUPT', 'Project authorization registry has an invalid shape');
    }
    for (const entry of parsed.projects) {
      if (!/^ph_[A-Za-z0-9_-]{32}$/.test(entry?.projectHandle) || typeof entry?.projectRoot !== 'string') {
        throw new BridgeError('PROJECT_REGISTRY_CORRUPT', 'Project authorization registry contains an invalid entry');
      }
      this.byHandle.set(entry.projectHandle, entry);
      this.byRoot.set(entry.projectRoot, entry);
    }
  }

  async persist() {
    const payload = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, projects: this.list() }, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(() => atomicWrite(this.filePath, payload));
    await this.writeQueue;
  }
}
