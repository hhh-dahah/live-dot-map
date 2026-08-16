import { randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isAbsolute, relative, resolve } from 'node:path';
import { BridgeError } from './errors.mjs';
import {
  appendDurable,
  atomicWriteFile,
  checksum,
  cloneJson,
  ensureDirectory,
  exists,
  quarantineCopy,
  readJson,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils.mjs';
import { mapDirectory, mapRelativeDirectory, mapsRoot, resolveActiveMap } from './maps.mjs';

const MAP_DIRECTORY = '.live-dot-map';
const BRIDGE_DIRECTORY = '.bridge';

function validationResult(result) {
  if (result === true || result === undefined) return { ok: true, errors: [] };
  if (result === false) return { ok: false, errors: ['Document validation failed'] };
  return { ok: Boolean(result?.ok), readOnly: Boolean(result?.readOnly), errors: Array.isArray(result?.errors) ? result.errors : [] };
}

function terminalRecord(record) {
  return ['commit', 'external', 'recover', 'checkpoint'].includes(record?.type);
}

function timestampName(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export class ProjectStore {
  #tail = Promise.resolve();
  #records = [];
  #commands = new Map();
  #faultInjector;
  #onEvent;
  #pollIntervalMs;
  #pollTimer;
  #diskSignature;
  #lastOperationQuarantineAt = 0;

  constructor({
    projectRoot,
    shared,
    clock = () => new Date(),
    snapshotEvery = 20,
    faultInjector = () => {},
    onEvent = () => {},
    pollIntervalMs = 250,
    dataDirectory,
    mapName,
    mapDir,
  }) {
    this.projectRoot = projectRoot;
    this.shared = shared;
    this.clock = clock;
    this.snapshotEvery = Math.max(1, Number(snapshotEvery) || 20);
    this.readOnly = false;
    this.#faultInjector = faultInjector;
    this.#onEvent = onEvent;
    // 多地图布局：每张地图一个数据目录（.live-dot-map/maps/<id>/），
    // mapName 是空地图的显示名，mapDir 是写进新文档的项目相对目录。
    this.mapName = typeof mapName === 'string' && mapName ? mapName : undefined;
    this.mapDir = typeof mapDir === 'string' && mapDir ? mapDir : undefined;
    const requestedPollInterval = Number(pollIntervalMs);
    this.#pollIntervalMs = requestedPollInterval <= 0
      ? 0
      : Math.max(50, requestedPollInterval || 250);

    this.dataDirectory = dataDirectory ?? join(projectRoot, MAP_DIRECTORY);
    this.mapPath = join(this.dataDirectory, 'map.json');
    this.bridgeDirectory = join(this.dataDirectory, BRIDGE_DIRECTORY);
    this.walPath = join(this.bridgeDirectory, 'wal.ndjson');
    this.lockPath = join(this.bridgeDirectory, 'write.lock');
    this.snapshotDirectory = join(this.bridgeDirectory, 'snapshots');
    this.backupDirectory = join(this.bridgeDirectory, 'backups');
    this.quarantineDirectory = join(this.bridgeDirectory, 'quarantine');
  }

  static async open(options) {
    let resolved = options;
    // 未显式指定数据目录时按多地图布局解析：maps/ 已存在就打开 active-map
    // 指向的地图目录；否则保持旧的单地图 .live-dot-map/ 行为。
    if (!options?.dataDirectory && options?.projectRoot && (await exists(mapsRoot(options.projectRoot)))) {
      const mapId = await resolveActiveMap(options.projectRoot);
      resolved = {
        ...options,
        dataDirectory: mapDirectory(options.projectRoot, mapId),
        mapDir: options.mapDir ?? mapRelativeDirectory(mapId),
      };
    }
    const store = new ProjectStore(resolved);
    await store.#initialize();
    store.#startExternalMonitor();
    return store;
  }

  #startExternalMonitor() {
    if (this.#pollTimer || this.#pollIntervalMs <= 0) return;
    this.#pollTimer = setInterval(() => {
      this.#pollExternal().catch(() => {
        // 外部写入可能仍在进行中；下一个轮询周期会再次尝试。
      });
    }, this.#pollIntervalMs);
    // 轮询器不能阻止短生命周期的 CLI/MCP 进程退出。
    this.#pollTimer.unref?.();
  }

  async #pollExternal() {
    let metadata;
    try {
      metadata = await stat(this.mapPath);
    } catch {
      return;
    }
    const signature = `${metadata.dev ?? ''}:${metadata.ino ?? ''}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    if (signature === this.#diskSignature) return;
    await this.snapshot();
  }

  async #captureDiskSignature() {
    try {
      const metadata = await stat(this.mapPath);
      this.#diskSignature = `${metadata.dev ?? ''}:${metadata.ino ?? ''}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    } catch {
      this.#diskSignature = undefined;
    }
  }

  async #initialize() {
    await this.#assertSafeStoragePaths();

    return withFileLock(this.lockPath, () => this.#initializeLocked());
  }

  async #assertSafeStoragePaths() {
    const canonicalRoot = await realpath(this.projectRoot);
    const directories = [this.dataDirectory, this.bridgeDirectory, this.snapshotDirectory, this.backupDirectory, this.quarantineDirectory];
    const files = [this.mapPath, this.walPath, this.lockPath];
    const rejectSymlink = async (path) => {
      try {
        if ((await lstat(path)).isSymbolicLink()) {
          throw new BridgeError('SYMLINK_ESCAPE', '本地桥拒绝通过符号链接读写项目数据', { status: 403, details: { path } });
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    };
    for (const path of [...directories, ...files]) await rejectSymlink(path);
    for (const path of directories) {
      await ensureDirectory(path);
      await rejectSymlink(path);
      const canonical = await realpath(path);
      const escaped = relative(canonicalRoot, canonical);
      if (escaped.startsWith('..') || isAbsolute(escaped) || resolve(canonical) === resolve(canonicalRoot)) {
        throw new BridgeError('PATH_ESCAPE', '本地桥数据目录必须位于注册项目内', { status: 403, details: { path } });
      }
    }
  }

  #createEmptyDocument() {
    return this.shared.createEmptyMap({
      name: this.mapName ?? basename(this.projectRoot),
      now: this.clock().toISOString(),
      ...(this.mapDir ? { mapDir: this.mapDir } : {}),
    });
  }

  async #initializeLocked() {
    this.#records = await this.#readWal();
    if (!(await exists(this.mapPath))) {
      const created = await this.#createEmptyDocument();
      await this.#assertValid(created, 'EMPTY_MAP_INVALID');
      await writeJsonAtomic(this.mapPath, created);
    }

    let document;
    try {
      document = await readJson(this.mapPath);
      try {
        await this.#assertValid(document, 'CORRUPT_MAP');
      } catch (error) {
        if (document?.version !== 1 && error instanceof BridgeError && error.details?.readOnly === true) {
          this.readOnly = true;
        } else {
        if (document?.version !== 1 || typeof this.shared.migrateDocument !== 'function') throw error;
        await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.v1-before-migration.json');
        document = await this.shared.migrateDocument(document, { now: this.clock().toISOString() });
        await this.#assertValid(document, 'MIGRATION_INVALID');
        await writeJsonAtomic(this.mapPath, document);
        }
      }
    } catch (error) {
      if (error?.code === 'FILE_TOO_LARGE') {
        throw new BridgeError('MAP_TOO_LARGE', 'map.json 超过 64 MiB 安全上限', { status: 413, details: error.details });
      }
      // 0 字节或纯空白 map.json（例如上次清理/中断留下的空壳）：
      // 视为全新空项目重建，原文件保留到隔离区作为证据；不打断用户进入画布。
      let raw = '';
      try { raw = await readFile(this.mapPath, 'utf8'); } catch { /* 读不到按空处理 */ }
      if (!raw.trim()) {
        await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.empty.json').catch(() => undefined);
        const created = await this.#createEmptyDocument();
        await this.#assertValid(created, 'EMPTY_MAP_INVALID');
        await writeJsonAtomic(this.mapPath, created);
        document = created;
      } else {
        const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.json.corrupt').catch(() => undefined);
        const candidate = await this.#latestRecoverableDocument();
        if (!candidate) {
          if (error instanceof BridgeError) throw error;
          throw new BridgeError('CORRUPT_MAP', 'map.json 无法解析或恢复（损坏文件已隔离，可手工检查）', {
            status: 409,
            cause: error,
            details: { causeMessage: String(error?.message || error), quarantinePath },
          });
        }
        document = candidate.document;
        await writeJsonAtomic(this.mapPath, document);
      }
    }

    this.document = document;
    const latestTerminal = this.#records.filter(terminalRecord).sort((a, b) => (a.revision || 0) - (b.revision || 0)).at(-1);
    this.checksum = latestTerminal?.checksum || checksum(document);
    this.revision = latestTerminal?.revision ?? (Number.isSafeInteger(document.revision) ? document.revision : 0);
    await this.#captureDiskSignature();

    if (this.readOnly) {
      this.checksum = checksum(document);
      return;
    }

    await this.#recoverDanglingPrepare();
    await this.#refreshExternalUnlocked();
    this.#rebuildCommandIndex();
    await this.#ensureDailyBackup();
  }

  async #assertValid(document, code = 'INVALID_DOCUMENT') {
    let result;
    try {
      result = validationResult(await this.shared.validateDocument(document));
    } catch (error) {
      throw new BridgeError(code, 'Map document validation threw an error', {
        status: 422,
        details: { validationError: error.message },
        cause: error,
      });
    }
    if (!result.ok) {
      throw new BridgeError(code, 'Map document failed validation', {
        status: 422,
        details: { errors: result.errors, readOnly: result.readOnly === true },
      });
    }
  }

  async #readWal() {
    if (!(await exists(this.walPath))) return [];
    const metadata = await stat(this.walPath);
    if (metadata.size > 128 * 1024 * 1024) {
      throw new BridgeError('WAL_TOO_LARGE', 'WAL 超过 128 MiB 安全上限，需要人工恢复', { status: 413, details: { size: metadata.size } });
    }
    const content = await readFile(this.walPath, 'utf8');
    const lines = content.split('\n');
    const records = [];
    let invalidAt = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        invalidAt = index;
        break;
      }
    }
    if (invalidAt >= 0) {
      const invalid = lines.slice(invalidAt).join('\n');
      await quarantineCopy(this.walPath, this.quarantineDirectory, 'wal.invalid-tail', invalid);
      const repaired = records.length ? `${records.map((item) => JSON.stringify(item)).join('\n')}\n` : '';
      await atomicWriteFile(this.walPath, repaired);
    }
    return records;
  }

  async #latestRecoverableDocument() {
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];
      if (!record?.document) continue;
      try {
        await this.#assertValid(record.document, 'INVALID_WAL_DOCUMENT');
        if (checksum(record.document) === record.checksum) return record;
      } catch {
        // Continue to an older valid WAL image.
      }
    }
    return null;
  }

  async #appendRecord(record) {
    await appendDurable(this.walPath, JSON.stringify(record));
    this.#records.push(record);
  }

  async #recoverDanglingPrepare() {
    const committed = new Set(this.#records.filter((item) => item.type === 'commit').map((item) => item.commandId));
    const terminalRevision = this.#records.filter(terminalRecord).reduce((max, item) => Math.max(max, item.revision || 0), 0);
    const dangling = this.#records
      .filter((item) => item.type === 'prepare' && !committed.has(item.commandId) && item.revision > terminalRevision)
      .sort((a, b) => a.revision - b.revision);

    for (const prepare of dangling) {
      await this.#assertValid(prepare.document, 'INVALID_WAL_DOCUMENT');
      if (checksum(prepare.document) !== prepare.checksum) {
        throw new BridgeError('WAL_CHECKSUM_MISMATCH', 'Prepared WAL document checksum does not match', {
          status: 409,
          details: { commandId: prepare.commandId },
        });
      }
      const disk = await readJson(this.mapPath);
      const diskChecksum = checksum(disk);
      if (diskChecksum !== prepare.checksum) {
        if (prepare.baseChecksum && diskChecksum !== prepare.baseChecksum) {
          const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.recovery-conflict.json');
          throw new BridgeError('RECOVERY_CONFLICT', 'A concurrent external change conflicts with the prepared WAL command', {
            status: 409,
            details: { commandId: prepare.commandId, quarantinePath },
          });
        }
        await writeJsonAtomic(this.mapPath, prepare.document);
      }
      await this.#appendRecord({
        type: 'commit',
        recovered: true,
        commandId: prepare.commandId,
        requestDigest: prepare.requestDigest,
        revision: prepare.revision,
        checksum: prepare.checksum,
        timestamp: this.clock().toISOString(),
      });
      this.document = cloneJson(prepare.document);
      this.checksum = prepare.checksum;
      this.revision = prepare.revision;
    }
  }

  #rebuildCommandIndex() {
    const prepares = new Map(this.#records.filter((item) => item.type === 'prepare').map((item) => [item.commandId, item]));
    this.#commands.clear();
    for (const commit of this.#records.filter((item) => item.type === 'commit')) {
      const prepare = prepares.get(commit.commandId);
      if (!prepare) continue;
      this.#commands.set(commit.commandId, {
        revision: commit.revision,
        checksum: commit.checksum,
        requestDigest: prepare.requestDigest,
      });
    }
  }

  async #refreshExternalUnlocked() {
    let disk;
    try {
      disk = await readJson(this.mapPath);
      await this.#assertValid(disk, 'CORRUPT_MAP');
    } catch (error) {
      if (error?.code === 'FILE_TOO_LARGE') {
        throw new BridgeError('MAP_TOO_LARGE', '外部 map.json 超过 64 MiB 安全上限', { status: 413, details: error.details });
      }
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.external-corrupt.json').catch(() => undefined);
      if (error instanceof BridgeError) {
        error.details = { ...error.details, quarantinePath };
        throw error;
      }
      throw new BridgeError('CORRUPT_MAP', 'External map.json change is not valid JSON', {
        status: 409,
        details: { quarantinePath },
        cause: error,
      });
    }
    const diskChecksum = checksum(disk);
    if (diskChecksum === this.checksum) {
      this.document = cloneJson(disk);
      return false;
    }
    if (Number.isSafeInteger(disk.revision) && disk.revision <= this.revision) {
      const previous = [...this.#records].reverse().find((record) => record.document && record.checksum === this.checksum)?.document;
      const recoverable = previous || (this.document && checksum(this.document) === this.checksum ? this.document : null);
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.stale-external.json');
      if (recoverable) await writeJsonAtomic(this.mapPath, recoverable);
      throw new BridgeError('EXTERNAL_REVISION_CONFLICT', 'External map.json did not advance the revision', {
        status: 409,
        details: { currentRevision: this.revision, externalRevision: disk.revision, quarantinePath, restored: Boolean(recoverable) },
      });
    }
    const revision = Math.max(this.revision + 1, Number.isSafeInteger(disk.revision) ? disk.revision : 0);
    const record = {
      type: 'external',
      revision,
      checksum: diskChecksum,
      document: disk,
      timestamp: this.clock().toISOString(),
    };
    await this.#appendRecord(record);
    this.document = cloneJson(disk);
    this.checksum = diskChecksum;
    this.revision = revision;
    this.#emit({ type: 'external', revision, checksum: diskChecksum });
    return true;
  }

  #exclusive(operation) {
    const locked = () => withFileLock(this.lockPath, operation).catch((error) => {
      if (error?.code === 'LOCK_TIMEOUT') {
        throw new BridgeError('PROJECT_BUSY', 'Another local bridge process is writing this project', {
          status: 503,
          cause: error,
        });
      }
      throw error;
    });
    const running = this.#tail.then(locked, locked);
    this.#tail = running.catch(() => {});
    return running;
  }

  async #reloadState() {
    const previousRevision = this.revision;
    const previousChecksum = this.checksum;
    if (this.readOnly) {
      const disk = await readJson(this.mapPath);
      const result = validationResult(await this.shared.validateDocument(disk));
      if (result.ok || result.readOnly !== true) {
        throw new BridgeError('READ_ONLY_SCHEMA_CHANGED', '只读打开期间 schema 状态发生变化，请重新打开项目', { status: 409 });
      }
      this.document = cloneJson(disk);
      this.revision = Number.isSafeInteger(disk.revision) ? disk.revision : 0;
      this.checksum = checksum(disk);
      await this.#captureDiskSignature();
      return;
    }
    this.#records = await this.#readWal();
    let disk;
    try {
      disk = await readJson(this.mapPath);
      await this.#assertValid(disk, 'CORRUPT_MAP');
    } catch (error) {
      if (error?.code === 'FILE_TOO_LARGE') {
        throw new BridgeError('MAP_TOO_LARGE', 'map.json 超过 64 MiB 安全上限', { status: 413, details: error.details });
      }
      // 运行中被清空（0 字节/纯空白）：重建空地图而不是每轮轮询隔离垃圾文件；
      // 若 WAL 有提交记录，#refreshExternalUnlocked 会把历史文档恢复回来。
      let raw = '';
      try { raw = await readFile(this.mapPath, 'utf8'); } catch { /* 读不到按空处理 */ }
      if (!raw.trim()) {
        const created = await this.#createEmptyDocument();
        await this.#assertValid(created, 'EMPTY_MAP_INVALID');
        await writeJsonAtomic(this.mapPath, created);
        disk = created;
      } else {
        // 隔离节流：同一种损坏持续存在时，60 秒内只隔离一次，避免轮询风暴写满磁盘。
        let quarantinePath;
        const nowMs = this.clock().getTime();
        if (!this.#lastOperationQuarantineAt || nowMs - this.#lastOperationQuarantineAt > 60_000) {
          this.#lastOperationQuarantineAt = nowMs;
          quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.operation-corrupt.json').catch(() => undefined);
        }
        if (error instanceof BridgeError) {
          error.details = { ...error.details, quarantinePath };
          throw error;
        }
        throw new BridgeError('CORRUPT_MAP', 'map.json is not valid JSON', {
          status: 409,
          details: { quarantinePath },
          cause: error,
        });
      }
    }
    const latestTerminal = this.#records.filter(terminalRecord).sort((a, b) => (a.revision || 0) - (b.revision || 0)).at(-1);
    this.revision = latestTerminal?.revision ?? (Number.isSafeInteger(disk.revision) ? disk.revision : 0);
    this.checksum = latestTerminal?.checksum || checksum(disk);
    await this.#recoverDanglingPrepare();
    const externalChanged = await this.#refreshExternalUnlocked();
    this.#rebuildCommandIndex();
    await this.#captureDiskSignature();

    // 其他进程可能在本桥读取前已经追加共享 WAL。此时
    // refreshExternalUnlocked 会看到相同校验和并抑制通知，因此在重载期间
    // 内存 revision/校验和前进时补发一次事件。
    if (!externalChanged && (this.revision !== previousRevision || this.checksum !== previousChecksum)) {
      this.#emit({ type: 'external', revision: this.revision, checksum: this.checksum });
    }
  }

  #emit(event) {
    try {
      this.#onEvent(event);
    } catch {
      // Observers must never make a durable commit appear to fail.
    }
  }

  async snapshot() {
    return this.#exclusive(async () => {
      await this.#reloadState();
      return {
        revision: this.revision,
        checksum: this.checksum,
        readOnly: this.readOnly,
        document: cloneJson(this.document),
      };
    });
  }

  async close() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = undefined;
    }
    await this.#tail.catch(() => {});
  }

  async execute(request) {
    return this.#exclusive(async () => {
      await this.#reloadState();
      if (this.readOnly) throw new BridgeError('READ_ONLY_SCHEMA', '未知 schema 版本只能只读打开', { status: 409 });

      const { commandId, baseRevision } = request || {};
      const hasEnvelope = Array.isArray(request?.commands);
      const command = request?.command;
      const payload = hasEnvelope ? {
        projectId: request.projectId,
        baseRevision,
        commandId,
        actor: request.actor,
        sessionId: request.sessionId,
        commands: request.commands,
      } : command;

      if (typeof commandId !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(commandId)) {
        throw new BridgeError('INVALID_COMMAND_ID', 'commandId must be 8-128 safe characters', { status: 400 });
      }
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
        throw new BridgeError('INVALID_BASE_REVISION', 'baseRevision must be a non-negative integer', { status: 400 });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new BridgeError('INVALID_COMMAND', 'command must be a JSON object', { status: 400 });
      }
      const requestDigest = checksum(payload);
      const previous = this.#commands.get(commandId);
      if (previous) {
        if (previous.requestDigest !== requestDigest) {
          throw new BridgeError('COMMAND_ID_REUSE', 'commandId was already used for a different command', {
            status: 409,
            details: { commandId, revision: previous.revision },
          });
        }
        return { ...previous, idempotent: true, document: cloneJson(this.document) };
      }
      let touches = [];
      if (hasEnvelope) touches = this.shared.envelopeTouches(payload);
      if (baseRevision !== this.revision) {
        const laterTouches = this.#records
          .filter((record) => record.type === 'prepare' && record.revision > baseRevision)
          .flatMap((record) => Array.isArray(record.touches) ? record.touches : ['*']);
        const overlaps = (left, right) => left === '*' || right === '*'
          || left === right
          || (left.endsWith('/*') && right.startsWith(left.slice(0, -1)))
          || (right.endsWith('/*') && left.startsWith(right.slice(0, -1)));
        const conflicts = touches.filter((path) => laterTouches.some((changed) => overlaps(path, changed)));
        if (!hasEnvelope || baseRevision > this.revision || conflicts.length) {
          throw new BridgeError('REVISION_CONFLICT', 'baseRevision conflicts with newer changes', {
            status: 409,
            details: {
              baseRevision,
              currentRevision: this.revision,
              currentChecksum: this.checksum,
              conflictPaths: conflicts.length ? conflicts : laterTouches,
              incomingCommands: hasEnvelope ? cloneJson(request.commands) : [cloneJson(command)],
              currentDocument: cloneJson(this.document),
            },
          });
        }
      }

      let next;
      try {
        next = hasEnvelope
          ? await this.shared.applyEnvelope(cloneJson(this.document), { ...cloneJson(payload), baseRevision: this.revision }, { now: this.clock().toISOString() })
          : await this.shared.applyCommand(cloneJson(this.document), cloneJson(command), {
            actor: request?.actor || 'human',
            revision: this.revision + 1,
            now: this.clock().toISOString(),
          });
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError(error?.code || 'COMMAND_REJECTED', error?.message || 'Command was rejected', {
          status: error?.status || 422,
          details: error?.details,
          cause: error,
        });
      }
      await this.#assertValid(next);

      const revision = this.revision + 1;
      const nextChecksum = checksum(next);
      const prepare = {
        type: 'prepare',
        commandId,
        requestDigest,
        baseRevision,
        baseChecksum: this.checksum,
        touches,
        revision,
        checksum: nextChecksum,
        document: next,
        timestamp: this.clock().toISOString(),
      };
      await this.#appendRecord(prepare);
      await this.#faultInjector('afterWalPrepare', { prepare, store: this });
      await writeJsonAtomic(this.mapPath, next);
      await this.#faultInjector('afterMapReplace', { prepare, store: this });
      const commit = {
        type: 'commit',
        commandId,
        requestDigest,
        revision,
        checksum: nextChecksum,
        timestamp: this.clock().toISOString(),
      };
      await this.#appendRecord(commit);

      this.document = cloneJson(next);
      this.checksum = nextChecksum;
      this.revision = revision;
      this.#commands.set(commandId, { revision, checksum: nextChecksum, requestDigest });
      if (revision % this.snapshotEvery === 0) {
        await this.#writeSnapshot('automatic');
        await this.#compactWal();
      }
      this.#emit({ type: 'command', commandId, revision, checksum: nextChecksum, actor: request.actor, sessionId: request.sessionId });
      return { revision, checksum: nextChecksum, idempotent: false, document: cloneJson(next) };
    });
  }

  async createSnapshot() {
    return this.#exclusive(async () => {
      await this.#reloadState();
      if (this.readOnly) throw new BridgeError('READ_ONLY_SCHEMA', '未知 schema 版本不能创建快照', { status: 409 });
      return this.#writeSnapshot('manual');
    });
  }

  async #writeSnapshot(reason) {
    const envelope = {
      revision: this.revision,
      checksum: this.checksum,
      createdAt: this.clock().toISOString(),
      reason,
      document: this.document,
    };
    const path = join(this.snapshotDirectory, `rev-${String(this.revision).padStart(12, '0')}-${timestampName(this.clock())}.json`);
    await writeJsonAtomic(path, envelope);
    await this.#pruneJsonDirectory(this.snapshotDirectory, 20);
    return { path, revision: this.revision, checksum: this.checksum };
  }

  async #compactWal() {
    const committed = new Set(this.#records.filter((record) => record.type === 'commit').map((record) => record.commandId));
    const compacted = this.#records
      .filter((record) => record.type !== 'checkpoint')
      .map((record) => {
        if (record.type !== 'prepare' || !committed.has(record.commandId) || record.document === undefined) return record;
        const { document, ...receipt } = record;
        return receipt;
      });
    compacted.push({
      type: 'checkpoint',
      revision: this.revision,
      checksum: this.checksum,
      document: cloneJson(this.document),
      timestamp: this.clock().toISOString(),
    });
    const content = `${compacted.map((record) => JSON.stringify(record)).join('\n')}\n`;
    await atomicWriteFile(this.walPath, content);
    this.#records = compacted;
    this.#rebuildCommandIndex();
  }

  async #pruneJsonDirectory(directory, keep) {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    await Promise.all(entries.slice(0, Math.max(0, entries.length - keep)).map((name) => unlink(join(directory, name))));
  }

  async #ensureDailyBackup() {
    const day = this.clock().toISOString().slice(0, 10);
    const path = join(this.backupDirectory, `${day}.json`);
    if (!(await exists(path))) {
      await writeJsonAtomic(path, {
        revision: this.revision,
        checksum: this.checksum,
        createdAt: this.clock().toISOString(),
        document: this.document,
      });
    }
    await this.#pruneJsonDirectory(this.backupDirectory, 7);
    return path;
  }

  async recover({ source = 'snapshot', name } = {}) {
    return this.#exclusive(async () => {
      await this.#reloadState();
      if (this.readOnly) throw new BridgeError('READ_ONLY_SCHEMA', '未知 schema 版本不能执行恢复写入', { status: 409 });
      if (!['snapshot', 'backup'].includes(source)) {
        throw new BridgeError('INVALID_RECOVERY_SOURCE', 'Recovery source must be snapshot or backup', { status: 400 });
      }
      const directory = source === 'snapshot' ? this.snapshotDirectory : this.backupDirectory;
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort();
      const selected = name === undefined ? entries.at(-1) : basename(name);
      if (!selected || !entries.includes(selected) || selected !== (name === undefined ? selected : name)) {
        throw new BridgeError('RECOVERY_IMAGE_NOT_FOUND', 'Requested recovery image was not found', {
          status: 404,
          details: { source, name },
        });
      }
      const envelope = await readJson(join(directory, selected));
      await this.#assertValid(envelope.document, 'INVALID_RECOVERY_IMAGE');
      if (checksum(envelope.document) !== envelope.checksum) {
        throw new BridgeError('RECOVERY_CHECKSUM_MISMATCH', 'Recovery image checksum does not match', { status: 409 });
      }

      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, 'map.before-recovery.json');
      const revision = this.revision + 1;
      const commandId = `recover:${randomUUID()}`;
      const recoveredDocument = cloneJson(envelope.document);
      if (Number.isSafeInteger(recoveredDocument.revision)) recoveredDocument.revision = revision;
      if (typeof recoveredDocument.updatedAt === 'string') recoveredDocument.updatedAt = this.clock().toISOString();
      await this.#assertValid(recoveredDocument, 'INVALID_RECOVERY_IMAGE');
      const recoveredChecksum = checksum(recoveredDocument);
      const prepare = {
        type: 'prepare',
        operation: 'recover',
        commandId,
        requestDigest: checksum({ source, selected, checksum: envelope.checksum }),
        baseRevision: this.revision,
        revision,
        checksum: recoveredChecksum,
        document: recoveredDocument,
        timestamp: this.clock().toISOString(),
      };
      await this.#appendRecord(prepare);
      await writeJsonAtomic(this.mapPath, recoveredDocument);
      await this.#appendRecord({
        type: 'commit',
        operation: 'recover',
        commandId,
        requestDigest: prepare.requestDigest,
        revision,
        checksum: recoveredChecksum,
        timestamp: this.clock().toISOString(),
      });
      this.document = cloneJson(recoveredDocument);
      this.checksum = recoveredChecksum;
      this.revision = revision;
      this.#rebuildCommandIndex();
      await this.#writeSnapshot('recovery');
      this.#emit({ type: 'recover', revision, checksum: this.checksum, source, selected });
      return { revision, checksum: this.checksum, source, selected, quarantinePath, document: cloneJson(this.document) };
    });
  }
}
