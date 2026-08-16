import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('构建产物包含 CSP、强模式状态与修复后的转义器', async () => {
  const html = await readFile(new URL('../../dist/app.v2.html', import.meta.url), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /Agent 自动读取和并发保护未启用/);
  assert.match(html, /本地草稿/);
  assert.doesNotMatch(html, /replace\(\/\[&<>\]\"\]\/g/);
  assert.doesNotMatch(html, /<span>\$\{it\.label\}<\/span>/);
});

test('新建 Markdown 路径按当前地图目录生成（mdPath）', async () => {
  const html = await readFile(new URL('../../dist/app.v2.html', import.meta.url), 'utf8');
  assert.match(html, /function mdPath\(kind, id\)/);
  assert.match(html, /mdPath\('nodes', nodeId\)/);
  assert.match(html, /mdPath\('routes', `e\$\{S\.nextEdge-1\}`\)/);
  assert.doesNotMatch(html, /n\.md = `nodes\//);
});
