// 节点导入导出端到端：两台“电脑”= 两个各自独立的项目和桥，编号都从 n1 开始，必然撞号。
// 在 A 上右键导出“节点及下游”，在 B 上右键“导入节点到此节点下”，核对 B 的 map.json 和资料包文件。
// 顺带核对整图记忆包会带上方案线（连线）的资料包。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP = join(ROOT, 'app.html');
const RUNTIME = join(ROOT, 'livedot.mjs');
const TEMPLATE = join(ROOT, 'agent-kit', 'map.template.json');
// 与 bridge-browser 相同：测试数据只放在这个一次性目录，不碰真实项目。
const TEST_ROOT = 'D:\\LiveDotMap-Test';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const T = '2026-01-01T00:00:00.000Z';
const meta = { createdAt: T, updatedAt: T, createdBy: 'human', updatedBy: 'human', updatedRevision: 0 };

async function seedProject(project, mutate) {
  const mapDir = join(project, '.live-dot-map', 'maps', 'default');
  await mkdir(mapDir, { recursive: true });
  await cp(TEMPLATE, join(mapDir, 'map.json'));
  const map = JSON.parse(await readFile(join(mapDir, 'map.json'), 'utf8'));
  map.view = { x: 500, y: 350, k: 1 }; // 原点在左上角会被顶栏挡住，右键点不到
  mutate(map);
  await writeFile(join(mapDir, 'map.json'), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  return mapDir;
}

const node = (id, name, x, y, route = null) => ({ id, num: id.slice(1).padStart(2, '0'), name, kind: 'goal', type: '目标', route, x, y, md: `.live-dot-map/maps/default/nodes/${id}/index.md`, ...meta });
const edge = (id, from, to, name, extra = {}) => ({ id, from, to, name, status: to ? 'success' : 'pending', route: null, md: `.live-dot-map/maps/default/routes/${id}/index.md`, ...meta, ...extra });

async function startBridge(project) {
  const sandbox = join(project, '.sandbox');
  const home = join(sandbox, 'home');
  await mkdir(home, { recursive: true });
  const child = spawn(process.execPath, [RUNTIME, 'serve', '--project', project, '--app', APP], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      LIVEDOT_CURRENT_PROJECT_FILE: join(sandbox, 'current-project.json'),
      LIVEDOT_RECENT_PROJECTS_FILE: join(sandbox, 'recent-projects.json'),
      LIVEDOT_RUNTIME_STATE_DIR: join(sandbox, 'runtime'),
      LIVEDOT_LOG_DIR: join(sandbox, 'logs'),
      LIVEDOT_MAP_LEDGER_FILE: join(sandbox, 'known-maps.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const line = await new Promise((resolveLine, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error(`bridge start timeout: ${stderr}`)), 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index >= 0) { clearTimeout(timeout); resolveLine(buffer.slice(0, index)); }
    });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`bridge exited ${code}: ${stderr}`)); });
  });
  return { child, ...JSON.parse(line) };
}

async function openCanvas(browser, url, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.addInitScript(() => localStorage.setItem('dotmap-guide-seen', '1'));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LiveDotBridge?.active === true, undefined, { timeout: 15_000 });
  try {
    await page.waitForFunction(() => ['已保存', '正常'].includes(document.querySelector('#sync-label')?.textContent), undefined, { timeout: 10_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({ label: document.querySelector('#sync-label')?.textContent, title: document.querySelector('#sync-dot')?.getAttribute('title'), toast: document.querySelector('#toast')?.textContent }));
    throw new Error(`画布未就绪 ${JSON.stringify(state)}；${errors.join('; ')}`, { cause: error });
  }
  return page;
}

async function waitFor(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch (error) { last = error; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`等待超时：${label}${last ? `（${last.message}）` : ''}`);
}

async function download(page, trigger, folder) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), trigger()]);
  const path = join(folder, file.suggestedFilename());
  await file.saveAs(path);
  return path;
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name))).map((name) => `${entry.name}/${name}`));
    else out.push(entry.name);
  }
  return out;
}

await mkdir(TEST_ROOT, { recursive: true });
const workspace = await mkdtemp(join(TEST_ROOT, 'node-pack-'));
const machineA = join(workspace, '主电脑');
const machineB = join(workspace, '测试机');
const downloads = join(workspace, 'downloads');
await mkdir(downloads, { recursive: true });

