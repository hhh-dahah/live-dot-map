import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const deploy = join(root, '.deploy');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const files = ['app.html', 'livedot.mjs', 'agent-kit/setup.md', 'agent-kit/README.md', 'agent-kit/map.template.json'];
const hashes = {};
for (const relative of files) {
  const bytes = await readFile(join(deploy, relative));
  hashes[relative] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
try {
  const seaBytes = await readFile(join(deploy, 'livedot-bridge-win-x64.exe'));
  hashes['livedot-bridge-win-x64.exe'] = { bytes: seaBytes.byteLength, sha256: createHash('sha256').update(seaBytes).digest('hex') };
} catch { /* 非 Windows 开发环境暂不生成 SEA */ }
const manifest = {
  product: 'live-dot-map', version: pkg.version, channel: 'rc', schema: 2,
  generatedAt: new Date().toISOString(), signed: false, deployed: false,
  runtime: 'node20-bundle', files: hashes,
  distribution: { internal: 'GitHub Release', publicWindows: 'Microsoft Store MSIX (pending)' },
};
await writeFile(join(deploy, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const components = Object.entries(lock.packages ?? {})
  .filter(([path]) => path.startsWith('node_modules/'))
  .map(([path, value]) => ({ type: 'library', name: path.slice('node_modules/'.length), version: value.version, scope: 'build' }));
const sbom = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, metadata: { component: { type: 'application', name: pkg.name, version: pkg.version } }, components };
await writeFile(join(deploy, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, version: pkg.version, files: Object.keys(hashes), components: components.length }));
