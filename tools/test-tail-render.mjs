import { chromium } from 'playwright';
import { execSync } from 'child_process';

async function test() {
  const jsonStr = execSync('node livedot.mjs serve --project . --app app.html', { encoding: 'utf8' }).trim();
  const info = JSON.parse(jsonStr);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  const page = await context.newPage();
  await page.goto(info.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24');
    if (node) { select('node', node.id); await openMd(node); }
  });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    const ed = document.querySelector('.mdv-edit');
    if (ed) ed.scrollTop = ed.scrollHeight;
  });
  await page.waitForTimeout(400);

  await page.screenshot({ path: 'tools/12-index-tail-verified.png' });
  console.log('Saved tools/12-index-tail-verified.png');

  const classes = await page.$$eval('.mdv-mirror .ml', els => els.slice(-6).map(e => ({ cls: e.className, txt: e.textContent.slice(0, 20) })));
  console.log('Last 6 lines:', classes);

  await browser.close();
}

test().catch(console.error);
