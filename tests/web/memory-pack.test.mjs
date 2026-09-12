import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import {
  MAX_PACK_ASSET_BYTES,
  PACK_FORMAT,
  STUB_SUFFIX,
  buildMemoryPack,
  isExcludedFromPack,
  makeStubContent,
  normalizePackPath,
  parseMemoryPack,
  parseStubContent,
  sniffMemoryPack,
} from '../../src/web/memory-pack.mjs';

const DOC = {
  mapId: 'map-test', version: 2, revision: 3, lastEventId: 3,
  name: '测试地图', createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z',
  view: { x: 0, y: 0, k: 1 }, ui: {}, counters: { num: 1, edge: 0, ann: 0, nodeName: 0, edgeName: 0, routeName: 0 },
  routes: [], nodes: [{ id: 'n1', num: '01', name: '节点一', kind: 'goal' }], edges: [], anns: [],
};

test('打包→解包 round-trip：文档与文件完整还原', async () => {
  const { zip, manifest } = await buildMemoryPack({
    document: DOC,
    files: [
      { path: 'nodes/n1/index.md', data: strToU8('# 你好') },
      { path: 'nodes/n1/pic.png', data: new Uint8Array([1, 2, 3]) },
    ],
  });
  assert.equal(manifest.format, PACK_FORMAT);
  assert.equal(manifest.files.length, 2);
  assert.ok(sniffMemoryPack(zip));
  const parsed = await parseMemoryPack(zip);
  assert.equal(parsed.document.name, '测试地图');
  const paths = parsed.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['nodes/n1/index.md', 'nodes/n1/pic.png']);
});

test('归档冷数据与桥内部文件不进包', async () => {
  assert.equal(isExcludedFromPack('nodes/n1/.archive/old.md'), true);
  assert.equal(isExcludedFromPack('.bridge/wal.ndjson'), true);
  const { manifest } = await buildMemoryPack({
    document: DOC,
    files: [
      { path: 'nodes/n1/.archive/old.md', data: strToU8('x') },
      { path: 'nodes/n1/index.md', data: strToU8('# a') },
    ],
  });
  assert.equal(manifest.files.length, 1);
});

test('超大附件转为 stub：字节不入包、stub 不含绝对路径', async () => {
  const big = new Uint8Array(MAX_PACK_ASSET_BYTES + 1);
  const { zip, manifest } = await buildMemoryPack({
    document: DOC,
    files: [{ path: 'nodes/n1/demo.mp4', data: big }],
  });
  assert.equal(manifest.stubs.length, 1);
  assert.equal(manifest.files.length, 0);
  const parsed = await parseMemoryPack(zip);
  const stub = parsed.files.find((f) => f.path.endsWith(STUB_SUFFIX));
  assert.ok(stub, '应生成 .stub.md 占位文件');
  const content = new TextDecoder().decode(stub.data);
  assert.match(content, /livedot-stub/);
  assert.ok(!/[A-Za-z]:[\\/]/.test(content), 'stub 不得包含本机绝对路径');
  assert.ok(!/https?:\/\//.test(content), 'stub 不得包含云链接');
  assert.deepEqual(parseStubContent(content), { name: 'demo.mp4', sizeBytes: big.byteLength });
  // 原始大文件本身绝不在包里
  assert.ok(!parsed.files.some((f) => f.path.endsWith('demo.mp4')));
});

test('调用方可只给大小直接生成 stub（大文件不读内存）', async () => {
  const { manifest } = await buildMemoryPack({
    document: DOC,
    files: [{ path: 'nodes/n1/huge.mov', stub: true, sizeBytes: 200 * 1024 * 1024 }],
  });
  assert.equal(manifest.stubs[0].sizeBytes, 200 * 1024 * 1024);
});

test('forceInclude 的大文件按原样入包（导出对话框显式勾选/全量打包）', async () => {
  const big = new Uint8Array(MAX_PACK_ASSET_BYTES + 1).fill(9);
  const { zip, manifest } = await buildMemoryPack({
    document: DOC,
    files: [{ path: 'nodes/n1/keep.png', data: big, forceInclude: true }],
  });
  assert.equal(manifest.stubs.length, 0);
  assert.equal(manifest.files.length, 1);
  const parsed = await parseMemoryPack(zip);
  const kept = parsed.files.find((f) => f.path === 'nodes/n1/keep.png');
  assert.ok(kept, 'forceInclude 文件应以原路径入包');
  assert.equal(kept.data.byteLength, big.byteLength);
});

test('Zip Slip 与非法路径一律拒绝', () => {
  for (const bad of ['../evil.txt', 'a/../../evil.txt', 'C:/evil.txt', '/abs.txt', 'a/b.txt:ADS', 'CON', 'a/trailing.txt /x.md', 'a/. /x.md']) {
    assert.throws(() => normalizePackPath(bad), undefined, `应拒绝：${bad}`);
  }
  assert.equal(normalizePackPath('nodes\\n1\\index.md'), 'nodes/n1/index.md');
  assert.equal(normalizePackPath('./nodes/n1/index.md'), 'nodes/n1/index.md');
});

test('恶意 zip（含路径穿越条目）解包即抛错', async () => {
  const evil = zipSync({ '../evil.txt': strToU8('x'), 'map.json': strToU8('{}') });
  await assert.rejects(() => parseMemoryPack(evil), /路径穿越/);
});

test('嵌套一层文件夹的 zip 自动下探', async () => {
  const nested = zipSync({
    '外层/manifest.json': strToU8(JSON.stringify({ format: PACK_FORMAT, files: [] })),
    '外层/map.json': strToU8(JSON.stringify(DOC)),
    '外层/nodes/n1/index.md': strToU8('# 嵌套'),
  });
  const parsed = await parseMemoryPack(nested);
  assert.equal(parsed.document.name, '测试地图');
  assert.deepEqual(parsed.files.map((f) => f.path), ['nodes/n1/index.md']);
});

test('manifest 登记文件被篡改时校验失败', async () => {
  const { zip, manifest } = await buildMemoryPack({
    document: DOC,
    files: [{ path: 'nodes/n1/index.md', data: strToU8('# 原始') }],
  });
  const tampered = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'map.json': strToU8(JSON.stringify(DOC)),
    'nodes/n1/index.md': strToU8('# 被篡改'),
  });
  await assert.rejects(() => parseMemoryPack(tampered), /校验失败/);
  assert.ok(zip.length > 0);
});

test('非 zip、缺 map.json、format 不匹配都有明确报错', async () => {
  await assert.rejects(() => parseMemoryPack(strToU8('not a zip')), /zip/);
  await assert.rejects(() => parseMemoryPack(zipSync({ 'a.txt': strToU8('x') })), /map\.json/);
  const foreign = zipSync({
    'manifest.json': strToU8(JSON.stringify({ format: 'other-tool' })),
    'map.json': strToU8('{}'),
  });
  await assert.rejects(() => parseMemoryPack(foreign), /format/);
  assert.equal(sniffMemoryPack(strToU8('not a zip')), false);
  assert.equal(sniffMemoryPack(foreign), false);
});

test('stub 内容生成与解析互逆；非 stub 返回 null', () => {
  const content = makeStubContent({ name: '视频.mp4', sizeBytes: 12345 });
  assert.deepEqual(parseStubContent(content), { name: '视频.mp4', sizeBytes: 12345 });
  assert.equal(parseStubContent('# 普通文档'), null);
});
