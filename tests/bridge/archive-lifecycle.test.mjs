import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  ArchiveLifecycle,
  PURGE_RETENTION_MS,
  isPurgeEligible,
} from '../../src/bridge/archive-lifecycle.mjs';
import { ProjectStore } from '../../src/bridge/project-store.mjs';
import { loadSharedAdapter } from '../../src/bridge/shared-adapter.mjs';
import { temporaryProject } from './helpers.mjs';

const NOW = new Date('2026-08-31T00:00:00.000Z');
const OLD = new Date(NOW.getTime() - PURGE_RETENTION_MS - 1).toISOString();

function objectBase(id, now = '2026-08-01T00:00:00.000Z') {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    createdBy: 'human',
    updatedBy: 'human',
    updatedRevision: 0,
  };
}

async function makeMap(shared, options = {}) {
  const includeRoute = options.includeRoute ?? true;
  const archivedAt = Object.prototype.hasOwnProperty.call(options, 'archivedAt') ? options.archivedAt : OLD;
  const archivedRoute = options.archivedRoute === true;
  const archivedEdge = options.archivedEdge === true;
  const archivedAnn = options.archivedAnn === true;
  const map = await shared.createEmptyMap({ name: 'purge-test', now: '2026-08-01T00:00:00.000Z', mapId: 'purge-map' });
  if (includeRoute) map.routes.push({
    ...objectBase('r1'), name: '路线', source: null, main: true, currentNodeId: null,
    ...(archivedRoute ? { archived: true, archivedAt, archivedBy: 'human' } : {}),
  });
  map.nodes.push(
    { ...objectBase('n1'), name: '归档节点', kind: 'goal', route: includeRoute ? 'r1' : null, md: '.live-dot-map/nodes/n1/index.md', archived: true, archivedAt, archivedBy: 'human' },
    { ...objectBase('n2'), name: '保留节点', kind: 'goal', route: includeRoute ? 'r1' : null, md: '.live-dot-map/nodes/n2/index.md' },
  );
  map.edges.push(
    { ...objectBase('e1'), name: '关联方案', from: 'n1', to: 'n2', route: includeRoute ? 'r1' : null, status: 'pending', md: '.live-dot-map/routes/e1/index.md',
      ...(archivedEdge ? { archived: true, archivedAt, archivedBy: 'human' } : {}) },
    { ...objectBase('e2'), name: '保留方案', from: 'n2', to: null, route: includeRoute ? 'r1' : null, status: 'pending', md: '.live-dot-map/routes/e2/index.md' },
  );
  map.anns.push(
    { ...objectBase('a1'), text: '节点标注', target: { kind: 'node', id: 'n1' }, attention: 'new', source: 'human', priority: 'normal', acknowledgements: [],
      ...(archivedAnn ? { archived: true, archivedAt, archivedBy: 'human' } : {}) },
    { ...objectBase('a2'), text: '边标注', target: { kind: 'edge', id: 'e1' }, attention: 'new', source: 'human', priority: 'normal', acknowledgements: [] },
    { ...objectBase('a3'), text: '保留标注', target: { kind: 'node', id: 'n2' }, attention: 'new', source: 'human', priority: 'normal', acknowledgements: [] },
  );
  return map;
}

async function fixture(t, options = {}) {
  const map = await makeMap(await loadSharedAdapter(), options);
  // makeMap above needs the adapter only to createEmptyMap; temporaryProject
  // loads the same adapter and writes the prepared document.
  const { root, shared } = await temporaryProject(t, { map });
  const store = await ProjectStore.open({ projectRoot: root, shared, clock: () => new Date(NOW), pollIntervalMs: 0 });
  const mapRoot = join(root, '.live-dot-map');
  return { root, shared, store, mapRoot };
}

