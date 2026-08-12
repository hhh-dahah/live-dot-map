import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP = pathToFileURL(resolve(ROOT, 'app.html')).href;
const executablePath = process.env.LIVEDOT_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath });

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

const cases = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [nodes, limit] of [[200, 16.7], [500, 33]]) {
    await page.goto(`${APP}?stress=${nodes}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction((expected) => window.LiveDotApp?.serialize()?.nodes?.length === expected, nodes);
    const samples = await page.evaluate(async () => {
      const values = [];
      for (let index = 0; index < 30; index += 1) {
        const start = performance.now();
        S.nodes[0].x += index % 2 ? 1 : -1;
        render();
        values.push(performance.now() - start);
        await new Promise((done) => setTimeout(done, 0));
      }
      return values;
    });
    const p95 = percentile(samples.slice(5), 0.95);
    cases.push({ nodes, edges: nodes * 2, p95Ms: Number(p95.toFixed(2)), limitMs: limit });
    assert.ok(p95 <= limit, `${nodes}/${nodes * 2} 修改渲染 P95 ${p95.toFixed(2)}ms > ${limit}ms`);
  }

  await page.goto(`${APP}?stress=1000`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LiveDotApp?.serialize()?.nodes?.length === 1000);
  const frames = await page.evaluate(async () => {
    const deltas = [];
    let last = performance.now();
    for (let index = 0; index < 90; index += 1) {
      S.view.x += 2;
      S.view.y += index % 2 ? 1 : -1;
      applyView();
      await new Promise((done) => requestAnimationFrame((now) => { deltas.push(now - last); last = now; done(); }));
    }
    return deltas.slice(5);
  });
  const p95Frame = percentile(frames, 0.95);
  cases.push({ nodes: 1000, edges: 2000, panZoomP95Ms: Number(p95Frame.toFixed(2)), targetFps: 60 });
  assert.ok(p95Frame <= 20, `1000/2000 平移缩放 P95 ${p95Frame.toFixed(2)}ms，未接近 60fps`);
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
