import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { temporaryProject } from '../bridge/helpers.mjs';

const RUNTIME = resolve(import.meta.dirname, '../../livedot.mjs');

function cli(root, args, { input } = {}) {
  return new Promise((resolveRun) => {
    const child = execFile(process.execPath, [RUNTIME, ...args, '--project', root, '--agent', 'tester'], {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, LIVEDOT_MCP_LOCAL: '1' },
    }, (error, stdout = '', stderr = '') => resolveRun({ code: error ? error.code ?? 1 : 0, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
  });
}

const json = (result) => JSON.parse(result.stdout);

test('livedot --help 面向 Agent，列出命令与可复制例子', async (t) => {
  const { root } = await temporaryProject(t);
  const help = await cli(root, ['--help']);
  assert.equal(help.code, 0);
  for (const word of ['look', 'read', 'write', 'note', 'analyze', 'manage', '$HOME/.live-dot-map/livedot.mjs']) assert.ok(help.stdout.includes(word), word);
  const sub = await cli(root, ['analyze', '--help']);
  assert.match(sub.stdout, /group --by/);
});

test('参数错误走 stderr JSON、退出码 1，并给出正确用法', async (t) => {
  const { root } = await temporaryProject(t);
  const unknown = await cli(root, ['look', '--bogus', 'x']);
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  const error = JSON.parse(unknown.stderr).error;
  assert.equal(error.code, 'CLI_USAGE');
  assert.match(error.message, /正确用法：livedot look/);
  const missing = await cli(root, ['read']);
  assert.equal(JSON.parse(missing.stderr).error.code, 'CLI_USAGE');
});

test('look → write --new → note → read → analyze 全链路走同一个 dispatcher', async (t) => {
  const { root } = await temporaryProject(t);
  const created = await cli(root, ['write', '--new', '抖音爆款分析', '--kind', 'problem', '## 背景\\n收集了 6 条视频数据']);
  assert.equal(created.code, 0, created.stderr);
  const nodeId = json(created).node;
  assert.match(nodeId, /^n\d+$/, created.stdout);

  const noted = await cli(root, ['note', nodeId, '钢琴配乐播放更高，待验证']);
  assert.equal(noted.code, 0, noted.stderr);

  const look = await cli(root, ['look', '爆款']);
  assert.equal(look.code, 0, look.stderr);
  assert.ok(Buffer.byteLength(look.stdout) < 1536);
  assert.ok(json(look).items.some((row) => row[0] === nodeId));

  const read = await cli(root, ['read', nodeId]);
  const doc = json(read);
  assert.match(doc.content, /收集了 6 条视频数据/);
  assert.match(doc.content, /- \d\d-\d\d \d\d:\d\d · 钢琴配乐播放更高/);

  const csv = join(root, 'videos.csv');
  await writeFile(csv, '标题,音乐,播放\na,钢琴,41万\nb,钢琴,38万\nc,钢琴,52万\nd,电子,12万\ne,电子,9万\nf,电子,15万\n', 'utf8');
  const imported = await cli(root, ['manage', 'import', '--path', nodeId, '--source', csv]);
  assert.equal(imported.code, 0, imported.stderr);
  const analyzed = await cli(root, ['analyze', `nodes/${nodeId}/videos.csv`, 'group', '--by', '音乐', '--metric', '播放']);
  assert.equal(analyzed.code, 0, analyzed.stderr);
  assert.match(analyzed.stdout, /钢琴/);
  assert.match(analyzed.stdout, /样本不足/);

  const out = join(root, 'look.json');
  const saved = await cli(root, ['look', '--out', out]);
  assert.deepEqual(Object.keys(json(saved)).slice(0, 2), ['ok', 'out']);
  assert.ok(JSON.parse(await readFile(out, 'utf8')).items);
});

test('write - 从 stdin 读内容，带 etag 整文替换', async (t) => {
  const { root } = await temporaryProject(t);
  const nodeId = json(await cli(root, ['write', '--new', '草稿'])).node;
  const first = json(await cli(root, ['read', `nodes/${nodeId}/index.md`]));
  const replaced = await cli(root, ['write', `nodes/${nodeId}/index.md`, '-', '--etag', first.etag, '--replace-all'], { input: '# 草稿\n\n整文替换后的内容\n' });
  assert.equal(replaced.code, 0, replaced.stderr);
  const after = json(await cli(root, ['read', `nodes/${nodeId}/index.md`]));
  assert.match(after.content, /整文替换后的内容/);
});
