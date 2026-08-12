import { createHash, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Network is intentionally opt-in.  A release can replace/add entries with
 * hashes from Node's official SHASUMS file; an entry without a hash is never
 * downloaded.  This keeps a fresh checkout safe and usable offline.
 */
export const PORTABLE_NODE_MANIFEST = Object.freeze({
  'win32-x64': Object.freeze({ version: '20.12.2', archive: 'node-v20.12.2-win-x64.zip', url: 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-x64.zip', sha256: '66dda1717cae30a13be6bb17ad96ee54b69f2c23c85acd9c3299b095fa26b452' }),
  'win32-arm64': Object.freeze({ version: '20.12.2', archive: 'node-v20.12.2-win-arm64.zip', url: 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-arm64.zip', sha256: '010d488af3adad98e44b2d3f61afb7e3d87b5a620f7a406fe75ab0909b72e7ca' }),
  'darwin-x64': Object.freeze({ version: '20.12.2', archive: 'node-v20.12.2-darwin-x64.tar.gz', url: 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-darwin-x64.tar.gz', sha256: 'cd5e9a80a38ccffc036a87b232a5402339c7bf8fa9a494ae0731a1a671687718' }),
  'darwin-arm64': Object.freeze({ version: '20.12.2', archive: 'node-v20.12.2-darwin-arm64.tar.gz', url: 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-darwin-arm64.tar.gz', sha256: '98eb624b52efec2530079e1d11296ec0ac20771b94b087d21649250339cf5332' }),
  'linux-x64': Object.freeze({ version: '20.12.2', archive: 'node-v20.12.2-linux-x64.tar.xz', url: 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-linux-x64.tar.xz', sha256: '595272130310cbe12301430756f23d153f7ab95d00174c02adc11a2e3703d183' }),
  'linux-arm64': Object.freeze({ version: '20.12.2', archive: 'node-v20.12.2-linux-arm64.tar.xz', url: 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-linux-arm64.tar.xz', sha256: 'b5fc7983fb9506b8c3de53dfa85ff63f9f49cedc94984e29e4c89328536ba4b9' }),
});

function manifestKey(platform = process.platform, arch = process.arch) {
  const normalizedArch = arch === 'ia32' ? 'x86' : arch;
  return `${platform}-${normalizedArch}`;
}

export function portableManifestFor({ platform = process.platform, arch = process.arch, manifest = PORTABLE_NODE_MANIFEST } = {}) {
  return manifest[manifestKey(platform, arch)] || null;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyPortableNodeArchive(bytes, expectedSha256) {
  if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) throw new TypeError('archive must be bytes');
  const expected = String(expectedSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return { ok: false, reason: 'missing-or-invalid-sha256', actual: sha256Hex(bytes) };
  const actual = sha256Hex(bytes);
  const ok = timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  return { ok, actual, expected };
}

export async function downloadPortableNode({
  destination,
  platform = process.platform,
  arch = process.arch,
  manifest = PORTABLE_NODE_MANIFEST,
  allowDownload = false,
  fetchImpl = globalThis.fetch,
  maxBytes = 200 * 1024 * 1024,
} = {}) {
  const entry = portableManifestFor({ platform, arch, manifest });
  if (!entry) return { ok: false, skipped: true, reason: `no-manifest:${manifestKey(platform, arch)}` };
  if (!allowDownload) return { ok: false, skipped: true, reason: 'offline-by-default', version: entry.version };
  if (typeof fetchImpl !== 'function') throw new Error('没有 fetch，不能下载便携 Node');
  if (!entry.sha256) throw new Error('便携 Node 清单缺少 SHA-256，拒绝下载');
  const response = await fetchImpl(entry.url, { redirect: 'error' });
  if (!response?.ok) throw new Error(`便携 Node 下载失败: HTTP ${response?.status ?? 'unknown'}`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) throw new Error('便携 Node 压缩包大小不在允许范围');
  const verification = verifyPortableNodeArchive(buffer, entry.sha256);
  if (!verification.ok) throw new Error(`便携 Node SHA-256 校验失败（实际 ${verification.actual}）`);
  const target = resolve(destination);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.part-${process.pid}`;
  try {
    await writeFile(temp, buffer, { flag: 'wx' });
    await rename(temp, target);
    if (platform !== 'win32') await chmod(target, 0o755).catch(() => {});
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return { ok: true, path: target, bytes: buffer.byteLength, sha256: verification.actual, version: entry.version };
}

export function runtimePlan({ nodeVersion = process.versions.node, offline = true, platform = process.platform, arch = process.arch } = {}) {
  const [major, minor] = String(nodeVersion).split('.').map(Number);
  if (Number.isFinite(major) && (major > 20 || (major === 20 && minor >= 12))) return { use: 'system-node', version: nodeVersion, offline };
  const entry = portableManifestFor({ platform, arch });
  return {
    use: entry ? 'portable-node' : 'manual-intervention',
    version: entry?.version || null,
    archive: entry?.archive || null,
    download: !offline,
    reason: offline ? 'offline-by-default' : undefined,
  };
}
