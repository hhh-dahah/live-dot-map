import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../../app.html', import.meta.url), 'utf8');

test('画布 P0/P1 入口和持久化动作仍在发布产物中', () => {
  assert.match(html, /function undo\(\)/);
  assert.match(html, /function redo\(\)/);
  assert.match(html, /id="first-map-guide"/);
  assert.match(html, /让 Agent 初始化我的项目地图/);
  assert.match(html, /LiveDotFallback\.prepareFallbackDocument/);
  assert.match(html, /milestoneSourceLabel/);
});
