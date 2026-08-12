import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP = join(ROOT, 'app.html');
const RUNTIME = join(ROOT, 'livedot.mjs');
const TEMPLATE = join(ROOT, 'agent-kit', 'map.template.json');
const OUTPUT = join(ROOT, 'output', 'playwright');

async function startBridge(projectRoot) {
  const child = spawn(process.execPath, [RUNTIME, 'serve', '--project', projectRoot, '--app', APP], {
    cwd: ROOT,
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

await mkdir(OUTPUT, { recursive: true });
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
  const project = await mkdtemp(join(tmpdir(), `livedot-${name}-`));
  const data = join(project, '.live-dot-map');
  const mapPath = join(data, 'map.json');
  await mkdir(data, { recursive: true });
  await cp(TEMPLATE, mapPath);
  const seed = JSON.parse(await readFile(mapPath, 'utf8'));
  seed.nodes[0].name = '<img src=x onerror=alert(1)>';
  await writeFile(mapPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
  const bridge = await startBridge(project);
  const browser = await descriptor.engine.launch({ headless: true, ...descriptor.options });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('requestfailed', (request) => errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`response: ${response.status()} ${response.url()}`); });
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
    await page.waitForFunction(() => document.querySelectorAll('#agent-status-list .agent-status').length === 3, undefined, { timeout: 15_000 });
    await page.waitForFunction(() => window.LiveDotApp?.serialize()?.nodes?.[0]?.name === '<img src=x onerror=alert(1)>');
    await page.waitForFunction(() => document.querySelector('.node')?.textContent?.includes('<img'));
    assert.equal(await page.locator('.node img').count(), 0, `${name}: malicious HTML became an element`);
    assert.match((await page.locator('.node').first().innerText()).replace(/\s+/g, ''), /<imgsrc=x/, `${name}: external text was not rendered as text`);
    await page.keyboard.press('m');
    await page.locator('#viewport').click({ position: { x: 900, y: 650 }, force: true });
    let saved;
    try {
      saved = await waitRevision(mapPath, 1);
    } catch (error) {
      const state = await page.evaluate(() => ({
        label: document.querySelector('#sync-label')?.textContent,
        title: document.querySelector('#sync-dot')?.getAttribute('title'),
        bridgeActive: window.LiveDotBridge?.active,
        dirty: window.LiveDotBridge?.dirty,
        pending: Boolean(window.LiveDotBridge?.pending),
        annotations: window.LiveDotApp?.serialize()?.anns?.length,
      }));
      throw new Error(`${name}: revision save timeout ${JSON.stringify(state)}; ${errors.join('; ')}`, { cause: error });
    }
    assert.ok(saved.anns.some((ann) => ann.target?.kind === 'canvas'), `${name}: canvas annotation was not persisted`);
    await page.waitForFunction(() => document.querySelector('#sync-label')?.textContent === '已保存');
    await page.screenshot({ path: join(OUTPUT, `bridge-${name}.png`) });
    assert.deepEqual(errors, [], `${name}: page errors: ${errors.join('; ')}`);
    results.push({ browser: name, revision: saved.revision, canvasAnnotation: true, agentStatusRows: 3, xssTextOnly: true });
  } finally {
    await browser.close();
    bridge.child.kill();
    await rm(project, { recursive: true, force: true });
  }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
