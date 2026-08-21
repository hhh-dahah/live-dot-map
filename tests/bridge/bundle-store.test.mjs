import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  BundleStore,
  MAX_ASSET_BYTES,
} from '../../src/bridge/bundle-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'live-dot-map-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await BundleStore.open({ projectRoot: root, mapKey: 'default' });
  return { root, store };
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const etag = (content) => createHash('sha256').update(content, 'utf8').digest('hex');

test('uses final node bundle layout and keeps index.md immutable', async (t) => {
  const { root, store } = await fixture(t);
  await store.ensureIndex({ ownerKind: 'node', ownerId: 'n1', content: '# Goal\n' });
  const note = await store.createMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'note.md', content: 'first' });
  assert.equal(note.path, 'nodes/n1/note.md');
  assert.equal(await readFile(join(root, '.live-dot-map', 'maps', 'default', 'nodes', 'n1', 'index.md'), 'utf8'), '# Goal\n');

  await assert.rejects(
    store.rename({ ownerKind: 'node', ownerId: 'n1', from: 'index.md', to: 'renamed.md' }),
    (error) => error.code === 'BUNDLE_INDEX_IMMUTABLE',
  );
  await assert.rejects(
    store.archive({ ownerKind: 'node', ownerId: 'n1', fileName: 'index.md' }),
    (error) => error.code === 'BUNDLE_INDEX_IMMUTABLE',
  );
});

test('returns content etags and rejects stale or missing replace bases', async (t) => {
  const { store } = await fixture(t);
  await store.ensureIndex({ ownerKind: 'node', ownerId: 'n1', content: '# original\n' });
  const initial = await store.readMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'index.md' });
  assert.equal(initial.etag, etag(initial.content));
  const listed = await store.list({ ownerKind: 'node', ownerId: 'n1' });
  assert.equal(listed.find((item) => item.name === 'index.md')?.etag, initial.etag);

  await assert.rejects(
    store.replaceMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'index.md', content: '# no base\n' }),
    (error) => error.code === 'MARKDOWN_BASE_ETAG_REQUIRED' && error.status === 400,
  );

  await store.appendMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'index.md', content: 'agent append', commandId: 'append-before-replace' });
  await assert.rejects(
    store.replaceMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'index.md', content: '# stale\n', baseEtag: initial.etag }),
    (error) => error.code === 'MARKDOWN_CONFLICT'
      && error.status === 409
      && error.details?.current?.etag === etag('# original\nagent append')
      && error.details?.current?.content === '# original\nagent append',
  );

  const latest = await store.readMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'index.md' });
  const replaced = await store.replaceMarkdown({
    ownerKind: 'node',
    ownerId: 'n1',
    fileName: 'index.md',
    content: '# accepted\n',
    baseEtag: latest.etag,
  });
  assert.equal(replaced.etag, etag('# accepted\n'));
  assert.equal((await store.readMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'index.md' })).content, '# accepted\n');
});

test('serializes markdown append and deduplicates commandId', async (t) => {
  const { store } = await fixture(t);
  await store.ensureIndex({ ownerKind: 'route', ownerId: 'r1', content: '' });
  const count = 20;
  await Promise.all(Array.from({ length: count }, (_, index) => store.appendMarkdown({
    ownerKind: 'route',
    ownerId: 'r1',
    fileName: 'index.md',
    content: `line-${index}`,
    commandId: `append-${index}`,
  })));
  const first = await store.readMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md' });
  assert.equal(first.content.split('\n').length, count);
  assert.equal(first.content.includes('\r'), false);
  for (let index = 0; index < count; index += 1) assert.equal(first.content.split('\n').filter((line) => line === `line-${index}`).length, 1);
  const repeated = await store.appendMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md', content: 'line-0', commandId: 'append-0' });
  assert.equal(repeated.size, first.size);
  await assert.rejects(
    store.appendMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md', content: 'different', commandId: 'append-0' }),
    (error) => error.code === 'BUNDLE_COMMAND_REUSE',
  );
});

test('requires commandId and recovers a crash after append without duplicating content', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'live-dot-map-bundle-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let crashOnce = true;
  const store = await BundleStore.open({
    projectRoot: root,
    mapKey: 'default',
    faultInjector(point) {
      if (point === 'afterAppendReplaceBeforeReceipt' && crashOnce) {
        crashOnce = false;
        throw new Error('simulated append crash');
      }
    },
  });
  await store.ensureIndex({ ownerKind: 'node', ownerId: 'n1', content: 'base' });
  await assert.rejects(
    store.appendMarkdown({ ownerKind: 'node', ownerId: 'n1', content: 'missing command' }),
    (error) => error.code === 'BUNDLE_COMMAND_ID_REQUIRED' && error.status === 400,
  );
  await assert.rejects(
    store.appendMarkdown({ ownerKind: 'node', ownerId: 'n1', content: 'once', commandId: 'crash-safe' }),
    /simulated append crash/,
  );
  await store.appendMarkdown({ ownerKind: 'node', ownerId: 'n1', content: 'once', commandId: 'crash-safe' });
  assert.equal((await store.readMarkdown({ ownerKind: 'node', ownerId: 'n1' })).content, 'base\nonce');
});

