import { chromium } from 'playwright';
import { execSync } from 'child_process';

async function main() {
  const info = JSON.parse(execSync('node livedot.mjs serve --project . --app app.html', { encoding: 'utf8' }).trim());
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 922, height: 780 } });
  await page.goto(info.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  
  // 打开 n24 编辑器
  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24');
    select('node', node.id);
    await openMd(node);
  });
  await page.waitForTimeout(600);

  const beforeClear = await page.locator('.mdv-edit').inputValue();
  console.log('Before clear, length:', beforeClear.length);

  // 定位光标在第 50 字符
  await page.evaluate(() => {
    const ed = document.querySelector('.mdv-edit');
    ed.focus();
    ed.setSelectionRange(50, 50);
  });

  // 点击色板
  await page.locator('.mdv-btn-palette').click();
  await page.waitForTimeout(200);

  // 点击清除
  await page.locator('[data-palette="clear"]').click();
  await page.waitForTimeout(300);

  const afterClear = await page.locator('.mdv-edit').inputValue();
  console.log('After clear, content changed?', afterClear !== beforeClear);
  console.log('After clear, length:', afterClear.length);

  // 按 Ctrl+Z 撤回
  await page.focus('.mdv-edit');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  const afterUndo = await page.locator('.mdv-edit').inputValue();
  console.log('After Ctrl+Z, matches beforeClear?', afterUndo === beforeClear);

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