async function writePackage(mapRoot, collection, id, content = `# ${id}\n`) {
  const directory = join(mapRoot, collection, id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.md'), content, 'utf8');
  await writeFile(join(directory, 'notes.md'), 'supplement\n', 'utf8');
  return directory;
}

test('eligibility is exact at 30 days and old/malformed timestamps never auto purge', () => {
  const now = NOW;
  const at29 = new Date(now.getTime() - PURGE_RETENTION_MS + 1).toISOString();
  const at30 = new Date(now.getTime() - PURGE_RETENTION_MS).toISOString();
  const at31 = new Date(now.getTime() - PURGE_RETENTION_MS - 1).toISOString();
  assert.equal(isPurgeEligible({ archived: true, archivedAt: at29 }, { now }), false);
  assert.equal(isPurgeEligible({ archived: true, archivedAt: at30 }, { now }), true);
  assert.equal(isPurgeEligible({ archived: true, archivedAt: at31 }, { now }), true);
  assert.equal(isPurgeEligible({ archived: true }, { now }), false);
  assert.equal(isPurgeEligible({ archived: true, archivedAt: 'not-a-date' }, { now }), false);
  assert.equal(isPurgeEligible({ archived: false, archivedAt: at31 }, { now }), false);
});

test('purge atomically removes the object, cascading edges/annotations, and recycles its bundle', async (t) => {
  const { root, store, mapRoot } = await fixture(t);
  const packageDirectory = await writePackage(mapRoot, 'nodes', 'n1');
  await writePackage(mapRoot, 'routes', 'e1', '# e1\n');
  const recycledRoot = join(root, 'recycled');
  await mkdir(recycledRoot, { recursive: true });
  const calls = [];
  const lifecycle = new ArchiveLifecycle({
    store,
    clock: () => new Date(NOW),
    recycleBin: {
      async recycle(path) {
        calls.push(path);
        await rename(path, join(recycledRoot, 'purged-bundle'));
      },
    },
  });

  const result = await lifecycle.purge({ collection: 'nodes', id: 'n1', actor: 'system:retention', now: NOW });
  assert.equal(result.purged, true);
  assert.equal(result.recycled, true);
  assert.equal(calls.length, 1);
  const document = (await store.snapshot()).document;
  assert.equal(document.nodes.some((node) => node.id === 'n1'), false);
  assert.equal(document.edges.some((edge) => edge.id === 'e1'), false);
  assert.equal(document.edges.some((edge) => edge.id === 'e2'), true);
  assert.equal(document.anns.some((ann) => ['a1', 'a2'].includes(ann.id)), false);
  assert.equal(document.anns.some((ann) => ann.id === 'a3'), true);
  assert.equal(await readFile(join(recycledRoot, 'purged-bundle', 'nodes', 'n1', 'index.md'), 'utf8'), '# n1\n');
  assert.equal(await readFile(join(recycledRoot, 'purged-bundle', 'routes', 'e1', 'index.md'), 'utf8'), '# e1\n');
  assert.equal(await readdir(mapRoot).then((entries) => entries.includes('nodes')), true);
  assert.equal(await rm(packageDirectory, { recursive: true, force: false }).then(() => true).catch(() => false), false, 'source package must have moved to recycle bin');
});

test('route scheme purge stages only its deleted edge bundles, never a same-name scheme bundle', async (t) => {
  const { store, mapRoot } = await fixture(t, { archivedRoute: true });
  const schemePackage = await writePackage(mapRoot, 'routes', 'r1', '# scheme note\n');
  await writePackage(mapRoot, 'routes', 'e1', '# edge note\n');
  const recycledRoot = join(mapRoot, '.recycle-route');
  const lifecycle = new ArchiveLifecycle({
    store,
    clock: () => new Date(NOW),
    recycleBin: { recycle: async (path) => rename(path, recycledRoot) },
  });
  await lifecycle.purge({ collection: 'routes', id: 'r1', actor: 'system:retention', now: NOW });
  const document = (await store.snapshot()).document;
  assert.equal(document.routes.some((route) => route.id === 'r1'), false);
  assert.equal(document.edges.some((edge) => edge.id === 'e1'), false);
  assert.equal(document.nodes.find((node) => node.id === 'n2')?.route, null);
  assert.equal(await readFile(join(recycledRoot, 'routes', 'e1', 'index.md'), 'utf8'), '# edge note\n');
  assert.equal(await readFile(join(schemePackage, 'index.md'), 'utf8'), '# scheme note\n', 'scheme id 同名目录不得被误删');
});

test('edge purge removes its target annotations and its routes/<edgeId> bundle only', async (t) => {
  const { store, mapRoot } = await fixture(t, { archivedEdge: true });
  const edgePackage = await writePackage(mapRoot, 'routes', 'e1');
  const nodePackage = await writePackage(mapRoot, 'nodes', 'n1');
  const recycledRoot = join(mapRoot, '.recycle-edge');
  const lifecycle = new ArchiveLifecycle({
    store,
    clock: () => new Date(NOW),
    recycleBin: { recycle: async (path) => rename(path, recycledRoot) },
  });
  await lifecycle.purge({ collection: 'edges', id: 'e1', actor: 'system:retention', now: NOW });
  const document = (await store.snapshot()).document;
  assert.equal(document.edges.some((edge) => edge.id === 'e1'), false);
  assert.equal(document.nodes.some((node) => node.id === 'n1'), true);
  assert.equal(document.anns.some((ann) => ann.id === 'a2'), false);
  assert.equal(await readFile(join(recycledRoot, 'routes', 'e1', 'index.md'), 'utf8'), '# e1\n');
  assert.equal(await readFile(join(nodePackage, 'index.md'), 'utf8'), '# n1\n');
  assert.equal(await rm(edgePackage, { recursive: true, force: false }).then(() => true).catch(() => false), false);
});

test('annotation purge removes only the annotation and never stages a bundle', async (t) => {
  const { store, mapRoot } = await fixture(t, { archivedAnn: true });
  const nodePackage = await writePackage(mapRoot, 'nodes', 'n1');
  const calls = [];
  const lifecycle = new ArchiveLifecycle({
    store,
    clock: () => new Date(NOW),
    recycleBin: { recycle: async (path) => { calls.push(path); await rm(path, { recursive: true, force: true }); } },
  });
  await lifecycle.purge({ collection: 'anns', id: 'a1', actor: 'system:retention', now: NOW });
  const document = (await store.snapshot()).document;
  assert.equal(document.anns.some((ann) => ann.id === 'a1'), false);
  assert.equal(document.nodes.some((node) => node.id === 'n1'), true);
  assert.equal(await readFile(join(nodePackage, 'index.md'), 'utf8'), '# n1\n');
  assert.equal(calls.length, 1);
});

test('automatic purge rejects 29-day and archived-without-time objects without touching packages', async (t) => {
  const at29 = new Date(NOW.getTime() - PURGE_RETENTION_MS + 1).toISOString();
  const { store, mapRoot } = await fixture(t, { archivedAt: at29 });
  const packageDirectory = await writePackage(mapRoot, 'nodes', 'n1');
  const lifecycle = new ArchiveLifecycle({ store, clock: () => new Date(NOW), recycleBin: { recycle: async () => {} } });
  await assert.rejects(
    lifecycle.purge({ collection: 'nodes', id: 'n1', actor: 'system:retention', now: NOW }),
    (cause) => cause.code === 'PURGE_NOT_ELIGIBLE',
  );
  assert.equal(await readFile(join(packageDirectory, 'index.md'), 'utf8'), '# n1\n');

  assert.equal(isPurgeEligible({ archived: true }, { now: NOW }), false, '旧归档没有 archivedAt 时永不自动清理');
});

test('recycle failure restores the map and staging packages while keeping the object archived', async (t) => {
  const { store, mapRoot } = await fixture(t);
  const packageDirectory = await writePackage(mapRoot, 'nodes', 'n1');
  const lifecycle = new ArchiveLifecycle({
    store,
    clock: () => new Date(NOW),
    recycleBin: { recycle: async () => { throw Object.assign(new Error('recycle unavailable'), { code: 'RECYCLE_DOWN' }); } },
  });
  await assert.rejects(
    lifecycle.purge({ collection: 'nodes', id: 'n1', actor: 'system:retention', now: NOW }),
    (cause) => cause.code === 'PURGE_FAILED',
  );
  const document = (await store.snapshot()).document;
  assert.equal(document.nodes.find((node) => node.id === 'n1')?.archived, true);
  assert.equal(await readFile(join(packageDirectory, 'index.md'), 'utf8'), '# n1\n');
});

test('edge bundle is restored when recycle fails after an edge purge', async (t) => {
  const { store, mapRoot } = await fixture(t, { archivedEdge: true });
  const edgePackage = await writePackage(mapRoot, 'routes', 'e1');
  const lifecycle = new ArchiveLifecycle({
    store,
    clock: () => new Date(NOW),
    recycleBin: { recycle: async () => { throw new Error('recycle unavailable'); } },
  });
  await assert.rejects(
    lifecycle.purge({ collection: 'edges', id: 'e1', actor: 'system:retention', now: NOW }),
    (cause) => cause.code === 'PURGE_FAILED',
  );
  assert.equal((await store.snapshot()).document.edges.find((edge) => edge.id === 'e1')?.archived, true);
  assert.equal(await readFile(join(edgePackage, 'index.md'), 'utf8'), '# e1\n');
});

test('map commit failure rolls back the WAL-backed purge and package staging', async (t) => {
  const { store, mapRoot } = await fixture(t);
  const packageDirectory = await writePackage(mapRoot, 'nodes', 'n1');
  let failed = false;
  const lifecycle = new ArchiveLifecycle({
    store,
    clock: () => new Date(NOW),
    recycleBin: { recycle: async () => { throw new Error('must not recycle after map failure'); } },
    faultInjector(point) {
      if (!failed && point === 'afterMapReplace') {
        failed = true;
        throw Object.assign(new Error('simulated map failure'), { code: 'SIMULATED_PURGE_FAILURE' });
      }
    },
  });
  await assert.rejects(
    lifecycle.purge({ collection: 'nodes', id: 'n1', actor: 'system:retention', now: NOW }),
    (cause) => cause.code === 'PURGE_FAILED',
  );
  const document = (await store.snapshot()).document;
  assert.equal(document.nodes.find((node) => node.id === 'n1')?.archived, true);
  assert.equal(await readFile(join(packageDirectory, 'index.md'), 'utf8'), '# n1\n');
});
