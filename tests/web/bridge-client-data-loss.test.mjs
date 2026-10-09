import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

function makeIndexedDb(stores) {
  const db = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) { stores.set(name, new Map()); return {}; },
    transaction(name) {
      const tx = { error: null, oncomplete: null, onerror: null };
      const records = stores.get(name);
      tx.objectStore = () => ({
        put(value, key) { records.set(key, structuredClone(value)); },
        delete(key) { records.delete(key); },
        get(key) {
          const request = { result: records.get(key), error: null, onsuccess: null, onerror: null };
          queueMicrotask(() => request.onsuccess?.({ target: request }));
          return request;
        },
      });
      queueMicrotask(() => tx.oncomplete?.({ target: tx }));
      return tx;
    },
    close() {},
  };
  return {
    open() {
      const request = { result: db, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        request.onupgradeneeded?.({ target: request });
        queueMicrotask(() => request.onsuccess?.({ target: request }));
      });
      return request;
    },
  };
}

function mapDocument({ mapId = 'project', revision = 1, nodes = 0, label = '基线' } = {}) {
  return {
    version: 2,
    mapId,
    revision,
    name: '地图',
    routes: [],
    nodes: Array.from({ length: nodes }, (_, index) => ({ id: `n${index + 1}`, name: `${label} ${index + 1}` })),
    edges: [],
    anns: [],
  };
}

async function loadModule() {
  const source = await readFile(new URL('../../src/web/bridge-client.ts', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm', platform: 'node', target: 'es2022' });
  return compiled.code;
}

test('suspectBridgeDataLoss：版本倒退、地图 ID 变了、桥上变空都算可疑；正常草稿不算', async () => {
  const code = await loadModule();
  const originalWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, setTimeout, clearTimeout };
  try {
    const { suspectBridgeDataLoss } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    const base = mapDocument({ revision: 135, nodes: 5 });
    const draft = mapDocument({ revision: 135, nodes: 5, label: '草稿' });
    const stored = { baseRevision: 135, baseSnapshot: base, draft };
    assert.match(suspectBridgeDataLoss(stored, mapDocument({ revision: 0 })), /第 135 版/);
    assert.match(suspectBridgeDataLoss(stored, mapDocument({ mapId: 'other', revision: 200, nodes: 5 })), /地图 ID/);
    assert.match(suspectBridgeDataLoss(stored, mapDocument({ revision: 140, nodes: 0 })), /桥上的地图却是空的/);
    assert.equal(suspectBridgeDataLoss(stored, mapDocument({ revision: 136, nodes: 5 })), '');
    assert.equal(suspectBridgeDataLoss(null, mapDocument()), '');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('切到地图时桥上数据像是丢了：先问；不写就另存草稿、不提交；确认后才恢复草稿', async () => {
  const code = await loadModule();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalIndexedDb = globalThis.indexedDB;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocation = globalThis.location;
  const stores = new Map();
  const draftKey = 'http://bridge.test|project-handle|map-b';
  const base = mapDocument({ revision: 135, nodes: 5 });
  const local = mapDocument({ revision: 135, nodes: 5, label: '草稿' });
  stores.set('drafts', new Map([[draftKey, { baseRevision: 135, baseSnapshot: base, draft: local, commandId: 'cmd-old', sessionId: 's' }]]));
  const session = new Map();
  const loaded = [];
  const statuses = [];
  const confirms = [];
  let answer = false;
  const calls = [];
  globalThis.window = {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    LiveDotApp: {
      load(document) { loaded.push(structuredClone(document)); },
      setStatus(state, detail) { statuses.push({ state, detail }); },
      confirm(options) { confirms.push(options); return Promise.resolve(answer); },
    },
  };
  globalThis.indexedDB = { open: makeIndexedDb(stores).open };
  globalThis.sessionStorage = {
    getItem(key) { return session.get(key) ?? null; },
    setItem(key, value) { session.set(key, String(value)); },
    removeItem(key) { session.delete(key); },
  };
  globalThis.location = { href: 'http://bridge.test/app.html' };
  try {
    const bootstrapWindowApp = globalThis.window.LiveDotApp;
    globalThis.window.LiveDotApp = undefined;
    const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    globalThis.window.LiveDotApp = bootstrapWindowApp;
    const client = new module.BridgeClient();
    Object.assign(client, {
      origin: 'http://bridge.test', initialized: true, connected: true, csrf: 'csrf',
      projectHandle: 'project-handle', projectId: 'project', mapKey: 'map-a', revision: 1,
      lastDocument: mapDocument(), pending: null, dirty: false,
    });
    client.startEvents = () => {};
    const emptyBridgeMap = mapDocument({ mapId: 'project', revision: 0, nodes: 0 });
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      calls.push(requestUrl.pathname);
      if (requestUrl.pathname.endsWith('/maps/switch')) {
        const mapId = JSON.parse(options.body).mapId;
        const document = mapId === 'map-b' ? emptyBridgeMap : mapDocument();
        return new Response(JSON.stringify({ document, activeMap: mapId, projectId: 'project', projectHandle: 'project-handle', revision: document.revision }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await client.switchMap('map-b');
    assert.equal(confirms.length, 1);
    assert.match(confirms[0].body, /第 135 版/);
    assert.equal(client.dirty, false);
    assert.equal(client.pending, null);
    assert.equal(client.timer, 0, '拒绝后不能排队自动提交');
    assert.equal(loaded.at(-1).nodes.length, 0);
    assert.equal(statuses.at(-1).state, 'error');
    const drafts = stores.get('drafts');
    assert.ok(drafts.has(draftKey), '原草稿保留');
    const held = [...drafts.keys()].filter((key) => key.startsWith(`${draftKey}|held-`));
    assert.equal(held.length, 1, '另存了一份 held 草稿');
    assert.equal(drafts.get(held[0]).draft.nodes[0].name, '草稿 1');
    assert.equal(calls.some((path) => path.endsWith('/commands')), false);

    await client.switchMap('map-a');
    answer = true;
    await client.switchMap('map-b');
    assert.equal(confirms.length, 2);
    assert.equal(client.dirty, true);
    assert.equal(client.pending.nodes.length, 5);
    clearTimeout(client.timer);
    client.timer = 0;
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    globalThis.indexedDB = originalIndexedDb;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.location = originalLocation;
  }
});
