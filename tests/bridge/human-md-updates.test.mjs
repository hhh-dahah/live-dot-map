import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanMdUpdateLog } from '../../src/bridge/human-md-updates.mjs';
import { appendDurable } from '../../src/bridge/fs-utils.mjs';
import { temporaryProject } from './helpers.mjs';

test('record → unacknowledged 列出；同 path 覆盖为最新；ack 后消失；ack 后再写重新出现', async (t) => {
  const project = await temporaryProject(t, { withMap: false });
  const log = new HumanMdUpdateLog({ projectRoot: project.root, mapKey: 'default', maxBytes: 1024 * 1024 });
  const path = '.live-dot-map/maps/default/routes/e1/index.md';

  await log.record({ path, etag: 'e1', mtime: '2026-08-21T06:00:00.000Z', snippet: '# 方案1 今天上山打老虎' });
  let items = await log.unacknowledged();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, `md:${path}`);
  assert.match(items[0].snippet, /今天上山打老虎/);

  await log.record({ path, etag: 'e2', mtime: '2026-08-21T06:05:00.000Z', snippet: '# 方案1 更新后内容' });
  items = await log.unacknowledged();
  assert.equal(items.length, 1);
  assert.equal(items[0].etag, 'e2');
  assert.match(items[0].snippet, /更新后内容/);

  await log.acknowledge([path]);
  items = await log.unacknowledged();
  assert.equal(items.length, 0);

  await log.record({ path, etag: 'e3', mtime: '2026-08-21T06:06:00.000Z', snippet: '# 方案1 第三次写入' });
  items = await log.unacknowledged();
  assert.equal(items.length, 1);
  assert.equal(items[0].etag, 'e3');
});

test('compact 只保留未确认条目；损坏行跳过不崩', async (t) => {
  const project = await temporaryProject(t, { withMap: false });
  const log = new HumanMdUpdateLog({ projectRoot: project.root, mapKey: 'default', maxBytes: 256 });

  await log.record({ path: 'p/keep.md', etag: 'k', mtime: '2026-08-21T06:00:00.000Z', snippet: '保留' });
  await log.record({ path: 'p/ack.md', etag: 'a', mtime: '2026-08-21T06:01:00.000Z', snippet: '确认掉' });
  await log.acknowledge(['p/ack.md']);

  const big = 'x'.repeat(300);
  for (let index = 0; index < 5; index += 1) {
    await log.record({ path: `p/big${index}.md`, etag: 'b', mtime: '2026-08-21T06:02:00.000Z', snippet: big });
  }

  const items = await log.unacknowledged();
  assert.equal(items.some((item) => item.path === 'p/keep.md'), true, 'compact 后未确认的 keep 仍在');
  assert.equal(items.some((item) => item.path === 'p/ack.md'), false, 'compact 丢弃已 ack 条目');
  assert.equal(items.filter((item) => item.path.startsWith('p/big')).length, 5);

  await appendDurable(log.logPath, '{broken json');
  const again = await log.unacknowledged();
  assert.equal(again.some((item) => item.path === 'p/keep.md'), true, '损坏行应被跳过');
});
