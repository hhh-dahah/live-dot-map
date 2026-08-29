import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const bridge = await readFile(new URL('../../src/web/bridge-client.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../../app.html', import.meta.url), 'utf8');

test('BridgeClient 暴露资料包、二进制附件和归档生命周期 API', () => {
  for (const method of [
    'listBundleFiles', 'readBundleMarkdown', 'createBundleMarkdown',
    'replaceBundleMarkdown', 'appendBundleMarkdown', 'renameBundleFile',
    'archiveBundleFile', 'restoreBundleFile', 'importAsset',
    'listArchived', 'restoreArchived', 'purgeArchived',
  ]) assert.match(bridge, new RegExp(`async ${method}\\(`), `${method} 缺失`);
  assert.match(bridge, /\/api\/v1\/assets\/import\?/);
  assert.match(bridge, /body: \{ collection, id, confirmed: true, confirmation: id \}/);
  assert.match(bridge, /body: body as BodyInit/);
});

test('设置中的已归档入口提供恢复和不可弱化的 ID 二次确认清除', () => {
  assert.match(app, /id:'settings'[\s\S]*?label:'设置'[\s\S]*?id:'archive'/);
  assert.match(app, /function openArchiveDialog\(\)/);
  assert.match(app, /bridge\.restoreArchived\(collection, id\)/);
  assert.match(app, /window\.confirm\(/);
  assert.match(app, /window\.prompt\(/);
  assert.match(app, /bridge\.purgeArchived\(collection, id, confirmation\)/);
});
