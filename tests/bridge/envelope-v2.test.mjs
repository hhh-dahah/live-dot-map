import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectStore } from '../../src/bridge/project-store.mjs';
import { temporaryProject } from './helpers.mjs';

const request = (commandId, baseRevision, commands) => ({
  projectId: 'project-test',
  baseRevision,
  commandId,
  actor: 'human',
  sessionId: 'session-test',
  commands,
});

test('v2 commands[] 在一个 revision 原子提交，过期 revision 的不同字段自动重放', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  const created = await store.execute(request('command-v2-create', 0, [
    { op: 'create', collection: 'routes', value: { id: 'r1', name: '主路线', source: null, main: true } },
    { op: 'create', collection: 'nodes', value: { id: 'n1', name: '节点一', type: '目的', route: 'r1', x: 0, y: 0 } },
    { op: 'create', collection: 'nodes', value: { id: 'n2', name: '节点二', type: '结果', route: 'r1', x: 100, y: 0 } },
  ]));
  assert.equal(created.revision, 1);
  assert.equal(created.document.nodes.length, 2);

  await store.execute(request('command-v2-name1', 1, [
    { op: 'update', collection: 'nodes', id: 'n1', patch: { name: '节点一已改' } },
  ]));
  const rebased = await store.execute(request('command-v2-node2', 1, [
    { op: 'update', collection: 'nodes', id: 'n2', patch: { type: '问题' } },
  ]));
  assert.equal(rebased.revision, 3);
  assert.equal(rebased.document.nodes.find((node) => node.id === 'n1').name, '节点一已改');
  assert.equal(rebased.document.nodes.find((node) => node.id === 'n2').type, '问题');
});

test('过期 revision 修改同一字段返回 409 语义并保留双方版本', async (t) => {
  const { root, shared } = await temporaryProject(t);
  const store = await ProjectStore.open({ projectRoot: root, shared });
  await store.execute(request('command-v2-create2', 0, [
    { op: 'create', collection: 'routes', value: { id: 'r1', name: '主路线', source: null, main: true } },
    { op: 'create', collection: 'nodes', value: { id: 'n1', name: '原名', type: '目的', route: 'r1', x: 0, y: 0 } },
  ]));
  await store.execute(request('command-v2-first', 1, [
    { op: 'update', collection: 'nodes', id: 'n1', patch: { name: '当前版本' } },
  ]));
  await assert.rejects(
    store.execute(request('command-v2-second', 1, [
      { op: 'update', collection: 'nodes', id: 'n1', patch: { name: '待写版本' } },
    ])),
    (error) => {
      assert.equal(error.code, 'REVISION_CONFLICT');
      assert.deepEqual(error.details.conflictPaths, ['nodes/n1/name']);
      assert.equal(error.details.currentDocument.nodes.find((node) => node.id === 'n1').name, '当前版本');
      assert.equal(error.details.incomingCommands[0].patch.name, '待写版本');
      return true;
    },
  );
});
