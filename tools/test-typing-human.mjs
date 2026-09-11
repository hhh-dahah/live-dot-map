import { chromium } from 'playwright';

async function test() {
  const targetUrl = 'http://127.0.0.1:50956/app.html?token=FzIEXBcnhAhXn1leFoxDS3Sa6zh7HnWsG8rA5iABUNo';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(targetUrl);
  await page.waitForTimeout(1000);

  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24');
    if (node) { select('node', node.id); await openMd(node); }
  });
  await page.waitForTimeout(600);

  const ed = page.locator('.mdv-edit');
  const val = await ed.inputValue();
  console.log('Value ending before:\n', JSON.stringify(val.slice(-120)));

  const idx = val.indexOf('撒大苏打');
  console.log('Index of 撒大苏打:', idx);
  await ed.evaluate((el, i) => el.setSelectionRange(i + 1, i + 1), idx);

  await page.locator('.mdv-btn-palette').click();
  await page.waitForTimeout(200);
  await page.locator('[data-palette="human"]').click();
  await page.waitForTimeout(300);

  const valAfter = await ed.inputValue();
  console.log('Value ending after mark human:\n', JSON.stringify(valAfter.slice(-250)));

  const mirrorClasses = await page.$$eval('.mdv-mirror .ml', els => els.map(e => ({ cls: e.className, txt: e.textContent.slice(0, 15) })));
  console.log('Mirror last 5 lines:');
  for (const item of mirrorClasses.slice(-5)) {
    console.log('  ', item.cls, '-->', item.txt);
  }

  await browser.close();
}

test().catch(console.error);
