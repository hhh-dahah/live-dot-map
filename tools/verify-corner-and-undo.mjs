import { chromium } from 'playwright';
import { execSync } from 'child_process';

async function main() {
  const jsonStr = execSync('node livedot.mjs serve --project . --app app.html', { encoding: 'utf8' }).trim();
  const info = JSON.parse(jsonStr);
  const targetUrl = info.url;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  const page = await context.newPage();

  console.log('1. 打开测试页面:', targetUrl);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  console.log('2. 操作 n24 节点的 Markdown 编辑器...');
  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24') || S.nodes?.[0];
    if (node) {
      select('node', node.id);
      await openMd(node);
    }
  });
  await page.waitForTimeout(800);

  // 检查折角标记
  const startTicks = await page.locator('.mdv-mirror .author-start').count();
  const endTicks = await page.locator('.mdv-mirror .author-end').count();
  const midLines = await page.locator('.mdv-mirror .author-mid').count();
  const singleLines = await page.locator('.mdv-mirror .author-single').count();
  console.log('Corner indicators: start=' + startTicks + ', end=' + endTicks + ', mid(breathing)=' + midLines + ', single=' + singleLines);
  
  if (startTicks === 0 && singleLines === 0) {
    throw new Error('未检测到起止折角标记！');
  }

  await page.screenshot({ path: 'tools/06-corner-brackets-editor.png' });
  console.log('✓ 截图 tools/06-corner-brackets-editor.png 已生成');

  // 3. 检查笔迹色板气泡弹出与段落模式文案
  const ed = page.locator('.mdv-edit');
  await ed.focus();
  await ed.evaluate(el => el.setSelectionRange(100, 100));
  
  const paletteBtn = page.locator('.mdv-btn-palette');
  await paletteBtn.click();
  await page.waitForTimeout(300);

  const scopeText1 = await page.locator('.mdv-palette-head .scope-txt').textContent();
  console.log('Scope text (cursor mode):', scopeText1);
  if (!scopeText1.includes('段落模式')) {
    throw new Error('光标模式未正确显示段落范围提示：' + scopeText1);
  }

  await page.screenshot({ path: 'tools/07-palette-popover-cursor.png' });
  console.log('✓ 截图 tools/07-palette-popover-cursor.png 已生成');

  // 4. 选区模式文案
  await paletteBtn.click();
  await page.waitForTimeout(200);

  await ed.evaluate(el => el.setSelectionRange(50, 95));
  await paletteBtn.click();
  await page.waitForTimeout(300);

  const scopeText2 = await page.locator('.mdv-palette-head .scope-txt').textContent();
  console.log('Scope text (selection mode):', scopeText2);
  if (!scopeText2.includes('选区模式') || !scopeText2.includes('45')) {
    throw new Error('选区模式未正确显示字数提示：' + scopeText2);
  }

  await page.screenshot({ path: 'tools/08-palette-popover-selection.png' });
  console.log('✓ 截图 tools/08-palette-popover-selection.png 已生成');

  // 5. 测试清除标记与 Ctrl+Z 原生撤回
  await ed.evaluate(el => el.setSelectionRange(2, 2));
  const valBeforeClear = await ed.inputValue();
  console.log('Before clear, has tag?', valBeforeClear.includes('<!-- @author: human -->'));

  const clearBtn = page.locator('[data-palette="clear"]');
  await clearBtn.click();
  await page.waitForTimeout(300);

  const valAfterClear = await ed.inputValue();
  console.log('After clear, has tag?', valAfterClear.includes('<!-- @author: human -->'));
  if (valAfterClear.startsWith('<!-- @author: human -->')) {
    throw new Error('清除标记失败，标签仍在！');
  }

  await ed.focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  const valAfterUndoClear = await ed.inputValue();
  console.log('After Ctrl+Z (undo clear), restored tag?', valAfterUndoClear.includes('<!-- @author: human -->'));
  if (!valAfterUndoClear.includes('<!-- @author: human -->')) {
    throw new Error('Ctrl+Z 撤回清除失败！未能恢复原有标签');
  }
  console.log('✓ Ctrl+Z 原生撤回清除标记验证通过！');

  // 6. 切换到预览模式
  const prevBtn = page.locator('.mdv-seg button', { hasText: '预览' });
  await prevBtn.click();
  await page.waitForTimeout(400);

  await page.screenshot({ path: 'tools/09-preview-final.png' });
  console.log('✓ 截图 tools/09-preview-final.png 已生成');

  await browser.close();
  console.log('🎉 全部验证项 100% 通过！');
}

main().catch(err => {
  console.error('❌ 验证失败:', err);
  process.exit(1);
});
