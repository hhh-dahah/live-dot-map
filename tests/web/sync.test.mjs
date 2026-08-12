import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandsClient, createDraftStore, createSseClient, createSyncController } from '../../src/web/sync.mjs';

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('本地草稿可保存、读取和清理', () => {
  const store = createDraftStore({ key: 'test', storage: memoryStorage() });
  const saved = store.save({ version: 1, name: '测试' }, { source: 'test' });
  assert.equal(store.load().document.name, '测试');
  assert.equal(saved.metadata.source, 'test');
  store.clear();
  assert.equal(store.load(), null);
});

test('commands 客户端发送 JSON 并将 HTTP 错误转为可识别错误', async () => {
  const calls = [];
  const client = createCommandsClient({ baseUrl: 'http://127.0.0.1:8787', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ revision: 3 }) };
  } });
  const result = await client.send({ commandId: 'c1' });
  assert.equal(result.revision, 3);
  assert.equal(calls[0].init.method, 'POST');
  assert.match(calls[0].init.body, /commandId/);
});

test('SSE 客户端解析事件并可关闭', () => {
  const instances = [];
  class FakeSource {
    constructor(url) { this.url = url; instances.push(this); }
    close() { this.closed = true; }
  }
  const events = [];
  const sse = createSseClient({ url: 'http://localhost/events', eventSourceFactory: FakeSource, onCommand: (value) => events.push(value) });
  sse.connect();
  instances[0].onmessage({ data: '{"revision":4}', lastEventId: '4' });
  assert.deepEqual(events, [{ revision: 4 }]);
  sse.close();
  assert.equal(instances[0].closed, true);
});

test('同步控制器在基线不一致时进入冲突状态并可发出关闭警告', () => {
  const controller = createSyncController({ mode: 'draft', draftStore: createDraftStore({ key: 'c', storage: memoryStorage() }) });
  controller.setBaseline('hash-a', 2);
  assert.equal(controller.assertBase({ hash: 'hash-b', revision: 2 }), false);
  assert.equal(controller.state.status, 'conflict');
  controller.markDirty();
  const listeners = new Map();
  const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: () => {} };
  const remove = controller.installCloseWarning(target);
  const event = { preventDefault() {}, returnValue: '' };
  listeners.get('beforeunload')(event);
  assert.match(event.returnValue, /未同步/);
  remove();
});
