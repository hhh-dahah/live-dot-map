import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [
  '.deploy/app.html', '.deploy/livedot.mjs', '.deploy/agent-kit/setup.md',
  '.deploy/agent-kit/map.template.json', '.deploy/agent-kit/README.md',
  '.deploy/release-manifest.json', '.deploy/sbom.cdx.json',
  'LICENSE', 'NOTICE', 'SECURITY.md', 'README.md',
];
for (const relative of files) {
  const path = join(root, relative);
  await access(path, constants.F_OK);
  const content = await readFile(path);
  assert.ok(content.length > 100, `${relative} is empty`);
  if (relative.endsWith('.html')) assert.match(content.toString('utf8'), /Content-Security-Policy/);
}
const app = await readFile(join(root, '.deploy/app.html'), 'utf8');
const runtime = await readFile(join(root, '.deploy/livedot.mjs'), 'utf8');
const manifest = JSON.parse(await readFile(join(root, '.deploy/release-manifest.json'), 'utf8'));
const sbom = JSON.parse(await readFile(join(root, '.deploy/sbom.cdx.json'), 'utf8'));
assert.equal(manifest.schema, 2);
assert.equal(manifest.signed, false);
assert.equal(sbom.bomFormat, 'CycloneDX');
assert.match(app, /first-map-guide/);
assert.match(app, /data-dotmap-bridge="v2"/);
assert.match(runtime, /map_next_candidates/);
if (manifest.files['livedot-bridge-win-x64.exe']) {
  const sea = join(root, '.deploy/livedot-bridge-win-x64.exe');
  await access(sea, constants.F_OK);
  assert.ok((await readFile(sea)).length > 1_000_000, 'SEA bridge executable is unexpectedly small');
  assert.match(JSON.stringify(manifest.files['livedot-bridge-win-x64.exe']), /^[\s\S]*sha256/);
  await new Promise((resolveRun, reject) => {
    const child = spawn(sea, ['help'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`SEA help failed (${code}): ${stderr}`)));
  });
}
const hashes = Object.fromEntries(files.map((relative) => [relative, createHash('sha256').update(readFileSync(join(root, relative))).digest('hex')]));
console.log(JSON.stringify({ ok: true, files: hashes }, null, 2));