test('serializes append and replace by etag in either acquisition order', async (t) => {
  const { store } = await fixture(t);
  await store.ensureIndex({ ownerKind: 'route', ownerId: 'r1', content: 'base\n' });
  const base = await store.readMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md' });
  const [appended, replaced] = await Promise.allSettled([
    store.appendMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md', content: '\r\nappend\r\n', commandId: 'raced-append' }),
    store.replaceMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md', content: 'replacement', baseEtag: base.etag }),
  ]);
  assert.equal(appended.status, 'fulfilled');
  if (replaced.status === 'rejected') {
    assert.equal(replaced.reason.code, 'MARKDOWN_CONFLICT');
    assert.equal((await store.readMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md' })).content, 'base\nappend');
  } else {
    const final = await store.readMarkdown({ ownerKind: 'route', ownerId: 'r1', fileName: 'index.md' });
    assert.equal(final.content, 'replacement\nappend');
  }
});

test('renames, archives, and restores supplementary Markdown and attachments without overwriting', async (t) => {
  const { store } = await fixture(t);
  await store.ensureIndex({ ownerKind: 'node', ownerId: 'n1' });
  await store.createMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'brief.md', content: 'brief' });
  await store.createMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName: 'copy.md', content: 'existing' });
  const renamed = await store.rename({ ownerKind: 'node', ownerId: 'n1', from: 'brief.md', to: 'copy.md' });
  assert.equal(renamed.name, 'copy-2.md');
  const asset = await store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'image.png', stream: Readable.from([png]), mimeType: 'image/png' });
  assert.equal(asset.disposition, 'inline');
  const archived = await store.archive({ ownerKind: 'node', ownerId: 'n1', fileName: 'image.png' });
  assert.equal(archived.archived, true);
  assert.equal((await store.list({ ownerKind: 'node', ownerId: 'n1' })).some((item) => item.name === 'image.png'), false);
  const restored = await store.restore({ ownerKind: 'node', ownerId: 'n1', fileName: 'image.png' });
  assert.equal(restored.archived, false);
});

test('streams allowed assets, checks MIME and magic, and allocates case-insensitive names', async (t) => {
  const { store } = await fixture(t);
  const first = await store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'photo.PNG', stream: Readable.from([png]), mimeType: 'image/png' });
  const second = await store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'photo.png', stream: Readable.from([png]), mimeType: 'image/png' });
  assert.equal(first.name, 'photo.PNG');
  assert.equal(second.name, 'photo-2.png');
  await assert.rejects(
    store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'bad.png', stream: Readable.from([Buffer.from('not an image')]), mimeType: 'image/png' }),
    (error) => error.code === 'BUNDLE_FILE_HEADER_MISMATCH',
  );
  await assert.rejects(
    store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'bad.jpg', stream: Readable.from([png]), mimeType: 'image/png' }),
    (error) => error.code === 'BUNDLE_MIME_MISMATCH',
  );
  await assert.rejects(
    store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'large.png', stream: Readable.from([Buffer.alloc(MAX_ASSET_BYTES + 1)]), mimeType: 'image/png' }),
    (error) => error.code === 'BUNDLE_ASSET_TOO_LARGE',
  );
});

test('forces SVG attachment disposition and imports only project-local regular source files', async (t) => {
  const { root, store } = await fixture(t);
  const svgPath = join(root, 'source.svg');
  await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const imported = await store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'diagram.svg', sourcePath: 'source.svg', mimeType: 'image/svg+xml' });
  assert.equal(imported.disposition, 'attachment');
  await assert.rejects(
    store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'outside.png', sourcePath: join(tmpdir(), 'outside.png') }),
    (error) => error.code === 'BUNDLE_PATH_OUTSIDE_PROJECT',
  );

  const linkPath = join(root, 'link.svg');
  try {
    await symlink(svgPath, linkPath);
  } catch (error) {
    t.skip(`当前 Windows 权限不允许创建 symlink: ${error.code || error.message}`);
    return;
  }
  await assert.rejects(
    store.importAsset({ ownerKind: 'node', ownerId: 'n1', fileName: 'link.svg', sourcePath: 'link.svg' }),
    (error) => error.code === 'BUNDLE_SYMLINK_FORBIDDEN',
  );
});

test('rejects traversal, ADS, reserved names, and invalid owner identifiers', async (t) => {
  const { store } = await fixture(t);
  const badNames = ['../escape.md', '..%2fescape.md', '%252e%252e%2fescape.md', 'note:stream.md', 'CON.md', 'note.md '];
  for (const fileName of badNames) {
    await assert.rejects(
      store.createMarkdown({ ownerKind: 'node', ownerId: 'n1', fileName, content: 'x' }),
      (error) => ['BUNDLE_PATH_TRAVERSAL', 'BUNDLE_PATH_INVALID', 'BUNDLE_RESERVED_NAME'].includes(error.code),
      fileName,
    );
  }
  await assert.rejects(
    store.ensureIndex({ ownerKind: 'node', ownerId: '../outside' }),
    (error) => ['BUNDLE_PATH_TRAVERSAL', 'BUNDLE_OWNER_INVALID'].includes(error.code),
  );
});
