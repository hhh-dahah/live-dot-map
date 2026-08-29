import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { MdIndex } from '../../src/bridge/md-index.mjs';
import { collect } from '../../src/bridge/context-document-provider.mjs';

const MAP_KEY = 'map-scale-test';

/** 注入计数 fs：只数 readFile（= 全文读取次数），stat/readdir 直通。 */
function countingFs(base) {
  let reads = 0;
  return {
    readFile: async (path, ...rest) => { reads += 1; return base.readFile(path, ...rest); },
    stat: base.stat,
    readdir: base.readdir,
    reads: () => reads,
    reset: () => { reads = 0; },
  };
}

async function makeProject(t, nodeCount = 3) {
  const root = await mkdtemp(join(tmpdir(), 'livedot-index-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const mapRoot = join(root, '.live-dot-map', 'maps', MAP_KEY);
  await mkdir(join(mapRoot, 'nodes'), { recursive: true });
  const nodes = [];
  for (let index = 1; index <= nodeCount; index += 1) {
    const id = `n${index}`;
    const dir = join(mapRoot, 'nodes', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.md'), `# 节点${index}\n\n这是节点 ${index} 的正文内容，用于测试智能索引。\n`, 'utf8');
    nodes.push({ id, num: String(index).padStart(2, '0'), name: `节点${index}`, type: '目标', kind: 'goal', x: index, y: index, md: `.live-dot-map/maps/${MAP_KEY}/nodes/${id}/index.md`, createdAt: '2026-08-21T00:00:00.000Z' });
  }
  return { root, mapRoot, document: { mapId: 'map-x', version: 2, revision: 1, nodes, routes: [], edges: [], anns: [] } };
}

test('卡片：建卡 → 摘要入卡 → 指纹失效自动重读刷新 → 全量/定向通', async (t) => {
  const { root, mapRoot } = await makeProject(t, 2);
  const base = await import('node:fs/promises');
  const fs = countingFs(base);
  const index = new MdIndex({ projectRoot: root, mapKey: MAP_KEY, fs });
  await index.load();
  await index.ensureBuilt({ mapRoot });

  assert.equal(index.size(), 2, '两张节点卡');
  const card = index.get(`.live-dot-map/maps/${MAP_KEY}/nodes/n1/index.md`);
  assert.match(card.title, /节点1/);
  assert.match(card.summary, /节点 1 的正文内容/);
  assert.ok(card.etag && card.bytes > 0);

  // 指纹新鲜：不再读文件
  fs.reset();
  await index.getOrRefreshCard({ mapRoot, relativePath: `.live-dot-map/maps/${MAP_KEY}/nodes/n1/index.md` });
  assert.equal(fs.reads(), 0, '新鲜卡片不触发全文读取');

  // 外部编辑器改文件：指纹失效 → 重读这一张刷新
  await writeFile(join(mapRoot, 'nodes', 'n1', 'index.md'), '# 节点1改\n\n最新内容一号\n', 'utf8');
  fs.reset();
  const refreshed = await index.getOrRefreshCard({ mapRoot, relativePath: `.live-dot-map/maps/${MAP_KEY}/nodes/n1/index.md` });
  assert.equal(fs.reads(), 1, '只重读被改动的那一张');
  assert.match(refreshed.title, /节点1改/);
  assert.match(refreshed.summary, /最新内容一号/);
});

test('损坏索引文件降级为空，ensureBuilt 重建不崩', async (t) => {
  const { root, mapRoot } = await makeProject(t, 1);
  const indexPath = join(root, '.live-dot-map', 'maps', MAP_KEY, '.bridge', 'md-index.json');
  await mkdir(join(root, '.live-dot-map', 'maps', MAP_KEY, '.bridge'), { recursive: true });
  await writeFile(indexPath, '{broken json', 'utf8');
  const index = new MdIndex({ projectRoot: root, mapKey: MAP_KEY });
  await index.load();
  await index.ensureBuilt({ mapRoot });
  assert.equal(index.size(), 1, '损坏索引后按需重建');
  const card = index.get(`.live-dot-map/maps/${MAP_KEY}/nodes/n1/index.md`);
  assert.ok(card, '重建后有卡');
});

test('保存 hook：refreshPathAndPersist 只刷该 owner，资产清单随目录更新', async (t) => {
  const { root, mapRoot } = await makeProject(t, 2);
  const index = new MdIndex({ projectRoot: root, mapKey: MAP_KEY });
  await index.ensureBuilt({ mapRoot });

  // 挂一个图片资产 + 改补充 md
  await writeFile(join(mapRoot, 'nodes', 'n1', 'evidence.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'utf8');
  await writeFile(join(mapRoot, 'nodes', 'n1', 'note.md'), '# 补充\n\n补充资料内容', 'utf8');
  await index.refreshPathAndPersist({ relativePath: `.live-dot-map/maps/${MAP_KEY}/nodes/n1/index.md` });

  const card = index.get(`.live-dot-map/maps/${MAP_KEY}/nodes/n1/index.md`);
  assert.deepEqual(card.assets, ['evidence.png'], '资产进入卡片作为下探线索');
  assert.ok(index.get(`.live-dot-map/maps/${MAP_KEY}/nodes/n1/note.md`), '补充 md 也建卡');
  // n2 不受影响
  assert.equal(index.get(`.live-dot-map/maps/${MAP_KEY}/nodes/n2/index.md`).assets.length, 0);
});

test('规模：500 节点时 collect 二次查询全文读取为 0，外部改一个只重读一个', async (t) => {
  const { root, mapRoot, document } = await makeProject(t, 500);
  const base = await import('node:fs/promises');
  const fs = countingFs(base);

  const index = new MdIndex({ projectRoot: root, mapKey: MAP_KEY, fs });
  await index.load();
  fs.reset();

  // 第一次 collect：无索引 → 一次性建卡（读取次数 = 卡片数级）
  const first = await collect({ projectRoot: root, mapKey: MAP_KEY, document, mdIndex: index });
  assert.equal(first.markdown.length, 500, '500 个 md 都进上下文（摘要）');
  assert.ok(fs.reads() >= 500 && fs.reads() <= 600, `首次建卡读取 ${fs.reads()} 次（应为 500±）`);
  assert.equal(first.markdown[0].summaryOnly, true, '上下文条目是摘要而非全文');
  assert.match(first.markdown[0].text, /节点 1 的正文内容/);

  // 第二次 collect：全部命中卡片 → 0 次全文读取（极致省）
  fs.reset();
  const second = await collect({ projectRoot: root, mapKey: MAP_KEY, document, mdIndex: index });
  assert.equal(fs.reads(), 0, `二次查询全文读取 ${fs.reads()} 次（必须为 0）`);
  assert.equal(second.markdown.length, 500);

  // 外部改 n250：第三次只重读 1 次
  await writeFile(join(mapRoot, 'nodes', 'n250', 'index.md'), '# 节点250改\n\n被外部编辑器更新了\n', 'utf8');
  fs.reset();
  const third = await collect({ projectRoot: root, mapKey: MAP_KEY, document, mdIndex: index });
  assert.equal(fs.reads(), 1, `外部改动后只重读 ${fs.reads()} 张（应=1）`);
  assert.equal(third.markdown.find((item) => item.path.endsWith('/nodes/n250/index.md')).text.includes('被外部编辑器更新了'), true);
});