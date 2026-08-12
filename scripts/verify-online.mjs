import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sources = (process.env.LIVEDOT_ONLINE_SOURCES || [
  'https://livedotmap.top',
  'https://app.live-dot-map.workers.dev',
  'https://test-d0gims26n5c5ce096-1425841737.tcloudbaseapp.com',
].join('\n')).split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
const files = ['app.html', 'livedot.mjs', 'agent-kit/setup.md'];
const local = Object.fromEntries(await Promise.all(files.map(async (file) => {
  const bytes = await readFile(join(root, '.deploy', file));
  return [file, createHash('sha256').update(bytes).digest('hex')];
})));
const results = [];
for (const source of sources) {
  const row = { source, files: {} };
  for (const file of files) {
    const url = `${source.replace(/\/$/, '')}/${file}`;
    try {
      const response = await fetch(url, { redirect: 'manual' });
      const bytes = Buffer.from(await response.arrayBuffer());
      const hash = createHash('sha256').update(bytes).digest('hex');
      row.files[file] = { status: response.status, location: response.headers.get('location'), bytes: bytes.length, hash, matches: response.status === 200 && hash === local[file] };
    } catch (error) {
      row.files[file] = { status: 0, error: error?.message || String(error), matches: false };
    }
  }
  results.push(row);
}
console.log(JSON.stringify({ local, sources: results }, null, 2));
assert.ok(results.length > 0, 'no online sources configured');
for (const row of results) for (const [file, result] of Object.entries(row.files)) {
  assert.equal(result.matches, true, `${row.source}/${file} is not HTTP 200 with the current .deploy hash`);
}
