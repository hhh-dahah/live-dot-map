import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

function makeIndexedDb() {
  const stores = new Map();
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
    stores,
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

function mapDocument(name, nodeName) {
  return {
    version: 2,
    mapId: 'project',
    revision: 1,
    name,
    routes: [],
    nodes: [{ id: 'n1', name: nodeName }],
    edges: [],
    anns: [],
  };
}

test('BridgeClient 切图可恢复 A 草稿，失败回滚旧 mapKey，并等待 inFlight', async () => {
  const source = await readFile(new URL('../../src/web/bridge-client.ts', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm', platform: 'node', target: 'es2022' });
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalIndexedDb = globalThis.indexedDB;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocation = globalThis.location;
  const indexed = makeIndexedDb();
  const session = new Map();
  const loaded = [];
  const calls = [];
  const docA = mapDocument('地图 A', 'A 基线');
  const localA = mapDocument('地图 A', 'A 本地草稿');
  const docB = mapDocument('地图 B', 'B 基线');
  globalThis.window = {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    LiveDotApp: { load(document) { loaded.push(structuredClone(document)); }, setStatus() {} },
  };
  globalThis.indexedDB = { open: indexed.open };
  globalThis.sessionStorage = {
    getItem(key) { return session.get(key) ?? null; },
    setItem(key, value) { session.set(key, String(value)); },
    removeItem(key) { session.delete(key); },
  };
  globalThis.location = { href: 'http://bridge.test/app.html' };
  try {
    // Prevent the module bootstrap from starting a real session; the test drives the client directly.
    const bootstrapWindowApp = globalThis.window.LiveDotApp;
    globalThis.window.LiveDotApp = undefined;
    const module = await import(`data:text/javascript,${encodeURIComponent(compiled.code)}`);
    globalThis.window.LiveDotApp = bootstrapWindowApp;
    const client = new module.BridgeClient();
    client.origin = 'http://bridge.test';
    client.initialized = true;
    client.connected = true;
    client.csrf = 'csrf';
    client.projectHandle = 'project-handle';
    client.projectId = 'project';
    client.mapKey = 'map-a';
    client.revision = 1;
    client.lastDocument = structuredClone(docA);
    client.pending = structuredClone(localA);
    client.dirty = true;
    client.draftCommandId = 'cmd-a';
    client.startEvents = () => {};
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      calls.push({ url: requestUrl, options });
      if (requestUrl.pathname.endsWith('/maps/switch')) {
        const mapId = JSON.parse(options.body).mapId;
        if (mapId === 'map-b') return new Response(JSON.stringify({ document: docB, activeMap: 'map-b', projectId: 'project', projectHandle: 'project-handle', revision: 1 }), { status: 200 });
        return new Response(JSON.stringify({ document: docA, activeMap: 'map-a', projectId: 'project', projectHandle: 'project-handle', revision: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await client.switchMap('map-b');
    assert.equal(client.mapKey, 'map-b');
    assert.equal(client.dirty, false);
    await client.switchMap('map-a');
    assert.equal(client.mapKey, 'map-a');
    assert.equal(client.dirty, true);
    assert.equal(client.pending.nodes[0].name, 'A 本地草稿');
    assert.equal(loaded.at(-1).nodes[0].name, 'A 本地草稿');

    clearTimeout(client.timer);
    client.timer = 0;
    client.mapKey = 'map-a';
    client.lastDocument = structuredClone(docA);
    client.pending = structuredClone(localA);
    client.dirty = true;
    client.draftCommandId = 'cmd-a-failure';
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      calls.push({ url: requestUrl, options });
      if (requestUrl.pathname.endsWith('/maps/switch')) return new Response(JSON.stringify({ error: { message: '切图失败' } }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await assert.rejects(() => client.switchMap('map-b'), /切图失败/);
    assert.equal(client.mapKey, 'map-a');
    assert.equal(client.lastDocument.nodes[0].name, 'A 基线');
    assert.equal(client.pending.nodes[0].name, 'A 本地草稿');
    clearTimeout(client.timer);
    client.timer = 0;

    let switchStarted = false;
    client.pending = null;
    client.dirty = false;
    client.inFlight = true;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.pathname.endsWith('/maps/switch')) {
        switchStarted = true;
        return new Response(JSON.stringify({ document: docB, activeMap: 'map-b', projectId: 'project', projectHandle: 'project-handle', revision: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const transition = client.switchMap('map-b');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(switchStarted, false);
    client.notifyInFlightDone();
    await transition;
    assert.equal(switchStarted, true);
    assert.equal(client.mapKey, 'map-b');
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    globalThis.indexedDB = originalIndexedDb;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.location = originalLocation;
  }
});

test('flushPending 跳过防抖立即提交 pending，断线时抛错由调用方中止', async () => {
  const source = await readFile(new URL('../../src/web/bridge-client.ts', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm', platform: 'node', target: 'es2022' });
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalIndexedDb = globalThis.indexedDB;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocation = globalThis.location;
  const indexed = makeIndexedDb();
  const session = new Map();
  globalThis.window = {
    addEventListener() {},
    setTimeout,
    clearTimeout,
    LiveDotApp: { load() {}, setStatus() {} },
  };
  globalThis.indexedDB = { open: indexed.open };
  globalThis.sessionStorage = {
    getItem(key) { return session.get(key) ?? null; },
    setItem(key, value) { session.set(key, String(value)); },
    removeItem(key) { session.delete(key); },
  };
  globalThis.location = { href: 'http://bridge.test/app.html' };
  try {
    const bootstrapWindowApp = globalThis.window.LiveDotApp;
    globalThis.window.LiveDotApp = undefined;
    const module = await import(`data:text/javascript,${encodeURIComponent(compiled.code)}`);
    globalThis.window.LiveDotApp = bootstrapWindowApp;
    const client = new module.BridgeClient();
    client.origin = 'http://bridge.test';
    client.initialized = true;
    client.connected = true;
    client.csrf = 'csrf';
    client.projectHandle = 'project-handle';
    client.projectId = 'project';
    client.mapKey = 'map-a';
    client.revision = 1;
    client.lastDocument = structuredClone(mapDocument('地图 A', 'A 基线'));

    // 无 pending：直接返回，不发任何请求
    let posts = 0;
    globalThis.fetch = async () => { posts += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
    await client.flushPending();
    assert.equal(posts, 0);

    // 有 pending：立即提交（不等 350ms 防抖），成功后清空 dirty/pending
    const draft = mapDocument('地图 A', 'A 待保存');
    client.pending = structuredClone(draft);
    client.dirty = true;
    client.draftCommandId = 'cmd-flush';
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      posts += 1;
      if (requestUrl.pathname.endsWith('/commands')) {
        return new Response(JSON.stringify({ ok: true, revision: 2, document: { ...structuredClone(draft), revision: 2 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await client.flushPending();
    assert.equal(client.pending, null);
    assert.equal(client.dirty, false);
    assert.equal(client.revision, 2);
    assert.ok(posts >= 1);

    // 断线且仍有 pending：抛错，更新流程据此中止而不是带伤重启
    client.pending = structuredClone(draft);
    client.dirty = true;
    client.connected = false;
    await assert.rejects(() => client.flushPending(), /未能保存/);
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    globalThis.indexedDB = originalIndexedDb;
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.location = originalLocation;
  }
});
