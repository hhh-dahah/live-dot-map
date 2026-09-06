import { chromium } from 'playwright';
import { execSync } from 'child_process';

async function run() {
  const info = JSON.parse(execSync('node livedot.mjs serve --project . --app app.html', { encoding: 'utf8' }).trim());
  console.log('Got fresh URL:', info.url);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 840 } });
  
  await page.goto(info.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // 打开 n24 详情编辑器
  await page.evaluate(async () => {
    const node = S.nodes?.find(n => n.id === 'n24');
    if (!node) throw new Error('n24 not found in S.nodes: ' + JSON.stringify(S.nodes?.map(n => n.id)));
    select('node', node.id);
    await openMd(node);
  });
  await page.waitForTimeout(800);

  // 1. 验证 Agent 闭合块与尾部纯净正文
  const editorVal = await page.locator('.mdv-edit').inputValue();
  console.log('Initial editor content length:', editorVal.length);

  // 检查镜象层中的 tag-agent-start 和 tag-agent-end
  const hasAgentStart = await page.locator('.mdv-mirror .tag-agent-start').count();
  const hasAgentEnd = await page.locator('.mdv-mirror .tag-agent-end').count();
  console.log('Mirror has tag-agent-start:', hasAgentStart > 0);
  console.log('Mirror has tag-agent-end:', hasAgentEnd > 0);

  // 检查最后一行（用户打字行）的类名
  const mirrorLines = await page.locator('.mdv-mirror .ml').all();
  const lastLineText = await mirrorLines[mirrorLines.length - 1].innerText();
  const lastLineClass = await mirrorLines[mirrorLines.length - 1].getAttribute('class');
  console.log('Last line text:', JSON.stringify(lastLineText.trim()));
  console.log('Last line class:', lastLineClass);
  const isLastLineClean = !lastLineClass.includes('author-agent') && !lastLineClass.includes('author-human');
  console.log('Is last line 100% clean (no author class)?', isLastLineClean);

  // 截取编辑器中 Agent 块首尾和尾部正文截图
  // 先滚到 agent 块起始
  await page.evaluate(() => {
    const ed = document.querySelector('.mdv-edit');
    ed.scrollTop = 380;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/13-scheme-c-agent-block.png' });
  console.log('Saved tools/13-scheme-c-agent-block.png');

  // 2. 测试高权重标记（<mark>）与 Ctrl+Z
  // 划选前 20 个字
  await page.evaluate(() => {
    const ed = document.querySelector('.mdv-edit');
    ed.scrollTop = 0;
    ed.focus();
    ed.setSelectionRange(2, 28);
  });
  await page.waitForTimeout(200);

  // 打开标记面板
  await page.locator('.mdv-btn-palette').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tools/14-palette-popover.png' });
  console.log('Saved tools/14-palette-popover.png');

  // 点击设为重点
  await page.locator('[data-palette="important"]').click();
  await page.waitForTimeout(300);

  const valAfterMark = await page.locator('.mdv-edit').inputValue();
  console.log('Has <mark> after action?', valAfterMark.includes('<mark>'));
  const mirrorMarkCount = await page.locator('.mdv-mirror mark.mdv-mark').count();
  console.log('Mirror has rendered mark.mdv-mark?', mirrorMarkCount > 0);

  await page.screenshot({ path: 'tools/15-mark-highlight-editor.png' });
  console.log('Saved tools/15-mark-highlight-editor.png');

  // 测试 Ctrl+Z 撤回
  await page.focus('.mdv-edit');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const valAfterUndo = await page.locator('.mdv-edit').inputValue();
  console.log('Undo restored original?', valAfterUndo === editorVal);

  // 再次划选并标记，以便在预览中查看效果
  await page.evaluate(() => {
    const ed = document.querySelector('.mdv-edit');
    ed.focus();
    ed.setSelectionRange(2, 28);
  });
  await page.locator('.mdv-btn-palette').click();
  await page.waitForTimeout(200);
  await page.locator('[data-palette="important"]').click();
  await page.waitForTimeout(300);

  // 3. 测试预览模式
  await page.locator('.mdv-seg button:has-text("预览")').click();
  await page.waitForTimeout(400);

  const previewHasMark = await page.locator('.mdv-preview mark').count();
  const previewHasAgentBlock = await page.locator('.mdv-preview .author-block.agent').count();
  console.log('Preview has mark element?', previewHasMark > 0);
  console.log('Preview has author-block.agent?', previewHasAgentBlock > 0);

  await page.screenshot({ path: 'tools/16-preview-scheme-c.png' });
  console.log('Saved tools/16-preview-scheme-c.png');

  // 切回编辑模式并撤回 mark，保持文件原样
  await page.locator('.mdv-seg button:has-text("编辑")').click();
  await page.waitForTimeout(200);
  await page.focus('.mdv-edit');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);

  // 保存并关闭
  await page.locator('.mdv-btn-save').click();
  await page.waitForTimeout(500);

  await browser.close();
  console.log('Scheme C verification completed successfully!');
}

run().catch(err => {
  console.error('Error running test:', err);
  process.exit(1);
});