await seedProject(machineA, (map) => {
  map.nodes[0].name = '根节点';
  map.nodes.push(node('n2', '子节点', 200, 0, 'r1'), node('n3', '孙节点', 400, 0), node('n4', '上游', -200, 0));
  map.edges.push(
    edge('e1', 'n1', 'n2', '方案甲', { route: 'r1' }),
    edge('e2', 'n2', 'n3', '方案乙'),
    edge('e3', 'n1', null, '待验证', { dx: 120, dy: 80 }),
    edge('e4', 'n4', 'n1', '上游连线'),
  );
  map.counters = { ...map.counters, num: 5, edge: 5 };
});
const mapDirB = await seedProject(machineB, (map) => {
  map.nodes[0].name = '测试机根';
  map.nodes.push(node('n2', '测试机已有', 0, 200));
  map.edges.push(edge('e1', 'n1', 'n2', '测试机已有连线'));
  map.counters = { ...map.counters, num: 3, edge: 2 };
});

const SYSTEM_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    // 没装 Playwright 自带浏览器时退回系统 Chrome。
    if (!existsSync(SYSTEM_CHROME)) throw error;
    return chromium.launch({ headless: true, executablePath: SYSTEM_CHROME });
  }
}

const errors = [];
let bridgeA, bridgeB, browser;
try {
  bridgeA = await startBridge(machineA);
  bridgeB = await startBridge(machineB);
  browser = await launchBrowser();
  // ---------- 主电脑：写资料包，导出 ----------
  const pageA = await openCanvas(browser, bridgeA.url, errors);
  await pageA.evaluate(async (png) => {
    const bridge = window.LiveDotBridge;
    const replaceIndex = async (kind, id, content) => {
      // 种子对象没走建节点命令，主文档要先 ensure 出来（画布打开 Markdown 时也是这么做的）。
      await bridge.readMarkdown(`.live-dot-map/maps/default/${kind === 'node' ? 'nodes' : 'routes'}/${id}/index.md`, { create: true, title: id });
      const current = await bridge.readBundleMarkdown(kind, id, 'index.md');
      await bridge.replaceBundleMarkdown(kind, id, 'index.md', content, String(current.etag || ''));
    };
    await replaceIndex('node', 'n2', '# 子节点\n\n子节点正文 ZZ-正文\n');
    await bridge.createBundleMarkdown('node', 'n2', 'notes.md', '# 补充\n\n补充资料 NN-补充\n');
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    await bridge.importAsset('node', 'n3', new Blob([bytes], { type: 'image/png' }), '截图.png');
    await replaceIndex('route', 'e1', '# 方案甲\n\n方案说明 E1-方案\n');
  }, PNG_1PX);

  await pageA.locator('.node[data-id="n1"]').click({ button: 'right' });
  const treePack = await download(pageA, () => pageA.locator('#menu button[data-mi="export-tree"]').click(), downloads);
  const treeEntries = unzipSync(new Uint8Array(await readFile(treePack)));
  const manifest = JSON.parse(strFromU8(treeEntries['manifest.json']));
  assert.deepEqual(manifest.scope, { kind: 'nodes', rootId: 'n1', downstream: true });
  const treeDoc = JSON.parse(strFromU8(treeEntries['map.json']));
  assert.deepEqual(treeDoc.nodes.map((n) => n.id).sort(), ['n1', 'n2', 'n3'], '下游不含上游节点');
  assert.deepEqual(treeDoc.edges.map((e) => e.id).sort(), ['e1', 'e2', 'e3']);
  for (const path of ['nodes/n2/index.md', 'nodes/n2/notes.md', 'routes/e1/index.md']) assert.ok(treeEntries[path], `节点包缺少 ${path}`);
  assert.ok(Object.keys(treeEntries).some((path) => path.startsWith('nodes/n3/') && path.endsWith('截图.png')), '节点包缺少图片');

  await pageA.locator('.node[data-id="n4"]').click({ button: 'right' });
  const singlePack = await download(pageA, () => pageA.locator('#menu button[data-mi="export-node"]').click(), downloads);
  const singleDoc = JSON.parse(strFromU8(unzipSync(new Uint8Array(await readFile(singlePack)))['map.json']));
  assert.deepEqual(singleDoc.nodes.map((n) => n.id), ['n4']);
  assert.deepEqual(singleDoc.edges, [], '单节点不带指向包外的连线');

  await pageA.locator('#project-pill').click();
  const fullPack = await download(pageA, () => pageA.getByText('导出记忆包 (.zip)').click(), downloads);
  assert.ok(unzipSync(new Uint8Array(await readFile(fullPack)))['routes/e1/index.md'], '整图记忆包要带上方案线的资料包');

  // ---------- 测试机：导入到已有节点下 ----------
  const pageB = await openCanvas(browser, bridgeB.url, errors);
  await pageB.locator('.node[data-id="n1"]').click({ button: 'right' });
  const [chooser] = await Promise.all([pageB.waitForEvent('filechooser'), pageB.locator('#menu button[data-mi="import-under"]').click()]);
  await chooser.setFiles(treePack);

  const mapB = await waitFor(async () => {
    const map = JSON.parse(await readFile(join(mapDirB, 'map.json'), 'utf8'));
    return map.nodes.length === 5 && map.edges.length === 5 ? map : null;
  }, '测试机 map.json 出现导入的节点');
  const byName = Object.fromEntries(mapB.nodes.map((n) => [n.name, n]));
  assert.equal(byName['测试机根'].id, 'n1', '原有节点不能被改号');
  assert.equal(byName['测试机已有'].id, 'n2');
  assert.deepEqual(['根节点', '子节点', '孙节点'].map((name) => byName[name]?.id), ['n3', 'n4', 'n5'], '导入节点接着测试机的编号');
  assert.ok(mapB.nodes.every((n) => n.route === null || mapB.routes.some((r) => r.id === n.route)), '路线引用必须有效');
  const edges = Object.fromEntries(mapB.edges.map((e) => [e.name, e]));
  assert.equal(edges['测试机已有连线'].id, 'e1');
  assert.deepEqual([edges['方案甲'].from, edges['方案甲'].to], ['n3', 'n4']);
  assert.deepEqual([edges['方案乙'].from, edges['方案乙'].to], ['n4', 'n5']);
  assert.equal(edges['待验证'].to, null);
  const link = mapB.edges.find((e) => e.from === 'n1' && e.to === 'n3');
  assert.ok(link, '导入到节点下要自动连一条线');
  assert.equal(new Set(mapB.edges.map((e) => e.id)).size, mapB.edges.length, '连线不能撞号');

  const newE1 = edges['方案甲'].id;
  await waitFor(async () => (await readFile(join(mapDirB, 'nodes', 'n4', 'index.md'), 'utf8')).includes('ZZ-正文'), '子节点正文');
  await waitFor(async () => (await readFile(join(mapDirB, 'nodes', 'n4', 'notes.md'), 'utf8')).includes('NN-补充'), '补充资料');
  await waitFor(async () => (await readFile(join(mapDirB, 'routes', newE1, 'index.md'), 'utf8')).includes('E1-方案'), '方案线资料');
  await waitFor(async () => (await listFiles(join(mapDirB, 'nodes', 'n5'))).some((name) => name.endsWith('截图.png')), '图片');
  const untouched = await readFile(join(mapDirB, 'nodes', 'n2', 'index.md'), 'utf8').catch(() => '');
  assert.ok(!untouched.includes('ZZ-正文'), '撞号的原有节点资料不能被覆盖');

  // ---------- 测试机：画布空白处再导入一次单节点 ----------
  await pageB.locator('#viewport').click({ button: 'right', position: { x: 900, y: 600 }, force: true });
  const [chooser2] = await Promise.all([pageB.waitForEvent('filechooser'), pageB.locator('#menu button[data-mi="import-nodes"]').click()]);
  await chooser2.setFiles(singlePack);
  const mapB2 = await waitFor(async () => {
    const map = JSON.parse(await readFile(join(mapDirB, 'map.json'), 'utf8'));
    return map.nodes.length === 6 ? map : null;
  }, '第二次导入');
  assert.equal(mapB2.nodes.find((n) => n.name === '上游')?.id, 'n6');

  assert.deepEqual(errors, [], `页面报错：${errors.join('; ')}`);
  console.log('✔ 节点导入导出端到端通过');
} finally {
  await browser?.close();
  bridgeA?.child.kill();
  bridgeB?.child.kill();
  await new Promise((r) => setTimeout(r, 500));
  if (process.env.LIVEDOT_KEEP_TEST_DATA !== '1') await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
