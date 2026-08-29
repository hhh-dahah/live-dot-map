import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const appUrl = pathToFileURL(resolve(root, 'app.html')).href;
const map = JSON.parse(await readFile(resolve(root, 'agent-kit/map.template.json'), 'utf8'));
const browsers = {
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
};
const results = [];

for (const [name, executablePath] of Object.entries(browsers)) {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.LiveDotFallback && window.LiveDotApp);
    const state = await page.evaluate(async (input) => {
      acceptMapDocument(input, 'import');
      S.anns.push({ id: 'a2', target: { kind: 'canvas' }, text: 'file 降级标注' });
      const exported = window.LiveDotApp.serialize();
      const beforeUndo = S.name;
      pushHistory();
      S.name = '撤销测试';
      undo();
      const afterUndo = S.name;
      pushHistory();
      S.name = '重做测试';
      undo();
      redo();
      const afterRedo = S.name;
      acceptMapDocument({ version: 99, name: '未来只读', future: { keep: true }, routes: [], nodes: [], edges: [], anns: [] }, 'import');
      S.name = '不应保留';
      pushHistory();
      await Promise.resolve();
      return {
        bridgeActive: Boolean(window.LiveDotBridge?.active),
        exportedVersion: exported.version,
        annotationAttention: exported.anns.find((ann) => ann.id === 'a2')?.attention,
        beforeUndo,
        afterUndo,
        afterRedo,
        futureName: S.name,
        readOnly: IO.readOnly,
        syncLabel: document.querySelector('#sync-label')?.textContent,
      };
    }, map);
    assert.equal(state.bridgeActive, false);
    assert.equal(state.exportedVersion, 2);
    assert.equal(state.annotationAttention, 'new');
    assert.equal(state.afterUndo, state.beforeUndo);
    assert.equal(state.afterRedo, '重做测试');
    assert.equal(state.futureName, '未来只读');
    assert.equal(state.readOnly, true);
    assert.equal(state.syncLabel, '降级模式');
    const layouts = [];
    for (const width of [375, 700, 960, 1280, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await page.evaluate(() => {
        document.documentElement.style.zoom = '1';
        const project = document.querySelector('#project-pill')?.getBoundingClientRect();
        const toolbar = document.querySelector('#toolbar')?.getBoundingClientRect();
        const status = document.querySelector('#sync-dot');
        return {
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          separated: Boolean(project && toolbar && project.right <= toolbar.left + 0.5),
          toolbarInside: Boolean(toolbar && toolbar.left >= 0 && toolbar.right <= innerWidth),
          statusKeyboard: status instanceof HTMLButtonElement && status.tabIndex >= 0,
        };
      });
      assert.ok(layout.scrollWidth <= layout.viewport + 1, `${name}: ${width}px horizontal overflow`);
      assert.equal(layout.separated, true, `${name}: ${width}px top controls overlap`);
      assert.equal(layout.toolbarInside, true, `${name}: ${width}px toolbar escaped viewport`);
      assert.equal(layout.statusKeyboard, true, `${name}: ${width}px status light is not keyboard reachable`);
      layouts.push({ width, ...layout });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const zoomed = await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
      const project = document.querySelector('#project-pill')?.getBoundingClientRect();
      const toolbar = document.querySelector('#toolbar')?.getBoundingClientRect();
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        separated: Boolean(project && toolbar && project.right <= toolbar.left + 0.5),
        toolbarInside: Boolean(toolbar && toolbar.left >= 0 && toolbar.right <= innerWidth),
      };
    });
    assert.ok(zoomed.scrollWidth <= zoomed.viewport + 1, `${name}: 200% zoom horizontal overflow`);
    assert.equal(zoomed.separated, true, `${name}: 200% zoom top controls overlap`);
    assert.equal(zoomed.toolbarInside, true, `${name}: 200% zoom toolbar escaped viewport`);
    await page.locator('#sync-dot').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(document.querySelector('#toast')?.textContent?.trim()));
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    assert.deepEqual(errors, []);
    results.push({ browser: name, ...state, responsiveWidths: layouts.map((item) => item.width), zoom200: true, keyboardStatus: true });
  } finally {
    await browser.close();
  }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
