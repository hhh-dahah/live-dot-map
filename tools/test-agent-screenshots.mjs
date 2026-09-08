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
  // 检查行高严格同步
  const metrics = await page.evaluate(() => {
    const normalLine = document.querySelector('.mdv-mirror .ml:not(.tag)');
    const startLine = document.querySelector('.mdv-mirror .tag-agent-start');
    const endLine = document.querySelector('.mdv-mirror .tag-agent-end');
    const sComp = startLine ? window.getComputedStyle(startLine) : null;
    return {
      normalHeight: normalLine ? normalLine.getBoundingClientRect().height : null,
      startHeight: startLine ? startLine.getBoundingClientRect().height : null,
      endHeight: endLine ? endLine.getBoundingClientRect().height : null,
      startOuterHTML: startLine ? startLine.outerHTML : null,
      startDisplay: sComp ? sComp.display : null,
      startFontSize: sComp ? sComp.fontSize : null,
      startHeightCSS: sComp ? sComp.height : null,
    };
  });
  console.log('Line Height Metrics:', JSON.stringify(metrics, null, 2));

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

  // 4. 测试点击「打开方式」菜单
  page.on('response', async res => {
    if (res.url().includes('/editors/open')) {
      console.log('INTERCEPTED /editors/open:', res.status());
      try { console.log('RESPONSE JSON:', await res.json()); } catch { console.log('RESPONSE TEXT:', await res.text()); }
    }
  });

  // 截图 20: 极简禅意编辑器主界面（顶部黑白灰胶囊分段开关、无 > 冗余按钮、低饱和石板紫徽标）
  await page.screenshot({ path: 'tools/20-minimal-zen-editor.png' });
  console.log('Saved tools/20-minimal-zen-editor.png');

  // Click 打开方式
  console.log('Clicking 打开方式 button...');
  await page.locator('.mdv-openwrap .mdv-btn').click();
  await page.waitForTimeout(400);

  // 截图 21: 打开方式官方全彩矢量图标菜单
  await page.screenshot({ path: 'tools/21-open-with-menu.png' });
  console.log('Saved tools/21-open-with-menu.png');

  // Click 在文件夹中显示
  console.log('Testing click 在文件夹中显示...');
  const folderBtn = page.locator('.mdv-menu button:has-text("文件夹")');
  const folderCount = await folderBtn.count();
  console.log('Folder btn count:', folderCount);
  if (folderCount > 0) {
    await folderBtn.click();
    await page.waitForTimeout(1000);
  }

  // Click 打开方式 again
  console.log('Opening menu again for VS Code test...');
  await page.locator('.mdv-openwrap .mdv-btn').click();
  await page.waitForTimeout(400);

  // Click VS Code
  console.log('Testing click VS Code...');
  const vscodeBtn = page.locator('.mdv-menu button:has-text("VS Code")');
  const vscodeCount = await vscodeBtn.count();
  console.log('VSCode btn count:', vscodeCount);
  if (vscodeCount > 0) {
    await vscodeBtn.click();
    await page.waitForTimeout(1000);
  }

  // 检查右上角是否没有 collapseBtn (>)
  const hasCollapseBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.mdv-head button'));
    return btns.some(b => b.title?.includes('收起侧栏') || b.getAttribute('aria-label')?.includes('收起侧栏'));
  });
  console.log('Has collapse button (>):', hasCollapseBtn);

  await browser.close();
  console.log('Done!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
