import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP = join(ROOT, 'app.html');
const RUNTIME = join(ROOT, 'livedot.mjs');
const TEMPLATE = join(ROOT, 'agent-kit', 'map.template.json');
const OUTPUT = join(ROOT, 'output', 'playwright');
// Browser/bridge smoke data must stay in this explicit, disposable location;
// never create project fixtures in the user's OS temp folder or a real project.
const TEST_ROOT = 'D:\\LiveDotMap-Test';

async function startBridge(projectRoot) {
  const child = spawn(process.execPath, [RUNTIME, 'serve', '--project', projectRoot, '--app', APP], {
    cwd: ROOT,
    env: { ...process.env, LIVEDOT_RECENT_PROJECTS_FILE: join(TEST_ROOT, 'recent-projects.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const line = await new Promise((resolveLine, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error(`bridge start timeout: ${stderr}`)), 10_000);
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

async function waitRevision(mapPath, minimum) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const map = JSON.parse(await readFile(mapPath, 'utf8'));
    if (map.revision >= minimum) return map;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`revision did not reach ${minimum}`);
}

async function waitForFileText(path, expected) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const text = await readFile(path, 'utf8');
      if (text.includes(expected)) return text;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Markdown did not contain ${expected}`);
}

await mkdir(OUTPUT, { recursive: true });
await mkdir(TEST_ROOT, { recursive: true });
const engines = process.env.LIVEDOT_SYSTEM_BROWSERS === '1'
  ? {
      chrome: { engine: chromium, options: { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } },
      edge: { engine: chromium, options: { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' } },
    }
  : {
      chromium: { engine: chromium, options: {} },
      firefox: { engine: firefox, options: { ...(process.env.LIVEDOT_FIREFOX ? { executablePath: process.env.LIVEDOT_FIREFOX } : {}), ...(process.env.LIVEDOT_HEADED_FIREFOX === '1' ? { headless: false } : {}) } },
      webkit: { engine: webkit, options: {} },
    };
if (process.env.LIVEDOT_BROWSER) {
  for (const name of Object.keys(engines)) if (name !== process.env.LIVEDOT_BROWSER) delete engines[name];
}
const results = [];

for (const [name, descriptor] of Object.entries(engines)) {
  const project = await mkdtemp(join(TEST_ROOT, `livedot-${name}-`));
  const data = join(project, '.live-dot-map');
  const mapPath = join(data, 'map.json');
  await mkdir(data, { recursive: true });
  await cp(TEMPLATE, mapPath);
    const seed = JSON.parse(await readFile(mapPath, 'utf8'));
    seed.routes[0].currentNodeId = 'n1';
    seed.nodes[0].name = '<img src=x onerror=alert(1)>';
    seed.nodes[0].createdBy = 'agent:codex';
    seed.nodes[0].updatedBy = 'agent:codex';
    seed.edges.push({
      id: 'e1', from: 'n1', to: null, route: 'r1', name: '旧失败方案', status: 'failed', score: 20, dx: 180, dy: 0,
      md: '.live-dot-map/routes/e1.md', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'agent:codex', updatedBy: 'agent:codex', updatedRevision: 0,
    });
    seed.edges.push({
      id: 'e2', from: 'n1', to: null, route: 'r1', name: '另一个旧失败方案', status: 'failed', score: 10, dx: 180, dy: 90,
      md: '.live-dot-map/routes/e2.md', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'human', updatedBy: 'human', updatedRevision: 0,
    });
  await writeFile(mapPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  const bridge = await startBridge(project);
  const browser = await descriptor.engine.launch({ headless: true, ...descriptor.options });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('requestfailed', (request) => {
      // 事件流在页面刷新/导航时正常断开（各引擎措辞不同：NS_BINDING_ABORTED /
      // Load request cancelled），不是产品错误；功能验证依赖文件轮询而非事件流。
      if (request.url().includes('/api/v1/events')) return;
      errors.push(`request: ${request.url()} ${request.failure()?.errorText}`);
    });
    page.on('response', (response) => { if (response.status() >= 500) errors.push(`response: ${response.status()} ${response.url()}`); });
    await page.addInitScript(() => localStorage.setItem('dotmap-guide-seen', '1'));
    await page.goto(bridge.url, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => window.LiveDotBridge?.active === true, undefined, { timeout: 15_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({ href: location.href, active: window.LiveDotBridge?.active, label: document.querySelector('#sync-label')?.textContent, dot: document.querySelector('#sync-dot')?.getAttribute('title') }));
      throw new Error(`${name}: bridge inactive ${JSON.stringify(state)}; ${errors.join('; ')}`, { cause: error });
    }
    try {
      await page.waitForFunction(() => document.querySelector('#sync-label')?.textContent === '已保存', undefined, { timeout: 5_000 });
    } catch (error) {
      const state = await page.evaluate(() => ({ label: document.querySelector('#sync-label')?.textContent, title: document.querySelector('#sync-dot')?.getAttribute('title'), pill: document.querySelector('#project-pill')?.innerText }));
      throw new Error(`${name}: save badge mismatch ${JSON.stringify(state)}; ${errors.join('; ')}`, { cause: error });
    }
    // Agent discovery now probes an optional Tencent adapter too; WebKit can
    // need a little longer for the loopback response on a cold process.
    await page.waitForFunction(() => document.querySelectorAll('#agent-status-list .agent-status').length >= 3, undefined, { timeout: 15_000 });
    const agentStatusRows = await page.locator('#agent-status-list .agent-status').count();
    await page.waitForFunction(() => window.LiveDotApp?.serialize()?.nodes?.[0]?.name === '<img src=x onerror=alert(1)>');
    await page.waitForFunction(() => document.querySelector('.node')?.textContent?.includes('<img'));
    assert.equal(await page.locator('.node img').count(), 0, `${name}: malicious HTML became an element`);
    assert.match((await page.locator('.node').first().innerText()).replace(/\s+/g, ''), /<imgsrc=x/, `${name}: external text was not rendered as text`);

    // The title has direct, discoverable renaming, and it persists through the
    // same authenticated map save as canvas edits.
    const initialNodeCount = await page.locator('.node').count();
    await page.locator('#proj-name').dblclick();
    await page.locator('input.inline-edit').fill('浏览器回归地图');
    await page.locator('input.inline-edit').press('Enter');
    await page.waitForFunction(() => window.LiveDotApp?.serialize()?.name === '浏览器回归地图');
    const renamed = await waitRevision(mapPath, 1);
    assert.equal(renamed.name, '浏览器回归地图', `${name}: map title did not persist`);

    // Startup must register the actual canvas handlers: create a node through
    // the visible tool, then ensure a refresh keeps the bridge session/map.
    await page.locator('#toolbar [data-tool="node"]').click();
    await page.locator('#viewport').click({ position: { x: 700, y: 650 }, force: true });
    await page.waitForFunction((count) => document.querySelectorAll('.node').length === count + 1, initialNodeCount);
    const createdNodeId = await page.evaluate(() => window.LiveDotApp.serialize().nodes.at(-1).id);
    const created = await waitRevision(mapPath, renamed.revision + 1);
    assert.ok(created.nodes.some((node) => node.id === createdNodeId), `${name}: new node did not persist`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.LiveDotBridge?.active === true, undefined, { timeout: 15_000 });
    await page.waitForFunction((nodeId) => window.LiveDotApp?.serialize()?.nodes?.some((node) => node.id === nodeId), createdNodeId);
    assert.equal(await page.locator('#sync-label').textContent(), '已保存', `${name}: refresh lost strong collaboration state`);

    // Markdown is a real editable document in strong mode. A failed write
    // keeps the editor open with an explicit retry path, then the retry saves.
    await page.locator(`.node[data-id="${createdNodeId}"]`).click();
    await page.waitForSelector('#panel.on');
    await page.locator('#panel-body [data-act="open-md"]').click();
    const markdownEditor = page.getByRole('textbox', { name: /Markdown 详情/ });
    await markdownEditor.fill('# 浏览器记录\n\n可编辑且可保存。');
    await page.evaluate(() => {
      const client = window.LiveDotBridge;
      const write = client.writeMarkdown.bind(client);
      let failOnce = true;
      client.writeMarkdown = async (...args) => {
        if (failOnce) { failOnce = false; throw new Error('临时保存失败，请重试'); }
        return write(...args);
      };
    });
    const markdownSave = page.getByRole('button', { name: '保存', exact: true });
    await markdownSave.click();
    await page.waitForFunction(() => document.body.textContent?.includes('保存失败：临时保存失败，请重试'));
    await markdownSave.click();
    const markdownPath = join(data, 'nodes', `${createdNodeId}.md`);
    assert.match(await waitForFileText(markdownPath, '可编辑且可保存。'), /可编辑且可保存。/, `${name}: Markdown retry did not write the document`);
    await page.getByRole('button', { name: '关闭', exact: true }).click();

    // Right-click semantics promote a node itself to an unresolved problem;
    // the rendered node keeps the explicit red problem visual after saving.
    await page.locator(`.node[data-id="${createdNodeId}"]`).click({ button: 'right' });
    await page.locator('#menu button[data-mi="problem"]').click();
    await page.waitForFunction((nodeId) => window.LiveDotApp?.serialize()?.nodes?.find((node) => node.id === nodeId)?.kind === 'problem', createdNodeId);
    await page.waitForFunction(async (nodeId) => {
      const response = await fetch('/api/v1/snapshot');
      const snapshot = await response.json();
      const document = snapshot.document ?? snapshot.map;
      return document?.nodes?.find((node) => node.id === nodeId)?.kind === 'problem';
    }, createdNodeId);
    const problemVisual = await page.locator(`.node[data-id="${createdNodeId}"]`).evaluate((node) => {
      const dot = node.querySelector('.dot');
      const probe = document.createElement('span'); probe.style.color = 'var(--danger)'; document.body.append(probe);
      const expected = getComputedStyle(probe).color; probe.remove();
      return { kind: node.getAttribute('data-kind'), border: getComputedStyle(dot).borderTopColor, expected };
    });
    assert.deepEqual(problemVisual, { kind: 'problem', border: problemVisual.expected, expected: problemVisual.expected }, `${name}: problem node is not red`);

    await page.click('#agent-btn');
    assert.doesNotMatch(await page.locator('#drawer').innerText(), /本地桥|MCP|hook|AGENTS\.snippet/, `${name}: technical implementation terms leaked into the primary flow`);
    await page.click('#drawer-close');
    await page.locator('.node[data-id="n1"]').dispatchEvent('pointerdown', { button:0, clientX:300, clientY:300 });
    await page.locator('.node[data-id="n1"]').dispatchEvent('pointerup', { button:0, clientX:300, clientY:300 });
    await page.waitForFunction(() => S.sel?.kind === 'node' && S.sel.id === 'n1' && document.querySelector('#panel-body')?.textContent?.includes('<img'));
    assert.match(await page.locator('#panel-body').innerText(), /Agent · codex创建/, `${name}: Agent node source is not visible`);
    const revisionBeforeCanvasAnnotation = JSON.parse(await readFile(mapPath, 'utf8')).revision;
    await page.locator('#toolbar [data-tool="ann"]').click();
    await page.locator('#viewport').click({ position: { x: 900, y: 650 }, force: true });
    // 连续保存（问题节点 + 画布标注）可能共用窗口：等待「revision 递增 且 文件包含
    // 本次 canvas 标注」的落盘，而不是仅 revision 数字（避免被上一次保存满足）。
    const annDeadline = Date.now() + 10_000;
    let saved = await waitRevision(mapPath, revisionBeforeCanvasAnnotation + 1);
    while (!saved.anns.some((ann) => ann.target?.kind === 'canvas') && Date.now() < annDeadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      saved = JSON.parse(await readFile(mapPath, 'utf8'));
    }
    if (!saved.anns.some((ann) => ann.target?.kind === 'canvas')) {
      const pageState = await page.evaluate(() => ({
        memAnns: S.anns.map((a) => a.target),
        label: document.querySelector('#sync-label')?.textContent,
        pending: Boolean(window.LiveDotBridge?.pending),
        inFlight: window.LiveDotBridge?.inFlight,
        dirty: window.LiveDotBridge?.dirty,
      }));
      console.log(`[debug] ${name}: FAIL before=${revisionBeforeCanvasAnnotation} savedRev=${saved.revision} page=${JSON.stringify(pageState)}`);
    }
    assert.ok(saved.anns.some((ann) => ann.target?.kind === 'canvas'), `${name}: canvas annotation was not persisted`);
    await page.waitForFunction(() => document.querySelector('#sync-label')?.textContent === '已保存');
    const curation = await page.evaluate(async () => {
      const plan = await window.LiveDotBridge.planConsolidation({ maxSuggestions: 12 });
      const validation = await window.LiveDotBridge.request('/api/v1/mcp', { method: 'POST', body: { name: 'map_validate', arguments: {} } });
      return { revision: plan.revision, suggestions: plan.suggestions?.map((item) => item.id) || [], attemptIssues: validation.result?.attemptIssues || [] };
    });
    assert.equal(curation.revision, saved.revision);
    assert.ok(curation.suggestions.includes('archive-e1'), `${name}: failed branch was not offered for curation`);
    assert.ok(curation.attemptIssues.some((item) => item.edgeId === 'e1'), `${name}: Stop evidence check did not see missing Markdown`);
    await page.click('#more-btn');
    await page.click('#menu button[data-mi="tidy"]');
    await page.waitForSelector('#curation-dialog.on');
    await page.waitForFunction(() => {
      const meta = document.querySelector('#curation-meta')?.textContent || '';
      const empty = document.querySelector('#curation-empty')?.textContent || '';
      return Boolean(meta) || empty !== '正在读取整理建议…';
    });
    const curationMeta = await page.locator('#curation-meta').textContent();
    const curationEmpty = await page.locator('#curation-empty').textContent();
    assert.match(curationMeta || curationEmpty || '', /路线 .*→.*节点 .*→.*方案 .*→|整理未|本地桥|没有需要/);
    assert.match(curationMeta || '', /当前位置 .*（已保存）/, `${name}: stored current node source is not visible`);
    assert.match(await page.locator('#curation-list').innerText(), /对象 e1.*来源 Agent · codex/s, `${name}: curation object/source context is absent`);

    // Cancel is a zero-side-effect review action.
    const beforeCancel = JSON.parse(await readFile(mapPath, 'utf8')).revision;
    await page.click('#curation-cancel');
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    assert.equal(JSON.parse(await readFile(mapPath, 'utf8')).revision, beforeCancel, `${name}: cancel changed revision`);
    await page.click('#more-btn');
    await page.click('#menu button[data-mi="tidy"]');
    await page.waitForSelector('#curation-list input');
    await page.locator('#curation-list input').first().check();
    assert.match(await page.locator('#curation-meta').innerText(), /方案 2→1/, `${name}: selected preview does not show before/after counts`);
    await page.click('#curation-apply');
    const curated = await waitRevision(mapPath, saved.revision + 1);
    assert.equal(curated.revision, saved.revision + 1, `${name}: curation was not exactly one revision`);
    assert.equal(curated.edges.find((edge) => edge.id === 'e1')?.archived, true, `${name}: curation command did not archive failed branch`);
    assert.notEqual(curated.edges.find((edge) => edge.id === 'e2')?.archived, true, `${name}: unselected suggestion was applied`);
    await page.waitForFunction(() => document.querySelector('#sync-label')?.textContent === '已保存');

    // A stale curation cannot leave the green saved badge behind.
    const conflictState = await page.evaluate(async (revision) => {
      window.LiveDotBridge.revision = revision - 1;
      try { await window.LiveDotBridge.applyCommands([{ op:'update', collection:'edges', id:'e1', patch:{ archived:false } }]); } catch {}
      return { label:document.querySelector('#sync-label')?.textContent, title:document.querySelector('#sync-dot')?.title };
    }, curated.revision);
    assert.equal(conflictState.label, '冲突', `${name}: 409 remained green`);

    // The review checkpoint is reachable from the canvas and restores history.
    await page.click('#more-btn');
    await page.click('#menu button[data-mi="tidy"]');
    await page.waitForSelector('#curation-dialog.on');
    assert.equal(await page.locator('#curation-recover').isVisible(), true, `${name}: checkpoint recovery entry is hidden`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#curation-recover');
    const restored = await waitRevision(mapPath, curated.revision + 1);
    assert.notEqual(restored.edges.find((edge) => edge.id === 'e1')?.archived, true, `${name}: checkpoint did not restore archived edge`);
    await page.waitForFunction(() => document.querySelector('#sync-label')?.textContent === '已保存');

    // ---- T3c（C8）：复制引用给 Agent：文本含 id 与 md 路径，菜单项可达 ----
    const refTexts = await page.evaluate(() => {
      const node = S.nodes.at(-1);
      const edge = S.edges[0];
      return { node: objectRefText('node', node), edge: objectRefText('edge', edge) };
    });
    assert.match(refTexts.node, /^\[活点地图\] 节点「.+」n\d+（.+，路线 .+）→ \.live-dot-map\/nodes\/n\d+\.md$/, `${name}: node ref format`);
    assert.match(refTexts.edge, /^\[活点地图\] 方案「.+」e\d+（.+，路线 .+）→ \.live-dot-map\/routes\/e\d+\.md$/, `${name}: edge ref format`);
    await page.locator(`.node[data-id="${createdNodeId}"]`).click({ button: 'right' });
    await page.waitForSelector('#menu button[data-mi="ref"]');
    assert.match(await page.locator('#menu button[data-mi="ref"]').innerText(), /复制引用给 Agent/, `${name}: copy-ref menu item missing`);
    await page.keyboard.press('Escape');

    // ---- T3d（C9）：Agent 写回新对象后画布脉冲高亮 ----
    const agentNodeId = `n-agent-${name}`;
    const beforeExternal = JSON.parse(await readFile(mapPath, 'utf8'));
    const withAgentNode = {
      ...beforeExternal,
      revision: beforeExternal.revision + 1,
      nodes: [...beforeExternal.nodes, {
        id: agentNodeId, num: '98', name: 'Agent 刚画的新节点', type: '结果', kind: 'result', route: 'r1', x: 420, y: 60, r: 34,
        md: `.live-dot-map/nodes/${agentNodeId}.md`, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
        createdBy: 'agent:codex', updatedBy: 'agent:codex', updatedRevision: 0,
      }],
    };
    const externalTmp = `${mapPath}.tmp`;
    await writeFile(externalTmp, `${JSON.stringify(withAgentNode, null, 2)}\n`, 'utf8');
    await rename(externalTmp, mapPath); // 原子替换，避免轮询读到半截 JSON
    const pulseDeadline = Date.now() + 20_000;
    let pulseSeen = false;
    while (Date.now() < pulseDeadline && !pulseSeen) {
      pulseSeen = await page.evaluate((nodeId) => {
        const el = document.querySelector(`.node[data-id="${nodeId}"]`);
        return Boolean(el && el.classList.contains('pulse'));
      }, agentNodeId);
      if (!pulseSeen) await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
    if (!pulseSeen) {
      const diag = await page.evaluate(async (nodeId) => {
        let snapshot;
        try {
          const response = await fetch('/api/v1/snapshot');
          snapshot = await response.json();
        } catch (error) { snapshot = { fetchError: String(error) }; }
        return {
          hasNode: window.LiveDotApp.serialize().nodes?.some((node) => node.id === nodeId),
          label: document.querySelector('#sync-label')?.textContent,
          title: document.querySelector('#sync-dot')?.title,
          dirty: window.LiveDotBridge?.dirty,
          pending: Boolean(window.LiveDotBridge?.pending),
          inFlight: window.LiveDotBridge?.inFlight,
          revision: window.LiveDotBridge?.revision,
          snapshotRevision: snapshot.revision,
          fileHasNode: JSON.parse(localStorage.getItem('__probe') || '{}').hasNode ?? null,
        };
      }, agentNodeId);
      throw new Error(`${name}: agent pulse timeout ${JSON.stringify(diag)}; ${errors.join('; ')}`);
    }
    await page.waitForFunction((nodeId) => window.LiveDotApp?.serialize()?.nodes?.some((node) => node.id === nodeId), agentNodeId);

    // ---- T3（C4）：桥模式切换项目后画布重载且状态已保存，且能继续写新项目 ----
    const projectB = await mkdtemp(join(TEST_ROOT, `livedot-${name}-b-`));
    const dataB = join(projectB, '.live-dot-map');
    const mapPathB = join(dataB, 'map.json');
    await mkdir(dataB, { recursive: true });
    const templateB = JSON.parse(await readFile(TEMPLATE, 'utf8'));
    templateB.name = '切换目标项目';
    await writeFile(mapPathB, `${JSON.stringify(templateB, null, 2)}\n`, 'utf8');
    const switchState = await page.evaluate(async (root) => {
      await window.LiveDotBridge.switchProject(root);
      return { name: window.LiveDotApp.serialize().name, label: document.querySelector('#sync-label')?.textContent };
    }, projectB);
    assert.equal(switchState.name, '切换目标项目', `${name}: canvas did not reload switched project`);
    assert.equal(switchState.label, '已保存', `${name}: switch project did not settle on saved`);
    const bRevisionBefore = JSON.parse(await readFile(mapPathB, 'utf8')).revision;
    await page.locator('#toolbar [data-tool="node"]').click();
    await page.locator('#viewport').click({ position: { x: 500, y: 400 }, force: true });
    await waitRevision(mapPathB, bRevisionBefore + 1);
    await page.waitForFunction(() => document.querySelector('#sync-label')?.textContent === '已保存');

    // ---- T3b（C5/C6）：菜单多层展开、移除导出图片、工作区含最近项目 ----
    await page.click('#proj-menu-btn');
    await page.waitForSelector('#menu.on');
    const menuTopLabels = await page.locator('#menu button[data-mi]').allInnerTexts();
    assert.ok(menuTopLabels.some((text) => text.includes('工作区')), `${name}: workspace group missing`);
    assert.ok(menuTopLabels.some((text) => text.includes('地图')), `${name}: map group missing`);
    await page.click('#menu button[data-mi="map"]');
    await page.waitForFunction(() => document.querySelector('#menu button[data-mi="__back"]') !== null);
    const mapSubLabels = await page.locator('#menu button[data-mi]').allInnerTexts();
    assert.ok(mapSubLabels.some((text) => text.includes('重命名地图')), `${name}: rename lost in map group`);
    assert.ok(!mapSubLabels.some((text) => text.includes('导出图片')), `${name}: export-image item still present`);
    await page.click('#menu button[data-mi="__back"]');
    await page.waitForFunction(() => document.querySelector('#menu button[data-mi="__back"]') === null);
    await page.click('#menu button[data-mi="ws"]');
    await page.waitForFunction(() => document.querySelector('#menu button[data-mi="pick"]') !== null);
    const wsLabels = await page.locator('#menu button[data-mi]').allInnerTexts();
    const wsHeads = await page.locator('#menu .mhead').allInnerTexts();
    assert.ok(wsHeads.some((text) => text.includes('最近项目')), `${name}: recent projects header missing in workspace group`);
    assert.ok(wsLabels.some((text) => text.includes('选择其他项目')), `${name}: pick-project entry missing in workspace group`);
    assert.ok(wsLabels.some((text) => text.includes('新建空白地图')), `${name}: new-blank-map entry missing in workspace group`);
    await page.keyboard.press('Escape');

    // ---- T3（C1/C2）：模板地图不顶掉首启引导，真实内容到达才让位 ----
    const guideTemplate = JSON.parse(await readFile(TEMPLATE, 'utf8'));
    const guideFlow = await page.evaluate(async (template) => {
      try { localStorage.removeItem('dotmap-guide-seen'); } catch {}
      await showFirstMapGuide();
      const shown = document.querySelector('#first-map-guide').classList.contains('on');
      window.LiveDotApp.load(template);
      const keptOnTemplate = document.querySelector('#first-map-guide').classList.contains('on');
      const real = { ...template, nodes: [...template.nodes, { id: 'n-guide-2', num: '02', name: '目标', type: '结果', kind: 'result', route: 'r1', x: 200, y: 0, r: 34, md: '.live-dot-map/nodes/n-guide-2.md', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdBy: 'human', updatedBy: 'human', updatedRevision: 0 }] };
      window.LiveDotApp.load(real);
      const removedOnReal = !document.querySelector('#first-map-guide').classList.contains('on');
      return { shown, keptOnTemplate, removedOnReal };
    }, guideTemplate);
    assert.deepEqual(guideFlow, { shown: true, keptOnTemplate: true, removedOnReal: true }, `${name}: guide handoff on template vs real content`);

    // ---- T3（C2）：无桥直开时首启引导显示，选择入口后不再出现 ----
    const fileContext = await browser.newContext();
    try {
      const filePage = await fileContext.newPage();
      await filePage.goto(`file:///${APP.replaceAll('\\', '/')}`, { waitUntil: 'domcontentloaded' });
      await filePage.waitForSelector('#first-map-guide.on', { timeout: 15_000 });
      await filePage.evaluate(() => { try { localStorage.setItem('dotmap-guide-seen', '1'); } catch {} });
      await filePage.reload({ waitUntil: 'domcontentloaded' });
      await filePage.waitForTimeout(1200);
      const guideGone = await filePage.evaluate(() => document.querySelector('#first-map-guide')?.classList.contains('on') === false);
      assert.equal(guideGone, true, `${name}: guide reappeared after picking an entry`);
    } finally {
      await fileContext.close();
    }

    // Threshold hints fire only when crossing 20 and 30, never below 20 or on every revision.
    const hints = await page.evaluate(async () => {
      const messages=[]; const toast=document.querySelector('#toast');
      const observer=new MutationObserver(()=>{ if (/活跃节点已达/.test(toast.textContent||'')) messages.push(toast.textContent); });
      observer.observe(toast,{childList:true,characterData:true,subtree:true});
      const base=window.LiveDotApp.serialize();
      const make=count=>({...base,revision:base.revision+count,nodes:Array.from({length:count},(_,index)=>index===0?base.nodes[0]:{...base.nodes[0],id:`nt${index}`,num:String(index+1),name:`阈值节点${index+1}`,x:index*10,md:`.live-dot-map/nodes/nt${index}.md`})});
      window.LiveDotApp.load(make(15));
      window.LiveDotApp.load(make(20));
      await new Promise(resolve=>setTimeout(resolve,0));
      window.LiveDotApp.load({...make(20),revision:999});
      window.LiveDotApp.load(make(30));
      await new Promise(resolve=>setTimeout(resolve,50)); observer.disconnect(); return messages;
    });
    assert.deepEqual(hints, ['活跃节点已达 20 个，可打开「整理地图」查看整理建议','活跃节点已达 30 个，请打开「整理地图」后再继续扩张'], `${name}: threshold hints repeated or fired below threshold`);
    await page.screenshot({ path: join(OUTPUT, `bridge-${name}.png`) });
    const unexpectedErrors = errors.filter((message) => !/status of 409 \(Conflict\)/.test(message));
    assert.deepEqual(unexpectedErrors, [], `${name}: page errors: ${unexpectedErrors.join('; ')}`);
    results.push({ browser: name, revision: restored.revision, canvasAnnotation: true, agentStatusRows, xssTextOnly: true, curationRecovered: true });
  } finally {
    await browser.close();
    bridge.child.kill();
    await rm(project, { recursive: true, force: true });
  }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
