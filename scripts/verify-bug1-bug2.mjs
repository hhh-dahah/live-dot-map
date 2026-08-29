// 端到端验证：bug1（切项目 Agent 跟随） + bug2（owner 参数/建节点即建文件）
// 用法：node scripts/verify-bug1-bug2.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recordCurrentProject, currentProjectFile } from '../src/bridge/current-project.mjs';

const PROJECT_A = resolve('D:/桌面/活点地图/live-dot-map/ui设计 html');
const base = await mkdtemp(join(tmpdir(), 'livedot-e2e-'));
const PROJECT_B = join(base, 'project-b');
await mkdir(join(PROJECT_B, '.live-dot-map'), { recursive: true });

const FIND = process.argv[2] || 'livedot.mjs';
const child = spawn(process.execPath, [resolve(FIND), 'mcp', '--project', PROJECT_A], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '';
const pending = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const resolver = pending.get(msg.id);
    if (resolver) { pending.delete(msg.id); resolver(msg); }
  }
});

let nextId = 1;
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolvePromise) => {
    pending.set(id, resolvePromise);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function fail(message) {
  console.error('❌', message);
  child.kill();
  rm(base, { recursive: true, force: true }).finally(() => process.exit(1));
}

try {
  const init = await call('initialize');
  if (!init.result?.serverInfo) fail('initialize 失败');
  const list1 = await call('tools/list');
  if (!Array.isArray(list1.result?.tools) || list1.result.tools.length !== 25) fail('tools/list 应为 25 项');

  // bug1a：初始跟随 PROJECT_A（active map = 第四轮排查 map-mt421fju）
  const ctxA = await call('tools/call', { name: 'map_list', arguments: {} });
  const a = ctxA.result?.structuredContent ?? JSON.parse(ctxA.result?.content?.[0]?.text || '{}');
  console.log('A 项目 activeMap =', a.activeMap);
  if (a.activeMap !== 'map-mt421fju') fail(`期望 PROJECT_A 的 map-mt421fju，实际 ${a.activeMap}`);

  // bug2a：owner 参数写 markdown（需要在 PROJECT_A 建节点）
  const create = await call('tools/call', { name: 'map_apply_commands', arguments: {
    commands: [{ op: 'create', collection: 'nodes', value: { id: 'e2e-node', name: 'E2E节点', type: '目标', kind: 'goal', x: 10, y: 10 } }],
    commandId: 'e2e-create-node',
  } });
  if (create.error) fail(`create 失败: ${create.error.message}`);
  const read = await call('tools/call', { name: 'map_read_markdown', arguments: { ownerKind: 'node', ownerId: 'e2e-node', fileName: 'index.md' } });
  if (read.error) fail(`read(owner) 失败: ${read.error.message}`);
  const write = await call('tools/call', { name: 'map_write_markdown', arguments: {
    ownerKind: 'node', ownerId: 'e2e-node', fileName: 'index.md',
    content: '# E2E节点\n\nowner 参数写入成功', baseEtag: read.result.structuredContent.etag,
  } });
  if (write.error) fail(`write(owner) 失败: ${write.error.message}`);
  const readback = await call('tools/call', { name: 'map_read_markdown', arguments: { ownerKind: 'node', ownerId: 'e2e-node', fileName: 'index.md' } });
  const content = readback.result.structuredContent.content;
  if (!content.includes('owner 参数写入成功')) fail('owner 参数写入未生效');

  // bug2b：append 用 path 参数
  const append = await call('tools/call', { name: 'map_append_markdown', arguments: {
    path: '.live-dot-map/maps/map-mt421fju/nodes/e2e-node/index.md',
    content: '\nappend path 追加成功', commandId: 'e2e-append-1',
  } });
  if (append.error) fail(`append(path) 失败: ${append.error.message}`);
  const readback2 = await call('tools/call', { name: 'map_read_markdown', arguments: { ownerKind: 'node', ownerId: 'e2e-node', fileName: 'index.md' } });
  if (!readback2.result.structuredContent.content.includes('append path 追加成功')) fail('append 未生效');
  console.log('✔ bug2：owner 写 / path 追加 均成功');

  // bug2c：建节点即建文件 + 卡片（v8 链路的 real 证据）
  const nodeDir = join(PROJECT_A, '.live-dot-map', 'maps', 'map-mt421fju', 'nodes', 'e2e-node');
  const indexExists = await readFile(join(nodeDir, 'index.md'), 'utf8').then(() => true).catch(() => false);
  if (!indexExists) fail('create 后 index.md 不存在（有记录无文件）');
  const indexJson = join(PROJECT_A, '.live-dot-map', 'maps', 'map-mt421fju', '.bridge', 'md-index.json');
  const cards = JSON.parse(await readFile(indexJson, 'utf8'));
  if (!cards.cards['.live-dot-map/maps/map-mt421fju/nodes/e2e-node/index.md']) fail('md-index.json 无该节点卡片');
  console.log('✔ bug2：建节点即 index.md + 卡片');

  // bug1b：切指针到 PROJECT_B → 下一次调用跟随（new instance）
  await recordCurrentProject(PROJECT_B);
  const ctxB = await call('tools/call', { name: 'map_list', arguments: {} });
  const b = ctxB.result?.structuredContent ?? JSON.parse(ctxB.result?.content?.[0]?.text || '{}');
  console.log('B 项目 maps =', (b.maps || []).map((m) => m.id).join(','));
  if ((b.maps || []).some((m) => m.id === 'map-mt421fju')) fail('切到 B 后仍看到 A 的地图');
  console.log(`✔ bug1：指针切到 B 后 map_list 跟随（activeMap=${b.activeMap}）`);

  // bug1c：切回 A → 跟随回来（实例缓存命中）
  await recordCurrentProject(PROJECT_A);
  const ctxA2 = await call('tools/call', { name: 'map_list', arguments: {} });
  const a2 = ctxA2.result?.structuredContent ?? JSON.parse(ctxA2.result?.content?.[0]?.text || '{}');
  if (a2.activeMap !== 'map-mt421fju') fail('切回 A 未跟随');
  console.log('✔ bug1：切回 A 跟随（activeMap=' + a2.activeMap + '）');

  console.log('\n✅ 全部端到端验证通过');
} catch (error) {
  fail(`异常: ${error.message}`);
} finally {
  child.stdin.end();
  child.kill();
  await rm(base, { recursive: true, force: true }).catch(() => undefined);
}