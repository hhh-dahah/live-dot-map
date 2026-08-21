import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { collect } from '../../src/bridge/context-document-provider.mjs';

async function makeRoot(testContext) {
  const root = await mkdtemp(join(resolve(process.env.TEMP || process.env.TMP || '.'), 'live-dot-map-context-'));
  testContext.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function mapDocument(mapKey, overrides = {}) {
  return {
    mapId: `doc-${mapKey}`,
    mapDir: `.live-dot-map/maps/${mapKey}`,
    routes: [{ id: 'route-a', name: '路线 A' }],
    nodes: [
      { id: 'same-id', name: `节点 ${mapKey}`, route: 'route-a', md: 'docs/explicit.md' },
      { id: 'archived-owner', name: '已归档节点', route: 'route-a', archived: true, md: 'docs/archived.md' },
    ],
    edges: [
      { id: 'edge-visible', from: 'same-id', to: null, route: 'route-a' },
      { id: 'edge-hidden-by-endpoint', from: 'same-id', to: 'archived-owner', route: 'route-a' },
      { id: 'edge-archived', from: 'same-id', to: null, route: 'route-a', archived: true },
    ],
    anns: [],
    ...overrides,
  };
}

async function writeBundle(root, mapKey, ownerKind, ownerId, files = {}) {
  const directory = join(root, '.live-dot-map', 'maps', mapKey, ownerKind, ownerId);
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = join(directory, name);
    if (Buffer.isBuffer(content)) await writeFile(path, content);
    else await writeFile(path, String(content), 'utf8');
  }
  return directory;
}

test('collect isolates the current map, visible owners and referenced custom Markdown', async (t) => {
  const root = await makeRoot(t);
  await mkdir(join(root, '.live-dot-map', 'maps', 'map-a'), { recursive: true });
  await mkdir(join(root, '.live-dot-map', 'maps', 'map-b'), { recursive: true });
  await writeFile(join(root, 'README.md'), 'ambient root document');
  await mkdir(join(root, 'docs'), { recursive: true });
  await writeFile(join(root, 'docs', 'explicit.md'), '# Explicit A\n');
  await writeFile(join(root, 'docs', 'archived.md'), '# Must stay hidden\n');
  await mkdir(join(root, '.live-dot-map', 'maps', 'map-a', '.bridge', 'backups'), { recursive: true });
  await writeFile(join(root, '.live-dot-map', 'maps', 'map-a', '.bridge', 'backups', 'secret.md'), '# backup\n');
  await writeBundle(root, 'map-a', 'nodes', 'same-id', {
    'index.md': '# Map A node\n',
    'note.md': 'supplement A\n',
    '.archive': '',
  });
  await writeBundle(root, 'map-a', 'nodes', 'archived-owner', {
    'index.md': '# Archived node\n',
  });
  await writeBundle(root, 'map-a', 'routes', 'route-a', { 'index.md': '# Route A\n' });
  await writeBundle(root, 'map-a', 'routes', 'edge-visible', { 'index.md': '# Edge A\n' });
  await writeBundle(root, 'map-a', 'routes', 'edge-hidden-by-endpoint', { 'index.md': '# Hidden edge\n' });
  await writeBundle(root, 'map-a', 'routes', 'edge-archived', { 'index.md': '# Archived edge\n' });
  await writeBundle(root, 'map-b', 'nodes', 'same-id', { 'index.md': '# Map B node\n' });

  const result = await collect({ projectRoot: root, mapKey: 'map-a', document: mapDocument('map-a') });
  const paths = result.markdown.map((item) => item.path);
  assert.deepEqual(paths, [
    '.live-dot-map/maps/map-a/nodes/same-id/index.md',
    '.live-dot-map/maps/map-a/nodes/same-id/note.md',
    '.live-dot-map/maps/map-a/routes/edge-visible/index.md',
    '.live-dot-map/maps/map-a/routes/route-a/index.md',
    'docs/explicit.md',
  ]);
  assert.equal(result.markdown.find((item) => item.path === 'docs/explicit.md').source, 'custom');
  assert.equal(paths.some((path) => path.includes('map-b')), false);
  assert.equal(paths.some((path) => path.includes('archived') || path.includes('backup') || path === 'README.md'), false);
  assert.equal(paths.some((path) => path.includes('edge-hidden-by-endpoint')), false);
  assert.equal(result.assets.length, 0);
});

test('collect returns bundle attachment metadata without reading attachment bytes', async (t) => {
  const root = await makeRoot(t);
  await writeBundle(root, 'default', 'nodes', 'same-id', {
    'index.md': '# Node\n',
    'image.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'evidence.pdf': Buffer.from('%PDF-1.7'),
  });
  const result = await collect({ projectRoot: root, mapKey: 'default', document: mapDocument('default') });
  assert.deepEqual(result.assets.map((item) => item.path), [
    '.live-dot-map/maps/default/nodes/same-id/evidence.pdf',
    '.live-dot-map/maps/default/nodes/same-id/image.png',
  ]);
  assert.equal(result.assets[0].mimeType, 'application/pdf');
  assert.equal(result.assets[1].kind, 'png');
  assert.equal('text' in result.assets[0], false);
  assert.equal('content' in result.assets[0], false);
});

test('collect rejects explicit custom Markdown symlinks', async (t) => {
  const root = await makeRoot(t);
  await writeBundle(root, 'default', 'nodes', 'same-id', { 'index.md': '# Node\n' });
  await mkdir(join(root, 'docs'), { recursive: true });
  const outside = join(root, 'outside.md');
  await writeFile(outside, '# outside\n');
  try {
    await symlink(outside, join(root, 'docs', 'explicit.md'));
  } catch (error) {
    if (['EPERM', 'EEXIST', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`当前 Windows 环境不允许创建 symlink：${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    collect({ projectRoot: root, mapKey: 'default', document: mapDocument('default') }),
    (error) => error?.code === 'CONTEXT_SYMLINK_FORBIDDEN',
  );
  assert.equal((await lstat(outside)).isFile(), true);
  assert.equal(await readFile(outside, 'utf8'), '# outside\n');
});

test('includeHistory can read archived owners but never enters .archive files', async (t) => {
  const root = await makeRoot(t);
  const archivedDirectory = await writeBundle(root, 'default', 'nodes', 'archived-owner', {
    'index.md': '# Archived index\n',
  });
  await mkdir(join(archivedDirectory, '.archive'), { recursive: true });
  await writeFile(join(archivedDirectory, '.archive', 'old.md'), 'old archive\n');
  const result = await collect({ projectRoot: root, mapKey: 'default', document: mapDocument('default'), includeHistory: true });
  assert.equal(result.markdown.some((item) => item.path.endsWith('/nodes/archived-owner/index.md')), true);
  assert.equal(result.markdown.some((item) => item.path.includes('/.archive/')), false);
});
