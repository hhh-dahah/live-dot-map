import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildApp } from '../../scripts/build-app.mjs';

const TEST_ROOT = resolve(process.env.LIVEDOT_TEST_ROOT || 'D:\\LiveDotMap-Test');
await mkdir(TEST_ROOT, { recursive: true });

test('构建注入 CSP/nonce、运行时，并修复菜单外部文本与 Markdown 前缀', async () => {
  const dir = await mkdtemp(join(TEST_ROOT, 'dotmap-build-'));
  const input = join(dir, 'fixture.html');
  const output = join(dir, 'out.html');
  const source = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>function openMenu(items){return `<span>${it.label}</span>`} const x={md:\'nodes/a.md\'};</script></body></html>';
  await writeFile(input, source, 'utf8');
  const result = await buildApp({ input, output, nonce: 'test-nonce' });
  const html = await readFile(output, 'utf8');
  assert.equal(result.nonce, 'test-nonce');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self' 'nonce-test-nonce'/);
  assert.match(html, /nonce="test-nonce"[^>]*data-dotmap-fallback="v2"/);
  assert.match(html, /nonce="test-nonce"[^>]*data-dotmap-runtime="v2"/);
  assert.ok(html.indexOf('data-dotmap-fallback="v2"') < html.indexOf('function openMenu'));
  assert.doesNotMatch(html, /\$\{it\.label\}/);
  assert.match(html, /\$\{esc\(it\.label\)\}/);
  assert.match(html, /\.live-dot-map\/nodes\//);
  await rm(dir, { recursive: true, force: true });
});

test('构建脚本不触碰冻结 canvas.html', async () => {
  const canvas = await readFile(new URL('../../canvas.html', import.meta.url), 'utf8');
  const before = createHash('sha256').update(canvas).digest('hex');
  const dir = await mkdtemp(join(TEST_ROOT, 'dotmap-build-canvas-'));
  await buildApp({ input: new URL('../../app.html', import.meta.url), output: join(dir, 'out.html'), nonce: 'canvas-test' });
  const after = createHash('sha256').update(await readFile(new URL('../../canvas.html', import.meta.url), 'utf8')).digest('hex');
  assert.equal(after, before);
  await rm(dir, { recursive: true, force: true });
});
