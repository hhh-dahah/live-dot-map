import { chromium } from 'playwright';
import { execSync } from 'child_process';

async function run() {
  const info = JSON.parse(execSync('node livedot.mjs serve --project . --app app.html', { encoding: 'utf8' }).trim());
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });
  
  await page.goto(info.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // 打开 n24 详情编辑器
  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24');
    select('node', node.id);
    await openMd(node);
  });
  await page.waitForTimeout(800);

  // 1. 将 editor 滚动至 .tag-agent-start 处于上半部分
  await page.evaluate(() => {
    const el = document.querySelector('.mdv-mirror .tag-agent-start');
    if (el) {
      const top = el.offsetTop;
      const ed = document.querySelector('.mdv-edit');
      ed.scrollTop = Math.max(0, top - 60);
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/17-agent-block-start-editor.png' });
  console.log('Saved tools/17-agent-block-start-editor.png');

  // 2. 将 editor 滚动至 .tag-agent-end 处于视野中，并看到下方的纯净人类文字（如“撒大苏打”）
  await page.evaluate(() => {
    const el = document.querySelector('.mdv-mirror .tag-agent-end');
    if (el) {
      const top = el.offsetTop;
      const ed = document.querySelector('.mdv-edit');
      ed.scrollTop = Math.max(0, top - 200);
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/18-agent-block-end-editor.png' });
  console.log('Saved tools/18-agent-block-end-editor.png');

  // 3. 切换预览模式，滚动至 agent 卡片
  await page.locator('.mdv-seg button:has-text("预览")').click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const card = document.querySelector('.mdv-preview .author-block.agent');
    if (card) {
      card.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/19-agent-block-preview.png' });
  console.log('Saved tools/19-agent-block-preview.png');

  await browser.close();
  console.log('Done!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
